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
.coc-mech-inline .coc-mech-list{margin-top:18px}

/* The ledger. These rows are receipts — the contract's own word — so they are ruled entries,
   not cards: a hanging label in the gutter, the entry in the column, the figure at the margin. */
.coc-mech-list{margin-top:14px;max-width:64ch;border-top:1px solid var(--border)}
.coc-mech-cap{margin:0;padding:6px 0 2px;color:var(--subtle);font-size:11px;font-weight:600;
  letter-spacing:.02em}
.coc-mech-row{display:flex;align-items:baseline;gap:10px;padding:4px 0;
  border-top:1px solid color-mix(in oklab, var(--border) 55%, transparent);font-size:12.5px;line-height:1.5}
.coc-mech-row:first-of-type{border-top:0}
.coc-mech-kind{flex:none;width:3.2em;color:var(--subtle);font-size:11px;text-align:right;white-space:nowrap}
.coc-mech-body{flex:1;min-width:0;overflow-wrap:anywhere;color:var(--text)}
.coc-mech-out{flex:none;color:var(--muted);font-size:11px}
.coc-mech-out[data-tone="pass"]{color:var(--success)}
.coc-mech-out[data-tone="fail"]{color:var(--danger)}
.coc-mech-num{font-family:var(--coc-serif);font-variant-numeric:tabular-nums;font-weight:600;
  color:var(--text-strong)}
/* The one splash of colour in the ledger: the figure that actually moved. */
.coc-mech-row[data-down="1"] .coc-mech-num{color:var(--danger)}
.coc-mech-row[data-down="0"] .coc-mech-num{color:var(--success)}
.coc-mech-who{color:var(--muted)}
.coc-mech-faces{color:var(--subtle);font-size:11px;font-variant-numeric:tabular-nums}

/* One settlement is one stanza. The rule down its left edge carries the family's tone, so a
   sanity check and a brawl are told apart before a word is read; the rows inside stay the same
   ledger, because ten different card layouts would be ten things to learn instead of one. */
.coc-mech-stanza{--tone:var(--muted);margin:2px 0;padding-left:10px;border-left:2px solid var(--tone)}
.coc-mech-fam{padding:2px 0 1px;color:var(--tone);font-size:10.5px;letter-spacing:.02em}
.coc-mech-stanza .coc-mech-row{border-top:0;padding:2px 0}
.coc-mech-stanza .coc-mech-kind{width:2.8em}

/* The moment a table remembers: how well, or how badly. Emphasis follows the success level the
   kernel graded — it is not decoration, it is the grade. */
.coc-mech-lv{margin-left:6px;font-size:11px;color:var(--muted)}
.coc-mech-row[data-grade="extreme"] .coc-mech-num,
.coc-mech-row[data-grade="critical"] .coc-mech-num{font-size:14px;color:var(--accent)}
.coc-mech-row[data-grade="extreme"] .coc-mech-lv,
.coc-mech-row[data-grade="critical"] .coc-mech-lv{color:var(--accent);font-weight:650}
.coc-mech-row[data-grade="fumble"] .coc-mech-num,
.coc-mech-row[data-grade="fumble"] .coc-mech-lv{color:var(--danger);font-weight:650}
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
    // 内核的六档成功等级（kernel/coc/rules/resolver.py 的 levels）。regular 与 failure 缺席是刻意的：
    // 它们跟右边的 pass/fail 说的是同一件事，写出来只是把强调摊薄。
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
    // §15.3 的三种改法与 fork 的两种模式，都是闭集（kernel/coc/worldline.py 的
    // OPERATIONS / MODES）。桌子换了历史的线，是这一回合里最大的一件事。
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
 * One settlement, one stanza. The key is the kernel's: every row minted by a `resolve` carries
 * that call's id (§22.9), so consecutive rows sharing one are one roll group — a check, a sanity
 * check, a round of a brawl. Rows with no call (an applied clue, an item) stay on their own.
 *
 * Nothing is inferred here. Merging rows that merely *look* related would be guessing at
 * semantics the settlement already decided, and a wrong guess tells the player a wrong story
 * about their own dice.
 */
/**
 * One settlement, one stanza.
 *
 * The seam is the kernel's, not ours: a row says which call minted it (`call`) and what rule
 * family that call settled (`family`). `apply` is a call too, so its bookkeeping rows carry a
 * call as well — but they settled no rule, so they have no family, and they stay loose. That is
 * the right reading of them: a clue and a scene move were not part of anyone's dice.
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

  function Row(props) {
    const { children, kind, tag, tone, down, grade } = props;
    return h("div", {
      className: "coc-mech-row",
      "data-down": down === undefined ? "" : (down ? "1" : "0"),
      ...(grade ? { "data-grade": grade } : {}),
    },
      h("span", { className: "coc-mech-kind" }, kind),
      h("span", { className: "coc-mech-body" }, children),
      tag ? h("span", { className: "coc-mech-out", "data-tone": tone || "plain" }, tag) : null);
  }

  /** The value with its own emphasis; kept a component so every number looks the same. */
  function N(props) {
    return h("span", { className: "coc-mech-num" }, text(props.children));
  }

  function renderRow(row, t, term, index) {
    const kindLabel = t.kind[row.kind] || row.kind;
    const key = `${text(row.receipt)}:${index}`;
    switch (row.kind) {
      case "roll": {
        const who = row.actor_is_investigator === true ? text(row.actor_label || row.actor) : "";
        const skill = term(text(row.skill));
        const level = text(row.level);
        // The grade the kernel already assigned. Emphasis follows it — an extreme success and a
        // fumble are the two things a table talks about afterwards, so they get the weight.
        const grade = row.passed ? (level === "extreme" || level === "critical" ? level : "") : (level === "fumble" ? "fumble" : "");
        return h(Row, {
          key, kind: kindLabel, grade, tag: row.passed ? t.pass : t.fail, tone: row.passed ? "pass" : "fail",
        }, who ? h("span", { className: "coc-mech-who" }, `${who} `) : null,
          skill, " ", h(N, null, `${text(row.roll)}/${text(row.target)}`),
          t.level[level] ? h("span", { className: "coc-mech-lv" }, t.level[level]) : null,
          row.pushed ? h("span", { className: "coc-mech-faces" }, ` ${t.pushed}`) : null);
      }
      case "dice": {
        const who = row.actor_is_investigator === true ? text(row.actor_label || row.actor) : "";
        // 骰面只在它比总数多说了一句时才画：1D6 掷出 5，写成「5 [5]」是把同一个数说两遍。
        const rolled = Array.isArray(row.faces) ? row.faces : [];
        const faces = rolled.length && !(rolled.length === 1 && rolled[0] === row.total)
          ? ` [${rolled.join(" ")}]` : "";
        return h(Row, { key, kind: kindLabel },
          who ? h("span", { className: "coc-mech-who" }, `${who} `) : null,
          text(row.label || row.expression), " ", h(N, null, text(row.total)),
          faces ? h("span", { className: "coc-mech-faces" }, faces) : null);
      }
      case "change": {
        const before = num(row.before);
        const after = num(row.after);
        // The only arithmetic here, and it is subtraction of two numbers the kernel handed over.
        const delta = before !== undefined && after !== undefined ? after - before : undefined;
        return h(Row, { key, kind: kindLabel, down: delta === undefined ? undefined : delta < 0 },
          row.subject_is_investigator === true ? `${text(row.subject_label || row.subject)} ` : "", text(row.resource).toUpperCase(), " ",
          h(N, null, `${text(row.before)} ${t.arrow} ${text(row.after)}`),
          delta === undefined ? "" : ` (${delta > 0 ? "+" : ""}${delta})`);
      }
      case "scene":
        return h(Row, { key, kind: kindLabel },
          text(row.from_label || row.from), ` ${t.arrow} `, text(row.to_label || row.to),
          num(row.minutes) ? ` · ${t.minutes(row.minutes)}` : "");
      case "clue":
        return h(Row, { key, kind: kindLabel }, text(row.label || row.clue));
      case "time":
        return h(Row, { key, kind: kindLabel }, h(N, null, t.minutes(text(row.minutes))));
      case "item": {
        const quantity = num(row.quantity);
        const amount = quantity === undefined ? undefined : Math.abs(quantity);
        const owner = text(row.to_label || row.to);
        return h(Row, { key, kind: kindLabel },
          text(row.label || row.name), amount && amount > 1 ? ` ×${amount}` : "",
          owner ? quantity < 0 ? ` ${t.removedFrom(owner)}` : ` ${t.to} ${owner}` : "");
      }
      case "cash":
        return h(Row, { key, kind: kindLabel, down: num(row.after) !== undefined && num(row.before) !== undefined
          ? row.after < row.before : undefined },
          text(row.subject_label || row.subject), " ",
          h(N, null, `${text(row.before)} ${t.arrow} ${text(row.after)}`), " ", text(row.currency));
      case "session":
        return h(Row, { key, kind: kindLabel, tag: text(row.outcome) || undefined },
          (t.family[row.family] || text(row.family)), " ",
          (t.session[row.transition] || text(row.transition)),
          num(row.round) ? ` · ${t.round(row.round)}` : "",
          num(row.rounds) ? ` · ${t.round(row.rounds)}` : "");
      case "choice":
        return h(Row, { key, kind: kindLabel }, text(row.option));
      case "worldline": {
        // 一次 fork/switch/merge：桌子从哪条线到了哪条线，是不是又一圈。
        // fork 分两种（if 是岔出去，loop 是回到锚点重来），所以键要带上 mode。
        const operation = text(row.operation);
        const how = t.worldline[`${operation}:${text(row.mode)}`] || t.worldline[operation] || operation;
        const from = text(row.from_line);
        return h(Row, { key, kind: kindLabel },
          how, " ", h("span", { className: "coc-mech-who" }, text(row.label || row.line)),
          from ? ` ${t.arrow === "→" ? "←" : "<-"} ${from}` : "",
          num(row.from_turn) ? ` · ${t.turn(row.from_turn)}` : "",
          num(row.loop) ? ` · ${t.loop(row.loop)}` : "");
      }
      case "handout":
        return h(Row, { key, kind: kindLabel, tag: row.available ? t.available : t.pending },
          text(row.label || row.name));
      default:
        // An unknown kind is a kernel that grew a receipt this file has not met. Show it rather
        // than swallow it: a blank row is how a projection silently stops arriving.
        return h(Row, { key, kind: text(row.kind) }, JSON.stringify(row));
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
            groupRows(rows).map((group, index) => group.call
              ? h("div", {
                  key: `${group.call}:${index}`,
                  className: "coc-mech-stanza",
                  style: { "--tone": FAMILY_TONE[group.family] || "var(--muted)" },
                },
                h("div", { className: "coc-mech-fam" }, familyLabel(group, t)),
                group.rows.map((row, i) => renderRow(row, t, term, i)))
              : group.rows.map((row, i) => renderRow(row, t, term, `${index}:${i}`))))
        : null);
  };
}
