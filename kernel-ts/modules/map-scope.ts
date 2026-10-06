/**
 * Contract §39.4, "Only interior maps are masked" (owner ruling 2026-09-30): which kind of map a published map is.
 *
 * The reader writes `properties.map_scope` on a map (an `asset` or `handout` node with `properties.map_regions`) at
 * publication, and an independent reviewer checks it against the original page like the map's other fields. The kind is
 * a semantic judgement about the printed picture, so it is always the reader's and the reviewer's: nothing here reads a
 * name, a label or any text to decide it. This file only checks the shape of what the reader wrote, bounds the
 * background job that asks the reader for a map published before the ruling, and finds those maps.
 */
import { RpcError } from '../errors.js';
import { compareUnicode } from '../json.js';
import { ModuleGraph } from '../read/module-graph.js';
import { mapNodes } from '../read/maps.js';
import { array, integer, number, repr, row, string, type Row } from '../read/values.js';

/** The two kinds, a closed product vocabulary (contract §39.4). */
export const MAP_SCOPES: readonly string[] = ['area', 'interior'];
/** The read-ahead stops asking about one map after its map-scope job has failed this many times. */
export const MAP_SCOPE_FAILURES = 3;
/** What the two kinds mean, in the words every refusal and prompt uses: by what the table does with the map. */
export const MAP_SCOPE_KINDS = '"area" for a town, village, district, city, region or other outdoor map that players are handed or see as a whole; '
    + '"interior" for a building, floor plan, cellar, cave, ship or other enclosed place the investigators explore and uncover room by room';
/** The question a map-scope job asks its reader. */
export const MAP_SCOPE_QUESTION = 'Reopen the original pages of the published map named by task.map_scope.node (task.pages) and write only its properties.map_scope: '
    + MAP_SCOPE_KINDS + '. List only that node, with node_id, node_kind and name exactly as task.known_nodes has them, properties holding map_scope alone, '
    + 'and source_refs citing only pages from task.pages. Do not change its regions, image_sources or anything else.';

/** The kind a node's reader wrote, or null when it wrote none (or something that is not a kind). */
export function mapScopeOf(node: Row | null | undefined): string | null {
    const value = row(row(node).properties).map_scope;
    return typeof value === 'string' && MAP_SCOPES.includes(value) ? value : null;
}
const isMap = (node: Row | null | undefined): boolean => array(row(row(node).properties).map_regions).length > 0;
function refuse(rule: string, message: string, fix: string, path: string, extra: Row = {}): never {
    throw new RpcError('invalid_params', message, { fix, details: { reason: 'reading_failed', rule, path, allowed: [...MAP_SCOPES], ...extra } });
}

/**
 * The publication law for `map_scope` on drafted nodes. A value is one of the two kinds and sits on a map: the drafted
 * node or its published row carries `map_regions`. A drafted node that carries `map_regions` carries a kind unless its
 * published row already has one. A published row is never judged here: a map published before the ruling stays valid
 * until a draft changes its regions.
 */
export function checkMapScopes(nodes: Row[], known: Row[]): void {
    const published = publishedNodes(known);
    for (const [i, node] of nodes.entries()) checkMapScope(node, i, published);
}
/** The published rows `checkMapScope` compares a drafted node with, by node id. */
export const publishedNodes = (known: Row[]): Map<string, Row> =>
    new Map(known.filter(node => typeof row(node).node_id === 'string').map(node => [node.node_id, node]));
/** `checkMapScopes` for the one drafted node at `/nodes/<i>`, so the draft check can collect every node's refusal (§186.3). */
export function checkMapScope(node: Row, i: number, published: ReadonlyMap<string, Row>): void {
    const props = row(node.properties), prior = published.get(node.node_id), id = string(node.node_id), path = `/nodes/${i}/properties/map_scope`;
    if (Object.hasOwn(props, 'map_scope')) {
        if (!['asset', 'handout'].includes(node.node_kind) || !(isMap(node) || isMap(prior)))
            refuse('map_scope_not_a_map', `properties.map_scope belongs only to a map, an asset or handout node with properties.map_regions; ${repr(id)} is not one`,
                `Delete properties.map_scope from ${id}. Write map_scope only on the asset or handout node that carries the map's map_regions.`, path);
        if (!MAP_SCOPES.includes(props.map_scope))
            refuse('map_scope_invalid', `properties.map_scope of ${repr(id)} must be "area" or "interior", not ${repr(props.map_scope)}`,
                `Set properties.map_scope of ${id} to exactly one of the two strings, judged from the original page: ${MAP_SCOPE_KINDS}. Change nothing else.`, path,
                { value: props.map_scope });
    }
    else if (isMap(node) && mapScopeOf(prior) === null)
        refuse('map_scope_missing', `${repr(id)} is a map (it has properties.map_regions) but has no properties.map_scope`,
            `Add properties.map_scope to ${id}, judged from the original page: ${MAP_SCOPE_KINDS}. Keep everything else in the draft as it is.`, path);
}
/**
 * A map-scope job's draft (`packet.map_scope`) writes only that field: the one named map, as published, with
 * `properties.map_scope` alone, citing only the map's pages, and nothing else in the delta. With `seen`, the reader
 * viewed every page of the map.
 */
export function checkMapScopeDraft(draft: Row, packet: Row, seen?: ReadonlySet<any>): void {
    const target = string(row(packet.map_scope).node), pages = array(packet.pages).filter(integer).map(number);
    const prior = array(packet.known_nodes).find(node => row(node).node_id === target);
    if (!prior || !isMap(prior) || !pages.length)
        throw new RpcError('invalid_params', `the map-scope task names ${repr(target)}, which is not a published map with pages`, {
            fix: 'request the map-scope reading again from module.read.ahead', details: { reason: 'reading_failed', rule: 'map_scope_task', path: '/nodes' } });
    const shape = `List exactly one node, {"node_id": "${target}", "node_kind": "${string(prior.node_kind)}", "name": ${JSON.stringify(string(prior.name))}, `
        + `"properties": {"map_scope": "area" or "interior"}, "source_refs": [{"page": N}]}, where N is one of the map's pages ${JSON.stringify(pages)}; `
        + 'leave claims, node_refs, critical and ready_nodes empty, coverage {}, dependencies [], and write no source_needs. Do not change its regions, image_sources or anything else.';
    const bound = (message: string, path: string): never => {
        throw new RpcError('invalid_params', `a map-scope reading writes only properties.map_scope on ${target}: ${message}`, {
            fix: shape, details: { reason: 'reading_failed', rule: 'map_scope_job_bounds', path, node: target, pages } });
    };
    const nodes = array(draft.nodes);
    if (nodes.length !== 1 || row(nodes[0]).node_id !== target) bound(`the draft lists ${nodes.length} node(s) and must list only ${target}`, '/nodes');
    const node = row(nodes[0]);
    for (const key of ['claims', 'node_refs', 'critical', 'ready_nodes', 'dependencies'])
        if (array(draft[key]).length) bound(`${key} must be empty`, `/${key}`);
    if (Object.keys(row(draft.coverage)).length) bound('coverage must be {}', '/coverage');
    if (Object.hasOwn(draft, 'source_needs')) bound('a map-scope reading records no source_needs', '/source_needs');
    const extra = Object.keys(node).filter(key => !['node_id', 'node_kind', 'name', 'visibility', 'properties', 'source_refs'].includes(key));
    if (extra.length) bound(`the node may not carry ${extra.sort(compareUnicode).join(', ')}`, '/nodes/0');
    if (node.node_kind !== prior.node_kind || node.name !== prior.name || Object.hasOwn(node, 'visibility') && node.visibility !== prior.visibility)
        bound('node_kind, name and visibility stay exactly as published', '/nodes/0');
    const keys = Object.keys(row(node.properties));
    if (keys.length !== 1 || keys[0] !== 'map_scope') bound('properties must hold map_scope alone', '/nodes/0/properties');
    const cited = array(node.source_refs).map(ref => row(ref).page);
    if (!cited.length || cited.some(page => !integer(page) || !pages.includes(number(page)))) bound(`source_refs must cite only the map's pages ${JSON.stringify(pages)}`, '/nodes/0/source_refs');
    const unseen = seen ? pages.filter(page => ![...seen].some(value => number(value) === page)) : [];
    if (unseen.length) bound(`view every page of the map before writing its kind; not viewed: ${unseen.join(', ')}`, '/nodes/0/source_refs');
}

/** A job's focus names the map it reads, so two maps never share one. */
export const mapScopeFocus = (node: string): string => `Map scope of ${node}`;

/**
 * The published maps whose kind no reader has written yet, lowest page first (then node id): survivors only (a map that
 * is `variant-of` another is read as that other), each with the physical pages its picture is printed on -- its own
 * `image_sources`, then those of the source assets its regions are cut from, and only when neither names a page, the
 * pages its `source_refs` cite.
 */
export function mapsLackingScope(raw: Row | null, moduleId: string): Array<{ node: string; pages: number[] }> {
    if (!raw) return [];
    const graph = new ModuleGraph(moduleId, raw, '', {}), out: Array<{ node: string; pages: number[] }> = [];
    const imagePages = (node: Row | undefined): number[] => array(row(row(node).properties).image_sources).map(ref => row(ref).page).filter(integer).map(number);
    for (const map of mapNodes(graph)) {
        if (mapScopeOf(map) !== null) continue;
        const sources = array(row(map.properties).map_regions).map(region => string(row(region).source_asset))
            .map(name => graph.nodes.get(name) ?? graph.nodes.get(`asset-${name}`));
        let pages = [...imagePages(map), ...sources.flatMap(imagePages)];
        if (!pages.length) pages = array(map.source_refs).map(ref => row(ref).pdf_index).filter(integer).map(index => number(index) + 1);
        pages = [...new Set(pages.filter(page => page >= 1))].sort((a, b) => a - b);
        if (pages.length) out.push({ node: string(map.node_id), pages });
    }
    return out.sort((a, b) => a.pages[0] - b.pages[0] || compareUnicode(a.node, b.node));
}
