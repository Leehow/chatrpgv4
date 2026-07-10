#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

from pypdf import PdfReader

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import coc_fileio


EMPTY_SCENARIO_LISTS = (
    "locations.json",
    "npcs.json",
    "clues.json",
    "timeline.json",
    "handouts.json",
    "keeper-secrets.json",
)


def _write_json(path: Path, payload: dict[str, Any] | list[Any]) -> None:
    coc_fileio.write_json_atomic(
        path, payload, indent=2, ensure_ascii=True, trailing_newline=True
    )


def load_handout_assets(campaign_dir: Path) -> dict[str, dict[str, Any]]:
    """Read index/handout-assets.json and return a {asset_id: asset} map.

    Returns an empty dict when the file is missing, unreadable, or contains no
    assets. This is the reader for the scaffold written by
    `create_scenario_skeleton` (which starts with `assets: []`); once a module
    extracts player-safe images/clippings/maps into `assets/handouts/` and
    registers them, this resolves their display info (title/summary/source/
    player_visible) for clue_reveal events and narration contracts.

    Asset entries are keyed by their `asset_id`; entries missing an `asset_id`
    are skipped (defensive against partial registrations).
    """
    index_path = campaign_dir / "index" / "handout-assets.json"
    if not index_path.exists():
        return {}
    try:
        payload = json.loads(index_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if not isinstance(payload, dict):
        return {}
    result: dict[str, dict[str, Any]] = {}
    for asset in payload.get("assets", []) or []:
        if not isinstance(asset, dict):
            continue
        asset_id = asset.get("asset_id")
        if isinstance(asset_id, str) and asset_id:
            result[asset_id] = asset
    return result


def catalog_pdfs(pdf_dir: Path) -> list[dict[str, Any]]:
    if not pdf_dir.exists():
        return []

    catalog: list[dict[str, Any]] = []
    for path in sorted(pdf_dir.rglob("*.pdf")):
        reader = PdfReader(str(path))
        metadata = reader.metadata or {}
        catalog.append(
            {
                "filename": path.name,
                "path": str(path),
                "page_count": len(reader.pages),
                "title": metadata.get("/Title"),
            }
        )
    return catalog


def create_scenario_skeleton(
    campaign_dir: Path,
    scenario_id: str,
    title: str,
    source: dict[str, Any],
) -> dict[str, Any]:
    scenario_dir = campaign_dir / "scenario"
    index_dir = campaign_dir / "index"
    handout_asset_dir = campaign_dir / "assets" / "handouts"
    scenario_dir.mkdir(parents=True, exist_ok=True)
    index_dir.mkdir(parents=True, exist_ok=True)
    handout_asset_dir.mkdir(parents=True, exist_ok=True)

    scenario = {
        "schema_version": 1,
        "scenario_id": scenario_id,
        "title": title,
        "source": source,
        "summary": "",
        "player_safe_summary": "",
        "current_phase": "intro",
    }
    _write_json(scenario_dir / "scenario.json", scenario)

    for filename in EMPTY_SCENARIO_LISTS:
        _write_json(scenario_dir / filename, [])

    _write_json(
        index_dir / "source-map.json",
        {
            "schema_version": 1,
            "scenario_id": scenario_id,
            "sources": [source],
            "entries": [],
        },
    )
    _write_json(
        index_dir / "handout-assets.json",
        {
            "schema_version": 1,
            "scenario_id": scenario_id,
            "asset_root": "assets/handouts",
            "assets": [],
            "display": {
                "codex": "render absolute Markdown image paths when player_visible is true",
                "text_only": "show title, summary, and source page when inline image display is unavailable",
            },
        },
    )
    return scenario
