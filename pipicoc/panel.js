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
 * THE CHROME IS DATA TOO (contract §23, 2026-09-09). This file keeps no word table: the `sheet`
 * answer carries `ui: {tag, words}` for the session's play language, read from
 * `content/ui/<tag>/<surface>.json`, and the panel looks a caption up by key. Before the first
 * answer it draws an ellipsis rather than a language; a key the surface lacks renders as the key,
 * because an identifier is a visible gap and another language's word is a silent one. Adding a
 * language is adding a directory, never a column here.
 */

const STYLE_ID = "pipicoc-sheet-style";
const CSS = `
/* The sidebar shares the chat card's dossier typography and host theme tokens. */
.coc-sheet{--coc-serif:ui-serif,"Songti SC","Noto Serif CJK SC",Georgia,serif;
  box-sizing:border-box;container-type:inline-size;display:flex;flex-direction:column;
  height:100%;min-height:0;min-width:0;overflow:auto;padding:16px 16px 28px;
  color:var(--text);font-size:13px;line-height:1.6;scrollbar-width:thin}
.coc-sheet>*{flex-shrink:0}
.coc-sheet-identity{--passport-ink:#33291f;--passport-muted:#776451;--passport-rule:#bda78b;
  position:relative;isolation:isolate;padding:6.2cqi 6.5cqi 7cqi 9.7cqi;min-height:94.65cqi;
  border:0;background:#eee2ce;color:var(--passport-ink);box-shadow:0 3px 12px #36231210}
/* One nine-slice backplate. The top slice contains the complete photo mount;
   only the unillustrated paper below pixel 950 extends with additional text. */
.coc-sheet-art{position:absolute;inset:0;z-index:0;pointer-events:none;box-sizing:border-box;
  border-style:solid;border-color:transparent;border-width:73.70054cqi 4.26687cqi 4.26687cqi 5.43057cqi;
  border-image-slice:950 55 55 70 fill;border-image-repeat:stretch}
.coc-sheet-avatar{position:absolute;z-index:1;pointer-events:none;left:11.64%;top:17.72cqi;
  width:32.59%;height:43.45cqi;display:block;object-fit:cover;filter:sepia(.28) saturate(.72) contrast(.92)}
.coc-sheet-seal{position:absolute;z-index:3;pointer-events:none;left:28.32%;top:51.75cqi;
  width:21.8cqi;height:auto;display:block}
.coc-sheet-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;
  position:relative;z-index:4;padding-bottom:0;border:0;margin-bottom:7cqi}
.coc-sheet-document-title{margin:0;min-width:0;font:600 13px/1.5 var(--coc-serif);
  letter-spacing:.07em;color:#80442f;overflow-wrap:anywhere}
.coc-sheet-era{flex:0 1 auto;min-width:0;font:500 14px/1.5 var(--coc-serif);
  color:var(--passport-muted);font-variant-numeric:tabular-nums;overflow-wrap:anywhere;text-align:end}
.coc-sheet-identity-body{position:relative;z-index:2;display:grid;grid-template-columns:minmax(0,44%) minmax(0,1fr);gap:14px;align-items:start}
.coc-sheet-portrait{min-width:0;min-height:55cqi;pointer-events:none}
/* Once an investigator exists the mount is a host control, like Refresh: click develops the photo. */
.coc-sheet-portrait-live{pointer-events:auto;cursor:pointer;position:relative;border:0;background:transparent;padding:0;font:inherit}
.coc-sheet-portrait-live:disabled{cursor:wait}
.coc-sheet-portrait-note{position:absolute;left:6%;right:6%;bottom:8%;padding:2px 4px;background:#eee2ceee;
  color:var(--passport-muted);font:500 11px/1.5 var(--coc-serif);text-align:center}
/* The invitation centers in the photograph's own box (the avatar geometry), never in the mount
   button's taller box; clicks pass through to the mount below. */
.coc-sheet-portrait-hint{position:absolute;z-index:2;pointer-events:none;left:11.64%;top:17.72cqi;
  width:32.59%;height:43.45cqi;display:flex;align-items:center;justify-content:center;
  padding:0 8%;box-sizing:border-box;color:var(--passport-muted);font:500 12px/1.8 var(--coc-serif);text-align:center}
.coc-sheet-record{min-width:0}
.coc-sheet-name{margin:0;min-width:0;color:var(--passport-ink);font:600 clamp(24px,7cqi,36px)/1.35 var(--coc-serif);
  letter-spacing:-.025em;overflow-wrap:anywhere}
.coc-sheet :focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.coc-sheet-tools{display:flex;justify-content:flex-end;margin:-4px 0 6px}
.coc-sheet-refresh{flex:none;display:inline-flex;align-items:center;gap:5px;border:0;border-radius:4px;background:transparent;
  color:var(--muted);padding:5px 4px;font:inherit;font-size:11px;cursor:pointer;min-height:30px}
.coc-sheet-refresh:hover{color:var(--accent);background:var(--surface)}
.coc-sheet-refresh:disabled{opacity:.5;cursor:default}
/* Record lines wrap with the document rather than assuming a caption's language or length. */
.coc-sheet-fields{margin:10px 0 0;display:grid;grid-template-columns:fit-content(42%) minmax(0,1fr);column-gap:10px}
.coc-sheet-field{display:contents}
.coc-sheet-field-key,.coc-sheet-field-val{padding:7px 0;border-bottom:1px solid #bda78b66;line-height:1.65}
.coc-sheet-field:last-child>*{border-bottom:0}
.coc-sheet-field-key{min-width:0;color:var(--passport-muted);font-size:11px;overflow-wrap:anywhere}
.coc-sheet-field-val{min-width:0;margin:0;color:var(--passport-ink);font-size:13px;overflow-wrap:anywhere}
.coc-sheet-tongues{display:grid;grid-template-columns:minmax(0,1fr) max-content;gap:5px 8px}
.coc-sheet-tongue{display:contents}
.coc-sheet-tongue-value{font-variant-numeric:tabular-nums;text-align:end}
.coc-sheet-concept{position:relative;z-index:4;margin:18px 0 0;padding-top:14px;border-top:1px solid var(--passport-rule);
  color:#65523f;font:13px/1.9 var(--coc-serif);overflow-wrap:anywhere}
@container(max-width:260px){.coc-sheet-identity-body{grid-template-columns:minmax(0,1fr)}
  .coc-sheet-head{gap:8px}.coc-sheet-name{font-size:25px}
  .coc-sheet-document-title,.coc-sheet-era{font-size:11px;line-height:1.3}}
.coc-sheet-note{margin:10px 0;color:var(--muted);line-height:1.65;font-size:12px}
.coc-sheet-section{margin:24px 0 0;min-width:0}
/* The jump rail: one quiet tab per rendered section, so nothing below the fold needs a
   scroll. No pills -- a hairline under the row carries it, the accent underlines the tab
   it points at. */
.coc-sheet-nav{display:flex;flex-wrap:wrap;gap:2px 14px;margin:0 0 16px;
  border-bottom:1px solid var(--border)}
.coc-sheet-nav-chip{position:relative;display:inline-flex;align-items:center;gap:5px;
  padding:6px 2px 8px;border:0;border-radius:0;background:transparent;color:var(--muted);
  font:inherit;font-size:12px;font-weight:500;letter-spacing:.02em;line-height:1.4;cursor:pointer}
.coc-sheet-nav-chip .coc-icon{width:12px;height:12px;opacity:.8}
.coc-sheet-nav-chip::after{content:"";position:absolute;left:0;right:0;bottom:-1px;height:2px;
  border-radius:2px;background:var(--accent);transform:scaleX(0);transform-origin:left;
  transition:transform .18s ease}
.coc-sheet-nav-chip:hover{color:var(--text-strong)}
.coc-sheet-nav-chip:hover::after{transform:scaleX(1)}
.coc-sheet-heading{display:flex;align-items:center;gap:10px;margin:0 0 12px;color:var(--muted);
  font-size:12px;font-weight:650;line-height:1.4;letter-spacing:.025em}
.coc-sheet-heading::after{content:"";flex:1;height:1px;background:var(--border)}
.coc-sheet-heading .coc-icon{width:13px;height:13px}
/* A glyph only restates the caption beside it: sized to the caption, hidden from screen readers. */
.coc-icon{flex:none;width:12px;height:12px;stroke:currentColor;stroke-width:2;fill:none;
  stroke-linecap:round;stroke-linejoin:round}
.coc-vitals{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.coc-vital{--tone:var(--muted);min-width:0;padding:11px 12px;border:1px solid var(--border);
  border-radius:9px;background:color-mix(in srgb,var(--tone) 5%,var(--surface-raised,var(--surface)))}
.coc-vital-key{display:flex;align-items:center;gap:5px;color:var(--muted);font-size:11px;line-height:1.4;margin-bottom:5px}
.coc-vital-key .coc-icon{color:var(--tone)}
.coc-vital-num{color:var(--text-strong);font:600 26px/1.2 var(--coc-serif);font-variant-numeric:tabular-nums}
.coc-vital-max{color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums;white-space:nowrap}
.coc-vital-track{margin-top:7px;height:4px;border-radius:4px;overflow:hidden;background:var(--border)}
.coc-vital-fill{height:100%;background:var(--tone);border-radius:inherit;transition:width .25s ease-out}
/* Three columns preserve the characteristic grouping at every sidebar width. */
.coc-chars{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}
.coc-char{min-width:0;border:1px solid var(--border);border-radius:8px;padding:10px;
  background:var(--surface-raised,var(--surface))}
.coc-char-key{display:flex;align-items:center;gap:4px;color:var(--muted);font-size:11px;line-height:1.4;overflow-wrap:anywhere}
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
/* An entry that carries more than its name -- a description, where it is kept, a parameter
   grid -- folds all of that behind the name line, as a clue folds behind its name: the list
   reads as a list, and one entry opens at a time. A bare entry stays a plain line, because
   there is nothing to open into. The paper button stays on the name line, so a fold never
   stands between the player and their own writing. */
.coc-inventory-fold{display:block}
.coc-inventory-fold>summary{cursor:pointer;list-style:none;border-radius:4px}
.coc-inventory-fold>summary::-webkit-details-marker{display:none}
.coc-inventory-trail{flex:none;display:inline-flex;align-items:baseline;gap:8px}
.coc-inventory-trail::after{content:"▸";color:var(--subtle);font-size:10px;transition:transform .12s ease}
.coc-inventory-fold[open] .coc-inventory-trail::after{transform:rotate(90deg)}
.coc-finance{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 16px}
.coc-finance .coc-line{display:block;min-width:0;padding:0 0 10px}
.coc-finance .coc-line-key{display:block;margin-bottom:4px;color:var(--muted);font-size:11px}
.coc-finance .coc-line-gap{display:none}
.coc-finance .coc-line-val{font-size:17px;overflow-wrap:anywhere}
.coc-finance .coc-line:last-child:nth-child(odd){grid-column:1/-1}
.coc-more{margin-top:10px;width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:7px;
  background:var(--surface-raised,var(--surface));color:var(--accent);font:inherit;font-size:12px;cursor:pointer}
.coc-more:hover{border-color:var(--accent)}
/* Where and when: the reading leads at a measured size — it is context, not a headline —
   and the table's bookkeeping follows as one quiet meta line. */
.coc-clock{color:var(--text-strong);font:500 16px/1.4 var(--coc-serif);font-variant-numeric:tabular-nums;letter-spacing:.012em}
.coc-standing-meta{margin-top:9px;display:flex;flex-wrap:wrap;gap:6px;align-items:baseline}
/* The table's bookkeeping reads as one quiet meta line: turn, scene and session are
   entries separated by hairlines, not badges. */
.coc-standing-item{display:inline-flex;gap:6px;align-items:baseline;min-width:0;padding:0}
.coc-standing-item+.coc-standing-item::before{content:"";align-self:center;flex:none;width:3px;
  height:3px;margin:0 8px 0 2px;border-radius:50%;background:var(--border-strong,var(--border))}
.coc-standing-key{color:var(--muted);font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase}
.coc-standing-val{min-width:0;color:var(--text-strong);font-size:12.5px;overflow-wrap:anywhere}
.coc-standing{margin-top:7px;display:flex;flex-direction:column;gap:4px}
.coc-standing-line{display:flex;gap:8px;align-items:baseline}
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
@media (prefers-reduced-motion:reduce){.coc-vital-fill{transition:none}}
`;

if (typeof document !== "undefined" && !document.getElementById(STYLE_ID)) {
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.append(style);
}

/**
 * A caption from the answer's own `ui` block: `ui.words[surface][key]`.
 *
 * A key the surface does not carry renders as `fallback`, and `fallback` defaults to the key
 * itself -- an identifier a player can report, never a word from a language they did not choose.
 */
function word(ui, surface, key, fallback) {
  const surfaces = isRecord(ui) && isRecord(ui.words) ? ui.words : {};
  const table = isRecord(surfaces[surface]) ? surfaces[surface] : {};
  return typeof table[key] === "string" ? table[key] : fallback === undefined ? key : fallback;
}

/**
 * A parameterised caption: `{name}` placeholders filled from `values`.
 *
 * The order and the punctuation around them belong to the caption, so a language that writes the
 * day before the month, or drops a separator, says so in its own file rather than here. A
 * placeholder `values` has no entry for stays as written: the same visible gap a missing key is.
 */
function fill(template, values) {
  return String(template).replace(/\{([A-Za-z0-9_]+)\}/g, (whole, name) =>
    Object.prototype.hasOwnProperty.call(values, name) ? text(values[name]) : whole);
}

/**
 * A `{code, message}` pair from an answer, or null when the answer reports no failure.
 *
 * The message never becomes a caption. It is English by contract (§23) -- written for the log, not
 * for a player reading a table in another language -- so it travels behind a fold instead.
 */
function failureOf(answer) {
  if (!isRecord(answer)) return null;
  if (isRecord(answer.error)) return { code: text(answer.error.code), message: text(answer.error.message) };
  // A host that still answers with a bare sentence: it is a message, and it stays one.
  const reason = text(answer.reason);
  return reason ? { code: "", message: reason } : null;
}

/** Skills worth showing before the player asks for the whole list. */
const SKILL_PREVIEW = 12;
/** The characteristics grid, in the order a sheet prints them. */
const CHARACTERISTIC_ORDER = ["STR", "CON", "SIZ", "DEX", "APP", "INT", "POW", "EDU", "LUCK"];
/** Derived values that are numbers or short words worth a cell. */
const DERIVED_ORDER = ["MOV", "DB", "BUILD"];

/**
 * One small stroke glyph per stable rules key, restating the caption it sits beside.
 *
 * A glyph keys off the machine name -- HP, STR, MOV -- never the localized word, because the
 * word is the table's language and the key is the contract (§23). A key with no glyph draws
 * none: a guessed icon is a wrong caption, a missing one is just text again. The paths are
 * plain 24x24 stroke geometry kept in this file, because an icon font or an image fetch would
 * make the sheet depend on an asset the host may not serve.
 */
const ICON_PATHS = {
  heart: ["M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z"],
  brain: ["M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z",
    "M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z",
    "M12 5v13"],
  sparkles: ["M12 4l1.8 4.95a2 2 0 0 0 1.25 1.25L20 12l-4.95 1.8a2 2 0 0 0-1.25 1.25L12 20l-1.8-4.95a2 2 0 0 0-1.25-1.25L4 12l4.95-1.8a2 2 0 0 0 1.25-1.25L12 4Z"],
  clover: ["M5.8 9a3.2 3.2 0 1 0 6.4 0 3.2 3.2 0 1 0-6.4 0Z", "M11.8 9a3.2 3.2 0 1 0 6.4 0 3.2 3.2 0 1 0-6.4 0Z",
    "M5.8 15a3.2 3.2 0 1 0 6.4 0 3.2 3.2 0 1 0-6.4 0Z", "M11.8 15a3.2 3.2 0 1 0 6.4 0 3.2 3.2 0 1 0-6.4 0Z",
    "M12 18.2c-.3 1.5-1.3 2.7-2.8 3.3"],
  dumbbell: ["M6.5 6.5v11", "M17.5 6.5v11", "M3.5 9.5v5", "M20.5 9.5v5", "M6.5 12h11"],
  shield: ["M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1Z"],
  expand: ["M15 3h6v6", "M9 21H3v-6", "M21 3l-7 7", "M3 21l7-7"],
  zap: ["M13 2 3 14h9l-1 8 10-12h-9l1-8Z"],
  smile: ["M3 12a9 9 0 1 0 18 0 9 9 0 1 0-18 0Z", "M8.5 14.5a4.5 4.5 0 0 0 7 0", "M9 9.5h.01", "M15 9.5h.01"],
  bulb: ["M15 14c.2-1 .7-1.7 1.5-2.5C17.5 10.6 18 9.3 18 8a6 6 0 0 0-12 0c0 1.3.5 2.6 1.5 3.5.8.8 1.3 1.5 1.5 2.5",
    "M9 18h6", "M10 22h4"],
  flame: ["M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"],
  book: ["M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2Z", "M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7Z"],
  wind: ["M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2", "M9.6 4.6A2 2 0 1 1 11 8H2", "M12.6 19.4A2 2 0 1 0 14 16H2"],
  sword: ["M14.5 17.5 3 6 3 3 6 3 17.5 14.5", "M13 19l6-6", "M16 16l4 4", "M19 21l2-2"],
  body: ["M8.8 7a3.2 3.2 0 1 0 6.4 0 3.2 3.2 0 1 0-6.4 0Z", "M5.5 21a6.5 6.5 0 0 1 13 0"],
  clock: ["M3 12a9 9 0 1 0 18 0 9 9 0 1 0-18 0Z", "M12 7v5l3.5 2"],
  pulse: ["M22 12h-4l-3 9L9 3l-3 9H2"],
  gauge: ["m12 14 4-4", "M3.34 19a10 10 0 1 1 17.32 0"],
  target: ["M3 12a9 9 0 1 0 18 0 9 9 0 1 0-18 0Z", "M7 12a5 5 0 1 0 10 0 5 5 0 1 0-10 0Z", "M11 12a1 1 0 1 0 2 0 1 1 0 1 0-2 0Z"],
  backpack: ["M4 10a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z",
    "M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2", "M9 22v-5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v5", "M9 6h6"],
  swords: ["M14.5 17.5 3 6 3 3 6 3 17.5 14.5", "M13 19l6-6", "M16 16l4 4", "M19 21l2-2",
    "M9.5 17.5 21 6 21 3 18 3 6.5 14.5", "M11 19l-6-6", "M8 16l-4 4", "M5 21l-2-2"],
  search: ["M3 11a8 8 0 1 0 16 0 8 8 0 1 0-16 0Z", "m21 21-4.3-4.3"],
  scroll: ["M19 17V5a2 2 0 0 0-2-2H4",
    "M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3"],
  landmark: ["M3 22h18", "M6 18v-7", "M10 18v-7", "M14 18v-7", "M18 18v-7", "M12 2l8 5H4l8-5Z"],
};
/** Which glyph each vital carries; luck has no bar and no cap, but it has a clover. */
const VITAL_ICON = { HP: "heart", SAN: "brain", MP: "sparkles", luck: "clover" };
/** Which glyph each known characteristic or derived cell carries; an unknown key draws none. */
const CHAR_ICON = { STR: "dumbbell", CON: "shield", SIZ: "expand", DEX: "zap", APP: "smile", INT: "bulb", POW: "flame", EDU: "book", MOV: "wind", DB: "sword", BUILD: "body" };

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
 * The clock the player reads is the one in the fiction: the date and hour it is now at the table.
 *
 * The kernel derives it (§23's `clock.at`) from what the module declared about when its story
 * opens plus the minutes the world has advanced, so it exists only for a book that said so. When
 * it does not, elapsed time is the whole truth the table has and the panel prints that instead —
 * inventing an hour for a module that never named one would be the panel writing fiction.
 */
function elapsed(minutes) {
  const total = Math.max(0, Math.floor(minutes));
  return { days: Math.floor(total / 1440), hours: Math.floor((total % 1440) / 60), minutes: total % 60 };
}

/**
 * `clock.at` split for the `at` caption, or null when it is absent or is not a local ISO stamp.
 *
 * Both readings of month and day travel: bare (`mo`, `d`) and zero-padded (`mo2`, `d2`). Which one
 * a date wears is the language's business, and its caption says so by naming one or the other. The
 * hour and minute are padded outright, because a clock reading 10:05 is not 10:5 in any language.
 */
function storyTime(at) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(text(at));
  if (!match) return null;
  return { y: Number(match[1]), mo: Number(match[2]), d: Number(match[3]),
           mo2: match[2], d2: match[3], hh: match[4], mm: match[5] };
}

/**
 * The languages an investigator holds: which tongue, and how much of it.
 *
 * A language is no longer only a number in the skill list. What an investigator understands, and
 * what they can say, decides how much of an NPC's speech reaches them (Natural NPC 1.1.0), so it
 * belongs in the header beside occupation and era rather than a line in the background or a row
 * among sixty skills.
 *
 * The two halves live apart on the sheet and are joined here: `own_language` is the required field
 * that names the tongue the investigator was raised in, and `Language (Own)` is how much of it they
 * hold. Every other language is a skill key, in the three shapes the catalog writes -- all three
 * are in shipped sheets: `Language (Other: English)`, a starter's inline `Language (Latin)`, and
 * `Language (Own: X)` for a card that names its own tongue in the key. This reads that shape and
 * nothing else: it never decides which words are languages, and it never translates the name it
 * finds -- that is `term`'s lane.
 */
function languageRows(sheet) {
  const rows = [];
  const own = text(isRecord(sheet) ? sheet.own_language : "");
  for (const [key, value] of Object.entries(isRecord(sheet) && isRecord(sheet.skills) ? sheet.skills : {})) {
    if (typeof key !== "string" || !key.startsWith("Language (") || !key.endsWith(")")) continue;
    const inside = key.slice("Language (".length, -1).trim();
    // `own_language` is the required field that says which tongue this is; the skill is its value.
    if (inside === "Own") rows.push({ key, own: true, name: own, value: numberOr(value, 0) });
    else if (inside.startsWith("Own:")) rows.push({ key, own: true, name: inside.slice("Own:".length).trim(), value: numberOr(value, 0) });
    else if (inside.startsWith("Other:")) rows.push({ key, own: false, name: inside.slice("Other:".length).trim(), value: numberOr(value, 0) });
    else if (inside) rows.push({ key, own: false, name: inside, value: numberOr(value, 0) });
  }
  // A card can name the tongue without carrying its skill row -- both shipped pregens do. The
  // tongue is still true, so it is shown; the number is simply the one thing the sheet does not say.
  if (own && !rows.some(row => row.own)) rows.push({ key: "", own: true, name: own, value: null });
  // The tongue they were raised in first, then the rest by how much of one they hold.
  return rows.sort((a, b) => Number(b.own) - Number(a.own)
    || numberOr(b.value, -1) - numberOr(a.value, -1) || a.name.localeCompare(b.name));
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

const PAPER_STYLE = `
.coc-paper-dialog{padding:0;width:min(720px,calc(100vw - 40px));height:min(760px,calc(100dvh - 56px));max-width:none;max-height:none;
 border:1px solid #c8b59b;border-radius:10px;background:#f5efdf;background-size:cover;color:#302720;box-shadow:0 24px 80px #160e0966;overflow:hidden}
.coc-paper-dialog::backdrop{background:#21181188;backdrop-filter:blur(3px)}
.coc-paper-shell{display:flex;flex-direction:column;height:100%;min-height:0}
.coc-paper-head{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;padding:28px 34px 16px}
.coc-paper-kicker{margin:0 0 8px;color:#796a58;font:11px/1.5 system-ui,sans-serif;letter-spacing:.13em}
.coc-paper-head h2{margin:0;font:600 25px/1.5 "Songti SC",Georgia,serif;overflow-wrap:anywhere}
.coc-paper-dialog button{font:13px/1.5 system-ui,sans-serif;cursor:pointer;border:1px solid #cdbb9f;border-radius:6px;padding:8px 12px;background:#f8f3e8;color:#5c4230}
.coc-paper-dialog button:hover:not(:disabled){background:#eee2ce}
.coc-paper-dialog button:focus-visible,.coc-paper-dialog textarea:focus-visible{outline:2px solid #a04b28;outline-offset:3px}
.coc-paper-dialog button:disabled{opacity:.45;cursor:default}
.coc-paper-close{flex:none}
.coc-paper-dialog textarea{display:block;flex:1;min-height:160px;resize:none;margin:2px 34px 18px;padding:16px 2px;border:0;border-top:1px solid #baaa8e66;
 background:transparent;color:inherit;font:17px/1.95 "Songti SC",Georgia,serif;letter-spacing:.015em;scrollbar-color:#bbaa8b transparent;box-sizing:border-box}
.coc-paper-dialog textarea::placeholder{color:#9b8b75;font-size:15px}
.coc-paper-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 28px 22px;border-top:1px solid #baaa8e66;flex-wrap:wrap}
.coc-paper-foot>div{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.coc-paper-status{font:11px/1.6 system-ui,sans-serif;color:#796a58}
.coc-paper-dialog .coc-paper-save{background:#8d482c;color:#fff7eb;border-color:#8d482c;padding-inline:22px}
.coc-paper-dialog .coc-paper-save:hover:not(:disabled){background:#74391f}
.coc-paper-message{padding:12px 34px;margin:0;font:13px/1.7 system-ui,sans-serif;color:#8d372a}
.coc-paper-message button{margin-inline-start:12px}
.coc-paper-dialog[data-renderer="plain"]{background:var(--surface-raised,#fff)!important;color:var(--text-strong,#222);border-color:var(--border,#ccc);background-image:none!important}
.coc-paper-dialog[data-renderer="plain"] textarea{font-family:inherit}
.coc-paper-dialog[data-renderer="plain"] .coc-paper-status,.coc-paper-dialog[data-renderer="plain"] .coc-paper-kicker{color:var(--muted,#666)}
.coc-paper-dialog[data-renderer="plain"] button{background:var(--surface-hover,#eee);color:var(--text-strong,#222);border-color:var(--border,#ccc)}
.coc-paper-dialog[data-renderer="plain"] .coc-paper-save{background:var(--accent,#8d482c);color:var(--bg,#fff)}
.coc-inventory-document{display:block;text-align:left;color:inherit;font:inherit;background:none;border:0;padding:0;cursor:pointer}
.coc-inventory-document:hover .coc-inventory-name{text-decoration:underline;text-underline-offset:4px}
.coc-inventory-document:focus-visible{outline:2px solid var(--accent);outline-offset:5px;border-radius:2px}
.coc-inventory-document small{display:block;margin-top:4px;font-size:11px;font-weight:400;color:var(--accent)}
@media(max-width:520px){.coc-paper-dialog{width:calc(100vw - 20px);height:calc(100dvh - 24px)}.coc-paper-head{padding:22px 20px 14px}.coc-paper-dialog textarea{margin-inline:20px}.coc-paper-foot{padding:14px 18px}.coc-paper-message{padding-inline:20px}}
@media(max-height:600px){.coc-paper-dialog textarea{min-height:64px}.coc-paper-head{padding-block:14px}.coc-paper-foot{padding-block:10px}}
`;

/** A native modal: the browser owns inertness, focus containment and focus restoration. */
export function createDocumentEditor(React) {
  const h = React.createElement;
  const {useState, useEffect, useRef} = React;
  return function DocumentEditor({api, name, actor, ui, onClose, onSaved}) {
    const t = (key) => word(ui, "paper", key);
    // A refusal shows its code's caption; the English message it carries goes behind the fold.
    const failed = (failure) => word(ui, "errors", text(failure && failure.code), word(ui, "errors", "unknown"));
    const dialog = useRef(null), input = useRef(null), generation = useRef(0), focused = useRef(false);
    const [value, setValue] = useState(null), [draft, setDraft] = useState("");
    // The failure is kept whole -- `{code, message}` -- because the caption comes from the code and
    // the message is only ever shown folded away.
    const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState(null);
    const [closing, setClosing] = useState(false);
    const [notice, setNotice] = useState("");
    const dirty = value && draft !== value.text;
    async function ready(response, current) {
      while (response?.ok && response.data?.pending) {
        await new Promise(resolve=>setTimeout(resolve,700));
        if (current !== generation.current) return null;
        response = await api.invoke("mods.document.view", {name, actor});
      }
      return response;
    }
    async function load(keepDraft = false) {
      const current = ++generation.current;
      setLoading(true); setError(null);
      try {
        const response = await ready(await api.invoke("mods.document.view", {name, actor}), current);
        if (current !== generation.current) return;
        if (!response?.ok) { setError(failureOf(response) || {code:"document_unavailable", message:""}); return; }
        setValue(response.data); if(!keepDraft)setDraft(response.data.text); setClosing(false);
        setNotice(keepDraft ? t("reloaded") : "");
      } catch (reason) { if (current === generation.current) setError({code:"", message:reason instanceof Error ? reason.message : String(reason)}); }
      finally { if (current === generation.current) setLoading(false); }
    }
    async function persist(action) {
      if (!value || busy) return;
      const current = generation.current;
      setBusy(true); setError(null); setNotice("");
      try {
        const response = await ready(await api.invoke("mods.document.apply", {name, actor, version:value.version, action,
          ...(action === "save" ? {text:draft} : {})}), current);
        if (current !== generation.current) return;
        if (!response?.ok) { setError(failureOf(response) || {code:"", message:""}); return; }
        setValue(response.data); setDraft(response.data.text); setClosing(false); onSaved?.();
        if (closing && action === "save") onClose();
      } catch (reason) { if (current === generation.current) setError({code:"", message:reason instanceof Error ? reason.message : String(reason)}); }
      finally { if (current === generation.current) setBusy(false); }
    }
    function close() {
      if (busy) return;
      if (dirty) setClosing(true); else onClose();
    }
    useEffect(() => {
      const element = dialog.current;
      if (element?.showModal) element.showModal(); else element?.setAttribute("open", "");
      return () => { generation.current++; if (element?.open && element.close) element.close(); };
    }, []);
    useEffect(() => { focused.current=false; void load(); return () => {generation.current++;}; }, [api,name,actor]);
    useEffect(() => { if (!loading && value && !focused.current) {input.current?.focus();focused.current=true;} }, [loading,value]);
    return h(React.Fragment, null, h("style", null, PAPER_STYLE),
      h("dialog", {ref:dialog, className:"coc-paper-dialog", "aria-label":value?.display_name || name, lang:value?.play_language || (isRecord(ui) ? text(ui.tag) : ""), "data-renderer":value?.editor?.renderer || "paper",
        style:value?.texture ? {backgroundImage:`url(${value.texture})`} : undefined,
        onCancel:event=>{event.preventDefault();close();},
        onClick:event=>{if(event.target===event.currentTarget)close();},
        onKeyDown:event=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==="s"){event.preventDefault();if(dirty)void persist("save");}}},
        h("div", {className:"coc-paper-shell"},
          h("header", {className:"coc-paper-head"}, h("div", null,
            h("p", {className:"coc-paper-kicker"}, t("title")), h("h2", null, value?.display_name || name)),
            h("button", {type:"button",className:"coc-paper-close",disabled:busy,onClick:close}, t("close"))),
          loading && h("p", {className:"coc-paper-message",role:"status"}, t("loading")),
          error && h("p", {className:"coc-paper-message",role:"alert"}, failed(error),
            h("button", {type:"button",disabled:busy,onClick:()=>void load(!!dirty)}, t("retry")),
            error.message ? h("details", null, h("summary", null, word(ui, "errors", "details")),
              h("p", null, error.message)) : null),
          notice && h("p",{className:"coc-paper-message",role:"status"},notice),
          h("textarea", {ref:input, "aria-label":t("body"), value:draft, placeholder:t("empty"), maxLength:64000,
            readOnly:loading||busy||!value, spellCheck:false, onChange:event=>{setDraft(event.target.value);setClosing(false);}}),
          closing && h("div", {className:"coc-paper-message",role:"status"}, t("unsaved"), " ",
            h("button", {type:"button",onClick:onClose}, t("discard")), " ",
            h("button", {type:"button",onClick:()=>setClosing(false)}, t("stay"))),
          h("footer", {className:"coc-paper-foot"},
            h("div", null, h("button", {type:"button",disabled:loading||busy||!value||(draft===value.original&&value.text===value.original),
              onClick:()=>void persist("reset")}, t("reset")), h("span", {className:"coc-paper-status"}, t("original"))),
            h("div", null, h("span", {className:"coc-paper-status",role:"status"}, loading?t("loading"):busy?t("saving"):dirty?t("dirty"):value?.text!==value?.original?t("altered"):t("clean")),
              h("button", {type:"button",className:"coc-paper-save",disabled:loading||busy||!dirty,onClick:()=>void persist("save")}, closing?t("saveClose"):t("save")))))));
  };
}

export function createComponent(React) {
  const { useCallback, useEffect, useState, useRef } = React;
  const h = React.createElement;
  const DocumentEditor = createDocumentEditor(React);

  /**
   * A decorative glyph restating its label, keyed by the stable rules key rather than the
   * localized word. `data-icon` names the glyph so a test can tell which one a cell drew
   * without parsing path data.
   */
  function Icon(props) {
    const paths = ICON_PATHS[props.name];
    if (!paths) return null;
    return h("svg", { className: "coc-icon", viewBox: "0 0 24 24", "aria-hidden": "true", focusable: "false", "data-icon": props.name },
      paths.map((d, index) => h("path", { key: index, d })));
  }

  /**
   * A titled block of the sheet. A section may name a glyph from ICON_PATHS that restates what
   * it is; the caption stays the surface's own word, and a section with no glyph just draws one.
   * An `anchor` marks the section findable: the jump rail is read off the rendered DOM, so a
   * section that chose not to render (no finance, no backstory) simply has no chip, and the
   * rail and the sheet can never disagree.
   */
  function Section(props) {
    const anchor = props.anchor
      ? { "data-anchor": props.anchor, "data-label": text(props.title), ...(props.icon ? { "data-icon": props.icon } : {}) }
      : {};
    return h("section", { className: "coc-sheet-section", ...anchor },
      h("h2", { className: "coc-sheet-heading" }, props.icon ? h(Icon, { name: props.icon }) : null, props.title),
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
    const { label, tone, current, max, icon } = props;
    const cap = typeof max === "number" && max > 0 ? max : undefined;
    const pct = cap ? Math.max(0, Math.min(100, (current / cap) * 100)) : 0;
    return h("div", { className: "coc-vital", style: { "--tone": tone }, title: label },
      h("span", { className: "coc-vital-key" }, icon ? h(Icon, { name: icon }) : null, label),
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
      items.push(h(Vital, { key: label, label: term(label), tone: VITAL_TONE[label], icon: VITAL_ICON[label], current, max: numberOr(derived[maxKey], undefined) }));
    }
    // Luck has no maximum on the sheet (§17.4), so it never grows a bar.
    const luck = numberOr(sheet.luck, undefined);
    if (luck !== undefined) items.push(h(Vital, { key: "luck", label: t("luck"), tone: VITAL_TONE.luck, icon: VITAL_ICON.luck, current: luck }));
    return items.length ? h(Section, { title: t("condition"), icon: "pulse", anchor: "condition" }, h("div", { className: "coc-vitals" }, items)) : null;
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
    return h(Section, { title: t("characteristics"), icon: "gauge", anchor: "characteristics" },
      h("div", { className: "coc-chars" }, entries.map(([key, value]) =>
        h("div", { className: "coc-char", key },
          h("span", { className: "coc-char-key", title: term(key) }, CHAR_ICON[key] ? h(Icon, { name: CHAR_ICON[key] }) : null, term(key)),
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
    return h(Section, { title: fill(t("skills"), { n: rows.length }), icon: "target", anchor: "skills" },
      h(Lines, { leader: true, rows: shown.map(row => ({ name: row.name, value: text(row.value), numeric: true })) }),
      rows.length > SKILL_PREVIEW
        ? h("button", {
            type: "button", className: "coc-more", "aria-expanded": expanded ? "true" : "false",
            onClick: () => setExpanded(v => !v),
          }, expanded ? t("showFewer") : fill(t("showAll"), { n: rows.length }))
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
      return props.empty ? h(Section, { title: props.title, icon: props.icon, anchor: props.anchor }, h("p", { className: "coc-sheet-note" }, props.empty)) : null;
    }
    const {t,term=value=>value}=props;
    const valueText=value=>typeof value==="boolean"?(value?t("itemYes"):t("itemNo")):Array.isArray(value)?value.map(valueText).join(" / "):term(text(value));
    return h(Section, { title: props.title, icon: props.icon, anchor: props.anchor },
      h("ul",{className:"coc-inventory"},list.map((item,index)=>{
        const name=isRecord(item)?text(item.name):text(item);
        const object=(props.objects || []).find(row=>row.name===name);
        const writable=(props.documents || props.objects || []).find(row=>row.document&&row.name===name);
        const merged=object&&isRecord(item)?{...item,...object.parameters,...(object.state?.ammo!==null&&object.state?.ammo!==undefined?{ammo:object.state.ammo}:{})}:item;
        const line=itemLine(merged,term);
        // A definition's public view carries its description as prose and, when `description` is
        // also among its player fields, once more as a parameter. The prose is printed; the
        // parameter only stays when it says something the prose does not.
        const description=object?.description?text(object.description):"";
        if(description)line.details=line.details.filter(({key,value})=>key!=="description"||text(value)!==description);
        if(object){
          for(const trait of object.traits || []) line.details.push({key:`trait:${trait.name}`,label:term(trait.name),value:`${term(text(trait.value))}${trait.unit?' '+term(trait.unit):''}`});
          for(const key of ['condition','charges']) if(object.state?.[key]!==null&&object.state?.[key]!==undefined) line.details.push({key,value:object.state[key]});
        }
        const nameNode=writable && props.onOpenDocument
          ? h("button",{type:"button",className:"coc-inventory-document",onClick:event=>{
              // On a folded line the paper's own click must not also toggle the fold.
              event.preventDefault();props.onOpenDocument(writable.name);}},
              h("span",{className:"coc-inventory-name"},line.title),h("small",null,props.paperLabel))
          : h("span",{className:"coc-inventory-name"},line.title);
        const quantity=line.quantity!==undefined?h("span",{className:"coc-inventory-quantity"},fill(t("quantity"),{n:line.quantity})):null;
        const body=[
          description?h("p",{className:"coc-sheet-note",style:{margin:"6px 0"},key:"description"},description):null,
          writable?.container?h("p",{className:"coc-sheet-note",key:"container"},props.insideLabel," ",term(writable.container)):null,
          line.details.length?h("dl",{className:"coc-inventory-params",key:"params"},line.details.map(({key,label,value,wide})=>
            h("div",{key,className:wide?"coc-inventory-wide":undefined},h("dt",null,label||t(`item.${key}`,term(key))),h("dd",null,valueText(value))))):null,
        ].filter(Boolean);
        // Keyed by name so an entry that changes place is drawn afresh (closed) rather than
        // inheriting the open fold of whatever stood at its index before.
        return h("li",{className:"coc-inventory-entry",key:`${line.title}:${index}`,"data-detailed":line.details.length>0?"true":"false"},
          body.length
            ? h("details",{className:"coc-inventory-fold"},
                h("summary",{className:"coc-inventory-heading"},nameNode,h("span",{className:"coc-inventory-trail"},quantity)),
                h("div",{className:"coc-inventory-body"},body))
            : h("div",{className:"coc-inventory-heading"},nameNode,quantity));
      })));
  }

  function Finance(props) {
    const { sheet, t, term = value => value } = props;
    const finance = isRecord(sheet.finance) ? sheet.finance : {};
    const rows = [];
    if (sheet.cash !== undefined || finance.cash !== undefined) {
      rows.push({ name: t("cash"), value: finance.cash ? money(finance.cash, term) : text(sheet.cash), numeric: true });
    }
    if (finance.assets !== undefined) rows.push({ name: t("assets"), value: money(finance.assets, term), numeric: true });
    if (finance.spending_level !== undefined) {
      rows.push({ name: t("spending"), value: money(finance.spending_level, term), numeric: true });
    }
    const creditRating = sheet.credit_rating !== undefined ? sheet.credit_rating : finance.credit_rating;
    if (creditRating !== undefined) rows.push({ name: t("creditRating"), value: text(creditRating), numeric: true });
    if (finance.living_standard !== undefined) rows.push({ name: t("livingStandard"), value: term(text(finance.living_standard)) });
    return rows.length ? h(Section, { title: t("finance"), icon: "landmark", anchor: "finance" }, h(Lines, { kind: "finance", rows })) : null;
  }

  /** The investigator's own history: what the sheet's backstory carries, in the play language. */
  function Background(props) {
    const {sheet,term,t}=props;
    const rows=Object.entries(isRecord(sheet.backstory)?sheet.backstory:{})
      .filter(([key,value])=>key!=="concept"&&typeof value==="string"&&value.trim());
    // The native tongue now rides in the header beside the rest of the languages, with its value.
    if(isRecord(sheet.key_connection)&&sheet.key_connection.summary)rows.push([t("keyConnection"),text(sheet.key_connection.summary)]);
    if(!rows.length)return null;
    return h(Section,{title:t("background"),icon:"scroll",anchor:"background"},h("dl",{className:"coc-background"},rows.map(([key,value])=>
      h("div",{key,"data-field":key},h("dt",null,term(key)),h("dd",null,term(value))))));
  }

  /** Where and when the table stands: the old panel's time tab, now with the module's own clock. */
  function Standing(props) {
    const { view, t } = props;
    const names = isRecord(view.standing_labels) ? view.standing_labels : {};
    const display = value => text(names[value]) || "…";
    const clock = isRecord(view.clock) ? view.clock : {};
    const minutes = numberOr(clock.minutes, undefined);
    const scene = isRecord(view.scene) ? view.scene : {};
    const session = isRecord(view.session) ? view.session : null;
    const lines = [];
    if (view.turn !== undefined && view.turn !== null) lines.push({ key: t("turnKey"), value: text(view.turn) });
    if (scene.display_name || scene.name) lines.push({ key: t("sceneKey"), value: display(scene.display_name || scene.name) });
    // Canonical NPC names may reveal a concealed identity; introductions belong to the Keeper.
    if (session) lines.push({ key: t("sessionKey"), value: session.round
      ? fill(t("session.round"), { kind: display(session.kind), round: session.round })
      : fill(t("session"), { kind: display(session.kind) }), live: true });
    if (view.pending_choice) lines.push({ key: "", value: t("awaitingChoice"), live: true });
    const meta = lines.filter(line => !line.live);
    const live = lines.filter(line => line.live);
    const at = storyTime(clock.at);
    if (at === null && minutes === undefined && !lines.length) return null;
    const span = minutes === undefined ? null : elapsed(minutes);
    const reading = at ? fill(t("at"), at)
      : span ? fill(t(span.days > 0 ? "elapsed.dhm" : span.hours > 0 ? "elapsed.hm" : "elapsed.m"),
          { d: span.days, hh: span.hours, mm: span.minutes })
      : null;
    return h(Section, { title: t("time"), icon: "clock", anchor: "time" },
      reading ? h("div", { className: "coc-clock" }, reading) : null,
      meta.length
        ? h("div", { className: "coc-standing-meta" }, meta.map((line, index) =>
            h("span", { className: "coc-standing-item", key: `meta${index}` },
              line.key ? h("span", { className: "coc-standing-key" }, line.key) : null,
              h("span", { className: "coc-standing-val" }, line.value))))
        : null,
      live.length
        ? h("div", { className: "coc-standing" }, live.map((line, index) =>
            h("div", { className: "coc-standing-line", "data-live": "1", key: index },
              line.key ? h("span", { className: "coc-standing-key" }, line.key) : null,
              h("span", { className: "coc-standing-val" }, line.value))))
        : null);
  }

  /** Found clues, plus what this scene still has on offer — the old panel's clues section. */
  function Clues(props) {
    const { view, t, term = value => value } = props;
    const clues = isRecord(view.clues) ? view.clues : {};
    const discovered = Array.isArray(clues.discovered) ? clues.discovered : [];
    const here = Array.isArray(clues.here) ? clues.here : [];
    // A clue the scene offers but nobody has found is the Keeper's business, not the player's:
    // only the ones already marked discovered are named.
    const foundHere = here.filter(clue => isRecord(clue) && clue.discovered === true);
    if (!discovered.length && !foundHere.length) {
      return h(Section, { title: t("clues"), icon: "search", anchor: "clues" }, h("p", { className: "coc-sheet-note" }, t("noClues")));
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
    return h(Section, { title: t("clues"), icon: "search", anchor: "clues" }, rows.map((row, index) =>
      row.summary
        // The name stays on the line; what the clue says is one tap away. Both go through the
        // glossary: the Keeper's own label comes back as itself, a graph name or the book's
        // summary comes back in the play language once the clue lane has projected it.
        ? h("details", { className: "coc-clue coc-clue-fold", key: `${row.name}:${index}` },
            h("summary", null, h("span", { className: "coc-clue-name" }, term(row.name))),
            h("div", { className: "coc-clue-body" }, term(row.summary)))
        : h("div", { className: "coc-clue", key: `${row.name}:${index}` },
            h("span", { className: "coc-clue-name" }, term(row.name)))));
  }

  /**
   * The people the investigators have met, as the table's NPC journal projects them (§17.10's
   * `npcs.journal`). The description and the exchange summary are the journal lane's own prose,
   * written in the play language, and are drawn as they arrive. The name and the scene stamped on
   * an exchange are not: the lane must copy a recordable name exactly and the kernel stamps the
   * scene's display name at the turn it happened, so both are the module graph's words and both go
   * through the glossary, where the journal lane has projected them. Turn numbers are machine
   * context and stay off the page. A dead mark rests next to the name when the ledger closed.
   */
  function Npcs(props) {
    const { view, t, term = value => value } = props;
    const npcs = isRecord(view.npcs) ? view.npcs : {};
    const journal = Array.isArray(npcs.journal) ? npcs.journal.filter(isRecord) : [];
    if (!journal.length) {
      return h(Section, { title: t("npcs"), icon: "body", anchor: "npcs" }, h("p", { className: "coc-sheet-note" }, t("noNpcs")));
    }
    return h(Section, { title: t("npcs"), icon: "body", anchor: "npcs" }, journal.map((npc, index) => {
      const name = term(text(npc.name));
      const dead = npc.dead_since_turn !== null && npc.dead_since_turn !== undefined;
      const exchanges = Array.isArray(npc.exchanges) ? npc.exchanges.filter(isRecord) : [];
      return h("details", { className: "coc-clue coc-clue-fold coc-npc", key: `${name}:${index}`, ...(dead ? { "data-dead": "1" } : {}) },
        h("summary", null,
          h("span", { className: "coc-clue-name" }, name),
          dead ? h("span", { className: "coc-npc-dead", "aria-hidden": "true" }, "\u2020") : null),
        h("div", { className: "coc-clue-body" },
          text(npc.description) ? h("p", { className: "coc-npc-description" }, text(npc.description)) : null,
          exchanges.map((exchange, line) =>
            h("div", { className: "coc-npc-exchange", key: line },
              text(exchange.scene) ? h("span", { className: "coc-npc-exchange-scene" }, term(text(exchange.scene))) : null,
              text(exchange.summary)))));
    }));
  }

  /** @param {{api: {invoke?: Function, subscribeExt?: Function}}} props */
  return function InvestigatorPanel(props) {
    const api = props.api || {};
    const [answer, setAnswer] = useState(undefined);
    const generation = useRef(0);
    useEffect(() => () => { generation.current++; }, []);
    const [busy, setBusy] = useState(false);
    const [portraitBusy, setPortraitBusy] = useState(false);
    const [portraitNote, setPortraitNote] = useState(null);
    const portraitNoteTimer = useRef(null);
    useEffect(() => () => clearTimeout(portraitNoteTimer.current), []);
    const [who, setWho] = useState(0);
    const [documentTarget, setDocumentTarget] = useState(null);
    // The jump rail's chips are read off the rendered sheet, never computed from the data: a
    // section that chose not to render has no chip, so the rail can never point at nothing.
    const sheetRoot = useRef(null);
    const identityArt = useRef(null);
    const [railAnchors, setRailAnchors] = useState([]);
    useEffect(()=>setDocumentTarget(null),[api]);
    useEffect(()=>{if(answer?.campaign&&documentTarget&&answer.campaign!==documentTarget.campaign)setDocumentTarget(null);},[answer?.campaign]);
    // The words of the last answer that actually arrived, kept so the chrome of a failure this
    // panel raised itself stays in the language the player was reading a moment ago.
    const [lastUi, setLastUi] = useState(null);

    const load = useCallback(async (retryProjection = false) => {
      const request = ++generation.current;
      if (!api.invoke) {
        setAnswer({ view: null, campaign: null, status: "error",
          error: { code: "pack_unreachable", message: "this host cannot reach the pack" } });
        return;
      }
      setBusy(true);
      try {
        const result = await api.invoke("sheet", {
          ...(retryProjection ? {retry_projection:true} : {}),
          ...(!identityArt.current ? {include_identity_art:true} : {}),
        });
        if(request !== generation.current) return;
        if (result && result.ok === true && isRecord(result.data)) {
          if (isRecord(result.data.identity_art)) identityArt.current = result.data.identity_art;
          setAnswer(result.data);
          if (isRecord(result.data.ui)) setLastUi(result.data.ui);
        }
        else {
          setAnswer({ view: null, campaign: null, status: "error",
            error: failureOf(result) || { code: "pack_silent", message: "the pack did not answer" } });
        }
      } catch (error) {
        if(request !== generation.current) return;
        setAnswer({ view: null, campaign: null, status: "error",
          error: { code: "", message: error instanceof Error ? error.message : String(error) } });
      } finally {
        if(request === generation.current) setBusy(false);
      }
    }, [api]);

    useEffect(() => { void load(); }, [load]);

    useEffect(() => {
      const el = sheetRoot.current;
      if (!el) { setRailAnchors([]); return; }
      setRailAnchors(Array.from(el.querySelectorAll("[data-anchor]")).map(node => ({
        id: node.getAttribute("data-anchor"),
        icon: node.getAttribute("data-icon"),
        label: node.getAttribute("data-label") || "",
      })));
    }, [answer, who]);

    // The agent half pushes on every committed turn; any event from this pack means re-read.
    // The push carries no payload, so a shape change upstream can never desynchronise the panel.
    useEffect(() => {
      if (!api.subscribeExt) return undefined;
      const unsubscribe = api.subscribeExt(() => { void load(); });
      return typeof unsubscribe === "function" ? unsubscribe : undefined;
    }, [api, load]);

    // A failure this panel raised carries no words of its own. The last block it actually saw is
    // the table the player is sitting at, so an error's chrome stays in the language the sheet was
    // in a moment ago rather than snapping to whichever language shipped first.
    const ui = (isRecord(answer) && isRecord(answer.ui) && answer.ui) || lastUi;
    const t = (key, fallback) => word(ui, "sheet", key, fallback);
    const documentWindow = documentTarget ? h(DocumentEditor,{key:"document-editor",...documentTarget,api,ui,
      onClose:()=>setDocumentTarget(null),onSaved:()=>{void load();}}) : null;

    // Clicking the photo mount asks the host lane for a portrait (contract §22.7): a host control,
    // no turn and no receipt. A refusal leaves the mount empty and says so, briefly.
    const generatePortrait = useCallback(async () => {
      if (!api.invoke) return;
      setPortraitBusy(true);
      setPortraitNote(null);
      clearTimeout(portraitNoteTimer.current);
      try {
        const result = await api.invoke("sheet", {portrait:"generate"});
        const data = result && result.ok === true && isRecord(result.data) ? result.data : null;
        if (data && data.status !== "error" && isRecord(data.identity_art)) {
          identityArt.current = {...(identityArt.current || {}), ...data.identity_art};
          setAnswer(data);
          if (isRecord(data.ui)) setLastUi(data.ui);
        } else {
          const code = data && typeof data.code === "string" ? data.code : "";
          // The caption stays a projected word (contract §23); the lane's English reason is
          // diagnostic, so it goes to the console rather than dying with the answer.
          try { console.debug("coc-sheet: portrait generation failed:", data && data.reason ? data.reason : data); } catch {}
          setPortraitNote(code === "portrait_no_description" ? t("portraitNoDescription")
            : code === "portrait_no_model" ? t("portraitHint") : t("portraitFailed"));
          portraitNoteTimer.current = setTimeout(() => setPortraitNote(null), 5000);
        }
      } catch {
        setPortraitNote(t("portraitFailed"));
        portraitNoteTimer.current = setTimeout(() => setPortraitNote(null), 5000);
      } finally {
        setPortraitBusy(false);
      }
    }, [api, t]);
    if (answer === undefined) {
      // No answer, so no words: an ellipsis, never a caption in a language nobody chose.
      return h("div", { className: "coc-sheet" },
        documentWindow,
        h("p", { className: "coc-sheet-note", role: "status" }, "…"));
    }

    const view = isRecord(answer.view) ? answer.view : null;
    const party = view && Array.isArray(view.investigators) ? view.investigators.filter(isRecord) : [];
    const sheet = party[Math.min(who, Math.max(0, party.length - 1))] || null;
    // The play language's word for a rules term, straight from the rules data (§16.5). No table here.
    const glossary = view && isRecord(view.labels) ? view.labels : {};
    const term = (name) => (typeof glossary[name] === "string" && glossary[name]) || name;

    const refresh = h("div", { className: "coc-sheet-tools" },
      h("button", { type: "button", className: "coc-sheet-refresh", onClick: () => { void load(true); }, disabled: busy },
        busy ? t("refreshing") : t("refresh")));

    if (!view) {
      // Three different "no sheet" states, and the player is owed which one it is: a session that
      // was never bound to a table, a read that failed, or a table that has no party yet. Every
      // word comes from the answer's own `ui` block -- a literal here would be a language rule
      // nobody could see. A failure names its code; its English message stays behind a fold.
      const failure = failureOf(answer);
      const status = answer.status || (failure ? "error" : "empty");
      const title = status === "unbound" ? t("unboundTitle") : status === "error" ? t("errorTitle") : t("noTableTitle");
      const detail = status === "unbound" ? t("unboundDetail")
        : status === "error" ? word(ui, "errors", failure ? failure.code : "", word(ui, "errors", "unknown"))
        : t("noTable");
      // The landmark's name is the host's own panel title. There is no literal behind it: a word
      // written here would be one language's, and this file may not choose one (§23). The manifest
      // cannot yet carry a title per language, so an unnamed region is the honest state until it can.
      return h("div", { className: "coc-sheet", role: "region", ...(props.title ? { "aria-label": props.title } : {}) },
        documentWindow,
        h("h2", null, title), h("p", { className: "coc-sheet-note", role: "status" }, detail),
        status === "error" && failure && failure.message
          ? h("details", { className: "coc-sheet-note" },
              h("summary", null, word(ui, "errors", "details")), h("p", null, failure.message))
          : null,
        h("button", { type: "button", onClick: () => { void load(true); }, disabled: busy }, busy ? t("loading") : t("retry")));
    }

    // The header of a printed sheet: labelled rules, not a run-on line of values.
    const fields = [];
    if (sheet) {
      if (sheet.occupation) fields.push([t("occupation"), term(text(sheet.occupation))]);
      if (sheet.age !== undefined) fields.push([t("ageKey"), text(sheet.age)]);
      // Sex is the player's own word for it (an open field the setup model drafts), looked up in
      // the glossary like a clue's name: the identity lane projects it per play language, and the
      // row falls back to the sheet's own word until the projection lands. Absent from old cards.
      if (sheet.sex) fields.push([t("sexKey"), term(text(sheet.sex))]);
      const tongues = languageRows(sheet);
      if (tongues.length) fields.push([t("language"),
        h("span", {className:"coc-sheet-tongues"}, tongues.map((language,index) =>
          h("span", {className:"coc-sheet-tongue", key:index},
            h("bdi", {className:"coc-sheet-tongue-name"}, term(language.name)),
            h("bdi", {className:"coc-sheet-tongue-value"}, language.value === null ? "" : text(language.value)))))]);
    }
    const concept = sheet && isRecord(sheet.backstory) ? term(text(sheet.backstory.concept)) : "";
    // Canonical numeric era notation only, not a language detector or a guessed issue date.
    //
    // `sheet.era` is a rulebook table key, and §23.4 lets it stand in for a setting the rulebook
    // never tabulated: a book set in 1895 builds its card off the `1920s` finance column and says
    // so in `sheet.setting_era`. That substitution is an accounting fact about the money, so a
    // credential headed `1920` beside a panel whose clock reads 25 January 1895 tells the player
    // their own document is from the wrong century. Where the sheet admits the key is a stand-in, the
    // dateline comes from `clock.at` instead — the kernel's own in-world stamp, canonical ISO, so
    // nothing here reads the authored era sentence, which the contract forbids interpreting by
    // string matching. A table with no clock keeps the authored setting in the book's own words.
    const era = text(sheet?.era);
    const settingEra = text(sheet?.setting_era);
    const standing = storyTime(isRecord(view?.clock) ? view.clock.at : null);
    const eraMark = settingEra
      ? (standing ? String(standing.y) : term(settingEra))
      : (/^(\d{4})s?$/.exec(era)?.[1] || term(era));
    const art = identityArt.current || {};

    return h("div", { className: "coc-sheet", role: "region", ref: sheetRoot, ...(props.title ? { "aria-label": props.title } : {}) },
      railAnchors.length > 1
        ? h("nav", { className: "coc-sheet-nav", "aria-label": t("sections") }, railAnchors.map(entry =>
            h("button", { type: "button", className: "coc-sheet-nav-chip", key: entry.id,
              onClick: () => {
                const target = sheetRoot.current && sheetRoot.current.querySelector(`[data-anchor="${entry.id}"]`);
                if (target && typeof target.scrollIntoView === "function") target.scrollIntoView({ behavior: "smooth", block: "start" });
              } },
              entry.icon ? h(Icon, { name: entry.icon }) : null, entry.label)))
        : null,
      refresh,
      h("article", {className:"coc-sheet-identity", lang:ui?.tag},
        art.backplate ? h("div", {className:"coc-sheet-art", "aria-hidden":true,
          style:{borderImageSource:`url(${art.backplate})`}}) : null,
        art.portrait ? h("img", {className:"coc-sheet-avatar", src:art.portrait, alt:"", "aria-hidden":true,
          draggable:false}) : null,
        sheet && art.seal ? h("img", {className:"coc-sheet-seal", src:art.seal, alt:"", width:281, height:279,
          "aria-hidden":true, draggable:false}) : null,
        sheet && !art.portrait && !portraitBusy && !portraitNote
          ? h("div", {className:"coc-sheet-portrait-hint", "aria-hidden":true}, t("portraitCta")) : null,
        h("header", {className:"coc-sheet-head"},
          h("p", {className:"coc-sheet-document-title", dir:"auto"}, t("identityTitle")),
          eraMark ? h("span", {className:"coc-sheet-era", dir:"auto"}, eraMark) : null),
        h("div", {className:"coc-sheet-identity-body"},
          sheet && !art.portrait
            ? h("button", {type:"button", className:"coc-sheet-portrait coc-sheet-portrait-live",
                "aria-label":t("portraitGenerate"), disabled:portraitBusy,
                onClick:()=>{void generatePortrait();}},
                portraitBusy || portraitNote ? h("span", {className:"coc-sheet-portrait-note"},
                  portraitBusy ? t("portraitBusy") : portraitNote) : null)
            : h("div", {className:"coc-sheet-portrait", "aria-hidden":true}),
          h("div", {className:"coc-sheet-record"},
            h("h2", {className:"coc-sheet-name", dir:"auto"}, sheet ? text(sheet.name) || text(sheet.id) : t("noInvestigator")),
            fields.length ? h("dl", {className:"coc-sheet-fields"}, fields.map(([key,value],index) =>
              h("div", {className:"coc-sheet-field", key:index},
                h("dt", {className:"coc-sheet-field-key", dir:"auto"}, key),
                h("dd", {className:"coc-sheet-field-val", dir:"auto"}, value)))) : null)),
        concept ? h("p", {className:"coc-sheet-concept", dir:"auto"}, concept) : null),
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
      documentWindow,
      h("style",null,PAPER_STYLE),
      sheet ? h(ItemSection, { title: t("weapons"), icon: "swords", anchor: "weapons", list: sheet.weapons, objects:(sheet.objects || []).filter(item=>item.category==="weapon"), t, term,
        documents:sheet.objects, insideLabel:word(ui,"paper","inside"), paperLabel:word(ui,"paper","open"),
        onOpenDocument:name=>setDocumentTarget({name,actor:sheet.id,campaign:answer.campaign}) }) : null,
      sheet && view.presentation_status ? h(Section,{title:t("equipment"),icon:"backpack",anchor:"equipment"},
        h("p",{className:"coc-sheet-note",role:"status"},view.presentation_status==="failed"?t("errorDetail"):t("loading")),
        view.presentation_status==="failed"?h("button",{type:"button",onClick:()=>{void load(true);}},t("retry")):null) :
      // A carried gun is both: a combat profile in `weapons` and an inventory row in `equipment`, which
      // is right in the data and wrong on the page -- a live sheet drew the same pistol in the weapons
      // box and again in the inventory one. An object with a combat profile is drawn where that profile
      // lives, once.
      sheet ? h(ItemSection, { title: t("equipment"), icon: "backpack", anchor: "equipment", list: (sheet.equipment || []).filter(item => !view.finance_equipment?.includes(item)
        && !(item && item.object_id && (sheet.weapons || []).some(weapon => weapon && weapon.object_id === item.object_id))), objects:(sheet.objects || []).filter(item=>item.category!=="weapon"), empty: t("noEquipment"), t, term,
        documents:sheet.objects, insideLabel:word(ui,"paper","inside"), paperLabel:word(ui,"paper","open"),
        onOpenDocument:name=>setDocumentTarget({name,actor:sheet.id,campaign:answer.campaign}) }) : null,
      sheet ? h(Finance, { sheet, t, term }) : null,
      sheet ? h(Background, { sheet, term, t }) : null,

      h(Clues, { view, t, term }),
      h(Npcs, { view, t, term }));
  };
}
