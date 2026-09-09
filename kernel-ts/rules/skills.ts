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
            return false;
        const specializations = row(this.groups[group]).specializations;
        return Array.isArray(specializations) || isJsonObject(specializations);
    }
    canonicalNames(): string[] {
        return [...Object.keys(this.sheetSkills), ...Object.keys(this.tableSkills).filter(name => !Object.hasOwn(this.sheetSkills, name)), ...Object.keys(CHARACTERISTICS)];
    }
    resolveExplicit(text: string): string | null {
        const key = normalizeText(text);
        return this.unique.get(key) ?? this.canonicalNames().find(name => normalizeText(name) === key) ?? null;
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
        if (entry == null)
            return missing(canonical);
        const base = entry.base_chance;
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
