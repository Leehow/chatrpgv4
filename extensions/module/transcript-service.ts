/**
 * Contract §191.2, §191.4, §191.6, §191.9: the page-transcript producer.
 *
 * `ensure` queues the pages of one source file that have no record and no live claim; foreground pages are served first
 * among transcript work. Each page is one tools Pi child (`read,write,edit`) on a background reader slot, run with the
 * reading lane's model and thinking at the time of the call, given `page.png` (the existing page render) and `lines.txt`
 * (§191.1's native lines). It writes `layout.md`; the host assembles it (§191.3), runs one repair child for lines the layout
 * left out, and publishes the page under the file's digest. Nothing ever awaits a transcript: `ensure` returns once the
 * pages are queued, never throws into its caller, and a page without a record keeps its native text. A failed page is not
 * tried again by this service; a later session may.
 */
import { copyFile, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { HostRuntime } from "../../runtime/host.ts";
import type { ReaderOutcome } from "./reader.ts";
import { TaskLease } from "../../runtime/jev/task-context.ts";
import { createTaskProviderBudget, type TaskProviderBudget } from "../../runtime/jev/provider-budget.ts";
import { transcriptBudget, type TranscriptBudget } from "../../runtime/jev/host-budgets.ts";
import { assembleLayout, linesFile, repairFile, TRANSCRIPT_VERSION, type PageAssembly } from "./page-transcript.ts";
import { isFileDigest, sha256, TRANSCRIPT_RECORD_SCHEMA, TranscriptRefused, TranscriptStore, type TranscriptRecord, type TranscriptSource } from "./transcript-store.ts";
import { sourceTextVersion } from "./source.ts";

type Row = Record<string, unknown>;
export type TranscriptRuntime = Pick<HostRuntime, "home" | "contentRoot" | "runTask" | "sourcePage" | "sourceLines">;
export type TranscriptPriority = "foreground" | "background";
export interface TranscriptModel { id: string; vision: boolean; thinking?: string; contextWindow?: number }

export interface TranscriptDependencies {
	/** Absent until the owner's runtime exists: `ensure` is then a no-op. */
	runtime?: TranscriptRuntime;
	/** The reading lane's model, read when a child starts (`ReadingService`'s own `model()`). */
	model(): TranscriptModel;
	/** Telemetry: `lane: "transcript"` rows (§191.9). */
	record(row: Row): void;
	/** Tests only: the budget instead of the shipped file's `transcript` section. */
	budget?: TranscriptBudget;
	/** Tests only: the native extraction version records must carry, instead of this build's. */
	extractionVersion?: string;
}

export interface TranscriptEnsure { pdf: string; file_sha256: string; pages: number[]; priority?: TranscriptPriority }
export interface TranscriptEnsureResult {
	state: "queued" | "off" | "unavailable" | "invalid" | "closed" | "failed";
	queued: number[];
	reused: {home: number[]; seed: number[]};
	/** Being made here or by another producer, or failed earlier in this session. */
	skipped: number[];
}

interface Job { key: string; pdf: string; sha: string; page: number; priority: TranscriptPriority }
interface NativePage { page: number; pdf_label: string | null; native_sha256: string; lines: string[]; extraction_version: string }
interface Usage { inputTokens: number; outputTokens: number; costUsd: number; actions: number; unknownCalls: number }

/** `sourceLines` takes at most this many pages a call (§191.1). */
const LINES_BATCH = 32;
/**
 * The lease's room for one call's reservation, above what the child may actually spend. A call that carries the page image
 * reserves the model's whole declared context window (`runtime/jev/provider-budget.ts`); a model whose API takes no output
 * limit reserves its whole `maxTokens` -- 131,072 covers the largest such model the App uses, as `independentProviderBudget`
 * does. Without this room an image call could never be granted under the budget's `input_tokens`.
 */
const UNKNOWN_CONTEXT_WINDOW = 1_000_000;
const OUTPUT_RESERVATION_ROOM = 131_072;
/** The rest of the lease is `independentProviderBudget`'s: $10 and 16 calls for one child. */
const CHILD_COST_USD = 10;
const CHILD_ACTIONS = 16;
const CLOSE_WAIT_MS = 10_000;

const FIRST_BRIEF = "Lay out this page: read page.png and lines.txt, then write layout.md as your instructions say.";
const REPAIR_BRIEF = "Repair this page's layout: read repair.txt, layout.md, lines.txt and page.png, then edit layout.md so that every line "
	+ "repair.txt lists is placed where it belongs or added to the drop list. Keep the rest of layout.md as it is.";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 400);

export class TranscriptService {
	private readonly deps: TranscriptDependencies;
	private readonly controller = new AbortController();
	private readonly queue: Job[] = [];
	/** Queued or running in this service, by `<sha>:<page>`. */
	private readonly active = new Map<string, Job>();
	/** Records found or made, by `<sha>:<page>`: they never change, so they are read once. */
	private readonly known = new Map<string, TranscriptSource>();
	/** §191.4: a failed page is not tried again by this service. */
	private readonly failed = new Set<string>();
	private readonly native = new Map<string, Promise<NativePage | undefined>>();
	private readonly waiters: Array<() => void> = [];
	private running = 0;
	private closed = false;
	private storeValue?: TranscriptStore;
	private budgetValue?: Promise<TranscriptBudget>;

	constructor(deps: TranscriptDependencies) { this.deps = deps; }

	private budget(runtime: TranscriptRuntime): Promise<TranscriptBudget> {
		return this.budgetValue ??= this.deps.budget ? Promise.resolve(this.deps.budget) : transcriptBudget(runtime.contentRoot);
	}
	private store(runtime: TranscriptRuntime): TranscriptStore {
		return this.storeValue ??= new TranscriptStore({home: runtime.home, contentRoot: runtime.contentRoot,
			extractionVersion: this.deps.extractionVersion ?? sourceTextVersion});
	}
	private note(row: Row) { try { this.deps.record({lane: "transcript", ...row}); } catch { /* telemetry never fails the producer */ } }

	/** §191.6: queue the pages that have no record and no live claim. Never throws; never waits for a transcript. */
	async ensure(request: TranscriptEnsure): Promise<TranscriptEnsureResult> {
		const result: TranscriptEnsureResult = {state: "queued", queued: [], reused: {home: [], seed: []}, skipped: []};
		try {
			const runtime = this.deps.runtime;
			if (this.closed) return {...result, state: "closed"};
			if (!runtime) return {...result, state: "unavailable"};
			const budget = await this.budget(runtime);
			if (budget.mode === "off") return {...result, state: "off"};
			const pages = Array.isArray(request?.pages) ? [...new Set(request.pages)] : [];
			if (typeof request?.pdf !== "string" || !request.pdf || !isFileDigest(request.file_sha256) || !pages.length
				|| pages.some(page => !Number.isSafeInteger(page) || page < 1)) return {...result, state: "invalid"};
			const sha = request.file_sha256, priority: TranscriptPriority = request.priority === "foreground" ? "foreground" : "background";
			const store = this.store(runtime), stale = staleClaimMs(budget);
			for (const page of pages) {
				if (this.closed) return {...result, state: "closed"};
				const key = `${sha}:${page}`, known = this.known.get(key);
				if (known) { result.reused[known].push(page); continue; }
				const pending = this.active.get(key);
				if (pending) { if (priority === "foreground") pending.priority = "foreground"; result.skipped.push(page); continue; }
				if (this.failed.has(key)) { result.skipped.push(page); continue; }
				const found = await store.read(sha, page);
				if (found) { this.known.set(key, found.source); result.reused[found.source].push(page); continue; }
				const elsewhere = await store.claimedElsewhere(sha, page, stale);
				// A concurrent `ensure` may have queued the page while this one read the disk.
				const queued = this.active.get(key);
				if (queued && priority === "foreground") queued.priority = "foreground";
				if (elsewhere || queued || this.closed) { result.skipped.push(page); continue; }
				const job: Job = {key, pdf: request.pdf, sha, page, priority};
				this.active.set(key, job);
				this.queue.push(job);
				result.queued.push(page);
			}
			for (const source of ["home", "seed"] as const)
				if (result.reused[source].length) this.note({event: "reused", file_sha256: sha, pages: result.reused[source], source});
			this.pump(runtime, budget);
			return result;
		} catch (error) {
			this.note({event: "ensure_failed", file_sha256: request?.file_sha256, message: message(error)});
			return {...result, state: "failed"};
		}
	}

	/** Resolves when nothing is queued or running (an offline build, a test). */
	idle(): Promise<void> {
		if (!this.running && !this.queue.length) return Promise.resolve();
		return new Promise(resolve => this.waiters.push(resolve));
	}

	/** Stop: queued pages are dropped, running children are stopped; their claims are released. */
	async close(): Promise<void> {
		this.closed = true;
		this.controller.abort();
		for (const job of this.queue.splice(0)) this.active.delete(job.key);
		this.wake();
		let timer: ReturnType<typeof setTimeout> | undefined;
		await Promise.race([this.idle(), new Promise<void>(resolve => { timer = setTimeout(resolve, CLOSE_WAIT_MS); timer.unref?.(); })]);
		clearTimeout(timer);
	}

	private wake() {
		if (this.running || this.queue.length) return;
		for (const resolve of this.waiters.splice(0)) resolve();
	}

	private pump(runtime: TranscriptRuntime, budget: TranscriptBudget) {
		while (!this.closed && this.running < budget.concurrency && this.queue.length) {
			const foreground = this.queue.findIndex(job => job.priority === "foreground");
			const [job] = this.queue.splice(foreground >= 0 ? foreground : 0, 1);
			this.running++;
			void this.make(runtime, budget, job).catch(error => this.note({event: "page", file_sha256: job.sha, page: job.page, outcome: "failed", message: message(error)}))
				.finally(() => {
					this.running--;
					this.active.delete(job.key);
					this.native.delete(job.key);
					this.pump(runtime, budget);
					this.wake();
				});
		}
		this.wake();
	}

	/** The page's native lines, extracted with the other queued pages of its file (at most `LINES_BATCH` a call). */
	private nativePage(runtime: TranscriptRuntime, job: Job): Promise<NativePage | undefined> {
		const cached = this.native.get(job.key);
		if (cached) return cached;
		const batch = [job, ...this.queue.filter(other => other.sha === job.sha && other.pdf === job.pdf && !this.native.has(other.key))].slice(0, LINES_BATCH);
		const signal = this.controller.signal;
		const load = async (pages: number[], into: Map<number, NativePage>) => {
			const bundle = await runtime.sourceLines({pdf: job.pdf, pages, expected_file_sha256: job.sha}, signal);
			for (const row of bundle.pages ?? []) into.set(row.page, {...row, extraction_version: bundle.extraction_version});
		};
		const fetched = (async () => {
			const pages = new Map<number, NativePage>();
			try { await load(batch.map(member => member.page), pages); }
			catch (error) {
				// One page the extraction refuses must not take its batch with it.
				if (batch.length === 1 || signal.aborted) throw error;
				for (const member of batch) await load([member.page], pages).catch(() => undefined);
			}
			return pages;
		})();
		for (const member of batch) this.native.set(member.key, fetched.then(pages => pages.get(member.page)));
		return this.native.get(job.key)!;
	}

	/** §191.2's child lease: its own, sized by the budget, never a reading job's. */
	private lease(budget: TranscriptBudget, model: TranscriptModel): {budget: TaskProviderBudget; close(): void} {
		const window = Number.isSafeInteger(model.contextWindow) && (model.contextWindow as number) > 0 ? model.contextWindow as number : UNKNOWN_CONTEXT_WINDOW;
		const lease = new TaskLease({owner: "page-transcript", goal: "Lay out one page of a source PDF", scope: {owner: "page-transcript", audience: "system"},
			capabilities: [], readSet: [], signal: this.controller.signal,
			budget: {deadlineAt: Date.now() + budget.timeoutMs, remainingInputTokens: window + budget.inputTokens,
				remainingOutputTokens: OUTPUT_RESERVATION_ROOM + budget.outputTokens, remainingCostUsd: CHILD_COST_USD, remainingActions: CHILD_ACTIONS}});
		return {budget: createTaskProviderBudget(lease, {callOutputTokens: budget.outputTokens}), close: () => lease.close()};
	}

	private async make(runtime: TranscriptRuntime, budget: TranscriptBudget, job: Job): Promise<void> {
		const started = Date.now(), signal = this.controller.signal, store = this.store(runtime);
		const model = this.deps.model();
		const usage: Usage = {inputTokens: 0, outputTokens: 0, costUsd: 0, actions: 0, unknownCalls: 0};
		let attempts = 0, lineCount = 0;
		const page = (outcome: string, fields: Row = {}) => this.note({event: "page", file_sha256: job.sha, page: job.page, outcome, attempts, lines: lineCount,
			placed: 0, dropped: 0, unplaced: 0, free_removed: 0, image_text_chars: 0, model: model.id || null, thinking: model.thinking ?? null,
			ms: Date.now() - started, usage, ...fields});
		if (!model.vision) { this.failed.add(job.key); page("no_vision"); return; }
		const claim = await store.claim(job.sha, job.page, staleClaimMs(budget));
		// Another producer holds the page: this one waits for nothing, and readers keep the native text.
		if (!claim) return;
		const workDirs: string[] = [];
		try {
			const existing = await store.read(job.sha, job.page);
			if (existing) { this.known.set(job.key, existing.source); return; }
			const native = await this.nativePage(runtime, job);
			if (signal.aborted) return;
			if (!native) { this.failed.add(job.key); page("failed", {reason: "native_extraction_unavailable"}); return; }
			lineCount = native.lines.length;
			const rendered = await runtime.sourcePage({pdf: job.pdf, cache: store.renderCache(job.sha, job.page), page: job.page}, signal);
			const image = String((rendered as Row).path ?? "");
			const child = async (previous?: {layout: string; assembly: PageAssembly}): Promise<string | undefined> => {
				attempts++;
				const dir = store.workDir(job.sha, job.page, attempts);
				workDirs.push(dir);
				// We hold the claim: whatever an earlier producer left at this attempt is ours to replace.
				await rm(dir, {recursive: true, force: true});
				await mkdir(dir, {recursive: true});
				await copyFile(image, join(dir, "page.png"));
				await writeFile(join(dir, "lines.txt"), linesFile(native.lines));
				if (previous) {
					await writeFile(join(dir, "layout.md"), previous.layout);
					await writeFile(join(dir, "repair.txt"), repairFile(previous.assembly.unplaced, native.lines));
				}
				const lease = this.lease(budget, model);
				let outcome: ReaderOutcome;
				try {
					outcome = await runtime.runTask({kind: "reader", request: {cwd: dir, brief: previous ? REPAIR_BRIEF : FIRST_BRIEF,
						...(model.id ? {model: model.id} : {}), ...(model.thinking ? {thinking: model.thinking} : {}), priority: "background",
						systemPrompt: join(runtime.contentRoot, "setup", "page-transcript.md"), tools: "read,write,edit",
						timeoutMs: budget.timeoutMs, eventLog: join(dir, "run.jsonl"), providerBudget: lease.budget}}, signal);
				} finally { lease.close(); }
				for (const key of ["inputTokens", "outputTokens", "costUsd", "actions", "unknownCalls"] as const) usage[key] += outcome.usage?.[key] ?? 0;
				// The child is done when it exits; what it left in layout.md is read whatever its exit.
				return readFile(join(dir, "layout.md"), "utf8").catch(() => undefined);
			};
			const first = await child();
			if (signal.aborted) return;
			if (first === undefined) { this.failed.add(job.key); page("failed", {reason: "no_layout"}); return; }
			let best = {layout: first, assembly: assembleLayout(first, native.lines)};
			for (let repair = 0; repair < budget.repairAttempts && best.assembly.unplaced.length; repair++) {
				const layout = await child(best);
				if (signal.aborted) return;
				if (layout === undefined) continue;
				const assembly = assembleLayout(layout, native.lines);
				if (assembly.unplaced.length <= best.assembly.unplaced.length) best = {layout, assembly};
			}
			const {assembly} = best;
			const record: TranscriptRecord = {schema: TRANSCRIPT_RECORD_SCHEMA, transcript_version: TRANSCRIPT_VERSION, file_sha256: job.sha, page: job.page,
				pdf_label: native.pdf_label ?? null, native: {extraction_version: native.extraction_version, text_sha256: native.native_sha256, line_count: native.lines.length},
				text: assembly.text, text_sha256: sha256(assembly.text), markdown: assembly.markdown, image_text: assembly.image_text, figures: assembly.figures,
				dropped: assembly.dropped, unplaced: assembly.unplaced, free_removed: assembly.free_removed, attempts,
				model: model.id || null, thinking: model.thinking ?? null, at: new Date().toISOString()};
			const counts = {placed: assembly.order.length, dropped: assembly.dropped.length, unplaced: assembly.unplaced.length,
				free_removed: assembly.free_removed, ignored: assembly.ignored, mapped: assembly.mapped,
				image_text_chars: assembly.image_text.reduce((total, text) => total + Array.from(text).length, 0)};
			try {
				const stored = await store.put(record, native.lines);
				this.known.set(job.key, "home");
				page(assembly.unplaced.length ? "unplaced" : attempts > 1 ? "repaired" : "stored", {...counts, ...(stored === "exists" ? {already: true} : {})});
			} catch (error) {
				if (!(error instanceof TranscriptRefused)) throw error;
				this.failed.add(job.key);
				page("refused", {...counts, reason: error.reason});
			}
		} catch (error) {
			if (signal.aborted) return;
			this.failed.add(job.key);
			page("failed", {reason: message(error)});
		} finally {
			await claim.release().catch(() => undefined);
			// The render is reproducible from the PDF; the page's work keeps its layouts, lines and event logs.
			await rm(store.renderCache(job.sha, job.page), {recursive: true, force: true}).catch(() => undefined);
			for (const dir of workDirs) await unlink(join(dir, "page.png")).catch(() => undefined);
		}
	}
}

/** §191.4: a claim older than every attempt's wall clock plus a minute belongs to a producer that is gone. */
export function staleClaimMs(budget: TranscriptBudget): number {
	return budget.timeoutMs * (budget.repairAttempts + 1) + 60_000;
}
