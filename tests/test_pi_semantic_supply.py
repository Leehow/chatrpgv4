"""Canonical vertical coverage for Pi active-scene semantic source supply."""
from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path

import pytest


SCRIPTS = Path("plugins/coc-keeper/scripts")


def _load(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


assets = _load("semantic_supply_assets", "coc_module_assets.py")
project = _load("semantic_supply_project", "coc_module_project.py")
state = _load("semantic_supply_state", "coc_state.py")
toolbox = _load("semantic_supply_toolbox", "coc_toolbox.py")


@pytest.fixture(autouse=True)
def _disable_worker(monkeypatch):
    monkeypatch.setenv("COC_DISABLE_QUEUE_WORKER", "1")


def _workspace(tmp_path: Path) -> tuple[Path, str, str]:
    campaign_id, root_id = "semantic-supply", "synthetic-source"
    state.create_campaign(tmp_path, campaign_id, "Semantic Supply", play_language="zh-Hans")
    pdf = tmp_path / "source.pdf"
    pdf.write_bytes(b"%PDF synthetic source")
    page = b"# Synthetic source\n\nAccepted page.\n"
    bundle = tmp_path / "bundle"
    bundle.mkdir()
    (bundle / "page.md").write_bytes(page)
    (bundle / "manifest.json").write_text(json.dumps({
        "schema_version": 1,
        "producer": "codex-pdf-skill",
        "source": {
            "source_id": "pdf:synthetic-source", "title": "Synthetic Source",
            "path": str(pdf), "file_sha256": hashlib.sha256(pdf.read_bytes()).hexdigest(),
            "page_count": 1,
        },
        "pages": [{
            "pdf_index": 0, "markdown_path": "page.md",
            "text_sha256": hashlib.sha256(page).hexdigest(),
            "review_state": "manual_accepted", "parse_confidence": 1.0,
            "grep_anchors": ["Accepted page."],
        }],
    }), encoding="utf-8")
    assets.register_source_bundle(
        tmp_path, bundle, asset_root_id=root_id,
        module_identity={"canonical_module_id": root_id},
    )
    identity = json.loads((assets.assets_root(tmp_path) / root_id / "identity.json").read_text())
    skeleton = {
        "schema_version": 1, "parse_tier": 1,
        "module_identity": {"canonical_module_id": root_id, "canonical_title": "Synthetic Source"},
        "structure_type": "branching_investigation", "source": identity["source"],
        "start_candidates": ["scene-a"], "finale_buckets": [],
        "locations": [{
            "location_id": "scene-a", "title": "Scene A", "parse_state": "named_only",
            "source_span": {"pdf_index_start": 0, "pdf_index_end": 0},
        }],
        "edges_provisional": [], "npc_roster": [], "handouts": [], "threats": [],
        "conclusion_buckets": [], "mechanics_locator_pass_status": "pending",
        "start_clock_status": "unresolved",
    }
    assets.put_skeleton(tmp_path, root_id, skeleton)
    project.project_skeleton_to_campaign(tmp_path, campaign_id, root_id)
    campaign_dir = tmp_path / ".coc" / "campaigns" / campaign_id
    scenario_path = campaign_dir / "scenario" / "scenario.json"
    scenario = json.loads(scenario_path.read_text())
    scenario.update({"progressive_asset_root_id": root_id, "source_cache_asset_root_id": root_id})
    scenario_path.write_text(json.dumps(scenario), encoding="utf-8")
    world_path = campaign_dir / "save" / "world-state.json"
    world = json.loads(world_path.read_text())
    world["active_scene_id"] = "scene-a"
    world_path.write_text(json.dumps(world), encoding="utf-8")
    return tmp_path, campaign_id, root_id


def _write_resolved_section(root: Path, root_id: str, section_id: str, body: str) -> None:
    head_path = assets.section_pack_path(root, root_id, section_id)
    body_path = assets.section_body_path(root, root_id, section_id)
    head_path.parent.mkdir(parents=True, exist_ok=True)
    body_path.parent.mkdir(parents=True, exist_ok=True)
    head_path.write_text(json.dumps({
        "section_id": section_id, "source_refs": [{"source_id": "pdf:synthetic-source", "pdf_index": 0}],
    }), encoding="utf-8")
    body_path.write_text(body, encoding="utf-8")


def test_pi_scene_semantic_supply_uses_canonical_materialization_and_secret_projection(tmp_path: Path):
    root, campaign_id, root_id = _workspace(tmp_path)
    index = {
        "schema_version": 1,
        "sections": [
            {
                "section_id": "loc-current", "audience": "keeper_only", "timing": "on_demand",
                "payload": "narrative", "parse_state": "indexed",
                "binding": {"kind": "entity", "entity_kind": "location", "entity_ids": ["scene-a"]},
            },
            {
                "section_id": "global-opening", "audience": "keeper_only", "timing": "opening",
                "payload": "narrative", "parse_state": "resolved",
                "binding": {"kind": "global", "entity_kind": None, "entity_ids": []},
            },
            {
                "section_id": "other-location", "audience": "keeper_only", "timing": "on_demand",
                "payload": "narrative", "parse_state": "indexed",
                "binding": {"kind": "entity", "entity_kind": "location", "entity_ids": ["scene-b"]},
            },
        ],
    }
    assets.section_index_path(root, root_id).write_text(json.dumps(index), encoding="utf-8")
    secret_body = "keeper-only synthetic source body"
    _write_resolved_section(root, root_id, "global-opening", secret_body)

    first = toolbox.run_tool("progressive.on_enter_scene", root, campaign_id, {
        "scene_id": "scene-a", "decision_id": "enter-a",
    })
    second = toolbox.run_tool("progressive.on_enter_scene", root, campaign_id, {
        "scene_id": "scene-a", "decision_id": "enter-a-repeat",
    })
    assert first["ok"] is True and second["ok"] is True
    rows = first["data"]["materialization"]["section_materialization"]
    assert {row["section_id"] for row in rows} == {"loc-current", "global-opening"}
    assert all(secret_body not in json.dumps(value) for value in (first, second))
    queue = assets.list_queue(root, root_id)
    extracts = [
        row for row in queue["pending"] if row.get("kind") == assets.EXTRACT_SECTION_KIND
    ]
    assert [row["target_id"] for row in extracts] == ["loc-current"]
    assert assets.get_entity(root, root_id, "location", "scene-a")["parse_state"] == "named_only"

    stale = toolbox.run_tool("progressive.on_enter_scene", root, campaign_id, {
        "scene_id": "scene-b", "decision_id": "enter-stale",
    })
    assert stale["ok"] is False
    assert stale["error"]["code"] == "stale_scene_id"

    briefing = toolbox.run_tool("secrets.briefing", root, campaign_id, {
        "scope": "active_scene", "scene_id": "scene-a",
    })
    assert briefing["ok"] is True
    assert briefing["data"]["source_sections"] == [{
        "section_id": "global-opening", "body": secret_body,
        "source_refs": [{"source_id": "pdf:synthetic-source", "pdf_index": 0}], "secret": True,
    }]

    scene = toolbox.run_tool("scene.context", root, campaign_id, {})
    assert scene["ok"] is True
    assert secret_body not in json.dumps(scene)
    assert secret_body not in json.dumps(scene["data"].get("source_material") or {})


def test_active_scene_source_sections_are_stably_count_and_byte_bounded(tmp_path: Path):
    root, campaign_id, root_id = _workspace(tmp_path)
    sections = []
    for index in range(10):
        section_id = f"global-{index:02d}"
        sections.append({
            "section_id": section_id, "audience": "keeper_only", "timing": "opening",
            "payload": "narrative", "parse_state": "resolved",
            "binding": {"kind": "global", "entity_kind": None, "entity_ids": []},
        })
        _write_resolved_section(root, root_id, section_id, "x" * 4096)
    assets.section_index_path(root, root_id).write_text(
        json.dumps({"schema_version": 1, "sections": list(reversed(sections))}),
        encoding="utf-8",
    )

    briefing = toolbox.run_tool("secrets.briefing", root, campaign_id, {
        "scope": "active_scene", "scene_id": "scene-a",
    })

    assert briefing["ok"] is True
    delivered = briefing["data"]["source_sections"]
    budget = briefing["data"]["source_sections_budget"]
    assert [row["section_id"] for row in delivered] == sorted(
        row["section_id"] for row in delivered
    )
    assert len(delivered) == budget["returned_count"] <= budget["max_count"]
    assert sum(len(row["body"].encode("utf-8")) for row in delivered) == budget[
        "returned_body_bytes"
    ] <= budget["max_body_bytes"]
    assert budget["truncated"] is True
    assert budget["omitted_count"] > 0
    scene = toolbox.run_tool("scene.context", root, campaign_id, {})
    assert "x" * 4096 not in json.dumps(scene)
