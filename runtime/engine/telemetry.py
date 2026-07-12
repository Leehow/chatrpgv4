"""Privacy-safe per-turn runtime telemetry and durable receipts."""
from __future__ import annotations

import json
import fcntl
import math
import os
import re
import stat
import uuid
from pathlib import Path
from typing import Any, Mapping


TELEMETRY_FIELDS = (
    "intent_ms", "director_ms", "rules_ms", "persistence_ms",
    "player_llm_ms", "narrator_llm_ms", "total_ms", "input_tokens",
    "output_tokens", "fallback", "runner", "narrator",
)
_SECRET_KEY = re.compile(r"secret|token|password|credential|authorization|cookie|key", re.I)
_MODEL_IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9._+-]{0,255}\Z")
_NARRATOR_FIELDS = {
    "call_count", "model_identity", "response_mode", "consistent",
    "deterministic_fallback",
}
_MAX_LOG_BYTES = 64 * 1024 * 1024
_MAX_RECEIPT_BYTES = 2 * 1024 * 1024


def _directory_flags() -> int:
    flags = os.O_RDONLY
    if hasattr(os, "O_DIRECTORY"):
        flags |= os.O_DIRECTORY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    return flags


def _open_logs_dir(campaign_dir: Path | str, *, create: bool) -> int:
    campaign = Path(campaign_dir).absolute()
    if create:
        campaign.mkdir(parents=True, exist_ok=True)
    campaign_fd = -1
    logs_fd = -1
    try:
        campaign_fd = os.open(campaign, _directory_flags())
        if not stat.S_ISDIR(os.fstat(campaign_fd).st_mode):
            raise ValueError("telemetry campaign path is not a directory")
        created_logs = False
        if create:
            try:
                os.mkdir("logs", 0o700, dir_fd=campaign_fd)
                created_logs = True
            except FileExistsError:
                pass
        logs_fd = os.open("logs", _directory_flags(), dir_fd=campaign_fd)
        if not stat.S_ISDIR(os.fstat(logs_fd).st_mode):
            raise ValueError("telemetry logs path is not a directory")
        if created_logs:
            os.fsync(campaign_fd)
        result = logs_fd
        logs_fd = -1
        return result
    except (OSError, ValueError) as exc:
        raise ValueError("telemetry logs path is unsafe or unavailable") from exc
    finally:
        if logs_fd >= 0:
            os.close(logs_fd)
        if campaign_fd >= 0:
            os.close(campaign_fd)


def _open_log_file(logs_fd: int, filename: str, flags: int) -> int:
    if not isinstance(filename, str) or not filename or "/" in filename or "\\" in filename:
        raise ValueError("telemetry log filename is invalid")
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        descriptor = os.open(filename, flags, 0o600, dir_fd=logs_fd)
        if not stat.S_ISREG(os.fstat(descriptor).st_mode):
            os.close(descriptor)
            raise ValueError("telemetry receipt is not a regular file")
        return descriptor
    except OSError as exc:
        raise ValueError("telemetry receipt path is unsafe") from exc


def _write_all(descriptor: int, payload: bytes) -> None:
    view = memoryview(payload)
    while view:
        written = os.write(descriptor, view)
        if written <= 0:
            raise OSError("short telemetry receipt write")
        view = view[written:]


def _read_log_bytes(
    campaign_dir: Path | str,
    filename: str,
    *,
    missing_ok: bool = False,
) -> bytes:
    logs_fd = -1
    descriptor = -1
    try:
        try:
            logs_fd = _open_logs_dir(campaign_dir, create=False)
            descriptor = _open_log_file(logs_fd, filename, os.O_RDONLY)
        except ValueError:
            if missing_ok and not (Path(campaign_dir).absolute() / "logs" / filename).exists():
                return b""
            raise
        info = os.fstat(descriptor)
        if info.st_size > _MAX_LOG_BYTES:
            raise ValueError("telemetry receipt log exceeds the bounded size")
        chunks: list[bytes] = []
        remaining = info.st_size
        while remaining:
            chunk = os.read(descriptor, min(1024 * 1024, remaining))
            if not chunk:
                raise ValueError("telemetry receipt log ended unexpectedly")
            chunks.append(chunk)
            remaining -= len(chunk)
        return b"".join(chunks)
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        if logs_fd >= 0:
            os.close(logs_fd)


def _millis(value: Any, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
        raise ValueError(f"telemetry {name} must be a non-negative finite number")
    return float(value)


def _tokens(value: Any, name: str) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError(f"telemetry {name} must be a non-negative integer or null")
    return value


def _safe_runner(value: Any) -> dict[str, str]:
    if not isinstance(value, Mapping):
        raise ValueError("telemetry runner must be a mapping")
    safe: dict[str, str] = {}
    for name, kind in value.items():
        if not isinstance(name, str) or not isinstance(kind, str):
            raise ValueError("telemetry runner must contain string labels")
        if _SECRET_KEY.search(name) or _SECRET_KEY.search(kind):
            raise ValueError("telemetry runner must not contain secret material")
        # Runner attestations are identifiers, never command arguments / paths.
        if "/" in kind or "\\" in kind or "\n" in kind or len(kind) > 128:
            raise ValueError("telemetry runner value is not a safe identifier")
        safe[name] = kind
    return safe


def _safe_narrator(value: Any) -> dict[str, Any]:
    if not isinstance(value, Mapping) or set(value) != _NARRATOR_FIELDS:
        raise ValueError("telemetry narrator attestation has an invalid shape")
    call_count = value.get("call_count")
    if isinstance(call_count, bool) or not isinstance(call_count, int) or call_count < 0:
        raise ValueError("telemetry narrator call_count must be a non-negative integer")
    identity = value.get("model_identity")
    if identity is not None:
        if not isinstance(identity, Mapping) or set(identity) != {"provider", "id"}:
            raise ValueError("telemetry narrator model identity has an invalid shape")
        if not all(
            isinstance(identity.get(field), str)
            and _MODEL_IDENTIFIER.fullmatch(identity[field])
            for field in ("provider", "id")
        ):
            raise ValueError("telemetry narrator model identity is unsafe")
        identity = {"provider": identity["provider"], "id": identity["id"]}
    response_mode = value.get("response_mode")
    if response_mode not in {None, "tool", "prose_fallback"}:
        raise ValueError("telemetry narrator response_mode is invalid")
    consistent = value.get("consistent")
    deterministic_fallback = value.get("deterministic_fallback")
    if type(consistent) is not bool or type(deterministic_fallback) is not bool:
        raise ValueError("telemetry narrator consistency/fallback must be boolean")
    if call_count == 0 and (
        identity is not None
        or response_mode is not None
        or not consistent
        or deterministic_fallback
    ):
        raise ValueError("telemetry narrator zero-call attestation is inconsistent")
    if call_count > 0 and not deterministic_fallback and (
        identity is None or response_mode is None
    ):
        raise ValueError("telemetry narrator calls require model identity and response mode")
    if deterministic_fallback and consistent:
        raise ValueError("telemetry narrator fallback cannot be consistent")
    return {
        "call_count": call_count,
        "model_identity": identity,
        "response_mode": response_mode,
        "consistent": consistent,
        "deterministic_fallback": deterministic_fallback,
    }


def make_telemetry(**values: Any) -> dict[str, Any]:
    """Normalize the exact public telemetry shape; no arbitrary extras."""
    if set(values) != set(TELEMETRY_FIELDS):
        raise ValueError("telemetry must contain exactly the runtime telemetry fields")
    telemetry = {
        name: _millis(values[name], name)
        for name in (
            "intent_ms", "director_ms", "rules_ms", "persistence_ms",
            "player_llm_ms", "narrator_llm_ms", "total_ms",
        )
    }
    telemetry["input_tokens"] = _tokens(values["input_tokens"], "input_tokens")
    telemetry["output_tokens"] = _tokens(values["output_tokens"], "output_tokens")
    if not isinstance(values["fallback"], bool):
        raise ValueError("telemetry fallback must be boolean")
    telemetry["fallback"] = values["fallback"]
    telemetry["runner"] = _safe_runner(values["runner"])
    telemetry["narrator"] = _safe_narrator(values["narrator"])
    if telemetry["fallback"] != telemetry["narrator"]["deterministic_fallback"]:
        raise ValueError("telemetry fallback must match narrator deterministic_fallback")
    phase_total = sum(
        telemetry[name] for name in (
            "intent_ms", "director_ms", "rules_ms", "persistence_ms",
            "player_llm_ms", "narrator_llm_ms",
        )
    )
    if telemetry["total_ms"] < phase_total:
        raise ValueError("telemetry total_ms must bound all phase spans")
    return telemetry


def write_receipt(
    campaign_dir: Path | str,
    *,
    session_id: str,
    investigator_id: str,
    telemetry: Mapping[str, Any],
    runtime_receipt_sha256: str,
    decision_ids: list[str] | None = None,
) -> Path:
    """Atomically append a reloadable receipt without input, prompts or secrets."""
    clean = make_telemetry(**dict(telemetry))
    if not isinstance(session_id, str) or not session_id or not isinstance(investigator_id, str) or not investigator_id:
        raise ValueError("telemetry receipt requires stable session and investigator IDs")
    ids = list(decision_ids or [])
    if not all(isinstance(value, str) and value for value in ids):
        raise ValueError("telemetry decision_ids must be non-empty strings")
    if not isinstance(runtime_receipt_sha256, str) or re.fullmatch(
        r"[0-9a-f]{64}", runtime_receipt_sha256
    ) is None:
        raise ValueError("telemetry runtime receipt digest must be SHA-256")
    campaign_root = Path(campaign_dir).absolute()
    target = campaign_root / "logs" / "runtime-telemetry.jsonl"
    receipt = {
        "schema_version": 1,
        "receipt_id": f"telemetry_{uuid.uuid4().hex}",
        "session_id": session_id,
        "investigator_id": investigator_id,
        "decision_ids": ids,
        "runtime_receipt_sha256": runtime_receipt_sha256,
        "telemetry": clean,
    }
    # ``O_APPEND`` gives one write per record. A campaign turn lock serializes
    # normal callers; this remains safe if an observer writes a separate file.
    encoded = json.dumps(receipt, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n"
    logs_fd = _open_logs_dir(campaign_root, create=True)
    fd = -1
    try:
        fd = _open_log_file(
            logs_fd,
            "runtime-telemetry.jsonl",
            os.O_WRONLY | os.O_CREAT | os.O_APPEND,
        )
        fcntl.flock(fd, fcntl.LOCK_EX)
        try:
            _write_all(fd, encoded.encode("utf-8"))
            os.fsync(fd)
        finally:
            fcntl.flock(fd, fcntl.LOCK_UN)
        os.fsync(logs_fd)
    finally:
        if fd >= 0:
            os.close(fd)
        os.close(logs_fd)
    return target


def read_receipts(campaign_dir: Path | str) -> list[dict[str, Any]]:
    """Load only fully-valid historical telemetry receipts, oldest first."""
    payload = _read_log_bytes(
        campaign_dir, "runtime-telemetry.jsonl", missing_ok=True
    )
    if not payload:
        return []
    receipts: list[dict[str, Any]] = []
    for encoded in payload.split(b"\n"):
        if not encoded or len(encoded) > _MAX_RECEIPT_BYTES:
            continue
        try:
            line = encoded.decode("utf-8")
            row = json.loads(line)
            receipts.append(_validated_receipt(row))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError, TypeError, ValueError):
            continue
    return receipts


def _validated_receipt(row: Any) -> dict[str, Any]:
    if not isinstance(row, dict) or set(row) != {
        "schema_version", "receipt_id", "session_id", "investigator_id",
        "decision_ids", "runtime_receipt_sha256", "telemetry",
    }:
        raise ValueError("latest telemetry receipt has an invalid shape")
    if (
        row["schema_version"] != 1
        or not isinstance(row["receipt_id"], str)
        or not row["receipt_id"]
        or not isinstance(row["session_id"], str)
        or not row["session_id"]
        or not isinstance(row["investigator_id"], str)
        or not row["investigator_id"]
        or not isinstance(row["decision_ids"], list)
        or not all(isinstance(item, str) and item for item in row["decision_ids"])
        or len(set(row["decision_ids"])) != len(row["decision_ids"])
        or not isinstance(row["runtime_receipt_sha256"], str)
        or re.fullmatch(r"[0-9a-f]{64}", row["runtime_receipt_sha256"]) is None
    ):
        raise ValueError("latest telemetry receipt has invalid identities")
    clean = make_telemetry(**row["telemetry"])
    return {**row, "telemetry": clean}


def read_latest_receipt_strict(campaign_dir: Path | str) -> dict[str, Any]:
    """Read the physical tail receipt; corruption is never skipped."""
    return read_receipts_strict(campaign_dir)[-1]


def read_receipts_strict(campaign_dir: Path | str) -> list[dict[str, Any]]:
    """Read every physical receipt row and reject any corruption or ambiguity."""
    rows = read_jsonl_objects_strict(campaign_dir, "runtime-telemetry.jsonl")
    return [_validated_receipt(row) for row in rows]


def read_jsonl_objects_strict(
    campaign_dir: Path | str, filename: str
) -> list[dict[str, Any]]:
    """Read a complete bounded JSONL file without skipping any physical row."""
    payload = _read_log_bytes(campaign_dir, filename)
    if not payload or not payload.endswith(b"\n"):
        raise ValueError("latest telemetry receipt is not durably terminated")
    encoded_rows = payload[:-1].split(b"\n")
    if not encoded_rows or any(not row.strip() for row in encoded_rows):
        raise ValueError("latest telemetry receipt physical tail is blank")
    rows: list[dict[str, Any]] = []
    try:
        for encoded in encoded_rows:
            if len(encoded) > _MAX_RECEIPT_BYTES:
                raise ValueError("latest telemetry receipt exceeds the line bound")
            row = json.loads(encoded.decode("utf-8"))
            if not isinstance(row, dict):
                raise ValueError("latest telemetry receipt is not an object")
            rows.append(row)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("latest telemetry receipt is invalid") from exc
    return rows


def read_latest_jsonl_object_strict(
    campaign_dir: Path | str, filename: str
) -> dict[str, Any]:
    """Read one bounded, no-follow JSONL physical tail object."""
    return read_jsonl_objects_strict(campaign_dir, filename)[-1]


__all__ = [
    "TELEMETRY_FIELDS", "make_telemetry", "read_jsonl_objects_strict",
    "read_latest_receipt_strict", "read_latest_jsonl_object_strict",
    "read_receipts", "read_receipts_strict", "write_receipt",
]
