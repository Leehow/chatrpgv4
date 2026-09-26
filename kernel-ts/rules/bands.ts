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
import { ROUTE_TRAVEL_FIELD, ROUTE_TRAVEL_ROWS, ROUTE_TRAVEL_TABLE } from "../modules/route-travel.js";

export interface BandTable {
    /** The rules-json table (its stem) and the block whose keys are the rows. */
    readonly table: string;
    readonly block: string;
    /**
     * What a row supplies: a `[min, max]` to roll in, a dice expression to roll, per-stat ranges, a whole profile, or
     * the row's `default` taken as it stands (a road's minutes, §138.9: the one band that is not rolled).
     */
    readonly supplies: "range" | "dice" | "ranges" | "profile" | "default";
    /** The Jev primitive a host asks the rows with (spec D2): kinds of situation are a Choice, an ordered ladder a Score. */
    readonly primitive: "choice" | "score";
    /** The rows of the block this field may name, when it is not all of them. */
    readonly rows?: readonly string[];
}

/** `<effect kind>.<field>` (or, for a road, `<relation kind>.<property>`) → the band table that field names. */
export const BAND_FIELDS: Readonly<Record<string, BandTable>> = Object.freeze({
    "time.band": { table: "time-costs", block: "categories", supplies: "range", primitive: "choice" },
    "damage.band": { table: "hazards", block: "severity", supplies: "dice", primitive: "score" },
    "npc.archetype": { table: "npc-stat-archetypes", block: "archetypes", supplies: "ranges", primitive: "choice" },
    "item.weapon": { table: "weapons", block: "weapons", supplies: "profile", primitive: "choice" },
    // §138.9 (BR-05): a road's minutes, filled once at build from the host's band; never offered per turn.
    [ROUTE_TRAVEL_FIELD]: { ...ROUTE_TRAVEL_TABLE, supplies: "default", primitive: "choice", rows: ROUTE_TRAVEL_ROWS },
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
    if (!spec || (spec.supplies !== "range" && spec.supplies !== "dice" && spec.supplies !== "default"))
        return [];
    const block = await new RuleTables(kernel).block(spec.table, spec.block, true);
    const broken = (handle: string, what: string): never => {
        throw new RpcError("campaign_not_ready", `${spec.table}.${spec.block}.${handle} is not ${what}`, {
            fix: `restore content/rulesets/coc7/rules-json/${spec.table}.json`, details: { table: spec.table, row: handle } });
    };
    const rows: BandRow[] = [];
    for (const [handle, value] of entries(block)) {
        if (spec.rows && !spec.rows.includes(handle))
            continue;
        const item = row(value);
        if (spec.supplies === "range" || spec.supplies === "default") {
            if (!integer(item.min) || !integer(item.max) || number(item.min) < 0 || number(item.min) > number(item.max))
                broken(handle, "a min/max range");
            if (spec.supplies === "default" && (!integer(item.default) || number(item.default) < number(item.min) || number(item.default) > number(item.max)))
                broken(handle, "a range with a default inside it");
            rows.push({ handle, min: number(item.min), max: number(item.max), ...(integer(item.default) ? { default: number(item.default) } : {}) });
        }
        else {
            if (typeof item.damage_expr !== "string" || !item.damage_expr.trim())
                broken(handle, "a dice expression");
            rows.push({ handle, dice: string(item.damage_expr).trim().toUpperCase(), ...(typeof item.note === "string" ? { note: item.note } : {}) });
        }
    }
    for (const handle of spec.rows ?? [])
        if (!rows.some(item => item.handle === handle))
            broken(handle, "present");
    if (!rows.length)
        broken("*", "a table with any row");
    return rows;
}
