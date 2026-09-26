/**
 * Contract §138 (BR-01 of docs/specs/band-then-roll.md): the band registry.
 *
 * A band table is a rules-json table whose rows each carry a range. A Keeper or a clerk names a row instead of a
 * number, and the kernel rolls the number inside the row with its seeded dice. This registry is the closed list
 * of the tables and the field each binds: nothing scans rules-json for ranges, and a table is a band table only
 * when it is written here. Archetype tiers and weapon profiles are bound through their existing fields and
 * readers (`apply/archetype.ts`, `apply/inventory.ts`); `time.band` and `damage.band` are resolved from here.
 */
import type { KernelContext } from "../context.js";
import { RpcError } from "../errors.js";
import { entries, integer, number, row, string, type Row } from "../read/values.js";
import { RuleTables } from "./tables.js";

export interface BandTable {
    /** The rules-json table (its stem) and the block whose keys are the rows. */
    readonly table: string;
    readonly block: string;
    /** What a row supplies: a `[min, max]` to roll in, a dice expression to roll, per-stat ranges, or a whole profile. */
    readonly supplies: "range" | "dice" | "ranges" | "profile";
    /** The Jev primitive a host asks the rows with (spec D2): kinds of situation are a Choice, an ordered ladder a Score. */
    readonly primitive: "choice" | "score";
}

/** `<effect kind>.<field>` → the band table that field names. */
export const BAND_FIELDS: Readonly<Record<string, BandTable>> = Object.freeze({
    "time.band": { table: "time-costs", block: "categories", supplies: "range", primitive: "choice" },
    "damage.band": { table: "hazards", block: "severity", supplies: "dice", primitive: "score" },
    "npc.archetype": { table: "npc-stat-archetypes", block: "archetypes", supplies: "ranges", primitive: "choice" },
    "item.weapon": { table: "weapons", block: "weapons", supplies: "profile", primitive: "choice" },
});

/** The effect kinds whose `band` field the kernel resolves (§138.2). */
export const BAND_KINDS: readonly string[] = Object.freeze(
    Object.keys(BAND_FIELDS).filter(key => key.endsWith(".band")).map(key => key.split(".")[0]));

/** One row of a band table, as the kernel lists it in `details.options` and rolls from it. */
export interface BandRow {
    readonly handle: string;
    readonly min?: number;
    readonly max?: number;
    readonly default?: number;
    readonly dice?: string;
    readonly note?: string;
}

/** The rows of the band table a `band` field names, in the table's order; a malformed row fails loudly. */
export async function bandRows(kernel: KernelContext, field: string): Promise<BandRow[]> {
    const spec = BAND_FIELDS[field];
    if (!spec || (spec.supplies !== "range" && spec.supplies !== "dice"))
        return [];
    const block = await new RuleTables(kernel).block(spec.table, spec.block, true);
    const broken = (handle: string, what: string): never => {
        throw new RpcError("campaign_not_ready", `${spec.table}.${spec.block}.${handle} is not ${what}`, {
            fix: `restore content/rulesets/coc7/rules-json/${spec.table}.json`, details: { table: spec.table, row: handle } });
    };
    const rows: BandRow[] = [];
    for (const [handle, value] of entries(block)) {
        const item = row(value);
        if (spec.supplies === "range") {
            if (!integer(item.min) || !integer(item.max) || number(item.min) < 0 || number(item.min) > number(item.max))
                broken(handle, "a min/max range");
            rows.push({ handle, min: number(item.min), max: number(item.max), ...(integer(item.default) ? { default: number(item.default) } : {}) });
        }
        else {
            if (typeof item.damage_expr !== "string" || !item.damage_expr.trim())
                broken(handle, "a dice expression");
            rows.push({ handle, dice: string(item.damage_expr).trim().toUpperCase(), ...(typeof item.note === "string" ? { note: item.note } : {}) });
        }
    }
    if (!rows.length)
        broken("*", "a table with any row");
    return rows;
}
