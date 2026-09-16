/** Validate the current combat schema and reconstruct its authoritative live cursor. */
import { isJsonObject } from '../json.js';
import { array, clone, entries, equal, integer, number, row, sorted, string, truth, type Row } from '../read/values.js';
import { valueError } from '../resolve/arithmetic.js';
import { type CombatSession, RESOLUTION_HINTS, VALID_ARMOR_RULES, VALID_CONDITIONS, VALID_OUTCOMES, VALID_SIDES, validateMechanicsRevisionRef } from './engine.js';
import { canonicalSkipSourceReceipt, damageBindingsForTurn, damageTransactionReceipt, externalDamageReceipt, reconstructDamageRoll } from './evidence.js';
import { OUT_OF_FIGHT_CONDITIONS } from '../healing/conditions.js';
const ROOT_KEYS = ['schema_version', 'combat_id', 'scene_ref', 'started_at_turn', 'status', 'participants', 'rounds', 'damage_chain', 'revision', 'current_round', 'current_initiative', 'initiative_cursor', 'initiative_progress', 'pending_attack', 'ended_at_turn', 'outcome', 'jammed_weapons', 'weapon_catalog', 'turn_counter', 'roll_counter'];
const PARTICIPANT_KEYS = ['actor_id', 'side', 'dex', 'combat_skill', 'dodge_skill', 'firearms_skill', 'has_ready_firearm', 'build', 'damage_bonus', 'con', 'hp_max', 'hp_current', 'magic_points', 'armor', 'armor_rule', 'weapons', 'conditions', 'active_effects', '_defended_this_round', '_dived_for_cover', '_forfeit_next_attack', '_aiming', '_ammo', '_reload_remaining'];
const TURN_KEYS = ['turn_id', 'actor_id', 'dex', 'dex_reason', 'declared_intent', 'action', 'target_actor_id', 'roll_id', 'opposed_roll_id', 'opposed_outcome', 'defense_kind', 'outcome', 'effect_applied', 'damage_roll_id', 'resolution_hint'];
const TURN_OPTIONAL = ['goal', 'weapon_id', 'attack_modifiers', 'malfunction', 'cover_reroll_roll_id', 'defender_goal', 'fight_back_damage_roll_id', 'fight_back_weapon_id', 'shots', 'hits', 'volleys', 'rounds_fired', 'dived_for_cover', 'suppression_targets', 'dive_rolls', 'maneuver_build_difference', 'maneuver_penalty_dice', 'ammo_loaded', 'ammo_after', 'reload_rounds_remaining', 'resolution_command_id', 'luck_spend'];
const DAMAGE_KEYS = ['damage_roll_id', 'source_turn_id', 'source_actor_id', 'target_actor_id', 'weapon_id', 'die', 'die_rolls', 'rolled_total', 'raw_damage', 'hp_before', 'hp_delta', 'hp_after', 'armor_absorbed', 'armor_before', 'armor_after', 'rulebook_exception', 'bypass_armor', 'half_damage_bonus', 'damage_multiplier', 'weapon_effect_ids', 'marker', 'status_after', 'provenance'];
const EXTREME_KEYS = ['impale_or_max', 'extreme_damage', 'extreme_breakdown', 'is_impale'];
const MALFUNCTION_KEYS = ['malfunction_roll_id', 'source_turn_id', 'source_actor_id', 'weapon_id', 'weapon_display_name', 'roll', 'malfunction_threshold', 'effect', 'marker'];
const PROGRESS_KEYS = ['actor_id', 'round_start_eligibility', 'initiative', 'status', 'skip_evidence'];
const ELIGIBILITY_KEYS = ['hp_current', 'conditions', 'dex', 'combat_skill', 'firearms_skill', 'has_ready_firearm'];
const object = (value: any): boolean => isJsonObject(value);
const exact = (value: any, keys: string[]): boolean => object(value) && equal(sorted(Object.keys(value)), sorted(keys));
const schema = (value: any, required: string[], optional: string[] = []): boolean => object(value) && required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
const text = (value: any): boolean => typeof value === 'string' && !!value;
const whole = (value: any, label: string, minimum = 0): number => { if (!integer(value) || value < minimum)
    valueError(`combat ${label} is invalid`); return number(value); };
const validConditions = (conditions: any): boolean => Array.isArray(conditions) && conditions.length === new Set(conditions).size && conditions.every(value => VALID_CONDITIONS.has(value));
const eligible = (hp: any, conditions: any): boolean => hp > 0 && !array(conditions).some(value => OUT_OF_FIGHT_CONDITIONS.has(value));
function validateExternal(session: CombatSession, evidence: any, turns: Map<string, [
    number,
    Row
]>, damageIds: Set<string>): void {
    if (!Array.isArray(evidence))
        valueError('combat external damage evidence is required');
    const byRoll = new Map<string, Row[]>(), legacy = ['type', 'actor', 'command_id', 'payload', 'ts'], canonical = [...legacy, 'event_type', 'roll_id', 'visibility', 'source', 'source_ref'];
    for (const item of evidence) {
        if (!exact(item, legacy) && !exact(item, canonical))
            valueError('combat external damage evidence contract is invalid');
        const payload = item.payload, receipt = object(payload) ? payload.combat_damage_receipt : null;
        if (!object(receipt))
            continue;
        const id = receipt.roll_id;
        if (typeof id !== 'string')
            continue;
        if (exact(item, canonical) && (item.event_type !== 'roll' || item.roll_id !== id || item.visibility !== payload.visibility || !['public', 'consequence_public', 'keeper_only'].includes(item.visibility) || !text(item.source) || !text(item.source_ref)))
            valueError('combat external damage evidence contract is invalid');
        byRoll.set(id, [...byRoll.get(id) ?? [], item]);
    }
    const damages = new Map(session.damageChain.filter(damage => typeof damage.damage_roll_id === 'string').map(damage => [damage.damage_roll_id, damage]));
    for (const id of damageIds) {
        const rows = byRoll.get(id) ?? [];
        if (rows.length !== 1)
            valueError('combat external damage evidence is missing or duplicated');
        const item = rows[0], payload = item.payload, damage = damages.get(id)!, turn = turns.get(damage.source_turn_id)?.[1];
        if (!turn)
            valueError('combat external damage evidence source is invalid');
        const expected = externalDamageReceipt(turn, damage), command = turn.resolution_command_id;
        if (!text(command) || item.type !== 'roll' || item.actor !== damage.source_actor_id || item.command_id !== command || !text(item.ts) ||
            payload.event_type !== 'combat_roll' || payload.roll_id !== id || payload.actor_id !== damage.source_actor_id || payload.skill !== 'HP Damage' ||
            payload.source_command_id !== command || payload.target_actor_id !== damage.target_actor_id || !equal(payload.rolled_total, damage.rolled_total) ||
            // `dice.total` is the damage applied, `rolled_total` the dice: both are checked, so
            // neither the roll nor the extreme-success recalculation can be edited unnoticed
            // (contract section 16.2, decision of 2026-09-12).
            !equal(payload.dice, { expression: damage.die, raw: damage.die_rolls, total: damage.raw_damage }) || !equal(payload.combat_damage_receipt, expected))
            valueError('combat external damage evidence diverges');
    }
}
function validateSkip(session: CombatSession, progress: Row, historical: boolean, round: Row): void {
    const evidence = progress.skip_evidence, status = progress.status, prefix = historical ? 'combat historical' : 'combat';
    if (status !== 'skipped_ineligible') {
        if (evidence != null)
            valueError(status === 'excluded_at_round_start' ? `${prefix} excluded initiative actor is invalid` : `${prefix} initiative progress has unexpected skip evidence`);
        return;
    }
    if (!exact(evidence, ['hp_current', 'conditions', 'source_receipt']) || !integer(evidence.hp_current) || evidence.hp_current < 0 || !validConditions(evidence.conditions) || eligible(evidence.hp_current, evidence.conditions))
        valueError(`${prefix} initiative skip lacks eligibility evidence`);
    const expected = canonicalSkipSourceReceipt(progress.actor_id, round, session.damageChain);
    if (!expected || !equal(evidence.source_receipt, expected) || !equal(evidence.hp_current, expected.hp_current) || !equal(evidence.conditions, expected.conditions))
        valueError(`${prefix} initiative skip source receipt diverges from history`);
}
export function restoreCombatSnapshot(session: CombatSession, input: Row, options: {
    damageEvidence?: Row[] | null;
    damageEvidenceActor?: string | null;
    trustedInMemory?: boolean;
} = {}): void {
    const data = clone(input);
    if (!exact(data, ROOT_KEYS))
        valueError('combat snapshot must use the exact schema');
    for (const field of ['combat_id', 'scene_ref'])
        if (typeof data[field] !== 'string' || !data[field].trim())
            valueError(`combat ${field} is invalid`);
    whole(data.started_at_turn, 'started_at_turn');
    if (!Array.isArray(data.participants))
        valueError('combat participants must be a list');
    for (const participant of data.participants) {
        if (!object(participant))
            valueError('combat participant must be an object');
        if (!schema(participant, PARTICIPANT_KEYS, ['major_wound_con', 'mechanics_revision_ref', 'throw_skill']))
            valueError('combat participant must use the exact schema');
        const id = participant.actor_id, conditions = participant.conditions;
        if (typeof id !== 'string' || Object.hasOwn(session.participants, id))
            valueError('combat participant IDs must be unique strings');
        if (!VALID_SIDES.has(participant.side))
            valueError('combat participant side is invalid');
        if (Object.hasOwn(participant, 'mechanics_revision_ref'))
            validateMechanicsRevisionRef(participant.mechanics_revision_ref, id);
        if (!validConditions(conditions))
            valueError('combat participant conditions are invalid');
        const maximum = whole(participant.hp_max, 'participant hp_max', 1), hp = whole(participant.hp_current, 'participant hp_current');
        if (hp > maximum)
            valueError('combat participant HP is out of range');
        if (conditions.includes('dead') && hp !== 0)
            valueError('dead participant must have zero HP');
        if (conditions.includes('dying') && (hp > 1 || !conditions.includes('major_wound')))
            valueError('dying participant state is incoherent');
        for (const field of ['dex', 'combat_skill', 'dodge_skill', 'firearms_skill', 'throw_skill', 'con'].filter(field => Object.hasOwn(participant, field)))
            if (whole(participant[field], `participant ${field}`) > 150)
                valueError(`combat participant ${field} is out of range`);
        for (const field of ['build', 'magic_points', 'armor'])
            if (!integer(participant[field]))
                valueError(`combat participant ${field} is invalid`);
        if (!VALID_ARMOR_RULES.has(participant.armor_rule))
            valueError('combat participant armor rule is invalid');
        if (!Array.isArray(participant.weapons) || !participant.weapons.every((weapon: any) => object(weapon) || typeof weapon === 'string' && weapon.trim()))
            valueError('combat participant weapons are invalid');
        if (!Array.isArray(participant.active_effects))
            valueError('combat participant active effects are invalid');
        if (['has_ready_firearm', '_defended_this_round', '_dived_for_cover', '_forfeit_next_attack', '_aiming'].some(field => typeof participant[field] !== 'boolean'))
            valueError('combat participant flags are invalid');
        if (!object(participant._ammo) || !object(participant._reload_remaining))
            valueError('combat participant weapon counters are invalid');
        session.participants[id] = { ...participant };
    }
    if (!Array.isArray(data.rounds) || !data.rounds.every(object))
        valueError('combat rounds are invalid');
    if (!Array.isArray(data.damage_chain) || !data.damage_chain.every(object))
        valueError('combat damage chain is invalid');
    session.rounds = [...data.rounds];
    session.damageChain = [...data.damage_chain];
    session.revision = whole(data.revision, 'revision');
    session.currentRound = whole(data.current_round, 'current round');
    session.currentInitiative = [...data.current_initiative];
    session.initiativeCursor = whole(data.initiative_cursor, 'initiative cursor');
    session.initiativeProgress = [...data.initiative_progress];
    if (!Array.isArray(data.jammed_weapons) || !data.jammed_weapons.every((value: any) => typeof value === 'string'))
        valueError('combat jammed weapons are invalid');
    session.jammedWeapons = new Set(data.jammed_weapons);
    if (!object(data.weapon_catalog) || !entries(data.weapon_catalog).every(([, spec]) => object(spec)))
        valueError('combat weapon catalog is invalid');
    session.weaponCatalog = Object.fromEntries(entries(data.weapon_catalog).map(([id, spec]) => [id, { ...spec }]));
    session.turnCounter = whole(data.turn_counter, 'turn counter');
    session.rollCounter = whole(data.roll_counter, 'roll counter');
    session.pendingAttack = object(data.pending_attack) ? { ...data.pending_attack } : null;
    session.status = string(data.status);
    session.outcome = data.outcome;
    session.endedAtTurn = data.ended_at_turn;
    if (!['active', 'concluded'].includes(session.status))
        valueError('combat status is invalid');
    if (session.endedAtTurn !== null)
        session.endedAtTurn = whole(session.endedAtTurn, 'ended_at_turn');
    if (session.currentRound !== session.rounds.length)
        valueError('combat round cursor does not match round history');
    if (!equal(session.currentInitiative, session.rounds.at(-1)?.initiative_order ?? []))
        valueError('combat initiative does not match current round');
    for (const [i, round] of session.rounds.entries())
        if (!exact(round, ['round', 'initiative_order', 'initiative_progress', 'turns']) || round.round !== i + 1 || !Array.isArray(round.initiative_order) || !Array.isArray(round.initiative_progress) || !Array.isArray(round.turns) || !round.turns.every(object))
            valueError('combat round history is invalid');
    const turns = new Map<string, [
        number,
        Row
    ]>(), bindings = new Map<string, [
        number,
        Row,
        Row
    ]>();
    for (const [i, round] of session.rounds.entries())
        for (const turn of round.turns) {
            if (!schema(turn, TURN_KEYS, TURN_OPTIONAL))
                valueError('combat turn must use the exact schema');
            const id = turn.turn_id;
            if (typeof id !== 'string' || !new RegExp(`^t${i + 1}-[1-9][0-9]*$`).test(id) || id.endsWith('\n') || turns.has(id) || !Object.hasOwn(session.participants, turn.actor_id) || !integer(turn.dex) ||
                typeof turn.declared_intent !== 'string' || !turn.declared_intent.trim() || !RESOLUTION_HINTS.has(turn.resolution_hint) || typeof turn.action !== 'string' ||
                turn.target_actor_id !== null && !Object.hasOwn(session.participants, turn.target_actor_id) || !text(turn.outcome))
                valueError('combat turn provenance is invalid');
            for (const field of ['roll_id', 'opposed_roll_id', 'damage_roll_id', 'fight_back_damage_roll_id', 'cover_reroll_roll_id'])
                if (turn[field] != null && !text(turn[field]))
                    valueError('combat turn roll provenance is invalid');
            if (turn.resolution_command_id != null && !text(turn.resolution_command_id))
                valueError('combat turn command provenance is invalid');
            turns.set(id, [i + 1, turn]);
            for (const binding of damageBindingsForTurn(turn)) {
                if (bindings.has(binding.damage_roll_id))
                    valueError('combat turn damage roll provenance is duplicated');
                bindings.set(binding.damage_roll_id, [i + 1, turn, binding]);
            }
        }
    const seen = new Set<string>(), lastHp = new Map<string, number>();
    for (const damage of session.damageChain) {
        if (exact(damage, MALFUNCTION_KEYS)) {
            const linked = turns.get(damage.source_turn_id);
            if (!linked || damage.source_actor_id !== linked[1].actor_id || !text(damage.malfunction_roll_id) || !integer(damage.roll) || !integer(damage.malfunction_threshold) || damage.roll < damage.malfunction_threshold || damage.effect !== 'jammed_until_repaired')
                valueError('combat damage chain malfunction provenance is invalid');
            continue;
        }
        if (!schema(damage, DAMAGE_KEYS, EXTREME_KEYS) || EXTREME_KEYS.some(key => Object.hasOwn(damage, key)) && !EXTREME_KEYS.every(key => Object.hasOwn(damage, key)))
            valueError('combat damage chain must use the exact schema');
        const id = damage.damage_roll_id, binding = bindings.get(id);
        if (!text(id) || seen.has(id) || !binding)
            valueError('combat damage provenance is missing or duplicated');
        seen.add(id);
        const [roundNumber, turn, owner] = binding;
        if (damage.source_turn_id !== turn.turn_id || damage.source_actor_id !== owner.source_actor_id || damage.target_actor_id !== owner.target_actor_id || !Object.hasOwn(session.participants, damage.source_actor_id) || !Object.hasOwn(session.participants, damage.target_actor_id))
            valueError('combat damage provenance diverges from its turn');
        if (['rolled_total', 'raw_damage', 'hp_before', 'hp_delta', 'hp_after', 'armor_absorbed', 'armor_before', 'armor_after', 'damage_multiplier'].some(field => !integer(damage[field])))
            valueError('combat damage chain arithmetic is invalid');
        const raw = damage.raw_damage, before = damage.hp_before, after = damage.hp_after, absorbed = damage.armor_absorbed;
        if (!equal(reconstructDamageRoll(damage.die, damage.die_rolls), damage.rolled_total))
            valueError('combat damage chain roll evidence diverges from total');
        if (damage.damage_multiplier < 1 || damage.damage_multiplier > 10 || !Array.isArray(damage.weapon_effect_ids) || damage.weapon_effect_ids.some((value: any) => !text(value)))
            valueError('combat damage effect evidence is invalid');
        if (!truth(damage.extreme_damage) && damage.rolled_total * damage.damage_multiplier !== raw)
            valueError('combat damage chain roll evidence diverges from its rolled total');
        if (raw < 0 || before < 0 || after < 0 || absorbed < 0 || absorbed > raw || damage.hp_delta !== after - before || after !== Math.max(0, before - (raw - absorbed)) || damage.armor_before < 0 || damage.armor_after < 0)
            valueError('combat damage chain arithmetic is invalid');
        const target = session.participants[damage.target_actor_id];
        if (damage.bypass_armor === true) {
            if (absorbed !== 0 || damage.armor_after !== damage.armor_before)
                valueError('combat damage chain armor arithmetic is invalid');
        }
        else if (target.armor_rule === 'degrades_1_per_damage') {
            if (damage.armor_after !== Math.max(0, damage.armor_before - absorbed))
                valueError('combat damage chain armor arithmetic is invalid');
        }
        else if (damage.armor_after !== damage.armor_before)
            valueError('combat damage chain armor arithmetic is invalid');
        const status = damage.status_after;
        if (!exact(status, ['hp_current', 'conditions']) || !equal(status.hp_current, after) || !validConditions(status.conditions) ||
            after === 0 && !status.conditions.includes('unconscious') && !status.conditions.includes('dead') || status.conditions.includes('dead') && after !== 0 ||
            status.conditions.includes('dying') && !status.conditions.includes('major_wound'))
            valueError('combat damage chain status transition is invalid');
        const round = session.rounds[roundNumber - 1], key = `${roundNumber}\0${damage.target_actor_id}`;
        const roster = new Map(array(round.initiative_progress).filter(isJsonObject).map(item => [item.actor_id, item.round_start_eligibility]));
        const expectedBefore = lastHp.get(key) ?? row(roster.get(damage.target_actor_id)).hp_current;
        if (!equal(before, expectedBefore))
            valueError('combat damage chain cross-record HP is invalid');
        lastHp.set(key, after);
        if (!equal(damage.provenance, damageTransactionReceipt(roundNumber, turn, damage, owner)))
            valueError('combat damage provenance receipt diverges');
    }
    if (!equal(sorted(bindings.keys()), sorted(seen)))
        valueError('combat turn references missing damage provenance');
    if (seen.size && !options.trustedInMemory)
        validateExternal(session, options.damageEvidence, turns, seen);
    if (session.turnCounter < session.rounds.reduce((count, round) => count + round.turns.length, 0))
        valueError('combat turn counter is behind round history');
    if (session.currentInitiative.some(item => !exact(item, ['actor_id', 'dex', 'dex_reason']) || !integer(item.dex) || ![null, 'ready_firearm'].includes(item.dex_reason)))
        valueError('combat initiative order is invalid');
    const initiativeIds = session.currentInitiative.map(item => item.actor_id);
    if (initiativeIds.length !== new Set(initiativeIds).size || initiativeIds.some(id => !Object.hasOwn(session.participants, id)) || session.initiativeCursor > session.currentInitiative.length)
        valueError('combat initiative cursor/order is invalid');
    const order = (a: Row, b: Row, skill: (id: string) => number) => b.dex - a.dex || skill(b.actor_id) - skill(a.actor_id) || (a.actor_id < b.actor_id ? -1 : a.actor_id > b.actor_id ? 1 : 0);
    if (!equal(session.currentInitiative, [...session.currentInitiative].sort((a, b) => order(a, b, id => session.participants[id].combat_skill))) || session.currentInitiative.some(item => item.dex !== session.participants[item.actor_id].dex + (item.dex_reason === 'ready_firearm' ? 50 : 0)))
        valueError('combat initiative order is not canonical');
    if (!session.rounds.length || !equal(session.initiativeProgress, session.rounds.at(-1)!.initiative_progress))
        valueError('combat initiative progress does not match current round');
    const progress = new Map<string, Row>();
    for (const item of session.initiativeProgress) {
        if (!exact(item, PROGRESS_KEYS))
            valueError('combat initiative progress is invalid');
        const id = item.actor_id, eligibility = item.round_start_eligibility;
        if (!Object.hasOwn(session.participants, id) || progress.has(id) || !exact(eligibility, ELIGIBILITY_KEYS) || !Array.isArray(eligibility.conditions) || eligibility.conditions.some((value: any) => !VALID_CONDITIONS.has(value)) ||
            ['hp_current', 'dex', 'combat_skill', 'firearms_skill'].some(field => !integer(eligibility[field])) || typeof eligibility.has_ready_firearm !== 'boolean')
            valueError('combat initiative round-start eligibility is invalid');
        progress.set(id, item);
    }
    if (!equal(sorted(progress.keys()), sorted(Object.keys(session.participants))))
        valueError('combat initiative roster omits a participant');
    const fromRoster: Row[] = [];
    for (const [id, item] of progress) {
        const eligibility = item.round_start_eligibility;
        if (!eligible(eligibility.hp_current, eligibility.conditions)) {
            if (item.initiative !== null || item.status !== 'excluded_at_round_start')
                valueError('combat excluded initiative actor is invalid');
            validateSkip(session, item, false, session.rounds.at(-1)!);
            continue;
        }
        const reason = eligibility.has_ready_firearm && eligibility.firearms_skill > 0 ? 'ready_firearm' : null, expected = { actor_id: id, dex: eligibility.dex + (reason ? 50 : 0), dex_reason: reason };
        if (!equal(item.initiative, expected) || !['pending', 'acted', 'skipped_ineligible'].includes(item.status))
            valueError('combat eligible initiative actor is invalid');
        validateSkip(session, item, false, session.rounds.at(-1)!);
        fromRoster.push(expected);
    }
    fromRoster.sort((a, b) => order(a, b, id => progress.get(id)!.round_start_eligibility.combat_skill));
    if (!equal(fromRoster, session.currentInitiative))
        valueError('combat initiative order diverges from round-start roster');
    for (const [i, item] of session.currentInitiative.entries()) {
        const status = progress.get(item.actor_id)!.status;
        if (i < session.initiativeCursor ? !['acted', 'skipped_ineligible'].includes(status) : status !== 'pending')
            valueError('combat initiative cursor diverges from persisted progress');
    }
    for (const historical of session.rounds.slice(0, -1)) {
        const rows = historical.initiative_progress;
        if (!Array.isArray(rows) || rows.length !== Object.keys(session.participants).length)
            valueError('combat historical initiative roster is invalid');
        const byActor = new Map<string, Row>(), reconstructed: Row[] = [];
        for (const item of rows) {
            if (!exact(item, PROGRESS_KEYS))
                valueError('combat historical initiative progress is invalid');
            const id = item.actor_id, evidence = item.round_start_eligibility;
            if (!Object.hasOwn(session.participants, id) || byActor.has(id) || !exact(evidence, ELIGIBILITY_KEYS))
                valueError('combat historical initiative roster is invalid');
            byActor.set(id, item);
            if (!(integer(evidence.hp_current) && evidence.hp_current > 0 && Array.isArray(evidence.conditions) && eligible(evidence.hp_current, evidence.conditions))) {
                if (item.initiative !== null || item.status !== 'excluded_at_round_start')
                    valueError('combat historical excluded actor is invalid');
                validateSkip(session, item, true, historical);
                continue;
            }
            if (!['acted', 'skipped_ineligible'].includes(item.status))
                valueError('combat historical initiative progress is incomplete');
            validateSkip(session, item, true, historical);
            const reason = evidence.has_ready_firearm === true && (evidence.firearms_skill ?? 0) > 0 ? 'ready_firearm' : null, expected = { actor_id: id, dex: (evidence.dex ?? 0) + (reason ? 50 : 0), dex_reason: reason };
            if (!equal(item.initiative, expected))
                valueError('combat historical initiative entry is invalid');
            reconstructed.push(expected);
        }
        if (!equal(sorted(byActor.keys()), sorted(Object.keys(session.participants))))
            valueError('combat historical initiative roster omits a participant');
        reconstructed.sort((a, b) => order(a, b, id => byActor.get(id)!.round_start_eligibility.combat_skill ?? 0));
        if (!equal(reconstructed, historical.initiative_order))
            valueError('combat historical initiative order diverges from roster');
    }
    if (session.status === 'active' && session.outcome !== null)
        valueError('active combat cannot have an outcome');
    if (session.status === 'concluded' && (!VALID_OUTCOMES.has(session.outcome) || session.outcome === null || session.endedAtTurn === null || session.pendingAttack !== null))
        valueError('concluded combat state is incoherent');
    if (session.pendingAttack !== null) {
        const pending = session.pendingAttack, legacy = ['attack_command_id', 'actor_id', 'target_actor_id', 'declared_intent', 'resolution_hint', 'weapon_id', 'allowed_defenses'];
        const extras = ['rulebook_exception', 'on_success', 'victory_outcome', 'defeat_outcome'], usage = ['usage_id', 'object_id', 'usage'], original = Object.keys(pending);
        for (const key of extras)
            if (!Object.hasOwn(pending, key))
                pending[key] = null;
        const success = pending.on_success, successValid = success === null || exact(success, ['kind', 'outcome', 'rule_ref']) && success.kind === 'destroy_target' && VALID_OUTCOMES.has(success.outcome) && success.outcome !== null && typeof success.rule_ref === 'string' && success.rule_ref.trim();
        const outcomesValid = ['victory_outcome', 'defeat_outcome'].every(field => pending[field] === null || typeof pending[field] === 'string' && VALID_OUTCOMES.has(pending[field]));
        const defenses = pending.resolution_hint === 'firearm_attack' ? ['dive_for_cover', 'none'] : pending.resolution_hint === 'opposed_melee' ? ['dodge', 'fight_back'] : null;
        if (!equal(sorted(original), sorted(legacy)) && !equal(sorted(original), sorted([...legacy, ...extras])) && !equal(sorted(original), sorted([...legacy, ...extras, ...usage])) || !text(pending.attack_command_id) || !Object.hasOwn(session.participants, pending.actor_id) || !Object.hasOwn(session.participants, pending.target_actor_id) ||
            pending.actor_id === pending.target_actor_id || typeof pending.declared_intent !== 'string' || !pending.declared_intent.trim() || !equal(pending.allowed_defenses, defenses) || pending.rulebook_exception !== null && typeof pending.rulebook_exception !== 'string' || !successValid || !outcomesValid)
            valueError('combat pending attack contract is invalid');
        if (session.status !== 'active' || session.initiativeCursor >= session.currentInitiative.length || session.currentInitiative[session.initiativeCursor].actor_id !== pending.actor_id)
            valueError('combat pending attack is not at the initiative cursor');
    }
}
