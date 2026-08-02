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
