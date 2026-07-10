"""Tests for atomic JSON/text persistence helpers (coc_fileio)."""
from __future__ import annotations

import importlib.util
import json
import os
import time
from pathlib import Path

import pytest

SCRIPT = (
    Path(__file__).resolve().parents[1]
    / "plugins"
    / "coc-keeper"
    / "scripts"
    / "coc_fileio.py"
)


def _load_fileio():
    spec = importlib.util.spec_from_file_location("coc_fileio", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def fileio():
    return _load_fileio()


def test_write_json_atomic_matches_plain_dumps(tmp_path, fileio):
    payload = {"name": "调查员", "n": 1, "nested": {"ok": True}}
    expected = json.dumps(payload, ensure_ascii=False, indent=2)

    target = tmp_path / "save" / "state.json"
    fileio.write_json_atomic(target, payload, indent=2, ensure_ascii=False, trailing_newline=False)

    assert target.read_text(encoding="utf-8") == expected


def test_write_json_atomic_trailing_newline_flag(tmp_path, fileio):
    payload = {"a": 1}
    target = tmp_path / "with-nl.json"
    fileio.write_json_atomic(target, payload, trailing_newline=True)
    text = target.read_text(encoding="utf-8")
    assert text.endswith("\n")
    assert text == json.dumps(payload, ensure_ascii=False, indent=2) + "\n"

    target2 = tmp_path / "no-nl.json"
    fileio.write_json_atomic(target2, payload, trailing_newline=False)
    text2 = target2.read_text(encoding="utf-8")
    assert not text2.endswith("\n")
    assert text2 == json.dumps(payload, ensure_ascii=False, indent=2)


def test_replace_failure_leaves_original_intact(tmp_path, fileio, monkeypatch):
    target = tmp_path / "campaign.json"
    original = {"version": 1, "safe": True}
    target.write_text(json.dumps(original, ensure_ascii=False, indent=2), encoding="utf-8")
    before = target.read_text(encoding="utf-8")

    def boom(src, dst):
        raise OSError("simulated crash during replace")

    monkeypatch.setattr(os, "replace", boom)

    with pytest.raises(OSError, match="simulated crash"):
        fileio.write_json_atomic(
            target,
            {"version": 2, "safe": False, "truncated": "x" * 100},
            trailing_newline=False,
        )

    assert target.read_text(encoding="utf-8") == before
    assert json.loads(before) == original


def test_campaign_lock_exclusive(tmp_path, fileio):
    campaign_dir = tmp_path / "campaigns" / "c1"
    campaign_dir.mkdir(parents=True)

    with fileio.campaign_lock(campaign_dir, stale_minutes=30):
        lock_path = campaign_dir / ".campaign.lock"
        assert lock_path.exists()
        with pytest.raises(fileio.CampaignLockError, match="held"):
            with fileio.campaign_lock(campaign_dir, stale_minutes=30):
                pass

    assert not (campaign_dir / ".campaign.lock").exists()


def test_campaign_lock_clears_stale_dead_pid(tmp_path, fileio, monkeypatch):
    campaign_dir = tmp_path / "campaigns" / "c1"
    campaign_dir.mkdir(parents=True)
    lock_path = campaign_dir / ".campaign.lock"
    # PID 2^31-1 is almost certainly not alive on this host.
    dead_pid = 2_147_483_647
    lock_path.write_text(
        json.dumps({"pid": dead_pid, "acquired_at": time.time() - 10}),
        encoding="utf-8",
    )

    with fileio.campaign_lock(campaign_dir, stale_minutes=30):
        payload = json.loads(lock_path.read_text(encoding="utf-8"))
        assert payload["pid"] == os.getpid()


def test_campaign_lock_clears_stale_by_age(tmp_path, fileio, monkeypatch):
    campaign_dir = tmp_path / "campaigns" / "c1"
    campaign_dir.mkdir(parents=True)
    lock_path = campaign_dir / ".campaign.lock"
    lock_path.write_text(
        json.dumps({"pid": os.getpid(), "acquired_at": time.time() - 3600}),
        encoding="utf-8",
    )

    with fileio.campaign_lock(campaign_dir, stale_minutes=1):
        payload = json.loads(lock_path.read_text(encoding="utf-8"))
        assert payload["pid"] == os.getpid()
        assert payload["acquired_at"] > time.time() - 60
