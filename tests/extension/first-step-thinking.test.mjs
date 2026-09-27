/**
 * SL-74 (docs/kernel-rpc.md §38.7.1): with `COC_FIRST_STEP_THINKING=1`, the host's
 * `before_provider_request` hook (extensions/kernel/index.ts, backed by the pure
 * extensions/kernel/first-step-thinking.ts) keeps thinking on for the first provider call of a
 * turn and rewrites it off for every call after that. Two layers of coverage:
 *
 * - Unit tests on `disableStepThinking`/`isFirstStepOfTurn` directly, one per pi-ai `thinkingFormat`
 *   documented on `OpenAICompletionsCompat.thinkingFormat` (@earendil-works/pi-ai's `types.d.ts`).
 * - An extension-level scenario driving a real Pi agent session through two round trips of one
 *   player turn. The main table's `faux` provider (tests/extension/harness.mjs) never calls
 *   `onPayload`, so `before_provider_request` does not fire on its own for it (see
 *   tests/extension/skills.test.mjs's "implicit delivery and request-hook rounds" test for the
 *   same constraint); a `turn_start` listener stands in for pi-ai's adapter and calls
 *   `emitBeforeProviderRequest` directly with the shape pi-ai would have built for an
 *   always-enabled session, so the kernel's real handler runs its real `table.roundTrips` logic
 *   against it.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { openTable } from "./harness.mjs";
import { disableStepThinking, firstStepCallCapMs, firstStepThinkingEnabled, isFirstStepOfTurn } from "../../extensions/kernel/first-step-thinking.ts";

const call = (name, args) => fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" });

test("isFirstStepOfTurn: the first provider call of a turn observes roundTrips === 1, not 0", () => {
	// table.roundTrips resets to 0 on player input, but pi's agent loop (agent-loop.ts,
	// runAgentLoop) emits the turn's first turn_start -- which increments it -- before that
	// first call is ever made. 0 is defensive only: production never reads the hook at 0.
	assert.equal(isFirstStepOfTurn(0), true);
	assert.equal(isFirstStepOfTurn(1), true);
	assert.equal(isFirstStepOfTurn(2), false);
	assert.equal(isFirstStepOfTurn(3), false);
});

test("firstStepThinkingEnabled: only the exact string \"1\" turns it on", () => {
	assert.equal(firstStepThinkingEnabled({ COC_FIRST_STEP_THINKING: "1" }), true);
	assert.equal(firstStepThinkingEnabled({ COC_FIRST_STEP_THINKING: "true" }), false);
	assert.equal(firstStepThinkingEnabled({ COC_FIRST_STEP_THINKING: "0" }), false);
	assert.equal(firstStepThinkingEnabled({}), false);
});

// ---------------------------------------------------------------------------
// SL-82 (contract §135.29 addendum 2): the turn's first Keeper call sizes its own per-call cap.
// ---------------------------------------------------------------------------

test("firstStepCallCapMs: flag off returns the ordinary cap untouched, on any step", () => {
	assert.equal(firstStepCallCapMs(false, 1, 22_500, 60_000), 22_500, "step 1, flag off: ordinary cap");
	assert.equal(firstStepCallCapMs(false, 2, 22_500, 60_000), 22_500, "step 2, flag off: ordinary cap");
});

test("firstStepCallCapMs: flag on, step 1 (or the defensive 0) takes the larger of the ordinary cap and the allowance", () => {
	assert.equal(firstStepCallCapMs(true, 1, 22_500, 60_000), 60_000, "allowance is larger: allowance wins");
	assert.equal(firstStepCallCapMs(true, 0, 22_500, 60_000), 60_000, "roundTrips===0 is still the first step (isFirstStepOfTurn's own boundary)");
	assert.equal(firstStepCallCapMs(true, 1, 90_000, 60_000), 90_000, "ordinary cap already larger than the allowance: ordinary wins, never shrinks it");
});

test("firstStepCallCapMs: flag on, step >= 2 keeps the ordinary cap -- the allowance never reaches a later call", () => {
	assert.equal(firstStepCallCapMs(true, 2, 22_500, 60_000), 22_500, "second call: ordinary cap, not the allowance");
	assert.equal(firstStepCallCapMs(true, 3, 22_500, 60_000), 22_500, "third call: same");
});

test("disableStepThinking: deepseek and zai share the disabled shape thinking:{type:\"disabled\"}", () => {
	const deepseekOn = { model: "opencode-go/deepseek-v4.1-flash", thinking: { type: "enabled" }, reasoning_effort: "high" };
	const out = disableStepThinking(deepseekOn, { off: "off" });
	assert.equal(out.status, "disabled");
	assert.deepEqual(out.payload.thinking, { type: "disabled" });
	assert.equal("reasoning_effort" in out.payload, false);
	assert.equal(out.payload.model, "opencode-go/deepseek-v4.1-flash", "untouched fields survive");

	// zai's enabled shape carries `clear_thinking` too; the disabled mirror is identical either way,
	// and this does not depend on thinkingLevelMap.off at all (probed live, §135.27.1: a real
	// opencode-go/deepseek endpoint accepts `disabled` regardless of what the catalog claims).
	const zaiOn = { thinking: { type: "enabled", clear_thinking: false } };
	const zaiOut = disableStepThinking(zaiOn, { off: null });
	assert.equal(zaiOut.status, "disabled");
	assert.deepEqual(zaiOut.payload.thinking, { type: "disabled" });
});

test("disableStepThinking: string-thinking uses thinkingLevelMap.off, or omits the field when off is null", () => {
	const on = { thinking: "high" };
	const withOff = disableStepThinking(on, { off: "none" });
	assert.equal(withOff.status, "disabled");
	assert.equal(withOff.payload.thinking, "none");

	const nullOff = disableStepThinking(on, { off: null });
	assert.equal(nullOff.status, "disabled");
	assert.equal("thinking" in nullOff.payload, false);

	const noMap = disableStepThinking(on, undefined);
	assert.equal(noMap.status, "disabled");
	assert.equal(noMap.payload.thinking, "none");
});

test("disableStepThinking: qwen-chat-template flips the nested enable_thinking and sets preserve_thinking", () => {
	const on = { chat_template_kwargs: { enable_thinking: true, some_other_kwarg: 1 } };
	const out = disableStepThinking(on, undefined);
	assert.equal(out.status, "disabled");
	assert.deepEqual(out.payload.chat_template_kwargs, { enable_thinking: false, preserve_thinking: true, some_other_kwarg: 1 });
});

test("disableStepThinking: a generic chat-template or baseten payload cannot be inverted", () => {
	const chatTemplate = disableStepThinking({ chat_template_kwargs: { some_provider_specific_key: true } }, undefined);
	assert.equal(chatTemplate.status, "unsupported_format");

	const baseten = disableStepThinking({ chat_template_args: { thinking_enabled: true }, reasoning_effort: "high" }, undefined);
	assert.equal(baseten.status, "unsupported_format");
});

test("disableStepThinking: qwen's top-level enable_thinking boolean", () => {
	const on = { enable_thinking: true, reasoning_effort: "low" };
	const out = disableStepThinking(on, undefined);
	assert.equal(out.status, "disabled");
	assert.equal(out.payload.enable_thinking, false);
	assert.equal("reasoning_effort" in out.payload, false);
});

test("disableStepThinking: together's reasoning:{enabled}", () => {
	const on = { reasoning: { enabled: true }, reasoning_effort: "high" };
	const out = disableStepThinking(on, undefined);
	assert.equal(out.status, "disabled");
	assert.deepEqual(out.payload.reasoning, { enabled: false });
	assert.equal("reasoning_effort" in out.payload, false);
});

test("disableStepThinking: openrouter's reasoning:{effort} uses thinkingLevelMap.off; ant-ling's (no off) omits the field", () => {
	const on = { reasoning: { effort: "high" } };
	// A defined string off can only be openrouter's (ant-ling never reads thinkingLevelMap.off).
	const openrouter = disableStepThinking(on, { off: "none" });
	assert.equal(openrouter.status, "disabled");
	assert.deepEqual(openrouter.payload.reasoning, { effort: "none" });

	// No off value known (ant-ling, or an openrouter model with off: null): the field is omitted,
	// which matches ant-ling's own shape exactly and still turns thinking off for openrouter.
	const antLingLike = disableStepThinking(on, undefined);
	assert.equal(antLingLike.status, "disabled");
	assert.equal("reasoning" in antLingLike.payload, false);

	const openrouterNullOff = disableStepThinking(on, { off: null });
	assert.equal(openrouterNullOff.status, "disabled");
	assert.equal("reasoning" in openrouterNullOff.payload, false);
});

test("disableStepThinking: the openai default reasoning_effort field, with and without a mapped off value", () => {
	const on = { reasoning_effort: "high" };
	const withOff = disableStepThinking(on, { off: "low" });
	assert.equal(withOff.status, "disabled");
	assert.equal(withOff.payload.reasoning_effort, "low");

	const noOff = disableStepThinking(on, undefined);
	assert.equal(noOff.status, "disabled");
	assert.equal("reasoning_effort" in noOff.payload, false);
});

test("disableStepThinking: no known thinking field, or a non-object payload, is unsupported_format and untouched", () => {
	assert.equal(disableStepThinking({ model: "some/model" }, undefined).status, "unsupported_format");
	assert.equal(disableStepThinking(undefined, undefined).status, "unsupported_format");
	assert.equal(disableStepThinking(null, undefined).status, "unsupported_format");
	assert.equal(disableStepThinking("not an object", undefined).status, "unsupported_format");
});

// ---------------------------------------------------------------------------
// Extension-level: a real Pi agent session, two round trips of one player turn.
// ---------------------------------------------------------------------------

/** What pi-ai would have built for this call, had reasoning been requested (the session's own
 * thinking level never changes across a turn -- this experiment works entirely inside the host
 * hook, not by asking pi for a different level per call). */
const enabledDeepseekPayload = () => ({ model: "opencode-go/deepseek-v4.1-flash", thinking: { type: "enabled" } });

test("with the flag: the turn's first call keeps thinking, the second is rewritten disabled, and the telemetry row carries step/first_step_thinking", async (t) => {
	let table;
	const results = [];
	table = await openTable({
		// PI_COC_SPEECH_STEER off: its default-on follow-up steer after a plain-text delivery adds a
		// third round trip (tests/extension/skills.test.mjs's own two-round test turns it off for the
		// same reason), which would land on step 3 and blur the "second call" this test is about.
		env: { COC_FIRST_STEP_THINKING: "1", PI_COC_SPEECH_STEER: "0" },
		extraExtensions: [(pi) => {
			pi.on("turn_start", async () => {
				results.push(await table.session._extensionRunner.emitBeforeProviderRequest(enabledDeepseekPayload()));
			});
		}],
		responses: [call("look", {}), fauxAssistantMessage("The room is still.")],
	});
	t.after(() => table.dispose());

	await table.session.prompt("I inspect the room.");

	assert.equal(results.length, 2, "two provider rounds: the look call, then the implicit delivery");
	assert.equal(results[0].thinking.type, "enabled", "first call of the turn keeps thinking");
	assert.equal(results[1].thinking.type, "disabled", "second call is rewritten off");
	assert.equal("reasoning_effort" in results[1], false);

	const rows = table.entries("coc-telemetry").filter((row) => row.lane === "provider-request");
	assert.equal(rows.length, 2);
	assert.equal(rows[0].step, 1);
	assert.equal(rows[0].first_step_thinking, true);
	assert.equal(rows[1].step, 2);
	assert.equal(rows[1].first_step_thinking, false);
});

test("without the flag: every call keeps thinking, and the row gains neither field", async (t) => {
	let table;
	const results = [];
	table = await openTable({
		env: { PI_COC_SPEECH_STEER: "0" },
		extraExtensions: [(pi) => {
			pi.on("turn_start", async () => {
				results.push(await table.session._extensionRunner.emitBeforeProviderRequest(enabledDeepseekPayload()));
			});
		}],
		responses: [call("look", {}), fauxAssistantMessage("The room is still.")],
	});
	t.after(() => table.dispose());

	await table.session.prompt("I inspect the room.");

	assert.equal(results.length, 2);
	assert.equal(results[0].thinking.type, "enabled");
	assert.equal(results[1].thinking.type, "enabled", "no flag: the second call is untouched too");

	const rows = table.entries("coc-telemetry").filter((row) => row.lane === "provider-request");
	assert.equal(rows.length, 2);
	for (const row of rows) {
		assert.equal("step" in row, false);
		assert.equal("first_step_thinking" in row, false);
	}
});

test("the counter resets on player input: a second player turn's first call keeps thinking again", async (t) => {
	let table;
	const results = [];
	table = await openTable({
		env: { COC_FIRST_STEP_THINKING: "1", PI_COC_SPEECH_STEER: "0" },
		extraExtensions: [(pi) => {
			pi.on("turn_start", async () => {
				results.push(await table.session._extensionRunner.emitBeforeProviderRequest(enabledDeepseekPayload()));
			});
		}],
		responses: [
			call("look", {}), fauxAssistantMessage("The room is still."),
			call("look", {}), fauxAssistantMessage("Nothing new."),
		],
	});
	t.after(() => table.dispose());

	await table.session.prompt("I inspect the room.");
	await table.session.prompt("I look again.");

	assert.equal(results.length, 4);
	assert.equal(results[0].thinking.type, "enabled", "turn 1, call 1");
	assert.equal(results[1].thinking.type, "disabled", "turn 1, call 2");
	assert.equal(results[2].thinking.type, "enabled", "turn 2, call 1: the reset turned thinking back on");
	assert.equal(results[3].thinking.type, "disabled", "turn 2, call 2");

	const rows = table.entries("coc-telemetry").filter((row) => row.lane === "provider-request");
	assert.deepEqual(rows.map((row) => row.step), [1, 2, 1, 2]);
	assert.deepEqual(rows.map((row) => row.first_step_thinking), [true, false, true, false]);
});

test("an unmapped format is left untouched and reported unsupported_format", async (t) => {
	let table;
	const results = [];
	table = await openTable({
		env: { COC_FIRST_STEP_THINKING: "1", PI_COC_SPEECH_STEER: "0" },
		extraExtensions: [(pi) => {
			pi.on("turn_start", async () => {
				// A shape none of the known thinkingFormats write (e.g. the openai-responses API
				// family xai/grok and OpenAI's o-series use, which has no thinkingFormat at all).
				results.push(await table.session._extensionRunner.emitBeforeProviderRequest({ model: "xai/grok-4.6", instructions: "be a keeper" }));
			});
		}],
		responses: [call("look", {}), fauxAssistantMessage("The room is still.")],
	});
	t.after(() => table.dispose());

	await table.session.prompt("I inspect the room.");

	assert.equal(results.length, 2);
	assert.deepEqual(results[1], { model: "xai/grok-4.6", instructions: "be a keeper" }, "unsupported: payload untouched");

	const rows = table.entries("coc-telemetry").filter((row) => row.lane === "provider-request");
	assert.equal(rows[0].first_step_thinking, true);
	assert.equal(rows[1].first_step_thinking, "unsupported_format");
});
