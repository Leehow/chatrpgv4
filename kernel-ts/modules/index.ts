/** Static source API and its single owner-local publication lifetime. */
import type { KernelContext } from '../context.js';
import { join } from 'node:path';
import { RpcError } from '../errors.js';
import { jsonDigest } from '../json.js';
import type { HandlerGroup } from '../handlers.js';
import type { ModuleGraph } from '../read/module-graph.js';
import { equal, repr, row, string, truth, type Row } from '../read/values.js';
import {assertSourcePreparationRequest,type SourcePreparationRequest} from '../../runtime/jev/source-preparation.ts';
import {assertSourcePublicationAdvance,sourceAdvanceAuthority} from '../../runtime/jev/read-set.ts';
import { Reading,sourcePreparationSnapshot,sourcePreparationScopeMatches,type OwnedSourcePreparation } from './reading.js';
import { ModuleStore } from './store.js';
import { playsFromReading } from './bound-source.js';
import { ensureCampaignModule, moduleContext, scopedModuleRoot } from './campaign-scope.js';
function required(params: Row, key: string): string {
    const value = params[key];
    if (value == null || value === '')
        throw new RpcError('invalid_params', `params.${key} is required`);
    if (typeof value !== 'string')
        throw new RpcError('invalid_params', `params.${key} must be a string`);
    return value;
}
function handlersFor(store: ModuleStore, reading: Reading): HandlerGroup {
    return Object.freeze({
        'module.source.bind': params => reading.bind(params),
        'module.source.answer.peek': params => reading.peekAnswer(params),
        'module.source.materials.snapshot': params => reading.materialSnapshot(params),
        'module.source.snapshot': async params => {
            const id = required(params, 'module_id'), meta = await store.module(id), source = row(meta.source_document);
            if (source.path !== 'source.pdf' || typeof source.file_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(source.file_sha256)
                || !Number.isSafeInteger(source.page_count) || source.page_count < 1)
                throw new RpcError('needs', 'This module has no valid bound original PDF', {details: {reason: 'source_unavailable'}});
            return { version: 1, module_id: id, generation: meta.generation ?? 0,
                revision: jsonDigest({source, generation: meta.generation ?? 0, graph_digest: meta.graph_digest ?? null}),
                pdf: join(store.moduleDir(id), 'source.pdf'), file_sha256: source.file_sha256, page_count: source.page_count,
                ...(source.window ? { window: source.window } : {}) };
        },
        'module.read.request': params => reading.request(params),
        'module.read.ahead': params => reading.queueAheadReading(params),
        'module.read.claim': params => reading.claim(params),
        'module.read.finish': params => reading.finish(params),
        'module.read.unwait': params => reading.unwait(params),
        'module.read.yield': params => reading.yield(params),
        'module.opening.choose': params => reading.chooseOpening(params),
        'module.list': async () => {
            const modules = [];
            for (const id of await store.ids()) {
                const meta = await store.module(id);
                modules.push({ module_id: id, title: meta.title ?? null, source: meta.source ?? null, status: meta.status ?? null, generation: meta.generation ?? null, setup_ready: truth(meta.character_guidance) });
            }
            return { modules };
        },
        'module.status': async (params): Promise<Row> => {
            const id = required(params, 'module_id'), meta = await store.module(id);
            // A starter bound to its window (§14.16) keeps the starter's status; the visual shape is a PDF book's.
            if (equal(meta.reading_version, 1) && playsFromReading(meta)) {
                const queue = await store.queue(id);
                return {
                    module_id: id, title: meta.title ?? null, source: 'pdf', status: meta.status ?? null,
                    generation: meta.generation ?? 0, page_count: meta.page_count ?? null, languages: meta.languages ?? [],
                    opening_ready: truth(meta.opening_ready), opening: meta.opening ?? {},
                    reading: { ...row(meta.reading), opening_ready: truth(meta.opening_ready), queued: queue.filter(job => job.state === 'queued').length, active: queue.find(job => job.state === 'running')?.job_id ?? null },
                    opening_candidates: await store.candidates(await store.readGraph(id) || {}),
                };
            }
            // The build lane's sections; a bound starter's reading index is reported under `reading` (§14.16.5).
            const sections = meta.source === 'starter' && truth(meta.index_file) ? [] : await store.sections(id), counts: Row = {};
            for (const section of sections)
                counts[string(section.status)] = (counts[string(section.status)] ?? 0) + 1;
            const graph = await store.readGraph(id), opening = graph !== null ? await store.opening(graph) : { opening_ready: false, missing: ['graph'] };
            const report = row(meta.playability), queue = await store.queue(id);
            return {
                module_id: id, title: meta.title ?? null, source: meta.source ?? null, status: meta.status ?? null,
                generation: meta.generation ?? null, graph_digest: meta.graph_digest ?? null, page_count: meta.page_count ?? null, languages: meta.languages ?? null,
                sections: { total: sections.length, by_status: counts, rows: sections.map(section => Object.fromEntries(['id', 'kind', 'priority', 'pages', 'status', 'rounds'].map(key => [key, section[key] ?? null]))) },
                queue: queue.map(job => Object.fromEntries(['section_id', 'status', 'priority', 'reason'].map(key => [key, job[key]]))),
                playability: truth(report) ? { status: report.status ?? null, finding_counts: report.finding_counts ?? null, measures: report.measures ?? null } : null,
                opening_ready: truth(opening.opening_ready), opening, opening_candidates: await store.candidates(graph || {}), install: meta.install ?? null,
                ...(row(meta.source_document).window ? { source_window: row(meta.source_document).window,
                    reading: { state: row(meta.reading).state ?? null, index_complete: truth(row(meta.reading).index_complete),
                        sections: (await store.sections(id)).length } } : {}),
            };
        },
        'module.register': async (params) => {
            const id = required(params, 'module_id'), meta = await store.register(id);
            return { module_id: id, status: meta.status, generation: meta.generation, graph_digest: meta.graph_digest ?? null, title: meta.title ?? null };
        },
        'module.asset': async (params) => {
            const id = required(params, 'module_id'), name = required(params, 'name');
            await store.module(id);
            const entry = await store.asset(id, name);
            if (!entry) {
                throw new RpcError('unknown_entity', `no asset or handout named ${repr(name)} in module ${repr(id)}`, {
                    fix: 'pick one of details.candidates', details: { query: name, candidates: (await store.assets(id)).slice(0, 12).map(asset => ({ name: asset.name ?? null, kind: asset.kind ?? null, visibility: asset.visibility ?? null })) },
                });
            }
            return { module_id: id, asset: entry, player_visible: ['player-safe', 'revealable'].includes(entry.visibility) };
        },
    });
}
export function createModuleRuntime(context: KernelContext) {
    const store = new ModuleStore(context), reading = new Reading(store);
    const library = { store, reading, handlers: handlersFor(store, reading) };
    const scopes = new Map<string, typeof library>();
    let closed = false;
    /** Read operations follow the library until the campaign has a private workspace; write
     *  operations fork it first, so a book that finishes reading after campaign creation still
     *  reaches the campaign while a diverged campaign stays isolated (contract §22.6). */
    const scopedRuntime = (campaign: string) => {
        let value = scopes.get(campaign);
        if (!value) {
            const scoped = moduleContext(context, campaign);
            const store = new ModuleStore(scoped), reading = new Reading(store);
            value = { store, reading, handlers: handlersFor(store, reading) };
            scopes.set(campaign, value);
        }
        return value;
    };
    const owner = async (campaign: any, id: string, fork = false) => {
        if (closed) throw new RpcError('invalid_params', 'the source runtime is closed');
        if (campaign === undefined) return library;
        const value = scopedRuntime(campaign);
        if (fork) {
            await ensureCampaignModule(context, campaign, id);
            return value;
        }
        return await scopedModuleRoot(context, campaign, id) !== null ? value : library;
    };
    const ahead = async (params: Row): Promise<Row> => {
        const id = required(params, 'module_id');
        let value = await owner(params.campaign, id);
        if (!await value.store.exists(id) || !playsFromReading(await value.store.module(id))) return { queued: [] };
        let focus = params.focus;
        if (params.campaign !== undefined) {
            const path = join(context.campaignsRoot, params.campaign, 'world.json');
            const world = await context.snapshots.pathExists(path) ? row(await context.snapshots.readJson(path)) : {};
            if (truth(row(world.adaptation).source)) return { queued: [] };
            focus = world.active_scene || focus;
            value = await owner(params.campaign, id, true);
        }
        return value.reading.queueAheadReading({ ...params, focus });
    };
    const libraryOnly = new Set(['module.register', 'module.list']);
    // A scoped request or opening choice is the campaign's first private write and forks it.
    // Claims, finishes and unwaits instead follow the workspace that already owns the job, so a
    // shared prefetch is never stranded by a fork that happened after it was queued.
    const forking = new Set(['module.read.request', 'module.opening.choose']);
    const claimsOrFinishes = new Set(['module.read.claim', 'module.read.finish', 'module.read.unwait', 'module.read.yield']);
    // Each names one job, so each follows the workspace whose queue holds that job id.
    const byJobId = new Set(['module.read.finish', 'module.read.unwait', 'module.read.yield']);
    const queuedJobs = async (value: typeof library, id: string, jobId?: any, lease?: any): Promise<boolean> =>
        (await value.store.queue(id)).some(job => jobId === undefined
            ? job.state === 'queued'
            : job.job_id === jobId && (lease === undefined || job.lease === lease));
    const dispatch = async (method: string, params: Row): Promise<Row> => {
        if (method === 'module.read.ahead') return ahead(params);
        if (libraryOnly.has(method) || params.campaign === undefined || typeof params.module_id !== 'string')
            return library.handlers[method](params);
        const id = required(params, 'module_id'), campaign = params.campaign;
        if(method==='module.read.request'&&params._task_prepare!==undefined) {
            const request=params._task_prepare as SourcePreparationRequest;assertSourcePreparationRequest(request);
            const authority=request.authority;
            const exact=Object.fromEntries(['purpose','focus','question','material','pages'].filter(key=>Object.hasOwn(params,key)).map(key=>[key,params[key]]));
            if(authority.campaign!==campaign||authority.moduleId!==id||!equal(exact,request.read))throw new RpcError('needs','The owned preparation differs from its pending source request',{details:{reason:'source_preparation_binding_mismatch'}});
            const priorOwner=await owner(campaign,id),current=await sourcePreparationSnapshot(context,campaign,id);
            const prior=[...await priorOwner.store.queue(id)].reverse().find(job=>row(row(row(job.task_preparation).request).authority).token===authority.token);
            if(prior) {
                const retained=prior.task_preparation as OwnedSourcePreparation;
                const committed=row(row((await priorOwner.store.module(id)).reading).completed)[prior.job_id],advance=row(committed)._task_source_advance;
                if(advance!==undefined) {
                    assertSourcePublicationAdvance(advance);
                    if(!equal(sourceAdvanceAuthority(advance),authority)||advance.jobId!==prior.job_id||advance.lease!==prior.lease)
                        throw new RpcError('needs','The durable source completion belongs to another job or request',{details:{reason:'source_preparation_stale'}});
                }
                const expected=advance?.to??(prior.state==='completed'?undefined:retained.currentRevision);
                if(!equal(retained.request,request)||current.revision!==expected||!sourcePreparationScopeMatches(current.scope,authority.scope)||current.turn!==authority.turn)
                    throw new RpcError('needs','The retained preparation no longer owns the current source',{details:{reason:'source_preparation_stale'}});
                return priorOwner.reading.request(params,retained);
            }
            if(current.status!=='active'||current.revision!==authority.from||!sourcePreparationScopeMatches(current.scope,authority.scope)||current.turn!==authority.turn)
                throw new RpcError('needs','The pending operation source changed before preparation',{details:{reason:'source_preparation_stale'}});
            const wasScoped=await scopedModuleRoot(context,campaign,id)!==null;
            const target=await owner(campaign,id,true),forked=await sourcePreparationSnapshot(context,campaign,id);
            if(!wasScoped&&forked.forkOriginRevision!==authority.from)throw new RpcError('needs','The library source changed before its owned campaign seed',{details:{reason:'source_preparation_stale'}});
            if(!sourcePreparationScopeMatches(forked.scope,authority.scope)||forked.turn!==authority.turn)throw new RpcError('needs','The campaign changed during source preparation',{details:{reason:'source_preparation_stale'}});
            return target.reading.request(params,{request:structuredClone(request),currentRevision:forked.revision});
        }
        if (claimsOrFinishes.has(method)) {
            const value = scopedRuntime(campaign);
            if (await scopedModuleRoot(context, campaign, id) === null) return library.handlers[method](params);
            if (byJobId.has(method)) {
                // Ordinal job ids collide between the shared library and a campaign fork. A finish
                // carries the opaque attempt lease, so route by both; otherwise a private `read-7`
                // can capture the shared `read-7` and reject a valid publication.
                const lease = method === 'module.read.finish' || method === 'module.read.yield' ? params.lease : undefined;
                return (await queuedJobs(value, id, params.job_id, lease) ? value : library).handlers[method](params);
            }
            if (await queuedJobs(value, id)) return value.handlers[method](params);
            // No private work is queued; the shared queue may still hold work for this campaign.
            const shared = await library.handlers[method](params);
            return row(shared).job_id ? shared : value.handlers[method](params);
        }
        return (await owner(campaign, id, forking.has(method))).handlers[method](params);
    };
    const handlers: HandlerGroup = Object.freeze(Object.fromEntries(Object.keys(library.handlers).map(method => [method,
        (params: Row) => dispatch(method, params),
    ])));
    const source = Object.freeze({
        store,
        graphPath: async (moduleId: string, campaign?: string) => (await owner(campaign, moduleId)).store.graphPath(moduleId),
        materialReady: async (moduleId: string, name: string, campaign?: string) => (await owner(campaign, moduleId)).reading.materialReady(moduleId, name),
        openingReady: async (moduleId: string, focus = '', campaign?: string) => (await owner(campaign, moduleId)).reading.openingReady(moduleId, focus),
        request: async (params: Row) => (await owner(params.campaign, required(params, 'module_id'), true)).reading.request(params),
        // Campaign maintenance is a private write, just like an explicit source request.
        ahead,
        requestFollowing: async (params: Row) => (await owner(params.campaign, required(params, 'module_id'), true)).reading.request(params),
        // Before a campaign forks it follows the shared library, so it enqueues nothing there:
        // a table's prefetch may never write into the shared queue on another table's behalf.
        queueAdjacentReading: async (graph: ModuleGraph, scene: Row) => graph.sourceCampaign === undefined
            ? []
            : (await owner(graph.sourceCampaign, graph.moduleId)).reading.queueAdjacentReading(graph, scene),
        requireMaterial: async (graph: ModuleGraph, names: any[]) => (await owner(graph.sourceCampaign, graph.moduleId)).reading.requireMaterial(graph, names),
        requireMapMaterial: async (graph: ModuleGraph, params: Row) => (await owner(graph.sourceCampaign, graph.moduleId)).reading.requireMapMaterial(graph, params),
        // §107.1: like the adjacent prefetch, a table that still follows the shared library queues nothing there.
        queueArrivalMap: async (graph: ModuleGraph, scene: Row): Promise<Row> => graph.sourceCampaign === undefined
            ? { state: 'none' }
            : (await owner(graph.sourceCampaign, graph.moduleId)).reading.queueArrivalMap(graph, scene),
    });
    return Object.freeze({ handlers, source, close: async () => {
        closed = true;
        await Promise.all([reading.close(), ...[...scopes.values()].map(value => value.reading.close())]);
    } });
}
