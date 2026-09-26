/** The current action-to-chase slots and authored participant/route bindings. */
import { RpcError } from '../errors.js';
import { isJsonObject } from '../json.js';
import { conditionMet } from '../read/module-graph.js';
import { SessionView, active } from '../read/session-view.js';
import { array, integer, kebab, normalize, repr, row, string, truth, type Row } from '../read/values.js';
import { SkillResolver } from '../rules/skills.js';
import { presentOpponents, type SettleContext } from '../resolve/context.js';
import { investigatorCombatParticipant, npcCombatParticipant } from '../combat/profiles.js';
import { archetypeIds } from '../apply/archetype.js';
import { CHASE_OUTCOMES, DEFAULT_GAP, DEFAULT_LOCATION_COUNT, generateLocationChain, get, int, or, participantFromCombatSpec } from './model.js';
export { presentOpponents } from '../resolve/context.js';
/**
 * The intents a chase decision answers (§11.5): the rule graph gives every chase decision but the start `flee`, `move`
 * and `combat`, and `restrict` admits the same three implicitly while a chase runs. Contract §139.12 admits them for
 * `chase:start` too, read by the side the actor takes: a pursuer may declare any of them, a quarry flees.
 */
export const CHASE_INTENTS = ['flee', 'move', 'combat'];
/**
 * Contract §139.12: the flight of `handle` that still stands -- the last receipt that gained them `fled` (a combat
 * flight, or the Keeper's `apply npc` condition), unless a fight or a chase began after it, they were moved since, or
 * the acting investigator fled after them. Its receipt id, or null.
 */
export function standingFlight(context: SettleContext, handle: string): string | null {
    let flight: string | null = null;
    for (const receipt of context.allReceipts()) {
        if (receipt.kind === 'condition' && array(receipt.gained).includes('fled')) {
            if (receipt.subject === handle)
                flight = string(receipt.id);
            else if (receipt.subject === context.actorId)
                flight = null;
        }
        else if (receipt.kind === 'session' && receipt.transition === 'start' && ['combat', 'chase'].includes(string(receipt.family)))
            flight = null;
        else if (receipt.kind === 'npc' && receipt.handle === handle && truth(receipt.to))
            flight = null;
    }
    return flight;
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
 * Contract §139.12: who runs in the chase this `chase:start` opens. A person other than an investigator acting is the
 * pursuer and the investigator the quarry (§139.9, unchanged). An investigator acting against a person named in
 * `action.target` runs after them -- that person is the quarry -- when their flight still stands, or when the
 * investigator's own intent is not a flight (`move`, `combat`); an investigator who declares `flee` at a person with no
 * standing flight runs from them, and with no one named the investigator flees whoever is here (both unchanged).
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
 * The chase participant of a person who runs from the investigators (§139.12), read through the same readers as a
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
        // Contract §139.12: the investigator runs after the person named in action.target. The pursuer is the acting
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
        // The acting investigator is the quarry, and a quarry flees: move or combat is a pursuit, which names whom.
        if (context.sheetById(context.actingId) && string(action.intent) !== 'flee')
            throw new RpcError('needs', `chase:start with no one named in action.target makes ${context.actorId} the quarry, and a quarry's intent is flee`, {
                fix: 'to run after someone, name them in action.target; to run from whoever is here, set action.intent to flee',
                details: {
                    reason: 'quarry_does_not_flee',
                    needs: {
                        field: 'target',
                        options: presentOpponents(context).filter(([, , profile]) => truth(profile)).map(([handle]) => handle).sort()
                    }
                }
            });
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
