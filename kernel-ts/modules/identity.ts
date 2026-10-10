/**
 * Contract §192.3/§192.4 (owner rulings 2026-10-07): the writer of one thing's copies as one. A duplicate is never deleted and
 * no id is rewritten; the kernel writes an identity relation from the later node to the earlier one
 * (`rel-identity-<later>-to-<earlier>`, `properties.identity_review`, as §152.4's `writeVariants` writes them) in a new
 * generation, and every reader then reads the later node through the earlier (`read/survivors.ts`).
 *
 * Carry (§192.4): when the relation is written, the survivor takes what only the variant has -- its names it lacks (as
 * aliases), its `source_refs`, and the properties it lacks or that merge without contradiction (`mergeValue`, publication's
 * own merge), with their field spans. A contradiction stays on the variant, still readable through it. The fields that say
 * what a node is called or where play starts are the survivor's own and never travel; a printed visual's crops and regions
 * travel only through §152.4's reviewed correspondence, so a visual carries names and references alone.
 *
 * Who decides that two nodes are one is the caller's business (DUP-03: the owner's same-name-same-page rule, or a reviewed
 * verdict); this file only writes a decision down. Nothing here reads what a name or a value means.
 */
import { join } from 'node:path';
import { RpcError } from '../errors.js';
import { isJsonObject } from '../json.js';
import { withExclusiveLock } from '../locks.js';
import { apartPairs, identityRelationId, pairKey, rawSurvivors, VISUAL_KINDS, type IdentityConflict } from '../read/survivors.js';
import { array, clone, entries, equal, normalize, number, row, string, type Row } from '../read/values.js';
import type { ModuleStore } from './store.js';
import { mergeValue } from './visual.js';
import { identitySource, publicationOrder } from './visual-identity.js';

/**
 * One decision to write: the two nodes are one thing, decided by `review` (kept on the relation as `identity_review`). Which of
 * them survives is not the caller's: the one published first (`publicationOrder`).
 */
export interface IdentityWrite { nodes: readonly [string, string]; review: Row }
/** What the survivor took from the variant, and what stayed on the variant because it contradicts the survivor. */
export interface IdentityCarry { aliases: string[]; source_refs: number; properties: string[]; kept: string[] }
export interface IdentityWritten { relation: Row; survivor: string; carried: IdentityCarry }

/**
 * The schema's own identity fields (`displayName`, `bookHandle`, `nameKeys`, `startScene`, the entrance law): what a node is
 * called and whether play starts there. A closed list of the graph contract's field names, never a judgement of content.
 */
const IDENTITY_FIELDS: readonly string[] = ['name', 'display_name', 'title', 'semantic_name', 'scene_id', 'is_start', 'is_final', 'is_entrance'];
const pointer = (key: string): string => key.replace(/~/g, '~0').replace(/\//g, '~1');

/**
 * §192.3 (lead ruling 2026-10-07): the recorded `different` verdict, by pair key, that keeps a node of `later`'s relation group
 * apart from a node of `earlier`'s, or null. A `different` verdict and an identity relation for one pair cannot both stand.
 */
export function apartVerdict(graph: Row, later: string, earlier: string, apart: ReadonlySet<string>): string | null {
    if (!apart.size) return null;
    const survivors = rawSurvivors(graph), a = survivors.group(later), b = survivors.group(earlier);
    for (const x of a) for (const y of b) if (apart.has(pairKey(x, y))) return pairKey(x, y);
    return null;
}

/**
 * Write the identity relation `later` → `earlier` into `graph` (a raw graph clone the caller publishes) and carry the
 * variant's facts onto the node that now stands for both. Returns null, writing nothing, when `later` already reads as
 * another node or `earlier` already reads as `later` (every node keeps one survivor, as `writeVariants` keeps it). Writing
 * the same decision again replaces its relation and carries nothing new. `apart`, the pairs a recorded `different` verdict
 * keeps apart (`apartPairs`): a decision that would join such a pair is refused `identity_verdict_different`, never written.
 */
export function writeIdentity(graph: Row, later: string, earlier: string, review: Row, apart: ReadonlySet<string> = new Set()): IdentityWritten | null {
    const nodes = new Map(array(graph.nodes).filter(isJsonObject).map(node => [string(node.node_id), node as Row]));
    const variant = nodes.get(later), target = nodes.get(earlier);
    if (!variant || !target)
        throw new RpcError('invalid_params', `an identity names two nodes of this graph: ${!variant ? later : earlier} is none`, { details: { later, earlier } });
    if (later === earlier)
        throw new RpcError('invalid_params', 'an identity joins two different nodes', { details: { later, earlier } });
    const visual = VISUAL_KINDS.includes(variant.node_kind) && VISUAL_KINDS.includes(target.node_kind);
    if (!visual && string(variant.node_kind) !== string(target.node_kind))
        throw new RpcError('invalid_params', `an identity joins two nodes of one kind: ${later} is ${string(variant.node_kind)}, ${earlier} is ${string(target.node_kind)}`,
            { details: { later, earlier, reason: 'cross_kind' } });
    if (!isJsonObject(review))
        throw new RpcError('invalid_params', 'an identity carries the review that decided it', { details: { field: 'identity_review' } });
    const kept = apartVerdict(graph, later, earlier, apart);
    if (kept !== null)
        throw new RpcError('invalid_params', `${later} and ${earlier} cannot be one thing: a recorded verdict says ${kept.split('\u0000').join(' and ')} are different`,
            { details: { later, earlier, reason: 'identity_verdict_different', nodes: kept.split('\u0000') } });
    const id = identityRelationId(later, earlier);
    const before = rawSurvivors({ nodes: graph.nodes, relations: array(graph.relations).filter(rel => row(rel).relation_id !== id) });
    if (before.linkedId(later) !== later || before.linkedId(earlier) === later) return null;
    const relation = { relation_id: id, relation_kind: 'variant-of', from_node_id: later, to_node_id: earlier, properties: { identity_review: clone(review) } };
    graph.relations = [...array(graph.relations).filter(rel => row(rel).relation_id !== id), relation];
    const survivor = nodes.get(rawSurvivors(graph).linkedId(later))!;
    return { relation, survivor: string(survivor.node_id), carried: carry(graph, variant, survivor, visual) };
}

/** §192.4: the variant's names, references and properties the survivor lacks, onto the survivor, with their field spans. */
function carry(graph: Row, variant: Row, survivor: Row, visual: boolean): IdentityCarry {
    const vid = string(variant.node_id), sid = string(survivor.node_id), carried: IdentityCarry = { aliases: [], source_refs: 0, properties: [], kept: [] };
    const spans = isJsonObject(graph.field_spans) ? graph.field_spans as Row : null;
    const moveSpans = (from: string, to: string): void => {
        if (!spans) return;
        for (const [path, refs] of entries(spans)) {
            if (path !== from && !path.startsWith(from + '/')) continue;
            const onto = to + path.slice(from.length), have = array(spans[onto]);
            spans[onto] = [...have, ...array(refs).filter(ref => !have.some(item => equal(item, ref)))];
        }
    };
    // Names: the variant's own name and aliases the survivor does not carry, as aliases.
    const have = new Set([survivor.name, ...array(survivor.aliases)].filter(value => typeof value === 'string').map(normalize));
    for (const name of [variant.name, ...array(variant.aliases)])
        if (typeof name === 'string' && name.trim() && !have.has(normalize(name))) { have.add(normalize(name)); carried.aliases.push(name); }
    if (carried.aliases.length) {
        survivor.aliases = mergeValue(array(survivor.aliases), carried.aliases, `/nodes/${sid}/aliases`);
        moveSpans(`/nodes/${vid}/name`, `/nodes/${sid}/aliases`);
        moveSpans(`/nodes/${vid}/aliases`, `/nodes/${sid}/aliases`);
    }
    const refs = mergeValue(array(survivor.source_refs), array(variant.source_refs), `/nodes/${sid}/source_refs`);
    carried.source_refs = refs.length - array(survivor.source_refs).length;
    if (carried.source_refs) { survivor.source_refs = refs; moveSpans(`/nodes/${vid}/source_refs`, `/nodes/${sid}/source_refs`); }
    if (visual) return carried;
    // Properties: what the survivor lacks is taken; what both hold is merged by publication's own rule, and a contradiction
    // leaves the survivor's value and keeps the variant's on the variant.
    const into = (holder: Row, key: string, value: unknown, path: string, from: string, name: string): void => {
        if (IDENTITY_FIELDS.includes(key)) return;
        if (!Object.hasOwn(holder, key)) { holder[key] = clone(value); carried.properties.push(name); moveSpans(from, path); return; }
        try {
            const merged = mergeValue(holder[key], value, path);
            if (!equal(merged, holder[key])) { holder[key] = merged; carried.properties.push(name); moveSpans(from, path); }
        }
        catch (error) {
            if (!(error instanceof RpcError)) throw error;
            carried.kept.push(name);
        }
    };
    const own: Row = survivor.properties = isJsonObject(survivor.properties) ? survivor.properties as Row : {};
    const theirs = row(variant.properties);
    for (const [key, value] of entries(theirs))
        if (key !== 'runtime_projection')
            into(own, key, value, `/nodes/${sid}/properties/${pointer(key)}`, `/nodes/${vid}/properties/${pointer(key)}`, key);
    // A node's record (`runtime_projection.record`) is what `recordOf` reads in place of its properties: the variant's record
    // goes into the survivor's record when it has one, else into the survivor's properties, which are then its record.
    const record = row(row(theirs.runtime_projection).record), ownRecord = isJsonObject(row(own.runtime_projection).record) ? row(own.runtime_projection).record as Row : null;
    for (const [key, value] of entries(record)) {
        const from = `/nodes/${vid}/properties/runtime_projection/record/${pointer(key)}`;
        if (ownRecord) into(ownRecord, key, value, `/nodes/${sid}/properties/runtime_projection/record/${pointer(key)}`, from, `runtime_projection.record.${key}`);
        else if (!Object.hasOwn(theirs, key)) into(own, key, value, `/nodes/${sid}/properties/${pointer(key)}`, from, key);
    }
    return carried;
}

/**
 * Write `writes` as one new generation of module `mid` in `store` -- the library's or a campaign fork's -- through the ordinary
 * generation writer (`ModuleStore.writeGraph`, then `module.json`), under the module's metadata lock, the lock every
 * publication of that module holds. Each pair is ordered by publication (§152.4's `publicationOrder`: the first
 * `reading.materials` generation that lists the node; a node no row lists is later; a tie falls to node id order), so the node
 * published first survives (§192.3). Each review is stamped with the generation it is published in, as `writeVariants` stamps
 * its own. Nothing is written when no decision lands. Offering a fork's generation to the library (§184.1) is the caller's.
 */
export async function publishIdentities(store: ModuleStore, mid: string, writes: readonly IdentityWrite[]): Promise<Row> {
    await store.prepare(mid);
    return withExclusiveLock(store.context.locks, join(store.moduleDir(mid), '.metadata.lock'), () => publishIdentitiesHeld(store, mid, writes));
}

/**
 * `publishIdentities` for a caller that already holds module `mid`'s metadata lock (§192.5: the read-ahead's repair, an
 * identity job's finish). `verdicts` are the `different` and `unsure` answers the same publication records in `module.json`
 * `reading.identity` (§192.1's key and record, without `generation`): they are kept before any relation is written, so no
 * write joins a pair a `different` keeps apart (an `unsure` keeps nothing apart, DUP-03b), and each is stamped with the
 * generation the publication lands on (the current one when no relation lands). The record is written whenever a verdict is
 * new, even when no relation lands.
 */
export async function publishIdentitiesHeld(store: ModuleStore, mid: string, writes: readonly IdentityWrite[],
    verdicts: readonly { key: string; record: Row }[] = []): Promise<Row> {
    const meta = await store.module(mid), raw = await store.readGraph(mid);
    if (!raw)
        throw new RpcError('campaign_not_ready', `module ${mid} has no graph yet`, { fix: 'publish identities once the book has a graph' });
    const graph = clone(raw), generation = number(meta.generation || 0) + 1, written: Row[] = [], skipped: Row[] = [];
    const added: Row[] = [];
    if (verdicts.length) {
        meta.reading = isJsonObject(meta.reading) ? meta.reading : {};
        const book = meta.reading.identity = { ...row(meta.reading.identity) };
        for (const { key, record } of verdicts) {
            if (Object.hasOwn(book, key)) continue;
            book[key] = clone(record);
            added.push(book[key]);
        }
    }
    const apart = apartPairs(row(meta.reading).identity, identitySource(meta));
    const order = publicationOrder(meta), node = (id: string): Row => array(graph.nodes).find(item => row(item).node_id === id) ?? { node_id: id };
    for (const write of writes) {
        if (!Array.isArray(write.nodes) || write.nodes.length !== 2 || write.nodes.some(id => typeof id !== 'string'))
            throw new RpcError('invalid_params', 'an identity names two node ids', { details: { field: 'nodes' } });
        const [earlier, later] = write.nodes.map(node).sort(order).map(item => string(item.node_id));
        // §192.3: a pair a recorded `different` verdict keeps apart is refused, never joined and never guessed.
        const kept = apartVerdict(graph, later, earlier, apart);
        if (kept !== null) { skipped.push({ from: later, to: earlier, reason: 'verdict_different', nodes: kept.split('\u0000') }); continue; }
        const done = writeIdentity(graph, later, earlier, { ...row(write.review), generation: row(write.review).generation ?? generation }, apart);
        if (done) written.push({ from: later, to: earlier, survivor: done.survivor, carried: done.carried });
        else skipped.push({ from: later, to: earlier, reason: 'survivor_taken' });
    }
    for (const record of added) record.generation = written.length ? generation : number(meta.generation || 0);
    // §192.3: a graph that already joins a pair a verdict keeps apart is reported, never repaired by guessing.
    const conflicts: IdentityConflict[] = rawSurvivors(graph, apart).conflicts();
    const recorded = added.length ? { recorded: added.length } : {};
    if (!written.length) {
        if (added.length) await store.writeModule(meta);
        return { generation: meta.generation ?? 0, written, skipped, ...recorded, ...(conflicts.length ? { conflicts } : {}) };
    }
    await store.writeGraph(meta, graph);
    await store.writeModule(meta);
    await store.appendBuildLog(mid, { event: 'identity', generation: meta.generation, written, skipped, ...recorded, ...(conflicts.length ? { conflicts } : {}) });
    return { generation: meta.generation, written, skipped, ...recorded, ...(conflicts.length ? { conflicts } : {}) };
}
