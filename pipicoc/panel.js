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
.coc-sheet{--coc-serif:ui-serif,"Songti SC","Noto Serif CJK SC","SimSun",Georgia,serif;
  display:flex;flex-direction:column;height:100%;min-height:0;overflow:auto;
  padding:14px 14px 24px;color:var(--text);font-size:12px;line-height:1.5}

/* Identity reads like the top of a printed sheet: a name, then filled-in rules. */
.coc-sheet-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}
.coc-sheet-name{font-family:var(--coc-serif);font-size:19px;line-height:1.2;font-weight:600;
  color:var(--text-strong);overflow-wrap:anywhere}
/* Every control here is text-only, so the focus ring is the only thing that says "you are on it".
   :focus-visible keeps it off mouse clicks and on for keyboard, which is the point. */
.coc-sheet :focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:2px}
.coc-sheet-refresh{flex:none;margin-top:2px;border:0;background:none;color:var(--subtle);
  padding:2px 0;font-size:11px;cursor:pointer;border-bottom:1px solid transparent}
.coc-sheet-refresh:hover{color:var(--accent);border-bottom-color:var(--accent)}
.coc-sheet-refresh:disabled{opacity:.5;cursor:default}
.coc-sheet-fields{margin:7px 0 0;display:grid;grid-template-columns:auto 1fr;gap:2px 8px;align-items:baseline}
.coc-sheet-field-key{color:var(--subtle);font-size:11px}
/* The ink sits on a short rule, the way a filled form looks — not a full-width underline. */
.coc-sheet-field-val{color:var(--text);overflow-wrap:anywhere}
.coc-sheet-field-val span{border-bottom:1px solid var(--border);padding-bottom:1px}
.coc-sheet-concept{margin:8px 0 0;color:var(--muted);line-height:1.6;font-family:var(--coc-serif);font-size:13px}
.coc-sheet-note{margin:12px 0;color:var(--muted);line-height:1.6}

.coc-sheet-section{margin:20px 0 0}
.coc-sheet-heading{display:flex;align-items:center;gap:8px;margin:0 0 8px;color:var(--muted);
  font-size:11px;font-weight:600}
.coc-sheet-heading::after{content:"";flex:1;height:1px;background:var(--border)}

/* Vitals sit together as one block, the way they do in the corner of a printed sheet — not as
   three full-width rules stacked down the column. Each keeps its own tone, so which one moved is
   legible before the label is read. */
.coc-vitals{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}
.coc-vital{--tone:var(--muted);min-width:0}
.coc-vital-key{display:block;color:var(--subtle);font-size:10px;line-height:1.2;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.coc-vital-num{font-family:var(--coc-serif);font-variant-numeric:tabular-nums;font-size:18px;
  line-height:1.15;font-weight:600;color:var(--text-strong)}
.coc-vital-max{color:var(--subtle);font-size:11px;font-variant-numeric:tabular-nums}
.coc-vital-track{margin-top:3px;height:3px;background:color-mix(in oklab, var(--border) 60%, transparent)}
.coc-vital-fill{height:100%;background:var(--tone)}

/* A printed sheet boxes the characteristics; nothing else on the page is boxed. */
/* Three across, always: the grouping is the printed sheet's, not a responsive convenience.
   minmax(0,1fr) plus the cell's own ellipsis is what keeps a long label from blowing the track.
   No backticks in here: this whole block is a JS template literal. */
.coc-chars{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px}
.coc-char{border:1px solid var(--border);padding:4px 6px 3px}
.coc-char-key{display:block;color:var(--subtle);font-size:10px;line-height:1.2;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.coc-char-val{display:block;margin-top:1px;font-family:var(--coc-serif);font-variant-numeric:tabular-nums;
  font-size:15px;line-height:1.1;font-weight:600;color:var(--text-strong)}

/* Ruled rows with a dot leader: how a sheet aligns a long name to a short number. */
.coc-list{display:flex;flex-direction:column;gap:2px}
.coc-line{display:flex;align-items:baseline;gap:5px}
.coc-line-key{flex:none;min-width:0;overflow-wrap:anywhere}
.coc-line-lead{flex:1;min-width:10px;height:0;border-bottom:1px dotted var(--border-strong);
  transform:translateY(-3px)}
.coc-line-gap{flex:1;min-width:10px}
.coc-line-val{flex:none;font-family:var(--coc-serif);font-variant-numeric:tabular-nums;
  font-weight:600;color:var(--text-strong)}
.coc-line-note{flex:none;color:var(--muted);font-size:11px}
.coc-more{margin-top:8px;border:0;background:none;color:var(--accent);font-size:11px;cursor:pointer;
  padding:0;border-bottom:1px solid transparent}
.coc-more:hover{border-bottom-color:var(--accent)}

/* Where and when: the clock is the one number on this page that gets to be large. */
.coc-clock{font-family:var(--coc-serif);font-variant-numeric:tabular-nums;font-size:16px;
  line-height:1.2;color:var(--text-strong)}
.coc-standing{margin-top:6px;display:flex;flex-direction:column;gap:2px}
.coc-standing-line{display:flex;gap:6px;align-items:baseline}
.coc-standing-key{flex:none;width:3.2em;color:var(--subtle);font-size:11px;white-space:nowrap}
.coc-standing-val{min-width:0;overflow-wrap:anywhere}
.coc-standing-line[data-live="1"] .coc-standing-val{color:var(--accent);font-weight:600}

.coc-clue{padding:6px 0;border-top:1px solid var(--border);line-height:1.6}
.coc-clue:first-child{border-top:0}
.coc-clue-name{color:var(--text-strong);font-weight:600}
.coc-clue-sum{color:var(--muted)}

.coc-who{display:flex;flex-wrap:wrap;gap:10px;margin:10px 0 0}
.coc-who button{border:0;background:none;color:var(--muted);padding:0 0 2px;font-size:12px;
  cursor:pointer;border-bottom:1px solid transparent}
.coc-who button[data-on="1"]{color:var(--text-strong);border-bottom-color:var(--accent)}
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
    equipment: "Equipment",
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
    equipment: "物品",
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

function labelsFor(language) {
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
 * One equipment or weapon line. The kernel's own words; the panel only picks which key is the
 * title and which is the aside, and never invents a label for something that has none.
 */
function itemLine(item) {
  if (!isRecord(item)) return { title: text(item), note: "" };
  const title = text(item.label || item.name || item.id);
  const notes = [];
  const quantity = numberOr(item.quantity, 1);
  if (quantity > 1) notes.push(`x${quantity}`);
  for (const key of ["damage", "range", "attacks", "ammo", "malfunction", "skill"]) {
    if (item[key] !== undefined && item[key] !== null && item[key] !== "") notes.push(`${key} ${text(item[key])}`);
  }
  return { title, note: notes.join(" · ") };
}

function money(value) {
  if (!isRecord(value)) return text(value);
  const amount = value.amount;
  const currency = text(value.currency);
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
   * A name and its value. The dot leader is only for lists long enough that the eye loses the
   * line — the skills. On five rows of finance it would be decoration, so it is off by default.
   */
  function Lines(props) {
    return h("div", { className: "coc-list" }, props.rows.map((row, index) =>
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
    const { sheet, t } = props;
    const derived = isRecord(sheet.derived) ? sheet.derived : {};
    const items = [];
    for (const [label, currentKey, maxKey] of [["HP", "hp", "HP"], ["SAN", "san", "SAN"], ["MP", "mp", "MP"]]) {
      const current = numberOr(sheet[currentKey], undefined);
      if (current === undefined) continue;
      // A maximum the kernel did not give is not one the panel may invent: the bar just goes away.
      items.push(h(Vital, { key: label, label, tone: VITAL_TONE[label], current, max: numberOr(derived[maxKey], undefined) }));
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
          h("span", { className: "coc-char-val" }, text(value))))));
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

  function ItemSection(props) {
    const list = Array.isArray(props.list) ? props.list : [];
    if (!list.length) return null;
    return h(Section, { title: props.title },
      h(Lines, { rows: list.map(item => { const line = itemLine(item); return { name: line.title, value: line.note }; }) }));
  }

  function Finance(props) {
    const { sheet, t } = props;
    const finance = isRecord(sheet.finance) ? sheet.finance : {};
    const rows = [];
    if (sheet.cash !== undefined || finance.cash !== undefined) {
      rows.push({ name: t.cash, value: text(sheet.cash) || money(finance.cash), numeric: true });
    }
    if (finance.assets !== undefined) rows.push({ name: t.assets, value: money(finance.assets), numeric: true });
    if (finance.spending_level !== undefined) {
      rows.push({ name: t.spending, value: money(finance.spending_level), numeric: true });
    }
    const creditRating = sheet.credit_rating !== undefined ? sheet.credit_rating : finance.credit_rating;
    if (creditRating !== undefined) rows.push({ name: t.creditRating, value: text(creditRating), numeric: true });
    if (finance.living_standard !== undefined) rows.push({ name: t.livingStandard, value: text(finance.living_standard) });
    return rows.length ? h(Section, { title: t.finance }, h(Lines, { rows })) : null;
  }

  /** Where and when the table stands: the old panel's 时间 tab, minus the invented wall clock. */
  function Standing(props) {
    const { view, t } = props;
    const clock = isRecord(view.clock) ? view.clock : {};
    const minutes = numberOr(clock.minutes, undefined);
    const scene = isRecord(view.scene) ? view.scene : {};
    const present = Array.isArray(view.present) ? view.present : [];
    const session = isRecord(view.session) ? view.session : null;
    const lines = [];
    if (view.turn !== undefined && view.turn !== null) lines.push({ key: t.turnKey, value: text(view.turn) });
    if (scene.display_name || scene.name) lines.push({ key: t.sceneKey, value: text(scene.display_name || scene.name) });
    if (present.length) lines.push({ key: t.presentKey, value: present.map(text).join("、") });
    if (session) lines.push({ key: t.sessionKey, value: t.session(text(session.kind), session.round), live: true });
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
      h("div", { className: "coc-clue", key: `${row.name}:${index}` },
        h("span", { className: "coc-clue-name" }, row.name),
        row.summary ? h("span", { className: "coc-clue-sum" }, ` ${row.summary}`) : null)));
  }

  /** @param {{api: {invoke?: Function, subscribeExt?: Function}}} props */
  return function InvestigatorPanel(props) {
    const api = props.api || {};
    const [answer, setAnswer] = useState(undefined);
    const generation = useRef(0);
    useEffect(() => () => { generation.current++; }, []);
    const [busy, setBusy] = useState(false);
    const [who, setWho] = useState(0);

    const load = useCallback(async () => {
      const request = ++generation.current;
      if (!api.invoke) {
        setAnswer({ view: null, campaign: null, reason: "this host cannot reach the pack" });
        return;
      }
      setBusy(true);
      try {
        const result = await api.invoke("sheet", {});
        if(request !== generation.current) return;
        if (result && result.ok === true && isRecord(result.data)) setAnswer(result.data);
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
    const t = labelsFor(view ? text(view.play_language) : "");
    const party = view && Array.isArray(view.investigators) ? view.investigators.filter(isRecord) : [];
    const sheet = party[Math.min(who, Math.max(0, party.length - 1))] || null;
    // The play language's word for a rules term, straight from the rules data (§16.5). No table here.
    const glossary = view && isRecord(view.labels) ? view.labels : {};
    const term = (name) => (typeof glossary[name] === "string" && glossary[name]) || name;

    const head = h("div", { className: "coc-sheet-head" },
      h("span", { className: "coc-sheet-name" }, sheet ? text(sheet.name) || text(sheet.id) : t.noInvestigator),
      h("button", { type: "button", className: "coc-sheet-refresh", onClick: () => { void load(); }, disabled: busy },
        busy ? t.refreshing : t.refresh));

    if (!view) {
      const status = answer.status || (answer.reason ? 'error' : 'empty');
      const title = status === 'unbound' ? '尚未关联战役' : status === 'error' ? '人物数据读取失败' : '尚未开桌';
      const detail = status === 'unbound' ? '此会话没有战役关联，不能自动猜测其他战役。' : status === 'error' ? (answer.reason || '请重试。') : '建卡完成后显示调查员。';
      return h("div", { className: "coc-sheet", role: "region", "aria-label": props.title || "Investigator" },
        h("h2", null, title), h("p", { className: "coc-sheet-note", role: "status" }, detail),
        h("button", {onClick:()=>void load(),disabled:busy},busy?"读取中…":"重试"));
    }

    // The header of a printed sheet: labelled rules, not a run-on line of values.
    const fields = [];
    if (sheet) {
      if (sheet.occupation) fields.push([t.occupation, text(sheet.occupation)]);
      if (sheet.era) fields.push([t.era, text(sheet.era)]);
      if (sheet.age !== undefined) fields.push([t.ageKey, text(sheet.age)]);
    }
    const concept = sheet && isRecord(sheet.backstory) ? text(sheet.backstory.concept) : "";

    return h("div", { className: "coc-sheet", role: "region", "aria-label": props.title || "Investigator" },
      head,
      fields.length
        ? h("div", { className: "coc-sheet-fields" }, fields.flatMap(([key, value], index) => [
            h("span", { className: "coc-sheet-field-key", key: `k${index}` }, key),
            h("span", { className: "coc-sheet-field-val", key: `v${index}` }, h("span", null, value)),
          ]))
        : null,
      concept ? h("p", { className: "coc-sheet-concept" }, concept) : null,
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
      sheet ? h(Vitals, { sheet, t }) : null,
      sheet ? h(Characteristics, { sheet, t, term }) : null,
      sheet ? h(Skills, { sheet, t, term }) : null,
      sheet ? h(ItemSection, { title: t.weapons, list: sheet.weapons }) : null,
      sheet ? h(ItemSection, { title: t.equipment, list: sheet.equipment }) : null,
      sheet ? h(Finance, { sheet, t }) : null,
      h(Clues, { view, t }));
  };
}
