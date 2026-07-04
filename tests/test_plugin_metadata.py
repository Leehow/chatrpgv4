import json
from pathlib import Path


PLUGIN_ROOT = Path("plugins/coc-keeper")


def test_plugin_manifest_declares_coc_keeper_skill_plugin():
    manifest_path = PLUGIN_ROOT / ".codex-plugin" / "plugin.json"
    assert manifest_path.exists()

    manifest = json.loads(manifest_path.read_text())
    assert manifest["name"] == "coc-keeper"
    assert manifest["version"] == "0.1.0"
    assert manifest["skills"] == "./skills/"
    assert manifest["interface"]["displayName"] == "COC Keeper"
    assert "Call of Cthulhu" in manifest["description"]


def test_validate_rules_script_accepts_seed_rules():
    import importlib.util

    path = PLUGIN_ROOT / "scripts" / "coc_validate.py"
    spec = importlib.util.spec_from_file_location("coc_validate", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)

    assert module.validate_rules(PLUGIN_ROOT) == []


def test_all_v1_skills_have_valid_frontmatter():
    expected = {
        "coc-main",
        "coc-campaign-state",
        "coc-rules-engine",
        "coc-character",
        "coc-scenario-import",
        "coc-keeper-play",
        "coc-meta",
        "coc-playtest",
        "coc-combat",
        "coc-chase",
        "coc-sanity",
        "coc-mythos-reference",
    }
    found = set()
    for skill_path in (PLUGIN_ROOT / "skills").glob("*/SKILL.md"):
        text = skill_path.read_text()
        assert text.startswith("---\n")
        header = text.split("---", 2)[1]
        name_line = next(line for line in header.splitlines() if line.startswith("name: "))
        description_line = next(line for line in header.splitlines() if line.startswith("description: "))
        name = name_line.split(": ", 1)[1].strip()
        description = description_line.split(": ", 1)[1].strip()
        assert name == skill_path.parent.name
        assert len(description) > 40
        found.add(name)
    assert found == expected


def test_reference_documents_exist_and_use_ascii_system_markers():
    reference_names = ["mode-protocol.md", "state-schema.md", "rules-json-guide.md"]
    for name in reference_names:
        path = PLUGIN_ROOT / "references" / name
        assert path.exists()
        text = path.read_text()
        assert "[meta]" in text or name != "mode-protocol.md"
        assert "[spoiler_warning]" in text or name != "mode-protocol.md"
        for marker in ["[超游]", "[剧透警告]", "[回到游戏]"]:
            assert marker not in text


def test_rules_json_guide_documents_rule_index_traceability():
    guide_text = (PLUGIN_ROOT / "references" / "rules-json-guide.md").read_text()
    spec_text = Path("docs/superpowers/specs/2026-07-03-coc-keeper-design.md").read_text()
    required_terms = [
        "rule-index.json",
        "rule_refs",
        "core.percentile_check",
        "module.haunting.corbitt_flesh_ward",
    ]
    for term in required_terms:
        assert term in guide_text
        assert term in spec_text


def test_mode_protocol_documents_play_language_and_localized_terms():
    text = (PLUGIN_ROOT / "references" / "mode-protocol.md").read_text()
    required_terms = [
        "play_language",
        "zh-Hans",
        "language_profile",
        "localized_terms",
        "localized_text",
        "Chinese transliterations",
        "conventional translated names",
        "campaign titles",
        "player-visible module source labels",
        "empty_report_lines",
        "speaker_labels",
        "transcript_mode_labels",
        "player-visible skill display names",
        "machine-facing markers, JSON keys, filenames, canonical skill keys, rule enum values, stable IDs, and hidden Mechanical Log audit anchors",
    ]
    for term in required_terms:
        assert term in text


def test_design_blueprint_documents_play_language_and_localized_terms():
    text = Path("docs/superpowers/specs/2026-07-03-coc-keeper-design.md").read_text()
    required_terms = [
        "play_language",
        "zh-Hans",
        "language_profile",
        "localized_terms",
        "localized_text",
        "Chinese transliterations",
        "conventional translated names",
        "campaign titles",
        "player-visible module source labels",
        "empty_report_lines",
        "speaker_labels",
        "transcript_mode_labels",
        "player-visible skill display names",
        "machine-facing markers, JSON keys, filenames, canonical skill keys, rule enum values, stable IDs, and hidden Mechanical Log audit anchors",
    ]
    for term in required_terms:
        assert term in text


def test_coc_playtest_skill_documents_battle_report_inputs():
    text = (PLUGIN_ROOT / "skills" / "coc-playtest" / "SKILL.md").read_text()
    required_terms = [
        "campaign.json",
        "party.json",
        "scenario.json",
        "character.json",
        "history.jsonl",
        "development.jsonl",
        "transcript.jsonl",
        "player-view.jsonl",
        "keeper-view.jsonl",
        "rolls.jsonl",
        "events.jsonl",
        "session-summaries.jsonl",
        "player-feedback.jsonl",
        "## Run Setup",
        "## Character Dossier",
        "## Investigator Chronicle",
        "## Chase Tracker",
        "## Player Feedback On KP",
    ]
    for term in required_terms:
        assert term in text


def test_design_blueprint_documents_investigator_chronicle_playtest_gate():
    text = Path("docs/superpowers/specs/2026-07-03-coc-keeper-design.md").read_text()
    required_terms = [
        "## Investigator Chronicle",
        "history.jsonl",
        "development.jsonl",
        "investigator_chronicle_missing",
        "temporary_insanity_bout_missing",
        "temporary_insanity_bout_mode_mismatch",
        "temporary_insanity_bout_duration_missing",
        "temporary_insanity_bout_rounds_missing",
        "table_viii_summary",
        "summary_roll",
        "chase_tracker_not_rendered",
        "chase_tracker_labels",
        "chase_tracker_labels_not_localized",
        "chase_dex_order_not_proven",
        "item_transfer",
        "chase_object_transfer_missing",
        "resource_change",
        "haunting_corbitt_magic_points_missing",
        "haunting_corbitt_own_dagger_exception_missing",
        "chase_dex_order_not_proven",
        "Corbitt Magic points",
        "flesh_ward",
        "own_dagger_ignores_spells",
        "Flesh Ward",
        "report_actor_ids_not_localized",
        "report_actor_label_repeated",
        "report_actor_dash_prefix",
        "report_actor_colon_prefix",
        "localized_empty_placeholders_not_rendered",
        "player_profile_labels",
        "player_profile_labels_not_localized",
        "core.character_creation.movement_rate",
        "derived_movement_rate_mismatch",
        "report_heading_labels",
        "report_field_labels",
        "report_value_labels",
        "report_shell_not_localized",
        "run_setup_values_not_localized",
        "module_metadata_values_not_localized",
        "transcript_labels",
        "speaker_labels",
        "transcript_mode_labels",
        "transcript_labels_not_localized",
        "transcript_detail_values_not_localized",
        "report_boolean_values_not_localized",
        "chronicle_labels",
        "investigator_chronicle_labels_not_localized",
        "feedback_labels",
        "player_feedback_labels_not_localized",
        "feedback_voice_default",
        "feedback_voice_profile",
        "player_feedback_voice_missing",
        "character_dossier_labels",
        "character_dossier_labels_not_localized",
        "character_dossier_derived_labels_not_localized",
        "character_dossier_terms_not_localized",
        "report_skill_names_not_localized",
        "report_state_ids_not_localized",
        "report_memory_ids_not_localized",
        "report_event_type_labels_not_localized",
        "疯狂发作",
        "bout_of_madness",
        "duration_roll",
        "playtests prove investigator reuse without writing sandbox changes into the real investigator library",
    ]
    for term in required_terms:
        assert term in text


def test_coc_playtest_skill_documents_rulebook_audit_loop():
    skill_text = (PLUGIN_ROOT / "skills" / "coc-playtest" / "SKILL.md").read_text()
    spec_text = Path("docs/superpowers/specs/2026-07-03-coc-keeper-design.md").read_text()
    required_terms = [
        "coc_playtest_harness.py",
        "coc_playtest_audit.py",
        "rulebook-audit.md",
        "pushed roll",
        "pushed_roll_protocol",
        "player_reframes_action",
        "keeper_foreshadows_failure",
        "player_confirms_risk",
        "temporary_insanity_bout_missing",
        "temporary_insanity_bout_mode_mismatch",
        "temporary_insanity_bout_duration_missing",
        "temporary_insanity_bout_rounds_missing",
        "table_viii_summary",
        "summary_roll",
        "疯狂发作",
        "bout_of_madness",
        "duration_roll",
        "control_returned",
        "Positive Rulebook Evidence",
        "session ending",
        "mechanical detail",
        "raw payload",
        "transcript_turn_sequence_gap",
        "test_gap",
        "system_gap",
        "report_gap",
        "report-anchor",
        "field-anchor",
        "report_skill_names_not_localized",
        "transcript_mode_labels",
        "report_actor_dash_prefix",
        "report_actor_colon_prefix",
        "feedback_voice_default",
        "feedback_voice_profile",
        "player_feedback_voice_missing",
        "status_event_not_rendered",
        "investigator_creation_missing",
        "investigator_skill_allocation_missing",
        "investigator_skill_allocation_mismatch",
        "view_separation_missing",
        "player_view_secret_leak",
        "player_view_protocol_wrapper_leak",
        "skill_allocation",
        "skill_allocation final values must match character.json skills",
        "Investigator Creation",
        "investigator_inventory_history_missing",
        "haunting_npc_dialogue_missing",
        "Vittorio Macario",
        "chase_player_profile_pressure_missing",
        "item_transfer",
        "chase_object_transfer_missing",
        "resource_change",
        "haunting_corbitt_magic_points_missing",
        "haunting_corbitt_own_dagger_exception_missing",
        "Corbitt Magic points",
        "flesh_ward",
        "own_dagger_ignores_spells",
        "Flesh Ward",
        "decision_kind",
        "chase_decisions_too_thin",
        "Blueprint Cross-Check",
        "Next Loop Fix Target",
    ]
    for term in required_terms:
        assert term in skill_text
        assert term in spec_text


def test_coc_playtest_skill_documents_chase_drill_profile():
    skill_text = (PLUGIN_ROOT / "skills" / "coc-playtest" / "SKILL.md").read_text()
    spec_text = Path("docs/superpowers/specs/2026-07-03-coc-keeper-design.md").read_text()
    required_terms = [
        "chase-drill",
        "chase_drill",
        "save/chase.json",
        "## Chase Tracker",
        "movement actions",
        "location chain",
        "hazard",
        "barrier",
        "conflict",
        "quarry escapes",
        "item_transfer",
        "decision_kind",
        "chase_decisions_too_thin",
        "chase_object_transfer_missing",
        "chase_transcript_position_conflict",
        "participants[].position",
    ]
    for term in required_terms:
        assert term in skill_text
        assert term in spec_text


def test_coc_playtest_skill_documents_suite_report_index():
    skill_text = (PLUGIN_ROOT / "skills" / "coc-playtest" / "SKILL.md").read_text()
    spec_text = Path("docs/superpowers/specs/2026-07-03-coc-keeper-design.md").read_text()
    required_terms = [
        "coc_playtest_suite.py",
        "suite-report.md",
        "index.json",
        "Core Coverage Matrix",
        "Non-Passing Runs",
        "Evaluator Note Blockers",
        "evaluator_note_blocker",
        "medium-or-higher evaluator notes",
        "character_dossier",
        "kp_player_transcript",
        "mechanical_rolls",
        "meta_game",
        "player_feedback",
    ]
    for term in required_terms:
        assert term in skill_text
        assert term in spec_text


def test_coc_playtest_skill_documents_semantic_matcher_constitution():
    skill_text = (PLUGIN_ROOT / "skills" / "coc-playtest" / "SKILL.md").read_text()
    spec_text = Path("docs/superpowers/specs/2026-07-03-coc-keeper-design.md").read_text()
    required_terms = [
        "Semantic Matcher Constitution",
        "natural-language matcher",
        "LLM semantic evaluator",
        "machine-controlled schema fields",
        "coverage_evaluator",
        "coverage_reasons",
        "source-gated subsystems",
        "subsystems_covered",
    ]
    for term in required_terms:
        assert term in skill_text
        assert term in spec_text


def test_coc_playtest_skill_documents_semantic_eval_artifact_workflow():
    skill_text = (PLUGIN_ROOT / "skills" / "coc-playtest" / "SKILL.md").read_text()
    spec_text = Path("docs/superpowers/specs/2026-07-03-coc-keeper-design.md").read_text()
    required_terms = [
        "semantic-eval-request.json",
        "semantic-eval-result.json",
        "semantic-artifact",
        "evaluation_provenance",
        "request_sha256",
        "root_cause_classification",
        "next_loop_fix_target",
    ]
    for term in required_terms:
        assert term in skill_text
        assert term in spec_text


def test_coc_playtest_skill_documents_semantic_quality_matrix():
    skill_text = (PLUGIN_ROOT / "skills" / "coc-playtest" / "SKILL.md").read_text()
    spec_text = Path("docs/superpowers/specs/2026-07-03-coc-keeper-design.md").read_text()
    required_terms = [
        "quality_dimensions",
        "Quality Matrix",
        "quality_gaps",
        "module_fidelity",
        "rulebook_procedure",
        "immersion_and_pacing",
        "state_continuity",
        "spoiler_safety",
        "player_agency",
        "report_completeness",
    ]
    for term in required_terms:
        assert term in skill_text
        assert term in spec_text


def test_coc_playtest_skill_documents_loop_decision_artifact():
    skill_text = (PLUGIN_ROOT / "skills" / "coc-playtest" / "SKILL.md").read_text()
    spec_text = Path("docs/superpowers/specs/2026-07-03-coc-keeper-design.md").read_text()
    required_terms = [
        "loop-decision.json",
        "Loop Decision",
        "ready_for_completion_audit",
        "needs_repair",
        "thread_goal_status",
        "active_not_complete",
        "ignored_historical_runs",
        "evaluated_runs",
    ]
    for term in required_terms:
        assert term in skill_text
        assert term in spec_text
