/**
 * S0 read-dispatch conformance only.
 *
 * `openTable` supplies a real public Pi AgentSession, extension hooks, and the product-wrapped
 * `recall` tool. Its provider and kernel are intentionally faux. These tests therefore prove hook,
 * guard, execution, and result plumbing; they do not claim Grok, Jev, RPC, or product acceptance.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { createS0ReadDispatcher } from "../../runtime/jev/s0-read-dispatch.ts";
import { openTable, waitForIdle } from "./harness.mjs";

const SEVEN = ["look", "lookup", "recall", "resolve", "apply", "ask", "narrate"];
const READ_ARGS = Object.freeze({ what: "transcript", turns: Object.freeze([0, 0]) });

function delivered(text = "The bounded test turn closes.") {
	return [
		fauxAssistantMessage([fauxToolCall("narrate", { text })], { stopReason: "toolUse" }),
		fauxAssistantMessage("discarded post-delivery tail"),
	];
}

function privateReadCall() {
	return fauxAssistantMessage([fauxToolCall("s0_test_read", {})], { stopReason: "toolUse" });
}

function childMessages(session, operationId) {
	return session.messages.filter((message) =>
		(message.role === "toolResult" && message.toolCallId === operationId)
		|| (message.role === "assistant" && message.content.some?.((block) => block.type === "toolCall" && block.id === operationId)));
}

function resultText(observation) {
	return observation?.result?.content?.map((block) => block.type === "text" ? block.text : "").join("\n") ?? "";
}

function phases(run) {
	return run.trace.map((event) => event.phase);
}

/**
 * Register one test-only private tool. Its provider-issued call gives the nested dispatcher an
 * actual assistant parent already stored in `session.messages`; no assistant or tool-result child
 * is forged. The extension also observes the same public `tool_call`/`tool_result` hooks that the
 * product session installs on the Agent.
 */
function privateReadExtension(control) {
	return {
		name: "jev-s0-read-dispatch-test",
		factory(pi) {
			pi.registerTool({
				name: "s0_test_read",
				label: "S0 test read",
				description: "Test-only bounded parent for an S0 nested recall.",
				parameters: Type.Object({}),
				execute: async (toolCallId, _params, signal) => {
					const scenario = control.scenarios.shift() ?? { args: READ_ARGS };
					control.activeScenario = scenario;
					const session = control.table.session;
					const parent = [...session.messages].reverse().find((message) =>
						message.role === "assistant"
						&& message.content.some?.((block) => block.type === "toolCall" && block.id === toolCallId));
					const trace = [];
					const entered = new Set();
					const dispatcher = createS0ReadDispatcher(session, {
						current: () => scenario.current !== false,
						enter(operationId) {
							entered.add(operationId);
							return () => entered.delete(operationId);
						},
						trace: (event) => trace.push(event),
					});
					const originalBefore = session.agent.beforeToolCall;
					const beforeCount = session.messages.length;
					let observation, rejection;
					try {
						if (scenario.replaceBeforeHook) session.agent.beforeToolCall = async () => undefined;
						observation = await dispatcher(structuredClone(scenario.args ?? READ_ARGS), parent, signal);
					} catch (error) {
						rejection = error;
					} finally {
						session.agent.beforeToolCall = originalBefore;
						control.activeScenario = undefined;
					}
					const operationId = observation?.operationId ?? trace[0]?.operationId;
					control.runs.push({
						scenario,
						parent,
						parentStored: session.messages.includes(parent),
						beforeCount,
						afterCount: session.messages.length,
						childMessages: operationId ? childMessages(session, operationId) : [],
						observation,
						rejection,
						trace,
						entered: entered.size,
					});
					return {
						content: [{ type: "text", text: observation ? JSON.stringify(observation) : String(rejection) }],
						details: { observation, rejection: rejection instanceof Error ? rejection.message : undefined },
					};
				},
			});
			// The product activates exactly seven verbs. This extra name exists only inside this test
			// harness and is removed with the table; it is not a product gameplay verb.
			pi.on("session_start", () => pi.setActiveTools([...SEVEN, "s0_test_read"]));
			pi.on("tool_call", (event) => {
				if (!event.toolCallId.startsWith("jev-read-")) return;
				control.hooks.push({ type: "tool_call", event });
				if (control.activeScenario?.abortOnChildCall) control.table.session.agent.abort();
			});
			pi.on("tool_result", (event) => {
				if (event.toolCallId.startsWith("jev-read-")) control.hooks.push({ type: "tool_result", event });
			});
		},
	};
}

async function openPrivateTable(t, { scenarios, responses, env = {} }) {
	const control = { table: undefined, scenarios: [...scenarios], runs: [], hooks: [], activeScenario: undefined };
	const table = await openTable({
		env: { PI_COC_MEMORY_BACKFILL: "0", ...env },
		responses,
		extraExtensions: [privateReadExtension(control)],
	});
	control.table = table;
	t.after(() => table.dispose());
	return { table, control };
}

async function play(table, text = "Open the bounded conformance turn.", { allowPromptError = false } = {}) {
	try {
		await table.session.prompt(text);
	} catch (error) {
		if (!allowPromptError) throw error;
	}
	await waitForIdle(table.session);
}

test("conformance: nested recall uses the real Pi hooks and wrapped executor without fabricating child messages", async (t) => {
	const responses = [
		privateReadCall(),
		fauxAssistantMessage([fauxToolCall("recall", READ_ARGS)], { stopReason: "toolUse" }),
		...delivered(),
	];
	const { table, control } = await openPrivateTable(t, { scenarios: [{ args: READ_ARGS }], responses });
	await play(table);

	assert.equal(control.runs.length, 1);
	const run = control.runs[0];
	assert.equal(run.parent?.role, "assistant");
	assert.equal(run.parentStored, true, "the parent is the provider-issued assistant message in session.messages");
	assert.equal(run.observation.isError, false);
	assert.deepEqual(phases(run), ["prepare", "execute", "finalize", "end"]);
	assert.equal(run.beforeCount, run.afterCount, "the nested read appends no synthetic child message");
	assert.deepEqual(run.childMessages, []);
	assert.equal(run.entered, 0, "the host-issued child gate is released in finally");

	const childHooks = control.hooks.filter((row) => row.event.toolCallId === run.observation.operationId);
	assert.deepEqual(childHooks.map((row) => row.type), ["tool_call", "tool_result"]);
	assert.equal(childHooks[1].event.isError, false);
	const regular = table.session.messages.find((message) => message.role === "toolResult" && message.toolName === "recall");
	assert.ok(regular, "the ordinary provider-issued recall produced its normal tool result");
	assert.deepEqual(run.observation.result.content, regular.content, "nested and ordinary recall return the same wrapped content");
	assert.deepEqual(run.observation.result.details, regular.details, "nested and ordinary recall return the same wrapped details");
	assert.equal(childMessages(table.session, run.observation.operationId).length, 0,
		"no child assistant completion or child tool-result event is inserted into the transcript");
	assert.equal(table.kernelRequests().filter((row) => row.method === "table.recall").length, 2);
});

test("conformance: executed failures reach tool_result bookkeeping and the normal repeated-refusal guard blocks before execute", async (t) => {
	const forced = { "table.recall": { code: "invalid_params", message: "forced recall failure" } };
	const responses = [privateReadCall(), privateReadCall(), privateReadCall(), ...delivered()];
	const { table, control } = await openPrivateTable(t, {
		scenarios: [{ args: READ_ARGS }, { args: READ_ARGS }, { args: READ_ARGS }],
		responses,
		env: { FAKE_KERNEL_ERRORS: JSON.stringify(forced) },
	});
	await play(table);

	assert.equal(control.runs.length, 3);
	assert.deepEqual(phases(control.runs[0]), ["prepare", "execute", "finalize", "end"]);
	assert.deepEqual(phases(control.runs[1]), ["prepare", "execute", "finalize", "end"]);
	assert.deepEqual(phases(control.runs[2]), ["prepare", "end"], "the before hook skips execution and finalization");
	assert.ok(control.runs.every((run) => run.observation?.isError === true));
	assert.match(resultText(control.runs[0].observation), /forced recall failure/);
	assert.match(resultText(control.runs[2].observation), /refused these parameters 2 times/);
	assert.equal(table.kernelRequests().filter((row) => row.method === "table.recall").length, 2,
		"the third attempt is blocked before the executor reaches the faux kernel");
	assert.deepEqual(control.hooks.map((row) => row.type),
		["tool_call", "tool_result", "tool_call", "tool_result"],
		"the runner stops after the earlier kernel handler blocks, so later observer hooks see no fabricated call");
	assert.equal(control.hooks.filter((row) => row.type === "tool_result").every((row) => row.event.isError), true,
		"executed failures reach the public tool_result failure ledger");
	assert.equal(control.runs.flatMap((run) => run.childMessages).length, 0);
});

test("conformance: a closed turn has no read door and the before block does not execute or finalize", async (t) => {
	const { table, control } = await openPrivateTable(t, {
		scenarios: [{ args: READ_ARGS }],
		responses: [privateReadCall(), ...delivered()],
	});
	await play(table);
	const parent = control.runs[0].parent;
	assert.equal(table.session.messages.includes(parent), true);
	const trace = [];
	const dispatcher = createS0ReadDispatcher(table.session, {
		current: () => true,
		enter: () => () => undefined,
		trace: (event) => trace.push(event),
	});
	const recallsBefore = table.kernelRequests().filter((row) => row.method === "table.recall").length;
	const hookCount = control.hooks.length;
	const observation = await dispatcher(structuredClone(READ_ARGS), parent, new AbortController().signal);

	assert.equal(observation.isError, true);
	assert.match(resultText(observation), /turn is closed, waiting for the player/);
	assert.deepEqual(trace.map((event) => event.phase), ["prepare", "end"]);
	assert.equal(table.kernelRequests().filter((row) => row.method === "table.recall").length, recallsBefore);
	assert.deepEqual(control.hooks.slice(hookCount), [],
		"the earlier kernel handler blocks before later probe handlers and emits no child tool_result hook");
	assert.deepEqual(childMessages(table.session, observation.operationId), []);
});

test("conformance: cancellation before and during the public before hook never reaches recall execution", async (t) => {
	const { table, control } = await openPrivateTable(t, {
		scenarios: [{ args: READ_ARGS, abortOnChildCall: true }],
		responses: [privateReadCall(), fauxAssistantMessage("unused after abort")],
	});
	await play(table, undefined, { allowPromptError: true });
	assert.equal(control.runs.length, 1);
	const mid = control.runs[0];
	assert.equal(mid.observation.isError, true);
	assert.match(resultText(mid.observation), /stale or cancelled/);
	assert.deepEqual(phases(mid), ["prepare", "end"]);
	assert.deepEqual(control.hooks.map((row) => row.type), ["tool_call"]);
	assert.equal(table.kernelRequests().some((row) => row.method === "table.recall"), false);

	const trace = [];
	const dispatcher = createS0ReadDispatcher(table.session, {
		current: () => true,
		enter: () => () => undefined,
		trace: (event) => trace.push(event),
	});
	const aborted = new AbortController();
	aborted.abort();
	await assert.rejects(dispatcher(structuredClone(READ_ARGS), mid.parent, aborted.signal), /stale or cancelled/);
	assert.deepEqual(trace, [], "a pre-cancelled call reaches no phase or public hook");
});

test("conformance: stale ownership and replaced Pi hooks are rejected before any nested hook or executor", async (t) => {
	const { table, control } = await openPrivateTable(t, {
		scenarios: [
			{ args: READ_ARGS, current: false },
			{ args: READ_ARGS, replaceBeforeHook: true },
		],
		responses: [privateReadCall(), privateReadCall(), ...delivered()],
	});
	await play(table);

	assert.equal(control.runs.length, 2);
	for (const run of control.runs) {
		assert.equal(run.observation, undefined);
		assert.match(run.rejection?.message ?? "", /stale or cancelled/);
		assert.deepEqual(run.trace, []);
		assert.equal(run.parentStored, true);
	}
	assert.deepEqual(control.hooks, []);
	assert.equal(table.kernelRequests().some((row) => row.method === "table.recall"), false);
});

test("conformance: an unknown recall field is rejected before public hooks", async (t) => {
	const { table, control } = await openPrivateTable(t, {
		scenarios: [
			{ args: { ...READ_ARGS, unknown_field: true } },
			{ args: { what: "transcript", read: { turn: 0, role: "keeper", unknown_field: true } } },
		],
		responses: [privateReadCall(), privateReadCall(), ...delivered()],
	});
	await play(table);

	assert.equal(control.runs.length, 2);
	for (const run of control.runs) {
		assert.equal(run.observation.isError, true);
		assert.deepEqual(phases(run), ["prepare", "end"]);
		assert.match(resultText(run.observation), /Invalid|additional|unknown|unexpected|schema/i);
		assert.deepEqual(run.childMessages, []);
	}
	assert.deepEqual(control.hooks, [], "schema failures happen before beforeToolCall/tool_call");
	assert.equal(table.kernelRequests().some((row) => row.method === "table.recall"), false);
});

test("conformance: malformed recall parameters fail schema validation before public hooks", async (t) => {
	const { table, control } = await openPrivateTable(t, {
		scenarios: [{ args: { what: 7 } }],
		responses: [privateReadCall(), ...delivered()],
	});
	await play(table);

	assert.equal(control.runs.length, 1);
	const run = control.runs[0];
	assert.equal(run.observation.isError, true);
	assert.deepEqual(phases(run), ["prepare", "end"]);
	assert.match(resultText(run.observation), /Validation failed|allowed values/i);
	assert.deepEqual(run.childMessages, []);
	assert.deepEqual(control.hooks, []);
	assert.equal(table.kernelRequests().some((row) => row.method === "table.recall"), false);
});
