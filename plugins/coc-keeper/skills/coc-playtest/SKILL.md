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
- `--profile chase-drill`: rulebook chase drill that writes `save/chase.json` and shows speed roll, MOV, movement actions, location chain, DEX order, hazard, barrier, conflict, and why the quarry escapes.

Use `../../scripts/coc_playtest_report.py` to generate:

- `artifacts/battle-report.md`
- `artifacts/evaluation-report.md`

Use `../../scripts/coc_playtest_audit.py` after report generation to generate:

- `artifacts/rulebook-audit.md`

Use `../../scripts/coc_playtest_suite.py` after multiple serious runs to generate:

- `.coc/playtests/index.json`
- `.coc/playtests/loop-decision.json`
- `.coc/playtests/suite-report.md`

Use `../../scripts/coc_completion_audit.py` when `loop-decision.json` reports `ready_for_completion_audit` to generate:

- `.coc/playtests/completion-audit.json`
- `.coc/playtests/completion-audit.md`

`suite-report.md` should include `## Run Index`, `## Non-Passing Runs`, `## Loop Decision`, and a `## Core Coverage Matrix` with `character_dossier`, `kp_player_transcript`, `mechanical_rolls`, `combat`, `chase`, `sanity`, `meta_game`, and `player_feedback`, so the evaluator can see whether the current playtest set covers the requested Keeper Rulebook workflows without hiding failed or missing audits.

`loop-decision.json` is the next-action gate for the continuous loop. It records `evaluated_runs`, `ignored_historical_runs`, `blockers`, and status. `needs_repair` means fix the first blocker and rerun the loop. `ready_for_completion_audit` means current active runs have no coverage or quality gaps, so run `coc_completion_audit.py` and inspect `completion-audit.md/json` before claiming the goal is done.

## Semantic Matcher Constitution

Do not use a natural-language matcher based on literal headings, keyword hits, or fixed prose fragments to prove playtest coverage, module fidelity, rule intent, spoiler safety, player intent, or KP answer quality. If a judgment depends on what human-language text means, route it through an LLM semantic evaluator and record the evaluator id plus `coverage_reasons`.

Exact matching is allowed only for machine-controlled schema fields, enum values, JSON keys, file paths, and system markers such as `coverage_evaluator`, `coverage_reasons`, `run_id`, `audit_profile`, or `subsystems_covered`. Offline deterministic tests may inject a fixture evaluator. The default non-LLM path may use structured source data only; it must not claim semantic coverage from Markdown section titles or keyword snippets.

## LLM Semantic Evaluation Artifacts

For semantic review, run `../../scripts/coc_playtest_suite.py --write-semantic-requests --root <repo-root>` to write `artifacts/semantic-eval-request.json` for each playtest run. The harness must not fabricate `semantic-eval-result.json`; Codex or another LLM semantic evaluator should read that exact request and write the result.

`semantic-eval-result.json` must include `schema_version`, `run_id`, `evaluator_id`, `evaluation_provenance`, `coverage`, `quality`, `root_cause_classification`, and `next_loop_fix_target`. `evaluation_provenance.kind` must be `llm`, and `evaluation_provenance.request_sha256` must match the canonical JSON hash of the request that was reviewed. The `coverage` object uses the same keys as the suite matrix and each value must include `covered` plus a semantic `reason`.

The request also includes `quality_dimensions`, and the result `quality` object must score `module_fidelity`, `rulebook_procedure`, `immersion_and_pacing`, `chinese_visible_dialogue`, `actual_play_replay`, `state_continuity`, `spoiler_safety`, `player_agency`, `virtual_player_pressure`, and `report_completeness`. Each dimension must include `score`, `passed`, and `reason`; the suite report surfaces these in `## Quality Matrix` and records unresolved `quality_gaps`.

After result files exist, run `../../scripts/coc_playtest_suite.py --evaluator semantic-artifact --root <repo-root>`. The suite must use the result file's `evaluator_id` and reasons instead of fallback structured-source coverage. If the result file is missing, the `semantic-artifact` evaluator should mark coverage missing rather than inventing a natural-language match.

Before generating reports, record the run context:

- `playtest.json`: run id, campaign id, scenario id, era, dice mode, spoiler policy, player profile, `play_language`, `localized_terms`, scores, pass/fail cases, recommendations.
- `sandbox/.coc/campaigns/<campaign-id>/campaign.json`: campaign title and runtime settings.
- `sandbox/.coc/campaigns/<campaign-id>/party.json`: investigator ids used in the playtest.
- `sandbox/.coc/campaigns/<campaign-id>/scenario/scenario.json`: module title, scenario id, source PDF, opening scene.
- `sandbox/.coc/investigators/<investigator-id>/character.json`: characteristics, derived values, skills, occupation, and reusable investigator id.
- `sandbox/.coc/investigators/<investigator-id>/history.jsonl`: sandbox-only scenario experience, final state, notable events, and unresolved threads that could carry into a later story.
- `sandbox/.coc/investigators/<investigator-id>/development.jsonl`: sandbox-only investigator development phase summary, skill checks earned, rewards, permanent-change candidates, and carryover notes.
- `transcript.jsonl`: every virtual player, KP, system, and meta turn with role, text, mode, and player intent when available. In serious active runs, visible KP and virtual-player dialogue should follow `play_language`, defaulting to `zh-Hans`; for `zh-Hans`, names and setting terms should use `localized_terms` such as Chinese transliterations or conventional translated names, while machine markers, JSON keys, skill names, rule enum values, and system roll text remain stable.
- `sandbox/.coc/campaigns/<campaign-id>/logs/rolls.jsonl`: rolls and mechanical outcomes.
- `sandbox/.coc/campaigns/<campaign-id>/logs/events.jsonl`: scenes, clues, state changes, combat, chase, sanity, and other durable events.
- If a roll payload sets `temporary_insanity_triggered: true`, `events.jsonl` must include a `bout_of_madness` event with the Bout of Madness behavior, 1D10-round duration, actual `duration_roll` and `duration_rounds`, Keeper control boundary, and recovery note.
- `sandbox/.coc/campaigns/<campaign-id>/memory/session-summaries.jsonl`: player-safe story recap and campaign memory.
- `player-feedback.jsonl`: virtual player ratings and comments about the KP experience.
- `evaluator-notes.jsonl`: full evaluator findings, including spoiler, state, pacing, and rules issues.
- Serious completion-oriented suites should include at least one multi-profile virtual player pressure run, or equivalent semantic evidence, so the evaluator can see how the Keeper handles careful planning, reckless risk-taking, and meta/rules challenges rather than only one scripted player style.

`battle-report.md` is an actual-play replay, not just a mechanics checklist. It should include:

- `## Run Setup`
- `## Module`
- `## Character Dossier`
- `## Investigator Chronicle`
- `## Scene-by-Scene Replay`
- `## Actual Play Replay`
- `## Session Transcript`
- `## Mechanical Log`
- `## Chase Tracker`
- `## Story Recap`
- `## Player Feedback On KP`

`## Scene-by-Scene Replay` should render each significant structured play event from `events.jsonl` before the transcript appendix: scene, clue, damage, sanity, Bout of Madness, combat, chase, and session-ending events. This section is a table-readable episode map for the actual play report, not just a list of opening locations.

`## Investigator Chronicle` should render sandbox `history.jsonl` and `development.jsonl`, proving that the playtest can describe what would carry into a later story without writing sandbox changes into the real investigator library.

`## Chase Tracker` should render `save/chase.json` whenever chase state exists: participants with MOV/DEX/action economy, DEX order, location chain with hazards and barriers, per-round summaries, and final outcome. This is the report proof that the chase subsystem recorded the rulebook procedure instead of only narrating that someone escaped.

Flag spoiler leaks, state errors, unlogged rolls, poor pacing, incorrect rules, `investigator_chronicle_missing`, `investigator_chronicle_not_rendered`, `temporary_insanity_bout_missing`, `temporary_insanity_bout_duration_missing`, `temporary_insanity_bout_not_rendered`, and `chase_tracker_not_rendered`.

## Rulebook Audit Loop

Every serious playtest follows this loop:

1. Generate `battle-report.md` and `evaluation-report.md`.
2. Run `coc_playtest_audit.py <run-dir>` and read `rulebook-audit.md`.
   - Passing audits should include `## Positive Rulebook Evidence` with structured counts for transcript turns, roll protocol, pushed rolls, sanity/Bout of Madness, subsystems, and profile-specific module or chase evidence.
3. If the audit fails, classify the first blocker before changing files:
   - `test_gap`: the simulated test did not actually exercise enough COC play.
   - `system_gap`: the Keeper system did not record or execute a rulebook-required behavior.
   - `report_gap`: the data exists, but the battle report did not show it.
   - `design_gap`: the blueprint does not require the behavior yet.
4. Read `## Blueprint Cross-Check` to decide whether the problem is missing design or designed-but-not-implemented behavior.
5. Apply the smallest targeted fix named in `## Next Loop Fix Target`.
6. Rerun the playtest reports and rulebook audit.

The baseline audit should reject reports that omit a pushed roll, session ending, mechanical detail such as goals and difficulty rationale, or that leak raw payload dictionaries into player-readable prose.

For active localized runs, the audit must also reject visible KP/player dialogue or player-readable report sections that leak canonical glossary terms from `localized_terms[play_language]`. This exact check is allowed because it uses machine-controlled glossary entries, not natural-language semantic matching.

When `playtest.json` sets `audit_profile: haunting_module`, the audit must also reject runs that:

- do not cover the required The Haunting beats in `module_coverage`
- omit social, pushed-roll, sanity, damage, or combat subsystem coverage
- trigger temporary insanity without a `bout_of_madness` event, actual `duration_roll`, and visible `Bout of Madness` report entry
- have too few player decisions or too thin a KP/player transcript
- fail to record Corbitt combat resolution
- omit final HP, final SAN, rewards, or unresolved state
- omit Chinese visible KP/player dialogue, leak unlocalized glossary terms, or omit the `## Actual Play Replay` section
- render a thin `## Scene-by-Scene Replay` that omits significant structured play events
- leave Chase Summary empty instead of explaining that The Haunting has no required chase sequence

When `playtest.json` sets `audit_profile: chase_drill`, the audit must also reject runs that:

- do not declare `chase` in `subsystems_covered`
- omit `save/chase.json` or leave out participants, location chain, rounds, or outcome
- fail to show speed roll, MOV, movement actions, hazard, barrier, conflict, and quarry escapes in Chase Summary
- fail to render a populated `## Chase Tracker` from `save/chase.json`
- claim a chase happened without recording the state and rolls that explain how it resolved
- omit Chinese visible KP/player dialogue, leak unlocalized glossary terms, or omit the `## Actual Play Replay` section
- render a thin `## Scene-by-Scene Replay` that omits significant structured play events
