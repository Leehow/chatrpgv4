#!/usr/bin/env python3
"""Deterministic ten-family production RuleGraph build contract."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tests/fixtures/_build_rulegraph_production.py"
PACKAGE = ROOT / "plugins/coc-keeper/rulesets/coc7"
ONTOLOGY = ROOT / "plugins/coc-keeper/references/system-ontology-registry-v1.json"


def _load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def _generator():
    spec = importlib.util.spec_from_file_location("production_rulegraph_builder", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_production_build_replays_byte_identically():
    gen = _generator()
    graph, manifest = gen.build_production()
    assert gen._canonical_bytes(graph) == (PACKAGE / "rule-graph.json").read_bytes()
    assert gen._canonical_bytes(manifest) == (PACKAGE / "rule-graph-manifest.json").read_bytes()
    assert gen._canonical_bytes(gen.compose_ontology(graph)) == ONTOLOGY.read_bytes()


def test_production_graph_contains_ten_source_accepted_families():
    graph = _load(PACKAGE / "rule-graph.json")
    manifest = _load(PACKAGE / "rule-graph-manifest.json")
    assert set(graph["coverage"]) == {
        "chase", "combat", "core-check", "development", "healing",
        "magic", "psychology", "push-luck", "sanity", "social",
    }
    assert set(graph["coverage"].values()) == {"accepted"}
    assert manifest["family_coverage"] == graph["coverage"]
    assert len(manifest["shards"]) == 10
    assert all(len(row["shard_digest"]) == 64 for row in manifest["shards"])
    assert len(manifest["graph_content_digest"]) == 64
    assert manifest["review_status"] == "accepted"
    assert graph["family_runtime_ownership"]["healing"] == "graph"
    assert graph["legacy_surface_lifecycle"]["healing"] == "hidden"
    assert all(
        owner == "legacy"
        for family, owner in graph["family_runtime_ownership"].items()
        if family != "healing"
    )


def test_manifest_source_identities_are_bundle_level_and_source_bound():
    manifest = _load(PACKAGE / "rule-graph-manifest.json")
    assert len(manifest["source_bundles"]) == 5
    for row in manifest["source_bundles"]:
        assert row["source_id"].startswith("pdf:")
        assert len(row["bundle_sha256"]) == 64
        assert len(row["file_sha256"]) == 64
        assert row["file_sha256"] == (
            "a860499cf34b40cac385f51b6e667ab37ec0796c7329494def08c8b161fd71eb"
        )


def test_ontology_contains_only_resolvable_cross_layer_instances():
    graph = _load(PACKAGE / "rule-graph.json")
    registry = _load(ONTOLOGY)
    graph_nodes = {node["node_id"] for node in graph["nodes"]}
    refs = {row["ref_id"]: row for row in registry["references"]}
    assert not any(
        row["graph_id"] in {"graph:director:production", "graph:text:production"}
        for row in refs.values()
    )
    for row in refs.values():
        if row["graph_id"] == "graph:rule:coc7":
            assert row["semantic_id"] in graph_nodes
    for relation in registry["relations"]:
        assert relation["from_ref"] in refs
        assert relation["to_ref"] in refs
    kinds = {row["relation_kind"] for row in registry["relations"]}
    assert {"requires-live-state-fact", "invokes-capability", "may-emit-effect"} <= kinds
    assert any(
        row["relation_kind"] == "requires-live-state-fact"
        and row["to_ref"] == "ref:live-state:actor-conditions-dying"
        for row in registry["relations"]
    )
    assert any(
        row["relation_kind"] == "may-emit-effect"
        and row["to_ref"] == "ref:rule:coc7:effect-first-aid-stabilization"
        for row in registry["relations"]
    )
    graph_coverage = next(
        row for row in registry["coverage"] if row["graph_kind"] == "rule"
    )
    assert "ten source-accepted families" in graph_coverage["reason"]
    for kind in ("director", "text"):
        row = next(item for item in registry["coverage"] if item["graph_kind"] == kind)
        assert row["composition_status"] == "not-applicable"
