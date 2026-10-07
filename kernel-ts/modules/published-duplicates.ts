/**
 * Contract §191.1: one thing, one node. A reading may not publish a second node for something the graph already has.
 *
 * Blood Road's generation 55 (NR-07 survey §1): a page reading of pp. 25-26 declared `npc-daniel-mather` beside the published
 * `npc-book-4-daniel-mather`, the general store beside `scene-book-4-mather-store`, the town centre under its very same name,
 * and five more. The reader never saw the published ids, and publication merges a draft by `node_id` alone, so each one landed
 * as a second node and made the name ambiguous wherever the table used it.
 *
 * The trigger is names only, never meaning (Agents.md): a drafted node with an id the graph lacks meets a published node of the
 * same `node_kind` when the drafted node's own name or display name is one of the published node's whole names, or the
 * published node's own name or display name is one of the drafted node's (§177.1's own-name clause, both ways, under the
 * kernel's `normalize`); for two `npc` nodes also when the book's cast holds them as one individual (§188.2's both-ways fold,
 * `castNodes`). Pages are evidence in the finding, never a condition. Whether the two are one thing is the reader's to answer
 * (reuse the published id) or its reviewer's (a reviewed `distinct_from`), and an answered pair is kept in `module.json`
 * `reading.identity` so it is never raised again.
 *
 * The draft check (`checkDraft`) runs this against the claim-time view, and `module.read.finish` again inside the module lock
 * against the generation it lands on, so two readings claimed on one generation cannot both mint the same thing.
 */
import { RpcError } from '../errors.js';
import { compareUnicode, isJsonObject } from '../json.js';
import { bookNames } from '../journal/naming.js';
import { bookCast } from '../read/cast.js';
import { ModuleGraph } from '../read/module-graph.js';
import { array, integer, normalize, number, repr, row, string, type Row } from '../read/values.js';

/** The refusal's `rule`, and each finding's. */
export const DUPLICATE_RULE = 'duplicate_of_published';
/** The drafted node's field that answers a finding with "a different thing" (§191.1); reviewed, never advisory. */
export const DISTINCT_FROM = 'distinct_from';
/** A published node's summary is cut to this many characters in a finding and in `details.duplicates`. */
export const DUPLICATE_SUMMARY_CHARS = 240;

/** What a finding says about the published node: enough to reuse it or to tell it apart on the page. */
export interface PublishedView { node_id: string; node_kind: string; name: string; aliases: string[]; pages: number[]; summary: string }
/** One drafted node meeting one published node. `declared`: the drafted node already lists it in `distinct_from`. */
export interface DuplicatePair {
    path: string; draft_index: number; drafted: string; kind: string; published: PublishedView;
    by: 'name' | 'cast'; shared: string; key: string; declared: boolean;
}

/**
 * `reading.identity`'s key for one pair: the bound source's digest, the kind and the two node ids in code-point order, so
 * the key is the same whichever node was drafted (§191.1).
 */
export function identityPairKey(sourceSha: string, kind: string, a: string, b: string): string {
    const [first, second] = [a, b].sort(compareUnicode);
    return `${sourceSha}:${kind}:${first}:${second}`;
}

/** A node's physical pages, 1-based, read from page refs (`{page}`, the claim-time view) or runtime refs (`{pdf_index}`). */
function citedPages(node: Row): number[] {
    const pages = array(node.source_refs).flatMap(ref => {
        const value = row(ref);
        if (integer(value.page)) return [number(value.page)];
        if (integer(value.pdf_index)) return [number(value.pdf_index) + 1];
        return [];
    });
    return [...new Set(pages)].filter(page => page >= 1).sort((a, b) => a - b);
}

const clip = (text: string): string => {
    const chars = Array.from(text);
    return chars.length <= DUPLICATE_SUMMARY_CHARS ? text : chars.slice(0, DUPLICATE_SUMMARY_CHARS - 3).join('') + '...';
};

/** The published thing a finding names: the survivor, with every name and page of the nodes that read as it (§191.3). */
function published(node: Row, names: string[], pages: number[]): PublishedView {
    return { node_id: string(node.node_id), node_kind: string(node.node_kind), name: typeof node.name === 'string' ? node.name : '', aliases: names.filter(name => name !== node.name),
        pages, summary: clip(typeof node.summary === 'string' ? node.summary.trim() : '') };
}

/** The drafted node's `distinct_from`, the ids it declares itself apart from; empty when absent or not a list of strings. */
export function distinctFrom(node: Row): string[] {
    const value = row(node)[DISTINCT_FROM];
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
}

/** §191.1 with §191.3: the published node that stands for a node id; without a survivor map every node stands for itself. */
export type SurvivorOf = (id: string) => string;
const itself: SurvivorOf = id => id;

/**
 * Every pair of a drafted node new to `graphNodes` and a published thing it meets by §191.1's trigger, in draft order and
 * then the published nodes' order. A pair `recorded` already holds a verdict for (`reading.identity`) is not raised again.
 *
 * §191.1 pairs against survivors only (§191.3): `survivorOf` names the node that stands for each published node (at
 * publication `rawSurvivors` over the landing graph, in the check the claim's `graph-view.json` `survivors`). A variant is no
 * candidate; its names count as its survivor's, and the finding, its pages and the verdict key name the survivor, so a reader
 * that reuses the id writes under the node that stands for the thing.
 *
 * `cast` are the book's cast rows (`{book, play}`, the packet's `cast_names`); the cast join reads them exactly as `bookCast`
 * does, over the published people and the drafted ones together, and a joined copy counts as its survivor.
 */
export function publishedDuplicates(drafted: Row[], graphNodes: Row[], moduleId: string, cast: Row[], recorded: Row, sourceSha: string,
    survivorOf: SurvivorOf = itself): DuplicatePair[] {
    const graphRows = graphNodes.filter(isJsonObject), byId = new Map(graphRows.map(node => [string(node.node_id), node]));
    const fresh = drafted.flatMap((node, index) => isJsonObject(node) && typeof node.node_id === 'string' && node.node_id && !byId.has(node.node_id)
        && typeof node.node_kind === 'string' && node.node_kind !== 'module' ? [{ node: node as Row, index }] : []);
    if (!fresh.length) return [];
    /** The published node standing for `id`: its survivor when the map names a node the graph has, else itself. */
    const stands = (id: string): string => { const value = survivorOf(id); return byId.has(value) ? value : id; };
    // Each survivor with the nodes that read as it, the survivor first: the candidates and the names and pages they lend it.
    const groups = new Map<string, Row[]>();
    for (const node of graphRows) {
        const id = string(node.node_id), survivor = stands(id), members = groups.get(survivor) ?? [];
        if (id === survivor) members.unshift(node); else members.push(node);
        groups.set(survivor, members);
    }
    const kinds = new Set(fresh.map(item => string(item.node.node_kind)));
    const candidates = graphRows.filter(node => stands(string(node.node_id)) === node.node_id
        && groups.get(string(node.node_id))!.some(member => kinds.has(string(member.node_kind))));
    if (!candidates.length) return [];
    const graph = new ModuleGraph(moduleId, { nodes: [...graphRows, ...fresh.map(item => item.node)] }, '', {});
    const rows = cast.filter(isJsonObject).map((entry, index) => ({ id: `cast-row-${index}`, book: array(entry.book), play: array(entry.play) }));
    graph.castStore = rows.length ? { state: 'complete', people: rows } : null;
    /** Every whole name of a node (`bookNames`), and its own: name and display name, the handle and the id left out. */
    const names = (node: Row) => {
        const all = bookNames(graph, node), handles = new Set([graph.handle(node), string(node.node_id)]);
        const own = [...new Set([node.name, graph.displayName(node)].filter((value): value is string => typeof value === 'string' && !!value.trim())
            .map(value => value.trim()))].filter(value => !handles.has(value));
        return { all, own };
    };
    const unique = (values: string[]) => [...new Set(values)];
    /** A survivor's names for one kind: every name of each node of its group that has that kind; null when none has it. */
    const lent = new Map<string, { all: string[]; own: string[]; keys: Set<string>; pages: number[] } | null>();
    const theirsFor = (survivor: string, kind: string) => {
        const at = `${kind}:${survivor}`;
        if (!lent.has(at)) {
            const members = groups.get(survivor)!.filter(member => member.node_kind === kind), each = members.map(names);
            const all = unique(each.flatMap(item => item.all));
            lent.set(at, members.length ? { all, own: unique(each.flatMap(item => item.own)), keys: new Set(all.map(normalize)),
                pages: [...new Set(members.flatMap(citedPages))].sort((a, b) => a - b) } : null);
        }
        return lent.get(at)!;
    };
    // §188.2: the cast holds two people as one individual when both answer one row both ways; read only when people were drafted.
    const people = fresh.some(item => item.node.node_kind === 'npc') && rows.length ? bookCast(graph) : [];
    const pairs: DuplicatePair[] = [];
    for (const { node, index } of fresh) {
        const kind = string(node.node_kind), drafted = string(node.node_id), mine = names(node), mineKeys = new Set(mine.all.map(normalize));
        const declared = new Set(distinctFrom(node).map(stands));
        const individual = kind === 'npc' ? people.find(person => person.nodes.some(each => each.node_id === drafted)) : undefined;
        for (const other of candidates) {
            const id = string(other.node_id), theirs = theirsFor(id, kind);
            if (!theirs) continue;
            const key = identityPairKey(sourceSha, kind, drafted, id);
            if (groups.get(id)!.some(member => Object.hasOwn(recorded, identityPairKey(sourceSha, kind, drafted, string(member.node_id))))) continue;
            let shared = mine.own.find(name => theirs.keys.has(normalize(name))) ?? theirs.own.find(name => mineKeys.has(normalize(name)));
            let by: 'name' | 'cast' = 'name';
            if (shared === undefined && individual?.nodes.some(each => each.node_id !== drafted && stands(string(each.node_id)) === id)) {
                by = 'cast';
                shared = [...individual.printed].sort((a, b) => Array.from(b).length - Array.from(a).length)[0] ?? individual.names[0] ?? '';
            }
            if (shared === undefined) continue;
            pairs.push({ path: `/nodes/${index}`, draft_index: index, drafted, kind, published: published(other, theirs.all, theirs.pages), by, shared, key,
                declared: declared.has(id) });
        }
    }
    return pairs;
}

/** One finding's message: the drafted node, the shared name, and the published node with its names, pages and summary. */
export function duplicateMessage(pair: DuplicatePair): string {
    const target = pair.published, names = [target.name, ...target.aliases].filter(Boolean);
    const why = pair.by === 'cast'
        ? `the book's cast holds them as one individual (the row printed as ${repr(pair.shared)})`
        : `the name ${repr(pair.shared)} is already published for it`;
    return `${pair.drafted} (${pair.path}) is a new ${pair.kind} node for the published ${pair.kind} ${target.node_id}: ${why}. `
        + `Published ${target.node_id}: names ${names.map(name => repr(name)).join(', ') || 'none'}; pages ${target.pages.join(', ') || 'none'}; `
        + `summary ${repr(target.summary)}`;
}

/** Contract §191.1: the literal repair (the wording of §180.7's `ONE_BEING_FIX` and §152.4's `same_print_duplicate`). */
export const DUPLICATE_FIX = 'one thing is one node (contract 191.1): each finding names a node the graph already publishes with the same kind and name '
    + '(details.duplicates[].published: its node_id, kind, names, pages and summary). When your page describes that same thing, delete your new node '
    + 'and write under the published node_id instead: only the facts it does not already hold, cited to your pages, and point every claim, node_ref, '
    + 'ready_nodes entry, critical pointer and source need that named your id at the published id. Only when your page names a different thing that '
    + 'shares the name, keep your node and add "distinct_from": [<the published node_id>] to it; an independent reviewer checks that against the page, '
    + 'and an unsupported distinct_from refuses the reading';

/** The refusal for `pairs` (none of them declared): the first finding's message, every pair in `details.duplicates`. */
export function duplicateRefusal(pairs: DuplicatePair[]): RpcError {
    const [first] = pairs;
    return new RpcError('invalid_params', duplicateMessage(first), {
        fix: DUPLICATE_FIX,
        details: { reason: 'reading_failed', rule: DUPLICATE_RULE, path: first.path,
            duplicates: pairs.map(pair => ({ path: pair.path, drafted: pair.drafted, kind: pair.kind, by: pair.by, shared: pair.shared, published: { ...pair.published } })) as any,
            findings: pairs.map(pair => ({ path: pair.path, rule: DUPLICATE_RULE, message: duplicateMessage(pair), value: pair.shared })) as any },
    });
}

/**
 * Publication's record of the reviewed `distinct_from` answers (§191.1): for every drafted node new to the landing graph, each
 * id it lists that names a published node of its kind, kept in `reading.identity` under the pair's key. The review gate has
 * already refused the reading unless every `distinct_from` was supported (`checkReview`), so each record is `different`.
 * `reasons` gives the reviewer's reason for a draft pointer, when the review stated one. A listed copy is recorded as its
 * survivor (`survivorOf`, §191.3), the node the pair is keyed by.
 */
export function recordDistinct(meta: Row, drafted: Row[], graphNodes: Row[], sourceSha: string, jobId: string, generation: number,
    reasons: (path: string) => string | undefined, survivorOf: SurvivorOf = itself): number {
    const byId = new Map(graphNodes.filter(isJsonObject).map(node => [string(node.node_id), node]));
    const stands = (id: string): string => { const value = survivorOf(id); return byId.has(value) ? value : id; };
    let written = 0;
    for (const [index, node] of drafted.entries()) {
        if (!isJsonObject(node) || byId.has(string(node.node_id))) continue;
        for (const id of [...new Set(distinctFrom(node).map(stands))]) {
            const other = byId.get(id);
            if (!other || other.node_kind !== node.node_kind) continue;
            meta.reading ??= {};
            const book = meta.reading.identity = { ...row(meta.reading.identity) };
            const reason = reasons(`/nodes/${index}/${DISTINCT_FROM}`);
            book[identityPairKey(sourceSha, string(node.node_kind), string(node.node_id), id)] = { verdict: 'different', kind: node.node_kind,
                nodes: [id, node.node_id], by: 'review', job_id: jobId, generation, ...(reason ? { reason: clip(reason) } : {}) };
            written++;
        }
    }
    return written;
}

/** The draft's nodes as the graph receives them: `distinct_from` is a reading-time answer, kept in `reading.identity`, not on the node. */
export function withoutDistinctFrom(filled: Row): Row {
    return { ...filled, nodes: array(filled.nodes).map(node => {
        if (!isJsonObject(node) || !Object.hasOwn(node, DISTINCT_FROM)) return node;
        const { [DISTINCT_FROM]: _answered, ...rest } = node as Row;
        return rest;
    }) };
}
