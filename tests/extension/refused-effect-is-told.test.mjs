/**
 * A refused effect whose answer the delivery could not carry (contract §78).
 *
 * Retained live evidence, H-SIDE `t4`, campaign `game-1c0faba5` (`playtest-evidence/pipicoc-20260914`).
 * Turn 103 is the whole shape in four telemetry rows:
 *
 *   {"turn":103,"lane":"provider-call","blocks":["thinking","toolCall","toolCall"]}
 *   {"turn":103,"tool":"narrate","call_id":"t103-c2","ok":true}
 *   {"turn":103,"tool":"narrate","event":"turn-closed"}
 *   {"turn":103,"tool":"apply","ok":false,"code":"blocked","blocked_after_close":1}
 *
 * One assistant message carried the closing `narrate` and, behind it, the `apply` that turns 95-103
 * existed for: writing one precise location onto an already-filed complaint. The narrate closed the
 * turn, the apply was correctly refused, and `object-item-15` kept `changed_turn: 92` -- eleven
 * turns stale, with the player reading that the line had been filed. Nothing on any surface a
 * player can see said otherwise. That is what these pin: not the refusal, which is right, but a
 * delivery written before the host's answer to the effect existed.
 *
 * Every signal here is the shape of the assistant message and the verb of the call. No prose is
 * read, no words are matched, no language is detected -- the host has no way to know what a
 * delivery claimed, and §78 is built so that it never needs one.
 *
 * The measurement that sized this: across the 590 assistant messages of that table a `narrate`
 * shared its message with an effect verb exactly twice, turn 0 and turn 103, and both times the
 * narrate came first. Refusing that shape costs a real table nothing.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { assistantTexts, customMessages, openTable, toolResultTexts, waitForIdle } from "./harness.mjs";

const verdict = (row) => fauxAssistantMessage(JSON.stringify(row));
const NOTE = [{ kind: "clue", clue: "complaint-135-exact-location" }];
const FILED = "职员把那一行夹进正联。";

/** The live shape: the delivery, and behind it the effect that can no longer land. */
const deliveryThenEffect = () =>
	fauxAssistantMessage([fauxToolCall("narrate", { text: FILED }), fauxToolCall("apply", { effects: NOTE })],
		{ stopReason: "toolUse" });

/** Its mirror: the effect first, and behind it a delivery written before the answer existed. */
const effectThenDelivery = () =>
	fauxAssistantMessage([fauxToolCall("apply", { effects: NOTE }), fauxToolCall("narrate", { text: FILED })],
		{ stopReason: "toolUse" });

const refusingReview = {
	admission: [verdict({ verdict: "not_authorized", grounds: "the player asked; the clerk had not agreed", missing: "whether the clerk files it" })],
};

const told = (session) =>
	customMessages(session.session, "coc-delivery").filter((message) => message.details.refused_effect);
const visibleTexts = (session) => [
	...assistantTexts(session.session),
	...customMessages(session.session, "coc-delivery").map((message) => message.content),
];
const applies = (session) => session.kernelRequests().filter((entry) => entry.method === "table.apply").length;
const closed = (rows) => rows.some((row) => row.tool === "narrate" && row.event === "turn-closed");

// The terminal ask is a closed option that still exists. A combat-defence ask does not: §11.5.1
// "The combat choice buttons are retired for new player defenses", and the host refuses one as stale
// before it can deliver (§11.5: investigator defence is settled by the standing preference, never `ask`).
for (const [tool, input] of [
	["narrate", { text: FILED }],
	["ask", { kind: "mechanics", text: "职员摇头，说这一行找不到了。", options: ["push", "accept"] }],
]) {
	test(`a successful terminal ${tool} delivery ends the batch before a post-close provider call`, async (t) => {
		const session = await openTable({
			responses: [
				fauxAssistantMessage([fauxToolCall(tool, input)], { stopReason: "toolUse" }),
				fauxAssistantMessage([fauxToolCall("apply", { effects: NOTE })], { stopReason: "toolUse" }),
			],
		});
		t.after(() => session.dispose());
		await session.session.prompt("我请他把位置写准。");
		await waitForIdle(session.session);

		const rows = session.telemetry();
		assert.equal(rows.filter((row) => row.lane === "provider-call").length, 1,
			`the terminal delivery must not buy a second Keeper call: ${JSON.stringify(rows)}`);
		assert.deepEqual(rows.filter((row) => row.blocked_after_close), [],
			`no post-close call should exist: ${JSON.stringify(rows)}`);
		assert.equal(applies(session), 0, "the scripted second response must remain unconsumed");
		assert.deepEqual(told(session), [], "a valid terminal delivery needs no refused-effect repair notice");
	});
}

test("a delivery written ahead of an effect is refused whole, so the effect is answered before the door closes", async (t) => {
	const session = await openTable({
		responses: [
			deliveryThenEffect(),
			fauxAssistantMessage([fauxToolCall("apply", { effects: NOTE })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: FILED })], { stopReason: "toolUse" }),
			fauxAssistantMessage("Should never be consumed."),
		],
	});
	t.after(() => session.dispose());
	await session.session.prompt("我请他把位置写准。");
	await waitForIdle(session.session);

	const rows = session.telemetry();
	const refused = rows.filter((row) => row.code === "blocked" && row.reason === "effect_behind_delivery");
	assert.equal(refused.length, 2, `both calls of the message are refused, not just the effect: ${JSON.stringify(refused)}`);
	// Refusing only the effect would publish exactly the turn this exists to prevent.
	assert.ok(!rows.some((row) => row.blocked_after_close), JSON.stringify(rows));
	// The refusal says what to send instead, in one sentence the Keeper can act on.
	assert.ok(toolResultTexts(session.session).some((text) => /before the narrate/.test(text)),
		JSON.stringify(toolResultTexts(session.session)));

	// The turn then lands in that order: the effect reaches the kernel, the delivery follows it.
	assert.equal(applies(session), 1);
	assert.ok(visibleTexts(session).includes(FILED), JSON.stringify(visibleTexts(session)));
	// Nothing was left unanswered, so the player is told nothing: this is the repair, not a notice.
	assert.deepEqual(told(session), []);
});

test("an effect blocked after the turn closed is told to the player, because the delivery is already published", async (t) => {
	// The ordering refusal is spent once per turn, exactly as §34.17's is, so a Keeper that writes
	// the same shape twice is never left unable to deliver at all. The second time is live turn 103:
	// the narrate lands, the apply behind it is blocked after close, and no repair is left.
	const session = await openTable({
		responses: [deliveryThenEffect(), deliveryThenEffect(), fauxAssistantMessage("Should never be consumed.")],
	});
	t.after(() => session.dispose());
	await session.session.prompt("我请他把位置写准。");
	await waitForIdle(session.session);

	const rows = session.telemetry();
	assert.ok(closed(rows), JSON.stringify(rows));
	const blocked = rows.filter((row) => row.blocked_after_close);
	assert.equal(blocked.length, 1, JSON.stringify(blocked));
	assert.equal(blocked[0].tool, "apply");
	assert.equal(blocked[0].effect_untold, true, "the host already knew the refused call was an effect, not a read");
	// The effect never reached the kernel, which is the point: the world did not change.
	assert.equal(applies(session), 0);

	const notices = told(session);
	assert.equal(notices.length, 1, JSON.stringify(customMessages(session.session, "coc-delivery")));
	assert.equal(notices[0].details.turn, 1);
	assert.ok(notices[0].content.trim() && !/^refused_effect_notice$/.test(notices[0].content.trim()),
		`a caption the surface lacks renders as its key, which is a gap and not a notice: ${notices[0].content}`);
	assert.ok(rows.some((row) => row.lane === "delivery" && row.reason === "refused_effect_notice"),
		JSON.stringify(rows.filter((row) => row.lane === "delivery")));
});

test("a successful delivery does not request a separate post-close effect message", async (t) => {
	// The 2026-09-18 App opening was exactly this shape: narrate succeeded, then Pi's ordinary
	// post-tool call let the Keeper attempt unrelated object definitions on the closed turn. A
	// terminal delivery now ends the batch before that response can be requested. This does not
	// weaken the same-message ordering gate tested above and below.
	const session = await openTable({
		responses: [
			fauxAssistantMessage([fauxToolCall("narrate", { text: FILED })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("apply", { effects: NOTE })], { stopReason: "toolUse" }),
		],
	});
	t.after(() => session.dispose());
	await session.session.prompt("我请他把位置写准。");
	await waitForIdle(session.session);

	const rows = session.telemetry();
	assert.equal(rows.filter((row) => row.lane === "provider-call").length, 1, JSON.stringify(rows));
	assert.deepEqual(rows.filter((row) => row.blocked_after_close), []);
	assert.equal(applies(session), 0, "the post-close response must remain unconsumed");
	assert.deepEqual(told(session), [], "the valid delivery needs no repair notice");
});

test("a delivery behind an effect the action review refused is refused too, and the Keeper writes it again", async (t) => {
	// The other mechanism through the same seam. `action_not_authorized` (§32) is ordinary play, and
	// the host does not announce it; what is not ordinary is a delivery composed in the same breath
	// as the proposal, which cannot possibly carry the answer. The turn has not closed yet, so the
	// repair is available and is taken in preference to telling the player anything.
	const session = await openTable({
		responses: [
			effectThenDelivery(),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "职员把本子推回来。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("Should never be consumed."),
		],
		laneResponses: refusingReview,
	});
	t.after(() => session.dispose());
	await session.session.prompt("我请他把位置写准。");
	await waitForIdle(session.session);

	const rows = session.telemetry();
	const refusal = rows.find((row) => row.tool === "apply" && !row.lane && row.ok === false);
	assert.equal(refusal?.reason, "action_not_authorized", JSON.stringify(refusal));
	assert.equal(applies(session), 0);
	const held = rows.filter((row) => row.code === "blocked" && row.reason === "delivery_behind_refused_effect");
	assert.equal(held.length, 1, JSON.stringify(rows.filter((row) => row.code === "blocked")));
	assert.equal(held[0].tool, "narrate");

	// The turn still closes, on the delivery written with the answer in hand: §32 is not relaxed,
	// a refusal is still not a stop, and the player reads one turn rather than a notice.
	assert.ok(closed(rows), JSON.stringify(rows));
	assert.ok(visibleTexts(session).includes("职员把本子推回来。"), JSON.stringify(visibleTexts(session)));
	assert.ok(!visibleTexts(session).includes(FILED), "the delivery written before the answer must not reach the player");
	assert.deepEqual(told(session), []);
});

test("when that repair is spent, the delivery lands carrying no answer and the player is told", async (t) => {
	// Same mechanism, one turn's refusal already spent. The second delivery goes through — a turn is
	// never left undeliverable — and going through is exactly what makes it a delivery written
	// without its answer, so this is where `action_not_authorized` reaches the player's one line.
	const session = await openTable({
		responses: [effectThenDelivery(), effectThenDelivery(), fauxAssistantMessage("Should never be consumed.")],
		laneResponses: {
			admission: [
				verdict({ verdict: "not_authorized", grounds: "the player asked; the clerk had not agreed", missing: "whether the clerk files it" }),
				verdict({ verdict: "not_authorized", grounds: "still not chosen", missing: "whether the clerk files it" }),
			],
		},
	});
	t.after(() => session.dispose());
	await session.session.prompt("我请他把位置写准。");
	await waitForIdle(session.session);

	const rows = session.telemetry();
	assert.equal(rows.filter((row) => row.tool === "apply" && !row.lane && row.ok === false).length, 2,
		JSON.stringify(rows.filter((row) => row.tool === "apply")));
	assert.equal(applies(session), 0);
	assert.equal(rows.filter((row) => row.reason === "delivery_behind_refused_effect").length, 1, "the repair is spent once per turn");
	assert.ok(closed(rows), JSON.stringify(rows));

	const notices = told(session);
	assert.equal(notices.length, 1, JSON.stringify(customMessages(session.session, "coc-delivery")));
	assert.equal(notices[0].details.refused_effect, true);
	assert.ok(rows.some((row) => row.lane === "delivery" && row.reason === "refused_effect_notice"),
		JSON.stringify(rows.filter((row) => row.lane === "delivery")));
});

test("an effect the review refused a round trip before the delivery says nothing: the Keeper was answered in time", async (t) => {
	// The boundary that keeps §32 intact, and it is the one this fix deliberately does not cross.
	// Turns 77 and 85 of the same table are this shape -- the apply alone in its message, refused,
	// and the narrate a full provider call later -- and the Keeper had the refusal, its grounds and
	// its instruction in hand while it wrote. Whether it then wrote honestly is not a thing the host
	// can know without reading the prose, and it does not read it. Telling the player here would
	// announce a refusal on every ordinary turn §32 refuses, which is most of what §32 is for.
	const session = await openTable({
		responses: [
			fauxAssistantMessage([fauxToolCall("apply", { effects: NOTE })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: FILED })], { stopReason: "toolUse" }),
			fauxAssistantMessage("Should never be consumed."),
		],
		laneResponses: refusingReview,
	});
	t.after(() => session.dispose());
	await session.session.prompt("我请他把位置写准。");
	await waitForIdle(session.session);

	const rows = session.telemetry();
	const refusal = rows.find((row) => row.tool === "apply" && !row.lane && row.ok === false);
	assert.equal(refusal?.reason, "action_not_authorized", JSON.stringify(refusal));
	assert.ok(closed(rows), JSON.stringify(rows));
	assert.deepEqual(rows.filter((row) => row.code === "blocked" && /^(effect_behind_delivery|delivery_behind_refused_effect)$/.test(row.reason)), []);
	assert.deepEqual(told(session), []);
	assert.deepEqual(rows.filter((row) => row.lane === "delivery" && row.reason === "refused_effect_notice"), []);
});

test("a read blocked after close still says nothing: nothing the player was told depended on it", async (t) => {
	// §34.16's runaway. A `look` after the turn closed changes nothing and promises nothing, so it is
	// a Keeper that did not stop, not an effect the player is owed a word about. The verb is the
	// discriminator and it is the whole of it -- and a `look` behind the delivery is not refused
	// either, because there is nothing behind that door for it to lose.
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

	const rows = session.telemetry();
	const blocked = rows.filter((row) => row.blocked_after_close);
	assert.equal(blocked.length, 1, JSON.stringify(blocked));
	assert.equal(blocked[0].effect_untold, undefined);
	assert.deepEqual(rows.filter((row) => row.reason === "effect_behind_delivery"), []);
	assert.deepEqual(told(session), []);
});
