Status: ready-for-human (filed 2026-09-25 from the 血色公路 batch-6 table; batch 7; implemented 2026-09-25 on `claude/sl53-20260925`)
Stage: SL-54 (P2, reading priority; follows SL-45)
Spec: docs/kernel-rpc.md §22.4.6 (SL-45 displace/yield), §22.4.3 (SL-36 context generation)

# SL-54 — A displaced background read resumes, under the context at resume time, instead of failing on the old one

## Evidence (ticket 29 batch-6 entry)
- SL-45's displacement fired live for the first time: a blocking detail read displaced a background `answer` job (yield, back to `queued` with its attempt kept). When the answer job was retried, it failed outright on stale context (`source_context_changed` class: the module's generation had moved while it was parked) instead of resuming, so the consultation was lost.

## Scope
1. Contract: §22.4.6 addendum: a displaced job resumes under the generation current at resume time; if its focus's material changed meanwhile it re-reads from its saved attempt rather than failing; the `pending` row on the Keeper's note survives the displacement.
2. `kernel-ts/modules/reading.ts` (`module.read.yield` / the claim path): resume re-binds the job's `context_generation`; the SL-36 attach rule ("only within the current context generation") applies to new questions, not to a parked job.
3. Tests, mutation-killable: a displaced answer job whose module generation advanced resumes and completes; a displaced detail job likewise; the note's pending row persists across the displacement.

## Comments

### 2026-09-25 — SL-53/SL-54 worker (branch `claude/sl53-20260925`, base `95a3970c5`)

**Commits.** `26b330413` contract (§22.4.6.1, a subsection of §22.4.6 so no number moves), implementation and tests (with
SL-53); `032ddd9c4` replay tooling (`run.mjs --wait-reads <ms> --keep-workspace`); this Comments entry.

**What the evidence showed, read closely.** Two things killed `read-7`, not one. At 02:00:40 `mather-general-store`
published generation 4; the waiter behind `read-7` (t15's pending consultation) polled with its pinned `context_generation`
3 and the kernel refused it `source_context_changed`, so the pending row turned `unavailable` (`answer_unavailable`, `ms`
70,646, the same run id as `read-8`'s); then the next claim failed the queued job itself ("source context changed; request
a fresh consultation"). Fixing only the claim would still have lost the Keeper's row. `read-8` (not displaced, running when
the generation moved) was lost the same way; see "not done".

**What changed (§22.4.6.1).**
- *Claim.* The stale-consultation failure is gone. A claimed job is bound to the generation current at the claim
  (`context_generation` re-bound for an answer). A job whose last attempt (or, never claimed, whose consultation) ran under
  another generation carries `resumed {from_generation, generation, reread}`; `reread` is structural: some
  `reading.materials` row newer than `from_generation` whose `node_ids` or `focus` meet the job's focus identity (a job with
  no focus is never re-read).
- *Host.* A `reread` job does not take its retained checkpoint as a finished read: the read phase runs again with the
  retained draft as baseline, and the brief says the published material on the focus changed. The `concurrency` row of such
  a claim carries `resumed`.
- *Finish.* An accepted answer is kept under its identity at the generation it was checked at (`answerKey`), so exact hits,
  the memo and `module.source.materials.snapshot` find a re-bound answer (its own key otherwise). The in-flight rule is kept:
  an answer whose generation moved after its claim is still refused.
- *The waiter's pin.* A stale pin first follows the consultation's own job (key at the pinned generation): `queued`,
  `running` under the current generation, or `completed` (evidence checked like an exact hit) answer `queued`/`reading`/
  `ready`; anything else is §22.4.1's refusal, and nothing is written. So `settled` follows the parked job and the pending
  row stays pending across the displacement and the publication.
- *Attach* (§22.4.3) is unchanged for new questions; a parked job's generation no longer decides its fate.

**Tests.** `tests/extension/displaced-read-resumes.test.mjs` (emitted kernel; a synthetic bound book with an index and a
published opening; real reviewed publications advance the generation):
1. a displaced consultation whose generation advanced: the stale-pinned waiter follows it (`queued`, then `reading`), the
   claim re-binds it (same job, `resume_from` its attempt, `resumed {3→4, reread: false}`), it completes, the pinned waiter
   gets `ready` with its answer, an exact ask at the current generation hits, the memo and the material snapshot list it,
   and no replacement job exists;
2. a displaced detail read resumes after another focus published and publishes onto the current generation;
3. a displaced consultation on the Tower is `reread` after the Tower's detail published; a displaced detail on the Dock is not;
4. unchanged: a consultation running through a publication still fails at finish, and its pinned waiter is refused without
   a queue write;
5. the host: `reread` reads again from the retained draft (`baseline.json` is it); without it no read runs;
6. the reading service over the emitted kernel with `PendingAnswers`: three consultations go pending, a blocking detail read
   displaces the youngest and then publishes; after several polls under the old generation the youngest's row is still
   `pending` and in `take().pending`; when the other reads end it resumes (attempt 2, `resumed`), lands, and is carried once.

**Mutations** (each applied by copy, the runtime rebuilt for kernel ones, run, restored by copy; all killed):

| # | mutation | killed by |
| --- | --- | --- |
| M5 | the claim fails a stale consultation again | 1, 3, 6 |
| M6 | the claim does not re-bind `context_generation` | 1, 6 |
| M7 | finish keeps the answer under the job's own key | 1, 6 |
| M8 | a stale pin never follows | 1, 6 |
| M9 | a stale pin follows a job running under the old generation | 4 |
| M10 | `reread` always false | 3 |
| M11 | `reread` ignores `from_generation` | 2, 3 |
| M12 | the host skips the read despite `reread` | 5 |
| M13 | a stale pin does not follow a completed job | 1, 6 |
| M14 | only answers get `resumed` | 2, 3 |

Existing suites that pin the old behaviour still pass unchanged: `tests/kernel/test_source_answers.py`
(`test_changed_context_requires_a_new_answer_not_stale_acceptance`, the in-flight case), `source-answer-allowance`,
`source-answer-service`, `reading-priority`.

**Suites (leehow-pc, `032ddd9c4`).** ext: `ℹ tests 3088`, `ℹ pass 3088`, `ℹ fail 0` (wall 156 s); loop: `# tests 175`,
`# pass 175`, `# fail 0` (42 s); py: `1725 passed, 2 skipped in 247.64s (0:04:07)`.

**Replay of t17 from the batch-6 fork** (recorded Keeper `--latency live`, live admission verdicts replayed, live
`grok-build/grok-4.7-build-fast` reader, `--wait-reads 1200000 --keep-workspace`). Fixture: `gate-fixture.mjs --fork
--queue-at 2026-09-25T02:00:16.999Z --turns 17` (the fork's queue just before the displacement; not committed, it holds the
book). What it can and cannot rebuild: `read-4` and `read-6` completed after that moment and their publications are on disk,
so the fork is at generation 5 and the two blocking reads that held slots at 02:00:17 cannot be re-queued -- the displacement
itself cannot be re-enacted from this fork. `read-7` was failed by the old claim without a `finished_at`, a shape the tool
does not rewind, so it was restored by hand to exactly what `module.read.yield` had made it at 02:00:17.465 (`queued`,
`displaced: 1`, attempt 1 kept, `base_generation`/`context_generation` 3, background). `read-8`/`read-9` were queued later
and dropped (the replayed t17 raises `read-8` again); `read-5` is re-queued in the background.

| | live table | this branch, replay |
| --- | --- | --- |
| t17 wall | 28.4 s | 24.0 s, delivered (`implicit_narrate`), the recorded two lookups |
| `read-7` (t15's question, parked at generation 3) | failed at its next claim: "source context changed; request a fresh consultation" | claimed at 02:46:35 in the background, `resumed {from_generation: 3, generation: 5, reread: false}`, `context_generation` 5; round 1 read 76.2 s (pages 28, 27, 12, 9) and review 96.2 s refused `/status` `unclear` (an empty `limitations` on a book-wide negative), round 2 repair read 68.1 s and review 44.0 s; **accepted `unresolved` at 02:51:20** (4 min 45 s after the claim), kept under generation 5's key: the book names 厄尼·彼得斯 (Ernie Peters) as mayor and postmaster at the town hall/post office (3C), the plaques list no police office, a sheriff is mentioned but not named or placed |
| `read-8` (t17's question) | `answer_unavailable` `source_context_changed` after 15.5 s | pending at t17, **`answer_landed` 108.2 s later** (`answered`: the Last Stop, 3D) |

So the displaced consultation resumed under the current generation and landed a checked answer, and the turn was not held.
The pending row for `read-7` is not observable in the replay: its waiter was t15's, in the live table's process; the row's
survival is shown by test 6. The fork moved on to generation 6 at 02:53:09 when `read-5` (last-stop) published; the replay
then ended (`wait_reads` settled). The kept fork, summary, trace and telemetry are in the worker's scratchpad
(`sl54/replay-after/`), not committed. The b6 evidence was only read (the resumed attempt's `resume_from` pointed at it; the
host only reads from there, and its files' times are unchanged).

**Not done, and why.**
- **A consultation running when the generation moves is still lost** (live `read-8`: `answer_unavailable` after 15.5 s, job
  left `running`). §22.4.1 says a changed context in flight "requires a recheck"; today it is a failure. The same machinery
  would do it (on `source_context_changed` at finish, return the attempt to the queue and let the claim re-bind it, `reread`
  when the focus changed), and the waiter would follow it as here; it is a new scope, so it is not done here. Worth its own
  ticket: on a table where detail reads publish every few minutes, most background consultations will read through one.
- **The same question re-asked while its job is parked queues a second reading**: the new ask's key carries the current
  generation, the parked job's the old one, and attach considers only running jobs. Rare (the Keeper is told not to re-ask
  a pending lookup), not fixed.
- **Tooling:** `gate-fixture.mjs --queue-at` cannot rewind a job the old claim failed (no `finished_at`); a fork's new job ids
  reuse ids whose `work/<id>/attempt-1` directories already exist, so the new job's first attempt is numbered 2 (harmless).

