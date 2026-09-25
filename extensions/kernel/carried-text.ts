/**
 * Contract §11.5.4 (SL-51): a person the carried source text names is known to the run.
 *
 * SL-29A batch 5, t7: SL-47 landed the party on `esso-station`'s index page and carried the page to the Keeper; the page
 * names the three men under the canopy verbatim. The Keeper placed two of them before the scene's reviewed record landed
 * and was refused `unknown_entity` for both: the product treated the book's own words, which the host itself had carried,
 * as an invention. The text arrives before the record by design (§22.4.7).
 *
 * This module is the host's list of the source text it put in front of the Keeper this turn -- the pages of a `scene_text`
 * view and the book passages of a `source` view (the engine reports what its note carried), or the pages a landed move put
 * in the legacy apply result -- and the one lookup a write about a person makes in it: the name, exactly, after the kernel's
 * name normalization with every whitespace removed (a page's line breaks are layout). No near name, no alias, nothing
 * about a language. What it finds rides on the effect as the host-only `_passage`; the kernel decides.
 */
type Row = Record<string, any>;

/** One carried passage of the turn: the scene it was carried for, its page when it is a page, and its text. */
export interface CarriedPassage {scene: string | null; page: number | null; label: string | null; text: string}
/** What rides on the effect (`_passage`): where the name was found, and the sentence that holds it. */
export interface PassageMatch {scene: string | null; page: number | null; label: string | null; sentence: string}

/** A sentence longer than this is cut to this many characters around the name. */
export const PASSAGE_SENTENCE_CHARS = 300;
/** The typed reviewer's `bookText` (§11.5.4): each passage clipped to this, and the whole to `BOOK_TEXT_TOTAL_CHARS`. */
export const BOOK_TEXT_PASSAGE_CHARS = 1500;
export const BOOK_TEXT_TOTAL_CHARS = 4000;

/**
 * The kernel's name normalization (`kernel-ts/read/values.ts` `normalize`: NFKC, lower case, `_`/`-` and whitespace as
 * one separator) with every separator removed -- `passageKey` on the kernel side. Kept identical on purpose: the kernel
 * re-checks the sentence under its own copy, and a disagreement only means a refusal as before.
 */
export const passageKey = (value: unknown): string => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[\s_\-]+/gu, '');

/** `text` with every character that `passageKey` keeps, and for each the index of that character in `text`. */
function compacted(text: string): {key: string; at: number[]} {
	let key = '';
	const at: number[] = [];
	let index = 0;
	for (const char of text) {
		const folded = passageKey(char);
		for (const unit of folded) { key += unit; at.push(index); }
		index += char.length;
	}
	return {key, at};
}

/** The sentence of `text` that holds `[start, end)`, whitespace runs collapsed; cut around the match when it is long. */
function sentenceAround(source: string, start: number, end: number): string {
	// A page's hard line breaks are layout, not sentence ends: they become spaces (same length, so the offsets hold).
	const text = source.replace(/[\r\n]/gu, ' ');
	let from = 0, to = text.length;
	try {
		for (const {index, segment} of new Intl.Segmenter(undefined, {granularity: 'sentence'}).segment(text)) {
			const stop = index + segment.length;
			if (index <= start && start < stop) from = index;
			if (index < end && end <= stop) { to = stop; break; }
		}
	} catch { /* no segmenter: the window below still holds the name */ }
	if (to - from > PASSAGE_SENTENCE_CHARS) {
		const room = Math.max(0, PASSAGE_SENTENCE_CHARS - (end - start)), before = Math.floor(room / 2);
		from = Math.max(from, start - before);
		to = Math.min(to, from + Math.max(PASSAGE_SENTENCE_CHARS, end - from));
	}
	return text.slice(from, to).replace(/\s+/gu, ' ').trim();
}

/**
 * The first passage (newest first) whose text holds `name` exactly under `passageKey`, with its sentence; none for a name
 * shorter than two characters under that comparison, and none when no passage holds it.
 */
export function findPassage(passages: readonly CarriedPassage[], name: unknown): PassageMatch | undefined {
	if (typeof name !== 'string') return undefined;
	const wanted = passageKey(name);
	if ([...wanted].length < 2) return undefined;
	for (const passage of [...passages].reverse()) {
		const {key, at} = compacted(passage.text);
		const found = key.indexOf(wanted);
		if (found < 0) continue;
		const start = at[found]!, last = at[found + wanted.length - 1]!;
		const end = last + (passage.text.codePointAt(last)! > 0xffff ? 2 : 1);
		return {scene: passage.scene, page: passage.page, label: passage.label, sentence: sentenceAround(passage.text, start, end)};
	}
	return undefined;
}

/** The turn's carried text per campaign: what the note (or the legacy apply result) put in front of the Keeper. */
export class CarriedText {
	private current = new Map<string, {turn: number; passages: CarriedPassage[]}>();

	/** Record passages carried at `turn`; a new turn forgets the last one's. */
	note(campaign: string, turn: number, passages: readonly Row[]): void {
		const kept = passages.flatMap(value => typeof value?.text === 'string' && value.text.trim()
			? [{scene: typeof value.scene === 'string' ? value.scene : null, page: Number.isSafeInteger(value.page) ? value.page as number : null,
				label: typeof value.label === 'string' && value.label ? value.label : null, text: value.text as string}] : []);
		if (!kept.length) return;
		const entry = this.current.get(campaign);
		if (!entry || entry.turn !== turn) this.current.set(campaign, {turn, passages: kept});
		else for (const passage of kept)
			if (!entry.passages.some(seen => seen.text === passage.text && seen.page === passage.page && seen.scene === passage.scene)) entry.passages.push(passage);
	}

	/** The passages carried at `turn` (none when the list is of another turn). */
	of(campaign: string, turn: number): CarriedPassage[] {
		const entry = this.current.get(campaign);
		return entry && entry.turn === turn ? entry.passages.map(passage => ({...passage})) : [];
	}
}

/**
 * The typed reviewer's `bookText` (§11.5.4): the turn's carried passages, newest first, each clipped and the whole bounded.
 * Empty when nothing was carried.
 */
export function bookText(passages: readonly CarriedPassage[]): Array<{where: string; text: string}> {
	const out: Array<{where: string; text: string}> = [];
	let total = 0;
	for (const passage of [...passages].reverse()) {
		const room = BOOK_TEXT_TOTAL_CHARS - total;
		if (room <= 0) break;
		const text = passage.text.slice(0, Math.min(BOOK_TEXT_PASSAGE_CHARS, room));
		total += text.length;
		out.push({where: [passage.scene, passage.page !== null ? `page ${passage.page}` : passage.label].filter(Boolean).join(', ') || 'source', text});
	}
	return out;
}
