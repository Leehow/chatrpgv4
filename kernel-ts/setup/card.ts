/** The numbers on the card, and who they belong to (contract §98).
 *
 *  A pin is a number somebody set — the player on the card, the model on the player's word. A soft
 *  allocation is what the machine placed when nobody said otherwise. The flow below keeps every pin
 *  where it was put, keeps the soft share it inherited wherever the budget still allows it, spends
 *  what is left only on skills that have never been allocated (or on everything, when asked to
 *  spread), and walks the biggest soft holder down when the pins no longer fit. The budget is a
 *  report: a pool spent past its total is a non-standard card, not a refused one. */
import { compareUnicode } from '../json.js';
import { array, row, entries, number, string, truth, type Row } from '../read/values.js';
import { Chargen, parseFormula, evaluateFormula } from './chargen.js';
import type { ResolvedDifficulty } from './difficulty.js';

export const PIN_ORIGINS = Object.freeze(['player', 'model']);
export const LIMIT_FIELDS = Object.freeze(['characteristic_min', 'characteristic_max', 'skill_cap', 'occupation_points', 'interest_points']);
export interface Pin { value: number; by: string; points?: number }
/** A skill pin is points, in the rulebook's two columns: occupation points and interest points
 *  above the base. The value follows the base (Dodge is half DEX), the way the worksheet does. */
export interface SkillPin { by: string; occupation: number; interest: number; value?: number }
export interface Pins { characteristics: Record<string, Pin>; skills: Record<string, SkillPin>; credit_rating?: Pin }
export interface Soft { occupation: Record<string, number>; interest: Record<string, number> }
export const emptyPins = (): Pins => ({characteristics: {}, skills: {}});
const sum = (values: Iterable<number>): number => [...values].reduce((total, value) => total + value, 0);

export interface FlowInput {
  characteristics: Row; occupation: string; era: string;
  occupationSkills: string[]; interestSkills: string[];
  /** Skills the player invented, with the base chance they gave them (§98 addendum). */
  customSkills: Array<{name: string; base: number}>;
  pins: Pins; previous: {soft: Soft; credit: number; occupationSkills: string[]; interestSkills: string[]} | null;
  relax: Row; difficulty: ResolvedDifficulty | null; spreadAll: boolean;
}
export interface Flow { skills: Row; credit: number; soft: Soft; ledger: Row; budget: Row; cap: number }

/** The bounds the card lives under: the rulebook's, or the relaxed ones the player unlocked. */
export function limitsOf(chargen: Chargen, sheet: Row, relax: Row): Row {
  const characteristics = row(sheet.characteristics);
  const bound = (key: string, fallback: number): number => Object.hasOwn(relax, key) ? Math.trunc(number(relax[key])) : fallback;
  const diff = chargen.difficultyPolicy(row(sheet.creation).difficulty ?? null);
  const [minimum, maximum] = chargen.creationBoundsFor(diff);
  const [, spec] = chargen.occupation(sheet.occupation);
  const occupation = evaluateFormula(parseFormula(spec.skill_point_formula || ''), characteristics);
  const interest = evaluateFormula(parseFormula(string(chargen.policy.formulas.personal_interest_points)), characteristics);
  return {characteristic_min: bound('characteristic_min', minimum), characteristic_max: bound('characteristic_max', maximum),
    skill_cap: bound('skill_cap', diff ? diff.effectiveCap(chargen.cap) : chargen.cap),
    occupation_points: bound('occupation_points', diff ? diff.adjustBudget('occupation', occupation.total) : occupation.total),
    interest_points: bound('interest_points', diff ? diff.adjustBudget('interest', interest.total) : interest.total),
    occupation_formula: occupation, interest_formula: interest,
    credit_rating_range: (truth(spec.credit_rating_range) ? array(spec.credit_rating_range) : [0, 0]).map(number),
    overridden: LIMIT_FIELDS.filter(key => Object.hasOwn(relax, key))};
}

export function flowSkills(chargen: Chargen, input: FlowInput): Flow {
  const {characteristics, pins, relax, difficulty: diff} = input;
  const bound = (key: string, fallback: number): number => Object.hasOwn(relax, key) ? Math.trunc(number(relax[key])) : fallback;
  const cap = bound('skill_cap', diff ? diff.effectiveCap(chargen.cap) : chargen.cap);
  const [occupationName, spec] = chargen.occupation(input.occupation);
  // The era's standard sheet, or the one sheet the table prints when the era has none (a 1975 card
  // is built on the modern finance period, which prints no sheet of its own) plus every skill the
  // catalog marks modern-only, so a modern card lists Computer Use and Electronics beside the rest.
  const sheets = row(chargen.skillsDoc.standard_sheet), standard = row(sheets[input.era]);
  const fallback = Object.keys(standard).length ? standard : row(Object.values(sheets)[0]);
  const sheetIds: string[] = Object.keys(fallback).length ? array(fallback.default_skill_ids).map(string) : [];
  if (!Object.keys(standard).length) for (const [name, spec] of entries(chargen.skillTable)) if (row(spec).modern_only === true && !sheetIds.includes(name)) sheetIds.push(name);
  const occupational = input.occupationSkills.filter(name => name !== 'Credit Rating');
  const listed: string[] = [];
  const custom = new Map(input.customSkills.map(skill => [skill.name, skill.base]));
  for (const name of [...sheetIds, ...occupational, ...input.interestSkills, ...custom.keys(), ...Object.keys(pins.skills)]) if (name !== 'Credit Rating' && !listed.includes(name)) listed.push(name);
  const base: Row = Object.fromEntries(listed.map(name => [name, custom.has(name) ? custom.get(name) : chargen.skillBase(name, characteristics)]));
  const creditRange = (truth(spec.credit_rating_range) ? array(spec.credit_rating_range) : [0, 0]).map(number);
  const notes: Row[] = [];
  let credit = pins.credit_rating ? pins.credit_rating.value : input.previous ? input.previous.credit : creditRange[0];
  // Credit Rating belongs to the trade: an inherited rating outside the new trade's range is moved
  // to the nearest bound and said; a pinned one is kept and said, and the card is non-standard.
  if (credit < creditRange[0] || credit > creditRange[1]) {
    if (pins.credit_rating) notes.push({code: 'credit_out_of_range', value: credit, range: creditRange, text: `Credit Rating ${credit} is outside the ${occupationName} range ${creditRange[0]}-${creditRange[1]}`});
    else { const moved = Math.min(Math.max(credit, creditRange[0]), creditRange[1]); notes.push({code: 'credit_moved', from: credit, to: moved, range: creditRange, text: `Credit Rating moved from ${credit} to ${moved}, the ${occupationName} range being ${creditRange[0]}-${creditRange[1]}`}); credit = moved; }
  }
  const occupationFormula = evaluateFormula(parseFormula(spec.skill_point_formula || ''), characteristics);
  const interestFormula = evaluateFormula(parseFormula(string(chargen.policy.formulas.personal_interest_points)), characteristics);
  const occupationTotal = bound('occupation_points', diff ? diff.adjustBudget('occupation', occupationFormula.total) : occupationFormula.total);
  const interestTotal = bound('interest_points', diff ? diff.adjustBudget('interest', interestFormula.total) : interestFormula.total);
  const policy = chargen.allocationPolicy(null), interestPolicy = chargen.allocationPolicy(null, 'interest_allocation');
  const isOccupational = new Set(occupational);
  // A pin is points in the two columns; the value is base plus both, so a skill whose base follows
  // a characteristic (Dodge is half DEX, Language (Own) is EDU) moves with it, the way the
  // worksheet does. Occupation points sit only on occupation skills; interest points on any skill.
  const pinPoints = (name: string, column: 'occupation' | 'interest'): number => Object.hasOwn(pins.skills, name) ? Math.max(0, number(pins.skills[name][column] ?? 0)) : 0;
  const pinValue = (name: string): number => Math.min(number(base[name]) + pinPoints(name, 'occupation') + pinPoints(name, 'interest'), Math.max(cap, number(base[name])));
  /** The list is the player's priority statement: when the members it already had come in a new
   *  order, the machine's share of that pool is re-spread from the front; an addition at the end
   *  only takes what is left. */
  const reordered = (order: string[], before: string[]): boolean => {
    const kept = before.filter(name => order.includes(name));
    return kept.some((name, index) => order.filter(entry => kept.includes(entry))[index] !== name);
  };
  const pool = (column: 'occupation' | 'interest', members: string[], order: string[], inherited: Record<string, number>, before: string[], total: number, tiers: number[]): [Record<string, number>, number, number] => {
    const previous = input.previous !== null && reordered(order, before) ? {} : inherited;
    const pinnedSpend = sum((column === 'occupation' ? members : listed).map(name => pinPoints(name, column)));
    const soft: Record<string, number> = {};
    for (const [name, points] of entries(previous)) if (members.includes(name) && !Object.hasOwn(pins.skills, name) && number(points) > 0) soft[name] = Math.min(number(points), Math.max(0, cap - number(base[name])));
    let budget = total - pinnedSpend, held = sum(Object.values(soft));
    if (held > budget) {
      // The pins no longer fit: the biggest soft holder gives way first, in a stable order (§96).
      for (const name of Object.keys(soft).sort((a, b) => soft[b] - soft[a] || compareUnicode(a, b))) {
        if (held <= budget) break;
        const give = Math.min(soft[name], held - Math.max(budget, 0)); soft[name] -= give; held -= give;
        if (soft[name] <= 0) delete soft[name];
      }
    }
    const remaining = budget - held;
    if (remaining > 0) {
      // Whatever the pins and the inherited share leave is spent, on every skill nobody pinned, in
      // list order and by tiers: an allocation already held only grows, never moves, and the only
      // points that stay unspent are the ones every soft skill's cap refuses (user, 2026-09-17:
      // a machine-built card is never handed over with points left on the table).
      const targets = order.filter(name => members.includes(name) && !Object.hasOwn(pins.skills, name));
      if (targets.length) {
        const values: Row = Object.fromEntries(targets.map(name => [name, number(base[name]) + (soft[name] ?? 0)]));
        const [added] = Chargen.spread(targets, new Set(targets), remaining, values, cap, tiers);
        for (const [name, points] of entries(added)) soft[name] = (soft[name] ?? 0) + number(points);
      }
    }
    const spent = pinnedSpend + sum(Object.values(soft));
    return [soft, spent, total - spent];
  };
  const others = listed.filter(name => !isOccupational.has(name));
  const [occupationSoft, occupationSpent, occupationUnspent] = pool('occupation', occupational, occupational, input.previous?.soft.occupation ?? {}, input.previous?.occupationSkills ?? [], occupationTotal - credit, policy.tiers);
  const [interestSoft, interestSpent, interestUnspent] = pool('interest', others, input.interestSkills.filter(name => !isOccupational.has(name)), input.previous?.soft.interest ?? {}, input.previous?.interestSkills ?? [], interestTotal, interestPolicy.tiers);
  const skills: Row = {};
  for (const name of listed) skills[name] = Object.hasOwn(pins.skills, name) ? pinValue(name) : number(base[name]) + (occupationSoft[name] ?? interestSoft[name] ?? 0);
  skills['Credit Rating'] = credit;
  // The two columns per skill, pinned or soft, so the card can draw the worksheet.
  const occupationPoints = (name: string): number => Object.hasOwn(pins.skills, name) ? pinPoints(name, 'occupation') : occupationSoft[name] ?? 0;
  const interestPoints = (name: string): number => Object.hasOwn(pins.skills, name) ? pinPoints(name, 'interest') : interestSoft[name] ?? 0;
  const above = (name: string): number => number(skills[name]) - number(base[name]);
  const ledger: Row = {
    standard_sheet: sheetIds.length ? `skills.standard_sheet.${input.era}` : null,
    cap: {value: cap, source: 'skills.guided_creation_policy.starting_skill_cap', ...(diff?.skillCap != null ? {difficulty: {skill_cap: diff.skillCap}} : {})},
    occupation: {id: occupationName, resolved: occupational, choices_pending: [], budget: {...occupationFormula, total: occupationTotal},
      credit_rating: {value: credit, range: creditRange, source: pins.credit_rating ? 'pinned' : 'occupations.credit_rating_range[0]'},
      points: Math.max(0, occupationTotal - credit), spent: occupationSpent, unspent: occupationUnspent,
      allocations: Object.fromEntries(occupational.filter(name => occupationPoints(name) > 0).map(name => [name, occupationPoints(name)])), allocation: policy.policy, reserved: []},
    interest: {budget: {...interestFormula, total: interestTotal}, pool: input.interestSkills, spent: interestSpent, unspent: interestUnspent,
      allocations: Object.fromEntries(listed.filter(name => interestPoints(name) > 0).map(name => [name, interestPoints(name)])), allocation: interestPolicy.policy, tiers: interestPolicy.tiers, source: interestPolicy.source},
    bases: Object.fromEntries(listed.map(name => [name, number(base[name])])),
    custom: input.customSkills.map(skill => skill.name),
  };
  void above;
  // The notes are structured, so the card draws them in the play language from fixed words and the
  // numbers, and `text` is the English the model reads (contract §23: no hand-written player text).
  if (occupationUnspent < 0) notes.push({code: 'overspent', pool: 'occupation', amount: -occupationUnspent, text: `occupation points overspent by ${-occupationUnspent}`});
  else if (occupationUnspent > 0) notes.push({code: 'points_left', pool: 'occupation', amount: occupationUnspent, text: `occupation points left: ${occupationUnspent}`});
  if (interestUnspent < 0) notes.push({code: 'overspent', pool: 'interest', amount: -interestUnspent, text: `interest points overspent by ${-interestUnspent}`});
  else if (interestUnspent > 0) notes.push({code: 'points_left', pool: 'interest', amount: interestUnspent, text: `interest points left: ${interestUnspent}`});
  for (const key of LIMIT_FIELDS) if (Object.hasOwn(relax, key)) notes.push({code: 'relaxed', limit: key, value: Math.trunc(number(relax[key])), text: `${key} relaxed to ${Math.trunc(number(relax[key]))}`});
  const overCap = listed.filter(name => number(skills[name]) > cap);
  if (overCap.length) notes.push({code: 'above_cap', cap, skills: overCap, text: `above the starting cap ${cap}: ${overCap.join(', ')}`});
  const legal = occupationUnspent >= 0 && interestUnspent >= 0 && !overCap.length && !LIMIT_FIELDS.some(key => Object.hasOwn(relax, key)) && !notes.some(note => note.code === 'credit_out_of_range');
  const pointBuy = Math.trunc(number(row(row(chargen.dice.generation_methods).point_buy_460).total_budget, 460));
  const characteristicSpent = sum(chargen.characteristics.map(abbr => number(characteristics[abbr])));
  const budget = {occupation: {total: occupationTotal, spent: credit + occupationSpent, unspent: occupationUnspent},
    interest: {total: interestTotal, spent: interestSpent, unspent: interestUnspent},
    characteristics: {total: pointBuy, spent: characteristicSpent, unspent: pointBuy - characteristicSpent, source: 'characteristic-dice.generation_methods.point_buy_460'},
    legal, notes};
  return {skills: Object.fromEntries(entries(skills).sort(([a], [b]) => compareUnicode(a, b))), credit, soft: {occupation: occupationSoft, interest: interestSoft}, ledger, budget, cap};
}
