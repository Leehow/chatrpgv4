/**
 * The opening Mod lane (contract §5): a first-contact check is a `resolve` whose `action.decision`
 * names a check an active Mod contributes, and the opening lets it through before the player has
 * spoken. Two things went wrong on a live table (2026-09-14, `game-9aa4e4ee`): the Keeper hung
 * `decision` off the call instead of off `action` -- the schema's home, and the field the lane
 * checks -- and the closed-state refusal then told it to wait for the player instead of saying
 * what was actually missing. These cases travel the product path: the real extension, the fake
 * kernel, a scripted Keeper, and a bridge announced after the session is up, the way the app
 * loads it.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { openTable, waitForIdle } from "./harness.mjs";

function toolResultTexts(session, tool) {
	return session.messages
		.filter((message) => message.role === "toolResult" && message.toolName === tool)
		.map((message) => (message.content ?? []).filter((block) => block.type === "text").map((block) => block.text).join(""));
}

const bridge = { async prepare() {}, async after() {} };

test("a first-contact roll whose decision hangs off the call is hoisted into action and reaches the kernel", async (t) => {
	const table = await openTable({
		env: { FAKE_KERNEL_OPENING: "1" },
		responses: [
			fauxAssistantMessage([
				fauxToolCall("resolve", {
					action: { intent: "social", actor: "Steven Knott", target: "沃尔特·凯恩", goal: "第一次打量这位上门的侦探", method: "照面时的第一印象" },
					decision: "natural-npc:first-impression",
				}),
			], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "诺特打量着你。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("after"),
		],
	});
	t.after(() => table.dispose());
	// The Mods extension announces its bridge during extension loading; here it lands after the
	// session is already up, which is exactly the race the opening lane waits through.
	table.emit("coc:mods-bridge", bridge);
	await waitForIdle(table.session);

	const resolve = table.kernelRequests().find((row) => row.method === "table.resolve");
	assert.ok(resolve, "the opening Mod roll reached the kernel");
	assert.equal(resolve.params.action.decision, "natural-npc:first-impression");
	assert.equal("decision" in resolve.params, false, "the stray top-level key is gone");
	const [text] = toolResultTexts(table.session, "resolve");
	assert.doesNotMatch(text, /nothing may change state/);
	assert.equal(table.telemetry().filter((row) => row.code === "turn_state").length, 0);
});

test("with no bridge announced the opening Mod call waits, then refuses with a retryable reason", async (t) => {
	const table = await openTable({
		env: { FAKE_KERNEL_OPENING: "1", PI_COC_MODS_WAIT_MS: "50" },
		responses: [
			fauxAssistantMessage([
				fauxToolCall("resolve", { action: { intent: "social", goal: "打量", method: "第一印象" }, decision: "natural-npc:first-impression" }),
			], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "诺特打量着你。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("after"),
		],
	});
	t.after(() => table.dispose());
	await waitForIdle(table.session);

	assert.equal(table.kernelRequests().filter((row) => row.method === "table.resolve").length, 0, "no bridge, no roll");
	const [text] = toolResultTexts(table.session, "resolve");
	assert.match(text, /the Mod layer has not announced itself yet/);
	assert.match(text, /retry the same call/);
	assert.doesNotMatch(text, /wait for the player to speak/);
	const row = table.telemetry().find((entry) => entry.cause === "mods_bridge_pending");
	assert.ok(row, "the refusal is marked as bridge-pending, not as a closed turn");
});

test("§23 at the opening: a clock pin passes the host's door with no Mod layer, and its embedded narration follows", async (t) => {
	// A fresh Blood Road table (2026-10-02): the kernel accepts the pin at the opening and the capsule asks for it, but the
	// host's opening door admitted only Mod kinds and refused it twice running before the prose.
	const table = await openTable({
		env: { FAKE_KERNEL_OPENING: "1", PI_COC_MODS_WAIT_MS: "50" },
		responses: [
			fauxAssistantMessage([
				fauxToolCall("apply", { effects: [{ kind: "clock", local_datetime: "1975-07-15T09:00", why: "书只写了七月" }], narrate: "七月的公路上，你握着方向盘。" }),
			], { stopReason: "toolUse" }),
			fauxAssistantMessage("after"),
		],
	});
	t.after(() => table.dispose());
	await waitForIdle(table.session);

	const apply = table.kernelRequests().find((row) => row.method === "table.apply");
	assert.ok(apply, "the pin reached the kernel");
	assert.deepEqual(apply.params.effects.map((effect) => effect.kind), ["clock"]);
	assert.equal(table.telemetry().filter((row) => row.code === "turn_state").length, 0, "no closed-turn refusal");
	assert.equal(table.telemetry().filter((row) => row.cause === "mods_bridge_pending").length, 0, "a clock waits for no Mod layer");
	const [text] = toolResultTexts(table.session, "apply");
	assert.doesNotMatch(text ?? "", /stay as the table opened them, so put whatever/);
});
