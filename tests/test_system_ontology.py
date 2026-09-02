from __future__ import annotations

from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import shutil

from jsonschema import Draft202012Validator


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "plugins/coc-keeper/scripts/coc_system_ontology.py"
CONTRACT_PATH = ROOT / "plugins/coc-keeper/references/system-ontology-contract-v1.json"
REGISTRY_PATH = ROOT / "plugins/coc-keeper/references/system-ontology-registry-v1.json"
RULE_GRAPH_PATH = ROOT / "plugins/coc-keeper/rulesets/coc7/rule-graph.json"
RULE_CONTRACT_PATH = (
    ROOT / "plugins/coc-keeper/references/rule-graph-contract-v1.json"
)
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


def _append_weak_floor_rule_link(
    registry: dict,
    *,
    module_rule_ref: str = "module.haunting.chapel_weakened_floor",
    target_ref_id: str = "ref:rule:coc7:zero-hit-points",
    target_semantic_id: str = "rule:coc7:healing:zero-hit-points",
    target_node_kind: str = "rule",
) -> None:
    registry["references"].extend([
        {
            "ref_id": "ref:module:the-haunting:chapel-weakened-floor",
            "graph_id": "graph:module:the-haunting",
            "semantic_id": "operation:the-haunting:chapel-weakened-floor",
            "reference_kind": "module-authored-operation",
            "node_kind": "authored-operation",
            "owner_node_id": "scene-chapel-of-contemplation-ruins",
            "operation_id": "descend-ruined-chapel-cellar",
            "module_rule_ref": module_rule_ref,
        },
        {
            "ref_id": target_ref_id,
            "graph_id": "graph:rule:coc7",
            "semantic_id": target_semantic_id,
            "reference_kind": "artifact-node",
            "node_kind": target_node_kind,
        },
    ])
    registry["relations"].append({
        "relation_id": "relation:system:the-haunting-floor-uses-rule",
        "relation_kind": "uses-rule",
        "from_ref": "ref:module:the-haunting:chapel-weakened-floor",
        "to_ref": target_ref_id,
    })


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


def test_real_composition_links_healing_facts_capabilities_and_effects():
    relation_kinds = {row["relation_kind"] for row in REGISTRY["relations"]}
    assert {
        "requires-live-state-fact",
        "invokes-capability",
        "may-emit-effect",
    } <= relation_kinds

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
    """DirectorGraph landed in slice D1/D2; TextGraph is still absent.

    The ledger's job is to state each gap honestly, so this test tracks the
    real availability rather than pinning a snapshot: director is now a
    production artifact grounded in the coc7 RuleGraph, and text remains an
    admitted absence.
    """
    rows = {row["graph_kind"]: row for row in REGISTRY["coverage"]}
    assert set(rows) == {"module", "rule", "live-state", "execution", "director", "text"}
    assert rows["director"]["status"] == "production-linked"
    assert rows["director"]["composition_status"] == "instance-linked"
    # The reason must keep naming why grounding stops where it does.
    assert "unresolved" in rows["director"]["reason"].lower()
    # TextGraph T0-T5 (5427bd26) made the text layer a production artifact.
    # Its measured outcome is that no RuleGraph effect has a rendering path,
    # so it is production-linked with no proven instance — not absent.
    assert rows["text"]["status"] == "production-linked"
    assert rows["text"]["composition_status"] == "no-proven-instance"
    assert rows["module"]["composition_status"] == "no-proven-instance"
    assert not any(
        row["relation_kind"] == "uses-rule" for row in REGISTRY["relations"]
    )
    assert "no rendering path" in rows["text"]["reason"].lower()


# --- the recorded Module-to-Rule alignment gap (slice W3) ---------------


def _load_alignment_ledger_generator():
    spec = importlib.util.spec_from_file_location(
        "gen_module_rule_alignment_ledger_test",
        ROOT / "scripts" / "gen_module_rule_alignment_ledger.py",
    )
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_module_rule_alignment_ledger_matches_the_artifacts():
    """Regenerate and compare, so the recorded gap cannot rot."""
    generator = _load_alignment_ledger_generator()
    on_disk = (
        ROOT / "docs/status/module-rule-alignment-haunting.md"
    ).read_text("utf-8")
    assert generator.render(generator.build()) == on_disk


def test_module_alignment_measurement_records_seven_module_specific_identities():
    data = _load_alignment_ledger_generator().build()
    assert data["unique_identities"] == 7
    assert data["module_graph_occurrence_total"] == 11
    # No authored identity is exactly equal to a RuleGraph semantic id...
    assert data["exact_matches"] == []
    # ...so no uses-rule edge is drawn; every verdict is module-specific.
    assert data["uses_rule_edges"] == 0
    assert all(not row["exact_rule_graph_match"] for row in data["identities"])
    # The authored identities are runtime-pinned provenance, not free labels:
    # five of seven double as rules-json source_rule_id rows.
    assert len(data["provenance_overlap"]) == 5


def test_module_coverage_reason_points_at_the_alignment_ledger():
    rows = {row["graph_kind"]: row for row in REGISTRY["coverage"]}
    module = rows["module"]
    assert module["composition_status"] == "no-proven-instance"
    assert "module-rule-alignment-haunting.md" in module["reason"]
    assert "module-specific" in module["reason"]
    # The measured outcome: no uses-rule relation exists in the registry.
    assert not any(
        row["relation_kind"] == "uses-rule" for row in REGISTRY["relations"]
    )


def test_director_graph_is_registered_as_an_advisory_production_artifact():
    graphs = {row["graph_id"]: row for row in REGISTRY["graphs"]}
    director = graphs["graph:director:production"]
    assert director["availability"] == "production-artifact"
    assert director["authority_plane"] == "advisory"
    assert director["ontology_contract"] == "coc.director-graph.v1"
    assert (ROOT / director["artifact_path"]).is_file()
    # Advisory means read-only downstream: the Director may only be grounded
    # by other graphs, never grant execution or state authority.
    assert not any(
        row["relation_kind"] not in {"grounded-by"}
        and row["from_ref"].startswith("ref:director:")
        for row in REGISTRY["relations"]
    )


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
    # Pick the relation by intent, not by position: a live-state requirement
    # retargeted at a RuleGraph ref must be rejected as the wrong graph kind.
    relation = next(
        row for row in broken["relations"] if row["relation_kind"] == "requires-live-state-fact"
    )
    relation["to_ref"] = "ref:rule:coc7:effect-first-aid-stabilization"
    assert "wrong_target_graph_kind" in _codes(broken)


def test_validator_detects_invalid_module_to_rule_target():
    broken = deepcopy(REGISTRY)
    _append_weak_floor_rule_link(
        broken,
        target_ref_id="ref:rule:coc7:wrong-effect-target",
        target_semantic_id="effect:coc7:healing:first-aid-stabilization",
        target_node_kind="effect",
    )
    assert "wrong_target_node_kind" in _codes(broken)


def test_current_weak_floor_operation_cannot_claim_zero_hp_rule_binding():
    broken = deepcopy(REGISTRY)
    _append_weak_floor_rule_link(broken)
    assert "module_rule_binding_mismatch" in _codes(broken)


def test_explicit_module_rule_ref_to_rulegraph_semantic_id_is_valid(tmp_path: Path):
    synthetic_id = "rule:coc7:module:the-haunting:chapel-weakened-floor"
    module_relative = Path(
        "plugins/coc-keeper/references/starter-scenarios/the-haunting/module-graph.json"
    )
    rule_relative = Path("plugins/coc-keeper/rulesets/coc7/rule-graph.json")
    contract_relative = Path(
        "plugins/coc-keeper/references/rule-graph-contract-v1.json"
    )
    resolver_relative = Path("plugins/coc-keeper/rulesets/coc7/resolver.py")
    director_relative = Path("plugins/coc-keeper/references/director-graph.json")

    text_relative = Path("plugins/coc-keeper/references/text-graph.json")
    for relative in (
        module_relative, rule_relative, contract_relative, resolver_relative,
        director_relative,
    ):
        (tmp_path / relative).parent.mkdir(parents=True, exist_ok=True)
    # The registry now declares a production DirectorGraph, so the synthetic
    # repository must carry one for artifact resolution to succeed.
    shutil.copy2(ROOT / director_relative, tmp_path / director_relative)

    (tmp_path / text_relative).parent.mkdir(parents=True, exist_ok=True)

    shutil.copy2(ROOT / text_relative, tmp_path / text_relative)
    module_graph = {
        "contract_id": "coc.module-graph.v3",
        "schema_version": 3,
        "nodes": [{
            "node_id": "scene-chapel-of-contemplation-ruins",
            "node_kind": "scene",
            "properties": {
                "runtime_projection": {
                    "record": {
                        "affordances": [{
                            "id": "descend-ruined-chapel-cellar",
                            "authored_operation": {
                                "payload": {"rule_ref": synthetic_id},
                            },
                        }],
                    },
                },
            },
        }],
    }
    (tmp_path / module_relative).write_text(
        json.dumps(module_graph, ensure_ascii=False), encoding="utf-8"
    )
    graph = json.loads(RULE_GRAPH_PATH.read_text(encoding="utf-8"))
    template = deepcopy(next(
        row for row in graph["nodes"]
        if row["node_id"] == "rule:coc7:healing:zero-hit-points"
    ))
    template["node_id"] = synthetic_id
    template["name"] = "Synthetic explicit weakened-floor rule binding"
    graph["nodes"].append(template)
    (tmp_path / rule_relative).write_text(
        json.dumps(graph, ensure_ascii=False), encoding="utf-8"
    )
    shutil.copy2(RULE_CONTRACT_PATH, tmp_path / contract_relative)
    (tmp_path / resolver_relative).write_text(
        "def public_api_index(): return {}\n", encoding="utf-8"
    )

    candidate = deepcopy(REGISTRY)
    _append_weak_floor_rule_link(
        candidate,
        module_rule_ref=synthetic_id,
        target_ref_id="ref:rule:coc7:synthetic-chapel-weakened-floor",
        target_semantic_id=synthetic_id,
    )
    module_coverage = next(
        row for row in candidate["coverage"] if row["graph_kind"] == "module"
    )
    module_coverage["composition_status"] = "instance-linked"
    module_coverage["reason"] = "Synthetic explicit binding fixture."
    assert ontology.validate_registry(candidate, repo_root=tmp_path) == []


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
    _append_weak_floor_rule_link(broken)
    broken["relations"].extend([
        {
            "relation_id": "relation:system:cycle-rule-requires-module",
            "relation_kind": "requires-module-fact",
            "from_ref": "ref:rule:coc7:zero-hit-points",
            "to_ref": "ref:module:the-haunting:chapel-weakened-floor",
        },
    ])
    assert "cross_graph_authority_cycle" in _codes(broken)
