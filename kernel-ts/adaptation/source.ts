/** Immutable source snapshots and one derived campaign view. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { KernelContext } from '../context.js';
import type { LoadedModule } from '../read/campaign.js';
import { ModuleGraph } from '../read/module-graph.js';
import { RpcError } from '../errors.js';
import { jsonDigest, pythonJsonDumps, parsePythonJson } from '../json.js';
import { array, row, type Row } from '../read/values.js';
import { adaptedGraph, adaptationChanges } from './graph.js';

async function immutable(path: string, bytes: string | Buffer) {
    try { await writeFile(path, bytes, {flag: 'wx', mode: 0o400}); }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        if (!Buffer.from(await readFile(path)).equals(Buffer.from(bytes))) throw new RpcError('needs', 'Immutable adaptation evidence failed integrity validation');
    }
}
export async function snapshotSource(context: KernelContext, module: LoadedModule, asset: (id: string, name: string) => Promise<Row | null>): Promise<string> {
    const root = join(context.stateRoot, 'adaptation-sources'); await mkdir(root, {recursive: true});
    const assets: Row = {};
    for (const node of [...module.graph.kind('handout'), ...module.graph.kind('asset')]) {
        const item = await asset(module.graph.moduleId, node.node_id);
        if (!item) continue;
        if (typeof item.path === 'string') {
            let bytes: Buffer | undefined;
            try { bytes = await readFile(item.path); } catch { /* Missing source assets remain missing. */ }
            if (bytes) {
                const digest = createHash('sha256').update(bytes).digest('hex'), path = join(root, `asset-${digest}`);
                await immutable(path, bytes); item.path = path;
            }
        }
        assets[node.node_id] = item;
    }
    const data = {module_id: module.graph.moduleId, raw: module.graph.raw, digest: module.graph.digest, dossier: module.graph.dossier,
        meta: module.meta, generation: module.generation, path: module.path,
        ready: [...module.graph.nodes.keys()].filter(id => module.material(id) === 'ready'), assets};
    const digest = jsonDigest(data);
    await immutable(join(root, `${digest}.json`), pythonJsonDumps(data));
    return digest;
}
export async function pinnedSource(context: KernelContext, digest: string): Promise<LoadedModule> {
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new RpcError('needs', 'Invalid adaptation source binding');
    const raw = row(parsePythonJson(await readFile(join(context.stateRoot, 'adaptation-sources', `${digest}.json`), 'utf8')));
    if (jsonDigest(raw) !== digest) throw new RpcError('needs', 'Adaptation source snapshot has changed');
    const graph = new ModuleGraph(raw.module_id, raw.raw, raw.digest, raw.dossier), ready = new Set(array(raw.ready));
    return {graph, meta: raw.meta, generation: raw.generation, path: raw.path,
        material: name => { const node = graph.find(name); return node && ready.has(node.node_id) ? 'ready' : 'missing'; },
        asset: async name => { const node = graph.find(name); return node ? row(raw.assets)[node.node_id] ?? null : null; }};
}
export async function campaignModule(context: KernelContext, moduleId: string, world: Row): Promise<LoadedModule | null> {
    const state = row(world.adaptation);
    if (!state.source) return null;
    const source = await pinnedSource(context, state.source);
    if (source.graph.moduleId !== moduleId) throw new RpcError('needs', 'Adaptation belongs to another module');
    const changes = adaptationChanges(world), graph = adaptedGraph(source.graph, changes);
    if (jsonDigest([state.source, state.records]) !== state.revision) throw new RpcError('needs', 'Adaptation revision has changed');
    const material = (name: string): string => {
        const node = graph.find(name);
        if (!node) return 'missing';
        if (source.graph.nodes.has(node.node_id)) return source.material(node.node_id);
        const anchors = array(row(node.campaign_origin).sources);
        return anchors.length && anchors.every(id => source.material(id) === 'ready') ? 'ready' : 'missing';
    };
    graph.materialOverride = material;
    graph.assetOverride = source.asset;
    return {...source, graph, material, adapted: true};
}
