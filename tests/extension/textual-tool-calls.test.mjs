// A model's tool call written as text runs as the call it is (extensions/kernel/textual-tool-calls.ts). Installed App,
// 2026-10-02: flapcode/gpt-6-luna wrote three `setup` calls into the text channel during character setup; nothing ran,
// the raw lines reached the player, and the card was not made.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { openTable, waitForIdle } from "./harness.mjs";
import { restoreTextualToolCalls, takeTextualCalls } from "../../extensions/kernel/textual-tool-calls.ts";

const SEEN = ' to=functions.setup  code:\n{"step":"note","slot":"built_for","value":"她眼睛尖，什么细节都逃不过她的镜头。","origin":"player"}';
const tools = name => ["setup", "look", "narrate"].includes(name);

test("the App's own leaked line is restored as a setup call, nothing of it left as text", () => {
	const message = { role: "assistant", stopReason: "stop", content: [{ type: "thinking", thinking: "…" }, { type: "text", text: SEEN },
		{ type: "text", text: "她的本事已经记下了。" }] };
	const { message: restored, restored: names } = restoreTextualToolCalls(message, tools);
	assert.deepEqual(names, ["setup"]);
	assert.equal(restored.stopReason, "toolUse");
	assert.deepEqual(restored.content.map(block => block.type), ["thinking", "toolCall", "text"]);
	const call = restored.content[1];
	assert.deepEqual([call.name, call.arguments], ["setup", { step: "note", slot: "built_for", value: "她眼睛尖，什么细节都逃不过她的镜头。", origin: "player" }]);
	assert.match(call.id, /^textcall_[0-9a-f]{24}$/);
	assert.ok(!JSON.stringify(restored.content).includes("to=functions"));
	assert.equal(message.content[1].text, SEEN, "the original message is not mutated by the pure function");
});

test("prose around a call stays; several calls in one block come out in order", () => {
	const { calls, rest } = takeTextualCalls('Noted. to=functions.look code: {"focus":"scene"} then to=functions.narrate:\n{"text":"A {brace} \\"quoted\\"."} Done.', tools);
	assert.deepEqual(calls, [{ name: "look", arguments: { focus: "scene" } }, { name: "narrate", arguments: { text: 'A {brace} "quoted".' } }]);
	assert.equal(rest, "Noted.  then  Done.");
});

test("only a known tool with one parsable object is restored; anything else is left as it was", () => {
	for (const text of ["to=functions.rm_rf code: {\"path\":\"/\"}", "to=functions.setup code: {\"step\":", "to=functions.setup code: [1,2]",
		"to=functions.setup and then some words {\"a\":1}", "plain prose with no header"])
		assert.equal(restoreTextualToolCalls({ role: "assistant", stopReason: "stop", content: [{ type: "text", text }] }, tools), undefined, text);
	assert.equal(restoreTextualToolCalls({ role: "user", content: [{ type: "text", text: SEEN }] }, tools), undefined, "only assistant messages");
});

test("on the real Pi loop a call written as text is executed and the player never reads it", async (t) => {
	const table = await openTable({ responses: [
		fauxAssistantMessage(' to=functions.look  code:\n{}'),
		fauxAssistantMessage("You take in the room."),
	] });
	t.after(() => table.dispose());
	await table.session.prompt("I look around.");
	await waitForIdle(table.session);
	const messages = table.session.messages;
	const first = messages.find(message => message.role === "assistant");
	assert.ok(first.content.some(block => block.type === "toolCall" && block.name === "look"), JSON.stringify(first.content));
	assert.ok(!JSON.stringify(first.content).includes("to=functions"), "the raw line is gone from the stored message");
	assert.ok(messages.some(message => message.role === "toolResult" && message.toolName === "look"), "the call ran and answered");
	assert.ok(table.telemetry().some(row => row.lane === "model-output" && row.event === "textual_tool_calls"
		&& JSON.stringify(row.restored) === JSON.stringify(["look"])), JSON.stringify(table.telemetry().slice(-5)));
});
