/**
 * Contract §143.10: markup in player-facing prose. A syntax check over the text a delivery renders -- the host's own
 * say tokens and mechanics markers are already gone (`deliveryText` → `stripMarkers`, §40.4) -- for two shapes: an
 * XML/HTML-shaped tag, and a line that opens with a markdown list or heading marker. Nothing here reads a word of the
 * prose: a lone hyphen inside a sentence, a dash, a quotation mark or an ellipsis is not a shape either class names.
 * §143.17 adds the one judgement a second delivery needs: whether the markup is only a frame around the prose.
 */
import { chars } from '../read/values.js';

/** The steer a refused delivery carries; the finding on a delivered one says the same. */
export const MARKUP_STEER = 'player-facing prose carries no markup; write it as prose';
/** An opening, closing or self-closing tag with no attributes: `<text>`, `</text>`, `<br/>`. */
const TAG = /<\/?[A-Za-z_][\w-]*\s*\/?>/g;
/** A markdown bullet (`- `, `* `, `+ `), an ordered item (`1. `) or an ATX heading (`#` to `######`), at a line's start. */
const LINE_MARKER = /^[ \t]*(?:[-*+][ \t]|\d{1,9}\.[ \t]|#{1,6}(?:[ \t]|$))/;
const SHOWN = 8;

export interface Markup { tags: string[]; lines: string[] }

/** The markup the rendered delivery carries, or null. At most eight distinct tags and eight lines are named. */
export function markupInProse(rendered: string): Markup | null {
    const tags = [...new Set(rendered.match(TAG) ?? [])].slice(0, SHOWN);
    const lines = rendered.split('\n').filter(line => LINE_MARKER.test(line)).slice(0, SHOWN).map(line => chars(line.trim(), 120));
    return tags.length || lines.length ? { tags, lines } : null;
}

/** A tag's parts: the closing slash, the name, the self-closing slash. */
const TAG_PARTS = /^<(\/?)([A-Za-z_][\w-]*)\s*(\/?)>$/;

/** Contract §143.17: the tags that frame the prose, the one standing first and the one standing last. */
export interface Wrapper { leading: string | null; trailing: string | null }

/**
 * Contract §143.17: the rendered text's markup is a bare wrapper -- a frame around the prose, not a word of it -- when no
 * line opens with a list or heading marker and every tag in the text stands at its very start or its very end with
 * nothing beyond it but whitespace: an opening tag first and the closing tag of the same name last (`<text>…</text>`),
 * or one lone opening or closing tag at either end. A self-closing tag frames nothing. Positional and structural only:
 * which name a tag has never matters, only where it stands and whether the pair matches. Null when it is not one, or
 * when nothing would be left inside it.
 */
export function bareWrapper(rendered: string): Wrapper | null {
    const text = rendered.trim();
    if (text.split('\n').some(line => LINE_MARKER.test(line)))
        return null;
    const found = [...text.matchAll(TAG)];
    if (!found.length || found.length > 2)
        return null;
    const parts = found.map(match => TAG_PARTS.exec(match[0])!);
    if (parts.some(part => part[3]))
        return null;
    const first = found[0]!, last = found[found.length - 1]!;
    const atStart = first.index === 0, atEnd = last.index! + last[0].length === text.length;
    let wrapper: Wrapper;
    if (found.length === 2) {
        // Both ends: an opening tag first and its own closing tag last.
        if (!atStart || !atEnd || parts[0]![1] || !parts[1]![1] || parts[0]![2] !== parts[1]![2])
            return null;
        wrapper = { leading: first[0], trailing: last[0] };
    }
    else if (atStart)
        wrapper = { leading: first[0], trailing: null };
    else if (atEnd)
        wrapper = { leading: null, trailing: first[0] };
    else
        return null;
    return unwrap(text, wrapper) ? wrapper : null;
}

/**
 * Contract §143.17: `text` with the wrapper taken off -- the first occurrence of its leading tag and the last of its
 * trailing one -- and the ends trimmed. The caller applies it to the Keeper's own text and checks the render of what is
 * left against the rendered text unwrapped the same way.
 */
export function unwrap(text: string, wrapper: Wrapper): string {
    let out = text;
    if (wrapper.trailing) {
        const at = out.lastIndexOf(wrapper.trailing);
        if (at >= 0)
            out = out.slice(0, at) + out.slice(at + wrapper.trailing.length);
    }
    if (wrapper.leading) {
        const at = out.indexOf(wrapper.leading);
        if (at >= 0)
            out = out.slice(0, at) + out.slice(at + wrapper.leading.length);
    }
    return out.trim();
}

/** One clause naming what was found, for the refusal's message and the finding's `why`. */
export function describeMarkup(markup: Markup): string {
    const parts = [
        ...(markup.tags.length ? [`tag${markup.tags.length > 1 ? 's' : ''} ${markup.tags.join(' ')}`] : []),
        ...(markup.lines.length ? [`${markup.lines.length} line${markup.lines.length > 1 ? 's' : ''} opening with a list or heading marker`] : []),
    ];
    return parts.join('; ');
}
