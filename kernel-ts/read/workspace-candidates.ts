/** Static source projections and bounded retrieval; no world mutation or semantic inference. */
import {jsonDigest, pythonJsonDumps} from '../json.js';
import {ModuleGraph, recordOf} from './module-graph.js';
import {array, row, string, type Row} from './values.js';
import {boundedMaterialBody, completeMaterialBody, materialKey, semanticGraphValue, sourceRefsOf} from './prescreen-materials.js';

export const WORKSPACE_ADAPTER = 'static-evidence-v2';
const SOURCE_FIELDS = ['prose', 'description', 'summary', 'agenda', 'fear', 'secret', 'voice',
    'relationship', 'keeper_note', 'keeper_notes', 'social_role', 'dramatic_question', 'background'];
const indexes = new Map<string, {postings: Map<string, string[]>; exact: Map<string, string[]>}>();
const terms = (text: string): string[] => {
    const normalized = text.normalize('NFKC').toLocaleLowerCase();
    // Generic character pairs are lexical retrieval keys, never an intent or language classifier.
    const chars = Array.from(normalized).slice(0, 1024);
    return [...new Set(chars.length < 2 ? chars : chars.slice(0, -1).map((value, i) => value + chars[i + 1]))];
};

export function staticBody(graph: ModuleGraph, node: Row): {body: string; coverage: Row} {
    const record = recordOf(node), fields: Row = {};
    for (const key of SOURCE_FIELDS) {
        const value = record[key] ?? row(node.properties)[key];
        if (typeof value === 'string' && value) fields[key] = value;
    }
    const body = JSON.stringify({name: graph.handle(node), kind: node.node_kind, summary: node.summary ?? '',
        authored_background: fields});
    const coverage: Row = {status: 'complete', projection: WORKSPACE_ADAPTER, entity_complete: false,
        omitted: ['dynamic_state', 'unselected_source_fields']};
    if (Buffer.byteLength(body, 'utf8') <= 8192) return {body, coverage};
    // An excerpt is explicitly a range of the source projection, never a full entity or rule.
    let excerpt = '';
    for (const char of body) {if (Buffer.byteLength(excerpt + char, 'utf8') > 8192) break; excerpt += char;}
    return {body: excerpt, coverage: {...coverage, range: {from: 0, to: Array.from(excerpt).length},
        omitted: [...coverage.omitted, 'source_projection_remainder']}};
}

/** Build lexical postings once per effective published graph revision; never scan a PDF. */
function indexFor(graph: ModuleGraph, revision: string) {
    const key = `${graph.moduleId}:${revision}`;
    const existing = indexes.get(key);
    if (existing) {indexes.delete(key); indexes.set(key, existing); return existing;}
    const index = {postings: new Map<string, string[]>(), exact: new Map<string, string[]>()};
    let postings = 0;
    for (const node of graph.nodes.values()) {
        if (postings >= 262144 || index.exact.size >= 16384 || index.postings.size >= 65536) break;
        const id = string(node.node_id);
        for (const name of graph.nameKeys(node)) {
            const key = name.normalize('NFKC').toLocaleLowerCase();
            const ids = index.exact.get(key) ?? []; if (ids.length < 128) {ids.push(id); postings++;} index.exact.set(key, ids);
        }
        for (const term of terms(`${node.name ?? ''} ${node.summary ?? ''} ${graph.prose(node).slice(0, 512)}`)) {
            if (postings >= 262144 || index.postings.size >= 65536) break;
            const ids = index.postings.get(term) ?? []; if (ids.length < 128) {ids.push(id); postings++;} index.postings.set(term, ids);
        }
    }
    indexes.set(key, index);
    while (indexes.size > 4) indexes.delete(indexes.keys().next().value!);
    return index;
}

export const PRIORITY_LIMIT = 64;
/**
 * Ordered graph discovery. `priority` is a host-issued ordering from a semantic judgment over the closed
 * entity index (contract §124.10); it only orders exact handles and never filters or widens scope. The
 * character-pair query channel survives only for the legacy ordinary workspace projection (`lexical`);
 * the v2 material view never ranks by it.
 */
export function workspaceNodes(graph: ModuleGraph, input: {revision: string; scene: string; query: string;
    names: string[]; limit: number; present: string[]; priority?: readonly string[]; lexical?: boolean}):
    {nodes: Row[]; inspected: number; priority: {requested: number; resolved: number}} {
    const index = indexFor(graph, input.revision), pending: string[] = [], inspected = new Set<string>();
    const exact = (name: string) => index.exact.get(name.normalize('NFKC').toLocaleLowerCase()) ?? [];
    const add = (id: string) => {
        if (!inspected.has(id) && inspected.size >= input.limit) return;
        inspected.add(id);
        if (pending.length < input.limit && !pending.includes(id)) pending.push(id);
    };
    const priority = (input.priority ?? []).slice(0, PRIORITY_LIMIT);
    let resolved = 0;
    for (const name of priority) {
        // A priority entry is an issued handle compared exactly (no normalization); every node carrying that
        // handle (a scene and its beat may share one) is ordered, and an unknown name orders nothing.
        const ids = exact(name).filter(id => {const node = graph.nodes.get(id); return Boolean(node) && graph.handle(node!) === name;}).slice(0, 4);
        if (ids.length) resolved++;
        for (const id of ids) add(id);
    }
    // Current scene and established identities follow any semantic priority.
    for (const name of [input.scene, ...input.names.slice(0, 16), ...input.present.slice(0, 16)])
        for (const id of exact(name)) add(id);
    const tableLimit = Math.min(pending.length + 12, input.limit);
    for (const id of graph.tableNames.keys()) {if (pending.length >= tableLimit) break; add(id);}
    if (input.lexical !== false) {
        const scores = new Map<string, number>();
        const queryLimit = inspected.size + Math.floor((input.limit - inspected.size) / 2);
        for (const term of terms(input.query).slice(0, 64))
            for (const id of index.postings.get(term) ?? []) {
                if (!inspected.has(id) && inspected.size >= queryLimit) continue;
                inspected.add(id);
                scores.set(id, (scores.get(id) ?? 0) + 1);
            }
        for (const [id] of [...scores].sort((a, b) => b[1] - a[1]).slice(0, Math.floor(input.limit / 2))) add(id);
    }
    for (let i = 0; i < pending.length && i < input.limit; i++) {
        const id = pending[i];
        for (const relation of [...(graph.out.get(id) ?? []).slice(0, input.limit), ...(graph.incoming.get(id) ?? []).slice(0, input.limit)]) {
            if (pending.length >= input.limit) break;
            add(string(relation.from_node_id) === id ? string(relation.to_node_id) : string(relation.from_node_id));
        }
    }
    // Very young/empty scenes retain a bounded published-source fallback, not a sorted full scan.
    for (const node of graph.nodes.values()) {if (pending.length >= input.limit) break; add(string(node.node_id));}
    const nodes = pending.map(id => graph.nodes.get(id)).filter((node): node is Row => Boolean(node));
    return {nodes, inspected: inspected.size, priority: {requested: priority.length, resolved}};
}

const INDEX_SUMMARY_CHARS = 320;
export const ENTITY_INDEX_LIMIT = 2048;
/** The closed, query-independent entity index a semantic locate judges (contract §124.10). */
export function entityIndex(graph: ModuleGraph, limit = ENTITY_INDEX_LIMIT): {entities: Row[]; total: number; omitted: number} {
    const entities: Row[] = [], squash = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/[\s_-]+/gu, '');
    for (const node of graph.nodes.values()) {
        if (entities.length >= limit) break;
        const handle = graph.handle(node), label = graph.displayName(node), kind = string(node.node_kind || 'module'), record = recordOf(node);
        // A summary that only restates the name carries no content; the first authored description stands in for it.
        let summary = string(node.summary ?? '');
        if (!summary.trim() || [label, handle, `${kind}${handle}`].some(name => squash(name) === squash(summary)))
            summary = [graph.prose(node), record.description, record.dramatic_question, record.agenda, record.keeper_note]
                .find((value): value is string => typeof value === 'string' && Boolean(value.trim())) ?? summary;
        entities.push({handle, label, kind, summary: Array.from(summary).slice(0, INDEX_SUMMARY_CHARS).join('')});
    }
    return {entities, total: graph.nodes.size, omitted: Math.max(0, graph.nodes.size - entities.length)};
}

export function sourceReference(graph: ModuleGraph, node: Row, scope: Row, revision: string, scene: string, ready: boolean): Row {
    const kind = string(node.node_kind || 'module'), locator = `${kind}:${graph.handle(node)}`;
    const projected = staticBody(graph, node);
    const sceneRefs = new Set<string>(), threadRefs = new Set<string>();
    if (kind === 'scene') sceneRefs.add(graph.handle(node));
    if (kind === 'conclusion') threadRefs.add(graph.handle(node));
    for (const relation of [...(graph.out.get(node.node_id) ?? []).slice(0, 128), ...(graph.incoming.get(node.node_id) ?? []).slice(0, 128)]) {
        for (const id of [relation.from_node_id, relation.to_node_id]) {
            const linked = graph.nodes.get(id); if (linked?.node_kind === 'scene') sceneRefs.add(graph.handle(linked));
            if (linked?.node_kind === 'conclusion') threadRefs.add(graph.handle(linked));
        }
    }
    return {locator, kind, scope, source_revision: revision, audience: 'keeper_only', adapter: WORKSPACE_ADAPTER,
        identity: jsonDigest({revision, locator}), authority: node.campaign_origin ? 'campaign_adaptation' : 'module_source',
        ...(ready ? {body: projected.body} : {}), text: ready ? projected.body : '',
        coverage: ready ? projected.coverage : 'unavailable',
        scene_refs: [...sceneRefs].slice(0, 16), entity_refs: [graph.handle(node)],
        thread_refs: [...new Set([...threadRefs, ...array(row(node.properties).thread_refs).filter(value => typeof value === 'string')])].slice(0, 16)};
}

/** A v2 graph candidate carries structured authored material with semantic handles, never raw node ids. */
export function graphMaterialCandidate(graph: ModuleGraph, node: Row, scope: Row, revision: string, ready: boolean): Row {
    const handle = graph.handle(node), locator = `${string(node.node_kind || 'module')}:${handle}`;
    const names = new Map([...graph.nodes.values()].map(value => [string(value.node_id), graph.handle(value)]));
    const read = {tool: 'lookup', kind: 'module', query: handle};
    const raw = JSON.parse(pythonJsonDumps({entity: graph.entityView(node), authored: recordOf(node), relations: graph.relationsOf(node)}));
    const projected = semanticGraphValue(raw, names);
    const material = ready ? boundedMaterialBody(projected, read) : {coverage: {status: 'unavailable', omitted: ['material_not_ready']}, read};
    return {key: materialKey('graph', {revision, locator}), kind: 'graph_entity', label: graph.displayName(node),
        summary: string(node.summary || node.name || handle), authority: node.campaign_origin ? 'campaign_adaptation' : 'module_source',
        locator, scope, source_revision: revision, ...material, refs: sourceRefsOf(node)};
}

const GRAPH_UNIT_BYTES = 4096;
function unitGroups(entries:readonly [string,unknown][],stub:Row,key:string):Array<{name:string;value:Row}> {
    const groups:Array<{name:string;value:Row}>=[];let fields:Row={},names:string[]=[];
    const flush=()=>{if(names.length){groups.push({name:names.join(','),value:{entity:stub,[key]:fields}});fields={};names=[];}};
    for(const [name,value] of entries){const next={...fields,[name]:value};
        if(names.length&&Buffer.byteLength(pythonJsonDumps({entity:stub,[key]:next}),'utf8')>GRAPH_UNIT_BYTES)flush();
        fields[name]=value;names.push(name);
        if(Buffer.byteLength(pythonJsonDumps({entity:stub,[key]:fields}),'utf8')>GRAPH_UNIT_BYTES)flush();
    }
    flush();return groups;
}

/** Complete source-owned graph units, interleaved by the caller across entities before later units of one large entity. */
export function graphMaterialCandidates(graph:ModuleGraph,node:Row,scope:Row,revision:string,ready:boolean):Row[] {
    const handle=graph.handle(node),kind=string(node.node_kind||'module'),locator=`${kind}:${handle}`,label=graph.displayName(node),
        read={tool:'lookup',kind:'module',query:handle},refs=sourceRefsOf(node),stub={name:handle,display_name:label,kind,
            summary:string(node.summary??''),visibility:string(node.visibility??'keeper-only')},coreKey=materialKey('graph-unit',{revision,locator,unit:'identity'});
    if(!ready)return[{key:coreKey,kind:'graph_entity',label,summary:string(node.summary||node.name||handle),authority:node.campaign_origin?'campaign_adaptation':'module_source',
        locator,scope,source_revision:revision,coverage:{status:'unavailable',projection:'graph_source_unit',unit:{kind:'identity'},entity_complete:false,
            omitted:['material_not_ready']},read,refs}];
    const common={kind:'graph_entity',summary:string(node.summary||node.name||handle),authority:node.campaign_origin?'campaign_adaptation':'module_source',
        locator,scope,source_revision:revision,read,refs},result:Row[]=[];
    const add=(unit:string,unitLabel:string,value:Row,dependencies:string[]=[])=>{const key=materialKey('graph-unit',{revision,locator,unit});
        result.push({...common,key,label:unitLabel,...completeMaterialBody(value,read,{projection:'graph_source_unit',unit:{kind:unit},entity_complete:false,
            required_context:dependencies.length?dependencies:[],dependencies},GRAPH_UNIT_BYTES)});};
    add('identity',label,{entity:stub});
    const names=new Map([...graph.nodes.values()].map(value=>[string(value.node_id),graph.handle(value)])),authored=row(semanticGraphValue(recordOf(node),names));
    for(const [index,group] of unitGroups(Object.entries(authored).sort(([left],[right])=>left.localeCompare(right)),stub,'authored').entries())
        add(`authored:${index}`,`${label} — ${group.name}`,group.value,[coreKey]);
    const relations=array(semanticGraphValue(graph.relationsOf(node),names));
    for(const [index,group] of unitGroups(relations.map((value,ordinal)=>[String(ordinal),value]),stub,'relations').entries())
        add(`relations:${index}`,`${label} — relationships ${index+1}`,group.value,[coreKey]);
    return result;
}
