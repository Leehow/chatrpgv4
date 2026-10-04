/**
 * A creature this table declares, and the stat block it pins from the rules catalog (contract §180.6).
 *
 * `apply npc {name, walk_on: true, creature: "<catalog creature>" | true}` brings in the Keeper's own animal or monster as
 * a creature; `apply npc {name, creature: "<catalog creature>"}` pins a block later on a creature that has none. Which
 * catalog entry fits is the Keeper's judgement from what the animal is; nothing here maps a word to an entry. The entry is
 * found by the catalog's own name matching (`Catalog.resolveName`, the one `table.lookup kind=catalog` answers with).
 *
 * The block is built from the entry alone: a characteristic the entry gives as a roll expression (the beasts' `2D6 x5`) is
 * rolled with the turn's seeded dice, as §34.10's archetypes are; otherwise its average is used. A value the entry states
 * -- hit points, armor, Move, damage bonus, build -- is kept as stated; the rest is derived through the tables §34.10
 * reads. Its attacks become weapons through `engineWeapon`, its `san_loss` becomes `sanity_loss`. Nothing is filled from
 * habit: what the entry does not print stays absent or `_unstated`.
 */
import { RpcError } from "../errors.js";
import type { KernelContext } from "../context.js";
import { isJsonObject } from "../json.js";
import { engineWeapon } from "../combat/profiles.js";
import { definitionExpression } from "../mods/definition.js";
import { tableCreatureId } from "../read/table-creatures.js";
import { array, integer, kebab, normalize, number, repr, row, string, truth, type Row } from "../read/values.js";
import { rollExpression } from "../resolve/arithmetic.js";
import { Catalog, CREATURE_SOURCES } from "../rules/catalog.js";
import { CHARACTERISTICS } from "../rules/skills.js";
import { RuleTables } from "../rules/tables.js";
import { validateSanLossExpression } from "../sanity/expression.js";
import { nowIso } from "../write/store.js";
import { movement } from "./archetype.js";
import type { ApplyContext } from "./index.js";

/** What an effect's `creature` declares: a catalog entry (and whether it prints a stat block), or `true` for none yet. */
export interface CreatureDeclaration {
    /** The entry's canonical name; null for `creature: true`. */
    readonly name: string | null;
    /** The table the entry was read from (`beasts.json`, `monsters.json`); null for `creature: true`. */
    readonly table: string | null;
    readonly entry: Row;
    /** True when the declaration pins a stat block: an entry that prints one. `true` and a `no_stat_block` entry do not. */
    readonly block: boolean;
}

/** The catalog's creature names, in its order: the options an unknown name is refused with. */
export async function catalogCreatureNames(kernel: KernelContext): Promise<string[]> {
    return (await new Catalog(new RuleTables(kernel)).records(["creature"])).map(record => string(record.name));
}

/** Read and resolve `effect.creature`; null when the effect carries none. An unknown entry is refused with the options. */
export async function creatureDeclaration(kernel: KernelContext, effect: Row): Promise<CreatureDeclaration | null> {
    const value = effect.creature;
    if (value == null)
        return null;
    if (value === true)
        return { name: null, table: null, entry: {}, block: false };
    if (typeof value !== "string" || !value.trim())
        throw new RpcError("invalid_params", "npc.creature must name a rules-catalog creature, or be true", {
            fix: "name the rules-catalog creature this animal or monster is (lookup kind=catalog kinds=[\"creature\"]), or true for one with no stat block yet",
            details: { field: "npc.creature" } });
    const tables = new RuleTables(kernel), catalog = new Catalog(tables), query = value.trim();
    const found = await catalog.resolveName("creature", query);
    if (!found)
        throw new RpcError("invalid_params", `${repr(query)} is not a creature of the rules catalog`, {
            fix: "name one of details.options exactly, the one this animal or monster is; or creature: true for one with no stat block yet",
            details: { field: "npc.creature", query, options: await catalogCreatureNames(kernel) } });
    const name = string(found.canonical_name), table = string(row(row(found.record).source).table);
    const source = CREATURE_SOURCES.find(item => `${item.name}.json` === table);
    const entry = source ? row((await tables.block(source.name, source.key))[name]) : {};
    return { name, table, entry, block: Object.keys(entry).length > 0 && entry.no_stat_block !== true };
}

/**
 * §180.6's record of a creature this table declared, and its graph projection. Idempotent on the name. Never
 * `world.table_people`: no person consumer meets it.
 */
export function establishCreature(context: Pick<ApplyContext, "graph" | "world" | "turn">, name: string, why: string | null, declared: CreatureDeclaration): Row {
    const { graph, world } = context, trimmed = name.trim(), creatures = array(world.table_creatures ??= []);
    const catalog = declared.name ? { catalog: declared.name } : {};
    const node = graph.addTableCreature(tableCreatureId(trimmed), trimmed, { reason: why, turn: context.turn.turn, ...catalog });
    if (!creatures.some(creature => normalize(string(row(creature).name)) === normalize(trimmed)))
        creatures.push({ name: trimmed, turn: context.turn.turn, why, established_at: nowIso(), ...catalog });
    return node;
}

/** A dice string the ruleset's grammar reads (§136.3: at least one die), canonical; null otherwise. */
function dice(text: string): string | null {
    try {
        const value = definitionExpression(text, "damage");
        return /D/.test(value) ? value : null;
    }
    catch (error) {
        if (error instanceof RpcError)
            return null;
        throw error;
    }
}

/**
 * An attack's damage as the engine reads it: the dice, whether the damage bonus is added, and whether only half of it.
 * A beast carries the reading already (`damage_dice`, `adds_damage_bonus`: full, half or none). A monster prints one
 * string, read by the ruleset's dice grammar and its `DB` notation for the damage bonus (§136.3). A damage that is the
 * bonus alone has no dice (`"0"`). Anything else -- "varies", "special: crush", a rider like "+ poison" -- is not read.
 */
function attackDamage(attack: Row): { damage: string; adds: boolean; half: boolean } | null {
    const bonus = attack.adds_damage_bonus;
    if (typeof bonus === "string") {
        if (!["full", "half", "none"].includes(bonus))
            return null;
        const read = typeof attack.damage_dice === "string" ? dice(attack.damage_dice) : null;
        if (read === null && (typeof attack.damage_dice === "string" || bonus === "none"))
            return null;
        return { damage: read ?? "0", adds: bonus !== "none", half: bonus === "half" };
    }
    if (typeof attack.damage !== "string")
        return null;
    const terms = attack.damage.replace(/\s+/gu, "").split("+").filter(Boolean);
    const adds = terms.some(term => term.toUpperCase() === "DB"), rest = terms.filter(term => term.toUpperCase() !== "DB").join("+");
    if (!terms.length)
        return null;
    const read = rest ? dice(rest) : "0";
    return read === null ? null : { damage: read, adds, half: false };
}

/**
 * One printed attack as a weapon the engine reads (§136.12's `engineWeapon`). Every attack in the rulebook's creature
 * blocks is a Fighting attack, a maneuver included, so the engine rolls it with the block's Fighting; the attack's own
 * printed percentage rides along as `skill_value`. A damage that cannot be read leaves the weapon without one: the engine
 * will not swing it, and `damage_printed` says what the book prints.
 */
function attackWeapon(attack: Row, index: number, perRound: number | null, used: Set<string>): Row {
    const name = string(attack.weapon ?? "").trim() || `attack ${index + 1}`, base = kebab(name) || "attack";
    let id = base;
    for (let n = 2; used.has(id); n++)
        id = `${base}-${n}`;
    used.add(id);
    const printed = typeof attack.damage === "string" ? attack.damage.trim() : "", read = attackDamage(attack);
    return engineWeapon({
        weapon_id: id, name, skill: "Fighting",
        ...(read ? { damage: read.damage, adds_damage_bonus: read.adds, ...(read.half ? { special: "half damage bonus" } : {}) } : { damage_unstated: true }),
        ...(perRound !== null ? { uses_per_round: perRound } : { uses_per_round_unstated: true }),
        impale_unstated: true,
        ...(integer(attack.skill) ? { skill_value: number(attack.skill) } : {}),
        ...(attack.maneuver === true ? { maneuver: true } : {}),
        ...(attack.poison === true ? { poison: true } : {}),
        ...(printed && printed !== read?.damage ? { damage_printed: printed } : {}),
        ...(typeof attack.note === "string" && attack.note.trim() ? { note: attack.note.trim() } : {}),
    });
}

/** A printed Sanity half the sanity engine reads (`"0"`, or its loss grammar); null otherwise. */
function sanityHalf(value: unknown): string | null {
    if (typeof value !== "string")
        return null;
    const text = value.trim().toUpperCase();
    if (text === "0")
        return text;
    try {
        validateSanLossExpression(text);
        return text;
    }
    catch (error) {
        if ((error as Error).name === "ValueError")
            return null;
        throw error;
    }
}

/** The entry's `san_loss` as §136.6's `sanity_loss`; a half the engine cannot read is `_unstated`, the Keeper's to give. */
function sanityLoss(value: unknown): Row | null {
    if (!isJsonObject(value))
        return null;
    const success = sanityHalf(value.success), failure = sanityHalf(value.failure);
    return { ...(success !== null ? { success } : { success_unstated: true }), ...(failure !== null ? { failure } : { failure_unstated: true }) };
}

/** Build the stat block of a catalog entry that prints one; the result has everything `npcCombatParticipant` reads. */
export async function rollCreatureProfile(kernel: KernelContext, creature: CreatureDeclaration, why: string | null, turn: number): Promise<Row> {
    const tables = new RuleTables(kernel), entry = creature.entry, rolls = row(entry.rolls);
    const characteristics: Row = {}, rolled: string[] = [];
    for (const key of Object.keys(CHARACTERISTICS)) {
        const field = key.toLowerCase(), roll = row(rolls[field]);
        let value: number | null = null;
        if (typeof roll.dice === "string" && integer(roll.times)) {
            try {
                value = number(rollExpression(roll.dice, kernel.rng).total) * number(roll.times);
                rolled.push(key);
            }
            catch (error) {
                if ((error as Error).name !== "ValueError")
                    throw error;
            }
        }
        if (value === null && integer(entry[field]))
            value = number(entry[field]);
        if (value !== null)
            characteristics[key] = value;
    }
    const known = (...keys: string[]): boolean => keys.every(key => integer(characteristics[key]));
    const rules = row(await tables.load("derived-attributes")), hp = row(rules.hit_points), mp = row(rules.magic_points);
    const derived: Row = {};
    const hpSources = array(hp.sources).map(string);
    if (integer(entry.hp))
        derived.HP = number(entry.hp);
    else if (hpSources.length && known(...hpSources))
        derived.HP = Math.floor(hpSources.map(source => number(characteristics[source])).reduce((a, b) => a + b, 0) / number(hp.divisor || 10));
    const mpSource = string(mp.source || "POW");
    if (known(mpSource))
        derived.MP = Math.floor(number(characteristics[mpSource]) / number(mp.divisor || 5));
    if (integer(entry.mov))
        derived.MOV = number(entry.mov);
    else if (known("STR", "DEX", "SIZ"))
        derived.MOV = await movement(tables, characteristics);
    const statedBonus = typeof entry.damage_bonus === "string" && entry.damage_bonus.trim() ? entry.damage_bonus.trim() : null;
    const statedBuild = integer(entry.build) ? number(entry.build) : null;
    let table: Row = {};
    if ((statedBonus === null || statedBuild === null) && known("STR", "SIZ")) {
        try {
            table = await tables.damageBonusBuild(number(characteristics.STR), number(characteristics.SIZ));
        }
        catch (error) {
            if ((error as Error).name !== "ValueError")
                throw error;
        }
    }
    if (statedBonus !== null || table.damage_bonus != null)
        derived.DB = statedBonus ?? table.damage_bonus;
    if (statedBuild !== null || table.build != null)
        derived.Build = statedBuild ?? table.build;
    const attacks = array(entry.attacks).filter(isJsonObject), skills: Row = {};
    const fighting = attacks.find(attack => integer(attack.skill));
    if (fighting)
        skills.Fighting = number(fighting.skill);
    if (integer(row(entry.dodge).skill))
        skills.Dodge = number(row(entry.dodge).skill);
    for (const skill of array(entry.skills).filter(isJsonObject))
        if (typeof skill.name === "string" && skill.name.trim() && integer(skill.pct))
            skills[skill.name.trim()] = number(skill.pct);
    const perRound = integer(entry.attacks_per_round) ? number(entry.attacks_per_round) : null, used = new Set<string>();
    const weapons = attacks.map((attack, index) => attackWeapon(attack, index, perRound, used));
    // A weapon with damage first: the engine swings an NPC's first weapon when nobody names one.
    weapons.sort((a, b) => Number(!truth(a.damage)) - Number(!truth(b.damage)));
    const sanity = sanityLoss(entry.san_loss);
    return {
        profile_kind: "actor", characteristic_scale: "percentile", authority: "table_pinned", catalog: creature.name,
        source: { table: creature.table, ...(integer(entry.source_page) ? { page: number(entry.source_page) } : {}) },
        characteristics, ...(rolled.length ? { rolled } : {}), derived, skills, weapons,
        ...(integer(entry.armor) ? { armor: number(entry.armor) } : entry.armor_unstated === true ? { armor_unstated: true } : {}),
        ...(sanity ? { sanity_loss: sanity } : {}),
        ...(truth(why) ? { why } : {}), pinned_turn: turn
    };
}
