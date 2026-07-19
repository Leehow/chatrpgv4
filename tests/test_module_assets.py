#!/usr/bin/env python3
"""Tests for progressive module-assets store (slice 1)."""
from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path

import pytest

SCRIPTS = Path("plugins/coc-keeper/scripts")


def _load(name: str, rel: str):
    spec = importlib.util.spec_from_file_location(name, rel)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


assets = _load("coc_module_assets", str(SCRIPTS / "coc_module_assets.py"))

FAKE_SHA = "a" * 64


def _minimal_skeleton(**overrides):
    base = {
        "schema_version": 1,
        "parse_tier": 1,
        "module_identity": {"canonical_module_id": "demo-mod"},
        "structure_type": "branching_investigation",
        "source": {
            "source_id": "pdf:demo",
            "path": "/tmp/demo.pdf",
            "file_sha256": FAKE_SHA,
            "page_count": 10,
            "producer": "codex-pdf-skill",
        },
        "start_candidates": ["opening"],
        "finale_buckets": [{"id": "end", "title": "End", "importance": "critical"}],
        "locations": [
            {
                "location_id": "opening",
                "title": "Opening",
                "parse_state": "toc_only",
                "source_span": {"pdf_index_start": 0, "pdf_index_end": 1},
            },
            {
                "location_id": "library",
                "title": "Library",
                "parse_state": "named_only",
            },
        ],
        "edges_provisional": [
            {
                "from": "opening",
                "to": "library",
                "kind": "travel",
                "confidence": "low",
                "evidence": "toc_adjacency",
            }
        ],
        "npc_roster": [
            {
                "npc_id": "npc-clerk",
                "names": ["Clerk"],
                "parse_state": "named_only",
            }
        ],
        "handouts": [],
        "threats": [],
        "conclusion_buckets": [],
    }
    base.update(overrides)
    return base


def test_init_put_skeleton_lookup_roundtrip(tmp_path: Path):
    root = assets.init_module_root(
        tmp_path,
        asset_root_id="demo-mod",
        identity={"canonical_module_id": "demo-mod", "canonical_title": "Demo"},
        file_sha256=FAKE_SHA,
    )
    assert (root / "identity.json").is_file()
    assert (root / "parse-queue.json").is_file()
    assert (root / "LICENSE-note.md").is_file()

    hit = assets.lookup_by_sha256(tmp_path, FAKE_SHA)
    assert hit is not None
    assert hit["asset_root_id"] == "demo-mod"

    result = assets.put_skeleton(tmp_path, "demo-mod", _minimal_skeleton())
    assert result["location_count"] == 2
    loaded = assets.get_skeleton(tmp_path, "demo-mod")
    assert loaded is not None
    assert loaded["start_candidates"] == ["opening"]
    assert assets.load_registry(tmp_path)["modules"]["demo-mod"]["parse_tier_max"] == 1


def test_validate_skeleton_rejects_unknown_edge_endpoint():
    sk = _minimal_skeleton()
    sk["edges_provisional"][0]["to"] = "nowhere"
    errors = assets.validate_skeleton(sk)
    assert any("unknown location" in e for e in errors)


def test_validate_skeleton_requires_start_in_locations():
    sk = _minimal_skeleton()
    sk["start_candidates"] = ["missing-start"]
    errors = assets.validate_skeleton(sk)
    assert any("start_candidates" in e for e in errors)


def test_put_page_idempotent_hash(tmp_path: Path):
    assets.init_module_root(
        tmp_path, asset_root_id="demo-mod", identity={}, file_sha256=FAKE_SHA,
    )
    text = "Handout line one.\n"
    first = assets.put_page(tmp_path, "demo-mod", 3, text)
    assert first["text_sha256"] == hashlib.sha256(text.encode()).hexdigest()
    page = assets.get_page(tmp_path, "demo-mod", 3)
    assert page is not None
    assert page["text"] == text
    assert page["meta"]["pdf_index"] == 3


def test_ensure_stub_and_enqueue_dedupe(tmp_path: Path):
    assets.init_module_root(
        tmp_path, asset_root_id="demo-mod", identity={}, file_sha256=FAKE_SHA,
    )
    a = assets.ensure_stub(
        tmp_path, "demo-mod", "location", "chapel",
        title="Chapel", reason="mention_from:opening",
    )
    assert a["created"] is True
    b = assets.ensure_stub(tmp_path, "demo-mod", "location", "chapel", title="Other")
    assert b["created"] is False
    assert b["entity"]["parse_state"] == "named_only"
    # deeper pack not overwritten by stub title change
    assert b["entity"].get("title") == "Chapel" or b["entity"].get("title") == "Chapel"

    j1 = assets.enqueue_job(
        tmp_path, "demo-mod", kind="deepen_location", target_id="chapel",
        priority=80, reason="enter",
    )
    assert j1["enqueued"] is True
    j2 = assets.enqueue_job(
        tmp_path, "demo-mod", kind="deepen_location", target_id="chapel", priority=90,
    )
    assert j2["deduped"] is True
    queue = assets.list_queue(tmp_path, "demo-mod")
    assert len(queue["pending"]) == 1


def test_sha256_collision_on_root_id_refused(tmp_path: Path):
    assets.init_module_root(
        tmp_path, asset_root_id="mod-a", identity={}, file_sha256=FAKE_SHA,
    )
    with pytest.raises(assets.ModuleAssetsError, match="already registered"):
        assets.init_module_root(
            tmp_path, asset_root_id="mod-b", identity={}, file_sha256=FAKE_SHA,
        )


def test_cli_init_and_lookup(tmp_path: Path):
    code = assets.main([
        "--workspace", str(tmp_path),
        "init",
        "--asset-root-id", "cli-mod",
        "--file-sha256", FAKE_SHA,
        "--identity-json", json.dumps({"canonical_module_id": "cli-mod"}),
    ])
    assert code == 0
    code = assets.main([
        "--workspace", str(tmp_path),
        "lookup",
        "--file-sha256", FAKE_SHA,
    ])
    assert code == 0


def test_resolve_asset_root_id_from_sha():
    assert assets.resolve_asset_root_id(file_sha256=FAKE_SHA) == f"pdf-{FAKE_SHA[:16]}"
    assert assets.resolve_asset_root_id(canonical_module_id="cold-harvest") == "cold-harvest"
