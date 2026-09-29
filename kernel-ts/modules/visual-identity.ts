/**
 * Contract §152.4: one printed visual is one node. The publication gate asks, of every drafted visual that overlaps a
 * published one on the same page, whether the two are one print; the independent visual reviewer answers; the answers
 * are kept in `module.json` (`reading.visual_identity`), and a same-print answer about two published nodes becomes a
 * `variant-of` relation from the later node to the earlier one. Geometry only raises the question (`visual-identity-shape`).
 */
import { RpcError } from '../errors.js';
import { canonicalJson, compareUnicode, jsonDigest } from '../json.js';
import { ModuleGraph } from '../read/module-graph.js';
import { array, number, row, string, type Row } from '../read/values.js';
import { collision, crops, identityCandidate, identityView, type IdentityVerdict } from './visual-identity-shape.js';

/** A job whose identity review could not answer is held this many times at most; the last hold fails it. */
export const IDENTITY_HOLDS = 3;
/** The read-ahead asks a page's published pairs again until their identity job has failed this many times. */
export const IDENTITY_FAILURES = 3;
export const IDENTITY_QUESTION = 'Compare the overlapping printed visuals on this physical page and say, for each pair, whether the two crops are the same printed visual or different prints.';
/**
 * One question for the reviewer. A drafted pair names the `published` node and the `drafted` one (with its index in the
 * draft); a published pair names the `earlier` node and the `later` one, in publication order.
 */
export interface IdentityPair extends Row { key: string; page: number; published?: Row; drafted?: Row; draft_index?: number; earlier?: Row; later?: Row }

/** The bound source a module's crops are cut from. */
export function identitySource(meta: Row): string {
    return string(row(meta.source_document).file_sha256 || meta.file_sha256 || '');
}
/**
 * A pair's identity: the bound source and the two crops, not the node ids, so a verdict answers for those pixels wherever
 * they are drafted again. Symmetric in its two sides.
 */
export function identityKey(sourceSha: string, a: Row, b: Row): string {
    return jsonDigest(['visual-identity-v1', sourceSha, [canonicalJson(crops(a)), canonicalJson(crops(b))].sort(compareUnicode)]);
}
/**
 * Publication order for two published nodes: the lower generation of the first `reading.materials` row that lists the
 * node comes first; a node no row lists comes after every node one does; a tie falls to node id order.
 */
export function publicationOrder(meta: Row): (a: Row, b: Row) => number {
    const first = new Map<string, number>();
    for (const material of array(row(meta.reading).materials)) {
        if (row(material).status === 'unusable') continue;
        const generation = number(material.generation);
        for (const id of array(material.node_ids))
            if (typeof id === 'string' && (!first.has(id) || generation < first.get(id)!)) first.set(id, generation);
    }
    const at = (node: Row) => first.get(string(node.node_id)) ?? Number.POSITIVE_INFINITY;
    return (a, b) => at(a) - at(b) || compareUnicode(string(a.node_id), string(b.node_id));
}
/** The published visual nodes a question can be about: visual kinds with crops that are not already a variant. */
function survivors(graph: ModuleGraph): Row[] {
    return [...graph.nodes.values()].filter(node => identityCandidate(node) && !graph.isVariant(node));
}
/**
 * The drafted visual nodes the draft would add (a node id the published graph lacks) that collide with a published
 * survivor, one pair per collision, judged against `current`: the generation this publication lands on.
 */
export function draftIdentityPairs(filled: Row, current: Row | null, moduleId: string, sourceSha: string): IdentityPair[] {
    const graph = new ModuleGraph(moduleId, current ?? { nodes: [] }, '', {}), published = survivors(graph), pairs: IdentityPair[] = [];
    for (const [index, node] of array(filled.nodes).entries()) {
        if (!identityCandidate(node) || graph.nodes.has(string(node.node_id))) continue;
        for (const other of published) {
            const hit = collision(other, node);
            if (hit) pairs.push({ key: identityKey(sourceSha, other, node), page: hit.page, published: identityView(other), drafted: identityView(node), draft_index: index });
        }
    }
    return pairs;
}
/** Published pairs that collide and have no recorded verdict, lowest page first, each pair's earlier node first. */
export function publishedIdentityPairs(raw: Row | null, meta: Row): IdentityPair[] {
    const graph = new ModuleGraph(string(meta.id), raw ?? { nodes: [] }, '', {}), recorded = row(row(meta.reading).visual_identity);
    const nodes = survivors(graph).sort(publicationOrder(meta)), sourceSha = identitySource(meta), pairs: IdentityPair[] = [];
    for (let i = 0; i < nodes.length; i++)
        for (let j = i + 1; j < nodes.length; j++) {
            const hit = collision(nodes[i], nodes[j]);
            if (!hit) continue;
            const key = identityKey(sourceSha, nodes[i], nodes[j]);
            if (!Object.hasOwn(recorded, key)) pairs.push({ key, page: hit.page, earlier: identityView(nodes[i]), later: identityView(nodes[j]) });
        }
    return pairs.sort((a, b) => a.page - b.page);
}
/** Keep each verdict under its pair's key, with what it was about and which job asked. */
export function recordIdentityVerdicts(meta: Row, verdicts: IdentityVerdict[], pairs: IdentityPair[], jobId: string): void {
    const byKey = new Map(pairs.map(pair => [pair.key, pair]));
    meta.reading ??= {};
    const book = meta.reading.visual_identity = { ...row(meta.reading.visual_identity) };
    for (const verdict of verdicts) {
        const pair = byKey.get(verdict.key);
        if (!pair) continue;
        const [a, b] = pair.published ? [pair.published, pair.drafted!] : [pair.earlier!, pair.later!];
        book[verdict.key] = { verdict: verdict.verdict, reason: verdict.reason, page: pair.page, nodes: [a.node_id, b.node_id],
            ...(verdict.region_correspondence ? { region_correspondence: verdict.region_correspondence } : {}), job_id: jobId, generation: meta.generation ?? 0 };
    }
}
/**
 * The gate on a draft's new visual nodes. A collision without a recorded verdict is pending: the host asks the reviewer
 * and publishes again. A drafted node the reviewer found to be the same print as a published one is refused for the
 * reader's repair round, with what the repair needs to extend the published node instead. A different print stands.
 */
export function judgeDraftIdentity(pairs: IdentityPair[], meta: Row): void {
    const recorded = row(row(meta.reading).visual_identity);
    const pending = pairs.filter(pair => !Object.hasOwn(recorded, pair.key));
    if (pending.length)
        throw new RpcError('needs', `${pending.length} drafted visual crop(s) overlap published ones on the same page; the independent visual reviewer has not said whether they are the same print`, {
            fix: 'show both crops of each pair in details.pairs to the independent visual reviewer and publish again with its verdicts as identity_review_path',
            details: { reason: 'visual_identity_pending', pairs: pending },
        });
    const same = pairs.filter(pair => row(recorded[pair.key]).verdict === 'same');
    if (!same.length) return;
    const [first] = same, drafted = first.drafted!, existing = first.published!;
    const others = same.slice(1).map(pair => `${string(pair.drafted!.node_id)} (published as ${string(pair.published!.node_id)})`);
    throw new RpcError('invalid_params', `${string(drafted.node_id)} is the same printed visual as the published ${string(existing.node_id)}: the independent visual review compared both crops on physical page ${first.page}${others.length ? `; so are ${others.join(', ')}` : ''}`, {
        fix: `Delete ${string(drafted.node_id)} from the draft and do not create another node for this print. List ${string(existing.node_id)} in the draft instead, with its published image_sources (details.existing.image_sources) exactly as they are. `
            + `Add to it only map regions it does not already have (details.existing.map_regions lists the ones it has), each with source_asset ${string(existing.node_id)} and a source_box in the frame of that node's own crop: a page coordinate p lies at (p - x0) / (x1 - x0) within a crop box [x0, y0, x1, y1]. `
            + `Point every claim that named ${string(drafted.node_id)} at ${string(existing.node_id)}. Keep everything else in the draft as it is.`,
        details: { reason: 'reading_failed', rule: 'same_print_duplicate', path: `/nodes/${first.draft_index}`, drafted, existing,
            duplicates: same.map(pair => ({ drafted: pair.drafted!.node_id, existing: pair.published!.node_id, page: pair.page, path: `/nodes/${pair.draft_index}` })) },
    });
}
/**
 * Write `variant-of` from the later node to the earlier one for each same-print verdict about two published nodes, into
 * `graph` (a clone the caller publishes). A pair whose later node already leads elsewhere is left alone, so every node
 * keeps one survivor. Returns the relations written.
 */
export function writeVariants(graph: Row, verdicts: IdentityVerdict[], pairs: IdentityPair[], jobId: string, generation: number): Row[] {
    const byKey = new Map(pairs.map(pair => [pair.key, pair])), written: Row[] = [];
    graph.relations = array(graph.relations);
    for (const verdict of verdicts) {
        const pair = byKey.get(verdict.key);
        if (verdict.verdict !== 'same' || !pair?.earlier || !pair.later) continue;
        const view = new ModuleGraph(string(graph.module_id), graph, '', {});
        const later = view.nodes.get(string(pair.later.node_id)), earlier = view.nodes.get(string(pair.earlier.node_id));
        if (!later || !earlier || view.isVariant(later) || view.survivorOf(earlier).node_id === later.node_id) continue;
        // Not the id a reader's own `variant-of` claim derives (`rel-<subject>-variant-of-<object>`): re-assembling that
        // claim at a later publication would replace the reviewed correspondence with an empty relation.
        const relation = { relation_id: `rel-identity-${string(later.node_id)}-to-${string(earlier.node_id)}`, relation_kind: 'variant-of',
            from_node_id: later.node_id, to_node_id: earlier.node_id,
            properties: { identity_review: { key: verdict.key, job_id: jobId, generation },
                ...(verdict.region_correspondence ? { region_correspondence: verdict.region_correspondence } : {}) } };
        graph.relations = [...graph.relations.filter((rel: Row) => rel.relation_id !== relation.relation_id), relation];
        written.push(relation);
    }
    return written;
}
