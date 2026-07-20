#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from coc_fileio import (
    advisory_file_lock as _advisory_file_lock,
    write_json_atomic as _fileio_write_json_atomic,
)
from coc_language import DEFAULT_PLAY_LANGUAGE, language_profile
import coc_investigator_guard
import coc_flag_state


# Per-kind current schema versions. Persisted state is accepted only when it
# matches these versions exactly. This project intentionally has no migration
# registry or legacy reader.
CURRENT_SCHEMA_VERSIONS: dict[str, int] = {
    "campaign": 1,
    "world": 2,
    "pacing": 1,
    "investigator": 1,
}

_SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_RUNTIME_SESSION_KEYS = {
    "session_id",
    "campaign_id",
    "investigator_id",
    "character_relpath",
    "resolved_config",
    "brain_at_create",
}


class UnsupportedSaveSchema(ValueError):
    """Typed clean-slate rejection for a non-current persisted generation."""

    code = "unsupported_save_schema"
    fresh_generation_required = True

    def __init__(self, *, kind: str, path: Path | None = None, reason: str) -> None:
        self.kind = kind
        self.path = Path(path) if path is not None else None
        self.reason = reason
        super().__init__(self.code)

    def to_dict(self) -> dict[str, Any]:
        """Return a sanitized machine-readable failure without save contents."""
        return {
            "code": self.code,
            "fresh_generation_required": self.fresh_generation_required,
            "kind": self.kind,
            "reason": self.reason,
            "path_name": self.path.name if self.path is not None else None,
        }


TOP_LEVEL_DIRS = (
    "rules",
    "investigators",
    "campaigns",
    "playtests",
    "indexes",
    "module-library",
    "exports",
)

CAMPAIGN_DIRS = (
    "save/investigator-state",
    "save/continuation/checkpoints",
    "scenario",
    "index",
    "memory",
    "logs",
    "snapshots",
)

SNAPSHOT_DIRS = ("save", "scenario", "index", "memory", "logs")

ERA_CLOCKS = {
    "ww1": {
        "calendar_mode": "gregorian",
        "local_datetime": "1916-12-12T06:30:00",
        "timezone": "Europe/Rome",
        "display": "1916-12-12 06:30",
    },
    "1920s": {
        "calendar_mode": "gregorian",
        "local_datetime": "1925-01-15T20:00:00",
        "timezone": "America/New_York",
        "display": "1925-01-15 20:00",
    },
    # Spanish Golden Age / Inquisition-era one-shots (e.g. 人间乐土, 1597 summer).
    "1590s": {
        "calendar_mode": "gregorian",
        "local_datetime": "1597-07-15T10:00:00",
        "timezone": "Europe/Madrid",
        "display": "1597-07-15 10:00",
    },
    # Historical categories without a safe universal calendar anchor stay
    # relative until a progressive module supplies start_clock evidence.
    "prehistoric": {
        "calendar_mode": "relative",
        "local_datetime": None,
        "timezone": None,
        "display": "",
    },
    "medieval": {
        "calendar_mode": "relative",
        "local_datetime": None,
        "timezone": None,
        "display": "",
    },
    "early_modern": {
        "calendar_mode": "relative",
        "local_datetime": None,
        "timezone": None,
        "display": "",
    },
    # Gaslight / late Victorian default (London).
    "1890s": {
        "calendar_mode": "gregorian",
        "local_datetime": "1890-09-15T18:00:00",
        "timezone": "Europe/London",
        "display": "1890-09-15 18:00",
    },
    # Stalin-era / Great Purge one-shots (e.g. Cold Harvest, Oct 1937).
    "1930s": {
        "calendar_mode": "gregorian",
        "local_datetime": "1937-10-12T10:00:00",
        "timezone": "Europe/Moscow",
        "display": "1937-10-12 10:00",
    },
    # Seventies road/survival scenarios; source-specific start_clock can
    # replace this neutral July 1975 Texas anchor.
    "1970s": {
        "calendar_mode": "gregorian",
        "local_datetime": "1975-07-01T11:00:00",
        "timezone": "America/Chicago",
        "display": "1975-07-01 11:00",
    },
    "modern": {
        "calendar_mode": "gregorian",
        "local_datetime": "2025-01-15T20:00:00",
        "timezone": "America/New_York",
        "display": "2025-01-15 20:00",
    },
    "roman": {
        "calendar_mode": "relative",
        "local_datetime": None,
        "timezone": None,
        "display": "",
    },
}

# Freeform campaign/module era strings map to a canonical ERA_CLOCKS key.
ERA_ALIASES = {
    "classic": "1920s",
    "cthulhu_classic": "1920s",
    "gaslight": "1890s",
    "victorian": "1890s",
    "prehistoric": "prehistoric",
    "paleolithic": "prehistoric",
    "ice_age": "prehistoric",
    "40000_bce": "prehistoric",
    "middle_ages": "medieval",
    "medieval": "medieval",
    "early_modern": "early_modern",
    "roman_britain": "roman",
    "contemporary": "modern",
    "present": "modern",
    "dark_ages": "roman",
    "dark-ages": "roman",
    "world_war_i": "ww1",
    "world_war_1": "ww1",
    "great_war": "ww1",
    "great_purge": "1930s",
    "stalin": "1930s",
    "soviet": "1930s",
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def coc_root(root: Path) -> Path:
    # Idempotent: if `root` already points at the `.coc` directory, use it
    # directly; otherwise treat it as the workspace root containing `.coc/`.
    # This keeps coc_state.coc_root consistent with coc_starter._coc_root so
    # callers may pass either a workspace root or an already-resolved `.coc`
    # directory.
    root = Path(root)
    if root.name == ".coc":
        return root
    return root / ".coc"


def write_json_atomic(path: Path, payload: dict[str, Any] | list[Any]) -> None:
    # Preserve historical serialization: indent=2, ensure_ascii=True (json default),
    # trailing newline. Delegates fsync+replace to coc_fileio.
    _fileio_write_json_atomic(
        path, payload, indent=2, ensure_ascii=True, trailing_newline=True
    )


def normalize_era(era: str | None, *, default: str = "1920s") -> str:
    """Map freeform era labels to a canonical ``ERA_CLOCKS`` key.

    Unknown values fall back to ``default`` (usually ``1920s``). Decade forms
    such as ``1590s`` and year-leading strings such as ``1597 Spain`` resolve
    when that decade is registered.
    """
    raw = str(era or "").strip()
    if not raw:
        return default if default in ERA_CLOCKS else "1920s"
    if raw in ERA_CLOCKS:
        return raw
    key = raw.lower().replace(" ", "_").replace("/", "_")
    if key in ERA_CLOCKS:
        return key
    if key in ERA_ALIASES:
        mapped = ERA_ALIASES[key]
        return mapped if mapped in ERA_CLOCKS else default
    # Exact decade token: 1590s / 1890s
    if re.fullmatch(r"\d{3,4}s", key) and key in ERA_CLOCKS:
        return key
    # Leading year: "1597 Spain", "1597-spain", "year-1597"
    year_match = re.search(r"(?<!\d)(\d{4})(?!\d)", key)
    if year_match:
        year = int(year_match.group(1))
        decade = f"{(year // 10) * 10}s"
        if decade in ERA_CLOCKS:
            return decade
        if 500 <= year <= 1499:
            return "medieval"
        if 1500 <= year <= 1699:
            return "early_modern"
    return default if default in ERA_CLOCKS else "1920s"


def initial_clock_for_era(era: str = "1920s", start_clock: dict[str, Any] | None = None) -> dict[str, Any]:
    era_key = normalize_era(era)
    era_clock = ERA_CLOCKS[era_key]
    if start_clock:
        return {
            "elapsed_minutes": 0,
            "scale": start_clock.get("scale", "scene"),
            "calendar_mode": start_clock.get("calendar_mode", era_clock["calendar_mode"]),
            "local_datetime": start_clock.get("local_datetime", era_clock["local_datetime"]),
            "timezone": start_clock.get("timezone", era_clock["timezone"]),
            "location_id": start_clock.get("location_id"),
            "display": start_clock.get("display", era_clock["display"]),
            "day_phase_boundaries": start_clock.get("day_phase_boundaries"),
            "appearance_mode": start_clock.get("appearance_mode", "normal"),
            "appearance_display_label": start_clock.get("appearance_display_label"),
            "appearance_source_ref": start_clock.get("appearance_source_ref"),
        }
    return {
        "elapsed_minutes": 0,
        "scale": "scene",
        "calendar_mode": era_clock["calendar_mode"],
        "local_datetime": era_clock["local_datetime"],
        "timezone": era_clock["timezone"],
        "location_id": None,
        "display": era_clock["display"],
        "appearance_mode": "normal",
        "appearance_display_label": None,
        "appearance_source_ref": None,
    }


def reseed_campaign_clock_for_era(
    campaign_dir: Path,
    campaign_id: str,
    era: str,
    *,
    preserve_elapsed: bool = True,
    start_clock: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Rewrite ``save/time-state.json`` clock fields for ``era``.

    When ``preserve_elapsed`` is true, keep ``elapsed_minutes`` and advance the
    new epoch by that amount so mid-session era repairs do not rewind travel.
    """
    from datetime import timedelta

    era_key = normalize_era(era)
    campaign_dir = Path(campaign_dir)
    time_state_path = campaign_dir / "save" / "time-state.json"
    elapsed = 0
    current_location: Any = None
    existing: dict[str, Any] = {}
    if time_state_path.is_file():
        try:
            existing = json.loads(time_state_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            existing = {}
        if preserve_elapsed and isinstance(existing.get("clock"), dict):
            try:
                elapsed = int(existing["clock"].get("elapsed_minutes") or 0)
            except (TypeError, ValueError):
                elapsed = 0
            current_location = existing["clock"].get("location_id")
    clock = initial_clock_for_era(era_key, start_clock)
    clock["elapsed_minutes"] = max(0, elapsed)
    if preserve_elapsed and current_location is not None:
        clock["location_id"] = current_location
    base_raw = clock.get("local_datetime")
    if base_raw and elapsed:
        try:
            base = datetime.fromisoformat(str(base_raw))
            advanced = base + timedelta(minutes=elapsed)
            clock["local_datetime"] = advanced.isoformat(timespec="seconds")
            clock["display"] = advanced.strftime("%Y-%m-%d %H:%M")
        except ValueError:
            pass
    payload = {
        "schema_version": 1,
        "campaign_id": campaign_id,
        "timeline_id": existing.get("timeline_id") or "tl-main",
        "branch_id": existing.get("branch_id") or "main",
        "forked_from": existing.get("forked_from"),
        "sequence": int(existing.get("sequence") or 1),
        "clock": clock,
        "anchors": existing.get("anchors")
        or {
            "campaign_start_elapsed": 0,
            "last_rest_elapsed": 0,
            "last_safe_place_elapsed": 0,
            "last_scene_change_elapsed": 0,
        },
        "sanity_periods": existing.get("sanity_periods") or {},
        "safe_place": bool(existing.get("safe_place", False)),
    }
    write_json_atomic(time_state_path, payload)
    return clock


def reset_campaign_time_state(
    campaign_dir: Path,
    campaign_id: str,
    *,
    era: str = "1920s",
    start_clock: dict[str, Any] | None = None,
) -> Path:
    time_state_path = campaign_dir / "save" / "time-state.json"
    write_json_atomic(
        time_state_path,
        {
            "schema_version": 1,
            "campaign_id": campaign_id,
            "timeline_id": "tl-main",
            "branch_id": "main",
            "forked_from": None,
            "sequence": 0,
            "clock": initial_clock_for_era(era, start_clock),
            "anchors": {
                "campaign_start_elapsed": 0,
                "last_rest_elapsed": 0,
                "last_safe_place_elapsed": 0,
                "last_scene_change_elapsed": 0,
            },
            "sanity_periods": {},
            "safe_place": False,
        },
    )
    return time_state_path


def _write_json_if_missing(path: Path, payload: dict[str, Any] | list[Any]) -> None:
    if not path.exists():
        write_json_atomic(path, payload)


def _touch_if_missing(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.touch(exist_ok=True)


def _relative_to_root(root: Path, path: Path) -> str:
    return path.relative_to(root).as_posix()


def validate_state_schema(data: dict[str, Any], kind: str) -> dict[str, Any]:
    """Validate and return exact-current state without migration."""
    if not isinstance(data, dict):
        raise UnsupportedSaveSchema(kind=kind, reason="non_object_json")
    current = int(CURRENT_SCHEMA_VERSIONS.get(kind, 1))
    raw_version = data.get("schema_version")
    if (
        isinstance(raw_version, bool)
        or not isinstance(raw_version, int)
    ):
        raise UnsupportedSaveSchema(kind=kind, reason="missing_or_invalid_schema")
    if raw_version != current:
        raise UnsupportedSaveSchema(
            kind=kind,
            reason=f"schema_version_mismatch:{raw_version}!={current}",
        )
    return data


def _campaign_logs_dir_for(path: Path) -> Path | None:
    """Best-effort locate ``campaign/logs`` from a save or campaign JSON path."""
    path = Path(path)
    for parent in (path.parent, *path.parents):
        if parent.name == "save" and (parent.parent / "logs").is_dir():
            return parent.parent / "logs"
        if (parent / "logs").is_dir() and (parent / "campaign.json").exists():
            return parent / "logs"
        if parent.name == "campaigns":
            break
    sibling_logs = path.parent / "logs"
    if sibling_logs.is_dir():
        return sibling_logs
    return None


def _emit_corrupt_save_warning(
    path: Path,
    *,
    backup_path: Path,
    reason: str,
) -> None:
    warning = {
        "event_type": "corrupt_save_backup",
        "schema_version": 1,
        "path": str(path),
        "backup_path": str(backup_path),
        "reason": reason,
        "ts": now_iso(),
    }
    logs_dir = _campaign_logs_dir_for(path)
    if logs_dir is None:
        logs_dir = path.parent / "logs"
        logs_dir.mkdir(parents=True, exist_ok=True)
    warn_path = logs_dir / "state-warnings.jsonl"
    warn_path.parent.mkdir(parents=True, exist_ok=True)
    with warn_path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(warning, ensure_ascii=False) + "\n")


def _backup_corrupt_save(path: Path, *, reason: str) -> Path:
    # Runtime reads can revisit the same corrupt file.  Preserve the original
    # bytes once and emit one warning for that exact corruption rather than
    # growing unbounded backup/warning noise on every PublicState request.
    source_bytes = path.read_bytes()
    for existing in path.parent.glob(f"{path.name}.corrupt-*"):
        try:
            if existing.read_bytes() == source_bytes:
                return existing
        except OSError:
            continue
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backup_path = path.with_name(f"{path.name}.corrupt-{stamp}")
    try:
        shutil.copy2(path, backup_path)
    except OSError:
        backup_path.write_bytes(source_bytes)
    _emit_corrupt_save_warning(path, backup_path=backup_path, reason=reason)
    return backup_path


def load_state_object(
    path: Path,
    kind: str,
    *,
    expected_identity: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Load an exact-current typed state object without modifying it.

    Missing, malformed, mismatched, or identity-conflicting persisted state is
    one generation-level failure rather than a per-file default.
    """
    path = Path(path)
    if path.is_symlink():
        raise UnsupportedSaveSchema(kind=kind, path=path, reason="unsafe_symlink")
    if not path.exists():
        raise UnsupportedSaveSchema(kind=kind, path=path, reason="missing_file")

    try:
        raw_text = path.read_text(encoding="utf-8")
        payload = json.loads(raw_text)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise UnsupportedSaveSchema(
            kind=kind, path=path, reason="json_decode_error"
        ) from exc

    if not isinstance(payload, dict):
        raise UnsupportedSaveSchema(kind=kind, path=path, reason="non_object_json")

    try:
        current = validate_state_schema(payload, kind)
    except UnsupportedSaveSchema as exc:
        raise UnsupportedSaveSchema(kind=kind, path=path, reason=exc.reason) from exc
    for field, expected in (expected_identity or {}).items():
        if current.get(field) != expected:
            raise UnsupportedSaveSchema(
                kind=kind,
                path=path,
                reason=f"identity_mismatch:{field}",
            )
    return current


def _read_json_object(
    path: Path,
    fallback: dict[str, Any],
) -> dict[str, Any]:
    if not path.exists():
        return fallback
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        _backup_corrupt_save(path, reason="json_decode_error")
        return dict(fallback)
    if not isinstance(payload, dict):
        _backup_corrupt_save(path, reason="non_object_json")
        return dict(fallback)
    return payload


def load_campaign_state(campaign_dir: Path) -> dict[str, Any]:
    """Load exact-current identity-bound ``campaign.json``."""
    campaign_dir = Path(campaign_dir)
    return load_state_object(
        campaign_dir / "campaign.json",
        "campaign",
        expected_identity={"campaign_id": campaign_dir.name},
    )


def load_world_state(campaign_dir: Path) -> dict[str, Any]:
    """Load exact-current identity-bound world state."""
    campaign_dir = Path(campaign_dir)
    return load_state_object(
        campaign_dir / "save" / "world-state.json",
        "world",
        expected_identity={"campaign_id": campaign_dir.name},
    )


def load_pacing_state(campaign_dir: Path) -> dict[str, Any]:
    """Load exact-current identity-bound pacing state."""
    campaign_dir = Path(campaign_dir)
    return load_state_object(
        campaign_dir / "save" / "pacing-state.json",
        "pacing",
        expected_identity={"campaign_id": campaign_dir.name},
    )


def load_investigator_state(campaign_dir: Path, investigator_id: str) -> dict[str, Any]:
    """Load exact-current campaign/investigator-bound state."""
    campaign_dir = Path(campaign_dir)
    return load_state_object(
        campaign_dir / "save" / "investigator-state" / f"{investigator_id}.json",
        "investigator",
        expected_identity={
            "campaign_id": campaign_dir.name,
            "investigator_id": investigator_id,
        },
    )


def validate_campaign_generation(
    campaign_dir: Path,
    *,
    investigator_id: str | None = None,
) -> dict[str, Any]:
    """Read-only preflight for the central campaign generation.

    No file is created, rewritten, backed up, or deleted. A missing member of
    an existing central generation is the same typed failure as an old,
    malformed, forward, or identity-conflicting member.
    """
    campaign_dir = Path(campaign_dir)
    if not campaign_dir.is_dir() or campaign_dir.is_symlink():
        raise UnsupportedSaveSchema(
            kind="campaign", path=campaign_dir, reason="missing_or_unsafe_generation"
        )
    campaign = load_campaign_state(campaign_dir)
    world = load_world_state(campaign_dir)
    pacing = load_pacing_state(campaign_dir)
    inv_dir = campaign_dir / "save" / "investigator-state"
    if not inv_dir.is_dir() or inv_dir.is_symlink():
        raise UnsupportedSaveSchema(
            kind="investigator", path=inv_dir, reason="missing_or_unsafe_store"
        )
    if investigator_id is not None:
        investigator_ids = [investigator_id]
    else:
        investigator_ids = [
            path.stem for path in sorted(inv_dir.glob("*.json")) if path.is_file()
        ]
    investigators = {
        item: load_investigator_state(campaign_dir, item)
        for item in investigator_ids
    }
    return {
        "schema_version": 1,
        "campaign_id": campaign_dir.name,
        "campaign": campaign,
        "world": world,
        "pacing": pacing,
        "investigators": investigators,
    }


def _discard_runtime_sessions_for_campaign(root: Path, campaign_id: str) -> None:
    """Remove current runtime snapshot entries owned by one discarded campaign.

    A malformed/non-current runtime snapshot is itself unusable runtime state;
    at an explicit fresh-start boundary it is deleted instead of partially
    interpreted. Read-only state loading never calls this function.
    """
    snapshot = coc_root(root) / "runtime" / "sessions.json"
    if not snapshot.exists():
        return
    try:
        payload = json.loads(snapshot.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        snapshot.unlink(missing_ok=True)
        return
    if (
        not isinstance(payload, dict)
        or set(payload) != {"schema_version", "sessions", "closed_session_ids"}
        or payload.get("schema_version") != 1
        or isinstance(payload.get("schema_version"), bool)
        or not isinstance(payload.get("sessions"), list)
        or not isinstance(payload.get("closed_session_ids"), list)
    ):
        snapshot.unlink(missing_ok=True)
        return
    sessions = payload["sessions"]
    closed = payload["closed_session_ids"]
    if (
        not all(isinstance(value, str) and _SAFE_ID.fullmatch(value) for value in closed)
        or len(set(closed)) != len(closed)
        or not all(
            isinstance(row, dict)
            and set(row) == _RUNTIME_SESSION_KEYS
            and all(
                isinstance(row.get(field), str) and bool(row[field])
                for field in (
                    "session_id",
                    "campaign_id",
                    "investigator_id",
                    "character_relpath",
                    "brain_at_create",
                )
            )
            and isinstance(row.get("resolved_config"), dict)
            and row["resolved_config"].get("schema_version") == 2
            and not isinstance(row["resolved_config"].get("schema_version"), bool)
            for row in sessions
        )
    ):
        snapshot.unlink(missing_ok=True)
        return
    payload["sessions"] = [
        row for row in sessions if row.get("campaign_id") != campaign_id
    ]
    write_json_atomic(snapshot, payload)


def discard_campaign_generation(
    root: Path,
    campaign_id: str,
    *,
    fresh_start: bool = False,
) -> None:
    """Delete one complete owned campaign/runtime generation for fresh start.

    The explicit flag is an authorization boundary, not a convenience default.
    Validation and ordinary reads never discard state.
    """
    if fresh_start is not True:
        raise ValueError("fresh_start operation required")
    if not isinstance(campaign_id, str) or _SAFE_ID.fullmatch(campaign_id) is None:
        raise ValueError("campaign_id must be a stable safe id")
    base = coc_root(root)
    campaigns = base / "campaigns"
    campaign_dir = campaigns / campaign_id
    try:
        campaign_dir.resolve(strict=False).relative_to(campaigns.resolve(strict=False))
    except (OSError, ValueError) as exc:
        raise ValueError("campaign path is unsafe") from exc
    if campaign_dir.is_symlink():
        raise ValueError("campaign path is unsafe")
    if campaign_dir.exists():
        if not campaign_dir.is_dir():
            raise ValueError("campaign path is unsafe")
        shutil.rmtree(campaign_dir)
    _discard_runtime_sessions_for_campaign(root, campaign_id)


def _merge_current_luck(campaign_dir: Path, investigator_id: str, current_luck: int) -> Path:
    inv_path = campaign_dir / "save" / "investigator-state" / f"{investigator_id}.json"
    data = load_investigator_state(campaign_dir, investigator_id)
    data["current_luck"] = int(current_luck)
    write_json_atomic(inv_path, data)
    return inv_path


def _set_luck_spent_last(campaign_dir: Path, points: int) -> None:
    pacing_path = campaign_dir / "save" / "pacing-state.json"
    pacing = load_pacing_state(campaign_dir)
    pacing["luck_spent_last"] = int(points)
    write_json_atomic(pacing_path, pacing)


def apply_luck_spend(campaign_dir: Path, investigator_id: str, *,
                     points: int, luck_remaining: int) -> Path:
    """Persist a ``coc_roll.spend_luck`` outcome (Keeper Rulebook p.99).

    Merges ``current_luck`` into ``save/investigator-state/<id>.json`` and
    sets ``pacing-state.luck_spent_last`` so the Story Director's luck signal
    sees the spend on the next turn.
    """
    inv_path = _merge_current_luck(campaign_dir, investigator_id, luck_remaining)
    _set_luck_spent_last(campaign_dir, points)
    return inv_path


def apply_luck_recovery(campaign_dir: Path, investigator_id: str, *,
                        luck_after: int) -> Path:
    """Persist a session-end ``coc_roll.recover_luck`` outcome and clear
    ``luck_spent_last``."""
    inv_path = _merge_current_luck(campaign_dir, investigator_id, luck_after)
    _set_luck_spent_last(campaign_dir, 0)
    return inv_path


# The nine backstory categories (Keeper Rulebook p.157); mirrors
# coc_sanity.BACKSTORY_FIELDS. Hooks/corruptions must reference one of these
# structured field names so downstream consumers never scan backstory prose.
BACKSTORY_FIELDS = (
    "personal_description",
    "ideology_beliefs",
    "significant_people",
    "meaningful_locations",
    "treasured_possessions",
    "traits",
    "injuries_scars",
    "phobias_manias",
    "encounters",
)


def _investigator_state_path(campaign_dir: Path, investigator_id: str) -> Path:
    return campaign_dir / "save" / "investigator-state" / f"{investigator_id}.json"


def add_personal_horror_hook(campaign_dir: Path, investigator_id: str, *,
                             hook_id: str, backstory_field: str,
                             summary: str) -> Path:
    """Record a structured personal-horror hook on investigator-state (W1-2).

    Hooks tie scenario horror to the investigator's own backstory (p.193-194).
    The Story Director weaves unwoven hooks on CHARACTER beats and echoes
    woven ones on PAYOFF.
    """
    if backstory_field not in BACKSTORY_FIELDS:
        raise ValueError(
            f"backstory_field must be one of {BACKSTORY_FIELDS}, got {backstory_field!r}")
    inv_path = _investigator_state_path(campaign_dir, investigator_id)
    data = load_investigator_state(campaign_dir, investigator_id)
    hooks = list(data.get("personal_horror_hooks") or [])
    hooks.append({
        "hook_id": str(hook_id),
        "backstory_field": backstory_field,
        "summary": str(summary),
        "woven": False,
    })
    data["personal_horror_hooks"] = hooks
    write_json_atomic(inv_path, data)
    return inv_path


def mark_hook_woven(campaign_dir: Path, investigator_id: str, hook_id: str) -> Path:
    """Flag a personal-horror hook as woven into play."""
    inv_path = _investigator_state_path(campaign_dir, investigator_id)
    data = load_investigator_state(campaign_dir, investigator_id)
    for hook in data.get("personal_horror_hooks") or []:
        if hook.get("hook_id") == hook_id:
            hook["woven"] = True
    write_json_atomic(inv_path, data)
    return inv_path


def add_backstory_corruption(campaign_dir: Path, investigator_id: str, *,
                             mode: str, backstory_field: str,
                             keeper_note: str) -> Path:
    """Record an accepted bout backstory amendment (p.157).

    ``mode`` is ``corrupt_existing`` or ``add_irrational``, matching the
    ``backstory_amend_suggestion`` emitted by ``coc_sanity`` at bout end.
    """
    if backstory_field not in BACKSTORY_FIELDS:
        raise ValueError(
            f"backstory_field must be one of {BACKSTORY_FIELDS}, got {backstory_field!r}")
    if mode not in ("corrupt_existing", "add_irrational"):
        raise ValueError(f"mode must be corrupt_existing or add_irrational, got {mode!r}")
    inv_path = _investigator_state_path(campaign_dir, investigator_id)
    data = load_investigator_state(campaign_dir, investigator_id)
    corruptions = list(data.get("backstory_corruptions") or [])
    corruptions.append({
        "mode": mode,
        "backstory_field": backstory_field,
        "keeper_note": str(keeper_note),
    })
    data["backstory_corruptions"] = corruptions
    write_json_atomic(inv_path, data)
    return inv_path


def _safe_file_stem(value: str) -> str:
    stem = re.sub(r"[^A-Za-z0-9_.-]+", "-", value).strip("-")
    return stem or "draft"


def _archive_existing_character_creation_draft(active_path: Path, investigator_id: str) -> Path | None:
    if not active_path.exists():
        return None
    existing = _read_json_object(active_path, {})
    existing_id = str(existing.get("investigator_id") or "")
    if existing_id in ("", investigator_id):
        return None
    archive_dir = active_path.parent / "character-creation-drafts"
    archive_dir.mkdir(parents=True, exist_ok=True)
    archive_path = archive_dir / f"{_safe_file_stem(existing_id)}.json"
    counter = 2
    while archive_path.exists():
        archive_path = archive_dir / f"{_safe_file_stem(existing_id)}-{counter}.json"
        counter += 1
    shutil.move(str(active_path), str(archive_path))
    return archive_path


def _upsert_index_entry(
    root: Path,
    filename: str,
    collection_key: str,
    item_key: str,
    entry: dict[str, Any],
) -> None:
    index_path = coc_root(root) / "indexes" / filename
    index = _read_json_object(index_path, {"schema_version": 1, collection_key: {}})
    index["schema_version"] = 1
    collection = index.setdefault(collection_key, {})
    if not isinstance(collection, dict):
        collection = {}
        index[collection_key] = collection
    collection[item_key] = entry
    write_json_atomic(index_path, index)


def _campaign_index_entry(root: Path, campaign_id: str, campaign: dict[str, Any]) -> dict[str, Any]:
    campaign_dir = coc_root(root) / "campaigns" / campaign_id
    entry = {
        "campaign_id": campaign_id,
        "title": campaign.get("title", campaign_id),
        "status": campaign.get("status", "setup"),
        "play_language": campaign.get("play_language", DEFAULT_PLAY_LANGUAGE),
        "path": _relative_to_root(root, campaign_dir / "campaign.json"),
        "party_path": _relative_to_root(root, campaign_dir / "party.json"),
        "save_path": _relative_to_root(root, campaign_dir / "save"),
        "memory_path": _relative_to_root(root, campaign_dir / "memory"),
        "logs_path": _relative_to_root(root, campaign_dir / "logs"),
    }
    party_path = campaign_dir / "party.json"
    if party_path.exists():
        party = _read_json_object(party_path, {})
        investigator_ids = party.get("investigator_ids")
        if isinstance(investigator_ids, list):
            entry["investigator_ids"] = investigator_ids
    return entry


def _upsert_campaign_index(root: Path, campaign_id: str) -> None:
    campaign_dir = coc_root(root) / "campaigns" / campaign_id
    campaign = load_campaign_state(campaign_dir)
    _upsert_index_entry(
        root,
        "campaigns.json",
        "campaigns",
        campaign_id,
        _campaign_index_entry(root, campaign_id, campaign),
    )


def _creation_record(
    investigator_id: str,
    sheet: dict[str, Any],
    creation: dict[str, Any] | None,
) -> dict[str, Any]:
    if creation is None and isinstance(sheet.get("creation"), dict):
        payload = dict(sheet["creation"])
    elif creation is not None:
        payload = dict(creation)
    else:
        payload = {
            "schema_version": 1,
            "investigator_id": investigator_id,
            "name": sheet.get("name", investigator_id),
            "method": "imported_character_sheet",
            "status": "creation_record_pending",
            "notes": "No full rulebook creation workflow was supplied when this reusable investigator was created.",
        }
    payload.setdefault("schema_version", 1)
    payload.setdefault("investigator_id", investigator_id)
    payload.setdefault("name", sheet.get("name", investigator_id))
    return payload


def ensure_workspace(root: Path) -> dict[str, str]:
    base = coc_root(root)
    for directory in TOP_LEVEL_DIRS:
        (base / directory).mkdir(parents=True, exist_ok=True)
    return {"coc_root": str(base)}


def _create_investigator_unlocked(
    root: Path,
    investigator_id: str,
    sheet: dict[str, Any],
    *,
    creation: dict[str, Any] | None = None,
) -> Path:
    ensure_workspace(root)
    investigator_dir = coc_root(root) / "investigators" / investigator_id
    character_path = _create_investigator_at(
        investigator_dir,
        investigator_id,
        sheet,
        creation=creation,
    )
    _upsert_investigator_index(root, investigator_id, sheet)
    return character_path


def _create_investigator_at(
    investigator_dir: Path,
    investigator_id: str,
    sheet: dict[str, Any],
    *,
    creation: dict[str, Any] | None = None,
) -> Path:
    """Build one complete investigator generation without publishing an index."""
    investigator_dir = Path(investigator_dir)
    investigator_dir.mkdir(parents=True, exist_ok=True)
    creation_path = investigator_dir / "creation.json"
    character_path = investigator_dir / "character.json"
    write_json_atomic(creation_path, _creation_record(investigator_id, sheet, creation))
    write_json_atomic(character_path, sheet)
    for log_name in ("history.jsonl", "development.jsonl", "inventory-history.jsonl"):
        (investigator_dir / log_name).touch(exist_ok=True)
    return character_path


def _upsert_investigator_index(
    root: Path, investigator_id: str, sheet: dict[str, Any]
) -> None:
    investigator_dir = coc_root(root) / "investigators" / investigator_id
    creation_path = investigator_dir / "creation.json"
    character_path = investigator_dir / "character.json"
    _upsert_index_entry(
        root,
        "investigators.json",
        "investigators",
        investigator_id,
        {
            "id": investigator_id,
            "name": sheet.get("name", investigator_id),
            "creation_path": _relative_to_root(root, creation_path),
            "path": _relative_to_root(root, character_path),
            "history_path": _relative_to_root(root, investigator_dir / "history.jsonl"),
            "development_path": _relative_to_root(root, investigator_dir / "development.jsonl"),
            "inventory_history_path": _relative_to_root(root, investigator_dir / "inventory-history.jsonl"),
        },
    )


def _safe_uncreated_child(base: Path, target: Path) -> bool:
    """Validate containment and existing parent kinds without creating paths."""
    base = Path(base)
    target = Path(target)
    try:
        relative = target.relative_to(base)
        target.resolve(strict=False).relative_to(base.resolve(strict=False))
    except (OSError, ValueError):
        return False
    if base.is_symlink() or (base.exists() and not base.is_dir()):
        return False
    current = base
    for part in relative.parts[:-1]:
        current = current / part
        if current.is_symlink() or (current.exists() and not current.is_dir()):
            return False
    return not target.is_symlink() and (not target.exists() or target.is_file())


def create_investigator(
    root: Path,
    investigator_id: str,
    sheet: dict[str, Any],
    *,
    creation: dict[str, Any] | None = None,
    replace: bool = False,
) -> Path:
    """Create a reusable investigator under its shared file lock.

    Replacement is deliberately explicit because a reusable sheet may be
    linked to several campaigns.  The existence check and any authorized
    replacement happen under the same marker-aware investigator lock.
    """
    if not isinstance(investigator_id, str) or _SAFE_ID.fullmatch(investigator_id) is None:
        raise ValueError("investigator_id must be a stable safe id")
    base = coc_root(root)
    lock_path = (
        base
        / "locks"
        / "investigators"
        / investigator_id
        / ".investigator.lock"
    )
    investigator_dir = base / "investigators" / investigator_id
    # This preflight deliberately runs before advisory_file_lock or
    # ensure_workspace: an invalid/traversing identity must leave no inode or
    # directory behind anywhere in the workspace.
    if not _safe_uncreated_child(base, lock_path) or not _safe_uncreated_child(
        base, investigator_dir / "character.json"
    ):
        raise ValueError("investigator path is unsafe")
    # Setup paths do not acquire a campaign lock, and never acquire one after
    # this block.  In-session writers use campaign -> investigator.
    with _advisory_file_lock(lock_path, wait_seconds=5.0):
        coc_investigator_guard.assert_reusable_investigator_idle(
            base, investigator_id
        )
        character_path = investigator_dir / "character.json"
        if character_path.exists() and not replace:
            raise FileExistsError(
                f"investigator already exists: {investigator_id}"
            )
        return _create_investigator_unlocked(
            root,
            investigator_id,
            sheet,
            creation=creation,
        )


def list_investigators(root: Path) -> list[dict[str, Any]]:
    """Enumerate existing reusable investigators.

    Scans ``coc_root(root)/investigators/*/character.json`` and returns one
    summary dict per investigator, sorted by ``investigator_id``. Directories
    without a ``character.json`` (or with a malformed one) are skipped so the
    registry degrades gracefully instead of crashing. Missing fields default to
    ``None``.

    The on-disk ``character.json`` is the authoritative source; the
    ``investigators.json`` index is not consulted here because it can drift out
    of sync with the filesystem.
    """
    investigators_dir = coc_root(root) / "investigators"
    if not investigators_dir.is_dir():
        return []
    candidates = [
        candidate
        for candidate in sorted(investigators_dir.iterdir(), key=lambda p: p.name)
        if candidate.is_dir() and _SAFE_ID.fullmatch(candidate.name)
    ]
    entries: list[dict[str, Any]] = []
    with coc_investigator_guard.guard_reusable_investigators(
        coc_root(root), [candidate.name for candidate in candidates]
    ):
        for candidate in candidates:
            character_path = candidate / "character.json"
            if not character_path.exists():
                continue
            try:
                sheet = json.loads(character_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if not isinstance(sheet, dict):
                continue
            investigator_id = str(
                sheet.get("investigator_id") or sheet.get("id") or candidate.name
            )
            entries.append(
                {
                    "investigator_id": investigator_id,
                    "name": sheet.get("name"),
                    "occupation": sheet.get("occupation"),
                    "era": sheet.get("era"),
                    "path": _relative_to_root(root, character_path),
                }
            )
    return entries


def _create_campaign_at(
    root: Path,
    campaign_dir: Path,
    campaign_id: str,
    title: str,
    era: str = "1920s",
    play_language: str = DEFAULT_PLAY_LANGUAGE,
    start_clock: dict[str, Any] | None = None,
    *,
    update_index: bool = False,
) -> Path:
    """Build a complete campaign generation at an explicit directory."""
    campaign_dir = Path(campaign_dir)
    era_key = normalize_era(era)
    for directory in CAMPAIGN_DIRS:
        (campaign_dir / directory).mkdir(parents=True, exist_ok=True)
    created_at = now_iso()
    campaign = {
        "schema_version": 1,
        "campaign_id": campaign_id,
        "title": title,
        "mode": "keeper",
        "status": "setup",
        "era": era_key,
        "active_scenario_id": None,
        "active_scene_id": None,
        "dice_mode": "codex",
        "spoiler_policy": "warn_before_reveal",
        "play_language": play_language,
        "language_profile": language_profile(play_language),
        "localized_terms": {play_language: {}},
        "active_subsystem": "setup",
        "created_at": created_at,
        "updated_at": created_at,
    }
    campaign_path = campaign_dir / "campaign.json"
    write_json_atomic(campaign_path, campaign)
    _initialize_campaign_runtime_files(
        campaign_dir, campaign_id, era=era_key, start_clock=start_clock
    )
    if update_index:
        _upsert_campaign_index(root, campaign_id)
    return campaign_path


def create_campaign(
    root: Path,
    campaign_id: str,
    title: str,
    era: str = "1920s",
    play_language: str = DEFAULT_PLAY_LANGUAGE,
    start_clock: dict[str, Any] | None = None,
    *,
    fresh_start: bool = False,
) -> Path:
    ensure_workspace(root)
    campaign_dir = coc_root(root) / "campaigns" / campaign_id
    if campaign_dir.exists() or fresh_start:
        if fresh_start:
            discard_campaign_generation(root, campaign_id, fresh_start=True)
        else:
            raise FileExistsError(f"campaign already exists: {campaign_id}")
    return _create_campaign_at(
        root,
        campaign_dir,
        campaign_id,
        title,
        era=normalize_era(era),
        play_language=play_language,
        start_clock=start_clock,
        update_index=True,
    )


def prepare_character_creation_draft(
    root: Path,
    campaign_id: str,
    investigator_id: str,
    *,
    generation_method: str | None = None,
) -> Path:
    """Create a fresh active creation draft, archiving stale drafts first."""
    campaign_dir = coc_root(root) / "campaigns" / campaign_id
    if not campaign_dir.is_dir():
        raise FileNotFoundError(f"unknown campaign: {campaign_id}")
    active_path = campaign_dir / "save" / "character-creation-draft.json"
    archived = _archive_existing_character_creation_draft(active_path, investigator_id)
    created_at = now_iso()
    payload: dict[str, Any] = {
        "schema_version": 1,
        "campaign_id": campaign_id,
        "investigator_id": investigator_id,
        "status": "drafting",
        "generation_method": generation_method,
        "created_at": created_at,
        "updated_at": created_at,
    }
    if archived is not None:
        payload["archived_previous_draft_path"] = _relative_to_root(root, archived)
    write_json_atomic(active_path, payload)

    campaign_path = campaign_dir / "campaign.json"
    campaign = load_campaign_state(campaign_dir)
    campaign["character_creation"] = {
        **(campaign.get("character_creation") if isinstance(campaign.get("character_creation"), dict) else {}),
        "active_draft_path": _relative_to_root(root, active_path),
        "active_investigator_id": investigator_id,
        "generation_method": generation_method,
    }
    campaign["updated_at"] = created_at
    write_json_atomic(campaign_path, campaign)
    _upsert_campaign_index(root, campaign_id)
    return active_path


def _initialize_campaign_runtime_files(
    campaign_dir: Path,
    campaign_id: str,
    *,
    era: str = "1920s",
    start_clock: dict[str, Any] | None = None,
) -> None:
    _write_json_if_missing(
        campaign_dir / "save" / "world-state.json",
        {
            "schema_version": 2,
            "campaign_id": campaign_id,
            "scenario_id": None,
            "status": "setup",
            "active_scene_id": None,
            "active_subsystem": "setup",
            "current_phase": None,
            "discovered_clue_ids": [],
            "unlocked_scene_ids": [],
            "visited_scene_ids": [],
            "exhausted_scene_ids": [],
            "scene_history": [],
            "major_decisions": [],
            "current_status": None,
            "san_triggers_fired": [],
            "memory_refs": ["memory/session-summaries.jsonl"],
            "log_refs": ["logs/events.jsonl", "logs/rolls.jsonl"],
            "investigator_state_refs": [],
            "updated_from_logs": {
                "events": 0,
                "rolls": 0,
                "memory": 0,
            },
            "terminal_state": None,
            "pending_subsystem_choice": None,
        },
    )
    _write_json_if_missing(
        campaign_dir / "save" / "threat-state.json",
        {"schema_version": 1, "clocks": {}},
    )
    _write_json_if_missing(
        campaign_dir / "save" / "active-scene.json",
        {
            "schema_version": 1,
            "campaign_id": campaign_id,
            "scenario_id": None,
            "scene_id": None,
            "source_event_type": None,
            "summary": "",
            "pending_choices": None,
        },
    )
    _write_json_if_missing(
        campaign_dir / "save" / "flags.json",
        coc_flag_state.new_flag_document(campaign_id=campaign_id),
    )
    _write_json_if_missing(
        campaign_dir / "save" / "pacing-state.json",
        {
            "schema_version": 1,
            "campaign_id": campaign_id,
            "tension_level": "low",
            "lethal_chances_used": 0,
            "recent_intent_classes": [],
            "turn_number": 0,
            "luck_spent_last": 0,
        },
    )
    _write_json_if_missing(
        campaign_dir / "save" / "time-state.json",
        {
            "schema_version": 1,
            "campaign_id": campaign_id,
            "timeline_id": "tl-main",
            "branch_id": "main",
            "forked_from": None,
            "sequence": 0,
            "clock": initial_clock_for_era(era, start_clock),
            "anchors": {
                "campaign_start_elapsed": 0,
                "last_rest_elapsed": 0,
                "last_safe_place_elapsed": 0,
                "last_scene_change_elapsed": 0,
            },
            "sanity_periods": {},
            "safe_place": False,
        },
    )
    _write_json_if_missing(
        campaign_dir / "save" / "time-triggers.json",
        {"schema_version": 1, "triggers": []},
    )
    for relative_path in (
        "logs/events.jsonl",
        "logs/rolls.jsonl",
        "logs/audit.jsonl",
        "logs/time.jsonl",
        "memory/session-summaries.jsonl",
    ):
        _touch_if_missing(campaign_dir / relative_path)


def seed_investigator_state_if_missing(
    root: Path,
    campaign_id: str,
    investigator_id: str,
    *,
    sheet: dict[str, Any] | None = None,
) -> Path:
    """Ensure ``save/investigator-state/<id>.json`` exists for a party member.

    Missing campaign state is seeded from the reusable character sheet. An
    existing file is left untouched so HP/SAN/conditions survive re-links.
    """
    campaign_dir = coc_root(root) / "campaigns" / campaign_id
    if not campaign_dir.is_dir():
        raise FileNotFoundError(f"unknown campaign: {campaign_id}")
    inv_path = _investigator_state_path(campaign_dir, investigator_id)
    if inv_path.is_file():
        return inv_path

    if sheet is None:
        character_path = coc_root(root) / "investigators" / investigator_id / "character.json"
        if not character_path.is_file():
            raise FileNotFoundError(
                f"missing character sheet for investigator: {investigator_id}"
            )
        sheet = coc_investigator_guard.read_reusable_character(
            coc_root(root), investigator_id, character_path
        )

    return _seed_investigator_state_at(
        campaign_dir,
        campaign_id,
        investigator_id,
        sheet,
    )


def _seed_investigator_state_at(
    campaign_dir: Path,
    campaign_id: str,
    investigator_id: str,
    sheet: dict[str, Any],
) -> Path:
    """Seed an investigator state inside an explicit campaign generation."""
    campaign_dir = Path(campaign_dir)
    inv_path = _investigator_state_path(campaign_dir, investigator_id)
    if inv_path.is_file():
        return inv_path
    derived = sheet.get("derived") if isinstance(sheet.get("derived"), dict) else {}
    characteristics = (
        sheet.get("characteristics")
        if isinstance(sheet.get("characteristics"), dict)
        else {}
    )
    state = {
        "schema_version": 1,
        "campaign_id": campaign_id,
        "investigator_id": investigator_id,
        "current_hp": int(derived.get("HP") or 10),
        "current_san": int(
            derived.get("SAN") or characteristics.get("POW") or 50
        ),
        "current_mp": int(
            derived.get("MP")
            or max(1, int(characteristics.get("POW") or 50) // 5)
        ),
        "current_luck": int(characteristics.get("LUCK") or 50),
        "conditions": [],
        "skill_checks_earned": [],
    }
    inv_path.parent.mkdir(parents=True, exist_ok=True)
    write_json_atomic(inv_path, state)
    return inv_path


def _link_party_at(
    campaign_dir: Path,
    campaign_id: str,
    investigator_ids: list[str],
    *,
    sheets: dict[str, dict[str, Any]],
) -> Path:
    """Build party and member state inside an explicit campaign generation."""
    campaign_dir = Path(campaign_dir)
    for investigator_id in investigator_ids:
        sheet = sheets.get(investigator_id)
        if not isinstance(sheet, dict):
            raise ValueError(
                f"guarded character snapshot is missing: {investigator_id}"
            )
        _seed_investigator_state_at(
            campaign_dir,
            campaign_id,
            investigator_id,
            sheet,
        )
    party_path = campaign_dir / "party.json"
    write_json_atomic(
        party_path,
        {
            "schema_version": 1,
            "campaign_id": campaign_id,
            "investigator_ids": investigator_ids,
            "active_investigator_ids": investigator_ids,
        },
    )
    return party_path


def _link_party_unlocked(
    root: Path,
    campaign_id: str,
    investigator_ids: list[str],
    *,
    sheets: dict[str, dict[str, Any]],
) -> Path:
    """Publish a party from caller-owned guarded character snapshots."""
    campaign_dir = coc_root(root) / "campaigns" / campaign_id
    party_path = _link_party_at(
        campaign_dir,
        campaign_id,
        investigator_ids,
        sheets=sheets,
    )
    _upsert_campaign_index(root, campaign_id)
    return party_path


def link_party(root: Path, campaign_id: str, investigator_ids: list[str]) -> Path:
    with coc_investigator_guard.guard_reusable_investigators(
        coc_root(root), investigator_ids
    ):
        sheets: dict[str, dict[str, Any]] = {}
        for investigator_id in investigator_ids:
            character_path = (
                coc_root(root) / "investigators" / investigator_id / "character.json"
            )
            if not character_path.is_file():
                raise FileNotFoundError(
                    f"missing character sheet for investigator: {investigator_id}"
                )
            loaded = json.loads(character_path.read_text(encoding="utf-8"))
            if not isinstance(loaded, dict):
                raise ValueError(
                    f"character sheet must be an object: {character_path}"
                )
            sheets[investigator_id] = loaded
        return _link_party_unlocked(
            root,
            campaign_id,
            investigator_ids,
            sheets=sheets,
        )


def append_jsonl(path: Path, event: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(event))
        handle.write("\n")


def create_snapshot(root: Path, campaign_id: str, label: str) -> Path:
    campaign_dir = coc_root(root) / "campaigns" / campaign_id
    snapshot_dir = campaign_dir / "snapshots" / label
    if snapshot_dir.exists():
        shutil.rmtree(snapshot_dir)
    snapshot_dir.mkdir(parents=True)
    for name in ("campaign.json", "party.json"):
        source = campaign_dir / name
        if source.exists():
            shutil.copy2(source, snapshot_dir / name)
    for directory in SNAPSHOT_DIRS:
        source_dir = campaign_dir / directory
        if source_dir.exists():
            shutil.copytree(source_dir, snapshot_dir / directory)
    return snapshot_dir


def restore_snapshot(root: Path, campaign_id: str, label: str) -> Path:
    campaign_dir = coc_root(root) / "campaigns" / campaign_id
    snapshot_dir = campaign_dir / "snapshots" / label
    if not snapshot_dir.exists():
        raise FileNotFoundError(f"snapshot not found: {snapshot_dir}")
    for name in ("campaign.json", "party.json"):
        source = snapshot_dir / name
        if source.exists():
            shutil.copy2(source, campaign_dir / name)
    for directory in SNAPSHOT_DIRS:
        source_dir = snapshot_dir / directory
        target_dir = campaign_dir / directory
        if target_dir.exists():
            shutil.rmtree(target_dir)
        if source_dir.exists():
            shutil.copytree(source_dir, target_dir)
    _upsert_campaign_index(root, campaign_id)
    return campaign_dir
