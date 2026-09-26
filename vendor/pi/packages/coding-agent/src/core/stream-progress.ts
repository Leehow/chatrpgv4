/**
 * A provider attempt ends when its stream stops producing events.
 *
 * `httpIdleTimeoutMs` becomes undici's `headersTimeout`/`bodyTimeout` and the SDK request timeout
 * (`configureHttpDispatcher`, `buildRequestOptions`). Those watch bytes. A connection that answers and
 * then keeps sending bytes no event is made of (SSE keep-alive comments, event types the API adapter
 * does not surface) is never idle to them, so the attempt waits for as long as the provider keeps the
 * socket open, and the session with it: no error, so no retry, and no end.
 *
 * This watches what the agent consumes instead. From the first event of the attempt (the adapter
 * pushes it once the response has answered; before that the transport timeouts govern), every event
 * restarts the same idle allowance. When it runs out, the request is aborted and the attempt ends as a
 * provider error, "timed out", which the retry patterns in pi-ai already match: the session's own
 * auto-retry makes the next attempt, bounded by `retry.maxRetries`. It is an error, not an abort, because
 * an abort is the caller revoking the run and is correctly never retried.
 */
import {
	type AssistantMessage,
	type AssistantMessageEventStream,
	createAssistantMessageEventStream,
} from "@earendil-works/pi-ai";

/** Streaming scratch fields the adapters strip from a finished message; never persisted. */
function settledContent(message: AssistantMessage): AssistantMessage["content"] {
	return message.content.map((block) => {
		const { index: _index, partialJson: _partialJson, customInput: _customInput, ...rest } = block as typeof block & {
			index?: unknown;
			partialJson?: unknown;
			customInput?: unknown;
		};
		return rest as typeof block;
	});
}

/**
 * Start one provider attempt under a progress watchdog. `start` receives the signal the request must use;
 * `outer` is the caller's (an abort there still ends the attempt as `aborted`). `idleMs` <= 0 disables it.
 */
export function watchStreamProgress(
	start: (signal: AbortSignal | undefined) => AssistantMessageEventStream,
	outer: AbortSignal | undefined,
	idleMs: number,
): AssistantMessageEventStream {
	if (!(idleMs > 0)) return start(outer);
	const request = new AbortController();
	const relay = () => request.abort(outer?.reason);
	if (outer?.aborted) request.abort(outer.reason);
	else outer?.addEventListener("abort", relay, { once: true });
	const source = start(request.signal);
	const out = createAssistantMessageEventStream();
	let timer: ReturnType<typeof setTimeout> | undefined;
	let last: AssistantMessage | undefined;
	let ended = false;
	const settle = () => {
		ended = true;
		clearTimeout(timer);
		outer?.removeEventListener("abort", relay);
	};
	const stall = () => {
		if (ended || !last || outer?.aborted) return;
		settle();
		const errorMessage = `Provider stream timed out: no response event for ${idleMs} ms`;
		// A copy: the adapter keeps mutating its own message after the abort below.
		out.push({
			type: "error",
			reason: "error",
			error: { ...last, content: settledContent(last), stopReason: "error", errorMessage },
		});
		out.end();
		request.abort(new Error(errorMessage));
	};
	void (async () => {
		for await (const event of source) {
			if (ended) break;
			clearTimeout(timer);
			if ("partial" in event) last = event.partial;
			out.push(event);
			if (event.type === "done" || event.type === "error") {
				settle();
				out.end();
				return;
			}
			timer = setTimeout(stall, idleMs);
		}
		if (!ended) {
			settle();
			out.end(await source.result());
		}
	})();
	return out;
}

/** The phase a per-call cap fired in (contract §135.29's SL-69 addendum): before the attempt's first event
 * ("first_byte" -- the idle watchdog above never fires here; the transport timeouts alone govern that gap),
 * or after it ("streaming", the same gap `watchStreamProgress` also times out on its own, shorter, terms). */
export type CallCapPhase = "first_byte" | "streaming";
const EMPTY_USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

/**
 * A Keeper call is abandoned once it runs past its own per-call cap, independent of and in addition to the
 * idle-gap watchdog above (contract §135.29's SL-69 addendum): a per-call TOTAL-duration ceiling, a named
 * default derived from the table's own turn budget, never below a floor (`runtime/jev/hybrid-engine.ts`
 * computes the value; this function only enforces whatever it is handed). `capMs <= 0` disables it, exactly
 * like `idleMs` above. `model` supplies what a synthetic failure message needs when the cap fires before any
 * real message ever arrived (`first_byte`): `watchStreamProgress`'s own `stall()` has a real partial message
 * to copy at that point; this one may not.
 *
 * `onCap` is asked for the error message to use, and is the caller's only chance to make this one
 * retryable or not: pi-ai's retry patterns key on wording (`"timed? out"`, `"timeout"`, …), so a message
 * that matches is retried by the session's existing mechanism exactly like an idle-progress timeout, and
 * one that does not match ends the step there. This function never decides retryability itself and keeps
 * no count across calls -- the caller (one per attempt) owns whatever counting "abandon and re-send once,
 * a second overrun ends the step" needs.
 */
export function watchCallCap(
	start: (signal: AbortSignal | undefined) => AssistantMessageEventStream,
	outer: AbortSignal | undefined,
	capMs: number,
	model: { api: AssistantMessage["api"]; provider: AssistantMessage["provider"]; id: string },
	onCap: (phase: CallCapPhase) => string,
): AssistantMessageEventStream {
	if (!(capMs > 0)) return start(outer);
	const request = new AbortController();
	const relay = () => request.abort(outer?.reason);
	if (outer?.aborted) request.abort(outer.reason);
	else outer?.addEventListener("abort", relay, { once: true });
	const source = start(request.signal);
	const out = createAssistantMessageEventStream();
	let last: AssistantMessage | undefined;
	let ended = false;
	const settle = () => {
		ended = true;
		clearTimeout(timer);
		outer?.removeEventListener("abort", relay);
	};
	const cap = () => {
		if (ended || outer?.aborted) return;
		const phase: CallCapPhase = last ? "streaming" : "first_byte";
		settle();
		const errorMessage = onCap(phase);
		const base: AssistantMessage = last ?? {
			role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id,
			usage: EMPTY_USAGE, stopReason: "error", timestamp: Date.now(),
		};
		out.push({
			type: "error",
			reason: "error",
			error: { ...base, content: last ? settledContent(last) : [], stopReason: "error", errorMessage },
		});
		out.end();
		request.abort(new Error(errorMessage));
	};
	const timer = setTimeout(cap, capMs);
	void (async () => {
		try {
			for await (const event of source) {
				if (ended) break;
				if ("partial" in event) last = event.partial;
				out.push(event);
				if (event.type === "done" || event.type === "error") {
					settle();
					out.end();
					return;
				}
			}
			if (!ended) {
				settle();
				out.end(await source.result());
			}
		} catch (error) {
			// The cap's own abort surfaces here as the source iterator rejecting; `cap()` already pushed the
			// error event and ended `out`, so a rejection after that point is discarded, never re-thrown.
			if (!ended) { settle(); out.end(); }
			void error;
		}
	})();
	return out;
}
