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
    case = {
        "case_id": "deterministic-foundation",
        "gate": "hard",
        "status": status,
        "artifact_hashes": {"cases/deterministic-foundation/stdout.log": "a" * 64},
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


def test_release_remains_not_run_for_task_six_capabilities(tmp_path: Path):
    cli = _load_cli()
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    implemented = set(manifest["implemented_capabilities"])
    required = set(manifest["suites"]["release"]["required_capabilities"])
    missing = sorted(required - implemented)
    assert {"chapter_transition", "human_calibration"} <= set(missing)
    result = cli.run_suite(
        root=REPO,
        suite="release",
        output=tmp_path / "release",
        host_id="local",
    )
    assert result["status"] == "NOT_RUN"
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
                "judge_result": {
                    "evaluator": {"provider": "coding-relay", "id": "gpt-5.6-sol"}
                },
                "artifact_hashes": {
                    "run-manifest.json": digest,
                    "player-request.json": digest,
                    "kp-request.json": digest,
                    "judge-result.json": digest,
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

    matrix_results["cells"][0]["artifact_hashes"].pop("judge-result.json")
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
