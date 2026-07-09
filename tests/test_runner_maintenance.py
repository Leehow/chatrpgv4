"""Tests for the live runner's pending-flush maintenance path (P2-6, conservative).

The maintenance path is OUT OF BAND relative to ``run_live_turn``: it is the
place where a stuck pending-queue (old or numerous batches) can be force-flushed
synchronously. It MUST NOT be the per-turn narration path, and
``completion_required_before_narration`` remains False on the live path.

These tests pin the maintenance contract independently of ``run_live_turn``.
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


live_runner = _load("coc_live_turn_runner", "plugins/coc-keeper/scripts/coc_live_turn_runner.py")


def _write_pending_batch(campaign_dir: Path, *, name: str, mtime: float | None = None) -> Path:
    pending_dir = campaign_dir / "logs" / "pending-turns"
    pending_dir.mkdir(parents=True, exist_ok=True)
    # Ensure the target log file exists so flush replay has a file to append to.
    events_log = campaign_dir / "logs" / "events.jsonl"
    events_log.parent.mkdir(parents=True, exist_ok=True)
    if not events_log.exists():
        events_log.write_text("")
    path = pending_dir / name
    payload = {
        "schema_version": 1,
        "recording_mode": "fast",
        "created_at": "2025-01-01T00:00:00Z",
        "decision_id": "turn-001",
        "entries": [
            {
                "relative_path": "logs/events.jsonl",
                "record": {"schema_version": 1, "event_type": "test_event"},
            }
        ],
    }
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    if mtime is not None:
        os.utime(path, (mtime, mtime))
    return path


def test_maintenance_no_op_when_pending_clean(tmp_path):
    campaign = tmp_path / "camp"
    campaign.mkdir()
    # A single fresh batch — not old, not numerous.
    _write_pending_batch(campaign, name="fresh.json", mtime=time.time())

    result = live_runner.run_pending_flush_maintenance(
        campaign, max_age_seconds=30, max_count=50
    )
    assert result["checked"] is True
    assert result["stuck"] is False
    assert result["flushed"] is False
    assert result["flush_result"] is None
    # The fresh batch must still be present (we did not flush).
    assert sorted((campaign / "logs" / "pending-turns").glob("*.json"))


def test_maintenance_forces_sync_flush_when_stale(tmp_path):
    campaign = tmp_path / "camp"
    campaign.mkdir()
    now = time.time()
    stale = now - 120  # 2 min old — well past a 30s threshold
    path = _write_pending_batch(campaign, name="stale.json", mtime=stale)

    result = live_runner.run_pending_flush_maintenance(
        campaign, max_age_seconds=30, max_count=50
    )
    assert result["checked"] is True
    assert result["stuck"] is True
    assert "max_age_exceeded" in result["reasons"]
    assert result["flushed"] is True
    # The synchronous flush must have replayed and removed the batch.
    assert not path.exists()
    flush_result = result["flush_result"]
    assert flush_result["flushed_files"] == 1
    assert flush_result["flushed_entries"] >= 1
    # And the events log now carries the replayed record.
    events = [
        json.loads(line)
        for line in (campaign / "logs" / "events.jsonl").read_text().splitlines()
        if line.strip()
    ]
    assert any(e.get("event_type") == "test_event" for e in events)


def test_maintenance_forces_sync_flush_when_too_numerous(tmp_path):
    campaign = tmp_path / "camp"
    campaign.mkdir()
    now = time.time()
    for i in range(60):  # exceeds max_count=50, all fresh
        _write_pending_batch(campaign, name=f"batch-{i:03d}.json", mtime=now)

    result = live_runner.run_pending_flush_maintenance(
        campaign, max_age_seconds=30, max_count=50
    )
    assert result["stuck"] is True
    assert "max_count_exceeded" in result["reasons"]
    assert result["flushed"] is True
    assert result["flush_result"]["flushed_files"] == 60
    # Pending dir should be emptied.
    assert not sorted((campaign / "logs" / "pending-turns").glob("*.json"))


def test_maintenance_does_not_touch_narration_non_blocking_flag(tmp_path):
    """The maintenance entrypoint must not affect the live turn's non-blocking
    narration guarantee. We assert the live flag is still False after running
    maintenance (maintenance is separate from narration)."""
    campaign = tmp_path / "camp"
    campaign.mkdir()
    live_runner.run_pending_flush_maintenance(campaign, max_age_seconds=30, max_count=50)
    # The constant is hardcoded in run_live_turn's recording contract; verify
    # the helper still reports the non-blocking posture.
    assert live_runner.NARRATION_FLUSH_BLOCKING is False
