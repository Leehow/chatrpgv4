/**
 * SL-92 (contract §135.5.2, "apply carries the narration that closes the turn"): `apply` gains an optional
 * `narrate` field. When every effect of the call lands, the host runs that text through the exact same path an
 * explicit `narrate` call takes (rendering, marker resolution, the narration audit, delivery, turn close) --
 * recursively, on a synthetic call of its own -- so one model tool call can both settle a turn's writes and
 * close it. If any effect is refused, or the narration audit refuses the embedded text, nothing is delivered:
 * the Keeper reads the refusal exactly as an explicit narrate's own, and the effects that did land stand.
 *
 * The seam: the real `apply`/`narrate` tools, the real admission path, the emitted kernel, and the hybrid
 * single-loop engine (the batch/delivery bookkeeping this ticket also touches, §135.5.2's `modelStep` note).
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { openTable, waitForIdle } from "./harness.mjs";
import { createHybridEngine } from "../../runtime/jev/hybrid-engine.ts";
import { reviewUnavailable } from "../../extensions/mods/audit-budget.ts";

const root = resolve(import.meta.dirname, "../..");

/** Turn 1 walked into the newspaper morgue and closed; the player speaks next at turn 2 (the emitted kernel). */
function turnOneClosed(workspace) {
	const input = [["table.open", {}], ["table.player_input", { text: "我去《环球报》报馆" }],
		["table.apply", { call_id: "t1-c1", effects: [{ kind: "move", to: "newspaper-morgue" }] }],
		["table.narrate", { call_id: "t1-c2", text: "报馆的剪报室很安静。" }]]
		.map(([method, params], index) => JSON.stringify({ id: String(index), method, params: { campaign: "test-camp", ...params } })).join("\n");
	const run = spawnSync(process.execPath, [join(root, "build/kernel/rpc.mjs"), "--workspace", workspace, "--content", join(root, "content")],
		{ cwd: root, input: `${input}\n`, encoding: "utf8" });
	for (const frame of run.stdout.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line)).filter((frame) => !frame.progress))
		if (!frame.ok) throw new Error(`fixture step ${frame.id} failed: ${JSON.stringify(frame.error)}`);
}

const turnRecord = (workspace, turn) => JSON.parse(readFileSync(join(workspace, ".coc/campaigns/test-camp/turns", `${String(turn).padStart(4, "0")}.json`), "utf8"));
const keeperCalls = (table) => table.telemetry().filter((entry) => entry.lane === "provider-call").length;
const deliveryRows = (table) => table.telemetry().filter((entry) => entry.lane === "delivery" && entry.reason === "narrate_in_apply");
const hybridTable = ({ responses, env }) => {
	const engine = createHybridEngine({ env: process.env, decision: null });
	return openTable({ realKernel: true, prepareWorkspace: turnOneClosed,
		env: { PI_COC_LOOP_ENGINE: "hybrid-v1", ...(env ?? {}) },
		runDriver: engine.runDriver, extraExtensions: [{ name: "coc-hybrid-engine", factory: engine.extension }], responses });
};

test("apply {effects, narrate}: settles the effect, delivers the narrate and closes the turn in one model step", async (t) => {
	const table = await hybridTable({ responses: [
		fauxAssistantMessage([fauxToolCall("apply", {
			effects: [{ kind: "clue", clue: "globe-unpublished-story", why: "found while going through the clippings" }],
			narrate: "你翻了十分钟剪报，找到了那篇被压下的旧闻 {{clue:globe-unpublished-story}}。",
		})], { stopReason: "toolUse" }),
	] });
	t.after(() => table.dispose());
	await table.session.prompt("我翻一翻剪报，看看有没有旧闻。");
	await waitForIdle(table.session);

	assert.equal(table.telemetry().filter((entry) => entry.tool === "apply" && entry.ok === true).length, 1, "the effect landed");
	assert.equal(table.telemetry().filter((entry) => entry.tool === "narrate" && entry.ok === true && entry.event === undefined).length, 1,
		"the embedded narrate landed too, through the same tool");
	assert.equal(keeperCalls(table), 1, `one model call closed the whole turn (${keeperCalls(table)} provider calls)`);
	assert.deepEqual(deliveryRows(table).map((row) => row.ok), [true]);

	const record = turnRecord(table.workspace, 2);
	assert.equal(record.closed_by, "narrate");
	assert.ok(!record.rendered_text.includes("{{") && !record.rendered_text.includes("}}"), "no brace reached the player");
	assert.ok(record.rendered_text.includes("找到了那篇被压下的旧闻"));
	assert.equal(record.mechanics.length, 1, "the clue still projects a mechanics card");
	assert.deepEqual(record.receipts.map((r) => r.kind), ["clue"]);

	// The transcript's tool-result for this call is under the outer apply's own toolCallId, not a synthetic one.
	const applyResult = table.session.messages.find((message) => message.role === "toolResult" && message.toolName === "apply");
	assert.ok(applyResult, "the apply call's own tool result carries the combined delivery");
	const details = JSON.parse(applyResult.content.map((block) => block.text ?? "").join(""));
	assert.equal(details.narrate_in_apply, true);
	assert.ok(typeof details.rendered_text === "string" && details.rendered_text.length > 0);
});

test("a refused effect leaves nothing delivered; the run returns to the Keeper (§135.5 unaffected by the embedded text)", async (t) => {
	const table = await hybridTable({ responses: [
		fauxAssistantMessage([fauxToolCall("apply", {
			effects: [{ kind: "clue", clue: "no-such-clue-in-this-book", why: "found while going through the clippings" }],
			narrate: "你翻了十分钟剪报，找到了那篇被压下的旧闻。",
		})], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("narrate", { text: "你翻了半天，什么都没找到。" })], { stopReason: "toolUse" }),
	] });
	t.after(() => table.dispose());
	await table.session.prompt("我翻一翻剪报，看看有没有旧闻。");
	await waitForIdle(table.session);

	assert.equal(table.telemetry().filter((entry) => entry.tool === "apply" && entry.ok === true).length, 0, "the refused effect never landed");
	assert.equal(deliveryRows(table).length, 0, "the embedded narrate was never even attempted -- the apply itself was refused first");
	assert.equal(table.telemetry().filter((entry) => entry.tool === "narrate" && entry.ok === true && entry.event === undefined).length, 1,
		"the turn closed on the Keeper's next, separate message");
	const record = turnRecord(table.workspace, 2);
	assert.ok(record.rendered_text.includes("什么都没找到"));
});

test("a narration-audit refusal of the embedded text is reported like an explicit narrate's own refusal; the landed effect stands", async (t) => {
	// The stub bridge pauses the review (§38) on the first narrate it sees, embedded or explicit alike, which is
	// exactly what an explicit narrate's own audit refusal already does today -- this call is not special-cased.
	// The refused apply still falls the batch (§135.5): the run asks the Keeper once more (`batch_fallen`), and
	// that leg's own prose is what the paused review then holds too -- the same shape a refused explicit
	// narrate's second leg already has, unrelated to this ticket's own change.
	const table = await hybridTable({ responses: [
		fauxAssistantMessage([fauxToolCall("apply", {
			effects: [{ kind: "time", minutes: 10, why: "the search takes ten minutes" }],
			narrate: "你翻了十分钟剪报。",
		})], { stopReason: "toolUse" }),
		fauxAssistantMessage("你还是没找到那份档案。"),
	] });
	t.after(() => table.dispose());
	table.emit("coc:mods-bridge", { async after() {}, async prepare(method) {
		if (method === "narrate") throw reviewUnavailable("Fixture budget exhausted");
	} });
	await table.session.prompt("我翻一翻剪报，看看有没有旧闻。");
	await waitForIdle(table.session);

	// The effect landed and stands: it is not retried, and its receipt is on the books.
	assert.equal(table.telemetry().filter((entry) => entry.tool === "apply" && entry.ok === true).length, 1, "the apply's own effect landed");
	assert.equal(deliveryRows(table).length, 1);
	assert.equal(deliveryRows(table)[0].ok, false, "the embedded narrate itself was refused");

	// The refused apply's own tool result: isError, the effects still named, no fiction delivered from it.
	const applyResult = table.session.messages.find((message) => message.role === "toolResult" && message.toolName === "apply");
	assert.equal(applyResult.isError, true, "the refusal reaches the Keeper as today's narrate refusal would");
	const details = JSON.parse(applyResult.content.map((block) => block.text ?? "").join(""));
	assert.equal(details.narrate_in_apply, false);
	assert.equal(details.coc_error?.details?.reason, "continuity_review_unavailable");
	assert.ok(Array.isArray(details.effects) || Array.isArray(details.receipts), "the landed effect is still named in the result");
	// Nothing reached the player from this run: the paused review holds the batch-fallen leg's own prose too.
	assert.equal(table.telemetry().filter((entry) => entry.tool === "narrate" && entry.ok === true).length, 0);
	assert.equal(keeperCalls(table), 2, "the refused apply falls the batch (§135.5); the run's own recovery is unrelated to this ticket");
});

test("an apply with no narrate field behaves exactly as before: no embedded dispatch, no narrate_in_apply row", async (t) => {
	const table = await hybridTable({ responses: [
		fauxAssistantMessage([fauxToolCall("apply", { effects: [{ kind: "time", minutes: 10, why: "the search takes ten minutes" }] })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("narrate", { text: "你翻了十分钟剪报。" })], { stopReason: "toolUse" }),
	] });
	t.after(() => table.dispose());
	await table.session.prompt("我翻一翻剪报，看看有没有旧闻。");
	await waitForIdle(table.session);

	assert.equal(table.telemetry().filter((entry) => entry.tool === "apply" && entry.ok === true).length, 1);
	assert.equal(deliveryRows(table).length, 0, "no embedded narrate was ever attempted");
	assert.equal(table.telemetry().filter((entry) => entry.tool === "narrate" && entry.ok === true && entry.event === undefined).length, 1);
	assert.equal(keeperCalls(table), 2, "still two Keeper calls, exactly as before this ticket");
	const applyResult = table.session.messages.find((message) => message.role === "toolResult" && message.toolName === "apply");
	const details = JSON.parse(applyResult.content.map((block) => block.text ?? "").join(""));
	assert.equal(Object.hasOwn(details, "narrate_in_apply"), false);
});
