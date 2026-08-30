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
    def __init__(self, workspace: Path, session_role: str | None = None):
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
        self._role_was_set = "COC_PI_SESSION_ROLE" in os.environ
        self._prev_role = os.environ.get("COC_PI_SESSION_ROLE")
        if session_role in ("setup", "play"):
            os.environ["COC_PI_SESSION_ROLE"] = session_role
        else:
            os.environ.pop("COC_PI_SESSION_ROLE", None)

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

    def turn(
        self,
        message: str,
        timeout: int = 60,
        extra_env: dict[str, str] | None = None,
    ) -> subprocess.CompletedProcess:
        env = os.environ.copy()
        if extra_env:
            env.update(extra_env)
        return subprocess.run(
            [
                sys.executable, os.fspath(self.workspace / "rpc_driver.py"),
                "turn", message, "--timeout", str(timeout),
            ],
            cwd=self.workspace, capture_output=True, text=True, env=env,
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
        if self._role_was_set and self._prev_role is not None:
            os.environ["COC_PI_SESSION_ROLE"] = self._prev_role
        else:
            os.environ.pop("COC_PI_SESSION_ROLE", None)


def _spawn_daemon(tmp_path: Path, session_role: str | None = None) -> DaemonFixture:
    fixture = DaemonFixture(tmp_path, session_role=session_role)
    fixture.start()
    return fixture


@pytest.fixture()
def daemon(tmp_path: Path):
    fixture = _spawn_daemon(tmp_path)
    yield fixture
    fixture.cleanup()


@pytest.fixture()
def setup_daemon(tmp_path: Path):
    fixture = _spawn_daemon(tmp_path, session_role="setup")
    yield fixture
    fixture.cleanup()


@pytest.fixture()
def play_daemon(tmp_path: Path):
    fixture = _spawn_daemon(tmp_path, session_role="play")
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


def _setup_handoff_fixture() -> dict:
    path = TESTS_PI / "_lib" / "fixtures" / "setup-handoff-without-settle.json"
    return json.loads(path.read_text(encoding="utf-8"))


def test_driver_classifies_setup_handoff_without_visible_settle(tmp_path: Path):
    """Canonical setup.complete terminal is setup_handoff, not not_settled.

    Live setup-role prompts emit coc_setup_handoff and exit 42 after
    setup.complete writes ready_for_table. There is often no player-visible
    prose and no agent_settled. Waiting for ordinary settlement burned 900s.
    Ordinary play must ignore the same events.
    """
    module = _install_driver(tmp_path)
    events = _setup_handoff_fixture()["events"]
    assert module._prompt_turn_complete(events, session_role="setup") is True
    assert module._classify_prompt_settle(
        events, completed=True, session_role="setup",
    ) == "setup_handoff"
    assert module._prompt_turn_complete(events, session_role="play") is False
    assert module._prompt_turn_complete(events, session_role=None) is False
    assert module._classify_prompt_settle(
        events, completed=False, session_role="play",
    ) == "not_settled"
    assert module._turn_window_visible_output(events) is False
    assert module._turn_window_has_tool_activity(events) is True
    assert not any(row.get("type") == "agent_settled" for row in events)
    # Tools without the handoff envelope must not look delivered.
    without_handoff = [
        row for row in events
        if row.get("type") not in ("driver_pi_exited", "custom_message")
        and not (
            row.get("type") == "entry_appended"
            and isinstance(row.get("entry"), dict)
            and row["entry"].get("customType") == "coc_setup_handoff"
        )
    ]
    assert module._prompt_turn_complete(
        without_handoff, session_role="setup",
    ) is False
    assert module._classify_prompt_settle(
        without_handoff, completed=False, session_role="setup",
    ) == "not_settled"
    assert module._classify_prompt_settle(
        without_handoff, completed=True, session_role="setup",
    ) == "undelivered_settle_with_tools"
    envelope_only = [
        row for row in events if row.get("type") != "driver_pi_exited"
    ]
    assert module._prompt_turn_complete(
        envelope_only, session_role="setup",
    ) is True
    assert module._setup_handoff_pending(
        envelope_only, session_role="setup",
    ) is False
    assert module._setup_handoff_proven(
        envelope_only, session_role="setup",
    ) is True


def _canonical_handoff_payload(**overrides) -> dict:
    payload = {
        "type": "coc_setup_handoff",
        "campaign_id": "setup-handoff-probe",
        "receipt": {
            "schema_version": 1,
            "decision_id": "handoff-1",
            "campaign_id": "setup-handoff-probe",
            "investigator_ids": ["thomas-hayes"],
            "completed_at": "2026-08-30T00:00:00Z",
            "opening_projection_ref": None,
            "lane_interrupted_at_handoff": False,
        },
        "at": "2026-08-30T00:00:00Z",
        "consumer": "server-node/launcher",
    }
    payload.update(overrides)
    return payload


def test_setup_handoff_requires_envelope_and_exit_42(tmp_path: Path):
    """Prose, bare customType, envelope-only, or exit-42-only is not enough."""
    module = _install_driver(tmp_path)
    prose = {
        "type": "message_end",
        "message": {
            "role": "assistant",
            "content": [{"type": "text", "text": "coc_setup_handoff ready_for_table"}],
        },
    }
    assert module._prompt_turn_complete([prose], session_role="setup") is False
    bare = {
        "type": "custom_message",
        "customType": "coc_setup_handoff",
        "details": {"type": "coc_setup_handoff"},
    }
    assert module._setup_handoff_payload(bare) is None
    assert module._prompt_turn_complete([bare], session_role="setup") is False
    no_receipt = {
        "type": "custom_message",
        "customType": "coc_setup_handoff",
        "details": {
            "type": "coc_setup_handoff",
            "campaign_id": "setup-handoff-probe",
        },
    }
    assert module._setup_handoff_payload(no_receipt) is None
    assert module._prompt_turn_complete([no_receipt], session_role="setup") is False
    exit_only = [{"type": "driver_pi_exited", "code": 42, "signal": None}]
    assert module._prompt_turn_complete(exit_only, session_role="setup") is False
    assert module._setup_handoff_proven(exit_only, session_role="setup") is False
    assert module._prompt_turn_complete(exit_only, session_role="play") is False
    other_exit = [{"type": "driver_pi_exited", "code": 1, "signal": None}]
    assert module._prompt_turn_complete(other_exit, session_role="setup") is False
    dirty_exit = [{
        "type": "driver_pi_exited",
        "code": 42,
        "signal": None,
        "driver_reader_error": "BrokenPipeError()",
    }]
    assert module._setup_handoff_proven(dirty_exit, session_role="setup") is False
    assert module._prompt_turn_complete(dirty_exit, session_role="setup") is False
    malformed = exit_only + [{
        "type": "driver_non_json_stdout",
        "raw": "this is not json",
    }]
    assert module._setup_handoff_proven(malformed, session_role="setup") is False
    assert module._prompt_turn_complete(malformed, session_role="setup") is False
    assert module._prompt_turn_complete(
        [bare, exit_only[0]], session_role="setup",
    ) is False
    assert module._handoff_stream_unreliable([bare, exit_only[0]]) is True
    mixed_exits = [
        {"type": "driver_pi_exited", "code": 42, "signal": None},
        {"type": "driver_pi_exited", "code": 1, "signal": None},
    ]
    assert module._setup_handoff_proven(mixed_exits, session_role="setup") is False
    signaled = [{"type": "driver_pi_exited", "code": 42, "signal": 13}]
    assert module._setup_handoff_proven(signaled, session_role="setup") is False


@pytest.mark.parametrize(
    "mutator",
    [
        lambda p: {k: v for k, v in p.items() if k != "at"},
        lambda p: {k: v for k, v in p.items() if k != "consumer"},
        lambda p: {**p, "at": ""},
        lambda p: {**p, "at": "not-a-timestamp"},
        lambda p: {**p, "consumer": "nope"},
        lambda p: {**p, "extra": True},
    ],
    ids=[
        "missing-at",
        "missing-consumer",
        "empty-at",
        "bad-at",
        "bad-consumer",
        "extra-key",
    ],
)
def test_setup_handoff_rejects_malformed_canonical_envelope(
    tmp_path: Path, mutator,
):
    module = _install_driver(tmp_path)
    bad = mutator(_canonical_handoff_payload())
    row = {
        "type": "entry_appended",
        "entry": {
            "type": "custom",
            "customType": "coc_setup_handoff",
            "data": bad,
        },
    }
    exit_row = {"type": "driver_pi_exited", "code": 42, "signal": None}
    assert module._setup_handoff_payload(row) is None
    assert module._setup_handoff_proven(
        [row, exit_row], session_role="setup",
    ) is False


def test_setup_handoff_rejects_details_content_disagreement(tmp_path: Path):
    module = _install_driver(tmp_path)
    good = _canonical_handoff_payload()
    bad = _canonical_handoff_payload(campaign_id="other-campaign")
    bad["receipt"] = {**good["receipt"], "campaign_id": "other-campaign"}
    row = {
        "type": "custom_message",
        "customType": "coc_setup_handoff",
        "details": good,
        "content": json.dumps(bad, ensure_ascii=False),
    }
    exit_row = {"type": "driver_pi_exited", "code": 42, "signal": None}
    assert module._setup_handoff_payload(row) is None
    assert module._handoff_stream_unreliable([row]) is True
    assert module._setup_handoff_proven(
        [row, exit_row], session_role="setup",
    ) is False
    malformed_content = {
        "type": "custom_message",
        "customType": "coc_setup_handoff",
        "details": good,
        "content": "not-json",
    }
    assert module._setup_handoff_payload(malformed_content) is None


def test_setup_handoff_late_failure_after_envelope_fails_closed(tmp_path: Path):
    """Valid envelope first, then late non-42/reader/non-JSON, then 42."""
    module = _install_driver(tmp_path)
    envelope = {
        "type": "entry_appended",
        "entry": {
            "type": "custom",
            "customType": "coc_setup_handoff",
            "data": _canonical_handoff_payload(),
        },
    }
    clean_42 = {"type": "driver_pi_exited", "code": 42, "signal": None}
    assert module._setup_handoff_proven([envelope], session_role="setup") is True
    assert module._prompt_turn_complete([envelope], session_role="setup") is True
    late_non42 = [envelope, {"type": "driver_pi_exited", "code": 1, "signal": None}]
    assert module._setup_handoff_proven(late_non42, session_role="setup") is False
    late_signal = [
        envelope,
        {"type": "driver_pi_exited", "code": 42, "signal": 9},
    ]
    assert module._setup_handoff_proven(late_signal, session_role="setup") is False
    late_reader = [
        envelope,
        {
            "type": "driver_pi_exited",
            "code": 42,
            "signal": None,
            "driver_reader_error": "UnicodeDecodeError()",
        },
    ]
    assert module._setup_handoff_proven(late_reader, session_role="setup") is False
    late_non_json = [
        envelope,
        {"type": "driver_non_json_stdout", "raw": "nope"},
        clean_42,
    ]
    assert module._setup_handoff_proven(late_non_json, session_role="setup") is False
    assert module._setup_handoff_proven(
        [envelope, clean_42], session_role="setup",
    ) is True


def test_setup_handoff_accepts_live_message_start_end(tmp_path: Path):
    """Campaign 08 sendMessage shape: message_start/end role=custom."""
    module = _install_driver(tmp_path)
    payload = _canonical_handoff_payload()
    content = json.dumps(payload, ensure_ascii=False)
    start = {
        "type": "message_start",
        "message": {
            "role": "custom",
            "customType": "coc_setup_handoff",
            "content": content,
            "details": payload,
        },
    }
    end = {
        "type": "message_end",
        "message": {
            "role": "custom",
            "customType": "coc_setup_handoff",
            "content": content,
            "details": payload,
        },
    }
    assert module._setup_handoff_payload(start) == payload
    assert module._setup_handoff_payload(end) == payload
    assert module._prompt_turn_complete(
        [start, end], session_role="setup",
    ) is True
    assert module._prompt_turn_complete(
        [start, end], session_role="play",
    ) is False


def test_same_process_consumer_without_exit_is_not_launcher_reexec(
    tmp_path: Path,
):
    module = _install_driver(tmp_path)
    row = {
        "type": "entry_appended",
        "entry": {
            "type": "custom",
            "customType": "coc_setup_handoff",
            "data": _canonical_handoff_payload(consumer="pi-coc/same-process"),
        },
    }
    assert module._setup_handoff_payload(row) is not None
    assert module._setup_handoff_proven([row], session_role="setup") is False
    assert module._setup_handoff_pending([row], session_role="setup") is True
    assert module._prompt_turn_complete([row], session_role="setup") is False


def test_session_role_is_state_not_turn_env(tmp_path: Path):
    """After daemon start, STATE.session_role wins over the turn process env."""
    module = _install_driver(tmp_path)
    module.STATE = tmp_path / "rpc-state.json"
    module.STATE.write_text(
        json.dumps({"session_role": "play"}) + "\n", encoding="utf-8",
    )
    previous = os.environ.get("COC_PI_SESSION_ROLE")
    was_set = "COC_PI_SESSION_ROLE" in os.environ
    try:
        os.environ["COC_PI_SESSION_ROLE"] = "setup"
        assert module._canonical_session_role() == "play"
        module.STATE.write_text(
            json.dumps({"session_role": "setup"}) + "\n", encoding="utf-8",
        )
        os.environ["COC_PI_SESSION_ROLE"] = "play"
        assert module._canonical_session_role() == "setup"
        module.STATE.write_text(
            json.dumps({"session_role": None}) + "\n", encoding="utf-8",
        )
        os.environ["COC_PI_SESSION_ROLE"] = "setup"
        assert module._canonical_session_role() is None
    finally:
        if was_set and previous is not None:
            os.environ["COC_PI_SESSION_ROLE"] = previous
        else:
            os.environ.pop("COC_PI_SESSION_ROLE", None)


def test_driver_setup_handoff_does_not_burn_timeout(setup_daemon: DaemonFixture):
    """Envelope+exit 42 without visible prose/agent_settled completes promptly."""
    started = time.monotonic()
    completed = setup_daemon.turn("__SETUP_HANDOFF_EXIT__ 完成建卡，开桌", timeout=8)
    elapsed = time.monotonic() - started
    assert completed.returncode == 0, completed.stderr
    assert "setup handoff" in completed.stdout
    assert "not waiting for agent_settled" in completed.stdout
    record = _latest_turn_record(setup_daemon)
    assert record["settled"] is True
    assert record["settle_class"] == "setup_handoff"
    assert record["session_role"] == "setup"
    assert not any(
        event.get("type") == "agent_settled" for event in record["events"]
    )
    assert any(
        event.get("type") == "driver_pi_exited" and event.get("code") == 42
        for event in record["events"]
    )
    assert elapsed < 6, f"must not wait out the timeout; elapsed={elapsed:.1f}s"


def test_driver_campaign08_launcher_reexec_then_play_does_not_shortcut(
    setup_daemon: DaemonFixture,
):
    """Campaign 08: launcher envelope, no outer exit 42; then play is ordinary."""
    started = time.monotonic()
    first = setup_daemon.turn("__CAMPAIGN08_HANDOFF__ 确认，打开游戏桌。", timeout=8)
    elapsed = time.monotonic() - started
    assert first.returncode == 0, first.stderr
    assert elapsed < 6, f"must not wait out the timeout; elapsed={elapsed:.1f}s"
    first_record = _latest_turn_record(setup_daemon)
    assert first_record["settled"] is True
    assert first_record["settle_class"] == "setup_handoff"
    assert first_record["session_role"] == "setup"
    assert not any(
        event.get("type") in ("driver_pi_exited", "process_exit")
        for event in first_record["events"]
    )
    assert any(
        event.get("type") == "extension_ui_request"
        and event.get("statusKey") == "coc-loading"
        for event in first_record["events"]
    )
    assert setup_daemon.pi_pid()  # outer process still alive
    state = json.loads(setup_daemon.module.STATE.read_text(encoding="utf-8"))
    assert state["session_role"] == "play"

    second = setup_daemon.turn("__EMPTY_TOOLS__ 我走进门厅", timeout=8)
    assert second.returncode == 5, second.stderr
    second_records = [
        json.loads(path.read_text(encoding="utf-8"))
        for path in setup_daemon.evidence.glob("turn-p-*.json")
        if str(
            json.loads(path.read_text(encoding="utf-8")).get("request", {}).get(
                "message", "",
            )
        ).startswith("__EMPTY_TOOLS__")
    ]
    assert second_records
    second_record = second_records[-1]
    assert second_record["session_role"] == "play"
    assert second_record["settle_class"] == "undelivered_settle_with_tools"
    assert second_record["settled"] is True


def test_driver_setup_handoff_exit_42_is_not_epipe(setup_daemon: DaemonFixture):
    """Clean setup-role exit 42 is the handoff fallback, not EPIPE peer loss."""
    started = time.monotonic()
    completed = setup_daemon.turn("__SETUP_HANDOFF_EXIT__ 完成建卡，开桌", timeout=8)
    elapsed = time.monotonic() - started
    assert completed.returncode == 0, completed.stderr
    assert completed.returncode != 3
    record = _latest_turn_record(setup_daemon)
    assert record["settled"] is True
    assert record["settle_class"] == "setup_handoff"
    assert record["session_role"] == "setup"
    assert elapsed < 6, f"must not wait out the timeout; elapsed={elapsed:.1f}s"


def test_driver_ordinary_tools_without_settle_fails_closed(daemon: DaemonFixture):
    """Ordinary tool-only non-settled turn waits and fails closed."""
    started = time.monotonic()
    completed = daemon.turn("__TOOLS_NO_SETTLE__ 我检查门锁", timeout=2)
    elapsed = time.monotonic() - started
    assert completed.returncode == 2, completed.stderr
    record = _latest_turn_record(daemon)
    assert record["settled"] is False
    assert record["settle_class"] == "not_settled"
    assert record.get("session_role") is None
    assert elapsed >= 1.5
    assert elapsed < 6, f"waited the timeout, not 900s; elapsed={elapsed:.1f}s"


def test_driver_play_exit_42_fails_closed(play_daemon: DaemonFixture):
    """Ordinary play exit 42 is not a successful setup handoff."""
    completed = play_daemon.turn("__PLAY_EXIT_42__ 我继续搜查", timeout=8)
    assert completed.returncode != 0
    record = _latest_turn_record(play_daemon)
    assert record["settled"] is False
    assert record["settle_class"] == "not_settled"
    assert record.get("session_role") == "play"


def test_driver_handoff_exit_42_with_non_json_stream_fails_closed(
    setup_daemon: DaemonFixture,
):
    """Setup-role exit 42 with non-JSON stdout in the same window fails closed."""
    completed = setup_daemon.turn(
        "__HANDOFF_EXIT_EPIPE__ 完成建卡，开桌", timeout=8,
    )
    assert completed.returncode != 0
    record = _latest_turn_record(setup_daemon)
    assert record["settled"] is False
    assert record["settle_class"] == "not_settled"
    assert record["session_role"] == "setup"
    assert any(
        event.get("type") == "driver_non_json_stdout"
        for event in record["events"]
    )


def test_driver_handoff_exit_42_with_reader_error_fails_closed(
    setup_daemon: DaemonFixture,
):
    """Genuine stdout-reader failure plus exit 42 must not be setup_handoff."""
    completed = setup_daemon.turn(
        "__HANDOFF_EXIT_READER_ERROR__ 完成建卡，开桌", timeout=8,
    )
    assert completed.returncode != 0
    record = _latest_turn_record(setup_daemon)
    assert record["settled"] is False
    assert record["settle_class"] == "not_settled"
    assert record["session_role"] == "setup"
    assert any(
        event.get("type") == "driver_pi_exited" and event.get("driver_reader_error")
        for event in record["events"]
    ), record["events"]


def test_driver_handoff_then_reader_error_fails_closed(
    setup_daemon: DaemonFixture,
):
    """Valid envelope first, then reader UTF-8 failure + exit 42, fails closed."""
    completed = setup_daemon.turn(
        "__HANDOFF_THEN_READER_ERROR__ 完成建卡，开桌", timeout=8,
    )
    assert completed.returncode != 0
    record = _latest_turn_record(setup_daemon)
    assert record["settled"] is False
    assert record["settle_class"] == "not_settled"
    assert record["session_role"] == "setup"
    assert any(
        event.get("type") == "driver_pi_exited" and event.get("driver_reader_error")
        for event in record["events"]
    ), record["events"]


def test_driver_handoff_then_exit_1_fails_closed(setup_daemon: DaemonFixture):
    """Valid envelope first, then non-42 exit, fails closed."""
    completed = setup_daemon.turn(
        "__HANDOFF_THEN_EXIT_1__ 完成建卡，开桌", timeout=8,
    )
    assert completed.returncode != 0
    record = _latest_turn_record(setup_daemon)
    assert record["settled"] is False
    assert record["settle_class"] == "not_settled"
    assert record["session_role"] == "setup"


def test_play_daemon_ignores_turn_env_setup_handoff(play_daemon: DaemonFixture):
    """A play daemon cannot be promoted to setup by the turn process env."""
    started = time.monotonic()
    completed = play_daemon.turn(
        "__SETUP_HANDOFF__ 完成建卡，开桌",
        timeout=2,
        extra_env={"COC_PI_SESSION_ROLE": "setup"},
    )
    elapsed = time.monotonic() - started
    assert completed.returncode == 2, completed.stderr
    record = _latest_turn_record(play_daemon)
    assert record["settled"] is False
    assert record["settle_class"] == "not_settled"
    assert record["session_role"] == "play"
    assert elapsed >= 1.5


def test_setup_daemon_ignores_turn_env_play(setup_daemon: DaemonFixture):
    """A setup daemon stays setup even if the turn process env says play."""
    started = time.monotonic()
    completed = setup_daemon.turn(
        "__SETUP_HANDOFF_EXIT__ 完成建卡，开桌",
        timeout=8,
        extra_env={"COC_PI_SESSION_ROLE": "play"},
    )
    elapsed = time.monotonic() - started
    assert completed.returncode == 0, completed.stderr
    record = _latest_turn_record(setup_daemon)
    assert record["settled"] is True
    assert record["settle_class"] == "setup_handoff"
    assert record["session_role"] == "setup"
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
