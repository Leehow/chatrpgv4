"""Durable checkpoints for deterministic COC playtest runs.

The writer deliberately snapshots only the small, explicit set of files needed
to resume a playtest.  It never mirrors the workspace wholesale.
"""

from __future__ import annotations

import hashlib
import json
import os
import stat
import subprocess
import uuid
from pathlib import Path
from typing import Any, Iterable


SCHEMA_VERSION = 1
GENESIS_SHA256 = "0" * 64


def _canonical_json(value: object) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def _sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


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
        raise ValueError("checkpoint directory symlink or replacement is not allowed") from exc
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
            if stat.S_ISDIR(child_info.st_mode) and not stat.S_ISLNK(child_info.st_mode):
                _remove_tree_at(directory_fd, child)
            else:
                os.unlink(child, dir_fd=directory_fd)
    finally:
        os.close(directory_fd)
    os.rmdir(relative.name, dir_fd=parent_fd)


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
    ) -> None:
        self._validate_identifier(campaign_id, "campaign_id")
        self._validate_identifier(investigator_id, "investigator_id")
        self.run_dir = Path(run_dir).absolute()
        self.workspace = Path(workspace).absolute()
        self.campaign_id = campaign_id
        self.investigator_id = investigator_id
        try:
            before = os.lstat(self.run_dir)
        except FileNotFoundError:
            before = None
        if before is not None and stat.S_ISLNK(before.st_mode):
            raise ValueError("run directory symlink is not allowed")
        self.run_dir.mkdir(parents=True, exist_ok=True)
        created = os.lstat(self.run_dir)
        if stat.S_ISLNK(created.st_mode):
            raise ValueError("run directory symlink is not allowed")
        if not stat.S_ISDIR(created.st_mode):
            raise ValueError("run directory is not a directory")
        self._run_dir_identity = (created.st_dev, created.st_ino)
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
            raise ValueError("run directory symlink or replacement is not allowed") from exc
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
                raise ValueError(f"symlink is not allowed in checkpoint source: {current}")

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
                _canonical_json({key: value for key, value in row.items() if key != "row_sha256"})
            )
            if row.get("previous_sha256") != previous or row.get("row_sha256") != expected:
                raise ValueError("action ledger checksum mismatch")
            previous = expected
            turn_number = int(row["turn_number"])
            provenance = row.get("provenance")
            if isinstance(provenance, dict):
                last_provenance = provenance

        self.action_chain_sha256 = previous
        self._turn_number = turn_number
        self._last_provenance = last_provenance

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
        campaign = self.workspace / "campaigns" / self.campaign_id
        for directory in (campaign / "source", campaign / "scenario"):
            self._reject_symlink_components(directory)
            if directory.is_dir():
                for path in sorted(directory.rglob("*")):
                    self._reject_symlink_components(path)
                    if path.is_file():
                        yield path

        investigator = self.workspace / "investigators" / f"{self.investigator_id}.json"
        self._reject_symlink_components(investigator)
        if investigator.is_file():
            yield investigator

        sessions = self.workspace / ".coc" / "runtime" / "sessions.json"
        self._reject_symlink_components(sessions)
        if sessions.is_file():
            yield sessions

    def write_checkpoint(
        self,
        session_id: str,
        turn_number: int,
        reason: str,
    ) -> Path:
        """Write an immutable allowlisted snapshot and its checksum manifest."""

        run_fd = self._open_run_dir()
        checkpoints_fd = -1
        temporary_fd = -1
        workspace_fd = -1
        checkpoint_name = f"turn-{turn_number:06d}"
        temporary_name = f".{checkpoint_name}.{uuid.uuid4().hex}.tmp"
        published = False
        state_files: list[dict[str, Any]] = []
        scenario_hashes: dict[str, str] = {}
        source_hashes: dict[str, str] = {}
        session_snapshot_sha256 = ""
        try:
            self._validate_action_ledger_entry(run_fd)
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

            workspace_flags = os.O_RDONLY
            if hasattr(os, "O_DIRECTORY"):
                workspace_flags |= os.O_DIRECTORY
            if hasattr(os, "O_NOFOLLOW"):
                workspace_flags |= os.O_NOFOLLOW
            try:
                workspace_fd = os.open(self.workspace, workspace_flags)
            except OSError as exc:
                raise ValueError("workspace root is a symlink or not a directory") from exc

            def snapshot_file(
                root_fd: int,
                source_relative: Path,
                workspace_relative: Path,
            ) -> tuple[str, int]:
                source_fd = _open_regular_at(root_fd, source_relative)
                parent_fd = -1
                target_fd = -1
                try:
                    destination_relative = Path("state") / workspace_relative
                    parent_fd = _open_or_create_directory_at(
                        temporary_fd, destination_relative.parent
                    )
                    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
                    if hasattr(os, "O_NOFOLLOW"):
                        flags |= os.O_NOFOLLOW
                    target_fd = os.open(
                        destination_relative.name,
                        flags,
                        0o600,
                        dir_fd=parent_fd,
                    )
                    checksum, size = _copy_fd_to_fd(source_fd, target_fd)
                    os.fsync(parent_fd)
                finally:
                    if target_fd >= 0:
                        os.close(target_fd)
                    if parent_fd >= 0:
                        os.close(parent_fd)
                    os.close(source_fd)
                state_files.append(
                    {
                        "path": destination_relative.as_posix(),
                        "workspace_path": workspace_relative.as_posix(),
                        "sha256": checksum,
                        "size": size,
                    }
                )
                return checksum, size

            for source in self._workspace_files():
                relative = source.relative_to(self.workspace)
                checksum, _size = snapshot_file(workspace_fd, relative, relative)
                if relative.parts[:3] == ("campaigns", self.campaign_id, "scenario"):
                    scenario_hashes[relative.as_posix()] = checksum
                if relative.parts[:3] == ("campaigns", self.campaign_id, "source"):
                    source_hashes[relative.as_posix()] = checksum
                if relative == Path(".coc/runtime/sessions.json"):
                    session_snapshot_sha256 = checksum

            self._validate_action_ledger_entry(run_fd)
            try:
                ledger_info = os.stat(
                    "actions.jsonl", dir_fd=run_fd, follow_symlinks=False
                )
            except FileNotFoundError:
                ledger_info = None
            if ledger_info is not None:
                if not stat.S_ISREG(ledger_info.st_mode):
                    raise ValueError("action ledger symlink or non-regular path")
                journal_relative = (
                    Path(".coc")
                    / "playtest-runs"
                    / self.campaign_id
                    / "actions.jsonl"
                )
                snapshot_file(
                    run_fd,
                    Path("actions.jsonl"),
                    journal_relative,
                )

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
                "state_files": state_files,
                "session_snapshot_sha256": session_snapshot_sha256,
                "action_chain_sha256": self.action_chain_sha256,
                "model_identity": self._last_provenance.get("model_identity", {}),
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

    def restore_checkpoint(self, checkpoint_dir: Path | str, target: Path | str) -> dict[str, Any]:
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

            self._validate_manifest_identity(manifest, checkpoint_path)
            entries = self._validate_state_files(manifest, checkpoint_fd)

            target_path = Path(target).absolute()
            target_fd = _open_or_create_directory_path(target_path, "target")
            self._validate_existing_target_at(entries, target_fd)

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
            marker_fd = _open_or_create_directory_at(
                target_fd, Path(".coc") / "playtest-runs" / self.campaign_id
            )
            os.close(marker_fd)
            _require_directory_path_identity(target_path, target_fd, "target")
            os.fsync(target_fd)
            return manifest
        finally:
            for _entry, source_fd in entries:
                os.close(source_fd)
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
        if relative.is_absolute() or any(part in {"", ".", ".."} for part in relative.parts):
            raise ValueError(f"invalid {field}: traversal is not allowed")
        return relative

    def _current_workspace_hashes(self) -> tuple[dict[str, str], dict[str, str]]:
        """Hash live immutable inputs through one verified workspace descriptor."""

        workspace_fd = _open_directory_path(self.workspace, "workspace root")
        source_hashes: dict[str, str] = {}
        scenario_hashes: dict[str, str] = {}
        try:
            for path in self._workspace_files():
                relative = path.relative_to(self.workspace)
                parts = relative.parts
                if parts[:3] not in {
                    ("campaigns", self.campaign_id, "source"),
                    ("campaigns", self.campaign_id, "scenario"),
                }:
                    continue
                source_fd = _open_regular_at(workspace_fd, relative)
                try:
                    checksum, _size = _sha256_fd(source_fd)
                finally:
                    os.close(source_fd)
                if parts[2] == "source":
                    source_hashes[relative.as_posix()] = checksum
                else:
                    scenario_hashes[relative.as_posix()] = checksum
        finally:
            os.close(workspace_fd)
        return source_hashes, scenario_hashes

    def _validate_manifest_identity(self, manifest: dict[str, Any], checkpoint_path: Path) -> None:
        version = manifest.get("schema_version")
        if isinstance(version, bool) or not isinstance(version, int) or version != SCHEMA_VERSION:
            raise ValueError("checkpoint schema version mismatch")
        if manifest.get("run_id") != self.campaign_id:
            raise ValueError("checkpoint run id mismatch")
        if manifest.get("player_mode") != self._last_provenance.get("player_mode"):
            raise ValueError("checkpoint player mode mismatch")
        if manifest.get("action_chain_sha256") != self.action_chain_sha256:
            raise ValueError("checkpoint action chain checksum mismatch")

        expected_sources, expected_scenarios = self._current_workspace_hashes()
        if manifest.get("source_hashes") != expected_sources:
            raise ValueError("checkpoint source hashes mismatch")
        expected_source = ""
        if expected_sources:
            expected_source = expected_sources[sorted(expected_sources)[0]]
        if manifest.get("source_pdf_sha256") != expected_source:
            raise ValueError("checkpoint source hash mismatch")

        if manifest.get("scenario_hashes") != expected_scenarios:
            raise ValueError("checkpoint scenario hash mismatch")

        old_head = manifest.get("git_head")
        if old_head != self.git_head:
            state = manifest.get("invalidation_state")
            segments = state.get("segments") if isinstance(state, dict) else None
            valid = isinstance(segments, list) and any(
                isinstance(segment, dict)
                and set(segment) == {
                    "kind", "old_commit", "new_commit", "replay_start_checkpoint"
                }
                and segment.get("kind") == "invalidated_segment"
                and segment.get("old_commit") == old_head
                and segment.get("new_commit") == self.git_head
                and segment.get("replay_start_checkpoint") == checkpoint_path.name
                for segment in segments
            )
            if not valid:
                raise ValueError("checkpoint Git HEAD mismatch requires an exact invalidated segment")

    def _restore_destination_is_allowlisted(self, relative: Path) -> bool:
        parts = relative.parts
        campaign_prefix = ("campaigns", self.campaign_id)
        journal = (
            ".coc",
            "playtest-runs",
            self.campaign_id,
            "actions.jsonl",
        )
        return (
            len(parts) >= 4
            and parts[:2] == campaign_prefix
            and parts[2] in {"source", "scenario"}
        ) or parts in {
            ("investigators", f"{self.investigator_id}.json"),
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
        session_hash = ""
        try:
            for raw in raw_entries:
                if not isinstance(raw, dict) or set(raw) != {
                    "path", "workspace_path", "sha256", "size"
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
                    raise ValueError("checkpoint state path does not match restore destination")
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
                        raise ValueError(
                            f"checkpoint checksum mismatch: {raw['path']}"
                        )
                    parts = workspace_relative.parts
                    if parts[:3] == ("campaigns", self.campaign_id, "source"):
                        source_from_entries[canonical_workspace] = checksum
                    if parts[:3] == ("campaigns", self.campaign_id, "scenario"):
                        scenario_from_entries[canonical_workspace] = checksum
                    if workspace_relative == Path(".coc/runtime/sessions.json"):
                        session_hash = checksum
                    entries.append((raw, source_fd))
                    source_fd = -1
                finally:
                    if source_fd >= 0:
                        os.close(source_fd)
            if source_from_entries != manifest.get("source_hashes"):
                raise ValueError("checkpoint source manifest mismatch")
            if scenario_from_entries != manifest.get("scenario_hashes"):
                raise ValueError("checkpoint scenario manifest mismatch")
            if session_hash != manifest.get("session_snapshot_sha256"):
                raise ValueError("checkpoint session snapshot checksum mismatch")
            return entries
        except Exception:
            for _entry, source_fd in entries:
                os.close(source_fd)
            raise

    def _validate_existing_target_at(
        self, entries: list[tuple[dict[str, Any], int]], target_fd: int
    ) -> None:
        for entry, _source_fd in entries:
            relative = Path(entry["workspace_path"])
            parent_fd = _open_existing_directory_at(target_fd, relative.parent)
            if parent_fd is None:
                continue
            try:
                try:
                    info = os.stat(
                        relative.name, dir_fd=parent_fd, follow_symlinks=False
                    )
                except FileNotFoundError:
                    continue
                if stat.S_ISLNK(info.st_mode):
                    raise ValueError(f"target symlink is not allowed: {relative}")
                if not stat.S_ISREG(info.st_mode):
                    raise ValueError(f"target path is not a regular file: {relative}")
                parts = relative.parts
                immutable = parts[:3] in {
                    ("campaigns", self.campaign_id, "source"),
                    ("campaigns", self.campaign_id, "scenario"),
                }
                if immutable:
                    destination_fd = _open_regular_at(parent_fd, relative.name)
                    try:
                        checksum, _size = _sha256_fd(destination_fd)
                    finally:
                        os.close(destination_fd)
                    label = "source" if parts[2] == "source" else "scenario"
                    if checksum != entry["sha256"]:
                        raise ValueError(
                            f"existing target {label} does not match checkpoint"
                        )
            finally:
                os.close(parent_fd)

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
