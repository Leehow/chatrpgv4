/** Immutable calculated drafts, rendered-preview acknowledgment and exact-sheet confirmation. */
import { join } from 'node:path';
import { RpcError } from '../errors.js';
import { compareUnicode, isJsonObject, jsonDigest } from '../json.js';
import { withExclusiveLock } from '../locks.js';
import { playerGlossary } from '../read/handlers.js';
import { playLanguageOf } from '../read/languages.js';
import { loadModule } from '../read/campaign.js';
import { row, array, clone, entries, string, number, integer, normalize, truth, equal, repr, type Row } from '../read/values.js';
import { moduleEra } from '../library/index.js';
import { setupModContext, SETUP_SLOT_STOP } from '../read/mods.js';
const APTITUDE_CAPABILITY = 'setup.aptitude.v1';
const NOTE_VALUE_LIMIT = 400;
import type { CampaignWriter } from '../write/store.js';
import type { Setup } from './index.js';
import { ChargenError, parseFormula, evaluateFormula } from './chargen.js';
import { BACKSTORY, completeness, nonempty } from './sheet.js';
const FIELDS = ['name', 'occupation', 'age', 'sex', 'concept', 'occupation_skills', 'interest_skills', 'own_language', 'backstory', 'key_connection', 'equipment', 'weapons', 'era', 'aptitude', 'occupation_stated'];
const APTITUDE = ['strong', 'weak'], APTITUDE_FIELDS = [...APTITUDE, 'origin'];
/** The manual override edits numbers only; identity stays conversational (contract §23.4). */
const EDIT_FIELDS = ['characteristics', 'skills', 'credit_rating'];
/** Every weapon profile the rules tables print, reachable by the table id or by the printable name,
 *  which is the pair `apply item weapon` already accepts (contract §19) — a gun named at creation and
 *  the same gun picked up in play resolve through one convention. The value carries the name the card
 *  takes, so a profile reached by its id is never written onto the sheet as the id. The index is
 *  deliberately whole: what validation accepts is exactly what the sheet can resolve. */
function weaponProfiles(catalog: Row): Map<string, [Row, string]> {
  const profiles = new Map<string, [Row, string]>();
  for (const [id, value] of entries(catalog)) {
    const entry = row(value), printable = truth(entry.display_name) ? string(entry.display_name) : id;
    for (const name of [id, printable]) profiles.set(normalize(name), [entry, printable]);
  }
  return profiles;
}
/** What the refusal offers: the era's own profiles when the draft names one, narrowing the suggestion
 *  without narrowing what is legal — the table has always accepted any era's entry here. */
function weaponOptions(profiles: Map<string, [Row, string]>, era: string): string[] {
  const offered = [...profiles.values()].filter(([entry]) => !era || !truth(entry.eras) || array(entry.eras).includes(era));
  return [...new Set((offered.length ? offered : [...profiles.values()]).map(([, printable]) => printable))].sort(compareUnicode);
}
const LIMITS_FIELDS = ['characteristic_min', 'characteristic_max', 'skill_cap', 'occupation_points', 'interest_points'];
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
  async result(draft: Row): Promise<Row> {
    const issues = completeness(draft.sheet);
    return {revision: draft.revision, sheet: draft.sheet, profile: draft.profile,
      labels: await playerGlossary(this.setup.context, await playLanguageOf(this.setup.context, draft)), completeness: {valid: !issues.length, issues},
      limits: draft.limits ?? await this.limits(draft)};
  }
  /** The rules the edit control renders, computed from Chargen and the draft's stored relaxations;
   *  formulas are evaluated on the given (or the draft's own) characteristics (contract §23.4). */
  async limits(draft: Row, card?: Row): Promise<Row> {
    const sheet = card ?? row(draft.sheet), characteristics = row(sheet.characteristics);
    const relax = isJsonObject(draft.limits_override) ? draft.limits_override : {};
    const bound = (key: string, fallback: number): number => Object.hasOwn(relax, key) ? Math.trunc(number(relax[key])) : fallback;
    const diff = this.setup.chargen.difficultyPolicy(row(sheet.creation).difficulty ?? null);
    const [minimum, maximum] = this.setup.chargen.creationBoundsFor(diff);
    const [, spec] = this.setup.chargen.occupation(sheet.occupation);
    const occupation = evaluateFormula(parseFormula(spec.skill_point_formula || ''), characteristics);
    const interest = evaluateFormula(parseFormula(string(this.setup.chargen.policy.formulas.personal_interest_points)), characteristics);
    return {characteristic_min: bound('characteristic_min', minimum), characteristic_max: bound('characteristic_max', maximum),
      skill_cap: bound('skill_cap', diff ? diff.effectiveCap(this.setup.chargen.cap) : this.setup.chargen.cap),
      occupation_points: bound('occupation_points', diff ? diff.adjustBudget('occupation', occupation.total) : occupation.total),
      interest_points: bound('interest_points', diff ? diff.adjustBudget('interest', interest.total) : interest.total),
      occupation_formula: occupation, interest_formula: interest,
      credit_rating_range: (truth(spec.credit_rating_range) ? array(spec.credit_rating_range) : [0, 0]).map(number),
      overridden: LIMITS_FIELDS.filter(key => Object.hasOwn(relax, key))};
  }
  async validateProfile(profile: Row): Promise<void> {
    const issues: string[] = [];
    for (const field of ['name', 'occupation', 'concept', 'own_language']) if (!nonempty(profile[field])) issues.push(`${field} is required`);
    if (!nonempty(profile.sex)) issues.push('sex is required; draft the words the player used or your best reading, in the play language — the player corrects it on the card');
    const raw = profile.backstory, story = row(raw);
    if (!isJsonObject(raw) || Object.keys(story).some(key => ![...BACKSTORY, 'scenario_bound'].includes(key))) issues.push('backstory must use the declared categories');
    else if (BACKSTORY.filter(key => nonempty(story[key])).length < 3 || !nonempty(story.scenario_bound)) issues.push('supply 3-6 backstory categories and scenario_bound');
    if (!nonempty(story.personal_description)) issues.push('personal_description is required; supply visible appearance in the player language');
    const key = truth(profile.key_connection) ? profile.key_connection : {};
    if (!isJsonObject(key) || !BACKSTORY.includes(key.backstory_field as string) || !nonempty(key.summary) || !nonempty(story[string(key.backstory_field)])) issues.push('key_connection needs backstory_field and summary referring to a populated category');
    if (!Array.isArray(profile.equipment) || !profile.equipment.every(nonempty)) issues.push('equipment must list the ordinary items the draft says are carried');
    const skills = await this.setup.tables.skillsTable();
    const legal = (name: any): boolean => typeof name === 'string' && (Object.hasOwn(skills, name) || name.startsWith('Language (Other: ') && name.endsWith(')') && Array.from(name).length > 19);
    const occupations = profile.occupation_skills, interests = profile.interest_skills;
    if (!Array.isArray(occupations) || occupations.length !== 8 || !occupations.every(legal) || new Set(occupations).size !== 8) issues.push('occupation_skills must name eight distinct concrete catalog skills');
    if (!Array.isArray(interests) || !interests.length || !interests.every(legal) || new Set(interests).size !== interests.length) issues.push('interest_skills must name distinct concrete skills chosen for this person');
    if ([...array(occupations), ...array(interests)].some(name => typeof name === 'string' && ['Cthulhu Mythos', 'Credit Rating'].includes(name))) issues.push('Credit Rating is allocated separately; no starting Cthulhu Mythos');
    try {
      const [, occupation] = this.setup.chargen.occupation(profile.occupation ?? null);
      const required = array(occupation.occupational_skills).map(name => this.setup.chargen.catalogName(name));
      const missing = required.filter(name => name && Array.isArray(occupations) && !occupations.includes(name));
      if (missing.length) issues.push(`retain required occupation skills: ${repr(missing)}`);
    } catch (error) { if (!(error instanceof ChargenError)) throw error; issues.push('occupation must be a listed occupation'); }
    const weapons = Object.hasOwn(profile, 'weapons') ? profile.weapons : [];
    const profiles = weaponProfiles(await this.setup.tables.weaponsTable());
    const unknown = Array.isArray(weapons) ? weapons.filter(name => typeof name !== 'string' || !profiles.has(normalize(name))) : null;
    if (unknown === null) issues.push('weapons is a list of rulebook profile names, or omitted');
    else if (unknown.length) issues.push(`the rules tables print no weapon profile named ${repr(unknown[0])}; name one of details.weapons. A weapon the rulebook does not print is not a profile: leave it out of weapons and list it in equipment under the name the player used`);
    // The player's own words for the trade, kept beside the catalog entry so a substitution is never silent (§23.4).
    const stated = Object.hasOwn(profile, 'occupation_stated') ? profile.occupation_stated : null;
    if (stated !== null && (typeof stated !== 'string' || !stated.trim())) issues.push('occupation_stated is the player\'s own words for the trade, a non-empty string, or omitted');
    const aptitude = Object.hasOwn(profile, 'aptitude') ? profile.aptitude : null;
    if (aptitude !== null && (!isJsonObject(aptitude) || Object.keys(aptitude).some(key => !APTITUDE_FIELDS.includes(key))
      || APTITUDE.some(key => Object.hasOwn(aptitude, key) && (!Array.isArray(aptitude[key]) || !aptitude[key].every((abbr: unknown) => typeof abbr === 'string')))))
      issues.push('aptitude names strong/weak characteristics and the origin that named them');
    if (issues.length) throw new RpcError('needs', 'Complete the semantic profile without interviewing for ordinary missing details', {
      details: {issues, backstory_fields: [...BACKSTORY], skills: Object.keys(skills), language_specialty: 'Language (Other: English)',
        weapons: weaponOptions(profiles, string(profile.era ?? '')),
        occupations: this.setup.chargen.occupations(), aptitude: {directions: [...APTITUDE], characteristics: this.setup.chargen.characteristics,
          origins: [...array(row(this.setup.chargen.policy.aptitude).origins)]}}});
  }
  async draft(params: Row): Promise<Row> {
    return this.locked(params, async campaign => {
      const meta = await campaign.readCampaign();
      if (meta.status !== 'setting_up') throw new RpcError('invalid_params', 'the campaign is no longer accepting drafts');
      const previous = await this.load(campaign, meta), patch = params.profile;
      if (!isJsonObject(patch) || Object.keys(patch).some(key => !FIELDS.includes(key))) throw new RpcError('invalid_params', 'profile contains unknown fields', {details: {fields: [...FIELDS].sort()}});
      const profile = {...previous?.profile ?? {}, ...patch};
      await this.validateProfile(profile);
      if (previous && equal(profile, previous.profile)) return this.result(previous);
      if (truth(row(meta.setup).confirmed_revision)) throw new RpcError('campaign_not_ready', 'The confirmed card cannot be replaced during handoff');
      const state = meta.setup ??= {};
      const seed = previous ? previous.seed : truth(state.draft_seed) ? state.draft_seed : string(this.setup.context.rng.getrandbits(64));
      if (!Object.hasOwn(state, 'draft_seed')) { state.draft_seed = seed; await campaign.writeCampaign(meta); }
      const graph = (await loadModule(this.setup.context, meta.module_id, campaign.id)).graph;
      const selected = truth(meta.opening_scene) ? graph.scene(meta.opening_scene) : graph.startScene();
      const sourceEra = row(row(selected.properties).investigator_setup).era || moduleEra(graph), periods = Object.keys(row(await this.setup.tables.load('cash-assets')).periods);
      const era = profile.era || sourceEra || '1920s';
      if (!periods.includes(era)) throw new RpcError('needs', 'No applicable rulebook finance period has been selected for the authored era', {
        fix: 'Choose profile.era from the returned options only when it matches the source setting, then retry in this turn. If no period applies, keep setup blocked; do not approximate or invent finance tables. Do not ask the player to fix a system parameter.',
        details: {field: 'era', source_era: sourceEra, options: periods}});
      // Prose moves a characteristic only through a package that opened that door (§23.4, §26).
      let stated: Row | null = null;
      try { stated = this.setup.chargen.aptitude(profile.aptitude ?? null); }
      catch (error) { if (!(error instanceof ChargenError)) throw error; throw new RpcError('needs', error.message, {details: {expected: error.expected}}); }
      if (stated) {
        const mods = await setupModContext(this.setup.context, await this.modLock(campaign, meta));
        if (!array(mods.capabilities).includes(APTITUDE_CAPABILITY)) throw new RpcError('needs', 'A stated aptitude needs an active setup package that provides characteristic assignment; without one the characteristics are the dice',
          {fix: 'Omit profile.aptitude and let the rolled characteristics stand, or enable a package that requires setup.aptitude.v1 in the Mods panel', details: {capability: APTITUDE_CAPABILITY, active: array(mods.active).map((mod: Row) => mod.id)}});
      }
      let sheet: Row, receipt: Row;
      try { [sheet, receipt] = await this.setup.chargen.build({investigatorId: 'investigator', name: profile.name, occupationId: profile.occupation, concept: profile.concept,
        age: Object.hasOwn(profile, 'age') ? profile.age : 27, sex: profile.sex ?? null, method: 'rolled', seed, era, difficulty: meta.difficulty ?? null, aptitude: profile.aptitude ?? null,
        occupationSkills: profile.occupation_skills, interestSkills: profile.interest_skills}); }
      catch (error) { if (!(error instanceof ChargenError) && (!(error instanceof Error) || !['ValueError', 'KeyError'].includes(error.name))) throw error;
        throw new RpcError('needs', error.message, {details: {expected: error instanceof ChargenError ? error.expected : null}}); }
      sheet.backstory = clone(profile.backstory); sheet.key_connection = clone(profile.key_connection); sheet.own_language = profile.own_language; sheet.equipment = [...profile.equipment];
      sheet.backstory.concept = profile.concept; sheet.occupation_stated = typeof profile.occupation_stated === 'string' ? profile.occupation_stated.trim() : null;
      const drafted = weaponProfiles(await this.setup.tables.weaponsTable());
      sheet.weapons = array(profile.weapons).map(written => { const [entry, printable] = drafted.get(normalize(string(written)))!; return {name: printable, ...entry}; });
      for (const weapon of array(sheet.weapons)) if (!sheet.equipment.includes(weapon.name)) sheet.equipment.push(weapon.name);
      sheet.current_hp = sheet.derived.HP; sheet.current_mp = sheet.derived.MP; sheet.current_san = sheet.derived.SAN; sheet.current_luck = sheet.characteristics.LUCK;
      const issues = completeness(sheet);
      if (issues.length) throw new RpcError('needs', 'The card is incomplete', {details: {issues}});
      const revision = number(previous?.revision) + 1;
      const inherited = isJsonObject(previous?.limits_override) ? previous.limits_override : null;
      const draft: Row = {revision, play_language: await playLanguageOf(this.setup.context, meta), seed, profile, sheet, input_key: params.input_key ?? null, receipt, digest: jsonDigest(sheet),
        limits: await this.limits({limits_override: inherited}, sheet)};
      if (inherited) draft.limits_override = inherited;
      await campaign.write(join('setup', 'drafts', `${revision}.json`), draft);
      meta.setup = {...row(meta.setup), draft_revision: revision, previewed_revision: null}; await campaign.writeCampaign(meta);
      return this.result(draft);
    });
  }
  async previewed(params: Row): Promise<Row> {
    return this.locked(params, async campaign => {
      const meta = await campaign.readCampaign(), draft = await this.load(campaign, meta);
      if (!draft || !equal(params.revision, draft.revision)) throw new RpcError('idempotency_conflict', 'The preview is not the current draft', {codeDetail: 'stale_draft'});
      meta.setup.previewed_revision = draft.revision; await campaign.writeCampaign(meta);
      return {previewed: true, revision: draft.revision};
    });
  }
  async confirm(params: Row): Promise<Row> {
    return this.locked(params, async campaign => {
      const meta = await campaign.readCampaign(), draft = await this.load(campaign, meta), pinned = params.revision !== undefined && params.revision !== null;
      if (!draft || (pinned && !equal(params.revision, draft.revision))) throw new RpcError('idempotency_conflict', 'Confirm the current draft; no new card was written', {codeDetail: 'stale_draft'});
      const state = meta.setup, consent = params.consent;
      if (!['approved', 'delegated'].includes(consent)) throw new RpcError('invalid_params', 'consent must be approved or explicitly delegated');
      if (jsonDigest(draft.sheet) !== draft.digest) throw new RpcError('idempotency_conflict', 'The immutable draft was altered');
      if (equal(state.confirmed_revision, draft.revision)) return {...await this.result(draft), committed: true, replayed: true};
      if (meta.status !== 'setting_up') throw new RpcError('invalid_params', 'the campaign is no longer accepting character changes');
      if (consent === 'approved' && !equal(state.previewed_revision, draft.revision)) throw new RpcError('needs', 'Wait until the current complete card is displayed before confirmation', {codeDetail: 'preview_required'});
      if (consent === 'approved' && truth(draft.input_key) && equal(draft.input_key, params.input_key)) throw new RpcError('needs', 'Wait for the next player message to approve the displayed draft', {codeDetail: 'confirmation_required'});
      if (completeness(draft.sheet).length) throw new RpcError('needs', 'This draft is incomplete');
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
  /** Structured numeric edit of the current draft, host-only behind the card's edit control (contract §23.4).
   *  Rebuilds the sheet from the stored draft: edited characteristics, bases recomputed through
   *  Chargen.skillBase with every skill's recorded investment held, budgets charged against formulas
   *  evaluated on the new characteristics, derived values recomputed with the stored age MOV penalty. */
  async override(params: Row): Promise<Row> {
    return this.locked(params, async campaign => {
      const meta = await campaign.readCampaign();
      if (meta.status !== 'setting_up') throw new RpcError('invalid_params', 'the campaign is no longer accepting drafts');
      const base = await this.load(campaign, meta);
      if (!base || !equal(params.revision, base.revision)) throw new RpcError('idempotency_conflict', 'The override does not apply to the current draft', {codeDetail: 'stale_draft'});
      if (truth(row(meta.setup).confirmed_revision)) throw new RpcError('campaign_not_ready', 'The confirmed card cannot be replaced during handoff');
      const edits = params.edits;
      if (!isJsonObject(edits) || Object.keys(edits).some(key => !EDIT_FIELDS.includes(key)))
        throw new RpcError('invalid_params', 'edits contains unknown fields', {details: {fields: [...EDIT_FIELDS].sort()}});
      const carried = Object.hasOwn(params, 'limits_override') ? params.limits_override : base.limits_override;
      if (carried != null && (!isJsonObject(carried) || Object.keys(carried).some(key => !LIMITS_FIELDS.includes(key)) || Object.values(carried).some(value => !integer(value))))
        throw new RpcError('invalid_params', 'limits_override relaxes only the declared numeric bounds', {details: {fields: [...LIMITS_FIELDS].sort()}});
      const relax: Row = isJsonObject(carried) ? carried : {};
      const bound = (key: string, fallback: number): number => Object.hasOwn(relax, key) ? Math.trunc(number(relax[key])) : fallback;
      const baseSheet = row(base.sheet), stored = row(baseSheet.characteristics), characteristics: Row = {...stored};
      const diff = this.setup.chargen.difficultyPolicy(row(baseSheet.creation).difficulty ?? null);
      const cap = bound('skill_cap', diff ? diff.effectiveCap(this.setup.chargen.cap) : this.setup.chargen.cap);
      const legalCharacteristics = [...this.setup.chargen.characteristics, 'LUCK'];
      const characteristicEdits = edits.characteristics ?? {};
      if (!isJsonObject(characteristicEdits) || Object.keys(characteristicEdits).some(key => !legalCharacteristics.includes(key)))
        throw new RpcError('invalid_params', 'edits.characteristics covers only the nine abbreviations', {details: {fields: [...legalCharacteristics].sort()}});
      for (const [abbr, value] of entries(characteristicEdits)) {
        if (!integer(value)) throw new RpcError('invalid_params', `edits.characteristics.${abbr} must be an integer`);
        const [poolMin, poolMax] = this.setup.chargen.characteristicBounds(diff, abbr);
        const lo = bound('characteristic_min', poolMin), hi = bound('characteristic_max', poolMax);
        if (number(value) < lo || number(value) > hi)
          throw new RpcError('needs', 'A characteristic stays within its creation bounds', {details: {field: abbr, range: [lo, hi], attempted: number(value)}});
        characteristics[abbr] = Math.trunc(number(value));
      }
      const listed = row(baseSheet.skills), names = Object.keys(listed);
      const bases: Row = {}, rebuilt: Row = {};
      for (const name of names) {
        if (name === 'Credit Rating') { rebuilt[name] = number(listed[name]); continue; }
        bases[name] = this.setup.chargen.skillBase(name, characteristics);
        rebuilt[name] = bases[name] + number(listed[name]) - this.setup.chargen.skillBase(name, stored);
      }
      const skillEdits = edits.skills ?? {};
      if (!isJsonObject(skillEdits)) throw new RpcError('invalid_params', 'edits.skills must be an object over skills already on the sheet');
      for (const [name, value] of entries(skillEdits)) {
        if (name === 'Cthulhu Mythos') throw new RpcError('needs', 'Cthulhu Mythos is never a creation skill', {details: {field: name}});
        if (name === 'Credit Rating') throw new RpcError('invalid_params', 'Credit Rating is not a skill edit; use edits.credit_rating', {details: {field: 'credit_rating'}});
        if (!Object.hasOwn(listed, name)) throw new RpcError('needs', 'A manual edit cannot add a skill to the sheet', {details: {field: name, skills: names}});
        if (!integer(value)) throw new RpcError('invalid_params', `edits.skills must hold integers (${repr(name)})`);
        if (number(value) < bases[name] || number(value) > cap)
          throw new RpcError('needs', 'A skill stays between its recomputed base and the starting cap', {details: {field: name, range: [bases[name], Math.max(cap, bases[name])], attempted: number(value)}});
        rebuilt[name] = Math.trunc(number(value));
      }
      const [, spec] = this.setup.chargen.occupation(baseSheet.occupation);
      const creditRange = (truth(spec.credit_rating_range) ? array(spec.credit_rating_range) : [0, 0]).map(number);
      let credit = number(rebuilt['Credit Rating']);
      if (Object.hasOwn(edits, 'credit_rating')) {
        const value = edits.credit_rating;
        if (!integer(value)) throw new RpcError('invalid_params', 'edits.credit_rating must be an integer');
        if (number(value) < creditRange[0] || number(value) > creditRange[1])
          throw new RpcError('needs', 'Credit Rating stays within the occupation range', {details: {field: 'credit_rating', range: creditRange, attempted: number(value)}});
        credit = Math.trunc(number(value)); rebuilt['Credit Rating'] = credit;
      }
      let occupational = array(row(row(row(baseSheet.creation).skills).occupation).resolved).map(string).filter(name => name !== 'Credit Rating' && Object.hasOwn(rebuilt, name));
      if (!occupational.length) {
        for (const phrase of array(spec.occupational_skills)) {
          const found = this.setup.chargen.catalogName(string(phrase));
          if (found && Object.hasOwn(rebuilt, found) && !occupational.includes(found)) occupational.push(found);
        }
      }
      const occupation = evaluateFormula(parseFormula(spec.skill_point_formula || ''), characteristics);
      const interest = evaluateFormula(parseFormula(string(this.setup.chargen.policy.formulas.personal_interest_points)), characteristics);
      const above = (name: string): number => number(rebuilt[name]) - number(bases[name]);
      const occupationalSpend = occupational.reduce((total, name) => total + above(name), 0) + credit;
      const others = names.filter(name => name !== 'Credit Rating' && !occupational.includes(name));
      const interestSpend = others.reduce((total, name) => total + above(name), 0);
      const refusePool = (pool: string, total: number, spend: number, fields: string[], creditInPool: boolean): never => {
        const editedSkill = Object.keys(skillEdits).find(name => fields.includes(name));
        let field: string, range: number[];
        if (editedSkill) { field = editedSkill; range = [bases[editedSkill], cap]; }
        else if (creditInPool && Object.hasOwn(edits, 'credit_rating')) { field = 'credit_rating'; range = creditRange; }
        else if (fields.length) { field = fields.reduce((carry, name) => above(name) >= above(carry) ? name : carry, fields[0]); range = [bases[field], Math.max(cap, bases[field])]; }
        else { field = creditInPool ? 'credit_rating' : `${pool}_points`; range = creditInPool ? creditRange : [0, total]; }
        throw new RpcError('needs', `The ${pool} point budget is exceeded`, {details: {pool, total, spend, field, range}});
      };
      const occupationTotal = diff ? diff.adjustBudget('occupation', occupation.total) : occupation.total;
      const interestTotal = diff ? diff.adjustBudget('interest', interest.total) : interest.total;
      if (occupationalSpend > bound('occupation_points', occupationTotal)) refusePool('occupation', bound('occupation_points', occupationTotal), occupationalSpend, occupational, true);
      if (interestSpend > bound('interest_points', interestTotal)) refusePool('interest', bound('interest_points', interestTotal), interestSpend, others, false);
      // The ledger is rewritten to the manual allocation it now holds (contract §23.4): the saved
      // card's budget table shows these numbers, never the rolled ledger this override replaced.
      const effectiveOccupation = bound('occupation_points', occupationTotal), effectiveInterest = bound('interest_points', interestTotal);
      const occupationalPoints = Math.max(0, effectiveOccupation - credit), occupationalPointsSpent = occupationalSpend - credit;
      const ledger = row(row(baseSheet.creation).skills), occupationLedger = row(ledger.occupation), interestLedger = row(ledger.interest);
      const skillsLedger = {...ledger,
        occupation: {...occupationLedger, budget: {...occupation, total: effectiveOccupation}, points: occupationalPoints, spent: occupationalPointsSpent, unspent: occupationalPoints - occupationalPointsSpent,
          credit_rating: {...row(occupationLedger.credit_rating), value: credit},
          allocations: Object.fromEntries(occupational.filter(name => above(name) > 0).map(name => [name, above(name)]))},
        interest: {...interestLedger, budget: {...interest, total: effectiveInterest}, spent: interestSpend, unspent: effectiveInterest - interestSpend,
          allocations: Object.fromEntries(others.filter(name => above(name) > 0).map(name => [name, above(name)]))}};
      // A credit_rating edit recomputes wealth through the era's cash-assets table, so the card's
      // finance line agrees with its rating (contract §23.4); the table failing reads as no finance.
      let finance = truth(baseSheet.finance) ? baseSheet.finance : null, cash = truth(baseSheet.cash) ? baseSheet.cash : null;
      if (Object.hasOwn(edits, 'credit_rating')) {
        try { finance = await this.setup.tables.cashAndAssets(credit, string(baseSheet.era)); cash = finance ? `${string(row(finance.cash).amount)} ${string(row(finance.cash).currency)}` : null; }
        catch (error) { if (!(error instanceof Error) || error.name !== 'ValueError') throw error; finance = null; cash = null; }
      }
      const derived = await this.setup.chargen.derive(characteristics, number(row(row(baseSheet.creation).age).mov_penalty));
      const sheet: Row = {...baseSheet, characteristics, derived: derived.values,
        skills: Object.fromEntries(entries(rebuilt).sort(([a], [b]) => compareUnicode(a, b))), credit_rating: credit, cash, finance,
        current_hp: derived.values.HP, current_mp: derived.values.MP, current_san: derived.values.SAN, current_luck: characteristics.LUCK,
        creation: {...row(baseSheet.creation), skills: skillsLedger, manual: {base_revision: base.revision, edits: clone(edits), limits_override: Object.keys(relax).length ? clone(relax) : null}}};
      const limits = await this.limits({limits_override: relax}, sheet);
      const revision = number(base.revision) + 1;
      if (truth(params.dry_run)) return this.result({revision, play_language: base.play_language, profile: base.profile, sheet, limits});
      const draft: Row = {revision, play_language: base.play_language, seed: base.seed, profile: base.profile, sheet, input_key: null,
        receipt: base.receipt, digest: jsonDigest(sheet), limits};
      if (Object.keys(relax).length) draft.limits_override = relax;
      await campaign.write(join('setup', 'drafts', `${revision}.json`), draft);
      meta.setup = {...row(meta.setup), draft_revision: revision, previewed_revision: null}; await campaign.writeCampaign(meta);
      return this.result(draft);
    });
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
