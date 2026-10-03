/** Shipped investigator templates (contract §173): fixed sheets a host seats without a setup conversation. */
import { join } from 'node:path';
import type { KernelContext } from '../context.js';
import { RpcError } from '../errors.js';
import { isJsonObject, compareUnicode } from '../json.js';
import { loadModule } from '../read/campaign.js';
import { array, row, clone, string, repr, type Row } from '../read/values.js';
import type { createWriteRuntime } from '../write/index.js';
import { nowIso, type CampaignWriter } from '../write/store.js';
import { eraMismatch, moduleAvailable } from '../library/index.js';
import { defaultInvestigatorId } from './chargen.js';
import { investigatorRow } from './sheet.js';

const TEMPLATE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const TEMPLATE_SOURCE = 'template';

/** The template receipt a campaign already holds, if any: the replay key of `setup.template`. */
export function templateReceipt(meta: Row): Row | null {
  return array(row(meta.setup).receipts).find(receipt => isJsonObject(receipt) && receipt.kind === 'investigator' && receipt.source === TEMPLATE_SOURCE) ?? null;
}

export class InvestigatorTemplates {
  readonly root: string;
  constructor(readonly context: KernelContext, readonly writer: ReturnType<typeof createWriteRuntime>) { this.root = join(context.content, 'investigator-templates'); }
  private path(id: string): string { return join(this.root, id, 'character.json'); }
  async ids(): Promise<string[]> {
    if (!await this.context.snapshots.pathExists(this.root)) return [];
    const names = await this.context.snapshots.sortedChildNames(this.root, path => this.context.snapshots.isFile(join(path, 'character.json')));
    return names.filter(name => TEMPLATE_ID.test(name)).sort(compareUnicode);
  }
  /** The sheet, or null when the folder holds nothing a template can be. */
  async read(id: string): Promise<Row | null> {
    if (!TEMPLATE_ID.test(id) || !await this.context.snapshots.isFile(this.path(id))) return null;
    let value: unknown;
    try { value = await this.context.snapshots.readJson(this.path(id)); } catch { return null; }
    return isJsonObject(value) && typeof value.name === 'string' && value.name.trim() ? clone(value as Row) : null;
  }
  async list(): Promise<Row> {
    const templates: Row[] = [], unreadable: string[] = [];
    for (const id of await this.ids()) {
      const sheet = await this.read(id);
      if (sheet === null) { unreadable.push(id); continue; }
      templates.push({id, name: sheet.name, occupation: sheet.occupation ?? null, era: sheet.era ?? null, age: sheet.age ?? null, sex: sheet.sex ?? null});
    }
    return {templates, ...(unreadable.length ? {unreadable} : {})};
  }
  /** Seat a template in a setting_up campaign; `settingUp` is the setup owner's own gate. */
  async load(params: Row, settingUp: (params: Row) => Promise<[CampaignWriter, Row]>): Promise<Row> {
    const requested = params.template;
    if (typeof requested !== 'string' || !requested.trim()) throw new RpcError('invalid_params', 'params.template must be a non-empty string', {fix: 'call setup.templates and pass one of its ids'});
    const replay = await this.replay(params);
    if (replay) return replay;
    const sheet = await this.read(requested);
    if (sheet === null) throw new RpcError('unknown_entity', `no investigator template ${repr(requested)}`, {fix: 'call setup.templates and pass one of its ids', details: {query: requested, candidates: await this.ids()}});
    const [campaign, meta] = await settingUp(params);
    const party = await campaign.party();
    if (party.length) throw new RpcError('invalid_params', 'the party already has an investigator; a template seats only an empty table', {codeDetail: 'party_not_empty', fix: 'continue the setup the party already started', details: {investigators: party.map(card => string(card.id))}});
    const base = defaultInvestigatorId(string(sheet.name), party.length + 1), taken = new Set(party.map(card => string(card.id)));
    let id = base, ordinal = 2;
    while (taken.has(id)) id = `${base}-${ordinal++}`;
    sheet.id = id;
    const derived = row(sheet.derived), characteristics = row(sheet.characteristics);
    sheet.current_hp ??= derived.HP ?? null; sheet.current_san ??= derived.SAN ?? null; sheet.current_mp ??= derived.MP ?? null; sheet.current_luck ??= characteristics.LUCK ?? null;
    sheet.origin = {template: requested};
    await campaign.writeSheet(sheet);
    meta.investigators = (await campaign.party()).map(card => string(card.id));
    const moduleId = string(meta.module_id || '');
    const mismatch = moduleId && await moduleAvailable(this.context, moduleId, this.writer, campaign.id) ? eraMismatch((await loadModule(this.context, moduleId, campaign.id)).graph, sheet) : null;
    if (mismatch) meta.era_mismatch = mismatch;
    const block = {...row(meta.setup)};
    block.receipts = [...array(block.receipts), {id: `investigator:${id}`, kind: 'investigator', investigator: id, name: sheet.name ?? null, occupation: sheet.occupation ?? null,
      source: TEMPLATE_SOURCE, template: requested, at: nowIso()}];
    meta.setup = block;
    await campaign.writeCampaign(meta);
    return {receipt: `investigator:${id}`, investigator: investigatorRow(sheet), sheet, template: requested, era_mismatch: mismatch};
  }
  /** A campaign that already seated a template answers with that card and writes nothing (§173.2). */
  private async replay(params: Row): Promise<Row | null> {
    const campaign = await this.writer.campaign(params, {requireTurn: false, requireWorld: false}), meta = await campaign.readCampaign();
    const receipt = templateReceipt(meta);
    if (!receipt) return null;
    const sheet = (await campaign.party()).find(card => string(card.id) === string(receipt.investigator)) ?? null;
    return {receipt: string(receipt.id), investigator: sheet ? investigatorRow(sheet) : null, sheet, template: receipt.template ?? null, era_mismatch: meta.era_mismatch ?? null, replayed: true};
  }
}
