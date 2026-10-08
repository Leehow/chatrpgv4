/**
 * Contract §177.2: the cast reader's draft, checked against the book's own text.
 *
 * The reader says which strings are a person's names (an LLM judgment); this module only checks strings it holds: each name
 * the reader says the book uses must stand on one of the pages it cites, as the book's native text layer has it. Nothing here
 * decides what a name is or means. The kernel's `cast.submit` and the reader's own `coc-read-check --kind module-cast` run
 * this same function, the second against the copy of the text the reader was handed, the first against the kernel's own.
 *
 * A row that fails is refused alone, naming what to add (§90.3); the others stand.
 */
import { createHash } from 'node:crypto';
import { passageKey } from '../read/table-people.js';
import { isJsonObject } from '../json.js';
import { normalize, type Row } from '../read/values.js';

/** The longest name, as §40.1's name text is (`WORD_LIMIT`). */
export const CAST_NAME_LIMIT = 60;
/** Names one person may carry, book, play and notes together. */
export const CAST_NAMES_PER_PERSON = 24;
/** People one draft may list. */
export const CAST_PEOPLE_LIMIT = 600;
/** The first mention's sentence is cut to this many characters around the name (§11.5.4's `PASSAGE_SENTENCE_CHARS`). */
export const CAST_SENTENCE_CHARS = 300;

/** The reader's page files: one per physical page, `pages/page-0001.txt`. */
export const castPageFile = (page: number): string => `page-${String(page).padStart(4, '0')}.txt`;

/** One accepted row as `cast.json` keeps it. */
export interface CastRowStored { id: string; book: string[]; play: string[]; notes: string[]; pages: number[]; first?: { page: number; sentence: string } }
export interface CastRefusal { index: number; reason: string; message: string; fix: string }

const KEYS = ['book', 'play', 'notes', 'pages'];

/** `text` compacted the way `passageKey` compacts a name, with each kept unit's index in `text`. */
export function compacted(text: string): { key: string; at: number[] } {
    let key = '';
    const at: number[] = [];
    let index = 0;
    for (const char of text) {
        for (const unit of passageKey(char)) { key += unit; at.push(index); }
        index += char.length;
    }
    return { key, at };
}

/** The sentence of `source` that holds `[start, end)`, whitespace collapsed, cut around the match when long (§11.5.4's rule). */
function sentenceAround(source: string, start: number, end: number): string {
    const text = source.replace(/[\r\n]/gu, ' ');
    let from = 0, to = text.length;
    try {
        for (const { index, segment } of new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(text)) {
            const stop = index + segment.length;
            if (index <= start && start < stop) from = index;
            if (index < end && end <= stop) { to = stop; break; }
        }
    } catch { /* no segmenter: the window below still holds the name */ }
    if (to - from > CAST_SENTENCE_CHARS) {
        const room = Math.max(0, CAST_SENTENCE_CHARS - (end - start)), before = Math.floor(room / 2);
        from = Math.max(from, start - before);
        to = Math.min(to, from + Math.max(CAST_SENTENCE_CHARS, end - from));
    }
    return text.slice(from, to).replace(/\s+/gu, ' ').trim();
}

/** Where `name` stands in `text` under `passageKey`, as the sentence that holds it; null when it does not. */
export function sentenceNaming(text: string, name: string): string | null {
    const wanted = passageKey(name);
    if ([...wanted].length < 2) return null;
    const { key, at } = compacted(text);
    const found = key.indexOf(wanted);
    if (found < 0) return null;
    const start = at[found]!, last = at[found + wanted.length - 1]!;
    const end = last + (text.codePointAt(last)! > 0xffff ? 2 : 1);
    return sentenceAround(text, start, end);
}

/** The row's opaque id: no slug of a name (a handle is the book's name as a slug, §176.5), only a digest of them. */
export function castRowId(book: readonly string[]): string {
    const key = [...new Set(book.map(name => passageKey(name)))].sort().join('\n');
    return 'cast-' + createHash('sha256').update(key).digest('hex').slice(0, 10);
}

const nameShape = (value: unknown): value is string => typeof value === 'string' && !!value.trim() && [...value.trim()].length <= CAST_NAME_LIMIT
    && !value.includes('\n') && !value.includes('{{') && [...passageKey(value)].length >= 2;

/**
 * Check a draft `{people: [{book, play, notes, pages}]}` against `pages` (1-based page number to its native text). Accepted rows that
 * share a book name are one person (`passageKey` equality, nothing by meaning), merged in the draft's order.
 */
export interface CastCheckScope {
    /** The pages this reader was handed: a cited page outside them is refused. */
    range?: { first: number; last: number };
    /** `passageKey` of printed forms earlier ranges already accepted: such a form needs no page here (the person is known). */
    known?: ReadonlySet<string>;
}
export function checkCastDraft(draft: unknown, pages: ReadonlyMap<number, string>, pageCount: number, scope: CastCheckScope = {}): { people: CastRowStored[]; refused: CastRefusal[]; error?: string } {
    if (!isJsonObject(draft) || !Array.isArray(draft.people) || Object.keys(draft).some(key => key !== 'people'))
        return { people: [], refused: [], error: 'the draft is {"people": [{"book": [...], "play": [...], "notes": [...], "pages": [...]}]} and nothing else' };
    if (draft.people.length > CAST_PEOPLE_LIMIT)
        return { people: [], refused: [], error: `a draft lists at most ${CAST_PEOPLE_LIMIT} people` };
    const accepted: Array<{ book: string[]; play: string[]; notes: string[]; pages: number[]; first: { page: number; sentence: string } | null }> = [], refused: CastRefusal[] = [];
    draft.people.forEach((raw: unknown, index: number) => {
        const refuse = (reason: string, message: string, fix: string) => { refused.push({ index, reason, message, fix }); };
        if (!isJsonObject(raw) || Object.keys(raw).some(key => !KEYS.includes(key)))
            return refuse('shape', `people[${index}] must be {"book", "play", "notes", "pages"} and nothing else`, 'write the row with exactly those four keys');
        const book = Array.isArray(raw.book) ? raw.book : [], play = Array.isArray(raw.play) ? raw.play : [], notes = Array.isArray(raw.notes) ? raw.notes : [];
        const cited = Array.isArray(raw.pages) ? raw.pages : [];
        if (!book.length || !book.every(nameShape) || !play.length || !play.every(nameShape) || !notes.length || !notes.every(nameShape)
            || book.length + play.length + notes.length > CAST_NAMES_PER_PERSON)
            return refuse('shape', `people[${index}]: book, play and notes are each a non-empty list of names of 2-${CAST_NAME_LIMIT} characters on one line, at most ${CAST_NAMES_PER_PERSON} together`,
                'keep each name as the book prints it in book, as the play language writes it in play, and as these instructions\' language writes it in notes');
        const first = scope.range?.first ?? 1, last = scope.range?.last ?? pageCount;
        if (!cited.length || cited.some((page: unknown) => !Number.isSafeInteger(page) || Number(page) < first || Number(page) > last) || new Set(cited).size !== cited.length)
            return refuse('shape', `people[${index}].pages must be distinct physical page numbers from ${first} to ${last}`, 'cite only the page files you were given, and each once');
        const names = [...new Set(book.map((name: string) => name.trim()))], renderings = [...new Set(play.map((name: string) => name.trim()))];
        const noted = [...new Set(notes.map((name: string) => name.trim()))];
        const sorted = [...cited as number[]].sort((a, b) => a - b);
        let firstSeen: { page: number; sentence: string } | null = null;
        const missing: string[] = [];
        const fresh = names.filter(name => !scope.known?.has(passageKey(name)));
        if (!fresh.length && !names.some(name => sorted.some(page => sentenceNaming(pages.get(page) ?? '', name))))
            return refuse('not_on_page', `people[${index}]: none of its names stands on pages ${sorted.join(', ')}`, 'cite a page you were given that prints one of the names');
        for (const name of fresh) {
            let found = false;
            for (const page of sorted) {
                const sentence = sentenceNaming(pages.get(page) ?? '', name);
                if (!sentence) continue;
                found = true;
                if (!firstSeen || page < firstSeen.page) firstSeen = { page, sentence };
                break;
            }
            if (!found) missing.push(name);
        }
        if (missing.length)
            return refuse('not_on_page', `people[${index}]: ${missing.map(name => JSON.stringify(name)).join(', ')} does not stand on any of pages ${sorted.join(', ')} as the text layer has it`,
                `add the page where the book prints ${missing.length > 1 ? 'each of them' : 'it'} to pages, or move a name the book never prints to play or notes`);
        if (!firstSeen) for (const name of names) for (const page of sorted) {
            const sentence = sentenceNaming(pages.get(page) ?? '', name);
            if (sentence && (!firstSeen || page < firstSeen.page)) firstSeen = { page, sentence };
        }
        accepted.push({ book: names, play: renderings, notes: noted, pages: sorted, first: firstSeen });
    });
    // One row is one person, as the reader wrote it: two rows that share a printed form are two people who share it (table
    // 24: the reader gave a bare first name to the bar owner and to the doctor, and folding on it made them one person).
    const ids = new Set<string>();
    const people = accepted.map(row => {
        let id = castRowId(row.book);
        for (let n = 2; ids.has(id); n++) id = `${castRowId(row.book)}-${n}`;
        ids.add(id);
        return { id, book: row.book.slice(0, CAST_NAMES_PER_PERSON), play: row.play.slice(0, CAST_NAMES_PER_PERSON), notes: row.notes.slice(0, CAST_NAMES_PER_PERSON), pages: row.pages, ...(row.first ? { first: row.first } : {}) };
    });
    return { people, refused };
}

/**
 * Fold a range's accepted rows into the rows earlier ranges kept (§177.2), by a whole identity only: a kept row's fullest
 * printed form is one of the new row's forms, or the new row's fullest form is one of the kept row's, and exactly one kept
 * row answers. The joined row keeps the kept row's id, so a word the epithet lane gave under it stays theirs. Rows of the same
 * range never join each other (the reader wrote one row per individual), and a shared short form joins nobody: table 24's
 * reader gave the bar owner and the doctor one bare first name. Nothing joins by meaning.
 */
export function mergeCastRows(stored: readonly CastRowStored[], incoming: readonly CastRowStored[]): CastRowStored[] {
    const kept = stored.map(row => ({ ...row, book: [...row.book], play: [...row.play], notes: [...row.notes], pages: [...row.pages] }));
    const out = [...kept];
    const fullest = (row: CastRowStored) => [...row.book].sort((a, b) => [...b].length - [...a].length)[0] ?? '';
    const carries = (row: CastRowStored, name: string) => row.book.some(other => passageKey(other) === passageKey(name));
    const ids = new Set(out.map(row => row.id));
    for (const row of incoming) {
        const answers = kept.filter(other => carries(row, fullest(other)) || carries(other, fullest(row)));
        const into = answers.length === 1 ? answers[0]! : null;
        if (!into) {
            let id = row.id;
            for (let n = 2; ids.has(id); n++) id = `${row.id}-${n}`;
            ids.add(id);
            out.push({ ...row, id, book: [...row.book], play: [...row.play], notes: [...row.notes], pages: [...row.pages] });
            continue;
        }
        const room = () => into.book.length + into.play.length + into.notes.length < CAST_NAMES_PER_PERSON;
        for (const name of row.book) if (room() && !carries(into, name)) into.book.push(name);
        for (const name of row.play) if (room() && !into.play.some(other => normalize(other) === normalize(name))) into.play.push(name);
        for (const name of row.notes) if (room() && !into.notes.some(other => normalize(other) === normalize(name))) into.notes.push(name);
        into.pages = [...new Set([...into.pages, ...row.pages])].sort((a, b) => a - b);
        if (row.first && (!into.first || row.first.page < into.first.page)) into.first = row.first;
    }
    return out;
}

/** The pages `{page, text}` rows as the map `checkCastDraft` reads. */
export function pageTexts(rows: unknown): Map<number, string> {
    const out = new Map<number, string>();
    for (const value of Array.isArray(rows) ? rows : []) {
        const entry = isJsonObject(value) ? value as Row : null;
        if (entry && Number.isSafeInteger(entry.page) && typeof entry.text === 'string') out.set(Number(entry.page), entry.text);
    }
    return out;
}

/** §177.16: at most this many bytes of the notes in use go to one range's reader, a guard only: the final package's copy of
 *  Blood Road had 32 477 bytes in range 1-40, and 16 000 sent 178 of its 397 sentences. */
export const CAST_NOTES_IN_USE_BYTES = 96_000;
/** The graph's fields the page reader writes in the language of its instructions (content/setup/visual-reader.md). */
const NOTE_FIELDS = new Set(['question', 'reason', 'trigger', 'book']);

/**
 * §177.16: the sentences the game's own notes wrote about pages `first`..`last`: the graph's `question`, `reason`, `trigger` and
 * `book` strings whose nearest `source_refs` cite a page of the range, once each, in page order, within `limit` bytes. Table 28:
 * the reader's `source_needs` called the station owner "Lars", a rendering the cast's own notes ("Russ") did not hold.
 */
export function notesInUse(graph: unknown, first: number, last: number, limit = CAST_NOTES_IN_USE_BYTES): string[] {
    const found: Array<{ page: number; text: string }> = [];
    const pagesOf = (value: Row): number[] => (Array.isArray(value.source_refs) ? value.source_refs : [])
        .flatMap(ref => isJsonObject(ref) && Number.isSafeInteger(ref.pdf_index) ? [Number(ref.pdf_index) + 1] : []);
    const walk = (value: unknown, cited: number[]): void => {
        if (Array.isArray(value)) { for (const item of value) walk(item, cited); return; }
        if (!isJsonObject(value)) return;
        const own = pagesOf(value), pages = own.length ? own : cited;
        for (const [key, item] of Object.entries(value)) {
            if (NOTE_FIELDS.has(key) && typeof item === 'string' && item.trim()) {
                const page = pages.filter(at => at >= first && at <= last).sort((a, b) => a - b)[0];
                if (page !== undefined) found.push({ page, text: item.trim() });
            } else walk(item, pages);
        }
    };
    walk(graph, []);
    const out: string[] = [], seen = new Set<string>();
    let bytes = 0;
    for (const { text } of found.sort((a, b) => a.page - b.page)) {
        if (seen.has(text)) continue;
        const size = Buffer.byteLength(text, 'utf8');
        if (bytes + size > limit) break;
        seen.add(text); out.push(text); bytes += size;
    }
    return out;
}
