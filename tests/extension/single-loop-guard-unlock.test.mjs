/**
 * SL-38 (spec pi-native-single-loop, Ruling "A guard is evaluated after the effects the same declaration files";
 * contract §135.30.5).
 *
 * Long gate #3 turn 1, "我接。先去《环球报》剪报室…": `destination` cleared on the morgue at 1.0 and `ask` on the research-leads
 * clue at 0.90, but every research exit was held by that same clue, so the compile reported the morgue `guarded` and the
 * Keeper did the accept, the clue and the move itself in four model steps. The compile now evaluates the move's guard after
 * the batch's own effect: the clue the declaration files is selected (`guard_unlock`), the move is staged after it, and the
 * fresh read after the clue -- the kernel's own evaluation of the guard -- issues the move, which the clerk runs next with
 * the compile's record. Each is admitted on its own compile evidence.
 *
 * - At the policy seam (pure): the gate #3 answers select the clue and stage the move; the move runs from the fresh read,
 *   carrying `basis.compile` (`move`, `unlocked_by`); both writes are admitted by `compileAdmission`; a guard the batch does
 *   not unlock (no cleared ask on its clue, or a guard naming another clue) still falls through with `guarded`; a fresh read
 *   that does not issue the move, or a refused clue, reports it `guarded`; an obligation guard is staged after its check.
 * - On the emitted kernel over the haunting (the vendored driver, a stub Jev with the gate #3 answers, the faux Keeper):
 *   turn 1 at the office files the research leads and then moves to the morgue, both by the clerk, both admitted
 *   `path: "compile"`, no lane request; the compile row reports `unlocked`, not `guarded`.
 *
 * Assertions are on rows, selections and receipts, never on prose.
 */
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { openTable } from "./harness.mjs";
import { compileAdmission } from "../../extensions/kernel/admission.ts";
import { buildCandidates } from "../../runtime/jev/candidates.ts";
import { compileRows } from "../../runtime/jev/compile-rows.ts";
import { COMPILE_FAMILY, NONE, compileBatch, interpretCompile, predicateOf } from "../../runtime/jev/route-compile.ts";
import { createHybridEngine } from "../../runtime/jev/hybrid-engine.ts";
import { BIND_FAMILY, initialView, missedUnlocks, next, settleCompile, settleExecute, startStep } from "../../runtime/jev/step-policy.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const INPUT = "我接。先去《环球报》剪报室，翻科比特宅这些年的旧报道。";
const scope = { owner: "campaign:test", campaign: "test", worldline: "main", loop: 0, audience: "keeper" };
const context = { scene: "office", clock: null, present: [], receipts: [] };

// ---------------------------------------------------------------------------------------------------
// At the policy seam: the office of gate #3 turn 1, in the kernel's own row shapes.
// ---------------------------------------------------------------------------------------------------

const exists = { place: true, entrance: true, from: "office", from_place: "Knott's Office" };
const LEADS = { condition: "clue_discovered: leads", clue: { clue: "leads", says: "Knott points them toward the Globe.",
	found_at: [{ scene: "office", display_name: "Knott's Office", cues: ["Ask which public records might reveal the house's history."] }] }, exists };
const KEYS = { condition: "clue_discovered: keys", clue: { clue: "keys", says: "Knott hands over the keys.", found_at: [{ scene: "office", display_name: "Knott's Office" }] }, exists };
/**
 * Knott's office. `leads`: whether the research leads were filed (the morgue's and the library's unlock met). `gate`: the
 * archive is held behind an open obligation (the `guarded_by` shape) instead of a clue.
 */
function office({ leads = false, gate = false } = {}) {
	const held = (guard) => leads ? { condition: guard.condition, met: true } : { ...guard, met: false };
	return {
		capsule: { where: { scene: "office" }, present: [{ name: "Steven Knott", role: "landlord" }], known: { investigator: { name: "Hayes" } } },
		applyOptions: {
			...(gate ? { obligations: [{ handle: "archive-gate", name: "Leave to enter the archive", state: "open" }] } : {}),
			candidates: [
				{ effect: { kind: "move", to: "morgue" }, description: { kind: "move", to: "morgue", display_name: "Boston Globe offices", unlock_when: held(LEADS) } },
				{ effect: { kind: "move", to: "library" }, description: { kind: "move", to: "library", display_name: "Central Library", unlock_when: held(LEADS) } },
				{ effect: { kind: "move", to: "house" }, description: { kind: "move", to: "house", display_name: "The Corbitt House", unlock_when: { ...KEYS, met: false } } },
				...(gate ? [{ effect: { kind: "move", to: "archive" }, description: { kind: "move", to: "archive", display_name: "The archive" }, guarded_by: "archive-gate" }] : []),
				...(leads ? [] : [{ effect: { kind: "clue", clue: "leads" }, description: { summary: "Knott points them toward the Globe." } }]),
				{ effect: { kind: "clue", clue: "keys" }, description: { summary: "Knott hands over the keys." } }],
			context: {} },
		resolveOptions: { profiles: [{ actor: "Hayes", skill: "Spot Hidden", value: 55, availability: "bound" }],
			decisions: [{ name: "core-check:ordinary-check", family: "core-check", description: "An ordinary check" }] },
	};
}
const built = (reads) => ({ candidates: buildCandidates(reads, INPUT), rows: compileRows(reads) });
const answer = (choices) => ({ batchId: "b", status: "complete", issues: [], coverage: { required: [], answered: [], unknown: [] },
	answers: Object.fromEntries(Object.entries(choices).map(([key, [choice, confidence, probabilities]]) => [key,
		{ status: "answered", type: "choice", choice, confidence, probabilities: probabilities ?? { [choice]: confidence } }])) });
const alias = (rows, family, id) => id === NONE || id === "unclear" ? id : `${family}_${rows[family].findIndex((row) => row.id === id) + 1}`;
/** The compile over `reads`, answered with rows by id: `{destination: [id, confidence], ask: [...], act: [...]}`. */
function compileOver(reads, choices) {
	const { candidates, rows } = built(reads);
	const view = initialView({ runId: "r", rawInput: INPUT, context, candidates, rows, readFirst: false });
	const request = next(view);
	assert.deepEqual([request.kind, request.purpose], ["decide", "compile"]);
	const batch = compileBatch(view, scope, [], []);
	const result = answer(Object.fromEntries(Object.entries(choices).map(([family, [id, confidence]]) => [family, [alias(rows, family, id), confidence]])));
	return { view, rows, candidates, row: settleCompile(view, startStep(view, request), batch, result, 5, 0.6) };
}
/** Gate #3 turn 1: the morgue at 1.0, the leads clue at 0.90, investigate at 0.95. */
const GATE3 = { destination: ["morgue", 1], ask: ["clue:leads", 0.9], act: ["investigate", 0.95] };
/** Run the pending clerk step at the head, as the engine would: `ok`, then the fresh read `after`. */
function runHead(view, ok, after) {
	const request = next(view);
	assert.deepEqual([request.kind, request.item?.purpose], ["direct", "execute"], "the next step is the clerk's");
	const item = request.item;
	settleExecute(view, startStep(view, request), item, { ok, summary: {} }, after ? { context, candidates: buildCandidates(after, INPUT), rows: compileRows(after) } : undefined, 3);
	return item.candidate;
}

test("§135.30.5 policy: the clue the declaration files unlocks the destination it cleared -- the clue is selected, the move staged after it", () => {
	const { view, row } = compileOver(office(), GATE3);
	assert.deepEqual(row.detail.selected, ["apply:clue:leads"], "the batch's own effect is selected");
	assert.deepEqual(row.detail.fired.map((entry) => [entry.predicate, entry.candidate]), [["guard_unlock", "apply:clue:leads"]]);
	assert.deepEqual(row.detail.unlocked, [{ to: "morgue", place: "Boston Globe offices", guard: LEADS, after: "apply:clue:leads" }]);
	assert.equal(row.detail.guarded, undefined, "an unlocked destination is not reported as held");
	assert.ok(!row.detail.fell_through.includes("apply:clue:leads"));
	assert.ok(row.detail.fell_through.includes("apply:clue:keys"), "a clue that opens nothing the declaration goes to still falls through");
	assert.deepEqual(view.unlocks.map((entry) => [entry.after, entry.to]), [["apply:clue:leads", "morgue"]]);
	assert.ok(view.compileSelected.includes("apply:move:morgue"), "the staged move is the declaration's own step");
	assert.equal(view.pending[0].candidate.key, "apply:clue:leads");
});

test("§135.30.5 policy: after the clue lands, the fresh read's move runs next with the compile's record; both are admitted on their own evidence", () => {
	const { view } = compileOver(office(), GATE3);
	const clue = runHead(view, true, office({ leads: true }));
	const move = view.pending[0]?.candidate;
	assert.equal(move?.key, "apply:move:morgue", "the move the fresh read issued is next");
	assert.deepEqual(move.basis.compile, { predicate: "move", features: { destination: "morgue", ask: "clue:leads", act: "investigate" },
		read_features: { destination: { row: "morgue", confidence: 1, cleared: true } }, unlocked_by: "apply:clue:leads" });
	assert.equal(move.basis.row.description.unlock_when.met, true, "the move carries the fresh read's kernel row, whose guard is now met");
	assert.deepEqual(view.unlocks, [], "the staged move is spent");
	// Line by line (§32.12 / §32.12.3): each clerk write carries its own compile evidence.
	const clueAdmission = compileAdmission({ origin: "policy", basis: clue.basis, bindings: [{ name: "clue", path: "stated" }] });
	assert.deepEqual([clueAdmission.ok, clueAdmission.predicate, Object.keys(clueAdmission.features).sort()], [true, "guard_unlock", ["ask", "destination"]]);
	const moveAdmission = compileAdmission({ origin: "policy", basis: move.basis, bindings: [{ name: "to", path: "stated" }] });
	assert.deepEqual([moveAdmission.ok, moveAdmission.predicate, Object.keys(moveAdmission.features)], [true, "move", ["destination"]]);
	runHead(view, true, office({ leads: true }));
	assert.deepEqual(missedUnlocks(view), [], "nothing missed");
});

test("§135.30.5 policy: a guard the batch does not unlock still falls through and is reported with its guard", () => {
	// The declaration goes to the morgue but files nothing (the ask did not clear on the leads).
	for (const ask of [[NONE, 0.9], ["unclear", 0.9]]) {
		const { view, row } = compileOver(office(), { ...GATE3, ask });
		assert.deepEqual(row.detail.selected, [], `ask ${ask}: nothing selected`);
		assert.ok(row.detail.fell_through.includes("apply:clue:leads"), "the clue falls through to the route, as before");
		assert.deepEqual(row.detail.guarded, [{ to: "morgue", place: "Boston Globe offices", guard: LEADS }]);
		assert.equal(row.detail.unlocked, undefined);
		assert.equal(view.unlocks, undefined);
	}
	// The declaration files the leads but goes to the house, whose guard names the keys: the leads open nothing it goes to.
	const house = compileOver(office(), { ...GATE3, destination: ["house", 0.95] });
	assert.deepEqual(house.row.detail.selected, [], "the leads clue is not selected for a destination it does not open");
	assert.deepEqual(house.row.detail.guarded, [{ to: "house", place: "The Corbitt House", guard: KEYS }]);
	// The predicate reaches a clue only when a destination row is guarded by it and its ask row exists.
	const { candidates, rows } = built(office());
	assert.equal(predicateOf(candidates.find((candidate) => candidate.key === "apply:clue:leads"), rows)?.name, "guard_unlock");
	const opened = built(office({ leads: true }));
	assert.equal(predicateOf(opened.candidates.find((candidate) => candidate.key === "apply:clue:keys"), { ...opened.rows,
		destination: opened.rows.destination.filter((entry) => entry.id !== "house") }), undefined, "no destination held by it: not reachable");
	// Never decided: a compile where it does not fire leaves it to the route.
	assert.ok(interpretCompile({ candidates, rows }, answer({ destination: [NONE, 0.9], ask: [alias(rows, "ask", "clue:leads"), 0.9] }), 0.6).fellThrough.includes("apply:clue:leads"));
});

test("§135.30.5 policy: a staged move the fresh read does not issue, or whose clue was refused, is reported as held", () => {
	const missed = compileOver(office(), GATE3).view;
	runHead(missed, true, office());
	assert.notEqual(missed.pending[0]?.candidate?.key, "apply:move:morgue", "the kernel did not issue the move: it does not run");
	assert.deepEqual(missedUnlocks(missed), [{ to: "morgue", place: "Boston Globe offices", guard: LEADS }]);
	const refused = compileOver(office(), GATE3).view;
	runHead(refused, false, office());
	assert.deepEqual(missedUnlocks(refused), [{ to: "morgue", place: "Boston Globe offices", guard: LEADS }]);
	assert.deepEqual([refused.pending[0]?.kind, refused.pending[0]?.reason], ["infer", "clerk_refused"], "a refused clerk step is the Keeper's, as before");
	// A step that never ran as the clerk's (its key consumed when the Keeper was handed it) takes its staged move with it.
	const owned = compileOver(office(), GATE3).view;
	assert.deepEqual(missedUnlocks(owned), [], "staged, not yet missed");
	owned.consumed.push("apply:clue:leads");
	assert.deepEqual(missedUnlocks(owned), [{ to: "morgue", place: "Boston Globe offices", guard: LEADS }]);
});

test("§135.30.5 policy: a destination held behind an open obligation is staged after the obligation check the compile selects", () => {
	const reads = office({ gate: true });
	reads.capsule.present.push({ name: "Archivist", role: "archivist", called: { name: "the archivist" } });
	reads.applyOptions.obligations[0] = { handle: "archive-gate", name: "Leave to enter the archive", state: "open", who: "Archivist",
		next: { kind: "check", target: "Archivist", difficulty: "regular", selection: "approach", approaches: [{ skill: "Persuade" }] } };
	reads.applyOptions.context = { present: ["Archivist"] };
	const { candidates, rows } = built(reads);
	const check = candidates.find((candidate) => candidate.key === "resolve:obligation:archive-gate");
	assert.ok(check, "the obligation's check is offered");
	const result = answer({ destination: [alias(rows, "destination", "archive"), 0.9], ask: [alias(rows, "ask", "obligation:archive-gate"), 0.9] });
	const outcome = interpretCompile({ candidates, rows }, result, 0.6);
	assert.deepEqual(outcome.selected.map((entry) => entry.predicate), ["obligation_check"]);
	assert.deepEqual(outcome.unlocked?.map((entry) => [entry.to, entry.after]), [["archive", "resolve:obligation:archive-gate"]]);
	assert.equal(outcome.guarded, undefined);
	// Without the check selected (the ask elsewhere), the obligation guard is reported as §135.30.4 says.
	assert.deepEqual(interpretCompile({ candidates, rows }, answer({ destination: [alias(rows, "destination", "archive"), 0.9], ask: [NONE, 0.9] }), 0.6).guarded,
		[{ to: "archive", place: "The archive", guard: { obligation: "archive-gate", demand: "Leave to enter the archive" } }]);
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
const complete = (answers) => ({ batchId: "b", status: "complete", answers, issues: [], coverage: { required: Object.keys(answers), answered: Object.keys(answers), unknown: [] } });
const choice = (value, confidence) => ({ status: "answered", type: "choice", choice: value, confidence, probabilities: { [value]: confidence } });

test("§135.30.5 on the emitted kernel: gate #3 turn 1's sentence at the office -- the clerk files the research leads, then moves to the morgue; both admitted by the compile", async (t) => {
	const graph = JSON.parse(readFileSync(join(REPO, "content/starters/the-haunting/module-graph.json"), "utf8"));
	const leads = graph.nodes.find((node) => node.node_id === "clue-knott-research-leads").summary;
	const rows = [];
	// The gate #3 answers where their rows are offered (the morgue at 1.0, the leads at 0.90, investigate at 0.95), unclear
	// elsewhere; every route question: finish.
	const decide = async (batch) => {
		if (batch.family === COMPILE_FAMILY) return complete(Object.fromEntries(batch.questions.map((question) => {
			const pick = question.key === "destination" ? [aliasWhere(question, (value) => value?.handle === "newspaper-morgue"), 1]
				: question.key === "ask" ? [aliasWhere(question, (value) => value?.clue === leads), 0.9]
					: question.key === "act" ? [aliasWhere(question, (value) => typeof value === "string" && value.startsWith("investigate")), 0.95] : [];
			return [question.key, choice(pick[0] ?? "unclear", pick[0] ? pick[1] : 0.9)];
		})));
		if (batch.family === BIND_FAMILY) return complete(Object.fromEntries(batch.questions.map((question) => [question.key, choice("unknown", 0.9)])));
		return complete(Object.fromEntries(batch.questions.map((question) => [question.key,
			choice(question.key === "exit" ? "finish" : Object.keys(question.criteria)[0] === "now" ? "later" : question.criteria.seeks ? "not" : "unknown", 0.9)])));
	};
	const engine = createHybridEngine({ env: process.env, record: (row) => rows.push(row), decision: { decide } });
	const table = await openTable({ realKernel: true, prepareWorkspace: (workspace) => kernelSteps(workspace, [
		["table.open", {}], ["table.player_input", { text: "我听他说完。" }], ["table.narrate", { call_id: "t1-c1", text: "诺特把委托说了一遍。" }]]),
		env: { PI_COC_LOOP_ENGINE: "hybrid-v1" }, runDriver: engine.runDriver, extraExtensions: [{ name: "coc-hybrid-engine", factory: engine.extension }],
		responses: [fauxAssistantMessage([fauxToolCall("narrate", { text: "你接下委托，去了报馆。" })], { stopReason: "toolUse" })] });
	t.after(() => table.dispose());
	await table.session.prompt(INPUT);

	const compiled = rows.find((row) => row.lane === "route" && row.purpose === "compile");
	assert.deepEqual(compiled.selected, ["apply:clue:knott-research-leads"], "the compile selects the clue the declaration files");
	assert.deepEqual(compiled.unlocked?.map((entry) => [entry.to, entry.after]), [["newspaper-morgue", "apply:clue:knott-research-leads"]]);
	assert.ok(!(compiled.guarded ?? []).some((entry) => entry.to === "newspaper-morgue"), "the morgue is not reported held");
	const binds = rows.filter((row) => row.lane === "run" && row.event === "bind" && row.clerk);
	assert.deepEqual(binds.slice(0, 2).map((row) => [row.candidate, row.status]),
		[["apply:clue:knott-research-leads", "succeeded"], ["apply:move:newspaper-morgue", "succeeded"]], "the clue, then the move, both by the clerk");
	const admissions = table.telemetry("test-camp").filter((row) => row.lane === "admission" && row.origin === "policy" && row.verb === "apply");
	assert.deepEqual(admissions.slice(0, 2).map((row) => [row.path, row.predicate]), [["compile", "guard_unlock"], ["compile", "move"]]);
	assert.equal(admissions[1].basis?.compile?.unlocked_by, "apply:clue:knott-research-leads");
	assert.equal(table.lanes.admission.requests().length, 0, "no lane review for either line");
	const tools = table.telemetry("test-camp").filter((row) => row.tool === "apply" && row.origin === "policy");
	assert.deepEqual(tools.slice(0, 2).map((row) => row.ok), [true, true], "the kernel took both");
});

// ---------------------------------------------------------------------------------------------------
// SL-42 (§135.30.7): the Keeper's bookkeeping of the scene the clerk's move left is accepted at that scene.
// ---------------------------------------------------------------------------------------------------

test("§135.30.7 on the emitted kernel: after the clerk's clue and move, the Keeper's accept -- Knott, the keys, the cash, the key, the handout -- lands with receipts", async (t) => {
	const graph = JSON.parse(readFileSync(join(REPO, "content/starters/the-haunting/module-graph.json"), "utf8"));
	const leads = graph.nodes.find((node) => node.node_id === "clue-knott-research-leads").summary;
	const decide = async (batch) => {
		if (batch.family === COMPILE_FAMILY) return complete(Object.fromEntries(batch.questions.map((question) => {
			const pick = question.key === "destination" ? [aliasWhere(question, (value) => value?.handle === "newspaper-morgue"), 1]
				: question.key === "ask" ? [aliasWhere(question, (value) => value?.clue === leads), 0.9]
					: question.key === "act" ? [aliasWhere(question, (value) => typeof value === "string" && value.startsWith("investigate")), 0.95] : [];
			return [question.key, choice(pick[0] ?? "unclear", pick[0] ? pick[1] : 0.9)];
		})));
		return complete(Object.fromEntries(batch.questions.map((question) => [question.key,
			choice(question.key === "exit" ? "finish" : Object.keys(question.criteria)[0] === "now" ? "later" : question.criteria.seeks ? "not" : "unknown", 0.9)])));
	};
	// The recorded Keeper's first batch at gate #3 turn 1, less what the clerk already did (the leads clue and the move).
	const accept = [{ kind: "person", who: "Steven Knott", name: "史蒂文·诺特", why: "上一回他已自报姓名。" },
		{ kind: "clue", clue: "knott-keys", how: "你接下委托，诺特把钥匙、地址和预付的二十美元交给你。", from: "Steven Knott", label: "科比特宅的钥匙与预付" },
		{ kind: "cash", delta: 20, source: "quote", with: "Steven Knott", why: "诺特按事先说好的条件，预付一天的二十美元。" },
		{ kind: "item", name: "Corbitt House key", from: "Steven Knott", label: "科比特宅钥匙", why: "诺特把压在账簿下的黄铜钥匙推过来。" },
		{ kind: "handout", name: "Handout 1: Mr. Knott's Commission", label: "诺特先生的委托" }];
	let workspace;
	const engine = createHybridEngine({ env: process.env, decision: { decide } });
	const table = await openTable({ realKernel: true, prepareWorkspace: (at) => { workspace = at; kernelSteps(at, [
		["table.open", {}], ["table.player_input", { text: "我听他说完。" }], ["table.narrate", { call_id: "t1-c1", text: "诺特把委托说了一遍。" }]]); },
		env: { PI_COC_LOOP_ENGINE: "hybrid-v1" }, runDriver: engine.runDriver, extraExtensions: [{ name: "coc-hybrid-engine", factory: engine.extension }],
		responses: [fauxAssistantMessage([fauxToolCall("apply", { effects: accept })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "你收下钥匙和预付，出门去了报馆。" })], { stopReason: "toolUse" })] });
	t.after(() => table.dispose());
	await table.session.prompt(INPUT);

	const tools = table.telemetry("test-camp").filter((row) => row.tool === "apply");
	assert.deepEqual(tools.map((row) => [row.origin ?? "model", row.ok]), [["policy", true], ["policy", true], ["model", true]],
		"the clerk's clue and move, then the Keeper's accept, all taken");
	const record = JSON.parse(readFileSync(join(workspace, ".coc/campaigns/test-camp/turns/0002.json"), "utf8"));
	const kinds = record.receipts.map((receipt) => [receipt.kind, receipt.clue ?? receipt.to ?? receipt.who ?? receipt.name ?? receipt.resource ?? null]);
	for (const expected of [["clue", "knott-research-leads"], ["move", "newspaper-morgue"], ["person", "steven-knott"], ["clue", "knott-keys"], ["cash", "cash"], ["handout", "Handout 1: Mr. Knott's Commission"]])
		assert.ok(kinds.some(([kind, name]) => kind === expected[0] && String(name).toLowerCase().replace(/\s+/g, "-") === String(expected[1]).toLowerCase().replace(/\s+/g, "-")), `${expected.join(" ")} has a receipt`);
	assert.ok(record.receipts.some((receipt) => receipt.kind === "item"), "the key item has a receipt");
	const keys = record.receipts.find((receipt) => receipt.kind === "clue" && receipt.clue === "knott-keys");
	assert.deepEqual([keys.scene, keys.left_this_turn], ["commission-briefing", true], "recorded at the office the clerk's move left");
	assert.equal(record.receipts.find((receipt) => receipt.kind === "clue" && receipt.clue === "knott-research-leads").left_this_turn, undefined);
});
