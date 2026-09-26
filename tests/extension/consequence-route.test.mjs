/**
 * SL-76 (contract §135.32, §135.3.1; design D1-D4): the shadow route's pure functions -- the batch (one Noul per
 * candidate, one `exists` Noul per family), the row gate (`noulClears`, the same shape as §135.30.9.1's
 * `ROW_MIN`/`ROW_RATIO`), and folding a Jev answer (or its absence) into per-candidate rows. No Jev, no kernel: a
 * hand-built `DecisionResult` stands in for the DecisionPort, exactly as `single-loop-compile.test.mjs` and
 * `loop.test.mjs`'s pure sections stub the policy seam.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { consequenceBatch, interpretConsequenceResult, noulClears } from "../../runtime/jev/consequence-route.ts";
import { NPC_REACTION_DECISION } from "../../runtime/jev/consequence-candidates.ts";

const SCOPE = { owner: "campaign:camp", campaign: "camp", worldline: "main", loop: 0, audience: "keeper" };
const READ_SET = [{ kind: "world", resource: "camp", revision: "1" }];
const CONTEXT = { scene: "morgue", clock: null, present: ["Steven Knott"], receipts: [] };
const GATES = { rowMin: 0.5, rowRatio: 2 };

const npcCandidate = (key = "consequence:npc_reaction:steven-knott:thomas-hayes") => ({
	key, verb: "resolve", family: "npc_reaction", label: "Steven Knott engages Thomas Hayes",
	source: "capsule.mods.pending_contacts", bound: { decision: NPC_REACTION_DECISION, actor: "steven-knott", target: "thomas-hayes" },
	unbound: [], clerk: "consequence_bookkeeping", consequenceClass: "npc_reaction",
	basis: { read: "table.capsule", path: "mods.pending_contacts[0]", authority: "available_route_not_player_choice" },
	noul: { instructions: "does the investigator engage them now", criteria: { true: "yes", false: "no" } },
});
const clueCandidate = (key = "consequence:clue_follow_up:x") => ({
	key, verb: "apply", family: "clue_follow_up", label: "Clue x", source: "table.apply.options",
	bound: { kind: "clue", clue: "x" }, unbound: [], clerk: "consequence_bookkeeping", consequenceClass: "clue_follow_up",
	basis: { read: "table.apply.options" },
	noul: { instructions: "does the settled action reach clue x", criteria: { true: "yes", false: "no" } },
});
const directTimeCandidate = () => ({
	key: "consequence:time_cost:canvass", verb: "apply", family: "time_cost", label: "Advance the clock",
	source: "capsule.where.rules", bound: { kind: "time", stated: "canvass" }, unbound: [],
	clerk: "consequence_bookkeeping", consequenceClass: "time_cost", basis: {},
});

function nouls(batch, answers) {
	const out = {};
	for (const question of batch.questions) out[question.key] = { status: "answered", type: "noul", noul: answers[question.key] ?? 0.5 };
	return { batchId: batch.id, status: "complete", answers: out, coverage: { required: Object.keys(out), answered: Object.keys(out), unknown: [] }, issues: [] };
}

test("noulClears: the same row gate as §135.30.9.1, applied to a Noul's own probability and its complement", () => {
	assert.equal(noulClears(0.9, GATES), "true");
	assert.equal(noulClears(0.1, GATES), "false");
	assert.equal(noulClears(0.6, GATES), undefined, "0.6 clears the min but not 2x its complement (0.4): unresolved");
	assert.equal(noulClears(0.5, GATES), undefined, "exactly at the ratio boundary with itself never clears either side");
	assert.equal(noulClears(undefined, GATES), undefined);
});

test("noulClears: mutating the thresholds changes what clears -- proving the value is read, not a literal", () => {
	assert.equal(noulClears(0.72, { rowMin: 0.5, rowRatio: 2 }), "true", "0.72 >= 0.5 and 0.72 >= 2*0.28");
	assert.equal(noulClears(0.72, { rowMin: 0.8, rowRatio: 2 }), undefined, "raising row_min alone un-clears the same answer");
	assert.equal(noulClears(0.72, { rowMin: 0.5, rowRatio: 3 }), undefined, "raising row_ratio alone un-clears the same answer (0.72 < 3*0.28)");
});

test("consequenceBatch: one Noul per candidate that carries one, an `exists` Noul per class, and none for a direct candidate", () => {
	const { batch, asked } = consequenceBatch(
		{ runId: "r1", rawInput: "I ask around", context: CONTEXT, observations: [], candidates: [npcCandidate(), directTimeCandidate()],
			settled: [], present: [{ label: "Steven Knott", met: true }] },
		SCOPE, READ_SET,
	);
	assert.equal(asked.length, 1, "the direct time_cost candidate is not asked at all");
	const keys = batch.questions.map((question) => question.key);
	assert.deepEqual(keys.sort(), ["c_1", "exists_npc_reaction", "exists_time_cost"].sort(),
		"a class with only a direct candidate still gets its own `exists` Noul (D2.2: a family may be empty, but it is still asked)");
	for (const question of batch.questions) assert.equal(question.type, "noul");
});

test("consequenceBatch: no candidates and no classes offered builds no batch at all", () => {
	const built = consequenceBatch({ runId: "r1", rawInput: "", context: CONTEXT, observations: [], candidates: [], settled: [], present: [] }, SCOPE, READ_SET);
	assert.equal(built, undefined);
});

test("consequenceBatch: the state sent to Jev carries no kernel-internal tag (D2.3: no `authority`/`basis`/`clerk`)", () => {
	const { batch } = consequenceBatch(
		{ runId: "r1", rawInput: "I ask around", context: CONTEXT, observations: [], candidates: [npcCandidate()], settled: ["clue x found"],
			present: [{ label: "Steven Knott", met: true }] },
		SCOPE, READ_SET,
	);
	const text = JSON.stringify(batch.state);
	assert.ok(!text.includes("available_route_not_player_choice"), "the kernel's own authority tag never reaches the batch");
	assert.ok(!text.includes('"basis"') && !text.includes('"clerk"'), "basis/clerk stay off the wire entirely");
});

test("interpretConsequenceResult: a cleared `true` Noul clears the candidate; a cleared `false` and an unresolved one do not", () => {
	const candidates = [npcCandidate("k1"), clueCandidate("k2"), npcCandidate("k3")];
	const { batch, asked } = consequenceBatch({ runId: "r1", rawInput: "", context: CONTEXT, observations: [], candidates, settled: [], present: [] }, SCOPE, READ_SET);
	assert.equal(asked.length, 3);
	const result = nouls(batch, { c_1: 0.95, c_2: 0.05, c_3: 0.6, exists_npc_reaction: 0.9, exists_clue_follow_up: 0.05 });
	const outcome = interpretConsequenceResult(candidates, result, GATES);
	const byKey = Object.fromEntries(outcome.rows.map((row) => [row.key, row]));
	assert.equal(byKey.k1.cleared, true);
	assert.equal(byKey.k2.cleared, false, "a confidently-no Noul never clears true");
	assert.equal(byKey.k3.cleared, false, "0.6 is below the ratio gate: unresolved, not cleared");
	assert.equal(byKey.k1.confidence, 0.95);
	assert.equal(byKey.k1.distribution.true, 0.95);
	assert.ok(Math.abs(byKey.k1.distribution.false - 0.05) < 1e-9);
	const existsByClass = Object.fromEntries(outcome.exists.map((row) => [row.class, row]));
	assert.equal(existsByClass.npc_reaction.cleared, true);
	assert.equal(existsByClass.clue_follow_up.cleared, false);
});

test("interpretConsequenceResult: a direct candidate (no Noul) is always reported cleared, without ever being asked", () => {
	const candidates = [directTimeCandidate()];
	const outcome = interpretConsequenceResult(candidates, undefined, GATES);
	assert.equal(outcome.rows.length, 1);
	assert.equal(outcome.rows[0].cleared, true);
	assert.equal(outcome.rows[0].direct, true);
	assert.equal(outcome.rows[0].confidence, null, "never asked, so it carries no Jev confidence");
});

test("interpretConsequenceResult: an outage or an incomplete batch degrades to no D1 rows cleared, with a reason -- never a guess", () => {
	const candidates = [npcCandidate("k1"), clueCandidate("k2")];
	for (const result of [undefined, { batchId: "x", status: "unavailable", answers: {}, coverage: { required: [], answered: [], unknown: [] }, issues: [],
		failure: { code: "timeout", retryable: true } }]) {
		const outcome = interpretConsequenceResult(candidates, result, GATES);
		assert.ok(outcome.rows.every((row) => row.cleared === false), "every asked candidate comes back uncleared, never guessed cleared");
		assert.ok(outcome.reason.startsWith("jev_"), "a reason is always recorded (D2.7)");
	}
});
