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
 * 1. **Rolls the player never saw are hidden; rolls they asked for are named but not shown.**
 *    §16.5 grades a roll's visibility in three: `public` draws in full, `concealed` draws the
 *    check's name with no figure at all, `keeper` draws nothing. A secret Spot Hidden the player
 *    was never told about must not appear here, or the panel leaks what the prose withheld — but a
 *    Psychology read the player themselves declared must appear, or their own check is
 *    indistinguishable from the Keeper talking, which is how this card came to look empty.
 * 2. **Nothing is computed.** Every number is printed as the receipt carries it. The one
 *    exception is a delta's sign, which is subtraction of two numbers the kernel already gave —
 *    and even that is done in base 10 (`exactDelta`), because on money the binary difference of
 *    two clean decimals is not a clean decimal, and the player reads the result.
 *
 * The visual system: one turn's mechanics arrive together, so they sit on one bordered slip
 * under a small caption. Each row leads with its kind's glyph on a disc; colour is earned, never
 * decoration — the outcome stamp, the delta badge's direction, the grade of a roll, and the
 * family tone of a settlement group (§16.2's `call`/`family`). Rows that settled nothing stay
 * loose between the groups.
 *
 * Same shape as `panel.js`: plain ESM, no imports (the renderer has no import map), and no word
 * table. The delivery carries `details.ui = {tag, words}` for the session's play language (§23,
 * 2026-09-09) and this file looks a caption up by key; every content field goes through `term()`,
 * the campaign's glossary, so the card reads the same words the sheet does.
 */

const STYLE_ID = "pipicoc-mechanics-style";
const CSS = `
.coc-mech-help{margin:8px 0 2px;display:flex;flex-direction:column;align-items:flex-start;gap:8px}
.coc-mech-help-toggle{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;border:1px solid var(--border-strong);border-radius:50%;color:var(--muted);background:var(--surface-raised);font-size:14px;font-weight:600;line-height:1;cursor:pointer}
.coc-mech-help-toggle:hover,.coc-mech-help-toggle[aria-expanded="true"]{color:var(--text-strong);border-color:var(--accent);background:color-mix(in srgb,var(--accent) 14%,var(--surface-raised))}
.coc-mech-help-fold{width:100%;max-width:560px;padding:12px 14px;border:1px solid var(--border);border-left:3px solid var(--accent);border-radius:10px;background:var(--surface-raised);color:var(--text);font-size:13px;line-height:1.7}
.coc-mech-help-fold h4{margin:0 0 6px;font-size:13px;font-weight:650;color:var(--text-strong)}
.coc-mech-help-fold p{margin:0 0 4px}
.coc-mech-help-fold p:last-child{margin:0;color:var(--muted)}
.coc-mech{--coc-serif:ui-serif,"Songti SC","Noto Serif CJK SC","SimSun",Georgia,serif}

/* This is not a card's text, it is the turn's prose: the host folds its own plain copy away and
   this component draws the delivery, because only whoever holds both the text and the rows can put
   a receipt at a sentence (§16.6). So it reads the host's prose tokens rather than setting a face
   of its own — one definition, or the two drift, which is how it came to sit at 14.5px serif on a
   64ch measure under a 15.5px sans column and end half a column short. Everything below the prose
   is machinery and keeps the interface face. */
.coc-mech-prose,.coc-mech-para{
  font-family:var(--md-font,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB",sans-serif);
  font-size:var(--md-fs,15.5px);
  line-height:var(--md-lh,1.78);color:var(--text);
  overflow-wrap:break-word;line-break:strict;text-wrap:pretty;text-spacing-trim:trim-start}
.coc-mech-prose{white-space:pre-wrap}

/* A marked delivery (§16.6): the narration reads straight down and a receipt sits at the point
   the keeper put it, inset just enough to read as an aside rather than as a paragraph. */
.coc-mech-para{margin:0 0 var(--md-block,1.05em)}
.coc-mech-here{margin:0.35em 0 1em;padding-left:10px;border-left:2px solid var(--border-strong)}
.coc-mech-here .coc-mech-row{border-top:0;padding:5px 0}
.coc-mech-inline .coc-mech-list{margin-top:18px}

/* The settlement slip. One turn's mechanics are one event, so they sit inside one bordered
   sheet with a small caption — not a ruled ledger fading into the prose. */
.coc-mech-list{margin-top:14px;border:1px solid var(--border);border-radius:10px;
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
/* A body's state earns its colour from the rules, not from the kind: a condition that takes the
   action away is the one row on the slip the player has to see before anything else. */
.coc-mech-row[data-kind="condition"][data-grade="blocked"] .coc-mech-ico{color:var(--danger);
  background:color-mix(in oklab, var(--danger) 13%, transparent)}
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
/* What the check demanded, when a difficulty moved the bar off the target. It is a condition,
   not a grade, so it stays outlined and quiet beside the graded chip rather than filled. */
.coc-mech-need{flex:none;font-size:10.5px;font-weight:600;padding:1px 6px;border-radius:5px;
  white-space:nowrap;font-variant-numeric:tabular-nums;color:var(--subtle);border:1px solid var(--border)}
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

/* A row that opens: the summary is the row, the body is what it names. Today only a handout
   with text opens (§14.8/§16.2); an image or an unavailable card has nothing to open into. */
.coc-mech-fold{display:block;padding:0}
.coc-mech-fold-head{display:flex;align-items:center;gap:10px;padding:6px 2px;cursor:pointer;
  list-style:none;border-radius:6px}
.coc-mech-fold-head::-webkit-details-marker{display:none}
.coc-mech-fold-head::after{content:"▸";flex:none;color:var(--subtle);font-size:11px;
  transition:transform .12s ease}
.coc-mech-fold[open]>.coc-mech-fold-head::after{transform:rotate(90deg)}
.coc-mech-fold-body{margin:2px 0 10px 34px;padding:10px 14px;border-left:2px solid var(--border-strong);
  font-family:var(--coc-serif);font-size:13.5px;line-height:1.75;white-space:pre-wrap;color:var(--text);
  max-height:340px;overflow:auto}
.coc-map{display:block;padding:0}
.coc-map-head{display:flex;align-items:center;gap:10px;padding:6px 2px;list-style:none;cursor:pointer}
.coc-map-head::-webkit-details-marker{display:none}
.coc-map-head::after{content:"▸";color:var(--subtle);font-size:11px;transition:transform .12s ease}
.coc-map[open]>.coc-map-head::after{transform:rotate(90deg)}
.coc-map-body{margin:2px 0 10px 34px;border-left:2px solid var(--border-strong);padding:9px 12px}
.coc-map-tools{display:flex;align-items:center;gap:8px;margin-bottom:8px;color:var(--muted);font-size:11px}
.coc-map-tools input{width:130px;accent-color:var(--accent)}
.coc-map-levels{margin-left:auto;display:flex;gap:4px}
.coc-map-levels button{border:1px solid var(--border);border-radius:999px;background:transparent;color:var(--muted);
  padding:2px 7px;font:inherit;cursor:pointer}
.coc-map-levels button[aria-pressed="true"]{color:var(--accent);border-color:var(--accent);background:color-mix(in oklab,var(--accent) 9%,transparent)}
.coc-map-viewport{max-height:520px;overflow:auto;border:1px solid var(--border);border-radius:8px;
  background:#171613;overscroll-behavior:contain;cursor:grab;touch-action:none;user-select:none}
.coc-map-viewport[data-panning="1"]{cursor:grabbing}
.coc-map-image{display:block;height:auto;max-width:none;transform-origin:top left;pointer-events:none}
.coc-map-regions{margin-top:7px;color:var(--subtle);font-size:11px}
.coc-map-empty{margin:2px 0 10px 34px;padding:9px 12px;color:var(--muted);font-size:12.5px}
.coc-map-levels button{display:inline-flex;align-items:center;gap:5px}
.coc-map-thumb{width:28px;height:18px;object-fit:cover;border-radius:3px;display:block;
  background:color-mix(in oklab, var(--border) 55%, transparent)}

/* The table changed history — the largest thing a row can say, so even standing alone it gets
   the accent rail a settlement group would. */
.coc-mech-row[data-kind="worldline"]{margin:7px 0;padding:6px 10px;border-radius:9px;
  border:1px solid color-mix(in oklab, var(--accent) 35%, transparent);
  border-left:3px solid var(--accent);
  background:color-mix(in oklab, var(--accent) 6%, transparent)}
`;

/* >>> speaker colour: shared verbatim between pipicoc/mechanics.js and pipicoc/panel.js <<<
 *
 * Contract §40.4. A pack renderer is imported from a `data:` URL (`controlled-component-loader.ts`
 * turns the host-read source into one), so a relative import of a sibling file cannot resolve and
 * these two renderers have no module to share. Everything between the two markers is therefore
 * authored once and copied byte for byte into both files; `tests/extension/speaker-colour.test.mjs`
 * fails the moment the copies drift.
 *
 * The allocation itself cannot be copied: the delivery card and the legend swatch have to land on
 * the same slot for the same person, so there is one table, and the only thing two `data:` modules
 * of one window share is that window. It is memory and nothing more — no colour is written to the
 * NPC record, to the campaign or to `localStorage` (§40.4), and a reload allocates again from the
 * transcript's own order.
 */
const SPEAKER_SLOTS = 16;
const SPEAKER_TABLE = "__pipicocSpeakerSlots1";

/** The palette: sixteen hues, a light value and a dark value each, plus the investigator's own
 *  ink outside them. The shell puts `data-scheme` on its own `<main>` (App.tsx), so the dark half
 *  follows the theme the player chose rather than the operating system's. The hues are the only
 *  new host string §40.4 allows; they are colours, not words. */
const SPEAKER_CSS = `
.coc-say,.coc-say-dot{
  --coc-say-pc:oklch(0.40 0.025 255);
  --coc-say-0:oklch(0.47 0.145 20);   --coc-say-1:oklch(0.47 0.145 42);
  --coc-say-2:oklch(0.47 0.145 65);   --coc-say-3:oklch(0.47 0.145 88);
  --coc-say-4:oklch(0.47 0.145 112);  --coc-say-5:oklch(0.47 0.145 135);
  --coc-say-6:oklch(0.47 0.145 158);  --coc-say-7:oklch(0.47 0.145 180);
  --coc-say-8:oklch(0.47 0.145 202);  --coc-say-9:oklch(0.47 0.145 224);
  --coc-say-10:oklch(0.47 0.145 246); --coc-say-11:oklch(0.47 0.145 268);
  --coc-say-12:oklch(0.47 0.145 290); --coc-say-13:oklch(0.47 0.145 310);
  --coc-say-14:oklch(0.47 0.145 330); --coc-say-15:oklch(0.47 0.145 350)}
[data-scheme="dark"] :is(.coc-say,.coc-say-dot){
  --coc-say-pc:oklch(0.86 0.020 255);
  --coc-say-0:oklch(0.80 0.115 20);   --coc-say-1:oklch(0.80 0.115 42);
  --coc-say-2:oklch(0.80 0.115 65);   --coc-say-3:oklch(0.80 0.115 88);
  --coc-say-4:oklch(0.80 0.115 112);  --coc-say-5:oklch(0.80 0.115 135);
  --coc-say-6:oklch(0.80 0.115 158);  --coc-say-7:oklch(0.80 0.115 180);
  --coc-say-8:oklch(0.80 0.115 202);  --coc-say-9:oklch(0.80 0.115 224);
  --coc-say-10:oklch(0.80 0.115 246); --coc-say-11:oklch(0.80 0.115 268);
  --coc-say-12:oklch(0.80 0.115 290); --coc-say-13:oklch(0.80 0.115 310);
  --coc-say-14:oklch(0.80 0.115 330); --coc-say-15:oklch(0.80 0.115 350)}

/* A spoken line is tinted, and wears a hairline rule at the point it begins, so a reader who does
   not separate these hues still sees that a line starts here and that it is not the narrator's. */
.coc-say{color:var(--coc-say-ink,inherit);
  border-left:2px solid color-mix(in oklab,var(--coc-say-ink,currentColor) 55%,transparent);
  padding-left:.34em;margin-left:.08em}

/* The legend, beside the journal row for the same person. Decoration only: the name is right
   next to it, so the dot says nothing a screen reader has to hear. */
.coc-say-dot{display:inline-block;flex:none;width:8px;height:8px;border-radius:50%;
  margin-right:7px;vertical-align:baseline;background:var(--coc-say-ink,var(--muted))}
`;

/** FNV-1a over the anchor, one UTF-16 code unit at a time, low byte first, so a CJK label hashes
 *  as readily as an ASCII handle. */
function speakerHash(anchor) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < anchor.length; index += 1) {
    const code = anchor.charCodeAt(index);
    hash = Math.imul(hash ^ (code & 0xff), 0x01000193);
    hash = Math.imul(hash ^ ((code >>> 8) & 0xff), 0x01000193);
  }
  return hash >>> 0;
}

/**
 * The slot an anchor owns: its hash slot, or the first free one after it.
 *
 * The probe runs in the order the window first shows a person, so two people at one table never
 * share a hue and a reload paints the same colours in the same order. Once all sixteen are taken
 * the probe gives the hash slot back rather than leave a line uncoloured.
 */
function speakerSlot(anchor) {
  const scope = typeof globalThis === "object" && globalThis ? globalThis : {};
  const table = scope[SPEAKER_TABLE] && scope[SPEAKER_TABLE].held instanceof Map
    ? scope[SPEAKER_TABLE]
    : (scope[SPEAKER_TABLE] = { held: new Map(), taken: new Set() });
  const known = table.held.get(anchor);
  if (known !== undefined) return known;
  let slot = speakerHash(anchor) % SPEAKER_SLOTS;
  for (let step = 0; step < SPEAKER_SLOTS && table.taken.has(slot); step += 1) {
    slot = (slot + 1) % SPEAKER_SLOTS;
  }
  table.taken.add(slot);
  table.held.set(anchor, slot);
  return slot;
}

/**
 * The ink for one speaker, as a reference into the palette above.
 *
 * An investigator is never hashed: the player's own voice keeps the one fixed ink outside the hash
 * palette, so it reads the same on every turn of every table. Everyone else takes a hue by their
 * anchor -- a person of the graph by their handle, a label by its own text (§40.4). A speaker with
 * no anchor at all gets no ink rather than somebody else's.
 */
function speakerInk(anchor, who) {
  if (who === "investigator") return "var(--coc-say-pc)";
  const key = typeof anchor === "string" ? anchor.trim() : "";
  return key ? `var(--coc-say-${speakerSlot(key)})` : "";
}
/* >>> end speaker colour <<< */

if (typeof document !== "undefined" && !document.getElementById(STYLE_ID)) {
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS + SPEAKER_CSS;
  document.head.append(style);
}

/**
 * A caption from the delivery's own `ui` block: `ui.words[surface][key]`.
 *
 * A key the surface does not carry renders as `fallback`, and `fallback` defaults to the key
 * itself -- an identifier a player can report, never a word from a language they did not choose.
 */
function word(ui, surface, key, fallback) {
  const surfaces = isRecord(ui) && isRecord(ui.words) ? ui.words : {};
  const table = isRecord(surfaces[surface]) ? surfaces[surface] : {};
  return typeof table[key] === "string" ? table[key] : fallback === undefined ? key : fallback;
}

/** A parameterised caption: `{name}` placeholders filled from `values`, order and all. */
function fill(template, values) {
  return String(template).replace(/\{([A-Za-z0-9_]+)\}/g, (whole, name) =>
    Object.prototype.hasOwnProperty.call(values, name) ? text(values[name]) : whole);
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
  map: [["path", {d:"M3 6.5 8.5 3l7 3.5L21 3v14.5L15.5 21l-7-3.5L3 21z"}],
        ["line",{x1:8.5,y1:3,x2:8.5,y2:17.5}],["line",{x1:15.5,y1:6.5,x2:15.5,y2:21}]],
  condition: [["path", { d: "M12 20.5S3.5 15.2 3.5 9.4A4.6 4.6 0 0 1 12 6.6a4.6 4.6 0 0 1 8.5 2.8c0 5.8-8.5 11.1-8.5 11.1z" }],
              ["polyline", { points: "5.6 11.6 9.3 11.6 10.8 8.9 12.8 14.3 14.2 11.6 18.4 11.6" }]],
  fallback: [["circle", { cx: 12, cy: 12, r: 8.5 }]],
};

/**
 * The §40 speech wrapper, matched by its shape and by nothing else.
 *
 * `{{say:<name>}}` opens a spoken line and `{{/say}}` closes it. The name is up to sixty
 * characters that are neither a brace nor a line break, because the play language is open (§23):
 * a speaker may be named in any script, and the ASCII marker grammar of §16.6 matches none of
 * them, so a name outside ASCII would leave its braces on the page for the player to read.
 */
const SAY_TOKEN = /\{\{say:([^{}\n]{1,60})\}\}|\{\{\/say\}\}/g;

/** Whatever else is still in braces once the card has placed its rows. §40.4: no brace reaches
 *  the player, whether it named a receipt this card could not draw or nothing at all. */
const LOOSE_TOKEN = /\{\{[^{}\n]*\}\}/g;

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

/** Decimal places in a number's own JSON spelling, or null when it is not spelled plainly. */
function decimalPlaces(value) {
  const text = String(value);
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) return null;
  const point = text.indexOf(".");
  return point < 0 ? 0 : text.length - point - 1;
}

/**
 * `after - before`, differenced on the two numbers' own digits.
 *
 * This is the one piece of arithmetic on the card, and in binary floating point it is not safe
 * for money: a two-cent newspaper took an investigator from 9 to 8.98 and the badge printed
 * `-0.019999999999999574` at the player. The kernel was clean — a cash receipt carries no delta
 * at all, only the two endpoints — so the noise was made here, by `after - before`.
 *
 * The kernel settles cash in exact base 10 (`kernel-ts/apply/cash.ts`); this renderer has no
 * import map and cannot share that code, so it does the same thing in the small: scale both
 * endpoints to the finer of their two decimal spellings, subtract as integers, and put the point
 * back. An integer resource (SAN 50 → 45) has scale 1 and comes out −5, exactly as before.
 *
 * A value JavaScript spells in exponent form, or a scale too fine to hold as a safe integer, is
 * outside anything a resource on this card uses; those fall back to the plain subtraction rather
 * than being silently mis-scaled.
 */
function exactDelta(before, after) {
  if (before === undefined || after === undefined) return undefined;
  const places = [decimalPlaces(before), decimalPlaces(after)];
  if (places.some(value => value === null)) return after - before;
  const factor = 10 ** Math.max(...places);
  const end = Math.round(after * factor), start = Math.round(before * factor);
  return Number.isSafeInteger(end) && Number.isSafeInteger(start) ? (end - start) / factor : after - before;
}

/** A player-safe raster derivative. File paths, remote URLs and SVG data never reach the <img>. */
function playerImage(value) {
  return typeof value === "string" && /^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(value);
}

function knownLevelImages(row) {
  return (Array.isArray(row?.level_images) ? row.level_images : [])
    .filter(item => isRecord(item) && text(item.level) && playerImage(item.image))
    .map(item => ({ level: text(item.level), image: item.image }));
}

function knownRegionLabels(row) {
  return (Array.isArray(row?.regions) ? row.regions : [])
    .map(region => isRecord(region) ? text(region.label || region.id) : text(region))
    .filter(Boolean);
}

/** Scroll the viewport by pointer drag. Local only: no model, no kernel, no campaign write. */
function panViewport(event) {
  if (event.button) return;
  const viewport = event.currentTarget;
  if (!viewport) return;
  const originX = event.clientX, originY = event.clientY;
  const originLeft = viewport.scrollLeft, originTop = viewport.scrollTop;
  viewport.dataset.panning = "1";
  if (viewport.setPointerCapture && event.pointerId != null) viewport.setPointerCapture(event.pointerId);
  function move(next) {
    viewport.scrollLeft = originLeft - (next.clientX - originX);
    viewport.scrollTop = originTop - (next.clientY - originY);
  }
  function stop(next) {
    viewport.dataset.panning = "";
    if (viewport.releasePointerCapture && next.pointerId != null) {
      try { viewport.releasePointerCapture(next.pointerId); } catch { /* already released */ }
    }
    viewport.removeEventListener("pointermove", move);
    viewport.removeEventListener("pointerup", stop);
    viewport.removeEventListener("pointercancel", stop);
  }
  viewport.addEventListener("pointermove", move);
  viewport.addEventListener("pointerup", stop);
  viewport.addEventListener("pointercancel", stop);
  event.preventDefault();
}

/**
 * §16.5: keeper-visibility rolls are projected so a log can keep them, and a surface that renders
 * for the player must hide them. This panel is the player's. A `concealed` roll is not one of
 * those: the player declared the action and knows a check happened, so the row stays and
 * `renderRow` prints no figure for it.
 */
function playerVisible(row) {
  return isRecord(row) && row.visibility !== "keeper";
}

/** A roll whose die the rules keep from the player, though the attempt itself was theirs (§16.5). */
function concealedRoll(row) {
  return isRecord(row) && row.kind === "roll" && row.visibility === "concealed";
}

/**
 * The clock belongs to the panel, not to the reading surface.
 *
 * A `time` receipt carries nothing but the minutes an action cost, and the panel already prints
 * where the table stands in time. Dropped into the prose it is a bare number with no sentence to
 * belong to, so this card never draws one. Its marker (§16.6) is then a marker whose row is not
 * here, which `splitDelivery` already handles by joining the text runs around it.
 */
function playerReads(row) {
  return playerVisible(row) && row.kind !== "time";
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
function familyLabel(group, t, term) {
  const name = group.family ? t(`family.${group.family}`, term(group.family)) : "";
  const sides = group.rows.filter(row => row.kind === "roll").length;
  return sides > 1 ? `${name} · ${t("opposed")}` : name;
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
    const { children, kindKey, kindLabel, grade, family, title } = props;
    const tone = family && FAMILY_TONE[family];
    return h("div", {
      className: "coc-mech-row",
      "data-kind": kindKey,
      title: title || kindLabel,
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

  /** A row that opens into what it names — today only a handout carrying its text (§16.2). */
  function FoldRow(props) {
    const { children, kindKey, kindLabel, body } = props;
    return h("details", { className: "coc-mech-row coc-mech-fold", "data-kind": kindKey, title: kindLabel },
      h("summary", { className: "coc-mech-fold-head" },
        h("span", { className: "coc-mech-ico", "aria-hidden": "true" }, icon(kindKey)),
        ...(Array.isArray(children) ? children : [children])),
      h("div", { className: "coc-mech-fold-body" }, body));
  }

  function MapRow(props) {
    const { row, name, t } = props;
    const [zoom, setZoom] = React.useState(100);
    const [broken, setBroken] = React.useState(false);
    const variants = knownLevelImages(row);
    const [level, setLevel] = React.useState(variants[0]?.level || "");
    const shown = variants.find(item => item.level === level)?.image || (playerImage(row.image) ? row.image : "");
    const openable = row.available === true && Boolean(shown) && !broken;
    const regionLabels = knownRegionLabels(row);
    const stamp = openable ? t("available") : t("pending");
    return h("details", {
      className: "coc-mech-row coc-map",
      "data-kind": "map",
      "data-map": text(row.map) || undefined,
      "data-view": text(row.view_id) || undefined,
      "data-receipt": text(row.receipt) || undefined,
      title: name,
      onToggle: event => { if (event.currentTarget.open) setBroken(false); },
    },
      h("summary", { className: "coc-map-head" },
        h("span", { className: "coc-mech-ico", "aria-hidden": "true" }, icon("map")),
        h("span", { className: "coc-mech-body" }, name),
        h(Stamp, { tone: openable ? "pass" : "plain" }, stamp)),
      openable
        ? h("div", { className: "coc-map-body" },
            h("label", { className: "coc-map-tools" },
              h("input", {
                type: "range", min: "50", max: "240", step: "10", value: zoom,
                "aria-label": name,
                onChange: event => setZoom(Number(event.target.value)),
              }),
              h("span", null, `${zoom}%`),
              variants.length > 1
                ? h("span", { className: "coc-map-levels" }, variants.map(item =>
                    h("button", {
                      key: item.level,
                      type: "button",
                      title: item.level,
                      "aria-pressed": item.level === level,
                      onClick: () => setLevel(item.level),
                    },
                      h("img", {
                        className: "coc-map-thumb", src: item.image, alt: "",
                        draggable: "false", "aria-hidden": "true",
                      }),
                      item.level)))
                : null),
            h("div", {
              className: "coc-map-viewport",
              onPointerDown: panViewport,
            }, h("img", {
              className: "coc-map-image",
              src: shown,
              alt: name,
              draggable: "false",
              style: { width: `${zoom}%` },
              onError: () => setBroken(true),
            })),
            regionLabels.length ? h("div", { className: "coc-map-regions" }, regionLabels.join(" · ")) : null)
        : h("div", { className: "coc-map-empty" }, t("pending")));
  }

  function renderRow(row, t, term, index) {
    const kindLabel = t(`kind.${row.kind}`, term(text(row.kind)));
    const key = `${text(row.receipt)}:${index}`;
    const family = text(row.family) || undefined;
    switch (row.kind) {
      case "roll": {
        const who = row.actor_is_investigator === true ? text(row.actor_label || row.actor) : "";
        const skill = term(text(row.skill));
        // The die is the keeper's; the attempt is the player's. Nothing numeric is drawn — no
        // figure, no target, no grade, no pass/fail stamp — because each of those is the very
        // thing the rule withholds (a visible failure would say "this read is unreliable").
        // The row exists so the player can see that the check they asked for was rolled at all.
        if (concealedRoll(row))
          return h(Row, { key, kindKey: "roll", kindLabel, family },
            h("span", { className: "coc-mech-body" },
              who ? h("span", { className: "coc-mech-who" }, `${who} `) : null,
              h("span", { className: "coc-mech-skill" }, skill)),
            h(Stamp, { tone: "plain" }, t("concealed")));
        const level = text(row.level);
        // The grade the kernel already assigned. Emphasis follows it — an extreme success and a
        // fumble are the two things a table talks about afterwards, so they get the weight.
        const grade = row.passed ? (level === "extreme" || level === "critical" ? level : "") : (level === "fumble" ? "fumble" : "");
        // Two independent axes share three of CoC's words, and this row draws both of them:
        // `difficulty` is what the check *demanded* (`regular|hard|extreme`, below), `level` is
        // what the die *achieved* (`critical|extreme|hard|regular|failure|fumble`, here). A STR
        // check at 55 rolled as a 13 is `difficulty: regular, level: hard`, and while both chips
        // said only "hard" the player read the achieved grade as the demanded one — a check the
        // keeper never called hard was reported as one, every turn, in the one place a receipt is
        // supposed to be legible.
        //
        // So the two vocabularies are kept apart in `content/ui/<tag>/mechanics.json` rather than
        // here: `difficulty.*` names a bar (`hard`), `level.*` names an outcome (`hard success`),
        // and the requirement chip frames its own with `needs … · ≤n`. Nothing in this file may
        // gloss one axis with the other's key — that is what made them collide.
        //
        // `regular` and `failure` carry no word on purpose: they say what the stamp already says,
        // and an empty chip beside the stamp is worse than none.
        const levelWord = level ? t(`level.${level}`, "") : "";
        // The bar the die was actually compared against (§16.2's `threshold`), drawn whenever the
        // difficulty moved it off the target.
        //
        // Without it the row contradicts its own stamp. A hard Intimidate against a 15 is decided
        // at 7, so `10 /15  fail` reads to a player as the product getting CoC's one rule wrong —
        // 10 is under 15. The kernel had both numbers all along and this card printed neither:
        // `difficulty` and `threshold` had no reader in this file at all. They are not prose
        // restated (the rule against numbers in narration is about the keeper's sentences); this
        // is the structured slip where a receipt is supposed to be legible.
        //
        // `regular` is silent because its threshold *is* the target already drawn — the test is
        // the two numbers, not the word, so a difficulty this file has no caption for still says
        // the true figure.
        const bar = num(row.threshold), difficulty = text(row.difficulty);
        const needWord = bar !== undefined && bar !== num(row.target) && difficulty
          ? fill(t("needs"), { level: t(`difficulty.${difficulty}`, term(difficulty)), n: bar })
          : "";
        return h(Row, { key, kindKey: "roll", kindLabel, grade, family },
          h("span", { className: "coc-mech-body" },
            who ? h("span", { className: "coc-mech-who" }, `${who} `) : null,
            h("span", { className: "coc-mech-skill" }, skill)),
          h("span", { className: "coc-mech-figure" },
            h(N, null, text(row.roll)),
            h("span", { className: "coc-mech-target" }, `/${text(row.target)}`)),
          needWord ? h("span", { className: "coc-mech-need" }, needWord) : null,
          levelWord ? h("span", { className: "coc-mech-lv" }, levelWord) : null,
          row.pushed ? h("span", { className: "coc-mech-faces" }, t("pushed")) : null,
          h(Stamp, { tone: row.passed ? "pass" : "fail" }, row.passed ? t("pass") : t("fail")));
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
            t(`die.${text(row.word)}`, term(text(row.label || row.expression)))),
          faces ? h("span", { className: "coc-mech-faces" }, faces) : null,
          h("span", { className: "coc-mech-figure" }, h(N, null, text(row.total))));
      }
      case "change": {
        const before = num(row.before);
        const after = num(row.after);
        // The only arithmetic here, and it is subtraction of two numbers the kernel handed over —
        // done on their digits, because in binary the difference of two decimals is not one.
        const delta = exactDelta(before, after);
        return h(Row, { key, kindKey: "change", kindLabel, family },
          h("span", { className: "coc-mech-body" },
            row.item ? h("span", { className: "coc-mech-who" }, `${term(text(row.item))} `) : row.subject_is_investigator === true
              ? h("span", { className: "coc-mech-who" }, `${text(row.subject_label || row.subject)} `) : "",
            h("span", { className: "coc-mech-res" },
              t(`resource.${text(row.resource)}`, term(text(row.resource).toUpperCase())))),
          h("span", { className: "coc-mech-figure" },
            h("span", { className: "coc-mech-from" }, text(row.before)),
            ` ${t("arrow")} `,
            h(N, null, text(row.after))),
          h(Delta, { value: delta }));
      }
      case "condition": {
        // What the rules now hold true of a body, and -- when it is one of the three that take the
        // action away -- that it does.
        //
        // This case did not exist until 2026-09-16, so a condition fell through to `default` and drew
        // one word: its own kind. `game-83177d61` turn 107 settled `unconscious` on the investigator
        // and the card printed the equivalent of "state"; the player spent the next two turns
        // declaring things an unconscious man cannot do and reading the Keeper write around each one.
        // A receipt the player cannot read is the empty-card verdict again (§16.5), and the state is
        // exactly the sort a player has to see to play at all -- CoC prints these on the sheet in
        // their hand.
        //
        // Public by subject, not by name: nothing in a receipt marks a condition secret, and a list
        // of the ones that were would be a rules table living in this file. The `keeper` tier already
        // exists for a settlement that means to withhold one (`playerVisible` drops it above), and it
        // is the settlement's call, not the card's.
        const who = row.subject_is_investigator === true ? text(row.subject_label || row.subject) : "";
        const word = name => t(`condition.${name}`, term(name));
        const named = value => (Array.isArray(value) ? value : []).map(text).filter(Boolean).map(word).join(" · ");
        const gained = named(row.gained), lost = named(row.lost);
        const blocked = Array.isArray(row.incapacitated) && row.incapacitated.length > 0;
        return h(Row, { key, kindKey: "condition", kindLabel, family, grade: blocked ? "blocked" : "" },
          h("span", { className: "coc-mech-body" },
            who ? h("span", { className: "coc-mech-who" }, `${who} `) : null,
            gained ? h("span", { className: "coc-mech-skill" }, gained) : null),
          lost ? h("span", { className: "coc-mech-delta", "data-down": "0" }, fill(t("cleared"), { name: lost })) : null,
          // The kernel decided this when it minted the receipt; the card neither reads a name nor
          // infers anything from one.
          blocked ? h(Stamp, { tone: "fail" }, t("cannotAct")) : null);
      }
      case "scene":
        return h(Row, { key, kindKey: "scene", kindLabel, family },
          h("span", { className: "coc-mech-body" },
            term(text(row.from_label || row.from)), ` ${t("arrow")} `, term(text(row.to_label || row.to))),
          num(row.minutes) ? h("span", { className: "coc-mech-faces" }, fill(t("minutes"), { n: row.minutes })) : null);
      case "clue": {
        const name = term(text(row.label || row.clue));
        const rawSummary = text(row.summary);
        if (!rawSummary || rawSummary === name) {
          // Nothing more to open into than the name itself: the row stays a line.
          return h(Row, { key, kindKey: "clue", kindLabel, family },
            h("span", { className: "coc-mech-body" }, name));
        }
        // The summary is the module's own sentence, kept by the graph in the language the book
        // was read in. Its play-language projection rides in with the delivery's labels -- the
        // campaign's `clues` lane, merged under the kernel glossary by the host -- and this falls
        // back to the original for a clue whose lane run has not landed yet.
        return h(FoldRow, { key, kindKey: "clue", kindLabel, body: term(rawSummary) },
          h("span", { className: "coc-mech-body" }, name));
      }
      case "item": {
        const quantity = num(row.quantity);
        const amount = quantity === undefined ? undefined : Math.abs(quantity);
        const owner = term(text(row.to_label || row.to));
        const lost = quantity !== undefined && quantity < 0;
        return h(Row, { key, kindKey: "item", kindLabel, family },
          h("span", { className: "coc-mech-body" },
            term(text(row.label || row.name)), amount && amount > 1 ? ` ×${amount}` : "", owner ? " " : ""),
          owner ? h("span", { className: "coc-mech-delta", "data-down": lost ? "1" : "0" },
            lost ? fill(t("removedFrom"), { name: owner }) : `${t("to")} ${owner}`) : null);
      }
      case "cash": {
        const before = num(row.before);
        const after = num(row.after);
        // Cash is the decimal resource: a purchase of 0.02 is the case that exposed `after - before`.
        const delta = exactDelta(before, after);
        return h(Row, { key, kindKey: "cash", kindLabel, family },
          h("span", { className: "coc-mech-body" }, text(row.subject_label || row.subject)),
          h("span", { className: "coc-mech-figure" },
            h("span", { className: "coc-mech-from" }, text(row.before)),
            ` ${t("arrow")} `,
            h(N, null, text(row.after)),
            h("span", { className: "coc-mech-faces" }, term(text(row.currency)))),
          h(Delta, { value: delta }));
      }
      case "session":
        return h(Row, { key, kindKey: "session", kindLabel, family },
          h("span", { className: "coc-mech-body" },
            h("span", { className: "coc-mech-skill" }, t(`family.${text(row.family)}`, term(text(row.family)))), " ",
            t(`session.${text(row.transition)}`, term(text(row.transition))),
            num(row.round) ? ` · ${fill(t("round"), { n: row.round })}` : "",
            num(row.rounds) ? ` · ${fill(t("round"), { n: row.rounds })}` : ""),
          text(row.outcome)
            ? h(Stamp, { tone: "plain" }, t(`outcome.${text(row.outcome)}`, term(text(row.outcome))))
            : null);
      case "choice":
        return h(Row, { key, kindKey: "choice", kindLabel, family },
          h("span", { className: "coc-mech-body" }, term(text(row.option))));
      case "worldline": {
        // A fork/switch/merge: which line the table moved to, and whether this circuit again.
        // Fork has two modes (if forks away, loop rewinds to the anchor), so the key carries mode.
        const operation = text(row.operation);
        const how = t(`worldline.${operation}:${text(row.mode)}`,
          t(`worldline.${operation}`, term(operation)));
        const from = term(text(row.from_line));
        return h(Row, { key, kindKey: "worldline", kindLabel, family },
          h("span", { className: "coc-mech-body" },
            h("span", { className: "coc-mech-skill" }, how), " ",
            h("span", { className: "coc-mech-who" }, term(text(row.label || row.line)))),
          h("span", { className: "coc-mech-faces" },
            from ? `${t("arrowBack")} ${from}` : "",
            num(row.from_turn) ? ` · ${fill(t("turn"), { n: row.from_turn })}` : "",
            num(row.loop) ? ` · ${fill(t("loop"), { n: row.loop })}` : ""));
      }
      case "handout": {
        const name = term(text(row.label || row.name));
        const stamp = h(Stamp, { tone: row.available ? "pass" : "plain" }, row.available ? t("available") : t("pending"));
        // The document the player is handed, which is the module's own prose in the language the
        // book was read in. Its name went through the glossary and its body did not, so the row
        // folded under a play-language title into a column of the source language.
        const body = term(text(row.text));
        if (!body) {
          // Nothing to open into — an image, or bytes that never shipped: the row stays a line.
          return h(Row, { key, kindKey: "handout", kindLabel, family },
            h("span", { className: "coc-mech-body" }, name), stamp);
        }
        return h(FoldRow, { key, kindKey: "handout", kindLabel, body },
          h("span", { className: "coc-mech-body" }, name), stamp);
      }
      case "map": {
        const name = term(text(row.label || row.name || row.map));
        return h(MapRow, {
          key: `${text(row.receipt)}:${text(row.view_id)}:${text(row.map)}:${index}`,
          row, name, t,
        });
      }
      default:
        // An unknown kind is a kernel that grew a receipt this file has not met. Name it rather
        // than swallow it -- a blank row is how a projection silently stops arriving -- but the
        // reading surface gets the kind, not the row's JSON: a player reads this card.
        return h(Row, { key, kindKey: text(row.kind), kindLabel, family, title: JSON.stringify(row) },
          h("span", { className: "coc-mech-body" }, kindLabel));
    }
  }

  /**
   * The delivery split at its `{{markers}}` (contract §16.6): text run, placed row, text run.
   *
   * Reading order is the whole point, so nothing is reordered and nothing is dropped -- a marker
   * whose row is not here (a keeper-only roll the projection already hid) leaves its text runs
   * joined rather than a hole. Paragraph breaks inside a run survive as their own blocks.
   *
   * A §40 say token is not a marker and is not cut here: `{{say:knott}}` happens to fit the ASCII
   * marker grammar, but it names no row, so it stays in its text run for `proseBlocks` to read.
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

  /** One paragraph with its outer whitespace gone, spans and all: a piece that trims away empty
   *  hands the trimming on to its neighbour, so a span that begins a paragraph starts at a word. */
  function trimPieces(pieces) {
    const kept = pieces.map(piece => ({ ...piece }));
    while (kept.length) {
      kept[0].text = kept[0].text.replace(/^\s+/, "");
      if (kept[0].text) break;
      kept.shift();
    }
    while (kept.length) {
      const last = kept[kept.length - 1];
      last.text = last.text.replace(/\s+$/, "");
      if (last.text) break;
      kept.pop();
    }
    return kept;
  }

  /**
   * One text run of the delivery, cut at its §40 say tokens and laid out as the keeper's paragraphs.
   *
   * `state` belongs to the whole card and not to this run. A mechanics card drawn in the middle of
   * a spoken line leaves that span open, and the words on the far side of the card are still the
   * same person's, in the same colour — the kernel put the card where it happened, and a line does
   * not change mouths because a receipt landed inside it. An open span the delivery never closes
   * simply ends with the delivery.
   *
   * `state.spans` counts opens in text order, which is the order `speech[]` arrives in (§40.2), so
   * a span and its speaker are matched by position. Nothing here reads a name to decide anything.
   */
  function proseBlocks(chunk, key, state, speaker) {
    const pieces = [];
    let last = 0;
    SAY_TOKEN.lastIndex = 0;
    for (let match = SAY_TOKEN.exec(chunk); match; match = SAY_TOKEN.exec(chunk)) {
      pieces.push({ text: chunk.slice(last, match.index), span: state.span });
      if (match[1] === undefined) state.span = null;
      else {
        const name = match[1].trim();
        state.span = name ? { name, order: state.spans++ } : null;
      }
      last = match.index + match[0].length;
    }
    pieces.push({ text: chunk.slice(last), span: state.span });

    const paragraphs = [[]];
    for (const piece of pieces) {
      // The mechanics markers this card placed are already gone from these runs; a marker whose
      // row was not here, and anything else left in braces, goes now — §40.4: no brace reaches
      // the player, whatever it named.
      const parts = piece.text.replace(LOOSE_TOKEN, "").split(/\n{2,}/);
      for (let index = 0; index < parts.length; index += 1) {
        if (index) paragraphs.push([]);
        if (parts[index]) paragraphs[paragraphs.length - 1].push({ text: parts[index], span: piece.span });
      }
    }
    return paragraphs.map(trimPieces).filter(paragraph => paragraph.length)
      .map((paragraph, index) => h("p", { className: "coc-mech-para", key: `${key}:${index}` },
        paragraph.map((piece, at) => {
          if (!piece.span) return piece.text;
          const voice = speaker(piece.span);
          return h("span", {
            key: at,
            className: "coc-say",
            "data-who": voice.who,
            ...(voice.title ? { title: voice.title } : {}),
            ...(voice.ink ? { style: { "--coc-say-ink": voice.ink } } : {}),
          }, piece.text);
        })));
  }

  /**
   * The "?" and its fold under the Keeper's opening (docs/specs/opening-guidance.md §4). The words and
   * whether it starts open come with the delivery (`details.help`, decided and recorded by the
   * extension); this card only draws them and lets the player open or close. A React without hooks
   * (the tests' element factory) draws it fixed as told.
   */
  const useOpenState = typeof React.useState === "function" ? React.useState : (initial) => [initial, () => {}];
  function HelpFold({ help }) {
    const [open, setOpen] = useOpenState(help.open === true);
    return h("div", { className: "coc-mech-help", "data-testid": "opening-help" },
      h("button", { type: "button", className: "coc-mech-help-toggle", "aria-expanded": open, "aria-label": help.title, title: help.title, onClick: () => setOpen(!open) }, "?"),
      open
        ? h("div", { className: "coc-mech-help-fold", role: "region", "aria-label": help.title },
            h("h4", null, help.title),
            help.lines.map((line, index) => h("p", { key: index }, line)))
        : null);
  }
  const helpOf = (details) => {
    const help = isRecord(details.help) ? details.help : null;
    if (!help || typeof help.title !== "string" || !help.title.trim() || !Array.isArray(help.lines)) return null;
    const lines = help.lines.filter((line) => typeof line === "string" && line.trim());
    return lines.length ? { title: help.title.trim(), lines, open: help.open === true } : null;
  };

  /** @param {{content: string, details?: unknown}} props */
  return function DeliveryCard(props) {
    const details = isRecord(props.details) ? props.details : {};
    if (isRecord(details.coc_error)) return null; // the host's own error card is better than ours
    const help = helpOf(details);
    // Both come with the delivery: the chrome from the session's play language, the content
    // words from the kernel's glossary merged under the campaign's own projected lanes (§16.5,
    // §23). Neither is a table in this file.
    const glossary = isRecord(details.labels) ? details.labels : {};
    const term = (name) => (typeof glossary[name] === "string" && glossary[name]) || name;
    const t = (key, fallback) => word(details.ui, "mechanics", key, fallback);

    /**
     * Who a span belongs to, and what colour that makes it (§40.4).
     *
     * The card never reads a name to decide what kind of speaker it has: the `who` a `speech` row
     * carries says it by its own shape, and the anchor the hue hangs on is whatever that shape
     * holds — the NPC's graph handle, the investigator's id, or the label's own text. A delivery
     * recorded before §40, or a span past the end of `speech[]`, falls back to the name written in
     * the token, which is exactly what an unresolved speaker is: a label.
     */
    const speech = (Array.isArray(details.speech) ? details.speech : []).filter(isRecord);
    const speaker = (span) => {
      const row = isRecord(speech[span.order]) ? speech[span.order] : {};
      const who = isRecord(row.who) ? row.who : {};
      const npc = text(who.npc), investigator = text(who.investigator), label = text(who.label);
      const kind = npc ? "npc" : investigator ? "investigator" : "label";
      const name = text(who.name) || label || span.name;
      return { who: kind, title: term(name), ink: speakerInk(npc || investigator || label || span.name, kind) };
    };

    const prose = text(details.rendered_text);
    const all = (Array.isArray(details.mechanics) ? details.mechanics : []).filter(playerReads);
    const marked = text(details.marked_text);
    // §16.6: with a marked delivery this card draws the narration itself, because a row can only be
    // put where the sentence is by whoever holds both. The host folds away the plain copy.
    if (marked) {
      const { parts, unplaced } = splitDelivery(marked, all);
      // One open span for the whole delivery, and one running count of spans, because both cross
      // the cards that interrupt them (§40.4).
      const state = { span: null, spans: 0 };
      return h("div", { className: "coc-mech coc-mech-inline" },
        parts.map((part, index) => part.row
          ? h("div", { className: "coc-mech-here", key: `row:${index}` }, renderRow(part.row, t, term, index))
          : proseBlocks(part.text, `text:${index}`, state, speaker)),
        unplaced.length
          ? h("section", { className: "coc-mech-list", "aria-label": t("mechanics") },
              h("h2", { className: "coc-mech-cap" }, t("mechanics")),
              unplaced.map((row, i) => renderRow(row, t, term, `rest:${i}`)))
          : null,
        help ? h(HelpFold, { help }) : null);
    }

    const rows = all;
    // Nothing of ours to add: let the host draw its default card rather than an empty one.
    if (!prose && !rows.length && !help) return null;

    return h("div", { className: "coc-mech" },
      prose ? h("div", { className: "coc-mech-prose" }, prose) : null,
      help ? h(HelpFold, { help }) : null,
      rows.length
        ? h("section", { className: "coc-mech-list", "aria-label": t("mechanics") },
            h("h2", { className: "coc-mech-cap" }, t("mechanics")),
            groupRows(rows).map((group, index) => group.call && group.rows.length > 1
              // A settlement of one row needs no group chrome: the disc already wears the tone.
              ? h("div", {
                  key: `${group.call}:${index}`,
                  className: "coc-mech-settle",
                  style: { "--tone": FAMILY_TONE[group.family] || "var(--muted)" },
                },
                h("div", { className: "coc-mech-fam" }, familyLabel(group, t, term)),
                group.rows.map((row, i) => renderRow(row, t, term, i)))
              : group.rows.map((row, i) => renderRow(row, t, term, `${index}:${i}`))))
        : null);
  };
}
