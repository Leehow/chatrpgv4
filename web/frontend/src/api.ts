import type {
  BootstrapResponse,
  GameState,
  HandoutCard,
  HandoutKind,
  ModelsResponse,
  RuntimeEvent,
  SessionInfo,
  TrashEntry,
  TranscriptMessage,
  PlayerIntent,
} from "./types";

/** 服务器/事件载荷中的 kind 值归一为严格枚举；未知值回退 document。 */
function normalizeHandoutKind(value: unknown): HandoutKind {
  return value === "read_aloud" || value === "map" ? value : "document";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(path, init);
  const text = await resp.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error body */
  }
  if (!resp.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : `HTTP ${resp.status}`;
    throw new Error(message);
  }
  return data as T;
}

export function fetchModels(): Promise<ModelsResponse> {
  return request<ModelsResponse>("/api/models");
}

export type UserLayoutPrefs = {
  leftSidebarWidth?: number;
  rightSidebarWidth?: number;
  leftSidebarCollapsed?: boolean;
  rightSidebarCollapsed?: boolean;
};

export type UserPrefs = {
  provider?: string;
  model?: string;
  thinking?: string;
  appearance?: string;
  layout?: UserLayoutPrefs;
  visionEnabled?: boolean;
  visionProvider?: string;
  visionModel?: string;
  portraitImageProvider?: string;
  portraitImageModel?: string;
};

export type WebSearchKeyProvider = {
  id: string;
  name: string;
  keyField: string;
};

export type WebSearchKeysView = {
  keys: Record<string, boolean>;
  providers: WebSearchKeyProvider[];
};

export function fetchWebSearchKeys(): Promise<WebSearchKeysView> {
  return request<WebSearchKeysView>("/api/web-search-keys");
}

export function saveWebSearchKeys(keys: Record<string, string>): Promise<WebSearchKeysView> {
  return request<WebSearchKeysView>("/api/web-search-keys", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keys }),
  });
}

export type OcrTokenView = {
  configured: boolean;
};

export function fetchOcrToken(): Promise<OcrTokenView> {
  return request<OcrTokenView>("/api/ocr-token");
}

export function saveOcrToken(token: string): Promise<OcrTokenView> {
  return request<OcrTokenView>("/api/ocr-token", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
}

export function fetchUserPrefs(): Promise<UserPrefs> {
  return request<UserPrefs>("/api/user-prefs");
}

export function saveUserPrefs(payload: Partial<UserPrefs>): Promise<UserPrefs> {
  return request<UserPrefs>("/api/user-prefs", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export type ModelEditorState = {
  oauthProviders: { id: string; label: string; note: string; methods: string[] }[];
  presets: {
    id: string;
    label: string;
    note: string;
    api?: string;
    baseUrl?: string;
    models?: { id: string; name?: string }[];
  }[];
  catalogProviders: { id: string; label: string; note: string; methods: string[]; baseUrl?: string }[];
  providers: {
    id: string;
    name: string;
    baseUrl: string;
    hasAuth: boolean;
    models: { id: string; name: string }[];
  }[];
  hiddenProviderIds: string[];
  extraProviderIds: string[];
  customProviders: { id: string; label: string; baseUrl: string; note?: string }[];
  writable: boolean;
};

export function fetchModelEditor(): Promise<ModelEditorState> {
  return request<ModelEditorState>("/api/model-editor");
}

export function saveModelEditor(payload: {
  hidden: string[];
  custom: { id: string; label: string; baseUrl: string; note?: string }[];
  extra: string[];
}): Promise<{ ok: boolean; errors?: string[] }> {
  return request("/api/model-editor", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function saveModelEditorProvider(payload: {
  id: string;
  apiKey: string;
  label?: string;
  api?: string;
  baseUrl?: string;
  models?: { id: string; name?: string }[];
}): Promise<{ ok: boolean; errors?: string[]; provider?: string }> {
  return request("/api/model-editor/provider", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export type ModelLoginSnapshot = {
  active: boolean;
  events: { type?: string; message?: string; url?: string; userCode?: string; verificationUri?: string }[];
  prompt: {
    promptId: number;
    prompt: { type: string; message: string; placeholder?: string; options?: { id: string; label: string }[] };
  } | null;
  done: boolean;
  result: { ok: boolean; error?: string; provider?: string } | null;
};

export function startModelLogin(payload: {
  providerId: string;
  method: string;
}): Promise<{ ok: boolean; error?: string; started?: boolean; label?: string }> {
  return request("/api/model-editor/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function fetchModelLogin(): Promise<ModelLoginSnapshot> {
  return request("/api/model-editor/login");
}

export function respondModelLogin(payload: {
  promptId: number;
  value?: string;
  cancel?: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  return request("/api/model-editor/login/respond", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function cancelModelLogin(): Promise<{ ok: boolean; error?: string }> {
  return request("/api/model-editor/login/cancel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
}

export function fetchBootstrap(): Promise<BootstrapResponse> {
  return request<BootstrapResponse>("/api/bootstrap");
}

/** Remove one workspace parse cache: `.coc/source-bundles/<bundle_id>/`. */
export function deleteSourceBundle(
  bundleId: string,
): Promise<{ ok: boolean; bundle_id: string }> {
  return request(`/api/source-bundles/${encodeURIComponent(bundleId)}`, {
    method: "DELETE",
  });
}

export function createCampaign(
  payload:
    | {
        mode?: "starter";
        scenario_id: string;
        /** Omit when player chose「自己创建」— campaign starts investigator-less. */
        pregen_id?: string;
        title?: string;
      }
    | {
        mode: "pdf";
        source_bundle_path: string;
        /** Omit or empty when player chose「新建调查员」— main chat runs coc-character. */
        investigator_id?: string;
        title?: string;
        scenario_id?: string;
        campaign_id?: string;
      }
    | {
        mode: "library";
        canonical_module_id: string;
        investigator_id?: string;
        title?: string;
        campaign_id?: string;
      },
): Promise<{
  result: {
    campaign_id: string;
    investigator_id?: string | null;
    needs_investigator?: boolean;
  };
}> {
  return request("/api/campaigns", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function uploadPdf(file: File): Promise<{
  ok: boolean;
  result: import("./types").PdfUploadResult;
}> {
  const form = new FormData();
  form.append("file", file, file.name);
  const resp = await fetch("/api/uploads/pdf", { method: "POST", body: form });
  const text = await resp.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* ignore */
  }
  if (!resp.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : `HTTP ${resp.status}`;
    throw new Error(message);
  }
  return data as { ok: boolean; result: import("./types").PdfUploadResult };
}

/**
 * Desktop-shell import transport: register a PDF by local filesystem path
 * (the Electron menu / onboarding wizard hand over a path, never a browser
 * File). Same registration result as uploadPdf; parsing continues through
 * the identical ingestPdf chain.
 */
export function uploadPdfFromPath(path: string): Promise<{
  ok: boolean;
  result: import("./types").PdfUploadResult;
}> {
  return request("/api/uploads/pdf/from-path", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
}

export interface IngestPdfBackgroundWindow {
  bundle_id: string;
  pdf_indices: number[];
  status: string;
}

export interface IngestPdfResult {
  status: "matched_bundle" | "in_progress" | string;
  file_sha256: string;
  message?: string;
  matched_bundle?: import("./types").SourceBundle | null;
  source_bundle_path?: string;
  bundle_id?: string;
  page_count?: number | null;
  rendered_pdf_indices?: number[];
  validation?: string;
  background_window?: IngestPdfBackgroundWindow | null;
}

/**
 * Trigger external-router parsing of a registered PDF into a source bundle.
 * Both bridges expose the identical contract at /api/uploads/pdf/ingest.
 */
export function ingestPdf(payload: {
  file_sha256?: string;
  stored_path?: string;
  pdf_indices?: number[];
}): Promise<{ ok: boolean; result: IngestPdfResult }> {
  return request("/api/uploads/pdf/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export type PdfIngestStatusPhase =
  | "window1_in_progress"
  | "ready"
  | "background_in_progress"
  | "background_complete"
  | "unknown";

export type PdfIngestStatus = {
  file_sha256: string;
  phase: PdfIngestStatusPhase;
  bundle_id: string | null;
  page_count: number | null;
  rendered_pdf_indices: number[] | null;
  background_pdf_indices: number[] | null;
};

/** Discrete ingest phase. 404 / network failures return null (silent). */
export async function fetchPdfIngestStatus(
  fileSha256: string,
): Promise<PdfIngestStatus | null> {
  try {
    const data = await request<{
      ok: boolean;
      result: PdfIngestStatus;
    }>(`/api/uploads/pdf/ingest-status?file_sha256=${encodeURIComponent(fileSha256)}`);
    return data?.result ?? null;
  } catch {
    return null;
  }
}

/** Rename a campaign (title only; identity stays campaign_id-keyed). */
export function renameCampaign(
  campaignId: string,
  title: string,
): Promise<{ ok: boolean; result: { campaign_id: string; title: string } }> {
  return request("/api/campaigns/rename", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ campaign_id: campaignId, title }),
  });
}

/** Move a campaign into the workspace trash (24h retention, restorable). */
export function trashCampaign(
  campaignId: string,
): Promise<{ ok: boolean; result: { trash_key: string; campaign_id: string } }> {
  return request("/api/campaigns/trash", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ campaign_id: campaignId }),
  });
}

/** List recoverable campaigns in the trash (expired ones are already purged). */
export function fetchTrash(): Promise<{ ok: boolean; entries: TrashEntry[] }> {
  return request("/api/trash");
}

/** Restore one trashed campaign back into the campaign list. */
export function restoreCampaign(
  trashKey: string,
): Promise<{ ok: boolean; result: { campaign_id: string; title?: string | null } }> {
  return request("/api/trash/restore", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trash_key: trashKey }),
  });
}

export function createInvestigator(payload: {
  name: string;
  occupation?: string;
  era?: string;
  age?: number;
  investigator_id?: string;
}): Promise<{ result: { investigator_id: string } }> {
  return request("/api/investigators", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function createSession(
  campaignId: string,
  selection: { provider: string; model: string; thinking: string },
): Promise<SessionInfo> {
  return request<SessionInfo>("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ campaign_id: campaignId, ...selection }),
  });
}

export function fetchState(sessionId: string): Promise<GameState> {
  return request<GameState>(`/api/sessions/${sessionId}/state`);
}

/** Use one charge of a consumable; returns the fresh state (item may be gone). */
export type GeneratePortraitResponse = {
  ok: boolean;
  portrait: {
    portrait_path?: string;
    portrait_source?: string;
    portrait_status?: string;
    portrait_generated_at?: string;
    image_url?: string;
  };
};

/** Host-built prompt + xAI image. Never send a client prompt. */
export function generatePortrait(
  payload: { campaign_id: string; investigator_id: string },
  signal?: AbortSignal,
): Promise<GeneratePortraitResponse> {
  return request<GeneratePortraitResponse>("/api/portraits/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      campaign_id: payload.campaign_id,
      investigator_id: payload.investigator_id,
    }),
    signal,
  });
}

export function useItem(sessionId: string, itemId: string): Promise<GameState> {
  return request<GameState>(`/api/sessions/${sessionId}/items/use`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item_id: itemId }),
  });
}

export function fetchTranscript(
  sessionId: string,
): Promise<{ messages: TranscriptMessage[] }> {
  return request(`/api/sessions/${sessionId}/transcript`);
}

/** Abort the in-flight pi-coc turn for this session (host-side, not just the SSE). */
export function abortTurn(sessionId: string): Promise<{ ok: boolean; aborted: boolean }> {
  return request(`/api/sessions/${sessionId}/abort`, { method: "POST" });
}

export interface TurnHandlers {
  onTool?: (phase: string, tool: string) => void;
  onDelta?: (text: string) => void;
  onDeltaReset?: () => void;
  /** Live keeper-side thinking deltas — observer feed, never table narration. */
  onThinking?: (text: string) => void;
  /** Live cumulative keeper token usage while the turn is still running. */
  onUsage?: (usage: { input: number | null; output: number | null }) => void;
  onTurn?: (payload: {
    events: RuntimeEvent[];
    state: GameState;
    /** Keeper worker usage for the settled turn, from runtime telemetry. */
    usage?: { input_tokens?: number | null; output_tokens?: number | null } | null;
    message?: TranscriptMessage;
  }) => void;
  onError?: (message: string) => void;
  /** 新交付的原文卡（turn 结束时对 campaign 投影求差后注入）。 */
  onHandout?: (card: HandoutCard) => void;
  /** Advisory transparency notice (e.g. a turn settled with no visible text). */
  onNotice?: (message: string) => void;
  /** Setup→play host handoff (customType coc_setup_handoff). */
  onHandoff?: (payload: {
    type: string;
    campaign_id?: string;
    receipt?: unknown;
    at?: string | number;
  }) => void;
}

/**
 * Consume one turn over SSE. EventSource cannot POST, so parse the
 * text/event-stream frames manually off the fetch ReadableStream.
 * Aborting `signal` stops consuming the stream locally. Call `abortTurn`
 * to stop the pi-coc host turn as well.
 */
export async function streamTurn(
  sessionId: string,
  input: string,
  provider: string,
  model: string,
  thinking: string,
  playerIntent: PlayerIntent | undefined,
  handlers: TurnHandlers,
  signal?: AbortSignal,
  options?: { attach?: boolean; liveId?: string },
): Promise<void> {
  let resp: Response;
  try {
    resp = await fetch(`/api/sessions/${sessionId}/turns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input,
        provider,
        model,
        thinking,
        ...(options?.attach ? { attach: true } : {}),
        ...(!options?.attach && options?.liveId ? { live_id: options.liveId } : {}),
        ...(playerIntent ? { player_intent: playerIntent } : {}),
      }),
      signal,
    });
  } catch {
    if (signal?.aborted) return;
    handlers.onError?.("无法连接到服务器。");
    return;
  }
  if (!resp.ok || !resp.body) {
    let message = `HTTP ${resp.status}`;
    try {
      const data = await resp.json();
      if (data && data.error) message = String(data.error);
    } catch {
      /* keep HTTP status */
    }
    handlers.onError?.(message);
    return;
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    let read: ReadableStreamReadResult<Uint8Array>;
    try {
      read = await reader.read();
    } catch {
      if (signal?.aborted) return;
      handlers.onError?.("回合数据流中断。");
      return;
    }
    const { done, value } = read;
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary: number;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      let event = "message";
      const dataLines: string[] = [];
      for (const line of frame.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7).trim();
        else if (line.startsWith("data: ")) dataLines.push(line.slice(6));
        // ": ping" heartbeats carry no data and are ignored
      }
      if (!dataLines.length) continue;
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(dataLines.join("\n")) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (event === "delta") {
        handlers.onDelta?.(String(data.text ?? ""));
      } else if (event === "delta_reset") {
        handlers.onDeltaReset?.();
      } else if (event === "tool") {
        handlers.onTool?.(String(data.phase ?? ""), String(data.tool ?? ""));
      } else if (event === "thinking") {
        handlers.onThinking?.(String(data.text ?? ""));
      } else if (event === "usage") {
        handlers.onUsage?.({
          input: typeof data.input === "number" ? data.input : null,
          output: typeof data.output === "number" ? data.output : null,
        });
      } else if (event === "turn") {
        handlers.onTurn?.(
          data as unknown as {
            events: RuntimeEvent[];
            state: GameState;
            usage?: { input_tokens?: number | null; output_tokens?: number | null } | null;
            message?: TranscriptMessage;
          },
        );
      } else if (event === "error") {
        handlers.onError?.(String(data.message ?? "未知错误"));
      } else if (event === "handout") {
        handlers.onHandout?.({
          asset_id: String(data.asset_id ?? ""),
          kind: normalizeHandoutKind(data.kind),
          content_origin: data.content_origin === "authored_derivative"
            ? "authored_derivative"
            : "source_verbatim",
          title: String(data.title ?? ""),
          card_label: data.card_label == null ? null : String(data.card_label),
          kind_label: data.kind_label == null ? null : String(data.kind_label),
          source_label: data.source_label == null ? null : String(data.source_label),
          text: data.text == null ? null : String(data.text),
          summary: data.summary == null ? null : String(data.summary),
          image_url: typeof data.image_url === "string" && data.image_url ? data.image_url : null,
          source_pages: Array.isArray(data.source_pages)
            ? data.source_pages.map(String)
            : [],
        });
      } else if (event === "notice") {
        handlers.onNotice?.(String(data.message ?? ""));
      } else if (event === "delivery_ack_required") {
        const finalizationId = String(data.finalization_id ?? "");
        const renderedSha256 = String(data.rendered_sha256 ?? "");
        if (finalizationId && renderedSha256) {
          try {
            const ackResponse = await fetch(`/api/sessions/${sessionId}/delivery-ack`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                finalization_id: finalizationId,
                rendered_sha256: renderedSha256,
              }),
            });
            if (!ackResponse.ok) {
              handlers.onNotice?.("本回合文本已显示，但交付确认未写入；下次恢复时可能原样重放。");
            }
          } catch {
            handlers.onNotice?.("本回合文本已显示，但交付确认未写入；下次恢复时可能原样重放。");
          }
        }
      } else if (event === "coc_setup_handoff" || data.type === "coc_setup_handoff") {
        handlers.onHandoff?.({
          type: "coc_setup_handoff",
          campaign_id: typeof data.campaign_id === "string" ? data.campaign_id : undefined,
          receipt: data.receipt,
          at: data.at as string | number | undefined,
        });
      } else if (event === "end") {
        return;
      }
    }
  }
}
