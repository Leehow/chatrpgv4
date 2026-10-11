/** The fixed check executors. Every receipt and save goes through SettleContext. */
import { RpcError } from '../errors.js';
import {preparePush, drawPushRisk, pushSourceCheck} from '../mods/pushed-roll.js';
import { isJsonObject, sha256Text } from '../json.js';
import { CHARACTERISTICS, SkillResolver } from '../rules/skills.js';
import { array, clone, number, repr, row, string, truth, values, type Row } from '../read/values.js';
import { nowIso } from '../write/store.js';
import { SettleContext, type SettlementExecutor } from './context.js';
import { npcCheck } from './bindings.js';
import { socialDifficulty, psychologyCheckContract, psychologyPolicy } from './social.js';
/** Which row a group skill rolls, and the refusal when the card has not answered that yet (§52).
 *
 * A group skill is a choice before it is a number: `Pilot ( ___ )` is printed on the 1920s sheet
 * as a blank the investigator fills in, so its 1% is the cost of never filling it, not a piloting
 * ability. Letting that row answer a check is how a module's named `Pilot (Boat)` became a
 * threshold of 0 at hard while the same card's Swim 70 and Navigate 70 went untouched.
 *
 * Where a specialization the card does carry answers unambiguously, this resolves to it rather
 * than refusing; where nothing on the card answers, the refusal names what the card does have, so
 * the Keeper repairs the request instead of hearing a number it cannot use. A specialization the
 * card lacks keeps its own rulebook base -- an untrained specialization is still rollable, and it
 * is never the group row's value wearing the specialization's name. */
function groupSkill(resolver: SkillResolver, canonical: string): string {
    const declared = resolver.groupRow(canonical);
    if (!declared) {
        // A specialization the card does not print, on a card whose group row does carry a value:
        // that row is the one specialization this investigator took and never named, so it answers
        // here and the receipt says which row rolled. A group row still sitting at its base
        // chance carries nothing and answers nothing.
        const specialization = Object.hasOwn(resolver.sheetSkills, canonical) ? null : resolver.specialization(canonical);
        const rows = specialization ? resolver.groupRowsOnSheet(specialization.group) : null;
        return rows && rows.own && !rows.specializations.length ? rows.own[0] : canonical;
    }
    const [group] = declared, rows = resolver.groupRowsOnSheet(group);
    if (rows.specializations.length === 1)
        return rows.specializations[0][0];
    if (!rows.specializations.length && rows.own)
        return rows.own[0];
    const members = declared[1].specializations, listed = Array.isArray(members) ? members.map(string)
        : isJsonObject(members) ? Object.keys(members) : [];
    const carried = rows.specializations.map(([name]) => name);
    throw new RpcError('needs', `${repr(group)} is a group skill, not a check`, {
        fix: `Name the specialization this calls for -- details.needs.options lists the ones this investigator's card carries a value in, and details.group.specializations the ones ${repr(group)} declares. A specialization the card does not carry rolls its rulebook base of ${resolver.groupBase(group) ?? 'the group'}, which is a choice to make on purpose, not a value to fall back on. The card's printed ${repr(group)} row is a blank the investigator never filled in; it is not an ability. This is a request to repair, not fiction: do not narrate it and do not read it to the player.`,
        details: {
            needs: {
                field: 'skill',
                options: carried.length ? carried : resolver.sheetValues()
            },
            group: {
                name: group,
                specializations: listed,
                open: declared[1].open === true,
                base_chance: resolver.groupBase(group),
                carried_on_sheet: carried,
                sheet_row: Object.hasOwn(resolver.sheetSkills, group) ? resolver.sheetSkills[group] : null
            }
        }
    });
}
async function resolveTarget(context: SettleContext, args: Row): Promise<[
    string,
    number,
    string,
    string
]> {
    const actor = string(args.investigator || context.actorId);
    const sheet = context.sheetById(actor) || {};
    const npc = context.npcNode(actor);
    if (truth(args.characteristic)) {
        const label = string(args.characteristic).toUpperCase();
        if (!Object.hasOwn(CHARACTERISTICS, label))
            throw new RpcError('needs', `unknown characteristic ${repr(args.characteristic)}`, {
                details: {
                    needs: {
                        field: 'skill',
                        options: Object.keys(CHARACTERISTICS)
                    }
                }
            });
        if (args.target != null)
            return [label, number(args.target), npc ? 'npc' : 'explicit', 'characteristic_check'];
        return [label, (await SkillResolver.create(context.tables, sheet)).characteristicValue(label), 'sheet', 'characteristic_check'];
    }
    const label = string(args.skill || '').trim();
    if (!label)
        throw new RpcError('needs', 'the check names no skill', {
            details: {
                needs: {
                    field: 'skill',
                    options: []
                }
            }
        });
    if (args.target != null)
        return [label, number(args.target), npc ? 'npc' : Object.hasOwn(row(sheet.skills), label) ? 'sheet' : 'rulebook_base', 'skill_check'];
    const resolver = await SkillResolver.create(context.tables, sheet);
    const requested = resolver.resolveExplicit(label) || label;
    const canonical = npc ? requested : groupSkill(resolver, requested);
    let target: number;
    try {
        target = resolver.targetValue(canonical);
    }
    catch (error) {
        if ((error as Error).name !== 'KeyError')
            throw error;
        throw new RpcError('needs', `no target value for ${repr(label)}`, {
            details: {
                needs: {
                    field: 'skill',
                    options: resolver.optionsFor(label)
                }
            }
        });
    }
    return [canonical, target, Object.hasOwn(CHARACTERISTICS, canonical) || Object.hasOwn(row(sheet.skills), canonical) ? 'sheet' : 'rulebook_base', Object.hasOwn(CHARACTERISTICS, canonical) ? 'characteristic_check' : 'skill_check'];
}
/**
 * Whether a consequence sentence was already said to the player: it appears in the rendered text of
 * a delivered turn record (§223.1). The kernel keeps those records, so the receipt can say
 * `delivered_text` without a host attestation; a sentence it cannot find was stated on this call.
 */
function deliveredBefore(context: SettleContext, sentence: string): boolean {
    const needle = sentence.replace(/\s+/g, ' ').trim();
    if (!needle)
        return false;
    return array(context.snapshot.records).some(record => typeof record.rendered_text === 'string'
        && record.rendered_text.replace(/\s+/g, ' ').includes(needle));
}
export const executeCheck: SettlementExecutor = async (context, args, plan) => {
    const actor = string(args.investigator || context.actorId);
    // SL-71 (§11.5.9): a check whose actor is a person the table knows rather than an investigator on
    // the sheet is that person's own roll -- Keeper-side by default (no name, no number reaches the
    // player) unless the caller declares it public itself (a combat roll uses its own family and
    // visibility rules and never reaches this executor).
    const npcActing = context.npcNode(actor) !== null;
    const difficulty = string(args.difficulty || 'regular');
    const bonus = number(args.bonus);
    const penalty = number(args.penalty);
    const pushed = truth(args.pushed);
    const combined = args.combined_targets;
    let label: string;
    let target: number;
    let targetSource: string;
    let kind: string;
    if (Array.isArray(combined) && combined.length) {
        label = combined.map(value => string(value.label)).join(' / ');
        target = Math.max(...combined.map(value => number(value.value)));
        targetSource = 'sheet';
        kind = 'combined_skill_check';
    }
    else
        [label, target, targetSource, kind] = await resolveTarget(context, args);
    // Before the die, not after it: a request whose effective target the difficulty drives below the
    // die's minimum has no rollable outcome, so it never becomes a receipt, a failure, or stakes that
    // land. Refusing here also keeps `push_eligible` off it -- there is no settled check to push (§45).
    context.arithmetic.assertRollable(target, difficulty, label, pushed);
    const check = context.arithmetic.check(target, difficulty, bonus, penalty, context.rng);
    const data: Row = {
        ...check,
        investigator_id: actor,
        skill: label,
        target_source: targetSource,
        pushed,
        goal: string(args.goal || ''),
        stakes: truth(args.stakes) ? args.stakes : {},
        difficulty_basis: string(args.difficulty_basis || 'keeper'),
        kind,
        decision: plan.decision_ref ?? null
    };
    data.push_eligible = kind === 'skill_check' && await context.arithmetic.skillPushable(label) || kind === 'characteristic_check';
    if (Array.isArray(combined) && combined.length) {
        // §223.4: one die against several skills is still a skill roll (p.55); the book removes the
        // push only from combat rolls, so a combined roll is pushable unless every named skill is one.
        // The whole receipt has no tick of its own -- its label is not a skill -- but each named skill
        // the die succeeded against ticks under the ordinary rules (`recordSkillTicks`).
        data.combined_roll = context.arithmetic.combined(combined, number(check.roll), difficulty, string(args.combined_mode || 'any'));
        data.combined_mode = string(args.combined_mode || 'any');
        data.combined_targets = combined.map(value => ({label: string(value.label), value: number(value.value)}));
        data.improvement_tick_eligible = false;
        const pushable = await Promise.all(combined.map(value => context.arithmetic.skillPushable(string(value.label))));
        data.push_eligible = pushable.every(Boolean);
        data.success = truth(data.combined_roll.overall_success);
        data.passed = data.success;
        if (!data.success)
            data.outcome = data.level = data.achieved_level = 'failure';
    }
    for (const key of ['npc_id', 'social_adjudication_ref'])
        if (args[key] != null)
            data[key] = args[key];
    if (pushed) {
        // §223.1 (pp.84-86): foreshadowing the consequence is the Keeper's option, not a precondition.
        // The receipt says where the consequence came from instead of asserting it was announced:
        // a sentence already delivered at this table, one stated on this call, or none -- a failed
        // push then gives the Keeper free rein over the outcome (p.86).
        const summary = string(args.failure_consequence || '').trim();
        const foreshadowed = summary !== '' && deliveredBefore(context, summary);
        const consequence = {
            summary,
            source: summary === '' ? 'keeper_free_rein' : foreshadowed ? 'delivered_text' : 'keeper_stated'
        };
        Object.assign(data, {
            ...(args.pushed_risk ? {pushed_risk: {...args.pushed_risk, activated: !data.success}} : {}),
            method_changed: string(args.method_changed || ''),
            failure_consequence: consequence,
            announced_consequence: consequence,
            pushed_roll_protocol: {
                failure_consequence_source: consequence.source,
                keeper_foreshadowed_failure: foreshadowed,
                player_declared_push: true
            },
            original_check: {
                decision_id: args.original_check_decision_id ?? null,
                roll_id: args.original_check_decision_id ?? null
            }
        });
    }
    data.roll_id = context.addRoll({
        actor,
        skill: label,
        target: data.target,
        difficulty,
        threshold: data.threshold,
        roll: data.roll,
        level: data.level,
        passed: data.passed,
        bonus: data.bonus,
        penalty: data.penalty,
        ...(typeof args.modifier_reason === 'string' && args.modifier_reason ? { modifier_reason: args.modifier_reason } : {}),
        visibility: string(args.visibility || (npcActing ? 'keeper' : 'public')),
        pushed,
        kind,
        source_receipt: pushed ? args.original_check_decision_id : null,
        check: data
    });
    const hints: string[] = [];
    if (targetSource === 'rulebook_base')
        hints.push(`${label} is not listed on the investigator sheet; used the canonical rulebook base chance ${target}%`);
    if (data.outcome === 'critical')
        hints.push('critical success: realize a source-bound benefit in the fiction');
    if (data.outcome === 'fumble')
        hints.push('fumble: realize a source-bound cost and its causal complication');
    if (pushed && !data.success)
        hints.push(row(data.failure_consequence).source === 'keeper_free_rein'
            ? 'pushed roll failed: no consequence was recorded, so the Keeper has free rein over the outcome (p.86), which may include the goal achieved at a cost'
            : 'pushed roll failed: the recorded consequence is authoritative; the goal may still be achieved at that cost (p.86)');
    return {
        data,
        warnings: [],
        hints
    };
};
export const executeOpposed: SettlementExecutor = async (context, args) => {
    const [label, target, targetSource] = await resolveTarget(context, args);
    const opponent = number(args.opponent_value);
    const opponentLabel = string(args.opponent_label || 'opponent');
    const bonus = number(args.bonus);
    const penalty = number(args.penalty);
    const result = context.arithmetic.opposed(target, opponent, context.rng, bonus, penalty);
    const mine = result.investigator_roll;
    const theirs = result.opponent_roll;
    const winner = result.winner;
    const parts = opponentLabel.split(':');
    const opponentId = parts.length === 4 ? parts[1] : opponentLabel;
    const authored = npcCheck(context, opponentLabel);
    const opponentSkill = authored ? authored[0].slice(authored[0].indexOf(' ') + 1) : label;
    const myId = context.addRoll({
        actor: context.actorId,
        skill: label,
        target: mine.target,
        difficulty: 'regular',
        threshold: mine.threshold,
        roll: mine.roll,
        level: mine.level,
        passed: mine.passed,
        bonus: number(mine.bonus),
        penalty: number(mine.penalty),
        visibility: 'public',
        kind: 'opposed_check',
        opposed_side: 'investigator',
        contest_winner: winner,
        check: {
            ...mine,
            investigator_id: context.actorId,
            skill: label,
            opposed_won: winner === 'investigator',
            // §223.3: Luck may alter this side of the contest later; the opponent's level and target
            // travel on the receipt so the bought roll can be judged against them. An opposed roll is
            // not pushed through this executor (the contest, not the die, would have to be repeated).
            opponent_level: theirs.outcome,
            opponent_target: theirs.target,
            push_eligible: false,
            kind: 'opposed_check'
        }
    });
    const theirId = context.addRoll({
        actor: opponentId,
        skill: opponentSkill,
        target: theirs.target,
        difficulty: 'regular',
        threshold: theirs.threshold,
        roll: theirs.roll,
        level: theirs.level,
        passed: theirs.passed,
        bonus: 0,
        penalty: 0,
        visibility: string(args.opponent_visibility || 'public'),
        kind: 'opposed_check',
        opposed_side: 'opponent',
        contest_winner: winner,
        check: {
            ...theirs,
            actor: opponentId,
            skill: opponentSkill,
            kind: 'opposed_check'
        }
    });
    const data = {
        investigator_id: context.actorId,
        skill: label,
        target_source: targetSource,
        investigator_roll: mine,
        opponent_id: opponentId,
        opponent_skill: opponentSkill,
        opponent_label: opponentLabel,
        opponent_roll: theirs,
        winner,
        investigator_roll_id: myId,
        opponent_roll_id: theirId,
        outcome: winner,
        kind: 'opposed_check'
    };
    return {
        data,
        warnings: [],
        hints: winner === 'none' ? ['both sides failed: the situation stalls or worsens — narrate movement, not a freeze'] : []
    };
};
export const executePush: SettlementExecutor = async (context, args, plan) => {
    const {provider, source} = await preparePush(context);
    const original = pushSourceCheck(source);
    context.arithmetic.assertRollable(number(original.target), string(original.difficulty || 'regular'), string(original.skill), true);
    const risk = drawPushRisk(context, provider);
    const characteristic = Object.hasOwn(CHARACTERISTICS, string(original.skill || '').toUpperCase());
    // §223.4: a combined check is pushed as the same one die against the same named skills.
    const combinedTargets = array(original.combined_targets).filter(isJsonObject);
    const combined = combinedTargets.length ? combinedTargets : array(row(original.combined_roll).targets).filter(isJsonObject)
        .map(target => ({label: string(target.label), value: number(target.value)}));
    return executeCheck(context, {
        skill: characteristic || combined.length ? null : original.skill ?? null,
        characteristic: characteristic ? original.skill : null,
        ...(combined.length ? {combined_targets: combined, combined_mode: original.combined_mode ?? row(original.combined_roll).comparison_mode ?? 'any'} : {}),
        target: original.target,
        difficulty: original.difficulty,
        bonus: original.bonus,
        penalty: original.penalty,
        goal: original.goal ?? null,
        stakes: original.stakes ?? null,
        difficulty_basis: original.difficulty_basis ?? null,
        pushed: true,
        pushed_risk: risk,
        method_changed: args.method_changed ?? null,
        failure_consequence: args.failure_consequence ?? null,
        original_check_decision_id: source.id,
        npc_id: original.npc_id ?? null,
        social_adjudication_ref: original.social_adjudication_ref ?? null
    }, plan);
};
export const executeLuckSpend: SettlementExecutor = async (context, args) => {
    const original = clone(row(args.canonical_roll_receipt));
    const points = args.points;
    const sheet = context.actor;
    const current = number(sheet.current_luck ?? row(sheet.characteristics).LUCK);
    // §223.4: a combined check's receipt carries the overall verdict in `outcome`; the canonical
    // percentile fields of its one die (against the highest named skill) are what Luck alters, and
    // the die is then compared with every named skill again.
    const combinedTargets = string(original.kind || '') === 'combined_skill_check'
        ? array(original.combined_targets).filter(isJsonObject).map(target => ({label: string(target.label), value: number(target.value)})) : [];
    const canonicalOriginal = combinedTargets.length
        ? {...original, ...context.arithmetic.resolve(number(original.roll), number(original.base_target ?? original.target), string(original.required_level || original.difficulty || 'regular'))}
        : original;
    let recomputed: Row;
    try {
        recomputed = context.arithmetic.spendLuck(canonicalOriginal, points, current);
    }
    catch (error) {
        if ((error as Error).name !== 'ValueError')
            throw error;
        const reason = (error as Error).message;
        const fixes: Row = {
            insufficient_luck: `the investigator has ${current} Luck; spend at most that`,
            criticals_fumbles_malfunctions_cannot_be_bought_off: 'a fumble stands; spend less or accept it',
            luck_may_not_alter_a_pushed_roll: 'a pushed roll cannot be altered with Luck'
        };
        throw new RpcError('invalid_params', `luck spend refused: ${reason}`, {
            fix: fixes[reason] || 'check action.luck against luck.json constraints',
            details: {
                reason,
                current_luck: current,
                points
            }
        });
    }
    if (combinedTargets.length) {
        const mode = string(original.combined_mode || row(original.combined_roll).comparison_mode || 'any');
        recomputed.combined_roll = context.arithmetic.combined(combinedTargets, number(recomputed.roll), string(recomputed.required_level || 'regular'), mode);
        recomputed.success = recomputed.passed = truth(recomputed.combined_roll.overall_success);
        if (!recomputed.success)
            recomputed.outcome = recomputed.level = recomputed.achieved_level = 'failure';
        recomputed.improvement_tick_eligible = false;
    }
    // §223.3: on an opposed check the bought level is judged against the opponent's recorded level,
    // the way the book's example buys a Dodge up to Extreme to beat the Dark Young's attack.
    if (string(original.kind || '') === 'opposed_check' && original.opponent_level != null) {
        const winner = context.arithmetic.contestWinner(string(recomputed.outcome), number(recomputed.target ?? original.target),
            string(original.opponent_level), number(original.opponent_target ?? 0));
        Object.assign(recomputed, {opposed_won: winner === 'investigator', contest_winner: winner});
    }
    const after = current - points;
    sheet.current_luck = after;
    await context.writeSheet(sheet);
    const source = string(args.original_check_decision_id || args.source_roll_id || '');
    context.addDelta('luck', context.actorId, current, after, {
        source_receipt: source || null
    });
    context.markReceiptContinued(source, 'luck');
    const bought = context.addRoll({
        actor: context.actorId,
        skill: string(original.skill || 'check'),
        target: number(recomputed.target ?? original.target),
        difficulty: string(recomputed.difficulty ?? original.difficulty ?? 'regular'),
        threshold: number(recomputed.threshold ?? recomputed.target ?? original.target),
        roll: number(recomputed.roll),
        level: string(recomputed.outcome || recomputed.level || ''),
        passed: truth(recomputed.passed),
        visibility: string(original.visibility || 'public'),
        kind: 'luck_bought',
        source_receipt: source || null,
        skill_label: original.skill_label,
        luck_spent: points,
        ...(recomputed.contest_winner != null ? {contest_winner: recomputed.contest_winner, opposed_side: 'investigator'} : {})
    });
    return {
        data: {
            ...recomputed,
            investigator_id: context.actorId,
            points,
            luck_before: current,
            luck_after: after,
            source_roll_id: args.source_roll_id ?? null,
            original_check_decision_id: source,
            bought_roll_id: bought,
            kind: 'luck_spend'
        },
        warnings: [],
        hints: [`Luck spent: no improvement tick for this check; the roll now reads ${recomputed.roll} (${string(recomputed.outcome)})`,
            ...(recomputed.contest_winner != null ? [`opposed check re-judged with the bought level: winner ${string(recomputed.contest_winner)}`] : [])]
    };
};
export const executeSocial: SettlementExecutor = async (context, args) => {
    const motive = row(args.motive);
    const leverage = array(args.leverage);
    const defense = args.npc_defense_value ?? null;
    const request = {
        approach: args.approach ?? null,
        motive_direction: motive.direction || 'neutral',
        motive_intensity: motive.intensity ?? 0,
        described_action: args.described_action || '',
        goal: args.goal_summary || '',
        motive_evidence: [...array(motive.evidence_refs)],
        bonus: 0,
        penalty: 0,
        leverage_one_level: Boolean(leverage.length)
    };
    let policy: Row;
    try {
        policy = socialDifficulty(request, defense);
    }
    catch (error) {
        if ((error as Error).name !== 'ValueError')
            throw error;
        throw new RpcError('needs', (error as Error).message, {
            details: {
                needs: {
                    field: 'skill',
                    options: ['Charm', 'Fast Talk', 'Intimidate', 'Persuade']
                }
            }
        });
    }
    const key = sha256Text([string(args.npc_id), string(args.conversation_window_id), string(args.commitment_id)].join('\0')).slice(0, 16);
    const data = {
        schema_version: 2,
        investigator_id: context.actorId,
        npc_id: args.npc_id,
        conversation_window_id: args.conversation_window_id,
        commitment_id: args.commitment_id,
        approach: args.approach ?? null,
        approach_skill: policy.approach_skill,
        goal_summary: request.goal,
        goal_key: key,
        feasibility: policy.feasibility,
        defense_value: defense,
        defense_source: defense !== null ? 'authored' : 'unknown',
        base_difficulty: policy.base_difficulty,
        motive: {
            direction: request.motive_direction,
            intensity: request.motive_intensity,
            evidence_refs: request.motive_evidence
        },
        motive_delta: policy.motive_adjustment,
        leverage: [...leverage],
        leverage_delta: policy.strategic_adjustment,
        final_difficulty: policy.final_difficulty,
        bonus_dice: policy.bonus_dice,
        penalty_dice: policy.penalty_dice,
        feasibility_refs: [...array(args.feasibility_refs)],
        resolution: 'new'
    };
    return {
        data,
        warnings: defense === null ? [`no authored social defense for npc ${repr(args.npc_id)}; base difficulty defaults to regular`] : [],
        hints: []
    };
};
async function observationsDocument(context: SettleContext): Promise<Row> {
    const document = row(await context.readSave('psychology-observations.json'));
    if (!Object.hasOwn(document, 'schema_version'))
        document.schema_version = 2;
    if (!isJsonObject(document.observations))
        document.observations = {};
    if (!isJsonObject(document.realizations))
        document.realizations = {};
    return document;
}
export const executePsychologyObserve: SettlementExecutor = async (context, args) => {
    const contract = psychologyCheckContract({
        observer_skill: args.observer_skill ?? null,
        target_opposing_social: args.target_opposing_social ?? null,
        question: string(args.question || ''),
        observable_facts: [...array(args.observable_fact_refs)]
    });
    const check = context.arithmetic.check(number(contract.observer_skill), contract.difficulty, 0, 0, context.rng);
    const policy = psychologyPolicy(check);
    const key = [args.observer_scope, args.npc_id, args.conversation_window_id, args.observation_revision].map(string).join('\0');
    const insight = `psych-insight-${sha256Text(key).slice(0, 12)}`;
    const roll = context.addRoll({
        actor: context.actorId,
        skill: 'Psychology',
        target: check.target,
        difficulty: contract.difficulty,
        threshold: check.threshold,
        roll: check.roll,
        level: check.level,
        passed: check.passed,
        bonus: 0,
        penalty: 0,
        // The player asked for this read, so they know a check happened; §16.5's `concealed` tier
        // lets the card say so while the die stays with the keeper. `keeper` here would have drawn
        // nothing at all and made a declared Psychology attempt look like plain narration.
        visibility: 'concealed',
        kind: 'psychology_observe',
        check: {
            ...check,
            investigator_id: context.actorId,
            skill: 'Psychology',
            kind: 'psychology_observe'
        }
    });
    const record = {
        insight_id: insight,
        window_key: key,
        investigator_id: context.actorId,
        observer_scope: args.observer_scope,
        npc_id: args.npc_id,
        conversation_window_id: args.conversation_window_id,
        observation_revision: args.observation_revision,
        question: string(args.question || ''),
        observable_fact_refs: [...array(args.observable_fact_refs)],
        observer_skill: contract.observer_skill,
        observer_skill_source: contract.observer_skill_source,
        difficulty: contract.difficulty,
        roll_id: roll,
        outcome: check.outcome,
        inference_depth: policy.inference_depth,
        misread_policy: policy.misread_policy,
        created_at: nowIso()
    };
    const document = await observationsDocument(context);
    document.observations[key] = record;
    await context.writeSave('psychology-observations.json', document);
    const data: Row = {
        resolution: 'settled',
        ...record
    };
    delete data.created_at;
    return {
        data,
        warnings: [],
        hints: ['this window is locked until the conversation moves on; do not reroll Psychology on it']
    };
};
export const executePsychologyRealize: SettlementExecutor = async (context, args) => {
    const insight = string(args.insight_id || '');
    const visible = string(args.visible_observation || '').trim();
    const document = await observationsDocument(context);
    const matching = values(document.observations).find(value => isJsonObject(value) && value.insight_id === insight);
    if (!insight || !matching)
        throw new RpcError('turn_state', 'no settled Psychology observation to realize for this NPC', {
            fix: 'observe first (decision psychology:observe-concealed), then realize'
        });
    if (!visible)
        throw new RpcError('needs', 'the realization needs the behavior the player may see', {
            fix: 'put the player-safe observation in action.method',
            details: {
                needs: {
                    field: 'method',
                    options: []
                }
            }
        });
    let policy: Row;
    try {
        policy = psychologyPolicy({
            inference_ceiling: args.inference_ceiling || matching.inference_depth,
            external_behavior: visible
        });
    }
    catch (error) {
        if ((error as Error).name !== 'ValueError')
            throw error;
        throw new RpcError('invalid_params', (error as Error).message);
    }
    const data = {
        insight_id: insight,
        npc_id: matching.npc_id ?? null,
        conversation_window_id: matching.conversation_window_id ?? null,
        player_projection: policy.player_projection,
        concealed_result: policy.concealed_result,
        bound_to_observe: matching.roll_id ?? null,
        realized_at: nowIso()
    };
    document.realizations[insight] = data;
    await context.writeSave('psychology-observations.json', document);
    return {
        data,
        warnings: [],
        hints: ['only player_projection.external_behavior may reach the player']
    };
};
export const BASIC_EXECUTORS: Readonly<Record<string, SettlementExecutor>> = Object.freeze({
    check: executeCheck,
    opposed: executeOpposed,
    push_policy: executePush,
    luck_spend: executeLuckSpend,
    social_difficulty: executeSocial,
    psychology_check_contract: executePsychologyObserve,
    psychology_policy: executePsychologyRealize,
});
