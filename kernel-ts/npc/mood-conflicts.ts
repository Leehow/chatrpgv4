/**
 * The npc fields a mood cannot share its effect with (§161.1): every other change to the person, and the host-only
 * carriers of what an act brings out. Moving or re-standing the person in the same batch is a second effect.
 *
 * Its own module with no imports, so the kernel extension can read the same list the kernel refuses with
 * (`extensions/kernel/npc-mood-split.ts`): the extension is loaded unbundled in tests, where `mood.ts`'s `.js` siblings
 * do not resolve.
 */
export const MOOD_CONFLICTS: readonly string[] = Object.freeze([
    'to', 'stance', 'dead', 'skill', 'archetype', 'conditions', 'defense', 'action', 'disposition',
    'intends', 'intent_ref', 'intent_outcome', 'outcome', 'spend_turn', 'reunion', '_draws', '_produces',
]);
