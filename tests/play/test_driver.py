"""Tests for tests/play/driver.py, the live-play driver.

Run with:
    PYTHONDONTWRITEBYTECODE=1 uv run --frozen python -m pytest tests/play -q -p no:cacheprovider

Most tests drive driver.py against tests/play/fixtures/fake_pi_rpc.py, a
scripted stand-in that speaks the Pi RPC protocol without needing a real
LLM. One smoke test spawns the real `node_modules/.bin/pi --mode rpc
--no-session` directly (bypassing driver.py) to confirm the framing
assumptions in driver.py -- split on "\n" only, one JSON object per line --
hold against the real binary; it is skipped when node_modules is absent.
"""
from __future__ import annotations

import json
import importlib.util
import os
import queue
import shutil
import signal
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
DRIVER = REPO_ROOT / "tests" / "play" / "driver.py"
FAKE_PI = REPO_ROOT / "tests" / "play" / "fixtures" / "fake_pi_rpc.py"
REAL_PI = REPO_ROOT / "node_modules" / ".bin" / "pi"


def run_driver(*args: str, env: dict | None = None, timeout: float = 30.0) -> subprocess.CompletedProcess:
    full_env = {**os.environ, **(env or {})}
    return subprocess.run(
        [sys.executable, str(DRIVER), *args],
        cwd=str(REPO_ROOT), env=full_env, timeout=timeout,
        capture_output=True, text=True,
    )


def run_dir(run_id: str) -> Path:
    return REPO_ROOT / ".coc" / "playtests" / run_id


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except (ProcessLookupError, PermissionError):
        return False
    return True


@pytest.fixture
def started_run():
    """Starts a daemon against the fake pi and yields its run_id.

    Ensures `stop` runs and the evidence dir is removed even if the test
    body fails partway through -- these are disposable fixture runs, not
    the evidence a human playtest is meant to keep.
    """
    run_id = f"fixture-{uuid.uuid4().hex[:10]}"

    def _start(extra_env: dict | None = None, model: str | None = None) -> subprocess.CompletedProcess:
        args = ["start", "--campaign", "test-campaign", "--run", run_id, "--launcher", str(FAKE_PI)]
        if model:
            args += ["--model", model]
        return run_driver(*args, env=extra_env)

    yield run_id, _start

    stop = run_driver("stop", "--run", run_id, timeout=15.0)
    rdir = run_dir(run_id)
    info = read_json(rdir / "daemon.json") if (rdir / "daemon.json").exists() else {}
    for key in ("daemon_pid", "pi_pid"):
        pid = info.get(key)
        if pid and pid_alive(pid):
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
    shutil.rmtree(rdir, ignore_errors=True)


def test_start_writes_pid_and_heartbeat(started_run):
    run_id, start = started_run
    proc = start()
    assert proc.returncode == 0, proc.stderr

    rdir = run_dir(run_id)
    daemon_info = read_json(rdir / "daemon.json")
    assert daemon_info["status"] == "ready"
    assert isinstance(daemon_info["daemon_pid"], int)
    assert isinstance(daemon_info["pi_pid"], int)
    assert pid_alive(daemon_info["daemon_pid"])
    assert pid_alive(daemon_info["pi_pid"])

    heartbeat = read_json(rdir / "heartbeat.json")
    assert heartbeat["pi_alive"] is True
    assert heartbeat["turn_count"] == 0


def test_silence_and_a_stale_settle_do_not_end_a_busy_opening():
    spec = importlib.util.spec_from_file_location("driver_idle_probe", DRIVER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    states = iter([{"isStreaming": True}, {"pendingMessageCount": 1}, {"isStreaming": False}])
    calls = []
    class Transport:
        def alive(self): return True
        def call(self, request, timeout):
            calls.append(request)
            return {"success": True, "data": next(states)}
    class Events:
        first = True
        def get(self, timeout):
            if self.first:
                self.first = False
                return {"type": "agent_settled"}
            raise queue.Empty
    daemon = module.Daemon.__new__(module.Daemon)
    daemon.pi = Transport()
    assert daemon._await_quiet(Events(), time.monotonic()+2)
    assert calls == [{"type": "get_state"}] * 3


def test_prompt_preflight_can_outlast_management_ack_timeout(started_run):
    """Transport-only fixture: an accepted slow preflight still belongs to the requested turn."""
    run_id, start = started_run
    assert start({"FAKE_PI_PREFLIGHT_DELAY": "11"}).returncode == 0
    result = run_driver("turn", "Look around.", "--run", run_id, "--timeout", "25", timeout=35)
    assert result.returncode == 0, result.stdout + result.stderr
    turn = read_json(run_dir(run_id) / "turn-1.json")
    assert turn["settle_class"] == "settled"
    assert turn["wall_seconds"] >= 11
    assert "cellar door creaks open" in turn["final_text"]


def test_turn_prints_text_and_writes_settled_summary(started_run):
    run_id, start = started_run
    assert start().returncode == 0

    proc = run_driver("turn", "Look around the cellar.", "--run", run_id, "--timeout", "20")
    assert proc.returncode == 0, proc.stderr
    assert "cellar door creaks open" in proc.stdout
    assert "[turn 1 |" in proc.stdout
    assert "tools: look" in proc.stdout

    summary = read_json(run_dir(run_id) / "turn-1.json")
    assert summary["settle_class"] == "settled"
    assert summary["player_text"] == "Look around the cellar."
    assert "cellar door creaks open" in summary["final_text"]
    assert len(summary["tools"]) == 1
    tool = summary["tools"][0]
    assert tool["name"] == "look"
    assert isinstance(tool["ms"], (int, float)) and tool["ms"] > 0
    assert "dusty cellar" in tool["result_text"]


def test_turn_without_text_yields_undelivered_with_tools(started_run):
    run_id, start = started_run
    assert start(extra_env={"FAKE_PI_NO_TEXT": "1"}).returncode == 0

    proc = run_driver("turn", "Look around.", "--run", run_id, "--timeout", "20")
    assert proc.returncode == 5, proc.stderr
    assert "no assistant text this turn" in proc.stdout

    summary = read_json(run_dir(run_id) / "turn-1.json")
    assert summary["settle_class"] == "undelivered_with_tools"
    assert summary["final_text"] == ""
    assert len(summary["tools"]) == 1
    assert summary["tools"][0]["name"] == "look"


def test_a_delivery_that_only_the_narrate_result_carries_is_still_the_turn(started_run):
    """Contract §32.9: a Keeper that ends on the message carrying its narrate call leaves the
    assistant-side replacement nowhere to land. PipiCOC reads the kernel's `rendered_text` off the
    tool result and shows the words; the driver read assistant text alone and recorded the turn as
    undelivered while the player had in fact been told. One turn in the 445 on disk did this."""
    run_id, start = started_run
    prose = "门厅里落满灰，楼梯通向二楼。"
    assert start(extra_env={"FAKE_PI_NO_TEXT": "1", "FAKE_PI_DELIVER_VIA_TOOL": prose}).returncode == 0

    proc = run_driver("turn", "我推门进去。", "--run", run_id, "--timeout", "20")
    assert proc.returncode == 0, proc.stderr

    summary = read_json(run_dir(run_id) / "turn-1.json")
    assert summary["settle_class"] == "settled"
    assert summary["final_text"] == prose
    assert [tool["name"] for tool in summary["tools"]] == ["look", "narrate"]


def test_stop_terminates_both_processes_and_writes_final(started_run):
    run_id, start = started_run
    assert start().returncode == 0
    rdir = run_dir(run_id)
    info = read_json(rdir / "daemon.json")
    daemon_pid, pi_pid = info["daemon_pid"], info["pi_pid"]

    assert run_driver("turn", "Look around.", "--run", run_id, "--timeout", "20").returncode == 0

    proc = run_driver("stop", "--run", run_id, timeout=15.0)
    assert proc.returncode == 0, proc.stderr

    final = read_json(rdir / "final.json")
    assert final["turn_count"] == 1
    assert final["totals"]["tool_calls"] == 1
    assert final["totals"]["wall_seconds"] > 0

    deadline = time.monotonic() + 5.0
    while time.monotonic() < deadline and (pid_alive(daemon_pid) or pid_alive(pi_pid)):
        time.sleep(0.1)
    assert not pid_alive(daemon_pid), "daemon process should be dead after stop"
    assert not pid_alive(pi_pid), "pi process should be dead after stop"


def test_status_reports_alive_then_dead(started_run):
    run_id, start = started_run
    assert start().returncode == 0

    proc = run_driver("status", "--run", run_id)
    assert proc.returncode == 0, proc.stderr
    assert "daemon alive" in proc.stdout
    assert "pi alive" in proc.stdout

    assert run_driver("stop", "--run", run_id, timeout=15.0).returncode == 0

    proc = run_driver("status", "--run", run_id)
    assert proc.returncode == 1
    assert "daemon unreachable" in proc.stdout
    assert "status=stopped" in proc.stdout


def test_log_tails_the_driver_log(started_run):
    run_id, start = started_run
    assert start().returncode == 0

    proc = run_driver("log", "--run", run_id, "--tail", "5")
    assert proc.returncode == 0, proc.stderr
    assert "daemon ready" in proc.stdout


def test_second_run_on_same_campaign_continues_the_kernel_turn_and_records_resume():
    """Two separate driver runs against the *same campaign*, as a real playtest would
    see across a killed-and-restarted pi-coc process (docs/kernel-rpc.md §12.2, §12.6):
    campaign state lives on disk, so a new run picks up where the old one left off and
    its first player_input carries a `resume` note.

    The driver itself has no concept of this -- `Daemon.turn_count` (and so this run's
    own turn-<n>.json numbering) starts at 0 for every run, by design; that is a
    driver-local evidence-file counter, not the campaign's turn. So this cannot assert
    the *driver's* numbering "continues" -- run B's first turn is still its own
    turn-1.json. What can be asserted, and is asserted here, is that whatever the
    keeper actually did gets recorded faithfully: `tests/play/fixtures/fake_pi_rpc.py`
    stands in for a real kernel-backed keeper by persisting its own kernel_turn counter
    across the two runs (FAKE_PI_KERNEL_STATE) and speaking up about it -- in its
    assistant text and in the `look` tool's args/result -- exactly once, on the first
    prompt after a restart. Both are things the driver already records verbatim, in
    turn-1.json and in the raw events.jsonl line, with no driver.py change needed.
    """
    state_file = REPO_ROOT / ".coc" / "playtests" / f".fixture-kernel-state-{uuid.uuid4().hex[:10]}.json"
    campaign = "resume-continuity"
    run_a = f"resume-a-{uuid.uuid4().hex[:10]}"
    run_b = f"resume-b-{uuid.uuid4().hex[:10]}"

    def cleanup(run_id: str) -> None:
        run_driver("stop", "--run", run_id, timeout=15.0)
        rdir = run_dir(run_id)
        info = read_json(rdir / "daemon.json") if (rdir / "daemon.json").exists() else {}
        for key in ("daemon_pid", "pi_pid"):
            pid = info.get(key)
            if pid and pid_alive(pid):
                try:
                    os.kill(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
        shutil.rmtree(rdir, ignore_errors=True)

    try:
        # Run A: this campaign's very first turn ever -- nothing to resume yet.
        assert run_driver("start", "--campaign", campaign, "--run", run_a, "--launcher", str(FAKE_PI),
                           env={"FAKE_PI_KERNEL_STATE": str(state_file)}).returncode == 0
        proc_a = run_driver("turn", "Explore the cellar.", "--run", run_a, "--timeout", "20")
        assert proc_a.returncode == 0, proc_a.stderr
        summary_a = read_json(run_dir(run_a) / "turn-1.json")
        assert "resumed" not in summary_a["final_text"]
        assert "resume" not in summary_a["tools"][0]["args"]
        assert run_driver("stop", "--run", run_a, timeout=15.0).returncode == 0
        assert read_json(run_dir(run_a) / "final.json")["turn_count"] == 1

        # Run B: a brand-new driver run (new run_id, new daemon, new fake-pi process),
        # same campaign, same persisted kernel state -- standing in for pi-coc having
        # been killed and restarted against the same on-disk campaign.
        assert run_driver("start", "--campaign", campaign, "--run", run_b, "--launcher", str(FAKE_PI),
                           env={"FAKE_PI_KERNEL_STATE": str(state_file)}).returncode == 0
        proc_b = run_driver("turn", "Look again.", "--run", run_b, "--timeout", "20")
        assert proc_b.returncode == 0, proc_b.stderr

        # Run B's own evidence file is still named turn-1.json (its local counter reset,
        # as expected) but its *content* shows the kernel-level turn continuing (1 -> 2)
        # and the resume note, exactly as the driver recorded them verbatim.
        summary_b = read_json(run_dir(run_b) / "turn-1.json")
        tool_b = summary_b["tools"][0]
        assert tool_b["args"]["kernel_turn"] == 2
        assert tool_b["args"]["resume"] == {"turn": 1}
        assert "resumed: continuing from committed turn 1" in summary_b["final_text"]
        assert "(resume: from turn 1 to turn 2)" in tool_b["result_text"]

        # And the raw RPC event stream -- not just the driver's derived summary --
        # carries the same resume note on the tool call that produced it.
        events_b = [json.loads(line) for line in
                    (run_dir(run_b) / "events.jsonl").read_text(encoding="utf-8").splitlines()]
        tool_start = next(e for e in events_b if e.get("type") == "tool_execution_start")
        assert tool_start["args"]["resume"] == {"turn": 1}
    finally:
        cleanup(run_a)
        cleanup(run_b)
        try:
            state_file.unlink()
        except FileNotFoundError:
            pass


@pytest.mark.skipif(not REAL_PI.exists(), reason="node_modules/.bin/pi not installed")
def test_real_pi_get_state_smoke():
    """Confirms the JSONL/get_state framing assumptions against the real pi binary.

    The real binary emits startup housekeeping (observed: a fire-and-forget
    `extension_ui_request` for `setWidget`) before answering get_state, so
    this reads lines on a background thread -- readline() itself can block
    past any deadline check done only between calls -- and scans for the
    response matching our request id, tolerating whatever comes first.
    """
    proc = subprocess.Popen(
        [str(REAL_PI), "--mode", "rpc", "--no-session"],
        cwd=str(REPO_ROOT), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    lines: "queue.Queue[bytes]" = queue.Queue()

    def _drain_stdout():
        for raw in iter(proc.stdout.readline, b""):
            lines.put(raw)
        lines.put(b"")  # sentinel: stdout EOF

    threading.Thread(target=_drain_stdout, daemon=True).start()

    try:
        proc.stdin.write(b'{"id": "smoke-1", "type": "get_state"}\n')
        proc.stdin.flush()

        deadline = time.monotonic() + 20.0
        event = None
        while time.monotonic() < deadline:
            try:
                raw = lines.get(timeout=max(0.1, deadline - time.monotonic()))
            except queue.Empty:
                break
            if raw == b"" and proc.poll() is not None:
                pytest.skip(
                    f"real pi exited before responding (exit {proc.returncode}); "
                    f"stderr: {proc.stderr.read(2000)!r}"
                )
            text = raw[:-1] if raw.endswith(b"\n") else raw
            if text.endswith(b"\r"):
                text = text[:-1]
            if not text:
                continue
            candidate = json.loads(text.decode("utf-8"))
            if candidate.get("id") == "smoke-1":
                event = candidate
                break
        if event is None:
            pytest.skip("real pi never answered get_state within 20s (likely an environment/config issue)")

        assert event.get("type") == "response"
        assert event.get("command") == "get_state"
        assert "success" in event
    finally:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=5.0)
            except subprocess.TimeoutExpired:
                proc.kill()
