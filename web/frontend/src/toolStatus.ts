/**
 * Map keeper toolbox / discover tool ids to short Chinese KP-status lines.
 *
 * Tool ids are a closed machine vocabulary (not free player prose). Unknown
 * ids fall back to a calm generic phrase so the player never sees raw English
 * tool names in the chat stream.
 */

const EXACT: Record<string, string> = {
  "session.resume": "KP 正在唤醒这场遭遇…",
  "session.start": "KP 正在打开这场遭遇…",
  "state.move_scene": "KP 正在带你进入下一处…",
  "state.journal": "KP 正在把这一幕记入卷宗…",
  "state.item_grant": "KP 正在清点你的行囊…",
  "state.item_remove": "KP 正在调整你的行囊…",
  "turn.finalize": "KP 正在落定这一回合…",
  "director.advise": "KP 正在斟酌节奏…",
  "storylets.suggest": "KP 正在感受故事的走向…",
  "narration.brief": "KP 正在组织措辞…",
  "narration.review": "KP 正在打磨叙述…",
  "npc.advise": "KP 正在端详在场人物…",
  "npc.query": "KP 正在回想此人的来历…",
  "npc.reaction": "KP 正在捕捉第一印象…",
  "clues.query": "KP 正在对照已得线索…",
  "actions.advise": "KP 正在估量可行的举动…",
  "actions.list": "KP 正在打量此间的可能性…",
  "combat.context": "KP 正在审视交战态势…",
  "combat.resolve": "KP 正在裁定这一击…",
  "combat.end": "KP 正在收束战斗…",
  "chase.context": "KP 正在追看追逐的节奏…",
  "chase.execute": "KP 正在推进追逐…",
  "epistemic.query": "KP 正在梳理未解之问…",
  "evidence.table_opening": "KP 正在铺开开场…",
  "evidence.record_adoption": "KP 正在记下取舍…",
  "personal_horror.query": "KP 正在触碰旧伤…",
  "mechanics.ensure": "KP 正在核对规则细节…",
  "development.settle": "KP 正在结算成长…",
};

const PREFIX: Array<[string, string]> = [
  ["rules.roll", "KP 正在掷骰…"],
  ["rules.", "KP 正在查阅规则…"],
  ["state.", "KP 正在更新世界状态…"],
  ["scene.", "KP 正在把握场景…"],
  ["director.", "KP 正在斟酌节奏…"],
  ["storylets.", "KP 正在感受故事的走向…"],
  ["narration.", "KP 正在组织措辞…"],
  ["npc.", "KP 正在端详人物…"],
  ["clues.", "KP 正在对照线索…"],
  ["actions.", "KP 正在估量行动…"],
  ["combat.", "KP 正在裁定战斗…"],
  ["chase.", "KP 正在推进追逐…"],
  ["session.", "KP 正在料理战役…"],
  ["turn.", "KP 正在推进回合…"],
  ["evidence.", "KP 正在整理证据…"],
  ["epistemic.", "KP 正在梳理认知…"],
  ["inventory.", "KP 正在清点物品…"],
  ["setup.", "KP 正在准备开局…"],
  ["investigator.", "KP 正在查看调查员…"],
];

const GENERIC = [
  "KP 正在主持这场遭遇…",
  "KP 正在运筹帷幄…",
  "KP 正在翻动卷宗…",
  "KP 正在倾听桌下的回响…",
];

function normalizeToolId(raw: string): string {
  let t = raw.trim();
  if (t.startsWith("coc_invoke:")) t = t.slice("coc_invoke:".length);
  // Discover probes are meta-lookups; keep the inner id for exact match first.
  if (t.startsWith("coc_discover:")) t = t.slice("coc_discover:".length);
  return t;
}

/** Whether this raw event is a discover/catalog probe (not the real op). */
export function isDiscoverTool(raw: string): boolean {
  return raw.includes("coc_discover:") || raw === "coc_discover";
}

/**
 * Player-facing KP status for one tool event.
 * Discover probes get softer phrasing so the trail doesn't spam.
 */
export function toolToStatus(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return GENERIC[0];

  if (trimmed === "coc_discover" || trimmed.startsWith("coc_discover:")) {
    // Discover is a catalog probe — keep one calm line, don't echo the inner id.
    return "KP 正在探查可行路径…";
  }

  const id = normalizeToolId(trimmed);
  if (EXACT[id]) return EXACT[id];

  for (const [prefix, label] of PREFIX) {
    if (id.startsWith(prefix)) return label;
  }

  // Stable generic pick from the id so the same tool doesn't flicker.
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash + id.charCodeAt(i) * (i + 1)) % 997;
  return GENERIC[hash % GENERIC.length];
}

/** Latest tool in the trail → current status line. */
export function trailToCurrentStatus(trail: string[]): string {
  if (!trail.length) return GENERIC[0];
  return toolToStatus(trail[trail.length - 1]);
}
