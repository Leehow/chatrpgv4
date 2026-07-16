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
import re
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
    coc_root: Path, investigator_id: str
) -> None:
    """Check one already-locked reusable investigator without writing state."""
    marker_path = development_active_marker_path(coc_root, investigator_id)
    try:
        marker = read_active_marker(coc_root, investigator_id)
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
    if any(
        not isinstance(item, str) or _SAFE_ID.fullmatch(item) is None
        for item in raw_ids
    ):
        raise ValueError("investigator ids must be stable safe ids")
    ids = sorted(set(raw_ids))
    with ExitStack() as locks:
        for investigator_id in ids:
            locks.enter_context(
                coc_fileio.advisory_file_lock(
                    reusable_investigator_lock_path(root, investigator_id),
                    wait_seconds=wait_seconds,
                )
            )
        for investigator_id in ids:
            assert_reusable_investigator_idle(root, investigator_id)
        yield


def read_reusable_character(
    coc_root: Path, investigator_id: str, character_path: Path
) -> dict[str, Any]:
    """Read one character object while excluding settlement partial images."""
    with guard_reusable_investigators(coc_root, [investigator_id]):
        try:
            value = json.loads(Path(character_path).read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise ValueError(f"character sheet is unreadable: {character_path}") from exc
        if not isinstance(value, dict):
            raise ValueError(f"character sheet must be an object: {character_path}")
        return value
