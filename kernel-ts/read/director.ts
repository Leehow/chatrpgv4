/** The existing Director signal and scoring tables, with no write or settlement side. */
import { DirectorGraph, Ontology } from "./content.js";
import { semanticName } from "./rule-facts.js";
import { ModuleGraph, recordOf, moduleDeclaration, conditionMet, describeCondition } from "./module-graph.js";
import { array, row, truth, number, integer, normalize, string, float, round, type Row } from "./values.js";
const SIGNALS = ["structure_type", "intent", "undiscovered_here", "agenda_npc_present", "dramatic_question", "exit_condition_met", "main_line_complete", "stalled_turns", "turns_in_scene", "hp_state", "sanity_state", "session", "last_roll", "pushed_fail_pending", "pending_choice", "clock_near_full", "loop_count", "echoes_here", "loop_available"];
export const HP_STATES = ["healthy", "wounded", "major_wound", "dying", "dead"];
export const SAN_STATES = ["stable", "shaken", "bout_active", "indefinite"];
export const playedRecords = (records: Row[], before: number): Row[] => records.filter(r => number(r.turn) < before && truth(r.player_text)).sort((a, b) => number(b.turn) - number(a.turn));
export function hpState(current: any, maximum: any, conditions: string[]): string {
    const hp = Math.trunc(number(current));
    if (hp < 0)
        return "dead";
    if (hp === 0 && conditions.includes("major_wound"))
        return "dying";
    if (conditions.includes("major_wound"))
        return "major_wound";
    return (integer(maximum) || typeof maximum === "boolean") && hp < number(maximum) ? "wounded" : "healthy";
}
export function intentOfRecord(record?: Row | null): string {
    if (!record)
        return "none";
    const intents = array(record.intents);
    if (intents.length)
        return string(intents.at(-1));
    const kinds = new Set(array(record.receipts).map(r => row(r).kind));
    return kinds.has("move") ? "move" : kinds.size === 1 && kinds.has("time") ? "idle" : "none";
}
export function lastRollOf(record?: Row | null): string {
    for (const receipt of [...array(record?.receipts)].reverse())
        if (receipt.kind === "roll" && receipt.form !== "dice")
            return ["critical", "fumble"].includes(receipt.level) ? receipt.level : truth(receipt.passed) ? "passed" : "failed";
    return "none";
}
export function pushedFailPending(record?: Row | null): boolean {
    const receipts = array(record?.receipts);
    return receipts.some((r, i) => r.kind === "roll" && truth(r.pushed) && !truth(r.passed) && !receipts.slice(i + 1).some(n => n.kind === "delta" && integer(n.before) && integer(n.after) && number(n.after) < number(n.before) || n.kind === "roll" && n.form === "dice" || n.kind === "session" && n.transition === "start"));
}
export const structureType = (graph: ModuleGraph): string => typeof moduleDeclaration(graph.moduleNode).structure_type === "string" && moduleDeclaration(graph.moduleNode).structure_type || "branching_investigation";
export function mainLineComplete(graph: ModuleGraph, world: Row): boolean {
    return graph.kind("conclusion").some(node => {
        const clues = (graph.incoming.get(node.node_id) ?? []).filter(r => r.relation_kind === "supports" && graph.nodes.get(r.from_node_id)?.node_kind === "clue").map(r => graph.handle(graph.nodes.get(r.from_node_id)!));
        return clues.length > 0 && clues.every(c => array(world.discovered_clues).includes(c));
    });
}
export function memoryOverlap(rows: Row[], names: any[]): number {
    const keys = new Set(names.filter(truth).map(normalize));
    return rows.filter(r => r.superseded_by == null && [r.subject, ...array(r.knowers), ...array(r.entities)].some(v => truth(v) && keys.has(normalize(v)))).length;
}
export function signals(options: {
    graph: ModuleGraph;
    world: Row;
    scene: Row;
    turn: Row;
    party: Row[];
    present: Row[];
    undiscovered: number;
    records: Row[];
    session: Row | null;
    nearFull: boolean;
    conditions(sheet: Row): string[];
    sanity(sheet: Row): Row | null;
    worldline?: Row;
}): Row {
    const { graph, world, scene, turn, party, present, session } = options,
        played = playedRecords(options.records, number(turn.turn));
    let stalled = 0,
        turns = 1,
        hp = "healthy",
        san = "stable";
    for (const record of played) {
        if (array(record.receipts).some(r => ["clue", "move", "session"].includes(r.kind)))
            break;
        stalled++;
    }
    for (const record of played) {
        if (row(row(record.world).scene).name !== graph.handle(scene))
            break;
        turns++;
    }
    for (const sheet of party) {
        const h = hpState(sheet.current_hp, row(sheet.derived).HP, options.conditions(sheet));
        if (HP_STATES.indexOf(h) > HP_STATES.indexOf(hp))
            hp = h;
        let lost = false;
        for (const record of played) {
            if (row(row(record.world).scene).name !== graph.handle(scene))
                break;
            if (array(record.receipts).some(r => r.kind === "delta" && r.resource === "san" && string(r.subject) === string(sheet.id) && integer(r.before) && integer(r.after) && number(r.after) < number(r.before))) {
                lost = true;
                break;
            }
        }
        const snapshot = row(options.sanity(sheet)),
            bout = truth(snapshot.bout_active) || array(snapshot.conditions).includes("bout_active");
        const state = bout ? "bout_active" : number(sheet.current_san) <= 0 || truth(snapshot.indefinite_insane) ? "indefinite" : lost ? "shaken" : "stable";
        if (SAN_STATES.indexOf(state) > SAN_STATES.indexOf(san))
            san = state;
    }
    return {
        structure_type: structureType(graph),
        intent: intentOfRecord(played[0]),
        undiscovered_here: options.undiscovered,
        agenda_npc_present: present.filter(n => truth(graph.npcProfile(n).agenda)).length,
        dramatic_question: truth(recordOf(scene).dramatic_question),
        exit_condition_met: array(recordOf(scene).exit_conditions).some(c => conditionMet(c, world)),
        main_line_complete: mainLineComplete(graph, world),
        stalled_turns: stalled,
        turns_in_scene: turns,
        hp_state: hp,
        sanity_state: san,
        session: session?.status === "active" ? string(session.kind || "none") : "none",
        last_roll: lastRollOf(played[0]),
        pushed_fail_pending: pushedFailPending(played[0]),
        pending_choice: truth(turn.pending_choice),
        clock_near_full: options.nearFull,
        loop_count: options.worldline?.loop_count ?? 0,
        echoes_here: options.worldline?.echoes_here ?? 0,
        loop_available: options.worldline?.loop_available ?? false
    };
}
export function score(dg: DirectorGraph, sig: Row, scene: Row, options: {
    canMove: boolean;
    overlap: number;
    pressureAvailable: boolean;
}): Row {
    const because = SIGNALS.filter(name => Object.hasOwn(sig, name)).map(name => `${name} = ${string(sig[name])}`),
        digits = number(dg.threshold("score-precision-digits"));
    const override = sig.session !== "none" ? "session" : sig.hp_state === "dying" ? "dying" : sig.last_roll === "fumble" ? "fumble" : sig.pending_choice ? "pending_choice" : null;
    if (override) {
        const beat = override === "session" || override === "dying" ? "SUBSYSTEM" : override === "fumble" ? "PRESSURE" : "CHOICE";
        const reasons: Row = {
            session: "a session is live; hand it to the subsystem",
            dying: "someone is dying: subsystem takes over, pressure on",
            fumble: "last roll fumbled; misfortune lands now",
            pending_choice: "a choice is pending; the player answers first"
        };
        const grounding = override === "session" ? ["scoring-rule:subsystem:combat-flee-cast-intent"] : override === "dying" ? ["craft-directive:dying-forces-rescue-subsystem", "craft-directive:dying-clock-kind"] : [];
        return {
            beat,
            reason: reasons[override],
            because: [...because, ...(override === "dying" ? ["extra = PRESSURE"] : [])],
            scores: { [beat]: float(1) },
            override,
            hit_rules: grounding
        };
    }
    const hits = new Map<string, Array<[
        string,
        number
    ]>>();
    const hit = (beat: string, condition: string, value?: number) => hits.set(beat, [...(hits.get(beat) ?? []), [condition, value ?? number(dg.score(beat, condition))]]);
    const linear = (value: any, steps: number) => {
        const [base, per, cap] = array(value).map(v => number(v));
        return Math.min(cap, base + per * steps);
    };
    const intent = sig.intent,
        stalled = number(sig.stalled_turns);
    if (sig.undiscovered_here > 0 && ["investigate", "social"].includes(intent))
        hit("REVEAL", intent + "-intent");
    if (sig.dramatic_question && ["investigate", "social"].includes(intent))
        hit("DEEPEN", "dramatic-question-present");
    hit("PRESSURE", "baseline");
    if (sig.clock_near_full || stalled >= number(dg.threshold("pressure-stalled-turns")))
        hit("PRESSURE", "clock-near-full-or-stalled");
    if (sig.turns_in_scene >= 3 && sig.undiscovered_here === 0 && options.pressureAvailable)
        hit("PRESSURE", "yielded-scene");
    if (sig.agenda_npc_present > 0)
        hit("CHARACTER", "agenda-npc-in-scene");
    if (["idle", "ambiguous", "stuck"].includes(intent) && sig.undiscovered_here >= number(dg.threshold("choice-undiscovered-clue-count")))
        hit("CHOICE", "two-undiscovered-clues");
    if (options.canMove) {
        if (intent === "move")
            hit("CUT", "explicit-move-intent");
        if (sig.exit_condition_met)
            hit("CUT", "exit-condition-met");
        if (sig.main_line_complete && !recordOf(scene).is_final)
            hit("CUT", "main-line-complete");
        if (stalled >= number(dg.threshold("cut-stalled-transition-turns")))
            hit("CUT", "stalled-transition-pressure", linear(dg.score("CUT", "stalled-transition-pressure"), stalled));
    }
    if (intent === "montage")
        hit("MONTAGE", "montage-intent");
    if (options.overlap > 0)
        hit("PAYOFF", "structured-entity-overlap", linear(dg.score("PAYOFF", "structured-entity-overlap"), options.overlap));
    if (stalled >= number(dg.threshold("recover-stalled-turns")))
        hit("RECOVER", "stalled-turns");
    if (["combat", "flee", "cast"].includes(intent))
        hit("SUBSYSTEM", "combat-flee-cast-intent");
    const weighted = new Map<string, number>();
    for (const beat of dg.actions) {
        const rows = hits.get(beat) ?? [];
        let base = Math.max(0, ...rows.map(r => r[1]));
        if (beat === "PRESSURE" && sig.pushed_fail_pending) {
            const nudge = number(dg.score(beat, "pushed-fail-nudge"));
            base = Math.min(number(dg.threshold("pressure-posture-ceiling")), round(base + nudge, digits));
            rows.push(["pushed-fail-nudge", nudge]);
            hits.set(beat, rows);
        }
        weighted.set(beat, round(base * dg.weight(sig.structure_type, beat), digits));
    }
    const top = Math.max(0, ...weighted.values()),
        rank = (beat: string) => dg.tiebreak.includes(beat) ? dg.tiebreak.indexOf(beat) : dg.tiebreak.length;
    const ranked = [...weighted].sort((a, b) => b[1] - a[1] || rank(a[0]) - rank(b[0]));
    if (top <= 0 || ![...hits.values()].some(rows => rows.some(([condition]) => condition !== "baseline")))
        return {
            beat: "ADVANCE",
            reason: "no trigger; advance",
            because,
            scores: {},
            hit_rules: []
        };
    const tied = [...weighted].filter(([, value]) => value === top).map(([beat]) => beat),
        chosen = dg.tiebreak.find(beat => tied.includes(beat)) ?? tied[0];
    const conditions = (hits.get(chosen) ?? []).map(([condition]) => condition);
    return {
        beat: chosen,
        reason: `${chosen}: ${conditions.join(", ")} hold, weighted ${string(float(weighted.get(chosen)!))}`,
        because,
        scores: Object.fromEntries(ranked.slice(0, 3).filter(([, value]) => value > 0).map(([beat, value]) => [beat, float(value)])),
        hit_rules: conditions.map(c => dg.ruleIds.get(`${chosen}\0${c}`)).filter(Boolean)
    };
}
/** Project the recorded delivery and check, followed by any unlock conditions (§30.12).
 *  Missing check metadata says nothing about whether the source requires or waives a roll.
 *  The Keeper can consult the existing source/rule material without treating this gap as a new gate. */
export function clueGate(graph: ModuleGraph, node: Row): string {
    const profile = graph.clueProfile(node),
        delivery = string(profile.delivery_kind || "unknown"),
        conditions: string[] = [];
    const authored = typeof profile.skill === 'string' && profile.skill
        ? profile.skill + (typeof profile.difficulty === 'string' && profile.difficulty ? ` (${profile.difficulty})` : '') : '';
    for (const key of ["unlock", "requires", "unlock_when", "when"]) {
        const condition = profile[key];
        if (truth(condition))
            conditions.push(describeCondition(condition));
    }
    const check = authored || (delivery === "skill_check" ? "check required (skill unspecified)" : "check unspecified");
    return `${delivery}: ${check}` + (conditions.length ? "; " + conditions.join("; ") : "");
}
export function directorSection(dg: DirectorGraph, ontology: Ontology, graph: ModuleGraph, world: Row, scene: Row, sig: Row, memory: Row[], present: Row[]): Row {
    const scored = score(dg, sig, scene, {
        canMove: graph.sceneExits(scene).length > 0 || truth(world.scene_trail),
        overlap: memoryOverlap(memory, [...present.map(n => graph.displayName(n)), ...array(world.discovered_clues)]),
        pressureAvailable: truth(recordOf(scene).pressure_moves)
    });
    const grounded = ontology.groundedBy(scored.hit_rules),
        decisions = grounded.filter(g => g.startsWith("decision:"));
    const section: Row = {
        beat: scored.beat,
        reason: scored.reason,
        because: scored.because,
        grounded_by: [...grounded.map(g => g.startsWith("decision:") ? semanticName(g) : g), ...ontology.effectsOf(decisions)],
        scores: scored.scores
    };
    if (scored.override)
        section.override = scored.override;
    if (scored.beat === "REVEAL")
        section.reveal = graph.sceneClueIds(scene).map(id => graph.nodes.get(id)!).filter(node => !array(world.discovered_clues).includes(graph.handle(node))).slice(0, 5).map(node => ({
            clue: graph.handle(node),
            gate: clueGate(graph, node)
        }));
    return section;
}
