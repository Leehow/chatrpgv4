"""Regression tests for the opening-review transport workspace guard.

The guard in coc-pdf-skill-adapter.py originally required
workspace == cwd == code root (the TUI single-root layout). Web/desktop
hosts keep a bare campaign workspace separate from the code surface, which
made the opening source review fail closed with "workspace drift" on every
PDF campaign. The guard now proves state identity (campaign anchor inside
the workspace) and code identity (self-derived from PLUGIN_ROOT)
independently. These tests pin that split-layout contract.
"""
from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
ADAPTER_PATH = (
    ROOT / "plugins" / "coc-keeper" / "pi" / "bin" / "coc-pdf-skill-adapter.py"
)

spec = importlib.util.spec_from_file_location("coc_pdf_skill_adapter", ADAPTER_PATH)
assert spec is not None and spec.loader is not None
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)

CAMPAIGN_ID = "pdf-guard-test"


def _task(workspace: Path) -> dict:
    return {
        "schema_version": 1,
        "contract_id": "coc.pi-opening-source-review-transport.v1",
        "workspace_root": str(workspace),
        "campaign_id": CAMPAIGN_ID,
        "scenario_id": "sc-guard-1",
        "opening_review_generation": 1,
        "transport_timeout_seconds": 60,
    }


def _make_campaign_anchor(workspace: Path) -> None:
    scenario = (
        workspace
        / ".coc"
        / "campaigns"
        / CAMPAIGN_ID
        / "scenario"
        / "scenario.json"
    )
    scenario.parent.mkdir(parents=True)
    scenario.write_text("{}", encoding="utf-8")


def test_split_layout_workspace_passes_from_any_cwd(tmp_path, monkeypatch):
    """A bare workspace (no uv.lock/plugins) passes when it holds the
    campaign anchor — and the inherited cwd is irrelevant (bridge layout:
    the pi host runs with cwd=workspace, the code lives elsewhere)."""
    workspace = tmp_path / "bare-workspace"
    _make_campaign_anchor(workspace)
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    monkeypatch.chdir(elsewhere)
    task = adapter._validate_opening_review_transport(_task(workspace))
    assert task["campaign_id"] == CAMPAIGN_ID


def test_workspace_without_campaign_anchor_fails_closed(tmp_path, monkeypatch):
    workspace = tmp_path / "empty-workspace"
    workspace.mkdir()
    monkeypatch.chdir(workspace)
    with pytest.raises(RuntimeError, match="workspace drift"):
        adapter._validate_opening_review_transport(_task(workspace))


def test_missing_workspace_dir_fails_closed(tmp_path):
    with pytest.raises(RuntimeError, match="workspace drift"):
        adapter._validate_opening_review_transport(_task(tmp_path / "ghost"))


def test_non_absolute_workspace_rejected(tmp_path):
    task = _task(tmp_path)
    task["workspace_root"] = "relative/path"
    with pytest.raises(RuntimeError, match="identity invalid"):
        adapter._validate_opening_review_transport(task)


# ---------------------------------------------------------------------------
# Extractor stdout parser: real text-model children reliably prepend a short
# status preamble before the fenced JSON despite the strict-output prompt;
# the parser must lift exactly one fenced payload out of that prose while
# staying fail-closed on ambiguity.
# ---------------------------------------------------------------------------

VALID_JSON = '{"schema_version": 1, "status": "reviewed"}'


def test_parser_accepts_bare_json():
    assert adapter._parse_opening_extractor_stdout(VALID_JSON) == {
        "schema_version": 1,
        "status": "reviewed",
    }


def test_parser_accepts_whole_output_fence():
    assert adapter._parse_opening_extractor_stdout(
        f"```json\n{VALID_JSON}\n```"
    )["status"] == "reviewed"


def test_parser_accepts_prose_around_single_fence():
    stdout = (
        "Good — all three pages are read and anchors confirmed. "
        "Now producing the final JSON.\n\n"
        f"```json\n{VALID_JSON}\n```\n"
    )
    assert adapter._parse_opening_extractor_stdout(stdout)["status"] == "reviewed"


def test_parser_rejects_ambiguous_double_fence():
    stdout = f"```json\n{VALID_JSON}\n```\nsome note\n```\nextra\n```\n"
    assert adapter._parse_opening_extractor_stdout(stdout) is None


def test_parser_rejects_fenced_non_json_and_plain_prose():
    assert adapter._parse_opening_extractor_stdout("```\nnot json\n```\n") is None
    assert adapter._parse_opening_extractor_stdout("just prose, no payload") is None


def test_parser_rejects_unterminated_fence_and_non_object_json():
    assert adapter._parse_opening_extractor_stdout(f"```json\n{VALID_JSON}\n") is None
    assert adapter._parse_opening_extractor_stdout('```json\n[1, 2]\n```\n') is None
