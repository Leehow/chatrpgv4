/**
 * Contract §143.8: the stakes die's receipt, recognised and read. A leaf, so every reader of turn receipts can import it
 * without pulling in the writer (`npc/stakes.ts`).
 *
 * The receipt is a `roll` -- the die is a hidden die (§16.5) and the receipt kinds of §12.1 are closed -- but it is not
 * a check: it has no skill, no target and no pass. The readers that take a roll for a check (the NPC ledger's fold, the
 * Director's last roll, the committed facts, the NPC journal's people, the situation's `happened`) skip it by
 * `isStakesRoll`; the situation's `stakes` reads it through `stakesView`.
 */
import {row, type Row} from '../read/values.js';

/** The `family` the stakes receipt carries; no resolve family has this name. */
export const STAKES_FAMILY = 'stakes';

export const isStakesRoll = (receipt: unknown): boolean => {
    const value = row(receipt);
    return value.kind === 'roll' && value.family === STAKES_FAMILY;
};

/**
 * What the generation step is told of one stakes receipt: `{rung, outcome, line, surprise, surprise_line}` -- `line` null
 * for `nothing`; `surprise` true only when the receipt says so (§143.19; a receipt written before it has none, and reads
 * as no surprise), `surprise_line` the table's permission then, else null.
 */
export function stakesView(receipt: Row): Row {
    const text = (value: unknown): string | null => typeof value === 'string' && value ? value : null;
    const surprise = receipt.surprise === true;
    return {rung: text(receipt.rung), outcome: text(receipt.outcome), line: text(receipt.line), surprise, surprise_line: surprise ? text(receipt.surprise_line) : null};
}
