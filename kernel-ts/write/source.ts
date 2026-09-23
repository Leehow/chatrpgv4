/** Shared starter registration, source playability and published asset projections. */
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, extname, join, relative } from 'node:path';
import type { KernelContext } from '../context.js';
import { writeJsonAtomic, sha256File } from '../fileio.js';
import { jsonDigest, compareUnicode, parsePythonJson } from '../json.js';
import { RpcError } from '../errors.js';
import { ModuleGraph, recordOf } from '../read/module-graph.js';
import { loadModule } from '../read/campaign.js';
import { readPublishedGraph } from '../read/published-graph.js';
import { array, row, clone, entries, values, truth, number, string, repr, integer, sorted, equal, type Row } from '../read/values.js';
import { withOptionalExclusiveLock } from '../locks.js';
import { nowIso } from './store.js';
import { validSourceLanguage } from '../modules/contract.js';
import { childPath, inside, resolvedPath } from '../modules/paths.js';
import { obligationRefusals, statedObligations } from '../modules/obligation-shape.js';
import { carriesMechanics, mechanicsRefusals, mechanicsRules } from '../modules/mechanics-shape.js';
import { RuleTables } from '../rules/tables.js';
export function nodePages(node: Row): number[] {
    const pages = new Set<number>();
    for (const span of array(node.evidence_span_ids)) {
        const match = typeof span === 'string' ? /^span-(?:p|page-)(\d+)-/.exec(span) : null;
        if (match)
            pages.add(Number(match[1]));
    }
    for (const ref of [...array(node.source_refs), ...array(recordOf(node).source_refs)])
        if (integer(ref?.pdf_index) || typeof ref?.pdf_index === 'boolean')
            pages.add(number(ref.pdf_index));
    const index = row(node.properties).pdf_index;
    if (integer(index))
        pages.add(number(index));
    return [...pages].sort((a, b) => a - b);
}
const nodesOf = (graph: Row): Map<string, Row> => new Map(array(graph.nodes).filter(n => typeof n?.node_id === 'string').map(n => [n.node_id, n]));
function declaration(graph: Row, key: string): string[] | null {
    if (Array.isArray(graph[key]))
        return graph[key].map(string);
    const value = row(array(graph.nodes).find(n => n.node_kind === 'module')?.properties)[key];
    return Array.isArray(value) ? value.map(string) : null;
}
function entrances(graph: Row, graphView: ModuleGraph): string[] {
    const declared = declaration(graph, 'entry_scene_ids'), scenes = graphView.kind('scene');
    if (declared)
        return sorted(new Set(declared.flatMap(id => scenes.filter(s => s.node_id === id || graphView.handle(s) === id).map(s => s.node_id))));
    return sorted(scenes.filter(s => row(s.properties).is_entrance === true || row(s.properties).is_start === true || recordOf(s).is_start === true).map(s => s.node_id));
}
export function endings(graph: Row): {
    ids: string[];
    accounted: boolean;
} {
    const nodes = nodesOf(graph), found = new Set<string>();
    for (const [id, node] of nodes)
        if (node.node_kind === 'ending' || row(node.properties).is_ending === true || row(node.properties).is_final === true || recordOf(node).is_final === true)
            found.add(id);
    const declared = declaration(graph, 'ending_scene_ids');
    if (declared)
        for (const id of declared)
            if (nodes.has(id))
                found.add(id);
    return {
        ids: sorted(found),
        accounted: declared != null
    };
}
function sceneEdges(graph: Row, view: ModuleGraph, kinds: string[]): Array<[
    string,
    string
]> {
    const scenes = new Set(view.kind('scene').map(s => s.node_id)), out: Array<[
        string,
        string
    ]> = [];
    for (const kind of kinds)
        for (const rel of array(graph.relations))
            if (rel.relation_kind === kind && scenes.has(rel.from_node_id) && scenes.has(rel.to_node_id))
                out.push([rel.from_node_id, rel.to_node_id]);
    const byHandle = new Map(view.kind('scene').map(s => [view.handle(s), s.node_id]));
    for (const id of scenes)
        for (const edge of array(recordOf(view.nodes.get(id)).scene_edges)) {
            const target = byHandle.get(edge?.to);
            if (target && !out.some(([from, to]) => from === id && to === target))
                out.push([id, target]);
        }
    return out;
}
export function playability(graph: Row, view: ModuleGraph, template: Row, dossier: Row): Row {
    const nodes = nodesOf(graph), scenes = new Set(view.kind('scene').map(s => s.node_id)), findings: Row[] = [];
    const invariant = new Map(array(template.invariants).map(i => [i.code, i.asks]));
    const finding = (code: string, subject: string, detail: string) => findings.push({
        code,
        subject,
        message: invariant.get(code),
        detail
    });
    for (const rel of array(graph.relations))
        for (const end of ['from_node_id', 'to_node_id'])
            if (!nodes.has(rel[end]))
                finding('dangling_relation', string(rel.relation_id || '?'), `${end} = ${repr(rel[end] ?? null)} is not a node this graph defines`);
    const edges = sceneEdges(graph, view, [...array(template.entrance_relation_kinds), 'route-to']);
    const forward = new Map<string, Set<string>>(), adjacent = new Map<string, Set<string>>();
    const link = (map: Map<string, Set<string>>, a: string, b: string) => {
        if (!map.has(a))
            map.set(a, new Set());
        map.get(a)!.add(b);
    };
    for (const [from, to] of edges) {
        link(forward, from, to);
        link(adjacent, from, to);
        link(adjacent, to, from);
    }
    const seen = new Set<string>(), components: string[][] = [];
    for (const id of sorted(scenes)) {
        if (seen.has(id))
            continue;
        const stack = [id], component = new Set<string>();
        while (stack.length) {
            const current = stack.pop()!;
            if (component.has(current))
                continue;
            component.add(current);
            stack.push(...adjacent.get(current) ?? []);
        }
        for (const current of component)
            seen.add(current);
        components.push(sorted(component));
    }
    const starts = entrances(graph, view);
    if (scenes.size && !starts.length && declaration(graph, 'entry_scene_ids') == null)
        finding('no_entrance_declared', '/', 'no entry_scene_ids, no scene marked is_entrance/is_start, and no explicit empty entry_scene_ids saying the book names none');
    const largest = components.reduce<string[]>((best, component) => component.length > best.length ? component : best, []);
    if (components.length > 1)
        for (const component of [...components].sort((a, b) => b.length - a.length || compareUnicode(a[0], b[0])))
            if (component !== largest)
                finding('scene_graph_fragmented', component[0], `${component.length} scene(s) joined to no exit chain that reaches the main body of ${largest.length}: ${component.slice(0, 6).join(', ')}`);
    if (starts.length) {
        const reached = new Set<string>(), stack = [...starts];
        while (stack.length) {
            const id = stack.pop()!;
            if (reached.has(id))
                continue;
            reached.add(id);
            stack.push(...forward.get(id) ?? []);
        }
        for (const id of sorted([...scenes].filter(s => !reached.has(s))))
            finding('scene_unreachable_from_entrance', id, 'exits exist, but none of them lead here from an entrance');
    }
    const ending = endings(graph);
    if (!ending.ids.length && !ending.accounted)
        finding('no_ending_declared', '/', 'no ending node, no scene marked is_final/is_ending, and no explicit empty ending_scene_ids saying the book states none');
    const supports = array(graph.relations).filter(r => r.relation_kind === 'supports');
    for (const clue of sorted(view.kind('clue').map(n => n.node_id)))
        if (!supports.some(r => r.from_node_id === clue))
            finding('clue_supports_nothing', clue, 'no supports relation leaves this clue');
    for (const conclusion of sorted(view.kind('conclusion').map(n => n.node_id)))
        if (!supports.some(r => r.to_node_id === conclusion))
            finding('conclusion_without_support', conclusion, 'no supports relation arrives here');
    const placed = new Set(array(graph.relations).filter(r => r.relation_kind === 'discoverable-at').map(r => string(r.from_node_id)));
    const present = new Set(array(graph.relations).filter(r => r.relation_kind === 'present-in').map(r => string(r.from_node_id)));
    for (const scene of view.kind('scene')) {
        for (const id of array(recordOf(scene).available_clues))
            placed.add(string(id));
        for (const id of array(recordOf(scene).npc_ids))
            present.add(string(id));
    }
    for (const clue of sorted(view.kind('clue').map(n => n.node_id)))
        if (!placed.has(clue))
            finding('clue_nowhere_to_find', clue, 'no discoverable-at relation places it in a scene');
    for (const kind of array(template.actor_kinds))
        for (const node of view.kind(kind))
            if (!present.has(node.node_id))
                finding('actor_in_no_scene', node.node_id, `no present-in relation puts this ${kind} in a scene`);
    const unpaged = graph.unpaged === true || row(view.moduleNode?.properties).unpaged === true, pages = new Set<number>();
    for (const node of nodes.values()) {
        const source = nodePages(node);
        for (const page of source)
            pages.add(page);
        if (!source.length && !unpaged)
            finding('node_without_page', node.node_id, 'cites no span, source_ref or property that names a page');
    }
    const withClaims = new Set(array(graph.claims).filter(c => array(dossier.claim_predicates).includes(c.predicate)).map(c => string(c.subject_id)));
    const bare = view.kind('npc').filter(n => !array(dossier.profile_keys).some(k => truth(row(n.properties)[k] || row(row(n.properties).runtime_projection).record?.[k]))
        && !withClaims.has(n.node_id) && !truth(row(row(n.properties).runtime_projection).record?.facts));
    const measures: Row = Object.fromEntries(array(template.measures).map(m => [m.code, null]));
    Object.assign(measures, {
        nodes: nodes.size,
        relations: array(graph.relations).length,
        scenes: scenes.size,
        scene_exits: edges.length,
        scene_components: components.length,
        largest_component: largest.length,
        branches: [...scenes].filter(s => (forward.get(s)?.size ?? 0) > 1).length,
        npcs: view.kind('npc').length,
        npcs_without_material: bare.length,
        creatures: view.kind('creature').length,
        clues: view.kind('clue').length,
        conclusions: view.kind('conclusion').length,
        endings: ending.ids.length,
        rules: view.kind('rule').length,
        pages_covered: pages.size
    });
    const counts: Row = {};
    for (const item of findings)
        counts[item.code] = (counts[item.code] ?? 0) + 1;
    return {
        status: findings.length ? 'findings' : 'playable',
        findings,
        finding_counts: Object.fromEntries(sorted(Object.keys(counts)).map(k => [k, counts[k]])),
        measures
    };
}
export function openingReport(graph: Row, view: ModuleGraph, template: Row, dossier: Row): Row {
    const starts = entrances(graph, view), missing: string[] = [];
    if (!view.moduleNode)
        missing.push('module_node');
    if (starts.length !== 1)
        missing.push(starts.length ? `start_scene_ambiguous:${starts.join(',')}` : 'start_scene');
    if (starts.length !== 1) {
        const report: Row = {
            opening_ready: false,
            start_scene: null,
            missing,
            findings: [],
            finding_counts: {}
        };
        const candidates = startSceneCandidates(graph, dossier);
        if (candidates.length >= 2)
            report.choice = {
                field: 'start_scene', reason: 'start_scene_ambiguous', candidates,
                method: 'module.opening.choose',
                ask: 'The book declares more than one opening scene. Ask which one this table starts on, then call module.opening.choose with that scene.'
            };
        return report;
    }
    const start = starts[0], keep = new Set([start]);
    if (view.moduleNode)
        keep.add(view.moduleNode.node_id);
    let waysOn = 0;
    const wayOn = (id: string): void => { if (id !== start && view.nodes.get(id)?.node_kind === 'scene') waysOn++; };
    for (const kind of [...array(template.entrance_relation_kinds), 'route-to'])
        for (const rel of array(graph.relations))
            if (rel.relation_kind === kind && rel.from_node_id === start) {
                if (view.nodes.has(rel.to_node_id)) {
                    keep.add(rel.to_node_id);
                    wayOn(string(rel.to_node_id));
                }
                else
                    missing.push(`exit:${rel.to_node_id}`);
            }
    for (const edge of array(recordOf(view.nodes.get(start)).scene_edges))
        if (typeof edge?.to === 'string') {
            const target = view.kind('scene').find(s => view.handle(s) === edge.to);
            if (target) {
                keep.add(target.node_id);
                wayOn(string(target.node_id));
            }
            else
                missing.push(`exit:${edge.to}`);
        }
    // Contract section NN: `missing` already accounts for an exit that resolves to nothing; until
    // now nothing accounted for an opening that publishes no exit at all. A start scene with no way
    // on and no statement that the book ends there is a one-room book: `sceneExits` is empty, so
    // section 49's route rows have nothing to report -- not a locked way, not an unread way, no way
    // -- and the table sits in the first scene until someone reads the file. This is accounting, not
    // an opinion about the destination: the book either names where this scene leads or says it
    // stops here, and either answer passes. What is behind the exit, and whether its pages have been
    // read, stay out of readiness (section 46; an unread neighbour is the normal published shape,
    // redeemed by `apply move`'s own material gate).
    if (!waysOn && !endings(graph).ids.includes(start))
        missing.push('way_on');
    for (const kind of ['present-in', 'discoverable-at'])
        for (const rel of array(graph.relations))
            if (rel.relation_kind === kind && rel.to_node_id === start && view.nodes.has(rel.from_node_id))
                keep.add(rel.from_node_id);
    for (const key of ['npc_ids', 'available_clues'])
        for (const id of array(recordOf(view.nodes.get(start))[key]))
            if (view.nodes.has(id))
                keep.add(id);
            else
                missing.push(`${key}:${id}`);
    for (const rel of array(graph.relations))
        if (rel.relation_kind === 'supports' && keep.has(rel.from_node_id) && view.nodes.has(rel.to_node_id))
            keep.add(rel.to_node_id);
    const sub: Row = {
        contract_id: graph.contract_id ?? null,
        schema_version: graph.schema_version ?? null,
        module_id: graph.module_id ?? null,
        nodes: sorted(keep).map(id => clone(view.nodes.get(id))),
        claims: array(graph.claims).filter(c => keep.has(c.subject_id) && keep.has(row(c.object).node_id)),
        relations: array(graph.relations).filter(r => keep.has(r.from_node_id) && keep.has(r.to_node_id)),
        entry_scene_ids: [start]
    };
    const ending = endings(graph);
    if (ending.ids.length || ending.accounted)
        sub.ending_scene_ids = ending.ids;
    const report = playability(sub, new ModuleGraph(view.moduleId, sub, '', dossier), template, dossier);
    const findings = report.findings.filter((f: Row) => f.code !== 'no_ending_declared'), counts: Row = {};
    for (const f of findings)
        counts[f.code] = (counts[f.code] ?? 0) + 1;
    // Contract section 46: readiness is `missing`, and only `missing`. `missing` names something the
    // opening points at that is not there -- no module node, no single entrance, an exit or a named
    // NPC or clue that resolves to nothing -- and no table can open on that. `findings` are the
    // playability invariants read as a quality opinion about the book's own graph: a clue the book
    // never connects to a conclusion is the book being a book, not a table that cannot start.
    // Deriving readiness from both made the answer move as more of the source was read, so a later
    // background detail reading could revoke an opening that had already been prepared and played
    // (BUG-039: 22 nodes, `missing` empty, one `clue_supports_nothing`, and the table could not take
    // a single turn). The opinion still travels, in `findings`/`finding_counts` right here, which is
    // where `module.status` already reads it.
    return {
        opening_ready: !missing.length,
        start_scene: start,
        missing,
        findings,
        finding_counts: counts,
        nodes: sub.nodes.length
    };
}
export function startSceneCandidates(graph: Row, dossier: Row = {}): Row[] {
    const view = new ModuleGraph(string(graph.module_id || ''), graph, '', dossier);
    const candidates = new Set(entrances(graph, view));
    if (!equal(declaration(graph, 'entry_scene_ids'), [])) {
        for (const scene of view.kind('scene'))
            if (row(scene.properties).is_entrance === true || row(scene.properties).is_start === true)
                candidates.add(scene.node_id);
        for (const id of array(row(view.moduleNode?.properties).entry_scene_ids))
            if (view.nodes.get(id)?.node_kind === 'scene')
                candidates.add(id);
    }
    return sorted(candidates).map(id => {
        const node = view.nodes.get(id)!;
        return { node_id: id, scene: view.handle(node), name: string(node.name || view.handle(node)), summary: string(node.summary || '') };
    });
}
export function assetRegistry(graph: Row, previousAssets: Row[] = []): Row {
    const assets = clone(previousAssets), unclaimed = new Set(assets.map(a => a.id));
    const kindFor = (node: Row, fallback: string): string => {
        const role = string(row(node.properties).role || recordOf(node).kind || '').toLowerCase();
        return node.node_kind === 'handout' ? 'handout' : role.includes('map') ? 'map' : role.includes('handout') ? 'handout' : ['handout', 'map', 'illustration'].includes(fallback) ? fallback : 'illustration';
    };
    for (const node of array(graph.nodes).filter(n => n && ['asset', 'handout'].includes(n.node_kind))) {
        const candidates = assets.filter(a => unclaimed.has(a.id) && (a.node_id === node.node_id || a.id === node.node_id));
        const sameKind = candidates.filter(a => a.kind === kindFor(node, 'illustration'));
        const match = candidates.length === 1 ? candidates[0] : sameKind.length === 1 ? sameKind[0] : null;
        const props = row(node.properties), record = recordOf(node);
        const entry: Row = {
            id: string(node.node_id),
            kind: kindFor(node, string(match?.kind || 'illustration')),
            name: string(node.name || node.node_id),
            aliases: array(node.aliases).filter(a => typeof a === 'string'),
            pages: nodePages(node),
            path: (truth(props.image_sources) && props.asset_ref) || match?.path || props.asset_ref || null,
            media_type: (truth(props.image_sources) && props.media_type) || match?.media_type || props.media_type || null,
            visibility: node.visibility || 'keeper-only',
            node_id: string(node.node_id),
            summary: node.summary || ''
        };
        const text = record.authored_text || props.authored_text;
        if (typeof text === 'string' && text.trim()) {
            entry.text = text;
            entry.authored_text = text;
        }
        if (typeof record.title === 'string' && record.title && record.title !== entry.name && !entry.aliases.includes(record.title))
            entry.aliases.push(record.title);
        if (match) {
            entry.bundle_asset_id = match.bundle_asset_id || match.id;
            entry.sha256 = match.sha256 ?? null;
            unclaimed.delete(match.id);
            assets.splice(assets.indexOf(match), 1);
        }
        const existing = assets.findIndex(a => a.id === entry.id);
        if (existing >= 0)
            assets.splice(existing, 1);
        assets.push(entry);
    }
    assets.sort((a, b) => {
        const x = a.pages.length ? a.pages : [1e9], y = b.pages.length ? b.pages : [1e9];
        for (let i = 0; i < Math.min(x.length, y.length); i++)
            if (x[i] !== y[i])
                return x[i] - y[i];
        return x.length - y.length || compareUnicode(a.id, b.id);
    });
    return {
        contract_id: 'coc.module-assets.v1',
        schema_version: 1,
        assets
    };
}
export function graphManifest(graph: Row, moduleId: string, generation: number): Row {
    const counts: Row = {};
    for (const node of array(graph.nodes))
        if (node && typeof node === 'object' && !Array.isArray(node))
            counts[string(node.node_kind)] = (counts[string(node.node_kind)] ?? 0) + 1;
    return {
        contract_id: 'coc.module-graph-manifest.v1', schema_version: 1, module_id: moduleId, generation,
        graph_contract_id: graph.contract_id ?? null, graph_content_digest: jsonDigest(graph),
        node_count: array(graph.nodes).length, relation_count: array(graph.relations).length,
        claim_count: array(graph.claims).length,
        node_kinds: Object.fromEntries(sorted(Object.keys(counts)).map(key => [key, counts[key]])),
        section_ids: [...array(graph.section_ids)], built_at: nowIso()
    };
}

/** Publish the private bytes named by one starter graph beside its installed graph. */
async function publishStarterAssets(context: KernelContext, graph: Row, moduleDirectory: string): Promise<void> {
    const moduleNode = array(graph.nodes).find(node => row(node).node_kind === 'module'), properties = row(row(moduleNode).properties),
        assetRootId = properties.asset_root_id;
    if (assetRootId == null) return;
    if (typeof assetRootId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,127}$/.test(assetRootId))
        throw new RpcError('invalid_params', 'starter asset_root_id must be a short kebab slug');
    const root = join(context.stateRoot, 'module-assets', assetRootId);
    if (!await context.snapshots.pathExists(root)) return;
    const identityPath = join(root, 'identity.json');
    if (!await context.snapshots.isFile(identityPath))
        throw new RpcError('invalid_params', 'starter private asset root has no identity.json', { details: { asset_root_id: assetRootId } });
    const identity = row(await context.snapshots.readJson(identityPath)), binding = row(properties.source_binding);
    if (identity.asset_root_id !== assetRootId)
        throw new RpcError('invalid_params', 'starter private asset root names another root', {
            details: { expected: assetRootId, actual: identity.asset_root_id ?? null },
        });
    if (typeof binding.file_sha256 === 'string' && binding.file_sha256 && identity.file_sha256 !== binding.file_sha256)
        throw new RpcError('invalid_params', 'starter private asset root belongs to another source document', {
            details: { asset_root_id: assetRootId, expected: binding.file_sha256, actual: identity.file_sha256 ?? null },
        });
    for (const asset of array(assetRegistry(graph).assets)) {
        if (typeof asset.path !== 'string' || !asset.path) continue;
        const source = childPath(root, asset.path), target = childPath(moduleDirectory, asset.path);
        if (!await context.snapshots.isFile(source)) continue;
        await copyStarterAsset(context, source, target, { asset_root_id: assetRootId, path: asset.path });
    }
}

async function copyStarterAsset(context: KernelContext, source: string, target: string, details: Row): Promise<void> {
    if (await context.snapshots.isFile(target)) {
        if (await sha256File(source) !== await sha256File(target))
            throw new RpcError('invalid_params', 'published starter asset conflicts with its immutable source', { details });
        return;
    }
    await mkdir(dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.${randomUUID().replaceAll('-', '')}.tmp`;
    try {
        await copyFile(source, temporary);
        await rename(temporary, target);
    } finally {
        await rm(temporary, { force: true }).catch(() => undefined);
    }
}

/** A late private root repairs campaign forks of this exact graph without overwriting diverged books. */
async function publishStarterAssetsToCampaignScopes(context: KernelContext, id: string, graph: Row, moduleDirectory: string, meta: Row): Promise<void> {
    const scopesRoot = join(context.stateRoot, 'module-campaigns'), assets = array(assetRegistry(graph).assets);
    for (const campaign of await context.snapshots.sortedChildNames(scopesRoot,
        path => context.snapshots.isFile(join(path, 'modules', id, 'module.json')))) {
        const targetDirectory = join(scopesRoot, campaign, 'modules', id), targetMeta = row(await context.snapshots.readJson(join(targetDirectory, 'module.json')));
        if (targetMeta.source_generation !== meta.generation || targetMeta.graph_digest !== meta.graph_digest) continue;
        for (const asset of assets) {
            if (typeof asset.path !== 'string' || !asset.path) continue;
            const source = childPath(moduleDirectory, asset.path), target = childPath(targetDirectory, asset.path);
            if (!await context.snapshots.isFile(source)) continue;
            await copyStarterAsset(context, source, target, { campaign, module_id: id, path: asset.path });
        }
    }
}

export async function registerStarter(context: KernelContext, id: string): Promise<Row> {
    // Every registration path shares this lock and re-reads the module inside it, so two first
    // registrations of one starter cannot race the exclusive graph write.
    return withOptionalExclusiveLock(context.locks, join(context.stateRoot, 'modules', '.registry.lock'),
        async () => registerStarterLocked(context, id));
}
async function registerStarterLocked(context: KernelContext, id: string): Promise<Row> {
    if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id))
        throw new RpcError('invalid_params', 'module_id must be a short kebab slug', {
            fix: "lowercase letters, digits and '-' (max 64 chars)", details: { module_id: id ?? null }
        });
    const source = join(context.content, 'starters', id), graphFile = join(source, 'module-graph.json'), folder = join(context.stateRoot, 'modules', id), metaFile = join(folder, 'module.json');
    if (!await context.snapshots.pathExists(graphFile))
        throw new RpcError('invalid_params', `unknown starter ${repr(id)}`, { fix: `no module-graph.json under ${source}` });
    const sourceBytes = await readFile(graphFile);
    const graph = row(parsePythonJson(new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(sourceBytes)));
    const digest = createHash('sha256').update(sourceBytes).digest('hex');
    const existing = await context.snapshots.pathExists(metaFile) ? clone(row(await context.snapshots.readJson(metaFile))) : null;
    const contract = row(await context.snapshots.readJson(join(context.content, 'modules', 'module-graph-contract-v3.json'))), dossier = row(contract.actor_dossier);
    const view = new ModuleGraph(id, graph, digest, dossier), template = row(await context.snapshots.readJson(join(context.content, 'modules', 'module-graph-template-v1.json')));
    let meta = existing;
    const writeMeta = async () => { meta!.updated_at = nowIso(); await writeJsonAtomic(metaFile, meta!); };
    if (!existing || existing.graph_digest !== digest) {
        // Contract §134.3: a stated obligation is refused before any byte of the generation is written.
        if (statedObligations(view).length) {
            const tables = new RuleTables(context);
            const refusals = obligationRefusals(view, {skills: Object.keys(await tables.skillsTable()),
                characteristics: Object.keys(await tables.characteristicTable())}, {starter: true});
            if (refusals.length)
                throw new RpcError('invalid_params', `starter ${repr(id)} states an obligation this kernel refuses: ${refusals[0].node} ${refusals[0].path}: ${refusals[0].message}`, {
                    fix: 'repair the requirement node in the starter graph (contract §134); every refusal is in details.refusals',
                    details: {reason: 'obligation_invalid', module: id, refusals},
                });
        }
        // Contract §136.8: a stated mechanical shape is refused before any byte of the generation is written.
        if (carriesMechanics(view)) {
            const refusals = mechanicsRefusals(view, await mechanicsRules(new RuleTables(context)), {starter: true});
            if (refusals.length)
                throw new RpcError('invalid_params', `starter ${repr(id)} states a mechanic this kernel refuses: ${refusals[0].node} ${refusals[0].path}: ${refusals[0].message}`, {
                    fix: 'repair the shape in the starter graph (contract §136); every refusal is in details.refusals',
                    details: {reason: 'mechanics_invalid', module: id, refusals},
                });
        }
        meta = {
            id,
            title: string(view.moduleNode?.name || id),
            source: 'starter',
            languages: [...array(graph.source_languages)],
            generation: number(existing?.generation) + 1,
            status: 'registered',
            starter_path: graphFile,
            created_at: string(existing?.created_at || nowIso()),
            registered_at: nowIso()
        };
        const report = playability(graph, view, template, dossier), opening = openingReport(graph, view, template, dossier);
        await mkdir(folder, {
            recursive: true
        });
        let targetGraph = join(folder, 'module-graph.json');
        if (existing || await context.snapshots.pathExists(targetGraph)) {
            const generationDirectory = join(folder, 'generations', `generation-${meta.generation}-${randomUUID().replaceAll('-', '')}`);
            await mkdir(generationDirectory, {recursive: true});
            targetGraph = join(generationDirectory, 'module-graph.json');
            meta.graph_file = relative(folder, targetGraph);
        }
        await writeFile(targetGraph, sourceBytes, {flag: 'wx'});
        meta.graph_digest = digest;
        const targetDirectory = dirname(targetGraph);
        await writeJsonAtomic(join(targetDirectory, 'module-graph-manifest.json'), graphManifest(graph, id, meta.generation));
        await writeJsonAtomic(join(targetDirectory, 'assets.json'), assetRegistry(graph));
        Object.assign(meta, {
            playability: report,
            opening,
            opening_ready: truth(opening.opening_ready),
            installed_at: nowIso(),
            status: 'installed'
        });
        // Validate the candidate cohort before the metadata pointer can make it visible.
        await readPublishedGraph(context, targetGraph, meta, id);
        await writeMeta();
    }
    let changed = false;
    const listing = join(source, 'starter-listing.json'), required = await context.snapshots.pathExists(listing) && row(await context.snapshots.readJson(listing)).listed === true;
    if ((meta!.bundled_guidance_required ?? false) !== required) {
        meta!.bundled_guidance_required = required;
        changed = true;
    }
    const installedPath = typeof meta!.graph_file === 'string' ? await resolvedPath(childPath(folder, meta!.graph_file)) : join(folder, 'module-graph.json');
    if (!await context.snapshots.pathExists(installedPath))
        throw new RpcError('campaign_not_ready', `module ${repr(id)} has no graph yet`, { fix: 'prepare the original PDF with the visual reading service' });
    const installed = await readPublishedGraph(context, installedPath, meta!, id);
    await publishStarterAssets(context, installed.raw, folder);
    await publishStarterAssetsToCampaignScopes(context, id, installed.raw, folder, meta!);
    const installedView = new ModuleGraph(id, clone(installed.raw), installed.digest, dossier);
    // The bundles a starter ships are whichever `character-guidance/<tag>.json` files exist: the
    // file names are the tags, and there is no list to keep in step (contract section 23).
    const bundles = join(source, 'character-guidance');
    for (const name of await context.snapshots.sortedChildNames(bundles, path => context.snapshots.isFile(path))) {
        if (extname(name) !== '.json')
            continue;
        const language = basename(name, '.json'), path = join(bundles, name);
        if (!validSourceLanguage(language))
            throw new RpcError('invalid_params', `bundled guidance ${repr(name)} is not named by a language tag`, {
                fix: 'name a starter guidance bundle <tag>.json with a BCP-47 language tag',
                details: { module: id, file: name },
            });
        const saved = clone(row(await context.snapshots.readJson(path)));
        if (saved.graph_sha256 !== meta!.graph_digest)
            continue;
        const key = saved.fingerprint, guidance = row(saved.guidance);
        if (saved.module_id !== id || saved.play_language !== language || saved.approved !== true || typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key) || !saved.guidance || Array.isArray(saved.guidance))
            throw new RpcError('invalid_params', `invalid bundled guidance: ${path}`);
        for (const field of ['opening', 'advice', 'scene', 'guide', 'handoff'])
            if (typeof guidance[field] !== 'string' || Array.from(guidance[field]).length > 4000 || field !== 'guide' && !guidance[field].trim())
                throw new RpcError('invalid_params', `invalid bundled guidance field: ${field}`);
        installedView.scene(guidance.scene);
        const target = join(folder, 'character-guidance', key, 'accepted.json');
        if (!await context.snapshots.pathExists(target) || !equal(await context.snapshots.readJson(target), saved))
            await writeJsonAtomic(target, saved);
        meta!.character_guidance ??= {};
        const reference = {
            scene: guidance.scene,
            play_language: language
        };
        if (!equal(meta!.character_guidance[key], reference)) {
            meta!.character_guidance[key] = reference;
            changed = true;
        }
    }
    if (changed)
        await writeMeta();
    return meta!;
}
