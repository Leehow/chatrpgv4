/**
 * Contract §128.1: a run the host starts with a message reads the session's own prompt from its
 * first request.
 *
 * 2026-09-22, installed App, `game-21ac44b7`: the setup guide and the table share one session file.
 * The play process opened it with prompts/keeper.md, and the opening -- a `coc-host` message with
 * `triggerTurn` -- went out on the preamble the setup process had recorded. The Keeper introduced
 * Steven Knott under the setup guide's instructions, with no say rule in sight, and the Keeper prompt
 * only arrived on the second request of the run. These tests seed the same persisted checkpoint and
 * read what the provider actually received.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall, getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import { openTable, waitForIdle } from "./harness.mjs";

const SETUP = "SETUP GUIDE PREAMBLE: help the player imagine a person.";
const KEEPER = "KEEPER PREAMBLE: every spoken line goes inside {{say:Name}}...{{/say}}.";

/** A scripted answer that first writes down the prompt its request carried. */
const seeing = (seen, answer) => (context) => {
	seen.push(getCurrentSystemPrompt(context.messages));
	return answer;
};

test("the opening's first request carries the Keeper prompt, not the setup guide's recorded one", async (t) => {
	const seen = [];
	const table = await openTable({
		env: { FAKE_KERNEL_OPENING: "1" },
		systemPrompt: KEEPER,
		priorSystemPrompt: SETUP,
		responses: [
			seeing(seen, fauxAssistantMessage([fauxToolCall("narrate", { text: "诺特抬起头。" })], { stopReason: "toolUse" })),
			seeing(seen, fauxAssistantMessage("诺特抬起头。")),
		],
	});
	t.after(() => table.dispose());
	await waitForIdle(table.session);

	assert.ok(seen.length >= 1, "the opening reached the provider");
	assert.match(seen[0], /KEEPER PREAMBLE/, "the first request of the host-started run is the Keeper's");
	assert.doesNotMatch(seen[0], /SETUP GUIDE PREAMBLE/, "the setup guide's preamble no longer reaches the Keeper");
	for (const prompt of seen) assert.doesNotMatch(prompt, /SETUP GUIDE PREAMBLE/);
	const rows = table.telemetry().filter((row) => row.lane === "prompt");
	assert.equal(rows.length, 1, "one request needed the patch; Pi's own refresh carries the rest");
	assert.equal(rows[0].event, "stale_prompt_replaced");
});

test("a transcript that already records the session's prompt is left as Pi projects it", async (t) => {
	const seen = [];
	const table = await openTable({
		env: { FAKE_KERNEL_OPENING: "1" },
		systemPrompt: KEEPER,
		priorSystemPrompt: KEEPER,
		responses: [
			seeing(seen, fauxAssistantMessage([fauxToolCall("narrate", { text: "诺特抬起头。" })], { stopReason: "toolUse" })),
			seeing(seen, fauxAssistantMessage("诺特抬起头。")),
		],
	});
	t.after(() => table.dispose());
	await waitForIdle(table.session);

	assert.ok(seen.length >= 1);
	assert.match(seen[0], /KEEPER PREAMBLE/);
	assert.deepEqual(table.telemetry().filter((row) => row.lane === "prompt"), [], "nothing stale, nothing patched");
});
