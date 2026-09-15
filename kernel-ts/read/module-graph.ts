/** Read-only authored graph; names and projections never change the source. */
import { RpcError } from "../errors.js";
import { canonicalJson, compareUnicode } from "../json.js";
import { entries, values, array, row, truth, string, repr, integer, normalize, normalizeText, kebab, stripPrefix, sorted, similarity, words, chars, pick, type Row } from "./values.js";
export const TEMPLATE_NOTE = "the book's pregenerated investigator, not at this table; the table's investigators are in the capsule's known.investigator";
const EXIT_KINDS = ["route-to", "play-precedes", "may-lead-to", "alternative-to", "hands-off-to"];
const CHARACTERISTICS = new Set(["STR", "CON", "SIZ", "DEX", "APP", "INT", "POW", "EDU", "LUCK", "SAN"]);
const DERIVED = new Set(["HP", "MP", "BUILD", "MOVE", "MAGIC_POINTS", "DAMAGE_BONUS", "AGE", "ARMOR"]);
/** Contract 28.3/28.4: the dossier spine as one list. `profile_keys` stays the core words the
 *  book's own vocabulary names -- the playability measure counts those and only those, so a book
 *  silent about a package's key does not report every actor in it as thin. `contributed` are the
 *  words a package added, bound when the module was built and carried in its provenance. */
export const dossierKeys = (dossier: Row): string[] => [
    ...array(dossier.profile_keys).map(key => string(key)),
    ...array(dossier.contributed).map(entry => string(row(entry).key)),
].filter(key => key !== "");
export function dossierLabels(dossier: Row): Array<[string, string]> {
    const labels = row(dossier.profile_labels),
        core: Array<[string, string]> = truth(labels)
            ? entries(labels).map(([key, label]) => [key, string(label) || key])
            : array(dossier.profile_keys).map(key => [string(key), string(key)]);
    return [...core, ...array(dossier.contributed).map(entry => {
        const key = string(row(entry).key);
        return [key, string(row(entry).label) || key] as [string, string];
    })].filter(([key]) => key !== "");
}
/** The module's own recorded vocabulary merged onto the current contract. A package can only add
 *  a word, never rename or take away a core one, and a key the module was not built with stays
 *  absent -- the same absence as a book that does not say (contract 28.2). */
export function dossierWith(dossier: Row, recorded: Row | null | undefined): Row {
    const core = new Set(array(dossier.profile_keys).map(key => string(key))),
        seen = new Set<string>(),
        contributed = array(row(recorded).actor_profile_keys).flatMap(entry => {
            const key = string(row(entry).key);
            if (!key || core.has(key) || seen.has(key))
                return [];
            seen.add(key);
            return [{ key, label: string(row(entry).label) || key }];
        });
    return contributed.length ? { ...dossier, contributed } : dossier;
}
const lines = (value: any): value is string[] => Array.isArray(value) && value.length > 0 && value.length <= 2 && value.every(line => typeof line === "string" && line.trim());
export function recordOf(node: Row | null | undefined): Row {
    const props = row(node?.properties),
        record = row(props.runtime_projection).record;
    return record && !Array.isArray(record) && typeof record === "object" ? record : Object.fromEntries(entries(props).filter(([k]) => k !== "runtime_projection"));
}
export function moduleDeclaration(node: Row | null | undefined): Row {
    if (!node)
        return {};
    const document = array(row(row(node.properties).runtime_projection).documents).find(d => row(d).filename === "module-meta.json");
    return {
        ...Object.fromEntries(entries(row(node.properties)).filter(([k]) => k !== "runtime_projection")),
        ...recordOf(node),
        ...row(document?.root)
    };
}
export function conditionFlag(when: any): string | null {
    if (typeof when === "string")
        return kebab(when) || null;
    if (!["flag", "flag_set"].includes(row(when).kind))
        return null;
    for (const key of ["flag_id", "flag", "name"])
        if (typeof when[key] === "string" && kebab(when[key]))
            return kebab(when[key]);
    return null;
}
export function flagIsSet(flags: Row, slug: string, expected: any = null): boolean {
    return Object.hasOwn(flags, slug) && (expected != null ? flags[slug] === expected : flags[slug] !== false);
}
export function conditionStatus(when: any, world: Row): boolean | null {
    const flags = row(world.flags);
    if (typeof when === "string") {
        const slug = kebab(when);
        return slug && Object.hasOwn(flags, slug) ? flagIsSet(flags, slug) : null;
    }
    if (!when || typeof when !== "object" || Array.isArray(when))
        return null;
    if (when.kind === "always")
        return true;
    if (when.kind === "clue_discovered")
        return array(world.discovered_clues).includes(stripPrefix(string(when.clue_id ?? ""), "clue"));
    const slug = conditionFlag(when);
    if (slug != null)
        return flagIsSet(flags, slug, when.value);
    const texts = values(when).filter(v => typeof v === "string" && v.trim()).map(v => ` ${normalizeText(v)} `);
    const named = Object.keys(flags).filter(k => normalizeText(k) && texts.some(text => text.includes(` ${normalizeText(k)} `)));
    return named.length ? named.every(k => flagIsSet(flags, k)) : null;
}
export const conditionMet = (when: any, world: Row): boolean => conditionStatus(when, world) === true;
export function describeCondition(when: any): string {
    if (row(when).kind === "clue_discovered")
        return `clue_discovered: ${stripPrefix(string(when.clue_id ?? ""), "clue")}`;
    const slug = conditionFlag(when);
    return slug == null ? canonicalJson(when) : `flag_set: ${slug}${row(when).value != null ? ` = ${repr(when.value)}` : ""}`;
}
/** The phrase's words open or close the key, in order with nothing between, and the key holds more (equal would
 *  have been an exact match).
 *
 *  Anchored, because a name key is not always a name. `nameKeys` indexes whatever the graph put in `name`, and
 *  for a clue that is a whole sentence: "Landlord Steven Knott pays $20/day to examine the Corbitt House...".
 *  An unanchored run turned the bridge into a substring search over prose, and `apply clue "steven-knott"` --
 *  a person, asked for as a clue -- came back with that clue instead of `unknown_entity`. A qualified form of a
 *  name puts the qualifier outside it ("Professor Nemesio Sánchez", "Letter from Nemesio Sánchez", "Nemesio
 *  Sánchez, of the university"), so the run sits at one end; a sentence that merely mentions someone holds it in
 *  the middle. That is the whole difference, and it needs no list of titles. */
const phraseWithin = (phrase: string[], key: string[]): boolean => {
    if (phrase.length >= key.length)
        return false;
    const opens = phrase.every((word, i) => key[i] === word),
        closes = phrase.every((word, i) => key[key.length - phrase.length + i] === word);
    return opens || closes;
};
export class ModuleGraph {
    /** Source queue/asset routing only; never authored graph data. */
    sourceCampaign?: string;
    /** Only the campaign resolver installs this pinned material authority. */
    materialOverride?: (name: string) => string;
    assetOverride?: (name: string) => Promise<Row | null>;
    readonly nodes = new Map<string, Row>();
    readonly byKind = new Map<string, Row[]>();
    readonly out = new Map<string, Row[]>();
    readonly incoming = new Map<string, Row[]>();
    readonly claimsBySubject = new Map<string, Row[]>();
    readonly names = new Map<string, Set<string>>();
    readonly moduleNode: Row | null;
    constructor(readonly moduleId: string, readonly raw: Row, readonly digest: string, readonly dossier: Row,
        readonly semanticNames: ReadonlyMap<string, string> = new Map(), readonly campaignView = false) {
        const append = (map: Map<string, Row[]>, key: string, value: Row) => map.set(key, [...(map.get(key) ?? []), value]);
        for (const node of array(raw.nodes)) {
            this.nodes.set(node.node_id, node);
            append(this.byKind, node.node_kind, node);
        }
        for (const rel of array(raw.relations)) {
            append(this.out, rel.from_node_id, rel);
            append(this.incoming, rel.to_node_id, rel);
        }
        for (const node of this.nodes.values())
            for (const key of this.nameKeys(node)) {
                const normalized = normalize(key);
                this.names.set(normalized, new Set([...(this.names.get(normalized) ?? []), node.node_id]));
            }
        for (const claim of array(raw.claims))
            if (typeof row(claim).subject_id === "string")
                append(this.claimsBySubject, claim.subject_id, claim);
        this.moduleNode = this.kind("module")[0] ?? null;
    }
    kind(kind: string): Row[] {
        return this.byKind.get(kind) ?? [];
    }
    nameKeys(node: Row): string[] {
        const record = recordOf(node);
        return [node.node_id, this.handle(node), node.name || "", ...array(node.aliases), ...["display_name", "name", "scene_id", "title"].map(k => record[k]).filter(v => typeof v === "string")].filter(Boolean);
    }
    handle(node: Row): string {
        if (this.semanticNames.has(node.node_id)) return this.semanticNames.get(node.node_id)!;
        return node.node_kind === "scene" && typeof recordOf(node).scene_id === "string" ? recordOf(node).scene_id : stripPrefix(node.node_id, node.node_kind);
    }
    displayName(node: Row): string {
        for (const key of ["display_name", "name", "title"])
            if (typeof recordOf(node)[key] === "string" && recordOf(node)[key])
                return recordOf(node)[key];
        return typeof node.name === "string" && node.name && node.name.replaceAll(" ", "-") !== node.node_id ? node.name : this.handle(node);
    }
    title(): string {
        return this.moduleNode?.name ? string(this.moduleNode.name) : this.moduleId;
    }
    resolve(name: string, kinds?: string[], what = "entity"): Row {
        const key = normalize(name),
            wanted = (id: string) => !kinds?.length || kinds.includes(this.nodes.get(id)!.node_kind),
            exact = [...this.nodes.values()].filter(n => wanted(n.node_id) && key === normalize(this.handle(n)));
        if (exact.length === 1)
            return exact[0];
        const ambiguous = (ids: string[]) => new RpcError("unknown_entity", `${what} ${repr(name)} is ambiguous`, {
            fix: "use one of details.candidates by its exact name",
            details: {
                query: name,
                candidates: sorted(ids).map(id => this.describe(this.nodes.get(id)!))
            }
        });
        const ids = [...(this.names.get(key) ?? [])].filter(wanted);
        if (ids.length === 1)
            return this.nodes.get(ids[0])!;
        if (ids.length > 1)
            throw ambiguous(ids);
        // Both exact paths missed. The book prints "Professor Nemesio Sánchez"; the Keeper says
        // "Nemesio Sánchez". No title list exists (the rules forbid one), so the only mechanical
        // bridge is the shape itself: the query's words, in order and unbroken, at one end of a name
        // key (contract section 2). One word is a hint for candidates, not an identity, so a phrase it
        // must be; and one owner it must have, or the ambiguity is reported, never resolved.
        const phrase = key.split(" ");
        if (phrase.length >= 2) {
            const owners = new Set<string>();
            for (const [normalized, holders] of this.names)
                if (phraseWithin(phrase, normalized.split(" ")))
                    for (const id of holders)
                        if (wanted(id))
                            owners.add(id);
            if (owners.size === 1)
                return this.nodes.get([...owners][0])!;
            if (owners.size > 1)
                throw ambiguous([...owners]);
        }
        throw new RpcError("unknown_entity", `no ${what} named ${repr(name)} in the module graph`, {
            fix: "pick a name from details.candidates or look first",
            details: {
                query: name,
                candidates: this.candidates(name, kinds)
            }
        });
    }
    find(name: string, kinds?: string[]): Row | null {
        try {
            return this.resolve(name, kinds);
        }
        catch (error) {
            if (error instanceof RpcError)
                return null;
            throw error;
        }
    }
    candidates(name: string, kinds?: string[], limit = 6): Row[] {
        const key = normalize(name),
            pool = new Map<string, string>(),
            ranked: string[] = [];
        for (const [normalized, ids] of this.names)
            for (const id of ids)
                if ((!kinds?.length || kinds.includes(this.nodes.get(id)!.node_kind)) && !pool.has(normalized))
                    pool.set(normalized, id);
        for (const [normalized, id] of pool)
            if (key && (key.includes(normalized) || normalized.includes(key)) && !ranked.includes(id))
                ranked.push(id);
        const close = [...pool.keys()].map(value => [similarity(value, key), value] as const).filter(([score]) => score >= 0.5).sort((a, b) => b[0] - a[0] || compareUnicode(b[1], a[1])).slice(0, limit * 2);
        for (const [, value] of close) {
            const id = pool.get(value)!;
            if (!ranked.includes(id))
                ranked.push(id);
        }
        return ranked.slice(0, limit).map(id => this.describe(this.nodes.get(id)!));
    }
    describe(node: Row): Row {
        return {
            name: this.handle(node),
            kind: node.node_kind,
            display_name: this.displayName(node),
            ...(node.node_kind === "investigator-template" ? { note: TEMPLATE_NOTE } : {})
        };
    }
    scene(name: string): Row {
        return this.resolve(name, ["scene"], "scene");
    }
    scenes(): Row[] {
        return [...this.kind("scene")];
    }
    startScene(): Row {
        const starts = this.scenes().filter(scene => recordOf(scene).is_start === true);
        if (starts.length === 1)
            return starts[0];
        throw new RpcError("campaign_not_ready", `module ${this.moduleId} declares ${starts.length} start scenes`, {
            fix: starts.length ? `module.opening.choose {module_id: ${repr(this.moduleId)}, scene: <one of details.candidates>}` : "the book declares no opening scene; read the section that holds it",
            details: {
                field: "start_scene",
                candidates: (starts.length ? starts : this.scenes()).slice(0, 20).map(scene => ({
                    scene: this.handle(scene),
                    name: this.displayName(scene)
                }))
            },
        });
    }
    sceneByHandle(name: string): Row | null {
        return this.find(name, ["scene"]);
    }
    npc(name: string): Row {
        return this.resolve(name, ["npc"], "npc");
    }
    clue(name: string): Row {
        return this.resolve(name, ["clue"], "clue");
    }
    private exitEntry(to: string, props: Row): Row {
        const result: Row = { to };
        if (integer(props.travel_minutes) || typeof props.travel_minutes === "boolean")
            result.travel_minutes = props.travel_minutes;
        let when = truth(props.when) ? props.when : truth(props.unlock_when) ? props.unlock_when : props.conditions;
        if (!truth(when) && typeof props.flag === "string" && props.flag.trim())
            when = {
                kind: "flag_set",
                flag_id: props.flag
            };
        if (truth(when))
            result.when = when;
        return result;
    }
    sceneExits(scene: Row): Row[] {
        const exits = new Map<string, Row>();
        for (const rel of this.out.get(scene.node_id) ?? []) {
            const target = this.nodes.get(rel.to_node_id);
            if (!EXIT_KINDS.includes(rel.relation_kind) || target?.node_kind !== "scene")
                continue;
            const entry = this.exitEntry(this.handle(target), row(rel.properties));
            if (rel.relation_kind !== "route-to")
                entry.via ??= rel.relation_kind;
            if (!exits.has(entry.to))
                exits.set(entry.to, entry);
        }
        for (const edge of array(recordOf(scene).scene_edges)) {
            const target = typeof edge.to === "string" ? this.find(edge.to, ["scene"]) : null;
            if (!target)
                continue;
            const entry = this.exitEntry(this.handle(target), edge);
            exits.set(entry.to, {
                ...exits.get(entry.to),
                ...Object.fromEntries(entries(entry).filter(([, v]) => v != null))
            });
        }
        return [...exits.values()];
    }
    sceneEndings(scene: Row): Row[] {
        const seen = new Set<string>(),
            result: Row[] = [];
        for (const rel of this.out.get(scene.node_id) ?? []) {
            const node = this.nodes.get(rel.to_node_id);
            if (!node || node.node_kind !== "ending" || seen.has(node.node_id))
                continue;
            if (result.length >= 4)
                break;
            seen.add(node.node_id);
            const line = chars(words(node.summary || ""), 140),
                name = this.displayName(node);
            result.push({
                name,
                via: rel.relation_kind,
                ...(line && line !== name ? { line } : {})
            });
        }
        return result;
    }
    sceneDanglingExits(scene: Row): string[] {
        return [...new Set((this.out.get(scene.node_id) ?? []).filter(rel => EXIT_KINDS.includes(rel.relation_kind) && !this.nodes.has(string(rel.to_node_id))).map(rel => string(rel.to_node_id)))];
    }
    sceneClueIds(scene: Row): string[] {
        return [...new Set([...array(recordOf(scene).available_clues), ...(this.incoming.get(scene.node_id) ?? []).filter(r => r.relation_kind === "discoverable-at").map(r => r.from_node_id)].filter(id => this.nodes.get(id)?.node_kind === "clue"))];
    }
    sceneNpcIds(scene: Row): string[] {
        return [...new Set([...(this.incoming.get(scene.node_id) ?? []).filter(r => r.relation_kind === "present-in").map(r => r.from_node_id), ...array(recordOf(scene).npc_ids)].filter(id => this.nodes.get(id)?.node_kind === "npc"))];
    }
    sceneAssets(scene: Row): Row[] {
        const links = [...(this.incoming.get(scene.node_id) ?? [])],
            seen = new Set<string>(),
            result: Row[] = [];
        for (const rel of this.out.get(scene.node_id) ?? [])
            if (rel.relation_kind === "occurs-at")
                links.push(...(this.incoming.get(rel.to_node_id) ?? []).filter(r => r.relation_kind === "depicts"));
        for (const rel of links) {
            const node = this.nodes.get(rel.from_node_id);
            if (!["depicts", "discoverable-at", "located-in"].includes(rel.relation_kind) || !node || node.node_kind === "clue" || seen.has(node.node_id))
                continue;
            seen.add(node.node_id);
            result.push({
                name: this.displayName(node),
                kind: node.node_kind
            });
        }
        return result;
    }
    private listedNodes(ids: string[]): Row[] {
        const seen = new Set<string>(),
            result: Row[] = [];
        for (const id of ids) {
            const node = this.nodes.get(id);
            if (!node || seen.has(id))
                continue;
            seen.add(id);
            const line = words(node.summary || ""),
                name = this.displayName(node);
            result.push({
                name,
                ...(line && line !== name ? { line } : {})
            });
        }
        return result;
    }
    scenePlaces(scene: Row): Row[] {
        return this.listedNodes((this.out.get(scene.node_id) ?? []).filter(r => r.relation_kind === "occurs-at").flatMap(r => (this.incoming.get(r.to_node_id) ?? []).filter(inner => inner.relation_kind === "located-in").map(inner => inner.from_node_id)));
    }
    sceneRules(scene: Row): Row[] {
        return this.listedNodes((this.out.get(scene.node_id) ?? []).filter(r => r.relation_kind === "uses-rule").map(r => r.to_node_id));
    }
    threatClock(threat: Row, clockId: string): Row | null {
        return array(recordOf(threat).clocks).map(row).find(clock => [clock.clock_id, clock.id, clock.name].some(value => typeof value === "string" && normalize(value) === normalize(clockId))) ?? null;
    }
    sceneBeat(scene: Row): Row | null {
        return this.kind("beat").map(recordOf).find(r => r.scene_id === this.handle(scene)) ?? null;
    }
    /** Canonical clue-owned metadata, with the old conclusion table retained as a fallback. */
    clueProfile(node: Row): Row {
        const legacy: Row = {};
        for (const conclusion of this.kind('conclusion'))
            for (const entry of array(recordOf(conclusion).clues))
                if (entry.clue_id === node.node_id) Object.assign(legacy, entry);
        return {...legacy, ...recordOf(node), ...Object.fromEntries(entries(row(node.properties)).filter(([key]) => key !== 'runtime_projection'))};
    }
    clueView(node: Row): Row {
        return {
            name: this.handle(node),
            summary: node.summary || node.name || null,
            delivery_kind: this.clueProfile(node).delivery_kind ?? null
        };
    }
    actorProfile(node: Row): Row {
        const props = row(node.properties),
            nested = row(row(recordOf(node).mechanics).profile),
            characteristics: Row = {},
            skills: Row = {},
            flat: Row = {};
        for (const [key, value] of entries(props))
            if (integer(value))
                (CHARACTERISTICS.has(key.toUpperCase()) ? characteristics : DERIVED.has(key.toUpperCase()) ? flat : skills)[key] = value;
        for (const [key, value] of entries(row(props.skills)))
            if (integer(value))
                skills[key] = value;
        for (const [name, target] of [["characteristics", characteristics], ["skills", skills]] as const)
            for (const [key, value] of entries(row(nested[name])))
                if (integer(value) && !Object.hasOwn(target, key))
                    target[key] = value;
        return {
            characteristics,
            skills,
            derived: {
                ...flat,
                ...row(nested.derived)
            },
            ...pick(nested, ["attacks", "attacks_per_round", "weapons", "spells", "armor_rule", "san_loss_to_see"])
        };
    }
    actorSkillValue(node: Row, skill: string): number | null {
        const profile = this.actorProfile(node),
            key = normalize(skill);
        for (const table of ["skills", "characteristics"])
            for (const [name, value] of entries(profile[table]))
                if (normalize(name) === key)
                    return Number(value);
        return null;
    }
    npcProfile(node: Row): Row {
        const profile: Row = {};
        for (const key of dossierKeys(this.dossier)) {
            let value = row(node.properties)[key];
            if (!(typeof value === "string" && value.trim()) && !lines(value))
                value = recordOf(node)[key];
            if (typeof value === "string" && value.trim())
                profile[key] = value.trim();
            // A `shape: "lines"` word (§40.5) is authored as a short list of lines.
            else if (lines(value))
                profile[key] = value.map((line: string) => line.trim());
        }
        return profile;
    }
    npcClaims(node: Row, predicate: string): Row[] {
        return (this.claimsBySubject.get(node.node_id) ?? []).filter(c => c.predicate === predicate);
    }
    npcKnows(node: Row): Array<{
        node: Row;
        handle: string;
        origin?: Row;
    }> {
        const ids = [...this.npcClaims(node, "knows").map(c => row(c.object).node_id), ...array(recordOf(node).facts).map(f => f.clue_id)],
            seen = new Set<string>();
        return ids.flatMap(id => {
            const target = this.nodes.get(id);
            if (!target || seen.has(id))
                return [];
            seen.add(id);
            return [{
                    node: target,
                    handle: this.handle(target),
                    ...(this.adaptationOrigin(array(recordOf(node).facts).find(f => f.clue_id === id)?.campaign_origin)
                        ? {origin: this.adaptationOrigin(array(recordOf(node).facts).find(f => f.clue_id === id)?.campaign_origin)!} : {})
                }];
        });
    }
    claimLines(claims: Row[]): string[] {
        return claims.flatMap(claim => {
            const object = row(claim.object),
                target = this.nodes.get(object.node_id);
            let line = target?.node_kind === "npc" ? claim.reason || claim.statement : target ? target.summary || target.name : null;
            for (const key of ["statement", "text", "value"])
                if (!(typeof line === "string" && line.trim()) && typeof object[key] === "string")
                    line = object[key];
            if (!(typeof line === "string" && line.trim()) && typeof claim.statement === "string")
                line = claim.statement;
            return typeof line === "string" && line.trim() ? [line.trim()] : [];
        });
    }
    npcClaimLines(node: Row, predicate: string): string[] {
        return this.claimLines(this.npcClaims(node, predicate));
    }
    authoredLines(node: Row, key: string): string[] {
        const value = row(node.properties)[key];
        return (typeof value === "string" ? [value] : array(value)).filter(v => typeof v === "string" && v.trim()).map(v => v.trim());
    }
    npcBeliefs(node: Row): string[] {
        return [...new Set([...this.npcClaimLines(node, "believes"), ...this.authoredLines(node, "beliefs"), ...this.claimLines(this.npcClaims(node, "asserts").filter(c => c.truth_status === "authored-belief"))])];
    }
    npcWouldSay(node: Row): string[] {
        return [...new Set([...this.claimLines(this.npcClaims(node, "asserts").filter(c => ["authored-lie", "authored-rumor"].includes(c.truth_status))), ...this.authoredLines(node, "lies"), ...array(row(node.properties).deflect_lines).map(v => typeof v === "string" ? v : row(v).line).filter(v => typeof v === "string" && v.trim()).map(v => v.trim())])];
    }
    npcsKnowing(node: Row): string[] {
        return this.kind("npc").filter(npc => this.npcKnows(npc).some(entry => entry.node.node_id === node.node_id)).map(npc => npc.node_id);
    }
    npcHasMaterial(node: Row): boolean {
        // Core words only, matching `npcs_without_material`: a book silent about a package's key must
        // not report every actor in it as thin, and a key only a package asked for must not stand in
        // for the material the book itself owes an actor (contract 28.5).
        const profile = this.npcProfile(node), core = array(this.dossier.profile_keys).some(key => truth(profile[string(key)]));
        return core || array(this.dossier.claim_predicates).some(predicate => this.npcClaims(node, predicate).length > 0) || truth(recordOf(node).facts);
    }
    npcTies(node: Row): Row[] {
        const result: Row[] = [],
            seen = new Set<string>();
        for (const [rel, id] of [...(this.out.get(node.node_id) ?? []).map(r => [r, r.to_node_id]), ...(this.incoming.get(node.node_id) ?? []).map(r => [r, r.from_node_id])] as [
            Row,
            string
        ][]) {
            const target = this.nodes.get(id),
                key = canonicalJson([rel.relation_kind, id]);
            if (!array(this.dossier.tie_relation_kinds).includes(rel.relation_kind) || !target || rel.from_node_id === rel.to_node_id || seen.has(key))
                continue;
            seen.add(key);
            result.push({
                kind: rel.relation_kind,
                to: this.displayName(target),
                node: target
            });
        }
        return result;
    }
    search(query: string, limit = 8): Row[] {
        const key = normalize(query);
        if (!key)
            return [];
        const exact: Row[] = [],
            names: Array<[
            number,
            number,
            Row
        ]> = [],
            summaries: Row[] = [];
        array(this.raw.nodes).forEach((node, order) => {
            const keys = this.nameKeys(node).map(normalize);
            if (keys.includes(key))
                exact.push(node);
            else {
                const hits = keys.filter(k => k.includes(key));
                if (hits.length)
                    names.push([Math.min(...hits.map(k => Array.from(k).length)), order, node]);
                else if (normalize(node.summary || "").includes(key) || normalize(this.prose(node)).includes(key))
                    summaries.push(node);
            }
        });
        names.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        return [...exact, ...names.map(n => n[2]), ...summaries].sort((a, b) => Number(a.node_kind === "investigator-template") - Number(b.node_kind === "investigator-template")).slice(0, limit);
    }
    prose(node: Row): string {
        for (const key of ["prose", "description", "note", "summary"])
            if (typeof recordOf(node)[key] === "string")
                return recordOf(node)[key];
        return "";
    }
    summary(node: Row): string {
        return this.prose(node) || node.summary || node.name || "";
    }
    relationsOf(node: Row, limit = 12): Row[] {
        const result: Row[] = [];
        for (const rel of this.out.get(node.node_id) ?? []) {
            const target = this.nodes.get(rel.to_node_id);
            if (target)
                result.push({
                    kind: rel.relation_kind,
                    to: this.handle(target),
                    ...(this.adaptationOrigin(rel.campaign_origin) ? {origin: this.adaptationOrigin(rel.campaign_origin)} : {})
                });
        }
        for (const rel of this.incoming.get(node.node_id) ?? []) {
            const source = this.nodes.get(rel.from_node_id);
            if (source && ["present-in", "discoverable-at", "located-in", "supports"].includes(rel.relation_kind))
                result.push({
                    kind: rel.relation_kind,
                    from: this.handle(source),
                    ...(this.adaptationOrigin(rel.campaign_origin) ? {origin: this.adaptationOrigin(rel.campaign_origin)} : {})
                });
        }
        return result.slice(0, limit);
    }
    entityView(node: Row): Row {
        return {
            name: this.handle(node),
            display_name: this.displayName(node),
            kind: node.node_kind,
            summary: this.summary(node),
            properties: Object.fromEntries(entries(row(node.properties)).filter(([k]) => !["runtime_projection", "asset_ref"].includes(k))),
            visibility: node.visibility ?? null,
            relations: this.relationsOf(node),
            ...(this.adaptationOrigin(node.campaign_origin) ? {origin: this.adaptationOrigin(node.campaign_origin)} : {}),
            ...(node.node_kind === "investigator-template" ? { note: TEMPLATE_NOTE } : {})
        };
    }
    adaptationOrigin(value: any): Row | null {
        if (!this.campaignView || !value || typeof value !== 'object') return null;
        return {kind: 'campaign_adaptation', reason: chars(string(value.reason), 400),
            sources: array(value.sources).flatMap(id => {const node = this.nodes.get(id); return node ? [{kind: node.node_kind, name: node.name}] : [];})};
    }
}
