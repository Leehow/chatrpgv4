Status: ready-for-human (implemented 2026-09-26 on `claude/sl86-20260926`, after SL-86 landed on the same branch)
Stage: SL-85 (P3, SL-78 follow-up: residual and pairing rows in `on` mode)
Spec: docs/kernel-rpc.md §135.32 addendum 2 (residual row, execution point), `runtime/jev/hybrid-engine.ts` (`recordResidual`, `keeperDidFor`, `routeConsequencesAfterWrite`), `tests/play/jev-steps-report.py`

# SL-85 — In `on` mode the residual row is written twice on some turns and not at all on others, and an executed candidate pairs with its own receipt

## Evidence (gate #17)
- `residual` rows: duplicates on turns 5, 7, 20; none on turns 1, 11, 12, 14, 17, 19 (all delivered turns). The row is written at turn close; a turn with two runs (a steer leg) writes twice, a turn closed by a path that bypasses `turnCloseStep` writes none.
- Executed `clue_follow_up` rows (t2 macario-tragedy, t5 burning-eyes-form) carry `keeper_did: true` — the pairing at turn close reads the clerk's own clue receipt. For an executed candidate the meaningful pairing is "did the Keeper re-file the same handle" (should be `false`/absent) and "did the prose carry it".
- The report's shadow filter counted 0 rows on this table although 13 `npc_reaction` rows exist with `keeper_did`: in `on` mode unlisted classes' rows must still say `shadow: true` (or the report must key on `executed: false`).

## Ruling
One residual row per turn, written on the turn's close whichever path closes it (keyed by turn, last writer wins); an executed candidate's row carries `executed: true` and pairs against Keeper writes other than the clerk's own receipt; unexecuted classes' rows in `on` mode carry `shadow: true`; the report reads these fields.

## Scope
- `hybrid-engine.ts` residual write site(s) and pairing; report; tests: two runs in a turn → one row; a turn closed by the fallback path → one row; executed row → `executed: true`, `keeper_did` false when the Keeper did not re-file; shadow flag on unlisted classes in `on`.

## Comments

**2026-09-26, implemented.** Contract: `docs/kernel-rpc.md` §135.32 addendum 4 (written alongside code, correcting addendum 2's "once per turn" claim). All three ruling items landed in `runtime/jev/hybrid-engine.ts`:

1. **One residual row per turn, whichever path closes it.** A new `closeConsequences(run)` is the single place that calls `pairConsequences(run)`/`recordResidual(run)`, guarded by `run.residualWritten` (set the first time it actually runs). `turnCloseStep` calls it from every branch that is a genuine close (`delivered`, `none`, the `!closer`/verdict-threw `unavailable` branches) but *not* from the `steer` branch -- a `turn_close` proposal that comes back `steer` is not a close, the run continues, and the *next*, truly final call is the one and only writer. `modelStep` calls the same `closeConsequences(run)` when its own `narrate`/`ask` call delivers (`DELIVERY_VERBS`), covering the path `turn_close` is never proposed for at all (§135.11: it is proposed only for "a run with no delivery evidence"). This path asks Jev nothing new: it only writes telemetry over whatever this run's own writes already routed via `routeConsequencesAfterWrite`.
2. **Executed candidate pairs against Keeper writes other than the clerk's own receipt.** `clerkStep` now records an executed consequence candidate's own receipt ids on `run.consequenceExecutedReceiptIds` (`packet.receipts` -- confirmed against `extensions/kernel/canonical-operation-dispatcher.ts` to be an array of receipt id *strings*, not objects, which the first draft of this fix got wrong and a test caught). `pairConsequences` excludes those ids from the receipts `keeperDidFor` sees for that row, and stamps the row `executed: true`.
3. **Shadow flag on unexecuted classes' rows in `on`.** `pairConsequences`'s per-row `shadow` is now `mode !== 'on' || !executed` instead of one blanket `mode !== 'on'` for the whole turn -- so a class that never executes (unlisted in `jev_steps.execute`, e.g. `npc_reaction` today, or a listed class's own row on a turn it did not clear) still reads `shadow: true` under `on`; only a genuinely executed row reads `shadow: false`.

**Tests.** New file `tests/extension/consequence-residual-pairing.test.mjs` (engine seam, stub `DecisionPort` and gateway, same harness shape as `consequence-execute-mode.test.mjs` plus a mutable turn-close verdict): 7 tests, all passing -- steer-then-close writes one row reflecting the *later* call's state (a tool call made between the two turn_close proposals, so the test cannot pass on a "first writer wins" implementation); a Keeper `narrate` delivery with no `turn_close` proposal at all writes exactly one row, no new Jev call; a defensive double-close still writes once; an executed row carries `executed: true`, `shadow: false`, `keeper_did: false` against its own receipt alone, and `true` against a genuinely independent receipt; an unexecuted/unlisted class's row carries `shadow: true` under `on`; `shadow` mode unaffected. Full suites still green: `consequence-*.test.mjs` 67/67, `single-loop-*.test.mjs` 174/174, `jev-*.test.mjs` 443/443 (node --test, no live calls).

**A real regression caught and fixed along the way (not shipped):** the first draft also called `routeConsequences` (a fresh Jev decision batch) from `modelStep`'s delivery branch, reasoning the design wanted the "latest" D1 state at every close. That broke `tests/extension/single-loop-prescreen-budget.test.mjs`'s "a read_more on the same scene reuses the first read's prescreen: its materials, no Jev call" by adding an uncounted-for decision call the test's mock wasn't calibrated for. Removed: the bypass-path fix now only writes telemetry over already-routed state, never asks Jev again. Left as a note for whoever eventually revisits `routeConsequences`'s call sites: the assumption "one Jev call per run" is load-bearing in several other tests too.

**Mutation evidence** (copy-edit-run-restore on a scratch copy of `hybrid-engine.ts`, never `git checkout --`): removing the `residualWritten` guard -> 1 test failed (the double-close case; the steer-vs-close cardinality itself is enforced by *not calling* `closeConsequences` on the `steer` branch, a separate mutation below). Making the `steer` branch also call `closeConsequences` -> 1 test failed once the steer test was strengthened to check the row's *content* (a naive "count the rows" version of that test did NOT catch this mutation -- recorded here so the next reader does not repeat it). Reverting the receipt-exclusion to plain `run.turnReceipts` -> 1 test failed. Reverting the per-row `shadow` to the old blanket `mode !== 'on'` -> 1 test failed (only the unexecuted-class test, as expected: an executed row's `shadow: false` is unaffected either way). Removing the `executed: true` stamp -> 2 tests failed. Removing the `modelStep` bypass-path call entirely -> 1 test failed. Every mutation restored from the scratch copy afterward; full suites re-confirmed green.

**Report** (`tests/play/jev-steps-report.py`): the per-class table gains `executed`/`shadow` columns; a new section lists any `(turn, class, key)` offered more than once. Run against gate #17 (`/Users/haoli/leehow/code/chatrpgv4-wt-gate-f332d72bc/.coc/campaigns/longgate17-haunting-0831`, read-only, no live calls -- this is historical telemetry from before this ticket's code existed, so `executed`/`shadow` read empty on every row, correctly: the fields did not exist yet when it was recorded):
```
-- duplicate candidate rows for the same (turn, class, key) (SL-85: pre-fix telemetry, a steer leg or a bypassed turn_close) --
  turn 5 [clue_follow_up] key='consequence:clue_follow_up:burning-eyes-form': 2 rows
  turn 5 [clue_follow_up] key='consequence:clue_follow_up:chapel-ruins-location': 2 rows
  turn 5 [clue_follow_up] key='consequence:clue_follow_up:dooley-macario-madness': 2 rows
  turn 7 [clue_follow_up] key='consequence:clue_follow_up:boys-burning-eyes': 2 rows
  turn 7 [clue_follow_up] key='consequence:clue_follow_up:gabriela-night-visitor': 2 rows
  turn 7 [clue_follow_up] key='consequence:clue_follow_up:vittorio-bible-weapon': 2 rows
  turn 7 [npc_reaction] key='consequence:npc_reaction:托马斯·海斯:vittorio-macario': 2 rows
  turn 20 [clue_follow_up] key='consequence:clue_follow_up:knott-commission': 2 rows
```
This lines up exactly with the ticket's own evidence (duplicates on turns 5, 7, 20). A table played with this ticket's fix should show this section empty; that is a live-table check, not made here (hard rule: no live Jev/model calls this worker).

**Not done / left for the human:** a live table to confirm no duplicate/missing residual rows under the fix, and that `executed`/`shadow` read as designed on freshly recorded telemetry (this worker made no live Jev calls, per the hard rule); the `routeConsequences` "one Jev call per run" load-bearing assumption noted above, if anyone later wants the bypass-delivery path to also refresh D1 state via a live Jev ask.
