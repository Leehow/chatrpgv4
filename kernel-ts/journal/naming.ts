/** Committed player-visible name disclosure, shared by the journal and Keeper projections (§103). */
import type { ModuleGraph } from '../read/module-graph.js';
import { array, row, string, number, normalize, truth, type Row } from '../read/values.js';

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
 * §103.8: a name's own pieces where the name separates them with punctuation ("拉塞尔·威廉姆斯": 拉塞尔 and 威廉姆斯), with
 * the whole names. A piece of one character is no name. Read from the name's characters alone, never from what they mean.
 */
export function namePieces(names: readonly string[]): string[] {
    return [...new Set([...names, ...names.flatMap(name => name.split(/\p{P}+/u))].map(piece => piece.trim())
        .filter(piece => Array.from(piece).length >= 2))];
}

/** The first committed delivery that actually displayed the authored name, not merely the NPC id. */
export function toldTurn(graph: ModuleGraph, node: Row, records: Iterable<Row>, upTo = Infinity): number | null {
    const handle = graph.handle(node), words = nameWords(graph, node);
    const committed = [...records].filter(record => record.closed_by === 'narrate' && truth(record.commit) && number(record.turn) <= upTo)
        .sort((a, b) => number(a.turn) - number(b.turn));
    for (const record of committed) {
        if (array(record.speech).some(line => {
            const who = row(row(line).who);
            // §103.5: what the transcript showed for the speaker -- `shown` where the delivery recorded one.
            const shown = 'shown' in who ? string(who.shown) : string(who.name ?? '');
            return string(who.npc) === handle && words.some(word => occurs(normalize(shown), word));
        }))
            return number(record.turn);
        if (words.some(word => occurs(normalize(record.rendered_text ?? ''), word)))
            return number(record.turn);
    }
    return null;
}
