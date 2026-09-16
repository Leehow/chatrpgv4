/**
 * Contract §41: a refused `table.player_input` is never the player's sentence.
 *
 * Retained live evidence (campaign `game-3dd94f0a-4b26-41bc-96fa-f89a60abb143`, 2026-09-16T00:14): a
 * built-in package on disk failed manifest validation, `readModCatalog` threw out of `initializeMods`,
 * and `table.player_input` returned `invalid_params` — the same code a blank `text` gets. The host's
 * recovery table turned that into `next: change_input`, the Keeper told the player to say it again, the
 * same words failed the same way, and the Keeper then spent three `narrate` calls being refused
 * `turn_state` because no turn had opened. This file pins the host half: report, never "say it again".
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { customMessages, openTable, waitFor, waitForIdle } from "./harness.mjs";

const REFUSAL = JSON.stringify({
	"table.player_input": {
		code: "campaign_not_ready",
		message: "The npc-voice package this campaign locks does not load: A contributed profile key needs exactly a key, a label and an ask, and at most a shape",
		fix: "repair or remove the package at /somewhere/mods/npc-voice, then reopen the table; no player input can change this",
	},
});

const refusalNotices = (table) =>
	customMessages(table.session, "coc-delivery").filter((message) => message.details?.input_refused);
const hostNotes = (table) =>
	customMessages(table.session, "coc-host").filter((message) => message.details?.kind === "player-input-failed");

test("a refused player input tells the player the table refused it, not to repeat themselves", async (t) => {
	const table = await openTable({
		env: { FAKE_KERNEL_ERRORS: REFUSAL },
		responses: [fauxAssistantMessage("I have nothing to deliver.")],
	});
	t.after(() => table.dispose());

	await table.session.prompt("我问吧台后的侍者，那位烟斗美国人昨晚几点走的。");
	await waitForIdle(table.session);
	await waitFor(() => refusalNotices(table).length > 0, { label: "the refused-input service notice" });

	const [notice] = refusalNotices(table);
	assert.equal(refusalNotices(table).length, 1, "one refused input gets one player notice");
	assert.equal(notice.display, true, "the player has to be able to see it");
	assert.equal(notice.details.code, "campaign_not_ready");
	// The one thing the retained line got wrong: "请再说一遍你要做的事" — an instruction that cannot work.
	assert.doesNotMatch(notice.content, /请再说|再说一遍你|say (that|it) again|try again/i);
	assert.match(notice.content, /再说一遍也会同样失败|will fail the same way/i);
	assert.match(notice.content, /不是你的说法|not your wording/i);

	const [note] = hostNotes(table);
	assert.ok(note, "the Keeper is still told the call failed");
	assert.match(note.content, /no turn opened/);
	assert.match(note.content, /do not tell them\s+to say it again/);
	assert.match(note.content, /narrate and ask will be refused/);
	assert.match(note.content, /end this run without output/);
	assert.equal(note.details.deliverable, false);
});

test("a refused player input does not leave the context lane latched", async (t) => {
	const table = await openTable({
		env: { FAKE_KERNEL_ERRORS: REFUSAL },
		responses: [fauxAssistantMessage("I have nothing to deliver.")],
	});
	t.after(() => table.dispose());

	await table.session.prompt("我问吧台后的侍者。");
	await waitForIdle(table.session);

	const degraded = table.telemetry()
		.filter((row) => row.lane === "context" && row.event === "degraded" && row.reason === "player_input_not_accepted");
	assert.deepEqual(degraded, [], "no turn opened, so the lane prepares against the capsule it already holds");
});

test("a message with no text never reaches the kernel", async (t) => {
	const table = await openTable({ responses: [fauxAssistantMessage("Nothing to do.")] });
	t.after(() => table.dispose());

	await table.session.prompt("   ");
	await waitForIdle(table.session);

	assert.deepEqual(table.kernelRequests().filter((request) => request.method === "table.player_input"), [],
		"the host owns the one rule the player can break, so it does not spend a call to be told");
	const [notice] = customMessages(table.session, "coc-delivery").filter((message) => message.details?.empty_input);
	assert.ok(notice, "the player is told the one thing they can act on");
	assert.match(notice.content, /没有文字|no text/i);
});

test("the host-driven opening is not a player message and is not checked as one", async (t) => {
	// The opening run is triggered by the host's own message, not by a player prompt. If that reached the
	// blank-text guard it would answer the player with "that message had no text" before the table had said
	// anything at all.
	const table = await openTable({
		env: { FAKE_KERNEL_OPENING: "1" },
		responses: [
			fauxAssistantMessage([fauxToolCall("narrate", { text: "门厅里只亮着一盏灯。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("门厅里只亮着一盏灯。"),
		],
	});
	t.after(() => table.dispose());
	await waitForIdle(table.session);

	assert.deepEqual(customMessages(table.session, "coc-delivery").filter((message) => message.details?.empty_input), [],
		"the opening is host-driven and owes the player no blank-message notice");
	assert.deepEqual(customMessages(table.session, "coc-host").filter((message) => message.details?.kind === "player-input-empty"), []);
});
