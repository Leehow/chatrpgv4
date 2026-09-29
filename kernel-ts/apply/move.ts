/** Authored, retraced and Keeper-described movement uses the existing world trail. */
import { RpcError } from '../errors.js';
import type { DomainEvent } from '../transactions.js';
import { sceneLabel } from '../read/capsule.js';
import { array, integer, number, repr, row, sorted, string, type Row } from '../read/values.js';
import { nowIso, required } from '../write/store.js';
import type { ApplyContext } from './index.js';
import { advanceClock } from './clock.js';
import { establishTableEntity, validateEstablishment } from '../read/table-entities.js';
import { isAmbiguity } from '../read/module-graph.js';
export function stageMove(context: ApplyContext, effect: Row): {
    receipt: Row;
    event: DomainEvent | null;
} {
    const { graph, world, turn, callId, ordinal } = context;
    const to = required(effect, 'to')!, current = graph.scene(world.active_scene), from = graph.handle(current);
    const exits = new Map(graph.sceneExits(current).map(exit => [exit.to, exit]));
    const summary = validateEstablishment(effect.establish);
    let established = false;
    let destination: Row;
    try { destination = graph.scene(to); }
    catch (error) {
        if (!(error instanceof RpcError) || error.code !== 'unknown_entity') throw error;
        if (isAmbiguity(error)) throw error;
        if (summary !== undefined) {
            if (graph.find(to)) throw new RpcError('invalid_params', 'This name already identifies another entity');
            if (typeof effect.via !== 'string' || !effect.via.trim()) throw new RpcError('invalid_params', 'Establishing a destination requires via to describe the route');
            destination = establishTableEntity(graph, world, turn, 'scene', to, summary);
            established = true;
        } else {
            throw new RpcError('unknown_entity', `The destination ${repr(to)} is not an identified scene`, {
                fix: 'Reuse an existing place for its rooms or counters. For a genuinely new player-chosen place consistent with established facts, repeat move with establish: {summary: your description} and via: the route. Missing source coverage does not forbid ordinary improvisation. Consult source for a specific causal question; use adaptation for deliberate changes to established facts.',
                details: {...error.details, reason: 'destination_missing', requested_destination: to, source_anchor: current.name}
            });
        }
    }
    if (summary !== undefined && !established && !graph.isTableEntity(destination)) throw new RpcError('invalid_params', 'establish cannot replace an authored scene; move to it without establish');
    const target = graph.handle(destination);
    const label = typeof effect.label === 'string' && effect.label.trim() ? effect.label : null;
    if (target === from) {
        if (!label)
            throw new RpcError('invalid_params', `${repr(target)} is where the party already stands`, { fix: "pass label to name this scene in the player's language, or move somewhere else" });
        (world.scene_labels ??= {})[target] = label;
        return { receipt: { id: `move:${target}-t${turn.turn}-c${ordinal}`, kind: 'move', call_id: callId, from: target, to: target, from_label: label, to_label: label, minutes: 0, renamed: true, visibility: 'keeper', at: nowIso() }, event: null };
    }
    const trail = array(world.scene_trail).map(string), back = [...trail].reverse();
    const via = typeof effect.via === 'string' && effect.via.trim() ? effect.via : null;
    if (!exits.has(target) && !trail.includes(target) && !via)
        throw new RpcError('not_reachable', `${repr(target)} is not reachable from ${repr(from)}`, {
            fix: `move to one of ${repr(sorted(exits.keys()))}, retrace to one of ${repr(back)}, or say how they got there in via`,
            details: { from, to: target, exits: sorted(exits.keys()), back }
        });
    let minutes = effect.travel_minutes;
    if (minutes == null) {
        const edge = exits.get(target) || graph.sceneExits(destination).find(exit => exit.to === from) || {};
        minutes = Object.hasOwn(edge, 'travel_minutes') ? edge.travel_minutes : 0;
    }
    if (!integer(minutes) || number(minutes) < 0)
        throw new RpcError('invalid_params', 'travel_minutes must be a non-negative integer');
    const receipt: Row = { id: `move:${target}-t${turn.turn}-c${ordinal}`, kind: 'move', call_id: callId, from, to: target, from_label: sceneLabel(graph, world, current), to_label: label || sceneLabel(graph, world, destination), minutes, at: nowIso() };
    if (established) receipt.established = 'table';
    if (via && !exits.has(target) && !trail.includes(target)) {
        receipt.via = via;
        receipt.improvised = true;
    }
    if (label)
        (world.scene_labels ??= {})[target] = label;
    world.scene_trail = trail.includes(target) ? trail.slice(0, trail.indexOf(target)) : [...trail, from];
    world.active_scene = target;
    if (row(world.ending).scope === 'chapter')
        world.ending.continued = true;
    if (!array(world.visited_scenes ??= []).includes(target))
        world.visited_scenes.push(target);
    advanceClock(world, minutes);
    return { receipt, event: { type: 'scene-moved', data: { from, to: target, minutes } } };
}
