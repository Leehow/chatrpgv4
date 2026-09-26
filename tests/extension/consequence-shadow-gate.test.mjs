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

test("keeperDidFor: npc_reaction -- SL-83: the candidate's handle pairs with the roll receipt's handle; the display name never did", () => {
	// The shape SL-77 measured on gates #14/#15: the capsule row said "Vittorio Macario", the Keeper's own
	// first-impression roll said `vittorio-macario`, and the pairing read 0/4 and 0/2 for a class whose every
	// cleared row was a real engagement. The candidate now carries the handle (consequence-candidates.test.mjs).
	const roll = { kind: "roll", decision: "natural-npc:first-impression", npc: "vittorio-macario", actor: "thomas-hayes" };
	assert.equal(keeperDidFor({ consequenceClass: "npc_reaction", target: "vittorio-macario" }, [roll]), true, "handle to handle: the same person");
	assert.equal(keeperDidFor({ consequenceClass: "npc_reaction", target: "vittorio-macario" }, [{ ...roll, npc: "gabriela-macario" }]), "other");
});

test("keeperDidFor: npc_reaction -- SL-83: a display-name target (a row from an older kernel) pairs only through the turn's own person receipt", () => {
	const roll = { kind: "roll", decision: "natural-npc:first-impression", npc: "vittorio-macario", actor: "thomas-hayes" };
	const person = { kind: "person", who: "vittorio-macario", name: "Vittorio Macario", label: "维托里奥·马卡里奥" };
	const entry = { consequenceClass: "npc_reaction", target: "Vittorio Macario" };
	assert.equal(keeperDidFor(entry, [roll, person]), true, "the turn's own `person` receipt says which handle this display name is; that is data, not a list");
	assert.equal(keeperDidFor(entry, [person, roll]), true, "receipt order is not a condition");
	assert.equal(keeperDidFor(entry, [roll]), "other", "without a receipt naming the person this turn, a label cannot be paired and reads as a stranger's roll");
	assert.equal(keeperDidFor(entry, [roll, { ...person, who: "gabriela-macario", name: "Gabriela Macario" }]), "other", "another person's receipt does not lend its handle");
	assert.equal(keeperDidFor(entry, [person]), false, "a person receipt alone is not a first impression");
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
