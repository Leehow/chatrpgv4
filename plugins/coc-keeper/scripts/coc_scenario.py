#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from pypdf import PdfReader


EMPTY_SCENARIO_LISTS = (
    "locations.json",
    "npcs.json",
    "clues.json",
    "timeline.json",
    "handouts.json",
    "keeper-secrets.json",
)


def _write_json(path: Path, payload: dict[str, Any] | list[Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


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
    scenario_dir.mkdir(parents=True, exist_ok=True)
    index_dir.mkdir(parents=True, exist_ok=True)

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
    return scenario
