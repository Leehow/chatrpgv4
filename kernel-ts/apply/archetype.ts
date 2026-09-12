/** A stat block for a person the book never gave one (docs/specs/turn-floor.md, contract §34.10).
 *  The rulebook's `npc-stat-archetypes.json` authors three tiers of ranges; the Keeper names the tier
 *  from who the person is, and the kernel rolls inside the ranges with the turn's seeded dice and
 *  derives the rest through the same tables an investigator's sheet uses. Nothing here reads a
 *  name, a trade or a description: which tier fits is the Keeper's judgement, never a table's. */
import { RpcError } from "../errors.js";
import type { KernelContext } from "../context.js";
import { RuleTables } from "../rules/tables.js";
import { array, row, entries, number, integer, string, truth, type Row } from "../read/values.js";
const TABLE = "npc-stat-archetypes";
export interface Archetype { id: string; characteristics: Record<string, [number, number]>; skills: Record<string, [number, number]> }
const range = (value: any): [number, number] | null => Array.isArray(value) && value.length === 2 && integer(value[0]) && integer(value[1]) && number(value[0]) <= number(value[1]) ? [number(value[0]), number(value[1])] : null;
export async function archetypes(kernel: KernelContext): Promise<Archetype[]> {
    const tables = new RuleTables(kernel);
    if (!await tables.exists(TABLE))
        return [];
    return array(row(await tables.load(TABLE)).archetypes).filter(item => typeof item.archetype_id === "string" && item.archetype_id.trim()).map(item => ({
        id: string(item.archetype_id),
        characteristics: Object.fromEntries(entries(row(item.characteristics)).flatMap(([key, value]) => { const r = range(value); return r ? [[key, r]] : []; })),
        skills: Object.fromEntries(entries(row(item.skills)).flatMap(([key, value]) => { const r = range(value); return r ? [[key, r]] : []; }))
    }));
}
export const archetypeIds = async (kernel: KernelContext): Promise<string[]> => (await archetypes(kernel)).map(a => a.id);
async function movement(tables: RuleTables, characteristics: Row): Promise<number> {
    const table = row(await tables.load("movement-rate")), siz = number(characteristics.SIZ);
    const relation = (value: number): string => value < siz ? "less_than" : value > siz ? "greater_than" : "equal";
    for (const item of array(table.rules))
        if (["any", relation(number(characteristics.STR))].includes(string(item.str_relation_to_siz)) && ["any", relation(number(characteristics.DEX))].includes(string(item.dex_relation_to_siz)))
            return number(item.base_mov);
    return 8;
}
/** Roll a profile inside the archetype's ranges; the result has everything `npcCombatParticipant` reads. */
export async function rollArchetypeProfile(kernel: KernelContext, id: string, why: string | null, turn: number): Promise<Row> {
    const found = (await archetypes(kernel)).find(a => a.id === id);
    if (!found)
        throw new RpcError("invalid_params", `${JSON.stringify(id)} is not an NPC stat archetype`, {
            fix: "name one of details.options, chosen from who this person is: ordinary_adult for someone who has never had to fight, capable_adult for someone fit or trained, dangerous_actor for someone whose trade is violence",
            details: { field: "npc.archetype", options: await archetypeIds(kernel) }
        });
    const tables = new RuleTables(kernel), characteristics: Row = {}, skills: Row = {};
    for (const [key, [lo, hi]] of Object.entries(found.characteristics))
        characteristics[key] = kernel.rng.randint(lo, hi);
    for (const [key, [lo, hi]] of Object.entries(found.skills))
        skills[key] = kernel.rng.randint(lo, hi);
    for (const key of ["STR", "CON", "SIZ", "DEX", "POW"])
        if (!Object.hasOwn(characteristics, key))
            throw new RpcError("campaign_not_ready", `archetype ${id} declares no ${key} range`, { fix: `restore content/rulesets/coc7/rules-json/${TABLE}.json`, details: { archetype: id, missing: key } });
    const derivedRules = row(await tables.load("derived-attributes")), hp = row(derivedRules.hit_points), mp = row(derivedRules.magic_points), san = row(derivedRules.sanity);
    const damage = await tables.damageBonusBuild(number(characteristics.STR), number(characteristics.SIZ));
    const derived: Row = {
        HP: Math.floor(array(hp.sources).map(source => number(characteristics[string(source)])).reduce((a, b) => a + b, 0) / number(hp.divisor || 10)),
        MP: Math.floor(number(characteristics[string(mp.source || "POW")]) / number(mp.divisor || 5)),
        SAN: number(characteristics[string(san.source || "POW")]),
        MOV: await movement(tables, characteristics),
        DB: damage.damage_bonus,
        Build: damage.build
    };
    return {
        profile_kind: "actor", characteristic_scale: "percentile", authority: "table_pinned", archetype: id,
        characteristics, derived, skills, weapons: [],
        ...(truth(why) ? { why } : {}), pinned_turn: turn
    };
}
