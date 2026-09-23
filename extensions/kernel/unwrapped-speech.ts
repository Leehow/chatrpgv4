/**
 * Quoted passages a draft leaves outside every say token (contract §128.2).
 *
 * §40.1 keeps the quotation marks the play language writes speech with *inside* the say token, so a
 * wrapped line tells the host which marks this table writes speech with: its first and last
 * characters, when both carry Unicode's `Quotation_Mark` property. That pair is learned from the
 * Keeper's own spans -- in this draft, or in lines this session already delivered -- and never from a
 * table of languages or of marks. A passage in the same marks outside every span is reported here.
 *
 * This decides nothing about who speaks, whether the passage is speech at all, or what language it is
 * in. A quoted word, title or sign in the same marks is reported too; the steer that reads this list
 * says so and leaves the call to the Keeper, and is spent once per turn whatever the Keeper answers.
 */
import { NAME_LIMIT, speechPass } from "../../kernel-ts/write/speech-pass.ts";

const QUOTE = /^\p{Quotation_Mark}$/u;
const SPAN = /\{\{say:[^}\n]*\}\}[\s\S]*?\{\{\/say\}\}/g;
const MARKER = /\{\{[^{}\n]*\}\}/g;
const PARAGRAPH = /\n[ \t]*\n/;
const WORDS = /[\p{L}\p{N}]/u;
/** How much of each passage the steer quotes back. */
const EXCERPT = 40;

/** One pair as a key: open and close characters, which may be the same character. */
export type SpeechMarks = Set<string>;
const key = (open: string, close: string) => `${open}\u0000${close}`;

/** The pair a spoken line is written in, when both of its ends are quotation marks. */
export function marksOf(line: unknown): [string, string] | undefined {
	const chars = [...String(line ?? "").trim()];
	if (chars.length < 2) return undefined;
	const open = chars[0], close = chars[chars.length - 1];
	return QUOTE.test(open) && QUOTE.test(close) ? [open, close] : undefined;
}

/** Learn the pairs of delivered lines (`speech[].text` of a narrate or ask result) into `marks`. */
export function learnSpeechMarks(marks: SpeechMarks, speech: unknown): void {
	if (!Array.isArray(speech)) return;
	for (const row of speech) {
		const pair = marksOf((row as { text?: unknown } | null)?.text);
		if (pair) marks.add(key(...pair));
	}
}

/** Passages of one paragraph enclosed by `open`…`close`; nested opens of the same mark are counted. */
function enclosed(paragraph: string, open: string, close: string): string[] {
	const chars = [...paragraph], found: string[] = [];
	let depth = 0, start = -1;
	for (let at = 0; at < chars.length; at++) {
		const char = chars[at];
		if (open === close) {
			if (char !== open) continue;
			if (start < 0) start = at;
			else { found.push(chars.slice(start, at + 1).join("")); start = -1; }
			continue;
		}
		if (char === open) { if (depth++ === 0) start = at; }
		else if (char === close && depth > 0 && --depth === 0) found.push(chars.slice(start, at + 1).join(""));
	}
	return found;
}

/** One passage outside every say span, located in the repaired draft (`speechPass`'s text). */
export interface UnwrappedPassage {
	/** Half-open UTF-16 range in the repaired draft, quotation marks included. */
	start: number;
	end: number;
	/** The passage exactly as written, marks included. */
	text: string;
}

/** Same length, so every offset found in the masked text is an offset in the repaired draft. */
const mask = (text: string, pattern: RegExp, fill: string) => text.replace(pattern, (whole) => fill.repeat(whole.length));

/**
 * The passages of `draft` written in a pair this table writes speech with, lying outside every say
 * span, in text order, with their place in the repaired draft (`text`, the kernel's own token repair
 * of §40.1, so a span the Keeper left open is closed where the kernel would close it). `known` adds
 * pairs learned from earlier deliveries; the draft's own spans are always read. Empty when no pair is
 * known. A passage nested inside another (one learned pair inside another) is the outer one only.
 */
export function unwrappedPassages(draft: string, known: Iterable<string> = []): { text: string; passages: UnwrappedPassage[] } {
	const spoken = speechPass(draft, (name) => ({ label: name }));
	const marks = new Set(known);
	learnSpeechMarks(marks, spoken.speech);
	if (!marks.size) return { text: spoken.text, passages: [] };
	// A span becomes a paragraph break and a marker becomes blank, as they did when they were cut out;
	// masking keeps their length, so a passage's offsets need no mapping back.
	const outside = mask(mask(spoken.text, SPAN, "\n"), MARKER, " ");
	const found: UnwrappedPassage[] = [];
	const paragraphs: Array<{ at: number; text: string }> = [];
	const breaks = new RegExp(PARAGRAPH.source, "g");
	let from = 0;
	for (let match = breaks.exec(outside); match; match = breaks.exec(outside)) {
		paragraphs.push({ at: from, text: outside.slice(from, match.index) });
		from = match.index + match[0].length;
	}
	paragraphs.push({ at: from, text: outside.slice(from) });
	for (const paragraph of paragraphs) {
		for (const pair of marks) {
			const [open, close] = pair.split("\u0000");
			let cursor = 0;
			for (const text of enclosed(paragraph.text, open, close)) {
				const at = paragraph.text.indexOf(text, cursor);
				cursor = at + text.length;
				if (WORDS.test(text)) found.push({ start: paragraph.at + at, end: paragraph.at + at + text.length, text: "" });
			}
		}
	}
	found.sort((a, b) => a.start - b.start || b.end - a.end);
	// A passage in one learned pair nested inside a passage in another is the same passage.
	let reach = -1;
	const passages = found
		.filter(({ start, end }) => {
			if (end <= reach) return false;
			reach = end;
			return true;
		})
		.map(({ start, end }) => ({ start, end, text: spoken.text.slice(start, end) }));
	return { text: spoken.text, passages };
}

/**
 * The passages of `draft` written in a pair this table writes speech with, lying outside every say
 * span, in text order and each shortened to an excerpt (mechanics markers are not text). `known` adds
 * pairs learned from earlier deliveries; the draft's own spans are always read. Empty when no pair is
 * known.
 */
export function unwrappedQuotes(draft: string, known: Iterable<string> = []): string[] {
	return unwrappedPassages(draft, known).passages.map(({ text }) => {
		const chars = [...text.replace(MARKER, "")];
		return chars.length > EXCERPT ? `${chars.slice(0, EXCERPT - 1).join("")}…` : text.replace(MARKER, "");
	});
}

/** The say token's name rule (§40.1): anything but `}}` and a line break, trimmed, 1–60 characters. */
export function sayableName(name: string): boolean {
	const trimmed = name.trim();
	return trimmed === name && trimmed.length >= 1 && trimmed.length <= NAME_LIMIT && !trimmed.includes("}}") && !/[\r\n]/.test(trimmed);
}

/**
 * Wrap passages of the repaired draft in say tokens, words untouched: `{{say:<name>}}` before each
 * passage and `{{/say}}` after it. Ranges must come from `unwrappedPassages` over the same text.
 */
export function wrapPassages(text: string, wraps: Array<{ start: number; end: number; name: string }>): string {
	let out = text;
	for (const wrap of [...wraps].sort((a, b) => b.start - a.start)) {
		if (!sayableName(wrap.name)) continue;
		out = `${out.slice(0, wrap.start)}{{say:${wrap.name}}}${out.slice(wrap.start, wrap.end)}{{/say}}${out.slice(wrap.end)}`;
	}
	return out;
}

const SENTENCES = new Intl.Segmenter(undefined, { granularity: "sentence" });
/**
 * The sentences around a passage, as the reader of the delivery reads them (tokens stripped): up to
 * the last two sentences before it and the first two after it, each side clipped. Segmentation is
 * Unicode's sentence boundaries, not a reading of the words.
 */
export function surroundingSentences(text: string, passage: { start: number; end: number }, limits = { before: 300, after: 160 }):
	{ before: string; after: string } {
	const plain = (value: string) => value.replace(MARKER, "");
	const earlier = [...SENTENCES.segment(plain(text.slice(0, passage.start)))].map((row) => row.segment);
	const before = earlier.slice(-2).join("").trimStart();
	const later = [...SENTENCES.segment(plain(text.slice(passage.end)))].map((row) => row.segment);
	const after = later.slice(0, 2).join("").trimEnd();
	return {
		before: before.length > limits.before ? before.slice(before.length - limits.before) : before,
		after: after.length > limits.after ? after.slice(0, limits.after) : after,
	};
}
