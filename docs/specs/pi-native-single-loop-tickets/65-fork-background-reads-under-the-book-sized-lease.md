Status: ready (filed 2026-09-25 from the 血色公路 batch-10 table; batch 10)
Stage: SL-65 (P2, in-play reading lease; follows SL-41/SL-53)
Spec: docs/kernel-rpc.md §20 addenda 2/3/5 (SL-35, SL-41, SL-53), `runtime/jev/reading-stage-budget.ts`

# SL-65 — Reads raised in a campaign's private module fork run under the book-sized lease, like every other read

## Evidence (ticket 29 batch-10 entry, `d6a188ae8`; fork `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b10/.coc/playtests/sl29a-b10/home/.coc/module-campaigns/sl29ab10-xuese-2036/modules/book-1/deepen-queue.json`)
- Five `budget_input_tokens` refusals across three background jobs of the campaign's fork: `read-1` (purpose `index`) refused twice after 268 s and 248 s, `read-2` and `read-4` (detail) once and twice; the fork never advanced past generation 2. Batch 9 on the previous build had zero refusals on the same book, so either the fork's jobs take a different lease path than the library module's (SL-53 sized `index`/`skeleton` at the library home) or the measured per-page cost the lease derives from is missing in the fork.

## Scope
1. Find which lease the fork's jobs actually got (`stage_budget` telemetry rows for read-1/2/4; if absent, that is the finding) and why it differs from batch 9.
2. Contract: §20 addendum: a campaign fork's reads are sized from the same book like the library's.
3. Fix at the reading service / `runtime/tasks.ts` where the fork's jobs get their lease; tests, mutation-killable, on the stage-budget fixture with a fork; then a replay of the b10 fork's `read-1` under the sized lease.

## Comments
