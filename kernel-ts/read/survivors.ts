/**
 * Contract §191.3 (owner rulings 2026-10-07, docs/specs/reading-duplicates-survey.md): one survivor map for every kind.
 *
 * A page reading can publish a second node for something the graph already has (Blood Road's generation 55 wrote the general
 * store, the town centre and its store owner again under new ids). Nothing is deleted and no id is rewritten: handles, stored
 * world state and reading metadata are keyed by node id (§185.4). Instead every node reads through the node that stands for it,
 * its survivor, from three sources:
 *
 * - kernel identity relations, `rel-identity-<later>-to-<earlier>` with `properties.identity_review`, as §152.4's
 *   `writeVariants` writes them and `modules/identity.ts` writes them for every kind. For a kind that is no printed visual,
 *   only these hops count: a reader-authored `variant-of` claim states a state (Dust to Dust's revived Virginia), never an
 *   identity;
 * - §152.4's `variant-of` between two printed visuals (`asset`, `handout`), whoever wrote it;
 * - §188.2's cast fold for people (`castFold`, installed by the campaign loader from `bookCast`), which never joins two nodes a
 *   recorded `different` verdict keeps apart (`apartPairs`; lead ruling 2026-10-07).
 *
 * Read from relation ids, relation kinds and node kinds alone; nothing here reads what a name or a summary says.
 */
import { compareUnicode, isJsonObject } from "../json.js";
import { entries, row, string, type Row } from "./values.js";

/** Contract §152.4: the node kinds a printed visual is published as, the only ends any `variant-of` hop is read between. */
export const VISUAL_KINDS: readonly string[] = ["asset", "handout"];
/** Contract §152.4: the most hops a survivor walk takes. */
export const SURVIVOR_STEPS = 64;

/** §191.3: the id of the kernel identity relation from `later` to `earlier`, as §152.4's `writeVariants` names it. */
export const identityRelationId = (later: string, earlier: string): string => `rel-identity-${later}-to-${earlier}`;

/**
 * §191.3: a relation the kernel wrote to say two nodes are one thing: a `variant-of` whose id is the kernel's own
 * (`identityRelationId`, never the `rel-<subject>-variant-of-<object>` a reader's claim derives) and which carries the review
 * that decided it (`properties.identity_review`).
 */
export function isIdentityRelation(rel: Row): boolean {
    return rel.relation_kind === "variant-of" && typeof rel.from_node_id === "string" && typeof rel.to_node_id === "string"
        && rel.relation_id === identityRelationId(rel.from_node_id, rel.to_node_id) && isJsonObject(row(rel.properties).identity_review);
}

/** Two node ids as one key, whichever order they come in. */
export const pairKey = (a: string, b: string): string => [a, b].sort(compareUnicode).join("\u0000");

/**
 * §191.3 (lead ruling 2026-10-07): the pairs a recorded `different` verdict keeps apart -- `module.json` `reading.identity`
 * (`<source sha>:<kind>:<id>:<id>` → `{verdict, nodes}`, §191.1), of the bound source `sourceSha` (every key when it is empty).
 * A verdict from reading the pages beats the cast's name rule: the fold never joins such a pair (`bookCast`).
 */
export function apartPairs(identity: unknown, sourceSha: string): Set<string> {
    const out = new Set<string>();
    for (const [key, value] of entries(row(identity))) {
        const verdict = row(value), nodes = Array.isArray(verdict.nodes) ? verdict.nodes.filter((id: unknown): id is string => typeof id === "string") : [];
        if (verdict.verdict !== "different" || (sourceSha && !key.startsWith(sourceSha + ":")) || nodes.length !== 2 || nodes[0] === nodes[1]) continue;
        out.add(pairKey(nodes[0], nodes[1]));
    }
    return out;
}

/**
 * What the map reads of a graph: its nodes, its outgoing relations, each node's kind as the book gave it, the cast fold, and
 * the pairs a `different` verdict keeps apart.
 */
export interface SurvivorSource {
    readonly nodes: ReadonlyMap<string, Row>;
    readonly out: ReadonlyMap<string, Row[]>;
    bookKind(node: Row): string;
    readonly castFold: ReadonlyMap<string, string>;
    readonly apart: ReadonlySet<string>;
}
/** A pair a `different` verdict keeps apart that kernel identity relations nevertheless join (§191.3: flagged, never resolved). */
export interface IdentityConflict { nodes: [string, string]; survivor: string }

/** The hops a node takes toward the node that stands for it: the nodes visited, the relations taken, where a cycle closes. */
export interface SurvivorWalk { path: Row[]; hops: Row[]; cycle: number }

export class SurvivorMap {
    private readonly linked = new Map<string, string>();
    private grouped: Map<string, string[]> | null = null;
    constructor(private readonly graph: SurvivorSource) { }

    /**
     * The relation a node leaves by, the first in relation order: between two printed visuals any `variant-of` (§152.4); for
     * every other node only a kernel identity relation to a node of the same book kind (§191.3).
     */
    private hop(node: Row): Row | undefined {
        const from = string(node.node_id), visual = VISUAL_KINDS.includes(node.node_kind);
        return (this.graph.out.get(from) ?? []).find(rel => {
            if (rel.relation_kind !== "variant-of" || rel.to_node_id === from) return false;
            const target = this.graph.nodes.get(string(rel.to_node_id));
            if (!target) return false;
            if (visual && VISUAL_KINDS.includes(target.node_kind)) return true;
            return isIdentityRelation(rel) && this.graph.bookKind(target) === this.graph.bookKind(node);
        });
    }

    /** The walk stops at a node with no hop, before revisiting a node, or after `SURVIVOR_STEPS` hops. */
    walk(node: Row): SurvivorWalk {
        const path: Row[] = [node], hops: Row[] = [], seen = new Set<string>([string(node.node_id)]);
        let current = node;
        for (let step = 0; step < SURVIVOR_STEPS; step++) {
            const hop = this.hop(current);
            if (!hop) return { path, hops, cycle: -1 };
            const next = this.graph.nodes.get(string(hop.to_node_id))!;
            if (seen.has(string(next.node_id))) return { path, hops: [...hops, hop], cycle: path.findIndex(item => item.node_id === next.node_id) };
            seen.add(string(next.node_id));
            path.push(next);
            hops.push(hop);
            current = next;
        }
        return { path, hops, cycle: -1 };
    }

    /**
     * The survivor by relations alone (§152.4's walk, every kind since §191.3): the node the walk ends at; where the relations
     * close a cycle, the cycle's first node in node-id order, so the survivor of a survivor is itself.
     */
    linkedId(id: string): string {
        const known = this.linked.get(id);
        if (known !== undefined) return known;
        const node = this.graph.nodes.get(id);
        let value = id;
        if (node) {
            const walk = this.walk(node);
            value = walk.cycle < 0 ? string(walk.path[walk.path.length - 1].node_id)
                : string([...walk.path.slice(walk.cycle)].sort((a, b) => compareUnicode(string(a.node_id), string(b.node_id)))[0].node_id);
        }
        this.linked.set(id, value);
        return value;
    }

    /** §191.3: the node id that stands for `id`: its survivor by relations, then the cast's fold for people (§188.2). */
    id(id: string): string {
        const linked = this.linkedId(id), folded = this.graph.castFold.get(linked);
        return folded === undefined ? linked : this.linkedId(folded);
    }

    /**
     * §191.3: the pairs a `different` verdict keeps apart whose nodes kernel identity relations lead to one survivor. The two
     * cannot both stand: the writer refuses such a relation (`publishIdentities`), and a graph that holds one anyway is reported
     * here, the relation left as it is (the ruling leaves identity relations unaffected) and nothing guessed.
     */
    conflicts(): IdentityConflict[] {
        const out: IdentityConflict[] = [];
        for (const key of this.graph.apart) {
            const [a, b] = key.split("\u0000") as [string, string];
            if (!this.graph.nodes.has(a) || !this.graph.nodes.has(b)) continue;
            const survivor = this.linkedId(a);
            if (survivor === this.linkedId(b)) out.push({ nodes: [a, b], survivor });
        }
        return out;
    }

    /** §191.3: every node id that reads as the same thing as `id`, its survivor first, then the graph's order. */
    group(id: string): string[] {
        if (!this.grouped) {
            const grouped = new Map<string, string[]>();
            for (const each of this.graph.nodes.keys()) {
                const survivor = this.id(each), list = grouped.get(survivor) ?? [];
                if (each === survivor) list.unshift(each); else list.push(each);
                grouped.set(survivor, list);
            }
            this.grouped = grouped;
        }
        const survivor = this.id(id);
        return this.grouped.get(survivor) ?? [survivor];
    }
}

/**
 * §191.3: the survivor map of a published graph file as it is stored (`raw.nodes`, `raw.relations`), for a reader that holds
 * the file and no `ModuleGraph` (the reading layer's `materialReady` and focus identity). Relations only: a book graph carries
 * no cast fold, which only a campaign's loaded graph has.
 */
export function rawSurvivors(raw: Row, apart: ReadonlySet<string> = new Set()): SurvivorMap {
    const nodes = new Map<string, Row>(), out = new Map<string, Row[]>();
    for (const node of Array.isArray(raw.nodes) ? raw.nodes : [])
        if (isJsonObject(node) && typeof node.node_id === "string") nodes.set(node.node_id, node);
    for (const rel of Array.isArray(raw.relations) ? raw.relations : [])
        if (isJsonObject(rel) && typeof rel.from_node_id === "string") out.set(rel.from_node_id, [...(out.get(rel.from_node_id) ?? []), rel]);
    return new SurvivorMap({ nodes, out, bookKind: node => string(node.node_kind), castFold: new Map(), apart });
}
