/**
 * SL-93 (contract §135.11.4.1, "one floor for every delivery path"; P0, gate #22): a placeholder reached the
 * player twice -- turn 1 delivered `apply {effects, narrate: "text thriftily-placeholder"}` verbatim as the
 * whole turn, and turn 8 delivered "text". §135.11.4's floor (SL-80) ran only on the implicit path
 * (`toolCallsThisTurn === 0` or a speech-only draft); an explicit `narrate` call and `apply`'s embedded one
 * both go through `runTool` directly and never met it, so four characters of prose passed every other gate.
 *
 * One shared structural count (`proseCharCount`, `extensions/kernel/unwrapped-speech.ts`) now backs a length
 * floor on all three paths: the implicit close (`message_end`), an explicit `narrate` call, and `apply`'s
 * embedded one (the same recursive call through `runTool` SL-92 already built). The threshold is
 * `delivery_floor.min_prose_chars` in `content/rulesets/coc7/host-budgets.json` (default 40), read through
 * `runtime/jev/host-budgets.ts`'s `deliveryFloorBudget`, never a literal in `extensions/kernel/index.ts`.
 *
 * The seam: `proseCharCount`/`deliveryFloorBudget` directly (pure, no table); the real `apply`/`narrate`
 * tools over the emitted kernel and the hybrid engine (proves writes land while an embedded narrate below the
 * floor does not deliver); the fake kernel and the hybrid engine (proves the explicit path's steer, the
 * dropped-draft rule once the steer is spent, and that editing the data file changes the outcome).
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { openTable, waitForIdle } from "./harness.mjs";
import { createHybridEngine } from "../../runtime/jev/hybrid-engine.ts";
import { ROUTE_FAMILY } from "../../runtime/jev/step-policy.ts";
import { isRunEvent } from "./pi-agent-core.mjs";
import { DELIVERY_FLOOR_FALLBACK, deliveryFloorBudget, resetDeliveryFloorBudgetCache } from "../../runtime/jev/host-budgets.ts";
import { proseCharCount } from "../../extensions/kernel/unwrapped-speech.ts";

const root = resolve(import.meta.dirname, "../..");

// ---------------------------------------------------------------------------------------------------------
// The structural count, and the loader, directly -- no table.
// ---------------------------------------------------------------------------------------------------------

test("proseCharCount: markers and say tokens are removed, but the spoken words inside a span stand", () => {
	assert.equal(proseCharCount("text"), 4);
	assert.equal(proseCharCount("{{clue:x}}"), 0, "a bare mechanics marker is not prose");
	assert.equal(proseCharCount("{{say:甲}}{{/say}}"), 0, "an empty span is withdrawn by the §40.1 repair, leaving nothing");
	// The say tokens themselves are gone, the words between them stand: exactly the kernel's own `rendered_text`
	// (`stripMarkers`, `kernel-ts/write/text.ts`) leaves them.
	assert.equal(proseCharCount('{{say:甲}}"是的，先生。"{{/say}}'), [..."\"是的，先生。\""].length);
	assert.equal(proseCharCount("他点了点头 {{check:x}} 什么也没说。"), [...("他点了点头  什么也没说。")].length);
});

test("deliveryFloorBudget: the shipped content/rulesets/coc7/host-budgets.json carries SL-93's own default", async () => {
	const budget = await deliveryFloorBudget();
	assert.deepEqual(budget, DELIVERY_FLOOR_FALLBACK, "the shipped file's delivery_floor matches the fallback it also names as the default");
});

function budgetFixture(t, deliveryFloor) {
	const dir = mkdtempSync(join(tmpdir(), "delivery-floor-budget-"));
	mkdirSync(join(dir, "rulesets", "coc7"), { recursive: true });
	writeFileSync(join(dir, "rulesets", "coc7", "host-budgets.json"), JSON.stringify({ schema_version: 1, look_budget: { per_turn: 8, tools: [] }, delivery_floor: deliveryFloor }));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	return dir;
}

test("deliveryFloorBudget: mutating the file's number changes what is returned -- proving it is read, not a constant", async (t) => {
	const first = await deliveryFloorBudget(budgetFixture(t, { min_prose_chars: 20 }));
	const second = await deliveryFloorBudget(budgetFixture(t, { min_prose_chars: 80 }));
	assert.notEqual(first.minProseChars, second.minProseChars);
	assert.equal(second.minProseChars, 80);
});

test("deliveryFloorBudget: an out-of-range or missing value falls back to the shipped default", async (t) => {
	assert.equal((await deliveryFloorBudget(budgetFixture(t, { min_prose_chars: 0 }))).minProseChars, DELIVERY_FLOOR_FALLBACK.minProseChars);
	assert.equal((await deliveryFloorBudget(budgetFixture(t, { min_prose_chars: -5 }))).minProseChars, DELIVERY_FLOOR_FALLBACK.minProseChars);
	assert.equal((await deliveryFloorBudget(budgetFixture(t, {}))).minProseChars, DELIVERY_FLOOR_FALLBACK.minProseChars);
});

// ---------------------------------------------------------------------------------------------------------
// The embedded path (`apply.narrate`): real kernel, real admission, hybrid engine (mirrors
// tests/extension/apply-narrate-combined.test.mjs's own seam, which SL-92 built and this ticket extends).
// ---------------------------------------------------------------------------------------------------------

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
const floorRows = (table) => table.telemetry().filter((entry) => entry.lane === "floor");
const realHybridTable = ({ responses, env }) => {
	const engine = createHybridEngine({ env: process.env, decision: null });
	return openTable({ realKernel: true, prepareWorkspace: turnOneClosed,
		env: { PI_COC_LOOP_ENGINE: "hybrid-v1", ...(env ?? {}) },
		runDriver: engine.runDriver, extraExtensions: [{ name: "coc-hybrid-engine", factory: engine.extension }], responses });
};

test("SL-93: apply {effects, narrate: 'text'} lands the effect but delivers nothing -- one floor steer, path embedded; the second leg with real prose delivers", async (t) => {
	const table = await realHybridTable({ responses: [
		fauxAssistantMessage([fauxToolCall("apply", {
			effects: [{ kind: "clue", clue: "globe-unpublished-story", why: "found while going through the clippings" }],
			narrate: "text",
		})], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("narrate", {
			text: "你在剪报室里翻了十分钟，指尖沾了灰，纸页边缘已经发黄发脆，终于找到了那篇被压下的旧闻 {{clue:globe-unpublished-story}}。",
		})], { stopReason: "toolUse" }),
	] });
	t.after(() => table.dispose());
	await table.session.prompt("我翻一翻剪报，看看有没有旧闻。");
	await waitForIdle(table.session);

	// The write landed and stands.
	assert.equal(table.telemetry().filter((entry) => entry.tool === "apply" && entry.ok === true).length, 1, "the effect landed");
	// Nothing was delivered from the first leg: the embedded narrate's own refusal, not the audit's.
	const embeddedRefusal = table.telemetry().find((entry) => entry.lane === "delivery" && entry.reason === "narrate_in_apply" && entry.ok === false);
	assert.ok(embeddedRefusal, "the embedded narrate was refused, not delivered");
	assert.equal(embeddedRefusal.code, "needs");
	// The floor's own row: below the floor, on the embedded path, with the draft's own count.
	assert.deepEqual(floorRows(table).map((row) => ({ reason: row.reason, path: row.path, chars: row.chars })),
		[{ reason: "below_floor", path: "embedded", chars: 4 }], "one floor steer, naming the embedded path and the draft's own length");

	// The apply's own tool result: isError, the refusal names below_floor, the landed effect still named in it.
	const applyResult = table.session.messages.find((message) => message.role === "toolResult" && message.toolName === "apply");
	assert.equal(applyResult.isError, true, "the refusal reaches the Keeper as any other narrate refusal would");
	const details = JSON.parse(applyResult.content.map((block) => block.text ?? "").join(""));
	assert.equal(details.narrate_in_apply, false);
	assert.equal(details.coc_error?.details?.reason, "below_floor");
	assert.equal(details.coc_error?.details?.chars, 4);
	assert.ok(Array.isArray(details.effects) || Array.isArray(details.receipts), "the landed effect is still named in the result: it is not undone");

	// This path never reaches `turn_close` the way the implicit close does -- the refused call's own `fix` field
	// carries FLOOR_STEER's text back to the Keeper directly, through Pi's ordinary retry loop, and the one-steer
	// budget (`state.steeredThisTurn`) is spent synchronously by the refusal itself (§135.11.4.1).
	assert.match(details.coc_error?.fix ?? "", /Use the ordinary narrate or mechanics ask delivery path/);
	assert.equal(keeperCalls(table), 2, "one apply.narrate attempt below the floor, one more call that actually closes the turn");
	assert.equal(table.telemetry().filter((entry) => entry.tool === "narrate" && entry.ok === true && entry.event === undefined).length, 1,
		"the second leg's explicit narrate delivered");
	const record = turnRecord(table.workspace, 2);
	assert.equal(record.closed_by, "narrate");
	assert.ok(!record.rendered_text.includes("{{") && !record.rendered_text.includes("}}"), "no brace reached the player");
	assert.ok(record.rendered_text.includes("找到了那篇被压下的旧闻"));
	assert.equal(record.receipts.length, 1, "the clue from the first leg's apply is still the turn's one receipt");
});

test("SL-93: a 40-plus-code-point apply.narrate delivers on its first leg, in one model call", async (t) => {
	const table = await realHybridTable({ responses: [
		fauxAssistantMessage([fauxToolCall("apply", {
			effects: [{ kind: "clue", clue: "globe-unpublished-story", why: "found while going through the clippings" }],
			narrate: "你在剪报室里翻了十分钟，指尖沾了灰，纸页边缘已经发黄发脆，终于找到了那篇被压下的旧闻 {{clue:globe-unpublished-story}}。",
		})], { stopReason: "toolUse" }),
	] });
	t.after(() => table.dispose());
	await table.session.prompt("我翻一翻剪报，看看有没有旧闻。");
	await waitForIdle(table.session);

	assert.equal(floorRows(table).length, 0, "at 44 code points this draft never meets the floor");
	assert.equal(keeperCalls(table), 1, "one model call settled the write and closed the turn");
	assert.equal(table.telemetry().filter((entry) => entry.tool === "narrate" && entry.ok === true && entry.event === undefined).length, 1);
	const record = turnRecord(table.workspace, 2);
	assert.equal(record.closed_by, "narrate");
	assert.ok(record.rendered_text.includes("找到了那篇被压下的旧闻"));
});

// ---------------------------------------------------------------------------------------------------------
// The explicit `narrate` path: fake kernel, hybrid engine (mirrors
// tests/extension/single-loop-turn-close.test.mjs's own seam for the turn-close steer machinery).
// ---------------------------------------------------------------------------------------------------------

/** Every question answered: each need `later`, the exit as given. */
function answered(batch, exit) {
	const answers = {};
	for (const question of batch.questions) {
		const choice = question.key === "exit" ? exit : Object.keys(question.criteria)[0] === "now" ? "later" : "unknown";
		answers[question.key] = { status: "answered", type: "choice", choice, confidence: 0.9, probabilities: { [choice]: 0.9 } };
	}
	return { batchId: batch.id, status: "complete", answers, coverage: { required: Object.keys(answers), answered: Object.keys(answers), unknown: [] }, issues: [] };
}
const finishOnly = (batch) => answered(batch, batch.family === ROUTE_FAMILY ? "finish" : "finish");

async function fakeHybridTable({ responses, env = {}, decide = finishOnly }) {
	const decisions = [], events = [], requests = [];
	const engine = createHybridEngine({ env: process.env, decision: { decide: async (batch, lease) => { decisions.push(batch); return decide(batch, decisions.length, lease); } } });
	const table = await openTable({
		env: { PI_COC_LOOP_ENGINE: "hybrid-v1", FAKE_KERNEL_WORKSPACE: "1", ...env },
		runDriver: engine.runDriver,
		extraExtensions: [{ name: "coc-hybrid-engine", factory: engine.extension }],
		responses: responses.map((response) => (context) => { requests.push(structuredClone(context.messages)); return response; }),
	});
	table.session.subscribe((event) => { if (isRunEvent(event)) events.push(event); });
	return { table, events, requests, decisions, dispose: () => table.dispose() };
}

const kernelCalls = (table, method) => table.kernelRequests().filter((request) => request.method === method);
const runEnd = (events) => events.filter((event) => event.type === "run_end").at(-1);
const toolResults = (session, name) => session.messages.filter((message) => message.role === "toolResult" && message.toolName === name);
const resultText = (message) => (message.content ?? []).filter((block) => block.type === "text").map((block) => block.text).join("");

test("SL-93 (re-scoped): an explicit narrate is not length-floored -- a short line the Keeper chose to write delivers on its first leg", async (t) => {
	// Integration finding: turn.test.mjs's ordinary 13-code-point question ("门厅很安静，你准备怎么做？") went red under the
	// every-path floor. A narrate the Keeper calls itself may be legitimately short; the floor is apply.narrate's alone.
	const table = await fakeHybridTable({
		env: { FAKE_KERNEL_PRESENT: "[]" },
		responses: [fauxAssistantMessage([fauxToolCall("narrate", { text: "门厅很安静，你准备怎么做？" })], { stopReason: "toolUse" })],
	});
	t.after(() => table.dispose());
	await table.table.session.prompt("我看看门厅。");

	assert.equal(table.requests.length, 1, "no floor steer on the explicit path");
	assert.equal(table.table.telemetry().filter((entry) => entry.lane === "floor").length, 0);
	assert.equal(kernelCalls(table.table, "table.narrate").length, 1);
	assert.equal(kernelCalls(table.table, "table.narrate")[0].params.text, "门厅很安静，你准备怎么做？");
	assert.equal(runEnd(table.events).status, "delivered");
});

test("SL-93: once the turn's one steer is spent, the next apply.narrate closes the turn whatever its length -- a turn is never stranded", async (t) => {
	const table = await realHybridTable({ responses: [
		fauxAssistantMessage([fauxToolCall("apply", {
			effects: [{ kind: "clue", clue: "globe-unpublished-story", why: "found while going through the clippings" }],
			narrate: "text",
		})], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("apply", {
			effects: [{ kind: "time", minutes: 10, why: "the search takes ten minutes" }],
			narrate: "still short",
		})], { stopReason: "toolUse" }),
	] });
	t.after(() => table.dispose());
	await table.session.prompt("我翻一翻剪报，看看有没有旧闻。");
	await waitForIdle(table.session);

	assert.equal(keeperCalls(table), 2, "one retry after the floor's refusal, and no more");
	assert.deepEqual(floorRows(table).map((row) => ({ reason: row.reason, path: row.path })), [{ reason: "below_floor", path: "embedded" }],
		"the floor fired once, on the first leg; the second, equally short leg was not refused a second time");
	const record = turnRecord(table.workspace, 2);
	assert.equal(record.closed_by, "narrate");
	assert.ok(record.rendered_text.includes("still short"), "the short second leg closed the turn");
	assert.equal(record.receipts.length, 2, "both legs' effects landed and stand");
});

test("SL-93: a 40-plus-code-point Chinese draft delivers on the explicit path's first leg", async (t) => {
	const long = "门在你身后合上，销栓落下的声响在寂静的走廊里回荡了很久，冷意顺着门缝钻了进来，让你打了个哆嗦。";
	const table = await fakeHybridTable({
		env: { FAKE_KERNEL_PRESENT: "[]" },
		responses: [fauxAssistantMessage([fauxToolCall("narrate", { text: long })], { stopReason: "toolUse" })],
	});
	t.after(() => table.dispose());
	await table.table.session.prompt("我关上门。");

	assert.equal(table.requests.length, 1, "no floor steer at all");
	assert.equal(table.table.telemetry().filter((entry) => entry.lane === "floor").length, 0);
	assert.equal(kernelCalls(table.table, "table.narrate").length, 1);
	assert.equal(runEnd(table.events).status, "delivered");
});

// ---------------------------------------------------------------------------------------------------------
// The data knob: editing content/rulesets/coc7/host-budgets.json's delivery_floor.min_prose_chars changes
// the outcome at the actual use site (extensions/kernel/index.ts), not only in the loader's own return
// value -- proving the threshold is read, never a literal folded into the check.
// ---------------------------------------------------------------------------------------------------------

const realContentRoot = resolve(import.meta.dirname, "../../content");

/**
 * A copy-on-write overlay of the real content/ directory with rulesets/coc7/host-budgets.json's
 * delivery_floor replaced -- everything else a table needs (starters, languages, the rest of coc7's own
 * rules data) is symlinked straight through, untouched.
 */
function contentRootWithFloor(t, minProseChars) {
	const overlay = mkdtempSync(join(tmpdir(), "delivery-floor-content-"));
	for (const entry of readdirSync(realContentRoot)) if (entry !== "rulesets") symlinkSync(join(realContentRoot, entry), join(overlay, entry));
	const rulesetsOverlay = join(overlay, "rulesets");
	mkdirSync(rulesetsOverlay);
	for (const entry of readdirSync(join(realContentRoot, "rulesets"))) if (entry !== "coc7") symlinkSync(join(realContentRoot, "rulesets", entry), join(rulesetsOverlay, entry));
	const coc7Overlay = join(rulesetsOverlay, "coc7");
	mkdirSync(coc7Overlay);
	for (const entry of readdirSync(join(realContentRoot, "rulesets", "coc7"))) if (entry !== "host-budgets.json") symlinkSync(join(realContentRoot, "rulesets", "coc7", entry), join(coc7Overlay, entry));
	const original = JSON.parse(readFileSync(join(realContentRoot, "rulesets", "coc7", "host-budgets.json"), "utf8"));
	writeFileSync(join(coc7Overlay, "host-budgets.json"), JSON.stringify({ ...original, delivery_floor: { min_prose_chars: minProseChars } }));
	t.after(() => rmSync(overlay, { recursive: true, force: true }));
	return overlay;
}

test("SL-93: lowering delivery_floor.min_prose_chars lets an apply.narrate the shipped default would steer deliver on its first leg", async (t) => {
	resetDeliveryFloorBudgetCache();
	t.after(() => resetDeliveryFloorBudgetCache());
	const table = await realHybridTable({ env: { PI_COC_CONTENT_ROOT: contentRootWithFloor(t, 2) }, responses: [
		fauxAssistantMessage([fauxToolCall("apply", {
			effects: [{ kind: "clue", clue: "globe-unpublished-story", why: "found while going through the clippings" }],
			narrate: "text",
		})], { stopReason: "toolUse" }),
	] });
	t.after(() => table.dispose());
	await table.session.prompt("我翻一翻剪报，看看有没有旧闻。");
	await waitForIdle(table.session);

	assert.equal(keeperCalls(table), 1, "at a floor of 2 code points, 'text' (4) clears it -- no steer");
	assert.equal(floorRows(table).length, 0);
	assert.ok(turnRecord(table.workspace, 2).rendered_text.includes("text"));
});

test("SL-93: raising delivery_floor.min_prose_chars steers an apply.narrate the shipped default would deliver", async (t) => {
	resetDeliveryFloorBudgetCache();
	t.after(() => resetDeliveryFloorBudgetCache());
	const ordinary = "你在剪报室里翻了十分钟，指尖沾了灰，纸页边缘已经发黄发脆，终于找到了那篇被压下的旧闻 {{clue:globe-unpublished-story}}。";
	const table = await realHybridTable({ env: { PI_COC_CONTENT_ROOT: contentRootWithFloor(t, 200) }, responses: [
		fauxAssistantMessage([fauxToolCall("apply", {
			effects: [{ kind: "clue", clue: "globe-unpublished-story", why: "found while going through the clippings" }],
			narrate: ordinary,
		})], { stopReason: "toolUse" }),
		// The one steer is already spent by the first leg's refusal; the Keeper's own short narrate closes the turn.
		fauxAssistantMessage([fauxToolCall("narrate", { text: "still short" })], { stopReason: "toolUse" }),
	] });
	t.after(() => table.dispose());
	await table.session.prompt("我翻一翻剪报，看看有没有旧闻。");
	await waitForIdle(table.session);

	assert.equal(keeperCalls(table), 2, "a draft that clears the shipped default is steered once at a floor of 200");
	assert.deepEqual(floorRows(table).map((row) => row.min_chars), [200]);
	const record = turnRecord(table.workspace, 2);
	assert.equal(record.rendered_text, "still short", "the floor never strands a turn");
	assert.equal(record.receipts.length, 1, "the first leg's clue landed and stands");
});
