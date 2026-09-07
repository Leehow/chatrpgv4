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
	assert.deepEqual(calls.map(c => c.method), ["module.status"]);
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
