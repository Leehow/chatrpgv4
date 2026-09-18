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
import type { ThinkingLevel } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LANE_SETTINGS_FILE, laneChoiceOf } from "../../runtime/tasks.ts";
import { agentHomeOf } from "../ui/hints.ts";

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

/**
 * The lane-model setting the host's panel writes (`ext.coc-keeper.laneModel`), read from the agent
 * home at the moment a lane runs, the same way the `mod` children read it (contract §37.10). Any
 * shape that is not a settings document is simply no choice.
 */
function laneSetting(ctx: ExtensionContext): string | undefined {
	try { return laneChoiceOf(JSON.parse(readFileSync(join(agentHomeOf(ctx.cwd), LANE_SETTINGS_FILE), "utf8"))).model; }
	catch { return undefined; }
}

/**
 * The lane model (contract §12.5, §12.8, §109.3). Highest first: the environment variable the lane
 * is named by, then the host's lane-model setting, then the table's own model.
 *
 * Until §109 the setting reached only the `mod` children; every zero-tool lane -- admission,
 * verifier, memory, journal, voice -- followed the table unless an operator set its variable by
 * hand. So the one visible choice moved half the lanes, and the half it did not move was the one
 * the player waits on: the admission review at `grok-4.6` ran 20 s at the median and 79 s at p90
 * across the week of 2026-09-11, against 2.4 s and 16 s on the fast model the setting could have
 * named. A named model runs as written or the lane says which part of the name is unavailable,
 * exactly as for the variable: a setting is an operator's choice too.
 */
export function resolveLaneModel(
	ctx: ExtensionContext,
	envName: string,
): { ok: true; model: NonNullable<ExtensionContext["model"]> } | { ok: false; detail: string } {
	const env = process.env[envName]?.trim();
	const setting = env ? undefined : laneSetting(ctx);
	const raw = env || setting;
	if (!raw) {
		const current = ctx.model;
		if (!current) return { ok: false, detail: `${envName} is unset and the current session has no model` };
		return { ok: true, model: current };
	}
	const named = env ? `${envName}=${raw}` : `the lane-model setting ${raw}`;
	const ref = parseModelRef(raw);
	if (!ref) return { ok: false, detail: `${named} is not provider/model` };
	const found = ctx.modelRegistry.find(ref.provider, ref.id);
	if (!found) return { ok: false, detail: `${named} is not in the model registry` };
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
 * The reasoning effort a lane round runs at, `PI_COC_LANE_THINKING`.
 *
 * The same value, for the same reason, as `LANE_THINKING_DEFAULT` in runtime/tasks.ts (contract
 * §37.11): a lane has a fixed wall-clock budget its caller enforces, and the table's own effort is
 * a Keeper-quality choice with no relation to it, so a lane inherits neither the table's level nor
 * the provider's. `low` rather than `off` or `minimal` because it is the one level every authorized
 * lane model supports as written -- `grok-4.6` maps `off` to null and the DeepSeek family maps
 * `minimal` to null, so either of those means a different thing on a different model.
 *
 * Read per call: one process loads this file several times, and the operator may change it under a
 * running table.
 */
const LANE_THINKING_DEFAULT: ThinkingLevel = "low";
const LANE_THINKING_LEVELS: ReadonlySet<string> = new Set(["minimal", "low", "medium", "high", "xhigh", "max"]);

export function laneThinkingLevel(): ThinkingLevel {
	const raw = process.env.PI_COC_LANE_THINKING?.trim().toLowerCase();
	return raw && LANE_THINKING_LEVELS.has(raw) ? (raw as ThinkingLevel) : LANE_THINKING_DEFAULT;
}

/** Anthropic's effort enum starts at `low`; `minimal` has no name there, so it lands on the nearest one. */
const ANTHROPIC_EFFORT: Readonly<Record<ThinkingLevel, string>> = Object.freeze({
	minimal: "low", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max",
});
/** Google names the same ladder in capitals and stops at HIGH. */
const GOOGLE_THINKING: Readonly<Record<ThinkingLevel, string>> = Object.freeze({
	minimal: "MINIMAL", low: "LOW", medium: "MEDIUM", high: "HIGH", xhigh: "HIGH", max: "HIGH",
});

/**
 * The option that carries `level` to this model's API, or nothing when the API has no such option.
 *
 * A lane calls `ctx.modelRegistry.complete()`, which is the full `stream()` road: it takes each
 * API's *own* options, not the provider-neutral `reasoning` that `streamSimple()` (the Keeper's
 * road) accepts and maps for us. Naming no level there does not mean "think less" on any of them:
 * `openai-responses` omits the `reasoning` field entirely for a reasoning model whose
 * `thinkingLevelMap.off` is null -- which is exactly `grok-4.6` on both `grok-build` and `xai` --
 * and the provider's own default effort then governs; `anthropic-messages` reads
 * `options.effort ?? "high"` for a managed-effort model. A lane that names nothing is a lane
 * running at somebody else's ceiling under our stopwatch, which is how 2026-09-15's admission
 * refusals were bought: 120 s caps around rounds whose median on `grok-4.6` was 34-95 s, against
 * 942 ms for the same admission lane on `deepseek-v4-flash`.
 *
 * An API not listed here keeps today's behaviour rather than being guessed at -- `mistral` only
 * offers `none`/`high`, and a custom API has no documented name at all. The `lane_thinking` field
 * on the `start` row says what the lane asked for, so an unmapped API reads as a gap rather than as
 * a level that silently did nothing (contract §12.8.1).
 */
export function laneReasoningOptions(model: { api?: string }, level: ThinkingLevel): Record<string, unknown> {
	switch (model.api) {
		case "openai-responses":
		case "azure-openai-responses":
		case "openai-codex-responses":
		case "openai-completions":
			return { reasoningEffort: level };
		case "anthropic-messages":
			return { effort: ANTHROPIC_EFFORT[level] };
		case "google-generative-ai":
		case "google-vertex":
			return { thinking: { enabled: true, level: GOOGLE_THINKING[level] } };
		case "bedrock-converse-stream":
		case "pi-messages":
			return { reasoning: level };
		default:
			return {};
	}
}

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
		start(model: string, thinking: ThinkingLevel, carried: boolean): Promise<void> {
			startedAt = Date.now();
			// What the lane asked for and whether this model's API had somewhere to put it. An API
			// `laneReasoningOptions` does not map reads as `carried: false` here rather than as a
			// level that quietly did nothing.
			return write({ phase: "start", model, lane_thinking: thinking, thinking_carried: carried });
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
				// The adapter *awaits* this callback before it reads the first body byte, so whatever
				// happens in here is time the response stream is not being read. `at` is stamped when
				// the headers arrived and says nothing about when the callback returned, which left
				// "the provider sent nothing" and "the host blocked before reading" indistinguishable
				// on every stalled round (2026-09-15, turn 2: 200 in 612 ms, then 126 s and no blocks).
				// `hook_ms` separates them: near zero on a stalled round exonerates the host.
				const at = Date.now();
				await write({
					phase: "response",
					status: response?.status ?? null,
					...(requestId ? { request_id: requestId } : {}),
					ms: at - startedAt,
				});
				const hookMs = Date.now() - at;
				if (hookMs >= 1000) await write({ phase: "response_hook", hook_ms: hookMs, ms: Date.now() - startedAt });
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
	 * Reasoning effort for this round. Defaults to `laneThinkingLevel()`; a caller only names one
	 * when its own budget differs from every other lane's, which none does today.
	 */
	thinking?: ThinkingLevel;
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
		// The lane names its own reasoning effort. `complete()` is the full `stream()` road, which
		// carries no provider-neutral level for us, and every API's absent-level default is the
		// provider's ceiling rather than a floor (see `laneReasoningOptions`).
		const thinking = request.thinking ?? laneThinkingLevel();
		const reasoning = laneReasoningOptions(resolved.model, thinking);
		await rows.start(label, thinking, Object.keys(reasoning).length > 0);
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
				{ signal, ...reasoning, ...rows.options, ...(headers ? { headers } : {}) },
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
