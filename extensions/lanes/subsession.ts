/**
 * The zero-tool subsession the lanes use (contract §12.3, §12.5).
 *
 * Both lanes want the same thing: hand a model one block of text, get one short JSON back,
 * with no tools, nothing written to the session record, and nothing blocking the Keeper's
 * delivery. The surface in Pi that reaches this is `ctx.modelRegistry.complete(model, context)`:
 * the extension-side completion facade, reusing the current session's model registry and auth,
 * and zero-tool as long as `context.tools` is not given. Why not `createAgentSession`, and where
 * the limits of this road are, is in docs/pi-host-contract.md §3 and §5.
 */

import { parseJsonWithRepair } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/**
 * The closed set of lane failure reasons; the memory lane maps it onto `memory.fail`'s reason.
 * `timeout` only happens where the caller asked for one (`timeoutMs`): a completion that never
 * answers used to leave no trace at all, which is the hole ticket #28 closes.
 */
export type LaneFailureReason = "model_unavailable" | "model_error" | "bad_output" | "timeout";

export type LaneResult<T> =
	| { ok: true; value: T; ms: number; model: string; raw: string }
	| { ok: false; reason: LaneFailureReason; detail: string; ms: number; model?: string };

/** `provider/model`. A model id may contain slashes itself, so split on the first one only. */
export function parseModelRef(raw: string): { provider: string; id: string } | undefined {
	const trimmed = raw.trim();
	const slash = trimmed.indexOf("/");
	if (slash <= 0 || slash >= trimmed.length - 1) return undefined;
	return { provider: trimmed.slice(0, slash), id: trimmed.slice(slash + 1) };
}

/** The lane model: the one the environment variable names, else the table's own model (contract §12.5, §12.8). */
export function resolveLaneModel(
	ctx: ExtensionContext,
	envName: string,
): { ok: true; model: NonNullable<ExtensionContext["model"]> } | { ok: false; detail: string } {
	const raw = process.env[envName]?.trim();
	if (!raw) {
		const current = ctx.model;
		if (!current) return { ok: false, detail: `${envName} is unset and the current session has no model` };
		return { ok: true, model: current };
	}
	const ref = parseModelRef(raw);
	if (!ref) return { ok: false, detail: `${envName}=${raw} is not provider/model` };
	const found = ctx.modelRegistry.find(ref.provider, ref.id);
	if (!found) return { ok: false, detail: `${envName}=${raw} is not in the model registry` };
	return { ok: true, model: found };
}

export function modelLabel(model: { provider: string; id: string }): string {
	return `${model.provider}/${model.id}`;
}

const OPENCODE_HOST = "opencode.ai";

function hostOf(baseUrl: string | undefined): string | undefined {
	if (!baseUrl) return undefined;
	try {
		return new URL(baseUrl).hostname;
	} catch {
		return undefined;
	}
}

/**
 * The two headers `sdk.js` attaches on the Keeper's streamFn via `mergeProviderAttributionHeaders`.
 * `complete()` never travels that road (docs/pi-host-contract.md, OpenCode session headers).
 */
export function openCodeSessionHeaders(
	model: { provider: string; baseUrl?: string },
	sessionId: string | undefined,
): Record<string, string> | undefined {
	if (!sessionId) return undefined;
	if (model.provider !== "opencode" && model.provider !== "opencode-go" && hostOf(model.baseUrl) !== OPENCODE_HOST) {
		return undefined;
	}
	return { "x-opencode-session": sessionId, "x-opencode-client": "pi" };
}

function sessionIdOf(ctx: ExtensionContext): string | undefined {
	const value = ctx.sessionManager?.getSessionId?.();
	return typeof value === "string" && value.trim() ? value : undefined;
}

/** Models may wrap or repeat JSON: take the first complete top-level object, respecting quoted braces. */
function extractJsonObject(text: string): string | undefined {
	const start = text.indexOf("{");
	if (start < 0) return undefined;
	let depth = 0, quoted = false, escaped = false;
	for (let index = start; index < text.length; index++) {
		const char = text[index];
		if (quoted) {
			if (escaped) escaped = false;
			else if (char === "\\") escaped = true;
			else if (char === '"') quoted = false;
			continue;
		}
		if (char === '"') quoted = true;
		else if (char === "{") depth++;
		else if (char === "}" && --depth === 0) return text.slice(start, index + 1);
	}
	return undefined;
}

/**
 * The response headers a row may carry, and nothing else (contract §12.8.1). The provider rows in
 * the kernel extension read the same two names; status plus a request id is the whole whitelist,
 * because a header this product did not ask for may hold anything, credentials included.
 */
const REQUEST_ID_HEADERS: readonly string[] = ["x-request-id", "request-id"];

/**
 * The reasoning level the outgoing body actually carries, or null when the body has no reasoning
 * field at all. Read exactly the pair the `provider-request` row reads, so the two row families
 * stay comparable: `anthropic-messages` writes its level as `effort`/`thinking` instead, and
 * neither family sees that today -- widening the reading means widening both at once.
 */
function bodyReasoningEffort(body: Record<string, unknown>): string | null {
	const nested = body.reasoning && typeof body.reasoning === "object" ? (body.reasoning as { effort?: unknown }).effort : undefined;
	const value = nested ?? body.reasoning_effort;
	return typeof value === "string" ? value : null;
}

/**
 * The four rows one lane call leaves behind (contract §12.8.1).
 *
 * `ctx.modelRegistry.complete()` does not travel the extension runner, so the `before_provider_request`
 * / `after_provider_response` hooks write nothing for a lane -- the reasoning why, and why the hooks
 * cannot be made to fire from here, is in docs/pi-host-contract.md's provider-latency section. What
 * this road does expose is the per-request pair `onPayload` / `onResponse`, which the shipped adapters
 * call at the same two moments the hooks fire at: body assembled and about to go on the wire, and
 * response headers arrived with the body stream not yet consumed.
 *
 * Every row swallows its own failure. Telemetry that breaks a turn is worse than telemetry that is
 * missing a line, and the callers' own `record` swallows too -- this is the second net, not the first.
 */
function laneCallRows(request: LaneRequest<unknown>) {
	const record = request.record;
	let startedAt = Date.now();
	const write = async (row: Record<string, unknown>): Promise<void> => {
		if (!record) return;
		try {
			await record({ lane: "lane-call", subsession: request.lane, at: new Date().toISOString(), ...row });
		} catch {
			/* telemetry must never break a lane */
		}
	};
	return {
		/** Before `complete()` is called, with the model already resolved. Every later `ms` counts from here. */
		start(model: string): Promise<void> {
			startedAt = Date.now();
			return write({ phase: "start", model });
		},
		/** Handed to `complete()`. Both callbacks only read: `onPayload` returning undefined leaves the body untouched. */
		options: {
			onPayload: async (payload: unknown): Promise<undefined> => {
				const body = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
				await write({
					phase: "request",
					model: typeof body.model === "string" ? body.model : null,
					reasoning_effort: bodyReasoningEffort(body),
					ms: Date.now() - startedAt,
				});
				return undefined;
			},
			onResponse: async (response: { status: number; headers: Record<string, string> }): Promise<void> => {
				const requestId = Object.entries(response?.headers ?? {}).find(([name]) =>
					REQUEST_ID_HEADERS.includes(name.toLowerCase()),
				)?.[1];
				await write({
					phase: "response",
					status: response?.status ?? null,
					...(requestId ? { request_id: requestId } : {}),
					ms: Date.now() - startedAt,
				});
			},
		},
		/**
		 * When `complete()` settles, however it settles. A round the deadline already gave up on still
		 * lands here when its abort finally takes: that late row is the evidence of when it took.
		 */
		end(outcome: { ok: boolean; stopReason?: string }): Promise<void> {
			return write({
				phase: "end",
				ok: outcome.ok,
				...(outcome.stopReason ? { stop_reason: outcome.stopReason } : {}),
				ms: Date.now() - startedAt,
			});
		},
	};
}

export interface LaneRequest<T> {
	ctx: ExtensionContext;
	/** Name of the environment variable the model comes from: `PI_COC_VERIFIER_MODEL` or `PI_COC_MEMORY_MODEL`. */
	envName: string;
	/** This lane's own name; it is the `subsession` field on every row this run writes (contract §12.8.1). */
	lane: string;
	/**
	 * Where the `lane: "lane-call"` rows go. Optional: a caller with nowhere to put them gets none,
	 * and the round runs exactly the same. It must never throw; this file catches anyway.
	 */
	record?: (row: Record<string, unknown>) => void | Promise<void>;
	systemPrompt: string;
	input: string;
	signal?: AbortSignal;
	/**
	 * Cap on one lane round. Without it a completion that never answers leaves the lane pending
	 * for ever and writes no telemetry row at all; with it the lane answers `timeout`, aborts its
	 * own completion, and the caller still gets exactly one row.
	 */
	timeoutMs?: number;
	/**
	 * Shape check: narrow the parsed object down to the closed shape the lane wants, or undefined.
	 * Only fields and closed enums are checked here; every semantic judgement belongs to the model
	 * (contract §12.5: the lanes use neither keywords nor regexes).
	 */
	shape: (parsed: unknown) => T | undefined;
}

/** Run one lane: resolve the model, one completion, take the JSON, check the shape. Any step failing returns a failure, never throws. */
export async function runLane<T>(request: LaneRequest<T>): Promise<LaneResult<T>> {
	const began = Date.now();
	let label: string | undefined;
	// One controller for this round: the caller's signal and the timeout both cut the same completion.
	const controller = new AbortController();
	const relay = () => controller.abort();
	if (request.signal) {
		if (request.signal.aborted) controller.abort();
		else request.signal.addEventListener("abort", relay, { once: true });
	}
	let timer: ReturnType<typeof setTimeout> | undefined;
	const deadline =
		typeof request.timeoutMs === "number" && request.timeoutMs > 0
			? new Promise<LaneResult<T>>((settle) => {
					timer = setTimeout(() => {
						controller.abort();
						settle({
							ok: false,
							reason: "timeout",
							detail: `the lane did not answer within ${request.timeoutMs} ms`,
							ms: Date.now() - began,
							...(label ? { model: label } : {}),
						});
					}, request.timeoutMs);
					timer.unref?.();
				})
			: undefined;
	try {
		const attempt = runLaneAttempt(request, controller.signal, began, (value) => {
			label = value;
		});
		return deadline ? await Promise.race([attempt, deadline]) : await attempt;
	} finally {
		if (timer) clearTimeout(timer);
		request.signal?.removeEventListener("abort", relay);
	}
}

async function runLaneAttempt<T>(
	request: LaneRequest<T>,
	signal: AbortSignal,
	began: number,
	remember: (label: string) => void,
): Promise<LaneResult<T>> {
	let label: string | undefined;
	try {
		const resolved = resolveLaneModel(request.ctx, request.envName);
		if (!resolved.ok) {
			return { ok: false, reason: "model_unavailable", detail: resolved.detail, ms: Date.now() - began };
		}
		label = modelLabel(resolved.model);
		remember(label);
		// The completion is timed on its own, apart from the prompt build, the model resolution above
		// and the shape work below: the lane's single `ms` cannot be decomposed, and #67 needs it to be.
		const rows = laneCallRows(request as LaneRequest<unknown>);
		await rows.start(label);
		let reply: Awaited<ReturnType<ExtensionContext["modelRegistry"]["complete"]>>;
		try {
			const headers = openCodeSessionHeaders(resolved.model, sessionIdOf(request.ctx));
			reply = await request.ctx.modelRegistry.complete(
				resolved.model,
				{
					systemPrompt: request.systemPrompt,
					messages: [{ role: "user", content: [{ type: "text", text: request.input }] }],
					// tools omitted: that is what makes this a zero-tool session.
				},
				{ signal, ...rows.options, ...(headers ? { headers } : {}) },
			);
		} catch (error) {
			await rows.end({ ok: false });
			throw error;
		}
		await rows.end({
			ok: reply.stopReason !== "error" && reply.stopReason !== "aborted",
			...(typeof reply.stopReason === "string" ? { stopReason: reply.stopReason } : {}),
		});
		if (reply.stopReason === "error" || reply.stopReason === "aborted") {
			return {
				ok: false,
				reason: "model_error",
				detail: reply.errorMessage ?? reply.stopReason,
				ms: Date.now() - began,
				model: label,
			};
		}
		const raw = (reply.content ?? [])
			.filter((block): block is { type: "text"; text: string } => block.type === "text")
			.map((block) => block.text)
			.join("")
			.trim();
		const json = extractJsonObject(raw);
		if (!json) {
			return { ok: false, reason: "bad_output", detail: "the reply held no JSON object", ms: Date.now() - began, model: label };
		}
		let parsed: unknown;
		try {
			parsed = parseJsonWithRepair(json);
		} catch (error) {
			return {
				ok: false,
				reason: "bad_output",
				detail: `JSON parse failed: ${error instanceof Error ? error.message : String(error)}`,
				ms: Date.now() - began,
				model: label,
			};
		}
		const value = request.shape(parsed);
		if (value === undefined) {
			return { ok: false, reason: "bad_output", detail: "the JSON is not the shape this lane asked for", ms: Date.now() - began, model: label };
		}
		return { ok: true, value, ms: Date.now() - began, model: label, raw };
	} catch (error) {
		return {
			ok: false,
			reason: "model_error",
			detail: error instanceof Error ? error.message : String(error),
			ms: Date.now() - began,
			...(label ? { model: label } : {}),
		};
	}
}
