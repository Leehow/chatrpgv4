import assert from "node:assert/strict";
import { test } from "node:test";
import { appendFile, mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ReadingService } from "../../extensions/module/reading-service.ts";
import { KernelError } from "../../extensions/kernel/client.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const PLAYABILITY_MESSAGE = "the opening is not playable: [] [{\"code\":\"clue_supports_nothing\",\"node_id\":\"clue-family-fled\"}]";

function openingDraft(repaired = false) {
	const nodes = [
		{ node_id: "scene-opening", node_kind: "scene", name: "Opening", summary: "The investigation begins here.",
			source_refs: [{ page: 4 }], visibility: "player-safe", properties: { is_entrance: true } },
		{ node_id: "clue-family-fled", node_kind: "clue", name: "The family fled", summary: "The family left before the denunciation.",
			source_refs: [{ page: 4 }], visibility: "keeper-only", properties: { delivery_kind: "npc_dialogue" } },
	];
	if (repaired) nodes.push({ node_id: "conclusion-denunciation", node_kind: "conclusion", name: "The denunciation drove them out",
		summary: "The denunciation explains the family's flight.", source_refs: [{ page: 5 }], visibility: "keeper-only", properties: {} });
	return { nodes, claims: repaired ? [{ subject_id: "clue-family-fled", predicate: "supports", object: { node_id: "conclusion-denunciation" },
		truth_status: "authorial", visibility: "keeper-only", source_refs: [{ page: 5 }] }] : [],
		dependencies: [], critical: [], ready_nodes: ["scene-opening", "clue-family-fled"], coverage: {} };
}

async function runFinishRepairFixture(t, { rejectEveryFinish = false, transportFailure = false } = {}) {
	const home = await mkdtemp(join(tmpdir(), "coc-finish-repair-"));
	t.after(() => rm(home, { recursive: true, force: true }));
	const cwd = join(home, "work", "attempt-1"), cache = join(home, ".coc", "modules", "book", "cache", "pages");
	await mkdir(cwd, { recursive: true });
	const readTasks = [], finishCalls = [];
	let readRounds = 0, completionAttempts = 0;
	const runtime = {
		contentRoot: join(ROOT, "content"),
		async runTask({ request }) {
			if (request.prompt.phase === "read") {
				readRounds++;
				if (readRounds === 1) return { ok: false, code: 1, timedOut: false, ms: 1, stderr: "fixture read failure", command: [] };
				const task = JSON.parse(await readFile(join(request.cwd, "task.json"), "utf8"));
				readTasks.push(task);
				const repaired = !!task.repair, page = repaired ? 5 : 4, image = join(cache, `page-${page}.png`), call = `read-${readRounds}`;
				await writeFile(join(request.cwd, "draft.json"), JSON.stringify(openingDraft(repaired)) + "\n");
				await appendFile(join(cache, "requests.jsonl"), JSON.stringify({ file_sha256: "source-sha", path: image, page, box: [0, 0, 1, 1] }) + "\n");
				request.onEvent?.({ type: "tool_execution_end", toolCallId: call, isError: false,
					result: { content: [{ type: "image" }], details: { kind: "source_pages", observations: [{ path: image, page }] } } });
				await writeFile(request.eventLog + ".images.jsonl", JSON.stringify({ included: [call] }) + "\n");
				return { ok: true, code: 0, timedOut: false, ms: 2, stderr: "", command: [] };
			}
			const task = JSON.parse(await readFile(join(request.cwd, "task.json"), "utf8"));
			const pages = task.review_scope_pages?.length ? task.review_scope_pages : [4];
			await writeFile(join(request.cwd, "review.json"), JSON.stringify({ checked: [{ paths: task.required_review,
				verdict: "supported", source_refs: pages.map(page => ({ page })), reason: "fixture source support" }], missing: [] }) + "\n");
			const call = `review-${task.required_review.join("-")}`;
			request.onEvent?.({ type: "tool_execution_end", toolCallId: call, isError: false,
				result: { content: [{ type: "image" }], details: { kind: "source_pages", observations: pages.map(page => ({ path: join(cache, `page-${page}.png`), page })) } } });
			await writeFile(request.eventLog + ".images.jsonl", JSON.stringify({ included: [call] }) + "\n");
			return { ok: true, code: 0, timedOut: false, ms: 2, stderr: "", command: [] };
		},
		async check() { return { ok: true }; },
		async sourceInfo() { throw new Error("not a guidance job"); },
	};
	const service = new ReadingService({ home, runtime, model: () => ({ id: "fixture/vision", vision: true, thinking: "off" }),
		progress() {}, record() {}, async call(method, params) {
			assert.equal(method, "module.read.finish");
			finishCalls.push(params);
			if (params.outcome === "completed") {
				completionAttempts++;
				if (transportFailure) throw new KernelError({ code: "internal", message: "kernel request timed out" });
				if (completionAttempts === 1 || rejectEveryFinish) throw new KernelError({ code: "invalid_params", message: PLAYABILITY_MESSAGE });
				return { state: "ready" };
			}
			return { state: params.outcome };
		} });
	t.after(() => service.close());
	const job = { job_id: "read-1", module_id: "book", purpose: "opening", focus: "scene-opening", foreground: true, lease: "lease-1",
		work_dir: cwd, source: { path: join(home, "source.pdf"), page_count: 8, file_sha256: "source-sha" },
		index: {}, known_nodes: [], known_claims: [], vocabulary: {}, coverage_domains: [] };
	await service.runJob(job, new AbortController().signal);
	return { cwd, readTasks, finishCalls, readRounds, completionAttempts };
}

test("a finish-time opening rejection gets one source-grounded repair after the normal rounds are spent", async t => {
	const result = await runFinishRepairFixture(t);
	assert.equal(result.readRounds, 3);
	assert.equal(result.completionAttempts, 2);
	assert.equal(result.readTasks.length, 2);
	const repair = result.readTasks[1].repair;
	assert.deepEqual(repair.draft, "draft.json");
	assert.deepEqual(repair.baseline, "baseline.json");
	assert.equal(repair.findings.error, `invalid_params: ${PLAYABILITY_MESSAGE}`);
	assert.deepEqual(JSON.parse(await readFile(join(result.cwd, "baseline.json"), "utf8")), openingDraft(false));
	assert.deepEqual(JSON.parse(await readFile(join(result.cwd, "draft.json"), "utf8")), openingDraft(true));
	assert.deepEqual(JSON.parse(await readFile(join(result.cwd, "observations.json"), "utf8")).read_pages, [4, 5]);
	assert.equal(result.finishCalls.at(-1).outcome, "failed", "the finally replay remains bounded after successful publication");
});

test("a repeated finish-time opening rejection ends as a failed job without another repair loop", async t => {
	const result = await runFinishRepairFixture(t, { rejectEveryFinish: true });
	assert.equal(result.readRounds, 3);
	assert.equal(result.completionAttempts, 2);
	assert.equal(result.finishCalls.length, 3);
	assert.equal(result.finishCalls.at(-1).outcome, "failed");
	assert.equal(result.finishCalls.at(-1).detail, `invalid_params: ${PLAYABILITY_MESSAGE}`);
});

test("a finish transport failure does not consume the semantic repair continuation", async t => {
	const result = await runFinishRepairFixture(t, { transportFailure: true });
	assert.equal(result.readRounds, 2);
	assert.equal(result.completionAttempts, 1);
	assert.equal(result.finishCalls.length, 2);
	assert.equal(result.finishCalls.at(-1).outcome, "failed");
	assert.equal(result.finishCalls.at(-1).detail, "internal: kernel request timed out");
});

test("a foreground timeout can rejoin the same pending reading without starting another reader", async t => {
	const prior = process.env.PI_COC_READ_WAIT_MS;
	process.env.PI_COC_READ_WAIT_MS = "10";
	t.after(() => { if (prior === undefined) delete process.env.PI_COC_READ_WAIT_MS; else process.env.PI_COC_READ_WAIT_MS = prior; });
	let ready = false;
	const calls = [];
	const service = new ReadingService({ home: "/unused", model: () => { throw new Error("no local reader should be started"); },
		progress() {}, record() {}, async call(method, params) {
			calls.push({ method, params });
			if (method === "module.read.request") return { state: ready ? "ready" : "reading", job_id: "read-1", generation: ready ? 2 : 1 };
			if (method === "module.read.claim") return { job_id: null }; // another host owns the persisted job
			throw new Error("unexpected mutation");
		} });
	t.after(() => service.dispose());
	await assert.rejects(service.ensure("book-1", { purpose: "detail", focus: "Tower" }), e => e.details?.reason === "reading_timeout");
	ready = true;
	process.env.PI_COC_READ_WAIT_MS = "1000";
	const result = await service.ensure("book-1", { purpose: "detail", focus: "Tower" });
	assert.equal(result.state, "ready");
	assert.equal(result.generation, 2);
	assert.ok(calls.every(c => ["module.read.request", "module.read.claim"].includes(c.method)));
});

test("already prepared material returns without source work and a cancelled call is refused", async t => {
	const calls = [];
	const service = new ReadingService({ home: "/unused", model: () => { throw new Error("not needed"); },
		progress() {}, record() {}, async call(method) { calls.push(method); return { state: "ready", generation: 3 }; } });
	t.after(() => service.dispose());
	assert.equal((await service.ensure("book-1", { purpose: "opening" })).generation, 3);
	assert.deepEqual(calls, ["module.read.request"]);
	const cancelled = new AbortController(); cancelled.abort();
	await assert.rejects(service.ensure("book-1", { purpose: "detail" }, cancelled.signal), /cancelled/);
	assert.equal(calls.length, 1);
});

test("a reused book with several openings requires a choice for this preparation", async t => {
	const calls = [];
	const candidates = [{ scene: "one", name: "Opening 1", summary: "Serve an arrest order." },
		{ scene: "two", name: "Opening 2", summary: "Investigate the production failure." }];
	const service = new ReadingService({ home: "/unused", model: () => { throw new Error("the source is already prepared"); }, progress() {}, record() {},
		async call(method, params) {
			calls.push({ method, params });
			if (method === "module.status") return { opening_ready: true, opening_candidates: candidates };
			if (method === "module.opening.choose") return { opening_ready: true };
			if (method === "module.read.request") return { state: "ready" };
			throw new Error("unexpected source work");
		} });
	t.after(() => service.dispose());
	await assert.rejects(service.prepare({ module_id: "book-1" }), e => e.code === "needs_choice" && e.details.candidates[1].summary === candidates[1].summary);
	assert.deepEqual(calls.map(c => c.method), ["module.read.request", "module.status"]);
	assert.equal((await service.prepare({ module_id: "book-1", start_scene: "two" })).opening_ready, true);
	assert.equal(calls.find(c => c.method === "module.opening.choose").params.scene, "two");
});

test("an unavailable original PDF reports bad_pdf before registering source work", async t => {
	const calls = [];
	const service = new ReadingService({ home: "/unused", model: () => ({ id: "fixture/vision", vision: true }),
		progress() {}, record() {}, async call(method) { calls.push(method); throw new Error("no source should be registered"); } });
	t.after(() => service.dispose());
	await assert.rejects(service.prepare({ pdf: "missing-original.pdf" }), e => e.details?.reason === "bad_pdf" && e.fix.includes("original PDF"));
	assert.deepEqual(calls, []);
});

test("a work-directory failure releases its claimed job instead of leaving it running", async t => {
	const home = await mkdtemp(join(tmpdir(), "coc-reader-io-"));
	t.after(() => rm(home, { recursive: true, force: true }));
	const work = join(home, "not-a-directory");
	await writeFile(work, "preserved file");
	let failed = false;
	const finishes = [];
	const service = new ReadingService({ home, model: () => ({ id: "fixture/vision", vision: true }), progress() {}, record() {},
		async call(method, params) {
			if (method === "module.read.request") return failed ? { state: "blocked", missing: ["work directory unavailable"] } : { state: "queued" };
			if (method === "module.read.claim") return failed ? { job_id: null } : {
				module_id: "book-1", job_id: "read-1", lease: "fixture-lease", work_dir: work, purpose: "opening",
				source: { path: join(home, "source.pdf"), file_sha256: "fixture", page_count: 1 } };
			if (method === "module.read.finish") { finishes.push(params); failed = true; return { state: "failed" }; }
			throw new Error("unexpected operation");
		} });
	t.after(() => service.dispose());
	await assert.rejects(service.ensure("book-1", { purpose: "opening" }), /work directory unavailable/);
	assert.equal(finishes.length, 1);
	assert.equal(finishes[0].outcome, "failed");
	assert.match(finishes[0].detail, /ENOTDIR/);
});


test('a foreground arrival wakes the pump while its background child is still running', async()=>{
 let initial=true,foreground=false;const started=[];
 const service=new ReadingService({home:'/unused',model:()=>({id:'fixture/vision',vision:true}),progress(){},record(){},
 async call(method){if(method!=='module.read.claim')throw Error('unexpected');
 if(initial){initial=false;return {job_id:'background',concurrency:2,purpose:'detail'}}
 if(foreground){foreground=false;return {job_id:'foreground',concurrency:2,purpose:'detail'}}return {job_id:null};}});
 service.runJob=async(job,signal)=>{started.push(job.job_id);await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}))};
 const pending=service.prefetch('book');await new Promise(resolve=>setTimeout(resolve,10));
 foreground=true;void service.prefetch('book');
 const deadline=Date.now()+1000;while(started.length<2&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,5));
 assert.deepEqual(started,['background','foreground']);await service.close();await pending;
});

async function until(check) {
	const deadline = Date.now() + 1500;
	while (!check() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
	assert.ok(check(), "reader state did not settle");
}

test("cancelling the foreground request leaves an unrelated background reader alive and close drains it", async t => {
	const queued = ["background"], signals = new Map(), finished = new Map(), drained = [];
	let foregroundRequested = false;
	const service = new ReadingService({ home: "/unused", model: () => ({ id: "fixture/vision", vision: true }), progress() {}, record() {},
		async call(method, params) {
			if (method === "module.read.request") {
				if (!foregroundRequested) { foregroundRequested = true; queued.push("foreground"); }
				return { state: "reading", job_id: "foreground" };
			}
			if (method === "module.read.claim") return { job_id: queued.shift() ?? null, concurrency: 2, purpose: "detail" };
			if (method === "module.read.finish") { finished.set(params.job_id, params.outcome); return {}; }
			throw new Error("unexpected operation");
		} });
	t.after(() => service.close());
	service.runJob = async (job, signal) => {
		signals.set(job.job_id, signal);
		await new Promise(resolve => signal.addEventListener("abort", resolve, { once: true }));
		await new Promise(resolve => setTimeout(resolve, 20));
		drained.push(job.job_id);
		throw new Error("reader cancelled after draining its children");
	};
	const background = service.prefetch("book");
	await until(() => signals.has("background"));
	const abort = new AbortController();
	const foreground = service.ensure("book", { purpose: "detail", focus: "Tower", foreground: true }, abort.signal);
	const cancelled = assert.rejects(foreground, /cancelled/);
	await until(() => signals.has("foreground"));
	abort.abort();
	await cancelled;
	await until(() => finished.has("foreground"));
	assert.equal(finished.get("foreground"), "cancelled");
	assert.equal(signals.get("background").aborted, false);
	assert.deepEqual(drained, ["foreground"]);
	await service.close();
	await background;
	assert.equal(finished.get("background"), "cancelled");
	assert.deepEqual(drained, ["foreground", "background"]);
});

test("one cancelled waiter cannot cancel a shared reader still awaited by another caller", async t => {
	let claimed = false, signal;
	const service = new ReadingService({ home: "/unused", model: () => ({ id: "fixture/vision", vision: true }), progress() {}, record() {},
		async call(method) {
			if (method === "module.read.request") return { state: "reading", job_id: "shared" };
			if (method === "module.read.claim") { if (claimed) return { job_id: null }; claimed = true; return { job_id: "shared" }; }
			if (method === "module.read.finish") return {};
			throw new Error("unexpected operation");
		} });
	t.after(() => service.close());
	service.runJob = async (_job, ownedSignal) => { signal = ownedSignal; await new Promise(resolve => signal.addEventListener("abort", resolve, { once: true })); };
	const first = new AbortController(), second = new AbortController();
	const params = { purpose: "detail", focus: "Tower", foreground: true };
	const a = assert.rejects(service.ensure("book", params, first.signal), /cancelled/);
	const b = assert.rejects(service.ensure("book", params, second.signal), /cancelled/);
	await until(() => signal);
	first.abort();
	await a;
	assert.equal(signal.aborted, false);
	second.abort();
	await b;
	assert.equal(signal.aborted, true);
	await service.close();
});

test("simultaneous cancellation of all shared waiters aborts the reader", async t => {
	let claimed = false, signal;
	const service = new ReadingService({ home: "/unused", model: () => ({ id: "fixture/vision", vision: true }), progress() {}, record() {},
		async call(method) {
			if (method === "module.read.request") return { state: "reading", job_id: "shared" };
			if (method === "module.read.claim") { if (claimed) return { job_id: null }; claimed = true; return { job_id: "shared" }; }
			throw new Error("unexpected operation");
		} });
	t.after(() => service.close());
	service.runJob = async (_job, ownedSignal) => { signal = ownedSignal; await new Promise(resolve => signal.addEventListener("abort", resolve, { once: true })); };
	const abort = new AbortController(), params = { purpose: "detail", focus: "Tower" };
	const pending = [1, 2].map(() => assert.rejects(service.ensure("book", params, abort.signal), /cancelled/));
	await until(() => signal);
	abort.abort();
	await Promise.all(pending);
	assert.equal(signal.aborted, true);
	await service.close();
});

test("cancellation before the request returns retires only that queued job without starting its reader", async t => {
	let resolveRequest, queued = false;
	const finished = [];
	const service = new ReadingService({ home: "/unused", model: () => { throw new Error("cancelled job must not launch a reader"); }, progress() {}, record() {},
		async call(method, params) {
			if (method === "module.read.request") return new Promise(resolve => { resolveRequest = resolve; });
			if (method === "module.read.claim") { if (!queued) return { job_id: null }; queued = false; return { job_id: "pending" }; }
			if (method === "module.read.finish") { finished.push(params); return {}; }
			throw new Error("unexpected operation");
		} });
	t.after(() => service.close());
	const abort = new AbortController();
	const pending = assert.rejects(service.ensure("book", { purpose: "detail", focus: "Tower" }, abort.signal), /cancelled/);
	abort.abort();
	await pending;
	queued = true;
	resolveRequest({ state: "queued", job_id: "pending" });
	await until(() => finished.length === 1);
	assert.equal(finished[0].job_id, "pending");
	assert.equal(finished[0].outcome, "cancelled");
});
