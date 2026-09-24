/**
 * SL-23 (contract §135.11 addendum 2026-09-24, SL-23): a preparation wait never strands a turn, and never blocks the next one.
 *
 * The long live gate's turn 19 (`longgate-haunting-0624`, run `run-01a0d301-c8da-7552-937e-4f223e5bd6a9`, "我把找到的东西收好，
 * 离开宅子。"): the Keeper prepared a new destination (`lookup kind=adaptation action=prepare purpose=new_destination
 * name=corbitt-house-front`, 12.2 s, `pending`); its apply that registered and handed over the diaries (a `define` and an
 * `object`, nothing to do with the street) was refused `blocked: preparation_wait`; its prose was dropped for the wait
 * (`preparation_wait`), the turn close steered once (`adaptation-wait`), and the steered second leg was dropped for the wait
 * again, so the run ended `turn_close_steer_spent:no_delivered_evidence` with `unsent_fix: adaptation-wait` and the player
 * read the unfinished notice over a turn written twice. On turn 20 the clerk's compile-selected move to an existing scene
 * (`apply:move:commission-briefing`) was refused `blocked: preparation_wait` (the proposal was `ready` by then).
 *
 * A real Pi session from the vendored build, the product hybrid engine, a stub Jev `DecisionPort`, and the fake kernel
 * (the emitted kernel for the clerk's move on the next turn, where the kernel's own candidates and adaptation job are the
 * subject).
 */
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { customMessages, openTable, waitFor } from "./harness.mjs";
import { createHybridEngine } from "../../runtime/jev/hybrid-engine.ts";
import { ROUTE_FAMILY } from "../../runtime/jev/step-policy.ts";
import { isRunEvent } from "./pi-agent-core.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function answered(batch, pick = () => undefined) {
	const answers = {};
	for (const question of batch.questions) {
		const choice = pick(question) ?? (question.key === "exit" ? "continue" : Object.keys(question.criteria)[0] === "now" ? "later" : "unknown");
		answers[question.key] = { status: "answered", type: "choice", choice, confidence: 0.9, probabilities: { [choice]: 0.9 } };
	}
	return { batchId: batch.id, status: "complete", answers, coverage: { required: Object.keys(answers), answered: Object.keys(answers), unknown: [] }, issues: [] };
}
/** Every route hands the run to the Keeper; nothing is selected. */
const keeperAlways = (batch) => answered(batch, (question) => question.key === "exit" ? "ask_llm" : undefined);

async function hybridTable({ responses, env = {}, decide = keeperAlways, realKernel = false, prepareWorkspace }) {
	const decisions = [], events = [], requests = [], calls = [];
	const engine = createHybridEngine({ env: process.env, decision: { decide: async (batch, lease) => { decisions.push(batch); return decide(batch, decisions.length, lease); } } });
	const probe = { name: "sl23-call-probe", factory(pi) {
		pi.on("tool_call", (event) => { calls.push({ phase: "call", id: event.toolCallId, tool: event.toolName, input: structuredClone(event.input) }); });
		pi.on("tool_result", (event) => { calls.push({ phase: "result", id: event.toolCallId, tool: event.toolName, isError: event.isError === true,
			text: (event.content ?? []).map((block) => block.text ?? "").join("") }); });
	} };
	const table = await openTable({
		realKernel, prepareWorkspace,
		env: { PI_COC_LOOP_ENGINE: "hybrid-v1", PI_COC_ADAPTATION_WAIT_MS: "0", ...(realKernel ? {} : { FAKE_KERNEL_WORKSPACE: "1", FAKE_KERNEL_PRESENT: "[]" }), ...env },
		runDriver: engine.runDriver,
		extraExtensions: [{ name: "coc-hybrid-engine", factory: engine.extension }, probe],
		responses: responses.map((response) => (context) => { requests.push(structuredClone(context.messages)); return typeof response === "function" ? response(context) : response; }),
	});
	table.session.subscribe((event) => { if (isRunEvent(event)) events.push(event); });
	return { table, events, requests, decisions, calls, dispose: () => table.dispose() };
}

const kernel = (table, method) => table.kernelRequests().filter((request) => request.method === method);
const runEnds = (events) => events.filter((event) => event.type === "run_end");
const unfinished = (session) => customMessages(session, "coc-delivery").filter((message) => message.details?.turn_unfinished);
const lastAssistantText = (session) => (session.messages.filter((message) => message.role === "assistant").at(-1)?.content ?? [])
	.filter((block) => block.type === "text").map((block) => block.text).join("");
const drops = (table) => table.table.telemetry().filter((entry) => entry.lane === "delivery" && entry.ok === false).map((entry) => entry.reason);
const closes = (table) => table.table.telemetry().filter((entry) => entry.lane === "turn" && entry.event === "turn_close");
const blocked = (table) => table.table.telemetry().filter((entry) => entry.code === "blocked" && entry.reason === "preparation_wait");

const PROPOSAL = "corbitt-house-front";
const prepare = () => fauxAssistantMessage([fauxToolCall("lookup", { kind: "adaptation", action: "prepare", purpose: "new_destination", name: PROPOSAL,
	anchors: ["scene: corbitt-house-ground"], request: "The investigator walks out the front door onto the public street in front of the house." })], { stopReason: "toolUse" });
/** Turn 19's s10: process talk beside the apply that registers and hands over the diaries (nothing to do with the street). */
const diaries = () => fauxAssistantMessage([{ type: "text", text: "I'll register the diaries first." },
	fauxToolCall("apply", { effects: [
		{ kind: "define", name: "three old diaries", description: "Three closed diaries, W. Corbitt on the spines.", category: "item" },
		{ kind: "object", name: "three old diaries", to: "Thomas Hayes", definition: "three old diaries", why: "you pick up the diaries and keep them shut" }] })],
	{ stopReason: "toolUse" });
const FIRST = "You gather the three closed diaries into your coat. The front door is still at the end of the hall.";
const SECOND = "You press the diaries under your coat and push yourself up. The hall runs to the front door.";

test("SL-23 (turn 19): a Keeper that prepares a destination and writes prose twice is delivered, the wait stated, and its unrelated write lands", async (t) => {
	const table = await hybridTable({
		env: { FAKE_KERNEL_ADAPTATION_PENDING: "1" },
		responses: [prepare(), diaries(), fauxAssistantMessage(FIRST), fauxAssistantMessage(SECOND)],
	});
	t.after(() => table.dispose());
	await table.table.session.prompt("I pack what I found and leave the house.");

	// The write that does not depend on the destination is not the wait's to refuse.
	const applies = kernel(table.table, "table.apply");
	assert.equal(applies.length, 1, "the diaries' define and object reached the kernel");
	assert.deepEqual(applies[0].params.effects.map((effect) => effect.kind), ["define", "object"]);
	assert.equal(blocked(table).length, 0, "nothing was blocked for the wait");
	const cost = table.table.telemetry().find((entry) => entry.lane === "adaptation" && entry.event === "prepare");
	assert.equal(cost?.proposal, PROPOSAL, "what the prepare cost the turn is on a row");
	assert.equal(cost.status, "pending");
	assert.equal(cost.wait_budget_ms, 0, "the budget it was given (PI_COC_ADAPTATION_WAIT_MS here)");
	assert.equal(typeof cost.ms, "number");

	// The first prose was dropped once and steered; the steered leg was delivered, carrying the wait.
	const narrates = kernel(table.table, "table.narrate");
	assert.equal(narrates.length, 1);
	assert.equal(narrates[0].params.implicit, true);
	assert.equal(narrates[0].params.text, SECOND, "the steered second leg is what was delivered");
	assert.deepEqual(narrates[0].params.preparation_wait, { kind: "adaptation", name: PROPOSAL }, "the implicit narrate states the wait");
	assert.equal(lastAssistantText(table.table.session), SECOND);
	assert.deepEqual(drops(table), ["text_beside_tool_calls", "preparation_wait"], "one wait drop, not two");

	const end = runEnds(table.events).at(-1);
	assert.equal(end.status, "delivered");
	assert.equal(end.reason, "implicit_narrate");
	const turnClose = closes(table);
	assert.equal(turnClose[0].status, "steer");
	assert.equal(turnClose[0].kind, "adaptation-wait");
	assert.equal(turnClose.at(-1).status, "delivered");
	assert.ok(turnClose.every((row) => row.unsent_fix === undefined), "the wait's own fix travelled with its steer");
	assert.equal(unfinished(table.table.session).length, 0, "no unfinished notice over a written turn");
});

test("SL-23: a steered second leg that brings nothing under a wait delivers the draft the wait dropped", async (t) => {
	const table = await hybridTable({
		env: { FAKE_KERNEL_ADAPTATION_PENDING: "1" },
		responses: [prepare(), fauxAssistantMessage(FIRST), fauxAssistantMessage([{ type: "thinking", thinking: "Nothing to add." }], { stopReason: "stop" })],
	});
	t.after(() => table.dispose());
	await table.table.session.prompt("I pack what I found and leave the house.");

	const narrates = kernel(table.table, "table.narrate");
	assert.deepEqual(narrates.map((request) => request.params.text), [FIRST]);
	assert.deepEqual(narrates[0].params.preparation_wait, { kind: "adaptation", name: PROPOSAL });
	assert.equal(runEnds(table.events).at(-1).status, "delivered");
	assert.equal(unfinished(table.table.session).length, 0);
});

const REPEATED = { code: "needs", message: "This line was already said at this table.",
	fix: "Rewrite only that line and deliver again; everything else stands.", details: { reason: "repeated_line" } };

test("SL-23: the steered second leg refused under a wait falls back to the dropped draft (SL-16's fallback)", async (t) => {
	const table = await hybridTable({
		env: { FAKE_KERNEL_ADAPTATION_PENDING: "1", FAKE_KERNEL_ERRORS: JSON.stringify({ "table.narrate": REPEATED }), FAKE_KERNEL_ERRORS_ONCE: "1" },
		responses: [prepare(), fauxAssistantMessage(FIRST), fauxAssistantMessage(SECOND)],
	});
	t.after(() => table.dispose());
	await table.table.session.prompt("I pack what I found and leave the house.");

	const narrates = kernel(table.table, "table.narrate");
	assert.deepEqual(narrates.map((request) => request.params.text), [SECOND, FIRST], "the second leg first, then the draft the wait dropped");
	assert.ok(narrates.every((request) => request.params.preparation_wait?.name === PROPOSAL), "both carry the wait");
	assert.equal(lastAssistantText(table.table.session), FIRST);
	assert.deepEqual(drops(table), ["preparation_wait", "steered_leg_refused"]);
	assert.equal(runEnds(table.events).at(-1).reason, "implicit_narrate");
	assert.equal(unfinished(table.table.session).length, 0);
});

test("SL-23: both legs refused under a wait: undelivered, the notice, and every drop on its row", async (t) => {
	const table = await hybridTable({
		env: { FAKE_KERNEL_ADAPTATION_PENDING: "1", FAKE_KERNEL_ERRORS: JSON.stringify({ "table.narrate": REPEATED }) },
		responses: [prepare(), fauxAssistantMessage(FIRST), fauxAssistantMessage(SECOND)],
	});
	t.after(() => table.dispose());
	await table.table.session.prompt("I pack what I found and leave the house.");

	assert.equal(table.requests.length, 3, "no model step past the one steer");
	assert.deepEqual(kernel(table.table, "table.narrate").map((request) => request.params.text), [SECOND, FIRST], "the fallback is tried once");
	assert.equal(runEnds(table.events).at(-1).status, "undelivered");
	assert.deepEqual(drops(table), ["preparation_wait", "steered_leg_refused", "implicit_narrate_refused"]);
	const last = closes(table).at(-1);
	assert.equal(last.reason, "steer_spent");
	assert.equal(last.unsent_fix, "audit-repair", "the kernel's repair is named; the wait's own fix is not left behind");
	await waitFor(() => unfinished(table.table.session).length === 1, { label: "the §38 notice" });
});

test("SL-23: a pending preparation still blocks the write that needs it -- a move to the destination it is building", async (t) => {
	const table = await hybridTable({
		env: { FAKE_KERNEL_ADAPTATION_PENDING: "1" },
		responses: [
			prepare(),
			fauxAssistantMessage([fauxToolCall("apply", { effects: [{ kind: "move", to: PROPOSAL }] })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: FIRST })], { stopReason: "toolUse" }),
		],
	});
	t.after(() => table.dispose());
	await table.table.session.prompt("I pack what I found and leave the house.");

	assert.equal(kernel(table.table, "table.apply").length, 0, "the move to the destination waits for it");
	const rows = blocked(table);
	assert.equal(rows.length, 1);
	assert.equal(rows[0].tool, "apply");
	assert.equal(rows[0].proposal, PROPOSAL);
	const refusal = table.table.session.messages.find((message) => message.role === "toolResult" && message.toolName === "apply");
	assert.equal(refusal?.isError, true);
	assert.match((refusal.content ?? []).map((block) => block.text ?? "").join(""), new RegExp(`Adaptation preparation for ${PROPOSAL} is still running`));
	assert.equal(kernel(table.table, "table.narrate").length, 1);
	assert.equal(runEnds(table.events).at(-1).status, "delivered");
});

/** One kernel request batch on the workspace, through the emitted kernel's own RPC (to put the table in a state). */
function kernelSteps(workspace, campaign, requests) {
	const input = requests.map((request, index) => JSON.stringify({ id: String(index), method: request[0], params: { campaign, ...request[1] } })).join("\n");
	const run = spawnSync(process.execPath, [join(REPO, "build/kernel/rpc.mjs"), "--workspace", workspace, "--content", join(REPO, "content")],
		{ cwd: REPO, input: `${input}\n`, encoding: "utf8" });
	const frames = run.stdout.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line)).filter((frame) => !frame.progress);
	for (const frame of frames) if (!frame.ok) throw new Error(`fixture step ${frame.id} failed: ${JSON.stringify(frame.error)}`);
	return frames;
}

test("SL-23 (turn 20): the next turn's clerk move to an existing scene is not blocked by a preparation still held from the last turn", async (t) => {
	const campaign = "test-camp";
	// The lead clue landed on turn 1, so the kernel issues the Globe as a move (as in single-loop-domain-policy.test.mjs).
	const prepareWorkspace = (workspace) => kernelSteps(workspace, campaign, [
		["table.open", {}], ["table.player_input", { text: "我听着" }],
		["table.apply", { call_id: "t1-c1", effects: [{ kind: "clue", clue: "knott-research-leads", how: "he said so" }] }],
		["table.narrate", { call_id: "t1-c2", text: "他递给你一张写着地方的纸。" }],
	]);
	let turn = 0;
	const table = await hybridTable({
		realKernel: true, prepareWorkspace,
		// The adaptation creator is a child that never answers, so the job is still held when the next turn opens.
		env: { PI_COC_READER_CMD: JSON.stringify([process.execPath, "-e", "setTimeout(() => {}, 600000)"]) },
		decide: (batch) => batch.family !== ROUTE_FAMILY ? answered(batch)
			: turn === 1 ? keeperAlways(batch)
				: answered(batch, (question) => question.key === "exit" ? "continue" : /Boston Globe offices/.test(question.target ?? "") ? "now" : undefined),
		responses: [
			// Turn 2 (the first prompt): the Keeper prepares a place the book does not have, and says what the player did.
			fauxAssistantMessage([fauxToolCall("lookup", { kind: "adaptation", action: "prepare", purpose: "new_destination", name: "harbor-flat",
				anchors: ["scene: commission-briefing"], request: "A rented flat by the harbor the investigator chose to take." })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "你把地址记在本子上。" })], { stopReason: "toolUse" }),
			// Turn 3: after the clerk's move, the Keeper closes.
			fauxAssistantMessage([fauxToolCall("narrate", { text: "你到了报馆。" })], { stopReason: "toolUse" }),
		],
	});
	t.after(() => table.dispose());
	turn = 1;
	await table.table.session.prompt("我要在港口租一间屋子住下。");
	const held = table.table.telemetry(campaign).filter((entry) => entry.lane === "adaptation" && entry.held === true);
	turn = 2;
	await table.table.session.prompt("我去《环球报》报馆。");

	const telemetry = table.table.telemetry(campaign);
	assert.ok(telemetry.some((entry) => entry.lane === "adaptation" && entry.held === true && entry.proposal === "harbor-flat"),
		`the next turn's boundary still held the preparation (${JSON.stringify(held)})`);
	const refused = telemetry.filter((entry) => entry.code === "blocked" && entry.reason === "preparation_wait");
	assert.deepEqual(refused, [], "nothing on the next turn was blocked for the held preparation");
	const move = table.calls.find((call) => call.phase === "call" && call.tool === "apply" && call.id.startsWith("clerk:"));
	assert.deepEqual(move?.input.effects, [{ kind: "move", to: "newspaper-morgue" }], "the clerk selected the declared move");
	const moved = table.calls.find((call) => call.phase === "result" && call.id === move.id);
	assert.equal(moved.isError, false, `the clerk's move landed: ${moved.text}`);
	assert.equal(runEnds(table.events).at(-1).status, "delivered");
});

test("SL-23: a proposal the clerk's move staled is told to the Keeper once, on the Keeper's own call, never by refusing the clerk's next write", async (t) => {
	const campaign = "test-camp";
	const prepareWorkspace = (workspace) => kernelSteps(workspace, campaign, [
		["table.open", {}], ["table.player_input", { text: "我听着" }],
		["table.apply", { call_id: "t1-c1", effects: [{ kind: "clue", clue: "knott-research-leads", how: "he said so" }] }],
		["table.narrate", { call_id: "t1-c2", text: "他递给你一张写着地方的纸。" }],
	]);
	let turn = 0;
	const want = { 2: /Boston Globe offices/, 3: /Knott/ };
	const table = await hybridTable({
		realKernel: true, prepareWorkspace,
		env: { PI_COC_READER_CMD: JSON.stringify([process.execPath, "-e", "setTimeout(() => {}, 600000)"]) },
		decide: (batch) => batch.family !== ROUTE_FAMILY ? answered(batch)
			: turn === 1 ? keeperAlways(batch)
				: answered(batch, (question) => question.key === "exit" ? "continue" : want[turn].test(question.target ?? "") ? "now" : undefined),
		responses: [
			fauxAssistantMessage([fauxToolCall("lookup", { kind: "adaptation", action: "prepare", purpose: "new_destination", name: "harbor-flat",
				anchors: ["scene: commission-briefing"], request: "A rented flat by the harbor the investigator chose to take." })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "你把地址记在本子上。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "你到了报馆。" })], { stopReason: "toolUse" }),
			// Turn 3: the Keeper's first own call reads the notice; its second is taken.
			fauxAssistantMessage([fauxToolCall("narrate", { text: "你回到了诺特的办公室。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "你回到了诺特的办公室。" })], { stopReason: "toolUse" }),
		],
	});
	t.after(() => table.dispose());
	turn = 1; await table.table.session.prompt("我要在港口租一间屋子住下。");
	turn = 2; await table.table.session.prompt("我去《环球报》报馆。");
	turn = 3; await table.table.session.prompt("我回诺特的办公室。");

	const telemetry = table.table.telemetry(campaign);
	assert.ok(telemetry.some((entry) => entry.lane === "adaptation" && entry.status === "stale" && entry.proposal === "harbor-flat"),
		"the clerk's move staled the held proposal, and the next boundary read it");
	const clerkMoves = table.calls.filter((call) => call.phase === "call" && call.tool === "apply" && call.id.startsWith("clerk:"));
	assert.deepEqual(clerkMoves.map((call) => call.input.effects[0].to), ["newspaper-morgue", "commission-briefing"]);
	for (const move of clerkMoves) {
		const result = table.calls.find((call) => call.phase === "result" && call.id === move.id);
		assert.equal(result?.isError, false, `the clerk's move to ${move.input.effects[0].to} landed: ${result?.text}`);
	}
	const notice = telemetry.filter((entry) => entry.code === "blocked" && entry.reason === "adaptation_stale");
	assert.equal(notice.length, 1, "said once");
	assert.equal(notice[0].tool, "narrate", "on the Keeper's own call");
	assert.equal(runEnds(table.events).at(-1).status, "delivered");
});

test("SL-23: a retained ready proposal blocks neither reads nor unrelated writes; a move there is refused with the ready instruction", async (t) => {
	const table = await hybridTable({
		env: { FAKE_KERNEL_RETAINED_ADAPTATION_STATUS: "ready" },
		responses: [
			fauxAssistantMessage([fauxToolCall("look", { focus: "scene" }), fauxToolCall("apply", { effects: [{ kind: "time", minutes: 5, why: "the walk" }] })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("apply", { effects: [{ kind: "move", to: "Athens Study" }] })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "You take stock." })], { stopReason: "toolUse" }),
		],
	});
	t.after(() => table.dispose());
	await table.table.session.prompt("Continue after reopening.");

	const applies = kernel(table.table, "table.apply");
	assert.deepEqual(applies.map((request) => request.params.effects[0].kind), ["time"], "the unrelated write landed; the move there did not");
	assert.ok(kernel(table.table, "table.look").length >= 1, "the read was taken");
	const rows = blocked(table);
	assert.equal(rows.length, 1);
	assert.equal(rows[0].status, "ready");
	const refusal = table.table.session.messages.filter((message) => message.role === "toolResult" && message.toolName === "apply" && message.isError)
		.map((message) => (message.content ?? []).map((block) => block.text ?? "").join("")).join("\n");
	assert.match(refusal, /is ready, which means it has finished/);
	assert.match(refusal, /lookup kind=adaptation action=status name="athens-study"/);
	assert.equal(runEnds(table.events).at(-1).status, "delivered");
});

test("SL-23: a steered leg that tries the move the wait refuses, then brings nothing, delivers the held draft", async (t) => {
	const table = await hybridTable({
		env: { FAKE_KERNEL_ADAPTATION_PENDING: "1" },
		responses: [prepare(), fauxAssistantMessage(FIRST),
			fauxAssistantMessage([fauxToolCall("apply", { effects: [{ kind: "move", to: PROPOSAL }] })], { stopReason: "toolUse" }),
			fauxAssistantMessage([{ type: "thinking", thinking: "The move waits." }], { stopReason: "stop" })],
	});
	t.after(() => table.dispose());
	await table.table.session.prompt("I pack what I found and leave the house.");

	assert.equal(blocked(table).length, 1, "the move to the destination was refused");
	assert.deepEqual(kernel(table.table, "table.narrate").map((request) => request.params.text), [FIRST]);
	assert.equal(runEnds(table.events).at(-1).status, "delivered");
	assert.ok(closes(table).every((row) => row.unsent_fix === undefined));
	assert.equal(unfinished(table.table.session).length, 0);
});
