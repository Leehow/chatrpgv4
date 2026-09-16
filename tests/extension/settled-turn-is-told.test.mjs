/**
 * Contract §50. A turn that settled receipts and could not be delivered still owes the player the
 * settled facts, and owes the Keeper nothing more.
 *
 * Retained live evidence (`playtest-evidence/pipicoc-20260914`, campaign
 * `game-b4cebfe0-f8a2-4fb7-bf8e-9894a048aa4f`, turn 8, 2026-09-16). Four receipts landed — a
 * campaign-scoped ruling, an NPC stance, a *passed* Swim check (54 against 70) and a +2 minute clock
 * advance — and then the continuity review timed out at 40 814 ms. The run ended with
 * `closed_how: null`, `rendered_text` of length zero, and the single service sentence "this turn could
 * not be published … everything already settled is kept". Nothing anywhere named what had settled, the
 * retry opened turn 9 as a clean turn, and those four receipts were never told to the player in any
 * turn. The state surface was intact; the whole delivery surface was gone.
 *
 * The same run also spent a second provider call on a `narrate` that failed in 0 ms into the latched
 * review guard, which bought the player one more empty bubble and nothing else.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { KernelError } from "../../extensions/kernel/client.ts";
import { assistantTexts, customMessages, openTable, waitForIdle } from "./harness.mjs";

const directory = mkdtempSync(join(tmpdir(), "settled-told-"));
test.after(() => rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));

const reviewUnavailable = () =>
	new KernelError({
		code: "needs",
		message: "Continuity review is paused",
		details: { reason: "continuity_review_unavailable", cause: "The private reviewer ended without a checked submission", service: true },
	});

/** One turn that settles a public check and then cannot publish: the retained turn-8 shape. */
const settledThenUndelivered = () => [
	fauxAssistantMessage([fauxToolCall("resolve", { action: { intent: "investigate", goal: "看清崖上那盏灯", method: "用侦查盯住" } })], { stopReason: "toolUse" }),
	fauxAssistantMessage([fauxToolCall("narrate", { text: "A draft the review never approved." })], { stopReason: "toolUse" }),
	fauxAssistantMessage("Should never be consumed."),
];

async function pausedReviewTurn(t, extra = []) {
	const session = await openTable({ retainAt: directory, responses: [...settledThenUndelivered(), ...extra] });
	t.after(() => session.dispose());
	session.emit("coc:mods-bridge", {
		async after() {},
		async prepare(method) {
			if (method === "narrate") throw reviewUnavailable();
		},
	});
	await session.session.prompt("我盯住崖顶那盏灯。");
	await waitForIdle(session.session);
	return session;
}

test("a turn that settled and could not be delivered still tells the player what settled", async (t) => {
	const session = await pausedReviewTurn(t);

	// The service sentence is still sent, and still says only that the turn could not be published.
	const notices = customMessages(session.session, "coc-delivery").filter((message) => message.details?.review_unavailable);
	assert.equal(notices.length, 1, JSON.stringify(notices.map((n) => n.content)));

	// §50: and the settled facts reach the player through the projection a delivered turn uses —
	// the §16.2 mechanics card — rather than being left on disk with no surface at all.
	const cards = session.entries("coc-mechanics").filter((entry) => entry.turn === 1);
	assert.equal(cards.length, 1, JSON.stringify(session.entries("coc-mechanics")));
	const rows = cards[0].mechanics;
	assert.ok(Array.isArray(rows) && rows.length > 0, JSON.stringify(cards[0]));
	const roll = rows.find((row) => row.kind === "roll");
	assert.ok(roll, `the settled check must be on the card: ${JSON.stringify(rows)}`);
	assert.equal(roll.skill, "Spot Hidden");
	assert.equal(roll.passed, true);
	// It is the undelivered card, and says so: a consumer that requires a delivery can still tell.
	assert.equal(cards[0].undelivered, true, JSON.stringify(cards[0]));

	// The third end (§31): the host counts that it told them, on the turn that paid for it.
	const told = session.telemetry().filter((row) => row.lane === "delivery" && row.reason === "settled_without_delivery");
	assert.equal(told.length, 1, JSON.stringify(session.telemetry().filter((row) => row.lane === "delivery")));
	assert.equal(told[0].turn, 1);
	assert.equal(told[0].rows, rows.length);

	// Nothing here narrates or commits: the turn is still the undelivered one §38 strands.
	assert.equal(session.telemetry().filter((row) => row.tool === "narrate" && row.ok === true).length, 0);
});

test("a turn with nothing projectable is not given an empty card, and still says so once", async (t) => {
	const session = await openTable({
		retainAt: directory,
		responses: [
			fauxAssistantMessage([fauxToolCall("narrate", { text: "A draft the review never approved." })], { stopReason: "toolUse" }),
			fauxAssistantMessage("Should never be consumed."),
		],
	});
	t.after(() => session.dispose());
	session.emit("coc:mods-bridge", {
		async after() {},
		async prepare(method) {
			if (method === "narrate") throw reviewUnavailable();
		},
	});
	await session.session.prompt("我只是站着不动。");
	await waitForIdle(session.session);

	assert.equal(session.entries("coc-mechanics").filter((entry) => entry.turn === 1).length, 0,
		"an empty card is a visibility verdict of its own; a turn that settled nothing gets none");
	const told = session.telemetry().filter((row) => row.lane === "delivery" && row.reason === "settled_without_delivery");
	assert.equal(told.length, 1, "the row is still written: a zero is a fact about the turn, not a missing lane");
	assert.equal(told[0].rows, 0);
});

/**
 * Contract §50. The second half of the retained turn 8: after the review latched, the Keeper was
 * handed a whole extra provider call and called `narrate` again into the guard, which refused it in
 * 0 ms. The player got a second, empty bubble for it.
 *
 * The cause is the notice itself. `pi.sendMessage` from an `agent_end` handler, without
 * `triggerTurn: false`, is `agent.steer()` while the run is still streaming, and AgentSession's
 * `_handlePostAgentRun` continues the same run for exactly that reason ("Any messages here were
 * queued by agent_end extension handlers and need a continuation"). The continuation is not a new
 * run, so `before_agent_start` never clears `reviewUnavailable`: the next verb can only fail.
 */
test("the service notice does not hand the Keeper another turn into the guard that just refused it", async (t) => {
	const session = await pausedReviewTurn(t);
	// Two assistant messages are the turn's own: the `resolve` call and the `narrate` the review
	// refused. A third is the continuation the notice bought, and it can only end in the guard — the
	// scripted "Should never be consumed" answer is what pays for it, and the player reads it as one
	// more empty bubble, because §34.14 strips its text on the way out.
	const spoken = session.session.messages.filter((message) => message.role === "assistant");
	assert.equal(spoken.length, 2, `the paused run must not be continued: ${JSON.stringify(assistantTexts(session.session))}`);
	// And the player is told exactly once, with no second empty assistant message behind it.
	assert.equal(customMessages(session.session, "coc-delivery").length, 1);
});

/**
 * §50, the ordering the read depends on. A player who types while the run is still going has their
 * input held (`waitingInputs`) and sent at `agent_settled`, where it releases the stranded turn — and
 * that release is what clears the turn's receipts. The card must be drawn from the turn that paid for
 * it, so the `table.status` read is issued before the queued input, not on a timer behind it.
 */
test("the card is the settled turn's even when the next input was queued during the run", async (t) => {
	const session = await openTable({
		retainAt: directory,
		responses: [
			...settledThenUndelivered(),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "The turn after it." })], { stopReason: "toolUse" }),
			fauxAssistantMessage("Delivered."),
		],
	});
	t.after(() => session.dispose());
	let paused = false;
	session.emit("coc:mods-bridge", {
		async after() {},
		async prepare(method) {
			// Only the first turn's delivery is refused; the queued input's own turn goes through.
			if (method === "narrate" && !paused) { paused = true; throw reviewUnavailable(); }
		},
	});
	const first = session.session.prompt("我盯住崖顶那盏灯。");
	// Typed while the Keeper is still working: the host holds it and sends it at agent_settled.
	while (!session.session.isStreaming) await new Promise((resolve) => setTimeout(resolve, 5));
	await session.session.prompt("那我先上滩。", { streamingBehavior: "steer" });
	await first;
	await waitForIdle(session.session);

	const inputs = session.kernelRequests().filter((request) => request.method === "table.player_input");
	assert.equal(inputs.length, 2, JSON.stringify(inputs.map((i) => i.params)));
	assert.equal(inputs[1].params.release, "stranded", "the queued input released the stranded turn");
	const cards = session.entries("coc-mechanics").filter((entry) => entry.undelivered);
	assert.equal(cards.length, 1, JSON.stringify(session.entries("coc-mechanics")));
	assert.equal(cards[0].turn, 1, "the card belongs to the turn that settled, not the one that followed");
	assert.ok(cards[0].mechanics.some((row) => row.kind === "roll"), JSON.stringify(cards[0].mechanics));
});
