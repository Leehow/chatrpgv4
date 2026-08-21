/**
 * Product turn channel for the web/Electron UI: one `pi-coc --mode rpc`
 * child per campaign. The browser is the attached player surface of that
 * host — not a second Keeper shell.
 *
 * Framing follows Pi RPC JSONL (LF only). Do not use Node readline.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import {
  lastVisibleAssistantText,
  pickHostedSessionAgentDir,
  SETUP_CHARACTER_OPENING_MARKER,
} from "./pi-session-text.mjs";

export { SETUP_CHARACTER_OPENING_MARKER, isHiddenSetupOpeningPrompt } from "./pi-session-text.mjs";

export const UI_AUTO_OPEN_MARKER = "[coc-pi-ui] auto-open";
export const UI_IDLE_MARKER = "[coc-pi-ui] idle";
/** Setup session exit that means re-exec as play (pi-coc launcher contract). */
export const HANDOFF_EXIT_CODE = 42;

// Pi extensions may schedule a hidden follow-up from an `agent_end` callback.
// RPC emits `agent_settled` before that callback's queued turn emits its next
// `agent_start`, so treating the first settled frame as terminal briefly makes
// the browser editable while the same host is already starting more work.
// Keep the stream open across that micro-gap and close only after a short,
// genuinely idle window.
export const AGENT_SETTLE_QUIESCENCE_MS = 100;

/** Host-owned continuation for a respawned play RPC child. */
export const PLAY_TABLE_OPENING_PROMPT = [
  "Host continuation after setup.complete / ready_for_table handoff.",
  "You are the play-role Keeper for this already-selected campaign.",
  "First call session.resume on this campaign.",
  "If coc_evidence_table_opening remains visible after resume, call it and",
  "deliver only the player-visible formal opening from that receipt.",
  "If that typed tool is absent, the opening is already persisted: do not call",
  "or replay it; wait for the player or continue the buffered player action.",
  "Do not invent opening text. Do not ask the player to choose a campaign.",
].join(" ");

/**
 * Host-owned character-setup opener when extension auto-open stays silent.
 * Fresh Web bind (`status=setup`, no investigator) still owns a canonical
 * campaign generation. Resume is the single authority for whether source
 * review/adoption or character creation comes next.
 * Reopen of an already-played generation uses PLAY_TABLE_OPENING_PROMPT.
 * Prefix hides this user prompt from player-visible session hydration.
 */
export function setupCharacterOpeningPrompt({ campaignId, workspace } = {}) {
  const id = String(campaignId || "");
  const root = String(workspace || ".");
  return [
    SETUP_CHARACTER_OPENING_MARKER,
    "This selected campaign has no playable investigator yet.",
    "Do not ask the player to activate COC.",
    "The campaign is already selected in this host request.",
    "Fixed opening sequence, no other campaign calls in between: first",
    JSON.stringify({
      tool: "coc_session_resume",
      arguments: { root, campaign: id },
    }),
    "then follow error.details.next_operation exactly when resume reports the",
    "source-review/adoption gate. Do not call investigator_contract until the",
    "adoption receipt says character_creation_unblocked=true. Once unblocked,",
    "call coc_setup_investigator_contract for this campaign and read its exact",
    "character_creation.briefing_path once (no find/ls/glob), if one exists.",
    "Do NOT call setup.inspect, coc_discover, OCR, or another campaign probe.",
    "Emit no player-visible text until every opening tool call above is done;",
    "stay completely silent between tool calls.",
    "Your player-visible reply must be immersive coc-character guidance ending in",
    "exactly one concrete character-creation question (e.g. concept or name).",
    "Never narrate your workflow. Do not describe this instruction.",
    "Do not paste module body into the player-visible reply.",
  ].join(" ");
}

export function isHandoffExit(code) {
  return Number(code) === HANDOFF_EXIT_CODE;
}

/** Prefer the fatal Error line so a leading warning is not the headline. */
export function summarizeRpcDeath(stderr) {
  const text = String(stderr || "").trim();
  if (!text) return "pi-coc RPC died before ready";
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const errorLine = [...lines].reverse().find((line) => /^Error:/.test(line));
  const snippet = (errorLine || text).slice(0, 800);
  return `pi-coc RPC died before ready: ${snippet}`;
}

const DEFAULT_REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

export function webSessionId(campaignId) {
  const safe = String(campaignId || "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `web-${safe || "campaign"}`;
}

export function resolvePiCocLauncher(repoRoot = DEFAULT_REPO_ROOT) {
  return path.join(repoRoot, "plugins", "coc-keeper", "pi", "bin", "pi-coc");
}

export function resolvePiBinDir(repoRoot = DEFAULT_REPO_ROOT) {
  const candidates = [
    path.join(
      repoRoot,
      "runtime",
      "adapters",
      "keeper",
      "node_modules",
      ".bin",
    ),
    path.join(
      repoRoot,
      "runtime",
      "adapters",
      "keeper",
      "node_modules",
      "@earendil-works",
      "pi-coding-agent",
    ),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "pi"))) return dir;
    if (fs.existsSync(path.join(dir, "dist", "cli.js"))) return dir;
  }
  return null;
}

export function resolvePiCliJs(repoRoot = DEFAULT_REPO_ROOT) {
  const candidate = path.join(
    repoRoot,
    "runtime",
    "adapters",
    "keeper",
    "node_modules",
    "@earendil-works",
    "pi-coding-agent",
    "dist",
    "cli.js",
  );
  return fs.existsSync(candidate) ? candidate : null;
}

/**
 * Authoritative table intent from the campaign's `opening_phase` projection
 * (the plugin's derive_opening_phase / coc_session_role.py authority).
 * Returns null when the projection is unavailable so the caller can ask
 * coc_session_role.py directly — never investigator-file scanning.
 */
export function tableIntentFromOpeningPhase(openingPhase) {
  const role =
    openingPhase && typeof openingPhase === "object"
      ? openingPhase.session_role
      : null;
  if (role === "play") return "continue";
  if (role === "setup") return "character-setup";
  return null;
}

/**
 * Frontend attach hints for one session bind. `character_setup` is true only
 * when the authoritative opening phase says `character_creation`; when the
 * projection is unavailable the coc_session_role-derived tableIntent decides.
 * Investigator-file existence never enters this decision.
 */
export function sessionOpeningFlags({ spawned, phase, tableIntent } = {}) {
  const characterSetup =
    phase != null
      ? phase === "character_creation"
      : tableIntent === "character-setup";
  return {
    character_setup: characterSetup,
    host_opening: Boolean(spawned),
  };
}

export function buildPiCocArgs({ campaignId, sessionId, provider, model, thinking }) {
  const args = ["--mode", "rpc", "--session-id", sessionId];
  if (campaignId) args.push("--campaign", String(campaignId));
  if (provider) args.push("--provider", String(provider));
  if (model) args.push("--model", String(model));
  if (thinking) args.push("--thinking", String(thinking));
  return args;
}

export function buildChildEnv({
  workspace,
  repoRoot = DEFAULT_REPO_ROOT,
  campaignId,
  sessionId,
  agentDir,
  tableIntent,
  parentEnv = process.env,
}) {
  const env = { ...parentEnv };
  env.COC_WORKSPACE = path.resolve(workspace);
  const hostedAgentDir = pickHostedSessionAgentDir({
    workspace: env.COC_WORKSPACE,
    agentDir: agentDir || env.PI_AGENT_DIR || "",
    sessionId,
  });
  if (hostedAgentDir) {
    env.PI_AGENT_DIR = hostedAgentDir;
    if (!(env.PI_CODING_AGENT_DIR || "").trim()) {
      env.PI_CODING_AGENT_DIR = hostedAgentDir;
    }
  }
  env.COC_PI_ATTACHED_UI = "1";
  env.COC_PI_SCENE_SUPPLY = env.COC_PI_SCENE_SUPPLY || "1";
  env.COC_HOST = "pi";
  if (campaignId) env.PI_COC_CAMPAIGN_ID = String(campaignId);
  // server-node orchestrates setup→play; do not let the launcher re-exec.
  env.COC_PI_NO_REEXEC = "1";
  if (tableIntent === "character-setup" || tableIntent === "continue") {
    env.COC_PI_TABLE_INTENT = tableIntent;
  }
  const piBin = resolvePiBinDir(repoRoot);
  if (piBin) {
    env.PATH = piBin + path.delimiter + (env.PATH || "");
  }
  // Pin the keeper-bundled CLI. pi-coc still prefers PATH `pi` first, so we
  // also prepend keeper .bin above; COC_PI_CLI wins only when PATH has no pi.
  const cliJs = resolvePiCliJs(repoRoot);
  if (cliJs) {
    env.COC_PI_CLI = cliJs;
  }
  return env;
}

export function createJsonlParser(onObject) {
  let buffer = "";
  return {
    push(chunk) {
      buffer += String(chunk);
      let idx;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        let line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (!line) continue;
        let parsed;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }
        if (parsed && typeof parsed === "object") onObject(parsed);
      }
    },
  };
}

function toolLabel(event) {
  const name = typeof event.toolName === "string" ? event.toolName : "";
  const args = event.args && typeof event.args === "object" ? event.args : {};
  if (name === "coc_invoke" && typeof args.operation === "string" && args.operation) {
    return args.operation;
  }
  if (name === "bash") {
    const command = typeof args.command === "string" ? args.command : "";
    const match = command.match(/coc_toolbox\.py\s+([A-Za-z0-9_.-]+)/);
    return match ? match[1] : "shell";
  }
  if (typeof args.operation === "string" && args.operation) {
    return `${name}:${args.operation}`;
  }
  return name || "tool";
}

export function parseSetupHandoffEvent(event) {
  if (!event || typeof event !== "object") return null;
  const blobs = [];
  if (event.type === "coc_setup_handoff" || event.customType === "coc_setup_handoff") {
    blobs.push(event);
  }
  if (event.details && typeof event.details === "object") blobs.push(event.details);
  if (typeof event.content === "string" && event.content.trim().startsWith("{")) {
    try {
      blobs.push(JSON.parse(event.content));
    } catch {
      /* ignore */
    }
  }
  const custom =
    event.type === "custom_message"
    && (event.customType === "coc_setup_handoff"
      || event.details?.type === "coc_setup_handoff");
  if (!custom && event.type !== "coc_setup_handoff") {
    const fromBlob = blobs.find((b) => b && b.type === "coc_setup_handoff");
    if (!fromBlob) return null;
  }
  const src = blobs.find((b) => b && (b.type === "coc_setup_handoff" || b.campaign_id))
    || event;
  if (src.type !== "coc_setup_handoff" && event.customType !== "coc_setup_handoff" && !custom) {
    return null;
  }
  return {
    type: "coc_setup_handoff",
    campaign_id: src.campaign_id ?? event.campaign_id ?? null,
    receipt: src.receipt ?? event.receipt ?? null,
    at: src.at ?? event.at ?? null,
  };
}

function toolEventFrame(phase, event) {
  const data = { phase, tool: toolLabel(event) };
  // Pi core keeps this id on the execution event even when parallel calls end
  // out of order. Older event producers omit it; their SSE shape is unchanged.
  if (typeof event.toolCallId === "string" && event.toolCallId) {
    data.tool_call_id = event.toolCallId;
  }
  // Scheduler receipts are host-only telemetry. Do not leak queue/execution
  // metadata into the player-facing SSE stream.
  return { event: "tool", data };
}

function containsOpeningSourceReviewGate(value, depth = 0) {
  if (depth > 8 || value == null) return false;
  if (typeof value === "string") {
    const text = value.trim();
    if (!text.startsWith("{") && !text.startsWith("[")) return false;
    try {
      return containsOpeningSourceReviewGate(JSON.parse(text), depth + 1);
    } catch {
      return false;
    }
  }
  if (Array.isArray(value)) {
    return value.some((item) => containsOpeningSourceReviewGate(item, depth + 1));
  }
  if (typeof value !== "object") return false;
  if (value.phase === "opening_source_review_required") return true;
  return Object.values(value).some((item) => containsOpeningSourceReviewGate(item, depth + 1));
}

export function mapRpcEventToSse(event) {
  if (!event || typeof event !== "object") return [];
  const handoff = parseSetupHandoffEvent(event);
  if (handoff) {
    return [{ event: "coc_setup_handoff", data: handoff }];
  }
  if (event.type === "process_exit" && isHandoffExit(event.code)) {
    return [{
      event: "coc_setup_handoff",
      data: {
        type: "coc_setup_handoff",
        campaign_id: event.campaign_id ?? null,
        reason: "exit_42",
        at: Date.now(),
      },
    }];
  }
  const type = event.type;
  if (type === "message_update") {
    const out = [];
    const usage = event.usage;
    if (usage && typeof usage === "object") {
      out.push({
        event: "usage",
        data: {
          input: Number.isInteger(usage.input) ? usage.input : null,
          output: Number.isInteger(usage.output) ? usage.output : null,
        },
      });
    }
    const ame = event.assistantMessageEvent;
    if (ame && typeof ame === "object") {
      if (ame.type === "text_delta" && typeof ame.delta === "string" && ame.delta) {
        const text = stripPlayerEnvelopeMarkers(ame.delta);
        if (text) out.push({ event: "delta", data: { text } });
      } else if (
        ame.type === "thinking_delta"
        && typeof ame.delta === "string"
        && ame.delta
      ) {
        out.push({ event: "thinking", data: { text: ame.delta } });
      }
    }
    return out;
  }
  if (type === "message_end") {
    const message = event.message;
    if (!message || message.role !== "assistant") return [];
    const text = Array.isArray(message.content)
      ? message.content
        .filter((part) => part?.type === "text" && typeof part.text === "string")
        .map((part) => part.text)
        .join("")
      : typeof message.content === "string"
        ? message.content
        : "";
    // A keeper-only follow-up may contain thinking/tool work but no
    // player-visible text. It must not erase the completed narration emitted
    // by the preceding lifecycle turn.
    const visibleText = stripPlayerEnvelopeMarkers(text).trim();
    if (!visibleText) return [];
    return [
      { event: "delta_reset", data: {} },
      { event: "delta", data: { text: visibleText } },
    ];
  }
  if (type === "tool_execution_start") {
    return [toolEventFrame("start", event)];
  }
  if (type === "tool_execution_end") {
    return [toolEventFrame("end", event)];
  }
  if (type === "agent_end") {
    // pi settles a turn even when the model call failed (stopReason "error");
    // without this mapping the player sees a silent no-op (E2E finding F3).
    if (event.willRetry) return [];
    const messages = Array.isArray(event.messages) ? event.messages : [];
    const lastAssistant = [...messages]
      .reverse()
      .find((message) => message?.role === "assistant");
    if (!lastAssistant) return [];
    if (lastAssistant.stopReason === "error" || lastAssistant.stopReason === "aborted") {
      const detail = String(lastAssistant.errorMessage || "").trim();
      return [{
        event: "error",
        data: {
          message: detail
            ? `pi 模型调用失败：${detail.slice(0, 300)}`
            : `pi 模型调用中止（stopReason=${lastAssistant.stopReason}）`,
        },
      }];
    }
    return [];
  }
  return [];
}

function stripPlayerEnvelopeMarkers(text) {
  return String(text || "").replace(/\[\/?in_game\]/gi, "");
}

export class PiCocRpcError extends Error {
  constructor(message, { kind = "pi_coc_rpc_failed" } = {}) {
    super(message);
    this.name = "PiCocRpcError";
    this.kind = kind;
  }
}

export class PiCocRpcHost {
  constructor({
    repoRoot = DEFAULT_REPO_ROOT,
    workspace,
    campaignId,
    sessionId,
    agentDir,
    launcherPath,
    tableIntent,
    provider,
    model,
    thinking,
    spawnFn = spawn,
  }) {
    this.repoRoot = repoRoot;
    this.workspace = path.resolve(workspace);
    this.campaignId = campaignId;
    this.sessionId = sessionId || webSessionId(campaignId);
    this.agentDir = pickHostedSessionAgentDir({
      workspace: this.workspace,
      agentDir: agentDir || process.env.PI_AGENT_DIR || "",
      sessionId: this.sessionId,
    });
    this.launcherPath = launcherPath || resolvePiCocLauncher(repoRoot);
    this.tableIntent = tableIntent || null;
    this.provider = provider || "";
    this.model = model || "";
    this.thinking = thinking || "";
    this.spawnFn = spawnFn;
    this.child = null;
    this.ready = false;
    this.closed = false;
    this.streaming = false;
    this.settleGeneration = 0;
    this.lastSettledAt = 0;
    this.abortGeneration = 0;
    this.uiIntent = null; // "auto-open" | "idle" | null
    this.lastUsage = null;
    this.#pending = new Map();
    this.#listeners = new Set();
    this.#stderr = "";
    this.#eventLog = [];
    this.lastExitCode = null;
    this.expectedShutdown = false;
    this.openingSourceReviewPending = false;
    this.#setupOpeningPrompted = false;
  }

  isHandoffShutdown() {
    return this.expectedShutdown || isHandoffExit(this.lastExitCode);
  }

  #pending;
  #listeners;
  #stderr;
  #eventLog;
  #setupOpeningPrompted;

  get openingIntent() {
    return this.uiIntent;
  }

  onEvent(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #replaySse(onSse) {
    let opened = false;
    for (const event of this.#eventLog) {
      for (const frame of mapRpcEventToSse(event)) {
        onSse?.(frame);
        opened = true;
      }
      if (event?.type === "agent_settled") opened = true;
    }
    return opened;
  }

  #replaySessionAssistant(onSse) {
    const text = stripPlayerEnvelopeMarkers(lastVisibleAssistantText({
      agentDir: this.agentDir,
      sessionId: this.sessionId,
    })).trim();
    if (!text) return false;
    onSse?.({ event: "delta", data: { text } });
    return true;
  }

  #hasRecordedVisibleOpening() {
    let visibleText = "";
    for (const event of this.#eventLog) {
      for (const frame of mapRpcEventToSse(event)) {
        if (frame?.event === "delta_reset") visibleText = "";
        if (frame?.event === "delta") visibleText += String(frame.data?.text || "");
      }
    }
    if (visibleText.trim()) return true;
    return Boolean(lastVisibleAssistantText({
      agentDir: this.agentDir,
      sessionId: this.sessionId,
    }));
  }

  async #promptSetupOpeningIfSilent({ onSse, timeoutMs, requireVisibleText, sawVisibleText }) {
    if (this.tableIntent !== "character-setup") return null;
    if (sawVisibleText || this.#hasRecordedVisibleOpening()) return null;
    if (this.#setupOpeningPrompted) return null;
    this.#setupOpeningPrompted = true;
    const message = setupCharacterOpeningPrompt({
      campaignId: this.campaignId,
      workspace: this.workspace,
    });
    const result = await this.prompt(message, { onSse, timeoutMs });
    if (requireVisibleText && !sawVisibleText) {
      // prompt() already streamed via onSse; caller tracks sawVisibleText.
    }
    return { ...result, opened: true, setupOpeningPrompted: true };
  }

  #emit(event) {
    this.#eventLog.push(event);
    if (this.#eventLog.length > 4000) {
      this.#eventLog.splice(0, this.#eventLog.length - 2000);
    }
    if (
      event?.type === "agent_start"
      && this.openingSourceReviewPending
      && this.settleGeneration > 0
    ) {
      this.openingSourceReviewPending = false;
    }
    if (event?.type === "agent_start") {
      this.streaming = true;
      this.lastSettledAt = 0;
    }
    if (event?.type === "agent_settled") {
      this.streaming = false;
      this.settleGeneration += 1;
      this.lastSettledAt = Date.now();
    }
    if (event?.type === "message_update" && event.usage) {
      this.lastUsage = event.usage;
    }
    if (
      event?.type === "tool_execution_end"
      && containsOpeningSourceReviewGate(event.result)
    ) {
      this.openingSourceReviewPending = true;
    }
    if (event?.customType === "coc-opening-source-review-lifecycle") {
      const status = event.data?.status ?? event.details?.status;
      if (status === "submitted") this.openingSourceReviewPending = true;
      else if (typeof status === "string" && status) this.openingSourceReviewPending = false;
    }
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch {
        /* listener faults never fail the host */
      }
    }
    if (event?.type === "response" && event.id && this.#pending.has(event.id)) {
      const pending = this.#pending.get(event.id);
      this.#pending.delete(event.id);
      if (event.success === false) {
        pending.reject(
          new PiCocRpcError(event.error || `RPC ${event.command} failed`, {
            kind: "pi_coc_rpc_rejected",
          }),
        );
      } else {
        pending.resolve(event);
      }
    }
  }

  #noteStderr(chunk) {
    const text = String(chunk);
    this.#stderr += text;
    if (this.#stderr.length > 64 * 1024) {
      this.#stderr = this.#stderr.slice(-32 * 1024);
    }
    if (text.includes(UI_AUTO_OPEN_MARKER)) this.uiIntent = "auto-open";
    if (text.includes(UI_IDLE_MARKER)) this.uiIntent = "idle";
  }

  start() {
    if (this.child) return;
    if (!fs.existsSync(this.launcherPath)) {
      throw new PiCocRpcError(`pi-coc launcher not found: ${this.launcherPath}`);
    }
    const args = buildPiCocArgs({
      campaignId: this.campaignId,
      sessionId: this.sessionId,
      provider: this.provider,
      model: this.model,
      thinking: this.thinking,
    });
    const env = buildChildEnv({
      workspace: this.workspace,
      repoRoot: this.repoRoot,
      campaignId: this.campaignId,
      sessionId: this.sessionId,
      agentDir: this.agentDir,
      tableIntent: this.tableIntent,
    });
    const child = this.spawnFn(this.launcherPath, args, {
      cwd: this.workspace,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    const parser = createJsonlParser((obj) => this.#emit(obj));
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => parser.push(chunk));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => this.#noteStderr(chunk));
    child.on("exit", (code, signal) => {
      this.closed = true;
      this.streaming = false;
      this.lastExitCode = code;
      this.#emit({ type: "process_exit", code, signal, campaign_id: this.campaignId });
      const kind = isHandoffExit(code) || this.expectedShutdown
        ? "pi_coc_rpc_handoff"
        : "pi_coc_rpc_exited";
      const err = new PiCocRpcError(
        `pi-coc RPC exited (code=${code} signal=${signal})`,
        { kind },
      );
      for (const pending of this.#pending.values()) pending.reject(err);
      this.#pending.clear();
    });
  }

  #write(payload) {
    if (!this.child || this.closed) {
      throw new PiCocRpcError("pi-coc RPC host is not running");
    }
    const line = JSON.stringify(payload) + "\n";
    return new Promise((resolve, reject) => {
      this.child.stdin.write(line, (err) => {
        if (err) reject(new PiCocRpcError(String(err)));
        else resolve();
      });
    });
  }

  #request(payload, timeoutMs = 30_000) {
    const id = payload.id || `r-${randomUUID()}`;
    const body = { ...payload, id };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new PiCocRpcError(`RPC ${body.type} timed out`, { kind: "pi_coc_rpc_timeout" }));
      }, timeoutMs);
      this.#pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      this.#write(body).catch((err) => {
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(err);
      });
    });
  }

  async waitUntilReady(timeoutMs = 45_000) {
    this.start();
    const deadline = Date.now() + timeoutMs;
    let lastErr;
    while (Date.now() < deadline) {
      if (this.closed) {
        throw new PiCocRpcError(summarizeRpcDeath(this.#stderr), {
          kind: "pi_coc_rpc_exited",
        });
      }
      try {
        await this.#request({ type: "get_state" }, 5_000);
        this.ready = true;
        return;
      } catch (err) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    throw lastErr || new PiCocRpcError("pi-coc RPC did not become ready");
  }

  async waitForUiIntent(timeoutMs = 45_000) {
    const deadline = Date.now() + timeoutMs;
    const abortAt = this.abortGeneration;
    while (Date.now() < deadline) {
      if (this.uiIntent) return this.uiIntent;
      if (this.abortGeneration > abortAt) {
        throw this.#abortedError();
      }
      if (this.closed) {
        if (this.isHandoffShutdown()) return this.uiIntent || "idle";
        throw new PiCocRpcError("pi-coc RPC exited before UI intent");
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    return this.uiIntent;
  }

  async setModel(provider, modelId) {
    if (!provider || !modelId) return;
    await this.#request({
      type: "set_model",
      provider,
      modelId,
    });
  }

  async setThinking(level) {
    if (!level) return;
    await this.#request({
      type: "set_thinking_level",
      level,
    }).catch(() => {
      // Older Pi builds or models that reject a level must not block play.
    });
  }

  #abortedError() {
    return new PiCocRpcError("pi-coc turn aborted", { kind: "pi_coc_rpc_aborted" });
  }

  #waitSettleAfter(startGen, onSse, timeoutMs, { suppressSilentNotice = false } = {}) {
    const deadline = Date.now() + timeoutMs;
    const abortAt = this.abortGeneration;
    return new Promise((resolve, reject) => {
      // Transparency only (never blocks): a settled turn that produced neither
      // player-visible text nor an error frame is a silent no-op for the
      // player (E2E findings F6/F14 — e.g. narration trapped in the model's
      // thinking channel). A setup exit-42 is not settled player output: its
      // play-session continuation owns the still-open turn instead.
      let sawPlayerText = false;
      let sawError = false;
      let sawHandoff = false;
      let timer = null;
      const notifyIfSilent = () => {
        if (
          suppressSilentNotice
          || this.openingSourceReviewPending
          || sawPlayerText
          || sawError
        ) return;
        onSse?.({
          event: "notice",
          data: {
            message:
              "本回合未产出玩家可见文本（模型可能把叙事写进了思考频道或回合未结算）；请重试同一行动。",
          },
        });
      };
      const finish = (err, result = {}) => {
        off();
        if (timer !== null) clearInterval(timer);
        if (err) reject(err);
        else resolve({ sawPlayerText, sawError, sawHandoff, ...result });
      };
      const settle = (result = {}) => {
        if (!result.handoff) notifyIfSilent();
        finish(null, result);
      };
      const off = this.onEvent((event) => {
        for (const frame of mapRpcEventToSse(event)) {
          if (frame.event === "delta" && String(frame.data?.text || "").trim()) {
            sawPlayerText = true;
          } else if (frame.event === "delta_reset") {
            sawPlayerText = false;
          } else if (frame.event === "error") {
            sawError = true;
          } else if (frame.event === "coc_setup_handoff") {
            if (sawHandoff) continue;
            sawHandoff = true;
          }
          onSse?.(frame);
        }
        // Do not resolve directly from the `agent_settled` listener. A hidden
        // follow-up may be queued by the extension in the same lifecycle turn.
      });
      timer = setInterval(() => {
        const quietFor = this.lastSettledAt > 0
          ? Date.now() - this.lastSettledAt
          : 0;
        if (
          this.settleGeneration > startGen
          && !this.streaming
          && quietFor >= AGENT_SETTLE_QUIESCENCE_MS
        ) {
          settle({ handoff: sawHandoff });
        } else if (this.abortGeneration > abortAt) {
          finish(this.#abortedError());
        } else if (this.closed) {
          if (this.isHandoffShutdown()) {
            settle({ handoff: true });
          } else {
            finish(new PiCocRpcError("pi-coc RPC exited during turn"));
          }
        } else if (Date.now() > deadline) {
          finish(new PiCocRpcError("pi-coc turn timed out", { kind: "pi_coc_rpc_timeout" }));
        }
      }, 20);
    });
  }

  async #waitForQueuedFollowUp(onSse, timeoutMs, options = {}) {
    if (
      this.streaming
      || this.settleGeneration === 0
      || this.lastSettledAt === 0
    ) return;
    const observedGeneration = this.settleGeneration;
    const remaining = AGENT_SETTLE_QUIESCENCE_MS
      - (Date.now() - this.lastSettledAt);
    if (remaining > 0) {
      await new Promise((resolve) => setTimeout(resolve, remaining));
    }
    if (this.streaming || this.settleGeneration > observedGeneration) {
      await this.#waitSettleAfter(
        observedGeneration,
        onSse,
        timeoutMs,
        options,
      );
    }
  }

  async attachOpening({
    onSse,
    timeoutMs = 900_000,
    requireVisibleText = false,
  } = {}) {
    let sawVisibleText = false;
    const relay = (frame) => {
      if (frame?.event === "delta" && String(frame.data?.text || "").trim()) {
        sawVisibleText = true;
      } else if (frame?.event === "delta_reset") {
        sawVisibleText = false;
      }
      onSse?.(frame);
    };
    const finish = (opened) => {
      if (requireVisibleText && !sawVisibleText) {
        throw new PiCocRpcError("开桌会话未产出玩家可见文本。", {
          kind: "pi_coc_opening_not_visible",
        });
      }
      return { opened };
    };
    const maybeSetupOpen = async (openedFallback) => {
      if (this.openingSourceReviewPending) {
        const baseGeneration = this.settleGeneration;
        const deadline = Date.now() + timeoutMs;
        while (this.openingSourceReviewPending && !this.closed && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 100));
        }
        if (this.openingSourceReviewPending) {
          throw new PiCocRpcError("模组源事实评审超时。", {
            kind: "pi_coc_source_review_timeout",
          });
        }
        const followUpDeadline = Math.min(deadline, Date.now() + 10_000);
        while (
          !this.streaming
          && this.settleGeneration === baseGeneration
          && !this.closed
          && Date.now() < followUpDeadline
        ) {
          await new Promise((r) => setTimeout(r, 50));
        }
        if (this.streaming) {
          await this.#waitSettleAfter(baseGeneration, relay, Math.max(1, deadline - Date.now()), {
            suppressSilentNotice: requireVisibleText,
          });
        } else if (this.settleGeneration > baseGeneration) {
          this.#replaySse(relay);
        }
        if (sawVisibleText) return finish(true);
      }
      const injected = await this.#promptSetupOpeningIfSilent({
        onSse: relay,
        timeoutMs,
        sawVisibleText,
      });
      if (injected) {
        if (requireVisibleText && !sawVisibleText) {
          throw new PiCocRpcError("开桌会话未产出玩家可见文本。", {
            kind: "pi_coc_opening_not_visible",
          });
        }
        return { opened: true, setupOpeningPrompted: true };
      }
      return finish(openedFallback);
    };
    if (this.settleGeneration > 0 && !this.streaming) {
      await this.#waitForQueuedFollowUp(relay, timeoutMs, {
        suppressSilentNotice: requireVisibleText,
      });
    }
    if (this.settleGeneration > 0 && !this.streaming) {
      if (requireVisibleText) this.#replaySse(relay);
      if (!sawVisibleText) this.#replaySessionAssistant(relay);
      return maybeSetupOpen(true);
    }
    const replayed = this.#replaySse(relay);
    if (this.streaming) {
      await this.#waitSettleAfter(this.settleGeneration, relay, timeoutMs, {
        suppressSilentNotice: requireVisibleText,
      });
      return maybeSetupOpen(true);
    }
    const intent = await this.waitForUiIntent(45_000);
    if (intent === "auto-open" || this.streaming) {
      const startGen = this.settleGeneration;
      const abortAt = this.abortGeneration;
      const settled = this.#waitSettleAfter(startGen, relay, timeoutMs, {
        suppressSilentNotice: requireVisibleText,
      });
      const startDeadline = Date.now() + 60_000;
      while (!this.streaming && this.settleGeneration === startGen
        && this.abortGeneration === abortAt
        && Date.now() < startDeadline && !this.closed) {
        await new Promise((r) => setTimeout(r, 100));
      }
      if (this.abortGeneration > abortAt || this.streaming || this.settleGeneration > startGen) {
        await settled;
        return maybeSetupOpen(true);
      }
    }
    if (this.#replaySessionAssistant(relay)) {
      return maybeSetupOpen(true);
    }
    return maybeSetupOpen(replayed);
  }

  async prompt(message, { onSse, timeoutMs = 900_000 } = {}) {
    const startGen = this.settleGeneration;
    const settled = this.#waitSettleAfter(startGen, onSse, timeoutMs);
    const payload = {
      type: "prompt",
      message: String(message ?? ""),
    };
    if (this.streaming) payload.streamingBehavior = "followUp";
    try {
      await this.#request(payload, 15_000);
    } catch (err) {
      if (err?.kind !== "pi_coc_rpc_handoff") throw err;
      const result = await settled;
      return { ...result, handoff: true };
    }
    return await settled;
  }

  async promptPlayOpening({ onSse, timeoutMs = 900_000 } = {}) {
    let sawVisibleText = false;
    const result = await this.prompt(PLAY_TABLE_OPENING_PROMPT, {
      timeoutMs,
      onSse: (frame) => {
        if (frame?.event === "delta" && String(frame.data?.text || "").trim()) {
          sawVisibleText = true;
        }
        onSse?.(frame);
      },
    });
    if (!sawVisibleText) {
      throw new PiCocRpcError("开桌会话未产出玩家可见文本。", {
        kind: "pi_coc_opening_not_visible",
      });
    }
    return { ...result, opened: true };
  }

  async abort() {
    this.abortGeneration += 1;
    if (!this.child || this.closed) return;
    try {
      await this.#write({ type: "abort" });
    } catch {
      /* best effort: waiters already unblocked */
    }
  }

  async close() {
    this.expectedShutdown = true;
    if (!this.child || this.closed) return;
    this.abortGeneration += 1;
    try {
      await this.#write({ type: "abort" });
    } catch {
      /* best effort */
    }
    this.child.kill("SIGTERM");
    const child = this.child;
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* already gone */
        }
        resolve();
      }, 2_000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    this.child = null;
    this.closed = true;
  }
}

export function defaultRepoRoot() {
  return DEFAULT_REPO_ROOT;
}
