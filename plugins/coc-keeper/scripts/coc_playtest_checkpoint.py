"""Durable checkpoints for deterministic COC playtest runs.

The writer deliberately snapshots only the small, explicit set of files needed
to resume a playtest.  It never mirrors the workspace wholesale.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
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


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _atomic_write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        with temporary.open("wb") as handle:
            handle.write(_canonical_json(value) + b"\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        _fsync_directory(path.parent)
    finally:
        temporary.unlink(missing_ok=True)


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
        self.run_dir = Path(run_dir)
        self.workspace = Path(workspace).absolute()
        self.campaign_id = campaign_id
        self.investigator_id = investigator_id
        self.run_dir.mkdir(parents=True, exist_ok=True)
        self.action_ledger = self.run_dir / "actions.jsonl"
        self.git_head = self._read_git_head()
        self.action_chain_sha256 = GENESIS_SHA256
        self._turn_number = 0
        self._last_provenance: dict[str, Any] = {}
        self._recover_action_ledger()

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
        if not self.action_ledger.exists():
            return

        payload = self.action_ledger.read_bytes()
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
        with self.action_ledger.open("r+b") as handle:
            handle.truncate(length)
            handle.flush()
            os.fsync(handle.fileno())

    def append_turn(
        self,
        action: object,
        events: object,
        state_before: object,
        state_after: object,
        provenance: dict[str, Any],
    ) -> Path:
        """Append and fsync one canonical, hash-linked turn record."""

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

        with self.action_ledger.open("ab") as handle:
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
        _fsync_directory(self.run_dir)

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

        checkpoints = self.run_dir / "checkpoints"
        checkpoints.mkdir(parents=True, exist_ok=True)
        checkpoint_dir = checkpoints / f"turn-{turn_number:06d}"
        temporary = checkpoints / f".{checkpoint_dir.name}.{uuid.uuid4().hex}.tmp"
        if checkpoint_dir.exists():
            raise FileExistsError(f"checkpoint already exists: {checkpoint_dir}")

        state_files: list[dict[str, Any]] = []
        scenario_hashes: dict[str, str] = {}
        source_hashes: list[str] = []
        session_snapshot_sha256 = ""
        try:
            temporary.mkdir()
            for source in self._workspace_files():
                relative = source.relative_to(self.workspace)
                destination_relative = Path("state") / relative
                destination = temporary / destination_relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source, destination)
                checksum = _sha256_file(destination)
                state_files.append(
                    {
                        "path": destination_relative.as_posix(),
                        "workspace_path": relative.as_posix(),
                        "sha256": checksum,
                        "size": destination.stat().st_size,
                    }
                )
                if relative.parts[:3] == ("campaigns", self.campaign_id, "scenario"):
                    scenario_hashes[relative.as_posix()] = checksum
                if relative.parts[:3] == ("campaigns", self.campaign_id, "source"):
                    source_hashes.append(checksum)
                if relative == Path(".coc/runtime/sessions.json"):
                    session_snapshot_sha256 = checksum

            manifest = {
                "schema_version": SCHEMA_VERSION,
                "run_id": self.campaign_id,
                "turn_number": turn_number,
                "reason": reason,
                "session_id": session_id,
                "git_head": self.git_head,
                "source_pdf_sha256": source_hashes[0] if source_hashes else "",
                "scenario_hashes": scenario_hashes,
                "state_files": state_files,
                "session_snapshot_sha256": session_snapshot_sha256,
                "action_chain_sha256": self.action_chain_sha256,
                "model_identity": self._last_provenance.get("model_identity", {}),
                "invalidation_state": {"invalidated": False, "segments": []},
                "player_mode": self._last_provenance.get("player_mode"),
            }
            _atomic_write_json(temporary / "manifest.json", manifest)
            os.replace(temporary, checkpoint_dir)
            _fsync_directory(checkpoints)
        finally:
            if temporary.exists():
                shutil.rmtree(temporary)

        return checkpoint_dir

    def restore_checkpoint(self, checkpoint_dir: Path | str, target: Path | str) -> dict[str, Any]:
        """Validate an immutable checkpoint completely, then restore it.

        Validation is intentionally completed before the first target write.
        A malformed manifest, stale source, hostile symlink, or incompatible
        code revision therefore cannot leave a half-restored workspace.
        """

        checkpoint_path = Path(checkpoint_dir).absolute()
        checkpoints_root = (self.run_dir / "checkpoints").absolute()
        self._require_contained(checkpoints_root, checkpoint_path, "checkpoint")
        self._reject_path_symlinks(checkpoint_path, "checkpoint")
        manifest_path = checkpoint_path / "manifest.json"
        if not manifest_path.is_file() or manifest_path.is_symlink():
            raise ValueError("checkpoint manifest is missing or a symlink")
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError("invalid checkpoint manifest") from exc
        if not isinstance(manifest, dict):
            raise ValueError("invalid checkpoint manifest")

        self._validate_manifest_identity(manifest, checkpoint_path)
        entries = self._validate_state_files(manifest, checkpoint_path)

        target_path = Path(target).absolute()
        self._reject_existing_symlink_components(target_path, "target")
        self._validate_existing_target(entries, target_path)

        # No target mutation occurs above this line.
        target_path.mkdir(parents=True, exist_ok=True)
        self._reject_existing_symlink_components(target_path, "target")
        for entry, source in entries:
            relative = Path(entry["workspace_path"])
            destination = target_path / relative
            self._restore_file_atomic(source, destination, target_path)
        marker = target_path / ".coc" / "playtest-runs" / self.campaign_id
        self._mkdir_contained(marker, target_path)
        return manifest

    @staticmethod
    def _safe_relative(value: Any, field: str) -> Path:
        if not isinstance(value, str) or not value or "\x00" in value:
            raise ValueError(f"invalid {field}: containment violation")
        relative = Path(value)
        if relative.is_absolute() or any(part in {"", ".", ".."} for part in relative.parts):
            raise ValueError(f"invalid {field}: traversal is not allowed")
        return relative

    @staticmethod
    def _require_contained(root: Path, path: Path, field: str) -> None:
        try:
            path.relative_to(root)
        except ValueError as exc:
            raise ValueError(f"{field} containment violation") from exc

    @staticmethod
    def _reject_path_symlinks(path: Path, field: str) -> None:
        current = Path(path.anchor) if path.is_absolute() else Path()
        for part in path.parts[1:] if path.is_absolute() else path.parts:
            current = current / part
            if current.is_symlink():
                raise ValueError(f"{field} symlink is not allowed: {current}")

    @staticmethod
    def _reject_existing_symlink_components(path: Path, field: str) -> None:
        current = Path(path.anchor) if path.is_absolute() else Path()
        for part in path.parts[1:] if path.is_absolute() else path.parts:
            current = current / part
            if current.is_symlink():
                raise ValueError(f"{field} symlink is not allowed: {current}")

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

        expected_sources = [
            _sha256_file(path)
            for path in self._workspace_files()
            if path.relative_to(self.workspace).parts[:3]
            == ("campaigns", self.campaign_id, "source")
        ]
        expected_source = expected_sources[0] if expected_sources else ""
        if manifest.get("source_pdf_sha256") != expected_source:
            raise ValueError("checkpoint source hash mismatch")

        expected_scenarios = {
            path.relative_to(self.workspace).as_posix(): _sha256_file(path)
            for path in self._workspace_files()
            if path.relative_to(self.workspace).parts[:3]
            == ("campaigns", self.campaign_id, "scenario")
        }
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

    def _validate_state_files(
        self, manifest: dict[str, Any], checkpoint_path: Path
    ) -> list[tuple[dict[str, Any], Path]]:
        raw_entries = manifest.get("state_files")
        if not isinstance(raw_entries, list) or not raw_entries:
            raise ValueError("invalid checkpoint state files")
        entries: list[tuple[dict[str, Any], Path]] = []
        seen_workspace_paths: set[str] = set()
        scenario_from_entries: dict[str, str] = {}
        session_hash = ""
        for raw in raw_entries:
            if not isinstance(raw, dict) or set(raw) != {
                "path", "workspace_path", "sha256", "size"
            }:
                raise ValueError("invalid checkpoint state file entry")
            stored_relative = self._safe_relative(raw["path"], "checkpoint path")
            workspace_relative = self._safe_relative(raw["workspace_path"], "workspace path")
            if raw["workspace_path"] in seen_workspace_paths:
                raise ValueError("duplicate checkpoint workspace path")
            seen_workspace_paths.add(raw["workspace_path"])
            source = checkpoint_path / stored_relative
            self._require_contained(checkpoint_path, source, "checkpoint path")
            self._reject_path_symlinks(source, "checkpoint source")
            if not source.is_file():
                raise ValueError("checkpoint state file is missing")
            if not isinstance(raw["size"], int) or isinstance(raw["size"], bool):
                raise ValueError("invalid checkpoint state file size")
            if source.stat().st_size != raw["size"] or _sha256_file(source) != raw["sha256"]:
                raise ValueError(f"checkpoint checksum mismatch: {raw['path']}")
            parts = workspace_relative.parts
            if parts[:3] == ("campaigns", self.campaign_id, "scenario"):
                scenario_from_entries[workspace_relative.as_posix()] = raw["sha256"]
            if workspace_relative == Path(".coc/runtime/sessions.json"):
                session_hash = raw["sha256"]
            entries.append((raw, source))
        if scenario_from_entries != manifest.get("scenario_hashes"):
            raise ValueError("checkpoint scenario manifest mismatch")
        if session_hash != manifest.get("session_snapshot_sha256"):
            raise ValueError("checkpoint session snapshot checksum mismatch")
        return entries

    def _validate_existing_target(
        self, entries: list[tuple[dict[str, Any], Path]], target: Path
    ) -> None:
        for entry, _source in entries:
            relative = Path(entry["workspace_path"])
            destination = target / relative
            self._reject_existing_symlink_components(destination, "target")
            parts = relative.parts
            immutable = parts[:3] in {
                ("campaigns", self.campaign_id, "source"),
                ("campaigns", self.campaign_id, "scenario"),
            }
            if destination.exists() and immutable:
                label = "source" if parts[2] == "source" else "scenario"
                if not destination.is_file() or _sha256_file(destination) != entry["sha256"]:
                    raise ValueError(f"existing target {label} does not match checkpoint")

    @staticmethod
    def _mkdir_contained(path: Path, root: Path) -> None:
        CheckpointStore._require_contained(root, path, "target")
        relative = path.relative_to(root)
        current = root
        current.mkdir(parents=True, exist_ok=True)
        for part in relative.parts:
            current = current / part
            if current.is_symlink():
                raise ValueError(f"target symlink is not allowed: {current}")
            current.mkdir(exist_ok=True)

    @staticmethod
    def _restore_file_atomic(source: Path, destination: Path, root: Path) -> None:
        CheckpointStore._require_contained(root, destination, "target")
        CheckpointStore._mkdir_contained(destination.parent, root)
        CheckpointStore._reject_existing_symlink_components(destination, "target")
        temporary = destination.parent / f".{destination.name}.{uuid.uuid4().hex}.tmp"
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        descriptor = os.open(temporary, flags, 0o600)
        try:
            with source.open("rb") as source_handle, os.fdopen(descriptor, "wb") as target_handle:
                descriptor = -1
                shutil.copyfileobj(source_handle, target_handle)
                target_handle.flush()
                os.fsync(target_handle.fileno())
            CheckpointStore._reject_existing_symlink_components(destination.parent, "target")
            os.replace(temporary, destination)
            _fsync_directory(destination.parent)
        finally:
            if descriptor >= 0:
                os.close(descriptor)
            temporary.unlink(missing_ok=True)
