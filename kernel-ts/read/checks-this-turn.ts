/**
 * §269.1: the checks this turn has already rolled, one compact row each, so the Keeper reads the settled result instead
 * of reconstructing it from receipts (1025b/1025c: a quarter of the long reasoning re-judged rolls whose receipts stood).
 */
import { array, row, type Row } from "./values.js";

/** A field as text, or empty: values.string renders a missing value as "None". */
const text = (value: unknown): string => typeof value === "string" ? value : "";

export const CHECKS_SETTLED_LINE = "settled: each row is the rules' final result for its goal; a failed goal did not happen this input";

export function checksThisTurn(receipts: unknown): Row[] {
    return array(receipts).map(row).filter(receipt => receipt.kind === "roll" && receipt.form !== "dice").map(receipt => {
        const check = row(receipt.check);
        return {
            id: text(receipt.id),
            actor: text(receipt.actor_label) || text(receipt.actor),
            skill: text(receipt.skill_label) || text(receipt.skill),
            ...(text(check.goal) ? { goal: text(check.goal) } : {}),
            ...(text(receipt.named_stake) ? { stake: text(receipt.named_stake) } : {}),
            level: text(receipt.level),
            passed: receipt.passed === true,
            ...(receipt.pushed === true ? { pushed: true } : {})
        };
    });
}
