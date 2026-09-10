/** Existing structural pressure and obligation projections; source prose is never classified. */
import { ModuleGraph, recordOf } from "./module-graph.js";
import { values, array, row, number, string, truth, normalize, sorted, type Row } from "./values.js";
const CLOCKS: Row = {
    "healing:first-aid-ordinary": "wound_hour",
    "healing:dying-hour-clock": "dying_hour",
    "healing:dying-round-clock": "dying_round",
    "healing:first-aid-stabilization": "dying_round",
    "healing:weekly-major-wound-recovery": "weekly",
    "sanity:bout-tick": "bout"
};
export function clockPressures(situations: Row[], party: Row[], session: Row | null, fraction: any[]): [
    Row[],
    boolean
] {
    const [num, den] = fraction.map(v => number(v)),
        sheets = new Map(party.map(sheet => [string(sheet.id), sheet])),
        seen = new Set<string>(),
        result: Row[] = [];
    let near = false;
    for (const situation of situations) {
        const kind = CLOCKS[string(situation.decision)],
            who = string(situation.investigator),
            key = `${kind}\0${who}`;
        if (!kind || seen.has(key))
            continue;
        seen.add(key);
        const sheet = row(sheets.get(who)),
            entry: Row = {
            kind: "clock",
            cue: situation.decision ?? null
        };
        let segments: number[] | null = null;
        if (kind === "wound_hour") {
            const fact = array(situation.because).find(v => string(v).startsWith("time.minutes_since_injury = ")),
                text = fact ? string(fact).split(" = ").slice(1).join(" = ") : "",
                elapsed = /^[+-]?\d+$/.test(text) ? Number(text) : 0;
            Object.assign(entry, {
                name: "the hour after the wound",
                state: `${elapsed}/60 minutes gone`,
                due: `first-aid window closes in ${Math.max(0, 60 - elapsed)} min`
            });
            segments = [elapsed, 60];
        }
        else if (kind === "dying_hour" || kind === "dying_round") {
            entry.name = kind === "dying_hour" ? "dying (stabilized, hour clock)" : "dying (unstabilized, CON per round)";
            entry.state = `HP ${string(sheet.current_hp)}`;
            near = true;
        }
        else if (kind === "weekly")
            Object.assign(entry, {
                name: "weekly major-wound recovery",
                state: "due this week"
            });
        else if (kind === "bout") {
            const bout = session?.kind === "sanity_bout" ? row(session.bout) : {},
                total = number(bout.duration_rounds),
                left = number(bout.rounds_remaining);
            Object.assign(entry, {
                name: "bout of madness",
                state: `${left}/${total} rounds left`,
                due: `${left} rounds`
            });
            if (total > 0)
                segments = [total - left, total];
        }
        if (segments && segments[1] > 0 && segments[0] * den >= segments[1] * num)
            near = true;
        if (sheets.size > 1)
            entry.who = string(sheet.name || who);
        result.push(entry);
    }
    return [result, near];
}
/** Threat nodes that concern this scene or someone present: reachable by present-in / located-in / contains in
 *  either direction, or whose danger names one of the NPCs on stage. One relatedness for pressures and for the
 *  pacing package's clock symptoms. */
export function relatedThreats(graph: ModuleGraph, scene: Row, present: Row[]): Row[] {
    const targets = new Set([scene.node_id, ...present.map(n => n.node_id)]),
        keys = new Set(present.flatMap(n => [graph.handle(n), graph.displayName(n), n.node_id, n.name || ""]).map(normalize));
    return graph.kind("threat").filter(threat => {
        const outgoing = graph.out.get(threat.node_id) ?? [],
            incoming = graph.incoming.get(threat.node_id) ?? [],
            record = recordOf(threat);
        return outgoing.some(r => ["present-in", "located-in", "contains"].includes(r.relation_kind) && targets.has(r.to_node_id)) || incoming.some(r => ["present-in", "located-in", "contains"].includes(r.relation_kind) && targets.has(r.from_node_id)) || array(record.dangers).some(d => ["monster_ref", "id", "npc_id"].some(k => typeof row(d)[k] === "string" && keys.has(normalize(d[k]))));
    });
}
export function threatPressures(graph: ModuleGraph, scene: Row, present: Row[]): Row[] {
    const moves = array(recordOf(scene).pressure_moves).map(string);
    return relatedThreats(graph, scene, present).flatMap(threat => {
        const record = recordOf(threat);
        const clock = array(record.clocks).find(c => c && typeof c === "object" && !Array.isArray(c));
        return [{
                kind: "threat",
                name: graph.handle(threat),
                state: clock ? `${string(clock.current_segments ?? 0)}/${string(clock.segments ?? "?")}` : `no clock; ${array(record.dangers).length} danger(s)`,
                ...(moves.length ? { cue: moves.join("; ") } : {})
            }];
    });
}
export function unansweredContinuations(previous: Row | null | undefined, receipts: Row[]): Row[] {
    if (!previous)
        return [];
    const continued = new Set([...array(previous.receipts), ...receipts].filter(r => truth(r.source_receipt)).map(r => string(r.source_receipt))),
        result: Row[] = [];
    for (const call of values(row(previous.calls))) {
        const outcome = row(row(call).result),
            source = outcome.receipt,
            prior = array(previous.receipts).find(r => r.id === source);
        if (continued.has(source) || truth(prior?.continued_by))
            continue;
        for (const continuation of array(outcome.continuations))
            if (truth(continuation.decision) && !truth(continuation.executed))
                result.push({
                    decision: string(continuation.decision),
                    source: source ?? null,
                    needs: (truth(continuation.action) ? array(continuation.action) : array(continuation.needs)).map(string)
                });
    }
    return result;
}
export function continuationRows(continuations: Row[], obligation = false): Row[] {
    return continuations.map(value => ({
        kind: obligation ? "continuation" : "rule",
        name: value.decision,
        ...(obligation ? { who: "player" } : {}),
        state: "left by last turn, unanswered",
        ...(array(value.needs).length ? { cue: `needs action.${value.needs.join("/")}` } : {})
    }));
}
export function questObligations(graph: ModuleGraph, world: Row): Row[] {
    return graph.kind("quest").map(quest => {
        const clues = sorted(new Set([...(graph.out.get(quest.node_id) ?? []).filter(r => ["supports", "may-lead-to"].includes(r.relation_kind)).map(r => r.to_node_id), ...(graph.incoming.get(quest.node_id) ?? []).filter(r => r.relation_kind === "supports").map(r => r.from_node_id)].filter(id => graph.nodes.get(id)?.node_kind === "clue").map(id => graph.handle(graph.nodes.get(id)!))));
        const found = clues.filter(clue => array(world.discovered_clues).includes(clue)),
            record = recordOf(quest),
            giver = graph.nodes.get(row(record.giver).ref_id);
        return {
            kind: "quest",
            name: string(record.title || graph.displayName(quest)),
            state: !clues.length ? "not started (no clue markers)" : !found.length ? "not started" : found.length < clues.length ? `in progress (${found.length}/${clues.length} clues)` : `can close (${clues.length}/${clues.length} clues)`,
            ...(giver ? { who: graph.displayName(giver) } : {}),
            ...(typeof record.importance === "string" ? { cue: record.importance } : {})
        };
    });
}
export function choiceObligation(pending: any): Row[] {
    return truth(pending) ? [{
            kind: "choice",
            name: string(pending.name),
            who: string(pending.for || "player"),
            state: "pending",
            ...(truth(pending.prompt) ? { cue: string(pending.prompt) } : {})
        }] : [];
}
export function sessionObligation(session: Row | null): Row[] {
    if (session?.status !== "active")
        return [];
    const person = array(session.participants).find(p => p.name === session.turn_of),
        label = person ? person.label || person.name : session.turn_of,
        actions = [...new Set(array(session.actions).filter(a => truth(a.decision)).map(a => string(a.decision)))];
    return [{
            kind: "session",
            name: string(session.kind),
            who: string(label || "-"),
            state: `round ${string(session.round)}, ${string(label || "-")} to act`,
            ...(actions.length ? { cue: actions.join(", ") } : {})
        }];
}
