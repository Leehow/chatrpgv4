/**
 * SL-76 (contract §135.32, §135.3.1; design D4): the pure gate over `COC_JEV_STEPS` and the turn-close pairing,
 * pulled out of `hybrid-engine.ts`'s `routeConsequences`/`turnCloseStep` so "shadow never executes" and "the
 * pairing row is written for the three outcomes" can be proven by a table of inputs rather than by reading (or
 * trusting) the engine's control flow. No Jev, no kernel, no Pi session.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { consequenceKeysToExecute, jevStepsMode, keeperDidFor } from "../../runtime/jev/hybrid-engine.ts";

const ROW = (key, cleared) => ({ class: "npc_reaction", key, cleared, confidence: 0.9, distribution: { true: 0.9, false: 0.1 } });

test("jevStepsMode: shadow is the default for anything but the two named values", () => {
	assert.equal(jevStepsMode({}), "shadow");
	assert.equal(jevStepsMode({ COC_JEV_STEPS: "" }), "shadow");
	assert.equal(jevStepsMode({ COC_JEV_STEPS: "SHADOW" }), "shadow", "case is not massaged: an unrecognized spelling is still the safe default, never a guess at intent");
	assert.equal(jevStepsMode({ COC_JEV_STEPS: "on" }), "on");
	assert.equal(jevStepsMode({ COC_JEV_STEPS: "off" }), "off");
});

test("consequenceKeysToExecute: shadow never executes a cleared row -- the whole of D4's 'shadow' rule in one table", () => {
	const rows = [ROW("k1", true), ROW("k2", true), ROW("k3", false)];
	assert.deepEqual(consequenceKeysToExecute("shadow", rows, new Set()), []);
	assert.deepEqual(consequenceKeysToExecute("off", rows, new Set()), []);
});

test("consequenceKeysToExecute: `on` executes every cleared row once, skipping an uncleared row and one already executed", () => {
	const rows = [ROW("k1", true), ROW("k2", true), ROW("k3", false)];
	assert.deepEqual(consequenceKeysToExecute("on", rows, new Set()).sort(), ["k1", "k2"]);
	assert.deepEqual(consequenceKeysToExecute("on", rows, new Set(["k1"])), ["k2"]);
	assert.deepEqual(consequenceKeysToExecute("on", rows, new Set(["k1", "k2"])), []);
});

test("keeperDidFor: npc_reaction -- true on the same NPC, other on a different one, false on none", () => {
	const entry = { consequenceClass: "npc_reaction", target: "thomas-hayes" };
	const sameNpc = [{ kind: "roll", decision: "natural-npc:first-impression", npc: "thomas-hayes" }];
	const otherNpc = [{ kind: "roll", decision: "natural-npc:first-impression", npc: "someone-else" }];
	assert.equal(keeperDidFor(entry, sameNpc), true);
	assert.equal(keeperDidFor(entry, otherNpc), "other");
	assert.equal(keeperDidFor(entry, []), false);
	assert.equal(keeperDidFor(entry, [{ kind: "clue", clue: "x" }]), false, "an unrelated receipt kind is not evidence of anything for this class");
});

test("keeperDidFor: clue_follow_up -- true on the same clue, other on a different one, false on none", () => {
	const entry = { consequenceClass: "clue_follow_up", clue: "globe-unpublished-story" };
	assert.equal(keeperDidFor(entry, [{ kind: "clue", clue: "globe-unpublished-story" }]), true);
	assert.equal(keeperDidFor(entry, [{ kind: "clue", clue: "macario-tragedy" }]), "other");
	assert.equal(keeperDidFor(entry, []), false);
});

test("keeperDidFor: time_cost -- any time receipt this turn counts true, none counts false, never 'other' (no second entity)", () => {
	const entry = { consequenceClass: "time_cost" };
	assert.equal(keeperDidFor(entry, [{ kind: "time", minutes: 30 }]), true);
	assert.equal(keeperDidFor(entry, []), false);
	assert.equal(keeperDidFor(entry, [{ kind: "clue", clue: "x" }]), false);
});
