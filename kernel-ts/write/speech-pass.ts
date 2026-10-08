/** Pure canonical say-token repair, shared by delivery and pinned audit selection. */
type Row = Record<string, any>;

/** Who a span resolved to. `npc` is the graph handle (a name the model may hold), never a node id. */
/** `shown` (§103.5): what the transcript shows for an untold person with no word at this table -- the token's own text, or
 * nothing when the token was the handle. Absent, the card shows `name`. */
export type Speaker = { npc: string; name: string; shown?: string } | { investigator: string; name: string } | { label: string };
export type SpeakerResolver = (name: string) => Speaker;

const TOKEN = /\{\{say:([^}\n]*)\}\}|\{\{\/say\}\}/g;
const MECHANIC = /\{\{([a-z0-9][a-z0-9:_-]*)\}\}/g;
const PARAGRAPH = /\n[ \t]*\n/;
export const NAME_LIMIT = 60;
/** Every say token, open or close; what `stripMarkers` removes beside the mechanics markers. */
export const SAY_TOKENS = /\{\{say:[^}\n]*\}\}|\{\{\/say\}\}/g;
export const isSayMarker = (marker: string): boolean => marker.startsWith('say:');

/** Repair the tokens and lift the spans out (§40.1). Returns the text with normalised tokens and the
 *  spans in text order. Repairs: an open before a close closes the previous span at the new open; an
 *  open with no close closes at the end of its paragraph or of the text; a close with no open is
 *  removed; a mechanics marker inside a span is moved to just after the span's close; a span with no
 *  words is unwrapped. */
export function speechPass(text: string, resolve: SpeakerResolver): { text: string; speech: Row[] } {
    const out: string[] = [], speech: Row[] = [];
    let open: { name: string; words: string[]; moved: string[] } | null = null;
    const close = () => {
        if (!open) return;
        const words = open.words.join('').trim();
        if (words) {
            out.push('{{/say}}');
            speech.push({ who: resolve(open.name), text: words });
        } else {
            // Nothing was said: the open token is withdrawn rather than left standing on silence.
            const at = out.lastIndexOf(`{{say:${open.name}}}`);
            if (at >= 0) out.splice(at, 1);
        }
        out.push(...open.moved);
        open = null;
    };
    const content = (chunk: string) => {
        if (!open) { out.push(chunk); return; }
        // A paragraph break ends the line whatever the Keeper forgot.
        const gap = PARAGRAPH.exec(chunk);
        if (gap) {
            content(chunk.slice(0, gap.index));
            close();
            out.push(chunk.slice(gap.index));
            return;
        }
        const kept = chunk.replace(MECHANIC, (whole: string, marker: string) => {
            if (isSayMarker(marker)) return whole;
            open!.moved.push(whole);
            return '';
        });
        out.push(kept);
        open.words.push(kept);
    };
    let last = 0;
    for (let match = TOKEN.exec(text); match; match = TOKEN.exec(text)) {
        content(text.slice(last, match.index));
        last = match.index + match[0].length;
        if (match[1] === undefined) { close(); continue; }
        const name = match[1].trim();
        close();
        if (!name || name.length > NAME_LIMIT) continue;
        open = { name, words: [], moved: [] };
        out.push(`{{say:${name}}}`);
    }
    content(text.slice(last));
    close();
    TOKEN.lastIndex = 0;
    return { text: out.join(''), speech };
}

/** §194.5: one say span of a text by its offsets: from its open token's end to where the span closes, with its speaker. */
export interface SaySpan { start: number; end: number; who: Speaker }
/**
 * §194.5: where each say span of `text` stands, closed where `speechPass` closes it -- at its close token, at the next open
 * token, at a paragraph break, or at the end of the text -- with the token's name resolved. The offsets are `text`'s own, so a
 * place found in the same text is inside a span when it lies within one.
 */
export function sayRanges(text: string, resolve: SpeakerResolver): SaySpan[] {
    const spans: SaySpan[] = [], tokens = new RegExp(TOKEN.source, 'g');
    let open: { start: number; name: string } | null = null;
    const close = (end: number) => {
        if (open && end > open.start) spans.push({ start: open.start, end, who: resolve(open.name) });
        open = null;
    };
    // A paragraph break ends the line whatever the Keeper forgot.
    const content = (from: number, to: number) => {
        const gap = open ? PARAGRAPH.exec(text.slice(from, to)) : null;
        if (gap) close(from + gap.index);
    };
    let last = 0;
    for (let match = tokens.exec(text); match; match = tokens.exec(text)) {
        content(last, match.index);
        last = match.index + match[0].length;
        close(match.index);
        if (match[1] === undefined) continue;
        const name = match[1].trim();
        if (name && name.length <= NAME_LIMIT) open = { start: last, name };
    }
    content(last, text.length);
    close(text.length);
    return spans;
}
