/**
 * Contract §136: the closed catalog of mechanical shapes a module states, and the one validator that
 * refuses a malformed one.
 *
 * A shape sits in `mechanics.<shape>` of the stating node's record view (`recordOf`), or in one of the
 * registered seats the catalog names without moving them (`combat.defense` for `tactic`, a threat
 * clock's `advances_on`; the obligation keeps its own validator in `obligation-shape.ts`). The check
 * form is shared with Mods and obligations through `checkDeclarationRefusals`, owner `rule`.
 *
 * Refusals are data -- `{rule, path, message, node}` -- so every caller decides how to throw, and a
 * test names the rule, never the wording. Accounting, not content: nothing here requires a shape to
 * exist or a slot to be filled; a slot the page leaves out is `<slot>_unstated: true`, and a value is
 * never judged for plausibility. No prose is read into a shape: the only name matching is the
 * normalised-name match against the ruleset's own tables.
 */
import { RpcError } from "../errors.js";
import { PythonFloat } from "../json.js";
import { definitionExpression } from "../mods/definition.js";
import { recordOf, type ModuleGraph } from "../read/module-graph.js";
import { array, integer, normalize, number, row, string, type Row } from "../read/values.js";
import { validateSanLossExpression } from "../sanity/expression.js";
import { checkDeclarationRefusals, type CheckOwner, type Refusal } from "./obligation-shape.js";
import { AUTHORED_ACTION_WORDS, DISPOSITION_WORDS } from "../combat/standing-words.js";

/** The ruleset's closed tables a shape's names and references resolve against. */
export type MechanicsRules = {
    skills: readonly string[];
    /** `skills.json` `specialization_groups`: group key -> its declared entry. */
    groups: Row;
    characteristics: readonly string[];
    /** `weapons.json` ids, the targets of a weapon's `extends`. */
    weapons: readonly string[];
    /** `damage-bonus-build.json`: the `damage_bonus` of every row that is not an extrapolation. */
    damageBonuses: readonly string[];
};

/** §136.1: each container shape and the node kinds it may sit on. */
const SHAPE_KINDS: Record<string, readonly string[]> = {
    profile: ["npc", "creature"],
    check: ["rule", "hazard"],
    hazard: ["rule", "hazard"],
    damage: ["rule", "hazard"],
    sanity_loss: ["rule", "hazard", "object", "artifact"],
    time_cost: ["rule", "hazard"],
    resource_cost: ["rule", "hazard", "object", "artifact"],
    weapon: ["object", "artifact"],
    spell: ["spell"],
    tome: ["tome"],
    reward: ["rule"],
};
/**
 * §136.1, rulings A and B: the starter-only legacy allowance. Each list shrinks as a starter migrates
 * (RD-04 the haunting, RD-08 mystery-house); a reader draft gets none of it.
 */
export const STARTER_LEGACY = {
    container: ["fields_extracted", "fields_not_authored", "fields_observed", "provenance", "source_refs", "status", "subject_kind"],
    profile: ["attacks", "attacks_per_round", "san_loss_to_see"],
    weapon: ["note"],
} as const;
const TACTIC_KINDS = ["npc", "creature"];
const DEFENSES = ["dodge", "fight_back", "none"];
/** The record's `combat` words: the standing defence (§11.5.2), the authored standing action and disposition (§11.5.3). */
const COMBAT_WORDS: ReadonlyArray<readonly [string, readonly string[]]> = [["defense", DEFENSES], ["action", AUTHORED_ACTION_WORDS], ["disposition", DISPOSITION_WORDS]];
const TIME_UNITS = ["round", "minute", "hour", "day", "week"];
const RESOURCES = ["mp", "pow", "san", "luck", "hp"];
const PER = ["use", "round", "cast"];
const CHARACTERISTICS = ["STR", "CON", "SIZ", "DEX", "APP", "INT", "POW", "EDU"];
const DERIVED_INTEGERS = ["HP", "MP", "MOV", "Build", "SAN"];
const ARMOR_RULES = ["degrades_1_per_damage"];
const EFFECT_KINDS = ["damage", "sanity_loss", "time", "cost", "flag", "clock", "next_step", "book"];
/** The graph contract's semantic id law, as §134.4 applies it to flags. */
const SEMANTIC_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

const plain = (value: any): value is Row => value != null && typeof value === "object" && !Array.isArray(value) && !(value instanceof PythonFloat);
const text = (value: any): value is string => typeof value === "string" && Boolean(value.trim());
const numeric = (value: any): boolean => typeof value === "bigint" || value instanceof PythonFloat || typeof value === "number" && Number.isFinite(value);
const count = (value: any): boolean => integer(value) && number(value) >= 0;
const repr = (value: any): string => JSON.stringify(value);

/**
 * §136.3: an authored dice string. `definitionExpression` is the law; the string must also be its
 * canonical spelling, roll at least one die and subtract none, so both rollers of authored dice
 * (`rollExpression`, `CombatSession.rollDamageExpression`) read every string this accepts.
 */
export function diceRefusal(value: any, field: string): string | null {
    if (typeof value !== "string") return `${field} is a dice string such as 1D6 or 2D6+2`;
    let canonical: string;
    try { canonical = definitionExpression(value, field === "damage" ? "damage" : field); }
    catch (error) { if (error instanceof RpcError) return `${field} ${repr(value)} is not a dice expression (contract §136.3)`; throw error; }
    if (canonical !== value) return `${field} is written ${repr(canonical)}`;
    if (!/[0-9]D[0-9]/.test(value)) return `${field} ${repr(value)} rolls no die; a fixed quantity is an integer`;
    if (/-[0-9]+D/.test(value)) return `${field} ${repr(value)} subtracts a die, which the combat roller cannot read`;
    return null;
}
/** §136.3: one Sanity half -- "0", or a string both the definition grammar and the sanity grammar accept. */
export function sanityHalfRefusal(value: any, field: string): string | null {
    if (value === "0") return null;
    if (typeof value !== "string") return `${field} is a Sanity string such as "1" or "1D4"`;
    let canonical: string;
    try { canonical = definitionExpression(value, field); }
    catch (error) { if (error instanceof RpcError) return `${field} ${repr(value)} is not a Sanity expression`; throw error; }
    try { validateSanLossExpression(value); }
    catch (error) { if ((error as Error).name === "ValueError") return `${field} ${repr(value)} is not a Sanity expression: ${(error as Error).message}`; throw error; }
    return canonical === value ? null : `${field} is written ${repr(canonical)}`;
}

/** §136.4 (ruling C): whether a skill or characteristic name resolves in the ruleset's tables. */
export function nameResolves(rules: MechanicsRules, group: "skills" | "characteristics", name: string): boolean {
    const key = normalize(name);
    if (!key) return false;
    if (group === "characteristics") return rules.characteristics.some(entry => normalize(entry) === key);
    if (rules.skills.some(entry => normalize(entry) === key)) return true;
    const groupKeys = Object.keys(rules.groups);
    if (groupKeys.some(entry => normalize(entry) === key)) return true;
    for (const groupKey of groupKeys) {
        const nested = /^(.*) \((.*)\)$/.exec(groupKey);
        const literal = `${normalize(groupKey)} (`, nestedPrefix = nested ? `${normalize(nested[1])} (${normalize(nested[2])}: ` : null;
        let member: string | null = null;
        if (key.startsWith(literal) && key.endsWith(")")) member = key.slice(literal.length, -1).trim();
        else if (nestedPrefix && key.startsWith(nestedPrefix) && key.endsWith(")")) member = key.slice(nestedPrefix.length, -1).trim();
        if (!member) continue;
        const declared = row(rules.groups[groupKey]).specializations;
        const members = Array.isArray(declared) ? declared.map(string) : plain(declared) ? Object.keys(declared) : null;
        // An open group admits whatever the book names; an enumerating group only its own members.
        if (!members || members.some(entry => normalize(entry) === member)) return true;
    }
    return false;
}

type Refuse = (rule: string, path: string, message: string) => void;

/** The nodes a module states a mechanic on, and where: for tests and for the caller's short-circuit. */
export function carriesMechanics(graph: ModuleGraph): boolean {
    for (const node of graph.nodes.values()) {
        const record = recordOf(node);
        if (Object.hasOwn(record, "mechanics") || Object.hasOwn(record, "combat")) return true;
        if (array(record.clocks).some(clock => plain(clock) && Object.hasOwn(clock, "advances_on"))) return true;
    }
    return false;
}

/**
 * §136.8: every refusal the module's stated mechanics earn. Starter registration calls it after
 * `obligationRefusals`, before a generation's bytes are written; `starter` admits the listed legacy
 * allowance and requires `evidence_span_ids` beside `source_refs`.
 */
export function mechanicsRefusals(graph: ModuleGraph, rules: MechanicsRules, options: { starter: boolean }): Refusal[] {
    const refusals: Refusal[] = [];
    const owner: CheckOwner = { kind: "rule", resolves: (group, name) => nameResolves(rules, group, name) };
    const clockIds = new Set<string>();
    for (const threat of graph.kind("threat"))
        for (const clock of array(recordOf(threat).clocks))
            if (plain(clock) && text(clock.clock_id)) clockIds.add(clock.clock_id);
    const calledChecks = checksCalledByObligations(graph);

    for (const node of graph.nodes.values()) {
        const id = string(node.node_id), kind = string(node.node_kind), props = row(node.properties);
        const hasRecord = plain(row(props.runtime_projection).record), record = recordOf(node);
        const base = hasRecord ? "properties.runtime_projection.record" : "properties";
        const refuse: Refuse = (rule, path, message) => refusals.push({ node: id, rule, path, message });
        const kindOf = (value: any, kinds: readonly string[]): boolean => typeof value === "string" && kinds.includes(string(graph.nodes.get(value)?.node_kind));
        const shape = new ShapeChecker(refuse, rules, owner, kindOf, clockIds, options.starter);
        let sourced = false;

        if (Object.hasOwn(record, "mechanics")) {
            const mechanics = record.mechanics, at = `${base}.mechanics`;
            if (!plain(mechanics)) refuse("mechanics_unknown_shape", at, "mechanics is an object of shapes (contract §136.1)");
            else for (const [key, value] of Object.entries(mechanics)) {
                if (options.starter && (STARTER_LEGACY.container as readonly string[]).includes(key)) continue;
                const kinds = SHAPE_KINDS[key];
                if (!kinds) {
                    refuse("mechanics_unknown_shape", `${at}.${key}`, key === "tactic"
                        ? "an NPC's defence is the record's combat.defense (contract §136.1); there is no mechanics.tactic"
                        : `mechanics carries only ${Object.keys(SHAPE_KINDS).join(", ")}`);
                    continue;
                }
                if (!kinds.includes(kind)) refuse("mechanics_wrong_kind", `${at}.${key}`, `${key} sits only on ${kinds.join(", ")} nodes`);
                // A starter's lone registered stat block is cited inside the legacy container while the allowance stands.
                if (!(options.starter && key === "profile")) sourced = true;
                shape.shape(key, value, `${at}.${key}`);
                if (key === "check" && calledChecks.has(id)) for (const called of calledChecks.get(id)!)
                    if (plain(value) && sameCheck(value, called.step))
                        refuse("shape_duplicate", `${at}.check`, `repeats the check of obligation ${called.obligation}; one check has one owner`);
                if (key === "hazard" && plain(value)) hazardDuplicates(graph, value, `${at}.hazard`, refuse);
            }
        }
        if (Object.hasOwn(record, "combat")) {
            const combat = record.combat, at = `${base}.combat`;
            sourced = true;
            if (!TACTIC_KINDS.includes(kind)) refuse("mechanics_wrong_kind", at, "combat (defense, action, disposition) sits only on npc and creature records");
            // §11.5.2 `defense`, §11.5.3 `action` and `disposition`: each optional, each a closed word, at least one.
            if (!plain(combat) || !COMBAT_WORDS.some(([key]) => Object.hasOwn(combat, key))) refuse("shape_prose", at, "combat is {defense?, action?, disposition?}, at least one");
            else {
                for (const key of Object.keys(combat).filter(key => !COMBAT_WORDS.some(([name]) => name === key)))
                    refuse("shape_unknown_key", `${at}.${key}`, "combat carries only defense, action and disposition");
                for (const [key, words] of COMBAT_WORDS)
                    if (Object.hasOwn(combat, key) && !words.includes(combat[key])) refuse("shape_prose", `${at}.${key}`, `${key} is ${words.join(", ")}`);
            }
        }
        array(record.clocks).forEach((clock: any, index: number) => {
            if (!plain(clock) || !Object.hasOwn(clock, "advances_on")) return;
            const at = `${base}.clocks[${index}].advances_on`;
            sourced = true;
            if (kind !== "threat") refuse("mechanics_wrong_kind", at, "advances_on sits only on a threat record's clock");
            const list = clock.advances_on;
            if (!Array.isArray(list) || !list.length) { refuse("shape_prose", at, "advances_on is a non-empty list of {kind: \"enter\", scene}"); return; }
            list.forEach((entry: any, i: number) => {
                if (!plain(entry)) { refuse("shape_prose", `${at}[${i}]`, "each entry is {kind: \"enter\", scene}"); return; }
                for (const key of Object.keys(entry).filter(key => !["kind", "scene"].includes(key)))
                    refuse("shape_unknown_key", `${at}[${i}].${key}`, "an advance carries only kind and scene");
                if (entry.kind !== "enter") refuse("shape_prose", `${at}[${i}].kind`, "kind is enter");
                if (!kindOf(entry.scene, ["scene"])) refuse("shape_unresolved", `${at}[${i}].scene`, "scene must name a scene node");
            });
        });
        if (sourced && (!array(node.source_refs).length || !array(node.source_refs).every(plain)
            || options.starter && (!array(node.evidence_span_ids).length || !array(node.evidence_span_ids).every(text))))
            refuse("mechanics_unsourced", "source_refs", "a node stating a mechanic cites the page that states it (source_refs, and evidence_span_ids on a starter)");
    }
    return refusals;
}

/** A hazard whose attempt guards a clue repeats that clue's gate when one of its steps is that gate. */
function hazardDuplicates(graph: ModuleGraph, hazard: Row, at: string, refuse: Refuse): void {
    const trigger = row(hazard.trigger), clues = trigger.kind === "attempt" ? array(row(trigger.guards).clues) : [];
    array(hazard.steps).forEach((step: any, index: number) => {
        const values = array(row(step).values), only = values.length === 1 ? string(row(values[0]).path) : "";
        if (!only.startsWith("skills.")) return;
        for (const clue of clues) {
            const node = typeof clue === "string" ? graph.nodes.get(clue) : undefined;
            if (!node || node.node_kind !== "clue") continue;
            const gate = graph.clueProfile(node);
            if (text(gate.skill) && normalize(gate.skill) === normalize(only.slice("skills.".length)) && gate.difficulty === step.difficulty)
                refuse("shape_duplicate", `${at}.steps[${index}]`, `repeats the gate of ${clue}; keep the clue's gate or state it here and delete it there`);
        }
    });
}

/** Every check step of a stated obligation, keyed by the node its requirement calls by `calls-for-check`. */
function checksCalledByObligations(graph: ModuleGraph): Map<string, Array<{ obligation: string; step: Row }>> {
    const called = new Map<string, Array<{ obligation: string; step: Row }>>();
    for (const claim of array(graph.raw.claims)) {
        if (!plain(claim) || claim.predicate !== "calls-for-check") continue;
        const requirement = graph.nodes.get(string(claim.subject_id)), target = string(row(claim.object).node_id);
        const obligation = row(row(requirement?.properties).obligation);
        if (!requirement || !target) continue;
        for (const step of array(obligation.demand))
            if (plain(step) && step.kind === "check")
                called.set(target, [...(called.get(target) ?? []), { obligation: string(requirement.node_id), step }]);
    }
    return called;
}
const valuePaths = (check: Row): string => array(check.values).map(value => normalize(string(row(value).path))).sort().join("|");
const sameCheck = (a: Row, b: Row): boolean => valuePaths(a) !== "" && valuePaths(a) === valuePaths(b) && a.selection === b.selection && a.difficulty === b.difficulty;

/** The per-shape closures of §136.6. */
class ShapeChecker {
    constructor(private readonly refuse: Refuse, private readonly rules: MechanicsRules, private readonly owner: CheckOwner,
        private readonly kindOf: (value: any, kinds: readonly string[]) => boolean, private readonly clockIds: ReadonlySet<string>,
        private readonly starter: boolean) { }

    shape(key: string, value: any, at: string): void {
        switch (key) {
            case "profile": return this.statBlock(value, at);
            case "check": return this.check(value, at, null);
            case "hazard": return this.hazard(value, at);
            case "damage": return this.damage(value, at);
            case "sanity_loss": return this.sanityLoss(value, at);
            case "time_cost": return this.timeCost(value, at);
            case "resource_cost": return this.resourceCost(value, at);
            case "weapon": return this.weapon(value, at);
            case "spell": return this.spell(value, at);
            case "tome": return this.tome(value, at);
            case "reward": return this.reward(value, at);
        }
    }

    /** An object with closed keys; returns false (after refusing) when it is not an object. */
    private object(value: any, at: string, keys: readonly string[], what: string): value is Row {
        if (!plain(value)) { this.refuse("shape_prose", at, `${what} is an object`); return false; }
        for (const key of Object.keys(value).filter(key => !keys.includes(key)))
            this.refuse("shape_unknown_key", `${at}.${key}`, `${what} carries only ${keys.join(", ")}`);
        if (Object.hasOwn(value, "book") && keys.includes("book") && !text(value.book))
            this.refuse("shape_prose", `${at}.book`, "book is one non-empty line");
        return true;
    }
    /**
     * §136.2: a slot and its `_unstated` twin. Returns true when the value is present (and should be
     * checked by the caller); refuses both present, a twin that is not true, and neither for a needed slot.
     */
    private slot(value: Row, key: string, at: string, needed: boolean, alternatives: string[] = []): boolean {
        const twin = `${key}_unstated`, present = Object.hasOwn(value, key), marked = Object.hasOwn(value, twin);
        if (marked && value[twin] !== true) this.refuse("shape_prose", `${at}.${twin}`, `${twin} is true or absent`);
        const others = alternatives.filter(other => Object.hasOwn(value, other));
        if ([present, marked, ...others.map(() => true)].filter(Boolean).length > 1)
            this.refuse("shape_unstated", `${at}.${key}`, `state ${[key, twin, ...alternatives].join(" or ")}, exactly one`);
        else if (needed && !present && !marked && !others.length)
            this.refuse("shape_unstated", `${at}.${key}`, `${key} is stated, or recorded as ${twin}: true`);
        return present;
    }
    private integerIn(value: Row, key: string, at: string, low = 0, high = Number.MAX_SAFE_INTEGER): void {
        const item = value[key];
        if (!integer(item) || number(item) < low || number(item) > high)
            this.refuse("shape_prose", `${at}.${key}`, `${key} is an integer from ${low}${high === Number.MAX_SAFE_INTEGER ? "" : ` to ${high}`}`);
    }
    private dice(value: Row, key: string, at: string, field = key): void {
        const problem = diceRefusal(value[key], field);
        if (problem) this.refuse("shape_dice", `${at}.${key}`, problem);
    }
    /** `<int|DICE>`: a count as an integer, or a dice string. */
    private amount(value: Row, key: string, at: string): void {
        if (typeof value[key] === "string") this.dice(value, key, at, key);
        else if (!count(value[key])) this.refuse("shape_prose", `${at}.${key}`, `${key} is an integer or a dice string`);
    }
    private sanityHalf(value: Row, key: string, at: string): void {
        const problem = sanityHalfRefusal(value[key], key);
        if (problem) this.refuse("shape_dice", `${at}.${key}`, problem);
    }
    private enumeration(value: Row, key: string, at: string, allowed: readonly string[]): void {
        if (!allowed.includes(value[key])) this.refuse("shape_prose", `${at}.${key}`, `${key} is ${allowed.join(", ")}`);
    }
    private skill(value: any, at: string, group: "skills" | "characteristics" = "skills"): void {
        if (!text(value)) this.refuse("shape_prose", at, "a skill is named by its ruleset name");
        else if (!nameResolves(this.rules, group, value)) this.refuse("shape_unknown_skill", at, `${repr(value)} is not a ${group === "skills" ? "skill" : "characteristic"} of the ruleset (contract §136.4)`);
    }
    private references(value: Row, key: string, at: string, kinds: readonly string[]): void {
        const list = value[key];
        if (!Array.isArray(list)) { this.refuse("shape_prose", `${at}.${key}`, `${key} is a list of ${kinds.join(" or ")} node ids`); return; }
        list.forEach((item: any, index: number) => {
            if (!this.kindOf(item, kinds)) this.refuse("shape_unresolved", `${at}.${key}[${index}]`, `must name a ${kinds.join(" or ")} node`);
        });
    }

    check(value: any, at: string, steps: number | null, index = 0): void {
        for (const refusal of checkDeclarationRefusals(value, this.owner, `${at}.`)) this.refuse(refusal.rule, refusal.path, refusal.message);
        if (!plain(value)) return;
        if (Object.hasOwn(value, "target") && !this.kindOf(value.target, TACTIC_KINDS))
            this.refuse("shape_unresolved", `${at}.target`, "target must name an npc or creature node");
        for (const [level, entry] of Object.entries(row(value.results)))
            if (Array.isArray(row(entry).effects)) this.effects(entry.effects, `${at}.results.${level}.effects`, steps, index);
        if (Array.isArray(row(value.push).effects)) this.effects(value.push.effects, `${at}.push.effects`, steps, index);
    }
    private effects(list: any[], at: string, steps: number | null, index: number): void {
        list.forEach((effect: any, i: number) => {
            const where = `${at}[${i}]`;
            if (!plain(effect) || !EFFECT_KINDS.includes(effect.kind)) {
                this.refuse("shape_effect", where, `an effect is {kind, ...} with kind among ${EFFECT_KINDS.join(", ")}`);
                return;
            }
            const { kind: _kind, ...rest } = effect;
            switch (effect.kind) {
                case "damage": return this.damage(rest, where);
                case "sanity_loss": return this.sanityLoss(rest, where);
                case "time": return this.timeCost(rest, where);
                case "cost": return this.resourceCost(rest, where);
                case "flag":
                    if (!this.object(rest, where, ["flag_id", "value"], "a flag effect")) return;
                    if (typeof rest.flag_id !== "string" || !SEMANTIC_ID.test(rest.flag_id)) this.refuse("shape_prose", `${where}.flag_id`, "flag_id is a semantic id");
                    if (typeof rest.value !== "boolean") this.refuse("shape_prose", `${where}.value`, "value is a boolean");
                    return;
                case "clock":
                    if (!this.object(rest, where, ["clock_id", "ticks"], "a clock effect")) return;
                    if (!this.clockIds.has(rest.clock_id)) this.refuse("shape_unresolved", `${where}.clock_id`, "clock_id must name a clock of a threat of this module");
                    this.integerIn(rest, "ticks", where, 1);
                    return;
                case "next_step":
                    if (!this.object(rest, where, ["step"], "a next_step effect")) return;
                    if (steps === null) this.refuse("shape_effect", where, "next_step exists only inside a hazard's steps");
                    else if (!integer(rest.step) || number(rest.step) <= index || number(rest.step) >= steps)
                        this.refuse("shape_effect", `${where}.step`, `next_step names a later step of this hazard (${index + 1} to ${steps - 1})`);
                    return;
                case "book":
                    if (!this.object(rest, where, ["line"], "a book effect")) return;
                    if (!text(rest.line)) this.refuse("shape_prose", `${where}.line`, "line is one non-empty line");
                    return;
            }
        });
    }
    private gate(value: any, at: string): void {
        if (!plain(value)) { this.refuse("shape_prose", at, "a gate is {kind, ...}"); return; }
        if (value.kind === "always") this.object(value, at, ["kind"], "an always gate");
        else if (value.kind === "clue_discovered") {
            if (this.object(value, at, ["clue_id", "kind"], "a clue_discovered gate") && !this.kindOf(value.clue_id, ["clue"]))
                this.refuse("shape_unresolved", `${at}.clue_id`, "clue_id must name a clue node");
        } else if (value.kind === "flag_set") {
            if (!this.object(value, at, ["flag_id", "kind", "value"], "a flag_set gate")) return;
            if (typeof value.flag_id !== "string" || !SEMANTIC_ID.test(value.flag_id)) this.refuse("shape_prose", `${at}.flag_id`, "flag_id is a semantic id");
            if (Object.hasOwn(value, "value") && typeof value.value !== "boolean") this.refuse("shape_prose", `${at}.value`, "value is a boolean");
        } else this.refuse("shape_prose", `${at}.kind`, "a gate's kind is always, clue_discovered or flag_set");
    }
    private hazard(value: any, at: string): void {
        if (!this.object(value, at, ["book", "effects", "steps", "trigger", "when"], "a hazard")) return;
        const trigger = value.trigger;
        if (!plain(trigger) || !["keeper", "enter", "attempt"].includes(trigger.kind))
            this.refuse(plain(trigger) || Object.hasOwn(value, "trigger") ? "shape_prose" : "shape_unstated", `${at}.trigger`, "trigger is {kind: keeper | enter | attempt}");
        else if (trigger.kind !== "attempt") this.object(trigger, `${at}.trigger`, ["kind"], `a ${trigger.kind} trigger`);
        else if (this.object(trigger, `${at}.trigger`, ["guards", "kind"], "an attempt trigger")) {
            const guards = trigger.guards;
            if (this.object(guards, `${at}.trigger.guards`, ["clues", "exits", "people"], "guards")) {
                for (const [key, kinds] of [["clues", ["clue"]], ["exits", ["scene"]], ["people", TACTIC_KINDS]] as const)
                    if (Object.hasOwn(guards, key)) this.references(guards, key, `${at}.trigger.guards`, kinds);
                if (!["clues", "exits", "people"].some(key => Array.isArray(guards[key]) && guards[key].length))
                    this.refuse("shape_unresolved", `${at}.trigger.guards`, "an attempt guards at least one clue, exit or person");
            }
        }
        if (Object.hasOwn(value, "when")) this.gate(value.when, `${at}.when`);
        if (Object.hasOwn(value, "steps")) {
            if (!Array.isArray(value.steps) || !value.steps.length) this.refuse("shape_prose", `${at}.steps`, "steps is a non-empty list of checks");
            else value.steps.forEach((step: any, index: number) => this.check(step, `${at}.steps[${index}]`, value.steps.length, index));
        }
        if (Object.hasOwn(value, "effects")) {
            if (!Array.isArray(value.effects)) this.refuse("shape_prose", `${at}.effects`, "effects is a list");
            else this.effects(value.effects, `${at}.effects`, null, 0);
        }
    }
    private damage(value: any, at: string): void {
        if (!this.object(value, at, ["book", "dice", "dice_unstated"], "damage")) return;
        if (this.slot(value, "dice", at, true)) this.dice(value, "dice", at, "damage");
    }
    private sanityLoss(value: any, at: string): void {
        if (!this.object(value, at, ["book", "failure", "failure_unstated", "success", "success_unstated"], "a sanity loss")) return;
        for (const half of ["success", "failure"])
            if (this.slot(value, half, at, true)) this.sanityHalf(value, half, at);
    }
    private timeCost(value: any, at: string): void {
        if (!this.object(value, at, ["amount", "amount_unstated", "book", "minimum", "unit"], "a time cost")) return;
        if (this.slot(value, "amount", at, true)) {
            this.amount(value, "amount", at);
            if (!Object.hasOwn(value, "unit")) this.refuse("shape_unstated", `${at}.unit`, "a stated amount names its unit");
            else this.enumeration(value, "unit", at, TIME_UNITS);
            if (Object.hasOwn(value, "minimum") && value.minimum !== true) this.refuse("shape_prose", `${at}.minimum`, "minimum is true or absent");
        } else for (const key of ["unit", "minimum"].filter(key => Object.hasOwn(value, key)))
            this.refuse("shape_unstated", `${at}.${key}`, `an unstated amount has no ${key}`);
    }
    private resourceCost(value: any, at: string): void {
        if (!this.object(value, at, ["amount", "amount_unstated", "book", "chosen", "per", "resource"], "a resource cost")) return;
        if (!Object.hasOwn(value, "resource")) this.refuse("shape_unstated", `${at}.resource`, "a cost names its resource");
        else this.enumeration(value, "resource", at, RESOURCES);
        if (Object.hasOwn(value, "chosen") && value.chosen !== true) this.refuse("shape_prose", `${at}.chosen`, "chosen is true or absent");
        if (this.slot(value, "amount", at, true, ["chosen"])) this.amount(value, "amount", at);
        if (Object.hasOwn(value, "per")) this.enumeration(value, "per", at, PER);
    }
    weapon(value: any, at: string): void {
        const keys = ["adds_damage_bonus", "base_range_yards", "book", "damage", "damage_unstated", "extends", "impale", "impale_unstated", "magazine",
            "malfunction", "name", "skill", "skill_unstated", "uses_per_round", "uses_per_round_unstated", "weapon_id",
            ...(this.starter ? STARTER_LEGACY.weapon : [])];
        if (!this.object(value, at, keys, "a weapon")) return;
        if (Object.hasOwn(value, "weapon_id") && (typeof value.weapon_id !== "string" || !SEMANTIC_ID.test(value.weapon_id)))
            this.refuse("shape_prose", `${at}.weapon_id`, "weapon_id is a kebab id");
        const derived = Object.hasOwn(value, "extends");
        if (derived && !(typeof value.extends === "string" && this.rules.weapons.includes(value.extends)))
            this.refuse("shape_unresolved", `${at}.extends`, "extends names a weapons.json id");
        if (Object.hasOwn(value, "name") && !text(value.name)) this.refuse("shape_prose", `${at}.name`, "name is a non-empty string");
        if (this.slot(value, "skill", at, !derived)) this.skill(value.skill, `${at}.skill`);
        if (this.slot(value, "damage", at, !derived)) this.dice(value, "damage", at, "damage");
        if (this.slot(value, "uses_per_round", at, !derived)) this.integerIn(value, "uses_per_round", at, 1, 100);
        if (this.slot(value, "impale", at, !derived) && typeof value.impale !== "boolean") this.refuse("shape_prose", `${at}.impale`, "impale is a boolean");
        if (Object.hasOwn(value, "adds_damage_bonus") && typeof value.adds_damage_bonus !== "boolean")
            this.refuse("shape_prose", `${at}.adds_damage_bonus`, "adds_damage_bonus is a boolean");
        if (Object.hasOwn(value, "base_range_yards") && !(numeric(value.base_range_yards) && number(value.base_range_yards) >= 0 && number(value.base_range_yards) <= 100000))
            this.refuse("shape_prose", `${at}.base_range_yards`, "base_range_yards is a number from 0 to 100000");
        if (Object.hasOwn(value, "magazine")) this.integerIn(value, "magazine", at, 1, 1000);
        if (Object.hasOwn(value, "malfunction")) this.integerIn(value, "malfunction", at, 1, 100);
        if (Object.hasOwn(value, "note") && !text(value.note)) this.refuse("shape_prose", `${at}.note`, "note is a non-empty line");
    }
    private statBlock(value: any, at: string): void {
        const keys = ["armor", "armor_rule", "armor_unstated", "authority", "book", "characteristic_scale", "characteristics", "derived", "profile_kind",
            "sanity_loss", "skills", "spells", "weapons", ...(this.starter ? STARTER_LEGACY.profile : [])];
        if (!this.object(value, at, keys, "a stat block")) return;
        if (Object.hasOwn(value, "characteristics") && this.object(value.characteristics, `${at}.characteristics`, CHARACTERISTICS, "characteristics"))
            for (const key of Object.keys(value.characteristics).filter(key => CHARACTERISTICS.includes(key)))
                this.integerIn(value.characteristics, key, `${at}.characteristics`);
        if (Object.hasOwn(value, "derived") && this.object(value.derived, `${at}.derived`, [...DERIVED_INTEGERS, "DB"], "derived")) {
            for (const key of Object.keys(value.derived).filter(key => DERIVED_INTEGERS.includes(key)))
                if (!integer(value.derived[key])) this.refuse("shape_prose", `${at}.derived.${key}`, `${key} is an integer`);
            if (Object.hasOwn(value.derived, "DB") && !(typeof value.derived.DB === "string"
                && (this.rules.damageBonuses.includes(value.derived.DB) || /^\+([6-9]|[1-9][0-9]+)D6$/.test(value.derived.DB))))
                this.refuse("shape_unresolved", `${at}.derived.DB`, "DB is one of the ruleset's damage-bonus values");
        }
        if (Object.hasOwn(value, "skills")) {
            if (!plain(value.skills)) this.refuse("shape_prose", `${at}.skills`, "skills is {name: integer}");
            else for (const [name, rating] of Object.entries(value.skills)) {
                if (!nameResolves(this.rules, "skills", name))
                    this.refuse("shape_unknown_skill", `${at}.skills.${name}`, `${repr(name)} is not a skill of the ruleset (contract §136.4)`);
                if (!count(rating)) this.refuse("shape_prose", `${at}.skills.${name}`, "a skill rating is an integer");
            }
        }
        if (Object.hasOwn(value, "weapons")) {
            if (!Array.isArray(value.weapons)) this.refuse("shape_prose", `${at}.weapons`, "weapons is a list of weapons");
            else value.weapons.forEach((weapon: any, index: number) => this.weapon(weapon, `${at}.weapons[${index}]`));
        }
        if (this.slot(value, "armor", at, false)) this.integerIn(value, "armor", at);
        if (Object.hasOwn(value, "armor_rule")) this.enumeration(value, "armor_rule", at, ARMOR_RULES);
        if (Object.hasOwn(value, "spells") && !(Array.isArray(value.spells) && value.spells.every(text)))
            this.refuse("shape_prose", `${at}.spells`, "spells is a list of spell names or spell node ids");
        if (Object.hasOwn(value, "sanity_loss")) this.sanityLoss(value.sanity_loss, `${at}.sanity_loss`);
        for (const key of ["profile_kind", "characteristic_scale", "authority"])
            if (Object.hasOwn(value, key) && !text(value[key])) this.refuse("shape_prose", `${at}.${key}`, `${key} is a non-empty string`);
    }
    private spell(value: any, at: string): void {
        if (!this.object(value, at, ["book", "casting_time", "cost_mp", "cost_mp_chosen", "cost_mp_unstated", "cost_pow", "cost_pow_unstated",
            "cost_sanity", "cost_sanity_unstated", "duration", "effects"], "a spell")) return;
        if (Object.hasOwn(value, "cost_mp_chosen") && value.cost_mp_chosen !== true) this.refuse("shape_prose", `${at}.cost_mp_chosen`, "cost_mp_chosen is true or absent");
        if (this.slot(value, "cost_mp", at, true, ["cost_mp_chosen"])) this.amount(value, "cost_mp", at);
        if (this.slot(value, "cost_sanity", at, true)) this.amount(value, "cost_sanity", at);
        if (this.slot(value, "cost_pow", at, false)) this.amount(value, "cost_pow", at);
        if (!Object.hasOwn(value, "casting_time")) this.refuse("shape_unstated", `${at}.casting_time`, "casting_time is a time cost (its amount may be unstated)");
        else this.timeCost(value.casting_time, `${at}.casting_time`);
        if (Object.hasOwn(value, "duration")) this.timeCost(value.duration, `${at}.duration`);
        if (Object.hasOwn(value, "effects")) {
            if (!Array.isArray(value.effects)) this.refuse("shape_prose", `${at}.effects`, "effects is a list");
            else value.effects.forEach((effect: any, index: number) => {
                const where = `${at}.effects[${index}]`;
                if (!this.object(effect, where, ["amount", "direction", "kind"], "a spell effect")) return;
                this.enumeration(effect, "kind", where, ["hp", "san", "mp"]);
                this.enumeration(effect, "direction", where, ["gain", "loss"]);
                this.amount(effect, "amount", where);
            });
        }
    }
    private tome(value: any, at: string): void {
        const optional = ["cthulhu_mythos_full", "cthulhu_mythos_initial", "full_study", "language", "max_sanity_reduction", "mythos_rating",
            "read_check", "read_without_roll_at", "sanity_cost", "spells"];
        if (!this.object(value, at, ["book", "initial_reading", ...optional, ...optional.map(key => `${key}_unstated`)], "a tome")) return;
        for (const key of optional) if (!this.slot(value, key, at, false)) continue;
        else if (key === "language") {
            const path = string(value.language);
            if (!path.startsWith("skills.")) this.refuse("shape_prose", `${at}.language`, "language is a skills.<name> path");
            else this.skill(path.slice("skills.".length), `${at}.language`);
        } else if (key === "read_check") this.check(value.read_check, `${at}.read_check`, null);
        else if (key === "full_study") this.timeCost(value.full_study, `${at}.full_study`);
        else if (key === "sanity_cost") this.sanityLoss(value.sanity_cost, `${at}.sanity_cost`);
        else if (key === "spells") this.references(value, "spells", at, ["spell"]);
        else this.integerIn(value, key, at);
        if (!Object.hasOwn(value, "initial_reading")) this.refuse("shape_unstated", `${at}.initial_reading`, "initial_reading is a time cost (its amount may be unstated)");
        else this.timeCost(value.initial_reading, `${at}.initial_reading`);
    }
    private reward(value: any, at: string): void {
        if (!this.object(value, at, ["book", "cash", "currency", "sanity", "sanity_unstated", "when"], "a reward")) return;
        if (this.slot(value, "sanity", at, false)) this.dice(value, "sanity", at, "sanity");
        if (Object.hasOwn(value, "cash") && !(numeric(value.cash) && number(value.cash) >= 0)) this.refuse("shape_prose", `${at}.cash`, "cash is a number");
        if (Object.hasOwn(value, "currency") && !(typeof value.currency === "string" && /^\S+$/u.test(value.currency)))
            this.refuse("shape_prose", `${at}.currency`, "currency is one unit label");
        if (Object.hasOwn(value, "when")) this.gate(value.when, `${at}.when`);
    }
}
