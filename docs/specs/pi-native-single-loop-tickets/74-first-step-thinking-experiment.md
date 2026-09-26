Status: ready (filed 2026-09-26, owner's decision "按你建议来"; after batch 12 merges; gate #14's one variable)
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
