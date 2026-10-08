/**
 * Contract §180.9: the weakness chain an actor row carries (§31's reader end). What the book -- or, while its package is
 * enabled, the table -- says harms, repels, binds, banishes or ends a being; where each means it names stands now; how far
 * the investigators are toward the conclusion that teaches it; and the clues whose belief about the being is false.
 *
 * Every reading here is one the kernel already makes elsewhere, never a second copy: who holds an object is the root owner
 * of its instance (`rootObjectOwner`), or the sheet that carries it as equipment, as the check catalog finds a tome at
 * hand; who knows a spell is the investigator's magic state (`knownSpells`); which tome teaches it is the book's own
 * sources (`bookSpellSources`); a conclusion's progress counts its supporting clues in `world.discovered_clues`, the
 * reading `thread.ts` makes. An explicit source identity takes precedence; legacy unbound objects match normalized names.
 */
import type { ModuleGraph } from "./module-graph.js";
import { rootObjectOwner } from "./object-owner.js";
import { bookSpellSources } from "../magic/facts.js";
import { knownSpells } from "../magic/state.js";
import { array, chars, entries, normalize, number, row, string, truth, values, type Row } from "./values.js";

/** §180.9's budget for a present row: at most three entries, each `book` cut to 160 characters. The single reads carry all. */
export const PRESENT_WEAKNESSES = 3;
export const PRESENT_BOOK_CHARS = 160;
/** The means a hand can carry: who holds it is the chain's question. */
const HOLDABLE = new Set(["object", "artifact", "tome"]);

/** What the chain reads beyond the graph and the world: the investigators' sheets and each one's magic state. */
export type ChainReads = { readonly party?: readonly Row[]; readonly magic?: (investigatorId: string) => Row | null };

const namesOf = (graph: ModuleGraph, node: Row): Set<string> => new Set(graph.nameKeys(node).map(normalize).filter(Boolean));

/** Who holds the thing now, by the existing ownership reads; null when nothing at the table holds it. */
function heldBy(graph: ModuleGraph, world: Row, node: Row, reads: ChainReads): string | null {
    const names = namesOf(graph, node), objects = row(world.objects), definitions = row(objects.definitions);
    const all = values(row(objects.instances));
    const sourced = all.filter(item => row(item.source_object).module_id === graph.moduleId && row(item.source_object).node_id === node.node_id);
    const instances = (sourced.length ? sourced : all.filter(item => !item.source_object &&
        (names.has(normalize(item.name)) || names.has(normalize(row(definitions[string(item.definition)]).name)))))
        .sort((a, b) => number(b.changed_turn ?? 0) - number(a.changed_turn ?? 0));
    for (const item of instances) {
        try {
            const root = row(rootObjectOwner(world, item));
            if (!['npc', 'investigator'].includes(root.kind)) continue;
            const owner = string(root.name);
            if (owner) return owner;
        }
        catch { /* An ownership chain that does not resolve says nothing about who holds it. */ }
    }
    if (sourced.length) return null;
    const managedNames = new Set(all.flatMap(item => [normalize(item.name),normalize(row(definitions[string(item.definition)]).name)]));
    const sheet = array(reads.party).find(sheet => array(sheet.equipment).some(item => {
        const name = normalize(typeof item === 'string' ? item : row(item).name);
        return names.has(name) && !managedNames.has(name);
    }));
    return sheet ? string(sheet.name) || null : null;
}

/** The investigators whose magic state knows the spell. */
function knownBy(graph: ModuleGraph, world: Row, node: Row, reads: ChainReads): string[] {
    const names = namesOf(graph, node), clock = number(row(world.clock).minutes ?? 0);
    return array(reads.party).filter(sheet => {
        const state = reads.magic?.(string(sheet.id));
        return !!state && knownSpells(state, clock).some(name => names.has(normalize(name)));
    }).map(sheet => string(sheet.name)).filter(Boolean);
}

/** The book's tomes that teach the spell. */
function taughtBy(graph: ModuleGraph, node: Row): string[] {
    const names = namesOf(graph, node);
    return entries(bookSpellSources(graph)).flatMap(([source, taught]) => {
        if (!source.startsWith("tome:") || !array(taught).some(name => names.has(normalize(name))))
            return [];
        const tome = graph.find(source.slice("tome:".length), ["tome"]);
        return tome ? [graph.displayName(tome)] : [];
    });
}

function need(graph: ModuleGraph, world: Row, id: unknown, reads: ChainReads): Row | null {
    const node = typeof id === "string" ? graph.nodes.get(id) : undefined;
    if (!node)
        return null;
    const kind = string(node.node_kind), entry: Row = { name: graph.displayName(node), kind };
    if (HOLDABLE.has(kind)) {
        const holder = heldBy(graph, world, node, reads);
        if (holder) entry.held_by = holder;
    }
    else if (kind === "spell") {
        const known = knownBy(graph, world, node, reads), taught = taughtBy(graph, node);
        if (known.length) entry.known_by = known;
        if (taught.length) entry.taught_by = taught;
    }
    // A place, a person, a creature, a hazard, a rule or a procedure: the name only.
    return entry;
}

/** The conclusion that teaches the weakness, and how many of its supporting clues the investigators have found. */
function learnedBy(graph: ModuleGraph, world: Row, id: unknown): Row | null {
    const node = typeof id === "string" ? graph.nodes.get(id) : undefined;
    if (node?.node_kind !== "conclusion")
        return null;
    // §192.3: a clue found through any of its copies is found.
    const clues = graph.supportingClues(node);
    return { conclusion: graph.handle(node), found: clues.filter(clue => graph.discovered(world, clue)).length, of: clues.length };
}

/** §180.9's door: what an enabled package established at the table, read only while that package is on. */
export function tableWeaknesses(world: Row, node: Row): Row[] {
    const mods = row(world.mods), locks = row(mods.active);
    return entries(row(mods.state)).flatMap(([id, namespace]) =>
        truth(row(locks[id]).enabled) ? array(row(row(namespace).weaknesses)[string(node.node_id)]).map(row) : []);
}

/**
 * The chain for one npc or creature: `weaknesses` (the authored entries the module bound, then the table's) and
 * `false_leads`, each present only when there is something. `present` applies the row's budget.
 */
export function weaknessChain(graph: ModuleGraph, world: Row, node: Row, reads: ChainReads = {}, present = false): Row {
    const stated = [...graph.authoredWeaknesses(node), ...tableWeaknesses(world, node)];
    const weaknesses = (present ? stated.slice(0, PRESENT_WEAKNESSES) : stated).map(entry => {
        const book = string(entry.book).trim(), needs = array(entry.needs).flatMap(id => need(graph, world, id, reads) ?? []);
        const route = learnedBy(graph, world, entry.learned_by);
        return { book: present ? chars(book, PRESENT_BOOK_CHARS) : book, ...(needs.length ? { needs } : {}), ...(route ? { learned_by: route } : {}) };
    });
    const leads = graph.misleadingClues(node).map(clue => ({ clue: graph.handle(clue), discovered: graph.discovered(world, clue) }));
    return {
        ...(weaknesses.length ? { weaknesses } : {}),
        ...(leads.length ? { false_leads: present ? leads.slice(0, PRESENT_WEAKNESSES) : leads } : {}),
    };
}
