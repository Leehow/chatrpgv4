#!/usr/bin/env python3
"""Record manual main-Codex Keeper play with a collaboration-subagent player.

This command is deliberately a post-turn evidence recorder.  It does not run
the Keeper, decide whether narration is legal, reveal clues, or advance scenes.
The main Codex loads the canonical ``plugins/coc-keeper/skills`` and calls the
toolbox itself; after a turn is complete it records the exact relay here.

The recorder's identity claims are manual/orchestrator-attested.  A SHA-256
chain detects later artifact changes, but it is not an identity attestation and
never upgrades the run to evidence-grade gameplay automatically.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
import sys
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SCHEMA_VERSION = 1
PROTOCOL = "codex_host_manual_playtest_v1"
SUBAGENT_PROTOCOL = "codex_subagent_player_v1"
STATE_NAME = "codex-host-recorder.json"
SOURCE_NAME = "turns.jsonl"
EMPTY_CHAIN_SHA256 = hashlib.sha256(b"").hexdigest()
SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,191}$")
SAFE_TASK_ID = re.compile(r"^(?:/[A-Za-z0-9][A-Za-z0-9._:/-]{0,190}|[A-Za-z0-9][A-Za-z0-9._:/-]{0,191})$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
STATE_KEYS = {
    "schema_version",
    "protocol",
    "status",
    "run_id",
    "campaign_id",
    "investigator_id",
    "workspace",
    "player",
    "orchestrator",
    "keeper_host",
    "evidence_boundary",
    "toolbox_log",
    "turn_count",
    "chain_head_sha256",
    "created_at",
    "finalized_at",
}
PLAYER_STATE_KEYS = {
    "kind", "actor_id", "task_id", "identity_attestation", "attestation_level",
}
ORCHESTRATOR_STATE_KEYS = {
    "kind", "actor_id", "identity_attestation", "attestation_level",
}
KEEPER_HOST_KEYS = {
    "kind", "role", "canonical_plugin_source", "skill_loading",
    "attestation_level", "cryptographic_identity_attestation",
}
EVIDENCE_BOUNDARY_KEYS = {
    "eligible_as_gameplay_evidence", "evidence_grade", "automatic_upgrade",
    "shared_fs_isolation", "identity_attestation", "hash_chain_scope",
    "narrative_gate_policy",
}
TOOLBOX_STATE_KEYS = {"path", "device", "inode", "initial_offset", "next_offset"}
RECORD_KEYS = {
    "schema_version",
    "player_request",
    "subagent_response",
    "kp_narration",
}
REQUEST_KEYS = {
    "schema_version",
    "protocol",
    "actor_id",
    "turn",
    "request",
    "type",
    "request_sha256",
}
RESPONSE_REQUIRED_KEYS = {
    "schema_version",
    "protocol",
    "actor_id",
    "turn",
    "request_sha256",
    "player_text",
    "intent_class",
}
FINAL_ARTIFACTS = (
    "transcript.jsonl",
    "player-view.jsonl",
    "keeper-view.jsonl",
    "runner-invocations.jsonl",
    "player-requests.jsonl",
    "subagent-responses.jsonl",
    "playtest.json",
)
TURN_KEYS = {
    "schema_version",
    "protocol",
    "run_id",
    "turn_number",
    "captured_at",
    "actor_binding",
    "player_safe_request",
    "subagent_response",
    "keeper_narration",
    "toolbox_log",
    "shared_fs_isolation",
    "previous_sha256",
    "row_sha256",
}
ACTOR_BINDING_KEYS = {
    "player_kind", "player_actor_id", "player_task_id", "keeper_kind",
    "keeper_actor_id", "identity_attestation", "attestation_level",
}
PLAYER_SAFE_RECORD_KEYS = {"attestation", "attestation_level", "envelope", "sha256"}
SUBAGENT_RECORD_KEYS = {"payload", "sha256"}
KEEPER_NARRATION_KEYS = {
    "text", "sha256", "host", "host_attestation", "attestation_level",
}
TOOLBOX_SLICE_KEYS = {
    "source_path", "start_offset", "end_offset", "byte_length", "sha256",
    "snapshot_path", "source_file_size_at_capture",
}


class RecorderError(ValueError):
    """Closed recorder failure with a stable, user-actionable code."""

    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _canonical_bytes(value: Any) -> bytes:
    try:
        return json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        ).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise RecorderError("invalid_json_value", "record contains a non-JSON value") from exc


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _sha256_value(value: Any) -> str:
    return _sha256_bytes(_canonical_bytes(value))


def _sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _safe_id(value: Any, label: str) -> str:
    text = str(value or "")
    if SAFE_ID.fullmatch(text) is None or ".." in text.split("/"):
        raise RecorderError("invalid_identifier", f"{label} must be a stable safe id")
    return text


def _safe_task_id(value: Any) -> str:
    text = str(value or "")
    if SAFE_TASK_ID.fullmatch(text) is None or ".." in text.split("/"):
        raise RecorderError("invalid_identifier", "player_task_id must be a stable safe task id")
    return text


def _regular_file(path: Path, label: str) -> os.stat_result:
    try:
        info = path.lstat()
    except OSError as exc:
        raise RecorderError("source_unavailable", f"{label} is unavailable: {path}") from exc
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
        raise RecorderError("unsafe_source", f"{label} must be a regular non-symlink file")
    return info


def _atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_symlink():
        raise RecorderError("unsafe_output", f"output must not be a symlink: {path}")
    descriptor, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temp_path = Path(temp_name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, path)
    finally:
        try:
            temp_path.unlink()
        except FileNotFoundError:
            pass


def _write_json(path: Path, payload: Any) -> None:
    _atomic_write(
        path,
        json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False).encode("utf-8")
        + b"\n",
    )


def _jsonl_bytes(rows: list[dict[str, Any]]) -> bytes:
    return b"".join(
        json.dumps(row, ensure_ascii=False, sort_keys=True, allow_nan=False).encode("utf-8")
        + b"\n"
        for row in rows
    )


def _read_json(path: Path, label: str) -> dict[str, Any]:
    _regular_file(path, label)
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise RecorderError("unsupported_save_schema", f"{label} is unreadable; delete the run and restart") from exc
    if not isinstance(value, dict):
        raise RecorderError("unsupported_save_schema", f"{label} is not current schema; delete the run and restart")
    return value


def _read_jsonl(path: Path, label: str) -> list[dict[str, Any]]:
    if not path.exists():
        raise RecorderError(
            "unsupported_save_schema",
            f"{label} is missing; delete the run and restart",
        )
    _regular_file(path, label)
    rows: list[dict[str, Any]] = []
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeError) as exc:
        raise RecorderError("unsupported_save_schema", f"{label} is unreadable; delete the run and restart") from exc
    for line_number, line in enumerate(lines, start=1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError as exc:
            raise RecorderError(
                "unsupported_save_schema",
                f"{label} line {line_number} is malformed; delete the run and restart",
            ) from exc
        if not isinstance(row, dict):
            raise RecorderError("unsupported_save_schema", f"{label} is not current schema; delete the run and restart")
        rows.append(row)
    return rows


def _load_state(run_dir: Path) -> dict[str, Any]:
    state = _read_json(run_dir / STATE_NAME, "recorder state")
    player = state.get("player")
    orchestrator = state.get("orchestrator")
    keeper_host = state.get("keeper_host")
    boundary = state.get("evidence_boundary")
    toolbox = state.get("toolbox_log")
    valid_ids = (
        isinstance(state.get("run_id"), str)
        and SAFE_ID.fullmatch(state["run_id"]) is not None
        and isinstance(state.get("campaign_id"), str)
        and SAFE_ID.fullmatch(state["campaign_id"]) is not None
        and isinstance(state.get("investigator_id"), str)
        and SAFE_ID.fullmatch(state["investigator_id"]) is not None
        and isinstance(player, dict)
        and isinstance(player.get("actor_id"), str)
        and SAFE_ID.fullmatch(player["actor_id"]) is not None
        and isinstance(player.get("task_id"), str)
        and SAFE_TASK_ID.fullmatch(player["task_id"]) is not None
        and isinstance(orchestrator, dict)
        and isinstance(orchestrator.get("actor_id"), str)
        and SAFE_ID.fullmatch(orchestrator["actor_id"]) is not None
    )
    offsets_valid = (
        isinstance(toolbox, dict)
        and isinstance(toolbox.get("path"), str)
        and Path(toolbox["path"]).is_absolute()
        and all(
            isinstance(toolbox.get(key), int)
            and not isinstance(toolbox.get(key), bool)
            and toolbox[key] >= 0
            for key in ("device", "inode", "initial_offset", "next_offset")
        )
        and toolbox["next_offset"] >= toolbox["initial_offset"]
    )
    if (
        set(state) != STATE_KEYS
        or state.get("schema_version") != SCHEMA_VERSION
        or state.get("protocol") != PROTOCOL
        or state.get("status") not in {"open", "finalized"}
        or not isinstance(player, dict)
        or set(player) != PLAYER_STATE_KEYS
        or player.get("kind") != "codex_subagent"
        or player.get("identity_attestation") != "orchestrator_attested"
        or player.get("attestation_level") != "manual"
        or not isinstance(orchestrator, dict)
        or set(orchestrator) != ORCHESTRATOR_STATE_KEYS
        or orchestrator.get("kind") != "codex"
        or orchestrator.get("identity_attestation") != "orchestrator_attested"
        or orchestrator.get("attestation_level") != "manual"
        or not isinstance(keeper_host, dict)
        or set(keeper_host) != KEEPER_HOST_KEYS
        or keeper_host.get("kind") != "codex"
        or keeper_host.get("role") != "main_orchestrator_keeper"
        or keeper_host.get("canonical_plugin_source") != "plugins/coc-keeper/skills"
        or keeper_host.get("skill_loading") != "orchestrator_attested"
        or keeper_host.get("attestation_level") != "manual"
        or keeper_host.get("cryptographic_identity_attestation") is not False
        or not isinstance(boundary, dict)
        or set(boundary) != EVIDENCE_BOUNDARY_KEYS
        or boundary.get("eligible_as_gameplay_evidence") is not False
        or boundary.get("evidence_grade") != "NOT_ATTESTED"
        or boundary.get("automatic_upgrade") is not False
        or boundary.get("shared_fs_isolation") != "NOT_ATTESTED"
        or boundary.get("identity_attestation") != "manual_orchestrator_attestation_only"
        or boundary.get("hash_chain_scope") != "artifact_integrity_not_actor_identity"
        or boundary.get("narrative_gate_policy") != "none_recorder_is_post_turn_only"
        or not isinstance(toolbox, dict)
        or set(toolbox) != TOOLBOX_STATE_KEYS
        or not valid_ids
        or not offsets_valid
        or not isinstance(state.get("workspace"), str)
        or not Path(state["workspace"]).is_absolute()
        or isinstance(state.get("turn_count"), bool)
        or not isinstance(state.get("turn_count"), int)
        or state["turn_count"] < 0
        or SHA256.fullmatch(str(state.get("chain_head_sha256") or "")) is None
        or not isinstance(state.get("created_at"), str)
        or not state["created_at"]
        or (
            state["status"] == "open" and state.get("finalized_at") is not None
        )
        or (
            state["status"] == "finalized"
            and (not isinstance(state.get("finalized_at"), str) or not state["finalized_at"])
        )
    ):
        raise RecorderError(
            "unsupported_save_schema",
            "recorder state is not the exact current schema; delete the run and restart",
        )
    return state


def _read_record_input(path: str) -> dict[str, Any]:
    try:
        text = sys.stdin.read() if path == "-" else Path(path).read_text(encoding="utf-8")
        value = json.loads(text)
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise RecorderError("invalid_turn_record", "turn record must be one readable JSON object") from exc
    if not isinstance(value, dict) or set(value) != RECORD_KEYS or value.get("schema_version") != 1:
        raise RecorderError("invalid_turn_record", "turn record does not match schema_version 1 exact shape")
    return value


def init_run(
    run_dir: Path | str,
    *,
    workspace: Path | str,
    campaign_id: str,
    investigator_id: str,
    player_actor_id: str,
    player_task_id: str,
    orchestrator_id: str,
    toolbox_log: Path | str,
    toolbox_start_offset: int | None = None,
    run_id: str | None = None,
) -> dict[str, Any]:
    destination = Path(run_dir).absolute()
    if destination.is_symlink():
        raise RecorderError("unsafe_output", "run directory must not be a symlink")
    if destination.exists() and not destination.is_dir():
        raise RecorderError("unsafe_output", "run directory must be a directory")
    if destination.exists() and any(destination.iterdir()):
        raise RecorderError(
            "new_run_required",
            "run directory is not empty; old saves are unsupported, delete it and start a new run",
        )
    destination.mkdir(parents=True, exist_ok=True)
    workspace_path = Path(workspace).resolve()
    if not workspace_path.is_dir():
        raise RecorderError("workspace_unavailable", "workspace must be an existing directory")
    source = Path(toolbox_log).resolve()
    info = _regular_file(source, "toolbox log")
    start = info.st_size if toolbox_start_offset is None else toolbox_start_offset
    if isinstance(start, bool) or not isinstance(start, int) or start < 0 or start > info.st_size:
        raise RecorderError("invalid_toolbox_offset", "toolbox start offset must be inside the current file")
    identity = _safe_id(run_id or f"coc-codex-host-v1:{uuid.uuid4().hex}", "run_id")
    state = {
        "schema_version": SCHEMA_VERSION,
        "protocol": PROTOCOL,
        "status": "open",
        "run_id": identity,
        "campaign_id": _safe_id(campaign_id, "campaign_id"),
        "investigator_id": _safe_id(investigator_id, "investigator_id"),
        "workspace": str(workspace_path),
        "player": {
            "kind": "codex_subagent",
            "actor_id": _safe_id(player_actor_id, "player_actor_id"),
            "task_id": _safe_task_id(player_task_id),
            "identity_attestation": "orchestrator_attested",
            "attestation_level": "manual",
        },
        "orchestrator": {
            "kind": "codex",
            "actor_id": _safe_id(orchestrator_id, "orchestrator_id"),
            "identity_attestation": "orchestrator_attested",
            "attestation_level": "manual",
        },
        "keeper_host": {
            "kind": "codex",
            "role": "main_orchestrator_keeper",
            "canonical_plugin_source": "plugins/coc-keeper/skills",
            "skill_loading": "orchestrator_attested",
            "attestation_level": "manual",
            "cryptographic_identity_attestation": False,
        },
        "evidence_boundary": {
            "eligible_as_gameplay_evidence": False,
            "evidence_grade": "NOT_ATTESTED",
            "automatic_upgrade": False,
            "shared_fs_isolation": "NOT_ATTESTED",
            "identity_attestation": "manual_orchestrator_attestation_only",
            "hash_chain_scope": "artifact_integrity_not_actor_identity",
            "narrative_gate_policy": "none_recorder_is_post_turn_only",
        },
        "toolbox_log": {
            "path": str(source),
            "device": info.st_dev,
            "inode": info.st_ino,
            "initial_offset": start,
            "next_offset": start,
        },
        "turn_count": 0,
        "chain_head_sha256": EMPTY_CHAIN_SHA256,
        "created_at": _utc_now(),
        "finalized_at": None,
    }
    _write_json(destination / STATE_NAME, state)
    _atomic_write(destination / SOURCE_NAME, b"")
    return state


def _validated_request_response(
    state: dict[str, Any], record: dict[str, Any], turn_number: int
) -> tuple[dict[str, Any], dict[str, Any]]:
    request = record.get("player_request")
    response = record.get("subagent_response")
    if not isinstance(request, dict) or set(request) != REQUEST_KEYS:
        raise RecorderError("invalid_player_request", "player request must use the exact current relay envelope")
    actor_id = state["player"]["actor_id"]
    binding = {
        "schema_version": 1,
        "protocol": SUBAGENT_PROTOCOL,
        "actor_id": actor_id,
        "turn": turn_number,
        "request": request.get("request"),
    }
    expected_request_sha = _sha256_value(binding)
    if (
        request.get("schema_version") != 1
        or request.get("protocol") != SUBAGENT_PROTOCOL
        or request.get("actor_id") != actor_id
        or request.get("turn") != turn_number
        or request.get("type") != "player_request"
        or not isinstance(request.get("request"), dict)
        or request.get("request_sha256") != expected_request_sha
    ):
        raise RecorderError("player_request_binding_mismatch", "player request binding does not match this actor and turn")
    pending = request["request"].get("pending_choice")
    expected_response_keys = RESPONSE_REQUIRED_KEYS | (
        {"pending_choice_response"} if pending is not None else set()
    )
    if (
        not isinstance(response, dict)
        or set(response) != expected_response_keys
    ):
        raise RecorderError("invalid_subagent_response", "subagent response must use the exact current response shape")
    if (
        response.get("schema_version") != 1
        or response.get("protocol") != SUBAGENT_PROTOCOL
        or response.get("actor_id") != actor_id
        or response.get("turn") != turn_number
        or response.get("request_sha256") != expected_request_sha
        or not isinstance(response.get("player_text"), str)
        or not response["player_text"].strip()
        or not isinstance(response.get("intent_class"), str)
        or not response["intent_class"].strip()
    ):
        raise RecorderError("subagent_response_binding_mismatch", "subagent response does not match this actor, request, and turn")
    if pending is not None:
        pending_response = response.get("pending_choice_response")
        if (
            not isinstance(pending, dict)
            or pending.get("responder") != "player"
            or not isinstance(pending_response, dict)
            or set(pending_response) != {"choice_id", "responder", "revision", "action"}
        ):
            raise RecorderError(
                "pending_choice_binding_mismatch",
                "pending choice response must mirror the exact current player choice",
            )
        options = pending.get("options")
        allowed_actions = {
            option.get("action")
            for option in options
            if isinstance(option, dict) and isinstance(option.get("action"), str)
        } if isinstance(options, list) else set()
        if (
            pending_response.get("choice_id") != pending.get("choice_id")
            or pending_response.get("responder") != "player"
            or pending_response.get("revision") != pending.get("revision")
            or not isinstance(pending_response.get("action"), str)
            or not pending_response["action"].strip()
            or pending_response["action"] not in allowed_actions
        ):
            raise RecorderError(
                "pending_choice_binding_mismatch",
                "pending choice response does not match id, revision, responder, and option",
            )
    narration = record.get("kp_narration")
    if not isinstance(narration, str) or not narration.strip():
        raise RecorderError("invalid_kp_narration", "kp_narration must be a non-empty string")
    return request, response


def _validate_toolbox_source(state: dict[str, Any]) -> tuple[Path, os.stat_result]:
    expected = state.get("toolbox_log")
    if not isinstance(expected, dict):
        raise RecorderError("unsupported_save_schema", "toolbox source is not current schema; delete and restart")
    source = Path(str(expected.get("path") or ""))
    info = _regular_file(source, "toolbox log")
    if info.st_dev != expected.get("device") or info.st_ino != expected.get("inode"):
        raise RecorderError("toolbox_source_changed", "toolbox log identity changed; start a new run")
    return source, info


def append_turn(
    run_dir: Path | str,
    record: dict[str, Any],
    *,
    toolbox_end_offset: int | None = None,
) -> dict[str, Any]:
    destination = Path(run_dir).absolute()
    if not isinstance(record, dict) or set(record) != RECORD_KEYS or record.get("schema_version") != 1:
        raise RecorderError("invalid_turn_record", "turn record does not match schema_version 1 exact shape")
    state = _load_state(destination)
    if state["status"] != "open":
        raise RecorderError("run_finalized", "finalized runs cannot accept turns; start a new run")
    rows = _read_jsonl(destination / SOURCE_NAME, "turn source")
    existing_findings = _validate_chain(state, rows, run_dir=destination)
    if existing_findings:
        raise RecorderError("record_integrity_failed", ",".join(existing_findings))
    turn_number = len(rows) + 1
    request, response = _validated_request_response(state, record, turn_number)
    source, info = _validate_toolbox_source(state)
    start = state["toolbox_log"]["next_offset"]
    end = info.st_size if toolbox_end_offset is None else toolbox_end_offset
    if isinstance(end, bool) or not isinstance(end, int) or end < start or end > info.st_size:
        raise RecorderError("invalid_toolbox_offset", "toolbox end offset must be between the prior offset and current EOF")
    with source.open("rb") as handle:
        handle.seek(start)
        toolbox_bytes = handle.read(end - start)
    if len(toolbox_bytes) != end - start:
        raise RecorderError("toolbox_read_incomplete", "toolbox log changed while its slice was captured")
    slice_name = f"toolbox-slices/turn-{turn_number:06d}.jsonl"
    prior = state["chain_head_sha256"]
    row: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "protocol": PROTOCOL,
        "run_id": state["run_id"],
        "turn_number": turn_number,
        "captured_at": _utc_now(),
        "actor_binding": {
            "player_kind": "codex_subagent",
            "player_actor_id": state["player"]["actor_id"],
            "player_task_id": state["player"]["task_id"],
            "keeper_kind": "codex",
            "keeper_actor_id": state["orchestrator"]["actor_id"],
            "identity_attestation": "orchestrator_attested",
            "attestation_level": "manual",
        },
        "player_safe_request": {
            "attestation": "orchestrator_attested",
            "attestation_level": "manual",
            "envelope": request,
            "sha256": request["request_sha256"],
        },
        "subagent_response": {
            "payload": response,
            "sha256": _sha256_value(response),
        },
        "keeper_narration": {
            "text": record["kp_narration"].strip(),
            "sha256": _sha256_value(record["kp_narration"].strip()),
            "host": "main_codex_canonical_plugin_orchestrator",
            "host_attestation": "orchestrator_attested",
            "attestation_level": "manual",
        },
        "toolbox_log": {
            "source_path": str(source),
            "start_offset": start,
            "end_offset": end,
            "byte_length": len(toolbox_bytes),
            "sha256": _sha256_bytes(toolbox_bytes),
            "snapshot_path": slice_name,
            "source_file_size_at_capture": info.st_size,
        },
        "shared_fs_isolation": "NOT_ATTESTED",
        "previous_sha256": prior,
    }
    row["row_sha256"] = _sha256_value(row)
    _atomic_write(destination / slice_name, toolbox_bytes)
    _atomic_write(destination / SOURCE_NAME, _jsonl_bytes([*rows, row]))
    state["turn_count"] = turn_number
    state["chain_head_sha256"] = row["row_sha256"]
    state["toolbox_log"]["next_offset"] = end
    _write_json(destination / STATE_NAME, state)
    return row


def _validate_chain(
    state: dict[str, Any], rows: list[dict[str, Any]], *, run_dir: Path | None = None
) -> list[str]:
    findings: list[str] = []
    previous = EMPTY_CHAIN_SHA256
    toolbox_offset = state.get("toolbox_log", {}).get("initial_offset")
    for index, row in enumerate(rows, start=1):
        stored_sha = row.get("row_sha256")
        without_sha = dict(row)
        without_sha.pop("row_sha256", None)
        if (
            set(row) != TURN_KEYS
            or row.get("schema_version") != SCHEMA_VERSION
            or row.get("protocol") != PROTOCOL
            or row.get("run_id") != state.get("run_id")
            or row.get("turn_number") != index
            or not isinstance(row.get("captured_at"), str)
            or not row["captured_at"]
            or SHA256.fullmatch(str(row.get("previous_sha256") or "")) is None
            or SHA256.fullmatch(str(stored_sha or "")) is None
        ):
            findings.append(f"turn_schema_or_sequence_invalid:{index}")
        if row.get("previous_sha256") != previous:
            findings.append(f"turn_previous_hash_mismatch:{index}")
        calculated = _sha256_value(without_sha)
        if stored_sha != calculated:
            findings.append(f"turn_row_hash_mismatch:{index}")
        actor = row.get("actor_binding") if isinstance(row.get("actor_binding"), dict) else {}
        if (
            set(actor) != ACTOR_BINDING_KEYS
            or actor.get("player_kind") != "codex_subagent"
            or actor.get("player_actor_id") != state.get("player", {}).get("actor_id")
            or actor.get("player_task_id") != state.get("player", {}).get("task_id")
            or actor.get("keeper_kind") != "codex"
            or actor.get("keeper_actor_id") != state.get("orchestrator", {}).get("actor_id")
            or actor.get("identity_attestation") != "orchestrator_attested"
            or actor.get("attestation_level") != "manual"
        ):
            findings.append(f"turn_nested_schema_invalid:{index}")
        toolbox = row.get("toolbox_log") if isinstance(row.get("toolbox_log"), dict) else {}
        request_record = row.get("player_safe_request")
        response_record = row.get("subagent_response")
        narration_record = row.get("keeper_narration")
        try:
            if (
                not isinstance(request_record, dict)
                or set(request_record) != PLAYER_SAFE_RECORD_KEYS
                or request_record.get("attestation") != "orchestrator_attested"
                or request_record.get("attestation_level") != "manual"
                or not isinstance(response_record, dict)
                or set(response_record) != SUBAGENT_RECORD_KEYS
                or not isinstance(narration_record, dict)
                or set(narration_record) != KEEPER_NARRATION_KEYS
                or narration_record.get("host") != "main_codex_canonical_plugin_orchestrator"
                or narration_record.get("host_attestation") != "orchestrator_attested"
                or narration_record.get("attestation_level") != "manual"
                or row.get("shared_fs_isolation") != "NOT_ATTESTED"
            ):
                raise RecorderError("turn_nested_schema_invalid", "nested turn schema mismatch")
            request = request_record["envelope"]
            response = response_record["payload"]
            narration = narration_record["text"]
            _validated_request_response(
                state,
                {
                    "schema_version": 1,
                    "player_request": request,
                    "subagent_response": response,
                    "kp_narration": narration,
                },
                index,
            )
            if (
                request_record.get("sha256") != request.get("request_sha256")
                or response_record.get("sha256") != _sha256_value(response)
                or narration_record.get("sha256") != _sha256_value(narration)
            ):
                findings.append(f"turn_payload_digest_mismatch:{index}")
        except (KeyError, TypeError, RecorderError):
            findings.append(f"turn_nested_schema_invalid:{index}")
        snapshot = Path(str(toolbox.get("snapshot_path") or ""))
        start = toolbox.get("start_offset")
        end = toolbox.get("end_offset")
        length = toolbox.get("byte_length")
        if (
            set(toolbox) != TOOLBOX_SLICE_KEYS
            or start != toolbox_offset
            or isinstance(end, bool)
            or not isinstance(end, int)
            or isinstance(length, bool)
            or not isinstance(length, int)
            or not isinstance(start, int)
            or end < start
            or length != end - start
            or isinstance(toolbox.get("source_file_size_at_capture"), bool)
            or not isinstance(toolbox.get("source_file_size_at_capture"), int)
            or toolbox["source_file_size_at_capture"] < end
            or SHA256.fullmatch(str(toolbox.get("sha256") or "")) is None
            or toolbox.get("source_path") != state.get("toolbox_log", {}).get("path")
        ):
            findings.append(f"toolbox_slice_contract_invalid:{index}")
        else:
            toolbox_offset = end
        if (
            snapshot != Path(f"toolbox-slices/turn-{index:06d}.jsonl")
            or snapshot.is_absolute()
            or ".." in snapshot.parts
        ):
            findings.append(f"toolbox_snapshot_path_invalid:{index}")
        else:
            target = run_dir / snapshot if run_dir is not None else None
            if target is not None and (
                not target.is_file()
                or target.is_symlink()
                or _sha256_path(target) != toolbox.get("sha256")
                or target.stat().st_size != toolbox.get("byte_length")
            ):
                findings.append(f"toolbox_snapshot_digest_mismatch:{index}")
        previous = stored_sha if isinstance(stored_sha, str) else calculated
    if state.get("turn_count") != len(rows):
        findings.append("state_turn_count_mismatch")
    if state.get("chain_head_sha256") != previous:
        findings.append("state_chain_head_mismatch")
    return findings


def _source_findings(run_dir: Path, state: dict[str, Any], rows: list[dict[str, Any]]) -> list[str]:
    return _validate_chain(state, rows, run_dir=run_dir)


def _projections(state: dict[str, Any], rows: list[dict[str, Any]]) -> dict[str, bytes]:
    transcript: list[dict[str, Any]] = []
    player_view: list[dict[str, Any]] = []
    keeper_view: list[dict[str, Any]] = []
    invocations: list[dict[str, Any]] = []
    requests: list[dict[str, Any]] = []
    responses: list[dict[str, Any]] = []
    for row in rows:
        turn = row["turn_number"]
        envelope = row["player_safe_request"]["envelope"]
        response = row["subagent_response"]["payload"]
        narration = row["keeper_narration"]["text"]
        chain_sha = row["row_sha256"]
        transcript.extend(
            [
                {
                    "schema_version": 1,
                    "turn": turn,
                    "role": "player_simulator",
                    "speaker": "player",
                    "text": response["player_text"],
                    "actor_id": state["player"]["actor_id"],
                    "source": "codex_collaboration_subagent_response",
                    "record_chain_sha256": chain_sha,
                },
                {
                    "schema_version": 1,
                    "turn": turn,
                    "role": "keeper_under_test",
                    "speaker": "keeper",
                    "text": narration,
                    "actor_id": state["orchestrator"]["actor_id"],
                    "source": "main_codex_canonical_plugin_orchestrator",
                    "record_chain_sha256": chain_sha,
                },
            ]
        )
        player_view.append(
            {
                "schema_version": 1,
                "view": "player",
                "turn_number": turn,
                "request": envelope["request"],
                "request_sha256": envelope["request_sha256"],
                "player_text": response["player_text"],
                "narration": narration,
                "player_safe_attestation": "orchestrator_attested",
                "attestation_level": "manual",
                "shared_fs_isolation": "NOT_ATTESTED",
            }
        )
        keeper_view.append(
            {
                "schema_version": 1,
                "view": "keeper",
                "turn_number": turn,
                "player_request": row["player_safe_request"],
                "subagent_response": row["subagent_response"],
                "kp_narration": row["keeper_narration"],
                "toolbox_log": row["toolbox_log"],
                "actor_binding": row["actor_binding"],
                "record_chain_sha256": chain_sha,
            }
        )
        requests.append(
            {
                "schema_version": 1,
                "turn_number": turn,
                "actor_id": state["player"]["actor_id"],
                "task_id": state["player"]["task_id"],
                "request": envelope,
                "attestation": "orchestrator_attested",
                "attestation_level": "manual",
            }
        )
        responses.append(
            {
                "schema_version": 1,
                "turn_number": turn,
                "actor_id": state["player"]["actor_id"],
                "task_id": state["player"]["task_id"],
                "response": response,
                "response_sha256": row["subagent_response"]["sha256"],
                "attestation": "orchestrator_attested",
                "attestation_level": "manual",
            }
        )
        invocations.extend(
            [
                {
                    "schema_version": 1,
                    "role": "player",
                    "attempt": 1,
                    "transcript_turn": turn,
                    "runner_kind": "codex_collaboration_subagent",
                    "runner_identity": "manual_collaboration_relay",
                    "runner_path": None,
                    "runner_sha256": None,
                    "model_identity": None,
                    "outcome": "codex_subagent_input",
                    "response_mode": "codex_subagent_manual_relay",
                    "fallback_kind": None,
                    "duration_seconds": 0.0,
                    "duration_measured": False,
                    "actor_kind": "codex_subagent",
                    "actor_id": state["player"]["actor_id"],
                    "task_id": state["player"]["task_id"],
                    "request_sha256": envelope["request_sha256"],
                    "response_sha256": row["subagent_response"]["sha256"],
                    "identity_attestation": "orchestrator_attested",
                    "attestation_level": "manual",
                    "shared_fs_isolation": "NOT_ATTESTED",
                },
                {
                    "schema_version": 1,
                    "role": "narrator",
                    "attempt": 1,
                    "transcript_turn": turn,
                    "runner_kind": "codex_host",
                    "runner_identity": "main_codex_canonical_plugin_orchestrator",
                    "runner_path": None,
                    "runner_sha256": None,
                    "model_identity": None,
                    "outcome": "manual_codex_host_narration",
                    "response_mode": "codex_host_plugin_skills",
                    "fallback_kind": None,
                    "duration_seconds": 0.0,
                    "duration_measured": False,
                    "actor_kind": "codex",
                    "actor_id": state["orchestrator"]["actor_id"],
                    "narration_sha256": row["keeper_narration"]["sha256"],
                    "toolbox_log": row["toolbox_log"],
                    "identity_attestation": "orchestrator_attested",
                    "attestation_level": "manual",
                },
            ]
        )
    playtest = {
        "schema_version": 1,
        "run_id": state["run_id"],
        "campaign_id": state["campaign_id"],
        "investigator_id": state["investigator_id"],
        "audit_profile": "codex_host_manual_recorder",
        "player_profile": "codex_collaboration_subagent_player",
        "simulation_method": "main_codex_canonical_plugin_manual_orchestration",
        "keeper_host": state["keeper_host"],
        "player": state["player"],
        "orchestrator": state["orchestrator"],
        "operator_review_protocol": SUBAGENT_PROTOCOL,
        "operator_review_status": "pending",
        "eligible_as_gameplay_evidence": False,
        "evidence_grade": "NOT_ATTESTED",
        "evidence_reasons": [
            "manual_orchestrator_attestation_only",
            "shared_fs_isolation_not_attested",
            "independent_review_not_recorded",
        ],
        "automatic_evidence_upgrade": False,
        "shared_fs_isolation": "NOT_ATTESTED",
        "turn_count": len(rows),
        "record_chain_sha256": state["chain_head_sha256"],
        "recorder_protocol": PROTOCOL,
        "recorder_status": state["status"],
        "created_at": state["created_at"],
        "finalized_at": state["finalized_at"],
        "narrative_gate_policy": "none_recorder_is_post_turn_only",
    }
    return {
        "transcript.jsonl": _jsonl_bytes(transcript),
        "player-view.jsonl": _jsonl_bytes(player_view),
        "keeper-view.jsonl": _jsonl_bytes(keeper_view),
        "runner-invocations.jsonl": _jsonl_bytes(invocations),
        "player-requests.jsonl": _jsonl_bytes(requests),
        "subagent-responses.jsonl": _jsonl_bytes(responses),
        "playtest.json": json.dumps(playtest, ensure_ascii=False, indent=2, allow_nan=False).encode("utf-8") + b"\n",
    }


def _manifest(state: dict[str, Any], rows: list[dict[str, Any]], projections: dict[str, bytes]) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "protocol": PROTOCOL,
        "run_id": state["run_id"],
        "status": "finalized",
        "turn_count": len(rows),
        "chain_head_sha256": state["chain_head_sha256"],
        "artifacts": {
            SOURCE_NAME: {"sha256": _sha256_bytes(_jsonl_bytes(rows))},
            **{
                name: {"sha256": _sha256_bytes(payload)}
                for name, payload in sorted(projections.items())
            },
        },
        "evidence_boundary": state["evidence_boundary"],
    }


def finalize_run(run_dir: Path | str) -> dict[str, Any]:
    destination = Path(run_dir).absolute()
    state = _load_state(destination)
    rows = _read_jsonl(destination / SOURCE_NAME, "turn source")
    findings = _source_findings(destination, state, rows)
    if findings:
        raise RecorderError("record_integrity_failed", ",".join(findings))
    if not rows:
        raise RecorderError("empty_run", "record at least one completed turn before finalize")
    if state["status"] == "open":
        state["status"] = "finalized"
        state["finalized_at"] = _utc_now()
    projections = _projections(state, rows)
    for name, payload in projections.items():
        _atomic_write(destination / name, payload)
    _write_json(destination / STATE_NAME, state)
    manifest = _manifest(state, rows, projections)
    _write_json(destination / "artifact-manifest.json", manifest)
    receipt = verify_run(destination)
    _write_json(destination / "verification.json", receipt)
    if not receipt["valid"]:
        raise RecorderError("record_integrity_failed", ",".join(receipt["findings"]))
    return manifest


def verify_run(run_dir: Path | str) -> dict[str, Any]:
    destination = Path(run_dir).absolute()
    try:
        state = _load_state(destination)
        rows = _read_jsonl(destination / SOURCE_NAME, "turn source")
        findings = _source_findings(destination, state, rows)
        if state["status"] == "finalized" and not findings:
            expected = _projections(state, rows)
            for name, payload in expected.items():
                path = destination / name
                if not path.is_file() or path.is_symlink() or path.read_bytes() != payload:
                    findings.append(f"final_artifact_mismatch:{name}")
            manifest_path = destination / "artifact-manifest.json"
            if not manifest_path.is_file() or manifest_path.is_symlink():
                findings.append("artifact_manifest_missing")
            else:
                manifest = _read_json(manifest_path, "artifact manifest")
                if manifest != _manifest(state, rows, expected):
                    findings.append("artifact_manifest_mismatch")
        return {
            "schema_version": 1,
            "protocol": PROTOCOL,
            "run_id": state["run_id"],
            "valid": not findings,
            "status": "VALID" if not findings else "INVALID",
            "finalized": state["status"] == "finalized",
            "turn_count": len(rows),
            "chain_head_sha256": state["chain_head_sha256"],
            "evidence_grade": "NOT_ATTESTED",
            "eligible_as_gameplay_evidence": False,
            "shared_fs_isolation": "NOT_ATTESTED",
            "identity_attestation": "manual_orchestrator_attestation_only",
            "findings": findings,
        }
    except RecorderError as exc:
        return {
            "schema_version": 1,
            "protocol": PROTOCOL,
            "valid": False,
            "status": "INVALID",
            "finalized": False,
            "evidence_grade": "NOT_ATTESTED",
            "eligible_as_gameplay_evidence": False,
            "shared_fs_isolation": "NOT_ATTESTED",
            "identity_attestation": "manual_orchestrator_attestation_only",
            "findings": [exc.code],
        }


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Post-turn recorder for main Codex Keeper + collaboration-subagent player actual play"
    )
    commands = parser.add_subparsers(dest="command", required=True)
    init = commands.add_parser("init", help="create one new current-schema recorder run")
    init.add_argument("--run-dir", required=True)
    init.add_argument("--workspace", required=True)
    init.add_argument("--campaign", required=True, dest="campaign_id")
    init.add_argument("--investigator", required=True, dest="investigator_id")
    init.add_argument("--player-actor-id", required=True)
    init.add_argument("--player-task-id", required=True)
    init.add_argument("--orchestrator-id", default="main-codex")
    init.add_argument("--toolbox-log", required=True)
    init.add_argument("--toolbox-start-offset", type=int, default=None)
    init.add_argument("--run-id", default=None)
    append = commands.add_parser("append-turn", help="record one already-completed play turn")
    append.add_argument("--run-dir", required=True)
    append.add_argument("--record-json", required=True, help="JSON object path, or - for stdin")
    append.add_argument("--toolbox-end-offset", type=int, default=None)
    finalize = commands.add_parser("finalize", help="export report-consumable projections and manifest")
    finalize.add_argument("--run-dir", required=True)
    verify = commands.add_parser("verify", help="read-only verification of source chain and final projections")
    verify.add_argument("--run-dir", required=True)
    return parser


def _main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        if args.command == "init":
            result = init_run(
                args.run_dir,
                workspace=args.workspace,
                campaign_id=args.campaign_id,
                investigator_id=args.investigator_id,
                player_actor_id=args.player_actor_id,
                player_task_id=args.player_task_id,
                orchestrator_id=args.orchestrator_id,
                toolbox_log=args.toolbox_log,
                toolbox_start_offset=args.toolbox_start_offset,
                run_id=args.run_id,
            )
        elif args.command == "append-turn":
            result = append_turn(
                args.run_dir,
                _read_record_input(args.record_json),
                toolbox_end_offset=args.toolbox_end_offset,
            )
        elif args.command == "finalize":
            result = finalize_run(args.run_dir)
        else:
            result = verify_run(args.run_dir)
            print(json.dumps(result, ensure_ascii=False, sort_keys=True))
            return 0 if result["valid"] else 1
    except RecorderError as exc:
        print(
            json.dumps({"ok": False, "code": exc.code, "message": str(exc)}, ensure_ascii=False),
            file=sys.stderr,
        )
        return 2
    print(json.dumps({"ok": True, "result": result}, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
