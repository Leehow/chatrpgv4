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
import { createHash, randomUUID } from "node:crypto";
import {
  lastVisibleAssistantText,
  SETUP_CHARACTER_OPENING_MARKER,
  TURN_RECOVERY_MARKER,
} from "./pi-session-text.mjs";
import {
  resolveHostedSessionAgentDirs,
  resolvePiCocAgentDir,
  resolveProductAgentDir,
} from "./agent-dir.mjs";
import { loadUserPrefs, pickUiPrefs, resolveUserPrefsPath } from "./user-prefs.mjs";
import {
  applyGrokBuildExtensionSettingsEnv,
  grokBuildExtensionMountArgs,
} from "./grok-build-extension.mjs";
import {
  DEFAULT_RPC_TURN_IDLE_TIMEOUT_MS,
  PiRpcTurnIdleWatchdog,
} from "./pi-rpc-turn-watchdog.mjs";

export {
  SETUP_CHARACTER_OPENING_MARKER,
  TURN_RECOVERY_MARKER,
  isHiddenSetupOpeningPrompt,
} from "./pi-session-text.mjs";

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
  "Host continuation for a newly spawned selected play campaign.",
  "You are the play-role Keeper for this already-selected campaign.",
  "First call session.resume on this campaign.",
  "Branch only on that result: recover and finalize a retained pending turn",
  "from canonical receipts without resending player input; for table_opening",
  "call coc_evidence_table_opening exactly once; for awaiting_player emit no",
  "new table prose and wait. Emit only an exact pending delivery when present.",
  "Never replay an older assistant opening, reroll, repeat state writes, invent",
  "opening text, or ask the player to choose a campaign.",
].join(" ");

/** Host-owned recovery after a provider continuation lost all RPC progress. */
export const PLAY_TURN_RECOVERY_PROMPT = [
  TURN_RECOVERY_MARKER,
  "Host recovery after an interrupted pi-coc provider continuation.",
  "This is not a new player action and does not repeat the player's prior input.",
  "First call session.resume for this already-selected campaign.",
  "Follow its exact pending_finalization or open_turn_recovery contract.",
  "Preserve all already-written rules and state effects and their decision ids;",
  "do not replay mutations, reroll, or invent replacement state.",
  "Complete only the retained turn's missing review/finalization/delivery work,",
  "then deliver the exact player-visible result from canonical receipts.",
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

/** Host KP web_search / web_fetch extension (not the shared COC package). */
export const HOST_WEB_SEARCH_EXTENSION_REL = path.join(
  "web",
  "server-node",
  "pi-extensions",
  "web-search.ts",
);

/** Host Pi extensions (not the shared COC package). */
export const HOST_PI_EXTENSION_RELS = Object.freeze([
  HOST_WEB_SEARCH_EXTENSION_REL,
  path.join("web", "server-node", "pi-extensions", "openai-server-tools.ts"),
  path.join("web", "server-node", "pi-extensions", "xai-server-tools.ts"),
]);

const WEB_SEARCH_KEY_ENV = Object.freeze({
  exaApiKey: "EXA_API_KEY",
  tavilyApiKey: "TAVILY_API_KEY",
  perplexityApiKey: "PERPLEXITY_API_KEY",
  searxngApiKey: "SEARXNG_API_KEY",
});

export function resolveHostWebSearchExtension(repoRoot = DEFAULT_REPO_ROOT) {
  return path.resolve(repoRoot, HOST_WEB_SEARCH_EXTENSION_REL);
}

export function hostPiExtensionPaths(repoRoot = DEFAULT_REPO_ROOT) {
  return HOST_PI_EXTENSION_RELS.map((rel) => path.resolve(repoRoot, rel));
}

/**
 * Resolve host extension paths. Missing files are omitted for fake test
 * repoRoots; callers that use the real repo must assert every required file
 * exists so a missing T4/T5 file cannot silently skip.
 */
export function resolveHostPiExtensions(repoRoot = DEFAULT_REPO_ROOT) {
  return hostPiExtensionPaths(repoRoot).filter((abs) => fs.existsSync(abs));
}

function readWebSearchConfigObject(agentDir) {
  const dir = String(agentDir || "").trim();
  if (!dir) return {};
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.join(dir, "web-search.json"), "utf8"),
    );
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch (err) {
    if (err && err.code === "ENOENT") return {};
    return {};
  }
}

function pushUniqueDir(dirs, value) {
  const raw = String(value || "").trim();
  if (!raw) return;
  const resolved = path.resolve(raw);
  if (!dirs.includes(resolved)) dirs.push(resolved);
}

function routingFromConfig(config) {
  const routing = config.searchRouting;
  if (routing && typeof routing === "object" && !Array.isArray(routing) && Array.isArray(routing.providers)) {
    const providers = routing.providers
      .map((id) => String(id || "").trim())
      .filter(Boolean);
    if (providers.length) return providers.join(",");
  }
  const pin = typeof config.provider === "string" && config.provider.trim()
    ? config.provider.trim()
    : typeof config.searchProvider === "string" && config.searchProvider.trim()
      ? config.searchProvider.trim()
      : "";
  return pin;
}

/** Inject *ApiKey from web-search.json. Never overwrite an already-set env secret. */
export function injectWebSearchKeysIntoEnv(env, { keyDirs = [] } = {}) {
  const next = env && typeof env === "object" ? env : {};
  for (const dir of keyDirs) {
    const config = readWebSearchConfigObject(dir);
    for (const [field, name] of Object.entries(WEB_SEARCH_KEY_ENV)) {
      const value = typeof config[field] === "string" ? config[field].trim() : "";
      if (!value) continue;
      if (String(next[name] || "").trim()) continue;
      next[name] = value;
    }
    if (!String(next.WEB_SEARCH_ROUTING || "").trim()) {
      const routing = routingFromConfig(config);
      if (routing) next.WEB_SEARCH_ROUTING = routing;
    }
  }
  return next;
}

export function buildPiCocArgs({
  campaignId,
  sessionId,
  provider,
  model,
  thinking,
  repoRoot = DEFAULT_REPO_ROOT,
  env = process.env,
}) {
  const args = ["--mode", "rpc", "--session-id", sessionId];
  if (campaignId) args.push("--campaign", String(campaignId));
  if (provider) args.push("--provider", String(provider));
  if (model) args.push("--model", String(model));
  if (thinking) args.push("--thinking", String(thinking));
  for (const ext of resolveHostPiExtensions(repoRoot)) {
    args.push("--extension", ext);
  }
  // Canonical grok-build-oauth mount: repo-local install only, skipped when
  // the PipiUI host spawn already mounted the extension id (no double mount).
  const grokMount = grokBuildExtensionMountArgs({ repoRoot, env });
  if (grokMount.length) {
    const entry = grokMount[1];
    const already = args.some((value, idx) => value === "--extension" && args[idx + 1] === entry);
    if (!already) args.push("--extension", entry);
  }
  return args;
}

/** Inject PDF-skill vision model from UI prefs. Never writes COC_PI_OPENING_MODEL. */
export function applyVisionChildEnv(env, prefs) {
  if (!env || typeof env !== "object") return env;
  if (prefs?.visionEnabled === true) {
    const provider = String(prefs.visionProvider || "").trim();
    const model = String(prefs.visionModel || "").trim();
    if (provider && model) {
      env.COC_PI_PDF_MODEL = `${provider}/${model}`;
      return env;
    }
  }
  delete env.COC_PI_PDF_MODEL;
  return env;
}

export function buildChildEnv({
  workspace,
  repoRoot = DEFAULT_REPO_ROOT,
  campaignId,
  sessionId,
  agentDir,
  tableIntent,
  parentEnv = process.env,
  userPrefs,
}) {
  const env = { ...parentEnv };
  env.COC_WORKSPACE = path.resolve(workspace);
  // Source/dev Pi-Coc has one canonical writable identity. App-owned,
  // inherited, coding-track, and historical workspace homes remain read-only
  // configuration/evidence sources and can never redirect this child.
  const runtimeAgentDir = resolvePiCocAgentDir({ repoRoot });
  env.PI_COC_AGENT_DIR = runtimeAgentDir;
  env.PI_CODING_AGENT_DIR = runtimeAgentDir;
  env.PI_AGENT_DIR = runtimeAgentDir;
  const keyDirs = [];
  pushUniqueDir(keyDirs, runtimeAgentDir);
  // App-owned search configuration is a read-only legacy input during the
  // transition. It may populate ephemeral child env keys, but it never owns
  // the child's Pi home or any write path.
  pushUniqueDir(keyDirs, resolveProductAgentDir({
    agentDir: agentDir || "",
    userData: parentEnv.COC_DESKTOP_USER_DATA,
  }));
  injectWebSearchKeysIntoEnv(env, { keyDirs });
  // Extension settings snapshot (non-secret only): the grok-build-oauth
  // agent half reads PIPIUI_EXT_SETTINGS_GROK_BUILD_OAUTH; tokens never
  // enter the child env.
  applyGrokBuildExtensionSettingsEnv(env, { repoRoot });
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
  const prefs = userPrefs !== undefined
    ? pickUiPrefs(userPrefs)
    : loadUserPrefs(resolveUserPrefsPath({
      settingsPath: parentEnv.COC_DESKTOP_SETTINGS,
      userData: parentEnv.COC_DESKTOP_USER_DATA,
      agentDir: parentEnv.PI_AGENT_DIR || agentDir,
    }));
  applyVisionChildEnv(env, prefs);
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

function canonicalEnvelope(value, depth = 0) {
  if (depth > 6 || value == null) return null;
  if (typeof value === "string") {
    try {
      return canonicalEnvelope(JSON.parse(value), depth + 1);
    } catch {
      return null;
    }
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = canonicalEnvelope(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  if (typeof value.ok === "boolean" && typeof value.tool === "string") return value;
  for (const key of ["details", "result", "content", "data", "text"]) {
    const found = canonicalEnvelope(value[key], depth + 1);
    if (found) return found;
  }
  return null;
}

function canonicalTextSha256(text) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(text), "utf8")
    .digest("hex")}`;
}

export function deliveryReceiptFromToolEvent(event) {
  if (!event || event.type !== "tool_execution_end") return null;
  const envelope = canonicalEnvelope(event.result ?? event.details);
  if (envelope?.tool !== "turn.finalize") return null;
  const data = envelope?.ok === true && envelope.data && typeof envelope.data === "object"
    ? envelope.data
    : null;
  if (
    typeof data?.finalization_id !== "string"
    || data.finalization_id.length === 0
    || typeof data?.rendered_text !== "string"
    || data.rendered_text.length === 0
    || typeof data?.rendered_sha256 !== "string"
    || data.rendered_sha256 !== canonicalTextSha256(data.rendered_text)
  ) return null;
  return {
    finalizationId: data.finalization_id,
    renderedText: data.rendered_text,
    renderedSha256: data.rendered_sha256,
  };
}

function recoveryFinalizationModeFromToolEvent(event) {
  if (!event || event.type !== "tool_execution_end") return null;
  const envelope = canonicalEnvelope(event.result ?? event.details);
  if (envelope?.ok !== true || envelope.tool !== "session.resume") return null;
  const mode = typeof envelope.data?.mode === "string" ? envelope.data.mode : "";
  return mode === "pending_finalization" || mode === "open_turn_recovery"
    ? mode
    : null;
}

function recoveryFinalizationFault(campaignId, obligation) {
  const details = {
    schema_version: 1,
    contract_id: "coc.pi-turn-processing-fault.v1",
    kind: "turn_processing_fault",
    status: "terminal",
    stage: "turn_finalization",
    campaign_id: campaignId || null,
    turn_id: null,
    player_turn_epoch: null,
    code: "turn_finalization_obligation_unmet",
    message: "回合处理失败：保留回合未完成权威结算与交付。当前回合仍保留，请刷新后恢复。",
    retryable: false,
    will_retry: false,
    pending_turn_preserved: true,
    failure_class: "finalization_obligation_unmet",
    requested_model: null,
    elapsed_ms: null,
    recovery_mode: obligation.mode,
    finalization_receipt_observed: obligation.delivery !== null,
    delivery_observed: obligation.delivered,
  };
  return {
    event: "error",
    data: {
      message: details.message,
      code: details.code,
      retryable: false,
      details,
    },
  };
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

function turnProcessingFaultDetails(event) {
  if (!event || event.type !== "custom_message"
    || event.customType !== "coc-turn-processing-fault") return null;
  let source = event.details;
  if ((!source || typeof source !== "object") && typeof event.content === "string") {
    try {
      source = JSON.parse(event.content);
    } catch {
      return null;
    }
  }
  if (!source || typeof source !== "object"
    || source.contract_id !== "coc.pi-turn-processing-fault.v1"
    || source.schema_version !== 1
    || source.kind !== "turn_processing_fault"
    || source.status !== "terminal"
    || source.stage !== "state_claim_compilation"
    || !["state_claim_compiler_invalid", "state_claim_compiler_unavailable"]
      .includes(source.code)) return null;
  const requestedModel = source.requested_model && typeof source.requested_model === "object"
    ? {
        provider: typeof source.requested_model.provider === "string"
          ? source.requested_model.provider : null,
        id: typeof source.requested_model.id === "string" ? source.requested_model.id : null,
        api: typeof source.requested_model.api === "string" ? source.requested_model.api : null,
      }
    : null;
  return {
    schema_version: 1,
    contract_id: source.contract_id,
    kind: source.kind,
    status: "terminal",
    stage: "state_claim_compilation",
    campaign_id: typeof source.campaign_id === "string" ? source.campaign_id : null,
    turn_id: typeof source.turn_id === "string" ? source.turn_id : null,
    player_turn_epoch: Number.isInteger(source.player_turn_epoch)
      ? source.player_turn_epoch : null,
    code: source.code,
    message: typeof source.message === "string" && source.message.trim()
      ? source.message.trim() : "回合处理失败；当前回合仍保留，请刷新后恢复。",
    retryable: source.retryable === true,
    will_retry: source.will_retry === true,
    pending_turn_preserved: source.pending_turn_preserved === true,
    failure_class: [
      "capability_unsupported",
      "provider_unavailable",
      "timeout",
      "protocol_invalid",
      "result_invalid",
    ].includes(source.failure_class) ? source.failure_class : null,
    requested_model: requestedModel,
    elapsed_ms: Number.isInteger(source.elapsed_ms) ? source.elapsed_ms : null,
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
  const processingFault = turnProcessingFaultDetails(event);
  if (processingFault) {
    return [{
      event: "error",
      data: {
        message: processingFault.message,
        code: processingFault.code,
        retryable: processingFault.retryable,
        details: processingFault,
      },
    }];
  }
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
      // Assistant text is still a model draft at message_update time. The Pi
      // extension may hide or replace it at message_end after finalization;
      // forwarding the draft here bypasses that settled-output boundary.
      if (
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
    return [{ event: "delta", data: { text: visibleText } }];
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
  constructor(message, { kind = "pi_coc_rpc_failed", details = null } = {}) {
    super(message);
    this.name = "PiCocRpcError";
    this.kind = kind;
    this.details = details;
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
    turnIdleTimeoutMs = DEFAULT_RPC_TURN_IDLE_TIMEOUT_MS,
    nowFn = Date.now,
  }) {
    this.repoRoot = repoRoot;
    this.workspace = path.resolve(workspace);
    this.campaignId = campaignId;
    this.sessionId = sessionId || webSessionId(campaignId);
    this.agentDir = path.resolve(resolveProductAgentDir({
      agentDir: agentDir || process.env.PI_AGENT_DIR || "",
      userData: process.env.COC_DESKTOP_USER_DATA,
    }));
    this.runtimeAgentDir = resolvePiCocAgentDir({ repoRoot });
    this.sessionAgentDirs = resolveHostedSessionAgentDirs({
      repoRoot,
      workspace: this.workspace,
      agentDir: this.agentDir,
      userData: process.env.COC_DESKTOP_USER_DATA,
    });
    this.launcherPath = launcherPath || resolvePiCocLauncher(repoRoot);
    this.tableIntent = tableIntent || null;
    this.provider = provider || "";
    this.model = model || "";
    this.thinking = thinking || "";
    this.spawnFn = spawnFn;
    this.turnIdleTimeoutMs = turnIdleTimeoutMs;
    this.nowFn = nowFn;
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
    this.#pendingFinalizedDelivery = null;
    this.#streamedFinalizedDelivery = null;
    this.#abortBoundary = null;
    this.#abortCommandPending = false;
    this.#activePromptCount = 0;
    this.#openingAttached = false;
    this.#openingAttachPromise = null;
    this.#processExitObserved = false;
    this.#processCloseObserved = false;
  }

  isHandoffShutdown() {
    return this.expectedShutdown || isHandoffExit(this.lastExitCode);
  }

  #pending;
  #listeners;
  #stderr;
  #eventLog;
  #setupOpeningPrompted;
  #pendingFinalizedDelivery;
  #streamedFinalizedDelivery;
  #abortBoundary;
  #abortCommandPending;
  #activePromptCount;
  #openingAttached;
  #openingAttachPromise;
  #processExitObserved;
  #processCloseObserved;

  #noteStreamedText(text, accepted) {
    const pending = this.#pendingFinalizedDelivery;
    if (accepted === false || !pending || String(text) !== pending.renderedText) return;
    this.#streamedFinalizedDelivery = pending;
    this.#pendingFinalizedDelivery = null;
  }

  get openingIntent() {
    return this.uiIntent;
  }

  onEvent(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #replaySse(onSse) {
    let opened = false;
    let recoveryFinalization = null;
    let terminalFaultObserved = false;
    let handoffObserved = false;
    for (const event of this.#eventLog) {
      const recoveryMode = recoveryFinalizationModeFromToolEvent(event);
      if (recoveryMode !== null) {
        recoveryFinalization = {
          mode: recoveryMode,
          delivery: null,
          delivered: false,
        };
      }
      const delivery = deliveryReceiptFromToolEvent(event);
      if (recoveryFinalization !== null && delivery !== null) {
        recoveryFinalization.delivery = delivery;
      }
      for (const frame of mapRpcEventToSse(event)) {
        if (
          frame?.event === "error"
          && frame.data?.details?.kind === "turn_processing_fault"
          && frame.data?.details?.status === "terminal"
        ) terminalFaultObserved = true;
        if (frame?.event === "coc_setup_handoff") handoffObserved = true;
        if (frame?.event === "delta" && recoveryFinalization !== null) {
          if (
            recoveryFinalization.delivered
            || recoveryFinalization.delivery === null
            || String(frame.data?.text || "")
              !== recoveryFinalization.delivery.renderedText
          ) continue;
        }
        const accepted = onSse?.(frame);
        if (frame?.event === "delta") {
          this.#noteStreamedText(frame.data?.text, accepted);
          if (recoveryFinalization !== null && accepted !== false) {
            recoveryFinalization.delivered = true;
          }
        }
        opened = true;
      }
      if (event?.type === "agent_settled") opened = true;
    }
    if (
      recoveryFinalization !== null
      && (!recoveryFinalization.delivery || !recoveryFinalization.delivered)
      && !terminalFaultObserved
      && !handoffObserved
      && this.settleGeneration > 0
    ) {
      const frame = recoveryFinalizationFault(
        this.campaignId,
        recoveryFinalization,
      );
      onSse?.(frame);
      throw new PiCocRpcError(frame.data.message, {
        kind: "pi_coc_turn_processing_fault",
        details: frame.data.details,
      });
    }
    return { opened, recoveryFinalization };
  }

  #replaySessionAssistant(onSse) {
    const text = stripPlayerEnvelopeMarkers(lastVisibleAssistantText({
      agentDirs: this.sessionAgentDirs,
      workspace: this.workspace,
      sessionId: this.sessionId,
    })).trim();
    if (!text) return false;
    const accepted = onSse?.({ event: "delta", data: { text } });
    this.#noteStreamedText(text, accepted);
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
      agentDirs: this.sessionAgentDirs,
      workspace: this.workspace,
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
      if (this.#abortBoundary === null) this.#abortCommandPending = false;
    }
    if (event?.type === "agent_settled") {
      this.streaming = false;
      this.settleGeneration += 1;
      this.lastSettledAt = Date.now();
      if (
        this.#abortBoundary !== null
        && this.settleGeneration > this.#abortBoundary.settleGeneration
      ) {
        this.#abortBoundary = null;
      }
      this.#abortCommandPending = false;
    }
    if (event?.type === "message_update" && event.usage) {
      this.lastUsage = event.usage;
    }
    const delivery = deliveryReceiptFromToolEvent(event);
    if (delivery !== null) this.#pendingFinalizedDelivery = delivery;
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
      repoRoot: this.repoRoot,
      env: process.env,
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
      this.#processExitObserved = true;
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
    child.on("close", () => {
      this.#processCloseObserved = true;
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
    const nextProvider = String(provider || "").trim();
    const nextModel = String(modelId || "").trim();
    if (!nextProvider || !nextModel) return;
    if (nextProvider === this.provider && nextModel === this.model) return;
    await this.#request({
      type: "set_model",
      provider: nextProvider,
      modelId: nextModel,
    });
    this.provider = nextProvider;
    this.model = nextModel;
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

  async #sendAbortOnce() {
    if (this.#abortCommandPending) return false;
    this.#abortCommandPending = true;
    try {
      await this.#write({ type: "abort" });
    } catch {
      // The generation fence still unblocks callers. Recovery will close an
      // unresponsive child before reusing the persisted session.
    }
    return true;
  }

  #beginAbort() {
    if (this.#abortBoundary !== null) return Promise.resolve(false);
    this.#abortBoundary = { settleGeneration: this.settleGeneration };
    this.abortGeneration += 1;
    return this.#sendAbortOnce();
  }

  async waitForAbortSettlement(timeoutMs = 2_000) {
    const boundary = this.#abortBoundary;
    if (boundary === null) return true;
    const deadline = Date.now() + timeoutMs;
    while (this.#abortBoundary === boundary && !this.closed) {
      if (Date.now() >= deadline) return false;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return this.#abortBoundary !== boundary;
  }

  #waitSettleAfter(
    startGen,
    onSse,
    timeoutMs,
    {
      suppressSilentNotice = false,
      turnActivity = null,
      initialRecoveryFinalization = null,
    } = {},
  ) {
    const deadline = Date.now() + timeoutMs;
    const abortAt = this.abortGeneration;
    const idleWatchdog = new PiRpcTurnIdleWatchdog({
      timeoutMs: this.turnIdleTimeoutMs,
      now: this.nowFn,
    });
    return new Promise((resolve, reject) => {
      // Transparency only (never blocks): a settled turn that produced neither
      // player-visible text nor an error frame is a silent no-op for the
      // player (E2E findings F6/F14 — e.g. narration trapped in the model's
      // thinking channel). A setup exit-42 is not settled player output: its
      // play-session continuation owns the still-open turn instead.
      let sawPlayerText = false;
      let sawError = false;
      let sawHandoff = false;
      let terminalTurnFault = null;
      let recoveryFinalization = initialRecoveryFinalization === null
        ? null
        : {
            mode: initialRecoveryFinalization.mode,
            delivery: initialRecoveryFinalization.delivery,
            delivered: initialRecoveryFinalization.delivered === true,
          };
      let acceptedObserved = false;
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
        if (terminalTurnFault !== null) {
          finish(new PiCocRpcError(terminalTurnFault.message, {
            kind: "pi_coc_turn_processing_fault",
            details: terminalTurnFault.details,
          }));
          return;
        }
        if (result.handoff) {
          finish(null, result);
          return;
        }
        if (
          recoveryFinalization !== null
          && (!recoveryFinalization.delivery || !recoveryFinalization.delivered)
        ) {
          const frame = recoveryFinalizationFault(
            this.campaignId,
            recoveryFinalization,
          );
          onSse?.(frame);
          finish(new PiCocRpcError(frame.data.message, {
            kind: "pi_coc_turn_processing_fault",
            details: frame.data.details,
          }));
          return;
        }
        notifyIfSilent();
        finish(null, result);
      };
      const off = this.onEvent((event) => {
        const recoveryMode = recoveryFinalizationModeFromToolEvent(event);
        if (recoveryMode !== null) {
          recoveryFinalization = {
            mode: recoveryMode,
            delivery: null,
            delivered: false,
          };
        }
        const eventDelivery = deliveryReceiptFromToolEvent(event);
        if (recoveryFinalization !== null && eventDelivery !== null) {
          recoveryFinalization.delivery = eventDelivery;
        }
        idleWatchdog.observe(event, {
          finalizationReceipt: eventDelivery !== null,
          canonicalToolEnvelope: canonicalEnvelope(event?.result ?? event?.details),
        });
        for (const frame of mapRpcEventToSse(event)) {
          if (frame.event === "delta" && String(frame.data?.text || "").trim()) {
            sawPlayerText = true;
          } else if (frame.event === "delta_reset") {
            sawPlayerText = false;
          } else if (frame.event === "error") {
            sawError = true;
            if (
              terminalTurnFault === null
              && frame.data?.details?.kind === "turn_processing_fault"
              && frame.data?.details?.status === "terminal"
            ) {
              terminalTurnFault = frame.data;
            }
          } else if (frame.event === "coc_setup_handoff") {
            if (sawHandoff) continue;
            sawHandoff = true;
          }
          if (frame.event === "delta" && recoveryFinalization !== null) {
            const exactDelivery = recoveryFinalization.delivery;
            if (
              recoveryFinalization.delivered
              || exactDelivery === null
              || String(frame.data?.text || "") !== exactDelivery.renderedText
            ) continue;
          }
          const accepted = onSse?.(frame);
          if (frame.event === "delta") {
            this.#noteStreamedText(frame.data?.text, accepted);
            if (recoveryFinalization !== null && accepted !== false) {
              recoveryFinalization.delivered = true;
            }
          }
        }
        // Do not resolve directly from the `agent_settled` listener. A hidden
        // follow-up may be queued by the extension in the same lifecycle turn.
      });
      timer = setInterval(() => {
        if (turnActivity?.accepted && !acceptedObserved) {
          acceptedObserved = true;
          idleWatchdog.progress();
        }
        const quietFor = this.lastSettledAt > 0
          ? Date.now() - this.lastSettledAt
          : 0;
        if (this.abortGeneration > abortAt) {
          if (sawHandoff || this.isHandoffShutdown()) {
            settle({ handoff: true });
          } else {
            finish(this.#abortedError());
          }
        } else if (
          this.settleGeneration > startGen
          && !this.streaming
          && quietFor >= AGENT_SETTLE_QUIESCENCE_MS
        ) {
          settle({ handoff: sawHandoff });
        } else if ((this.streaming || acceptedObserved) && idleWatchdog.expired()) {
          void this.#beginAbort();
          finish(new PiCocRpcError(
            "pi-coc provider continuation lost RPC progress",
            {
              kind: "pi_coc_rpc_idle_timeout",
              details: idleWatchdog.diagnostics(),
            },
          ));
        } else if (this.closed) {
          if (this.isHandoffShutdown()) {
            settle({ handoff: true });
          } else if (recoveryFinalization !== null) {
            settle();
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

  async #runAttachOpening({
    onSse,
    timeoutMs = 900_000,
    requireVisibleText = false,
  } = {}) {
    let sawVisibleText = false;
    let terminalFault = null;
    const relay = (frame) => {
      if (frame?.event === "delta" && String(frame.data?.text || "").trim()) {
        sawVisibleText = true;
      } else if (frame?.event === "delta_reset") {
        sawVisibleText = false;
      } else if (
        frame?.event === "error"
        && frame.data?.details?.kind === "turn_processing_fault"
        && frame.data?.details?.status === "terminal"
      ) {
        terminalFault = frame.data;
      }
      return onSse?.(frame);
    };
    const finish = (opened) => {
      if (terminalFault) {
        throw new PiCocRpcError(terminalFault.message, {
          kind: "pi_coc_turn_processing_fault",
          details: terminalFault.details,
        });
      }
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
        if (terminalFault) return finish(true);
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
      if (!sawVisibleText) this.#replaySse(relay);
      if (!sawVisibleText && this.tableIntent !== "continue") {
        this.#replaySessionAssistant(relay);
      }
      return maybeSetupOpen(true);
    }
    const replayed = this.#replaySse(relay);
    if (this.streaming) {
      await this.#waitSettleAfter(this.settleGeneration, relay, timeoutMs, {
        suppressSilentNotice: requireVisibleText,
        initialRecoveryFinalization: replayed.recoveryFinalization,
      });
      return maybeSetupOpen(true);
    }
    const intent = await this.waitForUiIntent(45_000);
    if (intent === "auto-open" || this.streaming) {
      const startGen = this.settleGeneration;
      const abortAt = this.abortGeneration;
      const settled = this.#waitSettleAfter(startGen, relay, timeoutMs, {
        suppressSilentNotice: requireVisibleText,
        initialRecoveryFinalization: replayed.recoveryFinalization,
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
    if (this.tableIntent !== "continue" && this.#replaySessionAssistant(relay)) {
      return maybeSetupOpen(true);
    }
    if (this.tableIntent === "continue") {
      throw new PiCocRpcError(
        "pi-coc play host did not start its session.resume continuation",
        { kind: "pi_coc_play_resume_not_started" },
      );
    }
    return maybeSetupOpen(replayed.opened);
  }

  async attachOpening(options = {}) {
    if (this.#openingAttached) return { opened: true };
    if (this.#openingAttachPromise) return this.#openingAttachPromise;
    const run = this.#runAttachOpening(options);
    this.#openingAttachPromise = run;
    try {
      const result = await run;
      this.#openingAttached = true;
      return result;
    } finally {
      if (this.#openingAttachPromise === run) this.#openingAttachPromise = null;
    }
  }

  async prompt(message, { onSse, timeoutMs = 900_000 } = {}) {
    if (this.#abortBoundary !== null) {
      throw new PiCocRpcError(
        "pi-coc abort is awaiting agent_settled",
        { kind: "pi_coc_rpc_abort_pending" },
      );
    }
    this.#activePromptCount += 1;
    try {
      const startGen = this.settleGeneration;
      const turnActivity = { accepted: false };
      const settled = this.#waitSettleAfter(startGen, onSse, timeoutMs, { turnActivity });
      const payload = {
        type: "prompt",
        message: String(message ?? ""),
      };
      if (this.streaming) payload.streamingBehavior = "followUp";
      try {
        await this.#request(payload, 15_000);
        turnActivity.accepted = true;
      } catch (err) {
        if (err?.kind !== "pi_coc_rpc_handoff") throw err;
        const result = await settled;
        return { ...result, handoff: true };
      }
      return await settled;
    } finally {
      this.#activePromptCount -= 1;
    }
  }

  async promptPlayOpening({ onSse, timeoutMs = 900_000 } = {}) {
    let sawVisibleText = false;
    const result = await this.prompt(PLAY_TABLE_OPENING_PROMPT, {
      timeoutMs,
      onSse: (frame) => {
        if (frame?.event === "delta" && String(frame.data?.text || "").trim()) {
          sawVisibleText = true;
        }
        return onSse?.(frame);
      },
    });
    if (!sawVisibleText) {
      throw new PiCocRpcError("开桌会话未产出玩家可见文本。", {
        kind: "pi_coc_opening_not_visible",
      });
    }
    return { ...result, opened: true };
  }

  async promptTurnRecovery({ onSse, timeoutMs = 900_000 } = {}) {
    let sawVisibleText = false;
    const result = await this.prompt(PLAY_TURN_RECOVERY_PROMPT, {
      timeoutMs,
      onSse: (frame) => {
        if (frame?.event === "delta" && String(frame.data?.text || "").trim()) {
          sawVisibleText = true;
        }
        return onSse?.(frame);
      },
    });
    if (!sawVisibleText) {
      throw new PiCocRpcError("pi-coc recovery produced no visible output", {
        kind: "pi_coc_recovery_not_visible",
      });
    }
    return { ...result, recovered: true };
  }

  takeStreamedDelivery() {
    const delivery = this.#streamedFinalizedDelivery;
    this.#streamedFinalizedDelivery = null;
    return delivery;
  }

  offerStreamedDelivery(offer) {
    const delivery = this.#streamedFinalizedDelivery;
    if (delivery === null) return null;
    const accepted = offer?.(delivery);
    if (accepted === false) return null;
    this.#streamedFinalizedDelivery = null;
    return delivery;
  }

  async acknowledgeDisplayedDelivery(delivery, sourceId) {
    if (delivery === null) return null;
    const args = {
      finalization_id: delivery.finalizationId,
      rendered_sha256: delivery.renderedSha256,
      ack_kind: "displayed",
      source_id: String(sourceId || `web-ui:${this.sessionId}`),
      decision_id: `web-ui:${delivery.finalizationId}`,
    };
    const script = path.join(
      this.repoRoot,
      "plugins",
      "coc-keeper",
      "scripts",
      "coc_toolbox.py",
    );
    const result = await new Promise((resolve, reject) => {
      const child = spawn("uv", [
        "run", "--frozen", "python", script, "session.delivery_ack",
        "--root", this.workspace,
        "--campaign", this.campaignId,
        "--json", JSON.stringify(args),
      ], { cwd: this.repoRoot, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += String(chunk); });
      child.stderr.on("data", (chunk) => { stderr += String(chunk); });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code !== 0) {
          reject(new PiCocRpcError(
            `delivery acknowledgement failed: ${stderr.trim().slice(-400)}`,
          ));
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new PiCocRpcError("delivery acknowledgement returned invalid JSON"));
        }
      });
    });
    if (result?.ok !== true) {
      throw new PiCocRpcError(
        `delivery acknowledgement rejected: ${result?.error?.code || "unknown"}`,
      );
    }
    return result;
  }

  async abort() {
    if (!this.child || this.closed) return;
    if (this.streaming || this.#activePromptCount > 0) {
      await this.#beginAbort();
      return;
    }
    this.abortGeneration += 1;
    await this.#sendAbortOnce();
    this.#abortCommandPending = false;
  }

  async close({
    protocolAbort = true,
    termTimeoutMs = 2_000,
    killTimeoutMs = 2_000,
  } = {}) {
    this.expectedShutdown = true;
    if (!this.child) return;
    if (this.#processExitObserved && this.#processCloseObserved) {
      this.child = null;
      return;
    }
    this.abortGeneration += 1;
    if (protocolAbort && !this.#processExitObserved) await this.#sendAbortOnce();
    const child = this.child;
    const signalAndWait = (signal, timeoutMs) => new Promise((resolve) => {
      if (this.#processExitObserved && this.#processCloseObserved) {
        resolve(true);
        return;
      }
      let done = false;
      let timer = null;
      const finish = (released) => {
        if (done) return;
        done = true;
        if (timer !== null) clearTimeout(timer);
        child.off("exit", onExit);
        child.off("close", onClose);
        resolve(released);
      };
      const maybeFinish = () => {
        if (this.#processExitObserved && this.#processCloseObserved) finish(true);
      };
      const onExit = () => maybeFinish();
      const onClose = () => maybeFinish();
      child.once("exit", onExit);
      child.once("close", onClose);
      timer = setTimeout(() => finish(false), timeoutMs);
      if (signal) {
        try {
          child.kill(signal);
        } catch {
          maybeFinish();
        }
      }
    });
    let exited = await signalAndWait(
      this.#processExitObserved ? null : "SIGTERM",
      termTimeoutMs,
    );
    if (!exited) {
      exited = await signalAndWait(
        this.#processExitObserved ? null : "SIGKILL",
        killTimeoutMs,
      );
    }
    if (!exited) {
      throw new PiCocRpcError(
        "pi-coc child did not exit after SIGTERM/SIGKILL",
        { kind: "pi_coc_rpc_close_timeout" },
      );
    }
    if (!this.#processExitObserved || !this.#processCloseObserved) {
      throw new PiCocRpcError(
        "pi-coc child exit/stdio close was not observed by its host",
        { kind: "pi_coc_rpc_close_timeout" },
      );
    }
    this.child = null;
  }
}

export function defaultRepoRoot() {
  return DEFAULT_REPO_ROOT;
}
