/** Structural pacing facts a Director package reads: how many times this table has already brushed death, and
 *  what the related threat clocks show at their current segment. Rule-derived where a page exists; never a
 *  judgement of prose. */
import { ModuleGraph, recordOf } from "./module-graph.js";
import { relatedThreats, clockSegment } from "./pressures.js";
import { playedRecords } from "./director.js";
import { array, row, number, integer, string, truth, type Row } from "./values.js";
/** Keeper Rulebook p.209, fair warning: the ladder counts a blow that would be a major wound (p.119, half of
 *  maximum hit points in one blow) or that took an investigator to zero. Each closed turn counts once. */
export const FAIR_WARNING_THRESHOLD = 3;
export function closeCalls(records: Row[], party: Row[], before: number): number {
    const maximum = new Map(party.map(sheet => [string(sheet.id), number(row(sheet.derived).HP)]));
    let count = 0;
    for (const record of playedRecords(records, before))
        if (array(record.receipts).some(r => r.kind === "delta" && r.resource === "hp" && truth(r.subject_is_investigator) && integer(r.before) && integer(r.after) && (number(r.after) <= 0 || number(r.before) - number(r.after) >= Math.ceil((maximum.get(string(r.subject)) ?? Infinity) / 2))))
            count++;
    return count;
}
/** `pressures` answers what presses here and keeps §13.2's relatedness. This is the Keeper's instrument panel,
 *  and a front the book itself scopes to the scenario runs everywhere in it: The Haunting hangs the landlord
 *  losing patience off the same front as Corbitt, so the relatedness alone hid the clock through the entire
 *  investigation it paces and showed it in the knife fight it has nothing to do with. */
export function pacingThreats(graph: ModuleGraph, scene: Row, present: Row[]): Row[] {
    const related = relatedThreats(graph, scene, present),
        seen = new Set(related.map(threat => threat.node_id));
    return [...related, ...graph.kind("threat").filter(threat => !seen.has(threat.node_id) && string(recordOf(threat).scope) === "scenario")];
}
export function threatSymptoms(graph: ModuleGraph, world: Row, scene: Row, present: Row[]): Row[] {
    return pacingThreats(graph, scene, present).flatMap(threat => array(recordOf(threat).clocks).flatMap(clock => {
        if (!clock || typeof clock !== "object" || Array.isArray(clock))
            return [];
        const current = clockSegment(world, graph.handle(threat), row(clock)),
            visible = array(clock.on_tick_visible).map(string);
        const total = Math.trunc(number(clock.segments ?? 0)),
            entry: Row = { threat: graph.handle(threat), clock: string(clock.clock_id || clock.id || clock.name || "clock"), state: `${current}/${string(clock.segments ?? "?")}` };
        if (current > 0 && visible.length)
            entry.symptom = visible[Math.min(current, visible.length) - 1];
        // A clock nobody moves is a number on a page. The payoff of the next segment rides beside it, so
        // advancing one is an offer with something visible in it rather than an obligation to remember.
        if (current < total && visible.length)
            entry.next = visible[Math.min(current + 1, visible.length) - 1];
        if (typeof clock.on_full === "string" && clock.on_full)
            entry.on_full = clock.on_full;
        return [entry];
    }));
}
/** `records` are closed turns only, so every one of them is before the open turn. */
export function pacingSection(graph: ModuleGraph, world: Row, scene: Row, present: Row[], party: Row[], records: Row[]): Row {
    return {
        close_calls: { count: closeCalls(records, party, Number.MAX_SAFE_INTEGER), threshold: FAIR_WARNING_THRESHOLD, rule: "keeper-rulebook p.209 fair warning; a call is a major-wound blow or a drop to zero" },
        threat_clocks: threatSymptoms(graph, world, scene, present)
    };
}
