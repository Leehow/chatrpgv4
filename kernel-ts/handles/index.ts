/**
 * Contract §185.5: the handle lane's two methods. `handles.job` lists the book nodes the book's `handles.json` neither names nor
 * gave up, with what the graph says of them and the cast forms a handle may not carry; `handles.submit` checks each proposed
 * handle on its own and writes the accepted ones, and the ids the lane gave up on, to that file. A campaign takes them at its
 * next safe moment (`foldNodeHandles`, §185.6).
 *
 * Only a name-free campaign asks (§185.1). Both answer while the campaign is being set up, as well as at a table: the epithet
 * lane's reason (§176.3) -- the opening is where the Keeper first shows the book's places and people. A reader-built book
 * can also be named in the library alone (`{module}`), before any campaign on it folds.
 */
import { join } from 'node:path';
import type { KernelContext } from '../context.js';
import { RpcError } from '../errors.js';
import type { HandlerGroup } from '../handlers.js';
import { loadCampaignModule, loadModule } from '../read/campaign.js';
import { npcsPresent } from '../read/capsule.js';
import { playsFromReading } from '../modules/bound-source.js';
import { validateModuleId } from '../modules/store.js';
import { recordOf, type ModuleGraph } from '../read/module-graph.js';
import { handleScheme, handlesDirectory, handlesJob, nearTableFirst, readHandles, submitHandles } from '../read/node-handles.js';
import { array, repr, row, string, type Row } from '../read/values.js';
import type { createWriteRuntime } from '../write/index.js';

const STATUSES: readonly string[] = ['setting_up', 'ready_for_table', 'active'];

/**
 * The scenes a library-form job starts from (§185.5, NFH-03): the opening a book records (`module.opening.choose`), else
 * its one start scene (what `campaign.create` opens without a choice), else every scene the book marks as a way in.
 */
function openingSeeds(graph: ModuleGraph, meta: Row): Row[] {
    const recorded = row(meta.opening_choice).start_scene, chosen = typeof recorded === 'string' ? graph.nodes.get(recorded) : undefined;
    if (chosen?.node_kind === 'scene') return [chosen];
    const scenes = graph.kind('scene'), starts = scenes.filter(scene => recordOf(scene).is_start === true);
    if (starts.length === 1) return starts;
    return scenes.filter(scene => recordOf(scene).is_start === true || row(scene.properties).is_entrance === true);
}

function checkEntries(params: Row): void {
    if (params.entries !== undefined && !Array.isArray(params.entries))
        throw new RpcError('invalid_params', 'params.entries must be a list of {id, handle}', { details: { field: 'entries' } });
    if (params.given_up !== undefined && !Array.isArray(params.given_up))
        throw new RpcError('invalid_params', 'params.given_up must be a list of node ids', { details: { field: 'given_up' } });
}

export function createHandleHandlers(context: KernelContext, writer: ReturnType<typeof createWriteRuntime>): HandlerGroup {
    /**
     * §185.5's library form, `{module}` without a campaign: a reader-built book named in the shared library before any campaign
     * folds (the host asks at setup's start and after a library publication). The graph is the library's, read as a name-free
     * campaign with nothing mapped yet reads it. An authored module (a starter, or one no reading lane publishes) is refused.
     */
    async function loadBook(params: Row): Promise<{ label: string; graph: ModuleGraph | null; directory: string; meta: Row }> {
        const moduleId = validateModuleId(params.module);
        const directory = join(context.stateRoot, 'modules', moduleId), metadata = join(directory, 'module.json');
        const starter = await context.snapshots.isFile(join(context.content, 'starters', moduleId, 'module-graph.json'));
        if (!starter && !await context.snapshots.isFile(metadata))
            throw new RpcError('invalid_params', `unknown module ${repr(moduleId)}`, { details: { field: 'module', module: moduleId } });
        const meta = starter ? {} : row(await context.snapshots.readJson(metadata));
        if (starter || !playsFromReading(meta))
            throw new RpcError('invalid_params', `module ${repr(moduleId)} is authored and keeps its own handles`, {
                fix: 'only a book the PDF reader built takes handles', details: { reason: 'authored', module: moduleId } });
        let graph: ModuleGraph | null = null;
        try { graph = (await loadModule(context, moduleId, undefined, new Map())).graph; }
        catch { graph = null; }
        return { label: `book:${moduleId}`, graph, directory, meta };
    }
    async function load(params: Row): Promise<{ campaign: any; meta: Row; world: Row; nameFree: boolean; graph: ModuleGraph | null; directory: string }> {
        const campaign = await writer.campaign(params), meta = await campaign.readCampaign(), moduleId = string(meta.module_id);
        if (handleScheme(meta) !== 'name-free')
            return { campaign, meta, world: {}, nameFree: false, graph: null, directory: '' };
        if (!STATUSES.includes(string(meta.status)))
            throw new RpcError('campaign_not_ready', `campaign ${repr(campaign.id)} is ${repr(meta.status)}`, { details: { status: meta.status } });
        const world = await context.snapshots.pathExists(campaign.path('world.json')) ? await campaign.readWorld() : {};
        let graph: ModuleGraph | null = null;
        try { graph = (await loadCampaignModule(context, moduleId, world, campaign.id)).graph; }
        catch { graph = null; }
        return { campaign, meta, world, nameFree: true, graph, directory: await handlesDirectory(context, campaign.id, moduleId) };
    }
    return Object.freeze({
        'handles.job': async (params): Promise<Row> => {
            if (params.campaign === undefined && params.module !== undefined) {
                const book = await loadBook(params);
                return book.graph ? handlesJob(book.label, book.graph, await readHandles(context, book.directory), nearTableFirst(book.graph, openingSeeds(book.graph, book.meta)))
                    : { job_id: null, waiting: 'graph' };
            }
            const { campaign, meta, world, nameFree, graph, directory } = await load(params);
            // A legacy campaign keeps the book's handles (§185.1): there is never anything to ask.
            if (!nameFree) return { job_id: null };
            // A book still being read has no graph yet; the next ask finds it.
            if (!graph) return { job_id: null, waiting: 'graph' };
            // Nearest the table first (NFH-03): the scene the party stands in, or the opening setup recorded.
            const at = world.active_scene || meta.opening_scene, scene = typeof at === 'string' && at ? graph.sceneByHandle(at) : null;
            return handlesJob(campaign.id, graph, await readHandles(context, directory),
                nearTableFirst(graph, scene ? [scene] : [], at => npcsPresent(graph, world, at)));
        },
        'handles.submit': async (params): Promise<Row> => {
            checkEntries(params);
            if (params.campaign === undefined && params.module !== undefined) {
                const book = await loadBook(params);
                if (!book.graph)
                    throw new RpcError('campaign_not_ready', `module ${repr(params.module)} has no graph yet`, { fix: 'ask handles.job again once the book is read' });
                return submitHandles(context, book.directory, book.graph, params.entries, params.given_up);
            }
            const { campaign, nameFree, graph, directory } = await load(params);
            if (!nameFree)
                throw new RpcError('invalid_params', `campaign ${repr(campaign.id)} keeps the book's handles`, {
                    fix: 'only a name-free campaign takes handles; handles.job answers job_id null here', details: { reason: 'legacy_handles' } });
            if (!graph)
                throw new RpcError('campaign_not_ready', `campaign ${repr(campaign.id)} has no graph yet`, { fix: 'ask handles.job again once the module is read' });
            const result = await submitHandles(context, directory, graph, params.entries, params.given_up);
            await campaign.telemetry({ lane: 'handles', event: 'submitted', written: array(result.written).filter(entry => !entry.given_up).length,
                given_up: array(result.written).filter(entry => entry.given_up).length, refused: array(result.refused).length });
            return result;
        },
    });
}
