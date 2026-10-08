/**
 * §182: the book's chapters and the read-ahead's window over them. Chapters are the PDF's own top-level bookmarks
 * (`source_document.outline`, kept at binding) or, without them, the model index's sections; nothing here reads a title.
 * Pages are 1-based physical pages of the bound PDF.
 */
import { join } from 'node:path';
import type { KernelContext } from '../context.js';
import { isJsonObject } from '../json.js';
import { array, chars, integer, number, row, type Row } from '../read/values.js';

/** §182.1: at most this many outline entries are kept, and each name at most this many characters. */
export const OUTLINE_ENTRIES = 200, OUTLINE_NAME = 200;
/** The shipped `reading` budgets of `content/rulesets/coc7/host-budgets.json`, used when the data names none. */
export const WHOLE_BOOK_MAX_PAGES = 60, FALLBACK_WINDOW_PAGES = 24;
/** §184.5: the shipped `reading.merge_budget_ms`, and the most the data may give one merge call. */
export const MERGE_BUDGET_MS = 2000, MERGE_BUDGET_MAX_MS = 60_000;
/** §191.2: the shipped `transcript.max_window_pages`, used when the data names none. */
export const TRANSCRIPT_MAX_WINDOW_PAGES = 120;

export type OutlineEntry = { name: string; page: number };
export type Chapter = { name: string; first: number; last: number };
export type ReadingWindow = { mode: 'whole' | 'chapters' | 'pages'; first: number; last: number; chapters: string[]; complete?: boolean };
export type ReadingBudget = { wholeBookMaxPages: number; fallbackWindowPages: number; mergeBudgetMs: number };
/** §191.5: 1-based physical pages, first and last inclusive. */
export type PageRange = [number, number];

/**
 * §182.1: the top-level bookmarks that carry a page, as `{name, page}`: sorted by page (ties keep the book's order), at
 * most `OUTLINE_ENTRIES`, names trimmed and cut to `OUTLINE_NAME` characters, pages within the book. A malformed row is
 * dropped, never refused. Children are not chapters and are not kept.
 */
export function cleanOutline(value: unknown, pageCount: number): OutlineEntry[] {
    const out: OutlineEntry[] = [];
    for (const entry of array(value)) {
        if (!isJsonObject(entry) || typeof entry.name !== 'string' || !integer(entry.page)) continue;
        const name = chars(entry.name.trim(), OUTLINE_NAME), page = number(entry.page);
        if (!name || page < 1 || page > pageCount) continue;
        out.push({ name, page });
    }
    return out.sort((a, b) => a.page - b.page).slice(0, OUTLINE_ENTRIES);
}

/**
 * §182.1: chapter *i* runs from entry *i*'s page to the page before the next entry with a greater page; the last runs to
 * the end of the book. Entries sharing a page collapse to the last of them. Fewer than two chapters is none.
 */
export function outlineChapters(outline: unknown, pageCount: number): Chapter[] {
    const entries: OutlineEntry[] = [];
    for (const entry of cleanOutline(outline, pageCount)) {
        if (entries.at(-1)?.page === entry.page) entries[entries.length - 1] = entry;
        else entries.push(entry);
    }
    const chapters = entries.map((entry, index) => ({ name: entry.name, first: entry.page, last: (entries[index + 1]?.page ?? pageCount + 1) - 1 }));
    return chapters.length >= 2 ? chapters : [];
}

/**
 * §182.1's fallback: the model index's sections as chapters, each starting at the first page it names (index rows keep
 * 0-based `[first, last]` ranges). A section marked unreadable is not a chapter.
 */
export function indexChapters(sections: Row[], pageCount: number): Chapter[] {
    const entries: OutlineEntry[] = [];
    for (const section of sections) {
        if (section.state === 'unreadable') continue;
        const starts = array(section.pages).filter(range => Array.isArray(range) && range.length === 2 && integer(range[0])).map(range => number(range[0]) + 1);
        if (starts.length && typeof section.name === 'string') entries.push({ name: section.name, page: Math.min(...starts) });
    }
    return outlineChapters(entries, pageCount);
}

/**
 * §182.3: the page a scene anchors its window on -- the median of the distinct pages it cites, the upper one of an even
 * count. Not the first page: a book's overview chapter names its places in passing, and the first page alone anchored a
 * scene to that overview instead of the chapter that describes it (2026-10-04, the Blood Road book: its diner cites pages 15, 28 and 29).
 */
export function anchorPage(pages: number[]): number | undefined {
    const distinct = [...new Set(pages.filter(page => Number.isSafeInteger(page) && page >= 1))].sort((a, b) => a - b);
    return distinct.length ? distinct[Math.floor(distinct.length / 2)] : undefined;
}

/**
 * §182.3: a long book's reading window -- the chapter that holds the anchor page and the chapter after it, or, without
 * chapters, the anchor page through `fallbackPages` pages after it. An anchor in the front matter before the first
 * chapter reads from the anchor through the first chapter.
 */
export function readingWindow(pageCount: number, chapters: Chapter[], anchor: number, fallbackPages: number): ReadingWindow {
    const page = Math.min(Math.max(1, anchor), Math.max(1, pageCount));
    if (!chapters.length) return { mode: 'pages', first: page, last: Math.min(pageCount, page + fallbackPages), chapters: [] };
    let index = -1;
    chapters.forEach((chapter, at) => { if (chapter.first <= page) index = at; });
    if (index < 0) return { mode: 'chapters', first: page, last: chapters[0].last, chapters: [chapters[0].name] };
    const current = chapters[index], next = chapters[index + 1];
    return { mode: 'chapters', first: current.first, last: (next ?? current).last, chapters: next ? [current.name, next.name] : [current.name] };
}

export const wholeWindow = (pageCount: number, chapters: Chapter[]): ReadingWindow =>
    ({ mode: 'whole', first: 1, last: pageCount, chapters: chapters.map(chapter => chapter.name) });
export const pageInside = (window: { first: number; last: number }, page: number): boolean => page >= window.first && page <= window.last;
export const rangeMeets = (window: { first: number; last: number }, first: number, last: number): boolean => last >= window.first && first <= window.last;

/**
 * §191.5: the pages the host transcribes ahead of the table, as disjoint ranges in priority order. `anchor` is the page the
 * window is anchored on (§182.3) and `reachable` the anchor pages of the scenes the table can reach next: the focus scene's
 * exits, the scene it is located in and the scenes located in it.
 *
 * - `whole`: the whole book.
 * - `chapters`: the chapter that holds the anchor (the front matter before the first chapter, when the anchor is there);
 *   then, in book order, each chapter that holds a reachable scene's anchor page; then the chapter after the anchor's. No
 *   chapter twice.
 * - `pages`: the page window, then each reachable anchor page with two pages either side, within the book; those spans
 *   merge where they meet, and the pages the window already holds are left out of them.
 *
 * The first range is always kept whole; the list stops before a range would take the total past `maxPages`.
 */
export function transcriptRanges(window: ReadingWindow, pageCount: number, chapters: Chapter[], anchor: number,
    reachable: number[], maxPages: number): PageRange[] {
    const last = Math.max(1, pageCount), clamp = (page: number): number => Math.min(Math.max(1, page), last);
    if (window.mode === 'whole') return wholeTranscript(pageCount);
    const anchors = [...new Set(reachable.filter(page => Number.isSafeInteger(page) && page >= 1 && page <= last))].sort((a, b) => a - b);
    let ranges: PageRange[];
    if (window.mode === 'chapters' && chapters.length) {
        // A page's chapter: the last one starting at or before it; before the first chapter, the front matter (-1).
        const holding = (page: number): number => chapters.reduce((found, chapter, at) => chapter.first <= page ? at : found, -1);
        const span = (at: number): PageRange => at < 0 ? [1, chapters[0].first - 1] : [chapters[at].first, chapters[at].last];
        const current = holding(clamp(anchor)), order = [current];
        for (const at of [...new Set(anchors.map(holding))].sort((a, b) => a - b)) if (!order.includes(at)) order.push(at);
        if (current + 1 < chapters.length && !order.includes(current + 1)) order.push(current + 1);
        ranges = order.map(span).filter(([first, end]) => first <= end);
    }
    else {
        const own: PageRange = [clamp(window.first), clamp(window.last)], near: PageRange[] = [];
        for (const page of anchors) {
            const first = clamp(page - 2), end = clamp(page + 2), previous = near.at(-1);
            if (previous && first <= previous[1] + 1) previous[1] = Math.max(previous[1], end);
            else near.push([first, end]);
        }
        ranges = [own];
        for (const [first, end] of near) {
            if (first < own[0]) ranges.push([first, Math.min(end, own[0] - 1)]);
            if (end > own[1]) ranges.push([Math.max(first, own[1] + 1), end]);
        }
    }
    const kept: PageRange[] = [];
    let total = 0;
    for (const range of ranges) {
        const size = range[1] - range[0] + 1;
        if (kept.length && total + size > maxPages) break;
        kept.push(range);
        total += size;
    }
    return kept;
}

/** §191.5: a short book's transcript pages, the whole book. */
export const wholeTranscript = (pageCount: number): PageRange[] => [[1, Math.max(1, pageCount)]];

/** A whole number of pages from the data, or the coded fallback when it is absent or out of bounds. */
function pages(value: unknown, fallback: number, least: number): number {
    return integer(value) && number(value) >= least && number(value) <= 100_000 ? number(value) : fallback;
}

/** One block of the content's host budgets (`content/rulesets/coc7/host-budgets.json`); empty when the file or block is absent. */
async function hostBudget(context: KernelContext, block: string): Promise<Row> {
    try { return row(row(await context.snapshots.readJson(join(context.content, 'rulesets', 'coc7', 'host-budgets.json')))[block]); }
    catch { return {}; /* the coded fallbacks are the shipped values */ }
}

/**
 * §182.2-§182.3: `reading.whole_book_max_pages` and `reading.fallback_window_pages`; §184.5: `reading.merge_budget_ms`, the
 * time after which one merge call starts no further replay (0 to 60000). Read from the content's host budgets.
 */
export async function readingBudget(context: KernelContext): Promise<ReadingBudget> {
    const reading = await hostBudget(context, 'reading');
    const merge = reading.merge_budget_ms;
    return { wholeBookMaxPages: pages(reading.whole_book_max_pages, WHOLE_BOOK_MAX_PAGES, 0),
        fallbackWindowPages: pages(reading.fallback_window_pages, FALLBACK_WINDOW_PAGES, 1),
        mergeBudgetMs: integer(merge) && number(merge) >= 0 && number(merge) <= MERGE_BUDGET_MAX_MS ? number(merge) : MERGE_BUDGET_MS };
}

/** §191.5: `transcript.max_window_pages`, the most pages a read-ahead's `window.transcript` names. Read from the content's host budgets. */
export async function transcriptWindowPages(context: KernelContext): Promise<number> {
    return pages((await hostBudget(context, 'transcript')).max_window_pages, TRANSCRIPT_MAX_WINDOW_PAGES, 1);
}
