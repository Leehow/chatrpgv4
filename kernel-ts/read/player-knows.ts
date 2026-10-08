/**
 * Contract §194.2 (owner ruling 2026-10-08, two ledgers): the capsule's `player_knows` section, what the investigator knows of
 * the book's people and papers, in one place beside the book's truth the rest of the capsule carries.
 *
 * Real table TR-F (Cold Harvest): the player held the letter that prints its writer's and the accused family's names, and the
 * Keeper, whose request had those names renamed to wrong words, said the letter bore no name. With the request carrying the
 * book's names again (§194.1), the Keeper needs the other ledger: whom the investigator has met or been told of, under which
 * word and whether by name, and which documents are in their hands.
 *
 * - `people`: each book person the investigator has met or heard of -- a journal entry (the sidebar's record of meeting them),
 *   a word the fiction gave them (`world.person_labels`), a first sight shown or owed (`first-sight.json`), or their name told
 *   (the journal's `named_at` or a delivery that showed it, the test `untoldBlock` makes). Told: `{word, name}`. Untold:
 *   `{word, untold: true, book_name}`, the book's name for the Keeper's own reckoning.
 * - `documents`: each handout a delivered turn handed over (its receipt), `{label, turn}`.
 * - Clues and remembered facts stay where they are (`known.discovered_clues`, `memory`); the section points at them.
 *
 * Writers: the journal lane, `apply person` and `{{name:}}` deliveries, the first-sight check, `apply handout`. Reader: this
 * section. Actor: the Keeper, who tells a document's names and a told person's name as the investigator knows them.
 */
import type { ModuleGraph } from "./module-graph.js";
import { array, integer, number, row, string, type Row } from "./values.js";
import { bookCast, castToldTurn, ownedBy, tellGuard } from "./cast.js";
import { personLabel, rosterWord, untoldBlock, jsonSize } from "./capsule.js";
import { tableWord } from "./person-words.js";
import { toldTurn } from "../journal/naming.js";
import { prepareNameHistory } from "../journal/name-history.js";
import { firstSightLedger } from "../first-sight/index.js";

/** The section's own budget; it fits itself, newest first, and counts what it left out. */
export const PLAYER_KNOWS_BUDGET = 2048;

export const PLAYER_KNOWS_USE = "What the investigator knows of the book's people and papers. people: everyone they have met or heard of, "
    + "newest first, by the word prose uses; name once they have been told it, else untold with book_name, which they have not heard. "
    + "documents: what was handed to them, so they have read it. Their clues are known.discovered_clues; what they remember is memory.";

interface Ranked { row: Row; at: number; order: number }

const newestFirst = (a: Ranked, b: Ranked): number => b.at - a.at || a.order - b.order;

/** The people half: every book person the investigator has met or heard of, newest first. */
function knownPeople(graph: ModuleGraph, world: Row, journal: Row, records: Row[], firstSight: unknown): Ranked[] {
    const history = prepareNameHistory(records, tellGuard(graph, world, journal));
    const sight = firstSightLedger(firstSight);
    const seen = new Set([...sight.shown.people, ...sight.open.filter(entry => entry.kind === "person").map(entry => string(entry.id))]);
    const labelled = (key: string): boolean => !!string(row(row(world.person_labels)[key]).name || "").trim();
    const out: Ranked[] = [];
    bookCast(graph).forEach((person, order) => {
        if (!person.node) {
            // Someone the reader has not reached: known only once a delivery showed their name, or the fiction gave them a word.
            const told = castToldTurn(person, history), name = person.printed[0] || person.names[0] || person.id;
            if (told === null && !labelled(person.id)) return;
            const word = tableWord(world, person.id) || (told === null ? person.id : name);
            out.push({ row: told === null ? { word, untold: true, book_name: name } : { word, name }, at: told ?? -1, order });
            return;
        }
        const node = person.node;
        if (!graph.isPerson(node)) return;
        const entries = person.nodes.map(each => row(journal.entries)[string(each.node_id)]).filter(entry => entry && typeof entry === "object").map(row);
        const handles = person.nodes.map(each => graph.handle(each));
        const untold = untoldBlock(graph, world, journal, node, history);
        if (untold && !entries.length && !handles.some(labelled) && !handles.some(handle => seen.has(handle))) return;
        const book = graph.displayName(node);
        let at = Math.max(-1, ...entries.flatMap(entry => [entry.last_seen_turn, entry.named_at].filter(integer).map(value => number(value))));
        if (!untold) {
            const said = toldTurn(graph, node, history, Infinity, ownedBy(graph, node));
            if (said !== null) at = Math.max(at, said);
        }
        out.push({ row: untold ? { word: rosterWord(graph, world, journal, person), untold: true, book_name: book }
            : { word: personLabel(world, graph.handle(node), book), name: book }, at, order });
    });
    return out.sort(newestFirst);
}

/** The documents half: each handout a delivered turn handed over, once, at the latest turn it was handed over. */
function deliveredDocuments(records: Row[], turn: number): Ranked[] {
    const latest = new Map<string, Ranked>();
    records.filter(record => number(record.turn) < turn && record.closed_by !== "stranded").forEach((record, order) => {
        for (const receipt of array(record.receipts).map(row)) {
            if (receipt.kind !== "handout") continue;
            const key = string(receipt.handout || receipt.name || receipt.label), at = number(record.turn);
            const label = string(receipt.label || receipt.name || receipt.handout);
            if (!key || !label) continue;
            const known = latest.get(key);
            if (!known || at >= known.at) latest.set(key, { row: { label, turn: record.turn }, at, order });
        }
    });
    return [...latest.values()].sort(newestFirst);
}

/**
 * The `player_knows` section, fitted to its budget: the older of the two lists' last rows gives way first (a person on a tie),
 * and `omitted` counts what each list left out.
 */
export function playerKnowsSection(graph: ModuleGraph, world: Row, journal: Row, records: Row[], turn: number, firstSight: unknown,
    budget = PLAYER_KNOWS_BUDGET): Row {
    const people = knownPeople(graph, world, journal, records, firstSight);
    const documents = deliveredDocuments(records, turn);
    const omitted = { people: 0, documents: 0 };
    const build = (): Row => ({
        use: PLAYER_KNOWS_USE,
        people: people.map(entry => entry.row),
        documents: documents.map(entry => entry.row),
        ...(omitted.people || omitted.documents ? { omitted: { ...omitted } } : {}),
    });
    let section = build();
    while (jsonSize(section) > budget && (people.length || documents.length)) {
        const person = people.at(-1), document = documents.at(-1);
        if (person && (!document || person.at <= document.at)) { people.pop(); omitted.people++; }
        else { documents.pop(); omitted.documents++; }
        section = build();
    }
    return section;
}
