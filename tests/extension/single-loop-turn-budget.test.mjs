/**
 * SL-10, the run's time budget (contract §135.25; spec ruling "A turn is under 60 seconds").
 *
 * - Policy seam: the product policy (`createStepPolicy`) on the vendored `runDriver` with stub ports, a stub model
 *   engine and a stub clock. Past the budget the next step is the compose and the pending clerk steps are listed;
 *   a model step that crosses the budget is not cut and its whole batch runs; a forced step without a model still
 *   runs; inside the budget the route's choice runs.
 * - Extension seam: the hybrid engine over the emitted kernel. A move the route selected after the budget ran out
 *   is not executed, the compose's note and the next run's first note list it, and the rows carry the budget.
 */
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { openTable } from "./harness.mjs";
import { runDriver } from "./pi-agent-core.mjs";
import { createHybridEngine } from "../../runtime/jev/hybrid-engine.ts";
import { createStepPolicy, DEFAULT_TURN_BUDGET_MS, initialView, next, ROUTE_FAMILY } from "../../runtime/jev/step-policy.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const scope = { owner: "campaign:test", campaign: "test", worldline: "main", loop: 0, audience: "keeper" };
const context = { scene: "office", clock: null, present: ["Arty"], receipts: [] };
const move = { key: "apply:move:globe", verb: "apply", family: "move", label: "Go to the Globe", source: "stub", bound: { kind: "move", to: "globe" },
	unbound: [], clerk: "declared_bookkeeping" };
const person = { key: "apply:person:Arty", verb: "apply", family: "person", label: "Stage Arty", source: "stub", bound: { kind: "person", who: "Arty" },
	unbound: [{ name: "name", required: true, vocabulary: "open" }], clerk: "declared_bookkeeping" };
const defence = { key: "resolve:combat:defend:knott", verb: "resolve", family: "combat", label: "Knott defends", source: "stub",
	bound: { decision: "combat:defend", actor: "Knott", defense: "dodge" }, unbound: [], clerk: "session_step", forced: true };

/** A route answer: `now` for the listed candidate labels, the given exit. */
function route(batch, now = [], exit = "continue") {
	const answers = {};
	for (const question of batch.questions) {
		const choice = question.key === "exit" ? exit : now.some((label) => question.target.includes(label)) ? "now" : "later";
		answers[question.key] = { status: "answered", type: "choice", choice, confidence: 0.95, probabilities: { [choice]: 0.95 } };
	}
	return { batchId: batch.id, status: "complete", answers, coverage: { required: Object.keys(answers), answered: Object.keys(answers), unknown: [] }, issues: [] };
}

/**
 * Drive one run of the product policy with stub ports. `clock.t` is the stub clock; each port and the model engine
 * may advance it (`advance`) to put a step on either side of the budget. Returns what ran, in order.
 */
async function drive({ candidates, fresh = candidates, budgetMs = 1_000, advance = {}, decide, infer }) {
	const clock = { t: 0 };
	const tick = (what) => { clock.t += advance[what] ?? 0; };
	const log = [], events = [];
	const policy = createStepPolicy({ context, scope, candidates: [], budget: { maxRunMs: budgetMs }, clock: () => clock.t, startedAt: 0 });
	const toolResult = (proposal, isError = false) => ({ role: "toolResult", toolCallId: proposal.toolCall.id, toolName: proposal.operation, content: [{ type: "text", text: "ok" }], isError, timestamp: 0 });
	const ports = {
		clock: { now: () => clock.t },
		read: { async read() { tick("read"); log.push("read"); return { status: "ok", artifact: { kind: "read", read: { materials: [], summary: {} }, fresh: { context, candidates: fresh } } }; } },
		decision: { async decide(request) { tick(`decide:${request.purpose}`); log.push(`decide:${request.purpose}`); return { status: "ok", artifact: { kind: request.purpose, result: decide(request.question.batch, ++decisions) } }; } },
		operations: {
			async execute(proposal, invocation) {
				if (proposal.origin === "model") {
					const result = await invocation.executeModelTool();
					log.push(`model:${proposal.operation}:${proposal.params?.effects?.[0]?.to ?? ""}`);
					return { status: "ok", toolResult: result, artifact: { kind: "execute", executed: { ok: true, summary: {} } } };
				}
				// §135.11: the run's own turn close, asked before a run with no delivery evidence finishes.
				if (proposal.operation === "turn_close") { log.push("turn_close"); return { status: "ok", artifact: { kind: "turn_close", verdict: { status: "none", reason: "nothing_owed" } } }; }
				log.push(`clerk:${proposal.params.candidate.key}`);
				return { status: "ok", artifact: { kind: "execute", executed: { ok: true, summary: {} }, fresh: { context, candidates: [] } } };
			},
		},
		record: { record: (event) => events.push(event) },
	};
	const requests = [];
	let decisions = 0;
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
	const result = await runDriver({ input: { runId: "r1", inputRevision: "rev", rawInput: "go to the Globe", scopeId: "root" }, policy, ports, engine,
		emit: () => {}, signal: new AbortController().signal, maxSteps: 30 });
	const inferSteps = events.filter((event) => event.type === "step_end" && event.kind === "infer");
	return { log, result, events, inferSteps, clock };
}

const prose = (text) => fauxAssistantMessage(text, { stopReason: "stop" });

test("the pure policy: a spent time budget makes the next step the compose and lists the pending clerk steps", () => {
	const view = initialView({ runId: "r", rawInput: "go", context, candidates: [move, person], readFirst: false });
	view.pending = [{ kind: "infer", purpose: "bind", candidate: person, reason: "open_parameters" }, { kind: "direct", purpose: "llm_proposal", candidate: person },
		{ kind: "direct", purpose: "execute", candidate: move }];
	assert.equal(view.budget.maxRunMs, DEFAULT_TURN_BUDGET_MS);
	assert.equal(next(view).kind, "infer", "inside the budget the head runs");
	assert.equal(next(view).purpose, "bind");
	view.budget.runMs = DEFAULT_TURN_BUDGET_MS;
	const spent = next(view);
	assert.deepEqual({ kind: spent.kind, purpose: spent.purpose, reason: spent.reason }, { kind: "infer", purpose: "compose", reason: "run_budget" });
	assert.deepEqual(spent.deferred.map((value) => [value.key, value.stage]), [["apply:person:Arty", "infer:bind"], ["apply:move:globe", "direct:execute"]]);
	// A pending Keeper return (a fallen batch) is consumed by the compose, which is the same Keeper request.
	view.pending = [{ kind: "infer", purpose: "adjudicate", reason: "batch_fallen" }];
	assert.equal(next(view).item?.reason, "batch_fallen");
	assert.deepEqual(next(view).deferred, []);
	// A compose already owed (the turn close's steer, §135.11) is the compose: it keeps its reason, and its steer message.
	view.pending = [{ kind: "infer", purpose: "compose", reason: "turn_close:speech" }, { kind: "direct", purpose: "execute", candidate: move }];
	assert.deepEqual([next(view).purpose, next(view).reason], ["compose", "turn_close:speech"]);
});

test("past the budget the route's selection is not executed: the next step is the compose, with the deferred clerk steps on it", async () => {
	// The read is quick; the route answer lands after the budget (clock 0 -> 1.5 s against a 1 s budget) and selects the move.
	const { log, inferSteps } = await drive({ candidates: [move], advance: { "decide:route": 1_500 },
		decide: (batch) => route(batch, ["Go to the Globe"]), infer: () => prose("You set off.") });
	assert.deepEqual(log, ["read", "decide:route", "infer:compose", "turn_close"],
		"no clerk write after the budget ran out; the budget compose still goes through the turn close (§135.11)");
	assert.equal(inferSteps[0].reason, "run_budget");
});

test("inside the budget the same selection is executed by the clerk before the Keeper writes", async () => {
	const { log } = await drive({ candidates: [move], fresh: [move], advance: { "decide:route": 100 },
		decide: (batch, count) => count === 1 ? route(batch, ["Go to the Globe"]) : route(batch, [], "finish"),
		infer: () => prose("You arrive.") });
	assert.deepEqual(log.slice(0, 3), ["read", "decide:route", "clerk:apply:move:globe"]);
	assert.deepEqual(log.slice(-2), ["infer:compose", "turn_close"]);
});

test("a model step that crosses the budget is not cut: its whole batch runs, then the compose", async () => {
	// The route hands the turn to the Keeper; the Keeper's response takes 5 s (past the 1 s budget) and proposes two writes.
	const batch = fauxAssistantMessage([fauxToolCall("apply", { effects: [{ kind: "move", to: "a" }] }), fauxToolCall("apply", { effects: [{ kind: "move", to: "b" }] })], { stopReason: "toolUse" });
	const { log, events, inferSteps } = await drive({ candidates: [move], advance: { "infer:0": 5_000 },
		decide: (batch) => route(batch, [], "ask_llm"), infer: (index) => index === 0 ? batch : prose("Done.") });
	assert.deepEqual(log, ["read", "decide:route", "infer:adjudicate", "model:apply:a", "model:apply:b", "infer:compose", "turn_close"]);
	assert.equal(inferSteps[0].status, "ok", "the running model step completed; nothing aborted it");
	assert.ok(!events.some((event) => event.status === "aborted"));
	assert.equal(inferSteps[1].reason, "run_budget");
});

test("a step the kernel forces still runs past the budget when it needs no model; then the compose", async () => {
	// The read itself crosses the budget and issues the NPC's forced defence.
	const { log, inferSteps } = await drive({ candidates: [defence], fresh: [defence], advance: { read: 2_000 },
		decide: (batch) => route(batch, [], "finish"), infer: () => prose("He ducks.") });
	assert.deepEqual(log, ["read", "clerk:resolve:combat:defend:knott", "infer:compose", "turn_close"]);
	assert.equal(inferSteps[0].reason, "run_budget");
});

/** One kernel request on the workspace, through the emitted kernel's own RPC (to put the table in a state). */
function kernelSteps(workspace, campaign, requests) {
	const input = requests.map((request, index) => JSON.stringify({ id: String(index), method: request[0], params: { campaign, ...request[1] } })).join("\n");
	const run = spawnSync(process.execPath, [join(REPO, "build/kernel/rpc.mjs"), "--workspace", workspace, "--content", join(REPO, "content")],
		{ cwd: REPO, input: `${input}\n`, encoding: "utf8" });
	const frames = run.stdout.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line)).filter((frame) => !frame.progress);
	for (const frame of frames) if (!frame.ok) throw new Error(`fixture step ${frame.id} failed: ${JSON.stringify(frame.error)}`);
	return frames;
}
const clerkNotes = (context) => context.messages.flatMap((message) => {
	const text = typeof message.content === "string" ? message.content : (message.content ?? []).map((block) => block.text ?? "").join("");
	const start = text.indexOf('{"kind":"single_loop_step"');
	return start < 0 ? [] : [JSON.parse(text.slice(start, text.lastIndexOf("}") + 1))];
});

test("at the extension seam a move routed after the budget is deferred: not executed, listed to the Keeper now and on the next turn, and every budget decision is a run row", async (t) => {
	const campaign = "test-camp";
	const prepareWorkspace = (workspace) => kernelSteps(workspace, campaign, [
		["table.open", {}], ["table.player_input", { text: "我听着" }],
		["table.apply", { call_id: "t1-c1", effects: [{ kind: "clue", clue: "knott-research-leads", how: "he said so" }] }],
		["table.narrate", { call_id: "t1-c2", text: "他递给你一张写着地方的纸。" }],
	]);
	const clock = { t: 1_000_000 };
	let routes = 0;
	const engine = createHybridEngine({ env: process.env, now: () => clock.t, decision: { decide: async (batch) => {
		if (batch.family !== ROUTE_FAMILY) return route(batch);
		routes++;
		// The first run's route answers after 50 s (past the 45 s default) and selects the move; the next run finishes.
		if (routes === 1) { clock.t += 50_000; return route(batch, ["Boston Globe offices"]); }
		return route(batch, [], "finish");
	} } });
	const calls = [], requests = [];
	const probe = { name: "sl10-call-probe", factory(pi) { pi.on("tool_call", (event) => { calls.push({ tool: event.toolName, id: event.toolCallId, input: structuredClone(event.input) }); }); } };
	const table = await openTable({
		realKernel: true, prepareWorkspace, env: { PI_COC_LOOP_ENGINE: "hybrid-v1" }, runDriver: engine.runDriver,
		extraExtensions: [{ name: "coc-hybrid-engine", factory: engine.extension }, probe],
		responses: [
			(context) => { requests.push(context); return fauxAssistantMessage([fauxToolCall("narrate", { text: "你还站在门口。" })], { stopReason: "toolUse" }); },
			(context) => { requests.push(context); return fauxAssistantMessage([fauxToolCall("narrate", { text: "你想了想。" })], { stopReason: "toolUse" }); },
		],
	});
	t.after(() => table.dispose());
	await table.session.prompt("我去《环球报》报馆。");

	assert.ok(!calls.some((call) => call.id.startsWith("clerk:")), "the clerk wrote nothing after the budget ran out");
	const [first] = requests;
	const note = clerkNotes(first).at(-1);
	assert.equal(note.purpose, "compose");
	assert.equal(note.reason, "run_budget");
	assert.deepEqual(note.deferred_by_budget.map((value) => value.key), ["apply:move:newspaper-morgue"]);
	assert.match(note.budget_note, /close the turn now/);
	assert.match(note.deferred_note, /nothing was executed/);
	assert.equal(note.budget.budget_ms, 45_000);
	const rows = table.telemetry(campaign).filter((row) => row.lane === "run" && row.event === "budget");
	const decided = rows.find((row) => row.decision === "compose");
	assert.equal(decided.budget_ms, 45_000);
	assert.ok(decided.elapsed_ms >= 50_000);
	assert.deepEqual(decided.deferred_by_budget.map((value) => value.key), ["apply:move:newspaper-morgue"]);
	const summary = rows.find((row) => row.decision === "summary");
	assert.equal(summary.budget_ms, 45_000);
	assert.equal(summary.over_budget, true);
	assert.ok(summary.elapsed_at_compose >= 50_000, "the compose started after the budget");
	assert.deepEqual(summary.deferred_by_budget.map((value) => value.key), ["apply:move:newspaper-morgue"]);

	// The next turn's first note to the Keeper says the move was never executed, once.
	await table.session.prompt("嗯，我再想想。");
	const carried = clerkNotes(requests[1]).find((value) => value.deferred_last_turn);
	assert.deepEqual(carried?.deferred_last_turn.map((value) => value.key), ["apply:move:newspaper-morgue"]);
	assert.ok(table.telemetry(campaign).some((row) => row.lane === "run" && row.event === "budget_carried"));
	const second = table.telemetry(campaign).filter((row) => row.lane === "run" && row.event === "budget" && row.decision === "summary").at(-1);
	assert.equal(second.over_budget, false);
	assert.deepEqual(second.deferred_by_budget, []);
	assert.ok(Number.isFinite(second.elapsed_at_compose));
});
