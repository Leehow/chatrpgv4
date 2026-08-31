from __future__ import annotations

from copy import deepcopy
import importlib.util
import json
from pathlib import Path

from jsonschema import Draft202012Validator


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "plugins/coc-keeper/scripts/coc_system_ontology.py"
CONTRACT_PATH = ROOT / "plugins/coc-keeper/references/system-ontology-contract-v1.json"
REGISTRY_PATH = ROOT / "plugins/coc-keeper/references/system-ontology-registry-v1.json"
RULE_GRAPH_PATH = ROOT / "plugins/coc-keeper/rulesets/coc7/rule-graph.json"
RULE_GRAPH_MANIFEST_PATH = (
    ROOT / "plugins/coc-keeper/rulesets/coc7/rule-graph-manifest.json"
)
RULE_GRAPH_SCRIPT = ROOT / "plugins/coc-keeper/scripts/coc_rule_graph.py"


def _load_module():
    spec = importlib.util.spec_from_file_location("coc_system_ontology_test", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


ontology = _load_module()
rule_graph = None
CONTRACT = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
REGISTRY = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))


def _codes(registry: dict) -> set[str]:
    return {row["code"] for row in ontology.validate_registry(registry, repo_root=ROOT)}


def _relation(registry: dict, relation_id: str) -> dict:
    return next(row for row in registry["relations"] if row["relation_id"] == relation_id)


def test_contract_and_production_registry_are_closed_and_valid():
    assert set(CONTRACT) == {
        "contract_id",
        "schema_version",
        "registry_contract_id",
        "semantic_id_pattern",
        "graph_kinds",
        "relation_kinds",
        "authority_laws",
        "registry_schema",
    }
    Draft202012Validator.check_schema(CONTRACT["registry_schema"])
    assert CONTRACT["registry_schema"]["additionalProperties"] is False
    for name in ("graph", "reference", "relation", "coverage"):
        assert CONTRACT["registry_schema"]["$defs"][name]["additionalProperties"] is False
    assert ontology.validate_registry(REGISTRY, repo_root=ROOT) == []


def test_contract_references_local_graph_ontologies_instead_of_copying_them():
    assert CONTRACT["graph_kinds"]["module"]["node_ontology_contract"] == (
        "coc.module-graph-contract.v3"
    )
    assert CONTRACT["graph_kinds"]["rule"]["node_ontology_contract"] == (
        "coc.rule-graph-contract.v1"
    )
    assert "node_kinds" not in CONTRACT
    assert "module" not in CONTRACT["registry_schema"]["$defs"]
    assert "rule" not in CONTRACT["registry_schema"]["$defs"]


def test_real_composition_links_module_healing_facts_capabilities_and_effects():
    relation_kinds = {row["relation_kind"] for row in REGISTRY["relations"]}
    assert {
        "uses-rule",
        "requires-live-state-fact",
        "invokes-capability",
        "may-emit-effect",
    } <= relation_kinds

    module_ref = next(
        row for row in REGISTRY["references"]
        if row["ref_id"] == "ref:module:the-haunting:chapel-weakened-floor"
    )
    assert module_ref == {
        "ref_id": "ref:module:the-haunting:chapel-weakened-floor",
        "graph_id": "graph:module:the-haunting",
        "semantic_id": "operation:the-haunting:chapel-weakened-floor",
        "reference_kind": "module-authored-operation",
        "node_kind": "authored-operation",
        "owner_node_id": "scene-chapel-of-contemplation-ruins",
        "operation_id": "descend-ruined-chapel-cellar",
        "module_rule_ref": "module.haunting.chapel_weakened_floor",
    }
    uses = _relation(
        REGISTRY, "relation:system:the-haunting-floor-uses-zero-hp-rule"
    )
    assert uses["to_ref"] == "ref:rule:coc7:zero-hit-points"

    graph = json.loads(RULE_GRAPH_PATH.read_text(encoding="utf-8"))
    node_ids = {row["node_id"] for row in graph["nodes"]}
    relation_tuples = {
        (row["relation_kind"], row["from_node_id"], row["to_node_id"])
        for row in graph["relations"]
    }
    expected = {
        (
            "decision:coc7:healing:first-aid-stabilization",
            "effect:coc7:healing:first-aid-stabilization",
        ),
        (
            "decision:coc7:healing:medicine-stabilization",
            "effect:coc7:healing:medicine-stabilization",
        ),
        (
            "decision:coc7:healing:weekly-major-wound-recovery",
            "effect:coc7:healing:weekly-hp-recovery",
        ),
    }
    for decision_id, effect_id in expected:
        assert effect_id in node_ids
        assert ("emits", decision_id, effect_id) in relation_tuples


def test_graph_owned_packaging_rebuilds_effect_projection_without_changing_shard_identity():
    global rule_graph
    if rule_graph is None:
        spec = importlib.util.spec_from_file_location("coc_rule_graph_system_test", RULE_GRAPH_SCRIPT)
        rule_graph = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(rule_graph)

    expected_graph = json.loads(RULE_GRAPH_PATH.read_text(encoding="utf-8"))
    expected_manifest = json.loads(RULE_GRAPH_MANIFEST_PATH.read_text(encoding="utf-8"))
    effect_ids = {
        "effect:coc7:healing:first-aid-stabilization",
        "effect:coc7:healing:medicine-stabilization",
        "effect:coc7:healing:weekly-hp-recovery",
    }
    emit_ids = {
        "relation:coc7:healing:fa-stab-emits",
        "relation:coc7:healing:med-stab-emits",
        "relation:coc7:healing:weekly-emits",
    }
    pre_projection = deepcopy(expected_graph)
    pre_projection["nodes"] = [
        row for row in pre_projection["nodes"] if row["node_id"] not in effect_ids
    ]
    pre_projection["relations"] = [
        row for row in pre_projection["relations"]
        if row["relation_id"] not in emit_ids
    ]
    rebuilt_graph, rebuilt_manifest = rule_graph.apply_healing_graph_package(
        pre_projection,
        expected_manifest,
        source_bundle_identity=expected_manifest["source_bundles"][0],
        reviewer_identity=expected_manifest["reviewer_identity"],
    )
    assert rebuilt_graph == expected_graph
    assert rebuilt_manifest["graph_content_digest"] == expected_manifest["graph_content_digest"]
    assert rebuilt_manifest["shards"] == expected_manifest["shards"]


def test_coverage_ledger_states_real_director_and_text_availability_gap():
    rows = {row["graph_kind"]: row for row in REGISTRY["coverage"]}
    assert set(rows) == {"module", "rule", "live-state", "execution", "director", "text"}
    assert rows["director"]["status"] == "absent-production-artifact"
    assert rows["text"]["status"] == "absent-production-artifact"
    assert "no production" in rows["director"]["reason"].lower()
    assert "no production" in rows["text"]["reason"].lower()


def test_validator_rejects_closed_schema_extension():
    broken = deepcopy(REGISTRY)
    broken["relations"][0]["authority"] = "execute"
    assert "closed_schema_violation" in _codes(broken)


def test_validator_detects_missing_target():
    broken = deepcopy(REGISTRY)
    broken["relations"][0]["to_ref"] = "ref:rule:coc7:missing"
    assert "missing_target" in _codes(broken)


def test_validator_detects_wrong_graph_kind():
    broken = deepcopy(REGISTRY)
    broken["relations"][0]["to_ref"] = "ref:module:the-haunting:chapel-weakened-floor"
    assert "wrong_target_graph_kind" in _codes(broken)


def test_validator_detects_invalid_module_to_rule_target():
    broken = deepcopy(REGISTRY)
    broken["relations"][0]["to_ref"] = (
        "ref:rule:coc7:effect-first-aid-stabilization"
    )
    assert "wrong_target_node_kind" in _codes(broken)


def test_validator_enforces_semantic_id_grammar():
    broken = deepcopy(REGISTRY)
    ref = next(
        row for row in broken["references"]
        if row["ref_id"] == "ref:live-state:actor-conditions-dying"
    )
    ref["semantic_id"] = "opaque id with spaces"
    assert "invalid_semantic_id" in _codes(broken)


def test_director_or_text_cannot_claim_execution_authority():
    for graph_kind in ("director", "text"):
        broken = deepcopy(REGISTRY)
        ref_id = f"ref:{graph_kind}:attempted-executor"
        graph_id = f"graph:{graph_kind}:production"
        broken["references"].append({
            "ref_id": ref_id,
            "graph_id": graph_id,
            "semantic_id": f"{graph_kind}:attempted-executor",
            "reference_kind": "artifact-node",
            "node_kind": "recommendation" if graph_kind == "director" else "text-fragment",
        })
        broken["relations"].append({
            "relation_id": f"relation:system:{graph_kind}-attempts-execution",
            "relation_kind": "invokes-capability",
            "from_ref": ref_id,
            "to_ref": "ref:execution:coc7:first-aid",
        })
        assert "authority_violation" in _codes(broken)


def test_validator_detects_cross_graph_authority_cycle():
    broken = deepcopy(REGISTRY)
    broken["references"].append({
        "ref_id": "ref:module:the-haunting:corbitt-undead-conclusion",
        "graph_id": "graph:module:the-haunting",
        "semantic_id": "conclusion-corbitt-is-undead-sorcerer",
        "reference_kind": "artifact-node",
        "node_kind": "conclusion",
    })
    broken["relations"].extend([
        {
            "relation_id": "relation:system:cycle-module-uses-rule",
            "relation_kind": "uses-rule",
            "from_ref": "ref:module:the-haunting:corbitt-undead-conclusion",
            "to_ref": "ref:rule:coc7:zero-hit-points",
        },
        {
            "relation_id": "relation:system:cycle-rule-requires-module",
            "relation_kind": "requires-module-fact",
            "from_ref": "ref:rule:coc7:zero-hit-points",
            "to_ref": "ref:module:the-haunting:corbitt-undead-conclusion",
        },
    ])
    assert "cross_graph_authority_cycle" in _codes(broken)
