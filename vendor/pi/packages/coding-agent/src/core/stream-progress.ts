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
