Status: ready (filed 2026-09-25 from the 血色公路 batch-9 table; batch 10)
Stage: SL-64 (P1, kernel entities; predates batch 9)
Spec: docs/kernel-rpc.md §87 (table persons), §11.5.4/§11.5.6 (SL-51/SL-62 name resolution), the `unknown_entity` refusal

# SL-64 — A campaign mints as many table persons as the Keeper introduces; existing table persons are resolution candidates, never a bar to minting

## Evidence (ticket 29 batch-9 entry, `claude/sl29a-b9-20260925`@017aaa4a5; campaign `sl29ab9-xuese-1922`)
- Once one Keeper-introduced (table) person exists, `kernel-ts/read/module-graph.ts` `candidates()` appends every existing table person to the candidate list of any npc-kind name, and `kernel-ts/apply/entities.ts` `personOfEffect` then refuses `unknown_entity` instead of minting a second table person. Reproduced five times on one table (t11, t14, t15, t17, t18); `npc-ledger.json` holds exactly one table person here and in the batch-8 campaign: the defect predates batch 9 and only surfaced because this Keeper names more people.

## Ruling (owner, 2026-09-25)
The table persons a campaign already holds are candidates for resolving a name (SL-62's question), never a reason to refuse a new one: when the name clears no candidate, a new table person is minted (§87) exactly as the first one was.

## Scope
1. Contract: §87 addendum (minting is not limited by the count of existing table persons; existing ones are SL-62 candidates only).
2. `kernel-ts/read/module-graph.ts` `candidates()` / `kernel-ts/apply/entities.ts` `personOfEffect`: an unmatched npc-kind name with existing table persons mints; a name that clears an existing candidate (exact, or SL-62's Jev question on the host) resolves to it.
3. Tests, mutation-killable: two distinct Keeper-introduced persons in one campaign both mint with two ledger entries; the same person named twice resolves to one; the batch-9 t11 replay mints.

## Comments
