Status: ready-for-agent
Stage: SL-30 (P1; amends SL-24)
Spec: docs/specs/pi-native-single-loop.md (Ruling: "A batch is admitted line by line")

# SL-30 — Line-level admission: typed-cleared lines go through, the lane reviews the rest

## Evidence (long live gate #2, campaign longgate2-haunting-0830 under chatrpgv4-wt-integ-sl/.coc/campaigns)
- Turn 14: `apply threat` + `apply time`: typed `entailed` at 0.57 (line verdicts not_player_action, entailed), lane no verdict at 13.0 s → `review_pending`; the resend ended `review_timeout` at the 26 s hard cap. Turn 6: `apply person` + `time` + `clue`: lane 10.1 s. Plain move/clue/time batches: 2.4–4.7 s.
- Across gates #1 and #2 the slow batches always carry a `threat` or `person` line.

## Scope
1. Measure per line kind on both long tables' Keeper batches (lane ms, typed line verdict and confidence); pre-register.
2. Contract (§32.12.3): line-level admission as the ruling states; receipts per admitted line; the pending remainder's row names the lines still waiting; the Keeper's note says which lines landed.
3. Implement in extensions/kernel/admission.ts and admitAction; tests, mutation-killable; replay long gate #2's turns 6 and 14 with the recorded Keeper: the plain lines land at once, the threat/person lines follow or return pending alone.

## Comments
