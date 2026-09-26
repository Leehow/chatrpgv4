Status: ready (filed 2026-09-26 from long gate #17; batch 15)
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
