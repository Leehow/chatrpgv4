/**
 * SL-88 (contract §135.5.1, "what needs no result does not wait"): a non-blocking `apply` -- one whose landing is
 * fixed by its own arguments -- goes out with the `narrate` that describes it in one message, writes first, narrate
 * last, instead of costing a whole extra model step (gate #18: 2.8 calls/turn, 9.3 s each). §135.5's own order and
 * failure branch are unchanged: a refused step still stops the batch and returns the run to the Keeper. §34.13.1
 * gives the narrate a way to mark where a same-batch write happened without its own placement marker, which has not
 * come back yet: an effect key, `{{kind:handle}}`.
 *
 * The seam: the real `apply`/`resolve`/`narrate` tools, the emitted kernel, and the hybrid single-loop engine (the
 * batch shape and the failure branch are its `modelStep`/`PlanArtifact` machinery, §135.5).
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { openTable, waitForIdle } from "./harness.mjs";
import { createHybridEngine } from "../../runtime/jev/hybrid-engine.ts";

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
/** One row per assistant message the Keeper's own model actually produced (contract §12.8.1) -- unlike the run's
 *  internal `lane: "run", kind: "infer"` steps, which also cover policy-origin decisions that spend no model call. */
const keeperCalls = (table) => table.telemetry().filter((entry) => entry.lane === "provider-call").length;
const hybridTable = (options) => {
	const engine = createHybridEngine({ env: process.env, decision: null });
	return openTable({ realKernel: true, prepareWorkspace: turnOneClosed,
		env: { PI_COC_LOOP_ENGINE: "hybrid-v1", ...(options?.env ?? {}) },
		runDriver: engine.runDriver, extraExtensions: [{ name: "coc-hybrid-engine", factory: engine.extension }],
		responses: options.responses });
};

test("§135.5.1: a batch of non-blocking writes and their narrate settle both writes, resolve the effect-key marker, and deliver in one model step", async (t) => {
	const table = await hybridTable({ responses: [
		fauxAssistantMessage([
			fauxToolCall("apply", { effects: [{ kind: "clue", clue: "globe-unpublished-story", why: "found while going through the clippings" }] }),
			fauxToolCall("apply", { effects: [{ kind: "time", minutes: 10, why: "the search takes ten minutes" }] }),
			fauxToolCall("narrate", { text: "你翻了十分钟剪报，找到了那篇被压下的旧闻 {{clue:globe-unpublished-story}}。" }),
		], { stopReason: "toolUse" }),
	] });
	t.after(() => table.dispose());
	await table.session.prompt("我翻一翻剪报，看看有没有旧闻。");
	await waitForIdle(table.session);

	assert.equal(table.telemetry().filter((entry) => entry.tool === "apply" && entry.ok === true).length, 2, "both non-blocking writes landed");
	assert.equal(table.telemetry().filter((entry) => entry.tool === "narrate" && entry.ok === true && entry.event === undefined).length, 1);
	// One model call carried the whole batch: no second Keeper call was needed to write the narrate alone.
	assert.equal(keeperCalls(table), 1, `the batch delivered in the Keeper's one call (${keeperCalls(table)} provider calls)`);

	const record = turnRecord(table.workspace, 2);
	assert.equal(record.closed_by, "narrate");
	assert.ok(!record.rendered_text.includes("{{") && !record.rendered_text.includes("}}"), "no brace reached the player");
	assert.ok(record.rendered_text.includes("找到了那篇被压下的旧闻"));
	assert.equal(record.mechanics.length, 2, "both the clue and the time advance still project a mechanics card");
	assert.deepEqual(record.receipts.map((r) => r.kind).sort(), ["clue", "time"]);
});

test("§135.5: a refused first write leaves the narrate of the same message unexecuted, and the run returns to the Keeper", async (t) => {
	const table = await hybridTable({ responses: [
		fauxAssistantMessage([
			// An unknown clue: the kernel refuses this write outright (unknown_entity), before admission even matters.
			fauxToolCall("apply", { effects: [{ kind: "clue", clue: "no-such-clue-in-this-book", why: "found while going through the clippings" }] }),
			fauxToolCall("apply", { effects: [{ kind: "time", minutes: 10, why: "the search takes ten minutes" }] }),
			fauxToolCall("narrate", { text: "你翻了十分钟剪报，找到了那篇被压下的旧闻。" }),
		], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("narrate", { text: "你翻了半天，什么都没找到。" })], { stopReason: "toolUse" }),
	] });
	t.after(() => table.dispose());
	await table.session.prompt("我翻一翻剪报，看看有没有旧闻。");
	await waitForIdle(table.session);

	assert.equal(table.telemetry().filter((entry) => entry.tool === "apply" && entry.ok === true).length, 0, "the refused write never landed");
	assert.equal(table.telemetry().filter((entry) => entry.tool === "time").length, 0, "the second write of the same message never reached the kernel either");
	assert.ok(table.telemetry().some((entry) => entry.lane === "run" && entry.reason === "batch_step_fell: apply_refused"),
		"the batch's remaining steps -- the second write and that message's own narrate -- were answered as not executed (§135.5)");
	assert.ok(table.telemetry().some((entry) => entry.lane === "run" && entry.reason === "batch_fallen" && entry.kind === "infer"),
		"the run's next step asked the Keeper again, no route question in between");
	assert.equal(table.telemetry().filter((entry) => entry.tool === "narrate" && entry.ok === true && entry.event === undefined).length, 1,
		"the turn still closed, on the Keeper's next message");
	const record = turnRecord(table.workspace, 2);
	assert.ok(record.rendered_text.includes("什么都没找到"), "delivered from the Keeper's second message, not the fallen batch's draft");
});

test("§135.5.1: a batch carrying a resolve before its narrate still runs to completion (guidance only, no host refusal)", async (t) => {
	const table = await hybridTable({ responses: [
		fauxAssistantMessage([
			fauxToolCall("resolve", { action: { intent: "investigate", skill: "Library Use", goal: "find the file", method: "search the clippings" } }),
			fauxToolCall("narrate", { text: "你查了一下剪报索引。" }),
		], { stopReason: "toolUse" }),
	] });
	t.after(() => table.dispose());
	await table.session.prompt("我翻一翻剪报索引。");
	await waitForIdle(table.session);

	assert.ok(table.telemetry().some((entry) => entry.tool === "resolve" && entry.ok === true), "the resolve ran");
	assert.equal(table.telemetry().filter((entry) => entry.tool === "narrate" && entry.ok === true && entry.event === undefined).length, 1,
		"the narrate of the same message still ran and closed the turn -- the shape is guidance, not a host gate");
	assert.equal(turnRecord(table.workspace, 2).closed_by, "narrate");
});
