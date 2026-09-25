Status: ready (filed 2026-09-25 from the 血色公路 batch-10 table; batch 10)
Stage: SL-67 (P2, admission / entities; follows SL-62 and SL-64)
Spec: docs/kernel-rpc.md §11.5.6 (SL-62), §11.5.7 (SL-64), §87 (table persons)

# SL-67 — A shortened name of a person the campaign already holds resolves to them, wherever the party is

## Evidence (ticket 29 batch-10 entry: t14)
- Three shortened names (拉斯 / 内特 / 史蒂夫, the surnames dropped) of three persons the campaign had established at t1 (拉斯·威廉姆斯 / 内特·帕特森 / 史蒂夫·布朗, `from_passage`) were refused `unknown_entity` instead of resolving. SL-62's candidates are the scene's present people; these three were established but not present in the scene the party had moved to, so no candidate row was asked.

## Ruling (owner, 2026-09-25)
SL-62's candidate rows include every person the campaign holds (the module's people of the scene, the present, and the campaign's established table persons and `from_passage` persons), asked with the same per-row Jev question; presence decides what the check can target, not whether the name resolves.

## Scope
1. Contract: §11.5.6 addendum (the candidate set).
2. Host (`extensions/kernel/index.ts` / `runtime/jev/person-resolution-domain.ts`): candidates from the campaign's roster as well as the scene; the receipt's `resolved_from` unchanged.
3. Tests, mutation-killable: a shortened name of an established person resolves when the party is elsewhere; an unknown name still refuses; the b10 t14 replay lands the batch.

## Comments
