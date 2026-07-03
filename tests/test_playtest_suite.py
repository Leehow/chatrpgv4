import importlib.util
import json
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
    assert index["coverage"]["meta_game"]["runs"] == ["v2-haunting-module"]
    assert index["coverage"]["player_feedback"]["status"] == "covered"
    assert index["gaps"] == []
    assert index["non_passing_runs"] == []

    assert "# COC Playtest Suite Report" in report_text
    assert "## Run Index" in report_text
    assert "v2-haunting-module" in report_text
    assert "The Haunting Module Playthrough" in report_text
    assert "haunting_module" in report_text
    assert "v3-chase-drill" in report_text
    assert "Rooftop Chase Drill" in report_text
    assert "chase_drill" in report_text
    assert "## Core Coverage Matrix" in report_text
    assert "character_dossier: covered" in report_text
    assert "kp_player_transcript: covered" in report_text
    assert "mechanical_rolls: covered" in report_text
    assert "combat: covered" in report_text
    assert "chase: covered" in report_text
    assert "sanity: covered" in report_text
    assert "meta_game: covered" in report_text
    assert "player_feedback: covered" in report_text
    assert "## Non-Passing Runs" in report_text
    assert "- No non-passing runs in this suite." in report_text
    assert "## Remaining Gaps" in report_text
    assert "- No gaps detected across indexed playtest runs." in report_text


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
        "subsystems_covered": [],
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
    assert "chinese_visible_dialogue" in quality_keys
    assert "actual_play_replay" in quality_keys
    assert "virtual_player_pressure" in quality_keys
    quality_questions = {entry["key"]: entry["question"] for entry in request["quality_dimensions"]}
    assert "Chinese" in quality_questions["chinese_visible_dialogue"]
    assert "actual-play" in quality_questions["actual_play_replay"]
    assert "multiple player profiles" in quality_questions["virtual_player_pressure"]
    assert "battle_report" in request["inputs"]
    assert "transcript" in request["inputs"]
    assert "state_events" in request["inputs"]
    assert request["expected_output_schema"]["required"] == [
        "schema_version",
        "run_id",
        "evaluator_id",
        "coverage",
        "quality",
        "root_cause_classification",
        "next_loop_fix_target",
    ]


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
        "subsystems_covered": [],
    }))
    (artifacts_dir / "battle-report.md").write_text("Narrative text that requires semantic judgment.")
    (artifacts_dir / "rulebook-audit.md").write_text("# Rulebook Alignment Audit\n\n## Overall Result\nPASS\n")
    (artifacts_dir / "semantic-eval-result.json").write_text(json.dumps({
        "schema_version": 1,
        "run_id": "semantic-artifact-run",
        "evaluator_id": "codex-llm-semantic-v1",
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
    assert index["loop_decision"]["blockers"] == []
    assert index["loop_decision"]["evaluated_runs"] == ["semantic-artifact-run"]
    assert loop_decision == index["loop_decision"]
    assert "codex-llm-semantic-v1" in report_text
    assert "## Loop Decision" in report_text
    assert "ready_for_completion_audit" in report_text
    assert "## Quality Matrix" in report_text
    assert "## Remaining Quality Gaps" in report_text
    assert "- No quality gaps detected across indexed playtest runs." in report_text
    assert "## Repair Targets" in report_text
    assert "semantic-artifact-run: none" in report_text
    assert "LLM semantic judge found chase in the run evidence." in report_text
    assert "LLM semantic judge scored rulebook_procedure as table-ready." in report_text


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
    }))
    (artifacts_dir / "battle-report.md").write_text("Only one simulated player profile is represented.")
    (artifacts_dir / "rulebook-audit.md").write_text("# Rulebook Alignment Audit\n\n## Overall Result\nPASS\n")
    (artifacts_dir / "semantic-eval-result.json").write_text(json.dumps({
        "schema_version": 1,
        "run_id": "single-profile-run",
        "evaluator_id": "codex-llm-semantic-v1",
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
    }))
    (active_artifacts / "battle-report.md").write_text("Active report with semantic result.")
    (active_artifacts / "rulebook-audit.md").write_text("# Rulebook Alignment Audit\n\n## Overall Result\nPASS\n")
    (active_artifacts / "semantic-eval-result.json").write_text(json.dumps({
        "schema_version": 1,
        "run_id": "active-module",
        "evaluator_id": "codex-llm-semantic-v1",
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

    assert index["non_passing_runs"] == [{
        "run_id": "old-baseline",
        "audit_result": "MISSING",
        "audit_profile": "baseline",
    }]
    assert index["loop_decision"]["status"] == "ready_for_completion_audit"
    assert index["loop_decision"]["evaluated_runs"] == ["active-module"]
    assert index["loop_decision"]["ignored_historical_runs"] == ["old-baseline"]
    assert index["loop_decision"]["blockers"] == []
    assert "old-baseline: Fill artifacts/semantic-eval-result.json" not in report_text
    assert "- active-module: none" in report_text
    assert report_path == tmp_path / ".coc" / "playtests" / "suite-report.md"
