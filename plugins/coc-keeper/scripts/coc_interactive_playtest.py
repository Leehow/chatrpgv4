#!/usr/bin/env python3
"""Strict JSONL boundary for interactive public-runtime playtests."""

from __future__ import annotations

import argparse
import copy
import fcntl
import hashlib
import importlib.util
import json
import os
import re
import signal
import stat
import subprocess
import sys
import uuid
from pathlib import Path
from types import ModuleType
from typing import Any


_EXPECTED_MODEL_IDENTITY = {"provider": "zhipu-coding", "id": "glm-5.2"}
_PUBLIC_EVENT_TYPES = {
    "narration",
    "speech",
    "roll",
    "state_patch",
    "choice",
    "session_ending",
}
_ROLL_STRING_FIELDS = {
    "roll_id",
    "decision_id",
    "kind",
    "skill",
    "characteristic",
    "difficulty",
    "outcome",
    "damage_kind",
    "reward_kind",
    "die",
}
_ROLL_INTEGER_FIELDS = {
    "target",
    "effective_target",
    "bonus_penalty_dice",
    "roll",
    "san_loss",
    "san_before",
    "san_after",
    "hp_before",
    "hp_delta",
    "hp_after",
    "flat_modifier",
}
_ROLL_BOOLEAN_FIELDS = {
    "success",
    "pushed",
    "bout_triggered",
}
_ROLL_FIELDS = (
    _ROLL_STRING_FIELDS
    | _ROLL_INTEGER_FIELDS
    | _ROLL_BOOLEAN_FIELDS
    | {"die_rolls"}
)
_CHOICE_FIELDS = {
    "choice_id",
    "kind",
    "command_id",
    "responder",
    "revision",
    "prompt",
    "options",
    "decision_id",
    "attack_id",
    "audience",
}
_CHOICE_KINDS = {"push_confirm", "chase_action", "combat_defense"}
_ATTESTATION_FIELDS = {
    "schema_version",
    "session_id",
    "investigator_id",
    "decision_ids",
    "telemetry_receipt_id",
    "runtime_receipt_sha256",
    "recording_mode",
    "recording_flush",
    "usage",
    "narrator_llm_ms",
    "narrator",
    "secret_audits",
}
_USAGE_FIELDS = {"input_tokens", "output_tokens"}
_NARRATOR_FIELDS = {
    "call_count",
    "model_identity",
    "response_mode",
    "consistent",
    "deterministic_fallback",
}
_REPO_ROOT = Path(__file__).resolve().parents[3]
_RUN_KINDS = ("diagnostic_spoiler_run", "blind_actual_play")
_SAFE_TOKEN = re.compile(r"[A-Za-z0-9._:-]+\Z")
MAX_JSONL_BYTES = 1024 * 1024
_EOF = object()
_STATE_ISSUE_AREAS = {
    "campaign", "world", "pacing", "investigator", "subsystem", "combat",
    "sanity", "chase", "terminal",
}
_STATE_ISSUE_CODES = {
    "missing", "corrupt", "invalid_utf8", "invalid_json", "non_object",
    "forward_version", "invalid_schema", "invalid_fields", "invalid_identifier",
}
_RUN_METADATA_FIELDS = {
    "schema_version", "campaign_id", "investigator_id", "run_kind",
    "rng_seed_base", "max_turns", "session_id", "original_workspace",
    "active_workspace_path", "active_workspace_generation", "generation_counter",
    "durable_turn_number", "action_chain_sha256", "latest_checkpoint",
    "latest_checkpoint_manifest_sha256", "initial_public_state_sha256",
    "current_public_state_sha256", "pending_model_session_boundary",
    "last_request_id", "last_request_sha256", "last_result",
    "last_result_sha256",
    "driver_identity", "driver_sha256", "git_head",
}
_ACTION_ROW_FIELDS = {
    "turn_number", "previous_sha256", "action", "events", "state_before",
    "state_after", "provenance", "row_sha256",
}
_CHECKPOINT_MANIFEST_FIELDS = {
    "schema_version", "run_id", "turn_number", "reason", "session_id",
    "git_head", "source_pdf_sha256", "source_hashes", "scenario_hashes",
    "index_hashes", "immutable_trees", "managed_mutable_trees",
    "managed_file_presence", "state_files", "session_snapshot_sha256",
    "action_chain_sha256", "model_identity", "invalidation_state", "player_mode",
}
_SHA256 = re.compile(r"[0-9a-f]{64}\Z")
_GIT_HEAD = re.compile(r"[0-9a-f]{40,64}\Z")
_PUBLIC_IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}\Z")
_PUBLIC_TIMESTAMP = re.compile(r"[0-9TZ:+.-]{1,64}\Z")
_CREDENTIAL_LIKE = re.compile(
    r"(?:^sk-|^gh[pousr]_|^xox[baprs]-|^AKIA|api[_-]?key|bearer|credential|password|(?:access|refresh|auth)[_-]?token|client[_-]?secret|secret[_-]?key|private[_-]?key)",
    re.IGNORECASE,
)
_MAX_METADATA_BYTES = 8 * 1024 * 1024
_MAX_ACTION_JOURNAL_BYTES = 64 * 1024 * 1024
_DRIVER_IDENTITY = "plugins/coc-keeper/scripts/coc_interactive_playtest.py"


class DriverError(Exception):
    """A closed, machine-readable driver failure with no detail channel."""

    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


class _StopRequested(BaseException):
    pass


class _FatalTurnError(DriverError):
    pass


def _load_module(name: str, path: Path) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise DriverError("runtime_unavailable")
    module = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(module)
    except Exception:
        raise DriverError("runtime_unavailable") from None
    return module


def _load_runtime_api() -> ModuleType:
    return _load_module(
        "interactive_playtest_runtime_api",
        _REPO_ROOT / "runtime" / "sdk" / "api.py",
    )


def _load_checkpoint_module() -> ModuleType:
    return _load_module(
        "interactive_playtest_checkpoint",
        Path(__file__).resolve().with_name("coc_playtest_checkpoint.py"),
    )


def _load_secret_audit_module() -> ModuleType:
    return _load_module(
        "interactive_playtest_secret_audit",
        Path(__file__).resolve().with_name("coc_secret_audit.py"),
    )


def _load_playtest_evidence_module() -> ModuleType:
    return _load_module(
        "interactive_playtest_evidence",
        Path(__file__).resolve().with_name("coc_playtest_evidence.py"),
    )


def _canonical_json(value: Any) -> bytes:
    try:
        return json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        ).encode("utf-8")
    except (TypeError, ValueError):
        raise DriverError("invalid_input") from None


def _request_sha256(value: Any) -> str:
    return hashlib.sha256(_canonical_json(value)).hexdigest()


def _driver_sha256() -> str:
    path = Path(__file__).absolute()
    descriptor = -1
    try:
        flags = os.O_RDONLY
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        descriptor = os.open(path, flags)
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode):
            raise OSError
        if info.st_size < 1 or info.st_size > 4 * 1024 * 1024:
            raise OSError
        digest = hashlib.sha256()
        while True:
            chunk = os.read(descriptor, 1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
        return digest.hexdigest()
    except OSError:
        raise DriverError("driver_identity_failed") from None
    finally:
        if descriptor >= 0:
            os.close(descriptor)


def _current_git_head() -> str:
    try:
        completed = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=_REPO_ROOT,
            check=True,
            capture_output=True,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError):
        raise DriverError("git_head_unavailable") from None
    head = completed.stdout.strip()
    if _GIT_HEAD.fullmatch(head) is None:
        raise DriverError("git_head_unavailable")
    return head


def _invalidation_allows_current_head(
    manifest: dict[str, Any], *, metadata_head: str, current: str
) -> bool:
    state = manifest.get("invalidation_state")
    segments = state.get("segments") if isinstance(state, dict) else None
    checkpoint_name = None
    turn = manifest.get("turn_number")
    if isinstance(turn, int) and turn >= 0:
        checkpoint_name = f"turn-{turn:06d}"
    return isinstance(segments, list) and any(
        isinstance(segment, dict)
        and segment.get("kind") == "invalidated_segment"
        and segment.get("old_commit") == metadata_head
        and segment.get("new_commit") == current
        and (
            checkpoint_name is None
            or segment.get("replay_start_checkpoint") == checkpoint_name
        )
        for segment in segments
    )


def _validate_git_head_binding(
    metadata: dict[str, Any], manifest: dict[str, Any]
) -> None:
    metadata_head = metadata.get("git_head")
    manifest_head = manifest.get("git_head")
    try:
        current = _current_git_head()
    except DriverError:
        raise DriverError("resume_validation_failed") from None
    if (
        not isinstance(metadata_head, str)
        or _GIT_HEAD.fullmatch(metadata_head) is None
        or manifest_head != metadata_head
    ):
        raise DriverError("resume_validation_failed")
    if current == metadata_head:
        return
    if not _invalidation_allows_current_head(
        manifest, metadata_head=metadata_head, current=current
    ):
        raise DriverError("resume_validation_failed")


def _open_absolute_directory(path: Path, *, create: bool = False) -> int:
    absolute = Path(os.path.abspath(path))
    if not absolute.is_absolute() or any(part in {"", ".", ".."} for part in absolute.parts[1:]):
        raise DriverError("run_directory_invalid")
    flags = os.O_RDONLY
    if hasattr(os, "O_DIRECTORY"):
        flags |= os.O_DIRECTORY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = -1
    try:
        descriptor = os.open(absolute.anchor, flags)
        for part in absolute.parts[1:]:
            if create:
                try:
                    os.mkdir(part, 0o700, dir_fd=descriptor)
                    os.fsync(descriptor)
                except FileExistsError:
                    pass
            next_descriptor = os.open(part, flags, dir_fd=descriptor)
            os.close(descriptor)
            descriptor = next_descriptor
        if not stat.S_ISDIR(os.fstat(descriptor).st_mode):
            raise OSError
        result = descriptor
        descriptor = -1
        return result
    except OSError:
        raise DriverError("run_directory_invalid") from None
    finally:
        if descriptor >= 0:
            os.close(descriptor)


def _open_directory(path: Path) -> int:
    return _open_absolute_directory(path, create=False)


def _open_bound_run_directory(run_dir: Path, held_fd: int) -> int:
    """Reopen the public path and require the process-held directory inode."""

    try:
        held = os.fstat(held_fd)
    except OSError:
        raise DriverError("run_directory_replaced") from None
    current_fd = _open_directory(Path(run_dir).absolute())
    current = os.fstat(current_fd)
    if (
        not stat.S_ISDIR(held.st_mode)
        or (current.st_dev, current.st_ino) != (held.st_dev, held.st_ino)
    ):
        os.close(current_fd)
        raise DriverError("run_directory_replaced")
    return current_fd


def atomic_write_metadata(
    run_dir: Path,
    payload: dict[str, Any],
    *,
    run_fd: int | None = None,
) -> None:
    """Durably replace run.json without following an existing leaf symlink."""

    encoded = _canonical_json(payload) + b"\n"
    target_fd = (
        _open_directory(run_dir)
        if run_fd is None
        else _open_bound_run_directory(run_dir, run_fd)
    )
    temporary = f".run.json.{uuid.uuid4().hex}.tmp"
    descriptor = -1
    try:
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        descriptor = os.open(temporary, flags, 0o600, dir_fd=target_fd)
        with os.fdopen(descriptor, "wb") as handle:
            descriptor = -1
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(
            temporary,
            "run.json",
            src_dir_fd=target_fd,
            dst_dir_fd=target_fd,
        )
        os.fsync(target_fd)
    except OSError:
        try:
            os.unlink(temporary, dir_fd=target_fd)
        except OSError:
            pass
        raise DriverError("metadata_persistence_failed") from None
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        os.close(target_fd)


class RunLock:
    """A process-lifetime, nonblocking advisory lock for one run directory."""

    def __init__(self, run_dir: Path | str) -> None:
        self.run_dir = Path(os.path.abspath(run_dir))
        self._descriptor = -1
        self._run_descriptor = -1

    def __enter__(self) -> "RunLock":
        self._run_descriptor = _open_absolute_directory(
            self.run_dir, create=True
        )
        try:
            flags = os.O_RDWR | os.O_CREAT
            if hasattr(os, "O_NOFOLLOW"):
                flags |= os.O_NOFOLLOW
            self._descriptor = os.open(
                ".interactive.lock", flags, 0o600, dir_fd=self._run_descriptor
            )
            if not stat.S_ISREG(os.fstat(self._descriptor).st_mode):
                raise OSError
            fcntl.flock(self._descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            if self._descriptor >= 0:
                os.close(self._descriptor)
                self._descriptor = -1
            if self._run_descriptor >= 0:
                os.close(self._run_descriptor)
                self._run_descriptor = -1
            raise DriverError("run_locked") from None
        except OSError:
            if self._descriptor >= 0:
                os.close(self._descriptor)
                self._descriptor = -1
            if self._run_descriptor >= 0:
                os.close(self._run_descriptor)
                self._run_descriptor = -1
            raise DriverError("run_directory_invalid") from None
        return self

    @property
    def directory_fd(self) -> int:
        if self._run_descriptor < 0:
            raise DriverError("run_directory_invalid")
        return self._run_descriptor

    def require_path_identity(self) -> None:
        descriptor = _open_bound_run_directory(
            self.run_dir, self.directory_fd
        )
        os.close(descriptor)

    def __exit__(self, _type: Any, _value: Any, _traceback: Any) -> None:
        if self._descriptor >= 0:
            try:
                fcntl.flock(self._descriptor, fcntl.LOCK_UN)
            finally:
                os.close(self._descriptor)
                self._descriptor = -1
        if self._run_descriptor >= 0:
            os.close(self._run_descriptor)
            self._run_descriptor = -1


class _ClosedArgumentParser(argparse.ArgumentParser):
    def error(self, _message: str) -> None:
        raise DriverError("invalid_arguments")


def _max_turns(value: str) -> int:
    if re.fullmatch(r"[1-9][0-9]{0,2}", value) is None:
        raise argparse.ArgumentTypeError("invalid max turns")
    parsed = int(value)
    if parsed > 500:
        raise argparse.ArgumentTypeError("invalid max turns")
    return parsed


def _build_parser() -> argparse.ArgumentParser:
    parser = _ClosedArgumentParser(prog="coc-interactive-playtest")
    commands = parser.add_subparsers(dest="command", required=True)
    start = commands.add_parser("start", add_help=True)
    start.add_argument("--workspace", required=True)
    start.add_argument("--campaign", required=True)
    start.add_argument("--investigator", required=True)
    start.add_argument("--run-dir", required=True)
    start.add_argument("--run-kind", required=True, choices=_RUN_KINDS)
    start.add_argument("--rng-seed", required=True)
    start.add_argument("--max-turns", required=True, type=_max_turns)
    resume = commands.add_parser("resume", add_help=True)
    resume.add_argument("--run-dir", required=True)
    resume.add_argument("--checkpoint", required=True)
    return parser


def _validate_cli_tokens(args: argparse.Namespace) -> None:
    if args.command != "start":
        return
    for value in (args.campaign, args.investigator, args.rng_seed):
        if (
            not isinstance(value, str)
            or not (1 <= len(value) <= 128)
            or _SAFE_TOKEN.fullmatch(value) is None
        ):
            raise DriverError("invalid_arguments")


def _open_directory_at(parent_fd: int, name: str) -> int:
    if not isinstance(name, str) or not name or "/" in name or name in {".", ".."}:
        raise DriverError("resume_validation_failed")
    flags = os.O_RDONLY
    if hasattr(os, "O_DIRECTORY"):
        flags |= os.O_DIRECTORY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        descriptor = os.open(name, flags, dir_fd=parent_fd)
    except OSError:
        raise DriverError("resume_validation_failed") from None
    if not stat.S_ISDIR(os.fstat(descriptor).st_mode):
        os.close(descriptor)
        raise DriverError("resume_validation_failed")
    return descriptor


def _read_regular_at(parent_fd: int, name: str, limit: int) -> bytes:
    if not isinstance(name, str) or not name or "/" in name or name in {".", ".."}:
        raise DriverError("resume_validation_failed")
    flags = os.O_RDONLY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = -1
    try:
        descriptor = os.open(name, flags, dir_fd=parent_fd)
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode) or info.st_size < 1 or info.st_size > limit:
            raise DriverError("resume_validation_failed")
        chunks: list[bytes] = []
        size = 0
        while True:
            chunk = os.read(descriptor, min(1024 * 1024, limit + 1 - size))
            if not chunk:
                break
            chunks.append(chunk)
            size += len(chunk)
            if size > limit:
                raise DriverError("resume_validation_failed")
        return b"".join(chunks)
    except DriverError:
        raise
    except OSError:
        raise DriverError("resume_validation_failed") from None
    finally:
        if descriptor >= 0:
            os.close(descriptor)


def _decode_canonical_object(payload: bytes) -> dict[str, Any]:
    if not payload.endswith(b"\n") or payload in {b"", b"\n"}:
        raise DriverError("resume_validation_failed")
    encoded = payload[:-1]
    if b"\n" in encoded or encoded.endswith(b"\r"):
        raise DriverError("resume_validation_failed")
    try:
        value = json.loads(
            encoded.decode("utf-8"),
            object_pairs_hook=_reject_duplicate_keys,
            parse_constant=_reject_nonfinite,
        )
    except (UnicodeDecodeError, json.JSONDecodeError, TypeError, ValueError):
        raise DriverError("resume_validation_failed") from None
    if not isinstance(value, dict) or _canonical_json(value) != encoded:
        raise DriverError("resume_validation_failed")
    return value


def _read_run_metadata_strict(
    run_dir: Path | str, *, run_fd: int | None = None
) -> dict[str, Any]:
    opened_fd = (
        _open_directory(Path(run_dir).absolute())
        if run_fd is None
        else _open_bound_run_directory(Path(run_dir).absolute(), run_fd)
    )
    try:
        metadata = _decode_canonical_object(
            _read_regular_at(opened_fd, "run.json", _MAX_METADATA_BYTES)
        )
    finally:
        os.close(opened_fd)
    if set(metadata) != _RUN_METADATA_FIELDS:
        raise DriverError("resume_validation_failed")
    return metadata


def _read_action_journal_strict(
    run_dir: Path | str, *, run_fd: int | None = None
) -> list[dict[str, Any]]:
    opened_fd = (
        _open_directory(Path(run_dir).absolute())
        if run_fd is None
        else _open_bound_run_directory(Path(run_dir).absolute(), run_fd)
    )
    try:
        try:
            payload = _read_regular_at(
                opened_fd, "actions.jsonl", _MAX_ACTION_JOURNAL_BYTES
            )
        except DriverError:
            try:
                os.stat("actions.jsonl", dir_fd=opened_fd, follow_symlinks=False)
            except FileNotFoundError:
                return []
            raise
    finally:
        os.close(opened_fd)
    previous = "0" * 64
    rows: list[dict[str, Any]] = []
    if not payload.endswith(b"\n"):
        raise DriverError("resume_validation_failed")
    for expected_turn, encoded in enumerate(payload[:-1].split(b"\n"), start=1):
        if expected_turn > 500 or len(encoded) > 8 * 1024 * 1024:
            raise DriverError("resume_validation_failed")
        row = _decode_canonical_object(encoded + b"\n")
        expected_sha = _request_sha256(
            {key: value for key, value in row.items() if key != "row_sha256"}
        )
        if (
            set(row) != _ACTION_ROW_FIELDS
            or row.get("turn_number") != expected_turn
            or row.get("previous_sha256") != previous
            or row.get("row_sha256") != expected_sha
        ):
            raise DriverError("resume_validation_failed")
        previous = expected_sha
        rows.append(row)
    return rows


def _read_checkpoint_manifest_strict(
    run_dir: Path | str,
    checkpoint: Path | str,
    *,
    run_fd: int | None = None,
) -> tuple[Path, dict[str, Any], str]:
    root = Path(run_dir).absolute()
    checkpoints_root = root / "checkpoints"
    candidate = Path(checkpoint)
    selected = candidate.absolute() if candidate.is_absolute() else checkpoints_root / candidate
    if selected.parent != checkpoints_root or re.fullmatch(r"turn-[0-9]{6}", selected.name) is None:
        raise DriverError("resume_validation_failed")
    opened_run_fd = (
        _open_directory(root)
        if run_fd is None
        else _open_bound_run_directory(root, run_fd)
    )
    checkpoints_fd = checkpoint_fd = -1
    try:
        checkpoints_fd = _open_directory_at(opened_run_fd, "checkpoints")
        checkpoint_fd = _open_directory_at(checkpoints_fd, selected.name)
        payload = _read_regular_at(
            checkpoint_fd, "manifest.json", _MAX_METADATA_BYTES
        )
    finally:
        if checkpoint_fd >= 0:
            os.close(checkpoint_fd)
        if checkpoints_fd >= 0:
            os.close(checkpoints_fd)
        os.close(opened_run_fd)
    manifest = _decode_canonical_object(payload)
    if set(manifest) != _CHECKPOINT_MANIFEST_FIELDS:
        raise DriverError("resume_validation_failed")
    return selected, manifest, hashlib.sha256(payload).hexdigest()


def _classify_resume_boundary(
    metadata: dict[str, Any],
    rows: list[dict[str, Any]],
    manifest: dict[str, Any],
    selected_relative: str,
    selected_manifest_sha256: str,
) -> str:
    """Classify only the durable N relationship; deeper validation follows."""

    meta_turn = metadata.get("durable_turn_number")
    checkpoint_turn = manifest.get("turn_number")
    journal_turn = len(rows)
    if any(
        isinstance(value, bool) or not isinstance(value, int) or value < 0
        for value in (meta_turn, checkpoint_turn)
    ):
        raise DriverError("resume_validation_failed")
    journal_chain = rows[-1]["row_sha256"] if rows else "0" * 64
    meta_chain = (
        rows[meta_turn - 1]["row_sha256"] if meta_turn > 0 and meta_turn <= journal_turn
        else "0" * 64 if meta_turn == 0 else None
    )
    expected_selected = f"checkpoints/turn-{checkpoint_turn:06d}"
    if (
        selected_relative != expected_selected
        or manifest.get("run_id") != metadata.get("campaign_id")
        or manifest.get("session_id") != metadata.get("session_id")
        or manifest.get("action_chain_sha256")
        != (rows[checkpoint_turn - 1]["row_sha256"] if checkpoint_turn > 0 and checkpoint_turn <= journal_turn else "0" * 64 if checkpoint_turn == 0 else None)
        or manifest.get("player_mode")
        != (metadata.get("run_kind") if checkpoint_turn > 0 else None)
        or _SHA256.fullmatch(selected_manifest_sha256) is None
        or metadata.get("action_chain_sha256") != meta_chain
    ):
        raise DriverError("resume_validation_failed")
    if journal_turn > checkpoint_turn:
        raise DriverError("journal_ahead_of_checkpoint")
    if journal_turn < checkpoint_turn:
        raise DriverError("resume_validation_failed")
    if checkpoint_turn == meta_turn:
        if (
            metadata.get("latest_checkpoint") != selected_relative
            or metadata.get("latest_checkpoint_manifest_sha256")
            != selected_manifest_sha256
            or journal_chain != metadata.get("action_chain_sha256")
        ):
            raise DriverError("resume_validation_failed")
        return "aligned"
    if checkpoint_turn == meta_turn + 1:
        return "checkpoint_ahead"
    raise DriverError("resume_validation_failed")


def _validate_run_metadata(metadata: dict[str, Any]) -> None:
    if (
        set(metadata) != _RUN_METADATA_FIELDS
        or metadata.get("schema_version") != 1
        or metadata.get("run_kind") not in _RUN_KINDS
        or isinstance(metadata.get("max_turns"), bool)
        or not isinstance(metadata.get("max_turns"), int)
        or not 1 <= metadata["max_turns"] <= 500
        or isinstance(metadata.get("generation_counter"), bool)
        or not isinstance(metadata.get("generation_counter"), int)
        or metadata["generation_counter"] < 0
        or isinstance(metadata.get("durable_turn_number"), bool)
        or not isinstance(metadata.get("durable_turn_number"), int)
        or metadata["durable_turn_number"] < 0
    ):
        raise DriverError("resume_validation_failed")
    if (
        metadata.get("driver_identity") != _DRIVER_IDENTITY
        or metadata.get("driver_sha256") != _driver_sha256()
        or not isinstance(metadata.get("git_head"), str)
        or _GIT_HEAD.fullmatch(metadata["git_head"]) is None
    ):
        raise DriverError("resume_validation_failed")
    for field in (
        "campaign_id", "investigator_id", "rng_seed_base", "session_id",
        "active_workspace_generation",
    ):
        value = metadata.get(field)
        if (
            not isinstance(value, str)
            or not 1 <= len(value) <= 128
            or _SAFE_TOKEN.fullmatch(value) is None
        ):
            raise DriverError("resume_validation_failed")
    for field in ("original_workspace", "active_workspace_path"):
        value = metadata.get(field)
        if not isinstance(value, str) or not Path(value).is_absolute():
            raise DriverError("resume_validation_failed")
    for field in (
        "action_chain_sha256", "latest_checkpoint_manifest_sha256",
        "initial_public_state_sha256", "current_public_state_sha256",
    ):
        value = metadata.get(field)
        if not isinstance(value, str) or _SHA256.fullmatch(value) is None:
            raise DriverError("resume_validation_failed")
    checkpoint = metadata.get("latest_checkpoint")
    expected_checkpoint = (
        f"checkpoints/turn-{metadata['durable_turn_number']:06d}"
    )
    if checkpoint != expected_checkpoint:
        raise DriverError("resume_validation_failed")
    boundary = metadata.get("pending_model_session_boundary")
    if boundary is not None and (
        not isinstance(boundary, dict)
        or set(boundary) != {"kind", "after_turn"}
        or boundary.get("kind") not in {"start", "resume"}
        or boundary.get("after_turn") != metadata["durable_turn_number"]
    ):
        raise DriverError("resume_validation_failed")


def _turn_response_from_row(
    row: dict[str, Any], attestation: dict[str, Any], max_turns: int
) -> dict[str, Any]:
    events = row["events"]
    state_after = row["state_after"]
    evidence = copy.deepcopy(state_after["terminal_evidence"])
    event_ending = any(event["type"] == "session_ending" for event in events)
    if event_ending is not evidence["session_ending"]:
        raise DriverError("terminal_evidence_mismatch")
    story_terminal = evidence["reached_terminal"]
    ceiling = row["turn_number"] >= max_turns
    response: dict[str, Any] = {
        "kind": "terminal" if story_terminal or ceiling else "turn_result",
        "turn_number": row["turn_number"],
        "events": copy.deepcopy(events),
        "public_state": copy.deepcopy(state_after),
        "attestation": copy.deepcopy(attestation),
        "action_chain_sha256": row["row_sha256"],
        "rng_seed": row["provenance"]["rng_seed"],
        "ceiling_reached": ceiling,
        "terminal_evidence": evidence,
    }
    if story_terminal:
        response["terminal_kind"] = "story_terminal"
    elif ceiling:
        response["terminal_kind"] = "turn_ceiling"
    return response


def _rebuild_request_cache(
    rows: list[dict[str, Any]],
    metadata: dict[str, Any],
    *,
    allow_code_revision: bool = False,
) -> tuple[dict[str, dict[str, Any]], list[dict[str, Any]]]:
    cache: dict[str, dict[str, Any]] = {}
    responses: list[dict[str, Any]] = []
    for row in rows:
        try:
            action = validate_request(row["action"])
            if action != row["action"]:
                raise DriverError("resume_validation_failed")
            events = sanitize_events(row["events"])
            state_before = sanitize_public_state(row["state_before"])
            state_after = sanitize_public_state(row["state_after"])
            if (
                events != row["events"]
                or state_before != row["state_before"]
                or state_after != row["state_after"]
            ):
                raise DriverError("resume_validation_failed")
            provenance = row["provenance"]
            if not isinstance(provenance, dict):
                raise DriverError("resume_validation_failed")
            request_id = action["request_id"]
            request_sha256 = _request_sha256(action)
            attestation = validate_attestation(provenance.get("attestation"))
            expected_seed = (
                f"{metadata['rng_seed_base']}:{row['turn_number']:06d}"
            )
            driver_matches = (
                provenance.get("driver_identity") == metadata["driver_identity"]
                and provenance.get("driver_sha256") == metadata["driver_sha256"]
            )
            if allow_code_revision:
                driver_matches = (
                    provenance.get("driver_identity") == metadata["driver_identity"]
                )
            if (
                request_id in cache
                or provenance.get("request_id") != request_id
                or provenance.get("request_sha256") != request_sha256
                or provenance.get("rng_seed") != expected_seed
                or provenance.get("player_mode") != metadata["run_kind"]
                or attestation["session_id"] != metadata["session_id"]
                or attestation["investigator_id"] != metadata["investigator_id"]
                or provenance.get("model_identity")
                != attestation["narrator"]["model_identity"]
                or provenance.get("narrator_response_mode")
                != attestation["narrator"]["response_mode"]
                or provenance.get("recording_mode") != attestation["recording_mode"]
                or provenance.get("recording_flush") != attestation["recording_flush"]
                or provenance.get("runtime_receipt_sha256")
                != attestation["runtime_receipt_sha256"]
                or provenance.get("telemetry_receipt_id")
                != attestation["telemetry_receipt_id"]
                or provenance.get("decision_ids") != attestation["decision_ids"]
                or provenance.get("director_plan_refs") != attestation["decision_ids"]
                or provenance.get("usage") != attestation["usage"]
                or provenance.get("narrator_llm_ms") != attestation["narrator_llm_ms"]
                or not driver_matches
                or provenance.get("git_head") != metadata["git_head"]
            ):
                raise DriverError("resume_validation_failed")
            response = _turn_response_from_row(
                row, attestation, metadata["max_turns"]
            )
            if response["kind"] == "terminal" and row["turn_number"] != len(rows):
                raise DriverError("resume_validation_failed")
            boundary = provenance.get("model_session_boundary")
            if boundary is not None and (
                not isinstance(boundary, dict)
                or set(boundary) != {"kind", "after_turn"}
                or boundary.get("kind") not in {"start", "resume"}
                or boundary.get("after_turn") != row["turn_number"] - 1
                or (
                    boundary.get("kind") == "start"
                    and row["turn_number"] != 1
                )
            ):
                raise DriverError("resume_validation_failed")
            cache[request_id] = {
                "request_sha256": request_sha256,
                "response": copy.deepcopy(response),
            }
            responses.append(response)
        except DriverError:
            raise
        except Exception:
            raise DriverError("resume_validation_failed") from None
    return cache, responses


def _validate_metadata_turn(
    metadata: dict[str, Any],
    rows: list[dict[str, Any]],
    responses: list[dict[str, Any]],
) -> None:
    turn = metadata["durable_turn_number"]
    if turn == 0:
        if (
            metadata.get("action_chain_sha256") != "0" * 64
            or metadata.get("current_public_state_sha256")
            != metadata.get("initial_public_state_sha256")
            or any(
                metadata.get(field) is not None
                for field in (
                    "last_request_id", "last_request_sha256", "last_result",
                    "last_result_sha256",
                )
            )
        ):
            raise DriverError("resume_validation_failed")
        return
    if turn > len(rows):
        raise DriverError("resume_validation_failed")
    row = rows[turn - 1]
    response = responses[turn - 1]
    if (
        metadata.get("action_chain_sha256") != row["row_sha256"]
        or metadata.get("current_public_state_sha256")
        != _request_sha256(row["state_after"])
        or metadata.get("last_request_id") != row["action"]["request_id"]
        or metadata.get("last_request_sha256") != _request_sha256(row["action"])
        or metadata.get("last_result") != response
        or metadata.get("last_result_sha256") != _request_sha256(response)
    ):
        raise DriverError("resume_validation_failed")


def _preflight_resume(
    run_dir: Path, checkpoint_value: Path | str
) -> tuple[
    dict[str, Any], list[dict[str, Any]], Path, dict[str, Any], str,
    str, dict[str, dict[str, Any]], list[dict[str, Any]],
]:
    run_fd = _open_directory(run_dir)
    try:
        try:
            os.stat(
                ".incomplete-run.json",
                dir_fd=run_fd,
                follow_symlinks=False,
            )
        except FileNotFoundError:
            pass
        else:
            raise DriverError("incomplete_run")
    finally:
        os.close(run_fd)
    metadata = _read_run_metadata_strict(run_dir)
    _validate_run_metadata(metadata)
    rows = _read_action_journal_strict(run_dir)
    selected, manifest, manifest_sha256 = _read_checkpoint_manifest_strict(
        run_dir, checkpoint_value
    )
    selected_relative = selected.relative_to(run_dir).as_posix()
    mode = _classify_resume_boundary(
        metadata, rows, manifest, selected_relative, manifest_sha256
    )
    _validate_git_head_binding(metadata, manifest)
    allow_code_revision = _invalidation_allows_current_head(
        manifest,
        metadata_head=str(metadata.get("git_head") or ""),
        current=_current_git_head(),
    )
    cache, responses = _rebuild_request_cache(
        rows, metadata, allow_code_revision=allow_code_revision
    )
    _validate_metadata_turn(metadata, rows, responses)
    if mode == "checkpoint_ahead":
        prior = run_dir / metadata["latest_checkpoint"]
        _path, prior_manifest, prior_sha = _read_checkpoint_manifest_strict(
            run_dir, prior
        )
        if (
            prior_sha != metadata["latest_checkpoint_manifest_sha256"]
            or prior_manifest.get("turn_number") != metadata["durable_turn_number"]
            or prior_manifest.get("action_chain_sha256")
            != metadata["action_chain_sha256"]
        ):
            raise DriverError("resume_validation_failed")
        _validate_git_head_binding(metadata, prior_manifest)
    return (
        metadata, rows, selected, manifest, manifest_sha256, mode, cache,
        responses,
    )


def _write_new_regular_at(parent_fd: int, name: str, payload: bytes) -> None:
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = -1
    try:
        descriptor = os.open(name, flags, 0o600, dir_fd=parent_fd)
        offset = 0
        while offset < len(payload):
            offset += os.write(descriptor, payload[offset:])
        os.fsync(descriptor)
    except OSError:
        raise DriverError("resume_validation_failed") from None
    finally:
        if descriptor >= 0:
            os.close(descriptor)


def _runtime_config_bytes(metadata: dict[str, Any], run_dir: Path) -> bytes:
    active = Path(metadata["active_workspace_path"]).absolute()
    if active.name != metadata["active_workspace_generation"]:
        raise DriverError("resume_validation_failed")
    counter = metadata["generation_counter"]
    if counter == 0:
        if active != Path(metadata["original_workspace"]).absolute():
            raise DriverError("resume_validation_failed")
    else:
        expected = run_dir / "workspaces" / f"generation-{counter:06d}"
        if active != expected:
            raise DriverError("resume_validation_failed")
    active_fd = _open_directory(active)
    coc_fd = -1
    try:
        coc_fd = _open_directory_at(active_fd, ".coc")
        payload = _read_regular_at(coc_fd, "runtime.json", 1024 * 1024)
    finally:
        if coc_fd >= 0:
            os.close(coc_fd)
        os.close(active_fd)
    try:
        value = json.loads(
            payload.decode("utf-8"),
            object_pairs_hook=_reject_duplicate_keys,
            parse_constant=_reject_nonfinite,
        )
    except (UnicodeDecodeError, json.JSONDecodeError, TypeError, ValueError):
        raise DriverError("resume_validation_failed") from None
    if (
        not isinstance(value, dict)
        or set(value) != {"schema_version", "planner", "rules", "narrator", "player"}
        or value.get("schema_version") != 2
        or value.get("planner") != {"kind": "deterministic"}
        or value.get("rules") != {"kind": "deterministic"}
        or value.get("narrator") != {"kind": "pi"}
        or value.get("player") != {"kind": "human"}
    ):
        raise DriverError("resume_validation_failed")
    return _canonical_json(value) + b"\n"


def _prepare_fresh_generation(
    run_dir: Path, metadata: dict[str, Any]
) -> tuple[Path, int]:
    runtime_payload = _runtime_config_bytes(metadata, run_dir)
    run_fd = _open_directory(run_dir)
    workspaces_fd = generation_fd = coc_fd = indexes_fd = -1
    try:
        try:
            os.mkdir("workspaces", 0o700, dir_fd=run_fd)
            os.fsync(run_fd)
        except FileExistsError:
            pass
        workspaces_fd = _open_directory_at(run_fd, "workspaces")
        counter = metadata["generation_counter"] + 1
        while counter <= 999999:
            name = f"generation-{counter:06d}"
            try:
                os.mkdir(name, 0o700, dir_fd=workspaces_fd)
                os.fsync(workspaces_fd)
                break
            except FileExistsError:
                counter += 1
        else:
            raise DriverError("resume_validation_failed")
        generation_fd = _open_directory_at(workspaces_fd, name)
        os.mkdir(".coc", 0o700, dir_fd=generation_fd)
        coc_fd = _open_directory_at(generation_fd, ".coc")
        _write_new_regular_at(coc_fd, "runtime.json", runtime_payload)
        os.mkdir("indexes", 0o700, dir_fd=coc_fd)
        indexes_fd = _open_directory_at(coc_fd, "indexes")
        campaign_index = {
            "schema_version": 1,
            "campaigns": {
                metadata["campaign_id"]: {
                    "campaign_id": metadata["campaign_id"],
                    "path": f".coc/campaigns/{metadata['campaign_id']}/campaign.json",
                }
            },
        }
        investigator_index = {
            "schema_version": 1,
            "investigators": {
                metadata["investigator_id"]: {
                    "id": metadata["investigator_id"],
                    "path": (
                        f".coc/investigators/{metadata['investigator_id']}/character.json"
                    ),
                }
            },
        }
        _write_new_regular_at(
            indexes_fd,
            "campaigns.json",
            _canonical_json(campaign_index) + b"\n",
        )
        _write_new_regular_at(
            indexes_fd,
            "investigators.json",
            _canonical_json(investigator_index) + b"\n",
        )
        os.fsync(indexes_fd)
        os.fsync(coc_fd)
        os.fsync(generation_fd)
    except DriverError:
        raise
    except OSError:
        raise DriverError("resume_validation_failed") from None
    finally:
        if indexes_fd >= 0:
            os.close(indexes_fd)
        if coc_fd >= 0:
            os.close(coc_fd)
        if generation_fd >= 0:
            os.close(generation_fd)
        if workspaces_fd >= 0:
            os.close(workspaces_fd)
        os.close(run_fd)
    return run_dir / "workspaces" / name, counter


def emit(payload: dict[str, Any]) -> None:
    try:
        encoded = _canonical_json(payload).decode("utf-8")
        sys.stdout.write(encoded + "\n")
        sys.stdout.flush()
    except (BrokenPipeError, OSError):
        raise _StopRequested from None


def _emit_error(code: str) -> None:
    emit({"kind": "error", "code": code})


def _initial_metadata(
    args: argparse.Namespace,
    workspace: Path,
    session_id: str,
    checkpoint_name: str,
    checkpoint_manifest_sha256: str,
    initial_public_state: dict[str, Any],
    git_head: str,
) -> dict[str, Any]:
    initial_state_sha256 = _request_sha256(initial_public_state)
    return {
        "schema_version": 1,
        "driver_identity": _DRIVER_IDENTITY,
        "driver_sha256": _driver_sha256(),
        "git_head": git_head,
        "campaign_id": args.campaign,
        "investigator_id": args.investigator,
        "run_kind": args.run_kind,
        "rng_seed_base": args.rng_seed,
        "max_turns": args.max_turns,
        "session_id": session_id,
        "original_workspace": str(workspace),
        "active_workspace_path": str(workspace),
        "active_workspace_generation": workspace.name,
        "generation_counter": 0,
        "durable_turn_number": 0,
        "action_chain_sha256": "0" * 64,
        "latest_checkpoint": f"checkpoints/{checkpoint_name}",
        "latest_checkpoint_manifest_sha256": checkpoint_manifest_sha256,
        "initial_public_state_sha256": initial_state_sha256,
        "current_public_state_sha256": initial_state_sha256,
        "pending_model_session_boundary": {
            "kind": "start",
            "after_turn": 0,
        },
        "last_request_id": None,
        "last_request_sha256": None,
        "last_result": None,
        "last_result_sha256": None,
    }


def _write_incomplete_run_marker(run_fd: int, checkpoint_name: str) -> None:
    payload = {
        "schema_version": 1,
        "code": "incomplete_run",
        "checkpoint": f"checkpoints/{checkpoint_name}",
        "driver_identity": _DRIVER_IDENTITY,
        "driver_sha256": _driver_sha256(),
    }
    try:
        _write_new_regular_at(
            run_fd,
            ".incomplete-run.json",
            _canonical_json(payload) + b"\n",
        )
        os.fsync(run_fd)
    except DriverError:
        pass


def _checkpoint_result(
    run_dir: Path,
    metadata: dict[str, Any],
    action_chain_sha256: str,
) -> dict[str, Any]:
    checkpoint = metadata.get("latest_checkpoint")
    digest = metadata.get("latest_checkpoint_manifest_sha256")
    turn_number = metadata.get("durable_turn_number")
    expected = (
        f"checkpoints/turn-{turn_number:06d}"
        if isinstance(turn_number, int) and not isinstance(turn_number, bool)
        else None
    )
    try:
        if checkpoint != expected or not isinstance(digest, str) or not _SHA256.fullmatch(digest):
            raise DriverError("checkpoint_validation_failed")
        selected, manifest, observed_digest = _read_checkpoint_manifest_strict(
            run_dir, run_dir / checkpoint
        )
        if (
            selected.relative_to(run_dir).as_posix() != checkpoint
            or observed_digest != digest
            or manifest.get("turn_number") != turn_number
            or manifest.get("action_chain_sha256") != action_chain_sha256
            or manifest.get("session_id") != metadata.get("session_id")
            or manifest.get("git_head") != metadata.get("git_head")
            or metadata.get("git_head") != _current_git_head()
        ):
            raise DriverError("checkpoint_validation_failed")
    except (DriverError, OSError, ValueError):
        raise _FatalTurnError("checkpoint_validation_failed") from None
    return {
        "kind": "checkpoint_written",
        "turn_number": turn_number,
        "action_chain_sha256": action_chain_sha256,
        "latest_checkpoint": checkpoint,
        "latest_checkpoint_manifest_sha256": digest,
    }


def _operator_stop_result(
    turn_number: int,
    action_chain_sha256: str,
    public_state: dict[str, Any],
    max_turns: int,
) -> dict[str, Any]:
    terminal_evidence = public_state.get("terminal_evidence")
    if not isinstance(terminal_evidence, dict):
        raise _FatalTurnError("public_state_invalid")
    return {
        "kind": "terminal",
        "terminal_kind": "operator_stop",
        "turn_number": turn_number,
        "events": [],
        "public_state": copy.deepcopy(public_state),
        "action_chain_sha256": action_chain_sha256,
        "ceiling_reached": turn_number >= max_turns,
        "terminal_evidence": copy.deepcopy(terminal_evidence),
    }


def _install_signal_handlers() -> None:
    def stop(_signum: int, _frame: Any) -> None:
        raise _StopRequested

    for signum in (signal.SIGTERM, signal.SIGINT):
        signal.signal(signum, stop)


def _interactive_loop(
    *,
    api: ModuleType,
    store: Any,
    args: argparse.Namespace,
    workspace: Path,
    session_id: str,
    metadata: dict[str, Any],
    current_public_state: dict[str, Any],
    request_cache: dict[str, dict[str, Any]],
) -> int:
    while True:
        try:
            raw = read_jsonl_request(sys.stdin.buffer)
            if raw is _EOF:
                return 0
            request = validate_request(raw)
        except DriverError as exc:
            _emit_error(exc.code)
            continue
        turn_number = metadata["durable_turn_number"]
        if request["kind"] == "checkpoint":
            try:
                emit(_checkpoint_result(
                    Path(args.run_dir).absolute(),
                    metadata,
                    store.action_chain_sha256,
                ))
            except _FatalTurnError as exc:
                _emit_error(exc.code)
                return 1
            continue
        if request["kind"] == "stop":
            emit(_operator_stop_result(
                turn_number,
                store.action_chain_sha256,
                current_public_state,
                args.max_turns,
            ))
            return 0
        try:
            response, metadata, current_public_state = _process_gameplay_request(
                api=api,
                store=store,
                args=args,
                workspace=workspace,
                session_id=session_id,
                request=request,
                metadata=metadata,
                request_cache=request_cache,
                current_public_state=current_public_state,
            )
        except _FatalTurnError as exc:
            _emit_error(exc.code)
            return 1
        except DriverError as exc:
            _emit_error(exc.code)
            continue
        emit(response)
        if response["kind"] == "terminal":
            return 0


def _run_start(args: argparse.Namespace) -> int:
    run_dir = Path(args.run_dir).absolute()
    workspace = Path(args.workspace).absolute()
    api: ModuleType | None = None
    session_id: str | None = None
    with RunLock(run_dir) as run_lock:
        args.run_fd = run_lock.directory_fd
        try:
            try:
                os.stat(
                    ".incomplete-run.json",
                    dir_fd=run_lock.directory_fd,
                    follow_symlinks=False,
                )
            except FileNotFoundError:
                pass
            else:
                raise DriverError("incomplete_run")
            run_metadata = run_dir / "run.json"
            try:
                existing = os.lstat(run_metadata)
            except FileNotFoundError:
                existing = None
            except OSError:
                raise DriverError("run_directory_invalid") from None
            if existing is not None:
                raise DriverError("run_exists")
            api = _load_runtime_api()
            run_lock.require_path_identity()
            checkpoint = _load_checkpoint_module()
            try:
                session_id = api.create_session(
                    workspace,
                    campaign_id=args.campaign,
                    investigator_id=args.investigator,
                )
                current_public_state = sanitize_public_state(
                    api.get_state(session_id)
                )
                api.snapshot_workspace_sessions(workspace)
                run_lock.require_path_identity()
                store = checkpoint.CheckpointStore(
                    run_dir, workspace, args.campaign, args.investigator
                )
                store.git_head = _current_git_head()
                initial_checkpoint = store.write_checkpoint(
                    session_id, 0, "initial_state"
                )
                _selected, _manifest, initial_manifest_sha256 = (
                    _read_checkpoint_manifest_strict(
                        run_dir, initial_checkpoint
                    )
                )
            except DriverError:
                raise
            except Exception:
                raise DriverError("start_initialization_failed") from None
            metadata = _initial_metadata(
                args,
                workspace,
                session_id,
                initial_checkpoint.name,
                initial_manifest_sha256,
                current_public_state,
                _manifest["git_head"],
            )
            try:
                atomic_write_metadata(
                    run_dir, metadata, run_fd=run_lock.directory_fd
                )
            except DriverError as exc:
                if exc.code == "run_directory_replaced":
                    raise
                _write_incomplete_run_marker(
                    run_lock.directory_fd, initial_checkpoint.name
                )
                raise DriverError("incomplete_run") from None
            emit({
                "kind": "ready",
                "turn_number": 0,
                "last_request_id": None,
                "public_state": current_public_state,
                "public_state_sha256": metadata["initial_public_state_sha256"],
            })
            return _interactive_loop(
                api=api,
                store=store,
                args=args,
                workspace=workspace,
                session_id=session_id,
                metadata=metadata,
                current_public_state=current_public_state,
                request_cache={},
            )
        finally:
            if api is not None and session_id is not None:
                try:
                    api.close_session(session_id)
                except Exception:
                    pass


def _run_resume(args: argparse.Namespace) -> int:
    run_dir = Path(args.run_dir).absolute()
    api: ModuleType | None = None
    session_id: str | None = None
    with RunLock(run_dir) as run_lock:
        try:
            (
                metadata,
                rows,
                selected,
                manifest,
                manifest_sha256,
                mode,
                request_cache,
                responses,
            ) = _preflight_resume(run_dir, args.checkpoint)
            run_lock.require_path_identity()
            session_id = metadata["session_id"]
            active_workspace = Path(metadata["active_workspace_path"]).absolute()
            checkpoint = _load_checkpoint_module()
            try:
                source_store = checkpoint.CheckpointStore(
                    run_dir,
                    active_workspace,
                    metadata["campaign_id"],
                    metadata["investigator_id"],
                )
                source_store.git_head = _current_git_head()
                run_lock.require_path_identity()
                target, generation_counter = _prepare_fresh_generation(
                    run_dir, metadata
                )
                restored_manifest = source_store.restore_checkpoint(
                    selected, target
                )
                _path, reread_manifest, reread_sha256 = (
                    _read_checkpoint_manifest_strict(run_dir, selected)
                )
                if (
                    restored_manifest != manifest
                    or reread_manifest != manifest
                    or reread_sha256 != manifest_sha256
                ):
                    raise DriverError("resume_validation_failed")
                api = _load_runtime_api()
                restored_ids = api.restore_workspace_sessions(target)
                if restored_ids != [session_id]:
                    raise DriverError("resume_validation_failed")
                current_public_state = sanitize_public_state(
                    api.get_state(session_id)
                )
                selected_turn = manifest["turn_number"]
                expected_state_sha256 = (
                    metadata["initial_public_state_sha256"]
                    if selected_turn == 0
                    else _request_sha256(rows[selected_turn - 1]["state_after"])
                )
                if _request_sha256(current_public_state) != expected_state_sha256:
                    raise DriverError("resume_state_mismatch")
                live_store = checkpoint.CheckpointStore(
                    run_dir,
                    target,
                    metadata["campaign_id"],
                    metadata["investigator_id"],
                )
                # Keep writing checkpoints under the journal/metadata HEAD so tip
                # resume stays aligned after an invalidated code-revision resume.
                # Restore validation still uses current HEAD via source_store.
                live_store.git_head = str(metadata["git_head"])
            except DriverError:
                raise
            except Exception:
                raise DriverError("resume_validation_failed") from None

            updated_metadata = copy.deepcopy(metadata)
            if mode == "checkpoint_ahead":
                row = rows[manifest["turn_number"] - 1]
                response = responses[manifest["turn_number"] - 1]
                updated_metadata.update({
                    "last_request_id": row["action"]["request_id"],
                    "last_request_sha256": _request_sha256(row["action"]),
                    "last_result": copy.deepcopy(response),
                    "last_result_sha256": _request_sha256(response),
                })
            updated_metadata.update({
                "active_workspace_path": str(target),
                "active_workspace_generation": target.name,
                "generation_counter": generation_counter,
                "durable_turn_number": manifest["turn_number"],
                "action_chain_sha256": manifest["action_chain_sha256"],
                "latest_checkpoint": selected.relative_to(run_dir).as_posix(),
                "latest_checkpoint_manifest_sha256": manifest_sha256,
                "current_public_state_sha256": _request_sha256(
                    current_public_state
                ),
                "pending_model_session_boundary": {
                    "kind": "resume",
                    "after_turn": manifest["turn_number"],
                },
            })
            atomic_write_metadata(
                run_dir,
                updated_metadata,
                run_fd=run_lock.directory_fd,
            )
            runtime_args = argparse.Namespace(
                run_kind=updated_metadata["run_kind"],
                rng_seed=updated_metadata["rng_seed_base"],
                investigator=updated_metadata["investigator_id"],
                max_turns=updated_metadata["max_turns"],
                run_dir=str(run_dir),
                run_fd=run_lock.directory_fd,
            )
            turn = updated_metadata["durable_turn_number"]
            if (
                turn >= updated_metadata["max_turns"]
                or current_public_state["terminal_evidence"]["reached_terminal"]
            ):
                if not responses or responses[turn - 1]["kind"] != "terminal":
                    raise DriverError("resume_validation_failed")
                emit(responses[turn - 1])
                return 0
            emit({
                "kind": "ready",
                "turn_number": turn,
                "last_request_id": updated_metadata["last_request_id"],
                "public_state": current_public_state,
                "public_state_sha256": updated_metadata[
                    "current_public_state_sha256"
                ],
            })
            return _interactive_loop(
                api=api,
                store=live_store,
                args=runtime_args,
                workspace=target,
                session_id=session_id,
                metadata=updated_metadata,
                current_public_state=current_public_state,
                request_cache=request_cache,
            )
        finally:
            if api is not None and session_id is not None:
                try:
                    api.close_session(session_id)
                except Exception:
                    pass


def main(argv: list[str] | None = None) -> int:
    try:
        args = _build_parser().parse_args(argv)
        _validate_cli_tokens(args)
        _install_signal_handlers()
        if args.command == "start":
            return _run_start(args)
        if args.command == "resume":
            return _run_resume(args)
        raise DriverError("invalid_arguments")
    except _StopRequested:
        return 0
    except DriverError as exc:
        try:
            _emit_error(exc.code)
        except _StopRequested:
            pass
        return 1
    except Exception:
        try:
            _emit_error("driver_failed")
        except _StopRequested:
            pass
        return 1


def _reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate key")
        result[key] = value
    return result


def _reject_nonfinite(_value: str) -> Any:
    raise ValueError("non-finite number")


def _drain_line(stream: Any) -> None:
    while True:
        chunk = stream.readline(MAX_JSONL_BYTES + 1)
        if not chunk or chunk.endswith(b"\n"):
            return


def read_jsonl_request(stream: Any) -> dict[str, Any] | object:
    """Read one bounded object, rejecting JSON extensions and duplicate keys."""

    raw = stream.readline(MAX_JSONL_BYTES + 1)
    if raw == b"":
        return _EOF
    if len(raw) > MAX_JSONL_BYTES or not raw.endswith(b"\n"):
        if not raw.endswith(b"\n"):
            _drain_line(stream)
        raise DriverError("jsonl_line_too_long")
    raw = raw[:-1]
    if raw.endswith(b"\r"):
        raw = raw[:-1]
    if not raw:
        raise DriverError("malformed_jsonl")
    try:
        decoded = raw.decode("utf-8", errors="strict")
        value = json.loads(
            decoded,
            object_pairs_hook=_reject_duplicate_keys,
            parse_constant=_reject_nonfinite,
        )
    except (UnicodeDecodeError, json.JSONDecodeError, TypeError, ValueError):
        raise DriverError("malformed_jsonl") from None
    if not isinstance(value, dict):
        raise DriverError("malformed_jsonl")
    return value


def _validate_request_id(value: Any) -> str:
    if (
        not _safe_public_identifier(value)
    ):
        raise DriverError("invalid_input")
    return value


def validate_request(value: dict[str, Any]) -> dict[str, Any]:
    kind = value.get("kind")
    if not isinstance(kind, str):
        raise DriverError("invalid_input")
    if kind not in {"turn", "pending_choice", "checkpoint", "stop"}:
        raise DriverError("unknown_input_kind")
    if kind in {"checkpoint", "stop"}:
        if set(value) != {"kind"}:
            raise DriverError("invalid_input")
        return {"kind": kind}
    if kind == "turn":
        if set(value) != {"kind", "request_id", "player_input", "player_intent"}:
            raise DriverError("invalid_input")
        request_id = _validate_request_id(value["request_id"])
        player_input = value["player_input"]
        player_intent = value["player_intent"]
        if (
            not isinstance(player_input, str)
            or not player_input.strip()
            or len(player_input) > 65536
            or not isinstance(player_intent, dict)
        ):
            raise DriverError("invalid_input")
        _canonical_json(player_intent)
        return {
            "kind": "turn",
            "request_id": request_id,
            "player_input": player_input,
            "player_intent": copy.deepcopy(player_intent),
        }
    if set(value) != {"kind", "request_id", "pending_choice_response"}:
        raise DriverError("invalid_input")
    request_id = _validate_request_id(value["request_id"])
    response = value["pending_choice_response"]
    if not isinstance(response, dict) or set(response) != {
        "choice_id", "responder", "revision", "action"
    }:
        raise DriverError("invalid_input")
    if (
        not _nonempty_string(response.get("choice_id"))
        or response.get("responder") != "player"
        or isinstance(response.get("revision"), bool)
        or not isinstance(response.get("revision"), int)
        or response["revision"] < 0
        or not _nonempty_string(response.get("action"))
    ):
        raise DriverError("invalid_input")
    return {
        "kind": "pending_choice",
        "request_id": request_id,
        "pending_choice_response": copy.deepcopy(response),
    }


def _nullable_string(value: Any) -> str | None:
    if value is None or isinstance(value, str):
        return value
    raise DriverError("public_state_invalid")


def _exact_integer_or_none(value: Any) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int):
        raise DriverError("public_state_invalid")
    return value


def sanitize_public_state(state: Any) -> dict[str, Any]:
    """Rebuild the SDK state through an independent player-safe allowlist."""

    if not isinstance(state, dict) or state.get("schema_version") != 1:
        raise DriverError("public_state_invalid")
    campaign_id = state.get("campaign_id")
    turn_number = state.get("turn_number")
    brain = state.get("brain")
    if (
        not _safe_public_identifier(campaign_id)
        or isinstance(turn_number, bool)
        or not isinstance(turn_number, int)
        or turn_number < 0
        or brain not in {"debug", "pi"}
    ):
        raise DriverError("public_state_invalid")
    clue_ids = state.get("discovered_clue_ids")
    if not isinstance(clue_ids, list) or any(
        not _safe_public_identifier(value) for value in clue_ids
    ):
        raise DriverError("public_state_invalid")
    raw_investigators = state.get("investigators")
    if not isinstance(raw_investigators, list):
        raise DriverError("public_state_invalid")
    investigators: list[dict[str, Any]] = []
    for investigator in raw_investigators:
        if not isinstance(investigator, dict) or not _safe_public_identifier(investigator.get("id")):
            raise DriverError("public_state_invalid")
        conditions = investigator.get("conditions")
        if not isinstance(conditions, list) or any(
            not _nonempty_string(value) for value in conditions
        ):
            raise DriverError("public_state_invalid")
        investigators.append({
            "id": investigator["id"],
            "current_hp": _exact_integer_or_none(investigator.get("current_hp")),
            "current_san": _exact_integer_or_none(investigator.get("current_san")),
            "current_mp": _exact_integer_or_none(investigator.get("current_mp")),
            "conditions": list(conditions),
        })
    raw_pending = state.get("pending_choice")
    pending_choice = None
    if raw_pending is not None:
        if not isinstance(raw_pending, dict):
            raise DriverError("public_state_invalid")
        pending_choice = _project_payload("choice", raw_pending)
        if pending_choice is None:
            raise DriverError("public_state_invalid")
    terminal = state.get("terminal_evidence")
    if not isinstance(terminal, dict):
        raise DriverError("public_state_invalid")
    if any(
        not isinstance(terminal.get(field), bool)
        for field in ("reached_terminal", "graph_terminal", "session_ending")
    ):
        raise DriverError("public_state_invalid")
    terminal_evidence = {
        "reached_terminal": terminal["reached_terminal"],
        "active_scene_id": _nullable_string(terminal.get("active_scene_id")),
        "graph_terminal": terminal["graph_terminal"],
        "session_ending": terminal["session_ending"],
    }
    if terminal_evidence["reached_terminal"] is not (
        terminal_evidence["graph_terminal"]
        or terminal_evidence["session_ending"]
    ):
        raise DriverError("public_state_invalid")
    for identifier in (
        state.get("active_scene_id"),
        terminal_evidence["active_scene_id"],
    ):
        if identifier is not None and not _safe_public_identifier(identifier):
            raise DriverError("public_state_invalid")
    health = state.get("state_health")
    if not isinstance(health, dict) or health.get("status") not in {"ok", "degraded", "error"}:
        raise DriverError("public_state_invalid")
    raw_issues = health.get("issues")
    if not isinstance(raw_issues, list):
        raise DriverError("public_state_invalid")
    issues: list[dict[str, str]] = []
    for issue in raw_issues:
        if (
            not isinstance(issue, dict)
            or issue.get("state") not in _STATE_ISSUE_AREAS
            or issue.get("code") not in _STATE_ISSUE_CODES
        ):
            raise DriverError("public_state_invalid")
        issues.append({"state": issue["state"], "code": issue["code"]})
    return {
        "schema_version": 1,
        "campaign_id": campaign_id,
        "play_language": _nullable_string(state.get("play_language")),
        "active_scene_id": _nullable_string(state.get("active_scene_id")),
        "tension_level": _nullable_string(state.get("tension_level")),
        "turn_number": turn_number,
        "discovered_clue_ids": list(clue_ids),
        "investigators": investigators,
        "brain": brain,
        "pending_choice": pending_choice,
        "terminal_evidence": terminal_evidence,
        "state_health": {"status": health["status"], "issues": issues},
    }


def _process_gameplay_request(
    *,
    api: ModuleType,
    store: Any,
    args: argparse.Namespace,
    workspace: Path,
    session_id: str,
    request: dict[str, Any],
    metadata: dict[str, Any],
    request_cache: dict[str, dict[str, Any]],
    current_public_state: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    request_id = request["request_id"]
    request_sha256 = _request_sha256(request)
    cached = request_cache.get(request_id)
    if cached is not None:
        if cached.get("request_sha256") != request_sha256:
            raise _FatalTurnError("request_id_conflict")
        response = cached.get("response")
        if not isinstance(response, dict):
            raise _FatalTurnError("idempotency_state_invalid")
        replay_state = response.get("public_state")
        if not isinstance(replay_state, dict):
            raise _FatalTurnError("idempotency_state_invalid")
        retained_state = (
            current_public_state
            if current_public_state is not None
            else replay_state
        )
        return copy.deepcopy(response), metadata, copy.deepcopy(retained_state)

    turn_number = metadata["durable_turn_number"]
    if turn_number >= args.max_turns:
        raise DriverError("max_turns_reached")
    next_turn = turn_number + 1
    rng_seed = f"{args.rng_seed}:{next_turn:06d}"
    try:
        state_before = sanitize_public_state(api.get_state(session_id))
    except DriverError as exc:
        raise _FatalTurnError(exc.code) from None
    except Exception:
        raise _FatalTurnError("public_state_unavailable") from None

    try:
        if request["kind"] == "turn":
            raw_events = api.send(
                session_id,
                request["player_input"],
                player_intent=request["player_intent"],
                rng_seed=rng_seed,
                durability_mode="checkpoint",
            )
        else:
            raw_events = api.send(
                session_id,
                "",
                pending_choice_response=request["pending_choice_response"],
                rng_seed=rng_seed,
                durability_mode="checkpoint",
            )
    except Exception as exc:
        code = getattr(exc, "kind", None)
        if code != "telemetry_persistence_failed":
            code = "gameplay_send_failed"
        raise _FatalTurnError(code) from None

    try:
        attestation = validate_attestation(
            api.get_last_turn_attestation(session_id)
        )
        if (
            attestation["session_id"] != session_id
            or attestation["investigator_id"] != args.investigator
        ):
            raise DriverError("model_attestation_failed")
        events = sanitize_events(raw_events)
        state_after = sanitize_public_state(api.get_state(session_id))
        terminal_evidence = copy.deepcopy(state_after["terminal_evidence"])
        event_session_ending = any(
            event["type"] == "session_ending" for event in events
        )
        if event_session_ending is not terminal_evidence["session_ending"]:
            raise DriverError("terminal_evidence_mismatch")
        story_terminal = bool(terminal_evidence["reached_terminal"])
        ceiling_reached = next_turn >= args.max_turns
        provenance: dict[str, Any] = {
            "player_mode": args.run_kind,
            "request_id": request_id,
            "request_sha256": request_sha256,
            "rng_seed": rng_seed,
            "model_identity": copy.deepcopy(
                attestation["narrator"]["model_identity"]
            ),
            "narrator_response_mode": attestation["narrator"]["response_mode"],
            "recording_mode": attestation["recording_mode"],
            "recording_flush": attestation["recording_flush"],
            "runtime_receipt_sha256": attestation["runtime_receipt_sha256"],
            "telemetry_receipt_id": attestation["telemetry_receipt_id"],
            "decision_ids": list(attestation["decision_ids"]),
            "director_plan_refs": list(attestation["decision_ids"]),
            "usage": copy.deepcopy(attestation["usage"]),
            "narrator_llm_ms": float(attestation["narrator_llm_ms"]),
            "attestation": copy.deepcopy(attestation),
            "driver_identity": metadata.get("driver_identity", _DRIVER_IDENTITY),
            "driver_sha256": metadata.get("driver_sha256", _driver_sha256()),
            "git_head": metadata.get("git_head", _current_git_head()),
        }
        boundary = metadata.get("pending_model_session_boundary")
        if boundary is not None:
            provenance["model_session_boundary"] = copy.deepcopy(boundary)
        store.append_turn(
            copy.deepcopy(request),
            events,
            state_before,
            state_after,
            provenance,
        )
        if attestation["narrator"]["response_mode"] == "tool":
            _append_narrator_invocation_rows(
                Path(args.run_dir).absolute(),
                turn_number=next_turn,
                attestation=attestation,
            )
        api.snapshot_workspace_sessions(workspace)
        checkpoint_dir = store.write_checkpoint(
            session_id, next_turn, "turn_complete"
        )
        _selected, _manifest, checkpoint_manifest_sha256 = (
            _read_checkpoint_manifest_strict(
                Path(args.run_dir).absolute(), checkpoint_dir
            )
        )
        response: dict[str, Any] = {
            "kind": "terminal"
            if story_terminal or ceiling_reached
            else "turn_result",
            "turn_number": next_turn,
            "events": events,
            "public_state": state_after,
            "attestation": attestation,
            "action_chain_sha256": store.action_chain_sha256,
            "rng_seed": rng_seed,
            "ceiling_reached": ceiling_reached,
            "terminal_evidence": terminal_evidence,
        }
        if story_terminal:
            response["terminal_kind"] = "story_terminal"
        elif ceiling_reached:
            response["terminal_kind"] = "turn_ceiling"
        updated_metadata = copy.deepcopy(metadata)
        updated_metadata.update({
            "durable_turn_number": next_turn,
            "action_chain_sha256": store.action_chain_sha256,
            "latest_checkpoint": f"checkpoints/{checkpoint_dir.name}",
            "latest_checkpoint_manifest_sha256": checkpoint_manifest_sha256,
            "current_public_state_sha256": _request_sha256(state_after),
            "pending_model_session_boundary": None,
            "last_request_id": request_id,
            "last_request_sha256": request_sha256,
            "last_result": copy.deepcopy(response),
            "last_result_sha256": _request_sha256(response),
        })
        atomic_write_metadata(
            Path(args.run_dir).absolute(),
            updated_metadata,
            run_fd=getattr(args, "run_fd", None),
        )
    except _FatalTurnError:
        raise
    except DriverError as exc:
        raise _FatalTurnError(exc.code) from None
    except Exception:
        raise _FatalTurnError("turn_persistence_failed") from None

    request_cache[request_id] = {
        "request_sha256": request_sha256,
        "response": copy.deepcopy(response),
    }
    return response, updated_metadata, state_after


def _append_narrator_invocation_rows(
    run_dir: Path,
    *,
    turn_number: int,
    attestation: dict[str, Any],
) -> None:
    """Persist narrator invocation ledger rows with secret_audit receipts."""
    evidence = _load_playtest_evidence_module()
    registry_path = (
        Path(__file__).resolve().parents[1]
        / "references"
        / "trusted-playtest-runners.json"
    )
    try:
        registry = json.loads(registry_path.read_text(encoding="utf-8"))["runners"][
            "narrator"
        ]
        narrator_path = (_REPO_ROOT / registry["path"]).resolve()
    except (OSError, KeyError, TypeError, json.JSONDecodeError):
        raise DriverError("turn_persistence_failed") from None
    observed = evidence.observe_runner(run_dir, "narrator", narrator_path)
    secret_audits = attestation.get("secret_audits")
    if not isinstance(secret_audits, list) or not secret_audits:
        raise DriverError("model_attestation_failed")
    rows: list[dict[str, Any]] = []
    for attempt, receipt in enumerate(secret_audits, start=1):
        rows.append(
            {
                "schema_version": 1,
                "role": "narrator",
                "attempt": attempt,
                "transcript_turn": turn_number,
                "runner_kind": observed.get("kind"),
                "runner_identity": observed.get("identity"),
                "runner_path": observed.get("path"),
                "runner_sha256": observed.get("sha256"),
                "model_identity": copy.deepcopy(
                    attestation["narrator"]["model_identity"]
                ),
                "outcome": "external_success",
                "response_mode": attestation["narrator"]["response_mode"],
                "fallback_kind": None,
                "secret_audit": copy.deepcopy(receipt),
                "decision_ids": list(attestation["decision_ids"]),
                "attestation_runtime_receipt_sha256": attestation[
                    "runtime_receipt_sha256"
                ],
            }
        )
    path = Path(run_dir).absolute() / "runner-invocations.jsonl"
    encoded = "".join(
        json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n" for row in rows
    )
    try:
        with path.open("a", encoding="utf-8") as handle:
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
    except OSError:
        raise DriverError("turn_persistence_failed") from None


def validate_attestation(attestation: Any) -> dict[str, Any]:
    """Return a safe copy only for the required GLM narrator attestation."""

    try:
        if not isinstance(attestation, dict):
            raise ValueError
        narrator = attestation["narrator"]
        if not isinstance(narrator, dict) or set(narrator) != _NARRATOR_FIELDS:
            raise ValueError
        if (
            not isinstance(narrator.get("model_identity"), dict)
            or set(narrator["model_identity"]) != {"provider", "id"}
            or narrator["model_identity"] != _EXPECTED_MODEL_IDENTITY
        ):
            raise ValueError
        call_count = narrator.get("call_count")
        if isinstance(call_count, bool) or not isinstance(call_count, int):
            raise ValueError
        if call_count < 1:
            raise ValueError
        if narrator.get("response_mode") not in {"tool", "prose_fallback"}:
            raise ValueError
        if narrator.get("consistent") is not True:
            raise ValueError
        if narrator.get("deterministic_fallback") is not False:
            raise ValueError
        if attestation.get("recording_mode") != "sync":
            raise ValueError
        if attestation.get("recording_flush") != "manual":
            raise ValueError
        if attestation.get("schema_version") != 1:
            raise ValueError
        for field in ("session_id", "investigator_id", "telemetry_receipt_id"):
            if not _safe_public_identifier(attestation.get(field)):
                raise ValueError
        decision_ids = attestation.get("decision_ids")
        if (
            not isinstance(decision_ids, list)
            or not decision_ids
            or any(not _safe_public_identifier(value) for value in decision_ids)
            or len(set(decision_ids)) != len(decision_ids)
        ):
            raise ValueError
        digest = attestation.get("runtime_receipt_sha256")
        if (
            not isinstance(digest, str)
            or len(digest) != 64
            or any(char not in "0123456789abcdef" for char in digest)
        ):
            raise ValueError
        usage = attestation.get("usage")
        if not isinstance(usage, dict) or set(usage) != _USAGE_FIELDS:
            raise ValueError
        for field in _USAGE_FIELDS:
            token = usage.get(field)
            if token is not None and (
                isinstance(token, bool) or not isinstance(token, int) or token < 0
            ):
                raise ValueError
        latency = attestation.get("narrator_llm_ms")
        if (
            isinstance(latency, bool)
            or not isinstance(latency, (int, float))
            or latency < 0
            or latency != latency
            or latency in (float("inf"), float("-inf"))
        ):
            raise ValueError
        secret_audits_raw = attestation.get("secret_audits")
        legacy_attestation = "secret_audits" not in attestation
        if legacy_attestation:
            if set(attestation) != (_ATTESTATION_FIELDS - {"secret_audits"}):
                raise ValueError
            secret_audits: list[Any] = []
        else:
            if set(attestation) != _ATTESTATION_FIELDS:
                raise ValueError
            if not isinstance(secret_audits_raw, list):
                raise ValueError
            secret_audits = secret_audits_raw
            if narrator.get("response_mode") == "tool":
                if len(secret_audits) != call_count:
                    raise ValueError
                audit_mod = _load_secret_audit_module()
                for receipt in secret_audits:
                    validation = audit_mod.validate_audit_receipt(receipt)
                    if not validation.get("valid") or not validation.get("passed"):
                        raise ValueError
            elif secret_audits:
                raise ValueError
        return {
            "schema_version": 1,
            "session_id": attestation["session_id"],
            "investigator_id": attestation["investigator_id"],
            "decision_ids": list(decision_ids),
            "telemetry_receipt_id": attestation["telemetry_receipt_id"],
            "runtime_receipt_sha256": digest,
            "recording_mode": "sync",
            "recording_flush": "manual",
            "usage": {
                "input_tokens": usage["input_tokens"],
                "output_tokens": usage["output_tokens"],
            },
            "narrator_llm_ms": float(latency),
            "narrator": {
                "call_count": call_count,
                "model_identity": dict(_EXPECTED_MODEL_IDENTITY),
                "response_mode": narrator["response_mode"],
                "consistent": True,
                "deterministic_fallback": False,
            },
            "secret_audits": copy.deepcopy(secret_audits),
        }
    except (TypeError, ValueError):
        raise DriverError("model_attestation_failed") from None


def _nonempty_string(value: Any) -> bool:
    return isinstance(value, str) and bool(value)


def _safe_public_identifier(value: Any) -> bool:
    return (
        isinstance(value, str)
        and _PUBLIC_IDENTIFIER.fullmatch(value) is not None
        and _CREDENTIAL_LIKE.search(value) is None
    )


def _project_payload(event_type: str, payload: dict[str, Any]) -> dict[str, Any] | None:
    if event_type == "narration":
        if not _nonempty_string(payload.get("text")):
            return None
        result = {"text": payload["text"]}
        if "decision_id" in payload and not _safe_public_identifier(
            payload.get("decision_id")
        ):
            return None
        if _safe_public_identifier(payload.get("decision_id")):
            result["decision_id"] = payload["decision_id"]
        return result
    if event_type == "speech":
        if not _nonempty_string(payload.get("text")):
            return None
        result = {"text": payload["text"]}
        for field in ("speaker_id", "decision_id"):
            if field in payload and not _safe_public_identifier(payload.get(field)):
                return None
            if _safe_public_identifier(payload.get(field)):
                result[field] = payload[field]
        return result
    if event_type == "roll":
        result = {key: copy.deepcopy(value) for key, value in payload.items() if key in _ROLL_FIELDS}
        roll = result.get("roll")
        if isinstance(roll, bool) or not isinstance(roll, int):
            return None
        if any(not _nonempty_string(result[field]) for field in _ROLL_STRING_FIELDS & set(result)):
            return None
        if any(
            not _safe_public_identifier(result[field])
            for field in {"roll_id", "decision_id"} & set(result)
        ):
            return None
        if any(
            isinstance(result[field], bool) or not isinstance(result[field], int)
            for field in _ROLL_INTEGER_FIELDS & set(result)
        ):
            return None
        if any(not isinstance(result[field], bool) for field in _ROLL_BOOLEAN_FIELDS & set(result)):
            return None
        if "die_rolls" in result and (
            not isinstance(result["die_rolls"], list)
            or any(isinstance(value, bool) or not isinstance(value, int) for value in result["die_rolls"])
        ):
            return None
        return result
    if event_type == "choice":
        result = {key: copy.deepcopy(value) for key, value in payload.items() if key in _CHOICE_FIELDS}
        required = {"choice_id", "kind", "command_id", "responder", "revision", "prompt", "options"}
        if (
            not required <= set(result)
            or result.get("kind") not in _CHOICE_KINDS
            or result.get("responder") != "player"
            or isinstance(result.get("revision"), bool)
            or not isinstance(result.get("revision"), int)
            or result["revision"] < 0
            or ("audience" in result and result["audience"] != "player")
            or any(
                not _safe_public_identifier(result.get(field))
                for field in ("choice_id", "command_id")
            )
            or not _nonempty_string(result.get("prompt"))
            or any(
                field in result and not _safe_public_identifier(result[field])
                for field in ("decision_id", "attack_id")
            )
        ):
            return None
        options = result.get("options")
        if not isinstance(options, list) or not options:
            return None
        clean_options = []
        for option in options:
            if not isinstance(option, dict):
                return None
            action, label = option.get("action"), option.get("label")
            if not _nonempty_string(action) or not _nonempty_string(label):
                return None
            clean_options.append({"action": action, "label": label})
        result["options"] = clean_options
        return result
    if event_type == "state_patch":
        final_state = payload.get("final_state")
        state_patch = payload.get("state_patch")
        if not isinstance(final_state, dict) or not isinstance(state_patch, dict):
            return None
        projected_final = {
            key: copy.deepcopy(value)
            for key, value in final_state.items()
            if key in {"active_scene", "tension", "turn_number"}
        }
        for field in ("active_scene", "tension"):
            if field in projected_final and not _safe_public_identifier(
                projected_final[field]
            ):
                return None
        if "turn_number" in projected_final and (
            isinstance(projected_final["turn_number"], bool)
            or not isinstance(projected_final["turn_number"], int)
            or projected_final["turn_number"] < 0
        ):
            return None
        projected_patch = {
            key: value
            for key, value in state_patch.items()
            if key in {"applied", "world_active_scene_updated"}
        }
        if any(not isinstance(value, bool) for value in projected_patch.values()):
            return None
        return {"final_state": projected_final, "state_patch": projected_patch}
    if event_type == "session_ending":
        if payload.get("kind") != "session_ending":
            return None
        if not _safe_public_identifier(payload.get("decision_id")) or not _safe_public_identifier(payload.get("scene_id")):
            return None
        return {
            "kind": "session_ending",
            "decision_id": payload["decision_id"],
            "scene_id": payload["scene_id"],
        }
    return None


def sanitize_events(events: Any) -> list[dict[str, Any]]:
    """Apply an independent structural allowlist before emitting events."""

    if not isinstance(events, list):
        return []
    sanitized: list[dict[str, Any]] = []
    for event in events:
        if not isinstance(event, dict) or event.get("visibility") != "player":
            continue
        event_type = event.get("type")
        if event_type not in _PUBLIC_EVENT_TYPES:
            continue
        if (
            not _safe_public_identifier(event.get("id"))
            or not isinstance(event.get("ts"), str)
            or _PUBLIC_TIMESTAMP.fullmatch(event["ts"]) is None
        ):
            continue
        payload = event.get("payload")
        if not isinstance(payload, dict):
            continue
        projected = _project_payload(event_type, payload)
        if projected is None:
            continue
        sanitized.append(
            {
                "type": event_type,
                "id": event["id"],
                "ts": event["ts"],
                "visibility": "player",
                "payload": projected,
            }
        )
    return sanitized


if __name__ == "__main__":
    raise SystemExit(main())
