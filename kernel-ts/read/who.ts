/**
 * Contract §257.17: the one resolver of `{{who:<node_id>}}` tokens in book exhibit text.
 *
 * A token is replaced by what the table may call that person now: their name once the table has been told it, else the
 * table's word (the epithet, else the journal's label). The exhibit read (§257.6), first sight, the scene's description
 * and the check lane's book words all go through it, so the author, the Keeper and the check see one text.
 */
import type {ModuleGraph} from './module-graph.js';
import {array,row,string,type Row} from './values.js';
import {npcReferenceView,untoldBlock} from './capsule.js';
import {WHO_REFERENCE} from '../modules/exhibits.js';

/** The person a token names, by node id or handle; null for anything that is not a person. */
function whoNode(graph: ModuleGraph, id: string): Row | null {
    const node = graph.nodes.get(id) ?? graph.nodeOfHandle(id);
    return node && graph.isPerson(node) ? node : null;
}
/** What the table calls this person now: the name once told, else the table's word. */
export function personNow(graph: ModuleGraph, world: Row, journal: Row, records: Row[], node: Row): string {
    return string(npcReferenceView(graph, world, node, untoldBlock(graph, world, journal, node, records)).display_name);
}
/** Text with every `{{who:}}` token resolved as the table stands now; an unresolvable reference reads `someone`. */
export function whoResolver(graph: ModuleGraph, world: Row, journal: Row = {}, records: Row[] = []): (text: string) => string {
    return text => text.replace(WHO_REFERENCE, (_all, id: string) => {
        const node = whoNode(graph, id);
        return node ? personNow(graph, world, journal, array(records).map(row), node) : 'someone';
    });
}
/**
 * Every wording a text may have been shown in: as the table stands now, with each token as the person's name, and with
 * each as the table's word. A delivery can tell a name between the capsule that carried the text and the check that
 * reads it, so an excerpt is located in any of them (first match wins).
 */
export function whoVariants(graph: ModuleGraph, world: Row, journal: Row = {}, records: Row[] = []): (text: string) => string[] {
    const now = whoResolver(graph, world, journal, records);
    const spell = (pick: (node: Row) => string) => (text: string) => text.replace(WHO_REFERENCE, (_all, id: string) => {
        const node = whoNode(graph, id);
        return node ? pick(node) : 'someone';
    });
    const named = spell(node => graph.displayName(node));
    const worded = spell(node => {
        const untold = untoldBlock(graph, world, journal, node, []);
        return string(npcReferenceView(graph, world, node, untold ?? {label: string(row(row(world.person_epithets)[graph.handle(node)]).word) || 'Person'}).display_name);
    });
    return text => [...new Set([now(text), named(text), worded(text)])];
}
