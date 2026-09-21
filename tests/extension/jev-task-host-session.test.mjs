import { strict as assert } from "node:assert";
import { afterEach, test } from "node:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
} from "@earendil-works/pi-coding-agent";
import kernelExtension from "../../extensions/kernel/index.ts";
import { createTaskHostAdapter } from "../../runtime/jev/task-host-session.ts";
import { FAKE_KERNEL, waitForIdle } from "./harness.mjs";

const temporary = [];

afterEach(async () => {
	await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

class MemoryStore {
	records = new Map();
	async load(id) { return structuredClone(this.records.get(id)); }
	async save(record) { this.records.set(record.checkpoint.context.id, structuredClone(record)); }
}

async function workspace(prefix = "jev-task-host-") {
	const path = await mkdtemp(join(tmpdir(), prefix));
	temporary.push(path);
	return path;
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

const plan = {
	goal: "Read the investigator record, then answer from the actual observation.",
	subgoals: ["Inspect the canonical investigator view."],
	constraints: ["Read only."],
	evidenceRequired: ["The canonical investigator observation."],
	completion: ["The response is supported by the observation."],
	capabilities: ["look"],
	replanWhen: [],
	returnWhen: ["The evidence is sufficient."],
};

function answer(batch, choice, support, nextWeights = {}) {
	const answers = Object.fromEntries(batch.questions.map(question => {
		const selected = question.key === "next" ? choice : support;
		const weights = question.key === "next" && Object.keys(nextWeights).length ? nextWeights : { [selected]: 1 };
		return [question.key, {
			status: "answered",
			type: "choice",
			choice: selected,
			probabilities: Object.fromEntries(Object.keys(question.criteria).map(key => [key, weights[key] ?? 0])),
		}];
	}));
	const required = batch.questions.map(question => question.key);
	return {
		batchId: batch.id,
		status: "complete",
		answers,
		coverage: { required, answered: required, unknown: [] },
		issues: [],
		usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
	};
}

function kernelProbe(control) {
	return {
		name: "task-host-kernel-probe",
		factory(pi) {
			control.api = pi;
			const wrapped = new WeakSet();
			pi.events.on("coc:kernel-bridge", value => {
				if (!value?.call) return;
				control.bridge = value;
				if (wrapped.has(value)) return;
				wrapped.add(value);
				const original = value.call.bind(value);
				value.call = async (method, params) => {
					const result = await original(method, params);
					const context = result?._context ?? result?.capsule?._context;
					if (context && typeof context === "object") result._context = { ...structuredClone(context), world_revision: control.worldRevision };
					return result;
				};
			});
			pi.events.on("coc:operation-dispatcher", value => { control.dispatcher = value; });
			pi.events.on("coc:task-receipt-tracking", value => control.receiptTracking.push(value));
			pi.events.on("coc:capsule", value => {
				const context = value?.context ?? value?.capsule?._context;
				if (context && typeof context === "object") value.context = { ...structuredClone(context), world_revision: control.worldRevision };
				control.capsules.push(structuredClone(value));
			});
			pi.on("tool_call", event => control.hooks.push({ type: "tool_call", id: event.toolCallId, name: event.toolName }));
			pi.on("tool_result", event => control.hooks.push({ type: "tool_result", id: event.toolCallId, name: event.toolName, isError: event.isError }));
			pi.on("session_start", () => {
				if (control.mods) pi.events.emit("coc:mods-bridge", control.mods(control));
			});
		},
	};
}

async function createKernelHost(t, { responses, decide, deadlineMs = 30_000, campaign = "task-host", mods }) {
	const cwd = await mkdtemp(join(tmpdir(), "jev-task-host-"));
	const requestLog = join(cwd, "kernel-requests.jsonl");
	const hiddenCredentials = Object.fromEntries(Object.keys(process.env)
		.filter(key => /(_API_KEY|_TOKEN|_SECRET)$/.test(key)).map(key => [key, undefined]));
	const restoreEnv = setEnv({
		...hiddenCredentials,
		PI_COC_KERNEL_CMD: JSON.stringify([process.execPath, FAKE_KERNEL]),
		PI_COC_CAMPAIGN: campaign,
		PI_COC_MODE: "play",
		PI_COC_MEMORY_BACKFILL: "0",
		PI_COC_MODS_WAIT_MS: "0",
		PI_OFFLINE: "1",
		FAKE_KERNEL_LOG: requestLog,
		FAKE_KERNEL_WORKSPACE: "1",
	});
	const faux = fauxProvider({
		provider: "task-keeper",
		models: [{ id: "keeper", reasoning: false }, { id: "replacement", reasoning: false }],
	});
	faux.setResponses(responses);
	const modelRuntime = await ModelRuntime.create({
		authPath: join(cwd, "auth.json"), modelsPath: null, modelsStorePath: join(cwd, "models.json"), refreshOnCreate: false,
	});
	modelRuntime.registerNativeProvider(faux.provider);
	const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
	const sessionManager = SessionManager.inMemory(cwd);
	const store = new MemoryStore();
	const control = { worldRevision: "world-r1", capsules: [], hooks: [], receiptTracking: [],
		bridge: undefined, dispatcher: undefined, api: undefined, mods };
	let session;
	const decision = { decide };
	const adapter = createTaskHostAdapter(() => session, decision, { deadlineMs, store });
	const loader = new DefaultResourceLoader({
		cwd,
		agentDir: join(cwd, "agent"),
		settingsManager,
		extensionFactories: [kernelProbe(control), { name: "coc-kernel", factory: kernelExtension },
			{ name: "jev-task-private-role", factory: adapter.extension }],
	});
	await loader.reload();
	const created = await createAgentSession({
		cwd,
		agentDir: join(cwd, "agent"),
		model: faux.getModel("keeper"),
		modelRuntime,
		thinkingLevel: "off",
		noTools: "builtin",
		resourceLoader: loader,
		sessionManager,
		settingsManager,
	});
	session = created.session;
	const extensionErrors = [...created.extensionsResult.errors];
	await session.bindExtensions({
		mode: "rpc",
		onError: error => extensionErrors.push({ path: error.extensionPath, error: error.error }),
	});
	const dispose = async () => {
		try {
			const runner = session._extensionRunner;
			if (runner?.hasHandlers?.("session_shutdown")) await runner.emit({ type: "session_shutdown", reason: "quit" });
			session.dispose();
		} finally {
			restoreEnv();
			await new Promise(resolve => setTimeout(resolve, 50));
			await rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
		}
	};
	t.after(dispose);
	return {
		cwd,
		faux,
		session,
		adapter,
		store,
		control,
		extensionErrors,
		taskEntries: () => sessionManager.getEntries().filter(entry => entry.type === "custom" && entry.customType === "coc-task-runtime").map(entry => entry.data),
		async kernelRequests() {
			if (!existsSync(requestLog)) return [];
			return (await readFile(requestLog, "utf8")).split("\n").filter(Boolean).map(line => JSON.parse(line));
		},
	};
}

test("private plan executes one real guarded look before the dependent decision and ordinary explicit delivery", async t => {
	const batches = [];
	const table = await createKernelHost(t, {
		responses: [
			fauxAssistantMessage([fauxToolCall("submit_plan_packet", plan)], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "The investigator record supports the answer." })], { stopReason: "toolUse" }),
		],
		async decide(batch, lease) {
			batches.push({ batch: structuredClone(batch), aborted: lease.signal.aborted });
			return batches.length === 1
				? answer(batch, "complete", "needs_more", { candidate_0: 0.4, complete: 0.6 })
				: answer(batch, "complete", "sufficient");
		},
	});
	await table.session.prompt("What does my investigator record establish?", { source: "rpc" });

	const status = table.adapter.status();
	const requests = await table.kernelRequests();
	assert.ok(status.task, JSON.stringify({ extensionErrors: table.extensionErrors, hooks: table.control.hooks,
		capsules: table.control.capsules, messages: table.session.messages }));
	assert.equal(status.task.status, "closed");
	assert.equal(status.task.phase, "terminal");
	assert.equal(status.task.reason, "delivered");
	assert.equal(batches.length, 2);
	assert.ok(batches.every(row => row.batch.familyVersion === "2"));
	assert.ok(batches.every(row => row.batch.questions.slice(1).every(question => question.type === "choice"
		&& Object.keys(question.criteria).join(",") === "sufficient,needs_more,unavailable")));
	assert.deepEqual(batches.map(row => row.aborted), [false, false]);
	assert.equal(batches[1].batch.state.observations.length, 1);
	assert.equal(batches[1].batch.state.observations[0].status, "succeeded");
	assert.equal(status.task.observations.length, 1);
	assert.equal(status.task.observations[0].proposal.operation, "look");
	assert.equal(requests.filter(row => row.method === "table.look").length, 1);
	assert.equal(requests.filter(row => row.method === "table.narrate").length, 1);
	assert.deepEqual(table.control.hooks.filter(row => row.id === status.task.observations[0].proposal.id).map(row => row.type), ["tool_call", "tool_result"]);
	const visibleCalls = table.session.messages.filter(message => message.role === "assistant")
		.flatMap(message => message.content.filter(block => block.type === "toolCall").map(block => block.name));
	assert.deepEqual(visibleCalls, ["submit_plan_packet", "narrate"]);
	assert.deepEqual(table.extensionErrors, []);
});

for (const delivery of ["explicit", "implicit"]) {
	test(`ordinary ${delivery} direct draft reaches the guarded writer with zero Jev calls`, async t => {
		let decisions = 0;
		const response = delivery === "explicit"
			? fauxAssistantMessage([fauxToolCall("narrate", { text: "The current capsule already answers this." })], { stopReason: "toolUse" })
			: fauxAssistantMessage("The current capsule already answers this without a tool call.");
		const table = await createKernelHost(t, {
			responses: [response],
			async decide() { decisions++; throw new Error("direct draft must not invoke Jev"); },
		});
		await table.session.prompt(`Use the ${delivery} direct path.`, { source: "rpc" });

		const status = table.adapter.status();
		const requests = await table.kernelRequests();
		assert.ok(status.task, JSON.stringify({ extensionErrors: table.extensionErrors, hooks: table.control.hooks,
			capsules: table.control.capsules, messages: table.session.messages }));
		assert.equal(decisions, 0);
		assert.equal(status.task.status, "closed");
		assert.equal(status.task.phase, "terminal");
		assert.equal(status.task.reason, "delivered");
		assert.equal(status.task.decisions.length, 0);
		assert.equal(status.task.observations.length, 0);
		assert.equal(requests.filter(row => row.method === "table.narrate").length, 1);
		assert.ok(table.control.receiptTracking.includes(true));
		assert.deepEqual(table.extensionErrors, []);
	});
}

test("the bounded Keeper request reserves budget and caps its configured output at 8192", async t => {
	const table = await createKernelHost(t, { responses: [], async decide() { throw new Error("budget hook must not decide"); } });
	const runner = table.session._extensionRunner;
	await runner.emit({ type: "input", text: "Prepare a bounded direct response.", source: "rpc" });
	await runner.emit({ type: "before_agent_start", prompt: "Prepare a bounded direct response.", systemPrompt: "fixture", systemPromptOptions: {} });
	const before = table.adapter.status().task.checkpoint.context.budget;
	await runner.emit({
		type: "before_provider_request",
		payload: { model: "keeper", messages: [{ role: "user", content: "bounded" }], max_tokens: 20_000 },
	});
	const after = table.adapter.status().task.checkpoint.context.budget;
	const reservation = table.taskEntries().filter(row => row.kind === "keeper-reservation").at(-1);

	assert.equal(reservation.outputTokens, 8192);
	assert.equal(before.remainingActions - after.remainingActions, 1);
	assert.equal(before.remainingOutputTokens - after.remainingOutputTokens, 8192);
});

function deferredRegistration(variant) {
	return control => ({
		async after() {},
		async prepare(method) {
			if (method !== "narrate") return;
			const before = control.worldRevision;
			const callId = control.bridge.mintCallId();
			const applied = await control.bridge.call("table.apply", {
				campaign: control.bridge.campaign,
				call_id: callId,
				_task_read_set: true,
				effects: [{ kind: "time", minutes: 5, why: "complete one deferred Mod registration" }],
			});
			control.worldRevision = "world-r2";
			const event = {
				campaign: control.bridge.campaign,
				turn: 1,
				worldline: "main",
				loop: 0,
				operationId: callId,
				receiptIds: applied.receipts,
				before,
				after: control.worldRevision,
			};
			if (variant === "foreign-scope") event.campaign = "foreign-campaign";
			if (variant === "old-before") event.before = "world-r0";
			control.api.events.emit("coc:task-receipt-advance", event);
			control.registration = { callId, receipts: applied.receipts, event: structuredClone(event) };
		},
	});
}

test("an exact owned deferred-registration receipt advances the auditing task and permits one delivery", async t => {
	let decisions = 0;
	const table = await createKernelHost(t, {
		mods: deferredRegistration("owned"),
		responses: [fauxAssistantMessage([fauxToolCall("narrate", { text: "The deferred registration and this answer share one turn." })], { stopReason: "toolUse" })],
		async decide() { decisions++; throw new Error("direct draft must not invoke Jev"); },
	});
	await table.session.prompt("Answer directly while deferred registration completes.", { source: "rpc" });
	await waitForIdle(table.session);

	const status = table.adapter.status();
	const requests = await table.kernelRequests();
	assert.equal(decisions, 0);
	assert.equal(status.task.status, "closed");
	assert.equal(status.task.reason, "delivered");
	assert.equal(status.task.checkpoint.context.readSet.find(row => row.kind === "world").revision, "world-r2");
	assert.deepEqual(status.task.checkpoint.settledReceipts, table.control.registration.receipts);
	assert.equal(requests.filter(row => row.method === "table.apply").length, 1, "the deferred registration creates one world effect");
	assert.equal(requests.filter(row => row.method === "table.narrate").length, 1, "delivery follows the owned advance without replaying the effect");
	assert.deepEqual(table.extensionErrors, []);
});

test("foreign-scope and old-before receipt events never unlock delivery after a world change", async t => {
	for (const variant of ["foreign-scope", "old-before"]) await t.test(variant, async t => {
		const table = await createKernelHost(t, {
			mods: deferredRegistration(variant),
			responses: [fauxAssistantMessage([fauxToolCall("narrate", { text: "This draft must stay blocked." })], { stopReason: "toolUse" })],
			async decide() { throw new Error("direct draft must not invoke Jev"); },
		});
		await table.session.prompt(`Reject the ${variant} receipt event.`, { source: "rpc" });
		await waitForIdle(table.session);

		const status = table.adapter.status();
		const requests = await table.kernelRequests();
		assert.equal(status.task.status, "ready");
		assert.equal(status.task.phase, "auditing");
		assert.equal(status.task.checkpoint.context.readSet.find(row => row.kind === "world").revision, "world-r1");
		assert.deepEqual(status.task.checkpoint.settledReceipts, []);
		assert.equal(requests.filter(row => row.method === "table.apply").length, 1, "the deferred effect settles exactly once");
		assert.equal(requests.filter(row => row.method === "table.narrate").length, 0, "stale delivery never reaches the kernel");
	});
});

test("a changed authoritative world revision makes the accepted plan stale before any operation dispatch", async t => {
	let table;
	let calls = 0;
	table = await createKernelHost(t, {
		responses: [fauxAssistantMessage([fauxToolCall("submit_plan_packet", plan)], { stopReason: "toolUse" })],
		async decide(batch) {
			calls++;
			table.control.worldRevision = "world-r2";
			return answer(batch, "candidate_0", "needs_more");
		},
	});
	await table.session.prompt("Read against a revision that changes during the decision.", { source: "rpc" });
	await waitForIdle(table.session);

	const status = table.adapter.status();
	const requests = await table.kernelRequests();
	assert.equal(calls, 1);
	assert.equal(status.task.result.status, "stale");
	assert.equal(status.task.status, "closed");
	assert.equal(status.task.observations.length, 0);
	assert.equal(requests.some(row => row.method === "table.look"), false);
});

test("replacement player input cancels the obsolete foreground decision before reads or delivery", async t => {
	let started;
	let observedAbort = false;
	const decisionStarted = new Promise(resolve => { started = resolve; });
	const table = await createKernelHost(t, {
		responses: [fauxAssistantMessage([fauxToolCall("submit_plan_packet", plan)], { stopReason: "toolUse" })],
		decide(_batch, lease) {
			started();
			return new Promise((resolve, reject) => lease.signal.addEventListener("abort", () => {
				observedAbort = true;
				reject(new Error("cancelled by replacement input"));
			}, { once: true }));
		},
	});
	const running = table.session.prompt("First question", { source: "rpc" });
	await decisionStarted;
	const obsoleteId = table.adapter.status().task.checkpoint.context.id;
	const replacement = table.session.prompt("Replacement question", { source: "rpc", streamingBehavior: "steer" });
	await new Promise(resolve => setTimeout(resolve, 150));
	const cancelledByReplacementInput = observedAbort;
	if (!cancelledByReplacementInput) await table.session.abort();
	await Promise.allSettled([running, replacement]);
	const obsolete = await table.store.load(obsoleteId);

	assert.equal(cancelledByReplacementInput, true, "the public replacement input must revoke the old task before fallback abort or deadline");
	assert.equal(obsolete.result.status, "cancelled");
	assert.equal(obsolete.status, "closed");
	assert.equal(obsolete.observations.length, 0);
	assert.equal((await table.kernelRequests()).some(row => row.method === "table.look"), false);
});

test("selecting another Keeper model cancels the in-flight task before its decision can continue", async t => {
	let started;
	let release;
	let observedAbort = false;
	const decisionStarted = new Promise(resolve => { started = resolve; });
	const table = await createKernelHost(t, {
		responses: [fauxAssistantMessage([fauxToolCall("submit_plan_packet", plan)], { stopReason: "toolUse" })],
		decide(batch, lease) {
			started();
			return new Promise((resolve, reject) => {
				release = () => resolve(answer(batch, "candidate_0", "needs_more"));
				lease.signal.addEventListener("abort", () => {
					observedAbort = true;
					reject(new Error("cancelled by model change"));
				}, { once: true });
			});
		},
	});
	const running = table.session.prompt("Question under the original Keeper model", { source: "rpc" });
	await decisionStarted;
	const taskId = table.adapter.status().task.checkpoint.context.id;
	await table.session.setModel(table.faux.getModel("replacement"));
	await new Promise(resolve => setTimeout(resolve, 20));
	if (!observedAbort) release();
	await running;
	const record = await table.store.load(taskId);

	assert.equal(observedAbort, true);
	assert.equal(record.result.status, "cancelled");
	assert.equal(record.observations.length, 0);
});

function lifecycleHost(log, adapter) {
	return {
		name: "task-host-lifecycle-fixture",
		factory(pi) {
			const controller = new AbortController();
			const context = {
				campaign: "fixture",
				worldline: "main",
				loop: 0,
				turn: 1,
				source_revision: "source-r1",
				world_revision: "world-r1",
			};
			pi.on("session_start", event => {
				log.starts.push(event.reason);
				pi.events.emit("coc:kernel-bridge", {
					campaign: "fixture",
					runtime: { home: log.cwd, signal: controller.signal },
					async call(method) {
						if (method !== "table.capsule") throw new Error("unexpected lifecycle bridge call");
						return { _context: structuredClone(context) };
					},
				});
				pi.events.emit("coc:operation-dispatcher", { async dispatch() { throw new Error("direct lifecycle path must not dispatch"); } });
			});
			pi.on("before_agent_start", () => {
				pi.events.emit("coc:capsule", { campaign: "fixture", turn: 1, epoch: "fixture", capsule: {}, context: structuredClone(context) });
			});
			pi.on("session_shutdown", () => controller.abort());
			adapter.extension(pi);
		},
	};
}

test("public session new, switch, and shutdown rebuild and close adapter state", async () => {
	const cwd = await workspace("jev-task-lifecycle-");
	const faux = fauxProvider({ provider: "lifecycle-keeper", models: [{ id: "keeper", reasoning: false }] });
	const modelRuntime = await ModelRuntime.create({
		authPath: join(cwd, "auth.json"), modelsPath: null, modelsStorePath: join(cwd, "models.json"), refreshOnCreate: false,
	});
	modelRuntime.registerNativeProvider(faux.provider);
	const adapters = [];
	const log = { cwd, starts: [] };
	const manager = SessionManager.create(cwd, join(cwd, "sessions"));
	const factory = async ({ cwd: sessionCwd, agentDir, sessionManager, sessionStartEvent }) => {
		const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
		let session;
		const adapter = createTaskHostAdapter(() => session, { async decide() { throw new Error("lifecycle direct draft must not decide"); } }, { store: new MemoryStore() });
		adapters.push(adapter);
		const loader = new DefaultResourceLoader({
			cwd: sessionCwd,
			agentDir,
			settingsManager,
			extensionFactories: [lifecycleHost(log, adapter)],
		});
		await loader.reload();
		const result = await createAgentSession({
			cwd: sessionCwd,
			agentDir,
			model: faux.getModel(),
			modelRuntime,
			thinkingLevel: "off",
			noTools: "builtin",
			resourceLoader: loader,
			sessionManager,
			settingsManager,
			sessionStartEvent,
		});
		session = result.session;
		await session.bindExtensions({ mode: "rpc" });
		return { ...result, services: { cwd: sessionCwd, agentDir }, diagnostics: [] };
	};
	const runtime = await createAgentSessionRuntime(factory, { cwd, agentDir: join(cwd, "agent"), sessionManager: manager });
	const originalFile = runtime.session.sessionFile;
	assert.ok(originalFile);

	assert.equal((await runtime.newSession()).cancelled, false);
	assert.equal(adapters[0].status().closed, true);
	assert.equal(adapters[1].status().closed, false);
	assert.equal((await runtime.switchSession(originalFile)).cancelled, false);
	assert.equal(adapters[1].status().closed, true);
	assert.equal(adapters[2].status().closed, false);
	await runtime.dispose();
	assert.equal(adapters[2].status().closed, true);
	assert.ok(log.starts.includes("startup"));
	assert.ok(log.starts.includes("new"));
	assert.ok(log.starts.includes("resume"));
});
