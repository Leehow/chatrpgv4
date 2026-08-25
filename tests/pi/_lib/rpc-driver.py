#!/usr/bin/env python3
"""One-player-turn-at-a-time RPC evidence driver for the pi-coc gate probe.

Hardened against the EPIPE pattern (see the root-cause analysis appended to
``evidence/epipe-pattern.md`` in the playtest workspaces):

- pi ``--mode rpc`` writes its JSON event stream to stdout; whoever owns that
  pipe read end is the driver.  If the driver process dies, pi's next stdout
  write fails with ``write EPIPE`` and pi crashes with an unhandled 'error'
  event (verified Node v22.19.0 behavior; pi 0.81.1 output-guard only retries
  ENOBUFS/EAGAIN/EWOULDBLOCK).  The campaign state itself is durable; only the
  host process dies.
- The original probe driver was the single point of failure: one ``serve``
  process with stderr discarded (DEVNULL), a bare reader thread, and no health
  signal, so a dead driver was only discovered when events stopped.

This driver keeps the same CLI (``start``/``serve``/``set-model``/``turn``/
``observe``/``stop``) and the same evidence layout, and adds:

1. **Driver log** (``evidence/rpc-driver.log``): the detached ``serve`` process
   writes its stderr there instead of DEVNULL, and all driver diagnostics
   (thread deaths, pi exit codes, FIFO errors) are timestamped.  A dead driver
   is now diagnosable instead of invisible.
2. **Heartbeat** (``evidence/rpc-driver-heartbeat``): ``serve`` touches it
   every second while pi is alive.  ``turn`` refuses to talk to a dead or hung
   driver instead of writing into a FIFO nobody reads.
3. **Supervised worker threads**: the FIFO forwarder and the stdout reader are
   isolated threads whose exceptions are logged and flagged, and can no longer
   kill the process that owns pi's stdout pipe.  pi's exit code/signal is
   appended to the events file as a ``driver_pi_exited`` record.
4. **Fail-fast diagnosis**: ``turn`` verifies daemon liveness before writing
   and re-checks pi liveness after a timeout; when pi died mid-turn it prints
   the driver log tail plus resume guidance (campaign state is durable;
   restart the daemon and continue the campaign through ``session.resume``).
5. **Settle classification**: a submitted turn succeeds only when the
   settle window contains player-visible assistant text — tool activity is
   not delivery. ``settle_class`` distinguishes ``settled`` (visible text),
   ``undelivered_settle_with_tools`` (zero visible text but tool calls or
   executions; exit 5), and ``empty_settle`` (zero visible text and zero
   tool activity, the provider-successful thinking-only swallow; exit 4).
   A hidden ``coc-empty-terminal-recovery`` follow-up marker keeps the
   submit open until the recovered turn settles, so an in-flight
   same-epoch recovery is not misread as an empty settle. The marker is
   appended only after the recovery follow-up was actually sent, so a
   scheduling failure never fabricates an in-flight recovery.

The upstream pi gap (EPIPE on RPC stdout kills the whole agent) is reported
separately; this driver makes the peer death survivable and diagnosable on the
repo side.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
import uuid

ROOT = Path(__file__).resolve().parent
EVIDENCE = ROOT / os.environ.get("RPC_EVIDENCE_DIR", "evidence")
FIFO = EVIDENCE / "rpc-control.fifo"
PID = EVIDENCE / "rpc-daemon.pid"
EVENTS = EVIDENCE / "rpc-events.jsonl"
STDERR = EVIDENCE / "pi-stderr.log"
STATE = EVIDENCE / "rpc-state.json"
DRIVER_LOG = EVIDENCE / "rpc-driver.log"
HEARTBEAT = EVIDENCE / "rpc-driver-heartbeat"
LAUNCH = EVIDENCE / "rpc-launch.json"
# How old a heartbeat may be before the daemon is considered dead/hung.
HEARTBEAT_STALE_SECONDS = 6.0
# How long a turn may wait for an agent_settled before liveness is rechecked.
DIAGNOSTIC_POLL_SECONDS = 5.0

_driver_log_handle = None


def log(message: str) -> None:
    line = f"[{time.strftime('%Y-%m-%dT%H:%M:%S%z')}] {message}\n"
    if _driver_log_handle is not None:
        try:
            _driver_log_handle.write(line)
            _driver_log_handle.flush()
        except OSError:
            pass
    print(line, end="", file=sys.stderr)


def append(path: Path, value: dict) -> None:
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(value, ensure_ascii=False) + "\n")
        f.flush()


def text_from(content: object) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            str(part.get("text", "")) for part in content
            if isinstance(part, dict) and part.get("type") == "text"
        )
    return ""


# Hidden same-epoch recovery marker appended by the pi-coc player transcript
# gate when a provider-successful thinking-only terminal swallowed an
# external player turn (plugins/coc-keeper/pi/extensions/index.ts,
# deliverEmptyTerminalRecovery). One marker arms exactly one hidden
# follow-up agent turn that settles after the swallowed one.
EMPTY_TERMINAL_RECOVERY_CUSTOM_TYPE = "coc-empty-terminal-recovery"


def _empty_terminal_recovery_markers(rows: list[dict]) -> int:
    count = 0
    for row in rows:
        if row.get("type") != "entry_appended":
            continue
        entry = row.get("entry")
        if (
            isinstance(entry, dict)
            and entry.get("customType") == EMPTY_TERMINAL_RECOVERY_CUSTOM_TYPE
        ):
            count += 1
    return count


def _turn_window_visible_output(rows: list[dict]) -> bool:
    """True when an assistant message_end carried player-visible text.

    The extension strips thinking-only content and tool framing text from
    assistant ``message_end`` events before they reach this stream, so a
    non-blank text part here is player-visible output. Tool activity is
    deliberately NOT delivery: a settle with tools but no visible text did
    not answer the player.
    """
    for row in rows:
        if row.get("type") != "message_end":
            continue
        message = row.get("message")
        if not isinstance(message, dict) or message.get("role") != "assistant":
            continue
        content = message.get("content")
        if not isinstance(content, list):
            continue
        for part in content:
            if (
                isinstance(part, dict)
                and part.get("type") == "text"
                and str(part.get("text", "")).strip()
            ):
                return True
    return False


def _turn_window_has_tool_activity(rows: list[dict]) -> bool:
    """True on any tool execution event or assistant toolCall part."""
    for row in rows:
        if row.get("type") in ("tool_execution_start", "tool_execution_end"):
            return True
        if row.get("type") != "message_end":
            continue
        message = row.get("message")
        if not isinstance(message, dict) or message.get("role") != "assistant":
            continue
        content = message.get("content")
        if not isinstance(content, list):
            continue
        for part in content:
            if isinstance(part, dict) and part.get("type") == "toolCall":
                return True
    return False


def command_payload(kind: str, value: str | None = None) -> dict:
    request_id = f"{kind[:1]}-{uuid.uuid4().hex[:12]}"
    if kind == "prompt":
        return {"id": request_id, "type": "prompt", "message": value}
    if kind == "set_model":
        provider, model = value.split("/", 1)
        return {"id": request_id, "type": "set_model", "provider": provider, "modelId": model}
    if kind == "abort":
        return {"id": request_id, "type": "abort"}
    raise ValueError(kind)


def event_offset() -> int:
    return EVENTS.stat().st_size if EVENTS.exists() else 0


def collect_after(offset: int) -> list[dict]:
    if not EVENTS.exists():
        return []
    with EVENTS.open("rb") as f:
        f.seek(offset)
        rows = f.read().decode("utf-8", errors="replace").splitlines()
    out = []
    for row in rows:
        try:
            out.append(json.loads(row))
        except json.JSONDecodeError:
            out.append({"type": "driver_malformed_event_line", "raw": row})
    return out


def _daemon_pid() -> int | None:
    if not PID.exists():
        return None
    try:
        value = PID.read_text(encoding="utf-8").strip()
        return int(value) if value else None
    except (OSError, ValueError):
        return None


def _pid_alive(pid: int | None) -> bool:
    if pid is None:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def _driver_alive() -> tuple[bool, str]:
    """Return (healthy, diagnosis). Heartbeat freshness proves serve lives."""
    if not HEARTBEAT.exists():
        return False, "daemon heartbeat file is missing; run start first"
    try:
        age = time.time() - HEARTBEAT.stat().st_mtime
    except OSError as exc:
        return False, f"daemon heartbeat unreadable: {exc}"
    if age > HEARTBEAT_STALE_SECONDS:
        return False, (
            f"daemon heartbeat is {age:.0f}s stale: the driver process "
            "holding pi's stdout pipe is dead or hung (EPIPE pattern); "
            "restart the daemon"
        )
    return True, ""


def _print_driver_tail() -> None:
    if not DRIVER_LOG.exists():
        print("(no driver log)", file=sys.stderr)
        return
    try:
        tail = DRIVER_LOG.read_text(encoding="utf-8", errors="replace").splitlines()[-25:]
    except OSError as exc:
        print(f"(driver log unreadable: {exc})", file=sys.stderr)
        return
    print("--- rpc-driver.log tail ---", file=sys.stderr)
    for line in tail:
        print(line, file=sys.stderr)


def submit(payload: dict, timeout: int) -> int:
    if not FIFO.exists() or not PID.exists():
        raise SystemExit("RPC daemon is not running; run start first")
    pi_pid = _daemon_pid()
    healthy, diagnosis = _driver_alive()
    if not healthy or not _pid_alive(pi_pid):
        print(f"RPC daemon unhealthy: {diagnosis}", file=sys.stderr)
        if pi_pid is not None and not _pid_alive(pi_pid):
            print(
                f"pi pid {pi_pid} is gone; campaign state is durable — "
                "restart the daemon and continue through session.resume",
                file=sys.stderr,
            )
        _print_driver_tail()
        raise SystemExit(3)
    before = event_offset()
    with FIFO.open("w", encoding="utf-8") as f:
        f.write(json.dumps(payload, ensure_ascii=False) + "\n")
        f.flush()
    deadline = time.monotonic() + timeout
    rows: list[dict] = []
    completed = False
    last_diagnostic = time.monotonic()
    while time.monotonic() < deadline:
        rows = collect_after(before)
        if payload["type"] == "set_model":
            completed = any(row.get("type") == "response" and row.get("id") == payload["id"] for row in rows)
        else:
            settles = [row for row in rows if row.get("type") == "agent_settled"]
            completed = bool(settles)
            if completed and len(settles) <= _empty_terminal_recovery_markers(rows):
                # A hidden empty-terminal recovery follow-up is in flight:
                # its triggered agent turn settles after this one, so the
                # submitted player turn is not finished yet.
                completed = False
        if completed:
            break
        time.sleep(0.25)
        now = time.monotonic()
        if (
            payload["type"] != "set_model"
            and now - last_diagnostic >= DIAGNOSTIC_POLL_SECONDS
        ):
            # Periodic liveness re-check: a dead pi mid-turn is the EPIPE
            # signature (events stopped because the RPC channel broke).
            last_diagnostic = now
            if not _pid_alive(pi_pid):
                print(
                    f"pi pid {pi_pid} died during the turn "
                    f"(submit {payload['id']}) — EPIPE-class peer loss; "
                    "campaign state is durable — restart the daemon and "
                    "continue through session.resume",
                    file=sys.stderr,
                )
                _print_driver_tail()
                raise SystemExit(3)
            healthy_now, diagnosis_now = _driver_alive()
            if not healthy_now:
                print(f"RPC driver died during the turn: {diagnosis_now}", file=sys.stderr)
                _print_driver_tail()
                raise SystemExit(3)
    rows = collect_after(before) if not completed else rows
    settle_class = "not_applicable"
    if payload["type"] != "set_model":
        if not completed:
            settle_class = "not_settled"
        elif _turn_window_visible_output(rows):
            settle_class = "settled"
        elif _turn_window_has_tool_activity(rows):
            settle_class = "undelivered_settle_with_tools"
        else:
            settle_class = "empty_settle"
    record = {
        "submitted_at": time.time(),
        "request": payload,
        "timeout_seconds": timeout,
        "settled": completed,
        "settle_class": settle_class,
        "events": rows,
    }
    out = EVIDENCE / f"turn-{payload['id']}.json"
    out.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for row in rows:
        msg = row.get("message")
        if row.get("type") == "message_end" and isinstance(msg, dict) and msg.get("role") == "assistant":
            print("KP:", text_from(msg.get("content")))
        if row.get("type") == "response":
            print("RPC response:", json.dumps(row, ensure_ascii=False))
    print(f"evidence={out}")
    if not record["settled"]:
        return 2
    if record["settle_class"] == "empty_settle":
        print(
            "empty settle: agent_settled with zero visible assistant text and "
            "zero tool executions; recovery unavailable or exhausted — the "
            "player turn was not delivered",
            file=sys.stderr,
        )
        return 4
    if record["settle_class"] == "undelivered_settle_with_tools":
        print(
            "undelivered settle: agent_settled after tool activity but with "
            "zero visible assistant output; the player turn was not delivered",
            file=sys.stderr,
        )
        return 5
    return 0


def serve() -> int:
    env = os.environ.copy()
    env.update({
        "PI_CODING_AGENT_DIR": str(ROOT / "agent-home"),
        "COC_HOST": "pi",
        "COC_PI_SOURCE_SCOPE_LOCATOR_COMMAND": str(ROOT / "plugins/coc-keeper/pi/bin/coc-pdf-skill-adapter"),
        "PATH": str(Path.home() / ".local/bin") + os.pathsep + env.get("PATH", ""),
        "COC_PROGRESSIVE_OCR_COMMAND": str(ROOT / "plugins/coc-keeper/pi/bin/coc-ocr-adapter.py"),
        "COC_PI_SOURCE_SCOPE_LOCATOR_COMMAND": str(ROOT / "plugins/coc-keeper/pi/bin/coc-pdf-skill-adapter"),
        "COC_KEEPER_ENV_FILE": str(Path.home() / ".config/coc-keeper/secrets.env"),
    })
    cmd = [
        "pi", "--no-builtin-tools", "--approve", "--no-context-files",
        "--append-system-prompt", "plugins/coc-keeper/pi/prompts/host-system.md",
        "--mode", "rpc", "--no-session",
    ]
    global _driver_log_handle
    DRIVER_LOG.parent.mkdir(exist_ok=True)
    _driver_log_handle = DRIVER_LOG.open("a", encoding="utf-8")
    log("serve starting: " + " ".join(cmd))
    proc = subprocess.Popen(cmd, cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            stderr=STDERR.open("a", encoding="utf-8"), text=True, bufsize=1, env=env)
    PID.write_text(str(proc.pid) + "\n", encoding="utf-8")
    STATE.write_text(json.dumps({"pid": proc.pid, "command": cmd, "cwd": str(ROOT), "started_at": time.time()}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    log(f"pi spawned pid={proc.pid}")

    reader_alive = threading.Event()
    reader_alive.set()
    reader_error = []

    def reader() -> None:
        assert proc.stdout is not None
        try:
            for line in proc.stdout:
                try:
                    append(EVENTS, json.loads(line))
                except json.JSONDecodeError:
                    append(EVENTS, {"type": "driver_non_json_stdout", "raw": line.rstrip("\n")})
        except BaseException as exc:  # never let the reader kill the pipe owner
            reader_error.append(repr(exc))
            reader_alive.clear()
            log(f"reader thread died: {exc!r}")

    threading.Thread(target=reader, daemon=True).start()
    forwarder_alive = threading.Event()
    forwarder_alive.set()
    stop_forwarder = threading.Event()

    def forwarder() -> None:
        try:
            while not stop_forwarder.is_set() and proc.poll() is None:
                try:
                    with FIFO.open("r", encoding="utf-8") as control:
                        for line in control:
                            if stop_forwarder.is_set():
                                return
                            if not line.strip():
                                continue
                            assert proc.stdin is not None
                            try:
                                proc.stdin.write(line)
                                proc.stdin.flush()
                            except (BrokenPipeError, OSError) as exc:
                                log(f"pi stdin write failed: {exc!r}")
                                return
                except OSError as exc:
                    if stop_forwarder.is_set():
                        return
                    log(f"FIFO loop error (retrying): {exc!r}")
                    time.sleep(0.5)
        finally:
            forwarder_alive.clear()

    threading.Thread(target=forwarder, daemon=True).start()
    log("serve loop running (heartbeat every 1s)")
    try:
        while proc.poll() is None:
            try:
                HEARTBEAT.touch()
            except OSError as exc:
                log(f"heartbeat touch failed: {exc!r}")
            if not reader_alive.is_set():
                log("health: stdout reader thread is dead (pi will block/hang on write)")
                reader_alive.set()  # log once per death
            if not forwarder_alive.is_set() and not stop_forwarder.is_set():
                log("health: FIFO forwarder thread is dead")
                stop_forwarder.set()
                break
            time.sleep(1)
        returncode = proc.poll()
        log(f"pi exited returncode={returncode}")
        try:
            append(EVENTS, {
                "type": "driver_pi_exited",
                "code": returncode,
                "signal": None,
                "driver_reader_error": reader_error[0] if reader_error else None,
                "at": time.time(),
            })
        except OSError as exc:
            log(f"could not record pi exit in events: {exc!r}")
    finally:
        stop_forwarder.set()
        try:
            HEARTBEAT.unlink(missing_ok=True)
        except OSError:
            pass
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
        PID.unlink(missing_ok=True)
        log("serve shutdown complete")
    return proc.returncode or 0


def start() -> int:
    if PID.exists():
        raise SystemExit(f"refusing: existing daemon pid file: {PID}")
    EVIDENCE.mkdir(exist_ok=True)
    os.mkfifo(FIFO)
    DRIVER_LOG.parent.mkdir(exist_ok=True)
    driver_log = DRIVER_LOG.open("a", encoding="utf-8")
    driver_log.write(f"[{time.strftime('%Y-%m-%dT%H:%M:%S%z')}] start: launching detached serve\n")
    driver_log.flush()
    process = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "serve"], cwd=ROOT,
                               start_new_session=True, stdout=driver_log, stderr=subprocess.STDOUT)
    (LAUNCH).write_text(json.dumps({"driver_pid": process.pid, "started_at": time.time()}, indent=2) + "\n", encoding="utf-8")
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if PID.exists():
            print(PID.read_text(encoding="utf-8").strip())
            return 0
        time.sleep(0.1)
    raise SystemExit("RPC daemon did not create its pid file")


def stop() -> int:
    if not PID.exists():
        raise SystemExit("no RPC daemon pid file")
    pid = int(PID.read_text(encoding="utf-8").strip())
    os.kill(pid, 15)
    print(f"sent SIGTERM to pi pid {pid}")
    return 0


def observe(seconds: int) -> int:
    before = event_offset()
    time.sleep(seconds)
    rows = collect_after(before)
    out = EVIDENCE / f"observe-{int(time.time())}.json"
    out.write_text(json.dumps({"seconds": seconds, "events": rows}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"events={len(rows)} evidence={out}")
    return 0


def main() -> int:
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("start")
    sub.add_parser("serve")
    model = sub.add_parser("set-model"); model.add_argument("provider_model")
    turn = sub.add_parser("turn"); turn.add_argument("message"); turn.add_argument("--timeout", type=int, default=900)
    observe_p = sub.add_parser("observe"); observe_p.add_argument("seconds", type=int)
    sub.add_parser("stop")
    args = p.parse_args()
    if args.cmd == "start": return start()
    if args.cmd == "serve": return serve()
    if args.cmd == "set-model": return submit(command_payload("set_model", args.provider_model), 60)
    if args.cmd == "turn": return submit(command_payload("prompt", args.message), args.timeout)
    if args.cmd == "observe": return observe(args.seconds)
    return stop()

if __name__ == "__main__":
    raise SystemExit(main())
