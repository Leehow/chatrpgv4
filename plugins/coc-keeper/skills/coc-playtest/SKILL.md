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

Use `../../scripts/coc_playtest_harness.py` when you need a reproducible baseline run:

- `--profile rulebook-smoke`: short The Haunting-derived smoke run for the ordinary investigation loop.
- `--profile haunting-module`: module-level The Haunting run that reaches Mr. Knott, Arty Wilmot, Chapel clues, the Corbitt House, Bed Attack, basement hazards, The Floating Knife, Corbitt combat, final state, rewards, and player feedback.

Use `../../scripts/coc_playtest_report.py` to generate:

- `artifacts/battle-report.md`
- `artifacts/evaluation-report.md`

Use `../../scripts/coc_playtest_audit.py` after report generation to generate:

- `artifacts/rulebook-audit.md`

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

## Rulebook Audit Loop

Every serious playtest follows this loop:

1. Generate `battle-report.md` and `evaluation-report.md`.
2. Run `coc_playtest_audit.py <run-dir>` and read `rulebook-audit.md`.
3. If the audit fails, classify the first blocker before changing files:
   - `test_gap`: the simulated test did not actually exercise enough COC play.
   - `system_gap`: the Keeper system did not record or execute a rulebook-required behavior.
   - `report_gap`: the data exists, but the battle report did not show it.
   - `design_gap`: the blueprint does not require the behavior yet.
4. Read `## Blueprint Cross-Check` to decide whether the problem is missing design or designed-but-not-implemented behavior.
5. Apply the smallest targeted fix named in `## Next Loop Fix Target`.
6. Rerun the playtest reports and rulebook audit.

The baseline audit should reject reports that omit a pushed roll, session ending, mechanical detail such as goals and difficulty rationale, or that leak raw payload dictionaries into player-readable prose.

When `playtest.json` sets `audit_profile: haunting_module`, the audit must also reject runs that:

- do not cover the required The Haunting beats in `module_coverage`
- omit social, pushed-roll, sanity, damage, or combat subsystem coverage
- have too few player decisions or too thin a KP/player transcript
- fail to record Corbitt combat resolution
- omit final HP, final SAN, rewards, or unresolved state
- leave Chase Summary empty instead of explaining that The Haunting has no required chase sequence
