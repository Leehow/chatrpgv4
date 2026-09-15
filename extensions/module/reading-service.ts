/** A single host service for PDF preparation and foreground/background reading. */
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, join, resolve } from "node:path";
import { KernelError , isKernelError } from "../kernel/client.ts";
import { readerInput, wakeReaderSlots } from "./reader.ts";
import { reviewCandidate } from "./reader-review.ts";
import { sourceAsset, closeSourceDocuments, sourceRenderVersion } from "./source.ts";
import { publishableAssetNodes, validateMapRegions } from "./map-publication.ts";
import type { HostRuntime } from "../../runtime/host.ts";

type Row = Record<string, any>;
type Call = (method: string, params: Row) => Promise<any>;
export interface ReadingBridge {
	prepare(params: Row, signal?: AbortSignal): Promise<Row>;
	ensure(moduleId: string, params: Row, signal?: AbortSignal): Promise<Row>;
}
interface Dependencies {
	call: Call;
	campaign?(): string | undefined;
	home: string;
	runtime?: HostRuntime;
	model(): { id: string; vision: boolean; thinking?: string };
	progress(row: Row): void;
	record(row: Row): void;
}
interface PendingReading {
	waiters: number;
	cancelled: boolean;
	jobId?: string;
}
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
function canonical(value: any): string {
	if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
	if (value && typeof value === "object") return "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
	return JSON.stringify(value);
}
function editedSourcePages(before: Row, after: Row): Set<number> {
	const result = new Set<number>();
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
		? observed.full_pages?.length > 0
		: draftPages(JSON.parse(bytes.toString())).every(page => observed.read_pages?.includes(page));
}
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const error = (reason: string, message: string, fix: string, extra: Row = {}) =>
	new KernelError({ code: "needs", message, fix, details: { reason, ...extra } });
function openingFinishSemanticRejection(failure: unknown, job: Row): boolean {
	return job.purpose === "opening" && isKernelError(failure) && failure.code === "invalid_params";
}

export class ReadingService implements ReadingBridge {
	private stopped = false;
	private requests = new Map<string, PendingReading & { task: Promise<Row> }>();
	private pumps = new Map<string, Promise<void>>();
	private pumpWakes = new Map<string, () => void>();
	private controllers = new Map<string, AbortController>();
	private jobs = new Map<string, Row>();
	private cancelledJobs = new Set<string>();
	/** Per scoped module, the reason of the most recent wake no claim has answered yet: the claim row names it (contract §22, #65). */
	private wakes = new Map<string, string>();
	private readonly deps: Dependencies;
	constructor(deps: Dependencies) { this.deps = deps; }
	private campaign(params: Row): string | undefined {
		// null explicitly selects the library, even when this service is bound to a campaign.
		return params.campaign === null ? undefined : params.campaign ?? this.deps.campaign?.();
	}
	private call(method: string, params: Row, campaign: string | undefined): Promise<any> {
		const { campaign: _scope, ...rest } = params;
		return this.deps.call(method, { ...rest, ...(campaign !== undefined ? { campaign } : {}) });
	}
	private runtime(): HostRuntime {
		if (!this.deps.runtime) throw new Error("Source reading requires its owner's runtime");
		return this.deps.runtime;
	}

	dispose() {
		this.stopped = true;
		for (const controller of this.controllers.values()) controller.abort();
	}

	async close() { this.dispose(); try { await Promise.allSettled([...this.pumps.values()]); } finally { await closeSourceDocuments(); } }

	prefetch(moduleId: string, reason = 'requested'): Promise<void> {
		if (this.stopped) return Promise.resolve();
		const campaign = this.deps.campaign?.();
		this.deps.record({lane:'reading',event:'prefetch_wake',module_id:moduleId,campaign,reason});
		this.wakes.set(JSON.stringify([campaign, moduleId]), reason);
		return this.pump(moduleId, campaign);
	}

	async prepare(params: Row, signal?: AbortSignal): Promise<Row> {
		const campaign = this.campaign(params);
		let mid = params.module_id;
		if (params.pdf) {
			const model = this.deps.model();
			if (!model.vision) throw error("vision_required", "the configured reader cannot receive images", "select a reader model with image input");
			const path = resolve(this.deps.home, params.pdf);
			this.deps.progress({ stage: "source" });
			let source: Awaited<ReturnType<HostRuntime["sourceInfo"]>>;
			try { source = await this.runtime().sourceInfo({ pdf: path, cache: this.deps.home }, signal); }
			catch (failure) {
				if (isKernelError(failure)) throw failure;
				throw error("bad_pdf", `the original PDF could not be opened: ${failure instanceof Error ? failure.message : String(failure)}`,
					"choose an accessible, readable original PDF");
			}
			const bound = await this.deps.call("module.source.bind", { source,
				...(mid ? { module_id: mid } : {}), ...(campaign !== undefined ? { campaign } : {}), title: basename(path, ".pdf") });
			mid = bound.module_id;
        }
		if (!mid) throw error("needs_source", "choose a PDF or an existing module", "pass pdf or module_id");
		if (params.purpose === "guidance") {
			const result = await this.ensure(mid, {...params, campaign:null, focus: params.start_scene || "", foreground:true}, signal);
			return {...result, module_id:mid};
		}
		if (params.start_scene && params.targeted === true) {
			await this.ensure(mid, {purpose:"opening", campaign:campaign ?? null, focus:params.start_scene, foreground:true, retry:params.retry===true}, signal);
			return {ok:true, module_id:mid, opening_ready:true};
		}
		await this.ensure(mid, { purpose: "skeleton", campaign: null, foreground: true, retry: params.retry === true }, signal);
		const status = await this.deps.call("module.status", { module_id: mid });
		if (!params.start_scene && status.opening_candidates?.length > 1) {
			throw new KernelError({ code: "needs_choice", message: "choose the opening for this new campaign",
				fix: "match the player's intent to the candidate summaries, then pass its scene as start_scene in prepare-module",
				details: { field: "start_scene", candidates: status.opening_candidates } });
		}
		await this.ensure(mid, { purpose: "opening", campaign: null, focus: params.start_scene ?? "", foreground: true, retry: params.retry === true }, signal);
		return { ok: true, module_id: mid, opening_ready: true };
	}

	async ensure(mid: string, params: Row, signal?: AbortSignal): Promise<Row> {
		if (signal?.aborted || this.stopped) throw error("reading_failed", "reading was cancelled", "retry the reading when ready");
		const campaign = this.campaign(params);
		const key = JSON.stringify([campaign, mid, params.purpose, params.material ?? "", params.focus ?? "", params.question ?? "", params.guidance_key ?? ""]);
		let request = this.requests.get(key);
		if (!request) {
			const pending: PendingReading = { waiters: 0, cancelled: false };
			const task = this.fulfil(mid, params, pending, campaign).finally(() => this.requests.delete(key));
			task.catch(() => undefined);
			request = Object.assign(pending, { task });
			this.requests.set(key, request);
		}
		request.waiters++;
		let waiting = true;
		const releaseWaiter = () => { if (waiting) { waiting = false; request.waiters--; } };
		let timer: ReturnType<typeof setTimeout> | undefined;
		let onAbort: (() => void) | undefined;
		try {
			const configured = Number(process.env.PI_COC_READ_WAIT_MS);
			const wait = Number.isFinite(configured) && configured > 0 ? configured : 120_000;
			const interrupted = new Promise<never>((_resolve, reject) => {
				timer = setTimeout(() => reject(error("reading_timeout", "the source is still being read",
					params.purpose === "opening" ? "return control, then call prepare-module again to rejoin the retained preparation"
						: "use ask to return control; on a later player turn, retry the original action or lookup kind=source with the exact focus and question in details.read; do not invent another question",
					// The job handle travels beside `read` for telemetry (#65); the fix names only `read`, so the model does not see it.
					{ read: { purpose: params.purpose, ...(params.material ? { material: params.material } : {}), focus: params.focus ?? "", question: params.question ?? "" },
						...(request.jobId ? { job_id: request.jobId } : {}) })), wait);
				onAbort = () => {
					releaseWaiter();
					if (request.waiters === 0) {
						request.cancelled = true;
						if (request.jobId) this.cancelJob(mid, request.jobId, campaign);
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

	private cancelJob(mid: string, jobId: string, campaign: string | undefined) {
		const key = JSON.stringify([campaign, mid, jobId]);
		this.cancelledJobs.add(key);
		this.controllers.get(key)?.abort();
		void this.pump(mid, campaign);
	}

	private async fulfil(mid: string, params: Row, request: PendingReading, campaign: string | undefined): Promise<Row> {
		let retry = params.retry === true;
		while (!this.stopped && !request.cancelled) {
			const response = await this.call("module.read.request", { ...params, module_id: mid, retry }, campaign);
			if (params.foreground && response.job_id) {
				const running = this.jobs.get(JSON.stringify([campaign, mid,response.job_id]));
				if (running) { running.foreground = true; wakeReaderSlots(); }
			}
			request.jobId = response.job_id;
			if (request.cancelled) {
				if (request.jobId) this.cancelJob(mid, request.jobId, campaign);
				break;
			}
			retry = false;
			if (response.state === "ready") return response;
			if (response.state === "blocked") {
				const choice = response.opening?.choice;
				if (choice) throw new KernelError({ code: "needs_choice", message: "the book offers more than one opening",
					fix: "choose one candidate using start_scene in prepare-module", details: choice });
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
		let wakeRequested = false;
		const task = (async () => {
			let capacity = 1;
			try {
				while (!this.stopped) {
					wakeRequested = false;
					const wake = new Promise<void>(resolve => this.pumpWakes.set(scope, () => {wakeRequested = true; resolve();}));
					while (active.size < capacity && !this.stopped) {
						const job = await this.call("module.read.claim", { module_id: mid, owner: `host-${process.pid}` }, campaign);
						// A wake does not choose a job; the claim does. The row that names the job names the wake it answered,
						// and a wake that found nothing queued says so instead of leaving no trace (#65).
						const wake = this.wakes.get(scope);
						this.wakes.delete(scope);
						if (!job.job_id) {
							if (wake !== undefined) this.deps.record({ lane: "reading", event: "claim_empty", module_id: mid, campaign, wake });
							break;
						}
						capacity = Math.max(1, Number(job.concurrency) || 1);
						const key = JSON.stringify([campaign, mid, job.job_id]);
						const controller = new AbortController();
						this.controllers.set(key, controller);
						this.jobs.set(key,job);
						if (this.stopped || this.cancelledJobs.has(key)) controller.abort();
						const work = (async () => {
							try {
								if (controller.signal.aborted) throw new Error("reading was cancelled");
								await this.runJob(job, controller.signal, campaign);
							}
							catch (failure) {
								try {
									await this.call("module.read.finish", { module_id: mid, job_id: job.job_id, lease: job.lease,
										outcome: controller.signal.aborted ? "cancelled" : "failed", detail: String(failure) }, campaign);
								} catch { /* a closed kernel releases its leases; retained attempts remain reclaimable */ }
							}
							finally { this.controllers.delete(key); this.jobs.delete(key); this.cancelledJobs.delete(key); }
						})();
						const tracked = work.finally(() => active.delete(tracked));
						active.add(tracked);
						this.deps.record({lane: "reading", event: "concurrency", module_id: mid, campaign, job_id: job.job_id, purpose: job.purpose, focus: job.focus ?? "", ...(wake !== undefined ? { wake } : {}),
							active: active.size, capacity, foreground:job.foreground === true, queue_wait_ms: Number.isFinite(Date.parse(job.at)) ? Math.max(0,Date.now()-Date.parse(job.at)) : undefined});
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

	private async runJob(job: Row, signal: AbortSignal, campaign?: string) {
		const model = this.deps.model();
		const cwd = job.work_dir;
		const cache = join(this.deps.home, ".coc", "modules", job.module_id, "cache", "pages");
		await mkdir(cache, { recursive: true });
		const commands = { page: `coc-source --pdf ${quote(job.source.path)} --cache ${quote(cache)} page`,
			check: `coc-read-check --packet ${quote(join(cwd, "task.json"))} --draft ${quote(join(cwd, "draft.json"))}` };
		const task: Row = { purpose: job.purpose, ...(job.material ? { material: job.material } : {}), ...(job.purpose === "opening" ? {opening_batch:true} : {}), module_id: job.module_id, focus: job.focus, question: job.question, pages: job.pages,
			...(job.purpose === "guidance" ? {play_language:job.play_language, occupations:job.occupations.map((row:Row)=>({name:row.name}))} : {}),
			source: { page_count: job.source.page_count }, index: job.index, known_nodes: job.known_nodes,
			known_claims: (job.known_claims ?? []).map((claim: Row) => Object.fromEntries(
				["subject_id", "predicate", "object", "truth_status", "visibility", "reason", "known_by_ids", "asserted_by_ids", "validity"]
					.filter(key => key in claim).map(key => [key, claim[key]]))),
			vocabulary: job.vocabulary, coverage_domains: job.coverage_domains, commands };
		if (job.purpose === "index") { delete task.index; delete task.known_nodes; delete task.known_claims; delete task.vocabulary; delete task.coverage_domains; delete task.commands.check; }
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
			} catch { /* a partial draft remains useful input, but only a host checkpoint skips reading */ }
		}
		await writeFile(join(cwd, "observations.json"), JSON.stringify(observations) + "\n");
		let detail = "the reader did not produce a valid draft";
		try {
			if (!model.vision) throw error("vision_required", "the reader has no image input", "select a model that supports images");
			// Reader/check/review failures keep the existing two rounds. One opening semantic rejection
			// from publication can add only its own source-grounded repair round.
			let lastRound = 2, finishRepairUsed = false;
			for (let round = 1; round <= lastRound && !signal.aborted; round++) {
				let phaseCompleted = false;
				let publishing = false;
				try {
					const phases: Array<"index" | "read" | "verify"> = job.purpose === "index" ? (readComplete ? [] : ["index"]) : (readComplete ? ["verify"] : ["read", "verify"]);
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
						const instructions = join(cwd, `instructions-${phase}.md`);
						this.deps.progress({ module_id: job.module_id, campaign, stage: phase === "read" && job.purpose === "skeleton" ? "skeleton" : phase, focus: job.focus, of: job.source.page_count });
						if (phase === "verify") {
							if (job.purpose === "opening") {
								try {
									const checked = await this.runtime().check({kind:'source-draft',packet:join(cwd,'task.json'),draft:join(cwd,'draft.json')},signal);
									if (!checked.ok) throw new Error(JSON.stringify(checked.error));
								}
								catch (error) { phaseCompleted = true; throw error; }
							}
							observations.review_pages = await reviewCandidate({ cwd, task: {...task, review_scope_pages: observations.read_pages},
								draft: JSON.parse(await readFile(join(cwd, "draft.json"), "utf8")), instructions, round,
								model, source: { pdf: job.source.path, cache, file_sha256:job.source.file_sha256 }, signal,
								cacheRoot:join(cache,'..','reviews'),
								reviewVersion:sha(Buffer.concat([Buffer.from(sourceRenderVersion),await readFile(join(this.runtime().contentRoot,'setup',job.purpose === 'guidance' ? 'visual-guidance.md' : 'visual-reader.md'))])),
								run: ({systemPrompt: _instructions, ...request}) => this.runtime().runTask({ kind: "reader", request: { ...request,
									priority: () => job.foreground === false ? "background" : "foreground",
									prompt: { phase: "verify", guidance: job.purpose === "guidance" } } }, request.signal),
								// Every verify row names the job and round it belongs to (#65); the reviewer adds unit and attempt.
								record: row => this.deps.record({ module_id: job.module_id, job_id: job.job_id, purpose: job.purpose, focus: job.focus ?? "", round, ...row, campaign }),
								progress: row => this.deps.progress({ module_id: job.module_id, ...row, campaign }) });
							await writeFile(join(cwd, "observations.json"), JSON.stringify(observations) + "\n");
							phaseCompleted = true;
							continue;
						}
						const imagePaths = new Set<string>();
						const imageCalls = new Map<string, string[]>();

						const reads = new Map<string, string>();
						const run = await this.runtime().runTask({ kind: "reader", request: { cwd, model: model.id, thinking: model.thinking,
							...(job.purpose==="guidance"?{imageHistory:4}:{}),
							submission:["guidance","opening"].includes(job.purpose),
							priority: () => job.foreground === false ? "background" : "foreground",
							prompt: { phase, guidance: job.purpose === "guidance" }, source: { pdf: job.source.path, cache },
							eventLog: join(cwd, `${phase}-${round}.jsonl`),
							brief: `${readerInput({task})} Your phase is ${phase}. Use page images to produce draft.json. If a draft was retained from this same interrupted request, inspect its sources and repair it instead of rewriting merely for style. ${["guidance","opening"].includes(job.purpose) ? "Use submit_reading as your sole final tool call to save/check this batch and finish without a closing reply." : ""} ${round > 1 || job.resume_from ? "Read findings.json if present and address its concrete findings." : ""}`,
							onEvent(event) {
								if (event.type === "tool_execution_start" && event.toolName === "read" && event.args?.path) reads.set(event.toolCallId, resolve(cwd, event.args.path));
								if (event.type === "tool_execution_end" && !event.isError && event.result?.content?.some((c: Row) => c.type === "image")) {
									const path = reads.get(event.toolCallId); if (path) imageCalls.set(event.toolCallId, [path]);
									if (event.result?.details?.kind === "source_pages") imageCalls.set(event.toolCallId, event.result.details.observations.map((row: Row) => row.path));
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
							...(run.ok && !pageLogFailure ? { pages: pagesRead } : {}) });
						if (!run.ok) throw new Error(run.error || (run.timedOut ? "reader timed out" : run.stderr || "reader failed"));
						if (pageLogFailure) throw pageLogFailure;
						const key = "read_pages";
						observations[key] = pagesRead;
						if (previousDraft) {
							const changed = editedSourcePages(previousDraft, JSON.parse(await readFile(join(cwd, "draft.json"), "utf8")));
							const absent = [...changed].filter(page => !observations.read_pages.includes(page));
							if (absent.length) throw new Error(`changed source records require viewing physical pages ${absent.join(", ")}`);
							observations.read_pages = [...new Set([...previousPages, ...observations.read_pages])];
						}
						if (phase === "index") observations.full_pages = [...new Set(rows.filter(row => JSON.stringify(row.box) === "[0,0,1,1]").map(row => row.page))];
						await writeFile(join(cwd, "observations.json"), JSON.stringify(observations) + "\n");
						if (phase === "read" || phase === "index") {
							readComplete = true;
							await writeFile(join(cwd, "read-complete.json"), JSON.stringify({ job_id: job.job_id, draft_sha256: sha(await readFile(join(cwd, "draft.json"))),
								...(job.purpose === "guidance" ? {guidance_sha256:sha(await readFile(join(cwd,"guidance.json")))} : {}), observations }) + "\n");
						}
						phaseCompleted = true;
					}
					const assets = [];
					if (job.purpose !== "index") {
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
					return;
				} catch (failure) {
					// Provider/transport failure during verification preserves the completed read.
					// A completed but rejected semantic review requires a source-grounded repair.
					if (phaseCompleted) {
						readComplete = false;
						try {
							const checkpointPath = join(cwd, "read-complete.json");
							const checkpoint = JSON.parse(await readFile(checkpointPath, "utf8"));
							await writeFile(checkpointPath, JSON.stringify({ ...checkpoint, requires_repair: true }) + "\n");
						} catch { /* no completed read to invalidate */ }
					}
					detail = isKernelError(failure) ? failure.toToolText() : String(failure);
					if (publishing && openingFinishSemanticRejection(failure, job) && !finishRepairUsed) {
						finishRepairUsed = true;
						lastRound = Math.max(lastRound, round + 1);
					}
					let review: Row | undefined;
					try { review = JSON.parse(await readFile(join(cwd, "review.json"), "utf8")); } catch { /* no review yet */ }
					await writeFile(join(cwd, "findings.json"), JSON.stringify({ error: detail,
						...(isKernelError(failure) ? { details: failure.details } : {}),
						...(review ? { missing: review.missing, unsupported: review.checked?.filter((row: Row) => row.verdict !== "supported") } : {}) }) + "\n");
				}
			}
		} finally {
			// Completed jobs replay here; failed attempts release their claim and preserve all artifacts.
			await this.call("module.read.finish", { module_id: job.module_id, job_id: job.job_id, lease: job.lease,
				outcome: signal.aborted ? "cancelled" : "failed", detail }, campaign).catch(() => undefined);
		}
	}
}
