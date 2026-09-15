/** Read-only rules tables; family arithmetic and mutation stay with their executors. */
import { join } from "node:path";
import type { KernelContext } from "../context.js";
import { isJsonObject, PythonFloat, type ReadonlyJson } from "../json.js";
import { pythonTypeName } from "../errors.js";
import { array, row, entries, string, truth, repr, type Row } from "../read/values.js";
import { caseFold } from "./casefold.js";
export const tableSlug = (value: any): string => caseFold(truth(value) ? string(value) : "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
export class RuleTables {
    private readonly cache = new Map<string, Promise<ReadonlyJson>>();
    constructor(readonly context: KernelContext, readonly directory = join(context.content, "rulesets", "coc7", "rules-json")) {
    }
    load(name: string): Promise<ReadonlyJson> {
        let pending = this.cache.get(name);
        if (!pending) {
            pending = this.context.snapshots.readJson(join(this.directory, `${name}.json`));
            this.cache.set(name, pending);
            void pending.catch(() => this.cache.delete(name));
        }
        return pending;
    }
    exists(name: string): Promise<boolean> {
        return this.context.snapshots.pathExists(join(this.directory, `${name}.json`));
    }
    async block(name: string, key?: string, required = false): Promise<Row> {
        const document = await this.load(name);
        if (!isJsonObject(document)) {
            const type = pythonTypeName(document as any);
            const message = required && key !== undefined
                ? Array.isArray(document) ? "list indices must be integers or slices, not str"
                    : typeof document === "string" ? "string indices must be integers, not 'str'"
                        : `'${type}' object is not subscriptable`
                : `'${type}' object has no attribute 'get'`;
            const error = new Error(message);
            error.name = required ? "TypeError" : "AttributeError";
            throw error;
        }
        if (key !== undefined && required && !Object.hasOwn(document, key)) {
            const error = new Error(repr(key));
            error.name = "KeyError";
            throw error;
        }
        const value = key === undefined ? document : Object.hasOwn(document, key) ? document[key] : {};
        if (!isJsonObject(value)) {
            const error = new Error(`'${pythonTypeName(value as any)}' object has no attribute 'items'`);
            error.name = "AttributeError";
            throw error;
        }
        return value;
    }
    async ruleIndex(): Promise<Row[]> {
        return array(row(await this.load("rule-index")).rules).filter(value => isJsonObject(value) && typeof value.id === "string");
    }
    async ruleIds(): Promise<Set<string>> {
        return new Set((await this.ruleIndex()).map(rule => rule.id));
    }
    async resolveRuleRefs(refs: string[]): Promise<Row[]> {
        const index = new Map((await this.ruleIndex()).map(rule => [rule.id, rule]));
        return refs.flatMap(ref => index.has(ref) ? [index.get(ref)!] : []);
    }
    weaponsTable(): Promise<Row> {
        return this.block("weapons", "weapons", true);
    }
    skillsTable(): Promise<Row> {
        return this.block("skills", "skills", true);
    }
    occupationsTable(): Promise<Row> {
        return this.block("occupations", "occupations", true);
    }
    async weaponByName(name: string): Promise<Row> {
        const value = (await this.weaponsTable())[name];
        if (value != null) return value;
        const error = new Error(repr(`unknown weapon: ${repr(name)}`));
        error.name = "KeyError";
        throw error;
    }
    async skillByName(name: string): Promise<Row> {
        const value = (await this.skillsTable())[name];
        if (value != null) return value;
        const error = new Error(repr(`unknown skill: ${repr(name)}`));
        error.name = "KeyError";
        throw error;
    }
    async damageBonusBuild(strValue: number, sizValue: number): Promise<Row> {
        const total = strValue + sizValue;
        for (const entry of array(await this.load("damage-bonus-build"))) {
            if (!(Number(entry.min) <= total && total <= Number(entry.max))) continue;
            const result: Row = {total, damage_bonus: entry.damage_bonus, build: entry.build};
            const extrapolation = entry.extrapolation;
            if (extrapolation != null && total > Number(extrapolation.applies_when_total_greater_than)) {
                const excess = total - Number(extrapolation.applies_when_total_greater_than);
                const steps = Math.floor((excess + Number(extrapolation.per_80_points) - 1) / Number(extrapolation.per_80_points));
                result.damage_bonus = `+${5 + steps}D6`;
                result.build = 6 + steps;
            }
            return result;
        }
        const error = new Error(`STR+SIZ total out of table range: ${total}`);
        error.name = "ValueError";
        throw error;
    }
    /** The finance periods the rulebook tabulates, in table order. */
    async financePeriods(): Promise<string[]> {
        const periods = row(await this.load("cash-assets")).periods;
        return isJsonObject(periods) ? Object.keys(periods) : [];
    }
    /** The period the table itself nominates when a campaign's authored setting has no column of its
     *  own. Which period stands in is table data, not arithmetic: the kernel never reads a year out of
     *  authored prose, and never extrapolates a column the rulebook did not print. */
    async defaultFinancePeriod(): Promise<string> {
        const table = row(await this.load("cash-assets")), periods = await this.financePeriods();
        const declared = truth(table.default_period) ? string(table.default_period) : "";
        if (!periods.includes(declared)) {
            const error = new Error(`cash-assets names no usable default_period: ${repr(declared)}`);
            error.name = "ValueError";
            throw error;
        }
        return declared;
    }
    async cashAndAssets(creditRating: number, period = "1920s"): Promise<Row> {
        const table = row(await this.load("cash-assets")), periods = table.periods;
        const fail = (message: string): never => { const error = new Error(message); error.name = "ValueError"; throw error; };
        if (!isJsonObject(periods) || !Object.hasOwn(periods, period)) fail(`unsupported finance period: ${period}`);
        const rows = periods[period];
        if (!Array.isArray(rows)) fail(`cash-assets table period is not a list: ${period}`);
        const currency = string(truth(table.currency) ? table.currency : "USD");
        const amount = (value: any, formula: string | null = null): Row => ({amount: value ?? null, currency, ...(formula ? {formula} : {})});
        const multiply = (value: any): any => value instanceof PythonFloat ? new PythonFloat(creditRating * value.value)
            : typeof value === "bigint" ? BigInt(creditRating) * value : creditRating * value;
        for (const entry of rows) {
            if (!isJsonObject(entry) || !(Number(entry.credit_rating_min) <= creditRating && creditRating <= Number(entry.credit_rating_max))) continue;
            let cashFormula: string | null = null, cash = entry.cash ?? null;
            if (Object.hasOwn(entry, "cash_multiplier")) { cashFormula = `CR x ${string(entry.cash_multiplier)}`; cash = multiply(entry.cash_multiplier); }
            let assetsFormula: string | null = null, assets = entry.assets ?? null;
            if (Object.hasOwn(entry, "assets_multiplier")) { assetsFormula = `CR x ${string(entry.assets_multiplier)}`; assets = multiply(entry.assets_multiplier); }
            else if (Object.hasOwn(entry, "assets_minimum")) { assetsFormula = "minimum"; assets = entry.assets_minimum; }
            else if (assets === null) assetsFormula = "None";
            return {credit_rating: creditRating, living_standard: entry.living_standard, cash: amount(cash, cashFormula),
                assets: amount(assets, assetsFormula), spending_level: amount(entry.spending_level), period};
        }
        return fail(`credit rating out of cash-assets table range: ${creditRating}`);
    }
    spellsTable(): Promise<Row> {
        return this.block("spells");
    }
    monstersTable(): Promise<Row> {
        return this.block("monsters", "monsters");
    }
    tomesTable(): Promise<Row> {
        return this.block("tomes", "tomes");
    }
    poisonsTable(): Promise<Row> {
        return this.block("poisons", "poisons");
    }
    artifactsTable(): Promise<Row> {
        return this.block("artifacts", "artifacts");
    }
    phobiasTable(): Promise<Row> {
        return this.block("phobias", "phobias");
    }
    maniasTable(): Promise<Row> {
        return this.block("manias", "manias");
    }
    hazardsTable(): Promise<Row> {
        return this.block("hazards");
    }
    chaseTable(): Promise<Row> {
        return this.block("chase");
    }
    characteristicTable(): Promise<Row> {
        return this.block("characteristic-dice", "characteristics", true);
    }
    skillSpecializationGroups(): Promise<Row> {
        return this.block("skills", "specialization_groups", true);
    }
    skillDescriptions(): Promise<Row> {
        return this.block("skill-descriptions");
    }
    async equipmentTable(): Promise<Row> {
        const data = await this.load("equipment");
        if (!isJsonObject(data) || data.schema_version !== 2 || !Array.isArray(data.records) || Object.hasOwn(data, "periods")) {
            const error = new Error("equipment.json must be schema-v2 records[] without legacy periods");
            error.name = "ValueError";
            throw error;
        }
        return data;
    }
    async entries(name: string, key?: string): Promise<Array<[
        string,
        any
    ]>> {
        return entries(await this.block(name, key));
    }
}
