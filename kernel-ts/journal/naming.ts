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

/** The first committed delivery that actually displayed the authored name, not merely the NPC id. */
export function toldTurn(graph: ModuleGraph, node: Row, records: Iterable<Row>, upTo = Infinity): number | null {
    const handle = graph.handle(node), words = nameWords(graph, node);
    const committed = [...records].filter(record => record.closed_by === 'narrate' && truth(record.commit) && number(record.turn) <= upTo)
        .sort((a, b) => number(a.turn) - number(b.turn));
    for (const record of committed) {
        if (array(record.speech).some(line => {
            const who = row(row(line).who);
            return string(who.npc) === handle && words.some(word => occurs(normalize(who.name ?? ''), word));
        }))
            return number(record.turn);
        if (words.some(word => occurs(normalize(record.rendered_text ?? ''), word)))
            return number(record.turn);
    }
    return null;
}
