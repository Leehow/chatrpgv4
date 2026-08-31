"""Family-scoped independent source acceptance for RuleGraph stage 1."""
from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
TREE = (
    ROOT / "plugins" / "coc-keeper" / "rulesets" / "coc7"
    / "rule-graph-candidates" / "source-stage1"
)
SCRIPT = ROOT / "tests" / "fixtures" / "_accept_rulegraph_source_core_push_social.py"


def _module():
    spec = importlib.util.spec_from_file_location("source_family_acceptance_tests", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


acceptor = _module()


def _read(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def _accepted(family: str, name: str):
    return _read(TREE / "accepted" / family / name)


def test_push_luck_is_independently_source_accepted_without_promotion():
    graph = _accepted("push-luck", "rule-graph.json")
    manifest = _accepted("push-luck", "rule-graph-manifest.json")
    shard = _accepted("push-luck", "accepted-shard.json")
    provenance = _accepted("push-luck", "provenance.json")

    assert graph["coverage"]["push-luck"] == "accepted"
    assert manifest["family_coverage"]["push-luck"] == "accepted"
    assert manifest["review_status"] == "accepted"
    assert manifest["reviewer_identity"] == (
        "codex-rule-families-core-social-source-review-20260831:push-luck"
    )
    assert manifest["graph_content_digest"] == acceptor.rg._json_digest(graph)
    assert manifest["shards"] == [{
        "shard_id": shard["shard_id"],
        "shard_digest": acceptor.rg._json_digest(shard),
    }]
    assert manifest["family_promotion_eligibility"]["push-luck"] == {
        "promotion_eligible": False,
        "runtime_ownership": "legacy",
    }
    assert provenance["file_sha256"] == acceptor.PDF_SHA256
    assert provenance["bundle_id"] == "core-social-psychology-v2"
    assert {row["pdf_index"] for row in provenance["pages"]} == {
        95, 96, 97, 100, 101, 110,
    }


def test_push_luck_acceptance_has_no_unresolved_applicable_rule_marker():
    graph = _accepted("push-luck", "rule-graph.json")
    nodes = {row["node_id"]: row for row in graph["nodes"]}
    assert "exception:coc7:push-luck:fumble-push-uncompiled" not in nodes
    assert all("uncompiled" not in row["node_id"] for row in graph["nodes"])
    assert all("uncompiled" not in row["name"].casefold() for row in graph["nodes"])
    for required in (
        "rule:coc7:push-luck:eligible-scope",
        "rule:coc7:push-luck:goal-time-difficulty",
        "exception:coc7:push-luck:fumble-final",
        "rule:coc7:push-luck:luck-spend-limits",
        "rule:coc7:push-luck:luck-recovery",
        "decision:coc7:push-luck:pushed-roll",
        "decision:coc7:push-luck:luck-spend",
        "decision:coc7:push-luck:luck-roll",
    ):
        assert required in nodes


def test_push_luck_source_acceptance_regenerates_byte_identically(tmp_path):
    raw = os.environ.get(acceptor.BUNDLE_ROOT_ENV)
    if not raw:
        pytest.skip(f"set {acceptor.BUNDLE_ROOT_ENV} for source regeneration")
    result = acceptor.accept_family(
        Path(raw).expanduser().resolve(),
        "push-luck",
        list(acceptor.FAMILIES["push-luck"]["pages"]),
        acceptor.FAMILIES["push-luck"]["factory"],
    )
    expected = TREE / "accepted" / "push-luck"
    for key, name in (
        ("candidate", "candidate.json"),
        ("accepted_shard", "accepted-shard.json"),
        ("graph", "rule-graph.json"),
        ("manifest", "rule-graph-manifest.json"),
        ("provenance", "provenance.json"),
    ):
        assert acceptor._bytes(result[key]) == (expected / name).read_bytes(), name


def test_core_check_is_source_accepted_with_corrected_combined_rule():
    graph = _accepted("core-check", "rule-graph.json")
    manifest = _accepted("core-check", "rule-graph-manifest.json")
    shard = _accepted("core-check", "accepted-shard.json")
    provenance = _accepted("core-check", "provenance.json")
    nodes = {row["node_id"]: row for row in graph["nodes"]}

    assert graph["coverage"]["core-check"] == "accepted"
    assert manifest["family_coverage"]["core-check"] == "accepted"
    assert manifest["review_status"] == "accepted"
    assert manifest["reviewer_identity"] == (
        "codex-rule-families-core-social-source-review-20260831:core-check"
    )
    assert manifest["graph_content_digest"] == acceptor.rg._json_digest(graph)
    assert manifest["shards"] == [{
        "shard_id": shard["shard_id"],
        "shard_digest": acceptor.rg._json_digest(shard),
    }]
    assert manifest["family_promotion_eligibility"]["core-check"] == {
        "promotion_eligible": False,
        "runtime_ownership": "legacy",
    }
    assert {row["pdf_index"] for row in provenance["pages"]} == {
        93, 94, 97, 99, 100, 101, 102, 103, 104,
    }
    for required in (
        "decision:coc7:core-check:ordinary-check",
        "decision:coc7:core-check:opposed-check",
        "decision:coc7:core-check:combined-check",
        "rule:coc7:core-check:multiple-investigators",
        "rule:coc7:core-check:physical-human-limits",
        "input-slot:coc7:core-check:combined-mode",
    ):
        assert required in nodes
    assert all("uncompiled" not in row["node_id"] for row in graph["nodes"])
    combined_table = json.loads(
        (
            ROOT / "plugins" / "coc-keeper" / "rulesets" / "coc7"
            / "rules-json" / "combat.json"
        ).read_text(encoding="utf-8")
    )["combined_roll"]
    assert "teamwork" not in combined_table
    assert "one investigator" in combined_table["source_note"]


def test_core_check_source_acceptance_regenerates_byte_identically():
    raw = os.environ.get(acceptor.BUNDLE_ROOT_ENV)
    if not raw:
        pytest.skip(f"set {acceptor.BUNDLE_ROOT_ENV} for source regeneration")
    result = acceptor.accept_family(
        Path(raw).expanduser().resolve(),
        "core-check",
        list(acceptor.FAMILIES["core-check"]["pages"]),
        acceptor.FAMILIES["core-check"]["factory"],
    )
    expected = TREE / "accepted" / "core-check"
    for key, name in (
        ("candidate", "candidate.json"),
        ("accepted_shard", "accepted-shard.json"),
        ("graph", "rule-graph.json"),
        ("manifest", "rule-graph-manifest.json"),
        ("provenance", "provenance.json"),
    ):
        assert acceptor._bytes(result[key]) == (expected / name).read_bytes(), name


def test_social_is_source_accepted_with_full_motive_and_agency_semantics():
    graph = _accepted("social", "rule-graph.json")
    manifest = _accepted("social", "rule-graph-manifest.json")
    shard = _accepted("social", "accepted-shard.json")
    provenance = _accepted("social", "provenance.json")
    nodes = {row["node_id"]: row for row in graph["nodes"]}

    assert graph["coverage"]["social"] == "accepted"
    assert manifest["family_coverage"]["social"] == "accepted"
    assert manifest["review_status"] == "accepted"
    assert manifest["reviewer_identity"] == (
        "codex-rule-families-core-social-source-review-20260831:social"
    )
    assert manifest["graph_content_digest"] == acceptor.rg._json_digest(graph)
    assert manifest["shards"] == [{
        "shard_id": shard["shard_id"],
        "shard_digest": acceptor.rg._json_digest(shard),
    }]
    assert {row["pdf_index"] for row in provenance["pages"]} == {
        70, 71, 75, 77, 82, 84, 104, 208,
    }
    for required in (
        "rule:coc7:social:opposing-difficulty",
        "rule:coc7:social:feasibility",
        "rule:coc7:social:motive-and-support",
        "rule:coc7:social:extreme-ceiling",
        "rule:coc7:social:pc-agency-and-penalty",
        "effect:coc7:social:pc-refusal-penalty",
        "pending-choice:coc7:social:pc-refusal",
        "rule:coc7:social:charm-scope",
        "rule:coc7:social:fast-talk-temporary",
        "rule:coc7:social:intimidate-scope",
        "rule:coc7:social:persuade-duration",
    ):
        assert required in nodes
    assert "higher of" in nodes[
        "rule:coc7:social:opposing-difficulty"
    ]["name"].casefold()
    assert all("uncompiled" not in row["node_id"] for row in graph["nodes"])
    assert all("uncompiled" not in row["name"].casefold() for row in graph["nodes"])


def test_social_source_acceptance_regenerates_byte_identically():
    raw = os.environ.get(acceptor.BUNDLE_ROOT_ENV)
    if not raw:
        pytest.skip(f"set {acceptor.BUNDLE_ROOT_ENV} for source regeneration")
    result = acceptor.accept_family(
        Path(raw).expanduser().resolve(),
        "social",
        list(acceptor.FAMILIES["social"]["pages"]),
        acceptor.FAMILIES["social"]["factory"],
    )
    expected = TREE / "accepted" / "social"
    for key, name in (
        ("candidate", "candidate.json"),
        ("accepted_shard", "accepted-shard.json"),
        ("graph", "rule-graph.json"),
        ("manifest", "rule-graph-manifest.json"),
        ("provenance", "provenance.json"),
    ):
        assert acceptor._bytes(result[key]) == (expected / name).read_bytes(), name


@pytest.mark.parametrize("family", ["core-check", "push-luck", "social"])
def test_family_source_acceptance_updates_coverage_without_runtime_cutover(family):
    production = _read(
        ROOT / "plugins" / "coc-keeper" / "rulesets" / "coc7"
        / "rule-graph-manifest.json"
    )
    assert production["family_coverage"][family] == "accepted"
    assert production["family_promotion_eligibility"][family] == {
        "promotion_eligible": False,
        "runtime_ownership": "legacy",
    }
