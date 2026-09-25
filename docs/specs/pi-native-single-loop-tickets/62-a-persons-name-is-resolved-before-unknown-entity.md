Status: ready (filed 2026-09-25 from long gate #10; batch 9)
Stage: SL-62 (P1, admission / entities; SL-51's allowed Jev question, never built)
Spec: docs/kernel-rpc.md §11.5.4 (SL-51), §22.4.7.1 (SL-56), §135.30 (compile features: addressee rows), the `unknown_entity` refusal

# SL-62 — A person's name the Keeper uses is resolved against the scene's known people before `unknown_entity`

## Evidence (long gate #10 t4, `longgate10-haunting-1345`, `longgate10-triage.txt`)
- At the Hall of Records the compile's move landed; the Keeper then wrote `look npc 档案处的办事员` and three `resolve` on that name. All refused `unknown_entity`: the starter's NPC is "the Hall of Records clerk", registered under the play-language name the lane rendered, and the Keeper's own rendering did not match. Three refusals of one class tripped the class limit and the refusal budget; the run aborted and the turn stranded (see SL-63). The addressee feature of the same turn's compile listed "the Hall of Records clerk" as a candidate: the person was known.
- SL-51's ruling allows "a Jev question for a variant spelling"; nobody built it.

## Ruling (owner, 2026-09-25)
A person named in a write or check is resolved before it is refused: exact match on handle or any registered name first (as today); then the scene's known people (present, addressee rows, the module's people of this scene) as fan-out candidates to Jev ("is this name the same person as …", per row, the SL-52 within-row margin); a clear row rewrites the call's target to that handle and the receipt records `resolved_from`; only a name that clears nothing is `unknown_entity`. No name lists in code; the candidates are the scene's rows.

## Scope
1. Contract: §11.5.4 addendum (name resolution order; the Jev question's rows; `resolved_from`).
2. Host (`extensions/kernel/index.ts`, where SL-51/56 mark `_passage`/`_land_on_text`) or the compile port: the resolution step before the kernel call; one Jev call per write at most; memoised per run by name.
3. Tests, mutation-killable: a variant name of a present NPC resolves and the check lands with `resolved_from`; a name matching nobody still refuses; the class limit is not reached on the gate #10 t4 replay (recorded Keeper, live Jev).

## Comments
