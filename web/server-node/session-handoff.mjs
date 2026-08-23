/**
 * Setup → play dual-session orchestration for the web RPC host.
 * Detects coc_setup_handoff (primary) or child exit 42 (fallback),
 * then respawns one exclusive pi-coc RPC child for the same campaign.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import {
  HANDOFF_EXIT_CODE,
  parseSetupHandoffEvent,
  PiCocRpcError,
  PiCocRpcHost,
  webSessionId,
} from "./pi-coc-rpc.mjs";

export { HANDOFF_EXIT_CODE };
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

export function isStaleModelCatalogError(error) {
  return /\bModel not found:\s*\S+\/\S+/i.test(String(error?.message || error || ""));
}

/**
 * Consume a terminal turn-processing fault whose typed SSE frame was already
 * delivered by PiCocRpcHost. Returning true tells the HTTP boundary not to
 * write a second generic error frame.
 */
export async function consumeDeliveredTurnProcessingFault({
  error,
  campaignId,
  expectedHost,
  orchestrator,
} = {}) {
  if (error?.kind !== "pi_coc_turn_processing_fault") return false;
  await orchestrator.retireExactHost(campaignId, expectedHost);
  return true;
}

export function inferSessionRole({ tableIntent, afterHandoff } = {}) {
  if (afterHandoff) return "play";
  if (tableIntent === "character-setup") return "setup";
  if (tableIntent === "continue") return "play";
  return null;
}

export function parseSessionRoleStdout(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    const role = obj.role || obj.session_role;
    if (role === "play" || role === "setup") return role;
  } catch {
    /* fall through to last token */
  }
  const last = raw.split(/\s+/).pop();
  if (last === "play" || last === "setup") return last;
  if (/\bplay\b/.test(raw)) return "play";
  if (/\bsetup\b/.test(raw)) return "setup";
  return null;
}

export function defaultResolveSessionRole({ workspace, campaignId, repoRoot }) {
  return new Promise((resolve) => {
    const root = repoRoot || workspace || ".";
    const script = path.join(root, "plugins", "coc-keeper", "scripts", "coc_session_role.py");
    const child = spawn(
      "uv",
      ["run", "--frozen", "python", script, workspace || root, campaignId],
      { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      out += chunk;
    });
    child.on("error", () => resolve(null));
    child.on("close", () => resolve(parseSessionRoleStdout(out)));
  });
}

export class CampaignHostOrchestrator {
  constructor({
    createHost = (hostOpts) => new PiCocRpcHost(hostOpts),
    attachFn,
    resolveRoleFn,
  } = {}) {
    this.hosts = new Map();
    this.#status = new Map();
    this.#handoffPromises = new Map();
    this.#recoveryPromises = new Map();
    this.#retirementPromises = new Map();
    this.createHost = createHost;
    // The play child's welcome hook owns its one resume-first continuation.
    // Handoff/recovery only attaches to that turn; issuing another prompt here
    // would race or duplicate session.resume.
    this.attachFn = attachFn || ((host, opts) => host.attachOpening(opts));
    this.resolveRoleFn = resolveRoleFn || defaultResolveSessionRole;
    this.lastHandoff = new Map();
    this.#listeners = new Set();
  }

  #status;
  #handoffPromises;
  #recoveryPromises;
  #retirementPromises;
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
      // The setup child emits the primary handoff event before its delayed
      // exit-42 fallback. Once that exact host has been replaced, neither its
      // late exit nor any other stale signal may start a second respawn.
      if (this.hosts.get(campaignId) !== host) return;
      const handoff = parseSetupHandoffEvent(event);
      if (handoff) {
        // Respawn immediately, but do not consume the play opening here: the
        // still-open HTTP turn must receive that narration on its own SSE.
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
    const retirement = this.#retirementPromises.get(campaignId);
    if (retirement) {
      const retired = await retirement.promise;
      if (!retired) throw transitioningInputError();
      // Re-read campaign ownership after the shared close settles. Another
      // waiter may already have installed the one replacement.
      return this.acquire(campaignId, hostOpts, { exclusive, reuse });
    }
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

  /**
   * Retire only the poisoned child that raised a terminal turn-processing
   * fault. A concurrently installed replacement is never closed or removed.
   */
  async retireExactHost(campaignId, expectedHost) {
    const inflight = this.#retirementPromises.get(campaignId);
    if (inflight) {
      return inflight.host === expectedHost ? inflight.promise : false;
    }
    if (!expectedHost || this.hosts.get(campaignId) !== expectedHost) {
      return false;
    }
    expectedHost.expectedShutdown = true;
    this.#setStatus(campaignId, { transitioning: true });
    this.#emitTransition(campaignId, { reason: "terminal_fault_retiring" });
    const record = { host: expectedHost, promise: null };
    record.promise = (async () => {
      try {
        await expectedHost.close?.({ protocolAbort: false });
      } catch (error) {
        // Keep the poisoned identity registered and the transition fence
        // closed. Process exit plus stdio settlement was not confirmed, so a
        // later acquire must not overlap it with a replacement child.
        this.#emitTransition(campaignId, {
          reason: "terminal_fault_retirement_failed",
          error: String(error?.message || error),
        });
        return false;
      }
      if (this.hosts.get(campaignId) === expectedHost) {
        this.hosts.delete(campaignId);
        this.#setStatus(campaignId, { transitioning: false });
        this.#emitTransition(campaignId, { reason: "terminal_fault_retired" });
      }
      if (this.#retirementPromises.get(campaignId) === record) {
        this.#retirementPromises.delete(campaignId);
      }
      return true;
    })();
    this.#retirementPromises.set(campaignId, record);
    return record.promise;
  }

  /**
   * Pi snapshots models.json when the RPC child starts. If the UI adds a
   * provider/model later, set_model cannot see it until that same campaign
   * host is replaced. Preserve the session id and role, close exactly one
   * owned child, and start its replacement with the selected model.
   */
  async restartForModel(campaignId, { provider, model, thinking } = {}) {
    const old = this.hosts.get(campaignId);
    if (!old || old.closed) throw new Error(`战役 ${campaignId} 没有可重启的活跃宿主。`);
    if (this.isTransitioning(campaignId)) throw transitioningInputError();
    const currentRole = this.statusOf(campaignId).session_role;
    const tableIntent = currentRole === "setup" ? "character-setup" : "continue";
    this.#setStatus(campaignId, { transitioning: true });
    this.#emitTransition(campaignId, { reason: "model_catalog_refresh" });
    try {
      const opts = {
        repoRoot: old.repoRoot,
        workspace: old.workspace,
        campaignId,
        sessionId: old.sessionId,
        agentDir: old.agentDir,
        launcherPath: old.launcherPath,
        tableIntent,
        provider: String(provider || old.provider || ""),
        model: String(model || old.model || ""),
        thinking: String(thinking || old.thinking || ""),
        spawnFn: old.spawnFn,
      };
      old.expectedShutdown = true;
      await old.close();
      this.hosts.delete(campaignId);
      const { host } = await this.acquire(
        campaignId,
        opts,
        { exclusive: true, reuse: false },
      );
      this.#setStatus(campaignId, {
        session_role: currentRole || inferSessionRole({ tableIntent }),
        transitioning: false,
      });
      this.#emitTransition(campaignId, { reason: "model_catalog_refreshed" });
      return host;
    } catch (error) {
      this.#setStatus(campaignId, { transitioning: false });
      this.#emitTransition(campaignId, {
        reason: "model_catalog_refresh_failed",
        error: String(error?.message || error),
      });
      throw error;
    }
  }

  /**
   * Replace one stalled child while preserving its exact session id, then let
   * the new process recover the durable pending turn through session.resume.
   * The original player input is never accepted as an argument here.
   */
  async recoverStalledTurn(campaignId, { onSse, recoveryDiagnostic = null } = {}) {
    const handoff = this.#handoffPromises.get(campaignId);
    if (handoff) {
      const host = await handoff;
      return { host, promptResult: { handoff: true } };
    }
    const inflight = this.#recoveryPromises.get(campaignId);
    if (inflight) return inflight.promise;
    const record = { promise: null, handoffRequest: null };
    const run = this.#runStalledTurnRecovery(
      campaignId,
      { onSse, recoveryDiagnostic },
      record,
    );
    record.promise = run;
    this.#recoveryPromises.set(campaignId, record);
    try {
      return await run;
    } finally {
      if (this.#recoveryPromises.get(campaignId) === record) {
        this.#recoveryPromises.delete(campaignId);
      }
    }
  }

  async #runStalledTurnRecovery(
    campaignId,
    { onSse, recoveryDiagnostic = null } = {},
    record,
  ) {
    const old = this.hosts.get(campaignId);
    if (!old) {
      throw new PiCocRpcError(`campaign ${campaignId} has no recoverable host`, {
        kind: "pi_coc_rpc_recovery_failed",
      });
    }
    const currentRole = this.statusOf(campaignId).session_role;
    const tableIntent = currentRole === "setup" ? "character-setup" : "continue";
    let replacement = null;
    this.#setStatus(campaignId, { transitioning: true });
    this.#emitTransition(campaignId, {
      reason: "provider_idle_recovery",
      diagnostic: recoveryDiagnostic,
    });
    try {
      await old.waitForAbortSettlement?.(2_000);
      if (record.handoffRequest) {
        const host = await this.#runHandoff(campaignId, record.handoffRequest);
        return { host, promptResult: { handoff: true } };
      }
      const opts = {
        repoRoot: old.repoRoot,
        workspace: old.workspace,
        campaignId,
        sessionId: old.sessionId,
        agentDir: old.agentDir,
        launcherPath: old.launcherPath,
        tableIntent,
        provider: old.provider,
        model: old.model,
        thinking: old.thinking,
        spawnFn: old.spawnFn,
        turnIdleTimeoutMs: old.turnIdleTimeoutMs,
        nowFn: old.nowFn,
      };
      old.expectedShutdown = true;
      await old.close({ protocolAbort: false });
      if (record.handoffRequest) {
        const host = await this.#runHandoff(campaignId, record.handoffRequest);
        return { host, promptResult: { handoff: true } };
      }
      this.hosts.delete(campaignId);
      const { host } = await this.acquire(
        campaignId,
        opts,
        { exclusive: true, reuse: false },
      );
      replacement = host;
      this.#setStatus(campaignId, {
        session_role: currentRole || inferSessionRole({ tableIntent }),
        transitioning: true,
      });
      const promptResult = await host.attachOpening({
        onSse,
        requireVisibleText: true,
      });
      this.#setStatus(campaignId, {
        session_role: currentRole || inferSessionRole({ tableIntent }),
        transitioning: false,
      });
      this.#emitTransition(campaignId, { reason: "provider_idle_recovered" });
      return { host, promptResult };
    } catch (error) {
      if (replacement && this.hosts.get(campaignId) === replacement) {
        replacement.expectedShutdown = true;
        try {
          await replacement.close();
        } catch {
          /* keep the exact unconfirmed child registered and non-accepting */
        }
        if (replacement.closed && this.hosts.get(campaignId) === replacement) {
          this.hosts.delete(campaignId);
        }
      }
      const current = this.hosts.get(campaignId);
      this.#setStatus(campaignId, {
        transitioning: Boolean(current && !current.closed),
      });
      this.#emitTransition(campaignId, {
        reason: "provider_idle_recovery_failed",
        error: String(error?.message || error),
      });
      if (error instanceof PiCocRpcError) throw error;
      throw new PiCocRpcError(
        `pi-coc stalled-turn recovery failed: ${error?.message || error}`,
        { kind: "pi_coc_rpc_recovery_failed" },
      );
    }
  }

  async beginHandoff(campaignId, { reason, handoff } = {}) {
    const recovery = this.#recoveryPromises.get(campaignId);
    if (recovery) {
      if (!recovery.handoffRequest) {
        recovery.handoffRequest = { reason, handoff };
      }
      if (handoff) this.lastHandoff.set(campaignId, handoff);
      return recovery.promise.then((result) => result.host);
    }
    const inflight = this.#handoffPromises.get(campaignId);
    if (inflight) return inflight;
    const existing = this.hosts.get(campaignId);
    if (!existing && !this.#status.has(campaignId)) return null;
    const run = this.#runHandoff(campaignId, { reason, handoff });
    this.#handoffPromises.set(campaignId, run);
    try {
      return await run;
    } finally {
      this.#handoffPromises.delete(campaignId);
    }
  }

  async completeHandoffOpening(campaignId, { reason, handoff, onSse } = {}) {
    let host;
    const inflight = this.#handoffPromises.get(campaignId);
    if (inflight) {
      host = await inflight;
    } else {
      const row = this.#status.get(campaignId);
      const current = this.hosts.get(campaignId);
      const alreadyRespawned = Boolean(
        row?.transitioning
        && row?.session_role === "play"
        && current
        && !current.closed,
      );
      host = alreadyRespawned
        ? current
        : await this.beginHandoff(campaignId, { reason, handoff });
    }
    if (!host || host.closed) {
      throw this.#handoffError(new Error("开桌宿主未启动。"));
    }
    const row = this.#status.get(campaignId);
    if (row?.openingAttached && !row.transitioning) return host;
    try {
      await this.attachFn(host, {
        onSse,
        requireVisibleText: true,
      });
    } catch (err) {
      this.#setStatus(campaignId, { transitioning: false });
      this.#emitTransition(campaignId, { reason: "failed", error: String(err) });
      throw this.#handoffError(err);
    }
    this.#setStatus(campaignId, {
      session_role: "play",
      transitioning: false,
      openingAttached: true,
    });
    this.#emitTransition(campaignId, { reason: "opening_visible" });
    return host;
  }

  #handoffError(err) {
    if (err?.code === "session_handoff_failed") return err;
    const detail = String(err?.message || err || "未知错误");
    const wrapped = new Error(`建卡到开桌交接失败：${detail}`);
    wrapped.code = "session_handoff_failed";
    wrapped.cause = err;
    return wrapped;
  }

  async #runHandoff(campaignId, { reason, handoff } = {}) {
    this.#setStatus(campaignId, { transitioning: true });
    if (handoff) this.lastHandoff.set(campaignId, handoff);
    this.#emitTransition(campaignId, { reason, handoff: handoff || null });
    try {
      const old = this.hosts.get(campaignId);
      let judged = null;
      try {
        judged = await this.resolveRoleFn({
          workspace: old?.workspace,
          campaignId,
          repoRoot: old?.repoRoot,
        });
      } catch {
        judged = null;
      }
      const sessionRole = judged === "setup" ? "setup" : "play";
      const opts = old
        ? {
            repoRoot: old.repoRoot,
            workspace: old.workspace,
            campaignId,
            sessionId: old.sessionId,
            agentDir: old.agentDir,
            launcherPath: old.launcherPath,
            tableIntent: sessionRole === "play" ? "continue" : "character-setup",
            provider: old.provider,
            model: old.model,
            thinking: old.thinking,
            spawnFn: old.spawnFn,
            turnIdleTimeoutMs: old.turnIdleTimeoutMs,
            nowFn: old.nowFn,
          }
        : { campaignId, tableIntent: sessionRole === "play" ? "continue" : "character-setup" };
      if (old) {
        old.expectedShutdown = true;
        await old.close();
      }
      this.hosts.delete(campaignId);
      const { host } = await this.acquire(campaignId, opts, { exclusive: true, reuse: false });
      this.#setStatus(campaignId, {
        session_role: sessionRole,
        transitioning: true,
        openingAttached: false,
      });
      this.#emitTransition(campaignId, { reason: "respawned" });
      return host;
    } catch (err) {
      this.#setStatus(campaignId, { transitioning: false });
      this.#emitTransition(campaignId, { reason: "failed", error: String(err) });
      throw this.#handoffError(err);
    }
  }
}

export function createOrchestrator(opts) {
  return new CampaignHostOrchestrator(opts);
}
