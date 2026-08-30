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
5. **Settle classification**: a submitted played turn succeeds only when the
   settle window contains player-visible assistant text — tool activity is
   not delivery. ``settle_class`` distinguishes ``settled`` (visible text),
   ``undelivered_settle_with_tools`` (zero visible text but tool calls or
   executions; exit 5), and ``empty_settle`` (zero visible text and zero
   tool activity, the provider-successful thinking-only swallow; exit 4).
   A hidden ``coc-empty-terminal-recovery`` follow-up marker keeps the
   submit open until the recovered turn delivers visible text and
   settles, so an in-flight same-epoch recovery is not misread as an
   empty settle. If the pre-recovery terminal aborted without
   ``agent_settled``, one recovered settle after visible text is enough;
   do not wait for a second settle that will never arrive. The marker is
   appended only after the recovery follow-up was actually sent, so a
   scheduling failure never fabricates an in-flight recovery.
   The setup→play boundary is a separate terminal, and only for an
   explicitly proven setup-role session captured at daemon startup
   (``COC_PI_SESSION_ROLE`` persisted as ``STATE.session_role``). Per-turn
   environment must not override that role. Canonical emission is a
   validated ``coc_setup_handoff`` envelope *and* a clean exit 42; the
   driver marks the envelope pending, waits for process termination and a
   short stdout drain, then evaluates the full window. Envelope-alone or
   exit-42-alone is not enough. Ordinary play, unproven/legacy role,
   lookalike events, malformed handoff rows, and any later signal,
   non-42 exit, reader/EPIPE/non-JSON evidence fail closed.

The upstream pi gap (EPIPE on RPC stdout kills the whole agent) is reported
separately; this driver makes the peer death survivable and diagnosable on the
repo side.
"""
from __future__ import annotations

import argparse
from datetime import datetime
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
# How long a turn may wait for a terminal before liveness is rechecked.
DIAGNOSTIC_POLL_SECONDS = 5.0
# After envelope+exit 42, keep collecting so late reader/EPIPE/non-JSON
# or a non-42 exit cannot arrive after the window was frozen.
HANDOFF_DRAIN_SECONDS = 1.5

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


# Hidden same-epoch recovery markers appended by the pi-coc player
# transcript / settled-output gates. Empty-terminal recovery
# (deliverEmptyTerminalRecovery) arms one follow-up after a thinking-only
# swallow. Settled-output recovery (coc-settled-output-recovery) arms a
# follow-up when status is ``claimed``; ``exhausted`` does not schedule
# another turn. Accounting reports both; in-flight wait counts empty-terminal
# plus claimed settled-output only.
EMPTY_TERMINAL_RECOVERY_CUSTOM_TYPE = "coc-empty-terminal-recovery"
SETTLED_OUTPUT_RECOVERY_CUSTOM_TYPE = "coc-settled-output-recovery"
SETUP_HANDOFF_CUSTOM_TYPE = "coc_setup_handoff"
COC_SETUP_HANDOFF_EXIT_CODE = 42
SESSION_ROLE_ENV = "COC_PI_SESSION_ROLE"
_SESSION_ROLE_UNSET = object()
SETUP_HANDOFF_RECEIPT_KEYS = {
    "schema_version",
    "decision_id",
    "campaign_id",
    "investigator_ids",
    "completed_at",
    "opening_projection_ref",
    "lane_interrupted_at_handoff",
}
# Exact top-level keys emitted by plugins/coc-keeper/pi/extensions/index.ts
# emitSetupHandoff (type, campaign_id, receipt, at, consumer).
SETUP_HANDOFF_PAYLOAD_KEYS = {
    "type",
    "campaign_id",
    "receipt",
    "at",
    "consumer",
}
SETUP_HANDOFF_CONSUMERS = {
    "server-node/launcher",
    "pi-coc/same-process",
}
LAUNCHER_HANDOFF_CONSUMER = "server-node/launcher"


def _entry_custom_type(entry: object) -> str | None:
    if not isinstance(entry, dict):
        return None
    custom = entry.get("customType")
    return custom if isinstance(custom, str) else None


def _recovery_marker_counts(rows: list[dict]) -> dict[str, int]:
    empty = 0
    settled_total = 0
    settled_claimed = 0
    for row in rows:
        if row.get("type") != "entry_appended":
            continue
        entry = row.get("entry")
        custom = _entry_custom_type(entry)
        if custom == EMPTY_TERMINAL_RECOVERY_CUSTOM_TYPE:
            empty += 1
            continue
        if custom != SETTLED_OUTPUT_RECOVERY_CUSTOM_TYPE:
            continue
        settled_total += 1
        data = entry.get("data") if isinstance(entry, dict) else None
        status = data.get("status") if isinstance(data, dict) else None
        if status == "claimed":
            settled_claimed += 1
    return {
        "empty_terminal": empty,
        "settled_output": settled_total,
        "settled_output_claimed": settled_claimed,
        "recovery_markers": empty + settled_total,
        "in_flight": empty + settled_claimed,
    }


def _empty_terminal_recovery_markers(rows: list[dict]) -> int:
    return _recovery_marker_counts(rows)["empty_terminal"]


def _settled_output_recovery_markers(rows: list[dict]) -> int:
    return _recovery_marker_counts(rows)["settled_output"]


def _in_flight_recovery_markers(rows: list[dict]) -> int:
    return _recovery_marker_counts(rows)["in_flight"]


def _parse_json_object(raw: object) -> dict | None:
    if not isinstance(raw, str) or not raw.strip().startswith("{"):
        return None
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def _valid_handoff_investigator_ids(value: object) -> bool:
    if not isinstance(value, list) or not value:
        return False
    seen: set[str] = set()
    for item in value:
        if not isinstance(item, str) or not item or item != item.strip():
            return False
        if item in (".", "..") or "/" in item or chr(92) in item:
            return False
        if item in seen:
            return False
        seen.add(item)
    return True


def _valid_iso8601_at(value: object) -> bool:
    if not isinstance(value, str) or not value.strip() or value != value.strip():
        return False
    text = value[:-1] + "+00:00" if value.endswith("Z") else value
    try:
        datetime.fromisoformat(text)
    except ValueError:
        return False
    return True


def _validated_setup_handoff_payload(blob: object) -> dict | None:
    """Canonical emitSetupHandoff payload: exact keys, at, consumer, receipt."""
    if not isinstance(blob, dict):
        return None
    if set(blob) != SETUP_HANDOFF_PAYLOAD_KEYS:
        return None
    if blob.get("type") != SETUP_HANDOFF_CUSTOM_TYPE:
        return None
    campaign_id = blob.get("campaign_id")
    if (
        not isinstance(campaign_id, str)
        or not campaign_id.strip()
        or campaign_id != campaign_id.strip()
    ):
        return None
    if not _valid_iso8601_at(blob.get("at")):
        return None
    if blob.get("consumer") not in SETUP_HANDOFF_CONSUMERS:
        return None
    receipt = blob.get("receipt")
    if not isinstance(receipt, dict):
        return None
    if set(receipt) != SETUP_HANDOFF_RECEIPT_KEYS:
        return None
    if receipt.get("schema_version") != 1:
        return None
    decision_id = receipt.get("decision_id")
    if (
        not isinstance(decision_id, str)
        or not decision_id.strip()
        or decision_id != decision_id.strip()
    ):
        return None
    if receipt.get("campaign_id") != campaign_id:
        return None
    completed_at = receipt.get("completed_at")
    if not isinstance(completed_at, str) or not completed_at.strip():
        return None
    if not isinstance(receipt.get("lane_interrupted_at_handoff"), bool):
        return None
    projection = receipt.get("opening_projection_ref")
    if projection is not None and not isinstance(projection, dict):
        return None
    if not _valid_handoff_investigator_ids(receipt.get("investigator_ids")):
        return None
    return blob


def _custom_handoff_source(row: dict) -> dict | None:
    """Object holding customType/details/content for a handoff envelope."""
    row_type = row.get("type")
    if row_type == "custom_message" and row.get("customType") == SETUP_HANDOFF_CUSTOM_TYPE:
        return row
    if row_type in ("message_start", "message_end"):
        message = row.get("message")
        if (
            isinstance(message, dict)
            and message.get("role") == "custom"
            and message.get("customType") == SETUP_HANDOFF_CUSTOM_TYPE
        ):
            return message
    return None


def _setup_handoff_candidate(row: dict) -> bool:
    """True for the host envelopes, even when the payload is malformed."""
    if _custom_handoff_source(row) is not None:
        return True
    row_type = row.get("type")
    if row_type == "entry_appended":
        entry = row.get("entry")
        return isinstance(entry, dict) and entry.get("customType") == SETUP_HANDOFF_CUSTOM_TYPE
    return row_type == SETUP_HANDOFF_CUSTOM_TYPE


def _setup_handoff_payload(row: dict) -> dict | None:
    """Return a validated coc_setup_handoff payload, or None.

    Accepts live RPC envelopes: ``message_start``/``message_end`` with
    ``role=custom`` (Campaign 08 sendMessage), ``custom_message``, and
    ``entry_appended``. Every supplied representation must validate and
    agree. Assistant prose that merely mentions the type is not a handoff.
    """
    blobs: list[object] = []
    row_type = row.get("type")
    source = _custom_handoff_source(row)
    if source is not None:
        if "details" in source:
            blobs.append(source.get("details"))
        if "content" in source:
            parsed = _parse_json_object(source.get("content"))
            if parsed is None:
                return None
            blobs.append(parsed)
        if not blobs:
            return None
    elif row_type == "entry_appended":
        entry = row.get("entry")
        if not isinstance(entry, dict) or entry.get("customType") != SETUP_HANDOFF_CUSTOM_TYPE:
            return None
        blobs.append(entry.get("data"))
    elif row_type == SETUP_HANDOFF_CUSTOM_TYPE:
        blobs.append(row)
    else:
        return None
    validated: list[dict] = []
    for blob in blobs:
        payload = _validated_setup_handoff_payload(blob)
        if payload is None:
            return None
        validated.append(payload)
    first = validated[0]
    for other in validated[1:]:
        if other != first:
            return None
    return first


def _session_role_from_env() -> str | None:
    raw = os.environ.get(SESSION_ROLE_ENV)
    if raw in ("setup", "play"):
        return raw
    return None


def _session_role_from_state() -> str | None:
    if not STATE.exists():
        return None
    try:
        data = json.loads(STATE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict):
        return None
    role = data.get("session_role")
    return role if role in ("setup", "play") else None


def _persist_session_role(role: str) -> None:
    """Write STATE.session_role once; never invent a state file."""
    if role not in ("setup", "play") or not STATE.exists():
        return
    try:
        data = json.loads(STATE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return
    if not isinstance(data, dict):
        return
    if data.get("session_role") == role:
        return
    data["session_role"] = role
    STATE.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def _canonical_session_role(
    override: object = _SESSION_ROLE_UNSET,
) -> str | None:
    """Daemon-lifetime role: STATE after startup, never the turn process env.

    Serve captures ``COC_PI_SESSION_ROLE`` once into ``STATE.session_role``.
    Later ``turn`` invocations must not promote play/unproven to setup by
    exporting a different env. Only exact ``setup`` or ``play`` count.
    Unset/invalid is unproven. Do not infer role from player prose.
    """
    if override is not _SESSION_ROLE_UNSET:
        return override if override in ("setup", "play") else None
    return _session_role_from_state()


def _process_exit_rows(rows: list[dict]) -> list[dict]:
    return [
        row for row in rows
        if row.get("type") in ("driver_pi_exited", "process_exit")
    ]


def _handoff_stream_unreliable(rows: list[dict]) -> bool:
    """True when this window carries any transport/process/malformed failure.

    A clean exit-42 row cannot mask a separate non-42 exit, signal, reader
    error, EPIPE, non-JSON/parse error, or malformed handoff envelope.
    """
    for row in rows:
        row_type = row.get("type")
        if row_type in ("driver_malformed_event_line", "driver_non_json_stdout"):
            return True
        if row.get("epipe") is True:
            return True
        if _setup_handoff_candidate(row) and _setup_handoff_payload(row) is None:
            return True
    for row in _process_exit_rows(rows):
        if row.get("driver_reader_error"):
            return True
        if row.get("signal") not in (None, 0):
            return True
        if row.get("code") != COC_SETUP_HANDOFF_EXIT_CODE:
            return True
        if row.get("epipe") is True:
            return True
    return False


def _clean_setup_handoff_exit(row: dict) -> bool:
    if row.get("type") not in ("driver_pi_exited", "process_exit"):
        return False
    if row.get("code") != COC_SETUP_HANDOFF_EXIT_CODE:
        return False
    if row.get("driver_reader_error"):
        return False
    if row.get("signal") not in (None, 0):
        return False
    return True


def _setup_handoff_exit_observed(rows: list[dict]) -> bool:
    exits = _process_exit_rows(rows)
    if not exits:
        return False
    return all(_clean_setup_handoff_exit(row) for row in exits)


def _setup_handoff_envelope_observed(rows: list[dict]) -> bool:
    return any(_setup_handoff_payload(row) is not None for row in rows)


def _setup_handoff_payloads(rows: list[dict]) -> list[dict]:
    payloads: list[dict] = []
    for row in rows:
        payload = _setup_handoff_payload(row)
        if payload is not None:
            payloads.append(payload)
    return payloads


def _setup_handoff_proven(
    rows: list[dict],
    *,
    session_role: object = _SESSION_ROLE_UNSET,
) -> bool:
    """Setup role + valid envelope; launcher consumer may omit outer exit 42."""
    role = _canonical_session_role(session_role)
    if role != "setup":
        return False
    if _handoff_stream_unreliable(rows):
        return False
    payloads = _setup_handoff_payloads(rows)
    if not payloads:
        return False
    exits = _process_exit_rows(rows)
    if exits:
        return all(_clean_setup_handoff_exit(row) for row in exits)
    return all(
        payload.get("consumer") == LAUNCHER_HANDOFF_CONSUMER
        for payload in payloads
    )


def _setup_handoff_ready(
    rows: list[dict],
    *,
    session_role: object = _SESSION_ROLE_UNSET,
    process_alive: bool,
) -> bool:
    """Proven handoff that is safe to drain: exit 42 recorded, or live re-exec."""
    if not _setup_handoff_proven(rows, session_role=session_role):
        return False
    if _process_exit_rows(rows):
        return True
    return process_alive


def _setup_handoff_pending(
    rows: list[dict],
    *,
    session_role: object = _SESSION_ROLE_UNSET,
) -> bool:
    """True when a setup-role stream has a valid envelope but is not terminal."""
    role = _canonical_session_role(session_role)
    if role != "setup":
        return False
    if _handoff_stream_unreliable(rows):
        return False
    if not _setup_handoff_envelope_observed(rows):
        return False
    return not _setup_handoff_proven(rows, session_role=role)


def _assistant_message_end_visible(row: dict) -> bool:
    """True when this event is an assistant message_end with visible text."""
    if row.get("type") != "message_end":
        return False
    message = row.get("message")
    if not isinstance(message, dict) or message.get("role") != "assistant":
        return False
    content = message.get("content")
    if not isinstance(content, list):
        return False
    for part in content:
        if (
            isinstance(part, dict)
            and part.get("type") == "text"
            and str(part.get("text", "")).strip()
        ):
            return True
    return False


def _turn_window_visible_output(rows: list[dict]) -> bool:
    """True when an assistant message_end carried player-visible text.

    The extension strips thinking-only content and tool framing text from
    assistant ``message_end`` events before they reach this stream, so a
    non-blank text part here is player-visible output. Tool activity is
    deliberately NOT delivery: a settle with tools but no visible text did
    not answer the player.
    """
    return any(_assistant_message_end_visible(row) for row in rows)


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


def _prompt_turn_complete(
    rows: list[dict],
    *,
    session_role: object = _SESSION_ROLE_UNSET,
) -> bool:
    """True when the submitted player turn has settled enough to classify.

    Setup→play is a distinct terminal, and only when the session role is
    proven ``setup``: a validated ``coc_setup_handoff`` envelope *and* a
    clean exclusive exit 42, after the full window is reliable. Envelope
    or exit 42 alone does not complete. Ordinary play and unproven/legacy
    sessions ignore lookalike events and still require ``agent_settled``.
    In-flight recovery
    markers (empty-terminal plus claimed settled-output; exhausted
    settled-output does not count) mean a hidden follow-up is in flight until
    either:

    - more ``agent_settled`` events than in-flight markers (the swallowed
      terminal settled, then the recovered turn settled), or
    - player-visible assistant text has arrived and an ``agent_settled``
      follows it (the pre-recovery terminal aborted without settling, as
      in a leading-whitespace abort; the recovered turn is the only settle).

    Visible text alone does not complete the wait: the recovered follow-up
    must still settle. Lack of visible text keeps the wait open so an
    in-flight recovery is not misread as empty_settle.
    """
    role = _canonical_session_role(session_role)
    if _setup_handoff_proven(rows, session_role=role):
        return True
    settle_indices = [
        index for index, row in enumerate(rows)
        if row.get("type") == "agent_settled"
    ]
    if not settle_indices:
        return False
    markers = _in_flight_recovery_markers(rows)
    if markers == 0:
        return True
    if len(settle_indices) > markers:
        return True
    last_visible = None
    for index, row in enumerate(rows):
        if _assistant_message_end_visible(row):
            last_visible = index
    if last_visible is None:
        return False
    return any(index > last_visible for index in settle_indices)


def _classify_prompt_settle(
    rows: list[dict],
    *,
    completed: bool,
    session_role: object = _SESSION_ROLE_UNSET,
) -> str:
    if not completed:
        return "not_settled"
    role = _canonical_session_role(session_role)
    if _setup_handoff_proven(rows, session_role=role):
        return "setup_handoff"
    if _turn_window_visible_output(rows):
        return "settled"
    if _turn_window_has_tool_activity(rows):
        return "undelivered_settle_with_tools"
    return "empty_settle"


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


def _finish_prompt_submit(
    payload: dict,
    timeout: int,
    rows: list[dict],
    *,
    completed: bool,
    session_role: str | None,
    exit_code: int | None = None,
    death_message: str | None = None,
) -> int:
    """Persist the turn record, print evidence, then return the submit code."""
    settle_class = "not_applicable"
    marker_counts = _recovery_marker_counts(rows)
    if payload["type"] != "set_model":
        settle_class = _classify_prompt_settle(
            rows, completed=completed, session_role=session_role,
        )
    record = {
        "submitted_at": time.time(),
        "request": payload,
        "timeout_seconds": timeout,
        "settled": completed,
        "settle_class": settle_class,
        "session_role": session_role,
        "recovery_markers": marker_counts["recovery_markers"],
        "empty_terminal_recovery_markers": marker_counts["empty_terminal"],
        "settled_output_recovery_markers": marker_counts["settled_output"],
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
    if payload["type"] != "set_model":
        print(
            f"recovery_markers {marker_counts['recovery_markers']} "
            f"empty_terminal_recovery_markers {marker_counts['empty_terminal']} "
            f"settled_output_recovery_markers {marker_counts['settled_output']}"
        )
    if death_message:
        print(death_message, file=sys.stderr)
        _print_driver_tail()
        return 3 if exit_code is None else exit_code
    if not record["settled"]:
        return 2
    if record["settle_class"] == "setup_handoff":
        _persist_session_role("play")
        print(
            "setup handoff: coc_setup_handoff launcher re-exec or clean exit 42; "
            "not waiting for agent_settled"
        )
        return 0
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
    session_role = _canonical_session_role()
    with FIFO.open("w", encoding="utf-8") as f:
        f.write(json.dumps(payload, ensure_ascii=False) + "\n")
        f.flush()
    deadline = time.monotonic() + timeout
    rows: list[dict] = []
    completed = False
    last_diagnostic = time.monotonic()
    handoff_drain_deadline: float | None = None
    while time.monotonic() < deadline:
        rows = collect_after(before)
        process_alive = _pid_alive(pi_pid)
        if payload["type"] == "set_model":
            completed = any(row.get("type") == "response" and row.get("id") == payload["id"] for row in rows)
        elif _setup_handoff_ready(
            rows, session_role=session_role, process_alive=process_alive,
        ):
            # Envelope proven (live launcher re-exec or recorded clean 42).
            # Drain so a late reader/EPIPE/non-JSON/non-42 exit fails closed.
            now = time.monotonic()
            if handoff_drain_deadline is None:
                handoff_drain_deadline = now + HANDOFF_DRAIN_SECONDS
            if now >= handoff_drain_deadline:
                rows = collect_after(before)
                completed = _setup_handoff_ready(
                    rows,
                    session_role=session_role,
                    process_alive=_pid_alive(pi_pid),
                )
                if not completed:
                    handoff_drain_deadline = None
        else:
            handoff_drain_deadline = None
            # Dead outer pid without an exit row is not launcher re-exec;
            # wait for driver_pi_exited. Ordinary settlement otherwise.
            if _setup_handoff_proven(rows, session_role=session_role) and not process_alive:
                completed = False
            else:
                completed = _prompt_turn_complete(
                    rows, session_role=session_role,
                )
        if completed:
            break
        time.sleep(0.25)
        now = time.monotonic()
        if (
            payload["type"] != "set_model"
            and now - last_diagnostic >= DIAGNOSTIC_POLL_SECONDS
        ):
            # Periodic liveness re-check: a dead pi mid-turn is the EPIPE
            # signature (events stopped because the RPC channel broke),
            # unless a setup-role handoff is pending or already proven.
            last_diagnostic = now
            rows = collect_after(before)
            alive_now = _pid_alive(pi_pid)
            if _setup_handoff_ready(
                rows, session_role=session_role, process_alive=alive_now,
            ):
                continue
            if _setup_handoff_proven(rows, session_role=session_role) and not alive_now:
                continue
            if _setup_handoff_pending(rows, session_role=session_role):
                continue
            if not alive_now:
                return _finish_prompt_submit(
                    payload,
                    timeout,
                    rows,
                    completed=False,
                    session_role=session_role,
                    exit_code=3,
                    death_message=(
                        f"pi pid {pi_pid} died during the turn "
                        f"(submit {payload['id']}) — EPIPE-class peer loss; "
                        "campaign state is durable — restart the daemon and "
                        "continue through session.resume"
                    ),
                )
            healthy_now, diagnosis_now = _driver_alive()
            if not healthy_now:
                if _setup_handoff_pending(rows, session_role=session_role):
                    continue
                return _finish_prompt_submit(
                    payload,
                    timeout,
                    rows,
                    completed=False,
                    session_role=session_role,
                    exit_code=3,
                    death_message=(
                        f"RPC driver died during the turn: {diagnosis_now}"
                    ),
                )
    rows = collect_after(before) if not completed else rows
    return _finish_prompt_submit(
        payload,
        timeout,
        rows,
        completed=completed,
        session_role=session_role,
    )


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
    STATE.write_text(json.dumps({
        "pid": proc.pid,
        "command": cmd,
        "cwd": str(ROOT),
        "started_at": time.time(),
        "session_role": _session_role_from_env(),
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
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
