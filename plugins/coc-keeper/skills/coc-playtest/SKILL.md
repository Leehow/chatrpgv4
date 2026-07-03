---
name: coc-playtest
description: Run isolated COC Keeper playtests in Codex. Use for simulated-player testing, Keeper-under-test sessions, evaluator reviews, battle reports, evaluation reports, and regression checks.
---

# COC Playtest

## Isolation

Playtests write to `.coc/playtests/<run-id>/` and must not mutate real `.coc/campaigns/` or `.coc/investigators/` data.

## Roles

- `keeper_under_test`: runs the COC mode behavior being tested.
- `player_simulator`: sees player-safe information only.
- `evaluator`: inspects full logs and reports after the run.

## Reports

Use `../../scripts/coc_playtest_report.py` to generate:

- `artifacts/battle-report.md`
- `artifacts/evaluation-report.md`

Flag spoiler leaks, state errors, unlogged rolls, poor pacing, and incorrect rules.
