/**
 * SL-102 (contract §135.20.1): the source material the Keeper looked up stays in its hands while the scene lasts.
 *
 * Long gate #24 (`longgate24-haunting-2238`): five lookups repeated the previous turn's consultation of the same focus. Every
 * one was an answer still being read when the next turn's first model step was built: the note said `pending`, the answer
 * landed 0.25-5 s into that step, the Keeper asked again (the memo answered in 20 ms), and the step after carried the same
 * answer a second time. Beside that, nothing carried an answer past the one step it landed on: a turn's request keeps no
 * earlier turn's notes or tool results.
 *
 * - The ledger (`PendingAnswers`): an answer handed at a scene is held per run, deduplicated by focus and question, bounded
 *   by `HELD_ANSWERS_BYTES` (the newest kept), dropped when the scene changes; `settle` waits for an earlier turn's
 *   consultation at this scene, bounded, and not for another scene's.
 * - The carried section: a held answer is a `source_answer` view marked `held`, served last, cut like any view, and named
 *   in `omitted` when the message's budget is spent.
 * - On the emitted kernel through the vendored driver, with a stub reading bridge (the real lookup path): an answer from turn
 *   N rides turn N+1's first model step at the same scene, once, and is gone after a move; the memo's answers are held
 *   within the budget; an answer the Keeper's own lookup returned is not carried again in that run; the next turn's first
 *   step waits for this scene's consultation and carries it landed, and does not wait for another scene's.
 */
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { openTable } from "./harness.mjs";
import { supportChoices } from "./support-agent-helpers.mjs";
import { createHybridEngine } from "./hybrid-engine-fixture.mjs";
import { BIND_FAMILY, ROUTE_FAMILY } from "../../runtime/jev/step-policy.ts";
import { COMPILE_FAMILY } from "../../runtime/jev/route-compile.ts";
import { CARRIED_ANSWERS_HEAD, CARRIED_HELD_HEAD, CARRIED_VIEW_BYTES, CARRIED_VIEWS_BYTES, HELD_ANSWERS_BYTES, carriedSection, readCarriedViews } from "../../runtime/jev/carried-views.ts";
import { PendingAnswers, memoAnswer } from "../../extensions/kernel/source-answers.ts";
import { sourceAnswerPage, withSourceQuestion } from "../../runtime/jev/source-answer-pages.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CAMPAIGN = "test-camp";
const size = (value) => Buffer.byteLength(JSON.stringify(value), "utf8");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** A checked answer as the reading service returns it; `answer` carries a sentinel so a request can be searched for it. */
const checked = (answer, extra = {}) => ({ status: "answered", answer, source_refs: [{ source_id: "pdf:the-haunting", pdf_index: 1 }], limitations: "",
	authority: "source-consultation", prepared: false, supported: true, ...extra });

// ---------------------------------------------------------------------------------------------------
// The ledger.
// ---------------------------------------------------------------------------------------------------

test("§135.20.1 the ledger: an answer handed at a scene comes back once per run while the party stays, the newer answer to the same question replaces the older, and a scene change drops it with a row", () => {
	const rows = [], list = new PendingAnswers((row) => rows.push(row));
	list.hold("c", "office", [{ focus: "office", question: "Who lived here?", answer: checked("first answer") }], 2, "run-2");
	assert.deepEqual(list.take("c", { scene: "office", run: "run-2" }).held, [], "the run whose request holds it does not get it again");
	const next = list.take("c", { scene: "office", run: "run-3" }).held;
	assert.deepEqual(next.map((entry) => [entry.focus, entry.question, entry.answer.answer, entry.since_turn]), [["office", "Who lived here?", "first answer", 2]]);
	assert.deepEqual(list.take("c", { scene: "office", run: "run-3" }).held, [], "once per run");
	list.hold("c", "office", [{ focus: "office", question: "Who lived here?", answer: checked("second answer") },
		{ focus: "office", question: "What is in the drawer?", answer: checked("drawer answer") },
		{ focus: "office", question: "Unanswered?", answer: { status: "unresolved", supported: false } }], 3, "run-3");
	const fourth = list.take("c", { scene: "office", run: "run-4" }).held;
	assert.deepEqual(fourth.map((entry) => entry.answer.answer), ["drawer answer", "second answer"],
		"newest first; one entry per focus and question (the newer answer replaced the older); nothing without a readable answer is held");
	assert.deepEqual(list.take("c", { scene: "house", run: "run-5" }).held, [], "another scene holds none of them");
	const dropped = rows.filter((row) => row.event === "held_dropped");
	assert.deepEqual(dropped.map((row) => [row.reason, row.scene, row.foci]), [["scene_change", "house", ["office", "office"]]]);
	assert.deepEqual(list.take("c", { scene: "office", run: "run-6" }).held, [], "dropped for good: coming back does not bring them back");
	assert.ok(rows.every((row) => !JSON.stringify(row).includes("Who lived here?")), "telemetry never writes the Keeper's question");
});

test("§135.20.1 the ledger: a scene's shelf keeps its newest answers within HELD_ANSWERS_BYTES, each counted at most one carried view, and drops the older with a budget row", () => {
	const rows = [], list = new PendingAnswers((row) => rows.push(row));
	const answers = [1, 2, 3, 4, 5].map((n) => ({ focus: "office", question: `q${n}`, answer: checked(`${n}:${"a".repeat(2400)}`) }));
	list.hold("c", "office", answers, 2, "run-2");
	const held = list.take("c", { scene: "office", run: "run-3" }).held;
	assert.deepEqual(held.map((entry) => entry.question), ["q5", "q4", "q3"], "the newest three fit 8 KiB; q1 and q2 do not");
	assert.ok(held.reduce((total, entry) => total + size({ question: entry.question, ...entry.answer }), 0) <= HELD_ANSWERS_BYTES);
	assert.deepEqual(rows.filter((row) => row.event === "held_dropped").map((row) => [row.reason, row.foci]), [["budget", ["office", "office"]]]);
	// One answer bigger than a carried view costs one carried view: it is cut to 4 KiB when it rides, not refused.
	const big = new PendingAnswers(() => {});
	big.hold("c", "office", [{ focus: "office", question: "long", answer: checked("b".repeat(9000)) }, { focus: "office", question: "short", answer: checked("s") }], 2, "run-2");
	assert.deepEqual(big.take("c", { scene: "office", run: "run-3" }).held.map((entry) => entry.question), ["short", "long"]);
});

test("§135.20.1 the ledger: a landed answer the Keeper's own lookup returned in this run is not carried again; a landed one is held at the scene it was asked", async () => {
	const list = new PendingAnswers(() => {});
	let land;
	list.register("c", { focus: "office", question: "q1" }, 2, "read-1", new Promise((resolve) => { land = resolve; }), "answer", "office");
	assert.deepEqual(list.take("c", { scene: "office", run: "run-3" }).pending.map((row) => row.focus), ["office"]);
	land({ state: "ready", source_answer: checked("landed answer") });
	await pause(5);
	list.hold("c", "office", [{ focus: "office", question: "q1", answer: checked("landed answer") }], 3, "run-3");
	const taken = list.take("c", { scene: "office", run: "run-3" });
	assert.deepEqual(taken.landed, [], "the Keeper's lookup in this run already returned it");
	assert.deepEqual(taken.handed, [{ focus: "office", since_turn: 2 }], "named, never silent");
	assert.deepEqual(taken.held, []);
	assert.deepEqual(list.take("c", { scene: "office", run: "run-4" }).held.map((entry) => entry.answer.answer), ["landed answer"], "the next run carries it held");
	// A landed answer nobody fetched: carried once as landed, and held beside it without a second copy in the same take.
	const other = new PendingAnswers(() => {});
	let arrive;
	other.register("c", { focus: "office", question: "q2" }, 2, "read-2", new Promise((resolve) => { arrive = resolve; }), "answer", "office");
	arrive({ state: "ready", source_answer: checked("second landed") });
	await pause(5);
	const first = other.take("c", { scene: "office", run: "run-3" });
	assert.deepEqual([first.landed.map((entry) => entry.answer.answer), first.held], [["second landed"], []]);
	assert.deepEqual(other.take("c", { scene: "office", run: "run-4" }).held.map((entry) => entry.answer.answer), ["second landed"]);
	// Asked at another scene than the party's now: carried once as landed (§135.31.2), never held here.
	const away = new PendingAnswers(() => {});
	let late;
	away.register("c", { focus: "cellar", question: "q3" }, 2, "read-3", new Promise((resolve) => { late = resolve; }), "answer", "cellar");
	late({ state: "ready", source_answer: checked("cellar answer") });
	await pause(5);
	const moved = away.take("c", { scene: "office", run: "run-3" });
	assert.deepEqual([moved.landed.length, moved.held], [1, []]);
	assert.deepEqual(away.take("c", { scene: "office", run: "run-4" }).held, []);
});

test("§135.20.1 the ledger: settle waits, bounded, only for this scene's consultations from an earlier turn, and reports what it did", async () => {
	const list = new PendingAnswers(() => {});
	let land;
	list.register("c", { focus: "office", question: "q1" }, 2, "read-1", new Promise((resolve) => { land = resolve; }), "answer", "office");
	list.register("c", { focus: "cellar", question: "q2" }, 2, "read-2", new Promise(() => {}), "answer", "cellar");
	list.register("c", { focus: "office", question: "q3" }, 3, "read-3", new Promise(() => {}), "answer", "office");
	list.register("c", { focus: "office", question: "q4" }, 2, "read-4", new Promise(() => {}), "prepare", "office");
	setTimeout(() => land({ state: "ready", source_answer: checked("office answer") }), 40);
	const began = Date.now();
	const report = await list.settle("c", { scene: "office", turn: 3, ms: 5000 });
	assert.ok(Date.now() - began < 2000, "it returned when the answer landed, not at the bound");
	assert.deepEqual([report.foci, report.landed, report.pending, report.bound_ms], [["office"], 1, 0, 5000],
		"only turn 2's answer consultation at the office: not the cellar's, not this turn's, not a prepare");
	assert.ok(report.waited_ms >= 30, `it waited for the landing (${report.waited_ms} ms)`);
	assert.deepEqual(list.take("c", { scene: "office", run: "run-3" }).landed.map((entry) => entry.answer.answer), ["office answer"]);
	// Never lands: the bound ends the wait, and the entry is still pending.
	const stuck = new PendingAnswers(() => {});
	stuck.register("c", { focus: "office", question: "q1" }, 2, "read-1", new Promise(() => {}), "answer", "office");
	const bounded = await stuck.settle("c", { scene: "office", turn: 3, ms: 60 });
	assert.deepEqual([bounded.landed, bounded.pending], [0, 1]);
	assert.ok(bounded.waited_ms >= 50 && bounded.waited_ms < 2000, `bounded (${bounded.waited_ms} ms)`);
	const spent = await stuck.settle("c", { scene: "office", turn: 3, ms: -20 });
	assert.deepEqual([spent.waited_ms, spent.bound_ms, spent.pending], [0, 0, 1], "nothing left of the allowance: no wait");
	const elsewhere = await stuck.settle("c", { scene: "cellar", turn: 3, ms: 5000 });
	assert.deepEqual([elsewhere.foci, elsewhere.waited_ms], [[], 0]);
});

// ---------------------------------------------------------------------------------------------------
// The carried section.
// ---------------------------------------------------------------------------------------------------

test("§135.20.1 a held answer rides last as a source_answer marked held, cut to one view; past the message's budget it is omitted as budget and still named held; the head says what it is", async () => {
	const held = [{ name: "office", view: { question: "Who lived here?", ...checked("h".repeat(6000)) } }];
	const alone = await readCarriedViews({ call: async () => ({}), people: [], held });
	assert.deepEqual(alone.views.map((entry) => [entry.focus, entry.name, entry.held]), [["source_answer", "office", true]]);
	assert.ok(size(alone.views[0].view) <= CARRIED_VIEW_BYTES && alone.views[0].truncated === true, "cut to one carried view, and marked");
	const partial = alone.views[0].view;
	assert.equal(partial.question, "Who lived here?", "the question stays with exact partial delivery");
	assert.equal(partial.status, "partial");
	assert.equal(partial.source_status, "answered");
	assert.equal(partial.delivery.complete, false);
	assert.equal(partial.authority, "source-consultation");
	assert.equal(partial.limitations, "");
	assert.deepEqual(partial.source_refs, checked("").source_refs);
	assert.ok(partial.retained_parts.length > 0);
	for (const unit of partial.retained_parts) {
		assert.equal(unit.path, "/answer");
		assert.equal(unit.range.total, 6000);
		assert.equal(unit.value, held[0].view.answer.slice(unit.range.start, unit.range.end), "retained text is an exact original range");
	}
	assert.ok(partial.delivery.omitted_units > 0, "the full answer is not claimed by this page");
	assert.equal(partial.read_next, undefined, "this uncached fixture must not invent a continuation");
	assert.equal(partial.delivery.cache_unavailable, true);
	const section = carriedSection(alone);
	assert.equal(section.views[0].held, true, "the Keeper reads the mark");
	assert.ok(section.head.includes(CARRIED_HELD_HEAD));
	assert.ok(!section.head.includes(CARRIED_ANSWERS_HEAD), "not told it just came back");
	const landed = [{ name: "cellar", view: { question: "q", ...checked("fresh") } }];
	const both = carriedSection(await readCarriedViews({ call: async () => ({}), people: [], answers: landed, held }));
	assert.deepEqual(both.views.map((entry) => [entry.name, entry.held ?? false]), [["cellar", false], ["office", true]], "landed first, held last");
	assert.ok(both.head.includes(CARRIED_ANSWERS_HEAD) && both.head.includes(CARRIED_HELD_HEAD));
	// A session and three cards fill the message: the held answer is named in omitted, with its mark.
	const big = (n) => "w".repeat(n);
	const full = await readCarriedViews({ call: async (_method, params) => ({ kind: "npc", name: params.name, id: params.name, role: "r", wants: big(3500) }),
		people: ["A", "B"], session: { session: { kind: "combat", note: big(3500) }, pending_choice: null }, held });
	assert.ok(full.bytes <= CARRIED_VIEWS_BYTES);
	assert.deepEqual(full.omitted, [{ focus: "source_answer", name: "office", reason: "budget", held: true }]);
	assert.ok(carriedSection(full).head.includes(CARRIED_HELD_HEAD), "the head explains the mark in omitted too");
});

// ---------------------------------------------------------------------------------------------------
// The engine over the emitted kernel on the Haunting, with a stub reading bridge.
// ---------------------------------------------------------------------------------------------------

function answered(batch, pick = () => undefined) {
	const answers = {};
	for (const question of batch.questions) {
		const choice = pick(question) ?? (question.key === "exit" ? "continue" : Object.keys(question.criteria)[0] === "now" ? "later" : "unknown");
		answers[question.key] = { status: "answered", type: "choice", choice, confidence: 0.9, probabilities: { [choice]: 0.9 } };
	}
	return { batchId: batch.id, status: "complete", answers, coverage: { required: Object.keys(answers), answered: Object.keys(answers), unknown: [] }, issues: [] };
}
function supported(batch) {
	return { batchId: batch.id, status: "complete", attempts: 1, usage: { inputTokens: 10, outputTokens: 2 }, coverage: { required: [], answered: [], unknown: [] }, issues: [],
		answers: Object.fromEntries(Object.entries(supportChoices(batch)).map(([key, choice]) => [key, typeof choice === "object"
			? { status: "answered", type: "noul", noul: choice.noul } : { status: "answered", type: "choice", choice }])) };
}
function kernelSteps(workspace, requests) {
	const input = requests.map((request, index) => JSON.stringify({ id: String(index), method: request[0], params: { campaign: CAMPAIGN, ...request[1] } })).join("\n");
	const run = spawnSync(process.execPath, [join(REPO, "build/kernel/rpc.mjs"), "--workspace", workspace, "--content", join(REPO, "content")],
		{ cwd: REPO, input: `${input}\n`, encoding: "utf8" });
	const frames = run.stdout.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line)).filter((frame) => !frame.progress);
	for (const frame of frames) if (!frame.ok) throw new Error(`kernel step ${frame.id} failed: ${JSON.stringify(frame.error)}`);
	return frames.map((frame) => frame.result);
}
// The table has been told where to dig (turn 1's lead clue), so the kernel issues the Globe as a move.
const toldWhereToDig = (workspace) => kernelSteps(workspace, [
	["table.open", {}], ["table.player_input", { text: "I listen" }],
	["table.apply", { call_id: "t1-c1", effects: [{ kind: "clue", clue: "knott-research-leads", how: "he said so" }] }],
	["table.narrate", { call_id: "t1-c2", text: "He hands you a paper with the places on it." }],
]);
const textOf = (message) => typeof message.content === "string" ? message.content : (message.content ?? []).map((block) => block.text ?? "").join("");
const clerkNotes = (context) => context.messages.flatMap((message) => {
	const text = textOf(message), start = text.indexOf('{"kind":"single_loop_step"');
	return start < 0 ? [] : [JSON.parse(text.slice(start, text.lastIndexOf("}") + 1))];
});
/** Every distinct clerk note of the table, in order (a request repeats the run's earlier notes, §135.23). */
function distinctNotes(requests) {
	const seen = new Set(), out = [];
	for (const [index, context] of requests.entries()) for (const note of clerkNotes(context)) {
		const key = JSON.stringify(note);
		if (!seen.has(key)) { seen.add(key); out.push({ request: index, note }); }
	}
	return out;
}
/** The source_answer views of every distinct note: `{request, name, held, view}`. */
const answerViews = (requests) => distinctNotes(requests).flatMap(({ request, note }) => (note.carried?.views ?? [])
	.filter((view) => view.focus === "source_answer").map((view) => ({ request, name: view.name, held: view.held === true, view: view.view })));
/** How many times `needle` occurs in a request's messages (its capsule, notes, history and tool results alike). */
const occurrences = (context, needle) => context.messages.map(textOf).join("\n").split(needle).length - 1;

/** A controlled table: `route` answers the route questions; a response may be a function of the request (called when asked). */
async function hybridTable({ route, compile = answered, responses, env = {}, probe }) {
	const requests = [];
	const port = { async decide(batch) {
		if (batch.family === ROUTE_FAMILY) return route(batch);
		if (batch.family === COMPILE_FAMILY) return compile(batch);
		if (batch.family === BIND_FAMILY) return answered(batch);
		return supported(batch);
	} };
	const engine = createHybridEngine({ env: { ...process.env, PI_COC_JEV_PRESELECT: "1", EXT_JEV_APIKEY: "mechanical-test-key",
		PI_COC_JEV_PRESELECT_ALLOWANCE_MS: "60000" }, decision: port });
	const table = await openTable({
		realKernel: true, prepareWorkspace: toldWhereToDig, env: { PI_COC_LOOP_ENGINE: "hybrid-v1", ...env },
		runDriver: engine.runDriver,
		extraExtensions: [{ name: "coc-hybrid-engine", factory: engine.extension }, ...(probe ? [{ name: "sl102-probe", factory: probe }] : [])],
		responses: responses.map((response) => (context) => { requests.push(context); return typeof response === "function" ? response(context) : response; }),
	});
	// The turn's provider budget, as the task runtime would offer it.
	const turnBudget = { signal: new AbortController().signal, deadlineAt: Date.now() + 600_000, async reserve() { return { settle() {}, release() {} }; } };
	table.emit("coc:task-provider-budget", () => turnBudget);
	return { table, requests, dispose: () => table.dispose() };
}
const narrate = (text) => fauxAssistantMessage([fauxToolCall("output", { text })], { stopReason: "toolUse" });
const look = (focus) => fauxAssistantMessage([fauxToolCall("look", { focus })], { stopReason: "toolUse" });
const consult = (query, question, extra = {}) => fauxAssistantMessage([fauxToolCall("lookup", { kind: "source", source_mode: "answer", query, question, ...extra })], { stopReason: "toolUse" });
const stay = (batch) => answered(batch, (question) => question.key === "exit" ? "ask_llm" : undefined);
/** After `move()` the compile binds the declared Globe once; routes leave the remaining work to the Keeper. */
function router() {
	let pending = false;
	return { move() { pending = true; }, compile(batch) {
		if (!pending) return answered(batch);
		pending = false;
		return answered(batch, (question) => question.key === "destination"
			? Object.entries(question.criteria).find(([, value]) => value?.handle === "newspaper-morgue")?.[0] : undefined);
	}, route: stay };
}
const telemetryOf = (table, lane, event) => table.table.telemetry(CAMPAIGN).filter((row) => row.lane === lane && row.event === event);
/** Forward an observing wrapper without mutating the producer's frozen port; shutdown publishes no port. */
function sourceAnswersProbe(pi, wrap) {
	const forwarded = new WeakSet();
	pi.events.on("coc:source-answers", port => {
		if (!port || forwarded.has(port)) return;
		const proxy = Object.freeze({...port, ...wrap(port)});
		forwarded.add(proxy);
		pi.events.emit("coc:source-answers", proxy);
	});
}


test('source audit sees pending, landed and held evidence without consuming delivery or crossing scenes', async () => {
 const list = new PendingAnswers(() => {});
 let settle;
 list.register('c', {focus:'map', question:'Is the town printed?'}, 2, 'r1', new Promise(resolve => {settle=resolve;}), 'answer', 'station');
 list.register('c', {focus:'other', question:'Elsewhere?'}, 2, 'r2', new Promise(() => {}), 'answer', 'house');
 assert.deepEqual(list.audit('c', {scene:'station', turn:2}).pending.map(x=>x.question), ['Is the town printed?']);
 settle({source_answer:checked('The town is not printed.')}); await pause(0);
 const before=list.audit('c', {scene:'station', turn:2});
 assert.equal(before.pending.length,0); assert.equal(before.answers[0].answer.answer,'The town is not printed.');
 assert.equal(list.take('c', {scene:'station',run:'r1'}).landed.length,1,'audit never consumes the one-time delivery');
 assert.deepEqual(list.audit('c', {scene:'station',turn:3}).answers,before.answers.map(entry=>({...entry,answer:withSourceQuestion(entry.question,entry.answer)})),
  'held answer remains the same review evidence with its canonical question');
 assert.equal(list.take('c',{scene:'station',run:'r2'}).held.length,1,'audit does not mark a run as handed');
 assert.equal(list.audit('c',{scene:'house',turn:3}).answers.length,0);
 list.register('c',{focus:'rule',question:'Which modifier?'},3,'r3',Promise.reject(new Error('fixture unavailable')),'answer','station');
 await pause(0);
 assert.equal(list.audit('c',{scene:'station',turn:3}).unavailable.length,1);
 assert.equal(list.audit('c',{scene:'station',turn:4}).unavailable.length,0);
});
