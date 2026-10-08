/**
 * Contract §191.4: page transcripts kept by the source file's digest, made once.
 *
 * `<home>/.coc/source-transcripts/<file_sha256>/page-<NNNN>.json`, never under a module or fork directory, so every module
 * id, campaign, fork and re-import of the same bytes reads the same pages. A record is published without overwriting
 * (written to a temporary file, then hard-linked into place) and never rewritten. Shipped seeds under
 * `<content>/source-transcripts/<file_sha256>/` are read first and never copied into home. One producer per page across
 * processes holds `page-<NNNN>.claim`, created exclusively; a claim older than its staleness may be taken.
 */
import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, open, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
	constructor(options: {home: string; contentRoot: string; extractionVersion: string}) {
		this.options = options;
		this.root = join(options.home, ".coc", "source-transcripts");
		this.seedRoot = join(options.contentRoot, "source-transcripts");
	}

	dir(fileSha256: string): string { return join(this.root, fileSha256); }
	recordPath(fileSha256: string, page: number): string { return join(this.dir(fileSha256), `${pageName(page)}.json`); }
	/** §191.2: one child's work directory, `<store>/work/p<NNNN>-<attempt>/`. */
	workDir(fileSha256: string, page: number, attempt: number): string {
		return join(this.dir(fileSha256), "work", `p${String(page).padStart(4, "0")}-${attempt}`);
	}
	/** The page render's cache, kept beside the store only while its page is being made. */
	renderCache(fileSha256: string, page: number): string { return join(this.dir(fileSha256), "cache", pageName(page)); }

	/** The seed first, then home; a record of another extraction version, schema or file is not there. */
	async read(fileSha256: string, page: number): Promise<{record: TranscriptRecord; source: TranscriptSource} | undefined> {
		if (!isFileDigest(fileSha256) || !Number.isSafeInteger(page) || page < 1) return undefined;
		for (const [source, path] of [["seed", join(this.seedRoot, fileSha256, `${pageName(page)}.json`)], ["home", this.recordPath(fileSha256, page)]] as const) {
			let value: unknown;
			try { value = JSON.parse(await readFile(path, "utf8")); } catch { continue; }
			if (readableRecord(value, fileSha256, page, this.options.extractionVersion)) return {record: value, source};
		}
		return undefined;
	}

	/** The readable records of `pages` (seed first, then home), by page; a page without one is absent. */
	async readPages(fileSha256: string, pages: readonly number[]): Promise<Map<number, TranscriptRecord>> {
		const out = new Map<number, TranscriptRecord>();
		if (!isFileDigest(fileSha256)) return out;
		const recorded = await this.recordedPages(fileSha256);
		for (const page of new Set(pages)) {
			if (!recorded.has(page)) continue;
			const found = await this.read(fileSha256, page);
			if (found) out.set(page, found.record);
		}
		return out;
	}

	/**
	 * The pages of a file that have a record file in the seed or the home store, from the two directory listings; whether
	 * each is readable (schema, extraction version, digest) is `read`'s to say.
	 */
	async recordedPages(fileSha256: string): Promise<Set<number>> {
		const out = new Set<number>();
		if (!isFileDigest(fileSha256)) return out;
		for (const dir of [join(this.seedRoot, fileSha256), this.dir(fileSha256)]) {
			let names: string[];
			try { names = await readdir(dir); } catch { continue; }
			for (const name of names) {
				const match = RECORD_FILE.exec(name), page = match ? Number(match[1]) : 0;
				if (Number.isSafeInteger(page) && page >= 1) out.add(page);
			}
		}
		return out;
	}

	/**
	 * Publish a page once. Refused (nothing written) when `text` is not a permutation of `lines`, the native lines it was
	 * made from (§191.3's invariant), or when the record does not describe them. `exists`: another producer published first.
	 */
	async put(record: TranscriptRecord, lines: readonly string[]): Promise<"stored" | "exists"> {
		if (!transcriptPermutationHolds(record.text, lines)) throw new TranscriptRefused("text_is_not_a_permutation_of_the_native_lines");
		if (record.native.line_count !== lines.length) throw new TranscriptRefused("line_count_mismatch");
		if (!readableRecord(record, record.file_sha256, record.page, record.native.extraction_version)) throw new TranscriptRefused("record_shape");
		const target = this.recordPath(record.file_sha256, record.page);
		await mkdir(this.dir(record.file_sha256), {recursive: true});
		const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
		await writeFile(temporary, JSON.stringify(record) + "\n", {flag: "wx"});
		try {
			try { await link(temporary, target); return "stored"; }
			catch (error) {
				const code = (error as NodeJS.ErrnoException).code;
				if (code === "EEXIST") return "exists";
				// A file system without hard links: rename, still never over an existing record.
				if (await stat(target).then(() => true, () => false)) return "exists";
				await rename(temporary, target);
				return "stored";
			}
		} finally { await unlink(temporary).catch(() => undefined); }
	}

	/** Another producer's live claim on the page (§191.4): the page is being made elsewhere. */
	async claimedElsewhere(fileSha256: string, page: number, staleMs: number, now = Date.now()): Promise<boolean> {
		const age = await this.claimAge(fileSha256, page, now);
		return age !== undefined && age <= staleMs;
	}

	/** The exclusive claim on one page, or null while another producer's claim is live. */
	async claim(fileSha256: string, page: number, staleMs: number, now = Date.now()): Promise<TranscriptClaim | null> {
		await mkdir(this.dir(fileSha256), {recursive: true});
		const path = join(this.dir(fileSha256), `${pageName(page)}.claim`);
		const body = JSON.stringify({pid: process.pid, at: new Date(now).toISOString()});
		for (let attempt = 0; attempt < 2; attempt++) {
			try {
				const handle = await open(path, "wx");
				try { await handle.writeFile(body); } finally { await handle.close(); }
				return {release: async () => {
					// Only this producer's own claim is removed; a taker's newer claim stays.
					if (await readFile(path, "utf8").catch(() => undefined) === body) await unlink(path).catch(() => undefined);
				}};
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			}
			const age = await this.claimAge(fileSha256, page, now);
			if (age !== undefined && age <= staleMs) return null;
			await unlink(path).catch(() => undefined);
		}
		return null;
	}

	/** How old the page's claim is: its `at`, or the file's modification time while a claim is still being written. */
	private async claimAge(fileSha256: string, page: number, now: number): Promise<number | undefined> {
		const path = join(this.dir(fileSha256), `${pageName(page)}.claim`);
		let text: string;
		try { text = await readFile(path, "utf8"); } catch { return undefined; }
		let at = Number.NaN;
		try { at = Date.parse(JSON.parse(text).at); } catch { /* a claim still being written */ }
		if (!Number.isFinite(at)) {
			try { at = (await stat(path)).mtimeMs; } catch { return undefined; }
		}
		return now - at;
	}
}
