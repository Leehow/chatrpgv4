/**
 * Which conditions take a character's action away, and which only take them out of the fight.
 *
 * This is the rules engine's own line. It sits beside `applyWoundConditions` (`./resources.ts`),
 * which is where those three are assigned: `dead` on an attack past maximum hit points,
 * `unconscious` at zero hit points or on a failed major-wound CON roll, and `dying` when both are
 * true. Four consumers used to carry a copy of the same list -- combat eligibility, the initiative
 * order, the session view's target list and the damage evidence rows -- so widening or narrowing
 * the rule meant five edits that could drift. It is one edit now, and it is here rather than in a
 * reading surface because deciding which states forbid acting is a rules question: a card or a
 * capsule that answered it would be a second rules table living in a consumer.
 *
 * `fled` is not incapacitating. A character who has withdrawn is out of *this bout* and can still
 * act, which is the second set. `major_wound`, `prone`, `grappled`, `surprised` and `outnumbered`
 * cost a character dice or position, never the action itself.
 *
 * It is deliberately a leaf: nothing here imports anything but the value helpers, so the rule can
 * be read by the projection, the capsule and the resolve gate without any of them pulling the
 * healing engine in behind it.
 */
import { array, string } from '../read/values.js';
/** CoC 7e: a character in any of these takes no action of their own. */
export const INCAPACITATING_CONDITIONS = new Set(['dead', 'dying', 'unconscious']);
/** Out of the current bout: incapacitated, or withdrawn from it. */
export const OUT_OF_FIGHT_CONDITIONS = new Set([...INCAPACITATING_CONDITIONS, 'fled']);
/** Whichever of `conditions` take the action away, in the order the character carries them. */
export const incapacitatedBy = (conditions: any): string[] => array(conditions).map(string).filter(value => INCAPACITATING_CONDITIONS.has(value));
