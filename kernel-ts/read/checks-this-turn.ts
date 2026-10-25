/**
 * §269.1: the checks this turn has already rolled, one compact row each, so the Keeper reads the settled result instead
 * of reconstructing it from receipts (1025b/1025c: a quarter of the long reasoning re-judged rolls whose receipts stood).
 */
import { array, row, string, type Row } from "./values.js";

export const CHECKS_SETTLED_LINE = "settled: each row is the rules' final result for its goal; a failed goal did not happen this input";

export function checksThisTurn(receipts: unknown): Row[] {
    return array(receipts).map(row).filter(receipt => receipt.kind === "roll" && receipt.form !== "dice").map(receipt => {
        const check = row(receipt.check);
        return {
            id: string(receipt.id),
            actor: string(receipt.actor_label || receipt.actor),
            skill: string(receipt.skill_label || receipt.skill),
            ...(string(check.goal) ? { goal: string(check.goal) } : {}),
            ...(string(receipt.named_stake) ? { stake: string(receipt.named_stake) } : {}),
            level: string(receipt.level),
            passed: receipt.passed === true,
            ...(receipt.pushed === true ? { pushed: true } : {})
        };
    });
}
