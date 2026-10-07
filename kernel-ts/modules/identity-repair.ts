/**
 * Contract §191.5 (owner rulings 2026-10-07): repairing graphs that already hold duplicates.
 *
 * The census found 88 true duplicates across 49 graphs, written before §191.1's landing check existed. When a book loads, the
 * read-ahead runs §191.1's trigger over the published graph (`publishedPairs`): every pair of two things of one kind that one
 * name or one cast row joins, which no verdict answers and which do not already read as one.
 *
 * - **Without a model** (owner ruling 2026-10-07: same name and overlapping pages merge directly; 39 of 39 true on the
 *   census): two nodes of the pair's kind with the same `name` under the kernel's `normalize` and an overlapping
 *   `source_refs` page. The kernel writes the identity relation
 *   with `identity_review: {by: "kernel", rule: "same-name-same-page"}`. This is the owner's explicit exception to the rule
 *   against hardcoded semantics, scoped to exactly this trigger: the census measured `name` against `name`, so a display name
 *   or an alias never takes this path.
 * - **Never without a verdict:** a pair the graph itself relates (any relation between a node of one and a node of the other:
 *   a member of a group, a part of a place, two people who know each other) is two things to the reader who wrote that
 *   relation, so it waits for a verdict job (§191.6: group versus member is different by default). So do two nodes one reading
 *   published together (one `reading.materials` row lists both): that reader saw both and kept them apart, which is not how
 *   the census's duplicates arose (a later reading that never saw the published node; none of Blood Road's 32 pairs).
 * - **Never at all:** a pair a reader-authored `variant-of` links. The reader said one is a state of the other (Dust to Dust's
 *   revived Virginia); §191.3 never collapses that, and no verdict job is asked to.
 * - **Everything else** is asked of an independent reader in a background identity job (`node_identity`), a few pairs a job;
 *   its `same` writes the relation (`{by: "review", ...}`), its `different` is kept in `reading.identity` as §191.1 keeps a
 *   reviewed `distinct_from`, so the pair is never asked again. Doubt never splits (DUP-03b, lead ruling 2026-10-07): an
 *   `unsure` is kept there too, under the same key, so the pair is not asked again, but it keeps nothing apart -- the cast
 *   fold still joins what it joined -- and writes no relation.
 *
 * A store takes the decisions another store of the same book already reviewed (`reviewedDecisions`): a fork the library's, the
 * library a fork's. Nothing here reads what a name, a summary or a page means.
 */
import { join } from 'node:path';
import { compareUnicode, isJsonObject, jsonDigest } from '../json.js';
import { withExclusiveLock } from '../locks.js';
import { apartPairs, isIdentityRelation, pairKey, rawSurvivors } from '../read/survivors.js';
import { array, normalize, row, string, type Row } from '../read/values.js';
import { playsFromReading } from './bound-source.js';
import { lineageHolders } from './campaign-scope.js';
import { publishIdentitiesHeld, type IdentityWrite } from './identity.js';
import { NODE_IDENTITY_PROTOCOL, nodeIdentityVerdicts, type NodeVerdict } from './node-identity-shape.js';
import { citedPages, identityPairKey, publishedPairs, type PublishedPair } from './published-duplicates.js';
import type { ModuleStore } from './store.js';
export { NODE_IDENTITY_PROTOCOL, nodeIdentityVerdicts, type NodeVerdict };
import { identitySource } from './visual-identity.js';

/** The owner's rule (§191.5), as the relation's `identity_review.rule` names it. */
export const SAME_NAME_SAME_PAGE = 'same-name-same-page';
/** The read-ahead's focus and question for an identity job (a detail job carrying `node_identity`). */
export const NODE_IDENTITY_FOCUS = 'Node identity review';
export const NODE_IDENTITY_QUESTION = 'Open both nodes\' pages and say, for each pair, whether the two nodes are one thing in the book or two different things that share a name.';
/** At most this many pairs are asked in one identity job. */
export const NODE_IDENTITY_BATCH = 4;
/** The read-ahead asks a pair again until the identity jobs that asked it have failed this many times. */
export const NODE_IDENTITY_FAILURES = 3;

/** One candidate: two survivors of one kind, the relations between their nodes, and the owner's rule when it decides the pair. */
export interface RepairPair extends PublishedPair {
    /** `reading.identity`'s key for the two survivors (§191.1). */
    key: string;
    /** `same-name-same-page` when the pair is merged without a model; null when it waits for a verdict. */
    rule: string | null;
    /** The relations between a node of one side and a node of the other, as `{relation_kind, from, to}`. */
    related: Row[];
}

const ownName = (node: Row | undefined): string => typeof node?.name === 'string' ? normalize(node.name) : '';

/**
 * §191.5's candidates in a published graph: §191.1's trigger over survivors (kernel identity relations and §152.4's visual
 * survivors, `rawSurvivors`; recorded `different` verdicts keep the cast fold apart), less the pairs a reader-authored
 * `variant-of` links, each marked with the owner's rule when it applies. `cast` are the book's cast rows (`{book, play}`).
 */
export function repairCandidates(moduleId: string, raw: Row | null, meta: Row, cast: Row[]): RepairPair[] {
    if (!raw) return [];
    const nodes = array(raw.nodes).filter(isJsonObject), byId = new Map(nodes.map(node => [string(node.node_id), node as Row]));
    const sha = identitySource(meta), recorded = row(row(meta.reading).identity), apart = apartPairs(recorded, sha);
    const standing = rawSurvivors(raw, apart);
    // The readings that published each node (`reading.materials` rows by index): two nodes one row lists are one reader's two.
    const readings = new Map<string, Set<number>>();
    for (const [index, value] of array(row(meta.reading).materials).entries()) {
        const material = row(value);
        if (material.status === 'unusable') continue;
        for (const id of array(material.node_ids)) if (typeof id === 'string') readings.set(id, (readings.get(id) ?? new Set()).add(index));
    }
    const oneReading = (x: string, y: string): boolean => [...readings.get(x) ?? []].some(index => readings.get(y)?.has(index));
    const between = new Map<string, Row[]>();
    for (const value of array(raw.relations)) {
        const rel = row(value);
        if (isIdentityRelation(rel) || typeof rel.from_node_id !== 'string' || typeof rel.to_node_id !== 'string') continue;
        const at = pairKey(rel.from_node_id, rel.to_node_id);
        between.set(at, [...(between.get(at) ?? []), rel]);
    }
    const out: RepairPair[] = [];
    for (const pair of publishedPairs(nodes, moduleId, cast, recorded, sha, id => standing.id(id), apart)) {
        const [left, right] = pair.members;
        const related = left.flatMap(x => right.flatMap(y => between.get(pairKey(x, y)) ?? []))
            .map(rel => ({ relation_kind: string(rel.relation_kind), from: string(rel.from_node_id), to: string(rel.to_node_id) }));
        if (related.some(rel => rel.relation_kind === 'variant-of')) continue;
        const named = (id: string): Row | undefined => { const node = byId.get(id); return node?.node_kind === pair.kind ? node : undefined; };
        const owner = !related.length && left.some(x => right.some(y => {
            const a = named(x), b = named(y), name = ownName(a);
            if (!a || !b || !name || name !== ownName(b) || oneReading(x, y)) return false;
            const pages = new Set(citedPages(a));
            return citedPages(b).some(page => pages.has(page));
        }));
        out.push({ ...pair, key: identityPairKey(sha, pair.kind, pair.a.node_id, pair.b.node_id), rule: owner ? SAME_NAME_SAME_PAGE : null, related });
    }
    return out;
}

/** What an identity job's reader is shown of one pair: its key, kind, why it was raised, both sides and their relations. */
export function pairTask(pair: RepairPair): Row {
    return { key: pair.key, kind: pair.kind, raised_by: pair.by, shared: pair.shared, a: { ...pair.a }, b: { ...pair.b },
        ...(pair.related.length ? { related: pair.related.map(rel => ({ ...rel })) } : {}) };
}

/** A decision a store already holds about two node ids from a review: `same` (an identity relation), `different` or `unsure`. */
export interface Decision { verdict: 'same' | 'different' | 'unsure'; nodes: [string, string]; review: Row }

/**
 * The reviewed decisions a store holds for its bound source: the identity relations a review wrote (`identity_review.by` is
 * `review`), and the `different` (a verdict job's, or §191.1's reviewed `distinct_from`) and `unsure` verdicts of
 * `reading.identity`.
 */
export function reviewedDecisions(raw: Row | null, meta: Row): Decision[] {
    const out: Decision[] = [], sha = identitySource(meta);
    for (const value of array(raw?.relations)) {
        const rel = row(value), review = row(row(rel.properties).identity_review);
        if (isIdentityRelation(rel) && review.by === 'review') out.push({ verdict: 'same', nodes: [string(rel.from_node_id), string(rel.to_node_id)], review });
    }
    for (const [key, value] of Object.entries(row(row(meta.reading).identity))) {
        const record = row(value), nodes = array(record.nodes).filter((id): id is string => typeof id === 'string');
        if ((record.verdict === 'different' || record.verdict === 'unsure') && sha && key.startsWith(sha + ':') && nodes.length === 2 && nodes[0] !== nodes[1])
            out.push({ verdict: record.verdict, nodes: [nodes[0], nodes[1]], review: record });
    }
    return out;
}

/** Another store of the same book whose reviewed decisions a repair takes: its record, its graph, and the label kept on each one taken (`imported_from`). */
export interface DecisionSource { raw: Row | null; meta: Row; label: Row }
/** A `DecisionSource` whose graph is read only when a plan is computed. */
export interface LazySource { meta: Row; label: Row; raw(): Promise<Row | null> }

/** What a repair would write: the relations, the `different` verdicts, and the pairs left for a verdict job. */
export interface RepairPlan { writes: IdentityWrite[]; verdicts: { key: string; record: Row }[]; merged: number; imported: number; open: RepairPair[]; generation: number }

/**
 * §191.5's plan for one store's published graph (`raw`, `meta`): each candidate pair a reviewed decision of `from` answers (the
 * same bound source, both nodes in this graph) decided by it, then every pair the owner's rule decides. `open` are the pairs
 * left for a verdict job.
 */
export function repairPlan(moduleId: string, raw: Row | null, meta: Row, cast: Row[], from?: DecisionSource): RepairPlan {
    const candidates = repairCandidates(moduleId, raw, meta, cast), sha = identitySource(meta);
    const decisions = from && identitySource(from.meta) === sha ? reviewedDecisions(from.raw, from.meta) : [];
    const plan: RepairPlan = { writes: [], verdicts: [], merged: 0, imported: 0, open: [], generation: Number(meta.generation ?? 0) };
    for (const pair of candidates) {
        const [left, right] = pair.members.map(ids => new Set(ids));
        const decision = decisions.find(item => left.has(item.nodes[0]) && right.has(item.nodes[1]) || left.has(item.nodes[1]) && right.has(item.nodes[0]));
        if (decision) {
            const review: Row = { ...decision.review, imported_from: { ...from!.label } };
            delete review.generation;
            if (decision.verdict === 'same') plan.writes.push({ nodes: decision.nodes, review });
            else plan.verdicts.push({ key: identityPairKey(sha, pair.kind, decision.nodes[0], decision.nodes[1]),
                record: { ...review, verdict: decision.verdict, kind: pair.kind, nodes: [...decision.nodes] } });
            plan.imported++;
        }
        else if (pair.rule === SAME_NAME_SAME_PAGE) {
            plan.writes.push({ nodes: [pair.a.node_id, pair.b.node_id], review: { by: 'kernel', rule: SAME_NAME_SAME_PAGE } });
            plan.merged++;
        }
        else plan.open.push(pair);
    }
    return plan;
}

/**
 * The last plan of each store (by module directory) that had nothing to write, with the inputs it was made from: a read-ahead
 * whose store, recorded verdicts, cast and other store are as they were reads no graph again (a steady read-ahead on Blood
 * Road's fork spent 250 ms on it). Any publication changes the graph digest or the generation, and so the key.
 */
const quiet = new Map<string, { key: string; open: RepairPair[] }>();
const planKey = (meta: Row, cast: Row[], from?: LazySource): string => jsonDigest([meta.graph_digest ?? null, meta.generation ?? 0, row(meta.reading).identity ?? {}, cast,
    from ? [from.meta.graph_digest ?? null, from.meta.generation ?? 0, row(from.meta.reading).identity ?? {}] : null]);

/** `repairPlan` over `store`'s published graph, or the remembered one when nothing it was made from changed; null with no graph. */
async function planFor(store: ModuleStore, mid: string, meta: Row, cast: Row[], from?: LazySource): Promise<RepairPlan | null> {
    const key = planKey(meta, cast, from), dir = store.moduleDir(mid), last = quiet.get(dir);
    if (last?.key === key) return { writes: [], verdicts: [], merged: 0, imported: 0, open: last.open, generation: Number(meta.generation ?? 0) };
    const raw = await store.readGraph(mid);
    if (!raw) return null;
    const plan = repairPlan(mid, raw, meta, cast, from ? { meta: from.meta, label: from.label, raw: await from.raw() } : undefined);
    if (!plan.writes.length && !plan.verdicts.length) quiet.set(dir, { key, open: plan.open });
    else quiet.delete(dir);
    return plan;
}

/**
 * §191.5 under module `mid`'s metadata lock, which the caller holds: `repairPlan` over `store`'s published graph, written as
 * one new generation (`publishIdentitiesHeld`). Returns the publication with `merged` (the owner's rule), `imported`
 * (decisions taken from `from`) and `open` (the pairs left for a verdict job, after the write).
 */
export async function repairHeld(store: ModuleStore, mid: string, cast: Row[], from?: LazySource): Promise<Row> {
    const plan = await planFor(store, mid, await store.module(mid), cast, from);
    if (!plan) return { state: 'no_graph', merged: 0, imported: 0, written: [], skipped: [], open: [] };
    return publishPlan(store, mid, cast, plan);
}

async function publishPlan(store: ModuleStore, mid: string, cast: Row[], plan: RepairPlan): Promise<Row> {
    if (!plan.writes.length && !plan.verdicts.length)
        return { state: 'unchanged', generation: plan.generation, merged: 0, imported: 0, written: [], skipped: [], open: plan.open };
    const published = await publishIdentitiesHeld(store, mid, plan.writes, plan.verdicts);
    const after = repairCandidates(mid, await store.readGraph(mid), await store.module(mid), cast);
    return { state: array(published.written).length ? 'published' : 'recorded', ...published, merged: plan.merged, imported: plan.imported,
        open: after.filter(pair => pair.rule === null) };
}

/** The keys of `open` pairs a read-ahead may ask next, given the identity jobs of the queue (`node_identity.pairs`). */
export function nextIdentityAsk(open: readonly RepairPair[], queue: readonly Row[]): string[] {
    const asked = (key: string, state: string) => queue.filter(job => job.state === state && array(row(job.node_identity).pairs).includes(key)).length;
    return open.filter(pair => !asked(pair.key, 'completed') && asked(pair.key, 'failed') < NODE_IDENTITY_FAILURES)
        .map(pair => pair.key).sort(compareUnicode).slice(0, NODE_IDENTITY_BATCH);
}

/**
 * §191.5 for the library, by its own publication: `repairPlan` over `library` (the module store of `<stateRoot>/modules`)
 * under the library module's metadata lock, taken here -- a fork's caller holds only its own fork's, which is §184.1's lock
 * order. The library is written only while no live fork holds its lineage (`lineageHolders`): that fork's own repair reaches
 * the library through §184.1's adoption, and a library publication now would end its lineage (§184.4). `from` is the loading
 * fork's record, whose reviewed decisions the library takes; a fork's load only writes into the library, while the library's
 * own read-ahead (no `from`) also returns its open pairs for an identity job. Never throws: the outcome is reported.
 */
export async function repairLibrary(library: ModuleStore, mid: string, cast: Row[], from?: LazySource): Promise<Row> {
    try {
        if (!await library.exists(mid)) return { state: 'skipped', reason: 'library_missing' };
        return await withExclusiveLock(library.context.locks, join(library.moduleDir(mid), '.metadata.lock'), async () => {
            const meta = await library.module(mid);
            if (!playsFromReading(meta)) return { state: 'skipped', reason: 'starter' };
            if (from && identitySource(from.meta) !== identitySource(meta)) return { state: 'skipped', reason: 'source_mismatch' };
            const plan = await planFor(library, mid, meta, cast, from);
            if (!plan) return { state: 'skipped', reason: 'no_graph' };
            // A fork's load only writes into the library; the library's own read-ahead also asks its open pairs.
            if (!plan.writes.length && !plan.verdicts.length && (from || !plan.open.length))
                return { state: 'unchanged', generation: plan.generation, merged: 0, imported: 0, written: [], skipped: [], open: from ? [] : plan.open };
            const holders = await lineageHolders(library.context, mid, meta);
            if (holders.length) return { state: 'skipped', reason: 'lineage_held', holders };
            return await publishPlan(library, mid, cast, plan);
        });
    }
    catch (error) { return { state: 'failed', detail: (error instanceof Error ? error.message : String(error)).slice(0, 1000) }; }
}
