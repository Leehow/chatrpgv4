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

from coc_fileio import write_json_atomic as _fileio_write_json_atomic
from coc_language import DEFAULT_PLAY_LANGUAGE, language_profile


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


def initial_clock_for_era(era: str = "1920s", start_clock: dict[str, Any] | None = None) -> dict[str, Any]:
    era_clock = ERA_CLOCKS.get(era, ERA_CLOCKS["1920s"])
    if start_clock:
        return {
            "elapsed_minutes": 0,
            "scale": start_clock.get("scale", "scene"),
            "calendar_mode": start_clock.get("calendar_mode", era_clock["calendar_mode"]),
            "local_datetime": start_clock.get("local_datetime", era_clock["local_datetime"]),
            "timezone": start_clock.get("timezone", era_clock["timezone"]),
            "location_id": start_clock.get("location_id"),
            "display": start_clock.get("display", era_clock["display"]),
        }
    return {
        "elapsed_minutes": 0,
        "scale": "scene",
        "calendar_mode": era_clock["calendar_mode"],
        "local_datetime": era_clock["local_datetime"],
        "timezone": era_clock["timezone"],
        "location_id": None,
        "display": era_clock["display"],
    }


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


def _read_json_object(path: Path, fallback: dict[str, Any]) -> dict[str, Any]:
    if not path.exists():
        return fallback
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        return fallback
    return payload


def _merge_current_luck(campaign_dir: Path, investigator_id: str, current_luck: int) -> Path:
    inv_path = campaign_dir / "save" / "investigator-state" / f"{investigator_id}.json"
    data = _read_json_object(inv_path, {})
    data["current_luck"] = int(current_luck)
    write_json_atomic(inv_path, data)
    return inv_path


def _set_luck_spent_last(campaign_dir: Path, points: int) -> None:
    pacing_path = campaign_dir / "save" / "pacing-state.json"
    pacing = _read_json_object(pacing_path, {"schema_version": 1})
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
    data = _read_json_object(inv_path, {})
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
    data = _read_json_object(inv_path, {})
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
    data = _read_json_object(inv_path, {})
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
    campaign_path = coc_root(root) / "campaigns" / campaign_id / "campaign.json"
    campaign = _read_json_object(campaign_path, {"campaign_id": campaign_id})
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


def create_investigator(
    root: Path,
    investigator_id: str,
    sheet: dict[str, Any],
    *,
    creation: dict[str, Any] | None = None,
) -> Path:
    ensure_workspace(root)
    investigator_dir = coc_root(root) / "investigators" / investigator_id
    investigator_dir.mkdir(parents=True, exist_ok=True)
    creation_path = investigator_dir / "creation.json"
    character_path = investigator_dir / "character.json"
    write_json_atomic(creation_path, _creation_record(investigator_id, sheet, creation))
    write_json_atomic(character_path, sheet)
    for log_name in ("history.jsonl", "development.jsonl", "inventory-history.jsonl"):
        (investigator_dir / log_name).touch(exist_ok=True)
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
    return character_path


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
    entries: list[dict[str, Any]] = []
    for candidate in sorted(investigators_dir.iterdir(), key=lambda p: p.name):
        if not candidate.is_dir():
            continue
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


def create_campaign(
    root: Path,
    campaign_id: str,
    title: str,
    era: str = "1920s",
    play_language: str = DEFAULT_PLAY_LANGUAGE,
    start_clock: dict[str, Any] | None = None,
) -> Path:
    ensure_workspace(root)
    campaign_dir = coc_root(root) / "campaigns" / campaign_id
    for directory in CAMPAIGN_DIRS:
        (campaign_dir / directory).mkdir(parents=True, exist_ok=True)
    created_at = now_iso()
    campaign = {
        "schema_version": 1,
        "campaign_id": campaign_id,
        "title": title,
        "mode": "keeper",
        "status": "setup",
        "era": era,
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
    _initialize_campaign_runtime_files(campaign_dir, campaign_id, era=era, start_clock=start_clock)
    _upsert_campaign_index(root, campaign_id)
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
    campaign = _read_json_object(campaign_path, {"campaign_id": campaign_id})
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
            "schema_version": 1,
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
        {
            "schema_version": 1,
            "campaign_id": campaign_id,
            "scenario_id": None,
            "clues_found": {},
            "decisions": [],
            "spoiler_reveals": [],
            "flags": {},
        },
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


def link_party(root: Path, campaign_id: str, investigator_ids: list[str]) -> Path:
    campaign_dir = coc_root(root) / "campaigns" / campaign_id
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
    _upsert_campaign_index(root, campaign_id)
    return party_path


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
