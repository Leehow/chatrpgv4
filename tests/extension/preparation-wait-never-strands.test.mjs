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
import { createHybridEngine } from "./hybrid-engine-fixture.mjs";
import { ROUTE_FAMILY } from "../../runtime/jev/step-policy.ts";
import { COMPILE_FAMILY } from "../../runtime/jev/route-compile.ts";
import { isRunEvent } from "./pi-agent-core.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const baseQuestion = (question) => ({ ...question, key: question.key.replace(/__(?:semantic_facts|semantic_execution)$/, "") });
function issuedChoice(question, value, confidence = 0.9) {
	const keys = Object.keys(question.criteria);
	assert.ok(keys.includes(value), `fixture choice ${value} is not issued for ${question.key}`);
	return { status: "answered", type: "choice", choice: value, confidence,
		probabilities: Object.fromEntries(keys.map((key) => [key, keys.length === 1 ? 1 : key === value ? confidence : (1 - confidence) / (keys.length - 1)])) };
}
function answered(batch, pick = () => undefined) {
	const answers = {};
	for (const question of batch.questions) {
		if(batch.family==='continuous-action-admission'){
			answers[question.key]={status:'answered',type:'noul',noul:.99};
			continue;
		}
		const choice = pick(baseQuestion(question)) ?? (baseQuestion(question).key === "exit" ? "continue" : Object.hasOwn(question.criteria, "costs") ? "none" : Object.keys(question.criteria)[0] === "now" ? "later" : "unknown");
		answers[question.key] = issuedChoice(question, choice);
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

const REPEATED = { code: "needs", message: "This line was already said at this table.",
	fix: "Rewrite only that line and deliver again; everything else stands.", details: { reason: "repeated_line" } };





test("SL-23: a pending preparation still blocks the write that needs it -- a move to the destination it is building", async (t) => {
	const table = await hybridTable({
		env: { FAKE_KERNEL_ADAPTATION_PENDING: "1" },
		responses: [
			prepare(),
			fauxAssistantMessage([fauxToolCall("apply", { effects: [{ kind: "move", to: PROPOSAL }] })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("output", { text: FIRST })], { stopReason: "toolUse" }),
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

test("SL-23: a retained ready proposal blocks neither reads nor unrelated writes; a move there is refused with the ready instruction", async (t) => {
	const table = await hybridTable({
		env: { FAKE_KERNEL_RETAINED_ADAPTATION_STATUS: "ready" },
		responses: [
			fauxAssistantMessage([fauxToolCall("look", { focus: "scene" }), fauxToolCall("apply", { effects: [{ kind: "time", minutes: 5, why: "the walk" }] })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("apply", { effects: [{ kind: "move", to: "Athens Study" }] })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("output", { text: "You take stock." })], { stopReason: "toolUse" }),
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



// Section 166 retires prose-repair retries. Single-pass delivery and real task guards have current coverage in single-pass-narration.test.mjs and jev-s0-delivery-guard.test.mjs.
