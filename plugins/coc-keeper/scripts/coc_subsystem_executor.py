#!/usr/bin/env python3
"""Canonical stateful bridge from Director subsystem commands to CoC engines.

The executor validates a complete command batch before it consumes randomness
or mutates campaign state.  Successful results are snapshotted in
``save/subsystem-state.json`` so retries after a process restart are exact,
side-effect-free replays.
"""
from __future__ import annotations

import base64
import hashlib
import importlib.util
import json
import math
import os
import random
import re
import time
from pathlib import Path
from typing import Any, Callable, TypedDict


SCRIPT_DIR = Path(__file__).resolve().parent
STATE_SCHEMA_VERSION = 1
STATE_RELATIVE_PATH = Path("save/subsystem-state.json")

COMMAND_KEYS = frozenset({"command_id", "kind", "phase", "payload"})
RESULT_KEYS = frozenset({
    "command_id",
    "kind",
    "status",
    "events",
    "pending_choice",
    "state_refs",
})
ROLL_COMMAND_KINDS = frozenset({
    "skill_check",
    "characteristic_check",
    "sanity_check",
    "opposed_check",
    "idea_roll",
})
SUPPORTED_COMMAND_KINDS = ROLL_COMMAND_KINDS | {"push_offer"}
EXPECTED_PHASE = {
    **{kind: "resolve" for kind in ROLL_COMMAND_KINDS},
    "push_offer": "offer",
}
RESULT_STATUSES_BY_KIND = {
    **{kind: frozenset({"completed"}) for kind in ROLL_COMMAND_KINDS},
    "push_offer": frozenset({"pending_choice"}),
}
SUCCESS_OUTCOMES = frozenset({
    "critical",
    "extreme",
    "hard",
    "regular",
    "success",
    "critical_success",
    "extreme_success",
    "hard_success",
    "regular_success",
})
_SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")


class SubsystemCommand(TypedDict):
    command_id: str
    kind: str
    phase: str
    payload: dict[str, Any]


class SubsystemResult(TypedDict):
    command_id: str
    kind: str
    status: str
    events: list[dict[str, Any]]
    pending_choice: dict[str, Any] | None
    state_refs: list[str]


def _load_sibling(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPT_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_fileio = _load_sibling("coc_fileio_subsystem_executor", "coc_fileio.py")
coc_roll = _load_sibling("coc_roll_subsystem_executor", "coc_roll.py")
coc_sanity = _load_sibling("coc_sanity_subsystem_executor", "coc_sanity.py")


class SubsystemExecutorError(ValueError):
    """Stable typed failure for command, state, and executor preflight errors."""

    def __init__(self, code: str, path: str, message: str) -> None:
        self.code = str(code)
        self.path = str(path)
        self.message = str(message)
        super().__init__(f"{self.code} at {self.path}: {self.message}")

    def to_dict(self) -> dict[str, str]:
        return {"code": self.code, "path": self.path, "message": self.message}


def _error(code: str, path: str, message: str) -> SubsystemExecutorError:
    return SubsystemExecutorError(code, path, message)


def _json_copy(value: Any) -> Any:
    return json.loads(json.dumps(value, ensure_ascii=False, allow_nan=False))


def _json_deep_equal(left: Any, right: Any) -> bool:
    """Compare JSON values without Python's bool/int equality aliasing."""
    try:
        options = {
            "ensure_ascii": False,
            "sort_keys": True,
            "separators": (",", ":"),
            "allow_nan": False,
        }
        return json.dumps(left, **options) == json.dumps(right, **options)
    except (TypeError, ValueError):
        return False


def _validate_json_value(value: Any, path: str) -> None:
    if value is None or isinstance(value, (str, bool, int)):
        return
    if isinstance(value, float):
        if not math.isfinite(value):
            raise _error("invalid_json_value", path, "numbers must be finite")
        return
    if isinstance(value, list):
        for index, item in enumerate(value):
            _validate_json_value(item, f"{path}[{index}]")
        return
    if isinstance(value, dict):
        for key, item in value.items():
            if not isinstance(key, str):
                raise _error("invalid_json_value", path, "object keys must be strings")
            _validate_json_value(item, f"{path}.{key}")
        return
    raise _error(
        "invalid_json_value",
        path,
        f"unsupported JSON value type: {type(value).__name__}",
    )


def _canonical_command_hash(command: dict[str, Any]) -> str:
    encoded = json.dumps(
        command,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _push_choice_id(command_id: str) -> str:
    """Return a stable safe push-choice ID for every valid command ID."""
    legacy = f"{command_id}:confirm"
    if _SAFE_ID.fullmatch(legacy):
        return legacy
    digest = hashlib.sha256(command_id.encode("utf-8")).hexdigest()
    return f"push:{digest}:confirm"


# Pending-kind behavior is registered per result kind so Task 6 can add a
# second lifecycle without weakening or duplicating the push contract.
PENDING_CHOICE_CONTRACTS: dict[str, dict[str, Any]] = {
    "push_offer": {
        "status": "pending_choice",
        "choice_kind": "push_confirm",
        "choice_id": _push_choice_id,
        "scope": "global",
    },
}


def _default_state() -> dict[str, Any]:
    return {
        "schema_version": STATE_SCHEMA_VERSION,
        "applied_command_ids": [],
        "command_hashes": {},
        "result_snapshots": {},
        "pending_choices": {},
        "inflight": None,
    }


def _unsafe_state_path(message: str) -> SubsystemExecutorError:
    return _error(
        "unsafe_subsystem_state_path",
        STATE_RELATIVE_PATH.as_posix(),
        message,
    )


def _state_path(campaign_dir: Path) -> Path:
    """Return the canonical executor state path after containment checks."""
    try:
        campaign = Path(campaign_dir).resolve()
    except (OSError, RuntimeError) as exc:
        raise _unsafe_state_path("campaign root could not be resolved safely") from exc
    save_dir = campaign / "save"
    if save_dir.is_symlink():
        raise _unsafe_state_path("save directory must not be a symlink")
    try:
        save_dir.resolve().relative_to(campaign)
    except (OSError, RuntimeError, ValueError) as exc:
        raise _unsafe_state_path("save directory escapes campaign root") from exc

    path = campaign / STATE_RELATIVE_PATH
    if path.is_symlink():
        raise _unsafe_state_path("executor state file must not be a symlink")
    try:
        path.resolve().relative_to(campaign)
    except (OSError, RuntimeError, ValueError) as exc:
        raise _unsafe_state_path("executor state file escapes campaign root") from exc
    return path


def _state_error(message: str) -> SubsystemExecutorError:
    return _error(
        "malformed_subsystem_state",
        STATE_RELATIVE_PATH.as_posix(),
        message,
    )


def _validate_pending_choice_contract(
    command_id: str,
    result_kind: str,
    status: str,
    pending: Any,
) -> None:
    contract = PENDING_CHOICE_CONTRACTS.get(result_kind)
    if contract is None:
        if pending is not None:
            raise _state_error(
                f"result snapshot {command_id!r} cannot carry a pending choice"
            )
        return
    if status != contract["status"] or not isinstance(pending, dict):
        raise _state_error(
            f"result snapshot {command_id!r} has an invalid pending status/choice"
        )
    expected_choice_id = contract["choice_id"](command_id)
    if pending.get("choice_id") != expected_choice_id:
        raise _state_error(
            f"result snapshot {command_id!r} has an invalid pending choice_id"
        )
    if pending.get("kind") != contract["choice_kind"]:
        raise _state_error(
            f"result snapshot {command_id!r} has an invalid pending choice kind"
        )
    if pending.get("command_id") != command_id:
        raise _state_error(
            f"result snapshot {command_id!r} has a mismatched pending command_id"
        )


def _pending_scope_key(
    result_kind: str,
    *,
    pending_choice: dict[str, Any] | None = None,
    command: dict[str, Any] | None = None,
) -> str:
    contract = PENDING_CHOICE_CONTRACTS[result_kind]
    resolver = contract.get("scope", "global")
    if callable(resolver):
        return str(
            resolver(
                result_kind=result_kind,
                pending_choice=pending_choice,
                command=command,
            )
        )
    return str(resolver)


def _validate_result_snapshot(command_id: str, result: Any) -> None:
    if not isinstance(result, dict) or set(result) != RESULT_KEYS:
        raise _state_error(f"result snapshot {command_id!r} has an invalid contract")
    if result.get("command_id") != command_id:
        raise _state_error(f"result snapshot {command_id!r} has a mismatched command_id")
    kind = result.get("kind")
    status = result.get("status")
    if not isinstance(kind, str) or not isinstance(status, str):
        raise _state_error(f"result snapshot {command_id!r} has invalid kind/status")
    if kind not in RESULT_STATUSES_BY_KIND or status not in RESULT_STATUSES_BY_KIND[kind]:
        raise _state_error(f"result snapshot {command_id!r} has unsupported kind/status")
    events = result.get("events")
    if not isinstance(events, list) or not all(isinstance(item, dict) for item in events):
        raise _state_error(f"result snapshot {command_id!r} has invalid events")
    pending = result.get("pending_choice")
    if pending is not None and not isinstance(pending, dict):
        raise _state_error(f"result snapshot {command_id!r} has invalid pending_choice")
    _validate_pending_choice_contract(command_id, kind, status, pending)
    refs = result.get("state_refs")
    if not isinstance(refs, list) or not all(isinstance(item, str) for item in refs):
        raise _state_error(f"result snapshot {command_id!r} has invalid state_refs")
    try:
        _validate_json_value(result, f"result_snapshots.{command_id}")
    except SubsystemExecutorError as exc:
        raise _state_error(str(exc)) from exc


def _allowed_preimage_path(path: str) -> bool:
    if path in {
        "save/sanity.json",
        "save/time-state.json",
        "save/time-triggers.json",
    }:
        return True
    prefix = "save/investigator-state/"
    suffix = ".json"
    if path.startswith(prefix) and path.endswith(suffix):
        investigator_id = path[len(prefix):-len(suffix)]
        return bool(_SAFE_ID.fullmatch(investigator_id))
    return False


def _validate_inflight(inflight: Any) -> None:
    if inflight is None:
        return
    if not isinstance(inflight, dict) or set(inflight) != {
        "commands", "preimages", "log_offsets",
    }:
        raise _state_error("inflight must contain commands, preimages, and log_offsets")
    commands = inflight.get("commands")
    if not isinstance(commands, list) or not commands:
        raise _state_error("inflight.commands must be a non-empty list")
    for entry in commands:
        if not isinstance(entry, dict) or set(entry) != {"command_id", "command_hash"}:
            raise _state_error("inflight command entries have an invalid contract")
        if not isinstance(entry["command_id"], str) or not _SAFE_ID.fullmatch(entry["command_id"]):
            raise _state_error("inflight command_id must be a stable safe ID")
        if not isinstance(entry["command_hash"], str) or not _SHA256.fullmatch(entry["command_hash"]):
            raise _state_error("inflight command_hash must be SHA-256 hex")

    preimages = inflight.get("preimages")
    if not isinstance(preimages, dict):
        raise _state_error("inflight.preimages must be an object")
    for relative, preimage in preimages.items():
        if not isinstance(relative, str) or not _allowed_preimage_path(relative):
            raise _state_error(f"unsafe inflight preimage path: {relative!r}")
        if not isinstance(preimage, dict) or set(preimage) != {"exists", "encoding", "data"}:
            raise _state_error(f"invalid preimage contract for {relative!r}")
        exists = preimage.get("exists")
        if not isinstance(exists, bool) or preimage.get("encoding") != "base64":
            raise _state_error(f"invalid preimage metadata for {relative!r}")
        data = preimage.get("data")
        if not exists:
            if data is not None:
                raise _state_error(f"absent preimage {relative!r} must have null data")
            continue
        if not isinstance(data, str):
            raise _state_error(f"present preimage {relative!r} must contain base64 data")
        try:
            decoded = base64.b64decode(data.encode("ascii"), validate=True)
            decoded.decode("utf-8")
        except (ValueError, UnicodeError) as exc:
            raise _state_error(f"invalid base64/UTF-8 preimage for {relative!r}") from exc

    offsets = inflight.get("log_offsets")
    if not isinstance(offsets, dict) or set(offsets) - {"logs/rolls.jsonl"}:
        raise _state_error("inflight.log_offsets contains an unsafe path")
    for relative, offset in offsets.items():
        if not isinstance(offset, dict) or set(offset) != {"exists", "size"}:
            raise _state_error(f"invalid log offset contract for {relative!r}")
        if not isinstance(offset.get("exists"), bool):
            raise _state_error(f"invalid log existence marker for {relative!r}")
        size = offset.get("size")
        if isinstance(size, bool) or not isinstance(size, int) or size < 0:
            raise _state_error(f"invalid log size for {relative!r}")


def _validate_state(state: Any) -> dict[str, Any]:
    expected_keys = set(_default_state())
    if not isinstance(state, dict) or set(state) != expected_keys:
        raise _state_error("state root must contain exactly the schema v1 fields")
    if state.get("schema_version") != STATE_SCHEMA_VERSION:
        raise _state_error(f"unsupported schema_version: {state.get('schema_version')!r}")

    applied = state.get("applied_command_ids")
    if (
        not isinstance(applied, list)
        or not all(isinstance(item, str) and _SAFE_ID.fullmatch(item) for item in applied)
        or len(applied) != len(set(applied))
    ):
        raise _state_error("applied_command_ids must be unique stable IDs")

    hashes = state.get("command_hashes")
    snapshots = state.get("result_snapshots")
    pending = state.get("pending_choices")
    if not isinstance(hashes, dict) or not isinstance(snapshots, dict) or not isinstance(pending, dict):
        raise _state_error("hash, snapshot, and pending-choice indexes must be objects")
    applied_ids = set(applied)
    if set(hashes) != applied_ids or set(snapshots) != applied_ids:
        raise _state_error("applied IDs, command hashes, and result snapshots must match")
    if not all(isinstance(value, str) and _SHA256.fullmatch(value) for value in hashes.values()):
        raise _state_error("command_hashes must contain SHA-256 hex digests")
    for command_id, result in snapshots.items():
        _validate_result_snapshot(command_id, result)
    pending_scopes: dict[str, str] = {}
    for choice_id, choice in pending.items():
        if not isinstance(choice_id, str) or not _SAFE_ID.fullmatch(choice_id):
            raise _state_error("pending choice keys must be stable IDs")
        if not isinstance(choice, dict) or choice.get("choice_id") != choice_id:
            raise _state_error(f"pending choice {choice_id!r} has an invalid contract")
        if not isinstance(choice.get("kind"), str) or not isinstance(choice.get("command_id"), str):
            raise _state_error(f"pending choice {choice_id!r} is missing stable identifiers")
        command_id = choice["command_id"]
        if command_id not in applied_ids:
            raise _state_error(
                f"pending choice {choice_id!r} references an unapplied command"
            )
        snapshot = snapshots[command_id]
        if not _json_deep_equal(snapshot.get("pending_choice"), choice):
            raise _state_error(
                f"pending choice {choice_id!r} does not match its result snapshot"
            )
        _validate_pending_choice_contract(
            command_id,
            snapshot["kind"],
            snapshot["status"],
            choice,
        )
        scope = _pending_scope_key(snapshot["kind"], pending_choice=choice)
        if scope in pending_scopes:
            raise _state_error(
                f"pending choices {pending_scopes[scope]!r} and {choice_id!r} "
                f"share blocking scope {scope!r}"
            )
        pending_scopes[scope] = choice_id
        try:
            _validate_json_value(choice, f"pending_choices.{choice_id}")
        except SubsystemExecutorError as exc:
            raise _state_error(str(exc)) from exc
    _validate_inflight(state.get("inflight"))
    return state


def _load_state(campaign_dir: Path) -> dict[str, Any]:
    path = _state_path(campaign_dir)
    if not path.exists():
        return _default_state()
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise _state_error(f"could not read valid JSON: {exc}") from exc
    return _validate_state(raw)


def _contained_target(campaign_dir: Path, relative: str) -> Path:
    campaign = Path(campaign_dir).resolve()
    target = (campaign / relative).resolve()
    try:
        target.relative_to(campaign)
    except ValueError as exc:
        raise _state_error(f"inflight path escapes campaign root: {relative!r}") from exc
    return target


def _capture_preimage(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"exists": False, "encoding": "base64", "data": None}
    if not path.is_file():
        raise _error(
            "subsystem_transaction_preflight_failed",
            str(path),
            "mutable transaction target must be a file",
        )
    try:
        raw = path.read_bytes()
        raw.decode("utf-8")
    except (OSError, UnicodeError) as exc:
        raise _error(
            "subsystem_transaction_preflight_failed",
            str(path),
            f"could not capture UTF-8 preimage: {exc}",
        ) from exc
    return {
        "exists": True,
        "encoding": "base64",
        "data": base64.b64encode(raw).decode("ascii"),
    }


def _build_inflight(
    campaign_dir: Path,
    investigator_id: str,
    commands_with_hashes: list[tuple[dict[str, Any], str]],
) -> dict[str, Any]:
    structured_sanity = any(
        command["kind"] == "sanity_check"
        and "san_loss_fail_expr" in command["payload"]
        for command, _command_hash in commands_with_hashes
    )
    preimage_relatives: list[str] = []
    if structured_sanity:
        preimage_relatives = [
            "save/sanity.json",
            f"save/investigator-state/{investigator_id}.json",
            "save/time-state.json",
            "save/time-triggers.json",
        ]
    has_roll_evidence = any(
        command["kind"] in ROLL_COMMAND_KINDS
        for command, _command_hash in commands_with_hashes
    )
    log_offsets: dict[str, dict[str, Any]] = {}
    if has_roll_evidence:
        relative = "logs/rolls.jsonl"
        path = _contained_target(campaign_dir, relative)
        if path.exists() and not path.is_file():
            raise _error(
                "subsystem_transaction_preflight_failed",
                relative,
                "roll evidence target must be a file",
            )
        try:
            size = path.stat().st_size if path.exists() else 0
        except OSError as exc:
            raise _error(
                "subsystem_transaction_preflight_failed",
                relative,
                str(exc),
            ) from exc
        log_offsets[relative] = {"exists": path.exists(), "size": int(size)}
    inflight = {
        "commands": [
            {
                "command_id": command["command_id"],
                "command_hash": command_hash,
            }
            for command, command_hash in commands_with_hashes
        ],
        "preimages": {
            relative: _capture_preimage(_contained_target(campaign_dir, relative))
            for relative in preimage_relatives
        },
        "log_offsets": log_offsets,
    }
    _validate_inflight(inflight)
    return inflight


def _restore_inflight_targets(campaign_dir: Path, inflight: dict[str, Any]) -> None:
    _validate_inflight(inflight)
    for relative, preimage in inflight["preimages"].items():
        target = _contained_target(campaign_dir, relative)
        if preimage["exists"]:
            raw = base64.b64decode(preimage["data"].encode("ascii"), validate=True)
            coc_fileio.write_text_atomic(target, raw.decode("utf-8"), encoding="utf-8")
        elif target.exists():
            if not target.is_file():
                raise _state_error(f"cannot remove non-file recovery target {relative!r}")
            target.unlink()

    for relative, offset in inflight["log_offsets"].items():
        target = _contained_target(campaign_dir, relative)
        if not offset["exists"]:
            if target.exists():
                if not target.is_file():
                    raise _state_error(f"cannot remove non-file log target {relative!r}")
                target.unlink()
            continue
        if not target.is_file():
            raise _state_error(f"missing log required for inflight recovery: {relative!r}")
        current_size = target.stat().st_size
        expected_size = int(offset["size"])
        if current_size < expected_size:
            raise _state_error(
                f"log {relative!r} is shorter than its pre-append offset"
            )
        with target.open("r+b") as handle:
            handle.truncate(expected_size)
            handle.flush()
            os.fsync(handle.fileno())


def _write_executor_state(campaign_dir: Path, state: dict[str, Any]) -> None:
    _validate_state(state)
    coc_fileio.write_json_atomic(
        _state_path(campaign_dir),
        state,
        indent=2,
        ensure_ascii=False,
        trailing_newline=True,
    )


def _recover_inflight(campaign_dir: Path, state: dict[str, Any]) -> dict[str, Any]:
    inflight = state.get("inflight")
    if not isinstance(inflight, dict):
        return state
    try:
        _restore_inflight_targets(campaign_dir, inflight)
        recovered = _json_copy(state)
        recovered["inflight"] = None
        _write_executor_state(campaign_dir, recovered)
        return recovered
    except Exception as exc:
        if isinstance(exc, SubsystemExecutorError):
            raise
        raise _error(
            "subsystem_inflight_recovery_failed",
            STATE_RELATIVE_PATH.as_posix(),
            str(exc),
        ) from exc


def _rollback_transaction(
    campaign_dir: Path,
    base_state: dict[str, Any],
    inflight: dict[str, Any],
) -> None:
    _restore_inflight_targets(campaign_dir, inflight)
    restored = _json_copy(base_state)
    restored["inflight"] = None
    _write_executor_state(campaign_dir, restored)


def _validate_command(command: Any, index: int) -> dict[str, Any]:
    base = f"commands[{index}]"
    if not isinstance(command, dict) or set(command) != COMMAND_KEYS:
        raise _error(
            "invalid_command_contract",
            base,
            "command must contain exactly command_id, kind, phase, and payload",
        )
    command_id = command.get("command_id")
    if not isinstance(command_id, str) or not _SAFE_ID.fullmatch(command_id):
        raise _error("invalid_command_id", f"{base}.command_id", "expected a stable safe ID")
    kind = command.get("kind")
    if kind not in SUPPORTED_COMMAND_KINDS:
        raise _error(
            "unsupported_command_kind",
            f"{base}.kind",
            f"unsupported kind: {kind!r}",
        )
    phase = command.get("phase")
    if phase != EXPECTED_PHASE[kind]:
        raise _error(
            "invalid_command_phase",
            f"{base}.phase",
            f"{kind} requires phase {EXPECTED_PHASE[kind]!r}",
        )
    payload = command.get("payload")
    if not isinstance(payload, dict):
        raise _error("invalid_command_payload", f"{base}.payload", "payload must be an object")
    _validate_json_value(payload, f"{base}.payload")
    return _json_copy(command)


def _validate_payload_fields(command: dict[str, Any], index: int) -> None:
    payload = command["payload"]
    base = f"commands[{index}].payload"
    difficulty = payload.get("difficulty", "regular")
    if difficulty not in {"regular", "hard", "extreme"}:
        raise _error(
            "invalid_command_payload",
            f"{base}.difficulty",
            "difficulty must be regular, hard, or extreme",
        )
    if "bonus_penalty_dice" in payload:
        modifier = payload["bonus_penalty_dice"]
        if isinstance(modifier, bool) or not isinstance(modifier, int):
            raise _error(
                "invalid_command_payload",
                f"{base}.bonus_penalty_dice",
                "bonus_penalty_dice must be an integer",
            )
    if command["kind"] == "sanity_check" and "san_loss_fail_expr" in payload:
        expression = payload.get("san_loss_fail_expr")
        if not isinstance(expression, str):
            raise _error(
                "invalid_command_payload",
                f"{base}.san_loss_fail_expr",
                "san_loss_fail_expr must be a string",
            )
        try:
            coc_sanity.validate_san_loss_expression(expression)
        except ValueError as exc:
            raise _error(
                "invalid_command_payload",
                f"{base}.san_loss_fail_expr",
                str(exc),
            ) from exc
    if command["kind"] == "sanity_check" and "san_loss_success" in payload:
        loss = payload.get("san_loss_success", 0)
        if (
            isinstance(loss, bool)
            or not isinstance(loss, int)
            or loss < 0
            or loss > coc_sanity.SAN_LOSS_MAX_TOTAL
        ):
            raise _error(
                "invalid_command_payload",
                f"{base}.san_loss_success",
                "san_loss_success must be a bounded non-negative integer",
            )


def _validate_batch(commands: Any) -> list[dict[str, Any]]:
    if not isinstance(commands, list):
        raise _error("invalid_command_batch", "commands", "commands must be a JSON array")
    validated: list[dict[str, Any]] = []
    seen: set[str] = set()
    for index, raw in enumerate(commands):
        command = _validate_command(raw, index)
        command_id = command["command_id"]
        if command_id in seen:
            raise _error(
                "duplicate_command_id",
                f"commands[{index}].command_id",
                f"duplicate command_id {command_id!r} in one batch",
            )
        seen.add(command_id)
        _validate_payload_fields(command, index)
        validated.append(command)
    return validated


def _load_character(character_path: Path) -> dict[str, Any]:
    try:
        character = json.loads(Path(character_path).read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise _error("malformed_character", "character_path", str(exc)) from exc
    if not isinstance(character, dict):
        raise _error("malformed_character", "character_path", "character root must be an object")
    for field in ("skills", "characteristics", "derived"):
        value = character.get(field, {})
        if value is not None and not isinstance(value, dict):
            raise _error("malformed_character", f"character_path.{field}", "must be an object")
    return character


def _preflight_rule_targets(
    commands: list[dict[str, Any]],
    state: dict[str, Any],
    character: dict[str, Any] | None,
) -> None:
    if character is None:
        return
    applied = set(state["applied_command_ids"])
    for index, command in enumerate(commands):
        if command["command_id"] in applied or command["kind"] not in ROLL_COMMAND_KINDS:
            continue
        try:
            _target_for_payload(character, command["kind"], command["payload"])
        except (TypeError, ValueError) as exc:
            raise _error(
                "invalid_command_payload",
                f"commands[{index}].payload",
                f"roll target is not an integer: {exc}",
            ) from exc


def _preflight_sanity_state(
    campaign_dir: Path,
    commands: list[dict[str, Any]],
    applied: set[str],
    character: dict[str, Any] | None,
    investigator_id: str,
) -> None:
    needs_sanity = any(
        command["command_id"] not in applied
        and command["kind"] == "sanity_check"
        and "san_loss_fail_expr" in command["payload"]
        for command in commands
    )
    if not needs_sanity:
        return
    assert character is not None
    sanity_path = Path(campaign_dir) / "save" / "sanity.json"
    try:
        characteristics = (
            character.get("characteristics")
            if isinstance(character.get("characteristics"), dict)
            else {}
        )
        skills = character.get("skills") if isinstance(character.get("skills"), dict) else {}
        coc_sanity.SanitySession.load(
            Path(campaign_dir),
            investigator_id,
            int_value=int(characteristics.get("INT", 50)),
            rng=random.Random(0),
            cm_value=int(skills.get("Cthulhu Mythos", 0)),
        )
    except Exception as exc:
        raise _error("malformed_sanity_state", "save/sanity.json", str(exc)) from exc

    investigator_relative = f"save/investigator-state/{investigator_id}.json"
    investigator_path = Path(campaign_dir) / investigator_relative
    if not investigator_path.exists():
        return
    try:
        investigator = json.loads(investigator_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise _error("malformed_investigator_state", investigator_relative, str(exc)) from exc
    if not isinstance(investigator, dict):
        raise _error(
            "malformed_investigator_state",
            investigator_relative,
            "root must be an object",
        )
    current_san = investigator.get("current_san")
    if current_san is not None and (isinstance(current_san, bool) or not isinstance(current_san, int)):
        raise _error(
            "malformed_investigator_state",
            f"{investigator_relative}.current_san",
            "current_san must be an integer",
        )


def commands_from_rules_requests(plan: dict[str, Any]) -> list[dict[str, Any]]:
    """Adapt supported legacy Director ``rules_requests`` into strict commands."""
    requests = plan.get("rules_requests") or []
    if not isinstance(requests, list):
        raise _error("invalid_legacy_rules_requests", "plan.rules_requests", "must be a list")
    decision_id = str(plan.get("decision_id") or "turn")
    commands: list[dict[str, Any]] = []
    for index, request in enumerate(requests, start=1):
        if not isinstance(request, dict):
            continue
        kind = request.get("kind")
        if kind not in SUPPORTED_COMMAND_KINDS:
            # Preserve the legacy wrapper's behavior for non-rules annotations
            # such as npc_assist; strict direct executor calls still reject them.
            continue
        command_id = f"{decision_id}-rule-{index}"
        payload = {key: _json_copy(value) for key, value in request.items() if key != "kind"}
        payload.setdefault("decision_id", plan.get("decision_id"))
        payload.setdefault("roll_id", command_id)
        payload.setdefault("request_index", index)
        commands.append({
            "command_id": command_id,
            "kind": kind,
            "phase": EXPECTED_PHASE[kind],
            "payload": payload,
        })
    return commands


def flatten_result_events(results: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """Return legacy flat rule rows from normalized subsystem results."""
    events: list[dict[str, Any]] = []
    for result in results or []:
        if not isinstance(result, dict):
            continue
        for event in result.get("events") or []:
            if isinstance(event, dict):
                events.append(_json_copy(event))
    return events


def _looks_like_result_envelope(row: Any) -> bool:
    if not isinstance(row, dict):
        return False
    keys = set(row)
    envelope_only = {"status", "events", "pending_choice", "state_refs"}
    if keys & {"events", "pending_choice", "state_refs"}:
        return True
    if "command_id" in keys and "status" in keys:
        return True
    return len(keys & RESULT_KEYS) >= 3 and bool(keys & envelope_only)


def normalize_rule_results(
    results: list[dict[str, Any]] | None,
    *,
    campaign_dir: Path | str | None = None,
) -> list[dict[str, Any]]:
    """Return legacy rows, unwrapping only persisted executor envelopes."""
    rows = list(results or [])
    exact_envelopes = [
        isinstance(row, dict) and set(row) == RESULT_KEYS
        for row in rows
    ]
    if rows and all(exact_envelopes):
        if campaign_dir is None:
            raise _error(
                "untrusted_subsystem_result",
                "rules_results",
                "campaign_dir is required to verify normalized results",
            )
        campaign = Path(campaign_dir)
        state = _recover_inflight(campaign, _load_state(campaign))
        seen_command_ids: set[str] = set()
        for index, row in enumerate(rows):
            assert isinstance(row, dict)
            command_id = row.get("command_id")
            if not isinstance(command_id, str) or command_id in seen_command_ids:
                raise _error(
                    "untrusted_subsystem_result",
                    f"rules_results[{index}]",
                    "normalized results must contain unique persisted command IDs",
                )
            seen_command_ids.add(command_id)
            snapshot = state["result_snapshots"].get(command_id)
            if not _json_deep_equal(snapshot, row):
                raise _error(
                    "untrusted_subsystem_result",
                    f"rules_results[{index}]",
                    "normalized result does not match a persisted executor snapshot",
                )
        return flatten_result_events(rows)
    for index, row in enumerate(rows):
        if _looks_like_result_envelope(row):
            raise _error(
                "untrusted_subsystem_result",
                f"rules_results[{index}]",
                "partial or mixed subsystem result envelopes are not trusted",
            )
    # Legacy apply_plan callers observe in-place push-gate demotion. Preserve
    # their row identity; only persisted normalized snapshots are unwrapped as
    # defensive copies above.
    return [row for row in rows if isinstance(row, dict)]


def current_pending_choice(results: list[dict[str, Any]] | None) -> dict[str, Any] | None:
    for result in reversed(results or []):
        if isinstance(result, dict) and isinstance(result.get("pending_choice"), dict):
            return _json_copy(result["pending_choice"])
    return None


def get_current_pending_choices(
    campaign_dir: Path | str,
) -> list[dict[str, Any]]:
    """Read unresolved choices from the validated canonical executor state."""
    campaign = Path(campaign_dir)
    state = _recover_inflight(campaign, _load_state(campaign))
    return [_json_copy(choice) for choice in state["pending_choices"].values()]


def get_current_pending_choice(
    campaign_dir: Path | str,
) -> dict[str, Any] | None:
    """Return the sole canonical unresolved choice, if one exists."""
    choices = get_current_pending_choices(campaign_dir)
    if not choices:
        return None
    if len(choices) > 1:
        raise _error(
            "ambiguous_pending_choice",
            "save/subsystem-state.json#pending_choices",
            "multiple unresolved subsystem choices require an explicit selector",
        )
    return choices[0]


def _target_for_payload(character: dict[str, Any], kind: str, payload: dict[str, Any]) -> int:
    skill = str(payload.get("skill", ""))
    skills = character.get("skills") if isinstance(character.get("skills"), dict) else {}
    characteristics = (
        character.get("characteristics")
        if isinstance(character.get("characteristics"), dict)
        else {}
    )
    if skill in skills:
        return int(skills[skill])
    if skill in characteristics:
        return int(characteristics[skill])
    if kind == "sanity_check":
        derived = character.get("derived") if isinstance(character.get("derived"), dict) else {}
        return int(derived.get("SAN", characteristics.get("POW", 50)))
    return 50


def _settle_sanity_check(
    campaign_dir: Path,
    character: dict[str, Any],
    investigator_id: str,
    payload: dict[str, Any],
    rng: random.Random,
) -> dict[str, Any]:
    characteristics = (
        character.get("characteristics")
        if isinstance(character.get("characteristics"), dict)
        else {}
    )
    int_value = int(characteristics.get("INT", 50))
    derived = character.get("derived") if isinstance(character.get("derived"), dict) else {}
    skills = character.get("skills") if isinstance(character.get("skills"), dict) else {}
    cm_value = int(skills.get("Cthulhu Mythos", 0))
    sanity_path = Path(campaign_dir) / "save" / "sanity.json"
    session = coc_sanity.SanitySession.load(
        Path(campaign_dir),
        investigator_id,
        int_value=int_value,
        rng=rng,
        cm_value=cm_value,
    )
    if not sanity_path.exists():
        sheet_san = int(derived.get("SAN", characteristics.get("POW", 50)))
        session.san_max = sheet_san
        session.san_current = sheet_san
        session.day_start_san = sheet_san

    source = str(payload.get("source") or payload.get("reason") or "encountering the unnatural")
    creature_type = payload.get("creature_type")
    event = session.sanity_check(
        source=source,
        san_loss_success=int(payload.get("san_loss_success", 0)),
        san_loss_fail_expr=str(payload.get("san_loss_fail_expr", "1")),
        creature_type=creature_type if isinstance(creature_type, str) else None,
    )
    event_payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
    san_roll = next(
        (
            row
            for row in reversed(session.pending_rolls)
            if isinstance(row, dict) and row.get("skill") == "SAN"
        ),
        {},
    )
    session.save(Path(campaign_dir), strict_mirror=True)
    san_before = int(event_payload.get("san_before", san_roll.get("san_before", session.san_current)))
    san_loss = int(event_payload.get("san_loss", san_roll.get("san_loss", 0)))
    san_after = int(event_payload.get("san_after", session.san_current))
    outcome = str(event_payload.get("roll_outcome") or san_roll.get("outcome") or "regular")
    return {
        "san_before": san_before,
        "san_loss": san_loss,
        "san_after": san_after,
        "outcome": outcome,
        "roll": san_roll.get("roll", 0),
        "bout_triggered": bool(session.bout_active or session.temporary_insane),
        "source": source,
        "san_trigger_id": payload.get("san_trigger_id"),
    }


def _roll_result(
    campaign_dir: Path,
    character: dict[str, Any],
    investigator_id: str,
    command: dict[str, Any],
    rng: random.Random,
) -> dict[str, Any]:
    kind = command["kind"]
    payload = command["payload"]
    target = _target_for_payload(character, kind, payload)
    difficulty = str(payload.get("difficulty", "regular"))
    bonus_penalty = int(payload.get("bonus_penalty_dice", 0) or 0)
    bonus = max(0, bonus_penalty)
    penalty = max(0, -bonus_penalty)
    decision_id = payload.get("decision_id")
    roll_id = str(payload.get("roll_id") or command["command_id"])

    if kind == "sanity_check" and "san_loss_fail_expr" in payload:
        settled = _settle_sanity_check(
            campaign_dir,
            character,
            investigator_id,
            payload,
            rng,
        )
        return {
            "roll_id": roll_id,
            "decision_id": decision_id,
            "kind": "sanity_check",
            "skill": "SAN",
            "target": settled["san_before"],
            "difficulty": "regular",
            "reason": payload.get("reason"),
            "bonus_penalty_dice": 0,
            "roll": settled["roll"],
            "effective_target": settled["san_before"],
            "outcome": settled["outcome"],
            "success": settled["outcome"] in SUCCESS_OUTCOMES,
            "san_loss": settled["san_loss"],
            "san_before": settled["san_before"],
            "san_after": settled["san_after"],
            "bout_triggered": settled["bout_triggered"],
            "source": settled["source"],
            "san_trigger_id": settled["san_trigger_id"],
            "roll_contract": payload.get("roll_contract"),
        }

    if kind == "idea_roll":
        characteristics = (
            character.get("characteristics")
            if isinstance(character.get("characteristics"), dict)
            else {}
        )
        int_value = int(characteristics.get("INT", target if target else 50))
        roll = coc_roll.idea_roll(
            int_value,
            difficulty=difficulty,
            bonus=bonus,
            penalty=penalty,
            rng=rng,
        )
        return {
            "roll_id": roll_id,
            "decision_id": decision_id,
            "kind": "idea_roll",
            "skill": "INT",
            "target": roll.get("target", int_value),
            "difficulty": difficulty,
            "reason": payload.get("reason"),
            "request_id": payload.get("request_id"),
            "signpost_level": payload.get("signpost_level"),
            "missed_clue_id": payload.get("missed_clue_id"),
            "bonus_penalty_dice": bonus_penalty,
            "roll": roll.get("roll"),
            "effective_target": roll.get("effective_target"),
            "outcome": roll.get("outcome"),
            "success": roll.get("outcome") in SUCCESS_OUTCOMES,
            "roll_contract": payload.get("roll_contract"),
            "roll_kind": "idea",
            "characteristic": "INT",
        }

    roll = coc_roll.percentile_check(
        target,
        difficulty=difficulty,
        bonus=bonus,
        penalty=penalty,
        rng=rng,
    )
    return {
        "roll_id": roll_id,
        "decision_id": decision_id,
        "kind": kind,
        "skill": payload.get("skill"),
        "target": target,
        "difficulty": difficulty,
        "reason": payload.get("reason"),
        "request_id": payload.get("request_id"),
        "depends_on": payload.get("depends_on"),
        "stakes": payload.get("stakes"),
        "opposed_by": payload.get("opposed_by"),
        "opposed_skill": payload.get("opposed_skill"),
        "bonus_penalty_dice": bonus_penalty,
        "roll": roll.get("roll"),
        "effective_target": roll.get("effective_target"),
        "outcome": roll.get("outcome"),
        "success": roll.get("outcome") in SUCCESS_OUTCOMES,
        "roll_contract": payload.get("roll_contract"),
    }


def _dispatch(
    campaign_dir: Path,
    character: dict[str, Any] | None,
    investigator_id: str,
    command: dict[str, Any],
    rng: random.Random,
) -> dict[str, Any]:
    command_id = command["command_id"]
    kind = command["kind"]
    if kind == "push_offer":
        choice_id = _push_choice_id(command_id)
        choice = {
            "choice_id": choice_id,
            "kind": "push_confirm",
            "command_id": command_id,
        }
        return {
            "command_id": command_id,
            "kind": kind,
            "status": "pending_choice",
            "events": [],
            "pending_choice": choice,
            "state_refs": [
                f"save/subsystem-state.json#pending_choices/{choice_id}"
            ],
        }
    assert character is not None
    event = _roll_result(campaign_dir, character, investigator_id, command, rng)
    refs = [f"logs/rolls.jsonl#{command_id}"]
    if kind == "sanity_check" and "san_loss_fail_expr" in command["payload"]:
        refs.extend([
            f"save/sanity.json#{investigator_id}",
            f"save/investigator-state/{investigator_id}.json#current_san",
        ])
    return {
        "command_id": command_id,
        "kind": kind,
        "status": "completed",
        "events": [event],
        "pending_choice": None,
        "state_refs": refs,
    }


def _append_roll_event(
    campaign_dir: Path,
    investigator_id: str,
    command_id: str,
    event: dict[str, Any],
    append_jsonl: Callable[[Path, dict[str, Any]], None] | None,
) -> None:
    # Transactional evidence must reach the canonical log before the final
    # applied-command ledger.  The legacy async callback is intentionally not
    # used here: an in-memory recorder queue cannot be recovered after a crash.
    _ = append_jsonl
    record = {
        "type": "roll",
        "actor": investigator_id,
        "command_id": command_id,
        "payload": event,
        "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    path = Path(campaign_dir) / "logs" / "rolls.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False) + "\n")
        handle.flush()
        os.fsync(handle.fileno())


def _preflight_new_pending_capacity(
    commands_with_hashes: list[tuple[dict[str, Any], str]],
) -> None:
    scopes: dict[str, str] = {}
    for command, _command_hash in commands_with_hashes:
        kind = command["kind"]
        if kind not in PENDING_CHOICE_CONTRACTS:
            continue
        scope = _pending_scope_key(kind, command=command)
        previous = scopes.get(scope)
        if previous is not None:
            raise _error(
                "multiple_pending_choices",
                "commands",
                f"commands {previous!r} and {command['command_id']!r} "
                f"would create blocking choices in scope {scope!r}",
            )
        scopes[scope] = command["command_id"]


def execute_commands(
    campaign_dir: Path | str,
    character_path: Path | str,
    investigator_id: str,
    commands: list[dict[str, Any]],
    *,
    rng: random.Random,
    append_jsonl: Callable[[Path, dict[str, Any]], None] | None = None,
) -> list[dict[str, Any]]:
    """Validate, execute, persist, and replay a strict subsystem command batch."""
    campaign = Path(campaign_dir)
    state = _recover_inflight(campaign, _load_state(campaign))
    if not isinstance(investigator_id, str) or not _SAFE_ID.fullmatch(investigator_id):
        raise _error(
            "invalid_investigator_id",
            "investigator_id",
            "expected a stable safe ID",
        )
    character_file = Path(character_path)
    validated = _validate_batch(commands)
    hashes = [_canonical_command_hash(command) for command in validated]
    applied = set(state["applied_command_ids"])

    # Conflict checking is part of whole-batch preflight.  No character read,
    # random draw, handler call, log append, or state write occurs before this.
    for index, (command, command_hash) in enumerate(zip(validated, hashes)):
        command_id = command["command_id"]
        if command_id not in applied:
            continue
        if state["command_hashes"][command_id] != command_hash:
            raise _error(
                "command_conflict",
                f"commands[{index}].command_id",
                f"command_id {command_id!r} was already applied with different content",
            )
        snapshot = state["result_snapshots"][command_id]
        if (
            snapshot.get("kind") != command["kind"]
            or snapshot.get("status") not in RESULT_STATUSES_BY_KIND[command["kind"]]
        ):
            raise _error(
                "replay_snapshot_mismatch",
                f"commands[{index}]",
                "persisted result kind/status does not match the submitted command",
            )

    new_commands_with_hashes = [
        (command, command_hash)
        for command, command_hash in zip(validated, hashes)
        if command["command_id"] not in applied
    ]
    if state["pending_choices"] and new_commands_with_hashes:
        raise _error(
            "blocked_by_pending_choice",
            "commands",
            "resolve the current subsystem choice before submitting new commands",
        )
    _preflight_new_pending_capacity(new_commands_with_hashes)

    if not validated:
        return []
    if not new_commands_with_hashes:
        return [
            _json_copy(state["result_snapshots"][command["command_id"]])
            for command in validated
        ]

    needs_character = any(
        command["kind"] in ROLL_COMMAND_KINDS
        for command, _command_hash in new_commands_with_hashes
    )
    character = _load_character(character_file) if needs_character else None
    _preflight_rule_targets(validated, state, character)
    _preflight_sanity_state(
        campaign,
        validated,
        applied,
        character,
        investigator_id,
    )

    try:
        rng_state = rng.getstate()
        if not callable(getattr(rng, "setstate", None)):
            raise TypeError("rng must provide setstate")
    except Exception as exc:
        raise _error("invalid_rng", "rng", "expected a random.Random-compatible object") from exc

    inflight = _build_inflight(
        campaign,
        investigator_id,
        new_commands_with_hashes,
    )
    transaction_state = _json_copy(state)
    transaction_state["inflight"] = inflight
    try:
        _write_executor_state(campaign, transaction_state)
    except Exception as exc:
        raise _error(
            "subsystem_transaction_failed",
            STATE_RELATIVE_PATH.as_posix(),
            f"could not persist inflight preimages: {exc}",
        ) from exc

    next_state = _json_copy(state)
    next_state["inflight"] = None
    results: list[dict[str, Any]] = []
    new_results: list[tuple[dict[str, Any], dict[str, Any]]] = []
    try:
        for command, command_hash in zip(validated, hashes):
            command_id = command["command_id"]
            if command_id in applied:
                results.append(_json_copy(state["result_snapshots"][command_id]))
                continue
            result = _dispatch(campaign, character, investigator_id, command, rng)
            results.append(result)
            new_results.append((command, result))
            next_state["applied_command_ids"].append(command_id)
            next_state["command_hashes"][command_id] = command_hash
            next_state["result_snapshots"][command_id] = _json_copy(result)
            pending_choice = result.get("pending_choice")
            if isinstance(pending_choice, dict):
                next_state["pending_choices"][pending_choice["choice_id"]] = _json_copy(
                    pending_choice
                )

        for command, result in new_results:
            for event in result["events"]:
                _append_roll_event(
                    campaign,
                    investigator_id,
                    command["command_id"],
                    event,
                    append_jsonl,
                )
        _write_executor_state(campaign, next_state)
    except Exception as exc:
        rollback_error: Exception | None = None
        try:
            rng.setstate(rng_state)
            _rollback_transaction(campaign, state, inflight)
        except Exception as rollback_exc:
            rollback_error = rollback_exc
        if rollback_error is not None:
            raise _error(
                "subsystem_rollback_failed",
                STATE_RELATIVE_PATH.as_posix(),
                f"transaction error={exc}; rollback error={rollback_error}",
            ) from rollback_error
        raise _error(
            "subsystem_transaction_failed",
            "commands",
            str(exc),
        ) from exc
    return _json_copy(results)


__all__ = [
    "SubsystemCommand",
    "SubsystemExecutorError",
    "SubsystemResult",
    "commands_from_rules_requests",
    "current_pending_choice",
    "execute_commands",
    "flatten_result_events",
    "get_current_pending_choice",
    "get_current_pending_choices",
    "normalize_rule_results",
]
