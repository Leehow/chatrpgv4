/** Campaign-created places and evidence, projected through the ordinary graph readers. */
import {isJsonObject, jsonDigest} from '../json.js';
import {RpcError} from '../errors.js';
import type {LoadedModule} from './campaign.js';
import type {ModuleGraph} from './module-graph.js';
import {array, normalize, row, string, type Row} from './values.js';
import {isPlace} from './places.js';

export function tableEntityId(kind: string, name: string): string {
    return `${kind}-table-${jsonDigest(normalize(name)).slice(0, 20)}`;
}

export function validateEstablishment(value: unknown, fields: readonly string[] = ['summary']): string | undefined {
    if (value === undefined) return undefined;
    if (!isJsonObject(value) || Object.keys(value).some(key => !fields.includes(key)) || typeof value.summary !== 'string' || !value.summary.trim())
        throw new RpcError('invalid_params', `establish requires a nonempty summary and no fields other than ${fields.join(', ')}`);
    return value.summary.trim();
}

/**
 * Contract §187.2.1 as amended by §204.3: the place a minted scene lies in. `within` names a place -- a book `scene` or
 * `location`, or a place this table established -- and `null` says the new place lies in no place the table has. Absent
 * (`undefined`), the caller places the mint in the active scene. A person or any other name is `invalid_params` with
 * `details.reason: within_not_a_place`.
 */
export function establishedWithin(graph: ModuleGraph, value: unknown): Row | null | undefined {
    if (value === undefined || value === null) return value;
    const node = typeof value === 'string' && value.trim() ? graph.find(value.trim(), ['scene', 'location']) : null;
    if (!node || !isPlace(graph, node))
        throw new RpcError('invalid_params', 'establish.within must name a place: a book scene or location, or a place this table established', {
            fix: 'name the place the new one lies inside, null when it lies in no place the table has, or leave within out to place it where the party stands',
            details: {reason: 'within_not_a_place', field: 'establish.within', within: typeof value === 'string' ? value : null}
        });
    return node;
}

/**
 * Contract §187.2.1: the book scene a place stands for when the read-ahead anchors its window (§182.3) and when the
 * brief orders its rosters (§187.4). A book scene is itself; a minted scene is the place it lies in (`located-in`),
 * else the scene the party left to mint it (`route-to`), followed through earlier mints until a book scene. Null when
 * the chain reaches no book scene.
 */
export function bookAnchor(graph: ModuleGraph, scene: Row): Row | null {
    const seen = new Set<string>();
    let node: Row | undefined = scene;
    while (node && graph.isTableEntity(node) && !seen.has(string(node.node_id))) {
        seen.add(string(node.node_id));
        const out: Row[] = graph.out.get(string(node.node_id)) ?? [];
        const next: Row | undefined = out.find(rel => rel.relation_kind === 'located-in') ?? out.find(rel => rel.relation_kind === 'route-to');
        node = next ? graph.nodes.get(string(next.to_node_id)) : undefined;
    }
    return node && !graph.isTableEntity(node) ? node : null;
}

export function establishTableEntity(graph: ModuleGraph, world: Row, turn: Row, kind: 'scene' | 'clue', name: string, summary: string, scene?: string,
    place: {from?: string; within?: string} = {}): Row {
    const record = {id: tableEntityId(kind, name), kind, name: name.trim(), summary, turn: turn.turn, ...(scene ? {scene} : {}),
        ...(place.from ? {from: place.from} : {}), ...(place.within ? {within: place.within} : {})};
    const records = array(world.table_entities ??= []);
    const old = records.find(entry => entry.id === record.id);
    if (!old) world.table_entities.push(record);
    return graph.addTableEntity(old ?? record);
}

export function withTableEntities(module: LoadedModule, world: Row): LoadedModule {
    for (const record of array(world.table_entities)) module.graph.addTableEntity(row(record));
    const source = module.material;
    const material = (name: string): string => module.graph.isTableEntity(module.graph.find(name)) ? 'ready' : source(name);
    if (module.graph.materialOverride) module.graph.materialOverride = material;
    return {...module, material};
}

/**
 * §187.2.1 × §182.3: the scene handle the read-ahead anchors its window on for this world -- the active scene, or for
 * a minted scene the book place `bookAnchor` finds. A minted scene the book does not hold would otherwise anchor on
 * the start scene.
 */
export function readingFocus(graph: ModuleGraph, world: Row): string {
    const active = string(world.active_scene), scene = graph.find(active, ['scene']);
    const anchor = scene ? bookAnchor(graph, scene) : null;
    return anchor ? graph.handle(anchor) : active;
}
