from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
from pathlib import Path


REPO = Path(__file__).resolve().parents[1]
CLI_PATH = REPO / "plugins" / "coc-keeper" / "scripts" / "coc_eval.py"
CONTRACT_PATH = REPO / "plugins" / "coc-keeper" / "scripts" / "coc_eval_contract.py"
AUDIT_PATH = REPO / "plugins" / "coc-keeper" / "scripts" / "coc_completion_audit.py"
SUITE_PATH = REPO / "plugins" / "coc-keeper" / "scripts" / "coc_playtest_suite.py"
MANIFEST_PATH = REPO / "evaluation" / "spec" / "v1" / "benchmark-manifest.json"
REGISTRY_PATH = REPO / "evaluation" / "spec" / "v1" / "case-registry.json"


def _load(name: str, path: Path):
    assert path.is_file(), f"missing module: {path}"
    if str(path.parent) not in sys.path:
        sys.path.insert(0, str(path.parent))
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def _load_cli():
    return _load("coc_eval_cli_integration_test", CLI_PATH)


def _load_contract():
    return _load("coc_eval_contract_integration_test", CONTRACT_PATH)


def _load_audit():
    return _load("coc_completion_audit_integration_test", AUDIT_PATH)


def _load_suite():
    return _load("coc_playtest_suite_integration_test", SUITE_PATH)


def _sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _write_json(path: Path, payload: object) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return path


def test_official_suite_routes_through_coc_eval_with_registry_evidence(tmp_path: Path):
    """Official evaluation enters coc_eval.py and emits registry-driven evidence."""
    cli = _load_cli()
    audit = _load_audit()
    out = tmp_path / "smoke-run"
    result = cli.run_suite(root=REPO, suite="smoke", output=out, host_id="local")

    assert result["status"] == "PASS"
    assert result.get("case_results_path") == "case-results.json"
    case_results_path = out / "case-results.json"
    assert case_results_path.is_file()
    payload = json.loads(case_results_path.read_text(encoding="utf-8"))
    assert payload["suite"] == "smoke"
    assert payload["status"] == "PASS"
    assert payload["cases"], "registry-driven case results required"
    for case in payload["cases"]:
        assert case["case_id"]
        assert case["status"] == "PASS"
        assert case.get("artifact_hashes"), f"missing evidence hashes for {case['case_id']}"
    assert result.get("artifact_hashes", {}).get("case-results.json")

    assessment = audit.assess_eval_contract_coverage(
        REPO,
        suite="smoke",
        case_results=payload,
    )
    assert assessment["schema_version"] == 1
    assert assessment["status"] in {"PASS", "NOT_RUN"}
    assert assessment["satisfied_case_ids"]
    assert set(assessment["satisfied_case_ids"]) <= {
        str(case["case_id"]) for case in payload["cases"]
    }


def test_nightly_and_release_cannot_pass_while_required_capabilities_not_run(
    tmp_path: Path,
):
    cli = _load_cli()
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    implemented = set(manifest["implemented_capabilities"])

    for suite in ("nightly", "release"):
        required = set(manifest["suites"][suite]["required_capabilities"])
        missing = sorted(required - implemented)
        assert missing, f"{suite} must still require unimplemented capabilities"
        result = cli.run_suite(
            root=REPO,
            suite=suite,
            output=tmp_path / suite,
            host_id="local",
        )
        assert result["status"] == "NOT_RUN", suite
        assert result["status"] != "PASS"
        assert result.get("missing_capabilities") == missing
        assert "reason" in result


def test_completion_audit_lists_eval_contract_gaps_not_only_historical_profiles():
    audit = _load_audit()
    requirements = audit.build_eval_contract_requirements(REPO, suite="release")

    assert requirements["schema_version"] == 1
    assert requirements["eval_spec"] == "eval-spec-v1"
    assert requirements["suite"] == "release"
    assert requirements["case_ids"], "release must require registry cases"
    assert requirements["persona_ids"], "release must require matrix personas"
    assert requirements["seeds"], "release must require matrix seeds"
    # Release contract is versioned eval-spec coverage, not the three historical profiles alone.
    historical = set(audit.REQUIRED_AUDIT_PROFILES)
    assert set(requirements["persona_ids"]) != historical
    assert len(requirements["persona_ids"]) > len(historical)
    assert "haunting_module" not in requirements["persona_ids"]
    assert "chase_drill" not in requirements["persona_ids"]
    assert "multi_profile_pressure" not in requirements["persona_ids"]

    registry = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
    registry_ids = {case["case_id"] for case in registry["cases"]}
    assert set(requirements["case_ids"]) <= registry_ids

    assessment = audit.assess_eval_contract_coverage(REPO, suite="release")
    assert assessment["status"] == "NOT_RUN"
    gaps = assessment["gaps"]
    assert gaps["case_ids"] or gaps["persona_ids"] or gaps["seeds"]
    assert set(gaps["persona_ids"]) == set(requirements["persona_ids"])
    assert set(gaps["seeds"]) == set(requirements["seeds"])
    # Historical profile runs alone cannot clear release-required cells.
    historical_only = audit.assess_eval_contract_coverage(
        REPO,
        suite="release",
        historical_profiles={
            "haunting_module": "v2-haunting-module",
            "chase_drill": "v3-chase-drill",
            "multi_profile_pressure": "v4-multi-profile-pressure",
        },
    )
    assert historical_only["status"] == "NOT_RUN"
    assert historical_only["gaps"]["persona_ids"]
    assert historical_only["gaps"]["seeds"]
    assert historical_only.get("historical_profiles_visible") is True
    assert historical_only.get("historical_profiles_satisfy_release") is False


def test_completion_audit_consumes_matrix_results_for_persona_seed_cells(tmp_path: Path):
    audit = _load_audit()
    requirements = audit.build_eval_contract_requirements(REPO, suite="nightly")
    persona = requirements["persona_ids"][0]
    seed = requirements["seeds"][0]
    case_id = requirements["matrix_case_ids"][0]
    matrix_results = {
        "schema_version": 1,
        "eval_spec": "eval-spec-v1",
        "suite": "nightly",
        "cells": [
            {
                "cell_id": f"{persona}__seed-{seed}__{case_id}",
                "persona_id": persona,
                "seed": seed,
                "case_id": case_id,
                "status": "NOT_RUN",
                "evidence_eligible": False,
            }
        ],
    }
    assessment = audit.assess_eval_contract_coverage(
        REPO,
        suite="nightly",
        matrix_results=matrix_results,
    )
    assert assessment["status"] == "NOT_RUN"
    assert persona in assessment["observed_persona_ids"]
    assert seed in assessment["observed_seeds"]
    # Observed but ineligible/NOT_RUN cells do not satisfy required coverage.
    assert persona in assessment["gaps"]["persona_ids"]
    assert seed in assessment["gaps"]["seeds"]


def test_suite_aggregation_exposes_eval_contract_coverage(tmp_path: Path):
    suite = _load_suite()
    summary = suite.summarize_eval_contract_coverage(REPO, suite_name="release")
    assert summary["schema_version"] == 1
    assert summary["suite"] == "release"
    assert summary["required_case_ids"]
    assert summary["required_persona_ids"]
    assert summary["required_seeds"]
    assert summary["status"] in {"NOT_RUN", "INELIGIBLE", "FAIL", "PASS"}
    assert summary["status"] != "PASS"
    assert summary["gaps"]["case_ids"] or summary["gaps"]["persona_ids"] or summary["gaps"]["seeds"]
    assert summary["evidence_eligibility"]["deterministic_fixture"] is True
    assert summary["evidence_eligibility"]["external_model_gameplay"] is False


def test_report_delivery_binds_hashes_to_completeness_receipt(tmp_path: Path):
    """Delivered reports bind battle/evaluation hashes to completeness receipts."""
    contract = _load_contract()
    audit = _load_audit()

    run_dir = tmp_path / "report-run"
    artifacts = run_dir / "artifacts"
    artifacts.mkdir(parents=True)
    battle = (
        "<!-- report-schema-version: 2 -->\n"
        "# Battle Report\n\n"
        "## Run Identity And Evidence "
        "<!-- report-anchor: run-identity-and-evidence -->\n\n"
        "- Eligibility: eligible\n\n"
        "## Rules And Dice <!-- report-anchor: rules-and-dice -->\n\n"
        "- Public roll count: 0\n"
    )
    evaluation = (
        "# Evaluation Report\n\n"
        "## Evaluation Contract <!-- report-anchor: evaluation-contract -->\n\n"
        "- Contract status: PASS\n"
        "- Report schema version: 2\n"
        "- Required public rolls: 0\n"
        "- Rendered public rolls: 0\n"
        "- Keeper-only rolls: 0\n"
    )
    battle_path = artifacts / "battle-report.md"
    evaluation_path = artifacts / "evaluation-report.md"
    battle_path.write_text(battle, encoding="utf-8")
    evaluation_path.write_text(evaluation, encoding="utf-8")

    completeness = {
        "schema_version": 1,
        "passed": True,
        "required_public_roll_count": 0,
        "rendered_public_roll_count": 0,
        "keeper_only_roll_count": 0,
        "missing_roll_ids": [],
        "duplicate_roll_ids": [],
        "report_schema_marker_present": True,
        "report_schema_marker_count": 1,
        "run_identity_anchor_count": 1,
    }
    receipt_path = artifacts / "report-completeness.json"
    _write_json(receipt_path, completeness)

    manifest = {
        "schema_version": 1,
        "eval_spec": "eval-spec-v1",
        "benchmark_version": "2026.07.1",
        "report_schema_version": 2,
        "run_id": "report-run",
        "suite": "diagnostic",
        "host_id": "local",
        "seed": 1,
        "initial_state_sha256": _sha256_text("initial"),
        "candidate_commit": "deadbeef",
        "artifact_hashes": {},
    }
    manifest_path = _write_json(run_dir / "run-manifest.json", manifest)
    baseline_out = tmp_path / "baseline.json"
    bound = contract.write_baseline_manifest(manifest_path, baseline_out)
    assert bound["status"] == "PASS"
    payload = json.loads(baseline_out.read_text(encoding="utf-8"))
    assert payload["report_completeness_sha256"] == contract.file_sha256(receipt_path)
    assert payload["battle_report_sha256"] == contract.file_sha256(battle_path)

    delivery = audit.bind_report_delivery_receipt(
        run_dir,
        battle_report_path=battle_path,
        evaluation_report_path=evaluation_path,
        completeness_path=receipt_path,
    )
    assert delivery["status"] == "PASS"
    assert delivery["battle_report_sha256"] == contract.file_sha256(battle_path)
    assert delivery["evaluation_report_sha256"] == contract.file_sha256(evaluation_path)
    assert delivery["report_completeness_sha256"] == contract.file_sha256(receipt_path)
    # Handwritten factual rewrite would break the bound receipt hash.
    battle_path.write_text(battle + "\n- Invented clue: forged by hand\n", encoding="utf-8")
    rewritten = audit.bind_report_delivery_receipt(
        run_dir,
        battle_report_path=battle_path,
        evaluation_report_path=evaluation_path,
        completeness_path=receipt_path,
        expected_battle_report_sha256=delivery["battle_report_sha256"],
    )
    assert rewritten["status"] == "FAIL"
    assert any(
        item.get("code") == "battle_report_hash_mismatch"
        for item in rewritten.get("findings", [])
    )
