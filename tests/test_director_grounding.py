"""DirectorGraph grounding gap ledger and W2 grounded-by gates.

Spec: docs/specs/pi-coc-cross-graph-wiring.md §5 W2

These tests protect what slice W2 exists to create: a regenerated, not
hand-edited, measurement of which doctrine nodes reach the ten-family
RuleGraph, and the rule that every drawn ``grounded-by`` edge resolves to a
real RuleGraph node. No pre-existing test assertion is re-stated here; the
D-series behavioural and accountability gates stay in test_director_graph.py.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REFERENCES = ROOT / "plugins" / "coc-keeper" / "references"
RULE_GRAPH_PATH = ROOT / "plugins" / "coc-keeper" / "rulesets" / "coc7" / "rule-graph.json"
REGISTRY_PATH = REFERENCES / "system-ontology-registry-v1.json"
GRAPH_PATH = REFERENCES / "director-graph.json"
LEDGER_PATH = ROOT / "docs" / "status" / "director-grounding-gap.md"


def _load(name: str, relative: str):
    path = ROOT / relative
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def _registry() -> dict:
    return json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))


def _rule_graph() -> dict:
    return json.loads(RULE_GRAPH_PATH.read_text(encoding="utf-8"))


def _graph() -> dict:
    return json.loads(GRAPH_PATH.read_text(encoding="utf-8"))


# --- the recorded gap -----------------------------------------------------

def test_the_grounding_ledger_matches_the_artifacts():
    """Regenerate and compare, so the recorded gap cannot rot."""
    generator = _load(
        "gen_director_grounding_ledger_test",
        "scripts/gen_director_grounding_ledger.py",
    )
    on_disk = LEDGER_PATH.read_text(encoding="utf-8")
    assert generator.render(generator.build()) == on_disk


def test_every_doctrine_node_has_a_recorded_reason_class():
    """A new doctrine value cannot slip past the grounding judgment."""
    data = _load(
        "gen_director_grounding_ledger_completeness",
        "scripts/gen_director_grounding_ledger.py",
    ).build()
    assert data["doctrine_total"] == len(data["rows"])
    classified = sum(data["counts"].values())
    assert classified == data["doctrine_total"]


def test_no_resolvable_doctrine_remains_after_w2():
    """W2 drew every edge whose target exists; the class must stay empty.

    A non-zero count means some doctrine node has a real RuleGraph target
    but no registry edge — draw the edge instead of editing this test.
    """
    data = _load(
        "gen_director_grounding_ledger_resolvable",
        "scripts/gen_director_grounding_ledger.py",
    ).build()
    assert data["counts"]["resolvable"] == 0


# --- every drawn edge resolves ---------------------------------------------

def test_every_director_grounded_by_edge_resolves_in_the_rule_graph():
    """The TextGraph spec 14/15/16 judgement applies here: no dangling edge."""
    registry = _registry()
    rule_nodes = {n["node_id"]: n for n in _rule_graph()["nodes"]}
    semantics = {row["ref_id"]: row for row in registry["references"]}
    edges = [
        row for row in registry["relations"]
        if row["relation_kind"] == "grounded-by"
        and row["from_ref"].startswith("ref:director:")
    ]
    assert edges, "the director graph must carry grounded-by edges"
    for row in edges:
        target_ref = semantics.get(row["to_ref"])
        assert target_ref is not None, row["to_ref"]
        target_node = rule_nodes.get(target_ref["semantic_id"])
        assert target_node is not None, (
            f"{row['relation_id']} targets {target_ref['semantic_id']}, "
            "which does not exist in rule-graph.json"
        )
        assert target_node["node_kind"] == target_ref["node_kind"], row["to_ref"]
        assert target_node["node_kind"] in {"decision", "effect", "rule"}, (
            f"{row['relation_id']} targets a non-groundable node kind"
        )


def test_director_artifact_grounded_by_targets_exist_in_the_rule_graph():
    """The artifact's own grounded_by lists must never name a missing node."""
    rule_ids = {n["node_id"] for n in _rule_graph()["nodes"]}
    for node in _graph()["nodes"]:
        for target in node.get("grounded_by") or []:
            assert target in rule_ids, f"{node['node_id']} -> {target}"


# --- the W2 edge set -------------------------------------------------------

W2_RELATIONS = {
    "relation:system:director-pushed-fail-nudge-grounded-pushed-roll": (
        "ref:director:pushed-fail-nudge",
        "ref:rule:coc7:decision-coc7-push-luck-pushed-roll",
    ),
    "relation:system:director-combat-flee-cast-grounded-combat-attack": (
        "ref:director:combat-flee-cast-intent",
        "ref:rule:coc7:decision-coc7-combat-attack",
    ),
    "relation:system:director-combat-flee-cast-grounded-combat-flee": (
        "ref:director:combat-flee-cast-intent",
        "ref:rule:coc7:decision-coc7-combat-flee",
    ),
    "relation:system:director-combat-flee-cast-grounded-cast-spell": (
        "ref:director:combat-flee-cast-intent",
        "ref:rule:coc7:decision-coc7-magic-cast-spell",
    ),
}


def test_the_w2_edges_are_present_and_unchanged():
    registry = _registry()
    relations = {row["relation_id"]: row for row in registry["relations"]}
    for relation_id, (from_ref, to_ref) in W2_RELATIONS.items():
        row = relations.get(relation_id)
        assert row is not None, relation_id
        assert row["relation_kind"] == "grounded-by"
        assert (row["from_ref"], row["to_ref"]) == (from_ref, to_ref)


def test_the_w2_edges_do_not_move_any_doctrine_value():
    """Bit equivalence: grounding adds edges, never retunes values."""
    by_id = {node["node_id"]: node for node in _graph()["nodes"]}
    nudge = by_id["scoring-rule:pressure:pushed-fail-nudge"]
    assert nudge["properties"]["value"] == 0.1
    assert nudge["evidence_class"] == "rule-derived"
    handoff = by_id["scoring-rule:subsystem:combat-flee-cast-intent"]
    assert handoff["properties"]["value"] == 0.9
    # The score is a pacing preference, not a rulebook value: the edge names
    # the handoff targets without reclassifying the node.
    assert handoff["evidence_class"] == "authored-doctrine"
    assert handoff["grounded_by"] == [
        "decision:coc7:combat:attack",
        "decision:coc7:combat:flee",
        "decision:coc7:magic:cast-spell",
    ]


def test_director_coverage_reason_points_at_the_ledger():
    registry = _registry()
    coverage = next(
        row for row in registry["coverage"] if row["graph_kind"] == "director"
    )
    assert "director-grounding-gap.md" in coverage["reason"]
    # The pre-cutover claim died with W2; it must not come back.
    assert "still unresolved in the RuleGraph" not in coverage["reason"]
