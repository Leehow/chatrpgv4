# SL-29A follow-up (batch-7) — pre-registered lines, written before the table opens

Table: driver.py, hybrid-v1, `PI_COC_JEV_PRESELECT=1`, grok-build/grok-4.7-build-fast low (the App's grok login),
Jev key from the App vault; worktree `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b7` on branch
`claude/sl29a-b7-20260925`, build `716d48649` (integration `claude/integ-single-loop-20260923`, batch 7 merged on
top of batch 6: SL-53 (the background index/skeleton jobs run under the book-sized lease), SL-54 (a displaced
background read resumes under the current generation; the pending row survives), SL-55 (an answer running through a
publication lands, or re-reads once if its focus was touched; a re-ask attaches to the parked job), SL-52 (ask
fan-out through all three stages; PDF modules' scene obligations may now be settled with yields) and SL-50 stage 2
(writes-are-silent rule in the first clerk note, once per run). Home `.coc/playtests/sl29a-b7/home`, copied from the
read-only imported home `chatrpgv4-wt-pdf-a/.coc/playtests/sl29-a-run2/home` (module `book-1`, 血色公路, generation
2, the same graph batch-4/5/6 reused, unmodified by this copy; stale `.lock` files under `.coc/modules` removed
after the copy, before use). A NEW campaign, `sl29ab7-xuese-0445`, was created from that module via the onboarding
worker's `converse` action (title `血色公路`, no `.pdf` suffix — this path calls `worker.sh` directly, not the App's
upload flow that ticket 29's own P4 finding named), then a live setup session made investigator 雷·卡特 replaying
batch-4/5/6's own recorded exchange turn-for-turn (Private Investigator, same trade/strengths: Drive Auto his own
stated strength, Spot Hidden/tracking as his trade, weak with a gun), then the same 20-turn script
(`29-book-a-b6/script.md`, copied unmodified as `29-book-a-b7/script.md`), one sentence a turn, structural branches
only (`present`/`moved`/`hurt`, read from the turn record — never from prose). This run is measurement only: no
product fixes.

## SL-29A class lines (unchanged, carried from batch-4/5/6)

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

## Batch-4/5/6 lines (carried; still worth watching)

12. **SL-34 (move into a mapped scene lands without the map)**: the town's own arrival (`welcome-to-abattoir`)
    lands on first declaration, no `material_pending` on it.
13. **SL-35 (large book opening does not die in a fixed lease)**: no import-stage turn dies against a fixed lease.
14. **SL-36 (source answers do not hold the turn)**: `lookup kind=source` returns `pending` within the turn, no
    turn blocks past the 8 s allowance on a source answer.
15. **SL-37 (a reading wait still delivers fiction)**: any turn waiting on a reading still delivers Keeper prose.
16. **SL-38 (a guard is evaluated after the batch's own effects)**: no `not_authorized`/`refused` verdict on a
    guard whose unlocking condition was satisfied earlier in the same turn's batch (not expected to be exercised by
    this script; batch-4/5/6 recorded it as not exercised).
17. **SL-40 (a guard is a condition the place exists)**: no `refused` verdict citing a missing place the graph
    already has; ordinary checks roll a skill on 雷·卡特's own sheet, never an off-sheet skill.
18. **SL-42 (bookkeeping of the scene just left)**: a clue available in a scene the party left this turn is still
    accepted if declared before or during the same turn's departure (not expected to be exercised).
19. **SL-41 (in-play reads get a book-sized lease)**: no `provider_refused` with `reason: budget_input_tokens` on
    any in-play `detail`/`answer` read of this book; an output overrun fails only that call, not the whole lease.
20. **SL-43 (one check per declared act)**: at most one `resolve` per act per compile (not expected to be exercised).
21. **SL-44 (prescreen fallbacks)**: no read's prescreen falls back with `key: source_revision`; `allowance_ms`
    equals the configured default (12000 ms) measured from its own start.
22. **SL-45 (blocking reads go first)**: a blocking `detail` read claims a free slot at once or displaces the
    youngest background read; no blocking read starved for its whole run.
23. **SL-47 (a move into an unread scene lands on the index's text)**: a move into a sub-location whose `detail` is
    not yet read lands immediately with `material: "index"`/`scene_text` carried and a `pending` row; the detail
    read continues in the background; the reviewed record (or `unavailable`) is carried once later.
24. **SL-48 (index cites a discovered scene's own pages)**: for every sub-location entered via SL-47's index-text
    landing, once its `detail` read has completed or failed after its read phase wrote observations, the scene's
    own index row (`module.json` `reading.scene_index`) gains the pages that reading's own draft cited for the
    scene; confirmed live in batch-6 for all three reads raised there, including the refused one.
25. **SL-49 (a review disagreement on a classification field is `contested`, not a refusal)**: only a disputed
    *fact* field or a root-level dispute still refuses outright; a field-level classification dispute publishes
    `contested`. Not exercised in batch-6 (the one dispute seen was fact-level).
26. **SL-51 (a person the carried source text names is accepted `from_passage`)**: a `person`/`npc` write whose name
    appears verbatim in this turn's carried passages is accepted `from_passage` even before the scene's detail
    record has landed. Not exercised in batch-6 (the Keeper never placed a carried-text NPC present before the
    record landed).

## Batch-7 lines (this run), keyed to what SL-52/53/54/55/50-stage-2 changed

27. **SL-53 (the background `index`/`skeleton` job runs under the book-sized lease)**: batch-6's own P2 finding was
    that `read-1` (`purpose: "index"`, the fork's own full-book index-completion job) got no `stage_budget`
    telemetry row and hit the old fixed 1,000,000-input-token ceiling (`provider_refused
    {reason:"budget_input_tokens"}`) after 210 s, self-recovering on a fresh round. Success line: this table's own
    background index job (raised automatically when the campaign forks, on this same 111-page book) gets a
    `stage_budget` telemetry row before it runs (`pageCount: 111`), and no `budget_input_tokens` refusal occurs on
    it. Record: whether `read-1` (or whichever job carries `purpose: "index"`/`"skeleton"`) has a `stage_budget` row,
    and its wall/round count compared to batch-6's 210 s + 139 s + 108 s pattern.
28. **SL-54 (a displaced background read resumes under the current generation instead of failing)**: batch-6's own
    P2 finding was that `read-8` displaced `read-7` (a background `answer` job) at the 3-slot contention point, and
    `read-7`'s next claim failed outright with `"source context changed; request a fresh consultation"` rather than
    resuming — the Keeper's question about the town's sheriff/mayor/missing-persons report never got an answer.
    Success line: if a background `answer`/`detail` job is displaced this table (all 3 foreground/background slots
    contended), its next claim resumes (`resumed {from_generation, generation, reread}`) rather than failing with
    `source_context_changed`; the pending row on the Keeper's note survives the displacement (the waiter still shows
    `pending` across it, not `unavailable`). Count: `displaced` and `resumed` rows; zero `failed` rows attributable
    to a generation move on a resumed job.
29. **SL-55 (an answer running through a publication lands, or re-reads once if its focus was touched)**: batch-6
    did not exercise a mid-flight publication racing a *running* (not yet displaced) answer job, but the ticket's
    own evidence (batch-6's read-8) is the motivating case for this ruling too. Success line: any `answer`/`detail`
    job whose attempt began under one generation and whose focus is untouched by a publication that lands while it
    runs finishes `finished_under {from_generation, generation}` (lands, not refused); one whose focus *was* touched
    is `requeued {reason:"focus_changed", ...}` and re-reads once via the resumed path, landing on the second
    attempt; no job fails outright with `source_context_changed` at finish. A re-ask of the same question while its
    job is parked or reading under an older generation attaches to it (`attached: true`) rather than queuing a
    second reading — batch-6's SL-54 comments named this gap explicitly. Record every `finished_under`/`requeued`
    row and any `attached: true` re-ask.
30. **SL-52 (the ask feature fans out with a within-row margin, and an accept obligation settles with yields)**:
    this script's own turn 4 (arriving at 阿巴托尔) and turns naming Knott-shaped acceptances do not apply to this
    book (血色公路 has no equivalent commission-acceptance obligation node in its 4-node starting graph, unlike the
    Haunting fixture SL-52 was built and replayed against) — **not expected to be exercised by this script**, since
    the town's own graph carries no obligation nodes yet at campaign creation and this script never poses an
    accept-a-commission sentence. Record whether any `ask_cleared`/`settled_clue`/obligation-yield compile row
    appears at all this table (expected: none, or only if a sub-location's detail read publishes an obligation this
    script happens to trigger — watch for it, don't force it).
31. **SL-50 stage 2 (writes-are-silent; the first clerk note carries `head` once per run)**: count
    `text_beside_tool_calls` drops and model steps per turn across the whole table (the ticket's own long-gate #7
    target lines: drops ≤ 7, steps ≤ 52, turns with ≥ 3 steps ≤ 8, though those numbers were set against the
    Haunting's own longer script — report this table's own counts for comparison, not as a pass/fail gate against
    numbers calibrated to a different script). Record: total steps, total `text_beside_tool_calls` drops, and how
    many turns needed ≥ 3 model steps.

## Captures this batch specifically re-collects (carried from batch-5/6's own capture design)

A. **For every detail/answer/index read raised during this table**, record from the campaign fork's
   `deepen-queue.json` / `findings.json` (kept, not deleted after the table): whether it published or was refused,
   the kernel's refusal text verbatim when refused, whether it carries a `stage_budget` row (SL-53), and — new this
   batch — whether a `displaced`/`resumed`/`finished_under`/`requeued` row appears on it (SL-54/SL-55). Evidence
   path pre-committed to: `.coc/playtests/sl29a-b7/home/.coc/module-campaigns/<campaign-id>/modules/book-1/
   {deepen-queue.json,findings.json,module.json}` and `.coc/playtests/sl29a-b7/home/.coc/reading-telemetry.jsonl`.
B. **For every scene entered on index text (SL-47 landing)**, record which pages the index cited for it before and
   after its detail read settles (SL-48), whether those are the scene's own pages, and whether the Keeper's scene
   view ever shows `where.contested` (SL-49). Evidence path: the driver's per-turn JSON under
   `.coc/playtests/sl29ab7-xuese-0445-<run-id>/turn-*.json` plus the same `deepen-queue.json`/`module.json`.
C. **For every `person`/`npc` write refused or accepted this table**, record the name, whether it appears in the
   turn's carried text, and whether the write shows `established: "passage"` / `from_passage` (SL-51) versus
   `unknown_entity`. Count total `from_passage` registrations and replacements.
D. **Turn-by-turn**: which sub-locations were entered and on which turn (carried forward from batch-4/5/6's own
   table format).
E. **New this batch**: every `displaced`/`resumed` row (SL-54), every `finished_under`/`requeued` row (SL-55), and
   whether any job lacked a `stage_budget` row while running under `purpose: "index"`/`"skeleton"` (SL-53). Also:
   total model steps per turn and `text_beside_tool_calls` drop count table-wide (SL-50 stage 2).

## Stop conditions

Do not stop the table short of no-delivery / hang, per instruction. Never kill a `driver.py` daemon not started by
this worker (long gate #7, campaign `longgate7-haunting-0042`, is running concurrently in
`chatrpgv4-wt-integ-sl` on this Mac — confirmed by `ps aux` before this table opened; noted as a possible
account-contention confound, not touched). Keep the campaign fork and reading workspace after the table (do not
delete), continuing the procedural change batch-5/6 made.

Triage after the table (`29-book-a-b7/triage.py`, adapted from `29-book-a-b6/triage.py`, same columns): every
finding classed (P0 delivery/stall/import, P1 wall > 60 s cause, P2 routing/admission/reading, P3 fiction/rules, P4
cost), one root cause per finding, evidence paths; cross-referenced against batch-6's findings (this file's sibling
`29-pdf-modules-live-tables.md` batch-6 Comments entry) — which are fixed, which remain, which are new to batch 7.
