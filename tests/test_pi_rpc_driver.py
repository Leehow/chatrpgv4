"""Tests for the hardened pi-coc RPC evidence driver (EPIPE pattern fix).

The driver owns pi's stdout pipe read end in the playtest RPC setup. When the
driver process dies, pi's next stdout write fails with ``write EPIPE`` and pi
crashes (verified upstream behavior on Node v22.19.0 / pi 0.81.1). The
hardened driver must:

- keep a driver log and a heartbeat so a dead/hung driver is diagnosable;
- fail fast in ``turn`` instead of hanging until the turn timeout;
- survive reader/forwarder thread deaths without closing pi's stdout pipe;
- record pi's exit in the events file.

These tests drive the driver with a fake ``pi`` binary; they never touch the
real pi or a provider.
"""
from __future__ import annotations

import importlib.util
import json
import os
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

import pytest

TESTS_PI = Path(__file__).resolve().parent / "pi"
DRIVER_SOURCE = TESTS_PI / "_lib" / "rpc-driver.py"
FAKE_PI_SOURCE = TESTS_PI / "_lib" / "fake-pi-rpc.py"


def _install_driver(workspace: Path) -> object:
    target = workspace / "rpc_driver.py"
    shutil.copyfile(DRIVER_SOURCE, target)
    spec = importlib.util.spec_from_file_location("coc_rpc_driver_test", target)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _install_fake_pi(workspace: Path) -> Path:
    bindir = workspace / "fakebin"
    bindir.mkdir(exist_ok=True)
    target = bindir / "pi"
    shutil.copyfile(FAKE_PI_SOURCE, target)
    target.chmod(0o755)
    return bindir


def _pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


class DaemonFixture:
    def __init__(self, workspace: Path):
        self.workspace = workspace
        self.evidence = workspace / "evidence"
        self.evidence.mkdir(exist_ok=True)
        self.module = _install_driver(workspace)
        self.fakebin = _install_fake_pi(workspace)
        self.module.EVIDENCE = self.evidence
        self.module.FIFO = self.evidence / "rpc-control.fifo"
        self.module.PID = self.evidence / "rpc-daemon.pid"
        self.module.EVENTS = self.evidence / "rpc-events.jsonl"
        self.module.STDERR = self.evidence / "pi-stderr.log"
        self.module.STATE = self.evidence / "rpc-state.json"
        self.module.DRIVER_LOG = self.evidence / "rpc-driver.log"
        self.module.HEARTBEAT = self.evidence / "rpc-driver-heartbeat"
        self.module.LAUNCH = self.evidence / "rpc-launch.json"
        # RPC_EVIDENCE_DIR is absolute: serve (relaunched from the copied file)
        # uses it directly, so evidence never leaks into the repo tree.
        self.evidence.mkdir(exist_ok=True)
        os.environ["RPC_EVIDENCE_DIR"] = os.fspath(self.evidence)
        os.environ["PATH"] = os.fspath(self.fakebin) + os.pathsep + os.environ.get("PATH", "")

    def start(self) -> None:
        assert self.module.start() == 0
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            if self.module.HEARTBEAT.exists():
                return
            time.sleep(0.1)
        raise AssertionError("daemon did not start (no heartbeat)")

    def pi_pid(self) -> int:
        return int(self.module.PID.read_text(encoding="utf-8").strip())

    def serve_pid(self) -> int:
        return int(json.loads(self.module.LAUNCH.read_text(encoding="utf-8"))["driver_pid"])

    def turn(self, message: str, timeout: int = 60) -> subprocess.CompletedProcess:
        return subprocess.run(
            [
                sys.executable, os.fspath(self.workspace / "rpc_driver.py"),
                "turn", message, "--timeout", str(timeout),
            ],
            cwd=self.workspace, capture_output=True, text=True,
        )

    def cleanup(self) -> None:
        try:
            pid = self.module.PID.read_text(encoding="utf-8").strip()
            if pid and _pid_alive(int(pid)):
                os.kill(int(pid), signal.SIGKILL)
        except (OSError, ValueError):
            pass
        try:
            serve = json.loads(
                self.module.LAUNCH.read_text(encoding="utf-8")
            ).get("driver_pid")
            if serve and _pid_alive(int(serve)):
                os.kill(int(serve), signal.SIGKILL)
        except (OSError, ValueError, json.JSONDecodeError):
            pass
        for path in (
            self.module.PID, self.module.FIFO,
            self.module.HEARTBEAT,
        ):
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass


@pytest.fixture()
def daemon(tmp_path: Path):
    fixture = DaemonFixture(tmp_path)
    fixture.start()
    yield fixture
    fixture.cleanup()


def _wait_for(predicate, timeout: float = 10.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.1)
    return False


def _latest_turn_record(daemon: DaemonFixture) -> dict:
    records = sorted(daemon.evidence.glob("turn-p-*.json"))
    assert records
    return json.loads(records[-1].read_text(encoding="utf-8"))


def test_driver_classifies_empty_settle_fail_closed(daemon: DaemonFixture):
    """agent_settled with zero visible text and zero tools fails closed.

    This is the T17 shape: a provider-successful thinking-only terminal
    swallows the player turn. The settle is recorded as ``empty_settle`` and
    the driver exits 4 instead of reporting a successful player turn.
    """
    completed = daemon.turn("__EMPTY_SETTLE__ 我划向艇索", timeout=60)
    assert completed.returncode == 4
    assert "empty settle" in completed.stderr
    record = _latest_turn_record(daemon)
    assert record["settled"] is True
    assert record["settle_class"] == "empty_settle"
    assert record["request"]["message"].startswith("__EMPTY_SETTLE__")
    assert record["recovery_markers"] == 0
    assert record["empty_terminal_recovery_markers"] == 0
    assert record["settled_output_recovery_markers"] == 0


def test_driver_classifies_undelivered_settle_with_tools(daemon: DaemonFixture):
    """Tool activity without visible output is not a delivered player turn.

    The settle window contains tool executions/toolCalls but zero visible
    assistant text: the driver must record ``undelivered_settle_with_tools``
    and exit nonzero (5) instead of reporting success from tool activity.
    """
    completed = daemon.turn("__EMPTY_TOOLS__ 我检查门后的动静", timeout=60)
    assert completed.returncode == 5
    assert "undelivered settle" in completed.stderr
    assert "zero visible assistant output" in completed.stderr
    record = _latest_turn_record(daemon)
    assert record["settled"] is True
    assert record["settle_class"] == "undelivered_settle_with_tools"
    assert record["recovery_markers"] == 0
    assert record["empty_terminal_recovery_markers"] == 0
    assert record["settled_output_recovery_markers"] == 0


def test_driver_waits_through_empty_terminal_recovery(daemon: DaemonFixture):
    """A hidden empty-terminal recovery keeps the submit open.

    The first agent_settled is the swallowed thinking-only terminal; the
    ``coc-empty-terminal-recovery`` entry marker means a hidden follow-up
    agent turn is still in flight. The driver must wait for its settle and
    then report success from the recovered visible output.
    """
    completed = daemon.turn("__EMPTY_RECOVER__ 我划向艇索", timeout=60)
    assert completed.returncode == 0, completed.stderr
    assert "recovered KP text" in completed.stdout
    record = _latest_turn_record(daemon)
    assert record["settled"] is True
    assert record["settle_class"] == "settled"
    assert record["recovery_markers"] == 1
    assert record["empty_terminal_recovery_markers"] == 1
    assert record["settled_output_recovery_markers"] == 0
    assert len([
        event for event in record["events"]
        if event.get("type") == "agent_settled"
    ]) == 2


def test_recovery_marker_accounting_counts_settled_output(tmp_path: Path):
    """Settled-output recovery markers count in recovery_markers.

    Empty-terminal and settled-output are reported separately. In-flight
    wait includes claimed settled-output but not exhausted markers.
    """
    module = _install_driver(tmp_path)
    rows = [
        {
            "type": "entry_appended",
            "entry": {
                "type": "custom",
                "customType": "coc-empty-terminal-recovery",
                "data": {"kind": "empty_terminal_recovery"},
            },
        },
        {
            "type": "entry_appended",
            "entry": {
                "type": "custom",
                "customType": "coc-settled-output-recovery",
                "data": {"schema_version": 1, "status": "claimed"},
            },
        },
        {
            "type": "entry_appended",
            "entry": {
                "type": "custom",
                "customType": "coc-settled-output-recovery",
                "data": {"schema_version": 1, "status": "exhausted"},
            },
        },
        {"type": "agent_settled"},
    ]
    counts = module._recovery_marker_counts(rows)
    assert counts["empty_terminal"] == 1
    assert counts["settled_output"] == 2
    assert counts["settled_output_claimed"] == 1
    assert counts["recovery_markers"] == 3
    assert counts["in_flight"] == 2
    assert module._empty_terminal_recovery_markers(rows) == 1
    assert module._settled_output_recovery_markers(rows) == 2
    assert module._in_flight_recovery_markers(rows) == 2


def test_driver_waits_through_settled_output_recovery(daemon: DaemonFixture):
    """A claimed settled-output recovery keeps the submit open.

    The first agent_settled is tools-without-text; the claimed
    ``coc-settled-output-recovery`` marker means a hidden follow-up is in
    flight. The driver must wait for its settle and then report success
    from the recovered visible output, counting that marker.
    """
    completed = daemon.turn("__SETTLED_RECOVER__ 我继续搜查", timeout=60)
    assert completed.returncode == 0, completed.stderr
    assert "settled-output recovered KP text" in completed.stdout
    assert "recovery_markers 1" in completed.stdout
    assert "settled_output_recovery_markers 1" in completed.stdout
    record = _latest_turn_record(daemon)
    assert record["settled"] is True
    assert record["settle_class"] == "settled"
    assert record["recovery_markers"] == 1
    assert record["empty_terminal_recovery_markers"] == 0
    assert record["settled_output_recovery_markers"] == 1
    assert len([
        event for event in record["events"]
        if event.get("type") == "agent_settled"
    ]) == 2


def _abort_recovery_delivered_fixture() -> dict:
    path = TESTS_PI / "_lib" / "fixtures" / "abort-recovery-delivered-settle.json"
    return json.loads(path.read_text(encoding="utf-8"))


def test_driver_classifies_abort_recovery_delivered_sequence_settled(tmp_path: Path):
    """Evidence-shaped abort+recovery with visible text is settled, not not_settled.

    Live turn-p-3a108c39f86b delivered full KP prose and one agent_settled
    after a leading-whitespace abort armed empty-terminal recovery without
    a pre-recovery settle. Counting ``settles <= markers`` kept the wait
    open until the 900s timeout and classified ``not_settled``.
    """
    module = _install_driver(tmp_path)
    events = _abort_recovery_delivered_fixture()["events"]
    assert module._prompt_turn_complete(events) is True
    assert module._classify_prompt_settle(events, completed=True) == "settled"
    # Old heuristic: 1 settle <= 1 marker would refuse completion.
    settles = [row for row in events if row.get("type") == "agent_settled"]
    markers = module._empty_terminal_recovery_markers(events)
    assert len(settles) == 1
    assert markers == 1
    assert len(settles) <= markers
    assert module._turn_window_visible_output(events) is True
    # In-flight: recovery armed, no visible text yet, no recovered settle.
    pre_delivery = events[:8]
    assert module._prompt_turn_complete(pre_delivery) is False
    assert module._classify_prompt_settle(
        pre_delivery, completed=False
    ) == "not_settled"
    # Visible text without the trailing settle still waits.
    without_settle = [row for row in events if row.get("type") != "agent_settled"]
    assert module._prompt_turn_complete(without_settle) is False


def test_prompt_turn_complete_classic_recovery_waits_for_second_settle(tmp_path: Path):
    """Empty terminal that DID settle still waits for the recovered settle."""
    module = _install_driver(tmp_path)
    thinking = {
        "type": "message_end",
        "message": {
            "role": "assistant",
            "content": [{"type": "thinking", "thinking": "only reasoning"}],
        },
    }
    marker = {
        "type": "entry_appended",
        "entry": {
            "type": "custom",
            "customType": "coc-empty-terminal-recovery",
            "data": {"kind": "empty_terminal_recovery"},
        },
    }
    settle = {"type": "agent_settled"}
    visible = {
        "type": "message_end",
        "message": {
            "role": "assistant",
            "content": [{"type": "text", "text": "recovered KP text"}],
        },
    }
    after_first = [thinking, marker, settle]
    assert module._prompt_turn_complete(after_first) is False
    assert module._classify_prompt_settle(after_first, completed=True) == "empty_settle"
    after_text = [thinking, marker, settle, visible]
    assert module._prompt_turn_complete(after_text) is False
    after_second = [thinking, marker, settle, visible, settle]
    assert module._prompt_turn_complete(after_second) is True
    assert module._classify_prompt_settle(after_second, completed=True) == "settled"


def test_driver_abort_recovery_delivered_does_not_burn_timeout(daemon: DaemonFixture):
    """Abort-without-pre-settle recovery must classify settled promptly."""
    started = time.monotonic()
    completed = daemon.turn("__ABORT_RECOVER_DELIVER__ 诺特面试", timeout=8)
    elapsed = time.monotonic() - started
    assert completed.returncode == 0, completed.stderr
    assert "abort-recovered KP text" in completed.stdout
    record = _latest_turn_record(daemon)
    assert record["settled"] is True
    assert record["settle_class"] == "settled"
    assert elapsed < 6, f"must not wait out the timeout; elapsed={elapsed:.1f}s"


def test_driver_set_model_and_turn_with_heartbeat_and_log(daemon: DaemonFixture):
    module = daemon.module
    result = subprocess.run(
        [sys.executable, os.fspath(daemon.workspace / "rpc_driver.py"),
         "set-model", "fake/fake"],
        cwd=daemon.workspace, capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stderr
    assert daemon.evidence / "rpc-driver-heartbeat" in daemon.evidence.iterdir()
    assert daemon.evidence / "rpc-driver.log" in daemon.evidence.iterdir()
    log_text = (daemon.evidence / "rpc-driver.log").read_text(encoding="utf-8")
    assert "serve starting" in log_text
    assert "pi spawned pid=" in log_text

    completed = daemon.turn("hello")
    assert completed.returncode == 0, completed.stderr
    assert "KP: fake KP text" in completed.stdout
    events = (daemon.evidence / "rpc-events.jsonl").read_text(encoding="utf-8")
    assert "agent_settled" in events


def test_driver_fails_fast_when_daemon_process_dies(daemon: DaemonFixture):
    """A killed driver (EPIPE pattern trigger) must be diagnosed quickly."""
    assert daemon.module.HEARTBEAT.exists()
    os.kill(daemon.serve_pid(), signal.SIGKILL)
    # Heartbeat goes stale; turn must refuse fast instead of writing a FIFO
    # nobody reads and waiting out the turn timeout.
    assert _wait_for(
        lambda: (
            not daemon.module.HEARTBEAT.exists()
            or time.time() - daemon.module.HEARTBEAT.stat().st_mtime
            > daemon.module.HEARTBEAT_STALE_SECONDS
        )
    )
    started = time.monotonic()
    completed = daemon.turn("any-message", timeout=120)
    elapsed = time.monotonic() - started
    assert completed.returncode == 3
    assert "daemon heartbeat" in completed.stderr
    assert "restart the daemon" in completed.stderr
    assert elapsed < 30, "turn must fail fast, not wait out the timeout"


def test_driver_detects_pi_death_mid_turn(daemon: DaemonFixture):
    """Pi dying mid-turn (EPIPE signature) aborts the turn with a diagnosis."""
    pi_pid = daemon.pi_pid()
    completed_proc = subprocess.Popen(
        [sys.executable, os.fspath(daemon.workspace / "rpc_driver.py"),
         "turn", "long-turn", "--timeout", "90"],
        cwd=daemon.workspace, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True,
    )
    # Wait until the fake pi received the prompt and started its 30s sleep.
    events_path = daemon.evidence / "rpc-events.jsonl"
    assert _wait_for(lambda: (
        events_path.exists()
        and events_path.read_text(encoding="utf-8").count("message_start") >= 1
    ))
    os.kill(pi_pid, signal.SIGKILL)
    stdout, stderr = completed_proc.communicate(timeout=60)
    assert completed_proc.returncode == 3
    assert "EPIPE-class peer loss" in stderr
    assert "restart the daemon and continue through session.resume" in stderr
    # The fake pi exit may also surface via the serve shutdown path; either
    # way the campaign guidance must be present.
    assert "session.resume" in stderr


def test_driver_records_pi_exit_and_stops(daemon: DaemonFixture):
    module = daemon.module
    assert module.stop() == 0
    assert _wait_for(lambda: not module.PID.exists())
    # serve appends a driver_pi_exited record after pi exits.
    events = (daemon.evidence / "rpc-events.jsonl").read_text(encoding="utf-8")
    assert "driver_pi_exited" in events
    assert _wait_for(lambda: not module.HEARTBEAT.exists())
