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
    assert len(review["accepted_shard_digest"]) == 64
    assert review["reviewer_identity"] == (
        "codex-worker-psychology-source-review-20260831"
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
        "ba380a1cf826825ac859b07de605718ff123a749baa086f30ddbbd5b7802696d"
    )
    assert review["reviewer_identity"] == (
        "codex-worker-combat-source-review-20260831"
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
        "bfa283ef774a31892f81c0a5da131b8ae0bb3193367c29151cac09c0e83a41ba"
    )
    assert review["reviewer_identity"] == (
        "codex-worker-sanity-source-review-20260831"
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
    assert review["runtime_integration_blockers"] == [{
        "code": "runtime_schedule_differs_from_source",
        "runtime_claim": "weekly Psychoanalysis treatment trigger",
        "source_rule": "indefinite treatment checks occur after each month",
        "source_pdf_indices": [175, 178],
        "disposition": "excluded-from-source-shard-runtime-policy",
    }]


def test_sanity_family_regenerates_deterministically_when_source_is_available():
    raw = os.environ.get(gen.BUNDLE_ROOT_ENV)
    if not raw:
        pytest.skip(f"set {gen.BUNDLE_ROOT_ENV} for source regeneration")
    built = gen.build_family(Path(raw).expanduser().resolve(), "sanity")
    candidate, envelope, review = _family("sanity")
    assert gen.canonical_bytes(built["candidate"]) == gen.canonical_bytes(candidate)
    assert gen.canonical_bytes(built["envelope"]) == gen.canonical_bytes(envelope)
    assert gen.canonical_bytes(built["review"]) == gen.canonical_bytes(review)
