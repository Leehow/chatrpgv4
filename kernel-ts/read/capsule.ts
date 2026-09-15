/** Keeper and player read projections preserve the existing authored/state boundary. */
import { pythonJsonDumps, compareUnicode } from "../json.js";
import { ModuleGraph, recordOf, moduleDeclaration, describeCondition, conditionStatus, dossierLabels } from "./module-graph.js";
import { entries, values, array, row, number, truth, string, normalize, chars, length, words, clone, type Row } from "./values.js";
import { clueGate, structureType } from "./director.js";
export const jsonSize = (value: any): number => Buffer.byteLength(pythonJsonDumps(value), "utf8");
/** A campaign label first, then what the module calls the place, and the handle's slug only when
 *  the module named it nothing else (contract §32, the place layer). */
export const sceneLabel = (graph: ModuleGraph, world: Row, scene: Row): string => string(row(world.scene_labels)[graph.handle(scene)] || graph.placeName(scene));
export function clueLabel(graph: ModuleGraph, world: Row, handle: string): string {
    const label = row(world.clue_labels)[handle];
    if (typeof label === "string" && label.trim())
        return label;
    const node = graph.find(handle, ["clue"]);
    return node ? graph.displayName(node) : handle;
}
export function clockSection(graph: ModuleGraph, world: Row): Row {
    const minutes = Math.trunc(number(row(world.clock).minutes)),
        mod = (n: number, by: number) => (n % by + by) % by,
        result: Row = {
        minutes,
        elapsed: `${Math.floor(minutes / 60)} h ${mod(minutes, 60)} min`
    };
    const declaration = moduleDeclaration(graph.moduleNode),
        stamp = row(declaration.start_clock).local_datetime;
    let minuteOfDay: number | null = null;
    if (typeof stamp === "string" && stamp.trim()) {
        const local = stamp.trim().replace(/(?:Z|[+-]\d\d:\d\d)$/, ""),
            parsed = new Date(local + "Z");
        if (Number.isFinite(parsed.getTime())) {
            const current = new Date(parsed.getTime() + minutes * 60000);
            result.at = current.toISOString().slice(0, 16);
            minuteOfDay = current.getUTCHours() * 60 + current.getUTCMinutes();
        }
    }
    if (minuteOfDay == null && typeof declaration.start_time === "string" && declaration.start_time.includes(":")) {
        const values = declaration.start_time.split(":"),
            hour = Number(values[0]),
            minute = Number(values[1]);
        if (values.length === 2 && Number.isInteger(hour) && Number.isInteger(minute) && hour >= 0 && hour < 24 && minute >= 0 && minute < 60)
            minuteOfDay = mod(hour * 60 + minute + minutes, 1440);
    }
    if (minuteOfDay != null)
        result.day_part = ([[5, "dawn"], [8, "morning"], [12, "midday"], [14, "afternoon"], [18, "evening"], [22, "night"]] as const).filter(([hour]) => minuteOfDay! >= hour * 60).at(-1)?.[1] ?? "small_hours";
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
function dossier(graph: ModuleGraph, world: Row, node: Row): Row {
    // The Keeper-facing names and their order come from the contract's actor_dossier, not from a
    // copy kept here: a profile key the spine gains must reach the table, or it was never added
    // (contract 28.4). A key the spine labels nothing arrives under its own name.
    const profile = graph.npcProfile(node), established = tableWords(world, node), spine = new Set<string>();
    const result: Row = {};
    for (const [key, label] of dossierLabels(graph.dossier)) {
        spine.add(key);
        const value = truth(profile[key]) ? profile[key] : row(established[key]).value;
        if (truth(value))
            result[label] = value;
    }
    // A word the module was never built under has no place on the build-time spine, and that is the
    // table this door exists for (contract 28.7). The record carries its own name so it still arrives.
    for (const [key, entry] of entries(established))
        if (!spine.has(key) && truth(row(entry).value))
            result[string(row(entry).label) || key] = row(entry).value;
    return result;
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
    if (truth(ledger.dead))
        result.dead_since_turn = row(ledger.dead).turn ?? null;
    return truth(result) ? result : null;
}
export function npcEntry(graph: ModuleGraph, world: Row, node: Row, ledger: Row, memories: Map<string, Row>, across: (node: Row) => Row[] = () => []): Row {
    const entry: Row = {
        name: graph.displayName(node),
        ...(graph.adaptationOrigin(node.campaign_origin) ? {origin: graph.adaptationOrigin(node.campaign_origin)} : {}),
        ...dossier(graph, world, node)
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
export function presentSection(graph: ModuleGraph, world: Row, scene: Row, ledger: Row = {}, memory: Row[] = [], across: (node: Row) => Row[] = () => []): Row[] {
    const memories = new Map(memory.filter(m => truth(m.id)).map(m => [string(m.id), m]));
    const rank = (entry: Row) => truth(row(entry.history).promises) ? 0 : truth(row(entry.history).met_turns) || truth(entry.toward_party) ? 1 : truth(entry.wants) ? 2 : 3;
    return npcsPresent(graph, world, scene).map(node => npcEntry(graph, world, node, ledger, memories, across)).sort((a, b) => rank(a) - rank(b));
}
export function npcView(graph: ModuleGraph, world: Row, node: Row, ledger: Row = {}): Row {
    const handle = graph.handle(node),
        view: Row = {
        kind: "npc",
        ...(graph.adaptationOrigin(node.campaign_origin) ? {origin: graph.adaptationOrigin(node.campaign_origin)} : {}),
        name: graph.displayName(node),
        id: handle,
        node_id: node.node_id,
        scene: row(world.npc_presence)[handle] ?? null,
        summary: node.summary ?? null,
        visibility: node.visibility ?? null,
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
    return {
        id: sheet.id ?? null,
        name: sheet.name ?? null,
        occupation: sheet.occupation ?? null,
        occupation_stated: sheet.occupation_stated ?? null,
        sex: sheet.sex ?? null,
        hp: sheet.current_hp ?? null,
        san: sheet.current_san ?? null,
        mp: sheet.current_mp ?? null,
        luck: sheet.current_luck ?? null,
        skills_of_note: entries(row(sheet.skills)).map(([name, value]) => ({
            name,
            value: Math.trunc(number(value))
        })).sort((a, b) => b.value - a.value || compareUnicode(a.name, b.name)).slice(0, 8)
    };
}
export function knownSection(graph: ModuleGraph, world: Row, scene: Row, party: Row[]): Row {
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
        if (typeof row(sheet.origin).library_id === "string" && row(sheet.origin).library_id && typeof sheet.era === "string" && sheet.era && typeof book === "string" && book && sheet.era !== book)
            section.investigator.era_note = `This sheet was built for the ${sheet.era} era and the module is set in ${book}; its characteristics, skills and money are unchanged. Reconcile the difference in the fiction, not in the numbers.`;
    }
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
