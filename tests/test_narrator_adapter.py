"""Contract tests for the narrator adapter (Python wrapper + fake runners)."""
from __future__ import annotations

import importlib.util
import json
import stat
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
NARRATOR_DIR = REPO / "runtime" / "adapters" / "narrator"
ADAPTER_PATH = NARRATOR_DIR / "adapter.py"


def _load_adapter():
    spec = importlib.util.spec_from_file_location("runtime_narrator_adapter", ADAPTER_PATH)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def _sample_request() -> dict:
    return {
        "narration_envelope": {
            "decision_id": "turn-001",
            "tone": ["tense"],
            "approved_reveals": {"clue_ids": ["c1"], "must_include": ["门框有划痕"]},
            "must_not_reveal": [{"id": "secret-1", "category": "keeper"}],
            "choice_frame": {
                "routes": [{"id": "a", "cue": "追问钥匙来源"}],
            },
            "rationale": "PLANNER ONLY — must be stripped",
            "keeper_secrets": ["never send this"],
        },
        "last_player_text": "我检查门框。",
        "play_language": "zh-Hans",
        "recent_narrations": ["雨还在下。"],
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
    """Fake runner that asserts sanitized request and returns fixed final_text."""
    script = """#!/usr/bin/env python3
import json, sys
req = json.loads(sys.stdin.read())
assert "narration_envelope" in req
assert "last_player_text" in req
assert "play_language" in req
assert "recent_narrations" in req
env = req["narration_envelope"]
assert "rationale" not in env, env
assert "keeper_secrets" not in env, env
assert "director_rationale" not in env, env
out = {
    "ok": True,
    "final_text": "你指尖摸到门框上的细痕，木屑还带着潮气。",
    "notes": "ok",
}
sys.stdout.write(json.dumps(out, ensure_ascii=False) + "\\n")
"""
    path.write_text(script, encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def test_sanitize_envelope_drops_rationale_and_secrets():
    adapter = _load_adapter()
    cleaned = adapter.sanitize_narration_envelope(_sample_request()["narration_envelope"])
    assert "rationale" not in cleaned
    assert "keeper_secrets" not in cleaned
    assert cleaned["approved_reveals"]["must_include"] == ["门框有划痕"]


def test_parse_runner_response_requires_ok_and_final_text():
    adapter = _load_adapter()
    parsed = adapter.parse_runner_response(
        {"ok": True, "final_text": "雨声里，门廊更暗了。", "notes": "n"}
    )
    assert parsed["final_text"] == "雨声里，门廊更暗了。"
    assert parsed["notes"] == "n"


def test_parse_runner_response_rejects_ok_false():
    adapter = _load_adapter()
    with pytest.raises(RuntimeError, match="model unavailable"):
        adapter.parse_runner_response({"ok": False, "error": "model unavailable"})


def test_parse_runner_response_accepts_prose_degraded_shape():
    adapter = _load_adapter()
    parsed = adapter.parse_runner_response(
        {
            "ok": True,
            "final_text": "你蹲下，指尖碰到潮湿的木屑。",
            "notes": (
                "narrator_missing_tool_use: model returned prose without coc_keeper_narration"
            ),
        }
    )
    assert "narrator_missing_tool_use" in parsed["notes"]


def test_parse_runner_response_preserves_observed_model_and_response_mode():
    adapter = _load_adapter()
    parsed = adapter.parse_runner_response(
        {
            "ok": True,
            "final_text": "雨声压低了门后的脚步。",
            "model_identity": {"provider": "anthropic", "id": "claude-evidence"},
            "response_mode": "tool",
        }
    )

    assert parsed["model_identity"] == {
        "provider": "anthropic",
        "id": "claude-evidence",
    }
    assert parsed["response_mode"] == "tool"


def test_parse_runner_response_preserves_structured_secret_audit_fields():
    adapter = _load_adapter()
    parsed = adapter.parse_runner_response({
        "ok": True, "final_text": "雨敲着窗。",
        "secret_audit_complete": True,
        "asserted_fact_refs": ["fact-rain"],
        "semantic_audit": [{"asserted_ref": "fact-rain", "forbidden_ref": "secret-1",
                            "decision": "different_fact", "reason": "distinct ids"}],
    })
    assert parsed["asserted_fact_refs"] == ["fact-rain"]
    assert parsed["semantic_audit"][0]["decision"] == "different_fact"
    assert parsed["secret_audit_complete"] is True


def test_parse_runner_response_does_not_infer_complete_from_field_presence():
    parsed = _load_adapter().parse_runner_response({
        "ok": True, "final_text": "雨敲着窗。",
        "asserted_fact_refs": [], "semantic_audit": [],
    })
    assert parsed["secret_audit_complete"] is False


def test_parse_runner_response_marks_missing_secret_audit_ineligible():
    parsed = _load_adapter().parse_runner_response({"ok": True, "final_text": "雨敲着窗。"})
    assert parsed["secret_audit_complete"] is False


def test_narrator_send_turn_round_trip_strips_rationale(tmp_path):
    adapter = _load_adapter()
    runner = tmp_path / "fake_narrator"
    _write_echo_runner(runner)
    result = adapter.narrator_send_turn(_sample_request(), runner_path=runner)
    assert "门框" in result["final_text"]


def test_narrator_send_turn_requires_request_keys(tmp_path):
    adapter = _load_adapter()
    runner = tmp_path / "fake_narrator"
    _write_echo_runner(runner)
    with pytest.raises(ValueError, match="narration_envelope"):
        adapter.narrator_send_turn({"last_player_text": "x"}, runner_path=runner)


def test_narrator_send_turn_raises_on_runner_failure(tmp_path):
    adapter = _load_adapter()
    runner = tmp_path / "fake_fail"
    _write_fake_runner(runner, stdout='{"ok": false, "error": "boom"}\n', exit_code=1)
    with pytest.raises(RuntimeError):
        adapter.narrator_send_turn(_sample_request(), runner_path=runner)


def test_relative_runner_path_resolved_against_caller_cwd(tmp_path, monkeypatch):
    """Relative paths must resolve against cwd, not the adapter directory."""
    adapter = _load_adapter()
    runner = tmp_path / "rel_narrator"
    _write_echo_runner(runner)
    monkeypatch.chdir(tmp_path)
    result = adapter.narrator_send_turn(_sample_request(), runner_path="rel_narrator")
    assert result["ok"] is True
    assert "门框" in result["final_text"]


def test_run_narration_mjs_is_real_bridge_not_placeholder():
    source = (NARRATOR_DIR / "run_narration.mjs").read_text(encoding="utf-8")
    assert "coc_keeper_narration" in source
    assert "@earendil-works/pi-coding-agent" in source
    assert "narrator_missing_tool_use" in source
    assert "session.model" in source
    assert "model_identity" in source
    assert "response_mode" in source
    assert "placeholder" not in source.lower()
    pkg = json.loads((NARRATOR_DIR / "package.json").read_text(encoding="utf-8"))
    assert pkg["dependencies"]["@earendil-works/pi-coding-agent"] == "0.79.9"


def test_run_narration_mjs_surfaces_grounded_envelope_fields():
    """Bridge prompt must call out clue bodies, rule results, scene, npc seeds."""
    source = (NARRATOR_DIR / "run_narration.mjs").read_text(encoding="utf-8")
    for needle in (
        "approved_reveals",
        "player_safe_summary",
        "rule_results",
        "scene_anchor",
        "dialogue_seed",
        "sensory",
    ):
        assert needle in source, f"run_narration.mjs should surface {needle!r}"


def test_run_narration_mjs_surfaces_redirection_policy_section():
    """SENNA redirection strategies must be explicit prompt instructions."""
    source = (NARRATOR_DIR / "run_narration.mjs").read_text(encoding="utf-8")
    for needle in (
        "redirection",
        "in_world_consequences",
        "npc_influence",
        "more_information",
        "hard_denial",
        "formatRedirection",
    ):
        assert needle in source, f"run_narration.mjs should surface {needle!r}"
