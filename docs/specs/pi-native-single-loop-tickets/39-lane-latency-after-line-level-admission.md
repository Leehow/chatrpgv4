Status: ready (filed 2026-09-24 from long gate #3 and SL-29A; batch 4, measurement first)
Stage: SL-39 (P2, admission lane tail)
Spec: docs/kernel-rpc.md §32.12.2, §32.12.3; memory "fast model: one setting for all quick lanes"

# SL-39 — The lane's own tail after SL-30: measure the reviewer model, then default the lane to the fast model

## Evidence
- Long gate #3 (SL-30 in): 23 lane reviews, ms sorted 1.9, 2.0, 2.7, 2.8, 2.8, 3.1, 3.4, 3.6, 4.1, 4.4, 4.7, 4.8, 5.1, 5.1, 5.2, 5.5, 5.7, 7.8, 7.8, 8.9, 9.9, 10.2, 13.0 s (p50 4.8 s, p90 9.9 s; one `review_pending` at the 13 s cap on t1's resolve). No `review_timeout`. Line-level clearing changed no verdict (paths: lane 23, compile 15, none 2).
- SL-29A: the move reviewer (deepseek-v4.1-flash) timed out at 10.0 s on t7 and hit the 13 s cap on t14, same move both times.
- The batches are now plain (no `person`/`threat` lines reach the lane), so the remaining cost is the reviewer model's latency itself.

## Scope
1. Measurement (recorded lane inputs from gate #3 and SL-29A, replayed against the current lane model and the fast-model setting's model; 3 runs each): p50/p90/max per model, verdict agreement with the recorded verdicts. Report before any change.
2. If the fast model clears the same verdicts at a lower tail, the lane follows the fast-model setting by default (env > setting > follow the table, per the existing rule; storage key unchanged); the ticket records the numbers. If not, the ticket records that and closes with the measurement.
3. Tests: the lane's model resolution order (already covered by the fast-model tests; add the default case if it changes).

## Comments
