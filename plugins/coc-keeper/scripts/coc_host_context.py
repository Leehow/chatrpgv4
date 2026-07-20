#!/usr/bin/env python3
"""Host-context epoch markers for compaction and process restart recovery.

These markers are operational cache state under ``.coc/runtime``.  They do
not contain campaign truth and may be discarded.  Their only authority is to
force a canonical ``session.resume`` read before a fresh model context can
perform another campaign operation.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
from typing import Any

import coc_fileio


SCHEMA_VERSION = 1
MARKER_KIND = "coc_host_context_epoch"
MARKER_DIR = Path(".coc") / "runtime" / "host-sessions"
LOCK_NAME = ".lock"
MAX_PROMPT_CHARS = 200_000

MARKER_FIELDS = frozenset({
    "schema_version", "kind", "session_id", "session_hash", "host",
    "context_epoch", "requires_resume", "compaction_pending",
    "lifecycle_event", "lifecycle_source", "started_at", "updated_at",
    "ended_at", "acknowledged_campaign_id", "acknowledged_checkpoint_id",
    "last_resume_at", "last_input",
})
INPUT_FIELDS = frozenset({
    "text", "text_sha256", "char_count", "retained", "received_at",
    "classification",
})


class HostContextError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _digest_text(value: str) -> str:
    return f"sha256:{hashlib.sha256(value.encode('utf-8')).hexdigest()}"


def _session_hash(session_id: str) -> str:
    return hashlib.sha256(
        f"coc-host-context-v1:{session_id}".encode("utf-8")
    ).hexdigest()[:40]


def _marker_dir(root: Path) -> Path:
    return Path(root).resolve() / MARKER_DIR


def _marker_path(root: Path, session_id: str) -> Path:
    return _marker_dir(root) / f"{_session_hash(session_id)}.json"


def _runtime_session_id(explicit: str | None = None) -> str | None:
    if isinstance(explicit, str) and explicit.strip():
        return explicit.strip()
    for name in (
        # The MCP transport binds one long-lived child process to the exact
        # host session that acknowledged ``session.resume``.  Prefer that
        # explicit bridge over ambient host variables, which can belong to a
        # parent launcher or another concurrently active window.
        "COC_HOST_SESSION_ID", "GROK_SESSION_ID", "CODEX_SESSION_ID",
        "CLAUDE_SESSION_ID",
    ):
        value = os.environ.get(name)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _validate_marker(value: Any) -> dict[str, Any]:
    if (
        not isinstance(value, dict)
        or set(value) != MARKER_FIELDS
        or value.get("schema_version") != SCHEMA_VERSION
        or value.get("kind") != MARKER_KIND
        or not isinstance(value.get("session_id"), str)
        or not value["session_id"]
        or value.get("session_hash") != _session_hash(value["session_id"])
        or not isinstance(value.get("host"), str)
        or not value["host"]
        or isinstance(value.get("context_epoch"), bool)
        or not isinstance(value.get("context_epoch"), int)
        or value["context_epoch"] < 1
        or not isinstance(value.get("requires_resume"), bool)
        or not isinstance(value.get("compaction_pending"), bool)
        or not isinstance(value.get("lifecycle_event"), str)
        or not isinstance(value.get("started_at"), str)
        or not isinstance(value.get("updated_at"), str)
    ):
        raise HostContextError(
            "host_context_corrupt", "host context marker shape is invalid"
        )
    for key in (
        "lifecycle_source", "ended_at", "acknowledged_campaign_id",
        "acknowledged_checkpoint_id", "last_resume_at",
    ):
        if value.get(key) is not None and not isinstance(value.get(key), str):
            raise HostContextError(
                "host_context_corrupt", f"host context marker {key} is invalid"
            )
    last_input = value.get("last_input")
    if last_input is not None:
        if (
            not isinstance(last_input, dict)
            or set(last_input) != INPUT_FIELDS
            or last_input.get("classification") != "unclassified_host_input"
            or not isinstance(last_input.get("text_sha256"), str)
            or isinstance(last_input.get("char_count"), bool)
            or not isinstance(last_input.get("char_count"), int)
            or last_input["char_count"] < 0
            or not isinstance(last_input.get("retained"), bool)
            or not isinstance(last_input.get("received_at"), str)
            or (
                last_input["retained"]
                and not isinstance(last_input.get("text"), str)
            )
            or (
                not last_input["retained"]
                and last_input.get("text") is not None
            )
        ):
            raise HostContextError(
                "host_context_corrupt", "host context input marker is invalid"
            )
        if (
            last_input["retained"]
            and _digest_text(last_input["text"]) != last_input["text_sha256"]
        ):
            raise HostContextError(
                "host_context_corrupt", "host context input hash mismatch"
            )
    return value


def _read_marker(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise HostContextError(
            "host_context_corrupt", f"host context marker {path.name} is unreadable"
        ) from exc
    return _validate_marker(value)


def _all_markers(root: Path) -> list[dict[str, Any]]:
    directory = _marker_dir(root)
    if not directory.is_dir():
        return []
    markers: list[dict[str, Any]] = []
    for path in sorted(directory.glob("*.json")):
        markers.append(_read_marker(path))
    return markers


def mark_lifecycle(
    root: Path,
    *,
    session_id: str,
    host: str,
    event: str,
    source: str | None = None,
) -> dict[str, Any]:
    """Record one host lifecycle boundary and return the current marker."""
    session_id = str(session_id or "").strip()
    host = str(host or "unknown").strip() or "unknown"
    event = str(event or "").strip().lower()
    if not session_id:
        raise HostContextError("invalid_param", "host session_id is required")
    if event not in {
        "session_start", "pre_compact", "post_compact", "session_end",
    }:
        raise HostContextError("invalid_param", f"unknown lifecycle event: {event}")
    directory = _marker_dir(root)
    path = _marker_path(root, session_id)
    with coc_fileio.advisory_file_lock(directory / LOCK_NAME):
        prior = _read_marker(path) if path.is_file() else None
        now = _now_iso()
        if prior is None:
            marker: dict[str, Any] = {
                "schema_version": SCHEMA_VERSION,
                "kind": MARKER_KIND,
                "session_id": session_id,
                "session_hash": _session_hash(session_id),
                "host": host,
                "context_epoch": 1,
                "requires_resume": True,
                "compaction_pending": False,
                "lifecycle_event": event,
                "lifecycle_source": source,
                "started_at": now,
                "updated_at": now,
                "ended_at": None,
                "acknowledged_campaign_id": None,
                "acknowledged_checkpoint_id": None,
                "last_resume_at": None,
                "last_input": None,
            }
        else:
            marker = deepcopy(prior)
            marker.update({
                "host": host,
                "lifecycle_event": event,
                "lifecycle_source": source,
                "updated_at": now,
            })

        if event == "session_start":
            duplicate_active_start = bool(
                prior is not None
                and prior.get("lifecycle_event") == "session_start"
                and prior.get("requires_resume") is True
                and prior.get("ended_at") is None
            )
            if prior is not None and not duplicate_active_start:
                marker["context_epoch"] = int(prior["context_epoch"]) + 1
            marker["requires_resume"] = True
            marker["compaction_pending"] = False
            marker["ended_at"] = None
        elif event == "pre_compact":
            if prior is not None and not prior["compaction_pending"]:
                marker["context_epoch"] = int(prior["context_epoch"]) + 1
            marker["requires_resume"] = True
            marker["compaction_pending"] = True
        elif event == "post_compact":
            duplicate_post_compact = bool(
                prior is not None
                and prior.get("lifecycle_event") == "post_compact"
                and prior.get("requires_resume") is True
                and not prior.get("compaction_pending")
            )
            if (
                prior is not None
                and not prior["compaction_pending"]
                and not duplicate_post_compact
            ):
                marker["context_epoch"] = int(prior["context_epoch"]) + 1
            marker["requires_resume"] = True
            marker["compaction_pending"] = False
        elif event == "session_end":
            marker["requires_resume"] = False
            marker["compaction_pending"] = False
            marker["ended_at"] = now

        _validate_marker(marker)
        coc_fileio.write_json_atomic(
            path, marker, indent=2, ensure_ascii=False, trailing_newline=True
        )
        return marker


def current_marker(
    root: Path, *, session_id: str | None = None
) -> dict[str, Any] | None:
    resolved = _runtime_session_id(session_id)
    if resolved is not None:
        path = _marker_path(root, resolved)
        if path.is_file():
            return _read_marker(path)
        if isinstance(session_id, str) and session_id.strip():
            return None
    markers = _all_markers(root)
    active = [row for row in markers if row.get("ended_at") is None]
    if not active:
        return None
    return max(active, key=lambda row: str(row.get("updated_at") or ""))


def pending_marker(
    root: Path, *, session_id: str | None = None
) -> dict[str, Any] | None:
    marker = current_marker(root, session_id=session_id)
    if marker is not None and marker["requires_resume"]:
        return marker
    if _runtime_session_id(session_id) is not None:
        return None
    pending = [
        row for row in _all_markers(root)
        if row.get("requires_resume") is True and row.get("ended_at") is None
    ]
    return (
        max(pending, key=lambda row: str(row.get("updated_at") or ""))
        if pending
        else None
    )


def pending_projection(marker: dict[str, Any] | None) -> dict[str, Any] | None:
    if marker is None:
        return None
    return {
        "host": marker["host"],
        "session_id": marker["session_id"],
        "context_epoch": marker["context_epoch"],
        "lifecycle_event": marker["lifecycle_event"],
        "lifecycle_source": marker["lifecycle_source"],
        "requires_resume": marker["requires_resume"],
    }


def acknowledge_resume(
    root: Path,
    *,
    campaign_id: str,
    checkpoint_id: str | None,
    session_id: str | None = None,
    context_epoch: int | None = None,
) -> dict[str, Any] | None:
    """Clear exactly one host epoch after a resume bundle was built."""
    marker = pending_marker(root, session_id=session_id)
    if marker is None:
        return None
    if context_epoch is not None and marker["context_epoch"] != int(context_epoch):
        raise HostContextError(
            "context_epoch_conflict",
            "host context changed while session.resume was being built; call session.resume again",
        )
    path = _marker_path(root, marker["session_id"])
    directory = _marker_dir(root)
    with coc_fileio.advisory_file_lock(directory / LOCK_NAME):
        current = _read_marker(path)
        if current["context_epoch"] != marker["context_epoch"]:
            raise HostContextError(
                "context_epoch_conflict",
                "host context changed while session.resume was being committed; call session.resume again",
            )
        now = _now_iso()
        current.update({
            "requires_resume": False,
            "compaction_pending": False,
            "acknowledged_campaign_id": str(campaign_id),
            "acknowledged_checkpoint_id": checkpoint_id,
            "last_resume_at": now,
            "updated_at": now,
        })
        _validate_marker(current)
        coc_fileio.write_json_atomic(
            path, current, indent=2, ensure_ascii=False, trailing_newline=True
        )
        return current


def record_prompt(
    root: Path,
    *,
    session_id: str,
    text: str,
) -> dict[str, Any] | None:
    """Keep host input only after this session was bound to a campaign.

    The input remains explicitly unclassified.  It is never promoted to a
    player action or campaign fact until the Keeper journals it through the
    canonical turn path.
    """
    path = _marker_path(root, str(session_id))
    if not path.is_file() or not isinstance(text, str):
        return None
    directory = _marker_dir(root)
    with coc_fileio.advisory_file_lock(directory / LOCK_NAME):
        marker = _read_marker(path)
        if not marker.get("acknowledged_campaign_id"):
            return None
        now = _now_iso()
        retained = len(text) <= MAX_PROMPT_CHARS
        marker["last_input"] = {
            "text": text if retained else None,
            "text_sha256": _digest_text(text),
            "char_count": len(text),
            "retained": retained,
            "received_at": now,
            "classification": "unclassified_host_input",
        }
        marker["updated_at"] = now
        _validate_marker(marker)
        coc_fileio.write_json_atomic(
            path, marker, indent=2, ensure_ascii=False, trailing_newline=True
        )
        return deepcopy(marker["last_input"])


def latest_unclassified_input(
    root: Path, *, campaign_id: str, session_id: str | None = None
) -> dict[str, Any] | None:
    resolved_session = _runtime_session_id(session_id)
    candidates = [
        row for row in _all_markers(root)
        if row.get("acknowledged_campaign_id") == campaign_id
        and (
            resolved_session is None
            or row.get("session_id") == resolved_session
        )
        and isinstance(row.get("last_input"), dict)
    ]
    if not candidates:
        return None
    marker = max(
        candidates,
        key=lambda row: str((row.get("last_input") or {}).get("received_at") or ""),
    )
    return deepcopy(marker["last_input"])
