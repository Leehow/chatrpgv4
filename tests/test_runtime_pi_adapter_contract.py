"""A30 contracts: Pi is a bounded narrator, never a live-turn rules proxy."""
from __future__ import annotations

import importlib.util
import json
import stat
from pathlib import Path

import pytest


REPO = Path(__file__).resolve().parents[1]
PI_DIR = REPO / "runtime" / "adapters" / "pi"
ADAPTER_PATH = PI_DIR / "adapter.py"
RUN_TURN = PI_DIR / "run_turn.mjs"


def _load_adapter():
    spec = importlib.util.spec_from_file_location("runtime_pi_adapter", ADAPTER_PATH)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def _request() -> dict:
    return {
        "narration_envelope": {
            "decision_id": "turn-001",
            "approved_reveals": {"must_include": ["门框上有新划痕"]},
            "keeper_secrets": ["must never reach the model"],
            "rationale": "planner internal",
        },
        "last_player_text": "我检查门框。",
        "play_language": "zh-Hans",
        "recent_narrations": [],
    }


def _write_safe_narrator(path: Path) -> None:
    path.write_text(
        """#!/usr/bin/env python3
import json, sys
request = json.loads(sys.stdin.read())
assert 'workspace' not in request
assert 'campaign_id' not in request
env = request['narration_envelope']
assert 'keeper_secrets' not in env
assert 'rationale' not in env
print(json.dumps({'ok': True, 'final_text': '门框的木屑仍带着潮气。'}))
""",
        encoding="utf-8",
    )
    path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def test_pi_narrate_accepts_only_sanitized_narration_envelope(tmp_path):
    adapter = _load_adapter()
    runner = tmp_path / "safe_narrator"
    _write_safe_narrator(runner)

    result = adapter.pi_narrate(_request(), runner_path=runner)

    assert result["final_text"].startswith("门框")


def test_pi_send_turn_is_removed_instead_of_proxying_debug():
    with pytest.raises(RuntimeError, match="narrator-only"):
        _load_adapter().pi_send_turn({"player_text": "我尝试开门。"})


def test_pi_runner_is_narrator_wrapper_with_jsonl_server_and_no_debug_proxy():
    source = RUN_TURN.read_text(encoding="utf-8")
    assert "runNarration" in source
    assert "--server" in source
    assert "call_debug" not in source
    assert "debug_send_turn" not in source
    assert "coc_live_turn" not in source
