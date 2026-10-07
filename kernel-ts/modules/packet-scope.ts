/**
 * §187.5.1: the author's packet is cut to the job. A job with pages carries the nodes that cite a page in its pages or in
 * the §182.3 reading window around them, the nodes one relation away from those, the module node and the nodes the job
 * itself names; its claims are those whose both ends are carried. The checker never reads this cut: it reads the
 * whole-graph view written beside the packet (`GRAPH_VIEW_FILE`).
 */
import { anchorPage, readingWindow, type Chapter } from './chapters.js';
import { compareUnicode } from '../json.js';
import { array, integer, number, row, string, type Row } from '../read/values.js';

/** The kernel-owned file beside `packet.json` that holds what the draft check reads: the graph as it stood at the claim. */
export const GRAPH_VIEW_FILE = 'graph-view.json';

export type ScopeWindow = { mode: string; first: number; last: number };

/**
 * The job's pages: its assigned `pages`, a visual scan's range, and for a need read the pages the need cites and the pages
 * its entity's accepted material cites. Empty for a job without pages (index, guidance, opening, a focus-only detail).
 */
export function jobPages(job: Row, needTask?: Row, pageCount = Number.MAX_SAFE_INTEGER): number[] {
    const out = new Set<number>();
    const add = (value: unknown) => { if (integer(value) && number(value) >= 1 && number(value) <= pageCount) out.add(number(value)); };
    for (const page of array(job.pages)) add(page);
    const scan = row(job.visual_scan);
    if (integer(scan.first) && integer(scan.last))
        for (let page = number(scan.first); page <= number(scan.last); page++) add(page);
    if (needTask) {
        for (const ref of array(needTask.source_refs)) add(row(ref).page);
        for (const page of array(needTask.accepted_pages)) add(page);
    }
    return [...out].sort((a, b) => a - b);
}

/**
 * §191.2: what the author meets first in its packet -- the published things that cite one of the job's own pages (not the
 * window), each as `{id, kind, name, aliases, pages}`, grouped by kind. `known` are the packet's node rows (pages 1-based).
 * §191.3: a thing is listed once, as its survivor (`survivors`, variant id to survivor id): a copy on the job's pages lists the
 * node that stands for it, with the copy's names among its aliases and the copy's pages among its pages, so the id the author
 * reuses is the survivor's. A cost saver, not the guard: the draft check's `duplicate_of_published` is the guard (§191.1).
 */
export function packetRoster(known: Row[], pages: number[], survivors: Row = {}): Row[] {
    const assigned = new Set(pages), byId = new Map(known.map(node => [string(node.node_id), node]));
    const cited = (node: Row): number[] => [...new Set(array(node.source_refs).map(ref => row(ref).page).filter(integer).map(number))].sort((a, b) => a - b);
    const stands = (id: string): string => typeof survivors[id] === 'string' && byId.has(survivors[id]) ? survivors[id] : id;
    const groups = new Map<string, Row[]>();
    for (const node of known) {
        if (node.node_kind === 'module') continue;
        const survivor = stands(string(node.node_id));
        groups.set(survivor, [...(groups.get(survivor) ?? []), node]);
    }
    return [...groups].filter(([, members]) => members.some(node => cited(node).some(page => assigned.has(page)))).map(([id, members]) => {
        const node = byId.get(id)!, name = typeof node.name === 'string' ? node.name : '';
        const names = [...new Set([...array(node.aliases), ...members.filter(member => member !== node).flatMap(member => [member.name, ...array(member.aliases)])]
            .filter((value): value is string => typeof value === 'string' && value !== name))];
        return { id, kind: string(node.node_kind), name, aliases: names, pages: [...new Set(members.flatMap(cited))].sort((a, b) => a - b) };
    }).sort((a, b) => compareUnicode(a.kind, b.kind) || compareUnicode(a.id, b.id));
}

/** §182.3's window around the job's pages, anchored on their median page. */
export function scopeWindow(pages: number[], pageCount: number, chapters: Chapter[], fallbackPages: number): ScopeWindow | null {
    const anchor = anchorPage(pages);
    if (anchor === undefined) return null;
    const window = readingWindow(pageCount, chapters, anchor, fallbackPages);
    return { mode: window.mode, first: window.first, last: window.last };
}

/**
 * The cut itself. `known` are the packet's node rows (pages 1-based in `source_refs`), `claims` and `relations` the graph's.
 * `keep` names nodes carried whatever they cite (the module node, a need's entity, the focus).
 */
export function scopeGraph(known: Row[], claims: Row[], relations: Row[], pages: number[], window: ScopeWindow | null, keep: Iterable<string>): { nodes: Row[]; claims: Row[] } {
    const assigned = new Set(pages);
    const cites = (node: Row) => array(node.source_refs).some(ref => {
        const page = number(row(ref).page);
        return assigned.has(page) || window !== null && page >= window.first && page <= window.last;
    });
    // Only a node that cites the pages reaches out one relation; the module node and the named nodes are carried alone.
    const seed = new Set<string>(known.filter(cites).map(node => string(node.node_id)));
    const carried = new Set([...seed, ...[...keep].filter(Boolean), ...known.filter(node => node.node_kind === 'module').map(node => string(node.node_id))]);
    for (const relation of relations) {
        const from = string(row(relation).from_node_id), to = string(row(relation).to_node_id);
        if (seed.has(from) && to) carried.add(to);
        if (seed.has(to) && from) carried.add(from);
    }
    const nodes = known.filter(node => carried.has(string(node.node_id)));
    const ends = new Set(nodes.map(node => string(node.node_id)));
    return {
        nodes,
        claims: claims.filter(claim => {
            const object = row(row(claim).object).node_id;
            return ends.has(string(row(claim).subject_id)) && (object === undefined || ends.has(string(object)));
        }),
    };
}
