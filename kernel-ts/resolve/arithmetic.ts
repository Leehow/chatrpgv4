/** CoC arithmetic over the captured rule tables and the kernel's one RNG. */
import { RpcError } from '../errors.js';
import type { PythonRandom } from '../random.js';
import { RuleTables } from '../rules/tables.js';
import { array, clone, entries, equal, integer, number, row, string, truth, type Row } from '../read/values.js';
export const SUCCESS_OUTCOMES = new Set(['regular', 'hard', 'extreme', 'critical']);
const ranks: Row = {
    regular: 1,
    hard: 2,
    extreme: 3,
    critical: 4
};
type Integer = number | bigint;
const add = (left: Integer, right: Integer): Integer => typeof left === 'bigint' || typeof right === 'bigint' ? BigInt(left) + BigInt(right) : left + right;
const subtract = (left: Integer, right: Integer): Integer => typeof left === 'bigint' || typeof right === 'bigint' ? BigInt(left) - BigInt(right) : left - right;
const minimum = (left: Integer, right: Integer): Integer => left < right ? left : right;
const maximum = (left: Integer, right: Integer): Integer => left > right ? left : right;
export const SOCIAL_APPROACH_SKILLS: Row = {
    charm: 'Charm',
    fast_talk: 'Fast Talk',
    intimidate: 'Intimidate',
    persuade: 'Persuade',
};
export const APPROACH_BY_SKILL: Row = Object.fromEntries(entries(SOCIAL_APPROACH_SKILLS).map(([key, value]) => [value, key]));
export function valueError(message: string): never {
    const error = new Error(message);
    error.name = 'ValueError';
    throw error;
}
export function rollExpression(expression: string, rng: PythonRandom): Row {
    const normalized = string(expression).trim().toUpperCase().replaceAll(' ', '');
    const tokens = normalized.replaceAll('-', '+-').split('+').filter(Boolean);
    const invalid = () => valueError(`unsupported dice expression: ${expression}`);
    if (!tokens.length)
        return invalid();
    const rolls: number[] = [];
    const terms: Row[] = [];
    let modifier = 0;
    let total = 0;
    for (const token of tokens) {
        const sign = token.startsWith('-') ? -1 : 1;
        const body = sign < 0 ? token.slice(1) : token;
        const match = /^(\d+)D(\d+)$/.exec(body);
        if (match) {
            const count = Number(match[1]);
            const sides = Number(match[2]);
            if (count < 1 || sides < 1)
                return invalid();
            const faces = Array.from({
                length: count
            }, () => rng.randint(1, sides));
            rolls.push(...faces);
            total += sign * faces.reduce((sum, face) => sum + face, 0);
            terms.push({
                count,
                sides,
                sign,
                rolls: faces
            });
        }
        else {
            if (!/^\d+(?:_\d+)*$/.test(body))
                return invalid();
            const value = Number(body.replaceAll('_', ''));
            modifier += sign * value;
            total += sign * value;
            terms.push({
                modifier: sign * value
            });
        }
    }
    const dice = terms.filter(term => Object.hasOwn(term, 'sides'));
    if (!dice.length)
        return invalid();
    const result: Row = {
        expression: normalized,
        modifier,
        terms,
        rolls,
        total
    };
    if (dice.length === 1 && dice[0].sign === 1) {
        result.count = dice[0].count;
        result.sides = dice[0].sides;
    }
    return result;
}
export class CheckArithmetic {
    private constructor(readonly tables: RuleTables, readonly data: Row) { }
    static async create(tables: RuleTables): Promise<CheckArithmetic> {
        const names = ['percentile-check', 'roll-modifiers', 'difficulty-levels', 'success-levels', 'half-fifth-values', 'pushed-roll', 'development'];
        const loaded = await Promise.all(names.map(name => tables.load(name)));
        return new CheckArithmetic(tables, Object.fromEntries(names.map((name, index) => [name, row(loaded[index])])));
    }
    difficulties(): string[] {
        return entries(this.data['difficulty-levels']).filter(([, block]) => Object.hasOwn(row(block), 'divisor')).map(([name]) => name);
    }
    difficultyTarget(target: number, difficulty: string): number {
        const table = this.data['difficulty-levels'];
        if (!Object.hasOwn(table, difficulty))
            valueError(`unsupported difficulty: ${difficulty}`);
        if (!Object.hasOwn(row(table[difficulty]), 'divisor'))
            valueError(`difficulty '${difficulty}' has no divisor`);
        return Math.floor(target / number(table[difficulty].divisor));
    }
    /** The lowest target the die can answer, owned by `percentile-check.json`, not by this file. */
    get minimumTarget(): number {
        return number(this.data['percentile-check'].minimum_target);
    }
    private clampTarget(target: number): number {
        const rule = this.data['percentile-check'];
        return Math.max(number(rule.minimum_target), Math.min(number(rule.maximum_target), Math.trunc(target)));
    }
    /** The number the roll is actually compared against, on the same clamp `check` rolls against. */
    effectiveTarget(target: number, difficulty: string): number {
        return this.difficultyTarget(this.clampTarget(target), difficulty);
    }
    /**
     * A difficulty that leaves an effective target below the die's minimum is not a hard check but
     * an unrollable request (§45): 1d100 has no face at or below it, so the outcome is settled
     * before the die leaves the cup and the consequence is authored, not rolled. Refuse it and hand
     * the keeper the repair; do not roll, do not fail, do not land stakes.
     */
    assertRollable(target: number, difficulty: string, label: string, pushed = false): number {
        const effective = this.effectiveTarget(target, difficulty);
        const minimum = this.minimumTarget;
        if (effective >= minimum)
            return effective;
        const repeats = pushed ? 'A pushed roll repeats the same target, so pushing cannot make this one rollable. ' : '';
        throw new RpcError('invalid_params', `${label} at ${difficulty} leaves an effective target of ${effective}; 1d100 has no result at or below ${effective}, so this check cannot be rolled`, {
            fix: `${repeats}This is service information about your own request, addressed to you as the keeper: it is not fiction, so do not narrate it, do not read it to the player, and do not treat the attempt as having failed. Nothing was rolled and nothing happened. Send resolve again with exactly one change: either name a skill or characteristic this investigator's sheet gives a usable value in, or keep this one and lower the difficulty until the effective target is at least ${minimum} (regular keeps the whole value, hard halves it, extreme takes a fifth). The player's stated action still stands; ask them for nothing.`,
            details: {
                reason: 'effective_target_below_minimum',
                skill: label,
                base_target: this.clampTarget(target),
                difficulty,
                effective_target: effective,
                minimum_target: minimum,
                pushed
            }
        });
    }
    successLevel(roll: number, target: number): string {
        const rule = this.data['percentile-check'];
        const levels = this.data['success-levels'];
        if (roll < rule.minimum_roll || roll > rule.maximum_roll)
            valueError(`roll must be between ${rule.minimum_roll} and ${rule.maximum_roll}`);
        if (target < rule.minimum_target || target > rule.maximum_target)
            valueError(`target must be between ${rule.minimum_target} and ${rule.maximum_target}`);
        if (roll === number(levels.critical_roll))
            return 'critical';
        const band = levels.fumble[target < number(levels.fumble.target_threshold) ? 'target_below_threshold' : 'target_at_or_above_threshold'];
        if (band[0] <= roll && roll <= band[1])
            return 'fumble';
        const fractions = this.data['half-fifth-values'];
        if (roll <= Math.floor(target / number(fractions.fifth.divisor)))
            return 'extreme';
        if (roll <= Math.floor(target / number(fractions.half.divisor)))
            return 'hard';
        return roll <= target ? 'regular' : 'failure';
    }
    resolve(roll: number, target: number, difficulty: string): Row {
        target = Math.trunc(target);
        roll = Math.trunc(roll);
        const threshold = this.difficultyTarget(target, difficulty);
        const special = this.successLevel(roll, Math.max(1, threshold));
        const base = this.successLevel(roll, target);
        const achieved = ['critical', 'fumble'].includes(special) ? special : base;
        const requiredRank = ranks[difficulty];
        const achievedRank = ranks[achieved] || 0;
        const passed = achievedRank >= requiredRank;
        const outcome = passed ? achieved : achieved === 'fumble' ? 'fumble' : 'failure';
        return {
            target,
            base_target: target,
            difficulty,
            required_level: difficulty,
            threshold,
            required_target: threshold,
            effective_target: threshold,
            achieved_level: achieved,
            passed,
            success: passed,
            surplus_levels: passed ? Math.max(0, achievedRank - requiredRank) : 0,
            level: outcome,
            outcome,
        };
    }
    check(target: number, difficulty: string, bonus: number, penalty: number, rng: PythonRandom): Row {
        const rule = this.data['percentile-check'];
        const modifiers = this.data['roll-modifiers'];
        if (modifiers.cancellation.method !== 'one_for_one')
            valueError(`unsupported roll modifier cancellation: ${modifiers.cancellation.method}`);
        const netBonus = Math.min(Math.max(0, bonus - penalty), number(modifiers.maximum_dice_per_roll.bonus));
        const netPenalty = Math.min(Math.max(0, penalty - bonus), number(modifiers.maximum_dice_per_roll.penalty));
        target = this.clampTarget(target);
        let roll: number;
        let units: number | null = null;
        const tens: number[] = [];
        const fromDigits = (tensValue: number, unitsValue: number) => tensValue * number(rule.digit_base) + unitsValue || number(rule.zero_zero_result);
        if (!netBonus && !netPenalty) {
            roll = rng.randint(number(rule.minimum_roll), number(rule.maximum_roll));
        }
        else {
            units = rng.randrange(number(rule.digit_base));
            tens.push(rng.randrange(number(rule.digit_base)));
            const active = netBonus ? modifiers.bonus_die : modifiers.penalty_die;
            for (let i = 0; i < Math.max(netBonus, netPenalty) * number(active.extra_tens_dice_per_die); i++)
                tens.push(rng.randrange(number(rule.digit_base)));
            const candidates = tens.map(tensValue => fromDigits(tensValue, units!));
            if (active.selected_tens === 'lowest')
                roll = Math.min(...candidates);
            else if (active.selected_tens === 'highest')
                roll = Math.max(...candidates);
            else
                return valueError(`unsupported tens selection: ${active.selected_tens}`);
        }
        const refs = ['percentile-check', 'success-levels', 'difficulty-levels', 'half-fifth-values'];
        if (netBonus || netPenalty)
            refs.splice(1, 0, 'roll-modifiers');
        return {
            ...this.resolve(roll, target, difficulty),
            roll,
            bonus: netBonus,
            penalty: netPenalty,
            unmodified_roll: units === null || !tens.length ? roll : fromDigits(tens[0], units),
            tens_values: tens,
            units,
            rule_refs: refs,
        };
    }
    /**
     * `bonus`/`penalty` are the investigator's side of the contest (§NN). The opponent's roll stays
     * plain: what the keeper declared is a fact about the investigator's attempt, not about both.
     */
    opposed(target: number, opponent: number, rng: PythonRandom, bonus = 0, penalty = 0): Row {
        const mine = this.check(target, 'regular', bonus, penalty, rng);
        const theirs = this.check(opponent, 'regular', 0, 0, rng);
        const myLevel = ranks[mine.outcome] || 0;
        const theirLevel = ranks[theirs.outcome] || 0;
        const winner = myLevel !== theirLevel ? myLevel > theirLevel ? 'investigator' : 'opponent'
            : !myLevel ? 'none' : target >= opponent ? 'investigator' : 'opponent';
        return {
            investigator_roll: mine,
            opponent_roll: theirs,
            winner
        };
    }
    combined(targets: Row[], roll: number, required: string, mode: string): Row {
        if (!['any', 'all'].includes(mode))
            valueError('combined_mode must be any or all');
        const comparisons = targets.map(target => {
            const settled = this.resolve(roll, number(target.value), required);
            return {
                label: string(target.label),
                value: number(target.value),
                required_target: settled.required_target,
                achieved_level: settled.achieved_level,
                outcome: settled.outcome,
                success: settled.success
            };
        });
        return {
            rule_ref: 'core.combined_roll',
            roll_count: 1,
            comparison_mode: mode,
            targets: comparisons,
            overall_success: mode === 'any' ? comparisons.some(target => target.success) : comparisons.every(target => target.success),
            development_tick_eligible: false,
            push_eligible: false,
            luck_spend_eligible: false
        };
    }
    spendLuck(result: Row, points: Integer, currentLuck: Integer, rollKind = 'skill'): Row {
        const forbidden: Row = {
            luck: 'luck_may_not_be_spent_on_luck_rolls',
            damage: 'luck_may_not_be_spent_on_damage_rolls',
            sanity: 'luck_may_not_be_spent_on_sanity_rolls',
            sanity_loss: 'luck_may_not_be_spent_on_sanity_loss_amount_rolls'
        };
        if (!['skill', ...Object.keys(forbidden)].includes(rollKind))
            valueError('roll_kind_must_be_a_supported_enum');
        if (forbidden[rollKind])
            valueError(forbidden[rollKind]);
        if (!integer(points))
            valueError('points_must_be_an_integer');
        if (!integer(currentLuck))
            valueError('current_luck_must_be_an_integer');
        if (currentLuck < 0)
            valueError('current_luck_must_be_non_negative');
        if (truth(result.pushed))
            valueError('luck_may_not_alter_a_pushed_roll');
        const required = ['roll', 'base_target', 'target', 'required_level', 'difficulty', 'required_target', 'effective_target', 'achieved_level', 'passed', 'success', 'surplus_levels', 'outcome'];
        const missing = required.filter(key => !Object.hasOwn(result, key)).sort();
        if (missing.length)
            valueError(`percentile_result_must_use_canonical_contract: ${missing.join(', ')}`);
        const expected = this.resolve(number(result.roll), number(result.base_target), string(result.required_level));
        if (required.some(key => key !== 'roll' && !equal(result[key], expected[key])))
            valueError('percentile_result_contradicts_canonical_contract');
        if (['critical', 'fumble'].includes(result.outcome))
            valueError('criticals_fumbles_malfunctions_cannot_be_bought_off');
        if (result.passed === true)
            valueError('luck_may_only_alter_a_failed_roll');
        if (points <= 0)
            valueError('points_must_be_positive');
        if (points > currentLuck)
            valueError('insufficient_luck');
        const roll = number(subtract(number(result.roll), points));
        if (roll <= 1)
            valueError('criticals_fumbles_malfunctions_cannot_be_bought_off');
        const output = clone(result);
        output.roll = roll;
        Object.assign(output, this.resolve(roll, number(result.base_target), string(result.required_level)));
        return Object.assign(output, {
            luck_spent: points,
            luck_remaining: subtract(currentLuck, points),
            improvement_tick_eligible: false,
            rule_ref: 'core.optional.spending_luck'
        });
    }
    async skillPushable(skill: any): Promise<boolean> {
        const name = string(skill || '').trim();
        if (!name)
            return true;
        const rule = this.data['pushed-roll'];
        const groups = new Set(array(rule.non_pushable_specialization_groups));
        if (array(rule.non_pushable_skill_names).includes(name) || groups.has(name))
            return false;
        try {
            const spec = await this.tables.skillByName(name);
            return typeof spec.group !== 'string' || !groups.has(spec.group);
        }
        catch {
            return true;
        }
    }
    async pushPolicy(outcome: any, pushed: boolean, skill?: any): Promise<string | null> {
        if (!await this.skillPushable(skill))
            return `${string(skill).trim()} is a combat skill and cannot be pushed; the next attempt is the next attack, not a pushed roll`;
        if (outcome !== 'failure')
            return 'only an ordinary failed original check may be pushed; fumbles are final';
        if (pushed)
            return 'the original check has already been pushed';
        return null;
    }
}
export function resourceDelta(resource: string, current: Integer, amount: Integer | string, options: {
    direction?: string;
    maximum?: Integer | null;
    rng: PythonRandom;
}): Row {
    const direction = options.direction ?? 'loss';
    const cap = options.maximum ?? null;
    if (!['hp', 'mp', 'luck', 'san'].includes(resource))
        valueError(`unknown resource '${resource}'; expected one of ['hp', 'luck', 'mp', 'san']`);
    if (!['loss', 'gain'].includes(direction))
        valueError("direction must be 'loss' or 'gain'");
    if (!integer(current) || current < 0)
        valueError('current must be a non-negative integer');
    if (cap !== null && (!integer(cap) || cap < 0))
        valueError('maximum must be a non-negative integer');
    let detail: Row | null = null;
    let value: Integer;
    if (typeof amount === 'string') {
        detail = rollExpression(amount, options.rng);
        value = Math.max(0, number(detail.total));
    }
    else if (!integer(amount))
        return valueError('amount must be an integer or a dice expression');
    else
        value = amount < 0 ? -amount : amount;
    const after = direction === 'loss' ? maximum(0, subtract(current, value)) : cap !== null ? minimum(cap, add(current, value)) : add(current, value);
    return {
        ruleset_id: 'coc7',
        resource,
        direction,
        amount: value,
        before: current,
        after,
        delta: subtract(after, current),
        maximum: cap,
        ...(detail ? {
            roll_detail: detail
        } : {})
    };
}
