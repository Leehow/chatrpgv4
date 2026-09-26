/**
 * SL-74: an env-gated experiment (`COC_FIRST_STEP_THINKING=1`, docs/kernel-rpc.md §38.7.1). The
 * session runs at the driver's `--thinking` level throughout; this module answers one narrow
 * question for the host's `before_provider_request` hook -- given the request body pi-ai already
 * built for a call after the first of a turn, what does that same body look like with thinking
 * turned off?
 *
 * pi-ai's `openai-completions` provider (`node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js`,
 * `buildParams`) writes one of several wire shapes for "thinking is on" depending on the model's
 * `compat.thinkingFormat`, documented on `OpenAICompletionsCompat.thinkingFormat` in `pi-ai`'s
 * `types.d.ts`. `compat.thinkingFormat` itself is frequently unset on a model (auto-detected from
 * the provider/baseUrl inside pi-ai, invisible to an extension) -- so this module does not key off
 * a provider name or a `compat` field at all. It reads the fields the enabled call actually put in
 * the payload, which is the one place the true shape is guaranteed to be visible, and produces the
 * disabled mirror pi-ai's own code would have written for `off` instead. A shape pi-ai builds from
 * an arbitrary per-provider template (`chat-template`, `baseten`'s `chat_template_args`) cannot be
 * inverted this way and is reported unsupported rather than guessed at.
 */

/** One request body, as pi-ai hands it to `before_provider_request` before serialization. */
export type ProviderPayload = Record<string, unknown>;

export type ThinkingDisableOutcome =
	| { status: "disabled"; payload: ProviderPayload }
	| { status: "unsupported_format" };

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `table.roundTrips` (extensions/kernel/index.ts) resets to 0 on player input and increments once
 * per `turn_start`. Pi's own agent loop (`@earendil-works/pi-agent-core`'s `agent-loop.ts`,
 * `runAgentLoop`/`runLoop`) emits the first `turn_start` of a run *before* the loop's first
 * provider call -- so by the time `before_provider_request` fires for that first call, the counter
 * has already become 1, not 0. Every call after that opens with another `turn_start` first, so the
 * second call observes 2, the third observes 3, and so on. The first provider call of a turn must
 * therefore be recognised at `roundTrips === 1`, not `=== 0` (verified against a real Pi agent
 * session in `tests/extension/first-step-thinking.test.mjs`, not just read off the source).
 */
export function isFirstStepOfTurn(roundTrips: number): boolean {
	return roundTrips <= 1;
}

/** `COC_FIRST_STEP_THINKING=1`, read the exact way `extensions/kernel/index.ts`'s `before_provider_request`
 * hook already does. Exported so `runtime/jev/hybrid-engine.ts` (SL-82, contract §135.29 addendum 2) can gate
 * its own per-call cap on the same flag without a second copy of the literal. */
export function firstStepThinkingEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
	return env.COC_FIRST_STEP_THINKING === "1";
}

/**
 * SL-82 (contract §135.29 addendum 2; long gate #14). With the flag on, the turn's first Keeper provider
 * call sizes its own per-call cap: the larger of the ordinary SL-69 cap (`runtime/jev/hybrid-engine.ts`'s
 * `keeperCallCapMs`) and a thinking-call allowance named in `content/rulesets/coc7/host-budgets.json`
 * (`first_step_thinking.call_cap_ms`, read by `runtime/jev/host-budgets.ts`). A thinking call at that step
 * routinely runs far longer than a cap sized from the turn budget allows -- long gate #14 killed every
 * ~35 s thinking call at a 22,500 ms cap, stranding 8 of 20 turns. Steps 2 and later never see the
 * allowance: by the time that call goes out, `disableStepThinking` above has already turned thinking off
 * for it, so it runs at the ordinary pace the cap was already sized for.
 *
 * The flag off, or a step that is not the turn's first, returns `ordinaryCapMs` completely untouched. The
 * caller (`hybrid-engine.ts`) does not even reach this function in the flag-off case -- it keeps returning
 * the plain ordinary number it always has, so a table without `COC_FIRST_STEP_THINKING=1` takes the exact
 * code path SL-69 shipped, byte for byte.
 */
export function firstStepCallCapMs(flagOn: boolean, step: number, ordinaryCapMs: number, allowanceMs: number): number {
	if (!flagOn || !isFirstStepOfTurn(step)) return ordinaryCapMs;
	return Math.max(ordinaryCapMs, allowanceMs);
}

/**
 * Given the payload pi-ai built for an enabled call, return the same payload with thinking turned
 * off, or `{status: "unsupported_format"}` when the shape in front of us cannot be inverted safely.
 * `thinkingLevelMap` is the model's own catalog field (`ctx.model.thinkingLevelMap` in the hook) --
 * a static property, not the auto-detected `compat` -- used only for the two formats whose off value
 * is a configured string (`openrouter`, `string-thinking`) rather than a fixed shape.
 */
export function disableStepThinking(
	payload: unknown,
	thinkingLevelMap: { off?: string | null } | undefined,
): ThinkingDisableOutcome {
	if (!isPlainObject(payload)) return { status: "unsupported_format" };
	const off = thinkingLevelMap?.off;
	const next: ProviderPayload = { ...payload };

	// zai / deepseek: `thinking: { type: "enabled" | "disabled" }`. Both providers write the exact
	// same disabled shape, so one branch covers both without naming either. Probed live on a real
	// opencode-go/deepseek endpoint (content/providers/model-corrections.json, §135.27.1): sending
	// `disabled` explicitly is accepted and cuts a 59-92s turn to 3.1-3.5s with tools still called,
	// so this branch does not gate on `thinkingLevelMap.off` the way pi-ai's own generator does --
	// that guard only reflects pi-ai's conservative default, not a real endpoint limit.
	if (isPlainObject(payload.thinking) && "type" in payload.thinking) {
		next.thinking = { type: "disabled" };
		delete next.reasoning_effort;
		return { status: "disabled", payload: next };
	}

	// string-thinking: top-level `thinking: "<level>"`.
	if (typeof payload.thinking === "string") {
		if (off === null) delete next.thinking;
		else next.thinking = typeof off === "string" ? off : "none";
		return { status: "disabled", payload: next };
	}

	// qwen-chat-template: nested `chat_template_kwargs.enable_thinking` (+ `preserve_thinking`).
	// Checked before the generic chat-template/baseten bailout below, since this one nested shape
	// is fully known and worth inverting even though `chat_template_kwargs` in general is not.
	if (isPlainObject(payload.chat_template_kwargs) && "enable_thinking" in payload.chat_template_kwargs) {
		next.chat_template_kwargs = { ...payload.chat_template_kwargs, enable_thinking: false, preserve_thinking: true };
		return { status: "disabled", payload: next };
	}

	// chat-template / baseten: `chat_template_kwargs` / `chat_template_args` built from a
	// per-provider template (`buildChatTemplateValues`, arbitrary `$var` keys). Nothing here says
	// which key(s) carry thinking, so this cannot be inverted without reimplementing that template
	// resolution -- leave the payload untouched.
	if ("chat_template_kwargs" in payload || "chat_template_args" in payload) {
		return { status: "unsupported_format" };
	}

	// qwen: top-level `enable_thinking: boolean`.
	if (typeof payload.enable_thinking === "boolean") {
		next.enable_thinking = false;
		delete next.reasoning_effort;
		return { status: "disabled", payload: next };
	}

	// together: `reasoning: { enabled: boolean }`.
	if (isPlainObject(payload.reasoning) && "enabled" in payload.reasoning) {
		next.reasoning = { enabled: false };
		delete next.reasoning_effort;
		return { status: "disabled", payload: next };
	}

	// openrouter / ant-ling: both write `reasoning: { effort: "<level>" }` on an enabled call.
	// ant-ling never reads `thinkingLevelMap.off` at all (it omits the field outright once
	// `reasoningEffort` is falsy); openrouter writes `{ effort: off ?? "none" }` unless `off` is
	// `null`. A defined string `off` can therefore only belong to openrouter -- ant-ling never
	// looks at it -- so that case is unambiguous. Otherwise the safe default is to omit the field:
	// it matches ant-ling exactly, and for openrouter it still turns thinking off (omitting the
	// field is what an unmapped level falls back to), just not byte-identical to its `"none"` shape.
	if (isPlainObject(payload.reasoning) && "effort" in payload.reasoning) {
		if (typeof off === "string") next.reasoning = { effort: off };
		else delete next.reasoning;
		return { status: "disabled", payload: next };
	}

	// openai default (also the fallback for a model with no explicit `thinkingFormat`):
	// top-level `reasoning_effort: "<level>"`.
	if (typeof payload.reasoning_effort === "string") {
		if (typeof off === "string") next.reasoning_effort = off;
		else delete next.reasoning_effort;
		return { status: "disabled", payload: next };
	}

	// No thinking-control field present at all: either a non-reasoning model (nothing to turn
	// off) or a format this module does not know (e.g. the `openai-responses` API family used by
	// xai/grok and OpenAI's o-series, which has no `thinkingFormat` concept). Either way there is
	// no known lever here, so the payload is left untouched.
	return { status: "unsupported_format" };
}
