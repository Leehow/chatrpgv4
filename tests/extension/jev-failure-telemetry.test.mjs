/**
 * SL-84 (contract §122 "Jev attempt/batch failure telemetry" addendum; ticket
 * docs/specs/pi-native-single-loop-tickets/84-a-jev-outage-leaves-no-status-code.md).
 *
 * Gate #16 turns 8-14 answered every compile/route/consequence/admission-fast-path call
 * `status: unavailable, reason: jev_service_error` and no row anywhere said which HTTP status (or
 * network/timeout code) it was. `AdapterTrace`'s `attempt`/`failure` events already carried that
 * information; nothing ever recorded it. This file tests the fix at its source: `jevFailureTelemetry`
 * (the trace-to-telemetry translator) and `createDecisionAdapter`'s own `DecisionResult.failure.status`,
 * both exercised through the real adapter with a stub fetcher -- never a re-implementation of the
 * production code under test.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createDecisionAdapter, jevFailureTelemetry } from "../../runtime/jev/decision-adapter.ts";
import { JEV_MODEL } from "../../runtime/jev/question-packing.ts";
import { TaskLease } from "../../runtime/jev/task-context.ts";

const readSet = [{ kind: "world", resource: "campaign-a", revision: "w1" }];
const keeperScope = { owner: "campaign-owner", campaign: "campaign-a", worldline: "main", loop: 0, audience: "keeper" };

function lease(budget = {}) {
	return new TaskLease({
		owner: "decision-test",
		goal: "answer the bounded typed questions",
		scope: keeperScope,
		capabilities: ["decision"],
		readSet,
		budget: {
			deadlineAt: Date.now() + 10_000,
			remainingInputTokens: 1_000_000,
			remainingOutputTokens: 1_000_000,
			remainingCostUsd: 10,
			remainingActions: 10,
			...budget,
		},
	});
}

function batch(overrides = {}) {
	return {
		id: "batch-1",
		model: JEV_MODEL,
		family: "routing",
		familyVersion: "1",
		scope: keeperScope,
		readSet,
		state: { player: "I refuse the errand." },
		questions: [{ key: "route", target: "candidate route", instructions: "Choose the supported route.", type: "choice",
			criteria: { archive: "archive", library: "library" } }],
		...overrides,
	};
}

function answerBody() {
	return { model: JEV_MODEL, answers: { route: { type: "choice", choice: "archive", confidence: 0.9, probabilities: { archive: 0.9, library: 0.1 } } },
		usage: { input_tokens: 40, output_tokens: 5 } };
}

function response(body, status = 200, headers = {}) {
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

function nonOkResponse(status, headers = {}) {
	return { status, ok: false, headers: new Headers(headers), body: { async cancel() {} } };
}

/** Every row `jevFailureTelemetry` wrote, in order. */
function recorder() {
	const rows = [];
	return { rows, record: (row) => rows.push(row) };
}

test("jevFailureTelemetry: a 429 attempt writes attempt_failed with its status and the raw retry-after header", () => {
	const { rows, record } = recorder();
	const trace = jevFailureTelemetry(record);
	trace({ kind: "attempt", batchId: "b", attempt: 1, family: "routing", status: 429, ms: 210, retryAfter: "2" });
	assert.deepEqual(rows, [{ lane: "jev", event: "attempt_failed", family: "routing", status: 429, retry: 0, ms: 210, retry_after: "2" }]);
});

test("jevFailureTelemetry: a 529 attempt writes attempt_failed with status 529 and no retry_after when the header is absent", () => {
	const { rows, record } = recorder();
	const trace = jevFailureTelemetry(record);
	trace({ kind: "attempt", batchId: "b", attempt: 2, family: "routing", status: 529, ms: 305 });
	assert.deepEqual(rows, [{ lane: "jev", event: "attempt_failed", family: "routing", status: 529, retry: 1, ms: 305 }]);
});

test("jevFailureTelemetry: a network error writes attempt_failed with a code, never a status", () => {
	const { rows, record } = recorder();
	const trace = jevFailureTelemetry(record);
	trace({ kind: "attempt", batchId: "b", attempt: 1, family: "routing", code: "network_error", ms: 5 });
	assert.deepEqual(rows, [{ lane: "jev", event: "attempt_failed", family: "routing", code: "network_error", retry: 0, ms: 5 }]);
});

test("jevFailureTelemetry: a timeout writes attempt_failed with code timeout", () => {
	const { rows, record } = recorder();
	const trace = jevFailureTelemetry(record);
	trace({ kind: "attempt", batchId: "b", attempt: 3, family: "routing", code: "timeout", ms: 15_000 });
	assert.deepEqual(rows, [{ lane: "jev", event: "attempt_failed", family: "routing", code: "timeout", retry: 2, ms: 15_000 }]);
});

test("jevFailureTelemetry: a successful attempt (2xx) and a successful batch write nothing", () => {
	const { rows, record } = recorder();
	const trace = jevFailureTelemetry(record);
	trace({ kind: "attempt", batchId: "b", attempt: 1, family: "routing", status: 200, ms: 90 });
	trace({ kind: "packing", batchId: "b", estimate: {}, cache: "disabled" });
	trace({ kind: "usage", batchId: "b", attempts: 1, inputTokens: 40, outputTokens: 5,
		cost: { kind: "listed_price_estimate", usd: 0, inputUsdPerMillion: 0.042, unknownRetryBoundUsd: 0 } });
	assert.deepEqual(rows, [], "no attempt_failed/batch_failed row for a clean round trip");
});

test("jevFailureTelemetry: a batch_failed row names family, code and attempts -- never request/response content", () => {
	const { rows, record } = recorder();
	const trace = jevFailureTelemetry(record);
	trace({ kind: "failure", batchId: "b", attempts: 3, family: "routing", code: "rate_limited", status: 429,
		cost: { kind: "reserved_bound_actual_unknown", usd: 0.01 } });
	assert.deepEqual(rows, [{ lane: "jev", event: "batch_failed", family: "routing", code: "rate_limited", attempts: 3 }]);
});

// ---- end-to-end through the real adapter (contract-required stub fetchers: 429/retry-after, 529, network error, timeout) ----

test("end-to-end: a 429 with retry-after, retried once into success, writes exactly one attempt_failed row and no batch_failed", async () => {
	const { rows, record } = recorder();
	let calls = 0;
	const adapter = createDecisionAdapter({
		apiKey: "secret",
		retryPolicies: { routing: { maxRetries: 1, backoffInitialMs: 0, backoffMaxMs: 0 } },
		fetcher: async () => ++calls === 1 ? nonOkResponse(429, { "retry-after": "1" }) : response(answerBody()),
		sleep: async () => undefined,
		trace: jevFailureTelemetry(record),
	});
	const result = await adapter.decide(batch(), lease());
	assert.equal(result.status, "complete");
	assert.deepEqual(rows.filter((row) => row.event === "attempt_failed"),
		[{ lane: "jev", event: "attempt_failed", family: "routing", status: 429, retry: 0, ms: rows[0].ms, retry_after: "1" }]);
	assert.equal(rows.some((row) => row.event === "batch_failed"), false, "the batch recovered: no batch_failed row");
});

test("end-to-end: a 529 that exhausts retries writes an attempt_failed row per attempt and one batch_failed row", async () => {
	const { rows, record } = recorder();
	const adapter = createDecisionAdapter({
		apiKey: "secret",
		retryPolicies: { routing: { maxRetries: 1, backoffInitialMs: 0, backoffMaxMs: 0 } },
		fetcher: async () => nonOkResponse(529),
		sleep: async () => undefined,
		trace: jevFailureTelemetry(record),
	});
	const result = await adapter.decide(batch(), lease());
	assert.equal(result.failure.code, "rate_limited");
	assert.equal(result.failure.status, 529, "the batch's own DecisionResult also names the last attempt's status");
	const attempts = rows.filter((row) => row.event === "attempt_failed");
	assert.equal(attempts.length, 2, "one row per failed attempt");
	assert.deepEqual(attempts.map((row) => [row.status, row.retry]), [[529, 0], [529, 1]]);
	assert.deepEqual(rows.find((row) => row.event === "batch_failed"),
		{ lane: "jev", event: "batch_failed", family: "routing", code: "rate_limited", attempts: 2 });
});

test("end-to-end: a network error the family policy never allows to retry writes one attempt_failed row with a code, and batch_failed", async () => {
	const { rows, record } = recorder();
	const adapter = createDecisionAdapter({
		apiKey: "secret",
		fetcher: async () => { throw new TypeError("offline"); },
		trace: jevFailureTelemetry(record),
	});
	const result = await adapter.decide(batch(), lease());
	assert.equal(result.failure.code, "service_error");
	assert.equal(result.failure.status, "network_error");
	assert.deepEqual(rows.filter((row) => row.event === "attempt_failed").map((row) => ({ code: row.code, status: row.status })),
		[{ code: "network_error", status: undefined }]);
	assert.deepEqual(rows.find((row) => row.event === "batch_failed"),
		{ lane: "jev", event: "batch_failed", family: "routing", code: "service_error", attempts: 1 });
});

test("end-to-end: an attempt timeout writes one attempt_failed row with code timeout, and batch_failed", async () => {
	const { rows, record } = recorder();
	const adapter = createDecisionAdapter({
		apiKey: "secret",
		retryPolicies: { routing: { maxRetries: 0, backoffInitialMs: 0, backoffMaxMs: 0, attemptTimeoutMs: 10 } },
		fetcher: async (_url, init) => new Promise((_resolve, reject) => {
			init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
		}),
		trace: jevFailureTelemetry(record),
	});
	const result = await adapter.decide(batch(), lease());
	assert.equal(result.failure.code, "timeout");
	assert.equal(result.failure.status, "timeout");
	assert.deepEqual(rows.filter((row) => row.event === "attempt_failed").map((row) => row.code), ["timeout"]);
	assert.deepEqual(rows.find((row) => row.event === "batch_failed"),
		{ lane: "jev", event: "batch_failed", family: "routing", code: "timeout", attempts: 1 });
});

test("end-to-end: a successful batch writes no attempt_failed or batch_failed row, and never leaks request/response content", async () => {
	const { rows, record } = recorder();
	const adapter = createDecisionAdapter({ apiKey: "must-not-enter-telemetry", fetcher: async () => response(answerBody()), trace: jevFailureTelemetry(record) });
	const result = await adapter.decide(batch({ state: { player: "must-not-enter-telemetry either" } }), lease());
	assert.equal(result.status, "complete");
	assert.deepEqual(rows, [], "a clean round trip writes nothing");
});
