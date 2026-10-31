/**
 * Contract §276: the Keeper's book is the chapter the party is in. This module holds the host side of it: the book's
 * chapters (§276.1), the chapter that holds a page, the cut of a source answer to a chapter and the `chapter_absent`
 * receipt (§276.3, §276.4), and the current-chapter resolver the reading service registers for the other readers of the
 * book (the prescreen's locate and source materials) in this process. Pages are 1-based physical pages of the bound PDF.
 */
import { BOOK_ABSENCE_RULE } from '../shared/book-absence.ts';

type Row = Record<string, any>;

export type ChapterSource = 'bookmarks' | 'headings' | 'none';
export interface Chapter { name: string; first: number; last: number }
/** How the current chapter was found (§276.2). */
export type ChapterResolution = 'scene' | 'pointer' | 'kept' | 'opening' | 'first';
/**
 * The current chapter and (§276.5) the book's resident chapters, read from any chapter: `resident` never holds the current
 * chapter itself.
 */
export interface ChapterScope extends Chapter { source: ChapterSource; resolved: ChapterResolution; resident?: Chapter[] }

export const WHOLE_BOOK = 'whole book', FRONT_MATTER = 'front matter';

/** §182.1 read for §276.1: entries sorted by page, same-page entries collapsed to the last; fewer than two is none. */
export function entriesChapters(value: unknown, pageCount: number): Chapter[] {
	const entries: Array<{ name: string; page: number }> = [];
	const rows = (Array.isArray(value) ? value : [])
		.filter((row): row is { name: string; page: number } => !!row && typeof row.name === 'string' && row.name.trim() !== ''
			&& Number.isSafeInteger(row.page) && row.page >= 1 && row.page <= pageCount)
		.map((row, index) => ({ name: row.name.trim().slice(0, 200), page: row.page, index }))
		.sort((a, b) => a.page - b.page || a.index - b.index);
	for (const row of rows) {
		if (entries.at(-1)?.page === row.page) entries[entries.length - 1] = row;
		else entries.push(row);
	}
	const chapters = entries.map((entry, index) => ({ name: entry.name, first: entry.page, last: (entries[index + 1]?.page ?? pageCount + 1) - 1 }));
	return chapters.length >= 2 ? chapters : [];
}

/** §276.1: the bookmarks' chapters, else the typographic headings', else the whole book as one. Front matter is its own. */
export function bookChapters(info: { bookmarks?: unknown; headings?: unknown }, pageCount: number): { source: ChapterSource; chapters: Chapter[] } {
	const last = Math.max(1, pageCount);
	const withFront = (chapters: Chapter[]) => chapters[0].first > 1 ? [{ name: FRONT_MATTER, first: 1, last: chapters[0].first - 1 }, ...chapters] : chapters;
	const marked = entriesChapters(info.bookmarks, last);
	if (marked.length) return { source: 'bookmarks', chapters: withFront(marked) };
	const headed = entriesChapters(info.headings, last);
	if (headed.length) return { source: 'headings', chapters: withFront(headed) };
	return { source: 'none', chapters: [{ name: WHOLE_BOOK, first: 1, last }] };
}

export const chapterHolding = (chapters: Chapter[], page: number): Chapter | undefined =>
	chapters.find(chapter => page >= chapter.first && page <= chapter.last);
const inSpan = (chapter: Chapter, page: unknown): boolean =>
	Number.isSafeInteger(page) && Number(page) >= chapter.first && Number(page) <= chapter.last;
/** Whether a page may be read: in the chapter, or (for a scope) in one of its resident chapters. */
export const inChapter = (chapter: Chapter | ChapterScope, page: unknown): boolean =>
	inSpan(chapter, page) || ((chapter as ChapterScope).resident ?? []).some(own => inSpan(own, page));
/** The spans a scope reads, the current chapter first. */
export const scopeSpans = (scope: Chapter | ChapterScope): Chapter[] => [{ name: scope.name, first: scope.first, last: scope.last }, ...((scope as ChapterScope).resident ?? [])];

/** §182.3: a scene's anchor page, the median of its distinct pages (the upper one of an even count). */
export function anchorPage(pages: number[]): number | undefined {
	const distinct = [...new Set(pages.filter(page => Number.isSafeInteger(page) && page >= 1))].sort((a, b) => a - b);
	return distinct.length ? distinct[Math.floor(distinct.length / 2)] : undefined;
}

/**
 * §276.2: the chapter a place's (or a scene's) book pages stand in most: a place the book names on pages of several chapters
 * lives where most of them are, not at their median (live 1030k: a region named on pages 2-15 sent the party to a later
 * chapter). Only chapters that can hold the party count: `excluded` names the resident chapters (§276.5, read from anywhere
 * anyway) and the front matter, where a place is mentioned, not played (live 1031: a city named mostly in the pregenerated
 * investigators' chapter placed the party there). A tie keeps the chapter the party was in, else the earliest of them. Pages
 * that all fall in excluded chapters keep the party where it was, or, with nowhere yet, put it in the first chapter that can
 * hold it. No pages at all decide nothing.
 */
export function placeChapter(chapters: Chapter[], pages: number[], kept?: Chapter, excluded: Chapter[] = []): Chapter | undefined {
	const same = (a: Chapter, b: Chapter) => a.first === b.first && a.last === b.last;
	const open = chapters.filter(chapter => !excluded.some(own => same(own, chapter)));
	const count = new Map<Chapter, number>();
	let anywhere = false;
	for (const page of new Set(pages)) {
		const chapter = chapterHolding(chapters, page);
		if (!chapter) continue;
		anywhere = true;
		if (open.includes(chapter)) count.set(chapter, (count.get(chapter) ?? 0) + 1);
	}
	if (!anywhere) return undefined;
	const keptHere = kept && chapters.find(chapter => same(chapter, kept));
	if (!count.size) return keptHere ?? open[0] ?? chapters[0];
	const most = Math.max(...count.values());
	const tied = open.filter(chapter => count.get(chapter) === most);
	return tied.find(chapter => keptHere && same(chapter, keptHere)) ?? tied[0];
}

/** §276.2: the chapters that never hold the party: the front matter and the resident chapters. */
export const unplayedChapters = (chapters: Chapter[], resident: Chapter[]): Chapter[] =>
	chapters.filter(chapter => chapter.name === FRONT_MATTER || resident.some(own => own.first === chapter.first && own.last === chapter.last));

export const chapterView = (scope: ChapterScope): Row => ({ name: scope.name, first: scope.first, last: scope.last, source: scope.source,
	...(scope.resident?.length ? { resident: scope.resident.map(own => ({ name: own.name, first: own.first, last: own.last })) } : {}) });
export const CHAPTER_NOTE = "These pages are the current chapter's; the Keeper's book is this chapter. " + BOOK_ABSENCE_RULE;
const span = (scope: ChapterScope) => scope.source === 'none' ? `the book, pages ${scope.first}-${scope.last}`
	: `the current chapter (${scope.name}, pages ${scope.first}-${scope.last})`
		+ (scope.resident?.length ? ` and the book's reference chapters (${scope.resident.map(own => `${own.name}, pages ${own.first}-${own.last}`).join('; ')})` : '');

/** §276.4: the receipt for a read that found nothing in the current chapter. */
export function chapterAbsent(scope: ChapterScope, focus: string, checked: string[], sha?: string): Row {
	const what = focus.trim() ? focus.trim() : 'what was asked';
	return { status: 'chapter_absent', authority: 'original-source-excerpts', prepared: false, ...(sha ? { source_sha256: sha } : {}),
		chapter: chapterView(scope), checked: [...new Set(checked)],
		answer: `${span(scope)[0].toUpperCase()}${span(scope).slice(1)} ${scope.resident?.length ? 'have' : 'has'} nothing on ${what}. ${BOOK_ABSENCE_RULE}`,
		excerpts: [], source_refs: [],
		note: 'Not a failure: the chapter was checked.' };
}

/**
 * §276.3: a source answer as the Keeper may read it in this chapter: excerpts and page refs outside it are dropped. An
 * answer that carried pages and is left with none becomes the receipt; one that never carried pages (pending, failed,
 * contents) is returned as it is. Pure; the answer is not changed in place.
 */
export function scopeAnswer(answer: Row, scope: ChapterScope | undefined, focus: string): Row {
	if (!scope || !answer || typeof answer !== 'object') return answer;
	// A memo or landed envelope carries several answers, each cut on its own.
	if (Array.isArray(answer.answers)) return { ...answer, answers: answer.answers.map((own: Row) => scopeAnswer(own, scope, typeof own?.focus === 'string' ? own.focus : focus)) };
	const excerpts = Array.isArray(answer.excerpts) ? answer.excerpts : undefined;
	const refs = Array.isArray(answer.source_refs) ? answer.source_refs : undefined;
	if (!excerpts?.length && !refs?.length) return answer;
	const pageOf = (ref: Row) => Number.isSafeInteger(ref?.pdf_index) ? ref.pdf_index + 1 : ref?.page;
	const keptExcerpts = (excerpts ?? []).filter(span => inChapter(scope, span?.page));
	const keptRefs = (refs ?? []).filter(ref => pageOf(ref) === undefined || inChapter(scope, pageOf(ref)));
	const droppedExcerpts = (excerpts ?? []).length - keptExcerpts.length;
	if (excerpts?.length && !keptExcerpts.length) return chapterAbsent(scope, focus, ['pages'], answer.source_sha256);
	if (!droppedExcerpts && keptRefs.length === (refs ?? []).length) return { ...answer, chapter: chapterView(scope) };
	const out: Row = { ...answer, chapter: chapterView(scope), ...(excerpts ? { excerpts: keptExcerpts } : {}), ...(refs ? { source_refs: keptRefs } : {}),
		outside_chapter: { excerpts: droppedExcerpts } };
	// An answer whose text was the excerpts themselves is rewritten from what is left; a generated answer keeps its words.
	if (typeof answer.answer === 'string' && /^Original physical pages /.test(answer.answer))
		out.answer = `Original physical pages ${keptExcerpts.map(span => span.page).join(', ')} are in excerpts, in page order.`;
	return out;
}

/** §276.2: the current chapter of a campaign's book, as the reading service resolves it; registered once per process. */
export type ChapterResolver = (campaign: string, moduleId: string, signal?: AbortSignal) => Promise<ChapterScope | undefined>;
let resolver: ChapterResolver | undefined;
/** Registers `value`; `undefined` clears it, and with `owner` only while `owner` is still the one registered. */
export function setChapterResolver(value: ChapterResolver | undefined, owner?: ChapterResolver): void {
	if (value || !owner || resolver === owner) resolver = value;
}
/** Whether a reading service resolves chapters in this process (a host without one has no chapter scope at all). */
export const chapterResolverSet = (): boolean => resolver !== undefined;
/** The module each campaign's book reads were last made for; a reader that does not know the module asks with none. */
const modules = new Map<string, string>();
export function noteChapterModule(campaign: string, moduleId: string): void { modules.set(campaign, moduleId); }
export async function currentChapter(campaign: string | undefined, moduleId?: string, signal?: AbortSignal): Promise<ChapterScope | undefined> {
	const mid = moduleId ?? (campaign ? modules.get(campaign) : undefined);
	if (!resolver || !campaign || !mid) return undefined;
	try { return await resolver(campaign, mid, signal); } catch { return undefined; }
}
