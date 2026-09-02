import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { isCanonicalCampaignId } from "./campaign-id.mjs";

const SCHEMA_VERSION = 2;
const KIND = "coc_open_turn_player_input";
const MAX_PLAYER_INPUT_CHARS = 200_000;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const SEMANTIC_TIMELINE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const RECORD_FIELDS = new Set([
  "schema_version",
  "kind",
  "campaign_id",
  "text",
  "text_sha256",
  "speaker",
  "intent_source",
  "source_session_id",
  "source_player_turn_epoch",
  "anchor",
]);

const ANCHOR_FIELDS = new Set([
  "schema_version",
  "kind",
  "timeline_id",
  "prior_finalized_turn",
  "prior_finalized_source_digest",
  "next_turn_ordinal",
  "anchor_digest",
]);

export type OpenTurnAnchor = {
  schema_version: 1;
  kind: "coc_open_turn_anchor";
  timeline_id: string;
  prior_finalized_turn: number;
  prior_finalized_source_digest: string | null;
  next_turn_ordinal: number;
  anchor_digest: string;
};

type StoredOpenTurnPlayerInput = {
  schema_version: 2;
  kind: typeof KIND;
  campaign_id: string;
  text: string;
  text_sha256: string;
  speaker: "player";
  intent_source: "external_player_message";
  source_session_id: string;
  source_player_turn_epoch: number;
  anchor: OpenTurnAnchor;
};

export type OpenTurnPlayerInputCard = {
  schema_version: 1;
  kind: "accepted_player_input";
  audience: "keeper_only";
  text: string;
  speaker: "player";
  intent_source: "external_player_message";
};

export type OpenTurnPlayerInputLoad =
  | { ok: true; card: OpenTurnPlayerInputCard }
  | {
      ok: false;
      code:
        | "missing"
        | "invalid_campaign"
        | "invalid_anchor"
        | "anchor_mismatch"
        | "not_open_pre_journal_turn"
        | "corrupt_or_tampered";
    };

function digestText(text: string): string {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function anchorBody(value: Omit<OpenTurnAnchor, "anchor_digest">) {
  return {
    schema_version: value.schema_version,
    kind: value.kind,
    timeline_id: value.timeline_id,
    prior_finalized_turn: value.prior_finalized_turn,
    prior_finalized_source_digest: value.prior_finalized_source_digest,
    next_turn_ordinal: value.next_turn_ordinal,
  };
}

function digestAnchor(value: Omit<OpenTurnAnchor, "anchor_digest">): string {
  return `sha256:${createHash("sha256")
    .update(canonicalJson(anchorBody(value)), "utf8")
    .digest("hex")}`;
}

export function createOpenTurnAnchor(args: {
  timelineId: string;
  priorFinalizedTurn: number;
  priorFinalizedSourceDigest: string | null;
}): OpenTurnAnchor {
  const body: Omit<OpenTurnAnchor, "anchor_digest"> = {
    schema_version: 1,
    kind: "coc_open_turn_anchor",
    timeline_id: args.timelineId,
    prior_finalized_turn: args.priorFinalizedTurn,
    prior_finalized_source_digest: args.priorFinalizedSourceDigest,
    next_turn_ordinal: args.priorFinalizedTurn + 1,
  };
  const candidate = { ...body, anchor_digest: digestAnchor(body) };
  if (!validOpenTurnAnchor(candidate)) {
    throw new Error("open-turn anchor facts are invalid");
  }
  return candidate;
}

export function validOpenTurnAnchor(value: unknown): value is OpenTurnAnchor {
  if (
    !isPlainObject(value)
    || Object.keys(value).length !== ANCHOR_FIELDS.size
    || Object.keys(value).some((key) => !ANCHOR_FIELDS.has(key))
  ) return false;
  const prior = value.prior_finalized_turn;
  const priorSource = value.prior_finalized_source_digest;
  const validPriorSource = Number(prior) === 0
    ? priorSource === null
    : typeof priorSource === "string" && SHA256.test(priorSource);
  if (
    value.schema_version !== 1
    || value.kind !== "coc_open_turn_anchor"
    || typeof value.timeline_id !== "string"
    || !SEMANTIC_TIMELINE.test(value.timeline_id)
    || !Number.isSafeInteger(prior)
    || Number(prior) < 0
    || !Number.isSafeInteger(value.next_turn_ordinal)
    || Number(value.next_turn_ordinal) !== Number(prior) + 1
    || !validPriorSource
    || typeof value.anchor_digest !== "string"
    || !SHA256.test(value.anchor_digest)
  ) return false;
  return value.anchor_digest === digestAnchor(anchorBody(value as OpenTurnAnchor));
}

function sameAnchor(left: OpenTurnAnchor, right: OpenTurnAnchor): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function cachePath(root: string, campaignId: string): string {
  if (!isCanonicalCampaignId(campaignId)) {
    throw new Error("open-turn player input campaign id is invalid");
  }
  return join(
    resolve(root),
    ".coc",
    "runtime",
    "open-turn-player-inputs",
    `${campaignId}.json`,
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validStored(value: unknown, campaignId: string): value is StoredOpenTurnPlayerInput {
  if (
    !isPlainObject(value)
    || Object.keys(value).length !== RECORD_FIELDS.size
    || Object.keys(value).some((key) => !RECORD_FIELDS.has(key))
  ) {
    return false;
  }
  return value.schema_version === SCHEMA_VERSION
    && value.kind === KIND
    && value.campaign_id === campaignId
    && typeof value.text === "string"
    && value.text.trim().length > 0
    && value.text.length <= MAX_PLAYER_INPUT_CHARS
    && value.text_sha256 === digestText(value.text)
    && value.speaker === "player"
    && value.intent_source === "external_player_message"
    && typeof value.source_session_id === "string"
    && value.source_session_id.length > 0
    && Number.isSafeInteger(value.source_player_turn_epoch)
    && Number(value.source_player_turn_epoch) > 0
    && validOpenTurnAnchor(value.anchor);
}

export function validPreJournalWindow(currentTurn: unknown): boolean {
  if (!isPlainObject(currentTurn)) return false;
  if (
    !Number.isSafeInteger(currentTurn.meaningful_row_count)
    || Number(currentTurn.meaningful_row_count) < 1
    || typeof currentTurn.source_digest !== "string"
    || !SHA256.test(currentTurn.source_digest)
    || !Array.isArray(currentTurn.rows)
    || currentTurn.rows.length < 1
  ) return false;
  return !currentTurn.rows.some((value) => {
    const row = isPlainObject(value) ? value : null;
    return row?.tool === "state.journal" && row.ok === true;
  });
}

/**
 * Persist one accepted external player message as host operational state.
 * Different text under the same anchor is never overwritten: it denotes an
 * unresolved accepted action. A different verified anchor replaces only the
 * stale prior-turn/worldline cache.
 */
export function recordOpenTurnPlayerInput(args: {
  root: string;
  campaignId: string;
  sessionId: string;
  playerTurnEpoch: number;
  text: string;
  anchor: OpenTurnAnchor;
}): "recorded" | "replaced_stale" | "idempotent" | "conflict" | "ignored" {
  const text = typeof args.text === "string" ? args.text : "";
  if (
    !text.trim()
    || text.length > MAX_PLAYER_INPUT_CHARS
    || !args.sessionId
    || !Number.isSafeInteger(args.playerTurnEpoch)
    || args.playerTurnEpoch < 1
    || !validOpenTurnAnchor(args.anchor)
  ) return "ignored";
  let path: string;
  try {
    path = cachePath(args.root, args.campaignId);
  } catch {
    return "ignored";
  }
  let prior: unknown = null;
  try {
    prior = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") return "conflict";
  }
  let replacedStale = false;
  if (prior !== null) {
    if (!validStored(prior, args.campaignId)) return "conflict";
    if (sameAnchor(prior.anchor, args.anchor)) {
      return prior.text === text ? "idempotent" : "conflict";
    }
    replacedStale = true;
  }
  const record: StoredOpenTurnPlayerInput = {
    schema_version: 2,
    kind: KIND,
    campaign_id: args.campaignId,
    text,
    text_sha256: digestText(text),
    speaker: "player",
    intent_source: "external_player_message",
    source_session_id: args.sessionId,
    source_player_turn_epoch: args.playerTurnEpoch,
    anchor: structuredClone(args.anchor),
  };
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(record)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  renameSync(temporary, path);
  return replacedStale ? "replaced_stale" : "recorded";
}

/** Hydrate only an exact campaign's verified pre-journal open-turn window. */
export function loadOpenTurnPlayerInput(args: {
  root: string;
  campaignId: string;
  currentTurn: unknown;
  anchor: OpenTurnAnchor;
}): OpenTurnPlayerInputLoad {
  if (!isCanonicalCampaignId(args.campaignId)) {
    return { ok: false, code: "invalid_campaign" };
  }
  if (!validOpenTurnAnchor(args.anchor)) {
    return { ok: false, code: "invalid_anchor" };
  }
  if (!validPreJournalWindow(args.currentTurn)) {
    return { ok: false, code: "not_open_pre_journal_turn" };
  }
  return loadAnchoredPlayerInput(args);
}

function loadAnchoredPlayerInput(args: {
  root: string;
  campaignId: string;
  anchor: OpenTurnAnchor;
}): OpenTurnPlayerInputLoad {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(cachePath(args.root, args.campaignId), "utf8"));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    return { ok: false, code: code === "ENOENT" ? "missing" : "corrupt_or_tampered" };
  }
  if (!validStored(value, args.campaignId)) {
    return { ok: false, code: "corrupt_or_tampered" };
  }
  if (!sameAnchor(value.anchor, args.anchor)) {
    return { ok: false, code: "anchor_mismatch" };
  }
  return {
    ok: true,
    card: {
      schema_version: 1,
      kind: "accepted_player_input",
      audience: "keeper_only",
      text: value.text,
      speaker: "player",
      intent_source: "external_player_message",
    },
  };
}

/**
 * Recover an accepted external input that crashed before its first canonical
 * operation. The caller owns proof that session.resume is awaiting_player with
 * no current/pending turn; this function owns cache, campaign, and anchor
 * integrity only.
 */
export function loadZeroToolOpenTurnPlayerInput(args: {
  root: string;
  campaignId: string;
  anchor: OpenTurnAnchor;
}): OpenTurnPlayerInputLoad {
  if (!isCanonicalCampaignId(args.campaignId)) {
    return { ok: false, code: "invalid_campaign" };
  }
  if (!validOpenTurnAnchor(args.anchor)) {
    return { ok: false, code: "invalid_anchor" };
  }
  return loadAnchoredPlayerInput(args);
}

export function clearOpenTurnPlayerInput(
  root: string,
  campaignId: string,
  anchor: OpenTurnAnchor,
): "cleared" | "missing" | "invalid_anchor" | "anchor_mismatch" | "corrupt" {
  if (!validOpenTurnAnchor(anchor)) return "invalid_anchor";
  let path: string;
  try {
    path = cachePath(root, campaignId);
  } catch {
    return "corrupt";
  }
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return "missing";
    return "corrupt";
  }
  if (!validStored(value, campaignId)) return "corrupt";
  if (!sameAnchor(value.anchor, anchor)) return "anchor_mismatch";
  try {
    unlinkSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return "missing";
    throw error;
  }
  return "cleared";
}
