/** Creation difficulty (contract §33): validated once on campaign.create, snapshot into
 *  campaign.json, resolved by Chargen on every build. Absent means the rulebook standard. */
import { RpcError } from '../errors.js';
import { isJsonObject } from '../json.js';
import { entries, integer, number, repr, row, string, type Row } from '../read/values.js';

/** The §33.1 preset knob bundles, product-versioned with the kernel. Re-specified 2026-09-12:
 *  the solo-COC research retired the uniform card multipliers — presets now name only budget,
 *  cap and luck knobs and never scale characteristics or LUCK values. */
export const PRESETS: Row = Object.freeze({
  extreme: Object.freeze({occupation_points: Object.freeze({multiplier: 0.75}), interest_points: Object.freeze({multiplier: 0.75}), skill_cap: 60}),
  hard: Object.freeze({}),
  normal: Object.freeze({occupation_points: Object.freeze({multiplier: 1.25}), interest_points: Object.freeze({multiplier: 1.25})}),
  easy: Object.freeze({occupation_points: Object.freeze({multiplier: 1.5}), interest_points: Object.freeze({multiplier: 1.5}), luck: Object.freeze({dice: '2D6+6'})}),
});
const DICE_GRAMMAR = /^(\d{1,2})D(4|6|8|10|12|20|100)(\+(\d{1,2}))?$/i;
/** Rulebook pool expressions exactly as keyed in characteristic-dice.json (§33.3). */
const POOL_KEYS = Object.freeze(['3D6', '2D6+6']);
const CUSTOM_KNOBS = Object.freeze(['characteristic_dice', 'characteristic_min', 'characteristic_max', 'luck', 'occupation_points', 'interest_points', 'skill_cap']);
const TOP_KEYS = Object.freeze(['mode', 'preset', 'multiplier', 'custom']);

function invalid(field: string, message: string, value: any): never {
  throw new RpcError('invalid_params', message, {details: {field, value}});
}

export interface DiceExpression { n: number; m: number; k: number; expression: string; }

/** The closed dice grammar of §33.3: NdM(+K), N 1-99, M one of the rulebook die sizes. */
export function parseDiceExpression(value: any, field: string): DiceExpression {
  const text = typeof value === 'string' ? value.trim().toUpperCase() : '';
  const match = DICE_GRAMMAR.exec(text);
  if (!match || Number(match[1]) < 1)
    invalid(field, `${field} must be a dice expression like 2D6 or 3D6+2 (N 1-99, M one of 4/6/8/10/12/20/100, optional +K 1-99)`, value);
  return {n: Number(match[1]), m: Number(match[2]), k: Number(match[4] ?? 0), expression: text};
}

function validateBound(key: string, value: any): void {
  if (!integer(value) || number(value) % 5 !== 0 || number(value) < 5 || number(value) > 450)
    invalid(`difficulty.custom.${key}`, `${key} must be a multiple of 5 between 5 and 450`, value);
}

function validateBudget(key: string, value: any): void {
  const field = `difficulty.custom.${key}`;
  if (!isJsonObject(value)) invalid(field, `${key} must be an object holding exactly one of multiplier or fixed`, value);
  const keys = Object.keys(value);
  if (keys.some(name => !['multiplier', 'fixed'].includes(name)) || keys.length !== 1)
    invalid(field, `${key} holds exactly one of multiplier or fixed`, value);
  if (Object.hasOwn(value, 'multiplier')) {
    const multiplier = value.multiplier;
    if (typeof multiplier !== 'number' || !Number.isFinite(multiplier) || multiplier < 0.25 || multiplier > 8)
      invalid(`${field}.multiplier`, `${key}.multiplier must be a number between 0.25 and 8`, multiplier);
  } else {
    const fixed = value.fixed;
    if (!integer(fixed) || number(fixed) < 0 || number(fixed) > 2000)
      invalid(`${field}.fixed`, `${key}.fixed must be an integer between 0 and 2000`, fixed);
  }
}

function validateCustom(custom: Row): void {
  for (const key of Object.keys(custom))
    if (!CUSTOM_KNOBS.includes(key)) invalid(`difficulty.custom.${key}`, `unknown difficulty knob ${repr(key)}; the custom knobs are ${repr([...CUSTOM_KNOBS])}`, custom[key]);
  if (Object.hasOwn(custom, 'characteristic_dice')) {
    const map = custom.characteristic_dice;
    if (!isJsonObject(map) || !Object.keys(map).length)
      invalid('difficulty.custom.characteristic_dice', 'characteristic_dice maps a rulebook pool expression to its replacement', map);
    for (const [pool, expression] of entries(map)) {
      if (!POOL_KEYS.includes(pool))
        invalid('difficulty.custom.characteristic_dice', `characteristic_dice keys are the rulebook pool expressions ${repr([...POOL_KEYS])} exactly as keyed in characteristic-dice.json`, pool);
      parseDiceExpression(expression, 'difficulty.custom.characteristic_dice');
    }
  }
  if (Object.hasOwn(custom, 'characteristic_min')) validateBound('characteristic_min', custom.characteristic_min);
  if (Object.hasOwn(custom, 'characteristic_max')) validateBound('characteristic_max', custom.characteristic_max);
  const minimum = number(custom.characteristic_min, 15), maximum = number(custom.characteristic_max, 90);
  if (minimum >= maximum)
    invalid('difficulty.custom.characteristic_min', `characteristic_min (${minimum}) must stay below characteristic_max (${maximum})`, {minimum, maximum});
  if (Object.hasOwn(custom, 'luck')) {
    const luck = custom.luck, field = 'difficulty.custom.luck';
    if (!isJsonObject(luck)) invalid(field, 'luck must be an object holding exactly one of dice or fixed', luck);
    const keys = Object.keys(luck);
    if (keys.some(name => !['dice', 'fixed'].includes(name)) || keys.length !== 1)
      invalid(field, 'luck holds exactly one of dice or fixed', luck);
    if (Object.hasOwn(luck, 'dice')) parseDiceExpression(luck.dice, `${field}.dice`);
    else if (!integer(luck.fixed) || number(luck.fixed) % 5 !== 0 || number(luck.fixed) < 5 || number(luck.fixed) > 450)
      invalid(`${field}.fixed`, 'luck.fixed must be a multiple of 5 between 5 and 450', luck.fixed);
  }
  if (Object.hasOwn(custom, 'occupation_points')) validateBudget('occupation_points', custom.occupation_points);
  if (Object.hasOwn(custom, 'interest_points')) validateBudget('interest_points', custom.interest_points);
  if (Object.hasOwn(custom, 'skill_cap') && (!integer(custom.skill_cap) || number(custom.skill_cap) < 1 || number(custom.skill_cap) > 500))
    invalid('difficulty.custom.skill_cap', 'skill_cap must be an integer between 1 and 500', custom.skill_cap);
}

/** campaign.create validation (§33.1/§33.3): closed enums, closed dice grammar, numeric ranges.
 *  Throws invalid_params with details.field naming the offender; the value itself is stored verbatim.
 *  The kernel's own resolved record (sheet.creation.difficulty, §33.4) is accepted beside the raw
 *  snapshot shape: a preset record is {mode, preset, custom: {}} and carries no multiplier — a
 *  preset is a knob bundle, never a uniform card multiplier. */
export function validateDifficulty(value: any): void {
  if (!isJsonObject(value)) invalid('difficulty', 'difficulty must be {mode: "preset", preset} or {mode: "custom", custom: {...}}', value);
  for (const key of Object.keys(value))
    if (!TOP_KEYS.includes(key)) invalid(`difficulty.${key}`, `unknown difficulty field ${repr(key)}`, value[key]);
  if (value.mode === 'preset') {
    if (typeof value.preset !== 'string' || !Object.hasOwn(PRESETS, value.preset))
      invalid('difficulty.preset', `preset must be one of ${repr(Object.keys(PRESETS))}`, value.preset);
    if (Object.hasOwn(value, 'multiplier'))
      invalid('difficulty.multiplier', 'a preset carries no multiplier: presets are knob bundles, never uniform card multipliers (§33.1)', value.multiplier);
    if (Object.hasOwn(value, 'custom') && (!isJsonObject(value.custom) || Object.keys(value.custom).length))
      invalid('difficulty.custom', 'a preset difficulty carries no custom knobs', value.custom);
  } else if (value.mode === 'custom') {
    if (Object.hasOwn(value, 'preset')) invalid('difficulty.preset', 'a custom difficulty carries no preset', value.preset);
    if (Object.hasOwn(value, 'multiplier')) invalid('difficulty.multiplier', 'a custom difficulty carries no multiplier', value.multiplier);
    const custom = Object.hasOwn(value, 'custom') ? value.custom : {};
    if (!isJsonObject(custom)) invalid('difficulty.custom', 'custom must be an object of difficulty knobs', custom);
    validateCustom(custom);
  } else invalid('difficulty.mode', 'difficulty.mode must be preset or custom', value.mode);
}

export interface BudgetKnob { multiplier: number | null; fixed: number | null; }

/** A validated difficulty snapshot readied for chargen arithmetic. */
export class ResolvedDifficulty {
  constructor(readonly isPreset: boolean, readonly record: Row,
    readonly bounds: [number, number], readonly diceReplacements: Row, readonly replacementRanges: Row,
    readonly luckDice: string | null, readonly luckFixed: number | null,
    readonly occupation: BudgetKnob | null, readonly interest: BudgetKnob | null, readonly skillCap: number | null) {}
  /** The starting skill cap: skill_cap replaces it, else the rulebook value (§33.2/§33.3). */
  effectiveCap(base: number): number { return this.skillCap ?? base; }
  /** multiplier multiplies the evaluated formula budget (Math.round); fixed replaces it flat (§33.3). */
  adjustBudget(kind: 'occupation' | 'interest', total: number): number {
    const knob = this[kind];
    if (!knob) return total;
    return knob.fixed != null ? knob.fixed : Math.round(total * number(knob.multiplier));
  }
}

/** A budget knob ({multiplier} or {fixed}) from a preset bundle or the custom object. */
function budgetKnob(source: Row, key: string): BudgetKnob | null {
  const knob = source[key];
  if (!isJsonObject(knob)) return null;
  const held: Row = knob as Row;
  return {multiplier: held.multiplier ?? null, fixed: held.fixed ?? null};
}

/** Resolve a stored snapshot (or an already-resolved sheet record, which carries the same mode/custom shape)
 *  into chargen arithmetic. Returns null when there is no difficulty — the rulebook standard, bit-identical.
 *  Presets keep the rulebook 15/90 creation bounds and never scale a roll (§33.2). */
export function resolveDifficulty(value: Row | null): ResolvedDifficulty | null {
  if (!isJsonObject(value)) return null;
  if (value.mode === 'preset') {
    const preset = string(value.preset), knobs = row(PRESETS[preset]), luck = row(knobs.luck);
    return new ResolvedDifficulty(true,
      {mode: 'preset', preset, custom: {}},
      [15, 90], {}, {},
      Object.hasOwn(luck, 'dice') ? parseDiceExpression(luck.dice, 'difficulty.preset.luck.dice').expression : null,
      null,
      budgetKnob(knobs, 'occupation_points'), budgetKnob(knobs, 'interest_points'),
      Object.hasOwn(knobs, 'skill_cap') ? number(knobs.skill_cap) : null);
  }
  const custom = row(value.custom), replacements: Row = {}, ranges: Row = {};
  for (const [pool, expression] of entries(row(custom.characteristic_dice))) {
    const dice = parseDiceExpression(expression, 'difficulty.custom.characteristic_dice');
    replacements[pool] = dice.expression;
    ranges[pool] = [(dice.n + dice.k) * 5, (dice.n * dice.m + dice.k) * 5];
  }
  const luck = row(custom.luck);
  return new ResolvedDifficulty(false,
    {mode: 'custom', custom: JSON.parse(JSON.stringify(custom))},
    [number(custom.characteristic_min, 15), number(custom.characteristic_max, 90)],
    replacements, ranges,
    Object.hasOwn(luck, 'dice') ? parseDiceExpression(luck.dice, 'difficulty.custom.luck.dice').expression : null,
    Object.hasOwn(luck, 'fixed') ? number(luck.fixed) : null,
    budgetKnob(custom, 'occupation_points'), budgetKnob(custom, 'interest_points'),
    Object.hasOwn(custom, 'skill_cap') ? number(custom.skill_cap) : null);
}
