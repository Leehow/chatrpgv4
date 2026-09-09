/** Frozen development inputs and arithmetic, using the existing ending seed contract. */
import { PythonRandom } from '../random.js';
import { jsonDigest, sha256Text } from '../json.js';
import { RuleTables } from '../rules/tables.js';
import { rollExpression, valueError } from '../resolve/arithmetic.js';
import { clone, entries, integer, number, repr, row, string, truth, type Row } from '../read/values.js';
export const ENDING_KINDS = ['conclusion', 'tpk', 'retreat', 'cliffhanger'];
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const get = (value: Row, key: string, fallback: any): any => Object.hasOwn(value, key) ? value[key] : fallback;
const int = (value: any): number => Math.trunc(number(value));
export function endingIdForEvent(event: Row): string {
    if (typeof event.ending_id === 'string' && event.ending_id)
        return event.ending_id;
    return 'ending-' + jsonDigest({
        decision_id: event.decision_id ?? null,
        scene_id: event.scene_id ?? null,
        kind: event.kind ?? null
    }).slice(0, 20);
}
export function checkedEndingId(id: any): string {
    const value = string(id);
    if (!SAFE_ID.test(value))
        valueError('ending_id is not a safe persisted identity');
    return value;
}
export function checkedInvestigatorId(id: any): string {
    const value = string(id);
    if (!SAFE_ID.test(value))
        valueError('investigator_id is not a safe persisted identity');
    return value;
}
export function endingEventId(id: string): string {
    return 'ending-event-' + sha256Text(checkedEndingId(id)).slice(0, 20);
}
export function sanityBaseline(sheet: Row): Row {
    const current = int(sheet.current_san != null ? sheet.current_san : row(sheet.derived).SAN ?? 0);
    const maximum = sheet.max_san == null ? 99 - int(truth(sheet.cm_value) ? sheet.cm_value : 0) : int(sheet.max_san);
    return {
        source: 'party_sheet',
        current,
        max: Math.max(current, maximum)
    };
}
export async function tickedSkillBaseline(tables: RuleTables, skills: Row, skill: string): Promise<number> {
    if (Object.hasOwn(skills, skill))
        return int(truth(skills[skill]) ? skills[skill] : 0);
    const base = row((await tables.skillsTable())[skill]).base_chance;
    if (integer(base))
        return int(base);
    return valueError(`development tick references skill missing from both the sheet and the rulebook catalog: ${repr(skill)}`);
}
function skippedLuckRecovery(luck: number, gate: Row): Row {
    return {
        skipped: true,
        reason: 'optional_rule_disabled',
        option_id: string(gate.option_id),
        decided_by: string(gate.decided_by),
        layer: string(gate.layer),
        gained: 0,
        luck_before: luck,
        luck_after: luck,
        rule_ref: 'core.optional.luck_recovery'
    };
}
export function recoverLuck(current: number, rng: PythonRandom): Row {
    const roll = rng.randint(1, 100);
    const success = roll > current;
    const gain = success ? rng.randint(1, 10) : 0;
    const after = Math.min(99, current + gain);
    return {
        roll,
        success,
        gained: success ? after - current : 0,
        luck_before: current,
        luck_after: after,
        rule_ref: 'core.optional.luck_recovery'
    };
}
export async function deterministicDevelopmentPlan(tables: RuleTables, options: {
    skills: Row;
    luck: number;
    sanity: Row;
    seedMaterial: string;
    scenarioRewardExpr: string | null;
    luckRecoveryGate?: Row | null;
}): Promise<Row> {
    const rng = new PythonRandom(options.seedMaterial);
    const rule = row(await tables.load('development'));
    const improvement = row(rule.improvement_roll);
    const alwaysAbove = int(get(improvement, 'always_improves_above', 95));
    const threshold = int(get(improvement, 'san_reward_threshold', get(improvement, 'cap_for_san_reward', 90)));
    const sanityExpr = string(get(row(rule.sanity_reward), 'reward', '2D6'));
    const checks: Row[] = [];
    let earnsSan = false;
    for (const [skill, current] of entries(options.skills)) {
        const checkRoll = rng.randint(1, 100);
        const improved = checkRoll > current || checkRoll > alwaysAbove;
        const gain = improved ? rng.randint(1, 10) : null;
        const after = current + (gain || 0);
        earnsSan = earnsSan || improved && after >= threshold;
        checks.push({
            skill,
            check_roll: checkRoll,
            gain,
            value_before: current,
            planned_value_after: after,
            improved
        });
    }
    const luckRecovery = options.luckRecoveryGate != null ? skippedLuckRecovery(options.luck, options.luckRecoveryGate) : recoverLuck(options.luck, rng);
    const developmentReward = earnsSan ? rollExpression(sanityExpr, rng) : null;
    const scenarioReward = typeof options.scenarioRewardExpr === 'string' && options.scenarioRewardExpr ? rollExpression(options.scenarioRewardExpr, rng) : null;
    let plannedSan = int(options.sanity.current);
    const sanMax = int(options.sanity.max);
    const developmentDelta = Math.min(developmentReward ? int(developmentReward.total) : 0, sanMax - plannedSan);
    plannedSan += developmentDelta;
    const scenarioDelta = Math.min(scenarioReward ? int(scenarioReward.total) : 0, sanMax - plannedSan);
    const plan: Row = {
        schema_version: 2,
        improvement_checks: checks,
        luck_recovery: luckRecovery,
        development_san_reward: developmentReward,
        scenario_san_reward: scenarioReward,
        development_san_planned_delta: developmentDelta,
        scenario_san_planned_delta: scenarioDelta
    };
    plan.plan_sha256 = jsonDigest(plan);
    return plan;
}
export function finishInputSnapshot(owned: Row[], frozenSkills: Row, sheet: Row, investigatorId: string, endingId: string, plan: Row): Row {
    const luck = int(sheet.current_luck != null ? sheet.current_luck : get(row(sheet.characteristics), 'LUCK', 50));
    const snapshot: Row = {
        schema_version: 2,
        skills_checked: [...new Set(owned.map(value => string(value.skill)))],
        check_events: clone(owned),
        input_tokens: owned.map(value => value.event_token),
        claim_owner: {
            campaign_id: string(sheet.campaign_id || ''),
            ending_id: endingId,
            investigator_id: investigatorId
        },
        mechanical_baseline: {
            skills: frozenSkills,
            luck,
            sanity: sanityBaseline(sheet)
        },
        deterministic_plan: plan
    };
    snapshot.input_sha256 = jsonDigest(snapshot);
    return snapshot;
}
