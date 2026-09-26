/**
 * Contract §138: a Keeper tool argument that carries the model's own tool-call markup is unwrapped where the model's
 * arguments enter the host, and a parameter the markup swallowed is recovered as its own argument.
 *
 * The shapes are the ones real tables produced (deepseek-v4.1-flash through opencode-go, 2026-09-25/26):
 * - temper-g t6 and coarse-h2 t2: narrate `text` ended with "\n</text>\n", and the player saw `</text>`;
 * - longgate10 t18 and longgate13 t7: `text` went on after `</text>` with `<parameter name="workpad_patch">{…}`,
 *   so the player saw the Keeper's workpad JSON and the patch never reached the workpad.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { openTable, waitFor, waitForIdle } from "./harness.mjs";
import { createHybridEngine } from "../../runtime/jev/hybrid-engine.ts";
import { COC_TOOLS } from "../../extensions/kernel/tools.ts";
import { unwrapArgumentMarkup } from "../../extensions/kernel/tool-argument-markup.ts";

const schema = (name) => COC_TOOLS.find((tool) => tool.name === name).parameters;
const PATCH = { focus: "the letter on the desk", upserts: [{ id: "q1", kind: "open_question", text: "Who else has a key to the desk?", status: "tentative", evidence: ["npc:gardener"] }], removes: [] };
const root = resolve(import.meta.dirname, "../..");

test("§138: the argument's own closing tag is markup, and so is a swallowed parameter; clean text is not touched", () => {
	const trailing = unwrapArgumentMarkup("narrate", schema("narrate"), { text: "{{say:扛包的汉子}}「雨停了我就走。」{{/say}}\n</text>\n" });
	assert.equal(trailing.ok, true);
	assert.deepEqual(trailing.args, { text: "{{say:扛包的汉子}}「雨停了我就走。」{{/say}}" });
	assert.deepEqual(trailing.repairs, [{ field: "text", recovered: [], kept: [] }]);

	const swallowed = unwrapArgumentMarkup("narrate", schema("narrate"),
		{ text: `指节压得发白。</text>\n<parameter name="workpad_patch">${JSON.stringify(PATCH)}`, using_skill: "keeper" });
	assert.deepEqual(swallowed.args, { text: "指节压得发白。", workpad_patch: PATCH, using_skill: "keeper" });
	assert.deepEqual(swallowed.repairs, [{ field: "text", recovered: ["workpad_patch"], kept: [] }]);

	// The same recovery when the swallowed parameter is closed and followed by the dialect's own closers, when the
	// argument never wrote its own closing tag, and in the bare-tag spelling.
	for (const text of [`指节压得发白。</text>\n<parameter name="workpad_patch">${JSON.stringify(PATCH)}</parameter>\n</invoke>`,
		`指节压得发白。\n<parameter name="workpad_patch">${JSON.stringify(PATCH)}</parameter>`,
		`指节压得发白。</text><workpad_patch>${JSON.stringify(PATCH)}</workpad_patch>`]) {
		const result = unwrapArgumentMarkup("narrate", schema("narrate"), { text });
		assert.deepEqual(result.args, { text: "指节压得发白。", workpad_patch: PATCH }, text);
	}
	// A value wrapped whole, in either spelling.
	for (const text of ["<text>你推开门。</text>", '<parameter name="text">你推开门。</parameter>'])
		assert.deepEqual(unwrapArgumentMarkup("narrate", schema("narrate"), { text }).args, { text: "你推开门。" });
	// ask's text is repaired the same way: the rule reads the tool's own parameters, not a list of tools.
	assert.deepEqual(unwrapArgumentMarkup("ask", schema("ask"), { kind: "mechanics", options: ["push", "accept"], text: "门没开。</text>" }).args,
		{ kind: "mechanics", options: ["push", "accept"], text: "门没开。" });

	// A parameter given as its own field wins over a copy swallowed into the text; the copy is reported, not used.
	const kept = unwrapArgumentMarkup("narrate", schema("narrate"), { text: `a</text><workpad_patch>{"focus":"z"}</workpad_patch>`, workpad_patch: PATCH });
	assert.deepEqual(kept.args, { text: "a", workpad_patch: PATCH });
	assert.deepEqual(kept.repairs, [{ field: "text", recovered: [], kept: ["workpad_patch"] }]);

	// Text with no markup of its own tool is the same object, even with other angle brackets in it.
	const clean = { text: "你推开门，屋里没人。<b>门后</b>" };
	const untouched = unwrapArgumentMarkup("narrate", schema("narrate"), clean);
	assert.equal(untouched.args, clean);
	assert.deepEqual(untouched.repairs, []);
});

test("§138: prose after the closing tag is refused with a fix, never dropped", () => {
	const result = unwrapArgumentMarkup("narrate", schema("narrate"), { text: "他站起来。</text>然后他又说了一句。" });
	assert.equal(result.ok, false);
	assert.equal(result.refusal.code, "invalid_params");
	assert.equal(result.refusal.code_detail, "argument_markup");
	assert.deepEqual(result.refusal.details, { field: "text", after: "然后他又说了一句。" });
	assert.match(result.refusal.fix, /^Send text as its plain value only: no <text> or <\/text> tags around it and nothing after it/);
});

for (const engine of ["legacy", "hybrid-v1"]) {
	test(`§138 on the ${engine} engine: a narrate ending in </text> reaches the kernel clean, and the repair is recorded`, async (t) => {
		const hybrid = engine === "hybrid-v1" ? createHybridEngine({ env: process.env, decision: null }) : undefined;
		const table = await openTable({
			...(hybrid ? { runDriver: hybrid.runDriver, extraExtensions: [{ name: "coc-hybrid-engine", factory: hybrid.extension }], env: { PI_COC_LOOP_ENGINE: "hybrid-v1" } } : {}),
			responses: [
				fauxAssistantMessage([fauxToolCall("narrate", { text: "他把碗搁下。「雨停了我就走。」\n</text>\n" })], { stopReason: "toolUse" }),
				fauxAssistantMessage("他把碗搁下。"),
			],
		});
		t.after(() => table.dispose());
		await table.session.prompt("我再问一遍");
		const narrates = table.kernelRequests().filter((request) => request.method === "table.narrate");
		assert.equal(narrates.length, 1);
		assert.equal(narrates[0].params.text, "他把碗搁下。「雨停了我就走。」");
		const rows = table.telemetry().filter((row) => row.lane === "tool_arguments");
		assert.deepEqual(rows.map((row) => [row.event, row.tool, row.repairs]), [["markup_unwrapped", "narrate", [{ field: "text", recovered: [], kept: [] }]]]);
	});
}

test("§138: a workpad patch swallowed into the text is filed as the Keeper's patch, and the player sees neither", async (t) => {
	const evidence = join(root, ".coc/playtests/bounded-context-contracts");
	await mkdir(evidence, { recursive: true });
	const directory = await mkdtemp(join(evidence, "markup-suite-"));
	const leaked = `The letter sits where you left it.</text>\n<parameter name="workpad_patch">${JSON.stringify(PATCH)}`;
	const table = await openTable({
		campaign: "markup-live", realKernel: false, retainAt: directory, env: { FAKE_KERNEL_WORKSPACE: "1" },
		responses: [fauxAssistantMessage([fauxToolCall("narrate", { text: leaked })], { stopReason: "toolUse" })],
	});
	t.after(() => table.dispose());
	await table.session.prompt("I take the letter from the desk.");
	await waitForIdle(table.session, { timeoutMs: 60000 });
	const narrate = table.kernelRequests().filter((request) => request.method === "table.narrate");
	assert.equal(narrate.length, 1);
	assert.equal(narrate[0].params.text, "The letter sits where you left it.");
	assert.equal("workpad_patch" in narrate[0].params, false, "the kernel never sees the patch");
	const store = join(table.workspace, ".coc", "workspace-cache", "workpad");
	await waitFor(() => existsSync(store), { timeoutMs: 10000 });
	const files = readdirSync(store).filter((file) => file.endsWith(".json"));
	assert.equal(files.length, 1);
	const stored = JSON.parse(readFileSync(join(store, files[0]), "utf8"));
	assert.equal(stored.focus, "the letter on the desk");
	assert.deepEqual(stored.entries.map((entry) => entry.id), ["q1"]);
	const visible = table.session.messages.flatMap((message) => typeof message.content === "string" ? [message.content]
		: Array.isArray(message.content) ? message.content.filter((block) => block?.type === "text").map((block) => block.text) : []).join("\n");
	assert.equal(visible.includes("<parameter"), false, "no markup reaches a visible surface");
	assert.equal(visible.includes("Who else has a key"), false, "the patch reaches no visible surface");
	assert.deepEqual(table.extensionErrors, []);
});

test("§138: prose after </text> is refused before the kernel with the fix, and the resent call lands", async (t) => {
	const table = await openTable({
		responses: [
			fauxAssistantMessage([fauxToolCall("narrate", { text: "他站起来。</text>然后他又说了一句。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "他站起来，又说了一句。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("他站起来，又说了一句。"),
		],
	});
	t.after(() => table.dispose());
	await table.session.prompt("我等着");
	const results = table.session.messages.filter((message) => message.role === "toolResult" && message.toolName === "narrate");
	assert.equal(results[0].isError, true);
	const text = results[0].content.map((block) => block.text ?? "").join("");
	assert.match(text, /^invalid_params: narrate: text carries tool-call markup with text after it/);
	assert.match(text, /fix: Send text as its plain value only/);
	const narrates = table.kernelRequests().filter((request) => request.method === "table.narrate");
	assert.deepEqual(narrates.map((request) => request.params.text), ["他站起来，又说了一句。"], "only the resent call reached the kernel");
});
