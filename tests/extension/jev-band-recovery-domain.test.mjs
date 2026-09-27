/**
 * Contract §138.6 (BR-02): the band questions as pure decisions over a stub port -- the tier question's exits, the
 * weapon question's two levels (family beam, weakest-judgment confidence, `none` at either level), and the batch
 * shapes Jev is sent (the kernel's rows as criteria, an exit on every question, the person or the thing as state).
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { TaskLease } from "../../runtime/jev/task-context.ts";
import { ARCHETYPE_DESCRIPTIONS, WEAPON_FAMILY_BEAM, bindingsFor, runArchetypeBand, runWeaponBand } from "../../runtime/jev/band-recovery-domain.ts";

const TIERS = ["ordinary_adult", "capable_adult", "dangerous_actor"];
const PROFILES = [
	{ id: "knife_medium", name: "Knife, Medium", skill: "Fighting (Brawl)", damage: "1D4+2" },
	{ id: "club_large", name: "Club, Large", skill: "Fighting (Brawl)", damage: "1D8" },
	{ id: "revolver_38", name: ".38 Revolver", skill: "Firearms (Handgun)", damage: "1D10", range: 15 },
	{ id: "shotgun_12", name: "Shotgun, 12-gauge", skill: "Firearms (Rifle/Shotgun)", damage: "4D6", range: 50 },
	{ id: "hatchet_thrown", name: "Hatchet (thrown)", skill: "Throw", damage: "1D6+1" },
];

function distribution(keys, chosen, confidence) {
	const rest = keys.length > 1 ? (1 - confidence) / (keys.length - 1) : 0;
	return Object.fromEntries(keys.map((key) => [key, key === chosen ? confidence : rest]));
}
/** A stub port: `answer(key, question, batch)` → {choice, confidence}; every batch is recorded. */
function port(answer) {
	const batches = [];
	return { batches, decide: async (batch) => {
		batches.push(batch);
		const answers = Object.fromEntries(batch.questions.map((question) => {
			const keys = Object.keys(question.criteria), { choice, confidence } = answer(question.key, question, batch);
			return [question.key, { status: "answered", type: "choice", choice, confidence, probabilities: distribution(keys, choice, confidence) }];
		}));
		return { batchId: batch.id, status: "complete", answers, coverage: { required: [], answered: [], unknown: [] }, issues: [], usage: { inputTokens: 100, outputTokens: 5 } };
	} };
}
function lease(field, input) {
	const bindings = bindingsFor(field, input);
	return new TaskLease({ owner: "band-recovery", goal: "test", scope: bindings.scope, capabilities: ["decision"], readSet: bindings.readSet,
		signal: new AbortController().signal, budget: { deadlineAt: Date.now() + 10_000, remainingInputTokens: 100_000, remainingOutputTokens: 10_000, remainingCostUsd: 1, remainingActions: 5 } });
}
const person = { name: "Steven Knott", dossier: { role: "landlord", wants: "the house let", summary: "never raised a hand" } };
const ARCHETYPE_INPUT = { campaign: "c1", turn: 3, declaration: "I punch Knott", person, options: TIERS };
const archetype = (answer, minConfidence = 0.5) => runArchetypeBand(ARCHETYPE_INPUT, port(answer), lease("archetype", ARCHETYPE_INPUT), { minConfidence });
const thing = { name: "a brass-knuckled knife", why: "from the cellar" };
const WEAPON_INPUT = { campaign: "c1", turn: 3, declaration: "I pocket the knife", thing, options: PROFILES.map((p) => p.id), close: ["knife_medium"], profiles: PROFILES };
const weapon = (answer, minConfidence = 0.5) => runWeaponBand(WEAPON_INPUT, port(answer), lease("weapon", WEAPON_INPUT), { minConfidence });

test("the tier question offers the kernel's rows with their descriptors and an unknown exit, over the person", async () => {
	const stub = port(() => ({ choice: "capable_adult", confidence: 0.8 }));
	const result = await runArchetypeBand(ARCHETYPE_INPUT, stub, lease("archetype", ARCHETYPE_INPUT), { minConfidence: 0.5 });
	assert.equal(result.status, "decided");
	assert.equal(result.band, "capable_adult");
	assert.equal(result.confidence, 0.8);
	assert.equal(result.calls, 1);
	const [batch] = stub.batches;
	assert.equal(batch.family, "band-recovery");
	assert.deepEqual(batch.questions.map((q) => q.key), ["tier"]);
	assert.deepEqual(Object.keys(batch.questions[0].criteria), [...TIERS, "unknown"]);
	for (const tier of TIERS) assert.equal(batch.questions[0].criteria[tier], ARCHETYPE_DESCRIPTIONS[tier]);
	assert.equal(batch.state.person.role, "landlord");
	assert.equal(batch.state.declaration, "I punch Knott");
});

test("the tier question's exits: unknown, low confidence, a row the kernel did not offer, no options", async () => {
	assert.deepEqual((await archetype(() => ({ choice: "unknown", confidence: 0.9 }))).reason, "unknown");
	const low = await archetype(() => ({ choice: "dangerous_actor", confidence: 0.4 }));
	assert.equal(low.status, "fallback");
	assert.equal(low.reason, "low_confidence");
	assert.equal(low.band, "dangerous_actor");
	assert.equal(low.confidence, 0.4);
	assert.equal((await archetype(() => ({ choice: "mythos_horror", confidence: 0.9 }))).reason, "unknown");
	assert.equal((await archetype(() => ({ choice: "capable_adult", confidence: 0.5 }))).status, "decided", "the gate is inclusive");
	const empty = { ...ARCHETYPE_INPUT, options: [] };
	const none = await runArchetypeBand(empty, port(() => ({ choice: "x", confidence: 1 })), lease("archetype", empty), { minConfidence: 0.5 });
	assert.equal(none.reason, "no_options");
	assert.equal(none.calls, 0);
});

test("the weapon question asks the family first, then the profiles of the families kept, and takes the weakest confidence", async () => {
	const stub = port((key, question) => {
		if (key === "family") return { choice: "Fighting (Brawl)", confidence: 0.9 };
		const keys = Object.keys(question.criteria);
		if (keys.includes("knife_medium")) return { choice: "knife_medium", confidence: 0.7 };
		return { choice: "none", confidence: 0.6 };
	});
	const result = await runWeaponBand(WEAPON_INPUT, stub, lease("weapon", WEAPON_INPUT), { minConfidence: 0.5 });
	assert.equal(result.status, "decided");
	assert.equal(result.band, "knife_medium");
	assert.equal(result.confidence, 0.7, "min(0.9, 0.7), not their product");
	assert.equal(result.family.choice, "Fighting (Brawl)");
	assert.equal(result.calls, 2);
	const [first, second] = stub.batches;
	assert.deepEqual(first.questions.map((q) => q.key), ["family"]);
	assert.deepEqual(Object.keys(first.questions[0].criteria), ["Fighting (Brawl)", "Firearms (Handgun)", "Firearms (Rifle/Shotgun)", "Throw", "none"]);
	assert.equal(first.state.thing.why, "from the cellar");
	assert.deepEqual(first.state.closest_by_name, ["knife_medium"]);
	assert.equal(second.questions.length, WEAPON_FAMILY_BEAM, "three families kept");
	assert.deepEqual(Object.keys(second.questions[0].criteria), ["knife_medium", "club_large", "none"]);
	assert.match(second.questions[0].criteria.knife_medium, /damage 1D4\+2/);
	assert.match(second.questions.find((q) => q.criteria.revolver_38).criteria.revolver_38, /range 15 yards/);
});

test("the weapon question's exits: none at the first level, none at every second level, a low profile confidence, only unoffered profiles", async () => {
	assert.equal((await weapon(() => ({ choice: "none", confidence: 0.95 }))).reason, "none");
	const allNone = await weapon((key) => key === "family" ? { choice: "Throw", confidence: 0.6 } : { choice: "none", confidence: 0.9 });
	assert.equal(allNone.reason, "none");
	assert.equal(allNone.calls, 2);
	const low = await weapon((key, question) => key === "family" ? { choice: "Fighting (Brawl)", confidence: 0.9 } : { choice: Object.keys(question.criteria)[0], confidence: 0.3 });
	assert.equal(low.reason, "low_confidence");
	assert.equal(low.band, "knife_medium");
	const off = { ...WEAPON_INPUT, options: ["nothing_here"] };
	const unoffered = await runWeaponBand(off, port(() => ({ choice: "x", confidence: 1 })), lease("weapon", off), { minConfidence: 0.5 });
	assert.equal(unoffered.reason, "no_profiles");
	assert.equal(unoffered.calls, 0);
});

test("a second-level answer the kernel did not offer, or for a family not kept, is skipped rather than pinned", async () => {
	// The Brawl family wins the first level but its profile answer names a Throw weapon: not offered under Brawl, so the
	// Handgun family's own answer (kept by the beam) is the best remaining.
	const result = await weapon((key, question) => {
		if (key === "family") return { choice: "Fighting (Brawl)", confidence: 0.8 };
		const keys = Object.keys(question.criteria);
		if (keys.includes("knife_medium")) return { choice: "hatchet_thrown", confidence: 0.9 };
		if (keys.includes("revolver_38")) return { choice: "revolver_38", confidence: 0.75 };
		return { choice: "none", confidence: 0.9 };
	});
	assert.equal(result.status, "decided");
	assert.equal(result.band, "revolver_38");
	assert.equal(result.family.choice, "Firearms (Handgun)");
});
