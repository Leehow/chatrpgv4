#!/usr/bin/env python3
"""Source-bound development/chase/magic family shard contracts."""
from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
GENERATOR = ROOT / "tests" / "fixtures" / "_gen_rulegraph_source_families_v1.py"
TREE = (
    ROOT / "plugins" / "coc-keeper" / "rulesets" / "coc7"
    / "rule-graph-candidates" / "source-families-v1"
)
CONTRACT = ROOT / "plugins" / "coc-keeper" / "references" / "rule-graph-contract-v1.json"


def _load_generator():
    spec = importlib.util.spec_from_file_location("source_family_generator", GENERATOR)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


gen = _load_generator()


def _read(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def _assert_executable_slots_are_runtime_consumable(candidate, family):
    nodes = {node["node_id"]: node for node in candidate["nodes"]}
    decisions = [
        node for node in nodes.values() if node["node_kind"] == "decision"
    ]
    for decision in decisions:
        assert decision["properties"]["family_id"] == family
        declared = {
            slot["name"]
            for slot in decision["properties"]["implementation"]["payload_slots"]
        }
        related = {
            relation["to_node_id"].rsplit(":", 1)[-1].replace("-", "_")
            for relation in candidate["relations"]
            if relation["from_node_id"] == decision["node_id"]
            and relation["relation_kind"] in {"requires-input", "locks-input"}
        }
        assert related == declared


def test_development_source_review_is_complete_and_independent():
    root = TREE / "development"
    candidate = _read(root / "candidates" / "development.candidate.json")
    provenance = _read(root / "provenance" / "development.provenance.json")
    shard = _read(root / "accepted" / "development.accepted-shard.json")
    assert candidate["coverage"] == {"development": "accepted"}
    assert provenance["reviewer_identity"] == "codex-reviewer-development-source-20260831"
    assert provenance["review_status"] == "accepted"
    assert provenance["unresolved_applicable_rules"] == []
    assert len(provenance["accepted_shard_digest"]) == 64
    assert shard["receipt"]["shard_sha256"] == provenance["accepted_shard_digest"]
    assert shard["coverage"] == {"development": "accepted"}
    node_ids = {node["node_id"] for node in candidate["nodes"]}
    for token in (
        "phase-timing", "skill-ticks", "improvement", "mastery-san-reward",
        "luck-recovery", "awfulness-decay",
    ):
        assert f"rule:coc7:development:{token}" in node_ids
    assert provenance["executable_operations"] == [
        "state.end_session", "development.settle",
    ]
    assert provenance["unresolved_executable_rules"] == []
    decisions = {
        node["node_id"]: node for node in candidate["nodes"]
        if node["node_kind"] == "decision"
    }
    assert set(decisions) == {
        "decision:coc7:development:end-session",
        "decision:coc7:development:settle-ending",
    }
    assert decisions["decision:coc7:development:end-session"]["properties"][
        "implementation"
    ]["kind"] == "state.end_session"
    assert decisions["decision:coc7:development:settle-ending"]["properties"][
        "implementation"
    ]["kind"] == "development.settle"
    relations = candidate["relations"]
    end_slots = {
        row["name"]: row
        for row in decisions["decision:coc7:development:end-session"]["properties"][
            "implementation"
        ]["payload_slots"]
    }
    assert end_slots["summary"] == {
        "name": "summary", "ownership": "optional-semantic", "optional": True,
    }
    assert end_slots["kind"] == {
        "name": "kind", "ownership": "optional-semantic", "optional": True,
    }
    assert end_slots["investigator"] == {
        "name": "investigator", "ownership": "host-locked", "optional": True,
    }
    assert not any(
        row["relation_kind"] == "available-when"
        and row["from_node_id"] == "decision:coc7:development:end-session"
        for row in relations
    )
    settle_condition_ref = next(
        row["to_node_id"] for row in relations
        if row["relation_kind"] == "available-when"
        and row["from_node_id"] == "decision:coc7:development:settle-ending"
    )
    settle_condition = next(
        row for row in candidate["nodes"] if row["node_id"] == settle_condition_ref
    )
    assert settle_condition["hard_gate"] is True
    assert settle_condition["properties"]["expression"] == {
        "op": "eq", "path": "development.settlement.pending", "value": True,
    }
    for decision_id in decisions:
        kinds = {
            row["relation_kind"] for row in relations
            if row["from_node_id"] == decision_id
        }
        assert {"invokes", "emits", "locks-input"} <= kinds
    _assert_executable_slots_are_runtime_consumable(candidate, "development")


def test_development_regenerates_byte_identically_from_external_bundle(tmp_path: Path):
    raw = os.environ.get(gen.BUNDLE_ROOT_ENV)
    if not raw:
        pytest.skip(f"set {gen.BUNDLE_ROOT_ENV}")
    built = gen.build_family(Path(raw).resolve(), "development", tmp_path / "evidence")
    output = tmp_path / "tree"
    gen.write_all({"development": built}, output)
    expected = {
        path.relative_to(TREE / "development"): path.read_bytes()
        for path in (TREE / "development").rglob("*.json")
    }
    actual = {
        path.relative_to(output / "development"): path.read_bytes()
        for path in (output / "development").rglob("*.json")
    }
    assert actual == expected


def test_chase_source_review_is_complete_and_records_runtime_mismatches():
    root = TREE / "chase"
    candidate = _read(root / "candidates" / "chase.candidate.json")
    provenance = _read(root / "provenance" / "chase.provenance.json")
    shard = _read(root / "accepted" / "chase.accepted-shard.json")
    assert candidate["coverage"] == {"chase": "accepted"}
    assert provenance["reviewer_identity"] == "codex-reviewer-chase-applicability-20260831-v2"
    assert provenance["review_status"] == "accepted"
    assert provenance["unresolved_applicable_rules"] == []
    assert shard["receipt"]["shard_sha256"] == provenance["accepted_shard_digest"]
    node_ids = {node["node_id"] for node in candidate["nodes"]}
    for token in (
        "establish", "movement-actions", "hazards", "barriers", "conflict",
        "pedal-to-metal", "passengers-and-fire", "vehicle-reference",
    ):
        assert f"rule:coc7:chase:{token}" in node_ids
    assert not any(node_id.startswith("exception:coc7:chase:") for node_id in node_ids)
    assert provenance["executable_operations"] == ["chase.execute"] * 6
    assert provenance["unresolved_executable_rules"] == []
    decisions = {
        node["node_id"]: node for node in candidate["nodes"]
        if node["node_kind"] == "decision"
    }
    assert set(decisions) == {
        f"decision:coc7:chase:{token}"
        for token in ("start", "move", "hazard", "barrier", "conflict", "end")
    }
    command_kind = {
        f"decision:coc7:chase:{token}": f"chase_{token}"
        for token in ("start", "move", "hazard", "barrier", "conflict", "end")
    }
    for decision_id, decision in decisions.items():
        assert decision["properties"]["implementation"]["kind"] == command_kind[decision_id]
        kinds = {
            row["relation_kind"] for row in candidate["relations"]
            if row["from_node_id"] == decision_id
        }
        assert {"available-when", "invokes", "emits"} <= kinds
        assert {"requires-input", "locks-input"} & kinds
    _assert_executable_slots_are_runtime_consumable(candidate, "chase")
    nodes = {node["node_id"]: node for node in candidate["nodes"]}
    relations = candidate["relations"]
    expected_conditions = {
        "start": {"op": "eq", "path": "chase.session.inactive", "value": True},
        **{
            token: {
                "op": "all",
                "of": [
                    {"op": "eq", "path": "chase.session.active", "value": True},
                    {"op": "eq", "path": "chase.pending.kind", "value": token},
                ] + ([{
                    "op": "eq", "path": "chase.conflict.receipt-ready", "value": True,
                }] if token == "conflict" else []),
            }
            for token in ("move", "hazard", "barrier", "conflict", "end")
        },
    }
    for token, expression in expected_conditions.items():
        decision_id = f"decision:coc7:chase:{token}"
        link = next(
            row for row in relations
            if row["relation_kind"] == "available-when"
            and row["from_node_id"] == decision_id
        )
        condition = nodes[link["to_node_id"]]
        assert condition["hard_gate"] is True
        assert condition["properties"]["expression"] == expression
    start_slots = {
        row["name"]: row["ownership"]
        for row in decisions["decision:coc7:chase:start"]["properties"]["implementation"]["payload_slots"]
    }
    assert start_slots["chase_candidate_ref"] == "keeper-semantic"
    assert nodes["input-slot:coc7:chase:method"]["properties"]["value_type"] == "enum"
    assert "negotiate|break" in nodes["input-slot:coc7:chase:method"]["name"]
    assert nodes["input-slot:coc7:chase:outcome"]["properties"]["value_type"] == "enum"
    assert "escaped|captured|concluded" in nodes["input-slot:coc7:chase:outcome"]["name"]


def test_chase_regenerates_byte_identically_from_external_bundle(tmp_path: Path):
    raw = os.environ.get(gen.BUNDLE_ROOT_ENV)
    if not raw:
        pytest.skip(f"set {gen.BUNDLE_ROOT_ENV}")
    built = gen.build_family(Path(raw).resolve(), "chase", tmp_path / "evidence")
    output = tmp_path / "tree"
    gen.write_all({"chase": built}, output)
    expected = {
        path.relative_to(TREE / "chase"): path.read_bytes()
        for path in (TREE / "chase").rglob("*.json")
    }
    actual = {
        path.relative_to(output / "chase"): path.read_bytes()
        for path in (output / "chase").rglob("*.json")
    }
    assert actual == expected


def test_magic_has_complete_accepted_shard_after_source_correction():
    root = TREE / "magic"
    candidate = _read(root / "candidates" / "magic.candidate.json")
    provenance = _read(root / "provenance" / "magic.provenance.json")
    shard = _read(root / "accepted" / "magic.accepted-shard.json")
    assert candidate["coverage"] == {"magic": "accepted"}
    assert shard["coverage"] == {"magic": "accepted"}
    assert provenance["reviewer_identity"] == "codex-reviewer-magic-source-20260831"
    assert provenance["review_status"] == "accepted"
    assert len(provenance["accepted_shard_digest"]) == 64
    assert shard["receipt"]["shard_sha256"] == provenance["accepted_shard_digest"]
    assert provenance["unresolved_applicable_rules"] == []
    assert provenance["blockers"] == []
    node_ids = {node["node_id"] for node in candidate["nodes"]}
    assert not any(node_id.startswith("exception:coc7:magic:") for node_id in node_ids)
    assert provenance["executable_operations"] == ["magic.cast", "magic.learn"]
    assert provenance["unresolved_executable_rules"] == []
    decisions = {
        node["node_id"]: node for node in candidate["nodes"]
        if node["node_kind"] == "decision"
    }
    assert set(decisions) == {
        "decision:coc7:magic:cast-spell",
        "decision:coc7:magic:learn-spell",
    }
    assert decisions["decision:coc7:magic:cast-spell"]["properties"][
        "implementation"
    ]["kind"] == "magic.cast"
    assert decisions["decision:coc7:magic:learn-spell"]["properties"][
        "implementation"
    ]["kind"] == "magic.learn"
    for decision_id in decisions:
        kinds = {
            row["relation_kind"] for row in candidate["relations"]
            if row["from_node_id"] == decision_id
        }
        assert {"available-when", "invokes", "requires-input", "locks-input", "emits"} <= kinds
    _assert_executable_slots_are_runtime_consumable(candidate, "magic")
def test_chase_registered_applicability_paths_are_closed():
    registered = set(_read(CONTRACT)["registered_condition_paths"])
    assert {
        "chase.session.active", "chase.session.inactive", "chase.pending.kind",
        "chase.conflict.receipt-ready",
    } <= registered


def test_removed_magic_spell_names_are_absent_from_exact_source_and_catalog():
    raw = os.environ.get(gen.BUNDLE_ROOT_ENV)
    if not raw:
        pytest.skip(f"set {gen.BUNDLE_ROOT_ENV}")
    root = Path(raw).resolve()
    text = "\n".join(
        str(page["text"])
        for name in gen.SPECS["magic"]["bundles"]
        for page in _read(root / name / "normalized-source.json")["pages"]
    ).casefold()
    removed = (
        "Mantle of Cthulhu", "Resurrection of Me", "Seal of Nyarlathotep",
        "See Invisible", "Steal Mind", "Summon Hellfire", "Swim Like a Fish",
        "Touch of Death", "True Seeing", "Walk the Path",
    )
    catalog = _read(ROOT / "plugins/coc-keeper/rulesets/coc7/rules-json/spells.json")
    names = {row["name"] for row in catalog["spells"]}
    for spell in removed:
        assert spell.casefold() not in text
        assert spell not in names
    assert "chapter thirteen" in text
    assert "chapter fourteen" in text


def test_magic_regenerates_byte_identically_from_external_bundle(tmp_path: Path):
    raw = os.environ.get(gen.BUNDLE_ROOT_ENV)
    if not raw:
        pytest.skip(f"set {gen.BUNDLE_ROOT_ENV}")
    built = gen.build_family(Path(raw).resolve(), "magic", tmp_path / "evidence")
    output = tmp_path / "tree"
    gen.write_all({"magic": built}, output)
    expected = {
        path.relative_to(TREE / "magic"): path.read_bytes()
        for path in (TREE / "magic").rglob("*.json")
    }
    actual = {
        path.relative_to(output / "magic"): path.read_bytes()
        for path in (output / "magic").rglob("*.json")
    }
    assert actual == expected


def test_source_family_artifacts_do_not_touch_production_graph():
    assert TREE != ROOT / "plugins/coc-keeper/rulesets/coc7"
    source = GENERATOR.read_text(encoding="utf-8")
    assert "rule-graph.json" not in source
    assert "rule-graph-manifest.json" not in source
