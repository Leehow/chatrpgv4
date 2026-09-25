Status: ready-for-human (filed 2026-09-25 from the 血色公路 batch-6 table; batch 7; implemented 2026-09-25 on `claude/sl53-20260925`)
Stage: SL-53 (P2, reading lease; follows SL-35/SL-41)
Spec: docs/kernel-rpc.md §20 addendum 2/3 (SL-35, SL-41), `runtime/jev/reading-stage-budget.ts`

# SL-53 — The background index job runs under the book-sized lease too

## Evidence (ticket 29 batch-6 entry, `claude/sl29a-b6-20260925`@df8914aa1)
- The background `index` job (purpose `index`) is not covered by SL-41's stage shares (`detail`, `answer`, `map`) and ran under the old fixed lease: it hit the 1,000,000 input-token ceiling once (`budget_input_tokens`), self-recovered on a later attempt, and cost about 247 s extra on the table.

## Scope
1. `READING_STAGE_BUDGET` gains the `index` (and, if distinct, `skeleton`) share; `runtime/tasks.ts` sizes the index job's lease from the book like the others.
2. Test, mutation-killable, on the stage-budget fixture: an index job on a 111-page book gets the floor lease, on 669 pages the scaled one.

## Comments

### 2026-09-25 — SL-53/SL-54 worker (branch `claude/sl53-20260925`, base `95a3970c5`)

**Commits.** `26b330413` contract (§20 addendum 5, and a dated pointer in addendum 3), implementation and tests (with
SL-54); `032ddd9c4` a system-language fix in the new comment (the CJK guard caught a book title in `runtime/`) and the
SL-54 replay tooling; this Comments entry.

**What changed.** `READING_STAGE_BUDGET.share` gains `index` 0.5 and `skeleton` 0.5 (the index samples the book: batch 5's
and batch 6's index rounds viewed 21 and 32 of its 111 pages, then the map-page audit the same pages again, about half the
book's pages' worth of images). `playReadStage` is renamed `readingJobStage` and names `index` and `skeleton` beside
`detail`/`map`/`answer`; the reading service sizes any job without a stage lease that it names, writes the `stage_budget`
row, and passes the size on every reader child (`readingLease`), which `runtime/tasks.ts` already opens with
`openStageProviderBudget` (no change needed there). The skeleton is distinct: `/coc ingest` (`coc:module-ingest`) runs
`prepare` with no stage lease. On 111 pages the index lease is the floor (4,000,000 input / 262,144 output / 64 actions /
US$10: the batch-6 refusal, used 721,191 + asked 500,000, fits); on 669 pages 5,352,000 / 334,500 / 168 / US$10.035.

**Tests.** `tests/extension/reading-stage-budget.test.mjs`: the 111/669-page fixture for `index` and `skeleton`, and which
jobs are sized (the old "index is not a stage" assertions are replaced). `tests/extension/reading-priority.test.mjs`: the
reading service over the emitted kernel claims the fork's index job and its reader child carries the `index` lease (4,000,000,
111 pages, 32,768 per call) with the `stage_budget` row.

**Mutations** (each applied by copy, run, restored by copy; all killed):

| # | mutation | killed by |
| --- | --- | --- |
| M1 | `readingJobStage` drops `index` | which-jobs test; the service's index-lease test |
| M2 | `share.index` 0.1 (669 pages falls to the floor) | the 111/669 test (and the share table) |
| M3 | `share.index` 3 (111 pages leaves the floor) | the 111/669 test (and the share table) |
| M4 | the reading service sizes every job but the index | the service's index-lease test only |

**Suites (leehow-pc, `032ddd9c4`).** ext: `ℹ tests 3088`, `ℹ pass 3088`, `ℹ fail 0` (wall 156 s); loop: `# tests 175`,
`# pass 175`, `# fail 0` (42 s); py: `1725 passed, 2 skipped in 247.64s (0:04:07)`. (A first ext run at `26b330413` had
one failure, the system-language guard on the comment above; fixed in `032ddd9c4`.)

**Not done / left as is.** `opening` and `guidance` jobs outside a stage lease (the same `/coc ingest` path) still take the
fixed lease: the ticket named index and skeleton only, and the contract says so. The index's live cost under the new lease
was not re-measured on a table (no PDF was imported; the replay below ran on a fork whose index was complete).

