/**
 * A refusal's `fix` may point the Keeper at `details.<key>`; the model sees only the tool result
 * text, so whatever a `fix` names has to be rendered there (contract §8, #66). Real play had
 * `reading_timeout` say "the exact focus and question in details.read; do not invent another
 * question" while the projection dropped `details.read`, and the Keeper could not take the
 * recovery path it was pointed at. The rule is generic: the host reads the key names out of the
 * `fix` text, so a kernel-side `fix` such as `discover one of details.clues_here` is covered too.
 *
 * Both cases travel the product path: the real extension's tool, the real reading service timing
 * out on a foreground wait (the kernel answers `reading` and lets nobody claim the job), and the
 * real kernel refusing an `apply` on the Haunting graph.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { openTable, waitForIdle } from "./harness.mjs";

/** The text of every tool result the model was shown for `tool`, in order. */
function toolResultTexts(session, tool) {
	return session.messages
		.filter((message) => message.role === "toolResult" && message.toolName === tool)
		.map((message) => (message.content ?? []).filter((block) => block.type === "text").map((block) => block.text).join(""));
}

test("a reading timeout shows the Keeper the focus and question its fix tells it to reuse", async (t) => {
	const table = await openTable({
		env: { FAKE_KERNEL_READING: "1", PI_COC_READ_WAIT_MS: "50" },
		responses: [
			fauxAssistantMessage([fauxToolCall("lookup", { kind: "source", query: "the-ruins", question: "What waits at the ruins?" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "The road to the ruins is still being prepared." })], { stopReason: "toolUse" }),
			fauxAssistantMessage("The road to the ruins is still being prepared."),
		],
	});
	t.after(() => table.dispose());
	await table.session.prompt("I walk out toward the ruins.");
	const [text] = toolResultTexts(table.session, "lookup");
	assert.ok(text, "the lookup returned a tool result");
	assert.match(text, /^needs: the source is still being read$/m);
	assert.match(text, /^fix: .*details\.read.*do not invent another question$/m);
	// What the fix names, as one line the Keeper can copy from: purpose, focus and question, verbatim.
	assert.match(text, /^read: \{"purpose":"detail","focus":"the-ruins","question":"What waits at the ruins\?"\}$/m);
	// What the fix does not name stays out of the model's text: the job handle is telemetry's.
	assert.doesNotMatch(text, /read-7/);
});

test("a kernel refusal that points at details.clues_here shows the clues that are here", async (t) => {
	const table = await openTable({
		realKernel: true,
		campaign: "clues-here-seam",
		responses: [
			fauxAssistantMessage([fauxToolCall("narrate", { text: "诺特律师把文件放在桌上，等你开口。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("开场后不应再交付的文字。"),
			// The diaries are in the Corbitt house; the table is still at the commission briefing.
			fauxAssistantMessage([fauxToolCall("apply", { effects: [{ kind: "clue", clue: "clue-corbitt-diaries" }] })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "这里没有什么日记。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("这里没有什么日记。"),
		],
	});
	t.after(() => table.dispose());
	await waitForIdle(table.session, { timeoutMs: 60_000 });
	await table.session.prompt("我翻找科比特的日记。");
	await waitForIdle(table.session, { timeoutMs: 60_000 });
	const [text] = toolResultTexts(table.session, "apply");
	assert.ok(text, "the apply returned a tool result");
	assert.match(text, /^not_here: /m);
	assert.match(text, /^fix: discover one of details\.clues_here, or move first$/m);
	const line = text.split("\n").find((row) => row.startsWith("clues_here: "));
	assert.ok(line, `the clues here reach the model:\n${text}`);
	// Graph handles, as the kernel's own list names them (the `clue-` prefix is the node id's, not the handle's).
	const clues = JSON.parse(line.slice("clues_here: ".length));
	assert.ok(clues.includes("knott-research-leads"), JSON.stringify(clues));
	assert.ok(!clues.includes("corbitt-diaries"));
});
