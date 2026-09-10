/** The story thread a Director package reads: what each authored conclusion still needs, organised by where the
 *  story can go rather than by where the party stands. A pure projection of the module graph and the world;
 *  no doctrine number, no scoring, no prose is read. */
import { ModuleGraph, recordOf, describeCondition, conditionStatus } from "./module-graph.js";
import { clueGate } from "./director.js";
import { array, row, string, truth, chars, type Row } from "./values.js";
import { jsonSize } from "./capsule.js";
export const THREAD_BUDGET = 3072;
const IMPORTANCE = ["critical", "core", "major", "supporting", "minor"];
const rank = (value: any): number => { const i = IMPORTANCE.indexOf(string(value)); return i < 0 ? IMPORTANCE.length : i; };
const HANDED = "The book means these clues to happen: they are not routes and not choices to offer. The timing is yours.";
/** Conclusions the discovered clues have not yet closed, each with the clues here, the scenes one move away that
 *  hold more, the clues the book hands over by itself, and the rest as a count. */
export function threadSection(graph: ModuleGraph, world: Row, scene: Row, present: Row[]): Row {
    const discovered = new Set(array(world.discovered_clues).map(string)),
        here = new Set(graph.sceneClueIds(scene)),
        presentIds = new Set(present.map(n => n.node_id)),
        exits = graph.sceneExits(scene),
        neighbours = new Map<string, { node: Row; exit: Row | null }>();
    for (const exit of exits) {
        const node = graph.sceneByHandle(string(exit.to));
        if (node && !neighbours.has(node.node_id))
            neighbours.set(node.node_id, { node, exit });
    }
    for (const value of array(world.scene_trail)) {
        const node = graph.sceneByHandle(string(value));
        if (node && node.node_id !== scene.node_id && !neighbours.has(node.node_id))
            neighbours.set(node.node_id, { node, exit: null });
    }
    const lines: Row[] = [];
    for (const conclusion of graph.kind("conclusion")) {
        const clues = (graph.incoming.get(conclusion.node_id) ?? [])
            .filter(r => r.relation_kind === "supports" && graph.nodes.get(r.from_node_id)?.node_kind === "clue")
            .map(r => graph.nodes.get(r.from_node_id)!);
        if (!clues.length)
            continue;
        const missing = clues.filter(node => !discovered.has(graph.handle(node)));
        if (!missing.length)
            continue;
        const record = recordOf(conclusion),
            entries = new Map(array(record.clues).map(entry => [string(row(entry).clue_id), row(entry)])),
            deliveryOf = (node: Row): string | null => { const line = entries.get(node.node_id)?.delivery; return typeof line === "string" && line ? chars(line, 120) : null; },
            hereRows = missing.filter(node => here.has(node.node_id)),
            placed = new Set(hereRows.map(n => n.node_id)),
            next: Row[] = [];
        for (const { node, exit } of neighbours.values()) {
            const there = new Set(graph.sceneClueIds(node)),
                found = missing.filter(clue => there.has(clue.node_id) && !placed.has(clue.node_id));
            if (!found.length)
                continue;
            for (const clue of found)
                placed.add(clue.node_id);
            const entry: Row = { scene: graph.handle(node), clues: found.length },
                line = found.map(deliveryOf).find(truth);
            if (line)
                entry.line = line;
            if (exit && truth(exit.when) && row(exit.when).kind !== "always" && conditionStatus(exit.when, world) !== true)
                entry.locked = describeCondition(exit.when);
            if (!exit)
                entry.via = "back";
            next.push(entry);
        }
        const handed = hereRows.flatMap(node => {
            const entry = entries.get(node.node_id) ?? {},
                kind = string(row(node.properties).delivery_kind || entry.delivery_kind || "");
            if (kind === "obvious")
                return [{ clue: graph.handle(node), by: "obvious" }];
            const speakers = array(entry.source_npc_ids).map(string).filter(id => presentIds.has(id));
            return kind === "npc_dialogue" && speakers.length ? [{ clue: graph.handle(node), by: graph.displayName(graph.nodes.get(speakers[0])!) }] : [];
        });
        const line: Row = {
            name: graph.handle(conclusion),
            needs: chars(string(record.description || conclusion.summary || graph.displayName(conclusion)), 110),
            importance: string(record.importance || "unknown"),
            missing: missing.length,
            of: clues.length,
            here: hereRows.slice(0, 5).map(node => ({ clue: graph.handle(node), gate: clueGate(graph, node), ...(deliveryOf(node) ? { line: deliveryOf(node) } : {}) })),
            next: next.sort((a, b) => Number(b.clues) - Number(a.clues)).slice(0, 4),
            beyond: missing.filter(node => !placed.has(node.node_id)).length
        };
        if (handed.length)
            line.handed = handed.slice(0, 4);
        if (typeof record.minimum_routes === "number")
            line.minimum_routes = record.minimum_routes;
        // The book's own recovery is for a line the party cannot reach from here; a reachable line does not need it.
        if (typeof record.fallback_policy === "string" && record.fallback_policy && !hereRows.length && !next.length)
            line.fallback = chars(record.fallback_policy, 160);
        lines.push(line);
    }
    lines.sort((a, b) => rank(a.importance) - rank(b.importance) || Number(a.missing) - Number(b.missing));
    const section: Row = { lines: lines.slice(0, 6) };
    if (lines.length > 6)
        section.truncated = true;
    if (section.lines.some((line: Row) => truth(line.handed)))
        section.handed = HANDED;
    // The mods section has no budget of its own, so this one keeps to a few KB. A line with clues in this scene is
    // the actionable part and goes last: first the other lines lose their words, then they go, then the rest.
    const compact = (line: Row): Row => ({ name: line.name, importance: line.importance, missing: line.missing, of: line.of, here: array(line.here).map((e: Row) => ({ clue: e.clue, gate: e.gate })), next: array(line.next).map((e: Row) => ({ scene: e.scene, clues: e.clues, ...(truth(e.locked) ? { locked: e.locked } : {}) })), beyond: line.beyond, ...(truth(line.handed) ? { handed: line.handed } : {}), ...(Object.hasOwn(line, "minimum_routes") ? { minimum_routes: line.minimum_routes } : {}) });
    const steps: (() => boolean)[] = [
        () => { const i = section.lines.findLastIndex((l: Row) => !array(l.here).length && Object.hasOwn(l, "needs")); if (i < 0) return false; section.lines[i] = compact(section.lines[i]); return true; },
        () => { const i = section.lines.findLastIndex((l: Row) => !array(l.here).length); if (i < 0) return false; section.lines.splice(i, 1); return true; },
        () => { const i = section.lines.findLastIndex((l: Row) => Object.hasOwn(l, "needs")); if (i < 0) return false; section.lines[i] = compact(section.lines[i]); return true; },
        () => { if (section.lines.length <= 1) return false; section.lines.pop(); return true; }
    ];
    while (jsonSize(section) > THREAD_BUDGET) {
        if (!steps.some(step => step()))
            break;
        section.truncated = true;
    }
    return section;
}
