/** Static Mod management, jobs, objects and named settlement contributions. */
import type { KernelContext } from '../context.js';
import type { HandlerGroup } from '../handlers.js';
import { isJsonObject } from '../json.js';
import { readCampaign } from '../read/handlers.js';
import { playLanguageOf } from '../read/languages.js';
import { CampaignSnapshot, loadCampaignModule } from '../read/campaign.js';
import { SessionView } from '../read/session-view.js';
import { modContext, setupModContext } from '../read/mods.js';
import { row, clone, truth, string, number, type Row } from '../read/values.js';
import type { CampaignWriter } from '../write/store.js';
import type { createWriteRuntime } from '../write/index.js';
import { ModRuntime } from './runtime.js';
import { projectInventory } from './projection.js';
import type { ApplyContext } from '../apply/index.js';
import { createDocumentHandlers } from './documents.js';
import { ModJobs, type ModSources } from './jobs.js';
import { stageModEffect } from './stage.js';
import { resolveBeforeMain, type ModResolveInput } from './resolve.js';
import { magicEffects } from './effects.js';
export { validateDefinition, validateDocumentSeed, definitionExpression } from './definition.js';
export { projectInventory, projectSheet, weaponRows } from './projection.js';
export { magicEffects, effectTarget, applyObjectEffects, saveEffectTarget, useItem, repairItem, castNpc } from './effects.js';
export { defineObject, moveObject, objectInstance, objectRegistry } from './objects.js';
export { initializeDocument, ownershipChanged, writeDocument, documentVersion } from './documents.js';
export { type ModResolveInput, type ModResolveResult } from './resolve.js';
export { type ModSources } from './jobs.js';

export function createModRuntime(context: KernelContext, sources: ModSources = {}) {
  const runtime = new ModRuntime(context);
  async function busy(campaign: CampaignWriter, world: Row): Promise<boolean> {
    const turn = await campaign.readTurn();
    if (['open', 'acting'].includes(turn.state) || truth(turn.pending_choice)) return true;
    const meta = await campaign.readCampaign(), graph = (await loadCampaignModule(context, meta.module_id, world)).graph;
    const snapshot = new CampaignSnapshot(context, campaign.id);
    snapshot.meta = meta; snapshot.world = world; snapshot.turn = turn;
    await snapshot.preload('view');
    return Boolean(new SessionView(snapshot, graph, snapshot.party, world).activeSession());
  }
  async function initializeCampaign(campaign: CampaignWriter, world: Row, options: {pending?: boolean} = {}): Promise<void> {
    const meta = await campaign.readCampaign(), staged = meta.mods_pending;
    let changed = !Object.hasOwn(world, 'mods') && isJsonObject(staged);
    if (changed) world.mods = clone(staged);
    changed = await runtime.initializeWorld(world) || changed;
    if (options.pending && !await busy(campaign, world)) changed = await runtime.applyPending(world) || changed;
    if (changed) await campaign.writeWorld(world);
    if (staged != null) { delete meta.mods_pending; await campaign.writeCampaign(meta); }
    if (Object.hasOwn(world, 'objects')) await projectInventory(campaign, world);
  }
  function handlers(writer: ReturnType<typeof createWriteRuntime>): HandlerGroup {
    const jobs = new ModJobs(context, runtime, writer, sources);
    async function listing(params: Row): Promise<Row> {
      if (!truth(params.campaign)) return runtime.view();
      const campaign = await writer.campaign(params, {requireWorld: false}), meta = await campaign.readCampaign();
      const config = await context.snapshots.pathExists(campaign.path('world.json')) ? await campaign.readWorld() : {mods: Object.hasOwn(meta, 'mods_pending') ? meta.mods_pending : {}};
      return {...await runtime.view(config), campaign: campaign.id, play_language: await playLanguageOf(context, meta)};
    }
    return Object.freeze({
      ...createDocumentHandlers(writer, runtime),
      'mods.job': params => jobs.job(params),
      'mods.accept': params => jobs.accept(params),
      'mods.review.status': params => jobs.reviewStatus(params),
      'mods.queued': params => jobs.queued(params),
      'mods.list': listing,
      'mods.install': async params => {
        if (!Object.hasOwn(params, 'path')) { const error = new Error("'path'"); error.name = 'KeyError'; throw error; }
        if (typeof params.path !== 'string') { const error = new Error('Mod package path must be a string'); error.name = 'TypeError'; throw error; }
        return runtime.install(params.path);
      },
      'mods.defaults': async params => runtime.defaults(params.id ?? null, params.enabled ?? null),
      'mods.configure': async params => {
        const campaign = await writer.campaign(params, {requireWorld: false});
        let change: {retired: string[], from: string | null, to: string};
        if (!await context.snapshots.pathExists(campaign.path('world.json'))) {
          const meta = await campaign.readCampaign(), config: Row = truth(meta.mods_pending) ? {mods: clone(meta.mods_pending)} : {};
          change = await runtime.configure(config, params, false); meta.mods_pending = config.mods; await campaign.writeCampaign(meta);
        } else {
          const world = await campaign.readWorld(); await initializeCampaign(campaign, world);
          change = await runtime.configure(world, params, await busy(campaign, world)); await campaign.writeWorld(world);
        }
        // The retirement is recorded once, as a diagnostic row (§26): the lock shows the target version's settings.
        if (change.retired.length) await campaign.telemetry({lane: 'mods', event: 'settings_retired', mod: params.id, from: change.from, to: change.to, keys: change.retired});
        return listing(params);
      },
      'mods.order': async params => {
        if (!truth(params.campaign)) { await runtime.reorder(null, params.order); return listing(params); }
        const campaign = await writer.campaign(params, {requireWorld: false});
        if (!await context.snapshots.pathExists(campaign.path('world.json'))) {
          const meta = await campaign.readCampaign(), world: Row = truth(meta.mods_pending) ? {mods: clone(meta.mods_pending)} : {};
          await runtime.initializeWorld(world); await runtime.reorder(world, params.order); meta.mods_pending = world.mods; await campaign.writeCampaign(meta);
        } else {
          const world = await campaign.readWorld(); await initializeCampaign(campaign, world);
          await runtime.reorder(world, params.order, await busy(campaign, world)); await campaign.writeWorld(world);
        }
        return listing(params);
      },
      'mods.context': async params => {
        // A campaign still being set up has no capsule: it gets the setup shape (§26) from the same lock mods.configure writes.
        const settingUp = await writer.campaign(params, {requireWorld: false}), meta = await settingUp.readCampaign();
        if (meta.status === 'setting_up') {
          const lock = await context.snapshots.pathExists(settingUp.path('world.json')) ? row(await settingUp.readWorld()).mods : meta.mods_pending;
          return setupModContext(context, row(lock));
        }
        const {campaign, module} = await readCampaign(context, params, false, false, writer.read);
        return modContext(context, module.graph, campaign.world, campaign.party, campaign.records, true, {
          memory: campaign.logs.get('memory/candidates.jsonl') ?? [], story: campaign.logs.get('memory/story.jsonl') ?? [],
          worldline: string(campaign.meta.active_worldline || 'main'),
          loop: number(row(row(campaign.meta.worldlines)[string(campaign.meta.active_worldline || 'main')]).loop)
        });
      },
    });
  }
  function apply(writer: ReturnType<typeof createWriteRuntime>) {
    const jobs = new ModJobs(context, runtime, writer, sources);
    return Object.freeze({stage: (input: ApplyContext, effect: Row, sheets: Map<string, Row>) => stageModEffect(input, effect, sheets, jobs), projectInventory});
  }
  return Object.freeze({runtime, handlers, initializeCampaign, apply, magicEffects,
    resolveBeforeMain: (input: ModResolveInput) => resolveBeforeMain(context, runtime, input),
    initializeWorld: (world: Row) => runtime.initializeWorld(world), validateWorld: (world: Row) => runtime.validateWorld(world)});
}
