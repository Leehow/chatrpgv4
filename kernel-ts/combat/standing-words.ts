/**
 * The closed words of an NPC's standing action and combat disposition (contract §11.5.3). A leaf, so the one
 * mechanics validator (§136.8) and the standing reader read the same enums without pulling each other in.
 */
/** The standing action words: `attack` binds the attack; `hold` and `flee` hand the NPC's turn to the Keeper. */
export const ACTION_WORDS: readonly string[] = Object.freeze(['attack', 'hold', 'flee']);
/** What a book may author as a standing action (§11.5.3 source 1): only that a creature always attacks. */
export const AUTHORED_ACTION_WORDS: readonly string[] = Object.freeze(['attack']);
/** What the Keeper's override may write (§11.5.3 source 3). A flight is the table's reading or the Keeper's prose. */
export const OVERRIDE_ACTION_WORDS: readonly string[] = Object.freeze(['attack', 'hold']);
/** The closed combat disposition enum (§11.5.3; the ruling "An NPC's fight behaviour follows the NPC's own parameters"). */
export const DISPOSITION_WORDS: readonly string[] = Object.freeze(['fights_to_the_end', 'fights_then_flees', 'avoids_fighting', 'surrenders']);
