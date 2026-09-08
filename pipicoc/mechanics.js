/**
 * The delivery card: the Keeper's prose plus this turn's mechanics (contract §22.9).
 *
 * In PipiCOC the story does not arrive in an assistant message — it arrives as the result of the
 * `narrate` / `ask` tool (§5). So this tool renderer *is* the reading surface, and it is where the
 * old tree put its effect cards too (`web/frontend/src/components/Panel.tsx`'s roll groups,
 * `mechanic-effects.ts`): next to the words that describe them.
 *
 * The wiring needed no new channel. The kernel's result already carries `rendered_text` and
 * `mechanics` (§16.2), and the extension already hands the whole result over as the tool's
 * `details`. A renderer only gets `{content, details, images}` — no host API — so `play_language`
 * and the rules glossary ride with the delivery as well (§22.7).
 *
 * TWO RULES THIS FILE MUST NOT BREAK:
 *
 * 1. **Keeper-visibility rolls are hidden.** §16.5: a consumer that renders for the player must
 *    hide `visibility: "keeper"`. A secret Spot Hidden the player was never told about must not
 *    appear here, or the panel leaks what the prose withheld.
 * 2. **Nothing is computed.** Every number is printed as the receipt carries it. The one
 *    exception is a delta's sign, which is subtraction of two numbers the kernel already gave.
 *
 * The visual system: one turn's mechanics arrive together, so they sit on one bordered slip
 * under a small caption. Each row leads with its kind's glyph on a disc; colour is earned, never
 * decoration — the outcome stamp, the delta badge's direction, the grade of a roll, and the
 * family tone of a settlement group (§16.2's `call`/`family`). Rows that settled nothing stay
 * loose between the groups.
 *
 * Same shape as `panel.js`: plain ESM, no imports (the renderer has no import map), and a label
 * table keyed by `play_language` — §16.1's one exception, restated per file because a pack entry
 * cannot import a sibling.
 */

const STYLE_ID = "pipicoc-mechanics-style";
const CSS = `
.coc-mech{--coc-serif:ui-serif,"Songti SC","Noto Serif CJK SC","SimSun",Georgia,serif}

/* The prose is the hero and it is fiction, so it gets the reading face and reading measure.
   Everything below it is machinery and stays in the interface face. */
.coc-mech-prose{font-family:var(--coc-serif);font-size:14.5px;line-height:1.75;max-width:64ch;
  white-space:pre-wrap;color:var(--text)}

/* A marked delivery (§16.6): the narration reads straight down and a receipt sits at the point
   the keeper put it, inset just enough to read as an aside rather than as a paragraph. */
.coc-mech-inline{max-width:64ch}
.coc-mech-para{font-family:var(--coc-serif);font-size:14.5px;line-height:1.75;color:var(--text);
  margin:0 0 0.9em}
.coc-mech-here{margin:0.35em 0 1em;padding-left:10px;border-left:2px solid var(--border-strong)}
.coc-mech-here .coc-mech-row{border-top:0;padding:5px 0}
.coc-mech-inline .coc-mech-list{margin-top:18px}

/* The settlement slip. One turn's mechanics are one event, so they sit inside one bordered
   sheet with a small caption — not a ruled ledger fading into the prose. */
.coc-mech-list{margin-top:14px;max-width:64ch;border:1px solid var(--border);border-radius:10px;
  padding:9px 12px 6px;background:color-mix(in oklab, var(--border) 12%, transparent)}
.coc-mech-cap{margin:0;padding:0 2px 6px;color:var(--subtle);font-size:10.5px;font-weight:650;
  letter-spacing:.09em;text-transform:uppercase}

/* One row, one receipt: the kind's glyph on a disc, the entry, and what came of it at the
   margin. The disc is what tells a cash row from a time row before a word is read. */
.coc-mech-row{display:flex;align-items:center;gap:10px;padding:6px 2px;
  border-top:1px solid color-mix(in oklab, var(--border) 60%, transparent);
  font-size:12.5px;line-height:1.5}
.coc-mech-cap + .coc-mech-row,.coc-mech-fam + .coc-mech-row{border-top:0}
.coc-mech-ico{flex:none;width:24px;height:24px;border-radius:8px;display:grid;place-items:center;
  color:var(--muted);background:color-mix(in oklab, var(--muted) 12%, transparent)}
.coc-mech-ico>svg{width:13.5px;height:13.5px;display:block}
.coc-mech-row[data-kind="roll"] .coc-mech-ico,.coc-mech-row[data-kind="dice"] .coc-mech-ico,
.coc-mech-row[data-kind="session"] .coc-mech-ico,.coc-mech-row[data-kind="worldline"] .coc-mech-ico{
  color:var(--accent);background:color-mix(in oklab, var(--accent) 13%, transparent)}
/* A loose row that settled something wears its family's tone on the disc — after the kind
   rules above, because the family is the stronger claim (a combat bout's start reads danger). */
.coc-mech-row[data-family] .coc-mech-ico{color:var(--fam, var(--muted));
  background:color-mix(in oklab, var(--fam, var(--muted)) 13%, transparent)}
.coc-mech-body{flex:1;min-width:0;overflow-wrap:anywhere;color:var(--text)}
.coc-mech-who{color:var(--muted)}
.coc-mech-skill{font-weight:550}
.coc-mech-res{font-size:11px;font-weight:650;letter-spacing:.04em;color:var(--muted)}

/* The figure is the number that moved, set in the reading face, sized to be scanned first. */
.coc-mech-figure{flex:none;display:flex;align-items:baseline;gap:3px;white-space:nowrap}
.coc-mech-num{font-family:var(--coc-serif);font-variant-numeric:tabular-nums;font-weight:650;
  font-size:16px;color:var(--text-strong)}
.coc-mech-target{color:var(--muted);font-size:11px}
.coc-mech-from{color:var(--muted)}
.coc-mech-faces{color:var(--subtle);font-size:11px;font-variant-numeric:tabular-nums;white-space:nowrap}

/* The stamp: how it went, as a seal. Colour here is earned by the outcome. */
.coc-mech-stamp{flex:none;font-size:10.5px;font-weight:650;letter-spacing:.03em;padding:1px 8px;
  border-radius:999px;border:1px solid transparent;white-space:nowrap}
.coc-mech-stamp[data-tone="pass"]{color:var(--success);
  border-color:color-mix(in oklab, var(--success) 45%, transparent);
  background:color-mix(in oklab, var(--success) 10%, transparent)}
.coc-mech-stamp[data-tone="fail"]{color:var(--danger);
  border-color:color-mix(in oklab, var(--danger) 45%, transparent);
  background:color-mix(in oklab, var(--danger) 9%, transparent)}
.coc-mech-stamp[data-tone="plain"]{color:var(--muted);border-color:var(--border);background:transparent}

/* The delta badge: +2 gained, −3 lost. The direction is the colour. */
.coc-mech-delta{flex:none;font-size:11px;font-weight:650;font-variant-numeric:tabular-nums;
  padding:1px 7px;border-radius:6px;white-space:nowrap}
.coc-mech-delta[data-down="0"]{color:var(--success);
  background:color-mix(in oklab, var(--success) 12%, transparent)}
.coc-mech-delta[data-down="1"]{color:var(--danger);
  background:color-mix(in oklab, var(--danger) 12%, transparent)}

/* Emphasis follows the success level the kernel graded — it is not decoration, it is the grade. */
.coc-mech-lv{font-size:10.5px;font-weight:650;padding:1px 6px;border-radius:5px;white-space:nowrap;
  color:var(--muted);background:color-mix(in oklab, var(--muted) 14%, transparent)}
.coc-mech-row[data-grade="extreme"] .coc-mech-num,
.coc-mech-row[data-grade="critical"] .coc-mech-num{font-size:19px;color:var(--accent)}
.coc-mech-row[data-grade="extreme"] .coc-mech-lv,
.coc-mech-row[data-grade="critical"] .coc-mech-lv{color:var(--accent);
  background:color-mix(in oklab, var(--accent) 14%, transparent)}
.coc-mech-row[data-grade="fumble"] .coc-mech-num{font-size:19px;color:var(--danger)}
.coc-mech-row[data-grade="fumble"] .coc-mech-lv{color:var(--danger);
  background:color-mix(in oklab, var(--danger) 12%, transparent)}

/* One settlement, one group. A resolve's rows arrive sharing call and family (§16.2); the
   group's rail carries the family's tone, so a sanity check and a brawl are told apart before a
   word is read, and every disc inside takes the tone. Apply's bookkeeping rows settled no rule,
   carry no family, and stay loose — a clue and a scene move were not part of anyone's dice. */
.coc-mech-settle{--tone:var(--muted);margin:7px 0;padding:4px 10px 3px;border-radius:9px;
  border:1px solid color-mix(in oklab, var(--tone) 30%, transparent);
  border-left:3px solid var(--tone);
  background:color-mix(in oklab, var(--tone) 5%, transparent)}
.coc-mech-fam{display:flex;align-items:center;gap:6px;padding:2px 0;color:var(--tone);
  font-size:10.5px;font-weight:700;letter-spacing:.06em}
.coc-mech-settle .coc-mech-row{border-top-color:color-mix(in oklab, var(--tone) 22%, transparent);
  padding:5px 0}
.coc-mech-settle .coc-mech-ico{color:var(--tone);
  background:color-mix(in oklab, var(--tone) 13%, transparent)}

/* The table changed history — the largest thing a row can say, so even standing alone it gets
   the accent rail a settlement group would. */
.coc-mech-row[data-kind="worldline"]{margin:7px 0;padding:6px 10px;border-radius:9px;
  border:1px solid color-mix(in oklab, var(--accent) 35%, transparent);
  border-left:3px solid var(--accent);
  background:color-mix(in oklab, var(--accent) 6%, transparent)}
`;

if (typeof document !== "undefined" && !document.getElementById(STYLE_ID)) {
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.append(style);
}

/** Chrome per `play_language` (§14.4's closed set); `en` is also the fallback. */
const LABELS = {
  en: {
    mechanics: "Mechanics",
    kind: { roll: "roll", dice: "dice", change: "res", scene: "move", clue: "clue", time: "time",
            item: "item", cash: "cash", session: "phase", worldline: "line", choice: "pick", handout: "sheet" },
    pass: "pass",
    fail: "fail",
    // The kernel's six success levels (kernel/coc/rules/resolver.py's levels). regular and failure
    // are absent on purpose: they say what the stamp already says, and writing them only thins it.
    level: { hard: "hard", extreme: "extreme", critical: "critical", fumble: "fumble" },
    pushed: "pushed",
    minutes: (n) => `${n} min`,
    arrow: "→",
    to: "to",
    removedFrom: (name) => `removed from ${name}'s inventory`,
    available: "available",
    pending: "not delivered",
    round: (n) => `round ${n}`,
    family: {
      "core-check": "skill check", sanity: "sanity", combat: "combat", chase: "chase", social: "social",
      psychology: "read", magic: "magic", healing: "healing", development: "growth", "push-luck": "push",
      chapter: "chapter", campaign: "campaign",
    },
    opposed: "opposed",
    session: { start: "begins", end: "ends" },
    // §15.3's three operations and fork's two modes are closed sets (kernel/coc/worldline.py's
    // OPERATIONS / MODES). The table changed history: the largest thing a row can say.
    worldline: { fork: "forked", "fork:loop": "rewound", switch: "resumed", merge: "merged into" },
    loop: (n) => `circuit ${n}`,
    turn: (n) => `turn ${n}`,
  },
  "zh-Hans": {
    mechanics: "本回合机制",
    kind: { roll: "检定", dice: "掷骰", change: "变化", scene: "移动", clue: "线索", time: "时间",
            item: "物品", cash: "现金", session: "进程", worldline: "世界线", choice: "选择", handout: "手卡" },
    pass: "通过",
    fail: "失败",
    level: { hard: "困难", extreme: "极难", critical: "大成功", fumble: "大失败" },
    pushed: "孤注一掷",
    minutes: (n) => `${n} 分钟`,
    arrow: "→",
    to: "给",
    removedFrom: (name) => `从${name}的物品中移除`,
    available: "可取",
    pending: "尚未交付",
    round: (n) => `第 ${n} 轮`,
    family: {
      "core-check": "技能检定", sanity: "理智", combat: "战斗", chase: "追逐", social: "交涉",
      psychology: "察言", magic: "法术", healing: "医疗", development: "成长", "push-luck": "孤注",
      chapter: "章节", campaign: "战役",
    },
    opposed: "对抗",
    session: { start: "开始", end: "结束" },
    worldline: { fork: "岔出", "fork:loop": "重来", switch: "切回", merge: "并入" },
    loop: (n) => `第 ${n} 圈`,
    turn: (n) => `第 ${n} 回合`,
  },
};

function labelsFor(language) {
  return LABELS[language] || LABELS.en;
}

/**
 * A family's tone, from the host palette only. Sanity takes the accent because in this game
 * losing your mind is the story; the violent families take the danger tone; the rest stay quiet.
 * A family with no entry here simply reads muted — a new family must never render blank.
 */
const FAMILY_TONE = {
  sanity: "var(--accent)",
  combat: "var(--danger)",
  chase: "var(--danger)",
  magic: "var(--accent)",
  healing: "var(--success)",
  development: "var(--success)",
  "push-luck": "var(--warning)",
};

/**
 * One glyph per kind, drawn inline on a 24-point stroke grid: the pack has no import map, so no
 * icon library. The disc is the row's identity; shape carries it, so the glyphs stay one colour
 * and the stamps, badges and rails carry the meaning.
 */
const ICONS = {
  roll: [["rect", { x: 3, y: 3, width: 18, height: 18, rx: 4 }],
         ["circle", { cx: 8.2, cy: 8.2, r: 0.4, fill: "currentColor", stroke: "none" }],
         ["circle", { cx: 15.8, cy: 8.2, r: 0.4, fill: "currentColor", stroke: "none" }],
         ["circle", { cx: 12, cy: 12, r: 0.4, fill: "currentColor", stroke: "none" }],
         ["circle", { cx: 8.2, cy: 15.8, r: 0.4, fill: "currentColor", stroke: "none" }],
         ["circle", { cx: 15.8, cy: 15.8, r: 0.4, fill: "currentColor", stroke: "none" }]],
  dice: [["rect", { x: 2.5, y: 9, width: 12, height: 12, rx: 3 }],
         ["path", { d: "M9 9V6a2.5 2.5 0 0 1 2.5-2.5h7A2.5 2.5 0 0 1 21 6v7a2.5 2.5 0 0 1-2.5 2.5H16" }],
         ["circle", { cx: 6.5, cy: 13, r: 0.4, fill: "currentColor", stroke: "none" }],
         ["circle", { cx: 10.5, cy: 17, r: 0.4, fill: "currentColor", stroke: "none" }]],
  change: [["polyline", { points: "3 12 7.5 12 10.5 5.5 13.5 18.5 16.5 12 21 12" }]],
  scene: [["path", { d: "M12 21s-6.5-5.2-6.5-10.5a6.5 6.5 0 0 1 13 0C18.5 15.8 12 21 12 21z" }],
          ["circle", { cx: 12, cy: 10.5, r: 2.3 }]],
  clue: [["circle", { cx: 11, cy: 11, r: 6.5 }], ["line", { x1: 16.2, y1: 16.2, x2: 20.5, y2: 20.5 }]],
  time: [["circle", { cx: 12, cy: 12, r: 8.5 }], ["polyline", { points: "12 7 12 12 15.5 14" }]],
  item: [["path", { d: "M3.5 8 12 3.5 20.5 8v8L12 20.5 3.5 16z" }],
         ["polyline", { points: "3.5 8 12 12.5 20.5 8" }], ["line", { x1: 12, y1: 12.5, x2: 12, y2: 20.5 }]],
  cash: [["rect", { x: 2.5, y: 6.5, width: 19, height: 11, rx: 2 }],
         ["circle", { cx: 12, cy: 12, r: 2.4 }],
         ["line", { x1: 6, y1: 12, x2: 6.01, y2: 12 }], ["line", { x1: 18, y1: 12, x2: 18.01, y2: 12 }]],
  session: [["path", { d: "M5 21V4" }], ["path", { d: "M5 4.5h12.5l-2.3 3.75 2.3 3.75H5" }]],
  worldline: [["circle", { cx: 6, cy: 6, r: 2.2 }], ["circle", { cx: 6, cy: 18, r: 2.2 }],
              ["circle", { cx: 18, cy: 8, r: 2.2 }], ["path", { d: "M6 8.2v7.6" }],
              ["path", { d: "M18 10.2c0 4.2-6.2 3.6-9.6 6" }]],
  choice: [["line", { x1: 9.5, y1: 6, x2: 20, y2: 6 }], ["line", { x1: 9.5, y1: 12, x2: 20, y2: 12 }],
           ["line", { x1: 9.5, y1: 18, x2: 20, y2: 18 }], ["polyline", { points: "3.5 6 4.8 7.3 7.5 4.3" }],
           ["polyline", { points: "3.5 12 4.8 13.3 7.5 10.3" }], ["polyline", { points: "3.5 18 4.8 19.3 7.5 16.3" }]],
  handout: [["path", { d: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" }],
            ["polyline", { points: "14 3 14 8 19 8" }], ["line", { x1: 8.5, y1: 13, x2: 15.5, y2: 13 }],
            ["line", { x1: 8.5, y1: 17, x2: 13.5, y2: 17 }]],
  fallback: [["circle", { cx: 12, cy: 12, r: 8.5 }]],
};

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value) {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : String(value);
}

function num(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * §16.5: keeper-visibility rolls are projected so a log can keep them, and a surface that renders
 * for the player must hide them. This panel is the player's.
 */
function playerVisible(row) {
  return isRecord(row) && row.visibility !== "keeper";
}

/**
 * One settlement, one group.
 *
 * The seam is the kernel's, not ours: a row says which call minted it (`call`) and what rule
 * family that call settled (`family`) — §16.2. `apply` is a call too, so its bookkeeping rows
 * carry a call as well, but they settled no rule, so they have no family, and they stay loose.
 * That is the right reading of them: a clue and a scene move were not part of anyone's dice.
 *
 * Nothing is inferred here. Merging rows that merely *look* related would be guessing at
 * semantics the settlement already decided, and a wrong guess tells the player a wrong story
 * about their own dice.
 */
function groupRows(rows) {
  const groups = [];
  for (const row of rows) {
    const family = text(row.family);
    const call = family && typeof row.call === "string" && row.call ? row.call : "";
    const last = groups[groups.length - 1];
    if (call && last && last.call === call) last.rows.push(row);
    else groups.push({ call, family, rows: [row] });
  }
  return groups;
}

/** The family's word, plus "opposed" when the settlement rolled two sides against each other. */
function familyLabel(group, t) {
  const name = (t.family && t.family[group.family]) || group.family || "";
  const sides = group.rows.filter(row => row.kind === "roll").length;
  return sides > 1 ? `${name} · ${t.opposed}` : name;
}

export function createComponent(React) {
  const h = React.createElement;

  /** The kind's glyph on its disc. */
  function icon(kindKey) {
    const shapes = ICONS[kindKey] || ICONS.fallback;
    return h("svg", { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "2",
                      "stroke-linecap": "round", "stroke-linejoin": "round", focusable: "false" },
      shapes.map(([tag, attrs], i) => h(tag, { key: i, ...attrs })));
  }

  function Row(props) {
    const { children, kindKey, kindLabel, grade, family } = props;
    const tone = family && FAMILY_TONE[family];
    return h("div", {
      className: "coc-mech-row",
      "data-kind": kindKey,
      title: kindLabel,
      ...(family ? { "data-family": family } : {}),
      ...(grade ? { "data-grade": grade } : {}),
    },
      h("span", { className: "coc-mech-ico", "aria-hidden": "true",
        ...(tone ? { style: { "--fam": tone } } : {}) }, icon(kindKey)),
      ...(Array.isArray(children) ? children : [children]));
  }

  /** The value with its own emphasis; kept a component so every number looks the same. */
  function N(props) {
    return h("span", { className: "coc-mech-num" }, text(props.children));
  }

  /** How the row came out, as a seal at the margin. */
  function Stamp(props) {
    return h("span", { className: "coc-mech-stamp", "data-tone": props.tone || "plain" }, props.children);
  }

  /** +2 gained, −3 lost: the badge's colour IS the direction, so a zero says nothing and hides. */
  function Delta(props) {
    const delta = num(props.value);
    if (delta === undefined || delta === 0) return null;
    return h("span", { className: "coc-mech-delta", "data-down": delta < 0 ? "1" : "0" },
      `${delta > 0 ? "+" : ""}${delta}`);
  }

  function renderRow(row, t, term, index) {
    const kindLabel = t.kind[row.kind] || row.kind;
    const key = `${text(row.receipt)}:${index}`;
    const family = text(row.family) || undefined;
    switch (row.kind) {
      case "roll": {
        const who = row.actor_is_investigator === true ? text(row.actor_label || row.actor) : "";
        const skill = term(text(row.skill));
        const level = text(row.level);
        // The grade the kernel already assigned. Emphasis follows it — an extreme success and a
        // fumble are the two things a table talks about afterwards, so they get the weight.
        const grade = row.passed ? (level === "extreme" || level === "critical" ? level : "") : (level === "fumble" ? "fumble" : "");
        return h(Row, { key, kindKey: "roll", kindLabel, grade, family },
          h("span", { className: "coc-mech-body" },
            who ? h("span", { className: "coc-mech-who" }, `${who} `) : null,
            h("span", { className: "coc-mech-skill" }, skill)),
          h("span", { className: "coc-mech-figure" },
            h(N, null, text(row.roll)),
            h("span", { className: "coc-mech-target" }, `/${text(row.target)}`)),
          t.level[level] ? h("span", { className: "coc-mech-lv" }, t.level[level]) : null,
          row.pushed ? h("span", { className: "coc-mech-faces" }, t.pushed) : null,
          h(Stamp, { tone: row.passed ? "pass" : "fail" }, row.passed ? t.pass : t.fail));
      }
      case "dice": {
        const who = row.actor_is_investigator === true ? text(row.actor_label || row.actor) : "";
        // Faces are drawn only when they say more than the total: a 1D6 that rolled 5 written
        // as "5 [5]" says the same number twice.
        const rolled = Array.isArray(row.faces) ? row.faces : [];
        const faces = rolled.length && !(rolled.length === 1 && rolled[0] === row.total)
          ? `[${rolled.join(" ")}]` : "";
        return h(Row, { key, kindKey: "dice", kindLabel, family },
          h("span", { className: "coc-mech-body" },
            who ? h("span", { className: "coc-mech-who" }, `${who} `) : null,
            text(row.label || row.expression)),
          faces ? h("span", { className: "coc-mech-faces" }, faces) : null,
          h("span", { className: "coc-mech-figure" }, h(N, null, text(row.total))));
      }
      case "change": {
        const before = num(row.before);
        const after = num(row.after);
        // The only arithmetic here, and it is subtraction of two numbers the kernel handed over.
        const delta = before !== undefined && after !== undefined ? after - before : undefined;
        return h(Row, { key, kindKey: "change", kindLabel, family },
          h("span", { className: "coc-mech-body" },
            row.subject_is_investigator === true
              ? h("span", { className: "coc-mech-who" }, `${text(row.subject_label || row.subject)} `) : "",
            h("span", { className: "coc-mech-res" }, text(row.resource).toUpperCase())),
          h("span", { className: "coc-mech-figure" },
            h("span", { className: "coc-mech-from" }, text(row.before)),
            ` ${t.arrow} `,
            h(N, null, text(row.after))),
          h(Delta, { value: delta }));
      }
      case "scene":
        return h(Row, { key, kindKey: "scene", kindLabel, family },
          h("span", { className: "coc-mech-body" },
            text(row.from_label || row.from), ` ${t.arrow} `, text(row.to_label || row.to)),
          num(row.minutes) ? h("span", { className: "coc-mech-faces" }, t.minutes(row.minutes)) : null);
      case "clue":
        return h(Row, { key, kindKey: "clue", kindLabel, family },
          h("span", { className: "coc-mech-body" }, text(row.label || row.clue)));
      case "time":
        return h(Row, { key, kindKey: "time", kindLabel, family },
          h("span", { className: "coc-mech-body" }),
          h("span", { className: "coc-mech-figure" }, h(N, null, t.minutes(text(row.minutes)))));
      case "item": {
        const quantity = num(row.quantity);
        const amount = quantity === undefined ? undefined : Math.abs(quantity);
        const owner = text(row.to_label || row.to);
        const lost = quantity !== undefined && quantity < 0;
        return h(Row, { key, kindKey: "item", kindLabel, family },
          h("span", { className: "coc-mech-body" },
            text(row.label || row.name), amount && amount > 1 ? ` ×${amount}` : "", owner ? " " : ""),
          owner ? h("span", { className: "coc-mech-delta", "data-down": lost ? "1" : "0" },
            lost ? t.removedFrom(owner) : `${t.to} ${owner}`) : null);
      }
      case "cash": {
        const before = num(row.before);
        const after = num(row.after);
        const delta = before !== undefined && after !== undefined ? after - before : undefined;
        return h(Row, { key, kindKey: "cash", kindLabel, family },
          h("span", { className: "coc-mech-body" }, text(row.subject_label || row.subject)),
          h("span", { className: "coc-mech-figure" },
            h("span", { className: "coc-mech-from" }, text(row.before)),
            ` ${t.arrow} `,
            h(N, null, text(row.after)),
            h("span", { className: "coc-mech-faces" }, text(row.currency))),
          h(Delta, { value: delta }));
      }
      case "session":
        return h(Row, { key, kindKey: "session", kindLabel, family },
          h("span", { className: "coc-mech-body" },
            h("span", { className: "coc-mech-skill" }, t.family[row.family] || text(row.family)), " ",
            (t.session[row.transition] || text(row.transition)),
            num(row.round) ? ` · ${t.round(row.round)}` : "",
            num(row.rounds) ? ` · ${t.round(row.rounds)}` : ""),
          text(row.outcome) ? h(Stamp, { tone: "plain" }, text(row.outcome)) : null);
      case "choice":
        return h(Row, { key, kindKey: "choice", kindLabel, family },
          h("span", { className: "coc-mech-body" }, text(row.option)));
      case "worldline": {
        // A fork/switch/merge: which line the table moved to, and whether this circuit again.
        // Fork has two modes (if forks away, loop rewinds to the anchor), so the key carries mode.
        const operation = text(row.operation);
        const how = t.worldline[`${operation}:${text(row.mode)}`] || t.worldline[operation] || operation;
        const from = text(row.from_line);
        return h(Row, { key, kindKey: "worldline", kindLabel, family },
          h("span", { className: "coc-mech-body" },
            h("span", { className: "coc-mech-skill" }, how), " ",
            h("span", { className: "coc-mech-who" }, text(row.label || row.line))),
          h("span", { className: "coc-mech-faces" },
            from ? `${t.arrow === "→" ? "←" : "<-"} ${from}` : "",
            num(row.from_turn) ? ` · ${t.turn(row.from_turn)}` : "",
            num(row.loop) ? ` · ${t.loop(row.loop)}` : ""));
      }
      case "handout":
        return h(Row, { key, kindKey: "handout", kindLabel, family },
          h("span", { className: "coc-mech-body" }, text(row.label || row.name)),
          h(Stamp, { tone: row.available ? "pass" : "plain" }, row.available ? t.available : t.pending));
      default:
        // An unknown kind is a kernel that grew a receipt this file has not met. Show it rather
        // than swallow it: a blank row is how a projection silently stops arriving.
        return h(Row, { key, kindKey: text(row.kind), kindLabel, family },
          h("span", { className: "coc-mech-body" }, JSON.stringify(row)));
    }
  }

  /**
   * The delivery split at its `{{markers}}` (contract §16.6): text run, placed row, text run.
   *
   * Reading order is the whole point, so nothing is reordered and nothing is dropped -- a marker
   * whose row is not here (a keeper-only roll the projection already hid) leaves its text runs
   * joined rather than a hole. Paragraph breaks inside a run survive as their own blocks.
   */
  function splitDelivery(marked, rows) {
    const byMarker = new Map(rows.filter(row => typeof row.marker === "string").map(row => [row.marker, row]));
    const parts = [];
    let last = 0;
    const pattern = /\{\{([a-z0-9][a-z0-9:_-]*)\}\}/g;
    for (let match = pattern.exec(marked); match; match = pattern.exec(marked)) {
      const row = byMarker.get(match[1]);
      if (!row) continue;
      parts.push({ text: marked.slice(last, match.index) });
      parts.push({ row });
      last = match.index + match[0].length;
      byMarker.delete(match[1]);
    }
    parts.push({ text: marked.slice(last) });
    // Whatever the keeper did not place keeps the trailing group it has always had.
    return { parts, unplaced: rows.filter(row => !row.marker || byMarker.has(row.marker)) };
  }

  function proseBlocks(chunk, key) {
    // The markers are gone from these runs; what is left is the keeper's own paragraphing.
    return chunk.replace(/\{\{[a-z0-9][a-z0-9:_-]*\}\}/g, "").split(/\n{2,}/)
      .map(block => block.trim()).filter(Boolean)
      .map((block, index) => h("p", { className: "coc-mech-para", key: `${key}:${index}` }, block));
  }

  /** @param {{content: string, details?: unknown}} props */
  return function DeliveryCard(props) {
    const details = isRecord(props.details) ? props.details : {};
    if (isRecord(details.coc_error)) return null; // the host's own error card is better than ours
    const t = labelsFor(text(details.play_language));
    const glossary = isRecord(details.labels) ? details.labels : {};
    const term = (name) => (typeof glossary[name] === "string" && glossary[name]) || name;

    const prose = text(details.rendered_text);
    const all = (Array.isArray(details.mechanics) ? details.mechanics : []).filter(playerVisible);
    const marked = text(details.marked_text);
    // §16.6: with a marked delivery this card draws the narration itself, because a row can only be
    // put where the sentence is by whoever holds both. The host folds away the plain copy.
    if (marked) {
      const { parts, unplaced } = splitDelivery(marked, all);
      return h("div", { className: "coc-mech coc-mech-inline" },
        parts.map((part, index) => part.row
          ? h("div", { className: "coc-mech-here", key: `row:${index}` }, renderRow(part.row, t, term, index))
          : proseBlocks(part.text, `text:${index}`)),
        unplaced.length
          ? h("section", { className: "coc-mech-list", "aria-label": t.mechanics },
              h("h2", { className: "coc-mech-cap" }, t.mechanics),
              unplaced.map((row, i) => renderRow(row, t, term, `rest:${i}`)))
          : null);
    }

    const rows = all;
    // Nothing of ours to add: let the host draw its default card rather than an empty one.
    if (!prose && !rows.length) return null;

    return h("div", { className: "coc-mech" },
      prose ? h("div", { className: "coc-mech-prose" }, prose) : null,
      rows.length
        ? h("section", { className: "coc-mech-list", "aria-label": t.mechanics },
            h("h2", { className: "coc-mech-cap" }, t.mechanics),
            groupRows(rows).map((group, index) => group.call && group.rows.length > 1
              // A settlement of one row needs no group chrome: the disc already wears the tone.
              ? h("div", {
                  key: `${group.call}:${index}`,
                  className: "coc-mech-settle",
                  style: { "--tone": FAMILY_TONE[group.family] || "var(--muted)" },
                },
                h("div", { className: "coc-mech-fam" }, familyLabel(group, t)),
                group.rows.map((row, i) => renderRow(row, t, term, i)))
              : group.rows.map((row, i) => renderRow(row, t, term, `${index}:${i}`))))
        : null);
  };
}
