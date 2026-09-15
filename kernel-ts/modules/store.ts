/** Module metadata pointers publish complete, append-only generation directories. */
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import type { KernelContext } from '../context.js';
import { RpcError } from '../errors.js';
import { appendJsonl, sha256File, writeJsonAtomic } from '../fileio.js';
import { compareUnicode } from '../json.js';
import { ModuleGraph, dossierWith } from '../read/module-graph.js';
import { buildVocabulary } from '../read/mods.js';
import { array, clone, normalize, number, repr, row, string, truth, type Row } from '../read/values.js';
import { assetRegistry, graphManifest, openingReport, registerStarter, startSceneCandidates } from '../write/source.js';
import { readPublishedGraph } from '../read/published-graph.js';
import { nowIso } from '../write/store.js';
import { loadModuleContract, type ModuleContract } from './contract.js';
import { childPath, inside, resolvedPath } from './paths.js';
export function validateModuleId(value: any): string {
    if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(value)) {
        throw new RpcError('invalid_params', 'module_id must be a short kebab slug', {
            fix: "lowercase letters, digits and '-' (max 64 chars)", details: { module_id: value ?? null },
        });
    }
    return value;
}
export class ModuleStore {
    readonly root: string;
    private readonly graphs = new Map<string, {
        generation: number;
        graph: ModuleGraph;
    }>();
    private contractPromise?: Promise<ModuleContract>;
    constructor(readonly context: KernelContext) { this.root = context.moduleRoot ?? join(context.stateRoot, 'modules'); }
    contract(): Promise<ModuleContract> { return this.contractPromise ??= loadModuleContract(this.context); }
    /** Contract 28.2: the words the installed packages add to the reader's dossier ask. Read per
     *  build rather than cached, so installing or defaulting a package changes the next book and
     *  never a book already read. */
    buildVocabulary(): Promise<Row> { return buildVocabulary(this.context); }
    moduleDir(id: string): string { return join(this.root, id); }
    moduleJson(id: string): string { return join(this.moduleDir(id), 'module.json'); }
    queuePath(id: string): string { return join(this.moduleDir(id), 'deepen-queue.json'); }
    async ids(): Promise<string[]> { return this.context.snapshots.sortedChildNames(this.root, path => this.context.snapshots.pathExists(join(path, 'module.json'))); }
    async exists(id: any): Promise<boolean> { return typeof id === 'string' && this.context.snapshots.pathExists(this.moduleJson(id)); }
    async module(id: any): Promise<Row> {
        if (typeof id !== 'string' || !id)
            throw new RpcError('invalid_params', 'params.module_id is required');
        if (!await this.context.snapshots.pathExists(this.moduleJson(id))) {
            throw new RpcError('invalid_params', `unknown module ${repr(id)}`, {
                fix: 'bind an original PDF with module.source.bind or register a starter', details: { module_id: id, modules: await this.ids() },
            });
        }
        return clone(row(await this.context.snapshots.readJson(this.moduleJson(id))));
    }
    async writeModule(meta: Row): Promise<void> { meta.updated_at = nowIso(); await writeJsonAtomic(this.moduleJson(string(meta.id)), meta); }
    async generation(id: string): Promise<number> { return number((await this.module(id)).generation || 0); }
    async graphPath(id: string, binding?: Row): Promise<string> {
        if (binding || await this.context.snapshots.pathExists(this.moduleJson(id))) {
            const meta = binding ?? await this.module(id);
            if (typeof meta.graph_file === 'string') {
                const path = await resolvedPath(childPath(this.moduleDir(id), meta.graph_file));
                if (!inside(await resolvedPath(this.moduleDir(id)), path)) {
                    const error = new Error('graph_file escapes the module store');
                    error.name = 'ValueError';
                    throw error;
                }
                return path;
            }
        }
        return join(this.moduleDir(id), 'module-graph.json');
    }
    async assetsPath(id: string): Promise<string> {
        return join(await this.exists(id) && truth((await this.module(id)).graph_file) ? dirname(await this.graphPath(id)) : this.moduleDir(id), 'assets.json');
    }
    async readGraph(id: string): Promise<Row | null> {
        const meta = await this.module(id), path = await this.graphPath(id, meta);
        if (!await this.context.snapshots.pathExists(path) && !number(meta.generation) && !meta.graph_file && !meta.graph_digest) return null;
        return clone((await readPublishedGraph(this.context, path, meta, id)).raw);
    }
    async graph(id: string): Promise<ModuleGraph> {
        const meta = await this.module(id), generation = number(meta.generation), cached = this.graphs.get(id);
        const path = await this.graphPath(id, meta);
        if (!number(meta.generation) && !meta.graph_file && !meta.graph_digest && !await this.context.snapshots.pathExists(path))
            throw new RpcError('campaign_not_ready', `module ${repr(id)} has no graph yet`, { fix: 'prepare the original PDF with the visual reading service' });
        const loaded = await readPublishedGraph(this.context, path, meta, id);
        if (cached?.generation === generation && cached.graph.digest === loaded.digest) return cached.graph;
        const dossier = dossierWith(row((await this.contract()).graph.actor_dossier), row(meta.vocabulary));
        const graph = new ModuleGraph(id, clone(loaded.raw), loaded.digest, dossier);
        this.graphs.set(id, { generation, graph });
        return graph;
    }
    async writeGraph(meta: Row, graph: Row): Promise<Row> {
        const id = string(meta.id), generation = number(meta.generation || 0) + 1;
        const ordered = { ...graph };
        if (Array.isArray(ordered.nodes))
            ordered.nodes = [...ordered.nodes].sort((a, b) => compareUnicode(a.node_id, b.node_id));
        if (Array.isArray(ordered.relations))
            ordered.relations = [...ordered.relations].sort((a, b) => compareUnicode(a.relation_id, b.relation_id));
        const directory = join(this.moduleDir(id), 'generations', `generation-${generation}-${randomUUID().replaceAll('-', '')}`);
        await mkdir(dirname(directory), { recursive: true });
        await mkdir(directory);
        const path = join(directory, 'module-graph.json');
        await writeJsonAtomic(path, ordered);
        await writeJsonAtomic(join(directory, 'module-graph-manifest.json'), graphManifest(ordered, id, generation));
        await writeJsonAtomic(join(directory, 'assets.json'), assetRegistry(ordered, await this.assets(id)));
        Object.assign(meta, { generation, graph_file: relative(this.moduleDir(id), path), graph_digest: await sha256File(path) });
        this.graphs.delete(id);
        return meta;
    }
    async register(id: string): Promise<Row> { const result = await registerStarter(this.context, id); this.graphs.delete(id); return result; }
    async sections(id: string): Promise<Row[]> {
        const meta = await this.module(id), path = truth(meta.index_file) ? childPath(this.moduleDir(id), meta.index_file) : join(this.moduleDir(id), 'sections.json');
        return await this.context.snapshots.pathExists(path) ? clone(array(await this.context.snapshots.readJson(path))) : [];
    }
    async writeSections(id: string, sections: Row[]): Promise<void> { await writeJsonAtomic(join(this.moduleDir(id), 'sections.json'), sections); }
    async assets(id: string): Promise<Row[]> {
        const path = await this.assetsPath(id);
        return await this.context.snapshots.pathExists(path) ? clone(array(row(await this.context.snapshots.readJson(path)).assets)) : [];
    }
    async asset(id: string, name: string): Promise<Row | null> {
        const key = normalize(name);
        if (!key)
            return null;
        for (const item of await this.assets(id)) {
            const keys = [item.id, item.name, item.node_id, item.bundle_asset_id, ...array(item.aliases)];
            if (typeof item.node_id === 'string')
                for (const kind of ['asset', 'handout'])
                    if (item.node_id.startsWith(kind + '-'))
                        keys.push(item.node_id.slice(kind.length + 1));
            if (!keys.some(value => typeof value === 'string' && normalize(value) === key))
                continue;
            const resolved = { ...item };
            if (truth(item.path)) {
                resolved.path = childPath(this.moduleDir(id), string(item.path));
                if (!await this.context.snapshots.isFile(resolved.path)) resolved.path = null;
            }
            return resolved;
        }
        return null;
    }
    async queue(id: string): Promise<Row[]> { return await this.context.snapshots.pathExists(this.queuePath(id)) ? clone(array(await this.context.snapshots.readJson(this.queuePath(id)))) : []; }
    async writeQueue(id: string, queue: Row[]): Promise<void> { await writeJsonAtomic(this.queuePath(id), queue); }
    async appendBuildLog(id: string, item: Row): Promise<void> { await appendJsonl(join(this.moduleDir(id), 'build.jsonl'), { at: nowIso(), ...item }); }
    async opening(graph: Row): Promise<Row> {
        const contract = await this.contract(), dossier = row(contract.graph.actor_dossier);
        return openingReport(graph, new ModuleGraph(string(graph.module_id || ''), graph, '', dossier), contract.template, dossier);
    }
    async candidates(graph: Row): Promise<Row[]> { return startSceneCandidates(graph, row((await this.contract()).graph.actor_dossier)); }
}
