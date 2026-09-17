/**
 * Contract §94: a run the host gave up on is not steered back.
 *
 * Retained live evidence, M-MAIN campaign `game-3dd94f0a-4b26-41bc-96fa-f89a60abb143` turn 117,
 * 2026-09-17, from the campaign's own telemetry and the host's `server.log`:
 *
 *   08:23:22.498  provider-request
 *   08:23:23.222  provider-response  status 200
 *   08:25:26.651  provider-call      ms 124153  stop_reason "aborted"  blocks []
 *                 server.log: [pipi-backend] turn watchdog aborting silent run epoch=7 idleMs=124147
 *   08:25:26.705  provider-request                                   <- 54 ms after the abandonment
 *   08:25:27.410  provider-response  status 200
 *                 --- and nothing after it. turn.json stayed {"turn":117,"state":"acting"} for 23 min.
 *
 * The 54 ms request is not the provider's retry and not the transport's: pi never retries an abort
 * (`retryAssistantCall` returns an aborted message immediately). It is this extension's own
 * `agent_end` steer -- "This turn is not closed yet: deliver it to the player with one narrate" --
 * sent with `triggerTurn: true`, which AgentSession turns into a continuation of the run the host
 * had just abandoned. The host has one abandonment point per turn (§94.2), so the call that steer
 * bought had none, and the player sat in front of an `acting` turn until he typed again.
 */
import { strict as assert } from "node:assert";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { assistantTexts, customMessages, openTable, waitFor, waitForIdle } from "./harness.mjs";

const directory = mkdtempSync(join(tmpdir(), "coc-abandoned-run-"));

/** The shape the host watchdog leaves behind: no blocks, and `aborted` rather than `error`. */
const abandoned = () => fauxAssistantMessage([], { stopReason: "aborted" });
/** A Keeper turn that lands, and the assistant message the delivery replacement needs after it. */
const delivered = (text) => [
	fauxAssistantMessage([fauxToolCall("narrate", { text })], { stopReason: "toolUse" }),
	fauxAssistantMessage("Should never be consumed."),
];
const steers = (session) => customMessages(session.session, "coc-host").filter((message) => message.details.kind === "steer");

test("the host does not buy a provider call for a turn it has just abandoned", async (t) => {
	// The second and third responses are the ones turn 117's steer reached for. If the steer still
	// goes out, the run continues into them and the turn delivers; nothing else in this table can
	// consume them, so their arrival *is* the defect.
	const session = await openTable({ retainAt: directory, responses: [abandoned(), ...delivered("The hallway is quiet.")] });
	t.after(() => session.dispose());
	await session.session.prompt("I listen at the door.");
	await waitForIdle(session.session);

	assert.deepEqual(steers(session), [],
		"the abandoned run was steered back, and the steer is another provider call on the same turn");
	assert.ok(!assistantTexts(session.session).includes("The hallway is quiet."),
		"a continuation consumed the next scripted response, so a second call really did go out");
	const calls = session.telemetry().filter((row) => row.lane === "provider-call");
	assert.deepEqual(calls.map((row) => row.stop_reason), ["aborted"],
		`one abandoned call and no successor: ${JSON.stringify(calls)}`);
});

test("an abandoned turn is settled, told and released in this process", async (t) => {
	// The other half of the same seam. With the steer gone the run reaches `agent_settled`, which is
	// where §38 and §50 already knew what to do: strand the turn, hand the player the settled facts
	// and the service line, and release the turn without waiting for a replacement process or for the
	// player's next sentence. On turn 117 none of that ran, because the run never settled.
	const session = await openTable({ retainAt: directory, env: { FAKE_KERNEL_STRICT_TURN: "1" },
		responses: [abandoned(), ...delivered("The handle turns.")] });
	t.after(() => session.dispose());
	await session.session.prompt("I listen at the door.");
	await waitForIdle(session.session);

	const told = await waitFor(() => {
		const notices = customMessages(session.session, "coc-delivery").filter((message) => message.details.turn_unfinished);
		return notices.length > 0 ? notices : undefined;
	}, { label: "the abandoned turn's service notice" });
	assert.equal(told.length, 1, JSON.stringify(told));
	assert.equal(told[0].details.turn, 1);
	assert.ok(told[0].content.trim() && !/^turn_unfinished_notice$/.test(told[0].content.trim()),
		`a caption the surface lacks renders as its key, which is a gap and not a notice: ${told[0].content}`);

	await waitFor(() => session.telemetry().some((row) => row.lane === "turn" && row.event === "released" && row.ok === true),
		{ label: "the stranded release this process owes the turn" });
	const rows = session.telemetry();
	assert.ok(rows.some((row) => row.lane === "turn" && row.event === "abandoned_not_steered" && row.turn === 1),
		JSON.stringify(rows.filter((row) => row.lane === "turn")));

	// And the table is playable again straight away: the release already happened, so the next
	// sentence opens a new turn instead of being refused by turn_state or paying for a release.
	await session.session.prompt("I try the handle.");
	await waitForIdle(session.session);
	assert.ok(assistantTexts(session.session).includes("The handle turns."), JSON.stringify(assistantTexts(session.session)));
});

test("a run that ends without delivering for any other reason is still steered", async (t) => {
	// The guard names one stop reason and nothing else. A Keeper who ends a run having closed
	// nothing is the case these steers exist for, and it must keep working -- the fix is about who
	// abandoned the run, not about how the run ended. Same empty message, `stop` instead of
	// `aborted`: the only difference between the two tests is whose decision ended the call.
	const session = await openTable({ retainAt: directory,
		responses: [fauxAssistantMessage([], { stopReason: "stop" }), ...delivered("The hallway is quiet.")] });
	t.after(() => session.dispose());
	await session.session.prompt("I listen at the door.");
	await waitForIdle(session.session);

	assert.equal(steers(session).length, 1, JSON.stringify(steers(session).map((message) => message.details)));
	assert.ok(assistantTexts(session.session).includes("The hallway is quiet."),
		"the steer must still be what closes a turn the Keeper left open");
});
