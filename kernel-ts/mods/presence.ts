/**
 * Contract §178: a Mod check declared `trigger: "presence"` is rolled by the kernel the first time its person shares a scene
 * with an investigator. Nothing here judges what anyone said: the pairs are the ledger's people in the active scene and the
 * party, the roll is the check's own arithmetic (`rollModCheck`), and a pair with a result never rolls again.
 *
 * Three callers run it on the world they are about to write: `table.apply` after a batch lands, `table.player_input` before
 * the capsule, and `table.open` before the opening (§178.3).
 */
import type { KernelContext } from '../context.js';
import { RpcError } from '../errors.js';
import type { ModuleGraph } from '../read/module-graph.js';
import { npcsPresent } from '../read/capsule.js';
import { activeMods } from '../read/mods.js';
import { tableWord } from '../read/person-words.js';
import { statedObligations } from '../modules/obligation-shape.js';
import { array, row, string, type Row } from '../read/values.js';
import type { CheckArithmetic } from '../resolve/arithmetic.js';
import { checkPair, priorCheck, rollModCheck } from './resolve.js';
import { PythonRandom } from '../random.js';

export interface PresenceInput {
    readonly kernel: KernelContext;
    readonly graph: ModuleGraph;
    /** The world the caller is about to write; the results are recorded in it. */
    readonly world: Row;
    readonly party: Row[];
    readonly turn: number;
    readonly callId: string;
    /** The campaign directory, for a check that declares a legacy file. */
    readonly directory: string;
    readonly arithmetic: CheckArithmetic;
    /** The turn's seed (`turnSeed`). Each pair rolls on its own stream from it, never the turn's shared one: meeting
     *  someone does not move the dice the Keeper rolls next, and an impression does not depend on who else was met. */
    readonly seed: string;
    mint(base: string): string;
}
export interface PresenceRolled {
    readonly receipts: Row[];
    /** One row per roll, for the Keeper (§178.4): who met whom and the impression it left. */
    readonly impressions: Row[];
    /** True when the world changed: a roll, or a legacy result adopted into the state. */
    readonly changed: boolean;
    /** Pairs the check could not settle (a card without the value, a legacy record that fails its digest): never a refusal of the caller. */
    readonly skipped: Row[];
}

/** §134.5: the people whose reaction roll the book says is not used. */
function preordained(graph: ModuleGraph): Set<string> {
    return new Set(statedObligations(graph).map(node => row(row(node.properties).obligation))
        .filter(obligation => obligation.reaction === 'preordained' && typeof obligation.who === 'string').map(obligation => string(obligation.who)));
}

/** §178.4: the table's word for a person, for the card. Never the book's name of someone untold. */
export function publicPersonLabel(graph: ModuleGraph, world: Row, node: Row): string | null {
    const word = tableWord(world, graph.handle(node));
    if (word) return word;
    return graph.isTablePerson(node) ? graph.displayName(node) || null : null;
}

export async function presenceRolls(input: PresenceInput): Promise<PresenceRolled> {
    const {kernel, graph, world} = input, receipts: Row[] = [], impressions: Row[] = [], skipped: Row[] = [];
    const checks = (await activeMods(kernel, world)).flatMap(mod => array(row(mod.contributes).checks)
        .filter(check => check.trigger === 'presence' && check.scope === 'actor-target').map(check => ({modId: string(mod.id), recipe: check as Row})));
    if (!checks.length || !input.party.length || typeof world.active_scene !== 'string') return {receipts, impressions, changed: false, skipped};
    const scene = graph.scene(world.active_scene), withheld = preordained(graph);
    const people = npcsPresent(graph, world, scene).filter(node => node.node_kind === 'npc' && !withheld.has(string(node.node_id)));
    let changed = false;
    for (const {modId, recipe} of checks)
        for (const actor of input.party)
            for (const target of people) {
                // The meeting happened whatever the dice can say about it: a pair that cannot be settled is reported, never thrown
                // into the write that brought the people together.
                let rolled: {receipt: Row; result: Row};
                try {
                    const {prior, adopted} = await priorCheck(kernel, input.directory, graph, world, modId, recipe, actor, target);
                    changed ||= adopted;
                    if (prior) continue;
                    const label = publicPersonLabel(graph, world, target);
                    rolled = rollModCheck({world, graph, modId, recipe, actor, target, turn: input.turn,
                        receiptId: input.mint(`roll:mod-${modId}-${input.callId}`), callId: input.callId, arithmetic: input.arithmetic,
                        rng: new PythonRandom(`${input.seed}:presence:${checkPair(recipe.name, actor.id, target.node_id)}`),
                        extra: {trigger: 'presence', ...(label ? {public_target_label: label} : {})}});
                } catch (error) {
                    if (!(error instanceof RpcError)) throw error;
                    skipped.push({check: recipe.name, actor: actor.id ?? null, handle: graph.handle(target), code: error.code, message: error.message});
                    continue;
                }
                const {receipt, result} = rolled;
                changed = true;
                receipts.push(receipt);
                impressions.push({actor: actor.name ?? null, target: graph.displayName(target), handle: graph.handle(target), skill: receipt.skill,
                    level: receipt.level, impression: row(result.outcome).impression ?? null, receipt: receipt.id});
            }
    return {receipts, impressions, changed, skipped};
}

/** §178.3: what the Keeper is asked to do with the impressions a call rolled. */
export const FIRST_IMPRESSIONS_NOTE = 'The kernel rolled these first impressions because these people now share a scene with the investigator. '
    + 'Let each one shape that person\'s manner and what they offer or withhold, with their own agenda; never restate the numbers and never resolve the check again.';
