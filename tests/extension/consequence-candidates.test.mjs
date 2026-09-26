/**
 * SL-76 (contract §135.32, §135.3.1; design `docs/specs/jev-driven-steps.md` D1): the three consequence candidate
 * classes are pure functions of the same kernel reads `runtime/jev/candidates.ts` already reads. Pure: every
 * fixture below is a hand-built `Row` in the exact shape the contract documents (`capsule.mods.pending_contacts`,
 * `table.apply.options.candidates`, `capsule.where.rules[].time_cost`/`handle`), never a real kernel subprocess --
 * the builders under test read nothing else. No Jev, no kernel, no network.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildConsequenceCandidates, clueFollowUpCandidates, NPC_REACTION_DECISION, npcReactionCandidates, timeCostCandidates } from "../../runtime/jev/consequence-candidates.ts";

const emptyReads = { capsule: {}, applyOptions: {}, resolveOptions: {} };
const withGuard = (kind, values) => ({ applyOptions: { obligations: [{ state: "open", trigger: { kind: "attempt", guards: { [kind]: values } } }] } });

test("npc_reaction: no pending contact (already met) issues none", () => {
	const reads = { ...emptyReads, capsule: { mods: { pending_contacts: [] } } };
	assert.deepEqual(npcReactionCandidates(reads), []);
});

test("npc_reaction: a pending natural-npc contact issues one candidate with its own Noul, and none for another decision", () => {
	const reads = {
		capsule: { mods: { pending_contacts: [
			{ decision: NPC_REACTION_DECISION, target: "thomas-hayes", actor: "steven-knott", when: "first meaningful contact" },
			{ decision: "some-other-mod:check", target: "thomas-hayes", actor: "steven-knott" },
		] } },
		applyOptions: {}, resolveOptions: {},
	};
	const out = npcReactionCandidates(reads, "I greet Thomas Hayes");
	assert.equal(out.length, 1, "only the natural-npc decision is issued here; the other decision is `mod_contact`'s to read, not this class's");
	const [candidate] = out;
	assert.equal(candidate.consequenceClass, "npc_reaction");
	assert.equal(candidate.clerk, "consequence_bookkeeping");
	assert.equal(candidate.bound.target, "thomas-hayes");
	assert.equal(candidate.bound.actor, "steven-knott");
	assert.ok(candidate.noul, "an npc_reaction candidate always carries its own Noul question (D1: it is never direct)");
	assert.match(candidate.noul.instructions, /engage/);
});

test("npc_reaction: SL-83 -- the key and bound.target carry the row's handle; the display name stays in the label and the Noul", () => {
	// The real capsule row (`kernel-ts/read/mods.ts`): `target` is the display name, `handle` the graph handle the
	// first-impression roll receipt's `npc` also carries. Before SL-83 the key/bound carried the display name and
	// `keeperDidFor` could never pair it with the receipt (SL-77: 0/4 and 0/2 on two real tables).
	const reads = { capsule: { mods: { pending_contacts: [
		{ decision: NPC_REACTION_DECISION, target: "Vittorio Macario", handle: "vittorio-macario", actor: "Thomas Hayes", when: "first meaningful contact" },
	] } }, applyOptions: {}, resolveOptions: {} };
	const [candidate] = npcReactionCandidates(reads, "I ask to see Vittorio");
	assert.equal(candidate.key, "consequence:npc_reaction:Thomas Hayes:vittorio-macario");
	assert.equal(candidate.bound.target, "vittorio-macario", "what the pairing compares to the roll receipt's `npc`, and what `resolve` is given (a handle resolves exactly)");
	assert.match(candidate.label, /engages Vittorio Macario/, "the human-facing label keeps the display name");
	assert.match(candidate.noul.criteria.true, /Vittorio Macario/, "Jev is asked in the table's words for the person, never a handle");
	assert.ok(!JSON.stringify(candidate.noul).includes("vittorio-macario"), "the handle never reaches the Noul");
});

test("npc_reaction: SL-83 -- a row without a handle (an older kernel) falls back to its target, and the guard still reads the display name", () => {
	const legacy = { decision: NPC_REACTION_DECISION, target: "Vittorio Macario", actor: "Thomas Hayes" };
	const [candidate] = npcReactionCandidates({ capsule: { mods: { pending_contacts: [legacy] } }, applyOptions: {}, resolveOptions: {} });
	assert.equal(candidate.bound.target, "Vittorio Macario", "no handle on the row: the target is all there is (keeperDidFor then pairs it through the turn's person receipts)");
	const withHandle = { ...legacy, handle: "vittorio-macario" };
	const guarded = { capsule: { mods: { pending_contacts: [withHandle] } }, ...withGuard("people", ["Vittorio Macario"]), resolveOptions: {} };
	assert.deepEqual(npcReactionCandidates(guarded), [], "obligation guards name people by display name (kernel-ts/read/obligations.ts); the handle does not change what withholds");
});

test("npc_reaction: a guarded person (an open obligation's guard) issues none -- the gate the graph already enforces", () => {
	const reads = { capsule: { mods: { pending_contacts: [{ decision: NPC_REACTION_DECISION, target: "thomas-hayes", actor: "steven-knott" }] } },
		...withGuard("people", ["thomas-hayes"]), resolveOptions: {} };
	assert.deepEqual(npcReactionCandidates(reads), [], "guards.people withholds it exactly as it withholds a roster candidate");
});

test("npc_reaction: a preordained reaction (the book skips the roll) issues none", () => {
	const reads = {
		capsule: { mods: { pending_contacts: [{ decision: NPC_REACTION_DECISION, target: "thomas-hayes", actor: "steven-knott" }] } },
		applyOptions: { obligations: [{ state: "open", who: "thomas-hayes", reaction: "preordained",
			mod_contact: [{ check: NPC_REACTION_DECISION, clerk: false }] }] },
		resolveOptions: {},
	};
	assert.deepEqual(npcReactionCandidates(reads), []);
});

test("clue_follow_up: a discovered clue is simply not offered (the kernel never lists it in apply.options)", () => {
	const reads = { ...emptyReads, applyOptions: { candidates: [] } };
	assert.deepEqual(clueFollowUpCandidates(reads), []);
});

test("clue_follow_up: an unguarded clue row issues one candidate with its own Noul", () => {
	const reads = { ...emptyReads, applyOptions: { candidates: [
		{ effect: { kind: "clue", clue: "globe-unpublished-story" }, description: { summary: "a spiked story about the tragedy" } },
	] } };
	const out = clueFollowUpCandidates(reads);
	assert.equal(out.length, 1);
	assert.equal(out[0].consequenceClass, "clue_follow_up");
	assert.equal(out[0].clerk, "consequence_bookkeeping");
	assert.equal(out[0].bound.clue, "globe-unpublished-story");
	assert.ok(out[0].noul);
});

test("clue_follow_up (SL-86, §135.32 addendum 3): a row whose description carries the book's own cues puts them on `detail.cues` and the Noul's `criteria.true.examples`, never on `bound`", () => {
	const reads = { ...emptyReads, applyOptions: { candidates: [
		{ effect: { kind: "clue", clue: "nailed-windows" }, description: { summary: "the windows are nailed shut",
			cues: ["Examine the side door's multiple bolts and the nailed-shut ground-floor windows"] } },
	] } };
	const out = clueFollowUpCandidates(reads);
	assert.equal(out.length, 1);
	assert.deepEqual(out[0].detail, { cues: ["Examine the side door's multiple bolts and the nailed-shut ground-floor windows"] });
	assert.deepEqual(out[0].noul.criteria.true.examples, ["Examine the side door's multiple bolts and the nailed-shut ground-floor windows"]);
	assert.ok(out[0].noul.criteria.false.not_for, "the false side names what does not count, per the skill's Noul rubric");
	assert.equal(out[0].bound.cues, undefined, "cues never reach `bound`: they must never become an apply write argument");
	assert.deepEqual(Object.keys(out[0].bound).sort(), ["clue", "how", "kind"].sort(), "bound stays exactly {kind, clue, how}, byte for byte");
});

test("clue_follow_up (SL-86): a row with no cues carries no `detail` and no `examples` -- the mutation-killable case: drop the cues, lose them from both", () => {
	const reads = { ...emptyReads, applyOptions: { candidates: [
		{ effect: { kind: "clue", clue: "globe-unpublished-story" }, description: { summary: "a spiked story about the tragedy" } },
	] } };
	const out = clueFollowUpCandidates(reads);
	assert.equal(out.length, 1);
	assert.equal(out[0].detail, undefined);
	assert.equal(out[0].noul.criteria.true.examples, undefined);
});

test("clue_follow_up (SL-86): a non-string or blank cue entry is dropped, never carried through as `examples`/`detail`", () => {
	const reads = { ...emptyReads, applyOptions: { candidates: [
		{ effect: { kind: "clue", clue: "x" }, description: { summary: "y", cues: ["a real cue", "", 7, null, "  "] } },
	] } };
	const out = clueFollowUpCandidates(reads);
	assert.deepEqual(out[0].detail, { cues: ["a real cue"] });
	assert.deepEqual(out[0].noul.criteria.true.examples, ["a real cue"]);
});

test("clue_follow_up: a row the kernel withholds (`guarded_by`) issues none -- the gate is data, never asked", () => {
	const reads = { ...emptyReads, applyOptions: { candidates: [
		{ effect: { kind: "clue", clue: "globe-unpublished-story" }, description: { summary: "x" }, guarded_by: "globe-clippings-access" },
	] } };
	assert.deepEqual(clueFollowUpCandidates(reads), []);
});

test("clue_follow_up: a clue an open obligation's guard names issues none even without `guarded_by` on the row itself", () => {
	const reads = { ...emptyReads, applyOptions: {
		obligations: [{ state: "open", trigger: { kind: "attempt", guards: { clues: ["globe-unpublished-story"] } } }],
		candidates: [{ effect: { kind: "clue", clue: "globe-unpublished-story" }, description: {} }],
	} };
	assert.deepEqual(clueFollowUpCandidates(reads), []);
});

test("time_cost: no time_cost shape on any scene rule issues none", () => {
	const reads = { ...emptyReads, capsule: { where: { rules: [{ name: "some-rule" }] } } };
	assert.deepEqual(timeCostCandidates(reads), []);
});

test("time_cost: a stated amount is direct -- no Noul, never a question (D1/D4)", () => {
	const reads = { ...emptyReads, capsule: { where: { rules: [
		{ name: "canvass-the-block", handle: "canvass-the-block", time_cost: { amount: "1", unit: "hour" } },
	] } } };
	const out = timeCostCandidates(reads);
	assert.equal(out.length, 1);
	assert.equal(out[0].consequenceClass, "time_cost");
	assert.equal(out[0].clerk, "consequence_bookkeeping");
	assert.equal(out[0].bound.stated, "canvass-the-block");
	assert.equal(out[0].noul, undefined, "a stated time cost carries no question at all");
});

test("time_cost: an amount_unstated shape carries a Noul and an open, unresolvable `minutes` (the Keeper's if it were ever bound)", () => {
	const reads = { ...emptyReads, capsule: { where: { rules: [
		{ name: "search-the-archive", handle: "search-the-archive", time_cost: { amount_unstated: true } },
	] } } };
	const out = timeCostCandidates(reads);
	assert.equal(out.length, 1);
	assert.ok(out[0].noul, "an unstated amount asks whether time passed at all");
	const minutes = out[0].unbound.find((value) => value.name === "minutes");
	assert.ok(minutes && minutes.required && minutes.vocabulary === "open", "no rules default exists for an arbitrary amount: this stays the Keeper's to bind");
});

test("time_cost: a `round` unit issues none -- combat rounds do not move the clock", () => {
	const reads = { ...emptyReads, capsule: { where: { rules: [
		{ name: "fighting-back", handle: "fighting-back", time_cost: { amount: "1", unit: "round" } },
	] } } };
	assert.deepEqual(timeCostCandidates(reads), []);
});

test("buildConsequenceCandidates: keys never collide across the three classes", () => {
	const reads = {
		capsule: {
			mods: { pending_contacts: [{ decision: NPC_REACTION_DECISION, target: "thomas-hayes", actor: "steven-knott" }] },
			where: { rules: [{ name: "canvass", handle: "canvass", time_cost: { amount: "30", unit: "minute" } }] },
		},
		applyOptions: { candidates: [{ effect: { kind: "clue", clue: "globe-unpublished-story" }, description: {} }] },
		resolveOptions: {},
	};
	const out = buildConsequenceCandidates(reads, "I search the clippings room");
	assert.equal(out.length, 3);
	assert.equal(new Set(out.map((candidate) => candidate.key)).size, 3);
	assert.deepEqual(out.map((candidate) => candidate.consequenceClass), ["npc_reaction", "clue_follow_up", "time_cost"]);
});

test("no candidate of any class carries a kernel-internal tag as a model-visible field (D2.3: rows carry no kernel tags)", () => {
	const reads = {
		capsule: { mods: { pending_contacts: [{ decision: NPC_REACTION_DECISION, target: "thomas-hayes", actor: "steven-knott" }] } },
		applyOptions: { candidates: [{ effect: { kind: "clue", clue: "x" }, description: { summary: "y" } }] },
		resolveOptions: {},
	};
	for (const candidate of buildConsequenceCandidates(reads)) {
		const visible = JSON.stringify({ label: candidate.label, bound: candidate.bound, unbound: candidate.unbound, noul: candidate.noul ?? null });
		assert.ok(!visible.includes("available_route_not_player_choice"), "no kernel authority tag leaks into a model-visible field");
		assert.ok(!/"basis"/.test(visible) && !/"clerk"/.test(visible), "clerk/basis stay internal");
	}
});
