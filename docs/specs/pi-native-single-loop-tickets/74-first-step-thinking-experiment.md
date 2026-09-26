Status: ready-for-human (landed 2026-09-26 on claude/sl74-20260926, commit 2c1e239e)
Stage: SL-74 (P3, host; an experiment flag, not a setting)
Spec: docs/kernel-rpc.md §135.27.1 (provider corrections; `thinkingLevelMap.off`), §38.7 (provider-request telemetry), pi `before_provider_request` (a handler's return value replaces the payload; `vendor/pi/packages/coding-agent/src/core/extensions/runner.ts` `emitBeforeProviderRequest`), `extensions/kernel/index.ts` `table.roundTrips` (reset on player input, +1 per `turn_start`)

# SL-74 — Think on the first step of a turn only: an env-gated experiment for gate #14

## Evidence (campaign telemetry of twelve long gates, same script)
| table | Keeper / thinking | `unknown_entity` | refusal-budget cuts | max reads in one turn |
|---|---|---|---|---|
| #1–#8 | grok, thinking on | 0–1 | 0–1 | 1–4 |
| #9 | deepseek, on | 0 | 0 | 5 |
| #10 / #11 / #12 | deepseek, off | 7 / 9 / 5 | 2 / 2 / 2 | 3 / 12 / 7 |
- Thinking off buys the speed (median 109 s → 26–41 s) and pays in planning errors; every misuse is in the plan (who acts, which handle, whether to read again), none in the prose. On this provider `low`–`xhigh` do not change reasoning (probe on gate #9's real requests); only on/off exist. A thinking call costs ≈ 35 s, a thinking-off call ≈ 3 s.

## Ruling (owner, 2026-09-26)
An experiment, not a product setting: with `COC_FIRST_STEP_THINKING=1` the session runs at the driver's `--thinking` level, and the host's `before_provider_request` returns the payload with thinking disabled for every call after the first of a turn (`table.roundTrips >= 1`; the counter resets with the player input). The disabled form follows the model's `thinkingFormat` (pi-ai writes it; the host must not hard-code one provider's field: read what pi-ai's openai-completions provider emits for `thinkingFormat: "deepseek"` and mirror the disabled shape it would emit for `off`). Telemetry: the existing `provider-request` row gains `first_step_thinking: true|false` and `step: roundTrips`. No UI, no settings key. Gate #14 = gate #13's build + this flag; the comparison lines are refusals, cuts, reads per turn, median wall, ≤60 s count.

## Scope
1. Contract: §38.7 addendum (the row fields) and a §135.27.1 note that the flag exists for measurement only.
2. `extensions/kernel/index.ts` `before_provider_request` (line ~5507) and the driver (`tests/play/driver.py start --first-step-thinking` sets the env for the daemon).
3. Tests (`tests/extension/`, mutation-killable): with the flag, the first call's payload keeps thinking and the second's carries the disabled shape; without the flag both keep it; the counter reset on player input turns thinking back on; the telemetry row carries `step`.
4. Not in scope: the thinking dropdown's missing `Off` (Electron UI, filed separately as SL-75 for the App session).

## Comments

**Landed 2026-09-26 on `claude/sl74-20260926`** (worktree `chatrpgv4-wt-sl74`, commits `0a6dfe16`
spec, `2552b23d` kernel, `1a781a6c` tests, `2c1e239e` driver).

**A wrinkle found before writing any code, not anticipated by the ruling's text: `table.roundTrips >= 1`
is off by one.** `table.roundTrips` resets to 0 on player input and increments once per `turn_start`
(`extensions/kernel/index.ts`), but pi's own agent loop (`@earendil-works/pi-agent-core`'s
`agent-loop.ts`, `runAgentLoop`) emits that first `turn_start` *before* the loop's first provider call --
so by the time `before_provider_request` fires for that call, the counter has already become 1. The first
call of a turn is observed at `roundTrips === 1`, the second at `2`. Verified against a real Pi agent
session, not just read off the source: an inline `turn_start` listener called
`_extensionRunner.emitBeforeProviderRequest` directly (the harness's main `faux` provider never calls
`onPayload`, so the hook does not fire on its own -- same constraint `tests/extension/skills.test.mjs`'s
"implicit delivery and request-hook rounds" test already works around) and recorded which call actually
kept thinking. The naive `>= 1` reading would have disabled thinking on the turn's first call too, defeating
the whole point. `extensions/kernel/first-step-thinking.ts`'s `isFirstStepOfTurn` is `roundTrips <= 1`; the
contract addendum (§38.7.1) states this explicitly so the next reader does not repeat the naive reading.

**The disabled shape is keyed on the fields already in the payload, not a provider name or `compat`.**
`ctx.model.compat.thinkingFormat` is frequently unset (pi-ai auto-detects it from provider/baseUrl inside
`openai-completions.js`, invisible to an extension) -- so `disableStepThinking` reads what the enabled call
actually wrote (`thinking: {type}`, `enable_thinking`, `chat_template_kwargs.enable_thinking`,
`reasoning: {enabled}`, `reasoning: {effort}`, top-level `thinking: "<level>"`, `reasoning_effort`) and
mirrors pi-ai's own disabled shape for that field, using the model's static `thinkingLevelMap.off` only for
the two formats whose off value is a configured string (`openrouter`, `string-thinking`). `deepseek` and
`zai` share one branch (`thinking: {type: "disabled"}`) since they write the same shape; sending it does
not gate on `thinkingLevelMap.off` the way pi-ai's own generator does, because §135.27.1's live probe
already proved a real opencode-go/deepseek endpoint accepts it regardless. `chat-template` and `baseten`
(arbitrary per-provider `chat_template_kwargs`/`chat_template_args` templates) and any payload with none of
the known fields (a non-reasoning model, or the separate `openai-responses` API family xai/grok and
OpenAI's o-series use) report `first_step_thinking: "unsupported_format"` and leave the payload untouched,
per the assignment's explicit third state (the filed ticket text above only anticipated `true|false`; the
extension is additive and documented in §38.7.1).

**Files.** `extensions/kernel/first-step-thinking.ts` (new, pure): `isFirstStepOfTurn`,
`disableStepThinking`. `extensions/kernel/index.ts`'s `before_provider_request` hook: computes `step` and
`first_step_thinking` only when `COC_FIRST_STEP_THINKING=1` and a table is open (a lane call or anything
before `session_start` gains neither field, same as the flag off), adds them to the existing
`provider-request` row, and returns the rewritten payload only on the `disabled` outcome (pi's own
replace-by-return-value contract -- `undefined` leaves the payload as pi-ai built it). `tests/play/driver.py`:
`start --first-step-thinking` (and `_daemon`'s own copy of the flag) sets `COC_FIRST_STEP_THINKING=1` in an
explicit env dict passed to `Daemon._start_pi`'s `PiProcess(..., env=...)` -- unlike `--thinking`, this is
not a `pi` CLI concept, so it travels as an environment variable to the launcher subprocess rather than a
launch arg; omitted, `env` stays `None` (unchanged pre-SL-74 behavior, plain inheritance).
`docs/kernel-rpc.md`: §38.7.1 (the row's two new fields, the off-by-one finding, the format-dispatch
rationale) and a §135.27.1 note that the flag is measurement-only and touches no model data.

**Tests, mutation-killed.** `tests/extension/first-step-thinking.test.mjs` (14 tests): unit coverage of
`disableStepThinking` for every documented `thinkingFormat` (deepseek/zai's shared shape, string-thinking
with and without a null off, qwen and qwen-chat-template, the generic chat-template/baseten bailout,
together, openrouter vs. the off-less ant-ling shape, the openai-default `reasoning_effort`, and both
"nothing to invert" cases) plus `isFirstStepOfTurn`'s boundary; four extension-level scenarios drive a real
Pi agent session through two round trips of one player turn (with the flag: call 1 keeps thinking, call 2
is rewritten and the telemetry row carries `step`/`first_step_thinking`; without the flag: both calls keep
thinking and the row gains neither field; a second player turn's first call keeps thinking again, proving
the reset; an unmapped shape is left untouched and reported `unsupported_format`). One early bug in the
tests themselves, not the implementation: the harness's `PI_COC_SPEECH_STEER` lane is on by default and
adds a third round trip after a plain-text delivery (the same reason `skills.test.mjs`'s own two-round test
turns it off), which inflated three of the four scenarios to 3/3/6 round trips instead of 2/2/4 on the
first leehow-pc run; fixed by adding `PI_COC_SPEECH_STEER: "0"` to each scenario's env, confirmed on a
second full run. Mutation evidence (scratch-copy edit, run, restore -- never `git checkout --`): reverting
`isFirstStepOfTurn` to `roundTrips < 1` fails both the boundary unit test and both round-two extension
assertions; dropping the `delete next.reasoning_effort` in the deepseek/zai branch fails that unit test;
making the final `unsupported_format` fallback silently return `disabled` fails the "no known field" unit
test and the unmapped-format extension test; removing the `COC_FIRST_STEP_THINKING === "1"` gate in
`index.ts` fails the "without the flag" extension test. `tests/play/test_driver.py`: two new tests
(`test_first_step_thinking_sets_the_launcher_env`, `test_first_step_thinking_omitted_leaves_env_untouched`)
mirroring SL-61's own `--thinking` tests; mutation-killed by forcing `pi_env = None` regardless of the flag.

**Suite status.** Per the coordinator's instruction mid-task (leehow-pc was at load 30-45 from another
session's pytest), this ticket does not carry a full `test:ext`/`test:loop`/pytest acceptance -- the
coordinator is running one consolidated full-suite acceptance on the merged head instead. What was run
here: `tests/extension/first-step-thinking.test.mjs` 14/14 locally (`node --test`, after a local
`npm run build:runtime`, no `npm ci`); `tests/play/test_driver.py` 67/67 on leehow-pc
(`remote-test.sh run … py tests/play/test_driver.py -n 1`) and the 4 thinking-specific tests again locally
via `uv run --frozen pytest -k thinking` (4/4); one full `test:ext` run on leehow-pc before the
`PI_COC_SPEECH_STEER` fix (3 of this ticket's tests failing as described above, 3210/3213 otherwise) and a
second full run after the fix (3209/3213 passing -- all of this ticket's tests now green; the 4 remaining
failures are `keeper-call-cap-integration.test.mjs`, `jev-source-domain.test.mjs` (2 tests) and
`keeper-support-lookup-host.test.mjs`, none of which this ticket's diff touches, all timing/retry-budget
tests, and the box's load was 53 on a 16-thread machine at the time from a concurrent session -- consistent
with the project's documented flake pattern under box contention, not a regression from this change).

**Not done / left for the coordinator's consolidated run:** a clean, uncontended full `test:ext` +
`test:loop` + pytest baseline comparison against this branch's head. SL-75 (the Electron thinking
dropdown's missing "Off") remains explicitly out of scope, as filed.

Status: **ready-for-human**.
- Live (gate #14, b088de327): INVALID — the step-1 thinking call (≈35 s) was killed by SL-69's 22.5 s cap on 8/20 turns (SL-82 filed). Side reading before the strandings: Keeper refusals needs 2 / invalid_params 5 / unknown_entity 1 (#13: 27 / 3 / 0). Rerun as gate #15 with `PI_COC_KEEPER_CALL_CAP_FLOOR_MS=60000`.
