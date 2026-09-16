/**
 * The states standing on the party that take the action away, for a delivery that did not change them.
 *
 * `mechanics` (§16.2) is a record of what *happened*: every row there is a receipt, and a state that
 * did not change minted none. So a condition was visible for exactly one turn. Retained evidence,
 * `game-83177d61`: turn 107 minted `condition:investigator-t107-c1` and that row rendered; turns 108
 * through 114 minted no condition receipt at all, while `save/healing-state/investigator.json` still
 * reads `conditions: ["unconscious"]` today. The player learned he was still down because the Keeper
 * happened to write it into the fiction, which leaves the table one distracted Keeper away from the
 * defect the receipt row was written for -- three turns of declaring actions for an unconscious man.
 *
 * This is not a mechanics row and deliberately never becomes one. It rides the delivery result as
 * `standing`, and the host says it on its own out-of-fiction channel: the line has to land where the
 * player is looking when they decide what to say next, and that is the delivery, not a panel they
 * would have to think to open.
 *
 * Only the states that take the action away. `incapacitatedBy` is the rules layer's single line and
 * this reads it rather than keeping a second one. A `major_wound` or a `prone` costs dice or
 * position and the character still acts, so an every-turn notice about one would be noise on the
 * channel that has to stay believed; those live on the sheet, where a player looks for what is true
 * of a body, and they still get their one `condition` row on the turn they land.
 *
 * Not twice: a subject whose conditions changed this turn already has a `condition` row on the card
 * carrying the state, the standing set and the `cannot act` stamp, so nothing is said here as well.
 * That holds for a withheld change too -- a `keeper`-tier condition receipt suppresses this line, or
 * a settlement that meant to keep a state from the player would have the host announce it anyway.
 */
import { incapacitatedBy } from "../healing/conditions.js";
import { array, row, string, type Row } from "./values.js";

export function standingStates(party: Row[], receipts: Row[]): Row[] {
    const changed = new Set(array(receipts).map(row).filter(receipt => receipt.kind === "condition").map(receipt => string(receipt.subject)));
    return array(party).map(row).flatMap(sheet => {
        const id = string(sheet.id), blocked = incapacitatedBy(sheet.conditions);
        if (!blocked.length || changed.has(id))
            return [];
        return [{
            investigator: id || null,
            name: sheet.name ?? null,
            conditions: blocked
        }];
    });
}
