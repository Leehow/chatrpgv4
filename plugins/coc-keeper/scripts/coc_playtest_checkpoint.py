"""Durable checkpoints for deterministic COC playtest runs.

The writer deliberately snapshots only the small, explicit set of files needed
to resume a playtest.  It never mirrors the workspace wholesale.
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import re
import stat
import subprocess
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterable


SCRIPT_DIR = Path(__file__).resolve().parent


def _load_sibling(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPT_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_investigator_guard = _load_sibling(
    "coc_investigator_guard_checkpoint", "coc_investigator_guard.py"
)


SCHEMA_VERSION = 2
GENESIS_SHA256 = "0" * 64
MODEL_IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9._+-]{0,255}\Z")
RUNTIME_IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}\Z")
ACTION_ROW_KEYS = {
    "turn_number",
    "previous_sha256",
    "action",
    "events",
    "state_before",
    "state_after",
    "provenance",
    "row_sha256",
}
CAMPAIGN_MUTABLE_TREES = ("save", "memory", "logs")
CAMPAIGN_IMMUTABLE_TREES = ("source", "scenario", "index")
INVESTIGATOR_FILES = (
    "creation.json",
    "character.json",
    "history.jsonl",
    "development.jsonl",
    "inventory-history.jsonl",
)
SESSION_SNAPSHOT_KEYS = {
    "session_id",
    "campaign_id",
    "investigator_id",
    "character_relpath",
    "resolved_config",
    "brain_at_create",
}
DURABLE_SYNC_FLUSH_POLICIES = frozenset({"manual", "auto"})


def _canonical_json(value: object) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def _sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _validated_model_identity(value: Any) -> dict[str, str]:
    """Return the only model identity shape safe to persist in a manifest."""

    if value is None or value == {}:
        return {}
    if not isinstance(value, dict) or set(value) != {"provider", "id"}:
        raise ValueError("model identity must contain only provider and id")
    provider = value.get("provider")
    model_id = value.get("id")
    if not (
        isinstance(provider, str)
        and MODEL_IDENTIFIER.fullmatch(provider)
        and isinstance(model_id, str)
        and MODEL_IDENTIFIER.fullmatch(model_id)
    ):
        raise ValueError(
            "model identity provider and id must be safe non-empty identifiers"
        )
    return {"provider": provider, "id": model_id}


def _sha256_fd(descriptor: int) -> tuple[str, int]:
    digest = hashlib.sha256()
    size = 0
    os.lseek(descriptor, 0, os.SEEK_SET)
    while True:
        chunk = os.read(descriptor, 1024 * 1024)
        if not chunk:
            break
        size += len(chunk)
        digest.update(chunk)
    os.lseek(descriptor, 0, os.SEEK_SET)
    return digest.hexdigest(), size


def _safe_relative_path(value: Path | str) -> Path:
    relative = Path(value)
    if (
        relative.is_absolute()
        or not relative.parts
        or any(part in {"", ".", ".."} for part in relative.parts)
    ):
        raise ValueError("path containment violation or traversal")
    return relative


def _open_regular_at(
    root_fd: int,
    relative: Path | str,
    flags: int = os.O_RDONLY,
    mode: int = 0o600,
) -> int:
    """Open one regular file beneath ``root_fd`` without following symlinks."""

    relative = _safe_relative_path(relative)
    directory_fd = os.dup(root_fd)
    descriptor = -1
    try:
        directory_flags = os.O_RDONLY
        if hasattr(os, "O_DIRECTORY"):
            directory_flags |= os.O_DIRECTORY
        if hasattr(os, "O_NOFOLLOW"):
            directory_flags |= os.O_NOFOLLOW
        for part in relative.parts[:-1]:
            next_fd = os.open(part, directory_flags, dir_fd=directory_fd)
            os.close(directory_fd)
            directory_fd = next_fd
        file_flags = flags
        if hasattr(os, "O_NOFOLLOW"):
            file_flags |= os.O_NOFOLLOW
        descriptor = os.open(relative.name, file_flags, mode, dir_fd=directory_fd)
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode):
            raise ValueError("checkpoint path is not a regular file")
        result = descriptor
        descriptor = -1
        return result
    except OSError as exc:
        raise ValueError("symlink or non-regular checkpoint path") from exc
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        os.close(directory_fd)


def _open_directory_at(root_fd: int, relative: Path | str) -> int:
    """Open a descendant directory component-by-component without symlinks."""

    relative = _safe_relative_path(relative)
    directory_fd = os.dup(root_fd)
    try:
        flags = os.O_RDONLY
        if hasattr(os, "O_DIRECTORY"):
            flags |= os.O_DIRECTORY
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        for part in relative.parts:
            next_fd = -1
            try:
                next_fd = os.open(part, flags, dir_fd=directory_fd)
                info = os.fstat(next_fd)
                if not stat.S_ISDIR(info.st_mode):
                    raise ValueError("checkpoint path is not a directory")
            except Exception:
                if next_fd >= 0:
                    os.close(next_fd)
                raise
            os.close(directory_fd)
            directory_fd = next_fd
        result = directory_fd
        directory_fd = -1
        return result
    except OSError as exc:
        raise ValueError(
            "checkpoint directory symlink or replacement is not allowed"
        ) from exc
    finally:
        if directory_fd >= 0:
            os.close(directory_fd)


def _open_or_create_directory_at(root_fd: int, relative: Path | str) -> int:
    """Create/open a directory chain beneath ``root_fd`` without symlinks."""

    relative = _safe_relative_path(relative)
    directory_fd = os.dup(root_fd)
    try:
        flags = os.O_RDONLY
        if hasattr(os, "O_DIRECTORY"):
            flags |= os.O_DIRECTORY
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        for part in relative.parts:
            next_fd = -1
            try:
                try:
                    next_fd = os.open(part, flags, dir_fd=directory_fd)
                except FileNotFoundError:
                    try:
                        os.mkdir(part, 0o700, dir_fd=directory_fd)
                    except FileExistsError:
                        pass
                    next_fd = os.open(part, flags, dir_fd=directory_fd)
                info = os.fstat(next_fd)
                if not stat.S_ISDIR(info.st_mode):
                    raise ValueError("checkpoint path is not a directory")
                os.close(directory_fd)
                directory_fd = next_fd
                next_fd = -1
            finally:
                if next_fd >= 0:
                    os.close(next_fd)
        result = directory_fd
        directory_fd = -1
        return result
    except OSError as exc:
        raise ValueError("directory symlink or replacement is not allowed") from exc
    finally:
        if directory_fd >= 0:
            os.close(directory_fd)


def _open_existing_directory_at(root_fd: int, relative: Path | str) -> int | None:
    """Open a directory chain, returning ``None`` when a component is absent."""

    relative_path = Path(relative)
    if not relative_path.parts:
        return os.dup(root_fd)
    relative_path = _safe_relative_path(relative_path)
    directory_fd = os.dup(root_fd)
    try:
        flags = os.O_RDONLY
        if hasattr(os, "O_DIRECTORY"):
            flags |= os.O_DIRECTORY
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        for part in relative_path.parts:
            next_fd = -1
            try:
                try:
                    next_fd = os.open(part, flags, dir_fd=directory_fd)
                except FileNotFoundError:
                    return None
                except OSError as exc:
                    raise ValueError("target directory symlink is not allowed") from exc
                info = os.fstat(next_fd)
                if not stat.S_ISDIR(info.st_mode):
                    raise ValueError("target path is not a directory")
                os.close(directory_fd)
                directory_fd = next_fd
                next_fd = -1
            finally:
                if next_fd >= 0:
                    os.close(next_fd)
        result = directory_fd
        directory_fd = -1
        return result
    finally:
        if directory_fd >= 0:
            os.close(directory_fd)


def _regular_files_under_at(root_fd: int, relative: Path) -> list[Path]:
    """Enumerate regular files beneath one held directory descriptor."""

    directory_fd = _open_existing_directory_at(root_fd, relative)
    if directory_fd is None:
        return []
    files: list[Path] = []

    def walk(current_fd: int, prefix: Path) -> None:
        try:
            names = sorted(os.listdir(current_fd))
        except OSError as exc:
            raise ValueError("workspace directory cannot be enumerated safely") from exc
        for name in names:
            if not name or name in {".", ".."} or "/" in name or "\x00" in name:
                raise ValueError("workspace directory contains an invalid entry name")
            try:
                info = os.stat(name, dir_fd=current_fd, follow_symlinks=False)
            except OSError as exc:
                raise ValueError(
                    "workspace directory changed during enumeration"
                ) from exc
            entry_relative = prefix / name
            if stat.S_ISLNK(info.st_mode):
                raise ValueError(
                    f"workspace source symlink is not allowed: {entry_relative}"
                )
            if stat.S_ISREG(info.st_mode):
                files.append(entry_relative)
                continue
            if stat.S_ISDIR(info.st_mode):
                child_fd = _open_directory_at(current_fd, name)
                try:
                    walk(child_fd, entry_relative)
                finally:
                    os.close(child_fd)
                continue
            raise ValueError(
                f"workspace source is not a regular file: {entry_relative}"
            )

    try:
        walk(directory_fd, relative)
    finally:
        os.close(directory_fd)
    return files


def _tree_inventory_at(
    root_fd: int, relative: Path
) -> tuple[bool, list[Path], list[str]]:
    """Return safe regular files and exact directory membership for one tree."""

    directory_fd = _open_existing_directory_at(root_fd, relative)
    if directory_fd is None:
        return False, [], []
    files: list[Path] = []
    directories: list[str] = ["."]

    def walk(current_fd: int, prefix: Path, directory_prefix: Path) -> None:
        try:
            names = sorted(os.listdir(current_fd))
        except OSError as exc:
            raise ValueError("workspace directory cannot be enumerated safely") from exc
        for name in names:
            if not name or name in {".", ".."} or "/" in name or "\x00" in name:
                raise ValueError("workspace directory contains an invalid entry name")
            try:
                info = os.stat(name, dir_fd=current_fd, follow_symlinks=False)
            except OSError as exc:
                raise ValueError(
                    "workspace directory changed during enumeration"
                ) from exc
            entry_relative = prefix / name
            member_relative = directory_prefix / name
            if stat.S_ISLNK(info.st_mode):
                raise ValueError(
                    f"workspace source symlink is not allowed: {entry_relative}"
                )
            if stat.S_ISREG(info.st_mode):
                files.append(entry_relative)
                continue
            if stat.S_ISDIR(info.st_mode):
                directories.append(member_relative.as_posix())
                child_fd = _open_directory_at(current_fd, name)
                try:
                    walk(child_fd, entry_relative, member_relative)
                finally:
                    os.close(child_fd)
                continue
            raise ValueError(
                f"workspace source is not a regular file: {entry_relative}"
            )

    try:
        walk(directory_fd, relative, Path())
    finally:
        os.close(directory_fd)
    return True, files, sorted(directories)


def _tree_directories_from_files(
    root: Path, files: Iterable[Path], *, present: bool
) -> list[str]:
    if not present:
        return []
    directories = {"."}
    for path in files:
        try:
            relative = path.relative_to(root)
        except ValueError as exc:
            raise ValueError("managed tree file escapes its declared root") from exc
        for parent in relative.parents:
            if parent == Path("."):
                continue
            directories.add(parent.as_posix())
    return sorted(directories)


def _read_fd_bytes(descriptor: int) -> bytes:
    os.lseek(descriptor, 0, os.SEEK_SET)
    chunks: list[bytes] = []
    while True:
        chunk = os.read(descriptor, 1024 * 1024)
        if not chunk:
            break
        chunks.append(chunk)
    os.lseek(descriptor, 0, os.SEEK_SET)
    return b"".join(chunks)


def _read_json_fd(descriptor: int, field: str) -> dict[str, Any]:
    try:
        value = json.loads(_read_fd_bytes(descriptor).decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"invalid {field}") from exc
    if not isinstance(value, dict):
        raise ValueError(f"invalid {field}")
    return value


def _strict_jsonl_rows_fd(descriptor: int, field: str) -> list[dict[str, Any]]:
    payload = _read_fd_bytes(descriptor)
    if not payload or not payload.endswith(b"\n"):
        raise ValueError(f"{field} must end with a complete JSONL row")

    def no_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in pairs:
            if key in result:
                raise ValueError(f"{field} contains duplicate JSON keys")
            result[key] = value
        return result

    def reject_constant(value: str) -> None:
        raise ValueError(f"{field} contains a non-finite JSON number: {value}")

    rows: list[dict[str, Any]] = []
    for encoded in payload[:-1].split(b"\n"):
        if not encoded or encoded.endswith(b"\r"):
            raise ValueError(f"{field} contains a non-canonical JSONL row")
        try:
            row = json.loads(
                encoded.decode("utf-8"),
                object_pairs_hook=no_duplicate_keys,
                parse_constant=reject_constant,
            )
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError(f"{field} contains invalid JSON") from exc
        if not isinstance(row, dict):
            raise ValueError(f"{field} row must be a JSON object")
        rows.append(row)
    return rows


def _validated_decision_ids(value: Any, field: str) -> list[str]:
    if (
        not isinstance(value, list)
        or not value
        or not all(
            isinstance(item, str)
            and item
            and len(item) <= 512
            and "\n" not in item
            and "\r" not in item
            and "\x00" not in item
            for item in value
        )
        or len(set(value)) != len(value)
    ):
        raise ValueError(f"{field} decision IDs are invalid or ambiguous")
    return list(value)


def _validate_runtime_evidence_fds(
    live_runtime_fd: int,
    telemetry_fd: int,
    *,
    expected_receipt_sha256: str,
    session_id: str,
    investigator_id: str,
    expected_model_identity: dict[str, str],
) -> dict[str, Any]:
    runtime_rows = _strict_jsonl_rows_fd(live_runtime_fd, "live runtime receipt log")
    matching_runtime_rows = [
        row for row in runtime_rows
        if _sha256_bytes(_canonical_json(row)) == expected_receipt_sha256
    ]
    if len(matching_runtime_rows) != 1:
        raise ValueError("live runtime receipt digest is missing or ambiguous")
    runtime_row = matching_runtime_rows[0]
    required_runtime = {
        "schema_version",
        "event_type",
        "investigator_id",
        "decision_ids",
        "recording_mode",
        "recording_flush",
    }
    if (
        not required_runtime <= set(runtime_row)
        or runtime_row.get("schema_version") != 1
        or runtime_row.get("event_type") != "live_turn_runtime"
        or runtime_row.get("investigator_id") != investigator_id
        or runtime_row.get("recording_mode") != "sync"
        or runtime_row.get("recording_flush") not in DURABLE_SYNC_FLUSH_POLICIES
    ):
        raise ValueError("live runtime receipt identity or recording mode mismatch")
    decision_ids = _validated_decision_ids(
        runtime_row.get("decision_ids"), "live runtime receipt"
    )
    actual_receipt = _sha256_bytes(_canonical_json(runtime_row))
    if actual_receipt != expected_receipt_sha256:  # defensive after exact selection
        raise ValueError("live runtime receipt digest mismatch")

    telemetry_rows = _strict_jsonl_rows_fd(telemetry_fd, "runtime telemetry log")
    expected_keys = {
        "schema_version",
        "receipt_id",
        "session_id",
        "investigator_id",
        "decision_ids",
        "runtime_receipt_sha256",
        "telemetry",
    }
    seen_receipt_ids: set[str] = set()
    session_rows: list[dict[str, Any]] = []
    for row in telemetry_rows:
        receipt_id = row.get("receipt_id")
        if (
            set(row) != expected_keys
            or row.get("schema_version") != 1
            or not isinstance(receipt_id, str)
            or not receipt_id
            or receipt_id in seen_receipt_ids
            or not isinstance(row.get("session_id"), str)
            or not isinstance(row.get("investigator_id"), str)
            or not isinstance(row.get("telemetry"), dict)
            or not isinstance(row.get("decision_ids"), list)
            or not isinstance(row.get("runtime_receipt_sha256"), str)
            or re.fullmatch(r"[0-9a-f]{64}", row.get("runtime_receipt_sha256", "")) is None
            or not all(
                isinstance(item, str)
                and item
                and len(item) <= 512
                and "\n" not in item
                and "\r" not in item
                and "\x00" not in item
                for item in row.get("decision_ids", [])
            )
            or len(set(row.get("decision_ids", []))) != len(row.get("decision_ids", []))
        ):
            raise ValueError("runtime telemetry receipt is invalid or ambiguous")
        seen_receipt_ids.add(receipt_id)
        if row["session_id"] == session_id:
            session_rows.append(row)
    if not session_rows:
        raise ValueError("runtime telemetry receipt for session is missing")
    latest = session_rows[-1]
    latest_decision_ids = _validated_decision_ids(
        latest.get("decision_ids"), "latest runtime telemetry receipt"
    )
    if (
        latest.get("investigator_id") != investigator_id
        or latest_decision_ids != decision_ids
        or latest.get("runtime_receipt_sha256") != actual_receipt
    ):
        raise ValueError("latest runtime telemetry decision binding mismatch")
    telemetry = latest.get("telemetry")
    narrator = telemetry.get("narrator") if isinstance(telemetry, dict) else None
    if not isinstance(narrator, dict) or set(narrator) != {
        "call_count", "model_identity", "response_mode", "consistent",
        "deterministic_fallback",
    }:
        raise ValueError("runtime telemetry narrator attestation is missing")
    call_count = narrator.get("call_count")
    model_identity = _validated_model_identity(narrator.get("model_identity"))
    if expected_model_identity:
        trusted = (
            not isinstance(call_count, bool)
            and isinstance(call_count, int)
            and call_count > 0
            and model_identity == expected_model_identity
            and narrator.get("response_mode") in {"tool", "prose_fallback"}
            and narrator.get("consistent") is True
            and narrator.get("deterministic_fallback") is False
            and telemetry.get("fallback") is False
        )
    else:
        trusted = (
            call_count == 0
            and model_identity == {}
            and narrator.get("response_mode") is None
            and narrator.get("consistent") is True
            and narrator.get("deterministic_fallback") is False
            and telemetry.get("fallback") is False
        )
    if not trusted:
        raise ValueError(
            "runtime telemetry narrator model, consistency, or fallback mismatch"
        )
    return runtime_row


def _brain_label_for_config(config: Any) -> str:
    if not isinstance(config, dict):
        raise ValueError("session resolved config is invalid")
    if set(config) == {"schema_version", "brain"} and config.get("schema_version") == 1:
        brain = config.get("brain")
        if brain in {"debug", "pi"}:
            return str(brain)
        raise ValueError("session resolved config is invalid")
    expected = {"schema_version", "planner", "rules", "narrator", "player"}
    if set(config) != expected or config.get("schema_version") != 2:
        raise ValueError("session resolved config is invalid")
    allowed = {
        "planner": {"deterministic"},
        "rules": {"deterministic"},
        "narrator": {"template", "pi"},
        "player": {"human", "pi"},
    }
    for component, kinds in allowed.items():
        value = config.get(component)
        if not isinstance(value, dict) or set(value) != {"kind"}:
            raise ValueError("session resolved config is invalid")
        if value.get("kind") not in kinds:
            raise ValueError("session resolved config is invalid")
    return "pi" if config["narrator"]["kind"] == "pi" else "debug"


def _validate_investigator_documents(
    character: dict[str, Any],
    creation: dict[str, Any] | None,
    investigator_id: str,
) -> None:
    character_fields = [
        character.get(field)
        for field in ("id", "investigator_id")
        if field in character
    ]
    if not character_fields or any(
        value != investigator_id for value in character_fields
    ):
        raise ValueError("selected investigator character identity mismatch")
    if creation is not None and creation.get("investigator_id") != investigator_id:
        raise ValueError("selected investigator creation identity mismatch")


def _sanitized_session_payload(
    payload: dict[str, Any],
    *,
    session_id: str,
    campaign_id: str,
    investigator_id: str,
) -> tuple[bytes, dict[str, Any]]:
    if (
        set(payload) != {"schema_version", "sessions", "closed_session_ids"}
        or payload.get("schema_version") != 1
        or isinstance(payload.get("schema_version"), bool)
        or not isinstance(payload.get("sessions"), list)
        or not isinstance(payload.get("closed_session_ids"), list)
        or not all(isinstance(item, str) for item in payload["closed_session_ids"])
    ):
        raise ValueError("invalid session snapshot")
    active_ids: set[str] = set()
    validated_records: list[dict[str, Any]] = []
    for item in payload["sessions"]:
        if not isinstance(item, dict) or set(item) != SESSION_SNAPSHOT_KEYS:
            raise ValueError("invalid session snapshot record")
        sid = item.get("session_id")
        campaign = item.get("campaign_id")
        investigator = item.get("investigator_id")
        if not all(
            isinstance(value, str) and RUNTIME_IDENTIFIER.fullmatch(value)
            for value in (sid, campaign, investigator)
        ):
            raise ValueError("invalid session snapshot identity")
        if sid in active_ids:
            raise ValueError("duplicate session snapshot identity")
        active_ids.add(sid)
        expected_relpath = f".coc/investigators/{investigator}/character.json"
        if (
            item.get("character_relpath") != expected_relpath
            or item.get("brain_at_create") not in {"debug", "pi"}
            or _brain_label_for_config(item.get("resolved_config"))
            != item["brain_at_create"]
        ):
            raise ValueError("invalid session snapshot record")
        validated_records.append(item)
    closed_ids = payload["closed_session_ids"]
    if (
        len(set(closed_ids)) != len(closed_ids)
        or any(not RUNTIME_IDENTIFIER.fullmatch(item) for item in closed_ids)
        or active_ids.intersection(closed_ids)
    ):
        raise ValueError("invalid closed session snapshot identities")
    matches = [item for item in validated_records if item["session_id"] == session_id]
    if len(matches) != 1:
        raise ValueError("session snapshot must contain exactly the requested session")
    record = matches[0]
    expected_character = f".coc/investigators/{investigator_id}/character.json"
    if (
        set(record) != SESSION_SNAPSHOT_KEYS
        or record.get("campaign_id") != campaign_id
        or record.get("investigator_id") != investigator_id
        or record.get("character_relpath") != expected_character
        or record.get("brain_at_create") not in {"debug", "pi"}
    ):
        raise ValueError("session snapshot identity mismatch")
    resolved_config = record.get("resolved_config")
    if _brain_label_for_config(resolved_config) != record["brain_at_create"]:
        raise ValueError("session snapshot resolved config mismatch")
    # Exact pipeline schemas above deliberately exclude credentials, absolute
    # paths, process handles, and every unrelated session/tombstone.
    sanitized = {
        "schema_version": 1,
        "sessions": [record],
        "closed_session_ids": [],
    }
    return _canonical_json(sanitized) + b"\n", record


def _regular_file_exists_at(root_fd: int, relative: Path) -> bool:
    parent_fd = _open_existing_directory_at(root_fd, relative.parent)
    if parent_fd is None:
        return False
    try:
        try:
            info = os.stat(relative.name, dir_fd=parent_fd, follow_symlinks=False)
        except FileNotFoundError:
            return False
        if stat.S_ISLNK(info.st_mode):
            raise ValueError(f"workspace source symlink is not allowed: {relative}")
        if not stat.S_ISREG(info.st_mode):
            raise ValueError(f"workspace source is not a regular file: {relative}")
        return True
    finally:
        os.close(parent_fd)


def _require_directory_identity_at(
    root_fd: int,
    relative: Path | str,
    expected_fd: int,
    field: str,
) -> None:
    """Fail if a named directory no longer resolves to the held descriptor."""

    current_fd = _open_directory_at(root_fd, relative)
    try:
        current = os.fstat(current_fd)
        expected = os.fstat(expected_fd)
        if (current.st_dev, current.st_ino) != (expected.st_dev, expected.st_ino):
            raise ValueError(f"{field} directory was replaced")
    finally:
        os.close(current_fd)


def _write_all(descriptor: int, payload: bytes) -> None:
    view = memoryview(payload)
    while view:
        written = os.write(descriptor, view)
        if written <= 0:
            raise OSError("short write")
        view = view[written:]


def _copy_fd_to_fd(source_fd: int, target_fd: int) -> tuple[str, int]:
    """Copy and hash bytes using only already-verified descriptors."""

    digest = hashlib.sha256()
    size = 0
    os.lseek(source_fd, 0, os.SEEK_SET)
    while True:
        chunk = os.read(source_fd, 1024 * 1024)
        if not chunk:
            break
        digest.update(chunk)
        size += len(chunk)
        _write_all(target_fd, chunk)
    os.fsync(target_fd)
    os.lseek(source_fd, 0, os.SEEK_SET)
    return digest.hexdigest(), size


def _validate_action_journal_fd(
    descriptor: int,
    expected_chain_sha256: str,
    expected_turn_number: int,
    expected_model_identity: dict[str, str],
) -> None:
    """Validate canonical action rows using the already-verified journal FD."""

    os.lseek(descriptor, 0, os.SEEK_SET)
    try:
        chunks: list[bytes] = []
        while True:
            chunk = os.read(descriptor, 1024 * 1024)
            if not chunk:
                break
            chunks.append(chunk)
        payload = b"".join(chunks)
        if payload and not payload.endswith(b"\n"):
            raise ValueError("action journal must end with a canonical newline")

        previous = GENESIS_SHA256
        terminal_turn = 0
        terminal_model_identity: dict[str, str] = {}
        encoded_rows = payload[:-1].split(b"\n") if payload else []
        for expected_turn, encoded in enumerate(encoded_rows, start=1):
            try:
                row = json.loads(encoded.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise ValueError("action journal contains invalid JSON") from exc
            if not isinstance(row, dict) or set(row) != ACTION_ROW_KEYS:
                raise ValueError("action journal row schema is invalid")
            if _canonical_json(row) != encoded:
                raise ValueError("action journal row is not canonical JSON")
            turn_number = row.get("turn_number")
            if (
                isinstance(turn_number, bool)
                or not isinstance(turn_number, int)
                or turn_number != expected_turn
            ):
                raise ValueError("action journal turn sequence is invalid")
            if row.get("previous_sha256") != previous:
                raise ValueError("action journal hash chain is invalid")
            expected_row_sha256 = _sha256_bytes(
                _canonical_json(
                    {key: value for key, value in row.items() if key != "row_sha256"}
                )
            )
            if row.get("row_sha256") != expected_row_sha256:
                raise ValueError("action journal row checksum is invalid")
            provenance = row.get("provenance")
            if not isinstance(provenance, dict):
                raise ValueError("action journal provenance is invalid")
            terminal_model_identity = _validated_model_identity(
                provenance.get("model_identity")
            )
            previous = expected_row_sha256
            terminal_turn = turn_number

        if terminal_turn != expected_turn_number:
            raise ValueError("action journal terminal turn does not match manifest")
        if previous != expected_chain_sha256:
            raise ValueError(
                "action journal terminal action chain does not match manifest"
            )
        if terminal_model_identity != expected_model_identity:
            raise ValueError("action journal model identity does not match manifest")
    finally:
        os.lseek(descriptor, 0, os.SEEK_SET)


def _terminal_journal_provenance_fd(descriptor: int) -> dict[str, Any]:
    rows = _strict_jsonl_rows_fd(descriptor, "action journal")
    if not rows:
        return {}
    provenance = rows[-1].get("provenance")
    if not isinstance(provenance, dict):
        raise ValueError("action journal terminal provenance is invalid")
    return provenance


def _write_new_file_at(
    parent_fd: int,
    name: str,
    payload: bytes,
    mode: int = 0o600,
) -> None:
    relative = _safe_relative_path(name)
    if len(relative.parts) != 1:
        raise ValueError("new file name must be one path component")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(relative.name, flags, mode, dir_fd=parent_fd)
    try:
        _write_all(descriptor, payload)
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _remove_tree_at(parent_fd: int, name: str) -> None:
    """Remove one unpublished tree without ever following a symlink."""

    relative = _safe_relative_path(name)
    if len(relative.parts) != 1:
        raise ValueError("tree name must be one path component")
    try:
        info = os.stat(relative.name, dir_fd=parent_fd, follow_symlinks=False)
    except FileNotFoundError:
        return
    if not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode):
        os.unlink(relative.name, dir_fd=parent_fd)
        return

    directory_fd = _open_directory_at(parent_fd, relative.name)
    try:
        for child in os.listdir(directory_fd):
            child_info = os.stat(child, dir_fd=directory_fd, follow_symlinks=False)
            if stat.S_ISDIR(child_info.st_mode) and not stat.S_ISLNK(
                child_info.st_mode
            ):
                _remove_tree_at(directory_fd, child)
            else:
                os.unlink(child, dir_fd=directory_fd)
    finally:
        os.close(directory_fd)
    os.rmdir(relative.name, dir_fd=parent_fd)


def _unlink_file_at(root_fd: int, relative: Path) -> None:
    parent_fd = _open_existing_directory_at(root_fd, relative.parent)
    if parent_fd is None:
        return
    try:
        try:
            info = os.stat(relative.name, dir_fd=parent_fd, follow_symlinks=False)
        except FileNotFoundError:
            return
        if stat.S_ISDIR(info.st_mode) and not stat.S_ISLNK(info.st_mode):
            raise ValueError(f"expected a file during cleanup: {relative}")
        os.unlink(relative.name, dir_fd=parent_fd)
    finally:
        os.close(parent_fd)


def _remove_relative_tree_at(root_fd: int, relative: Path) -> None:
    parent_fd = _open_existing_directory_at(root_fd, relative.parent)
    if parent_fd is None:
        return
    try:
        _remove_tree_at(parent_fd, relative.name)
    finally:
        os.close(parent_fd)


@contextmanager
def _campaign_lock_at(root_fd: int, campaign_relative: Path):
    """Hold the same `.campaign.lock` exclusion boundary as live turns."""

    campaign_fd = _open_or_create_directory_at(root_fd, campaign_relative)
    lock_fd = -1
    lock_identity: tuple[int, int] | None = None
    try:
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        try:
            lock_fd = os.open(".campaign.lock", flags, 0o600, dir_fd=campaign_fd)
        except FileExistsError as exc:
            raise ValueError(
                "campaign lock is held; checkpoint boundary is not quiescent"
            ) from exc
        _write_all(
            lock_fd,
            _canonical_json({"pid": os.getpid(), "owner": "playtest-checkpoint"}),
        )
        os.fsync(lock_fd)
        info = os.fstat(lock_fd)
        lock_identity = (info.st_dev, info.st_ino)
        os.close(lock_fd)
        lock_fd = -1
        os.fsync(campaign_fd)
        yield campaign_fd
    finally:
        if lock_fd >= 0:
            os.close(lock_fd)
        if lock_identity is not None:
            try:
                current = os.stat(
                    ".campaign.lock", dir_fd=campaign_fd, follow_symlinks=False
                )
            except FileNotFoundError:
                current = None
            if current is not None:
                if (current.st_dev, current.st_ino) != lock_identity:
                    os.close(campaign_fd)
                    raise ValueError("campaign lock was replaced")
                os.unlink(".campaign.lock", dir_fd=campaign_fd)
                os.fsync(campaign_fd)
        os.close(campaign_fd)


def _open_directory_path(path: Path, field: str) -> int:
    flags = os.O_RDONLY
    if hasattr(os, "O_DIRECTORY"):
        flags |= os.O_DIRECTORY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = -1
    try:
        descriptor = os.open(path, flags)
        info = os.fstat(descriptor)
        if not stat.S_ISDIR(info.st_mode):
            raise ValueError(f"{field} is not a directory")
        result = descriptor
        descriptor = -1
        return result
    except OSError as exc:
        raise ValueError(f"{field} symlink or non-directory path") from exc
    finally:
        if descriptor >= 0:
            os.close(descriptor)


def _require_directory_path_identity(path: Path, expected_fd: int, field: str) -> None:
    try:
        info = os.lstat(path)
    except OSError as exc:
        raise ValueError(f"{field} directory was replaced") from exc
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
        raise ValueError(f"{field} symlink or replacement is not allowed")
    current_fd = _open_directory_path(path, field)
    try:
        current = os.fstat(current_fd)
        expected = os.fstat(expected_fd)
        if (current.st_dev, current.st_ino) != (expected.st_dev, expected.st_ino):
            raise ValueError(f"{field} directory was replaced")
    finally:
        os.close(current_fd)


def _open_or_create_directory_path(path: Path, field: str) -> int:
    """Open/create an absolute directory while anchoring all new components."""

    path = path.absolute()
    missing: list[str] = []
    current = path
    while True:
        try:
            info = os.lstat(current)
        except FileNotFoundError:
            if current.parent == current or not current.name:
                raise ValueError(f"{field} has no existing directory ancestor")
            missing.append(current.name)
            current = current.parent
            continue
        if stat.S_ISLNK(info.st_mode):
            raise ValueError(f"{field} symlink is not allowed")
        if not stat.S_ISDIR(info.st_mode):
            raise ValueError(f"{field} ancestor is not a directory")
        descriptor = _open_directory_path(current, field)
        try:
            opened = os.fstat(descriptor)
        except Exception:
            os.close(descriptor)
            raise
        if (opened.st_dev, opened.st_ino) != (info.st_dev, info.st_ino):
            os.close(descriptor)
            raise ValueError(f"{field} ancestor was replaced")
        break

    try:
        for part in reversed(missing):
            next_fd = _open_or_create_directory_at(descriptor, part)
            os.close(descriptor)
            descriptor = next_fd
        _require_directory_path_identity(path, descriptor, field)
        result = descriptor
        descriptor = -1
        return result
    finally:
        if descriptor >= 0:
            os.close(descriptor)


class CheckpointStore:
    """Append-only turn ledger and immutable checkpoint snapshots."""

    def __init__(
        self,
        run_dir: Path | str,
        workspace: Path | str,
        campaign_id: str,
        investigator_id: str,
        *,
        run_dir_fd: int | None = None,
    ) -> None:
        self._validate_identifier(campaign_id, "campaign_id")
        self._validate_identifier(investigator_id, "investigator_id")
        self.run_dir = Path(run_dir).absolute()
        self.workspace = Path(workspace).absolute()
        self.campaign_id = campaign_id
        self.investigator_id = investigator_id
        workspace_fd = _open_directory_path(self.workspace, "workspace root")
        try:
            workspace_info = os.fstat(workspace_fd)
            self._workspace_identity = (workspace_info.st_dev, workspace_info.st_ino)
        finally:
            os.close(workspace_fd)
        held_identity: tuple[int, int] | None = None
        if run_dir_fd is not None:
            try:
                held = os.fstat(run_dir_fd)
            except OSError as exc:
                raise ValueError("held run directory descriptor is invalid") from exc
            if not stat.S_ISDIR(held.st_mode):
                raise ValueError("held run directory descriptor is not a directory")
            held_identity = (held.st_dev, held.st_ino)
        try:
            before = os.lstat(self.run_dir)
        except FileNotFoundError:
            before = None
        if before is not None and stat.S_ISLNK(before.st_mode):
            raise ValueError("run directory symlink is not allowed")
        if held_identity is None:
            self.run_dir.mkdir(parents=True, exist_ok=True)
        elif before is None:
            raise ValueError("held run directory path was replaced")
        created = os.lstat(self.run_dir)
        if stat.S_ISLNK(created.st_mode):
            raise ValueError("run directory symlink is not allowed")
        if not stat.S_ISDIR(created.st_mode):
            raise ValueError("run directory is not a directory")
        current_identity = (created.st_dev, created.st_ino)
        if held_identity is not None and current_identity != held_identity:
            raise ValueError("held run directory path was replaced")
        self._run_dir_identity = held_identity or current_identity
        self.action_ledger = self.run_dir / "actions.jsonl"
        run_fd = self._open_run_dir()
        try:
            self._validate_action_ledger_entry(run_fd)
        finally:
            os.close(run_fd)
        self.git_head = self._read_git_head()
        self.action_chain_sha256 = GENESIS_SHA256
        self._turn_number = 0
        self._last_provenance: dict[str, Any] = {}
        self._recover_action_ledger()

    def _open_workspace_root(self) -> int:
        descriptor = _open_directory_path(self.workspace, "workspace root")
        try:
            info = os.fstat(descriptor)
            if (info.st_dev, info.st_ino) != self._workspace_identity:
                raise ValueError("workspace root was replaced")
            result = descriptor
            descriptor = -1
            return result
        finally:
            if descriptor >= 0:
                os.close(descriptor)

    def _require_workspace_root_identity(self, expected_fd: int) -> None:
        current_fd = self._open_workspace_root()
        try:
            current = os.fstat(current_fd)
            expected = os.fstat(expected_fd)
            if (current.st_dev, current.st_ino) != (expected.st_dev, expected.st_ino):
                raise ValueError("workspace root was replaced")
        finally:
            os.close(current_fd)

    def _open_run_dir(self) -> int:
        """Open the originally-created run directory without following links."""

        try:
            current = os.lstat(self.run_dir)
        except OSError as exc:
            raise ValueError("run directory was replaced") from exc
        if stat.S_ISLNK(current.st_mode):
            raise ValueError("run directory symlink is not allowed")
        if not stat.S_ISDIR(current.st_mode):
            raise ValueError("run directory was replaced")
        if (current.st_dev, current.st_ino) != self._run_dir_identity:
            raise ValueError("run directory was replaced")

        flags = os.O_RDONLY
        if hasattr(os, "O_DIRECTORY"):
            flags |= os.O_DIRECTORY
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        descriptor = -1
        try:
            descriptor = os.open(self.run_dir, flags)
            opened = os.fstat(descriptor)
            if (opened.st_dev, opened.st_ino) != self._run_dir_identity:
                raise ValueError("run directory was replaced")
            result = descriptor
            descriptor = -1
            return result
        except OSError as exc:
            raise ValueError(
                "run directory symlink or replacement is not allowed"
            ) from exc
        finally:
            if descriptor >= 0:
                os.close(descriptor)

    @staticmethod
    def _validate_action_ledger_entry(run_fd: int) -> None:
        try:
            info = os.stat("actions.jsonl", dir_fd=run_fd, follow_symlinks=False)
        except FileNotFoundError:
            return
        except OSError as exc:
            raise ValueError("action ledger cannot be inspected safely") from exc
        if stat.S_ISLNK(info.st_mode):
            raise ValueError("action ledger symlink is not allowed")
        if not stat.S_ISREG(info.st_mode):
            raise ValueError("action ledger is not a regular file")

    @staticmethod
    def _validate_identifier(value: str, field: str) -> None:
        if (
            not isinstance(value, str)
            or not value
            or value in {".", ".."}
            or "/" in value
            or "\\" in value
            or "\x00" in value
        ):
            raise ValueError(f"invalid {field} identifier: traversal is not allowed")

    def _require_workspace_path(self, path: Path) -> Path:
        try:
            path.relative_to(self.workspace)
        except ValueError as exc:
            raise ValueError(f"workspace containment violation: {path}") from exc
        return path

    def _reject_symlink_components(self, path: Path) -> None:
        path = self._require_workspace_path(path)
        current = self.workspace
        for part in path.relative_to(self.workspace).parts:
            current = current / part
            if current.is_symlink():
                raise ValueError(
                    f"symlink is not allowed in checkpoint source: {current}"
                )

    def _read_git_head(self) -> str:
        try:
            completed = subprocess.run(
                ["git", "rev-parse", "HEAD"],
                cwd=self.workspace,
                check=True,
                capture_output=True,
                text=True,
            )
        except (OSError, subprocess.CalledProcessError):
            return "unknown"
        return completed.stdout.strip() or "unknown"

    def _recover_action_ledger(self) -> None:
        run_fd = self._open_run_dir()
        try:
            self._validate_action_ledger_entry(run_fd)
            try:
                info = os.stat("actions.jsonl", dir_fd=run_fd, follow_symlinks=False)
            except FileNotFoundError:
                return
            if not stat.S_ISREG(info.st_mode):
                raise ValueError("action ledger is not a regular file")
            descriptor = _open_regular_at(run_fd, "actions.jsonl")
            try:
                with os.fdopen(descriptor, "rb") as handle:
                    descriptor = -1
                    payload = handle.read()
            finally:
                if descriptor >= 0:
                    os.close(descriptor)
        finally:
            os.close(run_fd)
        offset = 0
        previous = GENESIS_SHA256
        turn_number = 0
        last_provenance: dict[str, Any] = {}
        lines = payload.splitlines(keepends=True)

        for index, encoded_line in enumerate(lines):
            line_start = offset
            offset += len(encoded_line)
            raw = encoded_line.rstrip(b"\r\n")
            try:
                row = json.loads(raw.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                if index != len(lines) - 1:
                    raise ValueError("invalid action ledger row")
                self._truncate_ledger(line_start)
                break

            expected = _sha256_bytes(
                _canonical_json(
                    {key: value for key, value in row.items() if key != "row_sha256"}
                )
            )
            if (
                row.get("previous_sha256") != previous
                or row.get("row_sha256") != expected
            ):
                raise ValueError("action ledger checksum mismatch")
            previous = expected
            turn_number = int(row["turn_number"])
            provenance = row.get("provenance")
            if isinstance(provenance, dict):
                last_provenance = provenance

        self.action_chain_sha256 = previous
        self._turn_number = turn_number
        self._last_provenance = last_provenance

    def _outer_journal_boundary(self, turn_number: int) -> tuple[str, dict[str, Any]]:
        """Return the authenticated outer-journal prefix named by a checkpoint."""

        if turn_number == 0:
            return GENESIS_SHA256, {}
        if turn_number < 0 or turn_number > self._turn_number:
            raise ValueError(
                "checkpoint turn is not present in the outer action journal"
            )
        run_fd = self._open_run_dir()
        descriptor = -1
        try:
            self._validate_action_ledger_entry(run_fd)
            descriptor = _open_regular_at(run_fd, "actions.jsonl")
            _validate_action_journal_fd(
                descriptor,
                self.action_chain_sha256,
                self._turn_number,
                _validated_model_identity(self._last_provenance.get("model_identity")),
            )
            payload = _read_fd_bytes(descriptor)
        finally:
            if descriptor >= 0:
                os.close(descriptor)
            os.close(run_fd)
        rows = payload[:-1].split(b"\n") if payload else []
        if len(rows) < turn_number:
            raise ValueError(
                "checkpoint turn is not present in the outer action journal"
            )
        row = json.loads(rows[turn_number - 1].decode("utf-8"))
        provenance = row.get("provenance")
        if not isinstance(provenance, dict):
            raise ValueError("outer action journal provenance is invalid")
        return str(row["row_sha256"]), provenance

    def _truncate_ledger(self, length: int) -> None:
        run_fd = self._open_run_dir()
        try:
            self._validate_action_ledger_entry(run_fd)
            descriptor = _open_regular_at(run_fd, "actions.jsonl", os.O_RDWR)
            try:
                with os.fdopen(descriptor, "r+b") as handle:
                    descriptor = -1
                    handle.truncate(length)
                    handle.flush()
                    os.fsync(handle.fileno())
            finally:
                if descriptor >= 0:
                    os.close(descriptor)
        finally:
            os.close(run_fd)

    def append_turn(
        self,
        action: object,
        events: object,
        state_before: object,
        state_after: object,
        provenance: dict[str, Any],
    ) -> Path:
        """Append and fsync one canonical, hash-linked turn record."""

        run_fd = self._open_run_dir()
        try:
            self._validate_action_ledger_entry(run_fd)

            # Validate the complete allowlist at the same boundary as the durable
            # action write.  This prevents a turn from claiming resumability when
            # its checkpoint inputs already escape through a symlink.
            tuple(self._workspace_files())

            row: dict[str, Any] = {
                "turn_number": self._turn_number + 1,
                "previous_sha256": self.action_chain_sha256,
                "action": action,
                "events": events,
                "state_before": state_before,
                "state_after": state_after,
                "provenance": provenance,
            }
            row["row_sha256"] = _sha256_bytes(_canonical_json(row))
            encoded = _canonical_json(row) + b"\n"

            flags = os.O_WRONLY | os.O_APPEND | os.O_CREAT
            descriptor = _open_regular_at(run_fd, "actions.jsonl", flags)
            try:
                with os.fdopen(descriptor, "ab") as handle:
                    descriptor = -1
                    handle.write(encoded)
                    handle.flush()
                    os.fsync(handle.fileno())
            finally:
                if descriptor >= 0:
                    os.close(descriptor)
            os.fsync(run_fd)
        finally:
            os.close(run_fd)

        self._turn_number += 1
        self.action_chain_sha256 = row["row_sha256"]
        self._last_provenance = dict(provenance)
        return self.action_ledger

    def _workspace_files(self) -> Iterable[Path]:
        campaign = self.workspace / ".coc" / "campaigns" / self.campaign_id
        for leaf in ("campaign.json", "party.json"):
            path = campaign / leaf
            self._reject_symlink_components(path)
            if path.is_file():
                yield path
        for name in (*CAMPAIGN_MUTABLE_TREES, *CAMPAIGN_IMMUTABLE_TREES):
            directory = campaign / name
            self._reject_symlink_components(directory)
            if directory.is_dir():
                for path in sorted(directory.rglob("*")):
                    self._reject_symlink_components(path)
                    if path.is_file():
                        yield path

        investigator = self.workspace / ".coc" / "investigators" / self.investigator_id
        for name in INVESTIGATOR_FILES:
            path = investigator / name
            self._reject_symlink_components(path)
            if path.is_file():
                yield path

        sessions = self.workspace / ".coc" / "runtime" / "sessions.json"
        self._reject_symlink_components(sessions)
        if sessions.is_file():
            yield sessions

    def _workspace_relative_files(self, workspace_fd: int) -> list[Path]:
        campaign = Path(".coc") / "campaigns" / self.campaign_id
        files: list[Path] = []
        campaign_state = campaign / "campaign.json"
        if not _regular_file_exists_at(workspace_fd, campaign_state):
            raise ValueError("campaign.json is required for a checkpoint")
        files.append(campaign_state)
        party = campaign / "party.json"
        if _regular_file_exists_at(workspace_fd, party):
            files.append(party)
        for name in (*CAMPAIGN_MUTABLE_TREES, *CAMPAIGN_IMMUTABLE_TREES):
            _present, tree_files, _directories = _tree_inventory_at(
                workspace_fd, campaign / name
            )
            files.extend(tree_files)

        investigator = Path(".coc") / "investigators" / self.investigator_id
        for name in INVESTIGATOR_FILES:
            candidate = investigator / name
            if _regular_file_exists_at(workspace_fd, candidate):
                files.append(candidate)

        sessions = Path(".coc") / "runtime" / "sessions.json"
        if not _regular_file_exists_at(workspace_fd, sessions):
            raise ValueError("session snapshot is required for a checkpoint")
        files.append(sessions)
        return sorted(set(files))

    @staticmethod
    def _json_object_at(root_fd: int, relative: Path, field: str) -> dict[str, Any]:
        descriptor = _open_regular_at(root_fd, relative)
        try:
            return _read_json_fd(descriptor, field)
        finally:
            os.close(descriptor)

    def _campaign_relative(self) -> Path:
        return Path(".coc") / "campaigns" / self.campaign_id

    def _investigator_relative(self) -> Path:
        return Path(".coc") / "investigators" / self.investigator_id

    def _tree_metadata(
        self,
        workspace_fd: int,
        names: tuple[str, ...],
        *,
        derive_directories_from_files: bool = False,
        require_present: bool = False,
    ) -> dict[str, dict[str, Any]]:
        campaign = self._campaign_relative()
        metadata: dict[str, dict[str, Any]] = {}
        for name in names:
            root = campaign / name
            present, files, directories = _tree_inventory_at(workspace_fd, root)
            if require_present and not present:
                raise ValueError(f"canonical mutable root is required: {root}")
            if derive_directories_from_files:
                directories = _tree_directories_from_files(root, files, present=present)
            metadata[root.as_posix()] = {
                "present": present,
                "directories": directories,
            }
        return metadata

    def _validate_workspace_identities(self, workspace_fd: int) -> None:
        campaign = self._campaign_relative()
        campaign_state = self._json_object_at(
            workspace_fd, campaign / "campaign.json", "campaign state"
        )
        if campaign_state.get("campaign_id") != self.campaign_id:
            raise ValueError("campaign identity mismatch")

        investigator_root = self._investigator_relative()
        character = self._json_object_at(
            workspace_fd,
            investigator_root / "character.json",
            "selected investigator character",
        )
        creation_path = investigator_root / "creation.json"
        creation = (
            self._json_object_at(
                workspace_fd, creation_path, "selected investigator creation"
            )
            if _regular_file_exists_at(workspace_fd, creation_path)
            else None
        )
        _validate_investigator_documents(character, creation, self.investigator_id)

        party_path = campaign / "party.json"
        if _regular_file_exists_at(workspace_fd, party_path):
            party = self._json_object_at(workspace_fd, party_path, "party state")
            membership = party.get("investigator_ids")
            active = party.get("active_investigator_ids")
            if (
                not isinstance(membership, list)
                or self.investigator_id not in membership
                or (
                    active is not None
                    and (
                        not isinstance(active, list)
                        or self.investigator_id not in active
                    )
                )
            ):
                raise ValueError("party does not contain the selected investigator")
            if party.get("campaign_id") not in {None, self.campaign_id}:
                raise ValueError("party campaign identity mismatch")

        investigator_state_path = (
            campaign / "save" / "investigator-state" / f"{self.investigator_id}.json"
        )
        if _regular_file_exists_at(workspace_fd, investigator_state_path):
            state = self._json_object_at(
                workspace_fd, investigator_state_path, "investigator save state"
            )
            if (
                state.get("campaign_id") != self.campaign_id
                or state.get("investigator_id") != self.investigator_id
            ):
                raise ValueError("investigator save identity mismatch")

        world_path = campaign / "save" / "world-state.json"
        module_path = campaign / "scenario" / "module-meta.json"
        if _regular_file_exists_at(
            workspace_fd, world_path
        ) and _regular_file_exists_at(workspace_fd, module_path):
            world = self._json_object_at(workspace_fd, world_path, "world state")
            module = self._json_object_at(workspace_fd, module_path, "module metadata")
            world_scenario = world.get("scenario_id")
            module_scenario = module.get("scenario_id")
            if (
                isinstance(world_scenario, str)
                and isinstance(module_scenario, str)
                and world_scenario != module_scenario
            ):
                raise ValueError("scenario identity mismatch")

    def _session_snapshot_bytes(
        self, workspace_fd: int, session_id: str
    ) -> tuple[bytes, dict[str, Any]]:
        relative = Path(".coc") / "runtime" / "sessions.json"
        descriptor = _open_regular_at(workspace_fd, relative)
        try:
            payload = _read_json_fd(descriptor, "session snapshot")
        finally:
            os.close(descriptor)
        return _sanitized_session_payload(
            payload,
            session_id=session_id,
            campaign_id=self.campaign_id,
            investigator_id=self.investigator_id,
        )

    def _validate_recording_boundary(self) -> None:
        if self._turn_number == 0:
            return
        if (
            self._last_provenance.get("recording_mode") != "sync"
            or self._last_provenance.get("recording_flush")
            not in DURABLE_SYNC_FLUSH_POLICIES
        ):
            raise ValueError(
                "checkpoint requires a durable quiescent recording boundary "
                "(recording_mode=sync, recording_flush=manual|auto)"
            )
        receipt = self._last_provenance.get("runtime_receipt_sha256")
        if (
            not isinstance(receipt, str)
            or re.fullmatch(r"[0-9a-f]{64}", receipt) is None
        ):
            raise ValueError(
                "checkpoint requires a SHA-256-bound runtime recording receipt"
            )

    def _validate_no_pending_background_records(self, workspace_fd: int) -> None:
        pending = self._campaign_relative() / "logs" / "pending-turns"
        _present, files, _directories = _tree_inventory_at(workspace_fd, pending)
        if files:
            raise ValueError(
                "checkpoint recording boundary is not quiescent: "
                "pending background recorder batches remain"
            )

    def _validate_runtime_evidence_at(
        self,
        root_fd: int,
        session_id: str,
        provenance: dict[str, Any],
        *,
        prefix: Path | None = None,
    ) -> dict[str, Any]:
        base = (prefix or Path()) / self._campaign_relative() / "logs"
        live_fd = -1
        telemetry_fd = -1
        try:
            try:
                live_fd = _open_regular_at(root_fd, base / "live-turn-runtime.jsonl")
            except ValueError as exc:
                raise ValueError(
                    "live runtime receipt log is missing or unsafe"
                ) from exc
            try:
                telemetry_fd = _open_regular_at(
                    root_fd, base / "runtime-telemetry.jsonl"
                )
            except ValueError as exc:
                raise ValueError("runtime telemetry log is missing or unsafe") from exc
            return _validate_runtime_evidence_fds(
                live_fd,
                telemetry_fd,
                expected_receipt_sha256=str(
                    provenance.get("runtime_receipt_sha256") or ""
                ),
                session_id=session_id,
                investigator_id=self.investigator_id,
                expected_model_identity=_validated_model_identity(
                    provenance.get("model_identity")
                ),
            )
        finally:
            if telemetry_fd >= 0:
                os.close(telemetry_fd)
            if live_fd >= 0:
                os.close(live_fd)

    def _validate_snapshotted_state_at(
        self,
        checkpoint_fd: int,
        state_files: list[dict[str, Any]],
        session_id: str,
    ) -> None:
        entry_fds: dict[str, int] = {}
        try:
            for entry in state_files:
                descriptor = _open_regular_at(checkpoint_fd, entry["path"])
                entry_fds[entry["workspace_path"]] = descriptor
            self._validate_snapshot_identities(entry_fds)
            session_fd = entry_fds.get(".coc/runtime/sessions.json")
            if session_fd is None:
                raise ValueError("snapshotted session state is missing")
            payload = _read_json_fd(session_fd, "snapshotted session state")
            sanitized, _record = _sanitized_session_payload(
                payload,
                session_id=session_id,
                campaign_id=self.campaign_id,
                investigator_id=self.investigator_id,
            )
            if _read_fd_bytes(session_fd) != sanitized:
                raise ValueError("snapshotted session state is not canonical")
        finally:
            for descriptor in entry_fds.values():
                os.close(descriptor)

    def write_checkpoint(
        self,
        session_id: str,
        turn_number: int,
        reason: str,
    ) -> Path:
        """Write an immutable allowlisted snapshot and its checksum manifest."""

        if (
            isinstance(turn_number, bool)
            or not isinstance(turn_number, int)
            or turn_number < 0
            or turn_number != self._turn_number
        ):
            raise ValueError(
                f"checkpoint turn must equal current integer turn {self._turn_number}"
            )
        self._validate_identifier(session_id, "session_id")
        self._validate_recording_boundary()
        model_identity = _validated_model_identity(
            self._last_provenance.get("model_identity")
        )
        workspace_fd = self._open_workspace_root()
        try:
            run_fd = self._open_run_dir()
        except Exception:
            os.close(workspace_fd)
            raise
        ledger_fd = -1
        checkpoints_fd = -1
        temporary_fd = -1
        campaign_lock = None
        investigator_guard = None
        checkpoint_name = f"turn-{turn_number:06d}"
        temporary_name = f".{checkpoint_name}.{uuid.uuid4().hex}.tmp"
        published = False
        state_files: list[dict[str, Any]] = []
        scenario_hashes: dict[str, str] = {}
        source_hashes: dict[str, str] = {}
        index_hashes: dict[str, str] = {}
        managed_mutable_trees: dict[str, dict[str, Any]] = {}
        immutable_trees: dict[str, dict[str, Any]] = {}
        managed_file_presence: dict[str, bool] = {}
        session_snapshot_sha256 = ""
        try:
            lock_candidate = _campaign_lock_at(workspace_fd, self._campaign_relative())
            lock_candidate.__enter__()
            campaign_lock = lock_candidate
            guard_candidate = (
                coc_investigator_guard.guard_reusable_investigators(
                    self.workspace / ".coc", [self.investigator_id]
                )
            )
            guard_candidate.__enter__()
            investigator_guard = guard_candidate
            self._validate_no_pending_background_records(workspace_fd)
            if self._turn_number > 0:
                self._validate_runtime_evidence_at(
                    workspace_fd,
                    session_id,
                    self._last_provenance,
                )
            self._validate_action_ledger_entry(run_fd)
            try:
                ledger_info = os.stat(
                    "actions.jsonl", dir_fd=run_fd, follow_symlinks=False
                )
            except FileNotFoundError:
                ledger_info = None
            if ledger_info is None:
                if self._turn_number != 0 or self.action_chain_sha256 != GENESIS_SHA256:
                    raise ValueError("action journal is missing for the current turn")
            else:
                if not stat.S_ISREG(ledger_info.st_mode):
                    raise ValueError("action ledger symlink or non-regular path")
                ledger_fd = _open_regular_at(run_fd, "actions.jsonl")
                _validate_action_journal_fd(
                    ledger_fd,
                    self.action_chain_sha256,
                    self._turn_number,
                    model_identity,
                )

            self._validate_workspace_identities(workspace_fd)
            workspace_files = self._workspace_relative_files(workspace_fd)
            character_relative = self._investigator_relative() / "character.json"
            if character_relative not in workspace_files:
                raise ValueError("selected investigator character.json is required")
            session_payload, _session_record = self._session_snapshot_bytes(
                workspace_fd, session_id
            )
            managed_mutable_trees = self._tree_metadata(
                workspace_fd,
                CAMPAIGN_MUTABLE_TREES,
                derive_directories_from_files=True,
                require_present=True,
            )
            immutable_trees = self._tree_metadata(
                workspace_fd, CAMPAIGN_IMMUTABLE_TREES
            )
            optional_paths = [
                self._campaign_relative() / "party.json",
                *(self._investigator_relative() / name for name in INVESTIGATOR_FILES),
                Path(".coc") / "runtime" / "sessions.json",
                Path(".coc") / "playtest-runs" / self.campaign_id / "actions.jsonl",
            ]
            managed_file_presence = {
                path.as_posix(): (
                    ledger_fd >= 0
                    if path.parts[-1:] == ("actions.jsonl",)
                    else path in workspace_files
                )
                for path in optional_paths
            }

            checkpoints_fd = _open_or_create_directory_at(run_fd, "checkpoints")
            os.fsync(run_fd)
            try:
                os.stat(checkpoint_name, dir_fd=checkpoints_fd, follow_symlinks=False)
            except FileNotFoundError:
                pass
            else:
                raise FileExistsError(
                    f"checkpoint already exists: {self.run_dir / 'checkpoints' / checkpoint_name}"
                )

            os.mkdir(temporary_name, 0o700, dir_fd=checkpoints_fd)
            temporary_fd = _open_directory_at(checkpoints_fd, temporary_name)

            # Empty mutable roots carry canonical state: unlike optional
            # immutable inputs, absence must not be interchangeable with an
            # empty tree. Materialize only the root and file-derived parent
            # directories, never arbitrary empty workspace subdirectories.
            for root, metadata in managed_mutable_trees.items():
                for member in metadata["directories"]:
                    relative = (
                        Path("state") / root
                        if member == "."
                        else Path("state") / root / member
                    )
                    directory_fd = _open_or_create_directory_at(
                        temporary_fd, relative
                    )
                    try:
                        os.fsync(directory_fd)
                    finally:
                        os.close(directory_fd)

            def snapshot_fd(
                source_fd: int,
                workspace_relative: Path,
                *,
                validate_journal: bool = False,
            ) -> tuple[str, int]:
                parent_fd = -1
                target_fd = -1
                try:
                    destination_relative = Path("state") / workspace_relative
                    parent_fd = _open_or_create_directory_at(
                        temporary_fd, destination_relative.parent
                    )
                    flags = os.O_RDWR | os.O_CREAT | os.O_EXCL
                    if hasattr(os, "O_NOFOLLOW"):
                        flags |= os.O_NOFOLLOW
                    target_fd = os.open(
                        destination_relative.name,
                        flags,
                        0o600,
                        dir_fd=parent_fd,
                    )
                    checksum, size = _copy_fd_to_fd(source_fd, target_fd)
                    if validate_journal:
                        _validate_action_journal_fd(
                            target_fd,
                            self.action_chain_sha256,
                            self._turn_number,
                            model_identity,
                        )
                    os.fsync(parent_fd)
                finally:
                    if target_fd >= 0:
                        os.close(target_fd)
                    if parent_fd >= 0:
                        os.close(parent_fd)
                state_files.append(
                    {
                        "path": destination_relative.as_posix(),
                        "workspace_path": workspace_relative.as_posix(),
                        "sha256": checksum,
                        "size": size,
                    }
                )
                return checksum, size

            def snapshot_file(
                root_fd: int,
                source_relative: Path,
                workspace_relative: Path,
            ) -> tuple[str, int]:
                source_fd = _open_regular_at(root_fd, source_relative)
                try:
                    return snapshot_fd(source_fd, workspace_relative)
                finally:
                    os.close(source_fd)

            def snapshot_payload(
                payload: bytes, workspace_relative: Path
            ) -> tuple[str, int]:
                source_fd = -1
                try:
                    # The payload is already validated and contains no source
                    # path.  A private anonymous temporary FD lets the existing
                    # verified-FD copy path remain the single snapshot writer.
                    source_fd = os.open(
                        temporary_name,
                        os.O_RDWR | os.O_CREAT | os.O_EXCL,
                        0o600,
                        dir_fd=temporary_fd,
                    )
                    os.unlink(temporary_name, dir_fd=temporary_fd)
                    _write_all(source_fd, payload)
                    os.lseek(source_fd, 0, os.SEEK_SET)
                    return snapshot_fd(source_fd, workspace_relative)
                finally:
                    if source_fd >= 0:
                        os.close(source_fd)

            sessions_relative = Path(".coc") / "runtime" / "sessions.json"
            for relative in workspace_files:
                if relative == sessions_relative:
                    continue
                checksum, _size = snapshot_file(workspace_fd, relative, relative)
                campaign_prefix = (".coc", "campaigns", self.campaign_id)
                if relative.parts[:4] == (*campaign_prefix, "scenario"):
                    scenario_hashes[relative.as_posix()] = checksum
                if relative.parts[:4] == (*campaign_prefix, "source"):
                    source_hashes[relative.as_posix()] = checksum
                if relative.parts[:4] == (*campaign_prefix, "index"):
                    index_hashes[relative.as_posix()] = checksum

            session_snapshot_sha256, _session_size = snapshot_payload(
                session_payload, sessions_relative
            )

            if ledger_fd >= 0:
                journal_relative = (
                    Path(".coc") / "playtest-runs" / self.campaign_id / "actions.jsonl"
                )
                snapshot_fd(
                    ledger_fd,
                    journal_relative,
                    validate_journal=True,
                )

            # Bind structured identities to the exact bytes inside the
            # unpublished checkpoint, not merely to earlier live-workspace
            # reads that could have changed before their snapshot FD opened.
            self._validate_snapshotted_state_at(temporary_fd, state_files, session_id)
            if self._turn_number > 0:
                self._validate_runtime_evidence_at(
                    temporary_fd,
                    session_id,
                    self._last_provenance,
                    prefix=Path("state"),
                )
            self._validate_no_pending_background_records(workspace_fd)

            legacy_source_hash = ""
            if source_hashes:
                legacy_source_hash = source_hashes[sorted(source_hashes)[0]]
            manifest = {
                "schema_version": SCHEMA_VERSION,
                "run_id": self.campaign_id,
                "turn_number": turn_number,
                "reason": reason,
                "session_id": session_id,
                "git_head": self.git_head,
                "source_pdf_sha256": legacy_source_hash,
                "source_hashes": source_hashes,
                "scenario_hashes": scenario_hashes,
                "index_hashes": index_hashes,
                "immutable_trees": immutable_trees,
                "managed_mutable_trees": managed_mutable_trees,
                "managed_file_presence": managed_file_presence,
                "state_files": state_files,
                "session_snapshot_sha256": session_snapshot_sha256,
                "action_chain_sha256": self.action_chain_sha256,
                "model_identity": model_identity,
                "invalidation_state": {"invalidated": False, "segments": []},
                "player_mode": self._last_provenance.get("player_mode"),
            }
            _write_new_file_at(
                temporary_fd,
                "manifest.json",
                _canonical_json(manifest) + b"\n",
            )
            os.fsync(temporary_fd)

            _require_directory_identity_at(
                run_fd, "checkpoints", checkpoints_fd, "checkpoints"
            )
            _require_directory_identity_at(
                checkpoints_fd, temporary_name, temporary_fd, "temporary checkpoint"
            )
            self._require_workspace_root_identity(workspace_fd)
            os.rename(
                temporary_name,
                checkpoint_name,
                src_dir_fd=checkpoints_fd,
                dst_dir_fd=checkpoints_fd,
            )
            try:
                _require_directory_identity_at(
                    run_fd, "checkpoints", checkpoints_fd, "checkpoints"
                )
            except Exception:
                _remove_tree_at(checkpoints_fd, checkpoint_name)
                raise
            published = True
            os.fsync(checkpoints_fd)
            os.fsync(run_fd)
        finally:
            if investigator_guard is not None:
                investigator_guard.__exit__(None, None, None)
            if campaign_lock is not None:
                campaign_lock.__exit__(None, None, None)
            if ledger_fd >= 0:
                os.close(ledger_fd)
            if workspace_fd >= 0:
                os.close(workspace_fd)
            if temporary_fd >= 0:
                os.close(temporary_fd)
            if not published and checkpoints_fd >= 0:
                try:
                    _remove_tree_at(checkpoints_fd, temporary_name)
                except (OSError, ValueError):
                    pass
            if checkpoints_fd >= 0:
                os.close(checkpoints_fd)
            os.close(run_fd)

        return self.run_dir / "checkpoints" / checkpoint_name

    def restore_checkpoint(
        self, checkpoint_dir: Path | str, target: Path | str
    ) -> dict[str, Any]:
        """Validate an immutable checkpoint completely, then restore it.

        Validation is intentionally completed before the first target write.
        A malformed manifest, stale source, hostile symlink, or incompatible
        code revision therefore cannot leave a half-restored workspace.
        """

        checkpoint_path = Path(checkpoint_dir).absolute()
        checkpoints_root = (self.run_dir / "checkpoints").absolute()
        try:
            checkpoint_relative = _safe_relative_path(
                checkpoint_path.relative_to(checkpoints_root)
            )
        except ValueError as exc:
            raise ValueError("checkpoint containment violation or traversal") from exc

        run_fd = self._open_run_dir()
        checkpoint_fd = -1
        target_fd = -1
        workspace_fd = -1
        source_lock = None
        target_lock = None
        target_mutated = False
        entries: list[tuple[dict[str, Any], int]] = []
        try:
            checkpoint_fd = _open_directory_at(
                run_fd, Path("checkpoints") / checkpoint_relative
            )
            manifest_fd = _open_regular_at(checkpoint_fd, "manifest.json")
            try:
                with os.fdopen(manifest_fd, "r", encoding="utf-8") as handle:
                    manifest_fd = -1
                    manifest = json.load(handle)
            except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise ValueError("invalid checkpoint manifest") from exc
            finally:
                if manifest_fd >= 0:
                    os.close(manifest_fd)
            if not isinstance(manifest, dict):
                raise ValueError("invalid checkpoint manifest")

            workspace_fd = self._open_workspace_root()
            source_lock_candidate = _campaign_lock_at(
                workspace_fd, self._campaign_relative()
            )
            source_lock_candidate.__enter__()
            source_lock = source_lock_candidate
            self._validate_manifest_identity(manifest, checkpoint_path)
            entries = self._validate_state_files(manifest, checkpoint_fd)

            target_path = Path(target).absolute()
            target_fd = _open_directory_path(target_path, "target")
            self._validate_fresh_target_at(entries, target_fd)

            target_lock_candidate = _campaign_lock_at(
                target_fd, self._campaign_relative()
            )
            # The lock helper creates the selected campaign directory.  From
            # this point onward cleanup owns only the fresh-generation paths
            # that preflight proved absent, even if lock acquisition is raced.
            target_mutated = True
            target_lock_candidate.__enter__()
            target_lock = target_lock_candidate

            for field in ("managed_mutable_trees", "immutable_trees"):
                for root, metadata in manifest[field].items():
                    if not metadata["present"]:
                        continue
                    for member in metadata["directories"]:
                        relative = Path(root) if member == "." else Path(root) / member
                        directory_fd = _open_or_create_directory_at(target_fd, relative)
                        os.close(directory_fd)

            # Every source FD stays open from checksum validation through the
            # atomic, target-dirfd-relative copy.
            for entry, source_fd in entries:
                relative = Path(entry["workspace_path"])
                _require_directory_path_identity(target_path, target_fd, "target")
                self._restore_file_atomic_at(
                    source_fd,
                    target_fd,
                    relative,
                    entry["sha256"],
                    entry["size"],
                )
            _require_directory_path_identity(target_path, target_fd, "target")
            os.fsync(target_fd)
            target_lock.__exit__(None, None, None)
            target_lock = None
            return manifest
        except Exception:
            if target_lock is not None:
                target_lock.__exit__(None, None, None)
                target_lock = None
            if target_mutated and target_fd >= 0:
                for relative in (
                    self._campaign_relative(),
                    self._investigator_relative(),
                    Path(".coc") / "playtest-runs" / self.campaign_id,
                ):
                    try:
                        _remove_relative_tree_at(target_fd, relative)
                    except (OSError, ValueError):
                        pass
                for relative in (Path(".coc") / "runtime" / "sessions.json",):
                    try:
                        _unlink_file_at(target_fd, relative)
                    except (OSError, ValueError):
                        pass
            raise
        finally:
            if target_lock is not None:
                target_lock.__exit__(None, None, None)
            if source_lock is not None:
                source_lock.__exit__(None, None, None)
            for _entry, source_fd in entries:
                os.close(source_fd)
            if workspace_fd >= 0:
                os.close(workspace_fd)
            if target_fd >= 0:
                os.close(target_fd)
            if checkpoint_fd >= 0:
                os.close(checkpoint_fd)
            os.close(run_fd)

    @staticmethod
    def _safe_relative(value: Any, field: str) -> Path:
        if not isinstance(value, str) or not value or "\x00" in value:
            raise ValueError(f"invalid {field}: containment violation")
        relative = Path(value)
        if relative.is_absolute() or any(
            part in {"", ".", ".."} for part in relative.parts
        ):
            raise ValueError(f"invalid {field}: traversal is not allowed")
        return relative

    def _current_workspace_hashes(
        self,
    ) -> tuple[
        dict[str, str],
        dict[str, str],
        dict[str, str],
        dict[str, dict[str, Any]],
    ]:
        """Hash live immutable inputs through one verified workspace descriptor."""

        workspace_fd = self._open_workspace_root()
        source_hashes: dict[str, str] = {}
        scenario_hashes: dict[str, str] = {}
        index_hashes: dict[str, str] = {}
        try:
            campaign = self._campaign_relative()
            for name, target in (
                ("source", source_hashes),
                ("scenario", scenario_hashes),
                ("index", index_hashes),
            ):
                _present, files, _directories = _tree_inventory_at(
                    workspace_fd, campaign / name
                )
                for relative in files:
                    source_fd = _open_regular_at(workspace_fd, relative)
                    try:
                        checksum, _size = _sha256_fd(source_fd)
                    finally:
                        os.close(source_fd)
                    target[relative.as_posix()] = checksum
            immutable_trees = self._tree_metadata(
                workspace_fd, CAMPAIGN_IMMUTABLE_TREES
            )
            self._require_workspace_root_identity(workspace_fd)
        finally:
            os.close(workspace_fd)
        return source_hashes, scenario_hashes, index_hashes, immutable_trees

    def _validate_manifest_identity(
        self, manifest: dict[str, Any], checkpoint_path: Path
    ) -> None:
        version = manifest.get("schema_version")
        if (
            isinstance(version, bool)
            or not isinstance(version, int)
            or version != SCHEMA_VERSION
        ):
            raise ValueError("checkpoint schema version mismatch")
        if manifest.get("run_id") != self.campaign_id:
            raise ValueError("checkpoint run id mismatch")
        try:
            self._validate_identifier(manifest.get("session_id"), "session_id")
        except (TypeError, ValueError) as exc:
            raise ValueError("checkpoint session id mismatch") from exc
        manifest_turn = manifest.get("turn_number")
        if (
            isinstance(manifest_turn, bool)
            or not isinstance(manifest_turn, int)
            or manifest_turn < 0
        ):
            raise ValueError("checkpoint turn number is invalid")
        manifest_model = _validated_model_identity(manifest.get("model_identity"))
        expected_chain, boundary_provenance = self._outer_journal_boundary(
            manifest_turn
        )
        if manifest.get("player_mode") != boundary_provenance.get("player_mode"):
            raise ValueError("checkpoint player mode mismatch")
        if manifest_model != _validated_model_identity(
            boundary_provenance.get("model_identity")
        ):
            raise ValueError("checkpoint model identity mismatch")
        if manifest.get("action_chain_sha256") != expected_chain:
            raise ValueError("checkpoint action chain checksum mismatch")

        (
            expected_sources,
            expected_scenarios,
            expected_indexes,
            expected_immutable_trees,
        ) = self._current_workspace_hashes()
        if manifest.get("source_hashes") != expected_sources:
            raise ValueError("checkpoint source hashes mismatch")
        expected_source = ""
        if expected_sources:
            expected_source = expected_sources[sorted(expected_sources)[0]]
        if manifest.get("source_pdf_sha256") != expected_source:
            raise ValueError("checkpoint source hash mismatch")

        if manifest.get("scenario_hashes") != expected_scenarios:
            raise ValueError("checkpoint scenario hash mismatch")
        if manifest.get("index_hashes") != expected_indexes:
            raise ValueError("checkpoint index hash mismatch")
        if manifest.get("immutable_trees") != expected_immutable_trees:
            raise ValueError("checkpoint immutable tree membership mismatch")

        old_head = manifest.get("git_head")
        if old_head != self.git_head:
            state = manifest.get("invalidation_state")
            segments = state.get("segments") if isinstance(state, dict) else None
            valid = isinstance(segments, list) and any(
                isinstance(segment, dict)
                and set(segment)
                == {"kind", "old_commit", "new_commit", "replay_start_checkpoint"}
                and segment.get("kind") == "invalidated_segment"
                and segment.get("old_commit") == old_head
                and segment.get("new_commit") == self.git_head
                and segment.get("replay_start_checkpoint") == checkpoint_path.name
                for segment in segments
            )
            if not valid:
                raise ValueError(
                    "checkpoint Git HEAD mismatch requires an exact invalidated segment"
                )

    def _restore_destination_is_allowlisted(self, relative: Path) -> bool:
        parts = relative.parts
        campaign_prefix = (".coc", "campaigns", self.campaign_id)
        investigator_prefix = (".coc", "investigators", self.investigator_id)
        journal = (
            ".coc",
            "playtest-runs",
            self.campaign_id,
            "actions.jsonl",
        )
        return (
            parts == (*campaign_prefix, "campaign.json")
            or parts == (*campaign_prefix, "party.json")
            or (
                len(parts) >= 5
                and parts[:3] == campaign_prefix
                and parts[3]
                in {
                    *CAMPAIGN_MUTABLE_TREES,
                    *CAMPAIGN_IMMUTABLE_TREES,
                }
            )
            or (
                len(parts) == 4
                and parts[:3] == investigator_prefix
                and parts[3] in INVESTIGATOR_FILES
            )
        ) or parts in {
            (".coc", "runtime", "sessions.json"),
            journal,
        }

    def _validate_state_files(
        self, manifest: dict[str, Any], checkpoint_fd: int
    ) -> list[tuple[dict[str, Any], int]]:
        raw_entries = manifest.get("state_files")
        if not isinstance(raw_entries, list) or not raw_entries:
            raise ValueError("invalid checkpoint state files")
        entries: list[tuple[dict[str, Any], int]] = []
        seen_workspace_paths: set[str] = set()
        source_from_entries: dict[str, str] = {}
        scenario_from_entries: dict[str, str] = {}
        index_from_entries: dict[str, str] = {}
        session_hash = ""
        journal_fd: int | None = None
        session_fd: int | None = None
        entry_fds: dict[str, int] = {}
        journal_workspace = (
            Path(".coc") / "playtest-runs" / self.campaign_id / "actions.jsonl"
        )
        try:
            for raw in raw_entries:
                if not isinstance(raw, dict) or set(raw) != {
                    "path",
                    "workspace_path",
                    "sha256",
                    "size",
                }:
                    raise ValueError("invalid checkpoint state file entry")
                stored_relative = self._safe_relative(raw["path"], "checkpoint path")
                workspace_relative = self._safe_relative(
                    raw["workspace_path"], "workspace path"
                )
                if not self._restore_destination_is_allowlisted(workspace_relative):
                    raise ValueError(
                        f"checkpoint restore destination is outside allowlist: {workspace_relative}"
                    )
                if stored_relative != Path("state") / workspace_relative:
                    raise ValueError(
                        "checkpoint state path does not match restore destination"
                    )
                canonical_workspace = workspace_relative.as_posix()
                if canonical_workspace in seen_workspace_paths:
                    raise ValueError("duplicate checkpoint workspace path")
                seen_workspace_paths.add(canonical_workspace)
                if (
                    not isinstance(raw["size"], int)
                    or isinstance(raw["size"], bool)
                    or raw["size"] < 0
                    or not isinstance(raw["sha256"], str)
                    or len(raw["sha256"]) != 64
                ):
                    raise ValueError("invalid checkpoint state file size or checksum")

                source_fd = _open_regular_at(checkpoint_fd, stored_relative)
                try:
                    checksum, size = _sha256_fd(source_fd)
                    if size != raw["size"] or checksum != raw["sha256"]:
                        raise ValueError(f"checkpoint checksum mismatch: {raw['path']}")
                    parts = workspace_relative.parts
                    prefix = (".coc", "campaigns", self.campaign_id)
                    if parts[:4] == (*prefix, "source"):
                        source_from_entries[canonical_workspace] = checksum
                    if parts[:4] == (*prefix, "scenario"):
                        scenario_from_entries[canonical_workspace] = checksum
                    if parts[:4] == (*prefix, "index"):
                        index_from_entries[canonical_workspace] = checksum
                    if workspace_relative == Path(".coc/runtime/sessions.json"):
                        session_hash = checksum
                        session_fd = source_fd
                    entries.append((raw, source_fd))
                    entry_fds[canonical_workspace] = source_fd
                    if workspace_relative == journal_workspace:
                        journal_fd = source_fd
                    source_fd = -1
                finally:
                    if source_fd >= 0:
                        os.close(source_fd)
            if source_from_entries != manifest.get("source_hashes"):
                raise ValueError("checkpoint source manifest mismatch")
            if scenario_from_entries != manifest.get("scenario_hashes"):
                raise ValueError("checkpoint scenario manifest mismatch")
            if index_from_entries != manifest.get("index_hashes"):
                raise ValueError("checkpoint index manifest mismatch")
            if session_hash != manifest.get("session_snapshot_sha256"):
                raise ValueError("checkpoint session snapshot checksum mismatch")
            campaign_state_path = (
                self._campaign_relative() / "campaign.json"
            ).as_posix()
            if campaign_state_path not in seen_workspace_paths:
                raise ValueError("checkpoint campaign state is missing")

            mutable_trees = self._validate_tree_manifest(
                manifest.get("managed_mutable_trees"),
                CAMPAIGN_MUTABLE_TREES,
                "managed mutable tree",
            )
            immutable_trees = self._validate_tree_manifest(
                manifest.get("immutable_trees"),
                CAMPAIGN_IMMUTABLE_TREES,
                "immutable tree",
            )
            for root, metadata in mutable_trees.items():
                if metadata["present"] is not True:
                    raise ValueError(
                        f"canonical mutable root is required in checkpoint: {root}"
                    )
            for root, metadata in {**mutable_trees, **immutable_trees}.items():
                has_files = any(
                    path.startswith(root + "/") for path in seen_workspace_paths
                )
                if not metadata["present"] and has_files:
                    raise ValueError(f"absent checkpoint tree contains files: {root}")
            for root, metadata in mutable_trees.items():
                tree_files = [
                    Path(path)
                    for path in seen_workspace_paths
                    if path.startswith(root + "/")
                ]
                expected_directories = _tree_directories_from_files(
                    Path(root), tree_files, present=metadata["present"]
                )
                if metadata["directories"] != expected_directories:
                    raise ValueError(
                        f"managed mutable tree directory membership mismatch: {root}"
                    )
                state_root = Path("state") / root
                present, stored_files, stored_directories = _tree_inventory_at(
                    checkpoint_fd, state_root
                )
                if not present:
                    raise ValueError(
                        f"canonical mutable state root is required: {root}"
                    )
                if stored_directories != metadata["directories"]:
                    raise ValueError(
                        f"managed mutable tree directory membership mismatch: {root}"
                    )
                stored_workspace_paths = {
                    path.relative_to(Path("state")).as_posix()
                    for path in stored_files
                }
                expected_workspace_paths = {
                    path
                    for path in seen_workspace_paths
                    if path.startswith(root + "/")
                }
                if stored_workspace_paths != expected_workspace_paths:
                    raise ValueError(
                        f"managed mutable tree state membership mismatch: {root}"
                    )

            expected_presence_paths = {
                (self._campaign_relative() / "party.json").as_posix(),
                *(
                    (self._investigator_relative() / name).as_posix()
                    for name in INVESTIGATOR_FILES
                ),
                ".coc/runtime/sessions.json",
                journal_workspace.as_posix(),
            }
            presence = manifest.get("managed_file_presence")
            if (
                not isinstance(presence, dict)
                or set(presence) != expected_presence_paths
                or not all(type(value) is bool for value in presence.values())
            ):
                raise ValueError("invalid managed file presence manifest")
            for path, expected_present in presence.items():
                if (path in seen_workspace_paths) != expected_present:
                    raise ValueError(f"managed file presence mismatch: {path}")

            if session_fd is None:
                raise ValueError("checkpoint session snapshot is missing")
            session_payload = _read_json_fd(session_fd, "session snapshot")
            sanitized, _record = _sanitized_session_payload(
                session_payload,
                session_id=manifest.get("session_id"),
                campaign_id=self.campaign_id,
                investigator_id=self.investigator_id,
            )
            if _read_fd_bytes(session_fd) != sanitized:
                raise ValueError("checkpoint session snapshot is not canonical")

            self._validate_snapshot_identities(entry_fds)
            manifest_turn = manifest["turn_number"]
            manifest_chain = manifest.get("action_chain_sha256")
            manifest_model_identity = _validated_model_identity(
                manifest.get("model_identity")
            )
            if journal_fd is None:
                if manifest_turn != 0 or manifest_chain != GENESIS_SHA256:
                    raise ValueError(
                        "action journal is missing for a non-empty checkpoint"
                    )
            else:
                _validate_action_journal_fd(
                    journal_fd,
                    manifest_chain,
                    manifest_turn,
                    manifest_model_identity,
                )
                terminal_provenance = _terminal_journal_provenance_fd(journal_fd)
                if (
                    terminal_provenance.get("recording_mode") != "sync"
                    or terminal_provenance.get("recording_flush")
                    not in DURABLE_SYNC_FLUSH_POLICIES
                ):
                    raise ValueError(
                        "checkpoint journal lacks a synchronous runtime receipt"
                    )
                live_path = (
                    self._campaign_relative() / "logs" / "live-turn-runtime.jsonl"
                ).as_posix()
                telemetry_path = (
                    self._campaign_relative() / "logs" / "runtime-telemetry.jsonl"
                ).as_posix()
                live_runtime_fd = entry_fds.get(live_path)
                telemetry_receipt_fd = entry_fds.get(telemetry_path)
                if live_runtime_fd is None or telemetry_receipt_fd is None:
                    raise ValueError("checkpoint runtime receipt evidence is missing")
                _validate_runtime_evidence_fds(
                    live_runtime_fd,
                    telemetry_receipt_fd,
                    expected_receipt_sha256=str(
                        terminal_provenance.get("runtime_receipt_sha256") or ""
                    ),
                    session_id=manifest["session_id"],
                    investigator_id=self.investigator_id,
                    expected_model_identity=_validated_model_identity(
                        terminal_provenance.get("model_identity")
                    ),
                )
            return entries
        except Exception:
            for _entry, source_fd in entries:
                os.close(source_fd)
            raise

    def _validate_tree_manifest(
        self,
        raw: Any,
        names: tuple[str, ...],
        field: str,
    ) -> dict[str, dict[str, Any]]:
        expected_roots = {
            (self._campaign_relative() / name).as_posix() for name in names
        }
        if not isinstance(raw, dict) or set(raw) != expected_roots:
            raise ValueError(f"invalid {field} manifest")
        validated: dict[str, dict[str, Any]] = {}
        for root, value in raw.items():
            if (
                not isinstance(value, dict)
                or set(value) != {"present", "directories"}
                or type(value.get("present")) is not bool
                or not isinstance(value.get("directories"), list)
                or not all(isinstance(item, str) for item in value["directories"])
                or value["directories"] != sorted(set(value["directories"]))
            ):
                raise ValueError(f"invalid {field} membership")
            directories = value["directories"]
            if value["present"] != ("." in directories):
                raise ValueError(f"invalid {field} presence")
            for member in directories:
                if member == ".":
                    continue
                self._safe_relative(member, f"{field} directory")
            validated[root] = {
                "present": value["present"],
                "directories": list(directories),
            }
        return validated

    def _validate_snapshot_identities(self, entry_fds: dict[str, int]) -> None:
        def optional_json(path: Path, field: str) -> dict[str, Any] | None:
            descriptor = entry_fds.get(path.as_posix())
            return None if descriptor is None else _read_json_fd(descriptor, field)

        campaign = self._campaign_relative()
        campaign_state = optional_json(campaign / "campaign.json", "campaign state")
        if (
            campaign_state is None
            or campaign_state.get("campaign_id") != self.campaign_id
        ):
            raise ValueError("checkpoint campaign identity mismatch")
        party = optional_json(campaign / "party.json", "party state")
        if party is not None:
            members = party.get("investigator_ids")
            active = party.get("active_investigator_ids")
            if (
                not isinstance(members, list)
                or self.investigator_id not in members
                or (
                    active is not None
                    and (
                        not isinstance(active, list)
                        or self.investigator_id not in active
                    )
                )
                or party.get("campaign_id") not in {None, self.campaign_id}
            ):
                raise ValueError("checkpoint party identity mismatch")
        investigator_root = self._investigator_relative()
        character = optional_json(
            investigator_root / "character.json",
            "selected investigator character",
        )
        if character is None:
            raise ValueError("checkpoint selected investigator character is missing")
        creation = optional_json(
            investigator_root / "creation.json",
            "selected investigator creation",
        )
        _validate_investigator_documents(character, creation, self.investigator_id)
        investigator = optional_json(
            campaign / "save" / "investigator-state" / f"{self.investigator_id}.json",
            "investigator save state",
        )
        if investigator is not None and (
            investigator.get("campaign_id") != self.campaign_id
            or investigator.get("investigator_id") != self.investigator_id
        ):
            raise ValueError("checkpoint investigator identity mismatch")
        world = optional_json(campaign / "save" / "world-state.json", "world state")
        module = optional_json(
            campaign / "scenario" / "module-meta.json", "module metadata"
        )
        if world is not None and module is not None:
            world_scenario = world.get("scenario_id")
            module_scenario = module.get("scenario_id")
            if (
                isinstance(world_scenario, str)
                and isinstance(module_scenario, str)
                and world_scenario != module_scenario
            ):
                raise ValueError("checkpoint scenario identity mismatch")

    def _validate_fresh_target_at(
        self,
        entries: list[tuple[dict[str, Any], int]],
        target_fd: int,
    ) -> None:
        try:
            root_names = sorted(os.listdir(target_fd))
        except OSError as exc:
            raise ValueError("target generation cannot be enumerated") from exc
        if root_names != [".coc"]:
            raise ValueError("restore target must be a fresh workspace generation")
        present, files, directories = _tree_inventory_at(target_fd, Path(".coc"))
        if not present:
            raise ValueError("restore target must provide local .coc configuration")
        for relative in files:
            parts = relative.parts
            allowed = (
                parts == (".coc", "runtime.json")
                or parts[:2] == (".coc", "indexes")
                or parts[:2] == (".coc", "module-library")
            )
            if not allowed:
                raise ValueError(
                    f"restore target contains a managed or unrelated file: {relative}"
                )
        for member in directories:
            if member == ".":
                continue
            parts = Path(member).parts
            if parts in {
                ("campaigns",),
                ("investigators",),
                ("runtime",),
                ("playtest-runs",),
                ("indexes",),
                ("module-library",),
            }:
                continue
            if parts[:1] in {("indexes",), ("module-library",)}:
                continue
            raise ValueError("restore target contains an existing managed generation")

        runtime = self._json_object_at(
            target_fd, Path(".coc") / "runtime.json", "target runtime config"
        )
        session_entry = next(
            (
                source_fd
                for entry, source_fd in entries
                if entry["workspace_path"] == ".coc/runtime/sessions.json"
            ),
            None,
        )
        if session_entry is None:
            raise ValueError("checkpoint session snapshot is missing")
        session_payload = _read_json_fd(session_entry, "session snapshot")
        _sanitized, session_record = _sanitized_session_payload(
            session_payload,
            session_id=session_payload["sessions"][0].get("session_id"),
            campaign_id=self.campaign_id,
            investigator_id=self.investigator_id,
        )
        if _brain_label_for_config(runtime) != session_record["brain_at_create"]:
            raise ValueError("target runtime configuration is incompatible")

        campaign_index = self._json_object_at(
            target_fd,
            Path(".coc") / "indexes" / "campaigns.json",
            "target campaign index",
        )
        investigator_index = self._json_object_at(
            target_fd,
            Path(".coc") / "indexes" / "investigators.json",
            "target investigator index",
        )
        campaigns = campaign_index.get("campaigns")
        investigators = investigator_index.get("investigators")
        campaign_item = (
            campaigns.get(self.campaign_id) if isinstance(campaigns, dict) else None
        )
        investigator_item = (
            investigators.get(self.investigator_id)
            if isinstance(investigators, dict)
            else None
        )
        if (
            not isinstance(campaign_item, dict)
            or campaign_item.get("campaign_id") != self.campaign_id
            or campaign_item.get("path")
            != f".coc/campaigns/{self.campaign_id}/campaign.json"
        ):
            raise ValueError("target campaign index is not prepared")
        if (
            not isinstance(investigator_item, dict)
            or investigator_item.get("id") != self.investigator_id
            or investigator_item.get("path")
            != f".coc/investigators/{self.investigator_id}/character.json"
        ):
            raise ValueError("target investigator index is not prepared")

    @staticmethod
    def _restore_file_atomic_at(
        source_fd: int,
        target_fd: int,
        relative: Path,
        expected_checksum: str,
        expected_size: int,
    ) -> None:
        relative = _safe_relative_path(relative)
        parent_fd = _open_or_create_directory_at(target_fd, relative.parent)
        temporary = f".{relative.name}.{uuid.uuid4().hex}.tmp"
        temporary_exists = False
        descriptor = -1
        try:
            flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
            if hasattr(os, "O_NOFOLLOW"):
                flags |= os.O_NOFOLLOW
            descriptor = os.open(temporary, flags, 0o600, dir_fd=parent_fd)
            temporary_exists = True
            checksum, size = _copy_fd_to_fd(source_fd, descriptor)
            os.close(descriptor)
            descriptor = -1
            if checksum != expected_checksum or size != expected_size:
                raise ValueError("checkpoint source changed after validation")

            _require_directory_identity_at(
                target_fd, relative.parent, parent_fd, "target parent"
            )
            try:
                destination_info = os.stat(
                    relative.name, dir_fd=parent_fd, follow_symlinks=False
                )
            except FileNotFoundError:
                destination_info = None
            if destination_info is not None:
                if stat.S_ISLNK(destination_info.st_mode):
                    raise ValueError(f"target symlink is not allowed: {relative}")
                if not stat.S_ISREG(destination_info.st_mode):
                    raise ValueError(f"target path is not a regular file: {relative}")
            os.replace(
                temporary,
                relative.name,
                src_dir_fd=parent_fd,
                dst_dir_fd=parent_fd,
            )
            temporary_exists = False
            _require_directory_identity_at(
                target_fd, relative.parent, parent_fd, "target parent"
            )
            os.fsync(parent_fd)
        finally:
            if descriptor >= 0:
                os.close(descriptor)
            if temporary_exists:
                try:
                    os.unlink(temporary, dir_fd=parent_fd)
                except FileNotFoundError:
                    pass
            os.close(parent_fd)
