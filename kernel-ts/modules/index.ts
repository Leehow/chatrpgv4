/** Static source API and its single owner-local publication lifetime. */
import type { KernelContext } from '../context.js';
import { RpcError } from '../errors.js';
import type { HandlerGroup } from '../handlers.js';
import type { ModuleGraph } from '../read/module-graph.js';
import { equal, repr, row, string, truth, type Row } from '../read/values.js';
import { Reading } from './reading.js';
import { ModuleStore } from './store.js';
import { ensureCampaignModule } from './campaign-scope.js';
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
        'module.read.request': params => reading.request(params),
        'module.read.claim': params => reading.claim(params),
        'module.read.finish': params => reading.finish(params),
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
            if (equal(meta.reading_version, 1)) {
                const queue = await store.queue(id);
                return {
                    module_id: id, title: meta.title ?? null, source: 'pdf', status: meta.status ?? null,
                    generation: meta.generation ?? 0, page_count: meta.page_count ?? null, languages: meta.languages ?? [],
                    opening_ready: truth(meta.opening_ready), opening: meta.opening ?? {},
                    reading: { ...row(meta.reading), opening_ready: truth(meta.opening_ready), queued: queue.filter(job => job.state === 'queued').length, active: queue.find(job => job.state === 'running')?.job_id ?? null },
                    opening_candidates: await store.candidates(await store.readGraph(id) || {}),
                };
            }
            const sections = await store.sections(id), counts: Row = {};
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
    const owner = async (campaign: any, id: string) => {
        if (closed) throw new RpcError('invalid_params', 'the source runtime is closed');
        if (campaign === undefined) return library;
        const scoped = await ensureCampaignModule(context, campaign, id);
        if (closed) throw new RpcError('invalid_params', 'the source runtime is closed');
        let value = scopes.get(campaign);
        if (!value) {
            const store = new ModuleStore(scoped), reading = new Reading(store);
            value = { store, reading, handlers: handlersFor(store, reading) };
            scopes.set(campaign, value);
        }
        return value;
    };
    const libraryOnly = new Set(['module.source.bind', 'module.register', 'module.list']);
    const handlers: HandlerGroup = Object.freeze(Object.fromEntries(Object.entries(library.handlers).map(([method, handler]) => [method,
        async (params: Row) => libraryOnly.has(method) || params.campaign === undefined
            ? handler(params)
            : (await owner(params.campaign, required(params, 'module_id'))).handlers[method](params),
    ])));
    const source = Object.freeze({
        store,
        graphPath: async (moduleId: string, campaign?: string) => (await owner(campaign, moduleId)).store.graphPath(moduleId),
        materialReady: async (moduleId: string, name: string, campaign?: string) => (await owner(campaign, moduleId)).reading.materialReady(moduleId, name),
        openingReady: async (moduleId: string, focus = '', campaign?: string) => (await owner(campaign, moduleId)).reading.openingReady(moduleId, focus),
        request: async (params: Row) => (await owner(params.campaign, required(params, 'module_id'))).reading.request(params),
        queueAdjacentReading: async (graph: ModuleGraph, scene: Row) => (await owner(graph.sourceCampaign, graph.moduleId)).reading.queueAdjacentReading(graph, scene),
        requireMaterial: async (graph: ModuleGraph, names: any[]) => (await owner(graph.sourceCampaign, graph.moduleId)).reading.requireMaterial(graph, names),
        requireMapMaterial: async (graph: ModuleGraph, params: Row) => (await owner(graph.sourceCampaign, graph.moduleId)).reading.requireMapMaterial(graph, params),
    });
    return Object.freeze({ handlers, source, close: async () => {
        closed = true;
        await Promise.all([reading.close(), ...[...scopes.values()].map(value => value.reading.close())]);
    } });
}
