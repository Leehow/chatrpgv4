/** Assemble the existing capsule from read-only snapshots and validated content. */
import { CampaignSnapshot, loadModule, type LoadedModule } from "./campaign.js";
import { DirectorGraph, TextGraph, Ontology } from "./content.js";
import { RuleObservations } from "./rule-facts.js";
import { SessionView } from "./session-view.js";
import { whereSection, clockSection, npcsPresent, cluesHere, presentSection, knownSection, fitBudget, fittedModuleSection, sceneLabel } from "./capsule.js";
import { playedRecords, signals, directorSection } from "./director.js";
import { EntityIndex, capsuleMemory, noteObligations, rulingsForCapsule, promiseObligations } from "./memory.js";
import { clockPressures, threatPressures, unansweredContinuations, continuationRows, questObligations, choiceObligation, sessionObligation } from "./pressures.js";
import { worldlineSection, crossLineReader, loopObligation, worldlineSignals } from "./worldline.js";
import { modContext } from "./mods.js";
import { playLanguageOf } from "./languages.js";
import { RpcError } from "../errors.js";
import { array, row, number, string, truth, chars, clone, type Row } from "./values.js";
export const HEAD = "Everything at the start of this turn: the clock, the undiscovered clues here and their gates, the secrets " +
    "and agendas of those present, the way back and the exits, pressures and obligations, the rule-layer " +
    "situations, the Director's suggested beat, related memory and the style contract. Do not look/lookup " +
    "for what is already here; director is advice, not lines. Truncated place/rule previews are incomplete; " +
    "look focus=scene returns their full descriptions. where.material and each exit's material say how " +
    "far the book has been read: ready, reading, or missing. An exit's unlock_when.met is true, false, or null " +
    "when the kernel cannot tell; a gate never blocks a move. known.flags lists the flags set so far; " +
    "obligations of kind note are your own open continuity notes; rulings are your earlier rulings that " +
    "bind here, reminders, not rules. worldlines is which line the table is on and which circuit of the " +
    "loop, where the anchor is, what a rewind would leave standing and who would remember it; " +
    "loop_available true means this scene can be rewound with apply fork mode: loop, which happens after " +
    "you narrate this turn.";
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
    warnings: 1024
});
export const SLICE3_BUDGETS: Readonly<Record<string, number>> = Object.freeze({
    pressures: 1024,
    obligations: 1024,
    director: 1536,
    situations: 1024,
    style: 1024
});
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
        memory = campaign.logs.get("memory/candidates.jsonl") ?? [];
    const where = whereSection(graph, world, scene, material, true);
    where.clock = clockSection(graph, world);
    where.session = session;
    const [clocks, near] = clockPressures(situations, party, session, array(dg.threshold("pressure-clock-near-full-fraction"))),
        previous = playedRecords(campaign.records, number(turn.turn))[0],
        continuations = unansweredContinuations(previous, array(turn.receipts));
    const worldlines = await worldlineSection(campaign, graph, world, scene, present),
        across = await crossLineReader(campaign, graph, world, present);
    const presentNames = [...present.map(n => graph.displayName(n)), ...present.map(n => graph.handle(n))],
        here = [graph.handle(scene), sceneLabel(graph, world, scene)];
    const obligations = [...choiceObligation(turn.pending_choice), ...sessionObligation(session), ...continuationRows(continuations, true), ...questObligations(graph, world), ...promiseObligations(memory), ...noteObligations(campaign.logs.get("notes.jsonl") ?? [], presentNames, here), ...loopObligation(worldlines)];
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
        present: presentSection(graph, world, scene, row(campaign.jsonFiles.get("npc-ledger.json")), memory, across),
        known: knownSection(graph, world, scene, party),
        pressures: [...clocks, ...threatPressures(graph, world, scene, present), ...continuationRows(continuations)],
        obligations,
        director,
        situations,
        worldlines,
        rulings: rulingsForCapsule(campaign.logs.get("rulings.jsonl") ?? [], session?.kind ?? null, present.map(n => graph.handle(n)), graph.handle(scene), graph.moduleId),
        memory: capsuleMemory(memory, new EntityIndex(graph, party, row(world.scene_labels)), [...present.map(n => graph.displayName(n)), ...party.map(sheet => string(sheet.name))]),
        style: craft.style(language, string(meta.register || "purist"), director.beat, full),
        recent: campaign.records.filter(record => number(record.turn) < number(turn.turn) && (truth(record.player_text) || truth(record.rendered_text))).slice(-2).map(record => ({
            turn: record.turn,
            player: record.player_text ?? null,
            keeper: chars(record.rendered_text || "", 200)
        })),
        warnings: array(warningRecord?.warnings).map(warning => ({
            turn: warningRecord!.turn,
            kind: warning.kind ?? null,
            quote: warning.quote ?? null,
            why: warning.why ?? null
        }))
    });
    const truncated: string[] = [];
    if (fitBudget(sections.known.flags, 512, "last"))
        truncated.push("known.flags");
    for (const [name, budget] of Object.entries(BUDGETS)) {
        const cut = fitBudget(sections[name], budget);
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
    capsule.mods = await modContext(context, graph, world, party, campaign.records, full);
    return capsule;
}
