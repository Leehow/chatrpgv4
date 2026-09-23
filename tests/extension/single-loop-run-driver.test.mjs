/**
 * SL-01 gate (spec pi-native-single-loop, ticket 01-run-driver; design §13 SL-01 and §14.1).
 *
 * `PI_COC_LOOP_ENGINE=hybrid-v1` on the extension seam: a real Pi session built from the vendored
 * build (ADR-0006), the product's hybrid engine (`runtime/jev/hybrid-engine.ts`: step policy, kernel
 * read port, Jev decision port, operations), a stub Jev `DecisionPort`, the fake kernel and the faux
 * provider behind Pi's real provider path. One player input must produce, in this order: a
 * policy-origin read-only kernel operation, a Jev route decision, and one real model output -- with no
 * fabricated assistant message, usage or tool result, no `agent.continue()`, and no TaskRuntime.
 * An abort during the Jev wait ends the run at once with nothing executed after it.
 *
 * The architecture assertions SL-A01, A02, A05, A08 and A09 are read off the run trace.
 */
import { strict as assert } from "node:assert";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { openTable } from "./harness.mjs";
import { createHybridEngine } from "../../runtime/jev/hybrid-engine.ts";
import { ROUTE_FAMILY } from "../../runtime/jev/step-policy.ts";
import { isRunEvent, RUN_EVENT_SCHEMA_VERSION, RUN_LOOP_PROTOCOL } from "./pi-agent-core.mjs";
import { LOOP_PROTOCOLS } from "../../runtime/loop-engine.ts";

/** A Jev answer in the adapter's result shape: every question answered, `exit` set to `exit`. */
function answered(batch, exit) {
	const answers = {};
	for (const question of batch.questions) {
		const choice = question.key === "exit" ? exit : "later";
		answers[question.key] = { status: "answered", type: "choice", choice, confidence: 0.9, probabilities: { [choice]: 0.9 } };
	}
	return { batchId: batch.id, status: "complete", answers, coverage: { required: Object.keys(answers), answered: Object.keys(answers), unknown: [] }, issues: [] };
}

/** Open a hybrid table: the engine's inline extension and a probe that logs every session event, in one ordered log. */
async function hybridTable({ decide, responses }) {
	const log = [];
	const decisions = [];
	const engine = createHybridEngine({
		env: process.env,
		decision: { decide: async (batch, lease) => { decisions.push({ batch, lease }); log.push({ kind: "jev", family: batch.family }); return decide(batch, lease); } },
	});
	const table = await openTable({
		// The fake kernel's capsule carries a real context binding, so the route question is a real, packed Jev batch.
		env: { PI_COC_LOOP_ENGINE: "hybrid-v1", FAKE_KERNEL_WORKSPACE: "1" },
		runDriver: engine.runDriver,
		extraExtensions: [{ name: "coc-hybrid-engine", factory: engine.extension }],
		// The provider stub pattern of host-run-prompt.test.mjs: each request is logged where it happens.
		responses: responses.map((response) => (context) => { log.push({ kind: "provider_request", messages: context.messages.length }); return response; }),
	});
	const events = [];
	const unsubscribe = table.session.subscribe((event) => {
		events.push(event);
		log.push({ kind: "event", type: event.type, role: event.message?.role, ...(isRunEvent(event) ? { run: event } : {}) });
	});
	// A09 is asserted on the vendored session's own agent: every call of its continue() is counted.
	const agent = table.session.agent;
	const continued = [];
	const continueFn = agent.continue.bind(agent);
	agent.continue = async (...args) => { continued.push(new Error().stack); return continueFn(...args); };
	return { table, engine, log, events, decisions, continued, dispose: async () => { unsubscribe(); await table.dispose(); } };
}

const runEvents = (events) => events.filter(isRunEvent);
const kernelMethods = (table) => table.kernelRequests().map((request) => request.method);

function taskStoreFiles(root) {
	const found = [];
	const walk = (dir) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) { if (entry.name === "tasks") found.push(path); walk(path); }
		}
	};
	if (existsSync(root)) walk(root);
	return found;
}

test("SL-01 gate: a policy-origin read and a Jev decision run before one real model output; the trace is complete and nothing is fabricated", async (t) => {
	const table = await hybridTable({
		decide: (batch) => answered(batch, "finish"),
		responses: [fauxAssistantMessage([fauxToolCall("narrate", { text: "地窖门吱呀一声开了。" })], { stopReason: "toolUse" })],
	});
	t.after(() => table.dispose());
	const before = kernelMethods(table.table).length;
	await table.table.session.prompt("我推开地窖门");

	const { log, events, decisions, continued } = table;
	const run = runEvents(events);
	const runId = run[0]?.runId;
	assert.ok(runId, "the input started a driven run");
	assert.equal(table.table.session.runEngine, "hybrid-v1");

	// The policy-origin read ran on the kernel, read-only, before the model was asked anything.
	const readSettled = log.findIndex((row) => row.run?.type === "operation_settled" && row.run.origin === "policy");
	const firstProvider = log.findIndex((row) => row.kind === "provider_request");
	const firstAssistant = log.findIndex((row) => row.kind === "event" && row.type === "message_start" && row.role === "assistant");
	const jev = log.findIndex((row) => row.kind === "jev");
	assert.ok(readSettled >= 0 && jev >= 0 && firstProvider >= 0 && firstAssistant >= 0);
	assert.ok(readSettled < jev && jev < firstProvider && firstProvider < firstAssistant, "read → Jev → provider request → model message");
	assert.equal(run.find((event) => event.type === "operation_prepared" && event.origin === "policy").readOnly, true);
	const duringRun = kernelMethods(table.table).slice(before);
	assert.ok(duringRun.includes("table.capsule") && duringRun.includes("table.status"), "the read reached the kernel");

	// The Jev decision was the step policy's route question, over the real binding, under a lease the run owns.
	assert.equal(decisions.length, 1);
	assert.equal(decisions[0].batch.family, ROUTE_FAMILY);
	assert.deepEqual(decisions[0].batch.questions.map((question) => question.key), ["exit"], "no host candidates in SL-01: the exit alone");

	// One real model output through the real provider path, and its tool call executed once, paired.
	assert.equal(log.filter((row) => row.kind === "provider_request").length, 1);
	const messages = table.table.session.messages;
	const assistants = messages.filter((message) => message.role === "assistant");
	assert.equal(assistants.length, 1, "exactly the one message the provider produced");
	const calls = assistants.flatMap((message) => message.content.filter((block) => block.type === "toolCall"));
	const results = messages.filter((message) => message.role === "toolResult");
	assert.deepEqual(results.map((result) => result.toolCallId), calls.map((call) => call.id), "every tool result answers a real call, once");
	assert.ok(kernelMethods(table.table).includes("table.narrate"));

	// The run ended delivered, on the narrate's evidence.
	const end = run.at(-1);
	assert.equal(end.type, "run_end");
	assert.equal(end.status, "delivered");
	assert.equal(table.table.session.lastDrivenRun.status, "delivered");

	// Complete, ordered event stream with the run envelope.
	assert.deepEqual(run.map((event) => event.sequence), run.map((_, index) => index + 1));
	for (const event of run) {
		assert.equal(event.runId, runId);
		assert.equal(event.schemaVersion, RUN_EVENT_SCHEMA_VERSION);
		assert.ok(typeof event.scopeId === "string" && ["policy", "model", "user-command"].includes(event.origin) && ["internal", "keeper", "player"].includes(event.visibility));
	}
	const steps = run.filter((event) => event.type === "step_start").map((event) => event.kind);
	assert.deepEqual(steps, ["operate", "decide", "infer", "operate", "finish"]);
	assert.equal(run.filter((event) => event.type === "step_start").length, run.filter((event) => event.type === "step_end").length);
	assert.ok(run.some((event) => event.type === "delivery_accepted" && event.delivery === "accepted"));

	// SL-A01: one driver owns the run; no second run started inside it.
	assert.equal(run.filter((event) => event.type === "run_start").length, 1);
	assert.equal(run.filter((event) => event.type === "run_end").length, 1);
	// SL-A02: a native Jev/read step before the first model message (above). SL-A05: the LLM step returns to the same run.
	const inferEnd = run.findIndex((event) => event.type === "step_end" && event.kind === "infer");
	assert.ok(inferEnd > 0 && run.slice(inferEnd).every((event) => event.runId === runId));
	// SL-A08: the decision is an artifact, not a message; no usage the provider did not report.
	assert.ok(!messages.some((message) => message.role === "assistant" && message.usage?.totalTokens === 0 && message.content.every((block) => block.type === "text" && !block.text)),
		"no synthetic assistant message");
	assert.ok(!JSON.stringify(messages).includes(ROUTE_FAMILY), "the Jev decision never became a message");
	// SL-A09: no agent.continue() second loop, counted on the vendored session's own agent.
	assert.equal(continued.length, 0);
	// TaskRuntime: no task was ever begun, submitted or stored anywhere under the table's workspace.
	assert.deepEqual(taskStoreFiles(table.table.workspace), []);

	// The run's events reach the campaign telemetry through the record port, next to the startup record.
	const telemetry = table.table.telemetry();
	assert.ok(telemetry.some((row) => row.lane === "run" && row.type === "run_end" && row.runId === runId));
	const startup = telemetry.find((row) => row.lane === "startup");
	assert.equal(startup.loop_engine, "hybrid-v1");
	assert.equal(startup.loop_protocol_version, `${RUN_LOOP_PROTOCOL}/events-${RUN_EVENT_SCHEMA_VERSION}`, "the product names the protocol the vendored driver speaks");
	assert.equal(LOOP_PROTOCOLS["hybrid-v1"], startup.loop_protocol_version);
	assert.equal(startup.pi.base_commit, "16787ad5b2dc748047f314ca1bfe7708f30f54f3");
	assert.match(startup.pi.patch_series_digest, /^[a-f0-9]{64}$/);
});

test("SL-01 gate: abort during the Jev wait ends the run at once; nothing is executed after it and no model is asked", async (t) => {
	let jevSawAbort = false;
	const table = await hybridTable({
		decide: (_batch, lease) => new Promise((resolve) => {
			lease.signal.addEventListener("abort", () => { jevSawAbort = true; }, { once: true });
			// Never answers on its own: only the abort ends the wait.
			setTimeout(() => resolve(answered(_batch, "ask_llm")), 30_000).unref();
		}),
		responses: [fauxAssistantMessage("不该有人问我。")],
	});
	t.after(() => table.dispose());
	const prompt = table.table.session.prompt("我推开地窖门");
	const deadline = Date.now() + 5_000;
	while (!table.decisions.length && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
	assert.equal(table.decisions.length, 1, "the run is waiting on Jev");
	const kernelBefore = kernelMethods(table.table).length;
	const abortedAt = Date.now();
	await table.table.session.abort();
	await prompt;
	assert.ok(Date.now() - abortedAt < 2_000, "the abort did not wait for the decision");

	const run = runEvents(table.events);
	assert.deepEqual(run.slice(-2).map((event) => [event.type, event.status]), [["step_end", "aborted"], ["run_end", "aborted"]]);
	assert.equal(table.table.session.lastDrivenRun.reason, "aborted_during_decide");
	assert.equal(jevSawAbort, true, "the Jev lease was revoked with the run");
	assert.equal(table.log.filter((row) => row.kind === "provider_request").length, 0, "no model was asked");
	assert.equal(table.table.session.messages.filter((message) => message.role === "assistant" || message.role === "toolResult").length, 0,
		"no assistant message and no tool result were fabricated for the aborted run");
	assert.ok(!run.some((event, index) => index > run.findIndex((e) => e.type === "step_start" && e.kind === "decide") && event.type === "operation_prepared"),
		"no operation was prepared after the Jev step");
	assert.ok(!kernelMethods(table.table).slice(kernelBefore).some((method) => ["table.resolve", "table.apply", "table.narrate", "table.ask"].includes(method)),
		"the kernel received no write after the abort");
	assert.equal(table.continued.length, 0);
});

test("without a Jev key the hybrid engine degrades every decision to the Keeper inside the same run", async (t) => {
	const log = [];
	const engine = createHybridEngine({ env: {}, decision: null });
	const table = await openTable({
		env: { PI_COC_LOOP_ENGINE: "hybrid-v1" },
		runDriver: engine.runDriver,
		extraExtensions: [{ name: "coc-hybrid-engine", factory: engine.extension }],
		responses: [(context) => { log.push("provider"); return fauxAssistantMessage([fauxToolCall("narrate", { text: "门开了。" })], { stopReason: "toolUse" }); }],
	});
	t.after(() => table.dispose());
	const events = [];
	table.session.subscribe((event) => { if (isRunEvent(event)) events.push(event); });
	await table.session.prompt("我推开地窖门");
	assert.deepEqual(events.filter((event) => event.type === "step_start").map((event) => event.kind), ["operate", "decide", "infer", "operate", "finish"]);
	assert.equal(events.find((event) => event.type === "step_end" && event.kind === "decide").status, "unavailable");
	assert.equal(events.at(-1).status, "delivered");
	assert.deepEqual(log, ["provider"]);
});

test("PI_COC_LOOP_ENGINE unset: the session runs the legacy loop and reports it", async (t) => {
	const table = await openTable({ responses: [fauxAssistantMessage([fauxToolCall("narrate", { text: "门开了。" })], { stopReason: "toolUse" }), fauxAssistantMessage("门开了。")] });
	t.after(() => table.dispose());
	const events = [];
	table.session.subscribe((event) => events.push(event));
	await table.session.prompt("我推开地窖门");
	assert.equal(table.session.runEngine, "legacy");
	assert.equal(events.filter(isRunEvent).length, 0, "the legacy loop emits no run events");
	assert.equal(table.telemetry().find((row) => row.lane === "startup").loop_engine, "legacy");
});
