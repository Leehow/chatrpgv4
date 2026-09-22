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
 * glossary the answer carries.
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
};

export function createComponent(React) {
  const { useCallback, useEffect, useRef, useState } = React;
  const h = React.createElement;

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
   */
  function MapBlock(props) {
    const { row, t, term } = props;
    const [zoom, setZoom] = useState(100);
    const [broken, setBroken] = useState(false);
    const variants = knownLevelImages(row);
    const [level, setLevel] = useState(variants[0] ? variants[0].level : "");
    const chosen = variants.find(item => item.level === level);
    const shown = (chosen && chosen.image) || (playerImage(row.image) ? row.image : "");
    const openable = row.document === "ready" && Boolean(shown) && !broken;
    const regionLabels = knownRegionLabels(row);
    const name = term(text(row.label) || text(row.name) || text(row.map));
    return h("details", { className: "coc-map", open: true, "data-map": text(row.map) || undefined,
      "data-view": text(row.view_id) || undefined, "data-document": text(row.document) || undefined },
      h("summary", { className: "coc-map-head" },
        h(Icon, { name: "map" }),
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
      const key = line.name || line.how;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      rows.push(line);
    }
    return h(Section, { title: t("clues"), icon: "search", anchor: "clues" }, rows.map((row, index) =>
      row.how
        // The name stays on the line; how this table came by the clue is one tap away. The name
        // goes through the glossary -- the Keeper's own label comes back as itself, a graph name
        // comes back in the play language once the clue lane has projected it. The account does
        // not: the Keeper wrote it in the play language at the table, like the journal's own prose.
        ? h("details", { className: "coc-clue coc-clue-fold", key: `${row.name}:${index}` },
            h("summary", null, h("span", { className: "coc-clue-name" }, term(row.name))),
            h("div", { className: "coc-clue-body" }, row.how))
        : h("div", { className: "coc-clue", key: `${row.name}:${index}` },
            h("span", { className: "coc-clue-name" }, term(row.name)))));
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
    useEffect(() => () => { generation.current++; }, []);

    const load = useCallback(async (retryProjection = false) => {
      const request = ++generation.current;
      if (!api.invoke) {
        setAnswer({ status: "error", campaign: null, code: "pack_unreachable", reason: "this host cannot reach the pack" });
        return;
      }
      setBusy(true);
      try {
        // `retry_projection` is the player asking again for a lane run that failed -- the same word
        // the sheet's own vocabulary lanes take, so one button covers both.
        const result = await api.invoke("board", retryProjection ? { retry_projection: true } : {});
        if (request !== generation.current) return;
        if (result && result.ok === true && isRecord(result.data)) setAnswer(result.data);
        else setAnswer({ status: "error", campaign: null, code: "pack_silent", reason: "the pack did not answer" });
      } catch (error) {
        if (request !== generation.current) return;
        setAnswer({ status: "error", campaign: null, code: "", reason: error instanceof Error ? error.message : String(error) });
      } finally {
        if (request === generation.current) setBusy(false);
      }
    }, [api]);

    useEffect(() => { void load(); }, [load]);

    // The pack pushes on every committed turn; any event from it means re-read. The push carries no
    // payload, so a shape change upstream can never desynchronise the panel.
    useEffect(() => {
      if (!api.subscribeExt) return undefined;
      const unsubscribe = api.subscribeExt(() => { void load(); });
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
      h(Clues, { view, t, term }),
      h(Npcs, { view, t, term }));
  };
}
