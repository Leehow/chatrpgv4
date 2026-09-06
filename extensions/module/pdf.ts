/**
 * The two adapters of contract §20.1, plus the packer that signs what they produce.
 *
 * The boundary they sit on does not move: the kernel only ever sees a finished bundle
 * (`coc.pdf-bundle.v1`, contract §14.2) and `module.bind` re-checks it byte for byte. So an adapter
 * here may write `pages/NNNN.md` and `assets/`, and nothing else. **The manifest is never ours**:
 * it is minted by the packer (`bin/coc-bundle`) from the bytes on disk, which is what makes the
 * kernel's byte check a check on us rather than a check on our own say-so.
 *
 * | adapter | where it runs | what it does |
 * | --- | --- | --- |
 * | extract | local, in this process by default | `classifyPdf(buffer)` names the pages that need OCR; `extractPagesMarkdown[Async](buffer, pages?)` gives one Markdown per page. Page numbers are 0-based, which is exactly the bundle's page numbering |
 * | ocr | outsourced, one child process | only the pages the classifier named; the token travels in the environment and never on a command line |
 *
 * Both are replaceable, and both fail soft into a reason code rather than an exception the job
 * cannot classify:
 *
 * - `PI_COC_EXTRACT` replaces the local library with a command (a JSON array of strings, or a bare
 *   path). Two verbs: `<cmd> classify <pdf>` prints one JSON object
 *   `{pdf_type, page_count, pages_needing_ocr, confidence}`; `<cmd> extract <pdf> --pages 0,1,2
 *   --out <dir>` writes `<dir>/NNNN.md` for those pages. The literal `none` means "no extractor",
 *   which is how a machine without the native binary is simulated. Absent, the library is imported
 *   lazily and a failed import is `no_extractor`, not a crash: the rest of the extension still loads.
 * - `PI_COC_OCR_CMD` replaces `bin/coc-ocr` (same forms). Its contract is fixed:
 *   `<cmd> <pdf> --pages 0,1,11 --out <dir>` writes `<dir>/NNNN.md` named by the **original**
 *   0-based page index and prints one JSON summary; a non-zero exit is a failure. It needs
 *   `BAIDUOCR_TOKEN` in its environment — read from `process.env` and passed through by inheritance
 *   only, so the token never reaches an argument list, a log line or an artefact.
 * - `PI_COC_BUNDLE_CMD` replaces `bin/coc-bundle` (same forms). This is a test seam, the same trick as
 *   `PI_COC_KERNEL_CMD` and `PI_COC_READER_CMD`; in production the packer is the repository's own.
 *
 * Local OCR (the library's `processPdfWithOcr`) is deliberately not wired in: on this machine it
 * cannot load PDFium. When a PDFium is installed (`PDFIUM_LIB_PATH`), it slots in as another
 * `OcrRunner` behind the same interface, with no change to this boundary.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, join, resolve as resolvePath, sep } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The npm name of the local extractor. It is an `optionalDependency`: on a platform with no prebuilt binary it is simply absent. */
export const EXTRACTOR_PACKAGE = "@firecrawl/pdf-inspector";

/** How long one adapter round may run before it is cut off. */
const DEFAULT_COMMAND_TIMEOUT_MS = 20 * 60 * 1000;
const STDERR_KEEP = 2000;
const PAGE_FILE = /^(\d{4})\.md$/;

/** `12` -> `0012.md`: the bundle's page file name (contract §14.2), 0-based. */
export function pageFileName(index: number): string {
	return `${String(index).padStart(4, "0")}.md`;
}

/** The 0-based indices of the `NNNN.md` files directly under a directory, ascending. */
export async function pagesOnDisk(dir: string): Promise<number[]> {
	let entries: string[];
	try {
		entries = await readdir(dir);
	} catch {
		return [];
	}
	return entries
		.map((entry) => PAGE_FILE.exec(entry))
		.filter((match): match is RegExpExecArray => match !== null)
		.map((match) => Number.parseInt(match[1], 10))
		.sort((left, right) => left - right);
}

/**
 * A command from an environment variable: either a JSON array of strings, or one bare path.
 * The bare form is what a person types (`PI_COC_OCR_CMD=/usr/local/bin/my-ocr`); the array form is
 * what a test needs, because it has to put an interpreter in front of a script.
 */
export function parseCommand(raw: string): string[] {
	const trimmed = raw.trim();
	if (!trimmed.startsWith("[")) return [trimmed];
	const parsed: unknown = JSON.parse(trimmed);
	if (!Array.isArray(parsed) || parsed.length === 0 || parsed.some((part) => typeof part !== "string")) {
		throw new Error("a command override must be a non-empty JSON array of strings, or a bare path");
	}
	return parsed as string[];
}

/** Whether the first word of a command names a file we can see (a bare name is left to PATH). */
function commandIsInstalled(command: string[]): boolean {
	const binary = command[0] ?? "";
	if (!binary.includes(sep) && !binary.includes("/")) return true;
	return existsSync(binary);
}

export interface CommandOutcome {
	ok: boolean;
	code: number | null;
	stdout: string;
	stderr: string;
	timedOut: boolean;
	ms: number;
	error?: string;
}

/**
 * Run one adapter command. Never throws: a spawn error, a non-zero exit and a timeout are all just
 * `ok: false` with something readable in `error`/`stderr`, because the job above turns them into
 * reason codes.
 *
 * The environment is inherited verbatim, which is how `BAIDUOCR_TOKEN` reaches the OCR command
 * without ever being written down here.
 */
export async function runCommand(
	command: string[],
	options: { cwd?: string; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<CommandOutcome> {
	const began = Date.now();
	const [binary, ...args] = command;
	return await new Promise<CommandOutcome>((resolve) => {
		let settled = false;
		let stdout = "";
		let stderr = "";
		let timedOut = false;
		let child: ReturnType<typeof spawn>;
		try {
			child = spawn(binary, args, {
				...(options.cwd ? { cwd: options.cwd } : {}),
				env: process.env,
				stdio: ["ignore", "pipe", "pipe"],
			});
		} catch (error) {
			resolve({
				ok: false,
				code: null,
				stdout: "",
				stderr: "",
				timedOut: false,
				ms: Date.now() - began,
				error: error instanceof Error ? error.message : String(error),
			});
			return;
		}

		const finish = (outcome: { ok: boolean; code: number | null; error?: string }) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			options.signal?.removeEventListener("abort", onAbort);
			resolve({ ...outcome, stdout, stderr: stderr.slice(-STDERR_KEEP), timedOut, ms: Date.now() - began });
		};
		const kill = () => {
			try {
				child.kill();
			} catch {
				/* already gone */
			}
		};
		const timer = setTimeout(() => {
			timedOut = true;
			kill();
		}, options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS);
		timer.unref?.();
		const onAbort = () => kill();
		options.signal?.addEventListener("abort", onAbort, { once: true });

		child.stdout?.setEncoding("utf8");
		child.stdout?.on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.stderr?.setEncoding("utf8");
		child.stderr?.on("data", (chunk: string) => {
			stderr += chunk;
			if (stderr.length > STDERR_KEEP * 2) stderr = stderr.slice(-STDERR_KEEP);
		});
		child.on("error", (error: Error) => finish({ ok: false, code: null, error: error.message }));
		child.on("exit", (code) => finish({ ok: !timedOut && code === 0, code: code ?? null }));
	});
}

/** The last JSON object printed on stdout, or undefined. A command may print progress lines before its summary. */
export function lastJsonObject(stdout: string): Record<string, unknown> | undefined {
	const lines = stdout.split("\n").map((line) => line.trim()).filter(Boolean);
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		if (!lines[index].startsWith("{")) continue;
		try {
			const parsed: unknown = JSON.parse(lines[index]);
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
		} catch {
			/* not the summary line */
		}
	}
	return undefined;
}

// ---- The extract adapter ---------------------------------------------------

/** What `classifyPdf` says about a book. No threshold and no judgement of ours: the list of pages is the library's own. */
export interface Classification {
	pdf_type?: string;
	page_count: number;
	pages_needing_ocr: number[];
	confidence?: number;
}

export interface Extractor {
	/** For telemetry: the library name, or the command line. */
	source: string;
	classify(pdf: string, buffer: Buffer): Promise<Classification>;
	/**
	 * Write `NNNN.md` into `pagesDir` for each requested page and return the pages actually written.
	 * `onPage` is called as each file lands, which is where the per-page progress of contract §20.2 comes from.
	 */
	extract(input: {
		pdf: string;
		buffer: Buffer;
		pages: number[];
		pagesDir: string;
		onPage?: (page: number, done: number, of: number) => void;
	}): Promise<{ written: number[]; needs_ocr: number[] }>;
}

function asNumberList(value: unknown): number[] {
	return Array.isArray(value)
		? value.filter((entry): entry is number => typeof entry === "number" && Number.isInteger(entry) && entry >= 0)
		: [];
}

/** Both spellings are accepted: the library answers in camelCase, a command adapter in snake_case. */
export function normalizeClassification(value: unknown): Classification {
	const row = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
	const pageCount = row.page_count ?? row.pageCount;
	return {
		...(typeof (row.pdf_type ?? row.pdfType) === "string" ? { pdf_type: String(row.pdf_type ?? row.pdfType) } : {}),
		page_count: typeof pageCount === "number" && pageCount > 0 ? Math.trunc(pageCount) : 0,
		pages_needing_ocr: [...new Set(asNumberList(row.pages_needing_ocr ?? row.pagesNeedingOcr))].sort((a, b) => a - b),
		...(typeof row.confidence === "number" ? { confidence: row.confidence } : {}),
	};
}

/** `extractPagesMarkdown` answers `{pages: [...], pagesNeedingOcr, ...}`; `extractPagesMarkdownAsync` may answer the bare array. */
function normalizePageRows(value: unknown): { pages: { page: number; markdown: string; needsOcr?: boolean }[]; needs_ocr: number[] } {
	const container = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
	const raw = Array.isArray(value) ? value : Array.isArray(container.pages) ? (container.pages as unknown[]) : [];
	const pages: { page: number; markdown: string; needsOcr?: boolean }[] = [];
	for (const entry of raw) {
		const row = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
		const page = row.page;
		if (typeof page !== "number" || !Number.isInteger(page) || page < 0) continue;
		pages.push({
			page,
			markdown: typeof row.markdown === "string" ? row.markdown : "",
			...(typeof row.needsOcr === "boolean" ? { needsOcr: row.needsOcr } : {}),
		});
	}
	const declared = asNumberList(container.pagesNeedingOcr ?? container.pages_needing_ocr);
	const perPage = pages.filter((row) => row.needsOcr === true).map((row) => row.page);
	return { pages, needs_ocr: [...new Set([...declared, ...perPage])].sort((a, b) => a - b) };
}

/**
 * The local library, imported lazily and guarded: on a platform with no prebuilt binary the import
 * throws and this answers undefined, which the job reports as `no_extractor` while the extension
 * itself keeps loading. 1.17.0 offers `extractPagesMarkdownAsync`; the older synchronous
 * `extractPagesMarkdown` is accepted too, so a machine that only has that one still works.
 */
export async function libraryExtractor(): Promise<Extractor | undefined> {
	let library: Record<string, unknown> | undefined;
	try {
		library = (await import(EXTRACTOR_PACKAGE)) as unknown as Record<string, unknown>;
	} catch {
		return undefined;
	}
	const module = (library?.default && typeof library.default === "object" ? { ...library, ...(library.default as object) } : library) as Record<string, unknown>;
	const classifyPdf = module.classifyPdf;
	const extractAsync = module.extractPagesMarkdownAsync;
	const extractSync = module.extractPagesMarkdown;
	const extractPages = typeof extractAsync === "function" ? extractAsync : extractSync;
	if (typeof classifyPdf !== "function" || typeof extractPages !== "function") return undefined;

	const { writeFile } = await import("node:fs/promises");
	return {
		source: EXTRACTOR_PACKAGE,
		async classify(_pdf, buffer) {
			return normalizeClassification(await (classifyPdf as (input: Buffer) => unknown)(buffer));
		},
		async extract({ buffer, pages, pagesDir, onPage }) {
			const result = await (extractPages as (input: Buffer, pages?: number[]) => unknown)(buffer, pages);
			const { pages: rows, needs_ocr } = normalizePageRows(result);
			const written: number[] = [];
			for (const row of rows) {
				await writeFile(join(pagesDir, pageFileName(row.page)), row.markdown, "utf8");
				written.push(row.page);
				onPage?.(row.page, written.length, rows.length);
			}
			return { written, needs_ocr };
		},
	};
}

/** The command form of the same adapter; see the header for its two verbs. */
export function commandExtractor(command: string[]): Extractor {
	return {
		source: command.join(" "),
		async classify(pdf) {
			const run = await runCommand([...command, "classify", pdf]);
			if (!run.ok) throw new Error(`the extract command failed to classify: ${run.error ?? (run.stderr.trim() || `exit code ${run.code}`)}`);
			return normalizeClassification(lastJsonObject(run.stdout));
		},
		async extract({ pdf, pages, pagesDir, onPage }) {
			const run = await runCommand([...command, "extract", pdf, "--pages", pages.join(","), "--out", pagesDir]);
			if (!run.ok) throw new Error(`the extract command failed: ${run.error ?? (run.stderr.trim() || `exit code ${run.code}`)}`);
			// The files on disk are the truth, not the command's own account of them.
			const written = (await pagesOnDisk(pagesDir)).filter((page) => pages.includes(page));
			for (const [index, page] of written.entries()) onPage?.(page, index + 1, written.length);
			return { written, needs_ocr: asNumberList(lastJsonObject(run.stdout)?.pages_needing_ocr) };
		},
	};
}

/** The extractor this process should use, or undefined when there is none (`no_extractor`). */
export async function resolveExtractor(): Promise<Extractor | undefined> {
	const raw = process.env.PI_COC_EXTRACT?.trim();
	if (raw === "none") return undefined;
	if (raw) return commandExtractor(parseCommand(raw));
	return await libraryExtractor();
}

// ---- The OCR adapter -------------------------------------------------------

/** The environment variable the outsourced OCR reads its credential from (contract §20.1). Its value is never read here. */
export const OCR_TOKEN_VARIABLE = "BAIDUOCR_TOKEN";

export interface OcrRunner {
	source: string;
	/** Whether it can run at all. A missing command or a missing token is `ocr_unavailable`, decided before anything is spawned. */
	check(): { ok: boolean; detail?: string };
	run(input: {
		pdf: string;
		pages: number[];
		outDir: string;
		signal?: AbortSignal;
	}): Promise<{ ok: boolean; written: number[]; backend?: string; detail?: string }>;
}

export function commandOcr(command: string[]): OcrRunner {
	return {
		source: command.join(" "),
		check() {
			if (!commandIsInstalled(command)) {
				return { ok: false, detail: `no OCR command at ${command[0]}` };
			}
			if (!process.env[OCR_TOKEN_VARIABLE]?.trim()) {
				return { ok: false, detail: `${OCR_TOKEN_VARIABLE} is not set in this environment` };
			}
			return { ok: true };
		},
		async run({ pdf, pages, outDir, signal }) {
			const run = await runCommand([...command, pdf, "--pages", pages.join(","), "--out", outDir], {
				...(signal ? { signal } : {}),
			});
			// Whatever it claims, the pages that count are the files it left behind.
			const written = (await pagesOnDisk(outDir)).filter((page) => pages.includes(page));
			const summary = lastJsonObject(run.stdout);
			const backend = typeof summary?.backend === "string" ? summary.backend : undefined;
			if (!run.ok) {
				return {
					ok: false,
					written,
					...(backend ? { backend } : {}),
					detail: run.error ?? (run.timedOut ? "the OCR command timed out" : run.stderr.trim() || `exit code ${run.code}`),
				};
			}
			return { ok: true, written, ...(backend ? { backend } : {}) };
		},
	};
}

/** `bin/coc-ocr` unless `PI_COC_OCR_CMD` names something else; `none` disables OCR outright. */
export function resolveOcr(): OcrRunner | undefined {
	const raw = process.env.PI_COC_OCR_CMD?.trim();
	if (raw === "none") return undefined;
	return commandOcr(raw ? parseCommand(raw) : [join(PKG_ROOT, "bin", "coc-ocr")]);
}

// ---- The packer ------------------------------------------------------------

/** What the manifest records as its producer. It is the packer that writes it; this only names who asked. */
export const BUNDLE_PRODUCER = "pi-coc-ingest";

export interface PackRequest {
	pagesDir: string;
	bundleDir: string;
	title: string;
	slug: string;
	language: string;
	fileSha256: string;
	filename: string;
	assetsDir?: string;
	assetMeta?: string;
	signal?: AbortSignal;
}

/** `bin/coc-bundle` unless `PI_COC_BUNDLE_CMD` names something else (a test seam). */
export function bundleCommand(): string[] {
	const raw = process.env.PI_COC_BUNDLE_CMD?.trim();
	return raw ? parseCommand(raw) : [join(PKG_ROOT, "bin", "coc-bundle")];
}

/**
 * Hand the pages to the packer and let it sign the manifest. We never write `manifest.json`
 * ourselves: `module.bind`'s byte check has to be checking this job's output, not repeating an
 * adapter's own claim about it.
 */
export async function packBundle(request: PackRequest): Promise<CommandOutcome & { command: string[] }> {
	const command = [
		...bundleCommand(),
		request.pagesDir,
		"--out",
		request.bundleDir,
		"--producer",
		BUNDLE_PRODUCER,
		"--title",
		request.title,
		"--slug",
		request.slug,
		"--language",
		request.language,
		"--file-sha256",
		request.fileSha256,
		"--filename",
		request.filename,
		...(request.assetsDir ? ["--assets", request.assetsDir] : []),
		...(request.assetMeta ? ["--asset-meta", request.assetMeta] : []),
	];
	const run = await runCommand(command, { ...(request.signal ? { signal: request.signal } : {}) });
	return { ...run, command };
}
