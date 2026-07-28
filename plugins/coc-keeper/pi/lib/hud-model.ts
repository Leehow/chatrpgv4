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

export interface ActiveTableIdentity {
  schema_version: 1;
  contract_id: "coc.pi-active-table-identity.v1";
  campaign_id: string;
  investigator_ids: string[];
}

const SAFE_TABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

/** Build one exact player-safe table binding; never choose one party member. */
export function buildActiveTableIdentity(
  campaignIdValue: unknown,
  sceneValue: unknown,
): ActiveTableIdentity | null {
  const campaignId = str(campaignIdValue);
  const scene = asObject(sceneValue);
  const party = scene?.party;
  if (
    !campaignId
    || !SAFE_TABLE_ID.test(campaignId)
    || str(scene?.campaign_id) !== campaignId
    || !Array.isArray(party)
    || party.length === 0
    || party.length > 128
  ) return null;
  const investigatorIds: string[] = [];
  for (const value of party) {
    const investigatorId = str(value);
    if (!investigatorId || !SAFE_TABLE_ID.test(investigatorId)) return null;
    investigatorIds.push(investigatorId);
  }
  if (new Set(investigatorIds).size !== investigatorIds.length) return null;
  return {
    schema_version: 1,
    contract_id: "coc.pi-active-table-identity.v1",
    campaign_id: campaignId,
    investigator_ids: investigatorIds,
  };
}

/** Hidden provider context containing identifiers only, never table content. */
export function activeTableIdentityMessage(
  binding: ActiveTableIdentity,
): JsonObject {
  return {
    role: "custom",
    customType: "coc.pi-active-table-identity",
    content: [{
      type: "text",
      text: (
        "Active COC table identity. In every coc_invoke call, copy the exact "
        + "campaign_id and the applicable exact investigator_id from this "
        + "binding. Never substitute a remembered, generated, or different "
        + `table identifier.\n${JSON.stringify(binding)}`
      ),
    }],
    display: false,
    details: {
      schema_version: 1,
      contract_id: "coc.pi-active-table-identity.v1",
    },
    timestamp: Date.now(),
  };
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
  const tableReady = investigators.length > 0;

  return {
    campaignId: input.campaignId,
    // Sparse opening projection can exist before an investigator is linked.
    // Until the authoritative party is non-empty, the HUD is onboarding
    // chrome only: do not surface opening place/time, inventory, or clues.
    timeDisplay: tableReady ? timeDisplay : null,
    placeDisplay: tableReady ? placeDisplay : null,
    turn: tableReady ? num(scene.turn_number) : null,
    investigators,
    items: tableReady ? items : [],
    clues: tableReady ? clues : [],
    clueCount: tableReady ? clueCount : 0,
    error: input.error ?? null,
  };
}

/** 1–3 footer lines for the editor bottom (replaces coding token footer). */
export function formatHudFooterLines(snapshot: HudSnapshot, width: number): string[] {
  if (snapshot.error) {
    return [clip(`COC · ${snapshot.campaignId} · ${snapshot.error}`, width)];
  }

  const inv = snapshot.investigators[0];
  if (!inv) {
    return [
      clip("COC · 无调查员 · 尚未开桌 · /hud 展开", width),
    ];
  }
  const who = [
    inv.name,
    inv.occupation,
    inv.hp ? `HP ${inv.hp}` : null,
    inv.san ? `SAN ${inv.san}` : null,
    inv.luck != null ? `运 ${inv.luck}` : null,
  ].filter(Boolean).join(" · ");

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
  if (!snapshot.investigators.length) {
    return ["（尚未开桌；调查员尚未加入战役）"];
  }
  if (kind === "sheet") {
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
