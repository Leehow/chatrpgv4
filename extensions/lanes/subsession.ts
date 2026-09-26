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

import {boundProviderRequest, independentProviderBudget, type TaskProviderBudget, type ProviderCharge, providerUsage} from "../../runtime/jev/provider-budget.ts";
import { clampThinkingLevel, parseJsonWithRepair } from "@earendil-works/pi-ai";
import type { ModelThinkingLevel, ThinkingLevel, ThinkingLevelMap } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { LANE_THINKING_DEFAULT as FAST_THINKING_DEFAULT, readFastModelChoiceSync, resolveFastModel, resolveFastThinking, type FastModelSource } from "../../runtime/fast-model.ts";
import { agentHomeOf } from "../ui/hints.ts";

/**
 * The closed set of lane failure reasons; the memory lane maps it onto `memory.fail`'s reason.
 * `timeout` only happens where the caller asked for one (`timeoutMs`): a completion that never
 * answers used to leave no trace at all, which is the hole ticket #28 closes.
 */
export type LaneFailureReason = "model_unavailable" | "model_error" | "bad_output" | "timeout";

/**
 * `firstByteMs`: from the lane request (the round's own clock) to the provider's response headers, when they arrived
 * (contract §32.12). A round cut by its deadline after the headers carries it too, which is what separates "the provider
 * never answered" from "it answered and then streamed past the cap".
 */
export type LaneResult<T> =
	| { ok: true; value: T; ms: number; model: string; raw: string; usage?: ReturnType<typeof providerUsage>; firstByteMs?: number }
	| { ok: false; reason: LaneFailureReason; detail: string; ms: number; model?: string; firstByteMs?: number };

/** `provider/model`. A model id may contain slashes itself, so split on the first one only. */
export function parseModelRef(raw: string): { provider: string; id: string } | undefined {
	const trimmed = raw.trim();
	const slash = trimmed.indexOf("/");
	if (slash <= 0 || slash >= trimmed.length - 1) return undefined;
	return { provider: trimmed.slice(0, slash), id: trimmed.slice(slash + 1) };
}

/** The fast-model choice in this session's agent home; a context with no home to read is no choice. */
function fastChoice(ctx: ExtensionContext | undefined) {
	try { return ctx ? readFastModelChoiceSync(agentHomeOf(ctx.cwd)) : {}; }
	catch { return {}; }
}

/**
 * The fast model (contract §37.10.1, §109.3). Highest first: the environment variable the lane is
 * named by, then the host's fast-model setting (`ext.coc-keeper.laneModel`, read from the agent home
 * at the moment the lane runs, through the one reader in `runtime/fast-model.ts`), then the table's
 * own model.
 *
 * Until §109 the setting reached only the `mod` children; every zero-tool lane -- admission,
 * verifier, memory, journal, voice -- followed the table unless an operator set its variable by
 * hand. So the one visible choice moved half the lanes, and the half it did not move was the one
 * the player waits on: the admission review at `grok-4.6` ran 20 s at the median and 79 s at p90
 * across the week of 2026-09-11, against 2.4 s and 16 s on the fast model the setting could have
 * named. A named model runs as written or the lane says which part of the name is unavailable,
 * exactly as for the variable: a setting is an operator's choice too.
 *
 * `source` says which of the three it was, so a caller that hands the model on to a `mod` child can
 * mark an operator's per-lane choice as pinned (`ReaderRequest.pinnedModel`).
 */
export function resolveLaneModel(
	ctx: ExtensionContext,
	envName: string,
): { ok: true; model: NonNullable<ExtensionContext["model"]>; source: FastModelSource } | { ok: false; detail: string } {
	const env = process.env[envName]?.trim();
	const resolved = resolveFastModel({ override: env, choice: env ? {} : fastChoice(ctx) });
	const raw = resolved.model;
	if (!raw) {
		const current = ctx.model;
		if (!current) return { ok: false, detail: `${envName} is unset and the current session has no model` };
		return { ok: true, model: current, source: "table" };
	}
	const named = env ? `${envName}=${raw}` : `the fast-model setting ${raw}`;
	const ref = parseModelRef(raw);
	if (!ref) return { ok: false, detail: `${named} is not provider/model` };
	const found = ctx.modelRegistry.find(ref.provider, ref.id);
	if (!found) return { ok: false, detail: `${named} is not in the model registry` };
	return { ok: true, model: found, source: resolved.source };
}

/**
 * The fast model and effort for a lane that runs as a tool-enabled child rather than a completion
 * (`runtime.runTask`), as the `provider/model` string the child is launched with.
 *
 * Same precedence as `resolveLaneModel` -- the lane's variable, the fast-model setting, the table --
 * but no registry lookup: the runtime refuses a child model it cannot run, by name, before launch
 * (`ensureChildRunnableModel`). The effort is the setting's or the lane's own level, never the
 * table's (§37.11). `table` is the Keeper's model label, or nothing when the session has none.
 *
 * SL-91 (contract §12.8.1 addendum 2): when `env` (the lane's own model override) is set, a matching
 * `${envName}_THINKING` decides the effort on its own, ahead of the setting -- the same rank `runLane`
 * gives it. No `env`, or no matching `_THINKING`, is today's resolution unchanged: the setting's level
 * or the literal default, never the table (§37.11 stands for this road too).
 */
export function fastLaneChoice(ctx: ExtensionContext | undefined, envName: string, table?: string): { model?: string; thinking: string; source: FastModelSource } {
	const env = process.env[envName]?.trim();
	const choice = fastChoice(ctx);
	const resolved = resolveFastModel({ override: env, choice: env ? {} : choice, table });
	const laneOverride = env ? process.env[`${envName}_THINKING`]?.trim() : undefined;
	return { ...resolved, thinking: laneOverride || resolveFastThinking({ choice }) };
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
 * The reasoning effort a lane round runs at when its caller names none (`request.thinking`; no
 * caller does today).
 *
 * SL-81 (contract §12.8.1 addendum, 2026-09-26) rewired this: the operator's own `PI_COC_LANE_THINKING`
 * still wins, then the fast-model setting (`ext.coc-keeper.laneThinking`, never consulted here before
 * this ticket), then -- new -- **the table's own level** (`ctx.thinkingLevel`, read fresh at the
 * moment the lane runs, through the same `resolveFastThinking` a `mod` child's model already uses).
 * Only once none of those has anything to say does this fall to the literal `LANE_THINKING_DEFAULT`
 * in `runtime/fast-model.ts`. Long gate #13 ran the admission lane at that literal `"low"` on a table
 * sitting at `off` for 100 calls straight, because nothing before this fix ever looked past it: a
 * lane still keeps its own wall-clock budget separate from the table's (§37.11's original point, for
 * a `mod` child, stands), but a zero-tool `runLane` lane has no budget-shaped reason to *ignore* a
 * table that has already been told to think less.
 *
 * SL-91 (contract §12.8.1 addendum 2, 2026-09-26) adds one rank *above* all of these: when the lane's
 * own model came from its own environment override (`envName`, e.g. `PI_COC_ADMISSION_MODEL` is set --
 * `runLaneAttempt` already knows this from `resolveLaneModel`'s own check of the same variable), a
 * matching `${envName}_THINKING` (e.g. `PI_COC_ADMISSION_MODEL_THINKING`) decides this lane's level on
 * its own, ahead of the shared `PI_COC_LANE_THINKING`, the setting and the table -- gate #21's own
 * lanes (grok-build/grok-4.5) paid 5-13 s admission reviews and two refusal-budget cuts in one turn on
 * the shared table-following level, while gates #19/#20 measured `xai/grok-4.3` at `off` answering in
 * 1.3-1.4 s p90 with zero timeouts as a *reviewer* (never as the Keeper, which the owner rejected for
 * other reasons): an operator who names a different model for one lane needs a way to also name that
 * model's own effort, without moving every other lane's. A table with no matching `_THINKING` variable
 * set is unaffected: the lane-specific check is skipped entirely and the resolution below runs exactly
 * as it did before this addendum.
 */
const LANE_THINKING_DEFAULT = FAST_THINKING_DEFAULT as ModelThinkingLevel;
const LANE_THINKING_LEVELS: ReadonlySet<string> = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

/** Which rank decided a lane's reasoning level; recorded on the `start` row as `thinking_source` (SL-91). */
export type LaneThinkingSource = "caller" | "lane-operator" | "operator" | "setting" | "table" | "default";

export interface LaneThinkingChoice { level: ModelThinkingLevel; source: LaneThinkingSource }

function normalizedThinkingLevel(raw: string): ModelThinkingLevel {
	const resolved = raw.trim().toLowerCase();
	return LANE_THINKING_LEVELS.has(resolved) ? (resolved as ModelThinkingLevel) : LANE_THINKING_DEFAULT;
}

/**
 * The fast-model choice's thinking, the table's own, and (SL-91) the lane's own environment override
 * when its model came from one too -- ranked, with which rank decided. `laneThinkingLevel` (below) is
 * the pre-SL-91 string-returning shape every existing caller keeps using unchanged.
 *
 * `envName` is optional and mirrors `resolveLaneModel`'s own check of the same variable (never a
 * second copy of that decision to drift from it: both read `process.env[envName]` at the moment the
 * lane runs). Omitting it -- every caller before this ticket -- skips the lane-specific rank entirely
 * and resolves exactly as `laneThinkingLevel` always has.
 */
export function laneThinkingChoice(ctx?: ExtensionContext, envName?: string): LaneThinkingChoice {
	const laneOverride = envName && process.env[envName]?.trim() ? process.env[`${envName}_THINKING`]?.trim() : undefined;
	if (laneOverride) return { level: normalizedThinkingLevel(laneOverride), source: "lane-operator" };
	const shared = process.env.PI_COC_LANE_THINKING?.trim();
	const choice = fastChoice(ctx);
	const table = ctx?.thinkingLevel;
	const level = normalizedThinkingLevel(resolveFastThinking({ override: shared, choice, table }));
	const source: LaneThinkingSource = shared ? "operator" : choice.thinking ? "setting" : table ? "table" : "default";
	return { level, source };
}

/** The fast-model choice's thinking plus the table's own, so `resolveFastThinking` can rank them (SL-81). */
export function laneThinkingLevel(ctx?: ExtensionContext, envName?: string): ModelThinkingLevel {
	return laneThinkingChoice(ctx, envName).level;
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
 * The APIs whose own option for a level is `reasoningEffort` -- the family pi-ai's own
 * `streamSimple` maps a provider-neutral `off` to `undefined` for (never the literal string), and
 * whose raw builders (`node_modules/@earendil-works/pi-ai/dist/api/*.js`) then consult the model's
 * own `thinkingLevelMap.off` to decide the disabled shape when nothing was named at all.
 */
const REASONING_EFFORT_APIS: ReadonlySet<string | undefined> = new Set([
	"openai-responses", "azure-openai-responses", "openai-codex-responses", "openai-completions",
]);

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
 *
 * **`off` (SL-81, 2026-09-25/26).** `off` is not a value any provider documents for `reasoningEffort`
 * -- sending it literally is exactly the bug long gate #13 traced: pi-ai's `deepseek` `thinkingFormat`
 * (`node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js`) treats *any* truthy
 * `reasoningEffort` as `thinking: {type: "enabled"}`, so a lane that named `"off"` there would have
 * turned reasoning *on*. For the four `reasoningEffort`-shaped APIs, `off` is instead handed exactly
 * the way pi's own `Agent`/`streamSimple` road already hands it -- omitted, never spelled out
 * (`node_modules/@earendil-works/pi-agent-core/dist/agent.js`: `reasoning: thinkingLevel === "off" ?
 * undefined : thinkingLevel`) -- whenever the model's own `thinkingLevelMap.off` is not explicitly
 * `null`: `undefined`/absent counts as supported, matching pi-ai's own convention, and a corrected
 * deepseek model (§135.27.1) has `off: "off"`. Omitting the field lets that API's own raw builder
 * consult the same map and produce its disabled shape on its own -- this is not a new shape invented
 * here, it is the same "absent `reasoningEffort`" branch already proven in that source for all four
 * APIs. A model whose map still says `off: null` (unsupported) falls through to the switch below
 * unchanged: the same literal `{reasoningEffort: "off"}` every other level already got, so nothing
 * regresses for it (today's behaviour, kept on purpose -- there is nowhere better to put it).
 */
export function laneReasoningOptions(
	model: { api?: string; thinkingLevelMap?: ThinkingLevelMap },
	level: ModelThinkingLevel,
): Record<string, unknown> {
	if (level === "off" && REASONING_EFFORT_APIS.has(model.api) && model.thinkingLevelMap?.off !== null) {
		return {};
	}
	switch (model.api) {
		case "openai-responses":
		case "azure-openai-responses":
		case "openai-codex-responses":
		case "openai-completions":
			return { reasoningEffort: level };
		case "anthropic-messages":
			return level === "off" ? {} : { effort: ANTHROPIC_EFFORT[level] };
		case "google-generative-ai":
		case "google-vertex":
			return level === "off" ? {} : { thinking: { enabled: true, level: GOOGLE_THINKING[level] } };
		case "bedrock-converse-stream":
		case "pi-messages":
			return level === "off" ? {} : { reasoning: level };
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
function laneCallRows(request: LaneRequest<unknown>, onFirstByte?: () => void) {
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
		start(model: string, thinking: ModelThinkingLevel, effective: ModelThinkingLevel, carried: boolean, source: LaneThinkingSource): Promise<void> {
			startedAt = Date.now();
			// What the lane asked for and whether this model's API had somewhere to put it. An API
			// `laneReasoningOptions` does not map reads as `carried: false` here rather than as a
			// level that quietly did nothing. `lane_thinking_effective` (SL-81, contract §12.8.1
			// addendum) is only ever different from `lane_thinking` when `thinking` is `off` and the
			// model's own map has no `off`: it then reports the real floor `off` was bumped to
			// (`clampThinkingLevel`), so the gap between what was asked and what could be delivered is
			// visible on the row instead of only inferable from `thinking_carried`. `thinking_source`
			// (SL-91, contract §12.8.1 addendum 2) says which rank decided: `lane-operator` names the
			// new `${envName}_THINKING` override, so a reader can tell it apart from the shared
			// `PI_COC_LANE_THINKING` (`operator`), the fast-model setting, the table, or the literal
			// default without re-deriving it from the other three fields.
			return write({ phase: "start", model, lane_thinking: thinking, lane_thinking_effective: effective, thinking_carried: carried, thinking_source: source });
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
				onFirstByte?.();
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
	providerBudget?: TaskProviderBudget;
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
	 * Reasoning effort for this round. Defaults to `laneThinkingLevel(ctx)`; a caller only names one
	 * when its own budget differs from every other lane's, which none does today.
	 */
	thinking?: ModelThinkingLevel;
	/**
	 * Shape check: narrow the parsed object down to the closed shape the lane wants, or undefined.
	 * Only fields and closed enums are checked here; every semantic judgement belongs to the model
	 * (contract §12.5: the lanes use neither keywords nor regexes).
	 */
	shape: (parsed: unknown) => T | undefined;
}

/** Run one lane: resolve the model, one completion, take the JSON, check the shape. Any step failing returns a failure, never throws. */
export async function runLane<T>(request: LaneRequest<T>): Promise<LaneResult<T>> {
	const independent = request.providerBudget ? undefined : independentProviderBudget(`lane:${request.lane}`, request.signal, request.timeoutMs ?? 180000);
	request = {...request, providerBudget:request.providerBudget ?? independent!.budget};
	const began = Date.now();
	let label: string | undefined;
	let firstByteMs: number | undefined;
	const firstByte = () => { firstByteMs ??= Date.now() - began; };
	const stamped = (result: LaneResult<T>): LaneResult<T> => firstByteMs === undefined ? result : { ...result, firstByteMs };
	// One controller for this round: the caller's signal and the timeout both cut the same completion.
	const controller = new AbortController();
	const relay = () => controller.abort();
	request = {...request, signal:AbortSignal.any([request.providerBudget!.signal, ...(request.signal ? [request.signal] : [])])};
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
		}, firstByte);
		// The deadline races the whole completion (§32.12): headers, silence or a steady trickle, a round with no answer by
		// the cap ends here whatever its stream is doing.
		return stamped(deadline ? await Promise.race([attempt, deadline]) : await attempt);
	} finally {
		if (timer) clearTimeout(timer);
		request.signal?.removeEventListener("abort", relay);
		independent?.close();
	}
}

async function runLaneAttempt<T>(
	request: LaneRequest<T>,
	signal: AbortSignal,
	began: number,
	remember: (label: string) => void,
	firstByte?: () => void,
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
		const rows = laneCallRows(request as LaneRequest<unknown>, firstByte);
		// The lane names its own reasoning effort. `complete()` is the full `stream()` road, which
		// carries no provider-neutral level for us, and every API's absent-level default is the
		// provider's ceiling rather than a floor (see `laneReasoningOptions`). SL-91: `envName` is
		// passed through so a lane whose model came from its own environment override also takes its
		// thinking level from a matching `${envName}_THINKING`, ranked above the shared resolution;
		// `request.thinking` (a caller-named level; no caller does today) still outranks everything.
		const { level: thinking, source: thinkingSource }: LaneThinkingChoice = request.thinking !== undefined
			? { level: request.thinking, source: "caller" }
			: laneThinkingChoice(request.ctx, request.envName);
		const reasoning = laneReasoningOptions(resolved.model, thinking);
		// `lane_thinking_effective` (SL-81): only computed -- and only ever different from `thinking`
		// -- when `off` was asked for; every other level is recorded unmapped, exactly as requested.
		const effective = thinking === "off" ? clampThinkingLevel(resolved.model, thinking) : thinking;
		await rows.start(label, thinking, effective, Object.keys(reasoning).length > 0, thinkingSource);
		let reply: Awaited<ReturnType<ExtensionContext["modelRegistry"]["complete"]>>;
		const charges:ProviderCharge[]=[];
		const retainUnknown=()=>{for(const charge of charges)charge.settle();};
		signal.addEventListener("abort",retainUnknown,{once:true});
		try {
			signal.throwIfAborted();
			const headers = openCodeSessionHeaders(resolved.model, sessionIdOf(request.ctx));
			reply = await request.ctx.modelRegistry.complete(
				resolved.model,
				{
					systemPrompt: request.systemPrompt,
					messages: [{ role: "user", content: [{ type: "text", text: request.input }] }],
					// tools omitted: that is what makes this a zero-tool session.
				},
				{ signal, maxRetries:0, ...reasoning, ...rows.options, ...(headers ? { headers } : {}),
					onPayload:async(payload:unknown)=>{
						const prepared=boundProviderRequest(resolved.model,payload);
						const charge=await request.providerBudget!.reserve(prepared.bound,signal);
						try{await rows.options.onPayload(prepared.payload);signal.throwIfAborted();}
						catch(error){charge.release();throw error;}
						charges.push(charge);return prepared.payload;
					}},
			);
		} catch (error) {
			for(const charge of charges.splice(0))charge.settle();
			await rows.end({ ok: false });
			throw error;
		} finally {signal.removeEventListener("abort",retainUnknown);}
		for(const [index,charge] of charges.entries())charge.settle(index===charges.length-1&&!['error','aborted'].includes(reply.stopReason)?reply.usage:undefined);
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
		return { ok: true, value, ms: Date.now() - began, model: label, raw, usage:providerUsage(reply.usage) };
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
