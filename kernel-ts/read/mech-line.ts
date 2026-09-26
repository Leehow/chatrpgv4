/**
 * Contract §136.11: the capsule's `mech` line -- a node's mechanical shapes as one English line, rendered by code.
 *
 * Every word here is either this file's own fixed wording or a typed value: an integer's digits, a dice string the
 * §136.3 grammar accepts, a closed enum value, a node reference as its handle, a skill path's name. Nothing of the
 * module's prose is read -- not `summary`, not `name`, not a shape's `book`, not an effect's `line` (a `book`
 * effect renders as the fixed words "as written"; the row's own `line` is the book's wording). A slot that fails
 * its type renders as `?`, never as its text, so a module the validator has not seen cannot leak a sentence here.
 */
import { diceRefusal, sanityHalfRefusal } from "../modules/mechanics-shape.js";
import { SHAPE_KINDS } from "../modules/mechanics-catalog.js";
import type { ModuleGraph } from "./module-graph.js";
import { array, integer, row, string, type Row } from "./values.js";

const LEVELS = ["critical", "extreme", "hard", "regular", "failure", "fumble"];
const DIFFICULTIES = ["regular", "hard", "extreme"];
const UNITS = ["round", "minute", "hour", "day", "week"];
const RESOURCES: Record<string, string> = { mp: "MP", pow: "POW", san: "SAN", luck: "Luck", hp: "HP" };
const PER = ["use", "round", "cast"];
const FLAG_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
/** A rulebook table key (`weapons.json` ids spell `knife_medium`). */
const TABLE_ID = /^[a-z0-9][a-z0-9_-]*$/;

const isRow = (value: any): value is Row => value != null && typeof value === "object" && !Array.isArray(value);
const count = (value: any): string => integer(value) ? String(value) : "?";
const dice = (value: any): string => diceRefusal(value, "dice") === null ? value : "?";
/** `<int|DICE>`: an amount as a count or a dice string. */
const amount = (value: any): string => typeof value === "string" ? dice(value) : count(value);
const half = (shape: Row, key: string): string => shape[`${key}_unstated`] === true ? "unstated" : sanityHalfRefusal(shape[key], key) === null ? shape[key] : "?";
const member = (value: any, allowed: readonly string[]): string => allowed.includes(value) ? value : "?";

class MechLine {
    constructor(private readonly graph: ModuleGraph) { }

    private ref(id: any): string {
        const node = typeof id === "string" ? this.graph.nodes.get(id) : undefined;
        return node ? this.graph.handle(node) : "?";
    }
    private pathName(path: any): string {
        const text = string(path);
        for (const prefix of ["skills.", "characteristics."])
            if (text.startsWith(prefix) && text.length > prefix.length) return text.slice(prefix.length);
        return "?";
    }
    private values(list: any, selection: any): string {
        const names = array(list).map(value => {
            const entry = row(value), name = this.pathName(entry.path);
            return Object.hasOwn(entry, "minimum") ? `${name} (min ${count(entry.minimum)})` : name;
        });
        if (names.length <= 1) return names[0] ?? "?";
        return selection === "approach" ? `${names.join(" / ")} (by approach)` : `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`;
    }
    /** A gate (§136.6 shape 6) as the exits' `unlock_when` spells one, from its typed keys only. */
    private gate(value: Row): string {
        if (value.kind === "always") return "always";
        if (value.kind === "clue_discovered") return `clue_discovered: ${this.ref(value.clue_id)}`;
        if (value.kind === "flag_set")
            return `flag_set: ${FLAG_ID.test(string(value.flag_id)) ? value.flag_id : "?"}${typeof value.value === "boolean" ? ` = ${value.value ? "True" : "False"}` : ""}`;
        return "?";
    }
    private sanity(shape: Row): string { return `SAN loss ${half(shape, "success")}/${half(shape, "failure")}`; }
    time(shape: any): string {
        const value = row(shape);
        if (value.amount_unstated === true || !Object.hasOwn(value, "amount")) return "unstated";
        const unit = member(value.unit, UNITS), text = amount(value.amount);
        const spelled = `${text} ${unit === "?" ? unit : value.amount === 1 ? unit : `${unit}s`}`;
        return value.minimum === true ? `at least ${spelled}` : spelled;
    }
    private cost(shape: Row): string {
        const resource = Object.hasOwn(RESOURCES, shape.resource) ? RESOURCES[shape.resource] : "?";
        const base = shape.chosen === true ? `${resource} chosen by the spender`
            : shape.amount_unstated === true || !Object.hasOwn(shape, "amount") ? `${resource} unstated` : `${amount(shape.amount)} ${resource}`;
        return Object.hasOwn(shape, "per") ? `${base} per ${member(shape.per, PER)}` : base;
    }
    private damage(shape: Row): string { return `damage ${shape.dice_unstated === true || !Object.hasOwn(shape, "dice") ? "unstated" : dice(shape.dice)}`; }
    private effect(value: any): string {
        const effect = row(value);
        switch (effect.kind) {
            case "damage": return this.damage(effect);
            case "sanity_loss": return this.sanity(effect);
            case "time": return `time ${this.time(effect)}`;
            case "cost": return `cost ${this.cost(effect)}`;
            case "flag": return `flag ${FLAG_ID.test(string(effect.flag_id)) ? effect.flag_id : "?"} ${typeof effect.value === "boolean" ? String(effect.value) : "?"}`;
            case "clock": return `clock ${FLAG_ID.test(string(effect.clock_id)) ? effect.clock_id : "?"} +${count(effect.ticks)}`;
            case "next_step": return `step ${count(effect.step)}`;
            case "book": return "as written";
            default: return "?";
        }
    }
    private effects(list: any): string { return array(list).map(effect => this.effect(effect)).join(" and ") || "as written"; }
    check(shape: any): string {
        const check = row(shape), parts: string[] = [];
        parts.push(check.approaches_unstated === true ? "approach unstated" : this.values(check.values, check.selection));
        parts.push(check.difficulty_unstated === true ? "difficulty unstated" : member(check.difficulty, DIFFICULTIES));
        if (check.scope === "actor-target") parts.push(`against ${this.ref(check.target)}`);
        if (check.scope === "opposed") parts.push(`opposed by ${this.values(row(check.opposing).values, "maximum")}`);
        let text = parts.join(" ");
        const results = row(check.results);
        for (const level of LEVELS)
            if (Object.hasOwn(results, level)) text += `, on ${level} ${this.effects(row(results[level]).effects)}`;
        if (isRow(check.push)) {
            if (check.push.allowed === false) text += ", no push";
            else if (check.push.allowed === true) text += Array.isArray(check.push.effects) && check.push.effects.length ? `, push allowed: ${this.effects(check.push.effects)}` : ", push allowed";
        }
        return text;
    }
    private hazard(shape: Row): string {
        const trigger = row(shape.trigger), heads = ["Keeper triggers"];
        if (trigger.kind === "enter") heads.push("stated on entry");
        if (trigger.kind === "attempt") {
            const guards = row(trigger.guards), names = ["clues", "exits", "people"].flatMap(key => array(guards[key]).map(id => this.ref(id)));
            heads.push(`stated on reaching ${names.join(", ") || "?"}`);
        }
        if (isRow(shape.when)) heads.push(`when ${this.gate(shape.when)}`);
        let text = `hazard (${heads.join("; ")})`;
        const steps = array(shape.steps).map((step, index) => `[${index}] ${this.check(step)}`);
        if (steps.length) text += `: ${steps.join("; ")}`;
        if (Array.isArray(shape.effects) && shape.effects.length) text += `${steps.length ? ";" : ":"} ${this.effects(shape.effects)}`;
        return text;
    }
    /** `handle` is the id the catalog gives a weapon without `weapon_id` (§136.15); a stat block's weapon has its own. */
    private weapon(shape: Row, handle: string): string {
        const extended = TABLE_ID.test(string(shape.extends)) ? string(shape.extends) : "?";
        const parts: string[] = [], id = Object.hasOwn(shape, "weapon_id") ? FLAG_ID.test(string(shape.weapon_id)) ? shape.weapon_id : "?" : handle;
        if (Object.hasOwn(shape, "extends")) parts.push(`extends ${extended}`);
        if (Object.hasOwn(shape, "skill")) parts.push(typeof shape.skill === "string" ? shape.skill : "?");
        if (Object.hasOwn(shape, "damage")) parts.push(dice(shape.damage));
        if (Object.hasOwn(shape, "uses_per_round")) parts.push(`${count(shape.uses_per_round)}/round`);
        if (shape.impale === true) parts.push("impales");
        if (shape.adds_damage_bonus === true) parts.push("+DB");
        if (Object.hasOwn(shape, "base_range_yards")) parts.push(`${typeof shape.base_range_yards === "number" ? String(shape.base_range_yards) : "?"} yd`);
        if (Object.hasOwn(shape, "magazine")) parts.push(`magazine ${count(shape.magazine)}`);
        if (Object.hasOwn(shape, "malfunction")) parts.push(`malfunction ${count(shape.malfunction)}`);
        for (const key of ["skill", "damage", "uses_per_round", "impale"])
            if (shape[`${key}_unstated`] === true) parts.push(`${key.replaceAll("_", " ")} unstated`);
        return parts.length ? `weapon ${id}: ${parts.join(", ")}` : `weapon ${id}`;
    }
    private spell(shape: Row): string {
        const mp = shape.cost_mp_chosen === true ? "chosen" : shape.cost_mp_unstated === true || !Object.hasOwn(shape, "cost_mp") ? "unstated" : amount(shape.cost_mp);
        const san = shape.cost_sanity_unstated === true || !Object.hasOwn(shape, "cost_sanity") ? "unstated" : amount(shape.cost_sanity);
        const parts = [`MP ${mp}`, `SAN ${san}`];
        if (Object.hasOwn(shape, "cost_pow")) parts.push(`POW ${amount(shape.cost_pow)}`);
        parts.push(`casting ${this.time(shape.casting_time)}`);
        if (Object.hasOwn(shape, "duration")) parts.push(`lasts ${this.time(shape.duration)}`);
        for (const effect of array(shape.effects))
            parts.push(`${member(row(effect).kind, ["hp", "san", "mp"])} ${member(row(effect).direction, ["gain", "loss"])} ${amount(row(effect).amount)}`);
        return `spell: ${parts.join(", ")}`;
    }
    private tome(shape: Row): string {
        const parts: string[] = [];
        if (Object.hasOwn(shape, "language")) parts.push(`in ${this.pathName(shape.language)}`);
        if (isRow(shape.read_check)) parts.push(`read ${this.check(shape.read_check)}`);
        if (Object.hasOwn(shape, "read_without_roll_at")) parts.push(`no roll at ${count(shape.read_without_roll_at)}+`);
        parts.push(`initial reading ${this.time(shape.initial_reading)}`);
        if (Object.hasOwn(shape, "full_study")) parts.push(`full study ${this.time(shape.full_study)}`);
        if (Object.hasOwn(shape, "cthulhu_mythos_initial")) parts.push(`Cthulhu Mythos +${count(shape.cthulhu_mythos_initial)} initial`);
        if (Object.hasOwn(shape, "cthulhu_mythos_full")) parts.push(`+${count(shape.cthulhu_mythos_full)} full`);
        if (Object.hasOwn(shape, "mythos_rating")) parts.push(`mythos rating ${count(shape.mythos_rating)}`);
        if (isRow(shape.sanity_cost)) parts.push(this.sanity(shape.sanity_cost));
        if (Object.hasOwn(shape, "max_sanity_reduction")) parts.push(`max SAN -${count(shape.max_sanity_reduction)}`);
        if (Array.isArray(shape.spells) && shape.spells.length) parts.push(`spells ${shape.spells.map((id: any) => this.ref(id)).join(", ")}`);
        return `tome: ${parts.join(", ")}`;
    }
    private reward(shape: Row): string {
        const parts: string[] = [];
        if (shape.sanity_unstated === true) parts.push("SAN unstated");
        else if (Object.hasOwn(shape, "sanity")) parts.push(`SAN ${dice(shape.sanity)}`);
        if (Object.hasOwn(shape, "cash")) {
            const currency = typeof shape.currency === "string" && /^[A-Za-z$]{1,8}$/.test(shape.currency) ? ` ${shape.currency}` : Object.hasOwn(shape, "currency") ? " ?" : "";
            parts.push(`cash ${typeof shape.cash === "number" && Number.isFinite(shape.cash) ? String(shape.cash) : "?"}${currency}`);
        }
        if (isRow(shape.when)) parts.push(`when ${this.gate(shape.when)}`);
        return `reward: ${parts.join(", ") || "as written"}`;
    }
    private statBlock(shape: Row): string {
        const parts = [`${Object.keys(row(shape.characteristics)).length} characteristics`, `${Object.keys(row(shape.skills)).length} skills`,
            `${array(shape.weapons).length} weapons`];
        if (isRow(shape.sanity_loss)) parts.push(this.sanity(shape.sanity_loss));
        return `stat block: ${parts.join(", ")}`;
    }
    shape(key: string, shape: Row, node: Row): string {
        switch (key) {
            case "profile": return this.statBlock(shape);
            case "check": return `check: ${this.check(shape)}`;
            case "hazard": return this.hazard(shape);
            case "damage": return this.damage(shape);
            case "sanity_loss": return this.sanity(shape);
            case "time_cost": return `time ${this.time(shape)}`;
            case "resource_cost": return `cost ${this.cost(shape)}`;
            case "weapon": return this.weapon(shape, this.graph.handle(node));
            case "spell": return this.spell(shape);
            case "tome": return this.tome(shape);
            case "reward": return this.reward(shape);
            default: return "?";
        }
    }
}

/** The node's `mech` line, or null when it states no shape (the row then carries no `mech` key). */
export function mechLine(graph: ModuleGraph, node: Row): string | null {
    const shapes = graph.mechanicsOf(node), renderer = new MechLine(graph);
    const parts = Object.keys(SHAPE_KINDS).filter(key => Object.hasOwn(shapes, key)).map(key => renderer.shape(key, shapes[key], node));
    return parts.length ? parts.join(" | ") : null;
}
/**
 * SL-76 (contract §136.10 addendum, jev-driven-steps.md D1's `time_cost` candidate): the node's own `time_cost`
 * shape, typed and without its `book` line -- the same "typed, no book" projection `ModuleGraph.statedRewards`
 * already gives the reward shape. A candidate builder that needs to know whether a rule states a cost, and how
 * much, reads this structured field rather than parsing the rendered `mech` line's English.
 */
function timeCostOf(graph: ModuleGraph, node: Row): Row | null {
    const shape = graph.mechanicsOf(node).time_cost;
    if (!shape || typeof shape !== "object" || Array.isArray(shape)) return null;
    const { book: _book, ...typed } = shape as Row;
    return typed;
}
/**
 * The keys a `where.rules[]` row gains from its node: `{mech}` when it states a shape, else nothing, and (SL-76)
 * `{time_cost, handle}` when the node's own shape states a time cost -- the structured twin of the `mech` line's
 * rendered words, with the node's own handle so a `time_cost` candidate can `apply {kind: "time", stated: handle}`
 * rather than re-deriving the amount itself (the kernel's own `stated` resolution, `kernel-ts/apply/stated.ts`,
 * already converts the shape's unit and refuses `stated_unstated` when it names none). A row with only `mech`
 * gains no new key, so a module with no `time_cost` shape reads byte for byte as before.
 */
export const mechRow = (graph: ModuleGraph) => (node: Row): Row => {
    const mech = mechLine(graph, node);
    const timeCost = timeCostOf(graph, node);
    return { ...(mech === null ? {} : { mech }), ...(timeCost ? { time_cost: timeCost, handle: graph.handle(node) } : {}) };
};
