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
import stat
import time
from pathlib import Path
from typing import Any, Callable, TypedDict


SCRIPT_DIR = Path(__file__).resolve().parent
STATE_SCHEMA_VERSION = 2
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
        "command_provenance": {},
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


class _ExecutorStateDirectory:
    """Descriptor-anchored access to the executor-owned state file.

    POSIX directory descriptors keep reads, temporary creation, and replace
    bound to the directory that was actually opened. Inode verification makes
    namespace swaps fail closed instead of following a newly inserted symlink.
    """

    _STATE_FILENAME = "subsystem-state.json"

    def __init__(self, campaign_dir: Path) -> None:
        directory_flag = getattr(os, "O_DIRECTORY", None)
        nofollow_flag = getattr(os, "O_NOFOLLOW", None)
        if directory_flag is None or nofollow_flag is None:
            raise _unsafe_state_path(
                "runtime lacks required O_DIRECTORY/O_NOFOLLOW primitives"
            )
        required_dir_fd = (os.open, os.mkdir, os.stat, os.unlink)
        if (
            any(function not in os.supports_dir_fd for function in required_dir_fd)
            or os.stat not in os.supports_follow_symlinks
        ):
            raise _unsafe_state_path(
                "runtime lacks required dir_fd/follow_symlinks primitives"
            )
        try:
            self.campaign_path = Path(campaign_dir).resolve()
            flags = os.O_RDONLY | directory_flag | nofollow_flag | getattr(os, "O_CLOEXEC", 0)
            self.campaign_fd = os.open(self.campaign_path, flags)
        except (OSError, RuntimeError) as exc:
            raise _unsafe_state_path("campaign root could not be opened safely") from exc
        self._directory_flags = flags
        self.save_fd: int | None = None
        self._save_identity: tuple[int, int] | None = None
        try:
            self._verify_campaign_identity()
            self._open_existing_save()
        except Exception:
            self.close()
            raise

    def __enter__(self) -> "_ExecutorStateDirectory":
        return self

    def __exit__(self, _exc_type, _exc, _tb) -> None:
        self.close()

    @staticmethod
    def _identity(info: os.stat_result) -> tuple[int, int]:
        return int(info.st_dev), int(info.st_ino)

    def _verify_campaign_identity(self) -> None:
        try:
            opened = os.fstat(self.campaign_fd)
            named = os.stat(self.campaign_path, follow_symlinks=False)
        except OSError as exc:
            raise _unsafe_state_path("campaign root identity could not be verified") from exc
        if (
            not stat.S_ISDIR(opened.st_mode)
            or not stat.S_ISDIR(named.st_mode)
            or self._identity(opened) != self._identity(named)
        ):
            raise _unsafe_state_path("campaign root identity changed")

    def _open_existing_save(self) -> None:
        try:
            self.save_fd = os.open(
                "save",
                self._directory_flags,
                dir_fd=self.campaign_fd,
            )
        except FileNotFoundError:
            self.save_fd = None
            self._save_identity = None
            return
        except (OSError, TypeError) as exc:
            raise _unsafe_state_path("save directory could not be opened without following links") from exc
        opened = os.fstat(self.save_fd)
        self._save_identity = self._identity(opened)
        self.verify_parent()

    def ensure_save(self) -> int:
        if self.save_fd is not None:
            self.verify_parent()
            return self.save_fd
        try:
            os.mkdir("save", mode=0o755, dir_fd=self.campaign_fd)
        except FileExistsError:
            pass
        except (OSError, TypeError) as exc:
            raise _unsafe_state_path("save directory could not be created safely") from exc
        self._open_existing_save()
        if self.save_fd is None:
            raise _unsafe_state_path("save directory disappeared during creation")
        return self.save_fd

    def verify_parent(self) -> None:
        if self.save_fd is None or self._save_identity is None:
            return
        self._verify_campaign_identity()
        try:
            opened = os.fstat(self.save_fd)
            named = os.stat(
                "save",
                dir_fd=self.campaign_fd,
                follow_symlinks=False,
            )
        except (OSError, TypeError) as exc:
            raise _unsafe_state_path("save directory identity could not be verified") from exc
        if (
            not stat.S_ISDIR(opened.st_mode)
            or not stat.S_ISDIR(named.st_mode)
            or self._identity(opened) != self._save_identity
            or self._identity(named) != self._save_identity
        ):
            raise _unsafe_state_path("save directory identity changed during state access")

    def read_bytes(self) -> bytes | None:
        if self.save_fd is None:
            return None
        self.verify_parent()
        try:
            state_fd = os.open(
                self._STATE_FILENAME,
                os.O_RDONLY | getattr(os, "O_NOFOLLOW") | getattr(os, "O_CLOEXEC", 0),
                dir_fd=self.save_fd,
            )
        except FileNotFoundError:
            self.verify_parent()
            return None
        except (OSError, TypeError) as exc:
            raise _unsafe_state_path("executor state file could not be opened safely") from exc
        try:
            if not stat.S_ISREG(os.fstat(state_fd).st_mode):
                raise _unsafe_state_path("executor state target must be a regular file")
            chunks: list[bytes] = []
            while True:
                chunk = os.read(state_fd, 64 * 1024)
                if not chunk:
                    break
                chunks.append(chunk)
        finally:
            os.close(state_fd)
        self.verify_parent()
        return b"".join(chunks)

    def write_bytes(self, payload: bytes) -> None:
        save_fd = self.ensure_save()
        self.verify_parent()
        temp_name = (
            f".subsystem-state.{os.getpid()}.{time.time_ns()}.tmp"
        )
        temp_fd: int | None = None
        replaced = False
        try:
            temp_fd = os.open(
                temp_name,
                os.O_WRONLY
                | os.O_CREAT
                | os.O_EXCL
                | getattr(os, "O_NOFOLLOW")
                | getattr(os, "O_CLOEXEC", 0),
                0o600,
                dir_fd=save_fd,
            )
            view = memoryview(payload)
            while view:
                written = os.write(temp_fd, view)
                view = view[written:]
            os.fsync(temp_fd)
            os.close(temp_fd)
            temp_fd = None
            self.verify_parent()
            os.replace(
                temp_name,
                self._STATE_FILENAME,
                src_dir_fd=save_fd,
                dst_dir_fd=save_fd,
            )
            replaced = True
            os.fsync(save_fd)
            self.verify_parent()
        except TypeError as exc:
            raise _unsafe_state_path(
                "runtime lacks required dir_fd atomic replace primitives"
            ) from exc
        finally:
            if temp_fd is not None:
                os.close(temp_fd)
            if not replaced:
                try:
                    os.unlink(temp_name, dir_fd=save_fd)
                except FileNotFoundError:
                    pass
                except (OSError, TypeError):
                    pass

    def close(self) -> None:
        if self.save_fd is not None:
            os.close(self.save_fd)
            self.save_fd = None
        campaign_fd = getattr(self, "campaign_fd", None)
        if campaign_fd is not None:
            os.close(campaign_fd)
            self.campaign_fd = None


def _state_error(message: str) -> SubsystemExecutorError:
    return _error(
        "malformed_subsystem_state",
        STATE_RELATIVE_PATH.as_posix(),
        message,
    )


def _command_provenance(
    command: dict[str, Any],
    investigator_id: str,
    character: dict[str, Any] | None,
) -> dict[str, Any]:
    kind = command["kind"]
    character_id = None
    if kind in ROLL_COMMAND_KINDS:
        assert character is not None
        character_id = character["id"]
    return {
        "investigator_id": investigator_id,
        "character_id": character_id,
        "decision_id": command["payload"].get("decision_id"),
    }


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
    if not isinstance(offsets, dict) or set(offsets) - {
        "logs/rolls.jsonl",
        "logs/time.jsonl",
    }:
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
    if not isinstance(state, dict):
        raise _state_error("state root must be an object")
    schema_version = state.get("schema_version")
    if schema_version == 1:
        raise _state_error(
            "schema v1 cannot be migrated without command provenance; "
            "discard the unreleased Task 5 state explicitly"
        )
    if schema_version != STATE_SCHEMA_VERSION:
        raise _state_error(f"unsupported schema_version: {schema_version!r}")
    expected_keys = set(_default_state())
    if set(state) != expected_keys:
        raise _state_error("state root must contain exactly the schema v2 fields")

    applied = state.get("applied_command_ids")
    if (
        not isinstance(applied, list)
        or not all(isinstance(item, str) and _SAFE_ID.fullmatch(item) for item in applied)
        or len(applied) != len(set(applied))
    ):
        raise _state_error("applied_command_ids must be unique stable IDs")

    hashes = state.get("command_hashes")
    provenance = state.get("command_provenance")
    snapshots = state.get("result_snapshots")
    pending = state.get("pending_choices")
    if (
        not isinstance(hashes, dict)
        or not isinstance(provenance, dict)
        or not isinstance(snapshots, dict)
        or not isinstance(pending, dict)
    ):
        raise _state_error("hash, provenance, snapshot, and pending-choice indexes must be objects")
    applied_ids = set(applied)
    if set(hashes) != applied_ids or set(provenance) != applied_ids or set(snapshots) != applied_ids:
        raise _state_error(
            "applied IDs, command hashes, provenance, and result snapshots must match"
        )
    if not all(isinstance(value, str) and _SHA256.fullmatch(value) for value in hashes.values()):
        raise _state_error("command_hashes must contain SHA-256 hex digests")
    for command_id, result in snapshots.items():
        _validate_result_snapshot(command_id, result)
        command_provenance = provenance[command_id]
        if not isinstance(command_provenance, dict) or set(command_provenance) != {
            "investigator_id", "character_id", "decision_id",
        }:
            raise _state_error(f"command provenance {command_id!r} has an invalid contract")
        stored_investigator = command_provenance.get("investigator_id")
        if not isinstance(stored_investigator, str) or not _SAFE_ID.fullmatch(stored_investigator):
            raise _state_error(f"command provenance {command_id!r} has an invalid investigator_id")
        stored_decision = command_provenance.get("decision_id")
        if stored_decision is not None and (
            not isinstance(stored_decision, str) or not _SAFE_ID.fullmatch(stored_decision)
        ):
            raise _state_error(f"command provenance {command_id!r} has an invalid decision_id")
        stored_character = command_provenance.get("character_id")
        if result["kind"] in ROLL_COMMAND_KINDS:
            if (
                not isinstance(stored_character, str)
                or not _SAFE_ID.fullmatch(stored_character)
                or stored_character != stored_investigator
            ):
                raise _state_error(
                    f"roll command provenance {command_id!r} has an invalid character identity"
                )
        elif stored_character is not None:
            raise _state_error(
                f"non-roll command provenance {command_id!r} must have null character_id"
            )
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
    with _ExecutorStateDirectory(campaign_dir) as state_directory:
        encoded = state_directory.read_bytes()
    if encoded is None:
        return _default_state()
    try:
        raw = json.loads(encoded.decode("utf-8"))
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
    log_relatives: list[str] = []
    if has_roll_evidence:
        log_relatives.append("logs/rolls.jsonl")
    if structured_sanity:
        log_relatives.append("logs/time.jsonl")
    for relative in log_relatives:
        path = _contained_target(campaign_dir, relative)
        if path.exists() and not path.is_file():
            raise _error(
                "subsystem_transaction_preflight_failed",
                relative,
                "transaction log target must be a file",
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
    encoded = (
        json.dumps(state, indent=2, ensure_ascii=False) + "\n"
    ).encode("utf-8")
    with _ExecutorStateDirectory(campaign_dir) as state_directory:
        state_directory.write_bytes(encoded)


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
    decision_id = payload.get("decision_id")
    if decision_id is not None and (
        not isinstance(decision_id, str) or not _SAFE_ID.fullmatch(decision_id)
    ):
        raise _error(
            "invalid_command_payload",
            f"{base}.decision_id",
            "decision_id must be null or a stable safe ID",
        )
    if "bonus_penalty_dice" in payload:
        modifier = payload["bonus_penalty_dice"]
        if (
            isinstance(modifier, bool)
            or not isinstance(modifier, int)
            or modifier < -2
            or modifier > 2
        ):
            raise _error(
                "invalid_command_payload",
                f"{base}.bonus_penalty_dice",
                "bonus_penalty_dice must be an integer from -2 through 2",
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


def _load_character(character_path: Path, investigator_id: str) -> dict[str, Any]:
    try:
        character = json.loads(Path(character_path).read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise _error("malformed_character", "character_path", str(exc)) from exc
    if not isinstance(character, dict):
        raise _error("malformed_character", "character_path", "character root must be an object")
    character_id = character.get("id")
    if not isinstance(character_id, str) or not _SAFE_ID.fullmatch(character_id):
        raise _error(
            "malformed_character",
            "character_path.id",
            "character id must be a stable safe ID",
        )
    if character_id != investigator_id:
        raise _error(
            "character_identity_mismatch",
            "character_path.id",
            f"character id {character_id!r} does not match investigator {investigator_id!r}",
        )
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
    except coc_sanity.SanityStateIdentityError as exc:
        raise _error(
            "malformed_sanity_state",
            "save/sanity.json.investigator_id",
            str(exc),
        ) from exc
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
    if investigator.get("investigator_id") != investigator_id:
        raise _error(
            "malformed_investigator_state",
            f"{investigator_relative}.investigator_id",
            "persisted investigator_id does not match requested investigator",
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
    expected_commands: list[dict[str, Any]] | None = None,
    investigator_id: str | None = None,
    decision_id: str | None = None,
    results_mode: str = "legacy",
) -> list[dict[str, Any]]:
    """Return legacy rows, unwrapping only plan-bound executor envelopes."""
    rows = list(results or [])
    exact_envelopes = [
        isinstance(row, dict) and set(row) == RESULT_KEYS
        for row in rows
    ]
    if results_mode not in {"legacy", "normalized"}:
        raise _error(
            "invalid_rule_results_mode",
            "rules_results_mode",
            "expected legacy or normalized",
        )
    if results_mode == "normalized" and not all(exact_envelopes):
        invalid_index = next(
            index for index, exact in enumerate(exact_envelopes) if not exact
        )
        raise _error(
            "untrusted_subsystem_result",
            f"rules_results[{invalid_index}]",
            "normalized mode requires complete subsystem result envelopes",
        )
    if results_mode == "normalized":
        if (
            campaign_dir is None
            or expected_commands is None
            or not isinstance(investigator_id, str)
            or not _SAFE_ID.fullmatch(investigator_id)
            or (
                decision_id is not None
                and (not isinstance(decision_id, str) or not _SAFE_ID.fullmatch(decision_id))
            )
        ):
            raise _error(
                "untrusted_subsystem_result",
                "rules_results",
                "campaign, expected commands, investigator, and decision binding are required",
            )
        try:
            expected = _validate_batch(expected_commands)
        except SubsystemExecutorError as exc:
            raise _error(
                "untrusted_subsystem_result",
                "rules_results",
                f"expected command contract is invalid: {exc}",
            ) from exc
        supplied_ids: set[str] = set()
        for index, row in enumerate(rows):
            assert isinstance(row, dict)
            supplied_id = row.get("command_id")
            if not isinstance(supplied_id, str) or supplied_id in supplied_ids:
                raise _error(
                    "untrusted_subsystem_result",
                    f"rules_results[{index}]",
                    "normalized results must contain unique persisted command IDs",
                )
            supplied_ids.add(supplied_id)
        if len(rows) != len(expected):
            raise _error(
                "untrusted_subsystem_result",
                (
                    f"rules_results[{len(expected)}]"
                    if len(rows) > len(expected)
                    else "rules_results"
                ),
                "normalized results must exactly cover current expected commands",
            )
        campaign = Path(campaign_dir)
        state = _recover_inflight(campaign, _load_state(campaign))
        for index, (row, expected_command) in enumerate(zip(rows, expected)):
            assert isinstance(row, dict)
            command_id = row.get("command_id")
            assert isinstance(command_id, str)
            if command_id != expected_command["command_id"]:
                raise _error(
                    "untrusted_subsystem_result",
                    f"rules_results[{index}]",
                    "normalized result order/command ID does not match the current plan",
                )
            if state["command_hashes"].get(command_id) != _canonical_command_hash(
                expected_command
            ):
                raise _error(
                    "untrusted_subsystem_result",
                    f"rules_results[{index}]",
                    "persisted command content does not match the current plan",
                )
            expected_provenance = {
                "investigator_id": investigator_id,
                "character_id": (
                    investigator_id
                    if expected_command["kind"] in ROLL_COMMAND_KINDS
                    else None
                ),
                "decision_id": decision_id,
            }
            if not _json_deep_equal(
                state["command_provenance"].get(command_id),
                expected_provenance,
            ):
                raise _error(
                    "untrusted_subsystem_result",
                    f"rules_results[{index}]",
                    "persisted result provenance does not match current actor/decision",
                )
            snapshot = state["result_snapshots"].get(command_id)
            if not _json_deep_equal(snapshot, row):
                raise _error(
                    "untrusted_subsystem_result",
                    f"rules_results[{index}]",
                    "normalized result does not match a persisted executor snapshot",
                )
        return flatten_result_events(rows)
    # Legacy mode is an explicit compatibility path for already-flat rows.
    # Envelope containers are never reinterpreted as legacy data.
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
    if not isinstance(investigator_id, str) or not _SAFE_ID.fullmatch(investigator_id):
        raise _error(
            "invalid_investigator_id",
            "investigator_id",
            "expected a stable safe ID",
        )
    character_file = Path(character_path)
    validated = _validate_batch(commands)
    hashes = [_canonical_command_hash(command) for command in validated]
    try:
        rng_state = rng.getstate()
        if not callable(getattr(rng, "setstate", None)):
            raise TypeError("rng must provide setstate")
    except Exception as exc:
        raise _error("invalid_rng", "rng", "expected a random.Random-compatible object") from exc

    # These checks are deliberately state-independent. A malformed new call
    # must not authorize rollback of a previously prepared inflight record.
    needs_character = any(command["kind"] in ROLL_COMMAND_KINDS for command in validated)
    character = (
        _load_character(character_file, investigator_id)
        if needs_character
        else None
    )

    state = _recover_inflight(campaign, _load_state(campaign))
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
        expected_provenance = _command_provenance(
            command,
            investigator_id,
            character,
        )
        if not _json_deep_equal(
            state["command_provenance"][command_id],
            expected_provenance,
        ):
            raise _error(
                "command_provenance_mismatch",
                f"commands[{index}]",
                "persisted command actor/character/decision provenance does not match",
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

    _preflight_rule_targets(validated, state, character)
    _preflight_sanity_state(
        campaign,
        validated,
        applied,
        character,
        investigator_id,
    )

    inflight = _build_inflight(
        campaign,
        investigator_id,
        new_commands_with_hashes,
    )
    transaction_state = _json_copy(state)
    transaction_state["inflight"] = inflight
    try:
        _write_executor_state(campaign, transaction_state)
    except SubsystemExecutorError:
        raise
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
            next_state["command_provenance"][command_id] = _command_provenance(
                command,
                investigator_id,
                character,
            )
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
