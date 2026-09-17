/** The card as a patched document (contract §98): words change words, numbers change numbers,
 *  the dice are rolled once, a pin outranks the allocator, and confirmation has one gate.
 *
 *  One card per campaign, one file per revision (`setup/drafts/<n>.json`). `draft` generates the
 *  numbers the first time and is a revision after that; `revise` merges a profile patch, writes
 *  pins from `numbers`, relaxes `limits`; `reroll` is the only call that rolls again; `confirm`
 *  checks that this is the current card. The catalog work — trades, skills, weapons — is the
 *  kernel's (`catalog.ts`), and the flow of points around the pins is `card.ts`. */
import { join } from 'node:path';
import { RpcError } from '../errors.js';
import { isJsonObject, jsonDigest } from '../json.js';
import { withExclusiveLock } from '../locks.js';
import { playerGlossary } from '../read/handlers.js';
import { playLanguageOf } from '../read/languages.js';
import { loadModule } from '../read/campaign.js';
import { row, array, clone, entries, string, number, integer, normalize, truth, equal, repr, type Row } from '../read/values.js';
import { moduleEra } from '../library/index.js';
import { setupModContext, SETUP_SLOT_STOP } from '../read/mods.js';
import type { CampaignWriter } from '../write/store.js';
import type { Setup } from './index.js';
import { ChargenError, resolveRulebookEra } from './chargen.js';
import type { ResolvedDifficulty } from './difficulty.js';
import { BACKSTORY, completeness, nonempty } from './sheet.js';
import { flowSkills, limitsOf, emptyPins, LIMIT_FIELDS, PIN_ORIGINS, type Pins, type Soft } from './card.js';
const NOTE_VALUE_LIMIT = 400;
const FIELDS = ['name', 'occupation', 'age', 'sex', 'concept', 'occupation_skills', 'interest_skills', 'own_language', 'backstory', 'key_connection', 'equipment', 'weapons', 'era', 'aptitude', 'occupation_stated'];
const NUMBER_FIELDS = ['characteristics', 'skills', 'credit_rating'];
const CHARACTERISTICS = ['STR', 'CON', 'SIZ', 'DEX', 'APP', 'INT', 'POW', 'EDU', 'LUCK'];
/** What the name-resolution of one profile left behind, to ride out with the card. */
interface Resolution { unresolved: Array<{given: string; candidates: string[]}>; moved_to_equipment: string[]; filled_in: string[] }
export class SetupDrafts {
  constructor(readonly setup: Setup) {}
  async locked<T>(params: Row, action: (campaign: CampaignWriter) => Promise<T>): Promise<T> {
    const campaign = await this.setup.campaign(params);
    return withExclusiveLock(this.setup.context.locks, campaign.path('setup.lock'), () => action(campaign));
  }
  async load(campaign: CampaignWriter, meta: Row): Promise<Row | null> {
    const revision = row(meta.setup).draft_revision;
    return truth(revision) ? campaign.read(join('setup', 'drafts', `${string(revision)}.json`)) : null;
  }
  async result(draft: Row, extra: Row = {}): Promise<Row> {
    const issues = completeness(draft.sheet), relax = isJsonObject(draft.limits_override) ? draft.limits_override : {};
    return {revision: draft.revision, seed: draft.seed, sheet: draft.sheet, profile: draft.profile, pins: clone(draft.pins ?? emptyPins()),
      budget: clone(draft.budget ?? null), generation: clone(draft.generation ?? null),
      labels: await playerGlossary(this.setup.context, await playLanguageOf(this.setup.context, draft)), completeness: {valid: !issues.length, issues},
      limits: draft.limits ?? limitsOf(this.setup.chargen, row(draft.sheet), relax), ...extra};
  }
  /** The bounds the edit control renders (contract §23.4), kept for the card. */
  async limits(draft: Row, card?: Row): Promise<Row> {
    return limitsOf(this.setup.chargen, card ?? row(draft.sheet), isJsonObject(draft.limits_override) ? draft.limits_override : {});
  }
  // ---- the profile: words, resolved against the catalog ------------------------------------------
  /** The merged profile, its names resolved (§98): required words present, skills and the trade
   *  looked up by name or label, the occupation list filled to eight, unprinted weapons moved to
   *  the equipment. Throws `needs` only for what the model must actually decide. */
  async resolveProfile(profile: Row, language: string, meta: Row): Promise<[Row, Resolution]> {
    const catalog = this.setup.catalog, issues: string[] = [], resolved: Row = {...profile};
    const resolution: Resolution = {unresolved: [], moved_to_equipment: [], filled_in: []};
    for (const field of ['name', 'occupation', 'concept', 'own_language']) if (!nonempty(profile[field])) issues.push(`${field} is required`);
    if (!nonempty(profile.sex)) issues.push('sex is required; draft the words the player used or your best reading, in the play language — the player corrects it on the card');
    const raw = profile.backstory, story = row(raw);
    if (!isJsonObject(raw) || Object.keys(story).some(key => ![...BACKSTORY, 'scenario_bound'].includes(key))) issues.push('backstory must use the declared categories');
    else if (BACKSTORY.filter(key => nonempty(story[key])).length < 3 || !nonempty(story.scenario_bound)) issues.push('supply 3-6 backstory categories and scenario_bound');
    if (!nonempty(story.personal_description)) issues.push('personal_description is required; supply visible appearance in the player language');
    const key = truth(profile.key_connection) ? profile.key_connection : {};
    if (!isJsonObject(key) || !BACKSTORY.includes(key.backstory_field as string) || !nonempty(key.summary) || !nonempty(story[string(key.backstory_field)])) issues.push('key_connection needs backstory_field and summary referring to a populated category');
    if (!Array.isArray(profile.equipment) || !profile.equipment.every(nonempty)) issues.push('equipment must list the ordinary items the draft says are carried');
    const stated = Object.hasOwn(profile, 'occupation_stated') ? profile.occupation_stated : null;
    if (stated !== null && (typeof stated !== 'string' || !stated.trim())) issues.push('occupation_stated is the player\'s own words for the trade, a non-empty string, or omitted');
    if (Object.hasOwn(profile, 'age') && profile.age != null && !integer(profile.age)) issues.push('age must be an integer');
    // Skills: a name that resolves is taken as its catalog name; one that does not is dropped with candidates.
    const names = (value: unknown, field: string): string[] => {
      if (value == null) return [];
      if (!Array.isArray(value)) { issues.push(`${field} must be a list of skill names`); return []; }
      const out: string[] = [];
      for (const item of value) {
        if (typeof item !== 'string' || !item.trim()) { issues.push(`${field} must be a list of skill names`); continue; }
        const found = catalog.resolveSkill(item);
        if (found === null) { resolution.unresolved.push({given: item, candidates: catalog.skillCandidates(item)}); continue; }
        if (['Cthulhu Mythos', 'Credit Rating'].includes(found)) { issues.push('Credit Rating is allocated separately; no starting Cthulhu Mythos'); continue; }
        if (!out.includes(found)) out.push(found);
      }
      return out;
    };
    const occupationPicks = names(profile.occupation_skills, 'occupation_skills'), interests = names(profile.interest_skills, 'interest_skills');
    const aptitude = Object.hasOwn(profile, 'aptitude') ? profile.aptitude : null;
    if (aptitude !== null) {
      const shape = isJsonObject(aptitude) && Object.keys(aptitude).every(key => ['strong', 'weak', 'origin'].includes(key))
        && ['strong', 'weak'].every(key => !Object.hasOwn(aptitude, key) || (Array.isArray(aptitude[key]) && aptitude[key].every((abbr: unknown) => typeof abbr === 'string')));
      if (!shape) issues.push('aptitude names strong/weak characteristics and the origin that named them');
      else { try { this.setup.chargen.aptitude(aptitude); } catch (error) { if (!(error instanceof ChargenError)) throw error; issues.push(`aptitude: ${error.message}`); } }
    }
    if (issues.length) throw new RpcError('needs', 'Complete the semantic profile without interviewing for ordinary missing details', {details: {issues, backstory_fields: [...BACKSTORY]}});
    // The trade: an entry by id or label, or the closest entries by the skills the model named.
    const occupation = catalog.resolveOccupation(profile.occupation);
    if (occupation === null) {
      const candidates = catalog.occupationCandidates([...occupationPicks, ...interests], language);
      throw new RpcError('needs', `the rulebook prints no occupation named ${repr(profile.occupation)}: choose one of details.candidates (or details.options), keep the player's words in occupation_stated`, {
        details: {field: 'occupation', given: profile.occupation, candidates: candidates.map(c => ({...c})) as unknown as Row[], ...(candidates.length ? {} : {options: catalog.occupationOptions(language) as unknown as Row[]})}});
    }
    resolved.occupation = occupation;
    const [occupationSkills, filled] = catalog.fillOccupationSkills(occupation, occupationPicks, interests, this.standardSheet(await this.eraOf(profile, meta)));
    resolved.occupation_skills = occupationSkills; resolution.filled_in = filled;
    resolved.interest_skills = interests.filter(name => !occupationSkills.includes(name));
    // Weapons: printed profiles stay weapons; anything else is equipment under the player's name for it.
    const profiles = catalog.weaponProfiles(), weapons: string[] = [], equipment = [...array(profile.equipment).map(string)];
    if (Object.hasOwn(profile, 'weapons') && profile.weapons != null) {
      if (!Array.isArray(profile.weapons) || !profile.weapons.every(nonempty)) throw new RpcError('needs', 'weapons is a list of weapon names, or omitted', {details: {field: 'weapons'}});
      for (const written of profile.weapons as string[]) {
        if (profiles.has(normalize(written))) weapons.push(written);
        else { resolution.moved_to_equipment.push(written); if (!equipment.includes(written)) equipment.push(written); }
      }
    }
    resolved.weapons = weapons; resolved.equipment = equipment;
    if (stated === null) delete resolved.occupation_stated; else resolved.occupation_stated = string(stated).trim();
    if (aptitude === null) delete resolved.aptitude;
    return [resolved, resolution];
  }
  standardSheet(era: string): string[] {
    const standard = row(row(this.setup.chargen.skillsDoc.standard_sheet)[era]);
    return Object.keys(standard).length ? array(standard.default_skill_ids).map(string) : [];
  }
  /** The rulebook period the card is built from, and the authored setting it stood in for (§23.4). */
  async eraOf(profile: Row, meta: Row): Promise<string> { return (await this.eraFor(profile, meta)).era; }
  async eraFor(profile: Row, meta: Row): Promise<{era: string; authoredEra: string | null}> {
    const graph = (await loadModule(this.setup.context, meta.module_id, meta.id ?? meta.campaign ?? string(meta.campaign_id ?? ''))).graph;
    const selected = truth(meta.opening_scene) ? graph.scene(meta.opening_scene) : graph.startScene();
    const sourceEra = row(row(selected.properties).investigator_setup).era || moduleEra(graph);
    const chosen = typeof profile.era === 'string' ? profile.era.trim() : '';
    const resolved = await resolveRulebookEra(this.setup.tables, chosen || sourceEra);
    if (chosen && !resolved.options.includes(chosen)) throw new RpcError('needs', 'profile.era must name a rulebook finance period', {
      fix: "Pass the period from details.options that reads closest to the authored setting, or omit profile.era and let the table's own period stand in. Either way the card records which setting the period stood in for, so say that once to the player. Do not copy authored prose as a table key, and do not ask the player to fix a system parameter.",
      details: {field: 'era', source_era: sourceEra ?? null, options: resolved.options}});
    const era = resolved.era, authoredEra = typeof sourceEra === 'string' && sourceEra.trim() && sourceEra.trim() !== era ? sourceEra.trim() : null;
    return {era, authoredEra};
  }
  // ---- the numbers: pins ---------------------------------------------------------------------------
  /** `numbers` become pins (§98). Bounds are checked against the limits in force: a value past a
   *  bound is refused with the unlock that would admit it, never silently lowered. */
  pinsFrom(numbers: unknown, by: unknown, pins: Pins, limits: Row, bases: Row | null, creditRange: number[], diff: ResolvedDifficulty | null = null, relax: Row = {}): Pins {
    if (numbers == null) return pins;
    if (!isJsonObject(numbers) || Object.keys(numbers).some(key => !NUMBER_FIELDS.includes(key))) throw new RpcError('invalid_params', 'numbers holds characteristics, skills and credit_rating only', {details: {fields: [...NUMBER_FIELDS]}});
    const origin = by == null ? 'player' : by;
    if (typeof origin !== 'string' || !PIN_ORIGINS.includes(origin)) throw new RpcError('invalid_params', `by must be one of ${repr([...PIN_ORIGINS])}`);
    const next: Pins = {characteristics: {...pins.characteristics}, skills: {...pins.skills}, ...(pins.credit_rating ? {credit_rating: pins.credit_rating} : {})};
    const characteristics = numbers.characteristics ?? {};
    if (!isJsonObject(characteristics) || Object.keys(characteristics).some(key => !CHARACTERISTICS.includes(key))) throw new RpcError('invalid_params', 'numbers.characteristics covers only the nine abbreviations', {details: {fields: [...CHARACTERISTICS]}});
    for (const [abbr, value] of entries(characteristics)) {
      if (value === null) { delete next.characteristics[abbr]; continue; }
      if (!integer(value)) throw new RpcError('invalid_params', `numbers.characteristics.${abbr} must be an integer`);
      // A replaced dice pool binds its own range per characteristic (§33.3); LUCK keeps the creation bounds.
      const [poolMin, poolMax] = this.setup.chargen.characteristicBounds(diff, abbr);
      const lo = Object.hasOwn(relax, 'characteristic_min') ? Math.trunc(number(relax.characteristic_min)) : poolMin;
      const hi = Object.hasOwn(relax, 'characteristic_max') ? Math.trunc(number(relax.characteristic_max)) : poolMax;
      if (number(value) < lo) throw new RpcError('needs', `${abbr} ${value} is below the creation floor ${lo}`, {details: {field: abbr, range: [lo, hi], attempted: number(value), unlock: {characteristic_min: number(value)}}});
      if (number(value) > hi) throw new RpcError('needs', `${abbr} ${value} is above the creation ceiling ${hi}; pass limits.characteristic_max to admit it`, {details: {field: abbr, range: [lo, hi], attempted: number(value), unlock: {characteristic_max: number(value)}}});
      next.characteristics[abbr] = {value: Math.trunc(number(value)), by: origin};
    }
    const skills = numbers.skills ?? {};
    if (!isJsonObject(skills)) throw new RpcError('invalid_params', 'numbers.skills must be an object of skill name to value');
    for (const [given, value] of entries(skills)) {
      if (given === 'Credit Rating') throw new RpcError('invalid_params', 'Credit Rating is not a skill pin; use numbers.credit_rating', {details: {field: 'credit_rating'}});
      const name = this.setup.catalog.resolveSkill(given);
      if (name === null) throw new RpcError('needs', `no skill named ${repr(given)}`, {details: {field: given, candidates: this.setup.catalog.skillCandidates(given)}});
      if (name === 'Cthulhu Mythos') throw new RpcError('needs', 'Cthulhu Mythos is never a creation skill', {details: {field: name}});
      if (value === null) { delete next.skills[name]; continue; }
      if (!integer(value)) throw new RpcError('invalid_params', `numbers.skills must hold integers (${repr(given)})`);
      const cap = number(limits.skill_cap), floor = bases ? this.setup.chargen.skillBase(name, bases) : 0;
      if (number(value) > cap) throw new RpcError('needs', `${name} ${value} is above the starting cap ${cap}; pass limits.skill_cap to admit it`, {details: {field: name, range: [floor, cap], attempted: number(value), unlock: {skill_cap: number(value)}}});
      if (number(value) < floor) throw new RpcError('needs', `${name} ${value} is below its base chance ${floor}`, {details: {field: name, range: [floor, cap], attempted: number(value)}});
      next.skills[name] = {value: Math.trunc(number(value)), by: origin};
    }
    if (Object.hasOwn(numbers, 'credit_rating')) {
      const value = numbers.credit_rating;
      if (value === null) delete next.credit_rating;
      else {
        if (!integer(value)) throw new RpcError('invalid_params', 'numbers.credit_rating must be an integer');
        if (number(value) < creditRange[0] || number(value) > creditRange[1]) throw new RpcError('needs', 'Credit Rating stays within the occupation range', {details: {field: 'credit_rating', range: creditRange, attempted: number(value)}});
        next.credit_rating = {value: Math.trunc(number(value)), by: origin};
      }
    }
    return next;
  }
  relaxFrom(limits: unknown, previous: Row): Row {
    if (limits == null) return previous;
    if (!isJsonObject(limits) || Object.keys(limits).some(key => !LIMIT_FIELDS.includes(key)) || Object.values(limits).some(value => value !== null && !integer(value)))
      throw new RpcError('invalid_params', 'limits relaxes only the declared numeric bounds', {details: {fields: [...LIMIT_FIELDS]}});
    const next: Row = {...previous};
    for (const [key, value] of entries(limits)) { if (value === null) delete next[key]; else next[key] = Math.trunc(number(value)); }
    return next;
  }
  // ---- the card ------------------------------------------------------------------------------------
  /** One card from its parts: the profile's words, the generated characteristics, the flowed skills. */
  async assemble(options: {profile: Row; era: string; authoredEra: string | null; seed: string; generated: {characteristics: Row; derived: Row; trace: Row; method: string};
    pins: Pins; previous: {soft: Soft; credit: number; occupationSkills: string[]; interestSkills: string[]} | null; relax: Row; difficulty: any; spreadAll: boolean; language: string}): Promise<{sheet: Row; soft: Soft; budget: Row; receipt: Row}> {
    const {profile, generated, pins} = options, chargen = this.setup.chargen;
    const flow = flowSkills(chargen, {characteristics: generated.characteristics, occupation: profile.occupation, era: options.era,
      occupationSkills: profile.occupation_skills, interestSkills: profile.interest_skills ?? [], pins, previous: options.previous,
      relax: options.relax, difficulty: chargen.difficultyPolicy(options.difficulty ?? null), spreadAll: options.spreadAll});
    let finance: Row | null;
    const financeSource = `cash-assets.periods.${options.era}`;
    const substitution = options.authoredEra ? {substituted_for: options.authoredEra, note: `the rulebook tabulates no finance period for ${repr(options.authoredEra)}; the ${options.era} column stands in`} : {};
    let financeTrace: Row;
    try { finance = await this.setup.tables.cashAndAssets(flow.credit, options.era); finance.source = financeSource; if (options.authoredEra) Object.assign(finance, substitution); financeTrace = {available: true, source: financeSource, ...substitution}; }
    catch (error) { if (!(error instanceof Error) || error.name !== 'ValueError') throw error; finance = null; financeTrace = {available: false, reason: error.message, source: 'cash-assets.periods', ...substitution}; }
    const drafted = this.setup.catalog.weaponProfiles();
    const weapons = array(profile.weapons).map(written => { const [entry, printable] = drafted.get(normalize(string(written)))!; return {name: printable, ...entry}; });
    const equipment = [...array(profile.equipment).map(string)];
    for (const weapon of weapons) if (!equipment.includes(weapon.name)) equipment.push(weapon.name);
    const creation: Row = {...generated.trace, skills: flow.ledger, allocation: chargen.allocationPolicy(null), interest_allocation: {...chargen.allocationPolicy(null, 'interest_allocation'), applied: 'spread'},
      finance: financeTrace, equipment: {source: null, note: 'equipment.json records carry no occupation field; no default kit is invented'}, pins: clone(pins), budget: clone(flow.budget)};
    const sheet: Row = {schema_version: 1, id: 'investigator', name: profile.name, occupation: profile.occupation, era: options.era, ...(options.authoredEra ? {setting_era: options.authoredEra} : {}),
      age: Object.hasOwn(profile, 'age') && profile.age != null ? profile.age : 27, sex: profile.sex ?? null,
      characteristics: Object.fromEntries(CHARACTERISTICS.map(key => [key, Math.trunc(number(generated.characteristics[key]))])), derived: generated.derived,
      skills: flow.skills, weapons, equipment, backstory: {...clone(profile.backstory), concept: profile.concept}, key_connection: clone(profile.key_connection), own_language: profile.own_language,
      occupation_stated: typeof profile.occupation_stated === 'string' ? profile.occupation_stated.trim() : null,
      credit_rating: flow.credit, cash: finance ? `${string(finance.cash.amount)} ${finance.cash.currency}` : null, finance, creation};
    sheet.current_hp = sheet.derived.HP; sheet.current_mp = sheet.derived.MP; sheet.current_san = sheet.derived.SAN; sheet.current_luck = sheet.characteristics.LUCK;
    const receipt: Row = {id: 'investigator:investigator', kind: 'investigator', investigator: 'investigator', name: profile.name, occupation: profile.occupation, method: generated.method, seed: options.seed,
      choices_pending: [], allocation: 'spread', interest_allocation: 'spread', occupation_unspent: flow.budget.occupation.unspent, occupation_reserved: 0, interest_unspent: flow.budget.interest.unspent,
      finance_available: finance !== null, ...(options.authoredEra ? {finance_period: options.era, setting_era: options.authoredEra} : {}), ...(generated.trace.difficulty ? {difficulty: generated.trace.difficulty} : {})};
    return {sheet, soft: flow.soft, budget: flow.budget, receipt};
  }
  async write(campaign: CampaignWriter, meta: Row, draft: Row): Promise<Row> {
    draft.digest = jsonDigest(draft.sheet);
    draft.limits = limitsOf(this.setup.chargen, row(draft.sheet), isJsonObject(draft.limits_override) ? draft.limits_override : {});
    await campaign.write(join('setup', 'drafts', `${draft.revision}.json`), draft);
    meta.setup = {...row(meta.setup), draft_revision: draft.revision}; delete meta.setup.previewed_revision; await campaign.writeCampaign(meta);
    return draft;
  }
  private settingUp(meta: Row): void {
    if (meta.status !== 'setting_up') throw new RpcError('invalid_params', 'the campaign is no longer accepting drafts');
    if (truth(row(meta.setup).confirmed_revision)) throw new RpcError('campaign_not_ready', 'The confirmed card cannot be replaced during handoff');
  }
  private patchOf(value: unknown): Row {
    if (value == null) return {};
    if (!isJsonObject(value)) throw new RpcError('invalid_params', 'profile must be an object');
    // A backstory category sent at the top level is folded into backstory (§98): a live table's
    // model corrected the face with `personal_description` beside `equipment`, and refusing that
    // as an unknown field cost a call for nothing.
    const folded: Row = {...value};
    for (const key of [...BACKSTORY, 'scenario_bound']) if (Object.hasOwn(folded, key)) { folded.backstory = {...row(folded.backstory), [key]: folded[key]}; delete folded[key]; }
    const unknown = Object.keys(folded).filter(key => !FIELDS.includes(key)).sort();
    if (unknown.length) throw new RpcError('invalid_params', `profile contains unknown fields: ${unknown.join(', ')}`, {details: {unknown, fields: [...FIELDS].sort()}});
    return folded;
  }
  /** The first card: generate the numbers once. With a card already on the table this is a revision. */
  async draft(params: Row): Promise<Row> {
    return this.locked(params, async campaign => {
      const meta = await campaign.readCampaign(); this.settingUp(meta);
      const previous = await this.load(campaign, meta);
      if (previous) return this.reviseLocked(campaign, meta, previous, params);
      const language = await playLanguageOf(this.setup.context, meta), patch = this.patchOf(params.profile);
      const [profile, resolution] = await this.resolveProfile(patch, language, {...meta, id: campaign.id});
      const {era, authoredEra} = await this.eraFor(profile, {...meta, id: campaign.id});
      const state = meta.setup ??= {};
      const seed = truth(state.draft_seed) ? string(state.draft_seed) : string(this.setup.context.rng.getrandbits(64));
      if (!Object.hasOwn(state, 'draft_seed')) { state.draft_seed = seed; await campaign.writeCampaign(meta); }
      const relax = this.relaxFrom(params.limits, {});
      const bounds = this.boundsFor(profile.occupation, meta.difficulty ?? null, relax);
      const pins = this.pinsFrom(params.numbers, params.by, emptyPins(), bounds, null, bounds.credit_rating_range, this.setup.chargen.difficultyPolicy(meta.difficulty ?? null), relax);
      const generated = await this.generate(seed, profile, pins, meta.difficulty ?? null);
      const built = await this.assemble({profile, era, authoredEra, seed, generated, pins, previous: null, relax, difficulty: meta.difficulty ?? null, spreadAll: false, language});
      const draft: Row = {revision: 1, play_language: language, seed, profile, sheet: built.sheet, pins, soft: built.soft, budget: built.budget,
        generation: {method: generated.method, seed}, input_key: params.input_key ?? null, receipt: built.receipt};
      if (Object.keys(relax).length) draft.limits_override = relax;
      await this.write(campaign, meta, draft);
      return this.result(draft, {applied: Object.keys(patch).sort(), ...resolution});
    });
  }
  private async generate(seed: string, profile: Row, pins: Pins, difficulty: any, method: string | null = null): Promise<{characteristics: Row; derived: Row; trace: Row; method: string}> {
    try {
      return await this.setup.chargen.generate({seed, age: Object.hasOwn(profile, 'age') && profile.age != null ? profile.age : 27, aptitude: profile.aptitude ?? null,
        pins: Object.fromEntries(entries(pins.characteristics).map(([abbr, pin]) => [abbr, row(pin).value])), difficulty, method});
    } catch (error) {
      if (!(error instanceof ChargenError) && (!(error instanceof Error) || !['ValueError', 'KeyError'].includes(error.name))) throw error;
      throw new RpcError('needs', error.message, {details: {expected: error instanceof ChargenError ? error.expected : null}});
    }
  }
  /** The bounds in force before a sheet exists: the rulebook's under the campaign's difficulty, relaxed by `limits`. */
  private boundsFor(occupation: string, difficulty: any, relax: Row): Row {
    const chargen = this.setup.chargen, diff = chargen.difficultyPolicy(difficulty), [minimum, maximum] = chargen.creationBoundsFor(diff);
    const bound = (key: string, fallback: number): number => Object.hasOwn(relax, key) ? Math.trunc(number(relax[key])) : fallback;
    const [, spec] = chargen.occupation(occupation);
    return {characteristic_min: bound('characteristic_min', minimum), characteristic_max: bound('characteristic_max', maximum), skill_cap: bound('skill_cap', diff ? diff.effectiveCap(chargen.cap) : chargen.cap),
      credit_rating_range: (truth(spec.credit_rating_range) ? array(spec.credit_rating_range) : [0, 0]).map(number)};
  }
  async revise(params: Row): Promise<Row> {
    return this.locked(params, async campaign => {
      const meta = await campaign.readCampaign(); this.settingUp(meta);
      const previous = await this.load(campaign, meta);
      if (!previous) throw new RpcError('needs', 'There is no card to revise yet: draft one first', {details: {next: 'setup.draft'}});
      return this.reviseLocked(campaign, meta, previous, params);
    });
  }
  /** The one revision path (§98): words merge, numbers pin, limits relax, nothing rolls. */
  private async reviseLocked(campaign: CampaignWriter, meta: Row, previous: Row, params: Row, options: {reroll?: boolean; dryRun?: boolean} = {}): Promise<Row> {
    if (params.revision !== undefined && params.revision !== null && !equal(params.revision, previous.revision)) throw new RpcError('idempotency_conflict', 'The revision does not apply to the current draft', {codeDetail: 'stale_draft'});
    const language = await playLanguageOf(this.setup.context, meta), patch = this.patchOf(params.profile);
    // A patch of one backstory category keeps the others (§98): the model that corrects the face
    // sends personal_description alone, and a shallow merge would have wiped the rest.
    const merged: Row = {...row(previous.profile), ...patch};
    if (isJsonObject(patch.backstory) && isJsonObject(row(previous.profile).backstory)) {
      merged.backstory = {...row(row(previous.profile).backstory), ...patch.backstory};
      for (const [key, value] of entries(patch.backstory)) if (value === null) delete merged.backstory[key];
    }
    const [profile, resolution] = await this.resolveProfile(merged, language, {...meta, id: campaign.id});
    const {era, authoredEra} = await this.eraFor(profile, {...meta, id: campaign.id});
    const relax = this.relaxFrom(params.limits, isJsonObject(previous.limits_override) ? previous.limits_override : {});
    const bounds = {...limitsOf(this.setup.chargen, row(previous.sheet), relax), ...this.boundsFor(profile.occupation, meta.difficulty ?? null, relax)};
    const priorPins: Pins = isJsonObject(previous.pins) ? clone(previous.pins) as unknown as Pins : emptyPins();
    const pins = this.pinsFrom(params.numbers, params.by, priorPins, bounds, row(row(previous.sheet).characteristics), bounds.credit_rating_range,
      this.setup.chargen.difficultyPolicy(row(row(previous.sheet).creation).difficulty ?? meta.difficulty ?? null), relax);
    // A skill pinned by name joins the interest list when the card did not list it, so it has a pool.
    for (const name of Object.keys(pins.skills)) if (!profile.occupation_skills.includes(name) && !profile.interest_skills.includes(name) && !this.standardSheet(era).includes(name)) profile.interest_skills = [...profile.interest_skills, name];
    const seed = options.reroll ? string(this.setup.context.rng.getrandbits(64)) : string(previous.seed);
    // The dice are rolled once. A regeneration from the same seed is deterministic and happens only
    // when the age table or the array placement has to run again (age, aptitude, an un-pinned
    // characteristic); a reroll takes a new seed; everything else carries the numbers as they are.
    const pinsChanged = !equal(pins.characteristics, priorPins.characteristics);
    const unpinned = Object.keys(priorPins.characteristics).some(abbr => !Object.hasOwn(pins.characteristics, abbr));
    const regenerate = options.reroll || unpinned || !equal(profile.age ?? null, row(previous.profile).age ?? null) || !equal(profile.aptitude ?? null, row(previous.profile).aptitude ?? null);
    let generated = regenerate ? await this.generate(seed, profile, pins, meta.difficulty ?? null) : this.carried(previous);
    if (!regenerate && pinsChanged) {
      // A changed pin moves that characteristic only; the dice, the age table and Luck stand.
      const characteristics = {...generated.characteristics};
      for (const [abbr, pin] of entries(pins.characteristics)) characteristics[abbr] = Math.trunc(number(row(pin).value));
      const derived = await this.setup.chargen.derive(characteristics, number(row(row(row(previous.sheet).creation).age).mov_penalty));
      generated = {...generated, characteristics, derived: derived.values, trace: {...generated.trace, derived: derived.trace}};
    }
    const soft = isJsonObject(previous.soft) ? previous.soft as unknown as Soft : {occupation: {}, interest: {}};
    const built = await this.assemble({profile, era, authoredEra, seed, generated, pins, previous: {soft, credit: number(row(previous.sheet).credit_rating),
      occupationSkills: array(row(previous.profile).occupation_skills).map(string), interestSkills: array(row(previous.profile).interest_skills).map(string)},
      relax, difficulty: meta.difficulty ?? null, spreadAll: params.auto_spread === true, language});
    const applied = [...Object.keys(patch), ...(params.numbers != null ? ['numbers'] : []), ...(params.limits != null ? ['limits'] : []), ...(params.auto_spread === true ? ['auto_spread'] : []), ...(options.reroll ? ['reroll'] : [])].sort();
    if (!options.reroll && !options.dryRun && equal(built.sheet, previous.sheet) && equal(profile, previous.profile) && equal(pins, priorPins) && equal(relax, previous.limits_override ?? {})) return this.result(previous, {applied: [], ...resolution});
    const draft: Row = {revision: number(previous.revision) + 1, play_language: language, seed, profile, sheet: built.sheet, pins, soft: built.soft, budget: built.budget,
      generation: {method: generated.method, seed}, input_key: params.input_key ?? null, receipt: built.receipt};
    if (Object.keys(relax).length) draft.limits_override = relax;
    if (options.dryRun) { draft.limits = limitsOf(this.setup.chargen, row(draft.sheet), relax); return this.result(draft, {applied, ...resolution, dry_run: true}); }
    await this.write(campaign, meta, draft);
    return this.result(draft, {applied, ...resolution});
  }
  /** The generation the previous card holds, carried unchanged. */
  private carried(previous: Row): {characteristics: Row; derived: Row; trace: Row; method: string} {
    const sheet = row(previous.sheet), creation = row(sheet.creation);
    const {skills: _skills, allocation: _a, interest_allocation: _i, finance: _f, equipment: _e, pins: _p, ...trace} = creation;
    return {characteristics: clone(row(sheet.characteristics)), derived: clone(row(sheet.derived)), trace: clone(trace), method: string(creation.method)};
  }
  /** The card's edit control (contract §23.4): `edits` are `numbers`, `limits_override` is `limits`. */
  async override(params: Row): Promise<Row> {
    return this.locked(params, async campaign => {
      const meta = await campaign.readCampaign(); this.settingUp(meta);
      const previous = await this.load(campaign, meta);
      if (!previous || !equal(params.revision, previous.revision)) throw new RpcError('idempotency_conflict', 'The override does not apply to the current draft', {codeDetail: 'stale_draft'});
      const edits = params.edits;
      if (!isJsonObject(edits) || Object.keys(edits).some(key => !NUMBER_FIELDS.includes(key))) throw new RpcError('invalid_params', 'edits contains unknown fields', {details: {fields: [...NUMBER_FIELDS].sort()}});
      const limits = Object.hasOwn(params, 'limits_override') ? params.limits_override : undefined;
      return this.reviseLocked(campaign, meta, previous, {campaign: params.campaign, numbers: edits, ...(limits !== undefined ? {limits} : {}), by: 'player'}, {dryRun: params.dry_run === true});
    });
  }
  /** The only call that rolls again (§98); the pins stay unless `keep_pins: false`. */
  async reroll(params: Row): Promise<Row> {
    return this.locked(params, async campaign => {
      const meta = await campaign.readCampaign(); this.settingUp(meta);
      const previous = await this.load(campaign, meta);
      if (!previous) throw new RpcError('needs', 'There is no card to reroll yet: draft one first', {details: {next: 'setup.draft'}});
      const drop = params.keep_pins === false;
      const base = drop ? {...previous, pins: {...clone(previous.pins ?? emptyPins()), characteristics: {}}} : previous;
      return this.reviseLocked(campaign, meta, base, {campaign: params.campaign, revision: params.revision, input_key: params.input_key}, {reroll: true});
    });
  }
  /** One gate (§98): this is the current card, and it was not drawn in the same breath as the approval. */
  async confirm(params: Row): Promise<Row> {
    return this.locked(params, async campaign => {
      const meta = await campaign.readCampaign(), draft = await this.load(campaign, meta), pinned = params.revision !== undefined && params.revision !== null;
      if (!draft || (pinned && !equal(params.revision, draft.revision))) throw new RpcError('idempotency_conflict', 'Confirm the current draft; no new card was written', {codeDetail: 'stale_draft'});
      const state = meta.setup, consent = params.consent;
      if (!['approved', 'delegated'].includes(consent)) throw new RpcError('invalid_params', 'consent must be approved or explicitly delegated');
      if (jsonDigest(draft.sheet) !== draft.digest) throw new RpcError('idempotency_conflict', 'The immutable draft was altered');
      if (equal(state.confirmed_revision, draft.revision)) return {...await this.result(draft), committed: true, replayed: true};
      if (meta.status !== 'setting_up') throw new RpcError('invalid_params', 'the campaign is no longer accepting character changes');
      if (consent === 'approved' && truth(draft.input_key) && equal(draft.input_key, params.input_key)) throw new RpcError('needs', 'Wait for the next player message to approve the displayed draft', {codeDetail: 'confirmation_required'});
      const issues = completeness(draft.sheet);
      if (issues.length) throw new RpcError('needs', 'This draft is incomplete', {details: {issues}});
      if (await this.setup.context.snapshots.pathExists(campaign.path('party/investigator.json')) && !equal(await campaign.read('party/investigator.json'), draft.sheet)) throw new RpcError('idempotency_conflict', 'A different investigator already occupies this campaign slot');
      const pending = params.pending_action;
      if (truth(pending)) {
        if (typeof pending !== 'string' || !array(params.player_requests).some(request => typeof request === 'string' && request.includes(pending))) throw new RpcError('invalid_params', 'pending_action must quote a real player request');
        state.prologue ??= {}; state.prologue.pending_action = pending;
      }
      await this.setup.writer.startSetupWorld(campaign, meta); await campaign.writeSheet(draft.sheet);
      state.confirmed_revision = draft.revision; state.receipts = [...array(state.receipts), draft.receipt];
      if (truth(state.prologue)) { state.prologue.last_exchange = string(params.last_exchange || ''); state.prologue.introduction = {name: draft.sheet.name, occupation: draft.sheet.occupation}; }
      meta.investigators = ['investigator']; await campaign.writeCampaign(meta);
      return {...await this.result(draft), committed: true};
    });
  }
  /** The catalog the setup prompt is given once (§98). */
  async catalog(params: Row): Promise<Row> {
    const campaign = await this.setup.campaign(params), meta = await campaign.readCampaign();
    return this.setup.catalog.compact(await playLanguageOf(this.setup.context, meta));
  }
  /** The campaign's mod lock as setup sees it: world.mods once the world exists, else the pending lock (§26). */
  async modLock(campaign: CampaignWriter, meta: Row): Promise<Row> {
    return row(await this.setup.context.snapshots.pathExists(campaign.path('world.json')) ? row(await campaign.readWorld()).mods : meta.mods_pending);
  }
  /** Contract §26 Guided Creation: what the model read from the player, one slot at a time, and the
   *  count of guiding turns. The host computes the move from these; the kernel keeps them. */
  async note(params: Row): Promise<Row> {
    return this.locked(params, async campaign => {
      const meta = await campaign.readCampaign(), state = meta.setup ??= {};
      if (meta.status !== 'setting_up') throw new RpcError('invalid_params', 'setup notes belong to setup');
      if (truth(state.confirmed_revision)) throw new RpcError('campaign_not_ready', 'The confirmed card cannot be revised through notes');
      const notes: Row = isJsonObject(state.notes) ? state.notes : {slots: {}, turns: 0};
      notes.slots = isJsonObject(notes.slots) ? notes.slots : {}; notes.turns = integer(notes.turns) ? number(notes.turns) : 0;
      if (params.advance === true) {
        if (Object.hasOwn(params, 'slot')) throw new RpcError('invalid_params', 'advance counts a turn; a note fills a slot; send one or the other');
        notes.turns += 1;
      } else {
        const mods = await setupModContext(this.setup.context, await this.modLock(campaign, meta)), slots = array(mods.slots);
        const known = slots.map((slot: Row) => string(slot.id)), slot = params.slot;
        if (typeof slot !== 'string' || (!known.includes(slot) && slot !== SETUP_SLOT_STOP)) throw new RpcError('needs', 'note.slot must be an active setup slot or stop',
          {details: {field: 'slot', options: [...known, SETUP_SLOT_STOP], active: array(mods.active).map((mod: Row) => mod.id)}});
        const value = params.value;
        if (typeof value !== 'string' || !value.trim() || Array.from(value).length > NOTE_VALUE_LIMIT) throw new RpcError('invalid_params', `note.value is the player's words, a non-empty string of at most ${NOTE_VALUE_LIMIT} characters`);
        const origins = array(row(this.setup.chargen.policy.aptitude).origins).map(string), origin = Object.hasOwn(params, 'origin') ? params.origin : 'player';
        if (typeof origin !== 'string' || !origins.includes(origin)) throw new RpcError('invalid_params', `note.origin must be one of ${repr(origins)}`, {details: {field: 'origin', options: origins}});
        if (slot === SETUP_SLOT_STOP && origin !== 'player') throw new RpcError('invalid_params', 'only the player ends the exchange');
        notes.slots[slot] = {value: value.trim(), origin, turn: notes.turns};
      }
      state.notes = notes; await campaign.writeCampaign(meta);
      return {notes: clone(notes)};
    });
  }
  async prologue(params: Row): Promise<Row> {
    return this.locked(params, async campaign => {
      const meta = await campaign.readCampaign(), state = meta.setup ??= {};
      if (truth(state.prologue)) return {recorded: true};
      if (meta.status !== 'setting_up') throw new RpcError('invalid_params', 'prologue recording belongs to setup');
      const graph = (await loadModule(this.setup.context, meta.module_id, campaign.id)).graph, scene = graph.scene(params.scene);
      const selected = truth(meta.opening_scene) ? graph.scene(meta.opening_scene) : graph.startScene();
      if (graph.handle(scene) !== graph.handle(selected)) throw new RpcError('invalid_params', 'the prologue must use the authored opening scene');
      const guide = params.guide ?? null;
      if (truth(guide)) { const npc = graph.npc(guide), present = graph.sceneNpcIds(scene); if (!present.includes(graph.handle(npc)) && !present.includes(npc.node_id)) throw new RpcError('invalid_params', 'the guide must be present in the opening'); }
      state.prologue = {scene: graph.displayName(scene), guide, opening: string(params.text || ''), handoff: string(params.handoff || '')};
      await campaign.writeCampaign(meta); return {recorded: true};
    });
  }
}
