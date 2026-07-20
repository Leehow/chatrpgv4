#!/usr/bin/env node
/**
 * Full Pi coding-agent Keeper turn.
 *
 * Pi is an AI coding agent like Codex/Claude Code/Cursor. This thin host
 * shell spawns a pi-coding-agent session with the canonical COC keeper
 * skills loaded and read/bash/grep/ls tools enabled, so the keeper LLM reads
 * the same SKILL.md tree and calls the same coc_toolbox.py CLI as every
 * other host. The only last-mile gate is the canonical settled-turn
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
 *     skills_dir,           // plugins/coc-keeper/skills (absolute)
 *     toolbox_path          // plugins/coc-keeper/scripts/coc_toolbox.py (absolute)
 *   }
 * stdout: { ok: true, narration, finalization, model_identity?, usage? }
 *      or { ok: false, error, error_code? }
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  AuthStorage,
  createAgentSession,
  createExtensionRuntime,
  DefaultResourceLoader,
  ModelRegistry,
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
    finalizationFailure(
      "model_output_mismatch",
      "keeper final message does not exactly echo finalized rendered_text",
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

export function resolveRequestedModel({ agentDir, provider, modelId }) {
  const authStorage = AuthStorage.create(path.join(agentDir, "auth.json"));
  const modelRegistry = ModelRegistry.create(
    authStorage,
    path.join(agentDir, "models.json"),
  );
  let model = modelRegistry.find(provider, modelId);
  if (!model && (provider === "coding-relay" || provider === "cursor-relay")) {
    const template = modelRegistry
      .getAll()
      .find(
        (candidate) =>
          candidate.provider === provider &&
          modelRegistry.hasConfiguredAuth(candidate),
      );
    if (template) {
      model = { ...template, id: modelId, name: modelId };
    }
  }
  if (!model || !modelRegistry.hasConfiguredAuth(model)) {
    throw new Error(`requested model unavailable: ${provider}/${modelId}`);
  }
  return { model, modelRegistry };
}

function keeperSystemPrompt(request) {
  const projectRoot = path.resolve(path.dirname(request.toolbox_path), "../../..");
  const pythonCommand = `uv run --project ${JSON.stringify(projectRoot)} --frozen python`;
  const continuationPolicy = request.run_policy === "continue_until_scenario_terminal"
    ? [
        "This is a continuous operator long-play run. Do not create an optional",
        "cliffhanger merely because a combat ended or a living investigator became",
        "temporarily unplayable. Continue established rescue/aftermath toward the",
        "scenario conclusion unless a real session boundary or hard rules blocker exists.",
        "A player's explicit decision to abandon the investigation is a real retreat",
        "boundary even when the scenario threat survives; record it as such instead of",
        "leaving the host waiting after closed prose.",
      ]
    : [];
  return [
    "You are the KEEPER (game master) of a Call of Cthulhu 7e tabletop session,",
    "running inside an AI coding agent with shell access to the project workspace.",
    "",
    "Canonical behavior contract: the coc-keeper-play skill (already loaded).",
    "Your toolbox is the CLI at:",
    `  ${pythonCommand} ${request.toolbox_path} <tool> --root . --campaign ${request.campaign_id} --json '<args>'`,
    ...(request.run_id
      ? [
          `The current play/report segment run_id is ${request.run_id}.`,
          "The host exports it to toolbox subprocesses; preserve it when a tool exposes run_id.",
        ]
      : []),
    "Your first campaign command in this fresh agent context must be:",
    `  ${pythonCommand} ${request.toolbox_path} session.resume --root . --campaign ${request.campaign_id} --json '{}'`,
    "Use that bounded packet instead of listing the toolbox, rereading .coc, or",
    "rescanning history. Only describe or discover one exact long-tail operation",
    "later when the current adjudication actually needs it.",
    "If resume mode is pending_finalization, finish and echo that already-journaled",
    "turn without accepting this request as a new action; never reroll or repeat state.",
    "If the prior delivery is unconfirmed but this request is a genuine reply to it,",
    "the reply itself proves delivery; continue normally and let state.journal record it.",
    "",
    "Hard rules (everything else is your judgment):",
    "1. Dice are real: never invent roll numbers or HP/SAN arithmetic; use rules.* tools and quote results faithfully.",
    "2. State writes go through state.* / rules.* tools, never hand edits.",
    "3. Module truth is read-only: fields marked secret are your reference; reveal through play, never as exposition.",
    "4. No played turn reaches the player without one canonical turn.finalize receipt.",
    "   When calling state.journal, copy this request's Player input byte-for-byte into player_text; keep player_action as a separate summary, and pass run_id when supplied.",
    "",
    "Turn shape: ground yourself, resolve risk, and decide the narration and consequences.",
    "Generic rules.opposed is noncombat-only and requires contest_kind=noncombat.",
    "Every attack, Dodge, or Fight Back uses combat.resolve with the exact",
    "structured defense_kind: equal success levels favor a dodger but favor the",
    "attacker against Fight Back. Never route melee through generic opposed dice.",
    "Then synchronously finish every rules.* resource change and critical state.* write.",
    "A critical, fumble, or failed pushed roll is not closed by prose alone.",
    "Before state.journal, apply one source-bound state.exceptional_effect with a",
    "real benefit/cost, causal link, and explicit boundary. Plain elapsed time or",
    "a named flag is insufficient. A one-shot bonus/penalty must be carried by the",
    "next exact-scope rules.roll and consumed through state.exceptional_effect before journaling.",
    "Read scene.context.continuity.active_exceptional_effects and honor active bounded",
    "conditions, restrictions, events, and modifiers as canonical continuity.",
    "For every investigator/NPC pair's first substantive contact, call npc.reaction",
    "once with a localized npc_display_name and structured semantic context, then bind",
    "that receipt plus a causal first_impression_realization in its own",
    "state.record_npc_engagement. A journal may have 0..N NPC engagements, interleaved",
    "NPC speech, and NPC-to-NPC dialogue; never keep only the first or last NPC.",
    "Each critical/fumble first-impression roll owns an independent exceptional effect.",
    "Later relationship change uses state.npc_update. An earned NPC-scoped bonus die",
    "must link that update, match rules.roll npc_id+skill, and be consumed explicitly;",
    "no keyword in free prose automatically changes trust or grants a reward.",
    "A completed full sleep in a safe place needs two structured writes: advance its",
    "actual minutes with state.advance_time, then call state.mark_safe_rest with",
    "rest_kind=full_sleep. Never infer completed rest from reason/player prose.",
    "Every played turn closes synchronously with state.journal. On a terminal turn,",
    "call state.end_session first, then still call state.journal; terminal settlement",
    "does not replace the journal boundary.",
    "Before writing the final message, make one semantic judgment: does play continue,",
    "or did the player/fiction establish an actual session boundary? If it is a boundary,",
    "state.journal is not a substitute: call state.end_session exactly once with the",
    "matching structured kind. A retreat may leave the scenario unresolved. Never write",
    "a definitive closing narration while leaving the structured ending receipt absent.",
    "state.end_session synchronously returns development PASS or PENDING; a PENDING result",
    "does not reopen or invalidate the ending and may be replayed with the same identity.",
    ...continuationPolicy,
    "Never defer dice, HP/SAN/Luck, clues, NPC state, time, scene, journal, ending,",
    "or development writes. Only append-only JSONL audit/mirror flushing may happen",
    "in the background; it must not change the already-settled game state.",
    "After state settlement and state.journal, call turn.output_context, draft causal",
    "fiction as paragraphs covering every returned obligation. In turn.finalize, place",
    "every deterministic mechanic exactly once with mechanics_placements. Put each public",
    "roll after the paragraph that establishes the action/risk and before the later paragraph",
    "that narrates its result; never collect a turn's rolls after all consequences. Then call",
    "npc_performance_constraints are Keeper-only portrayal context: realize each observable_manner",
    "naturally through action or dialogue, but never quote or expose its causal_explanation,",
    "opportunity_or_friction, or boundary_preserved as a structured player-facing block.",
    "turn.finalize. Do not call",
    "another tool afterward. Director, Storylet, narration.brief, and narration.review",
    "remain optional craft methods, never a mandatory pipeline.",
    `Narrate in ${request.play_language || "zh-Hans"}.`,
    "",
    "Your FINAL assistant message must echo turn.finalize.rendered_text byte-for-byte.",
    "Do not add tool logs, JSON, meta commentary, or text before/after it. The receipt",
    "already owns immersive fiction plus the exact public dice and state/context changes.",
  ].join("\n");
}

function buildPromptText(request) {
  const sections = [];
  const tail = Array.isArray(request.transcript_tail) ? request.transcript_tail : [];
  if (tail.length) {
    sections.push(
      "## Recent public transcript",
      tail
        .map((row) => `[${row && row.role ? row.role : "?"}] ${row && row.text ? row.text : ""}`)
        .join("\n"),
      "",
    );
  }
  sections.push(
    "## Player input (this turn)",
    String(request.player_input ?? ""),
    "",
    "Run the keeper turn now. Remember: final message = pure player-facing narration.",
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

export async function runKeeperTurn(request) {
  for (const key of [
    "workspace", "campaign_id", "player_input", "play_language", "skills_dir",
    "toolbox_path", "finalization_offset",
  ]) {
    if (!(key in request)) throw new Error(`request missing ${key}`);
  }
  const cwd = path.resolve(String(request.workspace));
  const agentDir = getAgentDir();
  if (request.run_id !== undefined) {
    const runId = String(request.run_id).trim();
    if (!runId) throw new Error("run_id must be non-empty when supplied");
    process.env.COC_PLAYTEST_RUN_ID = runId;
  } else {
    delete process.env.COC_PLAYTEST_RUN_ID;
  }

  // Same experience as other coding hosts: load the canonical keeper skill
  // tree; keep project context files and unrelated extensions out.
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    noExtensions: true,
    noSkills: true, // replaced below with the explicit keeper tree
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPromptOverride: () => keeperSystemPrompt(request),
    skillsOverride: () => loadSkillsFromDir({
      dir: path.resolve(String(request.skills_dir)),
      source: "coc-keeper",
    }),
    extensionsOverride: () => ({
      extensions: [],
      errors: [],
      runtime: createExtensionRuntime(),
    }),
  });
  await loader.reload();

  const provider = process.env.COC_KEEPER_MODEL_PROVIDER || "coding-relay";
  const modelId = process.env.COC_KEEPER_MODEL_ID || "gpt-5.6-luna";
  const { model, modelRegistry } = resolveRequestedModel({ agentDir, provider, modelId });

  const { session } = await createAgentSession({
    cwd,
    agentDir,
    tools: ["read", "bash", "grep", "ls"],
    model,
    modelRegistry,
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(cwd),
  });

  let usageInput = null;
  let usageOutput = null;
  const unsubscribe = session.subscribe((event) => {
    if (event && event.type === "message_end" && event.message) {
      const msg = event.message;
      if (msg.role === "assistant") {
        const usage = msg.usage;
        if (usage && typeof usage === "object") {
          if (Number.isInteger(usage.input)) usageInput = (usageInput || 0) + usage.input;
          if (Number.isInteger(usage.output)) usageOutput = (usageOutput || 0) + usage.output;
        }
      }
    }
  });

  try {
    await session.prompt(buildPromptText(request));
    const assistantText = extractFinalProse(session.messages);
    const result = finalizedKeeperOutput(request, assistantText);
    const identity = selectedModelIdentity(session);
    if (identity) result.model_identity = identity;
    if (usageInput !== null || usageOutput !== null) {
      result.usage = { input_tokens: usageInput, output_tokens: usageOutput };
    }
    return result;
  } finally {
    unsubscribe();
    session.dispose();
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
