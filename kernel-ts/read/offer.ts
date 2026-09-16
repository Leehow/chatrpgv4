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
/** The beats that owe the player a way forward. RECOVER is the Director asking for the keeper-pacing
 *  ladder; CUT is the scene being over and the next place owed. */
export const RECOVERY_BEATS: readonly string[] = ["RECOVER", "CUT"];
/** What discharges a recovery, named as the receipt kinds the turn must land. A failed ordinary check
 *  against the obstacle that is already blocking is not one of them: the Keeper Rulebook allows one retry
 *  of a failed check and only as a push, so the same check opened fresh again is not a step. */
export const RECOVERY_TAKES: readonly string[] = ["clue", "move", "npc", "session", "handout", "map", "item"];
export interface RecoverySources extends OfferSources {
    affordances: Row[];
    /** The offer already drawn for this beat: its person and route rows are the second and third rungs. */
    offer: Row[];
}
/** The recovery the Director is owed this turn, written as operations rather than advice.
 *
 *  Contract §31: a Director line only reaches the table when it names a next operation and that operation
 *  is actually called. `beat` and `offer` were advice — `directorAdoption` is telemetry and says so in its
 *  own comment — and on campaign game-83177d61 the Keeper declined 43 of 52 signals, including six
 *  consecutive RECOVERs while the player wrote "the sanatorium is out, so I'll ask along this street".
 *  Every row here names the verb that discharges it, and the host refuses the turn's first `narrate` once
 *  when none of them landed (contract §40). */
export function directorRecovery(beat: string, blocked: number, sources: RecoverySources): Row | null {
    // `blocked` is the blocked-attempt count once it has reached the graph's own threshold, and 0 below it:
    // the first failure at an obstacle is play -- the risk was real and it cost -- and owes nothing. The beat
    // can be outranked while the party is still stuck on one check (live turns 60 and 62 scored CUT and
    // REVEAL at three failures on one cupboard), so the obstacle owes a recovery on its own account.
    if (!RECOVERY_BEATS.includes(beat) && blocked <= 0)
        return null;
    const steps: Row[] = [];
    // First rung: the world answers what they already did. The rules' own answer to a failed check is the
    // push -- the player reframes, the Keeper states what failure costs, the player confirms -- and those
    // continuations are already sitting unanswered in obligations.
    for (const obligation of array(sources.obligations))
        if (obligation.kind === "continuation" && string(obligation.name).startsWith("push-luck:"))
            steps.push({ rung: "consequence", operation: "resolve", decision: string(obligation.name),
                line: clip(`the failed check is still open to the rules: ${string(obligation.name)} (${string(obligation.cue || "")}). Opening the same check fresh again is not a lawful retry and settles nothing.`) });
    // Second rung: a person present pushes, asks or offers. A clue they can hand is the receipt that proves it.
    for (const entry of array(sources.offer)) {
        const o = row(entry);
        if (o.kind !== "person")
            continue;
        const hands = array(o.can_hand).map(string);
        steps.push({ rung: "person", operation: hands.length ? "apply clue" : "apply npc", who: string(o.who),
            ...(hands.length ? { clue: hands[0] } : {}),
            line: clip(hands.length ? `${string(o.who)} can hand ${hands[0]} now: apply clue with from=${string(o.who)}` : `${string(o.who)} acts on their own want: apply npc with the stance they take and why`) });
    }
    // Third rung: more information within reach. An affordance in this room that yields a clue, or the way out.
    for (const entry of array(sources.affordances)) {
        const a = row(entry), yields = array(a.clues).map(c => string(row(c).clue)).filter(Boolean);
        if (yields.length)
            steps.push({ rung: "information", operation: "apply clue", clue: yields[0], line: clip(`${string(a.id || a.name || "here")} still yields ${yields[0]}: apply clue`) });
    }
    for (const entry of array(sources.offer)) {
        const o = row(entry);
        // A door the book holds closed is information the Keeper needs, never the step the recovery owes:
        // the recovery names operations that are meant to be called, and this one would walk the party
        // through a gate the module set (contract §49).
        if (o.kind === "route" && o.blocked !== "locked")
            steps.push({ rung: "information", operation: "apply move", where: string(o.where), line: clip(string(o.line)) });
    }
    // Three steps, like the offer: the section rides inside the Director's budget beside `because` and the
    // offer's own rows, and the offer's last seat (the consequence still owed) is popped before it.
    return { owed: true, blocked, takes: [...RECOVERY_TAKES],
        steps: steps.slice(0, OFFER_ROWS),
        note: "One of these lands this turn, or the turn's first narrate is refused once. Make no irreversible choice for the player and skip no risk the book gates with a check: put the way forward within reach and let them take it." };
}
