/**
 * Lane `complete()` does not travel the Keeper streamFn, so OpenCode Console Go
 * never saw `x-opencode-session` and admission refused every apply (pi-host-contract
 * OpenCode session headers, 2026-09-14). These cases check the header helper and
 * that `runLane` actually hands the pair to `complete()`.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { openCodeSessionHeaders, runLane } from "../../extensions/lanes/subsession.ts";

test("OpenCode providers get the same two session headers the Keeper streamFn sends", () => {
	assert.deepEqual(
		openCodeSessionHeaders({ provider: "opencode-go", id: "deepseek-v4.1-flash" }, "coc-game-1"),
		{ "x-opencode-session": "coc-game-1", "x-opencode-client": "pi" },
	);
	assert.deepEqual(
		openCodeSessionHeaders({ provider: "opencode", id: "kimi-k2" }, "sess"),
		{ "x-opencode-session": "sess", "x-opencode-client": "pi" },
	);
	assert.deepEqual(
		openCodeSessionHeaders(
			{ provider: "openai", id: "proxy", baseUrl: "https://opencode.ai/zen/v1" },
			"sess",
		),
		{ "x-opencode-session": "sess", "x-opencode-client": "pi" },
	);
});

test("a table model that is not OpenCode gets no extra headers", () => {
	assert.equal(openCodeSessionHeaders({ provider: "grok-build", id: "grok-4.6" }, "coc-game-1"), undefined);
	assert.equal(openCodeSessionHeaders({ provider: "opencode-go", id: "deepseek-v4.1-flash" }, undefined), undefined);
	assert.equal(openCodeSessionHeaders({ provider: "opencode-go", id: "deepseek-v4.1-flash" }, ""), undefined);
});

test("runLane passes those headers on complete() for an OpenCode lane model", async () => {
	let seen;
	const ctx = {
		model: { provider: "opencode-go", id: "deepseek-v4.1-flash" },
		sessionManager: { getSessionId: () => "coc-game-3782" },
		modelRegistry: {
			complete: async (_model, _context, options) => {
				seen = options;
				return { stopReason: "stop", content: [{ type: "text", text: '{"ok":true}' }] };
			},
		},
	};
	const result = await runLane({
		ctx,
		envName: "PI_COC_LANE_HEADER_TEST_MODEL",
		lane: "admission",
		systemPrompt: "return json",
		input: "player went to the house",
		shape: (parsed) => (parsed && parsed.ok === true ? parsed : undefined),
	});
	assert.equal(result.ok, true);
	assert.deepEqual(seen.headers, {
		"x-opencode-session": "coc-game-3782",
		"x-opencode-client": "pi",
	});
});

test("runLane does not invent OpenCode headers for another provider", async () => {
	let seen;
	const ctx = {
		model: { provider: "grok-build", id: "grok-4.6" },
		sessionManager: { getSessionId: () => "coc-game-3782" },
		modelRegistry: {
			complete: async (_model, _context, options) => {
				seen = options;
				return { stopReason: "stop", content: [{ type: "text", text: '{"ok":true}' }] };
			},
		},
	};
	const result = await runLane({
		ctx,
		envName: "PI_COC_LANE_HEADER_TEST_MODEL",
		lane: "admission",
		systemPrompt: "return json",
		input: "player went to the house",
		shape: (parsed) => (parsed && parsed.ok === true ? parsed : undefined),
	});
	assert.equal(result.ok, true);
	assert.equal(seen.headers, undefined);
});
