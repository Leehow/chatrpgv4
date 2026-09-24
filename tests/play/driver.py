#!/usr/bin/env python3
"""tests/play/driver.py -- 真桌驾驭器 (live-play driver) for pi-coc v2 acceptance.

See docs/kernel-rpc.md section 10 (真桌驾驭器) for the contract this
implements, and node_modules/@earendil-works/pi-coding-agent/docs/rpc.md
for the wire protocol spoken to `bin/pi-coc` (a thin wrapper around
`pi --mode rpc`).

Subcommands:
    start   --campaign <id> [--run <run_id>] [--model provider/model] [--launcher <path>]
    turn    "<player text>" [--run <run_id>] [--timeout 300]
    stop    [--run <run_id>]
    log     [--run <run_id>] [--tail N]
    status  [--run <run_id>]

`start` spawns a detached daemon process that owns pi's stdin/stdout for the
lifetime of the run. `turn`/`stop`/`log`/`status` are separate short-lived CLI
invocations that talk to that daemon over a local control socket (`status`
and `log` fall back to reading the evidence files directly when the daemon is
unreachable, so a dead driver stays diagnosable).

Evidence lands under `.coc/playtests/<run_id>/`:
    daemon.json      static run metadata + last known status ("starting"/"ready"/"failed"/"stopped")
    heartbeat.json   rewritten every ~2s by the daemon: pid liveness, turn_count
    driver.log       the daemon's own diagnostic log (see `log` subcommand)
    pi-stderr.log    pi's stderr, verbatim
    events.jsonl     every RPC line received from pi, one JSON object per line
    turn-<n>.json    per-turn summary (player text, final text, tool calls, timings, settle_class)
    final.json       written by `stop`: turn count and totals

Only stdlib is used; run with `uv run --frozen python tests/play/driver.py ...`.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import hashlib
import json
import os
import queue
import socket
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
PLAYTESTS_ROOT = REPO_ROOT / ".coc" / "playtests"
CURRENT_RUN_FILE = PLAYTESTS_ROOT / ".current-run"
DEFAULT_LAUNCHER = REPO_ROOT / "bin" / "pi-coc"
DEFAULT_MODEL = "grok-build/grok-4.7-build-fast"
DEFAULT_THINKING = "low"

ACK_TIMEOUT = 10.0           # seconds to wait for pi's response to get_state/set_model/prompt-accept
STOP_SETTLE_GRACE = 1.5      # seconds to wait for agent_settled after a terminal agent_end
STALE_SETTLE_GRACE = 20.0    # seconds to keep waiting after a settle that arrived before any work
OPENING_QUIET = 3.0          # seconds of silence at startup that mean no opening run is in flight
HEARTBEAT_INTERVAL = 2.0
ACCEPT_POLL_SECONDS = 0.5  # the control socket's accept() wakes this often to notice a stop (Linux never wakes it on close)
TOOL_RESULT_TRUNCATE_BYTES = 4096
STARTUP_READY_TIMEOUT = 30.0

SETTLE_EXIT_CODES = {"settled": 0, "undelivered_with_tools": 5, "empty": 4, "timeout": 3}
NOTICE_DETAIL_KEYS = frozenset({
    "provider_outage", "commit_unavailable", "delivery_cut_short", "refused_effect",
    "preparation_wait", "resend_held", "turn_unfinished", "standing_conditions",
    "input_refused", "empty_input", "review_unavailable",
})


class DriverError(Exception):
    """A clean, user-facing driver failure (as opposed to an internal bug)."""


class DaemonUnavailable(Exception):
    """The control socket for a run could not be reached."""


# --------------------------------------------------------------------------
# small file/time helpers
# --------------------------------------------------------------------------

def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def utc_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def run_dir(run_id: str) -> Path:
    return PLAYTESTS_ROOT / run_id


def write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + f".tmp{os.getpid()}")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def read_json(path: Path, default=None):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def append_jsonl(path: Path, obj) -> None:
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(obj, ensure_ascii=False) + "\n")


def truncate_bytes(s: str, limit: int) -> str:
    b = s.encode("utf-8")
    if len(b) <= limit:
        return s
    return b[:limit].decode("utf-8", errors="ignore") + "...[truncated]"


def extract_result_text(result) -> str:
    if not isinstance(result, dict):
        return "" if result is None else str(result)
    parts = []
    for block in result.get("content") or []:
        if isinstance(block, dict) and block.get("type") == "text":
            parts.append(block.get("text") or "")
    return "\n".join(parts)


def extract_host_delivery(message: dict) -> dict | None:
    """Classify a visible host envelope by the contract's closed notice markers."""
    details = message.get("details")
    if (message.get("customType") != "coc-delivery" or message.get("display") is not True
            or not isinstance(message.get("content"), str)
            or not isinstance(details, dict) or details.get("coc_delivery") is not True):
        return None
    kind = "notice" if NOTICE_DETAIL_KEYS.intersection(details) else "narrate"
    return {"kind": kind, "rendered_text": message["content"], "mechanics": [],
            "pending_choice": None, "details": deepcopy(details)}


def resolve_launcher(launcher_arg: str | None) -> Path:
    if launcher_arg:
        return Path(launcher_arg).resolve()
    env = os.environ.get("PI_COC_LAUNCHER")
    if env:
        return Path(env).resolve()
    return DEFAULT_LAUNCHER


def resolve_run_id(explicit: str | None) -> str:
    if explicit:
        return explicit
    info = read_json(CURRENT_RUN_FILE, None)
    if info and info.get("run_id"):
        return info["run_id"]
    print("error: no --run given and no current run recorded; pass --run <run_id>", file=sys.stderr)
    raise SystemExit(2)


def control_socket_path(run_id: str) -> Path:
    # A unix socket path must stay under the platform's sun_path limit
    # (~104 bytes on macOS). .coc/playtests/<run_id>/control.sock does not
    # reliably fit once the repo checkout itself lives at a long path (this
    # project's worktrees do), so the socket lives in the system temp dir,
    # named by a short hash of the run dir, and its real location is
    # recorded in daemon.json/heartbeat.json for diagnosability.
    digest = hashlib.sha1(str(run_dir(run_id)).encode("utf-8")).hexdigest()[:16]
    return Path(tempfile.gettempdir()) / f"pi-coc-play-{digest}.sock"


class DriverLog:
    """Append-only text log, safe to write from multiple threads."""

    def __init__(self, path: Path):
        self.path = path
        self._lock = threading.Lock()

    def write(self, msg: str) -> None:
        line = f"{now_iso()} {msg}\n"
        with self._lock:
            with self.path.open("a", encoding="utf-8") as f:
                f.write(line)


def print_log_tail(path: Path, n: int) -> None:
    if not path.exists():
        print(f"(no log at {path})", file=sys.stderr)
        return
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    for line in lines[-n:]:
        print(line)


# --------------------------------------------------------------------------
# pi subprocess: owns stdin/stdout, one supervised reader thread
# --------------------------------------------------------------------------

class PiProcess:
    """Owns pi's stdin/stdout/stderr for the life of a run.

    The reader thread must never die while pi is alive: an unread stdout
    pipe eventually fills and blocks pi, and any accidental close of our
    end of stdin delivers EPIPE to pi on its next write. So the read loop
    only stops on stdout EOF (pi exited); every exception raised while
    handling a single line is caught and logged, never allowed to escape.
    """

    def __init__(self, launcher: Path, args: list[str], stderr_log_path: Path,
                 events_path: Path, log: DriverLog,
                 cwd: Path | None = None, env: dict[str, str] | None = None):
        self.log = log
        self.events_path = events_path
        self._stderr_f = open(stderr_log_path, "ab", buffering=0)
        # `cwd`/`env` default to the table's own: the repo and this process's environment. The
        # persona benchmark (docs/specs/player-persona-benchmark.md) reuses this transport for a
        # second pi that must NOT see the repo -- an empty cwd and its own Pi home are how the
        # player process is kept from reading the module it is supposed to be discovering.
        self.proc = subprocess.Popen(
            [str(launcher), *args],
            cwd=str(cwd or REPO_ROOT),
            env=env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=self._stderr_f,
        )
        self._stdin_lock = threading.Lock()
        self._waiters_lock = threading.Lock()
        self._waiters: dict[str, "queue.Queue"] = {}
        self._turn_lock = threading.Lock()
        self._turn_queue: "queue.Queue | None" = None
        self.reader_error: str | None = None
        self._reader_thread = threading.Thread(target=self._read_loop, name="pi-stdout-reader", daemon=True)
        self._reader_thread.start()

    def send(self, obj: dict) -> None:
        line = (json.dumps(obj, ensure_ascii=False) + "\n").encode("utf-8")
        with self._stdin_lock:
            self.proc.stdin.write(line)
            self.proc.stdin.flush()

    def call(self, obj: dict, timeout: float) -> dict | None:
        """Send a command carrying an id and wait for its matching response line."""
        req_id = obj.get("id") or uuid.uuid4().hex
        obj["id"] = req_id
        q: "queue.Queue" = queue.Queue()
        with self._waiters_lock:
            self._waiters[req_id] = q
        try:
            self.send(obj)
            try:
                return q.get(timeout=timeout)
            except queue.Empty:
                return None
        finally:
            with self._waiters_lock:
                self._waiters.pop(req_id, None)

    def begin_turn(self) -> "queue.Queue":
        q: "queue.Queue" = queue.Queue()
        with self._turn_lock:
            self._turn_queue = q
        return q

    def end_turn(self) -> None:
        with self._turn_lock:
            self._turn_queue = None

    def alive(self) -> bool:
        return self.proc.poll() is None

    def _read_loop(self) -> None:
        stdout = self.proc.stdout
        try:
            while True:
                raw = stdout.readline()  # binary mode: splits on b"\n" only, per rpc.md framing rules
                if raw == b"":
                    self.log.write("pi-stdout: EOF, pi process ended")
                    break
                try:
                    self._handle_line(raw)
                except Exception as exc:  # noqa: BLE001 -- must never kill the drain loop
                    self.log.write(f"pi-stdout: error handling line: {exc!r} raw={raw[:200]!r}")
        except Exception as exc:  # noqa: BLE001
            self.reader_error = repr(exc)
            self.log.write(f"pi-stdout: reader loop crashed: {exc!r}")

    def _handle_line(self, raw: bytes) -> None:
        text = raw[:-1] if raw.endswith(b"\n") else raw
        if text.endswith(b"\r"):
            text = text[:-1]
        if not text:
            return
        try:
            obj = json.loads(text.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            self.log.write(f"pi-stdout: non-JSON line ignored: {exc!r} raw={raw[:200]!r}")
            return
        obj["_recv_at"] = now_iso()
        obj["_recv_mono"] = time.monotonic()
        append_jsonl(self.events_path, obj)
        req_id = obj.get("id")
        if req_id is not None:
            with self._waiters_lock:
                q = self._waiters.get(req_id)
            if q is not None:
                q.put(obj)
        with self._turn_lock:
            tq = self._turn_queue
        if tq is not None:
            tq.put(obj)

    def terminate(self, timeout: float = 5.0) -> None:
        if self.proc.poll() is not None:
            return
        try:
            self.proc.terminate()
            self.proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            self.proc.kill()
            try:
                self.proc.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                pass
        finally:
            for stream in (self.proc.stdin, self._stderr_f):
                try:
                    stream.close()
                except Exception:  # noqa: BLE001
                    pass


# --------------------------------------------------------------------------
# the daemon itself
# --------------------------------------------------------------------------

class Daemon:
    def __init__(self, run_id: str, campaign: str, launcher: str | None, model: str | None):
        self.run_id = run_id
        self.campaign = campaign
        self.dir = run_dir(run_id)
        self.dir.mkdir(parents=True, exist_ok=True)
        self.log = DriverLog(self.dir / "driver.log")
        self.events_path = self.dir / "events.jsonl"
        self.daemon_json_path = self.dir / "daemon.json"
        self.heartbeat_path = self.dir / "heartbeat.json"
        self.socket_path = control_socket_path(run_id)
        self.turn_count = 0
        self.turn_lock = threading.Lock()
        self.turn_in_progress = False
        self._stop_requested = threading.Event()
        self._server_sock: socket.socket | None = None
        self.started_at = now_iso()
        self.pi: PiProcess | None = None

        try:
            self._start_pi(launcher, campaign, model)
        except DriverError as exc:
            self.log.write(f"startup failed: {exc}")
            write_json(self.daemon_json_path, {
                "run_id": run_id, "campaign": campaign, "status": "failed",
                "error": str(exc), "daemon_pid": os.getpid(), "started_at": self.started_at,
            })
            if self.pi is not None:
                self.pi.terminate()
            raise

    def _start_pi(self, launcher_arg: str | None, campaign: str, model: str | None) -> None:
        launcher_path = resolve_launcher(launcher_arg)
        if not launcher_path.exists():
            raise DriverError(
                f"launcher not found: {launcher_path} "
                f"(pass --launcher, set PI_COC_LAUNCHER, or wait for bin/pi-coc to exist)"
            )
        launch_args = ["--campaign", campaign, "--mode", "rpc", "--no-session",
                       "--thinking", DEFAULT_THINKING]
        if model:
            if "/" not in model:
                raise DriverError(f"--model must be 'provider/modelId', got {model!r}")
            provider, model_id = model.split("/", 1)
            launch_args += ["--provider", provider, "--model", model_id]
        self.log.write(f"spawning {launcher_path} {' '.join(launch_args)}")
        self.pi = PiProcess(
            launcher_path,
            launch_args,
            self.dir / "pi-stderr.log",
            self.events_path,
            self.log,
        )
        write_json(self.daemon_json_path, {
            "run_id": self.run_id, "campaign": campaign, "launcher": str(launcher_path),
            "daemon_pid": os.getpid(), "pi_pid": self.pi.proc.pid,
            "model_requested": model, "started_at": self.started_at,
            "socket_path": str(self.socket_path), "status": "starting",
        })

        ready = self.pi.call({"type": "get_state"}, timeout=ACK_TIMEOUT)
        if ready is None or not ready.get("success", False):
            raise DriverError(
                f"pi did not answer get_state within {ACK_TIMEOUT}s (got {ready!r}); "
                f"see {self.dir / 'pi-stderr.log'}"
            )

        model_result = None
        if model:
            model_result = self._set_model(model)
            if model_result is None or not model_result.get("success", False):
                raise DriverError(f"set_model({model!r}) failed: {model_result!r}")

        write_json(self.daemon_json_path, {
            "run_id": self.run_id, "campaign": campaign, "launcher": str(launcher_path),
            "daemon_pid": os.getpid(), "pi_pid": self.pi.proc.pid,
            "model_requested": model, "model_confirmed": (model_result or {}).get("data"),
            "started_at": self.started_at, "socket_path": str(self.socket_path), "status": "ready",
        })
        self._write_heartbeat("ready")
        self.log.write("daemon ready")

    def _await_quiet(self, tq: "queue.Queue", deadline: float) -> bool:
        """Wait for the agent to be idle before a turn's prompt goes in.

        Opening the table is a keeper run of its own: the launcher starts it with no player input.
        Its `agent_settled` used to arrive while the first `turn` was already listening, ending that
        turn in a tenth of a second with nothing recorded -- while the keeper went on playing it
        unwatched. The session's turn count stopped being true and the turn's evidence lived in
        `events.jsonl` and nowhere else. A turn now begins from a quiet agent, so the settle it waits
        for can only be its own.
        """
        while True:
            now = time.monotonic()
            wait_for = min(OPENING_QUIET, deadline - now)
            if wait_for <= 0:
                return False
            try:
                event = tq.get(timeout=wait_for)
            except queue.Empty:
                event = None
            if not self.pi.alive():
                return False
            if event is None or event.get("type") == "agent_settled":
                # A slow model can be silent; only the transport state establishes an idle owner.
                state = self.pi.call({"type": "get_state"}, timeout=min(ACK_TIMEOUT, max(0.001, deadline-time.monotonic())))
                data = (state or {}).get("data", {})
                if state and state.get("success") and data.get("isStreaming") is False and not any(data.get(key) for key in ("isCompacting", "pendingMessageCount")):
                    return True

    def _set_model(self, model: str) -> dict | None:
        if "/" not in model:
            raise DriverError(f"--model must be 'provider/modelId', got {model!r}")
        provider, model_id = model.split("/", 1)
        return self.pi.call({"type": "set_model", "provider": provider, "modelId": model_id}, timeout=ACK_TIMEOUT)

    def _write_heartbeat(self, status: str) -> None:
        write_json(self.heartbeat_path, {
            "at": now_iso(), "status": status, "daemon_pid": os.getpid(),
            "pi_pid": self.pi.proc.pid if self.pi else None,
            "pi_alive": self.pi.alive() if self.pi else False,
            "turn_count": self.turn_count, "turn_in_progress": self.turn_in_progress,
        })

    def heartbeat_loop(self) -> None:
        while not self._stop_requested.is_set():
            self._write_heartbeat("running" if self.pi.alive() else "pi_dead")
            self._stop_requested.wait(HEARTBEAT_INTERVAL)

    # -- turn handling -----------------------------------------------------

    def handle_turn(self, text: str, timeout: float) -> dict:
        with self.turn_lock:
            if self.turn_in_progress:
                return {"ok": False, "error": "a turn is already in progress on this run"}
            self.turn_in_progress = True
        try:
            return self._run_turn(text, timeout)
        finally:
            self.turn_in_progress = False

    def _run_turn(self, text: str, timeout: float) -> dict:
        self.turn_count += 1
        n = self.turn_count
        started_mono = time.monotonic()
        started_at = now_iso()
        tq = self.pi.begin_turn()
        try:
            if not self._await_quiet(tq, started_mono + timeout):
                return self._finalize_turn(n, text, started_at, started_mono, [], "",
                                            "timeout", "previous Keeper run did not become idle")
            # Pi acknowledges only after prompt preflight; cold source guidance is part of this turn.
            remaining = max(0.001, started_mono + timeout - time.monotonic())
            ack = self.pi.call({"type": "prompt", "message": text}, timeout=remaining)
            if ack is None:
                self.pi.call({"type": "abort"}, timeout=ACK_TIMEOUT)
                return self._finalize_turn(n, text, started_at, started_mono, [], "",
                                            "timeout", "prompt preflight exceeded turn timeout")
            if not ack.get("success", False):
                return self._finalize_turn(n, text, started_at, started_mono, [], "",
                                            "empty", f"prompt rejected: {ack.get('error')}")

            tools: dict[str, dict] = {}
            tool_order: list[str] = []
            text_parts: list[str] = []
            final_text_parts: list[str] = []
            # The kernel's own rendered prose, taken off the narrate/ask result. This is the channel
            # PipiCOC reads (`pipicoc/mechanics.js`), and it is the only one that is there whatever the
            # model does with its messages: a Keeper that stops on the message carrying the call leaves
            # the assistant-side replacement nowhere to land, and the turn read as undelivered while the
            # player in the app had been given the words (contract §32.9).
            delivered = ""
            delivery: dict | None = None
            notices: list[dict] = []
            rejected_delivery = False

            def capture_host_delivery(host: dict) -> None:
                nonlocal delivered, delivery, rejected_delivery
                rejected_delivery = False
                if host["kind"] == "notice":
                    notices.append({"content": host["rendered_text"], "details": deepcopy(host["details"])})
                    if delivery is None:
                        delivery = host
                        delivered = host["rendered_text"]
                elif delivery is None or delivery["kind"] == "notice":
                    delivery = host
                    delivered = host["rendered_text"]
                elif not delivered:
                    # Host publication can fill missing prose, but never erase tool mechanics/choice.
                    delivered = host["rendered_text"]
                    delivery["rendered_text"] = delivered

            stop_reason: str | None = None
            deadline = started_mono + timeout
            settle_deadline: float | None = None
            # A settle belongs to whatever the agent was doing when it arrived. The turn queue opens
            # before the prompt is accepted, so the previous run's `agent_settled` can land in it and
            # end this turn before its own work has begun -- the turn is then recorded as empty while
            # the keeper goes on playing it unwatched, and a session's turn count stops being true.
            # Nothing is honoured as this turn's ending until this turn has been seen to start.
            saw_work = False
            stale_settles = 0
            stale_deadline: float | None = None

            while True:
                now = time.monotonic()
                wake_at = min(x for x in (settle_deadline, stale_deadline, deadline) if x is not None)
                wait_for = wake_at - now
                if wait_for <= 0:
                    if stale_deadline is not None and now >= stale_deadline and not saw_work:
                        stop_reason = "settled_before_any_work"
                        break
                    if now >= deadline:
                        stop_reason = "timeout"
                        break
                    if settle_deadline is not None and now >= settle_deadline:
                        break
                    stale_deadline = None
                    continue
                try:
                    event = tq.get(timeout=wait_for)
                except queue.Empty:
                    continue

                etype = event.get("type")
                if etype in ("agent_start", "turn_start", "tool_execution_start", "tool_execution_update",
                              "tool_execution_end", "message_start", "message_update", "message_end"):
                    saw_work = True
                    stale_deadline = None
                    settle_deadline = None
                    stop_reason = None
                if etype == "agent_start":
                    # A repair run replaces the previous unpublished draft, not a delivered result.
                    text_parts.clear()
                    final_text_parts.clear()
                if etype == "message_update":
                    ev = event.get("assistantMessageEvent") or {}
                    if ev.get("type") == "text_delta" and (event.get("message") or {}).get("display") is not False:
                        text_parts.append(ev.get("delta") or "")
                elif etype == "message_end":
                    msg = event.get("message") or {}
                    host = extract_host_delivery(msg) if msg.get("role") == "custom" else None
                    if host is not None:
                        capture_host_delivery(host)
                    elif msg.get("role") == "assistant" and msg.get("display") is False:
                        final_text_parts.clear()
                        text_parts.clear()
                    elif msg.get("role") == "assistant":
                        # The delivery is the last assistant message; earlier ones carry
                        # tool calls (their text, if any, is not table speech).
                        final_text_parts = [
                            block.get("text") or ""
                            for block in msg.get("content") or []
                            if isinstance(block, dict) and block.get("type") == "text"
                        ]
                elif etype == "tool_execution_start":
                    tcid = event.get("toolCallId")
                    tools[tcid] = {"name": event.get("toolName"), "args": event.get("args"),
                                    "_started_mono": event.get("_recv_mono", now)}
                    if tcid not in tool_order:
                        tool_order.append(tcid)
                elif etype == "tool_execution_end":
                    tcid = event.get("toolCallId")
                    rec = tools.setdefault(tcid, {"name": event.get("toolName"), "args": None,
                                                   "_started_mono": event.get("_recv_mono", now)})
                    ms = round((event.get("_recv_mono", now) - rec["_started_mono"]) * 1000, 1)
                    rec.update({
                        "result_text": truncate_bytes(extract_result_text(event.get("result")),
                                                       TOOL_RESULT_TRUNCATE_BYTES),
                        "ms": ms, "is_error": event.get("isError", False),
                    })
                    if rec["name"] in ("narrate", "ask") and event.get("isError", False):
                        rejected_delivery = True
                    if rec["name"] in ("narrate", "ask") and not event.get("isError", False):
                        try:
                            body = json.loads(extract_result_text(event.get("result")) or "{}")
                        except (ValueError, TypeError):
                            body = {}
                        if isinstance(body, dict) and isinstance(body.get("rendered_text"), str):
                            delivered = body["rendered_text"]
                            rejected_delivery = False
                        if isinstance(body, dict):
                            # What a player actually sees is prose *plus* this turn's mechanics
                            # (§16.2/§16.3: numbers never enter the prose, PipiCOC draws them from
                            # here). Keeping the parsed delivery means a reader of this run does not
                            # have to re-parse `result_text`, which is truncated.
                            delivery = {"kind": rec["name"],
                                        "rendered_text": body.get("rendered_text") or "",
                                        "mechanics": body.get("mechanics") or [],
                                        "pending_choice": body.get("pending_choice")}
                elif etype == "entry_appended":
                    entry = event.get("entry") or {}
                    data = entry.get("data") or {}
                    host = extract_host_delivery(entry)
                    if host is not None:
                        capture_host_delivery(host)
                    elif entry.get("customType") == "coc-telemetry" and data.get("tool") == "narrate" and data.get("implicit"):
                        rejected_delivery = data.get("ok") is False
                elif etype == "agent_settled":
                    if not saw_work:
                        # The previous run finishing, not this turn. Keep waiting for this one.
                        stale_settles += 1
                        stale_deadline = time.monotonic() + STALE_SETTLE_GRACE
                        continue
                    stop_reason = "agent_settled"
                    break
                elif etype == "agent_end":
                    if event.get("willRetry") or not saw_work:
                        settle_deadline = None  # more automatic work coming; don't stop yet
                    else:
                        stop_reason = "agent_end"
                        settle_deadline = time.monotonic() + STOP_SETTLE_GRACE

                if not self.pi.alive():
                    stop_reason = stop_reason or "pi_died"
                    break

            final_text = delivered.strip()
            if not final_text and not rejected_delivery:
                final_text = "".join(final_text_parts).strip()
            if not final_text and not rejected_delivery:
                final_text = "".join(text_parts).strip()
            tool_records = [tools[t] for t in tool_order if t in tools]

            if stop_reason == "timeout":
                settle_class = "timeout"
            elif stop_reason == "settled_before_any_work":
                settle_class = "empty"
            elif final_text:
                settle_class = "settled"
            elif tool_records:
                settle_class = "undelivered_with_tools"
            else:
                settle_class = "empty"

            return self._finalize_turn(n, text, started_at, started_mono, tool_records,
                                        final_text, settle_class, stop_reason,
                                        stale_settles=stale_settles, delivery=delivery,
                                        **({"notices": notices} if notices else {}))
        finally:
            self.pi.end_turn()

    def _finalize_turn(self, n: int, player_text: str, started_at: str, started_mono: float,
                        tool_records: list[dict], final_text: str,
                        settle_class: str, stop_reason: str | None, stale_settles: int = 0,
                        delivery: dict | None = None, notices: list[dict] | None = None) -> dict:
        wall_seconds = round(time.monotonic() - started_mono, 3)
        clean_tools = [
            {"name": t.get("name"), "args": t.get("args"), "result_text": t.get("result_text", ""),
             "ms": t.get("ms"), "is_error": t.get("is_error", False)}
            for t in tool_records
        ]
        summary = {
            "run_id": self.run_id, "turn": n, "player_text": player_text,
            "final_text": final_text, "tools": clean_tools,
            "wall_seconds": wall_seconds, "settle_class": settle_class,
            "stop_reason": stop_reason, "started_at": started_at, "ended_at": now_iso(),
            # How many settles arrived before this turn had begun; each one would have ended the
            # turn early and left the keeper playing it unwatched.
            **({"stale_settles": stale_settles} if stale_settles else {}),
            # The player-visible kernel delivery (§16.2) or terminal host notice (§13.11).
            **({"delivery": delivery} if delivery else {}),
            **({"notices": notices} if notices else {}),
        }
        write_json(self.dir / f"turn-{n}.json", summary)
        self._write_heartbeat("running")
        tool_names = [t["name"] for t in clean_tools]
        self.log.write(f"turn {n} settle_class={settle_class} stop_reason={stop_reason} "
                        f"wall={wall_seconds}s tools={tool_names}")
        return {"ok": True, "summary": summary}

    # -- stop ---------------------------------------------------------------

    def handle_stop(self) -> dict:
        if self.turn_in_progress:
            self.log.write("stop: a turn is in flight, sending abort")
            self.pi.call({"type": "abort"}, timeout=ACK_TIMEOUT)
        self.pi.terminate()
        totals = self._compute_totals()
        final = {
            "run_id": self.run_id, "campaign": self.campaign, "turn_count": self.turn_count,
            "started_at": self.started_at, "ended_at": now_iso(), "totals": totals,
        }
        write_json(self.dir / "final.json", final)
        self._write_heartbeat("stopped")
        info = read_json(self.daemon_json_path, {}) or {}
        info["status"] = "stopped"
        write_json(self.daemon_json_path, info)
        self.log.write("daemon stopped")
        return {"ok": True, "final": final}

    def _compute_totals(self) -> dict:
        tool_calls = 0
        wall_seconds = 0.0
        for i in range(1, self.turn_count + 1):
            t = read_json(self.dir / f"turn-{i}.json", {}) or {}
            tool_calls += len(t.get("tools") or [])
            wall_seconds += t.get("wall_seconds") or 0.0
        return {"tool_calls": tool_calls, "wall_seconds": round(wall_seconds, 3)}

    # -- control socket -------------------------------------------------------

    def serve_forever(self) -> None:
        if self.socket_path.exists():
            self.socket_path.unlink()
        srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        srv.bind(str(self.socket_path))
        srv.listen(8)
        # Linux does not wake a blocked accept() when another thread closes the listening socket (macOS does), so
        # the loop polls the stop flag on a short timeout; the stop handler also shuts the socket down before closing.
        srv.settimeout(ACCEPT_POLL_SECONDS)
        self._server_sock = srv
        hb_thread = threading.Thread(target=self.heartbeat_loop, name="heartbeat", daemon=True)
        hb_thread.start()
        self.log.write(f"control socket listening at {self.socket_path}")
        try:
            while not self._stop_requested.is_set():
                try:
                    conn, _ = srv.accept()
                except socket.timeout:
                    continue
                except OSError:
                    break
                conn.settimeout(None)
                threading.Thread(target=self._handle_conn, args=(conn,),
                                  name="conn-handler", daemon=True).start()
        finally:
            self._stop_requested.set()
            hb_thread.join(timeout=HEARTBEAT_INTERVAL + 1)
            try:
                srv.close()
            except Exception:  # noqa: BLE001
                pass
            try:
                self.socket_path.unlink()
            except Exception:  # noqa: BLE001
                pass

    def _handle_conn(self, conn: socket.socket) -> None:
        try:
            f = conn.makefile("rwb")
            line = f.readline()
            if not line:
                return
            try:
                req = json.loads(line.decode("utf-8"))
            except json.JSONDecodeError as exc:
                self._respond(f, {"ok": False, "error": f"bad request json: {exc}"})
                return
            cmd = req.get("cmd")
            if cmd in ("ping", "status"):
                self._respond(f, {
                    "ok": True, "daemon_pid": os.getpid(), "pi_pid": self.pi.proc.pid,
                    "pi_alive": self.pi.alive(), "turn_count": self.turn_count,
                    "turn_in_progress": self.turn_in_progress,
                })
            elif cmd == "turn":
                result = self.handle_turn(req.get("text", ""), float(req.get("timeout", 300)))
                self._respond(f, result)
            elif cmd == "stop":
                result = self.handle_stop()
                self._respond(f, result)
                self._stop_requested.set()
                try:
                    self._server_sock.shutdown(socket.SHUT_RDWR)
                except Exception:  # noqa: BLE001
                    pass
                try:
                    self._server_sock.close()
                except Exception:  # noqa: BLE001
                    pass
            else:
                self._respond(f, {"ok": False, "error": f"unknown cmd {cmd!r}"})
        except Exception as exc:  # noqa: BLE001
            self.log.write(f"conn handler error: {exc!r}")
        finally:
            try:
                conn.close()
            except Exception:  # noqa: BLE001
                pass

    @staticmethod
    def _respond(f, obj: dict) -> None:
        f.write((json.dumps(obj, ensure_ascii=False) + "\n").encode("utf-8"))
        f.flush()


def _daemon_main(args: argparse.Namespace) -> int:
    try:
        daemon = Daemon(run_id=args.run, campaign=args.campaign, launcher=args.launcher, model=args.model)
    except DriverError:
        return 1
    except Exception as exc:  # noqa: BLE001 -- startup crash must still be diagnosable
        rdir = run_dir(args.run)
        rdir.mkdir(parents=True, exist_ok=True)
        DriverLog(rdir / "driver.log").write(f"daemon crashed during startup: {exc!r}")
        write_json(rdir / "daemon.json", {
            "run_id": args.run, "campaign": args.campaign, "status": "failed",
            "error": repr(exc), "daemon_pid": os.getpid(), "started_at": now_iso(),
        })
        return 1
    try:
        daemon.serve_forever()
    except Exception as exc:  # noqa: BLE001
        daemon.log.write(f"serve_forever crashed: {exc!r}")
        return 1
    return 0


# --------------------------------------------------------------------------
# client side: talking to a (possibly dead) daemon over its control socket
# --------------------------------------------------------------------------

def _connect(run_id: str, timeout: float) -> socket.socket:
    sock_path = control_socket_path(run_id)
    if not sock_path.exists():
        raise DaemonUnavailable(f"control socket not found at {sock_path}; daemon likely not running")
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.settimeout(timeout)
    try:
        s.connect(str(sock_path))
    except OSError as exc:
        s.close()
        raise DaemonUnavailable(f"cannot connect to daemon at {sock_path}: {exc}") from exc
    return s


def rpc_call(run_id: str, req: dict, timeout: float) -> dict:
    s = _connect(run_id, timeout)
    try:
        f = s.makefile("rwb")
        f.write((json.dumps(req, ensure_ascii=False) + "\n").encode("utf-8"))
        f.flush()
        line = f.readline()
        if not line:
            raise DaemonUnavailable("daemon closed the connection without responding")
        return json.loads(line.decode("utf-8"))
    except socket.timeout as exc:
        raise DaemonUnavailable(f"daemon did not respond within {timeout}s (may be hung)") from exc
    finally:
        s.close()


def _best_effort_final(rdir: Path) -> dict:
    info = read_json(rdir / "daemon.json", {}) or {}
    turns = sorted(rdir.glob("turn-*.json"))
    tool_calls = 0
    wall = 0.0
    for tp in turns:
        t = read_json(tp, {}) or {}
        tool_calls += len(t.get("tools") or [])
        wall += t.get("wall_seconds") or 0.0
    return {
        "run_id": info.get("run_id"), "campaign": info.get("campaign"),
        "turn_count": len(turns), "started_at": info.get("started_at"), "ended_at": now_iso(),
        "totals": {"tool_calls": tool_calls, "wall_seconds": round(wall, 3)},
        "note": "control socket was unreachable; totals reconstructed from turn-*.json files on disk",
    }


def _wait_for_ready(rdir: Path, timeout: float) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        info = read_json(rdir / "daemon.json", None)
        if info is not None:
            status = info.get("status")
            if status == "ready":
                return True
            if status == "failed":
                return False
        time.sleep(0.2)
    return False


# --------------------------------------------------------------------------
# CLI subcommands
# --------------------------------------------------------------------------

def coc_home() -> Path:
    """Where `.coc/` lives for this checkout: `PI_COC_HOME` when set (as bin/pi-coc reads it), else the repo root."""
    raw = os.environ.get("PI_COC_HOME", "").strip()
    if not raw:
        return REPO_ROOT
    expanded = Path(raw).expanduser()
    return expanded if expanded.is_absolute() else (REPO_ROOT / expanded).resolve()


def create_pregen_campaign(campaign: str, pregen: str, module: str, play_language: str) -> None:
    """The template-sheet entry (user request 2026-09-15): one `campaign.create` against the built kernel,
    exactly what the kernel test fixtures do, so a table is playable without the five creation turns.
    The kernel is spoken to directly over its JSON-lines RPC; nothing here fabricates a turn."""
    entry = REPO_ROOT / "build" / "kernel" / "rpc.mjs"
    if not entry.is_file():
        raise RuntimeError("build the kernel first: npm run build:runtime")
    home = coc_home()
    request = {"id": "start-pregen", "method": "campaign.create",
               "params": {"id": campaign, "module": module, "pregen": pregen, "play_language": play_language}}
    proc = subprocess.Popen(["node", str(entry), "--workspace", str(home), "--content", str(REPO_ROOT / "content")],
                            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, cwd=str(REPO_ROOT))
    try:
        out, err = proc.communicate(json.dumps(request) + "\n", timeout=120)
    finally:
        if proc.poll() is None:
            proc.kill()
    response = None
    for line in out.splitlines():
        try:
            parsed = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict) and parsed.get("id") == request["id"]:
            response = parsed
    if not response or not response.get("ok"):
        raise RuntimeError(f"campaign.create failed: {json.dumps((response or {}).get('error') or err.strip()[-400:] or out.strip()[-400:], ensure_ascii=False)}")


def cmd_start(args: argparse.Namespace) -> int:
    campaign = args.campaign
    if args.pregen:
        campaign_dir = coc_home() / ".coc" / "campaigns" / campaign
        if campaign_dir.exists():
            print(f"campaign {campaign} already exists; --pregen ignored", file=sys.stderr)
        else:
            try:
                create_pregen_campaign(campaign, args.pregen, args.module, args.play_language)
            except Exception as error:  # noqa: BLE001 - the reason is printed and the start refused
                print(f"error: {error}", file=sys.stderr)
                return 1
            print(f"created campaign {campaign} from pregen {args.pregen} ({args.module}, {args.play_language})")
    run_id = args.run or f"{campaign}-{utc_stamp()}"
    rdir = run_dir(run_id)
    if rdir.exists() and any(rdir.iterdir()):
        print(f"error: run dir already exists and is non-empty: {rdir}", file=sys.stderr)
        return 1
    rdir.mkdir(parents=True, exist_ok=True)

    daemon_stdout_log = rdir / "daemon-stdout.log"
    cmd = [sys.executable, str(Path(__file__).resolve()), "_daemon",
           "--run", run_id, "--campaign", campaign]
    if args.launcher:
        cmd += ["--launcher", args.launcher]
    if args.model:
        cmd += ["--model", args.model]

    env = dict(os.environ)
    for pair in args.env or []:
        if "=" not in pair:
            print(f"error: --env expects KEY=VALUE, got {pair!r}", file=sys.stderr)
            return 1
        key, value = pair.split("=", 1)
        env[key] = value

    with open(daemon_stdout_log, "ab") as log_f:
        subprocess.Popen(cmd, cwd=str(REPO_ROOT), stdin=subprocess.DEVNULL,
                          stdout=log_f, stderr=subprocess.STDOUT, start_new_session=True,
                          env=env)

    if not _wait_for_ready(rdir, timeout=STARTUP_READY_TIMEOUT):
        info = read_json(rdir / "daemon.json", {}) or {}
        if info.get("status") == "failed":
            print(f"error: daemon failed to start: {info.get('error')}", file=sys.stderr)
        else:
            print(f"error: daemon did not become ready within {STARTUP_READY_TIMEOUT}s "
                  f"(run {run_id})", file=sys.stderr)
        print_log_tail(rdir / "driver.log", 40)
        print_log_tail(daemon_stdout_log, 20)
        return 1

    if not args.no_default_run:
        # The benchmark starts many runs at once and must not steal this pointer: a human
        # playing a real table in the same checkout would find their bare `driver.py turn`
        # talking to a benchmark run (tests/play/bench.py always passes --no-default-run).
        write_json(CURRENT_RUN_FILE, {"run_id": run_id})
    info = read_json(rdir / "daemon.json", {}) or {}
    print(f"started run {run_id} (daemon pid {info.get('daemon_pid')}, pi pid {info.get('pi_pid')})")
    print(f"evidence: {rdir}")
    return 0


def cmd_turn(args: argparse.Namespace) -> int:
    run_id = resolve_run_id(args.run)
    rdir = run_dir(run_id)
    timeout = args.timeout
    try:
        resp = rpc_call(run_id, {"cmd": "turn", "text": args.text, "timeout": timeout}, timeout=timeout + 15.0)
    except DaemonUnavailable as exc:
        print(f"error: {exc}", file=sys.stderr)
        print_log_tail(rdir / "driver.log", 40)
        return 2
    if not resp.get("ok"):
        print(f"error: turn rejected: {resp.get('error')}", file=sys.stderr)
        print_log_tail(rdir / "driver.log", 40)
        return 2

    summary = resp["summary"]
    print(summary.get("final_text") or "(no assistant text this turn)")
    for index, notice in enumerate(summary.get("notices") or []):
        if index == 0 and (summary.get("delivery") or {}).get("kind") == "notice":
            continue  # The first notice is already printed as the primary text.
        print(notice["content"])
    tool_names = ", ".join(t["name"] for t in summary["tools"]) if summary["tools"] else "(none)"
    print(f"[turn {summary['turn']} | {summary['wall_seconds']:.1f}s | tools: {tool_names}]")
    return SETTLE_EXIT_CODES.get(summary["settle_class"], 1)


def cmd_stop(args: argparse.Namespace) -> int:
    run_id = resolve_run_id(args.run)
    rdir = run_dir(run_id)
    try:
        resp = rpc_call(run_id, {"cmd": "stop"}, timeout=30.0)
    except DaemonUnavailable as exc:
        print(f"warning: {exc}", file=sys.stderr)
        final = _best_effort_final(rdir)
        write_json(rdir / "final.json", final)
        print(f"daemon already unreachable; wrote best-effort final.json under {rdir}")
        return 1
    if not resp.get("ok"):
        print(f"error stopping: {resp.get('error')}", file=sys.stderr)
        return 1
    final = resp["final"]
    print(f"stopped run {run_id}: {final['turn_count']} turns, "
          f"{final['totals']['tool_calls']} tool calls, {final['totals']['wall_seconds']:.1f}s total")
    return 0


def cmd_log(args: argparse.Namespace) -> int:
    run_id = resolve_run_id(args.run)
    rdir = run_dir(run_id)
    path = rdir / "driver.log"
    if not path.exists():
        print(f"no driver.log for run {run_id} at {path}", file=sys.stderr)
        return 2
    print_log_tail(path, args.tail)
    return 0


def cmd_status(args: argparse.Namespace) -> int:
    run_id = resolve_run_id(args.run)
    rdir = run_dir(run_id)
    if not rdir.exists():
        print(f"no such run: {run_id}", file=sys.stderr)
        return 2
    try:
        resp = rpc_call(run_id, {"cmd": "status"}, timeout=5.0)
        print(f"run {run_id}: daemon alive (pid {resp['daemon_pid']}), "
              f"pi {'alive' if resp['pi_alive'] else 'dead'} (pid {resp['pi_pid']}), "
              f"turns so far: {resp['turn_count']}, turn in progress: {resp['turn_in_progress']}")
        return 0
    except DaemonUnavailable as exc:
        print(f"run {run_id}: daemon unreachable ({exc})")
        hb = read_json(rdir / "heartbeat.json", None)
        info = read_json(rdir / "daemon.json", None)
        if hb:
            print(f"  last heartbeat: {hb.get('at')} status={hb.get('status')} "
                  f"turn_count={hb.get('turn_count')} pi_alive_at_that_time={hb.get('pi_alive')}")
        if info:
            print(f"  daemon.json status={info.get('status')} daemon_pid={info.get('daemon_pid')} "
                  f"pi_pid={info.get('pi_pid')}")
        return 1


# --------------------------------------------------------------------------
# argparse wiring
# --------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="driver.py", description="Live-play driver for pi-coc v2 acceptance.")
    sub = p.add_subparsers(dest="subcommand", required=True)

    sp = sub.add_parser("start", help="spawn a detached pi-coc daemon for a campaign")
    sp.add_argument("--campaign", required=True)
    sp.add_argument("--run", default=None)
    sp.add_argument("--model", default=DEFAULT_MODEL,
                     help="provider/modelId selected before opening and confirmed via set_model (default %(default)s); thinking is low")
    sp.add_argument("--launcher", default=None,
                     help="path to bin/pi-coc-compatible launcher (default: env PI_COC_LAUNCHER, then bin/pi-coc)")
    sp.add_argument("--pregen", default=None, metavar="PREGEN",
                     help="create the campaign from this starter pregen sheet (e.g. thomas-hayes) and skip character creation")
    sp.add_argument("--module", default="the-haunting", help="starter module for --pregen (default %(default)s)")
    sp.add_argument("--play-language", default="zh", help="play language tag for --pregen (default %(default)s)")
    sp.add_argument("--no-default-run", action="store_true",
                     help="do not make this run the default for later turn/stop/log calls")
    sp.add_argument("--env", action="append", default=None, metavar="KEY=VALUE",
                     help="environment variable for this run's pi (repeatable); the daemon inherits "
                          "everything else, so concurrent runs can differ in e.g. PI_COC_ADMISSION_MODEL")
    sp.set_defaults(func=cmd_start)

    sp = sub.add_parser("turn", help="send one player turn and print the keeper's reply")
    sp.add_argument("text")
    sp.add_argument("--run", default=None)
    sp.add_argument("--timeout", type=float, default=300.0)
    sp.set_defaults(func=cmd_turn)

    sp = sub.add_parser("stop", help="abort any in-flight turn and terminate the daemon and pi")
    sp.add_argument("--run", default=None)
    sp.set_defaults(func=cmd_stop)

    sp = sub.add_parser("log", help="print the tail of the driver's own log")
    sp.add_argument("--run", default=None)
    sp.add_argument("--tail", type=int, default=60)
    sp.set_defaults(func=cmd_log)

    sp = sub.add_parser("status", help="report whether the daemon and pi are alive")
    sp.add_argument("--run", default=None)
    sp.set_defaults(func=cmd_status)

    # internal: this is what `start` actually spawns as the detached daemon.
    sp = sub.add_parser("_daemon", help=argparse.SUPPRESS)
    sp.add_argument("--run", required=True)
    sp.add_argument("--campaign", required=True)
    sp.add_argument("--model", default=None)
    sp.add_argument("--launcher", default=None)

    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.subcommand == "_daemon":
        return _daemon_main(args)
    try:
        return args.func(args)
    except DriverError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
