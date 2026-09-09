/** Combat roll evidence uses the shared percentile arithmetic and closed projections. */
import { isJsonObject } from '../json.js';
import { entries, row, string, truth, type Row } from '../read/values.js';
import { caseFold } from '../rules/casefold.js';
export const LEVELS: Row = { fumble: 0, failure: 1, regular: 2, hard: 3, extreme: 4, critical: 5 };
export const PERCENTILE_FIELDS = ['base_target', 'target', 'required_level', 'difficulty', 'required_target', 'effective_target', 'achieved_level', 'passed', 'success', 'surplus_levels', 'outcome'];
const SAFE_KEYS = ['visibility', 'roll', 'achieved_level', 'outcome', 'passed', 'required_level', 'surplus_levels', 'contest_winner', 'opposed_side', 'skill', 'kind', 'die_expression', 'original_roll', 'luck_spent', 'adjusted_roll', 'bonus', 'penalty', 'pushed'];
export function playerProjection(raw: Row, includeTarget?: boolean, extra: Row = {}): Row {
    const firstContact = ['first_contact', 'first_contact_roll'].includes(string(raw.kind || ''));
    const kind = typeof row(raw.subject).kind === 'string' && row(raw.subject).kind.trim() ? caseFold(row(raw.subject).kind.trim()) : raw.opposed_side === 'investigator' ? 'investigator' : raw.opposed_side === 'opponent' ? 'opponent' : null;
    const include = includeTarget === undefined ? firstContact || !['npc', 'monster', 'opponent'].includes(kind ?? '') : includeTarget;
    const view: Row = { visibility: string(raw.visibility || 'public') };
    for (const key of SAFE_KEYS)
        if (raw[key] != null)
            view[key] = raw[key];
    if (include) {
        for (const key of ['base_target', 'required_target', 'effective_target', 'target', 'characteristic'])
            if (raw[key] != null)
                view[key] = raw[key];
        if (firstContact)
            for (const key of ['app', 'credit_rating', 'governing_attribute', 'governing_value', 'npc_display_name'])
                if (Object.hasOwn(raw, key))
                    view[key] = raw[key];
    }
    for (const [key, value] of entries(extra))
        if (value != null)
            view[key] = value;
    for (const key of ['marker', 'tens_values', 'units', 'player_projection'])
        delete view[key];
    return view;
}
export function stampSkillOwnership(record: Row, actorId: string, weapon: Row | null): void {
    weapon = isJsonObject(weapon) ? weapon : {};
    let kind = weapon.executor_kind;
    if (truth(weapon.remote) || truth(weapon.device) || truth(weapon.poltergeist))
        kind ||= 'remote_device';
    if (truth(weapon.environment) || truth(weapon.hazard))
        kind ||= 'environment';
    record.executor_id = actorId;
    if (typeof weapon.action_designer_id === 'string' && weapon.action_designer_id)
        record.action_designer_id = weapon.action_designer_id;
    if (truth(kind)) {
        record.executor_kind = string(kind);
        if (['device', 'remote_device', 'environment', 'trap', 'apparatus', 'poltergeist', 'hazard'].includes(caseFold(string(kind)))) {
            const owner = weapon.skill_owner_id;
            if (typeof owner === 'string' && owner.trim())
                record.skill_owner_id = owner.trim();
            else {
                record.skill_owner_id = null;
                record.improvement_tick_eligible = false;
            }
            if (!Object.hasOwn(record, 'action_designer_id')) {
                const designer = weapon.action_designer_id || actorId;
                if (typeof designer === 'string' && designer)
                    record.action_designer_id = designer;
            }
            return;
        }
    }
    const owner = weapon.skill_owner_id || actorId;
    if (typeof owner === 'string' && owner.trim())
        record.skill_owner_id = owner.trim();
}
export function resolveOpposed(attack: string, defense: string, defenseKind: string): string {
    const a = LEVELS[attack], d = LEVELS[defense];
    if (a <= LEVELS.failure && d <= LEVELS.failure)
        return 'both_fail';
    if (a > d)
        return 'attacker_higher';
    if (d > a)
        return 'defender_higher';
    return defenseKind === 'dodge' ? 'tie_defender_wins' : 'tie_attacker_wins';
}
