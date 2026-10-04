/**
 * Contract §180.6 (CK-F2): an authored stat block that lacks what the engine reads, completed from the rules.
 *
 * A block the book or an authored gym states only in part (Mystery House's chapel familiar states skills and no
 * characteristics) made its being an actor that no fight could be built against. The completion is the call the
 * refusal names: a rules-catalog creature for a creature (`apply npc {name, creature}`), an archetype for a person
 * (`apply npc {name, archetype}`). The source builds its block exactly as it builds a fresh pin -- every roll is rolled,
 * so the dice run as they would -- except that a characteristic the authored block states stands in for the rolled one
 * before anything is derived from it; then every value the authored block states wins over the built one. The result
 * is pinned like any table pin, and records where it came from: `completed_from` (the entry or the archetype) and
 * `filled` (the paths the source supplied). Everything else in it is the authored block's.
 */
import { isJsonObject } from "../json.js";
import { engineWeapon } from "../combat/profiles.js";
import { array, clone, entries, integer, number, row, string, type Row } from "../read/values.js";

/** Keys of the built block that are its source's provenance, not numbers; never taken from the authored block. */
const PROVENANCE = new Set(["authority", "catalog", "archetype", "source", "rolled", "why", "pinned_turn", "completed_from", "filled"]);
/** Keys both blocks carry to say what kind of block they are: the authored one wins, and they are never "filled". */
const FORM = new Set(["profile_kind", "characteristic_scale"]);
/** The four maps the completion merges key by key. */
const MAPS = new Set(["characteristics", "derived", "skills", "weapons"]);

/** The characteristics an authored block states, as integers: they stand in for the rolled ones before derivation. */
export function statedCharacteristics(authored: Row | null): Row {
    return Object.fromEntries(entries(row(authored?.characteristics)).filter(([, value]) => integer(value)).map(([key, value]) => [key, number(value)]));
}

/** A weapon's identity for "weapons by id": its id, else its name. */
const weaponKey = (weapon: unknown): string => isJsonObject(weapon) ? string(weapon.weapon_id || weapon.name || "") : string(weapon);

/**
 * `built` (the source's block, its characteristics already carrying the authored ones) under `authored`: every value
 * the authored block states wins -- characteristics, derived values and skills by key, weapons by id, any other key
 * whole -- and `filled` lists, as paths, what the source supplied. An authored `<key>_unstated` says the book does not
 * give `<key>`, so it gives way to a value the source supplies.
 */
export function completeBlock(built: Row, authored: Row, source: string): Row {
    const filled: string[] = [], block: Row = {};
    for (const [key, value] of entries(built))
        if (!MAPS.has(key))
            block[key] = clone(value);
    const stated = statedCharacteristics(authored);
    // The built block's characteristics already carry the stated ones (they stood in before derivation); anything else
    // the authored map carries that is not a number stays only beside them.
    const characteristics: Row = clone(row(built.characteristics));
    for (const [key, value] of entries(row(authored.characteristics)))
        if (!Object.hasOwn(characteristics, key))
            characteristics[key] = clone(value);
    filled.push(...Object.keys(row(built.characteristics)).filter(key => !Object.hasOwn(stated, key)).map(key => `characteristics.${key}`));
    for (const field of ["derived", "skills"]) {
        const own = row(authored[field]), merged: Row = { ...clone(row(built[field])), ...clone(own) };
        filled.push(...Object.keys(row(built[field])).filter(key => !Object.hasOwn(own, key)).map(key => `${field}.${key}`));
        block[field] = merged;
    }
    // The book's weapons are weapon shapes; a pinned block carries the engine's spelling of them (§136.12).
    const ownWeapons = array(authored.weapons).map(weapon => isJsonObject(weapon) ? engineWeapon(weapon) : clone(weapon));
    const ownIds = new Set(ownWeapons.map(weaponKey).filter(Boolean));
    const supplied = array(built.weapons).filter(weapon => !ownIds.has(weaponKey(weapon)));
    filled.push(...supplied.map(weapon => `weapons.${weaponKey(weapon)}`));
    block.characteristics = characteristics;
    block.weapons = [...ownWeapons, ...supplied.map(clone)];
    for (const [key, value] of entries(authored)) {
        if (MAPS.has(key) || PROVENANCE.has(key))
            continue;
        if (key.endsWith("_unstated")) {
            if (!Object.hasOwn(block, key.slice(0, -"_unstated".length)))
                block[key] = clone(value);
            continue;
        }
        block[key] = clone(value);
        delete block[`${key}_unstated`];
    }
    for (const key of Object.keys(built))
        if (!MAPS.has(key) && !PROVENANCE.has(key) && !FORM.has(key) && !key.endsWith("_unstated") && !Object.hasOwn(authored, key))
            filled.push(key);
    if (Array.isArray(block.rolled)) {
        const rolled = block.rolled.filter((key: unknown) => !Object.hasOwn(stated, string(key)));
        if (rolled.length) block.rolled = rolled;
        else delete block.rolled;
    }
    return { ...block, completed_from: source, filled };
}
