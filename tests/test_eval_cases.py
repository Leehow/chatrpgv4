from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest


REPO = Path(__file__).resolve().parents[1]
MODULE_PATH = REPO / "plugins" / "coc-keeper" / "scripts" / "coc_eval_cases.py"
CONTRACT_PATH = REPO / "plugins" / "coc-keeper" / "scripts" / "coc_eval_contract.py"


def _load(name: str, path: Path):
    assert path.is_file(), f"missing implementation module: {path}"
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def cases_module():
    return _load("coc_eval_cases_test", MODULE_PATH)


def contract_module():
    return _load("coc_eval_contract_cases_test", CONTRACT_PATH)


def _write(path: Path, payload: object) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return path


def _case(**overrides):
    value = {
        "case_id": "fixture-case",
        "description": "fixture",
        "kind": "pytest_node",
        "suites": ["smoke"],
        "gate": "hard",
        "required_capabilities": ["canonical_cli"],
        "command": [
            "python3",
            "-m",
            "pytest",
            "tests/test_fixture.py::test_fixture",
            "-q",
        ],
        "evidence_requirements": ["stdout", "stderr", "returncode"],
    }
    value.update(overrides)
    return value


def _registry(cases: list[dict]) -> dict:
    return {
        "schema_version": 1,
        "eval_spec": "eval-spec-v1",
        "registry_version": "2026.07.1",
        "cases": cases,
    }


def test_repository_case_registry_is_versioned_unique_and_resolvable():
    cases = cases_module()
    contract = contract_module()
    registry = cases.load_case_registry(REPO)
    manifest = contract.load_benchmark_manifest(REPO)

    assert registry["schema_version"] == 1
    assert registry["eval_spec"] == "eval-spec-v1"
    case_ids = [case["case_id"] for case in registry["cases"]]
    assert case_ids
    assert len(case_ids) == len(set(case_ids))
    assert {
        "flag-set-scene-gates",
        "separator-normalized-location-tags",
        "investigator-state-party-seeding",
        "epistemic-sidecar-chapter-switch",
        "stale-roll-signal-expiry",
        "invalidated-checkpoint-resume",
        "narrator-secret-audit-persistence",
        "battle-report-roll-omission",
    } <= set(case_ids)

    smoke = cases.resolve_suite_cases(manifest, registry, "smoke")
    pr = cases.resolve_suite_cases(manifest, registry, "pr")
    assert smoke
    assert pr
    assert all("smoke" in case["suites"] for case in smoke)
    assert all("pr" in case["suites"] for case in pr)


def test_registry_rejects_duplicate_case_ids(tmp_path: Path):
    cases = cases_module()
    (tmp_path / "tests").mkdir()
    (tmp_path / "tests" / "test_fixture.py").write_text(
        "def test_fixture():\n    assert True\n", encoding="utf-8"
    )
    path = _write(
        tmp_path / "evaluation" / "spec" / "v1" / "case-registry.json",
        _registry([_case(), _case(description="duplicate")]),
    )

    with pytest.raises(ValueError, match="duplicate case_id"):
        cases.load_case_registry(tmp_path, path=path)


def test_registry_rejects_unknown_kind_and_gate(tmp_path: Path):
    cases = cases_module()
    (tmp_path / "tests").mkdir()
    (tmp_path / "tests" / "test_fixture.py").write_text(
        "def test_fixture():\n    assert True\n", encoding="utf-8"
    )
    for field, value, message in (
        ("kind", "agent_magic", "unsupported case kind"),
        ("gate", "maybe", "unsupported case gate"),
    ):
        path = _write(
            tmp_path / "evaluation" / "spec" / "v1" / "case-registry.json",
            _registry([_case(**{field: value})]),
        )
        with pytest.raises(ValueError, match=message):
            cases.load_case_registry(tmp_path, path=path)


def test_registry_rejects_paths_outside_repository(tmp_path: Path):
    cases = cases_module()
    path = _write(
        tmp_path / "evaluation" / "spec" / "v1" / "case-registry.json",
        _registry(
            [
                _case(
                    command=[
                        "python3",
                        "-m",
                        "pytest",
                        "../outside/test_bad.py::test_bad",
                    ]
                )
            ]
        ),
    )

    with pytest.raises(ValueError, match="outside repository"):
        cases.load_case_registry(tmp_path, path=path)


def test_run_case_writes_bound_logs_and_pass_status(tmp_path: Path):
    cases = cases_module()
    root = tmp_path / "repo"
    root.mkdir()
    output = tmp_path / "out"
    case = _case(
        kind="python_command",
        command=[sys.executable, "-c", "print('fixture-ok')"],
        required_capabilities=[],
    )

    result = cases.run_case(
        case,
        root=root,
        output=output,
        implemented_capabilities=set(),
        env={"PYTHONDONTWRITEBYTECODE": "1"},
    )

    assert result["status"] == "PASS"
    assert result["returncode"] == 0
    stdout_path = output / result["stdout_path"]
    stderr_path = output / result["stderr_path"]
    assert stdout_path.read_text(encoding="utf-8").strip() == "fixture-ok"
    assert stderr_path.is_file()
    assert result["artifact_hashes"][result["stdout_path"]]
    assert result["artifact_hashes"][result["stderr_path"]]


def test_run_case_is_not_run_when_capability_is_missing(tmp_path: Path):
    cases = cases_module()
    result = cases.run_case(
        _case(required_capabilities=["external_model"]),
        root=tmp_path,
        output=tmp_path / "out",
        implemented_capabilities={"canonical_cli"},
        env={},
    )

    assert result["status"] == "NOT_RUN"
    assert result["not_run_reasons"] == ["missing_capability:external_model"]
    assert result["returncode"] is None


def test_suite_status_fails_closed_for_required_hard_case():
    cases = cases_module()
    assert cases.aggregate_suite_status(
        [
            {"case_id": "a", "gate": "hard", "status": "PASS"},
            {"case_id": "b", "gate": "hard", "status": "NOT_RUN"},
        ]
    ) == "FAIL"
    assert cases.aggregate_suite_status(
        [
            {"case_id": "a", "gate": "hard", "status": "PASS"},
            {"case_id": "b", "gate": "soft", "status": "NOT_RUN"},
        ]
    ) == "PASS"
    assert cases.aggregate_suite_status(
        [{"case_id": "a", "gate": "hard", "status": "INELIGIBLE"}]
    ) == "INELIGIBLE"
