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
ARCHIVE = ROOT / "plugins/coc-keeper/references/mcp-operation-contracts.json"


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
    package = _load(PACKAGE / "manifest.json")
    expected_owners = {family: "legacy" for family in graph["coverage"]}
    expected_surfaces = {family: "visible" for family in graph["coverage"]}
    for row in package.get("rule_families") or []:
        expected_owners[row["family_id"]] = row["runtime_owner"]
        expected_surfaces[row["family_id"]] = row["legacy_surface"]
    assert graph["family_runtime_ownership"] == expected_owners
    assert graph["legacy_surface_lifecycle"] == expected_surfaces


def test_social_failure_continues_as_push_is_evidence_bound():
    """A failed social check continues as a pushed roll, stated in the source.

    Runtime already reaches the pushed roll through the canonical failed-check
    grant, so this edge changes no behavior; it closes an Ontology gap where
    the source graph described thirteen continuations and omitted this one.

    The edge is only worth having because it is evidence-bound. The rulebook
    states the continuation once per interpersonal skill this family models --
    Charm (p70), Fast Talk (p75), Intimidate (p77), Persuade (p82) -- rather
    than leaving it to the general "any failed skill roll may be pushed" rule,
    so the relation cites those per-skill spans and nothing else.
    """
    graph = _load(PACKAGE / "rule-graph.json")
    relations = {row["relation_id"]: row for row in graph["relations"]}
    edge = relations["relation:coc7:social:failure-continues-as-push"]
    assert edge["relation_kind"] == "continues-as"
    assert edge["from_node_id"] == "decision:coc7:social:adjudicate-difficulty"
    assert edge["to_node_id"] == "continuation:coc7:push-luck:after-fail-push"

    # Both endpoints must be real nodes; a continuation edge that dangles
    # would be worse than the gap it closes.
    node_ids = {row["node_id"] for row in graph["nodes"]}
    assert edge["from_node_id"] in node_ids
    assert edge["to_node_id"] in node_ids

    # Every cited span must come from the accepted social shard's own evidence
    # binding, so the edge can never be justified by an invented span id.
    shard = _load(
        PACKAGE / "rule-graph-candidates/source-stage1/accepted/social/accepted-shard.json"
    )
    bound = {row["span_id"] for row in shard["evidence_binding"]["spans"]}
    assert edge["evidence_span_ids"]
    assert set(edge["evidence_span_ids"]) <= bound
    # All four modeled interpersonal skills carry their own push guidance.
    pages = {int(span.rsplit("-page-", 1)[1].split("-block-")[0])
             for span in edge["evidence_span_ids"]}
    assert {70, 75, 77, 82} <= pages


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


def test_canonical_rules_roll_summary_requires_any_or_all_mode():
    archive = _load(ARCHIVE)
    operation = archive["operations"]["rules.roll"]
    for field in ("summary", "description"):
        text = operation[field]
        assert "must choose any or all" in text
        assert "succeeds when any target succeeds" not in text
