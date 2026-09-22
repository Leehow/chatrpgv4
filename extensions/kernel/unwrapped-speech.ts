/**
 * Quoted passages a draft leaves outside every say token (contract §127.2).
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
import { speechPass } from "../../kernel-ts/write/speech-pass.ts";

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

/**
 * The passages of `draft` written in a pair this table writes speech with, lying outside every say
 * span, in text order and each shortened to an excerpt. `known` adds pairs learned from earlier
 * deliveries; the draft's own spans are always read. Empty when no pair is known.
 */
export function unwrappedQuotes(draft: string, known: Iterable<string> = []): string[] {
	const spoken = speechPass(draft, (name) => ({ label: name }));
	const marks = new Set(known);
	learnSpeechMarks(marks, spoken.speech);
	if (!marks.size) return [];
	const outside = spoken.text.replace(SPAN, "\n\n").replace(MARKER, "");
	const passages: Array<{ at: number; text: string }> = [];
	let offset = 0;
	for (const paragraph of outside.split(PARAGRAPH)) {
		for (const pair of marks) {
			const [open, close] = pair.split("\u0000");
			let from = 0;
			for (const text of enclosed(paragraph, open, close)) {
				const at = paragraph.indexOf(text, from);
				from = at + text.length;
				if (WORDS.test(text)) passages.push({ at: offset + at, text });
			}
		}
		offset += paragraph.length + 2;
	}
	passages.sort((a, b) => a.at - b.at || b.text.length - a.text.length);
	// A passage in one learned pair nested inside a passage in another is the same passage.
	let reach = -1;
	return passages
		.filter(({ at, text }) => {
			if (at + text.length <= reach) return false;
			reach = at + text.length;
			return true;
		})
		.map(({ text }) => {
			const chars = [...text];
			return chars.length > EXCERPT ? `${chars.slice(0, EXCERPT - 1).join("")}…` : text;
		});
}
