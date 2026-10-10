/**
 * Contract §222.3: what an Idea roll settles beside its die.
 *
 * The Keeper Rulebook's Idea roll (pp. 199-200) is the players' request when the investigation has stalled: the roll decides
 * *how* the missed clue comes, never *whether*. So the clue the roll names lands in the roll's own call, whichever way the die
 * fell, with a receipt that says it came by the Idea roll and whether the roll passed; and the Keeper is told how it
 * arrives -- woven in with a strong direction on a pass, "in the thick of it" on a failure.
 *
 * The clue was chosen by the host (Jev, from the catalog's closed options) and checked by the pipeline (`ideaClue`);
 * nothing here judges anything.
 */
import { clueCheck } from '../read/clue-check.js';
import { array, row, string, type Row } from '../read/values.js';
import type { SettleContext } from './context.js';

/** The clerk's note for each way the die fell: the rulebook's own two outcomes, paraphrased. */
export const IDEA_ROLL_NOTE = Object.freeze({
    passed: 'Idea roll passed: the clue it names is landed and the investigators make the connection. Deliver what it states woven into the story, '
        + 'with enough direction to get the investigation moving again; it costs them nothing.',
    failed: 'Idea roll failed: the clue it names is landed all the same, but the investigators are in the thick of it. Open the next beat in medias '
        + 'res, with the worst situation in which they could realize this clue -- trouble of the kind the book already has on the table -- and let '
        + 'them deal with it; do not withhold the clue.',
});

export async function landIdeaClue(context: SettleContext, name: string, data: Row, at: string): Promise<{ clue: string; receipt: string; note: string }> {
    const graph = context.graph, world = context.world, node = graph.clue(name), handle = graph.handle(node);
    const passed = data.passed === true, note = passed ? IDEA_ROLL_NOTE.passed : IDEA_ROLL_NOTE.failed;
    // The roll receipt says what it was: an Idea roll, for this clue. `addRoll` already made it; only its kind and its clue change.
    const roll = context.receipts.find(receipt => receipt.id === data.roll_id);
    if (roll) {
        roll.roll_kind = 'idea_roll';
        roll.clue = handle;
        if (roll.check && typeof roll.check === 'object') Object.assign(roll.check as Row, { kind: 'idea_roll', clue: handle });
    }
    data.kind = 'idea_roll';
    data.clue = handle;
    data.push_eligible = false;
    // The scene the book puts the clue in: the active scene, else the trail's scene that holds it.
    const scenes = [world.active_scene, ...[...array(world.scene_trail)].reverse()].map(value => graph.find(string(value), ['scene'])).filter((scene): scene is Row => !!scene);
    const scene = scenes.find(candidate => graph.sceneClueIds(candidate).includes(string(node.node_id))) ?? scenes[0];
    const id = context.mint(`clue:${handle}-t${context.turnNumber}-c${context.ordinal}`);
    const check = clueCheck(graph, node);
    const receipt: Row = { id, kind: 'clue', call_id: context.callId, clue: handle, label: graph.displayName(node), summary: node.summary || node.name,
        scene: scene ? graph.handle(scene) : null, how: 'by the Idea roll', from: null,
        ...(check ? { check: { ...check } } : {}), found_by: { route: 'idea_roll', ...(roll ? { roll: string(roll.id) } : {}), passed }, at };
    context.receipts.push(receipt);
    const found = array(world.discovered_clues ??= []).map(String);
    if (!found.includes(handle)) {
        (world.discovered_clues as unknown[]).push(handle);
        await context.transaction.campaign.writeWorld(world);
    }
    return { clue: handle, receipt: id, note };
}
