# SL-29A follow-up (batch-5) — pre-registered lines, written before the table opens

Table: driver.py, hybrid-v1, `PI_COC_JEV_PRESELECT=1`, grok-build/grok-4.7-build-fast low (the App's grok login),
Jev key from the App vault; worktree `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b5` on branch
`claude/sl29a-b5-20260924`, build `de31a09b2` (integration `claude/integ-single-loop-20260923`, batch 5 merged on
top of batch 4: SL-41, SL-43, SL-44, SL-45, SL-47). Home `.coc/playtests/sl29a-b5/home`, copied from the read-only
imported home `chatrpgv4-wt-pdf-a/.coc/playtests/sl29-a-run2/home` (module `book-1`, 血色公路, already imported
there; the same home batch-4 reused, unmodified by this copy). A NEW campaign is created from the module via
`converse` (not a reuse of batch-4's campaign `sl29ab4-xuese-2401` or the original `sl29a-xuese-1436`), then a live
setup session makes investigator 雷·卡特 the same way batch-4 did (Private Investigator, same trade/strengths),
then the same 20-turn script (`29-book-a/script.md`, copied unmodified as `29-book-a-b5/script.md`), one sentence a
turn, structural branches only (`present`/`moved`/`hurt`, read from the turn record — never from prose).

## SL-29A class lines (unchanged, carried from batch-4)

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

## Batch-4 lines (carried; still worth watching)

12. **SL-34 (move into a mapped scene lands without the map)**: the town's own arrival (`welcome-to-abattoir`)
    lands on first declaration, no `material_pending` on it.
13. **SL-35 (large book opening does not die in a fixed lease)**: no import-stage turn dies against a fixed lease.
14. **SL-36 (source answers do not hold the turn)**: `lookup kind=source` returns `pending` within the turn, no
    turn blocks past the 8 s allowance on a source answer.
15. **SL-37 (a reading wait still delivers fiction)**: any turn waiting on a reading still delivers Keeper prose.
16. **SL-38 (a guard is evaluated after the batch's own effects)**: no `not_authorized`/`refused` verdict on a
    guard whose unlocking condition was satisfied earlier in the same turn's batch (not expected to be exercised
    by this script; batch-4 recorded it as not exercised).
17. **SL-40 (a guard is a condition the place exists)**: no `refused` verdict citing a missing place the graph
    already has; ordinary checks roll a skill on 雷·卡特's own sheet, never an off-sheet skill.
18. **SL-42 (bookkeeping of the scene just left)**: a clue available in a scene the party left this turn is still
    accepted if declared before or during the same turn's departure (not expected to be exercised; batch-4's script
    never poses it either).

## Batch-5 lines (this run), keyed to what SL-41/43/44/45/47 changed

19. **SL-41 (in-play reads get a book-sized lease)**: a `detail`/`answer`/`map` read raised during play carries a
    `stage_budget` row sized from the book's page count and measured per-page cost, not the fixed
    `independentProviderBudget` default; no `provider_refused` with `reason: budget_input_tokens, ceiling: 1000000`
    on any in-play read of this book (batch-4's exact signature on `read-6`/`read-12`, `last-chance-bar`). Any
    output overrun fails only that call (`budget_output_tokens`, `overrun: true`) and the round continues; it does
    not cancel the whole lease (contrast batch-4's `read-4`/`read-5` cancelled rounds).
20. **SL-43 (one check per declared act)**: no single declared sentence produces two clerk rolls for the same act
    (an obligation check and a distinct ordinary check both binding, as in long-gate #4 t2); at most one `resolve`
    per act per compile, with `acts_settled` recorded when an obligation step covers the act.
21. **SL-44 (prescreen fallbacks)**: no read's prescreen falls back with `key: source_revision`; every read's
    prescreen `allowance_ms` equals the configured default (12000 ms) measured from its own start, not a shrunk
    remainder of the turn/run's elapsed budget (batch-4/long-gate's `allowance_ms: 138` signature).
22. **SL-45 (blocking reads go first)**: a `detail` read that blocks the current turn's move claims a free slot at
    once, or — if all 3 reading slots are held by background (`answer`/prefetch) reads — displaces the youngest
    background read (rows carry `class`, `slot_wait_ms`, and a `displaced {job_id, for_job, ran_ms}` record); no
    blocking read is left waiting behind a background read for its whole run. Success line: at least one of the
    four sub-locations batch-4 discovered but never entered (esso station, Mather's store, the bar; church-lane
    was background prefetch only) is entered within this 20-turn table.
23. **SL-47 (a move into an unread scene lands on the index's text)**: a move into a sub-location whose `detail`
    is not yet read lands immediately with `material: "index"` and carries the index's own passages for that scene
    (a `scene_text`/`pending` receipt, not `material_pending`/refused); the detail read continues in the background
    at blocking class; the reviewed scene record (or an `unavailable` status, per SL-47's known publication-failure
    finding) is carried once on a later turn's note. Success line: no turn walls > 60 s solely on a scene's detail
    text arriving (the foreground wait is expected to remain only for scenes with no index text at all, none of
    which this script should reach).

## Two captures this batch specifically re-collects (lost in the SL-47 replay because the fork's workspace was deleted)

A. **For every detail read raised during this table**, record from the campaign fork's `deepen-queue.json` /
   `findings.json` (kept, not deleted after the table): whether it published or was refused at publication, and
   the kernel's refusal text verbatim when it was refused. Evidence path pre-committed to:
   `.coc/playtests/sl29a-b5/home/.coc/module-campaigns/<campaign-id>/modules/book-1/{deepen-queue.json,findings.json}`.
B. **For every scene entered on index text (SL-47 landing)**, record which pages the index cited for it (from the
   `scene_text`/`pending` row's `details.index.pages` or the campaign's turn record) and whether those are the
   scene's own pages. Known baseline to compare against: the bar's own pages in 血色公路 are 28–30; batch-4's SL-47
   replay found its node cited only page 17 (the town's arrival page). Evidence path: the driver's per-turn JSON
   under `.coc/playtests/sl29a-b5/<run-id>/turn-*.json` plus the same `deepen-queue.json`.

## Stop conditions

Do not stop the table short of no-delivery / hang, per instruction. Never kill a `driver.py` daemon not started by
this worker. Keep the campaign fork and reading workspace after the table (do not delete), specifically to satisfy
captures A and B above — this is the one procedural change from batch-4's harness (which deleted its replay
workspaces and lost this data).

Triage after the table (`29-book-a-b5/triage.py`, adapted from `29-book-a-b4/triage.py`, same columns): every
finding classed (P0 delivery/stall/import, P1 wall > 60 s cause, P2 routing/admission/reading, P3 fiction/rules, P4
cost), one root cause per finding, evidence paths; cross-referenced against batch-4's findings (this file's sibling
`29-pdf-modules-live-tables.md` batch-4 Comments entry) — which are fixed, which remain, which are new to batch 5.
