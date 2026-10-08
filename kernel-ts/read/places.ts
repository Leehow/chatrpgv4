/**
 * Contract §204: a place is inside places.
 *
 * The flat locus model read a place as one handle, so the more precisely a player named where they went, the more they were
 * refused: a house on the farm was "not reachable" from the house next door, a room was "a different place" from the
 * building, and a mint lay inside nothing (TR-F2 run 2, T10 and T16). Here the book's own relations give every place the
 * places it lies in -- `located-in`, `part-of` and `contains`, read in both authored directions -- and `occurs-at` says a
 * scene is played *at* a place (the same place, not a smaller one). A scene that occurs at two places says they are one
 * area. Structure only: no name is compared here except §204.6's equality of a location's name with a person's.
 */
import type { ModuleGraph } from './module-graph.js';
import { array, normalize, row, string, type Row } from './values.js';

const PLACE_KINDS: readonly string[] = ['scene', 'location'];
/** §39.4's bound on the walk outward, kept for §204.1's widened walk. */
const STEPS = 8;

const personNamed = new WeakMap<ModuleGraph, Set<string>>();
/**
 * Contract §204.6: the book's `location` nodes whose name or an alias equals, normalized, the name or an alias of a book
 * person of the same graph -- a person's identity a place-only reader drafted (Cold Harvest: three portraits' `depicts`
 * targets). Book nodes only (a table person is never compared), computed once per graph.
 */
export function personNamedLocations(graph: ModuleGraph): ReadonlySet<string> {
    const known = personNamed.get(graph);
    if (known) return known;
    const nodes = array(graph.raw.nodes).map(row), names = (node: Row): string[] =>
        [node.name, ...array(node.aliases)].filter((value): value is string => typeof value === 'string').map(normalize).filter(Boolean);
    const people = new Set(nodes.filter(node => node.node_kind === 'npc').flatMap(names));
    const found = new Set(nodes.filter(node => node.node_kind === 'location' && names(node).some(name => people.has(name))).map(node => string(node.node_id)));
    personNamed.set(graph, found);
    return found;
}

/** Contract §204.1: a scene or a location (a projected one included), never a person-named location (§204.6) or the module. */
export function isPlace(graph: ModuleGraph, node: Row | null | undefined): node is Row {
    return !!node && PLACE_KINDS.includes(string(node.node_kind)) && !personNamedLocations(graph).has(string(node.node_id));
}

const placeNode = (graph: ModuleGraph, id: unknown): Row | null => {
    const node = typeof id === 'string' ? graph.nodes.get(id) : undefined;
    if (!node) return null;
    const survivor = graph.survivorOf(node);
    return isPlace(graph, survivor) ? survivor : null;
};
const occursAt = (graph: ModuleGraph, node: Row): Row[] => node.node_kind !== 'scene' ? [] :
    graph.groupOut(node).filter(rel => rel.relation_kind === 'occurs-at').map(rel => placeNode(graph, rel.to_node_id)).filter((place): place is Row => !!place);
const playedAt = (graph: ModuleGraph, node: Row): Row[] =>
    graph.groupIncoming(node).filter(rel => rel.relation_kind === 'occurs-at').map(rel => placeNode(graph, rel.from_node_id))
        .filter((place): place is Row => !!place && place.node_kind === 'scene');
/** The places `node` lies directly inside: `located-in` and `part-of` out of its group, `contains` into it. */
const parentsOf = (graph: ModuleGraph, node: Row): Row[] => [
    ...graph.groupOut(node).filter(rel => rel.relation_kind === 'located-in' || rel.relation_kind === 'part-of').map(rel => placeNode(graph, rel.to_node_id)),
    ...graph.groupIncoming(node).filter(rel => rel.relation_kind === 'contains').map(rel => placeNode(graph, rel.from_node_id)),
].filter((place): place is Row => !!place);

/**
 * Contract §204.1: the place `node` is, as one area: the node (its survivor), the places it is played at, the scenes played
 * at it, and the places those scenes are played at (one scene at two places makes them one area). The node first.
 */
export function samePlace(graph: ModuleGraph, node: Row): Row[] {
    const self = graph.survivorOf(node), out: Row[] = [self], seen = new Set([string(self.node_id)]);
    const add = (place: Row) => { if (!seen.has(string(place.node_id))) { seen.add(string(place.node_id)); out.push(place); } };
    if (!isPlace(graph, self)) return out;
    for (const place of occursAt(graph, self)) add(place);
    for (const scene of playedAt(graph, self)) { add(scene); for (const place of occursAt(graph, scene)) add(place); }
    return out;
}

/**
 * Contract §204.1: the places `node` lies inside, nearest first, each once, at most eight steps out: walking from every member
 * of its `samePlace` along `located-in`, `part-of` and incoming `contains`; a container comes with its own `samePlace`.
 */
export function containers(graph: ModuleGraph, node: Row): Row[] {
    const start = samePlace(graph, node), seen = new Set(start.map(place => string(place.node_id))), out: Row[] = [];
    let frontier = start;
    for (let step = 0; step < STEPS && frontier.length; step++) {
        const next: Row[] = [];
        for (const member of frontier)
            for (const parent of parentsOf(graph, member))
                for (const place of samePlace(graph, parent)) {
                    if (seen.has(string(place.node_id))) continue;
                    seen.add(string(place.node_id));
                    out.push(place);
                    next.push(place);
                }
        frontier = next;
    }
    return out;
}

/** Contract §204.1: `samePlace` then `containers`, in that order. */
export function area(graph: ModuleGraph, node: Row): Row[] {
    return [...samePlace(graph, node), ...containers(graph, node)];
}

export type PlaceRelation = { relation: 'here' | 'around' | 'inside' | 'shared'; place: Row };
/**
 * Contract §204.1: how `destination` stands to `here` -- the same place (`here`), a place the party already stands inside
 * (`around`, `place` the destination), a place inside here (`inside`, `place` here), or another place inside a place both
 * lie in (`shared`, `place` the first container of here the destination's area holds). Null when nothing relates them.
 */
export function placeRelation(graph: ModuleGraph, here: Row, destination: Row): PlaceRelation | null {
    if (!isPlace(graph, graph.survivorOf(here)) || !isPlace(graph, graph.survivorOf(destination))) return null;
    const id = (node: Row) => string(node.node_id), target = id(graph.survivorOf(destination));
    const same = samePlace(graph, here), outside = containers(graph, here);
    if (same.some(place => id(place) === target)) return { relation: 'here', place: graph.survivorOf(destination) };
    if (outside.some(place => id(place) === target)) return { relation: 'around', place: graph.survivorOf(destination) };
    const theirs = area(graph, destination), holds = new Set(theirs.map(id));
    if (containers(graph, destination).some(place => same.some(member => id(member) === id(place)))) return { relation: 'inside', place: graph.survivorOf(here) };
    const shared = outside.find(place => holds.has(id(place))) ?? same.find(place => holds.has(id(place)));
    return shared ? { relation: 'shared', place: shared } : null;
}

/** Contract §204.2: whether `destination`'s own book road (`route-to`) leads to `here`: a road runs both ways. */
export function returnRoute(graph: ModuleGraph, here: Row, destination: Row): Row | null {
    const from = string(graph.survivorOf(here).node_id);
    return graph.groupOut(destination).find(rel => rel.relation_kind === 'route-to' && graph.survivorId(string(rel.to_node_id)) === from) ?? null;
}

/** Contract §204.1: the scene a place is walked to by: itself, else the scene registered under its name, else the first scene played at it. */
export function sceneOfPlace(graph: ModuleGraph, place: Row): Row | null {
    if (place.node_kind === 'scene') return place;
    return graph.find(graph.handle(place), ['scene']) ?? playedAt(graph, place)[0] ?? null;
}

/**
 * Contract §204.7: the other places in `container`'s area -- every place whose `samePlace` or `containers` hold it -- in book
 * order, the table's places last, never a member of `here`'s `samePlace` or the container's. Each as the scene it is walked to by.
 */
export function placesWithin(graph: ModuleGraph, container: Row, here: Row, limit = 12): Row[] {
    const id = (node: Row) => string(node.node_id), target = id(graph.survivorOf(container));
    const skip = new Set([...samePlace(graph, here), ...samePlace(graph, container)].map(id));
    const out: Row[] = [], seen = new Set<string>();
    const places = graph.kind('scene').filter(node => isPlace(graph, node) && !graph.isVariant(node));
    for (const node of [...places.filter(node => !graph.isTableEntity(node)), ...places.filter(node => graph.isTableEntity(node))]) {
        if (out.length >= limit) break;
        if (skip.has(id(node)) || seen.has(id(node))) continue;
        if (!area(graph, node).some(place => id(place) === target)) continue;
        seen.add(id(node));
        out.push(node);
    }
    return out;
}

/**
 * Contract §204.5: where a person is, as the scenes a move to them could land on, by the first ground that names any: the
 * ledger (`npc_presence`, a scene handle; `away` is no place), then the places the book says they are `located-in` (their
 * home), then the scenes the book seats them in (`present-in`). `basis` names the ground; `places` is empty when none does.
 */
export function personPlaces(graph: ModuleGraph, world: Row, person: Row): { basis: 'ledger' | 'home' | 'seat' | null; places: Row[] } {
    const self = string(graph.survivorOf(person).node_id), unique = (nodes: (Row | null)[]): Row[] =>
        [...new Map(nodes.filter((node): node is Row => !!node).map(node => [string(node.node_id), node] as [string, Row])).values()];
    const ledger = Object.entries(row(world.npc_presence)).filter(([handle, at]) => typeof at === 'string' && at !== 'away'
        && graph.survivorId(string(graph.actor(handle)?.node_id ?? '')) === self).map(([, at]) => graph.find(string(at), ['scene']));
    const fromLedger = unique(ledger);
    if (fromLedger.length) return { basis: 'ledger', places: fromLedger };
    const home = unique(graph.groupOut(person).filter(rel => rel.relation_kind === 'located-in').map(rel => placeNode(graph, rel.to_node_id))
        .map(place => place ? sceneOfPlace(graph, place) : null));
    if (home.length) return { basis: 'home', places: home };
    const seat = unique(graph.groupOut(person).filter(rel => rel.relation_kind === 'present-in').map(rel => placeNode(graph, rel.to_node_id))
        .map(place => place?.node_kind === 'scene' ? place : null));
    return seat.length ? { basis: 'seat', places: seat } : { basis: null, places: [] };
}
