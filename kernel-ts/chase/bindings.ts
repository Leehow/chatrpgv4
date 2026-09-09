/** The current action-to-chase slots and authored participant/route bindings. */
import { RpcError } from '../errors.js';
import { isJsonObject } from '../json.js';
import { conditionMet } from '../read/module-graph.js';
import { SessionView, active } from '../read/session-view.js';
import { array, entries, integer, kebab, normalize, repr, row, string, truth, type Row } from '../read/values.js';
import { SkillResolver } from '../rules/skills.js';
import type { SettleContext } from '../resolve/context.js';
import { investigatorCombatParticipant, npcCombatParticipant } from '../combat/profiles.js';
import { CHASE_OUTCOMES, DEFAULT_GAP, DEFAULT_LOCATION_COUNT, generateLocationChain, get, int, or, participantFromCombatSpec } from './model.js';
export function presentOpponents(context: SettleContext): Array<[
    string,
    Row,
    Row | null
]> {
    return entries(context.world.npc_presence).flatMap(([handle, at]) => {
        const node = at === context.world.active_scene ? context.graph.find(handle, ['npc']) : null;
        return node ? [[handle, node, context.npcProfile(handle)] as [
                string,
                Row,
                Row | null
            ]] : [];
    });
}
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
            location_refs: locations.map(location => `${location.kind === 'scene' ? 'scene' : 'location'}:${location.label}`)
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
