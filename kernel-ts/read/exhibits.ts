/**
 * Contract §257.C1: the exhibits the table may reveal now, as the host's catalog reads them.
 *
 * This is the host's context read (`table.look focus=exhibits`, `_context_read` only), never a capsule section: the capsule
 * is sent to the Keeper whole and a surface must not be. A row is Keeper-side: the host splits it into the Keeper's catalog
 * entry (no surface) and the author's hydration (surface only), and `teaches`, `keeper_note` and `label` never reach the
 * author. Nothing here reads prose; scope is the graph's own relations and the world's own custody.
 */
import type {ModuleGraph} from './module-graph.js';
import {array,row,string,type Row} from './values.js';
import {npcReferenceView,npcsPresent,sceneLabel,untoldBlock,clueDiscovered} from './capsule.js';
import {clueCheck} from './clue-check.js';
import {WHO_REFERENCE} from '../modules/exhibits.js';

/** The kinds a Keeper may select to reveal. Testimony joins with ticket 04; description, appearance and voice are used automatically. */
export const REVEALABLE_EXHIBIT_KINDS: readonly string[] = ['document', 'perception'];

/** Where the carrier stands for the investigators: the scene, a person present, or a thing they hold or can perceive here. */
export type ExhibitScope = 'scene' | 'person' | 'handout' | 'object';
const RANK: Record<ExhibitScope, number> = {scene: 0, person: 1, handout: 2, object: 3};

export function exhibitsView(graph: ModuleGraph, world: Row, scene: Row, reads: {journal?: Row; records?: Row[]} = {}): Row {
    const sceneId = string(scene.node_id);
    const rows = graph.exhibits.filter(item => REVEALABLE_EXHIBIT_KINDS.includes(string(item.kind)));
    if (!rows.length) return {scene: graph.handle(scene), exhibits: []};
    const scopes = new Map<string, ExhibitScope>();
    const stand = (node: Row | null | undefined, scope: ExhibitScope) => {
        if (!node) return;
        for (const each of graph.groupOf(node)) if (!scopes.has(string(each.node_id))) scopes.set(string(each.node_id), scope);
    };
    stand(scene, 'scene');
    for (const node of npcsPresent(graph, world, scene)) stand(node, 'person');
    for (const node of graph.sceneAssetNodes(scene)) stand(node, node.node_kind === 'handout' ? 'handout' : 'object');
    for (const handle of array(world.handouts_shown)) stand(graph.nodeOfHandle(handle), 'handout');
    for (const item of Object.values(row(row(world.objects).instances)).map(row))
        if (row(item.owner).kind === 'investigator' && string(item.name) && Number(item.quantity) > 0) stand(graph.find(string(item.name)), 'object');
    const person = (node: Row): string => {
        const view = npcReferenceView(graph, world, node, untoldBlock(graph, world, row(reads.journal), node, array(reads.records).map(row)));
        return string(view.display_name);
    };
    const label = (node: Row): string => node.node_id === sceneId || graph.groupOf(scene).includes(node) ? sceneLabel(graph, world, node)
        : graph.isPerson(node) ? person(node) : node.node_kind === 'scene' ? sceneLabel(graph, world, node) : graph.displayName(node);
    const resolve = (text: string): string => text.replace(WHO_REFERENCE, (_all, id: string) => {
        const node = graph.nodes.get(id) ?? graph.nodeOfHandle(id);
        return node && graph.isPerson(node) ? person(node) : 'someone';
    });
    const found = rows.flatMap(item => {
        const carrier = graph.nodes.get(graph.survivorId(string(item.carrier))) ?? graph.nodes.get(string(item.carrier));
        const scope = carrier ? scopes.get(string(carrier.node_id)) : undefined;
        if (!carrier || !scope) return [];
        const clues = array(item.teaches).flatMap(id => {
            const node = graph.nodes.get(graph.survivorId(string(id))) ?? graph.nodes.get(string(id));
            if (!node || node.node_kind !== 'clue') return [];
            const check = clueCheck(graph, node), discovered = clueDiscovered(graph, world, node);
            return [{clue: graph.handle(node), state: discovered ? 'discovered' : check ? 'needs' : 'open', ...(check && !discovered ? {check} : {})}];
        });
        const open = clues.find(entry => entry.state === 'needs') ?? clues.find(entry => entry.state === 'open');
        const surface = row(item.surface);
        return [{
            exhibit_id: string(item.exhibit_id), kind: string(item.kind), channel: string(item.channel), scope,
            carrier: {id: graph.handle(carrier), node_kind: string(carrier.node_kind), display_name: label(carrier)},
            ...(item.stance ? {stance: string(item.stance)} : {}),
            label: string(item.label),
            ...(clues.length ? {clue: open ? {state: open.state, ...(open.check ? {check: open.check} : {})} : {state: 'discovered'}, teaches: clues.map(entry => entry.clue),
                clue_states: clues.map(({clue, state}) => ({clue, state}))} : {}),
            surface: {text: resolve(string(surface.text)), language: string(surface.language), verbatim: surface.verbatim === true}
        }];
    });
    return {scene: graph.handle(scene), exhibits: found.sort((a, b) => RANK[a.scope] - RANK[b.scope])};
}
