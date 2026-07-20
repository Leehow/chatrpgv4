#!/usr/bin/env python3
"""Tests for progressive asset reuse + queue worker (slices 6–7)."""
from __future__ import annotations

import importlib.util
import json
import os
import shutil
from pathlib import Path

os.environ["COC_DISABLE_QUEUE_WORKER"] = "1"

SCRIPTS = Path("plugins/coc-keeper/scripts")
FAKE_SHA = "c" * 64


def _load(name: str, rel: str):
    spec = importlib.util.spec_from_file_location(name, rel)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


assets = _load("coc_module_assets_reuse_t", str(SCRIPTS / "coc_module_assets.py"))
project = _load("coc_module_project_reuse_t", str(SCRIPTS / "coc_module_project.py"))
reuse = _load("coc_module_reuse_t", str(SCRIPTS / "coc_module_reuse.py"))
state = _load("coc_state_reuse_t", str(SCRIPTS / "coc_state.py"))
registry = _load("coc_module_registry_reuse_t", str(SCRIPTS / "coc_module_registry.py"))


def _skeleton():
    return {
        "schema_version": 1,
        "parse_tier": 1,
        "module_identity": {
            "canonical_module_id": "reuse-demo",
            "canonical_title": "Reuse Demo",
        },
        "structure_type": "branching_investigation",
        "source": {
            "source_id": "pdf:reuse-demo",
            "path": "/tmp/reuse-demo.pdf",
            "file_sha256": FAKE_SHA,
            "page_count": 8,
            "producer": "codex-pdf-skill",
        },
        "start_candidates": ["opening"],
        "finale_buckets": [{"id": "end", "title": "End", "importance": "critical"}],
        "locations": [
            {
                "location_id": "opening",
                "title": "Opening",
                "parse_state": "toc_only",
                "scene_type": "social",
            },
            {
                "location_id": "cellar",
                "title": "Cellar",
                "parse_state": "named_only",
            },
        ],
        "edges_provisional": [
            {
                "from": "opening",
                "to": "cellar",
                "kind": "travel",
                "confidence": "low",
                "evidence": "toc_adjacency",
            }
        ],
        "npc_roster": [],
        "handouts": [],
        "threats": [],
        "conclusion_buckets": [],
    }


def _deep(loc_id: str, clue_id: str):
    return {
        "location_id": loc_id,
        "title": loc_id.title(),
        "parse_state": "deep",
        "dramatic_question": f"What is at {loc_id}?",
        "scene_type": "investigation" if loc_id != "opening" else "social",
        "player_safe_summary": f"Summary of {loc_id}",
        "available_clue_ids": [clue_id],
        "clues": [
            {
                "clue_id": clue_id,
                "delivery_kind": "handout",
                "player_safe_summary": f"Handout text for {clue_id}",
            }
        ],
        "npcs": [],
        "mentions": [],
        "scene_edges": [],
        "pressure_moves": ["A draft moves the dust."],
        "affordances": [
            {
                "id": f"{loc_id}-a",
                "cue": "Look around",
                "route_type": "investigative_lead",
                "status": "open",
            },
            {
                "id": f"{loc_id}-b",
                "cue": "Search carefully",
                "route_type": "investigative_lead",
                "status": "open",
            },
        ],
    }


def _campaign(tmp_path: Path, cid: str = "reuse-camp") -> Path:
    state.create_campaign(tmp_path, cid, "Reuse Camp", play_language="zh-Hans")
    return tmp_path / ".coc" / "campaigns" / cid


def _seed_assets(tmp_path: Path) -> None:
    assets.init_module_root(
        tmp_path,
        asset_root_id="reuse-demo",
        identity={"canonical_module_id": "reuse-demo", "canonical_title": "Reuse Demo"},
        file_sha256=FAKE_SHA,
    )
    assets.put_skeleton(tmp_path, "reuse-demo", _skeleton())
    assets.put_entity(tmp_path, "reuse-demo", "location", "opening", _deep("opening", "clue-o"))
    assets.put_entity(tmp_path, "reuse-demo", "location", "cellar", _deep("cellar", "clue-c"))


def test_reuse_by_file_sha256_skips_reextract(tmp_path: Path):
    _seed_assets(tmp_path)
    camp = _campaign(tmp_path, "reuse-a")
    result = reuse.reuse_into_campaign(
        tmp_path, "reuse-a", file_sha256=FAKE_SHA, merge_all_deep=True,
    )
    assert result["asset_root_id"] == "reuse-demo"
    assert result["resolved_via"] == "file_sha256"
    assert set(result["merged_location_ids"]) == {"opening", "cellar"}

    sc = json.loads((camp / "scenario" / "scenario.json").read_text(encoding="utf-8"))
    assert sc["progressive_asset_root_id"] == "reuse-demo"
    sg = json.loads((camp / "scenario" / "story-graph.json").read_text(encoding="utf-8"))
    cellar = next(s for s in sg["scenes"] if s["scene_id"] == "cellar")
    assert cellar["parse_state"] == "deep"
    assert "clue-c" in cellar["available_clues"]


def test_resolve_via_library_link(tmp_path: Path):
    _seed_assets(tmp_path)
    # Minimal library entry with 7 empty-ish but valid-enough files from projection
    camp = _campaign(tmp_path, "lib-src")
    project.project_opening_deep(
        tmp_path, "lib-src", "reuse-demo",
        deep_packs=[_deep("opening", "clue-o")],
    )
    # Register as library module by copying scenario
    lib = tmp_path / ".coc" / "module-library" / "reuse-demo"
    lib.mkdir(parents=True)
    shutil.copytree(camp / "scenario", lib / "scenario")
    (lib / "identity.json").write_text(
        json.dumps({
            "schema_version": 1,
            "canonical_module_id": "reuse-demo",
            "canonical_title": "Reuse Demo",
            "rules_edition": "7e",
            "aliases": [],
        }),
        encoding="utf-8",
    )
    reg = {
        "schema_version": 1,
        "modules": {
            "reuse-demo": {
                "canonical_module_id": "reuse-demo",
                "canonical_title": "Reuse Demo",
            }
        },
        "alias_index": {},
    }
    (tmp_path / ".coc" / "module-library" / "registry.json").write_text(
        json.dumps(reg), encoding="utf-8",
    )

    link = reuse.link_library_to_assets(
        tmp_path,
        canonical_module_id="reuse-demo",
        asset_root_id="reuse-demo",
        file_sha256=FAKE_SHA,
    )
    assert Path(link["path"]).is_file()

    resolved = reuse.resolve_asset_root(
        tmp_path, canonical_module_id="reuse-demo",
    )
    assert resolved["asset_root_id"] == "reuse-demo"
    assert resolved["via"] == "library_link"


def test_process_queue_merges_pending_deep(tmp_path: Path):
    _seed_assets(tmp_path)
    camp = _campaign(tmp_path, "queue-camp")
    # Only skeleton first
    project.project_skeleton_to_campaign(tmp_path, "queue-camp", "reuse-demo")
    # Enqueue cellar deepen (pack already deep in assets)
    assets.enqueue_job(
        tmp_path, "reuse-demo",
        kind="deepen_location", target_id="cellar", priority=90, reason="test",
    )
    result = reuse.process_queue(tmp_path, "queue-camp", asset_root_id="reuse-demo")
    assert "cellar" in result["merged_location_ids"]
    sg = json.loads((camp / "scenario" / "story-graph.json").read_text(encoding="utf-8"))
    cellar = next(s for s in sg["scenes"] if s["scene_id"] == "cellar")
    assert cellar["parse_state"] == "deep"


def test_process_queue_does_not_duplicate_completed_history(tmp_path: Path):
    _seed_assets(tmp_path)
    _campaign(tmp_path, "queue-idempotent")
    project.project_skeleton_to_campaign(
        tmp_path, "queue-idempotent", "reuse-demo",
    )
    assets.enqueue_job(
        tmp_path, "reuse-demo",
        kind="deepen_location", target_id="cellar", priority=90, reason="test",
    )

    reuse.process_queue(
        tmp_path, "queue-idempotent", asset_root_id="reuse-demo",
    )
    reuse.process_queue(
        tmp_path, "queue-idempotent", asset_root_id="reuse-demo",
    )

    done = assets.list_queue(tmp_path, "reuse-demo")["done"]
    job_ids = [row["job_id"] for row in done]
    assert len(job_ids) == len(set(job_ids))


def test_stamp_install_progressive(tmp_path: Path):
    _seed_assets(tmp_path)
    lib = tmp_path / ".coc" / "module-library" / "reuse-demo"
    lib.mkdir(parents=True)
    (lib / "progressive-link.json").write_text(
        json.dumps({
            "schema_version": 1,
            "asset_root_id": "reuse-demo",
            "file_sha256": FAKE_SHA,
        }),
        encoding="utf-8",
    )
    camp = _campaign(tmp_path, "stamp-camp")
    (camp / "scenario").mkdir(exist_ok=True)
    (camp / "scenario" / "scenario.json").write_text(
        json.dumps({"schema_version": 1, "scenario_id": "x"}), encoding="utf-8",
    )
    stamped = reuse.stamp_install_progressive(camp, lib)
    assert stamped is not None
    sc = json.loads((camp / "scenario" / "scenario.json").read_text(encoding="utf-8"))
    assert sc["progressive_asset_root_id"] == "reuse-demo"
