#!/usr/bin/env python3
"""Shared exclusion boundary for reusable investigator state.

The reusable ``character.json`` lives outside any one campaign.  A campaign
lock therefore cannot keep another campaign's development settlement from
temporarily owning that sheet.  Canonical readers use the investigator lock
and this marker check so they either observe one committed image or return a
typed, non-mutating recovery conflict.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import re
import stat
from contextlib import ExitStack, contextmanager
from pathlib import Path
from typing import Any, Iterator


SCRIPT_DIR = Path(__file__).resolve().parent


def _load_sibling(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPT_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_fileio = _load_sibling("coc_fileio_investigator_guard", "coc_fileio.py")


_SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_MARKER_NAME = "development-active-transaction.json"
_MARKER_BASE_FIELDS = {
    "schema_version",
    "status",
    "transaction_id",
    "investigator_id",
    "campaign_id",
    "ending_id",
    "inflight_ref",
    "created_at",
}
_MARKER_V2_FIELDS = _MARKER_BASE_FIELDS | {
    "phase",
    "journal_sha256",
    "next_journal_sha256",
    "transition_at",
}


def is_safe_investigator_id(value: Any) -> bool:
    return isinstance(value, str) and _SAFE_ID.fullmatch(value) is not None


class ReusableInvestigatorRecoveryConflict(ValueError):
    """A reusable investigator is owned by an incomplete settlement."""

    code = "RECOVERY_CONFLICT"

    def __init__(
        self,
        transaction_id: str,
        investigator_id: str,
        campaign_id: str,
        marker_path: Path,
    ) -> None:
        self.transaction_id = str(transaction_id)
        self.investigator_id = str(investigator_id)
        self.campaign_id = str(campaign_id)
        self.marker_path = Path(marker_path)
        super().__init__(
            "RECOVERY_CONFLICT "
            f"{self.transaction_id}: investigator {self.investigator_id!r} has "
            "an active development transaction owned by campaign "
            f"{self.campaign_id!r} at {self.marker_path}"
        )


def reusable_investigator_lock_path(coc_root: Path, investigator_id: str) -> Path:
    return (
        Path(coc_root)
        / "locks"
        / "investigators"
        / investigator_id
        / ".investigator.lock"
    )


def development_active_marker_path(coc_root: Path, investigator_id: str) -> Path:
    return Path(coc_root) / "investigators" / investigator_id / _MARKER_NAME


def coc_root_for_campaign(campaign_dir: Path) -> Path:
    campaign = Path(campaign_dir)
    if campaign.parent.name == "campaigns":
        return campaign.parents[1]
    return campaign.parent


def _expected_transaction_id(ending_id: str, investigator_id: str) -> str:
    material = f"{ending_id}\0{investigator_id}".encode("utf-8")
    return "development-txn-" + hashlib.sha256(material).hexdigest()[:24]


def _valid_optional_sha256(value: Any) -> bool:
    return value is None or (
        isinstance(value, str) and _SHA256.fullmatch(value) is not None
    )


def _valid_marker_v2(value: dict[str, Any]) -> bool:
    if set(value) != _MARKER_V2_FIELDS:
        return False
    phase = value.get("phase")
    current = value.get("journal_sha256")
    following = value.get("next_journal_sha256")
    transition_at = value.get("transition_at")
    if phase == "creating":
        return current is None and following is None and transition_at is None
    if phase == "journaled":
        return (
            isinstance(current, str)
            and _SHA256.fullmatch(current) is not None
            and following is None
            and transition_at is None
        )
    if phase == "recovering":
        return (
            isinstance(current, str)
            and _SHA256.fullmatch(current) is not None
            and isinstance(following, str)
            and _SHA256.fullmatch(following) is not None
            and current != following
            and isinstance(transition_at, str)
            and bool(transition_at)
        )
    if phase in {"recovered", "committed"}:
        return (
            isinstance(current, str)
            and _SHA256.fullmatch(current) is not None
            and following is None
            and isinstance(transition_at, str)
            and bool(transition_at)
        )
    return False


def validate_active_marker(
    value: Any, investigator_id: str
) -> dict[str, Any]:
    """Validate legacy schema-v1 and phase-aware schema-v2 markers."""
    if not isinstance(value, dict):
        raise ValueError("development active transaction marker is invalid")
    schema_version = value.get("schema_version")
    if schema_version == 1:
        fields_valid = set(value) == _MARKER_BASE_FIELDS
    elif schema_version == 2:
        fields_valid = _valid_marker_v2(value)
    else:
        fields_valid = False
    ending_id = value.get("ending_id")
    expected_transaction_id = (
        _expected_transaction_id(ending_id, investigator_id)
        if isinstance(ending_id, str)
        else None
    )
    if (
        not fields_valid
        or value.get("status") != "active"
        or value.get("investigator_id") != investigator_id
        or value.get("transaction_id") != expected_transaction_id
        or not all(
            isinstance(value.get(key), str) and bool(value.get(key))
            for key in (
                "transaction_id",
                "campaign_id",
                "ending_id",
                "inflight_ref",
                "created_at",
            )
        )
        or _SAFE_ID.fullmatch(str(value.get("campaign_id"))) is None
        or _SAFE_ID.fullmatch(str(value.get("ending_id"))) is None
        or not _valid_optional_sha256(value.get("journal_sha256"))
        or not _valid_optional_sha256(value.get("next_journal_sha256"))
    ):
        raise ValueError("development active transaction marker is invalid")
    return value


def read_active_marker(
    coc_root: Path, investigator_id: str
) -> dict[str, Any] | None:
    path = development_active_marker_path(coc_root, investigator_id)
    if path.is_symlink():
        raise ValueError("development active transaction marker is unsafe")
    if not path.is_file():
        return None
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError(
            "development active transaction marker is unreadable"
        ) from exc
    return validate_active_marker(value, investigator_id)


def assert_reusable_investigator_idle(
    coc_root: Path, investigator_id: str, *, root_fd: int | None = None
) -> None:
    """Check one already-locked reusable investigator without writing state."""
    marker_path = development_active_marker_path(coc_root, investigator_id)
    try:
        marker = (
            _read_active_marker_at(root_fd, investigator_id)
            if root_fd is not None
            else read_active_marker(coc_root, investigator_id)
        )
    except ValueError as exc:
        raise ReusableInvestigatorRecoveryConflict(
            "development-reader",
            investigator_id,
            "unknown-campaign",
            marker_path,
        ) from exc
    if marker is not None:
        raise ReusableInvestigatorRecoveryConflict(
            str(marker["transaction_id"]),
            investigator_id,
            str(marker["campaign_id"]),
            marker_path,
        )


@contextmanager
def guard_reusable_investigators(
    coc_root: Path,
    investigator_ids: list[str] | tuple[str, ...] | set[str],
    *,
    wait_seconds: float = 5.0,
) -> Iterator[None]:
    """Acquire sorted reusable locks and reject every active marker.

    This helper never acquires a campaign lock.  Callers that need both must
    acquire their campaign lock first, preserving the sole global lock order.
    """
    root = Path(coc_root)
    raw_ids = list(investigator_ids)
    if any(not is_safe_investigator_id(item) for item in raw_ids):
        raise ValueError("investigator ids must be stable safe ids")
    ids = sorted(set(raw_ids))
    try:
        root_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    except OSError as exc:
        raise ValueError(f"investigator root is unsafe: {root}") from exc
    try:
        with ExitStack() as locks:
            for investigator_id in ids:
                lock_path = reusable_investigator_lock_path(root, investigator_id)
                locks.enter_context(
                    coc_fileio.advisory_file_lock_at(
                        root_fd,
                        ("locks", "investigators", investigator_id),
                        ".investigator.lock",
                        display_path=lock_path,
                        wait_seconds=wait_seconds,
                    )
                )
            for investigator_id in ids:
                assert_reusable_investigator_idle(
                    root, investigator_id, root_fd=root_fd
                )
            yield root_fd
    finally:
        os.close(root_fd)


def read_reusable_character(
    coc_root: Path, investigator_id: str, character_path: Path
) -> dict[str, Any]:
    """Read one character object while excluding settlement partial images."""
    root = Path(coc_root).absolute()
    canonical = root / "investigators" / investigator_id / "character.json"
    if Path(character_path).absolute() != canonical:
        raise ValueError("character_path must name the selected canonical investigator")
    with guard_reusable_investigators(root, [investigator_id]) as root_fd:
        investigator_fd = _open_directory_chain(
            root_fd, ("investigators", investigator_id)
        )
        try:
            value = _read_json_object_at(
                investigator_fd, "character.json", "character sheet"
            )
        finally:
            os.close(investigator_fd)
    assert value is not None
    return value


def validate_contained_path_parents(root: Path, target: Path) -> None:
    """Reject lexical escapes and unsafe existing components below ``root``."""
    root_path = Path(root).absolute()
    target_path = Path(target).absolute()
    try:
        relative = target_path.relative_to(root_path)
    except ValueError as exc:
        raise ValueError(f"path escapes canonical root: {target}") from exc
    components = [root_path]
    current = root_path
    for part in relative.parts[:-1]:
        current = current / part
        components.append(current)
    for component in components:
        if component.is_symlink():
            raise ValueError(f"path parent is a symlink: {component}")
        if component.exists() and not component.is_dir():
            raise ValueError(f"path parent is not a directory: {component}")
    resolved_root = root_path.resolve(strict=False)
    try:
        target_path.resolve(strict=False).relative_to(resolved_root)
    except ValueError as exc:
        raise ValueError(f"resolved path escapes canonical root: {target}") from exc


def _read_json_object(path: Path, label: str) -> dict[str, Any]:
    if path.is_symlink():
        raise ValueError(f"{label} is unsafe: {path}")
    if not path.is_file():
        raise ValueError(f"{label} is missing or not a file: {path}")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"{label} is unreadable: {path}") from exc
    if not isinstance(value, dict) or not value:
        raise ValueError(f"{label} must be a non-empty object: {path}")
    return value


def _open_directory_chain(root_fd: int, components: tuple[str, ...]) -> int:
    current_fd = os.dup(root_fd)
    try:
        for component in components:
            following = os.open(
                component,
                os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                dir_fd=current_fd,
            )
            os.close(current_fd)
            current_fd = following
        return current_fd
    except Exception:
        os.close(current_fd)
        raise


def _read_json_object_at(
    directory_fd: int,
    name: str,
    label: str,
    *,
    optional: bool = False,
) -> dict[str, Any] | None:
    try:
        descriptor = os.open(
            name,
            os.O_RDONLY | os.O_NOFOLLOW,
            dir_fd=directory_fd,
        )
    except FileNotFoundError:
        if optional:
            return None
        raise ValueError(f"{label} is missing or not a file") from None
    except OSError as exc:
        raise ValueError(f"{label} is unsafe or unreadable") from exc
    try:
        if not stat.S_ISREG(os.fstat(descriptor).st_mode):
            raise ValueError(f"{label} is unsafe or not a regular file")
        chunks: list[bytes] = []
        while True:
            chunk = os.read(descriptor, 65536)
            if not chunk:
                break
            chunks.append(chunk)
        try:
            value = json.loads(b"".join(chunks).decode("utf-8"))
        except (UnicodeError, json.JSONDecodeError) as exc:
            raise ValueError(f"{label} is unreadable") from exc
        if not isinstance(value, dict) or not value:
            raise ValueError(f"{label} must be a non-empty object")
        return value
    finally:
        os.close(descriptor)


def _read_active_marker_at(
    root_fd: int, investigator_id: str
) -> dict[str, Any] | None:
    try:
        investigator_fd = _open_directory_chain(
            root_fd, ("investigators", investigator_id)
        )
    except FileNotFoundError:
        return None
    try:
        marker = _read_json_object_at(
            investigator_fd,
            _MARKER_NAME,
            "development active transaction marker",
            optional=True,
        )
    finally:
        os.close(investigator_fd)
    return (
        validate_active_marker(marker, investigator_id)
        if marker is not None
        else None
    )


def _validate_character_identity(
    character: dict[str, Any], investigator_id: str
) -> None:
    identities = [
        character[key]
        for key in ("id", "investigator_id")
        if character.get(key) not in (None, "")
    ]
    if not identities or any(value != investigator_id for value in identities):
        raise ValueError("character sheet identity does not match selected investigator")


def validate_investigator_snapshot(
    investigator_id: str,
    character: dict[str, Any],
    creation: dict[str, Any] | None,
) -> dict[str, Any]:
    """Bind character and optional creation records to one immutable identity."""
    if not isinstance(character, dict) or not character:
        raise ValueError("character snapshot must be a non-empty object")
    _validate_character_identity(character, investigator_id)
    if creation is None:
        return {
            "character": json.loads(json.dumps(character)),
            "creation": None,
        }
    if not isinstance(creation, dict) or not creation:
        raise ValueError("creation record must be a non-empty object")
    if creation.get("investigator_id") != investigator_id:
        raise ValueError(
            "creation record investigator_id does not match selected investigator"
        )

    for field in ("name", "era"):
        if (
            creation.get(field) not in (None, "")
            and character.get(field) not in (None, "")
            and creation[field] != character[field]
        ):
            raise ValueError(f"character and creation {field} values disagree")
    occupation = creation.get("occupation")
    creation_occupation = (
        occupation.get("name") if isinstance(occupation, dict) else occupation
    )
    character_occupation = character.get("occupation")
    if isinstance(character_occupation, dict):
        character_occupation = character_occupation.get("name")
    if (
        creation_occupation not in (None, "")
        and character_occupation not in (None, "")
        and creation_occupation != character_occupation
    ):
        raise ValueError("character and creation occupation values disagree")

    character_characteristics = character.get("characteristics")
    creation_characteristics = creation.get("characteristics")
    if isinstance(character_characteristics, dict) and isinstance(
        creation_characteristics, dict
    ):
        for key in set(character_characteristics) & set(creation_characteristics):
            creation_value = creation_characteristics[key]
            final = (
                creation_value.get("final")
                if isinstance(creation_value, dict)
                else creation_value
            )
            if final not in (None, "") and character_characteristics[key] != final:
                raise ValueError(
                    f"character and creation characteristic {key} values disagree"
                )

    character_derived = character.get("derived")
    creation_derived = creation.get("derived")
    if isinstance(character_derived, dict) and isinstance(creation_derived, dict):
        for key in set(character_derived) & set(creation_derived):
            creation_value = creation_derived[key]
            value = (
                creation_value.get("value")
                if isinstance(creation_value, dict)
                else creation_value
            )
            if value not in (None, "") and character_derived[key] != value:
                raise ValueError(
                    f"character and creation derived {key} values disagree"
                )

    allocation = creation.get("skill_allocation")
    allocation_skills = (
        allocation.get("skills") if isinstance(allocation, dict) else None
    )
    character_skills = character.get("skills")
    if isinstance(allocation_skills, dict) and isinstance(character_skills, dict):
        for skill in set(allocation_skills) & set(character_skills):
            entry = allocation_skills[skill]
            final = entry.get("final") if isinstance(entry, dict) else None
            if final not in (None, "") and character_skills[skill] != final:
                raise ValueError(
                    f"character and creation skill {skill} values disagree"
                )

    return {
        "character": json.loads(json.dumps(character)),
        "creation": json.loads(json.dumps(creation)),
    }


def read_reusable_investigator_snapshot(
    coc_root: Path,
    investigator_id: str,
    character_path: Path | None = None,
) -> dict[str, Any]:
    """Read canonical character and optional creation evidence under one guard."""
    root = Path(coc_root).absolute()
    investigator_root = root / "investigators" / investigator_id
    canonical_character = investigator_root / "character.json"
    supplied_character = (
        Path(character_path).absolute()
        if character_path is not None
        else canonical_character
    )
    validate_contained_path_parents(root, canonical_character)
    validate_contained_path_parents(root, supplied_character)
    if supplied_character != canonical_character:
        raise ValueError(
            "character_path must name the selected canonical investigator"
        )
    with guard_reusable_investigators(root, [investigator_id]) as root_fd:
        investigator_fd = _open_directory_chain(
            root_fd, ("investigators", investigator_id)
        )
        try:
            character = _read_json_object_at(
                investigator_fd, "character.json", "character sheet"
            )
            creation = _read_json_object_at(
                investigator_fd,
                "creation.json",
                "creation record",
                optional=True,
            )
        finally:
            os.close(investigator_fd)
        return validate_investigator_snapshot(
            investigator_id,
            character,
            creation,
        )
