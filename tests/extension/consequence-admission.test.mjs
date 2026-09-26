/**
 * SL-90 (ticket `docs/specs/pi-native-single-loop-tickets/90-a-consequence-step-is-admitted-on-its-own-evidence.md`;
 * contract §32.12 addendum, §135.32 addendum 5): a step the consequence route executes carries `basis.consequence
 * {class, key, confidence, distribution, gate}` into the gateway and is admitted on that evidence -- `path:
 * "consequence"`, no lane round -- exactly as a compile selection carries `basis.compile` and is admitted `path:
 * "compile"` (§32.12). Only the classes `jev_steps.execute` names ever take this path; absent or malformed
 * evidence, or a class the table does not currently execute, keeps the ordinary lane review (fail closed).
 *
 * Three layers, cheapest first:
 * - `consequenceAdmission` (pure, `admission.ts`): the same shape of tests `compileAdmission` already has in
 *   `admission-within-turn.test.mjs`.
 * - `candidateWithConsequenceBasis` (pure, `consequence-route.ts`): the evidence lands on the executed
 *   candidate's own `basis`, beside its provenance, never replacing it.
 * - the engine seam (`hybrid-engine.ts` driven directly, no Pi session, no kernel -- the same harness shape
 *   `consequence-execute-mode.test.mjs` uses), proving the *attach*: what `clerkStep` hands the dispatcher's
 *   `context.origin.basis` for an executed candidate.
 * - the extension seam (the real `apply` tool, the real admission seam, the emitted kernel, the product's hybrid
 *   engine with a stub Jev -- the same harness shape `admission-within-turn.test.mjs`'s compile tests use),
 *   proving the *admit*: the executed write's own admission row reads `path: "consequence"` and the scripted
 *   admission lane (`table.lanes.admission`) is never asked.
 */
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { openTable } from "./harness.mjs";
import { consequenceAdmission } from "../../extensions/kernel/admission.ts";
import { createHybridEngine } from "../../runtime/jev/hybrid-engine.ts";
import { candidateWithConsequenceBasis, CONSEQUENCE_FAMILY } from "../../runtime/jev/consequence-route.ts";
import { COMPILE_FAMILY } from "../../runtime/jev/route-compile.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// ---- consequenceAdmission (pure) --------------------------------------------------------------------------------------

const EXECUTE = ["clue_follow_up"];
const evidence = (overrides = {}) => ({
	origin: "policy",
	basis: { read: "table.apply.options", path: "candidates[0]", row: { effect: { kind: "clue", clue: "globe-story" } },
		consequence: { class: "clue_follow_up", key: "consequence:clue_follow_up:globe-story", confidence: 0.93,
			distribution: { true: 0.93, false: 0.07 }, gate: { row_min: 0.4, row_ratio: 0.67 } } },
	...overrides,
});

test("SL-90 consequenceAdmission: an executed clue_follow_up's own evidence is admitted; anything missing or out of `execute` refuses the exemption", () => {
	const admitted = consequenceAdmission(evidence(), EXECUTE);
	assert.deepEqual(admitted, { ok: true, class: "clue_follow_up", key: "consequence:clue_follow_up:globe-story", confidence: 0.93,
		distribution: { true: 0.93, false: 0.07 }, gate: { rowMin: 0.4, rowRatio: 0.67 } });
	// Not a consequence execution at all: nothing to say, the review runs.
	assert.equal(consequenceAdmission(undefined, EXECUTE), undefined);
	assert.equal(consequenceAdmission({ label: "model" }, EXECUTE), undefined, "the Keeper's own call");
	assert.equal(consequenceAdmission(evidence({ origin: "host" }), EXECUTE), undefined, "another host operation");
	assert.equal(consequenceAdmission({ origin: "policy", basis: { compile: { predicate: "move" } } }, EXECUTE), undefined, "a compile selection, not a consequence one");

	const refused = (value, executeClasses = EXECUTE) => {
		const result = consequenceAdmission(value, executeClasses);
		return result?.ok === false ? result.reason : "admitted";
	};
	// The class the shipped data does not list as executed: refused even though the rest of the evidence is fine.
	assert.equal(refused(evidence(), ["npc_reaction"]), "class_not_executed");
	assert.equal(refused(evidence(), []), "class_not_executed");
	// Every required field, missing or malformed in turn.
	const withConsequence = (patch) => evidence({ basis: { ...evidence().basis, consequence: { ...evidence().basis.consequence, ...patch } } });
	assert.equal(refused(withConsequence({ class: undefined })), "class_unrecorded");
	assert.equal(refused(withConsequence({ class: "" })), "class_unrecorded");
	assert.equal(refused(withConsequence({ class: 7 })), "class_unrecorded");
	assert.equal(refused(withConsequence({ key: undefined })), "key_unrecorded");
	assert.equal(refused(withConsequence({ key: "" })), "key_unrecorded");
	assert.equal(refused(withConsequence({ confidence: undefined })), "confidence_unrecorded", "a direct row's null confidence is not evidence");
	assert.equal(refused(withConsequence({ confidence: null })), "confidence_unrecorded");
	assert.equal(refused(withConsequence({ confidence: 1.4 })), "confidence_unrecorded", "out of [0, 1]");
	assert.equal(refused(withConsequence({ confidence: -0.1 })), "confidence_unrecorded");
	assert.equal(refused(withConsequence({ confidence: "0.9" })), "confidence_unrecorded", "a string, not a number");
	assert.equal(refused(withConsequence({ distribution: undefined })), "distribution_unrecorded");
	assert.equal(refused(withConsequence({ distribution: null })), "distribution_unrecorded");
	assert.equal(refused(withConsequence({ distribution: { true: 0.93 } })), "distribution_unrecorded", "half a distribution");
	assert.equal(refused(withConsequence({ distribution: { true: 0.93, false: "0.07" } })), "distribution_unrecorded");
	assert.equal(refused(withConsequence({ gate: undefined })), "gate_unrecorded");
	assert.equal(refused(withConsequence({ gate: { row_min: 0.4 } })), "gate_unrecorded", "no row_ratio");
	assert.equal(refused(withConsequence({ gate: { row_min: 0, row_ratio: 2 } })), "gate_unrecorded", "row_min out of (0, 1)");
	assert.equal(refused(withConsequence({ gate: { row_min: 1, row_ratio: 2 } })), "gate_unrecorded");
	assert.equal(refused(withConsequence({ gate: { row_min: 0.4, row_ratio: 0 } })), "gate_unrecorded", "row_ratio must be > 0");
	// The class check reads the field, not a literal: a well-formed row of a *different* class admits when that
	// class -- not `clue_follow_up` -- is the one the table currently executes.
	assert.equal(consequenceAdmission(withConsequence({ class: "npc_reaction", key: "consequence:npc_reaction:hayes:thomas" }), ["npc_reaction"])?.ok, true);
});

// ---- candidateWithConsequenceBasis (pure) -----------------------------------------------------------------------------

test("SL-90 candidateWithConsequenceBasis: the evidence rides beside the candidate's own provenance, never replacing it", () => {
	const candidate = { key: "consequence:clue_follow_up:globe-story", verb: "apply", family: "clue_follow_up", label: "x", source: "table.apply.options",
		bound: { kind: "clue", clue: "globe-story" }, unbound: [], consequenceClass: "clue_follow_up", clerk: "consequence_bookkeeping",
		basis: { read: "table.apply.options", path: "candidates[0]", row: { effect: { kind: "clue", clue: "globe-story" } } } };
	const row = { class: "clue_follow_up", key: candidate.key, cleared: true, confidence: 0.93, distribution: { true: 0.93, false: 0.07 } };
	const executed = candidateWithConsequenceBasis(candidate, row, { rowMin: 0.4, rowRatio: 0.67 });
	assert.deepEqual(executed.basis, { read: "table.apply.options", path: "candidates[0]", row: { effect: { kind: "clue", clue: "globe-story" } },
		consequence: { class: "clue_follow_up", key: candidate.key, confidence: 0.93, distribution: { true: 0.93, false: 0.07 }, gate: { row_min: 0.4, row_ratio: 0.67 } } });
	// The original candidate is untouched; every other field survives (it is the same object, not a rebuild).
	assert.deepEqual(candidate.basis, { read: "table.apply.options", path: "candidates[0]", row: { effect: { kind: "clue", clue: "globe-story" } } });
	assert.equal(executed.consequenceClass, "clue_follow_up");
	assert.equal(executed.clerk, "consequence_bookkeeping");
	// A candidate with no prior basis at all still gets one, carrying only `consequence`.
	const bare = candidateWithConsequenceBasis({ ...candidate, basis: undefined }, row, { rowMin: 0.5, rowRatio: 2 });
	assert.deepEqual(bare.basis, { consequence: { class: "clue_follow_up", key: candidate.key, confidence: 0.93, distribution: { true: 0.93, false: 0.07 },
		gate: { row_min: 0.5, row_ratio: 2 } } });
});

// ---- the engine seam: what `clerkStep` attaches for the dispatcher (no Pi session, no kernel) -------------------------

function clearAllConsequence(batch) {
	const answers = {};
	for (const question of batch.questions) answers[question.key] = { status: "answered", type: "noul", noul: 0.95 };
	return { batchId: batch.id, status: "complete", answers, coverage: { required: Object.keys(answers), answered: Object.keys(answers), unknown: [] }, issues: [] };
}
function clearNothing(batch) {
	const answers = {};
	for (const question of batch.questions) answers[question.key] = { status: "answered", type: "noul", noul: 0.5 };
	return { batchId: batch.id, status: "complete", answers, coverage: { required: Object.keys(answers), answered: Object.keys(answers), unknown: [] }, issues: [] };
}

/** Same shape `consequence-execute-mode.test.mjs` uses, plus the dispatched `context` beside each `operation`. */
function harness({ env, decide }) {
	const handlers = new Map(), rows = [], dispatches = [], contexts = [];
	const bus = { on: (name, handler) => handlers.set(name, handler), emit: (name, value) => handlers.get(name)?.(value) };
	const engine = createHybridEngine({ env, decision: { decide: async (batch, lease) => decide(batch, lease) }, record: (row) => rows.push(row) });
	engine.extension({ events: bus, on: () => {}, getActiveTools: () => [], setActiveTools: () => {} });
	const state = { applyOptions: { candidates: [] }, resolveOptions: {}, capsule: {}, receipts: [] };
	bus.emit("coc:kernel-bridge", {
		campaign: "c",
		call: async (method) => {
			if (method === "table.capsule") return { where: { scene: "office" }, present: [], known: { investigator: { name: "Hayes" } }, ...state.capsule,
				_context: { version: 1, campaign: "c", worldline: "main", loop: 0, turn: 2, source_revision: "a".repeat(64) } };
			if (method === "table.status") return { turn: 2, state: "open", receipts: state.receipts };
			if (method === "table.apply.options") return state.applyOptions;
			if (method === "table.resolve.options") return state.resolveOptions;
			return {};
		},
	});
	bus.emit("coc:operation-dispatcher", { dispatch: async (operation, context) => {
		dispatches.push(operation); contexts.push(context);
		return { status: "succeeded", receipts: [`receipt:c${dispatches.length}`], result: {} };
	} });
	bus.emit("coc:turn-close", { verdict: async () => ({ status: "none" }) });
	const plan = engine.runDriver.prepare({ runId: "run-1", inputRevision: "rev", rawInput: "I search the room", session: {} });
	const invocation = (step, extra = {}) => ({ runId: "run-1", stepId: step, operationId: `${step}/op1`, origin: "policy",
		inputRevision: "rev", scopeId: "root", signal: new AbortController().signal, ...extra });
	return { plan, rows, dispatches, contexts, state, invocation,
		read: (step) => plan.ports.read.read({ origin: "policy", operation: "read", readOnly: true }, invocation(step)),
		clerkExecute: (step, candidate, extra = {}) => plan.ports.operations.execute(
			{ origin: "policy", operation: "execute", params: { candidate, extra } }, invocation(step)) };
}

const seedCandidate = { key: "apply:clue:seed", verb: "apply", family: "clue", label: "Reveal the seed clue", source: "t",
	bound: { kind: "clue", clue: "seed" }, unbound: [], clerk: "declared_bookkeeping" };
const clueRow = (clue, summary = "x") => ({ effect: { kind: "clue", clue }, description: { summary } });

test("SL-90 (engine seam): the executed clue_follow_up's own dispatch carries `basis.consequence` -- class, key, confidence, distribution and the gate that cleared it", async () => {
	const h = harness({ env: { COC_JEV_STEPS: "on" }, decide: (batch) => batch.family === CONSEQUENCE_FAMILY ? clearAllConsequence(batch) : clearNothing(batch) });
	h.state.applyOptions = { candidates: [clueRow("globe-story")] };
	await h.read("s1");
	await h.clerkExecute("s2", seedCandidate);
	assert.equal(h.dispatches.length, 2, "the seed write, then the executed consequence");
	const [, consequenceContext] = h.contexts;
	assert.equal(consequenceContext.origin.origin, "policy");
	assert.equal(consequenceContext.origin.clerk, "consequence_bookkeeping");
	// `clue_follow_up`'s own gate is the shipped `content/rulesets/coc7/host-budgets.json`'s per-class override
	// (§135.32 addendum 3.1: row_min 0.4, row_ratio 0.67), not the shared default -- proving `thresholdsForClass`,
	// not a literal, produced this row's `gate`.
	assert.deepEqual(consequenceContext.origin.basis.consequence, {
		class: "clue_follow_up", key: "consequence:clue_follow_up:globe-story", confidence: 0.95, distribution: { true: 0.95, false: 1 - 0.95 },
		gate: { row_min: 0.4, row_ratio: 0.67 },
	});
	// The candidate's own provenance (never a Jev/model-visible field) survives beside the new evidence.
	assert.equal(consequenceContext.origin.basis.read, "table.apply.options");
	assert.equal(consequenceContext.origin.basis.path, "candidates[0]");
});

test("SL-90 (engine seam): a class not in `jev_steps.execute` never executes, so it never even reaches `clerkStep` to carry evidence at all", async () => {
	const h = harness({ env: { COC_JEV_STEPS: "on" }, decide: (batch) => batch.family === CONSEQUENCE_FAMILY ? clearAllConsequence(batch) : clearNothing(batch) });
	// `npc_reaction` clears exactly as the clue does (SL-78's own test proves this), but it is not in the shipped
	// `execute` list -- so it must never dispatch, and therefore never carry `basis.consequence` either.
	h.state.capsule = { mods: { pending_contacts: [{ decision: "natural-npc:first-impression", target: "thomas-hayes-npc", actor: "hayes" }] } };
	await h.read("s1");
	await h.clerkExecute("s2", seedCandidate);
	assert.equal(h.dispatches.length, 1, "only the seed write; the npc_reaction candidate never dispatched");
	assert.ok(!h.contexts.some((context) => context.origin?.basis?.consequence), "no dispatch ever carried consequence evidence");
});

// ---- the extension seam: the real admission, the emitted kernel, the product's hybrid engine ---------------------------

/** Kernel requests run once on the prepared workspace, through the emitted kernel's own RPC. */
function kernelSteps(workspace, requests) {
	const input = requests.map((request, index) => JSON.stringify({ id: String(index), method: request[0], params: { campaign: "test-camp", ...request[1] } })).join("\n");
	const run = spawnSync(process.execPath, [join(REPO, "build/kernel/rpc.mjs"), "--workspace", workspace, "--content", join(REPO, "content")], { cwd: REPO, input: `${input}\n`, encoding: "utf8" });
	const frames = run.stdout.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line)).filter((frame) => !frame.progress);
	for (const frame of frames) if (!frame.ok) throw new Error(`fixture step ${frame.id} failed: ${JSON.stringify(frame.error)}`);
}
/**
 * Turn 1 asked Knott about the job (the opening `commission-briefing` scene) and closed without discovering
 * anything: `table.apply.options` there offers `knott-commission` (and `knott-macario-summary`) as plain,
 * un-guarded clue candidates -- the shipped module's own `clue_follow_up` D1 candidates, confirmed by probing
 * the real kernel directly (`table.player_input` then `table.apply.options`) before writing this fixture.
 */
const askedKnott = (workspace) => kernelSteps(workspace, [
	["table.open", {}],
	["table.player_input", { text: "我问诺特这份工作的细节" }],
	["table.narrate", { call_id: "t1-c1", text: "诺特点了点头，说这好谈。" }],
]);
const complete = (answers) => ({ batchId: "b", status: "complete", answers, issues: [], coverage: { required: Object.keys(answers), answered: Object.keys(answers), unknown: [] } });
const noul = (p) => ({ status: "answered", type: "noul", noul: p });
/**
 * A stub Jev for the whole run: the compile never fires (every family/act/addressee/destination answers
 * `unclear`, so nothing is compile-selected and the Keeper's own trigger write stays a plain model-origin call);
 * the consequence route clears only the named clue's own Noul and its class's `exists` Noul, at high confidence;
 * every other family (the route's own `exit`/`now`/`seeks` questions) takes the same generic default
 * `admission-within-turn.test.mjs`'s `stubJev` uses.
 */
function stubJevForConsequence(clue) {
	return { decide: async (batch) => {
		if (batch.family === COMPILE_FAMILY) return complete(Object.fromEntries(batch.questions.map((question) => [question.key, { status: "answered", type: "choice", choice: "unclear", confidence: 0.9, probabilities: { unclear: 0.9 } }])));
		if (batch.family === CONSEQUENCE_FAMILY) return complete(Object.fromEntries(batch.questions.map((question) =>
			[question.key, noul(question.target?.includes(clue) || question.key.startsWith("exists_") ? 0.95 : 0.05)])));
		return complete(Object.fromEntries(batch.questions.map((question) => {
			const choice = question.key === "exit" ? "finish" : Object.keys(question.criteria ?? {})[0] === "now" ? "later" : question.criteria?.seeks ? "not" : "unknown";
			return [question.key, { status: "answered", type: "choice", choice, confidence: 0.9, probabilities: { [choice]: 0.9 } }];
		})));
	} };
}
const narrateOnly = (text) => [fauxAssistantMessage([fauxToolCall("narrate", { text })], { stopReason: "toolUse" })];
const admissionRows = (table) => table.telemetry("test-camp").filter((row) => row.lane === "admission");

test("SL-90 (extension seam): an executed clue_follow_up write is admitted path 'consequence', and the scripted admission lane is never asked", async (t) => {
	const engine = createHybridEngine({ env: process.env, decision: stubJevForConsequence("knott-commission") });
	const table = await openTable({
		realKernel: true, prepareWorkspace: askedKnott,
		env: { PI_COC_LOOP_ENGINE: "hybrid-v1", COC_KERNEL_SEED: "4", COC_JEV_STEPS: "on" },
		runDriver: engine.runDriver, extraExtensions: [{ name: "coc-hybrid-engine", factory: engine.extension }],
		responses: [
			fauxAssistantMessage([fauxToolCall("apply", { effects: [{ kind: "note", name: "confirm-terms", text: "向诺特确认每日报酬与调查范围。" }] })], { stopReason: "toolUse" }),
			...narrateOnly("诺特说明了每日的报酬和调查范围。"),
			fauxAssistantMessage("after"),
		],
	});
	t.after(() => table.dispose());
	await table.session.prompt("好的，我了解了。");

	const rows = admissionRows(table).filter((row) => row.origin === "policy" && row.clerk === "consequence_bookkeeping");
	assert.equal(rows.length, 1, "exactly one admission row for the executed consequence write");
	const [row] = rows;
	assert.deepEqual([row.path, row.reviewer, row.verdict, row.admitted], ["consequence", "consequence", "authorized", true]);
	assert.equal(row.class, "clue_follow_up");
	assert.equal(row.key, "consequence:clue_follow_up:knott-commission");
	assert.equal(typeof row.confidence, "number");
	assert.ok(row.confidence >= 0.9);
	assert.equal(typeof row.gate?.row_min, "number");
	assert.equal(table.lanes.admission.requests().length, 0, "the lane was never asked for the executed write");
	// The write itself landed on the real kernel (not merely admitted): the clerk's own `bind` row for this
	// candidate says so, `succeeded`, with a minted call id.
	const bind = table.telemetry("test-camp").find((entry) => entry.lane === "run" && entry.event === "bind"
		&& entry.candidate === "consequence:clue_follow_up:knott-commission");
	assert.ok(bind, "the clerk's bind row for the executed candidate exists");
	assert.equal(bind.status, "succeeded");
	assert.ok(bind.call_id, "the kernel minted a call id for the landed write");
});

test("SL-90 (extension seam): the same executed candidate with no `basis.consequence` at all keeps the ordinary lane review", async (t) => {
	// Same fixture, but the engine is plain hybrid-v1 with `COC_JEV_STEPS` unset (shadow): the consequence route
	// never executes anything, so the only clerk writes are compile selections, which carry no consequence
	// evidence either -- an ordinary Keeper `apply` is model-origin and always reviewed by the lane regardless.
	const engine = createHybridEngine({ env: process.env, decision: stubJevForConsequence("knott-commission") });
	const table = await openTable({
		realKernel: true, prepareWorkspace: askedKnott,
		env: { PI_COC_LOOP_ENGINE: "hybrid-v1", COC_KERNEL_SEED: "4" },
		runDriver: engine.runDriver, extraExtensions: [{ name: "coc-hybrid-engine", factory: engine.extension }],
		responses: [
			fauxAssistantMessage([fauxToolCall("apply", { effects: [{ kind: "clue", clue: "knott-commission", how: "诺特当面说明。", label: "报酬与范围" }] })], { stopReason: "toolUse" }),
			...narrateOnly("诺特说明了每日的报酬和调查范围。"),
			fauxAssistantMessage("after"),
		],
	});
	t.after(() => table.dispose());
	await table.session.prompt("好的，我了解了。");

	const rows = admissionRows(table).filter((row) => row.verb === "apply" && row.origin === "model");
	assert.ok(rows.length >= 1, "the Keeper's own clue landing was reviewed as an ordinary call");
	assert.ok(rows.every((row) => row.path !== "consequence"), "never admitted on consequence evidence it does not carry");
	assert.ok(table.lanes.admission.requests().length >= 1, "the lane was asked, exactly as any Keeper-origin write is");
});
