Status: ready (filed 2026-09-24 from SL-29A on batch 4; batch 5)
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
