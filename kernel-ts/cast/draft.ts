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
/** Names one person may carry, book and play together. */
export const CAST_NAMES_PER_PERSON = 16;
/** People one draft may list. */
export const CAST_PEOPLE_LIMIT = 600;
/** The first mention's sentence is cut to this many characters around the name (§11.5.4's `PASSAGE_SENTENCE_CHARS`). */
export const CAST_SENTENCE_CHARS = 300;

/** The reader's page files: one per physical page, `pages/page-0001.txt`. */
export const castPageFile = (page: number): string => `page-${String(page).padStart(4, '0')}.txt`;

/** One accepted row as `cast.json` keeps it. */
export interface CastRowStored { id: string; book: string[]; play: string[]; pages: number[]; first?: { page: number; sentence: string } }
export interface CastRefusal { index: number; reason: string; message: string; fix: string }

const KEYS = ['book', 'play', 'pages'];

/** `text` compacted the way `passageKey` compacts a name, with each kept unit's index in `text`. */
function compacted(text: string): { key: string; at: number[] } {
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
 * Check a draft `{people: [{book, play, pages}]}` against `pages` (1-based page number to its native text). Accepted rows that
 * share a book name are one person (`passageKey` equality, nothing by meaning), merged in the draft's order.
 */
export function checkCastDraft(draft: unknown, pages: ReadonlyMap<number, string>, pageCount: number): { people: CastRowStored[]; refused: CastRefusal[]; error?: string } {
    if (!isJsonObject(draft) || !Array.isArray(draft.people) || Object.keys(draft).some(key => key !== 'people'))
        return { people: [], refused: [], error: 'the draft is {"people": [{"book": [...], "play": [...], "pages": [...]}]} and nothing else' };
    if (draft.people.length > CAST_PEOPLE_LIMIT)
        return { people: [], refused: [], error: `a draft lists at most ${CAST_PEOPLE_LIMIT} people` };
    const accepted: Array<{ book: string[]; play: string[]; pages: number[]; first: { page: number; sentence: string } | null }> = [], refused: CastRefusal[] = [];
    draft.people.forEach((raw: unknown, index: number) => {
        const refuse = (reason: string, message: string, fix: string) => { refused.push({ index, reason, message, fix }); };
        if (!isJsonObject(raw) || Object.keys(raw).some(key => !KEYS.includes(key)))
            return refuse('shape', `people[${index}] must be {"book", "play", "pages"} and nothing else`, 'write the row with exactly those three keys');
        const book = Array.isArray(raw.book) ? raw.book : [], play = Array.isArray(raw.play) ? raw.play : [], cited = Array.isArray(raw.pages) ? raw.pages : [];
        if (!book.length || !book.every(nameShape) || !play.length || !play.every(nameShape) || book.length + play.length > CAST_NAMES_PER_PERSON)
            return refuse('shape', `people[${index}]: book and play are each a non-empty list of names of 2-${CAST_NAME_LIMIT} characters on one line, at most ${CAST_NAMES_PER_PERSON} together`,
                'keep each name as the book prints it in book and as the play language writes it in play');
        if (!cited.length || cited.some((page: unknown) => !Number.isSafeInteger(page) || Number(page) < 1 || Number(page) > pageCount) || new Set(cited).size !== cited.length)
            return refuse('shape', `people[${index}].pages must be distinct physical page numbers from 1 to ${pageCount}`, 'cite the page files you read the names on');
        const names = [...new Set(book.map((name: string) => name.trim()))], renderings = [...new Set(play.map((name: string) => name.trim()))];
        const sorted = [...cited as number[]].sort((a, b) => a - b);
        let first: { page: number; sentence: string } | null = null;
        const missing: string[] = [];
        for (const name of names) {
            let found = false;
            for (const page of sorted) {
                const sentence = sentenceNaming(pages.get(page) ?? '', name);
                if (!sentence) continue;
                found = true;
                if (!first || page < first.page) first = { page, sentence };
                break;
            }
            if (!found) missing.push(name);
        }
        if (missing.length)
            return refuse('not_on_page', `people[${index}]: ${missing.map(name => JSON.stringify(name)).join(', ')} does not stand on any of pages ${sorted.join(', ')} as the text layer has it`,
                `add the page where the book prints ${missing.length > 1 ? 'each of them' : 'it'} to pages, or move a name the book never prints to play`);
        accepted.push({ book: names, play: renderings, pages: sorted, first });
    });
    // One person per shared book name: a later row that shares a book name with an earlier one is folded into it.
    const merged: typeof accepted = [];
    for (const row of accepted) {
        const keys = new Set(row.book.map(name => passageKey(name)));
        const into = merged.find(other => other.book.some(name => keys.has(passageKey(name))));
        if (!into) { merged.push({ ...row, book: [...row.book], play: [...row.play], pages: [...row.pages] }); continue; }
        for (const name of row.book) if (!into.book.some(other => passageKey(other) === passageKey(name))) into.book.push(name);
        for (const name of row.play) if (!into.play.some(other => normalize(other) === normalize(name))) into.play.push(name);
        into.pages = [...new Set([...into.pages, ...row.pages])].sort((a, b) => a - b);
        if (row.first && (!into.first || row.first.page < into.first.page)) into.first = row.first;
    }
    const people = merged.map(row => ({ id: castRowId(row.book), book: row.book.slice(0, CAST_NAMES_PER_PERSON), play: row.play.slice(0, CAST_NAMES_PER_PERSON),
        pages: row.pages, ...(row.first ? { first: row.first } : {}) }));
    return { people, refused };
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
