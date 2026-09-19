/** A ready-to-read working context backed by retained complete evidence. */
import type {ModuleGraph} from '../read/module-graph.js';
import {recordOf} from '../read/module-graph.js';
import {clockSection} from '../read/capsule.js';
import {continuityView} from '../read/continuity.js';
import {EntityIndex, queryCandidates} from '../read/memory.js';
import {objectContext, unregisteredEquipment} from '../read/mods.js';
import {claimedEquipment} from './queue.js';
import {array, chars, row, string, truth, type Row} from '../read/values.js';

const pick = (value: Row, names: string[]): Row => Object.fromEntries(names.filter(name => Object.hasOwn(value, name)).map(name => [name, value[name]]));
export function continuityAuditContext(graph: ModuleGraph, world: Row, turn: Row, party: Row[], files: Row): Row {
    const records = array(files['history.json']), candidates = array(files['memory.json']);
    const scene = graph.scene(world.active_scene), index = new EntityIndex(graph, party, row(world.scene_labels));
    const anchors = [graph.handle(scene), ...array(world.discovered_clues).slice(-4), ...party.map(person => string(person.name))];
    const memory = queryCandidates(candidates, index, anchors, {limit: 6});
    const corrections = candidates.filter(value => value.kind === 'keeper_correction' && value.superseded_by == null);
    const objects = objectContext(world), sourceNodes = [...new Set([...graph.sceneClueIds(scene), ...array(world.discovered_clues).slice(-4)])]
        .flatMap(name => { const node = graph.find(name); return node ? [node] : []; });
    const moves = array(turn.receipts).filter(receipt => receipt.kind === 'move');
    const failedRolls = array(turn.receipts).filter(receipt => receipt.kind === 'roll' && receipt.passed === false)
        .map(receipt => pick(receipt, ['call_id', 'actor_label', 'skill', 'passed', 'level', 'family', 'decision', 'goal', 'summary', 'visibility']));
    const reentry = row(row(row(turn.capsule).mods).thread).reentry;
    const bridge = row(row(reentry).bridge), bridgeClue = graph.find(string(bridge.clue), ['clue']);
    const causalReentry = truth(reentry) ? {...reentry, authority: {
        current_scene: graph.handle(scene),
        clue_here: !!bridgeClue && graph.sceneClueIds(scene).includes(bridgeClue.node_id),
        rule: 'A new bridge receipt is authorized here only when the effective graph makes its clue discoverable at the current scene; accepted source_rebinding changes that graph.'
    }} : null;
    return {
        current_input: turn.player_text ?? null,
        clock: clockSection(graph, world),
        scene: {handle: graph.handle(scene), name: graph.displayName(scene), question: recordOf(scene).dramatic_question ?? null},
        intelligibility_review: {requires_review: true,
            definition: 'Judge whether every candidate sentence and spoken line is naturally understandable in the play language without restoring omitted grammatical relations. This is not literary style scoring.'},
        scene_commitment: {requires_review: true,
            active: {handle: graph.handle(scene), name: graph.displayName(scene), summary: chars(graph.summary(scene), 700)},
            moves: moves.map(receipt => pick(receipt, ['from', 'to', 'from_label', 'to_label', 'minutes'])),
            definition: 'active_scene is the persistent gameplay locus, not a physical coordinate.',
            promotion_test: 'A distinct place needs a scene and move only when it becomes the ongoing locus for subsequent player action or durable location-bound state. Spatial wording, scale and motion do not decide this.'},
        ...(failedRolls.length ? {outcome_commitments: {requires_review: true, failed_rolls: failedRolls,
            definition: 'A failed roll may have consequences, uncertainty or no result; it does not earn the positive action, perception, clue or fact that roll was meant to decide.'}} : {}),
        ...(causalReentry ? {causal_reentry: causalReentry} : {}),
        present: Object.entries(row(world.npc_presence)).filter(([, at]) => at === world.active_scene).map(([name]) => ({name: index.canonicalName(`npc:${graph.find(name)?.node_id ?? name}`)})),
        receipts: array(turn.receipts).map(receipt => pick(receipt, ['kind', 'actor_label', 'skill', 'passed', 'from_label', 'to_label', 'minutes', 'clue', 'handout', 'label', 'summary', 'how', 'from', 'to', 'owner', 'delta', 'before', 'after', 'name', 'text', 'condition', 'visibility', 'object', 'usage', 'offer', 'offered_to_label', 'handover'])),
        actors: party.map(person => ({name: person.name, equipment: person.equipment ?? [], cash: person.cash ?? null,
            weapons: array(person.weapons).map(weapon => pick(weapon, ['name', 'display_name', 'skill', 'damage', 'ammo', 'magazine', 'usage', 'usage_mode']))})),
        objects: {queued_registrations: objects.queued_registrations,
            definitions: array(objects.definitions).map(value => pick(value, ['name', 'category', 'document'])),
            instances: array(objects.instances).map(value => ({...pick(value, ['name', 'owner', 'state', 'definition', 'usages']),
                document: value.document ? {presentation: value.document.presentation, text: chars(value.document.text, 220),
                    truncated: string(value.document.text).length > 220 || value.document.truncated === true} : null}))},
        equipment_without_instances: unregisteredEquipment(party, claimedEquipment(world)),
        corrections: corrections.slice(-6).map(value => ({statement: value.statement ?? '', turn: value.valid_from_turn ?? value.turn ?? null, source: 'retained correction'})),
        memory: memory.map(value => pick(value, ['kind', 'subject', 'statement', 'turn', 'state', 'status', 'authority'])),
        recent_history: records.slice(-3).map(value => ({turn: value.turn, player_text: chars(string(value.player_text ?? ''), 800),
            input_truncated: string(value.player_text).length > 800,
            text: chars(value.rendered_text, 1200), truncated: string(value.rendered_text).length > 1200})),
        source_facts: sourceNodes.slice(0, 12).map(node => ({name: graph.handle(node), summary: chars(graph.summary(node), 700),
            disclosure: array(world.discovered_clues).includes(graph.handle(node)) ? 'acquired' : 'keeper_only'})),
        connections: continuityView(graph, world, records, candidates, {limit: 3, compact: true, budget: 2800}),
        coverage: {history_total: records.length, history_previews: Math.min(3, records.length), memory_total: candidates.length,
            correction_total: corrections.length, full_evidence_files: Object.keys(files),
            note: 'Equipment without an instance is not necessarily missing mechanics: ordinary decorative gear needs no executable definition. Previews are not complete evidence; read the relevant retained file if a decision depends on omitted history or text. Compatible new fiction is not a contradiction merely because the book does not state it.'}
    };
}
