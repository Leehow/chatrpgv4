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


def test_family_source_acceptance_does_not_edit_production_ownership():
    production = _read(
        ROOT / "plugins" / "coc-keeper" / "rulesets" / "coc7"
        / "rule-graph-manifest.json"
    )
    assert production["family_coverage"]["push-luck"] == "unresolved"
    assert production["family_promotion_eligibility"]["push-luck"] == {
        "promotion_eligible": False,
        "runtime_ownership": "legacy",
    }
