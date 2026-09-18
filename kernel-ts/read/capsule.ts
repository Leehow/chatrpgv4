/** Keeper and player read projections preserve the existing authored/state boundary. */
import { pythonJsonDumps, compareUnicode, isJsonObject } from "../json.js";
import { ModuleGraph, recordOf, moduleDeclaration, describeCondition, conditionStatus, dossierLabels } from "./module-graph.js";
import { entries, values, array, row, number, integer, truth, string, normalize, chars, length, words, clone, repr, type Row } from "./values.js";
import { clueGate, structureType } from "./director.js";
import { incapacitatedBy } from "../healing/conditions.js";
import { toldTurn } from "../journal/naming.js";
export const jsonSize = (value: any): number => Buffer.byteLength(pythonJsonDumps(value), "utf8");
/**
 * The one name this table uses for a place, by its handle: the campaign label the Keeper gave it,
 * and the authored name only until one exists (contract §32, the place layer; §76).
 *
 * Every producer of a player-visible place name goes through here, because `world.scene_labels` is
 * the only record of what the table calls a place and a producer that skips it answers with the
 * book's word instead. One call minted two cards for one handle -- an item left at
 * `Benefit Street office building` and a move away from it -- and they disagreed, because the move
 * asked this and the object transfer asked the module graph (campaign `game-1c0faba5`, turn 99).
 */
export const placeLabel = (world: Row, handle: string, authored: string): string => string(row(world.scene_labels)[handle] || authored);
/** A campaign label first, then what the module calls the place, and the handle's slug only when
 *  the module named it nothing else (contract §32, the place layer). */
export const sceneLabel = (graph: ModuleGraph, world: Row, scene: Row): string => placeLabel(world, graph.handle(scene), string(graph.placeName(scene)));
/**
 * What this table calls a person, by the id a receipt names them with (contract §79).
 *
 * A place has `world.scene_labels` and a clue has `world.clue_labels`; a person had nothing, so
 * every turn re-invented the name and every engine-side surface answered the book's English
 * forever. `world.person_labels[<id>]` is the one record: `{name?, address?}` under an NPC's graph
 * handle or an investigator's sheet id -- the same id `subject`, `actor` and `owner.id` carry, so
 * the label is read where the receipt is minted and never stored into an identity (§76.2).
 *
 * `name` is what this table calls them; `address` is what they are called to their face, which the
 * player establishes in play and every speaker at the table then owes. Both are recorded, never
 * inferred: nothing here reads a name to decide anything about the person who carries it.
 */
export const personRecord = (world: Row, id: string): Row => row(row(world.person_labels)[id]);
/** The table's name for a person, and the sheet's or the book's only until one exists (§79). */
export const personLabel = (world: Row, id: string, authored: string): string => string(personRecord(world, id).name || authored);
/**
 * The `called` block a Keeper-facing surface carries for a person (§79), or `null` when this table
 * has established nothing and there is nothing to say.
 *
 * `use` is here for the same reason §66's `cannot_act` is: the field alone was read and walked past.
 * A form of address the player corrected came back two turns later at one table and twenty-five at
 * another, which is what a ranked, budgeted memory hit does and what a field on the person does not.
 */
export function calledBlock(world: Row, id: string, authored: string): Row | null {
    const record = personRecord(world, id), name = string(record.name || ""), address = string(record.address || "");
    if (!name && !address)
        return null;
    return {
        ...(name ? { name } : {}),
        ...(address ? {
            address,
            use: `${repr(address)} is how this table addresses ${name || authored}, established in play and not withdrawn since. Use it in every line spoken to them; an earlier form of address does not come back.`,
        } : {}),
    };
}
/** The reminder starts before the first delivery, not after the asynchronous journal writes a label.
 * Committed deliveries and the lane's `named_at` ground disclosure; a table epithet is not disclosure. */
export function untoldBlock(graph: ModuleGraph, world: Row, journal: Row, node: Row, records: Row[] = []): Row | null {
    const entry = row(row(journal.entries)[string(node.node_id)]);
    if (integer(entry.named_at) || toldTurn(graph, node, records) !== null)
        return null;
    const label = string(personRecord(world, graph.handle(node)).name || entry.label || "").trim();
    return {
        ...(label ? { label } : {}),
        use: "Private until introduced: appearance only; apply person, then called.name and say token.",
    };
}
export function clueLabel(graph: ModuleGraph, world: Row, handle: string): string {
    const label = row(world.clue_labels)[handle];
    if (typeof label === "string" && label.trim())
        return label;
    const node = graph.find(handle, ["clue"]);
    return node ? graph.displayName(node) : handle;
}
/** The declared local opening anchors both clock readings and midnight day boundaries. */
export function clockStart(graph: ModuleGraph): { at: Date | null; minutes: number } {
    const declaration = moduleDeclaration(graph.moduleNode), stamp = row(declaration.start_clock).local_datetime;
    if (typeof stamp === "string" && stamp.trim()) {
        const local = stamp.trim().replace(/(?:Z|[+-]\d\d:\d\d)$/, ""), parsed = new Date(local + "Z");
        if (Number.isFinite(parsed.getTime()))
            return { at: parsed, minutes: parsed.getUTCHours() * 60 + parsed.getUTCMinutes() };
    }
    const text = declaration.start_time;
    if (typeof text === 'string' && text.includes(':')) {
        const parts = text.split(':'), hour = Number(parts[0]), minute = Number(parts[1]);
        if (parts.length === 2 && parts.every(part => /^[+-]?\d+(?:_\d+)*$/.test(part.trim())) && Number.isInteger(hour) && Number.isInteger(minute) && hour >= 0 && hour < 24 && minute >= 0 && minute < 60)
            return { at: null, minutes: hour * 60 + minute };
    }
    return { at: null, minutes: 0 };
}
export function clockSection(graph: ModuleGraph, world: Row): Row {
    const minutes = Math.trunc(number(row(world.clock).minutes)),
        mod = (n: number, by: number) => (n % by + by) % by,
        result: Row = {
        minutes,
        elapsed: `${Math.floor(minutes / 60)} h ${mod(minutes, 60)} min`
    };
    const start = clockStart(graph);
    let minuteOfDay = mod(start.minutes + minutes, 1440);
    if (start.at) {
        const current = new Date(start.at.getTime() + minutes * 60000);
        result.at = current.toISOString().slice(0, 16);
        minuteOfDay = current.getUTCHours() * 60 + current.getUTCMinutes();
    }
    else {
        result.day = Math.floor((start.minutes + minutes) / 1440) + 1;
        result.hh = String(Math.floor(minuteOfDay / 60)).padStart(2, "0");
        result.mm = String(mod(minuteOfDay, 60)).padStart(2, "0");
    }
    result.day_part = ([[5, "dawn"], [8, "morning"], [12, "midday"], [14, "afternoon"], [18, "evening"], [22, "night"]] as const).filter(([hour]) => minuteOfDay >= hour * 60).at(-1)?.[1] ?? "small_hours";
    return result;
}
export function whereSection(graph: ModuleGraph, world: Row, scene: Row, material: (name: string) => string = () => "ready", compact = false): Row {
    const record = recordOf(scene),
        exits = graph.sceneExits(scene).map(exit => ({
        to: exit.to,
        // The way out was named by its handle alone, so a Keeper reading the capsule saw a slug and
        // wrote the player a slug; the place the module named was one lookup away and never taken.
        ...(sceneLabel(graph, world, graph.scene(exit.to)) !== exit.to ? { display_name: sceneLabel(graph, world, graph.scene(exit.to)) } : {}),
        ...(Object.hasOwn(exit, "travel_minutes") ? { travel_minutes: exit.travel_minutes } : {}),
        ...(truth(exit.when) && row(exit.when).kind !== "always" ? { unlock_when: {
                condition: describeCondition(exit.when),
                met: conditionStatus(exit.when, world)
            } } : {}),
        material: material(graph.scene(exit.to).node_id)
    }));
    const affordances = array(record.affordances).map(aff => {
        const entry: Row = {
            id: aff.id ?? null,
            cue: aff.cue ?? null
        };
        // The cue and what taking it yields belong in one row (contract §31.3, §32.5). The authored
        // field is `grants_clue_ids`; `clue_id` is the older singular spelling, and the first
        // granted clue keeps the `clue` key the §6 shape has always had.
        const granted = [...array(aff.grants_clue_ids), ...(typeof aff.clue_id === "string" ? [aff.clue_id] : [])]
            .filter((id, index, all) => typeof id === "string" && graph.nodes.has(id) && all.indexOf(id) === index)
            .map(id => graph.nodes.get(id)!);
        if (granted.length) {
            entry.clue = graph.handle(granted[0]);
            entry.clues = granted.map(node => ({
                clue: graph.handle(node),
                gate: clueGate(graph, node),
                discovered: array(world.discovered_clues).includes(graph.handle(node))
            }));
        }
        const npc = row(aff.npc_interaction).npc_id;
        if (typeof npc === "string" && graph.nodes.has(npc))
            entry.npc = graph.displayName(graph.nodes.get(npc)!);
        return entry;
    });
    const notes = typeof record.keeper_notes === "string" ? [record.keeper_notes] : array(record.keeper_notes).map(string);
    notes.push(...array(record.allowed_improvisation).map(string));
    if (Array.isArray(record.tone) && record.tone.length)
        notes.push("tone: " + record.tone.map(string).join(", "));
    const beat = graph.sceneBeat(scene);
    if (truth(beat))
        notes.push(`pacing: ${string(beat?.tension_target)} / ${string(beat?.horror_stage)} — ${string(beat?.note)}`);
    for (const condition of array(record.exit_conditions))
        notes.push("exit condition: " + describeCondition(condition));
    const where: Row = {
        scene: graph.handle(scene),
        ...(graph.adaptationOrigin(scene.campaign_origin) ? {origin: graph.adaptationOrigin(scene.campaign_origin)} : {}),
        display_name: sceneLabel(graph, world, scene),
        summary: scene.summary || graph.prose(scene),
        dramatic_question: record.dramatic_question ?? null,
        pressure_moves: [...array(record.pressure_moves)],
        exits,
        back: [...array(world.scene_trail)].reverse().map(value => {
            const handle = string(value),
                node = graph.find(handle, ["scene"]);
            return {
                to: handle,
                ...(node ? { display_name: sceneLabel(graph, world, node) } : {})
            };
        }),
        affordances,
        keeper_notes: notes,
        assets: graph.sceneAssets(scene),
        places: graph.scenePlaces(scene),
        rules: graph.sceneRules(scene),
        endings: graph.sceneEndings(scene),
        material: material(scene.node_id)
    };
    if (compact)
        for (const [key, limit, size] of [["places", 8, 90], ["rules", 6, 160]] as const) {
            if (where[key].length > limit) {
                where.truncated = true;
                where[key] = where[key].slice(0, limit);
            }
            for (const entry of where[key])
                if (length(entry.line || "") > size) {
                    entry.line = chars(entry.line, size);
                    entry.truncated = true;
                    where.truncated = true;
                }
        }
    return where;
}
export function npcsPresent(graph: ModuleGraph, world: Row, scene: Row): Row[] {
    return entries(row(world.npc_presence)).flatMap(([handle, at]) => {
        if (at !== graph.handle(scene))
            return [];
        const node = graph.find(handle, ["npc"]);
        return node ? [node] : [];
    });
}
export function cluesHere(graph: ModuleGraph, world: Row, scene: Row): Row[] {
    return graph.sceneClueIds(scene).map(id => {
        const node = graph.nodes.get(id)!, view = graph.clueView(node);
        // "What can still be dug up here and how": the gate is the how (contract §32.5), the same
        // string the Director's reveal rows and the thread's `here` rows carry.
        return {
            ...view,
            gate: clueGate(graph, node),
            discovered: array(world.discovered_clues).includes(view.name)
        };
    });
}
/** Which words of a person are lines-shaped (contract §40.7): the module's bound vocabulary says so for a
 *  book-authored word, the table record says so for one a lane established. The shape decides the seat:
 *  `keep` is the whole dossier (look focus=npc), `drop` leaves the lines words out (the capsule's
 *  present[]), `only` is just them (the capsule's voices). */
type LinesSeat = "keep" | "drop" | "only";
function linesShaped(graph: ModuleGraph, established: Row, key: string): boolean {
    return array(graph.dossier.contributed).some(entry => string(row(entry).key) === key && row(entry).shape === "lines")
        || row(established[key]).shape === "lines";
}
function dossier(graph: ModuleGraph, world: Row, node: Row, seat: LinesSeat = "keep"): Row {
    // The Keeper-facing names and their order come from the contract's actor_dossier, not from a
    // copy kept here: a profile key the spine gains must reach the table, or it was never added
    // (contract 28.4). A key the spine labels nothing arrives under its own name.
    const profile = graph.npcProfile(node), established = tableWords(world, node), spine = new Set<string>();
    const result: Row = {};
    const seated = (key: string) => seat === "keep" || (seat === "only") === linesShaped(graph, established, key);
    for (const [key, label] of dossierLabels(graph.dossier)) {
        spine.add(key);
        const value = truth(profile[key]) ? profile[key] : row(established[key]).value;
        if (truth(value) && seated(key))
            result[label] = value;
    }
    // A word the module was never built under has no place on the build-time spine, and that is the
    // table this door exists for (contract 28.7). The record carries its own name so it still arrives.
    for (const [key, entry] of entries(established))
        if (!spine.has(key) && truth(row(entry).value) && seated(key))
            result[string(row(entry).label) || key] = row(entry).value;
    return result;
}
/** Contract §40.7: the lines-shaped words of everyone present -- a mask and its exchanges, any package's --
 *  as their own capsule section, so a full room never loses a person to present[]'s budget. A one-line
 *  list arrives as its line. */
export function voicesSection(graph: ModuleGraph, world: Row, scene: Row): Row[] {
    return npcsPresent(graph, world, scene).flatMap(node => {
        const words = dossier(graph, world, node, "only");
        if (!truth(words))
            return [];
        const entry: Row = { name: graph.displayName(node) };
        for (const [label, value] of entries(words))
            entry[label] = Array.isArray(value) && value.length === 1 ? value[0] : value;
        return [entry];
    });
}
/** Contract 28.7: what a package established at the table, under a word it contributes. The book is
 *  read first and is never overwritten; this fills only where the source is silent. It is read out of
 *  the package's own namespace and only while that package is on, so disabling one takes its words
 *  with it and leaves the book exactly as it was found. */
function tableWords(world: Row, node: Row): Row {
    const mods = row(world.mods), locks = row(mods.active), result: Row = {};
    for (const [id, namespace] of entries(row(mods.state))) {
        if (!truth(row(locks[id]).enabled))
            continue;
        for (const [key, entry] of entries(row(row(namespace).dossier)[string(node.node_id)] ?? {}))
            if (!Object.hasOwn(result, key))
                result[key] = entry;
    }
    return result;
}
function npcHistory(ledger: Row, memories: Map<string, Row>): Row | null {
    const result: Row = {},
        seen = row(ledger.turns_present),
        disclosed = array(ledger.disclosed).filter(item => truth(item.clue)).map(item => string(item.clue));
    const promises = array(ledger.promises).slice(-3).flatMap(item => {
        const memory = memories.get(string(item.memory_id));
        return memory && memory.status !== "superseded" ? [{
                statement: memory.statement ?? null,
                turn: item.turn ?? null
            }] : [];
    });
    if (truth(seen.count)) {
        result.met_turns = seen.count;
        result.last_turn = seen.last ?? null;
    }
    if (disclosed.length)
        result.disclosed = disclosed;
    const exchanged = array(ledger.exchanged).slice(-3).flatMap(item => truth(item.item) ? [`turn ${string(item.turn)}: ${item.item}`] : item.cash != null ? [`turn ${string(item.turn)}: ${string(item.direction ?? "paid")} ${string(item.cash)}${item.currency ? ` ${item.currency}` : ""}`] : []);
    if (exchanged.length)
        result.exchanged = exchanged;
    if (promises.length)
        result.promises = promises;
    const tried = array(ledger.interactions).slice(-3).map(item => `turn ${string(item.turn)}: ${[string(item.approach || item.kind || ""), ...(typeof item.level === "string" && item.level ? [item.level] : [])].filter(Boolean).join(" ")}`);
    if (tried.length)
        result.tried = tried;
    if (truth(row(ledger.spoke).turns))
        result.last_spoke_turn = row(ledger.spoke).last_turn ?? null;
    if (truth(ledger.dead))
        result.dead_since_turn = row(ledger.dead).turn ?? null;
    return truth(result) ? result : null;
}
/**
 * The state of someone in the room who is not at the table (contract §66).
 *
 * `investigatorSummary` has carried this since §42.3 and the capsule's `present[]` never had it at
 * all, so an NPC read to the Keeper as his agenda, his fears and his voice whatever had happened to
 * his body. Retained live evidence, `game-3d8ab658` turns 55-64: Augustus Larkin lay unconscious
 * from an overdose for ten turns while this section described him as "warm and friendly despite a
 * tired appearance", because there was no field here for anything else.
 *
 * Which states take the action away is the rules layer's one answer (`incapacitatedBy`), read, not
 * re-derived, and the sentence names the ways out CoC 7e actually has -- the same three §42.5 gives
 * an investigator, because they are the same three. A person who can still act has no `state` key,
 * so a reader tests for the key rather than reading a list of names.
 */
function npcState(graph: ModuleGraph, world: Row, node: Row): Row | null {
    const conditions = array(row(row(world.npc_resources)[graph.handle(node)]).conditions).map(string);
    const blocked = incapacitatedBy(conditions);
    if (!blocked.length)
        return null;
    const who = graph.displayName(node), state = blocked.join(" and ");
    return {
        conditions,
        incapacitated: blocked,
        cannot_act: blocked.includes("dead")
            ? `${who} is dead. Nothing he does happens; settle nothing for him.`
            // Same correction as `investigatorSummary`'s (contract §89): rest is an exit only while
            // no major wound is ticked, and an NPC carries that condition in the same list.
            : `${who} is ${state} and takes no action of their own -- no answer, no help, no lie. Say the state in the fiction, and say what is being done about it. CoC 7e ends ${state === "unconscious" ? "it" : "unconsciousness"} when a hit point comes back: someone present succeeding at First Aid or Medicine on them -- resolve with the rescuer as actor and ${who} as target${conditions.includes("major_wound") ? ". Rest returns no hit point while the major wound is ticked; the weekly recovery roll is the next one the rules run themselves" : " -- or rest, apply time, until natural healing returns one"}. First Aid stabilizes a dying one first.`,
    };
}
export function npcEntry(graph: ModuleGraph, world: Row, node: Row, ledger: Row, memories: Map<string, Row>, across: (node: Row) => Row[] = () => [], seat: LinesSeat = "keep", journal: Row = {}, records: Row[] = []): Row {
    const state = npcState(graph, world, node), untold = untoldBlock(graph, world, journal, node, records);
    const entry: Row = {
        name: graph.displayName(node),
        // What this table calls them (§79), before the dossier for the same reason `state` is: the
        // Keeper writes a name into every line about this person, and the record that decides it has
        // to be in front of them on the turn they write it, not ranked into a memory section that
        // ages out. `name` above stays the identity the Keeper hands back to `apply`.
        ...(calledBlock(world, graph.handle(node), graph.displayName(node)) ? {called: calledBlock(world, graph.handle(node), graph.displayName(node))} : {}),
        // And whether the player has been told it at all (§103), in the same seat for the same reason.
        ...(untold ? {untold} : {}),
        ...(graph.adaptationOrigin(node.campaign_origin) ? {origin: graph.adaptationOrigin(node.campaign_origin)} : {}),
        // Before the dossier, not after it: what his body is doing decides whether any of the rest
        // of it can happen this turn, and present[] is budgeted from the top.
        ...(state ? {state} : {}),
        ...dossier(graph, world, node, seat)
    },
        discovered = new Set(array(world.discovered_clues));
    const knows = graph.npcKnows(node).map(item => ({
        clue: item.handle,
        ...(item.origin ? {origin: item.origin} : {}),
        discovered: discovered.has(item.handle)
    })).sort((a, b) => Number(a.discovered) - Number(b.discovered));
    if (knows.length)
        entry.knows = knows.slice(0, 6);
    const knowledge = graph.authoredLines(node, "knowledge");
    if (knowledge.length)
        entry.knowledge = knowledge.slice(0, 3);
    if (truth(recordOf(node).keeper_note))
        entry.keeper_note = recordOf(node).keeper_note;
    const beliefs = graph.npcBeliefs(node);
    if (beliefs.length)
        entry.believes = beliefs.slice(0, 3);
    const lies = graph.npcWouldSay(node);
    if (lies.length)
        entry.would_lie_about = lies.slice(0, 3);
    const presence = row(world.npc_presence),
        here = new Set(Object.keys(presence).filter(handle => presence[handle] === presence[graph.handle(node)]));
    const rank = (tie: Row) => here.has(graph.handle(tie.node)) ? 0 : ["faction", "organization"].includes(tie.node.node_kind) ? 1 : 2;
    const ties = graph.npcTies(node).sort((a, b) => rank(a) - rank(b)).slice(0, 6).map(tie => ({
        kind: tie.kind,
        to: tie.to
    }));
    if (ties.length)
        entry.ties = ties;
    const saved = row(ledger[node.node_id]),
        stance = row(saved.stance);
    if (truth(stance.value))
        entry.toward_party = {
            stance: stance.value,
            because: array(stance.because).slice(-3).map(cause => cause.how === "keeper" ? `turn ${string(cause.turn)}: keeper set ${string(cause.stance)}${cause.why ? `: ${cause.why}` : ""}` : cause.how === "combat" ? `turn ${string(cause.turn)}: fought` : `turn ${string(cause.turn)}: ${string(cause.approach)} ${string(cause.level)}`)
        };
    const history = npcHistory(saved, memories);
    if (history)
        entry.history = history;
    const elsewhere = across(node);
    if (elsewhere.length)
        entry.from_other_lines = elsewhere;
    return entry;
}
/** `options.voices` true is the capsule's form (contract §40.7): the lines-shaped words leave the rows for `voices`. */
export function presentSection(graph: ModuleGraph, world: Row, scene: Row, ledger: Row = {}, memory: Row[] = [], across: (node: Row) => Row[] = () => [], options: { voices?: boolean; journal?: Row; records?: Row[] } = {}): Row[] {
    const memories = new Map(memory.filter(m => truth(m.id)).map(m => [string(m.id), m]));
    const rank = (entry: Row) => truth(row(entry.history).promises) ? 0 : truth(row(entry.history).met_turns) || truth(entry.toward_party) ? 1 : truth(entry.wants) ? 2 : 3;
    return npcsPresent(graph, world, scene).map(node => npcEntry(graph, world, node, ledger, memories, across, options.voices ? "drop" : "keep", row(options.journal), options.records)).sort((a, b) => rank(a) - rank(b));
}
export function npcView(graph: ModuleGraph, world: Row, node: Row, ledger: Row = {}, journal: Row = {}, records: Row[] = []): Row {
    const untold = untoldBlock(graph, world, journal, node, records), handle = graph.handle(node),
        view: Row = {
        kind: "npc",
        ...(graph.adaptationOrigin(node.campaign_origin) ? {origin: graph.adaptationOrigin(node.campaign_origin)} : {}),
        name: graph.displayName(node),
        ...(calledBlock(world, handle, graph.displayName(node)) ? {called: calledBlock(world, handle, graph.displayName(node))} : {}),
        ...(untold ? {untold} : {}),
        id: handle,
        node_id: node.node_id,
        scene: row(world.npc_presence)[handle] ?? null,
        summary: node.summary ?? null,
        visibility: node.visibility ?? null,
        ...(npcState(graph, world, node) ? {state: npcState(graph, world, node)} : {}),
        ...dossier(graph, world, node)
    };
    const knows = graph.npcKnows(node).map(entry => ({
        clue: entry.handle,
        ...(entry.origin ? {origin: entry.origin} : {}),
        summary: entry.node.summary || entry.node.name || null,
        discovered: array(world.discovered_clues).includes(entry.handle)
    }));
    if (knows.length)
        view.knows = knows;
    for (const [field, values] of [["knowledge", graph.authoredLines(node, "knowledge")], ["believes", graph.npcBeliefs(node)], ["hides_claims", graph.npcClaimLines(node, "hides")], ["would_lie_about", graph.npcWouldSay(node)]] as const)
        if (values.length)
            view[field] = values;
    const ties = graph.npcTies(node);
    if (ties.length)
        view.ties = ties.map(tie => ({
            kind: tie.kind,
            to: tie.to,
            kind_of: tie.node.node_kind
        }));
    view.ledger = ledger[node.node_id] ?? null;
    const record = recordOf(node);
    if (truth(record))
        Object.assign(view, {
            keeper_note: record.keeper_note ?? null,
            social_role: record.social_role ?? null,
            deflect_options: record.deflect_options || [],
            lie_options: record.lie_options || [],
            availability: record.availability ?? null,
            mechanics: record.mechanics ?? null
        });
    const authored = graph.entityView(node).properties;
    if (truth(authored))
        view.properties = authored;
    return view;
}
export function investigatorView(sheet: Row): Row {
    return {
        kind: "investigator",
        ...Object.fromEntries(entries(sheet).filter(([key]) => !["notes", "schema_version", "current_hp", "current_san", "current_mp", "current_luck"].includes(key))),
        hp: sheet.current_hp ?? null,
        san: sheet.current_san ?? null,
        mp: sheet.current_mp ?? null,
        luck: sheet.current_luck ?? null
    };
}
export function investigatorSummary(sheet: Row): Row {
    // The conditions standing on the sheet, and -- when one of them takes the action away -- the
    // sentence that says so. Turn 107 of `game-83177d61` settled `unconscious` correctly and this
    // section showed `hp: 0` and nothing else, so for three turns the Keeper wrote around an
    // investigator who was out of play without ever being told he was: the player declared holding
    // on to consciousness and driving a dagger home, and got a halted tableau each time. §31's three
    // ends: `applyWoundConditions` writes it, this projects it, the Keeper acts on it.
    // The money, for the same reason (contract §58). Turn 31 of the M-DETOUR table was played for a
    // balance -- nine dollars, and a steamer ticket home at the end of it -- and this section named
    // no money at all, so the only figure in the room was the one the player had just said out loud.
    // The Keeper charged it as the price of a meal and the purse went to zero. A balance the Keeper
    // is never told is a balance it can mistake for a price. `stageCash` writes it, this projects it.
    const conditions = array(sheet.conditions).map(string), blocked = incapacitatedBy(conditions);
    const finance = row(sheet.finance), purse = row(finance.cash), spending = row(finance.spending_level);
    // A card built outside the rulebook's bounds says so here (contract §98): the player asked for
    // the strength, and the Keeper is told once, as a fact about this table, not as a fault.
    const budget = row(row(sheet.creation).budget);
    const nonStandard = budget.legal === false ? { non_standard_card: array(budget.notes).map((note: any) => typeof note === 'string' ? note : string(row(note).text)).filter(Boolean) } : {};
    return {
        ...nonStandard,
        id: sheet.id ?? null,
        name: sheet.name ?? null,
        occupation: sheet.occupation ?? null,
        occupation_stated: sheet.occupation_stated ?? null,
        sex: sheet.sex ?? null,
        hp: sheet.current_hp ?? null,
        san: sheet.current_san ?? null,
        mp: sheet.current_mp ?? null,
        luck: sheet.current_luck ?? null,
        conditions,
        ...(purse.amount != null ? { cash: { amount: purse.amount, currency: purse.currency ?? null } } : {}),
        ...(finance.living_standard != null || spending.amount != null ? { living: { standard: finance.living_standard ?? null, spending_level: spending.amount ?? null, currency: spending.currency ?? purse.currency ?? null } } : {}),
        // The last clause used to promise "the one a day of rest returns" to everybody, and for the
        // one character who most needs an exit it is false: `weeklyRecovery` heals nothing while a
        // major wound is ticked and `healingTimeTrigger` does not even call it, so `apply time`
        // returns no hit point and rouses nobody until the weekly roll comes due. t9's Keeper read
        // this sentence, applied six hours, got nothing, and stopped moving the clock (contract §89).
        ...(blocked.length ? { cannot_act: `${string(sheet.name || sheet.id)} is ${blocked.join(' and ')} and takes no action of their own. The kernel refuses one declared for them. Say the state in the fiction -- what the player's character feels, or does not -- and what is being done about it: First Aid or Medicine rouses them, and so does any hit point regained${conditions.includes('major_wound') ? ' -- but not rest, which returns none while the major wound is ticked; pressures[] names the minutes to the weekly recovery roll and the call that reaches it' : ', including the one a day of rest returns'}.` } : {}),
        skills_of_note: entries(row(sheet.skills)).map(([name, value]) => ({
            name,
            value: Math.trunc(number(value))
        })).sort((a, b) => b.value - a.value || compareUnicode(a.name, b.name)).slice(0, 8)
    };
}
/**
 * What this table has actually charged (contract §58). The prices a campaign settles are facts it
 * produced itself, and until now they existed only in the receipt stream with nothing reading them
 * back: the M-DETOUR table had priced a hotel night at 1.0, a full set of darkroom chemicals at 1.0
 * and the cheapest glass in the Cordano bar at 0.2, and then charged 6.3 for a plain meal in that
 * same bar on the same day -- thirty-one times its own cheapest drink -- because no turn could see
 * what the turns before it had done. `npc-ledger.json` keeps the with-an-NPC half of this, but only
 * for the people standing in the room; a price is a fact about the world, not about who is present.
 */
export function pricesPaid(records: Row[], limit = 8): Row[] {
    const paid: Row[] = [];
    for (const record of [...records].sort((a, b) => number(b.turn) - number(a.turn)))
        for (const receipt of array(record.receipts)) {
            if (!isJsonObject(receipt) || receipt.kind !== "cash" || paid.length >= limit) continue;
            const delta = number(receipt.delta ?? 0);
            if (!(delta < 0)) continue;
            paid.push({
                turn: record.turn ?? null,
                amount: -delta,
                currency: receipt.currency ?? null,
                ...(receipt.source != null ? { source: receipt.source } : {}),
                ...(receipt.price_id != null ? { price_id: receipt.price_id } : {}),
                ...(receipt.with_label != null ? { with: receipt.with_label } : {}),
                why: receipt.why ?? null
            });
        }
    return paid;
}
export function knownSection(graph: ModuleGraph, world: Row, scene: Row, party: Row[], records: Row[] = []): Row {
    const section: Row = {
        discovered_clues: [...array(world.discovered_clues)],
        clues_here: cluesHere(graph, world, scene),
        flags: entries(row(world.flags)).reverse().map(([name, value]) => ({
            name,
            value
        }))
    };
    if (truth(world.discovered_echoes))
        section.discovered_echoes = [...array(world.discovered_echoes)];
    if (party.length) {
        const sheet = party[0],
            book = moduleDeclaration(graph.moduleNode).era;
        section.investigator = investigatorSummary(sheet);
        // The form of address the player established for their own investigator (§79). This is the
        // half the memory lane could never hold: a new NPC who has never been corrected reads it
        // here on the turn they first open their mouth, and a correction twenty-five turns old is
        // still exactly as present as the turn it was made.
        const called = calledBlock(world, string(sheet.id), string(sheet.name || sheet.id));
        if (called)
            section.investigator.called = called;
        if (typeof row(sheet.origin).library_id === "string" && row(sheet.origin).library_id && typeof sheet.era === "string" && sheet.era && typeof book === "string" && book && sheet.era !== book)
            section.investigator.era_note = `This sheet was built for the ${sheet.era} era and the module is set in ${book}; its characteristics, skills and money are unchanged. Reconcile the difference in the fiction, not in the numbers.`;
    }
    const paid = pricesPaid(records);
    if (paid.length)
        section.prices_paid = paid;
    return section;
}
function lists(value: any): any[][] {
    if (Array.isArray(value))
        return [value, ...value.flatMap(lists)];
    if (value && typeof value === "object")
        return values(value).flatMap(lists);
    return [];
}
export function fitBudget(section: any, budget: number, drop: "oldest" | "last" = "oldest"): boolean {
    let cut = false;
    while (jsonSize(section) > budget) {
        const candidates = lists(section).filter(values => values.length);
        if (!candidates.length)
            break;
        const leaves = candidates.filter(values => !values.some(item => lists(item).some(nested => nested.length))),
            pool = leaves.length ? leaves : candidates;
        let victim = pool[0];
        for (const values of pool.slice(1))
            if (jsonSize(values) > jsonSize(victim))
                victim = values;
        if (victim === section && victim.length === 1)
            break;
        if (victim === section && drop === "oldest" && victim.every(item => item && typeof item === "object" && Object.hasOwn(item, "turn")))
            victim.shift();
        else
            victim.pop();
        cut = true;
    }
    if (jsonSize(section) > budget && Array.isArray(section))
        for (const item of section)
            for (const [key, value] of entries(row(item)))
                if (typeof value === "string" && length(value) > 200) {
                    item[key] = chars(value, 200);
                    cut = true;
                }
    return cut;
}
function oneLine(graph: ModuleGraph, node: Row, size: number): string {
    if (size <= 0)
        return "";
    const candidates: string[] = [],
        record = recordOf(node),
        name = graph.displayName(node);
    if (typeof node.summary === "string" && normalize(node.summary) !== normalize(name))
        candidates.push(node.summary);
    const person = [record.relationship_to_investigators, record.agenda].filter(v => typeof v === "string" && v.trim());
    if (person.length)
        candidates.push(person.join("; "));
    candidates.push(graph.prose(node));
    return chars(candidates.map(words).find(Boolean) || "", size);
}
export function moduleSection(graph: ModuleGraph, size = 120): Row {
    const module = graph.moduleNode || {},
        record = recordOf(module),
        roster = (kinds: string[]) => kinds.flatMap(kind => graph.kind(kind).map(node => ({
        name: graph.displayName(node),
        line: oneLine(graph, node, size)
    })));
    return {
        title: graph.title(),
        ...(typeof record.era === "string" && record.era.trim() ? { era: record.era } : {}),
        synopsis: words(module.summary || ""),
        factions: roster(["faction", "organization"]),
        places: roster(["location"]),
        people: roster(["npc"]),
        endings: graph.kind("ending").map(n => graph.displayName(n)),
        conclusions: graph.kind("conclusion").map(n => graph.displayName(n)),
        structure_type: structureType(graph)
    };
}
export function fittedModuleSection(graph: ModuleGraph, budget = 2048): [
    Row,
    boolean
] {
    let section = moduleSection(graph),
        cut = false;
    for (const size of [80, 40, 20, 0]) {
        if (jsonSize(section) <= budget)
            break;
        section = moduleSection(graph, size);
        cut = true;
    }
    return [section, fitBudget(section, budget, "last") || cut];
}
