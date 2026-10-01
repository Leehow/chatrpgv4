/**
 * Contract §165.4 and §165.5.2: what the speech edit lane checks about a line's structure, and how an edit reaches the
 * player's card. Structure only: a count, a token, a quotation mark by its Unicode property, a span by its markers.
 * Nothing here reads a line for meaning; whether an edit changed a fact is Jev's question (§165.4 gate 3).
 */

/** One `speech` row of a delivery, as the kernel recorded it and the card was drawn with (§40.2). */
export interface SpeechRow {who: Record<string, unknown>; text: string; [key: string]: unknown}

/** The say tokens exactly as the kernel's speech pass writes them after repair (§40.1). */
const SAY_TOKEN = /\{\{say:[^}\n]*\}\}|\{\{\/say\}\}/g;
const MARKER_SYNTAX = /\{\{|\}\}/;
/** §139: which characters are quotation marks is Unicode's `Quotation_Mark` property; no mark is listed here. */
const QUOTATION_MARK = /^\p{Quotation_Mark}$/u;

/**
 * Gate 1 (§165.4): the lane's answer is `{lines: [...]}` with exactly one non-empty line per NPC row, in order, and no
 * marker syntax. Each line comes back trimmed. Anything else drops the whole edit.
 */
export function shapeLines(parsed: unknown, count: number): {ok: true; lines: string[]} | {ok: false; detail: string} {
  const lines = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as {lines?: unknown}).lines : undefined;
  if (!Array.isArray(lines)) return {ok: false, detail: "the answer carries no lines list"};
  if (lines.length !== count) return {ok: false, detail: `the answer carries ${lines.length} lines for ${count} NPC lines`};
  const out: string[] = [];
  for (const [index, line] of lines.entries()) {
    if (typeof line !== "string" || !line.trim()) return {ok: false, detail: `line ${index + 1} is not a non-empty string`};
    if (MARKER_SYNTAX.test(line)) return {ok: false, detail: `line ${index + 1} carries marker syntax`};
    out.push(line.trim());
  }
  return {ok: true, lines: out};
}

/** The quotation marks a line opens with and closes with, and what lies between. */
function frame(line: string): {lead: string[]; body: string; trail: string[]} {
  const units = [...line];
  let start = 0;
  while (start < units.length && QUOTATION_MARK.test(units[start])) start++;
  let end = units.length;
  while (end > start && QUOTATION_MARK.test(units[end - 1])) end--;
  return {lead: units.slice(0, start), body: units.slice(start, end).join(""), trail: units.slice(end)};
}

/**
 * Gate 2 (§165.4): an edited line opens and closes with the same quotation marks as its original, compared after
 * §139's normalisation -- every quotation mark is one class, so only how many open and close the line counts. A line
 * that passes is returned wearing its original's own marks (§139: the delivered text's characters, never the model's
 * retyping of them); one that fails returns undefined, and that line keeps its original.
 */
export function keepQuotationMarks(original: string, edited: string): string | undefined {
  const before = frame(original), after = frame(edited);
  if (before.lead.length !== after.lead.length || before.trail.length !== after.trail.length) return undefined;
  return before.lead.join("") + after.body + before.trail.join("");
}

/**
 * §165.5.2: the card's marked text with the body of each edited say span replaced by its edited line, and the card's
 * speech with each edited row's text replaced. The i-th span is `speech[i]`; a span's trimmed body must be that row's
 * text, the span count must be the row count, and every byte outside the edited bodies -- markers, receipts, the
 * whitespace inside a span around its words -- stays as it was. Anything that does not pair returns undefined.
 */
export function spliceSpeech(markedText: string, speech: readonly SpeechRow[], edited: ReadonlyMap<number, string>):
  {marked_text: string; speech: SpeechRow[]} | undefined {
  if ([...edited.keys()].some(index => !Number.isSafeInteger(index) || index < 0 || index >= speech.length)) return undefined;
  const pieces: string[] = [];
  let at = 0, open: number | undefined, span = 0;
  for (const match of markedText.matchAll(SAY_TOKEN)) {
    const closing = match[0] === "{{/say}}";
    if (!closing) {
      if (open !== undefined) return undefined;
      open = match.index + match[0].length;
      continue;
    }
    if (open === undefined || span >= speech.length) return undefined;
    const body = markedText.slice(open, match.index), words = body.trim();
    if (words !== speech[span].text) return undefined;
    const line = edited.get(span);
    if (line !== undefined) {
      const lead = body.length - body.trimStart().length, trail = body.length - body.trimEnd().length;
      pieces.push(markedText.slice(at, open), body.slice(0, lead), line, body.slice(body.length - trail));
      at = match.index;
    }
    open = undefined;
    span++;
  }
  if (open !== undefined || span !== speech.length) return undefined;
  pieces.push(markedText.slice(at));
  return {marked_text: pieces.join(""), speech: speech.map((row, index) => edited.has(index) ? {...row, text: edited.get(index)!} : row)};
}

/**
 * §165.5.2: the one §132 patch an edit lands as -- the spliced `marked_text`, the edited `speech`, and the original
 * marked text under `speech_original` so the transcript can still fold the Keeper's plain copy (§165.5.3). The
 * original is always the delivery's own marked text, so a second patch of the same turn keeps the first original.
 */
export function speechEditPatch(markedText: string, speech: readonly SpeechRow[], edited: ReadonlyMap<number, string>):
  Record<string, unknown> | undefined {
  const spliced = spliceSpeech(markedText, speech, edited);
  return spliced && {marked_text: spliced.marked_text, speech: spliced.speech, speech_original: {marked_text: markedText}};
}
