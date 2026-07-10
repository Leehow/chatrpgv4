"""Contract tests for the player-brain adapter (Python wrapper + fake runners)."""
from __future__ import annotations

import importlib.util
import json
import stat
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
PLAYER_DIR = REPO / "runtime" / "adapters" / "player"
ADAPTER_PATH = PLAYER_DIR / "adapter.py"


def _load_adapter():
    spec = importlib.util.spec_from_file_location("runtime_player_adapter", ADAPTER_PATH)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def _sample_request() -> dict:
    return {
        "public_state": {
            "schema_version": 1,
            "campaign_id": "live",
            "active_scene_id": "scene-1",
            "turn_number": 0,
            "discovered_clue_ids": [],
            "investigators": [],
            "pending_choice": None,
        },
        "narration": "雨还在下，门廊上有新鲜脚印。",
        "character_card": {
            "id": "inv1",
            "occupation": "Antiquarian",
            "skills": {"Spot Hidden": 60},
        },
        "transcript_tail": [
            {"role": "keeper", "text": "你站在门廊前。"},
        ],
        "pending_choice": None,
    }


def _write_fake_runner(path: Path, *, stdout: str, exit_code: int = 0) -> None:
    script = f"""#!/usr/bin/env python3
import sys
sys.stdout.write({stdout!r})
sys.exit({exit_code})
"""
    path.write_text(script, encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def _write_echo_runner(path: Path) -> None:
    """Fake runner that returns a fixed player_text and echoes request size."""
    script = """#!/usr/bin/env python3
import json, sys
req = json.loads(sys.stdin.read())
assert "public_state" in req
assert "narration" in req
assert "character_card" in req
out = {
    "ok": True,
    "player_text": "我仔细检查门廊上的脚印。",
    "player_notes": "脚印可能通向侧门。",
}
sys.stdout.write(json.dumps(out, ensure_ascii=False) + "\\n")
"""
    path.write_text(script, encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def test_parse_runner_response_requires_ok_and_player_text():
    adapter = _load_adapter()
    parsed = adapter.parse_runner_response(
        {"ok": True, "player_text": "我环顾四周。", "player_notes": "先观察。"}
    )
    assert parsed["player_text"] == "我环顾四周。"
    assert parsed["player_notes"] == "先观察。"


def test_parse_runner_response_rejects_ok_false():
    adapter = _load_adapter()
    with pytest.raises(RuntimeError, match="model unavailable"):
        adapter.parse_runner_response({"ok": False, "error": "model unavailable"})


def test_parse_runner_response_rejects_missing_player_text():
    adapter = _load_adapter()
    with pytest.raises(RuntimeError, match="player_text"):
        adapter.parse_runner_response({"ok": True})


def test_parse_runner_response_rejects_non_string_player_text():
    adapter = _load_adapter()
    with pytest.raises(RuntimeError, match="player_text"):
        adapter.parse_runner_response({"ok": True, "player_text": 42})


def test_parse_runner_response_accepts_valid_intent_class():
    adapter = _load_adapter()
    parsed = adapter.parse_runner_response(
        {
            "ok": True,
            "player_text": "我仔细搜查现场。",
            "intent_class": "investigate",
        }
    )
    assert parsed["intent_class"] == "investigate"


def test_parse_runner_response_rejects_invalid_intent_class():
    adapter = _load_adapter()
    with pytest.raises(RuntimeError, match="intent_class"):
        adapter.parse_runner_response(
            {
                "ok": True,
                "player_text": "我仔细搜查现场。",
                "intent_class": "flirting",
            }
        )


def test_player_send_turn_round_trip_with_fake_runner(tmp_path):
    adapter = _load_adapter()
    runner = tmp_path / "fake_player_runner"
    _write_echo_runner(runner)

    result = adapter.player_send_turn(_sample_request(), runner_path=runner)
    assert result["player_text"] == "我仔细检查门廊上的脚印。"
    assert result["player_notes"] == "脚印可能通向侧门。"


def test_player_send_turn_requires_request_keys(tmp_path):
    adapter = _load_adapter()
    runner = tmp_path / "fake_player_runner"
    _write_echo_runner(runner)
    with pytest.raises(ValueError, match="public_state"):
        adapter.player_send_turn({"narration": "x"}, runner_path=runner)


def test_player_send_turn_raises_on_nonzero_exit(tmp_path):
    adapter = _load_adapter()
    runner = tmp_path / "fake_fail"
    _write_fake_runner(runner, stdout='{"ok": false, "error": "boom"}\n', exit_code=1)
    with pytest.raises(RuntimeError):
        adapter.player_send_turn(_sample_request(), runner_path=runner)


def test_player_send_turn_raises_on_ok_false_even_with_zero_exit(tmp_path):
    adapter = _load_adapter()
    runner = tmp_path / "fake_ok_false"
    _write_fake_runner(
        runner,
        stdout='{"ok": false, "error": "model unavailable"}\n',
        exit_code=0,
    )
    with pytest.raises(RuntimeError, match="model unavailable"):
        adapter.player_send_turn(_sample_request(), runner_path=runner)


def test_player_request_schema_documents_required_keys():
    adapter = _load_adapter()
    assert set(adapter.PLAYER_REQUEST_KEYS) == {
        "public_state",
        "narration",
        "character_card",
        "transcript_tail",
        "pending_choice",
    }
