/**
 * Contract §151.2.3: an interrupted author's checked work is salvaged instead of rewritten.
 *
 * Blood05 (2026-09-28): pages 15-16 were authored again and again because an author stopped by closing the App leaves
 * `draft.json` but no read checkpoint, and every resume re-read the images and rewrote the draft from the start. The
 * interrupted attempt already holds what a checkpoint would have attested: the draft, and a log of the original pages
 * the provider actually received. If the structural checker passes that draft and every page it requires to be viewed
 * was delivered, the read is complete; the coverage review is the guard against an author stopped before it finished.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { successfulImageDeliveries } from "./reader-image-delivery.ts";

type Row = Record<string, any>;

/**
 * The checked graph and answer reads. Guidance is not salvaged: its guidance and public-field artifacts carry their own
 * checkpoint digests and validators, which an interrupted attempt never reached.
 */
const SALVAGEABLE = new Set(["opening", "detail", "answer"]);

/**
 * The original pages an attempt's authors actually delivered to the provider: host-supplied full pages whose image bytes
 * still match, and full-page `pdf` observations of tool calls a successful request included. Read from every author
 * log the attempt kept (`read-<round>[-targeted].jsonl` and its `.images.jsonl`); a crop is not a viewed page.
 */
export async function deliveredOriginalPages(attempt: string, source: { file_sha256: string; cache: string }): Promise<number[]> {
	const pages = new Set<number>();
	let names: string[] = [];
	try { names = await readdir(attempt); } catch { return []; }
	for (const name of names.filter(name => name.startsWith("read-") && name.endsWith(".jsonl.images.jsonl"))) {
		let delivered;
		try { delivered = await successfulImageDeliveries(join(attempt, name), source); } catch { continue; }
		for (const row of delivered.hostPages) pages.add(row.page);
		if (!delivered.toolCallIds.size) continue;
		let events: string;
		try { events = await readFile(join(attempt, name.slice(0, -".images.jsonl".length)), "utf8"); } catch { continue; }
		for (const line of events.split("\n")) {
			if (!line.includes("tool_execution_end")) continue;
			let event: Row;
			try { event = JSON.parse(line); } catch { continue; }
			if (event?.type !== "tool_execution_end" || event.isError || !delivered.toolCallIds.has(event.toolCallId)) continue;
			const result = event.result;
			if (result?.details?.kind !== "source_pages" || !result.content?.some((block: Row) => block?.type === "image")) continue;
			for (const row of Array.isArray(result.details.observations) ? result.details.observations : [])
				if (Number.isSafeInteger(row?.page) && row.page > 0 && (!row.box || JSON.stringify(row.box) === "[0,0,1,1]")) pages.add(row.page);
		}
	}
	return [...pages].sort((a, b) => a - b);
}

export type Salvage =
	| { eligible: false }
	| { eligible: true; salvaged: true; pages: number[]; required: number[] }
	| { eligible: true; salvaged: false; reason: "empty" | "checker" | "pages"; pages: number[]; required?: number[]; missing?: number[]; error?: string };

/** A draft with something in it: a node, a claim, a coverage entry or a source need, or any answer field. */
function nonEmpty(purpose: string, draft: unknown): boolean {
	if (!draft || typeof draft !== "object" || Array.isArray(draft)) return false;
	const value = draft as Row;
	if (purpose === "answer") return Object.keys(value).length > 0;
	return ["nodes", "claims", "source_needs"].some(key => Array.isArray(value[key]) && value[key].length > 0)
		|| !!value.coverage && typeof value.coverage === "object" && Object.keys(value.coverage).length > 0;
}

/**
 * Whether the interrupted attempt `attempt` (whose packet is `packet`) of this job can be marked read-complete from its
 * retained draft (already copied into the job's work directory). Only this job's own attempt, never one whose focus was
 * republished meanwhile (`resumed.reread`), a review retry or a repair: those owe a real read. `check` runs the
 * structural checker on the retained draft against this job's task.
 */
export async function salvageInterruptedRead(input: { attempt: string; packet: Row; job: Row; draft: unknown;
	source: { file_sha256: string; cache: string }; check(): Promise<Row> }): Promise<Salvage> {
	const { job } = input;
	if (!SALVAGEABLE.has(job.purpose) || input.packet?.job_id !== job.job_id || job.resumed?.reread === true || job.review_retry || job.repair)
		return { eligible: false };
	const pages = await deliveredOriginalPages(input.attempt, input.source);
	if (!nonEmpty(job.purpose, input.draft)) return { eligible: true, salvaged: false, reason: "empty", pages };
	let checked: Row;
	try { checked = await input.check(); }
	catch (error) { return { eligible: true, salvaged: false, reason: "checker", pages, error: String(error instanceof Error ? error.message : error).slice(0, 300) }; }
	if (checked?.ok !== true || !Array.isArray(checked.required_view_pages))
		return { eligible: true, salvaged: false, reason: "checker", pages, error: JSON.stringify(checked?.error ?? null).slice(0, 300) };
	const required = [...new Set<number>(checked.required_view_pages.filter((page: unknown): page is number => Number.isSafeInteger(page)))].sort((a, b) => a - b);
	const missing = required.filter(page => !pages.includes(page));
	if (missing.length) return { eligible: true, salvaged: false, reason: "pages", pages, required, missing };
	return { eligible: true, salvaged: true, pages, required };
}
