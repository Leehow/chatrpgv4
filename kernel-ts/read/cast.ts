/**
 * Contract §177 (owner ruling 2026-10-04 on docs/specs/module-cast.md, Q1-Q5 as recommended): the book's cast, one row for
 * every person the book names.
 *
 * Every check that keeps names apart used to read the graph, and a PDF read on demand has in its graph only the people the
 * reader has reached: Blood Road's had 54 at table 23's turn 9. A newcomer could take the name of someone on a page not yet
 * read, and could take a name of someone already read too, because `walk_on` compared whole names only (the probe of
 * 2026-10-04 minted the bare first names of three book people, one of them told, as seven new people; §177 lists them).
 *
 * The cast is the graph's people (never a table person), each with every name the book gives them, plus, for a PDF book,
 * the rows the cast reader wrote (`cast.json`, §177.2), each with the names the book prints and their play-language
 * renderings. A stored row joins the graph person who carries one of its names exactly; a row nobody carries is a person
 * the book names whom the reader has not reached. Nothing here reads what a name means: rows join on equal strings.
 *
 * Creature nodes are not in the cast: a creature node is as often a kind (a deep one) as someone, and a newcomer who is
 * "a deep one" is the book's body already (§136.12).
 */
import type { ModuleGraph } from './module-graph.js';
import { bookNames, namePieces, occurs, toldTurn } from '../journal/naming.js';
import { prepareNameHistory, type TellGuard } from '../journal/name-history.js';
import { array, integer, normalize, number, row, string, type Row } from './values.js';
import { isJsonObject } from '../json.js';
import { join } from 'node:path';

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

/** The cast reader's file in the module's directory (§177.2). */
export const CAST_FILE = 'cast.json';
/** The native text the cast reader was handed, kept by the kernel so `cast.submit` checks against its own copy. */
export const CAST_SOURCE_FILE = 'cast-source.json';
/**
 * 5 since table 28: the reader leaves out real public figures and takes renderings from the notes the game already wrote about
 * its pages (§177.16). 4 since table 27: rows carry `notes`, the names as this game's own notes write them (§177.14). 3 since
 * table 24: versions 1 and 2 folded rows that shared a bare first name into one person.
 */
export const CAST_VERSION = 5;
/** §177.16: the oldest version whose rows still serve the checks while a newer one is read (3: one row per person, no notes). */
export const CAST_READABLE_FROM = 3;
/** §177.16: the table a re-read writes range by range; it replaces `cast.json` only when complete. */
export const CAST_NEXT_FILE = 'cast.next.json';

/** One person of the book (§177.1). */
export interface CastPerson {
    /** The graph handle when the graph has them; else the stored row's opaque id (`cast-<hex>`). */
    id: string;
    /** Every name: the graph's (name, display name, aliases) and the stored rows' book names, play renderings and notes renderings. */
    names: string[];
    /** Physical pages, 1-based. */
    pages: number[];
    node: Row | null;
    /** The stored rows this person absorbed. */
    castIds: string[];
    /** The forms those rows print and render (§177.11): the cast reader lists names of individuals, never a group's description. */
    printed: string[];
    /** A stored row's first mention, cut from the text layer by machine (§177.2). */
    first?: { page: number; sentence: string };
}

/** The digest of the book's bound file: the cast belongs to one file, as a reading does. */
export const moduleSourceSha = (meta: Row): string => text(row(meta.source_document).file_sha256) || text(meta.file_sha256);

/** `cast.json` as written for this book, or null when it is absent, of another version, or of another file. */
export function storedCast(value: unknown, sourceSha: string): Row | null {
    if (!isJsonObject(value) || value.version !== CAST_VERSION || !sourceSha || value.source_sha256 !== sourceSha) return null;
    return value as Row;
}

/** An older version's table of this very file, still read while a newer one is read (§177.16); null otherwise. */
export function olderCast(value: unknown, sourceSha: string): Row | null {
    if (!isJsonObject(value) || !sourceSha || value.source_sha256 !== sourceSha || !Number.isSafeInteger(value.version)) return null;
    const version = Number(value.version);
    return version >= CAST_READABLE_FROM && version < CAST_VERSION && ['complete', 'partial'].includes(string(value.state)) ? value as Row : null;
}

/**
 * §177.16: the table the checks read for a book, from its directories in order (a campaign's fork, then the shared library).
 * The current version's `cast.json` first, from any of them; else an older version's table of the same file, which keeps
 * serving while the new one is read into `cast.next.json` (table 27's upgrade left about five minutes with no unread people in
 * the rename); else that partial new table, which is all a first read has.
 */
export async function readServedCast(snapshots: { pathExists(path: string): Promise<boolean>; readJson(path: string): Promise<unknown> },
    dirs: readonly string[], sourceSha: string): Promise<Row | null> {
    const read = async (path: string): Promise<unknown> => { try { return await snapshots.pathExists(path) ? await snapshots.readJson(path) : null; } catch { return null; } };
    const files = await Promise.all(dirs.map(async dir => ({ current: await read(join(dir, CAST_FILE)), next: await read(join(dir, CAST_NEXT_FILE)) })));
    for (const file of files) { const served = storedCast(file.current, sourceSha); if (served) return served; }
    for (const file of files) { const served = olderCast(file.current, sourceSha); if (served) return served; }
    for (const file of files) { const served = storedCast(file.next, sourceSha); if (served) return served; }
    return null;
}

/**
 * §177.14 (table 28): a row's notes renderings, and their words where the book's own form is in parts. A printed form the
 * punctuation splits (a given name and a surname joined by a middle dot) has its parts as names (`namePieces`), and a
 * rendering with as many words is split the same way: "Russell Williams" for the station owner's two-part Chinese name, so a
 * note that says "Russell" alone is renamed too. A book printed in the notes language splits nothing by spaces ("Silas Marsh"
 * gives no "Silas": the book never printed it alone).
 */
function notesNames(book: readonly string[], notes: readonly string[]): string[] {
    const parts = new Set(book.filter(Boolean).map(form => namePieces([form]).filter(piece => piece !== form).length).filter(count => count > 1));
    return notes.filter(Boolean).flatMap(rendering => {
        const words = rendering.split(/\s+/u).filter(word => [...word].length >= 2);
        return parts.has(words.length) ? [rendering, ...words] : [rendering];
    });
}

const memo = new WeakMap<ModuleGraph, CastPerson[]>();
const pagesOf = (graph: ModuleGraph, node: Row): number[] => [...new Set(array(node.source_refs)
    .filter(ref => ref?.source_id === `pdf:${graph.moduleId}` && integer(ref.pdf_index)).map(ref => number(ref.pdf_index) + 1))].sort((a, b) => a - b);

/** The book's cast for this loaded graph (§177.1). */
export function bookCast(graph: ModuleGraph): CastPerson[] {
    const cached = memo.get(graph);
    if (cached) return cached;
    const people: CastPerson[] = graph.kind('npc').filter(node => !graph.isTablePerson(node))
        .map(node => ({ id: graph.handle(node), names: bookNames(graph, node), pages: pagesOf(graph, node), node, castIds: [] as string[], printed: [] as string[] }));
    // A partial cast (some ranges read, §177.2) is as true as a complete one, only shorter.
    const stored = graph.castStore && ['complete', 'partial'].includes(string(graph.castStore.state)) ? array(graph.castStore.people) : [];
    // A row joins a graph person by a whole identity, never by a shared short form: the person's own name is one of the row's
    // forms, or the row's fullest form is one of the person's names. Table 24: the reader gave the bar owner and the doctor
    // one bare first name, which the bar owner's node also carries as an alias; the doctor's row must not join him by it.
    const fullName = (node: Row) => [node.name, graph.displayName(node)].filter((value): value is string => typeof value === 'string' && !!value.trim()).map(normalize);
    for (const raw of stored) {
        const entry = row(raw), id = text(entry.id);
        // §177.14: the notes renderings are names to hide and to refuse, never forms a delivery is checked for (`printed`).
        const shown = [...new Set([...array(entry.book), ...array(entry.play)].map(text).filter(Boolean))];
        const names = [...new Set([...shown, ...notesNames(array(entry.book).map(text), array(entry.notes).map(text))])];
        if (!id || !names.length) continue;
        const pages = array(entry.pages).filter(page => Number.isSafeInteger(page) && page >= 1);
        const forms = new Set(shown.map(normalize));
        const fullest = [...array(entry.book).map(text).filter(Boolean)].sort((a, b) => [...b].length - [...a].length)[0];
        const hits = new Set(people.flatMap((person, index) => person.node && (fullName(person.node).some(name => forms.has(name))
            || (fullest && person.names.some(name => normalize(name) === normalize(fullest)))) ? [index] : []));
        if (hits.size === 1) {
            const person = people[[...hits][0]!]!;
            for (const name of names) if (!person.names.some(other => normalize(other) === normalize(name))) person.names.push(name);
            for (const name of shown) if (!person.printed.some(other => normalize(other) === normalize(name))) person.printed.push(name);
            person.pages = [...new Set([...person.pages, ...pages])].sort((a, b) => a - b);
            person.castIds.push(id);
            continue;
        }
        // A row no graph person answers by a whole identity (or two do) is someone else, with every name the row gives them:
        // a first name they share with a graph person is shared, and the roster shows it as both their words (§177.4).
        const own = names;
        const first = isJsonObject(entry.first) && Number.isSafeInteger(entry.first.page) && typeof entry.first.sentence === 'string'
            ? { page: Number(entry.first.page), sentence: entry.first.sentence } : undefined;
        people.push({ id, names: own, pages, node: null, castIds: [id], printed: shown, ...(first ? { first } : {}) });
    }
    memo.set(graph, people);
    return people;
}

/**
 * §177.4 and §185.13: the normalized names and punctuation pieces that stay as written wherever untold names are hidden or
 * refused -- every name of the cast people the investigator knows (`known`, the told ones), and every name the
 * investigators at this table are registered under (`graph.investigatorNames`). A name someone known also goes by stays
 * theirs: hiding it would hide them. The one place the request's rename (`untoldRoster`), the delivery gate
 * (`untoldWholeNames`), the word refusals (`untoldPieces`) and the journal's label check read it from.
 */
export function knownNamePieces(graph: ModuleGraph, known: readonly CastPerson[]): Set<string> {
    return new Set(namePieces([...known.flatMap(person => person.names), ...graph.investigatorNames]).map(normalize).filter(Boolean));
}

/**
 * §188.1: the words the investigator's side owns that are not a told person's name, as written, each with the keys of whose
 * word it is: the names the investigators at this table are registered under (`graph.investigatorNames`, the party sheet's
 * `name` and `id`, which `actor` matches), and this table's words for people -- the names of the people the table established,
 * `world.person_labels` (`called.name`, under a handle or a sheet id), the folded epithets (under a handle or a cast row's id)
 * and the journal's labels (under a node id). Read from the strings the kernel holds, never from what they mean.
 */
export function tableWords(graph: ModuleGraph, world: Row, journal: Row): Array<{ word: string; owners: string[] }> {
    const owned = (owners: string[]) => (value: unknown) => ({ word: text(value), owners });
    return [
        ...graph.investigatorNames.map(owned([])),
        ...graph.kind('npc').filter(node => graph.isTablePerson(node))
            .flatMap(node => [node.name, graph.displayName(node)].map(owned([graph.handle(node), string(node.node_id)]))),
        ...Object.entries(row(world.person_labels)).map(([key, record]) => owned([key])(row(record).name)),
        ...Object.entries(row(world.person_epithets)).map(([key, record]) => owned([key])(row(record).word)),
        ...Object.entries(row(journal.entries)).map(([key, entry]) => owned([key])(row(entry).label)),
    ].filter(entry => entry.word);
}

/**
 * §188.1 (told detection): `tableWords`, normalized, as the told checks read them (`NameHistory.says`). Told people's names are
 * not here: whether someone is told is what these checks decide, so the list a told check reads cannot depend on it.
 */
export function tellGuard(graph: ModuleGraph, world: Row, journal: Row): TellGuard {
    const merged = new Map<string, Set<string>>();
    for (const { word, owners } of tableWords(graph, world, journal)) {
        const key = normalize(word);
        if (!key) continue;
        const into = merged.get(key) ?? new Set<string>();
        owners.forEach(owner => into.add(owner));
        merged.set(key, into);
    }
    const words = [...merged.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([word, owners]) => ({ word, owners: [...owners].sort() }));
    return { key: JSON.stringify(words), words };
}

/** §188.1: the cast rows a graph person absorbed, whose words are that person's own. */
export const castIdsOf = (graph: ModuleGraph, node: Row): string[] => bookCast(graph).find(person => person.node === node)?.castIds ?? [];

/**
 * §188.1: every whole name the investigator's side owns, as written: `tableWords`, and every name of a cast person the
 * investigator has been told about. No piece is added: a place of a protected name protects that whole occurrence, and a piece
 * would also shield an untold person's full name that begins with it.
 *
 * Wherever the request's rename (`table.untold`) or the delivery gate (`table.untold_spans`, §177.11) finds an untold name, a
 * place that overlaps an occurrence of one of these is left as written. The §185 acceptance table: the book also prints the
 * untold store owner by the first character of his given name alone, the investigator shares that given name, and the
 * one-character alias was renamed inside the investigator's own name, which the Keeper copied into tool calls and a note.
 */
export function protectedNames(graph: ModuleGraph, world: Row, journal: Row, records: Iterable<Row>): string[] {
    const history = prepareNameHistory(records, tellGuard(graph, world, journal));
    // The told test the roster makes (`untoldBlock`, `untoldUnread`): the journal's `named_at` or a delivery that showed the name.
    const told = (person: CastPerson): boolean => person.node
        ? !!integer(row(row(journal.entries)[string(person.node.node_id)]).named_at) || toldTurn(graph, person.node, history, Infinity, person.castIds) !== null
        : castToldTurn(person, history) !== null;
    const words = [...tableWords(graph, world, journal).map(entry => entry.word), ...bookCast(graph).filter(told).flatMap(person => person.names)];
    return [...new Set(words.map(text).filter(Boolean))];
}

/** The people of the cast the graph does not have yet (§177.1): named by the book, not yet reached by the reader. */
export const unreadCast = (graph: ModuleGraph): CastPerson[] => bookCast(graph).filter(person => !person.node);

/**
 * Whether a committed delivery showed one of an unread person's names (the test `toldTurn` makes for a graph person). §188.1:
 * an occurrence inside an investigator's registered name or another person's word at this table (the history's guard) is not
 * this person's name: the investigator "Daniel White" in the prose tells no unread "Daniel".
 */
export function castToldTurn(person: CastPerson, records: Iterable<Row>): number | null {
    const words = person.names.map(normalize).filter(Boolean);
    const history = prepareNameHistory(records), own = (owner: string) => owner === person.id || person.castIds.includes(owner);
    for (const record of history.castRecords()) {
        const text = history.text(record);
        if (words.some(word => history.says(text, word, own, () => history.shields(record)))) return number(record.turn);
    }
    return null;
}

/** The unread people the investigator has not been told about. */
export const untoldUnread = (graph: ModuleGraph, records: Iterable<Row>): CastPerson[] => {
    const history = prepareNameHistory(records);
    return unreadCast(graph).filter(person => castToldTurn(person, history) === null);
};

/**
 * The unread person a word names (§177.3): one of their names, the word this table calls them (`world.person_epithets`
 * under the row's id), or the row's id; null for none, and null when two answer (the caller then treats it as nobody's).
 */
export function castPersonNamed(graph: ModuleGraph, world: Row, word: string): CastPerson | null {
    const key = normalize(word);
    if (!key) return null;
    const words = (person: CastPerson) => [person.id, ...person.names, text(row(row(world.person_epithets)[person.id]).word)];
    const found = unreadCast(graph).filter(person => words(person).some(value => value && normalize(value) === key));
    return found.length === 1 ? found[0]! : null;
}

/**
 * Why `name` cannot be a newcomer's (§177.3), or null: it is, or carries, a name or a punctuation piece of a name of anyone in
 * the cast (§103.8's pieces), told or not, read or not. The refusal names nobody: for someone untold, saying whose name it is
 * would hand the Keeper the name (§103.8), and for someone told the Keeper already has it.
 */
export function newcomerRefusal(graph: ModuleGraph, world: Row, name: string): { message: string; fix: string } | null {
    const said = normalize(name);
    if (!said) return null;
    const epithets = (person: CastPerson) => [text(row(row(world.person_epithets)[person.id]).word), ...person.castIds.map(id => text(row(row(world.person_epithets)[id]).word))];
    for (const person of bookCast(graph)) {
        // A piece the name writes with a period after it is written as an abbreviation (the "Mr" of "Mr. Dooley", the "Dr" of
        // "Dr. Brenner"), not as a name: read from the punctuation alone, as `namePieces` reads its pieces.
        const abbreviated = new Set(person.names.flatMap(full => [...full.matchAll(/([^\p{P}\s]+)\./gu)].map(match => normalize(match[1]!))));
        const carried = namePieces(person.names).some(piece => !abbreviated.has(normalize(piece)) && occurs(said, normalize(piece)));
        const called = epithets(person).some(word => word && normalize(word) === said);
        if (!carried && !called) continue;
        return {
            message: `${JSON.stringify(name.trim())} ${called ? 'is the word this table already calls one of the book\'s people' : 'carries a name the book gives one of its people'}; walk_on brings in someone the book does not have`,
            fix: 'if you mean someone already here, leave walk_on out and name them by the word present[] shows; a newcomer needs a word that carries nobody\'s name -- what they look like or what they do',
        };
    }
    return null;
}
