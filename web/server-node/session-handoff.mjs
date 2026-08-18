/**
 * Setup → play dual-session orchestration for the web RPC host.
 * Detects coc_setup_handoff (primary) or child exit 42 (fallback),
 * then respawns one exclusive pi-coc RPC child for the same campaign.
 */
import {
  parseSetupHandoffEvent,
  PiCocRpcHost,
  webSessionId,
} from "./pi-coc-rpc.mjs";

export const HANDOFF_EXIT_CODE = 42;
export const SESSION_TRANSITIONING_CODE = "session_transitioning";
export const SESSION_BUSY_CODE = "session_host_busy";

export function transitioningInputError() {
  const err = new Error("战役正在从建卡会话切换到开桌会话，请稍候。");
  err.code = SESSION_TRANSITIONING_CODE;
  err.status = 409;
  return err;
}

export function hostBusyError(campaignId) {
  const err = new Error(`战役 ${campaignId} 已有活跃宿主，不能并行再开一个。`);
  err.code = SESSION_BUSY_CODE;
  err.status = 409;
  return err;
}

export function inferSessionRole({ tableIntent, afterHandoff } = {}) {
  if (afterHandoff) return "play";
  if (tableIntent === "character-setup") return "setup";
  if (tableIntent === "continue") return "play";
  return null;
}

export class CampaignHostOrchestrator {
  constructor({
    createHost = (opts) => new PiCocRpcHost(opts),
    attachFn,
  } = {}) {
    this.hosts = new Map();
    this.#status = new Map();
    this.#handoffInFlight = new Set();
    this.createHost = createHost;
    this.attachFn = attachFn || ((host) => host.attachOpening());
    this.lastHandoff = new Map();
    this.#listeners = new Set();
  }

  #status;
  #handoffInFlight;
  #listeners;

  onTransition(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emitTransition(campaignId, extra = {}) {
    const status = this.statusOf(campaignId);
    for (const listener of this.#listeners) {
      try {
        listener({ campaignId, ...status, ...extra });
      } catch {
        /* ignore */
      }
    }
  }

  statusOf(campaignId) {
    const row = this.#status.get(campaignId);
    return {
      session_role: row?.session_role ?? null,
      transitioning: Boolean(row?.transitioning),
    };
  }

  getHost(campaignId) {
    return this.hosts.get(campaignId) || null;
  }

  isTransitioning(campaignId) {
    return this.statusOf(campaignId).transitioning;
  }

  assertAcceptsPlayerInput(campaignId) {
    if (this.isTransitioning(campaignId)) throw transitioningInputError();
  }

  #setStatus(campaignId, patch) {
    const prev = this.#status.get(campaignId) || {
      session_role: null,
      transitioning: false,
    };
    this.#status.set(campaignId, { ...prev, ...patch });
  }

  #bind(campaignId, host) {
    host.onEvent((event) => {
      const handoff = parseSetupHandoffEvent(event);
      if (handoff) {
        this.beginHandoff(campaignId, { reason: "event", handoff }).catch(() => {});
        return;
      }
      if (event?.type === "process_exit" && event.code === HANDOFF_EXIT_CODE) {
        this.beginHandoff(campaignId, { reason: "exit_42" }).catch(() => {});
      }
    });
  }

  /**
   * Spawn or reuse the single host for a campaign.
   * `exclusive: true` (default) rejects a second live child.
   */
  async acquire(campaignId, hostOpts = {}, { exclusive = true, reuse = true } = {}) {
    const existing = this.hosts.get(campaignId);
    if (existing && !existing.closed) {
      if (reuse) return { host: existing, spawned: false };
      if (exclusive) throw hostBusyError(campaignId);
    }
    if (exclusive && existing && !existing.closed) {
      throw hostBusyError(campaignId);
    }
    const host = this.createHost({
      campaignId,
      sessionId: hostOpts.sessionId || webSessionId(campaignId),
      tableIntent: hostOpts.tableIntent,
      ...hostOpts,
    });
    this.hosts.set(campaignId, host);
    const keepTransition = this.isTransitioning(campaignId);
    this.#setStatus(campaignId, {
      session_role: inferSessionRole({
        tableIntent: hostOpts.tableIntent,
        afterHandoff: keepTransition,
      }),
      transitioning: keepTransition,
    });
    this.#bind(campaignId, host);
    try {
      if (typeof host.waitUntilReady === "function") {
        await host.waitUntilReady();
      }
    } catch (err) {
      this.hosts.delete(campaignId);
      try {
        await host.close?.();
      } catch {
        /* spawn failed */
      }
      throw err;
    }
    return { host, spawned: true };
  }

  async closeHost(campaignId) {
    const host = this.hosts.get(campaignId);
    if (!host) return;
    this.hosts.delete(campaignId);
    try {
      await host.close?.();
    } catch {
      /* already gone */
    }
  }

  async beginHandoff(campaignId, { reason, handoff } = {}) {
    if (this.#handoffInFlight.has(campaignId)) return this.lastHandoff.get(campaignId);
    const existing = this.hosts.get(campaignId);
    if (!existing && !this.#status.has(campaignId)) return null;
    this.#handoffInFlight.add(campaignId);
    this.#setStatus(campaignId, { transitioning: true });
    if (handoff) this.lastHandoff.set(campaignId, handoff);
    this.#emitTransition(campaignId, { reason, handoff: handoff || null });
    try {
      const old = this.hosts.get(campaignId);
      const opts = old
        ? {
            repoRoot: old.repoRoot,
            workspace: old.workspace,
            campaignId,
            sessionId: old.sessionId,
            agentDir: old.agentDir,
            launcherPath: old.launcherPath,
            tableIntent: "continue",
            provider: old.provider,
            model: old.model,
            thinking: old.thinking,
            spawnFn: old.spawnFn,
          }
        : { campaignId, tableIntent: "continue" };
      if (old && !old.closed) {
        await old.close();
      }
      this.hosts.delete(campaignId);
      const { host } = await this.acquire(campaignId, opts, { exclusive: true, reuse: false });
      try {
        await this.attachFn(host);
      } catch {
        /* attach is best-effort; host is already ready */
      }
      this.#setStatus(campaignId, { session_role: "play", transitioning: false });
      this.#emitTransition(campaignId, { reason: "attached" });
      return host;
    } catch (err) {
      this.#setStatus(campaignId, { transitioning: false });
      this.#emitTransition(campaignId, { reason: "failed", error: String(err) });
      throw err;
    } finally {
      this.#handoffInFlight.delete(campaignId);
    }
  }
}

export function createOrchestrator(opts) {
  return new CampaignHostOrchestrator(opts);
}
