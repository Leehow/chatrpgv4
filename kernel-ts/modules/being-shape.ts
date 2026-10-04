/**
 * Contract §180.7 and §180.9: what the reader's checker holds persons and creatures to.
 *
 * - **One being, one node** (§180.7). An npc and a creature never share a normalized name or handle. The rule is the
 *   base's and always on. Which kind the being is stays the reader's judgement from how the book treats it (§180.2);
 *   this only finds the pair, by the graph's own name normalization.
 * - **The weakness entry** (§180.9), checked only when the build bound `actor.weaknesses.v1` (`weaknessesBound`): the
 *   required text is stated, and every node reference resolves to a node of a kind the contract lists for it.
 * - **Relation endpoints** (§180.9): a relation of a kind the contract lists connects only the kinds listed for it
 *   (`misleads`: a clue to an npc or a creature).
 *
 * Every kind list, key and seat is read from the graph contract (`actor_weaknesses`, `relation_endpoints`), never
 * written here. Refusals are data, as `mechanicsRefusals` returns them, so the publication checker and a starter test
 * read the same answer. Accounting, not content: nothing here requires an entry to exist or judges what it says.
 */
import { isJsonObject } from '../json.js';
import type { ModuleGraph } from '../read/module-graph.js';
import { array, normalize, repr, row, string, type Row } from '../read/values.js';
import type { Refusal } from './obligation-shape.js';

/** A refusal that a relation earns names the claim it came from, so a draft check can point at that claim. */
export type BeingRefusal = Refusal & { claim?: string };
/** Two nodes for one being: an npc and a creature that share a normalized name or handle. */
export type BeingPair = { npc: string; creature: string; shared: string };

/**
 * §180.9, §180.13: the single input that turns the weakness check on. The reader's task carries the contract's
 * `actor_weaknesses` block exactly when the build bound the capability (`vocabulary` in `contract.ts`); the law the
 * entries are held to is always read from the contract itself, never from the task.
 */
export function weaknessesBound(task: Row): boolean {
    return isJsonObject(row(task.vocabulary).actor_weaknesses);
}

/** §180.7: every npc/creature pair sharing a normalized name or handle, in the graph's node order. */
export function beingPairs(graph: ModuleGraph): BeingPair[] {
    const keys = (node: Row): Set<string> =>
        new Set([typeof node.name === 'string' ? node.name : '', graph.handle(node)].map(normalize).filter(Boolean));
    const creatures = graph.kind('creature').map(node => ({ id: string(node.node_id), keys: keys(node) }));
    const pairs: BeingPair[] = [];
    for (const person of graph.kind('npc')) {
        const mine = keys(person);
        for (const creature of creatures) {
            const shared = [...creature.keys].find(key => mine.has(key));
            if (shared !== undefined) pairs.push({ npc: string(person.node_id), creature: creature.id, shared });
        }
    }
    return pairs;
}

/**
 * §180.9: every refusal the stated weakness entries earn, against the contract's `actor_weaknesses` block. An entry
 * sits in the node's `properties` (a reader's draft), or in a starter's `runtime_projection.record`; both seats are
 * read when both exist.
 */
export function weaknessRefusals(graph: ModuleGraph, law: Row): BeingRefusal[] {
    const property = string(law.property), onKinds = array(law.on_kinds).map(string), keys = array(law.entry_keys).map(string);
    const required = array(law.required_keys).map(string), texts = array(law.text_keys).map(string), refs = row(law.node_refs);
    const refusals: BeingRefusal[] = [];
    for (const node of graph.nodes.values()) {
        if (!onKinds.includes(string(node.node_kind))) continue;
        const id = string(node.node_id), props = row(node.properties), record = row(props.runtime_projection).record;
        const seats: Array<[string, Row]> = [['properties', props]];
        if (isJsonObject(record)) seats.push(['properties.runtime_projection.record', record]);
        const refuse = (rule: string, path: string, message: string) => refusals.push({ node: id, rule, path, message });
        for (const [base, holder] of seats) {
            if (!Object.hasOwn(holder, property)) continue;
            const at = `${base}.${property}`, list = holder[property];
            if (!Array.isArray(list)) { refuse('shape_prose', at, `${property} is a list of entries {${keys.join(', ')}}`); continue; }
            list.forEach((entry: any, i: number) => {
                const here = `${at}[${i}]`;
                if (!isJsonObject(entry)) { refuse('shape_prose', here, `each entry is an object {${keys.join(', ')}}`); return; }
                for (const key of Object.keys(entry).filter(key => !keys.includes(key)))
                    refuse('shape_unknown_key', `${here}.${key}`, `an entry carries only ${keys.join(', ')}`);
                for (const key of required)
                    if (!Object.hasOwn(entry, key)) refuse('shape_unresolved', `${here}.${key}`, `${key} is required on every entry`);
                for (const key of texts)
                    if (Object.hasOwn(entry, key) && (typeof entry[key] !== 'string' || !entry[key].trim()))
                        refuse('shape_unresolved', `${here}.${key}`, `${key} is one line of text`);
                for (const [key, spec] of Object.entries(refs)) {
                    if (!Object.hasOwn(entry, key)) continue;
                    const kinds = array(row(spec).kinds).map(string), many = row(spec).list === true;
                    if (many && !Array.isArray(entry[key])) { refuse('shape_unresolved', `${here}.${key}`, `${key} is a list of node ids`); continue; }
                    (many ? entry[key] as any[] : [entry[key]]).forEach((value: any, j: number) => {
                        const target = typeof value === 'string' ? graph.nodes.get(value) : undefined, path = many ? `${here}.${key}[${j}]` : `${here}.${key}`;
                        if (!target) refuse('shape_unresolved', path, `${repr(value)} names no node of this module; ${key} names a ${kinds.join(' or ')} node by its node_id`);
                        else if (!kinds.includes(string(target.node_kind)))
                            refuse('shape_unresolved', path, `${value} is a ${string(target.node_kind)}; ${key} names a ${kinds.join(' or ')} node`);
                    });
                }
            });
        }
    }
    return refusals;
}

/** §180.9: every relation of a listed kind whose endpoints are not the listed kinds, against `relation_endpoints`. */
export function endpointRefusals(graph: ModuleGraph, law: Row): BeingRefusal[] {
    const kinds = row(law.kinds), refusals: BeingRefusal[] = [];
    array(graph.raw.relations).forEach((relation: any, i: number) => {
        const kind = string(row(relation).relation_kind);
        if (!Object.hasOwn(kinds, kind)) return;
        const allowed = row(kinds[kind]), from = array(allowed.from).map(string), to = array(allowed.to).map(string);
        const kindOf = (id: any): string => { const node = typeof id === 'string' ? graph.nodes.get(id) : undefined; return node ? string(node.node_kind) : 'missing node'; };
        const source = kindOf(relation.from_node_id), target = kindOf(relation.to_node_id);
        if (from.includes(source) && to.includes(target)) return;
        refusals.push({ rule: 'relation_endpoints', path: `relations[${i}]`, node: string(relation.from_node_id),
            ...(typeof relation.claim_id === 'string' ? { claim: relation.claim_id } : {}),
            message: `${kind} runs from a ${from.join(' or ')} to a ${to.join(' or ')}; this one runs from a ${source} to a ${target}` });
    });
    return refusals;
}
