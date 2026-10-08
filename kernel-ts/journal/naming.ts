/** Committed player-visible name disclosure, shared by the journal and Keeper projections (§103). */
import { sameNode, type ModuleGraph } from '../read/module-graph.js';
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

/**
 * §188.1: whether an owner key of a guarded word (a world map's key: a handle, a cast row's id, an investigator's sheet id; a
 * journal entry's node id) is this person's own: the handle or node id of any node that is them (§188.2: the graph can hold one
 * individual more than once), a handle one of those had (§185.6.1), or a cast row they absorbed.
 */
export function ownerOf(graph: ModuleGraph, nodes: readonly Row[], castIds: readonly string[] = []): (owner: string) => boolean {
    const keys = new Set([...nodes.flatMap(node => [graph.handle(node), string(node.node_id)]), ...castIds]);
    return owner => keys.has(owner) || nodes.some(node => sameNode(graph, owner, node));
}

/**
 * The first committed delivery that actually displayed the authored name, not merely the NPC id. §188.1: an occurrence inside
 * an investigator's registered name or another person's word at this table (the history's guard) is not this person's name.
 */
export function toldTurn(graph: ModuleGraph, node: Row, records: Iterable<Row>, upTo = Infinity,
    own: (owner: string) => boolean = ownerOf(graph, [node])): number | null {
    const words = nameWords(graph, node);
    const history = prepareNameHistory(records);
    for (const record of history.graphRecords()) {
        if (!(number(record.turn) <= upTo)) continue;
        // §194.3: a document the delivery handed over printed their name.
        if (history.documentTold(record, own)) return number(record.turn);
        // §185.6.1: a record keeps the handle the person had then (an interim one, before a fold): compared by identity.
        if (history.speech(record).some(who => sameNode(graph, who.npc, node) && words.some(word => history.says(who.shown, word, own))))
            return number(record.turn);
        // §177.15: `told_text` where the delivery had places the host cleared as part of another word, blanked there.
        const text = history.text(record);
        if (words.some(word => history.says(text, word, own, () => history.shields(record))))
            return number(record.turn);
    }
    return null;
}
