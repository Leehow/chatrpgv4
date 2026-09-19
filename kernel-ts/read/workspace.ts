/** Host-only workspace snapshot. This read path never enters the turn state machine. */
import { join } from "node:path";
import type { KernelContext } from "../context.js";
import type { KernelResult } from "../handlers.js";
import { jsonDigest } from "../json.js";
import { buildCapsule } from "./assemble.js";
import type { CampaignSnapshot } from "./campaign.js";
import { contextBinding } from "./context.js";
import { readCampaign } from "./handlers.js";
import { array, number, row, string, type Row } from "./values.js";
import {sourceReference, workspaceNodes, WORKSPACE_ADAPTER} from './workspace-candidates.js';
import {RuleObservations} from './rule-facts.js';

const MAX_EVIDENCE = 24;
const MAX_CANDIDATES = 128;
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
    return true;
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
    const body = JSON.stringify({rule: name, source_group: group, relations: links}), complete = !omitted && pending.every(id => seen.has(id)) && Buffer.byteLength(body, 'utf8') <= 8192;
    return {locator: `rule:${name}`, kind: 'rule', scope, source_revision: source, rules_revision: revision,
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
function recordReferences(records: readonly Row[], scope: Row, source: string): Row[] {
    const refs: Row[] = [];
    for (const record of records) {
        if (record.closed_by !== "narrate") continue;
        const commit = record.commit;
        if (typeof commit !== "string" || !commit) continue;
        const turn = number(record.turn), locator = `turn:${turn}`;
        const text = string(record.rendered_text || record.player_text || locator).slice(0, 2000);
        refs.push({ id: jsonDigest({ source, locator, commit }), locator, turn, authority: "table_record", scope,
            source_revision: source, identity: jsonDigest({ turn, commit, record_id: record.id ?? null }),
            ...(text ? { text } : {}), coverage: "complete" });
    }
    return refs;
}

/**
 * Assemble bounded static projections and record references from one campaign snapshot. It intentionally does
 * not call `look`, `lookup`, `touchActing`, or any transaction contribution; this is not a Keeper
 * tool and it cannot produce a receipt/call_id/event/job.
 */
export async function workspaceRead(context: KernelContext, params: Row): Promise<KernelResult> {
    const campaignName = params.campaign;
    if (typeof campaignName !== "string" || !campaignName.trim()) return unavailable("params.campaign is required");
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
    let recordFiles = 0;
    try {
        const directory = join(campaign.dir, 'turns');
        const names = (await context.snapshots.sortedChildNames(directory, path => context.snapshots.isFile(path))).filter(name => name.endsWith('.json'));
        recordFiles = names.length;
        campaign.records = await Promise.all(names.slice(-Math.min(RECORD_SLOTS, limit)).map(async name => row(await campaign.optional(join('turns', name)))));
    }
    catch (error) { recordsUnavailable = error instanceof Error ? error.message : String(error); }
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
    const actual: Binding = { campaign: campaign.id, worldline, loop, turn: number(campaign.turn.turn), source_revision: source,
        stateStamp: dynamic, generation: module.generation, scene, rules_revision: rulesRevision, adapter: WORKSPACE_ADAPTER };
    if (!source || !dynamic) return unavailable("source or state binding is unavailable");
    if (!bindingMatches(expectedBinding(params), actual)) return { version: 1, status: "unverifiable", binding: actual,
        source: { available: false, revision: source }, authority: { checked: false },
        coverage: { static: { status: "unavailable" }, records: { status: "unavailable" } },
        manifest: { version: 1, static: [], records: [], truncated: false } };
    const scope = { campaign: campaign.id, worldline, loop };
    const names = array(params.names).filter(value => typeof value === 'string').slice(0, 16);
    const ruleNames = array(params.rules).filter(value => typeof value === 'string').slice(0, Math.min(8, Math.floor(limit / 4)));
    const ruleRefs = rules && rulesRevision ? ruleNames.map(name => ruleReference(rules!, name, scope, source, rulesRevision!)).filter((ref): ref is Row => Boolean(ref)) : [];
    const records = recordReferences(campaign.records, scope, source).slice(-Math.min(RECORD_SLOTS, Math.floor(limit / 4)));
    const pool = workspaceNodes(module.graph, {revision: source, scene, query: string(params.query || campaign.turn.player_text), names,
        present: array(capsule.present).map(person => string(row(person).name)), limit: Math.max(0, limit - records.length - ruleRefs.length)});
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
    return {
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
        manifest: { version: 1, static: staticManifest, records: recordManifest, truncated }
    };
}
