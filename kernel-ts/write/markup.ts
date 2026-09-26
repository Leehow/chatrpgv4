/**
 * Contract §139.10: markup in player-facing prose. A syntax check over the text a delivery renders -- the host's own
 * say tokens and mechanics markers are already gone (`deliveryText` → `stripMarkers`, §40.4) -- for two shapes: an
 * XML/HTML-shaped tag, and a line that opens with a markdown list or heading marker. Nothing here reads a word of the
 * prose: a lone hyphen inside a sentence, a dash, a quotation mark or an ellipsis is not a shape either class names.
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

/** One clause naming what was found, for the refusal's message and the finding's `why`. */
export function describeMarkup(markup: Markup): string {
    const parts = [
        ...(markup.tags.length ? [`tag${markup.tags.length > 1 ? 's' : ''} ${markup.tags.join(' ')}`] : []),
        ...(markup.lines.length ? [`${markup.lines.length} line${markup.lines.length > 1 ? 's' : ''} opening with a list or heading marker`] : []),
    ];
    return parts.join('; ');
}
