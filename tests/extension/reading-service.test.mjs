import assert from "node:assert/strict";
import { test } from "node:test";
import { appendFile, mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { ReadingService } from "../../extensions/module/reading-service.ts";
import { KernelError } from "../../extensions/kernel/client.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const FINISH_SEMANTIC_MESSAGE = "the independent review found missing or incorrect material: [{\"description\":\"the opening needs its clue nodes and relations\"}]";

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

async function runFinishRepairFixture(t, { rejectEveryFinish = false, transportFailure = false, campaign } = {}) {
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
				if (completionAttempts === 1 || rejectEveryFinish) throw new KernelError({ code: "invalid_params", message: FINISH_SEMANTIC_MESSAGE });
				return { state: "ready" };
			}
			return { state: params.outcome };
		} });
	t.after(() => service.close());
	const job = { job_id: "read-1", module_id: "book", purpose: "opening", focus: "scene-opening", foreground: true, lease: "lease-1",
		work_dir: cwd, source: { path: join(home, ".coc", "modules", "book", "source.pdf"), page_count: 8, file_sha256: "source-sha" },
		index: {}, known_nodes: [], known_claims: [], vocabulary: {}, coverage_domains: [] };
	await service.runJob(job, new AbortController().signal, campaign);
	return { cwd, readTasks, finishCalls, readRounds, completionAttempts };
}

test("a finish-time independent-review rejection gets one source-grounded repair after the normal rounds are spent", async t => {
	const result = await runFinishRepairFixture(t);
	assert.equal(result.readRounds, 3);
	assert.equal(result.completionAttempts, 2);
	assert.equal(result.readTasks.length, 2);
	const repair = result.readTasks[1].repair;
	assert.deepEqual(repair.draft, "draft.json");
	assert.deepEqual(repair.baseline, "baseline.json");
	assert.equal(repair.findings.error.split("\n", 1)[0], `invalid_params: ${FINISH_SEMANTIC_MESSAGE}`);
	assert.deepEqual(JSON.parse(await readFile(join(result.cwd, "baseline.json"), "utf8")), openingDraft(false));
	assert.deepEqual(JSON.parse(await readFile(join(result.cwd, "draft.json"), "utf8")), openingDraft(true));
	assert.deepEqual(JSON.parse(await readFile(join(result.cwd, "observations.json"), "utf8")).read_pages, [4, 5]);
	assert.equal(result.finishCalls.at(-1).outcome, "failed", "the finally replay remains bounded after successful publication");
});

test("a repeated finish-time invalid-params rejection ends as a failed job without another repair loop", async t => {
	const result = await runFinishRepairFixture(t, { rejectEveryFinish: true });
	assert.equal(result.readRounds, 3);
	assert.equal(result.completionAttempts, 2);
	assert.equal(result.finishCalls.length, 3);
	assert.equal(result.finishCalls.at(-1).outcome, "failed");
	assert.equal(result.finishCalls.at(-1).detail.split("\n", 1)[0], `invalid_params: ${FINISH_SEMANTIC_MESSAGE}`);
});

test("a finish transport failure does not consume the semantic repair continuation", async t => {
	const result = await runFinishRepairFixture(t, { transportFailure: true });
	assert.equal(result.readRounds, 2);
	assert.equal(result.completionAttempts, 1);
	assert.equal(result.finishCalls.length, 2);
	assert.equal(result.finishCalls.at(-1).outcome, "failed");
	assert.equal(result.finishCalls.at(-1).detail.split("\n", 1)[0], "internal: kernel request timed out");
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

/**
 * Contract §57. The wait ending is what releases the lease, and it releases it once: the `fulfil`
 * poll that follows must stop asserting `foreground`, or the kernel is re-promoted 300 ms later and
 * the demotion is worth nothing. On M-DETOUR (`game-3d8ab658`, 2026-09-16) the abandoned read held
 * the single foreground lease for a further 574 s after its Keeper stopped waiting on it.
 */
test("a foreground wait that ends gives the lease back instead of holding it for nobody", async t => {
	const prior = process.env.PI_COC_READ_WAIT_MS;
	process.env.PI_COC_READ_WAIT_MS = "10";
	t.after(() => { if (prior === undefined) delete process.env.PI_COC_READ_WAIT_MS; else process.env.PI_COC_READ_WAIT_MS = prior; });
	const calls = [], rows = [];
	const service = new ReadingService({ home: "/unused", model: () => { throw new Error("no local reader should be started"); },
		progress() {}, record(row) { rows.push(row); }, async call(method, params) {
			calls.push({ method, params });
			if (method === "module.read.request") return { state: "reading", job_id: "read-6", generation: 1 };
			if (method === "module.read.claim") return { job_id: null }; // another host owns the persisted job
			if (method === "module.read.unwait") return { job_id: params.job_id, foreground: false };
			throw new Error(`unexpected ${method}`);
		} });
	t.after(() => service.dispose());
	await assert.rejects(service.ensure("book-1", { purpose: "detail", focus: "Bar Cordano", foreground: true }),
		e => e.details?.reason === "reading_timeout");
	await until(() => calls.some(call => call.method === "module.read.unwait"));
	const released = calls.find(call => call.method === "module.read.unwait");
	assert.deepEqual([released.params.module_id, released.params.job_id], ["book-1", "read-6"]);
	assert.ok(rows.some(row => row.event === "unwaited" && row.job_id === "read-6"), "the demotion left no telemetry row");
	const requested = () => calls.filter(call => call.method === "module.read.request");
	const spent = requested().length;
	await until(() => requested().length > spent);
	assert.ok(requested().slice(spent).every(call => call.params.foreground !== true),
		"the polling loop kept re-promoting a reading nobody waits on");
});

test("a wait that ends before the reading has a job id still gives the lease back", async t => {
	const prior = process.env.PI_COC_READ_WAIT_MS;
	process.env.PI_COC_READ_WAIT_MS = "5";
	t.after(() => { if (prior === undefined) delete process.env.PI_COC_READ_WAIT_MS; else process.env.PI_COC_READ_WAIT_MS = prior; });
	const calls = [];
	let first = true;
	const service = new ReadingService({ home: "/unused", model: () => { throw new Error("no local reader should be started"); },
		progress() {}, record() {}, async call(method, params) {
			calls.push({ method, params });
			if (method === "module.read.request") {
				if (first) { first = false; await new Promise(resolve => setTimeout(resolve, 60)); }
				return { state: "reading", job_id: "read-6", generation: 1 };
			}
			if (method === "module.read.claim") return { job_id: null };
			if (method === "module.read.unwait") return { job_id: params.job_id, foreground: false };
			throw new Error(`unexpected ${method}`);
		} });
	t.after(() => service.dispose());
	await assert.rejects(service.ensure("book-1", { purpose: "detail", focus: "Bar Cordano", foreground: true }),
		e => e.details?.reason === "reading_timeout");
	assert.equal(calls.some(call => call.method === "module.read.unwait"), false, "the reading had no job id to release yet");
	await until(() => calls.some(call => call.method === "module.read.unwait"));
	assert.equal(calls.find(call => call.method === "module.read.unwait").params.job_id, "read-6");
});

test("a foreground reading still awaited by another caller keeps its lease", async t => {
	const prior = process.env.PI_COC_READ_WAIT_MS;
	process.env.PI_COC_READ_WAIT_MS = "400";
	t.after(() => { if (prior === undefined) delete process.env.PI_COC_READ_WAIT_MS; else process.env.PI_COC_READ_WAIT_MS = prior; });
	const calls = [];
	const service = new ReadingService({ home: "/unused", model: () => { throw new Error("no local reader should be started"); },
		progress() {}, record() {}, async call(method, params) {
			calls.push({ method, params });
			if (method === "module.read.request") return { state: "reading", job_id: "read-6", generation: 1 };
			if (method === "module.read.claim") return { job_id: null };
			if (method === "module.read.unwait") return { job_id: params.job_id, foreground: false };
			throw new Error(`unexpected ${method}`);
		} });
	t.after(() => service.dispose());
	const patient = service.ensure("book-1", { purpose: "detail", focus: "Bar Cordano", foreground: true });
	patient.catch(() => undefined);
	process.env.PI_COC_READ_WAIT_MS = "10";
	await assert.rejects(service.ensure("book-1", { purpose: "detail", focus: "Bar Cordano", foreground: true }),
		e => e.details?.reason === "reading_timeout");
	assert.equal(calls.some(call => call.method === "module.read.unwait"), false, "one waiter leaving is not the last waiter leaving");
	await assert.rejects(patient, e => e.details?.reason === "reading_timeout");
	await until(() => calls.some(call => call.method === "module.read.unwait"));
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
	const service = new ReadingService({ home: "/unused", campaign: () => "campaign-bound", model: () => { throw new Error("the source is already prepared"); }, progress() {}, record() {},
		async call(method, params) {
			calls.push({ method, params });
			if (method === "module.status") return { opening_ready: true, opening_candidates: candidates };
			if (method === "module.read.request") return { state: "ready" };
			throw new Error("unexpected source work");
		} });
	t.after(() => service.dispose());
	await assert.rejects(service.prepare({ module_id: "book-1" }), e => e.code === "needs_choice" && e.details.candidates[1].summary === candidates[1].summary);
	assert.deepEqual(calls.map(c => c.method), ["module.read.request", "module.status"]);
	assert.equal((await service.prepare({ module_id: "book-1", start_scene: "two", campaign: "campaign-explicit" })).opening_ready, true);
	assert.equal(calls.at(-1).params.purpose, "opening");
	assert.equal(calls.at(-1).params.focus, "two");
	assert.ok(calls.every(c => !Object.hasOwn(c.params, "campaign")), "initial preparation must explicitly use the library");
	assert.ok(calls.every(c => c.method !== "module.opening.choose"), "the player's opening must not be stored in the library");
});

test("targeted preparation and ordinary foreground requests use their captured campaign", async t => {
	let campaign = "campaign-a";
	const calls = [], releases = [];
	const service = new ReadingService({ home: "/unused", campaign: () => campaign,
		model: () => { throw new Error("already prepared"); }, progress() {}, record() {},
		async call(method, params) {
			calls.push({ method, params });
			assert.equal(method, "module.read.request");
			return new Promise(resolve => releases.push(() => resolve({ state: "ready", campaign: params.campaign })));
		} });
	t.after(() => service.close());
	const params = { purpose: "detail", focus: "Tower", foreground: true };
	const a = service.ensure("book", params);
	campaign = "campaign-b";
	const b = service.ensure("book", params);
	assert.equal(calls.length, 2, "identical requests in different campaigns must not deduplicate");
	releases.splice(0).forEach(release => release());
	assert.deepEqual((await Promise.all([a, b])).map(row => row.campaign), ["campaign-a", "campaign-b"]);
	const targeted = service.prepare({ module_id: "book", start_scene: "Tower", targeted: true, retry: true });
	assert.equal(calls.at(-1).params.campaign, "campaign-b");
	assert.equal(calls.at(-1).params.focus, "Tower");
	assert.equal(calls.at(-1).params.retry, true);
	releases.splice(0).forEach(release => release());
	await targeted;
	const explicit = service.prepare({ module_id: "book", start_scene: "Cellar", targeted: true, campaign: "campaign-a" });
	assert.equal(calls.at(-1).params.campaign, "campaign-a");
	releases.splice(0).forEach(release => release());
	await explicit;
});

test("same-module pumps, foreground promotion and cancellation retain separate campaign scopes", async t => {
	let campaign = "campaign-a";
	const calls = [], records = [], claimed = new Set(), signals = new Map(), jobs = new Map();
	const service = new ReadingService({ home: "/unused", campaign: () => campaign,
		model: () => { throw new Error("mock reader only"); }, progress() {}, record(row) { records.push(row); },
		async call(method, params) {
			calls.push({ method, params });
			if (method === "module.read.request") return { state: "reading", job_id: "same-job" };
			if (method === "module.read.claim") {
				if (claimed.has(params.campaign)) return { job_id: null };
				claimed.add(params.campaign);
				return { job_id: "same-job", lease: `lease-${params.campaign}`, purpose: "detail", foreground: false };
			}
			if (method === "module.read.finish") return {};
			throw new Error("unexpected operation");
		} });
	t.after(() => service.close());
	service.runJob = async (job, signal, scope) => {
		jobs.set(scope, job); signals.set(scope, signal);
		await new Promise(resolve => signal.addEventListener("abort", resolve, { once: true }));
		throw new Error("reader cancelled");
	};
	const backgroundA = service.prefetch("book", "wake-a");
	await until(() => signals.size === 1);
	campaign = "campaign-b";
	const backgroundB = service.prefetch("book", "wake-b");
	await until(() => signals.size === 2);
	const params = { purpose: "detail", focus: "Tower", foreground: true };
	const abortA = new AbortController(), abortB = new AbortController();
	const a = assert.rejects(service.ensure("book", { ...params, campaign: "campaign-a" }, abortA.signal), /cancelled/);
	await until(() => jobs.get("campaign-a").foreground === true);
	assert.equal(jobs.get("campaign-b").foreground, false, "foreground promotion must not change another scope's same job id");
	const b = assert.rejects(service.ensure("book", params, abortB.signal), /cancelled/);
	await until(() => jobs.get("campaign-b").foreground === true);
	campaign = "campaign-later";
	abortA.abort(); await a;
	await until(() => calls.some(c => c.method === "module.read.finish"));
	assert.equal(signals.get("campaign-b").aborted, false);
	assert.deepEqual(calls.filter(c => c.method === "module.read.finish").map(c => [c.params.campaign, c.params.lease, c.params.outcome]),
		[["campaign-a", "lease-campaign-a", "cancelled"]]);
	abortB.abort(); await b;
	await Promise.all([backgroundA, backgroundB]);
	assert.deepEqual(calls.filter(c => c.method === "module.read.finish").map(c => [c.params.campaign, c.params.lease, c.params.outcome]),
		[["campaign-a", "lease-campaign-a", "cancelled"], ["campaign-b", "lease-campaign-b", "cancelled"]]);
	assert.ok(calls.every(c => ["campaign-a", "campaign-b"].includes(c.params.campaign)));
	assert.deepEqual(records.filter(row => row.event === "concurrency").map(row => [row.campaign, row.wake]),
		[["campaign-a", "wake-a"], ["campaign-b", "wake-b"]]);
});

test("publication repair and final replay finish in the job's captured campaign", async t => {
	const result = await runFinishRepairFixture(t, { campaign: "campaign-a" });
	assert.equal(result.completionAttempts, 2);
	assert.equal(result.finishCalls.length, 3);
	assert.ok(result.finishCalls.every(row => row.campaign === "campaign-a"));
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
				source: { path: join(home, ".coc", "modules", "book-1", "source.pdf"), file_sha256: "fixture", page_count: 1 } };
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
	let resolveRequest, queued = false, campaign = "campaign-a";
	const finished = [], calls = [];
	const service = new ReadingService({ home: "/unused", campaign: () => campaign, model: () => { throw new Error("cancelled job must not launch a reader"); }, progress() {}, record() {},
		async call(method, params) {
			calls.push({ method, params });
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
	campaign = "campaign-b";
	queued = true;
	resolveRequest({ state: "queued", job_id: "pending" });
	await until(() => finished.length === 1);
	assert.equal(finished[0].job_id, "pending");
	assert.equal(finished[0].outcome, "cancelled");
	assert.ok(calls.every(c => c.params.campaign === "campaign-a"), "late cancellation must not follow a changed binding");
});

// A retry that inherits a failed job's draft owes the source-based repair round (contract section 22).
// Re-verifying identical bytes under identical instructions cannot re-scope them, so an over-broad
// draft would otherwise be re-reviewed for every retry and never shrink.
function detailDraft(nodes) {
	return { nodes, claims: [], dependencies: [], critical: [], ready_nodes: nodes.map(node => node.node_id), coverage: {} };
}
const wideDraft = detailDraft([
	{ node_id: "location-farm", node_kind: "location", name: "Farm", summary: "The collective farm.", source_refs: [{ page: 17 }], visibility: "keeper-only", properties: {} },
	{ node_id: "npc-unrelated", node_kind: "npc", name: "Unrelated", summary: "A late-scenario figure.", source_refs: [{ page: 44 }], visibility: "keeper-only", properties: {} },
]);

async function runResumeFixture(t, { previousJobId }) {
	const home = await mkdtemp(join(tmpdir(), "coc-resume-scope-"));
	t.after(() => rm(home, { recursive: true, force: true }));
	const key = "job-key-1", fileSha = "source-sha";
	const previous = join(home, "work", previousJobId, "attempt-1");
	const cwd = join(home, "work", "read-2", "attempt-1");
	const cache = join(home, ".coc", "modules", "book", "cache", "pages");
	await mkdir(previous, { recursive: true });
	await mkdir(cwd, { recursive: true });
	await mkdir(cache, { recursive: true });
	const draftBytes = JSON.stringify(wideDraft) + "\n";
	await writeFile(join(previous, "draft.json"), draftBytes);
	await writeFile(join(previous, "packet.json"), JSON.stringify({ key, source: { file_sha256: fileSha } }));
	await writeFile(join(previous, "findings.json"), JSON.stringify({ error: "Review unit 26: Error: Request timed out." }));
	// The interrupted attempt's own checkpoint names the job that produced it.
	await writeFile(join(previous, "read-complete.json"), JSON.stringify({ job_id: previousJobId,
		draft_sha256: createHash("sha256").update(draftBytes).digest("hex"),
		observations: { file_sha256: fileSha, read_pages: [17, 44], full_pages: [], review_pages: [] } }));
	const phases = [], readTasks = [];
	const runtime = {
		contentRoot: join(ROOT, "content"),
		async runTask({ request }) {
			phases.push(request.prompt.phase);
			if (request.prompt.phase === "read") {
				readTasks.push(JSON.parse(await readFile(join(request.cwd, "task.json"), "utf8")));
				// The repair drops the out-of-scope node and keeps the in-scope one unchanged.
				await writeFile(join(request.cwd, "draft.json"), JSON.stringify(detailDraft([wideDraft.nodes[0]])) + "\n");
			}
			const task = JSON.parse(await readFile(join(request.cwd, "task.json"), "utf8"));
			// A reviewer must be seen to view every page assigned to it, so the fixture cites its whole scope.
			const cited = request.prompt.phase === "verify" && task.review_scope_pages?.length ? task.review_scope_pages : [17];
			if (request.prompt.phase === "verify")
				await writeFile(join(request.cwd, "review.json"), JSON.stringify({ checked: [{ paths: task.required_review,
					verdict: "supported", source_refs: cited.map(page => ({ page })), reason: "fixture source support" }], missing: [] }) + "\n");
			const call = `call-${phases.length}`;
			for (const page of cited)
				await appendFile(join(cache, "requests.jsonl"), JSON.stringify({ file_sha256: fileSha, path: join(cache, `page-${page}.png`), page, box: [0, 0, 1, 1] }) + "\n");
			request.onEvent?.({ type: "tool_execution_end", toolCallId: call, isError: false,
				result: { content: [{ type: "image" }], details: { kind: "source_pages", observations: cited.map(page => ({ path: join(cache, `page-${page}.png`), page })) } } });
			await writeFile(request.eventLog + ".images.jsonl", JSON.stringify({ included: [call] }) + "\n");
			return { ok: true, code: 0, timedOut: false, ms: 2, stderr: "", command: [] };
		},
		async check() { return { ok: true }; },
		async sourceInfo() { throw new Error("not a guidance job"); },
	};
	const finished = [];
	const service = new ReadingService({ home, runtime, model: () => ({ id: "fixture/vision", vision: true, thinking: "off" }),
		progress() {}, record() {}, async call(method, params) { finished.push(params); return { state: "ready" }; } });
	t.after(() => service.close());
	await service.runJob({ job_id: "read-2", module_id: "book", purpose: "detail", focus: "farm", question: "prepare the farm map",
		key, foreground: true, lease: "lease-1", work_dir: cwd, resume_from: previous,
		source: { path: join(home, ".coc", "modules", "book", "source.pdf"), page_count: 48, file_sha256: fileSha },
		index: {}, known_nodes: [], known_claims: [], vocabulary: {}, coverage_domains: [] }, new AbortController().signal);
	// The verify phase fans out into one reviewer run per unit; the order of phases is what matters here.
	return { cwd, phases: phases.filter((phase, index) => phase !== phases[index - 1]), readTasks, finished };
}

test("a retry resuming a failed job re-reads the source so an over-broad draft can be re-scoped", async t => {
	const result = await runResumeFixture(t, { previousJobId: "read-1" });
	assert.deepEqual(result.phases, ["read", "verify"], "the inherited checkpoint must not skip the repair read");
	assert.equal(result.readTasks.length, 1);
	assert.equal(result.readTasks[0].repair.findings.error, "Review unit 26: Error: Request timed out.",
		"the reader is told concretely why the previous job failed");
	assert.deepEqual(JSON.parse(await readFile(join(result.cwd, "baseline.json"), "utf8")), wideDraft,
		"the retained draft stays available as input rather than being discarded");
	assert.deepEqual(JSON.parse(await readFile(join(result.cwd, "draft.json"), "utf8")).nodes.map(n => n.node_id), ["location-farm"]);
	assert.equal(JSON.parse(await readFile(join(result.cwd, "read-complete.json"), "utf8")).job_id, "read-2",
		"the checkpoint names the job whose own read produced it, so only that job's own attempt may skip reading");
	assert.ok(result.finished.some(call => call.outcome === "completed"), "the re-scoped draft still publishes");
});

test("a job resuming its own interrupted attempt keeps the completed read and verifies only", async t => {
	const result = await runResumeFixture(t, { previousJobId: "read-2" });
	assert.deepEqual(result.phases, ["verify"], "an interruption must not pay for the source reading twice");
	assert.equal(result.readTasks.length, 0);
	assert.ok(result.finished.some(call => call.outcome === "completed"));
});

/**
 * Contract §22. On 2026-09-15 two claimed reading jobs (`read-5`, `read-10`, campaign
 * game-3dd94f0a) went quiet mid-verify and never spoke again: no error, no completion, no child
 * process, and 6.5 hours later the module still said `blocked` with a server restart as the only
 * remedy. The lane is now judged by its own heartbeat -- what the job reported, not elapsed wall
 * clock -- and a job past the window is stopped and published as `failed`, never left pretending
 * to be read.
 */
async function stalledJobFixture(t, { window = "60" } = {}) {
	const previous = process.env.PI_COC_READ_STALL_MS;
	process.env.PI_COC_READ_STALL_MS = window;
	t.after(() => { if (previous === undefined) delete process.env.PI_COC_READ_STALL_MS; else process.env.PI_COC_READ_STALL_MS = previous; });
	const rows = [], statuses = [], finishes = [];
	let queued = true;
	const service = new ReadingService({ home: "/unused", campaign: () => "game-stall", model: () => ({ id: "fixture/vision", vision: true }),
		progress() {}, record(row) { rows.push(row); }, status(row) { statuses.push(row); },
		async call(method, params) {
			if (method === "module.read.claim") {
				if (!queued) return { job_id: null };
				queued = false;
				return { job_id: "read-5", module_id: "book-1", purpose: "detail", focus: "museo-de-arqueologia",
					foreground: true, lease: "lease-5", concurrency: 1, at: new Date().toISOString() };
			}
			assert.equal(method, "module.read.finish");
			finishes.push(params);
			return { state: params.outcome };
		} });
	t.after(() => service.dispose());
	// A reader child that is alive but says nothing: it never resolves on its own and only stops when aborted.
	service.runJob = (_job, signal) => new Promise((_resolve, reject) => {
		if (signal.aborted) reject(new Error("aborted"));
		signal.addEventListener("abort", () => reject(new Error("the reader was stopped")), { once: true });
	});
	void service.prefetch("book-1", "turn-committed");
	const began = Date.now();
	while (!finishes.length && Date.now() - began < 10_000) await new Promise(resolve => setTimeout(resolve, 20));
	return { rows, statuses, finishes, service };
}

test("a reading job that reports nothing is stopped on its own heartbeat and published as failed", async t => {
	const { rows, statuses, finishes } = await stalledJobFixture(t);

	const stalled = rows.find(row => row.event === "stalled");
	assert.ok(stalled, `the stall is its own telemetry row, not an inference: ${JSON.stringify(rows)}`);
	assert.deepEqual([stalled.lane, stalled.module_id, stalled.job_id, stalled.purpose, stalled.focus],
		["reading", "book-1", "read-5", "detail", "museo-de-arqueologia"]);
	assert.equal(stalled.campaign, "game-stall");
	assert.equal(stalled.window_ms, 60);
	assert.ok(stalled.idle_ms >= 60, `the row carries how long the job was quiet, not just that it was: ${stalled.idle_ms}`);

	// The operator's surface (shaped after §32.2): out of fiction, once, with the fix.
	assert.equal(statuses.length, 1, "the operator is told once, not once per sweep");
	assert.equal(statuses[0].status, "down");
	assert.match(statuses[0].fix, /reader/);
	assert.equal(statuses[0].job_id, "read-5");

	// `cancelled` would read as "somebody asked for this to stop" and leave no reason on disk; only
	// `failed` records the silence and offers the retry of §22.
	assert.equal(finishes.length, 1);
	assert.equal(finishes[0].outcome, "failed", JSON.stringify(finishes[0]));
	assert.equal(finishes[0].job_id, "read-5");
	assert.equal(finishes[0].lease, "lease-5");
	assert.match(finishes[0].detail, /reported nothing/);
});

test("a job that keeps reporting is left alone: the heartbeat is what it said, not the clock", async t => {
	const previous = process.env.PI_COC_READ_STALL_MS;
	process.env.PI_COC_READ_STALL_MS = "300";
	t.after(() => { if (previous === undefined) delete process.env.PI_COC_READ_STALL_MS; else process.env.PI_COC_READ_STALL_MS = previous; });
	const rows = [], finishes = [];
	let queued = true;
	const service = new ReadingService({ home: "/unused", model: () => ({ id: "fixture/vision", vision: true }),
		progress() {}, record(row) { rows.push(row); },
		async call(method, params) {
			if (method === "module.read.claim") {
				if (!queued) return { job_id: null };
				queued = false;
				return { job_id: "read-9", module_id: "book-1", purpose: "detail", focus: "Jesse Hughes", lease: "lease-9", concurrency: 1, at: new Date().toISOString() };
			}
			finishes.push(params);
			return { state: params.outcome };
		} });
	t.after(() => service.dispose());
	// Review units on a real book took 24-141 s each and reported at every one: a working job speaks.
	service.runJob = async (job, signal, campaign) => {
		for (let unit = 0; unit < 8 && !signal.aborted; unit++) {
			await new Promise(resolve => setTimeout(resolve, 100));
			service.deps.record({ lane: "reading", module_id: job.module_id, campaign, job_id: job.job_id, phase: "verify", unit, ok: true });
		}
	};
	await service.prefetch("book-1", "turn-committed");
	assert.equal(rows.filter(row => row.event === "stalled").length, 0,
		"a job quiet for less than the window between reports is working, not stalled");
	assert.equal(finishes.filter(row => row.outcome === "failed").length, 0);
});
