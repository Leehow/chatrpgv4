/**
 * Contract §185.5: the handle lane's two methods. `handles.job` lists the book nodes the book's `handles.json` neither names nor
 * gave up, with what the graph says of them and the cast forms a handle may not carry; `handles.submit` checks each proposed
 * handle on its own and writes the accepted ones, and the ids the lane gave up on, to that file. A campaign takes them at its
 * next safe moment (`foldNodeHandles`, §185.6).
 *
 * Only a name-free campaign asks (§185.1). Both answer while the campaign is being set up, as well as at a table: the epithet
 * lane's reason (§176.3) -- the opening is where the Keeper first shows the book's places and people.
 */
import type { KernelContext } from '../context.js';
import { RpcError } from '../errors.js';
import type { HandlerGroup } from '../handlers.js';
import { loadCampaignModule } from '../read/campaign.js';
import type { ModuleGraph } from '../read/module-graph.js';
import { handleScheme, handlesDirectory, handlesJob, readHandles, submitHandles } from '../read/node-handles.js';
import { array, repr, string, type Row } from '../read/values.js';
import type { createWriteRuntime } from '../write/index.js';

const STATUSES: readonly string[] = ['setting_up', 'ready_for_table', 'active'];

export function createHandleHandlers(context: KernelContext, writer: ReturnType<typeof createWriteRuntime>): HandlerGroup {
    async function load(params: Row): Promise<{ campaign: any; meta: Row; nameFree: boolean; graph: ModuleGraph | null; directory: string }> {
        const campaign = await writer.campaign(params), meta = await campaign.readCampaign(), moduleId = string(meta.module_id);
        if (handleScheme(meta) !== 'name-free')
            return { campaign, meta, nameFree: false, graph: null, directory: '' };
        if (!STATUSES.includes(string(meta.status)))
            throw new RpcError('campaign_not_ready', `campaign ${repr(campaign.id)} is ${repr(meta.status)}`, { details: { status: meta.status } });
        const world = await context.snapshots.pathExists(campaign.path('world.json')) ? await campaign.readWorld() : {};
        let graph: ModuleGraph | null = null;
        try { graph = (await loadCampaignModule(context, moduleId, world, campaign.id)).graph; }
        catch { graph = null; }
        return { campaign, meta, nameFree: true, graph, directory: await handlesDirectory(context, campaign.id, moduleId) };
    }
    return Object.freeze({
        'handles.job': async (params): Promise<Row> => {
            const { campaign, nameFree, graph, directory } = await load(params);
            // A legacy campaign keeps the book's handles (§185.1): there is never anything to ask.
            if (!nameFree) return { job_id: null };
            // A book still being read has no graph yet; the next ask finds it.
            if (!graph) return { job_id: null, waiting: 'graph' };
            return handlesJob(campaign.id, graph, await readHandles(context, directory));
        },
        'handles.submit': async (params): Promise<Row> => {
            const { campaign, nameFree, graph, directory } = await load(params);
            if (!nameFree)
                throw new RpcError('invalid_params', `campaign ${repr(campaign.id)} keeps the book's handles`, {
                    fix: 'only a name-free campaign takes handles; handles.job answers job_id null here', details: { reason: 'legacy_handles' } });
            if (!graph)
                throw new RpcError('campaign_not_ready', `campaign ${repr(campaign.id)} has no graph yet`, { fix: 'ask handles.job again once the module is read' });
            if (params.entries !== undefined && !Array.isArray(params.entries))
                throw new RpcError('invalid_params', 'params.entries must be a list of {id, handle}', { details: { field: 'entries' } });
            if (params.given_up !== undefined && !Array.isArray(params.given_up))
                throw new RpcError('invalid_params', 'params.given_up must be a list of node ids', { details: { field: 'given_up' } });
            const result = await submitHandles(context, directory, graph, params.entries, params.given_up);
            await campaign.telemetry({ lane: 'handles', event: 'submitted', written: array(result.written).filter(entry => !entry.given_up).length,
                given_up: array(result.written).filter(entry => entry.given_up).length, refused: array(result.refused).length });
            return result;
        },
    });
}
