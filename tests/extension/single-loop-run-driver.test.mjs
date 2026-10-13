// Controller-only cases retired with single-keeper-streaming-turns; retained cases exercise current shared utilities.
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
import { createHybridEngine } from "./hybrid-engine-fixture.mjs";
import { ROUTE_FAMILY } from "../../runtime/jev/step-policy.ts";
import { isRunEvent, RUN_EVENT_SCHEMA_VERSION, RUN_LOOP_PROTOCOL } from "./pi-agent-core.mjs";
import { LOOP_PROTOCOLS } from "../../runtime/loop-engine.ts";

/** A Jev answer in the adapter's result shape: every question answered, `exit` set to `exit`. */
const baseQuestion = (question) => ({ ...question, key: question.key.replace(/__(?:semantic_facts|semantic_execution)$/, "") });
function issuedChoice(question, value, confidence = 0.9) {
	const keys = Object.keys(question.criteria);
	assert.ok(keys.includes(value), `fixture choice ${value} is not issued for ${question.key}`);
	return { status: "answered", type: "choice", choice: value, confidence,
		probabilities: Object.fromEntries(keys.map((key) => [key, keys.length === 1 ? 1 : key === value ? confidence : (1 - confidence) / (keys.length - 1)])) };
}
function answered(batch, exit) {
	const answers = {};
	for (const question of batch.questions) {
		const choice = baseQuestion(question).key === "exit" ? exit : Object.hasOwn(question.criteria, "costs") ? "none" : "later";
		answers[question.key] = issuedChoice(question, choice);
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

test("PI_COC_LOOP_ENGINE unset: the session runs the legacy loop and reports it", async (t) => {
	const table = await openTable({ responses: [fauxAssistantMessage([fauxToolCall("output", { text: "门开了。" })], { stopReason: "toolUse" }), fauxAssistantMessage("门开了。")] });
	t.after(() => table.dispose());
	const events = [];
	table.session.subscribe((event) => events.push(event));
	await table.session.prompt("我推开地窖门");
	assert.equal(table.session.runEngine, "legacy");
	assert.equal(events.filter(isRunEvent).length, 0, "the legacy loop emits no run events");
	assert.equal(table.telemetry().find((row) => row.lane === "startup").loop_engine, "legacy");
});
