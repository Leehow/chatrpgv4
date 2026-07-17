from __future__ import annotations

import importlib.util
import json
import os
import sys
import time
from pathlib import Path

import pytest


REPO = Path(__file__).resolve().parents[1]
MODULE_PATH = REPO / "plugins" / "coc-keeper" / "scripts" / "coc_eval_cases.py"
CONTRACT_PATH = REPO / "plugins" / "coc-keeper" / "scripts" / "coc_eval_contract.py"
CLI_PATH = REPO / "plugins" / "coc-keeper" / "scripts" / "coc_eval.py"


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


def cli_module():
    return _load("coc_eval_cli_cases_test", CLI_PATH)


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
            "{python}",
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
        "battle-report-roll-omission",
    } <= set(case_ids)

    smoke = cases.resolve_suite_cases(manifest, registry, "smoke")
    pr = cases.resolve_suite_cases(manifest, registry, "pr")
    assert smoke
    assert pr
    assert all("smoke" in case["suites"] for case in smoke)
    assert all("pr" in case["suites"] for case in pr)


def test_nightly_inherits_the_hard_deterministic_registry_foundation():
    cases = cases_module()
    contract = contract_module()
    registry = cases.load_case_registry(REPO)
    manifest = contract.load_benchmark_manifest(REPO)

    nightly = cases.resolve_suite_cases(manifest, registry, "nightly")
    expected = {
        case["case_id"]
        for case in registry["cases"]
        if case["gate"] == "hard" and set(case["suites"]) & {"smoke", "pr"}
    }

    assert nightly
    assert {case["case_id"] for case in nightly} == expected
    assert all(case["gate"] == "hard" for case in nightly)


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
                        "{python}",
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


def test_registry_rejects_path_selected_python_interpreter(tmp_path: Path):
    cases = cases_module()
    (tmp_path / "tests").mkdir()
    (tmp_path / "tests" / "test_fixture.py").write_text(
        "def test_fixture():\n    assert True\n", encoding="utf-8"
    )
    for executable in ("python", "python3"):
        path = _write(
            tmp_path / "evaluation" / "spec" / "v1" / "case-registry.json",
            _registry([_case(command=[executable, "-m", "pytest"])]),
        )
        with pytest.raises(ValueError, match=r"must use \{python\}"):
            cases.load_case_registry(tmp_path, path=path)


def test_registry_python_token_resolves_to_running_interpreter():
    cases = cases_module()
    assert cases.resolve_case_command(
        _case(command=["{python}", "-c", "print('ok')"])
    ) == [sys.executable, "-c", "print('ok')"]


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


def test_run_case_timeout_is_hash_bound_not_run_evidence(tmp_path: Path):
    cases = cases_module()
    result = cases.run_case(
        _case(
            kind="python_command",
            command=[sys.executable, "-c", "import time; time.sleep(1)"],
            required_capabilities=[],
        ),
        root=tmp_path,
        output=tmp_path / "out",
        implemented_capabilities=set(),
        env={"PYTHONDONTWRITEBYTECODE": "1"},
        timeout=0.01,
    )

    assert result["status"] == "NOT_RUN"
    assert result["returncode"] is None
    assert result["not_run_reasons"] == ["execution_timeout"]
    assert result["artifact_hashes"][result["stdout_path"]]
    assert result["artifact_hashes"][result["stderr_path"]]


def test_run_case_timeout_kills_stubborn_descendant_process_group(tmp_path: Path):
    cases = cases_module()
    sentinel = tmp_path / "orphan-sentinel.txt"
    ready = tmp_path / "descendant-ready.txt"
    child_code = (
        "import pathlib,signal,time; "
        "signal.signal(signal.SIGTERM, signal.SIG_IGN); "
        f"pathlib.Path({str(ready)!r}).write_text('ready'); "
        "time.sleep(1.0); "
        f"pathlib.Path({str(sentinel)!r}).write_text('orphan')"
    )
    parent_code = (
        "import pathlib,subprocess,sys,time; "
        f"ready=pathlib.Path({str(ready)!r}); "
        f"subprocess.Popen([sys.executable, '-c', {child_code!r}]); "
        "deadline=time.monotonic()+2; "
        "\nwhile not ready.exists() and time.monotonic()<deadline: time.sleep(0.01)"
        "\ntime.sleep(30)"
    )

    started = time.monotonic()
    result = cases.run_case(
        _case(
            kind="python_command",
            command=[sys.executable, "-c", parent_code],
            required_capabilities=[],
        ),
        root=tmp_path,
        output=tmp_path / "out",
        implemented_capabilities=set(),
        env={"PYTHONDONTWRITEBYTECODE": "1"},
        timeout=0.3,
    )
    elapsed = time.monotonic() - started

    assert elapsed < 2.5
    assert result["status"] == "NOT_RUN"
    assert result["returncode"] is None
    assert result["not_run_reasons"] == ["execution_timeout"]
    assert result["artifact_hashes"][result["stdout_path"]]
    assert result["artifact_hashes"][result["stderr_path"]]
    assert ready.exists(), "descendant must start before the timeout assertion"
    time.sleep(1.2)
    assert not sentinel.exists()


def test_run_case_timeout_does_not_start_without_process_tree_supervisor(
    tmp_path: Path, monkeypatch
):
    cases = cases_module()
    monkeypatch.setattr(
        cases, "_supports_process_tree_supervisor", lambda: False, raising=False
    )
    monkeypatch.setattr(
        cases.subprocess,
        "Popen",
        lambda *args, **kwargs: pytest.fail("unsupported timeout must not start"),
    )

    result = cases.run_case(
        _case(
            kind="python_command",
            command=["fixture"],
            required_capabilities=[],
        ),
        root=tmp_path,
        output=tmp_path / "out",
        implemented_capabilities=set(),
        timeout=0.1,
    )

    assert result["status"] == "NOT_RUN"
    assert result["not_run_reasons"] == ["process_tree_supervisor_unsupported"]
    assert result["stdout_path"] is None
    assert result["stderr_path"] is None
    assert result["artifact_hashes"] == {}


def test_run_case_timeout_cleanup_and_pipe_drain_are_bounded(
    tmp_path: Path, monkeypatch
):
    cases = cases_module()

    class Process:
        pid = 4242
        returncode = 0

    process = Process()
    monkeypatch.setattr(cases.subprocess, "Popen", lambda *args, **kwargs: process)
    monkeypatch.setattr(
        cases, "_supports_process_tree_supervisor", lambda: True, raising=False
    )

    def timeout_drain(candidate, timeout, stdout_sink, stderr_sink):
        assert candidate is process
        assert timeout == 0.1
        stdout_sink.write(b"partial-out")
        stderr_sink.write(b"partial-err")
        return True, False, False

    monkeypatch.setattr(cases, "_drain_case_pipes", timeout_drain)

    result = cases.run_case(
        _case(
            kind="python_command",
            command=["fixture"],
            required_capabilities=[],
        ),
        root=tmp_path,
        output=tmp_path / "out",
        implemented_capabilities=set(),
        timeout=0.1,
    )

    assert result["status"] == "NOT_RUN"
    assert result["not_run_reasons"] == [
        "execution_timeout",
        "process_tree_termination_unconfirmed",
        "process_output_drain_timeout",
    ]
    assert (tmp_path / "out" / result["stdout_path"]).read_text() == "partial-out"
    assert (tmp_path / "out" / result["stderr_path"]).read_text() == "partial-err"


def test_run_case_streams_pipes_to_artifacts_without_communicate(
    tmp_path: Path, monkeypatch
):
    cases = cases_module()
    stdout_read, stdout_write = os.pipe()
    stderr_read, stderr_write = os.pipe()
    os.write(stdout_write, b"streamed-out\n")
    os.write(stderr_write, b"streamed-err\n")
    os.close(stdout_write)
    os.close(stderr_write)

    class Process:
        pid = 4545
        returncode = 0

        def __init__(self):
            self.stdout = os.fdopen(stdout_read, "rb", buffering=0)
            self.stderr = os.fdopen(stderr_read, "rb", buffering=0)

        def communicate(self, timeout=None):
            raise AssertionError("registered case output must not use communicate")

        def poll(self):
            return self.returncode

        def wait(self, timeout=None):
            return self.returncode

    process = Process()
    selector_factory = cases.selectors.DefaultSelector

    class InterruptOnceSelector:
        def __init__(self):
            self.inner = selector_factory()
            self.interrupted = False

        def select(self, timeout=None):
            if not self.interrupted:
                self.interrupted = True
                raise InterruptedError("signal interrupted selector")
            return self.inner.select(timeout)

        def __getattr__(self, name):
            return getattr(self.inner, name)

    original_read = os.read
    read_interrupted = False

    def interrupt_read_once(fd, size):
        nonlocal read_interrupted
        if not read_interrupted:
            read_interrupted = True
            raise InterruptedError("signal interrupted read")
        return original_read(fd, size)

    monkeypatch.setattr(cases.subprocess, "Popen", lambda *args, **kwargs: process)
    monkeypatch.setattr(
        cases, "_supports_process_tree_supervisor", lambda: True, raising=False
    )
    monkeypatch.setattr(cases.selectors, "DefaultSelector", InterruptOnceSelector)
    monkeypatch.setattr(cases.os, "read", interrupt_read_once)

    result = cases.run_case(
        _case(
            kind="python_command",
            command=["fixture"],
            required_capabilities=[],
        ),
        root=tmp_path,
        output=tmp_path / "out",
        implemented_capabilities=set(),
        timeout=1.0,
    )

    assert result["status"] == "PASS"
    assert read_interrupted is True
    assert (tmp_path / "out" / result["stdout_path"]).read_text() == "streamed-out\n"
    assert (tmp_path / "out" / result["stderr_path"]).read_text() == "streamed-err\n"


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


def test_cli_run_suite_uses_registry_and_writes_case_results(
    tmp_path: Path, capsys
):
    cli = cli_module()
    root = tmp_path / "repo"
    spec = root / "evaluation" / "spec" / "v1"
    spec.mkdir(parents=True)
    _write(
        spec / "benchmark-manifest.json",
        {
            "schema_version": 1,
            "eval_spec": "eval-spec-v1",
            "benchmark_version": "fixture-1",
            "report_schema_version": 2,
            "implemented_capabilities": ["canonical_cli", "case_registry"],
            "suites": {
                "smoke": {
                    "description": "fixture",
                    "required_capabilities": ["canonical_cli", "case_registry"],
                    "commands": [],
                }
            },
        },
    )
    _write(
        spec / "case-registry.json",
        _registry(
            [
                _case(
                    kind="python_command",
                    command=["{python}", "-c", "print('registry-case-ok')"],
                    required_capabilities=["canonical_cli"],
                )
            ]
        ),
    )
    output = tmp_path / "out"

    code = cli.main(
        ["run", "--suite", "smoke", "--root", str(root), "--output", str(output)]
    )
    payload = json.loads(capsys.readouterr().out)

    assert code == 0
    assert payload["status"] == "PASS"
    assert payload["case_results"][0]["case_id"] == "fixture-case"
    assert payload["case_results"][0]["status"] == "PASS"
    case_results = json.loads(
        (output / "case-results.json").read_text(encoding="utf-8")
    )
    assert case_results["status"] == "PASS"
    assert case_results["cases"][0]["case_id"] == "fixture-case"
    manifest = json.loads((output / "run-manifest.json").read_text(encoding="utf-8"))
    assert manifest["case_results_path"] == "case-results.json"
    assert manifest["case_ids"] == ["fixture-case"]
