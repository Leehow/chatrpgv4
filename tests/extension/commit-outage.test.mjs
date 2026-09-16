/**
 * A Git that cannot write is a service condition, not a retryable move (contract §38.11).
 *
 * Retained live evidence, campaign `game-83177d61`, turn 103, 2026-09-15, from its own telemetry:
 * `xcode-select` pointed at an unlicensed Xcode, so /usr/bin/git exited 69 on every command and the
 * kernel — which commits each turn — answered
 *
 *     commit_failed: git commit failed; the turn stays open: git add failed (69)
 *
 * `commit_failed` is declared `retryable: true, next: "retry_same"`, and narrate is exempt from the
 * refusal budget, so the Keeper did exactly what it was told: eight narrate attempts and six
 * continuity reviews on one turn before it gave up. The player was told only 「这一回合结束时没有交
 * 付结果」 — the generic line for a turn that ended without a delivery, which says nothing about the
 * one thing the host knew precisely.
 *
 * So: bound the retries, keep the Git text alive to the notice, and escalate once, in §32.2's shape.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { customMessages, openTable, waitForIdle } from "./harness.mjs";

/** The kernel's refusal, with the structured Git failure §38.11 now carries. */
const COMMIT_FAILED = {
	code: "commit_failed",
	message: "git commit failed; the turn stays open: git add failed (69)",
	fix: "retry narrate with the same text",
	details: { turn: 1, git: { step: "add", code: 69, output: "xcrun: error: unable to find utility" } },
};

/** A Keeper that keeps trying, exactly as the live one did. */
const narrates = (times) =>
	Array.from({ length: times }, (_, index) =>
		fauxAssistantMessage([fauxToolCall("narrate", { text: `attempt ${index + 1}` })], { stopReason: "toolUse" }),
	).concat(fauxAssistantMessage("Nothing more to say."));

const notices = (session) =>
	customMessages(session.session, "coc-delivery").filter((message) => message.details.commit_unavailable);

test("a commit that keeps failing for the same cause stops being retried", async (t) => {
	const session = await openTable({
		env: { FAKE_KERNEL_ERRORS: JSON.stringify({ "table.narrate": COMMIT_FAILED }) },
		responses: narrates(8),
	});
	t.after(() => session.dispose());
	await session.session.prompt("I write it down.");
	await waitForIdle(session.session);

	const attempts = session.telemetry().filter((row) => row.tool === "narrate" && row.code === "commit_failed");
	assert.equal(attempts.length, 2, `the second failure of the same cause ends the run: ${JSON.stringify(attempts)}`);
	// The second one says so on the row, not only in the message handed back.
	assert.equal(attempts[1].reason, "commit_unavailable");
});

test("the escalation names the cause and the fix, once per streak", async (t) => {
	const session = await openTable({
		env: { FAKE_KERNEL_ERRORS: JSON.stringify({ "table.narrate": COMMIT_FAILED }) },
		responses: narrates(8),
	});
	t.after(() => session.dispose());
	await session.session.prompt("I write it down.");
	await waitForIdle(session.session);

	const operator = session.entries("coc-commit-status");
	assert.equal(operator.length, 1, `once per streak, not once per attempt: ${JSON.stringify(operator)}`);
	assert.equal(operator[0].status, "down");
	assert.equal(operator[0].streak, 2);
	// The Git text the kernel captured survives to the person who can act on it: a flattened
	// "commit_failed" names nothing anybody can repair.
	assert.equal(operator[0].cause, "git add exited 69");
	assert.match(operator[0].detail, /xcrun/);
	assert.match(operator[0].fix, /PI_COC_GIT|xcode-select/);

	// And a second player turn does not send a second notice for the same streak.
	session.faux.setResponses(narrates(4));
	await session.session.prompt("I try again.");
	await waitForIdle(session.session);
	assert.equal(session.entries("coc-commit-status").length, 1,
		JSON.stringify(session.entries("coc-commit-status")));
});

test("the player is told the history store is down, not that the turn merely ended", async (t) => {
	const session = await openTable({
		env: { FAKE_KERNEL_ERRORS: JSON.stringify({ "table.narrate": COMMIT_FAILED }) },
		responses: narrates(8),
	});
	t.after(() => session.dispose());
	await session.session.prompt("I write it down.");
	await waitForIdle(session.session);

	const told = notices(session);
	assert.equal(told.length, 1, JSON.stringify(customMessages(session.session, "coc-delivery")));
	assert.equal(told[0].details.streak, 2);
	assert.ok(told[0].content.trim() && !/^commit_down_notice$/.test(told[0].content.trim()),
		`a caption the surface lacks renders as its key, which is a gap and not a notice: ${told[0].content}`);

	const rows = session.telemetry().filter((row) => row.lane === "delivery");
	assert.ok(rows.some((row) => row.reason === "commit_down_notice" && row.streak === 2), JSON.stringify(rows));
	// The generic no-delivery line would be true and useless on top of it, and would invite the
	// resend that cannot work.
	assert.ok(!rows.some((row) => row.reason === "turn_unfinished_notice"), JSON.stringify(rows));
});

test("a commit failure that does not repeat is still an ordinary retryable move", async (t) => {
	// The fake kernel answers the first narrate with a commit failure and the second normally, which
	// is what a transient failure looks like from here.
	const session = await openTable({
		env: { FAKE_KERNEL_ERRORS: JSON.stringify({ "table.narrate": COMMIT_FAILED }), FAKE_KERNEL_ERRORS_ONCE: "1" },
		responses: narrates(3),
	});
	t.after(() => session.dispose());
	await session.session.prompt("I write it down.");
	await waitForIdle(session.session);

	assert.deepEqual(session.entries("coc-commit-status"), [],
		"one failure is a blip: the retry may well be the cure, and §32.2 promises it may try again");
	assert.deepEqual(notices(session), []);
});
