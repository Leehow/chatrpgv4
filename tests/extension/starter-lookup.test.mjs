/**
 * A built-in starter has no original document. Real table 2026-09-22 (the-haunting, turn 1): the
 * Keeper passed four clue handles it held from the capsule to `lookup kind=module` and got
 * `not_found`, then asked `lookup kind=source source_mode=answer` and was told to bind the original
 * PDF with `module.source.bind` -- a fix no Keeper can execute and no such PDF exists for.
 *
 * Both go through the real tool entry, the canonical dispatcher, the real module reading service
 * and the real kernel: the seam is the refusal the Keeper actually reads, not a kernel return value.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { openTable, waitForIdle } from "./harness.mjs";

const HANDLES = "knott-macario-summary knott-keys knott-commission knott-research-leads";

function lookupResults(session) {
	return session.messages.filter(message => message.role === "toolResult" && message.toolName === "lookup");
}

test("module lookup resolves the exact handles the Keeper holds, several at once", async t => {
	const table = await openTable({ realKernel: true, campaign: "starter-handles", responses: [
		fauxAssistantMessage([fauxToolCall("narrate", { text: "诺特把钥匙推过桌面，等你开口。" })], { stopReason: "toolUse" }),
		fauxAssistantMessage("开场之后多写的一句，应被替换"),
		fauxAssistantMessage([fauxToolCall("lookup", { kind: "module", query: HANDLES })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("lookup", { kind: "module", query: "knott-keys, knott-commission", expected_kind: "clue" })], { stopReason: "toolUse" }),
		// A handle list with one word that is not a handle is ordinary search text, not a partial list.
		fauxAssistantMessage([fauxToolCall("lookup", { kind: "module", query: "knott-keys house" })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("narrate", { text: "诺特翻开一叠租约。" })], { stopReason: "toolUse" }),
		fauxAssistantMessage("回合之后多写的一句，应被替换"),
	] });
	t.after(() => table.dispose());
	await waitForIdle(table.session, { timeoutMs: 60_000 });
	await table.session.prompt("这房子里出了什么事？以前谁住在那儿？");
	await waitForIdle(table.session, { timeoutMs: 60_000 });

	const [all, pair, mixed] = lookupResults(table.session);
	assert.ok(all && !all.isError, JSON.stringify(all?.content));
	assert.deepEqual(all.details.entities.filter(entity => entity.kind === "clue").map(entity => entity.name),
		["knott-macario-summary", "knott-keys", "knott-commission", "knott-research-leads"],
		"each exact handle resolves, in the order asked");
	assert.ok(all.details.entities.every(entity => entity.summary));
	// `knott-commission` is both a clue and a quest: a shared handle answers with both, as it does alone.
	assert.deepEqual(all.details.entities.filter(entity => entity.kind !== "clue").map(entity => [entity.kind, entity.name]),
		[["quest", "knott-commission"]]);
	assert.equal(all.details.status, undefined);

	assert.deepEqual(pair.details.entities.map(entity => entity.name), ["knott-keys", "knott-commission"],
		"commas separate handles too, and expected_kind still filters");
	assert.equal(mixed.details.status, "not_found", "free text is not split into guessed handles");
});

test("a source lookup on a module without an original document names the road that works", async t => {
	const table = await openTable({ realKernel: true, campaign: "starter-no-source", responses: [
		fauxAssistantMessage([fauxToolCall("narrate", { text: "诺特把钥匙推过桌面，等你开口。" })], { stopReason: "toolUse" }),
		fauxAssistantMessage("开场之后多写的一句，应被替换"),
		fauxAssistantMessage([fauxToolCall("lookup", { kind: "source", source_mode: "answer", query: "Steven Knott commission briefing",
			question: "What does Steven Knott tell the investigators about the commission?" })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("lookup", { kind: "source", query: "Steven Knott", question: "His commission" })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("narrate", { text: "诺特翻开一叠租约。" })], { stopReason: "toolUse" }),
		fauxAssistantMessage("回合之后多写的一句，应被替换"),
	] });
	t.after(() => table.dispose());
	await waitForIdle(table.session, { timeoutMs: 60_000 });
	await table.session.prompt("他委托我做什么？");
	await waitForIdle(table.session, { timeoutMs: 60_000 });

	const results = lookupResults(table.session);
	assert.equal(results.length, 2);
	for (const result of results) {
		const text = (result.content ?? []).filter(block => block.type === "text").map(block => block.text).join("");
		assert.ok(result.isError, text);
		const error = result.details?.coc_error;
		assert.equal(error?.code, "needs", text);
		assert.equal(error?.details?.reason, "no_source_document", `the reason survives projection: ${text}`);
		assert.doesNotMatch(text, /module\.source\.bind|bind the matching original PDF/, "no fix the Keeper cannot execute");
		assert.match(error.fix, /lookup kind=module/, "the fix names the module lookup");
		assert.match(error.fix, /look /, "and look");
	}
});
