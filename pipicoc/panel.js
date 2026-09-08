/**
 * The investigator panel in the right sidebar (contract §22.7).
 *
 * Plain ESM with no imports, on purpose. The renderer imports this file as a module and calls
 * `createComponent(React)` with its own React instance (`controlled-component-loader.ts`); a bare
 * `react` import cannot resolve there, and a build step would put a compiled artifact between the
 * source and what ships. So: no JSX, no bundler, `React.createElement` through the `h` helper.
 *
 * It draws what the kernel answers and nothing else. Every value comes from one read-only
 * `table.view` (see `sheet.ts`); the panel's only arithmetic is a bar's percentage and turning a
 * minute count into days/hours, because a second place that computes COC values is a second rules
 * engine.
 *
 * Skill and characteristic names are NOT in that table: the kernel hands them over already in
 * the play language (`view.labels`, from the rules data's own `localized_labels`, §16.5). The
 * glossary stays where the rules live; this file only looks a term up and falls back to the
 * canonical name.
 *
 * LABELS ARE THE ONE EXCEPTION TO §16.1 (user's ruling, 2026-09-06). The system language is
 * English and the repository ships no string tables — except here: this surface is read by the
 * player, and the Keeper, who writes everything else the player sees, cannot reach it. So the
 * chrome is a table keyed by the campaign's own `play_language`. Adding a language means adding a
 * column here and nowhere else; a missing key falls back to English rather than showing a blank.
 */

const STYLE_ID = "pipicoc-sheet-style";
const CSS = `
/* The sidebar shares the chat card's dossier typography and host theme tokens. */
.coc-sheet{--coc-serif:ui-serif,"Songti SC","Noto Serif CJK SC",Georgia,serif;
  box-sizing:border-box;container-type:inline-size;display:flex;flex-direction:column;
  height:100%;min-height:0;min-width:0;overflow:auto;padding:16px 16px 28px;
  color:var(--text);font-size:13px;line-height:1.6;scrollbar-width:thin}
.coc-sheet>*{flex-shrink:0}
.coc-sheet-identity{padding:16px;border:1px solid var(--border);border-top:3px solid var(--accent);
  border-radius:12px;background:var(--surface-raised,var(--surface));
  box-shadow:0 3px 14px color-mix(in srgb,var(--text) 4%,transparent)}
.coc-sheet-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.coc-sheet-name{min-width:0;color:var(--text-strong);font:600 24px/1.3 var(--coc-serif);
  letter-spacing:-.025em;overflow-wrap:anywhere}
.coc-sheet :focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.coc-sheet-refresh{flex:none;border:1px solid var(--border);border-radius:7px;background:var(--surface);
  color:var(--accent);padding:5px 9px;font:inherit;font-size:11px;cursor:pointer;min-height:30px}
.coc-sheet-refresh:hover{border-color:var(--accent)}
.coc-sheet-refresh:disabled{opacity:.5;cursor:default}
.coc-sheet-fields{margin:12px 0 0;display:grid;grid-template-columns:auto 1fr;gap:4px 12px;align-items:baseline}
.coc-sheet-field-key{color:var(--muted);font-size:11px}
.coc-sheet-field-val{color:var(--text);font-size:12px;overflow-wrap:anywhere}
.coc-sheet-field-val span{padding-bottom:1px}
.coc-sheet-concept{margin:12px 0 0;padding-top:12px;border-top:1px solid var(--border);
  color:var(--muted);font-size:12px;line-height:1.75}
.coc-sheet-note{margin:10px 0;color:var(--muted);line-height:1.65;font-size:12px}
.coc-sheet-section{margin:24px 0 0;min-width:0}
.coc-sheet-heading{display:flex;align-items:center;gap:10px;margin:0 0 12px;color:var(--muted);
  font-size:12px;font-weight:650;line-height:1.4;letter-spacing:.025em}
.coc-sheet-heading::after{content:"";flex:1;height:1px;background:var(--border)}
.coc-vitals{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.coc-vital{--tone:var(--muted);min-width:0;padding:11px 12px;border:1px solid var(--border);
  border-radius:9px;background:color-mix(in srgb,var(--tone) 5%,var(--surface-raised,var(--surface)))}
.coc-vital-key{display:block;color:var(--muted);font-size:11px;line-height:1.4;margin-bottom:5px}
.coc-vital-num{color:var(--text-strong);font:600 26px/1.2 var(--coc-serif);font-variant-numeric:tabular-nums}
.coc-vital-max{color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums;white-space:nowrap}
.coc-vital-track{margin-top:7px;height:4px;border-radius:4px;overflow:hidden;background:var(--border)}
.coc-vital-fill{height:100%;background:var(--tone);border-radius:inherit}
/* Three columns preserve the characteristic grouping at every sidebar width. */
.coc-chars{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}
.coc-char{min-width:0;border:1px solid var(--border);border-radius:8px;padding:10px;
  background:var(--surface-raised,var(--surface))}
.coc-char-key{display:block;color:var(--muted);font-size:11px;line-height:1.4;overflow-wrap:anywhere}
.coc-char-val{display:block;margin-top:5px;color:var(--text-strong);font:600 21px/1.1 var(--coc-serif);
  font-variant-numeric:tabular-nums}
.coc-list{display:flex;flex-direction:column;gap:0}
.coc-line{display:flex;align-items:baseline;gap:8px;padding:7px 0;border-bottom:1px solid var(--border)}
.coc-line:last-child{border-bottom:0}
.coc-line-key{min-width:0;overflow-wrap:anywhere;font-size:12px}
.coc-line-lead,.coc-line-gap{flex:1;min-width:6px}
.coc-line-val{flex:none;color:var(--text-strong);font:600 15px/1.3 var(--coc-serif);font-variant-numeric:tabular-nums}
.coc-line-note{color:var(--muted);font-size:11px;overflow-wrap:anywhere}
.coc-inventory{list-style:none;margin:0;padding:0}
.coc-inventory-entry{padding:12px 0;border-bottom:1px solid var(--border)}
.coc-inventory-entry:first-child{padding-top:0}
.coc-inventory-entry:last-child{border-bottom:0;padding-bottom:0}
.coc-inventory-heading{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.coc-inventory-name{min-width:0;font-size:13px;font-weight:500;color:var(--text-strong);overflow-wrap:anywhere}
.coc-inventory-entry[data-detailed="true"] .coc-inventory-name{font-weight:650}
.coc-inventory-quantity{flex:none;color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums}
.coc-inventory-params{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px 16px;
  margin:10px 0 0;padding:10px 12px;border-left:2px solid var(--border-strong,var(--border));
  background:color-mix(in srgb,var(--text) 3%,transparent)}
.coc-inventory-params>div{min-width:0}
.coc-inventory-params dt{margin-bottom:3px;color:var(--muted);font-size:11px}
.coc-inventory-params dd{margin:0;color:var(--text-strong);font-size:13px;line-height:1.6;
  overflow-wrap:anywhere;font-variant-numeric:tabular-nums}
.coc-inventory-wide{grid-column:1/-1}
.coc-finance{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 16px}
.coc-finance .coc-line{display:block;min-width:0;padding:0 0 10px}
.coc-finance .coc-line-key{display:block;margin-bottom:4px;color:var(--muted);font-size:11px}
.coc-finance .coc-line-gap{display:none}
.coc-finance .coc-line-val{font-size:17px;overflow-wrap:anywhere}
.coc-finance .coc-line:last-child:nth-child(odd){grid-column:1/-1}
.coc-more{margin-top:10px;width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:7px;
  background:var(--surface-raised,var(--surface));color:var(--accent);font:inherit;font-size:12px;cursor:pointer}
.coc-more:hover{border-color:var(--accent)}
.coc-clock{color:var(--text-strong);font:600 21px/1.35 var(--coc-serif);font-variant-numeric:tabular-nums}
.coc-standing{margin-top:10px;display:flex;flex-direction:column;gap:5px}
.coc-standing-line{display:flex;gap:12px;align-items:baseline}
.coc-standing-key{flex:none;width:3.2em;color:var(--muted);font-size:11px}
.coc-standing-val{min-width:0;font-size:12px;overflow-wrap:anywhere}
.coc-standing-line[data-live="1"] .coc-standing-val{color:var(--accent);font-weight:600}
.coc-background{margin:0;display:grid;gap:15px}
.coc-background>div{padding:0 0 0 11px;border-left:2px solid var(--border)}
.coc-background dt{font-size:11px;color:var(--muted);margin-bottom:5px;font-weight:600}
.coc-background dd{margin:0;font-size:13px;line-height:1.75;overflow-wrap:anywhere}
.coc-background [data-field="personal_description"]{padding:12px;border:1px solid var(--border);
  border-radius:9px;background:var(--surface-raised,var(--surface))}
.coc-background [data-field="Key connection"]{border-left-color:var(--accent)}
.coc-clue{padding:10px 0;border-top:1px solid var(--border);line-height:1.7}
.coc-clue:first-child{border-top:0;padding-top:0}
.coc-clue-name{color:var(--text-strong);font-weight:600}
.coc-clue-sum{margin-top:3px;color:var(--muted);font-size:12px}

/* A clue that says more than its name opens into what it says; one without a summary stays a
   plain line, because there is nothing to open into. */
.coc-clue-fold{display:block;padding:0}
.coc-clue-fold>summary{display:flex;align-items:baseline;gap:6px;padding:6px 0;cursor:pointer;
  list-style:none;border-radius:4px}
.coc-clue-fold>summary::-webkit-details-marker{display:none}
.coc-clue-fold>summary::after{content:"▸";margin-left:auto;flex:none;color:var(--subtle);
  font-size:10px;transition:transform .12s ease}
.coc-clue-fold[open]>summary::after{transform:rotate(90deg)}
.coc-clue-body{padding:0 0 8px;color:var(--muted);line-height:1.6;overflow-wrap:anywhere}


.coc-who{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0 0}
.coc-who button{padding:6px 10px;border:1px solid var(--border);border-radius:7px;
  background:var(--surface);color:var(--muted);font:inherit;font-size:12px;cursor:pointer}
.coc-who button[data-on="1"]{border-color:var(--accent);color:var(--accent)}
@container (min-width:420px){.coc-vitals{grid-template-columns:repeat(4,minmax(0,1fr))}}
`;

if (typeof document !== "undefined" && !document.getElementById(STYLE_ID)) {
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.append(style);
}

/**
 * The chrome, per `play_language`. The closed set is the kernel's (§14.4): `zh-Hans`, `en`.
 * `en` is also the fallback, so an unknown tag degrades to readable rather than to blanks.
 */
const LABELS = {
  en: {
    loading: "Reading the table…",
    refresh: "Refresh",
    refreshing: "…",
    noTable: "Open a table to see the sheet.",
    noTableTitle: "No table yet",
    unboundTitle: "No campaign on this session",
    unboundDetail: "This session is bound to no campaign, and another one is never guessed for it.",
    errorTitle: "The sheet could not be read",
    errorDetail: "Try again.",
    retry: "Try again",
    noInvestigator: "No investigator",
    time: "Time",
    elapsed: (d, hh, mm) => (d > 0 ? `${d}d ${hh}h ${mm}m elapsed` : `${hh}h ${mm}m elapsed`),
    turn: (n) => `turn ${n}`,
    scene: "scene",
    present: "present",
    session: (kind, round) => (round ? `${kind} · round ${round}` : kind),
    awaitingChoice: "a decision is pending",
    condition: "Condition",
    luck: "Luck",
    characteristics: "Characteristics",
    skills: (n) => `Skills (${n})`,
    showAll: (n) => `Show all ${n}`,
    showFewer: "Show fewer",
    weapons: "Weapons",
    itemYes: "Yes", itemNo: "No",
    itemFields: {damage_die:"Base damage",damage:"Damage",base_range_yards:"Base range (yards)",range:"Range",uses_per_round:"Attacks per round",attacks:"Attacks",magazine:"Capacity",ammo:"Ammunition",malfunction:"Malfunction",skill:"Skill",adds_damage_bonus:"Adds damage bonus",special:"Notes",description:"Description"},
    equipment: "Equipment",
    noEquipment: "Carrying nothing yet.",
    finance: "Finance",
    cash: "Cash",
    assets: "Assets",
    spending: "Spending level",
    creditRating: "Credit rating",
    livingStandard: "Living standard",
    clues: "Clues",
    cluesHere: "here",
    noClues: "Nothing found yet.",
    occupation: "Occupation",
    era: "Era",
    ageKey: "Age",
    turnKey: "Turn",
    sceneKey: "Scene",
    presentKey: "Here",
    sessionKey: "Bout",
  },
  "zh-Hans": {
    loading: "正在读桌上的状态……",
    refresh: "刷新",
    refreshing: "……",
    noTable: "开一张桌子才有卡可看。",
    noTableTitle: "尚未开桌",
    unboundTitle: "尚未关联战役",
    unboundDetail: "此会话没有战役关联，不会自动猜测其他战役。",
    errorTitle: "人物数据读取失败",
    errorDetail: "请重试。",
    retry: "重试",
    noInvestigator: "还没有调查员",
    time: "时间",
    elapsed: (d, hh, mm) => (d > 0 ? `已过 ${d} 天 ${hh} 小时 ${mm} 分` : `已过 ${hh} 小时 ${mm} 分`),
    turn: (n) => `第 ${n} 回合`,
    scene: "场景",
    present: "在场",
    session: (kind, round) => (round ? `${kind} · 第 ${round} 轮` : kind),
    awaitingChoice: "有一个待决的选择",
    condition: "状态",
    luck: "幸运",
    characteristics: "属性",
    skills: (n) => `技能（${n}）`,
    showAll: (n) => `展开全部 ${n} 项`,
    showFewer: "收起",
    weapons: "武器",
    itemYes: "是", itemNo: "否",
    itemFields: {damage_die:"基础伤害",damage:"伤害",base_range_yards:"基础射程（码）",range:"射程",uses_per_round:"每轮攻击",attacks:"攻击次数",magazine:"弹匣容量",ammo:"当前弹药",malfunction:"故障值",skill:"使用技能",adds_damage_bonus:"计入伤害加值",special:"说明",description:"描述"},
    equipment: "物品",
    noEquipment: "身上还没有东西。",
    finance: "财务",
    cash: "现金",
    assets: "资产",
    spending: "消费水平",
    creditRating: "信用评级",
    livingStandard: "生活水准",
    clues: "线索",
    cluesHere: "此处",
    noClues: "还没有发现线索。",
    occupation: "职业",
    era: "时代",
    ageKey: "年龄",
    turnKey: "回合",
    sceneKey: "场景",
    presentKey: "在场",
    sessionKey: "战况",
  },
};

export function labelsFor(language) {
  return LABELS[language] || LABELS.en;
}

/** Skills worth showing before the player asks for the whole list. */
const SKILL_PREVIEW = 12;
/** The characteristics grid, in the order a sheet prints them. */
const CHARACTERISTIC_ORDER = ["STR", "CON", "SIZ", "DEX", "APP", "INT", "POW", "EDU", "LUCK"];
/** Derived values that are numbers or short words worth a cell. */
const DERIVED_ORDER = ["MOV", "DB", "BUILD"];

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function numberOr(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function text(value) {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : String(value);
}

/**
 * The clock as elapsed time, never as a wall clock. The kernel counts minutes from the campaign's
 * start (§20.7's `clock.minutes`) and says nothing about what hour the module opens at; printing
 * "06:10" would be inventing that.
 */
function elapsed(minutes) {
  const total = Math.max(0, Math.floor(minutes));
  return { days: Math.floor(total / 1440), hours: Math.floor((total % 1440) / 60), minutes: total % 60 };
}

/**
 * Project supplied item and weapon fields into read-only name, quantity and detail rows.
 */
function itemLine(item, term = value => value) {
  if (!isRecord(item)) return { title: term(text(item)), quantity: undefined, details: [] };
  const title = term(text(item.label || item.display_name || item.name || item.id));
  const details = [];
  for (const aliases of [["damage_die","damage"],["base_range_yards","range"],["uses_per_round","attacks"],["magazine"],["ammo"],["malfunction"],["skill"],["adds_damage_bonus"],["special"],["description"]]) {
    const key = aliases.find(key => item[key] !== undefined && item[key] !== null && item[key] !== "");
    if (key) details.push({key,value:item[key],wide:["skill","special","description"].includes(key)});
  }
  return {title, quantity:numberOr(item.quantity,undefined), details};
}

function money(value, term = value => value) {
  if (!isRecord(value)) return text(value);
  const amount = value.amount;
  const currency = term(text(value.currency));
  if (amount === undefined || amount === null) return currency;
  return currency ? `${text(amount)} ${currency}` : text(amount);
}

function clueLine(clue) {
  if (!isRecord(clue)) return { name: text(clue), summary: "" };
  return { name: text(clue.label || clue.name || clue.clue || clue.id), summary: text(clue.summary) };
}

export function createComponent(React) {
  const { useCallback, useEffect, useState, useRef } = React;
  const h = React.createElement;

  function Section(props) {
    return h("section", { className: "coc-sheet-section" },
      h("h2", { className: "coc-sheet-heading" }, props.title),
      props.children);
  }

  /**
   * A name and its value, with a layout variant for finance totals.
   * The spacer keeps skill names and values aligned without changing their contents.
   */
  function Lines(props) {
    return h("div", { className: `coc-list${props.kind ? " coc-" + props.kind : ""}` }, props.rows.map((row, index) =>
      h("div", { className: "coc-line", key: `${row.name}:${index}` },
        h("span", { className: "coc-line-key" }, row.name),
        h("span", { className: props.leader ? "coc-line-lead" : "coc-line-gap", "aria-hidden": "true" }),
        h("span", { className: row.numeric ? "coc-line-val" : "coc-line-note" }, row.value))));
  }

  /**
   * The four vitals. Each keeps its own tone from the host palette, so which number dropped is
   * legible before the label is read. HP is the danger tone because losing it is the danger;
   * SAN takes the accent because in this game sanity is the story.
   */
  const VITAL_TONE = { HP: "var(--danger)", SAN: "var(--accent)", MP: "var(--subtle)", luck: "var(--warning)" };

  function Vital(props) {
    const { label, tone, current, max } = props;
    const cap = typeof max === "number" && max > 0 ? max : undefined;
    const pct = cap ? Math.max(0, Math.min(100, (current / cap) * 100)) : 0;
    return h("div", { className: "coc-vital", style: { "--tone": tone }, title: label },
      h("span", { className: "coc-vital-key" }, label),
      h("span", { className: "coc-vital-num" }, text(current)),
      cap ? h("span", { className: "coc-vital-max" }, ` / ${cap}`) : null,
      // The bar restates the number beside it, so it is decoration to a screen reader.
      cap ? h("div", { className: "coc-vital-track", "aria-hidden": "true" },
        h("div", { className: "coc-vital-fill", style: { width: `${pct}%` } })) : null);
  }

  function Vitals(props) {
    const { sheet, t, term = value => value } = props;
    const derived = isRecord(sheet.derived) ? sheet.derived : {};
    const items = [];
    for (const [label, currentKey, maxKey] of [["HP", "hp", "HP"], ["SAN", "san", "SAN"], ["MP", "mp", "MP"]]) {
      const current = numberOr(sheet[currentKey], undefined);
      if (current === undefined) continue;
      // A maximum the kernel did not give is not one the panel may invent: the bar just goes away.
      items.push(h(Vital, { key: label, label: term(label), tone: VITAL_TONE[label], current, max: numberOr(derived[maxKey], undefined) }));
    }
    // Luck has no maximum on the sheet (§17.4), so it never grows a bar.
    const luck = numberOr(sheet.luck, undefined);
    if (luck !== undefined) items.push(h(Vital, { key: "luck", label: t.luck, tone: VITAL_TONE.luck, current: luck }));
    return items.length ? h(Section, { title: t.condition }, h("div", { className: "coc-vitals" }, items)) : null;
  }

  function Characteristics(props) {
    const { sheet, t, term } = props;
    const characteristics = isRecord(sheet.characteristics) ? sheet.characteristics : {};
    const derived = isRecord(sheet.derived) ? sheet.derived : {};
    const entries = [];
    for (const key of CHARACTERISTIC_ORDER) {
      if (key === "LUCK") continue; // The current Luck resource is already shown above.
      if (characteristics[key] !== undefined) entries.push([key, characteristics[key]]);
    }
    // Anything the kernel added that this list does not know about still shows, after the known ones.
    for (const key of Object.keys(characteristics)) {
      if (!CHARACTERISTIC_ORDER.includes(key)) entries.push([key, characteristics[key]]);
    }
    for (const key of DERIVED_ORDER) {
      if (derived[key] !== undefined) entries.push([key, derived[key]]);
    }
    if (!entries.length) return null;
    return h(Section, { title: t.characteristics },
      h("div", { className: "coc-chars" }, entries.map(([key, value]) =>
        h("div", { className: "coc-char", key },
          h("span", { className: "coc-char-key", title: term(key) }, term(key)),
          h("span", { className: "coc-char-val" }, key === "DB" && value === "none" ? "0" : typeof value === "string" ? term(value) : text(value))))));
  }

  function Skills(props) {
    const { sheet, t, term } = props;
    const [expanded, setExpanded] = useState(false);
    const skills = isRecord(sheet.skills) ? sheet.skills : {};
    const rows = Object.entries(skills)
      .map(([name, value]) => ({ name: term(name), value: numberOr(value, 0) }))
      // Highest first: at the table the question is always "what am I good at".
      .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
    if (!rows.length) return null;
    const shown = expanded ? rows : rows.slice(0, SKILL_PREVIEW);
    return h(Section, { title: t.skills(rows.length) },
      h(Lines, { leader: true, rows: shown.map(row => ({ name: row.name, value: text(row.value), numeric: true })) }),
      rows.length > SKILL_PREVIEW
        ? h("button", {
            type: "button", className: "coc-more", "aria-expanded": expanded ? "true" : "false",
            onClick: () => setExpanded(v => !v),
          }, expanded ? t.showFewer : t.showAll(rows.length))
        : null);
  }

  /**
   * Weapons or equipment. A printed sheet keeps its possessions box on the page whether or not
   * anything is written in it, and here the emptiness is the answer to a question the player is
   * actually asking -- do I have a flashlight? So a caller that passes `empty` gets the box with
   * that note instead of nothing at all, and the player can tell "carrying nothing" apart from
   * "this app does not track what I carry". A box with no `empty` word still disappears.
   */
  function ItemSection(props) {
    const list = Array.isArray(props.list) ? props.list : [];
    if (!list.length) {
      return props.empty ? h(Section, { title: props.title }, h("p", { className: "coc-sheet-note" }, props.empty)) : null;
    }
    const {t,term=value=>value}=props;
    const valueText=value=>typeof value==="boolean"?(value?t.itemYes:t.itemNo):Array.isArray(value)?value.map(valueText).join(" / "):term(text(value));
    return h(Section, { title: props.title },
      h("ul",{className:"coc-inventory"},list.map((item,index)=>{
        const object=(props.objects || []).find(row=>row.name===(isRecord(item)?text(item.name):text(item)));
        const merged=object&&isRecord(item)?{...item,...object.parameters,...(object.state?.ammo!==null&&object.state?.ammo!==undefined?{ammo:object.state.ammo}:{})}:item;
        const line=itemLine(merged,term);
        if(object){
          for(const trait of object.traits || []) line.details.push({key:`trait:${trait.name}`,label:trait.name,value:`${trait.value}${trait.unit?' '+trait.unit:''}`});
          for(const key of ['condition','charges']) if(object.state?.[key]!==null&&object.state?.[key]!==undefined) line.details.push({key,value:object.state[key]});
        }
        return h("li",{className:"coc-inventory-entry",key:index,"data-detailed":line.details.length>0?"true":"false"},
          h("div",{className:"coc-inventory-heading"},h("span",{className:"coc-inventory-name"},line.title),
            line.quantity!==undefined?h("span",{className:"coc-inventory-quantity"},`x${line.quantity}`):null),
          object?.description?h("p",{className:"coc-sheet-note",style:{margin:"6px 0"}},object.description):null,
          line.details.length?h("dl",{className:"coc-inventory-params"},line.details.map(({key,label,value,wide})=>
            h("div",{key,className:wide?"coc-inventory-wide":undefined},h("dt",null,label||t.itemFields[key]||term(key)),h("dd",null,valueText(value))))):null);
      })));
  }

  function Finance(props) {
    const { sheet, t, term = value => value } = props;
    const finance = isRecord(sheet.finance) ? sheet.finance : {};
    const rows = [];
    if (sheet.cash !== undefined || finance.cash !== undefined) {
      rows.push({ name: t.cash, value: finance.cash ? money(finance.cash, term) : text(sheet.cash), numeric: true });
    }
    if (finance.assets !== undefined) rows.push({ name: t.assets, value: money(finance.assets, term), numeric: true });
    if (finance.spending_level !== undefined) {
      rows.push({ name: t.spending, value: money(finance.spending_level, term), numeric: true });
    }
    const creditRating = sheet.credit_rating !== undefined ? sheet.credit_rating : finance.credit_rating;
    if (creditRating !== undefined) rows.push({ name: t.creditRating, value: text(creditRating), numeric: true });
    if (finance.living_standard !== undefined) rows.push({ name: t.livingStandard, value: term(text(finance.living_standard)) });
    return rows.length ? h(Section, { title: t.finance }, h(Lines, { kind: "finance", rows })) : null;
  }

  /** Where and when the table stands: the old panel's 时间 tab, minus the invented wall clock. */
  function Background(props) {
    const {sheet,term}=props;
    const rows=Object.entries(isRecord(sheet.backstory)?sheet.backstory:{})
      .filter(([key,value])=>key!=="concept"&&typeof value==="string"&&value.trim());
    if(sheet.own_language)rows.push(["Language",text(sheet.own_language)]);
    if(isRecord(sheet.key_connection)&&sheet.key_connection.summary)rows.push(["Key connection",text(sheet.key_connection.summary)]);
    if(!rows.length)return null;
    return h(Section,{title:term("Background")},h("dl",{className:"coc-background"},rows.map(([key,value])=>
      h("div",{key,"data-field":key},h("dt",null,term(key)),h("dd",null,term(value))))));
  }

  function Standing(props) {
    const { view, t } = props;
    const names = isRecord(view.standing_labels) ? view.standing_labels : {};
    const display = value => text(names[value]) || "…";
    const clock = isRecord(view.clock) ? view.clock : {};
    const minutes = numberOr(clock.minutes, undefined);
    const scene = isRecord(view.scene) ? view.scene : {};
    const session = isRecord(view.session) ? view.session : null;
    const lines = [];
    if (view.turn !== undefined && view.turn !== null) lines.push({ key: t.turnKey, value: text(view.turn) });
    if (scene.display_name || scene.name) lines.push({ key: t.sceneKey, value: display(scene.display_name || scene.name) });
    // Canonical NPC names may reveal a concealed identity; introductions belong to the Keeper.
    if (session) lines.push({ key: t.sessionKey, value: t.session(display(session.kind), session.round), live: true });
    if (view.pending_choice) lines.push({ key: "", value: t.awaitingChoice, live: true });
    if (minutes === undefined && !lines.length) return null;
    const span = minutes === undefined ? null : elapsed(minutes);
    return h(Section, { title: t.time },
      span ? h("div", { className: "coc-clock" }, t.elapsed(span.days, span.hours, span.minutes)) : null,
      lines.length
        ? h("div", { className: "coc-standing" }, lines.map((line, index) =>
            h("div", { className: "coc-standing-line", "data-live": line.live ? "1" : "0", key: index },
              h("span", { className: "coc-standing-key" }, line.key),
              h("span", { className: "coc-standing-val" }, line.value))))
        : null);
  }

  /** Found clues, plus what this scene still has on offer — the old panel's 线索 section. */
  function Clues(props) {
    const { view, t } = props;
    const clues = isRecord(view.clues) ? view.clues : {};
    const discovered = Array.isArray(clues.discovered) ? clues.discovered : [];
    const here = Array.isArray(clues.here) ? clues.here : [];
    // A clue the scene offers but nobody has found is the Keeper's business, not the player's:
    // only the ones already marked discovered are named.
    const foundHere = here.filter(clue => isRecord(clue) && clue.discovered === true);
    if (!discovered.length && !foundHere.length) {
      return h(Section, { title: t.clues }, h("p", { className: "coc-sheet-note" }, t.noClues));
    }
    const seen = new Set();
    const rows = [];
    for (const clue of [...foundHere, ...discovered]) {
      const line = clueLine(clue);
      const key = line.name || line.summary;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      rows.push(line);
    }
    return h(Section, { title: t.clues }, rows.map((row, index) =>
      row.summary
        // The name stays on the line; what the clue says is one tap away.
        ? h("details", { className: "coc-clue coc-clue-fold", key: `${row.name}:${index}` },
            h("summary", null, h("span", { className: "coc-clue-name" }, row.name)),
            h("div", { className: "coc-clue-body" }, row.summary))
        : h("div", { className: "coc-clue", key: `${row.name}:${index}` },
            h("span", { className: "coc-clue-name" }, row.name))));
  }

  /** @param {{api: {invoke?: Function, subscribeExt?: Function}}} props */
  return function InvestigatorPanel(props) {
    const api = props.api || {};
    const [answer, setAnswer] = useState(undefined);
    const generation = useRef(0);
    useEffect(() => () => { generation.current++; }, []);
    const [busy, setBusy] = useState(false);
    const [who, setWho] = useState(0);
    // The language of the last sheet that actually arrived, kept so the chrome of a failed read
    // stays in the language the player was just reading rather than snapping back to English.
    const [lastLanguage, setLastLanguage] = useState("");

    const load = useCallback(async (retryProjection = false) => {
      const request = ++generation.current;
      if (!api.invoke) {
        setAnswer({ view: null, campaign: null, reason: "this host cannot reach the pack" });
        return;
      }
      setBusy(true);
      try {
        const result = await api.invoke("sheet", retryProjection ? {retry_projection:true} : {});
        if(request !== generation.current) return;
        if (result && result.ok === true && isRecord(result.data)) {
          setAnswer(result.data);
          const language = isRecord(result.data.view) ? text(result.data.view.play_language) : "";
          if (language) setLastLanguage(language);
        }
        else {
          const error = result && result.error;
          setAnswer({ view: null, campaign: null, status: "error", reason: (error && error.message) || "the pack did not answer" });
        }
      } catch (error) {
        if(request !== generation.current) return;
        setAnswer({ view: null, campaign: null, status: "error", reason: error instanceof Error ? error.message : String(error) });
      } finally {
        if(request === generation.current) setBusy(false);
      }
    }, [api]);

    useEffect(() => { void load(); }, [load]);

    // The agent half pushes on every committed turn; any event from this pack means re-read.
    // The push carries no payload, so a shape change upstream can never desynchronise the panel.
    useEffect(() => {
      if (!api.subscribeExt) return undefined;
      const unsubscribe = api.subscribeExt(() => { void load(); });
      return typeof unsubscribe === "function" ? unsubscribe : undefined;
    }, [api, load]);

    if (answer === undefined) {
      return h("div", { className: "coc-sheet" },
        h("p", { className: "coc-sheet-note", role: "status" }, LABELS.en.loading));
    }

    const view = isRecord(answer.view) ? answer.view : null;
    // A failed read carries no language of its own. The last one this panel actually saw is the
    // table the player is sitting at, so the chrome of an error stays in the language the sheet
    // was in a moment ago instead of snapping back to English mid-session.
    const t = labelsFor(view ? text(view.play_language) : lastLanguage);
    const party = view && Array.isArray(view.investigators) ? view.investigators.filter(isRecord) : [];
    const sheet = party[Math.min(who, Math.max(0, party.length - 1))] || null;
    // The play language's word for a rules term, straight from the rules data (§16.5). No table here.
    const glossary = view && isRecord(view.labels) ? view.labels : {};
    const term = (name) => (typeof glossary[name] === "string" && glossary[name]) || name;

    const head = h("div", { className: "coc-sheet-head" },
      h("span", { className: "coc-sheet-name" }, sheet ? text(sheet.name) || text(sheet.id) : t.noInvestigator),
      h("button", { type: "button", className: "coc-sheet-refresh", onClick: () => { void load(true); }, disabled: busy },
        busy ? t.refreshing : t.refresh));

    if (!view) {
      // Three different "no sheet" states, and the player is owed which one it is: a session that
      // was never bound to a table, a read that failed, or a table that has no party yet. The
      // words come from the same `play_language` table as everything else on this panel (§16.1's
      // one exception) -- a literal here would be a fourth language rule nobody could see.
      const status = answer.status || (answer.reason ? "error" : "empty");
      const title = status === "unbound" ? t.unboundTitle : status === "error" ? t.errorTitle : t.noTableTitle;
      const detail = status === "unbound" ? t.unboundDetail
        : status === "error" ? (text(answer.reason) || t.errorDetail)
        : t.noTable;
      return h("div", { className: "coc-sheet", role: "region", "aria-label": props.title || "Investigator" },
        h("h2", null, title), h("p", { className: "coc-sheet-note", role: "status" }, detail),
        h("button", { type: "button", onClick: () => { void load(true); }, disabled: busy }, busy ? t.loading : t.retry));
    }

    // The header of a printed sheet: labelled rules, not a run-on line of values.
    const fields = [];
    if (sheet) {
      if (sheet.occupation) fields.push([t.occupation, term(text(sheet.occupation))]);
      if (sheet.era) fields.push([t.era, term(text(sheet.era))]);
      if (sheet.age !== undefined) fields.push([t.ageKey, text(sheet.age)]);
    }
    const concept = sheet && isRecord(sheet.backstory) ? term(text(sheet.backstory.concept)) : "";

    return h("div", { className: "coc-sheet", role: "region", "aria-label": props.title || "Investigator" },
      h("div", {className:"coc-sheet-identity"}, head,
      fields.length
        ? h("div", { className: "coc-sheet-fields" }, fields.flatMap(([key, value], index) => [
            h("span", { className: "coc-sheet-field-key", key: `k${index}` }, key),
            h("span", { className: "coc-sheet-field-val", key: `v${index}` }, h("span", null, value)),
          ]))
        : null,
      concept ? h("p", { className: "coc-sheet-concept" }, concept) : null),
      // More than one investigator at the table is legal (§5 `needs_choice`), so the panel picks.
      party.length > 1
        ? h("div", { className: "coc-who" }, party.map((member, index) =>
            h("button", {
              type: "button", key: text(member.id) || index, "data-on": index === who ? "1" : "0",
              "aria-pressed": index === who ? "true" : "false",
              onClick: () => setWho(index),
            }, text(member.name) || text(member.id))))
        : null,
      h(Standing, { view, t }),
      sheet ? h(Vitals, { sheet, t, term }) : null,
      sheet ? h(Characteristics, { sheet, t, term }) : null,
      sheet ? h(Skills, { sheet, t, term }) : null,
      sheet ? h(ItemSection, { title: t.weapons, list: sheet.weapons, objects:(sheet.objects || []).filter(item=>item.category==="weapon"), t, term }) : null,
      sheet && view.presentation_status ? h(Section,{title:t.equipment},
        h("p",{className:"coc-sheet-note",role:"status"},view.presentation_status==="failed"?t.errorDetail:t.loading),
        view.presentation_status==="failed"?h("button",{type:"button",onClick:()=>{void load(true);}},t.retry):null) :
      sheet ? h(ItemSection, { title: t.equipment, list: (sheet.equipment || []).filter(item => !view.finance_equipment?.includes(item)), objects:(sheet.objects || []).filter(item=>item.category!=="weapon"), empty: t.noEquipment, t, term }) : null,
      sheet ? h(Finance, { sheet, t, term }) : null,
      sheet ? h(Background, { sheet, term }) : null,

      h(Clues, { view, t }));
  };
}
