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

const SCHEMA_VERSION = 1;
const KIND = "coc_open_turn_player_input";
const MAX_PLAYER_INPUT_CHARS = 200_000;
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
]);

type StoredOpenTurnPlayerInput = {
  schema_version: 1;
  kind: typeof KIND;
  campaign_id: string;
  text: string;
  text_sha256: string;
  speaker: "player";
  intent_source: "external_player_message";
  source_session_id: string;
  source_player_turn_epoch: number;
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
        | "not_open_pre_journal_turn"
        | "corrupt_or_tampered";
    };

function digestText(text: string): string {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
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
  if (!isPlainObject(value) || Object.keys(value).some((key) => !RECORD_FIELDS.has(key))) {
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
    && Number(value.source_player_turn_epoch) > 0;
}

function validPreJournalWindow(currentTurn: unknown): boolean {
  if (!isPlainObject(currentTurn)) return false;
  if (
    !Number.isSafeInteger(currentTurn.meaningful_row_count)
    || Number(currentTurn.meaningful_row_count) < 1
    || typeof currentTurn.source_digest !== "string"
    || !currentTurn.source_digest.startsWith("sha256:")
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
 * Existing different text is never overwritten: it denotes an unresolved
 * earlier player turn and must be recovered or failed closed first.
 */
export function recordOpenTurnPlayerInput(args: {
  root: string;
  campaignId: string;
  sessionId: string;
  playerTurnEpoch: number;
  text: string;
}): "recorded" | "idempotent" | "conflict" | "ignored" {
  const text = typeof args.text === "string" ? args.text : "";
  if (
    !text.trim()
    || text.length > MAX_PLAYER_INPUT_CHARS
    || !args.sessionId
    || !Number.isSafeInteger(args.playerTurnEpoch)
    || args.playerTurnEpoch < 1
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
  } catch {
    prior = null;
  }
  if (prior !== null) {
    if (!validStored(prior, args.campaignId)) return "conflict";
    return prior.text === text ? "idempotent" : "conflict";
  }
  const record: StoredOpenTurnPlayerInput = {
    schema_version: 1,
    kind: KIND,
    campaign_id: args.campaignId,
    text,
    text_sha256: digestText(text),
    speaker: "player",
    intent_source: "external_player_message",
    source_session_id: args.sessionId,
    source_player_turn_epoch: args.playerTurnEpoch,
  };
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(record)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  renameSync(temporary, path);
  return "recorded";
}

/** Hydrate only an exact campaign's verified pre-journal open-turn window. */
export function loadOpenTurnPlayerInput(args: {
  root: string;
  campaignId: string;
  currentTurn: unknown;
}): OpenTurnPlayerInputLoad {
  if (!isCanonicalCampaignId(args.campaignId)) {
    return { ok: false, code: "invalid_campaign" };
  }
  if (!validPreJournalWindow(args.currentTurn)) {
    return { ok: false, code: "not_open_pre_journal_turn" };
  }
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

export function clearOpenTurnPlayerInput(root: string, campaignId: string): void {
  try {
    unlinkSync(cachePath(root, campaignId));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
  }
}
