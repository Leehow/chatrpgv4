/**
 * Host → agent invoke channel (spec D8 `invokeExtension`).
 *
 * A panel calls `api.invoke(method, params)` and expects an answer from its
 * package's agent half. pi has no route for that: its RPC dispatcher answers a
 * fixed command set and rejects everything else, and a registered command's
 * handler returns `void` by contract — so a value could not come back even if
 * the host could reach one. The host used to write `{type:"invokeExtension"}`
 * to pi's stdin, where it became `Unknown command` and the panel got a timeout.
 *
 * This mount is the missing half, and it opens no new transport: the agent
 * already talks to the host over the loopback HostBridge, so the request rides
 * back over that same pair. This side long-polls `ext_invoke_poll`, runs the
 * handler the package registered, and POSTs `ext_invoke_result`.
 *
 * Registration is inverted the way `runtime-info` collects its debug
 * contributors: a package publishes its handler on a well-known global when it
 * loads (this mount is ordered before every package), and nothing here knows a
 * package id. A session where no package registers anything polls and parks —
 * the honest answer for a host with nothing to invoke.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Well-known registry global. Packages publish through it; only this mount reads it. */
export const EXT_INVOKE_REGISTRY_KEY = Symbol.for("pipiui.ext-invoke.registry");

export type ExtInvokeHandler = (params: unknown) => unknown | Promise<unknown>;

export type ExtInvokeRegistry = {
  /** Contract version, so a package built against an older kernel can refuse politely. */
  readonly version: 1;
  register(extensionId: string, method: string, handler: ExtInvokeHandler): () => void;
  /** The poll loop's dispatch table. */
  resolve(extensionId: string, method: string): ExtInvokeHandler | undefined;
};

export type ExtInvokeRequest = { requestId: string; extensionId: string; method: string; params?: unknown };

function handlerKey(extensionId: string, method: string): string {
  return `${extensionId} ${method}`;
}

/**
 * Install (or reuse) the process-wide registry.
 *
 * Reuse matters: this module is loaded once per session process, but a package
 * that imports it directly must land on the same map, not a second one.
 */
export function installRegistry(
  host: Record<symbol, unknown> = globalThis as unknown as Record<symbol, unknown>,
): ExtInvokeRegistry {
  const existing = host[EXT_INVOKE_REGISTRY_KEY] as ExtInvokeRegistry | undefined;
  if (existing && existing.version === 1) return existing;
  const handlers = new Map<string, ExtInvokeHandler>();
  const created: ExtInvokeRegistry = {
    version: 1,
    register(extensionId, method, handler) {
      const key = handlerKey(extensionId, method);
      handlers.set(key, handler);
      return () => {
        if (handlers.get(key) === handler) handlers.delete(key);
      };
    },
    resolve(extensionId, method) {
      return handlers.get(handlerKey(extensionId, method));
    },
  };
  host[EXT_INVOKE_REGISTRY_KEY] = created;
  return created;
}

/** Published at import time: packages load after this mount and find it ready. */
export const registry: ExtInvokeRegistry = installRegistry();

export type BridgeConfig = { port: string; capability: string };

export function bridgeConfig(env: NodeJS.ProcessEnv = process.env): BridgeConfig | undefined {
  const port = env.PIPIUI_BRIDGE_PORT?.trim();
  const capability = env.PIPIUI_SESSION_CAPABILITY?.trim();
  return port && capability ? { port, capability } : undefined;
}

async function post(
  config: BridgeConfig,
  action: string,
  event: Record<string, unknown>,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<Record<string, unknown> | undefined> {
  const response = await fetchImpl(`http://127.0.0.1:${config.port}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ schemaVersion: 1, sessionCapability: config.capability, action, event }),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) return undefined;
  const payload = (await response.json()) as { ok?: boolean; result?: Record<string, unknown> };
  return payload?.ok ? payload.result ?? {} : undefined;
}

export function parseRequests(result: Record<string, unknown> | undefined): ExtInvokeRequest[] {
  const requests = result && Array.isArray(result.requests) ? result.requests : [];
  return requests.filter(
    (item): item is ExtInvokeRequest =>
      !!item &&
      typeof item === "object" &&
      typeof (item as ExtInvokeRequest).requestId === "string" &&
      typeof (item as ExtInvokeRequest).extensionId === "string" &&
      typeof (item as ExtInvokeRequest).method === "string",
  );
}

/**
 * Run one request and shape the reply.
 *
 * A handler may answer in the envelope the panel expects (`{ok, data}`) or just
 * return its data; both are accepted so a package is not forced to restate the
 * protocol. A throw becomes `agent_error` — the panel shows it instead of
 * waiting out the host's timeout.
 */
export async function runRequest(request: ExtInvokeRequest, lookup: ExtInvokeRegistry): Promise<Record<string, unknown>> {
  const handler = lookup.resolve(request.extensionId, request.method);
  if (!handler) {
    return {
      requestId: request.requestId,
      ok: false,
      code: "not_found",
      error: `extension ${request.extensionId} has no invoke handler '${request.method}'`,
    };
  }
  try {
    const value = await handler(request.params);
    if (value && typeof value === "object" && "ok" in (value as Record<string, unknown>)) {
      const envelope = value as { ok?: unknown; data?: unknown; error?: unknown };
      if (envelope.ok === true) return { requestId: request.requestId, ok: true, data: envelope.data };
      const failure = envelope.error as { code?: unknown; message?: unknown } | undefined;
      return {
        requestId: request.requestId,
        ok: false,
        code: typeof failure?.code === "string" ? failure.code : "agent_error",
        error: typeof failure?.message === "string" ? failure.message : "invoke failed",
      };
    }
    return { requestId: request.requestId, ok: true, data: value };
  } catch (error) {
    return {
      requestId: request.requestId,
      ok: false,
      code: "agent_error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export type LoopOptions = {
  config: BridgeConfig;
  lookup?: ExtInvokeRegistry;
  fetchImpl?: typeof fetch;
  /** Backoff after a transport failure, so a dead host does not become a spin loop. */
  retryDelayMs?: number;
  signal: AbortSignal;
  /** Test seam: stop after this many polls. */
  maxPolls?: number;
};

/** Long-poll the host for invoke requests until the session ends. */
export async function pollLoop(options: LoopOptions): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const lookup = options.lookup ?? registry;
  const retryDelayMs = options.retryDelayMs ?? 2000;
  /** Dispatches still running; drained on exit so a shutdown does not swallow replies. */
  const inFlight = new Set<Promise<void>>();
  const drain = async () => { await Promise.allSettled([...inFlight]); };
  let polls = 0;
  while (!options.signal.aborted) {
    if (options.maxPolls !== undefined && polls >= options.maxPolls) return drain();
    polls += 1;
    let requests: ExtInvokeRequest[] = [];
    try {
      requests = parseRequests(await post(options.config, "ext_invoke_poll", {}, fetchImpl, options.signal));
    } catch {
      if (options.signal.aborted) return drain();
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      continue;
    }
    // Dispatch without blocking the next poll: one handler that never settles
    // (or just runs long) must not wedge the channel for every other panel call.
    // The host bounds each request with its own timeout.
    for (const request of requests) {
      const dispatch = runRequest(request, lookup).then(async (result) => {
        if (options.signal.aborted) return;
        try {
          await post(options.config, "ext_invoke_result", result, fetchImpl, options.signal);
        } catch {
          /* the host times this request out; keep serving the rest */
        }
      });
      inFlight.add(dispatch);
      void dispatch.finally(() => inFlight.delete(dispatch));
    }
  }
  return drain();
}

export default function pipiuiExtInvoke(pi: ExtensionAPI): void {
  installRegistry();
  const config = bridgeConfig();
  if (!config) return;
  const controller = new AbortController();
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    void pollLoop({ config, signal: controller.signal });
  };
  pi.on("session_start", () => {
    start();
    return undefined;
  });
  pi.on("session_shutdown", () => {
    controller.abort();
    return undefined;
  });
  // A session resumed from disk may never emit session_start; the panel can ask regardless.
  start();
}
