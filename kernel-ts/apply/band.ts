/**
 * Contract §138 (BR-01): `apply time|damage` with `band: <row>`.
 *
 * The number is rolled inside a row of a band table (`rules/bands.ts`): a time-cost category's `[min, max]`
 * minutes, a hazard severity's dice. `band` beside the amount it fills, or beside `stated`, is `band_conflict`;
 * a row the table does not hold is `band_unknown`; `band` on any other kind is `band_none`. The receipt says
 * whose number it was: `basis: "banded"` with `band: <row>` and, for time, `band_roll: {min, max, total}`. A
 * book-stated amount is bound first (`stated.ts`) and wins; a band never fills a value the book states.
 */
import { STATED_FIELDS } from "../read/stated.js";
import { repr, string, type Row } from "../read/values.js";
import { BAND_FIELDS, BAND_KINDS, bandRows } from "../rules/bands.js";
import { tableSlug } from "../rules/tables.js";
import type { ApplyContext } from "./index.js";
import { refusalOf, type StatedEffect } from "./stated.js";

const refusal = refusalOf("band");

/** Bind `band` into a time or damage effect; an effect without `band` passes through untouched. */
export async function bindBand(context: ApplyContext, bound: StatedEffect): Promise<StatedEffect> {
    const effect = bound.effect, kind = string(effect.kind);
    if (effect.band == null)
        return bound;
    if (!BAND_KINDS.includes(kind))
        throw refusal("invalid_params", "band_none", `a ${kind} effect takes no band`, {
            fix: `leave band out; only ${BAND_KINDS.join(", ")} take one` });
    if (bound.stated)
        throw refusal("invalid_params", "band_conflict", `stated takes the amount from ${bound.stated}, and band would roll one; give one`, {
            fix: "leave band out to use the book's amount, or stated out to roll inside the band",
            details: { fields: ["stated"], stated: bound.stated } });
    const given = STATED_FIELDS[kind].filter(field => effect[field] != null);
    if (given.length)
        throw refusal("invalid_params", "band_conflict", `band rolls the ${kind} amount inside ${repr(effect.band)}, and ${given.join(", ")} is your own; give one`, {
            fix: `leave ${given.join(", ")} out to let the kernel roll inside the band, or band out to use your own`,
            details: { fields: given } });
    // The handle folds like every table name the kernel reads (case, spaces, hyphens): "Single Room Search" is single_room_search.
    const field = `${kind}.band`, rows = await bandRows(context.kernel, field), handle = tableSlug(effect.band);
    const chosen = rows.find(item => item.handle === handle);
    if (!chosen)
        throw refusal("unknown_entity", "band_unknown", `${repr(effect.band)} is not a row of ${BAND_FIELDS[field].table}`, {
            fix: "name one of details.options by its handle, or leave band out and give your own amount",
            details: { table: BAND_FIELDS[field].table, options: rows } });
    const next: Row = { ...effect };
    delete next.band;
    if (kind === "time") {
        // A row whose min is 0 may roll 0: the receipt and the event carry it, exactly as a Keeper's `minutes: 0` would.
        const min = chosen.min ?? 0, max = chosen.max ?? min, total = context.kernel.rng.randint(min, max);
        next.minutes = total;
        return { effect: next, stated: null, band: chosen.handle, bandRoll: { min, max, total } };
    }
    next.dice = chosen.dice ?? "";
    return { effect: next, stated: null, band: chosen.handle };
}
