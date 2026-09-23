/**
 * Contract §136.22 (RD-03): `apply damage|time|threat|flag|cash` with `stated: <handle>`.
 *
 * The amount is the book's: the effect of this kind that this turn's `action.rule` roll on the node reached, else
 * the node's own shape of that kind (`read/stated.ts`). Giving `stated` and an amount of your own is
 * `stated_conflict`; two candidate amounts are `stated_ambiguous`, with the choices. Without `stated` the effect is
 * exactly today's, the Keeper's own amount (spec P8). Either way every receipt of the effect says whose number it
 * was: `basis: "stated"` with `stated: <handle>`, or `basis: "keeper"`.
 */
import { RpcError, type ErrorCode } from '../errors.js';
import { STATED_FIELDS, UNIT_MINUTES, statedCandidates, statedNode } from '../read/stated.js';
import { rollExpression } from '../resolve/arithmetic.js';
import { array, integer, number, repr, string, type Row } from '../read/values.js';
import type { ApplyContext } from './index.js';

const refuse = (code: ErrorCode, reason: string, message: string, extra: { fix?: string; details?: Row } = {}): never => {
    throw new RpcError(code, message, { ...(extra.fix ? { fix: extra.fix } : {}), details: { field: 'stated', reason, ...extra.details } });
};

/** The effect to stage, and whose amount it carries. */
export interface StatedEffect {
    readonly effect: Row;
    readonly stated: string | null;
    readonly roll?: Row;
}

/** Bind `stated` into an effect of one of the five kinds; any other effect passes through untouched. */
export function bindStated(context: ApplyContext, effect: Row): StatedEffect {
    const kind = string(effect.kind);
    if (effect.stated == null)
        return { effect, stated: null };
    if (!Object.hasOwn(STATED_FIELDS, kind))
        refuse('invalid_params', 'stated_none', `a ${kind} effect takes no stated amount`, {
            fix: `leave stated out; only ${Object.keys(STATED_FIELDS).join(', ')} take one` });
    const graph = context.graph, node = statedNode(graph, effect.stated);
    if (!node)
        refuse('unknown_entity', 'stated_unknown', `${repr(effect.stated)} names no rule, hazard, tome, object or threat of this module that states an amount`, {
            fix: 'name the rule a where.rules row with a mech line lists, or leave stated out and give your own amount' });
    const handle = graph.handle(node!);
    const given = STATED_FIELDS[kind].filter(field => effect[field] != null);
    if (given.length)
        refuse('invalid_params', 'stated_conflict', `stated takes the amount from ${handle}, and ${given.join(', ')} is your own; give one`, {
            fix: `leave ${given.join(', ')} out to use the book's amount, or stated out to use your own`, details: { stated: handle, fields: given } });
    const candidates = statedCandidates(graph, [...array(context.turn.receipts)], node!, kind);
    if (!candidates.length)
        refuse('invalid_params', 'stated_none', `${handle} states no ${kind} here`, {
            fix: `give your own amount and leave stated out`, details: { stated: handle } });
    if (candidates.length > 1)
        refuse('invalid_params', 'stated_ambiguous', `${handle} states more than one ${kind} here`, {
            fix: 'give the amount you mean yourself (one of details.choices) and leave stated out', details: { stated: handle, choices: candidates } });
    const chosen = candidates[0], bound: Row = { ...effect };
    delete bound.stated;
    const unstated = (): never => refuse('invalid_params', 'stated_unstated', `${handle} leaves the ${kind} amount unstated; the amount is yours`, {
        fix: 'give your own amount and leave stated out', details: { stated: handle, choice: chosen } });
    let roll: Row | undefined;
    if (kind === 'damage') {
        if (typeof chosen.dice !== 'string') unstated();
        bound.dice = chosen.dice;
    }
    else if (kind === 'time') {
        if (integer(chosen.minutes)) bound.minutes = chosen.minutes;
        else if (chosen.amount_unstated === true) unstated();
        else if (chosen.unit === 'round' || !Object.hasOwn(UNIT_MINUTES, string(chosen.unit)))
            refuse('invalid_params', 'stated_none', `${handle} states combat rounds, which do not move the clock`, {
                fix: 'leave stated out; give the minutes the scene took, if any', details: { stated: handle, choice: chosen } });
        else {
            roll = rollExpression(string(chosen.amount), context.kernel.rng);
            roll = { expression: string(chosen.amount).toUpperCase(), unit: chosen.unit, total: roll.total };
            bound.minutes = number(roll.total) * UNIT_MINUTES[string(chosen.unit)];
        }
    }
    else if (kind === 'threat') {
        if (chosen.name == null) unstated();
        Object.assign(bound, { name: chosen.name, clock: chosen.clock, segments: chosen.segments });
    }
    else if (kind === 'flag')
        Object.assign(bound, { name: chosen.name, value: chosen.value });
    else {
        bound.delta = chosen.delta;
        if (chosen.currency != null) bound.currency = chosen.currency;
        bound.source ??= 'quote';
    }
    return { effect: bound, stated: handle, ...(roll ? { roll } : {}) };
}

/** Whose number a receipt of one of the five kinds carries. */
export function stampBasis(receipt: Row, bound: StatedEffect): void {
    receipt.basis = bound.stated ? 'stated' : 'keeper';
    if (bound.stated) receipt.stated = bound.stated;
    if (bound.roll) receipt.stated_roll = bound.roll;
}
