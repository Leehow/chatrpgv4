import { strict as assert } from "node:assert";
import { afterEach, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import {
	createAgentSession,
	createAgentSessionRuntime,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "./pi.mjs";
import { Type } from "typebox";
import { createS0HostAdapter } from "../../runtime/jev/host-session-adapter.ts";

const temporary = [];
afterEach(async () => {
	await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

const submission = {
	goal: "Find the recent player statement.",
	subgoals: ["List recent statements.", "Read the selected original."],
	constraints: ["Read only."],
	evidenceRequired: ["Original transcript page."],
	completion: ["Return an explicit bounded result."],
	capabilities: ["recall"],
	replanWhen: [],
	returnWhen: ["The selected original was read."],
};

async function workspace() {
	const path = await mkdtemp(join(tmpdir(), "jev-s0-sdk-"));
	temporary.push(path);
	return path;
}

function fixtureTools(log) {
	return {
		name: "s0-fixture-tools",
		factory(pi) {
			pi.registerTool({
				name: "recall",
				label: "Recall",
				description: "Fixture transcript reader.",
				parameters: Type.Object({
					what: Type.String(),
					role: Type.Optional(Type.String()),
					read: Type.Optional(Type.Any()),
				}),
				executionMode: "sequential",
				async execute(id, args, signal) {
					log.executed.push({ id, args: structuredClone(args), aborted: signal?.aborted ?? false });
					if (args.read) return {
						content: [{ type: "text", text: "original transcript" }],
						details: { text: "The original player statement.", verified: true },
					};
					return {
						content: [{ type: "text", text: "listing" }],
						details: {
							cards: [{ head: "I asked about the clinic.", role: "player", read: {
								what: "transcript", read: { turn: 1, role: "player" },
							} }],
						},
					};
				},
			});
			pi.registerTool({
				name: "narrate",
				label: "Narrate",
				description: "Fixture writer route.",
				parameters: Type.Object({ text: Type.String() }),
				executionMode: "sequential",
				async execute(id, args) {
					log.executed.push({ id, args: structuredClone(args), writer: true });
					return { content: [{ type: "text", text: args.text }], details: { rendered_text: args.text }, terminate: true };
				},
			});
			pi.registerTool({
				name: "ask",
				label: "Ask",
				description: "Fixture writer route.",
				parameters: Type.Object({ kind: Type.String() }),
				async execute(id, args) { return { content: [], details: { rendered_text: args.kind } }; },
			});
			pi.on("tool_call", event => log.calls.push({ name: event.toolName, id: event.toolCallId }));
			pi.on("tool_result", event => log.results.push({ name: event.toolName, id: event.toolCallId, isError: event.isError }));
			// The production implicit-return path emits this canonical committed-turn bus event
			// after it has a kernel commit. This fixture supplies only the adapter-consumer seam.
			log.implicitReturn = () => pi.events.emit("coc:turn-committed", {
				campaign: "fixture",
				turn: 1,
				rendered_text: "Fixture implicit return.",
				commit: "fixture-commit",
			});
		},
	};
}

async function createS0Fixture({ decide, responses, adapterOptions }) {
	const cwd = await workspace();
	const faux = fauxProvider({ provider: "fixture-keeper", models: [{ id: "keeper", reasoning: false }] });
	faux.setResponses(responses);
	const modelRuntime = await ModelRuntime.create({
		authPath: join(cwd, "auth.json"), modelsPath: null, modelsStorePath: join(cwd, "models.json"), refreshOnCreate: false,
	});
	modelRuntime.registerNativeProvider(faux.provider);
	const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
	const log = { calls: [], results: [], executed: [] };
	let session;
	const adapter = createS0HostAdapter(() => session, decide, adapterOptions);
	const loader = new DefaultResourceLoader({
		cwd, agentDir: join(cwd, "agent"), settingsManager,
		extensionFactories: [fixtureTools(log), { name: "jev-s0", factory: adapter.extension }],
	});
	await loader.reload();
	const created = await createAgentSession({
		cwd, agentDir: join(cwd, "agent"), model: faux.getModel(), modelRuntime,
		thinkingLevel: "off", noTools: "builtin", resourceLoader: loader,
		sessionManager: SessionManager.inMemory(cwd), settingsManager,
	});
	session = created.session;
	await session.bindExtensions({ mode: "rpc" });
	return { session, adapter, faux, log };
}

test("S0 uses real public hooks and wrapped recall inside a real planner/writer session without exposing nested ids", async () => {
	const decisions = [];
	const decide = async request => {
		decisions.push({ criteria: structuredClone(request.criteria), aborted: request.signal.aborted });
		const choice = decisions.length === 1 ? "player" : decisions.length === 2 ? "record_0" : "supported";
		return { choice, usage: { inputTokens: 3, outputTokens: 1 }, elapsedMs: 1, model: "jev-1.13.0" };
	};
	const table = await createS0Fixture({
		decide,
		responses: [
			fauxAssistantMessage([fauxToolCall("submit_plan_packet", submission)], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "The record is bounded." })], { stopReason: "toolUse" }),
		],
	});
	assert.equal(table.adapter.status().phase, "passthrough");
	await table.session.prompt("What did I say?", { source: "rpc" });
	assert.equal(table.adapter.status().phase, "delivered");
	assert.equal(decisions.length, 3);
	assert.deepEqual(decisions.map(row => row.aborted), [false, false, false]);
	assert.deepEqual(table.log.executed.filter(row => !row.writer).map(row => row.args.what), ["transcript", "transcript"]);
	const nested = table.log.calls.filter(row => row.name === "recall");
	assert.equal(nested.length, 2);
	assert.ok(nested.every(row => row.id.startsWith("jev-read-")));
	assert.deepEqual(table.log.results.filter(row => row.name === "recall").map(row => row.isError), [false, false]);
	assert.equal(table.log.executed.some(row => row.args.what === "resolve" || row.args.what === "apply"), false);

	const assistantCalls = table.session.messages
		.filter(message => message.role === "assistant")
		.flatMap(message => message.content.filter(block => block.type === "toolCall").map(block => ({ name: block.name, id: block.id })));
	assert.deepEqual(assistantCalls.map(call => call.name), ["submit_plan_packet", "narrate"]);
	assert.equal(assistantCalls.some(call => call.id.startsWith("jev-read-")), false);
	const visible = JSON.stringify(table.session.messages);
	assert.equal(visible.includes("jev-read-"), false);
	assert.equal(visible.includes("grok"), false);
	assert.equal(table.faux.state.callCount, 2, "only planner and writer call the faux Keeper");
	const trace = table.session.sessionManager.getEntries()
		.filter(entry => entry.type === "custom" && entry.customType === "coc-jev-s0")
		.map(entry => entry.data);
	assert.ok(trace.some(row => row.kind === "session-bound" && row.model.provider === "fixture-keeper"));
	assert.equal(trace.filter(row => row.kind === "jev-usage").length, 3);
	assert.ok(trace.filter(row => row.kind === "jev-usage").every(row => row.model === "jev-1.13.0"));
	assert.ok(trace.some(row => row.kind === "keeper-usage" && row.provider === "fixture-keeper"));
	assert.ok(trace.some(row => row.kind === "task-result" && Array.isArray(row.operations) && row.operations.length === 2));
});

test("a new player input aborts owned S0 decision work and no nested read or writer follows", async () => {
	let decisionStarted;
	let observedAbort = false;
	const decide = request => new Promise((resolve, reject) => {
		decisionStarted?.();
		request.signal.addEventListener("abort", () => {
			observedAbort = true;
			reject(new Error("aborted by replacement input"));
		}, { once: true });
	});
	const table = await createS0Fixture({
		decide,
		responses: [fauxAssistantMessage([fauxToolCall("submit_plan_packet", submission)], { stopReason: "toolUse" })],
	});
	const started = new Promise(resolve => { decisionStarted = resolve; });
	const running = table.session.prompt("First question", { source: "rpc" });
	await started;
	await table.session.prompt("Replacement question", { source: "rpc", streamingBehavior: "steer" });
	await running;
	assert.equal(observedAbort, true);
	assert.equal(table.adapter.status().phase, "cancelled");
	assert.equal(table.log.executed.some(row => !row.writer), false);
	assert.equal(table.log.executed.some(row => row.writer), false);
});

test("S0 deadline aborts a delayed faux writer after bounded reads without late delivery", async () => {
	let choices = 0;
	const table = await createS0Fixture({
		adapterOptions: { deadlineMs: 100 },
		decide: async request => ({
			choice: ++choices === 1 ? "player" : choices === 2 ? "record_0" : "supported",
			usage: { inputTokens: 1, outputTokens: 1 },
			elapsedMs: 0,
			model: "jev-1.13.0",
		}),
		responses: [
			fauxAssistantMessage([fauxToolCall("submit_plan_packet", submission)], { stopReason: "toolUse" }),
			async () => {
				await new Promise(resolve => setTimeout(resolve, 250));
				return fauxAssistantMessage([fauxToolCall("narrate", { text: "too late" })], { stopReason: "toolUse" });
			},
		],
	});
	await table.session.prompt("Deadline test", { source: "rpc" });
	assert.equal(choices, 3);
	assert.equal(table.adapter.status().phase, "cancelled");
	assert.equal(table.log.executed.some(row => row.writer), false);
	assert.equal(table.log.executed.filter(row => !row.writer).length, 2);
});

test("canonical implicit committed-turn event delivers S0 composing phase and clears its deadline without narrate", async () => {
	let choices = 0;
	let writerStarted;
	const writerPending = new Promise(resolve => { writerStarted = resolve; });
	const table = await createS0Fixture({
		adapterOptions: { deadlineMs: 100 },
		decide: async () => ({
			choice: ++choices === 1 ? "player" : choices === 2 ? "record_0" : "supported",
			usage: { inputTokens: 1, outputTokens: 1 },
			elapsedMs: 0,
			model: "jev-1.13.0",
		}),
		responses: [
			fauxAssistantMessage([fauxToolCall("submit_plan_packet", submission)], { stopReason: "toolUse" }),
			async () => {
				writerStarted();
				await new Promise(resolve => setTimeout(resolve, 150));
				return fauxAssistantMessage("Fixture writer ended without a delivery tool.");
			},
		],
	});
	const running = table.session.prompt("Implicit delivery test", { source: "rpc" });
	await writerPending;
	assert.equal(table.adapter.status().phase, "composing");
	table.log.implicitReturn();
	assert.equal(table.adapter.status().phase, "delivered");
	await running;
	await new Promise(resolve => setTimeout(resolve, 120));
	assert.equal(table.adapter.status().phase, "delivered");
	assert.equal(table.log.executed.some(row => row.writer), false);
});

test("a mismatched actual assistant identity blocks the tool path while the selected Keeper model remains unchanged", async () => {
	const table = await createS0Fixture({
		decide: async () => ({ choice: "player", usage: { inputTokens: 1, outputTokens: 1 }, elapsedMs: 0, model: "jev-1.13.0" }),
		responses: [],
	});
	const wrong = {
		role: "assistant",
		content: [{ type: "toolCall", id: "wrong-call", name: "narrate", arguments: { text: "forged" } }],
		provider: "wrong-provider",
		model: "wrong-model",
		api: "fixture",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		stopReason: "toolUse",
		timestamp: Date.now(),
	};
	table.session.agent.state.messages.push(wrong);
	const block = await table.session.agent.beforeToolCall({
		assistantMessage: wrong,
		toolCall: wrong.content[0],
		args: { text: "forged" },
		context: { systemPrompt: table.session.agent.state.systemPrompt, messages: table.session.messages, tools: table.session.agent.state.tools },
	});
	assert.equal(table.session.model.provider, "fixture-keeper");
	assert.equal(table.session.model.id, "keeper");
	assert.equal(block.block, true);
	assert.equal(block.terminate, true);
	assert.equal(table.log.executed.length, 0);
});

test("public AgentSessionRuntime rebuilds fresh factory state for new, switch, and fork", async () => {
	const cwd = await workspace();
	const faux = fauxProvider({ provider: "lifecycle-keeper", models: [{ id: "keeper", reasoning: false }] });
	faux.setResponses([fauxAssistantMessage("seed")]);
	const runtimeModel = await ModelRuntime.create({
		authPath: join(cwd, "auth.json"), modelsPath: null, modelsStorePath: join(cwd, "models.json"), refreshOnCreate: false,
	});
	runtimeModel.registerNativeProvider(faux.provider);
	const starts = [];
	const adapters = [];
	const lifecycleLog = { calls: [], results: [], executed: [] };
	let serial = 0;
	const factory = async ({ cwd: sessionCwd, agentDir, sessionManager, sessionStartEvent }) => {
		const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
		let session;
		const adapter = createS0HostAdapter(() => session, async request => ({
			choice: Object.keys(request.criteria)[0],
			usage: { inputTokens: 1, outputTokens: 1 },
			elapsedMs: 0,
			model: "jev-1.13.0",
		}));
		adapters.push(adapter);
		const loader = new DefaultResourceLoader({
			cwd: sessionCwd, agentDir, settingsManager,
			extensionFactories: [fixtureTools(lifecycleLog), { name: "jev-s0", factory: adapter.extension }, { name: "lifecycle", factory: pi => {
				const instance = ++serial;
				pi.on("session_start", event => starts.push({ instance, reason: event.reason }));
			} }],
		});
		await loader.reload();
		const result = await createAgentSession({
			cwd: sessionCwd, agentDir, model: faux.getModel(), modelRuntime: runtimeModel,
			thinkingLevel: "off", noTools: "builtin", resourceLoader: loader, sessionManager, settingsManager, sessionStartEvent,
		});
		session = result.session;
		await result.session.bindExtensions({ mode: "rpc" });
		return { ...result, services: { cwd: sessionCwd, agentDir }, diagnostics: [] };
	};
	const manager = SessionManager.create(cwd, join(cwd, "sessions"));
	const runtime = await createAgentSessionRuntime(factory, { cwd, agentDir: join(cwd, "agent"), sessionManager: manager });
	const initial = runtime.session;
	assert.equal(adapters[0].status().phase, "passthrough");
	assert.ok(runtime.session.getActiveToolNames().includes("recall"));
	assert.ok(runtime.session.getActiveToolNames().includes("submit_plan_packet"));
	await runtime.session.prompt("seed", { source: "rpc" });
	const sessionFile = runtime.session.sessionFile;
	assert.ok(sessionFile);
	const user = runtime.session.sessionManager.getEntries().find(entry => entry.type === "message" && entry.message.role === "user");
	assert.ok(user);
	assert.equal((await runtime.newSession()).cancelled, false);
	assert.notEqual(runtime.session, initial);
	assert.equal((await runtime.switchSession(sessionFile)).cancelled, false);
	assert.equal((await runtime.fork(user.id)).cancelled, false);
	assert.ok(starts.some(row => row.reason === "startup"));
	assert.ok(starts.some(row => row.reason === "new"));
	assert.ok(starts.some(row => row.reason === "resume"));
	assert.ok(starts.some(row => row.reason === "fork"));
	assert.equal(adapters.length, 4);
	assert.ok(adapters.slice(1).every(adapter => adapter.status().phase === "passthrough"));
	await runtime.dispose();
});
