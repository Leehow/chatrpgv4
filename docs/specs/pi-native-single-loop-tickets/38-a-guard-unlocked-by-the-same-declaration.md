Status: ready (filed 2026-09-24 from long gate #3; batch 4)
Stage: SL-38 (P2, compile routing)
Spec: docs/kernel-rpc.md §135.30.x (compile rows), §135.25 (destination rows and guards), §134.17 (obligation fold)

# SL-38 — The compile evaluates a guard against the effects the same declaration files

## Evidence (long gate #3 t1, `longgate3-evidence.txt` section D)
- "我接。先去《环球报》剪报室…" — the first clause accepts the commission (which files `knott-research-leads`, the clue that unlocks the Globe), the second declares the move. The compile's destination feature chose `newspaper-morgue` at confidence 1, cleared, but the row was guarded (`clue_discovered: knott-research-leads`) and the compile fell through (`fell_through G`); the Keeper then did the accept, the clue, the move and the introductions in four model steps (18 + 12 + 8 + 12 s) with a 13 s `review_pending` on a resolve: 73 s. At gate #2 the same sentence compiled to the move because the clue had landed at turn 0.
- Two-clause declarations otherwise worked through the second compile step (t4, t6, t8, t9, t12, t20: move then act); this ticket is the guard case only.

## Scope
1. Contract first (§135.25/§135.30 addendum): when a declaration's earlier clause settles an obligation or files a clue by the clerk (the obligation fold, §134.17), the guard of a later clause's destination is evaluated after that effect, in the same compile; the row is selected and the batch carries both (accept then move), admitted line by line (§32.12.3).
2. `runtime/jev/compile-rows.ts` / `route-compile.ts`: guard evaluation takes the batch's own staged effects into account; nothing else changes about guards (a guard not unlocked by the batch still reports as today).
3. Tests, mutation-killable: the accept+move sentence on the Haunting fixture selects both; a move whose guard is not unlocked by the batch still falls through with the guard reported; the replay of gate #3 t1 (recorded Keeper) reports the wall.

## Comments
