/**
 * Contract §134: the shape of a stated obligation (a `requirement` node's `properties.obligation`)
 * and the check declaration form it shares with a Mod's `contributes.checks[]` (§26).
 *
 * `checkDeclarationRefusals` is the one function for the shared form: the Mod manifest check calls
 * it with owner `mod`, and `obligationRefusals` calls it for every check step with owner
 * `obligation`. Refusals are data -- `{rule, path, message}` -- so every caller decides how to throw,
 * and a test names the rule, never the wording.
 *
 * Accounting, not content: nothing here requires a value the page may not state. An unstated
 * difficulty or skill is recorded as `difficulty_unstated` / `approaches_unstated`, and the only
 * name matching is the normalised-name match against the ruleset's own tables.
 */
import type { ModuleGraph } from "../read/module-graph.js";
import { array, normalize, row, sorted, string, type Row } from "../read/values.js";

export type Refusal = { rule: string; path: string; message: string; node?: string };
/** Who declared the check. An obligation's names resolve against the ruleset's tables. */
export type CheckOwner = { kind: "mod" } | { kind: "obligation"; skills: readonly string[]; characteristics: readonly string[] };

const LEVELS = ["critical", "extreme", "hard", "regular", "failure", "fumble"];
const DIFFICULTIES = ["regular", "hard", "extreme"];
const SELECTIONS = { mod: ["maximum"], obligation: ["maximum", "approach"] } as const;
const SCOPES = { mod: ["actor-target"], obligation: ["actor-target", "actor"] } as const;
/** §134.3: the closed trigger enum per owner. A Mod's check carries its trigger; an obligation carries it on itself. */
export const TRIGGERS = { mod: ["contact"], obligation: ["attempt", "after"] } as const;
/** The graph contract's semantic id law; world flags are stored under exactly this form (`stageFlag`). */
const SEMANTIC_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const OBLIGATION_KEYS = ["demand", "reaction", "scene", "settles", "trigger", "who"];
const CHECK_STEP_KEYS = ["approaches_unstated", "difficulty", "difficulty_unstated", "kind", "push", "results", "scope", "selection", "target", "values"];
const VALUE_KEYS = ["label", "minimum", "path"];

const plain = (value: any): value is Row => value != null && typeof value === "object" && !Array.isArray(value);
const text = (value: any): boolean => typeof value === "string" && Boolean(value.trim());
const unknownKeys = (value: Row, allowed: readonly string[]): string[] => Object.keys(value).filter(key => !allowed.includes(key));

/** §134.3: whether `kind` is a trigger this owner may declare. */
export function triggerRefusal(owner: keyof typeof TRIGGERS, kind: any, path: string): Refusal | null {
    const allowed: readonly string[] = TRIGGERS[owner];
    return typeof kind === "string" && allowed.includes(kind) ? null
        : { rule: "check_trigger", path, message: `${path} must be ${allowed.join(" or ")}` };
}

/** §134.2: the check declaration form, for a Mod's contributed check or an obligation's check step. */
export function checkDeclarationRefusals(check: any, owner: CheckOwner, at = ""): Refusal[] {
    const refusals: Refusal[] = [], obligation = owner.kind === "obligation";
    const refuse = (rule: string, key: string, message: string) => refusals.push({ rule, path: at + key, message });
    if (!plain(check)) {
        refuse("check_values", "", "a check declaration must be an object");
        return refusals;
    }
    if (owner.kind === "mod") {
        const trigger = triggerRefusal("mod", check.trigger, at + "trigger");
        if (trigger) refusals.push(trigger);
    }
    const scopes: readonly string[] = SCOPES[owner.kind];
    if (!scopes.includes(check.scope))
        refuse("check_scope", "scope", `scope must be ${scopes.join(" or ")}`);
    else if (obligation && (check.scope === "actor-target") !== Object.hasOwn(check, "target"))
        refuse("check_scope", "target", "an actor-target check names its target and an actor check names none");
    // Accounting, not content: an unstated skill or difficulty is recorded, never filled.
    const unstated = (key: string): boolean => {
        if (!obligation || !Object.hasOwn(check, key)) return false;
        if (check[key] !== true) refuse(key === "difficulty_unstated" ? "check_difficulty" : "check_values", key, `${key} is true or absent`);
        return check[key] === true;
    };
    const approachesUnstated = unstated("approaches_unstated"), difficultyUnstated = unstated("difficulty_unstated");
    const selections: readonly string[] = SELECTIONS[owner.kind];
    if (approachesUnstated) {
        if (Object.hasOwn(check, "selection")) refuse("check_selection", "selection", "a check whose approaches are unstated has no selection");
        if (Object.hasOwn(check, "values")) refuse("check_values", "values", "a check whose approaches are unstated has no values");
    } else {
        if (!selections.includes(check.selection))
            refuse("check_selection", "selection", `selection must be ${selections.join(" or ")}`);
        const values = check.values;
        if (!Array.isArray(values) || !values.length)
            refuse("check_values", "values", "values must be a non-empty list of {path, label}");
        else values.forEach((value: any, index: number) => valueRefusals(value, owner, `values[${index}]`, refuse));
    }
    if (difficultyUnstated ? Object.hasOwn(check, "difficulty") : !DIFFICULTIES.includes(check.difficulty))
        refuse("check_difficulty", "difficulty", difficultyUnstated ? "a check whose difficulty is unstated has no difficulty"
            : `difficulty must be ${DIFFICULTIES.join(", ")} (or absent with difficulty_unstated)`);
    const results = check.results;
    if (!plain(results) || sorted(Object.keys(results)).join(",") !== sorted(LEVELS).join(","))
        refuse("check_results", "results", `results must define exactly ${LEVELS.join(", ")}`);
    else if (obligation)
        for (const level of LEVELS) {
            const entry = results[level];
            if (!plain(entry) || unknownKeys(entry, ["book", "settles"]).length || typeof entry.settles !== "boolean"
                || (Object.hasOwn(entry, "book") && !text(entry.book)))
                refuse("check_results", `results.${level}`, "an obligation's result level is {settles: boolean, book?: one line}");
        }
    if (obligation && Object.hasOwn(check, "push")) {
        const push = check.push;
        if (!plain(push) || unknownKeys(push, ["allowed", "book"]).length || typeof push.allowed !== "boolean"
            || (Object.hasOwn(push, "book") && !text(push.book)))
            refuse("check_results", "push", "push is {allowed: boolean, book?: one line}");
    }
    return refusals;
}

function valueRefusals(value: any, owner: CheckOwner, key: string, refuse: (rule: string, key: string, message: string) => void): void {
    if (!plain(value) || typeof value.path !== "string" || !text(value.label)) {
        refuse("check_values", key, "each value is {path, label}");
        return;
    }
    const obligation = owner.kind === "obligation";
    if (obligation && unknownKeys(value, VALUE_KEYS).length)
        refuse("obligation_unknown_key", key, `a value carries only ${VALUE_KEYS.join(", ")}`);
    const dot = value.path.indexOf("."), group = value.path.slice(0, dot), name = value.path.slice(dot + 1);
    if (dot < 0 || !["characteristics", "skills"].includes(group) || !name.trim()) {
        refuse("check_values", `${key}.path`, "a value path is characteristics.<name> or skills.<name>");
        return;
    }
    if (Object.hasOwn(value, "minimum")) {
        // §134.3: the Mod resolver reads no threshold, so a Mod may not declare one it would silently ignore.
        if (!obligation)
            refuse("check_values", `${key}.minimum`, "a Mod check cannot declare a minimum; the Mod resolver reads none");
        else if (!Number.isInteger(value.minimum) || value.minimum < 1 || value.minimum > 100)
            refuse("check_values", `${key}.minimum`, "minimum is an integer from 1 to 100");
    }
    if (owner.kind === "obligation") {
        const table = group === "skills" ? owner.skills : owner.characteristics;
        if (!table.some(entry => normalize(entry) === normalize(name)))
            refuse("check_unknown_skill", `${key}.path`, `${repr(name)} is not a ${group === "skills" ? "skill" : "characteristic"} of the ruleset`);
    }
}
const repr = (value: string): string => JSON.stringify(value);

/** The nodes that state an obligation: `requirement` nodes carrying `properties.obligation`. */
export const statedObligations = (graph: ModuleGraph): Row[] =>
    graph.kind("requirement").filter(node => Object.hasOwn(row(node.properties), "obligation"));

/**
 * §134.3: every refusal the module's stated obligations earn. Starter registration calls this before
 * a generation's bytes are written; `starter` also requires the node's `evidence_span_ids`.
 */
export function obligationRefusals(graph: ModuleGraph, rules: { skills: readonly string[]; characteristics: readonly string[] }, options: { starter: boolean }): Refusal[] {
    const refusals: Refusal[] = [], owner: CheckOwner = { kind: "obligation", ...rules };
    const nodes = statedObligations(graph), owners = new Map<string, string>(), after = new Map<string, string>();
    const claims = array(graph.raw.claims).filter(claim => plain(claim) && claim.predicate === "has-requirement");
    for (const node of nodes) {
        const id = string(node.node_id), base = "properties.obligation";
        const refuse = (rule: string, path: string, message: string) => refusals.push({ node: id, rule, path, message });
        const kindOf = (value: any, kind: string): boolean => typeof value === "string" && graph.nodes.get(value)?.node_kind === kind;
        const ob = row(node.properties).obligation;
        if (!array(node.source_refs).length || !array(node.source_refs).every(plain)
            || options.starter && (!array(node.evidence_span_ids).length || !array(node.evidence_span_ids).every(text)))
            refuse("obligation_unsourced", "source_refs", "an obligation cites the page that states it (source_refs, and evidence_span_ids on a starter)");
        if (!plain(ob)) {
            refuse("obligation_unknown_key", base, "properties.obligation must be an object");
            continue;
        }
        for (const key of unknownKeys(ob, OBLIGATION_KEYS))
            refuse("obligation_unknown_key", `${base}.${key}`, `an obligation carries only ${OBLIGATION_KEYS.join(", ")}`);
        const sceneOk = kindOf(ob.scene, "scene");
        if (!sceneOk) refuse("obligation_unresolved", `${base}.scene`, "scene must name a scene node");
        const links = claims.filter(claim => row(claim.object).node_id === id);
        if (links.length !== 1 || links[0].subject_id !== ob.scene)
            refuse("obligation_unlinked", `${base}.scene`, "the scene links this node by exactly one has-requirement claim");
        const seated = sceneOk ? graph.sceneNpcIds(graph.nodes.get(ob.scene)!) : [];
        const person = (value: any, path: string) => {
            if (!kindOf(value, "npc")) refuse("obligation_unresolved", path, "must name an npc node");
            else if (sceneOk && !seated.includes(value)) refuse("obligation_not_seated", path, "must be seated in the obligation's scene (present-in or npc_ids)");
        };
        if (Object.hasOwn(ob, "who")) person(ob.who, `${base}.who`);
        if (Object.hasOwn(ob, "reaction") && ob.reaction !== "preordained")
            refuse("obligation_reaction", `${base}.reaction`, "reaction is preordained or absent");
        // The trigger: attempt guards graph nodes; after names another obligation.
        const trigger = ob.trigger, guarded: string[] = [];
        const triggerKind = plain(trigger) ? trigger.kind : undefined, wrong = triggerRefusal("obligation", triggerKind, `${base}.trigger.kind`);
        if (wrong) refusals.push({ node: id, ...wrong });
        else if (triggerKind === "attempt") {
            for (const key of unknownKeys(trigger, ["guards", "kind"]))
                refuse("obligation_unknown_key", `${base}.trigger.${key}`, "an attempt trigger carries only kind and guards");
            const guards = plain(trigger.guards) ? trigger.guards : {};
            for (const key of unknownKeys(guards, ["clues", "exits", "people"]))
                refuse("obligation_unknown_key", `${base}.trigger.guards.${key}`, "guards name clues, exits and people");
            for (const [key, kind] of [["clues", "clue"], ["exits", "scene"], ["people", "npc"]] as const) {
                if (!Object.hasOwn(guards, key)) continue;
                const list = guards[key];
                if (!Array.isArray(list)) { refuse("obligation_unresolved", `${base}.trigger.guards.${key}`, `guards.${key} is a list of ${kind} node ids`); continue; }
                list.forEach((value: any, index: number) => {
                    if (!kindOf(value, kind)) refuse("obligation_unresolved", `${base}.trigger.guards.${key}[${index}]`, `must name a ${kind} node`);
                    else if (kind === "clue") guarded.push(value);
                });
            }
            if (!["clues", "exits", "people"].some(key => Array.isArray(guards[key]) && guards[key].length))
                refuse("obligation_empty_guards", `${base}.trigger.guards`, "an attempt guards at least one clue, exit or person");
        } else {
            for (const key of unknownKeys(trigger, ["kind", "obligation"]))
                refuse("obligation_unknown_key", `${base}.trigger.${key}`, "an after trigger carries only kind and obligation");
            if (!nodes.some(other => other.node_id === trigger.obligation))
                refuse("obligation_unresolved", `${base}.trigger.obligation`, "after names another stated obligation of this module");
            else after.set(id, trigger.obligation);
        }
        // The demand: an ordered, closed list of steps.
        const demand = ob.demand;
        if (!Array.isArray(demand) || !demand.length)
            refuse("obligation_empty_demand", `${base}.demand`, "demand is a non-empty list of meet, check and cost steps");
        else demand.forEach((step: any, index: number) => {
            const at = `${base}.demand[${index}]`;
            if (!plain(step) || !["meet", "check", "cost"].includes(step.kind)) {
                refuse("obligation_empty_demand", at, "a step is meet, check or cost");
                return;
            }
            const allowed = step.kind === "meet" ? ["kind", "npc"] : step.kind === "cost" ? ["book", "kind"] : CHECK_STEP_KEYS;
            for (const key of unknownKeys(step, allowed))
                refuse("obligation_unknown_key", `${at}.${key}`, `a ${step.kind} step carries only ${allowed.join(", ")}`);
            if (step.kind === "meet") person(step.npc, `${at}.npc`);
            else if (step.kind === "cost") {
                if (!text(step.book)) refuse("obligation_empty_demand", `${at}.book`, "a cost step is one Keeper-only book line");
            } else {
                for (const refusal of checkDeclarationRefusals(step, owner, `${at}.`)) refusals.push({ node: id, ...refusal });
                if (Object.hasOwn(step, "target") && !kindOf(step.target, "npc"))
                    refuse("obligation_unresolved", `${at}.target`, "target must name an npc node");
                // One check, one owner: a single-skill step equal to a guarded clue's own gate repeats it.
                const values = array(step.values), only = values.length === 1 ? string(row(values[0]).path) : "";
                if (only.startsWith("skills."))
                    for (const clue of guarded) {
                        const profile = graph.clueProfile(graph.nodes.get(clue)!);
                        if (text(profile.skill) && normalize(profile.skill) === normalize(only.slice("skills.".length)) && profile.difficulty === step.difficulty)
                            refuse("obligation_repeats_clue_gate", at, `repeats the gate of ${clue}; keep the clue's gate or move it here and delete it there`);
                    }
            }
        });
        const settles = ob.settles;
        if (!plain(settles) || sorted(Object.keys(settles)).join(",") !== "flag_id,kind" || settles.kind !== "flag_set"
            || typeof settles.flag_id !== "string" || !SEMANTIC_ID.test(settles.flag_id))
            refuse("obligation_settles", `${base}.settles`, "settles is {kind: \"flag_set\", flag_id: <semantic id>}");
        else if (owners.has(settles.flag_id))
            refuse("obligation_flag_reused", `${base}.settles.flag_id`, `${settles.flag_id} is already settled by ${owners.get(settles.flag_id)}`);
        else owners.set(settles.flag_id, id);
    }
    for (const start of after.keys()) {
        const seen = new Set<string>([start]);
        for (let next = after.get(start); next != null; next = after.get(next)) {
            if (seen.has(next)) {
                refusals.push({ node: start, rule: "obligation_after_cycle", path: "properties.obligation.trigger.obligation", message: "the after chain returns to an obligation already on it" });
                break;
            }
            seen.add(next);
        }
    }
    return refusals;
}
