import assert from "node:assert/strict";
import { test } from "node:test";
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

test("an unavailable original PDF reports bad_pdf before registering source work", async t => {
	const calls = [];
	const service = new ReadingService({ home: "/unused", model: () => ({ id: "fixture/vision", vision: true }),
		progress() {}, record() {}, async call(method) { calls.push(method); throw new Error("no source should be registered"); } });
	t.after(() => service.dispose());
	await assert.rejects(service.prepare({ pdf: "missing-original.pdf" }), e => e.details?.reason === "bad_pdf" && e.fix.includes("original PDF"));
	assert.deepEqual(calls, []);
});
