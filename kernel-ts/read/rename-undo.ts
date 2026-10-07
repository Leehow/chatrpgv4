/**
 * Contract §188.3 (amends §185.3; owner ruling 2026-10-06, docs/specs/names-in-the-request-rename.md): a reference that does
 * not resolve as written is read once more with the request's rename undone, in name-free and legacy campaigns alike.
 *
 * The request's rename (§103.5, `table.untold` from `untoldRoster`) puts a word where a book name stood -- a person's word for
 * their names, aliases, punctuation pieces and one-character aliases, and in a legacy campaign for their handle and node id
 * (a legacy handle is the book's name as a slug, so it stands inside every handle it begins: `<word>-home`); a name several
 * people carry is shown as all their words joined (§177.4). What the Keeper copies back is that renamed string. The rows here
 * are the roster's rows read the other way, and the retry lives where references are resolved (`ModuleGraph.resolve`), after
 * every other path has missed.
 *
 * The rows are built over-inclusively, every book person treated as untold: `resolve` is synchronous, and the roster's untold
 * test reads the whole turn history, which a campaign load does not. A told person's names are never renamed, so their word
 * inside a reference is nothing to undo; the retry runs only on a miss and keeps a spelling only when it resolves, so the
 * wider set can only turn a refusal into a node the word stands for. A name several people share is renamed only while
 * every one of them is untold (one told owner makes it a known name), and then it is shown by all their words: the joined
 * words built here are the request's. Only the investigators' own names stay out, as they do in the roster (§185.13).
 */
import { join } from "node:path";
import type { KernelContext } from "../context.js";
import type { ModuleGraph, RenameUndoRow } from "./module-graph.js";
import { bookCast, knownNamePieces } from "./cast.js";
import { calledOwners, rosterNames, rosterWord } from "./capsule.js";
import { row, string } from "./values.js";
import type { Row } from "./values.js";

/** The rows and the words: every word the roster can show beside what it stood for, and each book person's word by node id. */
export function renameUndoRows(graph: ModuleGraph, world: Row, journal: Row): { rows: RenameUndoRow[]; words: Map<string, string> } {
    const cast = bookCast(graph), people = cast.map(person => ({ person, shown: rosterWord(graph, world, journal, person) }));
    const byId = new Map(cast.map(person => [person.id, person]));
    const names = new Map<string, string[]>();
    const add = (shown: string, values: readonly string[]) => {
        const list = names.get(shown) ?? [];
        for (const value of values) if (value && value !== shown && !list.includes(value)) list.push(value);
        names.set(shown, list);
    };
    const entries = rosterNames(graph, people, knownNamePieces(graph, []));
    for (const entry of entries) add(entry.shown.join(" / "), [entry.name]);
    // §188.3: a joined word stood for a name its owners share, which is often a piece no node answers to by itself (a first
    // name); it stands for one of those owners, so after the shared names each owner's own names are tried. All of them
    // naming one node resolve to it; two nodes are the ambiguity the refusal names.
    for (const entry of entries)
        if (entry.ids.length > 1)
            add(entry.shown.join(" / "), entry.ids.flatMap(id => byId.get(id)?.names ?? []));
    const rows = [...names].filter(([shown, values]) => shown && values.length)
        .map(([shown, values]) => ({ shown, names: values, ...(calledOwners(world, shown).length ? { called: true } : {}) }));
    const words = new Map(people.flatMap(({ person, shown }) => person.node ? [[string(person.node.node_id), shown] as [string, string]] : []));
    return { rows, words };
}

/**
 * §188.2: each node of an individual the graph holds more than once, by node id, to the node that stands for them: their
 * first node (`CastPerson.node`), whose word the roster shows first (`rosterWord`). Since §191.3 this is the cast's fold, one
 * source of the graph's survivor map (`ModuleGraph.castFold`); a person whose copies an identity relation joins is one cast
 * person already, with the survivor as their first node.
 */
export function individualNodes(graph: ModuleGraph): Map<string, string> {
    return new Map(bookCast(graph).filter(person => person.node && person.nodes.length > 1)
        .flatMap(person => person.nodes.map(node => [string(node.node_id), string(person.node!.node_id)] as [string, string])));
}

/**
 * Install the rows on a campaign's loaded graph, in both schemes (§188.3). The roster shows a graph person by the journal's
 * label until the label is folded into the world (§176.4), so the journal is read beside the world. Handle rows come only
 * where the roster makes them, a legacy campaign: a name-free graph's handles carry no name and are never renamed (§185.7).
 * Called after the investigators' names are installed, which the roster leaves out (§185.13).
 */
export async function installRenameUndo(context: KernelContext, campaign: string, graph: ModuleGraph, world: Row): Promise<void> {
    const file = join(context.campaignsRoot, campaign, "npc-journal.json");
    const journal = await context.snapshots.isFile(file) ? row(await context.snapshots.readJson(file)) : {};
    const { rows, words } = renameUndoRows(graph, world, journal);
    graph.renameUndo = rows;
    graph.shownWords = words;
    graph.castFold = individualNodes(graph);
}
