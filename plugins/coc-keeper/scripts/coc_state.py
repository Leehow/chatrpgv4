#!/usr/bin/env python3
from __future__ import annotations

import json
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


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


def ensure_workspace(root: Path) -> dict[str, str]:
    base = coc_root(root)
    for directory in TOP_LEVEL_DIRS:
        (base / directory).mkdir(parents=True, exist_ok=True)
    return {"coc_root": str(base)}


def create_investigator(root: Path, investigator_id: str, sheet: dict[str, Any]) -> Path:
    ensure_workspace(root)
    investigator_dir = coc_root(root) / "investigators" / investigator_id
    investigator_dir.mkdir(parents=True, exist_ok=True)
    character_path = investigator_dir / "character.json"
    write_json_atomic(character_path, sheet)
    for log_name in ("history.jsonl", "development.jsonl", "inventory-history.jsonl"):
        (investigator_dir / log_name).touch(exist_ok=True)
    return character_path


def create_campaign(
    root: Path,
    campaign_id: str,
    title: str,
    era: str = "1920s",
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
        "active_subsystem": "setup",
        "created_at": created_at,
        "updated_at": created_at,
    }
    campaign_path = campaign_dir / "campaign.json"
    write_json_atomic(campaign_path, campaign)
    return campaign_path


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
    save_dir = campaign_dir / "save"
    if save_dir.exists():
        shutil.copytree(save_dir, snapshot_dir / "save")
    return snapshot_dir
