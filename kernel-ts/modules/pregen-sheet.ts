/**
 * Contract §207.1: the shape of a pregenerated investigator's sheet, `properties.sheet` of an `investigator-template` node.
 *
 * The sheet is the starter pregens' shape (§174.1) holding only what the book's sheet prints. Accounting, not content:
 * no key is required, no value is judged plausible, and nothing here computes or fills a number. Names resolve against the
 * ruleset's own tables (§136.4), weapons are §136's weapon shape and a damage bonus is one of the ruleset's values; that is
 * the whole of the judgement. Refusals are data, as `mechanics-shape.ts`'s are, so the caller decides how to throw.
 */
import { integer, number, type Row } from "../read/values.js";
import { PythonFloat } from "../json.js";
import type { Refusal } from "./obligation-shape.js";
import { damageBonusResolves, nameResolves, weaponRefusals, type MechanicsRules } from "./mechanics-shape.js";

/** The node kind that may carry a sheet, and the property it sits in. */
export const SHEET_KIND = "investigator-template";
export const SHEET_PROPERTY = "sheet";
/** The sheet's keys, each optional. */
export const SHEET_KEYS: readonly string[] = Object.freeze(["name", "occupation", "age", "sex", "era", "residence", "birthplace", "own_language",
    "characteristics", "derived", "skills", "weapons", "equipment", "backstory", "cash"]);
const STRING_KEYS = ["name", "occupation", "sex", "era", "residence", "birthplace", "own_language", "cash"];
/** The starter pregens' characteristic keys: the eight of the rules and Luck, which an investigator's sheet prints. */
export const SHEET_CHARACTERISTICS: readonly string[] = Object.freeze(["STR", "CON", "SIZ", "DEX", "APP", "INT", "POW", "EDU", "LUCK"]);
/** The starter pregens' derived keys; `DB` is the printed string, `BUILD` may be negative. */
const DERIVED_COUNTS = ["HP", "SAN", "MP", "MOV"];
export const SHEET_DERIVED: readonly string[] = Object.freeze([...DERIVED_COUNTS, "BUILD", "DB"]);

const plain = (value: any): value is Row => value != null && typeof value === "object" && !Array.isArray(value) && !(value instanceof PythonFloat);
const text = (value: any): value is string => typeof value === "string" && Boolean(value.trim());
const count = (value: any): boolean => integer(value) && number(value) >= 0;
const repr = (value: any): string => JSON.stringify(value);
/** The JSON pointer token of one key. */
const token = (key: string): string => key.replace(/~/g, "~0").replace(/\//g, "~1");

/** Every refusal one sheet earns, each at a JSON pointer under `at`, the sheet's own pointer (`/nodes/<i>/properties/sheet`). */
export function pregenSheetRefusals(sheet: any, rules: MechanicsRules, at: string): Refusal[] {
    const refusals: Refusal[] = [];
    const refuse = (rule: string, path: string, message: string) => { refusals.push({ rule, path, message }); };
    if (!plain(sheet)) { refuse("sheet_shape", at, "a sheet is an object of the printed investigator's fields (contract 207.1)"); return refusals; }
    for (const key of Object.keys(sheet).filter(key => !SHEET_KEYS.includes(key)))
        refuse("sheet_unknown_key", `${at}/${token(key)}`, `a sheet carries only ${SHEET_KEYS.join(", ")}`);
    for (const key of STRING_KEYS.filter(key => Object.hasOwn(sheet, key)))
        if (!text(sheet[key])) refuse("sheet_shape", `${at}/${key}`, `${key} is the printed words, a non-empty string`);
    if (Object.hasOwn(sheet, "age") && !count(sheet.age)) refuse("sheet_shape", `${at}/age`, "age is the printed integer");
    if (Object.hasOwn(sheet, "characteristics")) {
        const value = sheet.characteristics, where = `${at}/characteristics`;
        if (!plain(value)) refuse("sheet_shape", where, `characteristics is {${SHEET_CHARACTERISTICS.join(", ")}: integer}`);
        else for (const [key, rating] of Object.entries(value)) {
            if (!SHEET_CHARACTERISTICS.includes(key)) refuse("sheet_unknown_key", `${where}/${token(key)}`, `characteristics carries only ${SHEET_CHARACTERISTICS.join(", ")} (Luck is LUCK)`);
            else if (!count(rating)) refuse("sheet_number", `${where}/${key}`, `${key} is the printed integer`);
        }
    }
    if (Object.hasOwn(sheet, "derived")) {
        const value = sheet.derived, where = `${at}/derived`;
        if (!plain(value)) refuse("sheet_shape", where, `derived is {${SHEET_DERIVED.join(", ")}}`);
        else for (const [key, rating] of Object.entries(value)) {
            if (!SHEET_DERIVED.includes(key)) refuse("sheet_unknown_key", `${where}/${token(key)}`, `derived carries only ${SHEET_DERIVED.join(", ")} (Luck is characteristics.LUCK)`);
            else if (key === "DB") { if (!damageBonusResolves(rules, rating)) refuse("sheet_number", `${where}/DB`, `DB is the printed damage bonus, one of the ruleset's values such as "0" or "+1D4", got ${repr(rating)}`); }
            else if (key === "BUILD" ? !integer(rating) : !count(rating)) refuse("sheet_number", `${where}/${key}`, `${key} is the printed integer`);
        }
    }
    if (Object.hasOwn(sheet, "skills")) {
        const value = sheet.skills, where = `${at}/skills`;
        if (!plain(value)) refuse("sheet_shape", where, "skills is {<the rules' name>: integer}");
        else for (const [name, rating] of Object.entries(value)) {
            if (!nameResolves(rules, "skills", name)) refuse("sheet_unknown_skill", `${where}/${token(name)}`, `${repr(name)} is not a skill of the ruleset; name the printed skill as the rules name it (contract 136.4)`);
            if (!count(rating)) refuse("sheet_number", `${where}/${token(name)}`, "a skill rating is the printed integer");
        }
    }
    if (Object.hasOwn(sheet, "weapons")) {
        const value = sheet.weapons, where = `${at}/weapons`;
        if (!Array.isArray(value)) refuse("sheet_shape", where, "weapons is a list of weapon shapes");
        // The weapon shape's own paths are dotted from the root it is given (`W.skill`); its keys have no dots.
        else value.forEach((weapon: any, index: number) => refusals.push(...weaponRefusals(weapon, rules, "W")
            .map(item => ({ ...item, path: `${where}/${index}${item.path.slice(1).split(".").map(token).join("/")}` }))));
    }
    if (Object.hasOwn(sheet, "equipment") && !(Array.isArray(sheet.equipment) && sheet.equipment.every(text)))
        refuse("sheet_shape", `${at}/equipment`, "equipment is the printed items, a list of strings");
    if (Object.hasOwn(sheet, "backstory")) {
        const value = sheet.backstory, where = `${at}/backstory`;
        if (!plain(value)) refuse("sheet_shape", where, "backstory is {<entry>: the printed words}");
        else for (const [key, words] of Object.entries(value))
            if (!(text(words) || Array.isArray(words) && words.length > 0 && words.every(text)))
                refuse("sheet_shape", `${where}/${token(key)}`, "a backstory entry is the printed words: a string or a list of strings");
    }
    return refusals;
}
