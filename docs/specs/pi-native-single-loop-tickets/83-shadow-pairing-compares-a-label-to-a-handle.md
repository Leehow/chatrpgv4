Status: ready (filed 2026-09-26 from SL-77's report; batch 14)
Stage: SL-83 (P2, SL-76 follow-up: the shadow pairing for `npc_reaction`)
Spec: docs/specs/jev-driven-steps.md D4; docs/kernel-rpc.md §135.32; `runtime/jev/hybrid-engine.ts` `keeperDidFor`; SL-77's `tests/play/jev-steps-report.py` (`corrected_npc_reaction` shows the fix's effect)

# SL-83 — `keeperDidFor` compares the `npc_reaction` candidate's display label ("Vittorio Macario") with the first-impression receipt's handle (`vittorio-macario`): it can never pair

## Evidence (SL-77 on gates #14/#15)
- `npc_reaction` agreement 0/4 and 0/2 raw. Every cleared row is a real engagement (t6 the sanatorium visit, t7 Gabriela addressed by name; the compile's own `addressee` feature at 1.0 on one). t6's receipts DO carry `roll decision: natural-npc:first-impression, npc: vittorio-macario` — the pairing missed it because it compared the label. With label→handle resolution through the turn's own `person` receipts the agreement is 3/6 = 0.50 (#14) and 3/5 = 0.60 (#15).
- `clue_follow_up` pairs by handle and is clean (6/6, 6/6).

## Ruling
The candidate carries the NPC's handle (it is built from the roster/graph node) and the pairing compares handles, never labels; the label stays on the row for humans. Also count, for the report, the Keeper's `say`/speech to the same handle as `other` (it engaged but did not roll), so a definitional miss (the Keeper simply never stages a first impression) is separated from a pairing miss.

## Scope
- `runtime/jev/hybrid-engine.ts` `keeperDidFor` (+ the candidate's `bound.target` = handle, label in `label`); tests: a first-impression receipt on the handle pairs `true`; a label-only comparison is the mutation; a speech to the handle pairs `other`.
- Re-run `tests/play/jev-steps-report.py` on #14/#15 after the fix and paste the corrected tables into SL-77.

## Comments
