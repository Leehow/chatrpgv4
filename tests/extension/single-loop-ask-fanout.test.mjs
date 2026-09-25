/**
 * SL-52 (spec pi-native-single-loop; contract §135.30.9): the compile's `ask` feature fans out.
 *
 * Long gate #6 turn 1, "我接。先去《环球报》剪报室，翻科比特宅这些年的旧报道。": the `ask` feature listed five rows (the commission, the
 * research leads, the Macario summary, the keys, handout 1) and answered one choice, the leads at 0.89 with the keys at 0, so
 * `guard_unlock` filed the leads and the move and the keys clue the same accept files was never read. Each `ask` row is now its
 * own yes/no question at the gate; every clue whose `yes` clears is filed by the clerk in that compile, in the rows' order,
 * each admitted on its own row's record; `guard_unlock` stays the special case that also stages the move, which now runs
 * after the batch's other reveals. A row that does not clear stays the Keeper's (the route's), and a clue whose kernel row
 * states that finding it is a check is not filed.
 *
 * Stage 2 (§135.30.9.1, §135.30.9.2): a row clears on confidence only (no margin rule), and a declaration that settles a step
 * of the book (an obligation's check, the clue that meets a destination's guard) re-asks the scene's other clue rows once,
 * each against the book's own cues; a `yes` is filed after the settling step lands (the keys of the accept).
 *
 * - At the policy seam over Knott's office in the kernel's row shapes (pure).
 * - On the emitted kernel over the haunting through the hybrid engine (a stub Jev with turn 1's per-row answers, the faux
 *   Keeper): the clerk files the leads, the keys and then the move, each admitted `path: "compile"`, with receipts.
 *
 * Assertions are on rows, selections, admissions and receipts, never on prose.
 */
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { openTable } from "./harness.mjs";
import { askWords, isAskRow } from "./compile-ask.mjs";
import { compileAdmission } from "../../extensions/kernel/admission.ts";
import { buildCandidates } from "../../runtime/jev/candidates.ts";
import { compileRows } from "../../runtime/jev/compile-rows.ts";
import { COMPILE_FAMILY, REASK_FAMILY, compileBatch, interpretCompile, reaskBatch } from "../../runtime/jev/route-compile.ts";
import { createHybridEngine } from "../../runtime/jev/hybrid-engine.ts";
import { initialView, missedUnlocks, next, settleCompile, settleExecute, settleReask, startStep } from "../../runtime/jev/step-policy.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const INPUT = "我接。先去《环球报》剪报室，翻科比特宅这些年的旧报道。";
const scope = { owner: "campaign:test", campaign: "test", worldline: "main", loop: 0, audience: "keeper" };
const context = { scene: "office", clock: null, present: [], receipts: [] };

// ---------------------------------------------------------------------------------------------------
// At the policy seam: Knott's office of turn 1, in the kernel's own row shapes.
// ---------------------------------------------------------------------------------------------------

const exists = { place: true, entrance: true, from: "office", from_place: "Knott's Office" };
const LEADS = { condition: "clue_discovered: leads", clue: { clue: "leads", says: "Knott points them toward the Globe.", found_at: [{ scene: "office" }] }, exists };
const KEYS = { condition: "clue_discovered: keys", clue: { clue: "keys", says: "Knott hands over the keys.", found_at: [{ scene: "office" }] }, exists };
const clueRow = (clue, summary, delivery_kind, cues) => ({ effect: { kind: "clue", clue }, description: { kind: "clue", name: clue, summary, delivery_kind, ...(cues ? { cues } : {}) } });
/** The book's cues at Knott's office (the kernel's clue rows carry them, §135.30.9.2). */
const CUES = { commission: ["Confirm the daily fee, payment terms, scope of the investigation, and the house's address with Knott."],
	leads: ["Ask which public records or informed witnesses might reveal the house's history."],
	macario: ["Ask what actually happened to the Macario family, the former tenants."],
	keys: ["Accept the commission explicitly and take the key, address, and cash advance."] };
/**
 * Knott's office. `filed`: the clues already filed (no longer issued; their unlocks met). `ledger`: one more clue, found only
 * by a check (`delivery_kind: skill_check`).
 */
function office({ filed = [], ledger = false } = {}) {
	const held = (guard, clue) => filed.includes(clue) ? { condition: guard.condition, met: true } : { ...guard, met: false };
	const clues = [clueRow("commission", "Knott names the fee and the terms.", "npc_dialogue", CUES.commission),
		clueRow("leads", "Knott points them toward the Globe.", "npc_dialogue", CUES.leads),
		clueRow("macario", "The Macarios fled the house.", "npc_dialogue", CUES.macario), clueRow("keys", "Knott hands over the keys.", "obvious", CUES.keys),
		...(ledger ? [clueRow("ledger", "A rent ledger hidden in the desk.", "skill_check", ["Search Knott's desk drawers."])] : [])].filter((row) => !filed.includes(row.effect.clue));
	return {
		capsule: { where: { scene: "office", assets: [{ name: "Handout 1", kind: "handout" }] }, present: [{ name: "Steven Knott", role: "landlord" }],
			known: { investigator: { name: "Hayes" } } },
		applyOptions: {
			candidates: [
				{ effect: { kind: "move", to: "morgue" }, description: { kind: "move", to: "morgue", display_name: "Boston Globe offices", unlock_when: held(LEADS, "leads") } },
				{ effect: { kind: "move", to: "house" }, description: { kind: "move", to: "house", display_name: "The Corbitt House", unlock_when: held(KEYS, "keys") } },
				...clues],
			context: {} },
		resolveOptions: { profiles: [{ actor: "Hayes", skill: "Spot Hidden", value: 55, availability: "bound" }],
			decisions: [{ name: "core-check:ordinary-check", family: "core-check", description: "An ordinary check" }] },
	};
}
const built = (reads) => ({ candidates: buildCandidates(reads, INPUT), rows: compileRows(reads) });
/** One row's answer: `[choice, confidence, probabilities?]`. */
const choice = ([value, confidence, probabilities]) => ({ status: "answered", type: "choice", choice: value, confidence, probabilities: probabilities ?? { [value]: confidence } });
/**
 * The compile answered per question: `families` by family (a row id, `none` or `unclear`), `asks` by ask row id (each row's
 * own `[yes|no|unclear, confidence, probabilities?]`; a row not listed answers `no` at 0.9).
 */
function answers(batch, rows, families, asks) {
	const out = {};
	for (const question of batch.questions) {
		if (isAskRow(question)) { out[question.key] = choice(asks[rows.ask[Number(question.key.slice(4)) - 1].id] ?? ["no", 0.9]); continue; }
		const [id, confidence] = families[question.key] ?? ["unclear", 0.9];
		const index = rows[question.key].findIndex((row) => row.id === id);
		out[question.key] = choice([index >= 0 ? `${question.key}_${index + 1}` : id, confidence]);
	}
	return { batchId: batch.id, status: "complete", answers: out, issues: [], coverage: { required: Object.keys(out), answered: Object.keys(out), unknown: [] } };
}
function compileOver(reads, families, asks) {
	const { candidates, rows } = built(reads);
	const view = initialView({ runId: "r", rawInput: INPUT, context, candidates, rows, readFirst: false });
	const request = next(view);
	assert.deepEqual([request.kind, request.purpose], ["decide", "compile"]);
	const batch = compileBatch(view, scope, [], []);
	return { view, rows, candidates, batch, row: settleCompile(view, startStep(view, request), batch, answers(batch, rows, families, asks), 5, 0.6) };
}
/** Turn 1's per-row answers: the morgue at 1.0, investigate at 0.96; the leads and the keys sought, the rest not. */
const T1 = { destination: ["morgue", 1], act: ["investigate", 0.96] };
const T1_ASKS = { "clue:leads": ["yes", 0.91, { yes: 0.91, no: 0.08, unclear: 0.01 }], "clue:keys": ["yes", 0.88, { yes: 0.88, no: 0.1, unclear: 0.02 }] };
/** Run the pending clerk step at the head: `ok`, then the fresh read `after`. Returns the executed candidate. */
function runHead(view, ok, after) {
	const request = next(view);
	assert.deepEqual([request.kind, request.item?.purpose], ["direct", "execute"], "the next step is the clerk's");
	const item = request.item;
	settleExecute(view, startStep(view, request), item, { ok, summary: {} }, after ? { context, candidates: buildCandidates(after, INPUT), rows: compileRows(after) } : undefined, 3);
	return item.candidate;
}

test("§135.30.9 the question: one yes/no question per ask row, in the rows' order, carrying the row's own words", () => {
	const { candidates, rows } = built(office());
	const batch = compileBatch(initialView({ runId: "r", rawInput: INPUT, context, candidates, rows, readFirst: false }), scope, [], []);
	assert.deepEqual(rows.ask.map((row) => row.id), ["clue:commission", "clue:leads", "clue:macario", "clue:keys", "handout:Handout 1"]);
	const asked = batch.questions.filter(isAskRow);
	assert.deepEqual(asked.map((question) => question.key), ["ask_1", "ask_2", "ask_3", "ask_4", "ask_5"], "one question per row, by its alias");
	assert.ok(!batch.questions.some((question) => question.key === "ask"), "no single ask choice");
	for (const [index, question] of asked.entries()) {
		assert.deepEqual(Object.keys(question.criteria), ["yes", "no", "unclear"], `${question.key}: its own closed yes/no`);
		assert.deepEqual(askWords(question), rows.ask[index].describe, `${question.key}: the row's own words`);
	}
	assert.equal(batch.questions.filter((question) => question.key === "destination").length, 1, "the other families stay one choice each");
});

test("§135.30.9 policy: turn 1's accept seeks the leads and the keys -- both filed in row order, the move staged after both", () => {
	const { view, row } = compileOver(office(), T1, T1_ASKS);
	assert.deepEqual(row.detail.ask_cleared, ["clue:leads", "clue:keys"], "the sought rows, in row order");
	assert.deepEqual(row.detail.fired.map((entry) => [entry.predicate, entry.candidate]),
		[["guard_unlock", "apply:clue:leads"], ["ask_clue", "apply:clue:keys"]], "the leads unlock the morgue; the keys are filed on their own row");
	assert.deepEqual(row.detail.selected, ["apply:clue:leads", "apply:clue:keys"]);
	assert.deepEqual(row.detail.unlocked?.map((entry) => [entry.to, entry.after]), [["morgue", "apply:clue:leads"]]);
	for (const key of ["apply:clue:commission", "apply:clue:macario"]) assert.ok(row.detail.fell_through.includes(key), `${key}: not sought, left to the route`);
	assert.deepEqual(row.detail.features.ask.cleared, ["clue:leads", "clue:keys"]);
	assert.deepEqual(Object.values(row.detail.features.ask.answers).map((answer) => [answer.choice, answer.cleared]),
		[["no", true], ["yes", true], ["no", true], ["yes", true], ["no", true]], "each row's own answer");

	// §135.30.9.2: the leads settle the office's guard, so the clues the compile did not select are re-asked (none filed here).
	assert.deepEqual(reaskWith(view, {}).input.clues, ["apply:clue:commission", "apply:clue:macario"], "a selected clue is not re-asked");
	// The batch runs: the leads, then the keys (the move waits for the accept), then the move from the fresh read.
	const leads = runHead(view, true, office({ filed: ["leads"] }));
	assert.equal(leads.key, "apply:clue:leads");
	assert.deepEqual(view.pending.map((item) => item.candidate?.key), ["apply:clue:keys", "apply:move:morgue"], "the keys before the staged move");
	const keys = runHead(view, true, office({ filed: ["leads", "keys"] }));
	assert.equal(keys.key, "apply:clue:keys");
	const move = runHead(view, true, office({ filed: ["leads", "keys"] }));
	assert.equal(move.key, "apply:move:morgue");
	assert.equal(move.basis.compile.unlocked_by, "apply:clue:leads");
	assert.deepEqual(missedUnlocks(view), [], "nothing missed");

	// Line by line: each clue on its own row's record.
	assert.deepEqual(keys.basis.compile.features.ask, "clue:keys");
	assert.deepEqual(keys.basis.compile.read_features, { ask: { row: "clue:keys", confidence: 0.88, cleared: true } });
	assert.deepEqual(leads.basis.compile.read_features.ask, { row: "clue:leads", confidence: 0.91, cleared: true });
	const admitted = (candidate) => compileAdmission({ origin: "policy", basis: candidate.basis, bindings: [{ name: "clue", path: "stated" }] });
	assert.deepEqual([admitted(keys).ok, admitted(keys).predicate, admitted(keys).features], [true, "ask_clue", { ask: { row: "clue:keys", confidence: 0.88 } }]);
	assert.deepEqual([admitted(leads).ok, admitted(leads).predicate, Object.keys(admitted(leads).features).sort()], [true, "guard_unlock", ["ask", "destination"]]);
	// One clue's record never stands for another's: a keys record under the gate refuses the keys alone.
	const tampered = structuredClone(keys.basis);
	tampered.compile.read_features.ask = { ...tampered.compile.read_features.ask, cleared: false };
	assert.deepEqual(compileAdmission({ origin: "policy", basis: tampered, bindings: [{ name: "clue", path: "stated" }] }), { ok: false, reason: "feature_not_cleared:ask" });
	assert.equal(admitted(leads).ok, true);
});

test("§135.30.9 policy: a declaration that seeks one clue files one", () => {
	const { row } = compileOver(office(), { act: ["social", 0.9] }, { "clue:keys": ["yes", 0.9] });
	assert.deepEqual(row.detail.selected, ["apply:clue:keys"]);
	assert.deepEqual(row.detail.ask_cleared, ["clue:keys"]);
	assert.equal(row.detail.unlocked, undefined, "no destination: nothing staged");
	for (const key of ["apply:clue:commission", "apply:clue:leads", "apply:clue:macario"]) assert.ok(row.detail.fell_through.includes(key));
});

test("§135.30.9 policy: within a rank the batch runs in the ask rows' order, whatever order the candidates came in", () => {
	const { candidates, rows } = built(office());
	const view = initialView({ runId: "r", rawInput: INPUT, context, candidates: [...candidates].reverse(), rows, readFirst: false });
	const request = next(view);
	const batch = compileBatch(view, scope, [], []);
	settleCompile(view, startStep(view, request), batch, answers(batch, rows, { act: ["social", 0.9] },
		{ "clue:commission": ["yes", 0.9], "clue:keys": ["yes", 0.9], "clue:macario": ["yes", 0.9] }), 5, 0.6);
	assert.deepEqual(view.pending.map((item) => item.candidate?.key), ["apply:clue:commission", "apply:clue:macario", "apply:clue:keys"]);
});

test("§135.30.9 policy: a row under the gate or unclear is not filed and stays the route's; a cleared no files nothing", () => {
	for (const [label, answer] of [["under the gate", ["yes", 0.5, { yes: 0.5, no: 0.45, unclear: 0.05 }]], ["unclear", ["unclear", 0.95]],
		["a cleared no", ["no", 0.95]], ["unknown", ["unknown", 0.9]]]) {
		const { view, row } = compileOver(office(), T1, { ...T1_ASKS, "clue:keys": answer });
		assert.deepEqual(row.detail.selected, ["apply:clue:leads"], `${label}: the leads only`);
		assert.deepEqual(row.detail.ask_cleared, ["clue:leads"], `${label}: the keys are not sought`);
		assert.ok(row.detail.fell_through.includes("apply:clue:keys") && !row.detail.decided.includes("apply:clue:keys"), `${label}: left to the route, not consumed`);
		assert.ok(view.candidates.some((candidate) => candidate.key === "apply:clue:keys"), `${label}: still offered`);
	}
	// §135.30.9.1: a fan-out row clears on confidence only -- a yes that leads by the margin rule, under the gate, files nothing.
	const margin = compileOver(office(), T1, { ...T1_ASKS, "clue:keys": ["yes", 0.5, { yes: 0.7, no: 0.25, unclear: 0.05 }] });
	assert.deepEqual(margin.row.detail.ask_cleared, ["clue:leads"], "a margin-only yes is not sought");
	assert.ok(margin.row.detail.fell_through.includes("apply:clue:keys"));
	const atGate = compileOver(office(), T1, { ...T1_ASKS, "clue:keys": ["yes", 0.6, { yes: 0.6, no: 0.3, unclear: 0.1 }] });
	assert.deepEqual(atGate.row.detail.ask_cleared, ["clue:leads", "clue:keys"], "a yes at the gate is");
});

test("§135.30.9 policy: a sought clue whose kernel row states a check is not filed -- its attempt is the check", () => {
	const reads = office({ ledger: true });
	const { candidates, rows, row } = compileOver(reads, { act: ["investigate", 0.95] }, { "clue:ledger": ["yes", 0.95] });
	assert.ok(rows.ask.some((entry) => entry.id === "clue:ledger"), "still an ask row: asked and recorded");
	assert.deepEqual(row.detail.ask_cleared, ["clue:ledger"]);
	assert.ok(!row.detail.selected.includes("apply:clue:ledger"), "not filed by the clerk");
	assert.ok(row.detail.fell_through.includes("apply:clue:ledger"));
	assert.deepEqual(row.detail.selected, ["resolve:core-check:ordinary-check"], "the declared search is the check");
	// The same clue with any other delivery is filed.
	const plain = structuredClone(reads);
	plain.applyOptions.candidates.find((entry) => entry.effect.clue === "ledger").description.delivery_kind = "environmental";
	const outcome = interpretCompile({ candidates: buildCandidates(plain, INPUT), rows: compileRows(plain) },
		answers(compileBatch(initialView({ runId: "r", rawInput: INPUT, context, candidates, rows, readFirst: false }), scope, [], []), rows,
			{ act: ["investigate", 0.95] }, { "clue:ledger": ["yes", 0.95] }), 0.6);
	assert.deepEqual(outcome.selected.map((entry) => [entry.predicate, entry.candidate.key]).filter(([, key]) => key.startsWith("apply:clue")), [["ask_clue", "apply:clue:ledger"]]);
});

/** The morgue: Arty's gate (an obligation guarding the 1918 story), an unguarded clue, Arty and Ruth present. */
function morgue() {
	return {
		capsule: { where: { scene: "morgue" }, present: [{ name: "Arty", role: "editor", called: { name: "the editor" } }, { name: "Ruth", role: "clerk", called: { name: "Ruth" } }],
			known: { investigator: { name: "Hayes" } } },
		applyOptions: {
			obligations: [{ handle: "access", name: "Access to the clippings", who: "Arty", state: "open", trigger: { kind: "attempt", guards: { clues: ["story"] } },
				next: { kind: "check", target: "Arty", selection: "approach", approaches: [{ skill: "Persuade" }], difficulty: "regular" } }],
			candidates: [{ effect: { kind: "clue", clue: "story" }, description: { summary: "the 1918 story" }, guarded_by: "access" },
				clueRow("cutoff", "The files stop at 1878.", "npc_dialogue", ["Ask what the Globe's files hold before 1878."])],
			context: { present: ["Arty", "Ruth"] } },
		resolveOptions: { profiles: [{ actor: "Hayes", skill: "Persuade", value: 70, availability: "bound" }],
			decisions: [{ name: "core-check:ordinary-check", family: "core-check", description: "An ordinary check" }] },
	};
}
const CHECK = "resolve:obligation:access", ORDINARY = "resolve:core-check:ordinary-check", NONE_ID = "none";

test("§135.30.9 policy: an obligation is decided by its own row -- another row sought leaves it to the route when its own did not clear", () => {
	const { view, row } = compileOver(morgue(), { addressee: ["Arty", 0.9], act: ["social", 0.9] },
		{ "clue:cutoff": ["yes", 0.9], "obligation:access": ["unclear", 0.9] });
	assert.deepEqual(row.detail.ask_cleared, ["clue:cutoff"]);
	assert.ok(row.detail.selected.includes("apply:clue:cutoff") && !row.detail.selected.includes(CHECK), "the sought clue is filed; the check is not selected");
	assert.ok(row.detail.fell_through.includes(CHECK) && !view.consumed.includes(CHECK), "its own row unclear: not decided, the route's fact question reads it");
	// Its own row's cleared no decides it (the Keeper's for the run), as a cleared answer on it always did.
	const no = compileOver(morgue(), { addressee: ["Arty", 0.9], act: ["social", 0.9] }, { "clue:cutoff": ["yes", 0.9], "obligation:access": ["no", 0.9] });
	assert.ok(no.row.detail.decided.includes(CHECK));
	// Both sought: the check and the clue, each on its own row.
	const both = compileOver(morgue(), { addressee: ["Arty", 0.9], act: ["social", 0.9] }, { "clue:cutoff": ["yes", 0.9], "obligation:access": ["yes", 0.9] });
	assert.deepEqual(both.row.detail.fired.map((entry) => [entry.predicate, entry.candidate]), [["obligation_check", CHECK], ["ask_clue", "apply:clue:cutoff"]]);
	assert.equal(both.view.pending[0].candidate.key, CHECK, "the check before the reveal (precedence)");
});

test("§135.30.9 policy: an obligation row sought keeps the ordinary check off the declaration even when the obligation's check does not fire", () => {
	// The demand sought but aimed at Ruth, not Arty: the obligation's check does not fire (decided); the search is still the
	// obligation's attempt, so the ordinary check is not selected (§135.30.3, condition 3).
	const { row } = compileOver(morgue(), { addressee: ["Ruth", 0.9], act: ["investigate", 0.9] }, { "obligation:access": ["yes", 0.9] });
	assert.ok(row.detail.decided.includes(CHECK), "addressed to someone else: the Keeper's");
	assert.ok(!row.detail.selected.includes(ORDINARY), "no ordinary check for a declaration that seeks the obligation's demand");
	// The same declaration seeking nothing on the obligation's row: the ordinary check is the clerk's.
	const plain = compileOver(morgue(), { addressee: ["Ruth", 0.9], act: ["investigate", 0.9] }, { "obligation:access": ["no", 0.9] });
	assert.ok(plain.row.detail.selected.includes(ORDINARY));
});

test("§135.30.9.1 policy: the morgue's fire-cutoff at gate #6 (yes 0.53 against no 0.29, confidence 0.29) is not filed", () => {
	const { row } = compileOver(morgue(), { addressee: [NONE_ID, 0.9], act: ["investigate", 0.9] },
		{ "obligation:access": ["yes", 0.9], "clue:cutoff": ["yes", 0.29, { yes: 0.53, no: 0.29, unclear: 0.18 }] });
	assert.ok(!row.detail.selected.includes("apply:clue:cutoff"), "margin-only: not filed before Arty has spoken");
	assert.deepEqual(row.detail.ask_cleared, ["obligation:access"]);
});

// ---- §135.30.9.2: the re-ask after a settling step ------------------------------------------------------------------

/** Answer the pending re-ask at the head of `view`: `answers` by clue key (`[yes|no|unclear, confidence]`; else `no` 0.9). */
function reaskWith(view, answers) {
	const request = next(view);
	assert.deepEqual([request.kind, request.purpose], ["decide", "reask"], "the re-ask is next");
	const input = request.item.extra, batch = reaskBatch(view, input, scope, [], []);
	const out = Object.fromEntries(batch.questions.map((question, index) => [question.key, choice(answers[input.clues[index]] ?? ["no", 0.9])]));
	const result = { batchId: batch.id, status: "complete", answers: out, issues: [], coverage: { required: Object.keys(out), answered: Object.keys(out), unknown: [] } };
	return { input, batch, row: settleReask(view, startStep(view, request), input, batch, result, 4, 0.6) };
}
/** Live gate #6's first answers: the keys row `no` at 0.88. */
const T1_LIVE = { "clue:leads": ["yes", 0.61, { yes: 0.74, no: 0.17, unclear: 0.09 }], "clue:keys": ["no", 0.88] };

test("§135.30.9.2 policy: the accept settles the office's exit guard -- the clue rows are re-asked against their cues, and the keys are filed after the leads, before the move", () => {
	const { view, row } = compileOver(office(), T1, T1_LIVE);
	assert.deepEqual(row.detail.selected, ["apply:clue:leads"], "the first question files the leads only, as live");
	assert.deepEqual(row.detail.reask, { settled_by: ["apply:clue:leads"], clues: ["apply:clue:commission", "apply:clue:macario", "apply:clue:keys"] });
	const { input, batch, row: asked } = reaskWith(view, { "apply:clue:keys": ["yes", 0.8] });
	assert.equal(batch.family, REASK_FAMILY);
	assert.deepEqual(batch.questions.map((question) => question.key), ["reask_1", "reask_2", "reask_3"]);
	assert.deepEqual(batch.questions.map((question) => Object.keys(question.criteria)), [["yes", "no", "unclear"], ["yes", "no", "unclear"], ["yes", "no", "unclear"]]);
	assert.deepEqual(askWords(batch.questions[2]), { clue: { clue: "Knott hands over the keys." }, cues: CUES.keys }, "the clue's words and the book's own cues");
	assert.deepEqual(batch.state.settled, [{ settles: { clue: "Knott points them toward the Globe." }, opens: "Boston Globe offices" }], "the settlement as context");
	assert.deepEqual(input.after, "apply:clue:leads");
	assert.deepEqual(asked.detail.filed, ["apply:clue:keys"]);
	assert.equal(asked.jev_calls, 1);
	assert.ok(view.compileSelected.includes("apply:clue:keys"), "a declaration's own step");
	assert.deepEqual(view.pending.map((item) => item.candidate?.key), ["apply:clue:leads"], "staged, not yet run");

	runHead(view, true, office({ filed: ["leads"] }));
	assert.deepEqual(view.pending.map((item) => item.candidate?.key), ["apply:clue:keys", "apply:move:morgue"], "after the leads land: the keys, then the move");
	const keys = runHead(view, true, office({ filed: ["leads", "keys"] }));
	assert.deepEqual(keys.basis.compile, { predicate: "settled_clue", features: { ask: "clue:keys" },
		read_features: { ask: { row: "clue:keys", confidence: 0.8, cleared: true } }, settled_by: ["apply:clue:leads"] });
	const admitted = compileAdmission({ origin: "policy", basis: keys.basis, bindings: [{ name: "clue", path: "stated" }] });
	assert.deepEqual([admitted.ok, admitted.predicate, admitted.features], [true, "settled_clue", { ask: { row: "clue:keys", confidence: 0.8 } }]);
	assert.equal(runHead(view, true, office({ filed: ["leads", "keys"] })).key, "apply:move:morgue");
	// Once per run: a later compile of the run owes no second re-ask.
	assert.equal(view.reasked, true);
});

test("§135.30.9.2 policy: the re-ask asks only the clues it can file -- not one found by a check, not one whose row carries no cue", () => {
	const reads = office({ ledger: true });
	delete reads.applyOptions.candidates.find((entry) => entry.effect.clue === "macario").description.cues;
	const { row } = compileOver(reads, T1, T1_LIVE);
	assert.deepEqual(row.detail.reask?.clues, ["apply:clue:commission", "apply:clue:keys"], "the ledger (skill_check) and the Macario summary (no cue) are not asked");
});

test("§135.30.9.2 policy: a re-ask yes under the gate (the margin rule included) files nothing", () => {
	const { view } = compileOver(office(), T1, T1_LIVE);
	const { row } = reaskWith(view, { "apply:clue:keys": ["yes", 0.55, { yes: 0.8, no: 0.15, unclear: 0.05 }] });
	assert.deepEqual(row.detail.filed, []);
	assert.equal(row.detail.answers.reask_3.cleared, false);
	runHead(view, true, office({ filed: ["leads"] }));
	assert.deepEqual(view.pending.map((item) => item.candidate?.key), ["apply:move:morgue"], "only the move follows the leads");
});

test("§135.30.9.2 policy: a declaration that settles nothing gets no re-ask -- a plain move, a clue ask_clue files, a seek with no settling step", () => {
	for (const [label, reads, families, asks] of [
		["a move whose guard is already met", office({ filed: ["leads"] }), T1, {}],
		["a sought clue with no destination", office(), { act: ["social", 0.9] }, { "clue:keys": ["yes", 0.9] }],
		["nothing selected", office(), { act: ["social", 0.9] }, {}]]) {
		const { view, row } = compileOver(reads, families, asks);
		assert.equal(row.detail.reask, undefined, `${label}: no re-ask`);
		assert.ok(!view.pending.some((item) => item.purpose === "reask"), `${label}: nothing pending`);
	}
});

test("§135.30.9.2 policy: a settling step that is refused, or an obligation check that fails, takes its staged clue with it", () => {
	const refused = compileOver(office(), T1, T1_LIVE).view;
	reaskWith(refused, { "apply:clue:keys": ["yes", 0.9] });
	runHead(refused, false, office());
	assert.ok(!refused.pending.some((item) => item.candidate?.key === "apply:clue:keys"), "the leads were refused: the keys are not filed");
	// At the morgue: the obligation's check settles; the cutoff the re-ask files waits for it.
	for (const [check, filed] of [["failed", false], ["passed", true]]) {
		const { view, row } = compileOver(morgue(), { addressee: ["Arty", 0.9], act: ["social", 0.9] }, { "obligation:access": ["yes", 0.9] });
		assert.deepEqual(row.detail.reask?.settled_by, [CHECK]);
		reaskWith(view, { "apply:clue:cutoff": ["yes", 0.9] });
		const candidate = view.candidates.find((value) => value.key === CHECK);
		settleExecute(view, 9, { kind: "direct", purpose: "execute", candidate }, { ok: true, summary: { check } },
			{ context, candidates: buildCandidates(morgue(), INPUT), rows: compileRows(morgue()) }, 3);
		assert.equal(view.pending.some((item) => item.candidate?.key === "apply:clue:cutoff"), filed, `check ${check}`);
	}
});

// ---------------------------------------------------------------------------------------------------
// On the emitted kernel over the haunting.
// ---------------------------------------------------------------------------------------------------

function kernelSteps(workspace, requests) {
	const input = requests.map((request, index) => JSON.stringify({ id: String(index), method: request[0], params: { campaign: "test-camp", ...request[1] } })).join("\n");
	const run = spawnSync(process.execPath, [join(REPO, "build/kernel/rpc.mjs"), "--workspace", workspace, "--content", join(REPO, "content")],
		{ cwd: REPO, input: `${input}\n`, encoding: "utf8" });
	const frames = run.stdout.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line)).filter((frame) => !frame.progress);
	for (const frame of frames) if (!frame.ok) throw new Error(`kernel step ${frame.id} failed: ${JSON.stringify(frame.error)}`);
	return frames.map((frame) => frame.result);
}
const aliasWhere = (question, match) => Object.entries(question?.criteria ?? {}).find(([, value]) => match(value))?.[0];
const complete = (out) => ({ batchId: "b", status: "complete", answers: out, issues: [], coverage: { required: Object.keys(out), answered: Object.keys(out), unknown: [] } });

test("§135.30.9 on the emitted kernel: turn 1's sentence at the office -- the clerk files the leads, the keys, then moves to the morgue; each admitted by the compile", async (t) => {
	const graph = JSON.parse(readFileSync(join(REPO, "content/starters/the-haunting/module-graph.json"), "utf8"));
	const summary = (id) => graph.nodes.find((node) => node.node_id === id).summary;
	const sought = new Set([summary("clue-knott-research-leads"), summary("clue-knott-keys")]);
	const rows = [];
	// Turn 1's per-row answers: the morgue at 1.0, investigate at 0.96, the leads and the keys yes, every other row no; every
	// route question: finish.
	const decide = async (batch) => {
		if (batch.family === COMPILE_FAMILY) return complete(Object.fromEntries(batch.questions.map((question) => {
			if (isAskRow(question)) return [question.key, choice([sought.has(askWords(question)?.clue) ? "yes" : "no", 0.9])];
			const pick = question.key === "destination" ? [aliasWhere(question, (value) => value?.handle === "newspaper-morgue"), 1]
				: question.key === "act" ? [aliasWhere(question, (value) => typeof value === "string" && value.startsWith("investigate")), 0.96] : [];
			return [question.key, choice([pick[0] ?? "unclear", pick[0] ? pick[1] : 0.9])];
		})));
		return complete(Object.fromEntries(batch.questions.map((question) => [question.key,
			choice([question.key === "exit" ? "finish" : Object.keys(question.criteria)[0] === "now" ? "later" : question.criteria.seeks ? "not" : "unknown", 0.9])])));
	};
	let workspace;
	const engine = createHybridEngine({ env: process.env, record: (row) => rows.push(row), decision: { decide } });
	const table = await openTable({ realKernel: true, prepareWorkspace: (at) => { workspace = at; kernelSteps(at, [
		["table.open", {}], ["table.player_input", { text: "我听他说完。" }], ["table.narrate", { call_id: "t1-c1", text: "诺特把委托说了一遍。" }]]); },
		env: { PI_COC_LOOP_ENGINE: "hybrid-v1" }, runDriver: engine.runDriver, extraExtensions: [{ name: "coc-hybrid-engine", factory: engine.extension }],
		responses: [fauxAssistantMessage([fauxToolCall("narrate", { text: "你接下委托，收好钥匙，去了报馆。" })], { stopReason: "toolUse" })] });
	t.after(() => table.dispose());
	await table.session.prompt(INPUT);

	const compiled = rows.find((row) => row.lane === "route" && row.purpose === "compile");
	assert.deepEqual(compiled.ask_cleared, ["clue:knott-research-leads", "clue:knott-keys"], "the compile row records the sought rows");
	assert.deepEqual(compiled.selected, ["apply:clue:knott-research-leads", "apply:clue:knott-keys"]);
	assert.deepEqual(compiled.unlocked?.map((entry) => [entry.to, entry.after]), [["newspaper-morgue", "apply:clue:knott-research-leads"]]);
	const binds = rows.filter((row) => row.lane === "run" && row.event === "bind" && row.clerk);
	assert.deepEqual(binds.slice(0, 3).map((row) => [row.candidate, row.status]),
		[["apply:clue:knott-research-leads", "succeeded"], ["apply:clue:knott-keys", "succeeded"], ["apply:move:newspaper-morgue", "succeeded"]],
		"the leads, the keys, then the move, all by the clerk");
	const admissions = table.telemetry("test-camp").filter((row) => row.lane === "admission" && row.origin === "policy" && row.verb === "apply");
	assert.deepEqual(admissions.slice(0, 3).map((row) => [row.path, row.predicate]), [["compile", "guard_unlock"], ["compile", "ask_clue"], ["compile", "move"]]);
	assert.equal(table.lanes.admission.requests().length, 0, "no lane review for any line");
	const record = JSON.parse(readFileSync(join(workspace, ".coc/campaigns/test-camp/turns/0002.json"), "utf8"));
	const receipts = record.receipts.map((receipt) => [receipt.kind, receipt.clue ?? receipt.to ?? null]);
	for (const expected of [["clue", "knott-research-leads"], ["clue", "knott-keys"], ["move", "newspaper-morgue"]])
		assert.ok(receipts.some(([kind, name]) => kind === expected[0] && name === expected[1]), `${expected.join(" ")} has a receipt`);
	const keys = record.receipts.find((receipt) => receipt.kind === "clue" && receipt.clue === "knott-keys");
	assert.deepEqual([keys.scene, keys.left_this_turn], ["commission-briefing", undefined], "filed at the office, before the move");
});

test("§135.30.9.2 on the emitted kernel: turn 1's sentence with the keys row answered no -- the re-ask files the keys against their cue, after the leads and before the move", async (t) => {
	const graph = JSON.parse(readFileSync(join(REPO, "content/starters/the-haunting/module-graph.json"), "utf8"));
	const summary = (id) => graph.nodes.find((node) => node.node_id === id).summary;
	const leads = summary("clue-knott-research-leads"), keysWords = summary("clue-knott-keys");
	const rows = [], reasks = [];
	// Live gate #6's first answers (the leads yes, the keys and the rest no); the re-ask: the keys yes, the rest no; routes finish.
	const decide = async (batch) => {
		if (batch.family === COMPILE_FAMILY) return complete(Object.fromEntries(batch.questions.map((question) => {
			if (isAskRow(question)) return [question.key, choice(askWords(question)?.clue === leads ? ["yes", 0.61] : ["no", 0.88])];
			const pick = question.key === "destination" ? [aliasWhere(question, (value) => value?.handle === "newspaper-morgue"), 1]
				: question.key === "act" ? [aliasWhere(question, (value) => typeof value === "string" && value.startsWith("investigate")), 0.96] : [];
			return [question.key, choice([pick[0] ?? "unclear", pick[0] ? pick[1] : 0.9])];
		})));
		if (batch.family === REASK_FAMILY) {
			reasks.push(batch);
			return complete(Object.fromEntries(batch.questions.map((question) => [question.key, choice(askWords(question)?.clue?.clue === keysWords ? ["yes", 0.85] : ["no", 0.9])])));
		}
		return complete(Object.fromEntries(batch.questions.map((question) => [question.key,
			choice([question.key === "exit" ? "finish" : Object.keys(question.criteria)[0] === "now" ? "later" : question.criteria.seeks ? "not" : "unknown", 0.9])])));
	};
	let workspace;
	const engine = createHybridEngine({ env: process.env, record: (row) => rows.push(row), decision: { decide } });
	const table = await openTable({ realKernel: true, prepareWorkspace: (at) => { workspace = at; kernelSteps(at, [
		["table.open", {}], ["table.player_input", { text: "我听他说完。" }], ["table.narrate", { call_id: "t1-c1", text: "诺特把委托说了一遍。" }]]); },
		env: { PI_COC_LOOP_ENGINE: "hybrid-v1" }, runDriver: engine.runDriver, extraExtensions: [{ name: "coc-hybrid-engine", factory: engine.extension }],
		responses: [fauxAssistantMessage([fauxToolCall("narrate", { text: "你接下委托，收好钥匙，去了报馆。" })], { stopReason: "toolUse" })] });
	t.after(() => table.dispose());
	await table.session.prompt(INPUT);

	assert.equal(reasks.length, 1, "one re-ask");
	assert.ok(reasks[0].questions.some((question) => askWords(question)?.cues?.includes("Accept the commission explicitly and take the key, address, and cash advance.")),
		"the keys are asked against the book's own cue, from the kernel's row");
	const reask = rows.find((row) => row.lane === "route" && row.purpose === "reask");
	assert.deepEqual([reask.settled_by, reask.filed], [["apply:clue:knott-research-leads"], ["apply:clue:knott-keys"]]);
	const binds = rows.filter((row) => row.lane === "run" && row.event === "bind" && row.clerk);
	assert.deepEqual(binds.slice(0, 3).map((row) => [row.candidate, row.status]),
		[["apply:clue:knott-research-leads", "succeeded"], ["apply:clue:knott-keys", "succeeded"], ["apply:move:newspaper-morgue", "succeeded"]]);
	const admissions = table.telemetry("test-camp").filter((row) => row.lane === "admission" && row.origin === "policy" && row.verb === "apply");
	assert.deepEqual(admissions.slice(0, 3).map((row) => [row.path, row.predicate]), [["compile", "guard_unlock"], ["compile", "settled_clue"], ["compile", "move"]]);
	const record = JSON.parse(readFileSync(join(workspace, ".coc/campaigns/test-camp/turns/0002.json"), "utf8"));
	const keys = record.receipts.find((receipt) => receipt.kind === "clue" && receipt.clue === "knott-keys");
	assert.deepEqual([keys?.scene, keys?.left_this_turn], ["commission-briefing", undefined], "filed at the office, before the move");
});
