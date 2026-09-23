/** Real Pi SDK lifecycle with a scripted provider, not a live-play acceptance test. */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { setImmediate as drain } from "node:timers/promises";
import { test } from "node:test";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "./pi.mjs";
import { createLaneQueue } from "../../extensions/lanes/queue.ts";
import { openTable, waitFor } from "./harness.mjs";

function gate(t) {
	const { promise, resolve } = Promise.withResolvers();
	t.after(resolve);
	return { promise, open: resolve };
}

async function fixture(t, install) {
	const parent = join(process.cwd(), ".pi/agent");
	mkdirSync(parent, { recursive: true });
	const cwd = mkdtempSync(join(parent, "lifecycle-test-"));
	const faux = fauxProvider();
	faux.setResponses([fauxAssistantMessage("First response"), fauxAssistantMessage("Next response")]);
	const modelRuntime = await ModelRuntime.create({ authPath: join(cwd, "auth.json"), modelsPath: null,
		modelsStorePath: join(cwd, "models-store.json"), refreshOnCreate: false });
	modelRuntime.registerNativeProvider(faux.provider);
	const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: "off" });
	let api;
	const loader = new DefaultResourceLoader({ cwd, agentDir: cwd, settingsManager,
		noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
		agentsFilesOverride: () => ({ agentsFiles: [] }),
		extensionFactories: [(pi) => { api = pi; install(pi); }] });
	await loader.reload();
	const { session, extensionsResult } = await createAgentSession({ cwd, agentDir: cwd, modelRuntime,
		model: faux.getModel(), settingsManager, resourceLoader: loader, tools: [],
		sessionManager: SessionManager.inMemory(cwd) });
	const errors = [...extensionsResult.errors];
	await session.bindExtensions({ mode: "print", onError: error => errors.push(error) });
	t.after(async () => {
		// SDK dispose does not dispatch shutdown; runtime modes dispatch it through the runner.
		await session._extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		session.dispose();
		rmSync(cwd, { recursive: true, force: true });
		assert.deepEqual(errors, []);
	});
	t.diagnostic(`Pi SDK ${JSON.parse(readFileSync(new URL("../../build/node_modules/@earendil-works/pi-coding-agent/package.json", import.meta.url))).version}`);
	return { session, api };
}

for (const phase of ["input", "before_agent_start"]) {
	test(`settled continuation reserves foreground through asynchronous ${phase}`, { timeout: 15000 }, async (t) => {
		const entered = gate(t), release = gate(t), finished = gate(t);
		const jobs = [], activities = [];
		let starts = 0, settles = 0;
		const { session } = await fixture(t, pi => {
			// The kernel is registered before lane queues, including its asynchronous preflight.
			pi.on(phase, async (event, ctx) => {
				if ((event.text ?? event.prompt) !== "next input") return;
				activities.push({ idle: ctx.isIdle(), pending: ctx.hasPendingMessages() });
				entered.open();
				await release.promise;
			});
			pi.on("agent_start", () => { starts++; });
			pi.on("agent_settled", () => {
				if (++settles === 1) {
					pi.events.emit("coc:foreground-pending", {});
					pi.sendUserMessage("next input");
				} else finished.open();
			});
			createLaneQueue(pi, { backfillEnv: "PI_COC_LIFECYCLE_UNUSED", backfillDefault: 1,
				runJob: async job => { jobs.push({ ...job, starts, settles }); }, onError: async (_job, error) => { throw error; } });
			pi.on("agent_start", () => {
				if (starts === 1) pi.events.emit("coc:kernel-bridge", { campaign: "camp", call: async () => ({}) });
			});
		});
		const run = session.prompt("first input");
		t.after(async () => { release.open(); await run; });
		await entered.promise;
		await drain();
		assert.deepEqual(activities, [{ idle: true, pending: false }], "public activity checks do not cover deferred prompt preflight");
		assert.deepEqual(jobs, [], "backfill must not start before the reserved foreground prompt reaches agent_start");
		release.open();
		await finished.promise;
		await run;
		await drain();
		assert.deepEqual(jobs, [{ campaign: "camp", backfill: true, starts: 2, settles: 2 }]);
	});
}

test("handled or refused preflight keeps the reservation until the next successful start", { timeout: 15000 }, async (t) => {
	const jobs = [];
	let starts = 0, settles = 0;
	const { session } = await fixture(t, pi => {
		pi.on("input", event => {
			if (event.text === "handled input") return { action: "handled" };
		});
		pi.on("agent_start", () => { starts++; });
		pi.on("agent_settled", () => {
			if (++settles === 1) {
				pi.events.emit("coc:foreground-pending", {});
				pi.sendUserMessage("handled input");
			}
		});
		createLaneQueue(pi, { backfillEnv: "PI_COC_LIFECYCLE_UNUSED", backfillDefault: 1,
			runJob: async job => { jobs.push({ ...job, starts, settles }); }, onError: async (_job, error) => { throw error; } });
		pi.on("agent_start", () => {
			if (starts === 1) pi.events.emit("coc:kernel-bridge", { campaign: "camp", call: async () => ({}) });
		});
	});
	await session.prompt("first input");
	assert.equal(starts, 1);
	assert.deepEqual(jobs, [], "a handled deferred prompt never reaches agent_start, so backfill stays reserved");
	session._compactionAbortController = new AbortController();
	try {
		await assert.rejects(session.prompt("refused input"), /compaction is in progress/);
	} finally {
		session._compactionAbortController = undefined;
	}
	assert.equal(starts, 1);
	assert.deepEqual(jobs, [], "a refused preflight is not a successful start and must not clear the reservation");
	await session.prompt("real input");
	assert.deepEqual(jobs, [{ campaign: "camp", backfill: true, starts: 2, settles: 2 }]);
});

test("real SDK queues retain committed FIFO, independent lanes and shutdown cancellation", { timeout: 15000 }, async (t) => {
	const held = gate(t), first = [], second = [];
	let one, two;
	const { session, api } = await fixture(t, pi => {
		one = createLaneQueue(pi, { backfillEnv: "PI_COC_LIFECYCLE_UNUSED", backfillDefault: 0,
			runJob: async job => { first.push(job.turn); if (job.turn === 1) await held.promise; }, onError: async () => {} });
		two = createLaneQueue(pi, { backfillEnv: "PI_COC_LIFECYCLE_UNUSED", backfillDefault: 0,
			runJob: async job => { second.push(job.turn); }, onError: async () => {} });
	});
	api.events.emit("coc:foreground-pending", {});
	for (const turn of [1, 2]) api.events.emit("coc:turn-committed", { campaign: "camp", turn });
	await drain();
	assert.deepEqual(first, [1]);
	assert.deepEqual(second, [1, 2], "a held lane cannot serialize an independent lane");
	held.open();
	await drain();
	assert.deepEqual(first, [1, 2], "foreground reservation does not suppress committed FIFO");
	assert.notEqual(one.signal, two.signal);
	await session._extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
	assert.equal(one.signal.aborted, true);
	assert.equal(two.signal.aborted, true);
	api.events.emit("coc:turn-committed", { campaign: "camp", turn: 3 });
	api.events.emit("coc:kernel-bridge", { campaign: "camp", call: async () => ({}) });
	await drain();
	assert.deepEqual(first, [1, 2]);
	assert.deepEqual(second, [1, 2]);
});

function textOf(message) {
	return Array.isArray(message?.content) ? message.content.map(part => part.text ?? "").join("") : "";
}

test("production kernel reserves foreground when replaying input queued during opening", { timeout: 20000 }, async (t) => {
	const original = EventEmitter.prototype.emit;
	const log = [];
	let bus;
	EventEmitter.prototype.emit = function(type, ...args) {
		if (type === "coc:lifecycle-bus-probe") bus = this;
		if (type === "coc:foreground-pending") log.push({ emitter: this, item: "foreground-pending", payload: args[0] });
		return original.call(this, type, ...args);
	};
	t.after(() => { EventEmitter.prototype.emit = original; });
	const table = await openTable({ env: { FAKE_KERNEL_OPENING: "1" }, responses: [
		fauxAssistantMessage([fauxToolCall("narrate", { text: "The door stands open." })], { stopReason: "toolUse" }),
		fauxAssistantMessage("The door stands open."),
		fauxAssistantMessage([fauxToolCall("narrate", { text: "You enter the house." })], { stopReason: "toolUse" }),
		fauxAssistantMessage("You enter the house."),
	] });
	t.after(() => table.dispose());
	table.session.subscribe(event => {
		if (event.type === "agent_start" || event.type === "agent_settled") log.push({ session: true, item: event.type });
		if (event.type === "message_end" && event.message?.role === "user") log.push({ session: true, item: `user:${textOf(event.message)}` });
	});
	table.emit("coc:lifecycle-bus-probe");
	assert.ok(bus, "the harness probe shares the kernel extension bus");
	const replay = () => {
		const entries = log.filter(entry => entry.session || entry.emitter === bus);
		const trace = entries.map(entry => entry.item);
		const reserved = entries.filter(entry => entry.item === "foreground-pending");
		const replayAt = trace.indexOf("user:I enter the house.");
		const startAfter = replayAt < 0 ? -1 : trace.indexOf("agent_start", replayAt);
		const inputs = table.kernelRequests().filter(request => request.method === "table.player_input");
		return reserved.length === 1 && reserved[0].payload && Object.keys(reserved[0].payload).length === 0
			&& replayAt > trace.indexOf("foreground-pending") && startAfter > replayAt
			&& inputs.length === 1 && inputs[0].params.text === "I enter the house."
			? { reserved, inputs } : undefined;
	};
	await table.session.prompt("I enter the house.", { streamingBehavior: "followUp" });
	const observed = await waitFor(replay, { timeoutMs: 15_000, label: "replay agent_start after the kernel reservation" });
	assert.equal(observed.reserved.length, 1, "the kernel, not this test, emits the reservation");
	assert.deepEqual(observed.reserved[0].payload, {});
	assert.equal(observed.inputs.length, 1);
	assert.equal(observed.inputs[0].params.text, "I enter the house.");
	const trace = log.filter(entry => entry.session || entry.emitter === bus).map(entry => entry.item);
	const replayAt = trace.indexOf("user:I enter the house.");
	assert.ok(replayAt > trace.indexOf("foreground-pending"), "reservation precedes the deferred replay");
	assert.ok(trace.indexOf("agent_start", replayAt) > replayAt, "replay reaches the agent only after that reservation");
});
