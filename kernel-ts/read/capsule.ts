/** Keeper and player read projections preserve the existing authored/state boundary. */
import { pythonJsonDumps, compareUnicode, isJsonObject } from "../json.js";
import { RpcError } from "../errors.js";
import { ModuleGraph, recordOf, moduleDeclaration, describeCondition, conditionStatus, dossierLabels, isAmbiguity } from "./module-graph.js";
import { entries, values, array, row, number, integer, truth, string, normalize, chars, length, words, clone, repr, type Row } from "./values.js";
import { clueGate, structureType } from "./director.js";
import { incapacitatedBy } from "../healing/conditions.js";
import { namePieces } from "../journal/naming.js";
import { prepareNameHistory } from '../journal/name-history.js';
import { isTold, tableWord } from "./person-words.js";
import { bookCast, isPublicFigure, knownNamePieces, tellGuard, untoldUnread, type CastPerson } from "./cast.js";
import { nameToken } from "../write/names.js";
import {memoryEvidenceView,withPromiseFulfillment,canonicalMemoryReceipts,memoryOccurrenceKey} from './memory.js';
import {personalityView} from '../npc/material.js';
import { intentsView, shownIntentRef } from '../npc/intents.js';
import { moodNow } from '../npc/mood.js';
import {npcRelationships,npcRecentSpeech,npcCommitments} from '../npc/perspective.js';
import {reunionView} from '../npc/reunion.js';
import {cardAction,cardTactic} from '../combat/standing.js';
import {mechRow} from './mech-line.js';
import { MASK_KEY } from '../voice/fields.js';
import { weaknessChain, type ChainReads } from "./weaknesses.js";
import { containers, placesWithin, personNamedLocations } from "./places.js";
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
/**
 * Whose name at this table `name` is (§79.2): every id whose record carries this word as `name`,
 * by the normalization every other name lookup uses. The table's word for a person is one of that
 * person's names wherever a person is named, as `world.scene_labels` is for a place. It is a record
 * the table wrote with `apply person`, so reading it back judges nothing about anyone; two ids
 * sharing one word come back as two, and the caller refuses rather than picks.
 */
export function calledOwners(world: Row, name: string): string[] {
    const key = normalize(name);
    if (!key) return [];
    const labels = row(world.person_labels);
    const named = entries(labels).filter(([, record]) => normalize(string(row(record).name)) === key).map(([id]) => id);
    // §176.2: a person answers to their epithet too, even after the fiction gave them another word. Table 22 (turn 1): a
    // batch renamed three people and then named them by the epithets they were shown; the epithets had stopped answering,
    // and the turn went round four refusals.
    const word = (value: unknown): string => typeof value === "string" ? value.trim() : "";
    const epithets = entries(row(world.person_epithets)).filter(([, record]) => normalize(word(row(record).word)) === key).map(([id]) => id);
    return [...new Set([...named, ...epithets])];
}
/**
 * The one person this table calls `name`, as the graph's npc node, or `null` when nobody carries the
 * word (contract §87.8). This is the table's layer of the junction every entrance that takes a
 * Keeper's word for a person goes through. Two owners are `unknown_entity` naming both: which of them
 * the Keeper meant is not something a record can answer, so it is refused, never picked.
 */
export function calledPerson(graph: ModuleGraph, world: Row, name: string): Row | null {
    // §192.3: two ids that read as one person (a copy's handle and the handle of the node that stands for it) are one owner.
    const owners = [...new Map(calledOwners(world, name).flatMap(id => { const node = graph.find(id, ['npc']); return node ? [[string(node.node_id), node] as [string, Row]] : []; })).values()];
    if (owners.length > 1)
        throw new RpcError('unknown_entity', `this table calls more than one person ${repr(name)}`, {
            fix: 'name one of details.candidates by its name; apply person gives one of them another word',
            details: { query: name, candidates: owners.map(owner => graph.describe(owner)) },
        });
    return owners[0] ?? null;
}
/**
 * The person a word names, for a seat a creature can fill too (contract §87.8): the graph's actor --
 * an npc by handle, alias or §2's anchored run, then a creature that states a stat block (§136.12) --
 * and then this table's own word. The first layer with exactly one answer is the person.
 */
export function personNode(graph: ModuleGraph, world: Row, name: string): Row | null {
    return graph.actor(name) ?? calledPerson(graph, world, name);
}
/**
 * The same junction for an entrance that has only ever named people and answers a miss with the
 * graph's refusal (contract §87.8): the graph's npc, then this table's word, then that refusal
 * unchanged, because its candidates are still the Keeper's next step.
 */
export function npcNode(graph: ModuleGraph, world: Row, name: string): Row {
    try {
        return graph.npc(name);
    }
    catch (error) {
        if (!(error instanceof RpcError))
            throw error;
        const called = calledPerson(graph, world, name);
        if (called)
            return called;
        throw error;
    }
}
/**
 * Contract §188.4 (from §185.2's cash counterparty): the same junction for a field that may also be free text -- a cash
 * counterparty, an owed row's `with`, the giver of an item. The graph's npc, then this table's word; `null` on a plain
 * miss, which the entrance keeps as written. The graph's ambiguity and a word two people carry are refused, never picked.
 */
export function referencedPerson(graph: ModuleGraph, world: Row, name: string): Row | null {
    try {
        return graph.npc(name);
    }
    catch (error) {
        if (!(error instanceof RpcError))
            throw error;
        const called = calledPerson(graph, world, name);
        if (called)
            return called;
        if (error.code !== 'unknown_entity' || isAmbiguity(error))
            throw error;
        return null;
    }
}
/**
 * Contract §188.4: whether a stored reference and another name one person -- the same string, or one npc node when both are
 * read through `referencedPerson` (a handle, an interim handle, the book's name, this table's word, §185.3's retry). A value
 * that names nobody, or two people, matches only its own spelling. For a reader that compares stored state and has no
 * graph of its own (`memory/fulfillment-view.ts`).
 */
export function samePersonReference(graph: ModuleGraph, world: Row): (stored: unknown, other: string) => boolean {
    const node = (value: unknown): Row | null => {
        if (typeof value !== 'string' || !value.trim())
            return null;
        try {
            return referencedPerson(graph, world, value.trim());
        }
        catch (error) {
            if (error instanceof RpcError)
                return null;
            throw error;
        }
    };
    return (stored, other) => {
        if (stored === other)
            return true;
        const a = node(stored), b = a ? node(other) : null;
        return !!a && !!b && a.node_id === b.node_id;
    };
}
/**
 * Contract §180.5: the junction of an entrance a creature fills too -- the NPC act's reads (`npc.situation`,
 * `npc.act.options`, `npc.stakes`). A person first, exactly as `npcNode` reads one; on a miss, a creature that states a
 * stat block (an actor, §136.12); else the person refusal unchanged, whose candidates are still the next step.
 */
export function actorNode(graph: ModuleGraph, world: Row, name: string): Row {
    try {
        return npcNode(graph, world, name);
    }
    catch (error) {
        if (!(error instanceof RpcError) || error.code !== "unknown_entity")
            throw error;
        const creature = graph.find(name, ["creature"]);
        if (creature && graph.isActor(creature))
            return creature;
        throw error;
    }
}
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
export function untoldBlock(graph: ModuleGraph, world: Row, journal: Row, node: Row, records: Iterable<Row> = []): Row | null {
    // §180.3: a creature has no name to learn, so it is never untold and never carries `say_name`. §194.5: nor has a real public
    // figure the book only mentions as such.
    if (!graph.isPerson(node) || isPublicFigure(graph, node))
        return null;
    const entry = row(row(journal.entries)[string(node.node_id)]);
    // §188.2: told as the individual the cast holds them as, though the graph has them more than once. §188.1: an occurrence
    // inside an investigator's registered name or another person's word at this table tells nobody.
    if (isTold(graph, journal, node, prepareNameHistory(records, tellGuard(graph, world, journal))))
        return null;
    // §176.1/§176.4: the table's word (what the fiction established, else the epithet), else the journal's label.
    const label = (tableWord(world, graph.handle(node)) || string(entry.label || "")).trim();
    return {
        ...(label ? { label } : {}),
        // Contract §103.5 (2026-10-03): the handle, so the Keeper-facing view can name this person by it instead of by the
        // book's name until the name is said (extensions/kernel/untold-view.ts).
        id: graph.handle(node),
        // §176.8: the token that has their name said, on every projection of this block. Replay of game-24bb66cb
        // (2026-10-04, turn 5): the budget had cut the veteran to a stub, the view's token never reached him, and three
        // of four Keepers asked his name made one up.
        say_name: nameToken(label || graph.handle(node)),
        // §115 asked this line to say `apply person` gives an epithet; compressed to "apply person, then called.name", the
        // Keeper of the installed App's Blood Road table (2026-10-02, turn 5) applied the book's names and wrote them; told
        // "never this name", the next table's Keeper applied the station owner's nickname instead, the short name the book gives him.
        // §115: every untold row of a crowded room carries this line and the handle, so together they stay near the first
        // line's length (the nine-person bench keeps four full dossiers only while they do). The Keeper's own copy replaces
        // this line with the fuller one in extensions/kernel/untold-view.ts (§103.5).
        // §176: the label is this table's word for them from before the meeting (the epithet lane's), so there is nothing to apply.
        use: "Untold: by look; label is the table's word for them; say token and who use it.",
    };
}
/**
 * Contract §103.5 (2026-10-03): every person of the book the investigator has not been told the name of, as the host's
 * rename of the Keeper's request needs them (`table.untold`): the book's name, the handle, and what the Keeper's copy
 * shows instead -- this table's word for them, else the handle. Campaign-wide, not the scene's: a run that moves after
 * its capsule was read meets the next scene's people in host messages and tool results the capsule never covered.
 * A person the table itself established is left out; the name the table gave them is the only one there is.
 * §103.8: one row for each name the book gives them, aliases too. Table 20 (2026-10-03): the trucker's biography said he
 * fakes helping the owner with the cars, calling him by an alias the graph records, and only the display name was renamed.
 */
export function untoldRoster(graph: ModuleGraph, world: Row, journal: Row, records: Iterable<Row>): Row[] {
    return untoldRosterNames(graph, world, journal, records)
        .map(entry => ({ name: entry.name, id: entry.ids[0], shown: joinedWord(entry.shown), ...(entry.handle ? { handle: true } : {}) }));
}
/**
 * §188.8: the word a name several untold people share is shown by in the Keeper's request (§177.4): each owner's word, joined.
 * Built here alone; the delivery gate finds it in a text by this exact string (`write/shared-untold.ts`), never by its form.
 */
export const joinedWord = (words: readonly string[]): string => words.join(" / ");
/** §188.8: `untoldRoster`'s rows as the one builder gives them, each owner's word apart, for the gate's shared names. */
export function untoldRosterNames(graph: ModuleGraph, world: Row, journal: Row, records: Iterable<Row>): RosterName[] {
    const history = prepareNameHistory(records, tellGuard(graph, world, journal));
    // §177.4: the whole cast -- the graph's people with every name the cast gives them, and the people the book names whom
    // the reader has not reached, untold until a delivery shows one of their names. Table 23's turn 9 had 54 people in the
    // graph; a page carried for a scene could name someone else, and that name reached the Keeper as printed.
    const unread = new Set(untoldUnread(graph, history).map(person => person.id));
    const people = bookCast(graph).map(person => ({ person, untold: person.node ? untoldBlock(graph, world, journal, person.node, history) : unread.has(person.id) ? {} : null }));
    // A name someone the investigator already knows also goes by stays theirs: hiding it would hide them. The investigators
    // themselves are known (§185.13): table 30's investigator shared a first name with the untold store owner.
    const known = knownNamePieces(graph, people.filter(entry => !entry.untold).map(entry => entry.person));
    const untold = people.flatMap(({ person, untold }) => untold ? [{ person, shown: rosterWord(graph, world, journal, person) }] : []);
    return rosterNames(graph, untold, known);
}
/**
 * §103.5/§176.1/§177.4: the word the request's rename shows a person of the cast by -- this table's word for them, else, for a
 * graph person, the journal's label, else their handle (a graph person) or the cast row's id (an unread one), which is opaque.
 * `untoldRoster` shows the untold by it; §188.3's undo (`read/rename-undo.ts`) reads it back for everyone.
 */
export function rosterWord(graph: ModuleGraph, world: Row, journal: Row, person: CastPerson): string {
    if (!person.node)
        return tableWord(world, person.id) || person.id;
    // §188.2: an individual the graph holds more than once is shown by one word: their first node's, the node `resolve` lands
    // on (`ModuleGraph.survivorOf`, §192.3), else the first other copy's that has one.
    const word = (node: Row) => (tableWord(world, graph.handle(node)) || string(row(row(journal.entries)[string(node.node_id)]).label || "")).trim();
    return person.nodes.map(word).find(Boolean) || person.id;
}
/** One string the request's rename replaces: the words of everyone who carries it (§177.4), their ids, and whether it is a handle row. */
export interface RosterName { readonly name: string; readonly shown: readonly string[]; readonly ids: readonly string[]; readonly handle: boolean }
/**
 * What the request's rename replaces for `people`, each shown by the word given beside them, `known` names left out. The one
 * builder of the roster's rows: `untoldRoster` hands it the untold, §188.3's undo hands it the whole cast.
 */
export function rosterNames(graph: ModuleGraph, people: readonly { person: CastPerson; shown: string }[], known: ReadonlySet<string>): RosterName[] {
    // §176.5: the pieces a name separates with punctuation are renamed too. Table 23 (turn 5): the book's own scene summary
    // said the three men under the awning were "Lars, Nate and Steve" by first name; the whole names and the aliases were
    // renamed, the bare first names were not, and the Keeper wrote one of them.
    // §177.4 (table 24): a name or piece two untold people share was left alone, as naming neither for certain; with the
    // whole cast read, the bar owner and the doctor shared a first name, and it reached the Keeper as printed. A name two
    // untold people share is still a name: it is shown as both their words, "A / B", which hides it and blames nobody.
    const owners = new Map<string, { name: string; shown: string[]; ids: string[]; handle: boolean }>();
    for (const { person, shown } of people) {
        const node = person.node, id = person.id;
        // §176.5: a handle is the book's name as a slug, so the handle and the node id are renamed too, once there is a word.
        // §185.7: not in a name-free campaign, whose handles carry no name; the rename there touches names only.
        // §188.2: every node of an individual the graph holds more than once.
        const slugs = graph.nameFree || !node || shown === id ? [] : person.nodes.flatMap(each => [string(each.node_id), graph.handle(each)])
            .filter((value, at, all) => value && all.indexOf(value) === at);
        const names = person.names;
        for (const name of [...names, ...namePieces(names).filter(piece => !names.includes(piece)), ...slugs]) {
            // Keyed by the exact string the rename replaces: a handle normalizes to its name ("steven-knott") and is its own row.
            const key = name.trim();
            if (!key || known.has(normalize(name))) continue;
            // §177.15: a handle row is machine text, renamed wherever it stands; only a name's places are asked about.
            const entry = owners.get(key) ?? { name, shown: [], ids: [], handle: slugs.includes(name) };
            if (!entry.shown.includes(shown)) entry.shown.push(shown);
            if (!entry.ids.includes(id)) entry.ids.push(id);
            owners.set(key, entry);
        }
    }
    return [...owners.values()];
}
export function clueLabel(graph: ModuleGraph, world: Row, handle: string): string {
    const label = row(world.clue_labels)[handle];
    if (typeof label === "string" && label.trim())
        return label;
    const node = graph.find(handle, ["clue"]);
    return node ? graph.displayName(node) : handle;
}
/** The hour a table opens at when the book named neither a date nor a clock time (contract §23). */
export const DEFAULT_START_MINUTES = 9 * 60;
/** Strict, timezone-free calendar minutes; a round trip rejects normalized invalid dates. */
export function parseClockLocal(value: unknown): Date | null {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
        return null;
    const parsed = new Date(value + "Z");
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 16) === value ? parsed : null;
}
/** The table's pinned opening, then the book, anchors readings and midnight boundaries. */
export function clockStart(graph: ModuleGraph, clock?: Row): { at: Date | null; minutes: number } {
    const pinned = parseClockLocal(row(clock).start_local);
    if (pinned)
        return { at: pinned, minutes: pinned.getUTCHours() * 60 + pinned.getUTCMinutes() };
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
    // A book that named neither a date nor an hour still opens in the morning: the table's own
    // clock reads 09:00 from its first turn instead of the zero the elapsed counter starts at.
    // Midnight would have put the small hours in front of the player on turn one.
    return { at: null, minutes: DEFAULT_START_MINUTES };
}
export function clockSection(graph: ModuleGraph, world: Row): Row {
    const minutes = Math.trunc(number(row(world.clock).minutes)),
        mod = (n: number, by: number) => (n % by + by) % by,
        result: Row = {
        minutes,
        elapsed: `${Math.floor(minutes / 60)} h ${mod(minutes, 60)} min`
    };
    const start = clockStart(graph, row(world.clock));
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
    result.day_part = dayPartOf(minuteOfDay);
    return result;
}
/**
 * The clock's day parts in the day's order, each with the hour it starts. One table: the capsule's `day_part` and
 * §145's reconciliation (a neighbouring part, the start `until` is suggested at) both read it.
 */
export const DAY_PARTS: readonly (readonly [string, number])[] = [
    ["small_hours", 0], ["dawn", 5], ["morning", 8], ["midday", 12], ["afternoon", 14], ["evening", 18], ["night", 22]
];
export function dayPartOf(minuteOfDay: number): string {
    return DAY_PARTS.filter(([, hour]) => minuteOfDay >= hour * 60).at(-1)![0];
}
/** Contract §22.3.2: at most this many contested rows in a scene view, each reason cut at this many characters. */
export const CONTESTED_ROWS = 8;
export const CONTESTED_REASON_CHARS = 240;
const CONTESTED_NOTE = "These module reference differences are advisory. Preserve established campaign values and relationships; do not retcon play merely to match wording or numbers in the book.";
/**
 * Contract §22.3.2: the graph's `contested` marks on the scene's own node and on every node one relation from it (its
 * clues, people, rules and places), scene first, then in relation order: `{record, field, value, reason}`.
 */
function contestedRows(graph: ModuleGraph, scene: Row): Row[] {
    const marks = row(graph.raw.contested), keys = Object.keys(marks);
    if (!keys.length || typeof scene?.node_id !== "string")
        return [];
    const ids = [scene.node_id, ...(graph.out.get(scene.node_id) ?? []).map(rel => string(rel.to_node_id)),
        ...(graph.incoming.get(scene.node_id) ?? []).map(rel => string(rel.from_node_id))].filter((id, index, all) => all.indexOf(id) === index);
    const rows: Row[] = [];
    for (const id of ids) {
        const node = graph.nodes.get(id), prefix = `/nodes/${id}/`;
        if (!node)
            continue;
        for (const key of keys.filter(key => key.startsWith(prefix))) {
            const mark = row(marks[key]);
            rows.push({ record: graph.handle(node), field: key.slice(prefix.length), value: mark.value ?? null,...(mark.impact?{impact:mark.impact}:{}), reason: chars(string(mark.reason), CONTESTED_REASON_CHARS) });
        }
    }
    return rows.slice(0, CONTESTED_ROWS);
}
/** The scene's exits as `where.exits` renders them (also `where.within.exits`, §187.2.2). */
function exitRows(graph: ModuleGraph, world: Row, scene: Row, material: (name: string) => string): Row[] {
    return graph.sceneExits(scene).map(exit => ({
        to: exit.to,
        // The way out was named by its handle alone, so a Keeper reading the capsule saw a slug and
        // wrote the player a slug; the place the module named was one lookup away and never taken.
        ...(sceneLabel(graph, world, graph.scene(exit.to)) !== exit.to ? { display_name: sceneLabel(graph, world, graph.scene(exit.to)) } : {}),
        ...(Object.hasOwn(exit, "travel_minutes") ? { travel_minutes: exit.travel_minutes } : {}),
        ...(truth(exit.when) && row(exit.when).kind !== "always" ? { unlock_when: {
                condition: describeCondition(exit.when),
                met: conditionStatus(exit.when, world, graph)
            } } : {}),
        material: material(graph.scene(exit.to).node_id)
    }));
}
/** Contract §187.2.2: the budget of `where.within`, fitted like `where`. */
export const WITHIN_BUDGET = 2048;
/**
 * Contract §187.2.2 as amended by §204.7: the place the active scene lies in -- the nearest of its containers (§204.1), for
 * any scene, not only a mint -- with its own exits and people, so the book's topology and cast are one hop away, and the
 * other places in it (`places`): a move to one is a move within it. `seated` is whether the ledger (`npc_presence`) puts
 * the person in the active scene; `clues` is a count. Undefined when the scene lies in no place.
 */
export function withinSection(graph: ModuleGraph, world: Row, scene: Row, material: (name: string) => string = () => "ready"): Row | undefined {
    const place = containers(graph, scene)[0];
    if (!place)
        return undefined;
    // §192.3: the place is the node that stands for it; its people are its group's, seated by an entry under any handle.
    const here = sceneHandles(graph, scene), presence = presenceThrough(graph, world);
    const display = place.node_kind === "scene" ? sceneLabel(graph, world, place) : graph.placeName(place);
    const within: Row = {
        name: graph.handle(place),
        ...(display !== graph.handle(place) ? { display_name: display } : {}),
        summary: place.summary || graph.prose(place),
        exits: place.node_kind === "scene" ? exitRows(graph, world, place, material) : [],
        places: placesWithin(graph, place, scene).map(node => {
            const name = graph.handle(node), shown = sceneLabel(graph, world, node);
            return { name, ...(shown !== name ? { display_name: shown } : {}) };
        }),
        people: graph.sceneNpcIds(place).map(id => {
            const node = graph.nodes.get(id)!, name = graph.handle(node), shown = graph.displayName(node);
            return { name, ...(shown !== name ? { display_name: shown } : {}), seated: here.has(presence.get(id)?.at ?? "") };
        }),
        clues: graph.sceneClueIds(place).length,
        material: material(place.node_id)
    };
    fitBudget(within, WITHIN_BUDGET, "last");
    if (jsonSize(within) > WITHIN_BUDGET && typeof within.summary === "string")
        within.summary = chars(within.summary, 400);
    return within;
}
/** Contract §204.4: the most characters of the book's words a bound place carries into `where.book`. */
export const BOOK_TEXT_CHARS = 1200;
/**
 * Contract §204.4: the book's mention of a place this table established, once the host bound it (`place-bindings.json`): its
 * pages, the excerpt and the pages as `source_refs`, which the prescreen's cited pages read too. Undefined for any other place.
 */
export function bookSection(graph: ModuleGraph, scene: Row): Row | undefined {
    const book = row(scene.book), pages = array(book.pages).filter(page => integer(page) && number(page) >= 1).map(number);
    if (!graph.isTableEntity(scene) || !pages.length)
        return undefined;
    return { pages, ...(typeof book.excerpt === "string" && book.excerpt ? { text: chars(book.excerpt, BOOK_TEXT_CHARS) } : {}),
        source_refs: pages.map(page => ({ source_id: `pdf:${graph.moduleId}`, pdf_index: page - 1 })) };
}
export function whereSection(graph: ModuleGraph, world: Row, scene: Row, material: (name: string) => string = () => "ready", compact = false): Row {
    const record = recordOf(scene),
        exits = exitRows(graph, world, scene, material);
    const affordances = array(record.affordances).map(aff => {
        const entry: Row = {
            id: aff.id ?? null,
            cue: aff.cue ?? null
        };
        // The cue and what taking it yields belong in one row (contract §31.3, §32.5). The authored
        // field is `grants_clue_ids`; `clue_id` is the older singular spelling, and the first
        // granted clue keeps the `clue` key the §6 shape has always had.
        // §192.3: each granted clue as the clue that stands for it, once.
        const granted = [...new Set([...array(aff.grants_clue_ids), ...(typeof aff.clue_id === "string" ? [aff.clue_id] : [])]
            .filter(id => typeof id === "string" && graph.nodes.has(id)).map(id => graph.survivorId(id)))]
            .map(id => graph.nodes.get(id)!);
        if (granted.length) {
            entry.clue = graph.handle(granted[0]);
            entry.clues = granted.map(node => ({
                clue: graph.handle(node),
                gate: clueGate(graph, node, world),
                discovered: clueDiscovered(graph, world, node),
                ...cluePreparation(graph, world, node, material)
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
        ...(graph.sourceNeeds(scene,true).length?{runtime_inputs:graph.sourceNeeds(scene,true)}:{}),
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
        assets: graph.sceneAssets(scene, array(world.handouts_shown)),
        places: graph.scenePlaces(scene),
        rules: graph.sceneRules(scene, mechRow(graph)),
        endings: graph.sceneEndings(scene),
        material: material(scene.node_id)
    };
    // §187.2.2 / §204.7: the place the active scene lies in.
    const within = withinSection(graph, world, scene, material);
    if (within)
        where.within = within;
    // §204.4: the book's own words for a place this table established and the host bound to them.
    const book = bookSection(graph, scene);
    if (book)
        where.book = book;
    // §22.3.2: a classification a reviewer disputed on this scene or a record one relation from it. `look` only.
    const contested = compact ? [] : contestedRows(graph, scene);
    if (contested.length) {
        where.contested = contested;
        where.contested_note = CONTESTED_NOTE;
    }
    if (compact)
        for (const [key, limit, size] of [["places", 8, 90], ["rules", 6, 160]] as const) {
            if (where[key].length > limit) {
                where.truncated = true;
                where[key] = where[key].slice(0, limit);
            }
            for (const entry of where[key]) {
                if (length(entry.line || "") > size) {
                    entry.line = chars(entry.line, size);
                    entry.truncated = true;
                    where.truncated = true;
                }
                // The rule row's mech line (contract §136.11) is cut the same way, and says so on its own key.
                if (typeof entry.mech === "string" && length(entry.mech) > size) {
                    entry.mech = chars(entry.mech, size);
                    entry.mech_truncated = true;
                    where.truncated = true;
                }
            }
        }
    return where;
}
/**
 * §192.3: where the ledger has each actor (`world.npc_presence`), read through survivors: an entry under a variant's handle is
 * the node that stands for it. The survivor's own entry wins over a variant's, which only stands in while the survivor has none
 * (a write after an identity relation lands under the survivor's handle). Each actor once, in the ledger's order.
 */
export function presenceThrough(graph: ModuleGraph, world: Row): Map<string, { node: Row; at: string }> {
    const found = new Map<string, { node: Row; at: string; own: boolean }>();
    for (const [handle, at] of entries(row(world.npc_presence))) {
        const node = graph.actor(handle);
        if (!node || typeof at !== "string") continue;
        const id = string(node.node_id), own = handle === graph.handle(node) || (graph.nameFree && graph.sameNode(handle, node)), prior = found.get(id);
        if (!prior || (own && !prior.own)) found.set(id, { node, at, own });
    }
    return new Map([...found].map(([id, { node, at }]) => [id, { node, at }]));
}
/** §192.3: the scene handles that are this scene -- every node of its group -- for a presence value written under any of them. */
const sceneHandles = (graph: ModuleGraph, scene: Row): Set<string> => new Set(graph.groupOf(scene).map(node => graph.handle(node)));
export function npcsPresent(graph: ModuleGraph, world: Row, scene: Row): Row[] {
    const here = sceneHandles(graph, scene);
    return [...presenceThrough(graph, world).values()].flatMap(({ node, at }) => here.has(at) ? [node] : []);
}
/**
 * Contract §198.3: the people the book places in `scene` (§198.2, `scenePeople`) whom nobody has placed anywhere -- no node of
 * their group has an `npc_presence` entry. At the opening these are who the host's judge is asked about and the only people an
 * opening seat may write; `via` is the scene through which the book places them, when it is another one.
 */
export function unplacedPeople(graph: ModuleGraph, world: Row, scene: Row): Array<{ node: Row; via: Row | null }> {
    const presence = row(world.npc_presence);
    return graph.scenePeople(scene).flatMap(({ id, via }) => {
        const node = graph.nodes.get(id);
        return node && !graph.groupOf(node).some(each => Object.hasOwn(presence, graph.handle(each))) ? [{ node, via }] : [];
    });
}
/**
 * Contract §198.3: what `table.open` hands the host while the opening is owed -- the opening scene with the book's text for it,
 * and each person `unplacedPeople` lists with their card, the placement conditions the book states and the scene that places
 * them. Null when there is nobody to ask about.
 */
export function openingPeopleView(graph: ModuleGraph, world: Row, scene: Row): Row | null {
    const people = unplacedPeople(graph, world, scene).map(({ node, via }) => {
        const conditions = Object.fromEntries(["when", "unlock_when", "conditions"].filter(key => Object.hasOwn(row(node.properties), key)).map(key => [key, row(node.properties)[key]]));
        return {
            name: graph.handle(node), display_name: graph.displayName(node), summary: chars(graph.summary(node), 800),
            ...(Object.keys(conditions).length ? { conditions } : {}),
            ...(via ? { placed_by: { name: graph.displayName(via), summary: chars(string(via.summary || graph.prose(via)), 1500) } } : {}),
        };
    });
    return people.length ? { scene: { name: graph.handle(scene), display_name: graph.displayName(scene), text: chars(string(scene.summary || graph.prose(scene)), 3000) }, people } : null;
}
/**
 * §192.3: whether the table found a clue: `world.discovered_clues` holds the handle of any node of the clue's group, the clue
 * that stands for it or a copy found before the two were joined.
 */
export function clueDiscovered(graph: ModuleGraph, world: Row, clue: Row): boolean {
    return graph.discovered(world, clue);
}
/** §22.4.9: navigation is not prepared source material; the existing transaction gate still decides discovery. */
function cluePreparation(graph: ModuleGraph, world: Row, node: Row, material: (name: string) => string): Row {
    const ready = graph.isTableEntity(node) || material(node.node_id) === "ready";
    return {material: ready ? "ready" : "missing", ...(!ready && !clueDiscovered(graph, world, node) ? {
        next: {tool: "lookup", kind: "source", source_mode: "prepare", query: graph.handle(node),
            question: "Prepare this clue."},
        note: "Prepare source before discovery."
    } : {})};
}
export function cluesHere(graph: ModuleGraph, world: Row, scene: Row, material: (name: string) => string = () => "ready"): Row[] {
    return graph.sceneClueIds(scene).map(id => {
        const node = graph.nodes.get(id)!, view = graph.clueView(node);
        // "What can still be dug up here and how": the gate is the how (contract §32.5), the same
        // string the Director's reveal rows and the thread's `here` rows carry.
        return {
            ...view,
            gate: clueGate(graph, node, world),
            discovered: clueDiscovered(graph, world, node),
            ...cluePreparation(graph, world, node, material)
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
/** Contract §165.3: the person's §40.7 mask as the one line it is, with the dossier's own precedence -- the book's word
 *  first, then what an enabled package established at the table -- or nothing when neither carries one. */
export function voiceMaskOf(graph: ModuleGraph, world: Row, node: Row): string | undefined {
    const value = graph.npcProfile(node)[MASK_KEY] ?? row(tableWords(world, node)[MASK_KEY]).value;
    const line = Array.isArray(value) ? value[0] : value;
    return typeof line === "string" && line.trim() ? line.trim() : undefined;
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
/**
 * Contract §180.8: a creature's words under their labels -- what the book says under the words its module bound (the
 * creature spine), then what an enabled package established at the table where the book is silent (§28.7), exactly as a
 * person's dossier reads. A creature has no person word.
 */
export function creatureWords(graph: ModuleGraph, world: Row, node: Row): Row {
    const profile = graph.creatureProfile(node), established = tableWords(world, node), spine = new Set<string>(), result: Row = {};
    for (const [key, label] of dossierLabels(graph.creatureDossier())) {
        spine.add(key);
        const value = truth(profile[key]) ? profile[key] : row(established[key]).value;
        if (truth(value))
            result[label] = value;
    }
    for (const [key, entry] of entries(established))
        if (!spine.has(key) && truth(row(entry).value))
            result[string(row(entry).label) || key] = row(entry).value;
    return result;
}
function outstandingPromise(memory: Row): boolean {
    return memory.status === 'candidate' && memory.superseded_by == null && memory.valid_until_turn == null
        && row(memoryEvidenceView(memory).fulfillment).status !== 'complete';
}
function promiseOrder(left: Row, right: Row): number {
    const leftOpen = outstandingPromise(left), rightOpen = outstandingPromise(right);
    const turns = number(left.valid_from_turn ?? left.turn) - number(right.valid_from_turn ?? right.turn);
    return leftOpen !== rightOpen ? leftOpen ? -1 : 1 : leftOpen ? turns : -turns;
}
function npcHistory(ledger: Row, handle: string, memories: Map<string, Row>, shownPromises: Set<string>): Row | null {
    const result: Row = {},
        seen = row(ledger.turns_present),
        disclosed = array(ledger.disclosed).filter(item => truth(item.clue)).map(item => string(item.clue));
    // Contract §142.3: what this person set out to do and where each stands -- under way first, then the latest settled.
    const intents = intentsView(ledger, handle);
    if (intents.length)
        result.intents = intents;
    const selected = array(ledger.promises).flatMap(item => {
        const memory = memories.get(string(item.memory_id));
        return memory && memory.status !== 'superseded' && memory.superseded_by == null && memory.valid_until_turn == null
            ? [{memory, turn: item.turn ?? null}] : [];
    }).sort((left, right) => promiseOrder(left.memory, right.memory)).slice(0, 3);
    const promises = selected.map(({memory, turn}) => {
        shownPromises.add(memoryOccurrenceKey(memory));
        return {
                statement: memory.statement ?? null,
                turn,
                ...memoryEvidenceView(memory)
            };
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
export function npcEntry(graph: ModuleGraph, world: Row, node: Row, ledger: Row, memories: Map<string, Row>, across: (node: Row) => Row[] = () => [], seat: LinesSeat = "keep", journal: Row = {}, records: Row[] = [], scope:Row = {}, reads: ChainReads = {}): Row {
    const state = npcState(graph, world, node), untold = untoldBlock(graph, world, journal, node, records);
    // Contract §161.3: what this person feels right now, from the committed ledger -- not for one who cannot act (the
    // body's `state`, or a death the ledger records), and absent when no mood was ever written.
    const ledgerRow = row(ledger[node.node_id]), now = state || truth(ledgerRow.dead) ? null : moodNow(ledgerRow);
    const entry: Row = {
        name: graph.displayName(node),
        ...(graph.sourceNeeds(node,true).length?{runtime_inputs:graph.sourceNeeds(node,true)}:{}),
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
        // After `state`, before the dossier (§161.3): present[] is cut from the bottom, and this is what decides how
        // the next line sounds.
        ...(now ? {now} : {}),
        ...dossier(graph, world, node, seat),
        ...(personalityView(graph, world, node) ? {personality: personalityView(graph, world, node)} : {})
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
    // §180.9: what ends them, where its means stand, how far the route is; then the beliefs about them that are false.
    Object.assign(entry, weaknessChain(graph, world, node, reads, true));
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
    const saved = row(ledger[node.node_id]), toward = towardParty(saved);
    if (toward)
        entry.toward_party = toward;
    const shownPromises = new Set<string>();
    const history = npcHistory(saved, graph.handle(node), memories, shownPromises);
    if (history)
        entry.history = history;
    const relationships=npcRelationships(graph,node,[...memories.values()],scope),recent=npcRecentSpeech(graph,node,records,scope);
    if(relationships.length)entry.relationships=relationships;
    if(recent.length)entry.recent_speech=recent;
    // The same owned promise already occupies history.promises. Do not duplicate its bytes and
    // crowd an earlier canonical occurrence out of the capsule; the full NPC read retains all rows.
    const commitments=npcCommitments(graph,node,[...memories.values()].filter(value=>value.valid_until_turn==null
        &&!shownPromises.has(memoryOccurrenceKey(value))),scope).sort(promiseOrder);
    if(commitments.length)entry.commitments=commitments.slice(0,4);
    if(commitments.length>4)entry.coverage={commitments_omitted:commitments.length-4};
    const reunion=reunionView(graph,world,node,records,scope);
    if(reunion)entry.reunion=reunion;
    const elsewhere = across(node);
    if (elsewhere.length)
        entry.from_other_lines = elsewhere;
    return entry;
}
/** How a present being stands toward the party, from the stance ledger's committed fold, or null when nothing was folded. */
function towardParty(saved: Row): Row | null {
    const stance = row(saved.stance);
    if (!truth(stance.value))
        return null;
    return {
        stance: stance.value,
        because: array(stance.because).slice(-3).map(cause => cause.how === "keeper" ? `turn ${string(cause.turn)}: keeper set ${string(cause.stance)}${cause.why ? `: ${cause.why}` : ""}` : cause.how === "combat" ? `turn ${string(cause.turn)}: fought` : `turn ${string(cause.turn)}: ${string(cause.approach)} ${string(cause.level)}`)
    };
}
/** §180.4: what the book says a creature is, one line of at most 160 characters, or "" when it says nothing. */
export const CREATURE_WHAT_CHARS = 160;
export function creatureWhat(node: Row): string {
    return typeof node.summary === "string" ? chars(words(node.summary), CREATURE_WHAT_CHARS) : "";
}
/**
 * Contract §180.4: a creature present, as a body. It carries what it is, the state of its body, the Keeper's note and how
 * it stands toward the party -- each only when there is a value -- and none of a person's fields (`called`, `untold`,
 * `now`, `personality`, `knows`, `believes`, `would_lie_about`, `ties`, `history`, `relationships`, `recent_speech`,
 * `commitments`, `reunion`, `from_other_lines`): no person feature reads a creature.
 */
export function creatureEntry(graph: ModuleGraph, world: Row, node: Row, ledger: Row, reads: ChainReads = {}): Row {
    const state = npcState(graph, world, node), what = creatureWhat(node), note = recordOf(node).keeper_note;
    const toward = towardParty(row(ledger[node.node_id]));
    return {
        name: graph.displayName(node),
        kind: "creature",
        ...(what && normalize(what) !== normalize(graph.displayName(node)) ? { what } : {}),
        ...(state ? { state } : {}),
        // §180.8: its words (`habits`) under their labels; §180.9: the weakness chain, budgeted as a present row.
        ...creatureWords(graph, world, node),
        ...weaknessChain(graph, world, node, reads, true),
        ...(truth(note) ? { keeper_note: note } : {}),
        ...(toward ? { toward_party: toward } : {}),
    };
}
/** `options.voices` true is the capsule's form (contract §40.7): the lines-shaped words leave the rows for `voices`. */
/** `options.chain` is what §180.9's chain reads beyond the world (the investigators and their spells); without it a need
 *  still names itself, and an object placed as an instance still says who holds it. */
export function presentSection(graph: ModuleGraph, world: Row, scene: Row, ledger: Row = {}, memory: Row[] = [], across: (node: Row) => Row[] = () => [], options: { voices?: boolean; journal?: Row; records?: Row[]; currentReceipts?: Row[]; campaign?:string; scope?:Row; chain?: ChainReads } = {}): Row[] {
    const projected=withPromiseFulfillment(memory,{campaign:options.campaign,receipts:canonicalMemoryReceipts(options.records??[],options.currentReceipts??[]),world,samePayer:samePersonReference(graph,world)});
    const memories=new Map<string,Row>();
    for(const value of projected.filter(m=>truth(m.id))) {
        const prior=memories.get(string(value.id));
        memories.set(string(value.id),prior&&memoryOccurrenceKey(prior)!==memoryOccurrenceKey(value)
            ? {kind:'promise',status:'candidate',statement:null,authority:'conversation_report',fulfillment:{status:'unavailable',terms:[]}} : value);
    }
    // §142.3: someone with an intention under way owes the table a result this turn, as a promise does.
    const rank = (entry: Row) => truth(row(entry.history).promises) || array(row(entry.history).intents).some(item => row(item).status === "attempted") ? 0 : truth(row(entry.history).met_turns) || truth(entry.toward_party) ? 1 : truth(entry.wants) ? 2 : 3;
    // §180.4: persons first, ranked; the creatures after them, so present[]'s budget (cut from the end) cuts them first.
    const present = npcsPresent(graph, world, scene), people = present.filter(node => graph.isPerson(node));
    return [
        ...people.map(node => npcEntry(graph, world, node, ledger, memories, across, options.voices ? "drop" : "keep", row(options.journal), options.records,options.scope, options.chain)).sort((a, b) => rank(a) - rank(b)),
        ...present.filter(node => !graph.isPerson(node)).map(node => creatureEntry(graph, world, node, ledger, options.chain)),
    ];
}
export function npcView(graph: ModuleGraph, world: Row, node: Row, ledger: Row = {}, journal: Row = {}, records: Row[] = [], memory:Row[] = [], scope:Row = {}, combat: Row | null = null, dispositions: Row | null = null, reads: ChainReads = {}): Row {
    const untold = untoldBlock(graph, world, journal, node, records), handle = graph.handle(node),
        view: Row = {
        kind: "npc",
        ...(graph.sourceNeeds(node).length?{source_needs:graph.sourceNeeds(node)}:{}),
        ...(graph.sourceMappings(node).length?{source_mappings:graph.sourceMappings(node),source_mapping_note:'Keep established campaign values; source variants are mappings, not instructions to retcon this person.'}:{}),
        ...(graph.adaptationOrigin(node.campaign_origin) ? {origin: graph.adaptationOrigin(node.campaign_origin)} : {}),
        name: graph.displayName(node),
        ...(calledBlock(world, handle, graph.displayName(node)) ? {called: calledBlock(world, handle, graph.displayName(node))} : {}),
        ...(untold ? {untold} : {}),
        id: handle,
        // §185.7: where the book's node id stood, a name-free campaign shows the handle.
        node_id: graph.shownIds(node.node_id),
        scene: row(world.npc_presence)[handle] ?? null,
        summary: node.summary ?? null,
        visibility: node.visibility ?? null,
        ...(npcState(graph, world, node) ? {state: npcState(graph, world, node)} : {}),
        ...dossier(graph, world, node),
        ...(personalityView(graph, world, node) ? {personality: personalityView(graph, world, node)} : {})
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
    // §180.9: the single-person read carries the whole chain, every entry and every `book` uncut.
    const chain = weaknessChain(graph, world, node, reads);
    Object.assign(view, chain);
    const ties = graph.npcTies(node);
    if (ties.length)
        view.ties = ties.map(tie => ({
            kind: tie.kind,
            to: tie.to,
            kind_of: tie.node.node_kind
        }));
    view.ledger = ledgerView(graph, node, ledger[node.node_id]);
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
    // §11.5.2: how this person defends when attacked, and why that word (Keeper-only: this card is the Keeper's).
    view.combat_tactic = cardTactic(graph, world, node);
    // §11.5.3: how this person behaves in a fight (their disposition) and the standing action a card can state; the
    // table reads the rest in the fight itself. `combat` is the saved fight, so a Keeper's hold shows only in its round.
    // With the disposition table, a person without a disposition also carries what one is inferred from.
    Object.assign(view, cardAction(graph, world, node, combat, dispositions));
    const authored = withoutChainIds(graph.shownIds(graph.entityView(node).properties), chain);
    if (truth(authored))
        view.properties = authored;
    const relationships=npcRelationships(graph,node,memory,scope),recent=npcRecentSpeech(graph,node,records,scope);
    if(relationships.length)view.relationships=relationships;
    if(recent.length)view.recent_speech=recent;
    const commitments=npcCommitments(graph,node,memory,scope);
    if(commitments.length)view.commitments=commitments;
    const reunion=reunionView(graph,world,node,records,scope);
    if(reunion)view.reunion=reunion;
    return view;
}
/**
 * §185.7 (and NFH-02's note): a person's ledger row as a single read shows it. Each intention reads by its canonical reference,
 * built from the person's current handle and the row's digest (`shownIntentRef`, §185.2) -- what the card shows and what settles
 * it; a row recorded before a fold keeps its interim owner in the file. A node id the row stores reads as its handle in a
 * name-free campaign (`shownIds`). For a row the kernel wrote in a legacy campaign both are the stored strings.
 */
function ledgerView(graph: ModuleGraph, node: Row, entry: unknown): Row | null {
    if (!isJsonObject(entry))
        return (entry ?? null) as Row | null;
    const handle = graph.handle(node);
    const view = Array.isArray(entry.intents)
        ? {...entry, intents: entry.intents.map(item => isJsonObject(item) && typeof item.ref === "string" ? {...item, ref: shownIntentRef(item.ref, handle)} : item)}
        : entry;
    return graph.shownIds(view);
}
/** The authored properties a single read dumps, less the raw `weaknesses` (node ids) when the chain carries them by name. */
function withoutChainIds(properties: Row, chain: Row): Row {
    if (!truth(chain.weaknesses) || !Object.hasOwn(row(properties), "weaknesses"))
        return properties;
    const { weaknesses: _ids, ...rest } = properties;
    return rest;
}
/**
 * Contract §180.4/§180.9: the single read of a creature (`look focus=npc name=<creature>`). The present row's body
 * fields -- what it is, its state, its words, how it stands toward the party -- with the whole weakness chain, and the
 * Keeper's card: the ledger, its mechanics and, for one that states a stat block, how it defends and acts in a fight.
 * None of a person's fields.
 */
export function creatureView(graph: ModuleGraph, world: Row, node: Row, ledger: Row = {}, combat: Row | null = null, dispositions: Row | null = null, reads: ChainReads = {}): Row {
    const handle = graph.handle(node), state = npcState(graph, world, node), record = recordOf(node);
    const toward = towardParty(row(ledger[node.node_id])), chain = weaknessChain(graph, world, node, reads);
    const view: Row = {
        kind: "creature",
        ...(graph.adaptationOrigin(node.campaign_origin) ? {origin: graph.adaptationOrigin(node.campaign_origin)} : {}),
        name: graph.displayName(node),
        id: handle,
        // §185.7: where the book's node id stood, a name-free campaign shows the handle.
        node_id: graph.shownIds(node.node_id),
        scene: row(world.npc_presence)[handle] ?? null,
        summary: node.summary ?? null,
        visibility: node.visibility ?? null,
        ...(state ? {state} : {}),
        ...creatureWords(graph, world, node),
        ...chain,
        ...(truth(record.keeper_note) ? {keeper_note: record.keeper_note} : {}),
        ...(toward ? {toward_party: toward} : {}),
        ledger: ledgerView(graph, node, ledger[node.node_id]),
        mechanics: truth(graph.mechanicsOf(node)) ? graph.mechanicsOf(node) : null,
    };
    // A body the engine fights with (§136.12): how it defends and what it does in a fight, as a person's card says.
    if (graph.isActor(node)) {
        view.combat_tactic = cardTactic(graph, world, node);
        Object.assign(view, cardAction(graph, world, node, combat, dispositions));
    }
    const authored = withoutChainIds(graph.shownIds(graph.entityView(node).properties), chain);
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
/** The cap §119 puts on a written appearance wherever it is projected. The `known` section is budgeted by popping
 *  its largest list and the investigator is an object, so an unbounded string here would evict clue rows instead
 *  of itself; the voice lane's packet carries the same bounded string. */
export const APPEARANCE_CHARS = 200;
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
    // What this table can see of them before it knows them (§119): the appearance the player wrote at setup and
    // the card already shows, and the years on that card. The mask lane reads the same words (§118), so a person
    // with no name for the investigator can still be given one out of what is visible.
    const written = string(row(sheet.backstory).personal_description || '').trim();
    const appearance = written ? chars(written, APPEARANCE_CHARS) : '', years = integer(sheet.age) ? number(sheet.age) : null;
    return {
        ...nonStandard,
        id: sheet.id ?? null,
        name: sheet.name ?? null,
        occupation: sheet.occupation ?? null,
        occupation_stated: sheet.occupation_stated ?? null,
        sex: sheet.sex ?? null,
        ...(appearance ? { appearance } : {}),
        ...(years != null ? { age: years } : {}),
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
            const delta = number(receipt.delta ?? 0), purchase = receipt.settlement !== 'quote' && number(receipt.purchase_amount) > 0;
            if(receipt.settlement === 'quote'||!(delta < 0) && !purchase)continue;
            paid.push({
                turn: record.turn ?? null,
                amount: purchase ? receipt.purchase_amount : -delta,
                currency: receipt.currency ?? null,
                ...(receipt.source != null ? { source: receipt.source } : {}),
                ...(receipt.settlement != null ? { settlement: receipt.settlement } : {}),
                ...(receipt.price_id != null ? { price_id: receipt.price_id } : {}),
                ...(receipt.with_label != null ? { with: receipt.with_label } : {}),
                why: receipt.why ?? null
            });
        }
    return paid;
}
export function knownSection(graph: ModuleGraph, world: Row, scene: Row, party: Row[], records: Row[] = [], material: (name: string) => string = () => "ready"): Row {
    const section: Row = {
        discovered_clues: [...array(world.discovered_clues)],
        clues_here: cluesHere(graph, world, scene, material),
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
        if(section.investigator.living){
            const day=Math.floor((clockStart(graph,row(world.clock)).minutes+number(row(world.clock).minutes))/1440),saved=row(row(sheet.finance).daily_spending);
            section.investigator.living.daily_spending=saved.day===day?{...saved}:{day,total:0,debited:0};
        }
        // The form of address the player established for their own investigator (§79). This is the
        // half the memory lane could never hold: a new NPC who has never been corrected reads it
        // here on the turn they first open their mouth, and a correction twenty-five turns old is
        // still exactly as present as the turn it was made.
        const called = calledBlock(world, string(sheet.id), string(sheet.name || sheet.id));
        if (called)
            section.investigator.called = called;
        // A book speaks to a group, and so does everything prepared from it. With one investigator at the table the
        // installed App's Keeper still had locals say "you people" to a man driving alone (Blood Road, 2026-10-02).
        if (party.length === 1)
            section.investigator.alone = "Nobody travels with this investigator: people speak to and of them as one person, whatever the book says of a group.";
        if (typeof row(sheet.origin).library_id === "string" && row(sheet.origin).library_id && typeof sheet.era === "string" && sheet.era && typeof book === "string" && book && sheet.era !== book)
            section.investigator.era_note = `This sheet was built for the ${sheet.era} era and the module is set in ${book}; its characteristics, skills and money are unchanged. Reconcile the difference in the fiction, not in the numbers.`;
    }
    const paid = pricesPaid(records);
    if (paid.length)
        section.prices_paid = paid;
    const quotes=array(world.cash_quotes).filter(value=>!value.settled&&!value.cancelled).slice(-8);
    if(quotes.length)section.cash_quotes=quotes.map(value=>({quote:value.name,subject:value.subject,with:value.with,with_id:value.with_id??null,purchase_amount:value.purchase_amount,cash_debit:value.cash_debit??null,origin_turn:value.origin_turn??null,items:value.items,currency:value.currency,category:value.category,purpose:value.why}));
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
/** Contract §187.4: the pages of the reading window the brief's rosters are ordered by, or null for graph order. */
export type RosterWindow = { first: number; last: number } | null | undefined;
/**
 * Contract §187.4: the roster's nodes with those citing a page inside `window` first, each part in book (graph) order. A
 * stable partition, so no window, or a window every node is inside, is the graph's order unchanged.
 */
export function windowOrder(nodes: Row[], window: RosterWindow): Row[] {
    if (!window)
        return nodes;
    const near = (node: Row) => array(node.source_refs).some(ref => integer(row(ref).pdf_index) && number(ref.pdf_index) + 1 >= window.first && number(ref.pdf_index) + 1 <= window.last);
    return [...nodes.filter(near), ...nodes.filter(node => !near(node))];
}
/** §192.3: the brief lists each thing once: a node another stands for is never a roster line of its own. */
function rosterNodes(graph: ModuleGraph, kind: string): Row[] {
    // §204.6: a location named exactly as a person of the book is that person's identity, never a line of the places roster.
    const people = personNamedLocations(graph);
    return (kind === 'location' ? array(graph.raw.nodes).filter(node => node.node_kind === 'location' && !people.has(string(node.node_id))) : graph.kind(kind)).filter(node => !graph.isVariant(node));
}
export function moduleSection(graph: ModuleGraph, size = 120, window?: RosterWindow): Row {
    const module = graph.moduleNode || {},
        record = recordOf(module),
        roster = (kinds: string[]) => windowOrder(kinds.flatMap(kind => rosterNodes(graph, kind)), window).map(node => ({
        name: graph.displayName(node),
        line: oneLine(graph, node, size)
    }));
    return {
        title: graph.title(),
        ...(typeof record.era === "string" && record.era.trim() ? { era: record.era } : {}),
        synopsis: words(module.summary || ""),
        factions: roster(["faction", "organization"]),
        places: roster(["location"]),
        people: roster(["npc"]),
        endings: rosterNodes(graph, "ending").map(n => graph.displayName(n)),
        conclusions: rosterNodes(graph, "conclusion").map(n => graph.displayName(n)),
        structure_type: structureType(graph)
    };
}
export function fittedModuleSection(graph: ModuleGraph, budget = 2048, window?: RosterWindow): [
    Row,
    boolean
] {
    let section = moduleSection(graph, 120, window),
        cut = false,
        lineSize = 120;
    for (const size of [80, 40, 20, 0]) {
        if (jsonSize(section) <= budget)
            break;
        section = moduleSection(graph, size, window);
        lineSize = size;
        cut = true;
    }
    cut = fitBudget(section, budget, "last") || cut;
    // §180.4: the book's creatures, in the same roster form as its people, ride only on what the fit above leaves. They
    // are cut first and never cost a person, a place or an ending its line, and the roster is absent when the book has
    // none or none fits.
    const creatures: Row[] = [], bookCreatures = windowOrder(rosterNodes(graph, "creature"), window);
    for (const node of bookCreatures) {
        const entry = { name: graph.displayName(node), line: oneLine(graph, node, lineSize) };
        if (jsonSize({ ...section, creatures: [...creatures, entry] }) > budget) {
            cut = true;
            break;
        }
        creatures.push(entry);
    }
    if (creatures.length)
        section.creatures = creatures;
    // §187.4: how many lines of each roster the fit removed, so the Keeper knows the book holds more than it shows.
    const more = {
        people: rosterNodes(graph, "npc").length - array(section.people).length,
        places: rosterNodes(graph, "location").length - array(section.places).length,
        creatures: bookCreatures.length - creatures.length
    };
    if (more.people > 0 || more.places > 0 || more.creatures > 0)
        section.more = more;
    return [section, cut];
}
