import importlib.util
import hashlib
import json
from pathlib import Path


def load_module(name: str, relative_path: str):
    path = Path(relative_path)
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_completion_audit = load_module("coc_completion_audit", "plugins/coc-keeper/scripts/coc_completion_audit.py")
coc_playtest_suite = load_module("coc_playtest_suite", "plugins/coc-keeper/scripts/coc_playtest_suite.py")


def write_json(path: Path, payload: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def write_text(path: Path, text: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def write_jsonl(path: Path, rows: list[dict]):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(json.dumps(row) for row in rows) + "\n", encoding="utf-8")


def request_payload(run_id: str) -> dict:
    return {
        "schema_version": 1,
        "kind": "coc_semantic_coverage_request",
        "run_id": run_id,
        "inputs": {"battle_report": "fixture evidence"},
    }


def request_hash(payload: dict) -> str:
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def semantic_result(run_id: str, *, virtual_pressure: bool = False) -> dict:
    request = request_payload(run_id)
    quality = {
        key: {
            "score": 5 if key == "virtual_player_pressure" and virtual_pressure else 4,
            "passed": virtual_pressure if key == "virtual_player_pressure" else True,
            "reason": f"{key} checked by semantic fixture.",
        }
        for key in coc_playtest_suite.QUALITY_DIMENSIONS
    }
    return {
        "schema_version": 1,
        "run_id": run_id,
        "evaluator_id": "codex-llm-semantic-v1",
        "evaluation_provenance": {
            "kind": "llm",
            "request_sha256": request_hash(request),
            "evaluator_note": "Fixture stands in for a completed Codex semantic review.",
        },
        "coverage": {
            key: {"covered": True, "reason": f"{key} covered by semantic fixture."}
            for key in coc_playtest_suite.CORE_COVERAGE
        },
        "quality": quality,
        "root_cause_classification": [],
        "next_loop_fix_target": "none",
    }


def write_run(root: Path, run_id: str, audit_profile: str, *, virtual_pressure: bool = False):
    run_dir = root / ".coc" / "playtests" / run_id
    write_json(run_dir / "playtest.json", {
        "run_id": run_id,
        "campaign_id": run_id,
        "campaign_title": run_id,
        "scenario": "Fixture Scenario",
        "audit_profile": audit_profile,
        "player_profile": "fixture",
        "play_language": "zh-Hans",
        "language_profile": {
            "language": "zh-Hans",
            "display_name": "Simplified Chinese",
            "term_policy": "Use localized_terms.zh-Hans for people, places, factions, handouts, scenario titles, and special terms.",
        },
        "localized_terms": {"zh-Hans": {"Ada King": "艾达·金"}},
    })
    write_text(run_dir / "artifacts" / "battle-report.md", "# Battle Report\n\n## Actual Play Replay\n")
    write_text(run_dir / "artifacts" / "evaluation-report.md", "# Evaluation Report\n")
    write_text(run_dir / "artifacts" / "rulebook-audit.md", "# Rulebook Alignment Audit\n\n## Overall Result\nPASS\n")
    write_json(run_dir / "artifacts" / "semantic-eval-request.json", request_payload(run_id))
    write_json(run_dir / "artifacts" / "semantic-eval-result.json", semantic_result(run_id, virtual_pressure=virtual_pressure))


def write_index(root: Path, runs: list[dict], *, quality_gap: str | None = None):
    playtests_dir = root / ".coc" / "playtests"
    coverage = {
        key: {
            "label": key,
            "status": "covered",
            "runs": [run["run_id"] for run in runs],
            "reasons": {run["run_id"]: f"{key} covered." for run in runs},
        }
        for key in coc_playtest_suite.CORE_COVERAGE
    }
    quality = {
        key: {
            "label": key,
            "status": "needs_fix" if key == quality_gap else "passed",
            "runs": [run["run_id"] for run in runs if key != quality_gap],
            "scores": {run["run_id"]: 4 for run in runs if key != quality_gap},
            "reasons": {run["run_id"]: f"{key} passed." for run in runs if key != quality_gap},
        }
        for key in coc_playtest_suite.QUALITY_DIMENSIONS
    }
    loop_decision = {
        "schema_version": 1,
        "status": "needs_repair" if quality_gap else "ready_for_completion_audit",
        "evaluated_runs": [run["run_id"] for run in runs],
        "ignored_historical_runs": [],
        "blockers": [] if quality_gap is None else [{
            "type": "quality_gap",
            "key": quality_gap,
            "root_cause_classification": ["test_gap"],
            "next_loop_fix_target": f"Fix {quality_gap}.",
        }],
        "next_action": "Run the full completion audit." if quality_gap is None else f"Fix {quality_gap}.",
    }
    write_json(playtests_dir / "index.json", {
        "schema_version": 1,
        "runs": runs,
        "coverage": coverage,
        "quality": quality,
        "gaps": [],
        "quality_gaps": [] if quality_gap is None else [quality_gap],
        "non_passing_runs": [],
        "loop_decision": loop_decision,
    })
    write_json(playtests_dir / "loop-decision.json", loop_decision)
    write_text(playtests_dir / "suite-report.md", "# COC Playtest Suite Report\n")


def test_completion_audit_passes_for_ready_suite_with_active_monitor(tmp_path):
    runs = [
        {"run_id": "v2-haunting-module", "audit_profile": "haunting_module", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v3-chase-drill", "audit_profile": "chase_drill", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v4-multi-profile-pressure", "audit_profile": "multi_profile_pressure", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
    ]
    for run in runs:
        write_run(
            tmp_path,
            run["run_id"],
            run["audit_profile"],
            virtual_pressure=run["audit_profile"] == "multi_profile_pressure",
        )
    write_index(tmp_path, runs)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    audit_path = coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())
    markdown = audit_path.read_text()

    assert audit["result"] == "pass"
    assert audit["findings"] == []
    assert audit["active_runs"] == ["v2-haunting-module", "v3-chase-drill", "v4-multi-profile-pressure"]
    assert audit["required_profiles"]["multi_profile_pressure"] == "v4-multi-profile-pressure"
    assert "## Overall Result\nPASS" in markdown
    assert "virtual_player_pressure: passed" in markdown
    assert "Monitor: ACTIVE" in markdown


def test_completion_audit_fails_without_multi_profile_pressure(tmp_path):
    runs = [
        {"run_id": "v2-haunting-module", "audit_profile": "haunting_module", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v3-chase-drill", "audit_profile": "chase_drill", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
    ]
    for run in runs:
        write_run(tmp_path, run["run_id"], run["audit_profile"])
    write_index(tmp_path, runs, quality_gap="virtual_player_pressure")

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=tmp_path / "missing.toml")
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    assert any(finding["code"] == "required_profile_missing" for finding in audit["findings"])
    assert any(finding["code"] == "quality_gap" and finding["key"] == "virtual_player_pressure" for finding in audit["findings"])


def test_completion_audit_fails_without_language_profile(tmp_path):
    runs = [
        {"run_id": "v2-haunting-module", "audit_profile": "haunting_module", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v3-chase-drill", "audit_profile": "chase_drill", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v4-multi-profile-pressure", "audit_profile": "multi_profile_pressure", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
    ]
    for run in runs:
        write_run(
            tmp_path,
            run["run_id"],
            run["audit_profile"],
            virtual_pressure=run["audit_profile"] == "multi_profile_pressure",
        )
    metadata_path = tmp_path / ".coc" / "playtests" / "v2-haunting-module" / "playtest.json"
    metadata = json.loads(metadata_path.read_text())
    metadata.pop("language_profile")
    write_json(metadata_path, metadata)
    write_index(tmp_path, runs)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    assert any(finding["code"] == "language_profile_missing" for finding in audit["findings"])


def test_completion_audit_accepts_selected_non_default_play_language(tmp_path):
    runs = [
        {"run_id": "v2-haunting-module", "audit_profile": "haunting_module", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v3-chase-drill", "audit_profile": "chase_drill", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v4-multi-profile-pressure", "audit_profile": "multi_profile_pressure", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
    ]
    for run in runs:
        write_run(
            tmp_path,
            run["run_id"],
            run["audit_profile"],
            virtual_pressure=run["audit_profile"] == "multi_profile_pressure",
        )
    metadata_path = tmp_path / ".coc" / "playtests" / "v2-haunting-module" / "playtest.json"
    metadata = json.loads(metadata_path.read_text())
    metadata["play_language"] = "ja-JP"
    metadata["language_profile"] = {
        "language": "ja-JP",
        "display_name": "Japanese",
        "term_policy": "Use localized_terms.ja-JP for people, places, factions, handouts, scenario titles, and special terms.",
    }
    metadata["localized_terms"] = {"ja-JP": {"Ada King": "エイダ・キング"}}
    write_json(metadata_path, metadata)
    write_index(tmp_path, runs)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "pass"
    assert audit["findings"] == []


def test_completion_audit_fails_when_evaluation_report_omits_note_evidence(tmp_path):
    runs = [
        {"run_id": "v2-haunting-module", "audit_profile": "haunting_module", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v3-chase-drill", "audit_profile": "chase_drill", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v4-multi-profile-pressure", "audit_profile": "multi_profile_pressure", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
    ]
    for run in runs:
        write_run(
            tmp_path,
            run["run_id"],
            run["audit_profile"],
            virtual_pressure=run["audit_profile"] == "multi_profile_pressure",
        )
    run_dir = tmp_path / ".coc" / "playtests" / "v2-haunting-module"
    write_jsonl(run_dir / "evaluator-notes.jsonl", [
        {
            "severity": "low",
            "category": "state_integrity",
            "text": "State files agree with the transcript.",
            "evidence": {
                "transcript_turns": [1, 2],
                "log_paths": ["sandbox/.coc/campaigns/v2-haunting-module/logs/events.jsonl"],
                "state_files": ["sandbox/.coc/investigators/ada-king/character.json"],
            },
        }
    ])
    write_text(
        run_dir / "artifacts" / "evaluation-report.md",
        "# Evaluation Report\n\n## State Integrity Findings\n- [low] state_integrity: State files agree with the transcript.\n",
    )
    write_index(tmp_path, runs)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    assert any(finding["code"] == "evaluation_report_evidence_missing" for finding in audit["findings"])


def test_completion_audit_fails_without_llm_semantic_provenance(tmp_path):
    runs = [
        {"run_id": "v2-haunting-module", "audit_profile": "haunting_module", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v3-chase-drill", "audit_profile": "chase_drill", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v4-multi-profile-pressure", "audit_profile": "multi_profile_pressure", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
    ]
    for run in runs:
        write_run(
            tmp_path,
            run["run_id"],
            run["audit_profile"],
            virtual_pressure=run["audit_profile"] == "multi_profile_pressure",
        )
    semantic_path = tmp_path / ".coc" / "playtests" / "v2-haunting-module" / "artifacts" / "semantic-eval-result.json"
    semantic = json.loads(semantic_path.read_text())
    semantic.pop("evaluation_provenance")
    write_json(semantic_path, semantic)
    write_index(tmp_path, runs)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    assert any(finding["code"] == "semantic_provenance_missing" for finding in audit["findings"])


def test_completion_audit_fails_when_semantic_quality_dimension_missing_required_fields(tmp_path):
    runs = [
        {"run_id": "v2-haunting-module", "audit_profile": "haunting_module", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v3-chase-drill", "audit_profile": "chase_drill", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v4-multi-profile-pressure", "audit_profile": "multi_profile_pressure", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
    ]
    for run in runs:
        write_run(
            tmp_path,
            run["run_id"],
            run["audit_profile"],
            virtual_pressure=run["audit_profile"] == "multi_profile_pressure",
        )
    semantic_path = tmp_path / ".coc" / "playtests" / "v2-haunting-module" / "artifacts" / "semantic-eval-result.json"
    semantic = json.loads(semantic_path.read_text())
    semantic["quality"]["rulebook_procedure"].pop("passed")
    write_json(semantic_path, semantic)
    write_index(tmp_path, runs)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    assert any(
        finding["code"] == "semantic_quality_dimension_invalid"
        and finding["run_id"] == "v2-haunting-module"
        and finding["key"] == "rulebook_procedure"
        for finding in audit["findings"]
    )


def test_completion_audit_fails_when_semantic_coverage_dimension_missing_required_fields(tmp_path):
    runs = [
        {"run_id": "v2-haunting-module", "audit_profile": "haunting_module", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v3-chase-drill", "audit_profile": "chase_drill", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v4-multi-profile-pressure", "audit_profile": "multi_profile_pressure", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
    ]
    for run in runs:
        write_run(
            tmp_path,
            run["run_id"],
            run["audit_profile"],
            virtual_pressure=run["audit_profile"] == "multi_profile_pressure",
        )
    semantic_path = tmp_path / ".coc" / "playtests" / "v2-haunting-module" / "artifacts" / "semantic-eval-result.json"
    semantic = json.loads(semantic_path.read_text())
    semantic["coverage"]["chase"] = True
    write_json(semantic_path, semantic)
    write_index(tmp_path, runs)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    assert any(
        finding["code"] == "semantic_coverage_dimension_invalid"
        and finding["run_id"] == "v2-haunting-module"
        and finding["key"] == "chase"
        for finding in audit["findings"]
    )


def test_completion_audit_fails_when_semantic_loop_fields_are_missing(tmp_path):
    runs = [
        {"run_id": "v2-haunting-module", "audit_profile": "haunting_module", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v3-chase-drill", "audit_profile": "chase_drill", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
        {"run_id": "v4-multi-profile-pressure", "audit_profile": "multi_profile_pressure", "audit_result": "PASS", "coverage_evaluator": "codex-llm-semantic-v1"},
    ]
    for run in runs:
        write_run(
            tmp_path,
            run["run_id"],
            run["audit_profile"],
            virtual_pressure=run["audit_profile"] == "multi_profile_pressure",
        )
    semantic_path = tmp_path / ".coc" / "playtests" / "v2-haunting-module" / "artifacts" / "semantic-eval-result.json"
    semantic = json.loads(semantic_path.read_text())
    semantic.pop("root_cause_classification")
    semantic.pop("next_loop_fix_target")
    write_json(semantic_path, semantic)
    write_index(tmp_path, runs)
    automation_path = tmp_path / "automation.toml"
    write_text(automation_path, 'status = "ACTIVE"\nprompt = "multi-profile virtual player pressure"\n')

    coc_completion_audit.generate_completion_audit(tmp_path, automation_path=automation_path)
    audit = json.loads((tmp_path / ".coc" / "playtests" / "completion-audit.json").read_text())

    assert audit["result"] == "fail"
    assert any(
        finding["code"] == "semantic_required_field_missing"
        and finding["run_id"] == "v2-haunting-module"
        and set(finding["missing_fields"]) == {"root_cause_classification", "next_loop_fix_target"}
        for finding in audit["findings"]
    )
