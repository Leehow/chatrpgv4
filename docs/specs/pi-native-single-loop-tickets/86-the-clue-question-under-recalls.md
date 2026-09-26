Status: ready (filed 2026-09-26 from long gate #17; batch 15; load the `typesafe-jev` skill first)
Stage: SL-86 (P1, Stage 2b's lever: the `clue_follow_up` question's recall)
Spec: docs/specs/jev-driven-steps.md D1 (`clue_follow_up`), D2 (question hygiene), D6 2b; `runtime/jev/consequence-candidates.ts` / `consequence-route.ts`; `content/rulesets/coc7/host-budgets.json` `jev_steps.row_min/row_ratio`; skill `~/.claude/skills/typesafe-jev` (literal reading; state minimal but sufficient; `what/not_for/examples`; thresholds by cost of error)

# SL-86 — Jev clears 2 of the 9 clues the Keeper then files: the `clue_follow_up` question under-recalls, so the residual does not move

## Evidence (gate #17, execute mode)
- Offered 36 distinct (turn, clue) rows over 13 turns; cleared 2 (both filed, both right); false positives 0 (also 0/0/1 on #14/#15/#16). False negatives 7: the Keeper filed the clue the same turn while Jev's `yes` sat at 0.12–0.45 (`nailed-windows` 0.24 on "walk around the house, look at the windows, locks and the basement vents"; `catholic-wards` 0.12 and `upstairs-disturbance` 0.20 on "go in, room by room, kitchen first"; `gabriela-night-visitor` 0.37 on "find Gabriela and ask about the night they left").
- Four tables, ~140 clue rows: precision 1.0 at the current gate (`yes ≥ 0.5 and ≥ 2×no`), recall ≈ 0.2. The cost asymmetry is the reverse of what the gate assumes: a wrongly filed clue is reversible by the Keeper with a receipt (D3), a missed one costs a Keeper write (3 s + a refusal risk) — the residual Stage 2 exists to remove.

## Ruling (filed for the owner)
Two changes, measured separately on the next table: (1) the question's state carries what "reach" means for this clue — the book's `found_at` cues / the scene or object the clue sits in (§32 affordances already carry `found_at[].cues`), and the settled action's place/object/person as receipts name them — with `what / not_for / examples` criteria per the skill (the miss cases above as examples of `what`, "the player only names the place from afar" as `not_for`); (2) the clue class gets its own gate in data (`jev_steps.classes.clue_follow_up.row_min`, start at 0.35 with the ratio kept) because its error costs differ from a reaction's. Report recall/precision per table in SL-77's script; the bar to keep (2) is precision ≥ 0.9.

## Scope
- `consequence-candidates.ts` (clue detail: cues, placement), `consequence-route.ts` (instructions/criteria; per-class gate), `host-budgets.ts`/`host-budgets.json`; tests: the state carries cues; per-class gate read from data; mutation: drop the cues → the fixture question loses them.

## Comments
