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


def test_parse_runner_response_accepts_typed_player_pending_choice_response():
    adapter = _load_adapter()
    response = {
        "choice_id": "push-offer:confirm",
        "responder": "player",
        "revision": 0,
        "action": "cancel",
    }
    parsed = adapter.parse_runner_response({
        "ok": True,
        "player_text": "我不冒这个险。",
        "pending_choice_response": response,
    })
    assert parsed["pending_choice_response"] == response


def test_parse_runner_response_rejects_keeper_pending_choice_response():
    adapter = _load_adapter()
    with pytest.raises(RuntimeError, match="pending_choice_response"):
        adapter.parse_runner_response({
            "ok": True,
            "player_text": "继续。",
            "pending_choice_response": {
                "choice_id": "san:bout",
                "responder": "keeper",
                "revision": 0,
                "action": "tick",
            },
        })


def test_parse_runner_response_preserves_observed_model_and_response_mode():
    adapter = _load_adapter()
    parsed = adapter.parse_runner_response(
        {
            "ok": True,
            "player_text": "我检查门锁。",
            "model_identity": {"provider": "openai", "id": "gpt-evidence"},
            "response_mode": "tool",
        }
    )

    assert parsed["model_identity"] == {
        "provider": "openai",
        "id": "gpt-evidence",
    }
    assert parsed["response_mode"] == "tool"


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


def test_player_send_turn_rejects_response_mismatching_requested_choice(tmp_path):
    adapter = _load_adapter()
    runner = tmp_path / "fake_mismatched_choice"
    _write_fake_runner(
        runner,
        stdout=json.dumps({
            "ok": True,
            "player_text": "我确认。",
            "pending_choice_response": {
                "choice_id": "another-choice",
                "responder": "player",
                "revision": 0,
                "action": "confirm",
            },
        }) + "\n",
    )
    request = _sample_request()
    request["pending_choice"] = {
        "choice_id": "push-offer:confirm",
        "kind": "push_confirm",
        "responder": "player",
        "revision": 0,
        "options": [{"action": "confirm", "label": "Push"}],
    }

    with pytest.raises(RuntimeError, match="canonical pending choice"):
        adapter.player_send_turn(request, runner_path=runner)


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


def test_parse_runner_response_accepts_prose_degraded_shape():
    """Prose-without-tool degradation is a valid ok envelope (usable player_text)."""
    adapter = _load_adapter()
    parsed = adapter.parse_runner_response(
        {
            "ok": True,
            "player_text": "我蹲下仔细查看门廊上的脚印。",
            "player_notes": (
                "player_missing_tool_use: model returned prose without coc_player_action"
            ),
        }
    )
    assert parsed["player_text"].startswith("我蹲下")
    assert "player_missing_tool_use" in parsed["player_notes"]
    assert "intent_class" not in parsed


def test_parse_runner_response_recovers_tool_scaffolding_from_prose():
    """Glued coc_player_action field labels must not leak into player_text."""
    adapter = _load_adapter()
    blob = (
        "coc_player_actionplayer_text: 海斯没有去碰那个话题。"
        "他把身体往椅背一靠。intent_class: socialplayer_notes: "
        "海斯注意到签名，选择不直接揭穿。"
    )
    parsed = adapter.parse_runner_response(
        {
            "ok": True,
            "player_text": blob,
            "player_notes": (
                "player_missing_tool_use: model returned prose without coc_player_action"
            ),
        }
    )
    assert parsed["player_text"].startswith("海斯没有去碰那个话题")
    assert "coc_player_action" not in parsed["player_text"]
    assert "intent_class:" not in parsed["player_text"]
    assert "player_notes:" not in parsed["player_text"]
    assert parsed["intent_class"] == "social"
    assert parsed["player_notes"].startswith("海斯注意到签名")


def test_recover_player_action_scaffolding_leaves_ordinary_prose_alone():
    adapter = _load_adapter()
    assert adapter.recover_player_action_scaffolding("我推开侧门往里看一眼。") is None
    assert adapter.recover_player_action_scaffolding("") is None


def test_player_send_turn_accepts_prose_degraded_fake_runner(tmp_path):
    """Fake runner emitting prose-degraded shape must round-trip through adapter."""
    adapter = _load_adapter()
    runner = tmp_path / "fake_prose_degraded"
    _write_fake_runner(
        runner,
        stdout=json.dumps(
            {
                "ok": True,
                "player_text": "我推开侧门往里看一眼。",
                "player_notes": (
                    "player_missing_tool_use: model returned prose without coc_player_action"
                ),
            },
            ensure_ascii=False,
        )
        + "\n",
    )
    result = adapter.player_send_turn(_sample_request(), runner_path=runner)
    assert result["player_text"] == "我推开侧门往里看一眼。"
    assert result["player_notes"].startswith("player_missing_tool_use:")


def test_run_player_turn_mjs_is_real_bridge_not_placeholder():
    """Sanity: committed runner is the real Pi bridge, not the N5 placeholder stub."""
    source = (PLAYER_DIR / "run_player_turn.mjs").read_text(encoding="utf-8")
    assert "coc_player_action" in source
    assert "@earendil-works/pi-coding-agent" in source
    assert "placeholder" not in source.lower()
    assert "player_missing_tool_use" in source
    assert "session.model" in source
    assert "model_identity" in source
    assert "response_mode" in source
    assert "pending_choice_response" in source
    pkg = json.loads((PLAYER_DIR / "package.json").read_text(encoding="utf-8"))
    assert pkg["dependencies"]["@earendil-works/pi-coding-agent"] == "0.79.9"
