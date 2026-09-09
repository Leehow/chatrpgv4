/** Fixed chase settlement contribution; the common pipeline owns selection and commit. */
import { RpcError } from '../errors.js';
import { isJsonObject, orderedObject } from '../json.js';
import { SessionView, active } from '../read/session-view.js';
import { array, clone, entries, repr, row, string, truth, type Row } from '../read/values.js';
import type { FixedFamilyBinding } from '../resolve/families.js';
import type { SettleContext, ExecutionResult, SettlementExecutor } from '../resolve/context.js';
import { recordEngineRolls } from '../resolve/session-receipts.js';
import { unsupportedValue } from '../resolve/pipeline.js';
import { ChaseSession } from './session.js';
import { DEFAULT_GAP, get, int, or } from './model.js';
import { chaseSlots } from './bindings.js';
import { syncChaseParticipants } from './resources.js';
export { ChaseSession } from './session.js';
export { CLOCK_SAVE_PATHS, SAVE_PATHS, rebaseClock, chaseOutlook, generateLocationChain, normalizeLocation, vehicleStats, vehicleCollision } from './model.js';
export { validateSnapshot, validateGenesisEvidence, locationChainIdentity, validateActionReceipt } from './validation.js';
export { chaseLocationChain, presentOpponents } from './bindings.js';
const COMMANDS = ['chase_start', 'chase_move', 'chase_hazard', 'chase_barrier', 'chase_conflict', 'chase_end'];
const DECISIONS = new Set(COMMANDS.map(command => `decision:coc7:chase:${command.slice(6)}`));
function beforeState(session: ChaseSession): Row {
    return orderedObject(entries(session.participants).map(([id, participant]) => [id, {
            hp: int(or(participant.hp, 0)),
            position: int(or(participant.position, 0))
        }]));
}
function ensureRound(session: ChaseSession): void {
    if (session.status !== 'active')
        return;
    const order = array(session.rounds.at(-1)?.dex_order);
    if (!session.rounds.length || session.initiativeCursor >= order.length)
        session.beginRound();
}
async function finish(context: SettleContext, session: ChaseSession, before: Row, data: Row, hints: string[]): Promise<ExecutionResult> {
    const pending = session.drainPending();
    session.drainEvents();
    const ids: Row = {};
    for (const record of pending)
        if (isJsonObject(record) && typeof record.roll_id === 'string') {
            const receipts = recordEngineRolls(context, [record], 'chase_check', {
                session_kind: 'chase'
            });
            if (receipts.length)
                ids[record.roll_id] = receipts[0];
        }
    for (const [id, prior] of entries(before)) {
        const participant = session.participants[id];
        if (!participant)
            continue;
        const hp = int(or(participant.hp, 0));
        const position = int(or(participant.position, 0));
        if (hp !== prior.hp)
            context.addDelta('hp', id, prior.hp, hp);
        if (position !== prior.position)
            context.addEffect('position', id, prior.position, position);
    }
    await syncChaseParticipants(context, session.participants);
    if (session.status === 'active')
        ensureRound(session);
    await session.save(context);
    const view = new SessionView(context.snapshot, context.graph, context.party(), context.world);
    Object.assign(data, {
        chase_id: session.chaseId,
        revision: session.revision,
        round: session.currentRound,
        status: session.status,
        outcome: session.outcome,
        session: view.chaseView(),
        pending_choice: view.pendingChoice(),
        roll_receipts: ids
    });
    const reached = session.checkOutcome();
    if (reached && session.status === 'active')
        hints.push(`the chase has reached its outcome (${reached}); settle chase:end`);
    return {
        data,
        warnings: [],
        hints
    };
}
export const executeChase: SettlementExecutor = async (context, args) => {
    const command = row(args.command);
    const kind = string(or(command.kind, ''));
    const payload = row(command.payload);
    const hints: string[] = [];
    const data: Row = {
        command: kind
    };
    if (kind === 'chase_start') {
        if (active(context.sessions().chase))
            throw new RpcError('turn_state', 'a chase is already underway', {
                fix: 'continue it with chase decisions'
            });
        const session = await ChaseSession.create(string(payload.chase_id), context.rng, context.tables, context.arithmetic);
        for (const participant of array(payload.participants))
            session.addParticipant(participant.actor_id, participant.side, int(participant.mov), int(participant.dex), {
                con: participant.con ?? null,
                hp: participant.hp ?? null,
                fight: participant.fight ?? null,
                dodge: participant.dodge ?? null,
                build: int(or(participant.build, 0)),
                currentPosition: int(or(participant.current_position, 0)),
                conditions: [...array(participant.conditions)],
            });
        session.setLocationChain([...array(payload.locations)]);
        const before = beforeState(session);
        const established = session.establish();
        context.addSessionReceipt('chase', 'start', {
            summary: Object.keys(session.participants).sort().join(', ')
        });
        if (session.status === 'active') {
            session.cutToTheChase(DEFAULT_GAP);
            session.beginRound();
        }
        else {
            context.addSessionReceipt('chase', 'end', {
                outcome: session.outcome
            });
            hints.push('the quarry outruns every pursuer at the speed roll: the chase ends before it begins');
        }
        Object.assign(data, {
            established,
            initiative: [...array(session.rounds.at(-1)?.dex_order)]
        });
        return finish(context, session, before, data, hints);
    }
    const session = await ChaseSession.load(context, context.rng, context.tables, context.arithmetic, {
        trustedStandalone: true
    });
    if (session.status !== 'active')
        throw new RpcError('turn_state', 'the chase is already concluded', {
            fix: 'nothing to do; narrate the outcome'
        });
    if (payload.revision != null && int(payload.revision) !== session.revision)
        throw new RpcError('turn_state', 'the chase moved on since this action was planned', {
            fix: 'look and resolve again'
        });
    const before = beforeState(session);
    if (kind === 'chase_end') {
        const outcome = string(or(payload.outcome, session.checkOutcome(), 'concluded'));
        session.conclude(outcome);
        context.addSessionReceipt('chase', 'end', {
            outcome
        });
        return finish(context, session, before, data, hints);
    }
    const actorId = string(or(payload.actor_id, ''));
    if (!Object.hasOwn(session.participants, actorId))
        throw new RpcError('unknown_entity', `${actorId} is not in the chase`, {
            details: {
                query: actorId,
                candidates: Object.keys(session.participants).sort()
            }
        });
    ensureRound(session);
    const order = session.rounds.at(-1)!.dex_order;
    const holder = session.initiativeCursor < order.length ? order[session.initiativeCursor] : null;
    if (holder !== actorId)
        throw new RpcError('turn_state', `it is ${string(holder)}'s move, not ${actorId}'s`, {
            fix: `resolve with actor: ${string(holder)}`,
            details: {
                turn_of: holder
            }
        });
    const participant = session.participants[actorId];
    let turn: Row;
    try {
        if (kind === 'chase_move' && int(or(participant.movement_actions_remaining, 0)) <= 0) {
            turn = {
                turn_id: `t${session.currentRound}-${session.nextTurn()}`,
                actor_id: actorId,
                dex: participant.dex,
                movement_actions: participant.movement_actions,
                actions_taken: []
            };
            session.rounds.at(-1)!.turns.push(turn);
            session.initiativeCursor++;
            session.revision++;
            hints.push(`${actorId} has no movement actions this round (hazard debt) and passes`);
        }
        else if (kind === 'chase_move') {
            const actions: Row[] = [];
            const quarries = entries(session.participants).filter(([, p]) => p.side === 'quarry' && !truth(p.escaped) && !truth(p.captured));
            let position = int(participant.position);
            for (let i = 0; i < Math.max(1, int(or(participant.movement_actions_remaining, 1))); i++) {
                const caught = quarries.filter(([, p]) => int(get(p, 'position', -2)) === position).map(([id]) => id);
                if (participant.side === 'pursuer' && caught.length && actions.length) {
                    actions.push({
                        type: 'conflict',
                        target_actor_id: caught[0]
                    });
                    break;
                }
                const next = session.nextLocation(position);
                if (next && (truth(next.hazard) || truth(next.barrier) && int(or(next.barrier.hp, 0)) > 0))
                    break;
                actions.push({
                    type: 'advance'
                });
                position++;
                if (!next)
                    break;
            }
            turn = session.moveParticipant(actorId, actions.length ? actions : [{
                    type: 'advance'
                }]);
            const grabbed = array(turn.actions_taken).filter(action => action.type === 'conflict' && action.result === 'grabbed');
            if (grabbed.length)
                hints.push(`${string(grabbed[0].target)} is caught; settle chase:end (captured), then fight it out with intent combat`);
        }
        else if (kind === 'chase_hazard')
            turn = session.moveParticipant(actorId, [{
                    type: 'advance',
                    skill: payload.skill ?? null,
                    target: payload.target ?? null,
                    difficulty: get(payload, 'difficulty', 'regular')
                }]);
        else if (kind === 'chase_barrier') {
            const method = string(or(payload.method, 'negotiate'));
            turn = session.moveParticipant(actorId, [method === 'break' ? {
                    type: 'break_barrier'
                } : {
                    type: 'barrier',
                    skill: payload.skill ?? null,
                    target: payload.target ?? null,
                    difficulty: get(payload, 'difficulty', 'regular')
                }]);
        }
        else if (kind === 'chase_conflict') {
            const targetId = string(or(payload.target_actor_id, ''));
            const target = session.participants[targetId];
            if (!target)
                throw new RpcError('unknown_entity', `${targetId} is not in the chase`, {
                    details: {
                        query: targetId,
                        candidates: Object.keys(session.participants).sort()
                    }
                });
            if (int(get(target, 'position', -2)) !== int(get(participant, 'position', -1)))
                throw new RpcError('turn_state', `${targetId} is not within reach of ${actorId}`, {
                    fix: 'resolve chase:move to close the gap'
                });
            turn = session.moveParticipant(actorId, [{
                    type: 'conflict',
                    target_actor_id: targetId
                }]);
            const grab = array(turn.actions_taken)[0] || {};
            data.grab = grab.result ?? null;
            if (grab.result === 'grabbed')
                hints.push(`${targetId} is caught; settle chase:end (captured), then fight it out with intent combat`);
        }
        else
            return unsupportedValue('command.kind', kind, COMMANDS, `unknown chase command ${repr(kind)}`);
    }
    catch (error) {
        if ((error as Error).name !== 'ValueError')
            throw error;
        throw new RpcError('turn_state', `chase action refused by the engine: ${(error as Error).message}`);
    }
    data.turn = turn;
    if (truth(participant.escaped))
        hints.push(`${actorId} has escaped; settle chase:end`);
    return finish(context, session, before, data, hints);
};
export function createChaseResolveContribution(): FixedFamilyBinding {
    return {
        matches: (ref, capability) => DECISIONS.has(ref) && capability === 'chase.execute',
        slots: (ref, context) => chaseSlots(ref, context),
        async locked(_context, runtime, selected) {
            const declared = runtime.declaredPayloadSlots(string(selected.decision_ref));
            return orderedObject(entries(selected._host_session_binding).filter(([key, value]) => value != null && declared.has(key) && !key.startsWith('_')).map(([key, value]) => [key, clone(value)]));
        },
        args(context, plan, selected) {
            const payload = row(row(plan.command).payload);
            const binding = row(selected._host_session_binding);
            const command: Row = {
                decision_id: context.callId
            };
            for (const key of ['chase_id', 'participants', 'locations', 'actor_id', 'action_id', 'choice_id', 'skill', 'target', 'difficulty', 'roll_id', 'revision', 'target_actor_id', 'combat_command_id', 'outcome', 'method'])
                if (payload[key] != null)
                    command[key] = clone(payload[key]);
            for (const key of ['defense_kind', 'weapon_id', 'goal'])
                if (binding[`_${key}`] != null)
                    command[key] = binding[`_${key}`];
            return {
                investigator: context.actorId,
                decision_id: context.callId,
                command: {
                    command_id: `${context.callId}:command`,
                    kind: `chase_${string(plan.decision_ref || '').split(':').at(-1)}`,
                    phase: 'resolve',
                    payload: command
                }
            };
        },
        execute: executeChase,
        outcome(context, _ref, result) {
            const turn = row(result.turn);
            const status = result.status === 'concluded' ? 'ended' : result.command === 'chase_start' ? 'started' : 'moved';
            const output: Row = {
                kind: 'chase',
                status,
                action: result.command ?? null,
                actor: turn.actor_id ?? null,
                round: result.round ?? null,
                actions_taken: [...array(turn.actions_taken)],
                rolls: context.receipts.filter(receipt => receipt.kind === 'roll' && receipt.form !== 'dice').map(receipt => ({
                    actor: receipt.actor ?? null,
                    skill: receipt.skill ?? null,
                    roll: receipt.roll ?? null,
                    target: receipt.target ?? null,
                    level: receipt.level ?? null,
                    passed: receipt.passed ?? null,
                    receipt: receipt.id ?? null
                }))
            };
            if (result.command === 'chase_start') {
                output.established = result.established ?? null;
                output.initiative = result.initiative ?? null;
            }
            if (result.status === 'concluded')
                output.chase_outcome = result.outcome ?? null;
            return output;
        },
    };
}
