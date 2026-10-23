/**
 * Contract §257.6: the exhibits the table may reveal now, as the host's catalog reads them.
 *
 * This is the host's context read (`table.look focus=exhibits`, `_context_read` only), never a capsule section: the capsule
 * is sent to the Keeper whole and a surface must not be. A row is Keeper-side: the host splits it into the Keeper's catalog
 * entry (no surface) and the author's hydration (surface only), and `teaches`, `keeper_note` and `label` never reach the
 * author. Nothing here reads prose; scope is the graph's own relations and the world's own custody.
 */
import type {ModuleGraph} from './module-graph.js';
import {array,row,string,type Row} from './values.js';
import {npcReferenceView,npcsPresent,personLabel,sceneLabel,untoldBlock,clueDiscovered} from './capsule.js';
import {clueCheck} from './clue-check.js';
import {whoResolver} from './who.js';

/** The kinds a Keeper may select to reveal. Testimony (§257.17) is spoken by an owner who is present; description, appearance and voice are used automatically. */
export const REVEALABLE_EXHIBIT_KINDS: readonly string[] = ['document', 'perception', 'testimony'];

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
    const present = npcsPresent(graph, world, scene);
    for (const node of present) stand(node, 'person');
    for (const node of graph.sceneAssetNodes(scene)) stand(node, node.node_kind === 'handout' ? 'handout' : 'object');
    // What the table itself calls a carrier that is not a person or a place: a shown handout by the name it was shown under, a held
    // object by its own instance name. Anything else has no public name, and the author is given none.
    const shown = new Set<string>(), held = new Map<string, string>();
    for (const handle of array(world.handouts_shown)) {
        const node = graph.nodeOfHandle(handle);
        stand(node, 'handout');
        if (node) for (const each of graph.groupOf(node)) shown.add(string(each.node_id));
    }
    // Held by exact source identity (§180.19): an instance binds the book's object by `source_object`, never by its name.
    for (const item of Object.values(row(row(world.objects).instances)).map(row)) {
        const source = row(item.source_object);
        if (row(item.owner).kind !== 'investigator' || Number(item.quantity) <= 0 || source.module_id !== graph.moduleId) continue;
        const node = graph.nodes.get(graph.survivorId(string(source.node_id))) ?? graph.nodes.get(string(source.node_id));
        stand(node, 'object');
        if (node && string(item.name)) for (const each of graph.groupOf(node)) if (!held.has(string(each.node_id))) held.set(string(each.node_id), string(item.name));
    }
    const person = (node: Row): string => {
        const view = npcReferenceView(graph, world, node, untoldBlock(graph, world, row(reads.journal), node, array(reads.records).map(row)));
        return string(view.display_name);
    };
    const label = (node: Row): string => node.node_id === sceneId || graph.groupOf(scene).includes(node) ? sceneLabel(graph, world, node)
        : graph.isPerson(node) ? person(node) : node.node_kind === 'scene' ? sceneLabel(graph, world, node) : graph.displayName(node);
    /** The carrier as the table publicly has it, for the author; undefined when the table has no word for it. */
    const publicLabel = (node: Row): string | undefined => {
        const id = string(node.node_id), label = node.node_id === sceneId || graph.groupOf(scene).includes(node) || node.node_kind === 'scene' ? sceneLabel(graph, world, node)
            : graph.isPerson(node) ? person(node)
            : held.get(id) ?? (node.node_kind === 'creature' ? personLabel(world, graph.handle(node), '') : shown.has(id) ? graph.displayName(node) : '');
        return label || undefined;
    };
    const resolve = whoResolver(graph, world, row(reads.journal), array(reads.records).map(row));
    const found = rows.flatMap(item => {
        const carrier = graph.nodes.get(graph.survivorId(string(item.carrier))) ?? graph.nodes.get(string(item.carrier));
        // §257.17: testimony is in scope when an owner is here (the carrier may be elsewhere: a person tells of a place); the rest by carrier.
        const speakers = item.kind === 'testimony' ? array(item.owners).flatMap(id => {
            const owner = graph.nodes.get(graph.survivorId(string(id))) ?? graph.nodes.get(string(id));
            return owner && present.some(node => graph.groupOf(node).some(each => each.node_id === owner.node_id)) ? [graph.handle(owner)] : [];
        }) : [];
        const scope = item.kind === 'testimony' ? (speakers.length ? 'person' as ExhibitScope : undefined) : carrier ? scopes.get(string(carrier.node_id)) : undefined;
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
            carrier: {id: graph.handle(carrier), node_kind: string(carrier.node_kind), display_name: label(carrier), ...(publicLabel(carrier) ? {public_label: publicLabel(carrier)} : {})},
            ...(item.kind === 'testimony' ? {owners: [...new Set(speakers)], stance: string(item.stance || 'fact')} : {}),
            label: string(item.label),
            ...(clues.length ? {clue: open ? {state: open.state, ...(open.check ? {check: open.check} : {})} : {state: 'discovered'}, teaches: clues.map(entry => entry.clue),
                clue_states: clues.map(({clue, state}) => ({clue, state}))} : {}),
            surface: {text: resolve(string(surface.text)), language: string(surface.language), verbatim: surface.verbatim === true}
        }];
    });
    return {scene: graph.handle(scene), exhibits: found.sort((a, b) => RANK[a.scope] - RANK[b.scope])};
}

/**
 * Whether `exhibitId` is in scope at `scene` right now (the scope rule above, the kernel's own reading of the world) and teaches
 * the clue `clue` (a handle). A clue taught by a reachable exhibit may be obtained wherever the exhibit's carrier is
 * perceived or its owner speaks, though the book files the clue under another place; the host's word is never the proof.
 */
export function exhibitTeaches(graph: ModuleGraph, world: Row, scene: Row, exhibitId: string, clue: string): boolean {
    const found = exhibitsView(graph, world, scene).exhibits.find((item: Row) => item.exhibit_id === exhibitId);
    return !!found && array(found.teaches).includes(clue);
}
