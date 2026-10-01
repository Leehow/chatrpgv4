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
import { decodeSerializedStrings, decodedStringLiteral } from "../../extensions/kernel/encoded-string-argument.ts";

const root = resolve(import.meta.dirname, "../..");
const schema = (name) => COC_TOOLS.find((tool) => tool.name === name).parameters;
/** §160.1's entry, as `prepareArguments` calls it for one tool. */
const decode = (tool, args) => decodeSerializedStrings(tool, schema(tool), args);
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
		const result = decode("apply", call.arguments);
		assert.deepEqual(result.decodes, [{ field: "narrate", layers: 1, shapes: ["literal"] }], call.source);
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
	assert.deepEqual(decode("narrate", { text: twice }), { args: { text: prose }, decodes: [{ field: "text", layers: 2, shapes: ["literal", "literal"] }] });
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
		"The path on the note reads C:\\Users\\boston, which means nothing to you yet.",
		"The pattern \\d+ is scrawled under it.",
		"“一九二〇年秋。”他说。",
		"",
	]) {
		const args = { text };
		const result = decode("narrate", args);
		assert.equal(result.args, args, JSON.stringify(text));
		assert.deepEqual(result.decodes, [], JSON.stringify(text));
	}
});

test("§160 known boundary: a whole value that is one quoted line with no escape in it is left as it is", () => {
	for (const text of ["\"Who goes there?\"", "\"一九二〇年秋，波士顿。\"", "\"\""]) {
		const args = { text };
		assert.equal(decodedStringLiteral(text), undefined, text);
		assert.equal(decode("narrate", args).args, args, text);
	}
});

test("§160: every declared string parameter of every tool is read; an undeclared key or a non-string parameter is not", () => {
	const literal = JSON.stringify("门没开。").replace("门", "\\u95e8");
	assert.deepEqual(decode("narrate", { text: literal }).args, { text: "门没开。" });
	assert.deepEqual(decode("ask", { kind: "mechanics", options: ["push", "accept"], text: literal }).args,
		{ kind: "mechanics", options: ["push", "accept"], text: "门没开。" });
	assert.deepEqual(decode("lookup", { kind: "support", query: literal }).decodes, [{ field: "query", layers: 1, shapes: ["literal"] }]);
	// `workpad_patch` is declared, but not as a string; `extra` is not declared at all.
	const untouched = { text: "门没开。", workpad_patch: literal, extra: literal };
	assert.equal(decode("narrate", untouched).args, untouched);
	// Nested strings are not read (the serialization that went wrong is per argument).
	const nested = { effects: [{ kind: "person", who: literal }] };
	assert.equal(decode("apply", nested).args, nested);
	for (const tool of COC_TOOLS) for (const [field, declared] of Object.entries(tool.parameters.properties ?? {})) {
		const read = decodeSerializedStrings(tool.name, tool.parameters, { [field]: literal }).decodes.length === 1;
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
	// Both repairs are recorded. Their rows are written concurrently, so their order in the file says nothing; the order of
	// the repairs is what the kernel received (decoded before unwrapped, it would get the literal).
	assert.deepEqual(table.telemetry().filter((row) => row.lane === "tool_arguments").map((row) => row.event).sort(), ["json_string_decoded", "markup_unwrapped"]);
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

// ---------------------------------------------------------------------------------------------------------
// §160.1: a fragment of the argument's own serialization -- the literal's body without quotes (B), the carried tool's
// arguments object around the literal (C), its tail (D), the literal with the object's closing brace (A′). The eight
// recorded calls are verbatim in fixtures/serialized-arguments-20261001.json.
// ---------------------------------------------------------------------------------------------------------

const SERIALIZED = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "serialized-arguments-20261001.json"), "utf8")).calls;
/** Each shape, completed by hand into the one JSON value it is a fragment of, and read once: the oracle. */
const SPELLED = {
	A: (value) => JSON.parse(value),
	"A'": (value) => JSON.parse(value.trim().replace(/\}+$/, "")),
	B: (value) => JSON.parse(`"${value}"`),
	C: (value) => JSON.parse(value).text,
	D: (value) => JSON.parse(`{"${value}}`).text,
};
const SHAPE = { A: "literal", "A'": "envelope", B: "body", C: "envelope", D: "envelope" };

test("§160.1: each recorded argument decodes to the prose its own shape spells, and the shape is named", () => {
	assert.deepEqual(SERIALIZED.map((call) => call.shape), ["B", "B", "B", "A'", "C", "D", "A", "A", "A'", "A'"]);
	assert.deepEqual(SERIALIZED.filter((call) => call.shape === "A'").map((call) => call.arguments.narrate.trim().match(/\}+$/)[0]), ["}", "}}", "}}"],
		"one brace, and two: the closers of `arguments` and of the {name, arguments} object around it");
	for (const call of SERIALIZED) {
		const value = call.arguments[call.field];
		const where = `${call.shape} ${call.source}`;
		const result = decode(call.tool, call.arguments);
		assert.deepEqual(result.decodes, [{ field: call.field, layers: 1, shapes: [SHAPE[call.shape]] }], where);
		const prose = result.args[call.field];
		assert.equal(prose, SPELLED[call.shape](value), where);
		assert.equal(prose.includes("\\"), false, `${where}: no backslash is left`);
		assert.ok(prose.includes("\n\n"), `${where}: the paragraph breaks are real`);
		// The prose may end on a marker's own `}}`; what must be gone is the literal's closing quote and the brace after it.
		assert.equal(/^\s*(?:["{]|text")|"\}?\s*$/.test(prose), false, `${where}: no quote, brace or key is left at either end`);
		assert.notEqual(result.args, call.arguments, `${where}: the model's own arguments object is not mutated`);
		assert.equal(call.arguments[call.field], value);
	}
});

test("§160.1: the envelope's head names the field's own key or the parameter it carries, with or without the brace and spaces", () => {
	for (const [tool, text] of [
		["narrate", '{"text":"门没开。"}'], ["narrate", '{ "text" : "门没开。" }'], ["narrate", '"text": "门没开。"'], ["narrate", 'text":"门没开。"'],
		["apply", '{"text": "门没开。"}'], ["apply", '{"narrate": "门没开。"}'], ["apply", 'narrate":"门没开。"'],
	]) {
		const field = tool === "apply" ? "narrate" : "text";
		const result = decode(tool, { [field]: text });
		assert.deepEqual(result.args, { [field]: "门没开。" }, `${tool}.${field} ${text}`);
		assert.deepEqual(result.decodes, [{ field, layers: 1, shapes: ["envelope"] }], text);
	}
	// A head on a key the field neither has nor carries is not its envelope.
	for (const [tool, field, text] of [["apply", "narrate", '{"query": "门没开。"}'], ["narrate", "text", '{"narrate": "门没开。"}'], ["narrate", "text", 'query":"门没开。"']]) {
		const args = { [field]: text };
		assert.equal(decode(tool, args).args, args, text);
	}
});

test("§160.1: a closing brace alone needs an escape; a body needs an escape and no raw control character", () => {
	assert.equal(decode("narrate", { text: '"门没开。"}' }).decodes.length, 0, "a quoted line and a brace, no escape");
	assert.equal(decode("narrate", { text: '"门没开。"}}' }).decodes.length, 0, "a quoted line and two braces, no escape");
	assert.deepEqual(decode("narrate", { text: '"门\\n没开。"}' }).args, { text: "门\n没开。" });
	assert.deepEqual(decode("narrate", { text: '"门\\n没开。"} }\n}' }).args, { text: "门\n没开。" }, "a run of closers, spaced as JSON allows");
	assert.deepEqual(decode("apply", { narrate: '{"narrate": "门没开。"}}' }).args, { narrate: "门没开。" }, "a head and two closers");
	assert.deepEqual(decode("narrate", { text: "门开了。\\n\\n他进来。" }), { args: { text: "门开了。\n\n他进来。" }, decodes: [{ field: "text", layers: 1, shapes: ["body"] }] });
	assert.deepEqual(decode("narrate", { text: "门开了。\\\\n" }).decodes, [{ field: "text", layers: 2, shapes: ["body", "body"] }], "a body serialized twice");
	for (const text of ["门开了。\n\n他说\\n是个字母。", "他说\"走\\n吧\"。", "门开了。\\x41", "门开了。\t\\n"]) {
		const args = { text };
		assert.equal(decode("narrate", args).args, args, JSON.stringify(text));
	}
});

test("§160.1 known boundaries: single-line prose meaning a backslash before an escape letter is decoded; an envelope with a second key is not", () => {
	assert.deepEqual(decode("narrate", { text: "The note reads C:\\temp." }).args, { text: "The note reads C:\temp." });
	const two = { narrate: '{"text": "门\\n没开。", "workpad_patch": {"focus": "door"}}' };
	assert.equal(decode("apply", two).args, two);
});

const fullRows = (table) => table.telemetry().filter((row) => row.lane === "tool_arguments" && row.event === "json_string_decoded")
	.map(({ tool, field, layers, shapes }) => ({ tool, field, layers, shapes }));

for (const engine of ["legacy", "hybrid-v1"]) {
	test(`§160.1 on the ${engine} engine: every recorded call reaches the kernel as its prose, with its row`, async (t) => {
		for (const call of SERIALIZED) {
			const hybrid = engine === "hybrid-v1" ? createHybridEngine({ env: process.env, decision: null }) : undefined;
			const table = await openTable({
				...(hybrid ? { runDriver: hybrid.runDriver, extraExtensions: [{ name: "coc-hybrid-engine", factory: hybrid.extension }], env: { PI_COC_LOOP_ENGINE: "hybrid-v1" } } : {}),
				responses: [
					fauxAssistantMessage([fauxToolCall(call.tool, call.arguments)], { stopReason: "toolUse" }),
					fauxAssistantMessage("收尾"),
				],
			});
			try {
				await table.session.prompt("我接着往下问。");
				await waitForIdle(table.session);
				const where = `${call.shape} ${call.source}`;
				const narrates = table.kernelRequests().filter((request) => request.method === "table.narrate");
				assert.equal(narrates.length, 1, where);
				assert.equal(narrates[0].params.text, SPELLED[call.shape](call.arguments[call.field]), where);
				assert.deepEqual(fullRows(table), [{ tool: call.tool, field: call.field, layers: 1, shapes: [SHAPE[call.shape]] }], where);
			} finally {
				await table.dispose();
			}
		}
	});
}

test("§160.1: B's recorded narrate on the emitted kernel and the hybrid engine delivers with real line breaks and no backslash", async (t) => {
	const [call] = SERIALIZED;
	const engine = createHybridEngine({ env: process.env, decision: null });
	const table = await openTable({ realKernel: true, prepareWorkspace: turnOneClosed, env: { PI_COC_LOOP_ENGINE: "hybrid-v1" },
		runDriver: engine.runDriver, extraExtensions: [{ name: "coc-hybrid-engine", factory: engine.extension }],
		responses: [fauxAssistantMessage([fauxToolCall("narrate", call.arguments)], { stopReason: "toolUse" })] });
	t.after(() => table.dispose());
	await table.session.prompt("我问他那栋房子到底出过什么事。");
	await waitForIdle(table.session);

	const record = turnRecord(table.workspace, 2);
	assert.equal(record.closed_by, "narrate");
	assert.ok(record.rendered_text.startsWith("你在窗边那张桌前坐下"), record.rendered_text.slice(0, 40));
	assert.equal(record.rendered_text.includes("\\"), false, "no backslash reached the player");
	assert.ok(record.rendered_text.includes("\n\n"), "the paragraph breaks are real");
	for (const row of record.speech ?? []) assert.equal(leaves(row).some((text) => text.includes("\\")), false, JSON.stringify(row));
	assert.deepEqual(fullRows(table), [{ tool: "narrate", field: "text", layers: 1, shapes: ["body"] }]);
});
