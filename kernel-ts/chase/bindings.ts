/** The current action-to-chase slots and authored participant/route bindings. */
import { RpcError } from '../errors.js';
import { isJsonObject } from '../json.js';
import { conditionMet } from '../read/module-graph.js';
import { SessionView, active } from '../read/session-view.js';
import { array, integer, kebab, normalize, number, repr, row, string, truth, type Row } from '../read/values.js';
import { SkillResolver } from '../rules/skills.js';
import { presentOpponents, type SettleContext } from '../resolve/context.js';
import { investigatorCombatParticipant, npcCombatParticipant } from '../combat/profiles.js';
import { archetypeIds } from '../apply/archetype.js';
import { CHASE_OUTCOMES, DEFAULT_GAP, DEFAULT_LOCATION_COUNT, generateLocationChain, get, int, or, participantFromCombatSpec } from './model.js';
export { presentOpponents } from '../resolve/context.js';
/**
 * The intents a chase decision answers (§11.5): the rule graph gives every chase decision but the start `flee`, `move`
 * and `combat`, and `restrict` admits the same three implicitly while a chase runs. Contract §143.12 admits them for
 * `chase:start` too, read by the side the actor takes: a pursuer may declare any of them, a quarry flees.
 */
export const CHASE_INTENTS = ['flee', 'move', 'combat'];
/** A flight on record that still stands: its receipt, the turn it was written in, and whether they were moved since. */
type Flight = {
    receipt: string;
    turn: number;
    moved: boolean;
};
/**
 * Contracts §143.12 and §143.13: every flight that still stands, by the person who fled. A flight is the last receipt
 * that gained a person `fled` (a combat flight, or the Keeper's `apply npc` condition). It stands through the turn it
 * was written in and the next one -- the turn in which the player answers it -- and is over from the turn after that
 * (lapsed unused), or earlier when a fight or a chase begins after it (a chase that runs after them consumes it) or the
 * acting investigator flees after it. Where the Keeper wrote them to go (`apply npc to`, in either turn) does not end
 * it: the pursuit is the player's answer to the flight, and the Keeper writes where the person went in the flight's own
 * turn (§143.13, table `npc-acts-c` turns 4 and 5). Receipts are read in order with the turn each belongs to: the
 * committed turns, then the open turn, then this call's.
 */
function standingFlights(context: SettleContext): Map<string, Flight> {
    const standing = new Map<string, Flight>();
    const turns: Array<[number, any[]]> = [
        ...context.snapshot.records.map(record => [number(record.turn), array(record.receipts)] as [number, any[]]),
        [context.turnNumber, [...array(context.turn.receipts), ...context.receipts]]
    ];
    for (const [turn, receipts] of turns)
        for (const receipt of receipts.filter(isJsonObject)) {
            if (receipt.kind === 'condition' && array(receipt.gained).includes('fled')) {
                if (receipt.subject === context.actorId)
                    standing.clear();
                else
                    standing.set(string(receipt.subject), { receipt: string(receipt.id), turn, moved: false });
            }
            else if (receipt.kind === 'session' && receipt.transition === 'start' && ['combat', 'chase'].includes(string(receipt.family)))
                standing.clear();
            else if (receipt.kind === 'npc' && truth(receipt.to) && standing.has(string(receipt.handle)))
                standing.get(string(receipt.handle))!.moved = true;
        }
    for (const [handle, flight] of standing)
        if (context.turnNumber > flight.turn + 1)
            standing.delete(handle);
    return standing;
}
/** Contract §143.12, windowed by §143.13: the receipt id of `handle`'s flight that still stands, or null. */
export function standingFlight(context: SettleContext, handle: string): string | null {
    return standingFlights(context).get(handle)?.receipt ?? null;
}
/**
 * Contract §143.13: the people a pursuit from here can still reach -- their flight stands, and they ran from where the
 * investigators are: still present here, or written somewhere else (`apply npc to`) since they fled. Handle to the
 * flight's receipt id, in handle order. A person the Keeper stamped `fled` somewhere else and never moved is not one.
 */
export function fledFromHere(context: SettleContext): Map<string, string> {
    const presence = row(context.world.npc_presence);
    return new Map([...standingFlights(context)]
        .filter(([handle, flight]) => !context.sheetById(handle) && !!context.graph.actor(handle) && (flight.moved || presence[handle] === context.activeScene))
        .map(([handle, flight]): [string, string] => [handle, flight.receipt])
        .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}
/**
 * Contract §143.13: a chase start by an investigator that names no one. A pursuit names whom: `move` or `combat` is
 * refused `quarry_does_not_flee` (§143.12), whose options now carry whoever ran from here as well as the people here
 * with a stat block. A `flee` that names no one while someone who ran from here can still be chased is asked whom
 * (`chase_names_no_one`), rather than read as the investigator running from whoever is still here -- the Keeper of
 * table `npc-acts-c` turn 5 wrote exactly that call for a pursuit. A `flee` with no one named and no one who ran from
 * here returns, left to the callers (the investigator flees whoever is here, or the pursuer message).
 */
export function askWhomTheChaseIsAfter(context: SettleContext): void {
    if (truth(context.action.target) || !context.sheetById(context.actingId))
        return;
    const fled = fledFromHere(context);
    const handles = [...fled.keys()];
    const name = (handle: string): string => {
        const node = context.graph.actor(handle);
        return node ? context.graph.displayName(node) : handle;
    };
    const running = handles.length ? `${handles.map(name).join(' and ')} ran from here and can still be chased` : '';
    const flights: Row = handles.length ? { fled: handles.map(handle => ({ npc: handle, flight: fled.get(handle)! })) } : {};
    if (string(context.action.intent) !== 'flee') {
        const present = presentOpponents(context).filter(([, , profile]) => truth(profile)).map(([handle]) => handle);
        throw new RpcError('needs', `chase:start with no one named in action.target makes ${context.actorId} the quarry, and a quarry's intent is flee${running ? `; ${running}` : ''}`, {
            fix: handles.length
                ? `to run after ${name(handles[0])}, resolve chase:start again with target: ${name(handles[0])} (they are the chase's quarry); to run from whoever is here, set action.intent to flee and name them in action.target`
                : 'to run after someone, name them in action.target; to run from whoever is here, set action.intent to flee',
            details: {
                reason: 'quarry_does_not_flee',
                needs: { field: 'target', options: [...new Set([...present, ...handles])].sort() },
                ...flights
            }
        });
    }
    if (!handles.length)
        return;
    throw new RpcError('needs', `chase:start names no one, and ${running}: whom does ${context.actorId} run after, or from?`, {
        fix: `to run after ${name(handles[0])}, resolve chase:start again with target: ${name(handles[0])} (flee, move or combat all read as the pursuit, and they are the chase's quarry); to run from someone who is still here, name them in action.target with intent flee`,
        details: {
            reason: 'chase_names_no_one',
            needs: { field: 'target', options: handles },
            ...flights
        }
    });
}
export type ChaseRoles = {
    quarry: 'investigator';
} | {
    quarry: 'npc';
    handle: string;
    node: Row;
    basis: 'flight' | 'intent';
    flight: string | null;
};
/**
 * Contract §143.12: who runs in the chase this `chase:start` opens. A person other than an investigator acting is the
 * pursuer and the investigator the quarry (§143.9, unchanged). An investigator acting against a person named in
 * `action.target` runs after them -- that person is the quarry -- when their flight still stands, or when the
 * investigator's own intent is not a flight (`move`, `combat`); an investigator who declares `flee` at a person with no
 * standing flight runs from them, and with no one named the investigator flees whoever is here (both unchanged). The
 * flight stands for the window of §143.13, whether or not the Keeper has written where the person went.
 */
export function chaseRoles(context: SettleContext): ChaseRoles {
    const action = context.action;
    if (!context.sheetById(context.actingId) || !truth(action.target) || context.sheetById(action.target))
        return { quarry: 'investigator' };
    const node = context.graph.actor(string(action.target));
    if (!node)
        return { quarry: 'investigator' };
    const handle = context.graph.handle(node);
    const flight = standingFlight(context, handle);
    if (flight)
        return { quarry: 'npc', handle, node, basis: 'flight', flight };
    if (string(action.intent) === 'flee')
        return { quarry: 'investigator' };
    return { quarry: 'npc', handle, node, basis: 'intent', flight: null };
}
/**
 * The chase participant of a person who runs from the investigators (§143.12), read through the same readers as a
 * pursuer's (`npcCombatParticipant`, `participantFromCombatSpec`). Every number the chase reads of them that a reader
 * would otherwise assume is required: the characteristics the builder needs (STR, CON, SIZ, DEX -- the speed roll is
 * CON, the order DEX) and MOV, which the reader would set to 8. Dodge and Fighting fall to the rulebook's base chances
 * and HP and Build are derived by the rulebook, as for any stat block. No stat block, or a number missing, is `needs`.
 */
export async function quarryParticipant(context: SettleContext, handle: string, node: Row): Promise<Row> {
    const name = context.graph.displayName(node);
    const profile = context.npcProfile(handle);
    if (!profile)
        throw new RpcError('needs', `${name} has no stat block: a chase of ${name} reads their MOV, CON and DEX`, {
            fix: 'pin a stat block first: apply npc with archetype (one of details.needs.options, chosen from who this person is), then resolve again; when the module has a book that prints their numbers, read them with lookup kind=source instead. Or narrate the pursuit without dice: nothing without a receipt has happened',
            details: { reason: 'quarry_has_no_stat_block', npc: handle, needs: { field: 'archetype', options: await archetypeIds(context.kernel) } }
        });
    const characteristics = row(profile.characteristics);
    const missing = [
        ...['STR', 'CON', 'SIZ', 'DEX'].filter(key => !integer(characteristics[key])).map(key => `characteristics.${key}`),
        ...(integer(row(profile.derived).MOV) ? [] : ['derived.MOV'])
    ];
    if (missing.length)
        throw new RpcError('needs', `${name}'s stat block has no ${missing.join(', ')}: a chase of ${name} reads ${missing.length > 1 ? 'them' : 'it'}, and none is assumed`, {
            fix: 'read the printed numbers with lookup kind=source when the module has a book; otherwise narrate the pursuit without dice. Nothing without a receipt has happened',
            details: { reason: 'quarry_numbers_missing', npc: handle, missing, needs: { field: missing[0], options: [] } }
        });
    return participantFromCombatSpec(await npcCombatParticipant(context.tables, handle, profile), 'quarry', 0);
}
const locationRefs = (locations: Row[]): string[] => locations.map(location => `${location.kind === 'scene' ? 'scene' : 'location'}:${location.label}`);
export function chaseLocationChain(context: SettleContext): Row[] {
    const graph = context.graph;
    const scene = graph.scene(string(context.world.active_scene));
    const handle = graph.handle(scene);
    const chain: Row[] = [{
            label: handle,
            kind: 'scene',
            route_id: `scene:${handle}`,
            hazard: null,
            barrier: null
        }];
    for (const exit of graph.sceneExits(scene)) {
        if (truth(exit.when) && !conditionMet(exit.when, context.world))
            continue;
        if (chain.length >= DEFAULT_LOCATION_COUNT)
            break;
        chain.push({
            label: string(exit.to),
            kind: 'scene',
            route_id: `scene:${exit.to}`,
            hazard: null,
            barrier: null
        });
    }
    const minimum = DEFAULT_GAP + 3;
    if (chain.length < minimum)
        for (const location of generateLocationChain(minimum - chain.length + 1).slice(1))
            chain.push({
                label: location.label,
                kind: 'generated',
                hazard: null,
                barrier: null
            });
    return chain.slice(0, DEFAULT_LOCATION_COUNT);
}
export function chaseEndOutcome(view: SessionView, word: any): string {
    const participants = array(view.chase?.participants);
    const quarries = participants.filter(p => p.side === 'quarry');
    const reached = view.chaseOutcome(view.chase || {});
    if (reached)
        return reached;
    if (word == null)
        return 'concluded';
    const value = string(word);
    if (CHASE_OUTCOMES.includes(value))
        return value;
    const investigator = quarries.some(p => view.isInvestigator(string(p.actor_id)));
    const mapping: Row = {
        fled: 'escaped',
        stalemate: 'concluded',
        investigators_win: investigator ? 'escaped' : 'captured',
        monsters_win: investigator ? 'captured' : 'escaped'
    };
    if (Object.hasOwn(mapping, value))
        return mapping[value];
    throw new RpcError('invalid_params', `unknown chase outcome ${repr(value)}`, {
        fix: 'omit outcome to let the chase state decide, or give one of details.options',
        details: {
            options: ['investigators_win', 'monsters_win', 'fled', 'stalemate', 'escaped', 'captured', 'concluded']
        }
    });
}
async function targetValue(context: SettleContext, id: string, skill: string): Promise<number> {
    const sheet = context.sheetById(id);
    if (sheet) {
        const resolver = await SkillResolver.create(context.tables, sheet);
        const canonical = resolver.resolveExplicit(skill) || skill;
        try {
            return int(resolver.targetValue(canonical));
        }
        catch (error) {
            if ((error as Error).name !== 'KeyError')
                throw error;
        }
    }
    const profile = presentOpponents(context).find(([handle]) => handle === id)?.[2] || {};
    for (const table of ['skills', 'characteristics']) {
        const value = row(profile[table])[skill];
        if (integer(value))
            return int(value);
    }
    throw new RpcError('needs', `${id} has no value for ${skill}`, {
        details: {
            needs: {
                field: 'skill',
                options: context.npcSkillLabels(`npc:${id}`)
            }
        }
    });
}
export async function chaseSlots(ref: string, context: SettleContext): Promise<{
    semantic: Row;
    extras: Row;
}> {
    const suffix = ref.split(':').at(-1)!;
    const action = context.action;
    const view = context.sessions();
    const semantic: Row = {};
    const binding: Row = {
        decision_id: context.callId
    };
    if (suffix === 'start') {
        if (active(view.chase))
            throw new RpcError('turn_state', 'a chase is already underway', {
                fix: 'continue it with chase decisions'
            });
        const roles = chaseRoles(context);
        // Contract §143.12: the investigator runs after the person named in action.target. The pursuer is the acting
        // investigator (the one named, or the table's only one when actor is absent: `resolveActor`'s rule).
        if (roles.quarry === 'npc') {
            const quarry = await quarryParticipant(context, roles.handle, roles.node);
            const participants = [participantFromCombatSpec(await investigatorCombatParticipant(context.tables, context.actor, null), 'pursuer', 0), quarry];
            const locations = chaseLocationChain(context);
            Object.assign(semantic, {
                pursuer_refs: [`investigator:${context.actorId}`],
                quarry_refs: [`npc:${roles.handle}`],
                location_refs: locationRefs(locations)
            });
            Object.assign(binding, {
                chase_id: `chase:${context.activeScene}:${kebab(roles.handle)}-vs-${kebab(context.actorId)}-t${context.turnNumber}`,
                participants,
                locations
            });
            return {
                semantic,
                extras: {
                    _host_session_binding: binding
                }
            };
        }
        // The acting investigator is the quarry, and a quarry flees: move or combat is a pursuit, which names whom; and
        // a flee that names no one while someone who ran from here can still be chased is asked whom (§143.13).
        askWhomTheChaseIsAfter(context);
        let opponents = presentOpponents(context).filter((value): value is [
            string,
            Row,
            Row
        ] => truth(value[2]));
        if (!opponents.length)
            throw new RpcError('needs', 'a chase needs a present pursuer with a stat block', {
                fix: 'establish the pursuer in this scene first, or narrate the flight without dice',
                details: {
                    needs: {
                        field: 'target',
                        options: context.presentNpcNames()
                    }
                }
            });
        if (truth(action.target)) {
            const chosen = opponents.filter(([handle, node]) => normalize(handle) === normalize(string(action.target)) || normalize(context.graph.displayName(node)) === normalize(string(action.target)));
            if (chosen.length)
                opponents = chosen;
        }
        const participants = [participantFromCombatSpec(await investigatorCombatParticipant(context.tables, context.actor, null), 'quarry', 0)];
        for (const [handle, , profile] of opponents)
            participants.push(participantFromCombatSpec(await npcCombatParticipant(context.tables, handle, profile), 'pursuer', 0));
        const locations = chaseLocationChain(context);
        Object.assign(semantic, {
            pursuer_refs: opponents.map(([handle]) => `npc:${handle}`),
            quarry_refs: [`investigator:${context.actorId}`],
            location_refs: locationRefs(locations)
        });
        Object.assign(binding, {
            chase_id: `chase:${context.activeScene}:${kebab(context.actorId)}-vs-${kebab(opponents[0][0])}-t${context.turnNumber}`,
            participants,
            locations
        });
        return {
            semantic,
            extras: {
                _host_session_binding: binding
            }
        };
    }
    const snapshot = view.chase;
    if (!active(snapshot))
        throw new RpcError('turn_state', 'no chase is underway', {
            fix: 'intent flee starts one'
        });
    const actorId = context.actingId;
    const participants = new Map<string, Row>(array(snapshot!.participants).filter(isJsonObject).map(p => [string(p.actor_id), p]));
    binding.revision = snapshot!.revision ?? null;
    if (suffix === 'end') {
        semantic.outcome = chaseEndOutcome(view, action.outcome);
        binding.chase_id = snapshot!.chase_id ?? null;
        return {
            semantic,
            extras: {
                _host_session_binding: binding
            }
        };
    }
    const turnOf = view.chaseTurnOf(snapshot!);
    if (context.actingId === context.actorId && turnOf && turnOf !== context.actorId && participants.has(turnOf) && !view.isInvestigator(turnOf))
        throw new RpcError('turn_state', `it is ${turnOf}'s move in the chase`, {
            fix: `resolve with actor: ${turnOf}`,
            details: {
                turn_of: turnOf
            }
        });
    binding.actor_id = actorId;
    const me = participants.get(actorId) || {};
    const chain = array(snapshot!.location_chain);
    const position = int(get(me, 'position', 0));
    const next = position + 1 >= 0 && position + 1 < chain.length ? chain[position + 1] : {};
    if (suffix === 'move')
        binding.action_id = 'move:advance';
    else if (['hazard', 'barrier'].includes(suffix)) {
        const feature = isJsonObject(next) ? next[suffix] : null;
        if (!isJsonObject(feature))
            throw new RpcError('turn_state', `the next location has no ${suffix}`, {
                fix: 'resolve chase:move instead'
            });
        const skill = or(action.skill, feature.skill, 'DEX');
        const target = feature.target == null ? await targetValue(context, actorId, string(skill)) : feature.target;
        if (suffix === 'hazard')
            Object.assign(binding, {
                action_id: `hazard:${string(feature.hazard_id)}`,
                target: int(target),
                difficulty: get(feature, 'difficulty', 'regular')
            });
        else {
            const method = string(or(action.method, '')).trim().toLowerCase();
            if (!['negotiate', 'break'].includes(method))
                throw new RpcError('needs', 'a barrier is negotiated (a skill roll) or broken (Build damage)', {
                    fix: 'set action.method to negotiate or break',
                    details: {
                        needs: {
                            field: 'method',
                            options: ['negotiate', 'break']
                        }
                    }
                });
            semantic.method = method;
            Object.assign(binding, {
                action_id: `barrier:${string(feature.barrier_id)}:${method}`,
                target: int(target),
                difficulty: get(feature, 'difficulty', 'regular')
            });
        }
        if (truth(action.skill))
            semantic.skill = string(skill);
    }
    else if (suffix === 'conflict') {
        const targets = [...participants].filter(([id, p]) => id !== actorId && int(get(p, 'position', -2)) === position && !truth(p.escaped) && !truth(p.captured)).map(([id]) => id);
        const target = action.target;
        const chosen = truth(target) ? targets.find(id => normalize(id) === normalize(string(target)) || normalize(view.label(id)) === normalize(string(target))) : targets.length === 1 ? targets[0] : null;
        if (!chosen)
            throw new RpcError('needs', 'the conflict needs the caught opponent as action.target', {
                details: {
                    needs: {
                        field: 'target',
                        options: targets
                    }
                }
            });
        Object.assign(binding, {
            action_id: `conflict:${chosen}`,
            target_actor_id: chosen,
            combat_command_id: `${context.callId}:conflict`,
            _defense_kind: or(action.defense, 'dodge'),
            _weapon_id: action.weapon ?? null,
            _goal: typeof action.goal === 'string' && action.goal ? action.goal : typeof action.method === 'string' ? action.method : ''
        });
    }
    return {
        semantic,
        extras: {
            _host_session_binding: binding
        }
    };
}
