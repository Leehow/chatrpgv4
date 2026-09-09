/** Deterministic catalog recall over rulebook records and the separate authored spell namespace. */
import { isJsonObject, compareUnicode } from "../json.js";
import { ModuleGraph } from "../read/module-graph.js";
import { array, row, entries, values, string, truth, integer, number, pick, clone, sorted, repr, type Row } from "../read/values.js";
import { RuleTables, tableSlug } from "./tables.js";
import { caseFold } from "./casefold.js";
export const SUPPORTED_KINDS = ["weapon", "item", "spell", "creature", "skill", "vehicle", "rule", "artifact", "tome", "poison", "occupation", "phobia", "mania", "hazard"] as const;
const SECRET_KINDS = new Set(["spell", "creature", "artifact", "tome", "poison"]);
export const queryTokens = (query: any): string[] => (string(query).match(/[0-9A-Za-z]+/g) ?? []).map(caseFold);
const normalized = (value: any): string => typeof value === "string" ? queryTokens(value).join(" ") : "";
const failure = (code: string, fields: Row = {}): Row => ({
    ok: false,
    error: {
        code,
        ...fields
    }
});
export function catalogRecord(options: {
    kind: string;
    entityId: string;
    name: string;
    table: string;
    summary: Row;
    params?: Row;
    aliases?: string[];
    era?: string[];
    localizedName?: string | null;
    tags?: string[];
    category?: string | null;
    labels?: string[];
    familyParameterKind?: string;
}): Row {
    return {
        kind: options.kind,
        entity_id: options.entityId,
        name: options.name,
        localized_name: options.localizedName ?? null,
        aliases: options.aliases ?? [],
        labels: options.labels ?? [],
        tags: options.tags ?? [],
        category: options.category ?? null,
        era: options.era ?? [],
        secret: SECRET_KINDS.has(options.kind),
        source: { table: options.table },
        summary: options.summary,
        params: options.params ?? {},
        ...(options.familyParameterKind ? { family_parameter_kind: options.familyParameterKind } : {}),
    };
}
export class Catalog {
    private readonly cache = new Map<string, Promise<Row[]>>();
    constructor(readonly tables: RuleTables) {
    }
    private priceProjection(value: Row): Row {
        const price = row(value.price);
        return {
            price_id: value.price_id ?? null,
            era: value.era ?? null,
            kind: price.kind ?? null,
            source_display: price.source_display ?? null,
            currency: price.currency ?? null,
            ...pick(price, ["amount", "min", "max", "unit", "dice", "multiplier", "addend", "reason"]),
        };
    }
    private async build(kind: string): Promise<Row[]> {
        if (kind === "weapon") {
            const table = await this.tables.weaponsTable(),
                prices = new Map<string, Row[]>();
            for (const value of array((await this.tables.equipmentTable()).records)) {
                const ref = row(value.entity_ref);
                if (ref.kind === "weapon" && typeof ref.entity_id === "string" && ref.entity_id) {
                    prices.set(ref.entity_id, [...(prices.get(ref.entity_id) ?? []), value]);
                }
            }
            return entries(table).filter(([, value]) => isJsonObject(value)).map(([key, value]) => {
                const params = pick(value, ["skill", "damage_die", "base_range_yards", "magazine", "malfunction", "impales", "adds_damage_bonus", "damage_type"]),
                    linked = prices.get(key) ?? [];
                if (linked.length) {
                    params.price_ref = linked.map(item => string(item.price_id));
                    params.price_projection = linked.map(item => this.priceProjection(item));
                }
                return catalogRecord({
                    kind,
                    entityId: key,
                    name: string(value.display_name || key),
                    table: "weapons.json",
                    aliases: [key],
                    era: array(value.eras).filter(v => typeof v === "string"),
                    summary: pick(value, ["skill", "damage_die", "uses_per_round"]),
                    params
                });
            });
        }
        if (kind === "item") {
            return array((await this.tables.equipmentTable()).records).filter(value => isJsonObject(value) && truth(value.price_id) && truth(value.name)).map(value => {
                const priceId = string(value.price_id),
                    name = string(value.name),
                    era = string(value.era || ""),
                    category = string(value.category || "") || null,
                    price = row(value.price);
                return catalogRecord({
                    kind,
                    entityId: priceId,
                    name,
                    table: "equipment.json",
                    era: era ? [era] : [],
                    category,
                    summary: {
                        category,
                        price_kind: price.kind ?? null,
                        source_display: price.source_display ?? null
                    },
                    params: {
                        price_id: priceId,
                        category,
                        price,
                        provenance: value.provenance || {},
                        ...(truth(row(value.entity_ref)) ? { entity_ref: value.entity_ref } : {})
                    }
                });
            });
        }
        if (kind === "spell") {
            return array((await this.tables.spellsTable()).spells).filter(value => isJsonObject(value) && truth(value.name)).map(value => catalogRecord({
                kind,
                entityId: tableSlug(value.name),
                name: string(value.name),
                table: "spells.json",
                aliases: array(value.alternative_names).filter(v => typeof v === "string"),
                summary: pick(value, ["cost_mp", "cost_sanity", "cost_pow"]),
                params: pick(value, ["cost_mp", "cost_sanity", "cost_pow", "source_page"]),
                familyParameterKind: "creature",
            }));
        }
        if (kind === "skill") {
            return entries(await this.tables.skillsTable()).filter(([, value]) => isJsonObject(value)).map(([name, value]) => {
                const labels = row(value.localized_labels);
                return catalogRecord({
                    kind,
                    entityId: name,
                    name,
                    table: "skills.json",
                    localizedName: typeof labels["zh-Hans"] === "string" ? labels["zh-Hans"] : null,
                    aliases: values(labels).filter(v => typeof v === "string"),
                    era: truth(value.modern_only) ? ["modern"] : [],
                    tags: truth(value.uncommon) ? ["uncommon"] : [],
                    category: string(value.group || "") || null,
                    summary: pick(value, ["base_chance", "group", "modern_only", "uncommon"]),
                    params: pick(value, ["base_chance", "group", "modern_only", "uncommon"])
                });
            });
        }
        if (kind === "vehicle") {
            const block = row((await this.tables.chaseTable()).vehicles),
                reverse = new Map<string, string[]>();
            for (const [alias, target] of entries(block.aliases))
                reverse.set(string(target), [...(reverse.get(string(target)) ?? []), alias]);
            return entries(block.entries).filter(([, value]) => isJsonObject(value)).map(([key, value]) => {
                const name = string(value.label || key),
                    params = pick(value, ["mov", "build", "armor", "passengers"]);
                return catalogRecord({
                    kind,
                    entityId: key,
                    name,
                    table: "chase.json",
                    aliases: reverse.get(key) ?? [],
                    labels: [name],
                    summary: params,
                    params
                });
            });
        }
        if (kind === "rule")
            return (await this.tables.ruleIndex()).map(value => catalogRecord({
                kind,
                entityId: value.id,
                name: value.id,
                table: "rule-index.json",
                category: string(value.category || "") || null,
                summary: pick(value, ["category", "source_table"]),
                params: pick(value, ["category", "source_table", "numeric", "source_note"])
            }));
        const specification: Record<string, {
            name: string;
            key?: string;
            summary: string[];
            params: string[];
            slug?: boolean;
        }> = {
            creature: {
                name: "monsters",
                key: "monsters",
                summary: ["hp", "armor", "mov"],
                params: ["hp", "armor", "mov", "san_loss", "source_page"],
                slug: true
            },
            artifact: {
                name: "artifacts",
                key: "artifacts",
                summary: ["mechanics", "source_page"],
                params: ["mechanics", "source_page"],
                slug: true
            },
            tome: {
                name: "tomes",
                key: "tomes",
                summary: ["sanity_cost", "mythos_rating", "full_study_weeks"],
                params: ["sanity_cost", "mythos_rating", "full_study_weeks", "cthulhu_mythos_initial", "cthulhu_mythos_full"],
                slug: true
            },
            poison: {
                name: "poisons",
                key: "poisons",
                summary: ["potency", "damage_expr", "delivery"],
                params: ["potency", "damage_expr", "delivery", "onset"],
                slug: true
            },
            occupation: {
                name: "occupations",
                key: "occupations",
                summary: ["credit_rating_range", "skill_point_formula"],
                params: ["credit_rating_range", "skill_point_formula", "occupational_skills"]
            },
            phobia: {
                name: "phobias",
                key: "phobias",
                summary: ["trigger"],
                params: ["trigger", "source_page"]
            },
            mania: {
                name: "manias",
                key: "manias",
                summary: ["trigger"],
                params: ["trigger", "source_page"]
            },
            hazard: {
                name: "hazards",
                key: "presets",
                summary: ["severity", "category"],
                params: ["severity", "category", "suffocation"]
            },
        };
        const spec = specification[kind];
        if (!spec)
            return [];
        return entries(await this.tables.block(spec.name, spec.key)).filter(([, value]) => isJsonObject(value)).map(([name, value]) => catalogRecord({
            kind,
            entityId: spec.slug ? tableSlug(name) : name,
            name: kind === "hazard" ? string(value.example || name) : name,
            table: `${spec.name}.json`,
            summary: pick(value, spec.summary),
            params: pick(value, spec.params),
            ...(kind === "occupation" ? { tags: array(value.tags).filter(v => typeof v === "string") } : {}),
            ...(["phobia", "mania"].includes(kind) ? { tags: array(value.trigger_tags).filter(v => typeof v === "string") } : {}),
            ...(kind === "hazard" ? { category: string(value.category || "") || null } : {}),
        }));
    }
    async records(kinds?: readonly string[] | null): Promise<Row[]> {
        const output: Row[] = [];
        for (const kind of kinds?.length ? kinds : SUPPORTED_KINDS) {
            if (!(SUPPORTED_KINDS as readonly string[]).includes(kind))
                continue;
            let pending = this.cache.get(kind);
            if (!pending) {
                pending = this.build(kind);
                this.cache.set(kind, pending);
                void pending.catch(() => this.cache.delete(kind));
            }
            output.push(...clone(await pending));
        }
        return output;
    }
    async search(query: any, options: {
        kinds?: any;
        era?: any;
        limit?: any;
        moduleSpells?: Row[];
    } = {}): Promise<Row> {
        if (typeof query !== "string" || !query.trim())
            return failure("invalid_catalog_query", { detail: "query must be a non-empty string" });
        query = query.trim();
        const kinds = normalizeKinds(options.kinds);
        if (!Array.isArray(kinds))
            return kinds;
        if (options.era != null && (typeof options.era !== "string" || !options.era.trim()))
            return failure("invalid_catalog_era", { detail: "era must be a non-empty string when provided" });
        const era = typeof options.era === "string" ? options.era.trim() : null;
        const limit = normalizeLimit(options.limit);
        if (typeof limit !== "number")
            return limit;
        const missing = kinds.filter(kind => !(SUPPORTED_KINDS as readonly string[]).includes(kind));
        if (missing.length)
            return failure("unsupported_catalog_kind", {
                kinds: missing,
                supported_kinds: [...SUPPORTED_KINDS]
            });
        const loadKinds = kinds.length ? kinds : [...SUPPORTED_KINDS],
            records = await this.records(loadKinds),
            scored: Array<{
            rank: [
                number,
                string,
                number,
                string
            ];
            value: Row;
        }> = [],
            matched = new Set<string>();
        for (const record of records) {
            if (!eraOk(record, era))
                continue;
            const reasons = matches(query, recordTokens(record), record);
            if (!reasons.length)
                continue;
            matched.add(string(record.entity_id || ""));
            scored.push({
                rank: rank(record, reasons),
                value: dto(record, reasons)
            });
        }
        let family = {
            hits: [] as Row[],
            gaps: [] as Row[]
        };
        const declarations = familyDeclarations(records);
        if (declarations.length) {
            const extras = sorted(new Set(declarations.map(value => value.parameter_kind))).filter(kind => !loadKinds.includes(kind) && (SUPPORTED_KINDS as readonly string[]).includes(kind));
            const pool = extras.length ? [...records, ...await this.records(extras)] : records;
            family = resolveFamilyParameter(query, pool);
        }
        for (const hit of family.hits) {
            const record = hit.family;
            if (!eraOk(record, era) || matched.has(string(record.entity_id || "")))
                continue;
            const reasons = ["family_parameter", `parameter:${string(hit.parameter.entity_id)}`];
            scored.push({
                rank: rank(record, reasons),
                value: dto(record, reasons, parameterisation(hit))
            });
        }
        for (const record of array(options.moduleSpells).filter(record => isJsonObject(record) && (isJsonObject(record.module_authored) || isJsonObject(record.generated_definition)) && loadKinds.includes(string(record.kind || "")))) {
            if (!eraOk(record, era))
                continue;
            const reasons = matches(query, recordTokens(record), record),
                fold = caseFold(query);
            if (array(record.aliases).some(alias => typeof alias === "string" && caseFold(alias) === fold))
                reasons.unshift("exact_alias");
            if (reasons.length)
                scored.push({
                    rank: rank(record, reasons),
                    value: {
                        ...dto(record, reasons),
                        module_authored: clone(row(record.module_authored))
                    }
                });
        }
        scored.sort((a, b) => a.rank[0] - b.rank[0] || compareUnicode(a.rank[1], b.rank[1]) || a.rank[2] - b.rank[2] || compareUnicode(a.rank[3], b.rank[3]));
        const candidates = markShadowed(scored.slice(0, limit).map(item => item.value));
        const gaps = candidates.some(value => value.match_reasons.includes("exact_name") || value.match_reasons.includes("exact_id")) ? [] : family.gaps;
        return {
            ok: true,
            query,
            kinds: loadKinds,
            era,
            limit,
            ruleset_id: "coc7",
            selected: null,
            candidate_count: candidates.length,
            truncated: scored.length > limit,
            candidates,
            unresolved_family_parameters: gaps.map(value => ({
                family_name: value.family.name ?? null,
                family_entity_id: value.family.entity_id ?? null,
                parameter_kind: value.parameter_kind,
                parameter_query: value.parameter_query
            }))
        };
    }
    async resolveName(kind: any, name: any, moduleSpells?: Row[]): Promise<Row | null> {
        if (typeof kind !== "string" || !kind.trim() || typeof name !== "string" || !name.trim())
            return null;
        kind = kind.trim();
        name = name.trim();
        const result = await this.search(name, {
            kinds: [kind],
            limit: 50,
            moduleSpells
        });
        if (!result.ok)
            return null;
        const fold = caseFold(name);
        let moduleHit: Row | null = null;
        for (const candidate of result.candidates) {
            const block = candidate.module_authored;
            if (isJsonObject(block)) {
                if (moduleHit == null && block.authority === "module_authored_spell" && moduleNamesIt(candidate, fold))
                    moduleHit = candidate;
                continue;
            }
            const parameter = candidate.parameterisation;
            if (parameter != null) {
                if (caseFold(string(parameter.requested_name || "")) === fold)
                    return {
                        canonical_name: string(parameter.canonical_name),
                        record: candidate,
                        parameterisation: parameter,
                        module_authored: null
                    };
                continue;
            }
            if (caseFold(string(candidate.name || "")) === fold) {
                const annotation = result.candidates.find((value: Row) => isJsonObject(value.module_authored) && caseFold(string(value.name || "")) === fold);
                return {
                    canonical_name: string(candidate.name),
                    record: candidate,
                    parameterisation: null,
                    module_authored: annotation ? clone(annotation.module_authored) : null
                };
            }
        }
        return moduleHit ? {
            canonical_name: string(moduleHit.name),
            record: moduleHit,
            parameterisation: null,
            module_authored: clone(moduleHit.module_authored)
        } : null;
    }
}
function normalizeKinds(input: any): string[] | Row {
    if (input == null)
        return [];
    const kinds = typeof input === "string" ? [input] : input;
    if (!Array.isArray(kinds))
        return failure("invalid_catalog_kinds", { detail: "kinds must be a list of strings" });
    const result: string[] = [];
    for (const kind of kinds) {
        if (typeof kind !== "string" || !kind.trim())
            return failure("invalid_catalog_kinds", { detail: "each kind must be a non-empty string" });
        if (!result.includes(kind.trim()))
            result.push(kind.trim());
    }
    return result;
}
function normalizeLimit(input: any): number | Row {
    if (input == null)
        return 20;
    if (!integer(input))
        return failure("invalid_catalog_limit", { detail: "limit must be an integer" });
    if (number(input) < 1 || number(input) > 50)
        return failure("invalid_catalog_limit", { detail: "limit must be between 1 and 50" });
    return number(input);
}
export function recordTokens(record: Row): string[] {
    const parts: string[] = [];
    for (const key of ["entity_id", "name", "localized_name"])
        if (typeof record[key] === "string")
            parts.push(record[key]);
    for (const key of ["aliases", "labels", "tags"])
        if (Array.isArray(record[key]))
            parts.push(...record[key].filter((value: any) => typeof value === "string" || integer(value) || typeof value === "boolean").map(string));
    if (typeof record.category === "string")
        parts.push(record.category);
    return [...new Set(parts.flatMap(queryTokens))];
}
function matches(query: string, tokens: string[], record: Row): string[] {
    const reasons: string[] = [],
        fold = caseFold(query.trim());
    if (caseFold(string(record.entity_id || "")) === fold)
        reasons.push("exact_id");
    if (caseFold(string(record.name || "")) === fold)
        reasons.push("exact_name");
    if (caseFold(string(record.localized_name || "")) === fold && fold)
        reasons.push("exact_localized_name");
    const parts = queryTokens(query);
    if (parts.length && parts.every(part => tokens.includes(part)))
        reasons.push(...parts.map(part => `token:${part}`));
    return reasons;
}
function rank(record: Row, reasons: string[]): [
    number,
    string,
    number,
    string
] {
    return [reasons.some(reason => ["exact_id", "exact_name", "exact_localized_name"].includes(reason)) ? 0 : 1, string(record.kind || ""), isJsonObject(record.module_authored) ? 1 : 0, string(record.entity_id || "")];
}
function eraOk(record: Row, era: string | null): boolean {
    return era == null || !Array.isArray(record.era) || !record.era.length || record.era.includes(era);
}
function familyDeclarations(records: Row[]): Row[] {
    return records.flatMap(record => {
        if (typeof record.family_parameter_kind !== "string" || !record.family_parameter_kind)
            return [];
        const kind = string(record.kind || ""),
            stems: string[] = [];
        for (const label of [record.name, ...array(record.aliases)]) {
            if (typeof label !== "string" || !kind)
                continue;
            const parts = label.trim().split(/\s+/u);
            if (parts.length < 2 || caseFold(parts.at(-1)!) !== caseFold(`${kind}s`))
                continue;
            const stem = parts.slice(0, -1).join(" ").trim();
            if (stem && !stems.includes(stem))
                stems.push(stem);
        }
        return stems.length ? [{
                record,
                stems,
                parameter_kind: record.family_parameter_kind
            }] : [];
    });
}
export function resolveFamilyParameter(query: string, records: Row[]): {
    hits: Row[];
    gaps: Row[];
} {
    const queryNorm = normalized(query),
        indexes = new Map<string, Map<string, Row>>(),
        hits: Row[] = [],
        gaps: Row[] = [];
    if (!queryNorm)
        return {
            hits,
            gaps
        };
    for (const declaration of familyDeclarations(records)) {
        const kind = declaration.parameter_kind;
        if (!indexes.has(kind)) {
            const index = new Map<string, Row>();
            for (const record of records)
                if (string(record.kind || "") === kind)
                    for (const label of [record.name, record.entity_id, ...array(record.aliases)]) {
                        const key = normalized(label);
                        if (key && !index.has(key))
                            index.set(key, record);
                    }
            indexes.set(kind, index);
        }
        for (const stem of declaration.stems) {
            const prefix = normalized(stem);
            if (!prefix || !queryNorm.startsWith(prefix + " "))
                continue;
            const remainder = queryNorm.slice(prefix.length + 1).trim();
            if (!remainder)
                continue;
            const value: Row = {
                stem,
                stem_length: prefix.length,
                family: declaration.record,
                parameter_kind: kind,
                parameter_query: remainder,
                requested_name: query
            },
                parameter = indexes.get(kind)!.get(remainder);
            if (!parameter)
                gaps.push(value);
            else
                hits.push({
                    ...value,
                    parameter,
                    canonical_name: `${declaration.stems[0]} ${string(parameter.name)}`
                });
        }
    }
    if (hits.length) {
        const longest = Math.max(...hits.map(hit => hit.stem_length));
        return {
            hits: hits.filter(hit => hit.stem_length === longest),
            gaps: []
        };
    }
    const longest = gaps.length ? Math.max(...gaps.map(gap => gap.stem_length)) : 0;
    return {
        hits: [],
        gaps: gaps.filter(gap => gap.stem_length === longest)
    };
}
function parameterisation(hit: Row): Row {
    return {
        canonical_name: hit.canonical_name,
        requested_name: hit.requested_name,
        family_name: hit.family.name ?? null,
        family_entity_id: hit.family.entity_id ?? null,
        parameter: {
            kind: hit.parameter_kind,
            entity_id: hit.parameter.entity_id ?? null,
            name: hit.parameter.name ?? null
        },
        note: `${hit.canonical_name} is the catalogue family ${repr(hit.family.name)} bound to the ${hit.parameter_kind} ${repr(hit.parameter.name)}; it is not a separate catalogue entry. Learn and cast it under canonical_name.`
    };
}
function dto(record: Row, reasons: string[], parameter?: Row): Row {
    return {
        kind: record.kind ?? null,
        entity_id: record.entity_id ?? null,
        name: record.name ?? null,
        localized_name: typeof record.localized_name === "string" ? record.localized_name : null,
        aliases: array(record.aliases).filter(value => typeof value === "string"),
        era: array(record.era).filter(value => typeof value === "string"),
        secret: truth(record.secret),
        source: { table: row(record.source).table ?? null },
        summary: row(record.summary),
        params: row(record.params),
        match_reasons: [...reasons],
        ...(parameter !== undefined ? { parameterisation: parameter } : {})
    };
}
export function demotedModuleBlock(record: Row): Row | null {
    if (!isJsonObject(record.module_authored))
        return null;
    const block = clone(record.module_authored);
    return {
        ...block,
        authority: "module_annotation",
        note: `the module also authors ${repr(block.node_id)} under this name. The ruleset catalogue row resolves and prices the entry; this node is the module's annotation on it — read its properties and source_refs, not its costs.`
    };
}
function markShadowed(candidates: Row[]): Row[] {
    const names = new Set(candidates.filter(value => !isJsonObject(value.module_authored)).map(value => caseFold(string(value.name || ""))));
    names.delete("");
    for (const candidate of candidates)
        if (isJsonObject(candidate.module_authored) && names.has(caseFold(string(candidate.name || ""))))
            candidate.module_authored = demotedModuleBlock(candidate);
    return candidates;
}
function moduleNamesIt(candidate: Row, fold: string): boolean {
    return caseFold(string(candidate.name || "")) === fold || array(candidate.aliases).some(alias => typeof alias === "string" && caseFold(alias) === fold);
}
export function moduleSpellRecords(graph: ModuleGraph, world?: Row): Row[] {
    const records = graph.kind("spell").map(node => {
        const props = row(node.properties),
            fields = pick(props, ["cost_mp", "cost_sanity", "cost_pow"]),
            missing = ["cost_mp", "cost_sanity"].filter(key => !Object.hasOwn(fields, key));
        return {
            ...catalogRecord({
                kind: "spell",
                entityId: graph.handle(node),
                name: string(node.name || graph.handle(node)),
                table: "module-graph",
                aliases: array(node.aliases).filter(alias => typeof alias === "string"),
                summary: { summary: node.summary ?? null },
                params: clone(props)
            }),
            module_authored: {
                authority: "module_authored_spell",
                node_id: node.node_id,
                module_id: graph.moduleId,
                summary: node.summary ?? null,
                runtime_rule_ref: props.runtime_rule_ref ?? null,
                costs: {
                    authored: missing.length === 0,
                    fields,
                    missing
                }
            }
        };
    });
    for (const definition of values(row(world?.objects).definitions))
        if (definition.category === "spell")
            records.push({
                ...catalogRecord({
                    kind: "spell",
                    entityId: definition.id,
                    name: definition.name,
                    table: "generated-definitions",
                    summary: { description: definition.description },
                    params: definition.parameters
                }),
                generated_definition: definition
            } as any);
    return records;
}
