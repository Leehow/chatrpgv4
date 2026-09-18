/**
 * A provider control token is not prose (contract §34.18).
 *
 * Retained live evidence, campaign `game-83177d61-ab11-4d58-b8ec-cf8b9c98d5a4`, turn 113,
 * 2026-09-16, from the campaign's own telemetry and the session transcript:
 *
 *   {"turn":113,"lane":"provider-call","ms":60939,"stop_reason":"error","blocks":[]}
 *   {"turn":113,"lane":"provider-request","at":"...T05:32:03.651Z"}
 *   {"turn":113,"lane":"provider-call","ms":1708,"stop_reason":"stop","blocks":["thinking","text"]}
 *   assistant: [{"type":"thinking",...},{"type":"text","text":"<|eos|>"}]   // grok-build/grok-4.6
 *
 * One call held the line for 61 s and came back with nothing. The host had a rendered delivery in
 * hand and placed it on that dead message; pi resent the request, and the resend answered with a
 * single text block holding the provider's own end-of-sequence token, which is what the player read
 * in place of the turn. The kernel's turn records for 112 and 113 are clean — `closed_by: "narrate"`
 * and no token in `rendered_text` — so nothing was polluted: the token never passed through narrate
 * at all, it simply survived on the assistant message the session renders.
 *
 * The signal used here is `stopReason`, which pi declares as data (`StopReason` in
 * `@earendil-works/pi-ai`), plus whether the host adopted the text as a delivery. Neither reads the
 * words: no token spelling is matched, no provider vocabulary is assumed, and a legitimate line of
 * narration in any language travels exactly as before.
 *
 * What it does not catch, stated plainly: a control token arriving on a leg the host *would* adopt —
 * an open turn, no narrate yet — still becomes an implicit delivery, because at that point nothing
 * structural separates it from one short line of prose. Catching that needs the provider's own token
 * spellings, and neither pi's SDK nor the vendored `extensions/grok-build-oauth` adapter declares any
 * stop sequence or special token; a list here would be invented, which this repository forbids.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { assistantTexts, customMessages, openTable, waitForIdle } from "./harness.mjs";

/** The retained shape of the 61-second call: held the line, returned no block at all. */
const dead = () => fauxAssistantMessage([], { stopReason: "error", errorMessage: "terminated" });
/** The resend's answer: one text block whose whole content is the provider's control token. */
const controlToken = () => fauxAssistantMessage("<|eos|>");
/** pi only resends when the session's retry budget is on; the shipped product leaves it on. */
const retrying = { retry: { enabled: true, maxRetries: 2, baseDelayMs: 1 } };

/** Everything the player reads this turn: the Keeper's own messages plus the host's own. */
const read = (session) => [
	...assistantTexts(session.session),
	...customMessages(session.session, "coc-delivery").map((message) => String(message.content)),
];
const notices = (session) =>
	customMessages(session.session, "coc-delivery").filter((message) => message.details.provider_outage);
const deliveryRows = (session) => session.telemetry().filter((row) => row.lane === "delivery");

test("a terminal delivery makes the resent-control-token path unreachable", async (t) => {
	const session = await openTable({
		settings: retrying,
		env: { PI_COC_PROVIDER_NOTICE_MS: "1" },
		responses: [
			fauxAssistantMessage([fauxToolCall("narrate", { text: "门厅里落满灰。" })], { stopReason: "toolUse" }),
			dead(),
			controlToken(),
			fauxAssistantMessage("Should never be consumed."),
		],
	});
	t.after(() => session.dispose());
	await session.session.prompt("我推门进去。");
	await waitForIdle(session.session);

	const shown = read(session);
	assert.ok(!shown.some((text) => text.includes("<|eos|>")),
		`the provider's control token was read as the Keeper's prose: ${JSON.stringify(shown)}`);
	assert.ok(shown.includes("门厅里落满灰。"), JSON.stringify(shown));

	// `narrate` is terminal: no automatic post-tool call means neither the scripted dead leg nor
	// its resend exists, and therefore no outage or repair notice is invented for a call not made.
	assert.deepEqual(notices(session), []);
	assert.equal(session.telemetry().filter((row) => row.lane === "provider-call").length, 1);
	assert.deepEqual(deliveryRows(session).filter((row) => ["failed_leg_not_delivered", "text_not_a_delivery"].includes(row.reason)), []);
	const narrates = session.kernelRequests().filter((request) => request.method === "table.narrate");
	assert.equal(narrates.length, 1, JSON.stringify(narrates.map((request) => request.params?.text)));
	assert.equal(narrates[0].params.text, "门厅里落满灰。");
});

test("the delivery survives a dead leg that is never resent", async (t) => {
	// Same first half, no resend: the host must not have spent the rendered text on the dead message.
	const session = await openTable({
		responses: [
			fauxAssistantMessage([fauxToolCall("narrate", { text: "门厅里落满灰。" })], { stopReason: "toolUse" }),
			dead(),
		],
	});
	t.after(() => session.dispose());
	await session.session.prompt("我推门进去。");
	await waitForIdle(session.session);

	assert.ok(read(session).includes("门厅里落满灰。"), JSON.stringify(read(session)));
	assert.ok(deliveryRows(session).some((row) => row.reason === "placed_by_host"), JSON.stringify(deliveryRows(session)));
});

test("half a sentence streamed before the line died is not published", async (t) => {
	// The other half of the same rule: a leg that errored carries a remnant, whatever it looks like.
	const session = await openTable({
		settings: retrying,
		responses: [
			fauxAssistantMessage([{ type: "text", text: "你压着嗓子说：" }], { stopReason: "error", errorMessage: "terminated" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "你压着嗓子说：「四只画押了。」" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("Should never be consumed."),
		],
	});
	t.after(() => session.dispose());
	await session.session.prompt("我跟莱维特说那句话。");
	await waitForIdle(session.session);

	assert.ok(!read(session).includes("你压着嗓子说："), JSON.stringify(read(session)));
	assert.ok(read(session).includes("你压着嗓子说：「四只画押了。」"), JSON.stringify(read(session)));
	assert.ok(deliveryRows(session).some((row) => row.reason === "failed_leg_not_delivered" && row.dropped === 1),
		JSON.stringify(deliveryRows(session)));
});

test("text written after the turn has closed is not published as a second delivery", async (t) => {
	// The general rule the token is one instance of: whatever the Keeper writes on a leg the host
	// cannot turn into a delivery, the player does not read. Here the turn is already closed.
	const session = await openTable({
		settings: retrying,
		responses: [
			fauxAssistantMessage([fauxToolCall("narrate", { text: "门厅里落满灰。" })], { stopReason: "toolUse" }),
			dead(),
			fauxAssistantMessage("Turn closed. No more prose."),
			fauxAssistantMessage("Nor this."),
		],
	});
	t.after(() => session.dispose());
	await session.session.prompt("我推门进去。");
	await waitForIdle(session.session);

	const shown = read(session);
	assert.ok(!shown.some((text) => text.includes("Turn closed")), JSON.stringify(shown));
	assert.ok(shown.includes("门厅里落满灰。"), JSON.stringify(shown));
});

test("a delivery the kernel rendered as nothing does not fall back to the raw draft", async (t) => {
	// The draft still carries the machine tokens only a rendered delivery strips (§34.14), so an
	// implicit narrate that comes back with nothing to publish leaves the player with the turn's own
	// account, not with the Keeper's working text.
	const session = await openTable({ settings: retrying, env: { FAKE_KERNEL_EMPTY_RENDER: "1" }, responses: [
		fauxAssistantMessage("门厅里落满灰。"),
		fauxAssistantMessage("{{say:看门人}}「谁啊。」"),
		fauxAssistantMessage("Should never be consumed."),
	] });
	t.after(() => session.dispose());
	await session.session.prompt("我推门进去。");
	await waitForIdle(session.session);

	assert.ok(!read(session).some((text) => text.includes("{{say:")), JSON.stringify(read(session)));
	assert.ok(deliveryRows(session).some((row) => row.reason === "rendered_nothing"), JSON.stringify(deliveryRows(session)));
});

test("an ordinary turn is untouched", async (t) => {
	const session = await openTable({
		settings: retrying,
		responses: [
			fauxAssistantMessage([fauxToolCall("narrate", { text: "门厅里落满灰。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("Should never be consumed."),
		],
	});
	t.after(() => session.dispose());
	await session.session.prompt("我推门进去。");
	await waitForIdle(session.session);

	assert.ok(assistantTexts(session.session).includes("门厅里落满灰。"), JSON.stringify(assistantTexts(session.session)));
	assert.deepEqual(deliveryRows(session).filter((row) => row.ok === false), []);
});

test("prose with no narrate still closes the turn implicitly", async (t) => {
	// The drop must not swallow the implicit delivery: a Keeper who writes his lines and calls nothing
	// is still delivering. The floor steer (turn-floor D4) spends the first draft, so the second one is
	// the delivery, and it must arrive whole.
	const session = await openTable({ settings: retrying, responses: [
		fauxAssistantMessage("门厅里落满灰。"),
		fauxAssistantMessage("门厅里落满灰，看门人靠在门框上。"),
	] });
	t.after(() => session.dispose());
	await session.session.prompt("我推门进去。");
	await waitForIdle(session.session);

	const narrates = session.kernelRequests().filter((request) => request.method === "table.narrate");
	assert.equal(narrates.length, 1, JSON.stringify(narrates.map((request) => request.params?.text)));
	assert.equal(narrates[0].params.implicit, true);
	assert.ok(read(session).includes("门厅里落满灰，看门人靠在门框上。"), JSON.stringify(read(session)));
});
