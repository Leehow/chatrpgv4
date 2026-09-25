Status: ready (filed 2026-09-25 from the 血色公路 batch-6 table; batch 7)
Stage: SL-53 (P2, reading lease; follows SL-35/SL-41)
Spec: docs/kernel-rpc.md §20 addendum 2/3 (SL-35, SL-41), `runtime/jev/reading-stage-budget.ts`

# SL-53 — The background index job runs under the book-sized lease too

## Evidence (ticket 29 batch-6 entry, `claude/sl29a-b6-20260925`@df8914aa1)
- The background `index` job (purpose `index`) is not covered by SL-41's stage shares (`detail`, `answer`, `map`) and ran under the old fixed lease: it hit the 1,000,000 input-token ceiling once (`budget_input_tokens`), self-recovered on a later attempt, and cost about 247 s extra on the table.

## Scope
1. `READING_STAGE_BUDGET` gains the `index` (and, if distinct, `skeleton`) share; `runtime/tasks.ts` sizes the index job's lease from the book like the others.
2. Test, mutation-killable, on the stage-budget fixture: an index job on a 111-page book gets the floor lease, on 669 pages the scaled one.

## Comments
