#!/usr/bin/env python3
"""R2a packaged coc7 RuleGraph artifacts (accept/build after APPROVE-SUBSET).

Committed-file proofs (contract, digest, exclusions, entry_points) always run.
Source-rebuild and evidence-root verification are opt-in via
``COC_RULE_GRAPH_SOURCE_EVIDENCE_ROOT`` (unset → skipped-optional; set but
missing → fail with the exact path). Never a default-on silent skip.
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
from pathlib import Path

import pytest

SCRIPTS = Path("plugins/coc-keeper/scripts")
CONTRACT_PATH = Path("plugins/coc-keeper/references/rule-graph-contract-v1.json")
PACKAGE_GRAPH = Path("plugins/coc-keeper/rulesets/coc7/rule-graph.json")
PACKAGE_MANIFEST = Path("plugins/coc-keeper/rulesets/coc7/rule-graph-manifest.json")
PACKAGE_RULESET = Path("plugins/coc-keeper/rulesets/coc7/manifest.json")

SOURCE_EVIDENCE_ROOT_ENV = "COC_RULE_GRAPH_SOURCE_EVIDENCE_ROOT"
PACKET_NAME = "healing-extraction-packet.json"
CANDIDATE_NAME = "healing-family-candidate.json"


def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, rel)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


sys.path.insert(0, str(SCRIPTS))
coc_rule_graph = _load("coc_rule_graph_package", str(SCRIPTS / "coc_rule_graph.py"))
CONTRACT = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))


def _require_source_evidence_root() -> Path:
    raw = os.environ.get(SOURCE_EVIDENCE_ROOT_ENV, "").strip()
    if not raw:
        pytest.skip(
            "opt-in source-evidence check skipped: "
            f"{SOURCE_EVIDENCE_ROOT_ENV} is unset. Set it to the local "
            "uncommitted rule-graph-build-evidence directory (packet, "
            "candidate, accepted shard) to run this check; it is never "
            "on by default."
        )
    root = Path(raw).expanduser()
    if not root.is_dir():
        pytest.fail(
            f"{SOURCE_EVIDENCE_ROOT_ENV} is set but the directory is missing: {root}"
        )
    return root


def _require_source_evidence_file(root: Path, name: str) -> Path:
    path = root / name
    if not path.is_file():
        pytest.fail(
            f"{SOURCE_EVIDENCE_ROOT_ENV} is set but required file is missing: {path}"
        )
    return path


@pytest.fixture(autouse=True)
def _isolate_rule_graph_evidence(tmp_path: Path):
    coc_rule_graph.set_evidence_root(tmp_path / "rule-graph-build-evidence")
    coc_rule_graph.clear_accepted_session()
    yield
    coc_rule_graph.clear_accepted_session()
    coc_rule_graph.set_evidence_root(None)


def _load_package_graph():
    return json.loads(PACKAGE_GRAPH.read_text(encoding="utf-8"))


def _load_package_manifest():
    return json.loads(PACKAGE_MANIFEST.read_text(encoding="utf-8"))


def test_packaged_coc7_rule_graph_conforms_to_r1_contract():
    graph = _load_package_graph()
    manifest = _load_package_manifest()
    assert set(graph) == set(CONTRACT["graph_keys"])
    assert set(manifest) == set(CONTRACT["build_manifest_keys"])
    assert graph["contract_id"] == CONTRACT["graph_contract_id"]
    assert manifest["contract_id"] == CONTRACT["build_manifest_contract_id"]
    assert graph["ruleset_id"] == "coc7"
    assert manifest["ruleset_id"] == "coc7"
    assert graph["ruleset_version"] == manifest["ruleset_version"] == "1.0.0"
    assert graph["coverage"]["healing"] == "accepted"
    assert manifest["family_coverage"]["healing"] == "accepted"
    assert graph["family_runtime_ownership"]["healing"] == "graph"
    assert graph["legacy_surface_lifecycle"]["healing"] == "hidden"
    assert manifest["compiler_identity"] == CONTRACT["compiler_identity"]
    assert manifest["reviewer_identity"] == "r2-candidate-review"
    assert manifest["review_status"] == "accepted"
    medicine = next(
        node for node in graph["nodes"]
        if node["node_id"] == "condition:coc7:healing:medicine-ordinary-eligible"
    )
    assert "Keeper judgment" not in medicine["name"]
    assert "host-derived" in medicine["name"]
    ruleset = json.loads(PACKAGE_RULESET.read_text(encoding="utf-8"))
    assert ruleset["entry_points"]["rule_graph"] == "rule-graph.json"
    assert ruleset["entry_points"]["rule_graph_manifest"] == "rule-graph-manifest.json"
    healing = next(
        row for row in ruleset["rule_families"] if row["family_id"] == "healing"
    )
    assert healing == {
        "family_id": "healing",
        "runtime_owner": "graph",
        "legacy_surface": "hidden",
    }


def test_packaged_coc7_graph_digest_matches_manifest():
    graph = _load_package_graph()
    manifest = _load_package_manifest()
    digest = coc_rule_graph._json_digest(graph)
    assert digest == manifest["graph_content_digest"]
    assert digest == coc_rule_graph._json_digest(graph)


def test_packaged_healing_shadow_exclusions_are_machine_readable():
    manifest = _load_package_manifest()
    promo = manifest["family_promotion_eligibility"]["healing"]
    assert promo["promotion_eligible"] is False
    assert promo["runtime_ownership"] == "graph"
    exclusions = promo["shadow_exclusions"]
    by_id = {row["exclusion_id"]: row for row in exclusions}
    assert set(by_id) == {
        "first-aid-one-hour-eligibility-enforcement",
        "dual-rescuer-either-success-composition",
    }
    assert by_id["first-aid-one-hour-eligibility-enforcement"]["exception_ref"] == (
        "exception:coc7:healing:first-aid-window-uncompiled"
    )
    assert by_id["dual-rescuer-either-success-composition"]["exception_ref"] == (
        "exception:coc7:healing:first-aid-teamwork-uncompiled"
    )
    graph = _load_package_graph()
    node_ids = {node["node_id"] for node in graph["nodes"]}
    for row in exclusions:
        assert row["exception_ref"] in node_ids
        assert row["decision_ref"] in node_ids
    gap_paths = {
        finding["path"] for finding in manifest["findings"]
        if finding["code"] == "executor_capability_gap"
    }
    for exclusion_id in by_id:
        assert (
            "/family_promotion_eligibility/healing/shadow_exclusions/"
            + exclusion_id
        ) in gap_paths


def test_source_evidence_opt_in_unset_skips_with_opt_in_reason(monkeypatch):
    monkeypatch.delenv(SOURCE_EVIDENCE_ROOT_ENV, raising=False)
    with pytest.raises(pytest.skip.Exception) as caught:
        _require_source_evidence_root()
    reason = str(caught.value)
    assert "opt-in" in reason
    assert SOURCE_EVIDENCE_ROOT_ENV in reason
    assert "never on by default" in reason


def test_source_evidence_opt_in_set_but_missing_dir_fails_loud(monkeypatch, tmp_path):
    missing = tmp_path / "no-such-rule-graph-build-evidence"
    monkeypatch.setenv(SOURCE_EVIDENCE_ROOT_ENV, str(missing))
    with pytest.raises(pytest.fail.Exception) as caught:
        _require_source_evidence_root()
    assert str(missing) in str(caught.value)


def test_source_evidence_opt_in_set_but_missing_file_fails_loud(monkeypatch, tmp_path):
    monkeypatch.setenv(SOURCE_EVIDENCE_ROOT_ENV, str(tmp_path))
    expected = tmp_path / PACKET_NAME
    with pytest.raises(pytest.fail.Exception) as caught:
        _require_source_evidence_file(tmp_path, PACKET_NAME)
    assert str(expected) in str(caught.value)


def test_packaged_shard_digest_matches_durable_evidence_root():
    root = _require_source_evidence_root()
    manifest = _load_package_manifest()
    shard_row = manifest["shards"][0]
    path = coc_rule_graph.accepted_evidence_path(shard_row["shard_id"], root)
    expected = root / (shard_row["shard_id"].replace(":", "--") + ".json")
    if path is None or not path.is_file():
        pytest.fail(
            f"{SOURCE_EVIDENCE_ROOT_ENV} is set but required file is missing: {expected}"
        )
    envelope = json.loads(path.read_text(encoding="utf-8"))
    assert envelope["contract_id"] == coc_rule_graph.ACCEPTED_EVIDENCE_CONTRACT_ID
    assert (
        coc_rule_graph._json_digest(envelope["accepted_shard"])
        == shard_row["shard_digest"]
    )


def test_packaged_graph_rebuilds_to_the_same_digest():
    root = _require_source_evidence_root()
    packet_path = _require_source_evidence_file(root, PACKET_NAME)
    candidate_path = _require_source_evidence_file(root, CANDIDATE_NAME)
    packet = json.loads(packet_path.read_text(encoding="utf-8"))
    candidate = json.loads(candidate_path.read_text(encoding="utf-8"))
    first = coc_rule_graph.accept(packet, candidate)
    assert first["ok"] is True, first
    built_a = coc_rule_graph.build([first["shard"]])
    assert built_a["ok"] is True, built_a
    graph_a, manifest_a = coc_rule_graph.apply_healing_shadow_package(
        built_a["graph"], built_a["manifest"]
    )
    second = coc_rule_graph.accept(packet, candidate)
    assert second["ok"] is True, second
    built_b = coc_rule_graph.build([second["shard"]])
    assert built_b["ok"] is True, built_b
    _graph_b, manifest_b = coc_rule_graph.apply_healing_shadow_package(
        built_b["graph"], built_b["manifest"]
    )
    packaged = _load_package_manifest()
    assert manifest_a["graph_content_digest"] == manifest_b["graph_content_digest"]
    assert manifest_a["graph_content_digest"] == packaged["graph_content_digest"]
    assert coc_rule_graph._json_digest(graph_a) == packaged["graph_content_digest"]
