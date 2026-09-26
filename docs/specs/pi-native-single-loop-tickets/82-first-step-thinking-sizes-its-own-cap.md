Status: ready (filed 2026-09-26 from long gate #14; batch 14)
Stage: SL-82 (P1 while SL-74 is live; the flag's step-1 call and SL-69's per-call cap)
Spec: docs/kernel-rpc.md §135.29 addendum (SL-69: cap = max(floor, turn budget/2), `PI_COC_KEEPER_CALL_CAP_FLOOR_MS`), §38.7.1 (SL-74 `first_step_thinking`, `step`), `runtime/jev/hybrid-engine.ts` `keeperCallCapMs`, `extensions/kernel/first-step-thinking.ts`

# SL-82 — With first-step thinking on, the step-1 call needs its own cap: gate #14 stranded 8/20 turns because the 22.5 s cap killed every thinking call

## Evidence (long gate #14 `longgate14-haunting-0509`, run events + campaign telemetry)
- deepseek-v4.1-flash with thinking ≈ 35 s a call (gate #9). Cap = max(20,000, 45,000/2) = 22,500 ms. Every stranded turn (t9/10/12/13/17/18/19/20): four `200` responses ≈25 s apart, error stops "Keeper call timed out: exceeded its per-call cap of 22500 ms (phase: streaming)" ×11 and "… a second time" ×35, then `ask_llm unavailable` → `model_unavailable:no_delivered_evidence`. Delivered turns were the ones whose thinking call finished under the cap. `first_step_thinking: true` on 51 of 93 requests because every retry of the killed call is again step 1.
- Gate #15 (same build, `PI_COC_KEEPER_CALL_CAP_FLOOR_MS=60000`): no cap stops on turns 1–2, both delivered (75 s / 65 s).

## Ruling (filed for the owner)
The flag owns its cost: when `COC_FIRST_STEP_THINKING` is on, the step-1 call's cap is max(the ordinary cap, a thinking-call allowance) — a named default in `content/rulesets/coc7/host-budgets.json` (`first_step_thinking.call_cap_ms`, from the measured ≈35 s) — and steps ≥ 2 keep the ordinary cap. The `keeper_call_cap` telemetry row carries `step` and the cap used. Nothing changes when the flag is off. If the flag ever becomes a setting, the run's time budget (§135.25) must add the same allowance so the compose step is not squeezed.

## Scope
- `runtime/jev/hybrid-engine.ts` (`keeperCallCapMs` → per-call by step, wired through `runtime/pi-hybrid.ts`'s `keeperCallCapMs`/`watchCallCap`), `extensions/kernel/first-step-thinking.ts`, the data file; contract §135.29 addendum 2.
- Tests (mutation-killable): flag on → step-1 cap = allowance, step-2 cap = ordinary; flag off → unchanged; the telemetry row carries `step`; the allowance is read from data (mutate the file → cap changes).

## Comments
