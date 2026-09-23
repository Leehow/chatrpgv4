/**
 * An NPC's standing defence (contract §11.5.2; the spec ruling "An NPC's defence is data"). Three sources, a later
 * one replacing an earlier one: the NPC record's authored tactic (`combat.defense`), the rules default from the
 * numbers the profile builder makes (`defaultDefense`), and the Keeper's override (`apply npc {defense, why}`,
 * `world.npc_defense`). Read, never stored: the session view and the NPC card compute it from state each time.
 */
import type { ModuleGraph } from '../read/module-graph.js';
import { recordOf } from '../read/module-graph.js';
import { isJsonObject } from '../json.js';
import { number, row, type Row } from '../read/values.js';
import { defaultDefense, npcDefenceSkills } from './profiles.js';

/** The §11.9 defence words: the closed enum a tactic is written in. */
export const DEFENSE_WORDS: readonly string[] = Object.freeze(['dodge', 'fight_back', 'none']);
export type StandingBasis = 'authored' | 'rule-default' | 'keeper';
export interface Standing { defense: string | null; basis: StandingBasis }

const word = (value: unknown): string | null => typeof value === 'string' && DEFENSE_WORDS.includes(value) ? value : null;

/** The Keeper's override for this person, if one was written (§11.5.2 source 3). */
export function keeperDefense(world: Row, handle: string): string | null {
    return word(row(row(world.npc_defense)[handle]).defense);
}
/** The book's tactic for this person: the record's `combat.defense`, when it is a defence word (source 1). */
export function authoredDefense(graph: ModuleGraph, handle: string): string | null {
    const node = graph.actor(handle);
    return node ? word(row(recordOf(node).combat).defense) : null;
}
/**
 * The standing of an NPC defender against one pending attack. `participant` is the combat snapshot's row for the
 * defender (the numbers the defence is rolled with); `options` are the options the kernel issues for this attack.
 * A standing `fight_back` against a firearm reads as `dodge`, as the engine turns every defence but `none` into
 * diving for cover there; the basis is kept.
 */
export function standingDefense(graph: ModuleGraph, world: Row, handle: string, participant: Row, options: readonly string[], firearm: boolean): Standing {
    const keeper = keeperDefense(world, handle), authored = keeper ? null : authoredDefense(graph, handle);
    const basis: StandingBasis = keeper ? 'keeper' : authored ? 'authored' : 'rule-default';
    let defense = keeper ?? authored ?? defaultDefense(number(participant.combat_skill), number(participant.dodge_skill));
    if (firearm && defense === 'fight_back') defense = 'dodge';
    // The standing is always an issued option (the kernel issues `none` against every attack).
    if (!options.includes(defense)) defense = options.includes('dodge') ? 'dodge' : 'none';
    return { defense, basis };
}
/**
 * The NPC card's line (Keeper-only): the override or the authored word, else the rules default from the person's
 * profile (the book's, else a pinned archetype, §34.10), else no word for someone without numbers.
 */
export function cardTactic(graph: ModuleGraph, world: Row, node: Row): Standing {
    const handle = graph.handle(node), keeper = keeperDefense(world, handle);
    if (keeper) return { defense: keeper, basis: 'keeper' };
    const authored = word(row(recordOf(node).combat).defense);
    if (authored) return { defense: authored, basis: 'authored' };
    const book = graph.mechanicsOf(node).profile, pinned = row(world.npc_profiles)[handle];
    const profile = isJsonObject(book) ? book : isJsonObject(pinned) ? pinned : null;
    if (!profile) return { defense: null, basis: 'rule-default' };
    const skills = npcDefenceSkills(profile);
    return { defense: defaultDefense(skills.combat_skill, skills.dodge_skill), basis: 'rule-default' };
}
