Status: ready-for-human (filed 2026-09-24 from SL-29A on batch 4; batch 5; implemented 2026-09-24 on `claude/sl45-20260924`)
Stage: SL-45 (P1, in-play reading; with SL-41)
Spec: docs/kernel-rpc.md §22.4, §22.4.3 (SL-36), reading concurrency

# SL-45 — Background answer reads do not hold a foreground reading slot; the blocking text read goes first

## Evidence (SL-29A on `a1bdf7004`, campaign `sl29ab4-xuese-2401`, ticket 29's batch-4 entry, `claude/sl29a-b4-20260924`@4c2802421)
- After SL-36, `answer` reads past their 8 s allowance continue in the background, but each keeps one of the foreground reading slots (`concurrency` capacity 3) for 300–400 s. A `detail` read that genuinely blocks the turn (§22.4, the scene's text) then waits behind them: t17 147 s, t18 240 s, t20 149 s. No sub-location discovered in play (the Esso station, Mather's store, the bar) was ever entered in 20 turns because its detail read never got a slot in time.
- When the detail read finally ran it hit the fixed in-play lease (`budget_input_tokens`, ceiling 1,000,000; SL-41).

## Ruling (owner, 2026-09-24)
Reading capacity is for the turn: a read that holds a turn (text detail) takes precedence over reads that do not (answers past their allowance, maps, prefetch); background reads yield a slot to a blocking read and never occupy the last one.

## Scope
1. Contract: §22.4 addendum on reading priority (blocking first; background never takes the last slot; a background read is paused or displaced, not cancelled).
2. `kernel-ts/modules/reading.ts` (the concurrency/`review_concurrency` gate) and the host's reading lane: two classes of slot; background jobs queued behind; the telemetry row names the class and the wait.
3. With SL-41 (same worker): in-play reads get the stage-sized lease.
4. Tests, mutation-killable: a blocking detail read arriving while three background answers hold slots gets one within the allowance; a background read never takes the last slot; then the replay of t18 from the batch-4 table (recorded Keeper, live reader) reporting the wall.

## Comments

### 2026-09-24 — SL-45 worker (branch `claude/sl45-20260924`, base `c31f483dd`)

**Commits.** `0bc35493d` contract (§22.4.6, dated note in §61; with SL-41's §20 addendum 3); `9c4f8682b` implementation and
tests (with SL-41); `d61316960` replay tooling; this Comments entry.

**What the evidence showed, read closely.** The ruling's shape is right and the code let it happen, but t17/t18's walls were
not spent waiting for a slot. §61's rule counted classes at claim time (one foreground, two background); a demotion turns a
running blocking read into a background one without giving anything back, so background reads could hold all three slots:
at 17:23:40 they were `read-4` (church-lane read-ahead), `read-9` (demoted consultation) and `read-11`. `read-6`
(last-chance-bar) became blocking at t17's move (admission ended 17:24:51.33) and was claimed 85 ms later, only because
`read-9` had failed at 17:24:16. Its `queue_wait_ms: 379415` counted from its queueing as a read-ahead at 17:18:32, which
is why the row looked like a starved blocking read. t17 and t18 then waited on the read itself, refused by the fixed lease
(SL-41, and `held: 0` in every refusal record: the confound noted in ticket 29 did not occur).

**Changes (contract §22.4.6).**
1. Two classes by the §61 flag at the moment of the decision. `READING_SLOTS` (3) per module queue. `module.read.claim`
   gives a blocking read any free slot and claims a background read only while two are free; a background read that finds
   only the last slot free stays `queued` (paused).
2. Every slot held and a blocking read waiting: the claim answers `{job_id: null, displace}` naming the claiming owner's
   background read claimed last (`claim_seq`). The host (`ReadingService`) stops that job's reader child and returns it with
   the new `module.read.yield {job_id, lease}` -> `{state: "queued", displaced}`: attempt kept, next claim resumes from it,
   never finished. A blocking read never displaces a blocking read. A yield the kernel refuses is finished `cancelled`
   (a live kernel would otherwise hold the slot forever) with a `yield_failed` row. The host's pump claims past its own
   capacity only to place a blocking read one of its requests waits on.
3. Telemetry: the kernel keeps `class_at` (ms; set at queue, promotion, demotion, yield). The `concurrency` row gains
   `class` and `slot_wait_ms`; `queue_wait_ms` stays. A displacement writes `displaced {job_id, for_job, ran_ms, displaced}`.
4. `prefetch-scheduling.test.mjs`: two existing tests asserted the old rule (a third background read claimed beside a
   running blocking one; a second blocking read refused while one runs). Amended to §22.4.6, with the §61 demotion story
   now ending in a displacement.

**Tests, each killed by a mutation** (copy-revert runner and record in the scratchpad: `sl45/mutate.py`,
`sl45/mutations.json`; the restored tree passes every file). New `tests/extension/reading-priority.test.mjs` (4: the
last-slot rule and the pause; three demoted consultations holding every slot -> `displace` names the youngest, only its
owner is told, the yield keeps the attempt and restarts `class_at`, the blocking read claims, the displaced read waits for
two free slots and resumes from its attempt; a blocking read never displaces a blocking one; the reading service over the
emitted kernel: a blocking `detail` read arriving while three background consultations hold the slots reached a reader
52-64 ms after it was asked, under `SOURCE_ANSWER_ALLOWANCE_MS`, with one consultation back in the queue and the rows
naming class, wait and displacement).

| mutation | killed by |
| --- | --- |
| M1 a background read may take the last slot | reading-priority, prefetch-scheduling |
| M2 the claim never names a read to displace | reading-priority, prefetch-scheduling |
| M3 the oldest background read is displaced | reading-priority |
| M4 a blocking read may be displaced | reading-priority, prefetch-scheduling |
| M5 a yield fails the job | reading-priority, prefetch-scheduling |
| M6 a yield drops the attempt | reading-priority, prefetch-scheduling |
| M7 the yield does not restart the slot wait | reading-priority |
| M8 the pump never claims past its capacity | reading-priority (service) |
| M9 a displaced reading is finished instead of yielded | reading-priority (service) |
| M10 the row does not name the class | reading-priority (service) |

(M11-M18 are SL-41's, in its ticket.)

**Suites (leehow-pc).**
- ext @ `9c4f8682b`: `ℹ tests 3042`, `ℹ pass 3042`, `ℹ fail 0` (wall 282 s).
- loop @ `d61316960`: `# tests 166`, `# pass 166`, `# fail 0`.
- py @ `d61316960`: `1725 passed, 2 skipped in 176.65s (0:02:56)`.

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

**Not done / open.**
- Displacement is only ever proposed to the owner that claimed the job (a job another Pi process runs is left alone).
- A live table has not run on this build; the displacement path is proven by the tests, not yet by a turn.
- The text read plus review (about 120-180 s on this book) does not fit §22.4's 120 s foreground wait; see the replay.
