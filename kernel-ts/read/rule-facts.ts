/** The single pure condition/fact seam reused by the later RuleGraph migration. */
import { join } from "node:path";
import type { KernelContext } from "../context.js";
import { RpcError } from "../errors.js";
import { REGISTERED_CONDITION_PATHS } from "../capabilities.js";
import { compareUnicode, jsonDigest } from "../json.js";
import { CampaignSnapshot } from "./campaign.js";
import { ModuleGraph, recordOf } from "./module-graph.js";
import { SessionView } from "./session-view.js";
import { entries, values, array, row, number, integer, numeric, truth, string, equal, repr, type Row } from "./values.js";
const PATHS = new Set(REGISTERED_CONDITION_PATHS);
export function semanticName(value: any): string {
    const parts = string(value).split(":");
    return parts.length >= 4 && parts[0] === "decision" ? parts.slice(2).join(":") : string(value);
}
export function children(expression: Row): any[] | null {
    return Array.isArray(expression.of) ? expression.of : expression.of && typeof expression.of === "object" ? [expression.of] : null;
}
export function evaluateCondition(expression: any, facts: Row): boolean | null {
    if (!expression || typeof expression !== "object" || Array.isArray(expression))
        return false;
    const op = expression.op;
    if (["all", "any", "not"].includes(op)) {
        const nested = children(expression);
        if (nested == null)
            return false;
        if (op === "not") {
            if (nested.length !== 1)
                return false;
            const value = evaluateCondition(nested[0], facts);
            return value == null ? null : !value;
        }
        const values = nested.map(child => evaluateCondition(child, facts));
        if (op === "all")
            return values.includes(false) ? false : values.includes(null) ? null : true;
        return values.includes(true) ? true : values.includes(null) ? null : false;
    }
    if (!["eq", "neq", "lt", "lte", "gt", "gte", "contains", "not-contains", "exists"].includes(op))
        return false;
    if (typeof expression.path !== "string" || !PATHS.has(expression.path))
        return null;
    const value = facts[expression.path],
        operand = expression.value;
    if (op === "exists")
        return value != null;
    if (value == null)
        return null;
    if (op === "eq")
        return equal(value, operand);
    if (op === "neq")
        return !equal(value, operand);
    if (op === "contains" || op === "not-contains") {
        const found = Array.isArray(value) ? value.some(v => equal(v, operand)) : typeof value === "string" && typeof operand === "string" ? value.includes(operand) : null;
        return found == null ? null : op === "contains" ? found : !found;
    }
    const numbers = (numeric(value) || typeof value === "boolean") && (numeric(operand) || typeof operand === "boolean");
    if (!numbers && !(typeof value === "string" && typeof operand === "string"))
        return null;
    const compared = numbers ? number(value) - number(operand) : compareUnicode(value, operand);
    return op === "lt" ? compared < 0 : op === "lte" ? compared <= 0 : op === "gt" ? compared > 0 : compared >= 0;
}
export function requirementPhrase(expression: Row, negated = false): string {
    const op = expression.op;
    if (op === "exists")
        return negated ? "to be absent" : "to be present";
    const phrases: Record<string, string> = {
        eq: "to equal",
        neq: "to differ from",
        lt: "to be less than",
        lte: "to be at most",
        gt: "to be greater than",
        gte: "to be at least",
        contains: "to contain",
        "not-contains": "not to contain",
    };
    const phrase = phrases[string(op)] ?? `to satisfy ${repr(op)} against`;
    return negated ? `not (${phrase} ${repr(expression.value)})` : `${phrase} ${repr(expression.value)}`;
}
export function classifyExceptionCondition(expression: any, facts: Row): [
    string,
    string | null
] {
    if (!expression || typeof expression !== "object" || Array.isArray(expression))
        return ["unevaluated", "malformed_expression"];
    const op = expression.op;
    if (["all", "any", "not"].includes(op)) {
        const nested = children(expression);
        if (nested == null || op === "not" && nested.length !== 1)
            return ["unevaluated", "malformed_expression"];
        const statuses = nested.map(child => classifyExceptionCondition(child, facts));
        if (op === "all") {
            if (statuses.some(([status]) => status === "inactive"))
                return ["inactive", null];
            return statuses.find(([status]) => status === "unevaluated") ?? ["matched", null];
        }
        if (op === "any") {
            if (statuses.some(([status]) => status === "matched"))
                return ["matched", null];
            return statuses.find(([status]) => status === "unevaluated") ?? ["inactive", null];
        }
        const [status, reason] = statuses[0];
        return status === "unevaluated" ? [status, reason] : status === "matched" ? ["inactive", null] : ["matched", null];
    }
    if (["eq", "neq", "lt", "lte", "gt", "gte", "contains", "not-contains", "exists"].includes(op)) {
        if (typeof expression.path !== "string" || !PATHS.has(expression.path))
            return ["unevaluated", "unregistered_path"];
        return evaluateCondition(expression, facts) === true ? ["matched", null] : ["inactive", null];
    }
    return ["unevaluated", "unknown_operator"];
}
export function factsFromState(state: Row, sheet: Row, minutes: number | null, extra: Row = {}): Row {
    const conditions = array(state.conditions),
        facts: Row = {
        "actor.id": state.investigator_id ?? null,
        "actor.resources.hp": state.current_hp ?? null,
        "actor.resources.hp_max": row(sheet.derived).HP ?? null,
        "actor.resources.san": state.current_san ?? null,
        "actor.resources.mp": state.current_mp ?? null,
        "actor.resources.luck": state.current_luck ?? null,
        "actor.sheet.con": row(sheet.characteristics).CON ?? null,
        "actor.conditions": conditions
    };
    for (const flag of ["dying", "unconscious", "major_wound", "dead"])
        if (conditions.includes(flag))
            facts[`actor.conditions.${flag}`] = true;
    if (minutes != null && Number.isInteger(minutes) && minutes >= 0 && Array.isArray(state.wound_ledger)) {
        const wounds = state.wound_ledger.filter((w: Row) => w.status === "active"),
            occurred = wounds.filter((w: Row) => integer(w.occurred_elapsed_minutes)).map((w: Row) => number(w.occurred_elapsed_minutes));
        if (occurred.length)
            facts["time.minutes_since_injury"] = Math.max(0, minutes - Math.max(...occurred));
        if (conditions.includes("major_wound") && wounds.length && wounds.every((w: Row) => integer(w.occurred_elapsed_minutes) && typeof w.wound_id === "string" && w.wound_id)) {
            const ordered = [...wounds].sort((a, b) => number(b.occurred_elapsed_minutes) - number(a.occurred_elapsed_minutes) || compareUnicode(b.wound_id, a.wound_id)),
                wound = ordered[0];
            let baseline = number(wound.occurred_elapsed_minutes),
                valid = true;
            for (const recovery of array(state.major_wound_recovery_ledger)) {
                if (!integer(recovery.attempt_elapsed_minutes) || typeof recovery.wound_id !== "string" || !recovery.wound_id) {
                    valid = false;
                    break;
                }
                if (recovery.wound_id === wound.wound_id)
                    baseline = Math.max(baseline, number(recovery.attempt_elapsed_minutes));
            }
            if (valid)
                facts["actor.recovery.major_wound_week_due"] = minutes - baseline >= 10080;
        }
    }
    return {
        ...facts,
        ...extra,
        "intent.rescuer_count": Object.hasOwn(extra, "intent.rescuer_count") ? extra["intent.rescuer_count"] : 1
    };
}
export class RuleObservations {
    readonly nodes: Map<string, Row>;
    readonly outgoing = new Map<string, Row[]>();
    constructor(readonly graph: Row, readonly manifest: Row, readonly packageManifest: Row) {
        this.nodes = new Map(array(graph.nodes).map(n => [n.node_id, n]));
        for (const rel of array(graph.relations))
            this.outgoing.set(rel.from_node_id, [...(this.outgoing.get(rel.from_node_id) ?? []), rel]);
    }
    conditionsFor(id: string): Row[] {
        return (this.outgoing.get(id) ?? []).filter(r => r.relation_kind === "available-when").sort((a, b) => compareUnicode(string(a.relation_id), string(b.relation_id))).map(r => this.nodes.get(r.to_node_id)).filter((n): n is Row => n?.node_kind === "condition");
    }
    applicability(id: string, facts: Row): [
        boolean,
        boolean
    ] {
        const hard = this.conditionsFor(id).filter(c => c.hard_gate === true);
        return [hard.every(c => evaluateCondition(row(c.properties).expression, facts) === true), hard.length > 0];
    }
    positiveGateHits(id: string, facts: Row): Row[] {
        const result: Row[] = [];
        const walk = (expression: any, negated = false) => {
            if (!expression || typeof expression !== "object" || Array.isArray(expression))
                return;
            const nested = children(expression);
            if (nested != null) {
                for (const child of nested)
                    walk(child, negated !== (expression.op === "not"));
                return;
            }
            const path = expression.path;
            if (negated || typeof path !== "string" || ["actor.id", "campaign.ruleset_id", "campaign.ruleset_version", "chase.session.inactive", "chase.start.ready"].includes(path) || expression.op === "neq")
                return;
            if (evaluateCondition(expression, facts) === true)
                result.push({
                    path,
                    actual: facts[path] ?? null
                });
        };
        for (const condition of this.conditionsFor(id))
            if (condition.hard_gate === true)
                walk(row(condition.properties).expression);
        return result;
    }
    async situations(campaign: CampaignSnapshot, graph: ModuleGraph, world: Row, turn: Row): Promise<Row[]> {
        const result: Row[] = [],
            session = new SessionView(campaign, graph, campaign.party, world),
            minutes = number(row(world.clock).minutes),
            pending = new Set<string>();
        const endings = join(campaign.dir, "save", "development-settlements", "endings");
        for (const id of await campaign.context.snapshots.sortedChildNames(endings, path => campaign.context.snapshots.isDirectory(path))) {
            const path = join("save", "development-settlements", "endings", id, "capsule.json"),
                capsule = row(await campaign.optional(path));
            for (const actor of array(capsule.investigator_ids))
                if (!await campaign.context.snapshots.pathExists(join(endings, string(capsule.ending_id || ""), `${actor}.json`)))
                    pending.add(string(actor));
        }
        const sources: Row = {};
        for (const node of graph.kind("npc")) {
            const profile = graph.actorProfile(node),
                spells = profile.spells;
            if (Array.isArray(spells) && spells.length)
                sources[`person:${graph.handle(node)}`] = spells.filter(s => typeof s === "string");
        }
        for (const [owner, abilities] of entries(row(row(world.objects).abilities)))
            sources[`person:${owner}`] = [...array(sources[`person:${owner}`]), ...Object.keys(row(abilities))];
        for (const [kind, prefix] of [["tome", "tome"], ["creature", "entity"]])
            for (const node of graph.kind(kind)) {
                const spells = truth(row(node.properties).spells) ? node.properties.spells : recordOf(node).spells;
                if (Array.isArray(spells) && spells.length)
                    sources[`${prefix}:${graph.handle(node)}`] = spells.filter(s => typeof s === "string");
            }
        for (const sheet of campaign.party) {
            const id = string(sheet.id),
                healing = campaign.healing(id),
                state = {
                investigator_id: id,
                current_hp: sheet.current_hp,
                current_san: sheet.current_san,
                current_mp: sheet.current_mp,
                current_luck: sheet.current_luck,
                conditions: Array.isArray(healing.conditions) ? healing.conditions : array(sheet.conditions),
                wound_ledger: array(healing.wound_ledger),
                major_wound_recovery_ledger: array(healing.major_wound_recovery_ledger)
            };
            const facts = factsFromState(state, sheet, minutes, {
                "campaign.ruleset_id": "coc7",
                "campaign.ruleset_version": string(this.manifest.ruleset_version || "1.0.0"),
                "scene.id": world.active_scene,
                "time.day": Math.floor(minutes / 1440),
                ...session.facts(id, minutes),
                "development.settlement.pending": pending.has(id),
                "magic.spell.known": false,
                "magic.learn.source-available": values(sources).some(v => Array.isArray(v) && v.length)
            });
            for (const node of [...this.nodes.values()].sort((a, b) => compareUnicode(string(a.node_id), string(b.node_id)))) {
                if (node.node_kind !== "decision")
                    continue;
                const [applicable, hard] = this.applicability(node.node_id, facts);
                if (!applicable || !hard)
                    continue;
                const hits = this.positiveGateHits(node.node_id, facts).filter(hit => ["actor.", "time.", "sanity.", "chase.", "development.", "clock.", "subsystem."].some(prefix => hit.path.startsWith(prefix)));
                if (!hits.length)
                    continue;
                result.push({
                    decision: semanticName(node.node_id),
                    family: string(row(node.properties).family_id || ""),
                    label: node.name ?? null,
                    investigator: sheet.id ?? null,
                    because: hits.map(hit => `${hit.path} = ${repr(hit.actual)}`)
                });
            }
        }
        return result;
    }
    static async load(context: KernelContext): Promise<RuleObservations> {
        const directory = join(context.content, "rulesets", "coc7"),
            manifest = row(await context.snapshots.readJson(join(directory, "manifest.json"))),
            entry = row(manifest.entry_points);
        if (typeof entry.rule_graph !== "string" || typeof entry.rule_graph_manifest !== "string")
            throw new RpcError("campaign_not_ready", "the coc7 rule graph is not loadable (graph_absent)", { details: { findings: ["no paired rule_graph entry points in package manifest"] } });
        const graph = row(await context.snapshots.readJson(join(directory, entry.rule_graph))),
            graphManifest = row(await context.snapshots.readJson(join(directory, entry.rule_graph_manifest))),
            problems: string[] = [];
        if (graph.contract_id !== "coc.rule-graph.v1")
            problems.push("graph.contract_id does not match the v1 contract");
        if (graphManifest.contract_id !== "coc.rule-graph-build-manifest.v1")
            problems.push("graph manifest contract_id does not match the v1 contract");
        if (graph.schema_version !== 1 || graphManifest.schema_version !== 1)
            problems.push("graph schema_version does not match the v1 contract");
        if (!Array.isArray(graph.nodes) || !Array.isArray(graph.relations))
            problems.push("graph is missing nodes/relations");
        if (graph.ruleset_id !== (manifest.ruleset_id || "coc7") || graphManifest.ruleset_id !== (manifest.ruleset_id || "coc7"))
            problems.push("graph ruleset_id does not match the requested ruleset");
        if (typeof graphManifest.graph_content_digest !== "string" || graphManifest.graph_content_digest.length !== 64)
            problems.push("graph manifest is missing a declared content digest");
        else if (jsonDigest(graph) !== graphManifest.graph_content_digest)
            problems.push("graph content digest does not match the graph manifest");
        if (problems.length)
            throw new RpcError("campaign_not_ready", "the coc7 rule graph is not loadable (graph_invalid)", { details: { findings: problems } });
        return new RuleObservations(graph, graphManifest, manifest);
    }
}
