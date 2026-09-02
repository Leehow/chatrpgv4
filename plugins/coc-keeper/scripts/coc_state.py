#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import shutil
import stat
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
import coc_rulesets


# Per-kind current schema versions. Persisted state is accepted only when it
# matches these versions exactly. This project intentionally has no migration
# registry or legacy reader.
SESSION_ROLE_SETUP = "setup"
SESSION_ROLE_PLAY = "play"
# campaign.json status → pi-coc session role after chargen completion.
# Incomplete chargen stays setup even when status was written active.
CAMPAIGN_STATUS_TO_SESSION_ROLE: dict[str, str] = {
    "setup": SESSION_ROLE_SETUP,
    "ready_for_table": SESSION_ROLE_PLAY,
    "active": SESSION_ROLE_PLAY,
}
PLACEHOLDER_CREATION_METHODS = frozenset({"complete_sheet_placeholder"})

CURRENT_SCHEMA_VERSIONS: dict[str, int] = {
    # campaign 3: campaigns persist era provenance (``era_source``) so a raw-PDF
    # campaign cannot present a placeholder era as source-established fact.
    "campaign": 3,
    "world": 2,
    "pacing": 1,
    "investigator": 1,
}

_SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")


def _is_exact_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)
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

# The kernel owns only these generic directories. Package-owned campaign dirs
# are resolved from the selected manifest at campaign creation time; keeping
# them out of this import-time constant prevents the default package from
# freezing every later campaign's layout.
KERNEL_CAMPAIGN_DIRS = (
    "save/continuation/checkpoints",
    "scenario",
    "index",
    "memory",
    "logs",
    "snapshots",
)

# Historical public name retained for generic kernel directories only.
# Package additions are intentionally absent and resolved by
# ``_campaign_dirs_for`` at the actual creation boundary.
CAMPAIGN_DIRS = KERNEL_CAMPAIGN_DIRS


def _campaign_dirs_for(ruleset_id: str) -> tuple[str, ...]:
    return (
        *coc_rulesets.ruleset_campaign_init_dirs(ruleset_id),
        *KERNEL_CAMPAIGN_DIRS,
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


ERA_SOURCE_UNESTABLISHED = "unestablished"
ERA_SOURCE_DECLARED = "declared"
ERA_SOURCE_AUTHORED = "authored"
ESTABLISHED_ERA_SOURCES = frozenset({ERA_SOURCE_DECLARED, ERA_SOURCE_AUTHORED})


def campaign_era_source(campaign: dict[str, Any]) -> str:
    """Return how this campaign's ``era`` was obtained.

    ``declared`` is an explicit caller/starter value, ``authored`` comes from
    projected module source, and ``unestablished`` means ``era`` is only the
    placeholder ``create_campaign`` needs to seed a clock. The placeholder is
    never evidence about the module's period.
    """
    if not isinstance(campaign, dict):
        return ERA_SOURCE_UNESTABLISHED
    value = str(campaign.get("era_source") or "").strip()
    return value if value in ESTABLISHED_ERA_SOURCES else ERA_SOURCE_UNESTABLISHED


def campaign_era_is_established(campaign: dict[str, Any]) -> bool:
    """True when ``era`` is source-established rather than a seeding placeholder."""
    return campaign_era_source(campaign) in ESTABLISHED_ERA_SOURCES


def campaign_place_is_established(campaign: dict[str, Any]) -> bool:
    """True when the source parse answered where this module is set.

    Only source-bound (``authored`` era) campaigns are held to this: a starter
    or an explicitly declared campaign never had a source parse to ask.
    """
    if not isinstance(campaign, dict):
        return False
    if campaign_era_source(campaign) != ERA_SOURCE_AUTHORED:
        return True
    facts = campaign.get("source_fast_facts")
    place = facts.get("place") if isinstance(facts, dict) else None
    return (
        isinstance(place, dict)
        and place.get("status") == "source"
        and bool(str(place.get("value") or "").strip())
    )


def stamp_authored_campaign_era(
    campaign: dict[str, Any], authored_era: Any
) -> bool:
    """Mark ``era`` as module-authored when scenario source supplies one.

    The caller keeps owning the ``era`` value itself; this only records that the
    value stopped being a creation-time placeholder.
    """
    raw = str(authored_era or "").strip()
    if not raw or raw.lower() in {"unknown", "none", "null"}:
        return False
    campaign["era_source"] = ERA_SOURCE_AUTHORED
    return True


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
            "local_date": start_clock.get("local_date"),
            "timezone": start_clock.get("timezone", era_clock["timezone"]),
            "location_id": start_clock.get("location_id"),
            "display": start_clock.get("display", era_clock["display"]),
            "day_phase_boundaries": start_clock.get("day_phase_boundaries"),
            "time_precision": start_clock.get("time_precision"),
            "day_phase_hint": start_clock.get("day_phase_hint"),
            "civil_anchor_elapsed": 0,
            "civil_segment_id": start_clock.get("civil_segment_id", "civil-start"),
            "discontinuity_sequence": 0,
            "appearance_mode": start_clock.get("appearance_mode", "normal"),
            "appearance_display_label": start_clock.get("appearance_display_label"),
            "appearance_source_ref": start_clock.get("appearance_source_ref"),
        }
    return {
        "elapsed_minutes": 0,
        "scale": "scene",
        "calendar_mode": era_clock["calendar_mode"],
        "local_datetime": era_clock["local_datetime"],
        "local_date": (
            str(era_clock["local_datetime"]).split("T", 1)[0]
            if era_clock["local_datetime"] else None
        ),
        "timezone": era_clock["timezone"],
        "location_id": None,
        "display": era_clock["display"],
        "time_precision": "minute" if era_clock["local_datetime"] else "unknown",
        "day_phase_hint": None,
        "civil_anchor_elapsed": 0,
        "civil_segment_id": "civil-start",
        "discontinuity_sequence": 0,
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
    if kind == "campaign":
        try:
            ruleset_id = coc_rulesets.get_campaign_ruleset_id(data)
            coc_rulesets.require_registered_ruleset(
                ruleset_id,
                campaign_schema_version=current,
            )
        except ValueError as exc:
            raise UnsupportedSaveSchema(
                kind=kind,
                reason="invalid_ruleset_binding",
            ) from exc
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


RUN_IDENTITY_SCHEMA_VERSION = 1
RUN_IDENTITY_RELATIVE = Path("save") / "run-identity.json"
RUN_IDENTITY_FIELDS = (
    "schema_version",
    "campaign_id",
    "run_segment_id",
    "session_id",
    "plugin_version",
    "ruleset_id",
    "ruleset_version",
)
_RUN_IDENTITY_SENTINELS = frozenset({
    "missing", "unknown", "unset", "placeholder", "none", "null", "n/a", "na",
})
_PLUGIN_PACKAGE_JSON = Path(__file__).resolve().parents[3] / "package.json"


class RunIdentityConflict(ValueError):
    """Caller identity disagrees with the frozen campaign run identity."""

    code = "run_identity_conflict"

    def __init__(self, message: str) -> None:
        super().__init__(message)


def run_identity_path(campaign_dir: Path) -> Path:
    """Campaign-owned path for the frozen table-run identity record."""
    return Path(campaign_dir) / RUN_IDENTITY_RELATIVE


def plugin_package_version() -> str:
    """Declared version of the loaded plugin package (``package.json``)."""
    path = _PLUGIN_PACKAGE_JSON
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise UnsupportedSaveSchema(
            kind="run_identity", path=path, reason="plugin_version_unreadable"
        ) from exc
    version = payload.get("version") if isinstance(payload, dict) else None
    if not isinstance(version, str) or not version.strip():
        raise UnsupportedSaveSchema(
            kind="run_identity", path=path, reason="plugin_version_missing"
        )
    return version.strip()


def _run_identity_string(value: Any, field: str) -> str | None:
    if not isinstance(value, str) or not value.strip() or value != value.strip():
        return None
    if value.casefold() in _RUN_IDENTITY_SENTINELS:
        return None
    return value


def _validated_run_identity(
    payload: dict[str, Any], *, path: Path
) -> dict[str, Any]:
    if payload.get("schema_version") != RUN_IDENTITY_SCHEMA_VERSION:
        raise UnsupportedSaveSchema(
            kind="run_identity",
            path=path,
            reason=(
                "schema_version_mismatch:"
                f"{payload.get('schema_version')!r}!={RUN_IDENTITY_SCHEMA_VERSION}"
            ),
        )
    identity: dict[str, Any] = {
        "schema_version": RUN_IDENTITY_SCHEMA_VERSION,
    }
    for field in RUN_IDENTITY_FIELDS:
        if field == "schema_version":
            continue
        value = _run_identity_string(payload.get(field), field)
        if value is None:
            raise UnsupportedSaveSchema(
                kind="run_identity", path=path, reason=f"invalid_{field}"
            )
        identity[field] = value
    return identity


def load_run_identity(campaign_dir: Path) -> dict[str, Any] | None:
    """Typed reader for the frozen table-run identity.

    Missing record returns ``None``. A present but incomplete, sentinel,
    identity-mismatched, or non-current record fails closed.
    Canonical consumer: battle-report exporter (via t3) and toolbox bind.
    """
    campaign_dir = Path(campaign_dir)
    path = run_identity_path(campaign_dir)
    if not path.exists():
        return None
    payload = load_state_object(
        path,
        "run_identity",
        expected_identity={"campaign_id": campaign_dir.name},
    )
    return _validated_run_identity(payload, path=path)


def bind_run_identity(
    campaign_dir: Path,
    *,
    campaign_id: str,
    run_segment_id: str,
    session_id: str,
) -> dict[str, Any]:
    """Create or confirm the campaign's frozen table-run identity.

    First write resolves ``plugin_version`` from the loaded package and
    ``ruleset_id``/``ruleset_version`` from the campaign binding. Later
    calls must repeat the same campaign/run/session or fail closed.
    """
    campaign_dir = Path(campaign_dir)
    campaign_id_value = _run_identity_string(campaign_id, "campaign_id")
    run_segment_value = _run_identity_string(run_segment_id, "run_segment_id")
    session_value = _run_identity_string(session_id, "session_id")
    if campaign_id_value is None:
        raise ValueError("campaign_id must be a non-empty identity string")
    if run_segment_value is None:
        raise ValueError("run_segment_id must be a non-empty identity string")
    if session_value is None:
        raise ValueError("session_id must be a non-empty identity string")
    if campaign_id_value != campaign_dir.name:
        raise RunIdentityConflict(
            "campaign_id does not match the campaign directory"
        )
    path = run_identity_path(campaign_dir)
    lock_path = campaign_dir / "save" / "run-identity.lock"
    path.parent.mkdir(parents=True, exist_ok=True)
    with _advisory_file_lock(lock_path):
        existing = load_run_identity(campaign_dir)
        if existing is not None:
            if (
                existing["campaign_id"] != campaign_id_value
                or existing["run_segment_id"] != run_segment_value
                or existing["session_id"] != session_value
            ):
                raise RunIdentityConflict(
                    "caller identity does not match the frozen run identity"
                )
            return existing
        campaign = load_campaign_state(campaign_dir)
        if campaign.get("campaign_id") != campaign_id_value:
            raise RunIdentityConflict(
                "campaign.json campaign_id does not match the caller identity"
            )
        ruleset_id = coc_rulesets.get_campaign_ruleset_id(campaign)
        manifest = coc_rulesets.load_manifest(ruleset_id)
        ruleset_version = manifest.get("version")
        if not isinstance(ruleset_version, str) or not ruleset_version.strip():
            raise UnsupportedSaveSchema(
                kind="run_identity",
                path=path,
                reason="ruleset_version_missing",
            )
        record = {
            "schema_version": RUN_IDENTITY_SCHEMA_VERSION,
            "campaign_id": campaign_id_value,
            "run_segment_id": run_segment_value,
            "session_id": session_value,
            "plugin_version": plugin_package_version(),
            "ruleset_id": ruleset_id,
            "ruleset_version": ruleset_version.strip(),
        }
        write_json_atomic(path, record)
        return record


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


def ruleset_actor_state_path(campaign_dir: Path, actor_id: str) -> Path:
    """Resolve one actor file from the package's semantic manifest role."""
    campaign_dir = Path(campaign_dir)
    if not isinstance(actor_id, str) or _SAFE_ID.fullmatch(actor_id) is None:
        raise ValueError("actor_id must be a stable safe id")
    campaign = load_campaign_state(campaign_dir)
    ruleset_id = coc_rulesets.get_campaign_ruleset_id(campaign)
    state_dir = coc_rulesets.ruleset_actor_state_dir(ruleset_id)
    return campaign_dir / "save" / state_dir / f"{actor_id}.json"


def load_ruleset_actor_state(
    campaign_dir: Path, actor_id: str,
) -> dict[str, Any]:
    """Load exact actor state for the campaign-bound ruleset.

    CoC7 retains its established investigator-state schema. Other packages use
    the small kernel envelope created by :func:`create_ruleset_actor`; package
    sheet content remains opaque while resources and mutation receipts are
    structurally auditable by the kernel.
    """
    campaign_dir = Path(campaign_dir)
    campaign = load_campaign_state(campaign_dir)
    ruleset_id = coc_rulesets.get_campaign_ruleset_id(campaign)
    path = ruleset_actor_state_path(campaign_dir, actor_id)
    if ruleset_id == "coc7":
        return load_investigator_state(campaign_dir, actor_id)
    if path.is_symlink() or not path.is_file():
        raise UnsupportedSaveSchema(
            kind="actor", path=path, reason="missing_or_unsafe_actor_state"
        )
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise UnsupportedSaveSchema(
            kind="actor", path=path, reason="json_decode_error"
        ) from exc
    manifest = coc_rulesets.load_manifest(ruleset_id)
    schema_versions = manifest.get("schema_versions")
    actor_schema = (
        schema_versions.get("actor") if isinstance(schema_versions, dict) else None
    )
    required = {
        "schema_version", "campaign_id", "actor_id", "ruleset_id",
        "ruleset_version", "sheet", "resources", "decisions",
    }
    valid_resources = isinstance(payload, dict) and isinstance(
        payload.get("resources"), dict
    ) and all(
        isinstance(key, str) and _is_exact_int(value)
        for key, value in payload.get("resources", {}).items()
    )
    if (
        not isinstance(payload, dict)
        or set(payload) != required
        or not _is_exact_int(actor_schema)
        or payload.get("schema_version") != actor_schema
        or payload.get("campaign_id") != campaign_dir.name
        or payload.get("actor_id") != actor_id
        or payload.get("ruleset_id") != ruleset_id
        or payload.get("ruleset_version") != manifest.get("version")
        or not isinstance(payload.get("sheet"), dict)
        or not valid_resources
        or not isinstance(payload.get("decisions"), dict)
    ):
        raise UnsupportedSaveSchema(
            kind="actor", path=path, reason="invalid_ruleset_actor_state"
        )
    declared = {
        str(resource.get("key"))
        for resource in coc_rulesets.ruleset_resources(ruleset_id)
        if isinstance(resource.get("key"), str)
    }
    if set(payload["resources"]) != declared:
        raise UnsupportedSaveSchema(
            kind="actor", path=path, reason="actor_resource_registry_mismatch"
        )
    return payload


def create_ruleset_actor(
    campaign_dir: Path,
    actor_id: str,
    *,
    sheet: dict[str, Any],
    resources: dict[str, Any],
) -> Path:
    """Create a package-neutral actor envelope after resolver validation."""
    campaign_dir = Path(campaign_dir)
    campaign = load_campaign_state(campaign_dir)
    ruleset_id = coc_rulesets.get_campaign_ruleset_id(campaign)
    if ruleset_id == "coc7":
        raise ValueError("coc7 actor creation uses investigator.create")
    path = ruleset_actor_state_path(campaign_dir, actor_id)
    if path.exists() or path.is_symlink():
        raise FileExistsError(f"actor already exists: {actor_id}")
    manifest = coc_rulesets.load_manifest(ruleset_id)
    schema_versions = manifest.get("schema_versions")
    actor_schema = (
        schema_versions.get("actor") if isinstance(schema_versions, dict) else None
    )
    declared = {
        str(resource.get("key"))
        for resource in coc_rulesets.ruleset_resources(ruleset_id)
        if isinstance(resource.get("key"), str)
    }
    if (
        not _is_exact_int(actor_schema)
        or not isinstance(sheet, dict)
        or not isinstance(resources, dict)
        or set(resources) != declared
        or not all(_is_exact_int(value) for value in resources.values())
    ):
        raise ValueError("validated actor resources do not match the manifest registry")
    write_json_atomic(path, {
        "schema_version": actor_schema,
        "campaign_id": campaign_dir.name,
        "actor_id": actor_id,
        "ruleset_id": ruleset_id,
        "ruleset_version": str(manifest.get("version") or ""),
        "sheet": sheet,
        "resources": resources,
        "decisions": {},
    })
    return path


def ruleset_actor_resource_value(
    ruleset_id: str, actor_state: dict[str, Any], resource_key: str,
) -> int:
    """Read a declared integer resource from either supported actor shape."""
    if ruleset_id == "coc7":
        value = actor_state.get(f"current_{resource_key}")
    else:
        resources = actor_state.get("resources")
        value = resources.get(resource_key) if isinstance(resources, dict) else None
    if not _is_exact_int(value):
        raise ValueError(f"actor state has no integer resource {resource_key!r}")
    return value


def write_ruleset_actor_resource_receipt(
    campaign_dir: Path,
    actor_id: str,
    *,
    resource_key: str,
    after: int,
    decision_id: str,
    receipt: dict[str, Any],
) -> Path:
    """Atomically bind a resource value and its exact idempotency receipt."""
    campaign_dir = Path(campaign_dir)
    campaign = load_campaign_state(campaign_dir)
    ruleset_id = coc_rulesets.get_campaign_ruleset_id(campaign)
    state = load_ruleset_actor_state(campaign_dir, actor_id)
    if ruleset_id == "coc7":
        state[f"current_{resource_key}"] = after
        decisions = state.setdefault("ruleset_resource_receipts", {})
    else:
        state["resources"][resource_key] = after
        decisions = state["decisions"]
    if not isinstance(decisions, dict):
        raise ValueError("actor resource receipt index is invalid")
    decisions[decision_id] = receipt
    path = ruleset_actor_state_path(campaign_dir, actor_id)
    write_json_atomic(path, state)
    return path


def validate_campaign_generation(
    campaign_dir: Path,
    *,
    investigator_id: str | None = None,
    actor_id: str | None = None,
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
    ruleset_id = coc_rulesets.get_campaign_ruleset_id(campaign)
    if investigator_id is not None and actor_id is not None:
        raise UnsupportedSaveSchema(
            kind="actor", path=campaign_dir, reason="ambiguous_actor_identity"
        )
    requested_actor = actor_id if actor_id is not None else investigator_id
    actor_dir = (
        campaign_dir
        / "save"
        / coc_rulesets.ruleset_actor_state_dir(ruleset_id)
    )
    if not actor_dir.is_dir() or actor_dir.is_symlink():
        raise UnsupportedSaveSchema(
            kind="actor", path=actor_dir, reason="missing_or_unsafe_store"
        )
    if requested_actor is not None:
        actor_ids = [requested_actor]
    else:
        actor_ids = [
            path.stem for path in sorted(actor_dir.glob("*.json")) if path.is_file()
        ]
    actors = {
        item: load_ruleset_actor_state(campaign_dir, item)
        for item in actor_ids
    }
    if ruleset_id == "coc7":
        investigators = actors
        if not actor_dir.is_dir() or actor_dir.is_symlink():
            raise UnsupportedSaveSchema(
                kind="investigator", path=actor_dir, reason="missing_or_unsafe_store"
            )
    elif investigator_id is not None:
        raise UnsupportedSaveSchema(
            kind="actor",
            path=actor_dir,
            reason="ruleset_has_no_investigator_state_adapter",
        )
    else:
        investigators = {}
    return {
        "schema_version": 1,
        "campaign_id": campaign_dir.name,
        "campaign": campaign,
        "world": world,
        "pacing": pacing,
        "actors": actors,
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
    import coc_git_history

    coc_git_history.remove_repo(root, campaign_id)
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


CHARACTERISTIC_FLOOR = 0
# Derived values that are computed from characteristics. An override on one of
# these must survive the next recomputation, or a house rule would silently
# revert the first time any characteristic moved.
DERIVED_STAT_KEYS = ("HP", "MP", "SAN", "Luck", "DB", "Build", "MOV")


def _effective_derived(sheet: dict[str, Any]) -> dict[str, Any]:
    """Computed derived values with this sheet's overrides applied on top."""
    import coc_character

    derived = dict(sheet.get("derived") or {})
    overrides = dict(sheet.get("stat_overrides") or {})
    computed = coc_character.derive_values(
        dict(sheet.get("characteristics") or {}),
        luck=int(overrides.get("Luck", derived.get("Luck") or 0)),
    )
    for key, value in overrides.items():
        if key in computed:
            computed[key] = value
    return computed


def apply_stat_delta(
    campaign_dir: Path,
    investigator_id: str,
    *,
    stat: str,
    delta: int,
) -> dict[str, Any]:
    """Change any numeric stat on an investigator during play.

    Nothing could change a stat after chargen. `rules.resource_delta` declares
    only the four coc7 pools, and no rule-graph decision touches a
    characteristic, so an authored consequence that costs one -- a spell's POW
    cost, a ghost's drain, the time-loop ageing this module's own reset
    requires -- had no canonical path for anyone, host included. At a live
    table on 2026-09-01 the Keeper recorded a POW drain as HP damage because
    that was the only writer it had.

    Three kinds of stat, because tables run house rules and the answer to
    "which stats exist" is not this function's to decide:

    * A core characteristic (STR..EDU) moves, and everything derived from it is
      recomputed -- HP, MP, SAN, damage bonus, Build and MOV all read from
      characteristics, so writing one without re-deriving would desync the
      sheet silently, which is worse than the missing capability.
    * A derived value (including Luck, which is rolled rather than derived) is
      recorded as an override that survives every later recomputation.
    * Anything else is a house-rule stat: stored, returned, and never allowed
      to feed a derivation it was not part of.

    Current pools are clamped only when a maximum drops below them. A pool
    already under its new maximum is never topped up: losing POW does not heal
    you.
    """
    import coc_character

    key = str(stat).strip()
    if not key:
        raise ValueError("stat must be a non-empty name")
    canonical = key.upper()
    is_characteristic = canonical in coc_character.REQUIRED_CHARACTERISTICS
    if is_characteristic:
        key = canonical
    if not isinstance(delta, int) or isinstance(delta, bool) or delta == 0:
        raise ValueError("delta must be a non-zero integer")

    base = campaign_dir.parents[1]
    character_path = base / "investigators" / investigator_id / "character.json"
    if not character_path.is_file():
        raise FileNotFoundError(
            f"missing character sheet for investigator: {investigator_id}"
        )
    sheet = coc_investigator_guard.read_reusable_character(
        base, investigator_id, character_path
    )
    derived_before = _effective_derived(sheet)
    overrides = dict(sheet.get("stat_overrides") or {})

    if is_characteristic:
        characteristics = dict(sheet.get("characteristics") or {})
        if key not in characteristics:
            raise ValueError(f"character sheet has no {key}")
        before_value = int(characteristics[key])
        after_value = max(CHARACTERISTIC_FLOOR, before_value + int(delta))
        characteristics[key] = after_value
        sheet["characteristics"] = characteristics
        kind = "characteristic"
    else:
        # Match a derived key case-insensitively so "mov" and "MOV" are one
        # stat; a house-rule name keeps whatever case the table wrote it in.
        derived_match = next(
            (row for row in DERIVED_STAT_KEYS if row.lower() == key.lower()), None,
        )
        kind = "derived_override" if derived_match else "house_rule"
        if derived_match:
            key = derived_match
        current = overrides.get(key, derived_before.get(key))
        if current is None:
            current = 0
        if not isinstance(current, int) or isinstance(current, bool):
            raise ValueError(
                f"{key} is {current!r}, which is not a number a delta can move"
            )
        before_value = int(current)
        after_value = before_value + int(delta)
        overrides[key] = after_value
        sheet["stat_overrides"] = overrides

    derived_after = _effective_derived(sheet)
    sheet["derived"] = {
        row: value for row, value in derived_after.items()
    }
    write_json_atomic(character_path, sheet)

    # A dropped maximum must not leave a current pool above it.
    state = load_investigator_state(campaign_dir, investigator_id)
    clamped: dict[str, dict[str, int]] = {}
    for pool, derived_key in (
        ("current_hp", "HP"), ("current_mp", "MP"),
        ("current_san", "SAN"), ("current_luck", "Luck"),
    ):
        ceiling = derived_after.get(derived_key)
        if not isinstance(ceiling, int) or isinstance(ceiling, bool):
            continue
        current_pool = state.get(pool)
        if isinstance(current_pool, int) and current_pool > ceiling:
            clamped[pool] = {"before": current_pool, "after": ceiling}
            state[pool] = ceiling
    if clamped:
        write_json_atomic(_investigator_state_path(campaign_dir, investigator_id), state)

    return {
        "investigator_id": investigator_id,
        "stat": key,
        "stat_kind": kind,
        "delta": int(delta),
        "before": before_value,
        "after": after_value,
        "floored": after_value != before_value + int(delta),
        "derived_before": derived_before,
        "derived_after": derived_after,
        "house_rule_stats": {
            row: value for row, value in overrides.items()
            if row not in DERIVED_STAT_KEYS
        },
        "clamped_pools": clamped,
    }


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


def _with_initial_skills_snapshot(sheet: dict[str, Any]) -> dict[str, Any]:
    """Freeze the creation-time skills map into the sheet as initial_skills_snapshot.

    Settlement mutates ``skills`` in place; the snapshot keeps the creation
    baseline available to reports without consulting the live mutated map.
    """
    if not isinstance(sheet, dict):
        return sheet
    skills = sheet.get("skills")
    if not isinstance(skills, dict):
        return sheet
    out = dict(sheet)
    out["initial_skills_snapshot"] = json.loads(json.dumps(skills))
    return out


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
    sheet = _with_initial_skills_snapshot(sheet)
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
    era: str | None = None,
    play_language: str = DEFAULT_PLAY_LANGUAGE,
    start_clock: dict[str, Any] | None = None,
    *,
    ruleset_id: str = coc_rulesets.DEFAULT_RULESET_ID,
    update_index: bool = False,
) -> Path:
    """Build a complete campaign generation at an explicit directory."""
    campaign_dir = Path(campaign_dir)
    # An omitted era still needs a canonical clock key, but the placeholder is
    # recorded as unestablished so character creation cannot treat it as fact.
    era_declared = bool(str(era or "").strip())
    era_key = normalize_era(era)
    ruleset_id = coc_rulesets.require_registered_ruleset(
        ruleset_id,
        campaign_schema_version=int(CURRENT_SCHEMA_VERSIONS["campaign"]),
    )
    for directory in _campaign_dirs_for(ruleset_id):
        (campaign_dir / directory).mkdir(parents=True, exist_ok=True)
    created_at = now_iso()
    campaign = {
        "schema_version": int(CURRENT_SCHEMA_VERSIONS["campaign"]),
        "campaign_id": campaign_id,
        "ruleset_id": ruleset_id,
        "title": title,
        "mode": "keeper",
        "status": "setup",
        "era": era_key,
        "era_source": (
            ERA_SOURCE_DECLARED if era_declared else ERA_SOURCE_UNESTABLISHED
        ),
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


def complete_setup_handoff(
    campaign_dir: Path,
    *,
    decision_id: str,
    investigator_ids: list[str],
    opening_projection_ref: dict[str, Any] | None,
    lane_interrupted_at_handoff: bool,
) -> dict[str, Any]:
    """Advance ``status`` setup/active → ready_for_table and persist the handoff receipt.

    Canonical caller: setup-session KP after confirmed investigators (and, for
    source-bound campaigns, a terminal Tier-1 opening projection).
    Consumer: server-node/launcher reads this receipt to switch to a play session.
    Idempotent on ``decision_id``; a later distinct decision_id returns the same
    already-written receipt without rewriting it.
    """
    campaign_dir = Path(campaign_dir)
    campaign_path = campaign_dir / "campaign.json"
    lock_path = campaign_dir / "setup-handoff.lock"
    with _advisory_file_lock(lock_path):
        campaign = load_campaign_state(campaign_dir)
        existing = campaign.get("setup_handoff")
        if isinstance(existing, dict) and existing.get("decision_id") == decision_id:
            return existing
        if isinstance(existing, dict) and campaign.get("status") == "ready_for_table":
            return existing
        status = campaign.get("status")
        if status not in {"setup", "ready_for_table", "active"}:
            raise ValueError(
                f"campaign status {status!r} cannot accept setup.complete"
            )
        completed_at = now_iso()
        receipt = {
            "schema_version": 1,
            "decision_id": decision_id,
            "campaign_id": campaign["campaign_id"],
            "investigator_ids": list(investigator_ids),
            "completed_at": completed_at,
            "opening_projection_ref": opening_projection_ref,
            "lane_interrupted_at_handoff": bool(lane_interrupted_at_handoff),
        }
        campaign["status"] = "ready_for_table"
        campaign["updated_at"] = completed_at
        campaign["setup_handoff"] = receipt
        write_json_atomic(campaign_path, campaign)
        return receipt


def campaign_has_confirmed_investigator(
    campaign_dir: Path,
    campaign_id: str,
) -> bool:
    """True when party has a finished investigator, not a setup placeholder.

    Shared chargen-completion predicate for ``setup.complete`` and session
    role. A linked ``complete_sheet_placeholder`` row is not completion.
    """
    party_path = Path(campaign_dir) / "party.json"
    try:
        party_mode = party_path.lstat().st_mode
        if not stat.S_ISREG(party_mode):
            return False
        party = json.loads(party_path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return False
    if (
        not isinstance(party, dict)
        or party.get("schema_version") != 1
        or party.get("campaign_id") != campaign_id
    ):
        return False
    investigator_ids = party.get("investigator_ids")
    active_ids = party.get("active_investigator_ids")
    if not (
        isinstance(investigator_ids, list)
        and investigator_ids
        and all(isinstance(value, str) and value for value in investigator_ids)
        and isinstance(active_ids, list)
        and active_ids
        and all(isinstance(value, str) and value for value in active_ids)
        and set(active_ids).issubset(set(investigator_ids))
    ):
        return False
    investigators_root = Path(campaign_dir).parent.parent / "investigators"
    for investigator_id in investigator_ids:
        if not isinstance(investigator_id, str) or not investigator_id:
            continue
        creation_path = investigators_root / investigator_id / "creation.json"
        try:
            creation = json.loads(creation_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return True
        if not isinstance(creation, dict):
            return True
        method = str(creation.get("method") or "")
        if method not in PLACEHOLDER_CREATION_METHODS:
            return True
    return False


def infer_pi_session_role(root: Path, campaign_id: str) -> str:
    """Return ``setup`` or ``play`` from status plus chargen completion.

    Missing campaign → setup. Workspace that is not a directory is a hard
    error. Incomplete chargen (empty or placeholder party) stays setup even
    when status is ``active``. ``ready_for_table``, or ``active`` with a
    confirmed investigator, is play.
    """
    workspace = Path(root)
    if not workspace.is_dir():
        raise FileNotFoundError(f"workspace is not a directory: {workspace}")
    if not isinstance(campaign_id, str) or _SAFE_ID.fullmatch(campaign_id) is None:
        raise ValueError(f"invalid campaign_id: {campaign_id!r}")
    campaign_dir = coc_root(workspace) / "campaigns" / campaign_id
    campaign_path = campaign_dir / "campaign.json"
    if not campaign_dir.is_dir() or not campaign_path.is_file():
        return SESSION_ROLE_SETUP
    campaign = load_campaign_state(campaign_dir)
    status = campaign.get("status", "setup")
    if not isinstance(status, str) or not status:
        return SESSION_ROLE_SETUP
    if status == "setup":
        return SESSION_ROLE_SETUP
    if status == "ready_for_table":
        return SESSION_ROLE_PLAY
    if not campaign_has_confirmed_investigator(campaign_dir, campaign_id):
        return SESSION_ROLE_SETUP
    if status == "active":
        return SESSION_ROLE_PLAY
    return CAMPAIGN_STATUS_TO_SESSION_ROLE.get(status, SESSION_ROLE_PLAY)


def create_campaign(
    root: Path,
    campaign_id: str,
    title: str,
    era: str | None = None,
    play_language: str = DEFAULT_PLAY_LANGUAGE,
    start_clock: dict[str, Any] | None = None,
    *,
    ruleset_id: str = coc_rulesets.DEFAULT_RULESET_ID,
    fresh_start: bool = False,
) -> Path:
    ruleset_id = coc_rulesets.require_registered_ruleset(
        ruleset_id,
        campaign_schema_version=int(CURRENT_SCHEMA_VERSIONS["campaign"]),
    )
    ensure_workspace(root)
    campaign_dir = coc_root(root) / "campaigns" / campaign_id
    if campaign_dir.exists() or fresh_start:
        if fresh_start:
            discard_campaign_generation(root, campaign_id, fresh_start=True)
        else:
            raise FileExistsError(f"campaign already exists: {campaign_id}")
    campaign_path = _create_campaign_at(
        root,
        campaign_dir,
        campaign_id,
        title,
        era=era,
        play_language=play_language,
        start_clock=start_clock,
        ruleset_id=ruleset_id,
        update_index=True,
    )
    import coc_git_history

    coc_git_history.ensure_repo(root, campaign_id)
    coc_git_history.commit_baseline(
        root,
        campaign_id,
        schema_generation=coc_git_history.format_schema_generation(
            CURRENT_SCHEMA_VERSIONS
        ),
        note="initial campaign generation",
    )
    return campaign_path


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
        campaign_dir / "save" / "session-state.json",
        {"schema_version": 1, "table_session_seq": 1},
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
        "current_luck": int(
            derived.get("Luck") or characteristics.get("LUCK") or 50
        ),
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
    # Choke-point sidecar: uncovered canonical-event writes ledger (best
    # effort; must never break the primary write).
    try:
        import coc_canonical_events as _canonical_events

        _canonical_events.note_choked_append(path, event)
    except Exception:
        pass


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


# --------------------------------------------------------------------------- #
# Steward state: deliveries + notebook (0.5.1a S2)
# --------------------------------------------------------------------------- #
# The steward (coc-steward role, host-agnostic) feeds module text to the KP by
# writing delivery records and maintaining a notebook of pre-cut segments per
# expected scene.  This document is the steward's own state surface; it never
# holds rules/state authority and is written only through the transactional
# ``steward.*`` toolbox operations (idempotent via decision_id).

# Schema v2 adds the asynchronous parser's domain snapshots and failure
# ledger.  Old v1 documents are intentionally rejected under clean-slate
# persistence rather than silently migrated.
STEWARD_STATE_DOCUMENT_SCHEMA_VERSION = 2
STEWARD_SECRECY_LEVELS = frozenset({"keeper_only", "player_safe"})
STEWARD_PARSE_DOMAINS = frozenset({"init", "npc", "scene", "clue", "rule"})
STEWARD_DOMAIN_STATUSES = frozenset({"pending", "ready", "partial", "failed"})
_STEWARD_MAX_FAILED_CHUNKS = 256
_STEWARD_MAX_DOMAIN_JSON_BYTES = 5_000_000

_STEWARD_SEGMENT_FIELDS = frozenset({"text", "page", "source_refs"})
_STEWARD_DELIVERY_FIELDS = frozenset({
    "delivery_id",
    "created_turn",
    "segments",
    "why_now",
    "scene_annotation",
    "secrecy",
    "consumed",
    "consumed_turn",
    "decision_id",
    "notebook_entry_ids",
    "ts",
})
_STEWARD_NOTEBOOK_ENTRY_FIELDS = frozenset({
    "entry_id",
    "scene_annotation",
    "segments",
    "note",
    "paid",
    "paid_turn",
    "paid_delivery_id",
    "created_turn",
    "updated_turn",
    "decision_id",
})
_STEWARD_MAX_SEGMENTS = 128
_STEWARD_MAX_SEGMENT_TEXT_CHARS = 100_000
_STEWARD_MAX_SOURCE_REFS = 32
_STEWARD_MAX_SOURCE_REF_CHARS = 400
_STEWARD_MAX_ANNOTATION_CHARS = 200
_STEWARD_MAX_NOTE_CHARS = 2_000
_STEWARD_MAX_WHY_NOW_CHARS = 2_000
_STEWARD_MAX_ID_CHARS = 160
_STEWARD_MAX_TURN_REF_CHARS = 200


def steward_state_path(campaign_dir: Path) -> Path:
    """Exact path of the steward state document inside a campaign save."""
    return Path(campaign_dir) / "save" / "steward-state.json"


def empty_steward_state(campaign_id: str) -> dict[str, Any]:
    """Fresh exact-current steward document for a campaign."""
    return {
        "schema_version": STEWARD_STATE_DOCUMENT_SCHEMA_VERSION,
        "campaign_id": str(campaign_id),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "deliveries": {},
        "notebook": {},
        "domains": {
            domain: {"status": "pending"}
            for domain in sorted(STEWARD_PARSE_DOMAINS)
        },
        "failed_chunks": [],
    }


def _validated_optional_text(value: Any, field: str, *, maximum: int) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(f"{field} must be a string or null")
    text = value.strip()
    if not text:
        return None
    if len(text) > maximum:
        raise ValueError(f"{field} exceeds {maximum} characters")
    return text


def validated_steward_segments(segments: Any, *, field: str) -> list[dict[str, Any]]:
    """Validate one steward segment list; returns a normalized deep copy."""
    if not isinstance(segments, list) or not segments:
        raise ValueError(f"{field} must be a non-empty array of segments")
    if len(segments) > _STEWARD_MAX_SEGMENTS:
        raise ValueError(f"{field} exceeds {_STEWARD_MAX_SEGMENTS} segments")
    normalized: list[dict[str, Any]] = []
    for position, segment in enumerate(segments):
        if not isinstance(segment, dict) or set(segment) != _STEWARD_SEGMENT_FIELDS:
            raise ValueError(
                f"{field}[{position}] must be exactly {{text, page, source_refs}}"
            )
        text = segment["text"]
        if (
            not isinstance(text, str)
            or not text.strip()
            or len(text) > _STEWARD_MAX_SEGMENT_TEXT_CHARS
        ):
            raise ValueError(
                f"{field}[{position}].text must be a non-empty string "
                f"within {_STEWARD_MAX_SEGMENT_TEXT_CHARS} characters"
            )
        page = segment["page"]
        if page is not None and (
            isinstance(page, bool)
            or not isinstance(page, int)
            or page < 0
        ):
            raise ValueError(
                f"{field}[{position}].page must be a non-negative integer or null"
            )
        refs = segment["source_refs"]
        if (
            not isinstance(refs, list)
            or not refs
            or len(refs) > _STEWARD_MAX_SOURCE_REFS
        ):
            raise ValueError(
                f"{field}[{position}].source_refs must be a non-empty array "
                f"of at most {_STEWARD_MAX_SOURCE_REFS} strings"
            )
        normalized_refs: list[str] = []
        for ref in refs:
            if not isinstance(ref, str) or not ref.strip():
                raise ValueError(
                    f"{field}[{position}].source_refs entries must be non-empty strings"
                )
            if len(ref) > _STEWARD_MAX_SOURCE_REF_CHARS:
                raise ValueError(
                    f"{field}[{position}].source_refs entry exceeds "
                    f"{_STEWARD_MAX_SOURCE_REF_CHARS} characters"
                )
            normalized_refs.append(ref)
        normalized.append({
            "text": text,
            "page": page,
            "source_refs": normalized_refs,
        })
    return normalized


def _validated_identifier(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} must be a non-empty string")
    text = value.strip()
    if len(text) > _STEWARD_MAX_ID_CHARS:
        raise ValueError(f"{field} exceeds {_STEWARD_MAX_ID_CHARS} characters")
    return text


def _validated_turn_ref(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} must be a non-empty string")
    text = value.strip()
    if len(text) > _STEWARD_MAX_TURN_REF_CHARS:
        raise ValueError(f"{field} exceeds {_STEWARD_MAX_TURN_REF_CHARS} characters")
    return text


def _validated_annotation(value: Any, field: str) -> str:
    text = _validated_optional_text(value, field, maximum=_STEWARD_MAX_ANNOTATION_CHARS)
    if not text:
        raise ValueError(f"{field} must be a non-empty string")
    return text


def _validated_steward_json(value: Any, field: str) -> Any:
    """Return a JSON-only deep copy, bounded so a bad parser cannot bloat saves."""
    try:
        encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
        normalized = json.loads(encoded)
    except (TypeError, ValueError, json.JSONDecodeError) as exc:
        raise ValueError(f"{field} must contain only JSON values") from exc
    if len(encoded.encode("utf-8")) > _STEWARD_MAX_DOMAIN_JSON_BYTES:
        raise ValueError(f"{field} exceeds {_STEWARD_MAX_DOMAIN_JSON_BYTES} UTF-8 bytes")
    return normalized


def validated_steward_domain_content(value: Any) -> dict[str, Any]:
    """Validate extensible parser output while reserving its status field."""
    if not isinstance(value, dict):
        raise ValueError("content must be a JSON object")
    if "status" in value:
        raise ValueError("content must not contain status; pass status separately")
    return _validated_steward_json(value, "content")


_SCENE_EDGE_KINDS = frozenset({"next", "if", "timeline", "clue", "fail_loop"})
_SCENE_EDGE_PROVENANCE = frozenset({
    "source_authored",
    "directory_adjacency",
    "parent_child",
    "timeline",
    "semantic_inference",
})
_STEWARD_MAX_SCENE_BUNDLES = 64
_STEWARD_MAX_SCENE_NEIGHBORS = 32


def _validated_steward_source_refs(value: Any, field: str) -> list[str]:
    if not isinstance(value, list) or not value:
        raise ValueError(f"{field} must be a non-empty array of source references")
    if len(value) > _STEWARD_MAX_SOURCE_REFS:
        raise ValueError(f"{field} exceeds {_STEWARD_MAX_SOURCE_REFS} source references")
    refs: list[str] = []
    for index, raw in enumerate(value):
        if not isinstance(raw, str) or not raw.strip():
            raise ValueError(f"{field}[{index}] must be a non-empty string")
        ref = raw.strip()
        if len(ref) > _STEWARD_MAX_SOURCE_REF_CHARS:
            raise ValueError(
                f"{field}[{index}] exceeds {_STEWARD_MAX_SOURCE_REF_CHARS} characters"
            )
        refs.append(ref)
    return refs


def _validated_steward_scene_entity(value: Any, field: str) -> dict[str, Any]:
    entity = _validated_steward_json(value, field)
    if not isinstance(entity, dict):
        raise ValueError(f"{field} must be an object")
    entity_id = entity.get("id")
    if entity_id is None:
        entity_id = entity.get("scene_id", entity.get("location_id"))
    entity["id"] = _validated_identifier(entity_id, f"{field}.id")
    name = entity.get("name", entity.get("title", entity["id"]))
    entity["name"] = _validated_identifier(name, f"{field}.name")
    entity["source_refs"] = _validated_steward_source_refs(
        entity.get("source_refs"), f"{field}.source_refs"
    )
    secrecy = entity.get("secrecy")
    if secrecy is not None and secrecy not in STEWARD_SECRECY_LEVELS:
        raise ValueError(
            f"{field}.secrecy must be one of {sorted(STEWARD_SECRECY_LEVELS)}"
        )
    return entity


def _validated_steward_scene_edge(
    value: Any, field: str, *, from_scene_id: str, to_scene_id: str,
) -> dict[str, Any]:
    edge = _validated_steward_json(value, field)
    if not isinstance(edge, dict):
        raise ValueError(f"{field} must be an object")
    if _validated_identifier(edge.get("from"), f"{field}.from") != from_scene_id:
        raise ValueError(f"{field}.from must equal the bundle current scene id")
    if _validated_identifier(edge.get("to"), f"{field}.to") != to_scene_id:
        raise ValueError(f"{field}.to must equal its neighbor scene id")
    if edge.get("kind") not in _SCENE_EDGE_KINDS:
        raise ValueError(f"{field}.kind must be one of {sorted(_SCENE_EDGE_KINDS)}")
    condition = edge.get("condition_text")
    if condition is not None and (not isinstance(condition, str) or len(condition) > _STEWARD_MAX_NOTE_CHARS):
        raise ValueError(f"{field}.condition_text must be a string or null")
    if edge.get("provenance") not in _SCENE_EDGE_PROVENANCE:
        raise ValueError(
            f"{field}.provenance must be one of {sorted(_SCENE_EDGE_PROVENANCE)}"
        )
    edge["source_refs"] = _validated_steward_source_refs(
        edge.get("source_refs"), f"{field}.source_refs"
    )
    return edge


def validated_steward_scene_bundles(value: Any) -> list[dict[str, Any]]:
    """Validate source-bound SceneBundle records before merging the scene cache."""
    if not isinstance(value, list) or not value:
        raise ValueError("bundles must be a non-empty array")
    if len(value) > _STEWARD_MAX_SCENE_BUNDLES:
        raise ValueError(f"bundles exceeds {_STEWARD_MAX_SCENE_BUNDLES} records")
    normalized: list[dict[str, Any]] = []
    ids: set[str] = set()
    for index, raw in enumerate(value):
        bundle = _validated_steward_json(raw, f"bundles[{index}]")
        if not isinstance(bundle, dict):
            raise ValueError(f"bundles[{index}] must be an object")
        current = _validated_steward_scene_entity(bundle.get("current"), f"bundles[{index}].current")
        current_id = current["id"]
        if current_id in ids:
            raise ValueError(f"bundles contains duplicate current scene id {current_id!r}")
        ids.add(current_id)
        neighbors_raw = bundle.get("neighbors")
        if not isinstance(neighbors_raw, list) or len(neighbors_raw) > _STEWARD_MAX_SCENE_NEIGHBORS:
            raise ValueError(
                f"bundles[{index}].neighbors must be an array of at most "
                f"{_STEWARD_MAX_SCENE_NEIGHBORS} records"
            )
        neighbors: list[dict[str, Any]] = []
        for neighbor_index, raw_neighbor in enumerate(neighbors_raw):
            neighbor = _validated_steward_json(
                raw_neighbor, f"bundles[{index}].neighbors[{neighbor_index}]"
            )
            if not isinstance(neighbor, dict):
                raise ValueError(f"bundles[{index}].neighbors[{neighbor_index}] must be an object")
            scene = _validated_steward_scene_entity(
                neighbor.get("scene"), f"bundles[{index}].neighbors[{neighbor_index}].scene"
            )
            neighbor["scene"] = scene
            neighbor["edge"] = _validated_steward_scene_edge(
                neighbor.get("edge"),
                f"bundles[{index}].neighbors[{neighbor_index}].edge",
                from_scene_id=current_id,
                to_scene_id=scene["id"],
            )
            neighbors.append(neighbor)
        bundle["current"] = current
        bundle["neighbors"] = neighbors
        bundle["source_refs"] = _validated_steward_source_refs(
            bundle.get("source_refs"), f"bundles[{index}].source_refs"
        )
        prefetched_from = bundle.get("prefetched_from")
        if prefetched_from is not None:
            bundle["prefetched_from"] = _validated_identifier(
                prefetched_from, f"bundles[{index}].prefetched_from"
            )
        normalized.append(bundle)
    return normalized


def validated_steward_failed_chunks(value: Any, *, domain: str | None = None) -> list[dict[str, Any]]:
    """Validate append-only parser failures without constraining module-specific detail."""
    if value is None:
        return []
    if not isinstance(value, list) or len(value) > _STEWARD_MAX_FAILED_CHUNKS:
        raise ValueError(f"failed_chunks must be an array of at most {_STEWARD_MAX_FAILED_CHUNKS} records")
    records: list[dict[str, Any]] = []
    for index, raw in enumerate(value):
        record = _validated_steward_json(raw, f"failed_chunks[{index}]")
        if not isinstance(record, dict):
            raise ValueError(f"failed_chunks[{index}] must be an object")
        actual_domain = record.get("domain", domain)
        if actual_domain not in STEWARD_PARSE_DOMAINS:
            raise ValueError(f"failed_chunks[{index}].domain must be one of {sorted(STEWARD_PARSE_DOMAINS)}")
        chunk_id = _validated_identifier(record.get("chunk_id"), f"failed_chunks[{index}].chunk_id")
        reason = _validated_optional_text(record.get("reason"), f"failed_chunks[{index}].reason", maximum=_STEWARD_MAX_NOTE_CHARS)
        if not reason:
            raise ValueError(f"failed_chunks[{index}].reason must be a non-empty string")
        attempts = record.get("attempts", 1)
        if not _is_exact_int(attempts) or attempts < 1:
            raise ValueError(f"failed_chunks[{index}].attempts must be an integer >= 1")
        refs = record.get("source_refs", [])
        if not isinstance(refs, list) or any(not isinstance(ref, str) or not ref.strip() for ref in refs):
            raise ValueError(f"failed_chunks[{index}].source_refs must be an array of non-empty strings")
        record["domain"] = actual_domain
        record["chunk_id"] = chunk_id
        record["reason"] = reason
        record["attempts"] = attempts
        record["source_refs"] = [ref.strip() for ref in refs]
        records.append(record)
    return records


def validate_steward_state_document(
    data: Any, campaign_id: str,
) -> dict[str, Any]:
    """Fail-closed structural validation of one steward state document.

    Raises ``ValueError`` on any drift; returns a normalized deep copy on
    success.  Cross-references between deliveries and notebook entries are
    enforced so the document can never become internally inconsistent.
    """
    if not isinstance(data, dict) or set(data) != {
        "schema_version", "campaign_id", "updated_at", "deliveries", "notebook",
        "domains", "failed_chunks",
    }:
        raise ValueError(
            "save/steward-state.json does not match the current schema-v1 document"
        )
    if data.get("schema_version") != STEWARD_STATE_DOCUMENT_SCHEMA_VERSION:
        raise ValueError(
            "save/steward-state.json schema_version mismatch: "
            f"expected {STEWARD_STATE_DOCUMENT_SCHEMA_VERSION}, "
            f"got {data.get('schema_version')!r}"
        )
    campaign = str(data.get("campaign_id") or "").strip()
    expected_campaign = str(campaign_id or "").strip()
    if not campaign or campaign != expected_campaign:
        raise ValueError(
            "save/steward-state.json campaign identity is invalid: "
            f"expected {expected_campaign!r}, got {campaign!r}"
        )

    updated_at = data["updated_at"]
    if not isinstance(updated_at, str) or not updated_at.strip():
        raise ValueError("save/steward-state.json updated_at must be a non-empty string")
    deliveries_raw = data["deliveries"]
    notebook_raw = data["notebook"]
    domains_raw = data["domains"]
    failed_chunks_raw = data["failed_chunks"]
    if not isinstance(deliveries_raw, dict) or not isinstance(notebook_raw, dict):
        raise ValueError(
            "save/steward-state.json deliveries/notebook must be objects"
        )
    if not isinstance(domains_raw, dict) or set(domains_raw) != STEWARD_PARSE_DOMAINS:
        raise ValueError(
            "save/steward-state.json domains must contain exactly "
            + ", ".join(sorted(STEWARD_PARSE_DOMAINS))
        )
    domains: dict[str, Any] = {}
    for domain in sorted(STEWARD_PARSE_DOMAINS):
        raw_domain = _validated_steward_json(domains_raw[domain], f"domains.{domain}")
        if not isinstance(raw_domain, dict):
            raise ValueError(f"domains.{domain} must be an object")
        status = raw_domain.get("status")
        if status not in STEWARD_DOMAIN_STATUSES:
            raise ValueError(
                f"domains.{domain}.status must be one of {sorted(STEWARD_DOMAIN_STATUSES)}"
            )
        domains[domain] = raw_domain
    failed_chunks = validated_steward_failed_chunks(failed_chunks_raw)

    deliveries: dict[str, Any] = {}
    for key, record in deliveries_raw.items():
        if not isinstance(record, dict) or set(record) != _STEWARD_DELIVERY_FIELDS:
            raise ValueError(f"delivery {key!r} does not match the current schema")
        delivery_id = _validated_identifier(record["delivery_id"], "delivery_id")
        if delivery_id != str(key):
            raise ValueError(f"delivery map key must equal delivery_id for {key!r}")
        created_turn = _validated_turn_ref(record["created_turn"], "created_turn")
        why_now = _validated_optional_text(
            record["why_now"], "why_now", maximum=_STEWARD_MAX_WHY_NOW_CHARS
        )
        if not why_now:
            raise ValueError("why_now must be a non-empty string")
        scene_annotation = _validated_optional_text(
            record["scene_annotation"],
            "scene_annotation",
            maximum=_STEWARD_MAX_ANNOTATION_CHARS,
        )
        secrecy = record["secrecy"]
        if secrecy not in STEWARD_SECRECY_LEVELS:
            raise ValueError(
                f"delivery {key!r} secrecy must be one of "
                f"{sorted(STEWARD_SECRECY_LEVELS)}"
            )
        consumed = record["consumed"]
        consumed_turn = record["consumed_turn"]
        if not isinstance(consumed, bool):
            raise ValueError(f"delivery {key!r} consumed must be a boolean")
        if consumed_turn is not None and (
            not isinstance(consumed_turn, str) or not consumed_turn.strip()
        ):
            raise ValueError(f"delivery {key!r} consumed_turn must be a string or null")
        if not consumed and consumed_turn is not None:
            raise ValueError(f"delivery {key!r} has consumed_turn while not consumed")
        if consumed and consumed_turn is None:
            raise ValueError(f"delivery {key!r} is consumed without a consumed_turn")
        decision_id = _validated_identifier(record["decision_id"], "decision_id")
        ts = record["ts"]
        if not isinstance(ts, str) or not ts.strip():
            raise ValueError(f"delivery {key!r} ts must be a non-empty string")
        notebook_refs = record["notebook_entry_ids"]
        if (
            not isinstance(notebook_refs, list)
            or any(
                not isinstance(ref, str) or not ref.strip()
                for ref in notebook_refs
            )
        ):
            raise ValueError(
                f"delivery {key!r} notebook_entry_ids must be an array of strings"
            )
        deliveries[str(key)] = {
            "delivery_id": delivery_id,
            "created_turn": created_turn,
            "segments": validated_steward_segments(
                record["segments"], field=f"delivery {key!r} segments"
            ),
            "why_now": why_now,
            "scene_annotation": scene_annotation,
            "secrecy": secrecy,
            "consumed": consumed,
            "consumed_turn": consumed_turn,
            "decision_id": decision_id,
            "notebook_entry_ids": list(notebook_refs),
            "ts": ts,
        }

    notebook: dict[str, Any] = {}
    for key, entry in notebook_raw.items():
        if not isinstance(entry, dict) or set(entry) != _STEWARD_NOTEBOOK_ENTRY_FIELDS:
            raise ValueError(f"notebook entry {key!r} does not match the current schema")
        entry_id = _validated_identifier(entry["entry_id"], "entry_id")
        if entry_id != str(key):
            raise ValueError(f"notebook map key must equal entry_id for {key!r}")
        scene_annotation = _validated_annotation(
            entry["scene_annotation"], "scene_annotation"
        )
        note = _validated_optional_text(entry["note"], "note", maximum=_STEWARD_MAX_NOTE_CHARS)
        paid = entry["paid"]
        paid_turn = entry["paid_turn"]
        paid_delivery_id = entry["paid_delivery_id"]
        if not isinstance(paid, bool):
            raise ValueError(f"notebook entry {key!r} paid must be a boolean")
        if paid_turn is not None and (
            not isinstance(paid_turn, str) or not paid_turn.strip()
        ):
            raise ValueError(f"notebook entry {key!r} paid_turn must be a string or null")
        if paid_delivery_id is not None and (
            not isinstance(paid_delivery_id, str) or not paid_delivery_id.strip()
        ):
            raise ValueError(
                f"notebook entry {key!r} paid_delivery_id must be a string or null"
            )
        if not paid and (paid_turn is not None or paid_delivery_id is not None):
            raise ValueError(
                f"notebook entry {key!r} has pay markers while not paid"
            )
        if paid and paid_turn is None:
            raise ValueError(f"notebook entry {key!r} is paid without a paid_turn")
        if paid_delivery_id is not None and paid_delivery_id not in deliveries:
            raise ValueError(
                f"notebook entry {key!r} paid_delivery_id references an "
                f"unknown delivery {paid_delivery_id!r}"
            )
        notebook[str(key)] = {
            "entry_id": entry_id,
            "scene_annotation": scene_annotation,
            "segments": validated_steward_segments(
                entry["segments"], field=f"notebook entry {key!r} segments"
            ),
            "note": note,
            "paid": paid,
            "paid_turn": paid_turn,
            "paid_delivery_id": paid_delivery_id,
            "created_turn": _validated_turn_ref(entry["created_turn"], "created_turn"),
            "updated_turn": _validated_turn_ref(entry["updated_turn"], "updated_turn"),
            "decision_id": _validated_identifier(entry["decision_id"], "decision_id"),
        }

    # Cross-reference: every delivery-linked notebook entry must be paid by
    # exactly that delivery.
    for delivery_id, record in deliveries.items():
        for entry_id in record["notebook_entry_ids"]:
            entry = notebook.get(entry_id)
            if entry is None:
                raise ValueError(
                    f"delivery {delivery_id!r} references unknown notebook entry "
                    f"{entry_id!r}"
                )
            if entry["paid_delivery_id"] != delivery_id:
                raise ValueError(
                    f"delivery {delivery_id!r} references notebook entry {entry_id!r} "
                    "which is not paid by this delivery"
                )

    return {
        "schema_version": STEWARD_STATE_DOCUMENT_SCHEMA_VERSION,
        "campaign_id": campaign,
        "updated_at": updated_at.strip(),
        "deliveries": deliveries,
        "notebook": notebook,
        "domains": domains,
        "failed_chunks": failed_chunks,
    }


def load_steward_state(campaign_dir: Path) -> dict[str, Any]:
    """Load the exact-current steward document; missing file -> empty state."""
    campaign_dir = Path(campaign_dir)
    path = steward_state_path(campaign_dir)
    if not path.is_file():
        return empty_steward_state(campaign_dir.name)
    try:
        raw = path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        raise ValueError(
            f"save/steward-state.json is unreadable: {exc}"
        ) from exc
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(
            "save/steward-state.json is not valid JSON; refusing to replace it"
        ) from exc
    return validate_steward_state_document(data, campaign_dir.name)


def save_steward_state(campaign_dir: Path, payload: dict[str, Any]) -> None:
    """Validate then atomically persist one steward state document."""
    campaign_dir = Path(campaign_dir)
    next_payload = dict(payload)
    next_payload["updated_at"] = datetime.now(timezone.utc).isoformat()
    normalized = validate_steward_state_document(next_payload, campaign_dir.name)
    write_json_atomic(steward_state_path(campaign_dir), normalized)
