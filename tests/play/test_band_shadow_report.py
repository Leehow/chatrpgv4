"""Tests for tests/play/band_shadow_report.py (contract §138.8, BR-04).

Synthetic `lane: "band-shadow"` rows in the shapes the kernel extension writes (answered, answered on the `unknown`
exit, failed, never asked) stand in for real tables, so the counting rules are pinned without live playtest data.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

import band_shadow_report as shadow


def write_telemetry(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n", encoding="utf-8")


def answered(kind, band, inside, confidence, ms, *, keeper=None):
    table = "time-costs" if kind == "time" else "hazards"
    return {"lane": "band-shadow", "turn": 1, "call_id": "t1-c1", "index": 0, "kind": kind, "table": table,
            "keeper_value": keeper, "ok": True, "band": band, "range": None, "inside": inside, "confidence": confidence,
            "distribution": {band or "unknown": confidence}, "gate": 0.5, "ms": ms, "jev_calls": 1,
            **({"reason": "unknown"} if band is None else {})}


def failed(kind, reason, ms, calls=1):
    table = "time-costs" if kind == "time" else "hazards"
    return {"lane": "band-shadow", "turn": 2, "call_id": "t2-c1", "index": 0, "kind": kind, "table": table, "keeper_value": 5,
            "ok": False, "reason": reason, "band": None, "range": None, "inside": None, "confidence": None, "distribution": None,
            "gate": 0.5, "ms": ms, "jev_calls": calls}


def skipped(kind, why):
    """A deliberate skip (no key, no declaration): the project's `ok: true, skipped` convention, not a failure."""
    return {"lane": "band-shadow", "turn": 3, "call_id": "t3-c1", "index": 0, "kind": kind, "ok": True, "skipped": why}


def unasked(kind, reason):
    """A question that could not be asked (the kernel could not list the rows): a failure with its reason."""
    return {"lane": "band-shadow", "turn": 3, "call_id": "t3-c1", "index": 0, "kind": kind, "ok": False, "reason": reason}


CAMPAIGN_A = [
    {"turn": 1, "tool": "apply", "call_id": "t1-c1", "started_at": "x", "ms": 5, "ok": True},
    answered("time", "single_room_search", True, 0.72, 300, keeper=20),
    answered("time", "single_room_search", False, 0.55, 250, keeper=240),
    answered("time", "library_research", True, 0.81, 350, keeper=90),
    answered("time", None, None, 0.6, 200, keeper=10),
    failed("time", "timeout", 4000),
    skipped("time", "unconfigured"),
    # Another lane's rows are not the shadow's.
    {"lane": "band-recovery", "turn": 1, "ok": False, "reason": "unconfigured"},
]
CAMPAIGN_B = [
    answered("time", "quick_observation", True, 0.45, 100, keeper=1),
    skipped("time", "no_declaration"),
    unasked("time", "rows_unavailable"),
    answered("damage", "moderate", True, 0.62, 150, keeper="1D6"),
    answered("damage", "severe", False, 0.3, 150, keeper="1D3"),
    failed("damage", "schema_error", 2, calls=0),
]
TIME_EXPECTED = {
    "table": "time-costs",
    "rows": 9,
    "unasked": {"no_declaration": 1, "rows_unavailable": 1, "unconfigured": 1},
    "failed": {"timeout": 1},
    "answered": 5,
    "banded": 4,
    "unknown": 1,
    "hits": 3,
    "hit_rate": 0.75,
    "gates": {
        "0.5": {"at_or_above": 3, "rate": 0.6, "hit_rate": 0.667},
        "0.6": {"at_or_above": 2, "rate": 0.4, "hit_rate": 1.0},
        "0.7": {"at_or_above": 2, "rate": 0.4, "hit_rate": 1.0},
        "0.8": {"at_or_above": 1, "rate": 0.2, "hit_rate": 1.0},
    },
    # Six rows spent a call (the timeout too): 300 + 250 + 350 + 200 + 4000 + 100 ms.
    "jev_seconds": {"calls": 6, "mean": 0.867, "total": 5.2},
    "bands": {"single_room_search": 2, "library_research": 1, "quick_observation": 1},
}
DAMAGE_EXPECTED = {
    "table": "hazards",
    "rows": 3,
    "unasked": {},
    "failed": {"schema_error": 1},
    "answered": 2,
    "banded": 2,
    "unknown": 0,
    "hits": 1,
    "hit_rate": 0.5,
    "gates": {
        "0.5": {"at_or_above": 1, "rate": 0.5, "hit_rate": 1.0},
        "0.6": {"at_or_above": 1, "rate": 0.5, "hit_rate": 1.0},
        "0.7": {"at_or_above": 0, "rate": 0.0, "hit_rate": None},
        "0.8": {"at_or_above": 0, "rate": 0.0, "hit_rate": None},
    },
    # A packing refusal spent no call and no Jev time.
    "jev_seconds": {"calls": 2, "mean": 0.15, "total": 0.3},
    "bands": {"moderate": 1, "severe": 1},
}


@pytest.fixture
def workspace(tmp_path: Path) -> Path:
    write_telemetry(shadow.telemetry_path(str(tmp_path), "a"), CAMPAIGN_A)
    write_telemetry(shadow.telemetry_path(str(tmp_path), "b"), CAMPAIGN_B)
    return tmp_path


def test_the_numbers_per_kind_over_two_campaigns(workspace: Path):
    rows = shadow.load_rows([shadow.telemetry_path(str(workspace), "a"), shadow.telemetry_path(str(workspace), "b")])
    assert len(rows) == 12
    result = shadow.report(rows)
    assert list(result) == ["time", "damage"]
    assert result["time"] == TIME_EXPECTED
    assert result["damage"] == DAMAGE_EXPECTED


def test_one_campaign_alone_and_a_kind_with_no_rows_is_absent(workspace: Path):
    result = shadow.report(shadow.load_rows([shadow.telemetry_path(str(workspace), "a")]))
    assert list(result) == ["time"]
    assert result["time"]["rows"] == 6
    assert result["time"]["hit_rate"] == round(2 / 3, 3)
    assert shadow.report([]) == {}


def test_main_reads_campaigns_all_and_files_the_same_way(workspace: Path, capsys):
    assert shadow.main(["--campaign", "a", "--campaign", "b", "--workspace", str(workspace), "--json"]) == 0
    by_campaign = json.loads(capsys.readouterr().out)
    assert by_campaign["kinds"] == {"time": TIME_EXPECTED, "damage": DAMAGE_EXPECTED}
    assert shadow.main(["--all", "--workspace", str(workspace), "--json"]) == 0
    assert json.loads(capsys.readouterr().out)["kinds"] == by_campaign["kinds"]
    files = [str(shadow.telemetry_path(str(workspace), name)) for name in ("a", "b")]
    assert shadow.main([*files, "--json"]) == 0
    assert json.loads(capsys.readouterr().out)["kinds"] == by_campaign["kinds"]


def test_the_text_report_states_each_number(workspace: Path, capsys):
    assert shadow.main(["--campaign", "a", "--campaign", "b", "--workspace", str(workspace)]) == 0
    text = capsys.readouterr().out
    assert "=== band shadow: a, b ===" in text
    assert "--- time (time-costs) ---" in text
    assert "hit rate (Keeper's number inside the argmax band): 3/4 = 0.75" in text
    assert "gate 0.5: at or above 3 (rate 0.6 of answered), hit rate 0.667" in text
    assert "jev seconds: 6 calls, mean 0.867, total 5.2" in text
    assert "--- damage (hazards) ---" in text
    assert 'failed: {"schema_error": 1}' in text


def test_a_missing_campaign_is_an_error_not_an_empty_report(tmp_path: Path):
    with pytest.raises(FileNotFoundError):
        shadow.main(["--campaign", "nowhere", "--workspace", str(tmp_path)])
