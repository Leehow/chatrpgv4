Status: ready-for-human (filed 2026-09-25 from the 血色公路 batch-6/7 tables; batch 8; implemented 2026-09-25 on `claude/sl56-20260925`)
Stage: SL-57 (P2, in-play reading publication; follows SL-49)
Spec: docs/kernel-rpc.md §22.3.2 (SL-49 per-field verdicts), §22 (review rounds), §107.1 (unusable settlement)

# SL-57 — A detail read refused at review is retried once on a later turn with the reviewer's reasons; a second refusal settles it as unusable

## Evidence (ticket 29 batch-6 and batch-7 entries)
- Batch 6: the church-steeple detail read was refused at review and never retried; batch 7: the same shape on another node (`read-5`, the NPC, and the scene it belongs to), and the module fork never advanced past generation 2 for the whole table. The scene or person then plays on the index text alone (SL-47/56), which is the right floor but not the ceiling: the reviewer's reasons are on disk and nobody re-reads with them.

## Scope
1. Contract: §22 addendum: a detail read whose publication is refused for an `unsupported` fact is re-queued once as background (not blocking), with the refused fields and reasons as the reader's context; a second refusal settles the focus `unusable` (SL-34's settlement shape) and is not raised again; `retry: true` from the Keeper may replace it.
2. `kernel-ts/modules/reading.ts` finish/refusal path and the queue; the Keeper's note shows the settlement once.
3. Tests, mutation-killable: a refused read is re-queued once with the reasons; a second refusal settles; the settlement is shown once.

## Comments

### 2026-09-25 — SL-56/SL-57 worker (branch `claude/sl56-20260925`, base `f62f2a13b`)

**Commits.** `d234e932a` contract (§22.3.3, a new subsection after §22.3.2; no number moves); `7c9059a4d` implementation
and tests (with SL-56); this entry.

**What changed (§22.3.3).**
- *The reasons travel.* The host's refusal record gains `refused: [{path, verdict, reason}]` from the review's
  non-`supported` rows; the kernel keeps at most `REFUSED_FIELDS` (8, named) bounded rows.
- *Once more, in the background.* `module.read.finish {outcome: "failed"}` of a `detail` job (not a map) whose refusal's
  `rule` is `review_unsupported` queues one new job of the same identity: `foreground: false`, `review_retry {of, message,
  refused}`, `resume_from` the refused attempt; the reply adds `requeued {job_id, reason: "review_refused", of}` and the host
  writes a `requeued` row. A foreground request answers the retry without promoting it (never blocking). The claim's packet
  carries `review_retry`; the host copies it into `task.json` and the read instruction (`REVIEW_RETRY_ASK`) tells the
  reader to re-read those fields' pages and write only what they state. Other refusal rules are not retried here.
- *A second refusal settles.* The retry refused the same way writes `{key, purpose: "detail", focus, question, status:
  "unusable", reason, job_id, node_ids: [], generation}` once and queues nothing. `module.read.request` answers `unusable`;
  the reading service returns that reply to its waiter (it used to poll on); the gate passes a settled focus unless it can
  still land on the book's text (a move with index pages, a person with pages or a passage), so the scene or person plays
  on the index text; `focusTouched` ignores unusable rows. `retry: true` removes the row and queues afresh; a completed
  publication of the focus removes it.
- *Told once.* A scene-readings entry whose reading resolves `unusable` settles `unusable`; its record row
  (`{status: "unusable", reason}`, `scene_record` or `person_record`) is carried once per campaign and focus, with
  `CARRIED_RECORD_UNUSABLE_HEAD`; telemetry `scene_record_unusable` / `person_record_unusable`.

**Tests** (`tests/extension/review-refused-retry.test.mjs`, new): (1) emitted kernel, in a campaign's fork: a refused
detail read is re-queued once, background, with the refused fields and reasons and `resume_from`; a foreground request
does not promote it; its claim's packet carries the reasons; the second refusal settles `unusable` and queues nothing; the
request answers `unusable`; a move into the settled scene is still refused naming its index pages and lands on them, and a
check there passes; `retry: true` replaces the row; a refusal of another rule is not re-queued. (2) the reading service
returns an `unusable` reply at once. (3) the scene-readings list carries a settlement once and not again for the same
focus (another focus is told); the note's head names it. (4) the host (`runJob` with a fake reader): the refusal it sends
carries the reviewer's rows, the `requeued` row is written, and a retry's reader gets `task.review_retry` and the
instruction.

**Mutations** (copy-revert, runtime rebuilt each time; all killed):

| # | mutation | killed by |
| --- | --- | --- |
| N1 | no retry after a review refusal | 1 |
| N2 | the retry queued blocking | 1 |
| N3 | the retry promoted by a foreground request | 1 |
| N4 | retried forever (never settles) | 1 |
| N5 | the second refusal not settled | 1 |
| N6 | retried for any rule | 1 |
| N7 | the kernel drops the reasons | 1 |
| N8 | the service polls on past `unusable` | 2 |
| N9 | the settlement told again for the same focus | 3 |
| N10 | the host drops the reviewer's rows | 4 |
| N11 | the retry's reader not given the reasons | 4 |
| N12 | a settled scene no longer lands on its text | 1 |
| N13 | `retry: true` does not replace the settlement | 1 |

**Suites (leehow-pc, `7c9059a4d`).** ext: `ℹ tests 3130`, `ℹ pass 3130`, `ℹ fail 0` (wall 179 s); loop: `# tests 195`,
`# pass 195`, `# fail 0` (44 s); py: `1728 passed, 2 skipped in 175.88s (0:02:55)`.

**Replay.** The t10 replay (SL-56's entry) does not exercise this path: in the fixture `read-2` (the arrival scene's own
read) is already `failed` from before this rule, and the rule applies at a finish, so nothing re-queued it. A table on this
branch whose detail read is refused `review_unsupported` shows it live: expect a `requeued` row with `reason:
"review_refused"`, the retry claimed as `class: "background"`, and either a publication or one `scene_record` /
`person_record` with `status: "unusable"` in the note.

**Not done, and why.**
- A read that failed before this rule (a `failed` job with no settlement, like b7's `read-2`) is not re-queued
  retroactively; §107.1's pre-rule map case settles on the next arrival, but a text read here waits for `retry: true` or a
  new read. Retroactive re-queue on `table.open` would be a small addition to `recoverOrphans`; not in scope.
- The manifest's status lines are left to the integrator.
