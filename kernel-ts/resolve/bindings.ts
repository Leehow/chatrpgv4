/** Host-owned values for compiled plans; action text never supplies sheet arithmetic. */
import { isJsonObject } from '../json.js';
import { RpcError } from '../errors.js';
import { RuleGraph } from '../rules/graph.js';
import { array, clone, entries, integer, number, row, string, truth, values, type Row } from '../read/values.js';
import { recordOf } from '../read/module-graph.js';
import { SettleContext } from './context.js';
import { SOCIAL_APPROACH_SKILLS } from './arithmetic.js';
import { CHARACTERISTICS } from '../rules/skills.js';
export const ORDINARY = 'decision:coc7:core-check:ordinary-check';
export const COMBINED = 'decision:coc7:core-check:combined-check';
export const OPPOSED = 'decision:coc7:core-check:opposed-check';
export const PUSH = 'decision:coc7:push-luck:pushed-roll';
export const LUCK = 'decision:coc7:push-luck:luck-spend';
export const LUCK_ROLL = 'decision:coc7:push-luck:luck-roll';
export const SOCIAL = 'decision:coc7:social:adjudicate-difficulty';
export const OBSERVE = 'decision:coc7:psychology:observe-concealed';
export const REALIZE = 'decision:coc7:psychology:realize-player-safe';
export const BASIC_DECISIONS = new Set([ORDINARY, COMBINED, OPPOSED, PUSH, LUCK, LUCK_ROLL, SOCIAL, OBSERVE, REALIZE]);
export const semanticSlug = (value: any): string => string(truth(value) ? value : '').replace(/[^\p{L}\p{N}]/gu, ' ').toLowerCase().split(/\s+/).filter(Boolean).join('-');
export function sheetCheck(sheet: Row, ref: string): [
    string,
    number
] | null {
    const at = ref.indexOf(':');
    const kind = ref.slice(0, at);
    const slug = ref.slice(at + 1);
    if (at < 0 || !slug || !['skill', 'characteristic'].includes(kind))
        return null;
    for (const [label, value] of entries(sheet[kind === 'skill' ? 'skills' : 'characteristics'])) {
        if (semanticSlug(label) === semanticSlug(slug) && integer(value) && number(value) >= 0 && number(value) <= 100)
            return [kind === 'characteristic' ? label.toUpperCase() : label, number(value)];
    }
    return null;
}
export function npcCheck(context: SettleContext, ref: string): [
    string,
    number
] | null {
    const parts = ref.split(':');
    if (parts.length !== 4 || parts[0] !== 'npc' || !['skill', 'characteristic'].includes(parts[2]))
        return null;
    const profile = context.npcProfile(parts[1]);
    if (!profile)
        return null;
    for (const [label, value] of entries(profile[parts[2] === 'skill' ? 'skills' : 'characteristics'])) {
        if (semanticSlug(label) === semanticSlug(parts[3]) && integer(value) && number(value) >= 0 && number(value) <= 100)
            return [`${parts[1]} ${label}`, number(value)];
    }
    return null;
}
/**
 * SL-71 (§11.5.9): the skill family's own rulebook base chance, for an NPC actor's own roll with no
 * authored or pinned value -- the same deterministic number `basic.ts`'s `resolveTarget` already
 * falls back to for an investigator whose sheet does not carry a skill (`rulebook_base`). A
 * characteristic has no such table-wide default (it is always sheet- or profile-specific), so this
 * returns null for one and lets the caller ask instead.
 *
 * An `uncommon` skill (the rules data's own flag, `skills.json`) also returns null: CoC 7e marks a
 * skill uncommon precisely because nobody has it without deliberate training, so its printed base
 * chance is not "what any ordinary bystander can do" the way a common skill's is. `tests/kernel/
 * test_npc_layer.py`'s `test_an_ordinary_npc_helper_needs_their_missing_skill_without_using_player_base`
 * pins this: Steven Knott's missing Animal Handling (`uncommon: true`, base chance 5) still asks
 * rather than silently rolling that 5 -- §17.9's "ask once, never invent" stands for an uncommon skill,
 * and this addendum only relaxes it for the common ones where a rulebook base chance is genuinely a
 * fixed, deterministic fact rather than a guess about this particular person's training.
 */
export async function rulebookSkillDefault(context: SettleContext, label: string): Promise<number | null> {
    if (!label || Object.hasOwn(CHARACTERISTICS, label))
        return null;
    let spec: Row;
    try {
        spec = await context.tables.skillByName(label);
    }
    catch (error) {
        if (['KeyError', 'ValueError'].includes((error as Error).name) || (error as NodeJS.ErrnoException).code)
            return null;
        throw error;
    }
    if (spec.uncommon === true)
        return null;
    return integer(spec.base_chance) && number(spec.base_chance) >= 0 && number(spec.base_chance) <= 100 ? number(spec.base_chance) : null;
}
export function socialBinding(context: SettleContext, node: Row, approachSkill: string): Row {
    const handle = context.graph.handle(node);
    const record = recordOf(node);
    const evidence: string[] = [];
    if (typeof record.agenda === 'string' && record.agenda.trim())
        evidence.push(`npc_agenda:${handle}`);
    if (typeof record.secret === 'string' && record.secret.trim())
        evidence.push(`npc_secret:${handle}`);
    const defense = entries(context.npcProfile(handle)?.skills).filter(([key, value]) => (integer(value) || typeof value === 'boolean') && ['Psychology', approachSkill].includes(key)).map(([, value]) => number(value));
    return {
        target_ref: `social-target:${handle}`,
        npc_id: handle,
        conversation_window_id: `turn ${context.turnNumber}`,
        commitment_id: `commitment:${handle}-t${context.turnNumber}`,
        motive_evidence: evidence.length ? evidence : [`npc:${handle}`],
        npc_defense: defense.length ? Math.max(...defense) : null
    };
}
export function psychologyBinding(context: SettleContext, node: Row, question: string): Row {
    const handle = context.graph.handle(node);
    const observer = row(context.actor.skills).Psychology;
    const refs = array(recordOf(node).facts).filter(isJsonObject).flatMap(fact => typeof fact.clue_id === 'string' && context.graph.nodes.has(fact.clue_id) ? [`npc_fact:${handle}/${context.graph.handle(context.graph.nodes.get(fact.clue_id)!)}`] : []);
    const social = Object.values(SOCIAL_APPROACH_SKILLS);
    const opposing = entries(context.npcProfile(handle)?.skills).filter(([key, value]) => (integer(value) || typeof value === 'boolean') && social.includes(key)).map(([, value]) => number(value));
    return {
        investigator_id: context.actorId,
        npc_id: handle,
        conversation_window_id: `turn ${context.turnNumber}`,
        observation_revision: 0,
        observer_scope: context.actorId,
        observable_fact_refs: refs.length ? refs : [`npc_agenda:${handle}`],
        question,
        observer_skill: integer(observer) || typeof observer === 'boolean' ? number(observer) : null,
        target_opposing_social: opposing.length ? Math.max(...opposing) : null
    };
}
export async function psychologyRealizeBinding(context: SettleContext, node: Row): Promise<Row | null> {
    const handle = context.graph.handle(node);
    const document = row(await context.readSave('psychology-observations.json'));
    const matching = values(document.observations).filter(value => isJsonObject(value) && value.npc_id === handle && value.investigator_id === context.actorId);
    if (!matching.length)
        return null;
    const latest = matching.sort((a, b) => string(a.created_at || '').localeCompare(string(b.created_at || ''))).at(-1)!;
    return {
        investigator_id: context.actorId,
        npc_id: handle,
        conversation_window_id: latest.conversation_window_id ?? null,
        observation_revision: latest.observation_revision ?? 0,
        observer_scope: latest.observer_scope ?? null,
        observable_fact_refs: [...array(latest.observable_fact_refs)],
        question: latest.question ?? null,
        inference_ceiling: latest.inference_depth ?? null,
        observation_receipt_ref: latest.insight_id ?? null
    };
}
export async function hostLocked(context: SettleContext, runtime: RuleGraph, selected: Row, grant: Row | null): Promise<Row> {
    const ref = string(selected.decision_ref);
    const semantic = row(selected.semantic_inputs);
    const declared = runtime.declaredPayloadSlots(ref);
    const locked: Row = {};
    const sheet = context.sheetById(context.actorId) || {};
    if ([ORDINARY, COMBINED, OPPOSED, LUCK_ROLL].includes(ref)) {
        if (declared.has('investigator_id'))
            locked.investigator_id = context.actorId;
        if (ref === ORDINARY) {
            if (context.actingId !== context.actorId) {
                const label = string(semantic.skill || semantic.characteristic || '');
                const value = await context.actorSkillValue(context.actingId, label);
                if (value === null) {
                    const node = context.npcNode(context.actingId);
                    if (!node)
                        throw new RpcError('needs', `the rescuer has no ${label} value on the sheet`, {
                            fix: `name an investigator with ${label} as action.actor`,
                            details: {
                                needs: {
                                    field: 'actor',
                                    options: context.partyNames()
                                }
                            }
                        });
                    // SL-71 (§11.5.9): no in-flight pin, ledger pin or authored value for this skill --
                    // before asking, try the skill's own rulebook base chance, the same deterministic
                    // fallback an investigator's own unlisted skill already gets (basic.ts's
                    // `rulebook_base`). It is not a guess that changes between calls: the same skill
                    // name always answers the same number, so it is never "the kernel inventing a
                    // number that will be different next time" -- the one thing §17.9 forbids. Only a
                    // characteristic (no rulebook base to fall back to) or a skill absent from the
                    // rules table still asks.
                    const fallback = await rulebookSkillDefault(context, label);
                    if (fallback !== null) {
                        locked.investigator_id = context.actingId;
                        locked.target = fallback;
                        return locked;
                    }
                    const who = context.graph.displayName(node);
                    throw new RpcError('needs', `the book gives ${who} no ${label}`, {
                        fix: `pin it once with apply npc {name: "${who}", skill: {name: "${label}", value: <0-100>}}, why: ...}} — it is theirs from then on`,
                        details: {
                            needs: {
                                field: 'npc.skill',
                                options: []
                            },
                            actor: context.actingId,
                            skill: label
                        }
                    });
                }
                locked.investigator_id = context.actingId;
                locked.target = value;
                return locked;
            }
            const checkRef = semantic.skill ? `skill:${semantic.skill}` : semantic.characteristic ? `characteristic:${semantic.characteristic}` : '';
            const resolved = sheetCheck(sheet, checkRef);
            if (resolved)
                locked.target = resolved[1];
            else if (semantic.skill) {
                const base = await context.skillValue(sheet, string(semantic.skill));
                if (base !== null)
                    locked.target = base;
            }
        }
        else if (ref === COMBINED) {
            const targets: Row[] = [];
            for (const target of array(semantic.combined_target_refs)) {
                let resolved = sheetCheck(sheet, string(target));
                if (!resolved && string(target).startsWith('skill:')) {
                    const label = string(target).slice(6);
                    const base = await context.skillValue(sheet, label);
                    if (base !== null)
                        resolved = [label, base];
                }
                if (resolved)
                    targets.push({
                        label: resolved[0],
                        value: resolved[1]
                    });
            }
            if (targets.length)
                locked.combined_targets = targets;
        }
        else if (ref === OPPOSED) {
            let actor = sheetCheck(sheet, string(semantic.actor_check_ref || ''));
            if (!actor && string(semantic.actor_check_ref || '').startsWith('skill:')) {
                const label = string(semantic.actor_check_ref).slice(6);
                const base = await context.skillValue(sheet, label);
                if (base !== null)
                    actor = [label, base];
            }
            const opponent = npcCheck(context, string(semantic.opponent_check_ref || ''));
            if (actor)
                locked.investigator_target = actor[1];
            if (opponent)
                locked.opponent_value = opponent[1];
        }
        else
            locked.target = number(sheet.current_luck ?? row(sheet.characteristics).LUCK);
    }
    else if ([PUSH, LUCK].includes(ref)) {
        const source = row(selected._host_source_receipt);
        const sourceId = string(selected._host_source_receipt_id || '');
        if (truth(source) && sourceId) {
            Object.assign(locked, {
                original_check_decision_id: sourceId,
                canonical_roll_receipt: clone(source),
                continuation_grant: clone(grant || {}),
                investigator_id: source.investigator_id || context.actorId
            });
            if (ref === LUCK)
                locked.source_roll_id = source.roll_id || sourceId;
            else
                for (const key of ['target', 'difficulty', 'bonus', 'penalty', 'skill'])
                    if (source[key] != null)
                        locked[key] = source[key];
        }
    }
    else if (ref === SOCIAL) {
        const binding = row(selected._host_social_binding);
        if (Array.isArray(binding.motive_evidence))
            locked.motive_evidence = [...binding.motive_evidence];
        if (binding.npc_defense != null && declared.has('npc_defense'))
            locked.npc_defense = binding.npc_defense;
    }
    else if ([OBSERVE, REALIZE].includes(ref)) {
        const binding = row(selected._host_psychology_binding);
        for (const key of ['investigator_id', 'npc_id', 'observer_skill', 'target_opposing_social', 'conversation_window_id', 'observation_revision', 'observer_scope', 'observable_fact_refs', 'inference_ceiling', 'observation_receipt_ref'])
            if (declared.has(key) && binding[key] != null)
                locked[key] = clone(binding[key]);
    }
    return locked;
}
export function executorArgs(context: SettleContext, plan: Row, selected: Row): Row {
    const payload = row(row(plan.command).payload);
    const capability = row(plan.capability).resolver_capability;
    const output: Row = {
        investigator: context.actorId,
        decision_id: context.callId
    };
    const copy = (keys: string[]) => { for (const key of keys)
        if (payload[key] != null)
            output[key] = clone(payload[key]); };
    if (capability === 'check') {
        output.investigator = string(payload.investigator_id || context.actorId);
        copy(['skill', 'characteristic', 'target', 'combined_targets', 'combined_mode', 'difficulty', 'goal', 'stakes', 'difficulty_basis', 'bonus', 'penalty', 'npc_id', 'social_adjudication_ref', 'pushed', 'method_changed', 'failure_consequence', 'original_check_decision_id']);
        // A combined check declares no `bonus`/`penalty` payload slot, so the keeper's declared dice
        // were filtered out of the plan and the roll came out plain (§95). The pushed roll keeps the
        // original check's dice, which `locked` already wrote into the payload -- only fill in when
        // the plan carries neither, so an inherited zero is never overwritten by a fresh declaration.
        if (payload.social_adjudication_ref != null) {
            // The adjudication's own dice (a supporting clue, the person's stance) and the die the player's
            // words earned (§113) add up; the arithmetic caps the total at two either way.
            const [bonus, penalty] = context.declaredModifiers;
            if (bonus || penalty) {
                output.bonus = number(payload.bonus ?? 0) + bonus;
                output.penalty = number(payload.penalty ?? 0) + penalty;
            }
        }
        else if (payload.bonus == null && payload.penalty == null) {
            const [bonus, penalty] = context.declaredModifiers;
            output.bonus = bonus;
            output.penalty = penalty;
        }
        // The reason the dice were given rides beside them to the receipt (§113); it is host-owned, never a decision slot.
        const reason = context.declaredModifiers[3];
        if (reason && (number(output.bonus) > 0 || number(output.penalty) > 0 || string(output.difficulty ?? 'regular') !== 'regular'))
            output.modifier_reason = reason;
    }
    else if (capability === 'opposed') {
        const ref = string(payload.actor_check_ref || '');
        const at = ref.indexOf(':');
        const kind = ref.slice(0, at);
        const label = ref.slice(at + 1);
        if (kind === 'skill' && label)
            output.skill = label;
        else if (kind === 'characteristic' && label)
            output.characteristic = label.toUpperCase();
        else
            throw new RpcError('needs', "the opposed check needs the investigator's skill", {
                details: {
                    needs: {
                        field: 'skill',
                        options: []
                    }
                }
            });
        if (payload.investigator_target != null)
            output.target = payload.investigator_target;
        if (payload.opponent_value == null)
            throw new RpcError('needs', 'the opponent has no authored value for that skill', {
                fix: "pick a skill the NPC's authored profile carries (details.needs.options)",
                details: {
                    needs: {
                        field: 'skill',
                        options: context.npcSkillLabels(string(payload.opponent_check_ref || ''))
                    }
                }
            });
        // The advantage the keeper declared is the investigator's, not the opponent's: it is the
        // investigator's attempt that the several helpers, the prepared approach or the ground
        // favour. The opponent rolls plain unless the rules give them something of their own (§95).
        const [opposedBonus, opposedPenalty] = context.declaredModifiers;
        Object.assign(output, {
            contest_kind: 'noncombat',
            opponent_value: payload.opponent_value,
            opponent_label: string(payload.opponent_check_ref || 'opponent'),
            bonus: opposedBonus,
            penalty: opposedPenalty,
            reason: 'RuleGraph opposed check'
        });
    }
    else if (capability === 'push_policy') {
        delete output.investigator;
        copy(['original_check_decision_id', 'method_changed', 'failure_consequence', 'target', 'difficulty', 'bonus', 'penalty', 'modifier_reason', 'skill', 'canonical_roll_receipt']);
    }
    else if (capability === 'luck_spend')
        copy(['points', 'source_roll_id', 'canonical_roll_receipt', 'original_check_decision_id']);
    else if (capability === 'social_difficulty') {
        const binding = row(selected._host_social_binding);
        const missing = ['npc_id', 'conversation_window_id', 'commitment_id', 'motive_evidence'].filter(key => !truth(binding[key]));
        if (missing.length)
            throw new RpcError('unknown_entity', 'the social target could not be bound', {
                details: {
                    missing,
                    candidates: context.presentNpcNames()
                }
            });
        Object.assign(output, {
            npc_id: binding.npc_id,
            conversation_window_id: binding.conversation_window_id,
            commitment_id: binding.commitment_id,
            approach: payload.approach ?? null,
            goal_summary: payload.goal ?? null,
            described_action: payload.described_action ?? null,
            motive: {
                direction: payload.motive_direction ?? null,
                intensity: payload.motive_intensity ?? null,
                evidence_refs: [...binding.motive_evidence]
            },
            feasibility: payload.feasibility ?? null,
            feasibility_refs: [...binding.motive_evidence]
        });
        if (payload.npc_defense != null)
            output.npc_defense_value = payload.npc_defense;
        const supporting = row(payload.supporting_action);
        if (supporting.level === 1) {
            const ref = string(supporting.source_ref || '').trim();
            if (!ref)
                throw new RpcError('needs', 'supporting_action level 1 requires the clue it rests on', {
                    details: {
                        needs: {
                            field: 'support',
                            options: array(context.world.discovered_clues)
                        }
                    }
                });
            output.leverage = [{
                    leverage_id: string(supporting.leverage_id || `support:${ref}`),
                    source_ref: ref,
                    independence_group: string(supporting.independence_group || ref),
                    credibility: 'verified',
                    relevance: 'direct',
                    reason: string(supporting.description || 'supporting case'),
                    type: string(supporting.type || 'supporting_action')
                }];
        }
        else
            output.leverage = [];
    }
    else if (['psychology_check_contract', 'psychology_policy'].includes(capability)) {
        const binding = row(selected._host_psychology_binding);
        const missing = ['npc_id', 'conversation_window_id', 'observation_revision', 'observer_scope'].filter(key => binding[key] == null);
        if (missing.length)
            throw new RpcError('unknown_entity', 'the Psychology target could not be bound', {
                details: {
                    missing,
                    candidates: context.presentNpcNames()
                }
            });
        Object.assign(output, {
            action: capability === 'psychology_policy' ? 'realize' : 'settle',
            npc_id: binding.npc_id,
            conversation_window_id: binding.conversation_window_id,
            observation_revision: binding.observation_revision,
            observer_scope: binding.observer_scope,
            question: string(payload.question || binding.question || '')
        });
        if (capability === 'psychology_check_contract') {
            output.observable_fact_refs = [...array(binding.observable_fact_refs)];
            copy(['observer_skill', 'target_opposing_social']);
        }
        else
            Object.assign(output, {
                insight_id: binding.observation_receipt_ref ?? null,
                inference_ceiling: payload.inference_ceiling || binding.inference_ceiling || null,
                visible_observation: payload.external_behavior ?? null
            });
    }
    return output;
}
