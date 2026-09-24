/** A single host service for PDF preparation and foreground/background reading. */
import { readFile, writeFile, mkdir, copyFile, appendFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { KernelError , isKernelError } from "../kernel/client.ts";
import { readerInput, wakeReaderSlots, type ReaderOutcome } from "./reader.ts";
import { providerRefusalText } from "../../runtime/jev/provider-budget.ts";
import { reviewCandidate } from "./reader-review.ts";
import { sourceAsset, closeSourceDocuments, sourceRenderVersion } from "./source.ts";
import { registerSourcePdf, SourceUnreadable } from "./source-registration.ts";
import { publishableAssetNodes, validateMapRegions } from "./map-publication.ts";
import type { HostRuntime } from "../../runtime/host.ts";
import type {FreshSourceNavigator} from '../../runtime/jev/fresh-source-navigator.ts';

import type {TaskProviderBudget} from '../../runtime/jev/provider-budget.ts';
import {measuredPageCost, playReadStage, readingStageBudget, type StageBudget} from '../../runtime/jev/reading-stage-budget.ts';
/**
 * `allowanceMs` (contract §22.4.3, SL-36): the foreground allowance of an in-turn source consultation. Past it `ensure`
 * resolves `{state: "pending", job_id, read, index, settled}` instead of refusing with `reading_timeout`: the waiter leaves
 * (§61 demotes the job), the reading goes on in the background, and `settled` is that same reading's outcome. The allowance's
 * named default is the lookup's (`SOURCE_ANSWER_ALLOWANCE_MS`, `extensions/kernel/source-answers.ts`).
 */
export interface ReadingOptions {providerBudget?:TaskProviderBudget; allowanceMs?: number}
type Row = Record<string, any>;
type Call = (method: string, params: Row) => Promise<any>;
export interface ReadingBridge {
	prepare(params: Row, signal?: AbortSignal, options?: ReadingOptions): Promise<Row>;
	ensure(moduleId: string, params: Row, signal?: AbortSignal, options?:ReadingOptions): Promise<Row>;
	/**
	 * §47. Is the reading the Keeper's foreground wait gave up on *still* running? A
	 * `reading_timeout` is the host's own patience ending, never the reader's: on campaign
	 * `game-b4cebfe0` (2026-09-16) the wait ran out at 120 s and the material arrived seconds later,
	 * while the sentence the player read still said it was being prepared. The service notice asks
	 * this at the moment it is sent, so a reading that has since landed is not announced as pending.
	 */
	reading(moduleId: string, params: Row): boolean;
}
interface Dependencies {
	call: Call;
	campaign?(): string | undefined;
	home: string;
	runtime?: HostRuntime;
	navigateFresh?: FreshSourceNavigator;
	model(): { id: string; vision: boolean; thinking?: string };
	progress(row: Row): void;
	record(row: Row): void;
	/** The operator's out-of-fiction surface for a lane that stopped working (contract §22, shaped after §32.2). */
	status?(row: Row): void;
}
interface PendingReading {
	providerBudget?:TaskProviderBudget;
	waiters: number;
	cancelled: boolean;
	jobId?: string;
	/**
	 * §61. Whether a turn is blocked on this reading *right now*, which is not the same as the
	 * `foreground` the first `ensure` asked for. Every later `ensure` that joins with `foreground`
	 * raises it again; the moment the last waiter leaves it drops, and `fulfil` stops re-asserting
	 * foreground on its next poll. Without this field the polling loop would re-promote the job in
	 * the kernel milliseconds after the demotion.
	 */
	foreground: boolean;
	/** §61. The last waiter left before this reading had a job id; demote it as soon as it has one. */
	demotePending?: boolean;
	/**
	 * §22.2.1. The kernel answered with another identity's reading of the same focus: this request waits on
	 * it and is judged afresh once it settles, and a cancelled wait never cancels that reading.
	 */
	attached?: boolean;
	/** §47. What this in-flight reading is of, so `reading()` can answer for it by name. */
	of?: { campaign?: string; mid: string; focus: string; question: string };
	/** §22.4.3. What the book's index holds on this consultation's focus, from the kernel's last reply. */
	index?: Row[];
}
/**
 * How long a claimed reading job may report nothing at all before the host stops it. A reader child
 * that is working says so: every phase change, every reader run and every review unit writes a
 * telemetry row, and the longest legitimate gap measured on a real book was 141 s (one review unit,
 * campaign game-3dd94f0a). A job past this window is not slow, it is gone -- on 2026-09-15 two of
 * them went quiet mid-verify and left the module `blocked` for 6.5 hours with a restart as the only
 * remedy. The window is deliberately far above the observed gap: a false stop costs a real reader run.
 */
const STALL_WINDOW_MS = 600_000;
const STALL_SWEEP_MS = 30_000;
function stallWindow(): number {
	const configured = Number(process.env.PI_COC_READ_STALL_MS);
	return Number.isFinite(configured) && configured > 0 ? configured : STALL_WINDOW_MS;
}
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
function canonical(value: any): string {
	if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
	if (value && typeof value === "object") return "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
	return JSON.stringify(value);
}
const integerList = (value: unknown): number[] => Array.isArray(value)
	? value.filter((entry): entry is number => Number.isInteger(entry))
	: [];
const mapCandidateKey = (candidate: Row): string => canonical({
	name: candidate.name,
	focus: candidate.focus,
	pages: [...integerList(candidate.pages)].sort((a, b) => a - b),
});
function editedSourcePages(before: Row, after: Row): Set<number> {
	const result = new Set<number>();
	if (Array.isArray(after.source_refs) && canonical(before) !== canonical(after))
		for (const ref of after.source_refs) result.add(ref.page);
	for (const collection of ["nodes", "claims"]) {
		const id = (row: Row) => row.node_id ?? row.claim_id ?? canonical([row.subject_id, row.predicate, row.object]);
		const previous = new Map((before[collection] ?? []).map((r: Row) => [id(r), canonical(r)]));
		for (const row of after[collection] ?? []) {
			if (previous.get(id(row)) === canonical(row)) continue;
			for (const ref of [...(row.source_refs ?? []), ...(row.properties?.image_sources ?? [])]) result.add(ref.page);
		}
	}
	return result;
}
function draftPages(draft: Row): number[] { return [...editedSourcePages({}, draft)]; }
function validCheckpoint(checkpoint: Row, bytes: Buffer, job: Row): boolean {
	if (checkpoint.draft_sha256 !== sha(bytes)) return false;
	const observed = checkpoint.observations;
	if (observed?.file_sha256 !== job.source.file_sha256) return false;
	return job.purpose === "index"
		? checkpoint.index_map_audited === true && observed.full_pages?.length > 0
		: draftPages(JSON.parse(bytes.toString())).every(page => observed.read_pages?.includes(page));
}
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const error = (reason: string, message: string, fix: string, extra: Row = {}) =>
	new KernelError({ code: "needs", message, fix, details: { reason, ...extra } });
/**
 * Contract §20 addendum 2: a round that failed on the provider, typed. A refusal from a lease the job shares
 * across its rounds (`shared`, a stage lease) is final: the second round would reserve from the same lease.
 * The error's details carry §22.3.1's `rule`/`reason` strings, so the kernel keeps them on the failed job.
 */
function providerFailure(run: ReaderOutcome, shared: boolean): { error: KernelError; final: boolean } {
	const refusal = run.refusal;
	const message = refusal ? providerRefusalText(refusal)
		: `reader_transport: the provider failed the round (${String(run.providerError).slice(0, 300)})`;
	return { final: !!refusal && shared, error: new KernelError({ code: "needs", message, fix: "request the same reading with retry: true",
		details: { reason: refusal ? refusal.reason : "transport", rule: refusal ? "provider_budget_refused" : "reader_transport",
			...(refusal ? { refusal } : { provider_error: run.providerError }) } }) };
}
/**
 * §22.3.1 / §48: a reading the publication gate refused is said in one sentence built from the refusal the
 * kernel kept -- the field it refused and the gate's own reason, the same record findings.json holds. It is
 * written here, so it is branded `said` here; the preparation overlay shows it instead of the generic stop.
 */
function refusedReading(params: Row, refusal: Row, fix: string): KernelError {
	const of = String(params.focus ?? "").trim(), at = typeof refusal.path === "string" && refusal.path ? ` at ${refusal.path}` : "";
	const failure = new KernelError({ code: "needs", fix,
		message: `The reading of ${of ? `"${of}"` : "this book"} was refused${at}: ${String(refusal.message).split("\n")[0].replace(/[.\s]+$/, "")}.`,
		details: { reason: "reading_failed", refusal } });
	return Object.assign(failure, { said: true });
}
/**
 * A draft the kernel refused with a fix is a repair, whatever the reading was for. Only an opening
 * used to get the round; an index refused for rows without their contents-page reference, or a
 * detail refused on one node, ended as a failed job nobody retried, and the book stayed unread.
 */
/** §90.3's own words: the one thing a way-on repair adds, and what it must not touch. */
const WAY_ON_ASK = "This reading repairs one thing: the opening scene publishes no way on. Keep every node and claim already in the retained draft exactly as it is, including ready_nodes, and add only what the pages state: either the relation the book gives from this scene to the place it leads to (route-to, play-precedes, may-lead-to, alternative-to or hands-off-to) together with the target scene node the book names for it, or, when the book ends in this scene, is_final on this scene. Do not invent a destination the pages do not name, and do not remove anything.";
function finishSemanticRejection(failure: unknown): boolean {
	return isKernelError(failure) && failure.code === "invalid_params";
}
/** Resolve a JSON pointer against a draft, or `undefined` when it does not land. */
function atPointer(draft: Row, pointer: unknown): unknown {
	if (typeof pointer !== "string" || !pointer.startsWith("/")) return undefined;
	let value: any = draft;
	for (const raw of pointer.slice(1).split("/")) {
		const key = raw.replaceAll("~1", "/").replaceAll("~0", "~");
		if (value === null || typeof value !== "object") return undefined;
		value = Array.isArray(value) ? value[Number(key)] : value[key];
	}
	return value;
}
/**
 * The one repair an unsupported number has, said in words the repair round can act on.
 *
 * Every numeric properties field is reviewed automatically, so a number the book does not
 * print cannot be cited into support — it has to go. Nothing told the reader that. The
 * reviewer reports only that it found no source; the kernel answers *correct the draft using
 * the original pages and submit again*; and the repair round, handed both, re-cited the same
 * invented value and failed identically (§74).
 *
 * Measured on `Masks of Nyarlathotep` (669 pages, 2026-09-17): one minor NPC's `age: 32`,
 * `missing: []`, every other unit supported. Two rounds failed, and the player's only offered
 * recovery -- the offer to keep preparing in the background -- inherited the same draft and
 * failed a third time. A book prepared but
 * for one fabricated number is unplayable forever.
 *
 * Only numbers get this line. A prose field the review could not support may well be
 * repairable by reading the right page, and telling the reader to delete it would trade a
 * stall for a silent omission.
 */
function unsupportedNumberRepairs(draft: Row, unsupported: Row[]): string[] {
	const repairs: string[] = [];
	for (const row of unsupported) {
		const paths = Array.isArray(row?.paths) ? row.paths : [row?.path];
		for (const path of paths) {
			if (typeof atPointer(draft, path) !== "number") continue;
			repairs.push(`${path}: the review found no page stating this number. Either view a page that prints this exact value and cite it, or delete the field. Re-citing pages that do not print it fails the same way. Deleting an unsourced number is a correct repair, not a loss: the field stops being reviewed once it is gone.`);
		}
	}
	return repairs;
}


export class ReadingService implements ReadingBridge {
	private stopped = false;
	private requests = new Map<string, PendingReading & { task: Promise<Row> }>();
	private jobBudgets=new Map<string,TaskProviderBudget>();
	private claimBindings = new Map<string, Promise<void>>();
	private pumps = new Map<string, Promise<void>>();
	private pumpWakes = new Map<string, () => void>();
	private controllers = new Map<string, AbortController>();
	private jobs = new Map<string, Row>();
	private cancelledJobs = new Set<string>();
	/** Per claimed job, the moment it last reported anything: the lane's own heartbeat, never an inference from elapsed wall clock. */
	private heartbeats = new Map<string, number>();
	/** Jobs this host stopped for going quiet, and how long they had been quiet: their finish is `failed`, not `cancelled`. */
	private stalled = new Map<string, number>();
	/** Jobs stopped at a hand-off (`dispose({handOff})`): their finish is left to the next owner's claim. */
	private handedOff = new Set<string>();
	/**
	 * §22.4.6 (SL-45). Background jobs this host stopped to give their slot to a blocking read: when, and for which job.
	 * Their attempt is returned with `module.read.yield`, never finished.
	 */
	private displaced = new Map<string, {at: number; forJob?: string}>();
	/** When this host started each claimed job, for the displacement row's `ran_ms`. */
	private startedAt = new Map<string, number>();
	private sweep: ReturnType<typeof setInterval> | undefined;
	private stallNotified = false;
	/** Per scoped module, the reason of the most recent wake no claim has answered yet: the claim row names it (contract §22, #65). */
	private wakes = new Map<string, string>();
	private readonly deps: Dependencies;
	/**
	 * The unwrapped recorder, for rows the *host* writes about a job rather than rows the job writes
	 * about itself. The wrapper below is a heartbeat, and a host decision such as §61's demotion is no
	 * evidence that the reader child is still alive: recording it through the wrapper would hand a
	 * silent reader up to ten more minutes before the stall watchdog stopped it.
	 */
	private readonly note: (row: Row) => void;
	constructor(deps: Dependencies) {
		// Every row a claimed job writes is also its heartbeat. Wrapping here rather than at each call
		// site makes the rule structural: anything that reaches the operator reaches the stall watchdog,
		// and a new telemetry row can never be added without the lane counting as alive when it lands.
		const beat = (row: Row) => { if (row && row.job_id) this.beat(JSON.stringify([row.campaign, row.module_id, row.job_id])); };
		this.note = row => deps.record(row);
		this.deps = { ...deps,
			record: row => { beat(row); deps.record(row); },
			progress: row => { beat(row); deps.progress(row); } };
	}
	private campaign(params: Row): string | undefined {
		// null explicitly selects the library, even when this service is bound to a campaign.
		return params.campaign === null ? undefined : params.campaign ?? this.deps.campaign?.();
	}
	private call(method: string, params: Row, campaign: string | undefined): Promise<any> {
		const { campaign: _scope, ...rest } = params;
		return this.deps.call(method, { ...rest, ...(campaign !== undefined ? { campaign } : {}) });
	}
	/** A queued job must receive its budget before this service can claim it, including a prefetch wake. */
	private async bindBeforeClaim<T>(mid: string, campaign: string | undefined, action: () => Promise<T>): Promise<T> {
		const scope = JSON.stringify([campaign, mid]), previous = this.claimBindings.get(scope);
		let release!: () => void;
		const binding = new Promise<void>(resolve => { release = resolve; });
		this.claimBindings.set(scope, binding);
		try { if (previous) await previous; return await action(); }
		finally { release(); if (this.claimBindings.get(scope) === binding) this.claimBindings.delete(scope); }
	}
	private runtime(): HostRuntime {
		if (!this.deps.runtime) throw new Error("Source reading requires its owner's runtime");
		return this.deps.runtime;
	}

	/**
	 * Stop every claimed reading. With `handOff` (the onboarding worker's exit, contract §20 addendum 2), a
	 * reading nobody is waiting on is handed off rather than cancelled: its reader child stops and the job is
	 * left `running` with no lock holder, which the next owner's claim re-queues with its retained attempt.
	 */
	dispose(options: {handOff?: boolean} = {}) {
		this.stopped = true;
		this.stopSweep();
		for (const [key, controller] of this.controllers) {
			if (options.handOff && this.jobs.get(key)?.foreground !== true) this.handedOff.add(key);
			controller.abort();
		}
	}

	async close(options: {handOff?: boolean} = {}) { this.dispose(options); try { await Promise.allSettled([...this.pumps.values()]); } finally { await closeSourceDocuments(); } }

	/** The heartbeat of one claimed job. Called only where the reader reported something real. */
	private beat(key: string) { if (this.heartbeats.has(key) || this.controllers.has(key)) this.heartbeats.set(key, Date.now()); }

	private startSweep() {
		if (this.sweep || this.stopped) return;
		this.sweep = setInterval(() => this.checkStalls(), Math.min(STALL_SWEEP_MS, stallWindow()));
		this.sweep.unref?.();
	}

	private stopSweep() {
		if (!this.sweep) return;
		clearInterval(this.sweep);
		this.sweep = undefined;
	}

	/**
	 * A reading job that has reported nothing for the whole stall window is stopped and finished as
	 * `failed`, so the module stops saying "still being read" and the ordinary `retry: true` path
	 * (contract §22) can pick it up. It is not requeued here: an automatic requeue would re-spend a
	 * real reader run on a child that just proved it hangs, and the host already owns one bounded
	 * automatic repair per read identity per player turn.
	 */
	checkStalls(now = Date.now()): void {
		const window = stallWindow();
		for (const [key, at] of [...this.heartbeats]) {
			const idle = now - at;
			if (idle < window) continue;
			const job = this.jobs.get(key);
			if (!job || this.stalled.has(key)) continue;
			this.stalled.set(key, idle);
			const [campaign, moduleId] = JSON.parse(key) as [string | undefined, string, string];
			const row = { lane: "reading", event: "stalled", module_id: moduleId, campaign, job_id: job.job_id,
				purpose: job.purpose, focus: job.focus ?? "", idle_ms: idle, window_ms: window, foreground: job.foreground === true };
			// No `-progress` frame: §22.5 fixes that channel's `stage` to source|index|read|verify, and a
			// stall is not a stage. The telemetry row above and the operator notice below carry the signal.
			this.deps.record(row);
			// The operator's surface, once per session-level outage: the reader lane is a service, and a
			// service that keeps dying is not something the player or the Keeper can fix (contract §32.2).
			if (!this.stallNotified) {
				this.stallNotified = true;
				this.deps.status?.({ ...row, status: "down",
					fix: "The source reader stopped reporting progress and was stopped, so this material stays unprepared. Check the reader model and provider, or set PI_COC_BUILD_MODEL to a healthy provider/model; the table keeps playing on everything already prepared." });
			}
			this.controllers.get(key)?.abort();
		}
		if (!this.heartbeats.size) this.stopSweep();
	}

	prefetch(moduleId: string, reason = 'requested'): Promise<void> {
		if (this.stopped) return Promise.resolve();
		const campaign = this.deps.campaign?.();
		this.deps.record({lane:'reading',event:'prefetch_wake',module_id:moduleId,campaign,reason});
		this.wakes.set(JSON.stringify([campaign, moduleId]), reason);
		return this.pump(moduleId, campaign);
	}

	/** `options.providerBudget` is the stage lease the whole preparation pays from (contract §20 addendum 2). */
	async prepare(params: Row, signal?: AbortSignal, options: ReadingOptions = {}): Promise<Row> {
		const campaign = this.campaign(params);
		let mid = params.module_id;
		if (params.pdf) {
			const model = this.deps.model();
			if (!model.vision) throw error("vision_required", "the configured reader cannot receive images", "select a reader model with image input");
			const path = resolve(this.deps.home, params.pdf);
			this.deps.progress({ stage: "source" });
			let bound: Row;
			try {
				const runtime = (() => { try { return this.runtime(); } catch (failure) { throw new SourceUnreadable(failure); } })();
				bound = await registerSourcePdf({ runtime, call: this.deps.call, pdf: path, cache: this.deps.home, signal,
					params: { ...(mid ? { module_id: mid } : {}), ...(campaign !== undefined ? { campaign } : {}), title: basename(path, ".pdf") } });
			} catch (failure) {
				if (!(failure instanceof SourceUnreadable)) throw failure;
				if (isKernelError(failure.failure)) throw failure.failure;
				throw error("bad_pdf", `the original PDF could not be opened: ${failure.message}`, "choose an accessible, readable original PDF");
			}
			mid = bound.module_id;
			// §14.16.3: the book is a built-in starter's source; its authored graph is already playable.
			if (Array.isArray(bound.starters)) return { ok: true, module_id: mid, opening_ready: true, starters: bound.starters };
        }
		if (!mid) throw error("needs_source", "choose a PDF or an existing module", "pass pdf or module_id");
		if (params.purpose === "guidance") {
			const result = await this.ensure(mid, {...params, campaign:null, focus: params.start_scene || "", foreground:true}, signal, options);
			return {...result, module_id:mid};
		}
		if (params.start_scene && params.targeted === true) {
			await this.ensure(mid, {purpose:"opening", campaign:campaign ?? null, focus:params.start_scene, foreground:true, retry:params.retry===true}, signal, options);
			return {ok:true, module_id:mid, opening_ready:true};
		}
		await this.ensure(mid, { purpose: "skeleton", campaign: null, foreground: true, retry: params.retry === true }, signal, options);
		const status = await this.deps.call("module.status", { module_id: mid });
		if (!params.start_scene && status.opening_candidates?.length > 1) {
			throw new KernelError({ code: "needs_choice", message: "choose the opening for this new campaign",
				fix: "match the player's intent to the candidate summaries, then pass its scene as start_scene in prepare-module",
				details: { field: "start_scene", candidates: status.opening_candidates } });
		}
		await this.ensure(mid, { purpose: "opening", campaign: null, focus: params.start_scene ?? "", foreground: true, retry: params.retry === true }, signal, options);
		return { ok: true, module_id: mid, opening_ready: true };
	}

	/**
	 * §47. Whether a reading of this material is still in flight *right now*. The map is the whole
	 * answer: `ensure` puts a request in it and the task's `finally` takes it out, so a reading that
	 * has landed, failed or been cancelled since the Keeper's foreground wait expired is already gone
	 * from it. Matched by focus and question rather than by the full `ensure` key, because the wait
	 * the host retained keeps only what the refusal told it (§22's `details.read`), and because a
	 * second reading of the same material under another purpose is still that material being read.
	 * An empty focus matches nothing: it would make every reading answer for every wait.
	 */
	reading(mid: string, params: Row): boolean {
		const focus = String(params.focus ?? ""), question = String(params.question ?? "");
		if (!focus && !question) return false;
		for (const request of this.requests.values()) {
			const of = request.of;
			if (!of || request.cancelled || of.mid !== mid) continue;
			if (of.focus === focus && of.question === question) return true;
		}
		return false;
	}

	async ensure(mid: string, params: Row, signal?: AbortSignal, options:ReadingOptions={}): Promise<Row> {
		if (signal?.aborted || this.stopped) throw error("reading_failed", "reading was cancelled", "retry the reading when ready");
		const campaign = this.campaign(params);
		if (params._task_prepare && !options.providerBudget) throw error('source_preparation_budget_missing', 'Owned source preparation requires its original provider budget', 'Retry through the pending operation owner');
		const key = JSON.stringify([campaign, mid, params.purpose, params.material ?? "", params.focus ?? "", params.question ?? "", params.guidance_key ?? "", canonical(params._task_prepare ?? null)]);
		let request = this.requests.get(key);
		if(request&&request.providerBudget!==options.providerBudget&&(request.providerBudget||options.providerBudget))throw error('reading_failed','This reading already has a different provider budget owner','Wait for its source owner to finish');
		if (!request) {
			const pending: PendingReading = { providerBudget:options.providerBudget,waiters: 0, cancelled: false, foreground: params.foreground === true,
				of: { campaign, mid, focus: String(params.focus ?? ""), question: String(params.question ?? "") } };
			const task = this.fulfil(mid, params, pending, campaign).finally(() => this.requests.delete(key));
			task.catch(() => undefined);
			request = Object.assign(pending, { task });
			this.requests.set(key, request);
		}
		// A later turn that joins this same reading in the foreground puts the wait back (§61); `fulfil`
		// re-asserts it with the kernel on its next poll, the same way a fresh foreground request would.
		if (params.foreground === true) request.foreground = true;
		request.waiters++;
		let waiting = true, aborting = false;
		const releaseWaiter = () => {
			if (!waiting) return;
			waiting = false;
			request.waiters--;
			// An abort cancels the reading outright, so it must not also demote it on the way out.
			if (aborting) return;
			// §61. The last waiter is gone and nobody cancelled: the reading goes on, the wait does not.
			// Releasing the foreground lease here rather than on a clock is the whole point -- this fires
			// on the real event (the turn stopped waiting), never on elapsed time.
			if (request.waiters === 0 && !request.cancelled && request.foreground) {
				request.foreground = false;
				if (request.jobId) this.unwait(mid, request.jobId, campaign);
				else request.demotePending = true;
			}
		};
		let timer: ReturnType<typeof setTimeout> | undefined;
		let onAbort: (() => void) | undefined;
		try {
			const configured = Number(process.env.PI_COC_READ_WAIT_MS);
			// §22.4.3: a consultation's allowance, when the caller gives one, replaces the foreground wait.
			const allowance = options.allowanceMs;
			const wait = allowance !== undefined ? allowance : Number.isFinite(configured) && configured > 0 ? configured : 120_000;
			const interrupted = new Promise<Row>((resolvePending, reject) => {
				timer = setTimeout(() => allowance !== undefined ? resolvePending({ state: "pending", ...(request.jobId ? { job_id: request.jobId } : {}),
					...(request.attached ? { attached: true } : {}), read: { purpose: params.purpose, focus: params.focus ?? "", question: params.question ?? "" },
					index: request.index ?? [], settled: request.task }) : reject(error("reading_timeout", "the source is still being read",
					params.purpose === "opening" ? "return control, then call prepare-module again to rejoin the retained preparation"
						: `use ask to return control; on a later player turn, ${params.purpose === 'answer' ? 'repeat lookup kind=source source_mode=answer' : 'retry the original action or lookup kind=source'} with the exact focus and question in details.read; do not invent another question`,
					// The job handle travels beside `read` for telemetry (#65); the fix names only `read`, so the model does not see it.
					{ read: { purpose: params.purpose, ...(params.material ? { material: params.material } : {}), focus: params.focus ?? "", question: params.question ?? "" },
						...(request.jobId ? { job_id: request.jobId } : {}) })), wait);
				onAbort = () => {
					aborting = true;
					releaseWaiter();
					if (request.waiters === 0) {
						request.cancelled = true;
						if (request.jobId && !request.attached) this.cancelJob(mid, request.jobId, campaign);
					}
					reject(error("reading_failed", "reading was cancelled", "retry explicitly when ready"));
				};
				signal?.addEventListener("abort", onAbort, { once: true });
			});
			return await Promise.race([request.task, interrupted]);
		} finally {
			if (timer) clearTimeout(timer);
			if (onAbort) signal?.removeEventListener("abort", onAbort);
			releaseWaiter();
		}
	}

	/**
	 * How a stopped attempt is published. A job this host aborted because it went quiet is `failed`
	 * with the silence named, not `cancelled`: `cancelled` reads as "somebody asked for this to stop"
	 * and leaves no reason on disk, and only `failed` offers the retry the Keeper and the operator need.
	 */
	private jobOutcome(key: string, aborted: boolean, detail: string): Row {
		const idle = this.stalled.get(key);
		if (idle === undefined) return { outcome: aborted ? "cancelled" : "failed", detail };
		return { outcome: "failed", detail: `the reader reported nothing for ${Math.round(idle / 1000)}s and was stopped` };
	}

	private cancelJob(mid: string, jobId: string, campaign: string | undefined) {
		const key = JSON.stringify([campaign, mid, jobId]);
		this.cancelledJobs.add(key);
		this.controllers.get(key)?.abort();
		void this.pump(mid, campaign);
	}

	/**
	 * §61. The last turn waiting on this reading has stopped waiting. The reading is *not* cancelled --
	 * its material still lands and §47's notice still answers for it -- but it gives up the single
	 * foreground lease, so the next read the table is actually blocked on can claim at once. The pump
	 * is woken in the same breath: a freed lease nobody claims is the defect this repairs.
	 */
	private unwait(mid: string, jobId: string, campaign: string | undefined) {
		const key = JSON.stringify([campaign, mid, jobId]);
		const running = this.jobs.get(key);
		if (running) running.foreground = false;
		void this.call("module.read.unwait", { module_id: mid, job_id: jobId }, campaign)
			.then(() => {
				// Written by the host about the job, so it is not the job's heartbeat (see `note`).
				this.note({ lane: "reading", event: "unwaited", module_id: mid, campaign, job_id: jobId });
				wakeReaderSlots();
				return this.pump(mid, campaign);
			})
			// A lease the kernel would not give back is exactly the state this section exists to make
			// visible, so the failure is recorded rather than swallowed. It fails no turn: nobody is
			// waiting on this reading any more, which is why it was being released.
			.catch(failure => this.note({ lane: "reading", event: "unwait_failed", module_id: mid, campaign, job_id: jobId,
				detail: failure instanceof Error ? failure.message : String(failure) }));
	}

	/**
	 * §22.4.6. The job a request of this host is blocked on (a turn waits on it now) when that job is not running here yet:
	 * the pump may then claim past its own capacity, to place it or to learn which background read yields.
	 */
	private blockingWaiting(mid: string, campaign: string | undefined): string | undefined {
		for (const request of this.requests.values()) {
			const of = request.of;
			if (!of || of.mid !== mid || of.campaign !== campaign || request.cancelled || !request.foreground || !request.jobId) continue;
			if (!this.jobs.has(JSON.stringify([campaign, mid, request.jobId]))) return request.jobId;
		}
		return undefined;
	}

	/**
	 * §22.4.6. Stop a background reading this pump runs so a blocking read takes its slot, and wait until the slot is
	 * back (its attempt returned with `module.read.yield`). Never a blocking reading, never one this pump does not run.
	 */
	private async displace(mid: string, campaign: string | undefined, jobId: string, running: Map<string, Promise<void>>): Promise<boolean> {
		const key = JSON.stringify([campaign, mid, jobId]), job = this.jobs.get(key), tracked = running.get(key);
		if (!job || !tracked || job.foreground === true || this.displaced.has(key)) return false;
		this.displaced.set(key, { at: Date.now(), forJob: this.blockingWaiting(mid, campaign) });
		this.controllers.get(key)?.abort();
		await tracked;
		return true;
	}

	/**
	 * §22.4.6. Return a displaced reading's attempt to the queue. A yield the kernel refuses would leave the slot held for
	 * the life of the kernel, so the attempt is then finished `cancelled` (its evidence kept, `retry: true` re-reads it).
	 */
	private async yieldSlot(job: Row, campaign: string | undefined, key: string): Promise<void> {
		const displaced = this.displaced.get(key), started = this.startedAt.get(key);
		const row = { lane: "reading", module_id: job.module_id, campaign, job_id: job.job_id, purpose: job.purpose, focus: job.focus ?? "",
			...(displaced?.forJob ? { for_job: displaced.forJob } : {}), ...(started !== undefined ? { ran_ms: Date.now() - started } : {}) };
		try {
			const result = await this.call("module.read.yield", { module_id: job.module_id, job_id: job.job_id, lease: job.lease }, campaign);
			this.note({ ...row, event: "displaced", displaced: result?.displaced });
		} catch (failure) {
			this.note({ ...row, event: "yield_failed", detail: failure instanceof Error ? failure.message : String(failure) });
			await this.call("module.read.finish", { module_id: job.module_id, job_id: job.job_id, lease: job.lease, outcome: "cancelled",
				detail: "displaced by a blocking reading; the slot could not be returned" }, campaign).catch(() => undefined);
		}
	}

	private async fulfil(mid: string, params: Row, request: PendingReading, campaign: string | undefined): Promise<Row> {
		let retry = params.retry === true;
		let answerGeneration: number | undefined;
		while (!this.stopped && !request.cancelled) {
			// `request.foreground`, never `params.foreground`: this loop polls every 300 ms, and the
			// original params would re-promote a job the last waiter has already let go (§61).
			const response = await this.bindBeforeClaim(mid, campaign, async () => {
				const response = await this.call("module.read.request", { ...params, foreground: request.foreground, module_id: mid, retry,
					...(params.purpose === 'answer' && answerGeneration !== undefined ? {context_generation: answerGeneration} : {}) }, campaign);
				if(request.providerBudget&&response.job_id&&['queued','reading'].includes(response.state)) {
					const jobKey=JSON.stringify([campaign,mid,response.job_id]),previous=this.jobBudgets.get(jobKey);
					if((previous||this.jobs.has(jobKey)||response.state==='reading')&&previous!==request.providerBudget)
						throw error('source_preparation_foreign_job','The claimed source job has another provider budget owner','Wait for the existing source owner');
					this.jobBudgets.set(jobKey,request.providerBudget);
				}
				return response;
			});
			if (params.purpose === 'answer' && answerGeneration === undefined) {
				if (!Number.isSafeInteger(response.generation) || response.generation < 0) throw error('reading_failed', 'the source consultation returned no context generation', 'retry the same source consultation explicitly');
				answerGeneration = response.generation;
			}
			if (request.foreground && response.job_id) {
				const running = this.jobs.get(JSON.stringify([campaign, mid,response.job_id]));
				if (running) { running.foreground = true; wakeReaderSlots(); }
			}
			request.jobId = response.job_id;
			request.attached = response.attached === true;
			if (Array.isArray(response.index)) request.index = response.index;
			if (request.demotePending && response.job_id) {
				request.demotePending = false;
				this.unwait(mid, response.job_id, campaign);
			}
			if (request.cancelled) {
				if (request.jobId && !request.attached) this.cancelJob(mid, request.jobId, campaign);
				break;
			}
			retry = false;
			if (response.state === "ready") return response;
			if (response.state === "blocked") {
				const choice = response.opening?.choice;
				if (choice) throw new KernelError({ code: "needs_choice", message: "the book offers more than one opening",
					fix: "choose one candidate using start_scene in prepare-module", details: choice });
				if (response.refusal?.message) throw refusedReading(params, response.refusal, response.fix ?? "retry explicitly");
				throw error("reading_failed", (response.missing ?? []).join("; ") || "the reading could not prepare this material", response.fix ?? "retry explicitly");
			}
			await Promise.race([this.pump(mid, campaign), delay(150)]);
			await delay(150);
		}
		throw error("reading_failed", request.cancelled ? "reading was cancelled" : "the reader host shut down",
			request.cancelled ? "retry explicitly when ready" : "resume in a new session");
	}

	private pump(mid: string, campaign: string | undefined): Promise<void> {
		const scope = JSON.stringify([campaign, mid]);
		const running = this.pumps.get(scope);
		if (running) { this.pumpWakes.get(scope)?.(); return running; }
		const active = new Set<Promise<void>>();
		// §22.4.6: this pump's running jobs by key, so a displaced one can be awaited until its slot is back.
		const runningJobs = new Map<string, Promise<void>>();
		let wakeRequested = false;
		const task = (async () => {
			let capacity = 1;
			try {
				while (!this.stopped) {
					wakeRequested = false;
					const wake = new Promise<void>(resolve => this.pumpWakes.set(scope, () => {wakeRequested = true; resolve();}));
					// §22.4.6: past its own capacity the pump claims only to place a blocking read one of its requests waits on.
					while ((active.size < capacity || this.blockingWaiting(mid, campaign) !== undefined) && !this.stopped) {
						const job = await this.bindBeforeClaim(mid, campaign, () => this.call("module.read.claim", { module_id: mid, owner: `host-${process.pid}` }, campaign));
						// A wake does not choose a job; the claim does. The row that names the job names the wake it answered,
						// and a wake that found nothing queued says so instead of leaving no trace (#65).
						const wake = this.wakes.get(scope);
						this.wakes.delete(scope);
						if (!job.job_id) {
							if (wake !== undefined) this.deps.record({ lane: "reading", event: "claim_empty", module_id: mid, campaign, wake });
							// §22.4.6: every slot is held and a blocking read waits; the claim names the background read that yields.
							if (typeof job.displace === "string" && await this.displace(mid, campaign, job.displace, runningJobs)) continue;
							break;
						}
						capacity = Math.max(1, Number(job.concurrency) || 1);
						const key = JSON.stringify([campaign, mid, job.job_id]);
						const controller = new AbortController();
						this.controllers.set(key, controller);
						this.jobs.set(key,job);
						this.startedAt.set(key, Date.now());
						this.heartbeats.set(key, Date.now());
						this.startSweep();
						if (this.stopped || this.cancelledJobs.has(key)) controller.abort();
						const work = (async () => {
							try {
								if (controller.signal.aborted) throw new Error("reading was cancelled");
								await this.runJob(job, controller.signal, campaign,this.jobBudgets.get(key));
							}
							catch (failure) {
								if (this.displaced.has(key)) await this.yieldSlot(job, campaign, key);
								else if (!this.handedOff.has(key)) try {
									await this.call("module.read.finish", { module_id: mid, job_id: job.job_id, lease: job.lease,
										...this.jobOutcome(key, controller.signal.aborted, String(failure)) }, campaign);
								} catch { /* a closed kernel releases its leases; retained attempts remain reclaimable */ }
							}
							finally { this.controllers.delete(key); this.jobs.delete(key); this.jobBudgets.delete(key); this.cancelledJobs.delete(key); this.heartbeats.delete(key); this.stalled.delete(key); this.handedOff.delete(key); this.displaced.delete(key); this.startedAt.delete(key); }
						})();
						const tracked = work.finally(() => { active.delete(tracked); runningJobs.delete(key); });
						active.add(tracked);
						runningJobs.set(key, tracked);
						// §22.4.6: the row names the job's class and how long it waited as that class (`class_at`, kept by the kernel).
						const since = (value: unknown) => Number.isFinite(Date.parse(String(value))) ? Math.max(0, Date.now() - Date.parse(String(value))) : undefined;
						this.deps.record({lane: "reading", event: "concurrency", module_id: mid, campaign, job_id: job.job_id, purpose: job.purpose, focus: job.focus ?? "", ...(wake !== undefined ? { wake } : {}),
							active: active.size, capacity, foreground:job.foreground === true, class: job.foreground === true ? "blocking" : "background",
							slot_wait_ms: since(job.class_at ?? job.at), queue_wait_ms: since(job.at)});
					}
					if (!active.size) { if (wakeRequested) continue; return; }
					await Promise.race([...active, wake]);
				}
			} finally { await Promise.allSettled([...active]); }
		})().finally(() => { this.pumps.delete(scope); this.pumpWakes.delete(scope); if(wakeRequested&&!this.stopped)void this.pump(mid, campaign).catch(()=>undefined); });
		task.catch(() => undefined);
		this.pumps.set(scope, task);
		return task;
	}

	private async runJob(job: Row, signal: AbortSignal, campaign?: string, providerBudget?: import("../../runtime/jev/provider-budget.ts").TaskProviderBudget) {
		const model = this.deps.model();
		const cwd = job.work_dir;
		const key = JSON.stringify([campaign, job.module_id, job.job_id]);
		// The page cache belongs to the workspace that owns this PDF, which is the shared library
		// for a library read and the campaign's private module for a campaign-scoped one. Deriving
		// it from the bound source keeps host and reader confinement in agreement by construction.
		const cache = join(dirname(job.source.path), "cache", "pages");
		await mkdir(cache, { recursive: true });
		const commands = { page: `coc-source --pdf ${quote(job.source.path)} --cache ${quote(cache)} page`,
			check: `coc-read-check --packet ${quote(join(cwd, "task.json"))} --draft ${quote(join(cwd, "draft.json"))}` };
		const task: Row = { purpose: job.purpose, ...(job.material ? { material: job.material } : {}), ...(job.purpose === "opening" ? {opening_batch:true} : {}), module_id: job.module_id, focus: job.focus, question: job.question, pages: job.pages,
			...(job.purpose === "guidance" ? {play_language:job.play_language, occupations:job.occupations.map((row:Row)=>({name:row.name}))} : {}),
			source: { page_count: job.source.page_count }, index: job.index, known_nodes: job.known_nodes, field_spans: job.field_spans ?? {},
			known_claims: (job.known_claims ?? []).map((claim: Row) => Object.fromEntries(
				["subject_id", "predicate", "object", "truth_status", "visibility", "reason", "known_by_ids", "asserted_by_ids", "validity"]
					.filter(key => key in claim).map(key => [key, claim[key]]))),
			vocabulary: job.vocabulary, coverage_domains: job.coverage_domains, commands };
		if (job.purpose === "index") { delete task.index; delete task.known_nodes; delete task.known_claims; delete task.field_spans; delete task.vocabulary; delete task.coverage_domains; delete task.commands.check; }
		const freshSkeleton = !campaign && job.purpose === 'skeleton' && Array.isArray(job.known_nodes)
			&& job.known_nodes.length === 1 && job.known_nodes[0].node_kind === 'module' && job.known_nodes[0].ready === false;
		if (freshSkeleton && this.deps.navigateFresh) {
			try {
				const navigation = await this.deps.navigateFresh({moduleId: job.module_id, jobId: job.job_id,
					source: job.source}, signal, row => this.deps.record(row));
				if (navigation) task.navigation_hints = {version: navigation.version, navigation_only: true,
					hints: navigation.hints, coverage: navigation.coverage};
			} catch {
				this.deps.record({lane: 'reading', event: 'typed_navigation', module_id: job.module_id, job_id: job.job_id, status: 'unavailable'});
			}
		}
		if (job.purpose === "guidance") {
			const { labels, bookmarks } = await this.runtime().sourceInfo({ pdf: job.source.path, cache }, signal);
			task.source = { ...task.source, labels, bookmarks };
		}
		await writeFile(join(cwd, "task.json"), JSON.stringify(task, null, 2) + "\n");
		const observations: Row = { file_sha256: job.source.file_sha256, read_pages: [], full_pages: [], review_pages: [] };
		let readComplete = false;
		if (job.resume_from) {
			try {
				const previous = JSON.parse(await readFile(join(job.resume_from, "packet.json"), "utf8"));
				if (previous.key === job.key && previous.source.file_sha256 === job.source.file_sha256) {
					await copyFile(join(job.resume_from, "draft.json"), join(cwd, "draft.json"));
					if (job.purpose === "guidance") await copyFile(join(job.resume_from, "guidance.json"), join(cwd, "guidance.json"));
					await copyFile(join(job.resume_from, "findings.json"), join(cwd, "findings.json")).catch(() => undefined);
					const checkpoint = JSON.parse(await readFile(join(job.resume_from, "read-complete.json"), "utf8"));
					if (validCheckpoint(checkpoint, await readFile(join(cwd, "draft.json")), job)) {
						if (job.purpose === "guidance" && checkpoint.guidance_sha256 !== sha(await readFile(join(cwd,"guidance.json")))) throw new Error("guidance checkpoint mismatch");
						Object.assign(observations, checkpoint.observations, { review_pages: [] });
						await writeFile(join(cwd, "read-complete.json"), JSON.stringify(checkpoint) + "\n");
						// Only this job's own interrupted attempt may skip reading. A retry that inherits a
						// failed job's draft owes the source-based repair round (§22): re-verifying identical
						// bytes under identical instructions cannot re-scope them, so it can only fail again.
						readComplete = !checkpoint.requires_repair && checkpoint.job_id === job.job_id;
					}
				}
				else if (job.repair && previous.purpose === job.purpose && previous.source.file_sha256 === job.source.file_sha256) {
					// A repair extends the completed reading it repairs (§90.5): that draft is the starting point,
					// and the whole read runs again on top of it, so nothing here marks the read complete.
					await copyFile(join(job.resume_from, "draft.json"), join(cwd, "draft.json"));
				}
			} catch { /* a partial draft remains useful input, but only a host checkpoint skips reading */ }
		}
		let requiredMapCandidates: Row[] = [];
		if (job.purpose === "index") {
			try {
				const retained = JSON.parse(await readFile(join(cwd, "draft.json"), "utf8"));
				requiredMapCandidates = Array.isArray(retained.map_candidates) ? retained.map_candidates : [];
			} catch { /* a fresh index has no retained candidates */ }
		}
		await writeFile(join(cwd, "observations.json"), JSON.stringify(observations) + "\n");
		// §20 addendum 3 (SL-41): a read raised during play has no stage lease; it is sized from the book like the import's
		// stages, once per job, and every reader child of the job opens a lease of that size (runtime/tasks.ts).
		const stage = providerBudget ? undefined : playReadStage(job);
		const readingLease: StageBudget | undefined = stage ? readingStageBudget(stage, { pageCount: Number(job.source?.page_count) || 0,
			perPage: await measuredPageCost(resolve(cwd, "..", "..", "..")) }) ?? undefined : undefined;
		if (readingLease) this.deps.record({ lane: "reading", event: "stage_budget", module_id: job.module_id, campaign, job_id: job.job_id, purpose: job.purpose, ...readingLease });
		// §20 addendum 3: a call a stage lease refused on an overrun it could pay; the round went on.
		const overrunRows = (run: ReaderOutcome, phase: string, round: number, extra: Row = {}) => {
			for (const overrun of run.overruns ?? []) this.deps.record({ lane: "reading", event: "provider_overrun", module_id: job.module_id, campaign,
				job_id: job.job_id, purpose: job.purpose, focus: job.focus ?? "", phase, round, ...extra, ...overrun });
			return run;
		};
		let detail = "the reader did not produce a valid draft";
		// §22.3.1: the refused field and the gate's reason, as findings.json records them, travel with the failure.
		let refusal: Row | undefined;
		try {
			if (!model.vision) throw error("vision_required", "the reader has no image input", "select a model that supports images");
			// Reader/check/review failures keep the existing two rounds. One opening semantic rejection
			// from publication can add only its own source-grounded repair round.
			let lastRound = 2, finishRepairUsed = false;
			for (let round = 1; round <= lastRound && !signal.aborted; round++) {
				let phaseCompleted = false;
				let publishing = false;
				try {
					const phases: Array<"index" | "index-audit" | "read" | "verify"> = job.purpose === "index" ? (readComplete ? [] : ["index", "index-audit"]) : (readComplete ? ["verify"] : ["read", "verify"]);
					for (const phase of phases) {
						phaseCompleted = false;
						let previousDraft: Row | undefined, previousPages: number[] = [];
						if (phase === "read") {
							try {
								const bytes = await readFile(join(cwd, "draft.json"));
								const checkpoint = JSON.parse(await readFile(join(cwd, "read-complete.json"), "utf8"));
								if (validCheckpoint(checkpoint, bytes, job)) { previousDraft = JSON.parse(bytes.toString()); previousPages = checkpoint.observations.read_pages; }
							} catch { /* no completed source reading to carry */ }
							await writeFile(join(cwd, "baseline.json"), JSON.stringify(previousDraft ?? {}) + "\n");
							try {
								const retained = JSON.parse(await readFile(join(cwd, "draft.json"), "utf8"));
								task.must_view_pages = previousDraft ? [] : draftPages(retained);
								task.repair = { draft: "draft.json", baseline: "baseline.json", findings: JSON.parse(await readFile(join(cwd, "findings.json"), "utf8").catch(() => "{}")) };
								await writeFile(join(cwd, "task.json"), JSON.stringify(task, null, 2) + "\n");
							} catch { /* the first draft has not been written */ }
						}
						if (phase === "index-audit") {
							const draft = JSON.parse(await readFile(join(cwd, "draft.json"), "utf8"));
							const currentCandidates = Array.isArray(draft.map_candidates) ? draft.map_candidates : [];
							const currentRefs = (Array.isArray(draft.sections) ? draft.sections : []).flatMap((section: Row) =>
								(Array.isArray(section.source_refs) ? section.source_refs : []).map((ref: Row) => ref.page));
							task.required_map_candidates = requiredMapCandidates;
							task.index_audit_pages = [...new Set([
								...integerList(observations.index_candidate_pages),
								...requiredMapCandidates.flatMap(candidate => integerList(candidate.pages)),
								...currentCandidates.flatMap((candidate: Row) => integerList(candidate.pages)),
								...integerList(currentRefs),
							].filter(page => page > 0))].sort((a, b) => a - b);
							await writeFile(join(cwd, "task.json"), JSON.stringify(task, null, 2) + "\n");
						}
						const promptPhase = phase === "index-audit" ? "index" : phase;
						const instructions = join(cwd, `instructions-${promptPhase}.md`);
						this.deps.progress({ module_id: job.module_id, campaign, job_id: job.job_id, stage: phase === "read" && job.purpose === "skeleton" ? "skeleton" : phase, focus: job.focus, of: job.source.page_count });
						if (phase === "verify") {
							if (["opening", "detail", "answer"].includes(job.purpose)) {
								try {
									const checked = await this.runtime().check({kind:'source-draft',packet:join(cwd,'task.json'),draft:join(cwd,'draft.json')},signal);
									if (!checked.ok) throw new Error(JSON.stringify(checked.error));
									if (job.purpose === 'answer' && (!Array.isArray(checked.required_view_pages) || checked.required_view_pages.some((page: number) => !observations.read_pages.includes(page))))
										throw new Error('Source answer requires original-page observations before independent review');
								}
								catch (error) { phaseCompleted = true; throw error; }
							}
							observations.review_pages = await reviewCandidate({ cwd, task: {...task, review_scope_pages: observations.read_pages},
								draft: JSON.parse(await readFile(join(cwd, "draft.json"), "utf8")), instructions, round,
								model, source: { pdf: job.source.path, cache, file_sha256:job.source.file_sha256 }, signal,
								cacheRoot:join(cache,'..','reviews'),
								reviewVersion:sha(Buffer.concat([Buffer.from(sourceRenderVersion),await readFile(join(this.runtime().contentRoot,'setup',job.purpose === 'answer' ? 'source-answer.md' : job.purpose === 'guidance' ? 'visual-guidance.md' : 'visual-reader.md'))])),
								run: ({systemPrompt: _instructions, ...request}) => this.runtime().runTask({ kind: "reader", request: { ...request, providerBudget,
									...(readingLease ? { readingLease } : {}),
									priority: () => job.foreground === false ? "background" : "foreground",
									prompt: { phase: "verify", guidance: job.purpose === "guidance", answer: job.purpose === "answer" } } }, request.signal)
									.then(run => overrunRows(run, "verify", round)),
								// Every verify row names the job and round it belongs to (#65); the reviewer adds unit and attempt.
								record: row => this.deps.record({ module_id: job.module_id, job_id: job.job_id, purpose: job.purpose, focus: job.focus ?? "", round, ...row, campaign }),
								progress: row => this.deps.progress({ module_id: job.module_id, job_id: job.job_id, ...row, campaign }) });
							await writeFile(join(cwd, "observations.json"), JSON.stringify(observations) + "\n");
							phaseCompleted = true;
							continue;
						}
						const imagePaths = new Set<string>();
						const imageCalls = new Map<string, string[]>();
						const sourcePages = new Set<number>();

						const reads = new Map<string, string>();
						const run = await this.runtime().runTask({ kind: "reader", request: { providerBudget, ...(readingLease ? { readingLease } : {}), cwd, model: model.id, thinking: model.thinking,
							...(["guidance", "answer"].includes(job.purpose) ? {imageHistory:4} : {}),
							submission:["guidance","opening","detail","answer"].includes(job.purpose),
							priority: () => job.foreground === false ? "background" : "foreground",
							prompt: { phase: promptPhase, guidance: job.purpose === "guidance", answer: job.purpose === "answer" }, source: { pdf: job.source.path, cache },
							eventLog: join(cwd, `${phase}-${round}.jsonl`),
							brief: phase === "index-audit"
								? `${readerInput({task})} This is the independent map-page completeness audit of the retained PDF index. Read draft.json${round > 1 || job.resume_from ? " and findings.json" : ""}. View every physical page in task.index_audit_pages with pdf, compare each page to draft.map_candidates, and immediately add every authored map whose depicted place can be identified. Every task.required_map_candidates row must remain. Preserve existing sections and candidates; repair missing section source_refs but do not cite any page unless you viewed that full page in this audit or it is in task.index_audit_pages. If another page is needed as a reference, view it first. Do not rewrite for style. Finish only after every assigned page has been checked, then stop.`
								: `${readerInput({task})} Your phase is ${phase}. ${job.repair === "way_on" ? WAY_ON_ASK + " " : ""}Use page images to produce draft.json. If a draft was retained from this same interrupted request, inspect its sources and repair it instead of rewriting merely for style. ${["guidance","opening","detail","answer"].includes(job.purpose) ? "Use submit_reading as your sole final tool call to save/check this batch and finish without a closing reply." : ""} ${round > 1 || job.resume_from ? "Read findings.json if present and address its concrete findings." : ""}`,
							onEvent(event) {
								if (event.type === "tool_execution_start" && event.toolName === "read" && event.args?.path) reads.set(event.toolCallId, resolve(cwd, event.args.path));
								if (event.type === "tool_execution_end" && !event.isError && event.result?.content?.some((c: Row) => c.type === "image")) {
									const path = reads.get(event.toolCallId); if (path) imageCalls.set(event.toolCallId, [path]);
									if (event.result?.details?.kind === "source_pages") {
										const viewed = event.result.details.observations;
										imageCalls.set(event.toolCallId, viewed.map((row: Row) => row.path));
										for (const row of viewed) if (Number.isInteger(row.page) && (!row.box || JSON.stringify(row.box) === "[0,0,1,1]")) sourcePages.add(row.page);
									}
								}
							},
						} }, signal);
						if (imageCalls.size) {
							const visibility = (await readFile(join(cwd, `${phase}-${round}.jsonl.images.jsonl`), "utf8")).trim().split("\n").filter(Boolean).flatMap(line => JSON.parse(line).included ?? []);
							for (const id of visibility) for (const path of imageCalls.get(id) ?? []) imagePaths.add(path);
						}
						// The pages this run consumed are read before the row is written, so the row can carry them (#65):
						// the physical page numbers (1-based) behind the images the reader kept, the same set `read_pages` is built from.
						// A page log that cannot be read still fails the job as before, after the row has landed.
						let rows: Row[] = [], pageLogFailure: unknown;
						if (run.ok) {
							try {
								const lines = (await readFile(join(cache, "requests.jsonl"), "utf8")).trim().split("\n");
								rows = lines.map(line => JSON.parse(line)).filter(row => row.file_sha256 === job.source.file_sha256 && imagePaths.has(row.path));
							} catch (failure) { pageLogFailure = failure; }
						}
						const pagesRead = [...new Set(rows.map(row => row.page))];
						this.deps.record({ lane: "reading", module_id: job.module_id, campaign, job_id: job.job_id, purpose: job.purpose, focus: job.focus ?? "",
							model: model.id, thinking: model.thinking, phase, round, ms: run.ms, ok: run.ok, image_reads: imagePaths.size,
							...(run.ok && !pageLogFailure ? { pages: pagesRead } : {}), ...(run.usage ? { usage: run.usage } : {}), ...(run.overruns?.length ? { overruns: run.overruns.length } : {}),
							...(run.refusal ? { refusal: run.refusal.reason } : run.providerError ? { refusal: "transport" } : {}) });
						overrunRows(run, phase, round);
						// §20 addendum 2: the reader's cost per page of this book, measured, for the next stage's lease.
						if (run.usage) await appendFile(join(cwd, "usage.jsonl"), JSON.stringify({ job_id: job.job_id, phase, round, ok: run.ok && !pageLogFailure,
							pages: run.ok && !pageLogFailure ? pagesRead.length : 0, usage: run.usage }) + "\n").catch(() => undefined);
						if (!run.ok && (run.refusal || run.providerError)) {
							const failure = providerFailure(run, !!providerBudget);
							this.deps.record({ lane: "reading", event: "provider_refused", module_id: job.module_id, campaign, job_id: job.job_id, purpose: job.purpose,
								focus: job.focus ?? "", phase, round, ...(run.refusal ?? { reason: "transport", provider_error: run.providerError }) });
							// A refusal from a lease this job shares across its rounds refuses the next round too: fail now.
							if (failure.final) lastRound = round;
							throw failure.error;
						}
						if (!run.ok) throw new Error(run.error || (run.timedOut ? "reader timed out" : run.stderr || "reader failed"));
						if (pageLogFailure) throw pageLogFailure;
						if (phase === "index-audit") {
							const missing = integerList(task.index_audit_pages).filter(page => !sourcePages.has(page));
							if (missing.length) throw new Error(`index map audit did not inspect physical pages ${missing.join(", ")}`);
							const draft = JSON.parse(await readFile(join(cwd, "draft.json"), "utf8"));
							const finalCandidates: Row[] = Array.isArray(draft.map_candidates) ? draft.map_candidates : [];
							const finalKeys = new Set(finalCandidates.map(mapCandidateKey));
							const removed = requiredMapCandidates.filter(candidate => !finalKeys.has(mapCandidateKey(candidate)));
							if (removed.length) throw new Error(`index map audit removed retained candidates: ${removed.map(candidate => candidate.name ?? candidate.focus ?? "unnamed").join(", ")}`);
							const observed = new Set([...integerList(observations.full_pages), ...sourcePages]);
							const cited = [...(Array.isArray(draft.sections) ? draft.sections : []).flatMap((section: Row) =>
								(Array.isArray(section.source_refs) ? section.source_refs : []).map((ref: Row) => ref.page)),
								...finalCandidates.flatMap(candidate => integerList(candidate.pages))]
								.filter((page): page is number => Number.isInteger(page));
							const unviewed = [...new Set(cited.filter(page => !observed.has(page)))].sort((a, b) => a - b);
							if (unviewed.length) throw new Error(`index navigation references require viewing physical pages ${unviewed.join(", ")}`);
						}
						const key = "read_pages";
						observations[key] = phase === "index-audit" ? [...new Set([...integerList(observations[key]), ...pagesRead])].sort((a, b) => a - b) : pagesRead;
						if (previousDraft) {
							const changed = editedSourcePages(previousDraft, JSON.parse(await readFile(join(cwd, "draft.json"), "utf8")));
							const absent = [...changed].filter(page => !observations.read_pages.includes(page));
							if (absent.length) throw new Error(`changed source records require viewing physical pages ${absent.join(", ")}`);
							observations.read_pages = [...new Set([...previousPages, ...observations.read_pages])];
						}
						if (phase === "index") {
							observations.index_candidate_pages = [...new Set([...integerList(observations.index_candidate_pages), ...sourcePages])].sort((a, b) => a - b);
							observations.full_pages = [...new Set(rows.filter(row => JSON.stringify(row.box) === "[0,0,1,1]").map(row => row.page))];
						}
						if (phase === "index-audit") observations.full_pages = [...new Set([...integerList(observations.full_pages), ...sourcePages])].sort((a, b) => a - b);
						await writeFile(join(cwd, "observations.json"), JSON.stringify(observations) + "\n");
						if (phase === "read" || phase === "index-audit") {
							readComplete = true;
							await writeFile(join(cwd, "read-complete.json"), JSON.stringify({ job_id: job.job_id, draft_sha256: sha(await readFile(join(cwd, "draft.json"))),
								...(phase === "index-audit" ? { index_map_audited: true } : {}),
								...(job.purpose === "guidance" ? {guidance_sha256:sha(await readFile(join(cwd,"guidance.json")))} : {}), observations }) + "\n");
						}
						phaseCompleted = true;
					}
					const assets = [];
					if (job.purpose !== "index" && job.purpose !== "answer") {
						const draft = JSON.parse(await readFile(join(cwd, "draft.json"), "utf8"));
						validateMapRegions(draft);
						for (const node of publishableAssetNodes(draft, job.purpose)) {
							if (typeof node.node_id !== "string" || !/^[a-z][a-z0-9-]{0,159}$/.test(node.node_id)) throw new Error("asset identifiers must be semantic kebab names");
							const mapRedactions = (draft.nodes ?? []).flatMap((map: Row) => (map.properties?.map_regions ?? [])
								.filter((region: Row) => typeof region.source_asset === "string" && [node.node_id, node.node_id.replace(/^asset-/, "")].includes(region.source_asset))
								.flatMap((region: Row) => Array.isArray(region.redactions) ? region.redactions : []));
							const imageSources = (node.properties.image_sources ?? []).map((region: Row) => ({ ...region,
								...(mapRedactions.length ? { redactions: mapRedactions } : {}) }));
							const asset = await sourceAsset(job.source.path, cache, imageSources, join(cwd, "assets", `${node.node_id}.png`));
							assets.push({ node_id: node.node_id, ...asset });
						}
					}
					publishing = true;
					await this.call("module.read.finish", { module_id: job.module_id, job_id: job.job_id, lease: job.lease,
						outcome: "completed", draft_path: join(cwd, "draft.json"), review_path: join(cwd, "review.json"), assets }, campaign);
					publishing = false;
					// The book turns its own pages next (spec thin-book-play B); never on the critical path, never a failure.
					if (job.purpose === "index" || job.purpose === "opening") await this.call("module.read.ahead", { module_id: job.module_id, ...(job.purpose === "opening" && job.focus ? { focus: job.focus } : {}) }, campaign).catch(() => undefined);
					return;
				} catch (failure) {
					if (isKernelError(failure) && failure.details?.reason === 'source_context_changed') throw failure;
					// Provider/transport failure during verification preserves the completed read.
					// A completed but rejected semantic review requires a source-grounded repair.
					// §22.4.3: a review the gate found malformed is the reviewer's slip; the read stands, the next round only re-reviews.
					const reviewSlip = isKernelError(failure) && failure.details?.reason === "answer_review_malformed";
					if (phaseCompleted && !reviewSlip) {
						readComplete = false;
						try {
							const checkpointPath = join(cwd, "read-complete.json");
							const checkpoint = JSON.parse(await readFile(checkpointPath, "utf8"));
							await writeFile(checkpointPath, JSON.stringify({ ...checkpoint, requires_repair: true }) + "\n");
						} catch { /* no completed read to invalidate */ }
					}
					detail = isKernelError(failure) ? failure.toToolText() : String(failure);
					refusal = isKernelError(failure) ? { message: failure.message,
						...Object.fromEntries(["path", "rule", "reason"].filter(key => typeof failure.details?.[key] === "string").map(key => [key, failure.details![key]])) } : undefined;
					if (publishing && finishSemanticRejection(failure) && !finishRepairUsed) {
						finishRepairUsed = true;
						lastRound = Math.max(lastRound, round + 1);
					}
					let review: Row | undefined;
					try { review = JSON.parse(await readFile(join(cwd, "review.json"), "utf8")); } catch { /* no review yet */ }
					const unsupported: Row[] = review ? (review.checked ?? []).filter((row: Row) => row.verdict !== "supported") : [];
					let repairs: string[] = [];
					if (unsupported.length) {
						try { repairs = unsupportedNumberRepairs(JSON.parse(await readFile(join(cwd, "draft.json"), "utf8")), unsupported); }
						catch { /* an unreadable draft still leaves the reviewer's own rows */ }
					}
					await writeFile(join(cwd, "findings.json"), JSON.stringify({ error: detail,
						...(isKernelError(failure) ? { details: failure.details } : {}),
						...(review ? { missing: review.missing, unsupported } : {}),
						...(repairs.length ? { repairs } : {}) }) + "\n");
				}
			}
		} finally {
			// Contract §20 addendum 2: a reading handed off at the owner's exit is not finished here. It stays
			// `running` with no lock holder, and the next owner's claim re-queues it with this attempt retained.
			if (this.handedOff.has(key)) {
				this.note({ lane: "reading", event: "handed_off", module_id: job.module_id, campaign, job_id: job.job_id, purpose: job.purpose, focus: job.focus ?? "" });
				return;
			}
			// §22.4.6: a displaced reading gives its slot back and keeps its attempt; it is not finished.
			if (this.displaced.has(key)) { await this.yieldSlot(job, campaign, key); return; }
			// Completed jobs replay here; failed attempts release their claim and preserve all artifacts.
			const outcome = this.jobOutcome(key, signal.aborted, detail);
			await this.call("module.read.finish", { module_id: job.module_id, job_id: job.job_id, lease: job.lease,
				...outcome, ...(outcome.outcome === "failed" && refusal ? { refusal } : {}) }, campaign).catch(() => undefined);
		}
	}
}
