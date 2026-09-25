/**
 * SL-50 stage 2 (contract §135.11.2): writes are silent, stated once per run in the clerk note's head.
 *
 * Long gate #6 kept 15 `text_beside_tool_calls` drops with the rule in the capsule's head (§135.11.1). The owner moved the
 * rule to the head line of the `coc-clerk` note, the message the model reads beside the carried views right before its step:
 * the run's first note carries `head` (right after `kind`), no later note of the run repeats it, and the next run states it
 * again. The capsule keeps its sentence.
 *
 * Through the hybrid engine on the emitted kernel with the faux Keeper and a stub Jev. Structure only: the key, its place and
 * its value (the exported constant), never wording.
 */
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { openTable } from "./harness.mjs";
import { CLERK_NOTE_HEAD, createHybridEngine } from "../../runtime/jev/hybrid-engine.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CAMPAIGN = "test-camp";

function kernelSteps(workspace, requests) {
	const input = requests.map((request, index) => JSON.stringify({ id: String(index), method: request[0], params: { campaign: CAMPAIGN, ...request[1] } })).join("\n");
	const run = spawnSync(process.execPath, [join(REPO, "build/kernel/rpc.mjs"), "--workspace", workspace, "--content", join(REPO, "content")],
		{ cwd: REPO, input: `${input}\n`, encoding: "utf8" });
	const frames = run.stdout.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line)).filter((frame) => !frame.progress);
	for (const frame of frames) if (!frame.ok) throw new Error(`kernel step ${frame.id} failed: ${JSON.stringify(frame.error)}`);
}
/** Every question: unclear on the compile, the Keeper on the route (`ask_llm`), unknown elsewhere. */
function answered(batch) {
	const answers = {};
	for (const question of batch.questions) {
		const choice = question.key === "exit" ? "ask_llm" : Object.keys(question.criteria)[0] === "now" ? "later" : Object.hasOwn(question.criteria, "unclear") ? "unclear" : "unknown";
		answers[question.key] = { status: "answered", type: "choice", choice, confidence: 0.9, probabilities: { [choice]: 0.9 } };
	}
	return { batchId: batch.id, status: "complete", answers, coverage: { required: Object.keys(answers), answered: Object.keys(answers), unknown: [] }, issues: [] };
}
/** The `coc-clerk` notes a request carries, in order, with the raw JSON (key order kept). */
const clerkNotes = (context) => context.messages.flatMap((message) => {
	const text = typeof message.content === "string" ? message.content : (message.content ?? []).map((block) => block.text ?? "").join("");
	const start = text.indexOf('{"kind":"single_loop_step"');
	return start < 0 ? [] : [text.slice(start, text.lastIndexOf("}") + 1)];
});

test("§135.11.2 the run's first clerk note carries the head right after kind; later notes of the run do not; the next run states it again", async (t) => {
	const requests = [];
	const engine = createHybridEngine({ env: process.env, decision: { decide: async (batch) => answered(batch) } });
	const table = await openTable({ realKernel: true, prepareWorkspace: (workspace) => kernelSteps(workspace, [
		["table.open", {}], ["table.player_input", { text: "我听他说完。" }], ["table.narrate", { call_id: "t1-c1", text: "诺特把委托说了一遍。" }]]),
		env: { PI_COC_LOOP_ENGINE: "hybrid-v1" }, runDriver: engine.runDriver, extraExtensions: [{ name: "coc-hybrid-engine", factory: engine.extension }],
		responses: [
			// Run 1: the Keeper files the leads and moves to the morgue, then writes the turn.
			fauxAssistantMessage([fauxToolCall("apply", { effects: [{ kind: "clue", clue: "knott-research-leads", how: "诺特列出该去查的地方。" },
				{ kind: "move", to: "newspaper-morgue" }] })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "你去了报馆。" })], { stopReason: "toolUse" }),
			// Run 2: one step.
			fauxAssistantMessage([fauxToolCall("narrate", { text: "你四下看了看。" })], { stopReason: "toolUse" }),
		].map((response) => (context) => { requests.push(context); return response; }) });
	t.after(() => table.dispose());
	await table.session.prompt("我接。先去《环球报》剪报室。");
	const firstRun = requests.length;
	await table.session.prompt("我看看这里都有谁。");
	assert.ok(firstRun >= 2 && requests.length === firstRun + 1, "run 1 took two model steps, run 2 one");

	// Run 1: the notes it sent, in order (a note stays in the request for the rest of the run: dedupe by its JSON).
	const runNotes = (from, to) => [...new Set(requests.slice(from, to).flatMap(clerkNotes))].map((raw) => JSON.parse(raw));
	const one = runNotes(0, firstRun);
	assert.ok(one.length >= 2, "run 1 sent a later note too (the carried scene after the move)");
	const [first, ...later] = one;
	assert.equal(first.head, CLERK_NOTE_HEAD, "the run's first note carries the rule");
	assert.deepEqual(Object.keys(first).slice(0, 2), ["kind", "head"], "as its head line, right after kind");
	assert.equal(clerkNotes(requests[0]).length, 1, "on the run's first model step");
	for (const note of later) assert.equal(Object.hasOwn(note, "head"), false, "a later note of the run does not repeat it");
	assert.ok(later.some((note) => note.carried), "the later note is the carried views' (their own head untouched)");

	// Run 2 states it again, once.
	const two = runNotes(firstRun, requests.length).filter((note) => !one.some((seen) => JSON.stringify(seen) === JSON.stringify(note)));
	assert.equal(two.filter((note) => Object.hasOwn(note, "head")).length, 1, "the next run's first note carries it");
	assert.equal(two[0].head, CLERK_NOTE_HEAD);
});

test("§135.11.2 at the engine: a run's first step with nothing else to say still has a note, carrying only the head; the next step with nothing to say has none", () => {
	const engine = createHybridEngine({ env: {}, decision: null });
	const handlers = new Map();
	engine.extension({ events: { on: (name, handler) => handlers.set(name, handler), emit: () => {} }, on: () => {}, getActiveTools: () => [], setActiveTools: () => {} });
	const project = (plan, step) => plan.ports.projection.project({ view: { policyState: { view: { consumed: [] } } }, step: { purpose: "compose", reason: "ask_llm" }, stepId: step });
	return (async () => {
		const plan = engine.runDriver.prepare({ runId: "run-1", inputRevision: "rev", rawInput: "x", session: {} });
		const [message] = await project(plan, "run-1:s1");
		assert.equal(message?.customType, "coc-clerk", "a note on the run's first model step");
		const note = JSON.parse(message.content);
		assert.deepEqual(Object.keys(note), ["kind", "head", "purpose", "reason"], "nothing else to say: the head alone");
		assert.equal(note.head, CLERK_NOTE_HEAD);
		assert.equal(await project(plan, "run-1:s2"), undefined, "the next step, with nothing new: no note, the head not repeated");
		const again = engine.runDriver.prepare({ runId: "run-2", inputRevision: "rev", rawInput: "y", session: {} });
		assert.equal(JSON.parse((await project(again, "run-2:s1"))[0].content).head, CLERK_NOTE_HEAD, "a new run states it again");
	})();
});
