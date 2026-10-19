/** Authored, retraced and Keeper-described movement uses the existing world trail. */
import { RpcError } from '../errors.js';
import type { DomainEvent } from '../transactions.js';
import { personNode, sceneLabel } from '../read/capsule.js';
import { array, integer, number, repr, row, sorted, string, type Row } from '../read/values.js';
import { nowIso, required } from '../write/store.js';
import type { ApplyContext } from './index.js';
import { advanceClock } from './clock.js';
import { establishTableEntity, establishedWithin, validateEstablishment } from '../read/table-entities.js';
import { isAmbiguity, recordOf, type ModuleGraph } from '../read/module-graph.js';
import { aroundExit, bookRoadMinutes, personPlaces, placeRelation, returnRoute, roadKey, tableRoad } from '../read/places.js';
/** The options producer and transaction use the same structural route requirement. */
export function moveAccess(graph:ModuleGraph,world:Row,current:Row,destination:Row,established=false) {
    const target=graph.handle(destination),trail=array(world.scene_trail).map(string);
    const listed=graph.sceneExits(current).some(exit=>exit.to===target)||trail.includes(target)||established;
    const road=listed?null:returnRoute(graph,current,destination);
    const related=listed||road?null:placeRelation(graph,current,destination);
    const around=listed||road||related?null:aroundExit(graph,current,destination);
    return {listed,road,related,around,requiresVia:!listed&&!road&&!related&&!around};
}
export function stageMove(context: ApplyContext, effect: Row, travelRows?: ReadonlyMap<string, number> | null): {
    receipt: Row;
    event: DomainEvent | null;
} {
    const { graph, world, turn, callId, ordinal } = context;
    const to = required(effect, 'to')!, current = graph.scene(world.active_scene), from = graph.handle(current);
    const exits = new Map(graph.sceneExits(current).map(exit => [exit.to, exit]));
    // §187.2.1 / §204.3: the place the mint lies in, checked before anything is written; omitted, the place the party stands in.
    const within = establishedWithin(graph, row(effect.establish).within);
    const summary = validateEstablishment(effect.establish, 'scene');
    let established = false, person: Row | null = null;
    let destination: Row;
    try { destination = graph.scene(to); }
    catch (error) {
        if (!(error instanceof RpcError) || error.code !== 'unknown_entity') throw error;
        if (isAmbiguity(error)) throw error;
        // §204.5: a person is never a place. A move to someone goes to where they are; establish never mints a place under their name.
        const named = personNode(graph, world, to);
        if (named) {
            const found = personPlaces(graph, world, named);
            if (summary !== undefined || found.places.length !== 1)
                throw new RpcError('invalid_params', `${repr(to)} is a person, not a place`, {
                    fix: `${repr(to)} is a person, not a place: move to the place where they are (one of details.places), or establish their home: move to the home in your words with establish {summary} and via`,
                    details: { reason: 'person_not_place', person: graph.handle(named), basis: found.basis,
                        places: found.places.map(place => ({ name: graph.handle(place), display_name: sceneLabel(graph, world, place) })) }
                });
            destination = found.places[0]!;
            person = named;
        } else if (summary !== undefined) {
            if (graph.find(to)) throw new RpcError('invalid_params', 'This name already identifies another entity');
            const lies = within === undefined ? current : within;
            destination = establishTableEntity(graph, world, turn, 'scene', to, summary, undefined, {from, ...(lies ? {within: graph.handle(lies)} : {})});
            established = true;
        } else {
            throw new RpcError('unknown_entity', `The destination ${repr(to)} is not an identified scene`, {
                fix: 'Reuse an existing place for its rooms or counters. For a genuinely new player-chosen place consistent with established facts, repeat move with establish: {summary: your description} and via: the route. Missing source coverage does not forbid ordinary improvisation. Consult source for a specific causal question; use adaptation for deliberate changes to established facts.',
                details: {...error.details, reason: 'destination_missing', requested_destination: to, source_anchor: current.name}
            });
        }
    }
    if (summary !== undefined && !established && !graph.isTableEntity(destination)) throw new RpcError('invalid_params', 'establish cannot replace an authored scene; move to it without establish', {
        fix: 'Keep the selected destination and route (to and via), remove establish, and resubmit the same move through normal admission. This repairs the tool arguments, not the player declaration; it does not authorize another target, method, cost or commitment.',
        details: { reason: 'authored_scene_establish', field: 'establish' }
    });
    const target = graph.handle(destination);
    // §204.5: a label written beside a person named the person's place in the Keeper's words, not the registered place.
    const label = !person && typeof effect.label === 'string' && effect.label.trim() ? effect.label : null;
    if (target === from) {
        if (person)
            throw new RpcError('invalid_params', `${repr(graph.handle(person))} is here: the party already stands where they are`, {
                fix: 'speak to them or act here; a move goes somewhere else', details: { reason: 'person_here', person: graph.handle(person), place: target } });
        if (!label)
            throw new RpcError('invalid_params', `${repr(target)} is where the party already stands`, { fix: "pass label to name this scene in the player's language, or move somewhere else" });
        (world.scene_labels ??= {})[target] = label;
        return { receipt: { id: `move:${target}-t${turn.turn}-c${ordinal}`, kind: 'move', call_id: callId, from: target, to: target, from_label: label, to_label: label, minutes: 0, renamed: true, visibility: 'keeper', at: nowIso() }, event: null };
    }
    const trail = array(world.scene_trail).map(string), back = [...trail].reverse();
    const via = typeof effect.via === 'string' && effect.via.trim() ? effect.via : null;
    // §204.2: a road runs both ways, and a move within a place the two share needs no route of its own.
    const {road,related,around,requiresVia}=moveAccess(graph,world,current,destination,established);
    // §212.1: a road out of a place the party stands inside is a road from here.
    if (requiresVia && !via)
        throw new RpcError('not_reachable', `${repr(target)} is not reachable from ${repr(from)}`, {
            fix: `move to one of ${repr(sorted(exits.keys()))}, retrace to one of ${repr(back)}, or say how they got there in via`,
            details: { from, to: target, exits: sorted(exits.keys()), back }
        });
    let minutes = effect.travel_minutes, travel: Row | null = null;
    // §218.3: a road row named instead of minutes takes the row's usual minutes, as §138.9 fills a book road (never a roll).
    const band = effect.travel_band;
    if (band != null) {
        if (minutes != null)
            throw new RpcError('invalid_params', 'travel_band names the road\'s length, and travel_minutes is another; give one', {
                fix: 'leave travel_minutes out to use the road row, or travel_band out to give your own minutes', details: { field: 'travel_band', reason: 'travel_conflict' } });
        if (typeof band !== 'string' || !travelRows?.has(band))
            throw new RpcError('invalid_params', `${repr(band)} is not a road row`, {
                fix: 'name one of details.options, or give travel_minutes', details: { field: 'travel_band', reason: 'travel_band_unknown', options: [...(travelRows?.keys() ?? [])] } });
        minutes = travelRows.get(band)!;
        travel = { basis: 'banded', band };
    }
    // §204.2: a move within a place the two share has the structure's 0, never an unknown journey.
    const insidePlace = !!related;
    if (minutes == null) {
        const edge = exits.get(target) || around?.exit || graph.sceneExits(destination).find(exit => exit.to === from) || {};
        if (Object.hasOwn(edge, 'travel_minutes')) minutes = edge.travel_minutes;
        else {
            // §218.3: the road this table already travelled with known minutes; otherwise the journey's time is unknown, and says so.
            const kept = tableRoad(world, from, target);
            minutes = kept ? kept.minutes : 0;
            if (kept) travel = { basis: 'travelled', ...(kept.turn !== undefined ? { turn: kept.turn } : {}) };
            else if (!insidePlace) travel = { basis: 'unknown' };
        }
    }
    if (!integer(minutes) || number(minutes) < 0)
        throw new RpcError('invalid_params', 'travel_minutes must be a non-negative integer');
    // §218.3: a road no book road times keeps the minutes this move gave it, so the next trip either way takes the same.
    if ((band != null || effect.travel_minutes != null && number(minutes) > 0) && bookRoadMinutes(graph, current, destination) === null)
        (world.table_roads ??= {})[roadKey(from, target)] = { minutes: number(minutes), basis: band != null ? 'banded' : 'given', turn: turn.turn, ...(band != null ? { band } : {}) };
    // §218.8: a stated end this turn whose journeys come before it ("ride home, then work until three") already counts this
    // journey: the move lands inside that time, keeps its own minutes for the road above, and moves the clock no further.
    const inside = number(minutes) > 0 ? [...array(turn.receipts).map(row), ...(context.staged?.() ?? [])]
        .find(entry => string(entry.kind) === 'time' && row(entry.until).journeys === 'before') : undefined;
    const journey = minutes;
    if (inside) minutes = 0;
    const receipt: Row = { id: `move:${target}-t${turn.turn}-c${ordinal}`, kind: 'move', call_id: callId, from, to: target, from_label: sceneLabel(graph, world, current), to_label: label || sceneLabel(graph, world, destination), minutes, at: nowIso() };
    if (travel) receipt.travel = travel;
    if (inside) receipt.inside_until = { receipt: string(inside.id), minutes: number(journey) };
    if (established) receipt.established = 'table';
    if (person) receipt.person = graph.handle(person);
    if (road) receipt.return_route = true;
    if (related) receipt.within = graph.handle(related.place);
    if (around) receipt.exit_of = graph.handle(around.place);
    if (via && !exits.has(target) && !trail.includes(target) && !road && !related && !around) {
        receipt.via = via;
        receipt.improvised = true;
    }
    if (label)
        (world.scene_labels ??= {})[target] = label;
    world.scene_trail = trail.includes(target) ? trail.slice(0, trail.indexOf(target)) : [...trail, from];
    world.active_scene = target;
    if (row(world.ending).scope === 'chapter')
        world.ending.continued = true;
    // §168.3: the people the entrance seated walk on with the party when the book's playing order leads on.
    const company = established ? [] : entranceCompany(graph, world, current, destination);
    if (company.length) {
        for (const handle of company) (world.npc_presence ??= {})[handle] = target;
        receipt.with = company;
    }
    if (!array(world.visited_scenes ??= []).includes(target))
        world.visited_scenes.push(target);
    advanceClock(world, minutes);
    return { receipt, event: { type: 'scene-moved', data: { from, to: target, minutes, ...(company.length ? { with: company } : {}) } } };
}
/**
 * Contract §168.3: an entrance carries its people into the scene it leads to.
 *
 * A campaign seats each person once, in the first scene to claim them, the start scene first (`initialWorld`), so the
 * opening is never played to an empty room. A book that seats them in its entrance and again in the scene the entrance
 * leads on to then kept them in the entrance for good. Blood Road's prologue (`is_entrance`) `hands-off-to` the Esso
 * station, and both seat Lars, Nate and Steve. The player's pull-up at the pumps moved the party to the station, the turn
 * record read `Present: nobody` beside a description of three men under the awning, and the Keeper asked the player
 * for their occupation.
 *
 * Only a move out of the entrance -- the start scene, a scene the book marks `is_entrance`, or the first scene this
 * table opened in -- along an entrance relation carries anyone, and only those the ledger has in the entrance whom the
 * destination also seats. Travel by `route-to` carries nobody: a person the book sets in two places is not dragged
 * along on an ordinary journey. Graph relations and the ledger decide; nothing reads prose.
 */
function entranceCompany(graph: ModuleGraph, world: Row, current: Row, destination: Row): string[] {
    const from = graph.handle(current);
    const entrance = recordOf(current).is_start === true || row(current.properties).is_entrance === true || string(array(world.visited_scenes)[0] ?? '') === from;
    if (!entrance || !graph.entranceRelation(current, destination))
        return [];
    const presence = row(world.npc_presence);
    return graph.sceneNpcIds(destination).map(id => graph.handle(graph.nodes.get(id)!)).filter(handle => presence[handle] === from);
}
