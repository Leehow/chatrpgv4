/**
 * Contract §263.1: pointers into the book. A ref names layout blocks (§262.2) and UTF-8 byte ranges of their text; the
 * host slices the words back out and refuses a ref whose words changed. Models never write offsets: they cite a block and,
 * for part of it, an exact quote, which the host turns into a range.
 */
import { createHash } from "node:crypto";

export interface RefSpan { block: string; start: number; end: number }
export interface SourceRef { doc: string; layout: string; spans: RefSpan[]; sha256: string }
export type BlockText = { id: string; text: string };

const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/** True when `offset` is not inside a multi-byte UTF-8 sequence of `bytes`. */
const boundary = (bytes: Buffer, offset: number) => offset === bytes.length || offset === 0 || (bytes[offset]! & 0xc0) !== 0x80;

function spanText(block: BlockText | undefined, span: RefSpan): string | undefined {
	if (!block) return undefined;
	const bytes = Buffer.from(block.text, "utf8");
	if (!Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.end) || span.start < 0 || span.end > bytes.length || span.start >= span.end) return undefined;
	if (!boundary(bytes, span.start) || !boundary(bytes, span.end)) return undefined;
	return bytes.subarray(span.start, span.end).toString("utf8");
}

/** A ref over the given spans of these blocks, or undefined when a span does not slice. */
export function makeRef(doc: string, layout: string, spans: RefSpan[], blocks: Map<string, BlockText>): SourceRef | undefined {
	const texts = spans.map(span => spanText(blocks.get(span.block), span));
	if (!spans.length || texts.some(text => text === undefined)) return undefined;
	return { doc, layout, spans: spans.map(span => ({ ...span })), sha256: sha(texts.join("\n")) };
}

/** The whole block as a ref. */
export function blockRef(doc: string, layout: string, block: BlockText): SourceRef {
	const bytes = Buffer.byteLength(block.text, "utf8");
	return { doc, layout, spans: [{ block: block.id, start: 0, end: bytes }], sha256: sha(block.text) };
}

/** Whitespace collapsed, with a map from each kept character back to its UTF-8 byte offset in the original. */
function collapsed(text: string): { flat: string; at: number[]; ends: number[] } {
	let flat = "", byte = 0;
	const at: number[] = [], ends: number[] = [];
	for (const char of text) {
		const size = Buffer.byteLength(char, "utf8");
		if (!/\s/u.test(char)) { flat += char; for (let i = 0; i < char.length; i++) { at.push(byte); ends.push(byte + size); } }
		byte += size;
	}
	return { flat, at, ends };
}

/**
 * §263.1: the ref of `quote` inside `block`: an exact substring once whitespace is collapsed on both sides, occurring once.
 * No quote means the whole block. A quote that is absent or occurs twice makes no ref.
 */
export function refFromQuote(doc: string, layout: string, block: BlockText, quote?: string): SourceRef | undefined {
	if (quote === undefined || !quote.trim()) return blockRef(doc, layout, block);
	const hay = collapsed(block.text), needle = collapsed(quote).flat;
	if (!needle) return undefined;
	const first = hay.flat.indexOf(needle);
	if (first < 0 || hay.flat.indexOf(needle, first + 1) >= 0) return undefined;
	const start = hay.at[first]!, end = hay.ends[first + needle.length - 1]!;
	return makeRef(doc, layout, [{ block: block.id, start, end }], new Map([[block.id, block]]));
}

/** §263.1: the ref's words, or undefined when the ref is void here (other document or layout, a missing block, a changed text). */
export function sliceRef(ref: SourceRef, doc: string, layout: string, blocks: Map<string, BlockText>): string | undefined {
	if (!ref || ref.doc !== doc || ref.layout !== layout || !Array.isArray(ref.spans) || !ref.spans.length) return undefined;
	const texts = ref.spans.map(span => spanText(blocks.get(span.block), span));
	if (texts.some(text => text === undefined)) return undefined;
	const text = texts.join("\n");
	return sha(text) === ref.sha256 ? text : undefined;
}

/** §263.1: a ref's identity: its digest and its places. Equal words elsewhere are another ref. */
export const refKey = (ref: SourceRef): string => sha(JSON.stringify([ref.doc, ref.layout, ref.sha256, ref.spans.map(span => [span.block, span.start, span.end])])).slice(0, 24);

/** The page of a §262.2 block id (`b<page>-<order>-<hash8>`). */
export const blockPage = (id: string): number => Number(/^b(\d+)-/.exec(id)?.[1] ?? 0);
