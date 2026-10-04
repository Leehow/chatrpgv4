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
import { bookNames, namePieces, occurs } from '../journal/naming.js';
import { array, integer, normalize, number, row, string, type Row } from './values.js';
import { isJsonObject } from '../json.js';

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

/** The cast reader's file in the module's directory (§177.2). */
export const CAST_FILE = 'cast.json';
/** The native text the cast reader was handed, kept by the kernel so `cast.submit` checks against its own copy. */
export const CAST_SOURCE_FILE = 'cast-source.json';
export const CAST_VERSION = 1;

/** One person of the book (§177.1). */
export interface CastPerson {
    /** The graph handle when the graph has them; else the stored row's opaque id (`cast-<hex>`). */
    id: string;
    /** Every name: the graph's (name, display name, aliases) and the stored rows' book names and play renderings. */
    names: string[];
    /** Physical pages, 1-based. */
    pages: number[];
    node: Row | null;
    /** The stored rows this person absorbed (their epithets, written before the node existed, follow the person). */
    castIds: string[];
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

const memo = new WeakMap<ModuleGraph, CastPerson[]>();
const pagesOf = (graph: ModuleGraph, node: Row): number[] => [...new Set(array(node.source_refs)
    .filter(ref => ref?.source_id === `pdf:${graph.moduleId}` && integer(ref.pdf_index)).map(ref => number(ref.pdf_index) + 1))].sort((a, b) => a - b);

/** The book's cast for this loaded graph (§177.1). */
export function bookCast(graph: ModuleGraph): CastPerson[] {
    const cached = memo.get(graph);
    if (cached) return cached;
    const people: CastPerson[] = graph.kind('npc').filter(node => !graph.isTablePerson(node))
        .map(node => ({ id: graph.handle(node), names: bookNames(graph, node), pages: pagesOf(graph, node), node, castIds: [] }));
    const owners = new Map<string, Set<number>>();
    people.forEach((person, index) => { for (const name of person.names) owners.set(normalize(name), (owners.get(normalize(name)) ?? new Set()).add(index)); });
    const stored = graph.castStore && graph.castStore.state === 'complete' ? array(graph.castStore.people) : [];
    for (const raw of stored) {
        const entry = row(raw), id = text(entry.id);
        const names = [...new Set([...array(entry.book), ...array(entry.play)].map(text).filter(Boolean))];
        if (!id || !names.length) continue;
        const pages = array(entry.pages).filter(page => Number.isSafeInteger(page) && page >= 1);
        const hits = new Set(names.flatMap(name => [...(owners.get(normalize(name)) ?? [])]));
        if (hits.size === 1) {
            const person = people[[...hits][0]!]!;
            for (const name of names) if (!person.names.some(other => normalize(other) === normalize(name))) person.names.push(name);
            person.pages = [...new Set([...person.pages, ...pages])].sort((a, b) => a - b);
            person.castIds.push(id);
            continue;
        }
        // A row two graph people both answer is neither of them for certain; what is left of it is a person nobody carries.
        const own = names.filter(name => !owners.has(normalize(name)));
        if (!own.length) continue;
        const first = isJsonObject(entry.first) && Number.isSafeInteger(entry.first.page) && typeof entry.first.sentence === 'string'
            ? { page: Number(entry.first.page), sentence: entry.first.sentence } : undefined;
        people.push({ id, names: own, pages, node: null, castIds: [id], ...(first ? { first } : {}) });
    }
    memo.set(graph, people);
    return people;
}

/** The people of the cast the graph does not have yet (§177.1): named by the book, not yet reached by the reader. */
export const unreadCast = (graph: ModuleGraph): CastPerson[] => bookCast(graph).filter(person => !person.node);

/** Whether a committed delivery showed one of an unread person's names (the test `toldTurn` makes for a graph person). */
export function castToldTurn(person: CastPerson, records: Iterable<Row>): number | null {
    const words = person.names.map(normalize).filter(Boolean);
    const committed = [...records].filter(record => record.closed_by === 'narrate' && record.commit && integer(record.turn))
        .sort((a, b) => number(a.turn) - number(b.turn));
    for (const record of committed)
        if (words.some(word => occurs(normalize(string(record.rendered_text ?? '')), word))) return number(record.turn);
    return null;
}

/** The unread people the investigator has not been told about. */
export const untoldUnread = (graph: ModuleGraph, records: Row[]): CastPerson[] => unreadCast(graph).filter(person => castToldTurn(person, records) === null);

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
