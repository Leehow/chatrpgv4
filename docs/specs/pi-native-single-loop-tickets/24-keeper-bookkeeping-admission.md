Status: ready-for-agent
Stage: SL-24 (P1; amends SL-18)
Spec: docs/specs/pi-native-single-loop.md (Ruling: "A review that runs out of time is not a refusal")

# SL-24 — Keeper bookkeeping admission: concurrent reviewers, no silent refusals, a cap that bounds waiting

## Evidence (long live gate, campaign longgate-haunting-1010)
- `review_timeout` ×4: turn 1 (commission apply: clue, cash, item, handout, move), turns 6 and 7 (apply move to previous-tenants, twice: the Keeper then narrated the player as still on the street and the sanatorium visit never happened for the kernel), turn 14 (clue corbitt-diaries + time + threat: the diaries never existed; turn 19's `look object "Corbitt Diaries"` was unknown_entity).
- `not_player_action` ×4 with `grounds: None` and `proposed: None` (turns 10, 13 ×2, 15): refusals the Keeper cannot act on; turn 15's was the basement search.
- Lane latency for Keeper writes on this table: 2.4–7.4 s typical, 4 over 12 s; `path: typed` never; §32.11's fast path needs 0.87 and observed 0.72–0.80.

## Scope
1. Measure first: the lane's latency distribution on the long table's 26 Keeper-origin reviews and SL-10's retained bank; the typed reviewer's agreement with the lane on those (run it offline on the recorded batches); pre-register.
2. Contract (§32.12.2, amending §32.2/§32.11/§32.12): typed and lane run concurrently, first sufficient verdict wins; cap expiry on a bookkeeping-only batch with an authorizing typed verdict → admitted `path: typed_late`; other writes → `review_pending` returned to the Keeper with the typed verdict, resend once; a verdict without grounds is no verdict (fall through, never refuse); the cap value set from the measured distribution (state it and why).
3. Find why `not_player_action` came back with no grounds (extensions/kernel/admission.ts, the lane prompt/parse) and fix the parse or the prompt contract so every refusal carries grounds and the proposal.
4. Tests, mutation-killable; replay the long gate's turns 6 and 14 states with the recorded Keeper: the move and the clue land.

## Comments
