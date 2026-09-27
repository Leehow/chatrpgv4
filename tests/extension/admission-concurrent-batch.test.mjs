/**
 * SL-88 (contract §32.12.4, "what needs no result does not wait"): the admission reviews of one model response's
 * write steps start together, as one lane round, instead of the strictly sequential rounds gate #18 measured (65
 * tool executions, 0 overlapping). `message_end` (the same hook that already reads the whole assistant message for
 * §135.11.1/§34.17/§78) starts every `apply`/`resolve` call's review before any of the batch has reached `runTool`,
 * and parks it in `state.admissionPending` -- the same map §32.12.2's one resend already collects a running round
 * from -- so the real call, when its own turn comes, finds the review already under way.
 *
 * The seam: the real `apply`/`narrate` tools, the real admission path, the emitted kernel, and a stub admission
 * lane that timestamps each request's start and answer so overlap is read directly off the clock, never inferred
 * from a wall-clock margin.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
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

const admissionRows = (table) => table.telemetry().filter((row) => row.lane === "admission");

/**
 * A scripted admission lane that timestamps every request's start and answer. `delayMs` is long enough that two
 * requests fired within the same event-loop turn are still both "in flight" when the assertions run; short enough
 * that the suite does not drag.
 */
function overlapStub(delayMs = 200, count = 4) {
	const events = [];
	const answer = () => ({ verdict: "authorized", grounds: "the player asked for it directly, in these words" });
	const stub = () => async () => {
		events.push({ event: "start", at: Date.now() });
		await new Promise((r) => setTimeout(r, delayMs));
		events.push({ event: "end", at: Date.now() });
		return fauxAssistantMessage(JSON.stringify(answer()));
	};
	return { events, responses: Array.from({ length: count }, stub) };
}

test("§32.12.4: two writes of one Keeper response have overlapping admission lane calls, and the kernel still lands them in order", async (t) => {
	const { events, responses } = overlapStub(200);
	const table = await openTable({
		realKernel: true, prepareWorkspace: turnOneClosed,
		env: { PI_COC_ADMISSION_FAST_MIN_CONFIDENCE: "off" },
		laneResponses: { admission: responses },
		responses: [
			fauxAssistantMessage([
				fauxToolCall("apply", { effects: [{ kind: "clue", clue: "globe-unpublished-story", why: "found while going through the clippings" }] }),
				fauxToolCall("apply", { effects: [{ kind: "time", minutes: 10, why: "the search takes ten minutes" }] }),
				fauxToolCall("narrate", { text: "你翻了十分钟剪报，找到了那篇被压下的旧闻。" }),
			], { stopReason: "toolUse" }),
			fauxAssistantMessage("after"),
		],
	});
	t.after(() => table.dispose());
	await table.session.prompt("我翻一翻剪报，看看有没有旧闻。");
	await waitForIdle(table.session);

	const starts = events.filter((e) => e.event === "start").map((e) => e.at);
	const ends = events.filter((e) => e.event === "end").map((e) => e.at);
	assert.equal(starts.length, 2, "both writes went to the lane (the fast path is off, so neither settled on a typed answer alone)");
	assert.ok(starts[1] < ends[0],
		`the second call's review started (t=${starts[1] - starts[0]}ms) before the first one answered (t=${ends[0] - starts[0]}ms) -- one round, not two, back to back`);

	// Execution still lands in the model's order, and the turn closes on the same message's narrate (one model step).
	assert.equal(table.telemetry().filter((entry) => entry.tool === "apply" && entry.ok === true).length, 2, "both writes reached the kernel");
	const rows = admissionRows(table);
	assert.equal(rows.length, 2);
	assert.ok(rows.every((row) => row.admitted === true), "both were admitted");
	const infers = table.telemetry().filter((entry) => entry.lane === "provider-call");
	// One Keeper call carried the whole batch (apply, apply, narrate); the next is the idle "after".
	assert.ok(infers.length <= 2, `the batch delivered in one model step (${infers.length} provider calls)`);
});

test("§32.12.4: a prefetch a batch never reaches (an earlier write refused) is left uncollected without error", async (t) => {
	// Both writes' own reviews refuse -- deliberately, so the assertions do not depend on which physical request a
	// concurrent lane assigns to which call: whichever the batch executes first falls, and the other's prefetch
	// (whether it ever ran, or is still mid-flight) is simply never collected. §135.5's failure branch, not §32.12.4's
	// own concurrency, is what this test is really about; the point is that concurrency does not break it.
	const events = [];
	const refuse = () => async () => { events.push({ event: "start", at: Date.now() }); await new Promise((r) => setTimeout(r, 100));
		events.push({ event: "end", at: Date.now() }); return fauxAssistantMessage(JSON.stringify({ verdict: "not_authorized", grounds: "the player asked for something else entirely" })); };
	const responses = [refuse(), refuse(), refuse(), refuse()];
	// §135.5's own failure branch ("the steps after a failed step are answered as not executed") is the hybrid
	// engine's `modelStep`/`PlanArtifact` machinery; this test is about that section, so it runs there.
	const engine = createHybridEngine({ env: process.env, decision: null });
	const table = await openTable({
		realKernel: true, prepareWorkspace: turnOneClosed, env: { PI_COC_LOOP_ENGINE: "hybrid-v1", PI_COC_ADMISSION_FAST_MIN_CONFIDENCE: "off" },
		runDriver: engine.runDriver, extraExtensions: [{ name: "coc-hybrid-engine", factory: engine.extension }],
		laneResponses: { admission: responses },
		responses: [
			fauxAssistantMessage([
				fauxToolCall("apply", { effects: [{ kind: "clue", clue: "globe-unpublished-story", why: "found while going through the clippings" }] }),
				fauxToolCall("apply", { effects: [{ kind: "time", minutes: 10, why: "the search takes ten minutes" }] }),
				fauxToolCall("narrate", { text: "你翻了十分钟剪报，找到了那篇被压下的旧闻。" }),
			], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "你想翻剪报，却什么都没找到。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("after"),
		],
	});
	t.after(() => table.dispose());
	await table.session.prompt("我翻一翻剪报，看看有没有旧闻。");
	await waitForIdle(table.session);

	// The refused first write stops the batch: nothing of it reached the kernel, and the narrate of that same
	// message never executed (§135.5) -- the run went back to the Keeper, which delivered on its next message.
	// (A landed narrate leaves two rows -- the call's own and a `event: "turn-closed"` companion, contract §38.11 --
	// so the count is of the call rows only.)
	assert.equal(table.telemetry().filter((entry) => entry.tool === "apply" && entry.ok === true).length, 0, "the refused write never landed");
	assert.equal(table.telemetry().filter((entry) => entry.tool === "narrate" && entry.ok === true && entry.event === undefined).length, 1,
		"only the second message's narrate landed");
	assert.ok(table.telemetry().some((entry) => entry.lane === "run" && entry.reason?.startsWith("batch_step_fell")),
		"the batch's own steps after the refusal were answered as not executed, never sent to the kernel");
	const rows = admissionRows(table);
	assert.equal(rows.filter((row) => row.admitted === false).length, 1, "the refusal is recorded");
	// Extra parked prefetch rounds resolving after the run has moved on must not throw or hang the process.
	await new Promise((r) => setTimeout(r, 300));
	assert.ok(true, "no unhandled rejection or hang from an uncollected prefetch");
});
