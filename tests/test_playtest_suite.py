import importlib.util
import hashlib
import json
import sys
from pathlib import Path


def load_module(name: str, relative_path: str):
    path = Path(relative_path)
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_playtest_harness = load_module("coc_playtest_harness", "plugins/coc-keeper/scripts/coc_playtest_harness.py")
coc_playtest_suite = load_module("coc_playtest_suite", "plugins/coc-keeper/scripts/coc_playtest_suite.py")


def llm_semantic_provenance():
    return {
        "kind": "llm",
        "request_sha256": "fixture-request-sha256",
        "reviewed_artifact": "artifacts/semantic-eval-request.json",
    }


def request_hash(payload: dict) -> str:
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def write_semantic_eval_request(
    artifacts_dir: Path,
    run_id: str,
    battle_report: str = "Narrative text that requires semantic judgment.",
) -> dict:
    request = {
        "schema_version": 1,
        "kind": "coc_semantic_coverage_request",
        "run_id": run_id,
        "coverage_keys": [
            {"key": key, "label": key}
            for key in coc_playtest_suite.CORE_COVERAGE
        ],
        "quality_dimensions": [
            {"key": key, "label": key}
            for key in coc_playtest_suite.QUALITY_DIMENSIONS
        ],
        "inputs": {
            "battle_report": battle_report,
            "scenario": {
                "scenario_id": "fixture-scenario",
                "title": "Fixture Scenario",
            },
        },
        "expected_output_schema": {
            "required": [
                "schema_version",
                "run_id",
                "evaluator_id",
                "evaluation_provenance",
                "coverage",
                "quality",
                "root_cause_classification",
                "next_loop_fix_target",
            ],
        },
    }
    (artifacts_dir / "semantic-eval-request.json").write_text(json.dumps(request))
    return request


def llm_semantic_provenance_for(request: dict) -> dict:
    return {
        "kind": "llm",
        "request_sha256": request_hash(request),
        "reviewed_artifact": "artifacts/semantic-eval-request.json",
    }


def write_semantic_artifact_run(
    root: Path,
    run_id: str,
    audit_profile: str,
    *,
    play_language: str = "zh-Hans",
) -> None:
    run_dir = root / ".coc" / "playtests" / run_id
    artifacts_dir = run_dir / "artifacts"
    artifacts_dir.mkdir(parents=True)
    (run_dir / "playtest.json").write_text(json.dumps({
        "run_id": run_id,
        "campaign_title": f"{run_id} fixture",
        "scenario": "Fixture Scenario",
        "audit_profile": audit_profile,
        "player_profile": "careful_investigator",
        "play_language": play_language,
        "language_profile": {"language": play_language},
        "subsystems_covered": ["combat", "chase", "sanity"],
    }))
    (artifacts_dir / "battle-report.md").write_text("Narrative text that requires semantic judgment.")
    (artifacts_dir / "rulebook-audit.md").write_text("# Rulebook Alignment Audit\n\n## Overall Result\nPASS\n")
    request = write_semantic_eval_request(artifacts_dir, run_id)
    (artifacts_dir / "semantic-eval-result.json").write_text(json.dumps({
        "schema_version": 1,
        "run_id": run_id,
        "evaluator_id": "codex-llm-semantic-v1",
        "evaluation_provenance": llm_semantic_provenance_for(request),
        "coverage": {
            key: {"covered": True, "reason": f"{key} covered by fixture."}
            for key in coc_playtest_suite.CORE_COVERAGE
        },
        "quality": {
            key: {"score": 4, "passed": True, "reason": f"{key} passed by fixture."}
            for key in coc_playtest_suite.QUALITY_DIMENSIONS
        },
        "root_cause_classification": [],
        "next_loop_fix_target": "none",
    }))


def test_suite_report_indexes_runs_and_core_rulebook_coverage(tmp_path):
    coc_playtest_harness.create_haunting_module_run(tmp_path, run_id="v2-haunting-module")
    coc_playtest_harness.create_chase_drill_run(tmp_path, run_id="v3-chase-drill")

    report_path = coc_playtest_suite.generate_suite_report(tmp_path)
    index_path = tmp_path / ".coc" / "playtests" / "index.json"

    report_text = report_path.read_text()
    index = json.loads(index_path.read_text())

    assert report_path == tmp_path / ".coc" / "playtests" / "suite-report.md"
    assert index["schema_version"] == 1
    assert {run["run_id"] for run in index["runs"]} == {"v2-haunting-module", "v3-chase-drill"}
    assert index["runs"][0]["audit_result"] == "PASS"
    assert index["runs"][1]["audit_result"] == "PASS"
    assert index["coverage"]["character_dossier"]["status"] == "covered"
    assert index["coverage"]["kp_player_transcript"]["status"] == "covered"
    assert index["coverage"]["mechanical_rolls"]["status"] == "covered"
    assert index["coverage"]["combat"]["status"] == "covered"
    assert index["coverage"]["combat"]["runs"] == ["v2-haunting-module"]
    assert index["coverage"]["chase"]["status"] == "covered"
    assert index["coverage"]["chase"]["runs"] == ["v3-chase-drill"]
    assert index["coverage"]["sanity"]["status"] == "covered"
    assert index["coverage"]["sanity"]["runs"] == ["v2-haunting-module"]
    assert index["coverage"]["meta_game"]["status"] == "covered"
    assert index["coverage"]["meta_game"]["runs"] == ["v2-haunting-module", "v3-chase-drill"]
    assert index["coverage"]["player_feedback"]["status"] == "covered"
    assert index["gaps"] == []
    assert index["non_passing_runs"] == []

    assert "# COC Playtest Suite Report" in report_text
    assert "## Run Index" in report_text
    assert "v2-haunting-module" in report_text
    run_index = report_text.split("## Non-Passing Evaluated Runs", 1)[0]
    assert "《鬼屋》模组实录" in run_index
    assert "《鬼屋》完整模组审计" in run_index
    assert "The Haunting Module Playthrough" not in run_index
    assert "haunting_module PASS" not in run_index
    assert "v3-chase-drill" in report_text
    assert "屋顶上的账本" in run_index
    assert "Rooftop Chase Drill" not in report_text
    assert "追逐规则演练" in run_index
    assert "The Ledger on the Rooftops" not in run_index
    assert "chase_drill PASS" not in run_index
    assert "## Core Coverage Matrix" in report_text
    assert "character_dossier: covered" in report_text
    assert "kp_player_transcript: covered" in report_text
    assert "mechanical_rolls: covered" in report_text
    assert "combat: covered" in report_text
    assert "chase: covered" in report_text
    assert "sanity: covered" in report_text
    assert "meta_game: covered" in report_text
    assert "player_feedback: covered" in report_text
    assert "## Non-Passing Evaluated Runs" in report_text
    assert "- No non-passing evaluated runs in this suite." in report_text
    assert "## Remaining Gaps" in report_text
    assert "- No gaps detected across evaluated playtest runs." in report_text


class FixtureSemanticEvaluator:
    evaluator_id = "fixture-semantic-evaluator"

    def evaluate_run(self, context):
        assert context.run_id == "semantic-run"
        assert "semantic evidence without canonical headings" in context.battle_report
        return {
            "character_dossier": {
                "covered": True,
                "reason": "Semantic evaluator found an investigator profile even without the canonical heading.",
            },
            "kp_player_transcript": {
                "covered": True,
                "reason": "Semantic evaluator found alternating keeper and player utterances.",
            },
            "mechanical_rolls": {
                "covered": True,
                "reason": "Semantic evaluator found a resolved skill check with goal, difficulty, and outcome.",
            },
            "combat": {
                "covered": False,
                "reason": "Semantic evaluator found no opposed combat exchange.",
            },
            "chase": {
                "covered": True,
                "reason": "Semantic evaluator found pursuit pacing and an escape outcome.",
            },
            "sanity": {
                "covered": False,
                "reason": "Semantic evaluator found no SAN loss or bout handling.",
            },
            "meta_game": {
                "covered": True,
                "reason": "Semantic evaluator found an out-of-character rules question and Keeper answer.",
            },
            "player_feedback": {
                "covered": True,
                "reason": "Semantic evaluator found player-facing feedback on Keeper clarity.",
            },
        }


def test_suite_report_uses_semantic_evaluator_instead_of_text_shape(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "semantic-run"
    artifacts_dir = run_dir / "artifacts"
    artifacts_dir.mkdir(parents=True)
    (run_dir / "playtest.json").write_text(json.dumps({
        "run_id": "semantic-run",
        "campaign_title": "Semantic Coverage Fixture",
        "scenario": "Fixture Scenario",
        "audit_profile": "semantic_fixture",
        "player_profile": "careful_investigator",
        "subsystems_covered": ["chase"],
    }))
    (artifacts_dir / "rulebook-audit.md").write_text("# Rulebook Alignment Audit\n\n## Overall Result\nPASS\n")
    (artifacts_dir / "battle-report.md").write_text(
        "A semantic evidence without canonical headings transcript: the investigator is profiled, "
        "the keeper and player speak back and forth, a skill check resolves, a pursuit ends in escape, "
        "and the player comments on Keeper clarity."
    )

    report_path = coc_playtest_suite.generate_suite_report(tmp_path, evaluator=FixtureSemanticEvaluator())
    index = json.loads((tmp_path / ".coc" / "playtests" / "index.json").read_text())
    report_text = report_path.read_text()

    run = index["runs"][0]
    assert run["coverage_evaluator"] == "fixture-semantic-evaluator"
    assert run["coverage"]["chase"] is True
    assert run["coverage_reasons"]["chase"] == "Semantic evaluator found pursuit pacing and an escape outcome."
    assert index["coverage"]["chase"]["runs"] == ["semantic-run"]
    assert index["coverage"]["chase"]["reasons"] == {
        "semantic-run": "Semantic evaluator found pursuit pacing and an escape outcome."
    }
    assert "Coverage Evidence" in report_text
    assert "fixture-semantic-evaluator" in report_text
    assert "Semantic evaluator found pursuit pacing and an escape outcome." in report_text


def test_suite_report_surfaces_selected_play_language_per_run(tmp_path):
    coc_playtest_harness.create_multi_profile_pressure_run(
        tmp_path,
        run_id="v4-ja-pressure",
        play_language="ja-JP",
    )

    report_path = coc_playtest_suite.generate_suite_report(tmp_path)
    index = json.loads((tmp_path / ".coc" / "playtests" / "index.json").read_text())
    report_text = report_path.read_text()

    run = index["runs"][0]
    assert run["play_language"] == "ja-JP"
    assert run["language_profile"] == "ja-JP"
    assert "v4-ja-pressure" in report_text
    assert "language: ja-JP" in report_text
    assert "単独プレイヤー複数スタイル圧力テスト PASS" in report_text
    assert "player: 単独プレイヤー複数スタイル分岐" in report_text
    assert "複数プレイヤー" not in report_text


def test_suite_report_localizes_run_index_display_values(tmp_path):
    write_semantic_artifact_run(
        tmp_path,
        "v4-multi-profile-pressure",
        "multi_profile_pressure",
    )
    run_dir = tmp_path / ".coc" / "playtests" / "v4-multi-profile-pressure"
    metadata_path = run_dir / "playtest.json"
    metadata = json.loads(metadata_path.read_text())
    metadata["campaign_title"] = "Three Roads into the Corbitt House"
    metadata["scenario"] = "The Haunting Opening Crossroads"
    metadata["player_profile"] = "multi_profile_matrix"
    metadata["localized_terms"] = {
        "zh-Hans": {
            "Three Roads into the Corbitt House": "科比特宅邸的三条路",
            "The Haunting Opening Crossroads": "《鬼屋》开场分歧",
        }
    }
    metadata["language_profile"] = {
        "language": "zh-Hans",
        "report_value_labels": {
            "multi_profile_pressure": "单人多风格压测",
            "multi_profile_matrix": "单人多风格开局",
        },
    }
    metadata_path.write_text(json.dumps(metadata))

    report_path = coc_playtest_suite.generate_suite_report(tmp_path)
    report_text = report_path.read_text()
    index = json.loads((tmp_path / ".coc" / "playtests" / "index.json").read_text())

    assert index["runs"][0]["campaign_title"] == "Three Roads into the Corbitt House"
    assert index["runs"][0]["campaign_title_display"] == "科比特宅邸的三条路"
    assert index["runs"][0]["scenario"] == "The Haunting Opening Crossroads"
    assert index["runs"][0]["scenario_display"] == "《鬼屋》开场分歧"
    assert index["runs"][0]["audit_profile"] == "multi_profile_pressure"
    assert index["runs"][0]["audit_profile_display"] == "单人多风格压测"
    assert index["runs"][0]["player_profile"] == "multi_profile_matrix"
    assert index["runs"][0]["player_profile_display"] == "单人多风格开局"
    assert "- v4-multi-profile-pressure: 科比特宅邸的三条路 | 单人多风格压测 PASS | scenario: 《鬼屋》开场分歧 | language: zh-Hans | player: 单人多风格开局" in report_text
    assert "Three Roads into the Corbitt House" not in report_text
    assert "The Haunting Opening Crossroads" not in report_text
    assert "multi_profile_pressure PASS" not in report_text
    assert "player: 单人多风格开局" in report_text
    assert "player: multi_profile_matrix" not in report_text


def test_suite_report_displays_single_player_style_label_for_localized_runs(tmp_path):
    write_semantic_artifact_run(
        tmp_path,
        "v2-haunting-module",
        "haunting_module",
    )
    metadata_path = tmp_path / ".coc" / "playtests" / "v2-haunting-module" / "playtest.json"
    metadata = json.loads(metadata_path.read_text())
    metadata["player_profile"] = "careful_investigator"
    metadata["play_language"] = "zh-Hans"
    metadata["language_profile"] = {
        "language": "zh-Hans",
        "speaker_labels": {"single_player": "单人玩家"},
    }
    metadata["player_profile_labels"] = {
        "zh-Hans": {"careful_investigator": "谨慎风格"}
    }
    metadata_path.write_text(json.dumps(metadata))

    report_path = coc_playtest_suite.generate_suite_report(tmp_path)
    report_text = report_path.read_text()
    index = json.loads((tmp_path / ".coc" / "playtests" / "index.json").read_text())

    assert index["runs"][0]["player_profile"] == "careful_investigator"
    assert index["runs"][0]["player_profile_display"] == "单人玩家（谨慎风格）"
    assert "player: 单人玩家（谨慎风格）" in report_text
    assert "player: 谨慎风格" not in report_text
    assert "player: careful_investigator" not in report_text


def test_suite_report_does_not_invent_run_index_display_without_language_metadata(tmp_path):
    write_semantic_artifact_run(
        tmp_path,
        "legacy-smoke",
        "baseline",
    )
    metadata_path = tmp_path / ".coc" / "playtests" / "legacy-smoke" / "playtest.json"
    metadata = json.loads(metadata_path.read_text())
    metadata.pop("play_language", None)
    metadata.pop("language_profile", None)
    metadata_path.write_text(json.dumps(metadata))

    report_path = coc_playtest_suite.generate_suite_report(tmp_path)
    report_text = report_path.read_text()
    index = json.loads((tmp_path / ".coc" / "playtests" / "index.json").read_text())

    assert index["runs"][0]["campaign_title_display"] == "legacy-smoke fixture"
    assert index["runs"][0]["scenario_display"] == "Fixture Scenario"
    assert index["runs"][0]["audit_profile_display"] == "baseline"
    assert index["runs"][0]["player_profile"] == "careful_investigator"
    assert index["runs"][0]["player_profile_display"] == "careful_investigator"
    assert "legacy-smoke fixture | baseline PASS | scenario: Fixture Scenario" in report_text
    assert "player: careful_investigator" in report_text
    assert "player: 谨慎风格" not in report_text


def test_completion_profile_suite_defaults_to_chinese_language_evidence(tmp_path):
    write_semantic_artifact_run(tmp_path, "v2-haunting-module", "haunting_module")
    write_semantic_artifact_run(tmp_path, "v3-chase-drill", "chase_drill")
    write_semantic_artifact_run(tmp_path, "v4-multi-profile-pressure", "multi_profile_pressure")

    report_path = coc_playtest_suite.generate_suite_report(
        tmp_path,
        evaluator=coc_playtest_suite.SemanticArtifactCoverageEvaluator(),
    )
    index = json.loads((tmp_path / ".coc" / "playtests" / "index.json").read_text())
    report_text = report_path.read_text()

    assert index["language_coverage"]["default_play_language"]["status"] == "covered"
    assert index["language_coverage"]["non_default_play_language"]["status"] == "not_required"
    assert index["language_gaps"] == []
    assert index["loop_decision"]["status"] == "ready_for_completion_audit"
    assert index["loop_decision"]["blockers"] == []
    assert "## Language Coverage" in report_text
    assert "- non_default_play_language: not_required" in report_text


def test_completion_profile_suite_accepts_non_default_language_evidence(tmp_path):
    write_semantic_artifact_run(tmp_path, "v2-haunting-module", "haunting_module")
    write_semantic_artifact_run(tmp_path, "v3-chase-drill", "chase_drill")
    write_semantic_artifact_run(
        tmp_path,
        "v4-multi-profile-pressure",
        "multi_profile_pressure",
        play_language="ja-JP",
    )

    coc_playtest_suite.generate_suite_report(
        tmp_path,
        evaluator=coc_playtest_suite.SemanticArtifactCoverageEvaluator(),
    )
    index = json.loads((tmp_path / ".coc" / "playtests" / "index.json").read_text())

    assert index["language_coverage"]["default_play_language"]["status"] == "covered"
    assert index["language_coverage"]["non_default_play_language"]["status"] == "covered"
    assert index["language_gaps"] == []
    assert index["loop_decision"]["status"] == "ready_for_completion_audit"
    assert index["loop_decision"]["blockers"] == []


def test_completion_profile_suite_treats_non_default_duplicate_as_optional_evidence(tmp_path):
    write_semantic_artifact_run(tmp_path, "v2-haunting-module", "haunting_module")
    write_semantic_artifact_run(tmp_path, "v3-chase-drill", "chase_drill")
    write_semantic_artifact_run(tmp_path, "v4-multi-profile-pressure", "multi_profile_pressure")
    write_semantic_artifact_run(
        tmp_path,
        "v5-ja-localization-pressure",
        "multi_profile_pressure",
        play_language="ja-JP",
    )

    coc_playtest_suite.generate_suite_report(
        tmp_path,
        evaluator=coc_playtest_suite.SemanticArtifactCoverageEvaluator(),
    )
    index = json.loads((tmp_path / ".coc" / "playtests" / "index.json").read_text())
    report_text = (tmp_path / ".coc" / "playtests" / "suite-report.md").read_text()
    loop_decision = index["loop_decision"]

    assert loop_decision["evaluated_runs"] == [
        "v2-haunting-module",
        "v3-chase-drill",
        "v4-multi-profile-pressure",
    ]
    assert loop_decision["optional_evidence_runs"] == ["v5-ja-localization-pressure"]
    assert loop_decision["ignored_historical_runs"] == []
    assert index["language_coverage"]["default_play_language"]["status"] == "covered"
    assert index["language_coverage"]["default_play_language"]["runs"] == [
        "v2-haunting-module",
        "v3-chase-drill",
        "v4-multi-profile-pressure",
    ]
    assert index["language_coverage"]["non_default_play_language"]["status"] == "covered"
    assert index["language_coverage"]["non_default_play_language"]["runs"] == [
        "v5-ja-localization-pressure"
    ]
    assert index["loop_decision"]["blockers"] == []
    assert "- Optional Evidence Runs: v5-ja-localization-pressure" in report_text
    assert "- No gaps detected across evaluated playtest runs." in report_text
    assert "- No quality gaps detected across evaluated playtest runs." in report_text
    assert "- No language gaps detected across current language coverage scope." in report_text
    assert "indexed playtest runs" not in report_text


def test_semantic_eval_request_exports_llm_judge_contract(tmp_path):
    coc_playtest_harness.create_chase_drill_run(tmp_path, run_id="v3-chase-drill")

    request_paths = coc_playtest_suite.write_semantic_eval_requests(tmp_path)

    assert request_paths == [
        tmp_path / ".coc" / "playtests" / "v3-chase-drill" / "artifacts" / "semantic-eval-request.json"
    ]
    request = json.loads(request_paths[0].read_text())
    coverage_keys = {entry["key"] for entry in request["coverage_keys"]}
    quality_keys = {entry["key"] for entry in request["quality_dimensions"]}

    assert request["schema_version"] == 1
    assert request["kind"] == "coc_semantic_coverage_request"
    assert request["run_id"] == "v3-chase-drill"
    assert request["constitution"]["title"] == "Semantic Matcher Constitution"
    assert "literal headings" in request["constitution"]["forbidden_methods"]
    assert "keyword hits" in request["constitution"]["forbidden_methods"]
    assert "machine-controlled schema fields" in request["constitution"]["allowed_exact_matching"]
    assert "LLM semantic evaluator" in request["instructions"]
    assert coverage_keys == set(coc_playtest_suite.CORE_COVERAGE)
    assert quality_keys == set(coc_playtest_suite.QUALITY_DIMENSIONS)
    assert "localized_visible_dialogue" in quality_keys
    assert "chinese_visible_dialogue" not in quality_keys
    assert "actual_play_replay" in quality_keys
    assert "virtual_player_pressure" in quality_keys
    quality_questions = {entry["key"]: entry["question"] for entry in request["quality_dimensions"]}
    assert "play_language" in quality_questions["localized_visible_dialogue"]
    assert "zh-Hans" in quality_questions["localized_visible_dialogue"]
    assert "player-visible skill display names" in quality_questions["localized_visible_dialogue"]
    assert "canonical skill keys" in quality_questions["localized_visible_dialogue"]
    assert "skill names, system roll text" not in quality_questions["localized_visible_dialogue"]
    assert "actual-play" in quality_questions["actual_play_replay"]
    assert "single simulated player" in quality_questions["virtual_player_pressure"]
    assert "play-style profiles" in quality_questions["virtual_player_pressure"]
    assert "multiple player profiles" not in quality_questions["virtual_player_pressure"]
    assert "multi-player" not in quality_questions["virtual_player_pressure"]
    assert "multiplayer" not in quality_questions["virtual_player_pressure"]
    assert "battle_report" in request["inputs"]
    assert request["inputs"]["campaign"]["status"] == "concluded"
    assert request["inputs"]["scenario"]["scenario_id"] == "rooftop-chase-drill"
    assert request["inputs"]["scenario"]["title"] == "The Ledger on the Rooftops"
    assert request["inputs"]["scenario"]["opening_scene"]
    assert "transcript" in request["inputs"]
    assert "state_events" in request["inputs"]
    assert request["expected_output_schema"]["required"] == [
        "schema_version",
        "run_id",
        "evaluator_id",
        "evaluation_provenance",
        "coverage",
        "quality",
        "root_cause_classification",
        "next_loop_fix_target",
    ]
    assert request["expected_output_schema"]["evaluation_provenance"] == {
        "kind": "llm",
        "request_sha256": "canonical SHA-256 hash of this semantic-eval-request.json",
        "reviewed_artifact": "artifacts/semantic-eval-request.json",
    }


def test_suite_cli_defaults_to_semantic_artifact_evaluator(tmp_path, monkeypatch):
    coc_playtest_harness.create_haunting_module_run(tmp_path, run_id="v2-haunting-module")
    semantic_result = (
        tmp_path
        / ".coc"
        / "playtests"
        / "v2-haunting-module"
        / "artifacts"
        / "semantic-eval-result.json"
    )
    semantic_result.unlink(missing_ok=True)
    monkeypatch.setattr(sys, "argv", ["coc_playtest_suite.py", "--root", str(tmp_path)])

    assert coc_playtest_suite.main() == 0

    index = json.loads((tmp_path / ".coc" / "playtests" / "index.json").read_text())
    run = index["runs"][0]
    assert run["coverage_evaluator"] == "semantic-artifact-evaluator"
    assert index["coverage"]["character_dossier"]["status"] == "missing"
    assert index["loop_decision"]["status"] == "needs_repair"
    assert index["loop_decision"]["blockers"][0]["type"] == "missing_semantic_result"
    assert "Fill artifacts/semantic-eval-result.json" in run["next_loop_fix_target"]


def test_suite_report_can_use_llm_semantic_result_artifact(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "semantic-artifact-run"
    artifacts_dir = run_dir / "artifacts"
    artifacts_dir.mkdir(parents=True)
    (run_dir / "playtest.json").write_text(json.dumps({
        "run_id": "semantic-artifact-run",
        "campaign_title": "Semantic Artifact Fixture",
        "scenario": "Fixture Scenario",
        "audit_profile": "semantic_fixture",
        "player_profile": "careful_investigator",
        "subsystems_covered": ["combat", "chase", "sanity"],
    }))
    (artifacts_dir / "battle-report.md").write_text("Narrative text that requires semantic judgment.")
    (artifacts_dir / "rulebook-audit.md").write_text("# Rulebook Alignment Audit\n\n## Overall Result\nPASS\n")
    request = write_semantic_eval_request(artifacts_dir, "semantic-artifact-run")
    (artifacts_dir / "semantic-eval-result.json").write_text(json.dumps({
        "schema_version": 1,
        "run_id": "semantic-artifact-run",
        "evaluator_id": "codex-llm-semantic-v1",
        "evaluation_provenance": {
            "kind": "llm",
            "request_sha256": request_hash(request),
            "reviewed_artifact": "artifacts/semantic-eval-request.json",
        },
        "coverage": {
            key: {
                "covered": True,
                "reason": f"LLM semantic judge found {key} in the run evidence.",
            }
            for key in coc_playtest_suite.CORE_COVERAGE
        },
        "quality": {
            key: {
                "score": 4,
                "passed": True,
                "reason": f"LLM semantic judge scored {key} as table-ready.",
            }
            for key in coc_playtest_suite.QUALITY_DIMENSIONS
        },
        "root_cause_classification": [],
        "next_loop_fix_target": "none",
    }))

    report_path = coc_playtest_suite.generate_suite_report(
        tmp_path,
        evaluator=coc_playtest_suite.SemanticArtifactCoverageEvaluator(),
    )
    index = json.loads((tmp_path / ".coc" / "playtests" / "index.json").read_text())
    loop_decision = json.loads((tmp_path / ".coc" / "playtests" / "loop-decision.json").read_text())
    report_text = report_path.read_text()

    run = index["runs"][0]
    assert run["coverage_evaluator"] == "codex-llm-semantic-v1"
    assert run["semantic_eval_result"] == "artifacts/semantic-eval-result.json"
    assert index["gaps"] == []
    assert index["coverage"]["chase"]["reasons"] == {
        "semantic-artifact-run": "LLM semantic judge found chase in the run evidence."
    }
    assert index["quality"]["rulebook_procedure"]["status"] == "passed"
    assert index["quality"]["rulebook_procedure"]["runs"] == ["semantic-artifact-run"]
    assert index["quality"]["rulebook_procedure"]["reasons"] == {
        "semantic-artifact-run": "LLM semantic judge scored rulebook_procedure as table-ready."
    }
    assert index["quality_gaps"] == []
    assert index["loop_decision"]["status"] == "ready_for_completion_audit"
    assert index["loop_decision"]["thread_goal_status"] == "active_not_complete"
    assert index["loop_decision"]["blockers"] == []
    assert index["loop_decision"]["evaluated_runs"] == ["semantic-artifact-run"]
    assert loop_decision == index["loop_decision"]
    assert "codex-llm-semantic-v1" in report_text
    assert "## Loop Decision" in report_text
    assert "ready_for_completion_audit" in report_text
    assert "Thread Goal: active_not_complete" in report_text
    assert "Artifact audit ready; keep the watchdog goal active after completion audit." in report_text
    assert "## Quality Matrix" in report_text
    assert "- No blocking evaluator notes in active playtest runs." in report_text
    assert "## Remaining Quality Gaps" in report_text
    assert "- No quality gaps detected across evaluated playtest runs." in report_text
    assert "## Repair Targets" in report_text
    assert "semantic-artifact-run: none" in report_text
    assert "LLM semantic judge found chase in the run evidence." in report_text
    assert "LLM semantic judge scored rulebook_procedure as table-ready." in report_text


def test_suite_report_source_gates_semantic_subsystem_coverage(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "semantic-artifact-run"
    artifacts_dir = run_dir / "artifacts"
    artifacts_dir.mkdir(parents=True)
    (run_dir / "playtest.json").write_text(json.dumps({
        "run_id": "semantic-artifact-run",
        "campaign_title": "Semantic Artifact Fixture",
        "scenario": "Fixture Scenario",
        "audit_profile": "semantic_fixture",
        "player_profile": "careful_investigator",
        "subsystems_covered": ["combat", "sanity"],
    }))
    (artifacts_dir / "battle-report.md").write_text("Narrative text that requires semantic judgment.")
    (artifacts_dir / "rulebook-audit.md").write_text("# Rulebook Alignment Audit\n\n## Overall Result\nPASS\n")
    request = write_semantic_eval_request(artifacts_dir, "semantic-artifact-run")
    (artifacts_dir / "semantic-eval-result.json").write_text(json.dumps({
        "schema_version": 1,
        "run_id": "semantic-artifact-run",
        "evaluator_id": "codex-llm-semantic-v1",
        "evaluation_provenance": llm_semantic_provenance_for(request),
        "coverage": {
            key: {
                "covered": True,
                "reason": f"LLM semantic judge found {key} in the run evidence.",
            }
            for key in coc_playtest_suite.CORE_COVERAGE
        },
        "quality": {
            key: {
                "score": 4,
                "passed": True,
                "reason": f"LLM semantic judge scored {key} as table-ready.",
            }
            for key in coc_playtest_suite.QUALITY_DIMENSIONS
        },
        "root_cause_classification": ["report_gap", "system_gap"],
        "next_loop_fix_target": "Correct contradicted subsystem coverage.",
    }))

    coc_playtest_suite.generate_suite_report(
        tmp_path,
        evaluator=coc_playtest_suite.SemanticArtifactCoverageEvaluator(),
    )
    index = json.loads((tmp_path / ".coc" / "playtests" / "index.json").read_text())

    run = index["runs"][0]
    assert run["coverage"]["chase"] is False
    assert run["coverage_reasons"]["chase"] == (
        "Evaluator claimed `chase`, but playtest.json subsystems_covered does not declare `chase`."
    )
    assert index["coverage"]["chase"]["status"] == "missing"
    assert "chase" in index["gaps"]
    assert index["loop_decision"]["status"] == "needs_repair"
    assert index["loop_decision"]["blockers"][0]["type"] == "coverage_gap"
    assert index["loop_decision"]["blockers"][0]["key"] == "chase"


def test_suite_report_blocks_medium_or_higher_evaluator_notes(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "semantic-artifact-run"
    artifacts_dir = run_dir / "artifacts"
    artifacts_dir.mkdir(parents=True)
    (run_dir / "playtest.json").write_text(json.dumps({
        "run_id": "semantic-artifact-run",
        "campaign_title": "Semantic Artifact Fixture",
        "scenario": "Fixture Scenario",
        "audit_profile": "haunting_module",
        "player_profile": "careful_investigator",
        "subsystems_covered": ["combat", "chase", "sanity"],
    }))
    (run_dir / "evaluator-notes.jsonl").write_text(json.dumps({
        "severity": "medium",
        "category": "immersion",
        "text": "The full-module report still reads like a scripted compression instead of live table play.",
        "evidence": {"artifact_paths": ["artifacts/battle-report.md", "transcript.jsonl"]},
    }) + "\n")
    (artifacts_dir / "battle-report.md").write_text("Narrative text that requires semantic judgment.")
    (artifacts_dir / "rulebook-audit.md").write_text("# Rulebook Alignment Audit\n\n## Overall Result\nPASS\n")
    request = write_semantic_eval_request(artifacts_dir, "semantic-artifact-run")
    (artifacts_dir / "semantic-eval-result.json").write_text(json.dumps({
        "schema_version": 1,
        "run_id": "semantic-artifact-run",
        "evaluator_id": "codex-llm-semantic-v1",
        "evaluation_provenance": llm_semantic_provenance_for(request),
        "coverage": {
            key: {"covered": True, "reason": f"{key} covered by fixture."}
            for key in coc_playtest_suite.CORE_COVERAGE
        },
        "quality": {
            key: {"score": 4, "passed": True, "reason": f"{key} passed by fixture."}
            for key in coc_playtest_suite.QUALITY_DIMENSIONS
        },
        "root_cause_classification": [],
        "next_loop_fix_target": "none",
    }))

    report_path = coc_playtest_suite.generate_suite_report(
        tmp_path,
        evaluator=coc_playtest_suite.SemanticArtifactCoverageEvaluator(),
    )
    index = json.loads((tmp_path / ".coc" / "playtests" / "index.json").read_text())
    report_text = report_path.read_text()

    assert index["loop_decision"]["status"] == "needs_repair"
    assert index["loop_decision"]["blockers"][0]["type"] == "evaluator_note_blocker"
    assert index["loop_decision"]["blockers"][0]["run_id"] == "semantic-artifact-run"
    assert index["loop_decision"]["blockers"][0]["root_cause_classification"] == [
        "test_gap",
        "system_gap",
        "report_gap",
        "design_gap",
    ]
    assert "scripted compression" in index["loop_decision"]["blockers"][0]["next_loop_fix_target"]
    assert index["runs"][0]["evaluator_note_blockers"] == [{
        "severity": "medium",
        "category": "immersion",
        "text": "The full-module report still reads like a scripted compression instead of live table play.",
    }]
    assert "## Evaluator Note Blockers" in report_text
    assert "semantic-artifact-run [medium/immersion]" in report_text
    assert "scripted compression" in report_text


def test_suite_report_blocks_error_evaluator_notes(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "semantic-artifact-run"
    artifacts_dir = run_dir / "artifacts"
    artifacts_dir.mkdir(parents=True)
    (run_dir / "playtest.json").write_text(json.dumps({
        "run_id": "semantic-artifact-run",
        "campaign_title": "Semantic Artifact Fixture",
        "scenario": "Fixture Scenario",
        "audit_profile": "haunting_module",
        "player_profile": "careful_investigator",
        "subsystems_covered": ["combat", "chase", "sanity"],
    }))
    (run_dir / "evaluator-notes.jsonl").write_text(json.dumps({
        "severity": "error",
        "category": "state_integrity",
        "text": "Fixture evaluator found a blocking state error.",
        "evidence": {"artifact_paths": ["artifacts/battle-report.md"]},
    }) + "\n")
    (artifacts_dir / "battle-report.md").write_text("Narrative text that requires semantic judgment.")
    (artifacts_dir / "rulebook-audit.md").write_text("# Rulebook Alignment Audit\n\n## Overall Result\nPASS\n")
    request = write_semantic_eval_request(artifacts_dir, "semantic-artifact-run")
    (artifacts_dir / "semantic-eval-result.json").write_text(json.dumps({
        "schema_version": 1,
        "run_id": "semantic-artifact-run",
        "evaluator_id": "codex-llm-semantic-v1",
        "evaluation_provenance": llm_semantic_provenance_for(request),
        "coverage": {
            key: {"covered": True, "reason": f"{key} covered by fixture."}
            for key in coc_playtest_suite.CORE_COVERAGE
        },
        "quality": {
            key: {"score": 4, "passed": True, "reason": f"{key} passed by fixture."}
            for key in coc_playtest_suite.QUALITY_DIMENSIONS
        },
        "root_cause_classification": [],
        "next_loop_fix_target": "none",
    }))

    coc_playtest_suite.generate_suite_report(
        tmp_path,
        evaluator=coc_playtest_suite.SemanticArtifactCoverageEvaluator(),
    )
    index = json.loads((tmp_path / ".coc" / "playtests" / "index.json").read_text())

    assert index["loop_decision"]["status"] == "needs_repair"
    assert index["loop_decision"]["blockers"][0]["type"] == "evaluator_note_blocker"
    assert index["loop_decision"]["blockers"][0]["severity"] == "error"


def test_suite_report_rejects_stale_semantic_result_request_hash(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "semantic-artifact-run"
    artifacts_dir = run_dir / "artifacts"
    artifacts_dir.mkdir(parents=True)
    (run_dir / "playtest.json").write_text(json.dumps({
        "run_id": "semantic-artifact-run",
        "campaign_title": "Semantic Artifact Fixture",
        "scenario": "Fixture Scenario",
        "audit_profile": "semantic_fixture",
        "player_profile": "careful_investigator",
        "subsystems_covered": ["combat", "chase", "sanity"],
    }))
    (artifacts_dir / "battle-report.md").write_text("Narrative text that requires semantic judgment.")
    (artifacts_dir / "rulebook-audit.md").write_text("# Rulebook Alignment Audit\n\n## Overall Result\nPASS\n")
    write_semantic_eval_request(artifacts_dir, "semantic-artifact-run", "current request evidence")
    (artifacts_dir / "semantic-eval-result.json").write_text(json.dumps({
        "schema_version": 1,
        "run_id": "semantic-artifact-run",
        "evaluator_id": "codex-llm-semantic-v1",
        "evaluation_provenance": {
            "kind": "llm",
            "request_sha256": "stale-request-sha256",
            "reviewed_artifact": "artifacts/semantic-eval-request.json",
        },
        "coverage": {
            key: {"covered": True, "reason": f"{key} covered by fixture."}
            for key in coc_playtest_suite.CORE_COVERAGE
        },
        "quality": {
            key: {"score": 4, "passed": True, "reason": f"{key} passed by fixture."}
            for key in coc_playtest_suite.QUALITY_DIMENSIONS
        },
        "root_cause_classification": [],
        "next_loop_fix_target": "none",
    }))

    coc_playtest_suite.generate_suite_report(
        tmp_path,
        evaluator=coc_playtest_suite.SemanticArtifactCoverageEvaluator(),
    )
    index = json.loads((tmp_path / ".coc" / "playtests" / "index.json").read_text())

    assert index["loop_decision"]["status"] == "needs_repair"
    assert index["loop_decision"]["blockers"][0]["type"] == "semantic_artifact_schema_invalid"
    assert index["loop_decision"]["blockers"][0]["run_id"] == "semantic-artifact-run"
    assert "evaluation_provenance.request_sha256_mismatch" in index["runs"][0]["semantic_artifact_schema_errors"]


def test_suite_report_rejects_semantic_result_when_request_contract_is_incomplete(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "semantic-artifact-run"
    artifacts_dir = run_dir / "artifacts"
    artifacts_dir.mkdir(parents=True)
    (run_dir / "playtest.json").write_text(json.dumps({
        "run_id": "semantic-artifact-run",
        "campaign_title": "Semantic Artifact Fixture",
        "scenario": "Fixture Scenario",
        "audit_profile": "semantic_fixture",
        "player_profile": "careful_investigator",
        "subsystems_covered": [],
    }))
    (artifacts_dir / "battle-report.md").write_text("Narrative text that requires semantic judgment.")
    (artifacts_dir / "rulebook-audit.md").write_text("# Rulebook Alignment Audit\n\n## Overall Result\nPASS\n")
    request = write_semantic_eval_request(artifacts_dir, "semantic-artifact-run")
    request.pop("coverage_keys")
    (artifacts_dir / "semantic-eval-request.json").write_text(json.dumps(request))
    (artifacts_dir / "semantic-eval-result.json").write_text(json.dumps({
        "schema_version": 1,
        "run_id": "semantic-artifact-run",
        "evaluator_id": "codex-llm-semantic-v1",
        "evaluation_provenance": {
            "kind": "llm",
            "request_sha256": request_hash(request),
            "reviewed_artifact": "artifacts/semantic-eval-request.json",
        },
        "coverage": {
            key: {"covered": True, "reason": f"{key} covered by fixture."}
            for key in coc_playtest_suite.CORE_COVERAGE
        },
        "quality": {
            key: {"score": 4, "passed": True, "reason": f"{key} passed by fixture."}
            for key in coc_playtest_suite.QUALITY_DIMENSIONS
        },
        "root_cause_classification": [],
        "next_loop_fix_target": "none",
    }))

    coc_playtest_suite.generate_suite_report(
        tmp_path,
        evaluator=coc_playtest_suite.SemanticArtifactCoverageEvaluator(),
    )
    index = json.loads((tmp_path / ".coc" / "playtests" / "index.json").read_text())

    assert index["loop_decision"]["status"] == "needs_repair"
    assert index["loop_decision"]["blockers"][0]["type"] == "semantic_artifact_schema_invalid"
    assert index["loop_decision"]["blockers"][0]["run_id"] == "semantic-artifact-run"
    assert "semantic_eval_request.coverage_keys" in index["runs"][0]["semantic_artifact_schema_errors"]


def test_suite_report_rejects_legacy_chinese_only_localization_quality_contract(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "semantic-artifact-run"
    artifacts_dir = run_dir / "artifacts"
    artifacts_dir.mkdir(parents=True)
    (run_dir / "playtest.json").write_text(json.dumps({
        "run_id": "semantic-artifact-run",
        "campaign_title": "Semantic Artifact Fixture",
        "scenario": "Fixture Scenario",
        "audit_profile": "semantic_fixture",
        "player_profile": "careful_investigator",
        "subsystems_covered": ["combat", "chase", "sanity"],
    }))
    (artifacts_dir / "battle-report.md").write_text("Narrative text that requires semantic judgment.")
    (artifacts_dir / "rulebook-audit.md").write_text("# Rulebook Alignment Audit\n\n## Overall Result\nPASS\n")
    request = write_semantic_eval_request(artifacts_dir, "semantic-artifact-run")
    request["quality_dimensions"] = [
        (
            {"key": "chinese_visible_dialogue", "label": "Chinese visible dialogue"}
            if entry["key"] == "localized_visible_dialogue"
            else entry
        )
        for entry in request["quality_dimensions"]
    ]
    (artifacts_dir / "semantic-eval-request.json").write_text(json.dumps(request))
    quality = {
        (
            "chinese_visible_dialogue"
            if key == "localized_visible_dialogue"
            else key
        ): {"score": 4, "passed": True, "reason": f"{key} passed by fixture."}
        for key in coc_playtest_suite.QUALITY_DIMENSIONS
    }
    (artifacts_dir / "semantic-eval-result.json").write_text(json.dumps({
        "schema_version": 1,
        "run_id": "semantic-artifact-run",
        "evaluator_id": "codex-llm-semantic-v1",
        "evaluation_provenance": llm_semantic_provenance_for(request),
        "coverage": {
            key: {"covered": True, "reason": f"{key} covered by fixture."}
            for key in coc_playtest_suite.CORE_COVERAGE
        },
        "quality": quality,
        "root_cause_classification": [],
        "next_loop_fix_target": "none",
    }))

    coc_playtest_suite.generate_suite_report(
        tmp_path,
        evaluator=coc_playtest_suite.SemanticArtifactCoverageEvaluator(),
    )
    index = json.loads((tmp_path / ".coc" / "playtests" / "index.json").read_text())

    assert index["loop_decision"]["status"] == "needs_repair"
    assert index["loop_decision"]["blockers"][0]["type"] == "semantic_artifact_schema_invalid"
    assert "semantic_eval_request.quality_dimensions" in index["runs"][0]["semantic_artifact_schema_errors"]


def test_suite_report_rejects_semantic_result_with_wrong_reviewed_artifact(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "semantic-artifact-run"
    artifacts_dir = run_dir / "artifacts"
    artifacts_dir.mkdir(parents=True)
    (run_dir / "playtest.json").write_text(json.dumps({
        "run_id": "semantic-artifact-run",
        "campaign_title": "Semantic Artifact Fixture",
        "scenario": "Fixture Scenario",
        "audit_profile": "semantic_fixture",
        "player_profile": "careful_investigator",
        "subsystems_covered": [],
    }))
    (artifacts_dir / "battle-report.md").write_text("Narrative text that requires semantic judgment.")
    (artifacts_dir / "rulebook-audit.md").write_text("# Rulebook Alignment Audit\n\n## Overall Result\nPASS\n")
    request = write_semantic_eval_request(artifacts_dir, "semantic-artifact-run")
    (artifacts_dir / "semantic-eval-result.json").write_text(json.dumps({
        "schema_version": 1,
        "run_id": "semantic-artifact-run",
        "evaluator_id": "codex-llm-semantic-v1",
        "evaluation_provenance": {
            "kind": "llm",
            "request_sha256": request_hash(request),
            "reviewed_artifact": "artifacts/battle-report.md",
        },
        "coverage": {
            key: {"covered": True, "reason": f"{key} covered by fixture."}
            for key in coc_playtest_suite.CORE_COVERAGE
        },
        "quality": {
            key: {"score": 4, "passed": True, "reason": f"{key} passed by fixture."}
            for key in coc_playtest_suite.QUALITY_DIMENSIONS
        },
        "root_cause_classification": [],
        "next_loop_fix_target": "none",
    }))

    coc_playtest_suite.generate_suite_report(
        tmp_path,
        evaluator=coc_playtest_suite.SemanticArtifactCoverageEvaluator(),
    )
    index = json.loads((tmp_path / ".coc" / "playtests" / "index.json").read_text())

    assert index["loop_decision"]["status"] == "needs_repair"
    assert index["loop_decision"]["blockers"][0]["type"] == "semantic_artifact_schema_invalid"
    assert index["loop_decision"]["blockers"][0]["run_id"] == "semantic-artifact-run"
    assert "evaluation_provenance.reviewed_artifact" in index["runs"][0]["semantic_artifact_schema_errors"]


def test_suite_report_rejects_semantic_result_without_request_artifact(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "semantic-artifact-run"
    artifacts_dir = run_dir / "artifacts"
    artifacts_dir.mkdir(parents=True)
    (run_dir / "playtest.json").write_text(json.dumps({
        "run_id": "semantic-artifact-run",
        "campaign_title": "Semantic Artifact Fixture",
        "scenario": "Fixture Scenario",
        "audit_profile": "semantic_fixture",
        "player_profile": "careful_investigator",
        "subsystems_covered": [],
    }))
    (artifacts_dir / "battle-report.md").write_text("Narrative text that requires semantic judgment.")
    (artifacts_dir / "rulebook-audit.md").write_text("# Rulebook Alignment Audit\n\n## Overall Result\nPASS\n")
    (artifacts_dir / "semantic-eval-result.json").write_text(json.dumps({
        "schema_version": 1,
        "run_id": "semantic-artifact-run",
        "evaluator_id": "codex-llm-semantic-v1",
        "evaluation_provenance": llm_semantic_provenance(),
        "coverage": {
            key: {"covered": True, "reason": f"{key} covered by fixture."}
            for key in coc_playtest_suite.CORE_COVERAGE
        },
        "quality": {
            key: {"score": 4, "passed": True, "reason": f"{key} passed by fixture."}
            for key in coc_playtest_suite.QUALITY_DIMENSIONS
        },
        "root_cause_classification": [],
        "next_loop_fix_target": "none",
    }))

    coc_playtest_suite.generate_suite_report(
        tmp_path,
        evaluator=coc_playtest_suite.SemanticArtifactCoverageEvaluator(),
    )
    index = json.loads((tmp_path / ".coc" / "playtests" / "index.json").read_text())

    assert index["loop_decision"]["status"] == "needs_repair"
    assert index["loop_decision"]["blockers"][0]["type"] == "semantic_artifact_schema_invalid"
    assert "evaluation_provenance.request_missing" in index["runs"][0]["semantic_artifact_schema_errors"]


def test_suite_report_requires_explicit_semantic_quality_passed_flag(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "semantic-artifact-run"
    artifacts_dir = run_dir / "artifacts"
    artifacts_dir.mkdir(parents=True)
    (run_dir / "playtest.json").write_text(json.dumps({
        "run_id": "semantic-artifact-run",
        "campaign_title": "Semantic Artifact Fixture",
        "scenario": "Fixture Scenario",
        "audit_profile": "semantic_fixture",
        "player_profile": "careful_investigator",
        "subsystems_covered": ["combat", "chase", "sanity"],
    }))
    (artifacts_dir / "battle-report.md").write_text("Narrative text that requires semantic judgment.")
    (artifacts_dir / "rulebook-audit.md").write_text("# Rulebook Alignment Audit\n\n## Overall Result\nPASS\n")
    request = write_semantic_eval_request(artifacts_dir, "semantic-artifact-run")
    quality = {
        key: {
            "score": 4,
            "passed": True,
            "reason": f"LLM semantic judge scored {key} as table-ready.",
        }
        for key in coc_playtest_suite.QUALITY_DIMENSIONS
    }
    quality["rulebook_procedure"] = {
        "score": 4,
        "reason": "Missing the explicit passed flag should not be accepted.",
    }
    (artifacts_dir / "semantic-eval-result.json").write_text(json.dumps({
        "schema_version": 1,
        "run_id": "semantic-artifact-run",
        "evaluator_id": "codex-llm-semantic-v1",
        "evaluation_provenance": llm_semantic_provenance_for(request),
        "coverage": {
            key: {"covered": True, "reason": f"{key} covered by fixture."}
            for key in coc_playtest_suite.CORE_COVERAGE
        },
        "quality": quality,
        "root_cause_classification": ["test_gap"],
        "next_loop_fix_target": "Regenerate semantic-eval-result.json with explicit quality passed flags.",
    }))

    coc_playtest_suite.generate_suite_report(
        tmp_path,
        evaluator=coc_playtest_suite.SemanticArtifactCoverageEvaluator(),
    )
    index = json.loads((tmp_path / ".coc" / "playtests" / "index.json").read_text())

    assert index["quality"]["rulebook_procedure"]["status"] == "needs_fix"
    assert "rulebook_procedure" in index["quality_gaps"]
    assert index["loop_decision"]["status"] == "needs_repair"
    assert index["loop_decision"]["blockers"][0]["type"] == "quality_gap"
    assert index["loop_decision"]["blockers"][0]["key"] == "rulebook_procedure"


def test_suite_report_requires_structured_semantic_coverage_reason(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "semantic-artifact-run"
    artifacts_dir = run_dir / "artifacts"
    artifacts_dir.mkdir(parents=True)
    (run_dir / "playtest.json").write_text(json.dumps({
        "run_id": "semantic-artifact-run",
        "campaign_title": "Semantic Artifact Fixture",
        "scenario": "Fixture Scenario",
        "audit_profile": "semantic_fixture",
        "player_profile": "careful_investigator",
        "subsystems_covered": ["combat", "sanity"],
    }))
    (artifacts_dir / "battle-report.md").write_text("Narrative text that requires semantic judgment.")
    (artifacts_dir / "rulebook-audit.md").write_text("# Rulebook Alignment Audit\n\n## Overall Result\nPASS\n")
    request = write_semantic_eval_request(artifacts_dir, "semantic-artifact-run")
    coverage = {
        key: {"covered": True, "reason": f"{key} covered by semantic fixture."}
        for key in coc_playtest_suite.CORE_COVERAGE
    }
    coverage["chase"] = True
    (artifacts_dir / "semantic-eval-result.json").write_text(json.dumps({
        "schema_version": 1,
        "run_id": "semantic-artifact-run",
        "evaluator_id": "codex-llm-semantic-v1",
        "evaluation_provenance": llm_semantic_provenance_for(request),
        "coverage": coverage,
        "quality": {
            key: {"score": 4, "passed": True, "reason": f"{key} passed by fixture."}
            for key in coc_playtest_suite.QUALITY_DIMENSIONS
        },
        "root_cause_classification": ["test_gap"],
        "next_loop_fix_target": "Regenerate semantic-eval-result.json with structured coverage reasons.",
    }))

    coc_playtest_suite.generate_suite_report(
        tmp_path,
        evaluator=coc_playtest_suite.SemanticArtifactCoverageEvaluator(),
    )
    index = json.loads((tmp_path / ".coc" / "playtests" / "index.json").read_text())

    assert index["coverage"]["chase"]["status"] == "missing"
    assert "chase" in index["gaps"]
    assert index["loop_decision"]["status"] == "needs_repair"
    assert index["loop_decision"]["blockers"][0]["type"] == "coverage_gap"
    assert index["loop_decision"]["blockers"][0]["key"] == "chase"


def test_suite_report_requires_semantic_result_loop_fields(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "semantic-artifact-run"
    artifacts_dir = run_dir / "artifacts"
    artifacts_dir.mkdir(parents=True)
    (run_dir / "playtest.json").write_text(json.dumps({
        "run_id": "semantic-artifact-run",
        "campaign_title": "Semantic Artifact Fixture",
        "scenario": "Fixture Scenario",
        "audit_profile": "semantic_fixture",
        "player_profile": "careful_investigator",
    }))
    (artifacts_dir / "battle-report.md").write_text("Narrative text that requires semantic judgment.")
    (artifacts_dir / "rulebook-audit.md").write_text("# Rulebook Alignment Audit\n\n## Overall Result\nPASS\n")
    request = write_semantic_eval_request(artifacts_dir, "semantic-artifact-run")
    (artifacts_dir / "semantic-eval-result.json").write_text(json.dumps({
        "schema_version": 1,
        "run_id": "semantic-artifact-run",
        "evaluator_id": "codex-llm-semantic-v1",
        "evaluation_provenance": llm_semantic_provenance_for(request),
        "coverage": {
            key: {"covered": True, "reason": f"{key} covered by fixture."}
            for key in coc_playtest_suite.CORE_COVERAGE
        },
        "quality": {
            key: {"score": 4, "passed": True, "reason": f"{key} passed by fixture."}
            for key in coc_playtest_suite.QUALITY_DIMENSIONS
        },
        "next_loop_fix_target": "none",
    }))

    coc_playtest_suite.generate_suite_report(
        tmp_path,
        evaluator=coc_playtest_suite.SemanticArtifactCoverageEvaluator(),
    )
    index = json.loads((tmp_path / ".coc" / "playtests" / "index.json").read_text())

    assert index["loop_decision"]["status"] == "needs_repair"
    assert index["loop_decision"]["blockers"][0]["type"] == "semantic_artifact_schema_invalid"
    assert index["loop_decision"]["blockers"][0]["run_id"] == "semantic-artifact-run"
    assert "root_cause_classification" in index["loop_decision"]["blockers"][0]["next_loop_fix_target"]


def test_suite_report_requires_llm_semantic_evaluator_provenance(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "semantic-artifact-run"
    artifacts_dir = run_dir / "artifacts"
    artifacts_dir.mkdir(parents=True)
    (run_dir / "playtest.json").write_text(json.dumps({
        "run_id": "semantic-artifact-run",
        "campaign_title": "Semantic Artifact Fixture",
        "scenario": "Fixture Scenario",
        "audit_profile": "semantic_fixture",
        "player_profile": "careful_investigator",
    }))
    (artifacts_dir / "battle-report.md").write_text("Narrative text that requires semantic judgment.")
    (artifacts_dir / "rulebook-audit.md").write_text("# Rulebook Alignment Audit\n\n## Overall Result\nPASS\n")
    (artifacts_dir / "semantic-eval-result.json").write_text(json.dumps({
        "schema_version": 1,
        "run_id": "semantic-artifact-run",
        "evaluator_id": "fixture-semantic-evaluator",
        "coverage": {
            key: {"covered": True, "reason": f"{key} covered by fixture."}
            for key in coc_playtest_suite.CORE_COVERAGE
        },
        "quality": {
            key: {"score": 4, "passed": True, "reason": f"{key} passed by fixture."}
            for key in coc_playtest_suite.QUALITY_DIMENSIONS
        },
        "root_cause_classification": ["test_gap"],
        "next_loop_fix_target": "Regenerate semantic-eval-result.json with LLM provenance.",
    }))

    coc_playtest_suite.generate_suite_report(
        tmp_path,
        evaluator=coc_playtest_suite.SemanticArtifactCoverageEvaluator(),
    )
    index = json.loads((tmp_path / ".coc" / "playtests" / "index.json").read_text())

    assert index["loop_decision"]["status"] == "needs_repair"
    assert index["loop_decision"]["blockers"][0]["type"] == "semantic_artifact_schema_invalid"
    assert index["loop_decision"]["blockers"][0]["run_id"] == "semantic-artifact-run"
    target = index["loop_decision"]["blockers"][0]["next_loop_fix_target"]
    assert "evaluator_id" in target
    assert "evaluation_provenance" in target


def test_suite_report_flags_missing_virtual_player_pressure_quality(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "single-profile-run"
    artifacts_dir = run_dir / "artifacts"
    artifacts_dir.mkdir(parents=True)
    (run_dir / "playtest.json").write_text(json.dumps({
        "run_id": "single-profile-run",
        "campaign_title": "Single Profile Fixture",
        "scenario": "Fixture Scenario",
        "audit_profile": "haunting_module",
        "player_profile": "careful_investigator",
        "subsystems_covered": ["combat", "chase", "sanity"],
    }))
    (artifacts_dir / "battle-report.md").write_text("Only one simulated player profile is represented.")
    (artifacts_dir / "rulebook-audit.md").write_text("# Rulebook Alignment Audit\n\n## Overall Result\nPASS\n")
    request = write_semantic_eval_request(
        artifacts_dir,
        "single-profile-run",
        "Only one simulated player profile is represented.",
    )
    (artifacts_dir / "semantic-eval-result.json").write_text(json.dumps({
        "schema_version": 1,
        "run_id": "single-profile-run",
        "evaluator_id": "codex-llm-semantic-v1",
        "evaluation_provenance": llm_semantic_provenance_for(request),
        "coverage": {
            key: {"covered": True, "reason": f"{key} covered by fixture."}
            for key in coc_playtest_suite.CORE_COVERAGE
        },
        "quality": {
            key: {"score": 4, "passed": True, "reason": f"{key} passed by fixture."}
            for key in coc_playtest_suite.QUALITY_DIMENSIONS
            if key != "virtual_player_pressure"
        },
        "root_cause_classification": ["test_gap"],
        "next_loop_fix_target": "Add a multi-profile virtual player pressure run.",
    }))

    coc_playtest_suite.generate_suite_report(
        tmp_path,
        evaluator=coc_playtest_suite.SemanticArtifactCoverageEvaluator(),
    )
    index = json.loads((tmp_path / ".coc" / "playtests" / "index.json").read_text())

    assert index["quality"]["virtual_player_pressure"]["status"] == "needs_fix"
    assert "virtual_player_pressure" in index["quality_gaps"]
    assert index["loop_decision"]["status"] == "needs_repair"
    assert index["loop_decision"]["blockers"][0]["type"] == "quality_gap"
    assert index["loop_decision"]["blockers"][0]["key"] == "virtual_player_pressure"


def test_loop_decision_ignores_historical_baseline_missing_semantic_result(tmp_path):
    baseline_dir = tmp_path / ".coc" / "playtests" / "old-baseline"
    baseline_artifacts = baseline_dir / "artifacts"
    baseline_artifacts.mkdir(parents=True)
    (baseline_dir / "playtest.json").write_text(json.dumps({
        "run_id": "old-baseline",
        "campaign_title": "Old Baseline",
        "scenario": "Old Smoke",
        "audit_profile": "baseline",
        "player_profile": "careful_investigator",
    }))
    (baseline_artifacts / "battle-report.md").write_text("Old smoke report without semantic result.")

    active_dir = tmp_path / ".coc" / "playtests" / "active-module"
    active_artifacts = active_dir / "artifacts"
    active_artifacts.mkdir(parents=True)
    (active_dir / "playtest.json").write_text(json.dumps({
        "run_id": "active-module",
        "campaign_title": "Active Module",
        "scenario": "Active Scenario",
        "audit_profile": "haunting_module",
        "player_profile": "careful_investigator",
        "subsystems_covered": ["combat", "chase", "sanity"],
    }))
    (active_artifacts / "battle-report.md").write_text("Active report with semantic result.")
    (active_artifacts / "rulebook-audit.md").write_text("# Rulebook Alignment Audit\n\n## Overall Result\nPASS\n")
    request = write_semantic_eval_request(
        active_artifacts,
        "active-module",
        "Active report with semantic result.",
    )
    (active_artifacts / "semantic-eval-result.json").write_text(json.dumps({
        "schema_version": 1,
        "run_id": "active-module",
        "evaluator_id": "codex-llm-semantic-v1",
        "evaluation_provenance": llm_semantic_provenance_for(request),
        "coverage": {
            key: {"covered": True, "reason": f"{key} covered by active run."}
            for key in coc_playtest_suite.CORE_COVERAGE
        },
        "quality": {
            key: {"score": 4, "passed": True, "reason": f"{key} passed by active run."}
            for key in coc_playtest_suite.QUALITY_DIMENSIONS
        },
        "root_cause_classification": [],
        "next_loop_fix_target": "none",
    }))

    report_path = coc_playtest_suite.generate_suite_report(
        tmp_path,
        evaluator=coc_playtest_suite.SemanticArtifactCoverageEvaluator(),
    )
    index = json.loads((tmp_path / ".coc" / "playtests" / "index.json").read_text())
    report_text = report_path.read_text()

    assert index["non_passing_runs"] == []
    assert index["loop_decision"]["status"] == "ready_for_completion_audit"
    assert index["loop_decision"]["thread_goal_status"] == "active_not_complete"
    assert index["loop_decision"]["evaluated_runs"] == ["active-module"]
    assert index["loop_decision"]["ignored_historical_runs"] == ["old-baseline"]
    assert index["loop_decision"]["blockers"] == []
    assert "## Non-Passing Evaluated Runs" in report_text
    assert "- No non-passing evaluated runs in this suite." in report_text
    assert "- old-baseline: baseline MISSING" not in report_text
    assert "old-baseline: Fill artifacts/semantic-eval-result.json" not in report_text
    assert "- active-module: none" in report_text
    assert report_path == tmp_path / ".coc" / "playtests" / "suite-report.md"


def test_suite_matrices_ignore_historical_baseline_coverage_and_quality(tmp_path):
    baseline_dir = tmp_path / ".coc" / "playtests" / "old-baseline"
    baseline_artifacts = baseline_dir / "artifacts"
    baseline_artifacts.mkdir(parents=True)
    (baseline_dir / "playtest.json").write_text(json.dumps({
        "run_id": "old-baseline",
        "campaign_title": "Old Baseline",
        "scenario": "Old Smoke",
        "audit_profile": "baseline",
        "player_profile": "careful_investigator",
        "subsystems_covered": ["combat", "chase", "sanity"],
    }))
    (baseline_artifacts / "battle-report.md").write_text("Old smoke report with stale semantic result.")
    baseline_request = write_semantic_eval_request(
        baseline_artifacts,
        "old-baseline",
        "Old smoke report with stale semantic result.",
    )
    (baseline_artifacts / "semantic-eval-result.json").write_text(json.dumps({
        "schema_version": 1,
        "run_id": "old-baseline",
        "evaluator_id": "codex-llm-semantic-v1",
        "evaluation_provenance": llm_semantic_provenance_for(baseline_request),
        "coverage": {
            key: {"covered": True, "reason": f"{key} covered only by ignored historical run."}
            for key in coc_playtest_suite.CORE_COVERAGE
        },
        "quality": {
            key: {"score": 5, "passed": True, "reason": f"{key} passed only by ignored historical run."}
            for key in coc_playtest_suite.QUALITY_DIMENSIONS
        },
        "root_cause_classification": [],
        "next_loop_fix_target": "none",
    }))

    active_dir = tmp_path / ".coc" / "playtests" / "active-module"
    active_artifacts = active_dir / "artifacts"
    active_artifacts.mkdir(parents=True)
    (active_dir / "playtest.json").write_text(json.dumps({
        "run_id": "active-module",
        "campaign_title": "Active Module",
        "scenario": "Active Scenario",
        "audit_profile": "haunting_module",
        "player_profile": "careful_investigator",
        "subsystems_covered": ["combat", "sanity"],
    }))
    (active_artifacts / "battle-report.md").write_text("Active report missing chase and actual-play quality.")
    (active_artifacts / "rulebook-audit.md").write_text("# Rulebook Alignment Audit\n\n## Overall Result\nPASS\n")
    active_request = write_semantic_eval_request(
        active_artifacts,
        "active-module",
        "Active report missing chase and actual-play quality.",
    )
    (active_artifacts / "semantic-eval-result.json").write_text(json.dumps({
        "schema_version": 1,
        "run_id": "active-module",
        "evaluator_id": "codex-llm-semantic-v1",
        "evaluation_provenance": llm_semantic_provenance_for(active_request),
        "coverage": {
            key: {
                "covered": key != "chase",
                "reason": (
                    "Active run has no chase evidence."
                    if key == "chase"
                    else f"{key} covered by active run."
                ),
            }
            for key in coc_playtest_suite.CORE_COVERAGE
        },
        "quality": {
            key: {
                "score": 3 if key == "actual_play_replay" else 4,
                "passed": key != "actual_play_replay",
                "reason": (
                    "Active report is too compressed to replay like a real session."
                    if key == "actual_play_replay"
                    else f"{key} passed by active run."
                ),
            }
            for key in coc_playtest_suite.QUALITY_DIMENSIONS
        },
        "root_cause_classification": ["test_gap"],
        "next_loop_fix_target": "Add active chase and actual-play replay evidence.",
    }))

    report_path = coc_playtest_suite.generate_suite_report(
        tmp_path,
        evaluator=coc_playtest_suite.SemanticArtifactCoverageEvaluator(),
    )
    index = json.loads((tmp_path / ".coc" / "playtests" / "index.json").read_text())
    report_text = report_path.read_text()

    assert index["coverage"]["chase"]["status"] == "missing"
    assert index["coverage"]["chase"]["runs"] == []
    assert "chase" in index["gaps"]
    assert index["quality"]["actual_play_replay"]["status"] == "needs_fix"
    assert index["quality"]["actual_play_replay"]["runs"] == []
    assert "actual_play_replay" in index["quality_gaps"]
    assert index["loop_decision"]["status"] == "needs_repair"
    assert index["loop_decision"]["evaluated_runs"] == ["active-module"]
    assert index["loop_decision"]["ignored_historical_runs"] == ["old-baseline"]
    assert index["loop_decision"]["blockers"][0]["type"] == "coverage_gap"
    assert index["loop_decision"]["blockers"][0]["key"] == "chase"
    assert "chase: missing (none)" in report_text
    assert "actual_play_replay: needs_fix (none)" in report_text
    assert "old-baseline [codex-llm-semantic-v1]: chase covered only by ignored historical run." not in report_text
    assert report_path == tmp_path / ".coc" / "playtests" / "suite-report.md"
