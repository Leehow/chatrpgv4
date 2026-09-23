/** Skill/characteristic aliases and target reads from the existing rules vocabulary. */
import { isJsonObject, compareUnicode } from "../json.js";
import { array, row, entries, values, number, integer, normalizeText, similarity, string, repr, length, type Row } from "../read/values.js";
import { RuleTables } from "./tables.js";
export const CHARACTERISTICS: Readonly<Record<string, string>> = Object.freeze({
    STR: "Strength",
    DEX: "Dexterity",
    INT: "Intelligence",
    POW: "Power",
    CON: "Constitution",
    APP: "Appearance",
    SIZ: "Size",
    EDU: "Education",
    LUCK: "Luck",
});
const PAREN = /^(.*?)\s*[\uFF08(]\s*(.*?)\s*[)\uFF09]\s*$/u;
const latin = (value: string): boolean => /[a-z0-9]/.test(value);
const localized = (entry: any): string[] => values(row(entry).localized_labels).filter(value => typeof value === "string" && value.trim());
const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function missing(value: string): never {
    const error = new Error(repr(value));
    error.name = "KeyError";
    throw error;
}
/** One specialization of one group skill, as the rules table declares the group (§52).
 *  `member` is the specialization's own name; `canonical` is the skill identity it names. */
export interface Specialization {
    canonical: string;
    group: string;
    member: string;
    base: any;
}
/** The declared group a phrase names, matched on the group's own name. */
function declaredGroup(groups: Row, text: string): [string, Row] | null {
    const key = normalizeText(text);
    for (const [name, entry] of entries(groups))
        if (normalizeText(name) === key)
            return [name, row(entry)];
    return null;
}
/** The identity a group and one member spell together. A group whose own name already carries a
 *  parenthesis keeps the rulebook's nested form (`Language (Other: French)`); every other group
 *  spells `Group (Member)`, which is exactly how the catalog writes the rows it does carry. */
function specializationName(group: string, member: string): string {
    const parts = PAREN.exec(group);
    return parts ? `${parts[1]} (${parts[2]}: ${member})` : `${group} (${member})`;
}
/** The catalog row that already is this specialization, if the catalog carries one. The catalog
 *  registers some specializations under the group's spelling (`Science (Biology)`) and some under
 *  the member's own (`Medicine`, whose declared group is Science); neither may be shadowed by a
 *  second identity, or a sheet value would sit behind a name nothing resolves to. */
function catalogSpecialization(tableSkills: Row, group: string, member: string): string | null {
    const spelled = normalizeText(specializationName(group, member)), bare = normalizeText(member);
    for (const [name, entry] of entries(tableSkills)) {
        if (normalizeText(name) === spelled)
            return name;
        if (normalizeText(name) === bare && normalizeText(string(row(entry).group)) === normalizeText(group))
            return name;
    }
    return null;
}
/** Read `Group (Member)` -- or the same words without the parenthesis -- against the declared
 *  groups. A group that enumerates its members admits only those; a group the rulebook leaves
 *  open (`"open": true`, the terrain of Survival) admits whatever the investigator named. Returns
 *  null when the phrase names no declared group, or a member an enumerating group never declared:
 *  the specializations a group has are the rules table's answer, never this file's (§52). */
export function specializationIdentity(groups: Row, tableSkills: Row, text: string): Specialization | null {
    const phrase = string(text).trim();
    if (!phrase)
        return null;
    const parts = PAREN.exec(phrase), key = normalizeText(phrase);
    const found = (group: string, entry: Row, member: string): Specialization | null => {
        const declared = entry.specializations, base = Array.isArray(declared) || declared == null ? entry.base_chance : null;
        const members: Array<[string, any]> = Array.isArray(declared) ? declared.map(value => [string(value), entry.base_chance])
            : isJsonObject(declared) ? entries(declared) : [];
        const match = members.find(([name]) => normalizeText(name) === normalizeText(member));
        if (!match && !(declared == null && entry.open === true))
            return null;
        const name = match ? match[0] : string(member).trim(), chance = match ? match[1] : base;
        return {canonical: catalogSpecialization(tableSkills, group, name) ?? specializationName(group, name), group, member: name, base: chance};
    };
    if (parts) {
        const group = declaredGroup(groups, parts[1]);
        if (group && parts[2].trim())
            return found(group[0], group[1], parts[2]);
    }
    // `pilot boat` and `Pilot (Boat)` fold to the same words, so a group that enumerates its
    // members answers both; an open group has no list to check a bare phrase against.
    for (const [name, entry] of entries(groups)) {
        const prefix = `${normalizeText(name)} `;
        if (row(entry).specializations == null || !key.startsWith(prefix) || key.length <= prefix.length)
            continue;
        const identity = found(name, row(entry), key.slice(prefix.length));
        if (identity)
            return identity;
    }
    return null;
}
export class SkillResolver {
    readonly sheetSkills: Row;
    readonly aliases = new Map<string, Set<string>>();
    readonly unique = new Map<string, string>();
    constructor(readonly tables: RuleTables, readonly sheet: Row, readonly tableSkills: Row, readonly groups: Row, readonly characteristicLabels: Row = {}) {
        this.sheetSkills = Object.fromEntries(entries(sheet.skills).map(([name, value]) => [name, Math.trunc(number(value))]));
        for (const [name, entry] of entries(tableSkills))
            this.addSkillAliases(name, localized(entry), this.allowInner(name));
        for (const name of Object.keys(this.sheetSkills))
            this.addSkillAliases(name, localized(tableSkills[name]), this.allowInner(name));
        for (const [abbr, english] of Object.entries(CHARACTERISTICS)) {
            this.addAlias(abbr, abbr);
            this.addAlias(english, abbr);
            for (const label of array(characteristicLabels[abbr]))
                this.addAlias(label, abbr);
        }
        for (const [key, names] of this.aliases)
            if (names.size === 1)
                this.unique.set(key, [...names][0]);
    }
    private addAlias(alias: string, canonical: string, bare = false): void {
        const key = normalizeText(alias);
        if (!key || bare && length(key) < (latin(key) ? 4 : 2))
            return;
        this.aliases.set(key, new Set([...(this.aliases.get(key) ?? []), canonical]));
    }
    private addSkillAliases(name: string, labels: string[], allowInner: boolean): void {
        this.addAlias(name, name);
        const parts = PAREN.exec(name);
        if (parts && allowInner) {
            const [, group, inner] = parts;
            this.addAlias(inner, name, true);
            for (const piece of inner.split("/"))
                this.addAlias(piece, name, true);
            this.addAlias(`${group} ${inner}`, name);
        }
        for (const label of labels) {
            this.addAlias(label, name);
            const parsed = PAREN.exec(label);
            if (parsed && allowInner) {
                this.addAlias(parsed[2], name, true);
                for (const piece of parsed[2].split("/"))
                    this.addAlias(piece, name, true);
            }
        }
    }
    private allowInner(name: string): boolean {
        const group = row(this.tableSkills[name]).group;
        if (!group)
            return this.specialization(name) !== null;
        const specializations = row(this.groups[group]).specializations;
        return Array.isArray(specializations) || isJsonObject(specializations);
    }
    /** The specialization a name spells, whether or not the catalog carries a row for it. */
    specialization(text: string): Specialization | null {
        return specializationIdentity(this.groups, this.tableSkills, text);
    }
    /** The group whose own printed row this canonical name is -- the blank `Pilot ( ___ )` line,
     *  not a specialization of it. A group row is a choice the investigator has not made yet, so
     *  it is never by itself the skill a check rolls (§52). */
    groupRow(canonical: string): [string, Row] | null {
        const entry = row(this.tableSkills[canonical]), group = string(entry.group || "");
        if (!group || normalizeText(group) !== normalizeText(canonical))
            return null;
        const declared = declaredGroup(this.groups, group);
        return declared && (declared[1].specializations != null || declared[1].open === true) ? declared : null;
    }
    /** The rows this card actually carries a value in, highest first, with the group rows nobody
     *  ever filled in left out -- a blank is not something to offer the Keeper instead. Which of
     *  them suits a given fiction is the Keeper's judgement; the kernel only reports the card. */
    sheetValues(limit = 6): string[] {
        return Object.entries(this.sheetSkills)
            .filter(([name, value]) => {
                const declared = this.groupRow(name);
                const base = declared ? this.groupBase(declared[0]) : null;
                return declared == null || base == null || value > base;
            })
            .sort((a, b) => b[1] - a[1] || compareUnicode(a[0], b[0]))
            .slice(0, limit)
            .map(([name]) => name);
    }
    /** The group base chance a row would sit at with nothing spent on it. */
    groupBase(group: string): number | null {
        const declared = declaredGroup(this.groups, group);
        const base = declared ? declared[1].base_chance : null;
        return integer(base) ? number(base) : null;
    }
    /** The sheet rows of one group that carry a value -- a specialization the investigator took,
     *  told apart from a printed row nothing was ever spent on by the arithmetic on the card
     *  itself, not by reading the name. The group's own row is reported separately. */
    groupRowsOnSheet(group: string): {specializations: Array<[string, number]>; own: [string, number] | null} {
        const base = this.groupBase(group), specializations: Array<[string, number]> = [];
        let own: [string, number] | null = null;
        for (const [name, value] of Object.entries(this.sheetSkills)) {
            const declared = string(row(this.tableSkills[name]).group || "") || this.specialization(name)?.group || "";
            if (normalizeText(declared) !== normalizeText(group))
                continue;
            if (normalizeText(name) === normalizeText(group))
                own = base != null && value > base ? [name, value] : null;
            else if (base == null || value > base)
                specializations.push([name, value]);
        }
        return {specializations, own};
    }
    canonicalNames(): string[] {
        return [...Object.keys(this.sheetSkills), ...Object.keys(this.tableSkills).filter(name => !Object.hasOwn(this.sheetSkills, name)), ...Object.keys(CHARACTERISTICS)];
    }
    resolveExplicit(text: string): string | null {
        const key = normalizeText(text);
        return this.unique.get(key) ?? this.canonicalNames().find(name => normalizeText(name) === key) ?? this.specialization(text)?.canonical ?? this.nestedMemberOnSheet(text);
    }
    /** §52.6: a nested group's member (`Language (Other: Latin)`, or `Language (Other) (Latin)`) read against the
     *  card's short row for it (`Language (Latin)`). The group is a declared group key that carries a parenthesis;
     *  the row is the card's own. Null when the phrase names no such group or the card has no such row. */
    nestedMemberOnSheet(text: string): string | null {
        const key = normalizeText(text);
        for (const group of Object.keys(this.groups)) {
            const parts = PAREN.exec(group), prefix = `${normalizeText(group)} `;
            if (!parts || !key.startsWith(prefix) || key.length <= prefix.length)
                continue;
            const short = normalizeText(`${parts[1]} (${key.slice(prefix.length)})`);
            const row = Object.keys(this.sheetSkills).find(name => normalizeText(name) === short);
            if (row)
                return row;
        }
        return null;
    }
    findInText(text: string): string[] {
        const haystack = ` ${normalizeText(text)} `,
            found: string[] = [];
        if (!haystack.trim())
            return found;
        for (const [alias, canonical] of this.unique) {
            const matched = latin(alias) ? new RegExp(`(?<![a-z0-9])${escape(alias)}(?:s|es|ing|ed)?(?![a-z0-9])`, "u").test(haystack) : haystack.includes(alias);
            if (matched && !found.includes(canonical))
                found.push(canonical);
        }
        return found;
    }
    optionsFor(text: string, preferred: string[] = [], limit = 6): string[] {
        const options = [...preferred],
            probe = normalizeText(text),
            scores: Array<[
            number,
            string
        ]> = [];
        for (const canonical of [...Object.keys(this.sheetSkills), ...Object.keys(CHARACTERISTICS)]) {
            if (options.includes(canonical))
                continue;
            let best = 0;
            for (const [alias, name] of this.unique)
                if (name === canonical)
                    best = Math.max(best, alias && probe.includes(alias) ? 1 : similarity(alias, probe));
            scores.push([best + number(this.sheetSkills[canonical]) / 1000, canonical]);
        }
        scores.sort((a, b) => b[0] - a[0] || compareUnicode(a[1], b[1]));
        for (const [, canonical] of scores) {
            if (options.length >= limit)
                break;
            options.push(canonical);
        }
        return options.slice(0, limit);
    }
    characteristicValue(abbr: string): number {
        if (abbr === "LUCK" && Object.hasOwn(this.sheet, "current_luck"))
            return Math.trunc(number(this.sheet.current_luck));
        const characteristics = row(this.sheet.characteristics);
        if (!Object.hasOwn(characteristics, abbr))
            return missing(abbr);
        return Math.trunc(number(characteristics[abbr]));
    }
    targetValue(canonical: string): number {
        if (Object.hasOwn(this.sheetSkills, canonical))
            return this.sheetSkills[canonical];
        if (Object.hasOwn(CHARACTERISTICS, canonical))
            return this.characteristicValue(canonical);
        const entry = this.tableSkills[canonical];
        // A specialization the catalog does not print still has a base chance: its group's. The
        // rules table says which specializations a group has, so `Pilot (Boat)` answers here
        // without the catalog having to list every vehicle, terrain or science by hand (§52).
        const base = entry == null ? this.specialization(canonical)?.base ?? missing(canonical) : entry.base_chance;
        if (integer(base) || typeof base === "boolean")
            return number(base);
        if (typeof base === "string") {
            if (base.startsWith("half_"))
                return Math.floor(this.characteristicValue(base.slice(5)) / 2);
            if (Object.hasOwn(CHARACTERISTICS, base))
                return this.characteristicValue(base);
        }
        return missing(canonical);
    }
    static async create(tables: RuleTables, sheet: Row): Promise<SkillResolver> {
        const skills = await tables.skillsTable(),
            groups = row((await tables.block("skills")).specialization_groups),
            labels: Row = {};
        try {
            for (const [key, value] of entries(await tables.characteristicTable())) {
                const abbr = key.toUpperCase();
                if (Object.hasOwn(CHARACTERISTICS, abbr) && isJsonObject(value))
                    labels[abbr] = localized(value);
            }
        }
        catch { /* Existing characteristic-label lookup permits unavailable display data. */
        }
        return new SkillResolver(tables, sheet, skills, groups, labels);
    }
}
