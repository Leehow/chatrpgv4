/**
 * Contract §144.1 (SL-96): a field that carries another tool's argument (`apply.narrate`, the narrate tool's `text`)
 * loses the serialization's own leading label where the model's arguments enter the host (`prepareArguments`).
 *
 * The recorded values are verbatim from long gates #22 and #23 (grok-build/grok-4.5 low), in
 * fixtures/dialect-prefix-gates-22-23.json: `text thriftily-placeholder`, `text`, `text<prose>`,
 * `text intermediate<prose>`, `text interim<prose>`, and the name in the play language followed by `|` or `::`.
 * Six reached the player. The label was inside the JSON arguments the provider returned (the model's output, not our
 * stream parsing): see §144.1's evidence.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { openTable, waitForIdle } from "./harness.mjs";
import { createHybridEngine } from "./hybrid-engine-fixture.mjs";
import { COC_TOOLS } from "../../extensions/kernel/tools.ts";
import { EMBEDDED_ARGUMENTS, dialectPrefix, stripDialectPrefixes } from "../../extensions/kernel/dialect-prefix.ts";

const root = resolve(import.meta.dirname, "../..");
const RECORDED = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "dialect-prefix-gates-22-23.json"), "utf8")).values;
const recorded = (gate, turn) => RECORDED.find((row) => row.gate === gate && row.turn === turn);
const EFFECTS = [{ kind: "clue", clue: "globe-unpublished-story", why: "found while going through the clippings" }];

// ---------------------------------------------------------------------------------------------------------
// The rule, directly.
// ---------------------------------------------------------------------------------------------------------

test("§144.1: each recorded value loses exactly its label, and a label-only value becomes empty", () => {
	assert.equal(RECORDED.length, 7, "the seven values of §144.1's evidence table");
	for (const row of RECORDED) {
		const args = { effects: EFFECTS, narrate: row.narrate };
		const result = stripDialectPrefixes("apply", args);
		const where = `${row.gate} t${row.turn}`;
		assert.deepEqual(result.strips, [{ field: "narrate", prefix: row.label }], where);
		assert.equal(result.args.narrate, row.narrate.slice(row.label.length), where);
		assert.equal(result.args.effects, EFFECTS, `${where}: the other arguments are carried as they are`);
		assert.notEqual(result.args, args, `${where}: the model's own arguments object is not mutated`);
		assert.equal(args.narrate, row.narrate);
	}
	assert.equal(stripDialectPrefixes("apply", { narrate: recorded("#22", 1).narrate }).args.narrate, "");
	assert.equal(stripDialectPrefixes("apply", { narrate: recorded("#22", 8).narrate }).args.narrate, "");
	assert.ok(stripDialectPrefixes("apply", { narrate: recorded("#23", 6).narrate }).args.narrate.startsWith("罗克斯伯里疗养院的门厅"));
	assert.ok(stripDialectPrefixes("apply", { narrate: recorded("#22", 5).narrate }).args.narrate.startsWith("{{move:neighborhood-gossip-t5-c1}}新楼"));
	assert.ok(stripDialectPrefixes("apply", { narrate: recorded("#22", 20).narrate }).args.narrate.startsWith("{{time}}午后"));
});

test("§144.1: the label's other shapes -- a delimiter after the name or the tag, a marker token right after it -- and the whitespace after it", () => {
	assert.equal(dialectPrefix("text|门开了。", "text"), "text|");
	assert.equal(dialectPrefix("text final::门开了。", "text"), "text final::");
	assert.equal(dialectPrefix("text{{time}}门开了。", "text"), "text");
	assert.equal(dialectPrefix("text intermediate", "text"), "text intermediate");
	assert.deepEqual(stripDialectPrefixes("apply", { narrate: "text| 门开了。" }).args, { narrate: "门开了。" });
	assert.deepEqual(stripDialectPrefixes("apply", { narrate: "text| 门开了。" }).strips, [{ field: "narrate", prefix: "text| " }]);
});

test("§144.1: prose is never read as a label -- the same object comes back", () => {
	for (const narrate of [
		"Text scrawled on the wall reads: GET OUT WHILE YOU CAN. The letters are still wet.",
		"Text intermediate罗克斯伯里疗养院的门厅闻着石炭酸。",
		"他盯着信纸上那段text看了很久，字迹歪斜，像是在颤抖的手里写成的。",
		"text messages flooded the switchboard all night, and nobody could say who sent them.",
		"textbook margins were crowded with notes in a cramped, sloping hand.",
		"Text: MEET ME AT DAWN. The telegram is unsigned.",
		"罗克斯伯里疗养院的门厅闻着石炭酸与煮过的亚麻布味。",
		"{{say:史蒂文·诺特}}「回来了。」{{/say}}他抬眼看你。",
		"",
	]) {
		const args = { effects: EFFECTS, narrate };
		const result = stripDialectPrefixes("apply", args);
		assert.equal(result.args, args, narrate);
		assert.deepEqual(result.strips, [], narrate);
	}
});

test("§144.1 known boundary: a label followed by whitespace and then the value cannot be told from prose, and is left as it is", () => {
	for (const narrate of ["text intermediate The door swings open onto a dark hall.", "text\n罗克斯伯里疗养院的门厅闻着石炭酸。", "text 罗克斯伯里疗养院的门厅闻着石炭酸。"]) {
		const args = { narrate };
		assert.equal(stripDialectPrefixes("apply", args).args, args, JSON.stringify(narrate));
	}
});

test("§144.1: only a field that carries another tool's argument is read -- narrate.text and ask.text are not", () => {
	const narrate = { text: recorded("#23", 6).narrate };
	assert.equal(stripDialectPrefixes("narrate", narrate).args, narrate);
	const ask = { kind: "mechanics", options: ["push", "accept"], text: recorded("#22", 5).narrate };
	assert.equal(stripDialectPrefixes("ask", ask).args, ask);
	// apply's other string fields are not read either.
	const other = { using_skill: "text intermediate罗克斯伯里", effects: EFFECTS };
	assert.equal(stripDialectPrefixes("apply", other).args, other);
});

test("§144.1: each EMBEDDED_ARGUMENTS entry names a declared string field and the carried tool's declared string parameter", () => {
	const entries = Object.entries(EMBEDDED_ARGUMENTS).flatMap(([tool, fields]) => Object.entries(fields).map(([field, parameter]) => [tool, field, parameter]));
	assert.deepEqual(entries, [["apply", "narrate", "text"]]);
	for (const [tool, field, parameter] of entries) {
		const spec = COC_TOOLS.find((candidate) => candidate.name === tool);
		assert.equal(spec?.parameters.properties[field]?.type, "string", `${tool}.${field} is a declared string field`);
		const carried = COC_TOOLS.find((candidate) => candidate.name === field);
		assert.equal(carried?.parameters.properties[parameter]?.type, "string", `${field}.${parameter} is the carried tool's declared string parameter`);
	}
});

// ---------------------------------------------------------------------------------------------------------
// Through the real registration: the real `apply`/`narrate` tools, the emitted kernel and the hybrid engine
// (the seam tests/extension/apply-narrate-combined.test.mjs and delivery-floor-every-path.test.mjs use).
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
const prefixRows = (table) => table.telemetry().filter((entry) => entry.lane === "arguments" && entry.event === "dialect_prefix_stripped").map(({ event, tool, field, prefix }) => ({ event, tool, field, prefix }));
const floorRows = (table) => table.telemetry().filter((entry) => entry.lane === "floor").map(({ reason, path, chars }) => ({ reason, path, chars }));
const LONG = "你在剪报室里翻了十分钟，指尖沾了灰，纸页边缘已经发黄发脆，终于找到了那篇被压下的旧闻 {{clue:globe-unpublished-story}}。";
const realHybridTable = ({ responses }) => {
	const engine = createHybridEngine({ env: process.env, decision: null });
	return openTable({ realKernel: true, prepareWorkspace: turnOneClosed, env: { PI_COC_LOOP_ENGINE: "hybrid-v1" },
		runDriver: engine.runDriver, extraExtensions: [{ name: "coc-hybrid-engine", factory: engine.extension }], responses });
};

test("§144.1: gate #23 t6's value delivers from its first real sentence, and the strip is recorded", async (t) => {
	const table = await realHybridTable({ responses: [
		fauxAssistantMessage([fauxToolCall("apply", { effects: EFFECTS, narrate: recorded("#23", 6).narrate })], { stopReason: "toolUse" }),
	] });
	t.after(() => table.dispose());
	await table.session.prompt("我翻一翻剪报，看看有没有旧闻。");
	await waitForIdle(table.session);

	assert.deepEqual(prefixRows(table), [{ event: "dialect_prefix_stripped", tool: "apply", field: "narrate", prefix: "text intermediate" }]);
	const record = turnRecord(table.workspace, 2);
	assert.equal(record.closed_by, "narrate");
	assert.ok(record.rendered_text.startsWith("罗克斯伯里疗养院的门厅闻着石炭酸"), record.rendered_text.slice(0, 40));
	assert.ok(record.rendered_text.endsWith("探视时间还剩一些。"), "the whole value was delivered, only the label is gone");
	assert.equal(record.rendered_text.includes("intermediate"), false);
	const applyResult = table.session.messages.find((message) => message.role === "toolResult" && message.toolName === "apply");
	assert.equal(JSON.parse(applyResult.content.map((block) => block.text ?? "").join("")).narrate_in_apply, true, "delivered on the first leg");
});

for (const label of ["text", "text thriftily-placeholder"]) {
		test(`§144.1: empty optional embedded narration is omitted while the admitted effects land (${JSON.stringify(label)})`, async (t) => {
		const table = await realHybridTable({ responses: [
			fauxAssistantMessage([fauxToolCall("apply", { effects: EFFECTS, narrate: label })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: LONG })], { stopReason: "toolUse" }),
		] });
		t.after(() => table.dispose());
		await table.session.prompt("我翻一翻剪报，看看有没有旧闻。");
		await waitForIdle(table.session);

		assert.deepEqual(prefixRows(table), [{ event: "dialect_prefix_stripped", tool: "apply", field: "narrate", prefix: label }]);
		assert.deepEqual(floorRows(table), [], "an empty transport argument is not a prose quality review");
		assert.equal(table.telemetry().filter((entry) => entry.tool === "apply" && entry.ok === true).length, 1, "the effect landed");
		const applyResult = table.session.messages.find((message) => message.role === "toolResult" && message.toolName === "apply");
		assert.equal(applyResult.isError, false);
		assert.equal(JSON.parse(applyResult.content.map((block) => block.text ?? "").join("")).coc_error, undefined);
		assert.ok(table.telemetry().some(entry=>entry.event==='empty_embedded_omitted'));
		const record = turnRecord(table.workspace, 2);
		assert.equal(record.closed_by, "narrate");
		assert.equal(/text|thriftily/.test(record.rendered_text), false, record.rendered_text);
		assert.ok(record.rendered_text.includes("找到了那篇被压下的旧闻"), "the second leg's narrate is what the player read");
	});
}



test("§144.1: an English narration that begins with the word 'Text' is delivered as written, with no row", async (t) => {
	const english = "Text scrawled on the clipping's margin reads: ASK THE LANDLORD ABOUT 1880. You find the buried story at last.";
	const table = await realHybridTable({ responses: [
		fauxAssistantMessage([fauxToolCall("apply", { effects: EFFECTS, narrate: english })], { stopReason: "toolUse" }),
	] });
	t.after(() => table.dispose());
	await table.session.prompt("我翻一翻剪报，看看有没有旧闻。");
	await waitForIdle(table.session);

	assert.deepEqual(prefixRows(table), []);
	const record = turnRecord(table.workspace, 2);
	assert.equal(record.closed_by, "narrate");
	assert.equal(record.rendered_text, english);
});
