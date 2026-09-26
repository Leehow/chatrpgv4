/**
 * §139.3–§139.5 (docs/specs/npc-acts-first.md D2–D6 and D9; tickets 03 and 04): a person's act is generated first and
 * bound after -- the kernel lists the ways it can settle it (`npc.act.options`), one closed Jev batch picks the way and
 * its parameters, the clerk writes it through the ordinary gateway, and every receipt of the act carries
 * `intent: {ref, npc, text, outcome, generated: true}`. Two gates keep a person from doing the same thing twice: the act
 * that is the same line as a row under way continues it (structural), and the act Jev reads as the same thing as a row
 * with no result is re-asked once, then bound as that row continued and abandoned (semantic).
 *
 * - Pure seams: the batch and its reading under the §135.2 gates; the writes a bound act becomes; the policy's scan step;
 *   the NPC's turn of a fight as the forced `npc_act` candidate.
 * - The table (hybrid engine, emitted kernel, the kernel extension's gateway, a stub Jev, the fixture generation port):
 *   Knott's own turn of the fight spent on a shout; the same act Jev cannot settle; what a surprise of the stakes die
 *   lets the act bring out (§139.19: a rulebook pistol the same act fires; a `produces` with no surprise, dropped);
 *   the people a declaration acted on (and not the one it did not).
 * - The engine on the emitted kernel (the gateway a thin forwarder that applies the kernel extension's own host marks):
 *   the per-turn cap; pursuit after a flight; the two no-repeat gates across turns; a thing of the table's own brought
 *   out, in his hands on the next turn's packet (§139.19).
 *
 * No live model is called; assertions are on receipts, rows and fixture calls, never on prose.
 */
import { strict as assert } from "node:assert";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { createRealCampaign, openTable } from "./harness.mjs";
import { buildCandidates } from "../../runtime/jev/candidates.ts";
import { createHybridEngine } from "../../runtime/jev/hybrid-engine.ts";
import { createFixtureNpcActPort } from "../../runtime/jev/npc-act.ts";
import { NPC_ACT_BIND_FAMILY, SAME_QUESTION, interpretNpcAct, npcActBatch, npcActWrites, npcProduceBatch, npcScanCandidate, producePart, runNpcAct } from "../../runtime/jev/npc-act-step.ts";
import { COMPILE_FAMILY } from "../../runtime/jev/route-compile.ts";
import { initialView, next, npcScanDue, settleExecute, startStep } from "../../runtime/jev/step-policy.ts";
import { markNpcAct } from "../../extensions/kernel/npc-act-marks.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CAMPAIGN = "test-camp";
const scope = { owner: `campaign:${CAMPAIGN}`, campaign: CAMPAIGN, worldline: "main", loop: 0, audience: "keeper" };
const SHOUT = "他转身冲向楼梯口，朝楼下大喊有人打人。";
const GUN = "他从腰里拔出手枪，朝你开火。";

// ---------------------------------------------------------------------------------------------------
// Jev answers in the adapter's result shape.
// ---------------------------------------------------------------------------------------------------

const choice = (value, confidence = 0.9) => ({ status: "answered", type: "choice", choice: value, confidence, probabilities: { [value]: confidence } });
const complete = (batch, answers) => ({ batchId: batch.id, status: "complete", answers, issues: [],
	coverage: { required: Object.keys(answers), answered: Object.keys(answers), unknown: [] } });
/** The alias of a question whose criterion `match` accepts (its label or descriptor), else undefined. */
const aliasWhere = (question, match) => Object.entries(question?.criteria ?? {}).find(([alias, value]) => alias !== "unknown" && match(value, alias))?.[0];
/**
 * An answer to the npc-act batch. `way`: a way name (or "unknown"); `params`: per `<way>.<param>` key a matcher over the
 * option's label, or an alias; unmatched parameters take their first option. `same`: a matcher over the row, or "none".
 * `produce` (§139.19): a matcher over the book's name of a price-list record, or "none" -- it answers the record question,
 * and the part question with the part whose records it matches (the second batch of a long list is answered the same way).
 */
function actAnswer(batch, { way = "unknown", params = {}, same = "none", produce = "none" } = {}) {
	const answers = {};
	for (const question of batch.questions) {
		if (question.key === "way") answers.way = choice(way);
		else if (question.key === "same") answers.same = choice(typeof same === "function" ? aliasWhere(question, same) ?? "none" : same);
		else if (question.key === "produce") answers.produce = choice(typeof produce === "function" ? aliasWhere(question, produce) ?? "none" : produce);
		else if (question.key === "produce_part") answers.produce_part = choice(typeof produce === "function"
			? aliasWhere(question, (value) => (value?.records ?? []).some((label) => produce(label))) ?? "none" : produce);
		else {
			const wanted = params[question.key];
			const alias = typeof wanted === "function" ? aliasWhere(question, wanted) : typeof wanted === "string" ? wanted : Object.keys(question.criteria)[0];
			answers[question.key] = choice(alias ?? "unknown");
		}
	}
	return complete(batch, answers);
}
/** Every other batch: the compile reads nothing clear, a route question says `later` and the exit `finish`, a bind is unknown. */
function otherAnswer(batch) {
	const answers = {};
	for (const question of batch.questions) {
		const criteria = Object.keys(question.criteria ?? {});
		const value = question.key === "exit" ? "finish" : criteria[0] === "now" ? "later" : criteria.includes("unclear") ? "unclear"
			: criteria.includes("no") && criteria.includes("yes") ? "no" : "unknown";
		answers[question.key] = choice(value);
	}
	return complete(batch, answers);
}

// ---------------------------------------------------------------------------------------------------
// Pure seams.
// ---------------------------------------------------------------------------------------------------

/** `npc.act.options` as the kernel answers it for Knott on his turn of a fight (the shape of §139.3). */
const fightOptions = (extra = {}) => ({
	npc: { handle: "steven-knott", name: "Steven Knott" }, play_language: "zh-Hans", place: "commission-briefing", in_session: true, my_turn: true, acted_on: [],
	ways: [
		{ way: "attack", params: { target: [{ value: "thomas-hayes", label: "Thomas Hayes" }], weapon: [{ value: "unarmed", label: "Unarmed (fist/kick)" }] } },
		{ way: "flee", params: {} },
		{ way: "check", params: { skill: [{ value: "Spot Hidden", label: "Spot Hidden 55" }, { value: "Listen", label: "Listen 40" }] } },
		{ way: "intention_only", params: {} },
	],
	// §139.19: the price list of the era, asked with produce: true -- a weapon record carries its profile.
	produce: [{ value: "eq.1920s.weapon_table.38", label: ".38 or 9mm Revolver", category: "weapon_table", weapon: "revolver_38_or_9mm" },
		{ value: "eq.1920s.miscellaneous.umbrella", label: "Umbrella", category: "miscellaneous" }],
	...extra,
});
const PACKET = { npc: { handle: "steven-knott", name: "Steven Knott" }, state: { in_session: true, my_turn: true }, at_hand: { holdings: [] }, done: [] };
const batchOf = (input = {}) => npcActBatch({ runId: "r", person: "Steven Knott", act: SHOUT, packet: PACKET, options: fightOptions(), rows: [], ...input }, scope, []);
const PISTOL = "袖珍手枪";

test("§139.3 batch: one closed question for the way, one per parameter with a choice, the produced record only when the act brings something out, the same-row question over the rows", () => {
	const { batch } = batchOf();
	assert.equal(batch.family, NPC_ACT_BIND_FAMILY);
	assert.equal(batch.familyVersion, "2", "§139.19: the draw question became the produce question");
	assert.deepEqual(batch.questions.map((question) => question.key), ["way", "check.skill"], "one target and one weapon are bound without a question");
	assert.deepEqual(Object.keys(batch.questions[0].criteria), ["attack", "flee", "check", "intention_only", "unknown"]);
	assert.equal(batch.state.act, SHOUT, "keyed on the act the generation wrote");
	assert.equal(batch.state.produces, undefined);
	const producing = batchOf({ produces: PISTOL }).batch;
	assert.deepEqual(producing.questions.map((question) => question.key), ["way", "attack.weapon", "check.skill", "produce"]);
	assert.equal(producing.state.produces, PISTOL, "Jev reads what the act brings out");
	assert.ok(Object.values(producing.questions.find((question) => question.key === "attack.weapon").criteria).some((label) => /bring out/.test(label)),
		"the attack's weapon options include the thing the act brings out, when the book prices weapons");
	assert.deepEqual(producing.questions.find((question) => question.key === "produce").criteria,
		{ record_1: ".38 or 9mm Revolver", record_2: "Umbrella", none: "No record of the price list is that thing." }, "the book's names, and none");
	const unarmed = batchOf({ produces: PISTOL, options: fightOptions({ produce: [{ value: "eq.u", label: "Umbrella", category: "miscellaneous" }] }) }).batch;
	assert.ok(!unarmed.questions.some((question) => question.key === "attack.weapon"), "a price list with no weapon adds no weapon option");
	const rows = [{ ref: "intent:steven-knott:aaaaaaaaaaaa", intent: "ring the bell", status: "attempted", since_turn: 1, turn: 1 }];
	const same = batchOf({ rows }).batch.questions.find((question) => question.key === "same");
	// §139.14: the options are the rows' own lines and statuses plus none; what is asked is the purpose, not the hands.
	assert.deepEqual(same.criteria, { row_1: { intent: "ring the bell", status: "attempted" }, none: SAME_QUESTION.none });
	assert.equal(same.instructions, SAME_QUESTION.instructions);
	assert.match(same.instructions, /same purpose, whatever the hands do/);
});

test("§139.3 reading: a cleared way binds with its parameters; unknown, below the gate or an unbound parameter binds intention_only; no answer is not judged", () => {
	const { batch, plan } = batchOf({ produces: PISTOL, rows: [{ ref: "intent:steven-knott:aaaaaaaaaaaa", intent: "ring the bell", status: "attempted" }] });
	const checked = interpretNpcAct(plan, actAnswer(batch, { way: "check", params: { "check.skill": (label) => label.startsWith("Listen") } }), 0.6);
	assert.deepEqual([checked.judged, checked.way, checked.params.skill.value, checked.produced, checked.same],
		[true, "check", "Listen", { name: PISTOL, source: "table" }, null], "a produces no record was chosen for is the table's own thing");
	const unknown = interpretNpcAct(plan, actAnswer(batch, { way: "unknown" }), 0.6);
	assert.deepEqual([unknown.judged, unknown.way, unknown.reason], [true, "intention_only", "way_unknown"]);
	const low = { ...actAnswer(batch, { way: "check" }), answers: { ...actAnswer(batch, { way: "check" }).answers, way: { status: "answered", type: "choice", choice: "check", confidence: 0.3, probabilities: { check: 0.3, attack: 0.28 } } } };
	assert.deepEqual([interpretNpcAct(plan, low, 0.6).way, interpretNpcAct(plan, low, 0.6).reason], ["intention_only", "way_below_gate"]);
	const drawn = interpretNpcAct(plan, actAnswer(batch, { way: "attack", params: { "attack.weapon": "weapon_drawn" }, produce: (label) => label.startsWith(".38") }), 0.6);
	assert.deepEqual([drawn.way, drawn.params.weapon.value, drawn.params.weapon.price_id, drawn.produced.source, drawn.produced.record.weapon],
		["attack", "revolver_38_or_9mm", "eq.1920s.weapon_table.38", "catalog", "revolver_38_or_9mm"], "the brought-out weapon is the attack's, by its profile");
	assert.equal(drawn.produced.name, ".38 or 9mm Revolver", "named as the book names it");
	const nothingDrawn = interpretNpcAct(plan, actAnswer(batch, { way: "attack", params: { "attack.weapon": "weapon_drawn" } }), 0.6);
	assert.deepEqual([nothingDrawn.way, nothingDrawn.reason, nothingDrawn.produced.source], ["intention_only", "param_unbound:weapon", "table"]);
	const umbrella = interpretNpcAct(plan, actAnswer(batch, { way: "attack", params: { "attack.weapon": "weapon_drawn" }, produce: (label) => label === "Umbrella" }), 0.6);
	assert.deepEqual([umbrella.way, umbrella.reason, umbrella.produced.source, umbrella.produced.record.value], ["intention_only", "param_unbound:weapon", "catalog",
		"eq.1920s.miscellaneous.umbrella"], "a record that is no weapon of the book's is never the attack's weapon");
	const same = interpretNpcAct(plan, actAnswer(batch, { way: "intention_only", same: "row_1" }), 0.6);
	assert.equal(same.same.row.intent, "ring the bell");
	const none = interpretNpcAct(plan, undefined, 0.6);
	assert.deepEqual([none.judged, none.way, none.reason, none.produced], [false, "intention_only", "jev_unavailable", { name: PISTOL, source: "table" }],
		"with no Jev the thing is still brought out, as the table's own: no record, no number");
});

test("§139.19 a price list longer than one question: its parts first, the record within the chosen part in a second batch", () => {
	// 300 records in three parts: more than the provider's choice limit, so the first batch asks the part.
	const records = ["tools", "melee", "weapon_table"].flatMap((category, part) => Array.from({ length: 100 }, (_, index) => ({ value: `eq.${category}.${index}`,
		label: category === "weapon_table" && index === 7 ? ".25 Derringer (1B)" : `${category} thing ${index}`, category,
		...(category === "weapon_table" ? { weapon: index === 7 ? "automatic_25_derringer" : `weapon_${index}` } : {}) })));
	const { batch, plan } = batchOf({ produces: PISTOL, options: fightOptions({ produce: records }) });
	assert.ok(!batch.questions.some((question) => question.key === "produce"), "no record question in the first batch");
	const partQuestion = batch.questions.find((question) => question.key === "produce_part");
	assert.deepEqual(Object.keys(partQuestion.criteria), ["part_1", "part_2", "part_3", "none"]);
	assert.deepEqual([partQuestion.criteria.part_3.part, partQuestion.criteria.part_3.records.length], ["weapon_table", 100], "a part lists the book's names of its records");
	const first = actAnswer(batch, { way: "attack", params: { "attack.weapon": "weapon_drawn" }, produce: (label) => label.startsWith(".25 Derringer") });
	const part = producePart(plan, first, 0.6);
	assert.deepEqual([part.part, part.records.length], ["weapon_table", 100]);
	const second = npcProduceBatch({ runId: "r", person: "Steven Knott", act: GUN, produces: PISTOL, part: part.part, records: part.records }, scope, []);
	assert.deepEqual([second.batch.family, second.batch.questions.map((question) => question.key), second.batch.state.part], [NPC_ACT_BIND_FAMILY, ["produce"], "weapon_table"]);
	const bound = interpretNpcAct(plan, first, 0.6, { records: second.records, result: actAnswer(second.batch, { produce: (label) => label.startsWith(".25 Derringer") }) });
	assert.deepEqual([bound.way, bound.params.weapon.value, bound.produced.source, bound.produced.name], ["attack", "automatic_25_derringer", "catalog", ".25 Derringer (1B)"]);
	assert.equal(producePart(plan, actAnswer(batch, { way: "attack" }), 0.6), null, "no part chosen: no second batch");
	const own = interpretNpcAct(plan, actAnswer(batch, { way: "intention_only" }), 0.6);
	assert.deepEqual(own.produced, { name: PISTOL, source: "table" }, "none of the parts: the table's own");
	const unanswered = interpretNpcAct(plan, first, 0.6, { records: second.records, result: undefined });
	assert.deepEqual([unanswered.produced.source, unanswered.reason], ["table", "param_unbound:weapon"], "the second batch unanswered: no record, so no weapon");
});

const writeContext = (extra = {}) => ({ name: "Steven Knott", handle: "steven-knott", line: SHOUT, ref: "intent:steven-knott:bbbbbbbbbbbb", open: true, continuedTurn: null,
	turn: 3, spend: true, abandon: false, place: "commission-briefing", ...extra });
const bound = (way, params = {}, extra = {}) => ({ judged: true, way, params: Object.fromEntries(Object.entries(params).map(([key, value]) => [key, { value, label: value }])),
	draw: null, same: null, reason: "bound", answers: {}, ...extra });

test("§139.3 writes: a new act opens its row (spending the turn on their turn of a fight unless the way is a fight action), then every write names it", () => {
	assert.deepEqual(npcActWrites(bound("check", { skill: "Listen" }), writeContext()).map((call) => [call.tool, call.args]), [
		["apply", { effects: [{ kind: "npc", name: "Steven Knott", intends: SHOUT, outcome: "attempted", spend_turn: true }] }],
		["resolve", { action: { actor: "steven-knott", goal: SHOUT, method: SHOUT, intent_ref: "intent:steven-knott:bbbbbbbbbbbb", intent: "investigate", skill: "Listen" } }],
	]);
	const attack = npcActWrites(bound("attack", { target: "thomas-hayes", weapon: "unarmed" }), writeContext());
	assert.equal(attack[0].args.effects[0].spend_turn, undefined, "the combat engine passes the turn of a fight action");
	assert.deepEqual(attack[1].args.action.decision, "combat:attack");
	assert.deepEqual(npcActWrites(bound("intention_only"), writeContext()).map((call) => call.args.effects), [[{ kind: "npc", name: "Steven Knott", intends: SHOUT, outcome: "attempted", spend_turn: true }]]);
	const outside = npcActWrites(bound("stance", { stance: "hostile" }), writeContext({ spend: false }));
	assert.deepEqual(outside.map((call) => call.args.effects), [[{ kind: "npc", name: "Steven Knott", intends: SHOUT, outcome: "attempted" },
		{ kind: "npc", name: "Steven Knott", stance: "hostile", intent_ref: "intent:steven-knott:bbbbbbbbbbbb", intent_outcome: "done", why: SHOUT }]], "one batch");
	const revolver = { value: "eq.x", label: ".38", category: "weapon_table", weapon: "revolver_38_or_9mm" };
	const drawn = npcActWrites(bound("attack", { target: "thomas-hayes", weapon: "revolver_38_or_9mm" }, { produced: { name: ".38", source: "catalog", record: revolver } }), writeContext());
	assert.deepEqual(drawn[0].args.effects[1], { kind: "npc", name: "Steven Knott", intent_ref: "intent:steven-knott:bbbbbbbbbbbb", intent_outcome: "attempted" },
		"what is brought out is a bare npc effect of its own beside the opener, before the attack; the host marks it");
	assert.deepEqual(drawn[0].carries, { draw: { weapon: "revolver_38_or_9mm", price_id: "eq.x" } }, "a weapon of the book's is drawn");
	assert.equal(drawn[1].tool, "resolve");
	// §139.19: anything else is produced -- the book's record by its price_id, the table's own by its name -- described by the act.
	const umbrella = npcActWrites(bound("intention_only", {}, { produced: { name: "Umbrella", source: "catalog", record: { value: "eq.u", label: "Umbrella", category: "miscellaneous" } } }),
		writeContext({ act: GUN }));
	assert.deepEqual(umbrella.map((call) => call.carries), [{ produce: { price_id: "eq.u", description: GUN } }]);
	const photo = npcActWrites(bound("intention_only", {}, { produced: { name: "一张泛黄的全家福", source: "table" } }), writeContext({ act: GUN }));
	assert.deepEqual(photo.map((call) => [call.args.effects.length, call.carries]), [[2, { produce: { name: "一张泛黄的全家福", description: GUN } }]]);
	assert.equal(npcActWrites(bound("intention_only"), writeContext())[0].carries, undefined, "nothing brought out, nothing carried");
});

test("§139.5 writes: a continued row is named from the first write; the same act again with nothing to settle it abandons the row (why: repeated)", () => {
	const continuing = writeContext({ open: false, continuedTurn: 2, ref: "intent:steven-knott:cccccccccccc" });
	assert.deepEqual(npcActWrites(bound("intention_only"), { ...continuing, spend: false }).map((call) => call.args.effects), [[{ kind: "npc", name: "Steven Knott",
		intent_ref: "intent:steven-knott:cccccccccccc", outcome: "abandoned", why: "repeated" }]], "an intention under way since an earlier turn, repeated with no result");
	assert.deepEqual(npcActWrites(bound("check", { skill: "Listen" }), continuing).map((call) => [call.tool, call.args.effects?.[0]?.action ?? call.args.action?.intent_ref]),
		[["resolve", "intent:steven-knott:cccccccccccc"], ["apply", "hold"]], "a roll settles the row it continues; the turn passes by a hold");
	assert.deepEqual(npcActWrites(bound("intention_only", {}, { judged: false }), { ...continuing, spend: false }), [], "an unjudged repeat writes nothing");
});

test("§139.4 policy: after a landed step of the declaration the people it acted on act before the model step, once; not after a forced step; not past the time budget", () => {
	const context = { scene: "morgue", clock: null, present: [], receipts: [] };
	const check = { key: "resolve:obligation:access", verb: "resolve", family: "obligation_check", label: "check", source: "t", bound: {}, unbound: [], clerk: "stated_obligation", basis: {} };
	const view = initialView({ runId: "r", rawInput: "x", context, candidates: [], readFirst: false });
	view.pending = [{ kind: "direct", purpose: "execute", candidate: check }, { kind: "infer", purpose: "compose", reason: "settled" }];
	startStep(view, next(view));
	settleExecute(view, 1, { kind: "direct", purpose: "execute", candidate: check }, { ok: true, summary: {} }, { context, candidates: [] }, 0);
	assert.ok(npcScanDue(view));
	const scan = next(view);
	assert.deepEqual([scan.kind, scan.item.scan, scan.item.candidate.clerk, scan.item.candidate.bound.trigger], ["direct", true, "npc_act", "acted_on"]);
	const pending = view.pending.length;
	startStep(view, scan);
	assert.equal(view.pending.length, pending, "the scan is not taken from pending");
	settleExecute(view, 2, scan.item, { ok: true, summary: {} }, { context, candidates: [] }, 0);
	assert.ok(!npcScanDue(view));
	assert.deepEqual([next(view).kind, next(view).purpose], ["infer", "compose"], "then the model step");
	// A forced step (an NPC's pending defence) is not the declaration: no scan.
	const forced = initialView({ runId: "r", rawInput: "x", context, candidates: [], readFirst: false });
	settleExecute(forced, 1, { kind: "direct", purpose: "execute", candidate: { ...check, forced: true } }, { ok: true, summary: {} }, { context, candidates: [] }, 0);
	assert.ok(!npcScanDue(forced));
	// Past the run's time budget the compose comes first; the engine records `skipped_budget`.
	const late = initialView({ runId: "r", rawInput: "x", context, candidates: [], readFirst: false, budget: { maxRunMs: 10 } });
	late.pending = [{ kind: "infer", purpose: "compose", reason: "settled" }];
	settleExecute(late, 1, { kind: "direct", purpose: "execute", candidate: check }, { ok: true, summary: {} }, { context, candidates: [] }, 0);
	late.budget.runMs = 11;
	assert.equal(next(late).kind, "infer");
});

test("§139.4 candidates: an NPC's own turn of a fight is the forced npc_act step -- the standing attack no longer binds; a missing disposition is still inferred first", () => {
	const session = { kind: "combat", status: "active", round: 2, turn_of: "steven-knott", pending_defense: null,
		standing_action: { action: "attack", basis: "rule-default", disposition: { disposition: "fights_to_the_end", basis: "keeper" } },
		participants: [{ name: "thomas-hayes", side: "investigator" }, { name: "steven-knott", label: "Steven Knott", side: "npc" }],
		actions: [{ decision: "combat:attack", actor: "steven-knott", targets: ["thomas-hayes"], weapons: ["unarmed"] }, { decision: "combat:flee", actor: "steven-knott" }] };
	const [turn] = buildCandidates({ capsule: {}, applyOptions: {}, resolveOptions: { context: { session } } }, "x").filter((candidate) => candidate.forced);
	assert.deepEqual([turn.key, turn.clerk, turn.bound.npc, turn.bound.trigger], ["npc_act:steven-knott:r2", "npc_act", "steven-knott", "turn"]);
	assert.deepEqual(turn.basis.row.standing_action.action, "attack", "the standing rides as a fact about him, binding nothing");
	for (const word of ["hold", "flee"]) {
		const [held] = buildCandidates({ capsule: {}, applyOptions: {}, resolveOptions: { context: { session: { ...session, standing_action: { action: word, basis: "keeper" } } } } }, "x")
			.filter((candidate) => candidate.forced);
		assert.equal(held.clerk, "npc_act", `${word} no longer hands the turn over unbound`);
	}
	// §138.14's release is gone with the standing attack: an intention under way changes nothing here.
	const capsule = { present: [{ name: "Steven Knott", history: { intents: [{ ref: "intent:steven-knott:aaaaaaaaaaaa", status: "attempted" }] } }] };
	assert.equal(buildCandidates({ capsule, applyOptions: {}, resolveOptions: { context: { session } } }, "x").find((candidate) => candidate.forced).clerk, "npc_act");
	const fighter = { id: "steven-knott", name: "Steven Knott", combat_standing: { action: null, basis: "rule-default" },
		combat_disposition: { disposition: null, basis: null, options: { fights_to_the_end: "x", avoids_fighting: "y" }, material: { agenda: "Rent the house." } } };
	const { standing_action: _standing, ...bare } = session;
	const [inference] = buildCandidates({ capsule: {}, applyOptions: {}, resolveOptions: { context: { session: bare } }, fighter }, "x").filter((candidate) => candidate.forced);
	assert.equal(inference.clerk, "disposition_inference", "the disposition is a description of him, inferred once, before his act");
});

test("§139.3 host marks: only the clerk's npc_act calls carry _generated and what the act brings out; a model-sent mark is removed", () => {
	const effects = () => [{ kind: "npc", name: "Steven Knott", intends: SHOUT, outcome: "attempted", _generated: true, _draws: { weapon: "x" } },
		{ kind: "npc", name: "Steven Knott", intent_ref: "intent:steven-knott:bbbbbbbbbbbb", intent_outcome: "attempted" }, { kind: "threat", name: "t" }];
	const keeper = { effects: effects() };
	markNpcAct("apply", keeper, undefined);
	assert.ok(keeper.effects.every((effect) => effect._generated === undefined && effect._draws === undefined));
	const clerk = { effects: effects() };
	markNpcAct("apply", clerk, { clerk: "npc_act", basis: { draw: { weapon: "revolver_38_or_9mm", price_id: "eq.x" } } });
	assert.deepEqual(clerk.effects.map((effect) => [effect._generated ?? null, effect._draws ?? null]),
		[[true, null], [true, { weapon: "revolver_38_or_9mm", price_id: "eq.x" }], [null, null]]);
	// §139.19: anything else the act brings out rides as _produces, from the basis, on the bare effect only.
	const produced = { effects: [...effects(), { kind: "npc", name: "Steven Knott", _produces: { name: "forged" } }] };
	markNpcAct("apply", produced, { clerk: "npc_act", basis: { produce: { npc: "steven-knott", name: "一张泛黄的全家福", description: GUN } } });
	assert.deepEqual(produced.effects.map((effect) => effect._produces ?? null), [null, { name: "一张泛黄的全家福", description: GUN }, null, { name: "一张泛黄的全家福", description: GUN }]);
	assert.ok(produced.effects.every((effect) => effect._draws === undefined), "a produce basis draws nothing");
	const priced = { effects: effects() };
	markNpcAct("apply", priced, { clerk: "npc_act", basis: { produce: { price_id: "eq.u", description: GUN } } });
	assert.deepEqual(priced.effects[1]._produces, { price_id: "eq.u", description: GUN });
	const forged = { effects: [{ kind: "npc", name: "Steven Knott", _produces: { name: "a gun" } }] };
	markNpcAct("apply", forged, { clerk: "keeper", basis: { produce: { name: "a gun", description: GUN } } });
	assert.equal(forged.effects[0]._produces, undefined, "never from any other call");
	const roll = { action: { actor: "steven-knott", intent_ref: "intent:steven-knott:bbbbbbbbbbbb", _generated: true } };
	markNpcAct("resolve", roll, { clerk: "session_step" });
	assert.equal(roll.action._generated, undefined);
	markNpcAct("resolve", roll, { clerk: "npc_act" });
	assert.equal(roll.action._generated, true);
});

// ---------------------------------------------------------------------------------------------------
// The table: hybrid engine, emitted kernel, the kernel extension's gateway.
// ---------------------------------------------------------------------------------------------------

function kernelSteps(workspace, requests, env = {}) {
	const input = requests.map((request, index) => JSON.stringify({ id: String(index), method: request[0], params: { campaign: CAMPAIGN, ...request[1] } })).join("\n");
	const run = spawnSync(process.execPath, [join(REPO, "build/kernel/rpc.mjs"), "--workspace", workspace, "--content", join(REPO, "content")],
		{ cwd: REPO, input: `${input}\n`, encoding: "utf8", env: { ...process.env, ...env } });
	const frames = run.stdout.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line)).filter((frame) => !frame.progress);
	for (const frame of frames) if (!frame.ok) throw new Error(`fixture step ${frame.id} failed: ${JSON.stringify(frame.error)}`);
	return frames.map((frame) => frame.result);
}
/** Turn 1 pins Knott's numbers and how he fights; turn 2 the punch lands and his defence is none -- it is his turn (seed 1). */
const knottsTurn = (workspace) => {
	const results = kernelSteps(workspace, [
		["table.open", {}], ["table.player_input", { text: "我盯着诺特" }],
		["table.apply", { call_id: "t1-c1", effects: [{ kind: "npc", name: "Steven Knott", archetype: "ordinary_adult", why: "test fixture" }] }],
		["table.apply", { call_id: "t1-c2", effects: [{ kind: "npc", name: "Steven Knott", disposition: "avoids_fighting", why: "test fixture" }] }],
		["table.narrate", { call_id: "t1-c3", text: "诺特从桌后站起来。" }],
		["table.player_input", { text: "我一拳打在他脸上" }],
		["table.resolve", { call_id: "t2-c1", action: { intent: "combat", goal: "hit him", method: "fists", target: "Steven Knott", weapon: "unarmed" } }],
		["table.resolve", { call_id: "t2-c2", action: { intent: "combat", goal: "combat:defend", method: "combat:defend", actor: "Steven Knott", defense: "none" } }],
		["table.narrate", { call_id: "t2-c3", text: "你一拳打中了他。" }],
		["table.look", { focus: "session" }],
	]);
	assert.equal(results.at(-1).session.turn_of, "steven-knott", "seed 1: his turn in the fight");
};
const turnRecord = (table, turn) => JSON.parse(readFileSync(join(table.workspace, ".coc/campaigns", CAMPAIGN, "turns", `${String(turn).padStart(4, "0")}.json`), "utf8"));
const saved = (table, name) => JSON.parse(readFileSync(join(table.workspace, ".coc/campaigns", CAMPAIGN, "save", name), "utf8"));

/** A hybrid table with the fixture generation and a stub Jev: `act` answers the npc-act batch, everything else `otherAnswer`. */
async function actTable(t, { prepareWorkspace, npcAct, act, responses, extra = [] }) {
	const decisions = [];
	const engine = createHybridEngine({ env: {}, npcAct, decision: { decide: async (batch) => {
		decisions.push(batch);
		return batch.family === NPC_ACT_BIND_FAMILY ? actAnswer(batch, act(batch)) : otherAnswer(batch);
	} } });
	const table = await openTable({ realKernel: true, prepareWorkspace, env: { PI_COC_LOOP_ENGINE: "hybrid-v1", COC_KERNEL_SEED: "1" }, runDriver: engine.runDriver,
		extraExtensions: [{ name: "coc-hybrid-engine", factory: engine.extension }, ...extra],
		responses: responses ?? [fauxAssistantMessage([fauxToolCall("narrate", { text: "他朝楼下喊了一声。" })], { stopReason: "toolUse" })] });
	t.after(() => table.dispose());
	return { table, decisions };
}
const npcActRows = (table) => table.telemetry(CAMPAIGN).filter((row) => row.lane === "run" && row.event === "npc_act");

test("§139.3 at the table: Knott's own turn spent on a shout -- a check with spend_turn, the turn passes, every receipt stamped with the act and generated", async (t) => {
	const npcAct = createFixtureNpcActPort({ "steven-knott": SHOUT });
	const { table, decisions } = await actTable(t, { prepareWorkspace: knottsTurn, npcAct, act: () => ({ way: "check" }) });
	await table.session.prompt("我盯着他");
	assert.equal(npcAct.calls.length, 1, "one generation");
	assert.equal(npcAct.calls[0].packet.npc.handle, "steven-knott");
	assert.equal(npcAct.calls[0].play_language, "zh-Hans");
	assert.ok(decisions.some((batch) => batch.family === NPC_ACT_BIND_FAMILY && batch.state.act === SHOUT), "Jev bound the act the generation wrote");
	const receipts = turnRecord(table, 3).receipts;
	const opened = receipts.find((receipt) => receipt.kind === "npc" && receipt.intent?.text === SHOUT);
	assert.ok(opened, "the act opened its row");
	assert.deepEqual([opened.intent.outcome, opened.intent.generated, opened.passes_turn?.turn_of], ["attempted", true, "thomas-hayes"], "spend_turn passed the turn");
	const roll = receipts.find((receipt) => receipt.kind === "roll" && receipt.actor === "steven-knott" && receipt.family !== "stakes");
	assert.ok(roll, "his own check was rolled");
	assert.deepEqual([roll.intent.text, roll.intent.ref, roll.intent.generated], [SHOUT, opened.intent.ref, true]);
	assert.ok(["done", "failed"].includes(roll.intent.outcome), "the roll settled it");
	const [row] = npcActRows(table);
	assert.deepEqual([row.trigger, row.status, row.way, row.passed_turn, row.opened], ["turn", "bound", "check", true, true]);
	assert.equal(saved(table, "combat.json").current_initiative[saved(table, "combat.json").initiative_cursor]?.actor_id, "thomas-hayes", "the fight is on the investigator");
});

test("§139.3 at the table: the same shout Jev cannot settle is the intention alone -- apply npc intends, attempted, no dice", async (t) => {
	const npcAct = createFixtureNpcActPort({ "steven-knott": SHOUT });
	const { table } = await actTable(t, { prepareWorkspace: knottsTurn, npcAct, act: () => ({ way: "unknown" }) });
	await table.session.prompt("我盯着他");
	const receipts = turnRecord(table, 3).receipts;
	const opened = receipts.find((receipt) => receipt.kind === "npc" && receipt.intent?.text === SHOUT);
	assert.deepEqual([opened?.intent.outcome, opened?.intent.generated], ["attempted", true]);
	assert.ok(!receipts.some((receipt) => receipt.kind === "roll" && receipt.actor === "steven-knott" && receipt.family !== "stakes"), "nothing rolled for him (the stakes die of §139.8 is not his check)");
	assert.equal(npcActRows(table)[0].way, "intention_only");
});

/**
 * §139.8 puts `stakes: {rung, outcome, line, surprise, surprise_line}` on the situation packet from a keeper-visible
 * seeded die. These tests pin it instead of depending on what the seed rolls for Knott: the bridge the engine reads
 * through is the kernel extension's, wrapped.
 */
function withStakes(table, { outcome, surprise }) {
	const real = table.runtimeBridges().at(-1);
	assert.ok(real?.call, "the kernel extension published its bridge");
	table.emit("coc:kernel-bridge", { ...real, call: async (method, params) => {
		const result = await real.call(method, params);
		return method === "npc.situation" ? { ...result, stakes: stakesView(outcome, surprise) } : result;
	} });
}
const stakesView = (outcome, surprise) => ({ rung: "dangerous", outcome, line: "This turn, what this person does is more dangerous than anything so far.",
	surprise, surprise_line: surprise ? "This person may have something on them that no one at the table knew they had." : null });
/** §139.19 / ticket 20's acceptance: the pocket pistol (the fixture's `produces`) is the book's .25 Derringer. */
const POCKET = "从内袋摸出一把袖珍手枪指着他。";
const pocketAnswer = () => ({ way: "attack", params: { "attack.weapon": "weapon_drawn" }, produce: (label) => String(label).startsWith(".25 Derringer") });
const worldOf = (table) => JSON.parse(readFileSync(join(table.workspace, ".coc/campaigns", CAMPAIGN, "world.json"), "utf8"));

test("D10 at the table: a surprise lets the act bring out a pocket pistol -- the book's record, drawn where combat reads it, and the same act's attack fires it", async (t) => {
	const npcAct = createFixtureNpcActPort({ "steven-knott": { act: POCKET, produces: PISTOL } });
	const { table, decisions } = await actTable(t, { prepareWorkspace: knottsTurn, npcAct, act: pocketAnswer });
	withStakes(table, { outcome: "escalates", surprise: true });
	await table.session.prompt("我盯着他");
	const binds = decisions.filter((batch) => batch.family === NPC_ACT_BIND_FAMILY);
	assert.equal(binds[0].state.produces, PISTOL, "Jev matched what the generator said he brings out");
	assert.ok(binds[0].questions.some((question) => question.key === "produce_part"), "the 1920s price list is longer than one question: its part first");
	assert.deepEqual(binds[1].questions.map((question) => question.key), ["produce"], "then the record within the part");
	const receipts = turnRecord(table, 3).receipts;
	const drew = receipts.find((receipt) => receipt.kind === "npc" && receipt.draws);
	assert.equal(drew?.draws.weapon_id, "automatic_25_derringer", "the pocket pistol, by its rulebook profile");
	assert.deepEqual([drew.produced.source, drew.produced.name, drew.produced.record], ["catalog", ".25 Derringer (1B)",
		"eq.1920s.weapon_table.table_xvii_handguns.25_derringer_1b"], "produced: the book's record, named as the book names it");
	assert.deepEqual([drew.intent.text, drew.intent.generated], [POCKET, true], "stamped with the act");
	assert.deepEqual(worldOf(table).npc_weapons["steven-knott"].map((weapon) => weapon.weapon_id), ["automatic_25_derringer"], "his holdings, where npcProfileOf reads them");
	const attack = receipts.find((receipt) => receipt.kind === "roll" && receipt.actor === "steven-knott" && receipt.combat_action === "attack");
	assert.ok(attack, "the attack was rolled");
	assert.match(String(attack.skill), /Firearms/, "with the pistol he brought out");
	// The attack waited for the investigator's defence and rolled in that call: the act's stamp waited with it.
	assert.deepEqual([attack.intent?.text, attack.intent?.ref, attack.intent?.generated], [POCKET, drew.intent.ref, true]);
	assert.ok(["done", "failed"].includes(attack.intent.outcome), "the roll settled it");
	const [row] = npcActRows(table);
	assert.deepEqual([row.produces, row.produced, row.draw, row.produces_dropped], [PISTOL,
		{ name: ".25 Derringer (1B)", source: "catalog", record: "eq.1920s.weapon_table.table_xvii_handguns.25_derringer_1b" }, "automatic_25_derringer", undefined]);
});

test("D10 at the table: a produces with no surprise is dropped -- no produce question, nothing drawn or placed, produces_dropped on the row, the attack his own fists", async (t) => {
	const npcAct = createFixtureNpcActPort({ "steven-knott": { act: POCKET, produces: PISTOL } });
	const { table, decisions } = await actTable(t, { prepareWorkspace: knottsTurn, npcAct, act: pocketAnswer });
	withStakes(table, { outcome: "severe", surprise: false });
	await table.session.prompt("我盯着他");
	assert.equal(npcAct.calls.length, 1, "not asked again");
	const binds = decisions.filter((batch) => batch.family === NPC_ACT_BIND_FAMILY);
	assert.equal(binds.length, 1, "one batch: no record to look for");
	assert.ok(!binds[0].questions.some((question) => ["produce", "produce_part", "attack.weapon"].includes(question.key)),
		"no produce question, and one weapon is no question");
	assert.equal(binds[0].state.produces, undefined);
	const receipts = turnRecord(table, 3).receipts;
	assert.ok(!receipts.some((receipt) => receipt.draws || receipt.produced), "nothing brought out");
	assert.equal(worldOf(table).npc_weapons, undefined);
	assert.deepEqual(Object.keys(worldOf(table).objects?.instances ?? {}), [], "and no object placed");
	const attack = receipts.find((receipt) => receipt.kind === "roll" && receipt.actor === "steven-knott" && receipt.combat_action === "attack");
	assert.match(String(attack?.skill), /Fighting/, "unarmed");
	const [row] = npcActRows(table);
	assert.deepEqual([row.status, row.produces_dropped, row.produces, row.produced], ["bound", true, undefined, null]);
});

/** Turn 1 walked into the morgue and met Arty (the city editor); Knott came along and stands there too. */
const MORGUE = "newspaper-morgue";
const metArtyWithKnott = (workspace) => kernelSteps(workspace, [
	["table.open", {}], ["table.player_input", { text: "我去《环球报》报馆" }],
	["table.apply", { call_id: "t1-c1", effects: [{ kind: "move", to: MORGUE }] }],
	["table.apply", { call_id: "t1-c2", effects: [{ kind: "person", who: "Arty Wilmot", name: "城市版编辑" }] }],
	["table.apply", { call_id: "t1-c3", effects: [{ kind: "npc", name: "Steven Knott", to: "here", why: "test fixture: he came along" }] }],
	["table.narrate", { call_id: "t1-c4", text: "城市版编辑挡在剪报室门口，诺特站在一旁。" }],
]);
/**
 * Gate #4 turn 2's answers (single-loop-one-check): the compile reads the gatekeeper's demand, Arty and `social`; the
 * obligation check binds Persuade; every route finishes. The act's batch answers `act`.
 */
function morgueJev(act) {
	const arty = (question) => aliasWhere(question, (value) => JSON.stringify(value).includes("城市版编辑") || JSON.stringify(value).includes("Arty"));
	const social = (question) => aliasWhere(question, (value) => typeof value === "string" && value.startsWith("social"));
	return (batch) => {
		if (batch.family === NPC_ACT_BIND_FAMILY) return actAnswer(batch, act(batch));
		if (batch.family === COMPILE_FAMILY) return complete(batch, Object.fromEntries(batch.questions.map((question) => [question.key, choice(
			/^ask_\d+$/.test(question.key) ? (JSON.stringify(question.target).includes("demand") ? "yes" : "no")
				: question.key === "addressee" ? arty(question) ?? "unclear" : question.key === "act" ? social(question) ?? "unclear" : question.key === "destination" ? "none" : "unclear")])));
		if (batch.family === "single-loop-bind") return complete(batch, Object.fromEntries(batch.questions.map((question) => [question.key,
			choice(({ skill: "Persuade", bonus: "none", penalty: "none", intent: "social" })[question.key] ?? "unknown")])));
		return otherAnswer(batch);
	};
}

test("§139.4 at the table: after the clerk carried out the declaration, the person it acted on acts before the Keeper's step; the one it did not act on does not", async (t) => {
	const npcAct = createFixtureNpcActPort({ "*": "他把一叠旧剪报推到你面前。" });
	const decide = morgueJev(() => ({ way: "intention_only" }));
	const engine = createHybridEngine({ env: {}, npcAct, decision: { decide: async (batch) => decide(batch) } });
	const table = await openTable({ realKernel: true, prepareWorkspace: metArtyWithKnott, env: { PI_COC_LOOP_ENGINE: "hybrid-v1", COC_KERNEL_SEED: "4" },
		runDriver: engine.runDriver, extraExtensions: [{ name: "coc-hybrid-engine", factory: engine.extension }],
		responses: [fauxAssistantMessage([fauxToolCall("narrate", { text: "编辑松了口。" })], { stopReason: "toolUse" })] });
	t.after(() => table.dispose());
	await table.session.prompt("我说明来意，请他帮忙调出科比特宅这些年的旧剪报。");
	const telemetry = table.telemetry(CAMPAIGN);
	assert.ok(telemetry.some((row) => row.tool === "resolve" && row.origin === "policy" && row.ok), "the clerk rolled the gatekeeper's check");
	assert.deepEqual(npcAct.calls.map((call) => call.packet.npc.name), ["Arty Wilmot"], "the person the check was made against acts; Knott, beside him, does not");
	const rows = npcActRows(table);
	assert.deepEqual(rows.map((row) => [row.trigger, row.status, row.way]), [["acted_on", "bound", "intention_only"]]);
	const receipts = turnRecord(table, 2).receipts;
	const act = receipts.find((receipt) => receipt.kind === "npc" && receipt.intent?.generated === true);
	assert.equal(act?.intent.text, "他把一叠旧剪报推到你面前。");
	assert.ok(!receipts.some((receipt) => receipt.intent?.npc === "steven-knott"));
	const scan = telemetry.findIndex((row) => row.lane === "run" && row.event === "npc_act");
	const compose = telemetry.findIndex((row) => row.lane === "run" && row.type === "step_start" && row.kind === "infer");
	assert.ok(scan >= 0 && (compose < 0 || scan < compose), "before the Keeper's model step");
});

// ---------------------------------------------------------------------------------------------------
// The engine on the emitted kernel. The gateway is a thin forwarder that applies the kernel extension's own host marks
// (`markNpcAct`, the function `runTool` calls) and hands the call to the kernel under a minted call id; the table
// tests above run the same writes through the extension itself.
// ---------------------------------------------------------------------------------------------------

function kernelProcess(t, workspace, env) {
	const child = spawn(process.execPath, [join(REPO, "build/kernel/rpc.mjs"), "--workspace", workspace, "--content", join(REPO, "content")],
		{ cwd: REPO, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ...env } });
	const waiting = new Map();
	let id = 0;
	createInterface({ input: child.stdout }).on("line", (line) => {
		if (!line.trim()) return;
		const frame = JSON.parse(line);
		if (frame.progress) return;
		waiting.get(frame.id)?.(frame);
		waiting.delete(frame.id);
	});
	t.after(async () => {
		child.stdin.end();
		await new Promise((resolve) => (child.exitCode !== null ? resolve() : child.once("exit", resolve)));
	});
	return (method, params = {}) => new Promise((resolve, reject) => {
		const key = String(++id);
		waiting.set(key, (frame) => {
			if (frame.ok) return resolve(frame.result);
			const error = new Error(`${method}: ${frame.error?.code} ${frame.error?.message}`);
			error.code = frame.error?.code; error.details = frame.error?.details;
			reject(error);
		});
		child.stdin.write(`${JSON.stringify({ id: key, method, params: { campaign: CAMPAIGN, ...params } })}\n`);
	});
}

/**
 * A campaign on the emitted kernel and the engine over it. `game.say` opens a turn, `game.write` mints the next call id
 * of the turn, `game.run(candidate)` is one run: the read, then the candidate executed as the clerk's step.
 */
async function seam(t, { npcAct, act, seed = "1", prepare, stakes }) {
	const workspace = mkdtempSync(join(tmpdir(), "npc-act-seam-"));
	t.after(() => rmSync(workspace, { recursive: true, force: true }));
	createRealCampaign(workspace, CAMPAIGN);
	// A state put in place by the kernel's own RPC in a process of its own, before the engine's kernel starts.
	if (prepare) prepare(workspace);
	const call = kernelProcess(t, workspace, { COC_KERNEL_SEED: seed });
	const rows = [], decisions = [];
	const game = { call, rows, decisions, turn: 0, ordinal: 0, workspace };
	if (prepare) { game.turn = (await call("table.status")).turn; game.ordinal = 40; }
	game.say = async (text) => { const opened = await call("table.player_input", { text }); game.turn = opened.turn ?? game.turn + 1; game.ordinal = 0; return opened; };
	game.write = (method, params) => call(method, { call_id: `t${game.turn}-c${++game.ordinal}`, ...params });
	game.close = (text = "……") => game.write("table.narrate", { text });
	game.receipts = async () => (await call("table.status")).receipts;
	const engine = createHybridEngine({ env: {}, npcAct, record: (row) => rows.push(row), decision: { decide: async (batch) => {
		decisions.push(batch);
		return batch.family === NPC_ACT_BIND_FAMILY ? actAnswer(batch, act(batch, decisions)) : otherAnswer(batch);
	} } });
	const handlers = new Map(), bus = { on: (name, handler) => handlers.set(name, handler), emit: (name, value) => handlers.get(name)?.(value) };
	engine.extension({ events: bus, on: () => {}, getActiveTools: () => [], setActiveTools: () => {} });
	// `stakes` pins the situation's stakes die (§139.8, §139.19) instead of the seed's roll, as `withStakes` does at the table.
	bus.emit("coc:kernel-bridge", { campaign: CAMPAIGN, call: async (method, params) => {
		const result = await call(method, params);
		return stakes !== undefined && method === "npc.situation" ? { ...result, stakes } : result;
	} });
	bus.emit("coc:operation-dispatcher", { dispatch: async (operation, context) => {
		const args = structuredClone(operation.args);
		markNpcAct(operation.operation, args, context.origin);
		const callId = `t${game.turn}-c${++game.ordinal}`;
		await context.journal.save({ operationId: operation.id, taskId: operation.taskId, signature: "", callId });
		try {
			const result = await call(`table.${operation.operation}`, { ...args, call_id: callId });
			return { status: "succeeded", receipts: [...(result.receipts ?? []), ...(result.receipt ? [result.receipt] : [])], result };
		} catch (error) {
			return { status: "refused", receipts: [], result: { coc_error: { code: error.code, message: error.message, details: error.details } } };
		}
	} });
	let runs = 0;
	game.run = async (candidate) => {
		const runId = `run-${++runs}`, signal = new AbortController().signal;
		const plan = engine.runDriver.prepare({ runId, inputRevision: "rev", rawInput: "x", session: {} });
		const invocation = (step) => ({ runId, stepId: `${runId}:${step}`, operationId: `${runId}:${step}/op1`, origin: "policy", inputRevision: "rev", scopeId: "root", signal });
		await plan.ports.read.read({ origin: "policy", operation: "read", readOnly: true }, invocation("s1"));
		return plan.ports.operations.execute({ origin: "policy", operation: "execute", params: { candidate, extra: {} } }, invocation("s2"));
	};
	return game;
}
/** The out-of-fight trigger as the policy issues it (the scan), with the people the compile read as addressed. */
const scan = (addressees = []) => npcScanCandidate(0, ["resolve:x"], addressees);
const acts = (game) => game.rows.filter((row) => row.lane === "run" && row.event === "npc_act");

test("§139.4 cap: three people acted on outside a fight -- two act, the third is recorded skipped_cap; the one nobody acted on is never asked", async (t) => {
	const npcAct = createFixtureNpcActPort({ "*": "他往后退了一步，盯着你的手。" });
	const game = await seam(t, { npcAct, act: () => ({ way: "intention_only" }) });
	await call0(game);
	const people = ["Edna Hale", "Silas Pike", "Tobias Crane"];
	await game.say("我环顾办公室里的人。");
	for (const name of people) await game.write("table.apply", { effects: [{ kind: "npc", name, to: "here", why: "test fixture: a visitor" }] });
	// Money changes hands with three of them this turn (Knott, Edna Hale, Silas Pike); Tobias Crane is left alone.
	for (const name of ["Steven Knott", "Edna Hale", "Silas Pike"])
		await game.write("table.apply", { effects: [{ kind: "cash", subject: "Thomas Hayes", delta: 1, source: "found", with: name, why: "a coin changes hands" }] });
	await game.run(scan());
	const rows = acts(game);
	assert.equal(rows.filter((row) => row.status === "bound").length, 2, "the cap: npc_act.max_per_turn is 2");
	const skipped = rows.filter((row) => row.status === "skipped_cap");
	assert.equal(skipped.length, 1, "the third one acted on is recorded, not run");
	assert.equal(npcAct.calls.length, 2);
	const named = rows.map((row) => row.npc);
	assert.ok(!named.some((npc) => /tobias/i.test(String(npc))), `the person nobody acted on is never run nor skipped: ${named}`);
	assert.equal(new Set(named).size, 3);
	assert.ok(skipped[0].acted_on.some((entry) => entry.kind === "cash"), "the skip row says what acted on them");
});
/** Turn 1 closed: the table is open and Knott is at the office with a stat block. */
async function call0(game) {
	await game.call("table.open");
	await game.say("我走进诺特的办公室。");
	await game.write("table.apply", { effects: [{ kind: "npc", name: "Steven Knott", archetype: "ordinary_adult", why: "test fixture" }] });
	await game.close("诺特坐在桌后。");
}

/**
 * Seed 1: the punch lands, Knott hits back, the investigator dodges and then flees -- the fight ends `fled`. Ticket 10
 * (§139.9, in flight on its own branch) stops the old engine from starting a chase for the investigators on that flight;
 * until it lands here, the chase the old engine started is removed from the save (the only file this test touches), so
 * the state is the one ticket 10 leaves: the investigator fled this turn and no chase runs.
 */
const fledFromKnott = (workspace) => {
	kernelSteps(workspace, [
		["table.open", {}], ["table.player_input", { text: "我走进诺特的办公室。" }],
		["table.apply", { call_id: "t1-c1", effects: [{ kind: "npc", name: "Steven Knott", archetype: "ordinary_adult", why: "test fixture" }] }],
		["table.narrate", { call_id: "t1-c2", text: "诺特坐在桌后。" }],
		["table.player_input", { text: "我揍他一拳，然后夺门而出" }],
		["table.resolve", { call_id: "t2-c1", action: { intent: "combat", goal: "hit", method: "fists", target: "Steven Knott", weapon: "unarmed" } }],
		["table.resolve", { call_id: "t2-c2", action: { intent: "combat", goal: "combat:defend", method: "combat:defend", actor: "Steven Knott", defense: "none" } }],
		["table.resolve", { call_id: "t2-c3", action: { intent: "combat", goal: "hit back", method: "fists", actor: "Steven Knott", target: "Thomas Hayes", weapon: "unarmed" } }],
		["table.resolve", { call_id: "t2-c4", action: { intent: "combat", goal: "combat:defend", method: "combat:defend", actor: "Thomas Hayes", defense: "dodge" } }],
		["table.resolve", { call_id: "t2-c5", action: { intent: "flee", decision: "combat:flee", goal: "run", method: "run for the door" } }],
	], { COC_KERNEL_SEED: "1" });
	rmSync(join(workspace, ".coc/campaigns", CAMPAIGN, "save", "chase.json"), { force: true });
};

test("ticket 03 pursuit: the investigator fled -- 'goes after him' and Jev's pursue start a chase with Knott as the pursuer", async (t) => {
	const npcAct = createFixtureNpcActPort({ "steven-knott": "他追出门去。" });
	const game = await seam(t, { npcAct, prepare: fledFromKnott, act: (batch) => {
		assert.ok(Object.keys(batch.questions[0].criteria).includes("pursue"), "pursue is offered: he was fled from and no chase runs");
		return { way: "pursue" };
	} });
	await game.run(scan());
	const [row] = acts(game);
	assert.deepEqual([row.trigger, row.status, row.way, row.params.target], ["acted_on", "bound", "pursue", "thomas-hayes"]);
	const receipts = await game.receipts();
	const pursuit = receipts.filter((receipt) => row.calls.some((entry) => entry.call_id === receipt.call_id));
	assert.ok(pursuit.some((receipt) => receipt.kind === "session" && String(receipt.id).startsWith("session:chase-start")), "his chase started");
	assert.ok(pursuit.some((receipt) => receipt.intent?.text === "他追出门去。" && receipt.intent.generated === true), "and it is his act's result");
	const chase = JSON.parse(readFileSync(join(game.workspace, ".coc/campaigns", CAMPAIGN, "save", "chase.json"), "utf8"));
	assert.ok(chase.participants.some((participant) => participant.actor_id === "steven-knott"), "Knott is in the chase");
});

test("ticket 03 pursuit: 'stands behind the desk and watches him go' starts no chase", async (t) => {
	const npcAct = createFixtureNpcActPort({ "steven-knott": "他站在桌后，看着你走。" });
	const game = await seam(t, { npcAct, prepare: fledFromKnott, act: () => ({ way: "intention_only" }) });
	await game.run(scan());
	assert.deepEqual(acts(game).map((row) => row.way), ["intention_only"]);
	const receipts = await game.receipts();
	assert.ok(!receipts.some((receipt) => receipt.kind === "session" && String(receipt.id).startsWith("session:chase-start") && receipt.call_id !== "t2-c5"),
		"no chase but the one the old engine started on the flight itself");
	assert.equal((await game.call("table.look", { focus: "session" })).session, null);
});

// ---------------------------------------------------------------------------------------------------
// Ticket 04 (§139.5): the two no-repeat gates, across turns.
// ---------------------------------------------------------------------------------------------------

const CALL = "他大喊要叫警察来。", AGAIN = "他说你再不走他就叫警察。", STILL = "他说他这次真的要叫警察了。", SIT = "他坐回椅子上，不再说话。";
/** One turn outside a fight: the player speaks to Knott (the compile's addressee), he acts, the Keeper closes the turn. */
async function spokenTo(game, text = "我看着诺特。") {
	await game.say(text);
	await game.run(scan(["Steven Knott"]));
	// §138.7: the first delivery that owes an intention's result is refused once; the second is delivered.
	await game.close().catch(() => game.close());
}
const knottActs = (game) => acts(game).filter((row) => row.npc === "steven-knott");
const doneOf = (call) => call.packet.done.map((row) => [row.intent, row.status]);

test("§139.5 semantic gate: the same thing again with no result is re-asked once; the same thing a second time is that row continued and abandoned", async (t) => {
	const npcAct = createFixtureNpcActPort({ "steven-knott": [CALL, AGAIN, STILL, SIT] });
	const game = await seam(t, { npcAct, act: (batch) => ({ way: "intention_only",
		same: batch.questions.some((question) => question.key === "same") && [AGAIN, STILL].includes(batch.state.act) ? (row) => row.intent === CALL : "none" }) });
	await call0(game);
	await spokenTo(game);
	const first = knottActs(game).at(-1);
	assert.deepEqual([first.opened, first.reask, first.continued], [true, false, null]);
	await spokenTo(game, "我不理他，继续翻抽屉。");
	assert.equal(npcAct.calls.length, 3, "turn 3 asked the generator twice: the act, then once more");
	const [asked, reasked] = npcAct.calls.slice(1);
	assert.equal(reasked.packet.happened.length, asked.packet.happened.length + 1, "the re-ask's packet names the row with no result");
	assert.ok(reasked.packet.happened.at(-1).includes(CALL));
	const second = knottActs(game).at(-1);
	assert.deepEqual([second.reask, second.opened, second.continued], [true, false, first.ref], "bound as that row continued");
	await spokenTo(game, "我把抽屉关上。");
	const rows = doneOf(npcAct.calls[3]);
	assert.deepEqual(rows.find(([intent]) => intent === CALL), [CALL, "abandoned"], "the next turn's packet: no longer under way");
	assert.ok(!rows.some(([intent]) => intent === AGAIN || intent === STILL), "the repeats opened no rows of their own");
	assert.equal(second.abandoned, first.ref, "the act's row names the row it abandoned");
});

test("§139.5 semantic gate: Jev reads the act as none of the rows -- each act is its own row, and nothing is asked twice", async (t) => {
	const npcAct = createFixtureNpcActPort({ "steven-knott": [CALL, SIT] });
	const game = await seam(t, { npcAct, act: () => ({ way: "intention_only", same: "none" }) });
	await call0(game);
	await spokenTo(game);
	await spokenTo(game, "我不理他。");
	assert.equal(npcAct.calls.length, 2, "one generation a turn");
	assert.deepEqual(knottActs(game).map((row) => [row.opened, row.reask]), [[true, false], [true, false]]);
	const situation = await game.call("npc.situation", { name: "Steven Knott" });
	assert.deepEqual(situation.done.map((row) => row.intent).sort(), [CALL, SIT].sort(), "both registered");
});

test("§139.5 semantic gate: the same thing as a row already settled is a new row -- done again in a new situation, not asked again", async (t) => {
	const npcAct = createFixtureNpcActPort({ "steven-knott": [CALL, AGAIN] });
	const game = await seam(t, { npcAct, act: (batch) => ({ way: "intention_only", same: batch.state.act === AGAIN ? (row) => row.intent === CALL : "none" }) });
	await call0(game);
	await game.say("我看着诺特。");
	await game.run(scan(["Steven Knott"]));
	const ref = knottActs(game).at(-1).ref;
	// §139.14: the table's act is settled by the dice (here the Keeper's roll for him), not by saying it failed.
	await game.write("table.resolve", { action: { actor: "Steven Knott", intent: "investigate", skill: "Listen", goal: "listen for the constable", method: "listen", intent_ref: ref } });
	assert.ok((await game.receipts()).some((receipt) => receipt.kind === "roll" && receipt.intent?.ref === ref && ["done", "failed"].includes(receipt.intent.outcome)));
	await game.close();
	await spokenTo(game, "我不理他。");
	assert.equal(npcAct.calls.length, 2, "no re-ask");
	const last = knottActs(game).at(-1);
	assert.deepEqual([last.opened, last.reask, last.continued], [true, false, null]);
	assert.notEqual(last.ref, ref);
});

test("§139.5 structural gate: the very line of a row under way is that row continued -- no new row, no semantic question; nothing settles it, so it is abandoned (the owed linkage)", async (t) => {
	const npcAct = createFixtureNpcActPort({ "steven-knott": [CALL, CALL] });
	const game = await seam(t, { npcAct, act: () => ({ way: "intention_only" }) });
	await call0(game);
	await spokenTo(game);
	const ref = knottActs(game).at(-1).ref;
	await spokenTo(game, "我不理他。");
	const binds = game.decisions.filter((batch) => batch.family === NPC_ACT_BIND_FAMILY);
	assert.ok(!binds.at(-1).questions.some((question) => question.key === "same"), "the structural gate answered it");
	const last = knottActs(game).at(-1);
	assert.deepEqual([last.opened, last.continued, last.abandoned, last.reask], [false, ref, ref, false]);
	const situation = await game.call("npc.situation", { name: "Steven Knott" });
	assert.deepEqual(situation.done.map((row) => [row.ref, row.status]), [[ref, "abandoned"]]);
});

test("§139.5: the same line as a settled row is a new attempt -- a new line (the turn appended), never a refusal", async (t) => {
	const npcAct = createFixtureNpcActPort({ "steven-knott": [CALL, CALL] });
	const game = await seam(t, { npcAct, act: () => ({ way: "intention_only" }) });
	await call0(game);
	await game.say("我看着诺特。");
	await game.run(scan(["Steven Knott"]));
	const ref = knottActs(game).at(-1).ref;
	// §139.14: an arrival settles the table's act (the §138.2 addendum's shape); saying it was done would be refused.
	await game.write("table.apply", { effects: [{ kind: "npc", name: "the porter", to: "here", intent_ref: ref, why: "the porter came up at the shout" }] });
	await game.close();
	await spokenTo(game, "我不理他。");
	const last = knottActs(game).at(-1);
	assert.deepEqual([last.status, last.opened], ["bound", true]);
	const situation = await game.call("npc.situation", { name: "Steven Knott" });
	assert.ok(situation.done.some((row) => row.intent.startsWith(CALL) && row.intent !== CALL && row.status === "attempted"), JSON.stringify(situation.done));
});

// ---------------------------------------------------------------------------------------------------
// Ticket 15 (§139.14): a threat is one thread -- the same purpose in other hands is the same thing, and only a result
// or giving it up ends it. Live table C3: lift the receiver, press it down, shout over it, hold it up between them.
// ---------------------------------------------------------------------------------------------------

const LIFT = "他一把抓起电话听筒，拇指压在叉簧上，盯着你。", PRESS = "他把听筒死死按在电话机上，另一只手挡在身前。";
const SHOUT_OVER = "他攥着听筒冲你喊：再碰我一下这电话就摇到巡警那儿去。", HOLD_UP = "他把听筒举在你们之间挡着，另一只手按在电话机边上。";
const DOOR = "他绕过桌子，去拉开办公室的门。";
/** Jev's fixture: every telephone act is the same thing as the first telephone row; anything else is none. */
const phoneJev = (phones, settled = {}) => (batch) => ({ way: settled[batch.state.act] ?? "intention_only",
	same: batch.questions.some((question) => question.key === "same") && phones.includes(batch.state.act) ? (row) => row.intent === LIFT : "none" });
const turnReceipts = (game, turn) => JSON.parse(readFileSync(join(game.workspace, ".coc/campaigns", CAMPAIGN, "turns", `${String(turn).padStart(4, "0")}.json`), "utf8")).receipts;

test("§139.14: the same purpose in other hands -- re-asked once ('twice without doing it'), then given up; the next packet says so, the same thing held up again opens no row, and a different purpose opens normally", async (t) => {
	const npcAct = createFixtureNpcActPort({ "steven-knott": [LIFT, PRESS, SHOUT_OVER, HOLD_UP, DOOR] });
	const game = await seam(t, { npcAct, act: phoneJev([PRESS, SHOUT_OVER, HOLD_UP]) });
	await call0(game);
	await spokenTo(game);
	const lifted = knottActs(game).at(-1);
	assert.deepEqual([lifted.status, lifted.opened, lifted.reask], ["bound", true, false], "turn 2: the first telephone act opens its row");
	// Turn 3: other hands, the same purpose. Jev reads it by purpose (the question asks it); the generator is asked once more.
	await spokenTo(game, "我不理他，继续翻抽屉。");
	assert.equal(npcAct.calls.length, 3, "turn 3 generated twice: the act, then the re-ask");
	const same = game.decisions.filter((batch) => batch.family === NPC_ACT_BIND_FAMILY && batch.state.act === PRESS)[0].questions.find((question) => question.key === "same");
	assert.match(same.instructions, /same purpose, whatever the hands do/);
	const reasked = npcAct.calls[2].packet.happened.at(-1);
	assert.ok(reasked.includes(LIFT) && /twice without doing it/.test(reasked) && /either does it, or drops it/.test(reasked), reasked);
	const gaveUp = knottActs(game).at(-1);
	assert.deepEqual([gaveUp.reask, gaveUp.opened, gaveUp.continued, gaveUp.abandoned], [true, false, lifted.ref, lifted.ref], "the second repeat gives the row up");
	const abandonment = turnReceipts(game, 3).find((receipt) => receipt.intent?.ref === lifted.ref);
	assert.deepEqual([abandonment?.intent.outcome, abandonment?.why, abandonment?.intent.generated], ["abandoned", "repeated", true]);
	// Turn 4: the packet says he gave it up; the telephone held up again is dropped -- not asked again, no row.
	await spokenTo(game, "我把抽屉关上。");
	const fourth = npcAct.calls[3].packet;
	assert.deepEqual(doneOf(npcAct.calls[3]), [[LIFT, "abandoned"]], "the one telephone row, given up; no row for the other hands");
	assert.ok(fourth.happened.some((line) => line === `turn 3: Steven Knott gave up "${LIFT}" without doing it (why: repeated)`), JSON.stringify(fourth.happened));
	assert.equal(npcAct.calls.length, 4, "a thread just given up is not asked about again");
	const dropped = knottActs(game).at(-1);
	assert.deepEqual([dropped.status, dropped.act, dropped.dropped, dropped.opened, dropped.receipts], ["dropped", HOLD_UP, lifted.ref, false, []]);
	assert.ok(!turnReceipts(game, 4).some((receipt) => receipt.intent?.npc === "steven-knott"), "nothing written for him on turn 4");
	// Turn 5: something else entirely opens its own row.
	await spokenTo(game, "我盯着他。");
	const door = knottActs(game).at(-1);
	assert.deepEqual([door.status, door.act, door.opened, door.reask], ["bound", DOOR, true, false]);
	const situation = await game.call("npc.situation", { name: "Steven Knott" });
	assert.deepEqual(situation.done.map((row) => [row.intent, row.status]), [[DOOR, "attempted"], [LIFT, "abandoned"]],
		"one telephone row, given up; no row for any of the other hands; the door is its own");
});

test("§139.14: announced, then done -- the same purpose bound to a way that settles it is that row, and the roll gives it its result (no re-ask, no new row)", async (t) => {
	const RING = "他抓起听筒，真的摇起了电话找接线员。";
	const npcAct = createFixtureNpcActPort({ "steven-knott": [LIFT, RING] });
	const game = await seam(t, { npcAct, act: phoneJev([RING], { [RING]: "check" }) });
	await call0(game);
	await spokenTo(game);
	const lifted = knottActs(game).at(-1);
	await spokenTo(game, "我不理他。");
	assert.equal(npcAct.calls.length, 2, "doing it is not asked again");
	const rang = knottActs(game).at(-1);
	assert.deepEqual([rang.way, rang.opened, rang.continued, rang.reask], ["check", false, lifted.ref, false]);
	const roll = turnReceipts(game, 3).find((receipt) => receipt.kind === "roll" && receipt.intent?.ref === lifted.ref);
	assert.ok(roll && ["done", "failed"].includes(roll.intent.outcome) && roll.intent.generated === true, "the dice settled the telephone row");
	const situation = await game.call("npc.situation", { name: "Steven Knott" });
	assert.deepEqual(situation.done.map((row) => row.intent), [LIFT], "one thread: announcing it and doing it are the same row");
});

test("§139.14 at the table's kernel: the Keeper cannot make the table's act done by saying so; abandoning it stands, and the packet says he gave it up", async (t) => {
	const npcAct = createFixtureNpcActPort({ "steven-knott": LIFT });
	const game = await seam(t, { npcAct, act: () => ({ way: "intention_only" }) });
	await call0(game);
	await game.say("我看着诺特。");
	await game.run(scan(["Steven Knott"]));
	const { ref } = knottActs(game).at(-1);
	await assert.rejects(game.write("table.apply", { effects: [{ kind: "npc", name: "Steven Knott", intent_ref: ref, intent_outcome: "done", why: "he threatened" }] }),
		(error) => error.code === "invalid_params" && error.details?.reason === "table_act_unsettled");
	await game.write("table.apply", { effects: [{ kind: "npc", name: "Steven Knott", intent_ref: ref, intent_outcome: "abandoned", why: "he puts the receiver down" }] });
	const situation = await game.call("npc.situation", { name: "Steven Knott" });
	assert.deepEqual(situation.done.map((row) => [row.ref, row.status, row.by]), [[ref, "abandoned", "table"]]);
	assert.ok(situation.happened.some((line) => line.includes(`gave up "${LIFT}"`) && line.includes("(why: he puts the receiver down)")), JSON.stringify(situation.happened));
});

test("§139.14 step: a dropped act writes nothing and hands the Keeper no line -- the act was not done; the telemetry row keeps it", async () => {
	const given = { ref: "intent:steven-knott:aaaaaaaaaaaa", intent: LIFT, status: "abandoned", since_turn: 2, turn: 3 };
	const rows = [], writes = [];
	const deps = {
		call: async (method, params) => method === "npc.situation"
			? { npc: { handle: "steven-knott", name: "Steven Knott" }, happened: [], state: {}, at_hand: {}, done: [given] }
			: method === "npc.act.options"
				? { npc: { handle: "steven-knott", name: "Steven Knott" }, play_language: "zh-Hans", place: "commission-briefing", in_session: false, my_turn: false,
					acted_on: [], ways: [{ way: "intention_only", params: {} }], ...(params.act ? { act: { line: params.act, ref: "intent:steven-knott:dddddddddddd", continues: null } } : {}) }
				: {},
		generate: async () => ({ act: HOLD_UP }),
		decide: async (batch) => actAnswer(batch, { way: "intention_only", same: (row) => row.intent === LIFT }),
		write: async (call) => { writes.push(call); return { ok: true, callId: "x", receipts: [], status: "succeeded" }; },
		record: (row) => rows.push(row), scope, readSet: [], runId: "r", stepId: "r:s1", turn: 4, gate: 0.6,
		budget: { timeoutMs: 8000, maxPerTurn: 2, sameActRows: 5 }, signal: new AbortController().signal,
	};
	const outcome = await runNpcAct(deps, "Steven Knott", "acted_on");
	assert.deepEqual([outcome.status, outcome.act, outcome.droppedAct, outcome.dropped, outcome.reason], ["dropped", undefined, HOLD_UP, given.ref, "repeats_given_up"]);
	assert.deepEqual(writes, [], "nothing written");
	const row = rows.find((entry) => entry.event === "npc_act");
	assert.deepEqual([row.status, row.act, row.dropped, row.opened], ["dropped", HOLD_UP, given.ref, false]);
	// Something of theirs set out after the row was given up: it is no longer the thread just put down -- a new row.
	const later = await runNpcAct({ ...deps, call: async (method, params) => method === "npc.situation"
		? { ...(await deps.call(method, params)), done: [{ ref: "intent:steven-knott:eeeeeeeeeeee", intent: DOOR, status: "attempted", since_turn: 4, turn: 4 }, given] }
		: deps.call(method, params) }, "Steven Knott", "acted_on");
	assert.deepEqual([later.status, later.opened], ["bound", true]);
});

// ---------------------------------------------------------------------------------------------------
// Ticket 20 (§139.19): a thing of the table's own, brought out on a surprise, is his from the next turn on.
// ---------------------------------------------------------------------------------------------------

const PHOTO = "一张泛黄的全家福", SHOW = "他从上衣内袋摸出一张泛黄的全家福，举到你眼前。", QUIET = "他把照片攥在胸前，一句话也不说。";

test("§139.19: a surprise, a produces no record of the book is -- Jev says none, one object of the table's own is placed in his hands, with no number, and the next turn's packet holds it", async (t) => {
	const npcAct = createFixtureNpcActPort({ "steven-knott": [{ act: SHOW, produces: PHOTO }, QUIET] });
	const game = await seam(t, { npcAct, stakes: stakesView("escalates", true), act: () => ({ way: "intention_only", produce: "none" }) });
	await call0(game);
	await spokenTo(game);
	const binds = game.decisions.filter((batch) => batch.family === NPC_ACT_BIND_FAMILY);
	assert.equal(binds[0].state.produces, PHOTO);
	assert.equal(binds.length, 1, "none of the parts: no second batch");
	const shown = knottActs(game).at(-1);
	assert.deepEqual([shown.status, shown.way, shown.produces, shown.produced], ["bound", "intention_only", PHOTO, { name: PHOTO, source: "table" }]);
	const receipts = turnReceipts(game, 2);
	const placed = receipts.find((receipt) => receipt.produced);
	assert.deepEqual(placed?.produced, { name: PHOTO, source: "table" }, "produced: the table's own");
	assert.deepEqual([placed.intent?.text, placed.intent?.generated, placed.intent?.outcome], [SHOW, true, "attempted"], "stamped with the act");
	const world = JSON.parse(readFileSync(join(game.workspace, ".coc/campaigns", CAMPAIGN, "world.json"), "utf8"));
	const item = world.objects.instances[placed.instance];
	assert.deepEqual([item.name, item.owner.kind, item.owner.id], [PHOTO, "npc", "steven-knott"], "an object of his, in the registry the Keeper's objects live in");
	const definition = world.objects.definitions[item.definition];
	assert.deepEqual([definition.parameters, definition.traits, definition.description], [{ effects: [] }, [], SHOW], "no number; described by the act");
	assert.equal(world.npc_weapons, undefined, "nothing drawn");
	// The next turn: the generator's own packet holds it.
	await spokenTo(game, "我盯着那张照片。");
	assert.equal(npcAct.calls.length, 2);
	assert.ok(npcAct.calls[1].packet.at_hand.holdings.includes(PHOTO), JSON.stringify(npcAct.calls[1].packet.at_hand));
	assert.ok(!npcAct.calls[0].packet.at_hand.holdings.includes(PHOTO), "and it was not there before he brought it out");
});
