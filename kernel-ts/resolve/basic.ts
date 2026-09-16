/** The fixed check executors. Every receipt and save goes through SettleContext. */
import { RpcError } from '../errors.js';
import { isJsonObject, sha256Text } from '../json.js';
import { CHARACTERISTICS, SkillResolver } from '../rules/skills.js';
import { array, clone, number, repr, row, string, truth, values, type Row } from '../read/values.js';
import { nowIso } from '../write/store.js';
import { SettleContext, type SettlementExecutor } from './context.js';
import { npcCheck } from './bindings.js';
import { socialDifficulty, psychologyCheckContract, psychologyPolicy } from './social.js';
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
    const canonical = resolver.resolveExplicit(label) || label;
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
export const executeCheck: SettlementExecutor = async (context, args, plan) => {
    const actor = string(args.investigator || context.actorId);
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
        data.combined_roll = context.arithmetic.combined(combined, number(check.roll), difficulty, string(args.combined_mode || 'any'));
        data.improvement_tick_eligible = false;
        data.push_eligible = false;
        data.success = truth(data.combined_roll.overall_success);
        data.passed = data.success;
        if (!data.success)
            data.outcome = data.level = data.achieved_level = 'failure';
    }
    for (const key of ['npc_id', 'social_adjudication_ref'])
        if (args[key] != null)
            data[key] = args[key];
    if (pushed) {
        const consequence = {
            summary: string(args.failure_consequence || '')
        };
        Object.assign(data, {
            method_changed: string(args.method_changed || ''),
            failure_consequence: consequence,
            announced_consequence: consequence,
            pushed_roll_protocol: {
                failure_consequence_source: 'keeper',
                keeper_foreshadowed_failure: true,
                player_confirmation_recorded: true
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
        visibility: string(args.visibility || 'public'),
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
        hints.push('pushed roll failed: the announced consequence is authoritative');
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
    const result = context.arithmetic.opposed(target, opponent, context.rng);
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
        bonus: 0,
        penalty: 0,
        visibility: 'public',
        kind: 'opposed_check',
        opposed_side: 'investigator',
        contest_winner: winner,
        check: {
            ...mine,
            investigator_id: context.actorId,
            skill: label,
            opposed_won: winner === 'investigator',
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
    const original = row(args.canonical_roll_receipt);
    const verdict = await context.arithmetic.pushPolicy(original.outcome, truth(original.pushed), original.skill);
    if (verdict)
        throw new RpcError('turn_state', `the last check cannot be pushed: ${verdict}`, {
            fix: 'let the failure stand and narrate its consequence, or spend Luck with action.luck',
            details: {
                source_receipt: args.original_check_decision_id ?? null
            }
        });
    const characteristic = Object.hasOwn(CHARACTERISTICS, string(original.skill || '').toUpperCase());
    return executeCheck(context, {
        skill: characteristic ? null : original.skill ?? null,
        characteristic: characteristic ? original.skill : null,
        target: args.target ?? original.target,
        difficulty: args.difficulty ?? original.difficulty,
        bonus: args.bonus ?? original.bonus,
        penalty: args.penalty ?? original.penalty,
        goal: original.goal ?? null,
        stakes: original.stakes ?? null,
        difficulty_basis: original.difficulty_basis ?? null,
        pushed: true,
        method_changed: args.method_changed ?? null,
        failure_consequence: args.failure_consequence ?? null,
        original_check_decision_id: args.original_check_decision_id ?? null,
        npc_id: original.npc_id ?? null,
        social_adjudication_ref: original.social_adjudication_ref ?? null
    }, plan);
};
export const executeLuckSpend: SettlementExecutor = async (context, args) => {
    const original = clone(row(args.canonical_roll_receipt));
    const points = args.points;
    const sheet = context.actor;
    const current = number(sheet.current_luck ?? row(sheet.characteristics).LUCK);
    let recomputed: Row;
    try {
        recomputed = context.arithmetic.spendLuck(original, points, current);
    }
    catch (error) {
        if ((error as Error).name !== 'ValueError')
            throw error;
        const reason = (error as Error).message;
        const fixes: Row = {
            insufficient_luck: `the investigator has ${current} Luck; spend at most that`,
            luck_may_only_alter_a_failed_roll: 'the last check passed; there is nothing to buy',
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
        luck_spent: points
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
        hints: [`Luck spent: no improvement tick for this check; the roll now reads ${recomputed.roll}`]
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
