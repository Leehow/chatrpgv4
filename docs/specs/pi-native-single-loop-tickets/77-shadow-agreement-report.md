Status: ready (filed 2026-09-26; batch 13; measurement only, after SL-76 is on a table)
Stage: SL-77 (P1, measurement; Stage 2a acceptance of `docs/specs/jev-driven-steps.md` D6)
Spec: docs/specs/jev-driven-steps.md D4/D6

# SL-77 — Shadow agreement per class on two long gates, before any behaviour changes

## Scope
- `tests/play/long-gate-triage.py` (or a sibling `jev-steps-report.py`) reads `lane:"route", shadow:true` rows and reports per class: offered, cleared, `keeper_did` true/false/other, agreement where the Keeper acted, false positives read against the transcript (each listed with turn and the Keeper's prose), added Jev ms per turn.
- Run on gates #13 and #14 (they carry SL-76 in shadow by default). Write the numbers into this ticket and `docs/specs/jev-driven-steps.md` D6; the decision to open SL-78 is the owner's on these numbers.
- No product code.

## Comments
