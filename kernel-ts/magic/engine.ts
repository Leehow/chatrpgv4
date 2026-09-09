/** Current casting and learning arithmetic; rule data and the caller own authority. */
import type { PythonRandom } from '../random.js';
import { array, integer, repr, row, string, truth, type Row } from '../read/values.js';
import { CheckArithmetic, rollExpression, SUCCESS_OUTCOMES, valueError } from '../resolve/arithmetic.js';
import type { Catalog } from '../rules/catalog.js';
import type { RuleTables } from '../rules/tables.js';
import type { MPool } from '../healing/mp.js';
import { sanityInt as int } from '../sanity/expression.js';
import { spellByName, UnpricedSpellError } from './spells.js';

const DICE = /^(\p{Decimal_Number}+)D(\p{Decimal_Number}+)([+-]\p{Decimal_Number}+)?$/u;
const field = (value: Row, key: string, fallback: any): any => Object.hasOwn(value, key) ? value[key] : fallback;
export async function castingRules(tables: RuleTables): Promise<Row> {
    const rules = (await tables.spellsTable()).casting;
    return truth(rules) ? rules : { first_cast_roll: 'Hard POW', pushable: true, push_mp_multiplier: '1D6', mp_overspill_to_hp_one_for_one: true,
        subsequent_casts_no_roll: true, npcs_no_casting_roll: true, failed_pushed_cast_works: true, disrupted_cast_pays_mp_and_sanity: true };
}
export async function learningRules(tables: RuleTables): Promise<Row> {
    const rules = (await tables.spellsTable()).learning;
    return truth(rules) ? rules : { roll: 'Hard INT', pushable: true, from_tome_weeks: '2D6', from_person_days: '1D8', from_entity_min_sanity_cost: '1D6', from_entity_roll: 'Regular INT' };
}
export function rollMagicDice(expression: any, rng: PythonRandom): number {
    const match = DICE.exec(string(expression).trim());
    if (match) {
        const count = int(match[1]), sides = int(match[2]), modifier = match[3] ? int(match[3]) : 0;
        let total = modifier;
        for (let index = 0; index < count; index++) total += rng.randint(1, sides);
        return total;
    }
    try { return int(expression); }
    catch (error) { if (!['TypeError', 'ValueError'].includes((error as Error).name)) throw error; }
    try { return int(rollExpression(string(expression), rng).total); }
    catch (error) { if ((error as Error).name !== 'ValueError') throw error; return 0; }
}
export function resolveMpCost(expression: any, rng: PythonRandom): number | boolean {
    if (expression == null) return 0;
    if (typeof expression === 'boolean') return expression;
    if (integer(expression)) return int(expression);
    const text = string(expression).trim();
    if (text.endsWith('+')) {
        try { return int(text.slice(0, -1)); }
        catch (error) { if ((error as Error).name !== 'ValueError') throw error; return 0; }
    }
    if (text.includes('per person') || text.includes('per/person')) return 1;
    if (text.toLowerCase() === 'variable') return 0;
    const leading = /^(\p{Decimal_Number}+)(?=$|[^\p{L}\p{N}_])/u.exec(text);
    if (leading && !DICE.test(text)) return int(leading[1]);
    return rollMagicDice(text, rng);
}
export function resolveSanityCost(expression: any, rng: PythonRandom): number | boolean {
    if (expression == null) return 0;
    if (typeof expression === 'boolean') return expression;
    if (integer(expression)) return int(expression);
    const text = string(expression).trim();
    return ['variable', ''].includes(text.toLowerCase()) ? 0 : rollMagicDice(text, rng);
}
export function resolvePowCost(spell: Row, rng: PythonRandom): number | boolean {
    const raw = field(spell, 'cost_pow', spell.pow_cost);
    if (raw == null) return 0;
    if (typeof raw === 'boolean') return raw;
    if (integer(raw)) return int(raw);
    const text = string(raw).trim();
    return !text || ['variable', 'null'].includes(text.toLowerCase()) ? 0 : rollMagicDice(text, rng);
}
function pushTier(spell: Row, baseMp: number): string {
    for (const key of ['push_tier', 'power_tier', 'side_effect_tier']) {
        const raw = spell[key];
        if (typeof raw === 'string' && ['minor', 'major'].includes(raw.trim().toLowerCase())) return raw.trim().toLowerCase();
    }
    return baseMp >= 10 ? 'major' : 'minor';
}
async function pushSideEffect(tables: RuleTables, tier: string, rng: PythonRandom): Promise<Row> {
    const table = row((await tables.spellsTable()).push_side_effects), minor = array(table.minor), major = array(table.major);
    const rows = tier === 'major' && major.length ? major : minor, roll = rng.randint(1, 8);
    let effect = '';
    for (const entry of rows) if (int(field(entry, 'roll', 0)) === roll) { effect = string(field(entry, 'effect', '')); break; }
    if (!effect && rows.length) effect = string(field(rows[Math.min(roll, rows.length) - 1], 'effect', ''));
    return { roll, tier, effect };
}
function spendMp(rawAmount: number | boolean, spell: string, caster: Row, casting: Row, pool?: Pick<MPool, 'spendMp'>): number {
    const amount = int(rawAmount);
    if (amount <= 0) return 0;
    if (pool) return int(pool.spendMp(amount, `cast:${spell}`).hp_damage ?? 0);
    const before = int(field(caster, 'current_mp', 0)), hp = int(field(caster, 'current_hp', 0));
    let next = before - amount, damage = 0;
    if (next < 0 && truth(field(casting, 'mp_overspill_to_hp_one_for_one', true))) { damage = -next; next = 0; caster.current_hp = Math.max(0, hp - damage); }
    caster.current_mp = next; return damage;
}
function applySanLoss(caster: Row, rawAmount: number | boolean): void {
    const amount = int(rawAmount);
    if (amount > 0 && Object.hasOwn(caster, 'current_san')) caster.current_san = Math.max(0, int(field(caster, 'current_san', 0)) - amount);
}
function applyPowCost(caster: Row, amount: number): void {
    if (amount > 0 && Object.hasOwn(caster, 'pow')) caster.pow = Math.max(0, int(field(caster, 'pow', 0)) - amount);
}
export async function castSpell(tables: RuleTables, catalog: Catalog, arithmetic: CheckArithmetic, spellName: string, caster: Row, options: {
    isFirstCast: boolean; rng: PythonRandom; isNpc?: boolean; pushed?: boolean; interrupted?: boolean; mpPool?: Pick<MPool, 'spendMp'>; moduleSpells?: Row[];
}): Promise<Row> {
    const { rng, isFirstCast } = options, isNpc = options.isNpc ?? false, pushed = options.pushed ?? false, interrupted = options.interrupted ?? false;
    const casting = await castingRules(tables), spell = await spellByName(tables, catalog, spellName, options.moduleSpells);
    if (spell.costs_authored === false) throw new UnpricedSpellError(spellName, string(spell.module_node_id || ''), array(spell.unpriced_fields).map(string));
    const mpExpression = field(spell, 'cost_mp', '0'), sanExpression = field(spell, 'cost_sanity', '0');
    if (interrupted) {
        const baseMp = resolveMpCost(mpExpression, rng), hpDamage = spendMp(baseMp, spellName, caster, casting, options.mpPool);
        const sanLost = resolveSanityCost(sanExpression, rng); applySanLoss(caster, sanLost);
        return { spell: spellName, success: false, pushed, interrupted: true, is_npc: isNpc, is_first_cast: isFirstCast, roll_result: null,
            mp_spent: baseMp, hp_damage: hpDamage, san_lost: sanLost, pow_spent: 0, base_mp_cost: baseMp, side_effect: null,
            summary: `cast ${spellName}: interrupted, mp ${string(baseMp)} lost, success=False` };
    }
    let roll: Row | null = null, success = true;
    if (!(isNpc && truth(field(casting, 'npcs_no_casting_roll', true))) && (isFirstCast || pushed)) {
        roll = arithmetic.check(int(field(caster, 'pow', 0)), 'hard', 0, 0, rng); success = SUCCESS_OUTCOMES.has(roll.outcome);
    }
    const baseMp = resolveMpCost(mpExpression, rng), failedPush = pushed && !success;
    const multiplier = failedPush ? Math.max(1, rollMagicDice(string(field(casting, 'push_mp_multiplier', '1D6')), rng)) : 1;
    const spent = failedPush ? int(baseMp) * multiplier : baseMp, hpDamage = spendMp(spent, spellName, caster, casting, options.mpPool);
    let sanLost = 0, powSpent = 0, sideEffect: Row | null = null;
    if (success || failedPush) {
        sanLost = int(resolveSanityCost(sanExpression, rng)) * multiplier; applySanLoss(caster, sanLost);
        powSpent = int(resolvePowCost(spell, rng)) * multiplier; applyPowCost(caster, powSpent);
    }
    if (failedPush) { sideEffect = await pushSideEffect(tables, pushTier(spell, int(baseMp)), rng); success = true; }
    return { spell: spellName, success, pushed, interrupted: false, is_npc: isNpc, is_first_cast: isFirstCast, roll_result: roll,
        mp_spent: spent, hp_damage: hpDamage, san_lost: sanLost, pow_spent: powSpent, base_mp_cost: baseMp, side_effect: sideEffect,
        summary: `cast ${spellName}: ${roll === null ? 'auto-success' : `POW(hard)->${roll.outcome}`}${pushed ? ', pushed' : ''}, mp ${string(spent)} (hp ${hpDamage}), san -${sanLost}${powSpent ? `, pow -${powSpent}` : ''}, success=${string(success)}` };
}
export async function learnSpell(tables: RuleTables, catalog: Catalog, arithmetic: CheckArithmetic, spellName: string, learner: Row, source: string, options: {
    rng: PythonRandom; clockMinutes?: number | null; moduleSpells?: Row[];
}): Promise<Row> {
    const { rng } = options, learning = await learningRules(tables);
    if (!['tome', 'person', 'entity'].includes(source)) valueError(`unsupported learn source: ${repr(source)}`);
    const spell = await spellByName(tables, catalog, spellName, options.moduleSpells), difficulty = source === 'entity' ? 'regular' : 'hard';
    const roll = arithmetic.check(int(field(learner, 'int', 0)), difficulty, 0, 0, rng), outcome = roll.outcome, learned = SUCCESS_OUTCOMES.has(outcome);
    let weeks = 0, days = 0, due: number | null = null;
    const sanExpression = source === 'entity' ? string(spell.from_entity_min_sanity_cost || learning.from_entity_min_sanity_cost || '1D6') : null;
    if (learned) {
        if (source === 'tome') { weeks = rollMagicDice(string(field(learning, 'from_tome_weeks', '2D6')), rng); days = weeks * 7; }
        else if (source === 'person') days = rollMagicDice(string(field(learning, 'from_person_days', '1D8')), rng);
        if (['tome', 'person'].includes(source) && options.clockMinutes != null) due = int(options.clockMinutes) + days * 24 * 60;
    }
    return { spell: spellName, source, learned, roll_result: roll, study_weeks: weeks, study_days: days, study_completion_elapsed_minutes: due,
        summary: `learn ${spellName} from ${source}: INT(${difficulty})->${outcome}, ${learned ? 'learned' : 'not learned'}${source === 'tome' && learned ? `, ${weeks}w study` : source === 'person' && learned ? `, ${days}d study` : ''}${sanExpression ? `, san floor ${sanExpression}` : ''}`,
        ...(sanExpression !== null ? { san_cost_expr: sanExpression } : {}) };
}
