/**
 * Contract §152.4: the geometry that asks whether two crops of one book might be one printed visual, and the shape of
 * the reviewer's answer. Geometry only triggers the question; whether the two are one print is the independent visual
 * reviewer's answer, never this file's. No code here reads a name, a label or any text.
 *
 * Import-free on purpose: the host's identity reviewer (`extensions/module/visual-identity-review.ts`) and the kernel's
 * publication gate (`visual-identity.ts`) run the same rules, and the host loads this file directly.
 */
type Row = Record<string, any>;
export type Box = [number, number, number, number];
export type Crop = { page: number; box: Box };
/** The node kinds a printed visual is published as. */
export const IDENTITY_KINDS: readonly string[] = ['asset', 'handout'];
export const IDENTITY_PROTOCOL = 'visual-identity-v1';
export const IDENTITY_VERDICTS: readonly string[] = ['same', 'different'];
/** Two crops on one page overlapping by at least this share of the smaller box's area raise the question. */
export const IDENTITY_OVERLAP = 0.5;
/** Longest reason a verdict keeps. */
const REASON_LIMIT = 2000;
const object = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value);
/**
 * A JSON number as either side reads one: the kernel's parser keeps integers as `bigint` and floats as `PythonFloat`
 * (a number by `valueOf`); the host's are plain numbers.
 */
function num(value: unknown): number {
    if (typeof value === 'number' || typeof value === 'bigint') return Number(value);
    const plain = object(value) && typeof value.valueOf === 'function' ? value.valueOf() : undefined;
    return typeof plain === 'number' ? plain : Number.NaN;
}
function box(value: unknown): Box | null {
    const raw = value === undefined ? [0, 0, 1, 1] : value;
    if (!Array.isArray(raw) || raw.length !== 4) return null;
    const [x0, y0, x1, y1] = raw.map(num);
    if (![x0, y0, x1, y1].every(Number.isFinite)) return null;
    return x0 >= 0 && y0 >= 0 && x1 <= 1 && y1 <= 1 && x0 < x1 && y0 < y1 ? [x0, y0, x1, y1] : null;
}
/** A node's original-page crops, one per well-formed `image_sources` row (a row without a box is the whole page). */
export function crops(node: Row | null | undefined): Crop[] {
    const sources = object(node) && object(node.properties) && Array.isArray(node.properties.image_sources) ? node.properties.image_sources : [];
    const out: Crop[] = [];
    for (const source of sources) {
        const page = object(source) ? num(source.page) : Number.NaN;
        if (!Number.isSafeInteger(page) || page < 1) continue;
        const cropBox = box(source.box);
        if (cropBox) out.push({ page, box: cropBox });
    }
    return out;
}
/** The overlap of two boxes as a share of the smaller box's area. */
export function overlapShare(a: Box, b: Box): number {
    const width = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), height = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
    if (width <= 0 || height <= 0) return 0;
    const smaller = Math.min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1]));
    return smaller > 0 ? width * height / smaller : 0;
}
/** Whether a node can be one side of the question: a visual kind with at least one crop. */
export function identityCandidate(node: Row | null | undefined): boolean {
    return object(node) && IDENTITY_KINDS.includes(node.node_kind) && crops(node).length > 0;
}
/**
 * Where two nodes collide: the first page they share on which a crop of one overlaps a crop of the other by at least
 * `IDENTITY_OVERLAP` of the smaller box; null when they do not. Both nodes' crops are of the module's one bound PDF
 * (`pdf:<module>`), so sharing a source is given by construction.
 */
export function collision(a: Row, b: Row): { page: number; a: Box; b: Box } | null {
    if (!identityCandidate(a) || !identityCandidate(b)) return null;
    for (const left of crops(a))
        for (const right of crops(b))
            if (left.page === right.page && overlapShare(left.box, right.box) >= IDENTITY_OVERLAP)
                return { page: left.page, a: left.box, b: right.box };
    return null;
}
/** What the reviewer and the refusal carry of one side: identity, crops and regions, nothing a reader has not published. */
export function identityView(node: Row): Row {
    const props = object(node.properties) ? node.properties : {};
    return {
        node_id: node.node_id, node_kind: node.node_kind, name: node.name ?? null, visibility: node.visibility ?? null,
        image_sources: Array.isArray(props.image_sources) ? props.image_sources : [],
        ...(Array.isArray(props.map_regions) && props.map_regions.length ? { map_regions: props.map_regions } : {}),
    };
}
/** Region ids of one side of a pair. */
export function regionIds(view: Row | null | undefined): string[] {
    return (object(view) && Array.isArray(view.map_regions) ? view.map_regions : [])
        .map((region: unknown) => object(region) && typeof region.region_id === 'string' ? region.region_id : null)
        .filter((id: string | null): id is string => !!id);
}
/**
 * One verdict as the kernel keeps it. `region_correspondence` maps a region of the later map to a region of the earlier
 * one, and is only accepted on a same-print answer about two published maps.
 */
export interface IdentityVerdict { key: string; verdict: 'same' | 'different'; reason: string; region_correspondence?: Record<string, string>; preview?: { file: string; image_sha256: string } }
/**
 * The reviewer's answer, checked against the pairs it was asked. Throws an `Error` naming the first malformed entry: a
 * verdict outside `same`/`different`, an empty reason, a key named twice, or a correspondence the pair cannot carry.
 * `complete` also requires one verdict for every pair (the host's check of its own child); without it an answer for a
 * pair no longer pending is ignored and a pair without an answer stays pending (the kernel's check at publication).
 * `evidence` requires the host's preview record on every verdict.
 */
export function identityVerdicts(value: unknown, pairs: readonly Row[], options: { complete?: boolean; evidence?: boolean } = {}): IdentityVerdict[] {
    if (!object(value) || !Array.isArray(value.verdicts)) throw new Error('an identity review is an object with a verdicts array');
    if (options.evidence && value.protocol !== IDENTITY_PROTOCOL) throw new Error(`an identity review names protocol ${IDENTITY_PROTOCOL}`);
    const byKey = new Map(pairs.map(pair => [pair.key, pair])), seen = new Set<string>(), out: IdentityVerdict[] = [];
    for (const [index, entry] of value.verdicts.entries()) {
        const at = `verdicts[${index}]`;
        if (!object(entry) || typeof entry.key !== 'string' || !entry.key) throw new Error(`${at} needs the key of the pair it answers`);
        if (seen.has(entry.key)) throw new Error(`${at} answers pair ${entry.key} a second time`);
        seen.add(entry.key);
        if (!IDENTITY_VERDICTS.includes(entry.verdict)) throw new Error(`${at}.verdict must be one of ${IDENTITY_VERDICTS.join(', ')}`);
        if (typeof entry.reason !== 'string' || !entry.reason.trim()) throw new Error(`${at}.reason must say what in the two crops decided it`);
        const pair = byKey.get(entry.key);
        if (!pair) {
            if (options.complete) throw new Error(`${at} answers a pair that was not asked`);
            continue;
        }
        const verdict: IdentityVerdict = { key: entry.key, verdict: entry.verdict, reason: entry.reason.trim().slice(0, REASON_LIMIT) };
        if (entry.region_correspondence !== undefined) {
            const later = regionIds(pair.later), earlier = regionIds(pair.earlier), map = entry.region_correspondence;
            if (entry.verdict !== 'same' || !later.length || !earlier.length)
                throw new Error(`${at}.region_correspondence belongs only to a same-print answer about two published maps`);
            if (!object(map) || !Object.keys(map).length) throw new Error(`${at}.region_correspondence must map at least one region`);
            for (const [from, to] of Object.entries(map))
                if (!later.includes(from) || typeof to !== 'string' || !earlier.includes(to))
                    throw new Error(`${at}.region_correspondence maps a region of the later map (${later.join(', ')}) to a region of the earlier one (${earlier.join(', ')})`);
            verdict.region_correspondence = { ...map } as Record<string, string>;
        }
        if (options.evidence) {
            const preview = entry.preview;
            if (!object(preview) || typeof preview.file !== 'string' || !preview.file || typeof preview.image_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(preview.image_sha256))
                throw new Error(`${at}.preview must name the side-by-side preview the reviewer read and its digest`);
            verdict.preview = { file: preview.file, image_sha256: preview.image_sha256 };
        }
        out.push(verdict);
    }
    if (options.complete) {
        const missing = pairs.filter(pair => !seen.has(pair.key)).map(pair => pair.key);
        if (missing.length) throw new Error(`answer every pair; no verdict for ${missing.join(', ')}`);
    }
    return out;
}
