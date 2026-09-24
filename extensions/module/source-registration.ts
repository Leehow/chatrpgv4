/**
 * The one host registration of an original PDF (contract §22.1, §14.16.3), shared by `/coc module
 * parse`, setup's `prepare-module` and the App's import. The kernel decides what the book is: a new
 * module, or the source of a built-in starter. For a starter whose window is not shipped, the kernel
 * names the window and the host extracts exactly those pages with PDF.js; the kernel never parses.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HostRuntime } from "../../runtime/host.ts";

type Row = Record<string, any>;
type Call = (method: string, params: Row) => Promise<Row>;
export type SourceRegistrationRuntime = Pick<HostRuntime, "sourceInfo" | "sourceWindow">;

/** The original PDF could not be opened by the host reader: nothing was registered. */
export class SourceUnreadable extends Error {
	readonly failure: unknown;
	constructor(failure: unknown) { super(failure instanceof Error ? failure.message : String(failure)); this.failure = failure; }
}

/** A refusal is recognised by its shape: errors cross extension and process boundaries (§22.6). */
function windowsRequired(failure: unknown): Row[] | undefined {
	const details = (failure as { details?: Row } | null)?.details;
	return details?.reason === "source_window_required" && Array.isArray(details.windows) ? details.windows : undefined;
}

export async function registerSourcePdf(input: {
	runtime: SourceRegistrationRuntime;
	call: Call;
	pdf: string;
	cache: string;
	params?: Row;
	signal?: AbortSignal;
}): Promise<Row & { source: Row }> {
	const { runtime, call, pdf, cache, params = {}, signal } = input;
	let source: Row;
	try { source = await runtime.sourceInfo({ pdf, cache }, signal) as Row; }
	catch (failure) { throw new SourceUnreadable(failure); }
	try {
		return { ...await call("module.source.bind", { ...params, source }), source };
	} catch (failure) {
		const windows = windowsRequired(failure);
		if (!windows) throw failure;
		const scratch = await mkdtemp(join(tmpdir(), "coc-source-window-"));
		try {
			const bound: Row[] = [];
			for (const window of windows) {
				const [first, last] = window.pages as [number, number];
				const extract = await runtime.sourceWindow({ pdf, first_page: first + 1, last_page: last + 1,
					out: join(scratch, `${window.module_id}.pdf`), expected_file_sha256: source.file_sha256 }, signal) as Row;
				bound.push(await call("module.source.bind", {
					...(params.campaign !== undefined ? { campaign: params.campaign } : {}),
					source: { path: extract.path, file_sha256: extract.file_sha256, page_count: extract.page_count },
					window: { module_id: window.module_id, file_sha256: source.file_sha256, pages: [first, last] },
				}));
			}
			return { ...bound[0], starters: windows.map(window => window.module_id), source };
		} finally {
			await rm(scratch, { recursive: true, force: true });
		}
	}
}
