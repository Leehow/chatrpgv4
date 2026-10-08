/**
 * SL-104, a line is reviewed beside its batch, and its verdict is kept only beside the same batch (contract §32.12.3.1.1).
 *
 * The installed App's turn 25 (campaign game-5d82fd23): the Keeper's `time minutes=55` + `move to=martins-beach-field` was
 * reviewed one line per call (§32.12.3.1). The time line, read alone, was refused for "only reaching the fishing village"
 * -- the move's destination, which that call never saw -- and when the Keeper changed the destination the refusal was
 * reused (`reused: true`, `ms: 0`) under the time line's key, which carried neither the move nor its own `why`.
 *
 * - A: each line's call reads the call's other reviewed lines under their own heading, before `[The Keeper now proposes]`,
 *   which still holds that one line. A line refused beside its batch is remembered with it.
 * - B: a line's key is the key a call of only that line would have, extended by its batch-mates' signatures, order-free:
 *   an identical or `why`-only resend reuses every line; a resend whose batch-mates changed reviews its lines again.
 *
 * The seam: the real `apply` tool and admission seam, the fake kernel, and a scripted `admission/a1` lane that answers by
 * the line it is asked about *and* the lines beside it, so a verdict that depends on a batch-mate is observable.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { admissionProposes, openTable } from "./harness.mjs";
import {
	BESIDE_HEADING,
	admissionRequest,
	besideBatch,
	buildAdmissionInput,
	effectSignature,
	keyDigest,
	lineProposal,
} from "../../extensions/kernel/admission.ts";

const call = (name, args) => fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" });
const close = (text) => [call("narrate", { text }), fauxAssistantMessage("after")];
const kernelCalls = (table, method) => table.kernelRequests().filter((entry) => entry.method === method);
const admissionRows = (table) => table.telemetry().filter((row) => row.lane === "admission");
const userText = (context) => (context?.messages ?? []).flatMap((message) => (message.role === "user" ? message.content : [])).map((block) => block.text ?? "").join("");
const toolResults = (session, tool) => session.messages.filter((message) => message.role === "toolResult" && message.toolName === tool)
	.map((message) => ({ isError: message.isError, details: message.details }));
/** The lines under the beside heading of one lane input (§32.12.3.1.1), `[]` when it has none. */
const besideOf = (text) => {
	const at = String(text).indexOf(BESIDE_HEADING);
	if (at < 0) return [];
	const block = String(text).slice(at + BESIDE_HEADING.length, String(text).indexOf("[The Keeper now proposes]"));
	return block.split("\n").filter((line) => line.startsWith("- ")).map((line) => line.slice(2));
};
const proposedOf = (text) => admissionProposes(text).split("\n").filter((line) => line.startsWith("- ")).map((line) => line.slice(2));
const refusedOf = (text) => {
	const at = String(text).indexOf("[Already refused this turn]");
	return String(text).slice(at, String(text).indexOf("\n\n", at));
};

/**
 * A scripted lane that answers by the one proposed line and the lines beside it: `decide({proposed, beside, text, seen})`
 * returns the verdict row (or a string, sent as is), or `[row, ms]` to answer after `ms`; `seen` counts the calls so far
 * about the same proposed line's kind. A line refused `not_authorized` decides its batch at once (§32.12.3.1), so a test
 * that needs one line's refusal on record makes its batch-mates answer later.
 */
function laneReading(decide, count = 16) {
	const seen = new Map();
	const step = async (context) => {
		const text = userText(context), proposed = proposedOf(text)[0] ?? "", beside = besideOf(text);
		const kind = proposed.split(":")[0];
		seen.set(kind, (seen.get(kind) ?? 0) + 1);
		const answer = decide({ proposed, beside, text, seen: seen.get(kind) });
		const [row, ms] = Array.isArray(answer) ? answer : [answer, 0];
		if (ms) await new Promise((resolve) => setTimeout(resolve, ms));
		return fauxAssistantMessage(typeof row === "string" ? row : JSON.stringify(row));
	};
	return Array.from({ length: count }, () => step);
}
const line = (row) => row.lines?.[0];

// ---- turn 25, reconstructed from the installed App's admission rows ----------------------------------------------------

const T25_WORDS = "我把报纸折好收进大衣内袋，向摊主打听去马丁滩怎么走，然后动身前往马丁滩，想亲眼看看波街公墓。";
const T25_TIME = { kind: "time", minutes: 55, why: "向摊主问清出城往马丁滩的路，驾车沿近郊公路抵达渔村" };
const T25_MOVE = { kind: "move", to: "martins-beach-field", via: "从阿卡姆街角报摊沿近郊公路驾车出城，循路牌与乡道抵达马丁滩", travel_minutes: 0, label: "马丁滩实地调查" };
// The Keeper's resend: the destination changed to the cemetery, the time's `why` rewritten, its minutes the same.
const T25_TIME_AGAIN = { ...T25_TIME, why: "向摊主问清出城往马丁滩的路，驾车抵达渔村并直至波街公墓" };
const T25_MOVE_AGAIN = { kind: "move", to: "poe-cemetery-visit", via: "驾车出城抵达马丁滩，再沿波街步行到公墓", travel_minutes: 0, label: "波街公墓" };

// ---- the pure rules ------------------------------------------------------------------------------------------------------

test("§32.12.3.1.1 pure: a line's beside is its reviewed batch-mates; the key carries them order-free; a lone line is what it was", () => {
	const scope = { party: ["Thomas Hayes"] };
	const person = { kind: "person", who: "Constable Tabler", why: "Named at the roadside." };
	const batch = admissionRequest("apply", { effects: [T25_TIME, person, T25_MOVE] }, scope);
	assert.deepEqual(batch.effects, [0, 2], "the person is not reviewed, so it is nobody's batch-mate");
	assert.deepEqual(batch.signatures, [effectSignature(T25_TIME), effectSignature(T25_MOVE)]);

	const time = lineProposal(batch, 0), move = lineProposal(batch, 1);
	assert.deepEqual([time.lines, time.kinds, time.effects, time.signatures], [[batch.lines[0]], ["time"], [0], [effectSignature(T25_TIME)]]);
	assert.deepEqual(time.beside, { lines: [batch.lines[1]], signatures: [effectSignature(T25_MOVE)] });
	assert.deepEqual(move.beside, { lines: [batch.lines[0]], signatures: [effectSignature(T25_TIME)] });
	// A proposal already proposed beside other lines hands them on to each of its lines.
	const nested = lineProposal({ ...batch, beside: { lines: ["apply clue: x"], signatures: ["sx"] } }, 1);
	assert.deepEqual(nested.beside, { lines: [batch.lines[0], "apply clue: x"], signatures: [effectSignature(T25_TIME), "sx"] });

	const alone = admissionRequest("apply", { effects: [T25_TIME] }, scope);
	assert.equal(besideBatch(alone, undefined), alone, "no batch-mates: the proposal as it was");
	assert.equal(besideBatch(alone, { lines: [], signatures: [] }), alone);
	const beside = besideBatch(alone, time.beside);
	assert.notEqual(beside.key, alone.key, "a line of a larger batch never has a one-line call's key");
	assert.deepEqual(beside.beside, time.beside);
	const two = besideBatch(alone, { lines: ["a", "b"], signatures: ["sa", "sb"] });
	assert.equal(besideBatch(alone, { lines: ["b", "a"], signatures: ["sb", "sa"] }).key, two.key, "order-free");
	assert.notEqual(besideBatch(alone, { lines: ["a"], signatures: ["sa"] }).key, two.key, "a batch-mate dropped is a different key");
	const reworded = admissionRequest("apply", { effects: [T25_TIME_AGAIN] }, scope);
	assert.equal(besideBatch(reworded, time.beside).key, beside.key, "the line's own why stays outside the key");
	const movedTo = admissionRequest("apply", { effects: [T25_TIME, person, T25_MOVE_AGAIN] }, scope);
	assert.notEqual(besideBatch(alone, lineProposal(movedTo, 0).beside).key, beside.key, "a batch-mate's destination is inside it");
	const rewordedMate = admissionRequest("apply", { effects: [T25_TIME, { ...T25_MOVE, why: "the road the player named" }] }, scope);
	assert.equal(besideBatch(alone, lineProposal(rewordedMate, 0).beside).key, beside.key,
		"a batch-mate's fields outside effectSignature (its why) are outside it too");
	// §32.4.1: a move's `via` is its route, inside effectSignature, so a batch-mate that takes another road is another batch.
	const reroutedMate = admissionRequest("apply", { effects: [T25_TIME, { ...T25_MOVE, via: "another road" }] }, scope);
	assert.notEqual(besideBatch(alone, lineProposal(reroutedMate, 0).beside).key, beside.key, "a batch-mate's via is inside it");
});

test("§32.12.3.1.1 pure: the batch-mates are read under their heading before the proposed line; a lone proposal's input is what it was", () => {
	const scope = { party: ["Thomas Hayes"] };
	const context = { turn: 25, playerText: T25_WORDS, investigators: [{ name: "Thomas Hayes", occupation: "Journalist" }], present: [],
		delivered: [], landed: [], refused: [] };
	const batch = admissionRequest("apply", { effects: [T25_TIME, T25_MOVE] }, scope);
	const input = buildAdmissionInput(lineProposal(batch, 0), context);
	assert.ok(input.indexOf("[Already refused this turn]") < input.indexOf(BESIDE_HEADING));
	assert.ok(input.indexOf(BESIDE_HEADING) < input.indexOf("[The Keeper now proposes]"));
	assert.deepEqual(besideOf(input), [batch.lines[1]]);
	assert.deepEqual(proposedOf(input), [batch.lines[0]], "the call still proposes exactly its own line");
	const alone = buildAdmissionInput(admissionRequest("apply", { effects: [T25_TIME] }, scope), context);
	assert.ok(!alone.includes(BESIDE_HEADING));
	assert.equal(input.replace(`${BESIDE_HEADING}\n- ${batch.lines[1]}\n\n`, ""), alone, "the heading and the lines are all that was added");
	const resolve = admissionRequest("resolve", { action: { intent: "social", skill: "Persuade", target: "Tabler" } }, scope);
	assert.ok(!buildAdmissionInput(resolve, context).includes(BESIDE_HEADING));
});

// ---- the seam: turn 25 -------------------------------------------------------------------------------------------------------

test("§32.12.3.1.1 turn 25: the time line is read beside the move; with the destination changed it is reviewed again, not reused", async (t) => {
	// The lane of this test reads the time line against the move beside it, as the live lane should have: the fishing
	// village is not where the player said they wanted to go, the cemetery is.
	const lane = laneReading(({ proposed, beside }) => {
		if (proposed.startsWith("apply move")) return { verdict: "authorized", grounds: "the player set out for Martin's Beach" };
		if (beside.some((line) => line.includes("poe-cemetery-visit"))) return { verdict: "entailed", grounds: "the drive to the cemetery the player chose" };
		return { verdict: "not_authorized", grounds: "only reaches the fishing village, not the cemetery", missing: "whether to go on to the cemetery" };
	});
	const table = await openTable({
		responses: [call("apply", { effects: [T25_TIME, T25_MOVE] }), call("apply", { effects: [T25_TIME_AGAIN, T25_MOVE_AGAIN] }),
			...close("你按摊主指的路开出城去。")],
		laneResponses: { admission: lane } });
	t.after(() => table.dispose());
	await table.session.prompt(T25_WORDS);

	const requests = table.lanes.admission.requests();
	assert.equal(requests.length, 4, "two lines, twice: the resend's lines were reviewed again");
	const [firstTime, firstMove] = [requests.slice(0, 2).find((text) => /^apply time/.test(proposedOf(text)[0])), requests.slice(0, 2).find((text) => /^apply move/.test(proposedOf(text)[0]))];
	// A: each line's call reads the other.
	assert.equal(proposedOf(firstTime).length, 1);
	assert.deepEqual(besideOf(firstTime).map((line) => line.split(";")[0]), ['apply move: to="martins-beach-field"'], "the time line is read beside the move");
	assert.deepEqual(besideOf(firstMove).map((line) => line.split(";")[0]), ["apply time: minutes=55"], "the move is read beside the time line");
	const againTime = requests.slice(2).find((text) => /^apply time/.test(proposedOf(text)[0]));
	assert.ok(againTime, "the time line was put to the lane again");
	assert.deepEqual(besideOf(againTime).map((line) => line.split(";")[0]), ['apply move: to="poe-cemetery-visit"']);
	// The earlier refusal is remembered with the move it was refused beside.
	assert.match(refusedOf(againTime), /apply time: minutes=55; why="[^"]*抵达渔村" \[beside: apply move: to="martins-beach-field"[^\]]*\] -> not_authorized: whether to go on to the cemetery/);

	const [first, second] = toolResults(table.session, "apply");
	assert.equal(first.details.coc_error.details.reason, "action_not_authorized");
	assert.equal(second.isError, false, "the batch the player chose landed");
	assert.deepEqual(kernelCalls(table, "table.apply").map((entry) => entry.params.effects.map((effect) => effect.to ?? effect.kind)), [["time", "poe-cemetery-visit"]]);

	// B: the time line's rows -- refused, then reviewed again under another key.
	const timeRows = admissionRows(table).filter((row) => /^apply time/.test(row.proposed[0]));
	assert.deepEqual(timeRows.map((row) => [row.verdict, row.reused, row.batch_admitted]), [["not_authorized", false, false], ["entailed", false, true]]);
	assert.notEqual(timeRows[0].key, timeRows[1].key, "the key carries the batch-mate");
	assert.ok(timeRows.every((row) => row.line_level === "line" && row.of_lines === 2));
});

// ---- the seam: B on other kinds -----------------------------------------------------------------------------------------------

const STORE_WORDS = "I'll take the brass lantern for the two dollars he said.";
const LANTERN = { kind: "item", name: "brass lantern", from: "Storekeeper", why: "Bought over the counter." };
const REVOLVER = { kind: "item", name: ".38 revolver", from: "Storekeeper", why: "Bought over the counter." };
const PAY = { kind: "cash", delta: -2, source: "quote", with: "Storekeeper", why: "The price he named." };

test("§32.12.3.1.1 cash beside an item: a why-only resend is refused at once; with the item changed the cash line is reviewed again", async (t) => {
	// The debit is judged against what it pays for: two dollars for the lantern the player asked for is theirs, for a
	// revolver they never asked for it is not.
	const lane = laneReading(({ proposed, beside }) => {
		const lantern = (line) => line.includes("brass lantern");
		if (proposed.startsWith("apply item")) return lantern(proposed) ? { verdict: "authorized", grounds: "the lantern he asked for" }
			: [{ verdict: "not_authorized", grounds: "he asked for the lantern", missing: "whether to buy a revolver" }, 150];
		return beside.some(lantern) ? { verdict: "authorized", grounds: "the quoted two dollars for the lantern" }
			: { verdict: "not_authorized", grounds: "two dollars for a thing he did not ask for", missing: "whether to pay for a revolver" };
	});
	const table = await openTable({
		responses: [call("apply", { effects: [REVOLVER, PAY] }),
			call("apply", { effects: [{ ...REVOLVER, why: "He wanted something to carry." }, { ...PAY, why: "As quoted." }] }),
			call("apply", { effects: [LANTERN, PAY] }), ...close("The storekeeper wraps the lantern.")],
		laneResponses: { admission: lane } });
	t.after(() => table.dispose());
	await table.session.prompt(STORE_WORDS);

	const [first, reworded, changed] = toolResults(table.session, "apply");
	assert.equal(first.details.coc_error.details.reason, "action_not_authorized");
	assert.equal(reworded.details.coc_error.details.reason, "action_not_authorized", "the why-only resend is the same batch");
	assert.equal(changed.isError, false);
	const requests = table.lanes.admission.requests();
	assert.equal(requests.length, 4, "two calls for the first batch, none for the why-only resend, two for the changed one");
	const paidFor = requests.filter((text) => /^apply cash/.test(proposedOf(text)[0])).map((text) => besideOf(text).map((line) => line.split(";")[0]));
	assert.deepEqual(paidFor, [['apply item: name=".38 revolver"'], ['apply item: name="brass lantern"']], "each cash call read what it pays for");

	const cashRows = admissionRows(table).filter((row) => /^apply cash/.test(row.proposed[0]));
	assert.deepEqual(cashRows.map((row) => [row.verdict, row.reused]), [["not_authorized", false], ["not_authorized", true], ["authorized", false]],
		"refused beside the revolver, refused at once on the why-only resend, reviewed again beside the lantern");
	assert.notEqual(cashRows[2].key, cashRows[0].key, "the key carries the item it pays for");
	const reusedRows = admissionRows(table).filter((row) => row.reused);
	// §197.1: the revolver line no longer stops when the cash line refuses first; it finishes, refused on its own, so the
	// why-only resend is refused at once on both kept lines.
	assert.deepEqual(reusedRows.map((row) => [row.verdict, row.proposed[0].split(";")[0]]),
		[["not_authorized", 'apply item: name=".38 revolver"'], ["not_authorized", "apply cash: delta=-2"]],
		"the why-only resend was refused at once on the kept lines, under the same keys");
	assert.equal(reusedRows[1].key, cashRows[0].key, "a why-only change is outside the key, the line's and its batch-mate's");
	assert.deepEqual(kernelCalls(table, "table.apply").map((entry) => entry.params.effects.map((effect) => effect.name ?? effect.kind)), [["brass lantern", "cash"]]);
});

test("§32.12.3.1.1 a clue beside a move: with the move's target changed the clue line is reviewed again", async (t) => {
	const MORGUE_WORDS = "I go to the newspaper morgue and look for the old fire reports.";
	const CLIPPING = { kind: "clue", clue: "globe-fire-cutoff", how: "A clipping in the morgue's fire file." };
	const lane = laneReading(({ proposed, beside }) => {
		const morgue = (line) => line.includes("newspaper-morgue");
		if (proposed.startsWith("apply move")) return morgue(proposed) ? { verdict: "authorized", grounds: "the morgue he named" }
			: [{ verdict: "not_authorized", grounds: "he named the morgue", missing: "whether to go to the station" }, 150];
		return beside.some(morgue) ? { verdict: "entailed", grounds: "the fire reports he went to read" }
			: { verdict: "not_authorized", grounds: "read at a place he did not choose", missing: "whether to go to the station" };
	});
	const table = await openTable({
		responses: [call("apply", { effects: [{ kind: "move", to: "police-station" }, CLIPPING] }),
			call("apply", { effects: [{ kind: "move", to: "newspaper-morgue" }, CLIPPING] }), ...close("You find the file.")],
		laneResponses: { admission: lane } });
	t.after(() => table.dispose());
	await table.session.prompt(MORGUE_WORDS);
	const clueRows = admissionRows(table).filter((row) => /^apply clue/.test(row.proposed[0]));
	assert.deepEqual(clueRows.map((row) => [row.verdict, row.reused]), [["not_authorized", false], ["entailed", false]]);
	assert.equal(table.lanes.admission.requests().length, 4);
	assert.deepEqual(kernelCalls(table, "table.apply").map((entry) => entry.params.effects.map((effect) => effect.to ?? effect.clue)), [["newspaper-morgue", "globe-fire-cutoff"]]);
});

// ---- lines known and lines not -------------------------------------------------------------------------------------------------

test("§32.12.3.1.1: a line whose review failed is reviewed on the resend beside its known batch-mate, under the key a whole review uses", async (t) => {
	// The cash line's first round answers malformed twice (§143.15: one retry), so it keeps no verdict; the item line's does.
	const lane = laneReading(({ proposed, seen }) => proposed.startsWith("apply cash") && seen <= 2 ? "not json at all"
		: { verdict: "authorized", grounds: "the lantern and its quoted price" });
	const table = await openTable({
		responses: [call("apply", { effects: [LANTERN, PAY] }),
			call("apply", { effects: [{ ...LANTERN, why: "The lantern he pointed at." }, PAY] }), ...close("The storekeeper wraps the lantern.")],
		laneResponses: { admission: lane } });
	t.after(() => table.dispose());
	await table.session.prompt(STORE_WORDS);

	const [first, second] = toolResults(table.session, "apply");
	assert.equal(first.details.coc_error.details.reason, "admission_unavailable");
	assert.equal(second.isError, false);
	const requests = table.lanes.admission.requests();
	assert.equal(requests.length, 4, "item once, cash twice malformed, cash once more on the resend; the item was not reviewed again");
	const resent = requests[3];
	assert.match(proposedOf(resent)[0], /^apply cash/);
	assert.deepEqual(besideOf(resent).map((line) => line.split(";")[0]), ['apply item: name="brass lantern"'], "read beside the known item line");
	assert.match(besideOf(resent)[0], /The lantern he pointed at/, "as the resend proposes it");

	const rows = admissionRows(table);
	const cash = rows.filter((row) => line(row) === 2);
	assert.deepEqual(cash.map((row) => [row.ok, row.reason ?? row.verdict]), [[false, "bad_output"], [true, "authorized"]]);
	assert.equal(cash[1].key, cash[0].key, "the resend's cash line is kept under the key the whole batch's review gave it");
	const item = rows.filter((row) => line(row) === 1);
	assert.deepEqual(item.map((row) => [row.verdict, row.reused]), [["authorized", false], ["authorized", true]], "the item line reused beside the same cash line");
	const keyed = besideBatch(admissionRequest("apply", { effects: [PAY] }, { party: [] }), { lines: ["item"], signatures: [effectSignature(LANTERN)] });
	assert.equal(cash[1].key, keyDigest(keyed.key), "the key is the lone cash key extended by the item's signature");
	assert.deepEqual(kernelCalls(table, "table.apply").map((entry) => entry.params.effects.map((effect) => effect.name ?? effect.kind)), [["brass lantern", "cash"]]);
});
