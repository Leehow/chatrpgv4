/**
 * Pure-file display projections for the web UI. Everything here reads
 * canonical campaign/workspace JSON files and formats them — no game
 * semantics, no writes. Projections that need canonical plugin functions
 * (character sheets, module library, engine transcripts) live in the Python
 * sidecar (runtime/sdk/web_views.py) and are reached via sidecar.request().
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { resolveProductAgentDir } from "./agent-dir.mjs";
import { knownThinkingMeta } from "./known-thinking.mjs";
import { loadUserPrefs, resolveUserPrefsPath } from "./user-prefs.mjs";
import {
  buildCombatIndex,
  buildEffectIndex,
  buildLedgerIndex,
  projectKeeperContentBlocks,
} from "./roll-layout.mjs";

// ---------------------------------------------------------------------------
// Workspace file helpers

export const cocRoot = (workspace) => path.join(workspace, ".coc");
export const campaignDir = (workspace, campaignId) =>
  path.join(cocRoot(workspace), "campaigns", campaignId);

/** Sidebar extras: first party investigator name + campaign.json mtime. */
export function campaignListExtras(workspace, campaignId) {
  const dir = campaignDir(workspace, campaignId);
  const party = readJsonFile(path.join(dir, "party.json"));
  const ids = Array.isArray(party?.investigator_ids) ? party.investigator_ids : [];
  const first = typeof ids[0] === "string" ? ids[0].trim() : "";
  let investigator_name = null;
  if (first) {
    const sheets = [
      path.join(cocRoot(workspace), "investigators", first, "character.json"),
      path.join(dir, "investigators", first, "character.json"),
    ];
    for (const file of sheets) {
      const sheet = readJsonFile(file);
      const name = typeof sheet?.name === "string" ? sheet.name.trim() : "";
      if (name) {
        investigator_name = name;
        break;
      }
    }
  }
  // Same priority/signal as the canonical list builder: max mtime over the
  // activity logs, falling back to campaign.json / dir.
  const candidates = [
    path.join(dir, "logs", "events.jsonl"),
    path.join(dir, "logs", "turn-finalizations.jsonl"),
    path.join(dir, "campaign.json"),
    dir,
  ];
  let last_active_ms = 0;
  for (const file of candidates) {
    try {
      last_active_ms = Math.max(last_active_ms, fs.statSync(file).mtimeMs);
    } catch {
      /* skip missing candidate */
    }
  }
  const last_active_at = last_active_ms > 0
    ? new Date(last_active_ms).toISOString()
    : null;
  return { investigator_name, last_active_at };
}

function machineGeneratedCampaignTitle(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return (
    /\.pdf$/i.test(text)
    || /^[0-9a-f]{16,64}__?/i.test(text)
    || /^pdf[-_]/i.test(text)
  );
}

function displayTitlePart(value) {
  return typeof value === "string"
    ? value
      .replace(/[\r\n]+/g, " ")
      .replace(/\s*[-–—]\s*/g, "·")
      .replace(/\s+/g, " ")
      .trim()
    : "";
}

function protagonistTitlePart(value) {
  const text = displayTitlePart(value);
  if (!text) return "";
  return text.split(/[·・•\s]+/).filter(Boolean)[0] || text;
}

function openingStageTitle(openingPhase, campaignStatus) {
  const phase = typeof openingPhase?.phase === "string"
    ? openingPhase.phase
    : "";
  if (phase === "module_preparation") return "模组准备";
  if (phase === "character_creation") return "建卡";
  if (phase === "ready_for_table") return "开场";
  if (phase === "active") return "调查中";
  const status = String(campaignStatus || "").trim();
  if (status === "setup") return "建卡";
  if (status === "ready_for_table") return "开场";
  if (status === "active") return "调查中";
  if (["completed", "ended", "closed"].includes(status)) return "结局";
  return "开场准备";
}

/**
 * Automatic title from the existing isolated opening extractor agent. Only
 * its two player-safe module-name fields cross the sealed L0 boundary. A
 * human-renamed campaign remains an exact override.
 */
export function campaignDisplayTitle(
  workspace,
  campaignId,
  { openingPhase = null, activeSceneLabel = null, investigatorName = null } = {},
) {
  const dir = campaignDir(workspace, campaignId);
  const campaign = readJsonFile(path.join(dir, "campaign.json"));
  const current = typeof campaign?.title === "string" ? campaign.title.trim() : "";
  if (current && !machineGeneratedCampaignTitle(current)) return current;

  const moduleInit = readJsonFile(path.join(dir, "save", "module-init.json"));
  const moduleMeta = moduleInit?.l0?.module_meta;
  const moduleTitle = (
    displayTitlePart(moduleMeta?.title_zh)
    || displayTitlePart(moduleMeta?.title_en)
    || "模组解析中"
  );
  const sceneOrStage = (
    displayTitlePart(activeSceneLabel)
    || openingStageTitle(openingPhase, campaign?.status)
  );
  const protagonist = protagonistTitlePart(investigatorName);
  return [moduleTitle, sceneOrStage, protagonist].filter(Boolean).join("-");
}

/**
 * Character-setup pending is read from the authoritative `opening_phase`
 * projection (plugin derive_opening_phase), never from investigator-file
 * scanning: a linked placeholder sheet is not a confirmed investigator.
 * A missing projection normally fails closed. The one safe fallback is an
 * already-projected play session plus a resolved display character: both are
 * player-safe live-state facts, and treating that combination as chargen
 * would hide a real sheet after a host/model restart.
 */
export function characterSetupPendingFromOpeningPhase(
  openingPhase,
  { sessionRole = null, hasCharacter = false } = {},
) {
  if (!openingPhase || typeof openingPhase !== "object") {
    return !(sessionRole === "play" && hasCharacter === true);
  }
  return openingPhase.character_setup_confirmed !== true;
}

const SETUP_DRAFT_INVESTIGATOR_ID = "web-char-setup-draft";

/**
 * Id-selection only: which investigator sheet to project.
 * Prefers party.active_investigator_ids so a leftover chargen draft
 * (alphabetically earlier `inv-pending-*` state file) cannot steal the
 * sidebar. Never used for lifecycle / tableIntent.
 */
export function investigatorIdFromParty(
  party,
  { draftId = SETUP_DRAFT_INVESTIGATOR_ID } = {},
) {
  if (!party || typeof party !== "object") return null;
  const active = party.active_investigator_ids;
  const all = party.investigator_ids;
  const pool = Array.isArray(active) && active.length ? active : all;
  if (!Array.isArray(pool)) return null;
  for (const id of pool) {
    if (typeof id === "string" && id.trim() && id !== draftId) return id.trim();
  }
  return null;
}

export const INVESTIGATOR_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export const PORTRAIT_FILENAME_RE =
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.(?:png|jpe?g|webp)$/i;
const PLAYER_FACING_PORTRAIT_KEYS = Object.freeze([
  "portrait_path",
  "portrait_source",
  "portrait_status",
  "portrait_generated_at",
]);
const SECRET_PORTRAIT_KEYS = Object.freeze([
  "prompt",
  "provenance",
  "tool",
  "host",
  "updated_at",
  "appearance",
  "aspect_ratio",
  "framing",
]);

export function investigatorCharacterPath(workspace, investigatorId) {
  const id = String(investigatorId || "").trim();
  if (!INVESTIGATOR_ID_RE.test(id)) return null;
  return path.join(cocRoot(workspace), "investigators", id, "character.json");
}

export function investigatorPortraitDir(workspace, investigatorId) {
  const id = String(investigatorId || "").trim();
  if (!INVESTIGATOR_ID_RE.test(id)) return null;
  return path.join(cocRoot(workspace), "investigators", id, "portraits");
}

function isInsideDir(root, candidate) {
  const base = path.resolve(root);
  const full = path.resolve(candidate);
  return full === base || full.startsWith(base + path.sep);
}

/** Confine a portrait filename to `.coc/investigators/<id>/portraits/`. */
export function resolveInvestigatorPortraitFile(workspace, investigatorId, filename) {
  const dir = investigatorPortraitDir(workspace, investigatorId);
  const name = String(filename || "").trim();
  if (!dir || !PORTRAIT_FILENAME_RE.test(name)) return null;
  if (name.includes("/") || name.includes("\\") || name.includes("\0")) return null;
  if (name.includes("..") || name.startsWith(".")) return null;
  const resolved = path.resolve(dir, name);
  if (!isInsideDir(dir, resolved)) return null;
  return resolved;
}

export function portraitImageUrl(investigatorId, assetPath) {
  const id = String(investigatorId || "").trim();
  const name = path.posix.basename(String(assetPath || "").replaceAll("\\", "/"));
  if (!INVESTIGATOR_ID_RE.test(id) || !PORTRAIT_FILENAME_RE.test(name)) return null;
  return `/api/investigators/${encodeURIComponent(id)}/portraits/${encodeURIComponent(name)}`;
}

function publicPortraitField(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

/** Player-facing portrait contract: path/source/status/time only. */
export function playerFacingPortraitProjection(character) {
  const raw = character && typeof character === "object" ? character : {};
  const machine = raw.portrait && typeof raw.portrait === "object" ? raw.portrait : {};
  const sheet =
    raw.player_facing_sheet_zh && typeof raw.player_facing_sheet_zh === "object"
      ? raw.player_facing_sheet_zh
      : {};
  const asset =
    publicPortraitField(machine.asset_path) ||
    publicPortraitField(machine.portrait_path) ||
    publicPortraitField(raw.portrait_path) ||
    publicPortraitField(sheet.portrait_path);
  const source =
    publicPortraitField(machine.source) ||
    publicPortraitField(machine.portrait_source) ||
    publicPortraitField(sheet.portrait_source);
  const status =
    publicPortraitField(machine.status) ||
    publicPortraitField(machine.portrait_status) ||
    publicPortraitField(sheet.portrait_status);
  const generatedAt =
    publicPortraitField(machine.generated_at) ||
    publicPortraitField(machine.portrait_generated_at) ||
    publicPortraitField(sheet.portrait_generated_at);
  const projected = {};
  if (asset) {
    projected.portrait_path = asset;
  }
  if (source) projected.portrait_source = source;
  if (status) projected.portrait_status = status;
  if (generatedAt) projected.portrait_generated_at = generatedAt;
  for (const key of SECRET_PORTRAIT_KEYS) {
    delete projected[key];
  }
  return projected;
}

/** Overlay public portrait fields onto the sidecar display sheet. */
export function attachPortraitToDisplayCharacter(display, { workspace, investigatorId } = {}) {
  if (!display || typeof display !== "object") return display;
  const id = String(investigatorId || "").trim();
  const file = id ? investigatorCharacterPath(workspace, id) : null;
  const stored = file ? readJsonFile(file) : null;
  const projected = playerFacingPortraitProjection(stored && typeof stored === "object" ? stored : display);
  const next = { ...display };
  for (const key of [...PLAYER_FACING_PORTRAIT_KEYS, ...SECRET_PORTRAIT_KEYS, "portrait"]) {
    delete next[key];
  }
  if (next.player_facing_sheet_zh && typeof next.player_facing_sheet_zh === "object") {
    const pf = { ...next.player_facing_sheet_zh };
    for (const key of [...PLAYER_FACING_PORTRAIT_KEYS, ...SECRET_PORTRAIT_KEYS]) {
      delete pf[key];
    }
    next.player_facing_sheet_zh = pf;
  }
  const portrait = { ...projected };
  const imageUrl = portraitImageUrl(id, portrait.portrait_path);
  if (imageUrl) portrait.image_url = imageUrl;
  next.portrait = Object.keys(portrait).length ? portrait : null;
  return next;
}

export function readJsonFile(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf-8"));
    return data;
  } catch {
    return null;
  }
}

export function readJsonlDicts(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf-8");
  } catch {
    return [];
  }
  const out = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const row = JSON.parse(trimmed);
      if (row && typeof row === "object" && !Array.isArray(row)) out.push(row);
    } catch {
      /* skip malformed line */
    }
  }
  return out;
}

export const sha256Bytes = (buf) => createHash("sha256").update(buf).digest("hex");

export function sha256File(file) {
  const hash = createHash("sha256");
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(1024 * 1024);
    let read;
    while ((read = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(buf.subarray(0, read));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

// ---------------------------------------------------------------------------
// Chinese time display (closed vocabulary; mirrors the legacy bridge exactly)

const CN_DIGITS = "〇一二三四五六七八九";
const CN_MONTHS = ["正", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二"];

/** Spell a non-negative integer with Chinese numerals digit-by-digit (年用). */
export function zhDigits(value) {
  return String(Math.trunc(value))
    .split("")
    .map((ch) => CN_DIGITS[Number(ch)])
    .join("");
}

/** Spell 1–99 in common Chinese number words (十、十一、二十…). */
export function zhSmallNumber(value) {
  const n = Math.trunc(value);
  if (Number.isNaN(n) || n < 0) return String(n);
  if (n < 10) return CN_DIGITS[n];
  if (n === 10) return "十";
  if (n < 20) return "十" + CN_DIGITS[n - 10];
  if (n < 100) {
    const tens = Math.floor(n / 10);
    const ones = n % 10;
    const head = CN_DIGITS[tens] + "十";
    return ones === 0 ? head : head + CN_DIGITS[ones];
  }
  return zhDigits(n);
}

export function zhHourPhrase(hour, minute) {
  const h = ((Math.trunc(hour) % 24) + 24) % 24;
  const m = Math.max(0, Math.min(59, Math.trunc(minute) || 0));
  let phase;
  if (h >= 5 && h < 12) phase = "上午";
  else if (h >= 12 && h < 18) phase = "下午";
  else if (h >= 18 && h < 21) phase = "傍晚";
  else phase = "夜间";
  const h12 = h % 12 || 12;
  const clock =
    m === 0 ? `${zhSmallNumber(h12)}时整` : `${zhSmallNumber(h12)}时${zhSmallNumber(m)}分`;
  return [phase, clock];
}

const ZH_PHASE_TO_ENUM = { 上午: "morning", 下午: "afternoon", 傍晚: "evening", 夜间: "night" };

/** Project time-state into a calm player-facing display payload. */
export function formatPlayerTime(clockRaw, { playLanguage, safePlace = null }) {
  const clock = clockRaw && typeof clockRaw === "object" ? clockRaw : {};
  const rawDisplay = typeof clock.display === "string" && clock.display ? clock.display : "—";
  const localDt = clock.local_datetime ?? null;
  const payload = {
    display: rawDisplay,
    display_sub: null,
    local_datetime: localDt,
    location_id: clock.location_id ?? null,
    elapsed_minutes: clock.elapsed_minutes ?? null,
    scale: clock.scale ?? null,
    safe_place: safePlace,
    phase: null,
    phase_label: null,
  };
  const zh = playLanguage === "zh-Hans" || playLanguage === "zh";
  let dt = null;
  if (typeof localDt === "string" && localDt.trim()) {
    const parsed = new Date(localDt.trim());
    if (!Number.isNaN(parsed.getTime())) dt = parsed;
  }
  if (zh && dt) {
    const year = zhDigits(dt.getFullYear()) + "年";
    const month = CN_MONTHS[dt.getMonth()] + "月";
    const day = zhSmallNumber(dt.getDate()) + "日";
    const [phase, clockPhrase] = zhHourPhrase(dt.getHours(), dt.getMinutes());
    payload.display = `${year}${month}${day}`;
    payload.display_sub = `${phase} · ${clockPhrase}`;
    payload.phase = ZH_PHASE_TO_ENUM[phase] ?? null;
    payload.phase_label = phase;
  } else if (zh && rawDisplay !== "—") {
    payload.display = rawDisplay.trim().replace("T", " · ").replace(/\s+/g, " ");
  }
  return payload;
}

export function timeExtras(workspace, campaignId, playLanguage) {
  const raw = readJsonFile(path.join(campaignDir(workspace, campaignId), "save", "time-state.json"));
  if (!raw || typeof raw !== "object") return null;
  const clock = raw.clock && typeof raw.clock === "object" ? raw.clock : {};
  return formatPlayerTime(clock, { playLanguage, safePlace: raw.safe_place ?? null });
}

// ---------------------------------------------------------------------------
// Scene / tension labels

function _nonEmptySceneId(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Prefer lived-play scene over a stale world/briefing id. */
export function resolvePlaySceneId(workspace, campaignId) {
  const dir = campaignDir(workspace, campaignId);
  const world = readJsonFile(path.join(dir, "save", "world-state.json"));
  const active = readJsonFile(path.join(dir, "save", "active-scene.json"));
  const campaign = readJsonFile(path.join(dir, "campaign.json"));
  const history = Array.isArray(world?.scene_history) ? world.scene_history : [];
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const id = _nonEmptySceneId(history[i]?.scene_id);
    if (id) return id;
  }
  const visited = Array.isArray(world?.visited_scene_ids) ? world.visited_scene_ids : [];
  for (let i = visited.length - 1; i >= 0; i -= 1) {
    const id = _nonEmptySceneId(visited[i]);
    if (id) return id;
  }
  return (
    _nonEmptySceneId(active?.scene_id)
    || _nonEmptySceneId(world?.active_scene_id)
    || _nonEmptySceneId(campaign?.active_scene_id)
  );
}

export function sceneDisplayLabel(workspace, campaignId, sceneId, playLanguage) {
  if (!sceneId || typeof sceneId !== "string") return null;
  const raw = readJsonFile(
    path.join(campaignDir(workspace, campaignId), "scenario", "story-graph.json"),
  );
  const scenes = raw && Array.isArray(raw.scenes) ? raw.scenes : [];
  for (const scene of scenes) {
    if (!scene || typeof scene !== "object") continue;
    if (String(scene.scene_id || "") !== sceneId) continue;
    const identity = scene.destination_identity;
    if (identity && typeof identity === "object") {
      const names = identity.localized_names;
      if (names && typeof names === "object") {
        for (const key of [playLanguage, "zh-Hans", "zh"]) {
          const label = names[key];
          if (typeof label === "string" && label.trim()) return label.trim();
        }
      }
    }
    // Source-language scene headings are machine data until the semantic
    // compiler supplies a localized name. Do not leak them into a Chinese UI.
    if (playLanguage === "zh-Hans" || playLanguage === "zh") return null;
    if (typeof scene.display_name === "string" && scene.display_name.trim()) {
      return scene.display_name.trim();
    }
    if (identity && typeof identity === "object") {
      const canonical = identity.canonical_name;
      if (typeof canonical === "string" && canonical.trim()) return canonical.trim();
    }
    break;
  }
  return null;
}

const TENSION_LABELS_ZH = { low: "平缓", medium: "升高", high: "紧绷", climax: "高潮" };

export function tensionDisplayLabel(level, playLanguage) {
  if (!level || typeof level !== "string") return null;
  if (playLanguage === "zh-Hans" || playLanguage === "zh") {
    return TENSION_LABELS_ZH[level] ?? level;
  }
  return level;
}

// ---------------------------------------------------------------------------
// Combat initiative (closed player-safe projection)

function combatActorLabels(workspace, campaignId, investigatorId, investigatorName) {
  const labels = new Map();
  if (typeof investigatorId === "string" && investigatorId) {
    const sheet = readJsonFile(
      path.join(campaignDir(workspace, campaignId), "investigators", investigatorId, "character.json"),
    );
    const sheetName = typeof sheet?.name === "string" ? sheet.name.trim() : "";
    labels.set(investigatorId, investigatorName || sheetName || "调查员");
  }
  const impressions = readJsonFile(
    path.join(campaignDir(workspace, campaignId), "save", "npc-first-impressions.json"),
  );
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    const id = typeof node.npc_id === "string" ? node.npc_id : null;
    const label = typeof node.npc_display_name === "string" ? node.npc_display_name.trim() : "";
    if (id && label) {
      labels.set(id, label);
      labels.set(id.replace(/^npc-/, ""), label);
    }
    for (const value of Object.values(node)) visit(value);
  };
  visit(impressions);
  return labels;
}

/** Project the canonical DEX initiative ledger without exposing combat intent,
 * hidden statistics, or private NPC state. CoC 7e initiative is an order, not
 * an extra roll; a ready firearm contributes the rules-owned DEX + 50 value.
 * The combat session file persists after conclusion, so ``status``/``outcome``
 * are surfaced alongside the round ledger and the UI owns "已脱战" dismissal
 * (keyed by ``combat_id``); a fresh encounter restarts with a new combat_id. */
export function combatInitiativeDisplay(
  workspace,
  campaignId,
  { investigatorId = null, investigatorName = null } = {},
) {
  const combat = readJsonFile(
    path.join(campaignDir(workspace, campaignId), "save", "combat.json"),
  );
  if (!combat || !Number.isInteger(combat.current_round) || combat.current_round < 1) {
    return null;
  }
  const progress = Array.isArray(combat.initiative_progress)
    ? combat.initiative_progress
    : [];
  if (!progress.length) return null;
  const order = Array.isArray(combat.current_initiative) ? combat.current_initiative : [];
  const orderIndex = new Map(order.map((row, index) => [row?.actor_id, index]));
  const current = order[Number.isInteger(combat.initiative_cursor) ? combat.initiative_cursor : -1];
  const labels = combatActorLabels(workspace, campaignId, investigatorId, investigatorName);
  const rows = progress.map((row, sourceIndex) => {
    const initiative = row?.initiative && typeof row.initiative === "object"
      ? row.initiative
      : null;
    const actorId = typeof row?.actor_id === "string" ? row.actor_id : "";
    const dex = Number.isInteger(initiative?.dex)
      ? initiative.dex
      : Number.isInteger(row?.round_start_eligibility?.dex)
        ? row.round_start_eligibility.dex
        : null;
    const readyFirearm = initiative?.dex_reason === "ready_firearm";
    return {
      actor_id: actorId,
      display_name: labels.get(actorId) || (actorId === investigatorId ? "调查员" : "敌方角色"),
      side: actorId === investigatorId ? "investigator" : "opponent",
      dex,
      initiative_value: Number.isInteger(dex) ? dex + (readyFirearm ? 50 : 0) : null,
      ready_firearm: readyFirearm,
      status: typeof row?.status === "string" ? row.status : "pending",
      current: actorId !== "" && actorId === current?.actor_id,
      _order: orderIndex.has(actorId) ? orderIndex.get(actorId) : order.length + sourceIndex,
    };
  });
  rows.sort((a, b) => a._order - b._order);
  return {
    combat_id: typeof combat.combat_id === "string" ? combat.combat_id : null,
    status: combat.status === "concluded" ? "concluded" : "active",
    outcome: typeof combat.outcome === "string" ? combat.outcome : null,
    round: combat.current_round,
    rule: "dex_order",
    rows: rows.map(({ _order, ...row }) => row),
  };
}

// ---------------------------------------------------------------------------
// Discovered clues

function* iterClueNodes(node) {
  if (node && typeof node === "object" && !Array.isArray(node)) {
    if (typeof node.clue_id === "string" && node.clue_id.trim()) yield node;
    for (const value of Object.values(node)) yield* iterClueNodes(value);
  } else if (Array.isArray(node)) {
    for (const item of node) yield* iterClueNodes(item);
  }
}

function loadClueIndex(workspace, campaignId) {
  const raw = readJsonFile(
    path.join(campaignDir(workspace, campaignId), "scenario", "clue-graph.json"),
  );
  const index = new Map();
  if (!raw) return index;
  for (const clue of iterClueNodes(raw)) {
    const clueId = String(clue.clue_id || "").trim();
    if (!clueId || index.has(clueId)) continue;
    const visibility = clue.visibility;
    if (
      visibility != null &&
      !["player-safe", "public", "player"].includes(String(visibility).trim())
    ) {
      continue;
    }
    index.set(clueId, clue);
  }
  return index;
}

function cluePlayerSummary(clue, playLanguage) {
  const localized = clue?.localized_text;
  if (localized && typeof localized === "object") {
    for (const key of [playLanguage, "zh-Hans", "zh"]) {
      const block = localized[key];
      if (block && typeof block === "object") {
        const text = block.player_safe_summary || block.summary;
        if (typeof text === "string" && text.trim()) return text.trim();
      } else if (typeof block === "string" && block.trim()) {
        return block.trim();
      }
    }
  }
  for (const field of ["player_safe_summary", "summary"]) {
    const text = clue?.[field];
    if (typeof text === "string" && text.trim()) return text.trim();
  }
  return null;
}

export function discoveredCluesDisplay(workspace, campaignId, clueIds, playLanguage) {
  if (!Array.isArray(clueIds)) return [];
  const index = loadClueIndex(workspace, campaignId);
  const out = [];
  const seen = new Set();
  for (const rawId of clueIds) {
    if (typeof rawId !== "string") continue;
    const clueId = rawId.trim();
    if (!clueId || seen.has(clueId)) continue;
    seen.add(clueId);
    const clue = index.get(clueId);
    const summary = clue ? cluePlayerSummary(clue, playLanguage) : null;
    // Never invent content for unknown ids; surface the id so the count stays
    // honest and the KP can see what is missing from the graph.
    out.push({ clue_id: clueId, summary: summary || clueId });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Delivered handout cards (原文信息卡 · read-only, player-safe)
//
// Authoritative campaign-side shapes, mirroring the Keeper-side resolution
// (plugins/coc-keeper/scripts/coc_toolbox.py `_handout_cards_indexed`,
// coc_module_project.py `campaign_asset_root_id` / `handout_card_from_pack`,
// and coc_scenario.py `validate_handout_card`; read-only reference):
//   - delivery state lives in save/world-state.json `delivered_handout_ids`
//     (NOT campaign.json);
//   - card records merge three stores keyed by asset_id, collisions resolved
//     entity-pack > scenario/handouts.json > index/handout-assets.json:
//       index/handout-assets.json  {assets: [{asset_id, ...}]} — entries
//         failing the card contract (bad kind, text without source_refs,
//         non-boolean player_visible, ...) are skipped, fail-closed
//       scenario/handouts.json     {"schema_version": 1, "handouts": [...]}
//       .coc/module-assets/<root>/entities/handout-<id>.json deep packs
//         (parse_state deep|body_parsed, no evidence_gap), projected through
//         the same card fields incl. opening_card/parse_state/origin
//   - the campaign's entity root comes from the plugin resolver exactly:
//     scenario/scenario.json progressive_asset_root_id, else
//     scenario/module-meta.json (progressive) module_identity.
//     canonical_module_id | scenario_id. source_cache_asset_root_id is NOT
//     a card root (only progressive-projection campaigns carry cards).
//   - player-reachable image files are limited to the exact files an
//     already-delivered, player-visible card references via image_ref —
//     either inside the bound module-assets root, or inside the campaign's
//     declared handout asset subtree (index asset_root, default
//     assets/handouts). Nothing else in .coc/ is ever a candidate.
// Everything here is read-only; undelivered or player-invisible card bodies
// never cross this module.

export const HANDOUT_KINDS = Object.freeze(new Set(["document", "read_aloud", "map"]));
const HANDOUT_IMAGE_EXT_RE = /\.(?:png|jpe?g|webp)$/i;
const HANDOUT_ENTITY_PARSE_STATES = new Set(["deep", "body_parsed"]);
const HANDOUT_CARD_PACK_FIELDS = Object.freeze([
  "kind", "content_origin", "title", "summary", "localized_title",
  "localized_summary", "localized_language", "player_visible",
  "when_to_deliver", "opening_card", "text", "authored_text",
  "localized_text", "image_ref", "source_refs",
  "scene_refs", "clue_refs",
]);

function handoutString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function handoutStringList(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    const text = handoutString(item);
    if (text) out.push(text);
  }
  return out;
}

/** The campaign's entity card root, mirroring the plugin resolver exactly
 *  (coc_module_project.campaign_asset_root_id): scenario.json
 *  progressive_asset_root_id, else module-meta.json progressive
 *  module_identity.canonical_module_id | scenario_id. source_cache_asset_root_id
 *  is deliberately NOT a card root — only a progressive-projection campaign
 *  carries handout entities, so Web and KP resolve the same card bodies. */
export function campaignBoundAssetRootIds(workspace, campaignId) {
  const dir = campaignDir(workspace, campaignId);
  const ids = [];
  const scenario = readJsonFile(path.join(dir, "scenario", "scenario.json"));
  if (scenario && typeof scenario === "object") {
    const id = handoutString(scenario.progressive_asset_root_id);
    if (id) ids.push(id);
  }
  if (!ids.length) {
    const meta = readJsonFile(path.join(dir, "scenario", "module-meta.json"));
    if (meta && typeof meta === "object" && meta.progressive) {
      const identity = meta.module_identity && typeof meta.module_identity === "object"
        ? meta.module_identity
        : {};
      const id = handoutString(identity.canonical_module_id) || handoutString(meta.scenario_id);
      if (id) ids.push(id);
    }
  }
  // One safe path segment per root id (defense in depth).
  return ids
    .map((id) => id.split("/")[0])
    .filter((segment) => segment && segment !== "." && segment !== "..");
}

function campaignBoundModuleDirs(workspace, campaignId) {
  const moduleRoot = path.join(cocRoot(workspace), "module-assets");
  return campaignBoundAssetRootIds(workspace, campaignId).map((id) =>
    path.resolve(moduleRoot, id),
  );
}

/** Authoritative delivered ids from save/world-state.json (deduped, order
 *  kept). campaign.json is never a delivery source. */
export function deliveredHandoutIds(workspace, campaignId) {
  const world = readJsonFile(
    path.join(campaignDir(workspace, campaignId), "save", "world-state.json"),
  );
  const out = [];
  const seen = new Set();
  for (const id of handoutStringList(world?.delivered_handout_ids)) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** handout_card_from_pack field projection: one deep entity pack -> a card
 *  record. Machinery-only fields (ingest timing, provenance bookkeeping)
 *  stay out; player_visible defaults true and parse_state/origin keep the
 *  IR record semantics, exactly like the plugin projection. */
function handoutCardFromPack(pack) {
  if (!pack || typeof pack !== "object") return null;
  if (!HANDOUT_ENTITY_PARSE_STATES.has(handoutString(pack.parse_state))) return null;
  if (pack.evidence_gap) return null;
  if (handoutCardContractErrors(pack, { prefix: "deep handout pack" }).length) return null;
  const assetId = handoutString(pack.asset_id) || handoutString(pack.handout_id);
  if (!assetId) return null;
  const card = { asset_id: assetId };
  for (const field of HANDOUT_CARD_PACK_FIELDS) {
    if (pack[field] != null) card[field] = pack[field];
  }
  if (typeof card.player_visible !== "boolean") card.player_visible = true;
  card.parse_state = handoutString(pack.parse_state) || "deep";
  card.origin = handoutString(pack.origin) || "source";
  return card;
}

/** coc_scenario.validate_handout_card: fail-closed card contract for index
 *  and scenario-store entries. A card failing any rule is not a card (the
 *  Keeper side skips it), so Web must skip it too — never display a body
 *  the plugin itself would reject (e.g. player_visible: "false"). */
export function handoutCardContractErrors(entry, { prefix = "handout" } = {}) {
  const out = [];
  for (const field of ["asset_id", "handout_id"]) {
    const value = entry?.[field];
    if (value != null && (typeof value !== "string" || !value.trim())) {
      out.push(`${prefix}.${field} must be a non-empty string when present`);
    }
  }
  const kind = entry?.kind;
  if (typeof kind !== "string" || !HANDOUT_KINDS.has(kind)) {
    out.push(`${prefix}.kind must be one of document, read_aloud, map`);
  }
  const contentOrigin = handoutString(entry?.content_origin) || "source_verbatim";
  if (!new Set(["source_verbatim", "authored_derivative"]).has(contentOrigin)) {
    out.push(`${prefix}.content_origin must be source_verbatim or authored_derivative`);
  }
  for (const field of [
    "title", "summary", "text", "authored_text", "localized_language",
    "when_to_deliver", "image_ref", "opening_card",
  ]) {
    const value = entry?.[field];
    if (value != null && typeof value !== "string" && field !== "opening_card") {
      out.push(`${prefix}.${field} must be a string when present`);
    }
    if (["text", "authored_text"].includes(field) && typeof value === "string" && !value.trim()) {
      out.push(`${prefix}.${field} must be non-empty when present`);
    }
    if (field === "opening_card" && value != null && typeof value !== "boolean") {
      out.push(`${prefix}.opening_card must be a boolean when present`);
    }
  }
  for (const field of ["localized_title", "localized_summary", "localized_text"]) {
    const value = entry?.[field];
    if (value == null) continue;
    const validMap = value && typeof value === "object" && !Array.isArray(value)
      && Object.keys(value).length > 0
      && Object.entries(value).every(([language, localized]) =>
        Boolean(language.trim()) && typeof localized === "string" && Boolean(localized.trim())
      );
    if (!(typeof value === "string" || validMap)) {
      out.push(`${prefix}.${field} must be a string or play_language map`);
    }
    if (validMap && entry?.localized_language != null) {
      out.push(`${prefix}.localized_language must be absent with ${field} map`);
    }
  }
  const text = entry?.text;
  const sourceRefs = entry?.source_refs;
  if (sourceRefs != null) {
    if (
      !Array.isArray(sourceRefs)
      || !sourceRefs.length
      || sourceRefs.some((ref) => typeof ref !== "string" || !ref.trim())
    ) {
      out.push(`${prefix}.source_refs must be a non-empty array of strings`);
    }
  }
  if (typeof text === "string" && text.trim()) {
    if (!Array.isArray(sourceRefs) || !sourceRefs.length) {
      out.push(`${prefix}.text requires non-empty source_refs`);
    }
  }
  if (contentOrigin === "authored_derivative") {
    if (typeof text === "string" && text.trim()) {
      out.push(`${prefix}.text is reserved for source-verbatim excerpts`);
    }
    if (sourceRefs != null) {
      out.push(`${prefix}.source_refs must be absent for authored_derivative`);
    }
  } else if (entry?.authored_text != null) {
    out.push(`${prefix}.authored_text requires content_origin=authored_derivative`);
  }
  if (entry?.player_visible != null && typeof entry.player_visible !== "boolean") {
    out.push(`${prefix}.player_visible must be a boolean when present`);
  }
  for (const field of ["scene_refs", "clue_refs"]) {
    const value = entry?.[field];
    if (
      value != null
      && (!Array.isArray(value) || value.some((ref) => typeof ref !== "string"))
    ) {
      out.push(`${prefix}.${field} must be a string array when present`);
    }
  }
  return out;
}

/** All handout card records by asset_id. Collision priority mirrors the
 *  Keeper toolbox: entity packs (freshest deep truth) override the campaign
 *  card store, which overrides the asset index. Index and scenario entries
 *  must pass the card contract (fail-closed like coc_scenario). */
export function loadHandoutCards(workspace, campaignId) {
  const dir = campaignDir(workspace, campaignId);
  const cards = new Map();

  const index = readJsonFile(path.join(dir, "index", "handout-assets.json"));
  for (const entry of Array.isArray(index?.assets) ? index.assets : []) {
    if (!entry || typeof entry !== "object") continue;
    const id = handoutString(entry.asset_id);
    if (id && !cards.has(id) && !handoutCardContractErrors(entry).length) {
      cards.set(id, entry);
    }
  }

  const store = readJsonFile(path.join(dir, "scenario", "handouts.json"));
  const rows = store && typeof store === "object" && Array.isArray(store.handouts)
    ? store.handouts
    : [];
  for (const entry of rows) {
    if (!entry || typeof entry !== "object") continue;
    const id = handoutString(entry.asset_id);
    if (id && !handoutCardContractErrors(entry).length) cards.set(id, entry);
  }

  for (const moduleDir of campaignBoundModuleDirs(workspace, campaignId)) {
    const entitiesDir = path.join(moduleDir, "entities");
    let names;
    try {
      names = fs.readdirSync(entitiesDir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.startsWith("handout-") || !name.endsWith(".json")) continue;
      const pack = readJsonFile(path.join(entitiesDir, name));
      const card = handoutCardFromPack(pack);
      if (card) cards.set(card.asset_id, card);
    }
  }
  return cards;
}

/** The campaign's declared handout asset subtree (index `asset_root`,
 *  default assets/handouts). Campaign-relative image refs must live under it. */
function campaignHandoutAssetRoot(workspace, campaignId) {
  const index = readJsonFile(
    path.join(campaignDir(workspace, campaignId), "index", "handout-assets.json"),
  );
  return normalizeHandoutAssetRef(index?.asset_root) || "assets/handouts";
}

/** Normalize an image_ref / URL file part to a workspace-relative reference.
 *  Rejects traversal, absolute paths, drive letters, and null bytes. */
export function normalizeHandoutAssetRef(ref) {
  const text = handoutString(ref).replaceAll("\\", "/");
  if (!text || text.startsWith("/")) return null;
  const stripped = text.replace(/^\.\//, "").replace(/^\/+/, "");
  if (!stripped) return null;
  const segments = stripped.split("/");
  for (const segment of segments) {
    if (!segment || segment === "." || segment === "..") return null;
    if (segment.includes("\0") || segment.includes(":")) return null;
  }
  return segments.join("/");
}

/** Absolute-path candidates one reference may point at, confined to this
 *  campaign's authorized card-image locations: its bound module-assets
 *  root(s), or the campaign's declared handout asset subtree
 *  (index asset_root, default assets/handouts). Any other location —
 *  another campaign, an unbound module root, the rest of `.coc/`, or any
 *  other directory inside the campaign — yields no candidate and the
 *  request 404s. */
export function handoutAssetCandidates(workspace, campaignId, ref) {
  const rel = normalizeHandoutAssetRef(ref);
  if (!rel) return [];
  const campaignPath = campaignDir(workspace, campaignId);
  const moduleDirs = campaignBoundModuleDirs(workspace, campaignId);
  if (rel === ".coc" || rel.startsWith(".coc/")) {
    const abs = path.resolve(workspace, rel);
    const insideModule = moduleDirs.some((dir) => isInsideDir(dir, abs));
    return insideModule ? [abs] : [];
  }
  if (rel.startsWith("module-assets/")) {
    const abs = path.resolve(cocRoot(workspace), rel);
    return moduleDirs.some((dir) => isInsideDir(dir, abs)) ? [abs] : [];
  }
  const out = [];
  for (const dir of moduleDirs) out.push(path.resolve(dir, rel));
  // Campaign side: only the declared handout asset subtree — never the whole
  // campaign directory.
  const assetRoot = campaignHandoutAssetRoot(workspace, campaignId);
  if (rel === assetRoot || rel.startsWith(assetRoot + "/")) {
    out.push(path.resolve(campaignPath, rel));
  }
  return out;
}

export function handoutAssetImageUrl(workspace, campaignId, imageRef) {
  const rel = normalizeHandoutAssetRef(imageRef);
  if (!rel || !HANDOUT_IMAGE_EXT_RE.test(rel)) return null;
  // Never publish a URL the delivery-gated route cannot serve: the exact
  // file must resolve inside the campaign's authorized card-image roots and
  // exist, else the player-facing card simply carries no image.
  if (!resolveHandoutAssetFile(workspace, campaignId, rel)) return null;
  return `/api/campaigns/${encodeURIComponent(campaignId)}/handout-assets/${
    rel.split("/").map((segment) => encodeURIComponent(segment)).join("/")
  }`;
}

function handoutPlayLanguage(workspace, campaignId) {
  const campaign = readJsonFile(
    path.join(campaignDir(workspace, campaignId), "campaign.json"),
  );
  return handoutString(campaign?.play_language) || "zh-Hans";
}

function localizedHandoutValue(entry, field, playLanguage) {
  const rawLocalized = entry?.[`localized_${field}`];
  if (rawLocalized && typeof rawLocalized === "object" && !Array.isArray(rawLocalized)) {
    const baseLanguage = playLanguage.split("-", 1)[0];
    const candidates = [playLanguage, baseLanguage];
    if (baseLanguage === "zh") candidates.push("zh-Hans", "zh");
    for (const language of [...new Set(candidates)]) {
      const value = handoutString(rawLocalized[language]);
      if (value) return value;
    }
  }
  const localized = handoutString(rawLocalized);
  const localizedLanguage = handoutString(entry?.localized_language);
  if (localized && (!localizedLanguage || localizedLanguage === playLanguage)) {
    return localized;
  }
  return handoutString(entry?.[field]);
}

function handoutLabels(kind, contentOrigin, playLanguage) {
  const zh = playLanguage === "zh-Hans" || playLanguage === "zh";
  const ja = playLanguage === "ja-JP" || playLanguage === "ja";
  const kindLabels = zh
    ? { document: "文献", read_aloud: "朗读", map: "地图" }
    : ja
      ? { document: "文書", read_aloud: "読み上げ", map: "地図" }
      : { document: "Document", read_aloud: "Read aloud", map: "Map" };
  return {
    kind_label: kindLabels[kind] || kindLabels.document,
    card_label: contentOrigin === "authored_derivative"
      ? (zh ? "剧情资料" : ja ? "劇中資料" : "In-world prop")
      : (zh ? "原文资料" : ja ? "原文資料" : "Source handout"),
    source_label: contentOrigin === "source_verbatim"
      ? (zh ? "来源页" : ja ? "出典ページ" : "Source pages")
      : null,
  };
}

/** Player-safe card projection for SSE / state.materials. */
export function playerHandoutCard(workspace, campaignId, entry) {
  if (!entry || typeof entry !== "object") return null;
  const assetId = handoutString(entry.asset_id);
  if (!assetId) return null;
  const kind = handoutString(entry.kind);
  const normalizedKind = HANDOUT_KINDS.has(kind) ? kind : "document";
  const contentOrigin = handoutString(entry.content_origin) || "source_verbatim";
  const playLanguage = handoutPlayLanguage(workspace, campaignId);
  const imageRef = handoutString(entry.image_ref);
  const card = {
    asset_id: assetId,
    kind: normalizedKind,
    content_origin: contentOrigin,
    title: localizedHandoutValue(entry, "title", playLanguage) || assetId,
    text: (
      localizedHandoutValue(entry, "text", playLanguage)
      || handoutString(entry.authored_text)
      || null
    ),
    source_pages: contentOrigin === "source_verbatim"
      ? handoutStringList(entry.source_refs)
      : [],
    ...handoutLabels(normalizedKind, contentOrigin, playLanguage),
  };
  const summary = localizedHandoutValue(entry, "summary", playLanguage);
  if (summary) card.summary = summary;
  const imageUrl = handoutAssetImageUrl(workspace, campaignId, imageRef);
  if (imageUrl) card.image_url = imageUrl;
  return card;
}

/** Delivered cards only: a card must be listed in world-state
 *  `delivered_handout_ids` and not be flagged player-invisible. */
export function deliveredHandoutsDisplay(workspace, campaignId) {
  const cards = loadHandoutCards(workspace, campaignId);
  const out = [];
  const seen = new Set();
  for (const id of deliveredHandoutIds(workspace, campaignId)) {
    if (seen.has(id)) continue;
    seen.add(id);
    const entry = cards.get(id);
    if (!entry || entry.player_visible === false) continue;
    const card = playerHandoutCard(workspace, campaignId, entry);
    if (card) out.push(card);
  }
  return out;
}

export function mimeForHandoutAssetFile(filePath) {
  const ext = path.extname(String(filePath || "")).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".png") return "image/png";
  return null;
}

/** Delivery-gated static resolution for
 *  `/api/campaigns/<cid>/handout-assets/<file>`: the file must be an image
 *  referenced (exactly, after normalization) by at least one delivered,
 *  player-visible card, and after realpath must stay inside this campaign
 *  directory or one of its bound module-assets roots. Anything else returns
 *  null and the handler answers 404 — including undelivered cards' images
 *  and files inside `.coc/` outside the authorized roots. */
export function resolveHandoutAssetFile(workspace, campaignId, file) {
  const rel = normalizeHandoutAssetRef(file);
  if (!rel || !HANDOUT_IMAGE_EXT_RE.test(rel)) return null;
  const requested = handoutAssetCandidates(workspace, campaignId, rel);
  if (!requested.length) return null;

  const cards = loadHandoutCards(workspace, campaignId);
  const matches = [];
  for (const id of deliveredHandoutIds(workspace, campaignId)) {
    const entry = cards.get(id);
    if (!entry || entry.player_visible === false) continue;
    const imageRef = handoutString(entry.image_ref);
    if (!imageRef) continue;
    for (const candidate of handoutAssetCandidates(workspace, campaignId, imageRef)) {
      if (requested.some((req) => req === candidate) && !matches.includes(candidate)) {
        matches.push(candidate);
      }
    }
  }
  const target = matches.find((candidate) => {
    try {
      return fs.existsSync(candidate) && fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
  if (target == null) return null;

  let realFile;
  try {
    realFile = fs.realpathSync(target);
  } catch {
    return null;
  }
  // realpath confinement matches the candidate roots exactly: the bound
  // module-assets dirs and the campaign's declared handout asset subtree
  // (never the whole campaign directory).
  const campaignAssetRoot = path.resolve(
    campaignDir(workspace, campaignId),
    campaignHandoutAssetRoot(workspace, campaignId),
  );
  const allowedRoots = [campaignAssetRoot, ...campaignBoundModuleDirs(workspace, campaignId)]
    .map((root) => {
      try {
        return fs.realpathSync(root);
      } catch {
        return path.resolve(root);
      }
    });
  if (!allowedRoots.some((root) => isInsideDir(root, realFile))) return null;
  const mime = mimeForHandoutAssetFile(realFile);
  return mime ? { file: realFile, mime } : null;
}

// ---------------------------------------------------------------------------
// Transcript (table-transcript preferred; events+telemetry enrichment)

function parseIsoMs(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const ms = Date.parse(value.trim());
  return Number.isNaN(ms) ? null : ms;
}

function turnTotalMsList(workspace, campaignId) {
  const rows = readJsonlDicts(
    path.join(campaignDir(workspace, campaignId), "logs", "runtime-telemetry.jsonl"),
  );
  const totals = [];
  for (const row of rows) {
    const tel = row.telemetry;
    if (!tel || typeof tel !== "object") continue;
    const ms = Number(tel.total_ms);
    if (Number.isFinite(ms) && ms >= 0) totals.push(Math.round(ms));
  }
  return totals;
}

const PLAYER_ROLL_VISIBILITIES = new Set(["public", "consequence_public", "player"]);

const DEFAULT_LOCALIZED_TERMS_PATH = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../plugins/coc-keeper/scripts/default_localized_terms.json",
);

let cachedDefaultLocalizedTerms = null;

function defaultLocalizedTerms(playLanguage) {
  if (!cachedDefaultLocalizedTerms) {
    try {
      cachedDefaultLocalizedTerms = JSON.parse(
        fs.readFileSync(DEFAULT_LOCALIZED_TERMS_PATH, "utf-8"),
      );
    } catch {
      cachedDefaultLocalizedTerms = {};
    }
  }
  const terms = cachedDefaultLocalizedTerms?.[playLanguage];
  return terms && typeof terms === "object" ? terms : {};
}

export function resolvedLocalizedTerms(workspace, campaignId, playLanguage = "zh-Hans") {
  const terms = { ...defaultLocalizedTerms(playLanguage) };
  const campaign = readJsonFile(path.join(campaignDir(workspace, campaignId), "campaign.json"));
  const extra = campaign?.localized_terms?.[playLanguage];
  if (extra && typeof extra === "object") {
    for (const [key, label] of Object.entries(extra)) {
      if (typeof key === "string" && key && typeof label === "string" && label.trim()) {
        terms[key] = label;
      }
    }
  }
  return terms;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function localizeTerms(value, terms) {
  let localized = String(value ?? "");
  const entries = Object.entries(terms || {}).sort((a, b) => b[0].length - a[0].length);
  for (const [canonical, replacement] of entries) {
    if (!canonical || typeof replacement !== "string") continue;
    const ascii = /^[\x00-\x7F]+$/.test(canonical);
    if (ascii) {
      const pattern = new RegExp(
        `(?<![A-Za-z0-9_-])${escapeRegExp(canonical)}(?![A-Za-z0-9_-])`,
        "g",
      );
      localized = localized.replace(pattern, replacement);
    } else {
      localized = localized.split(canonical).join(replacement);
    }
  }
  return localized;
}

function firstRollValue(record, field) {
  const payload = record?.payload;
  if (payload && typeof payload === "object" && field in payload) return payload[field];
  return record?.[field];
}

/** Closed, player-safe roll projection for the renderer. */
function publicRollDisplay(record, terms = null) {
  if (!record || typeof record !== "object") return null;
  const visibility = firstRollValue(record, "visibility");
  if (typeof visibility === "string" && !PLAYER_ROLL_VISIBILITIES.has(visibility)) {
    return null;
  }
  const rollCandidates = ["roll", "rolled_total", "final_total", "total"];
  const roll = rollCandidates
    .map((field) => firstRollValue(record, field))
    .find(Number.isInteger);
  if (!Number.isInteger(roll)) return null;
  const rollId = firstRollValue(record, "roll_id");
  const value = {
    roll_id: typeof rollId === "string" ? rollId : "",
    roll,
  };
  const stringFields = [
    "display_skill", "skill", "characteristic", "npc_display_name", "kind",
    "difficulty", "required_level", "achieved_level", "outcome", "die",
    "expression", "die_expression", "governing_attribute", "reason", "source",
    "san_loss_expression", "san_loss_resolution",
  ];
  const integerFields = [
    "target", "base_target", "effective_target", "required_target", "bonus",
    "penalty", "bonus_penalty_dice", "app", "credit_rating", "governing_value",
    "final_total", "total", "units", "unmodified_roll",
    "san_before", "san_after", "san_delta", "san_loss",
  ];
  const booleanFields = ["passed", "success", "pushed"];
  for (const field of stringFields) {
    const candidate = firstRollValue(record, field);
    if (typeof candidate === "string" && candidate) value[field] = candidate;
  }
  for (const field of integerFields) {
    const candidate = firstRollValue(record, field);
    if (Number.isInteger(candidate)) value[field] = candidate;
  }
  for (const field of booleanFields) {
    const candidate = firstRollValue(record, field);
    if (typeof candidate === "boolean") value[field] = candidate;
  }
  for (const field of ["die_rolls", "rolls", "individual_faces"]) {
    const candidate = firstRollValue(record, field);
    if (Array.isArray(candidate) && candidate.every(Number.isInteger)) {
      value.die_rolls = [...candidate];
      break;
    }
  }
  const tensValues = firstRollValue(record, "tens_values");
  if (Array.isArray(tensValues) && tensValues.every(Number.isInteger)) {
    value.tens_values = [...tensValues];
  }
  const dice = firstRollValue(record, "dice");
  if (dice && typeof dice === "object") {
    if (!value.die && typeof dice.expression === "string" && dice.expression) {
      value.die = dice.expression;
    }
    if (!value.die_rolls && Array.isArray(dice.raw) && dice.raw.every(Number.isInteger)) {
      value.die_rolls = [...dice.raw];
    }
  }
  if (terms && typeof value.npc_display_name === "string") {
    value.npc_display_name = localizeTerms(value.npc_display_name, terms);
  }
  return value;
}

function campaignLayoutIndexes(workspace, campaignId) {
  const saveDir = path.join(campaignDir(workspace, campaignId), "save");
  return {
    combatIndex: buildCombatIndex(readJsonFile(path.join(saveDir, "combat.json"))),
    ledgerIndex: buildLedgerIndex(readJsonFile(path.join(saveDir, "toolbox-ledger.json"))),
    exceptionalDocument: readJsonFile(path.join(saveDir, "exceptional-effects.json")),
  };
}

function turnFinalizationIndex(workspace, campaignId) {
  const rows = readJsonlDicts(
    path.join(campaignDir(workspace, campaignId), "logs", "turn-finalizations.jsonl"),
  );
  const index = new Map();
  for (const row of rows) {
    const id = row?.finalization_id;
    if (typeof id === "string" && id) index.set(id, row);
  }
  return index;
}

function publicRollIndex(workspace, campaignId, terms = null) {
  const rows = readJsonlDicts(
    path.join(campaignDir(workspace, campaignId), "logs", "rolls.jsonl"),
  );
  const index = new Map();
  for (const row of rows) {
    const roll = publicRollDisplay(row, terms);
    if (roll?.roll_id) index.set(roll.roll_id, roll);
  }
  return index;
}

/**
 * Preserve the canonical finalization order while exposing public checks as
 * typed blocks.  This deliberately consumes the finalizer's structured
 * `segments`; it never guesses at dice by searching Keeper prose.
 */
function keeperContentBlocks(transcriptRow, finalization, layoutIndexes, terms = null) {
  if (!finalization || typeof finalization !== "object") return null;
  if (finalization.rendered_text !== transcriptRow.text) return null;
  const segments = finalization.segments;
  if (!Array.isArray(segments) || !segments.length) return null;
  if (
    !segments.every((segment) => segment && typeof segment.text === "string") ||
    segments.map((segment) => segment.text).join("\n\n") !== finalization.rendered_text
  ) {
    return null;
  }

  const checks = Array.isArray(finalization.bundle?.public_check)
    ? finalization.bundle.public_check
    : [];
  const checksById = new Map();
  const displayById = new Map();
  for (const check of checks) {
    const id = check?.roll_id;
    if (typeof id !== "string" || !id) continue;
    checksById.set(id, check);
    const display = publicRollDisplay(check, terms);
    if (display) displayById.set(id, display);
  }

  return projectKeeperContentBlocks({
    segments,
    checksById,
    displayById,
    combatIndex: layoutIndexes.combatIndex,
    ledgerIndex: layoutIndexes.ledgerIndex,
    effectIndex: buildEffectIndex(finalization, layoutIndexes.exceptionalDocument),
  });
}

/**
 * Table openings predate turn finalization but carry an explicit `[roll]`
 * envelope plus ordered `presented_roll_ids`.  Treat those protocol markers
 * structurally and bind each visible receipt to its canonical public roll.
 */
function openingContentBlocks(transcriptRow, rollsById) {
  const ids = Array.isArray(transcriptRow?.presented_roll_ids)
    ? transcriptRow.presented_roll_ids.filter((id) => typeof id === "string" && id)
    : [];
  if (!ids.length || typeof transcriptRow?.text !== "string") return null;
  const open = "\n\n[roll]\n";
  const close = "\n[/roll]";
  const openAt = transcriptRow.text.indexOf(open);
  const closeAt = transcriptRow.text.indexOf(close, openAt + open.length);
  if (openAt < 0 || closeAt < 0) return null;
  const receiptLines = transcriptRow.text
    .slice(openAt + open.length, closeAt)
    .split("\n")
    .filter(Boolean);
  if (receiptLines.length !== ids.length) return null;

  const blocks = [];
  const proseBefore = transcriptRow.text.slice(0, openAt).trim();
  if (proseBefore) blocks.push({ type: "prose", text: proseBefore });
  for (let index = 0; index < ids.length; index += 1) {
    blocks.push({
      type: "roll",
      text: receiptLines[index],
      source_ids: [ids[index]],
      roll: rollsById.get(ids[index]) ?? null,
    });
  }
  const proseAfter = transcriptRow.text
    .slice(closeAt + close.length)
    .replace(/^\s*\[\/in_game\]\s*$/, "")
    .trim();
  if (proseAfter) blocks.push({ type: "prose", text: proseAfter });
  return blocks;
}

function stripInGameEnvelope(text) {
  return String(text || "")
    .replace(/^\s*\[in_game\]\s*/i, "")
    .replace(/\s*\[\/in_game\]\s*$/i, "")
    .trim();
}

function attachTranscriptIdentity(entry, row) {
  if (typeof row?.finalization_id === "string" && row.finalization_id) {
    entry.finalization_id = row.finalization_id;
  }
  if (typeof row?.entry_id === "string" && row.entry_id) {
    entry.entry_id = row.entry_id;
  }
  if (row?.turn != null && row.turn !== "") {
    entry.turn = row.turn;
  }
}

export function tableTranscriptMessages(workspace, campaignId) {
  const rows = readJsonlDicts(
    path.join(campaignDir(workspace, campaignId), "logs", "table-transcript.jsonl"),
  );
  const dialogue = rows.filter(
    (row) =>
      (row.role === "player" || row.role === "keeper") &&
      typeof row.text === "string" &&
      row.text.trim(),
  );
  if (!dialogue.length) return null;

  const byTurn = new Map();
  for (const row of dialogue) {
    const key = row.turn ?? `row-${byTurn.size}`;
    if (!byTurn.has(key)) byTurn.set(key, {});
    byTurn.get(key)[row.role] = row;
  }

  const totals = turnTotalMsList(workspace, campaignId);
  const campaign = readJsonFile(path.join(campaignDir(workspace, campaignId), "campaign.json")) || {};
  const playLanguage = typeof campaign.play_language === "string" && campaign.play_language.trim()
    ? campaign.play_language.trim()
    : "zh-Hans";
  const terms = resolvedLocalizedTerms(workspace, campaignId, playLanguage);
  const finalizations = turnFinalizationIndex(workspace, campaignId);
  const rollsById = publicRollIndex(workspace, campaignId, terms);
  const layoutIndexes = campaignLayoutIndexes(workspace, campaignId);
  const out = [];
  let turnIndex = 0;
  for (const group of byTurn.values()) {
    const player = group.player;
    const keeper = group.keeper;
    let endMs = keeper ? parseIsoMs(keeper.ts) : null;
    if (endMs == null && player) endMs = parseIsoMs(player.ts);
    const durationMs = turnIndex < totals.length ? totals[turnIndex] : null;
    turnIndex += 1;
    let startMs = null;
    if (endMs != null && durationMs != null && durationMs >= 0) {
      startMs = endMs - durationMs;
    } else if (player) {
      startMs = parseIsoMs(player.ts);
    }
    if (player) {
      const entry = { role: "player", text: String(player.text || "").trim() };
      attachTranscriptIdentity(entry, player);
      if (startMs != null) {
        entry.at = startMs;
        entry.started_at = startMs;
      }
      out.push(entry);
    }
    if (keeper) {
      const entry = {
        role: "keeper",
        text: keeper.finalization_id
          ? String(keeper.text || "").trim()
          : stripInGameEnvelope(keeper.text),
      };
      attachTranscriptIdentity(entry, keeper);
      const finalizationId = keeper.finalization_id;
      if (typeof finalizationId === "string" && finalizationId) {
        const contentBlocks = keeperContentBlocks(
          keeper,
          finalizations.get(finalizationId),
          layoutIndexes,
          terms,
        );
        if (contentBlocks) entry.content_blocks = contentBlocks;
      } else {
        const contentBlocks = openingContentBlocks(keeper, rollsById);
        if (contentBlocks) entry.content_blocks = contentBlocks;
      }
      if (endMs != null) entry.at = endMs;
      if (startMs != null) entry.started_at = startMs;
      if (durationMs != null) entry.duration_ms = durationMs;
      out.push(entry);
    }
  }
  return out;
}

export function enrichTranscriptFromEvents(workspace, campaignId, messages) {
  const rows = readJsonlDicts(
    path.join(campaignDir(workspace, campaignId), "logs", "events.jsonl"),
  );
  const turnTs = [];
  for (const row of rows) {
    if (row.event_type !== "turn") continue;
    const ms = parseIsoMs(row.ts);
    if (ms != null) turnTs.push(ms);
  }
  const totals = turnTotalMsList(workspace, campaignId);
  if (!turnTs.length && !totals.length) return messages;
  const out = [];
  let turnI = 0;
  let pendingStart = null;
  let pendingDuration = null;
  for (const msg of messages) {
    if (!msg || typeof msg !== "object") continue;
    const item = { ...msg };
    if (item.role === "player") {
      const duration = turnI < totals.length ? totals[turnI] : null;
      const endMs = turnI < turnTs.length ? turnTs[turnI] : null;
      const startMs = endMs != null && duration != null ? endMs - duration : endMs;
      if (startMs != null) {
        item.at = startMs;
        item.started_at = startMs;
      }
      pendingStart = startMs;
      pendingDuration = duration;
      turnI += 1;
    } else if (item.role === "keeper") {
      if (pendingDuration != null) item.duration_ms = pendingDuration;
      if (pendingStart != null) {
        item.started_at = pendingStart;
        if (pendingDuration != null) item.at = pendingStart + pendingDuration;
        else if (item.at == null) item.at = pendingStart;
      }
      pendingStart = null;
      pendingDuration = null;
    }
    out.push(item);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Source bundles (PDF registration metadata only; PDFs are never parsed here)

export function listSourceBundles(workspace) {
  const root = path.join(cocRoot(workspace), "source-bundles");
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    const manifest = readJsonFile(path.join(dir, "manifest.json"));
    let title = entry.name;
    let sourcePdf = null;
    let pageCount = null;
    let fileSha256 = null;
    if (manifest && typeof manifest === "object") {
      const source = manifest.source;
      if (source && typeof source === "object") {
        if (Number.isInteger(source.page_count) && source.page_count > 0) {
          pageCount = source.page_count;
        }
        const sp = source.path || source.original_path;
        if (typeof sp === "string" && sp.trim()) {
          sourcePdf = sp.trim();
          title = path.basename(sourcePdf) || title;
        }
        const sha = source.file_sha256;
        if (typeof sha === "string" && sha.length === 64) fileSha256 = sha.toLowerCase();
      }
      if (pageCount === null && Array.isArray(manifest.pages)) {
        pageCount = manifest.pages.length;
      }
      if (typeof manifest.title === "string" && manifest.title.trim()) {
        title = manifest.title.trim();
      }
    } else if (!fs.existsSync(path.join(dir, "manifest.json"))) {
      continue; // not a bundle directory at all
    }
    out.push({
      bundle_id: entry.name,
      path: path.resolve(dir),
      title,
      source_pdf: sourcePdf,
      page_count: pageCount,
      file_sha256: fileSha256,
      location_hint: `.coc/source-bundles/${entry.name}/`,
    });
  }
  return out;
}

export function findBundleByPdfSha256(workspace, fileSha256) {
  const digest = String(fileSha256).toLowerCase().trim();
  return (
    listSourceBundles(workspace).find(
      (bundle) => String(bundle.file_sha256 || "").toLowerCase() === digest,
    ) ?? null
  );
}

// ---------------------------------------------------------------------------
// Models payload (pi model registry + auth, read-only)

const THINKING_LEVEL_ORDER = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

// Mirrors pi-ai getSupportedThinkingLevels (models.js): non-reasoning models
// only have "off"; a thinkingLevelMap entry of null disables that level;
// xhigh/max must be explicitly mapped.
export function modelAcceptsImage(providerId, entry) {
  const fromEntry = Array.isArray(entry?.input) ? entry.input : null;
  if (fromEntry) return fromEntry.includes("image");
  const catalog = piCatalogEntry(providerId, entry?.id);
  const fromCatalog = Array.isArray(catalog?.input) ? catalog.input : null;
  if (fromCatalog) return fromCatalog.includes("image");
  return false;
}

export function supportedThinkingLevels({ reasoning, thinkingLevelMap }) {
  if (!reasoning) return ["off"];
  return THINKING_LEVEL_ORDER.filter((level) => {
    const mapped = thinkingLevelMap?.[level];
    if (mapped === null) return false;
    if (level === "xhigh" || level === "max") return mapped !== undefined;
    return true;
  });
}

// pi-ai's bundled per-provider catalog data — the exact files pi composes
// models.json over — used as the metadata fallback for models whose
// models.json entry omits reasoning/thinkingLevelMap (e.g. OAuth providers
// materialized with id/name/input only). Custom provider ids simply miss.
let piCatalogCache = null;
function piCatalogModels(providerId) {
  if (!piCatalogCache) piCatalogCache = new Map();
  if (piCatalogCache.has(providerId)) return piCatalogCache.get(providerId);
  // web/server-node sits beside runtime/ in both the repo and the desktop
  // payload, so the keeper's bundled pi-ai data is a stable relative path.
  const dataDir = path.resolve(
    import.meta.dirname,
    "..", "..", "runtime", "adapters", "keeper", "node_modules",
    "@earendil-works", "pi-ai", "dist", "providers", "data",
  );
  const byModel = new Map();
  // readJsonFile returns null when the provider has no catalog file — a
  // custom provider id — and models.json stands alone for it.
  const doc = readJsonFile(path.join(dataDir, `${providerId}.json`));
  for (const modelsOfApi of Object.values(doc || {})) {
    if (!modelsOfApi || typeof modelsOfApi !== "object") continue;
    for (const [id, meta] of Object.entries(modelsOfApi)) {
      if (meta && typeof meta === "object" && !byModel.has(id)) byModel.set(id, meta);
    }
  }
  piCatalogCache.set(providerId, byModel);
  return byModel;
}

function piCatalogEntry(providerId, modelId) {
  return piCatalogModels(providerId).get(modelId) ?? null;
}

/** Effective thinking metadata for one models.json model entry: a user-tuned
 *  thinkingLevelMap wins, then the gateway overlay (jellytoken etc.), then
 *  Pi's built-in catalog. */
export function resolveThinkingMeta(providerId, entry, providerCfg = {}) {
  const catalog = piCatalogEntry(providerId, entry.id);
  const known = knownThinkingMeta({
    providerId,
    baseUrl: providerCfg.baseUrl,
    modelId: entry.id,
  });
  if (entry.thinkingLevelMap && typeof entry.thinkingLevelMap === "object") {
    return {
      reasoning: entry.reasoning ?? known?.reasoning ?? catalog?.reasoning ?? false,
      thinkingLevelMap: entry.thinkingLevelMap,
    };
  }
  if (known) {
    return { reasoning: known.reasoning, thinkingLevelMap: known.thinkingLevelMap };
  }
  return {
    reasoning: entry.reasoning ?? catalog?.reasoning ?? false,
    thinkingLevelMap: catalog?.thinkingLevelMap,
  };
}

/** First catalog-valid candidate wins; otherwise first listed model. */
export function resolveModelsDefault(providers, candidates = []) {
  for (const candidate of candidates) {
    const provider = String(candidate?.provider || "").trim();
    const model = String(candidate?.model || "").trim();
    if (!provider || !model) continue;
    const models = providers[provider]?.models;
    if (Array.isArray(models) && models.some((entry) => entry?.id === model)) {
      return { provider, model };
    }
  }
  for (const [name, cfg] of Object.entries(providers || {})) {
    const first = cfg?.models?.[0]?.id;
    if (first) return { provider: name, model: first };
  }
  return { provider: "coding-relay", model: "gpt-5.6-luna" };
}

export function modelsPayload() {
  const agentDir = resolveProductAgentDir();
  const rawModels = readJsonFile(path.join(agentDir, "models.json"));
  const authRaw = readJsonFile(path.join(agentDir, "auth.json"));
  const authProviders = new Set();
  if (authRaw && typeof authRaw === "object") {
    const inner = authRaw.providers;
    const source = inner && typeof inner === "object" ? inner : authRaw;
    for (const key of Object.keys(source)) authProviders.add(key);
  }
  const providers = {};
  const rawProviders = rawModels && typeof rawModels === "object" ? rawModels.providers : null;
  for (const [name, cfg] of Object.entries(rawProviders || {})) {
    if (!cfg || typeof cfg !== "object") continue;
    const configuredEntries = (Array.isArray(cfg.models) ? cfg.models : [])
      .filter((m) => m && typeof m === "object" && typeof m.id === "string" && m.id);
    const configuredIds = new Set(configuredEntries.map((m) => m.id));
    // A long-lived models.json may predate models newly added to Pi's bundled
    // provider catalog. Keep its explicit order/overrides, then expose missing
    // bundled entries so an authenticated built-in provider never appears to
    // lack a model that the running Pi actually supports.
    const modelEntries = [
      ...configuredEntries,
      ...[...piCatalogModels(name).values()].filter((m) => !configuredIds.has(m.id)),
    ];
    const models = modelEntries
      .filter((m) => m && typeof m === "object" && typeof m.id === "string" && m.id)
      .map((m) => ({
        id: m.id,
        label: String(m.name || m.id),
        thinkingLevels: supportedThinkingLevels(resolveThinkingMeta(name, m, cfg)),
        image: modelAcceptsImage(name, m),
      }));
    if (models.length) {
      providers[name] = {
        label: String(cfg.name || name),
        models,
        hasAuth: authProviders.has(name) || Boolean(cfg.apiKey),
      };
    }
  }
  const prefs = loadUserPrefs(resolveUserPrefsPath());
  const piSettings = readJsonFile(path.join(agentDir, "settings.json"));
  const def = resolveModelsDefault(providers, [
    { provider: prefs.provider, model: prefs.model },
    { provider: piSettings?.defaultProvider, model: piSettings?.defaultModel },
    { provider: "coding-relay", model: "gpt-5.6-luna" },
  ]);
  return { providers, default: def };
}
