from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest


REPO = Path(__file__).resolve().parents[1]
CONTRACT_PATH = REPO / "plugins" / "coc-keeper" / "scripts" / "coc_eval_contract.py"


def _load_contract():
    spec = importlib.util.spec_from_file_location(
        "coc_eval_contract_hardening_test", CONTRACT_PATH
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


def _write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows),
        encoding="utf-8",
    )


def _make_run(tmp_path: Path, *, rolls: list[dict]) -> Path:
    run_dir = tmp_path / "run"
    campaign_dir = run_dir / "sandbox" / ".coc" / "campaigns" / "run"
    _write_json(
        run_dir / "playtest.json",
        {
            "schema_version": 1,
            "run_id": "run",
            "campaign_id": "run",
            "play_language": "zh-Hans",
        },
    )
    _write_json(campaign_dir / "campaign.json", {"campaign_id": "run"})
    _write_json(campaign_dir / "party.json", {"investigator_ids": ["ada"]})
    _write_jsonl(campaign_dir / "logs" / "rolls.jsonl", rolls)
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
        "- source evidence follows.\n",
        encoding="utf-8",
    )
    return run_dir


def _write_manifest(path: Path, *, version: str = "2026.07.1") -> Path:
    target = path / "run-manifest.json"
    _write_json(
        target,
        {
            "schema_version": 1,
            "eval_spec": "eval-spec-v1",
            "benchmark_version": version,
            "report_schema_version": 2,
            "case_id": "fixture",
            "seed": 42,
            "initial_state_sha256": "same",
        },
    )
    return target


def test_report_contract_injection_is_idempotent(tmp_path):
    contract = _load_contract()
    run_dir = _make_run(
        tmp_path,
        rolls=[
            {
                "roll_id": "r-1",
                "type": "roll",
                "actor": "ada",
                "visibility": "public",
                "payload": {
                    "skill": "Spot Hidden",
                    "roll": 30,
                    "effective_target": 60,
                    "difficulty": "regular",
                    "outcome": "success",
                },
            }
        ],
    )

    contract.compile_report_contract(run_dir, generate_base_report=False)
    first = (run_dir / "artifacts" / "battle-report.md").read_text(encoding="utf-8")
    contract.compile_report_contract(run_dir, generate_base_report=False)
    second = (run_dir / "artifacts" / "battle-report.md").read_text(encoding="utf-8")

    assert first == second
    assert first.count("report-anchor: rules-and-dice") == 1
    assert first.count("[roll-id: r-1]") == 1


def test_percentile_sanity_roll_renders_san_loss_and_delta(tmp_path):
    contract = _load_contract()
    run_dir = _make_run(
        tmp_path,
        rolls=[
            {
                "roll_id": "san-1",
                "type": "sanity",
                "actor": "ada",
                "visibility": "consequence_public",
                "payload": {
                    "skill": "SAN",
                    "roll": 80,
                    "effective_target": 55,
                    "difficulty": "regular",
                    "outcome": "failure",
                    "san_loss": 4,
                    "san_before": 55,
                    "san_after": 51,
                },
            }
        ],
    )

    result = contract.compile_report_contract(run_dir, generate_base_report=False)
    report = Path(result["report_path"]).read_text(encoding="utf-8")

    assert "SAN 损失：4" in report
    assert "SAN 55 → 51" in report


def test_compare_is_non_comparable_when_baseline_completeness_missing(tmp_path):
    contract = _load_contract()
    baseline = _write_manifest(tmp_path / "baseline")
    candidate = _write_manifest(tmp_path / "candidate")
    _write_json(
        candidate.parent / "artifacts" / "report-completeness.json",
        {"schema_version": 1, "passed": True},
    )

    result = contract.compare_run_manifests(baseline, candidate)

    assert result["status"] == "NON_COMPARABLE"
    assert "baseline_report_completeness_missing_or_failed" in result["identity_mismatches"]


def test_compare_fails_when_candidate_completeness_missing(tmp_path):
    contract = _load_contract()
    baseline = _write_manifest(tmp_path / "baseline")
    candidate = _write_manifest(tmp_path / "candidate")
    _write_json(
        baseline.parent / "artifacts" / "report-completeness.json",
        {"schema_version": 1, "passed": True},
    )

    result = contract.compare_run_manifests(baseline, candidate)

    assert result["status"] == "FAIL"
    assert result["regressions"][0]["key"] == "report_completeness_missing"


def test_write_baseline_rejects_unverified_source(tmp_path):
    contract = _load_contract()
    source = _write_manifest(tmp_path / "source")

    with pytest.raises(ValueError, match="verified report-completeness"):
        contract.write_baseline_manifest(source, tmp_path / "baseline.json")


def test_write_baseline_binds_completeness_hash(tmp_path):
    contract = _load_contract()
    source = _write_manifest(tmp_path / "source")
    receipt_path = source.parent / "artifacts" / "report-completeness.json"
    _write_json(
        receipt_path,
        {
            "schema_version": 1,
            "eval_spec": "eval-spec-v1",
            "report_schema_version": 2,
            "passed": True,
            "missing_roll_ids": [],
        },
    )

    result = contract.write_baseline_manifest(source, tmp_path / "baseline.json")
    written = json.loads(Path(result["baseline_manifest"]).read_text(encoding="utf-8"))

    assert result["status"] == "PASS"
    assert written["report_completeness_sha256"] == contract.file_sha256(receipt_path)
