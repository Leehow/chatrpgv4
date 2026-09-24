Status: ready (filed 2026-09-24 from long gate #4; batch 5)
Stage: SL-43 (P2, compile routing)
Spec: docs/kernel-rpc.md §135.30.x (compile rows), §134.17 (obligation fold), §135.28 (ordinary binder)

# SL-43 — One declaration, one check: the obligation step and the ordinary binder do not both bind a check for the same act

## Evidence (long gate #4 t2, `longgate4-triage.txt`)
- "我说明来意，请他帮忙调出科比特宅这些年的旧剪报。": the compile selected `resolve:globe-clippings-access` (the obligation check, Persuade, rolled 8) and then `resolve:ordinary-check` (Persuade again, rolled 100) for the same sentence; two clerk writes at 0 ms, two rolls, and 44 s of model steps narrating both; wall 65 s with a 13 s cap wait on the Keeper's own resolve.

## Ruling (owner, 2026-09-24)
A declaration's act is settled once. When the obligation candidate covers the act feature (the approach is the attempt, SL-14), the ordinary binder binds no second check in that compile; an ordinary check is bound only for an act the obligation step did not cover.

## Scope
1. Contract: §135.30 addendum (new subsection): the obligation step consumes the act feature it settles; the ordinary binder runs on the remainder.
2. `runtime/jev/compile-rows.ts` / obligation candidates / the ordinary binder: the second selection is not made when the first covers the same act.
3. Tests, mutation-killable: the t2 sentence on the Haunting fixture selects one resolve; a sentence with an obligation approach plus a distinct act (e.g. speak then search) still selects both.

## Comments
