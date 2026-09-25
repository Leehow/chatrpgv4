Status: ready (filed 2026-09-25 from long gate #10 and the 血色公路 batch-11 table; batch 11)
Stage: SL-69 (P1, turn wall; the Keeper's own provider call)
Spec: docs/kernel-rpc.md §135.11 (turn close), §135.29 (stream progress, vendored patch 0003), the turn budget

# SL-69 — A Keeper provider call that outlives its cap is abandoned and retried once; the turn never waits minutes on one call

## Evidence
- Long gate #10 t20: one call of 155 s, response 200 with text and a tool call; the rest of the table's calls were 2–7 s. Batch-11 血色公路 t?: one call of 187 s, no error; 91 other calls p50 ~3.5 s. Both outliers set their table's max wall; nothing in the product waited on anything but the provider.
- §135.29's stream-progress watchdog covers a stream that stops producing; these calls were slow to start (no first byte for minutes) or slow throughout; there is no per-call cap on the Keeper's own call (memory: "主模型无看门狗").

## Ruling (owner, 2026-09-25)
A Keeper call has a cap, a named default derived from the table's turn budget (e.g. half the remaining budget, never below a floor); past it the call is abandoned and re-sent once with the same context; a second overrun ends the step with the SL-16 fallback. The cap is recorded on the run's telemetry with the call's phase (waiting for the first byte / streaming).

## Scope
1. Contract: §135.29 addendum (the per-call cap beside the stream-progress watchdog; the retry; the fallback).
2. `runtime/jev/hybrid-engine.ts` / the Keeper call site (vendored Pi's run driver hook from patch 0003): the cap and the one retry; telemetry `keeper_call_cap` rows.
3. Tests, mutation-killable, with a fake provider that stalls before the first byte and one that stalls mid-stream: the call is abandoned at the cap, retried once, and the turn delivers; a fast call is untouched.

## Comments
