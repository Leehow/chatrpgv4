/**
 * The case board: what this table already knows (contract §39.3, §23).
 *
 * The right rail's third panel, and one subject in three sections: the maps this table has been
 * shown, the clues it has found, and the people it has met. Clues and people come from
 * `table.view` (§23) -- the same player-safe projection the investigator sheet draws -- so this
 * file is a view of an existing answer and not a second source of truth. The maps come from the
 * pack's `board` invoke, which reads `table.maps` (§39.3) on the host side, composes the pixels
 * there, and hands over nothing but flattened attachments: a source path, a placement box and a
 * redaction box never reach this file, which is why it can draw a map at all.
 *
 * That is also why the clues and the people moved here. The sheet is one credential and one body;
 * neither a kept floor plan nor the list of who was met is a row on either, and a table's memory
 * of its own investigation is the one thing a player comes back to read. Nothing was rewritten in
 * the move: the same words, the same fold, the same speaker legend as the delivery card's spoken
 * lines (§40.4).
 *
 * No arithmetic and no rules live here. Every caption comes from `ui.words.board`, the error
 * caption from the shared `errors` surface (§23), and every module-authored name goes through the
 * glossary the answer carries. The one host call besides the board read is a pictured handout's
 * translate control (§155), whose captions are the `handout` surface's.
 */

const STYLE_ID = "pipicoc-board-style";
const CSS = `
.coc-board{--coc-serif:ui-serif,"Songti SC","Noto Serif CJK SC",Georgia,serif;
  box-sizing:border-box;container-type:inline-size;display:flex;flex-direction:column;
  height:100%;min-height:0;min-width:0;overflow:auto;padding:16px 16px 28px;
  color:var(--text);font-size:13px;line-height:1.6;scrollbar-width:thin}
.coc-board>*{flex-shrink:0}
.coc-board :focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.coc-sheet-tools{display:flex;justify-content:flex-end;margin:-4px 0 6px}
.coc-sheet-refresh{flex:none;display:inline-flex;align-items:center;gap:5px;border:0;border-radius:4px;background:transparent;
  color:var(--muted);padding:5px 4px;font:inherit;font-size:11px;cursor:pointer;min-height:30px}
.coc-sheet-refresh:hover{color:var(--accent);background:var(--surface)}
.coc-sheet-refresh:disabled{opacity:.5;cursor:default}
.coc-sheet-note{margin:10px 0;color:var(--muted);line-height:1.65;font-size:12px}
.coc-sheet-section{margin:24px 0 0;min-width:0}
.coc-sheet-section:first-of-type{margin-top:4px}
.coc-sheet-heading{display:flex;align-items:center;gap:10px;margin:0 0 12px;color:var(--muted);
  font-size:12px;font-weight:650;line-height:1.4;letter-spacing:.025em}
.coc-sheet-heading::after{content:"";flex:1;height:1px;background:var(--border)}
.coc-sheet-heading .coc-icon{width:13px;height:13px}
/* A glyph only restates the caption beside it: sized to the caption, hidden from screen readers. */
.coc-icon{flex:none;width:12px;height:12px;stroke:currentColor;stroke-width:2;fill:none;
  stroke-linecap:round;stroke-linejoin:round}

/* One known map, as the delivery card drew it (§39): floors, zoom and pan are reads of the
   picture already in hand -- no RPC, no model, no turn, nothing written anywhere. */
.coc-map{display:block;margin:0 0 14px;padding:0}
.coc-map:last-child{margin-bottom:0}
.coc-map-head{display:flex;align-items:center;gap:10px;padding:6px 2px;list-style:none;cursor:pointer;
  color:var(--text-strong);font-weight:600}
.coc-map-head::-webkit-details-marker{display:none}
.coc-map-head::after{content:"\\25B8";margin-left:auto;color:var(--subtle);font-size:11px;
  transition:transform .12s ease}
.coc-map[open]>.coc-map-head::after{transform:rotate(90deg)}
.coc-map-body{margin:2px 0 4px;border-left:2px solid var(--border);padding:9px 12px}
.coc-map-tools{display:flex;align-items:center;gap:8px;margin-bottom:8px;color:var(--muted);font-size:11px}
.coc-map-tools input{width:110px;accent-color:var(--accent)}
.coc-map-levels{margin-left:auto;display:flex;flex-wrap:wrap;gap:4px}
.coc-map-levels button{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--border);
  border-radius:999px;background:transparent;color:var(--muted);padding:2px 9px;font:inherit;font-size:11px;cursor:pointer}
.coc-map-levels button[aria-pressed="true"]{color:var(--accent);border-color:var(--accent);
  background:color-mix(in oklab,var(--accent) 9%,transparent)}
.coc-map-thumb{width:28px;height:18px;object-fit:cover;border-radius:3px;display:block;
  background:var(--surface-raised,var(--surface))}
.coc-map-viewport{max-height:420px;overflow:auto;border:1px solid var(--border);border-radius:8px;
  background:var(--surface-raised,var(--surface));cursor:grab}
.coc-map-viewport[data-panning="1"]{cursor:grabbing}
.coc-map-image{display:block;height:auto;max-width:none;transform-origin:top left;pointer-events:none}
.coc-map-regions{margin-top:7px;color:var(--subtle);font-size:11px}
.coc-map-empty{margin:2px 0 4px;color:var(--muted);font-size:12.5px}

/* A found clue: the name the table filed it under, and the account the Keeper filed of how this
   table came by it (§80). A clue under a bare name stays a plain line, because there is nothing
   the player earned to open into. */
.coc-clue{padding:10px 0;border-top:1px solid var(--border);line-height:1.7}
.coc-clue:first-child{border-top:0;padding-top:0}
.coc-clue-name{color:var(--text-strong);font-weight:600}
.coc-clue-fold{display:block;padding:0}
.coc-clue-fold>summary{display:flex;align-items:baseline;gap:6px;padding:6px 0;cursor:pointer;
  list-style:none;border-radius:4px}
.coc-clue-fold>summary::-webkit-details-marker{display:none}
.coc-clue-fold>summary::after{content:"\\25B8";margin-left:auto;flex:none;color:var(--subtle);
  font-size:10px;transition:transform .12s ease}
.coc-clue-fold[open]>summary::after{transform:rotate(90deg)}
.coc-clue-body{padding:0 0 8px;color:var(--muted);line-height:1.6;overflow-wrap:anywhere}
.coc-clue-doc>summary .coc-icon{flex:none;align-self:center}
.coc-clue-doc-body{margin:2px 0 10px;padding:10px 14px;border-left:2px solid var(--border-strong);
  font-family:var(--coc-serif);line-height:1.75;white-space:pre-wrap;color:var(--text)}
/* One exchange with a person: where it happened, as a caption on its own line, then what passed
   between them. The place is a separate element because it is a separate word -- run inline, the
   scene's name and the lane's sentence read as one run with nothing between them. No separator
   character: which punctuation divides two phrases belongs to the play language. */
.coc-npc-exchange{padding:4px 0}
.coc-npc-exchange+.coc-npc-exchange{border-top:1px dashed var(--border)}
.coc-npc-exchange-scene{display:block;color:var(--subtle);font-size:11px;font-weight:600;letter-spacing:.02em}
`;

/* >>> speaker colour: shared verbatim between pipicoc/mechanics.js and pipicoc/board.js <<<
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
/* SPEAKER-BLOCK-END */

/* >>> handout reading: shared verbatim between pipicoc/mechanics.js and pipicoc/board.js <<<
 *
 * Contract §155. A handout cropped from a PDF page reaches the player as the picture and nothing
 * else, so a table whose play language is not the module's holds a clipping it cannot read. This
 * control asks the host for a reading version in the play language (`handout.reading`) and draws it
 * in the row's body slot under the picture. The picture is never replaced or hidden: the toggle
 * only chooses what the body slot below it shows.
 *
 * The delivery card and the case board draw the same control, and a pack renderer is a `data:`
 * module that cannot import a sibling, so -- the speaker-colour block's rule -- it is authored once
 * and copied byte for byte into both files; `tests/extension/handout-reading-control.test.mjs`
 * fails the moment the copies drift.
 *
 * What it sends is `{handout}` and nothing else: the host resolves the path, the campaign, the
 * digest and the language (§155.1). What it draws are words from the answer's own `ui` block -- the
 * `handout` surface for its captions, the `errors` surface for a refusal's code -- asked for by
 * literal key, so the caption scan can see every one. Whether the picture is already in the
 * player's language is the model's word (`keep`); nothing here reads the text it is handed.
 *
 * `invoke(method, params)` resolves to the answer's `data` and rejects with an Error carrying the
 * refusal's `code`. A `pending` answer is asked again HANDOUT_POLL_MS after it arrived, never
 * sooner, only while the row is open (`active`), and never once the control is gone. A failed job
 * is a one-shot mailbox on the host, so the retry is simply the same call again.
 *
 * The reading streams (owner, 2026-09-29): a `pending` answer may carry `partial: {title, text}`,
 * what the host's one streamed completion has written so far. It is drawn where the finished
 * reading goes, marked `streaming`, under the pending line and with no toggle; a later answer never
 * shrinks what is already drawn; the `ready` answer then takes the same slot in place. A `keep`
 * answer shows its caption only, and a refusal drops the half-written text rather than leave it
 * reading as if it were whole.
 */
const HANDOUT_POLL_MS = 400;
const HANDOUT_STYLE_ID = "pipicoc-handout-reading-style";
const HANDOUT_CSS = `
.coc-handout-reading{margin-top:8px}
.coc-handout-tools{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:0 0 6px;
  color:var(--muted);font-size:11.5px;line-height:1.5}
.coc-handout-action,.coc-handout-toggle{display:inline-flex;align-items:center;min-height:24px;
  border:1px solid var(--border);border-radius:999px;background:transparent;color:var(--muted);
  padding:2px 10px;font:inherit;cursor:pointer}
.coc-handout-action:hover,.coc-handout-toggle:hover{color:var(--accent);border-color:var(--accent)}
.coc-handout-action:focus-visible,.coc-handout-toggle:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.coc-handout-toggle[aria-pressed="true"]{color:var(--accent);border-color:var(--accent);
  background:color-mix(in oklab,var(--accent) 9%,transparent)}
.coc-handout-status[role="alert"]{color:var(--danger)}
.coc-handout-why{flex-basis:100%;color:var(--subtle);font-size:11px}
.coc-handout-why>summary{cursor:pointer}
.coc-handout-note{margin:0 0 6px;color:var(--subtle);font-family:inherit;font-size:11px;
  font-style:italic;line-height:1.5;white-space:normal}
.coc-handout-title{margin:0 0 4px;color:var(--text-strong);font-size:13.5px;font-weight:650;
  line-height:1.5;white-space:normal}
.coc-handout-text{white-space:pre-wrap}
`;

if (typeof document !== "undefined" && !document.getElementById(HANDOUT_STYLE_ID)) {
  const style = document.createElement("style");
  style.id = HANDOUT_STYLE_ID;
  style.textContent = HANDOUT_CSS;
  document.head.append(style);
}

/**
 * What a streaming reading has written so far, grown by one `pending` answer's `partial`. Each of
 * the two fields keeps whichever is longer, the one drawn or the one just handed over, so a poll
 * that answers with less (or with nothing) never takes words back off the page mid-stream.
 */
function grownPartial(drawn, next) {
  const was = isRecord(drawn) ? drawn : { title: "", text: "" };
  if (!isRecord(next)) return was;
  const title = text(next.title), body = text(next.text);
  return { title: title.length >= was.title.length ? title : was.title, text: body.length >= was.text.length ? body : was.text };
}

/**
 * The control, built from the host's React. `original` is what the body slot held before (an
 * authored text, or nothing for an image-only clipping) and `bodyClass` is that slot's own class,
 * so the reading version is set in the same place and the same face.
 */
function createHandoutReading(React) {
  const h = React.createElement;
  return function HandoutReading(props) {
    const { handout, ui, original, bodyClass } = props;
    const active = props.active !== false;
    // The latest call, never a dependency: a host redraw hands over a new function every time, and
    // a redraw must not restart the wait.
    const call = React.useRef(props.invoke);
    call.current = props.invoke;
    const alive = React.useRef(true);
    const asked = React.useRef(0);
    const [state, setState] = React.useState({ phase: "idle", round: 0 });
    const [view, setView] = React.useState("reading");
    React.useEffect(() => {
      alive.current = true;
      return () => { alive.current = false; asked.current += 1; };
    }, []);

    function ask() {
      const mine = ++asked.current;
      // A poll keeps what has streamed so far; a press starts from idle or a refusal, which hold none.
      setState(prior => ({ phase: "asking", round: prior.round, partial: prior.partial }));
      Promise.resolve()
        .then(() => call.current("handout.reading", { handout }))
        .then(data => {
          if (!alive.current || mine !== asked.current) return;
          const status = isRecord(data) ? text(data.status) : "";
          if (status === "pending") setState(prior => ({ phase: "waiting", round: prior.round + 1, partial: grownPartial(prior.partial, data.partial) }));
          else if (status === "ready") {
            setState(prior => ({ phase: "ready", round: prior.round, keep: data.keep === true, title: text(data.title), text: text(data.text) }));
            setView("reading");
          } else setState(prior => ({ phase: "failed", round: prior.round, code: "", reason: "" }));
        }, error => {
          if (!alive.current || mine !== asked.current) return;
          setState(prior => ({ phase: "failed", round: prior.round,
            code: isRecord(error) ? text(error.code) : "", reason: error instanceof Error ? error.message : "" }));
        });
    }

    // One timer per `pending` answer, started after that answer arrived, cleared when the row
    // closes or the control goes away: a job the player stopped looking at is not asked about.
    React.useEffect(() => {
      if (state.phase !== "waiting" || !active) return undefined;
      const timer = setTimeout(ask, HANDOUT_POLL_MS);
      return () => clearTimeout(timer);
    }, [state.phase, state.round, active]);

    let tools, drawn = state.phase;
    if (state.phase === "idle") {
      tools = h("button", { type: "button", className: "coc-handout-action", onClick: ask }, word(ui, "handout", "translate"));
    } else if (state.phase === "asking" || state.phase === "waiting") {
      drawn = "pending";
      tools = h("span", { className: "coc-handout-status", role: "status" }, word(ui, "handout", "pending"));
    } else if (state.phase === "failed") {
      tools = [
        h("span", { key: "why", className: "coc-handout-status", role: "alert" }, word(ui, "errors", state.code, word(ui, "handout", "failed"))),
        h("button", { key: "retry", type: "button", className: "coc-handout-action", onClick: ask }, word(ui, "handout", "retry")),
        // The host's reason is English by contract and written for the log: kept, behind a fold.
        state.reason
          ? h("details", { key: "reason", className: "coc-handout-why" }, h("summary", null, word(ui, "errors", "details")), state.reason)
          : null,
      ];
    } else if (state.keep) {
      drawn = "keep";
      tools = h("span", { className: "coc-handout-status", role: "status" }, word(ui, "handout", "keep"));
    } else {
      tools = [
        h("button", { key: "original", type: "button", className: "coc-handout-toggle", "aria-pressed": view === "original", onClick: () => setView("original") },
          word(ui, "handout", "original")),
        h("button", { key: "reading", type: "button", className: "coc-handout-toggle", "aria-pressed": view === "reading", onClick: () => setView("reading") },
          word(ui, "handout", "reading")),
      ];
    }
    // One slot, one element: the streamed words and the finished reading are the same `div` in the
    // same place, so the `ready` answer replaces the text in place rather than remounting the slot.
    const streamed = drawn === "pending" && isRecord(state.partial) && (state.partial.title || state.partial.text) ? state.partial : null;
    const shown = state.phase === "ready" && !state.keep && view === "reading" ? { title: state.title, text: state.text, mark: "reading" }
      : streamed ? { title: streamed.title, text: streamed.text, mark: "streaming" }
      : null;
    const reading = shown
      ? h("div", { className: bodyClass ? `${bodyClass} coc-handout-reading-body` : "coc-handout-reading-body", "data-reading": shown.mark,
          "aria-busy": shown.mark === "streaming" ? "true" : undefined },
          h("p", { className: "coc-handout-note" }, word(ui, "handout", "note")),
          shown.title ? h("h4", { className: "coc-handout-title" }, shown.title) : null,
          h("div", { className: "coc-handout-text" }, shown.text))
      : null;
    return h("div", { className: "coc-handout-reading", "data-handout-reading": drawn },
      h("div", { className: "coc-handout-tools" }, tools),
      reading || original || null);
  };
}
/* >>> end handout reading <<< */

if (typeof document !== "undefined" && !document.getElementById(STYLE_ID)) {
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS + SPEAKER_CSS;
  document.head.append(style);
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value) {
  return value === null || value === undefined ? "" : String(value);
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
 * A `{code, reason}` pair from an answer, or null when the answer reports no failure.
 *
 * A refusal is an answer here, not a crash: the pack says which code it refused with and the panel
 * looks the player's word up by it (§23). The reason is English by contract and stays behind a
 * fold -- it is written for the log, not for a table reading another language.
 */
function failureOf(answer) {
  if (!isRecord(answer)) return null;
  const code = text(answer.code);
  const reason = text(answer.reason);
  if (isRecord(answer.error)) return { code: text(answer.error.code) || code, reason: text(answer.error.message) || reason };
  return code || reason ? { code, reason } : null;
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

/** One small stroke glyph per section, keyed by a stable name rather than by a caption (§23). */
const ICON_PATHS = {
  map: ["M3 6.4 8.6 4.3v14.5L3 20.9z", "M9.6 4.3v14.5l4.8 2v-14.5z", "M15.4 6.3v14.5l4.6-1.8a1 1 0 0 0 1-1V6.5a1 1 0 0 0-1.3-1z"],
  search: ["M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z", "M16.2 16.2 21 21"],
  body: ["M12 4.6a2.7 2.7 0 1 1 0 5.4 2.7 2.7 0 0 1 0-5.4Z", "M4.8 20.2c.4-4 3.4-6.4 7.2-6.4s6.8 2.4 7.2 6.4Z"],
  document: ["M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z", "M14 3v5h5", "M9 13h6", "M9 17h6"],
};

export function createComponent(React) {
  const { useCallback, useEffect, useRef, useState } = React;
  const h = React.createElement;
  const HandoutReading = createHandoutReading(React);

  /**
   * A decorative glyph restating its label, keyed by the stable name rather than the localized
   * word. `data-icon` names the glyph so a test can tell which one a heading drew without parsing
   * path data.
   */
  function Icon(props) {
    const paths = ICON_PATHS[props.name];
    if (!paths) return null;
    return h("svg", { className: "coc-icon", viewBox: "0 0 24 24", "aria-hidden": "true", focusable: "false", "data-icon": props.name },
      paths.map((d, index) => h("path", { key: index, d })));
  }

  /** A titled block. `anchor` names it in the DOM, which is how a test finds a section. */
  function Section(props) {
    const anchor = props.anchor ? { "data-anchor": props.anchor, "data-label": text(props.title) } : {};
    return h("section", { className: "coc-sheet-section", ...anchor },
      h("h2", { className: "coc-sheet-heading" }, props.icon ? h(Icon, { name: props.icon }) : null, props.title),
      props.children);
  }

  /** A found clue as the player's own record of it: the name the table filed it under, and the account the Keeper filed of how. */
  function clueLine(clue) {
    if (!isRecord(clue)) return { name: text(clue), how: "" };
    return { name: text(clue.label || clue.name || clue.clue || clue.id), how: text(clue.how) };
  }

  /**
   * One known map, drawn the way the delivery card draws it (§39): the same page, the same floor
   * buttons, the same zoom and drag, and no card chrome around it. The words are already the
   * player's -- the pack projected an authored row before it composed the pixels -- so this only
   * names what arrived.
   *
   * A pictured handout (`invoke` is handed only to those, never to a map) also carries the §155
   * translate control under its picture; the body slot it fills is the one the authored text of a
   * hybrid card already sits in.
   */
  function MapBlock(props) {
    const { row, t, term, ui, invoke } = props;
    const [zoom, setZoom] = useState(100);
    const [broken, setBroken] = useState(false);
    // Whether the player has the row open: a closed row asks the host nothing more (§155).
    const [open, setOpen] = useState(true);
    const variants = knownLevelImages(row);
    const [level, setLevel] = useState(variants[0] ? variants[0].level : "");
    const chosen = variants.find(item => item.level === level);
    const shown = (chosen && chosen.image) || (playerImage(row.image) ? row.image : "");
    const openable = row.document === "ready" && Boolean(shown) && !broken;
    const regionLabels = knownRegionLabels(row);
    const name = term(text(row.label) || text(row.name) || text(row.map));
    const handout = text(row.handout);
    const authored = handout && text(row.text) ? h("div", {className:"coc-clue-doc-body"},term(text(row.text))) : null;
    return h("details", { className: "coc-map", open: true, "data-map": text(row.map) || undefined, "data-handout": handout || undefined,
      "data-view": text(row.view_id) || undefined, "data-document": text(row.document) || undefined,
      onToggle: event => setOpen(Boolean(event.currentTarget && event.currentTarget.open)) },
      h("summary", { className: "coc-map-head" },
        h(Icon, { name: row.handout ? 'document' : 'map' }),
        h("span", { className: "coc-map-name" }, name)),
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
                      h("img", { className: "coc-map-thumb", src: item.image, alt: "", draggable: "false", "aria-hidden": "true" }),
                      item.level)))
                : null),
            h("div", { className: "coc-map-viewport", onPointerDown: panViewport },
              h("img", {
                className: "coc-map-image",
                src: shown,
                alt: name,
                draggable: "false",
                style: { width: `${zoom}%` },
                onError: () => setBroken(true),
              })),
            handout && typeof invoke === "function"
              ? h(HandoutReading, { key: handout, handout, invoke, ui, active: open, bodyClass: "coc-clue-doc-body", original: authored })
              : authored,
            regionLabels.length ? h("div", { className: "coc-map-regions" }, regionLabels.join(" \u00b7 ")) : null)
        // Nothing to open: the place the player knows is still worth naming, and it is the only
        // thing here that is true without the pixels (§59 -- a `none` page is delivered, not lost).
        : h("div", { className: "coc-map-empty" }, regionLabels.length ? regionLabels.join(" \u00b7 ") : t("mapUnavailable")));
  }

  /** The maps this table has been shown (§39.3): arrival cards and Keeper-granted regions alike. */
  function Maps(props) {
    const { maps, t, term } = props;
    return h(Section, { title: t("maps"), icon: "map", anchor: "maps" },
      maps.length
        ? maps.map((row, index) => h(MapBlock, { key: text(row.map) || index, row, t, term }))
        : h("p", { className: "coc-sheet-note" }, t("noMaps")));
  }

  /** Found clues -- the old sheet's clues section, word for word. */
  function Clues(props) {
    const { view, t, term = value => value, ui, invoke } = props;
    const clues = isRecord(view.clues) ? view.clues : {};
    const discovered = Array.isArray(clues.discovered) ? clues.discovered : [];
    const here = Array.isArray(clues.here) ? clues.here : [];
    // A clue the scene offers but nobody has found is the Keeper's business, not the player's:
    // only the ones already marked discovered are named.
    const foundHere = here.filter(clue => isRecord(clue) && clue.discovered === true);
    // The documents the table was handed (`view.handouts`), each its own row that opens into the
    // whole text, so a clipping read once is still here after its delivery card scrolls away. Name
    // and body go through the glossary: the handouts lane projects exactly these two strings, the
    // same ones the delivery card looks up.
    const documents = (Array.isArray(view.handouts) ? view.handouts : [])
      .filter(doc => isRecord(doc) && (text(doc.text) || playerImage(doc.image)));
    if (!discovered.length && !foundHere.length && !documents.length) {
      return h(Section, { title: t("clues"), icon: "search", anchor: "clues" }, h("p", { className: "coc-sheet-note" }, t("noClues")));
    }
    const seen = new Set();
    const rows = [];
    for (const clue of [...foundHere, ...discovered]) {
      const line = clueLine(clue);
      const key = line.name || line.how;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      rows.push(line);
    }
    // A pictured document is drawn as its picture, and only a pictured one gets the §155 control:
    // a text-only card is already words in hand.
    const documentRows = documents.map((doc, index) => playerImage(doc.image)
      ? h(MapBlock, {key:`doc:${text(doc.handout)}:${index}`,row:doc,t,term,ui,invoke})
      : h("details", { className: "coc-clue coc-clue-fold coc-clue-doc", key: `doc:${text(doc.handout)}:${index}`, "data-handout": text(doc.handout) },
        h("summary", null, h(Icon, { name: "document" }),
          h("span", { className: "coc-clue-name" }, term(text(doc.name) || text(doc.handout)))),
        h("div", { className: "coc-clue-body coc-clue-doc-body" }, term(text(doc.text)))));
    return h(Section, { title: t("clues"), icon: "search", anchor: "clues" }, [...rows.map((row, index) =>
      row.how
        // The name stays on the line; how this table came by the clue is one tap away. The name
        // goes through the glossary -- the Keeper's own label comes back as itself, a graph name
        // comes back in the play language once the clue lane has projected it. The account does
        // not: the Keeper wrote it in the play language at the table, like the journal's own prose.
        ? h("details", { className: "coc-clue coc-clue-fold", key: `${row.name}:${index}` },
            h("summary", null, h("span", { className: "coc-clue-name" }, term(row.name))),
            h("div", { className: "coc-clue-body" }, row.how))
        : h("div", { className: "coc-clue", key: `${row.name}:${index}` },
            h("span", { className: "coc-clue-name" }, term(row.name)))), ...documentRows]);
  }

  /**
   * The people the investigators have met, as the table's NPC journal projects them (§17.10's
   * `npcs.journal`). The description and the exchange summary are the journal lane's own prose,
   * written in the play language, and are drawn as they arrive. The name and the scene stamped on
   * an exchange are not: the lane must copy a recordable name exactly and the kernel stamps the
   * scene's display name at the turn it happened, so both are the module graph's words and both go
   * through the glossary, where the journal lane has projected them -- the host merges that lane
   * under `view.labels` on every board read, live or cold, as it does for the sheet. Turn numbers are machine
   * context and stay off the page. A dead mark rests next to the name when the ledger closed.
   *
   * The swatch in front of each name is the legend for the delivery card's spoken lines (§40.4):
   * the same anchor, the same allocator, so the hue a person's lines wear in the transcript is the
   * hue their row wears here. The anchor is the row's `id` -- the graph handle §40.3 projects -- and
   * falls back to the name for a journal written before that field existed.
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
      const ink = speakerInk(text(npc.id) || text(npc.name), "npc");
      return h("details", { className: "coc-clue coc-clue-fold", key: `${name}:${index}`, ...(dead ? { "data-dead": "1" } : {}) },
        h("summary", null,
          ink ? h("span", { className: "coc-say-dot", "aria-hidden": "true", style: { "--coc-say-ink": ink } }) : null,
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
  return function CaseBoard(props) {
    const api = props.api || {};
    const [answer, setAnswer] = useState(undefined);
    const [busy, setBusy] = useState(false);
    const generation = useRef(0);
    // `running` is the request in flight (0 when none); `again` is one push that arrived meanwhile.
    const running = useRef(0), again = useRef(false), latest = useRef(null);
    useEffect(() => () => { generation.current++; }, []);

    // Only the player's own click shows the busy word and asks for a failed lane run again. Every
    // other read -- mount, and the pushes of a turn in progress -- runs behind the drawn board:
    // one turn pushes dozens of events, and a button that flipped to the busy word on each one
    // flickered for the whole turn.
    const load = useCallback(async (byPlayer = false) => {
      const request = ++generation.current;
      if (!api.invoke) {
        setAnswer({ status: "error", campaign: null, code: "pack_unreachable", reason: "this host cannot reach the pack" });
        return;
      }
      running.current = request;
      if (byPlayer) setBusy(true);
      try {
        // `retry_projection` is the player asking again for a lane run that failed -- the same word
        // the sheet's own vocabulary lanes take, so one button covers both.
        const result = await api.invoke("board", byPlayer ? { retry_projection: true } : {});
        if (request !== generation.current) return;
        if (result && result.ok === true && isRecord(result.data)) setAnswer(result.data);
        else setAnswer({ status: "error", campaign: null, code: "pack_silent", reason: "the pack did not answer" });
      } catch (error) {
        if (request !== generation.current) return;
        setAnswer({ status: "error", campaign: null, code: "", reason: error instanceof Error ? error.message : String(error) });
      } finally {
        if (request === generation.current) {
          running.current = 0;
          setBusy(false);
          if (again.current) { again.current = false; void latest.current?.(); }
        }
      }
    }, [api]);
    latest.current = load;

    // §155.8: the handout control's host call. The panel's `api.invoke` answers an envelope; the
    // control takes the shape the transcript's `onInvoke` has -- the answer's `data`, or an Error
    // carrying the refusal's code -- so one control serves both surfaces.
    const readHandout = useCallback(async (method, params) => {
      const result = await api.invoke(method, params);
      if (result && result.ok === true) return result.data;
      const refusal = isRecord(result) && isRecord(result.error) ? result.error : {};
      throw Object.assign(new Error(text(refusal.message) || "the pack did not answer"), { code: text(refusal.code) || "pack_silent" });
    }, [api]);

    useEffect(() => { void load(); }, [load]);

    // The pack pushes on every committed turn; any event from it means re-read. The push carries no
    // payload, so a shape change upstream can never desynchronise the panel. A burst of pushes
    // while a read is in flight folds into one read after it, never a pile of restarted ones.
    useEffect(() => {
      if (!api.subscribeExt) return undefined;
      const unsubscribe = api.subscribeExt(() => {
        if (running.current) { again.current = true; return; }
        void load();
      });
      return typeof unsubscribe === "function" ? unsubscribe : undefined;
    }, [api, load]);

    const ui = isRecord(answer) ? answer.ui : null;
    const t = (key, fallback) => word(ui, "board", key, fallback);
    const refresh = h("div", { className: "coc-sheet-tools" },
      h("button", { type: "button", className: "coc-sheet-refresh", onClick: () => { void load(true); }, disabled: busy },
        busy ? t("refreshing") : t("refresh")));

    // Before the first answer: a word, not an ellipsis, and never another language's word.
    if (!isRecord(answer)) {
      return h("div", { className: "coc-board", role: "region", ...(props.title ? { "aria-label": props.title } : {}) },
        h("p", { className: "coc-sheet-note", role: "status" }, t("loading")));
    }

    const view = isRecord(answer.view) ? answer.view : null;
    const maps = Array.isArray(answer.maps) ? answer.maps.filter(isRecord) : [];
    const status = text(answer.status) || (view ? "ready" : "error");
    if (status !== "ready" || !view) {
      // Three different states, and the player is owed which one it is: a session bound to no
      // campaign, a read that stopped, or a host that answered nothing at all. Every word comes
      // from the answer's own block; the code's caption comes from the shared `errors` surface.
      const failure = failureOf(answer);
      const title = status === "unbound" ? t("unboundTitle") : t("errorTitle");
      const detail = status === "unbound"
        ? t("unboundDetail")
        : word(ui, "errors", failure ? failure.code : "", word(ui, "errors", "unknown"));
      return h("div", { className: "coc-board", role: "region", ...(props.title ? { "aria-label": props.title } : {}) },
        h("h2", { className: "coc-sheet-heading" }, title),
        h("p", { className: "coc-sheet-note", role: "status" }, detail),
        failure && failure.reason
          ? h("details", { className: "coc-sheet-note" },
              h("summary", null, word(ui, "errors", "details")),
              h("p", null, failure.reason))
          : null,
        h("button", { type: "button", onClick: () => { void load(true); }, disabled: busy }, busy ? t("loading") : t("retry")));
    }

    const glossary = isRecord(view.labels) ? view.labels : {};
    const term = (name) => (typeof glossary[name] === "string" && glossary[name]) || name;
    return h("div", { className: "coc-board", role: "region", ...(props.title ? { "aria-label": props.title } : {}) },
      refresh,
      h(Maps, { maps, t, term }),
      h(Clues, { view, t, term, ui, invoke: api.invoke ? readHandout : undefined }),
      h(Npcs, { view, t, term }));
  };
}
