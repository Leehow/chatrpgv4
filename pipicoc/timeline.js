/**
 * The memory-line panel: the campaign's whole commit graph as an interactive lane map
 * (contract §29, design docs/specs/memory-line-panel.md).
 *
 * Plain ESM with no imports, on purpose -- the renderer imports this file as a module and calls
 * `createComponent(React)` with its own React instance (`controlled-component-loader.ts`); a bare
 * `react` import cannot resolve there, and a build step would put a compiled artifact between the
 * source and what ships. So: no JSX, no bundler, `React.createElement` through the `h` helper.
 *
 * The panel draws what `timeline.graph` answers and nothing else. The vertical axis is the game
 * clock: the kernel already projected every commit into `clock` minutes and `when` calendar
 * fields, so this file never does clock or calendar arithmetic -- the time ruler is the ui words
 * `at` pattern filled with the node's own `when` fields (§23: the chrome is data, the words live
 * in `content/ui/<tag>/timeline.json`, and a missing key renders as the key itself).
 *
 * The one piece of genuine geometry this file owns is the lane map: `main` keeps lane 0, every
 * other line claims the lowest lane free at its fork's game time and releases it past its tip,
 * and a node belongs to the deepest line whose tip ancestry (minus the fork point's ancestry)
 * contains it -- the same ownership rule git itself would report, computed from the parents the
 * payload carries. Fork and merge edges are quadratic bezier curves between lanes.
 */

const STYLE_ID = "pipicoc-timeline-style";
const CSS = `
/* The graph is drawn with the host's theme tokens; the lane hues are a closed palette of mid
   tones chosen to read on both clay and clay-night. */
.coc-tl{--tl-lane-1:#4a86c5;--tl-lane-2:#8a6bbf;--tl-lane-3:#4f9d74;--tl-lane-4:#c08a3e;
  --tl-lane-5:#b0568a;position:relative;display:flex;flex-direction:column;height:100%;
  min-height:0;min-width:0;box-sizing:border-box;color:var(--text);font-size:13px;line-height:1.5}
.coc-tl *,.coc-tl *::before,.coc-tl *::after{box-sizing:border-box}
.coc-tl-head{display:flex;align-items:center;justify-content:space-between;gap:10px;
  padding:14px 16px 8px;flex:none}
.coc-tl-title{font-size:15px;font-weight:650;color:var(--text-strong);letter-spacing:-.01em}
.coc-tl-refresh{flex:none;border:1px solid var(--border);border-radius:7px;background:var(--surface);
  color:var(--accent);padding:4px 9px;font:inherit;font-size:11px;cursor:pointer;min-height:28px}
.coc-tl-refresh:hover{border-color:var(--accent)}
.coc-tl-refresh:disabled{opacity:.5;cursor:default}
.coc-tl :focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.coc-tl-note{margin:4px 16px 12px;color:var(--muted);font-size:12px;line-height:1.6}
.coc-tl-truncated{margin:0 16px 8px;padding:6px 10px;border:1px dashed var(--border-strong);
  border-radius:8px;color:var(--muted);font-size:11px;text-align:center}
.coc-tl-error{margin:4px 16px 12px;color:var(--danger);font-size:12px;overflow-wrap:anywhere}
.coc-tl-error summary{cursor:pointer;color:var(--muted)}
.coc-tl-error p{color:var(--muted)}
.coc-tl-scroll{flex:1;min-height:0;overflow:auto;position:relative;padding:0 6px 18px;
  scrollbar-width:thin}
.coc-tl-svg{display:block}
/* Lanes: color is the lane's identity, so every part of a line -- spine, edges, glyphs -- takes
   its lane's color through currentColor. */
.coc-tl-lane-0{color:var(--text-strong)}
.coc-tl-lane-1{color:var(--tl-lane-1)}
.coc-tl-lane-2{color:var(--tl-lane-2)}
.coc-tl-lane-3{color:var(--tl-lane-3)}
.coc-tl-lane-4{color:var(--tl-lane-4)}
.coc-tl-lane-5{color:var(--tl-lane-5)}
.coc-tl-spine{fill:none;stroke:currentColor;stroke-width:2;opacity:.85}
.coc-tl-spine[data-loop="1"]{stroke-dasharray:1.5 5;stroke-linecap:round}
.coc-tl-spine[data-faded="1"],.coc-tl-edge[data-faded="1"]{opacity:.3}
.coc-tl-edge{fill:none;stroke:currentColor;stroke-width:1.6;opacity:.8}
.coc-tl-node{transition:filter .12s ease}
.coc-tl-node.is-clickable{cursor:pointer}
.coc-tl-node:hover{filter:drop-shadow(0 0 6px currentColor)}
.coc-tl-node:focus-visible{outline:none;filter:drop-shadow(0 0 6px var(--accent))}
.coc-tl-dot{fill:currentColor}
.coc-tl-ring{fill:var(--bg);stroke:currentColor;stroke-width:2}
.coc-tl-join{fill:var(--surface-raised,var(--surface));stroke:currentColor;stroke-width:2}
.coc-tl-tick{stroke:currentColor;stroke-width:2;stroke-linecap:round;opacity:.55}
.coc-tl-loopmark{fill:none;stroke:currentColor;stroke-width:1.4;stroke-dasharray:2.5 3;opacity:.9}
.coc-tl-node[data-faded="1"]{opacity:.45}
.coc-tl-node[data-faded="1"]:hover{opacity:1}
.coc-tl-ruler{fill:var(--subtle);font-size:10px;letter-spacing:.01em}
.coc-tl-ruler-tick{stroke:var(--border-strong);stroke-width:1}
.coc-tl-break-line{stroke:var(--border);stroke-width:1;stroke-dasharray:3 4}
.coc-tl-break-mark{stroke:var(--subtle);stroke-width:1.6;stroke-linecap:round;fill:none}
.coc-tl-here-ring{fill:none;stroke:var(--accent);stroke-width:1.6;animation:coc-tl-pulse 2.2s ease-in-out infinite}
.coc-tl-here-label{fill:var(--accent);font-size:10px;font-weight:650}
@keyframes coc-tl-pulse{0%,100%{opacity:1}50%{opacity:.3}}
@media (prefers-reduced-motion:reduce){.coc-tl-here-ring{animation:none}.coc-tl-node{transition:none}}
/* The hover card restates one node: kind, title, game time, and the line it stands on. */
.coc-tl-tip{position:absolute;z-index:5;width:196px;padding:10px 12px;border:1px solid var(--border);
  border-radius:10px;background:var(--surface-raised,var(--surface));
  box-shadow:0 8px 24px color-mix(in srgb,var(--text) 18%,transparent);
  font-size:12px;line-height:1.5;pointer-events:none}
.coc-tl-tip-kind{color:var(--accent);font-size:10.5px;font-weight:650;letter-spacing:.04em}
.coc-tl-tip-title{color:var(--text-strong);margin-top:3px;overflow-wrap:anywhere}
.coc-tl-tip-time{color:var(--muted);margin-top:3px;font-size:11px}
.coc-tl-tip-line{color:var(--subtle);margin-top:5px;padding-top:5px;border-top:1px solid var(--border);
  font-size:11px;overflow-wrap:anywhere}
/* The branch confirmation is a card the panel draws itself: the host's confirm dialog is private
   to the extensions pane, and a panel may not reach into it. */
.coc-tl-branch{position:absolute;left:10px;right:10px;bottom:10px;z-index:6;padding:14px;
  border:1px solid var(--border);border-top:3px solid var(--accent);border-radius:12px;
  background:var(--surface-raised,var(--surface));
  box-shadow:0 10px 30px color-mix(in srgb,var(--text) 22%,transparent)}
.coc-tl-branch-title{font-weight:650;color:var(--text-strong)}
.coc-tl-branch-body{margin:8px 0 0;color:var(--muted);font-size:12px;line-height:1.65}
.coc-tl-branch input{display:block;width:100%;margin:10px 0 0;padding:7px 9px;
  border:1px solid var(--border);border-radius:7px;background:var(--surface-input,var(--surface));
  color:var(--text);font:inherit;font-size:12px}
.coc-tl-branch input:focus{border-color:var(--accent);outline:none}
.coc-tl-branch-error{margin:8px 0 0;color:var(--danger);font-size:11.5px;overflow-wrap:anywhere}
.coc-tl-branch-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:12px}
.coc-tl-branch button{border:1px solid var(--border);border-radius:7px;padding:6px 12px;
  font:inherit;font-size:12px;cursor:pointer;min-height:30px}
.coc-tl-branch-confirm{background:var(--accent);border-color:var(--accent);
  color:var(--surface-raised,var(--surface));font-weight:600}
.coc-tl-branch-cancel{background:var(--surface);color:var(--text)}
.coc-tl-branch button:disabled{opacity:.55;cursor:default}
`;

if (typeof document !== "undefined" && !document.getElementById(STYLE_ID)) {
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.append(style);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value) {
  return typeof value === "string" ? value : value == null ? "" : String(value);
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
 * day before the month says so in its own file rather than here. A placeholder `values` has no
 * entry for stays as written: the same visible gap a missing key is.
 */
function fill(template, values) {
  return String(template).replace(/\{([A-Za-z0-9_]+)\}/g, (whole, name) =>
    Object.prototype.hasOwnProperty.call(values, name) ? text(values[name]) : whole);
}

/**
 * A `{code, message}` pair from a refused invoke, or null when there is no failure.
 *
 * The message never becomes a caption. It is English by contract (§23) -- written for the log,
 * not for a player reading a table in another language -- so it travels behind a fold instead.
 */
function refusalOf(err) {
  return {
    code: isRecord(err) && typeof err.code === "string" ? err.code : "",
    message: isRecord(err) && typeof err.message === "string" ? err.message : String(err ?? ""),
  };
}

/**
 * A node's `when` split for the `at` caption, with the sheet's convention (§23): month and day
 * travel bare (`mo`, `d`) and zero-padded (`mo2`, `d2`) so the language's caption picks one; the
 * hour and minute are padded outright, because a clock reading 10:05 is not 10:5 in any language.
 * This is formatting, not calendar arithmetic -- the fields themselves are the kernel's.
 */
function whenValues(when) {
  if (!isRecord(when)) return {};
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const pad = (v) => String(num(v)).padStart(2, "0");
  return { y: num(when.y), mo: num(when.mo), d: num(when.d),
           mo2: pad(when.mo), d2: pad(when.d), hh: pad(when.hh), mm: pad(when.mm) };
}

/* --- The lane map -----------------------------------------------------------
 *
 * Geometry constants. The vertical rhythm: y is a pure function of the game clock, so nodes at
 * one game minute share one height across every lane. Gaps inside six game hours spread with the
 * gap; a jump beyond that collapses into a slim band with a break mark, so a night's sleep does
 * not eat the panel. The one exception to pure-clock y is a same-LANE same-clock stack (a seal
 * and its turn commit land together): it fans out by a small nudge inside a taller band.
 */
const RULER_W = 112;    // width of the left time ruler
const LANE_DX = 26;     // horizontal distance between two lanes
const RIGHT_PAD = 84;   // room for the "you are here" label past the last lane
const PAD_TOP = 18;
const PAD_BOTTOM = 34;
const MIN_STEP = 24;    // smallest vertical distance between two clock bands
const SAME_STEP = 14;   // collision nudge inside a same-lane same-clock stack
const GAP_SCALE = 0.12; // px per game minute inside an uncompressed gap
const COMPRESS_MIN = 360; // a gap beyond six game hours compresses
const BREAK_H = 30;     // height of a compressed band
const LANE_PALETTE = 6; // closed palette: lane 0 plus five branch hues

/**
 * The full geometry of one `timeline.graph` answer, with no React and no words involved.
 *
 * Returns `{rows, lanes, spines, edges, breaks, rulerRows, width, height}`:
 * - `rows`: every drawable node as `{node, x, y, lane, line}` in game-time order;
 * - `lanes`: line name -> lane index (main is 0);
 * - `spines`: per line `{line, lane, x, y1, y2, loop, faded}` vertical strokes;
 * - `edges`: per parent link `{x1, y1, x2, y2, lane, curved, faded}`; a curved edge is a
 *   quadratic bezier whose control point sits under the parent, so it leaves the parent
 *   vertically and arrives on its new lane horizontally;
 * - `breaks`: y coordinates of compressed time bands;
 * - `rulerRows`: the clock bands whose `when` label differs from the band above.
 *
 * Y is a pure function of `clock`: every node at one game minute stands at one height, across
 * every lane. A same-lane same-clock stack (seal + turn commit) is the only exception and fans
 * out by `SAME_STEP` inside a band grown to fit it.
 */
export function layoutGraph(payload) {
  const nodes = (Array.isArray(payload?.nodes) ? payload.nodes : []).filter(
    (n) => isRecord(n) && typeof n.sha === "string" && Number.isFinite(n.clock));
  const lines = (Array.isArray(payload?.lines) ? payload.lines : []).filter(
    (l) => isRecord(l) && typeof l.name === "string");
  const bySha = new Map(nodes.map((n) => [n.sha, n]));
  const ordered = [...nodes].sort((a, b) =>
    a.clock - b.clock || text(a.at).localeCompare(text(b.at)) || a.sha.localeCompare(b.sha));

  const ancestorsOf = (tipSha) => {
    const seen = new Set();
    const queue = [tipSha];
    while (queue.length) {
      const sha = queue.pop();
      if (!sha || seen.has(sha) || !bySha.has(sha)) continue;
      seen.add(sha);
      const parents = bySha.get(sha).parents;
      if (Array.isArray(parents)) queue.push(...parents);
    }
    return seen;
  };

  const mainLine = lines.find((l) => l.kind === "main") ?? lines.find((l) => !isRecord(l.forked_from)) ?? null;
  const branches = lines.filter((l) => l !== mainLine)
    .map((line) => ({ line, fork: bySha.get(line.forked_from?.commit) ?? null }))
    .sort((a, b) =>
      (a.fork?.clock ?? Infinity) - (b.fork?.clock ?? Infinity) || a.line.name.localeCompare(b.line.name));

  // A branch owns its tip's ancestry minus its fork point's ancestry -- the commits git would
  // call unique to it. Exact sets first; a tip truncated out of the payload falls back to a
  // clock heuristic that may only claim nodes no exact set claimed, so a degraded payload can
  // never drag another line's commits onto this lane.
  for (const branch of branches) {
    branch.own = new Set();
    if (bySha.has(branch.line.last_commit)) {
      const inherited = branch.fork ? ancestorsOf(branch.fork.sha) : new Set();
      for (const sha of ancestorsOf(branch.line.last_commit)) if (!inherited.has(sha)) branch.own.add(sha);
    }
  }
  const claimed = new Set(branches.flatMap((branch) => [...branch.own]));
  for (const branch of branches) {
    if (!branch.fork || bySha.has(branch.line.last_commit) || branch.own.size) continue;
    for (const n of nodes) {
      if (claimed.has(n.sha)) continue;
      if (n.clock > branch.fork.clock ||
          (n.clock === branch.fork.clock && text(n.at) > text(branch.fork.at))) {
        branch.own.add(n.sha);
        claimed.add(n.sha);
      }
    }
  }

  // A node claimed by several branches (a loop forked from a branch) stands on the deepest one.
  const ownerOf = new Map();
  for (const n of nodes) {
    let best = null;
    for (const branch of branches) {
      if (!branch.own.has(n.sha)) continue;
      const forkClock = branch.fork?.clock ?? -Infinity;
      const bestClock = best?.fork?.clock ?? -Infinity;
      if (!best || forkClock > bestClock || (forkClock === bestClock && branch.line.name > best.line.name)) best = branch;
    }
    if (best) ownerOf.set(n.sha, best.line);
  }

  // Lanes: claim the lowest lane free at the fork's game time; a lane frees past its line's tip.
  // Lane 0 is the main line's and is never free.
  const lanes = new Map();
  if (mainLine) lanes.set(mainLine.name, 0);
  const laneFreeAt = [Infinity];
  const endClockOf = (branch) => {
    const tip = bySha.get(branch.line.last_commit);
    if (tip) return tip.clock;
    let end = branch.fork?.clock ?? -Infinity;
    for (const n of nodes) if (branch.own.has(n.sha)) end = Math.max(end, n.clock);
    return end;
  };
  for (const branch of branches) {
    const forkClock = branch.fork?.clock ?? -Infinity;
    let lane = laneFreeAt.findIndex((freeAt, i) => i > 0 && freeAt <= forkClock);
    if (lane === -1) { lane = laneFreeAt.length; laneFreeAt.push(-Infinity); }
    laneFreeAt[lane] = endClockOf(branch);
    lanes.set(branch.line.name, lane);
  }
  const lineByName = new Map(lines.map((l) => [l.name, l]));
  const laneCount = Math.max(1, laneFreeAt.length);
  const laneX = (lane) => RULER_W + lane * LANE_DX;
  const lineOfNode = (node) => ownerOf.get(node.sha) ?? mainLine ?? null;
  const laneOfNode = (node) => lanes.get(lineOfNode(node)?.name) ?? 0;

  // Vertical positions: y is a pure function of the game clock. Every node at one game minute
  // shares one height across every lane. A same-lane same-clock stack (a seal commit and its
  // turn commit land together) fans out by SAME_STEP, and the band grows to hold the stack so
  // the next band never overlaps it.
  const clocks = [...new Set(ordered.map((n) => n.clock))].sort((a, b) => a - b);
  const stackOf = new Map(); // `${lane}:${clock}` -> nodes in global order
  for (const n of ordered) {
    const key = `${laneOfNode(n)}:${n.clock}`;
    const stack = stackOf.get(key) ?? [];
    stack.push(n);
    stackOf.set(key, stack);
  }
  const nudgeOf = new Map();   // sha -> index inside its same-lane same-clock stack
  const bandExtra = new Map(); // clock -> extra band height the tallest stack needs
  for (const [key, stack] of stackOf) {
    stack.forEach((n, i) => nudgeOf.set(n.sha, i));
    const clock = Number(key.slice(key.indexOf(":") + 1));
    bandExtra.set(clock, Math.max(bandExtra.get(clock) ?? 0, (stack.length - 1) * SAME_STEP));
  }
  const clockY = new Map();
  const breaks = [];
  let cursor = PAD_TOP;
  clocks.forEach((clock, index) => {
    if (index > 0) {
      const delta = clock - clocks[index - 1];
      cursor += bandExtra.get(clocks[index - 1]) ?? 0;
      if (delta <= COMPRESS_MIN) cursor += Math.max(MIN_STEP, delta * GAP_SCALE);
      else { breaks.push(cursor + BREAK_H / 2); cursor += BREAK_H; }
    }
    clockY.set(clock, cursor);
  });
  const nodeY = (node) => (clockY.get(node.clock) ?? PAD_TOP) + (nudgeOf.get(node.sha) ?? 0) * SAME_STEP;
  const height = clocks.length
    ? cursor + (bandExtra.get(clocks[clocks.length - 1]) ?? 0) + PAD_BOTTOM
    : PAD_TOP + PAD_BOTTOM;

  const rows = ordered.map((node) => {
    const line = lineOfNode(node);
    const lane = laneOfNode(node);
    return { node, line, lane, x: laneX(lane), y: nodeY(node) };
  });

  // Spines: the vertical stroke of each line, from its fork point (or the top for main) to its
  // own tip -- main ends at its own last node, not at the graph's bottom. A merged line's spine
  // fades; a loop line's spine dashes.
  const spines = [];
  if (mainLine && ordered.length) {
    const mainRows = rows.filter((row) => row.line === mainLine);
    spines.push({ line: mainLine, lane: 0, x: laneX(0), y1: nodeY(ordered[0]),
      y2: mainRows.length ? mainRows[mainRows.length - 1].y : nodeY(ordered[0]),
      loop: false, faded: false });
  }
  for (const branch of branches) {
    const ownRows = rows.filter((row) => branch.own.has(row.node.sha));
    if (!ownRows.length) continue;
    const lane = lanes.get(branch.line.name);
    spines.push({
      line: branch.line,
      lane,
      x: laneX(lane),
      y1: branch.fork ? nodeY(branch.fork) : ownRows[0].y,
      y2: ownRows[ownRows.length - 1].y,
      loop: branch.line.kind === "loop" || Number(branch.line.loop) > 0,
      faded: branch.line.status === "merged",
    });
  }

  // Edges: one per parent link. The branch's color owns the edge in both directions -- a fork
  // edge takes the child's lane color, a merge edge the merged parent's.
  const edges = [];
  for (const row of rows) {
    const parents = Array.isArray(row.node.parents) ? row.node.parents : [];
    for (const parentSha of parents) {
      const parent = bySha.get(parentSha);
      if (!parent) continue;
      const parentLane = laneOfNode(parent);
      const parentLine = lineOfNode(parent);
      edges.push({
        x1: laneX(parentLane), y1: nodeY(parent),
        x2: row.x, y2: row.y,
        lane: row.lane !== 0 ? row.lane : parentLane,
        curved: parentLane !== row.lane,
        faded: (row.line?.status === "merged" && row.lane !== 0) ||
               (parentLine?.status === "merged" && parentLane !== 0),
      });
    }
  }

  // A loop marker rings the tip node of any loop line.
  const loopTipShas = new Set();
  for (const line of lines) {
    if ((line.kind === "loop" || Number(line.loop) > 0) && bySha.has(line.last_commit)) {
      loopTipShas.add(line.last_commit);
    }
  }

  // The ruler labels a clock band when its calendar projection differs from the band above --
  // the label sits at the band's height, where every node at that game minute stands.
  const rulerRows = [];
  let lastLabel = "";
  for (const clock of clocks) {
    const node = ordered.find((n) => n.clock === clock && isRecord(n.when));
    if (!node) continue;
    const label = JSON.stringify(node.when);
    if (label !== lastLabel) { rulerRows.push({ y: clockY.get(clock), when: node.when }); lastLabel = label; }
  }

  return {
    rows, lanes, spines, edges, breaks, rulerRows,
    width: RULER_W + (laneCount - 1) * LANE_DX + RIGHT_PAD,
    height,
    mainLine,
    lineByName,
    loopTipShas,
  };
}

export function createComponent(React) {
  const h = React.createElement;
  const { useState, useEffect, useMemo, useRef } = React;

  return function TimelinePanel(props) {
    const api = props.api ?? {};
    const [answer, setAnswer] = useState(undefined);
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);
    const [hoverSha, setHoverSha] = useState(null);
    const [branchTarget, setBranchTarget] = useState(null);
    const [branchName, setBranchName] = useState("");
    const [branchBusy, setBranchBusy] = useState(false);
    const [branchError, setBranchError] = useState(null);
    const generation = useRef(0);
    // The words of the last answer that actually arrived, kept so the chrome of a failure this
    // panel raised itself stays in the language the player was reading a moment ago.
    const [lastUi, setLastUi] = useState(null);

    async function request(method, params = {}) {
      if (!api.invoke) throw { code: "runtime_unavailable", message: "this host cannot reach the game runtime" };
      const result = await api.invoke(method, params);
      if (!result?.ok) throw { code: result?.error?.code ?? "", message: result?.error?.message ?? "" };
      return result.data;
    }

    async function load() {
      const current = ++generation.current;
      setBusy(true);
      try {
        const data = await request("timeline.graph");
        if (current !== generation.current) return;
        if (isRecord(data?.ui)) setLastUi(data.ui);
        if (isRecord(data) && (data.status === "error" || isRecord(data.error))) {
          setError(refusalOf(isRecord(data.error) ? data.error : { message: "the graph read failed" }));
        } else {
          setAnswer(data);
          setError(null);
        }
      } catch (err) {
        // A stale load must not overwrite a newer one's state; a fresh failure must surface.
        if (current !== generation.current) return;
        setError(refusalOf(err));
      } finally {
        if (current === generation.current) setBusy(false);
      }
    }

    useEffect(() => { void load(); return () => { generation.current++; }; }, [api]);
    // The agent half pushes "timeline-changed" after every committed turn and every branch; the
    // push carries no payload, so a shape change upstream can never desynchronise the panel.
    useEffect(() => {
      if (!api.subscribeExt) return undefined;
      const unsubscribe = api.subscribeExt((event) => {
        if (!event || !event.type || event.type === "timeline-changed") void load();
      });
      return typeof unsubscribe === "function" ? unsubscribe : undefined;
    }, [api]);

    const ui = (isRecord(answer) && isRecord(answer.ui) && answer.ui) || lastUi;
    const t = (key, fallback) => word(ui, "timeline", key, fallback);
    const said = (failure) => word(ui, "errors", failure.code, word(ui, "errors", "unknown"));
    const atTime = (when) => fill(t("at"), whenValues(when));

    const graph = useMemo(
      () => (answer && answer.status !== "unbound" ? layoutGraph(answer) : null),
      [answer]);

    async function confirmBranch() {
      if (!branchTarget || branchBusy) return;
      setBranchBusy(true);
      setBranchError(null);
      try {
        const params = { commit: branchTarget.sha };
        const name = branchName.trim();
        if (name) params.name = name;
        await request("timeline.branch", params);
        setBranchTarget(null);
        setBranchName("");
        setHoverSha(null);
        // The success push refreshes the graph; the explicit reload covers a host without push.
        void load();
      } catch (err) {
        setBranchError(refusalOf(err));
      } finally {
        setBranchBusy(false);
      }
    }

    const landmark = { role: "region", ...(answer ? { "aria-label": t("title") } : {}) };

    // Before the first answer there are no words yet, so the panel shows none.
    if (answer === undefined && !error) {
      return h("div", { className: "coc-tl", ...landmark },
        h("p", { className: "coc-tl-note", role: "status" }, "…"));
    }

    const header = h("div", { className: "coc-tl-head" },
      h("span", { className: "coc-tl-title" }, answer ? t("title") : "…"),
      h("button", { type: "button", className: "coc-tl-refresh", disabled: busy,
        onClick: () => void load() }, answer ? t("refresh") : "…"));

    const errorBlock = error && h("div", { className: "coc-tl-error", role: "alert" },
      h("strong", null, t("errorTitle")), " — ", said(error),
      error.message ? h("details", null,
        h("summary", null, word(ui, "errors", "details")),
        h("p", null, error.message)) : null);

    if (answer?.status === "unbound") {
      return h("div", { className: "coc-tl", ...landmark },
        header, errorBlock, h("p", { className: "coc-tl-note" }, t("unbound")));
    }

    /* --- The graph -------------------------------------------------------- */

    let canvas = null;
    let tooltip = null;
    if (graph && graph.rows.length) {
      const { rows, spines, edges, breaks, rulerRows } = graph;
      // The palette is closed by spec: a seventh concurrent lane wraps to the main hue. Lanes are
      // time-separated by construction, so a wrap can only collide with a line long ended.
      const laneClass = (lane) => `coc-tl-lane-${lane % LANE_PALETTE}`;
      const hoverRow = hoverSha ? rows.find((row) => row.node.sha === hoverSha) ?? null : null;

      const svgChildren = [];

      for (const [index, spine] of spines.entries()) {
        svgChildren.push(h("line", {
          key: `spine:${spine.line.name}:${index}`,
          className: `coc-tl-spine ${laneClass(spine.lane)}`,
          x1: spine.x, y1: spine.y1, x2: spine.x, y2: spine.y2,
          ...(spine.loop ? { "data-loop": "1" } : {}),
          ...(spine.faded ? { "data-faded": "1" } : {}),
        }));
      }

      for (const [index, edge] of edges.entries()) {
        svgChildren.push(h("path", {
          key: `edge:${index}`,
          className: `coc-tl-edge ${laneClass(edge.lane)}`,
          d: edge.curved
            ? `M ${edge.x1} ${edge.y1} Q ${edge.x1} ${edge.y2} ${edge.x2} ${edge.y2}`
            : `M ${edge.x1} ${edge.y1} L ${edge.x2} ${edge.y2}`,
          ...(edge.faded ? { "data-faded": "1" } : {}),
        }));
      }

      // Compressed time bands: a dashed line across the lanes plus the // break mark.
      for (const [index, breakY] of breaks.entries()) {
        const markX = RULER_W + 8;
        svgChildren.push(h("g", { key: `break:${index}` },
          h("line", { className: "coc-tl-break-line",
            x1: RULER_W + 2, y1: breakY, x2: graph.width - RIGHT_PAD + 40, y2: breakY }),
          h("path", { className: "coc-tl-break-mark",
            d: `M ${markX} ${breakY + 4} l 4 -8 M ${markX + 5} ${breakY + 4} l 4 -8` })));
      }

      for (const [index, row] of rulerRows.entries()) {
        svgChildren.push(h("g", { key: `ruler:${index}` },
          h("line", { className: "coc-tl-ruler-tick",
            x1: RULER_W - 7, y1: row.y, x2: RULER_W - 2, y2: row.y }),
          h("text", { className: "coc-tl-ruler", x: RULER_W - 11, y: row.y + 3.5,
            textAnchor: "end" }, atTime(row.when))));
      }

      // The "you are here" marker rides the active line's tip.
      const activeLine = graph.lineByName.get(answer?.active);
      const activeTip = activeLine && rows.find((row) => row.node.sha === activeLine.last_commit);
      if (activeTip) {
        svgChildren.push(h("g", { key: "here" },
          h("circle", { className: "coc-tl-here-ring", cx: activeTip.x, cy: activeTip.y, r: 9.5 }),
          h("text", { className: "coc-tl-here-label", x: activeTip.x + 14, y: activeTip.y + 3.5 },
            t("youAreHere"))));
      }

      for (const row of rows) {
        const { node } = row;
        const kind = text(node.kind);
        const clickable = kind === "turn" && !branchBusy;
        const faded = row.line?.status === "merged" && row.lane !== 0;
        const loopMark = graph.loopTipShas.has(node.sha);
        const openBranch = () => {
          setBranchError(null);
          setBranchName("");
          setBranchTarget({ sha: node.sha, turn: node.turn, when: node.when,
            line: row.line?.name ?? "" });
        };
        const handlers = {
          onMouseEnter: () => setHoverSha(node.sha),
          onMouseLeave: () => setHoverSha((current) => (current === node.sha ? null : current)),
          ...(clickable ? {
            onClick: openBranch,
            onKeyDown: (e) => {
              if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openBranch(); }
            },
          } : {}),
        };
        const cls = `coc-tl-node ${laneClass(row.lane)}${clickable ? " is-clickable" : ""}`;
        const a11y = clickable ? {
          tabIndex: 0, role: "button",
          "aria-label": `${fill(t("turn"), { n: node.turn })} · ${atTime(node.when)}`,
        } : {};
        const attrs = { key: node.sha, className: cls, ...(faded ? { "data-faded": "1" } : {}),
          ...a11y, ...handlers };
        let glyph;
        if (kind === "setup") {
          glyph = h("g", attrs, h("circle", { className: "coc-tl-ring", cx: row.x, cy: row.y, r: 5 }));
        } else if (kind === "merge") {
          glyph = h("g", attrs,
            h("circle", { className: "coc-tl-join", cx: row.x, cy: row.y, r: 6 }),
            h("circle", { className: "coc-tl-dot", cx: row.x, cy: row.y, r: 2.4 }));
        } else if (kind === "worldline") {
          glyph = h("g", attrs,
            h("line", { className: "coc-tl-tick", x1: row.x - 4.5, y1: row.y, x2: row.x + 4.5, y2: row.y }));
        } else {
          glyph = h("g", attrs, h("circle", { className: "coc-tl-dot", cx: row.x, cy: row.y, r: 5 }));
        }
        // A loop line's tip node carries the loop marker ring.
        svgChildren.push(glyph);
        if (loopMark) {
          svgChildren.push(h("circle", { key: `loop:${node.sha}`,
            className: `coc-tl-loopmark ${laneClass(row.lane)}`, cx: row.x, cy: row.y, r: 8.5 }));
        }
      }

      canvas = h("svg", { className: "coc-tl-svg", width: graph.width, height: graph.height,
        viewBox: `0 0 ${graph.width} ${graph.height}`, role: "img" }, ...svgChildren);

      if (hoverRow) {
        const { node } = hoverRow;
        const kind = text(node.kind);
        // A turn node's caption is its turn number; the bare kind would say the same twice.
        const kindCaption = kind === "turn" && Number.isFinite(node.turn)
          ? fill(t("turn"), { n: node.turn }) : t(`kind.${kind}`);
        const statusWord = hoverRow.line ? t(text(hoverRow.line.status) || "active") : "";
        const loopWord = hoverRow.line && Number(hoverRow.line.loop) > 0
          ? ` · ${fill(t("loop"), { n: hoverRow.line.loop })}` : "";
        tooltip = h("div", { className: "coc-tl-tip",
          style: { left: Math.min(hoverRow.x + 14, Math.max(8, graph.width - 208)),
                   top: Math.max(4, hoverRow.y - 14) } },
          h("div", { className: "coc-tl-tip-kind" }, kindCaption),
          h("div", { className: "coc-tl-tip-title" }, text(node.title)),
          h("div", { className: "coc-tl-tip-time" }, atTime(node.when)),
          hoverRow.line ? h("div", { className: "coc-tl-tip-line" },
            `${hoverRow.line.name}${statusWord ? ` · ${statusWord}` : ""}${loopWord}`) : null);
      }
    }

    const branchCard = branchTarget && h("div", { className: "coc-tl-branch", role: "dialog",
      "aria-label": t("branch.title") },
      h("div", { className: "coc-tl-branch-title" }, t("branch.title")),
      h("p", { className: "coc-tl-branch-body" }, fill(t("branch.body"), {
        when: atTime(branchTarget.when),
        line: branchTarget.line,
        turn: branchTarget.turn ?? "",
      })),
      h("input", { type: "text", value: branchName, disabled: branchBusy,
        placeholder: t("branch.name"), "aria-label": t("branch.name"),
        onChange: (e) => setBranchName(e.target.value) }),
      branchError && h("p", { className: "coc-tl-branch-error", role: "alert" }, said(branchError),
        branchError.message ? h("details", null,
          h("summary", null, word(ui, "errors", "details")),
          h("p", null, branchError.message)) : null),
      h("div", { className: "coc-tl-branch-actions" },
        h("button", { type: "button", className: "coc-tl-branch-cancel", disabled: branchBusy,
          onClick: () => { setBranchTarget(null); setBranchError(null); } }, t("branch.cancel")),
        h("button", { type: "button", className: "coc-tl-branch-confirm", disabled: branchBusy,
          onClick: () => void confirmBranch() },
          branchBusy ? t("branch.busy") : t("branch.confirm"))));

    return h("div", { className: "coc-tl", ...landmark },
      header,
      answer?.truncated ? h("div", { className: "coc-tl-truncated" }, t("truncated")) : null,
      errorBlock,
      h("div", { className: "coc-tl-scroll" }, canvas, tooltip),
      branchCard);
  };
}
