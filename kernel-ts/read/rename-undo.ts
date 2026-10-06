/**
 * Contract §185.3 (owner ruling 2026-10-06, docs/specs/name-free-handles.md): in a legacy campaign a reference that does
 * not resolve as written is read once more with the request's rename undone.
 *
 * A legacy handle is the book's name as a slug, and §176.5's rename replaced it with the person's word wherever it stood
 * in the Keeper's request -- inside every handle it begins as well (`<word>-home`), and inside the node id. What the
 * Keeper copies back is that renamed string. The rows here are the rename's handle rows read the other way: each book
 * person's word, beside their handle and node id. The retry itself lives where references are resolved
 * (`ModuleGraph.resolve`), after every other path has missed.
 *
 * The word is the one `untoldRoster` shows for them (`tableWord`). Every book person who has one has a row, told or not:
 * `ModuleGraph.resolve` is synchronous, and the roster's untold test reads the journal and the whole turn history, which
 * a campaign load does not. A told person's handle is never renamed, so their word inside a reference is nothing to undo;
 * the retry runs only on a miss and keeps a spelling only when it resolves, so the wider set can only turn a refusal
 * into that person's own handle. A word two people carry has no row: which of them it stood for is not knowable here.
 */
import { join } from "node:path";
import type { KernelContext } from "../context.js";
import type { ModuleGraph, RenameUndoRow } from "./module-graph.js";
import { handleScheme } from "./node-handles.js";
import { tableWord } from "./person-words.js";
import { row, string } from "./values.js";
import type { Row } from "./values.js";

/** Each book person's word beside their handle and node id, for every word exactly one person carries. */
export function renameUndoRows(graph: ModuleGraph, world: Row): RenameUndoRow[] {
    const rows = graph.kind("npc").filter(node => !graph.isTablePerson(node)).flatMap(node => {
        const handle = graph.handle(node), shown = tableWord(world, handle);
        return shown && shown !== handle ? [{ shown, names: [handle, string(node.node_id)] }] : [];
    });
    return rows.filter(entry => rows.filter(other => other.shown === entry.shown).length === 1);
}

/**
 * Install the rows on a campaign's loaded graph. §185.1: a campaign whose `campaign.json` does not say `handles:
 * "name-free"` is legacy, and so is one whose file is not written yet; a name-free campaign's request renames names only.
 */
export async function installRenameUndo(context: KernelContext, campaign: string, graph: ModuleGraph, world: Row): Promise<void> {
    const file = join(context.campaignsRoot, campaign, "campaign.json");
    const meta = await context.snapshots.isFile(file) ? row(await context.snapshots.readJson(file)) : {};
    graph.renameUndo = handleScheme(meta) === "name-free" ? [] : renameUndoRows(graph, world);
}
