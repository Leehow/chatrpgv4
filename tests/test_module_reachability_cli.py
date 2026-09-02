"""CLI seam for `coc_module_projection.py lint`.

These tests cover the entry point only — which carriers it accepts, the shape
it emits, how it fails, and what it returns to the shell. The checks
themselves belong to tests/test_module_reachability.py.
"""
from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
PROJECTION_CLI = SCRIPTS / "coc_module_projection.py"
STARTER = (
    ROOT / "plugins" / "coc-keeper" / "references"
    / "starter-scenarios" / "the-haunting"
)
PROGRESSIVE = ROOT / ".coc" / "campaigns" / "amaranthine-20260822" / "scenario"

REPORT_FIELDS = {
    "contract_id",
    "schema_version",
    "scenario_id",
    "progressive",
    "documents_present",
    "documents_absent",
    "codes_not_measured",
    "findings",
    "summary",
}
FINDING_FIELDS = {
    "code",
    "severity",
    "completeness",
    "subject_id",
    "subject_kind",
    "related_ids",
    "declared",
    "counted",
    "reason",
}


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(PROJECTION_CLI), *args],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )


def _report(*args: str) -> dict:
    result = _run("lint", *args)
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def _assert_report_shape(report: dict) -> None:
    assert set(report) == REPORT_FIELDS
    assert report["contract_id"] == "coc.module-reachability-lint.v1"
    assert report["schema_version"] == 1
    assert isinstance(report["progressive"], bool)
    for key in ("documents_present", "documents_absent", "codes_not_measured"):
        assert isinstance(report[key], list)
        assert report[key] == sorted(report[key])
    summary = report["summary"]
    assert set(summary) == {"defect", "observation", "by_completeness"}
    assert set(summary["by_completeness"]) == {
        "dead", "pending-materialization", "not-measured"
    }
    for finding in report["findings"]:
        assert set(finding) == FINDING_FIELDS
        assert finding["severity"] in {"defect", "observation"}
        assert finding["completeness"] in {
            "dead", "pending-materialization", "not-measured"
        }
        assert isinstance(finding["related_ids"], list)
        assert isinstance(finding["declared"], dict)
        assert isinstance(finding["counted"], dict)


def test_ir_dir_on_committed_starter_emits_report_shape() -> None:
    report = _report("--ir-dir", str(STARTER))
    _assert_report_shape(report)
    assert report["scenario_id"] == "the-haunting"
    assert report["progressive"] is False


def test_ir_dir_on_progressive_campaign_scenario_reports_progressive() -> None:
    # The carrier that has no module-graph.json at all: a graph-only entry
    # point would exclude exactly these imports.
    assert not (PROGRESSIVE / "module-graph.json").exists()
    report = _report("--ir-dir", str(PROGRESSIVE))
    _assert_report_shape(report)
    assert report["progressive"] is True


def test_graph_carrier_reaches_the_same_report_shape() -> None:
    report = _report("--graph", str(STARTER / "module-graph.json"))
    _assert_report_shape(report)


def test_lint_exit_code_is_zero_even_when_findings_exist() -> None:
    # Spec section 7: the lint is a report, not a gate. It must not block
    # installation, campaign creation, or play, and section 11 forbids an
    # early-slice report from labelling findings as defects. A nonzero exit
    # for a module that merely has a finding would make it a gate anyway.
    result = _run("lint", "--ir-dir", str(STARTER))
    report = json.loads(result.stdout)
    assert report["findings"], "starter is expected to carry at least one finding"
    assert result.returncode == 0


def test_both_ir_dir_and_graph_is_a_usage_error_not_a_traceback() -> None:
    result = _run(
        "lint", "--ir-dir", str(STARTER),
        "--graph", str(STARTER / "module-graph.json"),
    )
    assert result.returncode == 2
    assert "Traceback" not in result.stderr
    assert "not allowed with" in result.stderr


def test_neither_ir_dir_nor_graph_is_a_usage_error_not_a_traceback() -> None:
    result = _run("lint")
    assert result.returncode == 2
    assert "Traceback" not in result.stderr
    assert "--ir-dir" in result.stderr


def test_nonexistent_ir_dir_is_a_clean_error_not_a_traceback(tmp_path: Path) -> None:
    missing = tmp_path / "no-such-scenario"
    result = _run("lint", "--ir-dir", str(missing))
    assert result.returncode == 1
    assert "Traceback" not in result.stderr
    assert "error" in json.loads(result.stdout)


@pytest.mark.parametrize(
    "verb",
    [
        "install",
        "audit",
        "validate",
        "project",
        "parity",
        "prepare-packet",
        "validate-records",
        "attach",
    ],
)
def test_existing_verbs_still_parse(verb: str) -> None:
    projection = _load("coc_module_projection_lint_cli", PROJECTION_CLI)
    subparsers = [
        action for action in projection.build_parser()._subparsers._group_actions
    ]
    assert subparsers, "parser lost its subcommands"
    assert verb in subparsers[0].choices
    assert "lint" in subparsers[0].choices
