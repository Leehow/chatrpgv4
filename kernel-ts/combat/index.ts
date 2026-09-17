/** The fixed combat family's slots, host authority and outcome projection. */
import { RpcError } from '../errors.js';
import { isJsonObject } from '../json.js';
import { array, entries, number, repr, row, sorted, string, truth, type Row } from '../read/values.js';
import { defenseOptions } from '../read/session-view.js';
import type { FixedFamilyBinding } from '../resolve/families.js';
import type { SettleContext } from '../resolve/context.js';
import { usableWeapon } from '../mods/projection.js';
import { MANEUVER_ALIASES, MANEUVER_GOALS, VALID_OUTCOMES } from './engine.js';
import { combatOperationFor, resolveInvestigatorWeapon, weaponOptions } from './profiles.js';
import { archetypeIds } from '../apply/archetype.js';
import {selectObjectWeapon, usageObject} from '../mods/usages.js';
import { executeCombatEnd, executeCombatResolve, presentOpponents } from './execution.js';
export { CombatSession, combatAttack, resolveOpposed, CLOCK_SAVE_PATHS, rebaseClock } from './engine.js';
export type { CombatAttackPort, CombatTurnOptions, ParticipantOptions } from './engine.js';
const DECISIONS: Readonly<Record<string, string>> = Object.freeze({
    'decision:coc7:combat:aim': 'combat.resolve', 'decision:coc7:combat:attack': 'combat.resolve',
    'decision:coc7:combat:context': 'combat.context', 'decision:coc7:combat:defend': 'combat.resolve',
    'decision:coc7:combat:end': 'combat.end', 'decision:coc7:combat:flee': 'combat.resolve',
    'decision:coc7:combat:maneuver': 'combat.resolve', 'decision:coc7:combat:reload': 'combat.resolve',
});
const outcomes = () => sorted([...VALID_OUTCOMES].filter((value): value is string => value !== null));
function rollViews(context: SettleContext): Row[] {
    return context.receipts.filter(receipt => receipt.kind === 'roll' && receipt.form !== 'dice').map(receipt => ({ actor: receipt.actor ?? null, skill: receipt.skill ?? null,
        roll: receipt.roll ?? null, target: receipt.target ?? null, level: receipt.level ?? null, passed: receipt.passed ?? null, receipt: receipt.id ?? null }));
}
function damageViews(context: SettleContext): Row[] {
    return context.receipts.filter(receipt => receipt.kind === 'roll' && receipt.form === 'dice').map(receipt => ({ actor: receipt.actor ?? null, label: receipt.skill ?? null,
        expression: receipt.expression ?? null, faces: receipt.faces ?? null, total: receipt.total ?? null, receipt: receipt.id ?? null }));
}
/** Missing mechanics are prepared on the same physical object, never by cloning it into a weapon. */
const armingFix = (weapon: string): string =>
    `set action.weapon to one of details.needs.options, or prepare ${weapon} with apply usage (object, name and description). Keep an existing object's identity and condition. Unmanaged equipment may still use apply item with a rules-table weapon profile; never use that path to duplicate a managed object.`;
export function createCombatResolveContribution(): FixedFamilyBinding {
    return Object.freeze<FixedFamilyBinding>({
        matches(ref, capability) { return Object.hasOwn(DECISIONS, ref) && (capability === null || DECISIONS[ref] === capability); },
        async slots(ref, context, targets) {
            let action = context.action;
            const suffix = ref.split(':').at(-1)!, sessions = context.sessions(), actor = context.actingId;
            const snapshot = sessions.combat?.status === 'active' ? sessions.combat : null, isNpc = actor !== context.actorId;
            const binding: Row = { investigator_id: context.actorId, combat_revision: number(snapshot?.revision || 0), _actor_id: actor,
                _goal_text: (typeof action.goal === 'string' ? action.goal : '') || (typeof action.method === 'string' ? action.method : '') };
            const semantic: Row = {}, participants = new Set(array(snapshot?.participants).filter(isJsonObject).map(participant => string(participant.actor_id)));
            const done = () => ({ semantic, extras: { _host_session_binding: binding } });
            if (suffix === 'defend') {
                const pending = snapshot?.pending_attack;
                if (!isJsonObject(pending))
                    throw new RpcError('turn_state', 'no attack awaits a defense', { fix: 'declare an attack first (intent combat)' });
                const defender = string(pending.target_actor_id), options = defenseOptions(pending);
                if (actor !== defender) {
                    const who = sessions.isInvestigator(defender) ? 'the player' : 'the keeper, acting as the NPC';
                    throw new RpcError('turn_state', `the pending defense belongs to ${defender}; ${who} answers it`, {
                        fix: `resolve with actor: ${defender} and defense: one of ${repr(options)}`,
                        details: { session: 'combat', required: 'combat:defend', actor: defender, options },
                    });
                }
                if (action.defense == null)
                    throw new RpcError('needs', `${pending.target_actor_id} must choose a defense`, { fix: 'set action.defense', details: { needs: { field: 'defense', options } } });
                semantic.defense_kind = string(action.defense);
                Object.assign(binding, { pending_attack_ref: pending.attack_command_id ?? null, attack_command_id: pending.attack_command_id ?? null,
                    target_actor_id: pending.target_actor_id ?? null, _actor_id: defender });
                return done();
            }
            let objectWeapon: Row | null = null;
            if (['attack','maneuver','aim','reload'].includes(suffix)) {
                if (action.object != null && action.weapon != null) {
                    const weaponUsage = row(row(row(context.world.objects).usages)[string(action.weapon)]);
                    const namedObject = usageObject(context.world,string(action.object)), namedWeapon = usageObject(context.world,string(weaponUsage.object_id ?? action.weapon));
                    if (!namedObject || !namedWeapon || namedObject.id !== namedWeapon.id)
                        throw new RpcError('invalid_params','action.object and action.weapon must name the same physical object');
                }
                const query = action.object ?? action.weapon;
                if (query != null) {
                    objectWeapon = selectObjectWeapon(context.world,string(query),action.usage,actor);
                    if (action.object != null && !objectWeapon) throw new RpcError('needs','Place or adopt this object and prepare its usage first');
                    action = {...action,weapon:objectWeapon?.weapon_id ?? query};
                }
            }
            if (suffix === 'attack' || suffix === 'maneuver') {
                if (isNpc) {
                    const owned = usableWeapon(context.world, string(action.weapon || ''), actor);
                    if (owned)
                        action = { ...action, weapon: owned.id };
                    const target = action.target, targetSheet = truth(target) ? context.sheetById(target) : null, targetId = targetSheet ? string(targetSheet.id) : context.actorId;
                    if (snapshot && !participants.has(targetId))
                        throw new RpcError('unknown_entity', `${targetId} is not in this combat`, { details: { query: target ?? null, candidates: sorted([...participants].filter(id => id !== actor)) } });
                    semantic.candidate_ref = `attack:${targetId}`;
                    binding.target_npc_id = targetId;
                    if (truth(action.weapon)) {
                        binding.weapon_id = string(action.weapon);
                        semantic.weapon_ref = string(action.weapon);
                    }
                }
                else {
                    let handle: string;
                    if (targets.npc === null) {
                        if (snapshot) {
                            const opponents = sorted([...participants].filter(id => id !== context.actorId));
                            if (opponents.length === 1 && !truth(action.target))
                                handle = opponents[0];
                            else
                                throw new RpcError('needs', 'the attack needs a target in the fight', { details: { needs: { field: 'target', options: opponents } } });
                        }
                        else
                            throw new RpcError('needs', 'combat needs a present NPC as action.target', {
                                fix: 'set action.target to one of details.needs.options; someone not on stage yet is put there with apply npc and a to first. A thing with nobody behind it -- a falling beam, a door, an object moving on its own -- is an ordinary resolve or apply damage, not combat',
                                details: { needs: { field: 'target', options: context.presentNpcNames() } },
                            });
                    }
                    else {
                        handle = context.graph.handle(targets.npc);
                        if (context.npcProfile(handle) === null)
                            throw new RpcError('needs', `${context.graph.displayName(targets.npc)} has no stat block in the module`, {
                                fix: 'pin a stat block first: apply npc with archetype (one of details.needs.options, chosen from who this person is — ordinary_adult, capable_adult or dangerous_actor), then resolve again; when the module has a book that prints their numbers, read them with lookup kind=source instead. Or resolve it as an uncontested attempt against someone who cannot fight back. Nothing without a receipt has happened: do not narrate a blow as landed',
                                details: { needs: { field: 'archetype', options: await archetypeIds(context.kernel), fightable: sorted(presentOpponents(context).filter(([, , profile]) => truth(profile)).map(([handle]) => handle)) } },
                            });
                    }
                    semantic.candidate_ref = `attack:${handle}`;
                    binding.target_npc_id = handle;
                    const weapon = action.weapon;
                    if (weapon == null)
                        throw new RpcError('needs', 'the attack needs the weapon in hand', { fix: 'set action.weapon (unarmed for fists)', details: { needs: { field: 'weapon', options: weaponOptions(context.actor) } } });
                    if (!objectWeapon) usableWeapon(context.world, string(weapon), context.actorId);
                    const resolved = objectWeapon ?? await resolveInvestigatorWeapon(context.tables, context.actor, string(weapon));
                    if (!resolved)
                        throw new RpcError('needs', `${repr(weapon)} is not a weapon the investigator carries`, { fix: armingFix(string(weapon)), details: { needs: { field: 'weapon', options: weaponOptions(context.actor) } } });
                    semantic.weapon_ref = string(resolved.weapon_id);
                    binding.weapon_id = string(resolved.weapon_id);
                    if (snapshot === null) {
                        const [affordance] = combatOperationFor(context.graph, context.graph.scene(context.activeScene), handle, string(resolved.weapon_id));
                        if (affordance)
                            binding.affordance_id = affordance;
                    }
                }
                if (suffix === 'maneuver') {
                    delete semantic.weapon_ref;
                    // The engine takes one of four rulebook maneuvers here, but the tool's `goal` is a
                    // sentence, so a prose goal reached the engine as an invalid enum and came back as a
                    // refusal with no way out (`admission-e2e-2` turn 30, three times). Read the kind out
                    // of the goal when it names one, keep the old default for an unstated goal, and say
                    // the four otherwise.
                    const wanted = string(typeof context.action.goal === 'string' ? context.action.goal : '').trim().toLowerCase().replace(/[\s-]+/g, '_');
                    if (!wanted)
                        semantic.goal = 'ongoing_disadvantage';
                    else if (MANEUVER_GOALS.has(wanted) || Object.hasOwn(MANEUVER_ALIASES, wanted))
                        semantic.goal = wanted;
                    else
                        throw new RpcError('needs', 'a maneuver is one of the rulebook\'s four, and action.goal names which', {
                            fix: 'set action.goal to one of details.needs.options, and put the sentence in action.method; to simply hit instead, resolve the attack rather than the maneuver',
                            details: { needs: { field: 'goal', options: sorted(MANEUVER_GOALS) } },
                        });
                }
                return done();
            }
            if (suffix === 'aim' || suffix === 'reload') {
                const weapon = action.weapon;
                if (weapon != null && !isNpc) {
                    const resolved = objectWeapon ?? await resolveInvestigatorWeapon(context.tables, context.actor, string(weapon));
                    if (!resolved)
                        throw new RpcError('needs', `${repr(weapon)} is not a weapon the investigator carries`, { fix: armingFix(string(weapon)), details: { needs: { field: 'weapon', options: weaponOptions(context.actor) } } });
                    semantic.weapon_ref = string(resolved.weapon_id);
                    binding.weapon_id = string(resolved.weapon_id);
                }
                else if (weapon != null) {
                    semantic.weapon_ref = string(weapon);
                    binding.weapon_id = string(weapon);
                }
                return done();
            }
            if (suffix === 'end') {
                const outcome = action.outcome || snapshot?.outcome;
                if (!snapshot)
                    throw new RpcError('turn_state', 'no combat is underway to end', { fix: 'nothing to end' });
                if (!truth(outcome))
                    throw new RpcError('needs', 'combat:end needs the outcome the fight reached', { fix: 'set action.outcome', details: { needs: { field: 'outcome', options: outcomes() } } });
                if (!VALID_OUTCOMES.has(outcome))
                    throw new RpcError('invalid_params', `unknown combat outcome ${repr(outcome)}`, { details: { options: outcomes() } });
                semantic.outcome = string(outcome);
            }
            return done();
        },
        async locked(_context, runtime, selected, _grant) {
            const declared = runtime.declaredPayloadSlots(string(selected.decision_ref));
            return Object.fromEntries(entries(selected._host_session_binding).filter(([key, value]) => value != null && declared.has(key) && !key.startsWith('_')));
        },
        args(context, plan, selected) {
            const payload = row(row(plan.command).payload), binding = row(selected._host_session_binding), action = string(plan.decision_ref || '').split(':').at(-1)!;
            const result: Row = { investigator: context.actorId, decision_id: context.callId, action_kind: action, actor_id: binding._actor_id || context.actorId, goal_text: binding._goal_text ?? null };
            for (const key of ['affordance_id', 'target_npc_id', 'weapon_id', 'weapon_effect_ids', 'combat_revision', 'defense_kind', 'luck_spend_max', 'goal', 'outcome'])
                if (payload[key] != null)
                    result[key] = payload[key];
            if (action === 'attack' && context.action.defense === 'none')
                result.unopposed = true;
            // The dice the keeper declared for this call. They are a fact about the action, not a
            // slot the combat decisions declare, so they are read here beside `action.defense`
            // rather than through the compiled payload -- which is where they used to be dropped
            // without a word, leaving every fight in the product rolling plain (§NN).
            const [bonus, penalty] = context.declaredModifiers;
            if (bonus)
                result.bonus_dice = bonus;
            if (penalty)
                result.penalty_dice = penalty;
            if (action === 'end' && !truth(result.outcome))
                throw new RpcError('needs', 'combat:end needs the outcome the fight reached', {
                    fix: 'set action.outcome to one of details.needs.options', details: { needs: { field: 'outcome', options: ['investigators_win', 'monsters_win', 'fled', 'stalemate'] } },
                });
            return result;
        },
        async execute(context, args, plan) {
            const capability = row(plan.capability).resolver_capability;
            if (capability === 'combat.resolve')
                return executeCombatResolve(context, args);
            if (capability === 'combat.end')
                return executeCombatEnd(context, args);
            if (capability === 'combat.context') {
                const view = context.sessions();
                return { data: { session: view.combatView(), pending_choice: view.pendingChoice() }, warnings: [], hints: [] };
            }
            throw new RpcError('not_implemented', `Combat capability ${string(capability)} is not implemented`);
        },
        outcome(context, _ref, result) {
            const turn = row(result.turn), pending = isJsonObject(result.pending_attack) ? result.pending_attack : null;
            const status = result.status === 'concluded' ? 'ended' : truth(pending) ? 'pending_defense' : truth(result.started) && !truth(turn) ? 'started' : 'resolved';
            const out: Row = { kind: 'combat', status, action: result.action ?? null, actor: result.actor_id ?? null, round: result.round ?? null, rolls: rollViews(context), damage: damageViews(context) };
            if (truth(pending))
                Object.assign(out, { target: pending!.target_actor_id ?? null, defense_options: defenseOptions(pending!), attack_kind: pending!.resolution_hint ?? null });
            if (truth(turn))
                Object.assign(out, { target: turn.target_actor_id ?? null, turn_outcome: turn.outcome ?? null, defense: turn.defense_kind ?? null, opposed_outcome: turn.opposed_outcome ?? null });
            if (result.object_usage) out.object_usage = result.object_usage;
            if (result.status === 'concluded')
                out.combat_outcome = result.outcome ?? null;
            if (truth(result.started)) {
                out.started = true;
                out.initiative = result.initiative ?? null;
            }
            return out;
        },
    });
}
