/**
 * Contract §191.7: the text of source pages in the layer a reader asked for.
 *
 * `preferred` gives a page's stored page transcript when one exists (§191.4, read through the seed and the home store) and
 * the page's native text (§22.1, `sourceText`) otherwise; `native` gives native text only. A transcript row carries the
 * exact layer as `text` (a permutation of the page's native lines), the reading version as `markdown` and the model-read
 * `image_text`; its `extraction_version` is the transcript version. Every row carries `text_sha256` and a `revision` over
 * its own layer's version (§22.1's formula), so a consultation catalog of either layer validates the same way. Nothing here
 * waits for a transcript or makes one: a page without a record is native now (§191.6).
 */
import { createHash } from "node:crypto";
import { TRANSCRIPT_VERSION } from "./page-transcript.ts";
import { isFileDigest, type TranscriptReader, type TranscriptRecord } from "./transcript-store.ts";

export type SourceLayer = "transcript" | "native";
export interface SourcePageTextOptions { pages: number[]; expected_file_sha256?: string; layer?: "preferred" | "native" }
export interface SourcePageTextRow {
	page: number;
	pdf_label: string | null;
	layer: SourceLayer;
	extraction_version: string;
	/** The exact layer: native text, or the transcript's permutation of the native lines. */
	text: string;
	text_sha256: string;
	revision: string;
	/** Transcript rows only: the reading version and the text the model read off pixels (never evidence). */
	markdown?: string;
	image_text?: string[];
}
export interface SourcePageTextResult {
	file_sha256: string;
	/** Present when native text was read (the PDF was opened): its page count and the native extraction version. */
	page_count?: number;
	native_extraction_version?: string;
	pages: SourcePageTextRow[];
	errors: Array<{ page: number; code: "native_extraction_unavailable" }>;
}
/** The native extraction this reads through: `sourceText`'s request and answer, as the host operation gives them. */
export interface NativeTextPort {
	(request: { pdf: string; pages: number[]; expected_file_sha256?: string }, signal?: AbortSignal): Promise<{
		file_sha256: string; extraction_version: string; page_count: number;
		snapshots: Array<{ page: number; pdf_label: string | null; text: string; text_sha256: string; revision: string }>;
		errors: Array<{ page: number; code: "native_extraction_unavailable" }>;
	}>;
}

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

/** §22.1's revision over a layer's own version: `sha256(JSON([extraction_version, file_sha256, page, text_sha256]))`. */
export function layerRevision(extractionVersion: string, fileSha256: string, page: number, textSha256: string): string {
	return sha256(JSON.stringify([extractionVersion, fileSha256, page, textSha256]));
}

/** What a reader reads for meaning: a transcript's reading version, else the page's text. */
export function readingText(row: { layer?: SourceLayer; text: string; markdown?: string }): string {
	return row.layer === "transcript" && typeof row.markdown === "string" ? row.markdown : row.text;
}

export function transcriptRow(record: TranscriptRecord): SourcePageTextRow {
	return { page: record.page, pdf_label: record.pdf_label, layer: "transcript", extraction_version: TRANSCRIPT_VERSION, text: record.text,
		text_sha256: record.text_sha256, revision: layerRevision(TRANSCRIPT_VERSION, record.file_sha256, record.page, record.text_sha256),
		markdown: record.markdown, image_text: [...record.image_text] };
}

function validated(options: SourcePageTextOptions): { pages: number[]; expected?: string; layer: "preferred" | "native" } {
	if (!options || typeof options !== "object" || Array.isArray(options)
		|| Object.keys(options).some(key => !["pages", "expected_file_sha256", "layer"].includes(key)))
		throw new Error("source page text needs pages and optional expected_file_sha256 and layer");
	const { pages, expected_file_sha256: expected, layer = "preferred" } = options;
	if (!Array.isArray(pages) || pages.length < 1 || pages.length > 32 || pages.some(page => !Number.isSafeInteger(page) || page < 1)
		|| new Set(pages).size !== pages.length)
		throw new Error("source page text pages must be 1-32 unique positive physical page numbers");
	if (expected !== undefined && !isFileDigest(expected)) throw new Error("expected_file_sha256 must be an exact lower-case SHA-256");
	if (layer !== "preferred" && layer !== "native") throw new Error("source page text layer is preferred or native");
	return { pages: [...pages], ...(expected ? { expected } : {}), layer };
}

/**
 * §191.7 `sourcePageText`. `digest` names the file's bytes when the caller gave no `expected_file_sha256` and a store is
 * there to read; when every page has a record the PDF is not opened (the records are of the digest the caller named).
 */
export async function readSourcePageText(input: { pdf: string; options: SourcePageTextOptions; store?: TranscriptReader; nativeText: NativeTextPort;
	digest(pdf: string, signal?: AbortSignal): Promise<string> }, signal?: AbortSignal): Promise<SourcePageTextResult> {
	const { pages, expected, layer } = validated(input.options);
	signal?.throwIfAborted();
	const fileSha256 = layer === "preferred" && input.store ? expected ?? await input.digest(input.pdf, signal) : expected;
	const records = layer === "preferred" && input.store && fileSha256 ? await input.store.readPages(fileSha256, pages) : new Map<number, TranscriptRecord>();
	signal?.throwIfAborted();
	const rest = pages.filter(page => !records.has(page));
	const native = rest.length ? await input.nativeText({ pdf: input.pdf, pages: rest, ...(fileSha256 ? { expected_file_sha256: fileSha256 } : {}) }, signal) : undefined;
	const nativeRows = new Map((native?.snapshots ?? []).map(row => [row.page, { page: row.page, pdf_label: row.pdf_label ?? null, layer: "native" as const,
		extraction_version: native!.extraction_version, text: row.text, text_sha256: row.text_sha256, revision: row.revision }]));
	const rows: SourcePageTextRow[] = [];
	for (const page of pages) {
		const record = records.get(page), row = record ? transcriptRow(record) : nativeRows.get(page);
		if (row) rows.push(row);
	}
	return { file_sha256: native?.file_sha256 ?? fileSha256!, ...(native ? { page_count: native.page_count, native_extraction_version: native.extraction_version } : {}),
		pages: rows, errors: native?.errors ?? [] };
}
