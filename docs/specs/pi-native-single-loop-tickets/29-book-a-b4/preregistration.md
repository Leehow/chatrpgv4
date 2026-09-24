# SL-29A follow-up (batch-4) — pre-registered lines, written before the table opens

Table: driver.py, hybrid-v1, `PI_COC_JEV_PRESELECT=1`, grok-build/grok-4.7-build-fast low (the App's grok login),
Jev key from the App vault; worktree `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b4` on branch
`claude/sl29a-b4-20260924`, build `a1bdf7004` (integration `claude/integ-single-loop-20260923`, with SL-34, SL-35,
SL-36, SL-37, SL-38, SL-40, SL-42 merged on top of what SL-29A tested). Home
`.coc/playtests/sl29a-b4/home`, copied from the read-only imported home
`chatrpgv4-wt-pdf-a/.coc/playtests/sl29-a-run2/home` (module `book-1`, 血色公路, already imported there; falls back
to a fresh import via `29-book-a-b4/worker.sh` from the read-only PDF if the copied home does not load on this
build). A NEW campaign is created from the module via `converse` (not a reuse of the old campaign
`sl29a-xuese-1436`), then a live setup session makes investigator 雷·卡特 the same way SL-29A did, then the same
20-turn script (`29-book-a/script.md`, copied unmodified as `29-book-a-b4/script.md`), one sentence a turn,
structural branches only (`present`/`moved`/`hurt`, read from the turn record — never from prose).

## SL-29A class lines (unchanged)

1. **Delivery**: 20/20 turns delivered with prose; any turn with no text is P0.
2. **Wall**: median ≤ 45 s; ≥ 80% of turns ≤ 60 s; max reported. Turns that waited on a reading are listed with the
   wait, and the line is also scored without them.
3. **Routing**: a declared move to a destination the graph has (序幕 → 欢迎来到"屠宰场") is selected by the compile;
   for destinations the graph does not have yet, the turn either reads them (`material_pending` / lookup source) or
   the Keeper narrates without inventing a move receipt to an unknown scene; compile rows on every run with a
   candidate.
4. **Admission**: no row over 12 s; clerk writes on `path: compile`; every `review_timeout` listed with its write.
5. **Binding**: `infer(bind)` = 0; approach defaults `jev_lead` or Jev.
6. **Looks**: ≤ 1 per turn after a scene's first visit; `lookup kind=source` counted separately (they are readings).
7. **Prescreen**: status per read; fallbacks with keys; no run whose decision budget is spent by the prescreen.
8. **Drops**: every dropped draft has a `delivery ok:false` row with a reason; no stranded turn.
9. **Fiction and rules**: the prologue's rule holds (turning back or continuing ends the same way; no check forced
   for it); people met in town come from the book (a person node appears in the graph after a reading, or the
   Keeper says the book is silent), not invented stat blocks; checks the player's sentences call for (Spot Hidden on
   the bridge, Psychology on t10, Spot Hidden on t16) are rolled by `resolve`; NPC speech in tokens; no push
   without the player's declaration.
10. **Stalls**: none; any provider `error` row listed.
11. **Reading (PDF only)**: every foreground reading has a telemetry row with purpose/focus/ms and an outcome;
    `reading_timeout` rows listed with what the Keeper did next (§22.4: honest wait, no invented question); the
    graph's generation and node count after each turn; readings are published to the campaign's private workspace
    once it forks (§22.6); no reading fails on a same-span re-transcription (SL-33).

## Batch-4 lines (this run), keyed to what SL-34/35/36/37/38/40/42 changed

12. **SL-34 (move into a mapped scene lands without the map)**: the first turn that declares a move into
    欢迎来到"屠宰场" from a state where the graph already has that node lands (`move:` binds `authorized`, not
    `refused`) on its first declaration, t4 at the latest, with no `material_pending` blocking it. SL-29A's original
    table showed `move:refused[stated]` on t4, t6, t12 and t13 waiting on a map read each time (156 s, 18 s, 158 s,
    22 s) — this line is fixed if none of those turns refuse the move for a missing map anymore.
13. **SL-35 (large book opening does not die in a fixed lease)**: no turn over 60 s whose cause is a reading wait
    dying against a fixed lease; any reading wait present is bounded by the book's measured per-page cost
    (`withStageLease`), not a flat timeout, and is listed with its `ms`.
14. **SL-36 (source answers do not hold the turn)**: a `lookup kind=source` call returns `pending` within the
    turn and is delivered as `pending` (not a stall), then the eventual source answer is carried into a later turn's
    context (memoised) rather than re-asked; no turn blocks past the 8 s allowance waiting on a source answer.
15. **SL-37 (a reading wait still delivers fiction)**: any turn that waits on a reading still delivers the Keeper's
    prose draft for that turn (not a bare notice); the reading's own telemetry row is separate from the delivered
    turn text.
16. **SL-38 (a guard is evaluated after the batch's own effects)**: a guard gated on a condition this turn's own
    tool-call batch establishes (e.g. arriving somewhere unlocks the next declared step) is evaluated after that
    batch's effects land, not against the pre-batch state; no `not_authorized`/`refused` verdict on a guard whose
    unlocking condition was satisfied earlier in the same turn's batch.
17. **SL-40 (a guard is a condition the place exists)**: a guard framed as "this place/thing exists" is not gated
    behind a reading that has not run yet when the graph already carries the node; no `refused` verdict citing a
    missing place the graph already has.
18. **SL-42 (bookkeeping of the scene just left)**: a clue available in a scene the party left this turn (e.g. the
    bridge on t5-6, the gas stop on t7-11) is still accepted this turn if declared before or during the same turn's
    departure; no dropped clue draft whose only stated reason is "scene changed."

Triage after the table (`29-book-a-b4/triage.py`, adapted from `29-book-a/triage.py`, same columns): every finding
classed (P0 delivery/stall/import, P1 wall > 60 s cause, P2 routing/admission/reading, P3 fiction/rules, P4 cost),
one root cause per finding, evidence paths; cross-referenced against SL-29A's original findings (`triage.txt`) —
which are fixed, which remain, which are new to this batch.
