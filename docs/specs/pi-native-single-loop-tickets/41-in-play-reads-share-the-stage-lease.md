Status: ready-for-human (filed 2026-09-24 from SL-35's report; implemented 2026-09-24 on `claude/sl45-20260924` with SL-45)
Stage: SL-41 (P1, in-play reading on PDF modules; confirmed live on SL-29A batch-4 table: `budget_input_tokens` at 1,000,000 on the detail read; with SL-45)
Spec: docs/kernel-rpc.md §20 addendum 2, §98 addendum 6 (SL-35), §22

# SL-41 — Reads during play (detail, answer, map) get the same sized lease as the import stages

## Evidence (SL-35, 2026-09-24)
- SL-35 sized the import stages' provider lease from the book (`runtime/jev/reading-stage-budget.ts`, shares inspect 0 / guidance 0.5 / opening 1 / prepare 1.5) and typed the refusal. Reads raised during play (`purpose: detail`, `answer`, and the map job) still get the fixed per-child lease in `runtime/tasks.ts` (1M input tokens, 16 actions): the same Masks pattern (an image call reserves the model's whole 500K context; a call that dies in a provider error is charged the full reservation; the retry is refused) will refuse an in-play read on a large book, now with a typed reason but still refused.
- An output overrun above the per-call limit still cancels the lease; the larger limit (32,768) avoided it once, but a provider reporting output above its limit still kills the round.

## Scope
1. Contract: the in-play read purposes are stages of the same table (`detail`, `answer`, `map` shares named in `READING_STAGE_BUDGET`), sized from the book like the import stages; the refusal reasons of SL-35 apply.
2. `runtime/tasks.ts`: the per-child lease for a play read is derived from the module's page count and measured per-page cost, not the fixed default.
3. An output overrun fails the call with `budget_output_tokens` and lets the round continue with the next call, instead of cancelling the whole lease.
4. Tests, mutation-killable, on the stage-budget fixture; then one `lookup kind=source` answer on the Masks module home from SL-35's evidence.

## Comments

### 2026-09-24 — SL-41 worker (with SL-45; branch `claude/sl45-20260924`, base `c31f483dd`)

**Commits.** `0bc35493d` contract (§20 addendum 3, with SL-45's §22.4.6); `9c4f8682b` implementation and tests;
`d61316960` replay tooling; this Comments entry.

**Evidence re-read** (batch-4 table, 血色公路, 111 pages). The last-chance-bar read's four refused rounds were
`budget_input_tokens` with `used` 505,061-554,309 and `held` 0: about ten real calls use half the fixed lease and the next
image call reserves the reader's whole 500,000 context. `read-9` (a consultation) ran out of its 16 actions; `read-5` and
`read-4` lost rounds to output overruns of 8,414-12,554 against the 8,192 bound.

**Changes (contract §20 addendum 3).**
1. `READING_STAGE_BUDGET.share` gains `detail` 0.25, `answer` 0.1, `map` 0.1; `playReadStage(job)` names the stage
   (`detail`, `map` for `material: "map"`, `answer`; nothing else). `ReadingService.runJob` sizes a job without a stage
   lease once from `source.page_count` and `measuredPageCost(<the queue's module dir>)`, writes a `stage_budget` row, and
   passes the size on each reader request (`readingLease`, host-only); `runtime/tasks.ts` opens that child's lease from it
   (`openStageProviderBudget`) instead of `independentProviderBudget`. Still per child, so a refused round leaves the next
   round a fresh lease. On a 111-page book the floor decides: 4,000,000 input, 262,144 output, 64 actions, US$10, and the
   per-call output bound 32,768.
2. An overrun fails the call, not the lease: `TaskLease.reserve(..., {absorbOverrun})` charges the actual usage and, when no
   lease on the chain is left in debt, returns the typed overrun instead of cancelling; `createTaskProviderBudget` passes it
   through and `ProviderCharge.settle` returns the addendum-2 record (`budget_output_tokens`, `task_budget_overrun`,
   `overrun: true`). Every stage lease (import and play) absorbs; the Keeper's turn, the lanes and the fixed lease still
   cancel. The reader outcome carries `overruns`, the round row their count, and each writes `provider_overrun`.

**Tests, each killed by a mutation** (`sl45/mutate.py`, `sl45/mutations.json` in the scratchpad):
`reading-stage-budget.test.mjs` +3 (the shares on 111/669/5,000 pages with floor, ceiling and a measurement;
`playReadStage`; an absorbed overrun, one in debt that cancels, and a plain lease that still cancels);
`provider-refusal.test.mjs` +1 (through the real child channel: an output overrun on a stage lease is typed on the call, the
next call is dispatched, the lease stays open); new `reading-play-lease.test.mjs` (3, `runtimeCapabilities.runTask` with a
scripted child: three image calls charged whole are refused on the third without a size and all pass with the 111-page
detail size; the sized lease refuses at its own 4,000,000 after eight); the service test in `reading-priority.test.mjs`
asserts the `stage_budget` rows and that the blocking read's child carried the detail size.

| mutation | killed by |
| --- | --- |
| M11 tasks.ts ignores the play read size | reading-play-lease |
| M12 the service does not size a play read | reading-priority (service) |
| M13 detail takes the whole book | reading-stage-budget |
| M14 a stage lease never absorbs an overrun | reading-stage-budget, provider-refusal |
| M15 an overrun in debt is absorbed too | reading-stage-budget |
| M16 the stage lease is opened without absorbing | reading-stage-budget |
| M17 the reader drops the absorbed overruns | provider-refusal |
| M18 a map read is sized as a detail | reading-stage-budget |

**Suites (leehow-pc).** ext @ `9c4f8682b`: `ℹ tests 3042`, `ℹ pass 3042`, `ℹ fail 0`; loop @ `d61316960`: `# tests 166`,
`# pass 166`, `# fail 0`; py @ `d61316960`: `1725 passed, 2 skipped in 176.65s (0:02:56)`.

**Scope 4, the Masks consultation.** SL-35's Masks home (`chatrpgv4-wt-sl35/.coc/playtests/sl35-masks/home`, 669 pages,
generation 1; copied, not imported) has no campaign (its opening failed review), so the consultation was driven through the
table's `ReadingService.ensure({purpose: "answer"}, {allowanceMs: 8000})` in the library scope with a live
`grok-build/grok-4.7-build-fast` reader (low), no stage lease (script `sl45/masks-answer.mjs` in the scratchpad): `stage_budget`
answer, 669 pages, 4,000,000 input / 64 actions; claimed as blocking, `pending` at 8.0 s (the allowance), demoted; read
20.5 s (4 images, 61,768 input / 1,350 output tokens), review 16.6 s, `answered` with 4 source refs at 37.9 s; no refusal,
no overrun. Not the Keeper's `lookup kind=source` tool itself (no table exists on that book), but the same service path.

**Replay of the batch-4 table's t18** (recorded Keeper with `--latency live`, live admission verdicts replayed, live
`grok-build/grok-4.7-build-fast` reader; fixture built from the table's home by `gate-fixture.mjs --fork --queue-at
2026-09-24T17:26:58.283Z --out <scratchpad>`, i.e. the campaign's module fork with its reading queue as it stood when t18
began: `read-4` (church-lane read-ahead) and `read-6` (last-chance-bar, demoted at 17:26:51) back to `queued`
background, `read-12`/`read-13` dropped, `read-7` left completed because its publication is on disk. Not committed: the
tarball holds the book. The replay tool now also replays a call the live host refused for `reading_timeout` /
`reading_failed`, which t18's move was.) Base arm = `c31f483dd` in a scratch worktree; this branch = `d61316960`.

| arm | reader thinking | t18 wall | the move's read (`read-6`, last-chance-bar) |
| --- | --- | --- | --- |
| live table | low | 240.1 s | round refused `budget_input_tokens` (ceiling 1,000,000) twice, auto-retry `read-12` refused again, 120 s wait twice |
| base, replay | low | 141.7 s | read round refused at 114.6 s: `budget_input_tokens`, ceiling 1,000,000, used 514,744, 8 images, 13 calls -- the live signature, reproduced |
| this branch, replay | low | 141.7 s | lease 4,000,000 / 64 actions (`stage_budget` row, measured per-page 44,155 tokens, floor decides); no refusal; the round was still reading when the 120 s wait ran out |
| base, replay | off | 142.0 s | read ok in 117.6 s (535,387 used, 13 calls: under the old ceiling by one image call) |
| this branch, replay | off | 141.4 s | read ok in 98.3 s, 3 of 4 review units done when the 120 s wait ran out |

Every arm delivered the recorded prose (implicit narrate) with the move refused `needs: reading_timeout`, as SL-37 has it.
**Slot:** in every arm `read-6` was claimed at session start as a background read while two slots were free and was
already running when the move asked for it, so it was promoted in place: slot wait 0, well within the allowance. The t18
queue (two background reads) never fills the third slot, so this turn cannot exercise displacement; that path is shown by
the tests. **What t18's wall is now:** one text read (98-135 s) plus its review (20-42 s) against the 120 s foreground
wait of §22.4. SL-41 removes the refusal that turned it into two waits (240 s); SL-45 removes the queueing behind reads no
turn waits on. The read itself not fitting the wait is not in either ticket's scope; the owner may want a ticket for it.
Evidence (scratchpad, not committed): `sl45/replay-{before,after}{,-low}/run1.{summary.json,trace.jsonl,telemetry.jsonl}`,
`sl45/fixtures/b4-t18/{turn.json,baseline.json}`.

**Not done / open.** No live overrun happened in these runs, so `provider_overrun` is shown by the channel test only. Index,
skeleton, opening and guidance reads outside an import stage keep the fixed lease (not in this ticket's evidence).
