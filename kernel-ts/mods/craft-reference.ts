/** Host-only read of one effective, immutable craft contribution. No settlement or repair. */
import {isDeepStrictEqual} from 'node:util';
import type {KernelContext} from '../context.js';
import {RpcError} from '../errors.js';
import {jsonDigest} from '../json.js';
import {readCampaign} from '../read/handlers.js';
import {contextBinding} from '../read/context.js';
import {activeMods} from '../read/mods.js';
import {row, type Row} from '../read/values.js';
import {craftReferenceProvider, craftProviderIdentity, readCraftCatalog} from './craft-package.js';

const unavailable = (reason: string): Row => ({status: 'unavailable', reason});
export async function readCraftReference(context: KernelContext, params: Row): Promise<Row> {
    if (!['index', 'card'].includes(params.mode) || Object.keys(params).some(key => !['campaign', 'mode', 'card_id', 'expected'].includes(key)))
        throw new RpcError('invalid_params', 'Craft reference read requires index or card mode');
    if (params.mode === 'card' && (typeof params.card_id !== 'string' || !params.card_id || !params.expected))
        throw new RpcError('invalid_params', 'A card read requires one issued ID and expected binding');
    if (params.mode === 'index' && params.card_id !== undefined)
        throw new RpcError('invalid_params', 'Index reads do not accept card IDs');
    const {campaign, module} = await readCampaign(context, params, false, false, {}, true);
    const active = await activeMods(context, campaign.world), mod = craftReferenceProvider(active);
    if (!mod) return unavailable('no_provider');
    const settings = row(row(row(campaign.world.mods).active)[mod.id]).settings;
    if (row(settings).reference_mode !== 'jev') return unavailable('disabled');
    let catalog;
    try {catalog = readCraftCatalog(mod);} catch {return unavailable('invalid_assets');}
    const base = await contextBinding(campaign, module, {mods: {active: active.map(entry => ({id: entry.id}))}});
    if (base.unavailable || !base.source_revision) return unavailable('binding_unavailable');
    const binding = {...base, mod_revision: jsonDigest(campaign.world.mods)};
    const identity = {provider: craftProviderIdentity(mod), catalog_revision: catalog.revision, binding};
    if (params.expected !== undefined && !isDeepStrictEqual(params.expected, identity)) return unavailable('stale_reference');
    if (params.mode === 'index') return {status: 'ready', ...identity, candidates: catalog.candidates()};
    if (!catalog.candidateIds.includes(params.card_id)) return unavailable('card_not_issued');
    return {status: 'ready', ...identity, card: catalog.generationCard(params.card_id)};
}
