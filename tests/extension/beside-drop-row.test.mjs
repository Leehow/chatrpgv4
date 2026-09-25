/**
 * SL-50 (contract §135.11.1): the `text_beside_tool_calls` drop row names its step and its calls.
 *
 * Long gates #3-#5 dropped prose beside tool calls 46 times; the row said how many blocks went and nothing else, so pairing a
 * drop with its step and the step's calls took the play driver's event log. The owner's keep rule for prose beside admitted
 * applies is held on that measurement (the drafts were the Keeper announcing its bookkeeping, 23-55 characters against turns
 * of 163-484), so the prose is still dropped; the row now carries what the rule would read.
 *
 * - Legacy engine over the emitted kernel: prose beside an admitted `apply` and prose beside a refused one each leave one row
 *   with the call's kind and outcome (`landed` with the review's verdict; `refused` with its code), the prose never reaches
 *   the transcript, and the turn is delivered by the Keeper's own narrate.
 * - A message whose calls a gate blocked names them `not_run`.
 * - Hybrid engine: the row names the model step the message answered.
 *
 * Assertions read telemetry rows, the transcript's block structure and the turn record -- never the prose.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { openTable, waitForIdle } from "./harness.mjs";
import { createHybridEngine } from "../../runtime/jev/hybrid-engine.ts";

const root = resolve(import.meta.dirname, "../..");

/** Turn 1 walked into the morgue and closed; the player speaks next at turn 2 (the emitted kernel, through its own RPC). */
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
/** One assistant message: prose, then the calls (the shape all 46 live drops had). */
const beside = (prose, ...calls) => fauxAssistantMessage([fauxText(prose), ...calls], { stopReason: "toolUse" });
const drops = (table) => table.telemetry().filter((row) => row.lane === "delivery" && row.reason === "text_beside_tool_calls");
const narrate = (text) => fauxAssistantMessage([fauxToolCall("narrate", { text })], { stopReason: "toolUse" });
const turnRecord = (workspace, turn) => JSON.parse(readFileSync(join(workspace, ".coc/campaigns/test-camp/turns", `${String(turn).padStart(4, "0")}.json`), "utf8"));

test("legacy: prose beside an admitted apply and beside a refused one each leave one row naming the call and its outcome", async (t) => {
	const table = await openTable({ realKernel: true, prepareWorkspace: turnOneClosed, responses: [
		beside("我先把这段翻找记进时间。", fauxToolCall("apply", { effects: [{ kind: "time", minutes: 10, why: "the search takes ten minutes" }] })),
		beside("再让柜台后的人露面。", fauxToolCall("apply", { effects: [{ kind: "npc", name: "Ruth Blakemore", to: "here", why: "placed" }] })),
		narrate("你翻了十分钟剪报。"),
	] });
	t.after(() => table.dispose());
	await table.session.prompt("我翻一翻剪报。");
	await waitForIdle(table.session);
	const rows = drops(table);
	assert.equal(rows.length, 2, "one row per message that carried prose beside its calls");
	assert.deepEqual(rows.map((row) => row.calls), [
		[{ tool: "apply", outcome: "landed", admission: "authorized" }],
		[{ tool: "apply", outcome: "refused", code: "unknown_entity" }],
	]);
	for (const row of rows) {
		assert.equal(row.turn, 2);
		assert.equal(row.dropped, 1);
		assert.equal(row.step, null, "the legacy engine has no step");
	}
	const withCalls = table.session.messages.filter((message) => message.role === "assistant" && message.content.some((block) => block.type === "toolCall"));
	assert.ok(withCalls.length >= 3);
	assert.ok(withCalls.every((message) => !message.content.some((block) => block.type === "text")), "the prose beside a call never reaches the transcript");
	assert.equal(turnRecord(table.workspace, 2).closed_by, "narrate", "the turn is delivered by the Keeper's own narrate");
});

test("legacy: calls a gate blocked never answer, and the row names them not_run", async (t) => {
	const table = await openTable({ realKernel: true, prepareWorkspace: turnOneClosed, responses: [
		// Two deliveries in one message: §34.17 refuses both before either runs.
		beside("先说一半。", fauxToolCall("narrate", { text: "第一半。" }), fauxToolCall("narrate", { text: "第二半。" })),
		narrate("你翻了十分钟剪报。"),
	] });
	t.after(() => table.dispose());
	await table.session.prompt("我翻一翻剪报。");
	await waitForIdle(table.session);
	assert.deepEqual(drops(table).map((row) => row.calls), [[{ tool: "narrate", outcome: "not_run" }, { tool: "narrate", outcome: "not_run" }]]);
	assert.equal(turnRecord(table.workspace, 2).closed_by, "narrate");
});

test("hybrid: the row names the model step the message answered", async (t) => {
	const engine = createHybridEngine({ env: process.env, decision: null });
	const table = await openTable({ realKernel: true, prepareWorkspace: turnOneClosed, env: { PI_COC_LOOP_ENGINE: "hybrid-v1" },
		runDriver: engine.runDriver, extraExtensions: [{ name: "coc-hybrid-engine", factory: engine.extension }], responses: [
			beside("我先把这段翻找记进时间。", fauxToolCall("apply", { effects: [{ kind: "time", minutes: 10, why: "the search takes ten minutes" }] })),
			narrate("你翻了十分钟剪报。"),
		] });
	t.after(() => table.dispose());
	await table.session.prompt("我翻一翻剪报。");
	await waitForIdle(table.session);
	const [row] = drops(table);
	assert.deepEqual(row?.calls, [{ tool: "apply", outcome: "landed", admission: "authorized" }]);
	const infers = table.telemetry().filter((entry) => entry.lane === "run" && entry.type === "step_end" && entry.kind === "infer");
	assert.ok(infers.length >= 2, "the run took its model steps");
	assert.equal(row.step, infers[0].stepId, "the step whose answer carried the prose");
	assert.equal(row.run, infers[0].runId);
});
