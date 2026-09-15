/** Explicit library intake and post-commit mirroring; campaign sheets stay authoritative. */
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { KernelContext } from '../context.js';
import type { HandlerGroup } from '../handlers.js';
import { RpcError, internalError } from '../errors.js';
import { isJsonObject, PythonJsonDecodeError, compareUnicode } from '../json.js';
import { writeJsonAtomic } from '../fileio.js';
import { actor } from '../read/handlers.js';
import { loadModule } from '../read/campaign.js';
import { moduleDeclaration, type ModuleGraph } from '../read/module-graph.js';
import { array, row, string, number, truth, repr, clone, equal, type Row } from '../read/values.js';
import { asciiSlug } from '../write/text.js';
import { nowIso, type CampaignWriter } from '../write/store.js';
import { head } from '../write/history.js';
import type { createWriteRuntime } from '../write/index.js';
import { defaultInvestigatorId } from '../setup/chargen.js';
import { investigatorRow } from '../setup/sheet.js';

const UNWRITABLE = 'library_unwritable', CONFLICT = 'library_conflict';
class LibraryError extends Error { constructor(message: string, readonly reason: string) { super(message); this.name = reason === CONFLICT ? 'Conflict' : 'Unwritable'; } }
export const originOf = (sheet: Row): string | null => typeof row(sheet.origin).library_id === 'string' && sheet.origin.library_id ? sheet.origin.library_id : null;
export function moduleEra(graph: ModuleGraph): string | null {
  const era = moduleDeclaration(graph.moduleNode).era;
  return typeof era === 'string' && era ? era : null;
}
export function eraMismatch(graph: ModuleGraph, sheet: Row): Row | null {
  const book = moduleEra(graph), era = sheet.era;
  return typeof era === 'string' && era && book && era !== book ? {sheet: era, module: book} : null;
}
export async function moduleAvailable(context: KernelContext, id: string, writer: ReturnType<typeof createWriteRuntime>, campaign?: string): Promise<boolean> {
  const graph = await writer.sourceGraphPath(id, campaign);
  return await context.snapshots.pathExists(graph) ||
    await context.snapshots.pathExists(join(context.content, 'starters', id, 'module-graph.json'));
}
async function readError(error: unknown, path: string): Promise<string> {
  if (error instanceof PythonJsonDecodeError) {
    const text = await readFile(path, 'utf8'), prefix = text.slice(0, error.position), lines = prefix.split('\n');
    return `${error.message}: line ${lines.length} column ${Array.from(lines.at(-1) ?? '').length + 1} (char ${Array.from(prefix).length})`;
  }
  return internalError(error).message.replace(/^[^:]+: /, '');
}
export class Library {
  readonly root: string;
  constructor(readonly context: KernelContext) { this.root = join(context.stateRoot, 'investigators'); }
  path(id: string): string { return join(this.root, `${id}.json`); }
  async ids(): Promise<string[]> {
    return (await this.context.snapshots.sortedChildNames(this.root, path => this.context.snapshots.isFile(path)))
      .filter(name => name.endsWith('.json')).map(name => name.slice(0, -5));
  }
  async read(id: string): Promise<Row | null> {
    const path = this.path(id);
    if (!await this.context.snapshots.pathExists(path)) return null;
    let value: any;
    try { value = await this.context.snapshots.readJson(path); }
    catch (error) { throw new LibraryError(`${basename(path)} is not readable as a library row: ${await readError(error, path)}`, CONFLICT); }
    if (!isJsonObject(value) || !equal(value.schema_version, 1) || value.library_id !== id || !isJsonObject(value.sheet))
      throw new LibraryError(`${basename(path)} is not a schema 1 library row for ${repr(id)}`, CONFLICT);
    return clone(value);
  }
  async write(value: Row): Promise<void> {
    try { await writeJsonAtomic(this.path(string(value.library_id)), value); }
    catch (error) {
      if (typeof (error as NodeJS.ErrnoException).code !== 'string') throw error;
      throw new LibraryError(`cannot write ${this.root}: ${await readError(error, this.root)}`, UNWRITABLE);
    }
  }
  async mintId(name: string): Promise<string> {
    const stem = asciiSlug(name, 32) || 'investigator', taken = new Set(await this.ids());
    let highest = 0n;
    for (const id of taken) { const match = /^([a-z0-9][a-z0-9-]*)-([1-9]\d*)$/.exec(id); if (match && match[1] === stem && BigInt(match[2]) > highest) highest = BigInt(match[2]); }
    let ordinal = highest + 1n;
    while (taken.has(`${stem}-${ordinal}`)) ordinal++;
    return `${stem}-${ordinal}`;
  }
}
function playBlock(previous: Row | null, campaign: string, turn: number | null, commit: string | null): Row {
  const campaigns = array(row(previous).campaigns).filter(value => typeof value === 'string');
  if (!campaigns.includes(campaign)) campaigns.push(campaign);
  return {last_campaign: campaign, last_turn: turn, last_commit: commit, updated_at: nowIso(), campaigns};
}
function newRow(id: string, sheet: Row, campaign: string, play: Row): Row {
  return {library_id: id, sheet, origin: {created_in: campaign, created_at: nowIso(), era_at_creation: sheet.era ?? null}, play, schema_version: 1};
}
async function upsert(library: Library, campaign: CampaignWriter, sheet: Row, turn: number | null, commit: string | null): Promise<[Row, boolean]> {
  const id = string(originOf(sheet)), existing = await library.read(id), play = playBlock(existing?.play ?? null, campaign.id, turn, commit);
  const value = existing === null ? newRow(id, sheet, campaign.id, play) : {...existing, sheet, play};
  await library.write(value); return [value, existing === null];
}
function summary(value: Row): Row {
  const sheet = row(value.sheet), play = row(value.play);
  return {library_id: value.library_id ?? null, name: sheet.name ?? null, occupation: sheet.occupation ?? null, era: sheet.era ?? null,
    current_hp: sheet.current_hp ?? null, current_san: sheet.current_san ?? null, last_campaign: play.last_campaign ?? null,
    last_turn: play.last_turn ?? null, updated_at: play.updated_at ?? null};
}
function parameter(params: Row, name: string, required = true): string | null {
  const value = params[name];
  if (value == null) { if (required) throw new RpcError('invalid_params', `params.${name} is required`); return null; }
  if (typeof value !== 'string' || !value.trim()) throw new RpcError('invalid_params', `params.${name} must be a non-empty string`);
  return value;
}
export function createLibraryWriteBack(context: KernelContext): (campaign: CampaignWriter, record: Row) => Promise<void> {
  return async (campaign, record) => {
    let party: Row[], turn: number;
    const library = new Library(context);
    try { turn = Math.trunc(number(record.turn)); party = await campaign.party(); }
    catch (error) { await campaign.telemetry({lane: 'library', ok: false, reason: UNWRITABLE, error: internalError(error).message}); return; }
    for (const sheet of party) {
      const id = originOf(sheet); if (id === null) continue;
      const event: Row = {lane: 'library', turn, investigator: sheet.id ?? null, library_id: id};
      try { await upsert(library, campaign, sheet, turn, record.commit ?? null); }
      catch (error) { await campaign.telemetry({...event, ok: false, reason: error instanceof LibraryError ? error.reason : UNWRITABLE,
        error: error instanceof LibraryError ? error.message : internalError(error).message}); continue; }
      await campaign.telemetry({...event, ok: true});
    }
  };
}
export function createLibraryHandlers(context: KernelContext, writer: ReturnType<typeof createWriteRuntime>): HandlerGroup {
  const library = new Library(context);
  async function getRow(id: string): Promise<Row> {
    let value: Row | null;
    try { value = await library.read(id); }
    catch (error) { if (!(error instanceof LibraryError)) throw error; throw new RpcError('internal', error.message, {codeDetail: error.reason, fix: 'the row on disk is not one this kernel can read; inspect or remove it by hand'}); }
    if (value === null) throw new RpcError('unknown_entity', `no investigator ${repr(id)} in the library`, {fix: 'call investigator.list and use one of its library_id values', details: {query: id, candidates: await library.ids()}});
    return value;
  }
  return Object.freeze({
    'investigator.list': async () => {
      const investigators: Row[] = [], unreadable: string[] = [];
      for (const id of await library.ids()) {
        try { const value = await library.read(id); if (value !== null) investigators.push(summary(value)); }
        catch (error) { if (!(error instanceof LibraryError)) throw error; unreadable.push(id); }
      }
      investigators.sort((a, b) => compareUnicode(string(b.updated_at || ''), string(a.updated_at || '')) || compareUnicode(string(b.library_id), string(a.library_id)));
      return {investigators, ...(unreadable.length ? {unreadable} : {})};
    },
    'investigator.get': async params => getRow(parameter(params, 'library_id')!),
    'investigator.save': async params => {
      const campaign = await writer.campaign(params, {requireTurn: false, requireWorld: false}), sheet = actor(await campaign.party(), params.investigator);
      const minted = originOf(sheet) === null;
      if (minted) sheet.origin = {library_id: await library.mintId(string(sheet.name || ''))};
      const position = await head(context, campaign.id);
      let value: Row, created: boolean;
      try { [value, created] = await upsert(library, campaign, sheet, position.turn, position.sha); }
      catch (error) { if (!(error instanceof LibraryError)) throw error; throw new RpcError('internal', error.message, {codeDetail: error.reason, fix: 'make .coc/investigators writable, or inspect the row it names'}); }
      if (minted) await campaign.writeSheet(sheet);
      return {library_id: value.library_id, investigator: sheet.id ?? null, name: sheet.name ?? null, created, play: value.play};
    },
    'investigator.load': async params => {
      const campaign = await writer.campaign(params, {requireTurn: false, requireWorld: false}), meta = await campaign.readCampaign();
      let id = parameter(params, 'library_id')!;
      const as = parameter(params, 'as', false), value = await getRow(id);
      let turn = 0;
      if (await context.snapshots.pathExists(campaign.path('turn.json'))) {
        const cursor = await campaign.readTurn();
        if (!['awaiting_player', 'asked'].includes(cursor.state)) throw new RpcError('turn_state', `a card cannot join while the turn is ${repr(cursor.state)}`, {fix: 'finish the turn (narrate or ask) first', details: {turn: cursor.turn ?? null, state: cursor.state ?? null}});
        turn = Math.trunc(number(cursor.turn || 0));
      }
      const party = await campaign.party(), sheet = clone(value.sheet);
      if (as !== null) sheet.name = as;
      const taken = new Set(party.map(item => string(item.id))), base = defaultInvestigatorId(string(sheet.name || ''), party.length + 1);
      let candidate = base, ordinal = 2;
      while (taken.has(candidate)) candidate = `${base}-${ordinal++}`;
      sheet.id = candidate;
      let forked: string | null = null;
      if (as !== null) { forked = id; id = await library.mintId(as); }
      sheet.origin = {library_id: id, loaded_at_turn: turn};
      if (forked !== null) {
        const fork = newRow(id, sheet, campaign.id, playBlock(null, campaign.id, null, null)); fork.origin.forked_from = forked;
        try { await library.write(fork); }
        catch (error) { if (!(error instanceof LibraryError)) throw error; throw new RpcError('internal', error.message, {codeDetail: error.reason, fix: 'make .coc/investigators writable, then load again'}); }
      }
      await campaign.writeSheet(sheet);
      meta.investigators = (await campaign.party()).map(item => string(item.id));
      const moduleId = string(meta.module_id || '');
      const mismatch = moduleId && await moduleAvailable(context, moduleId, writer, campaign.id) ? eraMismatch((await loadModule(context, moduleId, campaign.id)).graph, sheet) : null;
      if (mismatch) meta.era_mismatch = mismatch;
      if (meta.status === 'setting_up') {
        const block = {...row(meta.setup)}, receipts = [...array(block.receipts)];
        receipts.push({id: `investigator:${sheet.id}`, kind: 'investigator', investigator: sheet.id, name: sheet.name ?? null, occupation: sheet.occupation ?? null,
          source: 'library', library_id: id, forked_from: forked, at: nowIso()}); block.receipts = receipts; meta.setup = block;
      }
      await campaign.writeCampaign(meta);
      return {receipt: `investigator:${sheet.id}`, investigator: investigatorRow(sheet), sheet, library_id: id, forked_from: forked, loaded_at_turn: turn, era_mismatch: mismatch};
    },
  });
}
