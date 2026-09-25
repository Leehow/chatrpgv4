# SL-29A follow-up (batch-8) — pre-registered lines, written before the table opens

Table: driver.py, hybrid-v1, `PI_COC_JEV_PRESELECT=1`, grok-build/grok-4.7-build-fast low (the App's grok login),
Jev key from the App vault; worktree `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b8` on branch
`claude/sl29a-b8-20260925`, build `41672d838` (integration `claude/integ-single-loop-20260923`, batch 8 merged on
top of batch 7: SL-56 (a check or write on a person the book's index or carried text names lands on that text with
a `person_text` note row and a pending row; a table person the Keeper created is never held; the person's record
lands later as `person_record`) and SL-57 (a detail read refused at review for an unsupported fact is re-queued once
in the background with the reviewer's reasons; a second refusal settles the focus `unusable`, shown once)). Home
`.coc/playtests/sl29a-b8/home`, copied from the read-only imported home `chatrpgv4-wt-pdf-a/.coc/playtests/sl29-a-run2/home`
(module `book-1`, 血色公路, generation 2, the same graph batches 4/5/6/7 reused, unmodified by this copy; stale
`.lock` files under `.coc/modules` removed after the copy, before use). A NEW campaign, `sl29ab8-xuese-0512`, will be
created from that module via the onboarding worker's `converse` action (title `血色公路`, no `.pdf` suffix — this
path calls `worker.sh` directly, not the App's upload flow), then a live setup session will make investigator
雷·卡特 replaying batch-4/5/6/7's own recorded exchange turn-for-turn (Private Investigator, same trade/strengths:
Drive Auto his own stated strength, Spot Hidden/tracking as his trade, weak with a gun), then the same 20-turn
script (`29-book-a-b7/script.md`, copied unmodified as `29-book-a-b8/script.md`), one sentence a turn, structural
branches only (`present`/`moved`/`hurt`, read from the turn record — never from prose). This run is measurement
only: no product fixes.

Confound noted before the table opens, not scored as a finding: long gate #8 (campaign `longgate8-haunting-0312`,
worktree `chatrpgv4-wt-integ-sl`) is running concurrently on this Mac's grok-build login (confirmed by `ps aux`
before this table opens: pid 78720 `_daemon --run longgate8-haunting-0312-...`); its daemon will not be touched.
The grok-build token in the App's `.pi/coc-agent/auth.json` had 26.7 minutes remaining at copy time (below the
60-minute floor named for batch-7's own copy note, and below this run's 45-minute floor); a scan of every
`chatrpgv4-wt-*/.pi/coc-agent/auth.json` found no fresher `grok-build` entry (all live worktrees share the same
`expires` timestamp), so the copied entry is used as-is — if the table stalls on an expired token mid-run, that is
recorded as a stall with cause, not silently retried with a swapped credential.

## SL-29A class lines (unchanged, carried from batch-4/5/6/7)

1. **Delivery**: 20/20 turns delivered with prose; any turn with no text is P0.
2. **Wall**: median ≤ 45 s; ≥ 80% of turns ≤ 60 s; max reported. Turns that waited on a reading are listed with the
   wait, and the line is also scored without them.
3. **Routing**: a declared move to a destination the graph has is selected by the compile; for destinations the
   graph does not have yet, the turn either reads them (`material_pending` / lookup source / SL-47's index landing)
   or the Keeper narrates without inventing a move receipt to an unknown scene; compile rows on every run with a
   candidate.
4. **Admission**: no row over 12 s; clerk writes on `path: compile`; every `review_timeout` listed with its write.
5. **Binding**: `infer(bind)` = 0; approach defaults `jev_lead` or Jev.
6. **Looks**: ≤ 1 per turn after a scene's first visit; `lookup kind=source` counted separately (they are readings).
7. **Prescreen**: status per read; fallbacks with keys; no run whose decision budget is spent by the prescreen.
8. **Drops**: every dropped draft has a `delivery ok:false` row with a reason; no stranded turn.
9. **Fiction and rules**: the prologue's rule holds (turning back or continuing ends the same way; no check forced
   for it); people met in town come from the book, not invented stat blocks; checks the player's sentences call for
   are rolled by `resolve`; NPC speech in tokens; no push without the player's declaration.
10. **Stalls**: none; any provider `error` row listed.
11. **Reading (PDF only)**: every foreground reading has a telemetry row with purpose/focus/ms and an outcome;
    `reading_timeout` rows listed with what the Keeper did next; the graph's generation and node count after each
    turn; readings are published to the campaign's private workspace once it forks; no reading fails on a
    same-span re-transcription.

## Batch-4/5/6/7 lines (carried; still worth watching)

12. **SL-34** (move into a mapped scene lands without the map): the town's own arrival (`welcome-to-abattoir`) lands
    on first declaration, no `material_pending` on it.
13. **SL-35** (large book opening does not die in a fixed lease): no import-stage turn dies against a fixed lease.
14. **SL-36** (source answers do not hold the turn): `lookup kind=source` returns `pending` within the turn, no
    turn blocks past the 8 s allowance on a source answer.
15. **SL-37** (a reading wait still delivers fiction): any turn waiting on a reading still delivers Keeper prose.
16. **SL-38** (a guard is evaluated after the batch's own effects): not expected to be exercised by this script.
17. **SL-40** (a guard is a condition the place exists): no `refused` verdict citing a missing place the graph
    already has; ordinary checks roll a skill on 雷·卡特's own sheet, never an off-sheet skill.
18. **SL-42** (bookkeeping of the scene just left): not expected to be exercised.
19. **SL-41** (in-play reads get a book-sized lease): no `provider_refused` with `reason: budget_input_tokens` on
    any in-play `detail`/`answer` read of this book.
20. **SL-43** (one check per declared act): at most one `resolve` per act per compile (not expected to be exercised).
21. **SL-44** (prescreen fallbacks): no read's prescreen falls back with `key: source_revision`; `allowance_ms`
    equals the configured default (12000 ms) measured from its own start.
22. **SL-45** (blocking reads go first): a blocking `detail` read claims a free slot at once or displaces the
    youngest background read; no blocking read starved for its whole run.
23. **SL-47** (a move into an unread scene lands on the index's text): a move into a sub-location whose `detail` is
    not yet read lands immediately with `material: "index"`/`scene_text` carried and a `pending` row.
24. **SL-48** (index cites a discovered scene's own pages): confirmed live in batches 6 and 7 for every read raised,
    including refused ones — watch whether it holds a fourth table running.
25. **SL-49** (a review disagreement on a classification field is `contested`, not a refusal): not exercised in
    batch 6 or 7 (both disputes seen were fact-level).
26. **SL-51** (a person the carried source text names is accepted `from_passage`): not exercised in batch 6; batch
    7's only NPC (`最靠边的那个男人`) was the Keeper's own paraphrase, not a book-given name, so the race was not
    posed there either — watch again this table, since the same NPC-creation shape recurs around turns 8-11.
27. **SL-53** (background `index`/`skeleton` job runs under the book-sized lease): confirmed fixed in batch 7 (every
    job got a `stage_budget` row, zero `budget_input_tokens` refusals) — watch it continues to hold.
28. **SL-54** (a displaced background read resumes under the current generation): not exercised in batch 7 (no
    3-slot contention) — watch for slot contention this table; if it fires, record `displaced`/`resumed` rows and
    whether the pending row survives.
29. **SL-55** (an answer running through a publication lands or re-reads once): not exercised in batch 7 (the fork
    never advanced past generation 2) — watch for any generation move.
30. **SL-52** (ask fan-out / accept-obligation yields): not expected to be exercised by this script (血色公路's
    4-node starting graph carries no obligation/accept node) — watch anyway, don't force it.
31. **SL-50 stage 2** (writes-are-silent; first clerk note carries `head` once per run): report this table's own
    steps/drops/turns≥3-steps counts for comparison, not as a pass/fail gate against Haunting-calibrated numbers.

## Batch-8 lines (this run), keyed to what SL-56/SL-57 changed

32. **SL-56 (NPC material never holds a turn).** Batch 7's own P1 finding was that a `resolve` targeting an NPC
    still being read (`最靠边的那个男人`, a **table** person established by `apply npc`) blocked the whole turn for a
    full `reading_timeout` cycle (~120-131 s), twice (t10, t11), because `requireMaterial`'s gate never consulted
    `withTablePeople`. Success lines, in order of how the script is expected to reach them (turns 8-11 recreate the
    same gas-station-attendant shape as batch 7):
    - **Table person, never held.** If the Keeper again establishes the attendant as a table person (`apply npc`
      with no book-given name) before checking him, the check must NOT wait on `reading_timeout` — no
      `material_pending`/`reading_timeout` row naming him, and the turn's wall should look like an ordinary
      admission-bound turn (single-digit-to-low-tens of seconds), not the ~125-131 s batch-7 pattern. This is the
      exact case §22.4.7.1's comments say batch-7's t10 actually was.
    - **Book/index person, if named.** If instead the Keeper names an index- or book-known person (unlikely on
      this script's 4-node starting graph, but watch for it if a sub-location's detail read has published NPCs by
      then), a check or write on him should land on the index/carried text at once (`person_text`, a `pending` row
      naming the person), not block; the reviewed `person_record` should carry once on a later turn.
    - **Genuinely unnamed-anywhere person.** Only a person the book's text nowhere names (no index pages, no
      carried passage) should still hit the foreground wait.
    - Record: every `apply npc`/`person` write this table (name, `established` value); every `resolve` targeting an
      NPC (wall time, whether `reading_timeout`/`material_pending` fired, `job_id` if any); any `person_text` /
      `person_record` / pending-person row in the turn record or telemetry; count `person_text`, `person_record`,
      and pending-person rows table-wide (pre-registered target: zero `material_pending` waits on any person,
      table or book, given this script's own NPCs).
33. **SL-57 (a refused detail read is retried once, then settles unusable).** Batch 6/7's own carried P2 finding was
    that a scene's own detail read (`read-2` in batch 7, `welcome-to-abattoir`'s `summary` field) fails at review
    and is never retried for the rest of the table, so the scene's richer record never arrives. Success line: if
    any detail read is refused at review for an `unsupported` fact this table (the reviewer's own book-wide-negative
    strictness recurred in batch 7's `read-6`, `/status` "unclear" — likely to recur again on this same book), it
    should be re-queued exactly once in the background (`requeued {job_id, reason: "review_refused", of}`, a
    `requeued` telemetry/note row) carrying the reviewer's refused fields and reasons; a foreground request should
    answer it `pending`/index-text without promoting the retry; a second refusal on the same focus should settle it
    `unusable` once (a `scene_record`/`person_record` row with `status: "unusable"`, shown once in the note, not
    repeated on later turns); the scene should keep playing on the index text throughout (SL-47 floor unaffected).
    Record: every `requeued` row (job id, reason, refused fields); every `unusable` settlement row and on which
    turn it is first shown; whether it is shown again on any later turn (it should not be); whether the fork's
    generation ever advances past 2 as a side effect of this table's reads landing (comparison only, not a gate).

## Captures this batch specifically re-collects (carried from batch-5/6/7's own capture design)

A. **For every detail/answer/index read raised during this table**, record from the campaign fork's
   `deepen-queue.json`/`findings.json` (kept, not deleted after the table): whether it published or was refused,
   the kernel's refusal text verbatim when refused, whether it carries a `stage_budget` row (SL-53), whether a
   `displaced`/`resumed`/`finished_under`/`requeued` row appears on it (SL-54/SL-55/SL-57), and whether a second
   refusal on the same focus settles `unusable` (SL-57). Evidence path pre-committed to:
   `.coc/playtests/sl29a-b8/home/.coc/module-campaigns/<campaign-id>/modules/book-1/
   {deepen-queue.json,findings.json,module.json}` and `.coc/playtests/sl29a-b8/home/.coc/reading-telemetry.jsonl`.
B. **For every scene entered on index text (SL-47 landing)**, record which pages the index cited for it before and
   after its detail read settles (SL-48), whether those are the scene's own pages, and whether the Keeper's scene
   view ever shows `where.contested` (SL-49). Evidence path: the driver's per-turn JSON under
   `.coc/playtests/sl29ab8-xuese-0512-<run-id>/turn-*.json` plus the same `deepen-queue.json`/`module.json`.
C. **For every `person`/`npc` write refused or accepted this table**, record the name, whether it appears in the
   turn's carried text, whether it is `established: "table"` versus `"passage"`/`from_passage` versus a book node,
   and — new this batch — whether a `resolve`/check on that person waited on `reading_timeout`/`material_pending`
   at all (SL-56's own target: it should not, for a table person). Count total `from_passage` and table-person
   registrations and any pending-person rows.
D. **Turn-by-turn**: which sub-locations were entered and on which turn (carried forward from batch-4/5/6/7's own
   table format).
E. **New this batch**: every `person_text`/`person_record` row and pending-person row (SL-56); every `requeued`
   row and `unusable` settlement row, and whether any settlement is shown more than once for the same focus
   (SL-57); whether any job lacked a `stage_budget` row while running under `purpose: "index"`/`"skeleton"`
   (SL-53, comparison); total model steps per turn and `text_beside_tool_calls` drop count table-wide (SL-50 stage
   2, comparison).

## Stop conditions

Do not stop the table short of no-delivery / hang, per instruction. Never kill a `driver.py` daemon not started by
this worker (long gate #8, campaign `longgate8-haunting-0312`, is running concurrently in `chatrpgv4-wt-integ-sl`
on this Mac — confirmed by `ps aux` before this table opens; noted as a possible account-contention confound, not
touched). Keep the campaign fork and reading workspace after the table (do not delete), continuing the procedural
change batches 5/6/7 made.

Triage after the table (`29-book-a-b8/triage.py`, adapted from `29-book-a-b7/triage.py`, same columns): every
finding classed (P0 delivery/stall/import, P1 wall > 60 s cause, P2 routing/admission/reading, P3 fiction/rules, P4
cost), one root cause per finding, evidence paths; cross-referenced against batch-7's findings (this file's sibling
`29-pdf-modules-live-tables.md` batch-7 Comments entry) — which are fixed, which remain, which are new to batch 8.
