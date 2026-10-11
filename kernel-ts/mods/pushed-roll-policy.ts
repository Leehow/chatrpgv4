/** The one data contribution behind the declaration-only pushed-roll Mod (§228). */
import {RpcError} from '../errors.js';
import {array, integer, row, string, type Row} from '../read/values.js';
import type {RuleTables} from '../rules/tables.js';

export const PUSH_CAPABILITY = 'checks.pushed-roll.v1';
export const PUSH_DECISION = 'decision:coc7:push-luck:pushed-roll';
export const PUSH_REASONS = ['mod_disabled', 'no_source', 'source_ambiguous', 'wrong_actor', 'goal_obsolete',
    'not_failure', 'fumble', 'already_pushed', 'luck_used', 'push_luck_conflict', 'luck_roll', 'sanity_roll',
    'combat_roll', 'chase_roll', 'amount_roll', 'opposed_roll', 'procedure_roll', 'procedure_unavailable',
    'judgment_unavailable'] as const;
export type PushReason = typeof PUSH_REASONS[number];
export interface PushProvider {id: string; version: string; digest: string; rules: Row}

export function validatePushRules(value: unknown): Row {
    const rules = row(value);
    const fail = (message: string): never => {throw new RpcError('invalid_params', `Invalid pushed-roll contribution: ${message}`);};
    if (rules.version !== 1 || rules.maximum_attempts !== 1 || rules.luck_conflict !== true)
        fail('version 1 requires one final attempt and the Luck exclusion');
    for (const key of ['declaration', 'context_question'])
        if (typeof rules[key] !== 'string' || !rules[key].trim()) fail(`${key} must be English instruction text`);
    for (const key of ['allowed_kinds', 'excluded_skills', 'excluded_groups', 'excluded_characteristics'])
        if (!Array.isArray(rules[key]) || rules[key].some((item: unknown) => typeof item !== 'string' || !item)) fail(`${key} must be a list of canonical names`);
    if (rules.allowed_kinds.length !== 3 || ['skill_check', 'characteristic_check', 'combined_skill_check'].some(kind => !rules.allowed_kinds.includes(kind)))
        fail('only ordinary skill, characteristic and combined checks are supported');
    if (!['LUCK', 'SAN'].every(name => rules.excluded_characteristics.includes(name))
        || !['Dodge', 'Artillery'].every(name => rules.excluded_skills.includes(name))
        || !['Fighting', 'Firearms'].every(name => rules.excluded_groups.includes(name))) fail('rulebook exclusions must remain');
    if (!array(rules.rows).length) fail('a risk table is required');
    let next = 1;
    const keys = new Set<string>();
    for (const entry of rules.rows) {
        if (!entry || typeof entry !== 'object' || !integer(entry.min) || !integer(entry.max) || entry.min !== next || entry.max < entry.min || entry.max > 100
            || entry.weight !== entry.max-entry.min+1 || typeof entry.key !== 'string' || !/^[a-z][a-z0-9_]*$/.test(entry.key)
            || keys.has(entry.key) || typeof entry.instruction !== 'string' || !entry.instruction.trim()) fail('rows must cover D100 once with unique keys and matching weights');
        keys.add(entry.key); next = entry.max+1;
    }
    if (next !== 101) fail('risk table must cover every integer 1..100');
    if (!Array.isArray(rules.fallback) || rules.fallback.length !== 2 || rules.fallback.some((key: unknown) => !keys.has(string(key)))) fail('two existing fallback keys are required');
    if (PUSH_REASONS.some(reason => typeof row(rules.refusals)[reason] !== 'string' || !rules.refusals[reason].trim())) fail('every refusal needs an explanation');
    return rules;
}

/** Never scan backwards through eligible-only checks: a SAN/fumble/attack is the latest action too. */
export function latestPushSource(receipts: Row[], actor: string): Row | null {
    return [...receipts].reverse().find(receipt => receipt.actor === actor && receipt.kind === 'roll' && receipt.form !== 'dice') ?? null;
}

export async function pushRefusal(provider: PushProvider | null, source: Row | null, input: {
    actor: string; receipts: Row[]; session?: Row | null; luck?: unknown; continuation?: unknown;
}, tables: Pick<RuleTables, 'skillByName'>): Promise<PushReason | null> {
    if (!provider) return 'mod_disabled';
    if (input.luck != null) return 'push_luck_conflict';
    if (!source) return 'no_source';
    if (source.actor !== input.actor) return 'wrong_actor';
    if (source.visibility === 'keeper') return 'no_source';
    if (input.session?.kind === 'chase' || string(source.roll_kind).startsWith('chase_')) return 'chase_roll';
    if (source.form === 'dice') return 'amount_roll';
    const check = row(source.check), kind = string(source.roll_kind || check.kind);
    if (kind === 'sanity_check') return 'sanity_roll';
    if (check.luck_roll === true || kind === 'luck_roll') return 'luck_roll';
    if (kind === 'opposed_check') return 'opposed_roll';
    if (kind.startsWith('combat')) return 'combat_roll';
    if (['healing_check', 'casting_roll', 'learning_roll'].includes(kind)) return 'procedure_unavailable';
    if (source.pushed === true || check.pushed === true) return 'already_pushed';
    if (source.continued_by || check.luck_spent || input.receipts.some(receipt => receipt.source_receipt === source.id))
        return source.continued_by === 'push' ? 'already_pushed' : 'luck_used';
    if (source.level === 'fumble' || check.outcome === 'fumble') return 'fumble';
    if (!provider.rules.allowed_kinds.includes(kind) || check.idea_roll === true) return 'procedure_roll';
    const labels = kind === 'combined_skill_check' ? array(check.combined_targets).length
        ? array(check.combined_targets).map(entry => string(entry.label)) : array(row(check.combined_roll).targets).map(entry => string(entry.label))
        : [string(source.skill || check.skill)];
    if (!labels.length) return 'source_ambiguous';
    for (const label of labels) {
        if (provider.rules.excluded_characteristics.includes(label.toUpperCase())) return label.toUpperCase() === 'LUCK' ? 'luck_roll' : 'sanity_roll';
        if (provider.rules.excluded_skills.includes(label) || provider.rules.excluded_groups.includes(label)) return 'combat_roll';
        try {
            const spec = await tables.skillByName(label);
            if (provider.rules.excluded_groups.includes(spec.group)) return 'combat_roll';
        } catch (error) {
            if (!['KeyError', 'ValueError'].includes((error as Error).name)) throw error;
        }
    }
    if (source.passed !== false || check.outcome !== 'failure') return 'not_failure';
    if (input.continuation === 'goal_obsolete' || input.continuation === 'source_ambiguous') return input.continuation;
    if (input.continuation != null && input.continuation !== 'same_goal') return 'judgment_unavailable';
    return null;
}

export function refusePush(reason: PushReason, provider: PushProvider | null): never {
    const explanation = provider?.rules.refusals[reason] || (reason === 'mod_disabled'
        ? 'Pushed rolls are unavailable because the Pushed Roll Mod is not active for this campaign.'
        : 'This pushed attempt cannot be executed.');
    throw new RpcError('turn_state', explanation, {codeDetail: 'rule_decision_not_applicable', next: 'narrate',
        fix: 'Explain this reason briefly to the player in play_language and return the turn. Do not roll, charge a cost, ask for confirmation, or substitute an ordinary retry. A technical limitation is not a rule prohibition.',
        details: {reason, push_refused: true}});
}
