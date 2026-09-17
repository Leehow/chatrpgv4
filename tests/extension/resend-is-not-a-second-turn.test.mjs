/**
 * Contract §71. A resend is not a second turn.
 *
 * Retained live evidence (`playtest-evidence/pipicoc-20260914`, home `t4`, campaign
 * `game-1c0faba5`, 2026-09-16). The player reloaded the page mid-generation, believed the turn had
 * died with it, and pressed 重发. The turn had not died: turn 75 ran to the end — 510 characters,
 * four receipts. The resend had been held by the host while that run finished and was replayed at
 * `agent_settled`, so it opened turn 76 with a `player_text` byte-for-byte identical to turn 75's.
 * Turn 76 cost a turn of clock and budget, its first `apply` was refused `action_not_authorized`
 * (the engine correctly declining to file the same complaint twice), it delivered 193 characters
 * about the investigator repeating herself, and the verifier read that prose as `player_agency`
 * because nothing it can see says a resend happened. In no place — screen, `turns/0076.json`,
 * telemetry — did the product call it a duplicate.
 *
 * The test drives the real path: a prompt, then the identical text again while the Keeper is still
 * streaming, which is what the button does.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { KernelError } from "../../extensions/kernel/client.ts";
import { customMessages, openTable, waitForIdle } from "./harness.mjs";
import { waitFor } from "./wait.mjs";

const directory = mkdtempSync(join(tmpdir(), "resend-turn-"));
test.after(() => rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));

/** The sentence the retained table sent, and then sent again. */
const SAID = "我按栏把投诉单填完，把单子推过窗洞。";

const reviewUnavailable = () =>
	new KernelError({
		code: "needs",
		message: "Continuity review is paused",
		details: { reason: "continuity_review_unavailable", cause: "The private reviewer ended without a checked submission", service: true },
	});

const inputsTo = (session) => session.kernelRequests().filter((request) => request.method === "table.player_input");
const resendRows = (session) => session.telemetry().filter((row) => row.lane === "turn" && String(row.event ?? "").startsWith("resend_"));

/**
 * Hold the turn open until the second message has arrived, and hand back the release.
 *
 * Without this the test is a race the assertion loses quietly: the faux provider can finish the whole
 * run before the second `prompt` is dispatched, the turn is already `awaiting_player`, and the second
 * message is an ordinary next turn for reasons that have nothing to do with what is being tested.
 * Gating the delivery is the window the retained table had for ten minutes.
 */
function holdTurnOpen(session, { pauseDelivery = false } = {}) {
	let release;
	const arrived = new Promise((resolve) => { release = resolve; });
	let paused = false;
	session.emit("coc:mods-bridge", {
		async after() {},
		async prepare(method) {
			if (method !== "narrate") return;
			await arrived;
			if (pauseDelivery && !paused) { paused = true; throw reviewUnavailable(); }
		},
	});
	return release;
}

/** Send `said`, then send `again` while that turn is still open — the 重发 button's shape. */
async function sendThenAgain(session, said, again, options) {
	const release = holdTurnOpen(session, options);
	const first = session.session.prompt(said);
	await waitFor(() => session.session.isStreaming, { label: "守秘人开始流式输出" });
	await session.session.prompt(again, { streamingBehavior: "steer" });
	release();
	await first;
	await waitForIdle(session.session);
}

const pressResendMidRun = (session, text, options) => sendThenAgain(session, text, text, options);

test("a resend of the words the running turn is already working on does not open a second turn", async (t) => {
	const session = await openTable({
		retainAt: directory,
		responses: [
			fauxAssistantMessage([fauxToolCall("narrate", { text: "窗口那位盖了收件章，副联撕给她。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("Delivered."),
			// Nothing after this is scripted: a second turn would run dry, and that is the point.
		],
	});
	t.after(() => session.dispose());

	await pressResendMidRun(session, SAID);

	// The kernel saw the words once. The retained table saw them twice.
	const inputs = inputsTo(session);
	assert.equal(inputs.length, 1, JSON.stringify(inputs.map((request) => request.params)));
	assert.equal(inputs[0].params.text, SAID);

	// And the player was told, by the host, on the channel the other service notices use. Silence is
	// the defect: the player pressed that button because he believed the turn was dead.
	const notices = customMessages(session.session, "coc-delivery").filter((message) => message.details?.resend_held);
	assert.equal(notices.length, 1, JSON.stringify(customMessages(session.session, "coc-delivery").map((message) => message.details)));
	assert.equal(notices[0].details.turn, 1);
	assert.ok(notices[0].display, "a notice the player cannot see is the silence this repairs");
	assert.ok(notices[0].content.trim().length > 0);

	// The third end (§31): the host counts that it held one and what became of it, on the turn that
	// paid for it. `resend_folded` is the turn delivering, so the duplicate was spent rather than run.
	const rows = resendRows(session);
	assert.deepEqual(rows.map((row) => row.event), ["resend_held", "resend_folded"], JSON.stringify(rows));
	assert.ok(rows.every((row) => row.turn === 1), JSON.stringify(rows));
});

/**
 * The other half, and the reason the resend is held rather than dropped: the player may be right.
 * When the run really does settle with nothing delivered (§38 strands the turn), the words he
 * pressed the button for are the retry he meant, and they go — carrying §38's stranded release.
 */
test("a resend held by a turn that then delivers nothing is sent as that turn's retry", async (t) => {
	const session = await openTable({
		retainAt: directory,
		responses: [
			fauxAssistantMessage([fauxToolCall("narrate", { text: "A draft the review never approved." })], { stopReason: "toolUse" }),
			fauxAssistantMessage("Should never be consumed."),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "窗口那位盖了收件章。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("Delivered."),
		],
	});
	t.after(() => session.dispose());

	await pressResendMidRun(session, SAID, { pauseDelivery: true });

	const inputs = inputsTo(session);
	assert.equal(inputs.length, 2, JSON.stringify(inputs.map((request) => request.params)));
	assert.equal(inputs[1].params.text, SAID, "the retry is the player's own words, unchanged");
	assert.equal(inputs[1].params.release, "stranded", "and it releases the turn that could not finish");

	const rows = resendRows(session);
	assert.deepEqual(rows.map((row) => row.event), ["resend_held", "resend_released"], JSON.stringify(rows));
});

/**
 * Exact equality is the whole test (§71). One character apart is a different sentence the player
 * chose to write, and the product has no business reading how close two sentences are.
 */
test("a message that is not byte-identical is an ordinary queued turn, not a resend", async (t) => {
	const session = await openTable({
		retainAt: directory,
		responses: [
			fauxAssistantMessage([fauxToolCall("narrate", { text: "窗口那位盖了收件章。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("Delivered."),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "他把副联往台沿上挪半寸。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("Delivered again."),
		],
	});
	t.after(() => session.dispose());

	await sendThenAgain(session, SAID, `${SAID}。`);

	const inputs = inputsTo(session);
	assert.equal(inputs.length, 2, JSON.stringify(inputs.map((request) => request.params)));
	assert.equal(inputs[1].params.text, `${SAID}。`);
	assert.deepEqual(resendRows(session), [], "nothing was held: the two messages are not the same message");
	assert.equal(customMessages(session.session, "coc-delivery").filter((message) => message.details?.resend_held).length, 0);
});
