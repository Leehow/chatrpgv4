/**
 * Contract §276.1: the chapter headings of a book that has no bookmarks, from typography only. Every text item's font
 * height (rounded to 0.5) and baseline; a page's items on one baseline are one line. The body height is the height that
 * carries the most characters. A heading line is at most `HEADING_CHARS` characters at `HEADING_RATIO` times the body
 * height or more; items on one baseline more than two heights apart are separate lines (a two-column page's headings).
 * The chapter tier is the largest heading height whose lines stand on at least two different pages; its lines, in page
 * and reading order, are the `{name, page}` entries `outlineChapters` reads. Nothing here reads what a
 * heading says.
 */
export const HEADING_RATIO = 1.25, HEADING_CHARS = 40;

/**
 * One text item of a page: its text, its baseline (any consistent unit, larger is higher on the page), its left edge and
 * width in the same unit, and its font height.
 */
export interface HeadingItem { text: string; baseline: number; x: number; width: number; height: number }
export interface HeadingEntry { name: string; page: number }

const half = (value: number) => Math.round(value * 2) / 2;

export function headingEntries(pages: Array<{ page: number; items: HeadingItem[] }>): HeadingEntry[] {
	type Line = { page: number; baseline: number; height: number; x0: number; x1: number; text: string };
	const lines: Line[] = [], weight = new Map<number, number>();
	for (const { page, items } of pages) {
		const own: Line[] = [];
		for (const item of items) {
			const text = item.text.trim(), height = half(item.height);
			if (!text || !(height > 0)) continue;
			weight.set(height, (weight.get(height) ?? 0) + text.length);
			// One line: the same page and rounded height, baseline within half of it, and no gap wider than two heights.
			const line = own.find(row => row.height === height && Math.abs(row.baseline - item.baseline) < height * 0.5
				&& item.x <= row.x1 + height * 2 && item.x + item.width >= row.x0 - height * 2);
			if (line) { line.text += text; line.x0 = Math.min(line.x0, item.x); line.x1 = Math.max(line.x1, item.x + item.width); }
			else own.push({ page, baseline: item.baseline, height, x0: item.x, x1: item.x + item.width, text });
		}
		lines.push(...own.sort((a, b) => b.baseline - a.baseline || a.x0 - b.x0));
	}
	const body = [...weight].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
	if (body === undefined) return [];
	const headings = lines.filter(line => line.height >= body * HEADING_RATIO && Array.from(line.text).length <= HEADING_CHARS);
	const tiers = [...new Set(headings.map(line => line.height))].sort((a, b) => b - a);
	for (const tier of tiers) {
		const own = headings.filter(line => line.height === tier);
		if (new Set(own.map(line => line.page)).size >= 2) return own.map(line => ({ name: line.text, page: line.page }));
	}
	return [];
}
