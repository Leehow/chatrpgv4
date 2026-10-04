/**
 * Contract §180.6 (CK-F2): the refusal of an engine entry that builds a participant -- a fight, a chase, a resource
 * effect -- from a stat block that lacks what the participant is built from.
 *
 * Before this, an authored block that states skills and no characteristics (Mystery House's chapel familiar) made its
 * creature an actor, present and an opponent by every selection, and the fight threw `NpcProfileError` out of
 * `npcCombatParticipant`: an internal error, nothing the Keeper could act on. Now the entry refuses first, naming what
 * is missing and the one call that completes the block: `apply npc {name, creature}` for a creature (the rules catalog's
 * block under the numbers the block states), `apply npc {name, archetype}` for a person. Which entry or tier fits is the
 * Keeper's judgement; nothing here maps a being to one.
 */
import { RpcError } from '../errors.js';
import type { KernelContext } from '../context.js';
import type { ModuleGraph } from '../read/module-graph.js';
import type { Row } from '../read/values.js';
import { archetypeIds } from '../apply/archetype.js';
import { catalogCreatureNames } from '../apply/creature.js';
import { npcProfileOf } from '../resolve/context.js';
import { hitPointGaps, participantGaps, statBlockGaps } from './profiles.js';

/**
 * The refusal for `node`'s block, which lacks `missing` (paths, `characteristics.STR`). `use` says what reads them
 * ("a fight against X"). A person's completion is an archetype, a creature's a rules-catalog creature: `details.needs`
 * names that field and its options, as the no-stat-block refusal does, and `details.options` repeats the options, as
 * CK-E's unknown-entry refusal gives them.
 */
export async function incompleteStatBlock(kernel: KernelContext, graph: ModuleGraph, node: Row, handle: string, missing: string[], use: string,
    reason = 'stat_block_incomplete'): Promise<RpcError> {
    const name = graph.displayName(node), person = graph.isPerson(node);
    const field = person ? 'archetype' : 'creature', options = person ? await archetypeIds(kernel) : await catalogCreatureNames(kernel);
    const call = person
        ? `apply npc {name: "${name}", archetype: <one of details.needs.options, chosen from who this person is>, why: <one sentence>}`
        : `apply npc {name: "${name}", creature: <the rules-catalog creature it is, one of details.needs.options>, why: <one sentence>}`;
    return new RpcError('needs', `${name}'s stat block has no ${missing.join(', ')}: ${use} reads ${missing.length > 1 ? 'them' : 'it'}, and none is assumed`, {
        fix: `complete the block first with ${call}: the ${person ? 'archetype' : 'catalog'} fills only details.missing, and every number ${name}'s block states is kept; when the module has a book that prints the missing numbers, read them with lookup kind=source instead. Then resolve again. Nothing without a receipt has happened`,
        details: { reason, npc: handle, name, kind: person ? 'npc' : 'creature', missing, needs: { field, options }, options },
    });
}

/** Refuse `use` when `profile` lacks what a participant is built from; the block is returned when it lacks nothing. */
export async function requireParticipantBlock(kernel: KernelContext, graph: ModuleGraph, node: Row, handle: string, profile: Row, use: string): Promise<Row> {
    const missing = participantGaps(profile);
    if (missing.length)
        throw await incompleteStatBlock(kernel, graph, node, handle, missing, use);
    return profile;
}

/**
 * Refuse `use` when `profile` lacks what a runner on foot is read from (§143.12, §180.6 CK-F2 review follow-up): the
 * participant's characteristics and the runner's own `derived.MOV`, which nothing assumes. A driver's speed is the
 * vehicle's and a passenger follows the driver, so neither is held to this.
 */
export async function requireRunnerBlock(kernel: KernelContext, graph: ModuleGraph, node: Row, handle: string, profile: Row, use: string): Promise<Row> {
    const missing = statBlockGaps(profile);
    if (missing.length)
        throw await incompleteStatBlock(kernel, graph, node, handle, missing, use);
    return profile;
}

/**
 * Refuse settling the body of the actor `name` names (damage, First Aid, Medicine: §66's patient) when its block lacks
 * what its hit points are read from. A name that is no actor, or one with no block, is left to the patient's own reads.
 */
export async function requirePatientBlock(kernel: KernelContext, graph: ModuleGraph, world: Row, name: string): Promise<void> {
    const node = graph.actor(name);
    if (!node)
        return;
    const handle = graph.handle(node), profile = npcProfileOf(graph, world, handle), missing = profile ? hitPointGaps(profile) : [];
    if (missing.length)
        throw await incompleteStatBlock(kernel, graph, node, handle, missing, `settling ${graph.displayName(node)}'s body`);
}
