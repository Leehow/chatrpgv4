/**
 * Contract §135.29's SL-69 addendum: a Keeper provider call is abandoned once it runs past its own
 * per-call cap, independent of the idle-progress watchdog §135.29 already covers. A stall before the
 * attempt's first event ("first_byte") and a stall mid-stream ("streaming") are both cut; the first
 * overrun of a step is worded so pi-ai's own retry patterns resend it once, under the same context; a
 * second overrun of the *same* step is worded so nothing retries it, ending the step through the
 * session's existing no-delivered-evidence fallback. A fast call, well inside the cap, is untouched.
 *
 * `watchCallCap` is exercised directly here, against a fake `start` function this file fully controls
 * (a hand-built `AssistantMessageEventStream`, never a real socket): the same "fake provider" shape the
 * ticket asks for, without fighting a real transport's own timing. `tests/extension/
 * provider-stream-stall.test.mjs` covers the sibling idle-progress watchdog at full session integration;
 * this file is the direct, deterministic counterpart for the new per-call cap.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { watchCallCap } from "../../build/node_modules/@earendil-works/pi-coding-agent/dist/core/stream-progress.js";

const MODEL = { api: "openai-responses", provider: "stallbox", id: "stall-1" };
const CAP_MS = 200;

/** A minimal, complete `AssistantMessage` a "start" event's `partial` can carry. */
function partialMessage(text) {
	return { role: "assistant", content: [{ type: "text", text }], api: MODEL.api, provider: MODEL.provider, model: MODEL.id,
		usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		stopReason: "stop", timestamp: Date.now() };
}

const EMPTY_USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

/**
 * A fake provider `start` function: pushes `events` (each `{delayMs, event}`, delays measured from the
 * previous push) in order, then either ends the stream (a normal completion) or, with `hang: true`, never
 * ends at all -- exactly a stall, cut only by an abort. Respects the signal it is handed, as any real
 * provider stream must: on abort it settles with a final `error`/`reason: "aborted"` event (never a bare
 * `.end()` with no result -- that would leave the stream's own `.result()` promise unsettled forever,
 * which is not a shape any real pi-ai adapter produces).
 */
function fakeProvider(events, { hang = false } = {}) {
	return (signal) => {
		const out = createAssistantMessageEventStream();
		let stopped = false;
		const aborted = () => {
			if (stopped) return;
			stopped = true;
			out.push({ type: "error", reason: "aborted", error: { role: "assistant", content: [], api: MODEL.api,
				provider: MODEL.provider, model: MODEL.id, usage: EMPTY_USAGE, stopReason: "aborted", timestamp: Date.now() } });
			out.end();
		};
		if (signal?.aborted) aborted();
		else signal?.addEventListener("abort", aborted, { once: true });
		void (async () => {
			for (const { delayMs, event } of events) {
				await new Promise((resolve) => setTimeout(resolve, delayMs));
				if (stopped) return;
				out.push(event);
				if (event.type === "done" || event.type === "error") { stopped = true; out.end(); return; }
			}
			if (!hang && !stopped) { stopped = true; out.end(); }
			// `hang: true`: never calls `end()` on its own -- the caller's abort (`aborted()` above, whether
			// from the cap firing or the outer caller) is the only thing that ever ends this stream, exactly
			// like a provider that has gone silent.
		})();
		return out;
	};
}

/** Collect every event `watchCallCap`'s returned stream produces, and whether the underlying fake saw its
 * signal aborted (a real provider socket would be torn down the same way). */
async function drain(stream) {
	const events = [];
	for await (const event of stream) events.push(event);
	return events;
}

test("a fast call, well inside the cap, is untouched: the stream's own events and completion pass through unchanged", async () => {
	let sawAbort = false;
	const start = (signal) => {
		signal?.addEventListener("abort", () => { sawAbort = true; });
		return fakeProvider([
			{ delayMs: 5, event: { type: "start", partial: partialMessage("") } },
			{ delayMs: 5, event: { type: "done", reason: "stop", message: partialMessage("All done.") } },
		])(signal);
	};
	const onCap = () => { throw new Error("must not be called: this call never reaches the cap"); };
	const events = await drain(watchCallCap(start, undefined, CAP_MS, MODEL, onCap));
	assert.deepEqual(events.map((event) => event.type), ["start", "done"]);
	assert.equal(events.at(-1).message.stopReason, "stop");
	assert.equal(sawAbort, false, "a call that finishes under the cap is never aborted");
});

test("a stall before the first byte is cut at the cap, phase 'first_byte', with a synthetic error message (no partial message ever arrived to copy)", async () => {
	let sawAbort = false, capCalls = 0;
	const start = (signal) => {
		signal?.addEventListener("abort", () => { sawAbort = true; });
		return fakeProvider([], { hang: true })(signal);
	};
	const began = Date.now();
	const onCap = (phase) => { capCalls++; assert.equal(phase, "first_byte"); return `Keeper call timed out: exceeded its per-call cap of ${CAP_MS} ms (phase: ${phase})`; };
	const events = await drain(watchCallCap(start, undefined, CAP_MS, MODEL, onCap));
	assert.ok(Date.now() - began >= CAP_MS, "the cap actually waited its own duration before firing");
	assert.equal(capCalls, 1, "onCap is asked exactly once per attempt");
	assert.equal(events.length, 1);
	assert.equal(events[0].type, "error");
	assert.equal(events[0].error.stopReason, "error");
	assert.match(events[0].error.errorMessage, /timed? out|timeout/i, "worded to match pi-ai's own retry patterns");
	assert.deepEqual(events[0].error.content, [], "no partial content ever arrived to carry");
	assert.equal(events[0].error.model, MODEL.id);
	assert.equal(sawAbort, true, "the underlying fake provider call is aborted when the cap fires");
});

test("a stall mid-stream is cut at the cap, phase 'streaming', copying the last partial message that did arrive", async () => {
	let sawAbort = false;
	const start = (signal) => {
		signal?.addEventListener("abort", () => { sawAbort = true; });
		return fakeProvider([{ delayMs: 5, event: { type: "start", partial: partialMessage("Partial so far") } }], { hang: true })(signal);
	};
	const onCap = (phase) => { assert.equal(phase, "streaming"); return `Keeper call timed out: exceeded its per-call cap of ${CAP_MS} ms (phase: ${phase})`; };
	const events = await drain(watchCallCap(start, undefined, CAP_MS, MODEL, onCap));
	assert.deepEqual(events.map((event) => event.type), ["start", "error"]);
	assert.equal(events[1].error.stopReason, "error");
	assert.match(events[1].error.errorMessage, /timed? out|timeout/i);
	assert.deepEqual(events[1].error.content, [{ type: "text", text: "Partial so far" }], "the last partial message's content is carried, not discarded");
	assert.equal(sawAbort, true);
});

test("capMs <= 0 disables the cap entirely: the stream passes straight through, even past what would have been the cap", async () => {
	const start = fakeProvider([
		{ delayMs: 5, event: { type: "start", partial: partialMessage("") } },
		{ delayMs: CAP_MS * 3, event: { type: "done", reason: "stop", message: partialMessage("Slow but not capped.") } },
	]);
	const onCap = () => { throw new Error("must not be called: the cap is disabled"); };
	for (const disabled of [0, -1]) {
		const events = await drain(watchCallCap(start, undefined, disabled, MODEL, onCap));
		assert.deepEqual(events.map((event) => event.type), ["start", "done"]);
	}
});

test("a caller's own outer abort ends the attempt as 'aborted', never asks the cap's onCap, and is never retried", async () => {
	const outer = new AbortController();
	const start = fakeProvider([], { hang: true });
	const onCap = () => { throw new Error("must not be called: this is the caller's own abort, not a cap overrun"); };
	const promise = drain(watchCallCap(start, outer.signal, CAP_MS * 10, MODEL, onCap));
	setTimeout(() => outer.abort(new Error("caller revoked the run")), 10);
	const events = await promise;
	// The underlying fake settles the same way a real aborted provider stream does (one final `error`/
	// `reason: "aborted"` event); what matters here is that it is relayed through untouched -- the cap's
	// own timer never fires and `onCap`, which would word the failure as retryable, is never consulted for
	// a cancellation that must never be retried.
	assert.equal(events.length, 1);
	assert.equal(events[0].type, "error");
	assert.equal(events[0].reason, "aborted");
	assert.equal(events[0].error.stopReason, "aborted");
});

/**
 * The wording contract itself (contract §135.29's SL-69 addendum, "abandon and re-send once ... a second
 * overrun ends the step"): `watchCallCap` never counts attempts or decides retryability on its own -- it
 * only uses whatever string `onCap` returns. This is `runtime/jev/hybrid-engine.ts`'s own wiring
 * (`sdk.ts`'s per-step overrun counter), pinned here at the level `watchCallCap` actually controls: a
 * caller that returns a retryable-worded message on the first call and a non-retryable-worded one on the
 * second gets exactly that back, attempt for attempt, independent of phase.
 */
test("onCap's returned wording is used verbatim, attempt for attempt: this is the seam the retryable/non-retryable split is built on", async () => {
	let attempt = 0;
	const messageFor = (n) => (n <= 1
		? `Keeper call timed out: exceeded its per-call cap of ${CAP_MS} ms (phase: streaming)`
		: `Keeper call exceeded its per-call cap of ${CAP_MS} ms a second time (phase: streaming); this step ends now.`);
	const runOnce = async () => {
		attempt++;
		const start = fakeProvider([{ delayMs: 5, event: { type: "start", partial: partialMessage("x") } }], { hang: true });
		const events = await drain(watchCallCap(start, undefined, CAP_MS, MODEL, () => messageFor(attempt)));
		return events.at(-1).error.errorMessage;
	};
	const first = await runOnce();
	assert.match(first, /timed? out|timeout/i, "attempt 1: worded to retry");
	const second = await runOnce();
	assert.ok(!/timed? out|timeout|terminated/i.test(second), "attempt 2: worded so nothing retries it");
	assert.match(second, /second time/, "and the wording says why: this step's cap has now overrun twice");
});
