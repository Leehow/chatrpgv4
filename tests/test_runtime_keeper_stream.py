"""Adapter streaming contract: stderr marker lines reach ``on_stream``.

Uses fake Node runner scripts so no LLM is involved. The real runner's
marker emission is covered by live smoke, not by unit tests.
"""
from __future__ import annotations

import textwrap
from pathlib import Path

import pytest

from runtime.adapters.keeper import adapter
from runtime.sdk import api


@pytest.fixture
def workspace(tmp_path: Path) -> Path:
    api.setup_workspace(
        tmp_path,
        {
            "schema_version": 1,
            "kind": "campaign.quick_start",
            "payload": {
                "scenario_id": "the-haunting",
                "pregen_id": "thomas-hayes",
                "campaign_id": "test",
            },
        },
    )
    return tmp_path


def _write_fake_runner(tmp_path: Path, name: str, body: str) -> Path:
    runner = tmp_path / name
    runner.write_text(textwrap.dedent(body), encoding="utf-8")
    return runner


def _request(workspace: Path) -> dict:
    return {
        "workspace": str(workspace),
        "campaign_id": "test",
        "player_input": "你好",
        "play_language": "zh-Hans",
        "finalization_offset": 0,
    }


def test_on_stream_receives_marker_events(workspace: Path) -> None:
    runner = _write_fake_runner(workspace,
        "fake_runner.mjs",
        """\
        let input = "";
        process.stdin.on("data", (c) => (input += c));
        process.stdin.on("end", () => {
          const line = (obj) => process.stderr.write(JSON.stringify(obj) + "\\n");
          line({ $stream: "tool", phase: "start", tool: "session.resume" });
          process.stderr.write("ordinary log line\\n");
          line({ $stream: "delta", text: "夜雨" });
          process.stderr.write('{"$stream": broken\\n');
          process.stdout.write(JSON.stringify({ ok: true, narration: "夜雨敲窗" }) + "\\n");
        });
        """,
    )
    events: list[dict] = []
    # narration-only stdout fails finalization validation, but the streamed
    # events must have arrived first and the parse must survive a bad line.
    with pytest.raises(adapter.KeeperFinalizationError):
        adapter.keeper_send_turn(
            _request(workspace), runner_path=runner, on_stream=events.append
        )
    assert events == [
        {"$stream": "tool", "phase": "start", "tool": "session.resume"},
        {"$stream": "delta", "text": "夜雨"},
    ]


def test_stderr_error_detail_survives_marker_lines(workspace: Path) -> None:
    runner = _write_fake_runner(workspace,
        "fake_runner_fail.mjs",
        """\
        let input = "";
        process.stdin.on("data", (c) => (input += c));
        process.stdin.on("end", () => {
          process.stderr.write(JSON.stringify({
            $stream: "tool", phase: "start", tool: "rules.roll_check",
          }) + "\\n");
          process.stderr.write("boom: relay refused\\n");
          process.exit(3);
        });
        """,
    )
    events: list[dict] = []
    with pytest.raises(adapter.KeeperAdapterError) as excinfo:
        adapter.keeper_send_turn(
            _request(workspace), runner_path=runner, on_stream=events.append
        )
    assert "relay refused" in str(excinfo.value)
    assert '{"$stream"' not in str(excinfo.value)
    assert events == [
        {"$stream": "tool", "phase": "start", "tool": "rules.roll_check"}
    ]


def test_no_callback_keeps_legacy_behavior(workspace: Path) -> None:
    runner = _write_fake_runner(workspace,
        "fake_runner_plain.mjs",
        """\
        let input = "";
        process.stdin.on("data", (c) => (input += c));
        process.stdin.on("end", () => {
          process.stderr.write(JSON.stringify({ $stream: "delta", text: "ignored" }) + "\\n");
          process.stderr.write("plain failure\\n");
          process.exit(1);
        });
        """,
    )
    with pytest.raises(adapter.KeeperAdapterError) as excinfo:
        adapter.keeper_send_turn(_request(workspace), runner_path=runner)
    assert "plain failure" in str(excinfo.value)
    assert '{"$stream"' not in str(excinfo.value)


def test_runner_timeout_still_raises(workspace: Path) -> None:
    runner = _write_fake_runner(workspace,
        "fake_runner_hang.mjs",
        """\
        let input = "";
        process.stdin.on("data", (c) => (input += c));
        process.stdin.on("end", () => setTimeout(() => {}, 30000));
        """,
    )
    with pytest.raises(adapter.KeeperAdapterError, match="timed out"):
        adapter.keeper_send_turn(_request(workspace), runner_path=runner, timeout_s=1)


def test_warm_pool_key_separates_thinking_levels() -> None:
    """A thinking-level switch must start a fresh warm worker: the level is
    bound when the agent session is created, so it belongs in the pool key
    next to provider/model."""
    make_key = adapter._KeeperWarmServerPool.make_key
    base = {
        "runtime_session_id": "sess-1",
        "campaign_id": "camp-1",
        "workspace": "/tmp/w",
        "provider": "xai",
        "model_id": "grok-4.5",
        "runner_hash": "abc",
    }
    off = make_key(thinking="off", **base)
    low = make_key(thinking="low", **base)
    unset = make_key(**base)  # legacy callers that never send a level
    assert len({off, low, unset}) == 3


def test_thinking_level_rides_one_env_name_through_the_stack() -> None:
    """The turn's thinking level travels as COC_KEEPER_MODEL_THINKING through
    every layer: rpc_server sets it per request, the warm-pool key includes
    it, and the runner validates it against the pi --thinking enum before
    creating the agent session."""
    repo = Path(__file__).resolve().parents[1]
    rpc_server = (repo / "runtime/sdk/rpc_server.py").read_text(encoding="utf-8")
    adapter_src = (repo / "runtime/adapters/keeper/adapter.py").read_text(
        encoding="utf-8"
    )
    runner = (repo / "runtime/adapters/keeper/run_keeper_turn.mjs").read_text(
        encoding="utf-8"
    )
    assert 'params.get("thinking")' in rpc_server
    assert 'os.environ["COC_KEEPER_MODEL_THINKING"] = thinking' in rpc_server
    assert 'os.environ.get("COC_KEEPER_MODEL_THINKING")' in adapter_src
    assert "thinking=thinking," in adapter_src
    assert "COC_KEEPER_MODEL_THINKING" in runner
    assert "thinkingLevel: requestedThinkingLevel()" in runner
    assert '"off", "minimal", "low", "medium", "high", "xhigh", "max"' in runner
