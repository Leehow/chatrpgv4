/**
 * §197, refusal recovery carries the turn forward (lead's rulings after TR-F2 run 2, 2026-10-08;
 * `docs/specs/refusal-recovery.md`).
 *
 * - §197.1: a batch refused on one line names the lines the review admitted (`details.admitted`, verbatim), every line
 *   finishing first; the Keeper's resend of exactly those lands with no second review (`recovered_from`), and a changed or
 *   widened resend is reviewed as any call is.
 * - §197.2: the lane's `open_choice` says whose choice is open; `keeper_added` tells the Keeper to carry out what the player
 *   chose instead of asking them again, `player_open` (and a refusal that does not say) keeps §32.2's question.
 * - §197.3: an `object` hand-over or a told `clue` names its acting party on the line the reviewer reads, from the effect's
 *   own fields, and the reviewer's instruction says what that field means.
 *
 * The seam: the real `apply` tool and admission path, the harness's scripted `admission/a1` lane answering by the line it
 * is asked about (the judgement is the model's; what is under test is what the host does with it), the fake kernel for the
 * TR-F2 replays and the emitted kernel for a landing with receipts. The replays' player words and `apply` arguments are
 * copied verbatim from the table's session into `tests/extension/fixtures/refusal-recovery-trf2.json`, with the lane's
 * recorded verdicts.
 */
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall, getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import { admissionProposes, laneByLine, openTable, waitForIdle } from "./harness.mjs";
import { createHybridEngine } from "./hybrid-engine-fixture.mjs";
import { KernelError } from "../../extensions/kernel/client.ts";
import {
	ADMITTED_LINES_FIX,
	KEEPER_ADDED_FIX,
	PLAYER_OPEN_FIX,
	admissionPending,
	admissionRefusal,
	admissionRequest,
	admissionTimedOut,
	admissionUnavailable,
	batchRefusal,
	effectActingParty,
	recoveryMatches,
	shapeVerdict,
	admissionSystemPrompt,
	PLAYER_WORDS,
} from "../../extensions/kernel/admission.ts";
import { PLAYER_EXECUTION_CHOICE_NOTE } from "../../runtime/jev/action-field-semantics.ts";
import { ADMISSION_JEV_RULES, ADMISSION_JEV_VERSION } from "../../runtime/jev/admission-domain.ts";
import { ADMISSION_ROLES_VERSION } from "../../runtime/jev/admission-roles-domain.ts";

const root = resolve(import.meta.dirname, "../..");
const TRF2 = JSON.parse(readFileSync(join(root, "tests/extension/fixtures/refusal-recovery-trf2.json"), "utf8"));
const call = (name, args) => fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" });
const close = (text = "你照自己说的去做了。") => [call("narrate", { text }), fauxAssistantMessage("after")];
const admissionRows = (table) => table.telemetry().filter((row) => row.lane === "admission");
const kernelCalls = (table, method) => table.kernelRequests().filter((entry) => entry.method === method);
const toolResults = (session, tool) => session.messages.filter((message) => message.role === "toolResult" && message.toolName === tool)
	.map((message) => ({ isError: message.isError, details: message.details,
		text: (message.content ?? []).filter((block) => block.type === "text").map((block) => block.text).join("") }));
const refusalOf = (result) => result.details.coc_error;
const userText = (context) => (context?.messages ?? []).flatMap((message) => (message.role === "user" ? message.content : [])).map((block) => block.text ?? "").join("");
/** A lane step that answers by the proposed line, as `laneByLine` does, and keeps every request's system prompt and line. */
function recordingLane(cases, count = 8) {
	const seen = [];
	const step = async (context) => {
		const proposed = admissionProposes(userText(context));
		// Pi 0.87 carries the system prompt as a system message (the harness reads it the same way).
		seen.push({ system: getCurrentSystemPrompt(context?.messages ?? []) ?? "", proposed });
		const hit = cases.find(([pattern]) => pattern.test(proposed));
		const [, row, ms = 0] = hit ?? [null, { verdict: "authorized", grounds: "harness default: the player chose it" }];
		if (ms) await new Promise((done) => setTimeout(done, ms));
		return fauxAssistantMessage(JSON.stringify(row));
	};
	return { seen, responses: Array.from({ length: count }, () => step) };
}
/** The recorded verdict of a replayed line, with the `open_choice` §197.2 now asks of the reviewer. */
const recorded = (row, extra = {}) => ({ verdict: row.verdict, grounds: row.grounds, ...(row.missing ? { missing: row.missing } : {}), ...extra });

// ---- the pure rules -------------------------------------------------------------------------------------------------------

test("§197.1 recoveryMatches: exactly the admitted lines, order-free, as a multiset; nothing more, nothing less", () => {
	assert.equal(recoveryMatches(["a", "b"], ["b", "a"]), true);
	assert.equal(recoveryMatches(["a"], ["a"]), true);
	assert.equal(recoveryMatches(["a", "b"], ["a"]), false, "an admitted line left out");
	assert.equal(recoveryMatches(["a"], ["a", "c"]), false, "a line added");
	assert.equal(recoveryMatches(["a", "a"], ["a", "b"]), false, "a multiset, not a set");
	assert.equal(recoveryMatches([], []), false, "nothing admitted is no recovery");
});

test("§197.3 effectActingParty: the acting party from the effect's own closed fields, only when it is not an investigator", () => {
	const party = ["托马斯·海耶斯", "thomas-hayes"];
	const hand = (fields) => ({ kind: "object", name: "folder", ...fields });
	assert.equal(effectActingParty(hand({ from: "Captain", to: "托马斯·海耶斯", handover: "given" }), party), "Captain", "given: the giver");
	assert.equal(effectActingParty(hand({ from: "托马斯·海耶斯", to: "Guard", handover: "taken" }), party), "Guard", "taken: the taker");
	assert.equal(effectActingParty(hand({ from: "Captain", to: "托马斯·海耶斯", handover: "taken" }), party), undefined, "the investigator takes: theirs to choose");
	assert.equal(effectActingParty(hand({ from: "托马斯·海耶斯", to: "Clerk", handover: "given" }), party), undefined, "the investigator gives");
	assert.equal(effectActingParty(hand({ from: "Captain", to: "thomas-hayes", handover: "check" }), party), undefined, "a roll decided it");
	assert.equal(effectActingParty(hand({ from: "Captain", to: "thomas-hayes", offer: "made" }), party), "Captain", "holding out");
	assert.equal(effectActingParty(hand({ from: "Captain", to: "thomas-hayes", offer: "accepted", handover: "given" }), party), undefined,
		"accepting an offer is the investigator's answer, whatever the handover");
	assert.equal(effectActingParty(hand({ from: "thomas-hayes", to: "Clerk", offer: "declined" }), party), "Clerk", "an NPC declining");
	assert.equal(effectActingParty(hand({ to: "托马斯·海耶斯", definition: "folder" }), party), undefined, "a first placement naming no giver says nothing");
	assert.equal(effectActingParty(hand({ from: "here", to: "托马斯·海耶斯" }), party), undefined, "a pickup from a place has no handover");
	assert.equal(effectActingParty({ kind: "clue", clue: "c", from: "Steven Knott" }, party), "Steven Knott", "a told clue: the teller");
	assert.equal(effectActingParty({ kind: "item", name: "lamp", from: "Steven Knott" }, party), undefined, "item.from is not read");
	const [line] = admissionRequest("apply", { effects: [hand({ from: "Captain", to: "托马斯·海耶斯", handover: "given", definition: "folder" })] }, { party }).lines;
	assert.match(line, /; acting_party="Captain" \(not an investigator\)$/);
	const plain = admissionRequest("apply", { effects: [hand({ to: "托马斯·海耶斯", definition: "folder" })] }, { party });
	assert.doesNotMatch(plain.lines[0], /acting_party/);
	assert.equal(admissionRequest("apply", { effects: [hand({ from: "Captain", to: "托马斯·海耶斯", handover: "given", definition: "folder" })] }, { party: ["Captain"] }).key,
		admissionRequest("apply", { effects: [hand({ from: "Captain", to: "托马斯·海耶斯", handover: "given", definition: "folder" })] }, { party }).key,
		"the reuse key is the effect's, not the party's");
});

test("§197.2 shapeVerdict: open_choice is kept only beside missing on a refusal, with one of its two values; anything else is dropped, never bad_output", () => {
	assert.equal(shapeVerdict({ verdict: "not_authorized", grounds: "g", missing: "m", open_choice: "keeper_added" }).open_choice, "keeper_added");
	assert.equal(shapeVerdict({ verdict: "uncertain", grounds: "g", missing: "m", open_choice: "player_open" }).open_choice, "player_open");
	const odd = shapeVerdict({ verdict: "not_authorized", grounds: "g", missing: "m", open_choice: "both" });
	assert.ok(odd, "an unknown value is not a malformed answer");
	assert.equal(odd.open_choice, undefined);
	assert.equal(shapeVerdict({ verdict: "authorized", grounds: "g", open_choice: "keeper_added" }).open_choice, undefined);
	assert.equal(shapeVerdict({ verdict: "not_authorized", grounds: "g", open_choice: "keeper_added" }).open_choice, undefined, "no missing, nothing to say whose");
});

test("§197.2 admissionRefusal: keeper_added carries out the player's choice; player_open and a refusal that does not say ask for it", () => {
	const proposal = { tool: "apply", key: "k", lines: ["apply move: to=\"x\""] };
	const added = admissionRefusal(proposal, { verdict: "not_authorized", grounds: "g", missing: "a stop the player did not name", open_choice: "keeper_added" });
	const open = admissionRefusal(proposal, { verdict: "not_authorized", grounds: "g", missing: "where to look", open_choice: "player_open" });
	const silent = admissionRefusal(proposal, { verdict: "not_authorized", grounds: "g", missing: "where to look" });
	assert.equal(added.fix, KEEPER_ADDED_FIX);
	assert.equal(open.fix, PLAYER_OPEN_FIX);
	assert.equal(silent.fix, PLAYER_OPEN_FIX, "absent is §32.2's refusal as it always read");
	assert.notEqual(KEEPER_ADDED_FIX, PLAYER_OPEN_FIX);
	for (const error of [added, open, silent]) assert.match(error.fix, /details\.missing/, "both name the missing choice, so it reaches the tool result");
	assert.deepEqual([added.details.open_choice, open.details.open_choice, silent.details.open_choice], ["keeper_added", "player_open", undefined]);
});

test("§197.1 batchRefusal: the admitted effects and their paragraph ride on not_authorized, unavailable and review_timeout -- never on pending or a mismatch", () => {
	const lines = ["apply move: a", "apply move: b"];
	const one = (index) => ({ tool: "apply", key: `k${index}`, lines: [lines[index]] });
	const admitted = [{ kind: "move", to: "a", _cash_debit_limit: 3 }];
	const refused = { line: lines[1], error: admissionRefusal(one(1), { verdict: "not_authorized", grounds: "g", missing: "m", open_choice: "keeper_added" }) };
	const batch = batchRefusal("apply", lines, [refused], admitted);
	assert.deepEqual(batch.details.admitted, [{ kind: "move", to: "a" }], "verbatim, host-only fields left out");
	assert.ok(batch.fix.startsWith(KEEPER_ADDED_FIX), "the deciding line's own fix first");
	assert.ok(batch.fix.endsWith(ADMITTED_LINES_FIX));
	assert.match(batch.fix, /details\.admitted/);
	assert.match(batch.fix, /details\.line_outcomes/);
	assert.equal(batch.details.line_outcomes[0].open_choice, "keeper_added");
	for (const error of [admissionUnavailable(one(1), "model_error", "boom", 1), admissionTimedOut(one(1), 26_000, 26_000)])
		assert.deepEqual(batchRefusal("apply", lines, [{ line: lines[1], error }], admitted).details.admitted, [{ kind: "move", to: "a" }]);
	const pending = batchRefusal("apply", lines, [{ line: lines[1], error: admissionPending(one(1), 1000, 1000, 900) }], admitted);
	assert.equal(pending.details.admitted, undefined, "pending: the identical resend collects it");
	assert.ok(!pending.fix.includes(ADMITTED_LINES_FIX));
	const mismatch = admissionRefusal(one(1), { verdict: "not_authorized", grounds: "wrong arguments", recovery: "correct_proposal" }, true);
	assert.equal(batchRefusal("apply", lines, [{ line: lines[1], error: mismatch }], admitted).details.admitted, undefined, "a mismatch is corrected whole");
	assert.equal(batchRefusal("apply", lines, [refused]).details.admitted, undefined, "nothing admitted, nothing to resend");
	// A refusal combined again (a review of a batch's unknown lines nested in its call) carries the paragraph once.
	const again = batchRefusal("apply", [...lines, "apply move: c"], [{ line: lines[1], error: batch }], admitted);
	assert.equal(again.fix.split(ADMITTED_LINES_FIX).length, 2);
	assert.ok(again instanceof KernelError);
});

// ---- the seam: a refused batch names its admitted lines, and their exact resend lands once reviewed -------------------------

const WORDS = "我去报馆的剪报室查那栋房子的旧闻。";
const MORGUE = { kind: "move", to: "newspaper-morgue", travel_minutes: 20 };
const STOP = { kind: "move", to: "corbitt-house-ground", via: "先绕到科比特宅门前看一眼", label: "科比特宅" };
const ADDED = { verdict: "not_authorized", grounds: "the player named the morgue; the Keeper adds a stop at the house", missing: "a stop at the house the player did not name", open_choice: "keeper_added" };
const CHOSEN = { verdict: "authorized", grounds: "the player named the morgue" };

test("§197.1: every line finishes, the refusal names the admitted line, and the Keeper's exact resend lands with no second review", async (t) => {
	// The refused line answers first; the line the player chose answers 150 ms later. §32.12.3.1 used to stop it unanswered
	// (TR-F2 T16's `line_ms: [9911, null]`); now it finishes and is named.
	const table = await openTable({
		responses: [call("apply", { effects: [STOP, MORGUE] }), call("apply", { effects: [MORGUE] }), ...close()],
		laneResponses: { admission: laneByLine([[/to="corbitt-house-ground"/, ADDED], [/to="newspaper-morgue"/, CHOSEN, 150]]) } });
	t.after(() => table.dispose());
	await table.session.prompt(WORDS);
	const [first, second] = toolResults(table.session, "apply");
	assert.equal(first.isError, true);
	const refusal = refusalOf(first);
	assert.equal(refusal.details.reason, "action_not_authorized");
	assert.deepEqual(refusal.details.admitted, [MORGUE], "the line the player chose, verbatim");
	assert.equal(refusal.details.open_choice, "keeper_added");
	// What the fix names reaches the Keeper as its own line (§8): the effects to resend.
	assert.match(first.text, new RegExp(`^admitted: ${JSON.stringify([MORGUE]).replace(/[[\]{}]/g, "\\$&")}$`, "m"));
	assert.match(first.text, /^line_outcomes: /m);
	assert.doesNotMatch(first.text, /in front of them in the fiction/, "the player is not asked again");

	assert.equal(second.isError, false, second.text.slice(0, 300));
	assert.equal(table.lanes.admission.requests().length, 2, "two lines reviewed once each; the resend made no lane call");
	assert.deepEqual(kernelCalls(table, "table.apply").map((entry) => entry.params.effects), [[MORGUE]], "only the resend reached the kernel");
	const rows = admissionRows(table);
	assert.deepEqual(rows.map((row) => [row.proposed[0].split(";")[0], row.verdict, row.admitted, row.reused, row.batch_admitted ?? null]),
		[['apply move: to="corbitt-house-ground"', "not_authorized", false, false, false], ['apply move: to="newspaper-morgue"', "authorized", true, false, false],
			['apply move: to="newspaper-morgue"', "authorized", true, true, null]]);
	assert.ok(rows[0].line_ms.every((ms) => typeof ms === "number"), `both lines answered (${JSON.stringify(rows[0].line_ms)})`);
	assert.equal(rows[0].open_choice, "keeper_added");
	assert.equal(rows[2].recovered_from, rows[0].batch_key, "the resend's row names the refused call it recovered");
});

test("§197.1: a resend with a line changed, or with a line added, is not a recovery -- it is reviewed as any call is", async (t) => {
	const changed = { ...MORGUE, travel_minutes: 90 };
	const table = await openTable({
		responses: [call("apply", { effects: [STOP, MORGUE] }), call("apply", { effects: [changed] }), call("apply", { effects: [MORGUE, { kind: "time", minutes: 30 }] }), ...close()],
		laneResponses: { admission: laneByLine([[/to="corbitt-house-ground"/, ADDED], [/to="newspaper-morgue"/, CHOSEN, 50], [/apply time/, CHOSEN]]) } });
	t.after(() => table.dispose());
	await table.session.prompt(WORDS);
	const proposed = table.lanes.admission.requests().map((text) => admissionProposes(text).split("\n")[1].split(";")[0]);
	assert.deepEqual(proposed.sort(), ['- apply move: to="corbitt-house-ground"', '- apply move: to="newspaper-morgue"', '- apply move: to="newspaper-morgue"',
		'- apply move: to="newspaper-morgue"', "- apply time: minutes=30"].sort(),
		"the changed move was reviewed, and the batch that added a time line had both its lines reviewed");
	assert.ok(!admissionRows(table).some((row) => row.recovered_from), "neither resend was a recovery");
	assert.deepEqual(kernelCalls(table, "table.apply").map((entry) => entry.params.effects.length), [1, 2]);
});

test("§197.1 with §32.12.4: a response that resends the admitted lines beside another write starts no review for the resend", async (t) => {
	const table = await openTable({
		responses: [call("apply", { effects: [STOP, MORGUE] }),
			fauxAssistantMessage([fauxToolCall("apply", { effects: [MORGUE] }), fauxToolCall("apply", { effects: [{ kind: "time", minutes: 30, why: "reading the clippings" }] }),
				fauxToolCall("narrate", { text: "你在剪报室翻了半个钟头。" })], { stopReason: "toolUse" }), fauxAssistantMessage("after")],
		laneResponses: { admission: laneByLine([[/to="corbitt-house-ground"/, ADDED], [/to="newspaper-morgue"/, CHOSEN, 50], [/apply time/, CHOSEN, 50]]) } });
	t.after(() => table.dispose());
	await table.session.prompt(WORDS);
	await waitForIdle(table.session);
	assert.equal(table.lanes.admission.requests().length, 3, "the refused batch's two lines and the time line; none for the recovered move");
	const rows = admissionRows(table);
	assert.ok(rows.some((row) => row.recovered_from && row.reused), JSON.stringify(rows));
	assert.ok(rows.some((row) => row.concurrent && /apply time/.test(row.proposed[0])), "the other write's review was started at message_end");
	assert.deepEqual(kernelCalls(table, "table.apply").map((entry) => entry.params.effects[0].kind), ["move", "time"]);
});

test("§197.1's boundary: an admitted line that only made sense beside its refused batch-mate lands on its own verdict when the Keeper resends it", async (t) => {
	// The time is the search at the house; the move to the house was refused. The Keeper is told to leave such a line out
	// (ADMITTED_LINES_FIX), and the host cannot judge the dependency: resent anyway, it lands on the verdict it was given.
	const SEARCH = { kind: "time", minutes: 40, beyond_travel: true, why: "searching the ground floor" };
	const table = await openTable({
		responses: [call("apply", { effects: [STOP, SEARCH] }), call("apply", { effects: [SEARCH] }), ...close()],
		laneResponses: { admission: laneByLine([[/to="corbitt-house-ground"/, ADDED], [/apply time/, { verdict: "entailed", grounds: "the search the player asked for" }, 50]]) } });
	t.after(() => table.dispose());
	await table.session.prompt("我去科比特宅里搜一楼。");
	assert.match(refusalOf(toolResults(table.session, "apply")[0]).fix, /If an admitted effect only made sense beside a refused line, leave it out too/);
	assert.equal(table.lanes.admission.requests().length, 2);
	assert.deepEqual(kernelCalls(table, "table.apply").map((entry) => entry.params.effects), [[SEARCH]]);
});

test("§197.2 at the seam: keeper_added and player_open reach the Keeper as different fixes, and the row says which", async (t) => {
	for (const [open, asks] of [["keeper_added", false], ["player_open", true], [undefined, true]]) {
		const verdict = { verdict: "not_authorized", grounds: "g", missing: "the stop", ...(open ? { open_choice: open } : {}) };
		const table = await openTable({ responses: [call("apply", { effects: [STOP] }), ...close()], laneResponses: { admission: [fauxAssistantMessage(JSON.stringify(verdict))] } });
		t.after(() => table.dispose());
		await table.session.prompt(WORDS);
		const [result] = toolResults(table.session, "apply");
		assert.match(result.text, /^missing: "the stop"$/m, `${open}: the missing choice travels`);
		assert.equal(/in front of them in the fiction/.test(result.text), asks, `${open}: ${asks ? "asks" : "does not ask"} the player`);
		assert.equal(/carry out what they chose/.test(result.text), !asks, `${open}: carries out the player's choice`);
		assert.equal(admissionRows(table)[0].open_choice, open);
	}
});

// ---- §197.3: an NPC's act ------------------------------------------------------------------------------------------------------

test("§197.3: an NPC's hand-over names its acting party on the line the lane reads, and the lane's instruction explains that field", async (t) => {
	const HAND = { kind: "object", name: "委托信", definition: "信封", from: "Steven Knott", to: "托马斯·海耶斯", handover: "given", condition: "intact", why: "诺特把委托信递给你。" };
	const lane = recordingLane([[/acting_party="Steven Knott"/, { verdict: "not_player_action", grounds: "Knott hands it over on his own initiative" }]]);
	const table = await openTable({ responses: [call("apply", { effects: [HAND] }), ...close()], laneResponses: { admission: lane.responses } });
	t.after(() => table.dispose());
	await table.session.prompt("我问诺特委托的事。");
	assert.equal(lane.seen.length, 1);
	assert.match(lane.seen[0].proposed, /acting_party="Steven Knott" \(not an investigator\)/);
	assert.doesNotMatch(lane.seen[0].proposed, /acting_party="托马斯/, "the investigator is never an acting party");
	// The writer and the reader of the field agree on its name: the line prints it, the instruction says what it means.
	assert.match(lane.seen[0].system, /\bacting_party\b/);
	assert.match(lane.seen[0].system, /\bopen_choice\b/, "and the answer shape names the field shapeVerdict reads");
	assert.deepEqual(kernelCalls(table, "table.apply").map((entry) => entry.params.effects[0].name), ["委托信"]);
});

// ---- the TR-F2 replays -------------------------------------------------------------------------------------------------------

test("TR-F2 T1 replay: the captain's hand-over as the Keeper sent it names no giver; with the giver named (§197.3 rule C) the line says who acts", async (t) => {
	const { player, apply, lane: [row] } = TRF2.T1;
	const object = apply.effects.find((effect) => effect.kind === "object");
	const named = { ...apply, effects: apply.effects.map((effect) => effect === object ? { ...effect, from: "指挥室桌后的高大上校", handover: "given" } : effect) };
	const lane = recordingLane([[/acting_party=/, { verdict: "not_player_action", grounds: "the captain hands over the folder on his own initiative" }],
		[/name="档案袋"/, recorded(row)]]);
	const table = await openTable({ responses: [call("apply", apply), call("apply", named), ...close()], laneResponses: { admission: lane.responses } });
	t.after(() => table.dispose());
	await table.session.prompt(player);
	assert.equal(lane.seen.length, 2);
	// As sent: the hand-over lives only in `why`; the lane's recorded refusal still reads as §32.2's question, since it said nothing
	// of whose choice was open. The instruction it read now tells it to read who acts from the line as a whole.
	assert.doesNotMatch(lane.seen[0].proposed, /acting_party/);
	assert.match(lane.seen[0].proposed, /why="桌后的上尉把系着麻绳的档案袋及其中两份文件递给特派员。"/);
	assert.match(lane.seen[0].system, /A line that names no acting party may still be another person's act/);
	const [refused, landed] = toolResults(table.session, "apply");
	assert.equal(refusalOf(refused).details.missing, row.missing);
	// With the giver named: the line says who acts, and what the host does with an NPC's act is admit it.
	assert.match(lane.seen[1].proposed, /acting_party="指挥室桌后的高大上校" \(not an investigator\)/);
	assert.equal(landed.isError, false, landed.text.slice(0, 300));
	assert.deepEqual(kernelCalls(table, "table.apply")[0].params.effects.map((effect) => effect.kind), ["clock", "npc", "object"]);
});

test("TR-F2 T3 replay: the farm the player named was admitted beside the Keeper's added stop; the refusal names it and its exact resend lands", async (t) => {
	const { player, apply, lane } = TRF2.T3;
	const [farmRow, houseRow] = lane;
	const [clock, farm] = apply.effects;
	const table = await openTable({
		responses: [call("apply", apply), call("apply", { effects: [clock, farm] }), ...close("你搭车到了3号农场。")],
		laneResponses: { admission: laneByLine([[/to="production-supervisor-living-apart-from-farm"/, recorded(houseRow, { open_choice: "keeper_added" })],
			[/to="state-farm-number-three"/, recorded(farmRow), 50]]) } });
	t.after(() => table.dispose());
	await table.session.prompt(player);
	const [first, second] = toolResults(table.session, "apply");
	const refusal = refusalOf(first);
	assert.equal(refusal.details.missing, houseRow.missing);
	assert.deepEqual(refusal.details.admitted, [farm], "the farm line, verbatim");
	assert.ok(refusal.fix.startsWith(KEEPER_ADDED_FIX), "the player chose the farm: carry it out, do not ask");
	assert.doesNotMatch(first.text, /in front of them in the fiction/);
	assert.equal(second.isError, false);
	assert.equal(table.lanes.admission.requests().length, 2, "the farm was reviewed once");
	assert.deepEqual(kernelCalls(table, "table.apply").map((entry) => entry.params.effects), [[clock, farm]], "the clock rides along unreviewed");
	const rows = admissionRows(table);
	assert.equal(rows.at(-1).recovered_from, rows[0].batch_key);
});

test("TR-F2 T9 replay: the dead witness's home mapped onto another house is the Keeper's, so the Keeper is told to carry out the player's choice", async (t) => {
	const { player, apply, lane: [row] } = TRF2.T9;
	const table = await openTable({ responses: [call("apply", apply), ...close()],
		laneResponses: { admission: [fauxAssistantMessage(JSON.stringify(recorded(row, { open_choice: "keeper_added" })))] } });
	t.after(() => table.dispose());
	await table.session.prompt(player);
	const [result] = toolResults(table.session, "apply");
	assert.equal(refusalOf(result).details.reason, "action_not_authorized");
	assert.equal(refusalOf(result).fix, KEEPER_ADDED_FIX, "one reviewed line: nothing admitted beside it, no resend paragraph");
	assert.match(result.text, /move establish/, "a place the table does not have can be established");
	assert.equal(refusalOf(result).details.admitted, undefined);
});

test("TR-F2 T16 replay: the Abramov house the player named now finishes beside the refused detour, is named, and its exact resend lands", async (t) => {
	const { player, apply, lane: [farmRow] } = TRF2.T16;
	const [, house] = apply.effects;
	assert.deepEqual(TRF2.T16.line_ms, [9911, null], "on the table the house line was stopped unanswered");
	const table = await openTable({
		responses: [call("apply", apply), call("apply", { effects: [house] }), ...close("你走到最北头的阿布拉莫夫家门前，敲门。")],
		laneResponses: { admission: laneByLine([[/to="state-farm-number-three"/, recorded(farmRow, { open_choice: "keeper_added" })],
			[/to="阿布拉莫夫家的房子"/, { verdict: "authorized", grounds: "\"我现在就去最北头的阿布拉莫夫家\" names the house" }, 150]]) } });
	t.after(() => table.dispose());
	await table.session.prompt(player);
	const [first, second] = toolResults(table.session, "apply");
	assert.deepEqual(refusalOf(first).details.admitted, [house]);
	assert.equal(second.isError, false);
	assert.equal(table.lanes.admission.requests().length, 2);
	assert.deepEqual(kernelCalls(table, "table.apply").map((entry) => entry.params.effects), [[house]]);
	const rows = admissionRows(table);
	assert.equal(rows.length, 3);
	assert.deepEqual(rows[0].line_ms.map((ms) => ms !== null), [true, true], "both lines answered");
	assert.equal(rows[2].recovered_from, rows[0].batch_key);
});

// ---- on the emitted kernel ---------------------------------------------------------------------------------------------------

/** Turn 1 walked into the newspaper morgue and closed; the player speaks next at turn 2 (the emitted kernel, through its own RPC). */
function turnOneClosed(workspace) {
	kernelSteps(workspace, [["table.open", {}], ["table.player_input", { text: "我去《环球报》报馆" }],
		["table.apply", { call_id: "t1-c1", effects: [{ kind: "move", to: "newspaper-morgue" }] }],
		["table.narrate", { call_id: "t1-c2", text: "报馆的剪报室很安静。" }]]);
}
/** Turn 1 closed where the table opens, nothing moved; the player speaks next at turn 2. */
function turnOneAtOpening(workspace) {
	kernelSteps(workspace, [["table.open", {}], ["table.player_input", { text: "我把委托信再读一遍。" }],
		["table.narrate", { call_id: "t1-c1", text: "你把委托信又读了一遍。" }]]);
}
/** Puts the table in a state through the emitted kernel's own RPC, one request per step, every step required to succeed. */
function kernelSteps(workspace, steps) {
	const input = steps.map(([method, params], index) => JSON.stringify({ id: String(index), method, params: { campaign: "test-camp", ...params } })).join("\n");
	const run = spawnSync(process.execPath, [join(root, "build/kernel/rpc.mjs"), "--workspace", workspace, "--content", join(root, "content")],
		{ cwd: root, input: `${input}\n`, encoding: "utf8" });
	for (const frame of run.stdout.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line)).filter((frame) => !frame.progress))
		if (!frame.ok) throw new Error(`fixture step ${frame.id} failed: ${JSON.stringify(frame.error)}`);
}

test("§197.1 on the emitted kernel: the library the player named lands with its receipt on the resend, beside the refused stop, with no second review", async (t) => {
	const LIBRARY = { kind: "move", to: "central-library" };
	const RECORDS = { kind: "move", to: "hall-of-records", via: "顺路先去档案馆" };
	const table = await openTable({ realKernel: true, prepareWorkspace: turnOneClosed,
		responses: [call("apply", { effects: [LIBRARY, RECORDS] }), call("apply", { effects: [LIBRARY] }), ...close("你走进了中央图书馆。")],
		laneResponses: { admission: laneByLine([[/to="hall-of-records"/, { verdict: "not_authorized", grounds: "the player named the library only",
			missing: "a stop at the hall of records the player did not name", open_choice: "keeper_added" }], [/to="central-library"/, CHOSEN, 100]]) } });
	t.after(() => table.dispose());
	await table.session.prompt("我去中央图书馆查科比特宅的旧档案。");
	await waitForIdle(table.session);
	const [first, second] = toolResults(table.session, "apply");
	assert.deepEqual(refusalOf(first).details.admitted, [LIBRARY]);
	assert.equal(second.isError, false, second.text.slice(0, 400));
	const receipts = second.details.receipts ?? [];
	assert.ok(receipts.some((id) => String(id).startsWith("move:central-library")), `a move receipt (${JSON.stringify(receipts)})`);
	assert.equal(table.lanes.admission.requests().length, 2, "the resend was not reviewed again");
	const rows = admissionRows(table);
	assert.equal(rows.at(-1).recovered_from, rows[0].batch_key);
});

test("§197.1 on the App's run engine (hybrid-v1): the refused batch returns the run to the Keeper with the admitted effects in hand, and its exact resend lands with no second review", async (t) => {
	// The installed App plays on the driven loop (`runtime/loop-engine.ts`: play defaults to hybrid-v1), where a Keeper batch
	// step that falls returns the run to the Keeper (§135.5) with the run's note on the refused write (`model_refused`).
	const LIBRARY = { kind: "move", to: "central-library" };
	const RECORDS = { kind: "move", to: "hall-of-records", via: "顺路先去档案馆" };
	let resent;
	const resend = async (context) => { resent = context; return call("apply", { effects: [LIBRARY] }); };
	const engine = createHybridEngine({ env: process.env, decision: null });
	const table = await openTable({ realKernel: true, prepareWorkspace: turnOneClosed, env: { PI_COC_LOOP_ENGINE: "hybrid-v1" },
		runDriver: engine.runDriver, extraExtensions: [{ name: "coc-hybrid-engine", factory: engine.extension }],
		responses: [call("apply", { effects: [LIBRARY, RECORDS] }), resend, ...close("你走进了中央图书馆。")],
		laneResponses: { admission: laneByLine([[/to="hall-of-records"/, { verdict: "not_authorized", grounds: "the player named the library only",
			missing: "a stop at the hall of records the player did not name", open_choice: "keeper_added" }], [/to="central-library"/, CHOSEN, 100]]) } });
	t.after(() => table.dispose());
	await table.session.prompt("我去中央图书馆查科比特宅的旧档案。");
	await waitForIdle(table.session);
	assert.ok(resent, "the run went back to the Keeper after the refusal");
	// What the Keeper had in hand for its next step: the refusal's admitted effects, in the tool result it got back and in the
	// run's note on the refused write (§197.7: every key the fix names reaches the Keeper).
	const texts = (message) => (Array.isArray(message.content) ? message.content : []).map((block) => block?.text ?? "").join("");
	const returned = (resent.messages ?? []).filter((message) => message.role === "toolResult" && message.toolName === "apply").map(texts);
	assert.equal(returned.length, 1);
	assert.match(returned[0], new RegExp(`^admitted: ${JSON.stringify([LIBRARY]).replace(/[[\]{}]/g, "\\$&")}$`, "m"), "the tool result names the admitted effect");
	const notes = (resent.messages ?? []).filter((message) => message.role === "user").map(texts).flatMap((text) => {
		try { return [JSON.parse(text)]; } catch { return []; }
	}).filter((note) => note.kind === "single_loop_step" && note.model_refused);
	assert.equal(notes.length, 1, "the run's note on the refused write");
	assert.deepEqual(notes[0].model_refused[0].coc_error?.details?.admitted, [LIBRARY], "it carries the refusal whole, admitted effects included");
	const [first, second] = toolResults(table.session, "apply");
	assert.deepEqual(refusalOf(first).details.admitted, [LIBRARY]);
	assert.equal(second.isError, false, second.text.slice(0, 400));
	assert.ok((second.details.receipts ?? []).some((id) => String(id).startsWith("move:central-library")), JSON.stringify(second.details.receipts));
	assert.equal(table.lanes.admission.requests().length, 2, "the resend was not reviewed again");
	const rows = admissionRows(table);
	assert.equal(rows.at(-1).recovered_from, rows[0].batch_key);
});

// ---- §197.4: speech is not execution, and the player's own narration is (ab81805b2 read one direction only) ----------------

/** The live probe's round-3 answer for a line, as the lane would send it (its verdict fields; the grounds say where it came from). */
const probed = (id) => {
	const { of: _of, ...answer } = TRF2.probe_round3.answers[id];
	return { ...answer, grounds: `live probe round 3 (${TRF2.probe_round3.answers[id].of}), ${id}`,
		...(answer.verdict === "not_authorized" ? { missing: `probe ${id}` } : {}) };
};

test("§197.4: both reviewers read the two-way boundary, the families are bumped, and player_words is a closed field the host records and never decides on", () => {
	const prompt = admissionSystemPrompt();
	assert.ok(prompt.includes(PLAYER_EXECUTION_CHOICE_NOTE), "the lane reads the note");
	assert.ok(ADMISSION_JEV_RULES.includes(PLAYER_EXECUTION_CHOICE_NOTE), "the v1 typed rules read it");
	assert.deepEqual([ADMISSION_JEV_VERSION, ADMISSION_ROLES_VERSION], ["3", "2a.6"]);
	// The answer shape names the field shapeVerdict reads, with each of its values.
	for (const value of PLAYER_WORDS) assert.ok(prompt.includes(`"${value}"`), value);
	assert.equal(shapeVerdict({ player_words: "say", verdict: "not_authorized", grounds: "g", missing: "m" }).player_words, "say");
	assert.equal(shapeVerdict({ player_words: "shout", verdict: "authorized", grounds: "g" }).player_words, undefined, "an unknown value is dropped, not bad_output");
	assert.ok(shapeVerdict({ player_words: "shout", verdict: "authorized", grounds: "g" }), "the answer still stands");
	// The host decides nothing from it: a `say` beside an admitting verdict is still an admitting verdict.
	assert.equal(shapeVerdict({ player_words: "say", verdict: "authorized", grounds: "g" }).verdict, "authorized");
});

test("§197.4 replays on the live probe's answers: TR-F's speech line is refused; TR-F2 T3, T16 and run 3 T9's own narration and request land", async (t) => {
	const lines = [
		["TRF-t3-speech", TRF2.TRF_t3, TRF2.TRF_t3.apply.effects, false],
		["F2-T3-farm", TRF2.T3, [TRF2.T3.apply.effects[1]], true],
		["F2-T16-house", TRF2.T16, [TRF2.T16.apply.effects[1]], true],
		["R3-T9-clerk", TRF2.R3_T9, [TRF2.R3_T9.apply.effects[0]], true],
	];
	for (const [id, turn, effects, lands] of lines) {
		const table = await openTable({ responses: [call("apply", { effects }), ...close()],
			laneResponses: { admission: [fauxAssistantMessage(JSON.stringify(probed(id)))] } });
		t.after(() => table.dispose());
		await table.session.prompt(turn.player);
		const [result] = toolResults(table.session, "apply");
		assert.equal(result.isError, !lands, `${id}: ${lands ? "lands" : "is refused"}`);
		assert.equal(kernelCalls(table, "table.apply").length, lands ? 1 : 0, id);
		const [row] = admissionRows(table);
		assert.equal(row.player_words, TRF2.probe_round3.answers[id].player_words, `${id}: the row records how the reviewer read the words`);
	}
});

/** The `registered_destination` a move line carries to the reviewer, parsed from the line as the lane reads it. */
const registeredOn = (line) => JSON.parse(/; registered_destination=(\{.*\})$/.exec(line)?.[1] ?? "null");

test("run 3 T1 replay on the emitted kernel: the archive room the player named reaches the reviewer with the place's other names, and on the probe's answer it lands", async (t) => {
	// §197.5: the table's reviewer refused 「波士顿环球报的档案室」 as "not a listed name" while the line it read listed
	// "Globe clipping archive" among the place's other names. The host's half is that those names travel on the line, the
	// same ones the table's reviewer was shown; reading them by meaning across languages is the reviewer's (§197.9).
	const { player, apply, lane: [row] } = TRF2.R3_T1;
	const shown = registeredOn(row.proposed[0]);
	const lane = recordingLane([[/to="newspaper-morgue"/, probed("R3-T1-alias")]]);
	const table = await openTable({ realKernel: true, prepareWorkspace: turnOneAtOpening,
		responses: [call("apply", apply), ...close("你到了《环球报》的剪报档案室。")], laneResponses: { admission: lane.responses } });
	t.after(() => table.dispose());
	await table.session.prompt(player);
	await waitForIdle(table.session);
	assert.equal(lane.seen.length, 1);
	const line = lane.seen[0].proposed.split("\n").find((value) => value.startsWith("- apply move:")) ?? "";
	const registered = registeredOn(line);
	assert.ok(registered, `the move line carries the registered destination (${line.slice(0, 200)})`);
	assert.equal(registered.canonical_name, shown.canonical_name);
	assert.deepEqual(registered.also_called, shown.also_called, "the names the table's reviewer was shown, alias included");
	const [result] = toolResults(table.session, "apply");
	assert.equal(result.isError, false, result.text.slice(0, 400));
	assert.ok((result.details.receipts ?? []).some((id) => String(id).startsWith("move:newspaper-morgue")), JSON.stringify(result.details.receipts));
	const [admission] = admissionRows(table);
	assert.deepEqual([admission.verdict, admission.admitted, admission.player_words], ["authorized", true, "narrate"]);
});

test("run 3 T12 replay: the journal the player searched for finishes beside the refused tome, is named, and its exact resend lands", async (t) => {
	const { player, apply, lane: [tome] } = TRF2.R3_T12;
	const [journal] = apply.effects;
	const table = await openTable({
		responses: [call("apply", apply), call("apply", { effects: [journal] }), ...close()],
		laneResponses: { admission: laneByLine([[/liber-ivonis-tome/, recorded(tome)], [/chapel-journal-burial/, probed("R3-T12-journal"), 50]]) } });
	t.after(() => table.dispose());
	await table.session.prompt(player);
	const [first, second] = toolResults(table.session, "apply");
	assert.equal(refusalOf(first).details.missing, tome.missing, "the table's recorded refusal of the tome");
	assert.deepEqual(refusalOf(first).details.admitted, [journal], "the journal, which on the table was stopped unanswered");
	assert.equal(second.isError, false);
	assert.equal(table.lanes.admission.requests().length, 2);
	assert.deepEqual(kernelCalls(table, "table.apply").map((entry) => entry.params.effects), [[journal]]);
});

test("run 3 T16 replay: the move into the cellar the player held back from landed on the recorded verdict; on the probe's answer (hold) it is the Keeper's addition and nothing lands", async (t) => {
	const { player, apply, lane: [row] } = TRF2.R3_T16;
	for (const [answer, lands] of [[recorded(row), true], [probed("R3-T16-holdback"), false]]) {
		const table = await openTable({ responses: [call("apply", apply), ...close()], laneResponses: { admission: [fauxAssistantMessage(JSON.stringify(answer))] } });
		t.after(() => table.dispose());
		await table.session.prompt(player);
		const [result] = toolResults(table.session, "apply");
		assert.equal(kernelCalls(table, "table.apply").length, lands ? 1 : 0);
		if (!lands) {
			assert.equal(refusalOf(result).fix, KEEPER_ADDED_FIX, "carry out what the player chose -- look down from the door -- without asking");
			assert.equal(admissionRows(table)[0].player_words, "hold");
		}
	}
});
