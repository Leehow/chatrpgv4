/**
 * SL-20, once the clerk has settled the player's declaration the run leans to finish (contract §135.11, addendum
 * 2026-09-24 (SL-20); the spec's ruling of the same name).
 *
 * - Policy seam (pure): after a compile-selected clerk step that succeeded, the route's exit defaults to `finish` (the
 *   compose, reason `settled`) unless `continue` or `ask_llm` clears the gates on its own; the live gate #6 turn-2 answer
 *   (ask_llm 0.42 / continue 0.33 / finish 0.23) is the compose. A failed check, or a clerk step the compile did not
 *   select, settles nothing, and the exit is read as before. Needs the route selects still run.
 * - Driver seam (vendored driver, stub ports): a forced session step (an NPC's pending defence) issued after the
 *   settlement still runs before the compose.
 * - Engine seam (hybrid engine, stub kernel): the clerk's execute says whether its check passed; the compose's note
 *   carries the settlement's receipts and the obligation's book line, and says why it is the compose.
 * - Table seam (hybrid engine, emitted kernel): the compile-selected first blow (SL-19, §135.30.2) settles the declaration;
 *   the kernel opens the fight, the NPC's forced defence runs, and the route's unclear exit is the compose.
 */
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { openTable } from "./harness.mjs";
import { isRunEvent, runDriver } from "./pi-agent-core.mjs";
import { buildCandidates } from "../../runtime/jev/candidates.ts";
import { compileRows } from "../../runtime/jev/compile-rows.ts";
import { COMPILE_FAMILY, NONE, UNCLEAR, compileBatch } from "../../runtime/jev/route-compile.ts";
import { createHybridEngine } from "../../runtime/jev/hybrid-engine.ts";
import { BIND_FAMILY, createStepPolicy, initialView, next, routeBatch, settleCompile, settleExecute, settleRoute, startStep } from "../../runtime/jev/step-policy.ts";

const scope = { owner: "campaign:test", campaign: "test", worldline: "main", loop: 0, audience: "keeper" };
const context = { scene: "morgue", clock: null, present: ["the editor"], receipts: [] };
const INPUT = "I explain why I am here and ask him to pull the Corbitt house clippings";

/** The morgue: the gate's check against the editor, one guarded and one unguarded clue (the gate #6 turn-2 shape). */
function morgue() {
	const approaches = ["Persuade", "Intimidate"];
	return {
		capsule: { where: { scene: "morgue" }, present: [{ name: "Arty", role: "gatekeeper", called: { name: "the editor" } }], known: { investigator: { name: "Hayes" } } },
		applyOptions: {
			obligations: [{ handle: "access", name: "Access to the clippings", who: "Arty", state: "open", trigger: { kind: "attempt", guards: { clues: ["story"] } },
				next: { kind: "check", target: "Arty", selection: "approach", approaches: approaches.map((skill) => ({ skill })), difficulty: "regular" } }],
			candidates: [{ effect: { kind: "clue", clue: "story" }, description: { summary: "the 1918 story" }, guarded_by: "access" },
				{ effect: { kind: "clue", clue: "cutoff" }, description: { summary: "The files stop at 1878." } }],
			context: { present: ["Arty"] } },
		resolveOptions: { profiles: approaches.map((skill) => ({ actor: "Hayes", skill, value: skill === "Persuade" ? 70 : 15, availability: "bound" })), decisions: [] },
	};
}

/** A complete Jev answer: `choices[key]` = [choice, confidence, probabilities?]. */
const answer = (choices) => ({ batchId: "b", status: "complete", issues: [], coverage: { required: [], answered: [], unknown: [] },
	answers: Object.fromEntries(Object.entries(choices).map(([key, [choice, confidence, probabilities]]) => [key,
		{ status: "answered", type: "choice", choice, confidence, probabilities: probabilities ?? { [choice]: confidence } }])) });
/** Live gate #6, turn 2, route s6: the exit right after the clerk's settled Persuade. */
const GATE6_EXIT = ["ask_llm", 0.23, { ask_llm: 0.42, continue: 0.33, finish: 0.23, read_more: 0.02 }];

/**
 * The run up to its first route after the clerk's step: the compile selects the check (`compiled`: true) or the check is
 * queued without a compile, the clerk executes it with `check` on its summary, and the fresh read offers the rest.
 */
function afterClerk({ compiled = true, check = "passed" } = {}) {
	const reads = morgue(), candidates = buildCandidates(reads, INPUT), rows = compileRows(reads);
	const view = initialView({ runId: "r", rawInput: INPUT, context, candidates, rows, readFirst: false, ...(compiled ? {} : { compile: false }) });
	let candidate;
	if (compiled) {
		const request = next(view);
		assert.equal(request.purpose, "compile");
		const batch = compileBatch(view, scope, [], []);
		const alias = (family, id) => Object.keys(batch.questions.find((question) => question.key === family).criteria)[rows[family].findIndex((row) => row.id === id)];
		settleCompile(view, startStep(view, request), batch, answer({ ask: [alias("ask", "obligation:access"), 0.9], addressee: [alias("addressee", "Arty"), 0.9],
			act: [alias("act", "social"), 0.9], destination: [NONE, 0.9] }), 5, 0.6);
		const bind = next(view);
		assert.deepEqual([bind.kind, bind.purpose, bind.item.candidate.key], ["decide", "bind", "resolve:obligation:access"], "the compile selected the check");
		startStep(view, bind);
		candidate = bind.item.candidate;
	} else candidate = view.candidates.find((value) => value.key === "resolve:obligation:access");
	const item = { kind: "direct", purpose: "execute", candidate, extra: { skill: "Persuade", intent: "social" } };
	view.budget.steps++;
	const fresh = { context, candidates: buildCandidates(reads, INPUT).filter((value) => value.key !== candidate.key), rows };
	settleExecute(view, view.budget.steps, item, { ok: true, summary: { origin: "policy", tool: "resolve", receipts: ["roll-1"], ...(check ? { check } : {}) } }, fresh, 0);
	return view;
}
/** Ask the route on `view` with the exit `exit` (and `now` for the listed candidate keys); returns the route row. */
function routeWith(view, exit, now = []) {
	const request = next(view);
	assert.deepEqual([request.kind, request.purpose], ["decide", "route"], "the route asks after the clerk's step");
	const { batch, offered } = routeBatch(view, scope, []);
	const needs = Object.fromEntries(offered.map((candidate, index) => [`need_${index + 1}`, now.includes(candidate.key) ? ["now", 0.9] : ["later", 0.9]]));
	return settleRoute(view, startStep(view, request), batch, offered, answer({ ...needs, exit }), 5, 0.6);
}
const head = (view) => { const request = next(view); return [request.kind, request.purpose, request.reason]; };

test("§135.11 SL-20: after the declaration's own step succeeded, gate #6's unclear exit is the compose, reason settled", () => {
	const view = afterClerk();
	assert.deepEqual(view.settled, ["resolve:obligation:access"], "the compile-selected check that passed is the settlement");
	const row = routeWith(view, GATE6_EXIT);
	assert.equal(row.reason, "settled");
	assert.deepEqual(head(view), ["infer", "compose", "settled"], "no Keeper adjudication: the Keeper composes");
	// Without the settlement the same answer is below both gates and goes to the Keeper as before.
	for (const [label, view_] of [["a failed check", afterClerk({ check: "failed" })], ["a check the compile did not select", afterClerk({ compiled: false })]]) {
		assert.deepEqual(view_.settled ?? [], [], `${label}: no settlement`);
		assert.equal(routeWith(view_, GATE6_EXIT).reason, "low_confidence", label);
		assert.deepEqual(head(view_), ["infer", "adjudicate", "low_confidence"], label);
	}
});

test("§135.11 SL-20: continue or ask_llm that clears the gates on its own still hands the run to the Keeper; needs the route selects still run", () => {
	const asked = afterClerk();
	routeWith(asked, ["ask_llm", 0.82, { ask_llm: 0.82, continue: 0.1, finish: 0.08 }]);
	assert.deepEqual(head(asked), ["infer", "adjudicate", "ask_llm"]);
	const margin = afterClerk();
	routeWith(margin, ["ask_llm", 0.5, { ask_llm: 0.62, continue: 0.2, finish: 0.18 }]);
	assert.deepEqual(head(margin), ["infer", "adjudicate", "ask_llm"], "the margin rule clears too");
	const going = afterClerk();
	routeWith(going, ["continue", 0.9, { continue: 0.9, finish: 0.1 }]);
	assert.deepEqual(head(going), ["infer", "adjudicate", "no_candidate"]);
	// A cleared finish, a read_more, an unanswered exit: all the compose.
	for (const exit of [["finish", 0.9], ["read_more", 0.9], [UNCLEAR, 0.9]]) {
		const view = afterClerk();
		routeWith(view, exit);
		assert.deepEqual(head(view).slice(0, 2), ["infer", "compose"], `${exit[0]}`);
	}
	// The lean is about the exit: a need the route selects runs first.
	const needed = afterClerk();
	const row = routeWith(needed, GATE6_EXIT, ["apply:clue:cutoff"]);
	assert.deepEqual(row.detail.selected, ["apply:clue:cutoff"]);
	const request = next(needed);
	assert.deepEqual([request.kind, request.item?.purpose, request.item?.candidate?.key], ["direct", "execute", "apply:clue:cutoff"]);
});

test("§135.11 SL-20 on the driver: a forced session step issued after the settlement still runs before the compose", async () => {
	const reads = morgue(), rows = compileRows(reads), log = [], events = [];
	const defence = { key: "resolve:combat:defend:arty", verb: "resolve", family: "combat", label: "Arty defends", source: "stub",
		bound: { decision: "combat:defend", actor: "Arty", defense: "dodge" }, unbound: [], clerk: "session_step", forced: true };
	let defended = false;
	const fresh = () => ({ context, rows, candidates: [...buildCandidates(reads, INPUT), ...(defended ? [] : [defence])] });
	const policy = createStepPolicy({ context, scope, candidates: [] });
	const ports = {
		clock: { now: () => 0 },
		read: { async read() { log.push("read"); return { status: "ok", artifact: { kind: "read", read: { materials: [], summary: {} }, fresh: { context, rows, candidates: buildCandidates(reads, INPUT) } } }; } },
		decision: { async decide(request) {
			log.push(`decide:${request.purpose}`);
			const batch = request.question.batch;
			const result = batch.family === COMPILE_FAMILY
				? answer(Object.fromEntries(batch.questions.map((question) => {
					const pick = { ask: "obligation:access", addressee: "Arty", act: "social" }[question.key];
					const index = pick ? rows[question.key].findIndex((row) => row.id === pick) : -1;
					return [question.key, [index >= 0 ? Object.keys(question.criteria)[index] : NONE, 0.9]];
				})))
				: batch.questions.some((question) => question.key === "exit")
					? answer(Object.fromEntries(batch.questions.map((question) => [question.key, question.key === "exit" ? GATE6_EXIT : ["later", 0.9]])))
					: answer(Object.fromEntries(batch.questions.map((question) => [question.key, [question.key === "skill" ? "Persuade" : question.key === "intent" ? "social" : "none", 0.9]])));
			return { status: "ok", artifact: { kind: request.purpose, result } };
		} },
		operations: { async execute(proposal) {
			if (proposal.operation === "turn_close") { log.push("turn_close"); return { status: "ok", artifact: { kind: "turn_close", verdict: { status: "none", reason: "nothing_owed" } } }; }
			const key = proposal.params.candidate.key;
			log.push(`clerk:${key}`);
			if (key === defence.key) defended = true;
			// The clerk's check passes, and the kernel then forces the NPC's defence (it accepts nothing else next).
			return { status: "ok", artifact: { kind: "execute", executed: { ok: true, summary: { origin: "policy", tool: proposal.params.candidate.verb, receipts: [`r-${log.length}`], check: "passed" } }, fresh: fresh() } };
		} },
		record: { record: (event) => events.push(event) },
	};
	const engine = {
		async infer({ purpose }) { log.push(`infer:${purpose}`); return fauxAssistantMessage("The editor pulls the drawer.", { stopReason: "stop" }); },
		async executeModelTool() { throw new Error("no model tool"); }, async refuseModelTool() { throw new Error("no model tool"); },
		async closeTurn() { return { continueRequested: false }; },
	};
	await runDriver({ input: { runId: "r1", inputRevision: "rev", rawInput: INPUT, scopeId: "root" }, policy, ports, engine, emit: () => {}, signal: new AbortController().signal, maxSteps: 30 });
	assert.deepEqual(log, ["read", "decide:compile", "decide:bind", "clerk:resolve:obligation:access", "clerk:resolve:combat:defend:arty", "decide:route", "infer:compose", "turn_close"],
		"the forced defence runs after the settlement and before the route and the compose");
	const infer = events.find((event) => event.type === "step_end" && event.kind === "infer");
	assert.equal(infer.reason, "settled");
});

test("§135.11 SL-20 at the engine: the clerk's execute says whether its check passed; the compose's note carries the receipts, the obligation's line and why it composes", async () => {
	const handlers = new Map(), rows = [];
	const bus = { on: (name, handler) => handlers.set(name, handler), emit: (name, value) => handlers.get(name)?.(value) };
	const engine = createHybridEngine({ env: {}, decision: null, record: (row) => rows.push(row) });
	engine.extension({ events: bus, on: () => {}, getActiveTools: () => [], setActiveTools: () => {} });
	const reads = morgue();
	bus.emit("coc:kernel-bridge", { campaign: "c", call: async (method) => method === "table.capsule"
		? { ...reads.capsule, _context: { version: 1, campaign: "c", worldline: "main", loop: 0, turn: 2, source_revision: "a".repeat(64) } }
		: method === "table.status" ? { turn: 2, state: "open", receipts: [] }
			: method === "table.apply.options" ? reads.applyOptions : method === "table.resolve.options" ? reads.resolveOptions : {} });
	let passed = true;
	bus.emit("coc:operation-dispatcher", { dispatch: async () => ({ status: "succeeded", receipts: ["roll:persuade-t2-c1"],
		result: { outcome: { skill: "Persuade", passed, level: passed ? "hard" : "failure" }, obligation: { handle: "access", settled: passed } } }) });
	const plan = engine.runDriver.prepare({ runId: "run-1", inputRevision: "rev", rawInput: INPUT, session: {} });
	const invocation = (step) => ({ runId: "run-1", stepId: step, operationId: `${step}/op1`, origin: "policy", inputRevision: "rev", scopeId: "root", signal: new AbortController().signal });
	await plan.ports.read.read({ origin: "policy", operation: "read", readOnly: true }, invocation("s1"));
	const check = buildCandidates(reads, INPUT).find((candidate) => candidate.key === "resolve:obligation:access");
	const execute = (step) => plan.ports.operations.execute({ origin: "policy", operation: "execute",
		params: { candidate: check, extra: { skill: "Persuade", intent: "social", bonus: "none", penalty: "none" } } }, invocation(step));
	const done = await execute("s4");
	assert.equal(done.artifact.executed.summary.check, "passed", "the closed outcome travels with the step");
	const [message] = await plan.ports.projection.project({ view: { policyState: { view: {} } }, stepId: "s6", step: { kind: "infer", purpose: "compose", reason: "settled" } });
	const note = JSON.parse(message.content);
	assert.deepEqual([note.purpose, note.reason], ["compose", "settled"]);
	assert.deepEqual(note.clerk_did[0].receipts, ["roll:persuade-t2-c1"], "the settlement's receipts");
	assert.match(note.clerk_did[0].obligation, /^obligation access: Persuade \(regular\) passed, settled; receipt roll:persuade-t2-c1/, "the obligation's book line");
	assert.match(note.settled_note, /settled the player's declared step/, "the compose says why it is the compose");
	passed = false;
	assert.equal((await execute("s7")).artifact.executed.summary.check, "failed");
	const [other] = await plan.ports.projection.project({ view: { policyState: { view: {} } }, stepId: "s8", step: { kind: "infer", purpose: "adjudicate", reason: "low_confidence" } });
	assert.equal(JSON.parse(other.content).settled_note, undefined, "only the settlement's compose carries the note");
});

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
/** Kernel requests on the workspace, through the emitted kernel's own RPC (to put the table in a state). */
function kernelSteps(workspace, campaign, requests) {
	const input = requests.map((request, index) => JSON.stringify({ id: String(index), method: request[0], params: { campaign, ...request[1] } })).join("\n");
	const run = spawnSync(process.execPath, [join(REPO, "build/kernel/rpc.mjs"), "--workspace", workspace, "--content", join(REPO, "content")],
		{ cwd: REPO, input: `${input}\n`, encoding: "utf8" });
	const frames = run.stdout.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line)).filter((frame) => !frame.progress);
	for (const frame of frames) if (!frame.ok) throw new Error(`fixture step ${frame.id} failed: ${JSON.stringify(frame.error)}`);
	return frames;
}
/** A Jev answer in the adapter's shape: `pick(question)` returns [choice, confidence, probabilities] or a choice. */
function answered(batch, pick) {
	const answers = {};
	for (const question of batch.questions) {
		const picked = pick(question), [choice, confidence, probabilities] = Array.isArray(picked) ? picked : [picked ?? (Object.keys(question.criteria)[0] === "now" ? "later" : "unknown"), 0.9];
		answers[question.key] = { status: "answered", type: "choice", choice, confidence, probabilities: probabilities ?? { [choice]: confidence } };
	}
	return { batchId: batch.id, status: "complete", answers, coverage: { required: Object.keys(answers), answered: Object.keys(answers), unknown: [] }, issues: [] };
}

test("§135.11 SL-20 at the table: the compile-selected first blow settles the declaration; the kernel's forced defence still runs, then the compose", async (t) => {
	const campaign = "test-camp";
	// SL-19's state: Knott has numbers and holds back when hit; no fight is running.
	const prepareWorkspace = (workspace) => kernelSteps(workspace, campaign, [
		["table.open", {}], ["table.player_input", { text: "我盯着他" }],
		["table.apply", { call_id: "t1-c1", effects: [{ kind: "npc", name: "Steven Knott", archetype: "ordinary_adult", why: "test fixture" }] }],
		["table.apply", { call_id: "t1-c2", effects: [{ kind: "npc", name: "Steven Knott", disposition: "avoids_fighting", why: "test fixture" }] }],
		["table.narrate", { call_id: "t1-c3", text: "他在桌后看着你。" }],
	]);
	const alias = (question, match) => Object.entries(question.criteria).find(([, value]) => match(value))?.[0];
	const calls = [], events = [];
	const engine = createHybridEngine({ env: process.env, decision: { decide: async (batch) => batch.family === COMPILE_FAMILY
		? answered(batch, (question) => question.key === "act" ? alias(question, (value) => typeof value === "string" && value.startsWith("combat"))
			: question.key === "target" ? alias(question, (value) => JSON.stringify(value).includes("Steven Knott") || JSON.stringify(value).includes("史蒂文")) : "unclear")
		: batch.family === BIND_FAMILY ? answered(batch, (question) => question.key === "weapon" ? "unarmed" : "unknown")
			: answered(batch, (question) => question.key === "exit" ? GATE6_EXIT : undefined) } });
	const table = await openTable({ realKernel: true, prepareWorkspace, env: { PI_COC_LOOP_ENGINE: "hybrid-v1" }, runDriver: engine.runDriver,
		extraExtensions: [{ name: "coc-hybrid-engine", factory: engine.extension }, { name: "sl20-call-probe", factory(pi) {
			pi.on("tool_call", (event) => { calls.push({ id: event.toolCallId, tool: event.toolName, input: structuredClone(event.input) }); });
		} }],
		responses: [fauxAssistantMessage([fauxToolCall("narrate", { text: "你一拳打在他脸上。" })], { stopReason: "toolUse" })] });
	t.after(() => table.dispose());
	table.session.subscribe((event) => { if (isRunEvent(event)) events.push(event); });
	await table.session.prompt("我揪住他的领子一拳打过去");
	const telemetry = table.telemetry(campaign);
	const clerk = calls.filter((call) => call.id.startsWith("clerk:")).map((call) => call.input.action?.decision);
	assert.deepEqual(clerk, ["combat:attack", "combat:defend"], "the clerk's first blow, then the NPC's forced defence");
	const route = telemetry.find((entry) => entry.lane === "route" && entry.purpose === "route");
	assert.deepEqual([route?.reason, route?.settled], ["settled", ["resolve:combat:first-blow"]], "the unclear exit after the settled first blow is the compose");
	const infers = events.filter((event) => event.type === "step_end" && event.kind === "infer");
	assert.deepEqual(infers.map((event) => [event.purpose, event.reason]), [["compose", "settled"]], "one model step: the compose");
	const stepOf = (value) => Number(/:s(\d+)$/.exec(String(value))?.[1]);
	const defend = telemetry.find((entry) => entry.tool === "resolve" && entry.origin === "policy" && entry.clerk === "session_step");
	const compose = events.find((event) => event.type === "step_start" && event.kind === "infer");
	assert.ok(stepOf(defend?.step) < stepOf(route.step) && stepOf(route.step) < stepOf(compose.stepId), "the forced defence, then the route, then the compose");
});
