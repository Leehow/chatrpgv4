/**
 * Contract §196: a page transcript's paragraphs, recovered from its stored record. Pure functions, no I/O.
 *
 * A record (§191.4) stores `text`, the exact layer -- its runs (a run's native lines joined by `"\n"`) separated by blank
 * lines, then the unplaced lines, then the dropped lines -- and `markdown`, the same runs filled with §191.3's join rule
 * (`joinRun`) inside the agent's Markdown structure, unplaced lines appended, dropped lines left out. Every run therefore
 * stands, joined, in `markdown` in the order it stands in `text`, so a run's place in the Markdown structure is found by
 * searching for its joined form after the previous run's place: a deterministic alignment from the stored record, with no
 * re-transcription. A run found at more than one place between its neighbours is bracketed by its leftmost and rightmost
 * places and every block between them becomes one unit, so an uncertain alignment can merge blocks but never cut one.
 *
 * What is parsed in `markdown` is closed syntax: the image-text markers, figure-note lines and CommonMark's block markers
 * (heading, blockquote, list item, table row) at the start of a line. Nothing here reads what the words say. Whether a
 * block ends a sentence is the Unicode property `Sentence_Terminal`, after trailing closing punctuation (`Pe`, `Pf`) and
 * quotation marks (`Quotation_Mark`) -- a character property, not a list of characters.
 */
import { joinRun } from "./page-transcript.ts";

export type BlockKind = "heading" | "paragraph" | "list" | "quote" | "table" | "figure" | "image_text" | "unplaced" | "dropped";
/** The kinds that are body text: only two of these, of the same kind, can be one paragraph broken by a page break. */
const BODY: ReadonlySet<BlockKind> = new Set<BlockKind>(["paragraph", "list", "quote", "table"]);
/** The kinds that are not in the page's reading flow: skipped when finding a page's first and last body block. */
const ASIDE: ReadonlySet<BlockKind> = new Set<BlockKind>(["figure", "image_text", "unplaced", "dropped"]);

export interface TranscriptBlock {
	kind: BlockKind;
	/** UTF-16 offsets into `text`: the first run's start to the last run's end. */
	start: number;
	end: number;
	/** Heading blocks only: the level (`#` count) and the heading's reading text. */
	level?: number;
	heading?: string;
	/** How many runs (stretches of consecutive `text` lines) the block holds. */
	runs: number;
}
export interface Heading { level: number; text: string }
export type BlockAlignment = { ok: true; blocks: TranscriptBlock[]; merged: number } | { ok: false; reason: string; run?: number };

/** What a record must carry for its blocks to be recovered. */
export interface TranscriptLayers { text: string; markdown: string; dropped: readonly unknown[]; unplaced: readonly unknown[] }

const IMAGE_OPEN = "<!-- image-text -->", IMAGE_CLOSE = "<!-- /image-text -->";
const FIGURE_NOTE = /^\s*(?:>\s*)*\[figure\]/iu;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+|$)/u;
const QUOTE = /^ {0,3}>/u;
const LIST_ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/u;
const TABLE_ROW = /^\s*\|/u;
const INDENTED = /^(?: {2,}|\t)/u;

interface Segment { start: number; end: number; lines: string[] }
interface MarkdownBlock { kind: BlockKind; from: number; to: number; level?: number; heading?: string }

/** The blank-line-separated stretches of `text`, with their offsets. */
function segments(text: string): Segment[] {
	if (!text) return [];
	const out: Segment[] = [];
	let start = 0;
	for (;;) {
		const at = text.indexOf("\n\n", start), end = at < 0 ? text.length : at;
		out.push({ start, end, lines: text.slice(start, end).split("\n") });
		if (at < 0) return out;
		start = at + 2;
	}
}

/** A heading line's reading text: the `#` marks, a closing `#` sequence and the emphasis around the words removed. */
function headingText(line: string): string {
	return line.replace(HEADING, "").replace(/[ \t]+#+[ \t]*$/u, "").trim().replace(/^[*_~`]+|[*_~`]+$/gu, "").trim();
}

function lineKind(line: string): BlockKind {
	if (FIGURE_NOTE.test(line)) return "figure";
	if (HEADING.test(line)) return "heading";
	if (QUOTE.test(line)) return "quote";
	if (TABLE_ROW.test(line)) return "table";
	if (LIST_ITEM.test(line)) return "list";
	return "paragraph";
}

/**
 * The blocks of the Markdown outside image text, as character ranges. A heading line is a block of its own (adjacent heading
 * lines of one level are one heading printed on several lines); a figure note is a block of its own; consecutive lines of one
 * kind are one block, and a line with no marker of its own continues the block it follows (CommonMark's lazy continuation);
 * a blank line ends a block, except between the items of one list (a loose list) and before a list item's indented
 * continuation.
 */
function markdownBlocks(markdown: string, from: number, to: number, out: MarkdownBlock[]): void {
	let offset = from, open: MarkdownBlock | undefined, blank = false;
	const close = () => { if (open) out.push(open); open = undefined; };
	while (offset < to) {
		const newline = markdown.indexOf("\n", offset), lineEnd = newline < 0 || newline > to ? to : newline;
		const line = markdown.slice(offset, lineEnd), next = lineEnd + 1;
		if (!/\S/u.test(line)) { blank = true; offset = next; continue; }
		const kind = lineKind(line);
		if (kind === "heading") {
			const level = HEADING.exec(line)![1].length, text = headingText(line);
			if (open?.kind === "heading" && open.level === level && !blank) { open.heading = joinRun([open.heading!, text]); open.to = lineEnd; }
			else { close(); open = { kind, from: offset, to: lineEnd, level, heading: text }; }
		} else if (kind === "figure") { close(); out.push({ kind, from: offset, to: lineEnd }); }
		else if (open && open.kind !== "heading" && !blank && (kind === open.kind || kind === "paragraph" && open.kind !== "table")) open.to = lineEnd;
		else if (open?.kind === "list" && blank && (kind === "list" || INDENTED.test(line))) open.to = lineEnd;
		else { close(); open = { kind, from: offset, to: lineEnd }; }
		blank = false;
		offset = next;
	}
	close();
}

/** `markdown`'s blocks in order: image-text spans (the assembly's own markers) and the Markdown blocks around them. */
function blocksOf(markdown: string): MarkdownBlock[] {
	const out: MarkdownBlock[] = [];
	let cursor = 0;
	for (;;) {
		const open = markdown.indexOf(IMAGE_OPEN, cursor);
		if (open < 0) { markdownBlocks(markdown, cursor, markdown.length, out); return out; }
		const close = markdown.indexOf(IMAGE_CLOSE, open + IMAGE_OPEN.length), end = close < 0 ? markdown.length : close + IMAGE_CLOSE.length;
		markdownBlocks(markdown, cursor, open, out);
		out.push({ kind: "image_text", from: open, to: end });
		cursor = end;
	}
}

const blockAt = (blocks: readonly MarkdownBlock[], from: number, to: number): number =>
	blocks.findIndex(block => block.from <= from && to <= block.to);

/**
 * §196.1: the record's blocks as stretches of `text`. Fails (with the run that could not be placed) only when the record is
 * not what §191.3's assembly writes: a run's joined form missing from `markdown`, or standing across two blocks.
 */
export function transcriptBlocks(record: TranscriptLayers): BlockAlignment {
	const parts = segments(record.text), tail: TranscriptBlock[] = [];
	const take = (kind: BlockKind, count: number): boolean => {
		if (!count) return true;
		const last = parts.at(-1);
		if (!last || last.lines.length !== count) return false;
		parts.pop();
		tail.unshift({ kind, start: last.start, end: last.end, runs: 1 });
		return true;
	};
	if (!take("dropped", record.dropped.length)) return { ok: false, reason: "dropped_lines_not_last" };
	let markdown = record.markdown;
	if (record.unplaced.length) {
		const raw = parts.at(-1)?.lines.join("\n") ?? "", at = markdown.lastIndexOf(raw.trim());
		if (!take("unplaced", record.unplaced.length) || at < 0 || at + raw.trim().length !== markdown.length)
			return { ok: false, reason: "unplaced_lines_not_appended" };
		markdown = markdown.slice(0, at);
	}
	// A run's joined form under §191.3's rule, and under the rule before its hyphen amendment (records are never rewritten).
	const blocks = blocksOf(markdown), joined = parts.map(part => [...new Set([joinRun(part.lines), joinRun(part.lines, false)])]);
	// Leftmost places, each after the one before; rightmost places, each before the one after. A run's true place lies
	// between the two (the assembly wrote it there), so the blocks between them are where it stands.
	const place = (forms: readonly string[], find: (form: string) => number, better: (a: number, b: number) => boolean) => {
		let best: {at: number; length: number} | undefined;
		for (const form of forms) {
			const at = find(form);
			if (at >= 0 && (!best || better(at, best.at))) best = {at, length: form.length};
		}
		return best;
	};
	const left: number[] = [], right: number[] = [];
	let cursor = 0;
	for (const [index, forms] of joined.entries()) {
		// `markdown` is trimmed: the first run's leading whitespace may be gone.
		const found = place(index ? forms : [...forms, ...forms.map(form => form.trimStart())], form => markdown.indexOf(form, cursor), (a, b) => a < b);
		if (!found) return { ok: false, reason: "run_not_in_markdown", run: index };
		const block = blockAt(blocks, found.at, found.at + found.length);
		if (block < 0) return { ok: false, reason: "run_across_blocks", run: index };
		left.push(block);
		cursor = found.at + found.length;
	}
	let limit = markdown.length;
	for (let index = joined.length - 1; index >= 0; index--) {
		const forms = index ? joined[index] : [...joined[index], ...joined[index].map(form => form.trimStart())];
		const found = place(forms, form => form.length <= limit ? markdown.lastIndexOf(form, limit - form.length) : -1, (a, b) => a > b);
		const block = found ? blockAt(blocks, found.at, found.at + found.length) : -1;
		right[index] = block < left[index] ? left[index] : block;
		if (found) limit = found.at;
	}
	// A group of markdown blocks per run: one block when the places agree, every block between them when they do not.
	const group = blocks.map((_, index) => index);
	const root = (index: number): number => group[index] === index ? index : (group[index] = root(group[index]));
	let merged = 0;
	for (let index = 0; index < joined.length; index++)
		for (let block = Math.min(left[index], right[index]); block < Math.max(left[index], right[index]); block++)
			if (root(block) !== root(block + 1)) { group[root(block + 1)] = root(block); merged++; }
	const out: TranscriptBlock[] = [];
	for (const [index, part] of parts.entries()) {
		const key = root(left[index]), last = out.at(-1) as (TranscriptBlock & { key?: number }) | undefined;
		if (last && last.key === key) { last.end = part.end; last.runs++; continue; }
		const block = blocks[left[index]], members = blocks.filter((_, at) => root(at) === key);
		const kinds = new Set(members.map(member => member.kind)), kind: BlockKind = kinds.size === 1 ? block.kind : "paragraph";
		out.push(Object.assign({ kind, start: part.start, end: part.end, runs: 1, key },
			kind === "heading" ? { level: block.level, heading: members.map(member => member.heading).join(" ") } : {}));
	}
	return { ok: true, blocks: [...out.map(({ key: _key, ...block }: TranscriptBlock & { key?: number }) => block), ...tail], merged };
}

/** The headings a page's blocks hold, in order. */
export function pageHeadings(blocks: readonly TranscriptBlock[]): Heading[] {
	return blocks.filter(block => block.kind === "heading").map(block => ({ level: block.level!, text: block.heading! }));
}

/** The heading path a heading leaves open after `path`: every heading at its level or deeper closes. */
export function enterHeading(path: readonly Heading[], heading: Heading): Heading[] {
	return [...path.filter(open => open.level < heading.level), heading];
}

/**
 * §196.2: the heading path open at the top of a page, from the headings of the pages before it, nearest first (each page's
 * headings in page order). Walking back, a heading is an ancestor when it is shallower than every one taken so far; a
 * first-level heading ends the walk. Equal to folding `enterHeading` over every heading from the book's start.
 */
export function carriedPath(earlierPages: readonly (readonly Heading[])[]): Heading[] {
	const path: Heading[] = [];
	let limit = Infinity;
	for (const headings of earlierPages) for (let index = headings.length - 1; index >= 0; index--) {
		const heading = headings[index];
		if (heading.level >= limit) continue;
		path.unshift(heading);
		limit = heading.level;
		if (limit <= 1) return path;
	}
	return path;
}

/** Trailing closing punctuation and quotation marks, which may stand after a sentence's end. */
const CLOSING = /[\p{White_Space}\p{Pe}\p{Pf}\p{Quotation_Mark}]+$/u;
const TERMINAL = /\p{Sentence_Terminal}$/u;
/** §196.3: whether a stretch of text ends at a sentence end (`Sentence_Terminal`, closing punctuation allowed after it). */
export function endsSentence(text: string): boolean {
	return TERMINAL.test(text.replace(CLOSING, ""));
}

export interface PageParagraph {
	kind: BlockKind;
	start: number;
	end: number;
	/** The heading path above it: the page's own headings over the path carried into the page's top. */
	section: string[];
	/** This page's last body block, not ended at a sentence end: it may run on to the next page. */
	open?: true;
	/** This page's first block, body text: it may continue the previous page's last. */
	head?: true;
}

/**
 * §196.1-196.3: a page's units -- every block but its headings and its dropped lines (page furniture) -- each with the
 * heading path above it, and the two boundary blocks a page break can join.
 */
export function pageParagraphs(blocks: readonly TranscriptBlock[], text: string, carried: readonly Heading[]): PageParagraph[] {
	let path = [...carried];
	const out: PageParagraph[] = [];
	const flow = blocks.filter(block => !ASIDE.has(block.kind)), first = flow[0], last = flow.at(-1);
	for (const block of blocks) {
		if (block.kind === "heading") { path = enterHeading(path, { level: block.level!, text: block.heading! }); continue; }
		if (block.kind === "dropped") continue;
		const unit: PageParagraph = { kind: block.kind, start: block.start, end: block.end, section: path.map(heading => heading.text) };
		if (block === last && BODY.has(block.kind) && !endsSentence(text.slice(block.start, block.end))) unit.open = true;
		if (block === first && BODY.has(block.kind)) unit.head = true;
		out.push(unit);
	}
	return out;
}

/** §196.3: a page's open last body block continues on the next page's first block when both are body text of one kind. */
export function continuesAcross(before: readonly PageParagraph[], after: readonly PageParagraph[]): boolean {
	const open = before.find(unit => unit.open), head = after.find(unit => unit.head);
	return !!open && !!head && open.kind === head.kind;
}

/** §196.1: the cap past which one block is split into several units (the length today's slices are bounded by). */
export const PARAGRAPH_UNIT_CAP = 800;
const SPACE = /[\p{White_Space}]/u;
const CLOSER = /[\p{Pe}\p{Pf}\p{Quotation_Mark}]/u;
const DIGIT = /\p{Nd}/u;
const high = (unit: number) => unit >= 0xd800 && unit <= 0xdbff;
const low = (unit: number) => unit >= 0xdc00 && unit <= 0xdfff;

/** Where a sentence ending at `at` (a `Sentence_Terminal`) ends: past the closers and spaces after it, within `limit`. */
function sentenceEnd(text: string, at: number, limit: number): number {
	let end = at + 1;
	while (end < limit && (/\p{Sentence_Terminal}/u.test(text[end]) || CLOSER.test(text[end]))) end++;
	while (end < limit && SPACE.test(text[end])) end++;
	return end;
}

/**
 * §196.1: `text.slice(start, end)` as one unit, or -- past `cap` UTF-16 units -- as consecutive pieces of at most `cap`, each
 * ending at the last sentence end inside its window (a `Sentence_Terminal`, not a full stop between two digits), else at
 * the last line break, else at the cap (never inside a surrogate pair).
 */
export function paragraphSlices(text: string, start: number, end: number, cap = PARAGRAPH_UNIT_CAP): Array<{start: number; end: number}> {
	const out: Array<{start: number; end: number}> = [];
	let from = start;
	while (end - from > cap) {
		let limit = from + cap;
		if (high(text.charCodeAt(limit - 1)) && low(text.charCodeAt(limit))) limit--;
		let cut = 0;
		for (let at = limit - 1; at > from && !cut; at--) {
			if (!/\p{Sentence_Terminal}/u.test(text[at]) || text[at] === "." && DIGIT.test(text[at - 1] ?? "") && DIGIT.test(text[at + 1] ?? "")) continue;
			const after = sentenceEnd(text, at, limit);
			if (after > from && after <= limit) cut = after;
		}
		if (!cut) { const line = text.lastIndexOf("\n", limit - 1); cut = line > from ? line + 1 : limit; }
		out.push({start: from, end: cut});
		from = cut;
	}
	if (end > from) out.push({start: from, end});
	return out;
}
