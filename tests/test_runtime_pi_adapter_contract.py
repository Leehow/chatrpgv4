"""Contract tests for the Pi brain adapter (Python wrapper + optional Node)."""
from __future__ import annotations

import importlib.util
import json
import os
import shutil
import stat
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
PI_DIR = REPO / "runtime" / "adapters" / "pi"
ADAPTER_PATH = PI_DIR / "adapter.py"
RUN_TURN = PI_DIR / "run_turn.mjs"
NODE_MODULES = PI_DIR / "node_modules"


def _load_adapter():
    spec = importlib.util.spec_from_file_location("runtime_pi_adapter", ADAPTER_PATH)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def _load_events():
    path = REPO / "runtime" / "engine" / "events.py"
    spec = importlib.util.spec_from_file_location("runtime_events", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def _sample_event() -> dict:
    return {
        "type": "narration",
        "id": "evt_pi_contract1",
        "ts": "2026-07-09T00:00:00Z",
        "visibility": "player",
        "payload": {"text": "雨还在下。"},
    }


def _write_fake_runner(path: Path, *, stdout: str, exit_code: int = 0) -> None:
    """Write a tiny Node-free executable that mimics run_turn.mjs stdout contract."""
    # Use python as the "runner" so tests never need node for the contract suite.
    script = f"""#!/usr/bin/env python3
import sys
sys.stdout.write({stdout!r})
sys.exit({exit_code})
"""
    path.write_text(script, encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def test_pi_send_turn_parses_ok_stdout_and_validates_events(tmp_path):
    adapter = _load_adapter()
    events_mod = _load_events()
    sample = _sample_event()
    runner = tmp_path / "fake_run_turn"
    payload = json.dumps({"ok": True, "events": [sample]})
    _write_fake_runner(runner, stdout=payload + "\n", exit_code=0)

    events = adapter.pi_send_turn(
        {
            "workspace": str(tmp_path),
            "campaign_id": "live",
            "investigator_id": "inv1",
            "character_path": str(tmp_path / "character.json"),
            "player_text": "我环顾四周。",
        },
        runner_path=runner,
    )
    assert isinstance(events, list) and len(events) == 1
    assert events[0]["id"] == "evt_pi_contract1"
    for ev in events:
        events_mod.validate_event(ev)


def test_pi_send_turn_raises_on_nonzero_exit(tmp_path):
    adapter = _load_adapter()
    runner = tmp_path / "fake_run_turn_fail"
    _write_fake_runner(runner, stdout='{"ok": false, "error": "boom"}\n', exit_code=1)

    with pytest.raises(RuntimeError):
        adapter.pi_send_turn(
            {
                "workspace": str(tmp_path),
                "campaign_id": "live",
                "investigator_id": "inv1",
                "character_path": str(tmp_path / "character.json"),
                "player_text": "试一下。",
            },
            runner_path=runner,
        )


def test_pi_send_turn_raises_on_ok_false_even_with_zero_exit(tmp_path):
    adapter = _load_adapter()
    runner = tmp_path / "fake_run_turn_ok_false"
    _write_fake_runner(
        runner,
        stdout='{"ok": false, "error": "model unavailable"}\n',
        exit_code=0,
    )

    with pytest.raises(RuntimeError, match="model unavailable"):
        adapter.pi_send_turn(
            {
                "workspace": str(tmp_path),
                "campaign_id": "live",
                "investigator_id": "inv1",
                "character_path": str(tmp_path / "character.json"),
                "player_text": "试一下。",
            },
            runner_path=runner,
        )


def test_parse_runner_response_missing_tool_use_event_is_schema_valid():
    adapter = _load_adapter()
    events_mod = _load_events()
    raw = {
        "ok": True,
        "events": [
            {
                "type": "error",
                "id": "evt_pi_missing",
                "ts": "2026-07-09T00:00:00Z",
                "visibility": "system",
                "payload": {
                    "kind": "pi_missing_tool_use",
                    "message": "model returned prose without coc_live_turn",
                },
            }
        ],
    }
    events = adapter.parse_runner_response(raw)
    assert events[0]["payload"]["kind"] == "pi_missing_tool_use"
    events_mod.validate_event(events[0])


@pytest.mark.skipif(
    shutil.which("node") is None or not NODE_MODULES.is_dir(),
    reason="node or runtime/adapters/pi/node_modules not available",
)
def test_optional_pi_node_integration_smoke(tmp_path):
    """Optional live Node bridge smoke; skips without deps. May still need model auth."""
    adapter = _load_adapter()
    events_mod = _load_events()

    # Minimal workspace so call_debug / debug path has somewhere to land if tool runs.
    coc = tmp_path / ".coc"
    (coc / "campaigns" / "live" / "save").mkdir(parents=True)
    (coc / "runtime.json").write_text(
        json.dumps({"schema_version": 1, "brain": "pi"}),
        encoding="utf-8",
    )
    char = tmp_path / "character.json"
    char.write_text(json.dumps({"schema_version": 1, "id": "inv1"}), encoding="utf-8")

    # Prefer dry contract: invoke run_turn.mjs with a request; if auth missing,
    # adapter should still return schema-valid events or raise a clear error.
    try:
        events = adapter.pi_send_turn(
            {
                "workspace": str(tmp_path),
                "campaign_id": "live",
                "investigator_id": "inv1",
                "character_path": str(char),
                "player_text": "我环顾四周。",
            },
            runner_path=RUN_TURN,
            timeout_s=120,
        )
    except RuntimeError as exc:
        # Auth/model gaps are acceptable for optional integration.
        msg = str(exc).lower()
        if any(tok in msg for tok in ("auth", "api key", "model", "login", "credential")):
            pytest.skip(f"pi live auth/model unavailable: {exc}")
        raise

    assert isinstance(events, list) and len(events) >= 1
    for ev in events:
        events_mod.validate_event(ev)
