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
import { createHybridEngine } from "./hybrid-engine-fixture.mjs";
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

// §160.1 (owner's ruling 2026-10-01, superseding the transport boundary's refusal of this shape for tool arguments): a
// literal with the arguments object's stray closing brace is decoded where the arguments enter the host, layer by layer
// (the brace and quotes, then the escapes inside), and delivered on the first leg with its committed effect.
test('serialized embedded narration is decoded at the argument boundary and delivered with its committed effect',async t=>{
  const fragment=JSON.stringify('\\u0054he clipping is on the desk.\\nThe papers are dusty and the headline is now visible.')+'}';
  const prose='The clipping is on the desk.\nThe papers are dusty and the headline is now visible.';
  const table=await hybridTable({responses:[
    fauxAssistantMessage([fauxToolCall('apply',{effects:[{kind:'clue',clue:'globe-unpublished-story',why:'The player found the clipping.'}],narrate:fragment})],{stopReason:'toolUse'})]});
  t.after(()=>table.dispose());await table.session.prompt('I search the clippings for the old story.');await waitForIdle(table.session);
  assert.equal(table.telemetry().filter(row=>row.tool==='apply'&&row.ok===true).length,1);
  assert.deepEqual(table.telemetry().filter(row=>row.event==='json_string_decoded').map(row=>row.shapes),[['envelope','body']]);
  const record=turnRecord(table.workspace,2);
  assert.equal(record.rendered_text,prose);
  assert.equal(record.receipts.filter(receipt=>receipt.kind==='clue').length,1);
  assert.deepEqual(deliveryRows(table).map(row=>row.ok),[true]);
});

test("apply {effects, narrate}: settles the effect, delivers the narrate and closes the turn in one model step", async (t) => {
	// SL-93 (§135.11.4.1): the embedded narrate now carries its own length floor too, so this fixture's
	// prose clears it (45 code points once the marker is removed) -- unrelated to what this test is about.
	const table = await hybridTable({ responses: [
		fauxAssistantMessage([fauxToolCall("apply", {
			effects: [{ kind: "clue", clue: "globe-unpublished-story", why: "found while going through the clippings" }],
			narrate: "你在剪报室里翻了十分钟，指尖沾了灰，纸页边缘已经发黄发脆，终于找到了那篇被压下的旧闻 {{clue:globe-unpublished-story}}。",
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
	assert.deepEqual(table.telemetry().filter(row => row.event === "read_failed"
		&& ["table.apply.options", "table.resolve.options"].includes(row.method)), [],
		"accepted delivery does not request preparation options on a closed turn");

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
	// SL-93: the second message's explicit narrate now needs to clear the length floor too (it is the one that
	// actually reaches the kernel here; the first message's embedded narrate is never even attempted, since the
	// apply itself is refused first, so its own text does not need to clear anything).
	const table = await hybridTable({ responses: [
		fauxAssistantMessage([fauxToolCall("apply", {
			effects: [{ kind: "clue", clue: "no-such-clue-in-this-book", why: "found while going through the clippings" }],
			narrate: "你翻了十分钟剪报，找到了那篇被压下的旧闻。",
		})], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("narrate", { text: "你翻了大半天剪报，指尖都沾了灰，纸页边缘也磨得发毛，可翻来翻去，还是什么都没找到，一无所获。" })], { stopReason: "toolUse" }),
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



test("an apply with no narrate field behaves exactly as before: no embedded dispatch, no narrate_in_apply row", async (t) => {
	// SL-93: the second message's explicit narrate now needs to clear the length floor too, unrelated to what
	// this test is actually about (no embedded dispatch when apply carries no narrate field).
	const table = await hybridTable({ responses: [
		fauxAssistantMessage([fauxToolCall("apply", { effects: [{ kind: "time", minutes: 10, why: "the search takes ten minutes" }] })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("narrate", { text: "你翻了十分钟剪报，指尖沾了灰，纸页边缘都磨得发毛了，才把角落里那几张慢慢理出个头绪来。" })], { stopReason: "toolUse" }),
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

// Section 166 retires prose-repair retries. Single-pass delivery and real task guards have current coverage in single-pass-narration.test.mjs and jev-s0-delivery-guard.test.mjs.
