# SL-29A follow-up (batch-6) — pre-registered lines, written before the table opens

Table: driver.py, hybrid-v1, `PI_COC_JEV_PRESELECT=1`, grok-build/grok-4.7-build-fast low (the App's grok login),
Jev key from the App vault; worktree `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b6` on branch
`claude/sl29a-b6-20260925`, build `787ddf480` (integration `claude/integ-single-loop-20260923`, batch 6 merged on
top of batch 5: SL-48, SL-49, SL-51; SL-50 is in progress and is measured on the Haunting gate, not here). Home
`.coc/playtests/sl29a-b6/home`, copied from the read-only imported home `chatrpgv4-wt-pdf-a/.coc/playtests/sl29-a-run2/home`
(module `book-1`, 血色公路, already imported there; the same home batch-4/batch-5 reused, unmodified by this copy;
stale `.lock` files under `.coc/modules` removed after the copy, before use). A NEW campaign is created from the
module via `converse` (not a reuse of batch-5's `sl29ab5-xuese-5001`, batch-4's `sl29ab4-xuese-2401`, or the
original `sl29a-xuese-1436`), then a live setup session makes investigator 雷·卡特 the same way batch-4/5 did
(Private Investigator, same trade/strengths), then the same 20-turn script (`29-book-a/script.md`, copied
unmodified as `29-book-a-b6/script.md`), one sentence a turn, structural branches only (`present`/`moved`/`hurt`,
read from the turn record — never from prose). This run is measurement only: no product fixes.

## SL-29A class lines (unchanged, carried from batch-4/5)

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

## Batch-4/5 lines (carried; still worth watching)

12. **SL-34 (move into a mapped scene lands without the map)**: the town's own arrival (`welcome-to-abattoir`)
    lands on first declaration, no `material_pending` on it.
13. **SL-35 (large book opening does not die in a fixed lease)**: no import-stage turn dies against a fixed lease.
14. **SL-36 (source answers do not hold the turn)**: `lookup kind=source` returns `pending` within the turn, no
    turn blocks past the 8 s allowance on a source answer.
15. **SL-37 (a reading wait still delivers fiction)**: any turn waiting on a reading still delivers Keeper prose.
16. **SL-38 (a guard is evaluated after the batch's own effects)**: no `not_authorized`/`refused` verdict on a
    guard whose unlocking condition was satisfied earlier in the same turn's batch (not expected to be exercised
    by this script; batch-4/5 recorded it as not exercised).
17. **SL-40 (a guard is a condition the place exists)**: no `refused` verdict citing a missing place the graph
    already has; ordinary checks roll a skill on 雷·卡特's own sheet, never an off-sheet skill.
18. **SL-42 (bookkeeping of the scene just left)**: a clue available in a scene the party left this turn is still
    accepted if declared before or during the same turn's departure (not expected to be exercised; batch-4/5's
    script never poses it either).
19. **SL-41 (in-play reads get a book-sized lease)**: no `provider_refused` with `reason: budget_input_tokens` on
    any in-play read of this book; an output overrun fails only that call, not the whole lease.
20. **SL-43 (one check per declared act)**: at most one `resolve` per act per compile (not expected to be exercised
    by this script, per batch-4/5).
21. **SL-44 (prescreen fallbacks)**: no read's prescreen falls back with `key: source_revision`; `allowance_ms`
    equals the configured default (12000 ms) measured from its own start.
22. **SL-45 (blocking reads go first)**: a blocking `detail` read claims a free slot at once or displaces the
    youngest background read; no blocking read starved for its whole run.
23. **SL-47 (a move into an unread scene lands on the index's text)**: a move into a sub-location whose `detail`
    is not yet read lands immediately with `material: "index"`/`scene_text` carried and a `pending` row; the
    detail read continues in the background; the reviewed record (or `unavailable`) is carried once later.

## Batch-6 lines (this run), keyed to what SL-48/49/51 changed

24. **SL-48 (index cites a discovered scene's own pages)**: for every sub-location entered via SL-47's index-text
    landing, once its `detail` read has completed or failed after its read phase wrote observations, the scene's
    own index row (`module.json` `reading.scene_index`) gains the pages that reading's own draft cited for the
    scene (own pages, kept, not the whole viewed set); a later move into that scene lands on those pages, not the
    arrival page. Success line, pre-registered against the book's known sections: **esso-station's own section
    starts on page 19** ("1. 埃索加油站" begins there per batch-5's `pdftotext` check), so its post-read citation
    should include page 19 or later (batch-5 already had this partly right: `[17,18,19]`, reaching 19); **the bar's
    (`last-stop`) own section is pages 28–30** ("3D. 最后一站食宿酒吧"), so if its detail read runs and completes
    or fails-after-reading this table, its post-read citation should include a page in 28–30 (batch-5's defect was
    citing only `[17]`, the arrival page, because the read there was refused at review before SL-49 existed to let
    it publish with a contested mark — SL-49 may change whether it publishes at all, which changes whether SL-48
    gets a chance to run). Record, per scene entered: pages cited before vs. after its detail read settles, and
    whether the post-read citation reaches the scene's own book pages.
25. **SL-49 (a review disagreement on a classification field is `contested`, not a refusal)**: a detail read whose
    review disputes a classification field (`delivery_kind`, a check's `selection`, and their kin declared in the
    graph contract's `classification_fields`) now publishes the record with the reader's value and a `contested`
    mark instead of refusing outright; only a disputed *fact* field (or a dispute on the record's root — the SL-49
    ticket's own comments found the bar's recorded batch-5 disputes were both root-level, i.e. still refusals under
    the ruling) still refuses. Success line: if `last-stop`'s detail read is raised this table and its review
    disputes a field, record whether it is root-level (still refuses, matching SL-49's own finding on the b5
    reviews) or field-level (publishes `contested`); if it publishes, the Keeper's scene view at that location
    should show `where.contested` naming the field and reason. Record every field-level `contested` mark seen at
    the table, and whether the Keeper's carried scene view surfaces it.
26. **SL-51 (a person the carried source text names is accepted `from_passage`)**: a `person`/`npc` write whose
    name appears verbatim in this turn's carried passages (the index-landing `scene_text`, or a `source` lookup's
    content) is accepted and registered `from_passage {scene, page, label, sentence}` even before the scene's
    detail record has landed, instead of refused `unknown_entity`; once the detail record lands and names the same
    person, the provisional entry is replaced by the book's record once (`replaced_by`). Success line, keyed to
    batch-5's exact reproduction: esso-station's carried pages (17–19) name 内特·帕特森 and other NPCs verbatim; if
    the Keeper places any of them present before `esso-station`'s detail record lands, the write should be accepted
    `from_passage` (not refused `unknown_entity`), and if the record then lands naming the same person, the next
    write about them should show the replacement (`replaced_by`) rather than a duplicate entity. Count: how many
    `from_passage` registrations occur this table, and how many are later replaced by the record.

## Captures this batch specifically re-collects (carried from batch-5's own capture design)

A. **For every detail read raised during this table**, record from the campaign fork's `deepen-queue.json` /
   `findings.json` (kept, not deleted after the table): whether it published or was refused at publication, the
   kernel's refusal text verbatim when refused, and — new this batch — whether a `contested` mark exists on the
   published record (SL-49) and whether the scene's index row gained its own pages after the read (SL-48). Evidence
   path pre-committed to: `.coc/playtests/sl29a-b6/home/.coc/module-campaigns/<campaign-id>/modules/book-1/
   {deepen-queue.json,findings.json,module.json}`.
B. **For every scene entered on index text (SL-47 landing)**, record which pages the index cited for it before and
   after its detail read settles (SL-48), whether those are the scene's own pages, and whether the Keeper's scene
   view ever shows `where.contested` (SL-49). Evidence path: the driver's per-turn JSON under
   `.coc/playtests/sl29a-b6/<run-id>/turn-*.json` plus the same `deepen-queue.json`/`module.json`.
C. **For every `person`/`npc` write refused or accepted this table**, record the name, whether it appears in the
   turn's carried text, and whether the write shows `established: "passage"` / `from_passage` (SL-51) versus
   `unknown_entity`. Count total `from_passage` registrations and replacements.
D. **Turn-by-turn**: which sub-locations were entered and on which turn (carried forward from batch-4/5's own
   table format).

## Stop conditions

Do not stop the table short of no-delivery / hang, per instruction. Never kill a `driver.py` daemon not started by
this worker. Keep the campaign fork and reading workspace after the table (do not delete) — same procedural change
batch-5 made from batch-4's harness, still followed here.

Triage after the table (`29-book-a-b6/triage.py`, adapted from `29-book-a-b5/triage.py`, same columns): every
finding classed (P0 delivery/stall/import, P1 wall > 60 s cause, P2 routing/admission/reading, P3 fiction/rules, P4
cost), one root cause per finding, evidence paths; cross-referenced against batch-5's findings (this file's sibling
`29-pdf-modules-live-tables.md` batch-5 Comments entry) — which are fixed, which remain, which are new to batch 6.
