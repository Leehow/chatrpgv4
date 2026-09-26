/**
 * A lane names its own reasoning effort (contract §37.11's rule, on the in-process road).
 *
 * `ctx.modelRegistry.complete()` is pi's full `stream()` road: it takes each API's own options and
 * carries no provider-neutral level for us the way the Keeper's `streamSimple()` road does. Naming
 * nothing there is not "think less" on any API — `openai-responses` omits the whole `reasoning`
 * field for a reasoning model whose `thinkingLevelMap.off` is null (`grok-4.6` on both `grok-build`
 * and `xai`), so the provider's own default effort governs, and `anthropic-messages` reads
 * `options.effort ?? "high"`. That is what the 2026-09-15 table paid for: the admission lane put a
 * 120 s cap around rounds whose median on `grok-4.6` was 34–95 s, the cap fired, and the player got
 * a host accounting failure instead of a turn.
 *
 * SL-81 (contract §12.8.1 addendum, 2026-09-26) adds the table's own level as the fallback before
 * the literal default, and teaches `laneReasoningOptions` that `off` is never a literal to send:
 * long gate #13 ran the admission lane at the literal `"low"` on `opencode-go/deepseek-v4.1-flash`
 * for 100 calls while the Keeper on the same table ran `off`, because pi-ai's `deepseek`
 * `thinkingFormat` treats any truthy `reasoningEffort` — `"low"`, even a literal `"off"` — as
 * `thinking: {type: "enabled"}`.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { laneReasoningOptions, laneThinkingLevel, runLane } from "../../extensions/lanes/subsession.ts";

function laneCtx(model, record) {
	return {
		model,
		sessionManager: { getSessionId: () => undefined },
		modelRegistry: {
			complete: async (_model, _context, options) => {
				record(options);
				return { stopReason: "stop", content: [{ type: "text", text: '{"ok":true}' }] };
			},
		},
	};
}

function lane(ctx, extra = {}) {
	return runLane({
		ctx,
		envName: "PI_COC_LANE_BUDGET_TEST_MODEL",
		lane: "admission",
		systemPrompt: "return json",
		input: "the player asked for the keys",
		shape: (parsed) => (parsed && parsed.ok === true ? parsed : undefined),
		...extra,
	});
}

test("每个 API 都按自己的名字收到这个等级，没有名字的 API 不瞎猜", () => {
	// The OpenAI-shaped family, which is every model this product has ever run a lane on.
	for (const api of ["openai-responses", "azure-openai-responses", "openai-codex-responses", "openai-completions"]) {
		assert.deepEqual(laneReasoningOptions({ api }, "low"), { reasoningEffort: "low" }, api);
	}
	// Anthropic's ladder starts at `low`, so `minimal` lands on the nearest name rather than on a
	// value the adapter would pass through to a 400.
	assert.deepEqual(laneReasoningOptions({ api: "anthropic-messages" }, "low"), { effort: "low" });
	assert.deepEqual(laneReasoningOptions({ api: "anthropic-messages" }, "minimal"), { effort: "low" });
	// Google names the same ladder in capitals and stops at HIGH.
	assert.deepEqual(laneReasoningOptions({ api: "google-generative-ai" }, "low"), { thinking: { enabled: true, level: "LOW" } });
	assert.deepEqual(laneReasoningOptions({ api: "google-vertex" }, "max"), { thinking: { enabled: true, level: "HIGH" } });
	// The two APIs whose own option is the neutral level.
	assert.deepEqual(laneReasoningOptions({ api: "pi-messages" }, "medium"), { reasoning: "medium" });
	assert.deepEqual(laneReasoningOptions({ api: "bedrock-converse-stream" }, "low"), { reasoning: "low" });
	// `mistral-conversations` only offers none/high and a custom API has no documented name: an
	// unmapped API keeps today's behaviour instead of being handed a level it would reject.
	assert.deepEqual(laneReasoningOptions({ api: "mistral-conversations" }, "low"), {});
	assert.deepEqual(laneReasoningOptions({ api: "faux-9f2" }, "low"), {});
	assert.deepEqual(laneReasoningOptions({}, "low"), {});
});

test("缺省就是 low，且 low 真的到了 complete() 的选项里", async () => {
	assert.equal(laneThinkingLevel(), "low");
	let seen;
	// The live lane model of 2026-09-15: a reasoning model whose `thinkingLevelMap.off` is null,
	// which is exactly the case where naming nothing sends no reasoning field at all.
	const result = await lane(laneCtx({ provider: "grok-build", id: "grok-4.6", api: "openai-responses" }, (options) => { seen = options; }));
	assert.equal(result.ok, true);
	assert.equal(seen.reasoningEffort, "low", "the lane must not leave the effort to the provider");
});

test("PI_COC_LANE_THINKING 换得动这个等级", async () => {
	const previous = process.env.PI_COC_LANE_THINKING;
	process.env.PI_COC_LANE_THINKING = "medium";
	try {
		assert.equal(laneThinkingLevel(), "medium");
		let seen;
		await lane(laneCtx({ provider: "xai", id: "grok-4.6", api: "openai-responses" }, (options) => { seen = options; }));
		assert.equal(seen.reasoningEffort, "medium");
		// Read per call, not frozen at module load: one process loads this file several times and
		// the operator may change it under a running table.
		process.env.PI_COC_LANE_THINKING = "not-a-level";
		assert.equal(laneThinkingLevel(), "low");
	} finally {
		if (previous === undefined) delete process.env.PI_COC_LANE_THINKING;
		else process.env.PI_COC_LANE_THINKING = previous;
	}
});

test("调用方可以给自己定等级，而且等级不会踩掉回调与请求头", async () => {
	let seen;
	await lane(laneCtx({ provider: "anthropic", id: "claude-opus-4-7", api: "anthropic-messages" }, (options) => { seen = options; }), { thinking: "high" });
	assert.equal(seen.effort, "high");
	// The telemetry pair (contract §12.8.1) still travels with it: the reasoning spread must sit
	// before them, not on top of them.
	assert.equal(typeof seen.onPayload, "function");
	assert.equal(typeof seen.onResponse, "function");
	assert.ok(seen.signal);
});

test("遥测说得出这一轮要的等级，以及这个 API 有没有地方放它", async () => {
	const rows = [];
	const record = (row) => { rows.push(row); };
	await lane(laneCtx({ provider: "grok-build", id: "grok-4.6", api: "openai-responses" }, () => {}), { record });
	const carried = rows.find((row) => row.phase === "start");
	assert.equal(carried.lane_thinking, "low");
	assert.equal(carried.thinking_carried, true);

	rows.length = 0;
	await lane(laneCtx({ provider: "faux", id: "v1", api: "faux-9f2" }, () => {}), { record });
	const dropped = rows.find((row) => row.phase === "start");
	assert.equal(dropped.lane_thinking, "low");
	assert.equal(dropped.thinking_carried, false, "an unmapped API must read as a gap, not as a level that did nothing");
	// SL-81: for any level but `off`, `lane_thinking_effective` is never remapped -- it just repeats
	// what was asked for, exactly as `lane_thinking` does.
	assert.equal(carried.lane_thinking_effective, "low");
	assert.equal(dropped.lane_thinking_effective, "low");
});

test("SL-81: off 从不作为字面值发出去，交给模型自己的映射表决定关闭的形状", () => {
	// A model whose map explicitly supports off (§135.27.1's corrections: `thinkingLevelMap.off` a
	// real value, never null) gets no `reasoningEffort` field at all -- the same "absent" branch
	// pi-ai's own raw builders already consult to produce their disabled shape, for every one of the
	// four APIs that share it.
	for (const api of ["openai-responses", "azure-openai-responses", "openai-codex-responses", "openai-completions"]) {
		assert.deepEqual(laneReasoningOptions({ api, thinkingLevelMap: { off: "off" } }, "off"), {}, api);
	}
	// No `thinkingLevelMap` at all reads as "not marked unsupported" too, matching pi-ai's own
	// `!== null` convention -- most models never mention `off` explicitly.
	assert.deepEqual(laneReasoningOptions({ api: "openai-completions" }, "off"), {});
	// A model whose map says `off: null` (unsupported, e.g. `grok-4.6` pre-correction) keeps the
	// pre-fix, unconditional literal -- the same shape any other level already got, so nothing about
	// its request regresses.
	assert.deepEqual(laneReasoningOptions({ api: "openai-completions", thinkingLevelMap: { off: null } }, "off"), { reasoningEffort: "off" });
	// The other API families never got a literal "off" before either (off was never resolved at
	// all); they now also read it as "nothing to send" rather than guessing a shape untested here.
	assert.deepEqual(laneReasoningOptions({ api: "anthropic-messages" }, "off"), {});
	assert.deepEqual(laneReasoningOptions({ api: "google-generative-ai" }, "off"), {});
	assert.deepEqual(laneReasoningOptions({ api: "bedrock-converse-stream" }, "off"), {});
	assert.deepEqual(laneReasoningOptions({ api: "pi-messages" }, "off"), {});
});

test("SL-81: 车道的默认档位先看桌子的等级，只在桌子也没有时才落到字面 low", () => {
	assert.equal(laneThinkingLevel({ thinkingLevel: "off" }), "off");
	assert.equal(laneThinkingLevel({ thinkingLevel: "medium" }), "medium");
	assert.equal(laneThinkingLevel({}), "low");
	assert.equal(laneThinkingLevel(undefined), "low");
	// An operator's own env override still outranks the table, exactly as it outranks the setting.
	const previous = process.env.PI_COC_LANE_THINKING;
	process.env.PI_COC_LANE_THINKING = "high";
	try {
		assert.equal(laneThinkingLevel({ thinkingLevel: "off" }), "high");
	} finally {
		if (previous === undefined) delete process.env.PI_COC_LANE_THINKING;
		else process.env.PI_COC_LANE_THINKING = previous;
	}
});

test("SL-81: 桌子在 off、没有车道设置：请求里没有字面 off，行里的 lane_thinking_effective 与 lane_thinking 一致", async () => {
	let seen;
	const rows = [];
	const ctx = laneCtx(
		{ provider: "opencode-go", id: "deepseek-v4.1-flash", api: "openai-completions", reasoning: true, thinkingLevelMap: { off: "off" } },
		(options) => { seen = options; },
	);
	ctx.thinkingLevel = "off";
	const result = await lane(ctx, { record: (row) => rows.push(row) });
	assert.equal(result.ok, true, JSON.stringify(result));
	assert.equal("reasoningEffort" in seen, false, "off must never reach the wire as a literal reasoningEffort");
	const start = rows.find((row) => row.phase === "start");
	assert.equal(start.lane_thinking, "off");
	assert.equal(start.lane_thinking_effective, "off");
	assert.equal(start.thinking_carried, false, "no reasoning-shaped field was populated -- the model's own map disables it instead");
});

test("SL-81: 桌子在 off，但模型的映射表不支持 off：保留今天的字面形状，行里报出真正的地板", async () => {
	let seen;
	const rows = [];
	const ctx = laneCtx(
		{ provider: "xai", id: "grok-4.6", api: "openai-responses", reasoning: true, thinkingLevelMap: { off: null } },
		(options) => { seen = options; },
	);
	ctx.thinkingLevel = "off";
	const result = await lane(ctx, { record: (row) => rows.push(row) });
	assert.equal(result.ok, true, JSON.stringify(result));
	assert.equal(seen.reasoningEffort, "off", "a model without off in its map keeps today's literal shape");
	const start = rows.find((row) => row.phase === "start");
	assert.equal(start.lane_thinking, "off");
	assert.equal(start.lane_thinking_effective, "minimal", "clampThinkingLevel's own floor for a model that cannot disable reasoning");
	assert.equal(start.thinking_carried, true, "a field was sent, even though it did not achieve off");
});
