/** Setup methods use the same campaign writer and source-readiness owner as play. */
import { join } from 'node:path';
import type { KernelContext } from '../context.js';
import type { HandlerGroup } from '../handlers.js';
import { RpcError } from '../errors.js';
import { isJsonObject } from '../json.js';
import { loadModule } from '../read/campaign.js';
import { playLanguageOf } from '../read/languages.js';
import { array, row, clone, string, number, integer, truth, repr, type Row } from '../read/values.js';
import { RuleTables } from '../rules/tables.js';
import type { createWriteRuntime } from '../write/index.js';
import { type CampaignWriter, nowIso } from '../write/store.js';
import { commit, CommitFailed } from '../write/history.js';
import { moduleAvailable, moduleEra } from '../library/index.js';
import { Chargen, ChargenError, ALLOCATION_POLICIES, defaultInvestigatorId } from './chargen.js';
import { SetupSteps } from './steps.js';
import { SetupDrafts } from './drafts.js';
import { investigatorRow, completeness } from './sheet.js';

export class Setup {
  readonly drafts: SetupDrafts;
  private constructor(readonly context: KernelContext, readonly writer: ReturnType<typeof createWriteRuntime>, readonly tables: RuleTables,
    readonly steps: SetupSteps, readonly chargen: Chargen) { this.drafts = new SetupDrafts(this); }
  static async create(context: KernelContext, writer: ReturnType<typeof createWriteRuntime>): Promise<Setup> {
    const tables = new RuleTables(context), steps = await SetupSteps.create(context);
    return new Setup(context, writer, tables, steps, await Chargen.create(tables, steps.step('create-investigator')));
  }
  async moduleMeta(id: string): Promise<Row | null> {
    const path = join(this.context.stateRoot, 'modules', id, 'module.json');
    return await this.context.snapshots.pathExists(path) ? row(await this.context.snapshots.readJson(path)) : null;
  }
  async campaign(params: Row): Promise<CampaignWriter> { return this.writer.campaign(params, {requireTurn: false, requireWorld: false}); }
  async settingUp(params: Row): Promise<[CampaignWriter, Row]> {
    const campaign = await this.campaign(params), meta = await campaign.readCampaign();
    if (meta.status !== 'setting_up') throw new RpcError('campaign_not_ready', `campaign ${repr(campaign.id)} is ${repr(meta.status)}, not setting up`,
      {fix: 'setup methods only run while the campaign is setting_up', details: {status: meta.status ?? null}});
    await this.writer.startSetupWorld(campaign, meta); return [campaign, meta];
  }
  async stepsMethod(params: Row): Promise<Row> {
    const table = clone(this.steps.raw), id = params.campaign;
    if (typeof id !== 'string' || !id) return table;
    let campaign: CampaignWriter;
    try { campaign = await this.campaign(params); }
    catch (error) { if (error instanceof RpcError && error.code === 'campaign_not_found') return {...table, completed: [], state: {campaign: id}}; throw error; }
    const meta = await campaign.readCampaign(), moduleId = string(meta.module_id || ''), module = moduleId ? await this.moduleMeta(moduleId) : null;
    const starter = await this.context.snapshots.pathExists(join(this.context.content, 'starters', moduleId, 'module-graph.json'));
    const kind = starter ? 'starter' : meta.opening_scene != null ? 'module' : 'pdf', completed = new Set(['choose-source', 'create-campaign']);
    if (this.steps.applies('prepare-module', kind) && module && (module.status === 'installed' || module.opening_ready === true || Object.hasOwn(row(module.character_guidance), meta.guidance_key))) completed.add('prepare-module');
    const investigatorKinds = new Set<string>();
    for (const receipt of array(row(meta.setup).receipts)) if (isJsonObject(receipt) && receipt.kind === 'investigator') investigatorKinds.add(receipt.source === 'library' ? 'library' : 'new');
    if (investigatorKinds.has('new')) { completed.add('create-investigator'); completed.add('confirm-investigator'); }
    if (truth(row(meta.setup).draft_revision)) completed.add('create-investigator');
    if (investigatorKinds.has('library')) { completed.add('browse-library'); completed.add('load-investigator'); }
    if (['ready_for_table', 'active'].includes(meta.status)) completed.add('complete');
    const ordered = this.steps.order(new Set([kind, ...investigatorKinds])).filter(step => completed.has(step));
    const state: Row = {campaign: campaign.id, module_id: moduleId, module: moduleId, source: {kind, module_id: moduleId}, source_kind: kind, play_language: await playLanguageOf(this.context, meta)};
    const draft = await this.drafts.load(campaign, meta);
    if (draft) state.draft = await this.drafts.result(draft);
    state.prologue = row(meta.setup).prologue ?? null; state.guidance_key = meta.guidance_key ?? null; state.notes = row(meta.setup).notes ?? null;
    state.rulebook_eras = Object.keys(row(await this.tables.load('cash-assets')).periods);
    state.start_scene = meta.opening_scene ?? null; state.waiting_for_opening = truth(row(meta.setup).waiting_for_opening);
    return {...table, completed: ordered, state};
  }
  occupations(): Row { return {occupations: this.chargen.occupations(), source: 'content/rulesets/coc7/rules-json/occupations.json'}; }
  async investigator(params: Row): Promise<Row> {
    const [campaign, meta] = await this.settingUp(params), name = params.name;
    if (typeof name !== 'string' || !name.trim()) throw new RpcError('invalid_params', 'params.name must be a non-empty string');
    const defaults = row(this.steps.step('create-investigator').defaults), method = Object.hasOwn(params, 'method') ? params.method : defaults.method,
      age = Object.hasOwn(params, 'age') ? params.age : defaults.age, concept = params.concept ?? null, sex = params.sex ?? null;
    if (concept !== null && typeof concept !== 'string') throw new RpcError('invalid_params', 'params.concept must be a string');
    if (sex !== null && typeof sex !== 'string') throw new RpcError('invalid_params', 'params.sex must be a string');
    let seed = params.seed;
    if (seed == null) seed = string(this.context.rng.getrandbits(32));
    else if (!integer(seed) && typeof seed !== 'string') throw new RpcError('invalid_params', 'params.seed must be an integer or string');
    seed = string(seed);
    const allocation = params.allocation, interestAllocation = params.interest_allocation;
    for (const [field, value] of [['allocation', allocation], ['interest_allocation', interestAllocation]] as Array<[string, any]>)
      if (value != null && typeof value !== 'string') throw new RpcError('invalid_params', `params.${field} must be a policy name from the steps table`,
        {fix: 'use one of details.options: spread, fill', details: {field, options: [...ALLOCATION_POLICIES]}});
    const moduleId = string(meta.module_id), bookEra = await moduleAvailable(this.context, moduleId, this.writer) ? moduleEra((await loadModule(this.context, moduleId)).graph) : null;
    const era = truth(params.era) ? params.era : bookEra || '1920s';
    if (typeof era !== 'string') throw new RpcError('invalid_params', 'params.era must be a string');
    const party = await campaign.party(), id = truth(params.id) ? params.id : defaultInvestigatorId(name, party.length + 1);
    if (typeof id !== 'string' || !id.trim()) throw new RpcError('invalid_params', 'params.id must be a slug');
    if (party.some(sheet => string(sheet.id) === id)) throw new RpcError('invalid_params', `investigator ${repr(id)} already exists in this campaign`, {fix: 'give another id, or another name'});
    let sheet: Row, receipt: Row;
    try { [sheet, receipt] = await this.chargen.build({investigatorId: id, name, occupationId: params.occupation ?? null, concept, age, sex, method, seed, era, allocation, interestAllocation}); }
    catch (error) {
      if (!(error instanceof ChargenError)) throw error;
      if (error.stage === 'occupation') throw new RpcError('needs', error.message, {fix: 'call setup.occupations and pass one of its ids', details: {needs: {field: 'occupation', options: row(error.expected).options ?? null}}});
      throw new RpcError('invalid_params', error.message, {details: {stage: error.stage, expected: error.expected}});
    }
    sheet.current_hp = sheet.derived.HP; sheet.current_san = sheet.derived.SAN; sheet.current_mp = sheet.derived.MP; sheet.current_luck = sheet.characteristics.LUCK;
    await campaign.writeSheet(sheet);
    const block = {...row(meta.setup)}; block.receipts = [...array(block.receipts), {...receipt, at: nowIso()}]; meta.setup = block;
    meta.investigators = (await campaign.party()).map(card => string(card.id)); await campaign.writeCampaign(meta);
    return {receipt: receipt.id, investigator: investigatorRow(sheet), sheet, choices_pending: receipt.choices_pending, next: this.steps.nextLine('complete')};
  }
  async complete(params: Row): Promise<Row> {
    const campaign = await this.campaign(params); let meta = await campaign.readCampaign();
    if (['ready_for_table', 'active'].includes(meta.status) && truth(row(meta.setup).handoff)) return {...meta.setup.handoff, status: meta.status, replayed: true};
    if (meta.status !== 'setting_up') throw new RpcError('campaign_not_ready', `campaign ${repr(campaign.id)} is ${repr(meta.status)}`, {details: {status: meta.status ?? null}});
    const party = await campaign.party();
    if (!party.length) throw new RpcError('needs', 'the party is empty; create an investigator first', {fix: this.steps.nextLine('create-investigator'), details: {needs: {field: 'investigator', step: 'create-investigator'}}});
    const receipts = array(row(meta.setup).receipts), imported = Boolean(receipts.length) && receipts.filter(receipt => receipt.kind === 'investigator').every(receipt => receipt.source === 'library');
    const issues = imported ? [] : party.flatMap(completeness);
    if (issues.length) throw new RpcError('campaign_not_ready', 'Complete the actual card before opening play', {codeDetail: 'incomplete_investigator', details: {issues}});
    if (!imported && (!truth(row(meta.setup).confirmed_revision) || row(meta.setup).confirmed_revision !== row(meta.setup).draft_revision)) throw new RpcError('needs', 'Confirm the displayed draft before completing setup', {codeDetail: 'preview_required'});
    const moduleId = string(meta.module_id), module = await this.moduleMeta(moduleId);
    const ready = module && (truth(module.reading_version) ? await this.writer.setupOpeningReady(moduleId, meta.opening_scene || '') : module.status === 'installed' || module.opening_ready === true);
    if (!ready) {
      meta.setup ??= {}; meta.setup.waiting_for_opening = true; await campaign.writeCampaign(meta);
      throw new RpcError('campaign_not_ready', `module ${repr(moduleId)} is not installed and not opening_ready`,
        {fix: 'The confirmed investigator is retained. End this reply; the host will retry completion when the selected opening is ready. Do not recreate or reconfirm the card.', details: {reason: 'opening_preparing', start_scene: meta.opening_scene ?? null}});
    }
    const generation = Math.trunc(number(module!.generation || 0));
    if (await this.writer.startSetupWorld(campaign, meta)) meta = await campaign.readCampaign();
    const handoff: Row = {receipt: 'setup:handoff', module_id: moduleId, module_generation: generation, prologue: row(meta.setup).prologue ?? null,
      investigators: party.map(sheet => string(sheet.id)), at: nowIso(), launch: this.steps.launchLine(campaign.id)};
    const block: Row = {...row(meta.setup), handoff}; delete block.waiting_for_opening;
    meta.setup = block; meta.module_generation = generation; meta.status = 'ready_for_table'; await campaign.writeCampaign(meta);
    await campaign.appendEvent(0, {type: 'setup-completed', receipt: 'setup:handoff', data: {module_id: moduleId, module_generation: generation, investigators: handoff.investigators}});
    try { await commit(this.context, campaign.id, `campaign ${campaign.id}: setup handoff`); }
    catch (error) { if (!(error instanceof CommitFailed)) throw error; throw new RpcError('commit_failed', `could not commit the setup handoff: ${error.message}`); }
    return {...handoff, status: 'ready_for_table'};
  }
}
export function createSetupHandlers(context: KernelContext, writer: ReturnType<typeof createWriteRuntime>): HandlerGroup {
  let pending: Promise<Setup> | undefined;
  const setup = (): Promise<Setup> => pending ??= Setup.create(context, writer);
  return Object.freeze({
    'setup.steps': async params => (await setup()).stepsMethod(params),
    'setup.occupations': async () => (await setup()).occupations(),
    'setup.investigator': async params => (await setup()).investigator(params),
    'setup.complete': async params => (await setup()).complete(params),
    'setup.draft': async params => (await setup()).drafts.draft(params),
    'setup.previewed': async params => (await setup()).drafts.previewed(params),
    'setup.confirm': async params => (await setup()).drafts.confirm(params),
    'setup.override': async params => (await setup()).drafts.override(params),
    'setup.prologue': async params => (await setup()).drafts.prologue(params),
    'setup.note': async params => (await setup()).drafts.note(params),
  });
}
