import {npcViews} from '../npc/read.js';
/** Host-only workspace snapshot. This read path never enters the turn state machine. */
import { join } from "node:path";
import type { KernelContext } from "../context.js";
import type { KernelResult } from "../handlers.js";
import { jsonDigest, pythonJsonDumps } from "../json.js";
import { RpcError } from "../errors.js";
import { buildCapsule } from "./assemble.js";
import type { CampaignSnapshot } from "./campaign.js";
import { contextBinding } from "./context.js";
import { readCampaign } from "./handlers.js";
import { array, number, row, string, type Row } from "./values.js";
import {graphMaterialCandidates, sourceReference, workspaceNodes, WORKSPACE_ADAPTER} from './workspace-candidates.js';
import {RuleObservations} from './rule-facts.js';
import {prescreenCatalog} from './prescreen-catalog.js';
import {Catalog, moduleSpellRecords} from '../rules/catalog.js';
import {RuleTables} from '../rules/tables.js';
import {lookupRules} from '../rules/queries.js';
import {boundedMaterialBody, coherentGraphMaterials, coverageByFamily, interleaveMaterials, materialKey, materialPage, MATERIAL_VIEW_VERSION} from './prescreen-materials.js';

const MAX_EVIDENCE = 24;
const MAX_CANDIDATES = 128;
const MAX_MATERIAL_DISCOVERY = 512;
// Static and record references share one bounded manifest budget; these slots are reserved for
// records so a large static module can never structurally crowd record references out entirely.
const RECORD_SLOTS = 12;
// Campaign-minted nodes lead the static scan (bounded), so what this table itself made can never
// be crowded out of the manifest by lexicographic id order — the same reservation logic as the
// record slots, on the static side.
const AUTHORITIES = ["module_source", "rules_source", "campaign_adaptation", "table_record"] as const;

type Binding = {
    campaign: string;
    worldline: string;
    loop: number;
    turn: number;
    source_revision: string | null;
    stateStamp: string | null;
    generation: number;
    scene: string;
    rules_revision: string | null;
    memory_revision?: string;
    npc_revision?: string;
    records_revision?: string;
    catalog_revision?: string;
    adapter: string;
};

/**
 * Current dynamic state, deliberately separate from source_revision. Snapshot values — not only
 * the turn ordinal — catch an imported/restored state with a reused turn, and party/session saves
 * are included before any dynamic view is ever bound to this stamp. Nothing unverified is stored
 * as fact: the stamp only decides whether previously captured evidence may still be reused.
 */
async function stateStamp(campaign: CampaignSnapshot, worldline: string, loop: number): Promise<string> {
    const sanity: Row[] = [];
    for (const sheet of campaign.party) sanity.push(row(await campaign.optional(join("save", "sanity-state", `${string(sheet.id)}.json`)) ?? null));
    const session = {
        combat: await campaign.optional(join("save", "combat.json")),
        chase: await campaign.optional(join("save", "chase.json")),
    };
    return jsonDigest({ world: campaign.world, turn: campaign.turn, party: campaign.party, sanity, session, worldline, loop });
}

function expectedBinding(params: Row): Row | null {
    const supplied = params.binding ?? params._binding;
    return supplied && typeof supplied === "object" && !Array.isArray(supplied) ? row(supplied) : null;
}

function bindingMatches(expected: Row | null, actual: Binding): boolean {
    if (!expected) return true;
    if (expected.campaign !== undefined && expected.campaign !== actual.campaign) return false;
    if (expected.worldline !== undefined && expected.worldline !== actual.worldline) return false;
    if (expected.loop !== undefined && expected.loop !== actual.loop) return false;
    if (expected.turn !== undefined && expected.turn !== actual.turn) return false;
    if (expected.source_revision !== undefined && expected.source_revision !== actual.source_revision) return false;
    if (expected.stateStamp !== undefined && expected.stateStamp !== actual.stateStamp) return false;
    for (const key of ['rules_revision', 'memory_revision', 'npc_revision', 'records_revision', 'catalog_revision'] as const)
        if (expected[key] !== undefined && expected[key] !== actual[key]) return false;
    return true;
}

const MATERIAL_BINDING_KEYS = ['campaign', 'worldline', 'loop', 'turn', 'source_revision', 'stateStamp',
    'rules_revision', 'memory_revision', 'npc_revision', 'records_revision', 'catalog_revision'] as const;
function materialDependencies(keys: readonly unknown[]): Set<string> {
    const result = new Set<string>(['campaign', 'worldline', 'loop', 'turn']);
    if (!keys.length) {for (const key of MATERIAL_BINDING_KEYS) result.add(key); return result;}
    const add = (...values: string[]) => values.forEach(value => result.add(value));
    for (const value of keys) {
        const key = string(value);
        if (key.startsWith('graph:') || key.startsWith('graph-unit:')) add('source_revision');
        else if (key.startsWith('rule:')) add('rules_revision');
        else if (key.startsWith('record:')) add('records_revision');
        else if (key.startsWith('catalog:')) add('catalog_revision');
        else if (key.startsWith('read:')) {
            let kind = '';
            try {kind = string(array(JSON.parse(key.slice(5)))[0]);} catch {add(...MATERIAL_BINDING_KEYS); continue;}
            if (kind === 'npc') add('source_revision', 'stateStamp', 'npc_revision', 'memory_revision', 'records_revision');
            else if (kind === 'memory') add('stateStamp', 'memory_revision', 'records_revision');
            else if (kind === 'rule') add('rules_revision');
            else if (kind === 'catalog') add('catalog_revision');
            else add('stateStamp');
        } else add(...MATERIAL_BINDING_KEYS);
    }
    return result;
}
function bindingChanges(expected: Row | null, actual: Binding, keys: readonly unknown[] = []): string[] {
    if (!expected) return [];
    const dependencies = materialDependencies(keys);
    return MATERIAL_BINDING_KEYS.filter(key => dependencies.has(key) && expected[key] !== undefined && expected[key] !== actual[key]);
}

function unavailable(reason: string): KernelResult {
    return { version: 1, status: "unverifiable", binding: null,
        source: { available: false, reason: reason.slice(0, 160) }, authority: { checked: false },
        coverage: { static: { status: "unavailable" }, records: { status: "unavailable" } },
        manifest: { version: 1, static: [], records: [], truncated: false } };
}

/** A bounded dependency group. If its closure is too large, expose a gap instead of a partial rule. */
function ruleReference(rules: RuleObservations, name: string, scope: Row, source: string, revision: string): Row | null {
    const node = rules.nodes.get(name);
    if (!node || node.node_kind !== 'rule') return null;
    const group: Row[] = [], pending = [node.node_id], seen = new Set<string>(), links: Row[] = [];
    const incoming = new Map<string, Row[]>();
    for (const relation of array(rules.graph.relations)) {
        const list = incoming.get(relation.to_node_id) ?? [];
        list.push(relation); incoming.set(relation.to_node_id, list);
    }
    let omitted = false;
    for (let i = 0; i < pending.length && i < 32; i++) {
        const id = pending[i]; if (seen.has(id)) continue; seen.add(id);
        const member = rules.nodes.get(id); if (!member) continue;
        group.push(member);
        const relations = [...(rules.outgoing.get(id) ?? []), ...(incoming.get(id) ?? [])];
        if (relations.length > 32) omitted = true;
        for (const relation of relations.slice(0, 32)) {
            links.push(relation);
            const target = relation.from_node_id === id ? relation.to_node_id : relation.from_node_id;
            if (seen.has(target)) continue;
            if (pending.length < 64) pending.push(target); else omitted = true;
        }
    }
    const body = pythonJsonDumps({rule: name, source_group: group, relations: links}), complete = !omitted && pending.every(id => seen.has(id)) && Buffer.byteLength(body, 'utf8') <= 8192;
    return {locator: name.startsWith('rule:') ? name : `rule:${name}`, kind: 'rule', scope, source_revision: source, rules_revision: revision,
        adapter: WORKSPACE_ADAPTER, authority: 'rules_source', audience: 'keeper_only', identity: jsonDigest({revision, name}),
        ...(complete ? {body, text: body} : {}), coverage: complete ? {status: 'complete', projection: 'rule_dependency_group'}
            : {status: 'partial', omitted: ['rule_dependency_group'], read: {kind: 'rule', query: name}},
        scene_refs: [], entity_refs: [], thread_refs: []};
}

/**
 * Formal record references under the codebase's existing authority convention (`read/context.ts`,
 * `memory/jobs.ts`): a record is canonical committed work only when `narrate` closed it and its
 * campaign commit exists. ask/implicit/stranded or commit-less records carry no authority here;
 * they are skipped, never allowed to mark an otherwise valid snapshot unverifiable.
 */
function recordReferences(records: readonly Row[], scope: Row, source: string, materialMode = false): Row[] {
    const refs: Row[] = [];
    for (const record of records) {
        if (record.closed_by !== "narrate") continue;
        const commit = record.commit;
        if (typeof commit !== "string" || !commit) continue;
        const turn = number(record.turn), locator = `turn:${turn}`, identity = jsonDigest({ turn, commit, record_id: record.id ?? null });
        if (!materialMode) {
            const text = string(record.rendered_text || record.player_text || locator).slice(0, 2000);
            refs.push({id: jsonDigest({source, locator, commit}), locator, turn, authority: 'table_record', scope,
                source_revision: source, identity, ...(text ? {text} : {}), coverage: 'complete'});
            continue;
        }
        const read = {tool: 'recall', what: 'transcript', turns: [turn, turn]},
            packet = boundedMaterialBody({turn, player: record.player_text ?? null, keeper: record.rendered_text ?? null,
                marked: record.marked_text ?? null, speech: record.speech ?? null}, read);
        refs.push({ id: jsonDigest({ source, locator, commit }), locator, turn, authority: "table_record", scope,
            source_revision: source, identity,
            key: materialKey('record', {source, turn, commit}), kind: 'committed_record', label: `Committed turn ${turn}`,
            summary: string(record.rendered_text || record.player_text || locator).slice(0, 512), ...packet,
            ...(packet.body ? {text: packet.body} : {}), coverage: {...row(packet.coverage), attribution: true} });
    }
    return refs;
}

function v2Request(value: unknown): Row | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const request = row(value), allowed = ['version', 'mode', 'keys', 'cursor', 'limit', 'entity'];
    if (Object.keys(request).some(key => !allowed.includes(key)) || number(request.version) !== MATERIAL_VIEW_VERSION
        || !['catalog', 'read', 'check'].includes(string(request.mode)))
        throw new RpcError('invalid_params', 'preselect v2 requires mode catalog, read or check and only supported fields');
    if (request.keys !== undefined && (!Array.isArray(request.keys) || request.keys.some(key => typeof key !== 'string' || !key)))
        throw new RpcError('invalid_params', 'preselect v2 keys must be nonempty strings');
    if (request.mode === 'read' && !array(request.keys).length)
        throw new RpcError('invalid_params', 'preselect v2 read requires at least one issued key');
    if (request.entity !== undefined && (request.mode !== 'catalog' || typeof request.entity !== 'string' || !request.entity.trim()))
        throw new RpcError('invalid_params', 'preselect entity requires a nonempty semantic handle in catalog mode');
    return request;
}

/**
 * Assemble bounded static projections and record references from one campaign snapshot. It intentionally does
 * not call `look`, `lookup`, `touchActing`, or any transaction contribution; this is not a Keeper
 * tool and it cannot produce a receipt/call_id/event/job.
 */
export async function workspaceRead(context: KernelContext, params: Row): Promise<KernelResult> {
    const campaignName = params.campaign;
    if (typeof campaignName !== "string" || !campaignName.trim()) return unavailable("params.campaign is required");
    const materialRequest = v2Request(params.preselect);
    let loaded;
    try {
        // frontend=true plus readOnlyLegacyTrail=true keeps legacy trail repair in memory only.
        loaded = await readCampaign(context, { ...params, campaign: campaignName }, true, false, {}, true);
    }
    catch (error) {
        return unavailable(error instanceof Error ? error.message : String(error));
    }
    const { campaign, module } = loaded;
    // `preload("view")` intentionally skips turn records; this snapshot is their one explicit
    // reader. A missing turns directory is a young campaign (no records yet), not an error.
    let recordsUnavailable: string | null = null;
    const requested = params.candidate_limit;
    const limit = typeof requested === 'number' && Number.isInteger(requested) ? Math.min(MAX_CANDIDATES, Math.max(1, requested)) : MAX_CANDIDATES;
    let recordFiles = 0,npcRecords:Row[]|undefined;
    try {
        const directory = join(campaign.dir, 'turns');
        const names = (await context.snapshots.sortedChildNames(directory, path => context.snapshots.isFile(path))).filter(name => name.endsWith('.json'));
        recordFiles = names.length;
        // Freshness covers the same retained record window regardless of candidate pagination.
        const needed=params.npc_perspectives===true?names:names.slice(-RECORD_SLOTS);
        const records=await Promise.all(needed.map(async name=>row(await campaign.optional(join('turns',name)))));
        campaign.records=records.slice(-RECORD_SLOTS);
        if(params.npc_perspectives===true)npcRecords=records;
    }
    catch (error) { recordsUnavailable = error instanceof Error ? error.message : String(error); }
    let memoryRows: Row[] = [], npcLedger: Row = {}, npcJournal: Row = {}, catalogResult: Row = {
        ok: true, kinds: [], candidates: [], truncated: false, unresolved_family_parameters: []};
    let dependencyUnavailable: string | null = null;
    const query = string(params.query || campaign.turn.player_text);
    if (materialRequest) {
        try {
            [memoryRows, npcLedger, npcJournal] = await Promise.all([
                campaign.log('memory/candidates.jsonl'), campaign.optional('npc-ledger.json').then(row), campaign.optional('npc-journal.json').then(row),
            ]);
            if (query.trim()) catalogResult = await new Catalog(new RuleTables(context)).search(query,
                {limit: 12, moduleSpells: moduleSpellRecords(module.graph, campaign.world)});
        } catch (error) { dependencyUnavailable = error instanceof Error ? error.message : String(error); }
    }
    if (dependencyUnavailable) return {version: 1, status: 'unverifiable', binding: null,
        source: {available: false, reason: 'material dependency unavailable'}, authority: {checked: false},
        materials: {version: MATERIAL_VIEW_VERSION, candidates: [], coverage: {}, unavailable: 'dependency_read_failed',
            detail: dependencyUnavailable.slice(0, 160)}, manifest: {version: 1, static: [], records: [], truncated: false}};
    const catalogSnapshot = {query, kinds: catalogResult.kinds ?? [], candidates: catalogResult.candidates ?? [],
        truncated: catalogResult.truncated ?? false, unresolved_family_parameters: catalogResult.unresolved_family_parameters ?? []};
    let capsule: Row;
    try { capsule = await buildCapsule(campaign, module); }
    catch (error) { return unavailable(error instanceof Error ? error.message : String(error)); }
    const contextView = await contextBinding(campaign, module, capsule),
        worldline = string(contextView.worldline || "main"),
        loop = number(contextView.loop),
        source = typeof contextView.source_revision === "string" ? contextView.source_revision : null;
    let dynamic: string | null = null;
    if (source) {
        try { dynamic = await stateStamp(campaign, worldline, loop); }
        catch (error) { return unavailable(error instanceof Error ? error.message : String(error)); }
    }
    let rules: RuleObservations | undefined, rulesRevision: string | null = null;
    try {rules = await RuleObservations.load(context); rulesRevision = jsonDigest({graph: rules.manifest.graph_content_digest, package: rules.packageManifest, adapter: WORKSPACE_ADAPTER});}
    catch { /* Unavailable rules remove rule evidence, never degrade the game's current state. */ }
    const scene = string(campaign.world.active_scene);
    const recordsRevision = jsonDigest(campaign.records.filter(record => record.closed_by === 'narrate')
        .map(record => ({turn: record.turn, commit: record.commit ?? null, id: record.id ?? null, player: record.player_text ?? null, keeper: record.rendered_text ?? null})));
    const actual: Binding = { campaign: campaign.id, worldline, loop, turn: number(campaign.turn.turn), source_revision: source,
        stateStamp: dynamic, generation: module.generation, scene, rules_revision: rulesRevision, adapter: WORKSPACE_ADAPTER,
        ...(materialRequest ? {memory_revision: jsonDigest(memoryRows), npc_revision: jsonDigest({ledger: npcLedger, journal: npcJournal}),
            records_revision: recordsRevision, catalog_revision: jsonDigest(catalogSnapshot)} : {}) };
    if (!source || !dynamic) return unavailable("source or state binding is unavailable");
    const expected = expectedBinding(params), changes = materialRequest
        ? bindingChanges(expected, actual, array(materialRequest.keys)) : bindingMatches(expected, actual) ? [] : ['binding'];
    if (changes.length) return { version: 1, status: "unverifiable", binding: actual,
        source: { available: false, revision: source }, authority: { checked: false },
        coverage: { static: { status: "unavailable" }, records: { status: "unavailable" } },
        manifest: { version: 1, static: [], records: [], truncated: false },
        ...(materialRequest ? {materials: {version: MATERIAL_VIEW_VERSION, candidates: [], coverage: {},
            check: {status: 'stale', changed: changes, keys: array(materialRequest.keys)}}} : {}) };
    const scope = { campaign: campaign.id, worldline, loop };
    if (materialRequest?.mode === 'check') {
        if (recordsUnavailable) return {version: 1, status: 'unverifiable', binding: actual,
            source: {available: true, revision: source, authority: 'module_source', generation: module.generation},
            authority: {checked: true, allowed: [...AUTHORITIES], scope}, materials: {version: MATERIAL_VIEW_VERSION,
                candidates: [], coverage: {}, checked: false, unavailable: 'records'}};
        return {version: 1, status: 'valid', binding: actual,
            source: {available: true, revision: source, authority: 'module_source', generation: module.generation},
            authority: {checked: true, allowed: [...AUTHORITIES], scope},
            materials: {version: MATERIAL_VIEW_VERSION, candidates: [], coverage: {},
                check: {status: 'current', changed: [], keys: array(materialRequest.keys), dependencies: [...materialDependencies(array(materialRequest.keys))]}}};
    }
    const names = array(params.names).filter(value => typeof value === 'string').slice(0, 16);
    const ruleNames = array(params.rules).filter(value => typeof value === 'string').slice(0, Math.min(8, Math.floor(limit / 4)));
    const ruleRefs = rules && rulesRevision ? ruleNames.map(name => ruleReference(rules!, name, scope, source, rulesRevision!)).filter((ref): ref is Row => Boolean(ref)) : [];
    const records = recordReferences(campaign.records, scope, source).slice(-Math.min(RECORD_SLOTS, Math.floor(limit / 4)));
    const discoveryLimit=materialRequest?MAX_MATERIAL_DISCOVERY:limit;
    const pool = workspaceNodes(module.graph, {revision: source, scene, query: string(params.query || campaign.turn.player_text), names,
        present: array(capsule.present).map(person => string(row(person).name)), limit: Math.max(0, discoveryLimit - records.length - ruleRefs.length)});
    const statics = [...ruleRefs, ...pool.nodes.map(node => sourceReference(module.graph, node, scope, source, scene,
        module.material(module.graph.handle(node)) === 'ready'))];
    const
        recordManifest = records.slice(0, RECORD_SLOTS),
        staticManifest = statics.slice(0, Math.max(0, MAX_EVIDENCE - recordManifest.length)),
        staticOmitted = Math.max(0, module.graph.nodes.size - pool.nodes.length),
        recordOmitted = Math.max(0, recordFiles - recordManifest.length),
        truncated = staticOmitted > 0 || recordOmitted > 0 || statics.length > staticManifest.length,
        unready = statics.filter(ref => ref.coverage !== 'complete' && row(ref.coverage).status !== 'complete').length;
    // Quota omission is reported as `truncated` on an otherwise valid snapshot; only a records
    // read that itself failed leaves the snapshot unverifiable.
    if (recordsUnavailable) return { version: 1, status: "unverifiable", binding: actual,
        source: { available: true, revision: source, authority: "module_source", generation: module.generation },
        authority: { checked: true, allowed: [...AUTHORITIES], scope },
        coverage: { static: { status: "unavailable" }, records: { status: "unavailable", reason: recordsUnavailable.slice(0, 160) } },
        manifest: { version: 1, static: [], records: [], truncated } };
    const result: Row = {
        version: 1,
        status: "valid",
        binding: actual,
        relevant_entities: [...new Set([...array(capsule.present).map(person => string(row(person).name)),
            ...array(campaign.world.discovered_clues).filter(value => typeof value === 'string')])].slice(0, 32),
        source: { available: true, revision: source, authority: "module_source", generation: module.generation },
        authority: { checked: true, allowed: [...AUTHORITIES], scope },
        coverage: {
            static: { status: unready > 0 ? "partial" : "complete", count: statics.length, ready: statics.length - unready, omitted: staticOmitted },
            records: { status: "complete", count: records.length, omitted: recordOmitted }
        },
        // Host-only candidates precede the 24-entry projection cut. The host validates their
        // provenance before choosing source bodies; records remain non-executable source cards.
        inspected: pool.inspected + records.length + ruleRefs.length,
        candidates: { static: statics, records },
        ...(params.preselect === true ? {read_catalog: prescreenCatalog({party: campaign.party, world: campaign.world,
            graph: module.graph, present: array(capsule.present), rules})} : {}),
        manifest: { version: 1, static: staticManifest, records: recordManifest, truncated }
    };
    if (!materialRequest) return result;
    if(materialRequest.mode==='catalog'&&params.npc_perspectives===true&&!recordsUnavailable){
        result.npc_perspectives=await npcViews({campaign:campaign.id,graph:module.graph,world:campaign.world,meta:campaign.meta,
            turn:campaign.turn,memory:memoryRows,records:npcRecords??campaign.records,ledger:npcLedger,read:file=>campaign.optional(file).then(value=>value==null?null:row(value))});
    }
    const graphMaterials = coherentGraphMaterials(pool.nodes.map(node => graphMaterialCandidates(module.graph,node,scope,source,
        module.material(module.graph.handle(node))==='ready')));
    const ruleMaterials = rules && rulesRevision ? lookupRules(rules, query, 8).flatMap(hit => {
        const name = string(hit.name), value = ruleReference(rules!, name, scope, source, rulesRevision!);
        if (!value) return [];
        const clause = rules!.nodes.get(name), body = value.body ?? pythonJsonDumps({rule: name,
            source_group: clause ? [clause] : [], relations: rules!.outgoing.get(name) ?? []});
        return [{...value, body, key: materialKey('rule', {revision: rulesRevision, locator: value.locator}),
            kind: 'rule_clause', label: string(clause?.name || name), summary: string(clause?.name || name),
            coverage: value.body ? value.coverage : {...row(value.coverage), supplied: ['selected_rule_clause']},
            read: {tool: 'lookup', kind: 'rule', query: name}}];
    }) : [];
    const dynamicMaterials = prescreenCatalog({party: campaign.party, world: campaign.world, graph: module.graph,
        present: array(capsule.present), rules}).candidates.map(candidate => ({...candidate,
            key: `read:${candidate.key}`, authority: candidate.kind === 'memory' ? 'conversation_report'
                : ['rule', 'catalog'].includes(candidate.kind) ? 'rulebook_read' : 'current_read',
            coverage: {status: 'partial', omitted: ['material_not_read']},
            ...(candidate.kind === 'memory' ? {method: 'memory.evidence', params: {action: 'snapshot', query, filters: {}}} : {})}));
    const catalogMaterials = array(catalogResult.candidates).map(candidate => ({key: materialKey('catalog', {
            kind: candidate.kind ?? null, entity_id: candidate.entity_id ?? null, name: candidate.name ?? null, source: row(candidate.source).table ?? null}), kind: 'catalog_record',
        label: string(candidate.name || candidate.entity_id), summary: pythonJsonDumps(row(candidate.summary)).slice(0, 512), authority: 'rulebook_read',
        coverage: {status: 'complete'}, data: structuredClone(candidate), read: {tool: 'lookup', kind: 'catalog', query}}));
    const materialRecords = recordReferences(campaign.records, scope, source, true);
    const allMaterials = interleaveMaterials([materialRecords, ruleMaterials, catalogMaterials, graphMaterials, dynamicMaterials]);
    let selected = allMaterials;
    if (typeof materialRequest.entity === 'string') selected = allMaterials.filter(candidate =>
        candidate.kind === 'graph_entity' && row(candidate.read).query === materialRequest.entity);
    if (materialRequest.mode === 'read') {
        const wanted = new Set(array(materialRequest.keys));
        selected = allMaterials.filter(candidate => wanted.has(candidate.key));
        const missing = [...wanted].filter(key => !selected.some(candidate => candidate.key === key));
        if (missing.length) throw new RpcError('invalid_params', 'preselect v2 read contains a key not issued by the current catalog',
            {details: {missing}});
        selected = selected.map(candidate => {
            if (candidate.kind !== 'rule' || !rules || !rulesRevision) return candidate;
            const family = string(row(candidate.params).query), nodes = [...rules.nodes.values()]
                .filter(node => node.node_kind === 'rule' && string(row(node.properties).family_id) === family)
                .sort((left, right) => string(left.node_id).localeCompare(string(right.node_id))), materialized: Row[] = [];
            for (const node of nodes.slice(0, 8)) {
                const ref = ruleReference(rules, string(node.node_id), scope, source, rulesRevision);
                if (!ref) continue;
                materialized.push({name: node.node_id, label: node.name ?? null,
                    ...(ref.body ? JSON.parse(string(ref.body)) : {source_group: [node], relations: rules.outgoing.get(string(node.node_id)) ?? []}),
                    coverage: ref.coverage});
            }
            const packedRules: Row[] = [];
            for (const item of materialized) {
                if (Buffer.byteLength(pythonJsonDumps({family, rules: [...packedRules, item]}), 'utf8') > 16 * 1024) break;
                packedRules.push(item);
            }
            const omittedRules = nodes.length - packedRules.length,
                nestedPartial = packedRules.some(item => row(item.coverage).status !== 'complete');
            return {...candidate, body: pythonJsonDumps({family, rules: packedRules}),
                read: {tool: 'lookup', kind: 'rule', query: family}, coverage: {
                    status: omittedRules || nestedPartial ? 'partial' : 'complete', bytes: Buffer.byteLength(pythonJsonDumps({family, rules: packedRules}), 'utf8'),
                    ...(omittedRules ? {omitted: ['family_rule_remainder'], omitted_rules: omittedRules} : {}),
                    ...(nestedPartial ? {dependency_groups_partial: true} : {}), dependencies: 'rule_dependency_groups'}};
        });
    }
    const page = materialPage(selected, materialRequest.cursor, materialRequest.limit);
    result.materials = {version: MATERIAL_VIEW_VERSION, candidates: page.candidates,
        coverage: coverageByFamily(page.candidates, materialRequest.entity !== undefined ? {graph_entity: selected.length} : {graph_entity: graphMaterials.length, rule_clause: ruleMaterials.length,
            committed_record: recordFiles, investigator: dynamicMaterials.filter(value => value.kind === 'investigator').length,
            npc: dynamicMaterials.filter(value => value.kind === 'npc').length, object: dynamicMaterials.filter(value => value.kind === 'object').length,
            memory: dynamicMaterials.filter(value => value.kind === 'memory').length, session: dynamicMaterials.filter(value => value.kind === 'session').length,
            catalog_record: array(catalogResult.candidates).length}), next: page.next};
    result.materials.coverage.graph_entity={...row(result.materials.coverage.graph_entity),entities_inspected:pool.inspected,
        entities_addressable:pool.nodes.length,discovery_limit:MAX_MATERIAL_DISCOVERY};
    return result;
}
