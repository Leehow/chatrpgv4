Status: ready-for-human (filed 2026-09-24 from long gate #3; batch 4; implemented 2026-09-24 on claude/sl36-20260924)
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

### 2026-09-24 — SL-36 worker (branch `claude/sl36-20260924`, base `1660ec0fd`)

**Commits.** `2a489b8d5` contract (§22.4.3, §22.4.4, §135.31.2, §47 amended); `99256e2c6` implementation and tests;
`c0bcbb100` fix (no attach across a context generation; system-language comments; two fixtures read past the memo);
`eadd15e4e` contract follow-up for that fix; `1f64bbefb` replay tooling (`--reader live`, `--wait-answer`, per-turn walls).

**Finding: t10 was a refusal, not a reviewer slip.** `work/read-1/attempt-1/review.json` in the fork is well-formed: four
entries, each with a verdict, a reason and viewed pages. Three are `contradicted`: the answer said the rats ate the
*spoiled* produce, page 8 says the produce that had *not* spoiled; the repair round kept the clause. The gate's one message
("must support each assigned field with a reason") covered both a missing reason and a non-`supported` verdict, which is
why it read as a slip. The reviewer-slip retry the ruling asks for is built (below), but it would not have saved t10's
read: a well-formed refusal still refuses. What changes t10 is the allowance. The gate now says which it was
(`answer_review_malformed`, or `answer_review_refused` with the path and the reviewer's reason).

**Changes.**
1. Contract first: §22.4.3 (allowance, `pending`, memo, attach, focus identity widened, typed gate, the review shape in one
   import-free function), §135.31.2 (the `coc:source-answers` port; a landed answer is carried once as a `source_answer`
   view; `pending` rows), a dated note in §47.
2. Allowance: `SOURCE_ANSWER_ALLOWANCE_MS = 8000`, named in `extensions/kernel/source-answers.ts`, overridable by
   `PI_COC_SOURCE_ANSWER_ALLOWANCE_MS`. `ReadingService.ensure(..., {allowanceMs})` resolves `{state: "pending", job_id,
   index, read, settled}`; §61 demotes the job; the consultation carries no turn provider budget. The lookup returns
   `source_answer: {status: "pending", focus, index, note}`; nothing is refused and `sourceWait` is not set.
3. Memo: `module.read.request {purpose: "answer"}` answers from the fork's accepted answers whose focus meets the request's
   (newest first, at most 4, evidence integrity-checked): `{state: "ready", memo: [...]}`; the lookup returns
   `status: "memo"`. `memo: false` (sent when the Keeper passes `retry: true`) reads past it.
   **Question class, decided here:** the host never classifies question text, so the class is the Keeper's judgement:
   the memo offers the focus's answers with the questions they answered, and the Keeper takes them or sends
   `retry: true`. The exact question is always a hit. A Jev-judged class (a closed choice among the memoised questions) was
   considered and not built; say so if you want it.
4. One reading per focus: a consultation attaches to a *running* answer job on the same focus of the current context
   generation (the generation condition came from `tests/kernel/test_source_answers.py`: a job of another generation can
   never publish). Focus identity (§22.2.1) also takes the node record's `display_name`, `name`, `scene_id`, `title` and the
   book's destination names (`destination_identity`): "The Corbitt House" is `corbitt-house-ground`.
5. Reviewer: `answerReviewShapeError` (`kernel-ts/modules/answer-review-shape.ts`) runs in `submit_reading`, in
   `reviewCandidate` (a failure is `AnswerReviewShapeError`, re-asked once with the error in `failure.json`, row
   `review_retry cause: schema`) and at the gate. A gate `answer_review_malformed` does not mark the read for repair: the
   next round only re-reviews.
6. Note: the engine takes the port before each model step; a landed answer rides once, served after the session view;
   `pending` rows once per run. Telemetry `answer_pending`, `answer_landed`, `answer_unavailable`, `answer_memo`, never the
   question.

**Tests, each killed by a mutation** (copy-revert runner and record in the scratchpad: `sl36/mutate.py`,
`sl36/mutations.json`). New `tests/extension/source-answer-allowance.test.mjs` (8); `single-loop-looks-first-visit.test.mjs`
+1 seam case. Fixtures adjusted: `prescreen-source-request.test.mjs` and `tests/kernel/test_source_answers.py` pass
`memo: false` where the fixture accepts a new answer on a focus already consulted.

| mutation | killed by |
| --- | --- |
| M1 the allowance never resolves pending | allowance test; seam test |
| M2 no memo | memo test; "The Corbitt House"; attach (re-judged by the memo) |
| M3 focus identity without the book's place names | "The Corbitt House" |
| M4 no attach for answers | attach test |
| M5 the host skips the review shape | schema-retry test |
| M6 a gate slip marks the read for repair | verify-only-round test |
| M7 the gate calls a malformed review a refusal | gate test |
| M8 a landed answer is never marked carried | seam test (carried twice) |
| M9 the consultation takes the turn's provider budget | seam test (a turn budget is on the bus) |
| M10 no index rows on a reading reply | memo test |
| M11 the note never carries `pending` | both seam tests (SL-36, SL-37) |
| M12 attach across context generations | `test_changed_context_requires_a_new_answer_not_stale_acceptance` |

**Suites (leehow-pc, HEAD `1f64bbefb`).**
- ext: `ℹ tests 2997`, `ℹ pass 2994`, `ℹ fail 3`: `actual Keeper preparation overlaps NPC and material decisions and
  delivers both in one provider payload` (`npc-preparation-integration`), `root consultation completes through a child…`
  and `source-owned proof refuses an extraction version changed after semantic approval` (`jev-source-domain`). The first
  run (`99256e2c6`, box load 36) failed a different set besides my CJK comment. All of these files pass on the Mac in
  isolation, on this branch and on the base `1660ec0fd` (8/8, 5/5): timing under the shared box's load, not this change.
  The CJK comment (`system-language`) is fixed in `c0bcbb100`.
- loop: `# pass 154`, `# fail 0`.
- py: `1719 passed, 2 skipped in 258.81s`.

**Replay of gate #3 t10.** Fixture built by `gate-fixture.mjs` into the scratchpad (`sl36/fixtures/longgate36-t10`), not
committed: its tarball holds the Haunting's window PDF. Recorded Keeper with `--latency live`, live Jev, live reader,
seed 1. The App's grok-build token had expired 37 minutes earlier and the tooling does not refresh it (that would rotate
the App's login), so the reader is `opencode-go/grok-4.7`, the same model family by another route and slower than the gate's
`grok-build/grok-4.7-build-fast` (a read round of 53-295 s against 18-36 s). Both arms use the same reader.

| arm | t10 wall | lookup | what followed |
| --- | --- | --- | --- |
| live gate (grok-build reader) | 159 s | 110 s, `reading_failed` | draft dropped for `reading_wait` at 149 s; a second narrate |
| base `1660ec0fd`, replay | 136.9 s | 120.0 s, `reading_timeout` | the run budget chose compose: the Keeper's apply (time 25, clue `catholic-wards`, threat, handout) never ran; 4 of 5 baseline actions missing |
| this branch, replay 1 | 48.9 s | 8.0 s, `pending` | apply and narrate ran: 5 of 5 baseline actions matched; the next step's note carried `pending` |
| this branch, replay 2 | 50.2 s | 8.0 s, `pending` | the same; the reading went on in the background: read 53 s + review 65 s, refused; repair read 62 s + review 76 s, refused again; `answer_unavailable` at 249 s (the live t10's outcome again). t11's first model step carried `{focus: "source_answer", name: "corbitt-house-ground", view: {question, status: "unavailable", reason: "reading_failed"}}` once, beside the passages. t11 wall 12.0 s |

In replay 1 the reading had not settled when t11 began (its read round took 295 s), so t11 carried `pending` again, as it
should. Evidence (scratchpad `sl36/`): `replay-before/`, `replay-after/`, `replay-after-land/` (`run1.summary.json`,
`run1.trace.jsonl`, `run1.telemetry.jsonl`, and `run1.requests.jsonl` with every note the Keeper was sent).

**Not done / open.**
- A grok-build-reader replay needs the App signed in again.
- A landed *answered* consultation is shown at the seam test, not in a live replay: both live readings of t10's question
  were refused by a well-formed review.
- Whether one contradicted clause should refuse the whole answer (t10: one clause out of a long answer, kept by the repair
  round), rather than land as `conflict` with the clause in `limitations`, is a question for the owner and not in this ticket.
