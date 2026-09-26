/**
 * Contract §138.7: the intentions a delivery owes a result for. Someone present set out to do something on an earlier
 * turn, it is still under way, and no receipt of this turn reports how it went. Structure only: a ref, a status and a
 * turn number; nothing reads the prose, so "the Keeper wrote about it" and "the Keeper recorded it" are not confused.
 */
import type {ModuleGraph} from '../read/module-graph.js';
import {npcsPresent} from '../read/capsule.js';
import {array, clone, number, row, type Row} from '../read/values.js';
import {foldIntent, intentsOf} from './intents.js';

export function owedIntents(graph: ModuleGraph, world: Row, ledger: Row, turn: Row): Row[] {
    const n = number(turn.turn), owed: Row[] = [];
    let present: Row[] = [];
    try { present = npcsPresent(graph, world, graph.scene(world.active_scene)); } catch { return []; }
    for (const node of present) {
        const handle = graph.handle(node), entry = clone(row(ledger[node.node_id]));
        for (const receipt of array(turn.receipts)) {
            const intent = row(row(receipt).intent);
            if (typeof intent.ref === 'string' && intent.npc === handle) foldIntent(entry, intent, n, row(receipt).id);
        }
        for (const item of intentsOf(entry))
            if (item.status === 'attempted' && number(item.last_turn) < n)
                owed.push({who: graph.displayName(node), npc: handle, ref: item.ref, intent: item.text, since_turn: item.since_turn ?? null, turn: item.last_turn ?? null});
    }
    return owed;
}
