Status: ready (filed 2026-09-25 from the 血色公路 batch-11 table; batch 11)
Stage: SL-70 (P2, kernel entities; follows SL-64)
Spec: docs/kernel-rpc.md §11.5.7 (SL-64), §11.5.5 (SL-59 line-level), §87

# SL-70 — Several brand-new persons introduced in one batch all mint

## Evidence (ticket 29 batch-11 entry)
- With a non-empty roster, one `apply` batch introducing three names the campaign had never seen was refused whole, with a candidate list shaped by the existing roster. SL-64 was verified for one new name at a time; the batch case still refuses.

## Scope
1. Contract: §11.5.7 addendum: minting is per effect within a batch; each unmatched new name mints (SL-59's line-level rule applies to npc/person batches).
2. `kernel-ts/apply/entities.ts` `personOfEffect` / the batch path: evaluate each effect's candidates independently; tests, mutation-killable: three new names in one batch mint three ledger entries; a batch mixing one established and two new names resolves one and mints two; the b11 replay lands the batch.

## Comments
