/** Read-only rules tables; family arithmetic and mutation stay with their executors. */
import { join } from "node:path";
import type { KernelContext } from "../context.js";
import { isJsonObject, type ReadonlyJson } from "../json.js";
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
