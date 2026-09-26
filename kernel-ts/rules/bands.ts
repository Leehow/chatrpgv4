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
import { compareUnicode } from "../json.js";
import { array, entries, integer, normalize, number, row, similarity, string, truth, type Row } from "../read/values.js";
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

/** A weapons-band row as the host's profile question reads it (§138.6, §138.7); host-only detail, never named by a `fix`. */
export type WeaponBandProfile = {
    id: string;
    name: string;
    skill: string;
    damage: string | null;
    range: number | null;
};

/** The key a weapon name is matched by: folded like every table name, with a `weapon:` or `item:` prefix dropped. */
function weaponKey(query: string): string {
    let key = normalize(query);
    for (const prefix of ["weapon:", "item:"])
        if (key.startsWith(prefix))
            key = key.slice(prefix.length);
    return key;
}
const weaponNames = (id: string, entry: Row): Set<string> =>
    new Set([normalize(id), ...["display_name", "name"].filter(field => typeof entry[field] === "string").map(field => normalize(entry[field]))]);

/** The weapons-band row a name or id names exactly (`weapon_id` set), or null. */
export function weaponRowNamed(catalog: Iterable<[string, Row]>, query: string): Row | null {
    const key = weaponKey(query);
    for (const [id, entry] of catalog)
        if (weaponNames(id, entry).has(key))
            return { ...entry, weapon_id: id };
    return null;
}

/**
 * The weapons band's rows offered for a name that named none: the ids the era allows (a row without `eras` is
 * every era's), up to six ids closest to the name, and the profiles behind the offered ids. One reading for the
 * kernel's `needs {field: "weapon"}` refusal (§138.6) and the definition job's preset offer (§138.7), so the host's
 * question sees the same rows from both.
 */
export function weaponBandOptions(catalog: Iterable<[string, Row]>, era: string, query: string): { options: string[]; close: string[]; profiles: WeaponBandProfile[] } {
    const rows = [...catalog], key = weaponKey(query), byName = new Map<string, string>();
    for (const [id, entry] of rows)
        for (const name of weaponNames(id, entry))
            byName.set(name, id);
    const options = rows.filter(([, entry]) => !era || !truth(entry.eras) || array(entry.eras).includes(era)).map(([id]) => id), close: string[] = [];
    const matching = [...byName.keys()].map(name => ({ name, score: similarity(key, name) })).filter(value => value.score >= 0.5)
        .sort((a, b) => b.score - a.score || compareUnicode(b.name, a.name)).slice(0, 12);
    for (const { name } of matching)
        if (!close.includes(byName.get(name)!))
            close.push(byName.get(name)!);
    const byId = new Map(rows);
    const profiles = options.map(id => {
        const entry = row(byId.get(id));
        return { id, name: string(entry.display_name || id), skill: string(entry.skill || ""), damage: typeof entry.damage_die === "string" ? entry.damage_die : null,
            range: typeof entry.base_range_yards === "number" ? entry.base_range_yards : null };
    });
    return { options, close: close.slice(0, 6), profiles };
}
