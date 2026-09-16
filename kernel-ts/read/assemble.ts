/** Assemble the existing capsule from read-only snapshots and validated content. */
import { CampaignSnapshot, loadModule, type LoadedModule } from "./campaign.js";
import { DirectorGraph, TextGraph, Ontology } from "./content.js";
import { RuleObservations } from "./rule-facts.js";
import { SessionView } from "./session-view.js";
import { whereSection, clockSection, npcsPresent, cluesHere, presentSection, knownSection, fitBudget, fittedModuleSection, sceneLabel, voicesSection } from "./capsule.js";
import { playedRecords, signals, directorSection } from "./director.js";
import { EntityIndex, capsuleMemory, noteObligations, rulingsForCapsule, promiseObligations } from "./memory.js";
import { clockPressures, threatPressures, unansweredContinuations, continuationRows, questObligations, choiceObligation, sessionObligation } from "./pressures.js";
import { evidenceAcquired, evidenceDeliveryRecords } from "./continuity.js";
import { worldlineSection, crossLineReader, loopObligation, worldlineSignals } from "./worldline.js";
import { modContext } from "./mods.js";
import { directorOffer, directorRecovery } from "./offer.js";
import { pythonJsonDumps, utf8Bytes } from "../json.js";
import { playLanguageOf } from "./languages.js";
import { RpcError } from "../errors.js";
import { array, row, number, string, truth, chars, clone, type Row } from "./values.js";
import type { ModuleGraph } from "./module-graph.js";
export const HEAD = "Everything at the start of this turn: the clock, the undiscovered clues here and their gates, the secrets " +
    "and agendas of those present, the way back and the exits, pressures and obligations, the rule-layer " +
    "situations, the Director's suggested beat, related memory and the style contract. Do not look/lookup " +
    "for what is already here; director is advice, not lines. Truncated place/rule previews are incomplete; " +
    "look focus=scene returns their full descriptions. where.material and each exit's material say how " +
    "far the book has been read: ready, reading, or missing. An exit's unlock_when.met is true, false, or null " +
    "when the kernel cannot tell; a gate never blocks a move. known.flags lists the flags set so far; " +
    "known.investigator.conditions is what the rules currently hold true of the body, and cannot_act, when " +
    "present, means the kernel will refuse an action declared for them until it is gone; " +
    "obligations of kind note are your own open continuity notes; rulings are your earlier rulings that " +
    "bind here, reminders, not rules. worldlines is which line the table is on and which circuit of the " +
    "loop, where the anchor is, what a rewind would leave standing and who would remember it; " +
    "loop_available true means this scene can be rewound with apply fork mode: loop, which happens after " +
    "you narrate this turn. director.offer is what can move this turn, in your hand — a person with a want, " +
    "a way that is open, a pressure, a consequence still owed — take it, change it or leave it; an empty turn " +
    "(nothing landed, nobody acted) is not a quiet scene. style.floor is what every turn owes. " +
    "director.recovery, when present, is the one part of the Director that is not advice: the player is " +
    "blocked and its steps name the operation that unblocks them. Take one — its receipt closes the debt — " +
    "or this turn's first narrate is refused once. It never asks you to choose for the player or to skip a " +
    "risk the book gates with a check. voices is how each person present talks: their mask (what they call " +
    "people, how their sentences end, the level of their words, one pet phrase) and exchanges that show it in " +
    "reply. Wear the mask on every line that person speaks; never read an exchange out. " +
    "unrecorded is a clue an earlier turn's prose already gave the player while the ledger still calls it " +
    "undiscovered: its line names the call that closes the gap. It is not a debt to invent anything — the " +
    "player was told, and only the books disagree. Record it, or leave it and it stays until they walk away.";
export const HEAD_MODULE = " This turn also carries a module section (the table briefing, this once): what the book is about, its era, " +
    "the factions, places and people (absent ones included, keeper-only), the ending and conclusion names and " +
    "the structure type; do not lookup the book before opening.";
export const BUDGETS: Readonly<Record<string, number>> = Object.freeze({
    where: 4096,
    present: 3072,
    known: 3072,
    recent: 2048
});
export const SLICE2_BUDGETS: Readonly<Record<string, number>> = Object.freeze({
    memory: 1536,
    warnings: 1024,
    // Contract §51.4. Small on purpose: a row is a handle, a turn, the sentence that gave it away and
    // the call that closes it, and the list only holds what is still findable in this one scene.
    unrecorded: 768
});
export const SLICE3_BUDGETS: Readonly<Record<string, number>> = Object.freeze({
    pressures: 1024,
    obligations: 1024,
    // 2048 since the turn floor (docs/specs/turn-floor.md D2): the offer rides beside because and grounded_by;
    // 3072 since the recovery (contract §40), which is the one part of the section the Keeper must answer and
    // must not cost the offer its seats -- the offer is popped first when the section is over, and at 2560 the
    // recovery pushed out the consequence still owed, which is the recovery's own first rung.
    director: 3072,
    situations: 1024,
    // 1536 since the turn floor (docs/specs/turn-floor.md D1): the brief form carries the four floor lines beside the beat's directives.
    style: 1536,
    // Contract §40.7: the lines-shaped words of everyone present, trimmed exchanges-first before a person is dropped.
    voices: 3072
});
/**
 * Clues the prose already gave away and the ledger never got (contract §51.4).
 *
 * `warnings` shows the Keeper one turn's findings and then they are gone, which is the whole of why
 * the gap outlived the notice: on campaign `game-ef8e60aa` the lane said in turn 11 that Dooley had
 * pointed at the burned chapel, turn 12's capsule carried the sentence, and after that the only
 * place that lead existed was the transcript. A row here is not an obligation and not a prompt to
 * find something new -- the finding was delivered, and this is the books disagreeing with it. It
 * clears itself two ways and needs no writer to retract it: `apply clue` puts the handle into
 * `discovered_clues`, and walking out of the scene takes it out of `sceneClueIds`.
 */
export function unrecordedClues(graph: ModuleGraph, world: Row, scene: Row, records: Row[], turn: number): Row[] {
    const discovered = new Set(array(world.discovered_clues).map(value => string(value)));
    const here = new Set(graph.sceneClueIds(scene).map(id => graph.handle(graph.nodes.get(id)!)));
    const rows: Row[] = [], seen = new Set<string>();
    for (const record of [...records].sort((a, b) => number(b.turn) - number(a.turn))) {
        if (number(record.turn) >= turn)
            continue;
        for (const warning of array(record.warnings)) {
            const clue = string(warning.clue);
            if (warning.kind !== "reveal" || !clue || seen.has(clue) || discovered.has(clue) || !here.has(clue))
                continue;
            seen.add(clue);
            rows.push({
                clue,
                turn: record.turn,
                quote: warning.quote ?? null,
                operation: "apply clue",
                line: `turn ${record.turn} already told the player this; apply clue ${clue} puts it on their sheet`
            });
        }
    }
    return rows;
}
/** present[] under its budget with every name kept: full rows are cut from the end as `fitBudget` cuts
 *  them, and each person cut comes back as `{name, truncated: true}`; if the stubs themselves do not fit,
 *  more full rows give way to stubs until they do. Returns whether anything was cut. */
function fitPresent(rows: Row[], budget: number): boolean {
    const names = rows.map(entry => string(entry.name));
    const cut = fitBudget(rows, budget);
    if (!cut)
        return false;
    const kept = new Set(rows.map(entry => string(entry.name)));
    const stubs: Row[] = names.filter(name => !kept.has(name)).map(name => ({ name, truncated: true }));
    while (rows.length && utf8Bytes(pythonJsonDumps([...rows, ...stubs])).length > budget) {
        const dropped = rows.pop()!;
        stubs.unshift({ name: string(dropped.name), truncated: true });
    }
    rows.push(...stubs);
    return true;
}
export function evidenceAnchors(graph: ModuleGraph, world: Row, records: Row[], limit = 4): string[] {
    return [...graph.kind("clue"), ...graph.kind("handout")]
        .flatMap(node => {
            const deliveries = evidenceDeliveryRecords(graph, node, records);
            return deliveries.length && evidenceAcquired(graph, world, node, records)
                ? [{ name: graph.handle(node), turn: Math.max(...deliveries.map(record => number(record.turn))) }]
                : [];
        })
        .sort((left, right) => right.turn - left.turn || left.name.localeCompare(right.name))
        .slice(0, limit)
        .map(anchor => anchor.name);
}

export async function buildCapsule(campaign: CampaignSnapshot, module: LoadedModule, options: {
    styleFull?: boolean;
    moduleBrief?: boolean;
    resume?: Row;
    situations?: Row[];
} = {}): Promise<Row> {
    const { graph, material } = module,
        { world, turn, party, meta, context } = campaign,
        scene = graph.scene(world.active_scene),
        present = npcsPresent(graph, world, scene);
    const dg = await DirectorGraph.load(context),
        craft = await TextGraph.load(context, dg.beats),
        ontology = await Ontology.load(context),
        rules = await RuleObservations.load(context);
    const language = await playLanguageOf(context, meta);
    const bad = await ontology.validate([...rules.nodes.keys()], dg, craft, async (id) => {
        try {
            return [...(await loadModule(context, id)).graph.nodes.keys()];
        }
        catch (error) {
            if (error instanceof RpcError)
                return null;
            throw error;
        }
    });
    if (bad.length)
        throw new RpcError("campaign_not_ready", `the system ontology has ${bad.length} bad reference(s); the table cannot open`, {
            fix: "repair content/ontology/system-ontology.json so every reference resolves in its graph",
            details: { ontology: bad }
        });
    const session = new SessionView(campaign, graph, party, world).activeSession(),
        situations = options.situations ?? await rules.situations(campaign, graph, world, turn),
        memory = campaign.logs.get("memory/candidates.jsonl") ?? [],
        story = campaign.logs.get("memory/story.jsonl") ?? [];
    const where = whereSection(graph, world, scene, material, true);
    where.clock = clockSection(graph, world);
    where.session = session;
    const [clocks, near] = clockPressures(situations, party, session, array(dg.threshold("pressure-clock-near-full-fraction"))),
        previous = playedRecords(campaign.records, number(turn.turn))[0],
        continuations = unansweredContinuations(previous, array(turn.receipts));
    const worldlines = await worldlineSection(campaign, graph, world, scene, present),
        across = await crossLineReader(campaign, graph, world, present);
    const presentNames = [...present.map(n => graph.displayName(n)), ...present.map(n => graph.handle(n))],
        here = [graph.handle(scene), sceneLabel(graph, world, scene)],
        memoryAnchors = [...presentNames, ...party.map(sheet => string(sheet.name)), graph.handle(scene), ...evidenceAnchors(graph, world, campaign.records)];
    const obligations = [...choiceObligation(turn.pending_choice), ...sessionObligation(session), ...continuationRows(continuations), ...questObligations(graph, world), ...promiseObligations(memory), ...noteObligations(campaign.logs.get("notes.jsonl") ?? [], presentNames, here), ...loopObligation(worldlines)];
    const sig = signals({
        graph,
        world,
        scene,
        turn,
        party,
        present,
        undiscovered: cluesHere(graph, world, scene).filter(c => !c.discovered).length,
        records: campaign.records,
        session,
        nearFull: near,
        conditions: sheet => {
            const healing = campaign.healing(string(sheet.id));
            return (Array.isArray(healing.conditions) ? healing.conditions : array(sheet.conditions)).map(string);
        },
        sanity: sheet => campaign.sanity(string(sheet.id)),
        worldline: worldlineSignals(worldlines)
    });
    const director = directorSection(dg, ontology, graph, world, scene, sig, memory, present),
        full = options.styleFull ?? true;
    const warningRecord = [...campaign.records].sort((a, b) => number(b.turn) - number(a.turn)).find(record => number(record.turn) < number(turn.turn) && record.closed_by === "narrate");
    const sections: Row = clone({
        where,
        present: presentSection(graph, world, scene, row(campaign.jsonFiles.get("npc-ledger.json")), memory, across, { voices: true }),
        voices: voicesSection(graph, world, scene),
        known: knownSection(graph, world, scene, party),
        pressures: [...clocks, ...threatPressures(graph, world, scene, present)],
        obligations,
        director,
        situations,
        worldlines,
        rulings: rulingsForCapsule(campaign.logs.get("rulings.jsonl") ?? [], session?.kind ?? null, present.map(n => graph.handle(n)), graph.handle(scene), graph.moduleId, party.map(sheet => `investigator:${string(sheet.id)}`)),
        memory: capsuleMemory(memory, new EntityIndex(graph, party, row(world.scene_labels)), memoryAnchors),
        style: craft.style(language, string(meta.register || "purist"), director.beat, full),
        recent: campaign.records.filter(record => number(record.turn) < number(turn.turn) && (truth(record.player_text) || truth(record.rendered_text))).slice(-2).map(record => ({
            turn: record.turn,
            player: record.player_text ?? null,
            keeper: chars(record.rendered_text || "", 200),
            ...(record.closed_how ? { closed: record.closed_how, receipts: array(record.receipts).length } : {})
        })),
        warnings: array(warningRecord?.warnings).map(warning => ({
            turn: warningRecord!.turn,
            kind: warning.kind ?? null,
            quote: warning.quote ?? null,
            why: warning.why ?? null,
            ...(warning.clue ? { clue: warning.clue } : {})
        })),
        unrecorded: unrecordedClues(graph, world, scene, campaign.records, number(turn.turn))
    });
    const truncated: string[] = [];
    if (fitBudget(sections.known.flags, 512, "last"))
        truncated.push("known.flags");
    for (const [name, budget] of Object.entries(BUDGETS)) {
        // A crowded room never loses a person to present[]'s budget (contract §40.7, the chat bench: nine
        // people in one teahouse and four of them gone): whoever the cut would drop arrives as their name
        // alone, and the Keeper knows to look focus=npc for the rest of them.
        const cut = name === "present" ? fitPresent(sections.present, budget) : fitBudget(sections[name], budget);
        if (cut || !Array.isArray(sections[name]) && truth(row(sections[name]).truncated)) {
            truncated.push(name);
            if (!Array.isArray(sections[name]) && sections[name] && typeof sections[name] === "object")
                sections[name].truncated = true;
        }
    }
    for (const [name, budget] of Object.entries(SLICE2_BUDGETS))
        if (fitBudget(sections[name], budget, "last"))
            truncated.push(name);
    for (const [name, budget] of Object.entries(SLICE3_BUDGETS))
        if (fitBudget(sections[name], name === "style" && full ? 2048 : budget, "last"))
            truncated.push(name);
    if (fitBudget(sections.rulings, 1024, "last"))
        truncated.push("rulings");
    if (fitBudget(sections.worldlines, 1536, "last"))
        truncated.push("worldlines");
    let head = HEAD;
    if (options.moduleBrief ?? full) {
        const [brief, cut] = fittedModuleSection(graph);
        sections.module = brief;
        if (cut)
            truncated.push("module");
        head += HEAD_MODULE;
    }
    const capsule: Row = {
        head,
        turn: {
            number: turn.turn,
            state: turn.state,
            pending_choice: turn.pending_choice ?? null,
            player_text: turn.player_text ?? null
        },
        ...sections
    };
    if (options.resume != null)
        capsule.resume = options.resume;
    if (truncated.length)
        capsule.truncated = truncated;
    const activeLine = string(meta.active_worldline || 'main');
    capsule.mods = await modContext(context, graph, world, party, campaign.records, full,
        {memory, story, worldline: activeLine, loop: number(row(row(meta.worldlines)[activeLine]).loop)});
    // The Director's offer (docs/specs/turn-floor.md D2) is drawn after the thread and pacing sections exist,
    // from material the capsule already carries, and the director section is refitted to its budget with it.
    row(capsule.director).offer = directorOffer(string(row(capsule.director).beat), {
        present: array(capsule.present),
        where: row(capsule.where),
        thread: row(capsule.mods).thread ?? null,
        pacing: row(capsule.mods).pacing ?? null,
        pressures: array(capsule.pressures),
        obligations: array(capsule.obligations),
        previous: previous ?? null
    });
    // The recovery the Director is owed (contract §40), drawn from the same material as the offer: the
    // unanswered push continuations, the people present, what this room still yields and the ways out.
    // Unlike the offer it is not advice -- the host refuses the turn's first narrate once when none of it lands.
    const blocked = number(sig.blocked_attempts) >= number(dg.threshold("recover-blocked-attempts")) ? number(sig.blocked_attempts) : 0;
    const recovery = directorRecovery(string(row(capsule.director).beat), blocked, {
        present: array(capsule.present),
        where: row(capsule.where),
        affordances: array(row(capsule.where).affordances),
        thread: row(capsule.mods).thread ?? null,
        pacing: row(capsule.mods).pacing ?? null,
        pressures: array(capsule.pressures),
        obligations: array(capsule.obligations),
        offer: array(row(capsule.director).offer),
        previous: previous ?? null
    });
    if (recovery)
        row(capsule.director).recovery = recovery;
    // Offer rows go first when the section is over budget; because and grounded_by are the Director's account of itself.
    const fitted = row(capsule.director);
    while (array(fitted.offer).length && utf8Bytes(pythonJsonDumps(fitted)).length > SLICE3_BUDGETS.director)
        (fitted.offer as Row[]).pop();
    if (fitBudget(capsule.director, SLICE3_BUDGETS.director, "last") && !array(capsule.truncated).includes("director"))
        capsule.truncated = [...array(capsule.truncated), "director"];
    return capsule;
}
