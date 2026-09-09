/** Structured social difficulty and the concealed Psychology contract. */
import { isJsonObject } from '../json.js';
import { array, equal, integer, number, string, truth, type Row } from '../read/values.js';
import { SOCIAL_APPROACH_SKILLS, valueError } from './arithmetic.js';
export function socialDifficulty(request: Row, npcDefense: number | null): Row {
    const approach = string(request.approach || '');
    if (!Object.hasOwn(SOCIAL_APPROACH_SKILLS, approach))
        valueError('unknown CoC 7e social approach');
    if (npcDefense !== null && (!integer(npcDefense) || npcDefense < 0 || npcDefense > 100))
        valueError('npc_defense must be an integer 0-100 or None');
    const direction = string(request.motive_direction || 'neutral');
    const intensity = request.motive_intensity ?? 0;
    const bonus = request.bonus ?? 0;
    const penalty = request.penalty ?? 0;
    if (!['support', 'neutral', 'oppose'].includes(direction))
        valueError('invalid motive direction');
    if (typeof intensity === 'boolean' || ![0, 1, 2].some(n => equal(intensity, n)))
        valueError('invalid motive intensity');
    if (request.described_action != null && typeof request.described_action !== 'string')
        valueError('described_action must be a string');
    if (request.goal != null && typeof request.goal !== 'string')
        valueError('goal must be a string');
    if (request.motive_evidence != null && !Array.isArray(request.motive_evidence))
        valueError('motive_evidence must be a list');
    let supporting: Row;
    if (request.supporting_action == null)
        supporting = {
            description: '',
            level: 0,
            provenance: ''
        };
    else {
        if (!isJsonObject(request.supporting_action))
            valueError('supporting_action must be an object');
        const input = request.supporting_action;
        const description = input.description ?? '';
        const level = input.level ?? 0;
        const provenance = input.provenance ?? '';
        if (typeof description !== 'string')
            valueError('supporting_action.description must be a string');
        if (!integer(level) || ![0, 1].includes(number(level)))
            valueError('supporting_action.level must be 0 or 1');
        if (typeof provenance !== 'string')
            valueError('supporting_action.provenance must be a string');
        supporting = {
            description,
            level,
            provenance
        };
    }
    let existing: number;
    if (Object.hasOwn(request, 'leverage_one_level')) {
        if (![true, false].some(flag => equal(flag, request.leverage_one_level)))
            valueError('leverage_one_level must be a boolean');
        existing = truth(request.leverage_one_level) ? 1 : 0;
    }
    else {
        const count = request.strategic_count ?? 0;
        if (!integer(count))
            valueError('strategic_count must be an integer');
        if (number(count) < 0 || number(count) > 2)
            valueError('strategic_count must be 0-2');
        existing = truth(count) ? 1 : 0;
    }
    if ([bonus, penalty].some(value => !integer(value) || number(value) < 0 || number(value) > 2))
        valueError('bonus and penalty must be integers 0-2');
    const leverage = existing || truth(supporting.level) ? 1 : 0;
    const base = npcDefense === null || npcDefense < 50 ? 0 : npcDefense < 90 ? 1 : 2;
    const motive = direction === 'oppose' ? number(intensity) : direction === 'support' && number(intensity) > 0 ? -1 : 0;
    const final = base + motive - leverage;
    const feasibility = direction === 'support' && number(intensity) > 0 ? 'automatic' : final > 2 ? 'conditional' : final < 0 ? 'automatic' : 'roll';
    const difficulties = ['regular', 'hard', 'extreme'];
    return {
        approach_skill: SOCIAL_APPROACH_SKILLS[approach],
        defense_skills: ['Psychology', SOCIAL_APPROACH_SKILLS[approach]],
        base_difficulty: difficulties[base],
        motive_adjustment: motive,
        leverage_one_level: Boolean(leverage),
        strategic_adjustment: -leverage || 0,
        described_action: string(request.described_action || ''),
        goal: string(request.goal || ''),
        supporting_action: supporting,
        final_difficulty: difficulties[Math.max(0, Math.min(2, final))],
        feasibility,
        bonus_dice: bonus,
        penalty_dice: penalty
    };
}
export function psychologyPolicy(check: Row): Row {
    if (Object.hasOwn(check, 'inference_ceiling') || Object.hasOwn(check, 'external_behavior')) {
        const locked = ['reexecution', 'reroll'].filter(key => Object.hasOwn(check, key));
        if (locked.length)
            valueError(`realization has no roll path; do not supply ${locked.join(', ')}`);
        const ceiling = string(check.inference_ceiling || '').trim();
        const behavior = string(check.external_behavior || '').trim();
        if (!ceiling)
            valueError('inference_ceiling is required for realization');
        if (!['deep_conflict', 'motive_link', 'immediate_intent', 'uncertain'].includes(ceiling))
            valueError('inference_ceiling is not a frozen observation depth');
        if (!behavior)
            valueError('external_behavior is required for realization');
        return {
            player_projection: {
                external_behavior: behavior
            },
            concealed_result: {
                inference_ceiling: ceiling
            }
        };
    }
    const outcome = string(check.outcome || 'failure');
    const depth = ['critical', 'extreme'].includes(outcome) ? 'deep_conflict' : outcome === 'hard' ? 'motive_link' : outcome === 'regular' ? 'immediate_intent' : 'uncertain';
    return {
        inference_depth: depth,
        misread_policy: ['failure', 'fumble'].includes(outcome) || depth === 'uncertain' ? 'any_unreliable_including_opposite' : 'none'
    };
}
export function psychologyCheckContract(request: Row | number | null = null): Row {
    const intField = (value: any, name: string): number | null => {
        if (value == null)
            return null;
        if (!integer(value) || number(value) < 0 || number(value) > 100)
            valueError(`${name} must be an integer 0-100 or None`);
        return number(value);
    };
    let opposing: number | null;
    let observer: number | null = null;
    let question: any = null;
    let observable: any = null;
    if (isJsonObject(request)) {
        if (Object.hasOwn(request, 'observer_skill_base_chance'))
            valueError('observer_skill_base_chance is resolver-owned; do not supply it as payload');
        opposing = intField(request.target_opposing_social, 'target_opposing_social');
        observer = intField(request.observer_skill, 'observer_skill');
        question = request.question;
        observable = request.observable_facts;
        if (question != null && typeof question !== 'string')
            valueError('question must be a string');
        if (observable != null && !Array.isArray(observable))
            valueError('observable_facts must be a list');
    }
    else
        opposing = intField(request, 'target_opposing_social');
    return {
        skill: 'Psychology',
        observer_skill: observer ?? 10,
        observer_skill_base_chance: 10,
        observer_skill_source: observer === null ? 'rulebook_base' : 'sheet',
        target_opposing_social: opposing,
        question: question || '',
        observable_facts: [...array(observable)],
        defense_skills: Object.values(SOCIAL_APPROACH_SKILLS),
        difficulty: opposing === null || opposing < 50 ? 'regular' : opposing < 90 ? 'hard' : 'extreme',
        difficulty_basis: 'opponent_skill',
        stakes: {
            on_success: 'the observer reads the current behavior correctly',
            on_failure: 'the Keeper may give any unreliable information including the opposite of the truth; inversion is not compelled'
        }
    };
}
