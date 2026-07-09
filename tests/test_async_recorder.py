"""Tests for the CoC async recorder: pending-stuck detection + flush reliability.

These cover P2-6 (conservative): a health check that flags pending JSONL batches
that are too old or too numerous, plus a flush-attempt audit marker. The runner
side (maintenance forced-flush) is exercised in test_live_turn_runner.py.
"""
import importlib.util
import json
import os
import time
from pathlib import Path


def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, rel)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


recorder = _load("coc_async_recorder", "plugins/coc-keeper/scripts/coc_async_recorder.py")


def _make_pending_batch(campaign_dir: Path, *, name: str, mtime: float | None = None) -> Path:
    """Write a minimal pending batch file under logs/pending-turns."""
    pending_dir = campaign_dir / "logs" / "pending-turns"
    pending_dir.mkdir(parents=True, exist_ok=True)
    path = pending_dir / name
    payload = {
        "schema_version": 1,
        "recording_mode": "fast",
        "created_at": "2025-01-01T00:00:00Z",
        "decision_id": "turn-001",
        "entries": [
            {
                "relative_path": "logs/events.jsonl",
                "record": {"schema_version": 1, "event_type": "test"},
            }
        ],
    }
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    if mtime is not None:
        os.utime(path, (mtime, mtime))
    return path


def test_pending_stuck_check_clean_when_no_batches(tmp_path):
    campaign = tmp_path / "camp"
    campaign.mkdir()
    result = recorder.pending_stuck_check(campaign, max_age_seconds=30, max_count=50)
    assert result["stuck"] is False
    assert result["pending_count"] == 0
    assert result["oldest_age_seconds"] is None
    assert result["reasons"] == []


def test_pending_stuck_check_clean_when_recent_and_few(tmp_path):
    campaign = tmp_path / "camp"
    campaign.mkdir()
    now = time.time()
    _make_pending_batch(campaign, name="recent-1.json", mtime=now)
    _make_pending_batch(campaign, name="recent-2.json", mtime=now)

    result = recorder.pending_stuck_check(campaign, max_age_seconds=30, max_count=50)
    assert result["stuck"] is False
    assert result["pending_count"] == 2
    assert isinstance(result["oldest_age_seconds"], float)
    assert result["oldest_age_seconds"] < 30
    assert result["reasons"] == []


def test_pending_stuck_check_detects_old_batch(tmp_path):
    campaign = tmp_path / "camp"
    campaign.mkdir()
    now = time.time()
    old_mtime = now - 120  # 2 minutes old — past a 30s threshold
    _make_pending_batch(campaign, name="stale-1.json", mtime=old_mtime)

    result = recorder.pending_stuck_check(campaign, max_age_seconds=30, max_count=50)
    assert result["stuck"] is True
    assert result["pending_count"] == 1
    assert isinstance(result["oldest_age_seconds"], float)
    assert result["oldest_age_seconds"] >= 120
    assert "max_age_exceeded" in result["reasons"]


def test_pending_stuck_check_detects_too_numerous(tmp_path):
    campaign = tmp_path / "camp"
    campaign.mkdir()
    now = time.time()
    for i in range(60):  # exceeds a max_count of 50
        _make_pending_batch(campaign, name=f"batch-{i:03d}.json", mtime=now)

    result = recorder.pending_stuck_check(campaign, max_age_seconds=30, max_count=50)
    assert result["stuck"] is True
    assert result["pending_count"] == 60
    assert result["pending_count"] > result["max_count"]
    assert "max_count_exceeded" in result["reasons"]
    # All batches are fresh, so age should NOT be a reason.
    assert "max_age_exceeded" not in result["reasons"]


def test_pending_stuck_check_default_thresholds(tmp_path):
    """Calling without explicit thresholds must use sensible defaults."""
    campaign = tmp_path / "camp"
    campaign.mkdir()
    now = time.time()
    _make_pending_batch(campaign, name="fresh.json", mtime=now)
    result = recorder.pending_stuck_check(campaign)
    assert result["stuck"] is False
    assert result["max_age_seconds"] == 30
    assert result["max_count"] == 50


def test_pending_stuck_check_missing_pending_dir(tmp_path):
    campaign = tmp_path / "camp"
    campaign.mkdir()  # no logs/pending-turns at all
    result = recorder.pending_stuck_check(campaign, max_age_seconds=30, max_count=50)
    assert result["stuck"] is False
    assert result["pending_count"] == 0
    assert result["oldest_age_seconds"] is None


def test_spawn_background_flush_writes_flush_attempts_marker(tmp_path, monkeypatch):
    """spawn_background_flush must record an audit marker in logs/flush-attempts.jsonl."""
    campaign = tmp_path / "camp"
    campaign.mkdir()

    captured = {}

    class FakeProc:
        pid = 9999

    def fake_popen(args, **kwargs):
        captured["args"] = args
        return FakeProc()

    monkeypatch.setattr(recorder.subprocess, "Popen", fake_popen)
    # Bump pending_before by writing one batch.
    _make_pending_batch(campaign, name="pre.json", mtime=time.time())

    result = recorder.spawn_background_flush(campaign)
    assert result["started"] is True
    assert result["pid"] == 9999

    marker_path = campaign / "logs" / "flush-attempts.jsonl"
    assert marker_path.is_file()
    lines = [json.loads(line) for line in marker_path.read_text().splitlines() if line.strip()]
    assert lines, "flush-attempts.jsonl must contain at least one marker"
    marker = lines[-1]
    assert marker["pid"] == 9999
    assert marker["pending_before"] == 1
    assert "ts" in marker
    assert "campaign_dir" in marker
