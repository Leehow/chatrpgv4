#!/usr/bin/env node
/**
 * Full Pi coding-agent Keeper turn.
 *
 * Pi is an AI coding agent like Codex/Claude Code/Cursor. This thin host
 * shell spawns a pi-coding-agent session with the canonical COC keeper
 * skills and the canonical COC Pi Package extension loaded, so the keeper LLM
 * uses the same typed gateway as every other host. The only last-mile gate is
 * the canonical settled-turn
 * finalization receipt; there is no alternate narration envelope.
 *
 * stdin (one JSON object):
 *   {
 *     workspace,            // project root containing .coc/
 *     campaign_id,
 *     run_id?,              // current play/report segment identity
 *     investigator_id?,     // optional focus investigator
 *     player_input,         // raw player prose for this turn
 *     play_language,        // e.g. "zh-Hans"
 *     run_policy?,          // single_session | continue_until_scenario_terminal
 *     transcript_tail?,     // [{role, text}] recent public transcript
 *     finalization_offset,  // pre-turn turn-finalizations.jsonl byte offset
 *     skills_dirs,          // kernel skills + active ruleset skills (absolute)
 *     runtime_project_root, // runtime installation root containing uv.lock
 *     toolbox_path          // plugins/coc-keeper/scripts/coc_toolbox.py (absolute)
 *   }
 * stdout: { ok: true, narration, finalization, model_identity?, usage? }
 *      or { ok: false, error, error_code? }
 *
 * Server mode (``--server``): persistent JSONL worker. One agent session is
 * kept warm across turns for continuity (CLI-like memory). Framing:
 *   → {"request_id":"...","payload":{...keeper request...}}
 *   ← {"request_id":"...","ok":true,"narration":...,"finalization":...}
 * Streaming progress still uses stderr ``{"$stream":...}`` lines.
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(
  path.join(__dirname, "node_modules/@earendil-works/pi-coding-agent/package.json"),
);
const { loadSkillsFromDir } = require("./dist/core/skills.js");

const FINALIZATION_FIELDS = new Set([
  "schema_version", "finalization_id", "decision_id", "journal_decision_id",
  "journal_call_index", "source_start_index", "source_end_index",
  "source_digest", "source_roll_ids", "obligation_ids", "coverage_ids",
  "draft_sha256", "coverage_sha256", "bundle_sha256", "rendered_sha256",
  "bundle", "coverage", "segments", "rendered_text", "integrity_digest",
]);
const FINALIZATION_SEGMENT_TYPES = new Set([
  "fiction", "public_check", "state_delta", "exceptional_effect",
]);

export class KeeperFinalizationError extends Error {
  constructor(reason, message) {
    super(message);
    this.name = "KeeperFinalizationError";
    this.code = "keeper_finalization_blocked";
    this.reason = reason;
    this.turnCommitted = true;
  }
}

function finalizationFailure(reason, message) {
  throw new KeeperFinalizationError(reason, message);
}

function canonicalJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) finalizationFailure("malformed", "finalization contains a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
    ).join(",")}}`;
  }
  finalizationFailure("malformed", "finalization contains an unsupported JSON value");
}

function canonicalDigest(value) {
  return `sha256:${crypto.createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

function hasExactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === expected.size && keys.every((key) => expected.has(key));
}

function isDigest(value) {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
}

function validateSegments(segments, renderedText, draftSha256) {
  if (!Array.isArray(segments) || segments.length < 1) {
    finalizationFailure("malformed", "finalization segments are missing");
  }
  const seenSourceIds = new Set();
  for (const segment of segments) {
    if (!hasExactKeys(segment, new Set(["segment_type", "text", "source_ids"]))) {
      finalizationFailure("malformed", "finalization segment has an invalid shape");
    }
    const segmentType = segment.segment_type;
    if (!FINALIZATION_SEGMENT_TYPES.has(segmentType)) {
      finalizationFailure("malformed", "finalization segment type is invalid");
    }
    if (typeof segment.text !== "string" || !segment.text.trim()) {
      finalizationFailure("malformed", "finalization segment text is empty");
    }
    if (!Array.isArray(segment.source_ids) || !segment.source_ids.every(
      (value) => typeof value === "string" && value.length > 0,
    )) {
      finalizationFailure("malformed", "finalization segment source ids are invalid");
    }
    if (segmentType === "fiction" && segment.source_ids.length !== 0) {
      finalizationFailure("malformed", "fiction segment must not expose source ids");
    }
    if (segmentType !== "fiction" && segment.source_ids.length === 0) {
      finalizationFailure("malformed", "mechanic segment must cite source ids");
    }
    if (segment.source_ids.some((sourceId) => seenSourceIds.has(sourceId))) {
      finalizationFailure("malformed", "finalization mechanic source id is duplicated");
    }
    segment.source_ids.forEach((sourceId) => seenSourceIds.add(sourceId));
  }
  if (segments[0].segment_type !== "fiction") {
    finalizationFailure("malformed", "finalization must begin with fiction");
  }
  const composed = segments.map((segment) => segment.text).join("\n\n");
  if (composed !== renderedText) {
    finalizationFailure("rendered_mismatch", "finalization segments do not compose rendered_text");
  }
  const reconstructedDraft = segments
    .filter((segment) => segment.segment_type === "fiction")
    .map((segment) => segment.text)
    .join("\n\n");
  if (canonicalDigest(reconstructedDraft) !== draftSha256) {
    finalizationFailure("digest_mismatch", "finalization fiction hash mismatch");
  }
}

export function validateFinalizationReceipt(receipt) {
  if (!hasExactKeys(receipt, FINALIZATION_FIELDS) || receipt.schema_version !== 1) {
    finalizationFailure("malformed", "turn finalization receipt has an invalid shape");
  }
  for (const key of [
    "finalization_id", "decision_id", "journal_decision_id", "rendered_text",
  ]) {
    if (typeof receipt[key] !== "string" || !receipt[key]) {
      finalizationFailure("malformed", `turn finalization ${key} is invalid`);
    }
  }
  for (const key of [
    "source_digest", "draft_sha256", "coverage_sha256", "bundle_sha256",
    "rendered_sha256", "integrity_digest",
  ]) {
    if (!isDigest(receipt[key])) {
      finalizationFailure("malformed", `turn finalization ${key} is invalid`);
    }
  }
  for (const key of ["journal_call_index", "source_start_index", "source_end_index"]) {
    if (!Number.isInteger(receipt[key]) || receipt[key] < 0) {
      finalizationFailure("malformed", `turn finalization ${key} is invalid`);
    }
  }
  if (
    receipt.source_start_index > receipt.source_end_index ||
    receipt.source_end_index !== receipt.journal_call_index
  ) {
    finalizationFailure("malformed", "turn finalization source window is invalid");
  }
  for (const key of ["source_roll_ids", "obligation_ids", "coverage_ids"]) {
    if (!Array.isArray(receipt[key]) || !receipt[key].every(
      (value) => typeof value === "string" && value.length > 0,
    ) || new Set(receipt[key]).size !== receipt[key].length) {
      finalizationFailure("malformed", `turn finalization ${key} is invalid`);
    }
  }
  if (
    receipt.obligation_ids.length !== receipt.coverage_ids.length ||
    receipt.obligation_ids.some((value, index) => value !== receipt.coverage_ids[index])
  ) {
    finalizationFailure("malformed", "turn finalization coverage identity is incomplete");
  }
  if (!receipt.bundle || typeof receipt.bundle !== "object" || Array.isArray(receipt.bundle)) {
    finalizationFailure("malformed", "turn finalization bundle is invalid");
  }
  if (!Array.isArray(receipt.coverage)) {
    finalizationFailure("malformed", "turn finalization coverage is invalid");
  }
  validateSegments(receipt.segments, receipt.rendered_text, receipt.draft_sha256);
  const expectedSources = new Set();
  for (const [segmentType, sourceKey] of [
    ["public_check", "roll_id"],
    ["state_delta", "effect_id"],
    ["exceptional_effect", "event_id"],
  ]) {
    const rows = receipt.bundle[segmentType] || [];
    if (!Array.isArray(rows)) {
      finalizationFailure("malformed", "turn finalization bundle mechanic rows are invalid");
    }
    for (const row of rows) {
      const sourceId = row && row[sourceKey];
      if (typeof sourceId !== "string" || sourceId.length === 0) {
        finalizationFailure("malformed", "turn finalization bundle mechanic source is invalid");
      }
      expectedSources.add(`${segmentType}\u0000${sourceId}`);
    }
  }
  const renderedSources = new Set();
  for (const segment of receipt.segments) {
    if (segment.segment_type === "fiction") continue;
    for (const sourceId of segment.source_ids) {
      renderedSources.add(`${segment.segment_type}\u0000${sourceId}`);
    }
  }
  if (
    expectedSources.size !== renderedSources.size ||
    [...expectedSources].some((source) => !renderedSources.has(source))
  ) {
    finalizationFailure("malformed", "turn finalization mechanic placement is incomplete");
  }
  if (canonicalDigest(receipt.coverage) !== receipt.coverage_sha256) {
    finalizationFailure("digest_mismatch", "turn finalization coverage hash mismatch");
  }
  if (canonicalDigest(receipt.bundle) !== receipt.bundle_sha256) {
    finalizationFailure("digest_mismatch", "turn finalization bundle hash mismatch");
  }
  if (canonicalDigest(receipt.rendered_text) !== receipt.rendered_sha256) {
    finalizationFailure("digest_mismatch", "turn finalization rendered hash mismatch");
  }
  const body = Object.fromEntries(
    Object.entries(receipt).filter(([key]) => key !== "integrity_digest"),
  );
  if (canonicalDigest(body) !== receipt.integrity_digest) {
    finalizationFailure("digest_mismatch", "turn finalization integrity digest mismatch");
  }
  return receipt;
}

function finalizationLogPath(request) {
  const campaignId = String(request.campaign_id || "");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(campaignId)) {
    finalizationFailure("malformed_request", "campaign_id is invalid");
  }
  return path.join(
    path.resolve(String(request.workspace)), ".coc", "campaigns", campaignId,
    "logs", "turn-finalizations.jsonl",
  );
}

function readOneNewFinalization(request) {
  const offset = request.finalization_offset;
  if (!Number.isSafeInteger(offset) || offset < 0) {
    finalizationFailure("malformed_request", "finalization_offset is invalid");
  }
  const logPath = finalizationLogPath(request);
  let bytes;
  try {
    bytes = fs.readFileSync(logPath);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      finalizationFailure("missing", "keeper turn produced no finalization receipt");
    }
    finalizationFailure("unreadable", "keeper turn finalization log is unreadable");
  }
  if (offset > bytes.length || (offset > 0 && bytes[offset - 1] !== 0x0a)) {
    finalizationFailure("offset_mismatch", "keeper turn finalization offset is invalid");
  }
  let appended;
  try {
    appended = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(offset));
  } catch {
    finalizationFailure("malformed", "new turn finalization bytes are not UTF-8");
  }
  const lines = appended.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length !== 1) {
    finalizationFailure(
      lines.length === 0 ? "missing" : "ambiguous",
      lines.length === 0
        ? "keeper turn produced no finalization receipt"
        : "keeper turn produced multiple finalization receipts",
    );
  }
  let receipt;
  try {
    receipt = JSON.parse(lines[0]);
  } catch {
    finalizationFailure("malformed", "new turn finalization receipt is malformed JSON");
  }
  return validateFinalizationReceipt(receipt);
}

function finalizationProjection(receipt) {
  return {
    finalization_id: receipt.finalization_id,
    journal_decision_id: receipt.journal_decision_id,
    rendered_sha256: receipt.rendered_sha256,
    integrity_digest: receipt.integrity_digest,
    segments: receipt.segments.map((segment) => ({
      segment_type: segment.segment_type,
      text: segment.text,
      source_ids: [...segment.source_ids],
    })),
  };
}

export function finalizedKeeperOutput(request, assistantText) {
  const receipt = readOneNewFinalization(request);
  if (typeof assistantText !== "string" || assistantText !== receipt.rendered_text) {
    process.stderr.write(
      `[keeper] warning: model echo does not match rendered_text (soft)\n`,
    );
  }
  return {
    ok: true,
    narration: receipt.rendered_text,
    finalization: finalizationProjection(receipt),
  };
}

function readStdinJson() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => {
      const text = chunks.join("").trim();
      if (!text) return reject(new Error("empty stdin"));
      try {
        resolve(JSON.parse(text));
      } catch (err) {
        reject(new Error(`invalid JSON on stdin: ${err.message}`));
      }
    });
    process.stdin.on("error", reject);
  });
}

function writeResult(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

export async function resolveRequestedModel({ agentDir, provider, modelId }) {
  const modelRuntime = await ModelRuntime.create({
    authPath: path.join(agentDir, "auth.json"),
    modelsPath: path.join(agentDir, "models.json"),
  });
  let model = modelRuntime.getModel(provider, modelId);
  if (!model && (provider === "coding-relay" || provider === "cursor-relay")) {
    const template = modelRuntime
      .getModels(provider)
      .find(
        (candidate) => modelRuntime.hasConfiguredAuth(candidate.provider),
      );
    if (template) {
      model = { ...template, id: modelId, name: modelId };
    }
  }
  if (!model || !modelRuntime.hasConfiguredAuth(model.provider)) {
    throw new Error(`requested model unavailable: ${provider}/${modelId}`);
  }
  return { model, modelRuntime };
}

export function keeperSystemPrompt(request) {
  const projectRoot = path.resolve(String(request.runtime_project_root));
  const installedProjectRoot = path.resolve(__dirname, "../../..");
  if (projectRoot !== installedProjectRoot) {
    throw new Error("runtime_project_root does not identify this runtime installation");
  }
  const pythonCommand = `uv run --project ${JSON.stringify(projectRoot)} --frozen python`;
  const continuationPolicy = request.run_policy === "continue_until_scenario_terminal"
    ? [
        "This is a continuous operator long-play run. Do not create an optional",
        "cliffhanger merely because one encounter ended or an actor became temporarily",
        "unplayable. Continue established aftermath toward the scenario conclusion unless",
        "a real session boundary or hard rules blocker exists. A player's explicit decision",
        "to abandon the objective is a real retreat boundary; record it instead of",
        "leaving the host waiting after closed prose.",
      ]
    : [];
  return [
    "You are the KEEPER (game master) of the active campaign's tabletop ruleset,",
    "running inside an AI coding agent with shell access to the project workspace.",
    "",
    "The loaded kernel protocol skills define table duties; the loaded active-ruleset",
    "skill pack defines package-specific mechanics and craft. Use those active skills",
    "semantically when their cases arise; no advisory or package skill is mandatory per turn.",
    "Your toolbox is the CLI at:",
    `  ${pythonCommand} ${request.toolbox_path} <tool> --root . --campaign ${request.campaign_id} --json '<args>'`,
    ...(request.run_id
      ? [
          `The current play/report segment run_id is ${request.run_id}.`,
          "The host exports it to toolbox subprocesses; preserve it when a tool exposes run_id.",
        ]
      : []),
    "Session continuity:",
    `- First turn in a fresh agent process: call session.resume via`,
    `  ${pythonCommand} ${request.toolbox_path} session.resume --root . --campaign ${request.campaign_id} --json '{}'`,
    "  Use that bounded packet instead of listing the toolbox or rescanning .coc.",
    "- Later turns in the SAME warm agent process: keep your chat/tool memory of this",
    "  table. Do NOT invent earlier beats, and do NOT cold-rebuild from zero. Call",
    "  session.resume only for true recovery (pending_finalization, lost continuity,",
    "  or host epoch change). Disk remains authoritative for numbers/writes.",
    "If resume mode is pending_finalization, finish and echo that already-journaled",
    "turn without accepting this request as a new action; never reroll or repeat state.",
    "If the prior delivery is unconfirmed but this request is a genuine reply to it,",
    "the reply itself proves delivery; continue normally and let state.journal record it.",
    "",
    "Hard rules (everything else is your judgment):",
    "1. Dice and deterministic arithmetic are real: never invent or adjust them; use the",
    "   active rules.* operations and render their authoritative public results faithfully.",
    "2. Persistent state writes go through canonical state/rules operations, never hand edits.",
    "3. Module truth is read-only: fields marked secret are your reference; reveal through play, never as exposition.",
    "4. No played turn reaches the player without one canonical turn.finalize receipt.",
    "   When calling state.journal, copy this request's Player input byte-for-byte into player_text; keep player_action as a separate summary, and pass run_id when supplied.",
    "",
    // Always-on table craft from coc-keeper-play Core Keeper Response Contract.
    // Not a fifth tool gate — prompt-level drafting only (same as language_guidance).
    "Action uptake (always-on craft): when the player commits to an in-fiction action or",
    "speaks as the investigator, the final player-facing prose must first show the",
    "investigator actually doing that (method, target, precautions, spoken words) before",
    "or alongside the settled outcome. Jumping straight to a roll label, clue dump, or",
    "destination without that short uptake is a failed reply. Enact the declaration in",
    "fiction; do not quote the whole player message back as a log entry or OOC summary.",
    "",
    "Continuity (cold-start absolute): this agent session is disposable. Campaign truth",
    "is only disk state via session.resume plus the Recent public transcript injected",
    "below. NEVER invent prior player actions, prior permissions, prior scene moves, or",
    "prior rolls that are not present in that transcript / resume packet. If access,",
    "location, or who is present is unclear, call session.resume / scene.context and",
    "stay with the established beat — do not retcon progress to explain a missing die.",
    "Do not answer table-meta questions by fabricating earlier table events.",
    "",
    "Turn shape: ground yourself in recovered state, interpret the player's intent",
    "semantically, resolve only the risks the active package supports, apply every",
    "authoritative state change, and own the fictional causality and final prose.",
    "Do not infer structured facts, permissions, or rewards from keyword hits in prose.",
    "",
    "Narrative momentum (mandatory): every turn, after grounding and before drafting",
    "fiction, call director.advise. Read its candidate_plan: adopt the top-priority",
    "scene_action (REVEAL, PRESSURE, RECOVER, CUT, etc.) and any npc_moves whose",
    "agenda deadline has arrived. If the player's explicit action clearly overrides",
    "the plan, note why and proceed with the player's beat instead — but never skip",
    "the consultation itself. NPCs with unresolved agendas do not wait for the player",
    "to ask; when director.advise flags an agenda move, enact it in this turn's fiction.",
    "Every played turn closes synchronously with state.journal. On a terminal turn,",
    "call state.end_session first, then still call state.journal; terminal settlement",
    "does not replace the journal boundary.",
    "Before writing the final message, make one semantic judgment: does play continue,",
    "or did the player/fiction establish an actual session boundary? If it is a boundary,",
    "state.journal is not a substitute: call state.end_session exactly once with the",
    "matching structured kind. A retreat may leave the scenario unresolved. Never write",
    "a definitive closing narration while leaving the structured ending receipt absent.",
    ...continuationPolicy,
    "Never defer authoritative dice, resources, campaign/actor state, journal, ending,",
    "or finalization writes. Only append-only JSONL audit/mirror flushing may happen",
    "in the background; it must not change the already-settled game state.",
    "After state settlement and state.journal, call turn.output_context, draft causal",
    "fiction as paragraphs covering every returned obligation. In turn.finalize, place",
    "every deterministic mechanic and player-visible change exactly once, with causal",
    "coverage and secrecy-preserving dispositions for concealed obligations. Then call",
    "turn.finalize and do not call another tool afterward. Director, Storylet, narration",
    "and package advisory methods remain optional craft aids, never a mandatory pipeline.",
    `Narrate in ${request.play_language || "zh-Hans"}.`,
    ...(Array.isArray(request.language_guidance) && request.language_guidance.length
      ? request.language_guidance.map((line) => String(line))
      : []),
    "",
    "Your FINAL assistant message must echo turn.finalize.rendered_text byte-for-byte.",
    "Do not add tool logs, JSON, meta commentary, or text before/after it. The receipt",
    "already owns immersive fiction plus the exact public dice and state/context changes.",
    "",
    "CRITICAL OUTPUT DISCIPLINE: Every assistant text block you emit is potentially",
    "visible to the player. NEVER write internal reasoning, tool-call planning, parameter",
    "debugging, schema exploration, or decision process as assistant text. Your thinking",
    "belongs in tool calls only. If you need to reason about which tool to call next,",
    "just call it — do not narrate your planning to the player. Text like 'Let me create",
    "the campaign first' or 'Setup returned an identity-only projection' is a defect.",
  ].join("\n");
}

function buildPromptText(request, { warmContinue = false } = {}) {
  const sections = [];
  if (warmContinue) {
    sections.push(
      "## Continued warm session",
      "You already have this campaign's prior turns, tool results, and table history in",
      "this agent context. Do not invent or overwrite earlier beats. Adjudicate only the",
      "new player input below.",
      "",
      "## Player input (this turn)",
      String(request.player_input ?? ""),
      "",
      "Continue the table now. Final assistant message = turn.finalize.rendered_text only.",
      "Drafting order: enact THIS player input first (action uptake), then consequences.",
    );
    return sections.join("\n");
  }
  const tail = Array.isArray(request.transcript_tail) ? request.transcript_tail : [];
  if (tail.length) {
    sections.push(
      "## Recent public transcript (authoritative table history for this campaign)",
      "Only these player/keeper lines (plus session.resume) establish what already happened.",
      "Do not invent earlier actions, permissions, or rolls outside this history.",
      tail
        .map((row) => `[${row && row.role ? row.role : "?"}] ${row && row.text ? row.text : ""}`)
        .join("\n\n"),
      "",
    );
  } else {
    sections.push(
      "## Recent public transcript",
      "(empty — no prior public table lines; treat this as the opening of public play history)",
      "",
    );
  }
  sections.push(
    "## Player input (this turn)",
    String(request.player_input ?? ""),
    "",
    "Run the keeper turn now. Remember: final message = pure player-facing narration.",
    "Ordinary reply drafting order: first enact THIS player input in fiction (action uptake),",
    "then the settled consequences, dice, and reveals. Do not re-enact fabricated prior beats.",
  );
  return sections.join("\n");
}

function extractFinalProse(messages) {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg || msg.role !== "assistant") continue;
    const content = msg.content;
    if (!Array.isArray(content)) continue;
    const texts = content
      .filter((c) => c && c.type === "text" && typeof c.text === "string")
      .map((c) => c.text)
      .filter((text) => text.trim().length > 0);
    if (texts.length) return texts.join("\n");
  }
  return "";
}

function selectedModelIdentity(session) {
  const model = session && session.model;
  if (
    !model ||
    typeof model.provider !== "string" ||
    !model.provider.trim() ||
    typeof model.id !== "string" ||
    !model.id.trim()
  ) {
    return undefined;
  }
  return { provider: model.provider.trim(), id: model.id.trim() };
}

function attachStreamBridge(session, usageState) {
  // Streaming bridge: player-safe progress on stderr as NDJSON {"$stream":...}.
  // Narration deltas are withheld until turn.finalize succeeds.
  let finalizeSeen = false;
  let deltaEmitted = false;
  const toolNames = new Map();
  const streamLine = (obj) => {
    try {
      process.stderr.write(JSON.stringify(obj) + "\n");
    } catch {
      // best-effort
    }
  };
  const streamToolName = (toolName, args) => {
    if (toolName === "bash") {
      const command = args && typeof args.command === "string" ? args.command : "";
      const match = command.match(/coc_toolbox\.py\s+([A-Za-z0-9_.-]+)/);
      return match ? match[1] : "shell";
    }
    if (args && typeof args === "object") {
      const inner = args.tool || args.name || args.operation;
      if (typeof inner === "string" && inner) return `${toolName}:${inner}`;
    }
    return String(toolName || "tool");
  };
  return session.subscribe((event) => {
    if (!event || typeof event !== "object") return;
    if (event.type === "message_end" && event.message) {
      const msg = event.message;
      if (msg.role === "assistant") {
        const usage = msg.usage;
        if (usage && typeof usage === "object") {
          if (Number.isInteger(usage.input)) {
            usageState.input = (usageState.input || 0) + usage.input;
          }
          if (Number.isInteger(usage.output)) {
            usageState.output = (usageState.output || 0) + usage.output;
          }
        }
      }
      return;
    }
    if (event.type === "tool_execution_start") {
      const tool = streamToolName(event.toolName, event.args);
      if (event.toolCallId) toolNames.set(event.toolCallId, tool);
      if (finalizeSeen) {
        if (deltaEmitted) streamLine({ $stream: "delta_reset" });
        deltaEmitted = false;
        finalizeSeen = false;
      }
      streamLine({ $stream: "tool", phase: "start", tool });
      return;
    }
    if (event.type === "tool_execution_end") {
      const tool =
        (event.toolCallId && toolNames.get(event.toolCallId)) ||
        streamToolName(event.toolName, event.args);
      if (event.toolCallId) toolNames.delete(event.toolCallId);
      if (
        !event.isError &&
        (tool === "turn.finalize" || tool === "coc_invoke:turn.finalize")
      ) {
        finalizeSeen = true;
      }
      streamLine({ $stream: "tool", phase: "end", tool });
      return;
    }
    if (
      event.type === "message_update" &&
      finalizeSeen &&
      event.assistantMessageEvent &&
      event.assistantMessageEvent.type === "text_delta" &&
      typeof event.assistantMessageEvent.delta === "string"
    ) {
      deltaEmitted = true;
      streamLine({ $stream: "delta", text: event.assistantMessageEvent.delta });
    }
  });
}

async function createKeeperSession(request) {
  const cwd = path.resolve(String(request.workspace));
  const agentDir = getAgentDir();
  const skillDirs = request.skills_dirs;
  if (
    !Array.isArray(skillDirs) ||
    skillDirs.length !== 2 ||
    skillDirs.some((dir) => typeof dir !== "string" || !dir.trim())
  ) {
    throw new Error("skills_dirs must contain kernel and active ruleset paths");
  }
  const piExtensionPath = path.resolve(
    path.dirname(path.resolve(request.toolbox_path)),
    "../pi/extensions/index.ts",
  );
  if (!process.env.COC_PI_COMMAND) {
    process.env.COC_PI_COMMAND = path.resolve(
      __dirname,
      "node_modules/@earendil-works/pi-coding-agent/dist/cli.js",
    );
  }

  // Capture bootstrap request for system prompt; warm turns keep this shell.
  const bootstrapRequest = { ...request, warm_continue: false };
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    additionalExtensionPaths: [piExtensionPath],
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPromptOverride: () => keeperSystemPrompt(bootstrapRequest),
    skillsOverride: () => {
      const loaded = skillDirs.map((dir, index) => loadSkillsFromDir({
        dir: path.resolve(dir),
        source: index === 0 ? "coc-keeper-kernel" : "coc-keeper-ruleset",
      }));
      const skills = loaded.flatMap((result) => result.skills);
      const diagnostics = loaded.flatMap((result) => result.diagnostics);
      const names = new Set();
      for (const skill of skills) {
        if (names.has(skill.name)) {
          throw new Error(`duplicate keeper skill name: ${skill.name}`);
        }
        names.add(skill.name);
      }
      return { skills, diagnostics };
    },
  });
  await loader.reload();

  const provider = process.env.COC_KEEPER_MODEL_PROVIDER || "coding-relay";
  const modelId = process.env.COC_KEEPER_MODEL_ID || "gpt-5.6-luna";
  const { model, modelRuntime } = await resolveRequestedModel({
    agentDir, provider, modelId,
  });

  const { session } = await createAgentSession({
    cwd,
    agentDir,
    noTools: "builtin",
    model,
    modelRuntime,
    thinkingLevel: "off",
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(cwd),
  });
  return session;
}

/**
 * @param {object} request
 * @param {{ session?: any, campaign_id?: string, workspace?: string } | null} serverState
 *        When provided, the agent session is kept warm across turns (CLI-like).
 */
export async function runKeeperTurn(request, serverState = null) {
  for (const key of [
    "workspace", "campaign_id", "player_input", "play_language", "skills_dirs",
    "toolbox_path", "runtime_project_root", "finalization_offset",
  ]) {
    if (!(key in request)) throw new Error(`request missing ${key}`);
  }
  if (request.run_id !== undefined) {
    const runId = String(request.run_id).trim();
    if (!runId) throw new Error("run_id must be non-empty when supplied");
    process.env.COC_PLAYTEST_RUN_ID = runId;
  } else {
    delete process.env.COC_PLAYTEST_RUN_ID;
  }

  const warmContinue = Boolean(
    serverState &&
      serverState.session &&
      serverState.campaign_id === String(request.campaign_id) &&
      serverState.workspace === path.resolve(String(request.workspace)),
  );

  let session = warmContinue ? serverState.session : null;
  let ownsSession = false;
  if (!session) {
    session = await createKeeperSession(request);
    ownsSession = true;
    if (serverState) {
      serverState.session = session;
      serverState.campaign_id = String(request.campaign_id);
      serverState.workspace = path.resolve(String(request.workspace));
      ownsSession = false; // server owns disposal
    }
  }

  const usageState = { input: null, output: null };
  const unsubscribe = attachStreamBridge(session, usageState);
  try {
    const promptRequest = warmContinue
      ? { ...request, warm_continue: true }
      : request;
    await session.prompt(buildPromptText(promptRequest, { warmContinue }));
    const assistantText = extractFinalProse(session.messages);
    const result = finalizedKeeperOutput(request, assistantText);
    const identity = selectedModelIdentity(session);
    if (identity) result.model_identity = identity;
    if (usageState.input !== null || usageState.output !== null) {
      result.usage = {
        input_tokens: usageState.input,
        output_tokens: usageState.output,
      };
    }
    if (serverState) result.warm_session = warmContinue ? "continued" : "started";
    return result;
  } finally {
    unsubscribe();
    if (ownsSession) session.dispose();
  }
}

async function main() {
  try {
    const request = await readStdinJson();
    const result = await runKeeperTurn(request);
    writeResult(result);
    process.exit(result.ok ? 0 : 1);
  } catch (err) {
    const result = { ok: false, error: err && err.message ? err.message : String(err) };
    if (err instanceof KeeperFinalizationError) {
      result.error_code = err.code;
      result.error_reason = err.reason;
      result.turn_committed = true;
    }
    writeResult(result);
    process.exit(1);
  }
}

async function serveJsonl() {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const serverState = {};
  for await (const line of lines) {
    if (!line || !String(line).trim()) continue;
    let envelope;
    try {
      envelope = JSON.parse(line);
      if (
        !envelope ||
        typeof envelope !== "object" ||
        typeof envelope.request_id !== "string"
      ) {
        throw new Error("server request requires request_id");
      }
      const result = await runKeeperTurn(envelope.payload || {}, serverState);
      writeResult({ request_id: envelope.request_id, ...result });
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      const result = {
        request_id: envelope && envelope.request_id,
        ok: false,
        error: message,
      };
      if (err instanceof KeeperFinalizationError) {
        result.error_code = err.code;
        result.error_reason = err.reason;
        result.turn_committed = true;
      }
      writeResult(result);
    }
  }
  if (serverState.session) {
    try {
      serverState.session.dispose();
    } catch {
      // ignore
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--server")) {
    serveJsonl().catch((err) => {
      process.stderr.write(`${err && err.message ? err.message : String(err)}\n`);
      process.exitCode = 1;
    });
  } else {
    main();
  }
}
