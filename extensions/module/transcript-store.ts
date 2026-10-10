/**
 * Contract §191.4: page transcripts kept by the source file's digest, made once.
 *
 * Home records/claims live in SQLite, keyed by file/page/extraction/transcript version. Legacy JSON and all source/work
 * evidence remain files, never a second writable authority. Shipped seeds are read first and never copied into home.
 * Publish-once records and token-owned claims keep their existing validation and stale-takeover rules.
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {transcriptSqlite} from "./transcript-sqlite.ts";
import { TRANSCRIPT_VERSION, transcriptPermutationHolds } from "./page-transcript.ts";

export const TRANSCRIPT_RECORD_SCHEMA = "coc.source-transcript.page.v1";

export interface TranscriptRecord {
	schema: typeof TRANSCRIPT_RECORD_SCHEMA;
	transcript_version: typeof TRANSCRIPT_VERSION;
	file_sha256: string;
	page: number;
	pdf_label: string | null;
	native: {extraction_version: string; text_sha256: string; line_count: number};
	text: string;
	text_sha256: string;
	markdown: string;
	image_text: string[];
	figures: string[];
	dropped: number[];
	unplaced: number[];
	free_removed: number;
	attempts: number;
	model: string | null;
	thinking: string | null;
	at: string;
}

export type TranscriptSource = "home" | "seed";

/** The host refused to store a page: its `text` is not a permutation of the native lines (§191.3), or it does not describe them. */
export class TranscriptRefused extends Error {
	readonly reason: string;
	constructor(reason: string) { super(`page transcript refused: ${reason}`); this.reason = reason; }
}

export const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const DIGEST = /^[a-f0-9]{64}$/;
export const isFileDigest = (value: unknown): value is string => typeof value === "string" && DIGEST.test(value);
export const pageName = (page: number) => `page-${String(page).padStart(4, "0")}`;
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === "string");
const pageNumbers = (value: unknown): value is number[] => Array.isArray(value) && value.every(item => Number.isSafeInteger(item) && item >= 1);

/** A record this host may read: the v1 schema, this file and page, the current native extraction, an intact `text`. */
export function readableRecord(value: unknown, fileSha256: string, page: number, extractionVersion: string): value is TranscriptRecord {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const row = value as Record<string, unknown>, native = row.native as Record<string, unknown> | undefined;
	return row.schema === TRANSCRIPT_RECORD_SCHEMA && row.transcript_version === TRANSCRIPT_VERSION
		&& row.file_sha256 === fileSha256 && row.page === page
		&& !!native && typeof native === "object" && native.extraction_version === extractionVersion
		&& typeof native.text_sha256 === "string" && Number.isSafeInteger(native.line_count)
		&& typeof row.text === "string" && row.text_sha256 === sha256(row.text) && typeof row.markdown === "string"
		&& strings(row.image_text) && strings(row.figures) && pageNumbers(row.dropped) && pageNumbers(row.unplaced)
		&& (row.pdf_label === null || typeof row.pdf_label === "string");
}

export interface TranscriptClaim { release(): Promise<void> }

/** What a reader of the store needs (§191.7): the record of one page, and the pages that may have one. */
export type TranscriptReader = Pick<TranscriptStore, "read" | "readPages" | "recordedPages">;

const RECORD_FILE = /^page-(\d{4,})\.json$/;

/**
 * The store a process finds in its environment (§191.7): `PI_COC_HOME` (home) and `PI_COC_CONTENT_ROOT` (seeds), the two
 * locations every host operation and reader child is given. Absent either, there is no store and every reader is native.
 */
export function transcriptStoreFromEnv(env: NodeJS.ProcessEnv, extractionVersion: string): TranscriptStore | undefined {
	const home = env.PI_COC_HOME?.trim(), contentRoot = env.PI_COC_CONTENT_ROOT?.trim();
	return home && contentRoot ? new TranscriptStore({ home, contentRoot, extractionVersion }) : undefined;
}

/**
 * §196.7: a file's record files as a listing revision -- each `page-NNNN.json` in the seeds and in home (the store's own two
 * directories) with its size and modification time, from the two directory listings and their stats; no record is read. A
 * record is published once and never rewritten (§191.4), so the revision moves when a page gains (or loses) a record and at
 * no other time. Whether a listed record is readable is `read`'s to say.
 */
export async function transcriptListing(roots: {home: string; contentRoot: string}, fileSha256: string): Promise<{pages: number[]; revision: string}> {
	const rows: Array<[TranscriptSource, number, number, number]> = [];
	if (isFileDigest(fileSha256)) {
		const store = new TranscriptStore({ ...roots, extractionVersion: "" });
		for (const [source, dir] of [["seed", join(store.seedRoot, fileSha256)], ["home", store.dir(fileSha256)]] as const) {
			let names: string[];
			try { names = await readdir(dir); } catch { continue; }
			const listed = names.map(name => ({ name, page: Number(RECORD_FILE.exec(name)?.[1] ?? 0) })).filter(row => Number.isSafeInteger(row.page) && row.page >= 1);
			const stats = await Promise.all(listed.map(row => stat(join(dir, row.name)).catch(() => undefined)));
			for (const [index, row] of listed.entries()) {
				const info = stats[index];
				if (info?.isFile()) rows.push([source, row.page, info.size, Math.trunc(info.mtimeMs)]);
			}
		}
	}
	rows.sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
	return { pages: [...new Set(rows.map(row => row[1]))], revision: sha256(JSON.stringify(rows)) };
}

export class TranscriptStore {
  readonly root: string;
  readonly seedRoot: string;
  readonly options: {home: string; contentRoot: string; extractionVersion: string};
  private readonly storage: ReturnType<typeof transcriptSqlite>;
  constructor(options: {home: string; contentRoot: string; extractionVersion: string}) {
    this.options = options;
    this.root = join(options.home, '.coc', 'source-transcripts');
    this.seedRoot = join(options.contentRoot, 'source-transcripts');
    this.storage = transcriptSqlite(this.root, options.extractionVersion, readableRecord);
  }
  dir(fileSha256: string): string {return join(this.root, fileSha256);}
  /** Compatibility path for retained legacy evidence, never the home record authority. */
  recordPath(fileSha256: string, page: number): string {return join(this.dir(fileSha256), pageName(page) + '.json');}
  workDir(fileSha256: string, page: number, attempt: number): string {
    return join(this.dir(fileSha256), 'work', 'p' + String(page).padStart(4, '0') + '-' + attempt);
  }
  renderCache(fileSha256: string, page: number): string {return join(this.dir(fileSha256), 'cache', pageName(page));}
  private async seed(sha: string, page: number): Promise<TranscriptRecord | undefined> {
    let value: unknown;
    try {value = JSON.parse(await readFile(join(this.seedRoot, sha, pageName(page) + '.json'), 'utf8'));} catch {return undefined;}
    return readableRecord(value, sha, page, this.options.extractionVersion) ? value : undefined;
  }
  async read(fileSha256: string, page: number): Promise<{record: TranscriptRecord; source: TranscriptSource} | undefined> {
    if (!isFileDigest(fileSha256) || !Number.isSafeInteger(page) || page < 1) return undefined;
    const seed = await this.seed(fileSha256, page);
    if (seed) return {record: seed, source: 'seed'};
    const record = (await this.storage.read(fileSha256, [page])).get(page);
    return record ? {record, source: 'home'} : undefined;
  }
  async readPages(fileSha256: string, pages: readonly number[]): Promise<Map<number, TranscriptRecord>> {
    const out = new Map<number, TranscriptRecord>();
    if (!isFileDigest(fileSha256)) return out;
    const missing: number[] = [];
    for (const page of new Set(pages)) {
      if (!Number.isSafeInteger(page) || page < 1) continue;
      const record = await this.seed(fileSha256, page);
      if (record) out.set(page, record); else missing.push(page);
    }
    if (missing.length) {
      try {for (const [page, record] of await this.storage.read(fileSha256, missing)) out.set(page, record);}
      catch (error) {if (!out.size) throw error;}
    }
    return out;
  }
  async recordedPages(fileSha256: string): Promise<Set<number>> {
    const out = new Set<number>();
    if (!isFileDigest(fileSha256)) return out;
    for (const name of await readdir(join(this.seedRoot, fileSha256)).catch(() => [])) {
      const match = RECORD_FILE.exec(name), page = match ? Number(match[1]) : 0;
      if (Number.isSafeInteger(page) && page >= 1) out.add(page);
    }
    try {for (const page of await this.storage.pages(fileSha256)) out.add(page);}
    catch (error) {if (!out.size) throw error;}
    return out;
  }
  async put(record: TranscriptRecord, lines: readonly string[], retryUntil?: number): Promise<'stored' | 'exists'> {
    if (!transcriptPermutationHolds(record.text, lines)) throw new TranscriptRefused('text_is_not_a_permutation_of_the_native_lines');
    if (record.native.line_count !== lines.length) throw new TranscriptRefused('line_count_mismatch');
    if (!readableRecord(record, record.file_sha256, record.page, record.native.extraction_version)) throw new TranscriptRefused('record_shape');
    await mkdir(this.dir(record.file_sha256), {recursive: true});
    return this.storage.put(record, retryUntil);
  }
  async claimedElsewhere(fileSha256: string, page: number, staleMs: number, now = Date.now()): Promise<boolean> {
    return this.storage.claimed(fileSha256, page, staleMs, now);
  }
  async claim(fileSha256: string, page: number, staleMs: number, now = Date.now()): Promise<TranscriptClaim | null> {
    return this.storage.claim(fileSha256, page, staleMs, now);
  }
}
