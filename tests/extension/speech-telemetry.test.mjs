/**
 * The §40.3 `lane: "speech"` row: one per delivery, measured rather than eyeballed.
 *
 * "Every spoken line is wrapped" is a claim about a model, and §34.13 showed marker compliance is
 * model-dependent and silent. This row is what that claim is checked against per turn: how many
 * spans the delivery marked, how many resolved to a person, how many stayed a label, and how many
 * people the capsule had on stage to be resolved against.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { openTable, waitFor } from "./harness.mjs";

const SPEECH = JSON.stringify([
	{ who: { npc: "steven-knott", name: "看门人" }, text: "别往下走。" },
	{ who: { investigator: "inv-thomas", name: "托马斯" }, text: "谁住在这儿？" },
	{ who: { label: "黑外套的女人" }, text: "你不该问。" },
]);

const speechRows = table => table.telemetry().filter(row => row.lane === "speech");

test("a narrate delivery leaves one speech row counting spans, people and labels", async (t) => {
	const table = await openTable({
		env: { FAKE_KERNEL_SPEECH: SPEECH },
		responses: [
			fauxAssistantMessage([fauxToolCall("narrate", { text: "看门人挡在门口。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("看门人挡在门口。"),
		],
	});
	t.after(() => table.dispose());
	await table.session.prompt("我敲门");
	await waitFor(() => speechRows(table).length >= 1, { label: "the speech row" });
	const [row] = speechRows(table);
	assert.equal(row.lines, 3);
	// An NPC and an investigator are people the kernel resolved; a label is a name it matched to nobody.
	assert.equal(row.resolved, 2);
	assert.equal(row.unresolved, 1);
	// The capsule's own present list, so a turn with nobody on stage reads differently from a quiet one.
	assert.equal(row.present, 1);
	assert.equal(typeof row.turn, "number");
	assert.equal(speechRows(table).length, 1, "one delivery, one row");
	// §40.4: the delivery card colours its speakers from the mechanics entry, and this turn rolled
	// nothing at all — a say-only delivery still owes the host that entry.
	const [entry] = table.entries("coc-mechanics");
	assert.deepEqual(entry.mechanics, []);
	assert.deepEqual(entry.speech.map(span => span.text), ["别往下走。", "谁住在这儿？", "你不该问。"]);
});

test("an ask delivery is a delivery too", async (t) => {
	const table = await openTable({
		env: { FAKE_KERNEL_SPEECH: JSON.stringify([{ who: { npc: "steven-knott", name: "看门人" }, text: "走还是留？" }]) },
		responses: [
			fauxAssistantMessage([fauxToolCall("ask", { prompt: "你怎么做？", options: ["留下", "离开"] })], { stopReason: "toolUse" }),
			fauxAssistantMessage("你怎么做？"),
		],
	});
	t.after(() => table.dispose());
	await table.session.prompt("我站在门口");
	await waitFor(() => speechRows(table).length >= 1, { label: "the speech row" });
	assert.deepEqual(speechRows(table).map(row => [row.lines, row.resolved, row.unresolved]), [[1, 1, 0]]);
});

test("a kernel that marks nothing leaves no row at all, rather than a row of zeros", async (t) => {
	const table = await openTable({
		responses: [
			fauxAssistantMessage([fauxToolCall("narrate", { text: "门厅里落满灰。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("门厅里落满灰。"),
		],
	});
	t.after(() => table.dispose());
	await table.session.prompt("我看看门厅");
	await waitFor(() => table.telemetry().some(row => row.tool === "narrate"), { label: "the narrate call row" });
	// A zero row would read as "this model wrapped nothing"; an absent row reads as "this kernel has no say pass".
	assert.deepEqual(speechRows(table), []);
	// And a delivery with neither mechanics nor speech still appends nothing, as it always did.
	assert.deepEqual(table.entries("coc-mechanics"), []);
});
