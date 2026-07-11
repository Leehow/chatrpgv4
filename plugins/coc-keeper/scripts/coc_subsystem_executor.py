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
STATE_SCHEMA_VERSION = 3
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
PUSH_COMMAND_KINDS = frozenset({"push_offer", "push_confirm", "push_resolve"})
BOUT_COMMAND_KINDS = frozenset({"bout_tick", "bout_end"})
CHARACTER_REQUIRED_COMMAND_KINDS = (
    ROLL_COMMAND_KINDS | PUSH_COMMAND_KINDS | BOUT_COMMAND_KINDS
)
RNG_CONSUMING_COMMAND_KINDS = ROLL_COMMAND_KINDS | {"push_resolve"}
ROLL_EVIDENCE_COMMAND_KINDS = ROLL_COMMAND_KINDS | {"push_resolve"}
SAN_MUTATION_COMMAND_KINDS = frozenset({"sanity_check", "bout_tick", "bout_end"})
SUPPORTED_COMMAND_KINDS = ROLL_COMMAND_KINDS | PUSH_COMMAND_KINDS | BOUT_COMMAND_KINDS
EXPECTED_PHASE = {
    **{kind: "resolve" for kind in ROLL_COMMAND_KINDS},
    "push_offer": "offer",
    "push_confirm": "confirm",
    "push_resolve": "resolve",
    "bout_tick": "resolve",
    "bout_end": "resolve",
}
RESULT_STATUSES_BY_KIND = {
    **{kind: frozenset({"completed"}) for kind in ROLL_COMMAND_KINDS},
    "sanity_check": frozenset({"completed", "pending_choice"}),
    "push_offer": frozenset({"pending_choice"}),
    "push_confirm": frozenset({"cancelled", "completed"}),
    "push_resolve": frozenset({"completed"}),
    "bout_tick": frozenset({"completed", "pending_choice"}),
    "bout_end": frozenset({"completed"}),
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
_TRANSACTION_DIR_FD_SUPPORTED = all(
    function in os.supports_dir_fd for function in (os.open, os.stat, os.unlink)
)
_TRANSACTION_NOFOLLOW_STAT_SUPPORTED = os.stat in os.supports_follow_symlinks


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


def _canonical_json_hash(value: Any) -> str:
    encoded = json.dumps(
        value,
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


def _bout_choice_id(command_id: str) -> str:
    legacy = f"{command_id}:bout"
    if _SAFE_ID.fullmatch(legacy):
        return legacy
    digest = hashlib.sha256(command_id.encode("utf-8")).hexdigest()
    return f"bout:{digest}"


# Pending-kind behavior is registered per result kind so Task 6 can add a
# second lifecycle without weakening or duplicating the push contract.
PENDING_CHOICE_CONTRACTS: dict[str, dict[str, Any]] = {
    "push_offer": {
        "status": "pending_choice",
        "choice_kind": "push_confirm",
        "choice_id": _push_choice_id,
        "responder": "player",
        "options": [
            {"action": "confirm", "label": "Push the roll"},
            {"action": "cancel", "label": "Keep the original failure"},
        ],
        "scope": "global",
    },
    "sanity_check": {
        "status": "pending_choice",
        "choice_kind": "bout_keeper_action",
        "choice_id": _bout_choice_id,
        "responder": "keeper",
        "options": [
            {"action": "tick", "label": "Advance Keeper-controlled round"},
            {"action": "end", "label": "End the bout now"},
        ],
        "scope": "global",
    },
    "bout_tick": {
        "status": "pending_choice",
        "choice_kind": "bout_keeper_action",
        "choice_id": None,
        "responder": "keeper",
        "options": [
            {"action": "tick", "label": "Advance Keeper-controlled round"},
            {"action": "end", "label": "End the bout now"},
        ],
        "scope": "global",
    },
}

PUBLIC_PENDING_CHOICE_KEYS = frozenset({
    "choice_id",
    "kind",
    "command_id",
    "responder",
    "revision",
    "prompt",
    "options",
})
PUSH_CONTEXT_KEYS = frozenset({
    "choice_id",
    "kind",
    "investigator_id",
    "character_id",
    "origin_command_id",
    "offer_command_id",
    "revision",
    "original_roll",
    "changed_method_evidence",
    "announced_consequence",
    "resolution_context",
    "origin_decision_id",
    "offer_command",
})
PUSH_HISTORY_EXTRA_KEYS = frozenset({
    "public_choice",
    "terminal_action",
    "terminal_revision",
    "terminal_command_ids",
    "terminal_commands",
    "terminal_results",
    "terminal_result_receipt_hashes",
    "response_changed_method_evidence",
})
BOUT_CONTEXT_KEYS = frozenset({
    "choice_id",
    "kind",
    "investigator_id",
    "character_id",
    "origin_command_id",
    "bout_id",
    "revision",
    "remaining_rounds",
})
BOUT_HISTORY_EXTRA_KEYS = frozenset({
    "public_choice",
    "terminal_action",
    "terminal_revision",
    "terminal_command_ids",
    "terminal_commands",
    "terminal_results",
    "terminal_result_receipt_hashes",
})
CHANGED_METHOD_SOURCES = frozenset({
    "player_proposal",
    "keeper_prompt",
    "module_instruction",
})


def _default_state() -> dict[str, Any]:
    return {
        "schema_version": STATE_SCHEMA_VERSION,
        "applied_command_ids": [],
        "command_hashes": {},
        "command_provenance": {},
        "result_snapshots": {},
        "pending_choices": {},
        "pending_contexts": {},
        "choice_history": {},
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
    if kind in CHARACTER_REQUIRED_COMMAND_KINDS:
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
    if pending is None:
        if status == contract["status"]:
            raise _state_error(
                f"result snapshot {command_id!r} lacks its pending choice"
            )
        return
    if status != contract["status"] or not isinstance(pending, dict):
        raise _state_error(
            f"result snapshot {command_id!r} has an invalid pending status/choice"
        )
    choice_id_factory = contract.get("choice_id")
    expected_choice_id = (
        choice_id_factory(command_id) if callable(choice_id_factory) else None
    )
    if expected_choice_id is not None and pending.get("choice_id") != expected_choice_id:
        raise _state_error(
            f"result snapshot {command_id!r} has an invalid pending choice_id"
        )
    if not isinstance(pending.get("choice_id"), str) or not _SAFE_ID.fullmatch(
        pending["choice_id"]
    ):
        raise _state_error(
            f"result snapshot {command_id!r} has an unsafe pending choice_id"
        )
    if pending.get("kind") != contract["choice_kind"]:
        raise _state_error(
            f"result snapshot {command_id!r} has an invalid pending choice kind"
        )
    if pending.get("command_id") != command_id:
        raise _state_error(
            f"result snapshot {command_id!r} has a mismatched pending command_id"
        )
    if set(pending) != PUBLIC_PENDING_CHOICE_KEYS:
        raise _state_error(
            f"result snapshot {command_id!r} has an invalid public choice contract"
        )
    if pending.get("responder") != contract["responder"]:
        raise _state_error(
            f"result snapshot {command_id!r} has an invalid choice responder"
        )
    revision = pending.get("revision")
    if isinstance(revision, bool) or not isinstance(revision, int) or revision < 0:
        raise _state_error(
            f"result snapshot {command_id!r} has an invalid choice revision"
        )
    prompt = pending.get("prompt")
    if not isinstance(prompt, str) or not prompt.strip():
        raise _state_error(
            f"result snapshot {command_id!r} has an empty public choice prompt"
        )
    if not _json_deep_equal(pending.get("options"), contract["options"]):
        raise _state_error(
            f"result snapshot {command_id!r} has invalid player-safe options"
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
        "logs/subsystem-results.jsonl",
        "logs/push-offers.jsonl",
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


_SCHEMA_V2_KEYS = frozenset({
    "schema_version",
    "applied_command_ids",
    "command_hashes",
    "command_provenance",
    "result_snapshots",
    "pending_choices",
    "inflight",
})


def _migrate_schema_v2(state: Any) -> dict[str, Any]:
    """Validate and migrate the released Task 5 shape without inventing secrets."""
    if not isinstance(state, dict) or set(state) != _SCHEMA_V2_KEYS:
        raise _state_error("schema v2 state root has an invalid field set")
    pending = state.get("pending_choices")
    if not isinstance(pending, dict):
        raise _state_error("schema v2 pending_choices must be an object")
    if pending:
        raise _state_error(
            "schema v2 pending choices cannot be migrated without private context"
        )
    migrated = _json_copy(state)
    migrated["schema_version"] = STATE_SCHEMA_VERSION
    migrated["pending_contexts"] = {}
    migrated["choice_history"] = {}
    return _validate_state(migrated)


def _validate_push_pending_context(
    choice_id: str,
    context: Any,
    *,
    choice: dict[str, Any],
    applied_ids: set[str],
    snapshots: dict[str, Any],
    provenance: dict[str, Any],
    hashes: dict[str, str],
) -> None:
    if not isinstance(context, dict) or set(context) != PUSH_CONTEXT_KEYS:
        raise _state_error(f"pending context {choice_id!r} has an invalid contract")
    if context.get("choice_id") != choice_id or context.get("kind") != choice.get("kind"):
        raise _state_error(f"pending context {choice_id!r} mismatches its public choice")
    if context.get("offer_command_id") != choice.get("command_id"):
        raise _state_error(f"pending context {choice_id!r} mismatches its creator command")
    offer_command = context.get("offer_command")
    offer_id = context.get("offer_command_id")
    if (
        not isinstance(offer_command, dict)
        or offer_command.get("command_id") != context.get("offer_command_id")
        or offer_command.get("kind") != "push_offer"
        or offer_command.get("phase") != "offer"
        or set(offer_command) != COMMAND_KEYS
        or _canonical_command_hash(offer_command)
        != hashes.get(offer_id)
    ):
        raise _state_error(f"pending context {choice_id!r} lacks its immutable creator command")
    if context.get("revision") != choice.get("revision"):
        raise _state_error(f"pending context {choice_id!r} mismatches its revision")
    investigator_id = context.get("investigator_id")
    character_id = context.get("character_id")
    if (
        not isinstance(investigator_id, str)
        or not _SAFE_ID.fullmatch(investigator_id)
        or character_id != investigator_id
    ):
        raise _state_error(f"pending context {choice_id!r} has invalid actor identity")
    origin_id = context.get("origin_command_id")
    if not isinstance(origin_id, str) or origin_id not in applied_ids:
        raise _state_error(f"pending context {choice_id!r} has an invalid origin command")
    origin_snapshot = snapshots[origin_id]
    origin_provenance = provenance[origin_id]
    offer_provenance = provenance.get(offer_id)
    if (
        offer_id not in applied_ids
        or snapshots[offer_id].get("kind") != "push_offer"
        or not isinstance(offer_provenance, dict)
        or offer_provenance.get("investigator_id") != investigator_id
        or offer_provenance.get("character_id") != character_id
        or offer_provenance.get("decision_id")
        != offer_command.get("payload", {}).get("decision_id")
    ):
        raise _state_error(f"pending context {choice_id!r} has invalid creator provenance")
    if origin_snapshot.get("kind") not in {"skill_check", "characteristic_check"}:
        raise _state_error(f"pending context {choice_id!r} has an ineligible origin kind")
    if (
        origin_provenance.get("investigator_id") != investigator_id
        or origin_provenance.get("character_id") != character_id
        or context.get("origin_decision_id") != origin_provenance.get("decision_id")
    ):
        raise _state_error(f"pending context {choice_id!r} has mismatched origin provenance")
    origin_events = origin_snapshot.get("events") or []
    if len(origin_events) != 1 or not _json_deep_equal(
        context.get("original_roll"), origin_events[0]
    ):
        raise _state_error(f"pending context {choice_id!r} mismatches persisted roll evidence")
    if not _json_deep_equal(
        context.get("resolution_context"), origin_events[0].get("resolution_context") or {}
    ):
        raise _state_error(f"pending context {choice_id!r} mismatches origin resolution context")
    offer_payload = offer_command.get("payload")
    if not isinstance(offer_payload, dict) or (
        offer_payload.get("original_command_id") != origin_id
        or not _json_deep_equal(
            context.get("changed_method_evidence"),
            offer_payload.get("changed_method_evidence"),
        )
        or not _json_deep_equal(
            context.get("announced_consequence"),
            offer_payload.get("announced_consequence"),
        )
    ):
        raise _state_error(f"pending context {choice_id!r} diverges from its creator command")
    skill = str(origin_events[0].get("skill") or "ordinary")
    expected_prompt = (
        f"Push the failed {skill} roll? Failure consequence: "
        f"{offer_payload['announced_consequence']['summary']}"
    )
    if choice.get("prompt") != expected_prompt:
        raise _state_error(f"pending context {choice_id!r} has a forged public prompt")
    try:
        _validate_json_value(context, f"pending_contexts.{choice_id}")
    except SubsystemExecutorError as exc:
        raise _state_error(str(exc)) from exc


def _validate_bout_pending_context(
    choice_id: str,
    context: Any,
    *,
    choice: dict[str, Any],
    applied_ids: set[str],
    snapshots: dict[str, Any],
    provenance: dict[str, Any],
    hashes: dict[str, str],
) -> None:
    _ = hashes
    if not isinstance(context, dict) or set(context) != BOUT_CONTEXT_KEYS:
        raise _state_error(f"pending context {choice_id!r} has an invalid bout contract")
    if context.get("choice_id") != choice_id or context.get("kind") != "bout_keeper_action":
        raise _state_error(f"pending context {choice_id!r} mismatches its public bout choice")
    if context.get("revision") != choice.get("revision"):
        raise _state_error(f"pending context {choice_id!r} mismatches its bout revision")
    investigator_id = context.get("investigator_id")
    if (
        not isinstance(investigator_id, str)
        or not _SAFE_ID.fullmatch(investigator_id)
        or context.get("character_id") != investigator_id
    ):
        raise _state_error(f"pending context {choice_id!r} has invalid bout actor identity")
    origin_id = context.get("origin_command_id")
    if not isinstance(origin_id, str) or origin_id not in applied_ids:
        raise _state_error(f"pending context {choice_id!r} has an invalid bout origin")
    if snapshots[origin_id].get("kind") != "sanity_check":
        raise _state_error(f"pending context {choice_id!r} has a non-SAN bout origin")
    origin_provenance = provenance[origin_id]
    if (
        origin_provenance.get("investigator_id") != investigator_id
        or origin_provenance.get("character_id") != investigator_id
    ):
        raise _state_error(f"pending context {choice_id!r} mismatches bout origin provenance")
    bout_id = context.get("bout_id")
    remaining = context.get("remaining_rounds")
    if not isinstance(bout_id, str) or not _SAFE_ID.fullmatch(bout_id):
        raise _state_error(f"pending context {choice_id!r} has an invalid bout_id")
    if isinstance(remaining, bool) or not isinstance(remaining, int) or remaining < 1:
        raise _state_error(f"pending context {choice_id!r} has invalid remaining rounds")
    creator_id = choice.get("command_id")
    creator = snapshots.get(creator_id, {})
    expected_bout_id = None
    expected_remaining = None
    for event in creator.get("events") or []:
        if not isinstance(event, dict):
            continue
        if event.get("event_type") == "bout_tick":
            expected_bout_id = event.get("bout_id")
            expected_remaining = event.get("remaining_rounds")
        elif event.get("event_type") == "bout_of_madness":
            expected_bout_id = event.get("bout_id")
            expected_remaining = event.get("duration_rounds")
    if expected_bout_id != bout_id or expected_remaining != remaining:
        raise _state_error(f"pending context {choice_id!r} diverges from its creator bout result")
    try:
        _validate_json_value(context, f"pending_contexts.{choice_id}")
    except SubsystemExecutorError as exc:
        raise _state_error(str(exc)) from exc


def _validate_private_choice_context(
    choice_id: str,
    context: Any,
    *,
    choice: dict[str, Any],
    applied_ids: set[str],
    snapshots: dict[str, Any],
    provenance: dict[str, Any],
    hashes: dict[str, str],
) -> None:
    validator = (
        _validate_push_pending_context
        if choice.get("kind") == "push_confirm"
        else _validate_bout_pending_context
        if choice.get("kind") == "bout_keeper_action"
        else None
    )
    if validator is None:
        raise _state_error(f"pending context {choice_id!r} has unsupported choice kind")
    validator(
        choice_id,
        context,
        choice=choice,
        applied_ids=applied_ids,
        snapshots=snapshots,
        provenance=provenance,
        hashes=hashes,
    )


def _validate_history_terminal_snapshot(
    choice_id: str,
    entry: dict[str, Any],
    command: dict[str, Any],
    snapshot: dict[str, Any],
    all_snapshots: dict[str, Any],
) -> None:
    """Bind a consumed choice to the exact terminal result contract."""
    command_id = command["command_id"]
    kind = command["kind"]
    action = entry["terminal_action"]
    history_ref = f"save/subsystem-state.json#choice_history/{choice_id}"
    if snapshot.get("pending_choice") is not None:
        raise _state_error(f"choice history {choice_id!r} terminal result cannot remain pending")

    if kind == "push_confirm":
        expected_status = "cancelled" if action == "cancel" else "completed"
        expected_events: list[dict[str, Any]] = []
        if action == "confirm":
            expected_events = [{
                "event_type": "push_confirmed",
                "kind": "push_confirm",
                "choice_id": choice_id,
                "revision": entry["terminal_revision"],
                "source_command_id": command_id,
                "original_command_id": entry["origin_command_id"],
                "changed_method_evidence": _json_copy(
                    entry["response_changed_method_evidence"]
                ),
            }]
        if (
            snapshot.get("status") != expected_status
            or not _json_deep_equal(snapshot.get("events"), expected_events)
            or snapshot.get("state_refs") != [history_ref]
        ):
            raise _state_error(f"choice history {choice_id!r} has an invalid push-confirm result")
        return

    if kind == "push_resolve":
        events = snapshot.get("events")
        if (
            snapshot.get("status") != "completed"
            or snapshot.get("state_refs")
            != [f"logs/rolls.jsonl#{command_id}", history_ref]
            or not isinstance(events, list)
            or len(events) != 1
        ):
            raise _state_error(f"choice history {choice_id!r} has an invalid push-resolve result")
        event = events[0]
        original = entry["original_roll"]
        expected_keys = {
            "roll_id", "decision_id", "kind", "skill", "target", "difficulty",
            "reason", "request_id", "bonus_penalty_dice", "roll",
            "effective_target", "outcome", "success", "roll_contract",
            "resolution_context", "pushed", "push_gate", "original_command_id",
            "original_roll_id", "announced_consequence", "changed_method_evidence",
            "source_command_id",
        }
        expected_static = {
            "roll_id": command["payload"]["roll_id"],
            "decision_id": command["payload"]["decision_id"],
            "kind": original.get("kind"),
            "skill": original.get("skill"),
            "target": original.get("target"),
            "difficulty": str(original.get("difficulty") or "regular"),
            "reason": original.get("reason"),
            "request_id": original.get("request_id"),
            "bonus_penalty_dice": int(original.get("bonus_penalty_dice", 0) or 0),
            "roll_contract": _json_copy(original.get("roll_contract")),
            "resolution_context": _json_copy(entry["resolution_context"]),
            "pushed": True,
            "push_gate": {
                "method_changed": True,
                "consequence_announced": True,
                "player_confirmed": True,
            },
            "original_command_id": entry["origin_command_id"],
            "original_roll_id": original.get("roll_id"),
            "announced_consequence": _json_copy(entry["announced_consequence"]),
            "changed_method_evidence": _json_copy(
                entry["response_changed_method_evidence"]
            ),
            "source_command_id": command_id,
        }
        if set(event) != expected_keys or any(
            not _json_deep_equal(event.get(key), value)
            for key, value in expected_static.items()
        ):
            raise _state_error(f"choice history {choice_id!r} has forged push-roll evidence")
        expected_effective_target = coc_roll._effective_target(
            int(original.get("target")), str(original.get("difficulty") or "regular")
        )
        expected_outcome = (
            coc_roll.coc_rules.success_level(event.get("roll"), expected_effective_target)
            if isinstance(event.get("roll"), int) and not isinstance(event.get("roll"), bool)
            else None
        )
        if (
            isinstance(event.get("roll"), bool)
            or not isinstance(event.get("roll"), int)
            or not 1 <= event["roll"] <= 100
            or isinstance(event.get("effective_target"), bool)
            or not isinstance(event.get("effective_target"), int)
            or event.get("effective_target") != expected_effective_target
            or event.get("outcome") != expected_outcome
            or event.get("success") != (event.get("outcome") in SUCCESS_OUTCOMES)
        ):
            raise _state_error(f"choice history {choice_id!r} has invalid pushed-roll outcome")
        return

    if kind not in BOUT_COMMAND_KINDS:
        raise _state_error(f"choice history {choice_id!r} has unsupported terminal kind")
    expected_refs = [
        f"save/sanity.json#{entry['bout_id']}",
        f"save/investigator-state/{entry['investigator_id']}.json#bout_active",
        history_ref,
    ]
    events = snapshot.get("events")
    expected_types = ["bout_ended"] if kind == "bout_end" else ["bout_tick", "bout_ended"]
    if (
        snapshot.get("status") != "completed"
        or snapshot.get("state_refs") != expected_refs
        or not isinstance(events, list)
        or [event.get("event_type") for event in events] != expected_types
    ):
        raise _state_error(f"choice history {choice_id!r} has an invalid terminal bout result")
    if kind == "bout_tick" and events[0] != {
        "event_type": "bout_tick",
        "bout_id": entry["bout_id"],
        "remaining_rounds": 0,
        "source_command_id": command_id,
    }:
        raise _state_error(f"choice history {choice_id!r} has forged bout-tick evidence")
    ended = events[-1]
    origin_events = all_snapshots[entry["origin_command_id"]].get("events") or []
    origin_bout = next(
        (
            event for event in origin_events
            if isinstance(event, dict)
            and event.get("event_type") == "bout_of_madness"
            and event.get("bout_id") == entry["bout_id"]
        ),
        None,
    )
    if not isinstance(origin_bout, dict):
        raise _state_error(f"choice history {choice_id!r} lacks canonical bout origin evidence")
    expected_suggestion = origin_bout.get("backstory_amend_suggestion")
    ended_keys = {"event_id", "bout_id", "summary", "event_type"}
    if "backstory_amend_suggestion" in ended:
        ended_keys.add("backstory_amend_suggestion")
        suggestion = ended.get("backstory_amend_suggestion")
        if (
            not isinstance(suggestion, dict)
            or set(suggestion) != {"mode", "backstory_field", "keeper_note"}
            or suggestion.get("mode") not in {"corrupt_existing", "add_irrational"}
            or not isinstance(suggestion.get("backstory_field"), str)
            or not suggestion.get("backstory_field")
            or not isinstance(suggestion.get("keeper_note"), str)
            or not suggestion.get("keeper_note")
        ):
            raise _state_error(f"choice history {choice_id!r} has forged bout backstory evidence")
    if not _json_deep_equal(ended.get("backstory_amend_suggestion"), expected_suggestion):
        raise _state_error(f"choice history {choice_id!r} diverges from canonical bout backstory evidence")
    if (
        set(ended) != ended_keys
        or ended.get("bout_id") != entry["bout_id"]
        or not isinstance(ended.get("event_id"), str)
        or not re.fullmatch(r"se[1-9][0-9]*", ended["event_id"])
        or ended.get("summary") != (
            f"{entry['investigator_id']} bout of madness ends; control returns "
            "to the player (underlying insanity continues)."
        )
    ):
        raise _state_error(f"choice history {choice_id!r} has forged bout-end evidence")


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
        raise _state_error("state root must contain exactly the schema v3 fields")

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
    pending_contexts = state.get("pending_contexts")
    history = state.get("choice_history")
    if (
        not isinstance(hashes, dict)
        or not isinstance(provenance, dict)
        or not isinstance(snapshots, dict)
        or not isinstance(pending, dict)
        or not isinstance(pending_contexts, dict)
        or not isinstance(history, dict)
    ):
        raise _state_error(
            "hash, provenance, snapshot, pending-choice, private-context, and history indexes must be objects"
        )
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
        if result["kind"] in CHARACTER_REQUIRED_COMMAND_KINDS:
            if (
                not isinstance(stored_character, str)
                or not _SAFE_ID.fullmatch(stored_character)
                or stored_character != stored_investigator
            ):
                raise _state_error(
                    f"character-bound command provenance {command_id!r} has an invalid character identity"
                )
        elif stored_character is not None:
            raise _state_error(
                f"non-character command provenance {command_id!r} must have null character_id"
            )
    if set(pending_contexts) != set(pending):
        raise _state_error("active public choices and private contexts must have identical keys")
    if set(history) & set(pending):
        raise _state_error("active choices cannot also appear in immutable history")
    for choice_id, entry in history.items():
        if not isinstance(choice_id, str) or not _SAFE_ID.fullmatch(choice_id):
            raise _state_error("choice history keys must be stable IDs")
        if not isinstance(entry, dict):
            raise _state_error(f"choice history {choice_id!r} has an invalid contract")
        public_choice = entry.get("public_choice")
        if not isinstance(public_choice, dict):
            raise _state_error(f"choice history {choice_id!r} lacks its public creator choice")
        creator_id = public_choice.get("command_id")
        if not isinstance(creator_id, str) or creator_id not in applied_ids:
            raise _state_error(f"choice history {choice_id!r} has an invalid creator command")
        creator_snapshot = snapshots[creator_id]
        if not _json_deep_equal(
            creator_snapshot.get("pending_choice"), public_choice
        ):
            raise _state_error(
                f"choice history {choice_id!r} does not match its creator snapshot"
            )
        _validate_pending_choice_contract(
            creator_id,
            creator_snapshot["kind"],
            creator_snapshot["status"],
            public_choice,
        )
        action = entry.get("terminal_action")
        revision = entry.get("terminal_revision")
        command_ids = entry.get("terminal_command_ids")
        terminal_commands = entry.get("terminal_commands")
        terminal_results = entry.get("terminal_results")
        terminal_receipt_hashes = entry.get("terminal_result_receipt_hashes")
        if public_choice.get("kind") == "push_confirm":
            expected_keys = set(PUSH_CONTEXT_KEYS) | set(PUSH_HISTORY_EXTRA_KEYS)
            allowed_actions = {"confirm", "cancel"}
            expected_count = 2 if action == "confirm" else 1
            base_keys = PUSH_CONTEXT_KEYS
        elif public_choice.get("kind") == "bout_keeper_action":
            expected_keys = set(BOUT_CONTEXT_KEYS) | set(BOUT_HISTORY_EXTRA_KEYS)
            allowed_actions = {"tick", "end"}
            expected_count = 1
            base_keys = BOUT_CONTEXT_KEYS
        else:
            raise _state_error(f"choice history {choice_id!r} has unsupported kind")
        if set(entry) != expected_keys:
            raise _state_error(f"choice history {choice_id!r} has an invalid field set")
        base_context = {key: _json_copy(entry[key]) for key in base_keys}
        _validate_private_choice_context(
            choice_id,
            base_context,
            choice=public_choice,
            applied_ids=applied_ids,
            snapshots=snapshots,
            provenance=provenance,
            hashes=hashes,
        )
        if action not in allowed_actions or revision != public_choice.get("revision"):
            raise _state_error(f"choice history {choice_id!r} has invalid terminal metadata")
        if (
            not isinstance(command_ids, list)
            or len(command_ids) != expected_count
            or not all(command_id in applied_ids for command_id in command_ids)
        ):
            raise _state_error(f"choice history {choice_id!r} has invalid terminal commands")
        ids = _resume_ids(choice_id, int(revision), str(action))
        expected_command_ids = [ids["confirm_command_id"]]
        expected_kinds = [
            "push_confirm" if public_choice.get("kind") == "push_confirm"
            else "bout_tick" if action == "tick" else "bout_end"
        ]
        if public_choice.get("kind") == "push_confirm" and action == "confirm":
            expected_command_ids.append(ids["resolve_command_id"])
            expected_kinds.append("push_resolve")
        if command_ids != expected_command_ids:
            raise _state_error(f"choice history {choice_id!r} has non-canonical terminal command IDs")
        if (
            not isinstance(terminal_commands, list)
            or len(terminal_commands) != expected_count
            or [
                command.get("command_id") if isinstance(command, dict) else None
                for command in terminal_commands
            ] != expected_command_ids
        ):
            raise _state_error(f"choice history {choice_id!r} lacks exact terminal command receipts")
        if not isinstance(terminal_results, list) or len(terminal_results) != expected_count:
            raise _state_error(f"choice history {choice_id!r} lacks exact terminal result receipts")
        if (
            not isinstance(terminal_receipt_hashes, list)
            or len(terminal_receipt_hashes) != expected_count
            or not all(isinstance(value, str) and _SHA256.fullmatch(value)
                       for value in terminal_receipt_hashes)
        ):
            raise _state_error(
                f"choice history {choice_id!r} lacks canonical terminal receipt hashes"
            )
        response = {
            "choice_id": choice_id,
            "responder": public_choice["responder"],
            "revision": revision,
            "action": action,
        }
        try:
            expected_plan = _pending_resume_plan_from_state(
                state, entry["investigator_id"], response
            )
            expected_commands = commands_from_rules_requests(expected_plan)
            validated_commands = _validate_batch(terminal_commands)
        except SubsystemExecutorError as exc:
            raise _state_error(
                f"choice history {choice_id!r} has invalid terminal command receipts: {exc}"
            ) from exc
        if not _json_deep_equal(validated_commands, expected_commands):
            raise _state_error(f"choice history {choice_id!r} terminal receipts are non-canonical")
        for terminal_id, expected_kind, terminal_command, terminal_result in zip(
            command_ids, expected_kinds, terminal_commands, terminal_results
        ):
            if (
                snapshots[terminal_id].get("kind") != expected_kind
                or provenance[terminal_id].get("investigator_id")
                != entry.get("investigator_id")
                or provenance[terminal_id].get("character_id")
                != entry.get("character_id")
                or provenance[terminal_id].get("decision_id") != ids["decision_id"]
                or hashes[terminal_id] != _canonical_command_hash(terminal_command)
            ):
                raise _state_error(f"choice history {choice_id!r} has invalid terminal provenance")
            if not _json_deep_equal(terminal_result, snapshots[terminal_id]):
                raise _state_error(f"choice history {choice_id!r} terminal result receipt diverges")
            _validate_history_terminal_snapshot(
                choice_id, entry, terminal_command, snapshots[terminal_id], snapshots
            )
        if public_choice.get("kind") == "push_confirm":
            changed = entry.get("response_changed_method_evidence")
            if action == "confirm" and not isinstance(changed, dict):
                raise _state_error(f"choice history {choice_id!r} lacks changed-method evidence")
            if action == "cancel" and changed is not None:
                raise _state_error(f"cancelled choice history {choice_id!r} cannot carry changed-method evidence")
        try:
            _validate_json_value(entry, f"choice_history.{choice_id}")
        except SubsystemExecutorError as exc:
            raise _state_error(str(exc)) from exc
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
        _validate_private_choice_context(
            choice_id,
            pending_contexts[choice_id],
            choice=choice,
            applied_ids=applied_ids,
            snapshots=snapshots,
            provenance=provenance,
            hashes=hashes,
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


_RESULT_RECEIPT_LOG = Path("logs/subsystem-results.jsonl")
_PUSH_OFFER_EVIDENCE_LOG = Path("logs/push-offers.jsonl")


def _result_choice_id(
    command: dict[str, Any], result: dict[str, Any], state: dict[str, Any]
) -> str | None:
    pending = result.get("pending_choice")
    if isinstance(pending, dict):
        return pending.get("choice_id")
    payload = command.get("payload")
    if isinstance(payload, dict) and isinstance(payload.get("choice_id"), str):
        return payload["choice_id"]
    command_id = command.get("command_id")
    for choice_id, history in state.get("choice_history", {}).items():
        if isinstance(history, dict) and command_id in (history.get("terminal_command_ids") or []):
            return choice_id
    return None


def _result_receipt_record(
    sequence: int,
    command: dict[str, Any],
    result: dict[str, Any],
    state: dict[str, Any],
) -> dict[str, Any]:
    command_id = command["command_id"]
    material = {
        "record_type": "subsystem_result_receipt",
        "sequence": sequence,
        "command_id": command_id,
        "command_hash": state["command_hashes"][command_id],
        "command_provenance": _json_copy(state["command_provenance"][command_id]),
        "choice_id": _result_choice_id(command, result, state),
        "result": _json_copy(result),
    }
    material["receipt_hash"] = _canonical_json_hash(material)
    return material


def _push_offer_evidence_record(
    sequence: int,
    command: dict[str, Any],
    result: dict[str, Any],
    state: dict[str, Any],
) -> dict[str, Any]:
    command_id = command["command_id"]
    public_choice = result["pending_choice"]
    material = {
        "record_type": "push_offer_evidence",
        "sequence": sequence,
        "actor": state["command_provenance"][command_id]["investigator_id"],
        "command_id": command_id,
        "command_hash": state["command_hashes"][command_id],
        "command_provenance": _json_copy(state["command_provenance"][command_id]),
        "choice_id": public_choice["choice_id"],
        "command": _json_copy(command),
        "public_choice": _json_copy(public_choice),
        "announced_consequence": _json_copy(
            command["payload"]["announced_consequence"]
        ),
    }
    material["evidence_hash"] = _canonical_json_hash(material)
    return material


def _read_jsonl_records(path: Path, *, label: str) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    records: list[dict[str, Any]] = []
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                value = json.loads(line)
                if not isinstance(value, dict):
                    raise ValueError("record is not an object")
                records.append(value)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        raise _state_error(f"{label} is invalid: {exc}") from exc
    return records


def _validate_result_source_evidence(
    campaign_dir: Path,
    state: dict[str, Any],
    commands_by_id: dict[str, dict[str, Any]],
) -> None:
    roll_records = _read_jsonl_records(
        campaign_dir / "logs" / "rolls.jsonl", label="canonical roll log"
    )
    rolls_by_command: dict[str, list[dict[str, Any]]] = {}
    for row in roll_records:
        command_id = row.get("command_id")
        if isinstance(command_id, str):
            rolls_by_command.setdefault(command_id, []).append(row)

    # The executor state and subsystem-result ledger are mutually redundant
    # copies and can therefore be rewritten together.  Bind every executor
    # percentile result to the separately persisted append-only roll evidence,
    # including ordinary rolls later used as pushed-roll origins.  Validate the
    # complete payload so roll identity, request/source context, target,
    # modifier, percentile and derived outcome cannot be substituted piecemeal.
    seen_roll_ids: dict[str, str] = {}
    expected_row_keys = {"type", "actor", "command_id", "payload", "ts"}
    for command_id in state["applied_command_ids"]:
        result = state["result_snapshots"][command_id]
        if result.get("kind") not in ROLL_EVIDENCE_COMMAND_KINDS:
            continue
        expected_events = [
            event for event in result.get("events") or []
            if isinstance(event, dict) and isinstance(event.get("roll_id"), str)
        ]
        rows = rolls_by_command.get(command_id, [])
        if not expected_events or len(rows) != len(expected_events):
            raise _state_error(
                f"canonical roll evidence for {command_id!r} is missing or duplicated"
            )
        provenance = state["command_provenance"][command_id]
        for event, row in zip(expected_events, rows):
            roll_id = event["roll_id"]
            previous = seen_roll_ids.get(roll_id)
            if previous is not None:
                raise _state_error(
                    f"canonical roll_id {roll_id!r} is shared by "
                    f"{previous!r} and {command_id!r}"
                )
            seen_roll_ids[roll_id] = command_id
            if (
                set(row) != expected_row_keys
                or row.get("type") != "roll"
                or row.get("actor") != provenance.get("investigator_id")
                or row.get("command_id") != command_id
                or not isinstance(row.get("ts"), str)
                or not row["ts"]
                or not _json_deep_equal(row.get("payload"), event)
            ):
                raise _state_error(
                    f"canonical roll evidence for {command_id!r} diverges"
                )
    sanity_path = campaign_dir / "save" / "sanity.json"
    sanity = None
    if sanity_path.is_file():
        try:
            sanity = json.loads(sanity_path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise _state_error(f"canonical sanity snapshot is invalid: {exc}") from exc
    for choice_id, history in state["choice_history"].items():
        for command_id in history["terminal_command_ids"]:
            result = state["result_snapshots"][command_id]
            if result["kind"] == "push_resolve":
                rows = rolls_by_command.get(command_id, [])
                row = rows[0] if len(rows) == 1 else None
                if not isinstance(row, dict) or not _json_deep_equal(
                    row.get("payload"), result["events"][0]
                ):
                    raise _state_error(
                        f"choice history {choice_id!r} diverges from canonical roll receipt"
                    )
            if result["kind"] in BOUT_COMMAND_KINDS and result["status"] == "completed":
                if not isinstance(sanity, dict):
                    raise _state_error(
                        f"choice history {choice_id!r} lacks canonical sanity source"
                    )
                raw_events = sanity.get("events") or []
                ended = result["events"][-1]
                source = next(
                    (row for row in raw_events if isinstance(row, dict)
                     and row.get("event_id") == ended.get("event_id")),
                    None,
                )
                expected = None
                if isinstance(source, dict):
                    payload = source.get("payload") if isinstance(source.get("payload"), dict) else {}
                    expected = {"event_id": source.get("event_id"), **payload,
                                "event_type": source.get("type")}
                if not _json_deep_equal(expected, ended):
                    raise _state_error(
                        f"choice history {choice_id!r} diverges from canonical sanity event"
                    )
                origin = state["result_snapshots"][history["origin_command_id"]]
                origin_bout = next(
                    (event for event in origin.get("events") or [] if isinstance(event, dict)
                     and event.get("event_type") == "bout_of_madness"
                     and event.get("bout_id") == history["bout_id"]),
                    None,
                )
                persisted_bout = next(
                    (row for row in sanity.get("bouts_of_madness") or [] if isinstance(row, dict)
                     and row.get("bout_id") == history["bout_id"]),
                    None,
                )
                if not isinstance(origin_bout, dict) or not isinstance(persisted_bout, dict) or not _json_deep_equal(
                    origin_bout.get("backstory_amend_suggestion"),
                    persisted_bout.get("backstory_amend_suggestion"),
                ):
                    raise _state_error(
                        f"choice history {choice_id!r} diverges from canonical bout source"
                    )


def _validate_push_offer_evidence(
    campaign_dir: Path,
    state: dict[str, Any],
) -> None:
    records = _read_jsonl_records(
        campaign_dir / _PUSH_OFFER_EVIDENCE_LOG,
        label="canonical push offer evidence",
    )
    offer_ids = [
        command_id for command_id in state["applied_command_ids"]
        if state["result_snapshots"][command_id]["kind"] == "push_offer"
    ]
    if len(records) != len(offer_ids):
        raise _state_error("canonical push offer evidence length diverges")
    evidence_keys = {
        "record_type", "sequence", "actor", "command_id", "command_hash",
        "command_provenance", "choice_id", "command", "public_choice",
        "announced_consequence", "evidence_hash",
    }
    for sequence, (command_id, record) in enumerate(zip(offer_ids, records), 1):
        result = state["result_snapshots"][command_id]
        public_choice = result["pending_choice"]
        choice_id = public_choice["choice_id"]
        context = (
            state["pending_contexts"].get(choice_id)
            or state["choice_history"].get(choice_id)
        )
        command = context.get("offer_command") if isinstance(context, dict) else None
        provenance = state["command_provenance"][command_id]
        material = {
            key: _json_copy(value)
            for key, value in record.items()
            if key != "evidence_hash"
        }
        if (
            set(record) != evidence_keys
            or record.get("record_type") != "push_offer_evidence"
            or record.get("sequence") != sequence
            or record.get("command_id") != command_id
            or record.get("actor") != provenance["investigator_id"]
            or record.get("command_hash") != state["command_hashes"][command_id]
            or not _json_deep_equal(record.get("command_provenance"), provenance)
            or record.get("choice_id") != choice_id
            or not _json_deep_equal(record.get("command"), command)
            or not _json_deep_equal(record.get("public_choice"), public_choice)
            or not isinstance(command, dict)
            or not _json_deep_equal(
                record.get("announced_consequence"),
                command.get("payload", {}).get("announced_consequence"),
            )
            or record.get("evidence_hash") != _canonical_json_hash(material)
        ):
            raise _state_error(
                f"canonical push offer evidence for {command_id!r} diverges"
            )


def _validate_external_result_receipts(campaign_dir: Path, state: dict[str, Any]) -> None:
    records = _read_jsonl_records(
        campaign_dir / _RESULT_RECEIPT_LOG, label="canonical subsystem result ledger"
    )
    applied = state["applied_command_ids"]
    if len(records) != len(applied):
        raise _state_error("canonical subsystem result ledger length diverges")
    commands_by_id: dict[str, dict[str, Any]] = {}
    for index, (command_id, record) in enumerate(zip(applied, records), 1):
        expected_keys = {
            "record_type", "sequence", "command_id", "command_hash",
            "command_provenance", "choice_id", "result", "receipt_hash",
        }
        if set(record) != expected_keys or record.get("record_type") != "subsystem_result_receipt":
            raise _state_error("canonical subsystem result receipt has an invalid contract")
        receipt_hash = record.get("receipt_hash")
        material = {key: _json_copy(value) for key, value in record.items() if key != "receipt_hash"}
        if (
            record.get("sequence") != index
            or record.get("command_id") != command_id
            or receipt_hash != _canonical_json_hash(material)
            or record.get("command_hash") != state["command_hashes"][command_id]
            or not _json_deep_equal(record.get("command_provenance"), state["command_provenance"][command_id])
            or not _json_deep_equal(record.get("result"), state["result_snapshots"][command_id])
        ):
            raise _state_error(f"canonical result receipt {command_id!r} diverges")
        # Terminal command copies provide the exact command needed to recompute
        # the receipt's choice binding. Non-terminal commands bind through their
        # persisted public choice or null choice.
        command = next(
            (cmd for history in state["choice_history"].values()
             for cmd in history.get("terminal_commands", [])
             if isinstance(cmd, dict) and cmd.get("command_id") == command_id),
            {"command_id": command_id, "payload": {}},
        )
        commands_by_id[command_id] = command
        expected_choice = _result_choice_id(command, state["result_snapshots"][command_id], state)
        if record.get("choice_id") != expected_choice:
            raise _state_error(f"canonical result receipt {command_id!r} has wrong choice binding")
    receipts_by_id = {row["command_id"]: row for row in records}
    for choice_id, history in state["choice_history"].items():
        expected_hashes = [receipts_by_id[command_id]["receipt_hash"]
                           for command_id in history["terminal_command_ids"]]
        if history["terminal_result_receipt_hashes"] != expected_hashes:
            raise _state_error(f"choice history {choice_id!r} has wrong canonical receipt references")
    _validate_result_source_evidence(campaign_dir, state, commands_by_id)
    _validate_push_offer_evidence(campaign_dir, state)


def _load_state(campaign_dir: Path) -> dict[str, Any]:
    with _ExecutorStateDirectory(campaign_dir) as state_directory:
        encoded = state_directory.read_bytes()
    if encoded is None:
        return _default_state()
    try:
        raw = json.loads(encoded.decode("utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise _state_error(f"could not read valid JSON: {exc}") from exc
    if isinstance(raw, dict) and raw.get("schema_version") == 2:
        migrated = _migrate_schema_v2(raw)
        _write_executor_state(Path(campaign_dir), migrated)
        return migrated
    return _validate_state(raw)


def load_canonical_state_readonly(campaign_dir: Path | str) -> dict[str, Any]:
    """Read and validate schema-v3 executor state without recovery or migration.

    Audience gateways must never repair, migrate, or otherwise mutate private
    rule state merely to render a public snapshot.
    """
    campaign = Path(campaign_dir)
    with _ExecutorStateDirectory(campaign) as state_directory:
        encoded = state_directory.read_bytes()
    if encoded is None:
        return _default_state()
    try:
        raw = json.loads(encoded.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise _state_error(f"could not read valid JSON: {exc}") from exc
    state = _validate_state(raw)
    _validate_external_result_receipts(campaign, state)
    return _json_copy(state)


def project_player_pending_choice(campaign_dir: Path | str) -> dict[str, Any] | None:
    """Return the sole canonical player choice with a recursively exact contract."""
    state = load_canonical_state_readonly(campaign_dir)
    choices = state["pending_choices"]
    player_choices = [
        choice for choice in choices.values()
        if isinstance(choice, dict) and choice.get("responder") == "player"
    ]
    if not player_choices:
        return None
    if len(player_choices) != 1:
        raise _state_error("multiple player pending choices are not projectable")
    choice = player_choices[0]
    if set(choice) != PUBLIC_PENDING_CHOICE_KEYS:
        raise _state_error("public pending choice has an invalid root contract")
    options = choice.get("options")
    if (
        not isinstance(options, list)
        or not options
        or any(
            not isinstance(option, dict)
            or set(option) != {"action", "label"}
            or not isinstance(option.get("action"), str)
            or not option["action"].strip()
            or not isinstance(option.get("label"), str)
            or not option["label"].strip()
            for option in options
        )
    ):
        raise _state_error("public pending choice options have an invalid contract")
    return _json_copy(choice)


def _unsafe_transaction_path(relative: str, message: str) -> SubsystemExecutorError:
    return _error("unsafe_subsystem_transaction_path", relative, message)


class _AnchoredTransactionTarget:
    """No-follow access to one fixed transaction target below a campaign.

    Every parent component stays open while the target is accessed. Named
    parent identities are rechecked around mutations, so a concurrent rename
    plus symlink replacement cannot redirect rollback outside the campaign.
    """

    def __init__(self, campaign_dir: Path, relative: str) -> None:
        if not (
            _allowed_preimage_path(relative)
            or relative in {
                "logs/rolls.jsonl", "logs/time.jsonl", "logs/subsystem-results.jsonl",
                "logs/push-offers.jsonl",
            }
        ):
            raise _unsafe_transaction_path(relative, "target is not transaction-owned")
        directory_flag = getattr(os, "O_DIRECTORY", None)
        nofollow_flag = getattr(os, "O_NOFOLLOW", None)
        if directory_flag is None or nofollow_flag is None:
            raise _unsafe_transaction_path(
                relative,
                "runtime lacks required O_DIRECTORY/O_NOFOLLOW primitives",
            )
        if (
            not _TRANSACTION_DIR_FD_SUPPORTED
            or not _TRANSACTION_NOFOLLOW_STAT_SUPPORTED
        ):
            raise _unsafe_transaction_path(
                relative,
                "runtime lacks required dir_fd/follow_symlinks primitives",
            )

        self.relative = relative
        self.campaign_path = Path(campaign_dir).resolve()
        self._directory_flags = (
            os.O_RDONLY
            | directory_flag
            | nofollow_flag
            | getattr(os, "O_CLOEXEC", 0)
        )
        self.campaign_fd: int | None = None
        self.parent_fd: int | None = None
        self._opened_parent_fds: list[int] = []
        self._parent_entries: list[tuple[int, str, int, tuple[int, int]]] = []
        self._missing_parent: tuple[int, str] | None = None
        parts = Path(relative).parts
        self.leaf_name = parts[-1]
        try:
            self.campaign_fd = os.open(self.campaign_path, self._directory_flags)
            container_fd = self.campaign_fd
            for component in parts[:-1]:
                try:
                    child_fd = os.open(
                        component,
                        self._directory_flags,
                        dir_fd=container_fd,
                    )
                except FileNotFoundError:
                    self._missing_parent = (container_fd, component)
                    break
                try:
                    opened = os.fstat(child_fd)
                except Exception:
                    os.close(child_fd)
                    raise
                if not stat.S_ISDIR(opened.st_mode):
                    os.close(child_fd)
                    raise _unsafe_transaction_path(
                        relative,
                        f"parent component {component!r} is not a directory",
                    )
                identity = self._identity(opened)
                self._opened_parent_fds.append(child_fd)
                self._parent_entries.append(
                    (container_fd, component, child_fd, identity)
                )
                container_fd = child_fd
            else:
                self.parent_fd = container_fd
            self.verify_parents()
        except Exception as exc:
            self.close()
            if isinstance(exc, SubsystemExecutorError):
                raise
            raise _unsafe_transaction_path(
                relative,
                f"transaction parent could not be opened safely: {exc}",
            ) from exc

    def __enter__(self) -> "_AnchoredTransactionTarget":
        return self

    def __exit__(self, _exc_type, _exc, _tb) -> None:
        self.close()

    @staticmethod
    def _identity(info: os.stat_result) -> tuple[int, int]:
        return int(info.st_dev), int(info.st_ino)

    def verify_parents(self) -> None:
        assert self.campaign_fd is not None
        try:
            opened_campaign = os.fstat(self.campaign_fd)
            named_campaign = os.stat(self.campaign_path, follow_symlinks=False)
            if (
                not stat.S_ISDIR(opened_campaign.st_mode)
                or not stat.S_ISDIR(named_campaign.st_mode)
                or self._identity(opened_campaign) != self._identity(named_campaign)
            ):
                raise _unsafe_transaction_path(
                    self.relative,
                    "campaign root identity changed",
                )
            for container_fd, component, child_fd, identity in self._parent_entries:
                opened = os.fstat(child_fd)
                named = os.stat(
                    component,
                    dir_fd=container_fd,
                    follow_symlinks=False,
                )
                if (
                    not stat.S_ISDIR(opened.st_mode)
                    or not stat.S_ISDIR(named.st_mode)
                    or self._identity(opened) != identity
                    or self._identity(named) != identity
                ):
                    raise _unsafe_transaction_path(
                        self.relative,
                        f"parent component {component!r} changed during access",
                    )
            if self._missing_parent is not None:
                container_fd, component = self._missing_parent
                try:
                    os.stat(
                        component,
                        dir_fd=container_fd,
                        follow_symlinks=False,
                    )
                except FileNotFoundError:
                    pass
                else:
                    raise _unsafe_transaction_path(
                        self.relative,
                        f"missing parent component {component!r} appeared during access",
                    )
        except SubsystemExecutorError:
            raise
        except (OSError, TypeError) as exc:
            raise _unsafe_transaction_path(
                self.relative,
                f"transaction parent identity could not be verified: {exc}",
            ) from exc

    def _leaf_info(self) -> os.stat_result | None:
        if self.parent_fd is None:
            self.verify_parents()
            return None
        self.verify_parents()
        try:
            info = os.stat(
                self.leaf_name,
                dir_fd=self.parent_fd,
                follow_symlinks=False,
            )
        except FileNotFoundError:
            self.verify_parents()
            return None
        except (OSError, TypeError) as exc:
            raise _unsafe_transaction_path(
                self.relative,
                f"transaction target could not be inspected safely: {exc}",
            ) from exc
        if not stat.S_ISREG(info.st_mode):
            raise _unsafe_transaction_path(
                self.relative,
                "transaction target must be a regular file",
            )
        self.verify_parents()
        return info

    def _verify_leaf_identity(self, expected: os.stat_result | None) -> None:
        assert self.parent_fd is not None
        try:
            current = os.stat(
                self.leaf_name,
                dir_fd=self.parent_fd,
                follow_symlinks=False,
            )
        except FileNotFoundError:
            current = None
        except (OSError, TypeError) as exc:
            raise _unsafe_transaction_path(
                self.relative,
                f"transaction target identity could not be verified: {exc}",
            ) from exc
        if expected is None:
            if current is not None:
                raise _unsafe_transaction_path(
                    self.relative,
                    "transaction target appeared during access",
                )
            return
        if (
            current is None
            or not stat.S_ISREG(current.st_mode)
            or self._identity(current) != self._identity(expected)
        ):
            raise _unsafe_transaction_path(
                self.relative,
                "transaction target identity changed during access",
            )

    def read_bytes(self) -> bytes | None:
        info = self._leaf_info()
        if info is None:
            return None
        assert self.parent_fd is not None
        target_fd: int | None = None
        try:
            target_fd = os.open(
                self.leaf_name,
                os.O_RDONLY | getattr(os, "O_NOFOLLOW") | getattr(os, "O_CLOEXEC", 0),
                dir_fd=self.parent_fd,
            )
            opened = os.fstat(target_fd)
            if (
                not stat.S_ISREG(opened.st_mode)
                or self._identity(opened) != self._identity(info)
            ):
                raise _unsafe_transaction_path(
                    self.relative,
                    "transaction target changed while being opened",
                )
            chunks: list[bytes] = []
            while True:
                chunk = os.read(target_fd, 64 * 1024)
                if not chunk:
                    break
                chunks.append(chunk)
            self._verify_leaf_identity(info)
            self.verify_parents()
            return b"".join(chunks)
        except SubsystemExecutorError:
            raise
        except (OSError, TypeError) as exc:
            raise _unsafe_transaction_path(
                self.relative,
                f"transaction target could not be read safely: {exc}",
            ) from exc
        finally:
            if target_fd is not None:
                os.close(target_fd)

    def file_size(self) -> tuple[bool, int]:
        info = self._leaf_info()
        if info is None:
            return False, 0
        assert self.parent_fd is not None
        target_fd: int | None = None
        try:
            target_fd = os.open(
                self.leaf_name,
                os.O_RDONLY | getattr(os, "O_NOFOLLOW") | getattr(os, "O_CLOEXEC", 0),
                dir_fd=self.parent_fd,
            )
            opened = os.fstat(target_fd)
            if (
                not stat.S_ISREG(opened.st_mode)
                or self._identity(opened) != self._identity(info)
            ):
                raise _unsafe_transaction_path(
                    self.relative,
                    "transaction log changed while being opened",
                )
            self._verify_leaf_identity(info)
            self.verify_parents()
            return True, int(opened.st_size)
        except SubsystemExecutorError:
            raise
        except (OSError, TypeError) as exc:
            raise _unsafe_transaction_path(
                self.relative,
                f"transaction log size could not be read safely: {exc}",
            ) from exc
        finally:
            if target_fd is not None:
                os.close(target_fd)

    def write_bytes_atomic(self, payload: bytes) -> None:
        if self.parent_fd is None:
            raise _unsafe_transaction_path(
                self.relative,
                "transaction target parent is missing",
            )
        original = self._leaf_info()
        temp_name = f".{self.leaf_name}.{os.getpid()}.{time.time_ns()}.tmp"
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
                dir_fd=self.parent_fd,
            )
            view = memoryview(payload)
            while view:
                written = os.write(temp_fd, view)
                view = view[written:]
            os.fsync(temp_fd)
            os.close(temp_fd)
            temp_fd = None
            self.verify_parents()
            self._verify_leaf_identity(original)
            os.replace(
                temp_name,
                self.leaf_name,
                src_dir_fd=self.parent_fd,
                dst_dir_fd=self.parent_fd,
            )
            replaced = True
            os.fsync(self.parent_fd)
            self.verify_parents()
        except SubsystemExecutorError:
            raise
        except (OSError, TypeError) as exc:
            raise _unsafe_transaction_path(
                self.relative,
                f"transaction target could not be replaced safely: {exc}",
            ) from exc
        finally:
            if temp_fd is not None:
                os.close(temp_fd)
            if not replaced:
                try:
                    os.unlink(temp_name, dir_fd=self.parent_fd)
                except (FileNotFoundError, OSError, TypeError):
                    pass

    def unlink_if_exists(self) -> None:
        info = self._leaf_info()
        if info is None:
            return
        assert self.parent_fd is not None
        try:
            self.verify_parents()
            self._verify_leaf_identity(info)
            os.unlink(self.leaf_name, dir_fd=self.parent_fd)
            os.fsync(self.parent_fd)
            self.verify_parents()
        except SubsystemExecutorError:
            raise
        except (OSError, TypeError) as exc:
            raise _unsafe_transaction_path(
                self.relative,
                f"transaction target could not be removed safely: {exc}",
            ) from exc

    def truncate(self, expected_size: int) -> None:
        info = self._leaf_info()
        if info is None:
            raise _state_error(
                f"missing log required for inflight recovery: {self.relative!r}"
            )
        assert self.parent_fd is not None
        target_fd: int | None = None
        try:
            target_fd = os.open(
                self.leaf_name,
                os.O_RDWR | getattr(os, "O_NOFOLLOW") | getattr(os, "O_CLOEXEC", 0),
                dir_fd=self.parent_fd,
            )
            opened = os.fstat(target_fd)
            if (
                not stat.S_ISREG(opened.st_mode)
                or self._identity(opened) != self._identity(info)
            ):
                raise _unsafe_transaction_path(
                    self.relative,
                    "transaction log changed while being opened",
                )
            if int(opened.st_size) < expected_size:
                raise _state_error(
                    f"log {self.relative!r} is shorter than its pre-append offset"
                )
            self.verify_parents()
            self._verify_leaf_identity(info)
            os.ftruncate(target_fd, expected_size)
            os.fsync(target_fd)
            self.verify_parents()
        except SubsystemExecutorError:
            raise
        except (OSError, TypeError) as exc:
            raise _unsafe_transaction_path(
                self.relative,
                f"transaction log could not be truncated safely: {exc}",
            ) from exc
        finally:
            if target_fd is not None:
                os.close(target_fd)

    def close(self) -> None:
        for parent_fd in reversed(self._opened_parent_fds):
            os.close(parent_fd)
        self._opened_parent_fds.clear()
        if self.campaign_fd is not None:
            os.close(self.campaign_fd)
            self.campaign_fd = None
        self.parent_fd = None


def _capture_preimage(campaign_dir: Path, relative: str) -> dict[str, Any]:
    with _AnchoredTransactionTarget(campaign_dir, relative) as target:
        raw = target.read_bytes()
    if raw is None:
        return {"exists": False, "encoding": "base64", "data": None}
    try:
        raw.decode("utf-8")
    except UnicodeError as exc:
        raise _error(
            "subsystem_transaction_preflight_failed",
            relative,
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
        command["kind"] in SAN_MUTATION_COMMAND_KINDS
        and (
            command["kind"] != "sanity_check"
            or "san_loss_fail_expr" in command["payload"]
        )
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
        command["kind"] in ROLL_EVIDENCE_COMMAND_KINDS
        for command, _command_hash in commands_with_hashes
    )
    log_offsets: dict[str, dict[str, Any]] = {}
    log_relatives: list[str] = ["logs/subsystem-results.jsonl"]
    if any(command["kind"] == "push_offer" for command, _ in commands_with_hashes):
        log_relatives.append("logs/push-offers.jsonl")
    if has_roll_evidence:
        log_relatives.append("logs/rolls.jsonl")
    if structured_sanity:
        log_relatives.append("logs/time.jsonl")
    for relative in log_relatives:
        with _AnchoredTransactionTarget(campaign_dir, relative) as target:
            exists, size = target.file_size()
        log_offsets[relative] = {"exists": exists, "size": size}
    inflight = {
        "commands": [
            {
                "command_id": command["command_id"],
                "command_hash": command_hash,
            }
            for command, command_hash in commands_with_hashes
        ],
        "preimages": {
            relative: _capture_preimage(campaign_dir, relative)
            for relative in preimage_relatives
        },
        "log_offsets": log_offsets,
    }
    _validate_inflight(inflight)
    return inflight


def _restore_inflight_targets(campaign_dir: Path, inflight: dict[str, Any]) -> None:
    _validate_inflight(inflight)
    for relative, preimage in inflight["preimages"].items():
        with _AnchoredTransactionTarget(campaign_dir, relative) as target:
            if preimage["exists"]:
                raw = base64.b64decode(preimage["data"].encode("ascii"), validate=True)
                target.write_bytes_atomic(raw)
            else:
                target.unlink_if_exists()

    for relative, offset in inflight["log_offsets"].items():
        with _AnchoredTransactionTarget(campaign_dir, relative) as target:
            if not offset["exists"]:
                target.unlink_if_exists()
            else:
                target.truncate(int(offset["size"]))


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
    if command["kind"] == "sanity_check":
        if "alone" in payload and not isinstance(payload["alone"], bool):
            raise _error("invalid_command_payload", f"{base}.alone", "alone must be a boolean")
        if (
            "involuntary_kind" in payload
            and payload["involuntary_kind"] is not None
            and payload["involuntary_kind"] not in coc_sanity.INVOLUNTARY_KINDS
        ):
            raise _error(
                "invalid_command_payload",
                f"{base}.involuntary_kind",
                "involuntary_kind must be an explicit supported enum",
            )
        if "involuntary_summary" in payload and not isinstance(payload["involuntary_summary"], str):
            raise _error(
                "invalid_command_payload",
                f"{base}.involuntary_summary",
                "involuntary_summary must be a string",
            )
        if (
            "creature_type" in payload
            and payload["creature_type"] is not None
            and (
                not isinstance(payload["creature_type"], str)
                or not payload["creature_type"].strip()
            )
        ):
            raise _error(
                "invalid_command_payload",
                f"{base}.creature_type",
                "creature_type must be a non-empty structured ID",
            )
        if "module_bout_override" in payload:
            override = payload["module_bout_override"]
            if not isinstance(override, dict):
                raise _error(
                    "invalid_command_payload",
                    f"{base}.module_bout_override",
                    "module_bout_override must be an object",
                )
            if (
                "force_mode" in override
                and override.get("force_mode") not in coc_sanity.BOUT_MODES
            ):
                raise _error(
                    "invalid_command_payload",
                    f"{base}.module_bout_override.force_mode",
                    "force_mode must be real_time or summary",
                )
            if "result_description" in override and not isinstance(
                override["result_description"], str
            ):
                raise _error(
                    "invalid_command_payload",
                    f"{base}.module_bout_override.result_description",
                    "result_description must be a string",
                )
    if command["kind"] == "push_offer":
        original_id = payload.get("original_command_id")
        if not isinstance(original_id, str) or not _SAFE_ID.fullmatch(original_id):
            raise _error(
                "invalid_command_payload",
                f"{base}.original_command_id",
                "original_command_id must be a stable persisted command ID",
            )
        changed = payload.get("changed_method_evidence")
        if not isinstance(changed, dict) or set(changed) != {
            "changed", "source", "summary",
        }:
            raise _error(
                "invalid_command_payload",
                f"{base}.changed_method_evidence",
                "expected exactly changed, source, and summary",
            )
        if changed.get("changed") is not True:
            raise _error(
                "invalid_command_payload",
                f"{base}.changed_method_evidence.changed",
                "a push must use a genuinely changed method",
            )
        if changed.get("source") not in CHANGED_METHOD_SOURCES:
            raise _error(
                "invalid_command_payload",
                f"{base}.changed_method_evidence.source",
                "source must be a supported structured enum",
            )
        if not isinstance(changed.get("summary"), str) or not changed["summary"].strip():
            raise _error(
                "invalid_command_payload",
                f"{base}.changed_method_evidence.summary",
                "summary must be non-empty",
            )
        consequence = payload.get("announced_consequence")
        if (
            not isinstance(consequence, dict)
            or not {"summary"} <= set(consequence) <= {"summary", "effect"}
            or not isinstance(consequence.get("summary"), str)
            or not consequence["summary"].strip()
        ):
            raise _error(
                "invalid_command_payload",
                f"{base}.announced_consequence.summary",
                "Keeper-owned announced consequence requires a non-empty summary",
            )
        effect = consequence.get("effect")
        if effect is not None:
            if not isinstance(effect, dict) or effect.get("kind") not in {
                "fictional_position", "pressure_tick", "condition",
            }:
                raise _error(
                    "invalid_command_payload",
                    f"{base}.announced_consequence.effect",
                    "effect must use a supported structured kind",
                )
            kind = effect.get("kind")
            valid = (
                kind == "fictional_position"
                and set(effect) in ({"kind"}, {"kind", "severity"})
                and (
                    "severity" not in effect
                    or effect.get("severity") in {"minor", "serious", "critical"}
                )
            ) or (
                kind == "pressure_tick"
                and set(effect) == {"kind", "clock_id", "ticks"}
                and isinstance(effect.get("clock_id"), str)
                and bool(_SAFE_ID.fullmatch(effect["clock_id"]))
                and isinstance(effect.get("ticks"), int)
                and not isinstance(effect.get("ticks"), bool)
                and 1 <= effect["ticks"] <= 4
            ) or (
                kind == "condition"
                and set(effect) == {"kind", "condition_id"}
                and isinstance(effect.get("condition_id"), str)
                and bool(_SAFE_ID.fullmatch(effect["condition_id"]))
            )
            if not valid:
                raise _error(
                    "invalid_command_payload",
                    f"{base}.announced_consequence.effect",
                    "effect does not match its exact typed payload contract",
                )
        supplied_context = payload.get("resolution_context")
        if supplied_context is not None and not isinstance(supplied_context, dict):
            raise _error(
                "invalid_command_payload",
                f"{base}.resolution_context",
                "resolution_context must be an object when supplied",
            )
    if command["kind"] in {"push_confirm", "push_resolve"}:
        choice_id = payload.get("choice_id")
        if not isinstance(choice_id, str) or not _SAFE_ID.fullmatch(choice_id):
            raise _error(
                "invalid_command_payload",
                f"{base}.choice_id",
                "choice_id must be a stable ID",
            )
        if payload.get("responder") != "player":
            raise _error(
                "invalid_command_payload",
                f"{base}.responder",
                "push lifecycle responder must be player",
            )
        revision = payload.get("revision")
        if isinstance(revision, bool) or not isinstance(revision, int) or revision < 0:
            raise _error(
                "invalid_command_payload",
                f"{base}.revision",
                "revision must be a non-negative integer",
            )
        if payload.get("action") not in {"confirm", "cancel"}:
            raise _error(
                "invalid_command_payload",
                f"{base}.action",
                "push action must be confirm or cancel",
            )
        terminal_ids = payload.get("terminal_command_ids")
        if (
            not isinstance(terminal_ids, list)
            or not terminal_ids
            or not all(isinstance(item, str) and _SAFE_ID.fullmatch(item) for item in terminal_ids)
        ):
            raise _error(
                "invalid_command_payload",
                f"{base}.terminal_command_ids",
                "terminal command IDs must be stable IDs",
            )
    if command["kind"] in BOUT_COMMAND_KINDS:
        choice_id = payload.get("choice_id")
        if not isinstance(choice_id, str) or not _SAFE_ID.fullmatch(choice_id):
            raise _error("invalid_command_payload", f"{base}.choice_id", "choice_id must be a stable ID")
        if payload.get("responder") != "keeper":
            raise _error("invalid_command_payload", f"{base}.responder", "bout responder must be keeper")
        revision = payload.get("revision")
        if isinstance(revision, bool) or not isinstance(revision, int) or revision < 0:
            raise _error("invalid_command_payload", f"{base}.revision", "revision must be a non-negative integer")
        expected_action = "tick" if command["kind"] == "bout_tick" else "end"
        if payload.get("action") != expected_action:
            raise _error("invalid_command_payload", f"{base}.action", f"{command['kind']} requires action {expected_action}")
        terminal_ids = payload.get("terminal_command_ids")
        if not isinstance(terminal_ids, list) or terminal_ids != [command["command_id"]]:
            raise _error("invalid_command_payload", f"{base}.terminal_command_ids", "bout action must name its sole canonical command ID")


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
        and (
            command["kind"] in BOUT_COMMAND_KINDS
            or (
                command["kind"] == "sanity_check"
                and "san_loss_fail_expr" in command["payload"]
            )
        )
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


def _resume_ids(choice_id: str, revision: int, action: str) -> dict[str, str]:
    material = json.dumps(
        {"choice_id": choice_id, "revision": revision, "action": action},
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    digest = hashlib.sha256(material).hexdigest()
    return {
        "decision_id": f"resume-{digest[:32]}",
        "confirm_command_id": f"resume:{digest}:confirm",
        "resolve_command_id": f"resume:{digest}:resolve",
    }


def _push_resume_plan_from_state(
    state: dict[str, Any],
    investigator_id: str,
    response: Any,
) -> dict[str, Any]:
    if not isinstance(response, dict):
        raise _error(
            "invalid_pending_choice_response",
            "pending_choice_response",
            "response must be an object",
        )
    choice_id = response.get("choice_id")
    if not isinstance(choice_id, str) or not _SAFE_ID.fullmatch(choice_id):
        raise _error(
            "pending_choice_not_found",
            "pending_choice_response.choice_id",
            "choice_id does not identify a canonical pending choice",
        )
    active_context = state["pending_contexts"].get(choice_id)
    historical_context = state["choice_history"].get(choice_id)
    context = active_context or historical_context
    if not isinstance(context, dict):
        raise _error(
            "pending_choice_not_found",
            "pending_choice_response.choice_id",
            "choice is neither active nor an exact replayable history entry",
        )
    offer_id = context["offer_command_id"]
    public_choice = state["result_snapshots"][offer_id]["pending_choice"]
    if context.get("investigator_id") != investigator_id:
        raise _error(
            "wrong_pending_choice_responder",
            "pending_choice_response.responder",
            "choice belongs to a different investigator",
        )
    responder = response.get("responder")
    if responder != public_choice.get("responder"):
        raise _error(
            "wrong_pending_choice_responder",
            "pending_choice_response.responder",
            "response does not match the canonical choice responder",
        )
    revision = response.get("revision")
    if revision != public_choice.get("revision"):
        raise _error(
            "stale_pending_choice_response",
            "pending_choice_response.revision",
            "response revision is stale or ahead of the canonical choice",
        )
    action = response.get("action")
    allowed_actions = {
        str(option.get("action"))
        for option in public_choice.get("options") or []
        if isinstance(option, dict) and option.get("action")
    }
    if action not in allowed_actions:
        raise _error(
            "invalid_pending_choice_action",
            "pending_choice_response.action",
            "action is not one of the canonical choice options",
        )
    required_keys = {"choice_id", "responder", "revision", "action"}
    changed_method = (
        _json_copy(context["changed_method_evidence"])
        if action == "confirm"
        else None
    )
    if set(response) != required_keys:
        raise _error(
            "invalid_pending_choice_response",
            "pending_choice_response",
            "response contains missing or unsupported fields",
        )
    if historical_context is not None:
        if (
            historical_context.get("terminal_action") != action
            or historical_context.get("terminal_revision") != revision
            or not _json_deep_equal(
                historical_context.get("response_changed_method_evidence"),
                changed_method,
            )
        ):
            raise _error(
                "stale_pending_choice_response",
                "pending_choice_response",
                "choice was already consumed by a different response",
            )

    ids = _resume_ids(choice_id, int(revision), str(action))
    terminal_ids = [ids["confirm_command_id"]]
    if action == "confirm":
        terminal_ids.append(ids["resolve_command_id"])
    common: dict[str, Any] = {
        "choice_id": choice_id,
        "responder": responder,
        "revision": revision,
        "action": action,
        "terminal_command_ids": terminal_ids,
    }
    rules_requests: list[dict[str, Any]] = [{
        "command_id": ids["confirm_command_id"],
        "kind": "push_confirm",
        **_json_copy(common),
    }]
    if action == "confirm":
        rules_requests.append({
            "command_id": ids["resolve_command_id"],
            "kind": "push_resolve",
            **_json_copy(common),
            "confirm_command_id": ids["confirm_command_id"],
        })
    resolution = _json_copy(context.get("resolution_context") or {})
    plan: dict[str, Any] = {
        "decision_id": ids["decision_id"],
        "scene_action": str(resolution.get("scene_action") or "SUBSYSTEM"),
        "rules_requests": rules_requests,
        "clue_policy": _json_copy(resolution.get("clue_policy") or {}),
        "narrative_directives": _json_copy(
            resolution.get("narrative_directives") or {}
        ),
        "rule_signals": _json_copy(resolution.get("rule_signals") or {}),
        "pressure_moves": [],
        "memory_writes": [],
        "push_continuation": {
            "choice_id": choice_id,
            "action": action,
            "revision": revision,
            "announced_consequence": _json_copy(context["announced_consequence"]),
        },
    }
    if isinstance(resolution.get("turn_input"), dict):
        plan["turn_input"] = _json_copy(resolution["turn_input"])
    return plan


def _bout_resume_plan_from_state(
    state: dict[str, Any],
    investigator_id: str,
    response: Any,
) -> dict[str, Any]:
    if not isinstance(response, dict):
        raise _error("invalid_pending_choice_response", "pending_choice_response", "response must be an object")
    choice_id = response.get("choice_id")
    if not isinstance(choice_id, str) or not _SAFE_ID.fullmatch(choice_id):
        raise _error("pending_choice_not_found", "pending_choice_response.choice_id", "choice_id does not identify a canonical pending choice")
    active = state["pending_contexts"].get(choice_id)
    historical = state["choice_history"].get(choice_id)
    context = active or historical
    if not isinstance(context, dict) or context.get("kind") != "bout_keeper_action":
        raise _error("pending_choice_not_found", "pending_choice_response.choice_id", "choice is not a Keeper bout action")
    public_choice = (
        state["pending_choices"].get(choice_id)
        if active is not None
        else historical.get("public_choice")
    )
    if context.get("investigator_id") != investigator_id:
        raise _error("wrong_pending_choice_responder", "pending_choice_response.responder", "choice belongs to another investigator")
    if response.get("responder") != public_choice.get("responder"):
        raise _error("wrong_pending_choice_responder", "pending_choice_response.responder", "response does not match the canonical choice responder")
    revision = response.get("revision")
    if revision != public_choice.get("revision"):
        raise _error("stale_pending_choice_response", "pending_choice_response.revision", "response revision is stale or ahead")
    action = response.get("action")
    if action not in {"tick", "end"}:
        raise _error("invalid_pending_choice_action", "pending_choice_response.action", "bout action must be tick or end")
    if set(response) != {"choice_id", "responder", "revision", "action"}:
        raise _error("invalid_pending_choice_response", "pending_choice_response", "response contains missing or unsupported fields")
    if historical is not None and (
        historical.get("terminal_action") != action
        or historical.get("terminal_revision") != revision
    ):
        raise _error("stale_pending_choice_response", "pending_choice_response", "choice was already consumed by another action")
    ids = _resume_ids(choice_id, int(revision), str(action))
    command_id = ids["confirm_command_id"]
    kind = "bout_tick" if action == "tick" else "bout_end"
    return {
        "decision_id": ids["decision_id"],
        "scene_action": "SUBSYSTEM",
        "rules_requests": [{
            "command_id": command_id,
            "kind": kind,
            "choice_id": choice_id,
            "responder": "keeper",
            "revision": revision,
            "action": action,
            "terminal_command_ids": [command_id],
        }],
        "clue_policy": {},
        "narrative_directives": {},
        "rule_signals": {},
        "pressure_moves": [],
        "memory_writes": [],
        "bout_continuation": {
            "choice_id": choice_id,
            "bout_id": context["bout_id"],
            "revision": revision,
            "action": action,
        },
    }


def _pending_resume_plan_from_state(
    state: dict[str, Any], investigator_id: str, response: Any
) -> dict[str, Any]:
    choice_id = response.get("choice_id") if isinstance(response, dict) else None
    context = (
        state["pending_contexts"].get(choice_id)
        or state["choice_history"].get(choice_id)
        if isinstance(choice_id, str)
        else None
    )
    if isinstance(context, dict) and context.get("kind") == "bout_keeper_action":
        return _bout_resume_plan_from_state(state, investigator_id, response)
    return _push_resume_plan_from_state(state, investigator_id, response)


def plan_from_pending_choice_response(
    campaign_dir: Path | str,
    investigator_id: str,
    response: dict[str, Any],
) -> dict[str, Any]:
    """Compile a typed response into the sole canonical resume plan."""
    if not isinstance(investigator_id, str) or not _SAFE_ID.fullmatch(investigator_id):
        raise _error(
            "invalid_investigator_id",
            "investigator_id",
            "expected a stable safe ID",
        )
    campaign = Path(campaign_dir)
    if not isinstance(response, dict):
        raise _error(
            "invalid_pending_choice_response",
            "pending_choice_response",
            "response must be an object",
        )
    state = _load_state(campaign)
    # Validate against the pre-transaction canonical indexes before recovery.
    # A malformed/stale response must never authorize preimage restoration or
    # log truncation merely by being presented to this read/compile boundary.
    candidate = _pending_resume_plan_from_state(state, investigator_id, response)
    recovered = _recover_inflight(campaign, state)
    _validate_external_result_receipts(campaign, recovered)
    resolved = _pending_resume_plan_from_state(recovered, investigator_id, response)
    if not _json_deep_equal(candidate, resolved):
        raise _error(
            "pending_choice_changed_during_recovery",
            "pending_choice_response",
            "canonical pending choice changed during inflight recovery",
        )
    return resolved


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
        explicit_command_id = request.get("command_id")
        command_id = (
            str(explicit_command_id)
            if explicit_command_id is not None
            else f"{decision_id}-rule-{index}"
        )
        payload = {
            key: _json_copy(value)
            for key, value in request.items()
            if key not in {"kind", "command_id", "phase"}
        }
        payload.setdefault("decision_id", plan.get("decision_id"))
        if kind in RNG_CONSUMING_COMMAND_KINDS:
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
        state = _load_state(campaign)
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
                    if expected_command["kind"] in CHARACTER_REQUIRED_COMMAND_KINDS
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
        recovered = _recover_inflight(campaign, state)
        _validate_external_result_receipts(campaign, recovered)
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
    _validate_external_result_receipts(campaign, state)
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

    event_start = len(session.events)
    source = str(payload.get("source") or payload.get("reason") or "encountering the unnatural")
    creature_type = payload.get("creature_type")
    event = session.sanity_check(
        source=source,
        san_loss_success=int(payload.get("san_loss_success", 0)),
        san_loss_fail_expr=str(payload.get("san_loss_fail_expr", "1")),
        involuntary_kind=payload.get("involuntary_kind"),
        involuntary_summary=str(payload.get("involuntary_summary") or ""),
        alone=bool(payload.get("alone", False)),
        module_bout_override=_json_copy(payload.get("module_bout_override")),
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
    session_events: list[dict[str, Any]] = []
    for row in session.events[event_start:]:
        if not isinstance(row, dict):
            continue
        raw_payload = row.get("payload")
        normalized_payload = (
            _json_copy(raw_payload)
            if isinstance(raw_payload, dict)
            else {"summary": str(raw_payload or "")}
        )
        session_events.append({
            "event_id": row.get("event_id"),
            **normalized_payload,
            "event_type": row.get("type"),
        })
    return {
        "san_before": san_before,
        "san_loss": san_loss,
        "san_after": san_after,
        "outcome": outcome,
        "roll": san_roll.get("roll", 0),
        "bout_triggered": bool(session.bout_active or session.temporary_insane),
        "source": source,
        "san_trigger_id": payload.get("san_trigger_id"),
        "session_events": session_events,
        "bout_active": bool(session.bout_active),
        "active_bout_id": session.active_bout_id,
        "bout_rounds_remaining": int(session.bout_rounds_remaining),
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
            "resolution_context": _json_copy(payload.get("resolution_context") or {}),
            "_session_events": settled["session_events"],
            "_bout_state": {
                "active": settled["bout_active"],
                "bout_id": settled["active_bout_id"],
                "remaining_rounds": settled["bout_rounds_remaining"],
            },
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
            "resolution_context": _json_copy(payload.get("resolution_context") or {}),
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
        "resolution_context": _json_copy(payload.get("resolution_context") or {}),
    }


def _dispatch(
    campaign_dir: Path,
    character: dict[str, Any] | None,
    investigator_id: str,
    command: dict[str, Any],
    rng: random.Random,
    state: dict[str, Any],
) -> dict[str, Any]:
    command_id = command["command_id"]
    kind = command["kind"]
    if kind in BOUT_COMMAND_KINDS:
        assert character is not None
        payload = command["payload"]
        choice_id = payload["choice_id"]
        choice = state["pending_choices"].pop(choice_id)
        context = state["pending_contexts"].pop(choice_id)
        characteristics = character.get("characteristics") or {}
        skills = character.get("skills") or {}
        session = coc_sanity.SanitySession.load(
            campaign_dir,
            investigator_id,
            int_value=int(characteristics.get("INT", 50)),
            rng=rng,
            cm_value=int(skills.get("Cthulhu Mythos", 0)),
        )
        if (
            not session.bout_active
            or session.active_bout_id != context["bout_id"]
            or session.bout_rounds_remaining != context["remaining_rounds"]
        ):
            raise _error(
                "bout_state_mismatch",
                "save/sanity.json",
                "canonical pending bout does not match persisted sanity state",
            )
        event_start = len(session.events)
        events: list[dict[str, Any]] = []
        if kind == "bout_tick":
            ticked = session.tick_bout_round()
            events.append({
                "event_type": "bout_tick",
                "bout_id": context["bout_id"],
                "remaining_rounds": int(ticked["bout_rounds_remaining"]),
                "source_command_id": command_id,
            })
        else:
            session.end_bout()
        session.save(campaign_dir, strict_mirror=True)
        for row in session.events[event_start:]:
            raw_payload = row.get("payload") if isinstance(row, dict) else None
            normalized_payload = _json_copy(raw_payload) if isinstance(raw_payload, dict) else {}
            events.append({
                "event_id": row.get("event_id") if isinstance(row, dict) else None,
                **normalized_payload,
                "event_type": row.get("type") if isinstance(row, dict) else None,
            })
        pending_choice = None
        status = "completed"
        if session.bout_active:
            next_revision = int(choice["revision"]) + 1
            pending_choice = {
                "choice_id": choice_id,
                "kind": "bout_keeper_action",
                "command_id": command_id,
                "responder": "keeper",
                "revision": next_revision,
                "prompt": "Advance or end the active Keeper-controlled bout?",
                "options": _json_copy(PENDING_CHOICE_CONTRACTS["bout_tick"]["options"]),
            }
            state["pending_contexts"][choice_id] = {
                **_json_copy(context),
                "revision": next_revision,
                "remaining_rounds": int(session.bout_rounds_remaining),
            }
            status = "pending_choice"
        else:
            state["choice_history"][choice_id] = {
                **_json_copy(context),
                "public_choice": _json_copy(choice),
                "terminal_action": payload["action"],
                "terminal_revision": payload["revision"],
                "terminal_command_ids": _json_copy(payload["terminal_command_ids"]),
                "terminal_commands": [],
                "terminal_results": [],
                "terminal_result_receipt_hashes": [],
            }
        return {
            "command_id": command_id,
            "kind": kind,
            "status": status,
            "events": events,
            "pending_choice": pending_choice,
            "state_refs": [
                f"save/sanity.json#{context['bout_id']}",
                f"save/investigator-state/{investigator_id}.json#bout_active",
                f"save/subsystem-state.json#pending_contexts/{choice_id}"
                if pending_choice is not None
                else f"save/subsystem-state.json#choice_history/{choice_id}",
            ],
        }
    if kind == "push_confirm":
        payload = command["payload"]
        choice_id = payload["choice_id"]
        choice = state["pending_choices"].pop(choice_id)
        context = state["pending_contexts"].pop(choice_id)
        action = payload["action"]
        history = {
            **_json_copy(context),
            "public_choice": _json_copy(choice),
            "terminal_action": action,
            "terminal_revision": payload["revision"],
            "terminal_command_ids": _json_copy(payload["terminal_command_ids"]),
            "terminal_commands": [],
            "terminal_results": [],
            "terminal_result_receipt_hashes": [],
            "response_changed_method_evidence": (
                _json_copy(context["changed_method_evidence"])
                if action == "confirm"
                else None
            ),
        }
        state["choice_history"][choice_id] = history
        events: list[dict[str, Any]] = []
        status = "cancelled"
        if action == "confirm":
            status = "completed"
            events.append({
                "event_type": "push_confirmed",
                "kind": "push_confirm",
                "choice_id": choice_id,
                "revision": payload["revision"],
                "source_command_id": command_id,
                "original_command_id": context["origin_command_id"],
                "changed_method_evidence": _json_copy(
                    context["changed_method_evidence"]
                ),
            })
        return {
            "command_id": command_id,
            "kind": kind,
            "status": status,
            "events": events,
            "pending_choice": None,
            "state_refs": [
                f"save/subsystem-state.json#choice_history/{choice_id}"
            ],
        }
    if kind == "push_resolve":
        payload = command["payload"]
        choice_id = payload["choice_id"]
        history = state["choice_history"][choice_id]
        original = history["original_roll"]
        target = int(original["target"])
        difficulty = str(original.get("difficulty") or "regular")
        modifier = int(original.get("bonus_penalty_dice", 0) or 0)
        resolved = coc_roll.percentile_check(
            target,
            difficulty=difficulty,
            bonus=max(0, modifier),
            penalty=max(0, -modifier),
            rng=rng,
        )
        outcome = str(resolved.get("outcome") or "failure")
        event = {
            "roll_id": str(payload.get("roll_id") or command_id),
            "decision_id": payload.get("decision_id"),
            "kind": original.get("kind"),
            "skill": original.get("skill"),
            "target": target,
            "difficulty": difficulty,
            "reason": original.get("reason"),
            "request_id": original.get("request_id"),
            "bonus_penalty_dice": modifier,
            "roll": resolved.get("roll"),
            "effective_target": resolved.get("effective_target"),
            "outcome": outcome,
            "success": outcome in SUCCESS_OUTCOMES,
            "roll_contract": _json_copy(original.get("roll_contract")),
            "resolution_context": _json_copy(history["resolution_context"]),
            "pushed": True,
            "push_gate": {
                "method_changed": True,
                "consequence_announced": True,
                "player_confirmed": True,
            },
            "original_command_id": history["origin_command_id"],
            "original_roll_id": original.get("roll_id"),
            "announced_consequence": _json_copy(history["announced_consequence"]),
            "changed_method_evidence": _json_copy(
                history["response_changed_method_evidence"]
            ),
            "source_command_id": command_id,
        }
        return {
            "command_id": command_id,
            "kind": kind,
            "status": "completed",
            "events": [event],
            "pending_choice": None,
            "state_refs": [
                f"logs/rolls.jsonl#{command_id}",
                f"save/subsystem-state.json#choice_history/{choice_id}",
            ],
        }
    if kind == "push_offer":
        choice_id = _push_choice_id(command_id)
        origin = state["result_snapshots"][command["payload"]["original_command_id"]]
        original_roll = origin["events"][0]
        skill = str(original_roll.get("skill") or "ordinary")
        consequence_summary = str(
            command["payload"]["announced_consequence"]["summary"]
        )
        choice = {
            "choice_id": choice_id,
            "kind": "push_confirm",
            "command_id": command_id,
            "responder": "player",
            "revision": 0,
            "prompt": (
                f"Push the failed {skill} roll? Failure consequence: "
                f"{consequence_summary}"
            ),
            "options": _json_copy(PENDING_CHOICE_CONTRACTS["push_offer"]["options"]),
        }
        return {
            "command_id": command_id,
            "kind": kind,
            "status": "pending_choice",
            "events": [],
            "pending_choice": choice,
            "state_refs": [
                f"save/subsystem-state.json#pending_choices/{choice_id}",
                f"save/subsystem-state.json#pending_contexts/{choice_id}",
            ],
        }
    assert character is not None
    event = _roll_result(campaign_dir, character, investigator_id, command, rng)
    session_events = event.pop("_session_events", [])
    bout_state = event.pop("_bout_state", None)
    refs = [f"logs/rolls.jsonl#{command_id}"]
    if kind == "sanity_check" and "san_loss_fail_expr" in command["payload"]:
        refs.extend([
            f"save/sanity.json#{investigator_id}",
            f"save/investigator-state/{investigator_id}.json#current_san",
        ])
    pending_choice = None
    status = "completed"
    if kind == "sanity_check" and isinstance(bout_state, dict) and bout_state.get("active"):
        choice_id = _bout_choice_id(command_id)
        pending_choice = {
            "choice_id": choice_id,
            "kind": "bout_keeper_action",
            "command_id": command_id,
            "responder": "keeper",
            "revision": 0,
            "prompt": "Advance or end the active Keeper-controlled bout?",
            "options": _json_copy(PENDING_CHOICE_CONTRACTS["sanity_check"]["options"]),
        }
        state["pending_contexts"][choice_id] = {
            "choice_id": choice_id,
            "kind": "bout_keeper_action",
            "investigator_id": investigator_id,
            "character_id": character["id"],
            "origin_command_id": command_id,
            "bout_id": bout_state["bout_id"],
            "revision": 0,
            "remaining_rounds": int(bout_state["remaining_rounds"]),
        }
        refs.extend([
            f"save/subsystem-state.json#pending_choices/{choice_id}",
            f"save/subsystem-state.json#pending_contexts/{choice_id}",
        ])
        status = "pending_choice"
    return {
        "command_id": command_id,
        "kind": kind,
        "status": status,
        "events": [event, *session_events],
        "pending_choice": pending_choice,
        "state_refs": refs,
    }


def _push_pending_context(
    state: dict[str, Any],
    command: dict[str, Any],
    *,
    investigator_id: str,
    character: dict[str, Any],
    choice: dict[str, Any],
) -> dict[str, Any]:
    payload = command["payload"]
    origin_id = payload["original_command_id"]
    origin_snapshot = state["result_snapshots"][origin_id]
    origin_provenance = state["command_provenance"][origin_id]
    original_roll = origin_snapshot["events"][0]
    return {
        "choice_id": choice["choice_id"],
        "kind": choice["kind"],
        "investigator_id": investigator_id,
        "character_id": character["id"],
        "origin_command_id": origin_id,
        "offer_command_id": command["command_id"],
        "revision": choice["revision"],
        "original_roll": _json_copy(original_roll),
        "changed_method_evidence": _json_copy(payload["changed_method_evidence"]),
        "announced_consequence": _json_copy(payload["announced_consequence"]),
        "resolution_context": _json_copy(original_roll.get("resolution_context") or {}),
        "origin_decision_id": origin_provenance.get("decision_id"),
        "offer_command": _json_copy(command),
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


def _append_result_receipt(campaign_dir: Path, receipt: dict[str, Any]) -> None:
    """Append an independently persisted canonical execution receipt.

    This is an integrity boundary against coordinated mutation of duplicated
    state fields, not a cryptographic authenticity claim against an actor that
    can rewrite both the state file and the trusted append-only log.
    """
    path = campaign_dir / _RESULT_RECEIPT_LOG
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(receipt, ensure_ascii=False, sort_keys=True) + "\n")
        handle.flush()
        os.fsync(handle.fileno())


def _append_push_offer_evidence(
    campaign_dir: Path, evidence: dict[str, Any]
) -> None:
    path = campaign_dir / _PUSH_OFFER_EVIDENCE_LOG
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(evidence, ensure_ascii=False, sort_keys=True) + "\n")
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

    # Preserve the canonical duplicate-scope error above before applying the
    # stricter atomic ordering rule to otherwise valid single-choice batches.
    for position, (command, _command_hash) in enumerate(commands_with_hashes):
        kind = command["kind"]
        may_create_pending = (
            kind in {"push_offer", "bout_tick"}
            or (
                kind == "sanity_check"
                and "san_loss_fail_expr" in command["payload"]
            )
        )
        if may_create_pending and position != len(commands_with_hashes) - 1:
            raise _error(
                "pending_choice_must_end_batch",
                f"commands[{position}]",
                "a command that may create a global pending choice must be the final new command",
            )


def _push_origin_in_use(state: dict[str, Any], origin_command_id: str) -> bool:
    for context in list(state.get("pending_contexts", {}).values()) + list(
        state.get("choice_history", {}).values()
    ):
        if isinstance(context, dict) and context.get("origin_command_id") == origin_command_id:
            return True
    return False


def _preflight_push_offers(
    commands_with_hashes: list[tuple[dict[str, Any], str]],
    state: dict[str, Any],
    *,
    investigator_id: str,
    character: dict[str, Any] | None,
) -> None:
    for index, (command, _command_hash) in enumerate(commands_with_hashes):
        if command["kind"] != "push_offer":
            continue
        assert character is not None
        payload = command["payload"]
        origin_id = payload["original_command_id"]
        path = f"commands[{index}].payload.original_command_id"
        snapshot = state["result_snapshots"].get(origin_id)
        provenance = state["command_provenance"].get(origin_id)
        if not isinstance(snapshot, dict) or not isinstance(provenance, dict):
            raise _error(
                "push_origin_not_found",
                path,
                "push offer must reference a persisted original result",
            )
        if (
            provenance.get("investigator_id") != investigator_id
            or provenance.get("character_id") != character.get("id")
        ):
            raise _error(
                "push_origin_actor_mismatch",
                path,
                "original roll belongs to a different investigator or character",
            )
        if snapshot.get("kind") not in {"skill_check", "characteristic_check"}:
            raise _error(
                "push_origin_ineligible",
                path,
                "only ordinary skill or characteristic checks may be pushed",
            )
        events = snapshot.get("events") or []
        if len(events) != 1 or not isinstance(events[0], dict):
            raise _error(
                "push_origin_incomplete",
                path,
                "original roll evidence is incomplete",
            )
        original = events[0]
        outcome = str(original.get("outcome") or "")
        if outcome == "fumble":
            raise _error(
                "push_origin_fumble",
                path,
                "a fumbled roll cannot be pushed",
            )
        if original.get("success") is not False or outcome != "failure":
            raise _error(
                "push_origin_not_failed",
                path,
                "push origin must be an ordinary failed roll",
            )
        contract = original.get("roll_contract")
        policy = contract.get("push_policy") if isinstance(contract, dict) else None
        if not isinstance(policy, dict) or policy.get("eligible") is not True:
            raise _error(
                "push_origin_ineligible",
                path,
                "persisted roll contract does not explicitly permit a push",
            )
        if _push_origin_in_use(state, origin_id):
            raise _error(
                "push_origin_already_used",
                path,
                "the original roll has already been offered or consumed",
            )
        origin_context = original.get("resolution_context") or {}
        if not isinstance(origin_context, dict):
            raise _error(
                "push_origin_incomplete",
                path,
                "original roll lacks structured resolution context",
            )
        supplied_context = payload.get("resolution_context")
        if supplied_context is not None and not _json_deep_equal(
            supplied_context, origin_context
        ):
            raise _error(
                "push_origin_context_mismatch",
                f"commands[{index}].payload.resolution_context",
                "offer cannot override the persisted origin resolution context",
            )


def _preflight_pending_resolution_batch(
    state: dict[str, Any],
    commands_with_hashes: list[tuple[dict[str, Any], str]],
    *,
    investigator_id: str,
) -> bool:
    if not state["pending_choices"] or not commands_with_hashes:
        return False
    commands = [command for command, _command_hash in commands_with_hashes]
    first = commands[0]
    if first["kind"] not in {"push_confirm", "bout_tick", "bout_end"}:
        return False
    payload = first["payload"]
    response = {
        "choice_id": payload.get("choice_id"),
        "responder": payload.get("responder"),
        "revision": payload.get("revision"),
        "action": payload.get("action"),
    }
    expected_plan = _pending_resume_plan_from_state(state, investigator_id, response)
    expected_commands = commands_from_rules_requests(expected_plan)
    if not _json_deep_equal(commands, expected_commands):
        raise _error(
            "invalid_pending_resolution_batch",
            "commands",
            "submitted commands do not exactly match the canonical pending response plan",
        )
    return True


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
    needs_character = any(
        command["kind"] in CHARACTER_REQUIRED_COMMAND_KINDS
        for command in validated
    )
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

    _validate_external_result_receipts(campaign, state)

    new_commands_with_hashes = [
        (command, command_hash)
        for command, command_hash in zip(validated, hashes)
        if command["command_id"] not in applied
    ]
    _preflight_push_offers(
        new_commands_with_hashes,
        state,
        investigator_id=investigator_id,
        character=character,
    )
    resolving_pending = _preflight_pending_resolution_batch(
        state,
        new_commands_with_hashes,
        investigator_id=investigator_id,
    )
    if state["pending_choices"] and new_commands_with_hashes and not resolving_pending:
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
            result = _dispatch(
                campaign,
                character,
                investigator_id,
                command,
                rng,
                next_state,
            )
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
                if command["kind"] == "push_offer":
                    assert character is not None
                    next_state["pending_contexts"][pending_choice["choice_id"]] = (
                        _push_pending_context(
                            next_state,
                            command,
                            investigator_id=investigator_id,
                            character=character,
                            choice=pending_choice,
                        )
                    )

        current_commands = {
            command["command_id"]: command for command, _result in new_results
        }
        receipt_records = {
            command["command_id"]: _result_receipt_record(
                next_state["applied_command_ids"].index(command["command_id"]) + 1,
                command,
                result,
                next_state,
            )
            for command, result in new_results
        }
        existing_offer_count = sum(
            1 for command_id in state["applied_command_ids"]
            if state["result_snapshots"][command_id]["kind"] == "push_offer"
        )
        push_offer_evidence: list[dict[str, Any]] = []
        for command, result in new_results:
            if command["kind"] == "push_offer":
                push_offer_evidence.append(
                    _push_offer_evidence_record(
                        existing_offer_count + len(push_offer_evidence) + 1,
                        command,
                        result,
                        next_state,
                    )
                )
        for history_entry in next_state["choice_history"].values():
            if not isinstance(history_entry, dict):
                continue
            terminal_ids = history_entry.get("terminal_command_ids")
            if history_entry.get("terminal_commands") != [] or not isinstance(
                terminal_ids, list
            ):
                continue
            if all(command_id in current_commands for command_id in terminal_ids):
                history_entry["terminal_commands"] = [
                    _json_copy(current_commands[command_id])
                    for command_id in terminal_ids
                ]
                history_entry["terminal_results"] = [
                    _json_copy(next_state["result_snapshots"][command_id])
                    for command_id in terminal_ids
                ]
                history_entry["terminal_result_receipt_hashes"] = [
                    receipt_records[command_id]["receipt_hash"]
                    for command_id in terminal_ids
                ]

        for command, _result in new_results:
            _append_result_receipt(
                campaign, receipt_records[command["command_id"]]
            )

        for evidence in push_offer_evidence:
            _append_push_offer_evidence(campaign, evidence)

        for command, result in new_results:
            if command["kind"] not in ROLL_EVIDENCE_COMMAND_KINDS:
                continue
            for event in result["events"]:
                if not isinstance(event.get("roll_id"), str):
                    continue
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
    "load_canonical_state_readonly",
    "project_player_pending_choice",
    "plan_from_pending_choice_response",
]
