/**
 * Contract §73. A turn the host has declared stranded closes itself, without waiting for the player.
 *
 * §38 gave the host the declaration and left the close welded to the next `table.player_input`, so the
 * declaration lived in one process's memory and nothing on disk recorded it. Retained live evidence
 * (H-SIDE t4 `game-1c0faba5`, turn 86, 2026-09-17): the host wrote its §50 card at 00:21:50
 * (`delivery ... settled_without_delivery rows:2`), and `turns/0086.json` was written at 00:56:18 --
 * the moment the player typed again, 43 minutes and one fruitless server restart later. `turn.json` read
 * `{"turn":86,"state":"acting"}` the whole time, so every ordinary `table.player_input` was refused.
 *
 * The evidence also says what was *not* broken: once released, the record landed with `closed_by:
 * "stranded"` and all four receipts intact. The writing was fine. The trigger was missing.
 *
 * The whole path is real here: the product kernel subprocess owns the turn record, and the shipped
 * extension is what decides the turn was stranded.
 */
import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { openTable, waitFor, waitForIdle } from "./harness.mjs";
import { reviewUnavailable } from "../../extensions/mods/audit-budget.ts";

const narrate = (text) => fauxAssistantMessage([fauxToolCall("narrate", { text })], { stopReason: "toolUse" });
const look = () => fauxAssistantMessage([fauxToolCall("look", { focus: "scene" })], { stopReason: "toolUse" });

/** The review refuses this table's every delivery, which is §38.3's predicate arriving by its commonest road. */
function refuseEveryDelivery(table) {
	table.emit("coc:mods-bridge", {
		async after() {},
		async prepare(method) {
			if (method === "narrate" || method === "ask") throw reviewUnavailable("Fixture review is paused");
		},
	});
}

const turnFile = (table, campaign) => join(table.workspace, ".coc/campaigns", campaign, "turn.json");
const recordFile = (table, campaign, turn) =>
	join(table.workspace, ".coc/campaigns", campaign, "turns", `${String(turn).padStart(4, "0")}.json`);
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

test("a run that settles with nothing delivered writes the stranded record before the player says anything else", async (t) => {
	const campaign = "stranded-closes-itself";
	const table = await openTable({
		realKernel: true,
		campaign,
		responses: [
			narrate("门在你身后合上。"),
			fauxAssistantMessage("开场之后多写的一句。"),
			// The stranded turn: a receipt lands, then the delivery is refused and the run settles.
			look(),
			narrate("这一段没有通过复核。"),
			fauxAssistantMessage("不该被用到。"),
		],
	});
	t.after(() => table.dispose());
	await waitForIdle(table.session, { timeoutMs: 60_000 });
	refuseEveryDelivery(table);

	await table.session.prompt("我推门进去，先听一听。");
	await waitForIdle(table.session, { timeoutMs: 60_000 });

	// The assertion is the artifact, not a telemetry row about it: the record on disk and the cursor the
	// player's next utterance would meet. Both must be true with no further input.
	const cursor = await waitFor(
		async () => {
			const value = await readJson(turnFile(table, campaign)).catch(() => undefined);
			return value?.state === "awaiting_player" ? value : undefined;
		},
		{ label: "the table to leave `acting` with no further player input", timeoutMs: 20_000 },
	);
	assert.equal(cursor.turn, 2);

	const record = await readJson(recordFile(table, campaign, 1));
	assert.equal(record.closed_by, "stranded");
	assert.equal(record.rendered_text, null);
	assert.equal(record.commit, null);
	// §38.2: evidence is preserved, never discarded. The player's own words stay on the record too.
	assert.equal(record.player_text, "我推门进去，先听一听。");
});

/**
 * The kernel not answering is the condition that strands most turns, so §38's input-carried release stays
 * armed behind §73's own call. On turn 86 the kernel was refusing `mods.job`, `table.capsule` and
 * `table.player_input` in the same window; a close that only works when the kernel is healthy would have
 * changed nothing about that table.
 */
test("a release the kernel refuses leaves the turn marked, and the next player input carries it", async (t) => {
	const table = await openTable({
		responses: [
			look(),
			narrate("这一段没有通过复核。"),
			fauxAssistantMessage("不该被用到。"),
			look(),
			fauxAssistantMessage("第二回合也不该交付。"),
		],
		env: { FAKE_KERNEL_RELEASE_REFUSES: "1" },
	});
	t.after(() => table.dispose());
	refuseEveryDelivery(table);

	await table.session.prompt("我推门进去，先听一听。");
	await waitForIdle(table.session, { timeoutMs: 60_000 });
	// The release was attempted and refused, so the mark is still owed.
	assert.equal(table.kernelRequests().filter((request) => request.method === "table.release").length, 1);

	await table.session.prompt("我改主意，退回走廊。");
	await waitForIdle(table.session, { timeoutMs: 60_000 });

	const inputs = table.kernelRequests().filter((request) => request.method === "table.player_input");
	assert.equal(inputs.length, 2);
	assert.deepEqual(inputs.map((input) => input.params.release), [undefined, "stranded"]);
});
