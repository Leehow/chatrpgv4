/**
 * SL-43 (owner ruling 2026-09-24, "A declaration's act is settled once"; contract §135.30.8).
 *
 * Long gate #4 turn 2, "我说明来意，请他帮忙调出科比特宅这些年的旧剪报。": the first compile read the gatekeeper's demand, Arty and
 * `social`, and the clerk rolled the obligation's check (Persuade 8). Its fresh read issued the archivist, a new reachable
 * candidate, so a second compile read the same sentence: `social` and Arty again, the settled demand no longer a row, and
 * `ordinary_check` fired -- the clerk rolled Persuade a second time (100). The obligation step now consumes the act it
 * settles, and the ordinary check is bound only for an act no obligation step covered.
 *
 * - At the policy seam (pure, the kernel's row shapes): an obligation check fired on `social` decides the ordinary check in
 *   the same compile; with the act unclear at the first compile, the executed check's intent settles it (taken or refused),
 *   so a later compile reading `social` decides the check while one reading `investigate` still selects it; the ordinary
 *   binder's check on a settled act executes nothing (`ordinary_act_settled`), on another act it executes.
 * - On the emitted kernel over the haunting through the hybrid engine (a stub Jev with gate #4's turn-2 answers for both
 *   compiles, the faux Keeper): one clerk roll, the obligation's.
 *
 * Assertions are on rows, selections and receipts, never on prose.
 */
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { openTable } from "./harness.mjs";
import { askWords, fanAsk, isAskRow } from "./compile-ask.mjs";
import { buildCandidates } from "../../runtime/jev/candidates.ts";
import { compileRows } from "../../runtime/jev/compile-rows.ts";
import { COMPILE_FAMILY, NONE, UNCLEAR, compileBatch } from "../../runtime/jev/route-compile.ts";
import { createHybridEngine } from "../../runtime/jev/hybrid-engine.ts";
import { BIND_FAMILY, ORDINARY_CHECK_KEY, bindBatch, initialView, next, settleBind, settleCompile, settleExecute, settleOrdinaryBind, startStep } from "../../runtime/jev/step-policy.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const INPUT = "我说明来意，请他帮忙调出科比特宅这些年的旧剪报。";
const scope = { owner: "campaign:test", campaign: "test", worldline: "main", loop: 0, audience: "keeper" };
const context = { scene: "morgue", clock: null, present: [], receipts: [] };
const ORDINARY = ORDINARY_CHECK_KEY;
const CHECK = "resolve:obligation:access";

// ---------------------------------------------------------------------------------------------------
// At the policy seam: the morgue with Arty met, in the kernel's own row shapes.
// ---------------------------------------------------------------------------------------------------

/**
 * The morgue: the gatekeeper's check (two approaches), the unguarded cutoff clue, the ordinary check. `settled`: the
 * gate's check passed (the obligation issues nothing); `stacks`: the fresh read then issues a new exit, which owes a compile.
 */
function morgue({ settled = false, stacks = false } = {}) {
	const approaches = ["Persuade", "Intimidate"];
	return {
		capsule: { where: { scene: "morgue" }, present: [{ name: "Arty", role: "gatekeeper", called: { name: "the editor" } }], known: { investigator: { name: "Hayes" } } },
		applyOptions: {
			obligations: [{ handle: "access", name: "Access to the clippings", who: "Arty", state: settled ? "settled" : "open", trigger: { kind: "attempt", guards: { clues: ["story"] } },
				next: { kind: "check", target: "Arty", selection: "approach", approaches: approaches.map((skill) => ({ skill })), difficulty: "regular" } }],
			candidates: [{ effect: { kind: "clue", clue: "story" }, description: { summary: "the 1918 story" }, guarded_by: "access" },
				{ effect: { kind: "clue", clue: "cutoff" }, description: { summary: "The files stop at 1878." } },
				...(stacks ? [{ effect: { kind: "move", to: "stacks" }, description: { display_name: "The back stacks" } }] : [])],
			context: { present: ["Arty"] } },
		resolveOptions: { profiles: approaches.map((skill) => ({ actor: "Hayes", skill, value: skill === "Persuade" ? 70 : 15, availability: "bound" })),
			decisions: [{ name: "core-check:ordinary-check", family: "core-check", description: "One ordinary skill check." }] },
	};
}
const fresh = (reads) => ({ context, candidates: buildCandidates(reads, INPUT), rows: compileRows(reads) });
const answer = (choices) => ({ batchId: "b", status: "complete", issues: [], coverage: { required: [], answered: [], unknown: [] },
	answers: fanAsk(Object.fromEntries(Object.entries(choices).map(([key, [choice, confidence, probabilities]]) => [key,
		{ status: "answered", type: "choice", choice, confidence, probabilities: probabilities ?? { [choice]: confidence } }]))) });
const alias = (rows, family, id) => id === NONE || id === UNCLEAR ? id : `${family}_${rows[family].findIndex((row) => row.id === id) + 1}`;
function viewAt(reads = morgue()) {
	const { candidates, rows } = fresh(reads);
	return initialView({ runId: "r", rawInput: INPUT, context, candidates, rows, readFirst: false });
}
/** The compile owed on `view`, answered with rows by id (`{ask: [id, confidence], ...}`), folded in. */
function compileWith(view, choices) {
	const request = next(view);
	assert.deepEqual([request.kind, request.purpose], ["decide", "compile"], "a compile is owed");
	const batch = compileBatch(view, scope, [], []);
	const result = answer(Object.fromEntries(Object.entries(choices).map(([family, [id, confidence, probabilities]]) => [family, [alias(view.rows, family, id), confidence, probabilities]])));
	return settleCompile(view, startStep(view, request), batch, result, 5, 0.6);
}
/** Gate #4 turn 2's first compile: the demand 0.87, Arty 0.53 (0.65 against unclear 0.33), social 0.96, no destination. */
const FIRST = { ask: ["obligation:access", 0.87], addressee: ["Arty", 0.53, { Arty: 0.65, unclear: 0.33 }], act: ["social", 0.96] };
/** Its second: social 0.99, Arty 0.79, the ask under the gate. */
const SECOND = { act: ["social", 0.99], addressee: ["Arty", 0.79], ask: [NONE, 0.28, { none: 0.28, unclear: 0.26 }] };
/** Bind the obligation check at the head (`intent` as given) and execute it; the fresh read is `after`. */
function rollTheCheck(view, intent, { ok = true, after = morgue({ settled: true, stacks: true }) } = {}) {
	const bind = next(view);
	assert.deepEqual([bind.kind, bind.purpose, bind.item?.candidate?.key], ["decide", "bind", CHECK], "the check's approach is bound next");
	const batch = bindBatch(view, bind.item.candidate, scope, []);
	settleBind(view, startStep(view, bind), bind.item.candidate, batch, answer({ skill: ["Persuade", 0.9], bonus: ["none", 0.9], penalty: ["none", 0.9], intent: [intent, 0.9] }), 5, 0.6);
	const run = next(view);
	assert.deepEqual([run.kind, run.item?.purpose, run.item?.candidate?.key], ["direct", "execute", CHECK], "then the clerk rolls it");
	settleExecute(view, startStep(view, run), run.item, { ok, summary: {} }, fresh(after), 3);
}

test("§135.30.8 policy: an obligation check fired on the act decides the ordinary check in the same compile -- one declaration, one check", () => {
	const view = viewAt();
	assert.ok(view.candidates.some((candidate) => candidate.key === ORDINARY), "the builder offers the ordinary check");
	const row = compileWith(view, FIRST);
	assert.deepEqual(row.detail.selected, [CHECK], "the obligation's check, alone");
	assert.ok(row.detail.decided.includes(ORDINARY), "the ordinary check is decided: the act is the obligation's");
	assert.ok(!row.detail.fell_through.includes(ORDINARY), "not left to the route's need question");
	assert.ok(view.consumed.includes(ORDINARY) && !view.candidates.some((candidate) => candidate.key === ORDINARY), "consumed for the run");
	assert.deepEqual(view.actsSettled, ["social"]);
	assert.deepEqual(row.detail.acts_settled, ["social"], "the compile row names the settled act");
	// Control: the same act with no obligation step fired selects the ordinary check, as §135.30.3 says.
	const alone = viewAt();
	const control = compileWith(alone, { act: ["social", 0.96], addressee: ["Arty", 0.9], ask: [NONE, 0.9] });
	assert.deepEqual(control.detail.selected, [ORDINARY]);
	assert.equal(alone.actsSettled, undefined, "nothing settled without an obligation step");
});

test("§135.30.8 policy: gate #4 turn 2 across two compiles -- the executed check's intent settles the act; a later compile reading it decides the ordinary check, another act selects it", () => {
	// The first compile's act under the gate: the obligation's check fires on the ask, and no act is settled yet.
	const view = viewAt();
	const first = compileWith(view, { ...FIRST, act: [UNCLEAR, 0.9] });
	assert.deepEqual(first.detail.selected, [CHECK]);
	assert.ok(first.detail.fell_through.includes(ORDINARY), "the ordinary check is left to later reads");
	assert.equal(view.actsSettled, undefined);
	rollTheCheck(view, "social");
	assert.deepEqual(view.actsSettled, ["social"], "the intent the clerk rolled the check with is settled");
	const before = structuredClone(view);

	// Gate #4's second compile: social again, and the ask no longer on a row.
	const second = compileWith(view, SECOND);
	assert.deepEqual(second.detail.selected, [], "no second roll for the same act");
	assert.ok(second.detail.decided.includes(ORDINARY), "decided: consumed, the Keeper's for the run");
	assert.ok(view.consumed.includes(ORDINARY));

	// Speak, then search: a later compile that reads another act still selects the ordinary check, with that act.
	const searched = compileWith(before, { act: ["investigate", 0.9], ask: [NONE, 0.9] });
	assert.deepEqual(searched.detail.selected, [ORDINARY], "an act the obligation step did not cover is still rolled");
	const head = next(before);
	assert.equal(head.item?.candidate?.bound.intent, "investigate");
});

test("§135.30.8 policy: a refused obligation check still settles its act -- the clerk does not route around its own refusal", () => {
	const view = viewAt();
	compileWith(view, { ...FIRST, act: [UNCLEAR, 0.9] });
	rollTheCheck(view, "social", { ok: false });
	assert.deepEqual(view.actsSettled, ["social"]);
});

test("§135.30.8 policy: the ordinary binder runs on the remainder -- its check on a settled act executes nothing, on another act it executes", () => {
	const check = viewAt().candidates.find((candidate) => candidate.key === ORDINARY);
	const bound = (intent) => ({ disposition: "ordinary", action: { decision: "core-check:ordinary-check", intent, skill: "Persuade", goal: INPUT, method: INPUT },
		unresolved: [], calls: 2, ms: 5 });
	const settled = viewAt();
	settled.actsSettled = ["social"];
	const row = settleOrdinaryBind(settled, 1, check, bound("social"), 5);
	assert.equal(row.reason, "ordinary_act_settled");
	assert.deepEqual(settled.pending, [], "nothing executed");
	assert.ok(settled.consumed.includes(ORDINARY), "the check is consumed for the run");
	assert.deepEqual(settled.observations.at(-1).summary.act, "social");
	const other = viewAt();
	other.actsSettled = ["social"];
	settleOrdinaryBind(other, 1, check, bound("investigate"), 5);
	assert.deepEqual(other.pending.map((item) => [item.kind, item.purpose, item.candidate?.key]), [["direct", "execute", ORDINARY]], "another act is rolled");
});

// ---------------------------------------------------------------------------------------------------
// On the emitted kernel over the haunting, through the hybrid engine.
// ---------------------------------------------------------------------------------------------------

const MORGUE = "newspaper-morgue";
/** The kernel's seed under which the first roll of the process, a regular Persuade, passes (as in scene-obligation-candidates). */
const PASS = "4";
function kernelSteps(workspace, requests) {
	const input = requests.map((request, index) => JSON.stringify({ id: String(index), method: request[0], params: { campaign: "test-camp", ...request[1] } })).join("\n");
	const run = spawnSync(process.execPath, [join(REPO, "build/kernel/rpc.mjs"), "--workspace", workspace, "--content", join(REPO, "content")], { cwd: REPO, input: `${input}\n`, encoding: "utf8" });
	const frames = run.stdout.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line)).filter((frame) => !frame.progress);
	for (const frame of frames) if (!frame.ok) throw new Error(`fixture step ${frame.id} failed: ${JSON.stringify(frame.error)}`);
}
/** Turn 1 walked into the morgue and met Arty (the city editor), and closed; the player now asks him for the clippings. */
const metArty = (workspace) => kernelSteps(workspace, [
	["table.open", {}], ["table.player_input", { text: "我去《环球报》报馆" }],
	["table.apply", { call_id: "t1-c1", effects: [{ kind: "move", to: MORGUE }] }],
	["table.apply", { call_id: "t1-c2", effects: [{ kind: "person", who: "Arty Wilmot", name: "城市版编辑" }] }],
	["table.narrate", { call_id: "t1-c3", text: "城市版编辑挡在剪报室门口。" }],
]);
const aliasWhere = (question, match) => Object.entries(question?.criteria ?? {}).find(([, value]) => match(value))?.[0];
const choice = ([value, confidence, probabilities]) => ({ status: "answered", type: "choice", choice: value, confidence, probabilities: probabilities ?? { [value]: confidence } });
const complete = (answers) => ({ batchId: "b", status: "complete", answers, issues: [], coverage: { required: Object.keys(answers), answered: Object.keys(answers), unknown: [] } });
const arty = (question) => aliasWhere(question, (value) => JSON.stringify(value).includes("城市版编辑") || JSON.stringify(value).includes("Arty"));
const social = (question) => aliasWhere(question, (value) => typeof value === "string" && value.startsWith("social"));
/**
 * Gate #4 turn 2's answers. The first compile: the demand 0.87, Arty 0.53 (0.65 against unclear 0.33), social 0.96, no
 * destination 0.79. The second (after the check passed and the archivist was issued): social 0.99, Arty 0.79, the ask under
 * the gate. The check's bind: Persuade, no dice, social. The ordinary binder, if asked: an ordinary Persuade. Every route: finish.
 */
function gate4Jev({ firstAct = 0.96 } = {}) {
	let compiles = 0;
	return { decide: async (batch) => {
		if (batch.family === COMPILE_FAMILY) {
			const n = ++compiles;
			return complete(Object.fromEntries(batch.questions.map((question) => [question.key, choice(
				isAskRow(question) ? (n === 1 ? [askWords(question)?.demand ? "yes" : "no", 0.87] : ["no", 0.28, { no: 0.28, unclear: 0.26 }])
					: question.key === "addressee" ? (n === 1 ? [arty(question), 0.53, { [arty(question)]: 0.65, unclear: 0.33 }] : [arty(question), 0.79])
						: question.key === "act" ? (n === 1 && firstAct === null ? [UNCLEAR, 0.9] : [social(question), n === 1 ? firstAct : 0.99])
							: question.key === "destination" ? [NONE, 0.79] : [UNCLEAR, 0.9])])));
		}
		if (batch.family === BIND_FAMILY)
			return complete(Object.fromEntries(batch.questions.map((question) => [question.key,
				choice([({ skill: "Persuade", bonus: "none", penalty: "none", intent: "social" })[question.key] ?? "unknown", 0.9])])));
		if (batch.family === "ordinary-resolve")
			return complete(Object.fromEntries(batch.questions.map((question) => [question.key, choice(question.key === "profile"
				? [aliasWhere(question, (value) => value?.skill === "Persuade"), 0.99]
				: [({ route: "ordinary", consent: "authorized", actor: "actor_0", intent: "social", difficulty: "regular", bonus: "none", penalty: "none" })[question.key] ?? "unknown", 0.9])])));
		return complete(Object.fromEntries(batch.questions.map((question) => [question.key,
			choice([question.key === "exit" ? "finish" : Object.keys(question.criteria)[0] === "now" ? "later" : question.criteria.seeks ? "not" : "unknown", 0.9])])));
	} };
}

async function turnTwo(t, jev) {
	const engine = createHybridEngine({ env: process.env, decision: jev });
	const table = await openTable({
		realKernel: true, prepareWorkspace: metArty, env: { PI_COC_LOOP_ENGINE: "hybrid-v1", COC_KERNEL_SEED: PASS },
		runDriver: engine.runDriver, extraExtensions: [{ name: "coc-hybrid-engine", factory: engine.extension }],
		responses: [fauxAssistantMessage([fauxToolCall("narrate", { text: "编辑松了口，把你领下楼。" })], { stopReason: "toolUse" })],
	});
	t.after(() => table.dispose());
	await table.session.prompt(INPUT);
	const telemetry = table.telemetry("test-camp");
	const compiles = telemetry.filter((row) => row.lane === "route" && row.purpose === "compile");
	assert.equal(compiles.length, 2, "the check's pass issued the archivist, which owed a second compile, as at gate #4");
	return { telemetry, compiles };
}
const oneRoll = (telemetry) => {
	const rolls = telemetry.filter((row) => row.tool === "resolve" && row.origin === "policy");
	assert.deepEqual(rolls.map((row) => [row.ok, row.basis?.obligation ?? null]), [[true, "globe-clippings-access"]], "one clerk roll, the obligation's");
	assert.equal(telemetry.filter((row) => row.lane === "route" && row.purpose === "bind-ordinary").length, 0, "the ordinary binder is never asked");
};

test("§135.30.8 on the emitted kernel: gate #4 turn 2's sentence and answers roll one check -- the obligation's", async (t) => {
	const { telemetry, compiles } = await turnTwo(t, gate4Jev());
	assert.deepEqual(compiles[0].selected, ["resolve:obligation:globe-clippings-access"]);
	assert.ok(compiles[0].decided.includes(ORDINARY), "the first compile decides the ordinary check: the act is the obligation's");
	assert.deepEqual(compiles[0].acts_settled, ["social"]);
	assert.ok(!compiles.some((row) => row.selected.includes(ORDINARY)), "no compile selects the ordinary check");
	oneRoll(telemetry);
});

test("§135.30.8 on the emitted kernel: with the first compile's act unclear, the rolled check's intent settles it and the second compile's row decides the ordinary check", async (t) => {
	const { telemetry, compiles } = await turnTwo(t, gate4Jev({ firstAct: null }));
	assert.deepEqual(compiles[0].selected, ["resolve:obligation:globe-clippings-access"]);
	assert.ok(compiles[0].fell_through.includes(ORDINARY), "no act read at the first compile: nothing settled there");
	assert.equal(compiles[0].acts_settled, undefined);
	assert.deepEqual(compiles[1].selected, [], "the second compile reads social again and rolls nothing");
	assert.ok(compiles[1].decided.includes(ORDINARY), "its row says what the policy did: the check decided");
	assert.deepEqual(compiles[1].acts_settled, ["social"], "the act the clerk rolled the check with (its bind's intent)");
	oneRoll(telemetry);
});
