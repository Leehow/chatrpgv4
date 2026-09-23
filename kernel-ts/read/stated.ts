/**
 * Contract §136.20–§136.24 (RD-03): what a stated shape binds into the Keeper's operations.
 *
 * Read-only over the graph and the turn's receipts. A shape fixes an amount; it never applies one (spec P6): the
 * effects here are the arguments of the verbs that execute them (`apply damage`, `apply time`, `apply threat`,
 * `apply flag`, `apply cash`, `resolve sanity:check`), bound and handed back, and only the Keeper's own call with
 * `stated` puts one on the table.
 */
import { SHAPE_KINDS } from "../modules/mechanics-catalog.js";
import type { ModuleGraph } from "./module-graph.js";
import { conditionStatus, recordOf } from "./module-graph.js";
import { array, integer, number, row, string, truth, type Row } from "./values.js";

/** The node kinds `action.rule` may name: a rule, a hazard, a tome (its read check), an object or artifact (its sanity loss). */
export const RULE_KINDS = ["rule", "hazard", "tome", "object", "artifact"];
/** Minutes per clock unit (§136.6 shape 4); a `round` is combat time and never moves the clock. */
export const UNIT_MINUTES: Readonly<Record<string, number>> = Object.freeze({ minute: 1, hour: 60, day: 1440, week: 10080 });
/** The `apply` kinds that take `stated`, and the fields its binding supplies (giving one as well is `stated_conflict`). */
export const STATED_FIELDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
    damage: ["dice"],
    time: ["minutes"],
    threat: ["name", "clock", "segments"],
    flag: ["name", "value"],
    cash: ["delta", "currency"],
});
const ALL_SHAPE_KINDS = [...new Set(Object.values(SHAPE_KINDS).flat())];
const LEVELS = ["critical", "extreme", "hard", "regular", "failure", "fumble"];
const FAILED = new Set(["failure", "fumble"]);

/** A `where.rules` row's node by its name, for the offer ledger: the node carrying the `mech` line. */
export function statedHandleOf(graph: ModuleGraph, name: string): string | null {
    const node = graph.find(name, ALL_SHAPE_KINDS);
    return node ? graph.handle(node) : null;
}

/** The threat record whose clock this is, by the clock's id. */
function threatOfClock(graph: ModuleGraph, clockId: string): Row | null {
    return graph.kind("threat").find(threat => graph.threatClock(threat, clockId) !== null) ?? null;
}

/** A `sanity_loss` shape as its pair, or its halves as authored when one is unstated. */
function sanityArgs(shape: Row): Row {
    if (typeof shape.success === "string" && typeof shape.failure === "string")
        return { san_loss: `${shape.success}/${shape.failure}` };
    const out: Row = {};
    for (const key of ["success", "failure", "success_unstated", "failure_unstated"])
        if (Object.hasOwn(shape, key)) out[key] = shape[key];
    return out;
}

/** A `time_cost` shape as `apply time`'s argument: minutes when a clock unit and an integer make them. */
function timeArgs(shape: Row): Row {
    if (shape.amount_unstated === true)
        return { amount_unstated: true };
    const unit = string(shape.unit);
    if (integer(shape.amount) && Object.hasOwn(UNIT_MINUTES, unit))
        return { minutes: number(shape.amount) * UNIT_MINUTES[unit] };
    return { amount: shape.amount ?? null, unit: unit || null };
}

/** One stated effect (§136.5) as the argument of the verb that executes it; `next_step` is not an effect of a verb. */
export function boundEffect(graph: ModuleGraph, effect: Row): Row | null {
    switch (effect.kind) {
        case "damage":
            return effect.dice_unstated === true ? { kind: "damage", dice_unstated: true } : { kind: "damage", dice: effect.dice ?? null };
        case "sanity_loss":
            return { kind: "sanity_loss", ...sanityArgs(effect) };
        case "time":
            return { kind: "time", ...timeArgs(effect) };
        case "cost": {
            const { kind: _kind, book: _book, ...cost } = effect;
            return { kind: "cost", ...cost };
        }
        case "flag":
            return { kind: "flag", name: effect.flag_id ?? null, value: effect.value ?? true };
        case "clock": {
            const threat = typeof effect.clock_id === "string" ? threatOfClock(graph, effect.clock_id) : null;
            return { kind: "threat", name: threat ? graph.handle(threat) : null, clock: effect.clock_id ?? null, segments: effect.ticks ?? 1 };
        }
        case "book":
            return { kind: "book", line: effect.line ?? null };
        default:
            return null;
    }
}

/**
 * The check `action.rule` rolls on a node (§136.20): with a step, that step of its hazard; without one, its
 * `check`, else a tome's `read_check`, else its hazard's first step. Null when there is none.
 */
export function statedCheck(graph: ModuleGraph, node: Row, step: number | null): { check: Row; step: number | null } | null {
    const shapes = graph.mechanicsOf(node), steps = array(row(shapes.hazard).steps).map(row);
    if (step !== null)
        return steps[step] ? { check: steps[step], step } : null;
    if (truth(shapes.check)) return { check: row(shapes.check), step: null };
    if (truth(row(shapes.tome).read_check)) return { check: row(row(shapes.tome).read_check), step: null };
    return steps.length ? { check: steps[0], step: 0 } : null;
}

/**
 * What one level of a stated check states (§136.20): its effects bound, the step the book says follows, its
 * `book` line. A pushed roll that failed adds the push's own effects.
 */
export function levelEffects(graph: ModuleGraph, check: Row, level: string, pushedFailure = false): { effects: Row[]; next_step: number | null; book: string | null } {
    const entry = row(row(check.results)[level]);
    const stated = [...array(entry.effects), ...(pushedFailure ? array(row(check.push).effects) : [])].map(row);
    const next = stated.find(effect => effect.kind === "next_step");
    return {
        effects: stated.map(effect => boundEffect(graph, effect)).filter((effect): effect is Row => effect !== null),
        next_step: next && integer(next.step) ? number(next.step) : null,
        book: typeof entry.book === "string" ? entry.book : null,
    };
}

/** The level a stated check reached: the actor's own, except that losing an opposed check is a failure at best. */
export function statedLevel(outcome: Row): string {
    if (outcome.kind === "opposed") {
        const mine = string(row(outcome.investigator).level);
        return outcome.winner === "investigator" || FAILED.has(mine) ? mine : "failure";
    }
    return string(outcome.level);
}

/** The latest receipt of the turn whose roll named this node with `action.rule` (its `basis`). */
export function statedResult(receipts: readonly Row[], handle: string): Row | null {
    return [...receipts].reverse().map(receipt => row(receipt.basis)).find(basis => basis.rule === handle && LEVELS.includes(string(basis.level))) ?? null;
}

/** The node's own shapes of the kind a verb executes, when no roll of this turn named it. */
function ownEffects(graph: ModuleGraph, node: Row, kind: string): Row[] {
    const shapes = graph.mechanicsOf(node), noRoll = array(row(shapes.hazard).effects).map(row).map(effect => boundEffect(graph, effect));
    const of = (verb: string) => noRoll.filter((effect): effect is Row => effect?.kind === verb);
    switch (kind) {
        case "damage":
            return [...(shapes.damage ? [boundEffect(graph, { ...shapes.damage, kind: "damage" })!] : []), ...of("damage")];
        case "time":
            return [...(shapes.time_cost ? [boundEffect(graph, { ...shapes.time_cost, kind: "time" })!] : []), ...of("time")];
        case "sanity_loss": {
            const own = shapes.sanity_loss ?? row(shapes.tome).sanity_cost;
            return [...(truth(own) ? [boundEffect(graph, { ...row(own), kind: "sanity_loss" })!] : []), ...of("sanity_loss")];
        }
        case "threat":
            return [...(node.node_kind === "threat" ? array(recordOf(node).clocks).map(row).filter(clock => Array.isArray(clock.advances_on) && clock.advances_on.length)
                .map(clock => ({ kind: "threat", name: graph.handle(node), clock: string(clock.clock_id || clock.id || clock.name), segments: 1 })) : []), ...of("threat")];
        case "flag":
            return of("flag");
        case "cash": {
            const reward = row(shapes.reward);
            return typeof reward.cash === "number" ? [{ kind: "cash", delta: reward.cash, ...(typeof reward.currency === "string" ? { currency: reward.currency } : {}) }] : [];
        }
        default:
            return [];
    }
}

/**
 * Contract §136.22: the candidate amounts of one verb's kind for `stated: <handle>` -- the effects of that kind
 * this turn's latest `action.rule` roll on the node reached, else the node's own shapes of that kind.
 */
export function statedCandidates(graph: ModuleGraph, receipts: readonly Row[], node: Row, kind: string): Row[] {
    const result = statedResult(receipts, graph.handle(node));
    if (result) {
        const found = statedCheck(graph, node, integer(result.step) ? number(result.step) : null);
        if (found) {
            const level = string(result.level), stated = levelEffects(graph, found.check, level, result.pushed === true && FAILED.has(level));
            const matching = stated.effects.filter(effect => effect.kind === kind);
            if (matching.length) return matching;
        }
    }
    return ownEffects(graph, node, kind);
}

/** A node `stated` may name: one whose shapes an operation can read, or a threat whose clock the book advances. */
export function statedNode(graph: ModuleGraph, name: any): Row | null {
    if (typeof name !== "string" || !name.trim()) return null;
    const node = graph.find(name.trim(), [...RULE_KINDS, "threat"]);
    if (!node) return null;
    if (node.node_kind === "threat")
        return array(recordOf(node).clocks).some(clock => Array.isArray(row(clock).advances_on)) ? node : null;
    return Object.keys(graph.mechanicsOf(node)).length ? node : null;
}

/**
 * Contract §136.27: the Sanity reward the book states for a `conclusion` ending at the active scene -- exactly one rule the
 * scene links by `uses-rule` whose `reward` states `sanity` as dice and whose `when` gate, if any, holds. Null otherwise
 * (another ending kind, no stated reward, an unstated one, or two), and the omitted expression keeps today's meaning.
 */
export function statedEndingReward(graph: ModuleGraph, world: Row, ending: any): { rule: string; expression: string } | null {
    if (ending != null && ending !== "conclusion")
        return null;
    const scene = typeof world.active_scene === "string" ? graph.sceneByHandle(world.active_scene) : null;
    if (!scene)
        return null;
    const stated = graph.statedRewards(scene).filter(reward => typeof reward.sanity === "string" && (reward.when == null || conditionStatus(reward.when, world) === true));
    return stated.length === 1 ? { rule: string(stated[0].rule), expression: stated[0].sanity } : null;
}
