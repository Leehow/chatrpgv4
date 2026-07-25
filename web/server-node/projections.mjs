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
      .map((m) => ({ id: m.id, label: String(m.name || m.id) }));
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
