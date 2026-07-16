from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest


REPO = Path(__file__).resolve().parents[1]
CLI_PATH = REPO / "plugins" / "coc-keeper" / "scripts" / "coc_eval.py"
PIPELINE_PATH = REPO / "plugins" / "coc-keeper" / "scripts" / "coc_eval_pipeline.py"
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


def _load_pipeline():
    return _load("coc_eval_pipeline_integration_test", PIPELINE_PATH)


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


def _fake_registered_cases(out: Path, *, status: str = "PASS"):
    case_dir = out / "cases" / "deterministic-foundation"
    case_dir.mkdir(parents=True, exist_ok=True)
    stdout = case_dir / "stdout.log"
    stderr = case_dir / "stderr.log"
    stdout.write_text("controlled case stdout\n", encoding="utf-8")
    stderr.write_text("controlled case stderr\n", encoding="utf-8")
    case = {
        "case_id": "deterministic-foundation",
        "gate": "hard",
        "status": status,
        "stdout_path": "cases/deterministic-foundation/stdout.log",
        "stderr_path": "cases/deterministic-foundation/stderr.log",
        "artifact_hashes": {
            "cases/deterministic-foundation/stdout.log": hashlib.sha256(
                stdout.read_bytes()
            ).hexdigest(),
            "cases/deterministic-foundation/stderr.log": hashlib.sha256(
                stderr.read_bytes()
            ).hexdigest(),
        },
    }
    payload = {
        "schema_version": 1,
        "eval_spec": "eval-spec-v1",
        "suite": "nightly",
        "status": status,
        "cases": [case],
    }
    return status, [case], _write_json(out / "case-results.json", payload)


def _pass_completion_audit(**kwargs):
    return {
        "schema_version": 1,
        "eval_spec": "eval-spec-v1",
        "suite": kwargs["suite"],
        "status": "PASS",
        "gaps": {},
    }


def _run_bound_fake_nightly(
    tmp_path: Path,
    monkeypatch,
    *,
    matrix_limit: int | None = None,
):
    cli = _load_cli()
    pipeline = sys.modules["coc_eval_pipeline"]
    monkeypatch.setattr(
        cli,
        "_run_registered_cases",
        lambda **kwargs: _fake_registered_cases(kwargs["out"]),
    )

    def fake_matrix(**kwargs):
        payload = {"status": "PASS", "cells": [{"status": "PASS"}]}
        if matrix_limit is not None:
            payload["diagnostic"] = {"matrix_limit": matrix_limit}
        return payload

    monkeypatch.setattr(pipeline, "run_matrix", fake_matrix)
    monkeypatch.setattr(
        pipeline,
        "run_continuity",
        lambda lane_id, **kwargs: {"status": "PASS", "lane_id": lane_id},
    )
    monkeypatch.setattr(pipeline, "run_completion_audit", _pass_completion_audit)
    out = tmp_path / "nightly"
    result = cli.run_suite(
        root=REPO,
        suite="nightly",
        output=out,
        host_id="local",
        baseline=tmp_path / "baseline",
        matrix_limit=matrix_limit,
    )
    return cli, out, result


def _rewrite_manifest(out: Path, mutate):
    path = out / "run-manifest.json"
    manifest = json.loads(path.read_text(encoding="utf-8"))
    mutate(manifest)
    _write_json(path, manifest)
    return manifest


def test_nightly_runs_registered_cases_matrix_continuity_and_judge(
    tmp_path: Path, monkeypatch
):
    cli = _load_cli()
    pipeline = sys.modules["coc_eval_pipeline"]
    calls: list[str] = []

    monkeypatch.setattr(
        cli,
        "_run_registered_cases",
        lambda **kwargs: _fake_registered_cases(kwargs["out"]),
    )
    monkeypatch.setattr(
        pipeline,
        "run_matrix",
        lambda **kwargs: calls.append("matrix")
        or {"status": "PASS", "cells": [{"status": "PASS"}]},
    )
    monkeypatch.setattr(
        pipeline,
        "run_continuity",
        lambda lane_id, **kwargs: calls.append(lane_id)
        or {"status": "PASS", "lane_id": lane_id},
    )
    monkeypatch.setattr(
        pipeline,
        "run_completion_audit",
        _pass_completion_audit,
    )
    out = tmp_path / "nightly"
    result = cli.run_suite(
        root=REPO,
        suite="nightly",
        output=out,
        host_id="local",
        baseline=tmp_path / "baseline",
    )

    assert result["status"] == "PASS"
    assert result["lanes"]["registered-cases"]["status"] == "PASS"
    assert result["lanes"]["matrix"]["status"] == "PASS"
    assert result["lanes"]["continuity-25"]["status"] == "PASS"
    assert result["lanes"]["continuity-50"]["status"] == "PASS"
    assert result["lanes"]["completion-audit"]["status"] == "PASS"
    assert calls == ["matrix", "continuity-25", "continuity-50"]
    for lane_id in result["lanes"]:
        receipt = result["lane_artifacts"][lane_id]
        receipt_path = out / receipt["path"]
        assert receipt_path.is_file()
        assert receipt["sha256"] == hashlib.sha256(receipt_path.read_bytes()).hexdigest()
    assert pipeline.verify_lane_artifacts(out, result["lane_artifacts"])["status"] == "PASS"


def test_completion_audit_is_a_persisted_hard_gate_for_real_nightly_evidence(
    tmp_path: Path, monkeypatch
):
    cli = _load_cli()
    pipeline = sys.modules["coc_eval_pipeline"]
    monkeypatch.setattr(
        cli,
        "_run_registered_cases",
        lambda **kwargs: _fake_registered_cases(kwargs["out"]),
    )
    monkeypatch.setattr(
        pipeline,
        "run_matrix",
        lambda **kwargs: {"status": "PASS", "cells": [{"status": "PASS"}]},
    )
    monkeypatch.setattr(
        pipeline,
        "run_continuity",
        lambda lane_id, **kwargs: {"status": "PASS", "lane_id": lane_id},
    )

    result = cli.run_suite(
        root=REPO,
        suite="nightly",
        output=tmp_path / "nightly-audited",
        host_id="local",
        baseline=tmp_path / "baseline",
    )

    assert result["status"] == "NOT_RUN"
    assert result["lanes"]["completion-audit"]["status"] == "NOT_RUN"
    receipt = result["lane_artifacts"]["completion-audit"]
    assert (tmp_path / "nightly-audited" / receipt["path"]).is_file()


def test_lane_receipts_reject_symlinked_lane_root_before_writing(
    tmp_path: Path, monkeypatch
):
    pipeline = _load_pipeline()
    out = tmp_path / "nightly"
    outside = tmp_path / "outside"
    outside.mkdir()
    (out / "lanes").mkdir(parents=True)
    (out / "lanes" / "matrix").symlink_to(outside, target_is_directory=True)
    monkeypatch.setattr(
        pipeline,
        "run_matrix",
        lambda **kwargs: {"status": "PASS", "cells": [{"status": "PASS"}]},
    )
    monkeypatch.setattr(
        pipeline,
        "run_continuity",
        lambda lane_id, **kwargs: (_ for _ in ()).throw(
            AssertionError("symlink rejection must happen before continuity")
        ),
    )

    with pytest.raises(ValueError, match="symlink"):
        pipeline.run_extended_suite(
            root=REPO,
            suite="nightly",
            output=out,
            case_results={
                "schema_version": 1,
                "eval_spec": "eval-spec-v1",
                "suite": "nightly",
                "status": "PASS",
                "cases": [],
            },
            baseline=tmp_path / "baseline",
        )

    assert not (outside / "lane-result.json").exists()


def test_continuity_lane_rejects_symlinked_output_before_dispatch(
    tmp_path: Path, monkeypatch
):
    pipeline = _load_pipeline()
    out = tmp_path / "nightly"
    outside = tmp_path / "outside-continuity"
    outside.mkdir()
    (out / "lanes").mkdir(parents=True)
    (out / "lanes" / "continuity-25").symlink_to(
        outside, target_is_directory=True
    )
    monkeypatch.setattr(
        pipeline,
        "run_matrix",
        lambda **kwargs: {"status": "PASS", "cells": [{"status": "PASS"}]},
    )

    def unsafe_continuity(lane_id, **kwargs):
        Path(kwargs["output"], "escaped.txt").write_text(
            "escaped", encoding="utf-8"
        )
        return {"status": "PASS", "lane_id": lane_id}

    monkeypatch.setattr(pipeline, "run_continuity", unsafe_continuity)

    with pytest.raises(ValueError, match="symlink"):
        pipeline.run_extended_suite(
            root=REPO,
            suite="nightly",
            output=out,
            case_results={
                "schema_version": 1,
                "eval_spec": "eval-spec-v1",
                "suite": "nightly",
                "status": "PASS",
                "cases": [],
            },
            baseline=tmp_path / "baseline",
        )

    assert not (outside / "escaped.txt").exists()


def test_pipeline_rejects_symlinked_baseline_ancestor(tmp_path: Path):
    pipeline = _load_pipeline()
    outside = tmp_path / "outside-lanes"
    _write_json(outside / "matrix" / "matrix-plan.json", {"cells": []})
    baseline_run = tmp_path / "baseline-run"
    baseline_run.mkdir()
    (baseline_run / "lanes").symlink_to(outside, target_is_directory=True)

    with pytest.raises(ValueError, match="baseline.*symlink"):
        pipeline._baseline_matrix_dir(baseline_run)


def test_pipeline_rejects_symlinked_baseline_before_any_model_lane_dispatch(
    tmp_path: Path, monkeypatch
):
    pipeline = _load_pipeline()
    outside = tmp_path / "outside-lanes"
    _write_json(outside / "matrix" / "matrix-plan.json", {"cells": []})
    baseline_run = tmp_path / "baseline-run"
    baseline_run.mkdir()
    (baseline_run / "lanes").symlink_to(outside, target_is_directory=True)
    out = tmp_path / "nightly"
    monkeypatch.setattr(
        pipeline,
        "run_matrix",
        lambda **kwargs: pytest.fail("unsafe baseline must fail before matrix"),
    )
    monkeypatch.setattr(
        pipeline,
        "run_continuity",
        lambda *args, **kwargs: pytest.fail(
            "unsafe baseline must fail before continuity"
        ),
    )

    with pytest.raises(ValueError, match="baseline.*symlink"):
        pipeline.run_extended_suite(
            root=REPO,
            suite="nightly",
            output=out,
            case_results={
                "schema_version": 1,
                "eval_spec": "eval-spec-v1",
                "suite": "nightly",
                "status": "PASS",
                "cases": [],
            },
            baseline=baseline_run,
        )

    assert not out.exists()


def test_continuity_workspace_rejects_symlink_before_dispatch(
    tmp_path: Path, monkeypatch
):
    pipeline = _load_pipeline()
    out = tmp_path / "nightly"
    outside = tmp_path / "outside-workspace"
    outside.mkdir()
    (out / "workspaces").mkdir(parents=True)
    (out / "workspaces" / "continuity-25").symlink_to(
        outside, target_is_directory=True
    )
    monkeypatch.setattr(
        pipeline,
        "run_matrix",
        lambda **kwargs: {"status": "PASS", "cells": [{"status": "PASS"}]},
    )

    def unsafe_continuity(lane_id, **kwargs):
        Path(kwargs["workspace"], "escaped.txt").write_text(
            "escaped", encoding="utf-8"
        )
        raise AssertionError("workspace rejection must happen before dispatch")

    monkeypatch.setattr(pipeline, "run_continuity", unsafe_continuity)

    with pytest.raises(ValueError, match="workspace.*symlink"):
        pipeline.run_extended_suite(
            root=REPO,
            suite="nightly",
            output=out,
            case_results={
                "schema_version": 1,
                "eval_spec": "eval-spec-v1",
                "suite": "nightly",
                "status": "PASS",
                "cases": [],
            },
            baseline=tmp_path / "baseline",
        )

    assert not (outside / "escaped.txt").exists()


def test_supplied_missing_baseline_reason_is_promoted_to_aggregate(
    tmp_path: Path, monkeypatch
):
    cli = _load_cli()
    pipeline = sys.modules["coc_eval_pipeline"]
    monkeypatch.setattr(
        cli,
        "_run_registered_cases",
        lambda **kwargs: _fake_registered_cases(kwargs["out"]),
    )
    monkeypatch.setattr(
        pipeline,
        "run_matrix",
        lambda **kwargs: {
            "status": "NOT_RUN",
            "cells": [
                {
                    "status": "NOT_RUN",
                    "not_run_reasons": ["missing_baseline_evidence"],
                }
            ],
        },
    )
    monkeypatch.setattr(
        pipeline,
        "run_continuity",
        lambda lane_id, **kwargs: {"status": "PASS", "lane_id": lane_id},
    )

    result = cli.run_suite(
        root=REPO,
        suite="nightly",
        output=tmp_path / "missing-baseline",
        host_id="local",
        baseline=tmp_path / "does-not-exist",
    )

    assert result["status"] == "NOT_RUN"
    assert "baseline_evidence_missing" in result["not_run_reasons"]
    assert "matrix:missing_baseline_evidence" in result["not_run_reasons"]


def test_canonical_verify_recomputes_lane_receipts(
    tmp_path: Path, capsys
):
    cli = _load_cli()
    pipeline = sys.modules["coc_eval_pipeline"]
    out = tmp_path / "nightly"
    receipt = pipeline._persist_lane(
        out,
        "matrix",
        {"schema_version": 1, "eval_spec": "eval-spec-v1", "status": "PASS"},
    )
    _write_json(
        out / "run-manifest.json",
        {
            "schema_version": 1,
            "eval_spec": "eval-spec-v1",
            "suite": "nightly",
            "status": "PASS",
            "lanes": {"matrix": {"status": "PASS"}},
            "lane_artifacts": {"matrix": receipt},
        },
    )
    lane_result = out / receipt["path"]
    lane_result.write_text(
        lane_result.read_text(encoding="utf-8") + "\n",
        encoding="utf-8",
    )

    code = cli.main(["verify", str(out)])
    payload = json.loads(capsys.readouterr().out)

    assert code == 1
    assert payload["status"] == "FAIL"
    assert payload["lane_artifact_verification"]["status"] == "FAIL"
    assert any(
        finding["code"] == "lane_artifact_hash_mismatch"
        for finding in payload["lane_artifact_verification"]["findings"]
    )


def test_nightly_report_and_verify_route_to_declared_child_playtest(
    tmp_path: Path, monkeypatch
):
    cli = _load_cli()
    out = tmp_path / "nightly"
    cell_dir = out / "lanes" / "matrix" / "cells" / "cell-1"
    playtest = cell_dir / "playtest"
    artifacts = playtest / "artifacts"
    artifacts.mkdir(parents=True)
    report_path = artifacts / "battle-report.md"
    evaluation_path = artifacts / "evaluation-report.md"
    completeness_path = artifacts / "report-completeness.json"
    for path in (report_path, evaluation_path, completeness_path):
        path.write_text("fixture\n", encoding="utf-8")
    _write_json(
        cell_dir / "run-manifest.json",
        {
            "schema_version": 1,
            "eval_spec": "eval-spec-v1",
            "cell_id": "cell-1",
            "status": "PASS",
            "canonical_run_dir": "playtest",
        },
    )
    _write_json(
        out / "run-manifest.json",
        {
            "schema_version": 1,
            "eval_spec": "eval-spec-v1",
            "suite": "nightly",
            "status": "NOT_RUN",
            "lanes": {
                "matrix": {
                    "status": "NOT_RUN",
                    "cells": [
                        {
                            "cell_id": "cell-1",
                            "status": "NOT_RUN",
                            "runner_result": {"status": "PASS"},
                        }
                    ],
                }
            },
        },
    )
    calls: list[tuple[str, Path]] = []

    def report_result(mode: str, run_dir: Path) -> dict:
        calls.append((mode, Path(run_dir)))
        return {
            "schema_version": 1,
            "eval_spec": "eval-spec-v1",
            "status": "PASS",
            "report_path": str(report_path),
            "evaluation_report_path": str(evaluation_path),
            "report_completeness_path": str(completeness_path),
            "report_completeness": {"passed": True},
        }

    monkeypatch.setattr(
        cli.contract,
        "compile_report_contract",
        lambda run_dir, **_kwargs: report_result("compile", run_dir),
    )
    monkeypatch.setattr(
        cli.contract,
        "verify_report_contract",
        lambda run_dir: report_result("verify", run_dir),
    )

    compiled = cli.report_run_contract(out)
    verified = cli.verify_run_contract(out)

    assert compiled["status"] == "PASS"
    assert compiled["suite_report_verification"]["report_count"] == 1
    assert verified["suite_report_verification"]["status"] == "PASS"
    assert calls == [("verify", playtest), ("verify", playtest)]
    assert all(path != out for _mode, path in calls)


def test_canonical_verify_binds_registered_case_artifacts_outside_lane_root(
    tmp_path: Path, monkeypatch
):
    cli = _load_cli()
    pipeline = sys.modules["coc_eval_pipeline"]
    monkeypatch.setattr(
        cli,
        "_run_registered_cases",
        lambda **kwargs: _fake_registered_cases(kwargs["out"]),
    )
    monkeypatch.setattr(
        pipeline,
        "run_matrix",
        lambda **kwargs: {"status": "PASS", "cells": [{"status": "PASS"}]},
    )
    monkeypatch.setattr(
        pipeline,
        "run_continuity",
        lambda lane_id, **kwargs: {"status": "PASS", "lane_id": lane_id},
    )
    monkeypatch.setattr(pipeline, "run_completion_audit", _pass_completion_audit)
    out = tmp_path / "nightly"

    result = cli.run_suite(
        root=REPO,
        suite="nightly",
        output=out,
        host_id="local",
        baseline=tmp_path / "baseline",
    )

    receipt = result["lane_artifacts"]["registered-cases"]
    expected_owned = {
        "case-results.json",
        "cases/deterministic-foundation/stdout.log",
        "cases/deterministic-foundation/stderr.log",
    }
    assert set(receipt["owned_artifacts"]) == expected_owned
    assert expected_owned <= set(receipt["artifacts"])
    before = cli.verify_run_contract(out)
    assert before["lane_artifact_verification"]["status"] == "PASS"

    extra_log = out / "cases/unbound-case/stdout.log"
    extra_log.parent.mkdir(parents=True)
    extra_log.write_text("unbound evidence\n", encoding="utf-8")
    with_extra_log = cli.verify_run_contract(out)
    assert with_extra_log["status"] == "FAIL"
    assert {
        "code": "lane_artifact_unbound",
        "lane_id": "registered-cases",
        "path": "cases/unbound-case/stdout.log",
    } in with_extra_log["lane_artifact_verification"]["findings"]
    extra_log.unlink()

    stdout = out / "cases/deterministic-foundation/stdout.log"
    stdout.write_text("tampered case stdout\n", encoding="utf-8")
    after = cli.verify_run_contract(out)

    assert after["status"] == "FAIL"
    assert after["lane_artifact_verification"]["status"] == "FAIL"
    assert any(
        finding["code"] == "lane_artifact_hash_mismatch"
        and finding.get("lane_id") == "registered-cases"
        and finding.get("path")
        == "cases/deterministic-foundation/stdout.log"
        for finding in after["lane_artifact_verification"]["findings"]
    )


@pytest.mark.parametrize("malformation", ("pass_without_logs", "foreign_case_path"))
def test_registered_case_artifact_contract_rejects_semantic_bypasses(
    tmp_path: Path, malformation: str
):
    pipeline = _load_pipeline()
    case_results = tmp_path / "case-results.json"
    case_results.write_text("{}\n", encoding="utf-8")
    case_results_hash = hashlib.sha256(case_results.read_bytes()).hexdigest()
    case = {
        "case_id": "expected-case",
        "status": "PASS",
        "stdout_path": None,
        "stderr_path": None,
        "artifact_hashes": {},
    }
    outer_hashes = {"case-results.json": case_results_hash}
    if malformation == "foreign_case_path":
        foreign = "cases/expected-case/nested/stdout.log"
        case.update({"stdout_path": foreign, "stderr_path": foreign})
        case["artifact_hashes"] = {foreign: "a" * 64}
        outer_hashes[foreign] = "a" * 64
    manifest = {
        "case_results_path": "case-results.json",
        "artifact_hashes": outer_hashes,
    }
    lanes = {"registered-cases": {"cases": [case]}}

    with pytest.raises(ValueError, match="registered case"):
        pipeline.declared_registered_case_artifacts(manifest, lanes)


def test_registered_case_artifact_contract_allows_explicit_unexecuted_not_run(
    tmp_path: Path,
):
    pipeline = _load_pipeline()
    case_results = tmp_path / "case-results.json"
    case_results.write_text("{}\n", encoding="utf-8")
    digest = hashlib.sha256(case_results.read_bytes()).hexdigest()
    manifest = {
        "case_results_path": "case-results.json",
        "artifact_hashes": {"case-results.json": digest},
    }
    lanes = {
        "registered-cases": {
            "cases": [
                {
                    "case_id": "not-run-case",
                    "gate": "hard",
                    "status": "NOT_RUN",
                    "stdout_path": None,
                    "stderr_path": None,
                    "artifact_hashes": {},
                    "not_run_reasons": ["missing_capability:model-backed-eval"],
                }
            ]
        }
    }

    assert pipeline.declared_registered_case_artifacts(manifest, lanes) == {
        "case-results.json": digest
    }


def test_lane_verifier_binds_case_results_payload_to_registered_lane(tmp_path: Path):
    pipeline = _load_pipeline()
    out = tmp_path / "nightly"
    lane_payload = {
        "schema_version": 1,
        "eval_spec": "eval-spec-v1",
        "status": "PASS",
        "cases": [],
    }
    case_results = out / "case-results.json"
    _write_json(case_results, {**lane_payload, "status": "FAIL"})
    digest = hashlib.sha256(case_results.read_bytes()).hexdigest()
    receipt = pipeline._persist_lane(
        out,
        "registered-cases",
        lane_payload,
        owned_artifacts={"case-results.json": digest},
    )

    verification = pipeline.verify_lane_artifacts(
        out,
        {"registered-cases": receipt},
        expected_lanes={"registered-cases": lane_payload},
        required_owned_artifacts={
            "registered-cases": {"case-results.json": digest}
        },
    )

    assert verification["status"] == "FAIL"
    assert any(
        finding["code"] == "lane_owned_payload_mismatch"
        and finding.get("path") == "case-results.json"
        for finding in verification["findings"]
    )


def test_canonical_verify_binds_manifest_lane_payload_to_primary_result(
    tmp_path: Path,
):
    cli = _load_cli()
    pipeline = sys.modules["coc_eval_pipeline"]
    out = tmp_path / "nightly"
    lane_payload = {
        "schema_version": 1,
        "eval_spec": "eval-spec-v1",
        "status": "PASS",
    }
    receipt = pipeline._persist_lane(out, "matrix", lane_payload)
    _write_json(
        out / "run-manifest.json",
        {
            "schema_version": 1,
            "eval_spec": "eval-spec-v1",
            "suite": "nightly",
            "status": "PASS",
            "lanes": {"matrix": {**lane_payload, "status": "FAIL"}},
            "lane_artifacts": {"matrix": receipt},
        },
    )

    payload = cli.verify_run_contract(out)

    assert payload["status"] == "FAIL"
    assert payload["lane_artifact_verification"]["status"] == "FAIL"
    assert {
        "code": "lane_primary_payload_mismatch",
        "lane_id": "matrix",
    } in payload["lane_artifact_verification"]["findings"]


def test_canonical_verify_requires_registered_cases_lane_for_nightly(tmp_path: Path):
    cli = _load_cli()
    pipeline = sys.modules["coc_eval_pipeline"]
    out = tmp_path / "nightly"
    matrix_lane = {
        "schema_version": 1,
        "eval_spec": "eval-spec-v1",
        "status": "PASS",
    }
    matrix_receipt = pipeline._persist_lane(out, "matrix", matrix_lane)
    _write_json(
        out / "run-manifest.json",
        {
            "schema_version": 1,
            "eval_spec": "eval-spec-v1",
            "suite": "nightly",
            "status": "PASS",
            "lanes": {"matrix": matrix_lane},
            "lane_artifacts": {"matrix": matrix_receipt},
        },
    )

    payload = cli.verify_run_contract(out)

    assert payload["status"] == "FAIL"
    assert payload["lane_artifact_verification"]["status"] == "FAIL"
    assert {
        "code": "registered_cases_lane_missing",
    } in payload["lane_artifact_verification"]["findings"]
    assert {
        "code": "registered_cases_receipt_missing",
    } in payload["lane_artifact_verification"]["findings"]


@pytest.mark.parametrize("mutation", ("drop_lane_pair", "add_forged_lane_pair"))
def test_canonical_verify_requires_exact_nightly_lane_topology(
    tmp_path: Path, mutation: str
):
    cli = _load_cli()
    pipeline = sys.modules["coc_eval_pipeline"]
    out = tmp_path / mutation
    lane_ids = {
        "registered-cases",
        "matrix",
        "continuity-25",
        "continuity-50",
        "completion-audit",
    }
    lanes = {
        lane_id: {
            "schema_version": 1,
            "eval_spec": "eval-spec-v1",
            "status": "PASS",
        }
        for lane_id in lane_ids
    }
    receipts = {
        lane_id: pipeline._persist_lane(out, lane_id, payload)
        for lane_id, payload in lanes.items()
    }
    if mutation == "drop_lane_pair":
        lanes.pop("continuity-50")
        receipts.pop("continuity-50")
    else:
        forged = {
            "schema_version": 1,
            "eval_spec": "eval-spec-v1",
            "status": "PASS",
        }
        lanes["forged-lane"] = forged
        receipts["forged-lane"] = pipeline._persist_lane(
            out, "forged-lane", forged
        )
    _write_json(
        out / "run-manifest.json",
        {
            "schema_version": 1,
            "eval_spec": "eval-spec-v1",
            "suite": "nightly",
            "status": "PASS",
            "lanes": lanes,
            "lane_artifacts": receipts,
        },
    )

    payload = cli.verify_run_contract(out)

    assert payload["status"] == "FAIL"
    assert any(
        finding["code"] == "nightly_lane_topology_mismatch"
        for finding in payload["lane_artifact_verification"]["findings"]
    )


def test_nightly_records_canonical_aggregation_inputs(tmp_path: Path, monkeypatch):
    _, _, result = _run_bound_fake_nightly(
        tmp_path, monkeypatch, matrix_limit=1
    )

    assert result.get("aggregation_inputs") == {
        "baseline_supplied": True,
        "matrix_limit": 1,
    }


@pytest.mark.parametrize(
    ("field", "replacement"),
    (
        ("status", "FAIL"),
        ("not_run_reasons", ["forged_reason"]),
        ("diagnostic", {"matrix_limit": 99}),
    ),
)
def test_canonical_verify_recomputes_manifest_aggregate_projection(
    tmp_path: Path, monkeypatch, field: str, replacement
):
    cli, out, _ = _run_bound_fake_nightly(tmp_path, monkeypatch)
    _rewrite_manifest(out, lambda manifest: manifest.__setitem__(field, replacement))

    payload = cli.verify_run_contract(out)

    assert payload["lane_artifact_verification"]["status"] == "FAIL"
    assert {
        "code": "aggregate_manifest_mismatch",
        "field": field,
    } in payload["lane_artifact_verification"]["findings"]


@pytest.mark.parametrize("mutation", ("missing", "coherent_rehash", "missing_hash"))
def test_canonical_verify_binds_aggregate_summary_artifact(
    tmp_path: Path, monkeypatch, mutation: str
):
    cli, out, _ = _run_bound_fake_nightly(tmp_path, monkeypatch)
    summary = out / "aggregate-summary.json"
    if mutation == "missing":
        summary.unlink()
    elif mutation == "coherent_rehash":
        _write_json(summary, {"status": "FAIL", "forged": True})
        digest = hashlib.sha256(summary.read_bytes()).hexdigest()
        _rewrite_manifest(
            out,
            lambda manifest: manifest["artifact_hashes"].__setitem__(
                "aggregate-summary.json", digest
            ),
        )
    else:
        _rewrite_manifest(
            out,
            lambda manifest: manifest["artifact_hashes"].pop(
                "aggregate-summary.json"
            ),
        )

    payload = cli.verify_run_contract(out)

    assert payload["lane_artifact_verification"]["status"] == "FAIL"
    assert any(
        finding["code"].startswith("aggregate_summary_")
        for finding in payload["lane_artifact_verification"]["findings"]
    )


@pytest.mark.parametrize(
    ("field", "replacement", "finding_code"),
    (
        ("case_results", [], "registered_case_results_mismatch"),
        ("case_ids", ["forged-case"], "registered_case_ids_mismatch"),
    ),
)
def test_canonical_verify_binds_manifest_registered_case_projection(
    tmp_path: Path,
    monkeypatch,
    field: str,
    replacement,
    finding_code: str,
):
    cli, out, _ = _run_bound_fake_nightly(tmp_path, monkeypatch)
    _rewrite_manifest(out, lambda manifest: manifest.__setitem__(field, replacement))

    payload = cli.verify_run_contract(out)

    assert payload["lane_artifact_verification"]["status"] == "FAIL"
    assert {"code": finding_code} in payload["lane_artifact_verification"][
        "findings"
    ]


def test_canonical_verify_recomputes_registered_lane_status(
    tmp_path: Path, monkeypatch
):
    cli, out, _ = _run_bound_fake_nightly(tmp_path, monkeypatch)
    manifest_path = out / "run-manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    registered = manifest["lanes"]["registered-cases"]
    registered["cases"][0]["status"] = "FAIL"
    manifest["case_results"] = registered["cases"]
    primary = out / "lanes/registered-cases/lane-result.json"
    case_results = out / "case-results.json"
    _write_json(primary, registered)
    _write_json(case_results, registered)
    primary_digest = hashlib.sha256(primary.read_bytes()).hexdigest()
    case_digest = hashlib.sha256(case_results.read_bytes()).hexdigest()
    receipt = manifest["lane_artifacts"]["registered-cases"]
    receipt["sha256"] = primary_digest
    receipt["artifacts"]["lanes/registered-cases/lane-result.json"] = (
        primary_digest
    )
    receipt["artifacts"]["case-results.json"] = case_digest
    manifest["artifact_hashes"]["lanes/registered-cases/lane-result.json"] = (
        primary_digest
    )
    manifest["artifact_hashes"]["case-results.json"] = case_digest
    _write_json(manifest_path, manifest)

    payload = cli.verify_run_contract(out)

    assert payload["lane_artifact_verification"]["status"] == "FAIL"
    assert {"code": "registered_case_status_mismatch"} in payload[
        "lane_artifact_verification"
    ]["findings"]


def test_gameplay_run_with_stray_aggregate_keys_stays_gameplay(tmp_path: Path):
    cli = _load_cli()
    run = tmp_path / ".coc" / "playtests" / "gameplay-run"
    _write_json(run / "playtest.json", {
        "schema_version": 1,
        "run_id": "gameplay-run",
        "campaign_id": "gameplay-campaign",
    })
    _write_json(run / "run-manifest.json", {
        "schema_version": 1,
        "eval_spec": "eval-spec-v1",
        "suite": "diagnostic",
        "case_id": "gameplay-case",
        "lanes": {},
    })

    payload = cli.verify_run_contract(run)

    assert payload.get("report_scope") != "suite"
    assert "lane_artifact_verification" not in payload


@pytest.mark.parametrize("canonical", [True, False])
def test_malformed_gameplay_metadata_cannot_masquerade_as_aggregate(
    tmp_path: Path, canonical: bool,
):
    cli = _load_cli()
    run = (
        tmp_path / ".coc" / "playtests" / "malformed-gameplay"
        if canonical
        else tmp_path / "historical-malformed-gameplay"
    )
    target = tmp_path / "outside-playtest.json"
    _write_json(target, {"run_id": "malformed-gameplay"})
    run.mkdir(parents=True)
    (run / "playtest.json").symlink_to(target)
    _write_json(run / "run-manifest.json", {
        "schema_version": 1,
        "eval_spec": "eval-spec-v1",
        "suite": "diagnostic",
        "case_id": "suite:diagnostic",
        "lanes": {},
        "lane_artifacts": {},
    })

    with pytest.raises(ValueError, match="published final playtest run"):
        cli.verify_run_contract(run)


@pytest.mark.parametrize(
    "mutation",
    ("missing_inputs", "matrix_limit_mismatch", "suite_downgrade"),
)
def test_canonical_verify_rejects_aggregate_input_contradictions(
    tmp_path: Path, monkeypatch, mutation: str
):
    cli, out, _ = _run_bound_fake_nightly(
        tmp_path, monkeypatch, matrix_limit=1
    )

    def mutate(manifest):
        if mutation == "missing_inputs":
            manifest.pop("aggregation_inputs", None)
        elif mutation == "matrix_limit_mismatch":
            manifest["aggregation_inputs"] = {
                "baseline_supplied": True,
                "matrix_limit": 2,
            }
        else:
            manifest["suite"] = "diagnostic"

    _rewrite_manifest(out, mutate)
    payload = cli.verify_run_contract(out)

    assert payload["lane_artifact_verification"]["status"] == "FAIL"
    assert any(
        finding["code"]
        in {"aggregate_inputs_malformed", "aggregate_contract_suite_mismatch"}
        for finding in payload["lane_artifact_verification"]["findings"]
    )


@pytest.mark.parametrize(
    "mutation",
    ("remove_lanes", "remove_lane_maps", "filesystem_marker_only"),
)
def test_canonical_verify_rejects_downgraded_aggregate_without_lane_contract(
    tmp_path: Path, monkeypatch, mutation: str
):
    cli, out, _ = _run_bound_fake_nightly(tmp_path, monkeypatch)

    def mutate(manifest):
        manifest["suite"] = "diagnostic"
        manifest.pop("lanes", None)
        if mutation in {"remove_lane_maps", "filesystem_marker_only"}:
            manifest.pop("lane_artifacts", None)
        if mutation == "filesystem_marker_only":
            manifest["case_id"] = "suite:diagnostic"
            manifest.pop("aggregation_inputs", None)
            manifest.get("artifact_hashes", {}).pop(
                "aggregate-summary.json", None
            )

    _rewrite_manifest(out, mutate)
    payload = cli.verify_run_contract(out)

    assert payload["lane_artifact_verification"]["status"] == "FAIL"
    assert {"code": "lane_contract_missing"} in payload[
        "lane_artifact_verification"
    ]["findings"]


def test_canonical_verify_fails_when_nightly_receipts_are_removed(
    tmp_path: Path, capsys
):
    cli = _load_cli()
    out = tmp_path / "nightly"
    _write_json(
        out / "run-manifest.json",
        {
            "schema_version": 1,
            "eval_spec": "eval-spec-v1",
            "suite": "nightly",
            "status": "PASS",
            "lanes": {"matrix": {"status": "PASS"}},
        },
    )

    code = cli.main(["verify", str(out)])
    payload = json.loads(capsys.readouterr().out)

    assert code == 1
    assert payload["status"] == "FAIL"
    assert payload["lane_artifact_verification"]["status"] == "FAIL"
    assert payload["lane_artifact_verification"]["findings"] == [
        {"code": "lane_receipts_missing"}
    ]


def test_canonical_verify_requires_exact_lane_receipt_key_set(
    tmp_path: Path, capsys
):
    cli = _load_cli()
    pipeline = sys.modules["coc_eval_pipeline"]
    out = tmp_path / "nightly"
    matrix_receipt = pipeline._persist_lane(
        out,
        "matrix",
        {"schema_version": 1, "eval_spec": "eval-spec-v1", "status": "PASS"},
    )
    _write_json(
        out / "run-manifest.json",
        {
            "schema_version": 1,
            "eval_spec": "eval-spec-v1",
            "suite": "nightly",
            "status": "PASS",
            "lanes": {
                "matrix": {"status": "PASS"},
                "continuity-25": {"status": "PASS"},
            },
            "lane_artifacts": {"matrix": matrix_receipt},
        },
    )

    code = cli.main(["verify", str(out)])
    payload = json.loads(capsys.readouterr().out)

    assert code == 1
    assert payload["lane_artifact_verification"]["status"] == "FAIL"
    assert {
        "code": "lane_receipt_missing",
        "lane_id": "continuity-25",
    } in payload["lane_artifact_verification"]["findings"]


@pytest.mark.parametrize("lanes", [None, {}])
def test_canonical_verify_requires_nonempty_nightly_lane_contract(
    tmp_path: Path, lanes
):
    cli = _load_cli()
    out = tmp_path / "nightly"
    manifest = {
        "schema_version": 1,
        "eval_spec": "eval-spec-v1",
        "suite": "nightly",
        "status": "PASS",
    }
    if lanes is not None:
        manifest["lanes"] = lanes
    _write_json(out / "run-manifest.json", manifest)

    payload = cli.verify_run_contract(out)

    assert payload["status"] == "FAIL"
    assert payload["lane_artifact_verification"]["status"] == "FAIL"
    assert payload["lane_artifact_verification"]["findings"] == [
        {"code": "lane_contract_missing"}
    ]


def test_matrix_route_applies_timeout_to_runner_and_judge(
    tmp_path: Path, monkeypatch
):
    pipeline = _load_pipeline()
    observed: dict[str, object] = {}
    monkeypatch.setattr(
        pipeline.matrix,
        "build_matrix_plan",
        lambda **kwargs: {"cells": []},
    )

    def execute(plan, **kwargs):
        observed.update(kwargs)
        return {"cells": [{"status": "NOT_RUN"}]}

    monkeypatch.setattr(pipeline.matrix, "execute_matrix_plan", execute)
    result = pipeline.run_matrix(
        root=REPO,
        suite="nightly",
        output=tmp_path / "matrix",
        baseline=None,
        matrix_limit=None,
        timeout=3.5,
    )

    assert result["status"] == "NOT_RUN"
    assert observed["runner_timeout_s"] == 3.5
    assert observed["judge_timeout_s"] == 3.5


def test_nightly_uses_versioned_continuity_budgets_and_records_them(
    tmp_path: Path, monkeypatch
):
    cli = _load_cli()
    pipeline = sys.modules["coc_eval_pipeline"]
    observed: dict[str, float] = {}
    monkeypatch.setattr(
        cli,
        "_run_registered_cases",
        lambda **kwargs: _fake_registered_cases(kwargs["out"]),
    )
    monkeypatch.setattr(
        pipeline,
        "run_matrix",
        lambda **kwargs: {"status": "PASS", "cells": [{"status": "PASS"}]},
    )

    def fake_continuity(lane_id, **kwargs):
        observed[lane_id] = kwargs["timeout"]
        return {"status": "PASS", "lane_id": lane_id}

    monkeypatch.setattr(pipeline, "run_continuity", fake_continuity)
    monkeypatch.setattr(pipeline, "run_completion_audit", _pass_completion_audit)

    result = cli.run_suite(
        root=REPO,
        suite="nightly",
        output=tmp_path / "nightly",
        host_id="local",
        baseline=tmp_path / "baseline",
        timeout=3.5,
    )

    assert observed == {"continuity-25": 900.0, "continuity-50": 1800.0}
    assert result["execution_budgets"] == {
        "matrix_seconds": 3.5,
        "matrix_judge_seconds": 3.5,
        "matrix_max_workers": 2,
        "continuity-25_seconds": 900.0,
        "continuity-50_seconds": 1800.0,
    }
    assert result["lanes"]["continuity-25"]["execution_budget_seconds"] == 900.0


def test_nightly_continuity_budget_override_is_independent_from_matrix_timeout(
    tmp_path: Path, monkeypatch
):
    cli = _load_cli()
    pipeline = sys.modules["coc_eval_pipeline"]
    observed: dict[str, float] = {}
    monkeypatch.setattr(
        cli,
        "_run_registered_cases",
        lambda **kwargs: _fake_registered_cases(kwargs["out"]),
    )
    monkeypatch.setattr(
        pipeline,
        "run_matrix",
        lambda **kwargs: {"status": "PASS", "cells": [{"status": "PASS"}]},
    )
    monkeypatch.setattr(
        pipeline,
        "run_continuity",
        lambda lane_id, **kwargs: (
            observed.__setitem__(lane_id, kwargs["timeout"])
            or {"status": "PASS", "lane_id": lane_id}
        ),
    )
    monkeypatch.setattr(pipeline, "run_completion_audit", _pass_completion_audit)

    result = cli.run_suite(
        root=REPO,
        suite="nightly",
        output=tmp_path / "nightly",
        host_id="local",
        baseline=tmp_path / "baseline",
        timeout=7,
        continuity_timeout=42,
    )

    assert observed == {"continuity-25": 42.0, "continuity-50": 42.0}
    assert result["execution_budgets"]["matrix_seconds"] == 7.0


@pytest.mark.skipif(not hasattr(os, "fork"), reason="requires POSIX process groups")
def test_continuity_timeout_kills_descendants_and_returns_not_run(
    tmp_path: Path, monkeypatch
):
    pipeline = _load_pipeline()
    sentinel = tmp_path / "continuity-orphan.txt"

    def hanging_lane(**kwargs):
        subprocess.Popen(
            [
                sys.executable,
                "-c",
                (
                    "import pathlib,signal,time; "
                    "signal.signal(signal.SIGTERM, signal.SIG_IGN); "
                    "time.sleep(0.8); "
                    f"pathlib.Path({str(sentinel)!r}).write_text('orphan')"
                ),
            ]
        )
        time.sleep(1)
        return {"status": "PASS"}

    monkeypatch.setattr(pipeline.longrun, "run_continuity_lane", hanging_lane)
    started = time.monotonic()
    result = pipeline.run_continuity(
        "continuity-25",
        root=REPO,
        output=tmp_path / "lane",
        workspace=tmp_path / "workspace",
        timeout=0.1,
    )
    elapsed = time.monotonic() - started

    assert elapsed < 2
    assert result["status"] == "NOT_RUN"
    assert result["not_run_reasons"] == ["execution_timeout"]
    assert result["timeout_phase"] == "continuity_lane"
    time.sleep(1.0)
    assert not sentinel.exists()


@pytest.mark.skipif(not hasattr(os, "fork"), reason="requires POSIX process groups")
def test_continuity_contract_failure_preserves_safe_child_diagnostics(
    tmp_path: Path, monkeypatch
):
    pipeline = _load_pipeline()

    def broken_lane(**kwargs):
        error = ValueError("exact turn range mismatch")
        error.code = "turn_range_mismatch"
        raise error

    monkeypatch.setattr(pipeline.longrun, "run_continuity_lane", broken_lane)

    result = pipeline.run_continuity(
        "continuity-25",
        root=REPO,
        output=tmp_path / "lane",
        workspace=tmp_path / "workspace",
        timeout=1,
    )

    assert result["status"] == "FAIL"
    assert result["findings"] == ["lane_contract_error"]
    assert result["failure"] == {
        "error_type": "ValueError",
        "error_code": "turn_range_mismatch",
        "message": "exact turn range mismatch",
    }


@pytest.mark.skipif(not hasattr(os, "fork"), reason="requires POSIX process groups")
def test_continuity_runtime_failure_preserves_safe_child_diagnostics(
    tmp_path: Path, monkeypatch
):
    pipeline = _load_pipeline()

    def unavailable_lane(**kwargs):
        raise RuntimeError("adapter worker timed out")

    monkeypatch.setattr(pipeline.longrun, "run_continuity_lane", unavailable_lane)

    result = pipeline.run_continuity(
        "continuity-25",
        root=REPO,
        output=tmp_path / "lane",
        workspace=tmp_path / "workspace",
        timeout=1,
    )

    assert result["status"] == "NOT_RUN"
    assert result["not_run_reasons"] == ["lane_unavailable:RuntimeError"]
    assert result["failure"] == {
        "error_type": "RuntimeError",
        "error_code": "continuity_lane_unavailable",
        "message": "adapter worker timed out",
    }


def test_run_continuity_rejects_symlinked_workspace_before_fork(
    tmp_path: Path, monkeypatch
):
    pipeline = _load_pipeline()
    outside = tmp_path / "outside-workspace"
    outside.mkdir()
    workspace = tmp_path / "workspace"
    workspace.symlink_to(outside, target_is_directory=True)
    monkeypatch.setattr(
        pipeline.longrun,
        "run_continuity_lane",
        lambda **kwargs: pytest.fail("workspace must be rejected before fork"),
    )

    with pytest.raises(ValueError, match="continuity workspace.*symlink"):
        pipeline.run_continuity(
            "continuity-25",
            root=REPO,
            output=tmp_path / "lane",
            workspace=workspace,
            timeout=1,
        )

    assert not any(outside.iterdir())


def test_nightly_without_baseline_captures_lanes_but_cannot_pass(
    tmp_path: Path, monkeypatch
):
    cli = _load_cli()
    pipeline = sys.modules["coc_eval_pipeline"]
    monkeypatch.setattr(
        cli,
        "_run_registered_cases",
        lambda **kwargs: _fake_registered_cases(kwargs["out"]),
    )
    monkeypatch.setattr(
        pipeline,
        "run_matrix",
        lambda **kwargs: {"status": "PASS", "cells": [{"status": "PASS"}]},
    )
    monkeypatch.setattr(
        pipeline,
        "run_continuity",
        lambda lane_id, **kwargs: {"status": "PASS", "lane_id": lane_id},
    )

    result = cli.run_suite(
        root=REPO,
        suite="nightly",
        output=tmp_path / "capture",
        host_id="local",
    )

    assert result["status"] == "NOT_RUN"
    assert "baseline_evidence_missing" in result["not_run_reasons"]
    assert result["lanes"]["matrix"]["status"] == "PASS"
    assert result["lanes"]["continuity-50"]["status"] == "PASS"


def test_nightly_deterministic_failure_stops_model_backed_work(
    tmp_path: Path, monkeypatch
):
    cli = _load_cli()
    pipeline = sys.modules["coc_eval_pipeline"]
    monkeypatch.setattr(
        cli,
        "_run_registered_cases",
        lambda **kwargs: _fake_registered_cases(kwargs["out"], status="FAIL"),
    )
    monkeypatch.setattr(
        pipeline,
        "run_matrix",
        lambda **kwargs: (_ for _ in ()).throw(AssertionError("matrix must not run")),
    )
    monkeypatch.setattr(
        pipeline,
        "run_continuity",
        lambda lane_id, **kwargs: (_ for _ in ()).throw(
            AssertionError("continuity must not run")
        ),
    )

    result = cli.run_suite(
        root=REPO,
        suite="nightly",
        output=tmp_path / "failed",
        host_id="local",
        baseline=tmp_path / "baseline",
    )

    assert result["status"] == "FAIL"
    assert set(result["lanes"]) == {"registered-cases"}


def test_matrix_limit_is_diagnostic_and_prevents_official_pass(
    tmp_path: Path, monkeypatch
):
    cli = _load_cli()
    pipeline = sys.modules["coc_eval_pipeline"]
    monkeypatch.setattr(
        cli,
        "_run_registered_cases",
        lambda **kwargs: _fake_registered_cases(kwargs["out"]),
    )
    monkeypatch.setattr(
        pipeline,
        "run_matrix",
        lambda **kwargs: {"status": "PASS", "cells": [{"status": "PASS"}]},
    )
    monkeypatch.setattr(
        pipeline,
        "run_continuity",
        lambda lane_id, **kwargs: {"status": "PASS", "lane_id": lane_id},
    )

    result = cli.run_suite(
        root=REPO,
        suite="nightly",
        output=tmp_path / "limited",
        host_id="local",
        baseline=tmp_path / "baseline",
        matrix_limit=1,
    )

    assert result["status"] == "NOT_RUN"
    assert "diagnostic_matrix_limit" in result["not_run_reasons"]
    assert result["diagnostic"]["matrix_limit"] == 1


def test_release_missing_external_inputs_writes_review_bundle_and_not_run(tmp_path: Path):
    pipeline = _load_pipeline()
    blind_request = {
        "schema_version": 1,
        "eval_spec": "eval-spec-v1",
        "pair_id": "pair-1",
        "labels": ["A", "B"],
        "sides": {"A": [{"turn_id": "t1", "text": "A"}], "B": [{"turn_id": "t1", "text": "B"}]},
        "turn_ids": ["t1"],
        "rubric_id": "agency-and-fun",
        "rubric_version": 1,
        "request_sha256": "a" * 64,
    }
    result = pipeline.run_release_external_gates(
        root=REPO,
        output=tmp_path,
        chapter_run=None,
        holdout_bundle=None,
        calibration_reviews=None,
        judge_requests=[blind_request],
    )
    assert result["status"] == "NOT_RUN"
    assert set(result["missing"]) == {"chapter_run", "holdout_bundle", "human_calibration"}
    bundle = json.loads((tmp_path / "artifacts/human-review-bundle.json").read_text())
    assert bundle["reviews"] == []
    assert bundle["evidence_kind"] == "human_review_requested"
    assert bundle["schema_version"] == 1
    assert bundle["eval_spec"] == "eval-spec-v1"
    assert bundle["required_reviewer_count"] == 2
    assert len(bundle["blind_requests"]) == 1
    request = bundle["blind_requests"][0]
    assert "baseline" not in request
    assert "candidate" not in request
    assert "baseline_label" not in request
    assert "candidate_label" not in request


def test_release_remains_not_run_for_external_evidence_until_supplied(tmp_path: Path):
    cli = _load_cli()
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    implemented = set(manifest["implemented_capabilities"])
    assert {"chapter_transition", "human_calibration"} <= implemented
    result = cli.run_suite(
        root=REPO,
        suite="release",
        output=tmp_path / "release",
        host_id="local",
    )
    assert result["status"] == "NOT_RUN"
    assert result.get("missing_capabilities") in (None, [])
    assert set(result["missing"]) == {
        "chapter_run",
        "holdout_bundle",
        "human_calibration",
    }
    bundle_path = tmp_path / "release" / "artifacts" / "human-review-bundle.json"
    assert bundle_path.is_file()
    bundle = json.loads(bundle_path.read_text(encoding="utf-8"))
    assert bundle["reviews"] == []
    assert bundle["evidence_kind"] == "human_review_requested"


def test_release_contradictory_external_evidence_fails(tmp_path: Path):
    pipeline = _load_pipeline()
    chapter_run = tmp_path / "bad-chapter"
    chapter_run.mkdir()
    _write_json(
        chapter_run / "chapter-transition-evidence.json",
        {
            "schema_version": 1,
            "eval_spec": "eval-spec-v1",
            "evidence_class": "fixture",
            "eligible": True,
            "source_module_id": "wrong-module",
            "chapter_switch_event": {
                "event_id": "evt-1",
                "event_type": "chapter_switch",
            },
            "pre_active_scenario_id": "wrong-pre",
            "post_active_scenario_id": "wrong-post",
            "preserved_epistemic_sidecars": [],
            "investigator_state_continuity": {"preserved": False},
            "campaign_state_continuity": {"preserved": False},
            "item_continuity": {"preserved": False},
            "discovered_clues": [],
            "relationships": [],
            "secret_audit": {"status": "PASS", "references": []},
        },
    )
    body = '{"ok":false}\n'
    digest = _sha256_text('{"ok":true}\n')
    holdout_manifest = {
        "schema_version": 1,
        "eval_spec": "eval-spec-v1",
        "manifest_version": "release-fail",
        "holdouts": [
            {
                "holdout_id": "holdout-fail-01",
                "suite": "release",
                "artifact_kind": "blind_pair_bundle",
                "relative_path": "holdout-fail-01/bundle.json",
                "sha256": digest,
            }
        ],
    }
    holdout_bundle = tmp_path / "holdouts"
    artifact = holdout_bundle / "holdout-fail-01" / "bundle.json"
    artifact.parent.mkdir(parents=True, exist_ok=True)
    artifact.write_text(body, encoding="utf-8")
    reviews = {
        "schema_version": 1,
        "eval_spec": "eval-spec-v1",
        "rubric_id": "agency-and-fun",
        "rubric_version": "1",
        "reviews": [
            {
                "item_id": "item-1",
                "reviewer_id": "r1",
                "rubric_id": "agency-and-fun",
                "rubric_version": "1",
                "decision": "A",
                "evidence_spans": [{"turn_id": "t1", "span_id": "s1"}],
                "reviewed_at": "2026-07-13T00:00:00Z",
                "request_sha256": "b" * 64,
                "artifact_sha256": "c" * 64,
                "baseline": "leaked",
            }
        ],
    }
    reviews_path = tmp_path / "bad-reviews.json"
    _write_json(reviews_path, reviews)
    manifest_path = tmp_path / "holdout-manifest.json"
    _write_json(manifest_path, holdout_manifest)

    result = pipeline.run_release_external_gates(
        root=REPO,
        output=tmp_path / "out",
        chapter_run=chapter_run,
        holdout_bundle=holdout_bundle,
        holdout_manifest=manifest_path,
        calibration_reviews=reviews_path,
        judge_requests=[],
    )
    assert result["status"] == "FAIL"
    assert result.get("missing") in (None, [])
    lanes = result["lanes"]
    assert lanes["chapter_transition"]["status"] == "FAIL"
    assert lanes["holdout"]["status"] == "FAIL"
    assert lanes["human_calibration"]["status"] == "FAIL"


def test_release_valid_fixture_evidence_passes_without_gameplay_claim(tmp_path: Path):
    pipeline = _load_pipeline()
    chapter_path = REPO / "evaluation" / "spec" / "v1" / "cases" / "chapter-transition.json"
    requirements = json.loads(chapter_path.read_text(encoding="utf-8"))["lanes"][0][
        "requirements"
    ]
    chapter_run = tmp_path / "chapter-ok"
    chapter_run.mkdir()
    evidence = {
        "schema_version": 1,
        "eval_spec": "eval-spec-v1",
        "lane_id": "masks-peru-to-america",
        "evidence_class": "fixture",
        "eligible": True,
        "source_module_id": requirements["source_module_id"],
        "chapter_switch_event": {
            "event_id": "evt-chapter-switch-1",
            "event_type": "chapter_switch",
            "from_scenario_id": requirements["pre_active_scenario_id"],
            "to_scenario_id": requirements["post_active_scenario_id"],
        },
        "pre_active_scenario_id": requirements["pre_active_scenario_id"],
        "post_active_scenario_id": requirements["post_active_scenario_id"],
        "preserved_epistemic_sidecars": list(
            requirements["preserved_epistemic_sidecars"]
        ),
        "investigator_state_continuity": {
            "investigator_id": "inv-1",
            "state_sha256_before": _sha256_text("inv-before"),
            "state_sha256_after": _sha256_text("inv-after"),
            "preserved": True,
        },
        "campaign_state_continuity": {
            "campaign_id": "camp-1",
            "state_sha256_before": _sha256_text("camp-before"),
            "state_sha256_after": _sha256_text("camp-after"),
            "preserved": True,
        },
        "discovered_clues": [{"clue_id": "clue-1", "retained": True}],
        "relationships": [{"npc_id": "npc-1", "retained": True}],
        "item_continuity": {
            "items": [{"item_id": "item-1", "retained": True}],
            "preserved": True,
        },
        "code_revision_bridges_checkpoints": False,
        "secret_audit": {
            "status": "PASS",
            "references": [
                {
                    "artifact": "artifacts/secret-audit.json",
                    "finding_id": "secret-audit-none",
                }
            ],
        },
    }
    _write_json(chapter_run / "chapter-transition-evidence.json", evidence)
    assert evidence["evidence_class"] == "fixture"

    body = '{"ok":true}\n'
    digest = _sha256_text(body)
    holdout_manifest = {
        "schema_version": 1,
        "eval_spec": "eval-spec-v1",
        "manifest_version": "release-pass",
        "holdouts": [
            {
                "holdout_id": "holdout-pass-01",
                "suite": "release",
                "artifact_kind": "blind_pair_bundle",
                "relative_path": "holdout-pass-01/bundle.json",
                "sha256": digest,
            }
        ],
    }
    holdout_bundle = tmp_path / "holdouts"
    artifact = holdout_bundle / "holdout-pass-01" / "bundle.json"
    artifact.parent.mkdir(parents=True, exist_ok=True)
    artifact.write_text(body, encoding="utf-8")
    manifest_path = tmp_path / "holdout-manifest.json"
    _write_json(manifest_path, holdout_manifest)

    reviews = {
        "schema_version": 1,
        "eval_spec": "eval-spec-v1",
        "rubric_id": "agency-and-fun",
        "rubric_version": "1",
        "reviews": [
            {
                "item_id": "item-1",
                "reviewer_id": "r1",
                "rubric_id": "agency-and-fun",
                "rubric_version": "1",
                "decision": "A",
                "evidence_spans": [{"turn_id": "t1", "span_id": "s1"}],
                "reviewed_at": "2026-07-13T00:00:00Z",
                "request_sha256": "d" * 64,
                "artifact_sha256": "e" * 64,
            },
            {
                "item_id": "item-1",
                "reviewer_id": "r2",
                "rubric_id": "agency-and-fun",
                "rubric_version": "1",
                "decision": "A",
                "evidence_spans": [{"turn_id": "t1", "span_id": "s1"}],
                "reviewed_at": "2026-07-13T00:00:01Z",
                "request_sha256": "d" * 64,
                "artifact_sha256": "e" * 64,
            },
        ],
    }
    reviews_path = tmp_path / "reviews.json"
    _write_json(reviews_path, reviews)

    result = pipeline.run_release_external_gates(
        root=REPO,
        output=tmp_path / "out",
        chapter_run=chapter_run,
        holdout_bundle=holdout_bundle,
        holdout_manifest=manifest_path,
        calibration_reviews=reviews_path,
        judge_requests=[],
    )
    assert result["status"] == "PASS"
    assert result.get("missing") in (None, [])
    chapter_lane = result["lanes"]["chapter_transition"]
    assert chapter_lane["status"] == "PASS"
    assert chapter_lane.get("evidence_class") == "fixture"
    assert chapter_lane.get("gameplay_evidence") is False
    assert result["lanes"]["holdout"]["status"] == "PASS"
    assert result["lanes"]["human_calibration"]["status"] == "PASS"
    assert result["lanes"]["human_calibration"].get("evidence_kind") != "human_completed"
    bundle = json.loads(
        (tmp_path / "out" / "artifacts" / "human-review-bundle.json").read_text(
            encoding="utf-8"
        )
    )
    assert bundle["reviews"] == []
    assert bundle["evidence_kind"] == "human_review_requested"


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


def test_completion_audit_requires_unique_hash_bound_registered_case_results():
    audit = _load_audit()
    requirements = audit.build_eval_contract_requirements(REPO, suite="smoke")
    cases = [
        {
            "case_id": case_id,
            "status": "PASS",
            "artifact_hashes": {f"cases/{case_id}/stdout.log": "a" * 64},
        }
        for case_id in requirements["case_ids"]
    ]
    payload = {
        "schema_version": 1,
        "eval_spec": "eval-spec-v1",
        "suite": "smoke",
        "status": "PASS",
        "cases": cases,
    }

    complete = audit.assess_eval_contract_coverage(
        REPO, suite="smoke", case_results=payload
    )
    assert complete["status"] == "PASS"

    payload["cases"].append(dict(cases[0]))
    duplicate = audit.assess_eval_contract_coverage(
        REPO, suite="smoke", case_results=payload
    )
    assert duplicate["status"] == "NOT_RUN"
    assert duplicate["gaps"]["case_ids"] == [cases[0]["case_id"]]

    payload["cases"][0]["artifact_hashes"] = {"stdout.log": "not-a-sha256"}
    mixed_duplicate = audit.assess_eval_contract_coverage(
        REPO, suite="smoke", case_results=payload
    )
    assert mixed_duplicate["status"] == "NOT_RUN"
    assert mixed_duplicate["gaps"]["case_ids"] == [cases[0]["case_id"]]

    payload["cases"] = cases[:-1]
    malformed = audit.assess_eval_contract_coverage(
        REPO, suite="smoke", case_results=payload
    )
    assert malformed["status"] == "NOT_RUN"
    assert malformed["gaps"]["case_ids"] == [cases[0]["case_id"]]


def test_completion_audit_requires_evidence_grade_matrix_and_continuity_results():
    audit = _load_audit()
    requirements = audit.build_eval_contract_requirements(REPO, suite="nightly")
    digest = "a" * 64
    case_results = {
        "schema_version": 1,
        "eval_spec": "eval-spec-v1",
        "suite": "nightly",
        "status": "PASS",
        "cases": [
            {
                "case_id": case_id,
                "status": "PASS",
                "artifact_hashes": {f"cases/{case_id}/stdout.log": digest},
            }
            for case_id in requirements["case_ids"]
        ],
    }
    matrix_results = {
        "schema_version": 1,
        "eval_spec": "eval-spec-v1",
        "suite": "nightly",
        "status": "PASS",
        "artifact_hashes": {
            "matrix-plan.json": digest,
            "aggregate-summary.json": digest,
        },
        "cells": [
            {
                "cell_id": f"{persona}__seed-{seed}__{case_id}",
                "persona_id": persona,
                "seed": seed,
                "case_id": case_id,
                "status": "PASS",
                "player_model": {"provider": "coding-relay", "id": "gpt-5.6-luna"},
                "kp_model": {"provider": "zhipu-coding", "id": "glm-5.2"},
                "judge_model": {"provider": "coding-relay", "id": "gpt-5.6-sol"},
                "runner_result": {"status": "PASS"},
                "judge_results": {
                    rubric_id: {
                        "evaluator": {
                            "provider": "coding-relay",
                            "id": "gpt-5.6-sol",
                        }
                    }
                    for rubric_id in requirements[
                        "matrix_required_rubric_ids_by_case"
                    ][case_id]
                },
                "judge_gates": [
                    {"rubric_id": rubric_id, "status": "PASS"}
                    for rubric_id in requirements[
                        "matrix_required_rubric_ids_by_case"
                    ][case_id]
                ],
                "artifact_hashes": {
                    "run-manifest.json": digest,
                    "player-request.json": digest,
                    "kp-request.json": digest,
                    **{
                        (
                            "judge-result.json"
                            if len(
                                requirements["matrix_required_rubric_ids_by_case"][
                                    case_id
                                ]
                            )
                            == 1
                            else f"judge-result.{rubric_id}.json"
                        ): digest
                        for rubric_id in requirements[
                            "matrix_required_rubric_ids_by_case"
                        ][case_id]
                    },
                },
            }
            for persona in requirements["persona_ids"]
            for seed in requirements["seeds"]
            for case_id in requirements["matrix_case_ids"]
        ],
    }
    continuity_results = {
        lane_id: {
            "schema_version": 1,
            "eval_spec": "eval-spec-v1",
            "lane_id": lane_id,
            "status": "PASS",
            "evidence_class": "external",
            "eligible": True,
            "attestation": {
                "player_model": {"provider": "coding-relay", "id": "gpt-5.6-luna"},
                "kp_model": {"provider": "zhipu-coding", "id": "glm-5.2"},
                "attested": True,
            },
            "validation": {
                "status": "PASS",
                "evidence_class": "external",
                "gameplay_evidence": True,
            },
        }
        for lane_id in requirements["continuity_lane_ids"]
    }

    assessment = audit.assess_eval_contract_coverage(
        REPO,
        suite="nightly",
        case_results=case_results,
        matrix_results=matrix_results,
        continuity_results=continuity_results,
    )

    assert assessment["status"] == "PASS"
    assert not any(assessment["gaps"].values())
    assert set(assessment["satisfied_continuity_lane_ids"]) == {
        "continuity-25",
        "continuity-50",
    }

    missing_judge_artifact = next(
        name
        for name in matrix_results["cells"][0]["artifact_hashes"]
        if name.startswith("judge-result")
    )
    matrix_results["cells"][0]["artifact_hashes"].pop(missing_judge_artifact)
    continuity_results["continuity-50"]["evidence_class"] = "fixture"
    incomplete = audit.assess_eval_contract_coverage(
        REPO,
        suite="nightly",
        case_results=case_results,
        matrix_results=matrix_results,
        continuity_results=continuity_results,
    )
    assert incomplete["status"] == "NOT_RUN"
    assert incomplete["gaps"]["matrix_cells"]
    assert incomplete["gaps"]["continuity_lane_ids"] == ["continuity-50"]


def test_real_two_pass_matrix_result_clears_audit_and_outer_receipt_detects_tamper(
    tmp_path: Path, monkeypatch
):
    cli = _load_cli()
    pipeline = sys.modules["coc_eval_pipeline"]
    audit = _load_audit()
    configuration = {
        "schema_version": 1,
        "eval_spec": "eval-spec-v1",
        "description": "controlled executable integration cell",
        "persona_ids": ["careful_investigator"],
        "seeds": [3],
        "cases": [
            {
                "case_id": "nightly",
                "runner": "controlled_fixture",
                "runner_path": "plugins/coc-keeper/scripts/coc_eval.py",
                "scenario_fixture": "evaluation/spec/v1/fixtures/matrix/nightly-scenario.json",
                "initial_state_fixture": "evaluation/spec/v1/fixtures/matrix/nightly-initial-state.json",
                "player_model": {"provider": "coding-relay", "id": "gpt-5.6-luna"},
                "kp_model": {"provider": "zhipu-coding", "id": "glm-5.2"},
                "judge_model": {"provider": "coding-relay", "id": "gpt-5.6-sol"},
                "prompt_hashes": {"player": "a" * 64, "kp": "b" * 64},
                "max_turns": 1,
                "judge": {"enabled": True, "rubric_id": "agency-and-fun"},
            }
        ],
    }
    plan = pipeline.matrix.build_matrix_plan(
        root=REPO,
        suite="nightly",
        configuration=configuration,
        credential_env={},
        model_preflight=None,
    )
    monkeypatch.setattr(
        pipeline.matrix,
        "build_matrix_plan",
        lambda **kwargs: json.loads(json.dumps(plan)),
    )

    def controlled_runner(*, cell_input, cell_dir, **kwargs):
        payload = json.loads(Path(cell_input).read_text(encoding="utf-8"))
        destination = Path(cell_dir)
        destination.mkdir(parents=True, exist_ok=True)
        player_view = destination / "player-view.jsonl"
        player_view.write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "view": "player",
                    "turn_number": 1,
                    "player_text": "我检查门锁。",
                    "narration": "公开叙事。",
                },
                ensure_ascii=False,
                sort_keys=True,
            )
            + "\n",
            encoding="utf-8",
        )
        identity = {
            key: payload.get(key)
            for key in pipeline.matrix._RUN_MANIFEST_IDENTITY_KEYS
        }
        _write_json(
            destination / "run-manifest.json",
            {
                **identity,
                "schema_version": 1,
                "eval_spec": "eval-spec-v1",
                "status": "PASS",
                "evidence_eligible": True,
                "hard_findings": [],
                "evidence_findings": [],
                "artifact_hashes": {
                    "player-view.jsonl": hashlib.sha256(
                        player_view.read_bytes()
                    ).hexdigest()
                },
            },
        )
        return {"status": "PASS", "returncode": 0}

    monkeypatch.setattr(
        pipeline.matrix, "_invoke_fake_or_script_runner", controlled_runner
    )

    def controlled_judge(request, rubric, **kwargs):
        return {
            "evaluator": {"provider": "coding-relay", "id": "gpt-5.6-sol"},
            "request_sha256": request["request_sha256"],
            "winner": "tie",
            "dimension_scores": {
                item["dimension_id"]: 4 for item in rubric["dimensions"]
            },
            "findings": [],
            "reasons": ["The controlled public turns are equivalent."],
        }

    monkeypatch.setattr(
        pipeline.matrix.judge, "invoke_sol_judge", controlled_judge
    )
    baseline = tmp_path / "baseline-matrix"
    captured = pipeline.run_matrix(
        root=REPO,
        suite="nightly",
        output=baseline,
        baseline=None,
        matrix_limit=None,
        timeout=30,
    )
    assert captured["status"] == "NOT_RUN"

    continuity = {
        lane_id: {
            "schema_version": 1,
            "eval_spec": "eval-spec-v1",
            "lane_id": lane_id,
            "status": "PASS",
            "evidence_class": "external",
            "eligible": True,
            "attestation": {
                "player_model": {"provider": "coding-relay", "id": "gpt-5.6-luna"},
                "kp_model": {"provider": "zhipu-coding", "id": "glm-5.2"},
                "attested": True,
            },
            "validation": {
                "status": "PASS",
                "evidence_class": "external",
                "gameplay_evidence": True,
            },
        }
        for lane_id in ("continuity-25", "continuity-50")
    }
    monkeypatch.setattr(
        pipeline,
        "run_continuity",
        lambda lane_id, **kwargs: continuity[lane_id],
    )
    case_results = {
        "schema_version": 1,
        "eval_spec": "eval-spec-v1",
        "suite": "nightly",
        "status": "PASS",
        "cases": [
            {
                "case_id": "foundation",
                "status": "PASS",
                "artifact_hashes": {"cases/foundation/stdout.log": "c" * 64},
            }
        ],
    }
    candidate_dir = tmp_path / "candidate"
    extended = pipeline.run_extended_suite(
        root=REPO,
        suite="nightly",
        output=candidate_dir,
        case_results=case_results,
        baseline=baseline,
        timeout=30,
    )
    candidate = extended["lanes"]["matrix"]
    assert candidate["status"] == "PASS"
    assert candidate["cells"][0]["judge_model"] == {
        "provider": "coding-relay",
        "id": "gpt-5.6-sol",
    }
    assert "matrix-results.json" not in candidate["artifact_hashes"]

    audit_root = tmp_path / "audit-root"
    _write_json(
        audit_root / "evaluation/spec/v1/benchmark-manifest.json",
        {
            "schema_version": 1,
            "eval_spec": "eval-spec-v1",
            "benchmark_version": "fixture",
            "implemented_capabilities": [],
            "matrix": {
                "suites": {
                    "nightly": {
                        "persona_ids": ["careful_investigator"],
                        "seeds": [3],
                        "cases": [{"case_id": "nightly"}],
                    }
                }
            },
            "suites": {"nightly": {"required_capabilities": []}},
        },
    )
    _write_json(
        audit_root / "evaluation/spec/v1/case-registry.json",
        {
            "cases": [
                {"case_id": "foundation", "gate": "hard", "suites": ["nightly"]}
            ]
        },
    )
    _write_json(
        audit_root / "evaluation/spec/v1/cases/long-memory.json",
        {
            "lanes": [
                {"lane_id": "continuity-25"},
                {"lane_id": "continuity-50"},
            ]
        },
    )
    assessment = audit.assess_eval_contract_coverage(
        audit_root,
        suite="nightly",
        case_results=case_results,
        matrix_results=candidate,
        continuity_results=continuity,
    )
    assert assessment["status"] == "PASS"

    receipts = extended["lane_artifacts"]
    assert pipeline.verify_lane_artifacts(candidate_dir, receipts)["status"] == "PASS"
    matrix_results_path = candidate_dir / "lanes/matrix/matrix-results.json"
    matrix_results_path.write_text(
        matrix_results_path.read_text(encoding="utf-8") + "\n",
        encoding="utf-8",
    )
    tampered = pipeline.verify_lane_artifacts(candidate_dir, receipts)
    assert tampered["status"] == "FAIL"
    assert any(
        finding["code"] == "lane_artifact_hash_mismatch"
        and finding.get("path") == "lanes/matrix/matrix-results.json"
        for finding in tampered["findings"]
    )


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
