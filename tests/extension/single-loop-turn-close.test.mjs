/**
 * Contract §135.11 at the extension seam: the driven run (`PI_COC_LOOP_ENGINE=hybrid-v1`) owns the turn close.
 *
 * A real Pi session from the vendored build, the product hybrid engine, a stub Jev `DecisionPort`, the fake kernel
 * and the faux provider behind Pi's provider path. Found at the SL-02 live gate (`game-b5367f88`, 2026-09-23): a
 * prose-only close was delivered by the kernel extension's implicit narrate and still logged `undelivered`, and a
 * draft the host dropped for its turn-close steer (turn 2, the §40 speech steer) was never steered on hybrid, so
 * the player read "no delivered result" over a turn the Keeper had written.
 *
 * - a text-only last model step ends `delivered` on the implicit narrate's own receipt, with the prose delivered;
 * - a step that called `narrate` itself is unchanged (no turn-close operation);
 * - a draft dropped for the speech steer, and a thinking-only step after a failed check, are steered once inside
 *   the run with the same `coc-host` message legacy sends, and then delivered;
 * - a prose-only turn with no tool call is floor-steered once, and a second leg that brings nothing delivers the
 *   dropped draft: the notice never hides prose that existed;
 * - a Keeper who brings nothing twice ends `undelivered` with the §38 notice, and no steer is left queued for the
 *   next input.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { customMessages, openTable, waitFor } from "./harness.mjs";
import { createHybridEngine } from "../../runtime/jev/hybrid-engine.ts";
import { ROUTE_FAMILY } from "../../runtime/jev/step-policy.ts";
import { isRunEvent } from "./pi-agent-core.mjs";

/** Every question answered: each need `later`, the exit as given. */
function answered(batch, exit) {
	const answers = {};
	for (const question of batch.questions) {
		const choice = question.key === "exit" ? exit : Object.keys(question.criteria)[0] === "now" ? "later" : "unknown";
		answers[question.key] = { status: "answered", type: "choice", choice, confidence: 0.9, probabilities: { [choice]: 0.9 } };
	}
	return { batchId: batch.id, status: "complete", answers, coverage: { required: Object.keys(answers), answered: Object.keys(answers), unknown: [] }, issues: [] };
}

/** The first route asks the Keeper; every later one says nothing more is to be settled. */
const keeperThenFinish = (batch, count) => answered(batch, batch.family === ROUTE_FAMILY && count === 1 ? "ask_llm" : "finish");

const GATEKEEPER = JSON.stringify([{ name: "Gatekeeper", relationship: "stranger", agenda: "send people away", voice: "hoarse" }]);

async function hybridTable({ responses, env = {}, decide = keeperThenFinish }) {
	const decisions = [], events = [], requests = [];
	const engine = createHybridEngine({ env: process.env, decision: { decide: async (batch, lease) => { decisions.push(batch); return decide(batch, decisions.length, lease); } } });
	const table = await openTable({
		env: { PI_COC_LOOP_ENGINE: "hybrid-v1", FAKE_KERNEL_WORKSPACE: "1", ...env },
		runDriver: engine.runDriver,
		extraExtensions: [{ name: "coc-hybrid-engine", factory: engine.extension }],
		responses: responses.map((response) => (context) => { requests.push(structuredClone(context.messages)); return response; }),
	});
	table.session.subscribe((event) => { if (isRunEvent(event)) events.push(event); });
	return { table, events, requests, decisions, dispose: () => table.dispose() };
}

const kernel = (table, method) => table.kernelRequests().filter((request) => request.method === method);
const runEnd = (events) => events.filter((event) => event.type === "run_end").at(-1);
const turnCloses = (events) => events.filter((event) => event.type === "operation_prepared" && event.operation === "turn_close");
const hostSteers = (session) => customMessages(session, "coc-host").filter((message) => message.details?.scope === "turn");
const unfinished = (session) => customMessages(session, "coc-delivery").filter((message) => message.details?.turn_unfinished);
const lastAssistantText = (session) => (session.messages.filter((message) => message.role === "assistant").at(-1)?.content ?? [])
	.filter((block) => block.type === "text").map((block) => block.text).join("");
/** The opening words of each host steer (extensions/kernel/index.ts), to read which one a model step was shown. */
const STEERS = { speech: "People are present and this draft wraps no spoken line", floor: "Use the ordinary narrate or mechanics ask delivery path",
	steer: "This turn is not closed yet" };
/** Which host steers a provider request carried (custom messages reach the provider as text). */
const steerIn = (messages) => Object.entries(STEERS).filter(([, words]) => JSON.stringify(messages).includes(words)).map(([kind]) => kind);

test("§135.11: a text-only last model step is delivered by the implicit narrate, and the run ends delivered on its receipt", async (t) => {
	const prose = "The door gives under your shoulder, and the cold from the cellar climbs the stairs.";
	const table = await hybridTable({
		env: { FAKE_KERNEL_PRESENT: "[]" },
		responses: [
			fauxAssistantMessage([fauxToolCall("resolve", { action: { intent: "investigate", goal: "the door frame", method: "look closely", skill: "Spot Hidden" } })], { stopReason: "toolUse" }),
			fauxAssistantMessage(prose),
		],
	});
	t.after(() => table.dispose());
	await table.table.session.prompt("I look at the cellar door.");

	const narrates = kernel(table.table, "table.narrate");
	assert.equal(narrates.length, 1, "one narrate: the implicit one");
	assert.equal(narrates[0].params.implicit, true);
	assert.equal(narrates[0].params.text, prose, "the Keeper's prose is what the kernel delivered");
	assert.equal(lastAssistantText(table.table.session), prose, "the player reads the rendered prose");

	const end = runEnd(table.events);
	assert.equal(end.status, "delivered");
	assert.equal(end.reason, "implicit_narrate");
	assert.equal(turnCloses(table.events).length, 1, "the run asked the turn close once");
	const accepted = table.events.find((event) => event.type === "delivery_accepted");
	assert.equal(accepted?.delivery, "accepted", "the delivery evidence is the turn close's");
	assert.match(accepted.operationId, /\/op1$/);
	const row = table.table.telemetry().find((entry) => entry.lane === "turn" && entry.event === "turn_close");
	assert.equal(row.status, "delivered");
	assert.equal(row.implicit, true);
	assert.equal(row.call_id, narrates[0].params.call_id, "the evidence names the implicit narrate's own call");
	assert.equal(table.requests.length, 2, "no extra model step");
	assert.equal(hostSteers(table.table.session).length, 0, "nothing was steered");
	assert.equal(unfinished(table.table.session).length, 0, "no 'no result' notice over a delivered turn");
});

test("§135.11: a step that called narrate itself is unchanged: its own result is the evidence and no turn close is asked", async (t) => {
	const table = await hybridTable({
		decide: (batch) => answered(batch, "finish"),
		responses: [fauxAssistantMessage([fauxToolCall("narrate", { text: "The cellar door creaks open." })], { stopReason: "toolUse" })],
	});
	t.after(() => table.dispose());
	await table.table.session.prompt("I push the cellar door.");

	assert.equal(runEnd(table.events).status, "delivered");
	assert.equal(runEnd(table.events).reason, "delivery_accepted");
	assert.equal(turnCloses(table.events).length, 0);
	assert.deepEqual(table.events.filter((event) => event.type === "step_start").map((event) => event.kind), ["operate", "decide", "infer", "operate", "finish"]);
	assert.equal(kernel(table.table, "table.narrate")[0].params.implicit, undefined);
});

test("§135.11: a draft dropped for the speech steer is steered once inside the run, with legacy's coc-host message, then delivered", async (t) => {
	const bare = "The gatekeeper shakes his head. \"Not today.\"";
	const wrapped = "The gatekeeper shakes his head. {{say:Gatekeeper}}\"Not today.\"{{/say}}";
	const table = await hybridTable({
		env: { FAKE_KERNEL_CHECK_FAILS: "1", FAKE_KERNEL_PRESENT: GATEKEEPER },
		responses: [
			fauxAssistantMessage([fauxToolCall("resolve", { action: { intent: "social", goal: "get the clippings", method: "explain the errand", skill: "Spot Hidden" } })], { stopReason: "toolUse" }),
			// Live turn 2's shape: the check failed, and the Keeper wrote the refusal with a person present and no say token.
			fauxAssistantMessage([{ type: "thinking", thinking: "The check failed; narrate the refusal." }, { type: "text", text: bare }], { stopReason: "stop" }),
			fauxAssistantMessage(wrapped),
		],
	});
	t.after(() => table.dispose());
	await table.table.session.prompt("I explain why I am here and ask for the clippings.");

	assert.ok(table.table.telemetry().some((entry) => entry.lane === "speech" && entry.steered === true), "the host dropped the bare draft for the speech steer");
	assert.equal(table.requests.length, 3, "one more model step, inside the same run");
	assert.deepEqual(steerIn(table.requests[2]), ["speech"], "that step carried the speech steer");
	assert.deepEqual(steerIn(table.requests[1]), [], "the step before it did not");
	const narrates = kernel(table.table, "table.narrate");
	assert.equal(narrates.length, 1);
	assert.equal(narrates[0].params.implicit, true);
	assert.equal(narrates[0].params.text, wrapped);

	const end = runEnd(table.events);
	assert.equal(end.status, "delivered");
	assert.equal(end.reason, "implicit_narrate");
	assert.equal(new Set(table.events.map((event) => event.runId)).size, 1, "one run");
	assert.equal(turnCloses(table.events).length, 2, "asked after the dropped draft, and after the steered answer");
	assert.deepEqual(hostSteers(table.table.session).map((message) => message.details.kind), ["speech"], "the steer was persisted once, as legacy's coc-host message");
	assert.equal(unfinished(table.table.session).length, 0);
});

test("§135.11: a thinking-only step after a failed check is steered once, and the Keeper's narrate then delivers the turn", async (t) => {
	const table = await hybridTable({
		env: { FAKE_KERNEL_CHECK_FAILS: "1", FAKE_KERNEL_PRESENT: "[]" },
		responses: [
			fauxAssistantMessage([fauxToolCall("resolve", { action: { intent: "investigate", goal: "the door frame", method: "look closely", skill: "Spot Hidden" } })], { stopReason: "toolUse" }),
			fauxAssistantMessage([{ type: "thinking", thinking: "The check failed. Do not offer a push." }], { stopReason: "stop" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "The frame tells you nothing you can use." })], { stopReason: "toolUse" }),
		],
	});
	t.after(() => table.dispose());
	await table.table.session.prompt("I look at the door frame.");

	assert.equal(table.requests.length, 3);
	assert.deepEqual(steerIn(table.requests[2]), ["steer"], "the turn-not-closed steer, the one legacy's agent_end sends");
	const end = runEnd(table.events);
	assert.equal(end.status, "delivered");
	assert.equal(end.reason, "delivery_accepted");
	assert.equal(kernel(table.table, "table.narrate").length, 1);
	assert.equal(unfinished(table.table.session).length, 0);
});

test("§135.11: a prose-only turn with no tool call is floor-steered once; a second leg that brings nothing delivers the dropped draft", async (t) => {
	const prose = "You wait by the door; nothing in the house answers.";
	const table = await hybridTable({
		env: { FAKE_KERNEL_PRESENT: "[]" },
		decide: (batch) => answered(batch, "finish"),
		responses: [
			fauxAssistantMessage(prose),
			fauxAssistantMessage([{ type: "thinking", thinking: "Nothing to add." }], { stopReason: "stop" }),
		],
	});
	t.after(() => table.dispose());
	await table.table.session.prompt("I wait.");

	assert.deepEqual(steerIn(table.requests[1]), ["floor"]);
	const narrates = kernel(table.table, "table.narrate");
	assert.equal(narrates.length, 1);
	assert.equal(narrates[0].params.text, prose, "the prose the floor steer dropped is what reached the player");
	assert.equal(runEnd(table.events).status, "delivered");
	assert.equal(unfinished(table.table.session).length, 0, "the notice never hides prose that existed");
});

test("§135.11: a Keeper who brings nothing twice ends undelivered with the notice, and no steer is left for the next input", async (t) => {
	const thought = () => fauxAssistantMessage([{ type: "thinking", thinking: "..." }], { stopReason: "stop" });
	const table = await hybridTable({
		env: { FAKE_KERNEL_PRESENT: "[]" },
		responses: [
			fauxAssistantMessage([fauxToolCall("resolve", { action: { intent: "investigate", goal: "the door frame", method: "look closely", skill: "Spot Hidden" } })], { stopReason: "toolUse" }),
			thought(),
			thought(),
		],
	});
	t.after(() => table.dispose());
	await table.table.session.prompt("I look at the door frame.");

	assert.equal(table.requests.length, 3, "the one steer, and no second");
	const end = runEnd(table.events);
	assert.equal(end.status, "undelivered");
	assert.equal(end.reason, "turn_close_steer_spent:no_delivered_evidence");
	assert.equal(turnCloses(table.events).length, 2);
	assert.equal(kernel(table.table, "table.narrate").length, 0);
	await waitFor(() => unfinished(table.table.session).length === 1, { label: "the §38 notice" });
	assert.equal(hostSteers(table.table.session).length, 1, "agent_end queued no second, stale steer");
	assert.equal(table.table.session.agent.hasQueuedMessages(), false, "nothing waits for the next input's first model step");
});
