/**
 * Contract §262.2: a deterministic layout index of a PDF page's native text. Geometry only: text items become lines by
 * baseline, lines become blocks by column, font height and vertical gap, and blocks are ordered by column, then by y.
 * Nothing here judges what a block means; it only gives every piece of text a stable id, a place and an order so a
 * reader can cite it and the host can slice it back out.
 */
import { createHash } from "node:crypto";

export const SOURCE_LAYOUT_VERSION = "blocks-v1";

/** One PDF.js text item in top-down page coordinates. */
export interface LayoutItem { text: string; x: number; y: number; width: number; height: number; font?: string }
export interface SourceBlock {
	id: string;
	page: number;
	column: number;
	order: number;
	bbox: [number, number, number, number];
	text: string;
	text_sha256: string;
	/** The block this one continues when a column ends mid-sentence and the next column opens in the same style. */
	continues?: string;
}
export interface SourceBlocksPage { page: number; image_only: boolean; blocks: SourceBlock[] }

type Line = { column: number; y: number; x0: number; x1: number; height: number; items: LayoutItem[] };

/** The font that carries most of a line's characters (a box set in another face is another block). */
function lineFont(line: Line): string {
	const weight = new Map<string, number>();
	for (const item of line.items) weight.set(item.font ?? "", (weight.get(item.font ?? "") ?? 0) + item.text.length);
	return [...weight].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
/** Characters that close a sentence; a column ending on one of these is not continued by the next column. */
const CLOSERS = new Set(["。", ".", "!", "?", "！", "？", "」", "”", "\"", ":", "：", ")", "）"]);

/** The x of the page's column gutter, or null for a single-column page: the least covered x in the middle band. */
export function columnGutter(items: LayoutItem[], width: number): number | null {
	if (items.length < 8 || !(width > 0)) return null;
	let best: { x: number; covered: number } | null = null;
	for (let x = width * 0.35; x <= width * 0.65; x += 2) {
		const covered = items.filter(item => item.x < x && item.x + item.width > x).length;
		if (!best || covered < best.covered) best = { x, covered };
	}
	if (!best) return null;
	const right = items.filter(item => item.x >= best!.x).length, left = items.length - right;
	// Two columns need text on both sides and almost nothing crossing the gutter.
	return best.covered <= Math.max(1, items.length * 0.03) && right >= items.length * 0.15 && left >= items.length * 0.15 ? best.x : null;
}

function joinItems(items: LayoutItem[]): string {
	let text = "", end: number | null = null;
	for (const item of [...items].sort((a, b) => a.x - b.x)) {
		if (end !== null && item.x - end > item.height * 0.3 && !text.endsWith(" ")) text += " ";
		text += item.text;
		end = item.x + item.width;
	}
	return text.trim();
}

function linesOf(items: LayoutItem[], gutter: number | null): Line[] {
	const lines: Line[] = [];
	const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
	for (const item of sorted) {
		const column = gutter !== null && item.x >= gutter ? 1 : 0;
		const line = lines.find(candidate => candidate.column === column
			&& Math.abs(candidate.y - item.y) < Math.min(candidate.height, item.height) * 0.5);
		if (line) {
			line.items.push(item);
			line.x0 = Math.min(line.x0, item.x); line.x1 = Math.max(line.x1, item.x + item.width);
			line.height = Math.max(line.height, item.height);
		} else lines.push({ column, y: item.y, x0: item.x, x1: item.x + item.width, height: item.height, items: [item] });
	}
	return lines.sort((a, b) => a.column - b.column || a.y - b.y || a.x0 - b.x0);
}

/** The blocks of one page from its text items (`width` is the page's width in the items' units). */
export function layoutBlocks(page: number, items: LayoutItem[], width: number): SourceBlocksPage {
	const usable = items.filter(item => item.text.trim() && Number.isFinite(item.x) && Number.isFinite(item.y) && item.height > 0);
	if (!usable.length) return { page, image_only: true, blocks: [] };
	const gutter = columnGutter(usable, width);
	const groups: Line[][] = [];
	for (const line of linesOf(usable, gutter)) {
		const group = groups.at(-1), last = group?.at(-1);
		const sameStyle = !!last && last.column === line.column && lineFont(last) === lineFont(line) && Math.abs(last.height - line.height) <= Math.max(1, last.height * 0.12);
		const gap = last ? line.y - last.y : 0;
		// The block's own line spacing, once it has two lines; a first gap is judged against the font height.
		const spacing = group && group.length > 1 ? (group.at(-1)!.y - group[0].y) / (group.length - 1) : (last?.height ?? 0) * 2.2;
		if (group && sameStyle && gap > 0 && gap <= spacing * 1.35 + 0.5) group.push(line);
		else groups.push([line]);
	}
	const blocks: SourceBlock[] = groups.map((lines, order) => {
		const text = lines.map(line => joinItems(line.items)).join("\n"), text_sha256 = sha(text);
		return { id: `b${page}-${order}-${text_sha256.slice(0, 8)}`, page, column: lines[0].column, order,
			bbox: [Math.min(...lines.map(line => line.x0)), Math.min(...lines.map(line => line.y - line.height)),
				Math.max(...lines.map(line => line.x1)), Math.max(...lines.map(line => line.y))].map(value => Math.round(value * 10) / 10) as SourceBlock["bbox"],
			text, text_sha256 };
	});
	// A column that ends mid-sentence is continued by the next column's first block when that block has the same font height.
	const indexed = groups.map((lines, index) => ({ lines, index }));
	const before = indexed.filter(entry => entry.lines[0].column === 0).at(-1), after = indexed.find(entry => entry.lines[0].column === 1);
	if (before && after) {
		const closed = CLOSERS.has(blocks[before.index].text.trimEnd().at(-1) ?? "");
		const end = before.lines.at(-1)!, start = after.lines[0];
		if (!closed && lineFont(end) === lineFont(start) && Math.abs(end.height - start.height) <= Math.max(1, end.height * 0.12))
			blocks[after.index].continues = blocks[before.index].id;
	}
	return { page, image_only: false, blocks };
}

/** Rough token count of a text for budgeting: its UTF-8 bytes over three (no tokenizer, no script detection). */
export function roughTokens(text: string): number {
	return Math.ceil(Buffer.byteLength(text, "utf8") / 3);
}
