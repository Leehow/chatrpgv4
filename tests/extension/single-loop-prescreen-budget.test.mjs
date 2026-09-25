/**
 * SL-22: the prescreen has its own budget, and the policy's Jev budget is for decisions (spec ruling of 2026-09-24,
 * after live gate #7; contract §135.6 and §135.25, SL-22 addenda).
 *
 * Gate #7, turn 3: the read's prescreen spent 7 calls and 10.1 s, and the read after the clerk's move spent 4 more calls.
 * The policy charged both to the run's decision budget (`settleRead`), so every later decision point became a compose
 * with reason `jev_budget` (four of them), and the disposition bind was never asked.
 *
 * - Policy seam: the product policy (`createStepPolicy`) on the vendored `runDriver`, with stub ports and a stub clock. A
 *   read that reports gate #7's prescreen spends none of the decision budget. A spent decision budget composes once, and
 *   after that the Keeper's own batches carry the run.
 * - Extension seam: the hybrid engine over the emitted kernel on the Haunting, with a controlled decision port whose
 *   prescreen batches are slow. The route is still asked after a prescreen that spent the allowance. The read after the
 *   move runs its prescreen on the named allowance, from its own start (SL-44, §135.6.1: gate #4's t19 read had been given
 *   the turn's remainder, 138 ms), and sends nothing past its own deadline. A `read_more` on the same scene reuses the first
 *   read's prescreen. The ordinary binder's lease is its own.
 */
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { openTable } from "./harness.mjs";
import { runDriver } from "./pi-agent-core.mjs";
import { supportChoices } from "./support-agent-helpers.mjs";
import { createHybridEngine } from "../../runtime/jev/hybrid-engine.ts";
import { BIND_FAMILY, createStepPolicy, ROUTE_FAMILY } from "../../runtime/jev/step-policy.ts";
import { COMPILE_FAMILY } from "../../runtime/jev/route-compile.ts";
import { isRunEvent } from "./pi-agent-core.mjs";
import { PRESELECT_ALLOWANCE_DEFAULT_MS } from "../../extensions/jev/agent/config.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------------------------------
// Policy seam.
// ---------------------------------------------------------------------------------------------------

const scope = { owner: "campaign:test", campaign: "test", worldline: "main", loop: 0, audience: "keeper" };
const context = { scene: "office", clock: null, present: ["Knott"], receipts: [] };
const move = { key: "apply:move:globe", verb: "apply", family: "move", label: "Go to the Globe", source: "stub", bound: { kind: "move", to: "globe" },
	unbound: [], clerk: "declared_bookkeeping" };

function route(batch, now = [], exit = "continue") {
	const answers = {};
	for (const question of batch.questions) {
		const choice = question.key === "exit" ? exit : now.some((label) => question.target.includes(label)) ? "now" : "later";
		answers[question.key] = { status: "answered", type: "choice", choice, confidence: 0.95, probabilities: { [choice]: 0.95 } };
	}
	return { batchId: batch.id, status: "complete", answers, coverage: { required: Object.keys(answers), answered: Object.keys(answers), unknown: [] }, issues: [] };
}

/** One run of the product policy with stub ports. `advance[what]` moves the stub clock while that step runs. */
async function drive({ candidates, read, advance = {}, decide, infer, budget = {} }) {
	const clock = { t: 0 };
	const tick = (what) => { clock.t += advance[what] ?? 0; };
	const log = [], events = [];
	// The time budget is out of reach: the subject is the decision budget.
	const policy = createStepPolicy({ context, scope, candidates: [], budget: { maxRunMs: 10_000_000, ...budget }, clock: () => clock.t, startedAt: 0 });
	const toolResult = (proposal, isError = false) => ({ role: "toolResult", toolCallId: proposal.toolCall.id, toolName: proposal.operation, content: [{ type: "text", text: "ok" }], isError, timestamp: 0 });
	let decisions = 0;
	const ports = {
		clock: { now: () => clock.t },
		read: { async read() { tick("read"); log.push("read"); return { status: "ok", artifact: { kind: "read", read, fresh: { context, candidates } } }; } },
		decision: { async decide(request) { tick(`decide:${request.purpose}`); log.push(`decide:${request.purpose}`); return { status: "ok", artifact: { kind: request.purpose, result: decide(request.question.batch, ++decisions) } }; } },
		operations: {
			async execute(proposal, invocation) {
				if (proposal.origin === "model") {
					const result = await invocation.executeModelTool();
					log.push(`model:${proposal.operation}:${proposal.params?.effects?.[0]?.to ?? ""}`);
					return { status: "ok", toolResult: result, artifact: { kind: "execute", executed: { ok: true, summary: {} } } };
				}
				if (proposal.operation === "turn_close") { log.push("turn_close"); return { status: "ok", artifact: { kind: "turn_close", verdict: { status: "none", reason: "nothing_owed" } } }; }
				log.push(`clerk:${proposal.params.candidate.key}`);
				return { status: "ok", artifact: { kind: "execute", executed: { ok: true, summary: {} }, fresh: { context, candidates: [] } } };
			},
		},
		record: { record: (event) => events.push(event) },
	};
	const requests = [];
	const engine = {
		async infer({ purpose }) {
			const request = requests.length;
			requests.push({ purpose });
			tick(`infer:${request}`);
			log.push(`infer:${purpose}`);
			return infer(request, purpose);
		},
		async executeModelTool(proposal) { return toolResult(proposal); },
		async refuseModelTool(proposal) { return toolResult(proposal, true); },
		async closeTurn() { return { continueRequested: false }; },
	};
	await runDriver({ input: { runId: "r1", inputRevision: "rev", rawInput: "I go to the Globe", scopeId: "root" }, policy, ports, engine,
		emit: () => {}, signal: new AbortController().signal, maxSteps: 30 });
	const inferSteps = events.filter((event) => event.type === "step_end" && event.kind === "infer");
	return { log, inferSteps };
}

const prose = (text) => fauxAssistantMessage(text, { stopReason: "stop" });
const batchOf = (to) => fauxAssistantMessage([fauxToolCall("apply", { effects: [{ kind: "move", to }] })], { stopReason: "toolUse" });

test("a read that reports gate #7's prescreen (7 calls, 10.1 s, then 4 calls) spends none of the decision budget: the route is asked", async () => {
	// Gate #7's s1 read reported 10 166 ms and 7 calls; the policy's maxJevMs is the 12 000 ms allowance. The route answer
	// takes 2 s on the stub clock, so a read charged to the budget would leave 12 166 ms spent before the second route.
	const { log, inferSteps } = await drive({ candidates: [move], budget: { maxJevMs: 12_000 },
		read: { materials: [], summary: { status: "prepared", jev_calls: 7 }, calls: 7, ms: 10_166 },
		advance: { read: 10_166, "decide:route": 2_000 },
		decide: (batch, count) => count === 1 ? route(batch, ["Go to the Globe"]) : route(batch, [], "finish"),
		infer: () => prose("You arrive at the Globe.") });
	assert.deepEqual(log, ["read", "decide:route", "clerk:apply:move:globe", "decide:route", "infer:compose", "turn_close"]);
	assert.deepEqual(inferSteps.map((step) => step.reason), ["finish"], "no compose for a spent Jev budget");
});

test("a spent decision budget composes once; after it the Keeper's own batches carry the run (reason keeper_carries)", async () => {
	// The route answer alone spends the decision budget (1.5 s against 1 s); it hands the turn to the Keeper, whose first
	// two responses are batches and whose third is the prose.
	const { log, inferSteps } = await drive({ candidates: [move], budget: { maxJevMs: 1_000 },
		read: { materials: [], summary: { status: "not_run" }, calls: 0, ms: 0 },
		advance: { "decide:route": 1_500 },
		decide: (batch) => route(batch, [], "ask_llm"),
		infer: (index) => index === 0 ? batchOf("a") : index === 1 ? batchOf("b") : index === 2 ? batchOf("c") : prose("Done.") });
	assert.deepEqual(log, ["read", "decide:route", "infer:adjudicate", "model:apply:a", "infer:compose", "model:apply:b", "infer:adjudicate",
		"model:apply:c", "infer:adjudicate", "turn_close"]);
	assert.deepEqual(inferSteps.map((step) => `${step.purpose}:${step.reason}`),
		["adjudicate:ask_llm", "compose:jev_budget", "adjudicate:keeper_carries", "adjudicate:keeper_carries"]);
	assert.equal(inferSteps.filter((step) => step.reason === "jev_budget").length, 1, "one compose for the spent budget");
});

// ---------------------------------------------------------------------------------------------------
// Extension seam: the hybrid engine over the emitted kernel on the Haunting.
// ---------------------------------------------------------------------------------------------------

function answered(batch, pick = () => undefined) {
	const answers = {};
	for (const question of batch.questions) {
		const choice = pick(question) ?? (question.key === "exit" ? "continue" : Object.keys(question.criteria)[0] === "now" ? "later" : "unknown");
		answers[question.key] = { status: "answered", type: "choice", choice, confidence: 0.9, probabilities: { [choice]: 0.9 } };
	}
	return { batchId: batch.id, status: "complete", answers, coverage: { required: Object.keys(answers), answered: Object.keys(answers), unknown: [] }, issues: [] };
}
/** A prescreen or binder answer from the controlled helpers (never a Keeper or a gameplay driver). */
function supported(batch) {
	return { batchId: batch.id, status: "complete", attempts: 1, usage: { inputTokens: 10, outputTokens: 2 }, coverage: { required: [], answered: [], unknown: [] }, issues: [],
		answers: Object.fromEntries(Object.entries(supportChoices(batch)).map(([key, choice]) => [key, typeof choice === "object"
			? { status: "answered", type: "noul", noul: choice.noul } : { status: "answered", type: "choice", choice }])) };
}
const unavailable = (batch, code) => ({ batchId: batch.id, status: "unavailable", answers: {}, coverage: { required: [], answered: [], unknown: [] }, issues: [],
	failure: { code, retryable: false } });

function kernelSteps(workspace, campaign, requests) {
	const input = requests.map((request, index) => JSON.stringify({ id: String(index), method: request[0], params: { campaign, ...request[1] } })).join("\n");
	const run = spawnSync(process.execPath, [join(REPO, "build/kernel/rpc.mjs"), "--workspace", workspace, "--content", join(REPO, "content")],
		{ cwd: REPO, input: `${input}\n`, encoding: "utf8" });
	const frames = run.stdout.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line)).filter((frame) => !frame.progress);
	for (const frame of frames) if (!frame.ok) throw new Error(`fixture step ${frame.id} failed: ${JSON.stringify(frame.error)}`);
	return frames;
}
// The table has been told where to dig (turn 1's lead clue), so the kernel issues the Globe as a move.
const toldWhereToDig = (workspace) => kernelSteps(workspace, "test-camp", [
	["table.open", {}], ["table.player_input", { text: "I listen" }],
	["table.apply", { call_id: "t1-c1", effects: [{ kind: "clue", clue: "knott-research-leads", how: "he said so" }] }],
	["table.narrate", { call_id: "t1-c2", text: "He hands you a paper with the places on it." }],
]);

/**
 * A decision port: `route(batch, n)` answers the n-th route; the compile answers `unknown` (the first after `compileMs`); every
 * other batch is the prescreen's or the ordinary binder's. `slowPrescreen` holds each prescreen batch until its lease
 * ends, so the prescreen spends the whole allowance.
 */
function decisionPort({ route: routeAnswer, compileMs = 0, slowPrescreen = false }) {
	const log = [];
	let routes = 0, compiles = 0;
	return { log, port: { async decide(batch, lease) {
		const at = Date.now(), deadline = lease?.context?.budget?.deadlineAt ?? null;
		if (batch.family === ROUTE_FAMILY) { log.push({ kind: "route", at }); return routeAnswer(batch, ++routes); }
		if (batch.family === COMPILE_FAMILY) { log.push({ kind: "compile", at }); if (compileMs && ++compiles === 1) await sleep(compileMs); return answered(batch); }
		if (batch.family === BIND_FAMILY) { log.push({ kind: "bind", at }); return answered(batch); }
		if (batch.family === "ordinary-resolve") { log.push({ kind: "binder", at, deadline }); return supported(batch); }
		log.push({ kind: "prescreen", family: batch.family, at, deadline });
		if (!slowPrescreen) return supported(batch);
		await new Promise((resolve) => {
			const timer = setTimeout(resolve, 8_000);
			lease?.signal?.addEventListener?.("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
		});
		return unavailable(batch, "timeout");
	} } };
}

/** `allowanceMs: null`: the allowance is not configured, so it is the named default. */
async function hybridTable({ port, responses, prepareWorkspace = toldWhereToDig, allowanceMs = "2000" }) {
	const events = [], rows = [];
	const env = { ...process.env, PI_COC_JEV_PRESELECT: "1", EXT_JEV_APIKEY: "mechanical-test-key" };
	if (allowanceMs === null) delete env.PI_COC_JEV_PRESELECT_ALLOWANCE_MS; else env.PI_COC_JEV_PRESELECT_ALLOWANCE_MS = allowanceMs;
	const engine = createHybridEngine({ env, decision: port });
	const table = await openTable({
		realKernel: true, prepareWorkspace, env: { PI_COC_LOOP_ENGINE: "hybrid-v1" },
		runDriver: engine.runDriver,
		extraExtensions: [{ name: "coc-hybrid-engine", factory: engine.extension }],
		responses,
	});
	table.session.subscribe((event) => { if (isRunEvent(event)) events.push(event); });
	return { table, events, rows, dispose: () => table.dispose() };
}
const runRows = (table, event) => table.telemetry("test-camp").filter((row) => row.lane === "run" && row.event === event);
const narrate = (text) => fauxAssistantMessage([fauxToolCall("narrate", { text })], { stopReason: "toolUse" });

test("gate #7's shape: a prescreen that spends the whole allowance leaves the decisions theirs -- compile and route asked, the clerk moves, no jev_budget", async (t) => {
	// The allowance is 3 s and the prescreen holds every batch to its deadline (at least 1 s, asserted below); the first
	// compile takes 2 s. Charged to the decision budget (maxJevMs = the allowance), read + compile would pass 3 s before the
	// route was asked; the decisions alone stay under it.
	const { log, port } = decisionPort({ slowPrescreen: true, compileMs: 2_000,
		route: (batch, n) => n === 1 ? answered(batch, (question) => question.key === "exit" ? "continue" : /Boston Globe offices/.test(question.target) ? "now" : undefined)
			: answered(batch, (question) => question.key === "exit" ? "finish" : undefined) });
	const table = await hybridTable({ port, allowanceMs: "3000", responses: [narrate("You reach the Globe's morgue.")] });
	t.after(() => table.dispose());
	await table.table.session.prompt("I go to the Boston Globe offices.");

	const reads = runRows(table.table, "read");
	assert.equal(reads.length, 2, "the read, and the read after the move");
	assert.notEqual(reads[0].prescreen.status, "not_run", `the first read ran a prescreen: ${JSON.stringify(reads[0].prescreen)}`);
	assert.ok(log.some((entry) => entry.kind === "prescreen"), "the prescreen asked Jev");
	assert.ok(reads[0].prescreen.ms >= 1_000, `the prescreen was slow (${reads[0].prescreen.ms} ms)`);
	assert.ok(log.some((entry) => entry.kind === "route"), "the route was asked after the prescreen");
	const infers = table.events.filter((event) => event.type === "step_end" && event.kind === "infer");
	assert.ok(!infers.some((event) => event.reason === "jev_budget"), `no step for a spent Jev budget: ${infers.map((event) => event.reason)}`);
	const moved = table.table.telemetry("test-camp").find((row) => row.tool === "apply" && row.origin === "policy");
	assert.ok(moved?.ok !== false && moved, "the clerk's move ran");
	assert.equal(reads[1].scene, "newspaper-morgue");
	// SL-44 (§135.6.1): the read after the move gets the whole allowance from its own start, never what the turn left of it;
	// no prescreen batch of either read runs past that read's own deadline.
	assert.equal(reads[1].prescreen.allowance_ms, 3_000, "the late read's allowance is the configured one");
	assert.notEqual(reads[1].prescreen.status, "not_run", `the late read ran its prescreen: ${JSON.stringify(reads[1].prescreen)}`);
	// Each read's batches end within that read (their deadline is the read's own, not a later one), and each read's latest
	// batch deadline is most of a whole allowance from its start (the allowance less the finalisation reserve), never a
	// remainder. Measured against the read's own step, so a slow machine's kernel reads do not move it.
	for (const read of reads) {
		const began = table.events.find((event) => event.type === "step_start" && event.stepId === read.stepId).at;
		const ended = table.events.find((event) => event.type === "step_end" && event.stepId === read.stepId).at;
		const batches = log.filter((entry) => entry.kind === "prescreen" && entry.at >= began && entry.at <= ended);
		assert.ok(batches.length > 0, `the read at ${read.scene} sent prescreen batches`);
		assert.ok(batches.every((entry) => entry.deadline <= ended), `every batch's deadline falls inside its own read (${batches.map((entry) => entry.deadline - ended)})`);
		// The locate's batches hold only their share; the latest deadline is the read's semantic one.
		assert.ok(Math.max(...batches.map((entry) => entry.deadline)) - began >= 2_000, `given the allowance whole (${batches.map((entry) => entry.deadline - began)})`);
	}
	// The budget summary names both budgets: the decisions' (not spent) and the prescreen's (reported).
	const summary = table.table.telemetry("test-camp").find((row) => row.lane === "run" && row.event === "budget" && row.decision === "summary");
	assert.equal(summary.decision_budget.spent, false);
	assert.equal(summary.prescreen.jev_calls, reads[0].prescreen.jev_calls + reads[1].prescreen.jev_calls);
	assert.equal(summary.decision_budget.jev_ms < 3_000, true, `the decisions alone spent ${summary.decision_budget.jev_ms} ms`);
	assert.equal(summary.prescreen.reads, 2);
});

test("SL-44 (§135.6.1): a read after the move that comes late in the turn gets the allowance whole -- the configured one, and with none configured the named default", async (t) => {
	// Gate #4 t19's shape: the read after the move began 11.8 s into the run and was given the 138 ms the turn had left. Here
	// the first read's prescreen holds every batch to its 2 s deadline, so the read after the clerk's move starts past the old
	// run-wide deadline (which gave it `not_run`, `allowance_spent`); with no allowance configured, the first compile takes
	// 300 ms, and the late read's allowance is still the named default, whole.
	for (const [label, allowanceMs, expected, slow] of [["configured 2 s, the first prescreen spending all of it", "2000", 2_000, true],
		["not configured: the named default", null, PRESELECT_ALLOWANCE_DEFAULT_MS, false]]) await t.test(label, async (tt) => {
		const { port } = decisionPort({ compileMs: slow ? 0 : 300, slowPrescreen: slow,
			route: (batch, n) => n === 1 ? answered(batch, (question) => question.key === "exit" ? "continue" : /Boston Globe offices/.test(question.target) ? "now" : undefined)
				: answered(batch, (question) => question.key === "exit" ? "finish" : undefined) });
		const table = await hybridTable({ port, allowanceMs, responses: [narrate("You reach the Globe's morgue.")] });
		tt.after(() => table.dispose());
		await table.table.session.prompt("I go to the Boston Globe offices.");
		const reads = runRows(table.table, "read");
		assert.equal(reads.length, 2, "the read, and the read after the move");
		assert.equal(reads[1].scene, "newspaper-morgue");
		assert.equal(reads[0].prescreen.allowance_ms, expected);
		assert.equal(reads[1].prescreen.allowance_ms, expected, "the late read's allowance equals the first read's: never the turn's remainder");
		assert.notEqual(reads[1].prescreen.status, "not_run", `the late read ran its prescreen: ${JSON.stringify(reads[1].prescreen)}`);
		if (!slow) assert.equal(reads[1].prescreen.status, "prepared");
	});
});

test("a read_more on the same scene reuses the first read's prescreen: its materials, no Jev call", async (t) => {
	// The first route asks for more material; the second read is on the same scene. Nothing new: the repeated question
	// goes to the Keeper (Guard 1), who narrates.
	const { log, port } = decisionPort({ route: (batch) => answered(batch, (question) => question.key === "exit" ? "read_more" : undefined) });
	const table = await hybridTable({ port, allowanceMs: "12000", responses: [narrate("Knott waits for your question.")] });
	t.after(() => table.dispose());
	await table.table.session.prompt("I look over Knott's desk for anything about the house.");

	const reads = runRows(table.table, "read");
	// Since §134.18 the office's commission is a compile-only candidate that the first route consumes, so the second route's
	// question differs from the first and may ask for one more read of the same scene: every read after the first reuses.
	assert.ok(reads.length >= 2);
	for (const later of reads.slice(1)) assert.equal(later.prescreen.status, "reused");
	assert.equal(reads[0].prescreen.status, "prepared");
	assert.ok(reads[0].prescreen.materials > 0);
	assert.equal(reads[1].scene, reads[0].scene);
	assert.equal(reads[1].prescreen.status, "reused");
	assert.equal(reads[1].prescreen.from, reads[0].stepId);
	assert.equal(reads[1].prescreen.jev_calls, 0);
	assert.equal(reads[1].prescreen.materials, reads[0].prescreen.materials);
	const firstReadEnd = table.events.find((event) => event.type === "step_end" && event.stepId === reads[0].stepId).at;
	assert.ok(log.filter((entry) => entry.kind === "prescreen").every((entry) => entry.at <= firstReadEnd), "the second read sent no prescreen batch");
});

test("the ordinary binder asked after a spent allowance holds its own 15 s lease, not the allowance's remainder", async (t) => {
	const { log, port } = decisionPort({ slowPrescreen: true,
		route: (batch, n) => n === 1 ? answered(batch, (question) => question.key === "exit" ? "continue" : /core-check:ordinary-check/.test(question.target) ? "now" : undefined)
			: answered(batch, (question) => question.key === "exit" ? "finish" : undefined) });
	const table = await hybridTable({ port, responses: [narrate("You search the office."), narrate("Nothing more.")] });
	t.after(() => table.dispose());
	await table.table.session.prompt("I search Knott's filing cabinet for the Corbitt file.");

	// The prescreen prepares its own check advice inside the allowance; the binder the clerk's check asks comes after the read.
	const read = runRows(table.table, "read")[0];
	const readEnd = table.events.find((event) => event.type === "step_end" && event.stepId === read.stepId).at;
	const binder = log.find((entry) => entry.kind === "binder" && entry.at > readEnd);
	assert.ok(binder, `the ordinary binder was asked after the read (${log.map((entry) => entry.kind).join(",")})`);
	assert.ok(binder.deadline - binder.at > 10_000, `its lease is its own (${binder.deadline - binder.at} ms left)`);
});

const clerkNotes = (context) => context.messages.flatMap((message) => {
	const text = typeof message.content === "string" ? message.content : (message.content ?? []).map((block) => block.text ?? "").join("");
	const start = text.indexOf('{"kind":"single_loop_step"');
	return start < 0 ? [] : [JSON.parse(text.slice(start, text.lastIndexOf("}") + 1))];
});

test("at the extension seam the one jev_budget compose tells the Keeper why, the next step is keeper_carries, and the summary names the spent budget", async (t) => {
	// No prescreen (the setting is off); the route answer alone takes longer than the 2 s decision budget and asks the Keeper.
	const { port } = decisionPort({ route: async (batch) => { await sleep(2_100); return answered(batch, (question) => question.key === "exit" ? "ask_llm" : undefined); } });
	const requests = [];
	const look = fauxAssistantMessage([fauxToolCall("look", {})], { stopReason: "toolUse" });
	const events = [];
	const engine = createHybridEngine({ env: { ...process.env, PI_COC_JEV_PRESELECT: "0", EXT_JEV_APIKEY: "mechanical-test-key", PI_COC_JEV_PRESELECT_ALLOWANCE_MS: "2000" }, decision: port });
	const table = await openTable({ realKernel: true, prepareWorkspace: toldWhereToDig, env: { PI_COC_LOOP_ENGINE: "hybrid-v1" }, runDriver: engine.runDriver,
		extraExtensions: [{ name: "coc-hybrid-engine", factory: engine.extension }],
		responses: [look, look, look, narrate("Knott shrugs.")].map((response) => (context) => { requests.push(context); return response; }) });
	t.after(() => table.dispose());
	table.session.subscribe((event) => { if (isRunEvent(event)) events.push(event); });
	await table.session.prompt("I ask Knott what he knows.");

	const infers = events.filter((event) => event.type === "step_end" && event.kind === "infer").map((event) => `${event.purpose}:${event.reason}`);
	assert.deepEqual(infers, ["adjudicate:ask_llm", "compose:jev_budget", "adjudicate:keeper_carries", "adjudicate:keeper_carries"]);
	const composeNote = clerkNotes(requests[1]).find((note) => note.reason === "jev_budget");
	assert.ok(composeNote?.decision_budget_note, "the compose says the decision budget is spent");
	assert.ok(composeNote.decision_budget.jev_ms >= composeNote.decision_budget.max_jev_ms);
	assert.ok(!clerkNotes(requests[2]).some((note) => note.reason === "keeper_carries"), "the Keeper's own continuation carries no note");
	const summary = table.telemetry("test-camp").find((row) => row.lane === "run" && row.event === "budget" && row.decision === "summary");
	assert.equal(summary.decision_budget.spent, true);
	assert.deepEqual(summary.prescreen, { reads: 0, jev_calls: 0, ms: 0 });
});
