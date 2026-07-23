/**
 * Player-safe COC table HUD projection (no keeper secrets).
 * Pure functions — unit-testable without Pi TUI.
 */

export type JsonObject = Record<string, unknown>;

export interface HudInvestigator {
  id: string;
  name: string;
  occupation: string | null;
  hp: string | null;
  san: string | null;
  mp: string | null;
  luck: string | null;
  conditions: string[];
}

export interface HudItem {
  label: string;
  kind: string | null;
}

export interface HudClue {
  id: string;
  summary: string;
}

export interface HudSnapshot {
  campaignId: string;
  timeDisplay: string | null;
  placeDisplay: string | null;
  turn: number | null;
  investigators: HudInvestigator[];
  items: HudItem[];
  clues: HudClue[];
  /** Authoritative discovered count (may exceed clues[] when summaries are capped). */
  clueCount: number;
  error: string | null;
}

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function pool(value: unknown): string | null {
  const obj = asObject(value);
  if (!obj) {
    const n = num(value);
    return n === null ? null : String(n);
  }
  const current = obj.current;
  const max = obj.max;
  if (current == null && max == null) return null;
  if (max == null) return String(current);
  return `${current ?? "?"}/${max}`;
}

function localizedSummary(row: JsonObject): string | null {
  const localized = asObject(row.localized_text);
  if (localized) {
    const zh = str(localized["zh-Hans"]) ?? str(localized.zh);
    if (zh) return zh;
    for (const value of Object.values(localized)) {
      const text = str(value);
      if (text) return text;
    }
  }
  return str(row.player_safe_summary) ?? str(row.label) ?? str(row.title);
}

/** Project scene.context + inventory + clues.query into a player-safe HUD. */
export function buildHudSnapshot(input: {
  campaignId: string;
  scene?: unknown;
  inventory?: unknown;
  clues?: unknown;
  error?: string | null;
}): HudSnapshot {
  const scene = asObject(input.scene) ?? {};
  const time = asObject(scene.time);
  const playerTime = time ? asObject(time.player_time) : null;
  const timeDisplay =
    (playerTime ? str(playerTime.display) : null) ??
    (time ? str(time.display) : null);

  const sceneMeta = asObject(scene.scene);
  const tags = sceneMeta && Array.isArray(sceneMeta.location_tags)
    ? sceneMeta.location_tags.map(str).filter((v): v is string => Boolean(v))
    : [];
  const placeDisplay =
    tags[0] ??
    str(scene.active_scene_id) ??
    null;

  const investigators: HudInvestigator[] = [];
  const party = Array.isArray(scene.party_investigators) ? scene.party_investigators : [];
  for (const row of party) {
    const inv = asObject(row);
    if (!inv) continue;
    const id = str(inv.investigator_id);
    if (!id) continue;
    const conditions = Array.isArray(inv.conditions)
      ? inv.conditions.map(str).filter((v): v is string => Boolean(v))
      : [];
    investigators.push({
      id,
      name: str(inv.name) ?? id,
      occupation: str(inv.occupation),
      hp: pool(inv.hp),
      san: pool(inv.san),
      mp: pool(inv.mp),
      luck: inv.luck == null ? null : String(inv.luck),
      conditions,
    });
  }

  const items: HudItem[] = [];
  const invData = asObject(input.inventory);
  if (invData) {
    for (const key of ["items", "weapons"] as const) {
      const rows = invData[key];
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        const item = asObject(row);
        if (!item) continue;
        const label = str(item.label) ?? str(item.weapon_id) ?? str(item.item_id);
        if (!label) continue;
        items.push({ label, kind: str(item.kind) ?? (key === "weapons" ? "weapon" : null) });
      }
    }
  }

  const clues: HudClue[] = [];
  // Prefer compact player-safe index from scene.context (survives MCP projection).
  // Fall back to clues.query / clues_here when present and not payload-projected.
  const publicFromScene = Array.isArray(scene.discovered_clues_public)
    ? scene.discovered_clues_public
    : null;
  const clueRoot = asObject(input.clues) ?? {};
  const clueRows = publicFromScene
    ?? (Array.isArray(clueRoot.clues) ? clueRoot.clues : null)
    ?? (Array.isArray(scene.clues_here) ? scene.clues_here : []);
  for (const row of clueRows) {
    const clue = asObject(row);
    if (!clue) continue;
    // Player-safe: only discovered rows with non-secret public text.
    if (clue.discovered === false || clue.secret === true) continue;
    if (clue.discovered !== true && publicFromScene == null) continue;
    const summary = localizedSummary(clue);
    if (!summary) continue;
    const id = str(clue.clue_id) ?? "clue";
    clues.push({ id, summary });
  }
  const declaredCount = num(scene.discovered_clue_count);
  const clueCount = Math.max(declaredCount ?? 0, clues.length);

  return {
    campaignId: input.campaignId,
    timeDisplay,
    placeDisplay,
    turn: num(scene.turn_number),
    investigators,
    items,
    clues,
    clueCount,
    error: input.error ?? null,
  };
}

/** 1–3 footer lines for the editor bottom (replaces coding token footer). */
export function formatHudFooterLines(snapshot: HudSnapshot, width: number): string[] {
  if (snapshot.error) {
    return [clip(`COC · ${snapshot.campaignId} · ${snapshot.error}`, width)];
  }

  const inv = snapshot.investigators[0];
  const who = inv
    ? [
        inv.name,
        inv.occupation,
        inv.hp ? `HP ${inv.hp}` : null,
        inv.san ? `SAN ${inv.san}` : null,
        inv.luck != null ? `运 ${inv.luck}` : null,
      ].filter(Boolean).join(" · ")
    : "无调查员";

  const where = [
    snapshot.timeDisplay,
    snapshot.placeDisplay,
    snapshot.turn != null ? `第${snapshot.turn}回合` : null,
  ].filter(Boolean).join(" · ") || "时间/地点未知";

  const pack = [
    `物品 ${snapshot.items.length}`,
    `线索 ${snapshot.clueCount}`,
    "/hud 展开",
  ].join(" · ");

  const line1 = clip(`COC · ${who}`, width);
  const line2 = clip(`${where} · ${pack}`, width);
  return [line1, line2];
}

export function formatHudDetail(kind: "sheet" | "time" | "inv" | "clues", snapshot: HudSnapshot): string[] {
  if (snapshot.error) return [`错误: ${snapshot.error}`];
  if (kind === "sheet") {
    if (!snapshot.investigators.length) return ["（无调查员）"];
    const lines: string[] = [];
    for (const inv of snapshot.investigators) {
      lines.push(`${inv.name}${inv.occupation ? ` · ${inv.occupation}` : ""}`);
      lines.push(
        [
          inv.hp ? `HP ${inv.hp}` : null,
          inv.san ? `SAN ${inv.san}` : null,
          inv.mp ? `MP ${inv.mp}` : null,
          inv.luck != null ? `运气 ${inv.luck}` : null,
        ].filter(Boolean).join("  ") || "（无资源数据）",
      );
      if (inv.conditions.length) lines.push(`状态: ${inv.conditions.join("、")}`);
      lines.push("");
    }
    return lines;
  }
  if (kind === "time") {
    return [
      `时间: ${snapshot.timeDisplay ?? "未知"}`,
      `地点: ${snapshot.placeDisplay ?? "未知"}`,
      snapshot.turn != null ? `回合: ${snapshot.turn}` : "回合: —",
    ];
  }
  if (kind === "inv") {
    if (!snapshot.items.length) return ["（物品栏为空）"];
    return snapshot.items.map((item) =>
      item.kind ? `· ${item.label} (${item.kind})` : `· ${item.label}`,
    );
  }
  // clues
  if (!snapshot.clues.length) return ["（尚无已发现线索）"];
  return snapshot.clues.map((clue) => `· ${clue.summary}`);
}

function clip(text: string, width: number): string {
  if (width <= 0 || text.length <= width) return text;
  if (width <= 1) return "…";
  return `${text.slice(0, Math.max(0, width - 1))}…`;
}
