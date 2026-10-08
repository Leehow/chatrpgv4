/**
 * Contract §191.3: a page transcript's layout grammar and its deterministic assembly. Pure functions, no I/O.
 *
 * The layout is the agent's (`content/setup/page-transcript.md`): any Markdown structure, the page's text only as line
 * placeholders. The words are the host's: every native line (§191.1) lands in the exact layer `text` exactly once, and a
 * page whose `text` is not a permutation of its native lines is never stored. Nothing here decides a layout -- no column
 * threshold, no font-size heading, no reading-order rule. What is parsed is closed syntax: placeholders, the drop list,
 * the image-text markers, figure-note lines and CommonMark's own block and emphasis markers around typed words.
 */

export const TRANSCRIPT_VERSION = "transcript-v1";

/** One placeholder, `{L<n>}` or `{L<a>-L<b>}`; spacing and an en dash inside the braces are tolerated. */
const PLACEHOLDER = /\{\s*L(\d+)\s*(?:[-–]\s*L?(\d+)\s*)?\}/g;
/** The drop list, anywhere in the layout: `<!-- drop: L3 L4 L7-L9 -->`. */
const DROP_LIST = /<!--\s*drop\s*:([\s\S]*?)-->/gi;
const DROP_ENTRY = /L\s*(\d+)(?:\s*[-–]\s*L?\s*(\d+))?/gi;
const IMAGE_TEXT_MARKER = /<!--\s*(\/?)\s*image-text\s*-->/gi;
const COMMENT = /<!--[\s\S]*?-->/g;
/** A figure note: the line's content begins `[figure]` after any blockquote markers. */
const FIGURE_NOTE = /^\s*(?:>\s*)*\[figure\]/i;
/** CommonMark block markers that open a Markdown line: blockquotes, then a heading, bullet or ordered-list marker. */
const BLOCK_PREFIX = /^\s*(?:>\s?)*\s*(?:#{1,6}(?=\s|$)\s*|[-*+](?=\s|$)\s*|\d{1,9}[.)](?=\s|$)\s*)?/u;
const EMPHASIS_LEAD = /^[\s*_~`]*/u;
/** Table cell pipes and inline HTML tags separate typed words from one another and are kept as structure. */
const MARKUP_SEPARATOR = /(\||<\/?[A-Za-z][^<>]*>)/;
const EMPHASIS_TRAIL = /[\s*_~`]*$/u;
/** Typed text counts as words only when it carries a letter or a number; bare punctuation and markup are structure. */
const WORD = /[\p{L}\p{N}]/u;

/**
 * East Asian Width W and F code points (Unicode 15.1 `EastAsianWidth.txt`), as inclusive [first, last] pairs. Typography,
 * not language: two runs of wide characters are set without a space between them, everything else with one.
 */
const WIDE: readonly number[] = Object.freeze([
	0x1100, 0x115F, 0x231A, 0x231B, 0x2329, 0x232A, 0x23E9, 0x23EC, 0x23F0, 0x23F0, 0x23F3, 0x23F3, 0x25FD, 0x25FE,
	0x2614, 0x2615, 0x2648, 0x2653, 0x267F, 0x267F, 0x2693, 0x2693, 0x26A1, 0x26A1, 0x26AA, 0x26AB, 0x26BD, 0x26BE,
	0x26C4, 0x26C5, 0x26CE, 0x26CE, 0x26D4, 0x26D4, 0x26EA, 0x26EA, 0x26F2, 0x26F3, 0x26F5, 0x26F5, 0x26FA, 0x26FA,
	0x26FD, 0x26FD, 0x2705, 0x2705, 0x270A, 0x270B, 0x2728, 0x2728, 0x274C, 0x274C, 0x274E, 0x274E, 0x2753, 0x2755,
	0x2757, 0x2757, 0x2795, 0x2797, 0x27B0, 0x27B0, 0x27BF, 0x27BF, 0x2B1B, 0x2B1C, 0x2B50, 0x2B50, 0x2B55, 0x2B55,
	0x2E80, 0x2E99, 0x2E9B, 0x2EF3, 0x2F00, 0x2FD5, 0x2FF0, 0x303E, 0x3041, 0x3096, 0x3099, 0x30FF, 0x3105, 0x312F,
	0x3131, 0x318E, 0x3190, 0x31E3, 0x31EF, 0x321E, 0x3220, 0x3247, 0x3250, 0x4DBF, 0x4E00, 0xA48C, 0xA490, 0xA4C6,
	0xA960, 0xA97C, 0xAC00, 0xD7A3, 0xF900, 0xFAFF, 0xFE10, 0xFE19, 0xFE30, 0xFE52, 0xFE54, 0xFE66, 0xFE68, 0xFE6B,
	0xFF01, 0xFF60, 0xFFE0, 0xFFE6, 0x16FE0, 0x16FE4, 0x16FF0, 0x16FF1, 0x17000, 0x187F7, 0x18800, 0x18CD5,
	0x18D00, 0x18D08, 0x1AFF0, 0x1AFF3, 0x1AFF5, 0x1AFFB, 0x1AFFD, 0x1AFFE, 0x1B000, 0x1B122, 0x1B132, 0x1B132,
	0x1B150, 0x1B152, 0x1B155, 0x1B155, 0x1B164, 0x1B167, 0x1B170, 0x1B2FB, 0x1F004, 0x1F004, 0x1F0CF, 0x1F0CF,
	0x1F18E, 0x1F18E, 0x1F191, 0x1F19A, 0x1F200, 0x1F202, 0x1F210, 0x1F23B, 0x1F240, 0x1F248, 0x1F250, 0x1F251,
	0x1F260, 0x1F265, 0x1F300, 0x1F320, 0x1F32D, 0x1F335, 0x1F337, 0x1F37C, 0x1F37E, 0x1F393, 0x1F3A0, 0x1F3CA,
	0x1F3CF, 0x1F3D3, 0x1F3E0, 0x1F3F0, 0x1F3F4, 0x1F3F4, 0x1F3F8, 0x1F43E, 0x1F440, 0x1F440, 0x1F442, 0x1F4FC,
	0x1F4FF, 0x1F53D, 0x1F54B, 0x1F54E, 0x1F550, 0x1F567, 0x1F57A, 0x1F57A, 0x1F595, 0x1F596, 0x1F5A4, 0x1F5A4,
	0x1F5FB, 0x1F64F, 0x1F680, 0x1F6C5, 0x1F6CC, 0x1F6CC, 0x1F6D0, 0x1F6D2, 0x1F6D5, 0x1F6D7, 0x1F6DC, 0x1F6DF,
	0x1F6EB, 0x1F6EC, 0x1F6F4, 0x1F6FC, 0x1F7E0, 0x1F7EB, 0x1F7F0, 0x1F7F0, 0x1F90C, 0x1F93A, 0x1F93C, 0x1F945,
	0x1F947, 0x1F9FF, 0x1FA70, 0x1FA7C, 0x1FA80, 0x1FA88, 0x1FA90, 0x1FABD, 0x1FABF, 0x1FAC5, 0x1FACE, 0x1FADB,
	0x1FAE0, 0x1FAE8, 0x1FAF0, 0x1FAF8, 0x20000, 0x2FFFD, 0x30000, 0x3FFFD
]);

export function eastAsianWide(codePoint: number | undefined): boolean {
	if (codePoint === undefined) return false;
	let low = 0, high = WIDE.length / 2 - 1;
	while (low <= high) {
		const middle = (low + high) >> 1, first = WIDE[middle * 2], last = WIDE[middle * 2 + 1];
		if (codePoint < first) high = middle - 1;
		else if (codePoint > last) low = middle + 1;
		else return true;
	}
	return false;
}

function lastCodePoint(value: string): number | undefined {
	if (!value) return undefined;
	const unit = value.charCodeAt(value.length - 1);
	return unit >= 0xDC00 && unit <= 0xDFFF && value.length > 1 ? value.codePointAt(value.length - 2) : value.codePointAt(value.length - 1);
}

/**
 * A run's lines as one stretch of reading text: no separator when either side of a join is East Asian Wide or Fullwidth,
 * else one space -- and none when a side already ends or begins with whitespace, so a join never doubles one, or when the
 * left line ends in a hyphen (a word broken at the line end keeps its hyphen and loses the gap: typography, not language).
 */
/** Hyphen-minus, hyphen and soft hyphen at the end of a line. */
const LINE_END_HYPHEN = /[\u002D\u2010\u00AD]$/u;
export function joinRun(parts: readonly string[]): string {
	let out = "";
	for (const part of parts) {
		if (out && part && !eastAsianWide(lastCodePoint(out)) && !eastAsianWide(part.codePointAt(0)) && !/\s$/u.test(out) && !/^\s/u.test(part)
			&& !LINE_END_HYPHEN.test(out))
			out += " ";
		out += part;
	}
	return out;
}

/** §191.1: the native text's lines -- split at `"\n"`, whitespace-only entries removed, every other entry byte for byte. */
export function nativeLines(text: string): string[] {
	return text.split("\n").filter(line => /\S/u.test(line));
}

/** §191.2: the child's `lines.txt`. */
export function linesFile(lines: readonly string[]): string {
	return lines.length ? lines.map((line, index) => `L${index + 1}: ${line}`).join("\n") + "\n" : "(this page has no text layer)\n";
}

/**
 * §191.2: what `submit_layout` answers about one submission -- the lines it neither placed nor dropped, each with its text,
 * and what the assembly ignored or removed. `left` is how many more submissions the child may make; `kept` is false when an
 * earlier submission left fewer lines out and stays the stored layout.
 */
export function layoutFindings(assembly: PageAssembly, lines: readonly string[], left: number, kept = true): string {
	const notes: string[] = [];
	if (!kept) notes.push("An earlier submission left fewer lines out; the host keeps that one.");
	if (assembly.ignored) notes.push(`${assembly.ignored} placeholder number(s) matched no line of this page (it has ${lines.length}) and were ignored.`);
	if (assembly.free_removed) notes.push(`${assembly.free_removed} piece(s) of typed text matched no line and were removed: only placeholders carry the page's text.`);
	const tail = notes.length ? "\n" + notes.join("\n") : "";
	if (!assembly.unplaced.length) return `Layout stored: every line is placed or dropped. You are done.${tail}`;
	const missing = assembly.unplaced.map(id => `L${id}: ${lines[id - 1] ?? ""}`).join("\n");
	if (left <= 0) return `Layout stored. These lines are still neither placed nor dropped; the host appends them after your layout. You are done.\n${missing}${tail}`;
	return `Layout stored, but these lines are neither placed nor dropped:\n${missing}\nPlace each one where it belongs in the reading order, `
		+ "or add it to the drop list if it is page furniture, then call submit_layout again with the whole corrected layout "
		+ `(${left} more submission${left === 1 ? "" : "s"} allowed).${tail}`;
}

/** The key free text and a native line are compared under (§191.3): NFKC, whitespace removed. */
export function lineKey(value: string): string {
	return value.normalize("NFKC").replace(/\s+/gu, "");
}

/** §191.3's invariant: the multiset of `text`'s non-empty lines equals the multiset of the native lines. */
export function transcriptPermutationHolds(text: string, lines: readonly string[]): boolean {
	const counts = new Map<string, number>();
	for (const line of lines) counts.set(line, (counts.get(line) ?? 0) + 1);
	for (const line of text.split("\n")) {
		if (line === "") continue;
		const left = counts.get(line);
		if (!left) return false;
		counts.set(line, left - 1);
	}
	for (const left of counts.values()) if (left) return false;
	return true;
}

export interface PageAssembly {
	/** The exact layer: placed lines in layout order, then `unplaced`, then dropped lines, blocks separated by a blank line. */
	text: string;
	/** The reading version: runs filled, figure notes and marked image text kept, dropped lines left out. */
	markdown: string;
	image_text: string[];
	figures: string[];
	/** Placed lines in layout order (placeholders, and typed text mapped back to a line). */
	order: number[];
	/** Dropped and never placed, native order. */
	dropped: number[];
	/** Neither placed nor dropped, native order: appended after the placed lines. */
	unplaced: number[];
	/** Typed words outside image text and figure notes that equal no line, removed. */
	free_removed: number;
	/** Typed text equal to a line no placeholder used, placed where it was typed. */
	mapped: number;
	/** A second placement of a placed line, or typed text equal to one: removed. */
	duplicates: number;
	/** Line numbers outside `1..line_count` and reversed ranges: ignored. */
	ignored: number;
}

type Token = {kind: "text"; value: string} | {kind: "place"; ids: number[]};
interface LayoutLine {tokens: Token[]; exempt: boolean; figure: boolean}

/** The numbers `first..last` names inside `1..count`, and how many it names outside (a reversed range counts once). */
function lineRange(first: number, last: number, count: number): {ids: number[]; ignored: number} {
	if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || last < first) return {ids: [], ignored: 1};
	const low = Math.max(first, 1), high = Math.min(last, count);
	const ids = high >= low ? Array.from({length: high - low + 1}, (_, index) => low + index) : [];
	return {ids, ignored: last - first + 1 - ids.length};
}

function tokenize(line: string, count: number, ignore: (n: number) => void): Token[] {
	const tokens: Token[] = [];
	let cursor = 0;
	for (const match of line.matchAll(PLACEHOLDER)) {
		if (match.index > cursor) tokens.push({kind: "text", value: line.slice(cursor, match.index)});
		const first = Number(match[1]), range = lineRange(first, match[2] === undefined ? first : Number(match[2]), count);
		ignore(range.ignored);
		tokens.push({kind: "place", ids: range.ids});
		cursor = match.index + match[0].length;
	}
	if (cursor < line.length) tokens.push({kind: "text", value: line.slice(cursor)});
	return tokens;
}

const stripPlaceholders = (value: string) => value.replace(PLACEHOLDER, "");

/** §191.3: parse one `layout.md` against the page's native lines and assemble the page's products. */
export function assembleLayout(layout: string, lines: readonly string[]): PageAssembly {
	const count = lines.length;
	let ignored = 0;
	const ignore = (n: number) => { ignored += n; };

	// The drop list may sit anywhere and may name ranges.
	const dropSet = new Set<number>();
	const body = layout.replace(/\r\n?/g, "\n").replace(DROP_LIST, (_whole, list: string) => {
		for (const entry of list.matchAll(DROP_ENTRY)) {
			const first = Number(entry[1]), range = lineRange(first, entry[2] === undefined ? first : Number(entry[2]), count);
			ignored += range.ignored;
			for (const id of range.ids) dropSet.add(id);
		}
		return "";
	});

	// Image text between its markers; a stray or nested marker is removed and its block goes on.
	const segments: Array<{image: boolean; text: string}> = [];
	let image = false, buffer = "", cursor = 0;
	for (const marker of body.matchAll(IMAGE_TEXT_MARKER)) {
		buffer += body.slice(cursor, marker.index);
		cursor = marker.index + marker[0].length;
		const closing = marker[1] === "/";
		if (image === closing) { segments.push({image, text: buffer}); buffer = ""; image = !image; }
	}
	segments.push({image, text: buffer + body.slice(cursor)});

	const layoutLines: LayoutLine[][] = segments.map(segment => segment.text.replace(COMMENT, "").split("\n").map(line => {
		const figure = !segment.image && FIGURE_NOTE.test(line);
		return {tokens: tokenize(line, count, ignore), exempt: segment.image || figure, figure};
	}));

	// Pass 1: what the placeholders place, wherever they stand.
	const placeholderIds = new Set<number>();
	for (const line of layoutLines.flat())
		for (const token of line.tokens) if (token.kind === "place") for (const id of token.ids) placeholderIds.add(id);

	const byKey = new Map<string, number[]>();
	lines.forEach((line, index) => {
		const key = lineKey(line);
		if (key) byKey.set(key, [...(byKey.get(key) ?? []), index + 1]);
	});

	// Pass 2, in layout order: first placement wins; typed words are mapped back to a line, or removed.
	const placed = new Set<number>(), order: number[] = [];
	let freeRemoved = 0, mapped = 0, duplicates = 0;
	const place = (ids: number[]): number[] => {
		const kept: number[] = [];
		for (const id of ids) {
			if (placed.has(id)) { duplicates++; continue; }
			placed.add(id); order.push(id); kept.push(id);
		}
		return kept;
	};
	const kept: Array<Array<LayoutLine | null>> = layoutLines.map(segment => segment.map(line => {
		const tokens: Token[] = [];
		let removed = false;
		const pushText = (value: string) => { if (value) tokens.push({kind: "text", value}); };
		line.tokens.forEach((token, tokenIndex) => {
			if (token.kind === "place") { const ids = place(token.ids); if (ids.length) tokens.push({kind: "place", ids}); return; }
			if (line.exempt) { pushText(token.value); return; }
			token.value.split(MARKUP_SEPARATOR).forEach((piece, pieceIndex) => {
				if (pieceIndex % 2 === 1 || !WORD.test(piece)) { pushText(piece); return; }
				const prefix = tokenIndex === 0 && pieceIndex === 0 ? piece.match(BLOCK_PREFIX)![0] : "";
				let rest = piece.slice(prefix.length);
				const lead = rest.match(EMPHASIS_LEAD)![0];
				rest = rest.slice(lead.length);
				const trail = rest.match(EMPHASIS_TRAIL)![0], core = rest.slice(0, rest.length - trail.length);
				if (!WORD.test(core)) { pushText(piece); return; }
				const candidates = byKey.get(lineKey(core)) ?? [];
				const id = candidates.find(candidate => !placeholderIds.has(candidate) && !placed.has(candidate));
				if (id !== undefined) {
					pushText(prefix + lead);
					placed.add(id); order.push(id); mapped++;
					tokens.push({kind: "place", ids: [id]});
					pushText(trail);
					return;
				}
				if (candidates.length) duplicates++;
				else freeRemoved++;
				removed = true;
				pushText(prefix + lead.match(/^\s*/u)![0]);
				pushText(trail.match(/\s*$/u)![0]);
			});
		});
		const words = tokens.some(token => token.kind === "place" || WORD.test(token.value));
		return removed && !words ? null : {...line, tokens};
	}));

	const dropped = [...dropSet].filter(id => !placed.has(id)).sort((a, b) => a - b);
	const unplaced = Array.from({length: count}, (_, index) => index + 1).filter(id => !placed.has(id) && !dropSet.has(id));

	// Runs: placeholders standing next to each other on one Markdown line, with nothing typed between them.
	const runs: number[][] = [];
	const render = (line: LayoutLine): string => {
		let out = "", run: number[] | null = null;
		const flush = () => { if (run) { out += joinRun(run.map(id => lines[id - 1])); runs.push(run); run = null; } };
		for (const token of line.tokens) {
			if (token.kind === "place") { run = [...(run ?? []), ...token.ids]; continue; }
			flush();
			out += token.value;
		}
		flush();
		return out;
	};
	const image_text: string[] = [], figures: string[] = [];
	let markdown = "";
	segments.forEach((segment, index) => {
		const rendered = kept[index].filter((line): line is LayoutLine => line !== null).map(render).join("\n");
		if (!segment.image) {
			markdown += rendered;
			for (const line of kept[index]) if (line?.figure) {
				const note = stripPlaceholders(line.tokens.map(token => token.kind === "text" ? token.value : "").join("")).replace(FIGURE_NOTE, "").trim();
				if (note) figures.push(note);
			}
			return;
		}
		markdown += `<!-- image-text -->${rendered}<!-- /image-text -->`;
		const typed = stripPlaceholders(segment.text.replace(COMMENT, "")).trim();
		if (typed) image_text.push(typed);
	});
	if (unplaced.length) markdown += `\n\n${unplaced.map(id => lines[id - 1]).join("\n")}`;
	markdown = markdown.replace(/\n{3,}/g, "\n\n").trim();

	const block = (ids: readonly number[]) => ids.map(id => lines[id - 1]).join("\n");
	const text = [...runs.map(block), ...(unplaced.length ? [block(unplaced)] : []), ...(dropped.length ? [block(dropped)] : [])].join("\n\n");
	return {text, markdown, image_text, figures, order, dropped, unplaced, free_removed: freeRemoved, mapped, duplicates, ignored};
}
