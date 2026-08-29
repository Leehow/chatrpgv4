#!/usr/bin/env python3
"""R4a social/psychology candidate (rework after REJECT). Does not accept().

Source-packet/candidate verification is opt-in via
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

SOURCE_EVIDENCE_ROOT_ENV = "COC_RULE_GRAPH_SOURCE_EVIDENCE_ROOT"
PACKET_NAME = "social-psychology-extraction-packet.json"
CANDIDATE_NAME = "social-psychology-candidate.json"


def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, rel)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


sys.path.insert(0, str(SCRIPTS))
coc_rule_graph = _load(
    "coc_rule_graph_social", str(SCRIPTS / "coc_rule_graph.py")
)


def _require_source_evidence_root() -> Path:
    raw = os.environ.get(SOURCE_EVIDENCE_ROOT_ENV, "").strip()
    if not raw:
        pytest.skip(
            "opt-in source-evidence check skipped: "
            f"{SOURCE_EVIDENCE_ROOT_ENV} is unset. Set it to the local "
            "uncommitted rule-graph-r4a directory (packet, candidate) "
            "to run this check; it is never on by default."
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


def _load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def _load_packet():
    root = _require_source_evidence_root()
    return _load_json(_require_source_evidence_file(root, PACKET_NAME))


def _load_candidate():
    root = _require_source_evidence_root()
    return _load_json(_require_source_evidence_file(root, CANDIDATE_NAME))


def _by_id(candidate):
    return {node["node_id"]: node for node in candidate["nodes"]}


def _payload_names(node):
    impl = node["properties"]["implementation"]
    return {slot["name"]: slot["ownership"] for slot in impl["payload_slots"]}


def _requires(candidate, decision_id):
    return {
        rel["to_node_id"]
        for rel in candidate["relations"]
        if rel["relation_kind"] == "requires-input"
        and rel["from_node_id"] == decision_id
    }


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


def test_social_psychology_candidate_validates_without_accept():
    packet = _load_packet()
    candidate = _load_candidate()
    findings = coc_rule_graph._validate_packet(packet) + coc_rule_graph._validate_candidate(
        candidate, packet
    )
    assert findings == []
    assert candidate["coverage"] == {"social": "partial", "psychology": "partial"}


def test_psychology_failure_is_unreliable_not_must_not_invert():
    node = _by_id(_load_candidate())[
        "rule:coc7:psychology:success-reveals-truth"
    ]
    assert "must not invert" not in node["name"]
    assert "unreliable" in node["name"]
    assert "not compelled to invert" in node["name"]
    spans = set(node["evidence_span_ids"])
    assert "span-social-psychology-page-215-block-96" in spans
    assert "span-social-psychology-page-215-block-97" in spans


def test_psychology_ten_percent_is_represented():
    candidate = _load_candidate()
    nodes = _by_id(candidate)
    rule = nodes["rule:coc7:psychology:base-chance-ten"]
    assert "10%" in rule["name"]
    assert "span-social-psychology-page-83-block-48" in rule["evidence_span_ids"]
    slot = nodes["input-slot:coc7:psychology:observer-skill"]
    assert slot["properties"]["ownership"] == "host-locked"
    assert slot["properties"]["path"] == "actor.sheet.psychology"
    assert "10%" in slot["name"]
    observe = "decision:coc7:psychology:observe-concealed"
    assert "input-slot:coc7:psychology:observer-skill" in _requires(
        candidate, observe
    )
    assert "observer_skill" in _payload_names(nodes[observe])


def test_psychology_oppose_uses_target_social_skill_not_psychology_sheet():
    candidate = _load_candidate()
    nodes = _by_id(candidate)
    slot = nodes["input-slot:coc7:psychology:target-opposing-social"]
    assert slot["properties"]["ownership"] == "host-locked"
    assert slot["properties"]["path"] != "actor.sheet.psychology"
    assert "Charm" in slot["name"] or "social" in slot["name"]
    observe = nodes["decision:coc7:psychology:observe-concealed"]
    payload = _payload_names(observe)
    assert "npc_psychology" not in payload
    assert payload["target_opposing_social"] == "host-locked"
    gap = nodes["exception:coc7:psychology:target-social-difficulty-uncompiled"]
    assert "Psychology" in gap["name"]
    assert "span-social-psychology-page-84-block-52" in gap["evidence_span_ids"]


def test_psychology_section_11_3_decision_ids_and_realization_shape():
    candidate = _load_candidate()
    nodes = _by_id(candidate)
    observe = nodes["decision:coc7:psychology:observe-concealed"]
    realize = nodes["decision:coc7:psychology:realize-player-safe"]
    assert "observe-settlement" not in nodes
    assert "player-safe-realization" not in nodes
    impl = realize["properties"]["implementation"]
    assert impl["phase"] == "realize"
    payload = _payload_names(realize)
    assert payload["inference_ceiling"] == "host-locked"
    assert payload["external_behavior"] == "keeper-semantic"
    assert realize["visibility"] == "public"
    assert observe["visibility"] == "concealed-result"
    assert "rng" not in impl.get("payload_constants", {})
    requires = _requires(candidate, "decision:coc7:psychology:realize-player-safe")
    assert "input-slot:coc7:psychology:inference-ceiling" in requires
    assert "input-slot:coc7:psychology:external-behavior" in requires
    invokes = {
        rel["to_node_id"]
        for rel in candidate["relations"]
        if rel["relation_kind"] == "invokes"
        and rel["from_node_id"] == "decision:coc7:psychology:realize-player-safe"
    }
    assert invokes == set()


def test_leverage_is_player_source_plus_host_one_level_not_keeper_count():
    candidate = _load_candidate()
    nodes = _by_id(candidate)
    supporting = nodes["input-slot:coc7:social:supporting-action"]
    flag = nodes["input-slot:coc7:social:leverage-one-level"]
    assert supporting["properties"]["ownership"] == "player-source"
    assert flag["properties"]["ownership"] == "host-locked"
    payload = _payload_names(nodes["decision:coc7:social:adjudicate-difficulty"])
    assert "strategic_count" not in payload
    assert payload["supporting_action"] == "player-source"
    assert payload["leverage_one_level"] == "host-locked"
    gap = nodes["exception:coc7:social:one-level-leverage-uncompiled"]
    assert "one level" in gap["name"]
    assert "span-social-psychology-page-104-block-88" in gap["evidence_span_ids"]


def test_positive_inclination_gap_is_provenance_bound():
    nodes = _by_id(_load_candidate())
    gap = nodes["exception:coc7:social:positive-inclination-automatic-uncompiled"]
    assert "without rolling" in gap["name"]
    assert "span-social-psychology-page-104-block-85" in gap["evidence_span_ids"]
    payload = _payload_names(nodes["decision:coc7:social:adjudicate-difficulty"])
    assert "strategic_count" not in payload


def test_social_goal_and_described_action_are_on_the_card():
    candidate = _load_candidate()
    nodes = _by_id(candidate)
    payload = _payload_names(nodes["decision:coc7:social:adjudicate-difficulty"])
    assert payload["described_action"] == "player-source"
    assert payload["goal"] == "player-source"
    assert payload["approach"] == "keeper-semantic"
    decision = "decision:coc7:social:adjudicate-difficulty"
    requires = _requires(candidate, decision)
    assert "input-slot:coc7:social:described-action" in requires
    assert "input-slot:coc7:social:goal" in requires
    assert "input-slot:coc7:social:motive-evidence" in requires
    action_gap = nodes["exception:coc7:social:player-action-composition-uncompiled"]
    assert "span-social-psychology-page-71-block-3" in action_gap["evidence_span_ids"]


def test_coverage_is_partial_and_fumble_is_not_source_bound():
    candidate = _load_candidate()
    nodes = _by_id(candidate)
    assert candidate["coverage"]["social"] == "partial"
    assert candidate["coverage"]["psychology"] == "partial"
    assert "condition:coc7:psychology:fumble-misread" not in nodes
    deriv = nodes["exception:coc7:psychology:fumble-only-misread-is-derivative"]
    assert "derivative" in deriv["name"]


def test_declared_requires_input_match_payload_slot_names():
    candidate = _load_candidate()
    nodes = _by_id(candidate)
    for rel in candidate["relations"]:
        if rel["relation_kind"] != "requires-input":
            continue
        decision = nodes[rel["from_node_id"]]
        slot = nodes[rel["to_node_id"]]
        payload = _payload_names(decision)
        tail = slot["node_id"].split(":")[-1].replace("-", "_")
        assert tail in payload, (rel["relation_id"], tail, sorted(payload))
        assert payload[tail] == slot["properties"]["ownership"]
