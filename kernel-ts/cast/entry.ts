/**
 * Contract §194.4: what the epithet lane reads of someone the reader has not reached is their own entry on the page that first
 * names them -- from their printed name to where the next printed name of another cast person starts, or the paragraph's end,
 * in the page's reading text.
 *
 * Real table TR-F (Cold Harvest, page 10): the settlement record is a list of residents with no sentence ends, so the stored
 * first mention (§177.2's `first.sentence`, cut by the sentence segmenter and then to a 300-character window) held six to eight
 * residents each. The lane gave Dimiri Kravchuk (46, stonemason, fled) "the forty-nine-year-old electrician -sky", his neighbour's age and trade.
 *
 * Identity matching only: the names are the ones the cast already holds, compared as §177.2 compares them (`passageKey`, so a
 * name the text layer spaces out letter by letter still stands there). Nothing here reads what a word means.
 *
 * Computed when `epithets.job` asks, from the text the kernel keeps for the cast (`cast-source.json`) and the page transcript
 * (§191), so `cast.json` is not read again for it: `first.sentence` stays as stored and is only the last fallback.
 */
import { join } from 'node:path';
import type { KernelContext } from '../context.js';
import type { CastPerson } from '../read/cast.js';
import { CAST_SOURCE_FILE } from '../read/cast.js';
import type { ModuleGraph } from '../read/module-graph.js';
import { pageTranscript } from '../read/page-transcripts.js';
import { passageKey } from '../read/table-people.js';
import { row, string, type Row } from '../read/values.js';
import { scopedModuleRoot } from '../modules/campaign-scope.js';
import { CAST_SENTENCE_CHARS, compacted, pageTexts } from './draft.js';

/** A blank line: where a paragraph ends in a page's text (§191.3 separates a transcript's blocks by one). */
const PARAGRAPH_END = /\n[^\S\n]*\n/u;

/**
 * The entry of the person whose printed names are `own` in `text`: from the first place one of them stands to the start of the
 * next place a name of someone else (`others`, one list per person) stands, or the paragraph's end, whitespace collapsed and at
 * most `CAST_SENTENCE_CHARS` characters; null when none of `own` stands in `text`.
 *
 * Places are found longest name first and never overlap, so a short form inside a longer name of someone else is not a place
 * of its own (Cold Harvest prints two Andreis: the bare given name is one man's short form and opens the other's full name).
 */
export function castEntry(text: string, own: readonly string[], others: ReadonlyArray<readonly string[]>): string | null {
    const { key, at } = compacted(text);
    const forms = [...own.map(name => ({ owner: 0, key: passageKey(name) })),
        ...others.flatMap((names, index) => names.map(name => ({ owner: index + 1, key: passageKey(name) })))]
        .filter(form => [...form.key].length >= 2).sort((a, b) => b.key.length - a.key.length);
    const places: Array<{ owner: number; start: number; end: number }> = [];
    for (const form of forms) {
        for (let from = key.indexOf(form.key); from >= 0; from = key.indexOf(form.key, from + 1)) {
            const place = { owner: form.owner, start: from, end: from + form.key.length };
            if (!places.some(other => place.start < other.end && other.start < place.end)) places.push(place);
        }
    }
    places.sort((a, b) => a.start - b.start);
    const mine = places.find(place => place.owner === 0);
    if (!mine) return null;
    const next = places.find(place => place.owner !== 0 && place.start >= mine.end);
    const start = at[mine.start]!, last = at[mine.end - 1]!, nameEnd = last + (text.codePointAt(last)! > 0xffff ? 2 : 1);
    let end = next ? at[next.start]! : text.length;
    const paragraph = PARAGRAPH_END.exec(text.slice(nameEnd));
    if (paragraph) end = Math.min(end, nameEnd + paragraph.index);
    const entry = text.slice(start, end).replace(/\s+/gu, ' ').trim();
    const points = [...entry];
    return points.length > CAST_SENTENCE_CHARS ? points.slice(0, CAST_SENTENCE_CHARS).join('').trimEnd() : entry;
}

/** The names that stand for `person` on a page: the forms the cast reader printed, and each graph node's own whole names. */
export function printedNames(graph: ModuleGraph, person: CastPerson): string[] {
    return [...new Set([...person.printed, ...person.nodes.flatMap(node => [string(node.name), graph.displayName(node)])]
        .map(name => name.trim()).filter(Boolean))];
}

/**
 * The reading text of the book's pages, as `epithets.job` reads them: the page transcript's `text` where the host stored one
 * (§191.4), else the text the kernel keeps for the cast (`cast-source.json`, §177.2: the host sent the transcript's reading
 * version for a page transcribed by then, the native text otherwise). The cast's own copy is read once, from the directories
 * the cast is served from (the campaign's fork, then the shared library).
 */
export async function castPages(context: KernelContext, campaign: string, moduleId: string, sourceSha: string): Promise<(page: number) => Promise<string[]>> {
    let dirs: string[] = [join(context.stateRoot, 'modules', moduleId)];
    try {
        const scoped = await scopedModuleRoot(context, campaign, moduleId);
        if (scoped) dirs = [join(scoped, moduleId), ...dirs];
    } catch { /* a damaged scope is the loader's to report; the library's copy still serves */ }
    let kept: Map<number, string> | null | undefined;
    const keptCopy = async (): Promise<Map<number, string>> => {
        if (kept === undefined) {
            kept = null;
            for (const dir of dirs) {
                try {
                    const path = join(dir, CAST_SOURCE_FILE);
                    if (!await context.snapshots.pathExists(path)) continue;
                    const value = row(await context.snapshots.readJson(path) as Row);
                    if (value.source_sha256 === sourceSha) { kept = pageTexts(value.pages); break; }
                } catch { /* unreadable: the next directory, then the stored sentence */ }
            }
        }
        return kept ?? new Map();
    };
    return async (page: number): Promise<string[]> => {
        const out: string[] = [];
        const transcript = sourceSha ? await pageTranscript(context, sourceSha, page) : null;
        if (transcript?.text.trim()) out.push(transcript.text);
        const copy = (await keptCopy()).get(page);
        if (copy?.trim()) out.push(copy);
        return out;
    };
}

/**
 * §194.4: what the lane is shown of an unread person: their entry on the page of their first mention, from the first reading
 * text that prints them (the transcript, then the cast's own copy), else the stored first-mention sentence cut by the same rule,
 * else that sentence as stored.
 */
export async function unreadEntry(graph: ModuleGraph, cast: readonly CastPerson[], person: CastPerson, pages: (page: number) => Promise<string[]>): Promise<string | undefined> {
    if (!person.first) return undefined;
    const own = printedNames(graph, person);
    const others = cast.filter(other => other !== person).map(other => printedNames(graph, other));
    for (const text of [...await pages(person.first.page), person.first.sentence]) {
        const entry = castEntry(text, own, others);
        if (entry) return entry;
    }
    return person.first.sentence || undefined;
}
