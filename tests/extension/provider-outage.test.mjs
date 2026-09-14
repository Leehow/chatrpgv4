/**
 * A dead provider call leaves a trace (contract §38.7).
 *
 * Retained live evidence, campaign `game-5779d0fd-7dac-41de-b1f5-1a0f05132e2a`, turn 3, 2026-09-14,
 * from the campaign's own telemetry:
 *
 *   {"turn":3,"lane":"provider-request", "at":"...T13:06:45.933Z"}
 *   {"turn":3,"lane":"provider-call",    "at":"...T13:11:45.944Z","ms":300011,"stop_reason":"error","blocks":[]}
 *   {"turn":3,"lane":"provider-request", "at":"...T13:11:47.968Z"}
 *   {"turn":3,"lane":"provider-response","at":"...T13:11:50.600Z","status":200}
 *
 * One call hung for five minutes and came back with nothing; the retry answered in 2.6 s and the
 * turn finished normally about a minute later. The player saw one spinner reading "still working,
 * 3min49s", and afterwards nothing anywhere — not the transcript, not the operator's surface —
 * said that five of those six minutes had been an outage rather than the model thinking. That is
 * the §38.5 principle in another lane: an infrastructure failure must not be indistinguishable from
 * normal slowness, and a retry that happens to succeed is not a reason to erase the one that did not.
 *
 * The 300 s ceiling is deliberately not touched here. It is not set anywhere in this repository, pi
 * gives an extension only the observational `before_provider_request` / `after_provider_response`
 * hooks, and there is no interception point at which a shorter deadline could be imposed. These
 * tests are about the record, and about it never costing a turn.
 */
import { strict as assert } from "node:assert";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { assistantTexts, customMessages, openTable, waitFor, waitForIdle } from "./harness.mjs";

const directory = mkdtempSync(join(tmpdir(), "coc-provider-outage-"));

/** A provider call that held the line and came back with nothing at all: the retained shape. */
const dead = () => fauxAssistantMessage([], { stopReason: "error", errorMessage: "Provider 500: connection reset" });
/** A Keeper turn that lands, and the assistant message the delivery replacement needs after it. */
const delivered = (text) => [
	fauxAssistantMessage([fauxToolCall("narrate", { text })], { stopReason: "toolUse" }),
	fauxAssistantMessage("Should never be consumed."),
];

/** The service notices, in order: the player's own messages, never the story. */
const notices = (session) => customMessages(session.session, "coc-delivery").filter((message) => message.details.provider_outage);

test("a provider call that dies is recorded and told, even when the retry saves the turn", async (t) => {
	// The retained call hung for 300 s; the harness's faux fails in milliseconds, so the threshold
	// that decides whether the player is interrupted is moved rather than the clock faked.
	const session = await openTable({ retainAt: directory, env: { PI_COC_PROVIDER_NOTICE_MS: "1" },
		responses: [dead(), ...delivered("The hallway is quiet.")] });
	t.after(() => session.dispose());
	await session.session.prompt("I listen at the door.");
	await waitForIdle(session.session);

	// The turn itself is untouched: a notice that cost the table its delivery would be a worse defect.
	assert.ok(assistantTexts(session.session).includes("The hallway is quiet."), JSON.stringify(assistantTexts(session.session)));

	// The operator's surface, shaped like §38.5's `coc-review-status` and §32.2's `coc-admission-status`.
	const operator = session.entries("coc-provider-status");
	assert.equal(operator.length, 1, JSON.stringify(operator));
	assert.equal(operator[0].status, "unavailable", "one dead call is not yet an outage to escalate");
	assert.equal(operator[0].streak, 1);
	assert.equal(operator[0].turn, 1);
	assert.equal(typeof operator[0].ms, "number", "how long the table waited for nothing is the whole point");
	assert.match(operator[0].detail, /connection reset/, "what the provider said is kept");
	assert.equal(operator[0].fix, undefined, "a single failure carries no fix: the retry may well have been the cure");

	// And the player, out of fiction, once.
	const told = notices(session);
	assert.equal(told.length, 1, JSON.stringify(told));
	assert.equal(told[0].details.streak, 1);
	assert.equal(told[0].details.turn, 1);
	assert.ok(told[0].content.trim() && !/^provider_\w+_notice$/.test(told[0].content.trim()),
		`a caption the surface lacks renders as its key, which is a gap and not a notice: ${told[0].content}`);

	// The rows: the provider-call row already said `error`; the delivery row says the player was told.
	const rows = session.telemetry();
	assert.ok(rows.some((row) => row.lane === "provider-call" && row.stop_reason === "error"), JSON.stringify(rows));
	assert.ok(rows.some((row) => row.lane === "delivery" && row.reason === "provider_outage_notice" && row.streak === 1),
		JSON.stringify(rows.filter((row) => row.lane === "delivery")));
});

test("a call that dies quickly is still recorded, but does not interrupt the table", async (t) => {
	// No threshold override: the shipped one is a minute, and the harness fails in milliseconds.
	const session = await openTable({ retainAt: directory, responses: [dead(), ...delivered("The hallway is quiet.")] });
	t.after(() => session.dispose());
	await session.session.prompt("I listen at the door.");
	await waitForIdle(session.session);

	assert.equal(session.entries("coc-provider-status").length, 1, "the operator hears about every dead call");
	assert.deepEqual(notices(session), [],
		"a blip the player never noticed does not get a service message on a turn that went fine");
	assert.ok(assistantTexts(session.session).includes("The hallway is quiet."));
});

test("a second consecutive dead call escalates once, and a completed call ends the streak", async (t) => {
	const session = await openTable({ retainAt: directory, env: { PI_COC_PROVIDER_NOTICE_MS: "1" },
		responses: [dead(), dead(), ...delivered("The hallway is quiet."), dead(), ...delivered("The handle turns.")] });
	t.after(() => session.dispose());
	await session.session.prompt("I listen at the door.");
	await waitForIdle(session.session);
	await session.session.prompt("I try the handle.");
	await waitForIdle(session.session);
	// The entry is appended from the provider hook, which settles a beat after the run does.
	await waitFor(() => session.entries("coc-provider-status").length >= 3, { label: "the second turn's own record" });

	const operator = session.entries("coc-provider-status");
	assert.deepEqual(operator.map((entry) => [entry.turn, entry.streak, entry.status]),
		[[1, 1, "unavailable"], [1, 2, "down"], [2, 1, "unavailable"]], JSON.stringify(operator));
	// Once per streak, exactly as the admission and review lanes escalate (§32.2, §38.5).
	const down = operator.filter((entry) => entry.status === "down");
	assert.equal(down.length, 1);
	assert.match(down[0].fix, /provider/i, JSON.stringify(down[0]));
	// The completed assistant message of turn 1 — not the turn boundary — is what reset the count.
	assert.equal(operator[2].streak, 1, "a call that answered end to end proves the provider is back");
});

test("a repeated outage does not read to the player as the first one", async (t) => {
	// Nothing completes in the first turn, so the streak survives into the second: pi exhausts its
	// own retries and the run ends, which is the other half of the retained evidence — the case
	// where the player is left with a spinner and no turn at all.
	const session = await openTable({ retainAt: directory, env: { PI_COC_PROVIDER_NOTICE_MS: "1" },
		responses: [dead(), dead(), dead(), dead(), dead(), dead(), ...delivered("The handle turns.")] });
	t.after(() => session.dispose());
	await session.session.prompt("I listen at the door.");
	await waitForIdle(session.session);
	await session.session.prompt("I try the handle.");
	await waitForIdle(session.session);
	await waitFor(() => notices(session).length >= 2, { label: "the second run's own service notice" });

	const told = notices(session);
	assert.equal(told.length, 2, JSON.stringify(told.map((message) => message.details)));
	assert.equal(told[0].details.streak, 1);
	assert.ok(told[1].details.streak >= 2, JSON.stringify(told[1].details));
	assert.notEqual(told[0].content, told[1].content,
		"a persistent outage stops promising that this was a one-off, exactly as §38.5's second notice does");
	for (const message of told)
		assert.ok(message.content.trim() && !/^provider_\w+_notice$/.test(message.content.trim()), message.content);
	// One service notice per run, however many calls died inside it.
	assert.equal(told.filter((message) => message.details.turn === 1).length, 1);
});
