import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReadingService } from "../../extensions/module/reading-service.ts";

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
