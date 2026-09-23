/**
 * Contract §134.9–§134.13: what the module states a scene demands, issued from the graph and world state.
 *
 * `sceneObligations` is the one projection behind every seat -- `table.apply.options.obligations`,
 * `guarded_by` on the effect candidates, the capsule's `kind: "scene"` rows and the gate string -- so
 * the clerk's view and the Keeper's cannot disagree. Nothing here reads the player's words or the
 * Keeper's prose, and nothing here refuses anything: an open obligation is information (owner ruling Q5).
 *
 * State is a flag (§134.4). The two things the world alone cannot say come in through `reads`: which
 * receipt last wrote the flag (a Keeper's `apply flag` with a reason is a waiver), and which Mod checks
 * are active (the Mod-recipe identity and a preordained reaction).
 */
import { conditionStatus, type ModuleGraph } from "./module-graph.js";
import { statedObligations } from "../modules/obligation-shape.js";
import { array, integer, number, row, sorted, truth, type Row } from "./values.js";

export type ObligationState = "open" | "blocked" | "settled" | "waived";
/** An active Mod check declaration, with the package that contributes it. */
export type ModCheck = { mod: string; check: Row };
export interface ObligationReads {
    /** The campaign's receipts in order: committed turn records, then the open turn's. */
    receipts?: readonly Row[];
    /** The active Mods' contributed checks. */
    modChecks?: readonly ModCheck[];
}

const text = (value: any): value is string => typeof value === "string" && Boolean(value.trim());
const obligationOf = (node: Row): Row => row(row(node.properties).obligation);
const flagOf = (node: Row): string => String(row(obligationOf(node).settles).flag_id ?? "");
const steps = (node: Row): Row[] => array(obligationOf(node).demand).map(row);
/** The name after a value path's group: `skills.Fast Talk` -> `Fast Talk`. */
export const valueName = (path: any): string => typeof path === "string" && path.includes(".") ? path.slice(path.indexOf(".") + 1) : String(path ?? "");

/** How many `after` links lead back from an obligation to one with no predecessor. */
function afterDepth(graph: ModuleGraph, node: Row): number {
    let depth = 0;
    for (let at = node; depth < 32; depth++) {
        const before = graph.nodes.get(String(row(obligationOf(at).trigger).obligation ?? ""));
        if (row(obligationOf(at).trigger).kind !== "after" || !before)
            break;
        at = before;
    }
    return depth;
}
/** The stated obligations linked from `scene`: a predecessor before what waits on it, else graph order. */
export function obligationNodes(graph: ModuleGraph, scene: Row | null): Row[] {
    if (!scene)
        return [];
    return statedObligations(graph).filter(node => obligationOf(node).scene === scene.node_id)
        .map((node, index) => ({ node, index, depth: afterDepth(graph, node) }))
        .sort((a, b) => a.depth - b.depth || a.index - b.index).map(entry => entry.node);
}
/** The stated obligation a handle (or node id) names, or null. */
export function obligationByHandle(graph: ModuleGraph, name: any): Row | null {
    if (!text(name))
        return null;
    return statedObligations(graph).find(node => node.node_id === name || graph.handle(node) === name.trim()) ?? null;
}
/** §134.9: a meeting is met when the person sits in the obligation's scene and the table has introduced them. */
export function meetingMet(graph: ModuleGraph, world: Row, node: Row, npcId: any): boolean {
    const person = typeof npcId === "string" ? graph.nodes.get(npcId) : undefined,
        scene = graph.nodes.get(String(obligationOf(node).scene ?? ""));
    if (!person || !scene)
        return false;
    const handle = graph.handle(person);
    return row(world.npc_presence)[handle] === graph.handle(scene) && Object.keys(row(row(world.person_labels)[handle])).length > 0;
}
const flagSet = (world: Row, flag: string): boolean => Boolean(flag) && conditionStatus({ kind: "flag_set", flag_id: flag }, world) === true;
/** Whether the last receipt that wrote the obligation's flag is a Keeper's `apply flag` with a reason. */
function waivedBy(graph: ModuleGraph, node: Row, receipts: readonly Row[]): boolean {
    const flag = flagOf(node), handle = graph.handle(node);
    let waived = false;
    for (const receipt of receipts) {
        if (receipt.kind === "flag" && receipt.name === flag)
            waived = receipt.value !== false && text(receipt.why);
        else if (receipt.kind === "roll" && row(receipt.obligation).handle === handle && row(receipt.obligation).settled === true)
            waived = false;
    }
    return waived;
}
/** §134.9's state rule. `receipts` only tells a waiver from a settlement. */
export function obligationState(graph: ModuleGraph, world: Row, node: Row, receipts: readonly Row[] = [], depth = 0): ObligationState {
    if (flagSet(world, flagOf(node)))
        return waivedBy(graph, node, receipts) ? "waived" : "settled";
    const trigger = row(obligationOf(node).trigger);
    if (trigger.kind === "after") {
        const before = graph.nodes.get(String(trigger.obligation ?? ""));
        // The validator refuses an `after` cycle; the depth bound keeps a hand-edited graph from looping here.
        if (before && depth < 32 && !["settled", "waived"].includes(obligationState(graph, world, before, receipts, depth + 1)))
            return "blocked";
    }
    const demand = steps(node);
    if (demand.length && !demand.some(step => step.kind === "check") && demand.filter(step => step.kind === "meet").every(step => meetingMet(graph, world, node, step.npc)))
        return "settled";
    return "open";
}
const unsettled = (state: ObligationState): boolean => state === "open" || state === "blocked";
/** The first step still owed: an unmet meeting, else the check. A cost is never a step (ruling Q4). */
export function nextStep(graph: ModuleGraph, world: Row, node: Row): Row | null {
    for (const step of steps(node)) {
        if (step.kind === "meet" && !meetingMet(graph, world, node, step.npc))
            return step;
        if (step.kind === "check")
            return step;
    }
    return null;
}
/** §134.13: an active Mod check with the identical recipe serves an obligation's check step. */
export function servingModCheck(step: Row, modChecks: readonly ModCheck[] = []): ModCheck | null {
    // A stated minimum is a threshold the Mod resolver never reads (§134.3), so such a step is never served by one.
    if (step.scope !== "actor-target" || array(step.values).some(value => integer(row(value).minimum)))
        return null;
    const paths = (values: any) => sorted(array(values).map(value => String(row(value).path ?? ""))).join("\n");
    return modChecks.find(({ check }) => check.scope === "actor-target" && check.selection === step.selection
        && check.difficulty === step.difficulty && array(step.values).length > 0 && paths(check.values) === paths(step.values)) ?? null;
}
function stepView(graph: ModuleGraph, step: Row, modChecks: readonly ModCheck[]): Row {
    const name = (id: any) => typeof id === "string" && graph.nodes.has(id) ? graph.displayName(graph.nodes.get(id)!) : String(id ?? "");
    if (step.kind === "meet")
        return { kind: "meet", person: name(step.npc) };
    const view: Row = { kind: "check" };
    if (text(step.target))
        view.target = name(step.target);
    if (step.approaches_unstated === true)
        view.approaches_unstated = true;
    else {
        view.selection = step.selection;
        view.approaches = array(step.values).map(value => ({
            skill: valueName(row(value).path),
            ...(integer(row(value).minimum) ? { minimum: row(value).minimum } : {})
        }));
    }
    if (step.difficulty_unstated === true)
        view.difficulty_unstated = true;
    else
        view.difficulty = step.difficulty;
    const served = servingModCheck(step, modChecks);
    if (served)
        view.served_by = { mod: served.mod, check: served.check.name };
    return view;
}
function bookOf(node: Row): Row | null {
    const book: Row = {}, costs: string[] = [];
    for (const step of steps(node)) {
        if (step.kind === "cost" && text(step.book))
            costs.push(step.book);
        if (step.kind !== "check")
            continue;
        for (const level of ["failure", "fumble"])
            if (text(row(row(step.results)[level]).book) && !Object.hasOwn(book, level))
                book[level] = row(row(step.results)[level]).book;
        if (text(row(step.push).book) && !Object.hasOwn(book, "push"))
            book.push = row(step.push).book;
    }
    if (costs.length)
        book.cost = costs;
    return Object.keys(book).length ? book : null;
}
const sourceOf = (node: Row): Row[] => array(node.source_refs).map(row).filter(ref => integer(ref.pdf_index))
    .map(ref => ({ page: number(ref.pdf_index) + 1, ...(text(ref.grep_anchor) ? { anchor: ref.grep_anchor } : {}) }));

/** §134.9: every stated obligation of `scene`, with its state, its next step, its book lines and its source. */
export function sceneObligations(graph: ModuleGraph, world: Row, scene: Row | null, reads: ObligationReads = {}): Row[] {
    const receipts = reads.receipts ?? [], modChecks = reads.modChecks ?? [];
    return obligationNodes(graph, scene).map(node => {
        const ob = obligationOf(node), trigger = row(ob.trigger), state = obligationState(graph, world, node, receipts);
        const name = (id: any) => graph.displayName(graph.nodes.get(id)!);
        const handles = (ids: any) => array(ids).filter(id => typeof id === "string" && graph.nodes.has(id)).map(id => graph.handle(graph.nodes.get(id)!));
        const guards = row(trigger.guards);
        const result: Row = {
            handle: graph.handle(node),
            name: text(node.name) ? node.name : graph.handle(node),
            ...(text(ob.who) && graph.nodes.has(ob.who) ? { who: name(ob.who) } : {}),
            state,
            trigger: trigger.kind === "after"
                ? { kind: "after", after: graph.nodes.has(String(trigger.obligation ?? "")) ? graph.handle(graph.nodes.get(trigger.obligation)!) : String(trigger.obligation ?? "") }
                : { kind: "attempt", guards: {
                    ...(Array.isArray(guards.clues) ? { clues: handles(guards.clues) } : {}),
                    ...(Array.isArray(guards.exits) ? { exits: handles(guards.exits) } : {}),
                    ...(Array.isArray(guards.people) ? { people: array(guards.people).filter(id => typeof id === "string" && graph.nodes.has(id)).map(name) } : {}),
                } },
        };
        const next = state === "open" ? nextStep(graph, world, node) : null;
        if (next)
            result.next = stepView(graph, next, modChecks);
        if (ob.reaction === "preordained") {
            result.reaction = "preordained";
            const contact = modChecks.filter(({ check }) => check.trigger === "contact" && check.scope === "actor-target")
                .map(({ mod, check }) => ({ mod, check: check.name, clerk: false }));
            if (contact.length)
                result.mod_contact = contact;
        }
        const book = bookOf(node);
        if (book)
            result.book = book;
        result.source = sourceOf(node);
        return result;
    });
}
/**
 * §134.10: what the unsettled obligations of `scene` guard, by node id -> obligation handle. A blocked
 * obligation's guards hold as well as an open one's; a settled or waived one guards nothing.
 */
export function openGuards(graph: ModuleGraph, world: Row, scene: Row | null): { clues: Map<string, string>; exits: Map<string, string>; people: Map<string, string> } {
    const guards = { clues: new Map<string, string>(), exits: new Map<string, string>(), people: new Map<string, string>() };
    for (const node of obligationNodes(graph, scene)) {
        const trigger = row(obligationOf(node).trigger);
        if (trigger.kind !== "attempt" || !unsettled(obligationState(graph, world, node)))
            continue;
        for (const key of ["clues", "exits", "people"] as const)
            for (const id of array(row(trigger.guards)[key]))
                if (typeof id === "string" && !guards[key].has(id))
                    guards[key].set(id, graph.handle(node));
    }
    return guards;
}
/** The active scene of `world`, or null when it names nothing on the graph. */
export function activeScene(graph: ModuleGraph, world: Row): Row | null {
    return typeof world.active_scene === "string" ? graph.find(world.active_scene, ["scene"]) : null;
}
/** The obligations that guard a clue node, for the gate string (§134.10). */
export function clueGuards(graph: ModuleGraph, world: Row | null | undefined, clue: Row): string[] {
    if (!world || !statedObligations(graph).length)
        return [];
    const scene = activeScene(graph, world);
    const handles: string[] = [];
    for (const node of obligationNodes(graph, scene)) {
        const trigger = row(obligationOf(node).trigger);
        if (trigger.kind === "attempt" && array(row(trigger.guards).clues).includes(clue.node_id)
            && unsettled(obligationState(graph, world, node)) && !handles.includes(graph.handle(node)))
            handles.push(graph.handle(node));
    }
    return handles;
}
/** §134.10: the capsule's compact row, derived from the issued row so the two cannot disagree. */
export function capsuleRow(issued: Row): Row {
    const cue: string[] = [], next = row(issued.next), guards = row(row(issued.trigger).guards);
    const listed = (values: any[], word: string) => values.length === 1 ? values[0] : `${values.slice(0, -1).join(", ")} ${word} ${values.at(-1)}`;
    if (issued.state === "open" && next.kind === "meet")
        cue.push(`next: meet ${next.person} (apply person)`);
    else if (issued.state === "open" && next.kind === "check") {
        const served = row(next.served_by), against = text(next.target) ? ` against ${next.target}` : "";
        if (truth(served))
            cue.push(`next: ${served.check}${against} settles it; resolve with action.obligation`);
        else {
            const how = next.approaches_unstated === true ? "a check the book names no skill for"
                : `${next.selection === "maximum" ? "the higher of " : ""}${listed(array(next.approaches).map(value => row(value).skill + (integer(row(value).minimum) ? ` (${row(value).minimum}+)` : "")), next.selection === "maximum" ? "and" : "or")}`;
            cue.push(`next: ${how} (${next.difficulty_unstated === true ? "difficulty unstated: yours" : next.difficulty})${against}; resolve with action.obligation`);
        }
    }
    else if (issued.state === "blocked")
        cue.push(`after ${row(issued.trigger).after}`);
    else if (issued.state === "settled" || issued.state === "waived")
        cue.push(`${issued.state}; apply flag false reopens it`);
    const guarded = [...array(guards.clues), ...array(guards.exits), ...array(guards.people)];
    if (guarded.length && (issued.state === "open" || issued.state === "blocked"))
        cue.push(`guards ${guarded.join(", ")}`);
    if (issued.reaction === "preordained" && text(issued.who))
        cue.push(`the book skips ${issued.who}'s reaction roll`);
    const pages = array(issued.source).map(ref => row(ref).page).filter(integer);
    if (pages.length)
        cue.push(`pdf p.${[...new Set(pages)].join(", ")}`);
    return { kind: "scene", name: issued.handle, ...(text(issued.who) ? { who: issued.who } : {}), state: issued.state, cue: cue.join("; ") };
}
