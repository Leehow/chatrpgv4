#!/usr/bin/env python3
from __future__ import annotations

import json
import shutil
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

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


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def coc_root(root: Path) -> Path:
    return root / ".coc"


def write_json_atomic(path: Path, payload: dict[str, Any] | list[Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        "w",
        encoding="utf-8",
        dir=path.parent,
        delete=False,
    ) as handle:
        json.dump(payload, handle, indent=2)
        handle.write("\n")
        temp_path = Path(handle.name)
    temp_path.replace(path)


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


def create_campaign(
    root: Path,
    campaign_id: str,
    title: str,
    era: str = "1920s",
    play_language: str = DEFAULT_PLAY_LANGUAGE,
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
    _initialize_campaign_runtime_files(campaign_dir, campaign_id)
    _upsert_campaign_index(root, campaign_id)
    return campaign_path


def _initialize_campaign_runtime_files(campaign_dir: Path, campaign_id: str) -> None:
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
            "major_decisions": [],
            "current_status": None,
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
            "clock": {
                "elapsed_minutes": 0,
                "scale": "scene",
                "calendar_mode": "relative",
                "local_datetime": None,
                "timezone": None,
                "location_id": None,
                "display": "",
            },
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
