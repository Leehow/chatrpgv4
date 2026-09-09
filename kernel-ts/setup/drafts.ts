/** Immutable calculated drafts, rendered-preview acknowledgment and exact-sheet confirmation. */
import { join } from 'node:path';
import { RpcError } from '../errors.js';
import { isJsonObject, jsonDigest } from '../json.js';
import { withExclusiveLock } from '../locks.js';
import { playerGlossary } from '../read/handlers.js';
import { loadModule } from '../read/campaign.js';
import { row, array, clone, string, number, truth, equal, repr, type Row } from '../read/values.js';
import { moduleEra } from '../library/index.js';
import { setupModContext } from '../read/mods.js';
const APTITUDE_CAPABILITY = 'setup.aptitude.v1';
import type { CampaignWriter } from '../write/store.js';
import type { Setup } from './index.js';
import { ChargenError } from './chargen.js';
import { BACKSTORY, completeness, nonempty } from './sheet.js';
const FIELDS = ['name', 'occupation', 'age', 'sex', 'concept', 'occupation_skills', 'interest_skills', 'own_language', 'backstory', 'key_connection', 'equipment', 'weapons', 'era', 'aptitude', 'occupation_stated'];
const APTITUDE = ['strong', 'weak'], APTITUDE_FIELDS = [...APTITUDE, 'origin'];
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
      labels: await playerGlossary(this.setup.context, draft.play_language ?? 'en'), completeness: {valid: !issues.length, issues}};
  }
  async validateProfile(profile: Row): Promise<void> {
    const issues: string[] = [];
    for (const field of ['name', 'occupation', 'concept', 'own_language']) if (!nonempty(profile[field])) issues.push(`${field} is required`);
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
    const weapons = Object.hasOwn(profile, 'weapons') ? profile.weapons : [], catalog = await this.setup.tables.weaponsTable();
    if (!Array.isArray(weapons) || !weapons.every(name => typeof name === 'string' && Object.hasOwn(catalog, name))) issues.push('weapons must use existing rulebook profile names');
    // The player's own words for the trade, kept beside the catalog entry so a substitution is never silent (§23.4).
    const stated = Object.hasOwn(profile, 'occupation_stated') ? profile.occupation_stated : null;
    if (stated !== null && (typeof stated !== 'string' || !stated.trim())) issues.push('occupation_stated is the player\'s own words for the trade, a non-empty string, or omitted');
    const aptitude = Object.hasOwn(profile, 'aptitude') ? profile.aptitude : null;
    if (aptitude !== null && (!isJsonObject(aptitude) || Object.keys(aptitude).some(key => !APTITUDE_FIELDS.includes(key))
      || APTITUDE.some(key => Object.hasOwn(aptitude, key) && (!Array.isArray(aptitude[key]) || !aptitude[key].every((abbr: unknown) => typeof abbr === 'string')))))
      issues.push('aptitude names strong/weak characteristics and the origin that named them');
    if (issues.length) throw new RpcError('needs', 'Complete the semantic profile without interviewing for ordinary missing details', {
      details: {issues, backstory_fields: [...BACKSTORY], skills: Object.keys(skills), language_specialty: 'Language (Other: English)',
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
      const graph = (await loadModule(this.setup.context, meta.module_id)).graph;
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
        const lock = await this.setup.context.snapshots.pathExists(campaign.path('world.json')) ? row(await campaign.readWorld()).mods : meta.mods_pending;
        const mods = await setupModContext(this.setup.context, row(lock));
        if (!array(mods.capabilities).includes(APTITUDE_CAPABILITY)) throw new RpcError('needs', 'A stated aptitude needs an active setup package that provides characteristic assignment; without one the characteristics are the dice',
          {fix: 'Omit profile.aptitude and let the rolled characteristics stand, or enable a package that requires setup.aptitude.v1 in the Mods panel', details: {capability: APTITUDE_CAPABILITY, active: array(mods.active).map((mod: Row) => mod.id)}});
      }
      let sheet: Row, receipt: Row;
      try { [sheet, receipt] = await this.setup.chargen.build({investigatorId: 'investigator', name: profile.name, occupationId: profile.occupation, concept: profile.concept,
        age: Object.hasOwn(profile, 'age') ? profile.age : 27, sex: profile.sex ?? null, method: 'rolled', seed, era, aptitude: profile.aptitude ?? null,
        occupationSkills: profile.occupation_skills, interestSkills: profile.interest_skills}); }
      catch (error) { if (!(error instanceof ChargenError) && (!(error instanceof Error) || !['ValueError', 'KeyError'].includes(error.name))) throw error;
        throw new RpcError('needs', error.message, {details: {expected: error instanceof ChargenError ? error.expected : null}}); }
      sheet.backstory = clone(profile.backstory); sheet.key_connection = clone(profile.key_connection); sheet.own_language = profile.own_language; sheet.equipment = [...profile.equipment];
      sheet.backstory.concept = profile.concept; sheet.occupation_stated = typeof profile.occupation_stated === 'string' ? profile.occupation_stated.trim() : null;
      sheet.weapons = await Promise.all(array(profile.weapons).map(async name => ({name, ...await this.setup.tables.weaponByName(name)})));
      for (const weapon of array(profile.weapons)) if (!sheet.equipment.includes(weapon)) sheet.equipment.push(weapon);
      sheet.current_hp = sheet.derived.HP; sheet.current_mp = sheet.derived.MP; sheet.current_san = sheet.derived.SAN; sheet.current_luck = sheet.characteristics.LUCK;
      const issues = completeness(sheet);
      if (issues.length) throw new RpcError('needs', 'The card is incomplete', {details: {issues}});
      const revision = number(previous?.revision) + 1;
      const draft = {revision, play_language: meta.play_language ?? 'en', seed, profile, sheet, input_key: params.input_key ?? null, receipt, digest: jsonDigest(sheet)};
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
      const meta = await campaign.readCampaign(), draft = await this.load(campaign, meta);
      if (!draft || !equal(params.revision, draft.revision)) throw new RpcError('idempotency_conflict', 'Confirm the current draft; no new card was written', {codeDetail: 'stale_draft'});
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
  async prologue(params: Row): Promise<Row> {
    return this.locked(params, async campaign => {
      const meta = await campaign.readCampaign(), state = meta.setup ??= {};
      if (truth(state.prologue)) return {recorded: true};
      if (meta.status !== 'setting_up') throw new RpcError('invalid_params', 'prologue recording belongs to setup');
      const graph = (await loadModule(this.setup.context, meta.module_id)).graph, scene = graph.scene(params.scene);
      const selected = truth(meta.opening_scene) ? graph.scene(meta.opening_scene) : graph.startScene();
      if (graph.handle(scene) !== graph.handle(selected)) throw new RpcError('invalid_params', 'the prologue must use the authored opening scene');
      const guide = params.guide ?? null;
      if (truth(guide)) { const npc = graph.npc(guide), present = graph.sceneNpcIds(scene); if (!present.includes(graph.handle(npc)) && !present.includes(npc.node_id)) throw new RpcError('invalid_params', 'the guide must be present in the opening'); }
      state.prologue = {scene: graph.displayName(scene), guide, opening: string(params.text || ''), handoff: string(params.handoff || '')};
      await campaign.writeCampaign(meta); return {recorded: true};
    });
  }
}
