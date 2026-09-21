import { strict as assert } from "node:assert";
import { test } from "node:test";
import { ContractError } from "../../runtime/jev/contracts.ts";
import { S0_JEV_MODEL, createS0Decider } from "../../runtime/jev/s0-decision.ts";

const secret = "s0-test-secret-must-not-leak";
const criteria = {
	player: "Recent original player statements.",
	keeper: "Recent delivered Keeper statements.",
};
const instructions = "Target: issued transcript candidate set. Select one candidate only.";

function request(signal = new AbortController().signal, state = { playerInput: "What did I say?" }) {
	return { state, criteria, instructions, signal };
}

function payload(choice = "player") {
	return {
		model: S0_JEV_MODEL,
		answers: {
			selection: {
				type: "choice",
				choice,
				confidence: 0.8,
				probabilities: { player: 0.8, keeper: 0.2 },
			},
		},
		usage: { input_tokens: 17, output_tokens: 4 },
	};
}

function response(body, { ok = true, status = 200 } = {}) {
	return {
		ok,
		status,
		json: async () => body,
	};
}

test("S0 choice transport sends only the bounded target/candidate payload with bearer auth and no redirects", async () => {
	const calls = [];
	const decide = createS0Decider(secret, async (url, init) => {
		calls.push({ url, init: structuredClone({ ...init, signal: undefined }) });
		return response(payload());
	});
	const result = await decide(request());
	assert.equal(result.choice, "player");
	assert.deepEqual(result.usage, { inputTokens: 17, outputTokens: 4 });
	assert.equal(result.model, S0_JEV_MODEL);
	assert.ok(Number.isFinite(result.elapsedMs) && result.elapsedMs >= 0);
	assert.equal(calls.length, 1);
	assert.equal(calls[0].url, "https://api.typesafe.ai/v1/systemone");
	assert.equal(calls[0].init.method, "POST");
	assert.equal(calls[0].init.redirect, "error");
	assert.deepEqual(calls[0].init.headers, {
		Authorization: "Bearer " + secret,
		"Content-Type": "application/json",
	});
	const body = JSON.parse(calls[0].init.body);
	assert.deepEqual(body, {
		model: S0_JEV_MODEL,
		state: { playerInput: "What did I say?" },
		questions: {
			selection: {
				type: "choice",
				instructions,
				criteria,
			},
		},
	});
	assert.equal(calls[0].init.body.includes(secret), false);
	assert.equal(JSON.stringify(result).includes(secret), false);
});

test("S0 transport propagates its caller signal before fetch and after a late response", async () => {
	const preAborted = new AbortController();
	preAborted.abort();
	let calls = 0;
	const decide = createS0Decider(secret, async () => {
		calls++;
		return response(payload());
	});
	await assert.rejects(() => decide(request(preAborted.signal)), /aborted/i);
	assert.equal(calls, 0);

	const late = new AbortController();
	let observedSignal;
	const lateDecide = createS0Decider(secret, async (_url, init) => {
		observedSignal = init.signal;
		return {
			ok: true,
			status: 200,
			json: async () => {
				late.abort();
				return payload();
			},
		};
	});
	await assert.rejects(() => lateDecide(request(late.signal)), /aborted/i);
	assert.equal(observedSignal, late.signal);
});

test("S0 rejects unbounded payloads before fetch and never leaks its credential in failures", async () => {
	let calls = 0;
	const decide = createS0Decider(secret, async () => {
		calls++;
		return response(payload());
	});
	await assert.rejects(() => decide(request(new AbortController().signal, { text: "x".repeat(50_000) })), /bounded request size/);
	assert.equal(calls, 0);

	const http = createS0Decider(secret, async () => response({ detail: secret }, { ok: false, status: 503 }));
	await assert.rejects(
		() => http(request()),
		error => error instanceof Error && error.message === "S0 Jev HTTP 503" && !error.message.includes(secret),
	);
	assert.throws(() => createS0Decider(""), /credential is unavailable/);
});

test("S0 rejects model and answer-coverage mismatches without silently reducing provider output", async () => {
	for (const body of [
		{ ...payload(), model: "other-model" },
		{ ...payload(), unexpected_envelope_field: true },
		{ ...payload(), answers: {} },
		{ ...payload(), answers: { selection: payload().answers.selection, extra: { type: "choice", choice: "keeper" } } },
		{ ...payload(), answers: { selection: { type: "choice", choice: "outside", confidence: 0.8 } } },
		{ ...payload(), answers: { selection: { type: "choice", choice: "player", probabilities: { player: 1 } } } },
	]) {
		const decide = createS0Decider(secret, async () => response(body));
		await assert.rejects(() => decide(request()), /S0 Jev (model or answer coverage mismatch|selection is incomplete)/);
	}
});

test("S0 preserves invalid provider usage as a contract failure instead of coercing it", async () => {
	for (const usage of [
		{ input_tokens: -1, output_tokens: 4 },
		{ input_tokens: 1, output_tokens: Number.NaN },
		{ input_tokens: undefined, output_tokens: 4 },
	]) {
		const decide = createS0Decider(secret, async () => response({ ...payload(), usage }));
		await assert.rejects(
			() => decide(request()),
			error => error instanceof ContractError && error.code === "invalid_decision_usage",
		);
	}
});
