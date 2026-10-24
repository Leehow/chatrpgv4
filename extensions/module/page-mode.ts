/**
 * Contract §266: page mode. Where the pointer index does not cover a page, the Keeper turns the book's pages and the host
 * cuts them from its own text; no model reads the book for it. This module decides which pages are indexed, builds the
 * book's contents without a model, and shapes the pages the host hands the Keeper.
 */
import { answerPages, normalName, starts } from "./lean-skeleton.ts";
export { partialSkeletonPath } from "./lean-skeleton.ts";

type Row = Record<string, any>;

/** §266.4: how many pages one turn of the book hands the Keeper, and how much of each. */
export const PAGE_BOUNDS = { pages: 3, chars: 4000, contents: 120, answerContents: 60, noteContents: 40, firstLine: 80 } as const;

export type ContentsRow = { name: string; first: number; last: number };

/**
 * §266.3: the book's contents: its bookmarks two levels deep when there are at least two, otherwise one row per text page
 * named by the start of its first layout block. Page order; no model writes them.
 */
export function bookContents(bookmarks: unknown, pageCount: number, firstLine: (page: number) => string | undefined): ContentsRow[] {
	const marks = starts(bookmarks).filter(mark => mark.name && mark.page >= 1 && mark.page <= pageCount).sort((a, b) => a.page - b.page);
	if (marks.length >= 2) return marks.map((mark, i) => {
		// The next start on a later page ends this row; bookmarks sharing a page share its end.
		const next = marks.slice(i + 1).find(row => row.page > mark.page)?.page ?? pageCount + 1;
		return { name: mark.name, first: mark.page, last: Math.max(mark.page, next - 1) };
	});
	const rows: ContentsRow[] = [];
	for (let page = 1; page <= pageCount; page++) {
		const line = firstLine(page)?.replace(/\s+/g, " ").trim();
		if (line) rows.push({ name: [...line].slice(0, PAGE_BOUNDS.firstLine).join(""), first: page, last: page });
	}
	return rows;
}

/** §266.3: the first layout block's text of each page in a stored block cache (`blocks-<sha>.json`). */
export function firstLines(stored: Row | undefined): (page: number) => string | undefined {
	return page => {
		const blocks = stored?.pages?.[page]?.blocks;
		return Array.isArray(blocks) ? blocks.find((block: Row) => typeof block?.text === "string" && block.text.trim())?.text : undefined;
	};
}

/** §266.1: whether one page is indexed: a section of the skeleton covers it as `indexed` and it is not blocked. */
export function pageIndexed(skeleton: Row | undefined, page: number): boolean {
	if (!skeleton || (skeleton.blocked_pages ?? []).includes(page)) return false;
	return (skeleton.sections ?? []).some((section: Row) => section.status === "indexed" && page >= section.first && page <= section.last);
}

/** §266.1: whether a set of pages is in page mode: one of them is not indexed, or (no pages) the skeleton is not complete. */
export function inPageMode(skeleton: Row | undefined, pages: number[]): boolean {
	const own = pages.filter(page => Number.isSafeInteger(page) && page >= 1);
	if (!own.length) return skeleton?.complete !== true;
	return own.some(page => !pageIndexed(skeleton, page));
}

/** §266.1: a focus takes the skeleton's pages for its name; a name the skeleton lacks is in page mode until it is complete. */
export function focusInPageMode(skeleton: Row | undefined, focus: string): boolean {
	const pages = skeleton && focus.trim() ? answerPages(skeleton, focus) : [];
	return pages.length ? inPageMode(skeleton, pages) : skeleton?.complete !== true;
}

/** §266.4: the contents row a section name means (normalised spelling, equal first, then containing either way). */
export function findSection(contents: ContentsRow[], name: string): ContentsRow | undefined {
	const key = normalName(name);
	if (!key) return undefined;
	return contents.find(row => normalName(row.name) === key)
		?? contents.find(row => { const own = normalName(row.name); return own.length >= 2 && (own.includes(key) || key.includes(own)); });
}

/** §266.4: the pages a request names: its pages (at most three), else its section's first three. */
export function requestedPages(contents: ContentsRow[], params: { pages?: unknown; section?: unknown }, pageCount: number): { pages: number[]; section?: ContentsRow } {
	const asked = Array.isArray(params.pages) ? params.pages.map(Number).filter(page => Number.isSafeInteger(page) && page >= 1 && page <= pageCount) : [];
	if (asked.length) return { pages: [...new Set(asked)].slice(0, PAGE_BOUNDS.pages).sort((a, b) => a - b) };
	const section = typeof params.section === "string" ? findSection(contents, params.section) : undefined;
	if (!section) return { pages: [] };
	const pages: number[] = [];
	for (let page = section.first; page <= Math.min(section.last, pageCount) && pages.length < PAGE_BOUNDS.pages; page++) pages.push(page);
	return { pages, section };
}

/** The contents as the Keeper reads them: one short line per row. */
export const contentsLines = (contents: ContentsRow[], limit: number): string[] =>
	contents.slice(0, limit).map(row => `p${row.first}${row.last > row.first ? `-${row.last}` : ""} ${row.name}`);

/** §266.5: what the Keeper is told while the index does not cover the whole book. */
export const BOOK_PAGES_NOTE = "The book's index does not cover the whole book yet: what this section lists is all it has for now. For anything else, turn "
	+ "the book's pages yourself with lookup kind=source source_mode=pages and pages (physical page numbers, at most 3) or section (a contents name). "
	+ "The pages are the book's own text, Keeper-only, and may hold secrets.";

/** §266.6: what the Keeper is told beside a landing's pages in page mode. */
export const PAGE_MODE_TEXT_NOTE = "The book's index does not cover these pages yet, so they are carried as the book's own text and no reviewed record "
	+ "of them will land. Play from these pages; for more of the book, turn its pages with lookup kind=source source_mode=pages.";

/** §266.10: what the Keeper is told beside a landing's pages where the pointer index covers them. */
export const POINTER_TEXT_NOTE = "These pages are the book's own text for this, carried once; no reader rewrites them into a record. Play from them, "
	+ "with what book_truth says about the people and place here; for more of the book, turn its pages with lookup kind=source source_mode=pages.";
