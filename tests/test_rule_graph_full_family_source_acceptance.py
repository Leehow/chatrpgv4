"""Family-local source acceptance without shared production graph cutover."""
from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
GENERATOR = ROOT / "tests" / "fixtures" / "_accept_coc7_psychology_combat_sanity.py"
FAMILIES = (
    ROOT / "plugins" / "coc-keeper" / "rulesets" / "coc7"
    / "rule-graph-candidates" / "source-stage1" / "families"
)
RULE_GRAPH_CONTRACT = (
    ROOT / "plugins" / "coc-keeper" / "references" / "rule-graph-contract-v1.json"
)


def _load_generator():
    spec = importlib.util.spec_from_file_location("full_family_source_acceptance", GENERATOR)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


gen = _load_generator()


def _read(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def _family(family: str) -> tuple[dict, dict, dict]:
    root = FAMILIES / family
    return (
        _read(root / "candidate.json"),
        _read(root / "accepted-shard.json"),
        _read(root / "source-review.json"),
    )


def test_psychology_is_source_accepted_with_complete_applicability_ledger():
    candidate, envelope, review = _family("psychology")
    shard = envelope["accepted_shard"]
    assert envelope["contract_id"] == "coc.rule-graph-accepted-evidence.v1"
    assert candidate["coverage"] == {"psychology": "accepted"}
    assert shard["coverage"] == {"psychology": "accepted"}
    assert review["coverage"] == "accepted"
    assert review["unresolved_applicable_rules"] == []
    assert review["runtime_integration_blockers"] == []
    assert review["accepted_shard_digest"] == shard["receipt"]["shard_sha256"]
    assert review["accepted_shard_digest"] == (
        "803da1b867ff4deed3217c4fda63330008da970944d73935b26704514103988d"
    )
    assert review["reviewer_identity"] == (
        "codex-worker-psychology-target-review-20260831-v2"
    )
    assert review["reviewer_identity"] != gen.__name__
    assert review["source"] == {
        "source_id": gen.SOURCE_ID,
        "file_sha256": gen.FILE_SHA256,
        "bundle_sha256": gen.FAMILY_CONFIG["psychology"]["bundle_sha256"],
        "pdf_indices": [83, 84, 215],
    }
    expected = {
        f"rule:coc7:psychology:{slug}" for slug, _name, _group in gen.RULES["psychology"]
    }
    assert {row["rule_id"] for row in review["applicability_ledger"]} == expected
    assert all(row["status"] == "accepted" for row in review["applicability_ledger"])
    assert {node["node_id"] for node in candidate["nodes"] if node["node_kind"] == "rule"} == expected
    assert not any(node["node_kind"] == "exception" for node in candidate["nodes"])
    assert all(node.get("evidence_span_ids") for node in candidate["nodes"])
    decisions = {
        node["node_id"]: node for node in candidate["nodes"]
        if node["node_kind"] == "decision"
    }
    assert set(decisions) == {
        "decision:coc7:psychology:observe-concealed",
        "decision:coc7:psychology:realize-player-safe",
    }
    assert review["executable_decisions"] == sorted(decisions)
    assert review["unresolved_executable_rules"] == []
    assert decisions["decision:coc7:psychology:observe-concealed"]["properties"][
        "implementation"
    ]["phase"] == "settle"
    assert decisions["decision:coc7:psychology:realize-player-safe"]["properties"][
        "implementation"
    ]["phase"] == "realize"
    observe_slots = {
        row["name"]: row["ownership"]
        for row in decisions[
            "decision:coc7:psychology:observe-concealed"
        ]["properties"]["implementation"]["payload_slots"]
    }
    assert observe_slots["target_ref"] == "keeper-semantic"
    target_slot = next(
        node for node in candidate["nodes"]
        if node["node_id"] == "input-slot:coc7:psychology:target-ref"
    )
    assert target_slot["properties"] == {
        "family_id": "psychology",
        "ownership": "keeper-semantic",
        "value_type": "string",
        "path": "intent.method",
    }
    assert "psychology-target:<npc_id>" in target_slot["name"]
    capabilities = {
        node["node_id"]: node["properties"]["resolver_capability"]
        for node in candidate["nodes"] if node["node_kind"] == "capability"
    }
    assert capabilities == {
        "capability:coc7:psychology-check-contract": "psychology_check_contract",
        "capability:coc7:psychology-policy": "psychology_policy",
        "capability:coc7:psychology-realization-public-projection": (
            "psychology_realization_public_projection"
        ),
    }
    assert "psychology_runtime" not in json.dumps(candidate)
    relations = candidate["relations"]
    for decision_ref in decisions:
        invoked = [
            row for row in relations
            if row["from_node_id"] == decision_ref
            and row["relation_kind"] == "invokes"
        ]
        assert len(invoked) == 1
        assert invoked[0]["to_node_id"] in capabilities
    assert any(
        row["relation_kind"] == "requires-input"
        and row["from_node_id"] == "decision:coc7:psychology:observe-concealed"
        and row["to_node_id"] == "input-slot:coc7:psychology:target-ref"
        for row in relations
    )
    assert any(
        row["relation_kind"] == "continues-as"
        and row["from_node_id"] == "decision:coc7:psychology:observe-concealed"
        and row["to_node_id"] == "decision:coc7:psychology:realize-player-safe"
        for row in relations
    )
    realize_locked = {
        row["name"] for row in decisions[
            "decision:coc7:psychology:realize-player-safe"
        ]["properties"]["implementation"]["payload_slots"]
        if row["ownership"] == "host-locked"
    }
    assert realize_locked == {"inference_ceiling", "observation_receipt_ref"}
    assert all(
        any(
            row["from_node_id"] == rule_id and row["relation_kind"] == "invokes"
            for row in relations
        )
        for rule_id in expected
    )


def test_psychology_family_regenerates_deterministically_when_source_is_available():
    raw = os.environ.get(gen.BUNDLE_ROOT_ENV)
    if not raw:
        pytest.skip(f"set {gen.BUNDLE_ROOT_ENV} for source regeneration")
    built = gen.build_family(Path(raw).expanduser().resolve(), "psychology")
    candidate, envelope, review = _family("psychology")
    assert gen.canonical_bytes(built["candidate"]) == gen.canonical_bytes(candidate)
    assert gen.canonical_bytes(built["envelope"]) == gen.canonical_bytes(envelope)
    assert gen.canonical_bytes(built["review"]) == gen.canonical_bytes(review)


def test_combat_is_source_accepted_for_the_full_chapter_and_weapon_rules():
    candidate, envelope, review = _family("combat")
    shard = envelope["accepted_shard"]
    assert candidate["coverage"] == {"combat": "accepted"}
    assert shard["coverage"] == {"combat": "accepted"}
    assert review["coverage"] == "accepted"
    assert review["unresolved_applicable_rules"] == []
    assert review["runtime_integration_blockers"] == []
    assert review["accepted_shard_digest"] == shard["receipt"]["shard_sha256"]
    assert review["accepted_shard_digest"] == (
        "f69ec2c1b3f167a93ccce336bb1aee2605cdd9a284379360c2e5c7174d8700bf"
    )
    assert review["reviewer_identity"] == (
        "codex-worker-combat-end-slot-review-20260831-v2"
    )
    assert review["source"]["file_sha256"] == gen.FILE_SHA256
    assert review["source"]["bundle_sha256"] == (
        gen.FAMILY_CONFIG["combat"]["bundle_sha256"]
    )
    assert review["source"]["pdf_indices"] == [*range(113, 131), *range(412, 418)]
    expected = {
        f"rule:coc7:combat:{slug}" for slug, _name, _group in gen.RULES["combat"]
    }
    assert len(expected) == 22
    assert {row["rule_id"] for row in review["applicability_ledger"]} == expected
    assert all(row["status"] == "accepted" for row in review["applicability_ledger"])
    assert {node["node_id"] for node in candidate["nodes"] if node["node_kind"] == "rule"} == expected
    assert not any(node["node_kind"] == "exception" for node in candidate["nodes"])
    assert all(node.get("evidence_span_ids") for node in candidate["nodes"])
    assert {node["properties"]["table_name"] for node in candidate["nodes"]
            if node["node_kind"] == "data-table"} == {"combat.json", "weapons.json"}
    decisions = {
        node["node_id"]: node for node in candidate["nodes"]
        if node["node_kind"] == "decision"
    }
    assert set(decisions) == {
        f"decision:coc7:combat:{suffix}" for suffix in (
            "context", "attack", "defend", "maneuver", "aim", "reload",
            "flee", "end",
        )
    }
    assert review["executable_decisions"] == sorted(decisions)
    assert review["unresolved_executable_rules"] == []
    capabilities = {
        node["node_id"]: (
            node["properties"]["resolver_capability"],
            node["properties"]["adapter"],
        )
        for node in candidate["nodes"] if node["node_kind"] == "capability"
    }
    assert capabilities == {
        "capability:coc7:combat-context": ("combat.context", "subsystem"),
        "capability:coc7:combat-resolve": ("combat.resolve", "subsystem"),
        "capability:coc7:combat-end": ("combat.end", "subsystem"),
    }
    assert "combat_runtime" not in json.dumps(candidate)
    relations = candidate["relations"]
    for decision_ref in decisions:
        invoked = [
            row for row in relations
            if row["from_node_id"] == decision_ref
            and row["relation_kind"] == "invokes"
        ]
        assert len(invoked) == 1
        assert invoked[0]["to_node_id"] in capabilities
    assert all(
        any(
            row["from_node_id"] == rule_id
            and row["to_node_id"] == "capability:coc7:combat-resolve"
            and row["relation_kind"] == "invokes"
            for row in relations
        )
        for rule_id in expected
    )
    assert any(
        row["from_node_id"] == "decision:coc7:combat:attack"
        and row["to_node_id"] == "pending-choice:coc7:combat:defense"
        and row["relation_kind"] == "offers-choice"
        for row in relations
    )
    attack_slots = {
        row["name"]: row["ownership"] for row in decisions[
            "decision:coc7:combat:attack"
        ]["properties"]["implementation"]["payload_slots"]
    }
    assert attack_slots["candidate_ref"] == "keeper-semantic"
    for field in (
        "investigator_id", "target_npc_id", "affordance_id", "weapon_id",
        "weapon_effect_ids", "combat_revision",
    ):
        assert attack_slots[field] == "host-locked"
    defend_slots = {
        row["name"]: row["ownership"] for row in decisions[
            "decision:coc7:combat:defend"
        ]["properties"]["implementation"]["payload_slots"]
    }
    assert defend_slots["defense_kind"] == "player-source"
    assert defend_slots["pending_attack_ref"] == "host-locked"
    end_slots = {
        row["name"]: row["ownership"] for row in decisions[
            "decision:coc7:combat:end"
        ]["properties"]["implementation"]["payload_slots"]
    }
    assert end_slots == {
        "investigator_id": "host-locked",
        "outcome": "keeper-semantic",
        "combat_revision": "host-locked",
    }
    outcome_slot = next(
        node for node in candidate["nodes"]
        if node["node_id"] == "input-slot:coc7:combat:outcome"
    )
    assert outcome_slot["properties"] == {
        "family_id": "combat",
        "ownership": "keeper-semantic",
        "value_type": "string",
        "path": "intent.method",
    }
    assert any(
        row["relation_kind"] == "requires-input"
        and row["from_node_id"] == "decision:coc7:combat:end"
        and row["to_node_id"] == "input-slot:coc7:combat:outcome"
        for row in relations
    )
    assert not any(
        node["node_id"] == "input-slot:coc7:combat:combat-outcome"
        for node in candidate["nodes"]
    )


def test_combat_family_regenerates_deterministically_when_source_is_available():
    raw = os.environ.get(gen.BUNDLE_ROOT_ENV)
    if not raw:
        pytest.skip(f"set {gen.BUNDLE_ROOT_ENV} for source regeneration")
    built = gen.build_family(Path(raw).expanduser().resolve(), "combat")
    candidate, envelope, review = _family("combat")
    assert gen.canonical_bytes(built["candidate"]) == gen.canonical_bytes(candidate)
    assert gen.canonical_bytes(built["envelope"]) == gen.canonical_bytes(envelope)
    assert gen.canonical_bytes(built["review"]) == gen.canonical_bytes(review)


def test_sanity_is_source_accepted_with_one_precise_runtime_blocker():
    candidate, envelope, review = _family("sanity")
    shard = envelope["accepted_shard"]
    assert candidate["coverage"] == {"sanity": "accepted"}
    assert shard["coverage"] == {"sanity": "accepted"}
    assert review["coverage"] == "accepted"
    assert review["unresolved_applicable_rules"] == []
    assert review["accepted_shard_digest"] == shard["receipt"]["shard_sha256"]
    assert review["accepted_shard_digest"] == (
        "7e5f37f22f87284b7ef20e637d767036474e747a25ca1b69007c663de9c78087"
    )
    assert review["reviewer_identity"] == (
        "codex-worker-sanity-applicability-review-20260831-v2"
    )
    assert review["source"]["file_sha256"] == gen.FILE_SHA256
    assert review["source"]["bundle_sha256"] == (
        gen.FAMILY_CONFIG["sanity"]["bundle_sha256"]
    )
    assert review["source"]["pdf_indices"] == [*range(165, 181)]
    expected = {
        f"rule:coc7:sanity:{slug}" for slug, _name, _group in gen.RULES["sanity"]
    }
    assert len(expected) == 20
    assert {row["rule_id"] for row in review["applicability_ledger"]} == expected
    assert all(row["status"] == "accepted" for row in review["applicability_ledger"])
    assert {node["node_id"] for node in candidate["nodes"] if node["node_kind"] == "rule"} == expected
    assert not any(node["node_kind"] == "exception" for node in candidate["nodes"])
    assert all(node.get("evidence_span_ids") for node in candidate["nodes"])
    assert {node["properties"]["table_name"] for node in candidate["nodes"]
            if node["node_kind"] == "data-table"} == {
                "sanity.json", "phobias.json", "manias.json",
            }
    assert review["runtime_integration_blockers"] == []
    decisions = {
        node["node_id"]: node for node in candidate["nodes"]
        if node["node_kind"] == "decision"
    }
    assert set(decisions) == {
        f"decision:coc7:sanity:{suffix}" for suffix in (
            "context", "check", "bout-tick", "bout-end", "reality-check",
            "recover-temporary", "apply-treatment", "gain-current-san",
            "insane-insight",
        )
    }
    assert review["executable_decisions"] == sorted(decisions)
    assert review["unresolved_executable_rules"] == []
    capabilities = {
        node["node_id"]: (
            node["properties"]["resolver_capability"],
            node["properties"]["adapter"],
        )
        for node in candidate["nodes"] if node["node_kind"] == "capability"
    }
    assert capabilities == {
        "capability:coc7:sanity-context": ("sanity.context", "subsystem"),
        "capability:coc7:sanity-check": ("rules.sanity_check", "subsystem"),
        "capability:coc7:sanity-execute": ("sanity.execute", "subsystem"),
        "capability:coc7:sanity-reality-check": (
            "sanity.session.reality_check", "subsystem",
        ),
        "capability:coc7:sanity-temporary-recovery": (
            "time.recover_temporary_insanity", "subsystem",
        ),
        "capability:coc7:sanity-treatment": (
            "time.apply_psychoanalysis_treatment", "subsystem",
        ),
        "capability:coc7:sanity-gain-current": (
            "sanity.session.gain_san", "subsystem",
        ),
    }
    assert "sanity_runtime" not in json.dumps(candidate)
    relations = candidate["relations"]
    for decision_ref in decisions:
        assert len([
            row for row in relations
            if row["from_node_id"] == decision_ref
            and row["relation_kind"] == "invokes"
        ]) == 1
    assert all(
        any(
            row["from_node_id"] == rule_id and row["relation_kind"] == "invokes"
            for row in relations
        )
        for rule_id in expected
    )
    assert any(
        row["from_node_id"] == "decision:coc7:sanity:check"
        and row["to_node_id"] == "pending-choice:coc7:sanity:bout-keeper-action"
        and row["relation_kind"] == "offers-choice"
        for row in relations
    )
    check_slots = {
        row["name"]: row["ownership"] for row in decisions[
            "decision:coc7:sanity:check"
        ]["properties"]["implementation"]["payload_slots"]
    }
    for field in (
        "source", "loss_failure", "involuntary_kind", "involuntary_summary",
    ):
        assert check_slots[field] == "keeper-semantic"
    for field in (
        "investigator_id", "trigger_id", "san_before", "san_max",
    ):
        assert check_slots[field] == "host-locked"
    bout_slots = {
        row["name"]: row["ownership"] for row in decisions[
            "decision:coc7:sanity:bout-tick"
        ]["properties"]["implementation"]["payload_slots"]
    }
    assert set(bout_slots.values()) == {"host-locked"}
    reality_slots = {
        row["name"]: row["ownership"] for row in decisions[
            "decision:coc7:sanity:reality-check"
        ]["properties"]["implementation"]["payload_slots"]
    }
    assert reality_slots["request_reality_check"] == "player-source"
    assert reality_slots["active_delusion_ref"] == "host-locked"
    treatment_slots = {
        row["name"]: row["ownership"] for row in decisions[
            "decision:coc7:sanity:apply-treatment"
        ]["properties"]["implementation"]["payload_slots"]
    }
    assert set(treatment_slots.values()) == {"host-locked"}
    assert any(
        row["from_node_id"] == "decision:coc7:sanity:bout-tick"
        and row["to_node_id"] == "decision:coc7:sanity:bout-end"
        and row["relation_kind"] == "continues-as"
        for row in relations
    )

    expected_conditions = {
        "bout-tick": "sanity.bout.pending",
        "bout-end": "sanity.bout.pending",
        "reality-check": "sanity.delusion.active",
        "apply-treatment": "sanity.treatment.due",
        "recover-temporary": "sanity.recovery.due",
        "insane-insight": "sanity.insane",
        "gain-current-san": "sanity.gain.pending",
    }
    condition_nodes = {
        node["node_id"]: node for node in candidate["nodes"]
        if node["node_kind"] == "condition"
    }
    for decision_slug, path in expected_conditions.items():
        decision_ref = f"decision:coc7:sanity:{decision_slug}"
        matching = [
            row for row in relations
            if row["relation_kind"] == "available-when"
            and row["from_node_id"] == decision_ref
        ]
        assert len(matching) == 1
        condition = condition_nodes[matching[0]["to_node_id"]]
        assert condition["hard_gate"] is True
        assert condition["properties"]["expression"] == {
            "op": "eq", "path": path, "value": True,
        }
    for always_visible in ("context", "check"):
        assert not any(
            row["relation_kind"] == "available-when"
            and row["from_node_id"] == f"decision:coc7:sanity:{always_visible}"
            for row in relations
        )
    registered = set(_read(RULE_GRAPH_CONTRACT)["registered_condition_paths"])
    assert set(expected_conditions.values()) <= registered


def test_sanity_family_regenerates_deterministically_when_source_is_available():
    raw = os.environ.get(gen.BUNDLE_ROOT_ENV)
    if not raw:
        pytest.skip(f"set {gen.BUNDLE_ROOT_ENV} for source regeneration")
    built = gen.build_family(Path(raw).expanduser().resolve(), "sanity")
    candidate, envelope, review = _family("sanity")
    assert gen.canonical_bytes(built["candidate"]) == gen.canonical_bytes(candidate)
    assert gen.canonical_bytes(built["envelope"]) == gen.canonical_bytes(envelope)
    assert gen.canonical_bytes(built["review"]) == gen.canonical_bytes(review)
