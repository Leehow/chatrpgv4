/**
 * Contract §160: a Keeper tool string argument that arrives as a JSON string literal -- the value serialized a second
 * time inside the call's own JSON arguments -- is decoded where the model's arguments enter the host
 * (`prepareArguments`), after §144's unwrapping and before §144.1's label strip.
 *
 * The recorded calls are verbatim in fixtures/json-string-arguments-20260930.json, both grok-build/grok-4.7-build-fast:
 * the App's opening turn of game-ef4f5f3b (2026-09-30) and turn 5 of the historical-reference-play-c playtest. Each
 * `apply.narrate` was `"\"\\u4e00\\u4e5d…\""`; the player read the quotes and the escapes, and so did the speech rows
 * (`{{say:\u53f2…}}` named nobody at the table).
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
import { decodeStringLiterals, decodedStringLiteral } from "../../extensions/kernel/encoded-string-argument.ts";

const root = resolve(import.meta.dirname, "../..");
const schema = (name) => COC_TOOLS.find((tool) => tool.name === name).parameters;
const FIXTURE = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "json-string-arguments-20260930.json"), "utf8"));
const [OPENING, CLERK] = FIXTURE.calls;
/** What the Keeper meant: the literal, read once as the JSON it is. */
const meant = (call) => JSON.parse(call.arguments.narrate);
const ESCAPE = /\\u[0-9a-fA-F]{4}|\\n/;
/** Every string leaf of a row: an escape left in any of them reached a reader as text. */
const leaves = (value) => typeof value === "string" ? [value] : value && typeof value === "object" ? Object.values(value).flatMap(leaves) : [];
const escaped = (value) => leaves(value).some((text) => ESCAPE.test(text));

// ---------------------------------------------------------------------------------------------------------
// The rule, directly.
// ---------------------------------------------------------------------------------------------------------

test("§160: each recorded apply.narrate decodes to the prose it encodes, once, and nothing else in the call changes", () => {
	assert.equal(FIXTURE.calls.length, 2, "the two values of §160's evidence");
	for (const call of FIXTURE.calls) {
		const raw = call.arguments.narrate;
		assert.ok(raw.startsWith('"') && raw.endsWith('"') && ESCAPE.test(raw), `${call.source}: the value is the literal as recorded`);
		const result = decodeStringLiterals(schema("apply"), call.arguments);
		assert.deepEqual(result.decodes, [{ field: "narrate", layers: 1 }], call.source);
		assert.equal(result.args.narrate, meant(call), call.source);
		assert.equal(ESCAPE.test(result.args.narrate), false, `${call.source}: no escape is left`);
		assert.equal(result.args.effects, call.arguments.effects, `${call.source}: the other arguments are carried as they are`);
		assert.notEqual(result.args, call.arguments, `${call.source}: the model's own arguments object is not mutated`);
		assert.equal(call.arguments.narrate, raw);
	}
	assert.ok(meant(OPENING).startsWith("一九二〇年秋，波士顿。"));
	assert.ok(meant(OPENING).includes("{{say:史蒂文·诺特}}「私家侦探"));
	assert.ok(meant(CLERK).startsWith("你跟门口那人说了声先走"));
});

test("§160: a value serialized more than once is decoded until it is no longer a literal", () => {
	const prose = "门开了。\n\n{{say:史蒂文·诺特}}「进来吧。」{{/say}}";
	const twice = JSON.stringify(JSON.stringify(prose));
	assert.deepEqual(decodeStringLiterals(schema("narrate"), { text: twice }), { args: { text: prose }, decodes: [{ field: "text", layers: 2 }] });
	// ASCII-escaped and not, with whitespace around it.
	const ascii = JSON.stringify(prose).replace(/[^\x00-\x7f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
	assert.equal(decodedStringLiteral(`  ${ascii}\n`), prose);
	assert.equal(decodedStringLiteral(JSON.stringify(prose)), prose, "a raw-CJK literal still has its \\n escapes");
});

test("§160: prose is never read as a literal -- the same object comes back", () => {
	for (const text of [
		"你推开门。",
		"\"Who goes there?\" a voice calls from the dark, and the lamp goes out.",
		"He wrote \"leave\" on the wall. \"Why?\" you ask.",
		"\"\\u4e00\" is the first character on the slip; the rest is torn away.",
		"The path on the note reads C:\\temp\\boston, which means nothing to you yet.",
		"“一九二〇年秋。”他说。",
		"",
	]) {
		const args = { text };
		const result = decodeStringLiterals(schema("narrate"), args);
		assert.equal(result.args, args, JSON.stringify(text));
		assert.deepEqual(result.decodes, [], JSON.stringify(text));
	}
});

test("§160 known boundary: a whole value that is one quoted line with no escape in it is left as it is", () => {
	for (const text of ["\"Who goes there?\"", "\"一九二〇年秋，波士顿。\"", "\"\""]) {
		const args = { text };
		assert.equal(decodedStringLiteral(text), undefined, text);
		assert.equal(decodeStringLiterals(schema("narrate"), args).args, args, text);
	}
});

test("§160: every declared string parameter of every tool is read; an undeclared key or a non-string parameter is not", () => {
	const literal = JSON.stringify("门没开。").replace("门", "\\u95e8");
	assert.deepEqual(decodeStringLiterals(schema("narrate"), { text: literal }).args, { text: "门没开。" });
	assert.deepEqual(decodeStringLiterals(schema("ask"), { kind: "mechanics", options: ["push", "accept"], text: literal }).args,
		{ kind: "mechanics", options: ["push", "accept"], text: "门没开。" });
	assert.deepEqual(decodeStringLiterals(schema("lookup"), { kind: "support", query: literal }).decodes, [{ field: "query", layers: 1 }]);
	// `workpad_patch` is declared, but not as a string; `extra` is not declared at all.
	const untouched = { text: "门没开。", workpad_patch: literal, extra: literal };
	assert.equal(decodeStringLiterals(schema("narrate"), untouched).args, untouched);
	// Nested strings are not read (the serialization that went wrong is per argument).
	const nested = { effects: [{ kind: "person", who: literal }] };
	assert.equal(decodeStringLiterals(schema("apply"), nested).args, nested);
	for (const tool of COC_TOOLS) for (const [field, declared] of Object.entries(tool.parameters.properties ?? {})) {
		const read = decodeStringLiterals(tool.parameters, { [field]: literal }).decodes.length === 1;
		assert.equal(read, declared.type === "string", `${tool.name}.${field}`);
	}
});

// ---------------------------------------------------------------------------------------------------------
// Through the real registration: the Keeper tools' `prepareArguments`, on both loop engines (the seam §144 uses).
// ---------------------------------------------------------------------------------------------------------

const decodeRows = (table) => table.telemetry().filter((row) => row.lane === "tool_arguments" && row.event === "json_string_decoded")
	.map(({ tool, field, layers }) => ({ tool, field, layers }));

for (const engine of ["legacy", "hybrid-v1"]) {
	test(`§160 on the ${engine} engine: a narrate whose text is a literal reaches the kernel as the prose, and the decode is recorded`, async (t) => {
		const hybrid = engine === "hybrid-v1" ? createHybridEngine({ env: process.env, decision: null }) : undefined;
		const table = await openTable({
			...(hybrid ? { runDriver: hybrid.runDriver, extraExtensions: [{ name: "coc-hybrid-engine", factory: hybrid.extension }], env: { PI_COC_LOOP_ENGINE: "hybrid-v1" } } : {}),
			responses: [
				fauxAssistantMessage([fauxToolCall("narrate", { text: CLERK.arguments.narrate })], { stopReason: "toolUse" }),
				fauxAssistantMessage("收尾"),
			],
		});
		t.after(() => table.dispose());
		await table.session.prompt("我先告辞，去市里的档案厅。");
		const narrates = table.kernelRequests().filter((request) => request.method === "table.narrate");
		assert.equal(narrates.length, 1);
		assert.equal(narrates[0].params.text, meant(CLERK));
		assert.deepEqual(decodeRows(table), [{ tool: "narrate", field: "text", layers: 1 }]);
	});
}

test("§160 runs after §144: a literal closed by the dialect's own tag is unwrapped first, then decoded", async (t) => {
	const table = await openTable({
		responses: [
			fauxAssistantMessage([fauxToolCall("narrate", { text: `${CLERK.arguments.narrate}\n</text>\n` })], { stopReason: "toolUse" }),
			fauxAssistantMessage("收尾"),
		],
	});
	t.after(() => table.dispose());
	await table.session.prompt("我先告辞，去市里的档案厅。");
	const narrates = table.kernelRequests().filter((request) => request.method === "table.narrate");
	assert.equal(narrates.length, 1);
	assert.equal(narrates[0].params.text, meant(CLERK));
	assert.deepEqual(table.telemetry().filter((row) => row.lane === "tool_arguments").map((row) => row.event), ["markup_unwrapped", "json_string_decoded"]);
});

// ---------------------------------------------------------------------------------------------------------
// The App's own call, through the real registration, the emitted kernel and the hybrid engine: what the turn record,
// the transcript and the speech rows hold. Turn 1 is closed so the call lands on an ordinary turn (the opening is
// below).
// ---------------------------------------------------------------------------------------------------------

function turnOneClosed(workspace) {
	const input = [["table.open", {}], ["table.player_input", { text: "我去事务所见房东" }],
		["table.narrate", { call_id: "t1-c1", text: "你推开事务所的门，屋里有股烟草味。" }]]
		.map(([method, params], index) => JSON.stringify({ id: String(index), method, params: { campaign: "test-camp", ...params } })).join("\n");
	const run = spawnSync(process.execPath, [join(root, "build/kernel/rpc.mjs"), "--workspace", workspace, "--content", join(root, "content")],
		{ cwd: root, input: `${input}\n`, encoding: "utf8" });
	for (const frame of run.stdout.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line)).filter((frame) => !frame.progress))
		if (!frame.ok) throw new Error(`fixture step ${frame.id} failed: ${JSON.stringify(frame.error)}`);
}

const turnRecord = (workspace, turn) => JSON.parse(readFileSync(join(workspace, ".coc/campaigns/test-camp/turns", `${String(turn).padStart(4, "0")}.json`), "utf8"));
const transcript = (workspace) => readFileSync(join(workspace, ".coc/campaigns/test-camp/transcript.jsonl"), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));

/** What a delivered turn must hold when the App's opening call is the delivery. */
function assertDeliveredAsProse(record, label) {
	assert.equal(record.closed_by, "narrate", label);
	assert.ok(record.rendered_text.startsWith("一九二〇年秋，波士顿。"), `${label}: ${record.rendered_text.slice(0, 40)}`);
	assert.ok(record.rendered_text.endsWith("你接不接？」"), `${label}: the whole value was delivered`);
	assert.equal(ESCAPE.test(record.rendered_text), false, `${label}: no escape reached the player`);
	assert.equal(ESCAPE.test(record.marked_text ?? ""), false, `${label}: nor the marked text`);
	assert.ok(record.speech?.length >= 1, `${label}: the say span is a speech row`);
	for (const row of record.speech) {
		assert.equal(escaped(row), false, `${label}: ${JSON.stringify(row)}`);
		assert.ok(row.text.startsWith("「私家侦探"), `${label}: ${row.text}`);
	}
}

test("§160: the App's opening apply, on an ordinary turn, delivers its prose on the first leg -- the record, the transcript and the speech rows hold no escape", async (t) => {
	const engine = createHybridEngine({ env: process.env, decision: null });
	const table = await openTable({ realKernel: true, prepareWorkspace: turnOneClosed, env: { PI_COC_LOOP_ENGINE: "hybrid-v1" },
		runDriver: engine.runDriver, extraExtensions: [{ name: "coc-hybrid-engine", factory: engine.extension }],
		responses: [fauxAssistantMessage([fauxToolCall("apply", OPENING.arguments)], { stopReason: "toolUse" })] });
	t.after(() => table.dispose());
	await table.session.prompt("我说我是私家侦探，按天收钱，问他要我查什么。");
	await waitForIdle(table.session);

	const record = turnRecord(table.workspace, 2);
	assertDeliveredAsProse(record, "turn 2");
	assert.deepEqual(decodeRows(table), [{ tool: "apply", field: "narrate", layers: 1 }]);
	const delivered = transcript(table.workspace).filter((row) => row.turn === 2);
	assert.ok(delivered.length >= 1);
	for (const row of delivered) assert.equal(escaped(row), false, JSON.stringify(row).slice(0, 120));
	const applyResult = table.session.messages.find((message) => message.role === "toolResult" && message.toolName === "apply");
	assert.equal(JSON.parse(applyResult.content.map((block) => block.text ?? "").join("")).narrate_in_apply, true, "delivered on the first leg");
});

test("§160: the App's literal on the opening turn itself -- where the floor does not run -- is delivered as its prose", async (t) => {
	const engine = createHybridEngine({ env: process.env, decision: null });
	const table = await openTable({ realKernel: true, env: { PI_COC_LOOP_ENGINE: "hybrid-v1" },
		runDriver: engine.runDriver, extraExtensions: [{ name: "coc-hybrid-engine", factory: engine.extension }],
		responses: [fauxAssistantMessage([fauxToolCall("narrate", { text: OPENING.arguments.narrate })], { stopReason: "toolUse" })] });
	t.after(() => table.dispose());
	await waitForIdle(table.session);

	const record = turnRecord(table.workspace, 0);
	assertDeliveredAsProse(record, "turn 0");
	assert.deepEqual(decodeRows(table), [{ tool: "narrate", field: "text", layers: 1 }]);
});
