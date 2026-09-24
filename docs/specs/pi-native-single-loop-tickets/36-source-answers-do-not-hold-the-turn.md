Status: ready (filed 2026-09-24 from long gate #3; batch 4)
Stage: SL-36 (P1, in-turn reading; the wall of five turns at long gate #3)
Spec: docs/kernel-rpc.md §22 (source answers), §22.3.1, §135.31.1; docs/specs/pi-native-single-loop.md ruling "Reading never holds a turn"

# SL-36 — An in-turn source answer is asynchronous past a short allowance, memoised per campaign, and a reviewer's malformed output is retried, not a refusal

## Evidence (long gate #3, 2026-09-24, integration `37c7a311e`, campaign `longgate3-haunting-1058`; `longgate3-triage.txt`, `longgate3-evidence.txt`, fork `.coc/module-campaigns/longgate3-haunting-1058/modules/the-haunting/deepen-queue.json`)
- Five `lookup kind=source source_mode=answer` calls on the built-in Haunting window (SL-28): t10 110 s (failed), t11 51 s, t13 64 s, t14 42 s, t15 56 s. Each is a read of 18–45 s plus a review of 18–29 s, serial, in the foreground of the turn. The five turns walled 159, 78, 89, 63, 73 s; the other fifteen had median 33 s. The whole table's over-60 s count went from 1/20 (gate #2, no window) to 8/20.
- t10's answer ("What rooms and contents are on the ground floor…") was refused after four reading rounds (36, 28, 26, 18 s, all `ok: true`) with `the independent answer review must support each assigned field with a reason`: the reviewer's own output was malformed, and the read was thrown away (`reading_failed`), the Keeper's draft dropped for `reading_wait`, and the player waited 159 s. The same focus was read again at t15 (56 s) with a different question.
- t11 `upper-floor-bedroom` and t13 `upper floor bedroom`: the same scene, both read fresh (the cache key is focus+question exact).

## Ruling (owner, 2026-09-24; spec Rulings)
Reading never holds a turn. A source answer gets a short foreground allowance; past it the turn goes on with what is already known (the carried passages, the index) and the clerk's note carries `pending`; the answer lands on the next turn's note. A completed answer is memoised for the campaign by normalised focus and question class. A reviewer whose own output fails its schema is retried as a reviewer, not counted against the read.

## Scope
1. Contract first: §22 amendment for the answer purpose (allowance, `pending` in the clerk note, next-turn delivery, memo, reviewer-slip retry; the allowance is a named default in rules, not a literal in code); §135.31.1 addendum: a pending answer, when it lands, rides in the carried views once.
2. `kernel-ts/modules/reading.ts` answer path: the foreground wait is bounded by the allowance; a job past it stays running in the background; `lookup` returns `pending` with what the index/passages hold, and the next `table.open`/turn folds the completed answer into the carried note. One live job per normalised focus; a second question on a running focus attaches.
3. The answer reviewer (`extensions/module`, source answer protocol): a review whose output does not satisfy the protocol is re-asked once with the schema error; only a well-formed refusal refuses the read. (Same class as SL-33 and the "reviewer slip" memory: the review must never cost the read.)
4. Memo: completed answers are kept in the campaign fork keyed by normalised focus (scene handle or its display name) and the question's class; a repeat question on a memoised focus answers from the memo and says so.
5. Tests, mutation-killable, on the Haunting window: allowance expiry returns `pending` and the next turn carries the answer; a malformed reviewer output is retried and the read survives; a memo hit costs no read; the extension-seam test of §135.31.1 (`single-loop-looks-first-visit.test.mjs`) extended with the pending-then-carried case. Then the replay of gate #3's t10 (recorded Keeper, live reader) reporting the turn's wall.

## Comments
