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
/** How the current chapter was found (§276.2); `none`: no evidence locates the party, and the scope is the whole book, unscoped (never kept). */
export type ChapterResolution = 'scene' | 'pointer' | 'kept' | 'opening' | 'none';
/**
 * The current chapter and (§276.5) the book's resident chapters, read from any chapter: `resident` never holds the current
 * chapter itself.
 */
export interface ChapterScope extends Chapter { source: ChapterSource; resolved: ChapterResolution; resident?: Chapter[] }

export const WHOLE_BOOK = 'whole book', FRONT_MATTER = 'front matter';
/** Whether a scope restricts nothing: a book without chapters, or (§276.2) a read no evidence located. */
export const unscoped = (scope: ChapterScope): boolean => scope.source === 'none' || scope.resolved === 'none';

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
 * §276.2: the chapter that holds most of a place's (or a scene's) book pages, when one does: more than half of its distinct
 * pages in one chapter. A place named on pages spread over several chapters (a city on 22 pages over 13 chapters, a town split
 * evenly between the keeper's background and a later event) says nothing about where the party is, so it decides nothing and
 * the party stays where it was (§276.2's kept, then the opening, then the first chapter). Live 1031 and the 7-book audit: the
 * median, then a plain plurality with tie-breaks, each moved the party on such thin evidence (dg's entry to the hosting advice,
 * du's Arkham places to a later event, ad's harbour scenes to the city chapter). Every chapter counts. No pages decide nothing.
 */
export function placeChapter(chapters: Chapter[], pages: number[]): Chapter | undefined {
	const count = new Map<Chapter, number>();
	let total = 0;
	for (const page of new Set(pages)) { const chapter = chapterHolding(chapters, page); if (chapter) { total++; count.set(chapter, (count.get(chapter) ?? 0) + 1); } }
	for (const [chapter, held] of count) if (held * 2 > total) return chapter;
	return undefined;
}

/**
 * §276.2: whether a graph entity's book pages may place the party, read from structure only (a `table.lookup kind=module`
 * row's `kind` and `properties`): a place, `scene` or `location`; never the module's root (`module`) or any other kind. An
 * opening's reading anchor -- a scene the source reference minted for an entry, marked `is_entrance` and
 * `source_reference_anchor` (`publishReferenceContext`) -- is a span of book pages where an opening's reading starts, not a
 * place: its pages decide only as the campaign's opening, never as the scene the party is in (live7 du-1101a/b: the anchor on
 * the title page and the keeper's background stood as the party's scene and held the party in that background). A place
 * minted from the source reference (`source_reference_anchor` alone, `publishReferencePlace`) is a place.
 */
export function placesParty(entity: Row | undefined, as: 'scene' | 'opening' = 'scene'): boolean {
	if (!entity || (entity.kind !== 'scene' && entity.kind !== 'location')) return false;
	const marks = entity.properties && typeof entity.properties === 'object' ? entity.properties : {};
	return as === 'opening' || !(marks.is_entrance === true && marks.source_reference_anchor === true);
}

export const chapterView = (scope: ChapterScope): Row => ({ name: scope.name, first: scope.first, last: scope.last, source: scope.source,
	...(scope.resolved === 'none' ? { unscoped: true } : {}),
	...(scope.resident?.length ? { resident: scope.resident.map(own => ({ name: own.name, first: own.first, last: own.last })) } : {}) });
export const CHAPTER_NOTE = "These pages are the current chapter's; the Keeper's book is this chapter. " + BOOK_ABSENCE_RULE;
const span = (scope: ChapterScope) => unscoped(scope) ? `the book, pages ${scope.first}-${scope.last}`
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
