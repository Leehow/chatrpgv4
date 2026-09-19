/** Host-only workspace snapshot. This read path never enters the turn state machine. */
import { join } from "node:path";
import type { KernelContext } from "../context.js";
import type { KernelResult } from "../handlers.js";
import { jsonDigest } from "../json.js";
import { buildCapsule } from "./assemble.js";
import type { CampaignSnapshot } from "./campaign.js";
import { contextBinding } from "./context.js";
import { readCampaign } from "./handlers.js";
import { number, row, string, type Row } from "./values.js";

const MAX_EVIDENCE = 24;
const MAX_CANDIDATES = 128;
// Static and record references share one bounded manifest budget; these slots are reserved for
// records so a large static module can never structurally crowd record references out entirely.
const RECORD_SLOTS = 12;
const MAX_NODES = 48;
// Campaign-minted nodes lead the static scan (bounded), so what this table itself made can never
// be crowded out of the manifest by lexicographic id order — the same reservation logic as the
// record slots, on the static side.
const ADAPTED_PRIORITY = 12;
const AUTHORITIES = ["module_source", "campaign_adaptation", "table_record"] as const;

type Binding = {
    campaign: string;
    worldline: string;
    loop: number;
    turn: number;
    source_revision: string | null;
    stateStamp: string | null;
    generation: number;
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

/**
 * Static module references only — the static-only boundary of this snapshot. `identity` names the
 * node's provenance identity, never a body hash: no evidence body travels in a manifest, so a
 * store read can never mistake this value for the content hash of a stored body. A node the table
 * or a reviewed adaptation minted (`campaign_origin`) is `campaign_adaptation`, not book source,
 * and a node whose source material is not prepared degrades to `unavailable` coverage.
 */
function staticReferences(module: { graph: { nodes: Map<string, Row>; handle(node: Row): string } ; material(name: string): string } , scope: Row, source: string): Row[] {
    const nodes = [...module.graph.nodes.values()].sort((left, right) => string(left.node_id).localeCompare(string(right.node_id)));
    const adapted = nodes.filter(node => node.campaign_origin !== null && typeof node.campaign_origin === "object");
    const authored = nodes.filter(node => !(node.campaign_origin !== null && typeof node.campaign_origin === "object"));
    const ordered = [...adapted.slice(0, ADAPTED_PRIORITY), ...authored, ...adapted.slice(ADAPTED_PRIORITY)];
    const result: Row[] = [];
    for (const node of ordered) {
        if (result.length >= MAX_NODES) break;
        const id = string(node.node_id || node.id || node.handle);
        if (!id) continue;
        const kind = string(node.node_kind || node.kind || "module");
        const locator = `${kind}:${id}`;
        const adapted = node.campaign_origin !== null && typeof node.campaign_origin === "object";
        const ready = module.material(module.graph.handle(node)) === "ready";
        const text = string(node.summary || node.name || node.prose || id).slice(0, 2000);
        result.push({ id: jsonDigest({ source, locator }), locator, kind,
            authority: adapted ? "campaign_adaptation" : "module_source", scope,
            source_revision: source, identity: jsonDigest({ source, node_id: id, kind, name: node.name ?? null, summary: node.summary ?? null }),
            ...(text ? { text } : {}), coverage: ready ? "complete" : "unavailable" });
    }
    return result;
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
 * Assemble only references and bounded metadata from one campaign snapshot. It intentionally does
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
    try { campaign.records = await campaign.files("turns"); }
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
    const actual: Binding = { campaign: campaign.id, worldline, loop, turn: number(campaign.turn.turn), source_revision: source,
        stateStamp: dynamic, generation: module.generation };
    if (!source || !dynamic) return unavailable("source or state binding is unavailable");
    if (!bindingMatches(expectedBinding(params), actual)) return { version: 1, status: "unverifiable", binding: actual,
        source: { available: false, revision: source }, authority: { checked: false },
        coverage: { static: { status: "unavailable" }, records: { status: "unavailable" } },
        manifest: { version: 1, static: [], records: [], truncated: false } };
    const scope = { campaign: campaign.id, worldline, loop },
        statics = staticReferences(module, scope, source),
        records = recordReferences(campaign.records, scope, source),
        recordManifest = records.slice(0, RECORD_SLOTS),
        staticManifest = statics.slice(0, Math.max(0, MAX_EVIDENCE - recordManifest.length)),
        staticOmitted = Math.max(0, module.graph.nodes.size - staticManifest.length),
        recordOmitted = Math.max(0, records.length - recordManifest.length),
        truncated = staticOmitted > 0 || recordOmitted > 0,
        unready = statics.filter(ref => ref.coverage !== "complete").length;
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
        source: { available: true, revision: source, authority: "module_source", generation: module.generation },
        authority: { checked: true, allowed: [...AUTHORITIES], scope },
        coverage: {
            static: { status: unready > 0 ? "partial" : "complete", count: statics.length, ready: statics.length - unready, omitted: staticOmitted },
            records: { status: "complete", count: records.length, omitted: recordOmitted }
        },
        // Host-only candidates are wider than the model-facing manifest so a reranker can rank
        // before the 24-entry projection cut. Their bounded text never reaches the Keeper unless
        // the selector explicitly projects an advisory locator entry.
        candidates: { static: statics.slice(0, MAX_CANDIDATES), records: records.slice(0, MAX_CANDIDATES) },
        manifest: { version: 1, static: staticManifest, records: recordManifest, truncated }
    };
}
