/**
 * Contract §143.11 (docs/specs/npc-acts-first-tickets/12-refused-implicit-draft-after-steer.md) through the product path:
 * the real kernel extension's implicit close against the emitted kernel, on the legacy engine and on the hybrid engine's
 * driven run (where the `turn_close` row is written). A turn has one steer (§135.11). Once it is spent, a kernel refusal
 * of an implicit draft could never be handed back as a repair, and the draft was lost:
 *
 * - `intent_result_owed` (§142.7), which the kernel lets through on the same turn's next delivery of the same draft, is
 *   re-sent once (`intent_result_owed_resent`) and delivered with its `warnings` row, as §143.10 already did for markup;
 * - a draft the kernel refused for it while the steer was still unspent is held, so a repair leg that brings nothing, or
 *   one the kernel refuses, falls back to it;
 * - `repeated_line` (§113 D) is refused every time, so it is never re-sent: the steered leg it refuses falls back to the
 *   dropped first draft (the §135.11 gate #4 addendum's shape), and a repair the spent steer cannot carry is named on the
 *   `turn_close` row with the kernel's reason.
 *
 * Found by ticket 11's worker (2026-09-26). The markup cases are `tests/extension/markup-in-prose.test.mjs`, unchanged.
 * Assertions read telemetry rows, the kernel's turn record and the session's messages -- never the prose's words.
 */
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { customMessages, openTable, waitFor, waitForIdle } from "./harness.mjs";
import { createHybridEngine } from "../../runtime/jev/hybrid-engine.ts";
import { isRunEvent } from "./pi-agent-core.mjs";

const root = resolve(import.meta.dirname, "../..");
const KNOTT = "Steven Knott";
/** Knott's opening line: at least twelve spoken characters, so a later verbatim repeat is §113 D's. */
const LINE = "「这房子的事，你得先去报社和档案厅查清楚，别在我这儿耗着。」";
const SHOUT = "Shout for help down the stairs and have the visitor thrown out.";

/** Steps through the emitted kernel's own RPC, in the workspace the table then opens (never by writing its files). */
function kernelSteps(workspace, steps) {
	const input = steps.map(([method, params], index) => JSON.stringify({ id: String(index), method, params: { campaign: "test-camp", ...params } })).join("\n");
	const run = spawnSync(process.execPath, [join(root, "build/kernel/rpc.mjs"), "--workspace", workspace, "--content", join(root, "content")],
		{ cwd: root, input: `${input}\n`, encoding: "utf8" });
	for (const frame of run.stdout.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line)).filter((frame) => !frame.progress))
		if (!frame.ok) throw new Error(`fixture step ${frame.id} failed: ${JSON.stringify(frame.error)}`);
}
const opening = ["table.narrate", { call_id: "t0-c1", text: `诺特把钥匙推过来。{{say:${KNOTT}}}${LINE}{{/say}}` }];
/** The opening closed on Knott's line: the player speaks next, at turn 1. */
const opened = (workspace) => kernelSteps(workspace, [["table.open", {}], opening]);
/** The same, and on turn 1 Knott set out to shout for help (§142.1): at turn 2 that intention is owed a result (§142.7). */
const owing = (workspace) => kernelSteps(workspace, [["table.open", {}], opening,
	["table.player_input", { text: "我不坐，站着看他。" }],
	["table.apply", { call_id: "t1-c1", effects: [{ kind: "npc", name: KNOTT, intends: SHOUT, outcome: "attempted", why: "he backs toward the stairwell" }] }],
	["table.narrate", { call_id: "t1-c2", text: "诺特往楼梯口退了半步。" }]]);

const ENGINES = ["legacy", "hybrid"];
async function playTurn(t, engine, prepareWorkspace, responses) {
	const events = [];
	const hybrid = engine === "hybrid" ? createHybridEngine({ env: process.env, decision: null }) : undefined;
	const table = await openTable({ realKernel: true, prepareWorkspace, responses,
		...(hybrid ? { env: { PI_COC_LOOP_ENGINE: "hybrid-v1" }, runDriver: hybrid.runDriver,
			extraExtensions: [{ name: "coc-hybrid-engine", factory: hybrid.extension }] } : {}) });
	t.after(() => table.dispose());
	table.session.subscribe((event) => { if (isRunEvent(event)) events.push(event); });
	await table.session.prompt("我等他开口。");
	await waitForIdle(table.session, { timeoutMs: 60_000 });
	return { table, events };
}

const look = () => fauxAssistantMessage([fauxToolCall("look", {})], { stopReason: "toolUse" });
const nothing = () => fauxAssistantMessage([{ type: "thinking", thinking: "Nothing to add." }], { stopReason: "stop" });
/** A draft that wraps a fresh line of Knott's (so no speech steer), and reports nothing about the shout he set out on. */
const FIRST = `诺特盯着你，手指在桌面上敲了两下。{{say:${KNOTT}}}「我不想再说第二遍了，年轻人，请你现在就离开我的办公室。」{{/say}}`;
const STEERED = `诺特的手还按在桌上，没有再往楼梯口看。{{say:${KNOTT}}}「你还有别的事吗？没有就请回吧，我这儿马上要关门了。」{{/say}}`;
/** The steered leg that wraps Knott's opening line again, word for word: §113 D refuses it every time. */
const REPEAT = `诺特又敲了敲桌面。{{say:${KNOTT}}}${LINE}{{/say}}`;
/** A first draft with Knott present and no say token: the §40 speech steer drops and holds it. */
const BARE = "诺特没有答话，把椅子往后推了推，站到窗边去了。";

const narrateRows = (table) => table.telemetry().filter((row) => row.tool === "narrate" && row.call_id && row.event === undefined);
const drops = (table) => table.telemetry().filter((row) => row.lane === "delivery" && row.ok === false);
const closes = (table) => table.telemetry().filter((row) => row.lane === "turn" && row.event === "turn_close");
const hostSteers = (table, kind) => customMessages(table.session, "coc-host").filter((message) => message.details?.kind === kind);
const unfinished = (table) => customMessages(table.session, "coc-delivery").filter((message) => message.details?.turn_unfinished);
const turnRecord = (table, turn) =>
	JSON.parse(readFileSync(join(table.workspace, `.coc/campaigns/test-camp/turns/${String(turn).padStart(4, "0")}.json`), "utf8"));
const shownText = (table) => (table.session.messages.filter((message) => message.role === "assistant").at(-1)?.content ?? [])
	.filter((block) => block.type === "text").map((block) => block.text).join("");
const ledgerRef = (table) => Object.values(JSON.parse(readFileSync(join(table.workspace, ".coc/campaigns/test-camp/npc-ledger.json"), "utf8")))
	.flatMap((entry) => entry.intents ?? []).find((row) => row.text === SHOUT)?.ref;

/**
 * The turn was delivered and nothing the Keeper wrote was lost: the record is closed by narrate, the player reads its
 * rendered text, no unfinished notice, and on the driven run the last `turn_close` is `delivered` on the named call with
 * no repair left unsent on any row.
 */
function assertDelivered({ table, events }, engine, turn, callId) {
	const record = turnRecord(table, turn);
	assert.equal(record.closed_by, "narrate");
	assert.equal(record.closed_how, "implicit");
	assert.equal(shownText(table), record.rendered_text, "the player reads the delivered turn");
	assert.equal(unfinished(table).length, 0, "no 'no result' notice over a delivered turn");
	if (engine === "hybrid") {
		const rows = closes(table);
		assert.equal(rows.at(-1)?.status, "delivered", "the run's turn close reports the delivery");
		assert.equal(rows.at(-1).implicit, true);
		assert.equal(rows.at(-1).call_id, callId, "and names the narrate that landed");
		assert.ok(rows.every((row) => row.unsent_fix === undefined), `no repair left unsent: ${JSON.stringify(rows)}`);
		const end = events.filter((event) => event.type === "run_end").at(-1);
		assert.equal(end?.status, "delivered");
		assert.equal(end.reason, "implicit_narrate");
	}
	return record;
}
function assertOwedFinding(table, record) {
	const ref = ledgerRef(table);
	assert.match(ref ?? "", /^intent:steven-knott:[0-9a-f]{12}$/, "Knott's intention is on the ledger");
	const finding = (record.warnings ?? []).filter((row) => row.kind === "intent_result_owed");
	assert.deepEqual(finding.map((row) => [row.lane, row.ref]), [["intents", ref]], "delivered with the owed result as a finding");
}

for (const engine of ENGINES) {
	test(`${engine}: with the turn's one steer spent, an implicit draft refused intent_result_owed is sent again once and delivered with its finding`, async (t) => {
		const played = await playTurn(t, engine, owing, [
			// A read, then nothing to deliver: the turn-close steer ("this turn is not closed yet") is spent on this.
			look(), nothing(),
			// The steered leg reports no result for the shout; its repair could never reach the Keeper now.
			fauxAssistantMessage(STEERED),
		]);
		const { table } = played;
		assert.equal(hostSteers(table, "steer").length, 1, "the one steer went out");
		const rows = narrateRows(table);
		assert.deepEqual(rows.map((row) => [row.ok, row.reason ?? null, row.implicit ?? false]),
			[[false, "intent_result_owed", true], [true, null, true]], "refused, then the same draft delivered");
		const resent = drops(table).filter((row) => row.reason === "intent_result_owed_resent");
		assert.equal(resent.length, 1, "sent again exactly once");
		assert.equal(resent[0].kernel_reason, "intent_result_owed");
		assert.equal(resent[0].call_id, rows[0].call_id, "the row names the refused call");
		assert.notEqual(rows[1].call_id, rows[0].call_id, "the re-send is a call of its own");
		assert.deepEqual(drops(table).map((row) => row.reason), ["intent_result_owed_resent"], "nothing dropped");
		const record = assertDelivered(played, engine, 2, rows[1].call_id);
		assert.equal(record.text, STEERED, "the steered leg's own words, as the Keeper wrote them");
		assertOwedFinding(table, record);
		if (engine === "hybrid") assert.deepEqual(closes(table).map((row) => [row.status, row.kind ?? null]), [["steer", "steer"], ["delivered", null]]);
	});

	test(`${engine}: a draft refused intent_result_owed before the steer is held, so a repair leg that brings nothing delivers it with its finding`, async (t) => {
		const played = await playTurn(t, engine, owing, [look(), fauxAssistantMessage(FIRST), nothing()]);
		const { table } = played;
		assert.equal(hostSteers(table, "audit-repair").length, 1, "the kernel's repair went out as the one steer");
		const rows = narrateRows(table);
		assert.deepEqual(rows.map((row) => [row.ok, row.reason ?? null]), [[false, "intent_result_owed"], [true, null]],
			"refused, then the held draft delivered");
		assert.deepEqual(drops(table).map((row) => [row.reason, row.kernel_reason]), [["implicit_narrate_refused", "intent_result_owed"]]);
		const record = assertDelivered(played, engine, 2, rows[1].call_id);
		assert.equal(record.text, FIRST, "the Keeper's first draft");
		assertOwedFinding(table, record);
		if (engine === "hybrid") assert.deepEqual(closes(table).map((row) => [row.status, row.kind ?? null]), [["steer", "audit-repair"], ["delivered", null]]);
	});

	test(`${engine}: a repair leg refused repeated_line after the steer falls back to the held draft the kernel refused intent_result_owed`, async (t) => {
		const played = await playTurn(t, engine, owing, [look(), fauxAssistantMessage(FIRST), fauxAssistantMessage(REPEAT)]);
		const { table } = played;
		assert.equal(hostSteers(table, "audit-repair").length, 1);
		const rows = narrateRows(table);
		assert.deepEqual(rows.map((row) => [row.ok, row.reason ?? null]), [[false, "intent_result_owed"], [false, "repeated_line"], [true, null]],
			"the first draft refused, the repair leg refused as a verbatim repeat, then the first draft delivered");
		assert.deepEqual(drops(table).map((row) => [row.reason, row.kernel_reason, row.fallback ?? null]),
			[["implicit_narrate_refused", "intent_result_owed", null], ["steered_leg_refused", "repeated_line", "dropped_draft"]],
			"a verbatim repeat is never sent again; the dropped first draft is");
		const record = assertDelivered(played, engine, 2, rows[2].call_id);
		assert.equal(record.text, FIRST);
		assertOwedFinding(table, record);
	});

	test(`${engine}: a steered leg refused repeated_line falls back to the draft the speech steer dropped`, async (t) => {
		const played = await playTurn(t, engine, opened, [look(), fauxAssistantMessage(BARE), fauxAssistantMessage(REPEAT)]);
		const { table } = played;
		assert.equal(hostSteers(table, "speech").length, 1, "the speech steer was the turn's one steer");
		const rows = narrateRows(table);
		assert.deepEqual(rows.map((row) => [row.ok, row.reason ?? null]), [[false, "repeated_line"], [true, null]]);
		assert.deepEqual(drops(table).map((row) => [row.reason, row.kernel_reason ?? null]), [["speech_steer", null], ["steered_leg_refused", "repeated_line"]]);
		const record = assertDelivered(played, engine, 1, rows[1].call_id);
		assert.equal(record.text, BARE, "the dropped first draft, as written");
	});
}

test("hybrid: a draft refused repeated_line twice cannot be delivered, and the turn close names the unsent repair with the kernel's reason", async (t) => {
	const { table, events } = await playTurn(t, "hybrid", opened, [look(), fauxAssistantMessage(REPEAT), fauxAssistantMessage(REPEAT)]);
	assert.deepEqual(narrateRows(table).map((row) => [row.ok, row.reason ?? null]), [[false, "repeated_line"], [false, "repeated_line"]],
		"a verbatim repeat is refused every time and never re-sent");
	assert.deepEqual(drops(table).map((row) => [row.reason, row.kernel_reason]),
		[["implicit_narrate_refused", "repeated_line"], ["implicit_narrate_refused", "repeated_line"]], "each dropped draft has its row");
	const last = closes(table).at(-1);
	assert.deepEqual([last.status, last.reason, last.unsent_fix, last.kernel_reason], ["none", "steer_spent", "audit-repair", "repeated_line"]);
	assert.equal(events.filter((event) => event.type === "run_end").at(-1)?.status, "undelivered");
	await waitFor(() => unfinished(table).length === 1, { label: "the §38 notice" });
});
