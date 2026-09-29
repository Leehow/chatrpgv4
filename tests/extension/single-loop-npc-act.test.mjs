/**
 * §143.3–§143.5 (docs/specs/npc-acts-first.md D2–D6 and D9; tickets 03 and 04): a person's act is generated first and
 * bound after -- the kernel lists the ways it can settle it (`npc.act.options`), one closed Jev batch picks the way and
 * its parameters, the clerk writes it through the ordinary gateway, and every receipt of the act carries
 * `intent: {ref, npc, text, outcome, generated: true}`. Two gates keep a person from doing the same thing twice: the act
 * that is the same line as a row under way continues it (structural), and the act Jev reads as the same thing as a row
 * with no result is re-asked once, then that row is continued and abandoned and the act dropped (semantic; §143.29).
 *
 * - Pure seams: the batch and its reading under the §135.2 gates; the writes a bound act becomes; the policy's scan step;
 *   the NPC's turn of a fight as the forced `npc_act` candidate.
 * - The table (hybrid engine, emitted kernel, the kernel extension's gateway, a stub Jev, the fixture generation port):
 *   Knott's own turn of the fight spent on a shout; the same act Jev cannot settle; what a surprise of the stakes die
 *   lets the act bring out (§143.19: a rulebook pistol the same act fires; a `produces` with no surprise, dropped);
 *   the people a declaration acted on (and not the one it did not).
 * - The engine on the emitted kernel (the gateway a thin forwarder that applies the kernel extension's own host marks):
 *   the per-turn cap; pursuit after a flight; the two no-repeat gates across turns; a thing of the table's own brought
 *   out, in his hands on the next turn's packet (§143.19).
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
import { createHybridEngine, readTable } from "../../runtime/jev/hybrid-engine.ts";
import { compileRows } from "../../runtime/jev/compile-rows.ts";
import { createFixtureNpcActPort, npcActLaneInput } from "../../runtime/jev/npc-act.ts";
import { KNOWN_QUESTION, NPC_ACT_BIND_FAMILY, SAME_QUESTION, interpretNpcAct, npcActBatch, npcActWrites, npcProduceBatch, npcScanCandidate, producePart, runNpcAct, struckReceipts } from "../../runtime/jev/npc-act-step.ts";
import { COMPILE_FAMILY, compileBatch } from "../../runtime/jev/route-compile.ts";
import { initialView, next, npcScanDue, npcScanItem, settleCompile, settleExecute, startStep } from "../../runtime/jev/step-policy.ts";
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
 * `produce` (§143.19): a matcher over the book's name of a price-list record, or "none" -- it answers the record question,
 * and the part question with the part whose records it matches (the second batch of a long list is answered the same way).
 * `known` (§143.27): "new" or "known", or a function of the batch giving one -- whether what the act brings out was
 * already at the table.
 */
function actAnswer(batch, { way = "unknown", params = {}, same = "none", produce = "none", known = "new" } = {}) {
	const answers = {};
	for (const question of batch.questions) {
		if (question.key === "way") answers.way = choice(way);
		else if (question.key === "produces_known") answers.produces_known = choice(typeof known === "function" ? known(batch) : known);
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

/** `npc.act.options` as the kernel answers it for Knott on his turn of a fight (the shape of §143.3). */
const fightOptions = (extra = {}) => ({
	npc: { handle: "steven-knott", name: "Steven Knott" }, play_language: "zh-Hans", place: "commission-briefing", in_session: true, my_turn: true, acted_on: [],
	ways: [
		{ way: "attack", params: { target: [{ value: "thomas-hayes", label: "Thomas Hayes" }], weapon: [{ value: "unarmed", label: "Unarmed (fist/kick)" }] } },
		{ way: "flee", params: {} },
		{ way: "check", params: { skill: [{ value: "Spot Hidden", label: "Spot Hidden 55" }, { value: "Listen", label: "Listen 40" }] } },
		{ way: "intention_only", params: {} },
	],
	// §143.19: the price list of the era, asked with produce: true -- a weapon record carries its profile.
	produce: [{ value: "eq.1920s.weapon_table.38", label: ".38 or 9mm Revolver", category: "weapon_table", weapon: "revolver_38_or_9mm" },
		{ value: "eq.1920s.miscellaneous.umbrella", label: "Umbrella", category: "miscellaneous" }],
	...extra,
});
const PACKET = { npc: { handle: "steven-knott", name: "Steven Knott" }, state: { in_session: true, my_turn: true }, at_hand: { holdings: [] }, done: [] };
const batchOf = (input = {}) => npcActBatch({ runId: "r", person: "Steven Knott", act: SHOUT, packet: PACKET, options: fightOptions(), rows: [], ...input }, scope, []);
const PISTOL = "袖珍手枪";

test("§143.3 batch: one closed question for the way, one per parameter with a choice, the produced record only when the act brings something out, the same-row question over the rows", () => {
	const { batch } = batchOf();
	assert.equal(batch.family, NPC_ACT_BIND_FAMILY);
	assert.equal(batch.familyVersion, "2", "§143.19: the draw question became the produce question");
	assert.deepEqual(batch.questions.map((question) => question.key), ["way", "check.skill"], "one target and one weapon are bound without a question");
	assert.deepEqual(Object.keys(batch.questions[0].criteria), ["attack", "flee", "check", "intention_only", "unknown"]);
	assert.equal(batch.state.act, SHOUT, "keyed on the act the generation wrote");
	assert.equal(batch.state.produces, undefined);
	const producing = batchOf({ produces: PISTOL }).batch;
	assert.deepEqual(producing.questions.map((question) => question.key), ["way", "attack.weapon", "check.skill", "produce", "produces_known"]);
	assert.equal(producing.state.produces, PISTOL, "Jev reads what the act brings out");
	assert.ok(Object.values(producing.questions.find((question) => question.key === "attack.weapon").criteria).some((label) => /bring out/.test(label)),
		"the attack's weapon options include the thing the act brings out, when the book prices weapons");
	assert.deepEqual(producing.questions.find((question) => question.key === "produce").criteria,
		{ record_1: ".38 or 9mm Revolver", record_2: "Umbrella", none: "No record of the price list is that kind of thing." }, "the book's names, and none");
	const unarmed = batchOf({ produces: PISTOL, options: fightOptions({ produce: [{ value: "eq.u", label: "Umbrella", category: "miscellaneous" }] }) }).batch;
	assert.ok(!unarmed.questions.some((question) => question.key === "attack.weapon"), "a price list with no weapon adds no weapon option");
	const rows = [{ ref: "intent:steven-knott:aaaaaaaaaaaa", intent: "ring the bell", status: "attempted", since_turn: 1, turn: 1 }];
	const same = batchOf({ rows }).batch.questions.find((question) => question.key === "same");
	// §143.14: the options are the rows' own lines and statuses plus none; what is asked is the purpose, not the hands.
	assert.deepEqual(same.criteria, { row_1: { intent: "ring the bell", status: "attempted" }, none: SAME_QUESTION.none });
	assert.equal(same.instructions, SAME_QUESTION.instructions);
	assert.match(same.instructions, /same purpose, whatever the hands do/);
});

test("§143.3 reading: a cleared way binds with its parameters; unknown, below the gate or an unbound parameter binds intention_only; no answer is not judged", () => {
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

test("§143.19 a price list longer than one question: its parts first, the record within the chosen part in a second batch", () => {
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

test("§143.22 which record, once it is a record at all: near kin splitting the answer leave no revolver the rules cannot fire", () => {
	// Ticket 23 (ticket 20's live probe, T3): "a snub revolver hidden under an old ledger" reached the weapon part, no one
	// record cleared, and it was minted the table's own -- a gun with no numbers. The thing exists (the die allowed it, the
	// generator named it); the record only gives it rules, so the answer's mass on records is what has to clear.
	const records = ["tools", "melee", "weapon_table"].flatMap((category) => Array.from({ length: 100 }, (_, index) => ({ value: `eq.${category}.${index}`,
		label: category === "weapon_table" && index === 7 ? ".38 or 9mm Revolver" : category === "weapon_table" && index === 8 ? ".32 or 7.65mm Revolver" : `${category} thing ${index}`,
		category, ...(category === "weapon_table" ? { weapon: index === 7 ? "revolver_38_or_9mm" : index === 8 ? "revolver_32_or_7_65mm" : `weapon_${index}` } : {}) })));
	const { batch, plan } = batchOf({ produces: "藏在旧账本下的短管左轮手枪", options: fightOptions({ produce: records }) });
	const first = actAnswer(batch, { way: "attack", params: { "attack.weapon": "weapon_drawn" }, produce: (label) => label.startsWith(".38") });
	const part = producePart(plan, first, 0.6);
	const second = npcProduceBatch({ runId: "r", person: "Steven Knott", act: GUN, produces: "藏在旧账本下的短管左轮手枪", part: part.part, records: part.records }, scope, []);
	const alias = (label) => Object.entries(second.records).find(([, record]) => record.label === label)[0];
	const r38 = alias(".38 or 9mm Revolver"), r32 = alias(".32 or 7.65mm Revolver");
	const split = (probabilities) => {
		const [lead, confidence] = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0];
		return complete(second.batch, { produce: { status: "answered", type: "choice", choice: lead, confidence, probabilities } });
	};
	const bind = (probabilities) => interpretNpcAct(plan, first, 0.6, { records: second.records, result: split(probabilities) });

	const kin = bind({ [r38]: 0.45, [r32]: 0.4, none: 0.15 });
	assert.deepEqual([kin.way, kin.params.weapon.value, kin.produced.source, kin.produced.name], ["attack", "revolver_38_or_9mm", "catalog", ".38 or 9mm Revolver"],
		"two revolvers split the answer below both gates, 0.85 on records: the leading one, a gun that fires");
	assert.equal(kin.answers.produce.cleared_by, "kind", "the row says the record was taken by kind, not by the answer's own gate");
	const sure = bind({ [r38]: 0.9, [r32]: 0.05, none: 0.05 });
	assert.deepEqual([sure.produced.record.value, sure.answers.produce.cleared_by], [records[207].value, undefined], "a record clearing its own gate is taken as before");
	const noneLeads = bind({ none: 0.5, [r38]: 0.3, [r32]: 0.2 });
	assert.deepEqual([noneLeads.produced.source, noneLeads.reason], ["table", "param_unbound:weapon"], "none leading: the table's own, no weapon");
	const thin = bind({ [r38]: 0.42, none: 0.41, [r32]: 0.17 });
	assert.deepEqual([thin.produced.source, thin.reason], ["table", "param_unbound:weapon"], "0.59 on records under a 0.6 gate: not a record");

	// The one-question list (records fit one question) reads the same way.
	const short = batchOf({ produces: "藏在旧账本下的短管左轮手枪" });
	const answered = actAnswer(short.batch, { way: "attack", params: { "attack.weapon": "weapon_drawn" } });
	answered.answers.produce = { status: "answered", type: "choice", choice: "record_1", confidence: 0.5, probabilities: { record_1: 0.5, record_2: 0.3, none: 0.2 } };
	const one = interpretNpcAct(short.plan, answered, 0.6);
	assert.deepEqual([one.way, one.params.weapon.value, one.produced.source], ["attack", "revolver_38_or_9mm", "catalog"]);
});

const writeContext = (extra = {}) => ({ name: "Steven Knott", handle: "steven-knott", line: SHOUT, ref: "intent:steven-knott:bbbbbbbbbbbb", open: true, continuedTurn: null,
	turn: 3, spend: true, abandon: false, place: "commission-briefing", ...extra });
const bound = (way, params = {}, extra = {}) => ({ judged: true, way, params: Object.fromEntries(Object.entries(params).map(([key, value]) => [key, { value, label: value }])),
	draw: null, same: null, reason: "bound", answers: {}, ...extra });

// ---------------------------------------------------------------------------------------------------
// §143.27 (ticket 28; table `npc-acts-d`, turn 2): a surprise is something no one knew. The generator's `produces` was a
// rental notice that had lain under his hand since turn 1, and a pen on the desk; they were placed as a surprise. One
// more question of the same batch asks whether the thing was already known at the table; a cleared `known` takes the
// surprise away -- nothing is matched, drawn or placed -- and the act binds as it is.
// ---------------------------------------------------------------------------------------------------

const NOTICE = "折好的租房广告";
const KNOWN_PACKET = { ...PACKET, happened: [`turn 1: Steven Knott's stance set to wary (why: 他把${NOTICE}压在手底下)`, "Thomas Hayes (investigator) declared: \"不接\""],
	recent_speech: ["turn 1: 这房子便宜"], at_hand: { holdings: [], objects: ["desk"], exits: [], present: ["Thomas Hayes"] } };

test("§143.27 batch: with a produces, one more closed question -- was it already at the table -- over what happened and what they said besides their state and what is at hand", () => {
	const { batch } = batchOf({ produces: NOTICE, packet: KNOWN_PACKET });
	const question = batch.questions.find((entry) => entry.key === "produces_known");
	assert.ok(question, "asked in the same batch");
	assert.equal(batch.questions.at(-1).key, "produces_known", "after the produce question; no rows, so nothing after it");
	assert.deepEqual(Object.keys(question.criteria), ["new", "known"], "two closed answers, no word list");
	assert.deepEqual([question.instructions, question.criteria], [KNOWN_QUESTION.instructions, KNOWN_QUESTION.criteria]);
	assert.deepEqual(batch.state.situation, { state: KNOWN_PACKET.state, at_hand: KNOWN_PACKET.at_hand, happened: KNOWN_PACKET.happened,
		recent_speech: KNOWN_PACKET.recent_speech }, "Jev reads the packet's at_hand, happened, recent_speech and state");
	const plain = batchOf({ packet: KNOWN_PACKET }).batch;
	assert.ok(!plain.questions.some((entry) => entry.key === "produces_known"), "no produces, no question");
	assert.deepEqual(Object.keys(plain.state.situation), ["state", "at_hand"], "and the state stays what it was");
});

test("§143.27 reading: a cleared known takes the surprise away and the act binds as it is; new, below the gate or no answer leave it a surprise", () => {
	const { batch, plan } = batchOf({ produces: NOTICE, packet: KNOWN_PACKET });
	const known = interpretNpcAct(plan, actAnswer(batch, { way: "check", params: { "check.skill": (label) => label.startsWith("Listen") }, known: "known",
		produce: (label) => label === "Umbrella" }), 0.6);
	assert.equal(known.produced, null, "no record, no object: the thing was already there");
	assert.deepEqual([known.way, known.params.skill.value, known.producesKnown, known.answers.produces_known?.choice],
		["check", "Listen", true, "known"], "the act is bound as usual, and the answer is on the row");
	assert.ok(!npcActWrites(known, writeContext()).some((call) => call.carries), "no write carries a draw or a produce");
	const fresh = interpretNpcAct(plan, actAnswer(batch, { way: "check", known: "new", produce: (label) => label === "Umbrella" }), 0.6);
	assert.deepEqual([fresh.producesKnown, fresh.produced.source, fresh.produced.name], [false, "catalog", "Umbrella"], "new: as before");
	const doubtful = actAnswer(batch, { way: "check", produce: "none" });
	doubtful.answers.produces_known = { status: "answered", type: "choice", choice: "known", confidence: 0.2, probabilities: { known: 0.6, new: 0.4 } };
	const low = interpretNpcAct(plan, doubtful, 0.6);
	assert.deepEqual([low.producesKnown, low.produced], [false, { name: NOTICE, source: "table" }], "below the gate: still a surprise");
	const none = interpretNpcAct(plan, undefined, 0.6);
	assert.deepEqual([none.producesKnown, none.produced], [false, { name: NOTICE, source: "table" }], "no Jev: as before");
	const drawn = interpretNpcAct(plan, actAnswer(batch, { way: "attack", params: { "attack.weapon": "weapon_drawn" }, produce: (label) => label.startsWith(".38"), known: "known" }), 0.6);
	assert.deepEqual([drawn.way, drawn.reason, drawn.produced], ["intention_only", "param_unbound:weapon", null], "a known thing is no weapon brought out");
	// A long price list: the part cleared, but the thing was known -- no second batch.
	const records = ["tools", "weapon_table"].flatMap((category) => Array.from({ length: 150 }, (_, index) => ({ value: `eq.${category}.${index}`, label: `${category} thing ${index}`, category })));
	const long = batchOf({ produces: NOTICE, packet: KNOWN_PACKET, options: fightOptions({ produce: records }) });
	const partly = actAnswer(long.batch, { way: "check", produce: (label) => label === "tools thing 3", known: "known" });
	assert.equal(producePart(long.plan, partly, 0.6), null, "nothing to match, so no second batch");
	assert.equal(producePart(long.plan, actAnswer(long.batch, { way: "check", produce: (label) => label === "tools thing 3" }), 0.6).part, "tools", "new: the second batch as before");
});

test("§143.3 writes: a new act opens its row (spending the turn on their turn of a fight unless the way is a fight action), then every write names it", () => {
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
	// §143.19: anything else is produced -- the book's record by its price_id, the table's own by its name -- described by the act.
	const umbrella = npcActWrites(bound("intention_only", {}, { produced: { name: "Umbrella", source: "catalog", record: { value: "eq.u", label: "Umbrella", category: "miscellaneous" } } }),
		writeContext({ act: GUN }));
	assert.deepEqual(umbrella.map((call) => call.carries), [{ produce: { price_id: "eq.u", description: GUN } }]);
	const photo = npcActWrites(bound("intention_only", {}, { produced: { name: "一张泛黄的全家福", source: "table" } }), writeContext({ act: GUN }));
	assert.deepEqual(photo.map((call) => [call.args.effects.length, call.carries]), [[2, { produce: { name: "一张泛黄的全家福", description: GUN } }]]);
	assert.equal(npcActWrites(bound("intention_only"), writeContext())[0].carries, undefined, "nothing brought out, nothing carried");
});

test("§143.5 writes: a continued row is named from the first write; the same act again with nothing to settle it abandons the row (why: repeated)", () => {
	const continuing = writeContext({ open: false, continuedTurn: 2, ref: "intent:steven-knott:cccccccccccc" });
	assert.deepEqual(npcActWrites(bound("intention_only"), { ...continuing, spend: false }).map((call) => call.args.effects), [[{ kind: "npc", name: "Steven Knott",
		intent_ref: "intent:steven-knott:cccccccccccc", outcome: "abandoned", why: "repeated" }]], "an intention under way since an earlier turn, repeated with no result");
	assert.deepEqual(npcActWrites(bound("check", { skill: "Listen" }), continuing).map((call) => [call.tool, call.args.effects?.[0]?.action ?? call.args.action?.intent_ref]),
		[["resolve", "intent:steven-knott:cccccccccccc"], ["apply", "hold"]], "a roll settles the row it continues; the turn passes by a hold");
	assert.deepEqual(npcActWrites(bound("intention_only", {}, { judged: false }), { ...continuing, spend: false }), [], "an unjudged repeat writes nothing");
});

test("§143.4 policy: after a landed step of the declaration the people it acted on act before the model step, once; not after a forced step; not past the time budget", () => {
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

test("§143.4 candidates: an NPC's own turn of a fight is the forced npc_act step -- the standing attack no longer binds; a missing disposition is still inferred first", () => {
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
	// §142.14's release is gone with the standing attack: an intention under way changes nothing here.
	const capsule = { present: [{ name: "Steven Knott", history: { intents: [{ ref: "intent:steven-knott:aaaaaaaaaaaa", status: "attempted" }] } }] };
	assert.equal(buildCandidates({ capsule, applyOptions: {}, resolveOptions: { context: { session } } }, "x").find((candidate) => candidate.forced).clerk, "npc_act");
	const fighter = { id: "steven-knott", name: "Steven Knott", combat_standing: { action: null, basis: "rule-default" },
		combat_disposition: { disposition: null, basis: null, options: { fights_to_the_end: "x", avoids_fighting: "y" }, material: { agenda: "Rent the house." } } };
	const { standing_action: _standing, ...bare } = session;
	const [inference] = buildCandidates({ capsule: {}, applyOptions: {}, resolveOptions: { context: { session: bare } }, fighter }, "x").filter((candidate) => candidate.forced);
	assert.equal(inference.clerk, "disposition_inference", "the disposition is a description of him, inferred once, before his act");
});

test("§143.3 host marks: only the clerk's npc_act calls carry _generated and what the act brings out; a model-sent mark is removed", () => {
	const effects = () => [{ kind: "npc", name: "Steven Knott", intends: SHOUT, outcome: "attempted", _generated: true, _draws: { weapon: "x" } },
		{ kind: "npc", name: "Steven Knott", intent_ref: "intent:steven-knott:bbbbbbbbbbbb", intent_outcome: "attempted" }, { kind: "threat", name: "t" }];
	const keeper = { effects: effects() };
	markNpcAct("apply", keeper, undefined);
	assert.ok(keeper.effects.every((effect) => effect._generated === undefined && effect._draws === undefined));
	const clerk = { effects: effects() };
	markNpcAct("apply", clerk, { clerk: "npc_act", basis: { draw: { weapon: "revolver_38_or_9mm", price_id: "eq.x" } } });
	assert.deepEqual(clerk.effects.map((effect) => [effect._generated ?? null, effect._draws ?? null]),
		[[true, null], [true, { weapon: "revolver_38_or_9mm", price_id: "eq.x" }], [null, null]]);
	// §143.19: anything else the act brings out rides as _produces, from the basis, on the bare effect only.
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

test("§143.3 at the table: Knott's own turn spent on a shout -- a check with spend_turn, the turn passes, every receipt stamped with the act and generated", async (t) => {
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

test("§143.3 at the table: the same shout Jev cannot settle is the intention alone -- apply npc intends, attempted, no dice", async (t) => {
	const npcAct = createFixtureNpcActPort({ "steven-knott": SHOUT });
	const { table } = await actTable(t, { prepareWorkspace: knottsTurn, npcAct, act: () => ({ way: "unknown" }) });
	await table.session.prompt("我盯着他");
	const receipts = turnRecord(table, 3).receipts;
	const opened = receipts.find((receipt) => receipt.kind === "npc" && receipt.intent?.text === SHOUT);
	assert.deepEqual([opened?.intent.outcome, opened?.intent.generated], ["attempted", true]);
	assert.ok(!receipts.some((receipt) => receipt.kind === "roll" && receipt.actor === "steven-knott" && receipt.family !== "stakes"), "nothing rolled for him (the stakes die of §143.8 is not his check)");
	assert.equal(npcActRows(table)[0].way, "intention_only");
});

/**
 * §143.8 puts `stakes: {rung, outcome, line, surprise, surprise_line}` on the situation packet from a keeper-visible
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
/** §143.19 / ticket 20's acceptance: the pocket pistol (the fixture's `produces`) is the book's .25 Derringer. */
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

/**
 * §143.30 / ticket 32's acceptance: the top rung's surprise may be out of its time. On the 1920s starter the fixture's
 * `produces` is a chainsaw -- the price list the bind asks over goes past the module's era, so Jev (the stub, by the
 * book's name) finds the modern Chainsaw record in its part, and it is drawn with its rulebook profile.
 */
const SAW_ACT = "从厕所里拖出一把电锯，拉响了朝他挥过去。";
const CHAINSAW = "eq.modern.weapon_table.table_xvii_hand_to_hand_weapons.chainsaw_i";

test("§143.30 at the table: on a 1920s module a severe surprise's chainsaw is the book's modern Chainsaw record -- matched by part then record, drawn with its profile, and the same act's attack uses it", async (t) => {
	const npcAct = createFixtureNpcActPort({ "steven-knott": { act: SAW_ACT, produces: "电锯" } });
	const { table, decisions } = await actTable(t, { prepareWorkspace: knottsTurn, npcAct,
		act: () => ({ way: "attack", params: { "attack.weapon": "weapon_drawn" }, produce: (label) => String(label).startsWith("Chainsaw") }) });
	withStakes(table, { outcome: "severe", surprise: true });
	await table.session.prompt("我盯着他");
	const binds = decisions.filter((batch) => batch.family === NPC_ACT_BIND_FAMILY);
	const part = binds[0].questions.find((question) => question.key === "produce_part");
	const weapons = Object.values(part?.criteria ?? {}).find((value) => value?.part === "weapon_table");
	assert.ok(weapons?.records.includes("Chainsaw* (i)"), "the weapon part lists the modern record beside the 1920s ones");
	assert.ok(weapons.records.includes(".25 Derringer (1B)"), "and the module's own records are still there");
	assert.deepEqual(binds[1]?.questions.map((question) => question.key), ["produce"], "then the record within the part");
	const drew = turnRecord(table, 3).receipts.find((receipt) => receipt.kind === "npc" && receipt.draws);
	assert.equal(drew?.draws.weapon_id, "chainsaw", "the chainsaw, by its rulebook profile");
	assert.deepEqual([drew.produced.source, drew.produced.name, drew.produced.record], ["catalog", "Chainsaw* (i)", CHAINSAW]);
	assert.deepEqual(worldOf(table).npc_weapons["steven-knott"].map((weapon) => weapon.weapon_id), ["chainsaw"], "his, where the fight reads weapons");
	const attack = turnRecord(table, 3).receipts.find((receipt) => receipt.kind === "roll" && receipt.actor === "steven-knott" && receipt.combat_action === "attack");
	assert.match(String(attack?.skill), /Chainsaw/, "the same act's attack is made with it: brought out, it is usable");
	const [row] = npcActRows(table);
	assert.deepEqual([row.produces, row.produced?.record, row.draw], ["电锯", CHAINSAW, "chainsaw"]);
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

test("§143.4 at the table: after the clerk carried out the declaration, the person it acted on acts before the Keeper's step; the one it did not act on does not", async (t) => {
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
	createRealCampaign(workspace, CAMPAIGN);
	// A state put in place by the kernel's own RPC in a process of its own, before the engine's kernel starts.
	if (prepare) prepare(workspace);
	const call = kernelProcess(t, workspace, { COC_KERNEL_SEED: seed });
	// Registered after the kernel's own close hook, so it runs after the kernel has exited (hooks run in the order they
	// were registered): removed first, a kernel still writing made it ENOTEMPTY, and the throw skipped the close hook,
	// which left the kernel alive and the file hanging.
	t.after(() => rmSync(workspace, { recursive: true, force: true, maxRetries: 3 }));
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
	// `stakes` pins the situation's stakes die (§143.8, §143.19) instead of the seed's roll, as `withStakes` does at the table.
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

test("§143.4 cap: three people acted on outside a fight -- two act, the third is recorded skipped_cap; the one nobody acted on is never asked", async (t) => {
	const npcAct = createFixtureNpcActPort({ "*": "他往后退了一步，盯着你的手。" });
	const game = await seam(t, { npcAct, act: () => ({ way: "intention_only" }) });
	await call0(game);
	const people = ["Edna Hale", "Silas Pike", "Tobias Crane"];
	await game.say("我环顾办公室里的人。");
	for (const name of people) await game.write("table.apply", { effects: [{ kind: "npc", name, to: "here", walk_on: true, why: "test fixture: a visitor" }] });
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
 * (§143.9, in flight on its own branch) stops the old engine from starting a chase for the investigators on that flight;
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
// Ticket 04 (§143.5): the two no-repeat gates, across turns.
// ---------------------------------------------------------------------------------------------------

const CALL = "他大喊要叫警察来。", AGAIN = "他说你再不走他就叫警察。", STILL = "他说他这次真的要叫警察了。", SIT = "他坐回椅子上，不再说话。";
/** One turn outside a fight: the player speaks to Knott (the compile's addressee), he acts, the Keeper closes the turn. */
async function spokenTo(game, text = "我看着诺特。") {
	await game.say(text);
	await triggerReaction(game);
	// §142.7: the first delivery that owes an intention's result is refused once; the second is delivered.
	await game.close().catch(() => game.close());
}
// Binding/continuation fixtures explicitly trigger a real transaction. Conversation-only
// behavior is tested separately below and must never start this autonomous author.
async function triggerReaction(game) {
 await game.write('table.apply',{effects:[{kind:'cash',subject:'Thomas Hayes',delta:1,source:'found',with:'Steven Knott',why:'contract fixture: an actual exchange triggers the reaction under test'}]});
 return game.run(scan(['Steven Knott']));
}
const knottActs = (game) => acts(game).filter((row) => row.npc === "steven-knott");
const doneOf = (call) => call.packet.done.map((row) => [row.intent, row.status]);

test("§143.5 semantic gate: the same thing again with no result is re-asked once; the same thing a second time is that row continued and abandoned", async (t) => {
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
	assert.deepEqual([second.reask, second.opened, second.continued], [true, false, first.ref], "that row continued (and, §143.29, the act dropped)");
	await spokenTo(game, "我把抽屉关上。");
	const rows = doneOf(npcAct.calls[3]);
	assert.deepEqual(rows.find(([intent]) => intent === CALL), [CALL, "abandoned"], "the next turn's packet: no longer under way");
	assert.ok(!rows.some(([intent]) => intent === AGAIN || intent === STILL), "the repeats opened no rows of their own");
	assert.equal(second.abandoned, first.ref, "the act's row names the row it abandoned");
});

test("§143.5 semantic gate: Jev reads the act as none of the rows -- each act is its own row, and nothing is asked twice", async (t) => {
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

test("§143.5 semantic gate: the same thing as a row already settled is a new row -- done again in a new situation, not asked again", async (t) => {
	const npcAct = createFixtureNpcActPort({ "steven-knott": [CALL, AGAIN] });
	const game = await seam(t, { npcAct, act: (batch) => ({ way: "intention_only", same: batch.state.act === AGAIN ? (row) => row.intent === CALL : "none" }) });
	await call0(game);
	await game.say("我看着诺特。");
	await triggerReaction(game);
	const ref = knottActs(game).at(-1).ref;
	// §143.14: the table's act is settled by the dice (here the Keeper's roll for him), not by saying it failed.
	await game.write("table.resolve", { action: { actor: "Steven Knott", intent: "investigate", skill: "Listen", goal: "listen for the constable", method: "listen", intent_ref: ref } });
	assert.ok((await game.receipts()).some((receipt) => receipt.kind === "roll" && receipt.intent?.ref === ref && ["done", "failed"].includes(receipt.intent.outcome)));
	await game.close();
	await spokenTo(game, "我不理他。");
	assert.equal(npcAct.calls.length, 2, "no re-ask");
	const last = knottActs(game).at(-1);
	assert.deepEqual([last.opened, last.reask, last.continued], [true, false, null]);
	assert.notEqual(last.ref, ref);
});

test("§143.5 structural gate: the very line of a row under way is that row continued -- no new row, no semantic question; nothing settles it, so it is abandoned (the owed linkage)", async (t) => {
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
	// §143.29: the row given up by the repeat is the act's one write; the act itself is dropped, not handed to the Keeper.
	assert.deepEqual([last.status, last.reason, last.receipts.length], ["dropped", "repeated", 1]);
	const situation = await game.call("npc.situation", { name: "Steven Knott" });
	assert.deepEqual(situation.done.map((row) => [row.ref, row.status]), [[ref, "abandoned"]]);
});

test("§143.5: the same line as a settled row is a new attempt -- a new line (the turn appended), never a refusal", async (t) => {
	const npcAct = createFixtureNpcActPort({ "steven-knott": [CALL, CALL] });
	const game = await seam(t, { npcAct, act: () => ({ way: "intention_only" }) });
	await call0(game);
	await game.say("我看着诺特。");
	await triggerReaction(game);
	const ref = knottActs(game).at(-1).ref;
	// §143.14: an arrival settles the table's act (the §142.2 addendum's shape); saying it was done would be refused.
	await game.write("table.apply", { effects: [{ kind: "npc", name: "the porter", to: "here", walk_on: true, intent_ref: ref, why: "the porter came up at the shout" }] });
	await game.close();
	await spokenTo(game, "我不理他。");
	const last = knottActs(game).at(-1);
	assert.deepEqual([last.status, last.opened], ["bound", true]);
	const situation = await game.call("npc.situation", { name: "Steven Knott" });
	assert.ok(situation.done.some((row) => row.intent.startsWith(CALL) && row.intent !== CALL && row.status === "attempted"), JSON.stringify(situation.done));
});

// ---------------------------------------------------------------------------------------------------
// Ticket 15 (§143.14): a threat is one thread -- the same purpose in other hands is the same thing, and only a result
// or giving it up ends it. Live table C3: lift the receiver, press it down, shout over it, hold it up between them.
// ---------------------------------------------------------------------------------------------------

const LIFT = "他一把抓起电话听筒，拇指压在叉簧上，盯着你。", PRESS = "他把听筒死死按在电话机上，另一只手挡在身前。";
const SHOUT_OVER = "他攥着听筒冲你喊：再碰我一下这电话就摇到巡警那儿去。", HOLD_UP = "他把听筒举在你们之间挡着，另一只手按在电话机边上。";
const DOOR = "他绕过桌子，去拉开办公室的门。";
/** Jev's fixture: every telephone act is the same thing as the first telephone row; anything else is none. */
const phoneJev = (phones, settled = {}) => (batch) => ({ way: settled[batch.state.act] ?? "intention_only",
	same: batch.questions.some((question) => question.key === "same") && phones.includes(batch.state.act) ? (row) => row.intent === LIFT : "none" });
const turnReceipts = (game, turn) => JSON.parse(readFileSync(join(game.workspace, ".coc/campaigns", CAMPAIGN, "turns", `${String(turn).padStart(4, "0")}.json`), "utf8")).receipts;

test("§143.14: the same purpose in other hands -- re-asked once ('twice without doing it'), then given up; the next packet says so, the same thing held up again opens no row, and a different purpose opens normally", async (t) => {
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

test("§143.14: announced, then done -- the same purpose bound to a way that settles it is that row, and the roll gives it its result (no re-ask, no new row)", async (t) => {
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

test("§143.14 at the table's kernel: the Keeper cannot make the table's act done by saying so; abandoning it stands, and the packet says he gave it up", async (t) => {
	const npcAct = createFixtureNpcActPort({ "steven-knott": LIFT });
	const game = await seam(t, { npcAct, act: () => ({ way: "intention_only" }) });
	await call0(game);
	await game.say("我看着诺特。");
	await triggerReaction(game);
	const { ref } = knottActs(game).at(-1);
	await assert.rejects(game.write("table.apply", { effects: [{ kind: "npc", name: "Steven Knott", intent_ref: ref, intent_outcome: "done", why: "he threatened" }] }),
		(error) => error.code === "invalid_params" && error.details?.reason === "table_act_unsettled");
	await game.write("table.apply", { effects: [{ kind: "npc", name: "Steven Knott", intent_ref: ref, intent_outcome: "abandoned", why: "he puts the receiver down" }] });
	const situation = await game.call("npc.situation", { name: "Steven Knott" });
	assert.deepEqual(situation.done.map((row) => [row.ref, row.status, row.by]), [[ref, "abandoned", "table"]]);
	assert.ok(situation.happened.some((line) => line.includes(`gave up "${LIFT}"`) && line.includes("(why: he puts the receiver down)")), JSON.stringify(situation.happened));
});

test("§143.14 step: a dropped act writes nothing and hands the Keeper no line -- the act was not done; the telemetry row keeps it", async () => {
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
// Ticket 30 (§143.29): a repeat after it was given up. Live table D2 (`npc-acts-d2`), one identity here: the copper badge
// brought out on T6 and given up; T14's act first repeated the Keeper's own row under way (squeeze out and shout), was
// re-asked, and came back as the badge -- which cleared on a badge row given up with other rows of his since, so it was
// a new row; T15 repeated that row, was re-asked, and was still the badge. That second hit gave the row up and, before
// §143.29, was still bound and handed to the Keeper as what he did; now it is dropped. The next turn's badge is dropped
// as a thread just given up.
// ---------------------------------------------------------------------------------------------------

const BADGE_OUT = "他被揪住领子，喘着气从马甲内袋摸出一枚铜徽章举到你眼前：「我是替考尔比家看房子的，你先松手。」";
const ASK_WHAT = "他背抵文件柜，慢慢摊开掌心：「别打了——你到底想要什么？」";
const SQUEEZE = "趁海斯收拳的空隙从门边挤出去，朝楼梯口喊人";
const SHOUT_AGAIN = "他朝楼梯口又拔高嗓子喊了一声「来人」，背贴着门框不动。";
const BADGE_GRIP = "他不再朝门口挤，背抵文件柜站定，把铜徽章从马甲里摸出来攥在掌心，盯着你喘气。";
const BADGE_SHOW = "他把攥着徽章的手举到胸前：「我是替考尔比家看房子的，你打死我也变不出别的东西来。」";
const BADGE_OPEN = "他朝你摊开手掌让你看清那枚铜徽章：「考尔比家的——我是替他们看房子的，你要什么，说出来。」";
const BADGE_CLUTCH = "他双手把铜徽章攥在胸口，喘着气：「我只是看房子的。」";
/** D2's readings: the second shout is the Keeper's row; every badge after the first is the purpose of the row `badge` names. */
const d2Jev = (badge = BADGE_GRIP) => (batch) => {
	const target = { [SHOUT_AGAIN]: SQUEEZE, [BADGE_GRIP]: BADGE_OUT, [BADGE_SHOW]: BADGE_GRIP, [BADGE_OPEN]: BADGE_GRIP, [BADGE_CLUTCH]: badge }[batch.state.act];
	return { way: "intention_only", same: target && batch.questions.some((question) => question.key === "same") ? (row) => row.intent === target : "none" };
};
/** Turns 1-4 of the D2 shape: T6 the badge (given up by the Keeper), T11 something else, T13 the Keeper's own row under way. */
async function d2Before(game) {
	await call0(game);
	await game.say("我揪住他的领子把他提起来。");
	await triggerReaction(game);
	const out = knottActs(game).at(-1);
	await game.write("table.apply", { effects: [{ kind: "npc", name: "Steven Knott", intent_ref: out.ref, intent_outcome: "abandoned", why: "海斯没接那枚徽章" }] });
	await game.close().catch(() => game.close());
	await spokenTo(game, "我又给了他一拳。");
	await game.say("我松开一只手，照他脸上又是一拳。");
	await game.write("table.apply", { effects: [{ kind: "npc", name: "Steven Knott", intends: SQUEEZE, outcome: "attempted" }] });
	await game.close().catch(() => game.close());
	return out;
}
/** T14 of the D2 shape: the Keeper's row repeated, re-asked, the badge again as a new row; the Keeper then settles his own row. */
async function d2Turn14(game) {
	await game.say("我堵在门口：那栋房子的钥匙，现在交出来。");
	await triggerReaction(game);
	const squeeze = (await game.call("npc.situation", { name: "Steven Knott" })).done.find((row) => row.intent === SQUEEZE);
	await game.write("table.apply", { effects: [{ kind: "npc", name: "Steven Knott", intent_ref: squeeze.ref, intent_outcome: "done", why: "楼下的门房应声上来" }] });
	await game.close().catch(() => game.close());
	return knottActs(game).at(-1);
}

test("§143.29 at the table (D2 T14-T16, one identity): the badge after the re-ask is a new row; the next turn's repeat gives it up and is dropped; the one after is dropped as given up", async (t) => {
	const npcAct = createFixtureNpcActPort({ "steven-knott": [BADGE_OUT, ASK_WHAT, SHOUT_AGAIN, BADGE_GRIP, BADGE_SHOW, BADGE_OPEN, BADGE_CLUTCH] });
	const game = await seam(t, { npcAct, act: d2Jev() });
	const out = await d2Before(game);
	// T14: the first act repeats the Keeper's row under way -- re-asked with that row's line; the badge comes back and
	// clears on the badge row given up on turn 2 with something of his set out since (turns 3 and 4): no thread, a new row.
	const grip = await d2Turn14(game);
	assert.equal(npcAct.calls.length, 4, "turn 5 generated twice: the shout, then the re-ask");
	assert.ok(npcAct.calls[3].packet.happened.at(-1).includes(SQUEEZE), "the re-ask was about the Keeper's own row, not the badge");
	assert.deepEqual([grip.status, grip.act, grip.opened, grip.reask, grip.continued, grip.abandoned], ["bound", BADGE_GRIP, true, true, null, null]);
	// T15: the badge again -- the row opened on turn 5 is under way: re-asked; the badge a second time gives that row up,
	// and the act that repeated it is dropped: its one write is the abandonment, no line of it is the table's act.
	await game.say("他还磨蹭，我冲上去又是一拳。");
	const run15 = await triggerReaction(game);
	await game.close().catch(() => game.close());
	assert.equal(npcAct.calls.length, 6, "turn 6 generated twice: the act, then the re-ask");
	assert.ok(npcAct.calls[5].packet.happened.at(-1).includes(BADGE_GRIP), "the re-ask named the badge row under way");
	const gaveUp = knottActs(game).at(-1);
	assert.deepEqual([gaveUp.status, gaveUp.reason, gaveUp.act, gaveUp.reask, gaveUp.opened, gaveUp.dropped, gaveUp.abandoned],
		["dropped", "repeated", BADGE_OPEN, true, false, grip.ref, grip.ref], "the telemetry keeps the line; the act is dropped and the row given up");
	assert.deepEqual(run15.artifact.executed.summary.acts.map((act) => [act.status, act.receipts.length]), [["dropped", 1]], "what the Keeper's note is built from: dropped, one receipt");
	const written = turnReceipts(game, 6).filter((receipt) => receipt.intent?.npc === "steven-knott");
	assert.deepEqual(written.map((receipt) => [receipt.intent.ref, receipt.intent.outcome, receipt.why, receipt.intent.generated]), [[grip.ref, "abandoned", "repeated", true]],
		"nothing written for him on turn 6 but the row given up");
	// T16: the packet says he gave it up; the badge once more is the thread just given up -- dropped, not asked again, no row.
	await spokenTo(game, "我盯着他。");
	assert.equal(npcAct.calls.length, 7, "no re-ask");
	assert.ok(npcAct.calls[6].packet.happened.some((line) => line.includes(`gave up "${BADGE_GRIP}" without doing it (why: repeated)`)), JSON.stringify(npcAct.calls[6].packet.happened));
	const dropped = knottActs(game).at(-1);
	assert.deepEqual([dropped.status, dropped.reason, dropped.act, dropped.dropped, dropped.reask, dropped.receipts], ["dropped", "repeats_given_up", BADGE_CLUTCH, grip.ref, false, []]);
	assert.ok(!turnReceipts(game, 7).some((receipt) => receipt.intent?.npc === "steven-knott"), "nothing written for him on turn 7");
	const situation = await game.call("npc.situation", { name: "Steven Knott" });
	assert.deepEqual(situation.done.map((row) => [row.intent, row.status]).sort(), [[ASK_WHAT, "attempted"], [BADGE_GRIP, "abandoned"], [BADGE_OUT, "abandoned"], [SQUEEZE, "done"]].sort(),
		"one row per purpose set out: no row for the shout again, the badge shown on turns 6 and 7, or held on turn 7");
	assert.equal(out.opened, true);
});

test("§143.29 known boundary: the badge the turn after it was given up, read as the older badge row -- that row is no thread, so a new row opens", async (t) => {
	// Purposes are rows, not chains: "just given up" is read on the row Jev names. The badge given up on turn 6 is the
	// newest row, but Jev naming the badge row given up on turn 2 instead reads a purpose with something of his since.
	const npcAct = createFixtureNpcActPort({ "steven-knott": [BADGE_OUT, ASK_WHAT, SHOUT_AGAIN, BADGE_GRIP, BADGE_SHOW, BADGE_OPEN, BADGE_CLUTCH] });
	const game = await seam(t, { npcAct, act: d2Jev(BADGE_OUT) });
	await d2Before(game);
	await d2Turn14(game);
	await spokenTo(game, "他还磨蹭，我冲上去又是一拳。");
	assert.equal(knottActs(game).at(-1).status, "dropped");
	await spokenTo(game, "我盯着他。");
	const last = knottActs(game).at(-1);
	assert.deepEqual([last.status, last.act, last.opened, last.reask], ["bound", BADGE_CLUTCH, true, false]);
});

test("§143.29 step: on their turn of a fight, the same purpose after the re-ask gives the row up and is dropped -- one write, no turn spent, nothing brought out, no line for the Keeper", async () => {
	const underWay = { ref: "intent:steven-knott:aaaaaaaaaaaa", intent: LIFT, status: "attempted", since_turn: 2, turn: 2 };
	const rows = [], writes = [], answers = [{ act: PRESS }, { act: HOLD_UP, produces: "听筒" }];
	const deps = {
		call: async (method, params) => method === "npc.situation"
			? { npc: { handle: "steven-knott", name: "Steven Knott" }, happened: [], state: { in_session: true, my_turn: true }, at_hand: {}, done: [underWay],
				stakes: { rung: "tense", outcome: "nothing", surprise: true } }
			: method === "npc.act.options"
				? { npc: { handle: "steven-knott", name: "Steven Knott" }, play_language: "zh-Hans", place: "commission-briefing", in_session: true, my_turn: true,
					acted_on: [], produce: [], ways: [{ way: "intention_only", params: {} }], ...(params.act ? { act: { line: params.act, ref: "intent:steven-knott:dddddddddddd", continues: null } } : {}) }
				: {},
		generate: async () => answers.shift(),
		decide: async (batch) => actAnswer(batch, { way: "intention_only", same: (row) => row.intent === LIFT }),
		write: async (call) => { writes.push(call); return { ok: true, callId: "x", receipts: ["npc:steven-knott-t3-c1"], status: "succeeded" }; },
		record: (row) => rows.push(row), scope, readSet: [], runId: "r", stepId: "r:s1", turn: 3, gate: 0.6,
		budget: { timeoutMs: 8000, maxPerTurn: 2, sameActRows: 5 }, signal: new AbortController().signal,
	};
	const outcome = await runNpcAct(deps, "Steven Knott", "turn");
	assert.deepEqual([outcome.status, outcome.reason, outcome.act, outcome.droppedAct, outcome.dropped, outcome.abandoned, outcome.continued, outcome.reask, outcome.passedTurn],
		["dropped", "repeated", undefined, HOLD_UP, underWay.ref, underWay.ref, underWay.ref, true, false]);
	assert.deepEqual(writes.map((call) => [call.tool, call.args, call.carries]), [["apply", { effects: [{ kind: "npc", name: "Steven Knott", intent_ref: underWay.ref,
		outcome: "abandoned", why: "repeated" }] }, undefined]], "the abandonment alone: no spend_turn, and what the dropped act named is not brought out");
	assert.deepEqual([outcome.produced, outcome.draw], [null, null]);
	const row = rows.find((entry) => entry.event === "npc_act");
	assert.deepEqual([row.status, row.act, row.dropped, row.abandoned, row.receipts], ["dropped", HOLD_UP, underWay.ref, underWay.ref, ["npc:steven-knott-t3-c1"]]);
	// The re-ask unavailable: the first repeat gives the row up and is dropped the same way.
	writes.length = 0;
	answers.push({ act: PRESS }, { unavailable: "model_unavailable" });
	const unavailable = await runNpcAct(deps, "Steven Knott", "turn");
	assert.deepEqual([unavailable.status, unavailable.droppedAct, unavailable.abandoned, writes.length], ["dropped", PRESS, underWay.ref, 1]);
	// A way that settles it after the re-ask is still that row given its result (§143.14, unchanged).
	writes.length = 0;
	answers.push({ act: PRESS }, { act: HOLD_UP });
	const settled = await runNpcAct({ ...deps, call: async (method, params) => {
		const value = await deps.call(method, params);
		return method === "npc.act.options" ? { ...value, ways: [{ way: "check", params: { skill: [{ value: "Listen", label: "Listen 40" }] } }, { way: "intention_only", params: {} }] } : value;
	}, decide: async (batch) => actAnswer(batch, { way: batch.state.act === HOLD_UP ? "check" : "intention_only", same: (entry) => entry.intent === LIFT }) }, "Steven Knott", "turn");
	assert.deepEqual([settled.status, settled.reask, settled.act, settled.continued, settled.way], ["bound", true, HOLD_UP, underWay.ref, "check"]);
	assert.equal(writes.find((call) => call.tool === "resolve")?.args.action.intent_ref, underWay.ref, "the roll settles the row it continues");
});

// ---------------------------------------------------------------------------------------------------
// Ticket 21 (§143.20): a person in the conversation acts every turn -- the scan runs before the Keeper's first model
// step whether or not a clerk step landed, and a person who took part last turn in the room the investigators are still
// in acts even when the compile did not name them. Live table B: ten turns of talk at the counter, three acts.
// Ticket 22 (§143.21): the player's words reach only the person they were said to, and the act is written in the
// campaign's play language from the opening on.
// ---------------------------------------------------------------------------------------------------

const TALK = "那你为什么急着把它租出去？";
/** Turn 1 closed at the office with one line the speech markers gave Knott (`{{say:...}}`, §40): he is in the conversation. */
const knottSpoke = (workspace) => kernelSteps(workspace, [
	["table.open", {}], ["table.player_input", { text: "我问诺特那栋房子的事。" }],
	["table.narrate", { call_id: "t1-c1", text: "诺特靠回椅背。{{say:Steven Knott}}「那房子空了好些年。」{{/say}}" }],
]);
/** Turn 1 closed at the office: Edna Hale walked in and both she and Knott said a line. */
const bothSpoke = (workspace) => kernelSteps(workspace, [
	["table.open", {}], ["table.player_input", { text: "我问诺特那栋房子的事。" }],
	["table.apply", { call_id: "t1-c1", effects: [{ kind: "npc", name: "Edna Hale", to: "here", walk_on: true, why: "test fixture: the landlord's clerk" }] }],
	["table.narrate", { call_id: "t1-c2", text: "诺特靠回椅背。{{say:Steven Knott}}「那房子空了好些年。」{{/say}}埃德娜抬起头。{{say:Edna Hale}}「钥匙在我这儿。」{{/say}}" }],
]);
/** The npc-act batch answers `act`; the compile clears `addressee` on the row `addressee` matches (else unclear); the rest as `otherAnswer`. */
const talkJev = ({ act = () => ({ way: "intention_only" }), addressee } = {}) => (batch) => {
	if (batch.family === NPC_ACT_BIND_FAMILY) return actAnswer(batch, act(batch));
	if (batch.family === COMPILE_FAMILY && addressee) return complete(batch, Object.fromEntries(batch.questions.map((question) => [question.key,
		choice(question.key === "addressee" ? aliasWhere(question, (value) => JSON.stringify(value).includes(addressee)) ?? "unclear" : "unclear")])));
	return otherAnswer(batch);
};
async function talkTable(t, { prepareWorkspace, npcAct, jev, responses }) {
	const engine = createHybridEngine({ env: {}, npcAct, decision: { decide: async (batch) => jev(batch) } });
	const table = await openTable({ realKernel: true, prepareWorkspace, env: { PI_COC_LOOP_ENGINE: "hybrid-v1", COC_KERNEL_SEED: "1" },
		runDriver: engine.runDriver, extraExtensions: [{ name: "coc-hybrid-engine", factory: engine.extension }],
		responses: responses ?? [fauxAssistantMessage([fauxToolCall("narrate", { text: "诺特没有马上回答。" })], { stopReason: "toolUse" })] });
	t.after(() => table.dispose());
	return table;
}
const landedClerkSteps = (telemetry) => telemetry.filter((row) => row.lane === "run" && row.event === "bind" && row.status === "succeeded");

test("Section 150.1: ongoing conversation is answered by the Keeper without another author or stakes roll", async(t)=>{
 const npcAct=createFixtureNpcActPort({'*':'An ordinary reply.'});
 const table=await talkTable(t,{prepareWorkspace:knottSpoke,npcAct,jev:talkJev()});
 await table.session.prompt(TALK);
 assert.equal(npcAct.calls.length,0);
 assert.equal(npcActRows(table).length,0);
 assert(table.telemetry(CAMPAIGN).some(row=>row.event==='npc_reply_owner'&&row.owner==='keeper'));
 assert(!turnRecord(table,2).receipts.some(receipt=>receipt.family==='stakes'||receipt.intent?.generated));
});

test("Section 150.1: addressing a person does not create an autonomous pending intention",async(t)=>{
 const npcAct=createFixtureNpcActPort({'*':'An ordinary reply.'});
 const table=await talkTable(t,{prepareWorkspace:bothSpoke,npcAct,jev:talkJev({addressee:'Edna'})});
 await table.session.prompt('Edna, please give me the key.');
 assert.equal(npcAct.calls.length,0);assert.equal(npcActRows(table).length,0);
});

test("§143.21 as amended: acted on while the words named no one, the line is his", async (t) => {
	// First contact: the investigator grabs Knott and demands the key without saying his name. Nothing named anyone else,
	// so the words are his to answer; ticket 22 as first written kept them only for the named or the engaged.
	const npcAct = createFixtureNpcActPort({ "*": "他往后缩了一下，手按住了抽屉。" });
	const game = await seam(t, { npcAct, act: () => ({ way: "intention_only" }) });
	await call0(game);
	const GRAB = "我一把揪住他的领子：钥匙交出来。";
	await game.say(GRAB);
	await game.write("table.apply", { effects: [{ kind: "cash", subject: "Thomas Hayes", delta: 1, source: "found", with: "Steven Knott", why: "a coin changes hands" }] });
	await game.run(scan());
	assert.deepEqual(acts(game).map((row) => [row.npc, row.trigger, row.addressed]), [["steven-knott", "acted_on", true]]);
	// §143.23 (ticket 24): no one was named, so the demand is said to no one by name (was `declared:`); the grab is his.
	assert.ok(npcAct.calls[0].packet.happened.at(-1).endsWith(`declared (to no one by name): "${GRAB}"`), `the demand is in his packet: ${npcAct.calls[0].packet.happened.at(-1)}`);
});

test("§143.21 as amended: the compile names another person -- the one acted on does not hear the words as his", async (t) => {
	const npcAct = createFixtureNpcActPort({ "*": "他往后缩了一下，手按住了抽屉。" });
	const game = await seam(t, { npcAct, act: () => ({ way: "intention_only" }) });
	await call0(game);
	const TO_EDNA = "埃德娜，你别插手。";
	await game.say(TO_EDNA);
	await game.write("table.apply", { effects: [{ kind: "npc", name: "Edna Hale", to: "here", walk_on: true, why: "test fixture: she comes in" }] });
	await game.write("table.apply", { effects: [{ kind: "cash", subject: "Thomas Hayes", delta: 1, source: "found", with: "Steven Knott", why: "a coin changes hands" }] });
	await game.run(scan(["Edna Hale"]));
	const packets = Object.fromEntries(npcAct.calls.map((call) => [call.packet.npc.name, call.packet.happened]));
	assert.deepEqual(Object.keys(packets).sort(), ["Steven Knott"]);
	assert.ok(!packets["Steven Knott"].some((line) => line.includes(TO_EDNA)), `said to her, not to him: ${JSON.stringify(packets["Steven Knott"])}`);
	assert.deepEqual(acts(game).map((row) => [row.npc, row.addressed]).sort(), [["steven-knott", false]], "only the actual transaction starts a separate reaction");
});

test("§143.20 on the emitted kernel: the party left the room where he spoke -- he came along, stands beside them, and is not in a conversation there", async (t) => {
	const npcAct = createFixtureNpcActPort({ "*": "他跟在后面，一句话也不说。" });
	const game = await seam(t, { npcAct, act: () => ({ way: "intention_only" }) });
	await game.call("table.open");
	await game.say("我问诺特那栋房子的事。");
	await game.close("诺特靠回椅背。{{say:Steven Knott}}「那房子空了好些年。」{{/say}}");
	await game.say("我去《环球报》报馆翻旧报纸。");
	await game.write("table.apply", { effects: [{ kind: "move", to: MORGUE }] });
	await game.write("table.apply", { effects: [{ kind: "npc", name: "Steven Knott", to: "here", why: "test fixture: he came along" }] });
	assert.equal((await game.call("npc.act.options", { name: "Steven Knott" })).place, MORGUE, "he stands in the morgue with the party");
	await game.run(scan());
	assert.deepEqual(acts(game), [], "leaving the room ended the conversation; nothing was done to him here");
	assert.equal(npcAct.calls.length, 0);
});

/**
 * Live table B's opening (turn 0): the Keeper made the Mod's first-impression check against Crane, a clerk step landed,
 * the scan followed, and Crane acted -- in English at a zh-Hans table. The campaign's tag was on that request
 * (`npc.act.options` reads `campaign.json`, which held zh-Hans from its creation, four minutes before); what the model had
 * besides the bare tag was a packet of host English with no player words, and it followed the packet. The request now
 * names the language beside its tag (`npcActLaneInput`, the product lane's own serializer, is what this port records).
 */
test("§143.21 at the opening: the table's first generation -- no player words, the packet all the host's English -- carries the campaign's play language and its name", async (t) => {
	const ACT = "诺特抬头看了你一眼，问你是来办什么事的。", bodies = [];
	const npcAct = { generate: async (input) => { bodies.push(JSON.parse(npcActLaneInput(input))); return { act: ACT }; } };
	const game = await seam(t, { npcAct, act: () => ({ way: "intention_only" }) });
	await game.call("table.open");
	assert.equal((await game.call("table.status")).turn, 0, "the opening turn");
	// As the Keeper did at table B's opening: the Mod's first-impression check, made against the person met.
	await game.write("table.resolve", { action: { intent: "social", decision: "natural-npc:first-impression", target: "Steven Knott", goal: "Introduce myself" } });
	await game.run(scan());
	assert.deepEqual(acts(game).map((row) => [row.npc, row.trigger, row.status]), [["steven-knott", "acted_on", "bound"]]);
	assert.equal(bodies.length, 1);
	assert.deepEqual([bodies[0].play_language, bodies[0].play_language_name], ["zh-Hans", "Simplified Chinese"], "the campaign's tag, read from the campaign, and its name");
	assert.ok(!bodies[0].situation.happened.some((line) => line.includes("declared:")), "the opening has no player words");
	assert.ok((await game.receipts()).some((receipt) => receipt.kind === "npc" && receipt.intent?.text === ACT && receipt.intent.generated === true), "the act landed on the opening turn");
});

// ---------------------------------------------------------------------------------------------------
// Ticket 24 (§143.23): who the words were said to. Live table B2, turn 10: "then give me back my five dollars first" was
// said to Arthur, who had the money; the compile answered `unclear` 0.83 -- its state held the sentence, the scene and
// the names present, and nothing about who had just been talking with the investigator -- so Arthur and Ruth, both in
// the conversation, both got the words, and Ruth answered them. The compile now reads the last exchange (the newest
// committed turn's words and the lines its speech markers gave each person, `table.status.last_exchange`), and words
// that named no one reach the people in the conversation as said to no one by name.
// ---------------------------------------------------------------------------------------------------

const KNOTT_LINE = "「那房子空了好些年。」", EDNA_LINE = "「钥匙在我这儿。」", ASKED = "我问诺特那栋房子的事。";
const UNNAMED = "那你先把钥匙给我。";
/** A talk table that records every Jev batch it answers. */
async function exchangeTable(t, { addressee } = {}) {
	const npcAct = createFixtureNpcActPort({ "*": "对方抬了抬眼，没有马上接话。" }), batches = [];
	const answer = talkJev({ addressee });
	const table = await talkTable(t, { prepareWorkspace: bothSpoke, npcAct, jev: (batch) => { batches.push(batch); return answer(batch); } });
	return { table, npcAct, batches };
}

test("§143.23 at the table: the compile's state carries last turn's exchange -- the player's words and the line the markers gave Knott and the one they gave Edna", async (t) => {
	const { table, batches } = await exchangeTable(t);
	await table.session.prompt(UNNAMED);
	const compile = batches.find((batch) => batch.family === COMPILE_FAMILY);
	assert.ok(compile, "the compile was asked");
	const record = turnRecord(table, 1);
	assert.deepEqual(record.speech.map((line) => line.text), [KNOTT_LINE, EDNA_LINE], "the fixture: each said a line last turn");
	assert.deepEqual(compile.state.last_exchange, { turn: 1, player_text: ASKED, speech: [
		{ who: record.speech[0].who.name, line: KNOTT_LINE }, { who: record.speech[1].who.name, line: EDNA_LINE }] });
	assert.deepEqual(compile.state.last_exchange.speech.map((line) => line.who), ["Steven Knott", "Edna Hale"], "each by the table's name for them");
	const addressee = compile.questions.find((question) => question.key === "addressee");
	assert.ok(addressee.instructions.includes("last_exchange"), "the addressee question reads a word that points at a person by it");
});

test("§143.23 on the emitted kernel: no committed turn before this one, or the party left the room it closed in -- the compile's state has no last_exchange", async (t) => {
	const npcAct = createFixtureNpcActPort({ "*": "……" });
	const game = await seam(t, { npcAct, act: () => ({ way: "intention_only" }) });
	const state = async () => {
		// The engine's own reads (`tableReads`): the two option reads are quiet, as there (none before a player turn is open).
		const [capsule, status, applyOptions, resolveOptions] = await Promise.all([game.call("table.capsule"), game.call("table.status"),
			game.call("table.apply.options").catch(() => ({})), game.call("table.resolve.options").catch(() => ({}))]);
		const { context } = readTable(capsule, status);
		return compileBatch({ runId: "r", rawInput: "x", context, materials: [], candidates: [], observations: [],
			rows: compileRows({ capsule, applyOptions, resolveOptions }) }, scope, [], []).state;
	};
	await game.call("table.open");
	assert.ok(!Object.hasOwn(await state(), "last_exchange"), "the opening: nothing committed before it");
	await game.say(ASKED);
	await game.write("table.apply", { effects: [{ kind: "npc", name: "Edna Hale", to: "here", walk_on: true, why: "test fixture: the landlord's clerk" }] });
	await game.close(`诺特靠回椅背。{{say:Steven Knott}}${KNOTT_LINE}{{/say}}埃德娜抬起头。{{say:Edna Hale}}${EDNA_LINE}{{/say}}`);
	await game.say("我去《环球报》报馆翻旧报纸。");
	assert.deepEqual((await state()).last_exchange?.speech?.map((line) => line.line), [KNOTT_LINE, EDNA_LINE], "still in the office: the exchange stands");
	await game.write("table.apply", { effects: [{ kind: "move", to: MORGUE }] });
	assert.ok(!Object.hasOwn(await state(), "last_exchange"), "the party moved to the morgue: the office's exchange is not this room's");
});

test("Section 150.1: named and unnamed ordinary replies both remain with the Keeper",async(t)=>{
 const unnamed=await exchangeTable(t);await unnamed.table.session.prompt(UNNAMED);
 assert.equal(unnamed.npcAct.calls.length,0);assert.equal(npcActRows(unnamed.table).length,0);
 const named=await exchangeTable(t,{addressee:'Edna'});await named.table.session.prompt('Edna, please give me the key.');
 assert.equal(named.npcAct.calls.length,0);assert.equal(npcActRows(named.table).length,0);
});

// ---------------------------------------------------------------------------------------------------
// Ticket 26 (§143.25): the scan does not act before the declaration. Live table D, turn 3: "我走过去，照他脸上就是一拳" --
// the compile read `act` combat 1.0 and named no one (addressee none 0.28), no clerk step took the punch, and the scan
// ticket 21 put before the Keeper's first model step ran Knott (in the conversation) on a punch that had not happened:
// "侧身让开门口，抬脚朝外走去", bound as leave, done; the Keeper had to bring him back to hit him.
// ---------------------------------------------------------------------------------------------------

const PUNCH = "我走过去，照他脸上就是一拳。";
/** The compile reads the declaration as the `combat` intent (1.0) and everything else as `otherAnswer` does: no clerk step. */
const punchJev = (batch) => {
	const answer = otherAnswer(batch);
	if (batch.family === COMPILE_FAMILY) {
		const act = batch.questions.find((question) => question.key === "act");
		answer.answers.act = choice(aliasWhere(act, (value) => value === "combat" || String(value).startsWith("combat:")), 1);
	}
	return answer;
};
const heldRows = (telemetry) => telemetry.filter((row) => row.lane === "run" && row.event === "npc_held");

test("§143.25 at the table (table D turn 3): the compile reads a punch, no clerk fight step landed, he is in the conversation -- he does not act before the Keeper's step", async (t) => {
	const npcAct = createFixtureNpcActPort({ "steven-knott": "他侧身让开门口，抬脚朝外走去。" });
	const table = await talkTable(t, { prepareWorkspace: knottSpoke, npcAct, jev: punchJev });
	await table.session.prompt(PUNCH);
	const telemetry = table.telemetry(CAMPAIGN);
	const compile = telemetry.find((row) => row.lane === "route" && row.purpose === "compile");
	assert.deepEqual([compile.features.act.row, compile.features.act.cleared, compile.features.addressee.cleared], ["combat", true, false], "combat, and no one named");
	assert.deepEqual(landedClerkSteps(telemetry), [], "no clerk step took the punch");
	assert.deepEqual(npcActRows(table), [], "no npc_act row: he did not act on a punch that has not happened");
	assert.equal(npcAct.calls.length, 0, "nothing was generated for him");
	assert.deepEqual(heldRows(telemetry).map((row) => [row.npc, row.trigger, row.reason, row.named]), [["steven-knott", "engaged", "fight_pending", []]]);
	// The telemetry file interleaves writers, so order is read from the step ids, not from line order.
	const stepOf = (id) => Number(String(id).split(":s").at(-1));
	const held = telemetry.find((row) => row.lane === "run" && row.event === "npc_held");
	const model = telemetry.find((row) => row.lane === "run" && row.type === "step_start" && row.kind === "infer");
	assert.ok(held && model && stepOf(held.step) < stepOf(model.stepId), "the scan ran before the Keeper's first model step and held him");
});

test("§143.25 policy: a cleared fight act holds the scan until a clerk fight step lands; a step that settles something else does not end it, and talk never starts it", () => {
	const context = { scene: "office", clock: null, present: ["Steven Knott"], receipts: [] };
	const rows = { act: [{ id: "social", describe: "social" }, { id: "combat", describe: "combat" }], addressee: [{ id: "Steven Knott", describe: { name: "Steven Knott" } }] };
	const compiled = (act, addressee = "unclear") => {
		const view = initialView({ runId: "r", rawInput: PUNCH, context, candidates: [], rows, readFirst: false });
		const batch = compileBatch(view, scope, [], []);
		settleCompile(view, 1, batch, complete(batch, { act: choice(act, 1), addressee: choice(addressee, addressee === "unclear" ? 0.4 : 0.9) }), 0, 0.6);
		return view;
	};
	const pending = (view) => npcScanItem(view).candidate.bound.fight_pending;
	const punch = compiled("act_2");
	assert.deepEqual(pending(punch), { named: [] }, "combat cleared, no one named, nothing landed");
	assert.deepEqual(pending(compiled("act_2", "addressee_1")), { named: ["Steven Knott"] }, "the person the compile named");
	assert.equal(pending(compiled("act_1")), undefined, "talk holds no one");
	const step = (family, key) => ({ key, verb: "apply", family, label: key, source: "t", bound: {}, unbound: [], clerk: "declared_bookkeeping", basis: {} });
	settleExecute(punch, 2, { kind: "direct", purpose: "execute", candidate: step("clue", "apply:clue:keys") }, { ok: true, summary: {} }, { context, candidates: [] }, 0);
	assert.deepEqual(pending(punch), { named: [] }, "a clue landed: the punch is still unresolved");
	settleExecute(punch, 3, { kind: "direct", purpose: "execute", candidate: { ...step("combat", "resolve:combat:first-blow"), verb: "resolve", clerk: "first_blow" } },
		{ ok: false, summary: {} }, { context, candidates: [] }, 0);
	assert.deepEqual(pending(punch), { named: [] }, "a refused first blow did not land");
	settleExecute(punch, 4, { kind: "direct", purpose: "execute", candidate: { ...step("combat", "resolve:combat:first-blow"), verb: "resolve", clerk: "first_blow" } },
		{ ok: true, summary: {} }, { context, candidates: [] }, 0);
	assert.equal(pending(punch), undefined, "the first blow landed: the scan after it runs as usual");
});

test("§143.25 on the emitted kernel: the punch named Knott and has not landed -- Edna, in the conversation and not the one it is aimed at, acts as engaged; once it lands, he acts", async (t) => {
	const npcAct = createFixtureNpcActPort({ "*": "对方往后缩了一下。" });
	const game = await seam(t, { npcAct, act: () => ({ way: "intention_only" }) });
	await call0(game);
	await game.say(ASKED);
	await game.write("table.apply", { effects: [{ kind: "npc", name: "Edna Hale", to: "here", walk_on: true, why: "test fixture: the landlord's clerk" }] });
	await game.close(`诺特靠回椅背。{{say:Steven Knott}}${KNOTT_LINE}{{/say}}埃德娜抬起头。{{say:Edna Hale}}${EDNA_LINE}{{/say}}`);
	await game.say(PUNCH);
	// The scan as the policy issues it while the punch the compile aimed at Knott (its `target`) has no landed clerk step.
	await game.run(npcScanCandidate(0, [], [], { named: ["Steven Knott"] }));
	assert.deepEqual(acts(game), [], "the pending target is held and ordinary bystander replies belong to the Keeper");
	assert.deepEqual(game.rows.filter((row) => row.event === "npc_held").map((row) => [row.npc, row.trigger, row.named]), [["steven-knott", "engaged", ["Steven Knott"]]]);
	assert.deepEqual(npcAct.calls, []);
	// Without any actual consequence, another scan still starts no autonomous reply.
	await game.run(scan());
	assert.deepEqual(acts(game), []);
});

// ---------------------------------------------------------------------------------------------------
// Ticket 29 (§143.28): a held person acts after the blow. Live table D2, turns 5, 10, 12 and 13: the punch was left to the
// Keeper, §143.25 held Knott (`npc_held`, fight_pending), and the Keeper settled it itself -- its own `resolve`, then the
// pending defence the kernel forced. The scan followed only clerk-landed steps, so he never acted on those turns: no stakes
// die, no act, his reaction all the Keeper's prose. The blow that struck him now ends the hold and he acts once, before the
// Keeper's next turn-writing model step.
// ---------------------------------------------------------------------------------------------------

/**
 * Turn 1 closed at the office: Knott's numbers and how he fights pinned (a fight can be had with him, and his turn of it
 * needs no disposition inferred first; table D2's Keeper gave him `avoids_fighting`) and a line the markers gave him.
 */
const knottSpokeArmed = (workspace) => kernelSteps(workspace, [
	["table.open", {}], ["table.player_input", { text: ASKED }],
	["table.apply", { call_id: "t1-c1", effects: [{ kind: "npc", name: "Steven Knott", archetype: "ordinary_adult", why: "test fixture" }] }],
	["table.apply", { call_id: "t1-c2", effects: [{ kind: "npc", name: "Steven Knott", disposition: "avoids_fighting", why: "test fixture" }] }],
	["table.narrate", { call_id: "t1-c3", text: `诺特靠回椅背。{{say:Steven Knott}}${KNOTT_LINE}{{/say}}` }],
]);
/** The punch as table D2 had it: the compile reads `combat` and names no one, no clerk step takes it, the route asks the Keeper. */
const punchLeftToKeeper = (batch) => {
	if (batch.family === NPC_ACT_BIND_FAMILY) return actAnswer(batch, { way: "intention_only" });
	const answer = punchJev(batch);
	if (batch.questions.some((question) => question.key === "exit")) answer.answers.exit = choice("ask_llm");
	return answer;
};
const HIT = { intent: "combat", goal: "hit him", method: "fists", target: "Steven Knott", weapon: "unarmed" };
const DODGE = { intent: "combat", goal: "combat:defend", method: "combat:defend", actor: "Steven Knott", defense: "dodge" };
const PART = { intent: "combat", goal: "both back off", method: "", decision: "combat:end", outcome: "stalemate" };
const keeperSays = (...calls) => fauxAssistantMessage(calls.map(([tool, args]) => fauxToolCall(tool, args)), { stopReason: "toolUse" });
const stepOf = (id) => Number(String(id).split(":s").at(-1));
const modelSteps = (telemetry) => telemetry.filter((row) => row.lane === "run" && row.type === "step_start" && row.kind === "infer").map((row) => stepOf(row.stepId));
const releasedRows = (telemetry) => telemetry.filter((row) => row.lane === "run" && row.event === "npc_released");

test("§143.28 at the table (table D2 turn 5): the punch left to the Keeper holds him; the Keeper's own resolve lands the blow -- before its next model step he acts once, acted on", async (t) => {
	const npcAct = createFixtureNpcActPort({ "steven-knott": "他捂着脸撞开椅子，朝门口喊人。" });
	const table = await talkTable(t, { prepareWorkspace: knottSpokeArmed, npcAct, jev: punchLeftToKeeper,
		responses: [keeperSays(["resolve", { action: HIT }], ["resolve", { action: DODGE }], ["resolve", { action: PART }]),
			keeperSays(["narrate", { text: "诺特捂着脸退到墙边。" }])] });
	await table.session.prompt(PUNCH);
	const telemetry = table.telemetry(CAMPAIGN);
	assert.deepEqual(landedClerkSteps(telemetry).filter((row) => !/defend/.test(row.candidate)), [], "no clerk step of the declaration took the punch");
	assert.deepEqual(heldRows(telemetry).map((row) => [row.npc, row.trigger, row.reason]), [["steven-knott", "engaged", "fight_pending"]], "held before the Keeper's step, as §143.25 has it");
	const blow = turnRecord(table, 2).receipts.find((receipt) => receipt.kind === "roll" && receipt.family === "combat" && receipt.combat_action === "attack" && receipt.npc === "steven-knott");
	assert.ok(blow, "the Keeper's resolve made the attack against him");
	const [released] = releasedRows(telemetry);
	assert.deepEqual([released?.npc, released?.reason, released?.receipts.includes(blow.id)], [["steven-knott"], "struck", true], "the blow ended the hold");
	const rows = npcActRows(table);
	assert.deepEqual(rows.map((row) => [row.npc, row.trigger, row.status]), [["steven-knott", "acted_on", "bound"]], "one act, his, as the person the blow was done to");
	assert.equal(npcAct.calls.length, 1, "one generation");
	assert.equal(npcAct.calls[0].packet.state.in_session, false, "the Keeper ended the brawl: he acts outside a fight");
	const [first, second] = modelSteps(telemetry);
	assert.ok(stepOf(heldRows(telemetry)[0].step) < first, "held before the Keeper's first model step");
	assert.ok(second !== undefined && first < stepOf(rows[0].step) && stepOf(rows[0].step) < second, `he acts after the blow and before the Keeper's next model step: ${first} < ${rows[0].step} < ${second}`);
	assert.ok(turnRecord(table, 2).receipts.some((receipt) => receipt.intent?.generated === true && receipt.intent.npc === "steven-knott"), "his act is on the turn");
	assert.ok(turnRecord(table, 2).receipts.some((receipt) => receipt.family === "stakes" && receipt.actor === "steven-knott"), "the stakes die was rolled for him");
});

test("§143.28 at the table: the Keeper does something else to him and never settles the punch -- a roll made against him that no fight wrote -- he stays held, nothing acts", async (t) => {
	const npcAct = createFixtureNpcActPort({ "steven-knott": "他往后缩了一下。" });
	const table = await talkTable(t, { prepareWorkspace: knottSpokeArmed, npcAct, jev: punchLeftToKeeper,
		responses: [keeperSays(["resolve", { action: { intent: "social", goal: "逼他交出钥匙", method: "揪住衣领威吓", skill: "Intimidate", target: "Steven Knott" } }]),
			keeperSays(["narrate", { text: "诺特僵在原地。" }])] });
	await table.session.prompt(PUNCH);
	const telemetry = table.telemetry(CAMPAIGN);
	const receipts = turnRecord(table, 2).receipts;
	assert.ok(receipts.some((receipt) => receipt.kind === "roll" && receipt.npc === "steven-knott" && receipt.family === "social"), "the Keeper's roll against him landed");
	assert.ok(!receipts.some((receipt) => receipt.family === "combat"), "no blow landed");
	assert.deepEqual(heldRows(telemetry).map((row) => [row.npc, row.reason]), [["steven-knott", "fight_pending"]], "still only the hold");
	assert.deepEqual(releasedRows(telemetry), []);
	assert.deepEqual(npcActRows(table), [], "no npc_act row");
	assert.equal(npcAct.calls.length, 0, "nothing generated for him");
});

test("§143.28 at the table: the Keeper writes the punch as damage with no roll (its damage effect) -- the hit points he lost end the hold, and he acts once", async (t) => {
	const npcAct = createFixtureNpcActPort({ "steven-knott": "他捂着脸往门口退。" });
	const table = await talkTable(t, { prepareWorkspace: knottSpokeArmed, npcAct, jev: punchLeftToKeeper,
		responses: [keeperSays(["apply", { effects: [{ kind: "damage", subject: "Steven Knott", dice: "1D3", why: "the punch lands" }] }]),
			keeperSays(["narrate", { text: "诺特捂着脸退到墙边。" }])] });
	await table.session.prompt(PUNCH);
	const telemetry = table.telemetry(CAMPAIGN);
	const lost = turnRecord(table, 2).receipts.find((receipt) => receipt.kind === "delta" && receipt.resource === "hp" && receipt.subject === "steven-knott");
	assert.ok(lost && lost.after < lost.before && !lost.family, "the Keeper's damage effect: hit points lost, no fight's family");
	assert.deepEqual(releasedRows(telemetry).map((row) => row.receipts), [[lost.id]], "the hit points he lost ended the hold");
	assert.deepEqual(npcActRows(table).map((row) => [row.npc, row.trigger, row.status]), [["steven-knott", "acted_on", "bound"]]);
	assert.equal(npcAct.calls.length, 1);
});

test("§143.28 at the table: the blow lands through the kernel's forced defence and the fight goes on -- his reaction is his own turn of it, once; the scan the blow owes does not run him again", async (t) => {
	const npcAct = createFixtureNpcActPort({ "steven-knott": "他抓起桌上的烟灰缸砸过来。" });
	const table = await talkTable(t, { prepareWorkspace: knottSpokeArmed, npcAct, jev: punchLeftToKeeper,
		responses: [keeperSays(["resolve", { action: HIT }]), keeperSays(["narrate", { text: "两人扭打在一起。" }])] });
	await table.session.prompt(PUNCH);
	const telemetry = table.telemetry(CAMPAIGN);
	assert.ok(landedClerkSteps(telemetry).some((row) => /defend/.test(row.candidate)), "the clerk took the pending defence the kernel forced");
	assert.equal(releasedRows(telemetry).length, 1, "the blow the forced defence settled ended the hold");
	const rows = npcActRows(table);
	assert.deepEqual(rows.map((row) => [row.npc, row.trigger]), [["steven-knott", "turn"]], "one act: his own turn of the fight (§143.4), unchanged");
	assert.equal(npcAct.calls.length, 1);
	const scans = telemetry.filter((row) => row.lane === "run" && row.type === "operation_prepared" && String(row.label).startsWith("The people present who were acted on"));
	assert.equal(scans.length, 2, "the scan that held him, and the one the blow owed -- which ran no one: he is in the fight and has acted");
	assert.ok(stepOf(rows[0].step) < stepOf(scans[1].stepId) && stepOf(scans[1].stepId) < modelSteps(telemetry)[1], "his turn, then the owed scan, then the Keeper's next step");
});

test("§143.28 policy: a blow that struck the held person ends the hold and owes the scan before the Keeper's next turn-writing step, whoever wrote it; no blow, or no declared fight, owes nothing", () => {
	const context = { scene: "office", clock: null, present: ["Steven Knott"], receipts: [] };
	const rows = { act: [{ id: "social", describe: "social" }, { id: "combat", describe: "combat" }], addressee: [{ id: "Steven Knott", describe: { name: "Steven Knott" } }] };
	const compiled = (act) => {
		const view = initialView({ runId: "r", rawInput: PUNCH, context, candidates: [], rows, readFirst: false });
		const batch = compileBatch(view, scope, [], []);
		settleCompile(view, 1, batch, complete(batch, { act: choice(act, 1), addressee: choice("unclear", 0.4) }), 0, 0.6);
		// The first scan ran (and held him): the Keeper's adjudication is next.
		view.pending = [{ kind: "infer", purpose: "adjudicate", reason: "ask_llm" }];
		const first = next(view);
		assert.ok(first.item?.scan);
		startStep(view, first);
		settleExecute(view, 2, first.item, { ok: true, summary: {} }, undefined, 0);
		assert.equal(next(view).kind, "infer", "then the Keeper's step");
		return view;
	};
	const keeper = (method) => ({ kind: "direct", purpose: "execute", call: { method, params: {}, label: method } });
	const BLOW = ["roll:fighting-brawl-t2-c2", "delta:hp-t2-c2"];
	const punch = compiled("act_2");
	assert.deepEqual(npcScanItem(punch).candidate.bound.fight_pending, { named: [] });
	// The Keeper's write that struck nobody held: nothing owed, still held.
	settleExecute(punch, 3, keeper("apply"), { ok: true, summary: {} }, { context, candidates: [] }, 0);
	assert.ok(!npcScanDue(punch));
	assert.deepEqual(npcScanItem(punch).candidate.bound.fight_pending, { named: [] });
	// The Keeper's resolve whose fresh read found the blow on him: the hold ends and the scan is owed first.
	settleExecute(punch, 4, keeper("resolve"), { ok: true, summary: {} }, { context, candidates: [], struck: BLOW }, 0);
	assert.ok(npcScanDue(punch));
	const scanned = next(punch);
	assert.deepEqual([scanned.kind, scanned.item.scan, scanned.item.candidate.bound.fight_pending], ["direct", true, undefined], "the scan comes before the step, with no hold");
	assert.deepEqual(scanned.item.candidate.basis.row.landed, BLOW, "it follows the blow's receipts");
	startStep(punch, scanned);
	settleExecute(punch, 5, scanned.item, { ok: true, summary: {} }, undefined, 0);
	assert.equal(next(punch).kind, "infer", "once: then the Keeper's step");
	// A forced step's fresh read (the kernel's pending defence) counts the same.
	const forced = compiled("act_2");
	settleExecute(forced, 3, { kind: "direct", purpose: "execute", candidate: { key: "resolve:combat:defend:steven-knott", verb: "resolve", family: "combat", label: "defend",
		source: "t", bound: {}, unbound: [], clerk: "forced_step", forced: true, basis: {} } }, { ok: true, summary: {} }, { context, candidates: [], struck: BLOW }, 0);
	assert.ok(npcScanDue(forced), "the defence the kernel forced landed the blow");
	// Talk holds no one: a struck read changes nothing when no fight action was declared.
	const talk = compiled("act_1");
	settleExecute(talk, 3, keeper("resolve"), { ok: true, summary: {} }, { context, candidates: [], struck: BLOW }, 0);
	assert.ok(!npcScanDue(talk));
	assert.deepEqual([talk.fightLanded, talk.landed ?? []], [undefined, []]);
});

test("§143.28 struck: the receipts done to him (the kernel's acted_on) that are a blow -- a fight wrote them, or he lost hit points -- and came after the hold; never a social roll, never one already there", () => {
	const receipts = [
		{ id: "roll:fighting-brawl-t2-c2", kind: "roll", family: "combat", npc: "steven-knott", combat_action: "attack" },
		{ id: "delta:hp-t2-c2", kind: "delta", family: "combat", subject: "steven-knott", resource: "hp", before: 11, after: 8 },
		{ id: "roll:intimidate-t2-c1", kind: "roll", family: "social", npc: "steven-knott" },
		{ id: "condition:thomas-hayes-t2-c5", kind: "condition", family: "chase", subject: "thomas-hayes", gained: ["fled"] },
		// The Keeper's `damage` effect: hit points lost, no family.
		{ id: "delta:hp-t2-c6", kind: "delta", subject: "steven-knott", resource: "hp", before: 8, after: 7 },
		{ id: "delta:san-t2-c7", kind: "delta", subject: "steven-knott", resource: "san", before: 50, after: 47 },
		{ id: "delta:hp-t2-c8", kind: "delta", subject: "steven-knott", resource: "hp", before: 7, after: 9 },
	];
	const actedOn = [{ receipt: "roll:intimidate-t2-c1", kind: "roll_against" }, { receipt: "roll:fighting-brawl-t2-c2", kind: "roll_against" },
		{ receipt: "delta:hp-t2-c2", kind: "delta" }, { receipt: "condition:thomas-hayes-t2-c5", kind: "fled_from" }, { receipt: "roll:unknown-t2-c9", kind: "roll_against" },
		{ receipt: "delta:hp-t2-c6", kind: "delta" }, { receipt: "delta:san-t2-c7", kind: "delta" }, { receipt: "delta:hp-t2-c8", kind: "delta" }];
	assert.deepEqual(struckReceipts(actedOn, receipts), ["roll:fighting-brawl-t2-c2", "delta:hp-t2-c2", "condition:thomas-hayes-t2-c5", "delta:hp-t2-c6"],
		"a fight's receipts and the hit points he lost; not a sanity loss, not hit points regained, not an id no receipt has");
	assert.deepEqual(struckReceipts(actedOn, receipts, ["roll:fighting-brawl-t2-c2", "delta:hp-t2-c2", "delta:hp-t2-c6"]), ["condition:thomas-hayes-t2-c5"], "a blow already on the table when the hold was put");
	assert.deepEqual(struckReceipts([{ receipt: "roll:intimidate-t2-c1", kind: "roll_against" }], receipts), [], "a roll against him no fight wrote");
	assert.deepEqual(struckReceipts(undefined, receipts), []);
});

// ---------------------------------------------------------------------------------------------------
// Ticket 20 (§143.19): a thing of the table's own, brought out on a surprise, is his from the next turn on.
// ---------------------------------------------------------------------------------------------------

const PHOTO = "一张泛黄的全家福", SHOW = "他从上衣内袋摸出一张泛黄的全家福，举到你眼前。", QUIET = "他把照片攥在胸前，一句话也不说。";

test("§143.19: a surprise, a produces no record of the book is -- Jev says none, one object of the table's own is placed in his hands, with no number, and the next turn's packet holds it", async (t) => {
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

// ---------------------------------------------------------------------------------------------------
// Ticket 28 (§143.27) on the emitted kernel: a thing already at the table is no surprise. The stub Jev stands in for the
// judgement by reading the batch's own state: `known` when the situation it was given already shows what `produces`
// names. Nothing in the step reads the words; the batch carries the question and the facts.
// ---------------------------------------------------------------------------------------------------

const seenAtTheTable = (batch) => JSON.stringify(batch.state.situation ?? {}).includes(batch.state.produces) ? "known" : "new";
const SHOW_AGAIN = "他又把那张泛黄的全家福举到你眼前。";

test("§143.27: a thing already in his hands is no surprise -- Jev says known, nothing is placed or drawn, the row says produces_known; the first time, new, it was placed as before", async (t) => {
	const npcAct = createFixtureNpcActPort({ "steven-knott": [{ act: SHOW, produces: PHOTO }, { act: SHOW_AGAIN, produces: PHOTO }] });
	const game = await seam(t, { npcAct, stakes: stakesView("escalates", true), act: () => ({ way: "intention_only", produce: "none", known: seenAtTheTable }) });
	await call0(game);
	await spokenTo(game);
	const first = knottActs(game).at(-1);
	assert.deepEqual([first.produced, first.produces_known], [{ name: PHOTO, source: "table" }, undefined], "not yet at the table: placed, as before");
	await spokenTo(game, "我盯着那张照片。");
	const receipts = turnReceipts(game, 3);
	assert.ok(!receipts.some((receipt) => receipt.produced || receipt.draws), "no _produces and no draw was written");
	const row = knottActs(game).at(-1);
	assert.deepEqual([row.status, row.way, row.produces, row.produced, row.produces_known, row.draw], ["bound", "intention_only", PHOTO, null, true, null]);
	const bind = game.decisions.filter((batch) => batch.family === NPC_ACT_BIND_FAMILY).at(-1);
	assert.ok(bind.state.situation.at_hand.holdings.includes(PHOTO), "his packet's at_hand already holds it");
	assert.ok(bind.questions.some((question) => question.key === "produces_known"), "asked in the one bind batch");
	assert.ok(receipts.some((receipt) => receipt.intent?.text === SHOW_AGAIN && receipt.intent.generated === true), "the act itself is bound as usual");
	const world = JSON.parse(readFileSync(join(game.workspace, ".coc/campaigns", CAMPAIGN, "world.json"), "utf8"));
	assert.equal(Object.keys(world.objects.instances).length, 1, "the one photograph of turn 2, nothing more");
	assert.equal(world.npc_weapons, undefined);
});

/** Turn 2 the Keeper writes a line of his that shows the pistol (or does not); turn 3 he brings out "a pocket pistol". */
async function pistolAlreadyShown(t, shown) {
	const npcAct = createFixtureNpcActPort({ "steven-knott": { act: POCKET, produces: PISTOL } });
	const game = await seam(t, { npcAct, stakes: stakesView("escalates", true),
		act: () => ({ way: "intention_only", produce: (label) => String(label).startsWith(".25 Derringer"), known: seenAtTheTable }) });
	await call0(game);
	await game.say("我盯着诺特的抽屉。");
	await game.write("table.apply", { effects: [{ kind: "npc", name: "Steven Knott", stance: "wary", why: shown ? "他把一把袖珍手枪压在抽屉边上。" : "他往椅背上靠了靠。" }] });
	await game.close("诺特没有说话。");
	await spokenTo(game);
	return { game, binds: game.decisions.filter((batch) => batch.family === NPC_ACT_BIND_FAMILY), row: knottActs(game).at(-1) };
}

test("§143.27: the pistol his last turn's line already showed is no surprise -- known over happened: no record looked up, nothing drawn", async (t) => {
	const { game, binds, row } = await pistolAlreadyShown(t, true);
	assert.ok(binds[0].state.situation.happened.some((line) => line.includes(PISTOL)), "the packet's happened already shows it");
	assert.equal(binds.length, 1, "no second batch: nothing to match to the book");
	assert.deepEqual([row.status, row.produces, row.produced, row.produces_known, row.draw], ["bound", PISTOL, null, true, null]);
	assert.ok(!turnReceipts(game, 3).some((receipt) => receipt.produced || receipt.draws), "no draw was written");
	assert.equal(JSON.parse(readFileSync(join(game.workspace, ".coc/campaigns", CAMPAIGN, "world.json"), "utf8")).npc_weapons, undefined);
});

test("§143.27: the same pistol no line showed is a surprise as before -- new: the book's Derringer, drawn", async (t) => {
	const { game, binds, row } = await pistolAlreadyShown(t, false);
	assert.equal(binds.length, 2, "the part, then the record within it");
	assert.deepEqual([row.produced?.source, row.produced?.name, row.draw, row.produces_known], ["catalog", ".25 Derringer (1B)", "automatic_25_derringer", undefined]);
	const world = JSON.parse(readFileSync(join(game.workspace, ".coc/campaigns", CAMPAIGN, "world.json"), "utf8"));
	assert.deepEqual(world.npc_weapons["steven-knott"].map((weapon) => weapon.weapon_id), ["automatic_25_derringer"]);
});

// ---------------------------------------------------------------------------------------------------
// Ticket 30 (§143.29) on the emitted kernel: what his own act brought out says so in the next packets. The copper badge of
// table D2 came out on turn 6 and was shown again on turns 9, 14 and 15; the packet had it in `holdings` as a bare name.
// ---------------------------------------------------------------------------------------------------

test("§143.29: the thing his act brought out is in the next packet's at_hand.brought_out -- the turn, the act's row and where it stands -- and the bind batch carries it", async (t) => {
	const npcAct = createFixtureNpcActPort({ "steven-knott": [{ act: SHOW, produces: PHOTO }, QUIET] });
	const game = await seam(t, { npcAct, stakes: stakesView("escalates", true), act: () => ({ way: "intention_only", produce: "none" }) });
	await call0(game);
	await spokenTo(game);
	const shown = knottActs(game).at(-1);
	assert.deepEqual([shown.opened, shown.produced], [true, { name: PHOTO, source: "table" }]);
	await spokenTo(game, "我盯着那张照片。");
	assert.equal(npcAct.calls[0].packet.at_hand.brought_out, undefined, "nothing brought out before: no section");
	assert.deepEqual(npcAct.calls[1].packet.at_hand.brought_out, [{ name: PHOTO, turn: 2, ref: shown.ref, status: "attempted" }], JSON.stringify(npcAct.calls[1].packet.at_hand));
	const bind = game.decisions.filter((batch) => batch.family === NPC_ACT_BIND_FAMILY).at(-1);
	assert.deepEqual(bind.state.situation.at_hand.brought_out, npcAct.calls[1].packet.at_hand.brought_out, "the same-purpose question's batch reads it too");
});
