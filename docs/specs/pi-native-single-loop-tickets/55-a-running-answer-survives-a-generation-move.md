Status: ready-for-human (filed 2026-09-25 from SL-54's replay; next batch; implemented 2026-09-25 on `claude/sl53-20260925`)
Stage: SL-55 (P2, in-play reading; follows SL-36/SL-54)
Spec: docs/kernel-rpc.md §22.4.3 (SL-36 context generation), §22.4.6.1 (SL-54 resume)

# SL-55 — An answer still running when the module's generation moves finishes under the new generation instead of being lost

## Evidence (ticket 54's Comments; 血色公路 batch-6 table, `read-8`)
- SL-54 made a parked job resume under the generation current at its claim. A job that is running when a publication moves the generation still fails at finish (`source_context_changed` class): on the batch-6 table t17's own question (`read-8`) went `unavailable` after 15.5 s for that reason, while in the SL-54 replay (no publication mid-flight) it landed 108 s later. On a live table most background answers run across a publication.

## Ruling (owner, 2026-09-25)
A running answer is checked against the generation current at its finish: if no reading published since its start touched its focus, it lands as is (stored under the new generation); if one did, it re-reads from its draft once, like a resumed job (SL-54's `reread`). The pending row survives either way.

## Scope
1. Contract: §22.4.6.1 addendum for the running case.
2. `kernel-ts/modules/reading.ts` finish path: the generation check becomes the touched-focus check; the re-read reuses SL-54's path.
3. Tests, mutation-killable: an answer running across an unrelated publication lands; across a publication touching its focus it re-reads once and lands; the pending row persists. Also: re-asking a question while its job is parked attaches instead of queueing a second reading (SL-54's noted gap).

## Comments

### 2026-09-25 — SL-55 worker (branch `claude/sl53-20260925`, merged `claude/integ-single-loop-20260923`@9d8b39a8b by fast-forward)

**Commits.** `171cf5f8c` contract (§22.4.6.1 addendum, no renumbering; the old "Unchanged" paragraph kept and marked
superseded), implementation and tests; this Comments entry.

**What changed.**
- *Finish* (`kernel-ts/modules/reading.ts`): an answer whose attempt began under another generation is checked for a touched
  focus with SL-54's structural test, now one helper (`focusTouched`) shared with the claim's `reread`. Untouched: it lands
  under the current generation, gates unchanged, `finished_under {from_generation, generation}` on the job. Touched: the finish
  returns `{state: "queued", requeued: "focus_changed", from_generation, generation}`, the job goes back to the queue with its
  attempt (`focus_rereads` counted, lease released, like a yield), and its next claim is SL-54's `resumed {…, reread: true}`,
  so the host reads again from the retained draft. `ANSWER_FOCUS_REREADS` (named default 1): a second touch refuses
  `source_context_changed` as before. The host writes a `requeued` row.
- *The waiter*: a stale pin follows the question's latest job (same normalised focus and question, whatever generation it
  was queued under) while queued, running under any generation, or completed at or after the pin; only a failed or cancelled
  job, or one completed before the pin, is refused. This is what lost live `read-8` after 15.5 s: the poll, not the finish.
- *Re-ask*: the same question asked again while its job is parked or reading under an older generation attaches to it
  (`attached: true`; a foreground ask promotes it); a new question keeps §22.4.3's rule.

**Tests.** `tests/extension/running-answer-generation-move.test.mjs` (emitted kernel, the synthetic harbor book shared with
SL-54 through `tests/extension/harbor-book.mjs`):
1. an answer reading across a publication of another focus: the pinned waiter follows it (`reading`), it lands under the new
   generation (`finished_under`), the pinned waiter then gets `ready`, the exact ask hits, the material snapshot lists it;
2. across a publication touching its focus (a Dock reading that publishes Lena, while a consultation on Lena reads): sent back
   (`requeued`), the waiter follows it (`queued`), re-claimed `reread` from its attempt, lands, one job throughout; a second
   touch during the re-read refuses;
3. the same question re-asked while parked, and while reading under an older generation, attaches (and a foreground ask
   promotes); a new question on the focus queues its own reading;
4. a waiter pinned at a generation never gets that question's answer checked under an earlier one;
5. the reading service over the emitted kernel with `PendingAnswers`: the consultation's focus is published while it reads;
   the row stays pending through the `requeued` row, the second attempt reads again, and the answer lands once.
SL-54's "running through a publication still fails" test is removed (superseded); `tests/kernel/test_source_answers.py`'s
changed-context test is amended to the untouched landing (the waiter following, the answer at the new generation).

**Mutations** (copy, rebuild for kernel ones, run the SL-55 and SL-54 files, restore by copy; all killed):

| # | mutation | killed by |
| --- | --- | --- |
| N1 | finish refuses any generation move (the old rule) | 1, 2, 5 |
| N2 | never touched | 2, 5 |
| N3 | always touched | 1 |
| N4 | no limit on re-reads | 2 (second touch) |
| N5 | no re-read at all (refuse on the first touch) | 2, 5 |
| N6 | the waiter does not follow a job running under the old generation | 1 |
| N7 | the same question re-asked does not attach | 3 |
| N8 | a foreground re-ask does not promote | 3 |
| N9 | an untouched landing keeps the old `context_generation` | 1 |
| N10 | the host drops the `requeued` row | 5 |
| N11 | the waiter follows a completion older than its pin | 4 (added after N11 survived the first loop) |

**Suites (leehow-pc, `171cf5f8c`).** ext: `ℹ tests 3092`, `ℹ pass 3092`, `ℹ fail 0` (wall 157 s); loop: `# tests 175`,
`# pass 175`, `# fail 0` (42 s); py: `1725 passed, 2 skipped in 177.14s (0:02:57)`.

**Replay of t17 from the batch-6 fork with a publication landing mid-flight** (recorded Keeper `--latency live`, live
`grok-build/grok-4.7-build-fast` reader, `--wait-reads 1200000 --keep-workspace`). The fixture tooling cannot re-enact the
table's own mid-flight publication (`read-6` completed after the fixture moment and its record is on disk), so one was
staged: SL-54's fixture (queue at 02:00:16.999, `read-7` parked as the displacement left it) with `read-5` (last-stop, left
`running` by the table) given a resumable attempt -- the checkpointed draft of `read-5` that SL-54's replay itself read on
this book -- so its claim resumes review-only and publishes about a minute in, while t17's consultation reads. Nothing of
the b6 evidence was changed.

| | live table | this branch, replay |
| --- | --- | --- |
| t17 wall | 28.4 s | 24.2 s, delivered (`implicit_narrate`) |
| the publication | `mather-general-store` at 02:00:40 (generation 4) | `read-5` (last-stop) at 03:09:12 (generation 5 → 6) |
| `read-8` (t17's question) | `answer_unavailable` `source_context_changed` after 15.5 s | claimed 03:08:21 at generation 5; read done 03:09:31, after the publication; **landed at 03:10:21 with `finished_under {from_generation: 5, generation: 6}`**, `answer_landed` 112.2 s after pending (`answered`, the Last Stop, 3D); untouched (its focus names no node), so no re-read |
| `read-7` (parked t15 question) | failed at its claim (SL-54) | re-claimed under generation 5 (SL-54), read through the same publication; **failed, but on its review**: `answer_review_refused` `/status` `unclear` in both rounds (the same reviewer objection as round 1 of SL-54's replay, where round 2 passed); not the generation |

So the live `read-8` loss does not recur: a consultation reading through a publication lands. The touched path (re-read once)
did not occur on this book in the replay (the table's consultations name places and people no reading published); it is
covered by tests 2 and 5. The kept fork, summary, trace and telemetry are in the worker's scratchpad (`sl55/replay/`), not
committed.

**Not done / notes.**
- The touched path was not exercised live (see above).
- `read-7`'s review refusal is the reviewer disagreeing with an empty `limitations` on a book-wide negative; it varies run to
  run (SL-54's replay passed on round 2). Not a generation issue; not touched here.
- A waiter attached (§22.4.3) to *another* question's running job is still refused when the generation moves, as test 4
  shows: it follows its own question, and that question has no live job. Rare; noted, not changed.

