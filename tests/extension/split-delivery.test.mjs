/**
 * A delivery written in two halves (contract §34.17).
 *
 * Retained live evidence, A-MAIN turn 39, 2026-09-16 (`playtest-evidence/pipicoc-20260914`). One
 * assistant message carried two `narrate` calls — the campaign's own telemetry records the shape:
 *
 *   {"turn":39,"lane":"provider-call","blocks":["thinking","toolCall","toolCall"]}
 *   {"turn":39,"tool":"narrate","call_id":"t39-c3","ok":true}
 *   {"turn":39,"tool":"narrate","event":"turn-closed"}
 *   {"turn":39,"tool":"narrate","ok":false,"code":"blocked","blocked_after_close":1}
 *
 * The first landed and closed the turn; its `rendered_text` ends, verbatim, on a colon, because the
 * line of speech was in the second. The second was refused, correctly. Receipts had landed, so this
 * was not an empty turn and nothing treated it as one — the player simply read a sentence that
 * stops, and was told nothing at all.
 *
 * The signal used here is the shape of the assistant message, never its words: two `narrate` calls
 * in one message is always a turn delivered in halves, whatever language the halves are in. No
 * punctuation is inspected and no language is detected.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { assistantTexts, customMessages, openTable, toolResultTexts, waitForIdle } from "./harness.mjs";

/** The live shape: one message, two narrate calls, the second carrying the rest of the line. */
const split = (first, second) =>
	fauxAssistantMessage([fauxToolCall("narrate", { text: first }), fauxToolCall("narrate", { text: second })],
		{ stopReason: "toolUse" });

const whole = (text) => [
	fauxAssistantMessage([fauxToolCall("narrate", { text })], { stopReason: "toolUse" }),
	fauxAssistantMessage("Should never be consumed."),
];

const cutShort = (session) =>
	customMessages(session.session, "coc-delivery").filter((message) => message.details.delivery_cut_short);

test("a delivery split across two narrate calls is refused before either half lands", async (t) => {
	const session = await openTable({
		responses: [split("你压着嗓子说：", "「四只画押了。」"), ...whole("你压着嗓子说：「四只画押了。」")],
	});
	t.after(() => session.dispose());
	await session.session.prompt("我跟莱维特说那句话。");
	await waitForIdle(session.session);

	const rows = session.telemetry();
	const refused = rows.filter((row) => row.code === "blocked" && row.reason === "split_delivery");
	assert.equal(refused.length, 2, `both halves are refused, not just the second: ${JSON.stringify(refused)}`);
	assert.equal(refused[0].narrate_calls, 2);
	// The refusal says what to do instead, in one sentence the Keeper can act on.
	assert.ok(toolResultTexts(session.session).some((text) => /single narrate/.test(text)),
		JSON.stringify(toolResultTexts(session.session)));

	// And the whole delivery does land, on the next round trip.
	assert.ok(assistantTexts(session.session).includes("你压着嗓子说：「四只画押了。」"),
		JSON.stringify(assistantTexts(session.session)));
	// Nothing was truncated, so the player is told nothing: this is the repair, not a notice.
	assert.deepEqual(cutShort(session), []);
	assert.ok(!rows.some((row) => row.blocked_after_close), JSON.stringify(rows));
});

test("an ordinary single-narrate turn is untouched", async (t) => {
	const session = await openTable({ responses: whole("门厅里落满灰。") });
	t.after(() => session.dispose());
	await session.session.prompt("我推门进去。");
	await waitForIdle(session.session);

	assert.deepEqual(session.telemetry().filter((row) => row.reason === "split_delivery"), []);
	assert.ok(assistantTexts(session.session).includes("门厅里落满灰。"));
	assert.deepEqual(cutShort(session), []);
});

test("a second split in the same turn delivers the first half and tells the player it stops there", async (t) => {
	// The refusal is spent once per turn, so a Keeper that writes two halves again cannot be left
	// unable to deliver at all. That is exactly the live case, and the player is owed the fact.
	const session = await openTable({
		responses: [
			split("你压着嗓子说：", "「四只画押了。」"),
			split("你压着嗓子说：", "「四只画押了。」"),
			fauxAssistantMessage("Should never be consumed."),
		],
	});
	t.after(() => session.dispose());
	await session.session.prompt("我跟莱维特说那句话。");
	await waitForIdle(session.session);

	const rows = session.telemetry();
	// The first half landed and closed the turn; the continuation was blocked after close.
	assert.ok(rows.some((row) => row.tool === "narrate" && row.event === "turn-closed"), JSON.stringify(rows));
	const blocked = rows.filter((row) => row.blocked_after_close);
	assert.equal(blocked.length, 1, JSON.stringify(blocked));
	assert.equal(blocked[0].delivery_cut_short, true, "the host already knew the refused call was a delivery");

	// And says so, once, as a service notice rather than as fiction.
	const told = cutShort(session);
	assert.equal(told.length, 1, JSON.stringify(customMessages(session.session, "coc-delivery")));
	assert.equal(told[0].details.turn, 1);
	assert.ok(told[0].content.trim() && !/^delivery_cut_short_notice$/.test(told[0].content.trim()),
		`a caption the surface lacks renders as its key, which is a gap and not a notice: ${told[0].content}`);
	assert.ok(rows.some((row) => row.lane === "delivery" && row.reason === "delivery_cut_short_notice"),
		JSON.stringify(rows.filter((row) => row.lane === "delivery")));
});

test("a tool blocked after close that is not a delivery says nothing to the player", async (t) => {
	// §34.16's runaway: look/resolve/apply after the turn closed is a Keeper that did not stop, not a
	// delivery cut in half, and the player has nothing to be told about it.
	const session = await openTable({
		responses: [
			fauxAssistantMessage([fauxToolCall("narrate", { text: "门厅里落满灰。" }), fauxToolCall("look", { kind: "scene" })],
				{ stopReason: "toolUse" }),
			fauxAssistantMessage("Should never be consumed."),
		],
	});
	t.after(() => session.dispose());
	await session.session.prompt("我推门进去。");
	await waitForIdle(session.session);

	const blocked = session.telemetry().filter((row) => row.blocked_after_close);
	assert.equal(blocked.length, 1, JSON.stringify(blocked));
	assert.equal(blocked[0].delivery_cut_short, undefined);
	assert.deepEqual(cutShort(session), []);
});
