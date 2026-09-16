/** The existing table-driven character arithmetic; semantic choices remain inputs. */
import { PythonRandom } from '../random.js';
import { compareUnicode, isJsonObject } from '../json.js';
import { RuleTables } from '../rules/tables.js';
import { array, row, entries, number, integer, normalize, kebab, string, truth, repr, clone, type Row } from '../read/values.js';
import { ResolvedDifficulty, resolveDifficulty, validateDifficulty } from './difficulty.js';
import { specializationIdentity } from '../rules/skills.js';

export const METHODS = Object.freeze(['quick_fire', 'rolled']);
export const ALLOCATION_POLICIES = Object.freeze(['spread', 'fill']);
export class ChargenError extends Error {
  constructor(readonly stage: string, message: string, readonly expected: any = null) {
    super(message); this.name = 'ChargenError';
  }
}
function valueError(message: string): never { const error = new Error(message); error.name = 'ValueError'; throw error; }
function get(value: Row, key: string): any {
  if (Object.hasOwn(value, key)) return value[key];
  const error = new Error(repr(key)); error.name = 'KeyError'; throw error;
}
const sum = (items: Iterable<number>): number => [...items].reduce((total, value) => total + value, 0);

export function parseFormula(formula: any): Row {
  const text = string(truth(formula) ? formula : ''), at = text.indexOf('either');
  const head = at < 0 ? text : text.slice(0, at), tail = at < 0 ? '' : text.slice(at + 6);
  const terms = (value: string): Array<[string, number]> => [...value.matchAll(/([A-Z]{3})\s*\*\s*(\d+)/g)].map(match => [match[1], Number(match[2])]);
  const base = terms(head), alternatives = terms(tail).map(term => [term]);
  if (!base.length && !alternatives.length) throw new ChargenError('formula', `skill point formula ${repr(formula)} has no ABBR*n term`);
  return {formula: text, base, alternatives};
}
export function evaluateFormula(parsed: Row, characteristics: Row): Row {
  const evaluate = (terms: Array<[string, number]>): number => sum(terms.map(([abbr, multiplier]) => Math.trunc(number(get(characteristics, abbr))) * multiplier));
  let total = evaluate(parsed.base), chosen: Array<[string, number]> | null = null, best: number | null = null;
  for (const alternative of parsed.alternatives) {
    const value = evaluate(alternative);
    if (best === null || value > best) { best = value; chosen = alternative; }
  }
  if (best !== null) total += best;
  const display = (terms: Array<[string, number]>): string[] => terms.map(([abbr, multiplier]) => `${abbr}*${multiplier}`);
  return {formula: parsed.formula, total, terms: display(parsed.base), alternative: chosen?.length ? display(chosen) : null};
}
function formulaCharacteristics(parsed: Row): string[] {
  return [...new Set<string>([...parsed.base, ...parsed.alternatives.flat()].map(([abbr]) => abbr))];
}
function creationRoll(expression: string, rng: PythonRandom): Row {
  const normalized = expression.trim().toUpperCase().replaceAll(' ', ''), rolls: number[] = [];
  const tokens = normalized.replaceAll('-', '+-').split('+').filter(Boolean);
  let total = 0, dice = 0;
  for (const token of tokens) {
    const sign = token.startsWith('-') ? -1 : 1, body = sign < 0 ? token.slice(1) : token;
    const match = /^(\d+)D(\d+)$/.exec(body);
    if (match) {
      const count = Number(match[1]), sides = Number(match[2]);
      if (count < 1 || sides < 1) valueError(`unsupported dice expression: ${expression}`);
      const faces = Array.from({length: count}, () => rng.randint(1, sides));
      rolls.push(...faces); total += sign * sum(faces); dice++;
    } else if (/^\d+$/.test(body)) total += sign * Number(body);
    else valueError(`unsupported dice expression: ${expression}`);
  }
  if (!dice) valueError(`unsupported dice expression: ${expression}`);
  return {expression: normalized, rolls, total};
}

export class Chargen {
  private constructor(readonly tables: RuleTables, readonly policy: Row, readonly dice: Row,
    readonly ageRules: Row, readonly derivedRules: Row, readonly skillsDoc: Row,
    readonly occupationTable: Row, readonly skillTable: Row, readonly groups: Row) {}
  static async create(tables: RuleTables, policy: Row): Promise<Chargen> {
    const [dice, ages, derived, skills, occupations, skillTable, groups] = await Promise.all([
      tables.load('characteristic-dice'), tables.load('age-adjustments'), tables.load('derived-attributes'), tables.load('skills'),
      tables.occupationsTable(), tables.skillsTable(), tables.skillSpecializationGroups(),
    ]);
    return new Chargen(tables, policy, row(dice), row(ages), row(derived), row(skills), occupations, skillTable, groups);
  }
  get characteristics(): string[] { return entries(this.dice.characteristics).map(([key]) => key).filter(key => key !== 'Luck'); }
  get multiplier(): number { return Math.trunc(number(this.dice.multiplier)); }
  get cap(): number { return Math.trunc(number(this.skillsDoc.guided_creation_policy.starting_skill_cap)); }
  /** Rulebook creation floor/ceiling, recorded by the point-buy table; the manual override reads them (§23.4). */
  get creationBounds(): [number, number] {
    const block = row(row(this.dice.generation_methods).point_buy_460);
    return [Math.trunc(number(block.minimum, 15)), Math.trunc(number(block.maximum, 90))];
  }
  /** The campaign's creation-difficulty snapshot (contract §33) readied for arithmetic, or null for the
   *  rulebook standard. Re-validated on every read — a corrupted snapshot fails loudly, never coerces.
   *  Replacement pools that match nothing in the dice table are dropped from the record. */
  difficultyPolicy(raw: any): ResolvedDifficulty | null {
    if (raw == null) return null;
    validateDifficulty(raw);
    const diff = resolveDifficulty(raw)!;
    if (!diff || !Object.keys(diff.diceReplacements).length) return diff;
    const pools = new Set(this.dicePools().map(([key]) => key));
    for (const key of Object.keys(diff.diceReplacements))
      if (!pools.has(key)) { delete diff.diceReplacements[key]; delete diff.replacementRanges[key]; }
    const recorded = row(diff.record.custom).characteristic_dice;
    if (isJsonObject(recorded)) {
      for (const key of Object.keys(recorded)) if (!pools.has(key)) delete recorded[key];
      if (!Object.keys(recorded).length) delete diff.record.custom.characteristic_dice;
    }
    return diff;
  }
  /** The creation bounds under a difficulty: the rulebook 15/90 for presets, custom min/max for custom (§33.2). */
  creationBoundsFor(diff: ResolvedDifficulty | null): [number, number] { return diff ? diff.bounds : this.creationBounds; }
  /** The bounds one characteristic obeys: a replaced pool binds its own dice range in place of the creation
   *  bounds (§33.3). LUCK is not a pool characteristic — generation never replaces its dice, so manual edits
   *  keep the creation bounds. */
  characteristicBounds(diff: ResolvedDifficulty | null, abbr: string): [number, number] {
    if (diff && abbr !== 'LUCK') {
      const spec = this.dice.characteristics[abbr];
      if (spec) {
        const pool = string(spec.dice).trim().toUpperCase().replaceAll(' ', '');
        if (diff.replacementRanges[pool]) return diff.replacementRanges[pool];
      }
    }
    return this.creationBoundsFor(diff);
  }
  occupations(): Row[] {
    return entries(this.occupationTable).map(([id, spec]) => ({id, name: id, skill_point_formula: spec.skill_point_formula ?? null,
      occupational_skills: [...array(spec.occupational_skills)], credit_rating_range: [...array(spec.credit_rating_range)], tags: [...array(spec.tags)]}));
  }
  occupation(id: any): [string, Row] {
    if (typeof id === 'string' && Object.hasOwn(this.occupationTable, id)) return [id, this.occupationTable[id]];
    const key = normalize(string(truth(id) ? id : ''));
    const found = entries(this.occupationTable).find(([name]) => normalize(name) === key);
    if (found) return found;
    throw new ChargenError('occupation', `unknown occupation id ${repr(id)}`, {options: Object.keys(this.occupationTable).sort(compareUnicode)});
  }
  /** Characteristics grouped by the die that makes them; a pool assignment never crosses groups. */
  dicePools(): Array<[string, string[]]> {
    const pools: Array<[string, string[]]> = [];
    for (const abbr of this.characteristics) {
      const expression = string(this.dice.characteristics[abbr].dice).trim().toUpperCase().replaceAll(' ', '');
      const pool = pools.find(([key]) => key === expression);
      if (pool) pool[1].push(abbr); else pools.push([expression, [abbr]]);
    }
    return pools;
  }
  /** What this person is notably good or poor at, already read into characteristics by the
   *  setup model, carrying whether the player said it or the model read it off the concept. */
  aptitude(value: any): Row | null {
    if (value == null) return null;
    const declared = row(value), strong = array(declared.strong).map(string), weak = array(declared.weak).map(string);
    if (!strong.length && !weak.length) return null;
    const block = row(this.policy.aptitude), origins = array(block.origins).map(string), origin = declared.origin;
    if (typeof origin !== 'string' || !origins.includes(origin)) throw new ChargenError('aptitude', `aptitude.origin must say who named this: ${repr(origins)}`, {options: origins});
    const known = this.characteristics, unknown = [...strong, ...weak].filter(abbr => !known.includes(abbr));
    if (unknown.length) throw new ChargenError('aptitude', `unknown characteristics ${repr(unknown)}`, {options: known});
    const both = strong.filter(abbr => weak.includes(abbr));
    if (both.length) throw new ChargenError('aptitude', `${repr(both)} cannot be both notably strong and notably weak`, {strong, weak});
    if (new Set(strong).size !== strong.length || new Set(weak).size !== weak.length) throw new ChargenError('aptitude', 'name each characteristic at most once', {strong, weak});
    const limit = Math.trunc(number(block.concept_limit));
    if (origin === 'concept' && (strong.length > limit || weak.length > limit))
      throw new ChargenError('aptitude', `an emphasis read from the concept may name at most ${limit} strong and ${limit} weak; a longer one has to come from the player`,
        {origin, concept_limit: limit, strong, weak});
    return {strong, weak, origin};
  }
  quickFire(priority: string[], diff: ResolvedDifficulty | null = null): Row {
    const values: Row = {}, array = this.dice.generation_methods.quick_fire_array.array.map((value: any) => Math.trunc(number(value)));
    const order = priority.filter(abbr => this.characteristics.includes(abbr));
    order.push(...this.characteristics.filter(abbr => !order.includes(abbr)));
    if (order.length !== array.length) valueError('zip() argument 2 has a different length than argument 1');
    order.forEach((abbr, index) => { values[abbr] = array[index]; });
    return {method: 'quick_fire', values, assignment_order: order, array,
      source: 'characteristic-dice.generation_methods.quick_fire_array'};
  }
  rolled(rng: PythonRandom, aptitude: Row | null = null, diff: ResolvedDifficulty | null = null): Row {
    const rolled: Row = {};
    for (const abbr of this.characteristics) {
      const pool = string(this.dice.characteristics[abbr].dice).trim().toUpperCase().replaceAll(' ', '');
      rolled[abbr] = creationRoll(diff?.diceReplacements[pool] ?? string(this.dice.characteristics[abbr].dice), rng);
    }
    const held = aptitude ? this.assign(rolled, aptitude) : Object.fromEntries(this.characteristics.map(abbr => [abbr, abbr]));
    const values: Row = {}, rolls: Row = {};
    for (const abbr of this.characteristics) {
      const roll = rolled[held[abbr]];
      values[abbr] = roll.total * this.multiplier;
      rolls[abbr] = {dice: roll.expression, faces: roll.rolls, total: roll.total};
    }
    const generated: Row = {method: 'rolled', values, rolls, multiplier: this.multiplier,
      ...(diff && Object.keys(diff.diceReplacements).length ? {replaced_dice: clone(diff.diceReplacements)} : {}),
      source: 'characteristic-dice.characteristics'};
    if (!aptitude) return generated;
    const direction = (abbr: string): string | null => array(aptitude.strong).includes(abbr) ? 'strong' : array(aptitude.weak).includes(abbr) ? 'weak' : null;
    return {...generated, method: 'rolled_pool_assignment', aptitude,
      assignment: this.characteristics.map(abbr => ({characteristic: abbr, rolled_for: held[abbr], direction: direction(abbr)})),
      source: 'characteristic-dice.generation_methods.rolled_pool_assignment'};
  }
  /** Which slot's result each characteristic ends up holding; the multiset of results is unchanged. */
  private assign(rolled: Row, aptitude: Row): Row {
    const held: Row = {};
    for (const [, pool] of this.dicePools()) {
      const available = [...pool], take = (best: (a: number, b: number) => boolean) => (abbr: string) => {
        const chosen = available.reduce((carry, slot) => best(number(rolled[slot].total), number(rolled[carry].total)) ? slot : carry);
        available.splice(available.indexOf(chosen), 1); held[abbr] = chosen;
      };
      array(aptitude.strong).filter(abbr => pool.includes(abbr)).forEach(take((a, b) => a > b));
      array(aptitude.weak).filter(abbr => pool.includes(abbr)).forEach(take((a, b) => a < b));
      const rest = pool.filter(abbr => !Object.hasOwn(held, abbr));
      for (const abbr of rest) if (available.includes(abbr)) { available.splice(available.indexOf(abbr), 1); held[abbr] = abbr; }
      for (const abbr of rest) if (!Object.hasOwn(held, abbr)) held[abbr] = available.shift() as string;
    }
    return held;
  }
  luck(rng: PythonRandom, keepHighest: number, diff: ResolvedDifficulty | null = null): Row {
    if (diff?.luckFixed != null)
      return {value: diff.luckFixed, dice: null, attempts: [], keep_highest: keepHighest, multiplier: this.multiplier,
        fixed: true, source: 'campaign.json difficulty (contract §33)'};
    const expression = diff?.luckDice ?? string(this.dice.characteristics.Luck.dice), attempts: Row[] = [];
    for (let i = 0; i < Math.max(1, keepHighest); i++) { const roll = creationRoll(expression, rng); attempts.push({faces: roll.rolls, total: roll.total}); }
    const raw = Math.max(...attempts.map(attempt => attempt.total)) * this.multiplier;
    return {value: raw, dice: expression.toUpperCase(), attempts,
      keep_highest: keepHighest, multiplier: this.multiplier,
      source: diff?.luckDice ? 'campaign.json difficulty (contract §33)' : 'characteristic-dice.characteristics.Luck'};
  }
  ageBracket(age: any): Row {
    const lo = number(this.ageRules.minimum_age), hi = number(this.ageRules.maximum_age);
    if (!integer(age) || number(age) < lo || number(age) > hi) throw new ChargenError('age', `age must be an integer between ${lo} and ${hi}`, {minimum_age: lo, maximum_age: hi});
    const found = this.ageRules.brackets.find((item: Row) => number(item.min_age) <= number(age) && number(age) <= number(item.max_age));
    if (found) return found;
    throw new ChargenError('age', `no age bracket for ${age}: ${string(this.ageRules.unlisted_age_policy)}`, {brackets: this.ageRules.brackets.map((item: Row) => item.key)});
  }
  applyAge(characteristics: Row, age: any, rng: PythonRandom): Row {
    const bracket = this.ageBracket(age), adjusted = {...characteristics};
    const trace: Row = {bracket: bracket.key, source: 'age-adjustments.brackets'};
    const edu = number(bracket.edu_reduction), app = number(bracket.app_reduction);
    adjusted.EDU = Math.max(0, adjusted.EDU - edu); adjusted.APP = Math.max(0, adjusted.APP - app);
    trace.edu_reduction = edu; trace.app_reduction = app;
    const total = number(bracket.characteristic_reduction_total), choices = array(bracket.characteristic_reduction_choices).map(string), reductions: Row[] = [];
    if (total && choices.length) {
      const base = Math.floor(total / choices.length), extra = total % choices.length;
      choices.forEach((abbr, index) => { const amount = base + (index < extra ? 1 : 0); if (amount > 0) { adjusted[abbr] = Math.max(0, adjusted[abbr] - amount); reductions.push({characteristic: abbr, amount}); } });
    }
    trace.characteristic_reductions = reductions;
    const checks: Row[] = [], eduMax = number(this.ageRules.edu_maximum, 99);
    for (let i = 0; i < number(bracket.edu_improvement_checks); i++) {
      const check = creationRoll(string(this.ageRules.edu_improvement_die), rng), item: Row = {roll: check.total, edu: adjusted.EDU};
      if (check.total > adjusted.EDU) { const gain = creationRoll(string(this.ageRules.edu_improvement_amount), rng); item.improvement = gain.total; adjusted.EDU = Math.min(eduMax, adjusted.EDU + gain.total); }
      checks.push(item);
    }
    trace.edu_improvement_checks = checks; trace.mov_penalty = number(bracket.mov_penalty);
    trace.luck_rolls_keep_highest = Math.max(1, number(bracket.luck_rolls_keep_highest, 1));
    return {values: adjusted, trace};
  }
  async movement(characteristics: Row, penalty: number): Promise<Row> {
    const table = row(await this.tables.load('movement-rate')), siz = characteristics.SIZ;
    const relation = (value: number): string => value < siz ? 'less_than' : value > siz ? 'greater_than' : 'equal';
    for (const item of table.rules) {
      if (!['any', relation(characteristics.STR)].includes(item.str_relation_to_siz) || !['any', relation(characteristics.DEX)].includes(item.dex_relation_to_siz)) continue;
      const base = number(item.base_mov);
      return {mov: Math.max(number(row(table.age_penalty).minimum_mov), base - penalty), base_mov: base, rule: item.key, age_mov_penalty: penalty, source: 'movement-rate.rules'};
    }
    throw new ChargenError('derived', 'no movement-rate rule matched');
  }
  async derive(characteristics: Row, penalty: number): Promise<Row> {
    const hp = this.derivedRules.hit_points, mp = this.derivedRules.magic_points, san = this.derivedRules.sanity;
    const db = await this.tables.damageBonusBuild(characteristics.STR, characteristics.SIZ), mov = await this.movement(characteristics, penalty);
    return {values: {HP: Math.floor(sum(hp.sources.map((source: string) => characteristics[source])) / number(hp.divisor)), SAN: characteristics[san.source],
      MP: Math.floor(characteristics[mp.source] / number(mp.divisor)), MOV: mov.mov, DB: db.damage_bonus, BUILD: db.build},
      trace: {HP: `derived-attributes.hit_points (${hp.sources.join('+')})/${hp.divisor}`, SAN: `derived-attributes.sanity (${san.source})`,
        MP: `derived-attributes.magic_points (${mp.source})/${mp.divisor}`, MOV: `${mov.source} ${mov.rule} - age penalty ${penalty}`,
        DB: `damage-bonus-build STR+SIZ=${db.total}`, BUILD: `damage-bonus-build STR+SIZ=${db.total}`, LUCK: 'characteristic-dice.characteristics.Luck'}};
  }
  /** The catalog row an occupation's phrase names. An occupation that names a specialization
   *  (`Pilot (aircraft)`, `Science (Physics)`) names a real skill even where the catalog prints no
   *  row of its own for it: the rules table declares the group's specializations, so the phrase
   *  resolves and the specialization reaches the card, instead of being dropped into
   *  `choices_pending` and leaving the card's blank group row to stand in for it (§52). */
  catalogName(phrase: string): string | null {
    const key = normalize(phrase);
    return Object.keys(this.skillTable).find(name => normalize(name) === key)
      ?? specializationIdentity(this.groups, this.skillTable, phrase)?.canonical ?? null;
  }
  skillBase(name: string, characteristics: Row): number {
    const specialization = Object.hasOwn(this.skillTable, name) ? null : specializationIdentity(this.groups, this.skillTable, name);
    const base = name.startsWith('Language (Other: ') && name.endsWith(')') ? this.groups['Language (Other)'].base_chance
      : specialization ? specialization.base : get(this.skillTable, name).base_chance;
    if (integer(base) || typeof base === 'boolean') return number(base);
    const text = string(base);
    return text.startsWith('half_') ? Math.floor(number(get(characteristics, text.slice(5))) / 2) : Math.trunc(number(get(characteristics, text)));
  }
  allocationPolicy(name: any, field = 'allocation'): Row {
    const block = row(this.policy[field]), policy = name == null ? block.default : name;
    if (!ALLOCATION_POLICIES.includes(policy)) throw new ChargenError(field, `${field} must be one of ('spread', 'fill')`, {options: [...ALLOCATION_POLICIES], default: block.default ?? null});
    const tiers = array(block.tiers);
    if (!tiers.every(integer)) throw new ChargenError(field, `${field}.tiers must be integers`, {tiers});
    return {policy: string(policy), tiers: tiers.map(number), source: `steps.json create-investigator.${field}`};
  }
  static spread(slots: string[], resolved: Set<string>, budget: number, values: Row, cap: number, tiers: number[]): [Row, Row[]] {
    const allocations: Row = {}, reserved: Row = {};
    for (const slot of slots) (resolved.has(slot) ? allocations : reserved)[slot] = 0;
    let remaining = budget;
    for (const target of [...tiers.filter(tier => tier < cap).map(tier => Math.min(tier, cap)), cap]) {
      for (const slot of slots) {
        if (remaining <= 0) break;
        const resolvedSlot = Object.hasOwn(allocations, slot), need = target - (resolvedSlot ? values[slot] + allocations[slot] : reserved[slot]);
        if (need <= 0) continue;
        const give = Math.min(need, remaining); (resolvedSlot ? allocations : reserved)[slot] += give; remaining -= give;
      }
    }
    return [Object.fromEntries(entries(allocations).filter(([, points]) => points > 0)), entries(reserved).filter(([, points]) => points > 0).map(([phrase, points]) => ({for: phrase, points}))];
  }
  static allocate(skills: string[], budget: number, values: Row, cap: number): Row {
    const allocations: Row = Object.fromEntries(skills.map(skill => [skill, 0])); let remaining = budget;
    while (remaining > 0 && skills.length) {
      let progressed = false;
      for (const skill of skills) {
        if (remaining <= 0) break;
        if (values[skill] + allocations[skill] >= cap) continue;
        allocations[skill]++; remaining--; progressed = true;
      }
      if (!progressed) break;
    }
    return Object.fromEntries(entries(allocations).filter(([, points]) => points > 0));
  }
  async build(options: {investigatorId: string; name: string; occupationId: any; concept: string | null; age: any; sex: any; method: any; seed: string; era: string; sourceEra?: string | null; difficulty?: any; allocation?: any; interestAllocation?: any; aptitude?: any; occupationSkills?: string[]; interestSkills?: string[]}): Promise<[Row, Row]> {
    const {investigatorId, name, concept, age, sex, method, seed, era, occupationSkills, interestSkills} = options;
    // The setting the book authored, when the rulebook had no column of its own for it (§23.4).
    const sourceEra = typeof options.sourceEra === 'string' && options.sourceEra.trim() && options.sourceEra.trim() !== era ? options.sourceEra.trim() : null;
    if (!METHODS.includes(method)) throw new ChargenError('method', "method must be one of ('quick_fire', 'rolled')", {options: [...METHODS]});
    const [occupationName, spec] = this.occupation(options.occupationId), policy = this.allocationPolicy(options.allocation), formula = parseFormula(spec.skill_point_formula || '');
    const interestPolicy = this.allocationPolicy(options.interestAllocation, 'interest_allocation');
    const aptitude = this.aptitude(options.aptitude);
    const diff = this.difficultyPolicy(options.difficulty ?? null), cap = diff ? diff.effectiveCap(this.cap) : this.cap;
    if (aptitude && method !== 'rolled') throw new ChargenError('aptitude', 'a stated aptitude assigns rolled results and cannot direct the quick-fire array', {method, expected_method: 'rolled'});
    const rng = new PythonRandom(seed), trace: Row = {seed, method};
    const generated = method === 'quick_fire' ? this.quickFire(formulaCharacteristics(formula), diff) : this.rolled(occupationSkills !== undefined ? new PythonRandom(seed + ':characteristics') : rng, aptitude, diff);
    trace.method = string(generated.method); trace.characteristics = generated;
    const aged = this.applyAge(generated.values, age, occupationSkills !== undefined ? new PythonRandom(seed + ':age') : rng), characteristics = aged.values;
    trace.age = aged.trace;
    const luck = this.luck(occupationSkills !== undefined ? new PythonRandom(seed + ':luck') : rng, aged.trace.luck_rolls_keep_highest, diff);
    trace.luck = luck; characteristics.LUCK = luck.value;
    const derived = await this.derive(characteristics, aged.trace.mov_penalty); trace.derived = derived.trace;
    const standard = row(row(this.skillsDoc.standard_sheet)[era]);
    const sheetIds: string[] | null = Object.keys(standard).length ? standard.default_skill_ids.map(string) : null;
    let resolved: string[] = [], pending: string[] = [], slots: string[] = [];
    for (const phrase of array(spec.occupational_skills)) {
      const found = this.catalogName(string(phrase));
      if (found === null) { pending.push(string(phrase)); slots.push(string(phrase)); }
      else if (!resolved.includes(found)) { resolved.push(found); slots.push(found); }
    }
    if (occupationSkills !== undefined) { resolved = [...occupationSkills]; slots = [...occupationSkills]; pending = []; }
    const creditRange = (truth(spec.credit_rating_range) ? spec.credit_rating_range : [0, 0]).map(number), credit = creditRange[0], listed = [...sheetIds ?? []];
    for (const skill of resolved) if (!listed.includes(skill)) listed.push(skill);
    if (!listed.includes('Credit Rating')) listed.push('Credit Rating');
    const values: Row = Object.fromEntries(listed.map(skill => [skill, this.skillBase(skill, characteristics)])); values['Credit Rating'] = credit;
    const budget = evaluateFormula(formula, characteristics), occupationPool = resolved.filter(skill => skill !== 'Credit Rating');
    const occupationBudget = diff ? diff.adjustBudget('occupation', budget.total) : budget.total, points = Math.max(0, occupationBudget - credit);
    const [occupational, reserved] = policy.policy === 'spread' ? Chargen.spread(slots.filter(skill => skill !== 'Credit Rating'), new Set(occupationPool), points, values, cap, policy.tiers)
      : [Chargen.allocate(occupationPool, points, values, cap), []];
    for (const [skill, amount] of entries(occupational)) values[skill] += amount;
    const interestBudget = evaluateFormula(parseFormula(string(this.policy.formulas.personal_interest_points)), characteristics), excluded = new Set(array(row(this.policy.interest_pool).exclude));
    const interestTotal = diff ? diff.adjustBudget('interest', interestBudget.total) : interestBudget.total;
    const interestPool = interestSkills !== undefined ? [...interestSkills] : (sheetIds ?? []).filter(skill => !resolved.includes(skill) && !excluded.has(skill));
    for (const skill of interestPool) if (!Object.hasOwn(values, skill)) values[skill] = this.skillBase(skill, characteristics);
    // Only a model-supplied list is ordered by what the player said matters; the legacy
    // auto-pool is the era's standard sheet in table order and keeps the round robin.
    const interestApplied = interestSkills !== undefined ? interestPolicy.policy : 'fill';
    const interest = interestApplied === 'spread'
      ? Chargen.spread(interestPool, new Set(interestPool), interestTotal, values, cap, interestPolicy.tiers)[0]
      : Chargen.allocate(interestPool, interestTotal, values, cap);
    for (const [skill, amount] of entries(interest)) values[skill] += amount;
    const spent = sum(Object.values(occupational)), interestSpent = sum(Object.values(interest));
    if (occupationSkills !== undefined && (spent !== points || interestSpent !== interestTotal)) throw new ChargenError('skills', 'Selected skills cannot hold the full budget; choose more interest skills or a wider legal occupational selection', {occupation_unspent: points - spent, interest_unspent: interestTotal - interestSpent});
    trace.skills = {standard_sheet: sheetIds ? `skills.standard_sheet.${era}` : null, cap: {value: cap, source: 'skills.guided_creation_policy.starting_skill_cap',
        ...(diff?.skillCap != null ? {difficulty: {skill_cap: diff.skillCap}} : {})},
      occupation: {id: occupationName, resolved, choices_pending: pending, budget, ...(diff?.occupation ? {budget_adjusted: {total: occupationBudget, ...clone(diff.occupation)}} : {}),
        credit_rating: {value: credit, range: creditRange, source: 'occupations.credit_rating_range[0]'}, points, spent, unspent: points - spent, allocations: occupational, allocation: policy.policy, reserved},
      interest: {budget: interestBudget, ...(diff?.interest ? {budget_adjusted: {total: interestTotal, ...clone(diff.interest)}} : {}),
        pool: interestPool, spent: interestSpent, allocations: interest, unspent: interestTotal - interestSpent,
        allocation: interestApplied, tiers: interestApplied === 'spread' ? interestPolicy.tiers : null, source: interestPolicy.source}};
    let finance: Row | null;
    // Every number on the card names the table row it came from; a period that stood in for an
    // authored setting the rulebook never tabulated says so in the same place, so the substitution
    // is auditable from the card alone rather than inferred from a missing match (§23.4).
    const financeSource = `cash-assets.periods.${era}`;
    const substitution = sourceEra ? {substituted_for: sourceEra, note: `the rulebook tabulates no finance period for ${repr(sourceEra)}; the ${era} column stands in`} : {};
    try { finance = await this.tables.cashAndAssets(credit, era); finance.source = financeSource; if (sourceEra) Object.assign(finance, substitution); trace.finance = {available: true, source: financeSource, ...substitution}; }
    catch (error) { if (!(error instanceof Error) || error.name !== 'ValueError') throw error; finance = null; trace.finance = {available: false, reason: error.message, source: 'cash-assets.periods', ...substitution}; }
    trace.equipment = {source: null, note: 'equipment.json records carry no occupation field; no default kit is invented'};
    trace.allocation = policy; trace.interest_allocation = {...interestPolicy, applied: interestApplied};
    if (diff) trace.difficulty = diff.record;
    const sheet: Row = {schema_version: 1, id: investigatorId, name, occupation: occupationName, era, ...(sourceEra ? {setting_era: sourceEra} : {}), age, sex,
      characteristics: {...Object.fromEntries(this.characteristics.map(key => [key, Math.trunc(number(characteristics[key]))])), LUCK: luck.value}, derived: derived.values,
      skills: Object.fromEntries(entries(values).sort(([a], [b]) => compareUnicode(a, b))), weapons: [], equipment: [], backstory: {concept}, credit_rating: credit,
      cash: finance ? `${string(finance.cash.amount)} ${finance.cash.currency}` : null, finance, creation: trace};
    const receipt: Row = {id: `investigator:${investigatorId}`, kind: 'investigator', investigator: investigatorId, name, occupation: occupationName, method: string(generated.method), seed, choices_pending: pending,
      allocation: policy.policy, interest_allocation: interestApplied, occupation_unspent: points - spent, occupation_reserved: sum(reserved.map((item: Row) => number(item.points))), interest_unspent: interestTotal - interestSpent, finance_available: finance !== null, ...(sourceEra ? {finance_period: era, setting_era: sourceEra} : {}),
      ...(diff ? {difficulty: diff.record} : {})};
    return [sheet, receipt];
  }
}
/** Which rulebook era's tables a card is built from (contract §23.4).
 *
 *  An authored era is a setting, not a table key: it can be prose spanning years ("1895 (default);
 *  investigators then enter 1287"), and it is never string-matched or read for a year. When it is not
 *  itself one of the rulebook's periods, the table's own nominated period stands in and the authored
 *  text is carried back so the card, its provenance and the player are told what it stood in for.
 *  Setup therefore always has a way through; it never blocks a table on a setting the rulebook never
 *  tabulated, and never silently rewrites the setting into a table key. */
export async function resolveRulebookEra(tables: RuleTables, authored: unknown): Promise<{era: string; substitutedFor: string | null; options: string[]}> {
  const options = await tables.financePeriods(), authoredText = typeof authored === 'string' ? authored.trim() : '';
  if (authoredText && options.includes(authoredText)) return {era: authoredText, substitutedFor: null, options};
  return {era: await tables.defaultFinancePeriod(), substitutedFor: authoredText || null, options};
}
export function defaultInvestigatorId(name: string, ordinal: number): string { const slug = kebab(name); return slug && /^[a-z0-9][a-z0-9-]*$/.test(slug) ? slug : `inv-${ordinal}`; }
