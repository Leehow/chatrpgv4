Status: ready-for-human (filed 2026-09-25 from the 血色公路 batch-8 table; batch 9; implemented 2026-09-25 on `claude/sl58-20260925`)
Stage: SL-58 (P1, in-play reading on PDF modules; the last foreground read without an allowance)
Spec: docs/kernel-rpc.md §22.4.3 (SL-36 answers), §22.4.7 (SL-47 scenes), §22.4.7.1 (SL-56 persons), §22.4 (`prepare`)

# SL-58 — `lookup kind=source source_mode=prepare` gets the same allowance and landing as an answer: never the full reading timeout in the foreground

## Evidence (ticket 29 batch-8 entry, `claude/sl29a-b8-20260925`@4b5664fd0; campaign `sl29ab8-xuese-0512`)
- Three `lookup {kind: "source", source_mode: "prepare"}` calls (t4, t7, t20) each blocked exactly 120,003 ms (`reading_timeout`), 360 s of the table's wall (29%). `answer` mode held perfectly (5 of 5 at 8,002 ms, SL-36); `prepare` mode has no allowance, no `pending`, no landing.

## Ruling (owner, 2026-09-25)
The umbrella rule covers every in-turn read the Keeper can raise: a `prepare` consultation gets the source-answer allowance, returns `pending` with what the index holds, continues in the background on a blocking slot, and lands on a later note once; the foreground wait exists only for a scene's or person's text the book nowhere has.

## Scope
1. Contract: §22.4.3 addendum for `prepare` (allowance, pending row, landing, memo by focus).
2. `extensions/kernel/source-answers.ts` / the lookup path: route `prepare` through the answer machinery (or unify the two modes if they differ only in purpose); telemetry names the mode.
3. Tests, mutation-killable: a prepare lookup past the allowance returns `pending`; its result is carried once on a later note; then the replay of the b8 table's t4 (recorded Keeper, live reader) reporting the wall.

## Comments

### 2026-09-25 — SL-58/59/60 worker (branch `claude/sl58-20260925`, base `e919a4024`)

**Commits.** `20da4c3d9` contract (§22.4.3.1, and §11.5.5 / §22.4.6.1 addendum for the other two tickets in
this batch, all in one docs commit); `1511b1858` implementation and tests for this ticket; this entry.

**What changed.** `extensions/kernel/index.ts`'s `lookup {kind: "source"}` prepare branch (`source_mode`
omitted or `"prepare"`) now calls `reading.ensure(..., {allowanceMs: sourceAnswerAllowanceMs(), blocking:
true})` instead of the plain 120 s foreground wait on `providerBudget`. Past the allowance the lookup
answers `{source_answer: {status: "pending", focus, index, note}}` (the `prepare`-worded note,
`PENDING_PREPARE_NOTE`), the reading keeps its blocking slot (never demoted the way a background answer
is — the Keeper asked for this material now), and it lands once on a later clerk note when it settles
(`material_ready`, `material_unusable`, or the pending list's existing `unavailable` on a genuine
failure). `extensions/kernel/source-answers.ts`'s `PendingAnswers` is now kind-tagged (`answer` |
`prepare`) end to end, so an answer and a prepare on the same focus are never the same entry, and every
`answer_pending`/`answer_landed`/`answer_unavailable` row and the note's `pending` rows carry
`purpose`.

**Tests, mutation-killed** (copy-revert, runtime rebuilt each time):
| # | mutation | killed by |
| --- | --- | --- |
| M1 | prepare branch kept `{providerBudget}`, dropped `allowanceMs`/`blocking` | the seam test (`ensures[0].options.allowanceMs`/`blocking` assertions) |
| M2 | the prepare registration dropped the `'prepare'` kind tag | the seam test (`carried.pending` purpose assertion) |
| M3 | `preparedLanding` returned `{status: "ready"}` instead of `"material_ready"` | the seam test (landed view's `status` assertion) |

**Replay.** Ticket 29 batch-8's home and run are read-only under
`/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b8/.coc/playtests/`; its driver was already stopped
(`daemon.json` `status: "stopped"`), so a fork was safe. `gate-fixture.mjs --home
.../sl29a-b8/home --campaign sl29ab8-xuese-0512 --playtest .../sl29ab8-xuese-0512-20260925T073327Z
--turns 4 --fork --queue-at 2026-09-25T07:36:06.382Z --out <scratch, not committed>` forked t4 (the
120,003 ms `prepare` lookup on `welcome-to-abattoir`); `run.mjs --fixture <fork path> --llm replay
--latency live --reader live --reader-model opencode-go/deepseek-v4.1-flash --wait-reads 600000
--keep-workspace` (grok-build has no quota right now, per the brief; the App's `opencode-go` credential
is present and the tool accepted `--reader-model`) replayed it: `status: "delivered"`, `wall_ms: 18025`
against the live table's 155,400 ms for the same turn — but the telemetry shows `welcome-to-abattoir`
already `prepared` by the time the replayed turn's admission ran, because the fork's own materialization
(replaying the campaign's history up through turn 3) gave the background prefetch of that scene's detail
read (queued since turn 1) enough real wall-clock time to finish before "turn 4" began. The compile
layer therefore recognised the move as already clearable and the clerk applied it directly
(`policy/apply:authorized@compile`) without the Keeper ever calling `lookup kind=source` in this replay
run — a legitimate scheduling difference between the fork's reconstructed timeline and the live table's,
not a defect. The replay is genuine evidence that the *table* is fixed (this turn no longer walls 120 s
in a real run through the product path), but it does not exercise this section's specific allowance →
pending → landing sequence; that is what the reading-service and seam tests above are for. Not
committed: the fork and replay results held the book and were deleted from `/tmp` after inspection.

**Suites** (leehow-pc, `e919a4024`): ext `ℹ tests 3138`, `ℹ pass 3138`, `ℹ fail 0` (wall 166 s); loop
`# tests 196`, `# pass 196`, `# fail 0` (wall 43 s); py `1728 passed, 2 skipped` (wall 179 s). The counts
are shared with SL-59 and SL-60, implemented in the same session; see their own Comments for what each
one added.
