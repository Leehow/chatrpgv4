Status: ready-for-human (fixed 2026-09-25, branch claude/sl65-20260925)
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

### 2026-09-25 (worker, branch `claude/sl65-20260925`)

**Scope 1 finding.** The fork's jobs did NOT take a different lease path from the library's: `reading-telemetry.jsonl`
carries a `stage_budget` row for `read-1` (index) and `read-2`/`read-4` (detail) each, sized to the floor,
4,000,000 input tokens — SL-53's own fix (addendum 5), not the fixed 1,000,000 SL-53 replaced. The refusals
(`ceiling: 4,000,000`, `used: 3,019,859`-`3,174,916`, `requested: 1,000,000`, `unknown_usage_calls: 3`, each `after
the provider error "Request timed out."`) show three consecutive image calls that ended without usage, each
charged their whole reservation, leaving no room for a fourth. The floor's own derivation (§20 addendum 2 item 1)
is "eight whole-context reservations of a reader whose window is 500,000 tokens" — but every failed call here
asked for 1,000,000 (an image call reserves the reader's own whole context window,
`runtime/jev/provider-budget.ts`'s `multimodal` branch), so this table's reader has a 1,000,000-token window: eight
reservations of 500,000 is only four of 1,000,000, and three failures plus one more request is the fifth. Batch 9
had none of this on the same book; the sizing did not differ (same `readingStageBudget` call, same floor), the
reader did.

**Fix.** `readingStageBudget(stage, {pageCount, perPage?, contextWindow?})` gains `contextWindow`; the input-token
floor becomes `max(4,000,000, 8 × contextWindow)`, never lower than the fixed default. `extensions/module/reading-service.ts`
threads it through from the same `model()` deps callback it already calls for `vision`; `extensions/module/index.ts`'s
`model()` now also reports `contextWindow`, read off `ctx.modelRegistry`. Nothing here is fork-specific: the reading
service is shared between the library and every campaign fork (`extensions/module/index.ts`'s own comment), so a
library read against a reader with a bigger window is sized the same new way. Full text: docs/kernel-rpc.md §20
addendum 6.

**Tests, mutation-killed.** `tests/extension/reading-stage-budget.test.mjs` (new test reproducing the b10 numbers
exactly: `used + requested` overruns the old 4,000,000 floor, fits the new 8,000,000 one with a reservation to
spare; only `inputTokens` moves; a smaller/unknown/negative/NaN `contextWindow` never lowers the floor; the ceiling
still caps a huge book). `tests/extension/reading-priority.test.mjs` (new test: the reading service over the
emitted kernel, with `model()` reporting `contextWindow: 1_000_000`, sizes a background index job's lease and its
`stage_budget` row to 8,000,000, not 4,000,000). Mutation: reverting the floor computation to
`{...READING_STAGE_BUDGET.floor}` (dropping the `contextWindow` term) was applied by copy-revert (never `git
checkout --`), rebuilt on leehow-pc, and both new tests failed (`4000000 !== 8000000`); the file was restored
byte-identical afterward (`diff` confirmed) and the suite re-verified green.

**Replay: not run.** A live replay of the b10 fork's own `read-1` under the resized lease was not attempted. It
would need the same reader model to fail the same way (three consecutive live provider timeouts, each burning a
1,000,000-token reservation) under real network conditions — not reproducible on demand, would cost several
minutes of real provider time and cost, and would not prove anything beyond what the fixture tests above already
prove deterministically from the b10 telemetry's own recorded numbers (`ceiling`, `used`, `requested` asserted
directly against both the old and new floor). Recorded here per the marker's "if the tooling allows, else say so."

**Suites (leehow-pc).**
- `on leehow-pc @ 4ec88b7269ddb6fd8442afc2d8d0820241cbe629`: `ext` — 3169 pass, 0 fail (`wall=177s`).
- `on leehow-pc @ 4ec88b7269ddb6fd8442afc2d8d0820241cbe629`: `loop` — first run 195/196 (one pre-existing flake in
  `single-loop-turn-budget.test.mjs`, unrelated to this ticket's files); re-run 196/196 clean.
- `on leehow-pc @ 4ec88b7269ddb6fd8442afc2d8d0820241cbe629`: `py` — 1730 passed, 2 skipped (after fixing
  `tests/kernel/test_capsule.py::test_look_focus_variants` for SL-67's new `roster` field on `table.look`, see the
  SL-67 ticket's own Comments).

Not this ticket's scope: `withStageLease`/`pipicoc/onboarding-worker.ts` (the import stages' own lease) is
unchanged; addendum 6 says so explicitly.
