/**
 * Contract §201.2: the check the book puts in front of finding a clue, and whether a turn passed it.
 *
 * A clue's own profile (`clueProfile`, the clue-owned row or the legacy conclusion entry) states how the book has it
 * found. When that is `delivery_kind: "skill_check"` with an authored skill, finding the clue is that check: the clue
 * lands after an investigator's roll of that skill has passed, never instead of it. A `skill_check` whose skill the
 * graph does not carry (`check required (skill unspecified)`, §30.12) is not gated here: which roll would satisfy it is
 * the Keeper's judgement, not a comparison the kernel can make.
 *
 * Nothing here reads prose. The comparison is of one rules skill identifier (NFKC, case and spacing folded) against the
 * `skill` of the turn's own roll receipts.
 */
import type { ModuleGraph } from './module-graph.js';
import { array, normalize, row, type Row } from './values.js';

/** The book's check for a clue, when the book makes finding it a check of a named skill. */
export interface ClueCheck { skill: string; difficulty?: string }

/** An authored string, trimmed; anything else (absent, null, a number) is no value. Never `string()`: it spells null "None". */
const named = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

export function clueCheck(graph: ModuleGraph, node: Row): ClueCheck | null {
    const profile = graph.clueProfile(node);
    if (profile.delivery_kind !== 'skill_check') return null;
    const skill = named(profile.skill);
    if (!skill) return null;
    const difficulty = named(profile.difficulty);
    return { skill, ...(difficulty ? { difficulty } : {}) };
}

/**
 * Whether `receipts` hold a passed roll of the check's skill by an investigator. A receipt that names no actor side is
 * read as the investigator's (receipts before `actor_is_investigator` existed); an NPC's roll never finds a clue.
 */
export function checkPassed(check: ClueCheck, receipts: readonly unknown[]): boolean {
    const wanted = normalize(check.skill);
    return array(receipts).map(row).some(receipt => receipt.kind === 'roll' && receipt.passed === true
        && receipt.actor_is_investigator !== false
        && [receipt.skill, row(receipt.check).skill].some(skill => typeof skill === 'string' && normalize(skill) === wanted));
}
