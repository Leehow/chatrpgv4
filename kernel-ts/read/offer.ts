/** The Director's offer (docs/specs/turn-floor.md D2): at most three rows the Keeper can put in a
 *  sentence this turn, derived from material the capsule already carries. No model call, no judgement
 *  of prose; every row says where it came from. */
import { array, row, string, truth, chars, type Row } from "./values.js";
export const OFFER_ROWS = 3;
export const OFFER_LINE_CHARS = 120;
/** Which kinds each beat asks for, in order; RECOVER is the keeper-pacing ladder (consequence, person, information). */
export const OFFER_ORDER: Readonly<Record<string, readonly string[]>> = Object.freeze({
    RECOVER: ["consequence", "person", "route"],
    PAYOFF: ["route", "person", "pressure"],
    CUT: ["route", "person", "pressure"],
    CHARACTER: ["person", "pressure", "route"],
    PRESSURE: ["pressure", "consequence", "person"],
    SUBSYSTEM: ["consequence", "pressure", "person"],
    CHOICE: ["person", "route", "pressure"],
    REVEAL: ["person", "route", "pressure"],
    DEEPEN: ["person", "consequence", "route"],
    MONTAGE: ["route", "pressure", "person"],
    ADVANCE: ["person", "route", "pressure"]
});
const DEFAULT_ORDER: readonly string[] = ["person", "route", "pressure", "consequence"];
export interface OfferSources {
    present: Row[];
    where: Row;
    thread?: Row | null;
    pacing?: Row | null;
    pressures: Row[];
    obligations?: Row[];
    previous?: Row | null;
}
/** Clip at a word boundary and mark the cut: a line the Keeper reads must not end mid-word. */
const clip = (text: string): string => {
    const flat = text.replace(/\s+/g, " ").trim();
    if (Array.from(flat).length <= OFFER_LINE_CHARS)
        return flat;
    const head = chars(flat, OFFER_LINE_CHARS - 1), space = head.lastIndexOf(" ");
    return (space > OFFER_LINE_CHARS / 2 ? head.slice(0, space) : head) + "…";
};
/** The clue an exit's unlock condition names, when it is a `clue_discovered: <clue>` condition. */
function unlockClue(exit: Row): string | null {
    const condition = string(row(exit.unlock_when).condition || "");
    const match = /^clue_discovered:\s*(\S+)/.exec(condition);
    return match ? match[1] : null;
}
function personRows(present: Row[]): Row[] {
    return present.filter(npc => truth(npc.wants)).map(npc => {
        const parts = [`${string(npc.name)} wants: ${string(npc.wants)}`];
        const lie = array(npc.would_lie_about)[0];
        if (truth(lie))
            parts.push(`would say: ${string(lie)}`);
        else if (truth(npc.voice))
            parts.push(`voice: ${string(npc.voice)}`);
        // The clues this person can hand and has not yet: the book means them to be said, and saying them
        // without `apply clue` is what the verifier reports as a reveal.
        const hands = array(npc.knows).filter(k => row(k).discovered === false).map(k => string(row(k).clue)).slice(0, 2);
        return { kind: "person", who: string(npc.name), line: clip(parts.join("; ")), ...(hands.length ? { can_hand: hands } : {}), from: "present" };
    });
}
function routeRows(where: Row, present: Row[], thread: Row | null | undefined): Row[] {
    const named = new Map<string, string>();
    for (const line of array(thread?.lines))
        for (const next of array(row(line).next))
            if (truth(row(next).scene) && !named.has(string(row(next).scene)))
                named.set(string(row(next).scene), string(row(next).line || ""));
    const exits = array(where.exits).filter(exit => row(exit.unlock_when).met !== false && (exit.material == null || exit.material === "ready"));
    const rows = exits.map(exit => {
        const to = string(exit.to), clue = unlockClue(exit);
        const guide = present.find(npc => clue != null && array(npc.knows).some(k => string(row(k).clue) === clue));
        const line = named.get(to) || (guide ? `${string(guide.name)} can point the way to ${to}` : `the way to ${to} is open`);
        return { kind: "route", where: to, ...(guide ? { who: string(guide.name) } : {}), line: clip(line), from: named.has(to) ? "mods.thread" : "where.exits", ranked: (named.has(to) ? 0 : 1) + (guide ? 0 : 2) };
    });
    if (rows.length)
        return rows.sort((a, b) => a.ranked - b.ranked).map(({ ranked: _ranked, ...rest }) => rest);
    return noWayOpen(where);
}
/**
 * Contract §49: not one way out of this scene is open, so the offer says which ways exist and what
 * stands in each one. A route pool that is simply empty is how a table spends nineteen turns at a door.
 *
 * Nothing here is ranked beside an open route -- this runs only when there is no open route at all --
 * so an ordinary scene's offer is untouched.
 */
function noWayOpen(where: Row): Row[] {
    const rows: Row[] = [];
    for (const exit of array(where.exits)) {
        const to = string(exit.to), condition = string(row(exit.unlock_when).condition || "");
        if (row(exit.unlock_when).met === false)
            rows.push({ kind: "route", where: to, blocked: "locked", from: "where.exits",
                line: clip(`the way to ${to} is closed${condition ? `: ${condition}` : ""}, and opening it is the way on`) });
        else
            // `apply move` reads a destination's pages itself: the material gate raises `material_pending`
            // and the host reads it in the foreground before the move lands, so an unread way out is still
            // a way out. Filtering it away left one campaign eleven turns at a start scene whose single
            // exit -- the only entrance to the whole scenario -- was `material: "missing"`: no roll, no
            // clock, no word to the Keeper or the player about why.
            rows.push({ kind: "route", where: to, blocked: "material", from: "where.exits",
                line: clip(`the way to ${to} is the book's own and its pages are not read yet: apply move to ${to} reads them and takes it`) });
    }
    for (const entry of array(where.back))
        rows.push({ kind: "route", where: string(row(entry).to), from: "where.back",
            line: clip(`the way back to ${string(row(entry).to)} is open`) });
    return rows;
}
function pressureRows(pacing: Row | null | undefined, pressures: Row[], obligations: Row[]): Row[] {
    const clocks = array(pacing?.threat_clocks).filter(clock => truth(row(clock).next)).map(clock => ({
        kind: "pressure", target: { threat: string(row(clock).threat), clock: string(row(clock).clock) },
        line: clip(string(row(clock).threat) + " (" + string(row(clock).state) + "): " + string(row(clock).next)), from: "mods.pacing"
    }));
    const other = pressures.filter(p => truth(p.name) || truth(p.summary) || truth(p.kind)).map(p => ({
        kind: "pressure", line: clip([string(p.kind || ""), string(p.name || p.summary || "")].filter(Boolean).join(": ")), from: "pressures"
    }));
    const continuations = obligations.filter(o => o.kind === "continuation").map(o => ({
        kind: "pressure", line: clip([string(o.name), string(o.cue || "")].filter(Boolean).join(": ")), from: "obligations"
    }));
    return [...clocks, ...other, ...continuations];
}
function consequenceRows(previous: Row | null | undefined): Row[] {
    const receipts = array(previous?.receipts), rows: Row[] = [];
    for (const receipt of receipts) {
        if (receipt.kind === "roll" && receipt.form !== "dice" && receipt.passed === false)
            rows.push({ kind: "consequence", who: string(receipt.actor_label || receipt.actor || ""), line: clip(string(receipt.actor_label || receipt.actor || "someone") + "'s " + string(receipt.skill || receipt.decision || "check") + " failed last turn; its consequence is still owed"), from: "recent.receipts" });
        else if (receipt.kind === "npc" && truth(receipt.stance))
            rows.push({ kind: "consequence", who: string(receipt.name || receipt.handle || ""), line: clip(string(receipt.name || receipt.handle) + " turned " + string(receipt.stance) + " last turn" + (truth(receipt.why) ? " (" + string(receipt.why) + ")" : "") + "; that stands in the room now"), from: "recent.receipts" });
    }
    return rows;
}
/** Up to three rows in the beat's order, one kind at a time, then the rest of what is available. */
export function directorOffer(beat: string, sources: OfferSources): Row[] {
    const pools: Record<string, Row[]> = {
        person: personRows(sources.present),
        route: routeRows(sources.where, sources.present, sources.thread),
        pressure: pressureRows(sources.pacing, sources.pressures, array(sources.obligations)),
        consequence: consequenceRows(sources.previous)
    };
    const order = [...(OFFER_ORDER[beat] ?? DEFAULT_ORDER), ...DEFAULT_ORDER.filter(kind => !(OFFER_ORDER[beat] ?? DEFAULT_ORDER).includes(kind))];
    const chosen: Row[] = [];
    for (const kind of order) {
        const next = pools[kind]?.shift();
        if (next)
            chosen.push(next);
        if (chosen.length >= OFFER_ROWS)
            break;
    }
    for (const kind of order)
        while (chosen.length < OFFER_ROWS && pools[kind]?.length)
            chosen.push(pools[kind].shift()!);
    // A consequence still owed from last turn is the world's answer the floor asks for first: when the beat's
    // order left it out and one exists, it takes the last seat.
    if (pools.consequence.length && !chosen.some(r => r.kind === "consequence")) {
        if (chosen.length >= OFFER_ROWS)
            chosen.pop();
        chosen.push(pools.consequence.shift()!);
    }
    return chosen;
}
/** Receipt categories counted by offline Director adoption telemetry. Never a delivery obligation. */
export const RECOVERY_TAKES: readonly string[] = ["clue", "move", "npc", "session", "handout", "map", "item"];
