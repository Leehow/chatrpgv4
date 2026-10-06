/** Committed player-visible name disclosure, shared by the journal and Keeper projections (§103). */
import type { ModuleGraph } from '../read/module-graph.js';
import { array, string, number, normalize, type Row } from '../read/values.js';
import { prepareNameHistory } from './name-history.js';

/** Exact normalized name matching; Latin/digit runs must not continue at either boundary. */
export function occurs(text: string, key: string): boolean {
    const latin = (char: string) => /^[a-z0-9]$/.test(char);
    let from = 0;
    while (from <= text.length) {
        const at = text.indexOf(key, from);
        if (at < 0)
            return false;
        const before = at > 0 ? text[at - 1] : '', after = text[at + key.length] ?? '';
        if (!(latin(key[0]) && latin(before)) && !(latin(key[key.length - 1]) && latin(after)))
            return true;
        from = at + 1;
    }
    return false;
}

/** Table epithets and graph aliases identify a person, but do not establish that their name was told.
 * Transliterations and other semantic introductions remain the journal lane's `named` judgment. */
export function nameWords(graph: ModuleGraph, node: Row): string[] {
    return [...new Set([node.name, graph.displayName(node)].filter(value => typeof value === 'string' && value.trim()).map(normalize))];
}

/**
 * §103.8: every name the book gives a person -- its name, its display name and its aliases -- never a handle or a node id.
 * While the person is untold the Keeper's request carries none of them (extensions/kernel/untold-view.ts), and the word the
 * table calls them may not be one of them (apply/person.ts).
 */
export function bookNames(graph: ModuleGraph, node: Row): string[] {
    // Exact: normalized, a handle and the name it was made from are the same string ("steven-knott", "Steven Knott").
    const ids = new Set([graph.handle(node), string(node.node_id)]);
    return [...new Set([node.name, graph.displayName(node), ...array(node.aliases)]
        .filter((value): value is string => typeof value === 'string' && !!value.trim()).map(value => value.trim()))]
        .filter(value => !ids.has(value));
}

/**
 * §103.8: a name's own pieces where the name separates them with punctuation ("Jean-Luc Picard": Jean and Luc Picard; a middle dot splits a transliterated name the same way), with
 * the whole names. A piece of one character is no name. Read from the name's characters alone, never from what they mean.
 */
export function namePieces(names: readonly string[]): string[] {
    return [...new Set([...names, ...names.flatMap(name => name.split(/\p{P}+/u))].map(piece => piece.trim())
        .filter(piece => Array.from(piece).length >= 2))];
}

/** The first committed delivery that actually displayed the authored name, not merely the NPC id. */
export function toldTurn(graph: ModuleGraph, node: Row, records: Iterable<Row>, upTo = Infinity): number | null {
    const handle = graph.handle(node), words = nameWords(graph, node);
    const history = prepareNameHistory(records);
    for (const record of history.graphRecords()) {
        if (!(number(record.turn) <= upTo)) continue;
        if (history.speech(record).some(who => who.npc === handle && words.some(word => occurs(who.shown, word))))
            return number(record.turn);
        // §177.15: `told_text` where the delivery had places the host cleared as part of another word, blanked there.
        if (words.some(word => occurs(history.text(record), word)))
            return number(record.turn);
    }
    return null;
}
