/** Structural pacing facts a Director package reads: how many times this table has already brushed death, and
 *  what the related threat clocks show at their current segment. Rule-derived where a page exists; never a
 *  judgement of prose. */
import { ModuleGraph, recordOf } from "./module-graph.js";
import { relatedThreats } from "./pressures.js";
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
export function threatSymptoms(graph: ModuleGraph, scene: Row, present: Row[]): Row[] {
    return relatedThreats(graph, scene, present).flatMap(threat => array(recordOf(threat).clocks).flatMap(clock => {
        if (!clock || typeof clock !== "object" || Array.isArray(clock))
            return [];
        const current = number(clock.current_segments ?? 0),
            visible = array(clock.on_tick_visible).map(string);
        const entry: Row = { threat: graph.handle(threat), clock: string(clock.name || clock.clock_id || clock.id || "clock"), state: `${current}/${string(clock.segments ?? "?")}` };
        if (current > 0 && visible.length)
            entry.symptom = visible[Math.min(current, visible.length) - 1];
        if (typeof clock.on_full === "string" && clock.on_full)
            entry.on_full = clock.on_full;
        return [entry];
    }));
}
/** `records` are closed turns only, so every one of them is before the open turn. */
export function pacingSection(graph: ModuleGraph, scene: Row, present: Row[], party: Row[], records: Row[]): Row {
    return {
        close_calls: { count: closeCalls(records, party, Number.MAX_SAFE_INTEGER), threshold: FAIR_WARNING_THRESHOLD, rule: "keeper-rulebook p.209 fair warning; a call is a major-wound blow or a drop to zero" },
        threat_clocks: threatSymptoms(graph, scene, present)
    };
}
