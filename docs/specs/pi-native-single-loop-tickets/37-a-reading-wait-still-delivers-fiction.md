Status: ready-for-human (filed 2026-09-24 from SL-29A and long gate #3; batch 4; implemented 2026-09-24 on claude/sl36-20260924)
Stage: SL-37 (P1, delivery)
Spec: docs/kernel-rpc.md §22.4, §135.11 (turn close), §47 (host state never reaches prose)

# SL-37 — A turn whose only action waits on reading still delivers fiction

## Evidence
- SL-29A 血色公路: on t4, t8, t15 and t20 the Keeper's draft was dropped with `reading_wait` and the player read only the host notice ("本桌需要的一段原文还在读取…随便说句话就能继续") after 2–3 min; a player who declared a drive got neither the drive nor anything else, four times. On t7 the lane reviewer's timeout reached the prose as "服务暂时没接上，你下一条再开过去就行" (host state in fiction).
- Long gate #3 t10: the Keeper's first draft was dropped with `reading_wait` at 149 s; the turn delivered at 159 s only because the Keeper narrated again after the failed lookup.

## Scope
1. Contract: §22.4 amendment. When a turn's pending action is a read, the host does not drop the Keeper's draft; the Keeper narrates the approach (what the investigator does while the answer is not yet there) and the clerk's note carries the pending read; the host notice is the fallback only when no draft exists. With SL-34 and SL-36 the pending case shrinks to text material of a scene not yet read.
2. §47: a lane/reviewer timeout or a reading failure never reaches the prose; the Keeper's guidance names it as the clerk's business.
3. Tests, mutation-killable, at the extension seam: a pending text read with a draft delivers the draft and the note; no draft delivers the notice; a lane timeout's message does not appear in the delivered text (assert on structure: the drop reason and the delivered receipt, not on the notice's wording).

## Comments

### 2026-09-24 — SL-37 worker (with SL-36; branch `claude/sl36-20260924`, base `1660ec0fd`)

**Commits.** `2a489b8d5` contract (§22.4.4, and the dated note in §47); `99256e2c6` implementation and tests; `c0bcbb100`
system-language fix to two new comments. The replay evidence and the suite lines are in SL-36's Comments (same branch, same
runs).

**Changes.**
1. Contract: §22.4.4. With SL-36 an in-turn consultation never produces a wait at all (it answers `pending`, a success), so
   the case left is a text read: a `detail` lookup or a `material_pending` read that timed out or failed (`sourceWait`).
2. The draft is kept (`extensions/kernel/index.ts`, `message_end`): the `reading_wait` drop and its one steer are gone; the
   draft closes by the implicit narrate like any prose (still carrying `preparation_wait {kind: "source"}` for §37.3), and
   the decision is a row, `lane: "delivery", reason: "reading_wait_draft_kept"`. The floor, speech and pending-choice
   steers are unchanged.
3. The note carries the pending read: the `coc:source-answers` port adds the table's `sourceWait` as a `pending` row
   (`purpose: "detail"`) while the reading service's `reading()` says it is still in flight.
4. The notice is the fallback when there is no draft: beside a delivered draft the §47 source-wait notice is withheld and
   recorded (`preparation_wait_notice_withheld`, `cause: "draft_delivered"`); a run that ends with nothing delivered while a
   source read is in flight gets the source-wait notice instead of §38's generic one, re-read first; a read no longer in
   flight falls back to the generic notice (`fallback: "no_draft"` on both rows). The adaptation wait is unchanged.
5. §47, lane and reader failures: the source-wait instruction and `sourceMaterialRefusal`'s fix end on a clerk's-business
   clause (the reading, its wait and its failure stay out of the fiction and the prose; narrate what the investigator does
   meanwhile). `admissionUnavailable` no longer tells the Keeper to "tell the player plainly in narrate, as a service notice"
   (the source of 血色公路 t7's line): the lane's failure is the clerk's business, the operator is told outside the game at
   streak 2, and the Keeper closes on what the player said.

**Tests, each killed by a mutation** (copy-revert runner and record in the scratchpad: `sl36/mutate.py`,
`sl36/mutations.json`). Structure only for the delivery (drop reasons, the turn record's text, notice rows and
`details.preparation_wait`); the two refusal-text checks assert that no line for the player is handed over, since the
instruction is itself text.

| mutation | killed by |
| --- | --- |
| N1 the `reading_wait` drop restored | `turn.test.mjs` §22.4.4 draft test and failure test; the hybrid seam test in `single-loop-looks-first-visit.test.mjs` |
| N2 the source notice sent beside a delivered draft | `turn.test.mjs` draft test; `host-state-not-fiction.test.mjs` (rewritten for §22.4.4) |
| N3 the no-draft fallback removed | `turn.test.mjs` "no draft at all gets the host's source-wait notice" |
| N4 a landed read still announced as pending | `turn.test.mjs` "no draft, and the read is no longer in flight" |
| N5 the admission fix tells the player again | `admission.test.mjs` "an unavailable review refuses…" (it pinned the old wording, now inverted) |
| N6 the reading refusal says the host tells them | `turn.test.mjs` "a reading failure never reaches the prose" |
| N7 the port leaves out the pending text read | the hybrid seam test (the note carries `pending`, `purpose: "detail"`) |

Also changed to the new rule: `turn.test.mjs`'s "a source-wait steer is spent once…" (the steer no longer exists) became
the §22.4.4 draft test.

**Replay.** Gate #3 t10 on this branch (SL-36's table): no `reading_wait` drop; the Keeper's own apply and narrate ran and
the turn delivered at 48.9 s and 50.2 s, where the base replay held 120 s in the lookup and lost the Keeper's bookkeeping.

**Not done.** No live 血色公路 run (another worker owns imports on this Mac, and SL-34 owns the map half of those turns).
