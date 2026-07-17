#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import coc_fileio
import coc_pdf_bundle
import coc_pdf_source


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
    """Read index/handout-assets.json and return a {asset_id: asset} map."""
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


def catalog_source_bundles(bundle_dir: Path) -> list[dict[str, Any]]:
    """Catalog host-produced bundles without opening their source PDFs."""
    if not bundle_dir.exists():
        return []

    catalog: list[dict[str, Any]] = []
    for path in sorted(bundle_dir.rglob(coc_pdf_bundle.MANIFEST_NAME)):
        bundle = coc_pdf_bundle.load_host_bundle(path.parent)
        source = bundle["source"]
        catalog.append(
            {
                "source_id": source["source_id"],
                "bundle_path": str(path.parent.resolve()),
                "page_count": source["page_count"],
                "selected_pdf_indices": [page["pdf_index"] for page in bundle["pages"]],
                "title": source["title"],
                "file_sha256": source["file_sha256"],
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

    normalized_source = dict(source or {})
    if normalized_source.get("path") and not normalized_source.get("source_id"):
        normalized_source["source_id"] = coc_pdf_source.default_source_id(
            normalized_source["path"]
        )
    if normalized_source.get("path") and not normalized_source.get("file_sha256"):
        file_hash = coc_pdf_source.sha256_file(normalized_source["path"])
        if file_hash:
            normalized_source["file_sha256"] = file_hash

    _write_json(
        index_dir / "source-map.json",
        {
            "schema_version": 1,
            "scenario_id": scenario_id,
            "sources": [normalized_source],
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
    coc_pdf_source.initialize_source_indexes(
        campaign_dir,
        scenario_id,
        sources=[normalized_source],
    )
    return scenario
