Status: ready (filed 2026-09-25 from long gates #4–#6; batch 7)
Stage: SL-52 (P2, compile routing)
Spec: docs/kernel-rpc.md §135.30.x (compile rows, the `ask` feature), §135.30.5 (SL-38 guard_unlock), §134.17; docs/specs/pi-native-single-loop.md "fan-out not pick-one"

# SL-52 — The ask feature fans out: every clue the question clears at the gate is the clerk's

## Evidence (long gates #4, #5, #6: campaigns `longgate4-haunting-1308`, `longgate5-haunting-1447`, `longgate6-haunting-2155`)
- Three tables in a row the accept at t1 filed the leads clue (or nothing), the cash and the key item, but not `knott-keys`; the house was then guarded at t9 and the Keeper filed the clue when the guarded row said so: 54, 60, 69 s turns. At gate #6 t1 the compile's `ask` feature listed five rows (commission, research-leads, macario-summary, keys, handout 1), chose `knott-research-leads` at 0.89 (cleared, filed by SL-38's `guard_unlock`), and left `knott-keys` (ask_4) unread: the feature is single-choice.
- The prototype's own finding (RESULTS-20260923): fan-out, not pick-one.

## Ruling (owner, 2026-09-25)
The ask feature is a fan-out: each clue row is its own yes/no at the gate; every row that clears is filed by the clerk in that compile, in row order, admitted line by line; a row that does not clear is left to the Keeper as today. `guard_unlock` (SL-38) remains the special case that also stages the move.

## Scope
1. Contract: §135.30 addendum (new subsection): the ask feature's rows are independent questions; selection is the set that clears; the compile row records `ask_cleared: [...]`.
2. `runtime/jev/compile-rows.ts` / `route-compile.ts`: the ask question becomes per-row (one Jev call with per-row probabilities is fine if the port supports it; otherwise a batch of rows); the clerk files each cleared clue.
3. Tests, mutation-killable: the t1 accept sentence on the Haunting fixture files both the leads and the keys clue (and the move); a sentence that names one clue files one; a row under the gate stays the Keeper's. Then the replay of gate #6 t1 (recorded Keeper, live Jev) reporting the receipts.

## Comments
