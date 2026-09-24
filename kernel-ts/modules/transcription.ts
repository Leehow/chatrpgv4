/**
 * Contract §22.3.1: which passage of the original PDF a published field was read from, and whether a
 * second reading of that field read the same passage. Two readings of one span are one fact transcribed
 * twice; a different value from a different span is a contradiction. The judgement is structural -- page
 * anchors and boxes -- and never compares the values' words.
 */
import { array, clone, equal, integer, number, row, type Row } from '../read/values.js';

/** One original-page anchor: a zero-based physical page and an optional normalized box. */
export type Anchor = { page: number; box?: number[] };

/** Anchors from source refs in either shape: the reader's `{page}` (one-based) or the graph's `{pdf_index}`. */
export function anchors(refs: any): Anchor[] {
    const out: Anchor[] = [];
    for (const ref of array(refs)) {
        const item = row(ref);
        const page = integer(item.pdf_index) ? number(item.pdf_index) : integer(item.page) ? number(item.page) - 1 : null;
        if (page === null || page < 0) continue;
        const box = Array.isArray(item.box) && item.box.length === 4 ? item.box.map((value: any) => number(value)) : undefined;
        out.push(box ? { page, box } : { page });
    }
    return out;
}

/** Same page, and -- when both name a region -- regions that overlap. A page without a box is the whole page. */
function sameAnchor(a: Anchor, b: Anchor): boolean {
    if (a.page !== b.page) return false;
    if (!a.box || !b.box) return true;
    return a.box[0] < b.box[2] && b.box[0] < a.box[2] && a.box[1] < b.box[3] && b.box[1] < a.box[3];
}

/** Two spans are the same span when they share an anchor. */
export function sameSpan(a: Anchor[], b: Anchor[]): boolean {
    return a.some(left => b.some(right => sameAnchor(left, right)));
}

/** One-based physical pages, for a refusal a reader and an operator can act on. */
export function pages(span: Anchor[]): number[] {
    return [...new Set(span.map(anchor => anchor.page + 1))].sort((a, b) => a - b);
}

/**
 * The recorded span of `path` (`/nodes/<id>/...` or `/claims/<id>/...`): the longest recorded prefix, else
 * the item's own source refs -- a field published before spans were recorded answers with its node's refs.
 */
export function spanOf(spans: Row, path: string, fallback: any): Anchor[] {
    for (let at = path; at.split('/').length > 3; at = at.slice(0, at.lastIndexOf('/')))
        if (Object.hasOwn(spans, at)) return anchors(spans[at]);
    return anchors(fallback);
}

/** The field keys a drafted item writes: its top-level keys, and each of its properties separately. */
export function fieldKeys(item: Row, identity: string): string[] {
    const keys: string[] = [];
    for (const key of Object.keys(item)) {
        if (key === identity || key === 'source_refs') continue;
        if (key === 'properties' && row(item.properties) === item.properties)
            for (const property of Object.keys(item.properties)) keys.push(`/properties/${escape(property)}`);
        else keys.push(`/${escape(key)}`);
    }
    return keys;
}
const escape = (key: string): string => key.replace(/~/g, '~0').replace(/\//g, '~1');

/**
 * After an item is merged at `base`: each field it wrote gets its reading's refs added to the field's span
 * (an unrecorded span starts from the item's refs before this reading), and a field it replaced takes the
 * replacing reading's refs alone.
 */
export function recordSpans(spans: Row, base: string, drafted: Row, identity: string, before: Row | undefined, replaced: string[]): void {
    const refs = array(drafted.source_refs);
    for (const field of fieldKeys(drafted, identity)) {
        const key = base + field, prior = Object.hasOwn(spans, key) ? array(spans[key]) : before ? array(before.source_refs) : [];
        spans[key] = union(prior, refs);
    }
    for (const path of replaced) spans[path] = clone(refs);
}
function union(a: any[], b: any[]): any[] {
    const out = a.map(item => clone(item));
    for (const item of b) if (!out.some(old => equal(old, item))) out.push(clone(item));
    return out;
}

/** The recorded spans in the reader's page form, for a packet the reader and the host check both read. */
export function pageSpans(spans: Row): Row {
    const out: Row = {};
    for (const [path, refs] of Object.entries(row(spans)))
        out[path] = anchors(refs).map(anchor => ({ page: anchor.page + 1, ...(anchor.box ? { box: anchor.box } : {}) }));
    return out;
}
