/**
 * Contract §162: every Keeper string parameter that carries prose the player reads (narrate.text, apply.narrate,
 * ask.text) ends its schema description with `PLAIN_PROSE`, the sentence the probe measured: on the rebuilt
 * mood-live-20261001 turn-10 request, grok-4.7-build-fast escaped `apply.narrate` 3/5 as recorded and 0/7 with it.
 *
 * What is checked is what the model is handed: the tool declarations of the Keeper's own provider request, through
 * the real registration, on both loop engines.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { openTable, waitForIdle } from "./harness.mjs";
import { createHybridEngine } from "./hybrid-engine-fixture.mjs";
import { COC_TOOLS, PLAIN_PROSE, withPlainProse } from "../../extensions/kernel/tools.ts";

/** The prose parameters §162 names, as tool -> top-level parameter. */
const PROSE_FIELDS = [["narrate", "text"], ["apply", "narrate"], ["ask", "text"]];

/** Every description string anywhere in a schema, with its path. */
function descriptions(schema, path = "") {
	if (!schema || typeof schema !== "object") return [];
	const own = typeof schema.description === "string" ? [[path, schema.description]] : [];
	return [...own, ...Object.entries(schema).flatMap(([key, value]) =>
		key === "description" ? [] : Array.isArray(value) ? value.flatMap((item, index) => descriptions(item, `${path}.${key}[${index}]`))
			: descriptions(value, `${path}.${key}`))];
}

test("§162: the sentence is one line of text that names the escapes, it does not contain them", () => {
	assert.ok(PLAIN_PROSE.includes("\\n"), "a backslash followed by n");
	assert.ok(PLAIN_PROSE.includes("\\u"), "a backslash followed by u");
	assert.equal(PLAIN_PROSE.includes("\n"), false, "no real line break");
	assert.equal(withPlainProse("Fiction only."), `Fiction only. ${PLAIN_PROSE}`);
	assert.equal(withPlainProse("fiction only"), `fiction only. ${PLAIN_PROSE}`);
});

test("§162: the static catalog ends each prose parameter with the sentence, and no other description carries it", () => {
	for (const [tool, field] of PROSE_FIELDS) {
		const parameter = COC_TOOLS.find((spec) => spec.name === tool).parameters.properties[field];
		assert.equal(parameter.type, "string", `${tool}.${field}`);
		assert.ok(parameter.description.endsWith(PLAIN_PROSE), `${tool}.${field}: ${parameter.description.slice(-120)}`);
	}
	const carriers = COC_TOOLS.flatMap((spec) => descriptions(spec.parameters, spec.name).filter(([, text]) => text.includes(PLAIN_PROSE)).map(([path]) => path));
	assert.deepEqual(carriers.sort(), ["apply.properties.narrate", "ask.properties.text", "narrate.properties.text"]);
	for (const spec of COC_TOOLS) assert.equal(spec.description.includes(PLAIN_PROSE), false, `${spec.name}'s own description`);
});

for (const engine of ["legacy", "hybrid-v1"]) {
	test(`§162 on the ${engine} engine: the Keeper's provider request declares each prose parameter with the sentence`, async (t) => {
		const hybrid = engine === "hybrid-v1" ? createHybridEngine({ env: process.env, decision: null }) : undefined;
		const payloads = [];
		const probe = { name: "plain-prose-probe", factory: (pi) => { pi.on("before_provider_request", (event) => { payloads.push(event.payload); }); } };
		const table = await openTable({
			keeperProviderCallbacks: true,
			extraExtensions: [...(hybrid ? [{ name: "coc-hybrid-engine", factory: hybrid.extension }] : []), probe],
			...(hybrid ? { runDriver: hybrid.runDriver, env: { PI_COC_LOOP_ENGINE: "hybrid-v1" } } : {}),
			responses: [
				fauxAssistantMessage([fauxToolCall("narrate", { text: "你推开门，屋里没有人。" })], { stopReason: "toolUse" }),
				fauxAssistantMessage("你推开门，屋里没有人。"),
			],
		});
		t.after(() => table.dispose());
		await table.session.prompt("我推门进去看看。");
		await waitForIdle(table.session);
		assert.ok(payloads.length >= 1, "the Keeper's provider was asked at least once");
		for (const payload of payloads) {
			const declared = new Map((payload.tools ?? []).map((tool) => [tool.name, tool]));
			for (const [tool, field] of PROSE_FIELDS) {
				if (!declared.has(tool)) continue;
				const description = declared.get(tool).parameters.properties[field].description;
				assert.ok(description.endsWith(PLAIN_PROSE), `${engine} ${tool}.${field}: ${description.slice(-120)}`);
			}
			assert.ok(declared.has("narrate") && declared.has("apply"), `${engine}: the request declares narrate and apply`);
			const carriers = [...declared.values()].flatMap((tool) => descriptions(tool.parameters, tool.name)
				.filter(([, text]) => text.includes(PLAIN_PROSE)).map(([path]) => path));
			const expected = PROSE_FIELDS.filter(([tool]) => declared.has(tool)).map(([tool, field]) => `${tool}.properties.${field}`);
			assert.deepEqual(carriers.sort(), expected.sort(), `${engine}: only the prose parameters carry it`);
		}
		const narrates = table.kernelRequests().filter((request) => request.method === "table.narrate");
		assert.equal(narrates.length, 1);
		assert.equal(narrates[0].params.text, "你推开门，屋里没有人。", "the sentence changes nothing a value carries");
	});
}
