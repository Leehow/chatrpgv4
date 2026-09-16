"""Tests for tests/play/kpi.py (contract §13.8's read-before-write KPI).

A small synthetic telemetry.jsonl stands in for a real campaign so the
counting rules are pinned down without depending on any live playtest data.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

import kpi

KPI_SCRIPT = Path(__file__).resolve().parent / "kpi.py"


def write_telemetry(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n", encoding="utf-8")


def row(turn, tool, *, call_id=None, ok=True, code=None, ms=1):
    r = {"turn": turn, "tool": tool, "call_id": call_id, "started_at": "2026-01-01T00:00:00.000Z", "ms": ms, "ok": ok}
    if code is not None:
        r["code"] = code
    return r


SYNTHETIC_ROWS = [
    # turn 0: opening, no player_input yet -- a narrate straight away, no reads.
    row(0, "narrate", call_id="t0-c1"),
    {"turn": 0, "tool": "narrate", "event": "turn-closed", "round_trips": 1, "ok": True},

    # turn 1: two reads, then a successful apply -- the harness's own
    # table.player_input call must not be mistaken for a keeper tool call.
    {"turn": 1, "tool": "table.player_input", "started_at": "x", "ms": 1, "ok": True},
    row(1, "look"),
    row(1, "lookup"),
    row(1, "apply", call_id="t1-c1"),
    row(1, "narrate", call_id="t1-c2"),
    {"turn": 1, "tool": "narrate", "event": "turn-closed", "round_trips": 3, "ok": True},

    # turn 2: a resolve fails (needs), keeper reads once more, then a
    # *successful* resolve reaches the rules layer -- the failed resolve must
    # not count as the write that ends the read tally, and must not itself
    # count as a read.
    {"turn": 2, "tool": "table.player_input", "started_at": "x", "ms": 1, "ok": True},
    row(2, "look"),
    row(2, "resolve", call_id="t2-c1", ok=False, code="needs"),
    row(2, "recall"),
    row(2, "resolve", call_id="t2-c2"),
    row(2, "apply", call_id="t2-c3"),
    row(2, "narrate", call_id="t2-c4"),
    {"turn": 2, "tool": "narrate", "event": "turn-closed", "round_trips": 4, "ok": True},
    # a memory/verifier lane row for turn 2 -- must never be counted as a tool call.
    {"lane": "verifier", "turn": 2, "ok": True, "findings": 0},

    # turn 3: no reads at all before an immediate successful apply; no resolve
    # this turn, so it must not count toward reached_rules_layer.
    {"turn": 3, "tool": "table.player_input", "started_at": "x", "ms": 1, "ok": True},
    row(3, "apply", call_id="t3-c1"),
    row(3, "narrate", call_id="t3-c2"),
    {"turn": 3, "tool": "narrate", "event": "turn-closed", "round_trips": 2, "ok": True},
]


@pytest.fixture
def workspace(tmp_path: Path) -> Path:
    write_telemetry(tmp_path / "campaigns" / "synth" / "telemetry.jsonl", SYNTHETIC_ROWS)
    return tmp_path


def test_reads_before_write_skips_over_failed_write_attempts(workspace):
    rows = kpi.load_rows(kpi.telemetry_path(str(workspace), "synth"))
    per_turn = kpi.compute(rows)
    assert per_turn[0]["reads_before_write"] == 0
    assert per_turn[1]["reads_before_write"] == 2
    # turn 2: look, then a failed resolve (skipped, doesn't stop the count),
    # then recall, then the successful resolve stops it: 2 reads total.
    assert per_turn[2]["reads_before_write"] == 2
    assert per_turn[3]["reads_before_write"] == 0


def test_harness_player_input_is_not_a_tool_call(workspace):
    rows = kpi.load_rows(kpi.telemetry_path(str(workspace), "synth"))
    per_turn = kpi.compute(rows)
    # table.player_input rows exist for turns 1-3 but must not inflate total_calls.
    assert per_turn[1]["total_calls"] == 4  # look, lookup, apply, narrate
    assert per_turn[2]["total_calls"] == 6  # look, resolve(fail), recall, resolve, apply, narrate
    assert per_turn[3]["total_calls"] == 2  # apply, narrate


def test_event_and_lane_rows_are_excluded(workspace):
    rows = kpi.load_rows(kpi.telemetry_path(str(workspace), "synth"))
    per_turn = kpi.compute(rows)
    # turn-closed event rows and the verifier lane row on turn 2 must not appear
    # as calls: turn 2 has 6 real tool-call rows (look, resolve x2, recall, apply, narrate).
    assert per_turn[2]["total_calls"] == 6


def test_kernel_errors_and_rules_layer(workspace):
    rows = kpi.load_rows(kpi.telemetry_path(str(workspace), "synth"))
    per_turn = kpi.compute(rows)
    assert per_turn[2]["kernel_errors"] == 1
    assert per_turn[2]["reached_rules_layer"] is True   # the second, successful resolve
    assert per_turn[3]["reached_rules_layer"] is False  # no resolve at all this turn
    assert per_turn[0]["kernel_errors"] == 0


def test_turns_filter_is_inclusive(workspace):
    rows = kpi.load_rows(kpi.telemetry_path(str(workspace), "synth"))
    per_turn = kpi.compute(rows, (1, 2))
    assert set(per_turn) == {1, 2}


def test_summarize_is_deterministic_and_matches_by_hand(workspace):
    rows = kpi.load_rows(kpi.telemetry_path(str(workspace), "synth"))
    per_turn = kpi.compute(rows)
    summary = kpi.summarize(per_turn)
    assert summary["turns"] == 4
    reads = [0, 2, 2, 0]
    assert summary["reads_before_write_median"] == 1.0
    assert summary["reads_before_write_mean"] == pytest.approx(1.0)
    assert summary["reads_before_write_max"] == 2
    assert summary["reached_rules_layer_turns"] == 1
    assert summary["reached_write_turns"] == 4
    # running it twice must give byte-identical output (deterministic, no wall clock).
    again = kpi.summarize(kpi.compute(rows))
    assert again == summary


def test_cli_runs_end_to_end_and_prints_the_summary(workspace):
    result = subprocess.run(
        [sys.executable, str(KPI_SCRIPT), "--campaign", "synth", "--workspace", str(workspace)],
        capture_output=True, text=True, check=True,
    )
    assert "reads_before_write_median" in result.stdout
    assert "turn   2" in result.stdout or "turn 2" in result.stdout
    # deterministic: running twice gives identical stdout.
    again = subprocess.run(
        [sys.executable, str(KPI_SCRIPT), "--campaign", "synth", "--workspace", str(workspace)],
        capture_output=True, text=True, check=True,
    )
    assert again.stdout == result.stdout


def test_cli_turns_filter(workspace):
    result = subprocess.run(
        [sys.executable, str(KPI_SCRIPT), "--campaign", "synth", "--workspace", str(workspace), "--turns", "1-2"],
        capture_output=True, text=True, check=True,
    )
    assert "turn   0" not in result.stdout
    assert "turns: 2" in result.stdout


def test_cli_requires_campaign_unless_baseline(workspace):
    result = subprocess.run(
        [sys.executable, str(KPI_SCRIPT), "--workspace", str(workspace)],
        capture_output=True, text=True,
    )
    assert result.returncode != 0
    assert "--campaign is required" in result.stderr


def test_cli_missing_telemetry_reports_clearly(tmp_path):
    result = subprocess.run(
        [sys.executable, str(KPI_SCRIPT), "--campaign", "nope", "--workspace", str(tmp_path)],
        capture_output=True, text=True,
    )
    assert result.returncode != 0


def test_baseline_mode_reads_the_real_haunting_s0_campaign():
    """Contract §13.8 names haunting-s0 turns 13-25 explicitly; --baseline must
    read the real repo telemetry (not a fixture) when run from the repo root."""
    repo_root = Path(__file__).resolve().parents[2]
    telemetry = repo_root / ".coc" / "campaigns" / "haunting-s0" / "telemetry.jsonl"
    if not telemetry.exists():
        pytest.skip("no .coc/campaigns/haunting-s0/telemetry.jsonl in this checkout")
    result = subprocess.run(
        [sys.executable, str(KPI_SCRIPT), "--baseline"],
        cwd=str(repo_root), capture_output=True, text=True, check=True,
    )
    assert "baseline: haunting-s0 turns 13-25" in result.stdout
    assert "reads_before_write_median" in result.stdout
    assert "turns: 13" in result.stdout


def test_admission_section_counts_verdicts_reuse_and_unavailability_apart_from_delivery_time():
    """Contract §32.7: the review's own cost and outcomes, never folded into the turn's timing."""
    rows = [
        {"turn": 1, "lane": "admission", "verb": "apply", "ok": True, "verdict": "not_authorized", "admitted": False, "reused": False, "ms": 900, "key": "a"},
        {"turn": 1, "lane": "admission", "verb": "apply", "ok": True, "verdict": "not_authorized", "admitted": False, "reused": True, "ms": 0, "key": "a"},
        {"turn": 2, "lane": "admission", "verb": "resolve", "ok": True, "verdict": "entailed", "admitted": True, "reused": False, "ms": 300, "key": "b"},
        {"turn": 3, "lane": "admission", "verb": "resolve", "ok": False, "reason": "timeout", "ms": 60000, "key": "c"},
        {"turn": 0, "lane": "admission", "verb": "apply", "ok": True, "skipped": "no_player_text", "key": "d"},
        {"turn": 2, "lane": "lane-call", "subsession": "admission", "phase": "end", "ok": True, "ms": 290},
        row(2, "resolve", call_id="t2-c1", ms=5000),
    ]
    section = kpi.admission(rows)
    assert section == {
        "reviews": 2, "reused": 1, "skipped": 1,
        "verdicts": {"entailed": 1, "not_authorized": 2},
        "unavailable": {"timeout": 1},
        "review_ms": {"total": 1200, "max": 900, "mean": 600},
    }
    assert kpi.admission([row(1, "apply", call_id="t1-c1")]) == {}


def test_lane_section_tells_a_lane_that_never_worked_from_one_that_ran_clean():
    """A lane that failed every turn and a lane that never failed read the same way
    everywhere else in this tool, which is how `memory` failed 32 times in one campaign
    with nobody told. A healthy lane is listed with `failed: 0` for exactly that reason:
    silence about a lane must not be the same text as a lane that is fine."""
    rows = [
        {"turn": 0, "lane": "memory", "ok": False, "reason": "lane_error", "detail": "entity 'x' is ambiguous"},
        {"turn": 1, "lane": "memory", "ok": False, "reason": "lane_error", "detail": "entity 'x' is ambiguous"},
        {"turn": 2, "lane": "memory", "ok": False, "reason": "lane_error", "detail": "entity 'x' is ambiguous"},
        {"turn": 0, "lane": "journal", "ok": True, "ms": 12},
        {"turn": 1, "lane": "journal", "ok": True, "ms": 14},
        # A stumble is not an outage: the streak resets, and the worst run is what says so.
        {"turn": 0, "lane": "voice", "ok": False, "reason": "model_error"},
        {"turn": 1, "lane": "voice", "ok": True},
        {"turn": 2, "lane": "voice", "ok": False, "reason": "model_error"},
        # A row with no verdict of its own is a progress note, not an outcome.
        {"turn": 3, "lane": "reading", "event": "concurrency", "job_id": "read-6"},
    ]
    section = kpi.lanes(rows)
    assert section == {
        "journal": {"rows": 2, "failed": 0, "worst_streak": 0},
        "memory": {"rows": 3, "failed": 3, "worst_streak": 3, "reasons": {"lane_error": 3}},
        "voice": {"rows": 3, "failed": 2, "worst_streak": 1, "reasons": {"model_error": 2}},
    }
    assert "reading" not in section
    assert kpi.lanes([row(1, "apply", call_id="t1-c1")]) == {}


def test_a_lane_failure_reaches_the_printed_report(tmp_path):
    """The section is worthless if it stops at the dict: the whole defect was that nobody
    reading a campaign's KPI ever saw these rows."""
    telemetry = tmp_path / "ws" / "campaigns" / "c1" / "telemetry.jsonl"
    telemetry.parent.mkdir(parents=True)
    write_telemetry(telemetry, [
        row(1, "apply", call_id="t1-c1", ok=True),
        {"turn": 1, "lane": "memory", "ok": False, "reason": "lane_error"},
    ])
    result = subprocess.run(
        [sys.executable, str(KPI_SCRIPT), "--workspace", str(tmp_path / "ws"), "--campaign", "c1"],
        capture_output=True, text=True, check=True,
    )
    assert "lanes:" in result.stdout
    assert "memory" in result.stdout
