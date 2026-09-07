import { PIPI_HOST_PROTOCOL_VERSION } from "@pipi/host-api";

/** Official pi UI hooks (notify/confirm/select/input/widget) — parallel to `ext.emit` (spec D12). */
export const EXTUI_CHANNEL = "extui" as const;
/**
 * Host-side timeout for a request nobody answers. Tests may override via
 * PiBackendOptions.extensionUiTimeoutMs.
 *
 * 这只是防泄漏的兜底，不是催人回答的计时器。原来所有请求一律 30 秒，而一个 confirm
 * 常常带着要读完才能决定的正文（Hydra 的 Execution Preview：目标、逐步的临时改动、
 * 交还状态）。人还在读，计时器先到了，扩展收到的取消和"用户点了取消"长得一模一样——
 * agent 于是认真分析"你是不是对计划有顾虑"，其实你只是在读。
 *
 * 所以按类型分：要人读、要人决定的对话给足时间；一闪而过的通知不需要这么久。
 */
export const EXTUI_TIMEOUT_MS = 30_000;
/** 需要人读完再决定的对话。够长到不会打断阅读，仍有界所以不会泄漏。 */
export const EXTUI_DIALOG_TIMEOUT_MS = 30 * 60_000;

const DIALOG_KINDS = new Set(["confirm", "select", "input", "editor"]);
const METHOD_KIND: Record<string, string> = { setWidget: "widget" };

export type ExtUiCancelReason = "timeout" | "aborted";

export type ExtUiEvent =
  | {
      type: "request";
      sessionId: string;
      requestId: string;
      kind: string;
      payload: unknown;
    }
  | {
      type: "cancel";
      sessionId: string;
      requestId: string;
      reason: ExtUiCancelReason;
    };

export type ExtUiHostEvent = {
  protocolVersion: typeof PIPI_HOST_PROTOCOL_VERSION;
  channel: typeof EXTUI_CHANNEL;
  event: ExtUiEvent;
};

export type ExtUiResponseBody = {
  value?: unknown;
  confirmed?: boolean;
  cancelled?: boolean;
};

export type ExtUiRespondResult =
  | { ok: true; command: { type: "extension_ui_response"; id: string } & ExtUiResponseBody }
  | { ok: false; error: "late" | "invalid" };

export function isExtensionUiRequest(e: { type?: unknown } | null | undefined): boolean {
  return e?.type === "extension_ui_request";
}

export function kindFromMethod(method: unknown): string {
  if (typeof method !== "string" || !method) return "unknown";
  return METHOD_KIND[method] ?? method;
}

export function needsResponse(kind: string): boolean {
  return DIALOG_KINDS.has(kind);
}

export function mapExtensionUiRequest(
  sessionId: string,
  rpc: Record<string, unknown>,
): ExtUiHostEvent | undefined {
  if (!isExtensionUiRequest(rpc)) return undefined;
  const requestId = typeof rpc.id === "string" ? rpc.id : "";
  if (!requestId) return undefined;
  const kind = kindFromMethod(rpc.method);
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rpc)) {
    if (key === "type" || key === "id" || key === "method") continue;
    payload[key] = value;
  }
  return {
    protocolVersion: PIPI_HOST_PROTOCOL_VERSION,
    channel: EXTUI_CHANNEL,
    event: { type: "request", sessionId, requestId, kind, payload },
  };
}

function sanitizeResponse(response: unknown): ExtUiResponseBody | undefined {
  if (!response || typeof response !== "object" || Array.isArray(response)) return undefined;
  const src = response as Record<string, unknown>;
  const body: ExtUiResponseBody = {};
  if ("value" in src) body.value = src.value;
  if (typeof src.confirmed === "boolean") body.confirmed = src.confirmed;
  if (src.cancelled === true) body.cancelled = true;
  return body;
}

type Pending = {
  sessionId: string;
  requestId: string;
  timer: ReturnType<typeof setTimeout>;
};

export type ExtensionUiChannelOptions = {
  emit: (event: ExtUiHostEvent) => void;
  /** Write `extension_ui_response` on timeout/abort so pi does not hang. */
  writeResponse?: (sessionId: string, body: { type: "extension_ui_response"; id: string; cancelled: true }) => void;
  timeoutMs?: number;
};

/** In-flight dialog table keyed by sessionId + requestId. */
export class ExtensionUiChannel {
  private readonly pending = new Map<string, Pending>();
  private readonly emit: ExtensionUiChannelOptions["emit"];
  private readonly writeResponse: ExtensionUiChannelOptions["writeResponse"];
  private readonly timeoutMs: number;
  /** 调用方显式指定的超时（测试用）：给了就对所有类型生效，不再按类型分档。 */
  private readonly explicitTimeoutMs: number | undefined;

  constructor(options: ExtensionUiChannelOptions) {
    this.emit = options.emit;
    this.writeResponse = options.writeResponse;
    this.explicitTimeoutMs = options.timeoutMs;
    this.timeoutMs = options.timeoutMs ?? EXTUI_TIMEOUT_MS;
  }

  private key(sessionId: string, requestId: string): string {
    return `${sessionId}\0${requestId}`;
  }

  isPending(sessionId: string, requestId: string): boolean {
    return this.pending.has(this.key(sessionId, requestId));
  }

  /** Map a pi stdout RPC event. Returns true when consumed (caller must not treat it as stream). */
  handleRpc(sessionId: string, rpc: Record<string, unknown>): boolean {
    const event = mapExtensionUiRequest(sessionId, rpc);
    if (!event) return false;
    this.emit(event);
    if (event.event.type === "request" && needsResponse(event.event.kind)) {
      this.arm(sessionId, event.event.requestId, event.event.kind, event.event.payload);
    }
    return true;
  }

  respond(sessionId: string, requestId: string, response: unknown): ExtUiRespondResult {
    if (typeof sessionId !== "string" || !sessionId || typeof requestId !== "string" || !requestId) {
      return { ok: false, error: "invalid" };
    }
    const body = sanitizeResponse(response);
    if (!body) return { ok: false, error: "invalid" };
    const key = this.key(sessionId, requestId);
    const pending = this.pending.get(key);
    if (!pending) return { ok: false, error: "late" };
    clearTimeout(pending.timer);
    this.pending.delete(key);
    return { ok: true, command: { type: "extension_ui_response", id: requestId, ...body } };
  }

  abortSession(sessionId: string): void {
    for (const [key, pending] of [...this.pending]) {
      if (pending.sessionId !== sessionId) continue;
      this.finish(key, pending, "aborted");
    }
  }

  dispose(): void {
    for (const [key, pending] of [...this.pending]) {
      this.finish(key, pending, "aborted");
    }
  }

  /**
   * 扩展自己声明的等待时长（pi 的 `ui.confirm(title, message, { timeout })` 会带过来）。
   * 让声明的一方说话，比宿主按类型猜更准：知道自己那份正文要读多久的是扩展。
   * 仍然夹在合理区间——一个笔误的 0 或者一整年都不该变成实际行为。
   */
  private declaredTimeout(payload: unknown): number | undefined {
    const raw = (payload as { timeout?: unknown } | undefined)?.timeout;
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return undefined;
    return Math.min(Math.max(raw, 1_000), EXTUI_DIALOG_TIMEOUT_MS);
  }

  private arm(sessionId: string, requestId: string, kind?: string, payload?: unknown): void {
    const key = this.key(sessionId, requestId);
    const existing = this.pending.get(key);
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(() => {
      const current = this.pending.get(key);
      if (!current) return;
      this.finish(key, current, "timeout");
      // 顺序：测试显式指定 > 扩展自己声明 > 按类型分档（对话长、通知短）。
    }, this.explicitTimeoutMs
      ?? this.declaredTimeout(payload)
      ?? (kind && DIALOG_KINDS.has(kind) ? EXTUI_DIALOG_TIMEOUT_MS : this.timeoutMs));
    timer.unref?.();
    this.pending.set(key, { sessionId, requestId, timer });
  }

  private finish(key: string, pending: Pending, reason: ExtUiCancelReason): void {
    clearTimeout(pending.timer);
    this.pending.delete(key);
    this.emit({
      protocolVersion: PIPI_HOST_PROTOCOL_VERSION,
      channel: EXTUI_CHANNEL,
      event: {
        type: "cancel",
        sessionId: pending.sessionId,
        requestId: pending.requestId,
        reason,
      },
    });
    try {
      this.writeResponse?.(pending.sessionId, {
        type: "extension_ui_response",
        id: pending.requestId,
        cancelled: true,
      });
    } catch {
      /* process may already be gone */
    }
  }
}
