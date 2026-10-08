/** The campaign's published book sheets, or the starter's existing printed cards. */
import { join } from 'node:path';
import type { KernelContext } from '../context.js';
import { RpcError } from '../errors.js';
import { loadModule } from '../read/campaign.js';
import { array, clone, row, string, type Row } from '../read/values.js';
import { scopedModuleRoot } from '../modules/campaign-scope.js';
import { ModuleStore } from '../modules/store.js';
import { playsFromReading } from '../modules/bound-source.js';
import { offeredTemplate, PREGENS_MATERIAL, pregensSettlement } from '../modules/pregens.js';
import { engineWeapon } from '../combat/profiles.js';
import { asciiSlug } from '../write/text.js';

export interface PregenCatalog { pregens: Row[]; pregens_read?: string; sheets: Map<string, Row>; }
export async function campaignPregens(context: KernelContext, campaign: string, moduleId: string): Promise<PregenCatalog> {
  const sheets = new Map<string, Row>(), pregens: Row[] = [];
  const directory = join(context.content, 'starters', moduleId);
  const starter = await context.snapshots.isFile(join(directory, 'module-graph.json'));
  if (starter) {
    const root = join(directory, 'pregens');
    for (const id of await context.snapshots.sortedChildNames(root, path => context.snapshots.isFile(join(path, 'character.json')))) {
      const sheet = clone(row(await context.snapshots.readJson(join(root, id, 'character.json'))));
      sheets.set(id, sheet);
      pregens.push({pregen: id, name: sheet.name ?? null, occupation: sheet.occupation ?? null,
        ...(sheet.age == null ? {} : {age: sheet.age}), ...(sheet.era == null ? {} : {era: sheet.era}), source: 'starter'});
    }
    return {pregens, sheets};
  }
  const root = await scopedModuleRoot(context, campaign, moduleId);
  const store = new ModuleStore(root ? {...context, moduleRoot: root} : context);
  const meta = await store.module(moduleId), settlement = pregensSettlement(meta);
  const jobs = (await store.queue(moduleId)).filter(job => job.material === PREGENS_MATERIAL);
  const state = settlement && settlement.status !== 'unusable' ? 'read'
    : jobs.some(job => ['queued', 'running'].includes(job.state)) ? 'reading'
    : settlement || jobs.at(-1)?.state === 'failed' ? 'failed' : 'unread';
  // A bound source may not have published its first graph yet; it still owes the read.
  if (meta.graph_file || await context.snapshots.isFile(await store.graphPath(moduleId, meta))) {
    const graph = (await loadModule(context, moduleId, campaign)).graph;
    for (const node of graph.nodes.values()) {
      if (!offeredTemplate(node)) continue;
      const sheet = clone(row(node.properties).sheet), id = string(node.node_id);
      sheet.schema_version = 1;
      sheet.name ??= node.name;
      if (Array.isArray(sheet.weapons)) sheet.weapons = sheet.weapons.map((weapon: Row) =>
        engineWeapon(weapon, `pregen-${asciiSlug(string(weapon.name), 32)}`));
      sheet.origin = {pregen: id, module_id: moduleId, source_refs: clone(array(node.source_refs))};
      sheets.set(id, sheet);
      const pages = [...new Set(array(node.source_refs).map(ref => row(ref).page ??
        (Number.isInteger(row(ref).pdf_index) ? row(ref).pdf_index + 1 : undefined)).filter(page => Number.isInteger(page) && page > 0))];
      pregens.push({pregen: id, name: sheet.name, occupation: sheet.occupation ?? null,
        ...(sheet.age == null ? {} : {age: sheet.age}), ...(sheet.era == null ? {} : {era: sheet.era}), source: 'book', pages});
    }
  }
  return {pregens, sheets, ...(playsFromReading(meta) ? {pregens_read: state} : {})};
}

export function chosenPregen(catalog: PregenCatalog, id: string): Row {
  const sheet = catalog.sheets.get(id);
  if (!sheet) throw new RpcError('unknown_entity', `no pregen ${JSON.stringify(id)} in this campaign's module`, {
    fix: 'call investigator.list with this campaign and choose one of its pregen values',
    details: {query: id, candidates: catalog.pregens.map(value => value.pregen)},
  });
  return clone(sheet);
}
