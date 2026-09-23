/** T09 public host/queue conformance. Controlled decisions and lane replies are not gameplay. */
import { strict as assert } from "node:assert";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as settle } from "node:timers/promises";
import { test } from "node:test";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "./pi.mjs";
import { createCanonicalOperationDispatcher } from "../../extensions/kernel/canonical-operation-dispatcher.ts";
import { bindDecisionAnswers } from "../../runtime/jev/contracts.ts";
import { createTaskHostAdapter } from "../../runtime/jev/task-host-session.ts";
import { waitFor } from "./harness.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const scope = { owner: "campaign:memory-host", campaign: "memory-host", worldline: "main", loop: 0, audience: "keeper" };
const sourceRef = { version: 1, scope, resource: "turn:4:player", revision: "player-r1", sourceType: "turn",
	selector: { kind: "utf16", start: 0, end: 14 } };
const sourceSegment = { alias: "player:0", role: "player", text: "A quiet exchange.", ref: sourceRef };

class MemoryStore {
	records = new Map();
	async load(id) { return structuredClone(this.records.get(id)); }
	async list() { return [...this.records.values()].map(structuredClone); }
	async save(record) { this.records.set(record.checkpoint.context.id, structuredClone(record)); }
}

function packet(status = "open") {
	return {
		protocol: "memory-reference-v1", job_id: "extract:memory-host:t4", turn: 4, commit: "2".repeat(40), status,
		origin: { scope, revision: "memory-origin-r1" },
		step: { key: status === "done" ? "done-step" : "step-0", sequence: status === "done" ? 1 : 0,
			total: 1, remaining: status === "done" ? 0 : 1, segments: status === "done" ? [] : [sourceSegment] },
		known_entities: [], prior: [], prior_coverage: { total: 0, included: 0, omitted: 0 },
		story_sources: [sourceSegment], story_complete: true,
		...(status === "done" ? { result: { status: "done" } } : {}),
	};
}

function skip(batch) {
	const raw = Object.fromEntries(batch.questions.map(question => [question.key,
		{ status: "answered", type: "choice", choice: question.key.startsWith("retain_") ? "skip" : Object.keys(question.criteria)[0] }]));
	return bindDecisionAnswers(batch, raw, { inputTokens: 1, outputTokens: 1, costUsd: 0 });
}

function setEnv(values) {
	const previous = new Map();
	for (const [key, value] of Object.entries(values)) {
		previous.set(key, process.env[key]);
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	return () => {
		for (const [key, value] of previous) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	};
}

async function openMemoryHost(t, { decide, call, store = new MemoryStore() }) {
	const cwd = await mkdtemp(join(tmpdir(), "jev-memory-host-"));
	const provider = fauxProvider({ provider: "memory-host-provider", models: [{ id: "keeper", reasoning: false }] });
	const modelRuntime = await ModelRuntime.create({ authPath: join(cwd, "auth.json"), modelsPath: null,
		modelsStorePath: join(cwd, "models.json"), refreshOnCreate: false });
	modelRuntime.registerNativeProvider(provider.provider);
	const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
	const sessionManager = SessionManager.inMemory(cwd), controller = new AbortController();
	const ordinary = [], gateway = createCanonicalOperationDispatcher({
		async prepare() {},
		async execute(...args) { ordinary.push(args); throw new Error("memory tasks cannot enter ordinary tools"); },
		async finalize() {},
		preparedCallId() { return undefined; },
	});
	const control = { api: undefined, runMemory: undefined, callbacks: [], calls: [], ordinary };
	let session, closed = false;
	const adapter = createTaskHostAdapter(() => session, { decide }, { memoryEnabled: true, store });
	const probe = {
		name: "memory-host-probe",
		factory(pi) {
			control.api = pi;
			pi.events.on("coc:referenced-memory", value => {
				control.callbacks.push(value);
				control.runMemory = typeof value === "function" ? value : undefined;
			});
			pi.on("session_start", () => {
				pi.events.emit("coc:kernel-bridge", { campaign: scope.campaign, runtime: { home: cwd, signal: controller.signal },
					async call(method, params) { control.calls.push({ method, params: structuredClone(params) }); return call(method, params); } });
				pi.events.emit("coc:operation-dispatcher", gateway);
			});
			pi.on("session_shutdown", () => controller.abort());
		},
	};
	const loader = new DefaultResourceLoader({ cwd, agentDir: join(cwd, "agent"), settingsManager,
		extensionFactories: [probe, { name: "memory-task-host", factory: adapter.extension }] });
	await loader.reload();
	const created = await createAgentSession({ cwd, agentDir: join(cwd, "agent"), model: provider.getModel("keeper"), modelRuntime,
		thinkingLevel: "off", noTools: "builtin", resourceLoader: loader, sessionManager, settingsManager });
	session = created.session;
	const errors = [...created.extensionsResult.errors];
	await session.bindExtensions({ mode: "rpc", onError: error => errors.push(error) });
	const shutdown = async () => {
		if (closed) return;
		closed = true;
		await session._extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
	};
	t.after(async () => {
		await shutdown();
		session.dispose();
		await rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
	});
	assert.deepEqual(errors, []);
	assert.equal(typeof control.runMemory, "function");
	return { cwd, session, adapter, store, control, shutdown };
}

function ownerCall() {
	const first = packet(), done = packet("done");
	return async (method, params) => {
		if (method === "memory.job") return structuredClone(first);
		if (method === "memory.source") return { turn: 4, commit: first.commit, origin: structuredClone(first.origin) };
		if (method === "memory.submit") return { job_id: first.job_id, turn: 4, status: "done", remaining: 0,
			candidates: 0, written: [], superseded: [], next: structuredClone(done) };
		throw new Error(`unexpected host memory call ${method} ${JSON.stringify(params)}`);
	};
}

test("a later player input leaves the separately rooted memory task alive through its real host callback", async t => {
	const started = Promise.withResolvers(), release = Promise.withResolvers();
	let aborted = false, batch;
	const host = await openMemoryHost(t, {
		call: ownerCall(),
		async decide(value, lease) {
			batch = value;
			lease.signal.addEventListener("abort", () => { aborted = true; }, { once: true });
			started.resolve();
			await release.promise;
			return skip(value);
		},
	});
	const running = host.control.runMemory({ campaign: scope.campaign, turn: 4 });
	await started.promise;
	await host.session._extensionRunner.emit({ type: "input", text: "A later player input.", source: "rpc" });
	await settle(20);
	assert.equal(aborted, false, "cancelForeground must not revoke a separately rooted committed-memory task");
	release.resolve();
	const result = await running;
	const record = [...host.store.records.values()].find(value => value.checkpoint.context.kind === "committed_memory");

	assert.equal(result.status, "complete");
	assert.equal(record.result.status, "complete");
	assert.equal(record.checkpoint.context.owner, "memory");
	assert.equal(record.checkpoint.context.parentId, undefined);
	assert.ok(batch.questions.every(question => question.type === "choice"));
	assert.equal(host.control.calls.filter(row => row.method === "memory.job").length, 2,
		"the queue claim and the task-owned operation use the same kernel job owner");
	assert.equal(host.control.calls.filter(row => row.method === "memory.submit").length, 1);
	assert.ok(host.control.calls.filter(row => row.method === "memory.source").length >= 1);
	assert.equal(host.control.calls.some(row => row.method === "table.apply"), false);
	assert.equal(JSON.stringify(host.control.calls).includes("memory-host-provider"), false, "no provider/model identity reaches memory RPC");
	assert.deepEqual(host.control.ordinary, []);
});

test("shutdown leaves pending committed memory durable and a new host does not silently mint a resume lease", async t => {
	const store = new MemoryStore(), started = Promise.withResolvers();
	let observedAbort = false;
	const first = await openMemoryHost(t, {
		store, call: ownerCall(),
		decide(_batch, lease) {
			started.resolve();
			return new Promise((_resolve, reject) => lease.signal.addEventListener("abort", () => {
				observedAbort = true;
				reject(new Error("session shutdown"));
			}, { once: true }));
		},
	});
	const oldCallback = first.control.runMemory;
	const running = oldCallback({ campaign: scope.campaign, turn: 4 });
	await started.promise;
	await first.shutdown();
	const stopped = await running;
	const pending = [...store.records.values()].find(value => value.checkpoint.context.kind === "committed_memory");
	assert.equal(observedAbort, true);
	assert.equal(stopped.status, "pending");
	assert.equal(pending.result.status, "pending");
	assert.equal(pending.status, "waiting");
	assert.equal(pending.reason, "session_shutdown");
	const callsAtShutdown = first.control.calls.length;
	await assert.rejects(oldCallback({ campaign: scope.campaign, turn: 4 }), error => error?.code === "memory_owner_unavailable");
	assert.equal(first.control.calls.length, callsAtShutdown);

	const secondCalls = [];
	const second = await openMemoryHost(t, { store, decide: skip, async call(method, params) {
		secondCalls.push({ method, params });
		return ownerCall()(method, params);
	} });
	await settle(30);
	assert.deepEqual(secondCalls, [], "session startup does not silently authorize a fresh lease for retained pending work");
	assert.equal([...store.records.values()].filter(value => value.checkpoint.context.kind === "committed_memory").length, 1);
	await second.shutdown();
});

async function openMemoryLane(t, { referenced, memoryResponses = [], rpc }) {
	const cwd = await mkdtemp(join(tmpdir(), "jev-memory-lane-"));
	const restore = setEnv({ PI_COC_MODE: "play", PI_COC_HOME: cwd, PI_OFFLINE: "1", PI_COC_JEV_MEMORY: "1",
		PI_COC_MEMORY_BACKFILL: "0", PI_COC_MEMORY_MODEL: "memory-lane/m1" });
	const provider = fauxProvider({ provider: "memory-lane", models: [{ id: "m1", reasoning: false }] });
	provider.setResponses(memoryResponses);
	const modelRuntime = await ModelRuntime.create({ authPath: join(cwd, "auth.json"), modelsPath: null,
		modelsStorePath: join(cwd, "models.json"), refreshOnCreate: false });
	modelRuntime.registerNativeProvider(provider.provider);
	const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
	const calls = [], referencedCalls = [];
	let api, session;
	const loader = new DefaultResourceLoader({ cwd, agentDir: join(cwd, "agent"), settingsManager,
		additionalExtensionPaths: [join(ROOT, "extensions/memory")],
		extensionFactories: [{ name: "memory-lane-probe", factory(pi) { api = pi; } }] });
	await loader.reload();
	const created = await createAgentSession({ cwd, agentDir: join(cwd, "agent"), model: provider.getModel("m1"), modelRuntime,
		thinkingLevel: "off", noTools: "all", resourceLoader: loader, sessionManager: SessionManager.inMemory(cwd), settingsManager });
	session = created.session;
	const errors = [...created.extensionsResult.errors];
	api.events.emit("coc:kernel-bridge", { campaign: "lane-campaign", async call(method, params) {
		calls.push({ method, params: structuredClone(params) });
		return rpc(method, params);
	} });
	await session.bindExtensions({ mode: "print", onError: error => errors.push(error) });
	if (referenced) api.events.emit("coc:referenced-memory", async (job, signal) => {
		referencedCalls.push({ job: structuredClone(job), aborted: signal?.aborted });
		return referenced(job, signal);
	});
	t.after(async () => {
		await session._extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		session.dispose();
		restore();
		await rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
	});
	assert.deepEqual(errors, []);
	return {
		calls, referencedCalls,
		commit: turn => api.events.emit("coc:turn-committed", { campaign: "lane-campaign", turn }),
		rows: async () => {
			const path = join(cwd, ".coc/campaigns/lane-campaign/telemetry.jsonl");
			return existsSync(path) ? (await readFile(path, "utf8")).split("\n").filter(Boolean).map(JSON.parse).filter(row => row.lane === "memory") : [];
		},
	};
}

function legacyPacket(turn) {
	return { job_id: `extract:lane-campaign:t${turn}`, turn, commit: "legacy", scene: { name: "office", display_name: "Office" },
		present: [], investigators: [], player_text: "A committed line.", keeper_text: "A retained response.", committed_facts: [],
		known_entities: [], prior: [], budget: { max_candidates: 12, max_statement_chars: 400 }, instruction: "Return legacy candidates." };
}

test("an unavailable referenced owner leaves the queue job untouched instead of converting it to legacy", async t => {
	const table = await openMemoryLane(t, { memoryResponses: [], async rpc() { throw new Error("legacy RPC must not run"); } });
	table.commit(4);
	await waitFor(async () => (await table.rows()).length === 1, { label: "unavailable referenced owner telemetry" });
	const rows = await table.rows();
	assert.equal(rows[0].ok, false);
	assert.equal(rows[0].reason, "lane_error");
	assert.match(rows[0].detail, /owner is not ready/i);
	assert.deepEqual(table.calls, []);
});

test("the queue uses legacy extraction only after the referenced owner identifies an existing legacy job", async t => {
	const table = await openMemoryLane(t, {
		referenced: async () => ({ status: "legacy", turn: 4, job_id: "extract:lane-campaign:t4" }),
		memoryResponses: [fauxAssistantMessage(JSON.stringify({ candidates: [] }))],
		async rpc(method, params) {
			if (method === "memory.job") return legacyPacket(params.turn);
			if (method === "memory.submit") return { job_id: params.job_id, candidates: 0 };
			throw new Error(`unexpected legacy call ${method}`);
		},
	});
	table.commit(4);
	await waitFor(async () => (await table.rows()).length === 1, { label: "explicit legacy fallback telemetry" });
	assert.equal(table.referencedCalls.length, 1);
	assert.deepEqual(table.referencedCalls[0].job, { campaign: "lane-campaign", turn: 4 });
	assert.deepEqual(table.calls.map(row => [row.method, row.params.mode]), [["memory.job", undefined], ["memory.submit", undefined]]);
	assert.equal((await table.rows())[0].ok, true);
});
