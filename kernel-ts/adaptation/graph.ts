/** Closed campaign adaptations; original source graphs are never mutated. */
import { RpcError } from '../errors.js';
import { jsonDigest } from '../json.js';
import { ModuleGraph, recordOf } from '../read/module-graph.js';
import { resolveReference } from '../read/references.js';
import { array, clone, row, string, type Row } from '../read/values.js';

export const ADAPTATION_FIELDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
    scene: ['scene', 'name', 'description'], clue_at: ['clue', 'scene'], route: ['from', 'to'],
    add_scene: ['name', 'description', 'based_on'], add_npc: ['name', 'description', 'agenda'],
    npc_knows: ['npc', 'clue'], handout: ['name', 'text', 'based_on']
});
function text(value: unknown, field: string, maximum = 2000): string {
    if (typeof value !== 'string' || !value.trim() || value.length > maximum)
        throw new RpcError('invalid_params', `Adaptation ${field} needs nonempty text of at most ${maximum} characters`);
    return value.trim();
}
function name(value: unknown): string {
    const result = text(value, 'name', 120);
    if (/[\/\\\x00-\x1f]/.test(result) || result === '.' || result === '..' || Object.hasOwn(Object.prototype, result) || result === 'prototype')
        throw new RpcError('invalid_params', 'An adaptation name must be a safe single semantic name');
    return result;
}
function setRecord(node: Row, changes: Row) {
    const props = row(node.properties);
    node.properties = {...props, runtime_projection: {...row(props.runtime_projection), record: {...recordOf(node), ...changes}}};
}
/** Normalized IDs below are minted/bound by the kernel, never copied by the Keeper. */
export function adaptedGraph(source: ModuleGraph, changes: Row[]): ModuleGraph {
    const raw = clone(source.raw), nodes = new Map<string, Row>(array(raw.nodes).map(n => [n.node_id, n]));
    const semanticNames = new Map<string, string>();
    raw.relations ??= []; raw.claims ??= [];
    for (const change of changes) {
        const provenance = {reason: change.reason, sources: change.sources};
        const edge = (kind: string, from: string, to: string) => {
            if (!array(raw.relations).some(r => r.relation_kind === kind && r.from_node_id === from && r.to_node_id === to))
                raw.relations.push({relation_id: `adapt-${jsonDigest([kind, from, to]).slice(0, 20)}`, relation_kind: kind, from_node_id: from, to_node_id: to, campaign_origin: provenance});
        };
        if (['add_scene', 'add_npc', 'handout'].includes(change.kind)) {
            const kind = change.kind === 'add_scene' ? 'scene' : change.kind === 'add_npc' ? 'npc' : 'handout';
            const properties: Row = {name: change.name, semantic_name: change.name};
            if (kind === 'scene') Object.assign(properties, {scene_id: change.name, description: change.description, available_clues: [], npc_ids: [], is_start: false});
            if (kind === 'npc') Object.assign(properties, {agenda: change.agenda, facts: []});
            if (kind === 'handout') properties.authored_text = change.text;
            const node: Row = {node_id: change.id, node_kind: kind, name: change.name, aliases: [],
                summary: change.description ?? `Campaign rendition of ${change.name}`, visibility: kind === 'handout' ? 'revealable' : 'keeper-only',
                properties, campaign_origin: provenance};
            if (nodes.has(node.node_id)) throw new RpcError('invalid_params', 'An adaptation duplicates an entity identity');
            nodes.set(node.node_id, node); raw.nodes.push(node);
            semanticNames.set(node.node_id, change.name);
        } else if (change.kind === 'scene') {
            const node = nodes.get(change.scene);
            if (!node) throw new RpcError('needs', 'Adapted source scene is missing');
            node.summary = change.description;
            node.campaign_origin = provenance;
            setRecord(node, {description: change.description, ...(change.name ? {display_name: change.name} : {})});
            if (change.name) node.aliases = [...array(node.aliases), change.name];
        } else if (change.kind === 'clue_at') edge('discoverable-at', change.clue, change.scene);
        else if (change.kind === 'route') edge('route-to', change.from, change.to);
        else if (change.kind === 'npc_knows') {
            const npc = nodes.get(change.npc);
            if (!npc) throw new RpcError('needs', 'Adapted source NPC is missing');
            const facts = [...array(recordOf(npc).facts)];
            if (!facts.some(f => f.clue_id === change.clue)) facts.push({clue_id: change.clue, campaign_origin: provenance});
            setRecord(npc, {facts});
        } else throw new RpcError('invalid_params', 'Unknown normalized adaptation change');
    }
    return new ModuleGraph(source.moduleId, raw, jsonDigest([source.digest, changes]), source.dossier, semanticNames, true);
}

export function normalizeChanges(source: ModuleGraph, previous: Row[], world: Row, input: unknown, proposal: string): Row[] {
    if (!Array.isArray(input) || !input.length || input.length > 24)
        throw new RpcError('invalid_params', 'An adaptation needs one to twenty-four closed changes');
    const changes: Row[] = [];
    for (const [index, value] of input.entries()) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RpcError('invalid_params', 'Each adaptation change must be an object');
        const kind = string(value.kind), fields = Object.hasOwn(ADAPTATION_FIELDS, kind) ? ADAPTATION_FIELDS[kind] : undefined;
        if (!fields || Object.keys(value).some(key => !['kind', 'reason', 'sources', ...fields].includes(key)))
            throw new RpcError('invalid_params', 'Use only the declared fields of a closed adaptation operation', {details: {index, operations: Object.keys(ADAPTATION_FIELDS)}});
        if (!Array.isArray(value.sources) || !value.sources.length || value.sources.length > 12)
            throw new RpcError('invalid_params', 'Each change must name its original source anchors');
        const graph = adaptedGraph(source, [...previous, ...changes]);
        const reference = (owner: ModuleGraph, field: string, given: unknown, kinds?: string[]): string => {
            try { return resolveReference(owner, given, kinds).node_id; }
            catch (error) {
                if (!(error instanceof RpcError)) throw error;
                throw new RpcError(error.code, `Change ${index} (${kind}), field ${field}: ${error.message}`, {
                    fix: `${error.fix ?? ''} New campaign names are valid only after their add operation; sources must refer to the original graph.`,
                    details: {...error.details, index, field}
                });
            }
        };
        const change: Row = {kind, reason: text(value.reason, 'reason'), sources: value.sources.map((s: any) => reference(source, 'sources', s))};
        const bind = (field: string, type: string) => change[field] = reference(graph, field, text(value[field], field, 180), [type]);
        if (kind === 'scene') {
            bind('scene', 'scene');
            const handle = graph.handle(graph.nodes.get(change.scene)!);
            if (handle === world.active_scene || array(world.visited_scenes).includes(handle) || array(world.scene_trail).includes(handle))
                throw new RpcError('invalid_params', 'An encountered scene cannot be rewritten by adaptation');
            if (value.name != null) {
                change.name = name(value.name);
                const prior = graph.find(change.name);
                if (prior && prior.node_id !== change.scene) throw new RpcError('invalid_params', 'A scene name cannot shadow another entity');
            }
            change.description = text(value.description, 'description', 6000);
        } else if (kind === 'clue_at') { bind('clue', 'clue'); bind('scene', 'scene'); }
        else if (kind === 'route') { bind('from', 'scene'); bind('to', 'scene'); }
        else if (kind === 'npc_knows') { bind('npc', 'npc'); bind('clue', 'clue'); }
        else {
            change.name = name(value.name);
            if (graph.find(change.name)) throw new RpcError('invalid_params', `The name ${JSON.stringify(change.name)} is already in use`);
            const type = kind === 'add_scene' ? 'scene' : kind === 'add_npc' ? 'npc' : 'handout';
            change.id = `${type}-adapt-${jsonDigest([proposal, index, kind, change.name]).slice(0, 24)}`;
            if (kind === 'handout') {
                change.based_on = reference(source, 'based_on', text(value.based_on, 'based_on', 180), ['handout']);
                change.text = text(value.text, 'text', 20000);
            } else {
                change.description = text(value.description, 'description', 6000);
                if (kind === 'add_scene') change.based_on = reference(source, 'based_on', text(value.based_on, 'based_on', 180), ['scene']);
                else change.agenda = text(value.agenda, 'agenda');
            }
            if (change.based_on && !change.sources.includes(change.based_on)) change.sources.push(change.based_on);
        }
        changes.push(change);
    }
    return changes;
}

export function adaptationChanges(world: Row): Row[] {
    return array(row(world.adaptation).records).flatMap(record => array(record.changes));
}
