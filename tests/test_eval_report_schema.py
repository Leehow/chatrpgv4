from __future__ import annotations

import importlib.util
import json
from pathlib import Path


REPO = Path(__file__).resolve().parents[1]
CONTRACT_PATH = REPO / "plugins" / "coc-keeper" / "scripts" / "coc_eval_contract.py"


def _contract():
    spec = importlib.util.spec_from_file_location(
        "coc_eval_report_schema_test", CONTRACT_PATH
    )
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def _make_run(tmp_path: Path) -> Path:
    run_dir = tmp_path / "run-schema"
    campaign = run_dir / "sandbox" / ".coc" / "campaigns" / "run-schema"
    _write_json(
        run_dir / "playtest.json",
        {
            "schema_version": 1,
            "run_id": "run-schema",
            "campaign_id": "run-schema",
            "play_language": "zh-Hans",
            "scenario": "Schema Fixture",
        },
    )
    _write_json(campaign / "campaign.json", {"campaign_id": "run-schema"})
    _write_json(campaign / "party.json", {"investigator_ids": ["ada"]})
    (campaign / "logs").mkdir(parents=True, exist_ok=True)
    (campaign / "logs" / "rolls.jsonl").write_text(
        json.dumps(
            {
                "roll_id": "r-schema",
                "actor": "ada",
                "visibility": "public",
                "payload": {
                    "skill": "Spot Hidden",
                    "roll": 21,
                    "effective_target": 60,
                    "difficulty": "regular",
                    "outcome": "hard_success",
                },
            }
        )
        + "\n",
        encoding="utf-8",
    )
    _write_json(
        run_dir / "sandbox" / ".coc" / "investigators" / "ada" / "character.json",
        {"id": "ada", "name": "艾达"},
    )
    artifacts = run_dir / "artifacts"
    artifacts.mkdir(parents=True, exist_ok=True)
    (artifacts / "battle-report.md").write_text(
        "# Battle Report\n\n"
        "## Actual Play Replay <!-- report-anchor: Actual Play Replay -->\n\n"
        "- Turn 1 Player: 我观察现场。\n\n"
        "## Mechanical Log <!-- report-anchor: Mechanical Log -->\n\n"
        "- old output\n",
        encoding="utf-8",
    )
    (artifacts / "evaluation-report.md").write_text(
        "# Evaluation Report\n\n## Overall Result\nPASS\n",
        encoding="utf-8",
    )
    return run_dir


def test_compile_injects_report_schema_and_run_identity_once(tmp_path):
    contract = _contract()
    run_dir = _make_run(tmp_path)

    contract.compile_report_contract(run_dir, generate_base_report=False)
    compiled = contract.compile_report_contract(run_dir, generate_base_report=False)
    report = (run_dir / "artifacts" / "battle-report.md").read_text(
        encoding="utf-8"
    )
    receipt = json.loads(
        (run_dir / "artifacts" / "report-completeness.json").read_text(
            encoding="utf-8"
        )
    )

    assert report.count("report-schema-version: 2") == 1
    assert report.count("report-anchor: run-identity-and-evidence") == 1
    assert "run-schema" in report
    assert receipt["report_schema_marker_present"] is True
    assert receipt["run_identity_anchor_count"] == 1
    evaluation = (run_dir / "artifacts" / "evaluation-report.md").read_text(
        encoding="utf-8"
    )
    overall = evaluation.split("## Overall Result", 1)[1].strip().splitlines()[0]
    assert overall == compiled["status"]


def test_run_identity_uses_evidence_runner_models_when_manifest_omits_them():
    contract = _contract()
    section = contract.render_run_identity_section(
        {"run_id": "r1", "scenario": "The Haunting"},
        {},
        {
            "eligible": True,
            "reasons": [],
            "receipt": {"runners": {
                "narrator": {"model_identities": [
                    {"provider": "coding-relay", "id": "gpt-5.6-luna"}
                ]},
                "player": {"model_identities": [
                    {"provider": "coding-relay", "id": "gpt-5.6-luna"}
                ]},
            }},
        },
        language="zh-Hans",
    )
    assert "KP model: coding-relay/gpt-5.6-luna" in section
    assert "Player model: coding-relay/gpt-5.6-luna" in section


def test_verify_fails_when_report_schema_marker_is_removed(tmp_path):
    contract = _contract()
    run_dir = _make_run(tmp_path)
    contract.compile_report_contract(run_dir, generate_base_report=False)
    report_path = run_dir / "artifacts" / "battle-report.md"
    report_path.write_text(
        report_path.read_text(encoding="utf-8").replace(
            "<!-- report-schema-version: 2 -->\n", ""
        ),
        encoding="utf-8",
    )

    result = contract.verify_report_contract(run_dir)

    assert result["status"] == "FAIL"
    assert result["report_completeness"]["report_schema_marker_present"] is False


def test_evaluation_report_receives_contract_status_and_evidence_counts(tmp_path):
    contract = _contract()
    run_dir = _make_run(tmp_path)

    result = contract.compile_report_contract(run_dir, generate_base_report=False)
    evaluation = (run_dir / "artifacts" / "evaluation-report.md").read_text(
        encoding="utf-8"
    )

    assert result["status"] == "INELIGIBLE"
    assert evaluation.count("report-anchor: evaluation-contract") == 1
    assert "INELIGIBLE" in evaluation
    assert "Required public rolls: 1" in evaluation
    assert "Rendered public rolls: 1" in evaluation


def test_verify_updates_evaluation_report_after_roll_omission(tmp_path):
    contract = _contract()
    run_dir = _make_run(tmp_path)
    contract.compile_report_contract(run_dir, generate_base_report=False)
    report_path = run_dir / "artifacts" / "battle-report.md"
    report_path.write_text(
        "\n".join(
            line
            for line in report_path.read_text(encoding="utf-8").splitlines()
            if "[roll-id: r-schema]" not in line
        )
        + "\n",
        encoding="utf-8",
    )

    result = contract.verify_report_contract(run_dir)
    evaluation = (run_dir / "artifacts" / "evaluation-report.md").read_text(
        encoding="utf-8"
    )

    assert result["status"] == "FAIL"
    assert "Missing roll IDs: r-schema" in evaluation
    assert "Contract status: FAIL" in evaluation


def test_public_fumble_without_structured_consequence_fails_completeness(tmp_path):
    contract = _contract()
    run_dir = _make_run(tmp_path)
    rolls_path = (
        run_dir / "sandbox" / ".coc" / "campaigns" / "run-schema"
        / "logs" / "rolls.jsonl"
    )
    row = json.loads(rolls_path.read_text(encoding="utf-8"))
    row["payload"].update({"roll": 100, "outcome": "fumble"})
    rolls_path.write_text(json.dumps(row) + "\n", encoding="utf-8")

    result = contract.compile_report_contract(run_dir, generate_base_report=False)

    assert result["status"] == "FAIL"
    assert result["report_completeness"]["passed"] is False
    assert result["report_completeness"]["missing_fields_by_roll_id"] == {
        "r-schema": ["fumble_consequence"]
    }


def test_nested_canonical_dice_object_is_complete_non_percentile_evidence(tmp_path):
    contract = _contract()
    run_dir = _make_run(tmp_path)
    rolls_path = (
        run_dir / "sandbox" / ".coc" / "campaigns" / "run-schema"
        / "logs" / "rolls.jsonl"
    )
    row = json.loads(rolls_path.read_text(encoding="utf-8"))
    row["payload"] = {
        "event_type": "resource_change",
        "actor_id": "walter-corbitt",
        "reason": "flesh_ward",
        "dice": {"expression": "2D6", "raw": [3, 5], "total": 8},
    }
    rolls_path.write_text(json.dumps(row) + "\n", encoding="utf-8")

    result = contract.compile_report_contract(run_dir, generate_base_report=False)
    report = (run_dir / "artifacts" / "battle-report.md").read_text(
        encoding="utf-8"
    )

    assert result["report_completeness"]["missing_fields_by_roll_id"] == {}
    assert result["report_completeness"]["passed"] is True
    assert "2D6" in report
    assert "3 + 5" in report
