/** Ending documents use the same campaign save port as every resolve family. */
import type { CampaignWritePort } from '../transactions.js';
import { isJsonObject, jsonDigest, orderedObject, compareUnicode } from '../json.js';
import { RuleTables } from '../rules/tables.js';
import { array, clone, entries, equal, number, row, string, truth, type Row } from '../read/values.js';
import { valueError } from '../resolve/arithmetic.js';
import { checkedEndingId, checkedInvestigatorId, deterministicDevelopmentPlan, endingEventId, endingIdForEvent, finishInputSnapshot, sanityBaseline, tickedSkillBaseline } from './plan.js';
export const endingCapsuleName = (id: string): string => `development-settlements/endings/${checkedEndingId(id)}/capsule.json`;
export const CLOCK_SAVE_PATHS = ['save/development-state','save/development-settlements'] as const;
export const rebaseClock = (state:Row,_delta:number):Row=>clone(state);
export function endingSettlementName(ending: string, investigator: string): string {
    checkedInvestigatorId(investigator);
    return `development-settlements/endings/${checkedEndingId(ending)}/${investigator}.json`;
}
export async function readDevelopmentState(campaign: CampaignWritePort, investigator: string): Promise<Row> {
    const state = clone(row(await campaign.readSave(`development-state/${investigator}.json`)));
    if (!Object.hasOwn(state, 'investigator_id'))
        state.investigator_id = investigator;
    if (!isJsonObject(state.ticks))
        state.ticks = {};
    if (!isJsonObject(state.claimed))
        state.claimed = {};
    return state;
}
export async function unclaimedTicks(campaign: CampaignWritePort, investigator: string): Promise<Row[]> {
    const state = await readDevelopmentState(campaign, investigator);
    return entries(state.ticks).filter(([token]) => !Object.hasOwn(state.claimed, token)).map(([, value]) => clone(value));
}
export async function loadEndingCapsule(campaign: CampaignWritePort, id: string): Promise<Row | null> {
    const value = await campaign.readSave(endingCapsuleName(id));
    return isJsonObject(value) ? clone(value) : null;
}
export async function listEndings(campaign: CampaignWritePort): Promise<Row[]> {
    const capsules: Row[] = [];
    for (const name of await campaign.saveDirectories('development-settlements/endings')) {
        const capsule = await loadEndingCapsule(campaign, name);
        if (capsule)
            capsules.push(capsule);
    }
    return capsules.sort((a, b) => compareUnicode(string(a.captured_at || ''), string(b.captured_at || '')));
}
export async function pendingSettlements(campaign: CampaignWritePort): Promise<Array<[
    string,
    string
]>> {
    const pending: Array<[
        string,
        string
    ]> = [];
    for (const capsule of await listEndings(campaign)) {
        const ending = string(capsule.ending_id || '');
        for (const investigator of array(capsule.investigator_ids)) {
            if (!await campaign.saveExists(endingSettlementName(ending, string(investigator))))
                pending.push([ending, string(investigator)]);
        }
    }
    return pending;
}
export async function capsuleForCampaignEnding(campaign: CampaignWritePort, turn: number): Promise<Row | null> {
    return (await listEndings(campaign)).reverse().find(capsule => equal(capsule.campaign_ending_turn, turn) || string(capsule.decision_id || '').startsWith(`t${turn}-c`)) || null;
}
export async function buildEndingCapsule(tables: RuleTables, campaign: CampaignWritePort, record: Row, sheets: Row, options: {
    luckRecoveryGate: Row | null;
    capturedAt: string;
}): Promise<Row> {
    const event = clone(record);
    event.ending_id = endingIdForEvent(event);
    if (!Object.hasOwn(event, 'event_id'))
        event.event_id = endingEventId(event.ending_id);
    const investigators = array(event.investigator_ids).map(string);
    const identity = orderedObject(investigators.map(id => [id, {
            algorithm: 'python-random-seed-v1',
            seed_material: `${event.ending_id}:${id}:development.settle`
        }]));
    const inputs: Array<[
        string,
        Row
    ]> = [];
    for (const id of investigators) {
        const sheet = sheets[id];
        const owned = await unclaimedTicks(campaign, id);
        const skills = [...new Set(owned.map(value => string(value.skill)))];
        const frozenSkills = orderedObject(await Promise.all(skills.map(async (skill) => [skill, await tickedSkillBaseline(tables, row(sheet.skills), skill)] as [
            string,
            number
        ])));
        const luck = Math.trunc(number(sheet.current_luck != null ? sheet.current_luck : row(sheet.characteristics).LUCK ?? 50));
        const plan = await deterministicDevelopmentPlan(tables, {
            skills: frozenSkills,
            luck,
            sanity: sanityBaseline(sheet),
            seedMaterial: string(row(identity[id]).seed_material),
            scenarioRewardExpr: event.scenario_san_reward_expr ?? null,
            luckRecoveryGate: options.luckRecoveryGate
        });
        inputs.push([id, finishInputSnapshot(owned, frozenSkills, sheet, id, event.ending_id, plan)]);
    }
    const capsule: Row = {
        schema_version: 2,
        capsule_type: 'ending_settlement',
        ending_id: event.ending_id,
        event_id: event.event_id,
        scene_id: event.scene_id ?? null,
        kind: event.kind ?? null,
        summary: event.summary ?? null,
        decision_id: event.decision_id ?? null,
        investigator_ids: investigators,
        scenario_san_reward_expr: event.scenario_san_reward_expr ?? null,
        development_inputs: orderedObject(inputs),
        rng_identity: identity,
        captured_at: options.capturedAt
    };
    if (Object.hasOwn(event, 'campaign_ending_turn'))
        capsule.campaign_ending_turn = event.campaign_ending_turn;
    capsule.capsule_sha256 = jsonDigest(capsule);
    return capsule;
}
export function persistEndingCapsule(campaign: CampaignWritePort, capsule: Row): Promise<void> {
    return campaign.writeSave(endingCapsuleName(capsule.ending_id), capsule);
}
export async function runDevelopmentPhase(tables: RuleTables, campaign: CampaignWritePort, investigator: string, sheet: Row, capsule: Row): Promise<Row> {
    const ending = string(capsule.ending_id);
    const receiptName = endingSettlementName(ending, investigator);
    if (await campaign.saveExists(receiptName)) {
        const stored = clone(await campaign.readSave(receiptName)) as Row;
        stored.replayed = true;
        return stored;
    }
    const input = row(capsule.development_inputs)[investigator];
    if (!isJsonObject(input))
        valueError(`ending ${ending} froze no development input for ${investigator}`);
    if (!Object.hasOwn(sheet, 'skills'))
        sheet.skills = {};
    const skills = sheet.skills;
    const baseline = input.mechanical_baseline as Row;
    const plan = input.deterministic_plan as Row;
    const checks: Row[] = [];
    const improvedSkills: Row[] = [];
    for (const frozen of array(plan.improvement_checks)) {
        const skill = string(frozen.skill);
        const current = await tickedSkillBaseline(tables, skills, skill);
        const gain = Math.trunc(number(frozen.gain));
        const after = truth(frozen.improved) ? current + gain : current;
        if (truth(frozen.improved))
            skills[skill] = after;
        const value = {
            skill,
            check_roll: Math.trunc(number(frozen.check_roll)),
            gain: truth(frozen.improved) ? Math.trunc(number(frozen.gain)) : null,
            value_before: Math.trunc(number(frozen.value_before)),
            planned_value_after: Math.trunc(number(frozen.planned_value_after)),
            current_value_before_apply: current,
            applied_delta: gain,
            value_after: after,
            improved: truth(frozen.improved),
            merge_policy: 'additive_monotonic'
        };
        checks.push(clone(value));
        if (truth(frozen.improved))
            improvedSkills.push(value);
    }
    const luckPlan = clone(plan.luck_recovery);
    const currentLuck = Math.trunc(number(sheet.current_luck != null ? sheet.current_luck : baseline.luck));
    const plannedGain = Math.trunc(number(luckPlan.gained));
    const luckAfter = Math.min(99, currentLuck + plannedGain);
    if (!truth(luckPlan.skipped))
        sheet.current_luck = luckAfter;
    const luckRecovery = {
        ...luckPlan,
        planned_luck_before: Math.trunc(number(baseline.luck)),
        planned_luck_after: Math.trunc(number(luckPlan.luck_after)),
        planned_gained: plannedGain,
        current_luck_before_apply: currentLuck,
        gained: luckAfter - currentLuck,
        luck_after: luckAfter,
        applied_delta: luckAfter - currentLuck,
        merge_policy: 'additive_monotonic_capped_99'
    };
    const sanBefore = Math.trunc(number(sheet.current_san != null ? sheet.current_san : baseline.sanity.current));
    const sanMax = Math.trunc(number(baseline.sanity.max));
    const sanGain = Math.trunc(number(plan.development_san_planned_delta)) + Math.trunc(number(plan.scenario_san_planned_delta));
    const sanAfter = sanGain > 0 ? Math.min(sanMax, sanBefore + sanGain) : sanBefore;
    if (sanAfter !== sanBefore)
        sheet.current_san = sanAfter;
    const state = await readDevelopmentState(campaign, investigator);
    for (const token of array(input.input_tokens))
        state.claimed[string(token)] = ending;
    await campaign.writeSave(`development-state/${investigator}.json`, state);
    const result = {
        schema_version: 1,
        status: 'PASS',
        kind: 'development.settle',
        ending_id: ending,
        investigator_id: investigator,
        skills_checked: [...array(input.skills_checked)],
        improvement_checks: checks,
        skills_improved: improvedSkills,
        san_reward_roll: plan.development_san_reward ?? null,
        san_reward_planned_delta: Math.trunc(number(plan.development_san_planned_delta)),
        scenario_san_reward_roll: plan.scenario_san_reward ?? null,
        scenario_san_reward_planned_delta: Math.trunc(number(plan.scenario_san_planned_delta)),
        san_before: sanBefore,
        san_after: sanAfter,
        luck_recovery: luckRecovery,
        mechanical_baseline: baseline,
        settlement_plan_sha256: plan.plan_sha256,
        merge_policy: 'frozen_plan_additive_monotonic_v1',
        input_tokens_consumed: [...array(input.input_tokens)]
    };
    await campaign.writeSave(receiptName, result);
    return result;
}
