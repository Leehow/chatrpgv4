/**
 * Pure-file display projections for the web UI. Everything here reads
 * canonical campaign/workspace JSON files and formats them — no game
 * semantics, no writes. Projections that need canonical plugin functions
 * (character sheets, module library, engine transcripts) live in the Python
 * sidecar (runtime/sdk/web_views.py) and are reached via sidecar.request().
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ---------------------------------------------------------------------------
// Workspace file helpers

export const cocRoot = (workspace) => path.join(workspace, ".coc");
export const campaignDir = (workspace, campaignId) =>
  path.join(cocRoot(workspace), "campaigns", campaignId);

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
 * an extra roll; a ready firearm contributes the rules-owned DEX + 50 value. */
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

function firstRollValue(record, field) {
  const payload = record?.payload;
  if (payload && typeof payload === "object" && field in payload) return payload[field];
  return record?.[field];
}

/** Closed, player-safe roll projection for the renderer. */
function publicRollDisplay(record, combatMeta = null) {
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
    "expression", "die_expression", "governing_attribute", "reason",
    "san_loss_expression", "san_loss_resolution", "source",
  ];
  const integerFields = [
    "target", "base_target", "effective_target", "required_target", "bonus",
    "penalty", "bonus_penalty_dice", "app", "credit_rating", "governing_value",
    "san_before", "san_after", "san_delta", "san_loss", "final_total", "total",
    "units", "unmodified_roll",
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
  if (combatMeta && typeof combatMeta === "object") Object.assign(value, combatMeta);
  return value;
}

/**
 * Bind public roll ids to the canonical combat record without copying combat
 * mechanics into the web layer.  The renderer receives a closed projection of
 * structured labels and numeric effects only; private intent and actor ids stay
 * out of the player transcript.
 */
function combatRollMetadataIndex(workspace, campaignId) {
  const combat = readJsonFile(path.join(campaignDir(workspace, campaignId), "save", "combat.json"));
  const index = new Map();
  if (!combat || typeof combat !== "object") return index;

  const modifierFields = [
    "point_blank", "cover", "outnumbered_penalty", "aimed", "multi_shot",
    "load_and_fire", "vs_prone_melee", "vs_prone_ranged", "bonus", "penalty",
  ];
  for (const round of Array.isArray(combat.rounds) ? combat.rounds : []) {
    for (const turn of Array.isArray(round?.turns) ? round.turns : []) {
      if (!turn || typeof turn !== "object") continue;
      const attackModifiers = {};
      const rawModifiers = turn.attack_modifiers;
      if (rawModifiers && typeof rawModifiers === "object") {
        for (const field of modifierFields) {
          const candidate = rawModifiers[field];
          if (typeof candidate === "boolean" || Number.isInteger(candidate)) {
            attackModifiers[field] = candidate;
          }
        }
      }
      const base = {
        action: typeof turn.action === "string" ? turn.action : null,
        defense_kind: typeof turn.defense_kind === "string" ? turn.defense_kind : null,
        opposed_outcome: typeof turn.opposed_outcome === "string" ? turn.opposed_outcome : null,
        combat_outcome: typeof turn.outcome === "string" ? turn.outcome : null,
        attack_modifiers: attackModifiers,
      };
      const add = (rollId, combatRole, extra = {}) => {
        if (typeof rollId !== "string" || !rollId) return;
        index.set(rollId, { ...base, combat_role: combatRole, ...extra });
      };
      add(turn.roll_id, "attack");
      add(turn.opposed_roll_id, "defense");
      add(turn.cover_reroll_roll_id, "attack_reroll");
      add(turn.damage_roll_id, "damage");
      add(turn.fight_back_damage_roll_id, "damage", { damage_source: "fight_back" });
      for (const shot of Array.isArray(turn.shots) ? turn.shots : []) {
        add(shot?.roll_id, "attack");
        add(shot?.damage_roll_id, "damage");
      }
      for (const volley of Array.isArray(turn.volleys) ? turn.volleys : []) {
        add(volley?.roll_id, "attack");
        for (const rollId of Array.isArray(volley?.damage_roll_ids) ? volley.damage_roll_ids : []) {
          add(rollId, "damage");
        }
      }
    }
  }
  for (const damage of Array.isArray(combat.damage_chain) ? combat.damage_chain : []) {
    const rollId = damage?.damage_roll_id;
    if (typeof rollId !== "string" || !rollId) continue;
    const previous = index.get(rollId) || { combat_role: "damage" };
    const safe = {};
    for (const field of [
      "raw_damage", "armor_absorbed", "hp_before", "hp_delta", "hp_after",
      "armor_before", "armor_after",
    ]) {
      if (Number.isInteger(damage[field])) safe[field] = damage[field];
    }
    if (typeof damage.die === "string" && damage.die) safe.damage_expression = damage.die;
    index.set(rollId, { ...previous, ...safe });
  }
  return index;
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

function publicRollIndex(workspace, campaignId) {
  const rows = readJsonlDicts(
    path.join(campaignDir(workspace, campaignId), "logs", "rolls.jsonl"),
  );
  const index = new Map();
  for (const row of rows) {
    const roll = publicRollDisplay(row);
    if (roll?.roll_id) index.set(roll.roll_id, roll);
  }
  return index;
}

/**
 * Preserve the canonical finalization order while exposing public checks as
 * typed blocks.  This deliberately consumes the finalizer's structured
 * `segments`; it never guesses at dice by searching Keeper prose.
 */
function keeperContentBlocks(transcriptRow, finalization, combatMetaByRollId) {
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
  for (const check of checks) {
    const id = check?.roll_id;
    if (typeof id === "string" && id) checksById.set(id, check);
  }

  const blocks = [];
  for (const segment of segments) {
    if (segment.segment_type === "public_check") {
      const sourceIds = Array.isArray(segment.source_ids)
        ? segment.source_ids.filter((id) => typeof id === "string" && id)
        : [];
      const rolls = sourceIds
        .map((id) => publicRollDisplay(checksById.get(id), combatMetaByRollId.get(id)))
        .filter(Boolean);
      blocks.push({ type: "roll_group", text: segment.text, source_ids: sourceIds, rolls });
      continue;
    }
    const previous = blocks[blocks.length - 1];
    if (previous?.type === "prose") {
      previous.text += `\n\n${segment.text}`;
    } else {
      blocks.push({ type: "prose", text: segment.text });
    }
  }
  return blocks;
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
  const finalizations = turnFinalizationIndex(workspace, campaignId);
  const rollsById = publicRollIndex(workspace, campaignId);
  const combatMetaByRollId = combatRollMetadataIndex(workspace, campaignId);
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
      if (startMs != null) {
        entry.at = startMs;
        entry.started_at = startMs;
      }
      out.push(entry);
    }
    if (keeper) {
      const entry = { role: "keeper", text: String(keeper.text || "").trim() };
      const finalizationId = keeper.finalization_id;
      if (typeof finalizationId === "string" && finalizationId) {
        const contentBlocks = keeperContentBlocks(
          keeper,
          finalizations.get(finalizationId),
          combatMetaByRollId,
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
      if (Array.isArray(manifest.pages)) pageCount = manifest.pages.length;
      const source = manifest.source;
      if (source && typeof source === "object") {
        const sp = source.path || source.original_path;
        if (typeof sp === "string" && sp.trim()) {
          sourcePdf = sp.trim();
          title = path.basename(sourcePdf) || title;
        }
        const sha = source.file_sha256;
        if (typeof sha === "string" && sha.length === 64) fileSha256 = sha.toLowerCase();
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
function piCatalogEntry(providerId, modelId) {
  if (!piCatalogCache) piCatalogCache = new Map();
  if (piCatalogCache.has(providerId)) return piCatalogCache.get(providerId)?.get(modelId) ?? null;
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
  return byModel.get(modelId) ?? null;
}

/** Effective thinking metadata for one models.json model entry: entry fields
 *  win (pi's applyModelOverride order), built-in catalog fills the gaps. */
export function resolveThinkingMeta(providerId, entry) {
  const catalog = piCatalogEntry(providerId, entry.id);
  return {
    reasoning: entry.reasoning ?? catalog?.reasoning ?? false,
    thinkingLevelMap: entry.thinkingLevelMap ?? catalog?.thinkingLevelMap,
  };
}

export function modelsPayload() {
  const agentDir = process.env.PI_AGENT_DIR || path.join(os.homedir(), ".pi", "agent");
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
    const models = (Array.isArray(cfg.models) ? cfg.models : [])
      .filter((m) => m && typeof m === "object" && typeof m.id === "string" && m.id)
      .map((m) => ({
        id: m.id,
        label: String(m.name || m.id),
        thinkingLevels: supportedThinkingLevels(resolveThinkingMeta(name, m)),
      }));
    if (models.length) {
      providers[name] = {
        label: String(cfg.name || name),
        models,
        hasAuth: authProviders.has(name) || Boolean(cfg.apiKey),
      };
    }
  }
  let def = { provider: "coding-relay", model: "gpt-5.6-luna" };
  const providerIds = new Set((providers[def.provider]?.models || []).map((m) => m.id));
  if (!providers[def.provider] || !providerIds.has(def.model)) {
    for (const [name, cfg] of Object.entries(providers)) {
      def = { provider: name, model: cfg.models[0].id };
      break;
    }
  }
  return { providers, default: def };
}
