#!/usr/bin/env python3
"""Opaque, durable playtest run identities.

Artifact directory names are presentation only.  A run identity is minted once,
persisted inside the physical artifact with an atomic create, and reused when
that same artifact is reopened.
"""
from __future__ import annotations

import hashlib
import json
import os
import stat
import time
import uuid
from pathlib import Path
from typing import Any


RUN_IDENTITY_SCHEMA_VERSION = 2
LEGACY_RUN_IDENTITY_SCHEMA_VERSION = 1
RUN_IDENTITY_FILENAME = "run-identity.json"
RUN_ID_PREFIX = "coc-run-v1:"


class RunIdentityError(ValueError):
    """A play artifact cannot be bound to one unambiguous campaign run."""

    code = "run_identity_conflict"


def normalize_run_id(value: Any) -> str:
    if (
        not isinstance(value, str)
        or not value.strip()
        or value != value.strip()
    ):
        raise RunIdentityError("run_id must be a non-empty string")
    return value


def mint_run_id() -> str:
    """Mint an opaque identifier; campaign scope is bound by the identity file."""
    return f"{RUN_ID_PREFIX}{uuid.uuid4().hex}"


def _artifact_location_sha256(run_dir: Path | str) -> str:
    """Hash the canonical current-artifact location without persisting its path."""
    try:
        canonical = Path(run_dir).resolve(strict=True)
    except OSError as exc:
        raise RunIdentityError(
            "artifact location cannot be resolved"
        ) from exc
    return hashlib.sha256(str(canonical).encode("utf-8")).hexdigest()


def _identity_body(
    campaign_id: str,
    run_id: str,
    *,
    artifact_location_sha256: str,
) -> dict[str, Any]:
    campaign = str(campaign_id).strip()
    if not campaign:
        raise RunIdentityError("campaign_id must be a non-empty string")
    return {
        "schema_version": RUN_IDENTITY_SCHEMA_VERSION,
        "campaign_id": campaign,
        "run_id": normalize_run_id(run_id),
        "artifact_location_sha256": artifact_location_sha256,
    }


def read_artifact_run_identity(run_dir: Path | str) -> dict[str, Any] | None:
    """Read an identity as historical evidence without asserting current location.

    Location validation belongs to :func:`ensure_artifact_run_identity`.  This
    distinction keeps completed artifacts portable when used only as a resume
    source while preventing a copied artifact from becoming a second current
    run instance.
    """
    path = Path(run_dir) / RUN_IDENTITY_FILENAME
    if not path.exists() and not path.is_symlink():
        return None
    try:
        mode = path.lstat().st_mode
    except OSError as exc:
        raise RunIdentityError("artifact run identity is unreadable") from exc
    if not stat.S_ISREG(mode):
        raise RunIdentityError("artifact run identity is not a regular file")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise RunIdentityError("artifact run identity is unreadable") from exc
    if not isinstance(payload, dict):
        raise RunIdentityError("artifact run identity has an invalid contract")
    schema_version = payload.get("schema_version")
    expected_keys = (
        {"schema_version", "campaign_id", "run_id"}
        if schema_version == LEGACY_RUN_IDENTITY_SCHEMA_VERSION
        else {
            "schema_version",
            "campaign_id",
            "run_id",
            "artifact_location_sha256",
        }
        if schema_version == RUN_IDENTITY_SCHEMA_VERSION
        else set()
    )
    location_witness = payload.get("artifact_location_sha256")
    if (
        not isinstance(schema_version, int)
        or isinstance(schema_version, bool)
        or set(payload) != expected_keys
        or not isinstance(payload.get("campaign_id"), str)
        or not payload["campaign_id"].strip()
        or payload["campaign_id"] != payload["campaign_id"].strip()
        or not isinstance(payload.get("run_id"), str)
        or not payload["run_id"].strip()
        or payload["run_id"] != payload["run_id"].strip()
        or (
            schema_version == RUN_IDENTITY_SCHEMA_VERSION
            and (
                not isinstance(location_witness, str)
                or len(location_witness) != 64
                or any(char not in "0123456789abcdef" for char in location_witness)
            )
        )
    ):
        raise RunIdentityError("artifact run identity has an invalid contract")
    return payload


def _validate_current_identity(
    identity: dict[str, Any],
    directory: Path,
    campaign: str,
    requested: str | None,
) -> str:
    if identity["campaign_id"] != campaign:
        raise RunIdentityError(
            "artifact run identity belongs to a different campaign"
        )
    if identity["schema_version"] != RUN_IDENTITY_SCHEMA_VERSION:
        raise RunIdentityError(
            "legacy current artifact identity cannot prove its physical location"
        )
    if identity["artifact_location_sha256"] != _artifact_location_sha256(directory):
        raise RunIdentityError(
            "artifact run identity belongs to a different physical location"
        )
    if requested is not None and identity["run_id"] != requested:
        raise RunIdentityError(
            "artifact run identity conflicts with the requested run_id"
        )
    return str(identity["run_id"])


def _fsync_directory(path: Path) -> None:
    flags = os.O_RDONLY
    if hasattr(os, "O_DIRECTORY"):
        flags |= os.O_DIRECTORY
    try:
        fd = os.open(path, flags)
    except OSError:
        return
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def ensure_artifact_run_identity(
    run_dir: Path | str,
    campaign_id: str,
    *,
    requested_run_id: str | None = None,
) -> str:
    """Atomically create or validate one physical artifact's identity.

    Concurrent unrequested opens converge on the winning persisted identity.
    A caller that already owns a run ID must match the persisted value exactly.
    """
    directory = Path(run_dir)
    directory.mkdir(parents=True, exist_ok=True)
    campaign = str(campaign_id).strip()
    if not campaign:
        raise RunIdentityError("campaign_id must be a non-empty string")
    requested = (
        normalize_run_id(requested_run_id)
        if requested_run_id is not None
        else None
    )

    existing = read_artifact_run_identity(directory)
    if existing is not None:
        return _validate_current_identity(
            existing,
            directory,
            campaign,
            requested,
        )

    candidate = requested or mint_run_id()
    body = _identity_body(
        campaign,
        candidate,
        artifact_location_sha256=_artifact_location_sha256(directory),
    )
    encoded = (
        json.dumps(body, ensure_ascii=False, indent=2) + "\n"
    ).encode("utf-8")
    target = directory / RUN_IDENTITY_FILENAME
    temp = directory / f".{RUN_IDENTITY_FILENAME}.{os.getpid()}.{uuid.uuid4().hex}.tmp"
    try:
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        fd = os.open(temp, flags, 0o600)
        with os.fdopen(fd, "wb") as handle:
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
        try:
            os.link(temp, target)
            _fsync_directory(directory)
            return candidate
        except FileExistsError:
            # Another opener won the atomic publication race.  Unrequested
            # reentry adopts that durable identity; requested callers compare.
            existing = read_artifact_run_identity(directory)
            if existing is None:
                raise RunIdentityError(
                    "artifact run identity publication was indeterminate"
                )
            return _validate_current_identity(
                existing,
                directory,
                campaign,
                requested,
            )
    finally:
        try:
            temp.unlink()
        except FileNotFoundError:
            pass


def allocate_default_run_dir(
    parent: Path | str,
    *,
    stamp: str | None = None,
) -> Path:
    """Atomically allocate a unique default artifact directory."""
    root = Path(parent)
    root.mkdir(parents=True, exist_ok=True)
    timestamp = stamp or time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    for _attempt in range(128):
        candidate = root / f"live-match-{timestamp}-{uuid.uuid4().hex[:12]}"
        try:
            candidate.mkdir()
        except FileExistsError:
            continue
        return candidate
    raise RunIdentityError("could not allocate a unique playtest run directory")
