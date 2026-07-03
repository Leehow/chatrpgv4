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
- `sandbox/.coc/investigators/<investigator-id>/creation.json`: rulebook Chapter 3 investigator creation record, including generated characteristics, occupation, occupation skill points, personal interest skill points, `skill_allocation`, credit rating, backstory, and starting equipment.
- `sandbox/.coc/investigators/<investigator-id>/character.json`: characteristics, derived values, skills, occupation, and reusable investigator id.
- `sandbox/.coc/investigators/<investigator-id>/history.jsonl`: sandbox-only scenario experience, final state, notable events, and unresolved threads that could carry into a later story.
- `sandbox/.coc/investigators/<investigator-id>/development.jsonl`: sandbox-only investigator development phase summary, skill checks earned, rewards, permanent-change candidates, and carryover notes.
- `sandbox/.coc/investigators/<investigator-id>/inventory-history.jsonl`: sandbox-only item, cash, handout, weapon, evidence, and optional carryover records that explain what the reusable investigator might bring or settle before a later story.
- `transcript.jsonl`: every virtual player, KP, system, and meta turn with role, text, mode, and player intent when available. In serious active runs, visible KP and virtual-player dialogue should follow `play_language`, defaulting to `zh-Hans`; for `zh-Hans`, names, setting terms, and player-visible skill display names should use `localized_terms` such as Chinese transliterations or conventional translated names, while machine-facing markers, JSON keys, filenames, canonical skill keys, rule enum values, and Mechanical Log roll text remain stable.
- `player-view.jsonl`: the player-safe view stream, including public character state and visible transcript turns only. For active localized runs, player-view `text`, `localized_text[play_language]`, and transcript `speaker` values are player-visible and must render through `play_language`, including system roll summaries, success-level labels, difficulty labels, actor display names, profile speaker labels, and skill display names. If a transcript row keeps canonical `intent` or `ruling` enum values, also write `intent_display` or `ruling_display` from `localized_text[play_language]` plus `localized_terms[play_language]` so player-view consumers do not display the canonical enum. The `public_character_state` entry is also player-visible: render scenario display fields, investigator names, occupations, player-visible skill display keys, derived display values, and backstory values through `localized_terms[play_language]` or language-profile labels. Preserve canonical rule enum values in structured payload fields, stored logs, reusable investigator/campaign source files, and Mechanical Log roll text.
- `keeper-view.jsonl`: the Keeper-only view stream, including Keeper context and `keeper_secret_ids` from `keeper-secrets.json`.
- Pushed-roll transcript turns should include `pushed_roll_protocol` stages in this order: `player_reframes_action`, `keeper_foreshadows_failure`, `player_confirms_risk`, `roll_resolved`. This proves that the player changed the fictional approach, the Keeper owned and foreshadowed the failure consequence, the player confirmed the risk, and only then did the system resolve the pushed roll.
- Completion-oriented suites should include at least one warning-gated Keeper-only reveal. The transcript should record `spoiler_protocol` stages in this order: `warning_issued`, `player_confirmed`, `limited_reveal`, with stable `spoiler_id`, `scope`, and Keeper-only `keeper_secret_id`; player-view must not expose internal secret ids. The campaign must also write a matching `sandbox/.coc/campaigns/<campaign-id>/logs/audit.jsonl` row with `type: spoiler_reveal`, `confirmed: true`, `spoiler_id`, `keeper_secret_id`, and `scope`.
- `sandbox/.coc/campaigns/<campaign-id>/logs/rolls.jsonl`: rolls and mechanical outcomes.
- Pushed roll payloads in `rolls.jsonl` should include the matching `pushed_roll_protocol.roll_id`, `failure_consequence_source: keeper`, `keeper_foreshadowed_failure: true`, and `player_confirmation_recorded: true`.
- `sandbox/.coc/campaigns/<campaign-id>/logs/events.jsonl`: scenes, clues, state changes, combat, chase, sanity, and other durable events.
- If a roll payload sets `temporary_insanity_triggered: true`, `events.jsonl` must include a `bout_of_madness` event with the `疯狂发作` behavior, 1D10-round duration, actual `duration_roll` and `duration_rounds`, Keeper control boundary, and recovery note.
- `sandbox/.coc/campaigns/<campaign-id>/memory/session-summaries.jsonl`: player-safe story recap and campaign memory.
- `player-feedback.jsonl`: virtual player ratings and comments about the KP experience.
- `evaluator-notes.jsonl`: full evaluator findings, including spoiler, state, pacing, and rules issues.
- Serious completion-oriented suites should include at least one multi-profile virtual player pressure run, or equivalent semantic evidence, so the evaluator can see how the Keeper handles careful planning, reckless risk-taking, and meta/rules challenges rather than only one scripted player style.

`battle-report.md` is an actual-play replay, not just a mechanics checklist. It should include:

- `## Run Setup`
- `## Module`
- `## Investigator Creation`
- `## Character Dossier`
- `## Investigator Chronicle`
- `## Scene-by-Scene Replay`
- `## Actual Play Replay`
- `## Session Transcript`
- `## Mechanical Log`
- `## Chase Tracker`
- `## Story Recap`
- `## Player Feedback On KP`

`## Scene-by-Scene Replay` should render each significant structured play event from `events.jsonl` before the transcript appendix: scene, clue, damage, sanity, `疯狂发作` (`bout_of_madness`), combat, chase, status, and session-ending events. Status events include final HP, final SAN, rewards, chase outcome, and other durable end-state summaries. This section is a table-readable episode map for the actual play report, not just a list of opening locations.

`## Investigator Creation` should render sandbox `creation.json` before `## Character Dossier`, proving that the playtest followed the rulebook Chapter 3 creation workflow before play began and did not only invent a finished character sheet. The section must include `skill_allocation` evidence: occupation points spent, personal-interest points spent, unallocated totals, base values, and final skill values. Requirement: skill_allocation final values must match character.json skills so the creation workflow, character dossier, and roll targets describe one investigator.

`## Investigator Chronicle` should render sandbox `history.jsonl` and `development.jsonl`, proving that the playtest can describe what would carry into a later story without writing sandbox changes into the real investigator library.

Active localized runs must render visible report headings and fields through `language_profile.report_heading_labels` and `language_profile.report_field_labels`, while preserving canonical tooling anchors in ASCII HTML comments such as `<!-- report-anchor: Run Setup -->` and `<!-- field-anchor: Campaign -->`; do not render bilingual visible headings like `# Battle Report / 跑团战报`. Run Setup display values such as dice mode, spoiler policy, language profile, localized-term summary, and player profile must render through `language_profile.report_value_labels` or language report templates while preserving canonical values in JSON. Campaign, Scenario, and Source display values must render through `localized_terms[play_language]` while preserving canonical values and file paths in JSON. Actual Play Replay and Session Transcript turn/detail display labels must render through `language_profile.transcript_labels`, speaker labels through `language_profile.speaker_labels`, and mode display values through `language_profile.transcript_mode_labels`. Transcript intent/ruling display values must render through `localized_text[play_language]` while preserving canonical values in JSON. Investigator Chronicle labels and player-visible status values must render through `language_profile.chronicle_labels`. Player Feedback On KP metric labels must render through `language_profile.feedback_labels`. Player Feedback On KP entries must render direct virtual-player feedback voice through `language_profile.report_labels.feedback_voice_default`, `feedback_voice_profile`, and `feedback_line` rather than only a scorecard row; otherwise emit `player_feedback_voice_missing`. Active localized Character Dossier sections must render occupation, era, characteristics, derived values, skills, backstory, and backstory subfields through `language_profile.character_dossier_labels`. Derived value labels such as `damage_bonus` and `build` must render through `language_profile.character_dossier_labels` rather than leaking JSON keys. Player-readable Character Dossier values, such as occupation names, must also apply `localized_terms[play_language]`. Player-visible skill display names in Character Dossier, Investigator Chronicle, Actual Play Replay, Session Transcript, Rules & Rolls Recap, and Chase Tracker must apply `localized_terms[play_language]` while preserving canonical skill keys in JSON and Mechanical Log; otherwise emit `report_skill_names_not_localized`. Player-readable report sections, including Scene-by-Scene Replay and Combat/Chase/Sanity summaries, must render localized actor display names and avoid internal actor ids. Player-readable Scene-by-Scene Replay and Clues Found entries must render scene/clue summaries without `scene_id` or `clue_id` prefixes. Scene-by-Scene Replay entries must not use raw event type enum prefixes such as `damage:` or `session ending:`. Scene-by-Scene Replay entries must not use actor-dash log prefixes such as `艾达·金 - ...`; otherwise emit `report_actor_dash_prefix`. Combat/Chase/Sanity summary entries must not use actor-colon log prefixes such as `KP:` or `艾达·金:`; otherwise emit `report_actor_colon_prefix`. If a summary sentence already begins with the localized actor name, avoid repeating it as a separate prefix. Active localized runs must render empty combat/chase/sanity/chase-tracker states through `language_profile.empty_report_lines`. Multi-profile pressure reports must persist `player_profile_labels` for the selected language and render those labels instead of profile ids in actual-play, transcript, and feedback sections. Chase Tracker labels, roles, status/difficulty values, locations, round summaries, and outcome text must render through `language_profile.chase_tracker_labels`, `localized_terms`, or `localized_text`; canonical ids may remain only as secondary audit anchors such as parenthesized ids after localized display names. Canonical ids remain allowed in Character Dossier, Mechanical Log, and stored JSON.

`## Chase Tracker` should render `save/chase.json` whenever chase state exists: participants with MOV/DEX/action economy, DEX order, location chain with hazards and barriers, per-round summaries, and final outcome. This is the report proof that the chase subsystem recorded the rulebook procedure instead of only narrating that someone escaped.

Rules & Rolls Recap boolean display values such as pushed-roll and skill-check-earned flags must render through `language_profile.report_labels`; otherwise emit `report_boolean_values_not_localized`.

Story Recap entries must render memory summaries without `session_id` or memory id prefixes; otherwise emit `report_memory_ids_not_localized`.

Flag spoiler leaks, state errors, unlogged rolls, poor pacing, incorrect rules, `investigator_creation_missing`, `investigator_skill_allocation_missing`, `investigator_skill_allocation_mismatch`, `view_separation_missing`, `player_view_secret_leak`, `player_view_localized_text_not_localized`, `player_view_transcript_details_not_localized`, `investigator_chronicle_missing`, `investigator_inventory_history_missing`, `investigator_chronicle_not_rendered`, `investigator_chronicle_labels_not_localized`, `temporary_insanity_bout_missing`, `temporary_insanity_bout_duration_missing`, `temporary_insanity_bout_not_rendered`, `status_event_not_rendered`, `haunting_npc_dialogue_missing`, `chase_player_profile_pressure_missing`, `chase_tracker_not_rendered`, `chase_tracker_labels_not_localized`, `report_shell_not_localized`, `run_setup_values_not_localized`, `module_metadata_values_not_localized`, `transcript_labels_not_localized`, `transcript_detail_values_not_localized`, `report_boolean_values_not_localized`, `player_feedback_labels_not_localized`, `player_feedback_voice_missing`, `character_dossier_labels_not_localized`, `character_dossier_derived_labels_not_localized`, `character_dossier_terms_not_localized`, `report_skill_names_not_localized`, `report_actor_ids_not_localized`, `report_state_ids_not_localized`, `report_memory_ids_not_localized`, `report_event_type_labels_not_localized`, `report_actor_label_repeated`, `report_actor_dash_prefix`, `report_actor_colon_prefix`, `localized_empty_placeholders_not_rendered`, and `player_profile_labels_not_localized`.

## Rulebook Audit Loop

Every serious playtest follows this loop:

1. Generate `battle-report.md` and `evaluation-report.md`.
2. Run `coc_playtest_audit.py <run-dir>` and read `rulebook-audit.md`.
   - Passing audits should include `## Positive Rulebook Evidence` with structured counts for transcript turns, roll protocol, pushed rolls, view streams, sanity/`疯狂发作`, subsystems, and profile-specific module or chase evidence.
3. If the audit fails, classify the first blocker before changing files:
   - `test_gap`: the simulated test did not actually exercise enough COC play.
   - `system_gap`: the Keeper system did not record or execute a rulebook-required behavior.
   - `report_gap`: the data exists, but the battle report did not show it.
   - `design_gap`: the blueprint does not require the behavior yet.
4. Read `## Blueprint Cross-Check` to decide whether the problem is missing design or designed-but-not-implemented behavior.
5. Apply the smallest targeted fix named in `## Next Loop Fix Target`.
6. Rerun the playtest reports and rulebook audit.

The baseline audit should reject reports that omit a pushed roll, status event, session ending, mechanical detail such as goals and difficulty rationale, or that leak raw payload dictionaries into player-readable prose. Active serious runs should also reject missing `player-view.jsonl` / `keeper-view.jsonl` with `view_separation_missing`, and reject any `keeper-secrets.json` id in `player-view.jsonl` with `player_view_secret_leak`.

For active localized runs, the audit must also reject visible KP/player dialogue or player-readable report sections that leak canonical glossary terms or player-visible skill display names from `localized_terms[play_language]`; use `report_skill_names_not_localized` when Character Dossier, Investigator Chronicle, Actual Play Replay, Session Transcript, Rules & Rolls Recap, or Chase Tracker leak canonical skill names. This exact check is allowed because it uses machine-controlled glossary entries and structured skill keys, not natural-language semantic matching.

When `playtest.json` sets `audit_profile: haunting_module`, the audit must also reject runs that:

- do not cover the required The Haunting beats in `module_coverage`
- omit social, pushed-roll, sanity, damage, or combat subsystem coverage
- omit structured Keeper-controlled NPC roleplay turns for core social/investigation scenes, rendered with localized `KP[NPC]` labels; otherwise emit `haunting_npc_dialogue_missing`
- omit sandbox investigator creation records with rulebook Chapter 3 steps, generated characteristics, skill-point formulas, `skill_allocation`, credit rating, backstory, and starting equipment; otherwise emit `investigator_creation_missing` or `investigator_skill_allocation_missing`
- let `skill_allocation` final values drift from `character.json` skills; otherwise emit `investigator_skill_allocation_mismatch`
- omit sandbox inventory-history records for carryover keys, handouts, weapons, cash, evidence, and optional items; otherwise emit `investigator_inventory_history_missing`
- trigger temporary insanity without a `bout_of_madness` event, actual `duration_roll`, and visible `疯狂发作` report entry
- have too few player decisions or too thin a KP/player transcript
- fail to record Corbitt combat resolution
- omit final HP, final SAN, rewards, or unresolved state
- omit Chinese visible KP/player dialogue, leak unlocalized glossary terms or skill display names, or omit the `## Actual Play Replay` section
- render a thin `## Scene-by-Scene Replay` that omits significant structured play events
- leave Chase Summary empty instead of explaining that The Haunting has no required chase sequence

When `playtest.json` sets `audit_profile: chase_drill`, the audit must also reject runs that:

- do not declare `chase` in `subsystems_covered`
- omit `save/chase.json` or leave out participants, location chain, rounds, or outcome
- omit multi-profile chase pressure from reckless, skeptical-rules, and genre-savvy player profiles, including meta questions about movement actions, pushed-roll boundaries, and spoiler-safe answers; otherwise emit `chase_player_profile_pressure_missing`
- fail to show speed roll, MOV, movement actions, hazard, barrier, conflict, and quarry escapes in Chase Summary
- fail to render a populated `## Chase Tracker` from `save/chase.json`
- claim a chase happened without recording the state and rolls that explain how it resolved
- omit Chinese visible KP/player dialogue, leak unlocalized glossary terms or skill display names, or omit the `## Actual Play Replay` section
- render a thin `## Scene-by-Scene Replay` that omits significant structured play events
