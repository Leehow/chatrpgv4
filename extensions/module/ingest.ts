/**
 * `ingest`: one background job from a PDF file on disk to a module that can be played (contract §20.2).
 *
 * Five stages, and what each one leaves behind under the work directory
 * `<home>/.coc/ingest/<file_sha256>/`:
 *
 * | stage | what it does | what it writes |
 * | --- | --- | --- |
 * | `classify` | `classifyPdf` gives the page count and the list of pages that need OCR | `state.json` |
 * | `extract` | the local library reads every page it can | `pages/NNNN.md` (one per page, contiguous from 0000) |
 * | `ocr` | the outsourced command reads only the pages on that list | `ocr/NNNN.md`, copied over `pages/NNNN.md` |
 * | `pack` | the packer signs the manifest from the bytes on disk | `bundle/manifest.json`, `bundle/pages/`, `bundle/assets/` |
 * | `bind` | `module.bind` re-checks that bundle byte for byte and registers the module | the module store |
 *
 * After `bind` the job runs `module.plan` and the unattended build of contract §14.5 (whose own four
 * bus channels are unchanged) and ends at `module.install`.
 *
 * **Reentrant.** The work directory is keyed by the PDF's `file_sha256`, so a second run of the same
 * book reuses every page file already there and produces only the missing ones. That matters most for
 * OCR, which is neither free nor local: a page counts as OCR-produced only once it is in
 * `state.ocr_done`, so a page that failed last time is retried and a page that succeeded never is.
 *
 * **OCR is allowed to fail.** No OCR command, no `BAIDUOCR_TOKEN`, a non-zero exit: those pages stay
 * as whatever the native extractor got (often an empty file), the reason is recorded in `state.json`,
 * in the telemetry and in the job's report, and the book still assembles. Only `no_extractor`,
 * `bad_pdf`, `pack_failed`, `bind_rejected` and `build_failed` end the job.
 *
 * Reason codes: `no_extractor`, `bad_pdf`, `ocr_unavailable`, `ocr_failed` (recorded, never fatal),
 * `pack_failed`, `bind_rejected`, `build_failed`, `identity_incomplete`, `interrupted`. The first
 * five names are contract §20.2's; the last four name the failures §20.2 did not.
 *
 * The identity a bundle needs (contract §14.2) is **declared, never guessed**: the title defaults to
 * the file name, the slug to the ASCII kebab of the title (`--id` overrides), and the language has no
 * default at all, because which language a book is written in is exactly the kind of open semantic
 * question this repository refuses to answer with a table (`Agents.md`). Without one the job stops at
 * `identity_incomplete` and the command surface asks the person.
 */

import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, extname, isAbsolute, join, resolve as resolvePath } from "node:path";
import { homedir } from "node:os";
import type { BuildReport, KernelCall } from "./build.ts";
import {
	type Classification,
	type Extractor,
	type OcrRunner,
	packBundle,
	pageFileName,
	pagesOnDisk,
	resolveExtractor,
	resolveOcr,
} from "./pdf.ts";

/** The stages of contract §20.2, in order. */
export const INGEST_STAGES = ["classify", "extract", "ocr", "pack", "bind"] as const;
export type IngestStage = (typeof INGEST_STAGES)[number];

export type IngestReason =
	| "no_extractor"
	| "bad_pdf"
	| "ocr_unavailable"
	| "ocr_failed"
	| "pack_failed"
	| "bind_rejected"
	| "build_failed"
	| "identity_incomplete"
	| "interrupted";

/** A failure with a reason code; anything else that escapes is reported as `bad_pdf` only if it came out of the reading stages. */
export class IngestError extends Error {
	readonly reason: IngestReason;
	readonly stage: IngestStage;
	constructor(reason: IngestReason, stage: IngestStage, message: string) {
		super(message);
		this.name = "IngestError";
		this.reason = reason;
		this.stage = stage;
	}
}

export interface IngestRequest {
	/** The PDF to read. `~` is expanded; a relative path resolves against the home. */
	pdf: string;
	/** The module id to bind under; without one it is derived from the title. */
	module_id?: string;
	/** The book's title; without one it is the file name without its extension. */
	title?: string;
	/** BCP 47, e.g. `zh-Hans`. Required: nothing here detects it. */
	language?: string;
}

export interface IngestDeps {
	call: KernelCall;
	/** The workspace root (`PI_COC_HOME`, contract §20.7): `.coc/` sits under it. */
	home: string;
	signal: AbortSignal;
	stopped(): boolean;
	/** One telemetry row; the caller decides where it lands. `lane: "ingest"` is added here. */
	record(row: Record<string, unknown>): void;
	progress(row: { stage: IngestStage; page?: number; of?: number; detail?: string }): void;
	/** The unattended build of contract §14.5, driven by the module extension. */
	build(moduleId: string): Promise<BuildReport>;
	/** Test seams: the two adapters, injected. `null` means "there is none", which is `no_extractor`. */
	extractor?: Extractor | null;
	ocr?: OcrRunner | null;
}

export interface IngestReport {
	module_id: string;
	title: string;
	language: string;
	work_dir: string;
	bundle: string;
	file_sha256: string;
	filename: string;
	pdf_type?: string;
	page_count: number;
	/** Pages that were already on disk from an earlier run of the same file. */
	reused: number[];
	/** Pages the classifier put on the OCR list. */
	ocr_pages: number[];
	/** Of those, the ones an OCR run has produced (this run or an earlier one). */
	ocr_done: number[];
	/** Of those, the ones still missing, with the reason they are. */
	ocr_missing: number[];
	ocr_reason?: "ocr_unavailable" | "ocr_failed";
	ocr_detail?: string;
	ocr_backend?: string;
	installed: boolean;
	opening_ready: boolean;
	sections_accepted: number;
	sections_failed: number;
	ms: number;
}

/** What survives between runs of the same file (contract §20.2's reentrancy). */
interface IngestState {
	file_sha256: string;
	filename: string;
	page_count: number;
	pages_needing_ocr: number[];
	ocr_done: number[];
	pdf_type?: string;
	module_id?: string;
	updated_at: string;
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** ASCII kebab, the same shape the kernel's `MODULE_ID_RE` accepts. Non-ASCII is dropped, so a title with none leaves nothing and the person is asked for an id. */
export function slugFor(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 64)
		.replace(/-+$/g, "");
}

/** `~/x` and relative paths, resolved the way a person typing a path expects. */
export function resolveUserPath(path: string, base: string): string {
	const trimmed = path.trim();
	const expanded = trimmed === "~" ? homedir() : trimmed.startsWith("~/") ? join(homedir(), trimmed.slice(2)) : trimmed;
	return isAbsolute(expanded) ? expanded : resolvePath(base, expanded);
}

function errorText(error: unknown): string {
	return (error instanceof Error ? error.message : String(error)).slice(0, 300);
}

function errorCode(error: unknown): string | undefined {
	const code = (error as { code?: unknown } | null)?.code;
	return typeof code === "string" ? code : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function sortedUnique(values: number[]): number[] {
	return [...new Set(values)].sort((left, right) => left - right);
}

async function readState(path: string): Promise<IngestState | undefined> {
	try {
		const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
		const row = asRecord(parsed);
		if (typeof row.file_sha256 !== "string") return undefined;
		return {
			file_sha256: row.file_sha256,
			filename: typeof row.filename === "string" ? row.filename : "",
			page_count: typeof row.page_count === "number" ? row.page_count : 0,
			pages_needing_ocr: Array.isArray(row.pages_needing_ocr) ? (row.pages_needing_ocr as number[]) : [],
			ocr_done: Array.isArray(row.ocr_done) ? (row.ocr_done as number[]) : [],
			...(typeof row.pdf_type === "string" ? { pdf_type: row.pdf_type } : {}),
			...(typeof row.module_id === "string" ? { module_id: row.module_id } : {}),
			updated_at: typeof row.updated_at === "string" ? row.updated_at : "",
		};
	} catch {
		return undefined;
	}
}

async function writeState(path: string, state: IngestState): Promise<void> {
	try {
		await writeFile(path, `${JSON.stringify({ ...state, updated_at: new Date().toISOString() }, null, 2)}\n`, "utf8");
	} catch {
		/* the state file is an optimisation, never a reason to fail the job */
	}
}

/**
 * The job. One call, five stages, then the build. Throws `IngestError` with a reason code; every
 * other failure inside a stage is wrapped into one before it leaves.
 */
export async function ingest(deps: IngestDeps, request: IngestRequest): Promise<IngestReport> {
	const began = Date.now();
	const stop = (stage: IngestStage) => {
		if (deps.stopped() || deps.signal.aborted) {
			throw new IngestError("interrupted", stage, "the session shut down while the book was being read");
		}
	};

	// ---- Identity (declared, never guessed) -------------------------------
	const pdf = resolveUserPath(request.pdf ?? "", deps.home);
	if (!request.pdf?.trim()) throw new IngestError("bad_pdf", "classify", "no PDF path was given");
	let buffer: Buffer;
	try {
		buffer = await readFile(pdf);
	} catch (error) {
		throw new IngestError("bad_pdf", "classify", `cannot read ${pdf}: ${errorText(error)}`);
	}
	if (buffer.length === 0) throw new IngestError("bad_pdf", "classify", `${pdf} is empty`);
	const fileSha = createHash("sha256").update(buffer).digest("hex");
	const filename = basename(pdf);
	const title = request.title?.trim() || basename(filename, extname(filename));
	const moduleId = (request.module_id?.trim() || slugFor(title)).toLowerCase();
	if (!SLUG_RE.test(moduleId)) {
		throw new IngestError(
			"identity_incomplete",
			"classify",
			`no module id can be derived from "${title}": pass one with --id (lowercase letters, digits and dashes)`,
		);
	}
	const language = request.language?.trim();
	if (!language) {
		throw new IngestError(
			"identity_incomplete",
			"classify",
			"the book's language is not declared: pass --language <BCP 47 tag>, e.g. zh-Hans or en",
		);
	}

	const workDir = join(deps.home, ".coc", "ingest", fileSha);
	const pagesDir = join(workDir, "pages");
	const ocrDir = join(workDir, "ocr");
	const bundleDir = join(workDir, "bundle");
	const statePath = join(workDir, "state.json");
	await mkdir(pagesDir, { recursive: true });
	const previous = await readState(statePath);
	const state: IngestState = {
		file_sha256: fileSha,
		filename,
		page_count: previous?.page_count ?? 0,
		pages_needing_ocr: previous?.pages_needing_ocr ?? [],
		ocr_done: previous?.ocr_done ?? [],
		...(previous?.pdf_type ? { pdf_type: previous.pdf_type } : {}),
		module_id: moduleId,
		updated_at: "",
	};
	const base = { work_dir: workDir, file_sha256: fileSha, module_id: moduleId };

	// ---- classify ---------------------------------------------------------
	stop("classify");
	deps.progress({ stage: "classify" });
	const classifyBegan = Date.now();
	let extractor: Extractor | undefined;
	try {
		extractor = deps.extractor === undefined ? await resolveExtractor() : (deps.extractor ?? undefined);
	} catch (error) {
		// A malformed PI_COC_EXTRACT is no extractor, not an unclassified crash.
		throw new IngestError("no_extractor", "classify", `the extract adapter could not be resolved: ${errorText(error)}`);
	}
	const onDisk = await pagesOnDisk(pagesDir);
	let classification: Classification;
	if (extractor) {
		try {
			classification = await extractor.classify(pdf, buffer);
		} catch (error) {
			throw new IngestError("bad_pdf", "classify", `${filename} could not be classified: ${errorText(error)}`);
		}
		if (classification.page_count <= 0) {
			throw new IngestError("bad_pdf", "classify", `${filename} reports no pages`);
		}
	} else if (previous && previous.page_count > 0 && onDisk.length >= previous.page_count) {
		// No extractor, but this file's pages are already on disk (an earlier run, or a hand-made set):
		// the job carries on from the pages rather than refusing a book it does not need to read again.
		classification = { page_count: previous.page_count, pages_needing_ocr: previous.pages_needing_ocr, ...(previous.pdf_type ? { pdf_type: previous.pdf_type } : {}) };
	} else {
		throw new IngestError(
			"no_extractor",
			"classify",
			"no PDF extractor is available: install the optional dependency @firecrawl/pdf-inspector, or name one in PI_COC_EXTRACT. " +
				"A bundle someone else produced still binds without it: bin/pi-coc setup, and give its directory at the source step.",
		);
	}
	state.page_count = classification.page_count;
	state.pages_needing_ocr = sortedUnique(classification.pages_needing_ocr);
	if (classification.pdf_type) state.pdf_type = classification.pdf_type;
	await writeState(statePath, state);
	deps.record({
		...base,
		stage: "classify",
		ok: true,
		ms: Date.now() - classifyBegan,
		extractor: extractor?.source ?? "reused-pages",
		pdf_type: classification.pdf_type ?? null,
		page_count: classification.page_count,
		pages_needing_ocr: state.pages_needing_ocr.length,
		...(classification.confidence !== undefined ? { confidence: classification.confidence } : {}),
	});

	// ---- extract ----------------------------------------------------------
	stop("extract");
	const allPages = Array.from({ length: classification.page_count }, (_, index) => index);
	const reused = onDisk.filter((page) => page < classification.page_count);
	const missing = allPages.filter((page) => !reused.includes(page));
	deps.progress({ stage: "extract", of: missing.length });
	const extractBegan = Date.now();
	let written: number[] = [];
	if (missing.length > 0) {
		if (!extractor) {
			throw new IngestError("no_extractor", "extract", `${missing.length} page(s) of ${filename} are missing and there is no extractor to read them`);
		}
		try {
			const result = await extractor.extract({
				pdf,
				buffer,
				pages: missing,
				pagesDir,
				onPage: (page, done, of) => deps.progress({ stage: "extract", page, of }),
			});
			written = result.written;
			// The classifier's list and the per-page `needsOcr` flags are both the library's own
			// statements; neither is a threshold of ours, so the union is what goes to OCR.
			state.pages_needing_ocr = sortedUnique([...state.pages_needing_ocr, ...result.needs_ocr.filter((page) => page < classification.page_count)]);
		} catch (error) {
			throw new IngestError("bad_pdf", "extract", `${filename} could not be read: ${errorText(error)}`);
		}
	}
	// Every page must exist for the bundle to be contiguous (contract §14.2); an empty page is a page.
	const present = new Set(await pagesOnDisk(pagesDir));
	const blank: number[] = [];
	for (const page of allPages) {
		if (present.has(page)) continue;
		await writeFile(join(pagesDir, pageFileName(page)), "", "utf8");
		blank.push(page);
	}
	await writeState(statePath, state);
	deps.record({
		...base,
		stage: "extract",
		ok: true,
		ms: Date.now() - extractBegan,
		pages: classification.page_count,
		written: written.length,
		reused: reused.length,
		blank: blank.length,
	});

	// ---- ocr --------------------------------------------------------------
	stop("ocr");
	const ocrWanted = state.pages_needing_ocr.filter((page) => !state.ocr_done.includes(page));
	let ocrReason: IngestReport["ocr_reason"];
	let ocrDetail: string | undefined;
	let ocrBackend: string | undefined;
	const ocrBegan = Date.now();
	deps.progress({ stage: "ocr", of: ocrWanted.length });
	if (ocrWanted.length > 0) {
		let runner: OcrRunner | undefined;
		let resolveDetail: string | undefined;
		try {
			runner = deps.ocr === undefined ? resolveOcr() : (deps.ocr ?? undefined);
		} catch (error) {
			resolveDetail = `the OCR adapter could not be resolved: ${errorText(error)}`;
		}
		const check = runner?.check() ?? { ok: false, detail: resolveDetail ?? "OCR is switched off (PI_COC_OCR_CMD=none)" };
		if (!runner || !check.ok) {
			ocrReason = "ocr_unavailable";
			ocrDetail = check.detail ?? "no OCR command";
		} else {
			await mkdir(ocrDir, { recursive: true });
			const run = await runner.run({ pdf, pages: ocrWanted, outDir: ocrDir, signal: deps.signal });
			ocrBackend = run.backend;
			// Whatever came back is taken page by page: a partial run is worth exactly the pages it produced.
			let done = 0;
			for (const page of run.written) {
				try {
					await copyFile(join(ocrDir, pageFileName(page)), join(pagesDir, pageFileName(page)));
					state.ocr_done = sortedUnique([...state.ocr_done, page]);
					done += 1;
					deps.progress({ stage: "ocr", page, of: ocrWanted.length });
				} catch (error) {
					ocrDetail = `page ${page} could not be copied out of the OCR output: ${errorText(error)}`;
				}
			}
			if (!run.ok) {
				ocrReason = "ocr_failed";
				ocrDetail = run.detail ?? "the OCR command failed";
			} else if (done < ocrWanted.length) {
				ocrReason = "ocr_failed";
				ocrDetail = `the OCR command returned ${done} of ${ocrWanted.length} page(s)`;
			}
		}
		await writeState(statePath, state);
	}
	const ocrMissing = state.pages_needing_ocr.filter((page) => !state.ocr_done.includes(page));
	deps.record({
		...base,
		stage: "ocr",
		ok: ocrReason === undefined,
		ms: Date.now() - ocrBegan,
		requested: ocrWanted.length,
		recovered: ocrWanted.filter((page) => state.ocr_done.includes(page)).length,
		missing: ocrMissing.length,
		// The credential itself never appears anywhere: only whether the adapter could see one.
		...(ocrReason ? { reason: ocrReason, detail: ocrDetail ?? null } : {}),
		...(ocrBackend ? { backend: ocrBackend } : {}),
	});

	// ---- pack -------------------------------------------------------------
	stop("pack");
	deps.progress({ stage: "pack", of: classification.page_count });
	const packBegan = Date.now();
	const assetsDir = join(workDir, "assets");
	const assetMeta = join(workDir, "asset-meta.json");
	const withAssets = existsSync(assetsDir) && existsSync(assetMeta);
	let packed: Awaited<ReturnType<typeof packBundle>>;
	try {
		packed = await packBundle({
			pagesDir,
			bundleDir,
			title,
			slug: moduleId,
			language,
			fileSha256: fileSha,
			filename,
			...(withAssets ? { assetsDir, assetMeta } : {}),
			signal: deps.signal,
		});
	} catch (error) {
		throw new IngestError("pack_failed", "pack", `the bundle packer could not be run: ${errorText(error)}`);
	}
	if (!packed.ok) {
		deps.record({ ...base, stage: "pack", ok: false, ms: packed.ms, reason: "pack_failed", detail: (packed.error ?? packed.stderr.trim()).slice(0, 300) });
		throw new IngestError(
			"pack_failed",
			"pack",
			`the bundle packer failed: ${packed.error ?? (packed.stderr.trim() || `exit code ${packed.code}`)}`,
		);
	}
	deps.record({ ...base, stage: "pack", ok: true, ms: Date.now() - packBegan, bundle: bundleDir, assets: withAssets });

	// ---- bind -------------------------------------------------------------
	stop("bind");
	deps.progress({ stage: "bind" });
	const bindBegan = Date.now();
	let bound: Record<string, unknown>;
	try {
		bound = asRecord(await deps.call("module.bind", { bundle: bundleDir, module_id: moduleId }));
	} catch (error) {
		deps.record({ ...base, stage: "bind", ok: false, ms: Date.now() - bindBegan, reason: "bind_rejected", detail: errorText(error) });
		throw new IngestError("bind_rejected", "bind", `module.bind refused the bundle (${errorCode(error) ?? "internal"}): ${errorText(error)}`);
	}
	const boundId = typeof bound.module_id === "string" && bound.module_id ? bound.module_id : moduleId;
	state.module_id = boundId;
	await writeState(statePath, state);
	deps.record({
		...base,
		module_id: boundId,
		stage: "bind",
		ok: true,
		ms: Date.now() - bindBegan,
		page_count: typeof bound.page_count === "number" ? bound.page_count : classification.page_count,
		assets: typeof bound.assets === "number" ? bound.assets : 0,
		replayed: bound.replayed === true,
	});

	// ---- plan, build, install (contract §14.5, its own four bus channels) --
	stop("bind");
	let report: BuildReport;
	try {
		report = await deps.build(boundId);
	} catch (error) {
		throw new IngestError("build_failed", "bind", `the unattended build failed: ${errorText(error)}`);
	}

	return {
		module_id: boundId,
		title,
		language,
		work_dir: workDir,
		bundle: bundleDir,
		file_sha256: fileSha,
		filename,
		...(classification.pdf_type ? { pdf_type: classification.pdf_type } : {}),
		page_count: classification.page_count,
		reused,
		ocr_pages: state.pages_needing_ocr,
		ocr_done: state.ocr_done,
		ocr_missing: ocrMissing,
		...(ocrReason ? { ocr_reason: ocrReason } : {}),
		...(ocrDetail ? { ocr_detail: ocrDetail } : {}),
		...(ocrBackend ? { ocr_backend: ocrBackend } : {}),
		installed: report.installed,
		opening_ready: report.opening_ready,
		sections_accepted: report.accepted.length,
		sections_failed: report.failed.length,
		ms: Date.now() - began,
	};
}
