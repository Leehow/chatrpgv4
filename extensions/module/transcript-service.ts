/**
 * Contract §191.2, §191.4, §191.6, §191.9: the page-transcript producer.
 *
 * `ensure` queues the pages of one source file that have no record and no live claim; foreground pages are served first
 * among transcript work. Each page is one Pi child on a background reader slot, run with the reading lane's model and
 * thinking at the time of the call and shown `page.png` (the existing page render) and `lines.txt` (§191.1's native lines)
 * as attachments. Its one tool is `submit_layout` (`layout-submit.ts`): the child never names a path, the host writes
 * `layout.md` and answers with the lines it left out, so a repair happens in the same session. The host assembles the kept
 * layout again (§191.3) and publishes the page under the file's digest. Nothing ever awaits a transcript: `ensure` returns
 * once the pages are queued, never throws into its caller, and a page without a record keeps its native text. A failed
 * page is not tried again by this service; a later session may. A page whose child ran out of time goes to the back of the
 * queue once (§191.6): a slept-through deadline looks the same as a hung provider.
 */
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { HostRuntime } from "../../runtime/host.ts";
import type { ReaderOutcome } from "./reader.ts";
import { TaskLease } from "../../runtime/jev/task-context.ts";
import { createTaskProviderBudget, type TaskProviderBudget } from "../../runtime/jev/provider-budget.ts";
import { transcriptBudget, type TranscriptBudget } from "../../runtime/jev/host-budgets.ts";
import { assembleLayout, linesFile, TRANSCRIPT_VERSION } from "./page-transcript.ts";
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
	/**
	 * §191.6: true while the table waits on a foreground reading. No new layout child starts then: a transcript is
	 * background work and must not compete with the reading a turn is waiting for.
	 */
	yieldTo?(): boolean;
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

/** `children`: layout children started for the page so far, a requeued run's included (they number its work directories). */
interface Job { key: string; pdf: string; sha: string; page: number; priority: TranscriptPriority; children: number }
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

/**
 * §191.2: the brief names no path. A child given paths to write once wrote its layout to paths it retyped wrong (TR-C);
 * now the host decides where the layout goes and the child only submits it.
 */
const BRIEF = "Lay out this page. The rendered page and its numbered text-layer lines are attached above. "
	+ "Submit the whole layout with submit_layout, as your instructions say.";
/** While the queue yields to a foreground reading or cools down, it looks again this often. */
const YIELD_POLL_MS = 2_000;
/** A Pi auto-retry whose provider error carries HTTP status 429. */
const RATE_LIMITED = /\b429\b/;

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
	/** §191.6: pages already sent back once because their child ran out of time; a second time fails them. */
	private readonly timedOut = new Set<string>();
	private readonly native = new Map<string, Promise<NativePage | undefined>>();
	private readonly waiters: Array<() => void> = [];
	private running = 0;
	private closed = false;
	/** §191.6: no new child starts before this time (a child met a provider rate limit). */
	private coolUntil = 0;
	private retryTimer?: ReturnType<typeof setTimeout>;
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
				const job: Job = {key, pdf: request.pdf, sha, page, priority, children: 0};
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
		if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = undefined; }
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
			const wait = this.holdFor();
			if (wait > 0) {
				this.retryTimer ??= setTimeout(() => { this.retryTimer = undefined; this.pump(runtime, budget); }, wait);
				this.retryTimer.unref?.();
				break;
			}
			const foreground = this.queue.findIndex(job => job.priority === "foreground");
			const [job] = this.queue.splice(foreground >= 0 ? foreground : 0, 1);
			this.running++;
			let again = false;
			void this.make(runtime, budget, job).then(next => { again = next === "requeue"; })
				.catch(error => this.note({event: "page", file_sha256: job.sha, page: job.page, outcome: "failed", message: message(error)}))
				.finally(() => {
					this.running--;
					this.native.delete(job.key);
					// §191.6: a page whose child ran out of time goes to the back of the queue once, still in its class.
					if (again && !this.closed) this.queue.push(job);
					else this.active.delete(job.key);
					this.pump(runtime, budget);
					this.wake();
				});
		}
		this.wake();
	}

	/** How long to wait before a new child may start: a foreground reading in wait, or a rate-limit cooldown; 0 to start now. */
	private holdFor(): number {
		let yielding = false;
		try { yielding = this.deps.yieldTo?.() === true; } catch { /* a failing probe never stops the queue */ }
		if (yielding) return YIELD_POLL_MS;
		const cooling = this.coolUntil - Date.now();
		return cooling > 0 ? Math.min(cooling, YIELD_POLL_MS * 30) : 0;
	}

	/** §191.6: a child whose provider answered 429 starts the cooldown. Reads the child's own event log. */
	private async rateLimited(eventLog: string, budget: TranscriptBudget, job: Job): Promise<void> {
		let text = "";
		try { text = await readFile(eventLog, "utf8"); } catch { return; }
		for (const line of text.split("\n")) {
			if (!line.includes("auto_retry_start")) continue;
			let event: Row; try { event = JSON.parse(line); } catch { continue; }
			if (event.type !== "auto_retry_start" || !RATE_LIMITED.test(String(event.errorMessage ?? ""))) continue;
			if (budget.cooldownMs > 0) {
				this.coolUntil = Math.max(this.coolUntil, Date.now() + budget.cooldownMs);
				this.note({event: "cooldown", file_sha256: job.sha, page: job.page, until: new Date(this.coolUntil).toISOString()});
			}
			return;
		}
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
		for (const member of batch) {
			const own = fetched.then(pages => pages.get(member.page));
			// A batch member nobody awaits yet (the service closes while the batch is read) must not reject unhandled; whoever
			// awaits it still sees the error.
			own.catch(() => undefined);
			this.native.set(member.key, own);
		}
		return this.native.get(job.key)!;
	}

	/** §191.2's child lease: its own, sized by the budget, never a reading job's. `expired`: it ended on its deadline. */
	private lease(budget: TranscriptBudget, model: TranscriptModel): {budget: TaskProviderBudget; deadlineAt: number; expired(): boolean; close(): void} {
		const window = Number.isSafeInteger(model.contextWindow) && (model.contextWindow as number) > 0 ? model.contextWindow as number : UNKNOWN_CONTEXT_WINDOW;
		const deadlineAt = Date.now() + budget.timeoutMs;
		const lease = new TaskLease({owner: "page-transcript", goal: "Lay out one page of a source PDF", scope: {owner: "page-transcript", audience: "system"},
			capabilities: [], readSet: [], signal: this.controller.signal,
			budget: {deadlineAt, remainingInputTokens: window + budget.inputTokens,
				remainingOutputTokens: OUTPUT_RESERVATION_ROOM + budget.outputTokens, remainingCostUsd: CHILD_COST_USD, remainingActions: CHILD_ACTIONS}});
		return {budget: createTaskProviderBudget(lease, {callOutputTokens: budget.outputTokens}), deadlineAt, close: () => lease.close(),
			expired: () => lease.signal.aborted && (lease.signal.reason as {code?: unknown} | undefined)?.code === "task_deadline"};
	}

	/** One run of a page: `"requeue"` when it should go to the back of the queue (§191.6). */
	private async make(runtime: TranscriptRuntime, budget: TranscriptBudget, job: Job): Promise<"requeue" | void> {
		const started = Date.now(), signal = this.controller.signal, store = this.store(runtime);
		const model = this.deps.model();
		const usage: Usage = {inputTokens: 0, outputTokens: 0, costUsd: 0, actions: 0, unknownCalls: 0};
		// `attempts` counts this run's children; rows and records carry the page's, a requeued run's included.
		let attempts = 0, submissions = 0, lineCount = 0, outOfTime = false;
		let publicationDeadline: number | undefined;
		const page = (outcome: string, fields: Row = {}) => this.note({event: "page", file_sha256: job.sha, page: job.page, outcome, attempts: job.children, submissions, lines: lineCount,
			placed: 0, dropped: 0, unplaced: 0, free_removed: 0, image_text_chars: 0, model: model.id || null, thinking: model.thinking ?? null,
			ms: Date.now() - started, usage, ...fields});
		if (!model.vision) { this.failed.add(job.key); page("no_vision"); return; }
		const claim = await store.claim(job.sha, job.page, staleClaimMs(budget));
		// Another producer holds the page: this one waits for nothing, and readers keep the native text.
		if (!claim) return;
		try {
			const existing = await store.read(job.sha, job.page);
			if (existing) { this.known.set(job.key, existing.source); return; }
			const native = await this.nativePage(runtime, job);
			if (signal.aborted) return;
			if (!native) { this.failed.add(job.key); page("failed", {reason: "native_extraction_unavailable"}); return; }
			lineCount = native.lines.length;
			const rendered = await runtime.sourcePage({pdf: job.pdf, cache: store.renderCache(job.sha, job.page), page: job.page}, signal);
			const image = String((rendered as Row).path ?? "");
			// One child per page: it submits its layout and repairs it in the same session (§191.2, `1 + repair_attempts`
			// submissions). The host writes the inputs; the child's only output is what it hands `submit_layout`.
			const child = async (): Promise<string | undefined> => {
				attempts++;
				job.children++;
				// Numbered across runs: a requeued run never replaces the timed-out run's evidence.
				await mkdir(join(store.dir(job.sha), "work"), {recursive: true});
				let workAttempt = job.children, dir = store.workDir(job.sha, job.page, workAttempt);
				for (;;) {
					try {await mkdir(dir); break;}
					catch (error) {if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;}
					dir = store.workDir(job.sha, job.page, ++workAttempt);
				}
				await copyFile(image, join(dir, "page.png"));
				await writeFile(join(dir, "lines.txt"), linesFile(native.lines));
				await writeFile(join(dir, "lines.json"), JSON.stringify(native.lines));
				const lease = this.lease(budget, model);
				publicationDeadline = lease.deadlineAt;
				let outcome: ReaderOutcome, expired = false;
				try {
					outcome = await runtime.runTask({kind: "reader", request: {cwd: dir, brief: BRIEF,
						...(model.id ? {model: model.id} : {}), ...(model.thinking ? {thinking: model.thinking} : {}), priority: "background",
						systemPrompt: join(runtime.contentRoot, "setup", "page-transcript.md"), tools: "", attachments: ["page.png", "lines.txt"],
						layout: {submissions: 1 + budget.repairAttempts},
						timeoutMs: budget.timeoutMs, eventLog: join(dir, "run.jsonl"), providerBudget: lease.budget}}, signal);
				} finally { expired = lease.expired(); lease.close(); }
				// The lease opens before the child starts, so its deadline usually fires before the reader's own timer.
				outOfTime = outcome.timedOut || expired;
				for (const key of ["inputTokens", "outputTokens", "costUsd", "actions", "unknownCalls"] as const) usage[key] += outcome.usage?.[key] ?? 0;
				await this.rateLimited(join(dir, "run.jsonl"), budget, job);
				submissions += await submissionCount(dir);
				// The child is done when it exits; the layout the host kept for it is read whatever its exit.
				return readFile(join(dir, "layout.md"), "utf8").catch(() => undefined);
			};
			// A child that submits no layout gets one fresh child when `repair_attempts` allows (TR-C: a 429 left none).
			let layout = await child();
			if (signal.aborted) return;
			if (layout === undefined && budget.repairAttempts > 0) { layout = await child(); if (signal.aborted) return; }
			if (layout === undefined) {
				// §191.6: a child that ran out of time sends the page back once; a second time it fails.
				if (outOfTime && !this.timedOut.has(job.key)) { this.timedOut.add(job.key); page("requeued", {reason: "timeout"}); return "requeue"; }
				this.failed.add(job.key);
				page("failed", {reason: outOfTime ? "timeout" : "no_layout"});
				return;
			}
			// The submission tool's findings were help for the model; the host assembles the kept layout itself.
			const assembly = assembleLayout(layout, native.lines);
			const record: TranscriptRecord = {schema: TRANSCRIPT_RECORD_SCHEMA, transcript_version: TRANSCRIPT_VERSION, file_sha256: job.sha, page: job.page,
				pdf_label: native.pdf_label ?? null, native: {extraction_version: native.extraction_version, text_sha256: native.native_sha256, line_count: native.lines.length},
				text: assembly.text, text_sha256: sha256(assembly.text), markdown: assembly.markdown, image_text: assembly.image_text, figures: assembly.figures,
				dropped: assembly.dropped, unplaced: assembly.unplaced, free_removed: assembly.free_removed, attempts: job.children,
				model: model.id || null, thinking: model.thinking ?? null, at: new Date().toISOString()};
			const counts = {placed: assembly.order.length, dropped: assembly.dropped.length, unplaced: assembly.unplaced.length,
				free_removed: assembly.free_removed, ignored: assembly.ignored, mapped: assembly.mapped,
				image_text_chars: assembly.image_text.reduce((total, text) => total + Array.from(text).length, 0)};
			try {
				const stored = await store.put(record, native.lines, publicationDeadline);
				this.known.set(job.key, "home");
				page(assembly.unplaced.length ? "unplaced" : attempts > 1 || submissions > 1 ? "repaired" : "stored", {...counts, ...(stored === "exists" ? {already: true} : {})});
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
		}
	}
}

/** §191.2: the layouts a child submitted, from the rows `submit_layout` appends (a call without a layout does not count). */
async function submissionCount(dir: string): Promise<number> {
	let text = "";
	try { text = await readFile(join(dir, "submissions.jsonl"), "utf8"); } catch { return 0; }
	let count = 0;
	for (const line of text.split("\n")) {
		if (!line.trim()) continue;
		try { if (Number.isSafeInteger(JSON.parse(line).submission)) count++; } catch { /* a torn row is not a submission */ }
	}
	return count;
}

/** §191.4: a claim older than every attempt's wall clock plus a minute belongs to a producer that is gone. */
export function staleClaimMs(budget: TranscriptBudget): number {
	return budget.timeoutMs * (budget.repairAttempts + 1) + 60_000;
}
