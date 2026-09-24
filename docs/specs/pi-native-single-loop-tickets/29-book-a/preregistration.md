# SL-29 book A — pre-registered lines by class (written before the table opens)

Table: driver.py, hybrid-v1, PI_COC_JEV_PRESELECT=1, grok-build/grok-4.7-build-fast low (the App's grok login),
Jev key from the App vault; fresh home `.coc/playtests/sl29-a-run2/home`; campaign `sl29a-xuese-1436` on module
`book-1` (血色公路, imported through the App's worker order in that home, opening 序幕, generation 2 at creation);
investigator 雷·卡特 made in a live setup session; the 20-turn script in `script.md`. Build: `519d7c3e3`
(integration `65b1e76b9`: SL-28, SL-31, SL-32, SL-33).

Scored by class over the whole table, not per sentence. Same lines as the Haunting long gate, plus the reading lines a
PDF module adds (a starter never waits on the book):

1. **Delivery**: 20/20 turns delivered with prose; any turn with no text is P0.
2. **Wall**: median ≤ 45 s; ≥ 80% of turns ≤ 60 s; max reported. Turns that waited on a reading are listed with the
   wait, and the line is also scored without them.
3. **Routing**: a declared move to a destination the graph has (序幕 → 欢迎来到"屠宰场") is selected by the compile;
   for destinations the graph does not have yet, the turn either reads them (material_pending / lookup source) or the
   Keeper narrates without inventing a move receipt to an unknown scene; compile rows on every run with a candidate.
4. **Admission**: no row over 12 s; clerk writes on `path: compile`; every `review_timeout` listed with its write.
5. **Binding**: `infer(bind)` = 0; approach defaults `jev_lead` or Jev.
6. **Looks**: ≤ 1 per turn after a scene's first visit; `lookup kind=source` counted separately (they are readings).
7. **Prescreen**: status per read; fallbacks with keys; no run whose decision budget is spent by the prescreen.
8. **Drops**: every dropped draft has a `delivery ok:false` row with a reason; no stranded turn.
9. **Fiction and rules**: the prologue's rule holds (turning back or continuing ends the same way; no check forced for
   it); people met in town come from the book (a person node appears in the graph after a reading, or the Keeper says
   the book is silent), not invented stat blocks; checks the player's sentences call for (Spot Hidden on the bridge,
   Psychology on t10, Spot Hidden on t16) are rolled by `resolve`; NPC speech in tokens; no push without the player's
   declaration.
10. **Stalls**: none; any provider `error` row listed.
11. **Reading (PDF only)**: every foreground reading has a telemetry row with purpose/focus/ms and an outcome;
    `reading_timeout` rows listed with what the Keeper did next (§22.4: honest wait, no invented question);
    the graph's generation and node count after each turn; readings are published to the campaign's private
    workspace once it forks (§22.6); no reading fails on a same-span re-transcription (SL-33).

Triage after the table: every finding classed (P0 delivery/stall/import, P1 wall > 60 s cause, P2 routing/admission/
reading, P3 fiction/rules, P4 cost), one root cause per finding, evidence paths.
