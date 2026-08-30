#!/usr/bin/env python3
"""Source-reviewed healing RuleGraph production-promotion contract."""
from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / "plugins" / "coc-keeper" / "rulesets" / "coc7"
EXPECTED_BUNDLE_SHA256 = (
    "96f09b55e1e9cbe65139e2bbe0498079a063b18140a93b1d94740d15fc25d2d5"
)
WINDOW_EXCEPTION = "exception:coc7:healing:first-aid-window-uncompiled"
TEAMWORK_EXCEPTION = "exception:coc7:healing:first-aid-teamwork-uncompiled"
GENERATOR = ROOT / "tests" / "fixtures" / "_gen_healing_rulegraph_promotion.py"


def _read(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def _load_generator():
    spec = importlib.util.spec_from_file_location(
        "gen_healing_rulegraph_promotion_tests", GENERATOR,
    )
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_packaged_healing_is_source_reviewed_and_graph_owned():
    graph = _read(PACKAGE / "rule-graph.json")
    manifest = _read(PACKAGE / "rule-graph-manifest.json")

    assert graph["family_runtime_ownership"]["healing"] == "graph"
    assert graph["legacy_surface_lifecycle"]["healing"] == "hidden"
    assert manifest["family_coverage"]["healing"] == "accepted"
    assert manifest["family_promotion_eligibility"]["healing"] == {
        "promotion_eligible": True,
        "runtime_ownership": "graph",
    }
    assert manifest["review_status"] == "accepted"
    assert manifest["reviewer_identity"] == (
        "codex-main-healing-source-review-20260830"
    )
    assert manifest["source_bundles"] == [{
        "source_id": "pdf:coc7-keeper-rulebook-40th",
        "bundle_sha256": EXPECTED_BUNDLE_SHA256,
        "file_sha256": (
            "a860499cf34b40cac385f51b6e667ab37ec0796c7329494def08c8b161fd71eb"
        ),
    }]

    nodes = {row["node_id"]: row for row in graph["nodes"]}
    assert WINDOW_EXCEPTION not in nodes
    assert TEAMWORK_EXCEPTION not in nodes
    condition = nodes["condition:coc7:healing:first-aid-ordinary-eligible"]
    assert condition["hard_gate"] is True
    assert condition["properties"]["expression"] == {
        "op": "all",
        "of": [
            {
                "op": "not",
                "of": {
                    "op": "exists",
                    "path": "actor.conditions.dying",
                },
            },
            {
                "op": "lte",
                "path": "time.minutes_since_injury",
                "value": 60,
            },
        ],
    }

    for decision_ref in (
        "decision:coc7:healing:first-aid-ordinary",
        "decision:coc7:healing:first-aid-stabilization",
    ):
        slots = {
            row["name"]: row["ownership"]
            for row in nodes[decision_ref]["properties"]["implementation"]
            ["payload_slots"]
        }
        assert slots["assistant_skill_value"] == "host-locked"
        assert slots["assistant_rescuer_id"] == "host-locked"

    assert not any(
        row.get("code") == "executor_capability_gap"
        for row in manifest["findings"]
    )


def test_packaged_healing_rules_explicitly_invoke_each_decision_capability():
    graph = _read(PACKAGE / "rule-graph.json")
    nodes = {row["node_id"]: row for row in graph["nodes"]}
    relations = graph["relations"]
    healing_decisions = [
        row for row in graph["nodes"]
        if row.get("node_kind") == "decision"
        and (row.get("properties") or {}).get("family_id") == "healing"
    ]
    assert healing_decisions
    for decision in healing_decisions:
        decision_ref = decision["node_id"]
        capabilities = {
            row["to_node_id"]
            for row in relations
            if row.get("relation_kind") == "invokes"
            and row.get("from_node_id") == decision_ref
            and nodes.get(row.get("to_node_id"), {}).get("node_kind")
            == "capability"
        }
        assert len(capabilities) == 1, decision_ref
        capability_ref = next(iter(capabilities))
        rule_refs = {
            row["from_node_id"]
            for row in relations
            if row.get("relation_kind") == "invokes"
            and row.get("to_node_id") == capability_ref
            and nodes.get(row.get("from_node_id"), {}).get("node_kind") == "rule"
        }
        assert rule_refs, decision_ref
        assert all(nodes[rule_ref].get("evidence_span_ids") for rule_ref in rule_refs)


def test_external_source_bundle_rebuilds_production_artifacts_byte_exactly():
    raw = os.environ.get("COC_HEALING_RULE_GRAPH_SOURCE_BUNDLE")
    if not raw:
        pytest.skip("set COC_HEALING_RULE_GRAPH_SOURCE_BUNDLE for regeneration")
    generator = _load_generator()
    graph, manifest = generator.build_package(Path(raw).expanduser().resolve())
    assert generator._canonical_bytes(graph) == (
        PACKAGE / "rule-graph.json"
    ).read_bytes()
    assert generator._canonical_bytes(manifest) == (
        PACKAGE / "rule-graph-manifest.json"
    ).read_bytes()
    assert {
        ref["pdf_index"]
        for span in generator._prepare(Path(raw).expanduser().resolve())[
            "evidence_binding"
        ]["spans"]
        for ref in [span["source_ref"]]
    } == {131, 132, 133}
