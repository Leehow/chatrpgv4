Status: ready-for-human (filed 2026-09-24 from long gate #3; batch 4; implemented 2026-09-24 on `claude/sl38-20260924`)
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

### 2026-09-24 — implemented, tested, replayed (branch `claude/sl38-20260924`, base `1660ec0fd`)

**Finding.** At gate #3 turn 1 the first compile (s2) cleared `destination` on `newspaper-morgue` (1.0), `ask` on `clue:knott-research-leads` (0.90) and `act` `investigate` (0.95). The `ask` answer had no reader: §135.30's table says a clue answer of `ask` is "something else". So nothing could stage the clue, the morgue's row was held by that same clue, and the compile reported `guarded` and fell through. The "accept" in the batch is the leads clue (the office has no commission obligation). No predicate selected it, so the batch had no staged effect for the guard to be evaluated against.

**Contract** (§135.30.5, written first). A compile's selections are one batch. The effect of a selected step unlocks a destination the same compile cleared when either:
- a new predicate `guard_unlock` fired (`ask` cleared on an issued clue row, and `destination` cleared on a row whose kernel guard names that clue, `guard.clue.clue`); or
- `obligation_check` fired on the obligation the row is `guarded_by`.

The compile does not evaluate the kernel's condition itself. It stages the move after that step (`RunView.unlocks`). The fresh read after the step is the guard's evaluation: when the kernel issues `apply:move:<to>`, the policy runs it next, with the compile's record (`basis.compile`: predicate `move`, `unlocked_by`), as §32.12.1 does for a carried step. Each write is admitted on its own compile evidence (clue by `guard_unlock`, move by `move`). That is §32.12.3's line-level admission applied to clerk writes, which stay single effects.

A guard the batch does not unlock is reported `guarded` as before. A staged move that does not happen is reported `guarded` in the next note (`missedUnlocks`): the step was refused, the fresh read did not issue the move, or the step's key was consumed without the clerk running it. `guard_unlock` never decides, and it is askable only for a clue that guards an offered destination, so no other clue becomes reachable.

**Changes.**
- `runtime/jev/route-compile.ts`: `guard_unlock`; `askable(rows, candidate)` and `fires(candidate, cleared, rows)` take the extra argument; `unlockingStep`; `unlocked` on the outcome.
- `runtime/jev/step-policy.ts`: `RunView.unlocks` and `unlockMissed`; staging in `settleCompile` (the move key also joins `compileSelected`); `settleUnlocks` in `settleExecute`; `missedUnlocks`.
- `runtime/jev/hybrid-engine.ts`: `unlocked` on the compile row; missed unlocks go into the note's `guarded`.

**Tests.** `tests/extension/single-loop-guard-unlock.test.mjs` (6):
- policy seam:
  - the gate #3 answers select the clue and stage the move;
  - the move runs from the fresh read with `basis.compile`, and `compileAdmission` admits both lines;
  - the move still falls through with `guarded` when `ask` is `none` or `unclear`, or when the declaration goes to the house, whose guard names the keys;
  - missed unlocks: the fresh read does not issue the move, the clue is refused, or the step's key is consumed;
  - an obligation guard is staged after `obligation_check`;
- emitted kernel over the haunting (turn 2 at the office, gate #3's sentence): the clerk files the leads, then moves; both admitted `path: "compile"` (`guard_unlock`, `move`, `unlocked_by`); no lane request; the compile row has `unlocked` and no `guarded` for the morgue.

**Mutations** (copy-revert by a scratch runner, never `git checkout --`). All killed:

| id | mutation | tests failed |
| --- | --- | --- |
| M1 | never unlock (`unlockingStep` → undefined) | 5 |
| M2 | move without the compile record | 2 |
| M3 | `guard_unlock` fires without checking the guard's clue | 1 |
| M4 | a missed unlock is not reported | 1 |
| M5 | the move is never staged | 4 |
| M11 | the move key is not in `compileSelected` | 1 |
| M12 | the consumed-step branch of `missedUnlocks` removed | 1 |
| M14 | `guard_unlock` decides | 2 |
| M15 | `guard_unlock` askable on any `ask` rows | 1 |

**Suites** (leehow-pc, final tree):
- `== py on leehow-pc @ 1660ec0fd7a40f0039d1e22d03da0ac0ab335c16: exit=0 wall=568s` (1721 passed, 2 skipped)
- `== loop on leehow-pc @ 1660ec0fd7a40f0039d1e22d03da0ac0ab335c16: exit=0 wall=76s` (163/163)
- `== ext on leehow-pc @ 1660ec0fd7a40f0039d1e22d03da0ac0ab335c16: exit=0 wall=251s` (2995/2995)

The box reports the base HEAD; the working tree was overlaid.

**Replay of gate #3 turn 1.** Fixture `longgate3-t1` (`gate-fixture.mjs` from `longgate3-haunting-1058`). Recorded Keeper and recorded lane, both with their live latencies (`--latency live`), live Jev, seed 1, 3 runs per arm. *Before* is the base `1660ec0fd`, run in a scratch worktree. *After* is this branch. Results: `experiments/single-loop-routing/results/sl38-longgate3-t1-{before,after}`.

| arm | compile selects | clerk writes | wall (s) | model steps |
| --- | --- | --- | --- | --- |
| before | nothing (morgue `guarded`) | 0 | 53.6, 50.1, 51.3 | 3 |
| after | `apply:clue:knott-research-leads`, morgue `unlocked` | leads clue, then move to the morgue; both `compile` at 0 ms, 3/3 | 53.4, 50.6, 51.3 | 3 |

(The live table took 73 s.) **The compile now selects accept+move, 3 of 3.** The wall does not change under the recorded Keeper: it replays all three recorded messages at their live latencies either way. The replay cannot show a saving that needs a Keeper who writes less.

**Finding for the owner (not fixed here; it is outside this ticket).** In the after arm, the recorded Keeper's first batch (the keys clue, the $20, the key item, the handout, minus what the clerk did) was refused `not_here` in 3 of 3 runs. The clerk had already moved the party to the morgue, and the kernel refuses a clue of a scene the party has left. So the rest of the "accept" (keys, advance, key, handout) did not land in the after arm, where it landed in the before arm. This is not new with SL-38: any compile-selected move runs before the Keeper's step, so bookkeeping the declaration does in the scene it leaves can no longer be filed there. Gate #3 turn 1 is the first case where the same sentence carried both. A live Keeper sees `clerk_did` (at the morgue) and might narrate the hand-over without the writes. The keys clue would still be missing, and it guards the house. Options for the owner, none decided:
1. run a staged or compile-selected move after the run's first Keeper step when the declaration also cleared bookkeeping of the current scene;
2. let the kernel accept, within the same turn, the clues and handouts of the scene the party just left;
3. leave it as is.

