---
name: coc-playtest
description: Use when running isolated COC Keeper simulated-player tests, evaluator reviews, battle reports, evaluation reports, and regression checks in Codex.
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

Before generating reports, record the run context:

- `playtest.json`: run id, campaign id, scenario id, era, dice mode, spoiler policy, player profile, scores, pass/fail cases, recommendations.
- `sandbox/.coc/campaigns/<campaign-id>/campaign.json`: campaign title and runtime settings.
- `sandbox/.coc/campaigns/<campaign-id>/party.json`: investigator ids used in the playtest.
- `sandbox/.coc/campaigns/<campaign-id>/scenario/scenario.json`: module title, scenario id, source PDF, opening scene.
- `sandbox/.coc/investigators/<investigator-id>/character.json`: characteristics, derived values, skills, occupation, and reusable investigator id.
- `transcript.jsonl`: every virtual player, KP, system, and meta turn with role, text, mode, and player intent when available.
- `sandbox/.coc/campaigns/<campaign-id>/logs/rolls.jsonl`: rolls and mechanical outcomes.
- `sandbox/.coc/campaigns/<campaign-id>/logs/events.jsonl`: scenes, clues, state changes, combat, chase, sanity, and other durable events.
- `sandbox/.coc/campaigns/<campaign-id>/memory/session-summaries.jsonl`: player-safe story recap and campaign memory.
- `player-feedback.jsonl`: virtual player ratings and comments about the KP experience.
- `evaluator-notes.jsonl`: full evaluator findings, including spoiler, state, pacing, and rules issues.

`battle-report.md` is an actual-play replay, not just a mechanics checklist. It should include:

- `## Run Setup`
- `## Module`
- `## Character Dossier`
- `## Session Transcript`
- `## Mechanical Log`
- `## Story Recap`
- `## Player Feedback On KP`

Flag spoiler leaks, state errors, unlogged rolls, poor pacing, and incorrect rules.
