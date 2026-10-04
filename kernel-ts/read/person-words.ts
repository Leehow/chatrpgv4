/**
 * Contract §176 (owner ruling 2026-10-04): the word this table calls a book person, from before anyone meets them.
 *
 * Three writers used to give that word, none reliably: the Keeper's `apply person` mid-turn (or never), the journal lane's
 * label guessed from the prose after the turn, and the clerk's meeting, which fell back to the book's name. Table 21 (the
 * installed App, 2026-10-03) showed what that cost: the journal's labels moved between three men, the word the Keeper was
 * shown did not resolve as `who`, and a Keeper with only the handle made up a name from it.
 *
 * Now the epithet lane gives every untold book person a word when they enter the graph. It writes `epithets.json`, its own
 * file, for the reason `first-sight.json` is one (§168.5): a `world.json` write while a turn is open stales that turn's world.
 * At two safe moments (`table.open` with no turn open, and `table.player_input` before the capsule) the kernel folds
 * those words, and for anyone still without one the journal's label, into `world.person_epithets`, which every reader
 * uses. `world.person_labels` stays what the fiction established (§79): its name still marks the person met.
 */
import type { ModuleGraph } from './module-graph.js';
import { array, entries, integer, length, normalize, repr, row, string, type Row } from './values.js';

/** A string field, or '' when absent: `values.string` renders absence as "None". */
const text = (value: unknown): string => typeof value === 'string' ? value : '';
import { bookNames, namePieces, occurs, toldTurn } from '../journal/naming.js';
import type { CampaignWriter } from '../write/store.js';
import { nowIso } from '../write/store.js';

/** The epithet lane's own file (§176.1). */
export const EPITHETS_FILE = 'epithets.json';
/** §40.1's name text: the word is written into spoken lines and say tokens (apply/person.ts `LABEL_LIMIT`). */
export const WORD_LIMIT = 60;
/** The epithets one job asks for (§176.3); the next job asks for the rest. */
export const EPITHETS_PER_JOB = 24;

const labelOf = (world: Row, handle: string): string => text(row(row(world.person_labels)[handle]).name).trim();
/** The folded epithet for a person: `{word, by}`, `by` being `graph` or `journal` (§176.1). */
export const epithetRecord = (world: Row, handle: string): Row => row(row(world.person_epithets)[handle]);

/** The word this table calls a book person (§176.1): what the fiction established, else their epithet, else ''. */
export function tableWord(world: Row, handle: string): string {
    return labelOf(world, handle) || text(epithetRecord(world, handle).word).trim();
}

/**
 * Whether the investigator has been told this person's name (§103): the journal's `named_at`, or a committed delivery that
 * showed it. The same test `untoldBlock` makes.
 */
export function isTold(graph: ModuleGraph, journal: Row, node: Row, records: Row[] = []): boolean {
    const entry = row(row(journal.entries)[string(node.node_id)]);
    return !!integer(entry.named_at) || toldTurn(graph, node, records) !== null;
}

/** The book people a word may be given to: npc nodes the book has (never a table person), untold. */
export function untoldBookPeople(graph: ModuleGraph, journal: Row, records: Row[]): Row[] {
    return graph.kind('npc').filter(node => !graph.isTablePerson(node) && !isTold(graph, journal, node, records));
}

/**
 * Every normalized book name, alias and punctuation piece of anyone untold, minus what a told person also carries (the
 * roster's rule, §103.8): saying a told person's surname tells nothing. Read from the names alone, never from meaning.
 */
export function untoldPieces(graph: ModuleGraph, journal: Row, records: Row[]): string[] {
    const untold = new Set(untoldBookPeople(graph, journal, records).map(node => string(node.node_id)));
    const told = graph.kind('npc').filter(node => !graph.isTablePerson(node) && !untold.has(string(node.node_id)));
    const known = new Set(namePieces(told.flatMap(node => bookNames(graph, node))).map(normalize));
    return [...new Set(namePieces(graph.kind('npc').filter(node => untold.has(string(node.node_id))).flatMap(node => bookNames(graph, node)))
        .map(normalize).filter(piece => piece && !known.has(piece)))];
}

/** Every word already in use for someone other than `handle`: table words, folded epithets, stored epithets, journal labels. */
export function wordsInUse(world: Row, journal: Row, stored: Row, graph: ModuleGraph, except = ''): string[] {
    const handles = new Set<string>([...Object.keys(row(world.person_labels)), ...Object.keys(row(world.person_epithets)), ...Object.keys(row(stored.people))]);
    const words = [...handles].filter(handle => handle !== except).flatMap(handle => [tableWord(world, handle), text(row(row(stored.people)[handle]).word)]);
    for (const [id, entry] of entries(row(journal.entries))) {
        const node = graph.nodes.get(id);
        if (node && graph.handle(node) === except) continue;
        if (!integer(row(entry).named_at)) words.push(text(row(entry).label));
    }
    return [...new Set(words.map(word => word.trim()).filter(Boolean))];
}

/** Why `word` cannot be this table's word for `handle` (§176.3), or null. The reasons are the closed set the contract lists. */
export function wordRefusal(graph: ModuleGraph, word: unknown, pieces: readonly string[], taken: readonly string[]): { reason: string; message: string } | null {
    if (typeof word !== 'string' || !word.trim() || length(word.trim()) > WORD_LIMIT || word.includes('\n') || word.includes('{{'))
        return { reason: 'shape', message: `the word must be one line of 1-${WORD_LIMIT} characters and carry no marker` };
    const said = normalize(word.trim());
    if (graph.kind('npc').some(node => !graph.isTablePerson(node) && (graph.handle(node) === word.trim() || string(node.node_id) === word.trim())))
        return { reason: 'handle', message: `${repr(word.trim())} is a handle, not a word anyone is called` };
    if (pieces.some(piece => occurs(said, piece)))
        return { reason: 'untold_name', message: `${repr(word.trim())} carries a name, a nickname or a piece of a name of someone the investigator has not been told about` };
    if (taken.some(other => normalize(other) === said))
        return { reason: 'taken', message: `${repr(word.trim())} is already what this table calls someone else` };
    return null;
}

async function readStored(campaign: CampaignWriter): Promise<Row> {
    if (!await campaign.context.snapshots.pathExists(campaign.path(EPITHETS_FILE))) return { people: {} };
    try { return { people: row(row(await campaign.read(EPITHETS_FILE)).people) }; }
    catch { return { people: {} }; }
}
export { readStored as readEpithets };

/**
 * Fold the lane's epithets and, for an untold person with neither a table word nor an epithet, the journal's label into
 * `world.person_epithets` (§176.1, §176.4). A graph epithet replaces a journal one; a journal label never replaces a graph
 * epithet. Returns whether the world changed; the caller writes it.
 */
export async function foldPersonWords(campaign: CampaignWriter, graph: ModuleGraph, world: Row, journal: Row, records: Row[]): Promise<boolean> {
    const stored = await readStored(campaign);
    let changed = false;
    for (const node of untoldBookPeople(graph, journal, records)) {
        const handle = graph.handle(node);
        if (labelOf(world, handle)) continue;
        const current = epithetRecord(world, handle), graphWord = text(row(row(stored.people)[handle]).word).trim();
        const journalWord = text(row(row(journal.entries)[string(node.node_id)]).label).trim();
        const next = graphWord ? { word: graphWord, by: 'graph' } : journalWord && text(current.by) !== 'graph' ? { word: journalWord, by: 'journal' } : null;
        if (!next || (text(current.word) === next.word && text(current.by) === next.by)) continue;
        (world.person_epithets ??= {})[handle] = { ...next, at: nowIso() };
        changed = true;
    }
    return changed;
}

/** One `epithets.submit` entry checked and, when accepted, written to `epithets.json` (§176.3). */
export async function submitEpithets(campaign: CampaignWriter, graph: ModuleGraph, world: Row, journal: Row, records: Row[], entriesIn: unknown): Promise<Row> {
    const stored = await readStored(campaign), pieces = untoldPieces(graph, journal, records);
    const untold = new Set(untoldBookPeople(graph, journal, records).map(node => graph.handle(node)));
    const written: Row[] = [], refused: Row[] = [], batch: string[] = [];
    for (const raw of array(entriesIn)) {
        const entry = row(raw), id = text(entry.id).trim(), word = entry.word;
        const node = id ? graph.find(id, ['npc']) : null;
        const refuse = (reason: string, message: string) => refused.push({ id, word: typeof word === 'string' ? word : null, reason, message });
        if (!node || graph.isTablePerson(node)) { refuse('unknown_entity', `${repr(id)} is no book person of this campaign's graph`); continue; }
        const handle = graph.handle(node);
        if (!untold.has(handle) || labelOf(world, handle) || text(row(row(stored.people)[handle]).word)) { refuse('settled', `${repr(id)} is told or already has a word`); continue; }
        const why = wordRefusal(graph, word, pieces, [...wordsInUse(world, journal, stored, graph, handle), ...batch]);
        if (why) { refuse(why.reason, why.message); continue; }
        const accepted = text(word).trim();
        (stored.people as Row)[handle] = { word: accepted, at: nowIso() };
        batch.push(accepted);
        written.push({ id: handle, word: accepted });
    }
    if (written.length) await campaign.write(EPITHETS_FILE, stored);
    return { written, refused };
}
