/** Validated read-only content faces shared by current projections and later rules. */
import { join } from "node:path";
import type { KernelContext } from "../context.js";
import { RpcError, internalError } from "../errors.js";
import { jsonDigest, compareUnicode } from "../json.js";
import { REGISTERED_CONDITION_PATHS, RESOLVER_NAMES } from "../capabilities.js";
import { array, row, number, string, sorted, type Row } from "./values.js";
function contentError(kind: "director" | "craft", message: string, details: Row = {}): RpcError {
    return new RpcError("campaign_not_ready", `the ${kind === "director" ? "Director graph" : "craft content"} is not usable: ${message}`, {
        fix: kind === "director" ? "restore content/director/director-graph.json and its manifest; the Director never falls back to literals" : "restore content/craft/text-graph.json and its manifest",
        details: { [kind]: {
                reason: message,
                ...details
            } },
    });
}
const unreadable = (error: unknown): string => internalError(error).message.replace(/^[A-Za-z]+Error: /, "");
function ordered(nodes: Map<string, Row>, kind: string): Row[] {
    return [...nodes.values()].filter(n => n.node_kind === kind).sort((a, b) => number(row(a.properties).ordinal) - number(row(b.properties).ordinal) || compareUnicode(a.node_id, b.node_id));
}
export class DirectorGraph {
    readonly nodes: Map<string, Row>;
    readonly actions: string[];
    readonly structureTypes: string[];
    readonly scores = new Map<string, any>();
    readonly thresholds = new Map<string, any>();
    readonly weights = new Map<string, Map<string, number>>();
    readonly ruleIds = new Map<string, string>();
    readonly tiebreak: string[];
    readonly digest: string;
    constructor(graph: Row, manifest: Row) {
        if (graph.contract_id !== "coc.director-graph.v1")
            throw contentError("director", "graph does not declare coc.director-graph.v1");
        if (manifest.contract_id !== "coc.director-graph-build-manifest.v1")
            throw contentError("director", "manifest does not declare coc.director-graph-build-manifest.v1");
        if (!Array.isArray(graph.nodes))
            throw contentError("director", "graph has no node list");
        this.digest = jsonDigest(graph);
        if (manifest.graph_content_digest !== this.digest)
            throw contentError("director", "graph content digest does not match the manifest", {
                declared: manifest.graph_content_digest ?? null,
                actual: this.digest
            });
        this.nodes = new Map(graph.nodes.filter((n: any) => typeof row(n).node_id === "string").map((n: Row) => [n.node_id, n]));
        const legacy = new Map([...this.nodes].filter(([, n]) => n.plane === "vocabulary" && Object.hasOwn(row(n.properties), "legacy_key")).map(([id, n]) => [id, string(n.properties.legacy_key)]));
        this.actions = ordered(this.nodes, "director-action").map(n => legacy.get(n.node_id)!);
        this.structureTypes = ordered(this.nodes, "structure-type").map(n => legacy.get(n.node_id)!);
        let tiebreak: string[] = [];
        for (const [id, node] of this.nodes) {
            const props = row(node.properties),
                action = legacy.get(props.action_ref)!;
            if (node.node_kind === "scoring-rule") {
                const key = `${action}\0${props.condition_id}`;
                this.scores.set(key, props.value);
                this.ruleIds.set(key, id);
            }
            else if (node.node_kind === "threshold")
                this.thresholds.set(string(props.threshold_id), props.value);
            else if (node.node_kind === "structure-weight") {
                const structure = legacy.get(props.structure_ref)!;
                if (!this.weights.has(structure))
                    this.weights.set(structure, new Map());
                this.weights.get(structure)!.set(action, number(props.value));
            }
            else if (node.node_kind === "tiebreak-order")
                tiebreak = array(props.order).map(string);
        }
        this.tiebreak = tiebreak;
        if (!this.actions.length || !tiebreak.length || !this.weights.size)
            throw contentError("director", "graph declares no actions, weights or tiebreak order");
    }
    get beats(): string[] {
        return [...this.actions, "ADVANCE"];
    }
    score(action: string, condition: string): any {
        const key = `${action}\0${condition}`;
        if (!this.scores.has(key))
            throw contentError("director", `no scoring rule for ${action}/${condition}`);
        return this.scores.get(key);
    }
    threshold(id: string): any {
        if (!this.thresholds.has(id))
            throw contentError("director", `no threshold '${id}'`);
        return this.thresholds.get(id);
    }
    weight(structure: string, action: string): number {
        const weights = this.weights.get(structure);
        if (!weights)
            throw contentError("director", `no structure weights for '${structure}'`, { known: this.structureTypes });
        if (!weights.has(action))
            throw contentError("director", `no weight for ${structure}/${action}`);
        return weights.get(action)!;
    }
    static async load(context: KernelContext): Promise<DirectorGraph> {
        let graph: Row,
            manifest: Row;
        try {
            graph = row(await context.snapshots.readJson(join(context.content, "director", "director-graph.json")));
            manifest = row(await context.snapshots.readJson(join(context.content, "director", "director-graph-manifest.json")));
        }
        catch (error) {
            throw contentError("director", `artifact unreadable: ${unreadable(error)}`);
        }
        return new DirectorGraph(graph, manifest);
    }
}
/** The presentation graph: registers, segment types, render slots and the obligation plane. Since contract §137 it
 *  carries no craft line: the axes, directives, beat table and floor a turn's `style` holds come from the one enabled
 *  package that contributes `context.style.v1` (`read/style.ts`), and `style()` here is only what every table has. */
export class TextGraph {
    readonly nodes: Map<string, Row>;
    readonly digest: string;
    constructor(graph: Row, manifest: Row) {
        if (graph.contract_id !== "coc.text-graph.v1")
            throw contentError("craft", "text graph does not declare coc.text-graph.v1");
        if (manifest.contract_id !== "coc.text-graph-build-manifest.v1")
            throw contentError("craft", "text graph manifest does not declare coc.text-graph-build-manifest.v1");
        if (!Array.isArray(graph.nodes))
            throw contentError("craft", "text graph has no node list");
        this.digest = jsonDigest(graph);
        if (manifest.graph_content_digest !== this.digest)
            throw contentError("craft", "text graph content digest does not match the manifest", {
                declared: manifest.graph_content_digest ?? null,
                actual: this.digest
            });
        this.nodes = new Map(graph.nodes.filter((n: any) => typeof row(n).node_id === "string").map((n: Row) => [n.node_id, n]));
        if (!this.registers.length)
            throw contentError("craft", "text graph declares no registers");
    }
    /** The registers a campaign may choose (`campaign.create`), in the graph's own order. */
    get registers(): string[] {
        return ordered(this.nodes, "play-register").map(n => string(row(n.properties).legacy_key));
    }
    style(language: string, register: string): Row {
        return { language, register };
    }
    static async load(context: KernelContext): Promise<TextGraph> {
        try {
            const paths = ["text-graph.json", "text-graph-manifest.json"];
            const [graph, manifest] = await Promise.all(paths.map(path => context.snapshots.readJson(join(context.content, "craft", path))));
            return new TextGraph(row(graph), row(manifest));
        }
        catch (error) {
            if (error instanceof RpcError)
                throw error;
            throw contentError("craft", `artifact unreadable: ${unreadable(error)}`);
        }
    }
}
export class Ontology {
    readonly refs = new Map<string, Row>();
    readonly kinds = new Map<string, string>();
    readonly relations: Row[];
    constructor(readonly raw: Row, readonly loadError: string | null = null) {
        if (!loadError && raw.contract_id !== "coc.system-ontology-registry.v1")
            this.loadError = "not a coc.system-ontology-registry.v1 registry";
        for (const graph of array(raw.graphs))
            if (typeof row(graph).graph_id === "string")
                this.kinds.set(graph.graph_id, string(graph.graph_kind || ""));
        for (const ref of array(raw.references))
            if (typeof row(ref).ref_id === "string")
                this.refs.set(ref.ref_id, ref);
        this.relations = array(raw.relations).filter(value => Object.keys(row(value)).length);
    }
    async validate(ruleIds: string[], director: DirectorGraph, craft: TextGraph, moduleIds: (id: string) => Promise<string[] | null>): Promise<Row[]> {
        if (this.loadError)
            return [{
                    ref_id: null,
                    graph_id: null,
                    semantic_id: null,
                    reason: this.loadError
                }];
        const pools = new Map<string, Set<string>>([["rule", new Set(ruleIds)], ["director", new Set(director.nodes.keys())], ["text", new Set(craft.nodes.keys())], ["live-state", new Set(REGISTERED_CONDITION_PATHS)], ["execution", new Set(RESOLVER_NAMES)]]),
            bad: Row[] = [];
        for (const [refId, ref] of this.refs) {
            const graphId = string(ref.graph_id || ""),
                kind = this.kinds.get(graphId),
                result = {
                ref_id: refId,
                graph_id: graphId,
                semantic_id: ref.semantic_id ?? null
            };
            if (!kind) {
                bad.push({
                    ...result,
                    reason: "graph_id is not declared in graphs"
                });
                continue;
            }
            if (kind === "module") {
                const id = graphId.split(":").at(-1)!,
                    pool = await moduleIds(id);
                if (pool == null)
                    bad.push({
                        ...result,
                        reason: `module '${id}' is not loadable`
                    });
                else if (!pool.includes(string(ref.semantic_id)))
                    bad.push({
                        ...result,
                        reason: "semantic_id is not a node of the module graph"
                    });
                continue;
            }
            if (kind === "live-state" || kind === "execution") {
                if (typeof ref.locator !== "string" || !pools.get(kind)!.has(ref.locator))
                    bad.push({
                        ...result,
                        locator: ref.locator ?? null,
                        reason: `locator is not in the ${kind === "live-state" ? "registered_condition_paths" : "resolver capabilities"}`
                    });
            }
            else if (!pools.has(kind))
                bad.push({
                    ...result,
                    reason: `unknown graph kind '${kind}'`
                });
            else if (!pools.get(kind)!.has(string(ref.semantic_id)))
                bad.push({
                    ...result,
                    reason: `semantic_id is not a node of the ${kind} graph`
                });
        }
        for (const rel of this.relations)
            for (const end of ["from_ref", "to_ref"])
                if (!this.refs.has(rel[end]))
                    bad.push({
                        relation_id: rel.relation_id ?? null,
                        end,
                        ref_id: rel[end] ?? null,
                        reason: "relation end is not a registered reference"
                    });
        return bad;
    }
    private targets(ids: string[], kind: string): string[] {
        const sources = new Set([...this.refs].filter(([, ref]) => ids.includes(ref.semantic_id)).map(([id]) => id));
        return sorted(new Set(this.relations.filter(r => r.relation_kind === kind && sources.has(r.from_ref)).map(r => this.refs.get(r.to_ref)?.semantic_id).filter(v => typeof v === "string")));
    }
    groundedBy(ids: string[]): string[] {
        return this.targets(ids, "grounded-by");
    }
    effectsOf(ids: string[]): string[] {
        return this.targets(ids, "may-emit-effect");
    }
    static async load(context: KernelContext): Promise<Ontology> {
        try {
            return new Ontology(row(await context.snapshots.readJson(join(context.content, "ontology", "system-ontology.json"))));
        }
        catch (error) {
            return new Ontology({}, `unreadable: ${unreadable(error)}`);
        }
    }
}
