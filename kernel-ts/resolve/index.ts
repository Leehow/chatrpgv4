/** The one table.resolve handler, composed with the owner's existing writer. */
import type { KernelContext } from '../context.js';
import type { HandlerGroup } from '../handlers.js';
import { RpcError } from '../errors.js';
import { isJsonObject } from '../json.js';
import { CampaignSnapshot, loadCampaignModule } from '../read/campaign.js';
import type { ModuleGraph } from '../read/module-graph.js';
import { RuleObservations } from '../read/rule-facts.js';
import { activeMods } from '../read/mods.js';
import { SessionView } from '../read/session-view.js';
import { array, clone, integer, normalize, number, repr, string, truth, type Row } from '../read/values.js';
import { RuleTables } from '../rules/tables.js';
import { SkillResolver } from '../rules/skills.js';
import { nowIso } from '../write/store.js';
import { CheckArithmetic } from './arithmetic.js';
import { incapacitatedBy } from '../healing/conditions.js';
import { SettleContext, type ResolveWriter } from './context.js';
import { ResolvePipeline, actionSkills, fullDecisionRef, resolveActor, unsupportedValue, validateExtras } from './pipeline.js';
import { resolveResult,markersOf,modResolveEvents } from './projection.js';
import {actor as selectActor} from '../read/handlers.js';
import type {ModResolveInput,ModResolveResult} from '../mods/resolve.js';
import type {FixedFamilies} from './families.js';
export { CheckArithmetic, rollExpression, resourceDelta } from './arithmetic.js';
export { SettleContext, continuableCheck, latestCheckReceipt, recordSkillTicks, skillTickEligible } from './context.js';
export type { ResolveWriter, SettlementExecutor, ExecutionResult } from './context.js';
export { compileSettlement, failureEnvelope } from './settlement.js';
export type { SettlementPort } from './settlement.js';
const INTENTS = ['ambiguous', 'cast', 'combat', 'flee', 'idle', 'investigate', 'meta', 'montage', 'move', 'social', 'stuck'];
const NONE_INTENTS = new Set(['idle', 'meta', 'stuck', 'ambiguous']);
export interface ResolveContributions extends FixedFamilies {
    requireMaterial?: (graph: ModuleGraph, names: any[]) => Promise<void>;
    beforeMain?: (input:ModResolveInput)=>Promise<ModResolveResult|null>;
}
function modifiers(input: any, arithmetic: CheckArithmetic): [
    number,
    number,
    string
] {
    if (input == null)
        return [0, 0, 'regular'];
    if (!isJsonObject(input))
        throw new RpcError('invalid_params', 'action.modifiers must be an object');
    const bonus = Object.hasOwn(input, 'bonus_dice') ? input.bonus_dice : 0;
    const penalty = Object.hasOwn(input, 'penalty_dice') ? input.penalty_dice : 0;
    const difficulty = Object.hasOwn(input, 'difficulty') ? input.difficulty : 'regular';
    for (const [label, value] of [['bonus_dice', bonus], ['penalty_dice', penalty]])
        if (!integer(value) || number(value) < 0 || number(value) > 2)
            throw new RpcError('invalid_params', `modifiers.${label} must be 0, 1 or 2`);
    if (!arithmetic.difficulties().includes(string(difficulty)))
        unsupportedValue('difficulty', difficulty, arithmetic.difficulties());
    return [number(bonus), number(penalty), string(difficulty)];
}
function bindChoice(turn: Row, action: Row, callId: string): Row | null {
    if (action.choice == null)
        return null;
    if (!isJsonObject(action.choice) || typeof action.choice.pending !== 'string')
        throw new RpcError('invalid_params', 'action.choice must be {pending, option}');
    const pending = turn.pending_choice;
    if (!truth(pending) || ![pending.name, pending.binds].includes(action.choice.pending))
        throw new RpcError('invalid_params', `no pending choice named ${repr(action.choice.pending)}`, {
            details: {
                pending_choice: pending ?? null
            }
        });
    const receipt = {
        id: `choice:${pending.name}-t${turn.turn}`,
        kind: 'choice',
        call_id: callId,
        pending: pending.name,
        option: action.choice.option ?? null,
        at: nowIso()
    };
    turn.pending_choice = null;
    return receipt;
}
/**
 * The decisions the rules run *for* a character rather than the character choosing them.
 *
 * Same shape as the admission exemptions of §32.1, and for the same reason: a dying investigator's
 * round-by-round CON roll, a sanity settlement, an end-of-chapter development roll and the weekly
 * recovery roll are things that happen to somebody, not things they do. Refusing those because the
 * body cannot act would stop the only clock that can take the condition off again -- the gate would
 * lock the state it exists to report. Closed refs and family prefixes, never a reading of the prose.
 */
const RULES_RUN_THESE = new Set(['decision:coc7:healing:dying-round-clock', 'decision:coc7:healing:dying-hour-clock',
    'decision:coc7:healing:weekly-major-wound-recovery']);
const RULES_RUN_FAMILIES = ['decision:coc7:sanity:', 'decision:coc7:development:'];
/**
 * An action the current state forbids is refused by naming the state (contract §42).
 *
 * The kernel owns this and not the admission review, for three reasons. It is arithmetic, not
 * semantics: whether an unconscious body can drive a dagger home is the rulebook's answer and the
 * same every time, and §32.2's reviewer answers a different question -- whether the *player* chose
 * the action -- which on turns 108 and 109 of `game-83177d61` it answered correctly, because the
 * player did choose it. It must hold when the review lane is down, and §32.2 makes unavailability
 * refuse rather than admit only because a Keeper choosing for the player is the worse failure; a
 * rule the kernel can settle alone should not depend on a model call at all. And §32.3 forbids the
 * reviewer the Keeper-side context: it is told the player's own text and what the player was told,
 * and the investigator's condition list is not in that input -- which is the whole defect, since
 * the player had not been told either.
 *
 * What the Keeper got instead, for three turns, was nothing: the tool admitted the attack, the
 * combat engine found no eligible investigator, opened and closed a bout inside the turn, and left
 * the Keeper to improvise a halt. The refusal replaces the improvisation with the sentence.
 */
function refuseIncapacitated(actor: ReturnType<typeof resolveActor>, action: Row): void {
    // Only the investigator's own action. An NPC acting inside a session carries a graph handle as
    // the acting id and the party sheet only stands in for it; the engine already keeps an
    // incapacitated participant out of the initiative order there.
    if (actor.npcInSession || string(actor.actor.id) !== actor.actingId)
        return;
    // The Keeper writes the short form (`healing:dying-round-clock`); the exemptions are full refs.
    const decision = action.decision == null ? '' : fullDecisionRef(string(action.decision));
    if (action.involuntary != null || action.choice != null || RULES_RUN_THESE.has(decision) || RULES_RUN_FAMILIES.some(prefix => decision.startsWith(prefix)))
        return;
    const blocked = incapacitatedBy(actor.actor.conditions);
    if (!blocked.length)
        return;
    const who = string(actor.actor.name || actor.actor.id), state = blocked.join(' and ');
    throw new RpcError('needs', `${who} is ${state} and takes no action of their own`, {
        // Read literally, because it will be. It says what not to settle, what to put in front of
        // the player, and the ways out the rules actually have -- not a way for the Keeper to
        // declare the state over, which is what an unqualified "resolve it" would become.
        fix: `Settle nothing for ${who} this turn: no check, no attack, no move they make themselves. Narrate the state instead -- what the player's investigator can perceive of being ${state}, and what is happening around them meanwhile -- and say plainly that they cannot act. CoC 7e ends ${state === 'unconscious' ? 'it' : 'unconsciousness'} when a hit point comes back: someone present succeeding at First Aid or Medicine on them, or rest -- apply time -- until natural healing returns one. A character who is dead or dying is past that; First Aid stabilizes a dying one first.`,
        details: {
            reason: 'actor_incapacitated',
            actor: actor.actingId,
            actor_label: who,
            conditions: array(actor.actor.conditions).map(string),
            incapacitated: blocked,
            hp: actor.actor.current_hp ?? null
        },
        next: 'narrate'
    });
}
export function createResolveRuntime(kernel: KernelContext, writer: ResolveWriter, contributions: ResolveContributions = {}): {
    handlers: HandlerGroup;
} {
    const tables = new RuleTables(kernel);
    let loaded: Promise<{
        arithmetic: CheckArithmetic;
        observations: RuleObservations;
    }> | undefined;
    const engine = () => {
        if (!loaded) {
            loaded = Promise.all([CheckArithmetic.create(tables), RuleObservations.load(kernel)]).then(([arithmetic, observations]) => ({
                arithmetic,
                observations
            }));
            void loaded.catch(() => { loaded = undefined; });
        }
        return loaded;
    };
    const handlers: HandlerGroup = {
        'table.resolve': async (params) => {
            const transaction = await writer.transaction(params, {
                repairLegacyTrail: false, preload: false
            });
            const snapshot = new CampaignSnapshot(kernel, transaction.campaign.id);
            snapshot.meta = await transaction.campaign.readCampaign();
            snapshot.world = transaction.world;
            snapshot.turn = transaction.turn;
            const module = await loadCampaignModule(kernel, string(snapshot.meta.module_id), snapshot.world, transaction.campaign.id);
            const graph = module.graph;
            const action = params.action;
            const contributed = isJsonObject(action) && (await activeMods(kernel, transaction.world)).some(mod => array(mod.contributes.checks).some(check => check.name === action.decision));
            const start = await transaction.beginWrite('table.resolve', params, {
                allowOpening: contributed
            });
            if (start.kind === 'replay')
                return start.result;
            if (!isJsonObject(action))
                throw new RpcError('invalid_params', 'params.action must be an object');
            if (!INTENTS.includes(string(action.intent)))
                unsupportedValue('intent', action.intent, INTENTS, `unknown intent ${repr(action.intent)}`);
            const intent = string(action.intent);
            if (!NONE_INTENTS.has(intent)) {
                if (contributions.requireMaterial)
                    await contributions.requireMaterial(graph, [transaction.world.active_scene, action.actor, action.target]);
                else if (truth(module.meta.reading_version))
                    throw new RpcError('not_implemented', 'The source material gate is not implemented in the TypeScript resolve runtime');
            }
            const { arithmetic, observations } = await engine();
            const rollModifiers = modifiers(action.modifiers, arithmetic);
            if (!contributions.beforeMain && (contributed || ['objects:use', 'objects:repair'].includes(string(action.decision || ''))))
                throw new RpcError('not_implemented', 'Mod and object settlements are not implemented in the TypeScript resolve runtime', {
                    details: {
                        decision: action.decision ?? null
                    }
                });
            const choice = bindChoice(transaction.turn, action, start.callId);
            const choices = choice ? [choice] : [];
            if (!Object.hasOwn(transaction.turn, 'intents'))
                transaction.turn.intents = [];
            (transaction.turn.intents as any[]).push(intent);
            let repaired = false;
            const beforeExecute = async () => {
                if (repaired)
                    return;
                repaired = true;
                if (!Object.hasOwn(transaction.world, 'scene_trail')) {
                    const ordinary = await writer.transaction(params);
                    Object.assign(transaction.world, ordinary.world);
                }
            };
            const noneResult = async (note: string) => {
                await snapshot.preload();snapshot.party=clone(snapshot.party);
                await beforeExecute();
                const view = new SessionView(snapshot, graph, snapshot.party, transaction.world);
                const result = {
                    outcome: {
                        kind: 'none'
                    },
                    note,
                    session: view.activeSession(),
                    pending_choice: view.pendingChoice() || transaction.turn.pending_choice || null,
                    continuations: [],
                    rule_refs: []
                };
                await transaction.commitResolve({
                    callId: start.callId,
                    params,
                    result,
                    receipts: choices,
                    events: []
                });
                return result;
            };
            if(contributions.beforeMain){
                const modified=await contributions.beforeMain({campaign:transaction.campaign,graph,world:transaction.world,turn:transaction.turn,action,callId:start.callId,
                    async settlement(name){
                        await beforeExecute();
                        const state=new CampaignSnapshot(kernel,transaction.campaign.id);state.meta=await transaction.campaign.readCampaign();state.world=transaction.world;state.turn=transaction.turn;
                        await state.preload('view');state.party=clone(state.party);
                        const actor=selectActor(state.party,name);
                        return new SettleContext(kernel,transaction,state,module,tables,arithmetic,observations,start.callId,start.ordinal,actor,actor,action);
                    }});
                if(modified){
                    await beforeExecute();
                    const state=new CampaignSnapshot(kernel,transaction.campaign.id);state.meta=await transaction.campaign.readCampaign();state.world=await transaction.campaign.readWorld();state.turn=transaction.turn;await state.preload('view');
                    const view=new SessionView(state,graph,state.party,state.world),result=modified.result;
                    result.session=view.activeSession();result.pending_choice=view.pendingChoice()||transaction.turn.pending_choice||null;result.markers=markersOf(transaction.turn,modified.receipts);
                    await transaction.commitResolve({callId:start.callId,params,result,receipts:[...choices,...modified.receipts],events:modResolveEvents(action,result,modified.receipts)});
                    return result;
                }
            }
            if (NONE_INTENTS.has(intent))
                return noneResult(`intent ${intent}: nothing to roll; answer or clarify in the narration`);
            validateExtras(action);
            await snapshot.preload();snapshot.party=clone(snapshot.party);
            const sessions = new SessionView(snapshot, graph, snapshot.party, transaction.world);
            const actor = resolveActor(snapshot.party, graph, sessions, action);
            refuseIncapacitated(actor, action);
            const resolver = await SkillResolver.create(tables, actor.actor);
            const target = typeof action.target === 'string' ? snapshot.party.find(sheet => [normalize(sheet.id),normalize(sheet.name)].includes(normalize(action.target))) : undefined;
            let subject = actor.actor;
            if (target) {
                try { if (actionSkills(action,resolver).some(skill => skill === 'First Aid' || skill === 'Medicine')) subject = target; }
                catch (error) { if (!(error instanceof RpcError)) throw error; }
            }
            const context = new SettleContext(kernel, transaction, snapshot, module, tables, arithmetic, observations, start.callId, start.ordinal, actor.actor, subject, action, actor.actingId);
            const pipeline = new ResolvePipeline(context, resolver, rollModifiers, actor.npcInSession, contributions);
            const settled = await pipeline.run(beforeExecute);
            if (settled.kind === 'none')
                return noneResult(settled.note);
            const { result, events } = resolveResult(context, settled);
            await transaction.commitResolve({
                callId: start.callId,
                params,
                result,
                receipts: [...choices, ...context.receipts],
                events
            });
            return result;
        },
    };
    return {
        handlers
    };
}
