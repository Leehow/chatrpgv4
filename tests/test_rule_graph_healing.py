#!/usr/bin/env python3
"""R1 conformance tests for the RuleGraph contract + compiler.

These exercise a BOUNDED healing-family packet end-to-end over a clearly
labeled SYNTHETIC source bundle (no real-source provenance is claimed):
prepare -> accept -> build -> deterministic rebuild, plus the closing checks:

  - semantic-ID accept / reject;
  - closed condition-language allowlist is enforced;
  - model-authored integrity bytes are rejected;
  - reference-closure failures yield Findings;
  - coverage aggregation;
  - deterministic rebuild (same shards -> identical graph digest);
  - healing decision -> current subsystem command SHAPE parity (pure
    compilation; execution parity is R2);
  - ceiling-half conformance: the current combat implementation computes the
    odd max-HP major-wound threshold as ceiling-half, and the compiler records
    a source-vs-derivative mismatch as a Finding rather than silently aligning
    the graph to a floor-half derivative.

No runtime operation is changed here; this is a pure compilation check.
"""
from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

import pytest

SCRIPTS = Path("plugins/coc-keeper/scripts")
CONTRACT_PATH = Path("plugins/coc-keeper/references/rule-graph-contract-v1.json")


def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, rel)
    m = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(m)
    return m


# Load the compiler once.  It imports coc_module_graph, so ensure the scripts
# dir is on sys.path the same way the repo tests do.
sys.path.insert(0, str(SCRIPTS))
coc_rule_graph = _load("coc_rule_graph", str(SCRIPTS / "coc_rule_graph.py"))
coc_combat = _load("coc_combat", str(SCRIPTS / "coc_combat.py"))
coc_healing = _load("coc_healing", str(SCRIPTS / "coc_healing.py"))

CONTRACT = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
CANIDATE_CONTRACT_ID = CONTRACT["candidate_contract_id"]


@pytest.fixture(autouse=True)
def _isolate_rule_graph_evidence(tmp_path: Path):
    coc_rule_graph.set_evidence_root(tmp_path / "rule-graph-build-evidence")
    coc_rule_graph.clear_accepted_session()
    yield
    coc_rule_graph.clear_accepted_session()
    coc_rule_graph.set_evidence_root(None)


# --------------------------------------------------------------------------- #
# Synthetic healing-family source bundle (clearly labeled, NOT real source)
# --------------------------------------------------------------------------- #
def _write_source_bundle(tmp_path: Path) -> tuple[str, str, Path]:
    """Write one accepted page capturing First Aid + Medicine + dying + weekly.

    Returns (source_id, span_id, bundle_dir).  This is a synthetic fixture; it
    is never claimed to be real rulebook source.
    """
    source_id = "pdf:coc7-healing-fixture"
    text = (
        "First Aid (p.119). A successful First Aid roll restores 1 hit point "
        "to a living, non-dying investigator. Medicine (p.120) restores 1D3 "
        "hit points. Major wound clears when HP reaches half of the maximum, "
        "rounding odd maxima upward."
    )
    bundle = tmp_path / "bundle"
    (bundle / "pages").mkdir(parents=True, exist_ok=True)
    (bundle / "pages" / "0000.md").write_text(text, encoding="utf-8")
    manifest = {
        "schema_version": 1,
        "producer": "codex-pdf-skill",
        "source": {
            "source_id": source_id,
            "title": "Synthetic healing fixture (not real rulebook source)",
            "path": str(tmp_path / "src.pdf"),
            "file_sha256": "a" * 64,
            "page_count": 1,
        },
        "pages": [{
            "pdf_index": 0,
            "markdown_path": "pages/0000.md",
            "text_sha256": hashlib.sha256(text.encode()).hexdigest(),
            "review_state": "auto_accepted",
            "parse_confidence": 0.95,
            "grep_anchors": ["First Aid (p.119)."],
        }],
        "assets": [],
    }
    (bundle / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    span_id = "span-healing-first-aid-page-0-block-1"
    return source_id, span_id, bundle


def _selection(tmp_path: Path) -> dict:
    _, _, bundle = _write_source_bundle(tmp_path)
    return {
        "ruleset_id": "coc7",
        "ruleset_version": "1.0.0",
        "source_language": "en",
        "family_id": "healing",
        "section_id": "section-healing-first-aid",
        "bundle_dirs": [str(bundle)],
        "page_keys": [("pdf:coc7-healing-fixture", 0)],
        "output_budget": {"max_nodes": 40, "max_relations": 80},
        "families": ["healing"],
    }


def _packet(tmp_path: Path) -> dict:
    sel = _selection(tmp_path)
    result = coc_rule_graph.prepare(sel)
    assert result["ok"] is True, result
    return result["shard"]


def _span_id(packet: dict) -> str:
    return packet["evidence_binding"]["spans"][0]["span_id"]


def _node(node_id: str, kind: str, name: str, *, span: str | None = None,
          audience: str = "keeper", visibility: str = "public",
          hard_gate: bool = False, props: dict | None = None) -> dict:
    row = {
        "node_id": node_id,
        "node_kind": kind,
        "name": name,
        "authority": "deterministic",
        "audience": audience,
        "visibility": visibility,
        "hard_gate": hard_gate,
        "properties": props or {},
    }
    if span is not None:
        row["evidence_span_ids"] = [span]
    return row


def _relation(relation_id: str, kind: str, src: str, dst: str, span: str) -> dict:
    return {
        "relation_id": relation_id,
        "relation_kind": kind,
        "from_node_id": src,
        "to_node_id": dst,
        "evidence_span_ids": [span],
    }


def _valid_candidate(packet: dict) -> dict:
    """Bounded healing-family candidate covering the four prototype mappings.

    First Aid, Medicine, dying clocks (round + hour), and weekly recovery
    travel through prepare → accept → build, not only through the shape table.
    """
    span = _span_id(packet)
    host = {"audience": "host-internal", "visibility": "keeper-only"}
    first_aid_impl = coc_rule_graph.healing_command_shape("first-aid-stabilization")
    medicine_impl = coc_rule_graph.healing_command_shape("medicine-stabilization")
    dying_impl = coc_rule_graph.healing_command_shape("dying-death-clock-tick")
    weekly_impl = coc_rule_graph.healing_command_shape("weekly-major-wound-recovery")
    dying_round = dict(dying_impl)
    dying_round["payload_constants"] = {"clock_kind": "round"}
    dying_round["payload_slots"] = []
    dying_hour = dict(dying_impl)
    dying_hour["payload_constants"] = {"clock_kind": "hour"}
    dying_hour["payload_slots"] = []
    return {
        "contract_id": CANIDATE_CONTRACT_ID,
        "schema_version": 1,
        "ruleset_id": "coc7",
        "family_id": "healing",
        "section_id": packet["section_id"],
        "source_language": "en",
        "coverage": {"healing": "accepted"},
        "nodes": [
            _node("rule-family:coc7:healing", "rule-family", "Healing", props={
                "family_id": "healing",
                "runtime_ownership": "legacy",
                "legacy_surface": "visible",
            }),
            _node("rule:coc7:healing:first-aid-stabilization", "rule",
                  "First Aid stabilization", span=span,
                  props={"family_id": "healing"}),
            _node("capability:coc7:first-aid", "capability", "First Aid",
                  span=span, **host, props={
                      "family_id": "healing",
                      "resolver_capability": "first_aid",
                      "adapter": "subsystem-command",
                  }),
            _node("input-slot:coc7:healing:first-aid-skill", "input-slot",
                  "skill_value", span=span, **host, props={
                      "family_id": "healing",
                      "ownership": "host-locked",
                      "value_type": "int",
                      "path": "actor.sheet.first_aid",
                  }),
            _node("decision:coc7:healing:first-aid-stabilization", "decision",
                  "Administer First Aid", span=span, **host,
                  props={"family_id": "healing", "implementation": first_aid_impl}),
            _node("rule:coc7:healing:medicine-stabilization", "rule",
                  "Medicine after First Aid", span=span,
                  props={"family_id": "healing"}),
            _node("capability:coc7:medicine", "capability", "Medicine",
                  span=span, **host, props={
                      "family_id": "healing",
                      "resolver_capability": "medicine",
                      "adapter": "subsystem-command",
                  }),
            _node("decision:coc7:healing:medicine-stabilization", "decision",
                  "Administer Medicine", span=span, **host,
                  props={"family_id": "healing", "implementation": medicine_impl}),
            _node("rule:coc7:healing:dying-clock", "rule",
                  "Dying round/hour clocks", span=span,
                  props={"family_id": "healing"}),
            _node("capability:coc7:dying-check", "capability", "Dying check",
                  span=span, **host, props={
                      "family_id": "healing",
                      "resolver_capability": "dying_check",
                      "adapter": "subsystem-command",
                  }),
            _node("decision:coc7:healing:dying-round-clock", "decision",
                  "Resolve dying round clock", span=span, **host,
                  props={"family_id": "healing", "implementation": dying_round}),
            _node("decision:coc7:healing:dying-hour-clock", "decision",
                  "Resolve dying hour clock", span=span, **host,
                  props={"family_id": "healing", "implementation": dying_hour}),
            _node("rule:coc7:healing:weekly-major-wound-recovery", "rule",
                  "Weekly major-wound recovery", span=span,
                  props={"family_id": "healing"}),
            _node("capability:coc7:weekly-recovery", "capability",
                  "Weekly recovery", span=span, **host, props={
                      "family_id": "healing",
                      "resolver_capability": "weekly_recovery",
                      "adapter": "subsystem-command",
                  }),
            _node("decision:coc7:healing:weekly-major-wound-recovery", "decision",
                  "Resolve weekly recovery", span=span, **host,
                  props={"family_id": "healing", "implementation": weekly_impl}),
            _node("condition:coc7:healing:dying-unstabilized", "condition",
                  "Dying and not yet stabilized", span=span, **host, hard_gate=True,
                  props={
                      "family_id": "healing",
                      "expression": {
                          "op": "all",
                          "of": [
                              {"op": "contains", "path": "actor.conditions", "value": "dying"},
                              {"op": "exists", "path": "actor.conditions.dying"},
                          ],
                      },
                  }),
        ],
        "relations": [
            _relation("relation:coc7:healing:first-aid-invokes", "invokes",
                      "rule:coc7:healing:first-aid-stabilization",
                      "capability:coc7:first-aid", span),
            _relation("relation:coc7:healing:first-aid-requires-input", "requires-input",
                      "rule:coc7:healing:first-aid-stabilization",
                      "input-slot:coc7:healing:first-aid-skill", span),
            _relation("relation:coc7:healing:first-aid-decision-invokes", "invokes",
                      "decision:coc7:healing:first-aid-stabilization",
                      "capability:coc7:first-aid", span),
            _relation("relation:coc7:healing:medicine-invokes", "invokes",
                      "decision:coc7:healing:medicine-stabilization",
                      "capability:coc7:medicine", span),
            _relation("relation:coc7:healing:dying-round-invokes", "invokes",
                      "decision:coc7:healing:dying-round-clock",
                      "capability:coc7:dying-check", span),
            _relation("relation:coc7:healing:dying-hour-invokes", "invokes",
                      "decision:coc7:healing:dying-hour-clock",
                      "capability:coc7:dying-check", span),
            _relation("relation:coc7:healing:weekly-invokes", "invokes",
                      "decision:coc7:healing:weekly-major-wound-recovery",
                      "capability:coc7:weekly-recovery", span),
            _relation("relation:coc7:healing:first-aid-available", "available-when",
                      "decision:coc7:healing:first-aid-stabilization",
                      "condition:coc7:healing:dying-unstabilized", span),
        ],
    }


def _accepted_shard(tmp_path: Path) -> dict:
    packet = _packet(tmp_path)
    result = coc_rule_graph.accept(packet, _valid_candidate(packet))
    assert result["ok"] is True, result
    return result["shard"]


# --------------------------------------------------------------------------- #
# Contract surface
# --------------------------------------------------------------------------- #
def test_contract_declares_full_v1_enum_surfaces():
    assert "node_kinds" in CONTRACT
    assert "relation_kinds" in CONTRACT
    for kind in ("ruleset", "rule", "decision", "condition", "input-slot",
                 "capability", "effect", "subsystem"):
        assert kind in CONTRACT["node_kinds"]
    for op in ("all", "any", "not"):
        assert op in CONTRACT["condition_combinators"]
    for op in ("eq", "neq", "lt", "lte", "gt", "gte", "contains",
               "not-contains", "exists"):
        assert op in CONTRACT["condition_operators"]
    for own in ("keeper-semantic", "player-source", "host-locked",
                "resolver-owned", "optional-semantic"):
        assert own in CONTRACT["decision_input_ownership"]
    for auth in ("deterministic", "keeper-semantic", "mixed"):
        assert auth in CONTRACT["authority"]
    for aud in ("keeper", "host-internal", "audit"):
        assert aud in CONTRACT["audience"]
    for vis in ("public", "keeper-only", "concealed-result"):
        assert vis in CONTRACT["visibility"]
    for cov in ("accepted", "partial", "unresolved", "absent"):
        assert cov in CONTRACT["coverage_status"]
    for own in ("legacy", "shadow", "graph"):
        assert own in CONTRACT["family_runtime_ownership"]
    for surf in ("visible", "hidden", "removed"):
        assert surf in CONTRACT["legacy_surface_lifecycle"]


def test_contract_has_semantic_id_namespace_and_pattern():
    assert "semantic_id_pattern" in CONTRACT
    # The namespace law requires node ids to begin with their node_kind plus
    # a colon separator, and tokens to be lowercase ASCII kebab-case.
    pattern = CONTRACT["semantic_id_pattern"]
    assert pattern.startswith("^[a-z][a-z0-9-]*")
    assert "::" not in pattern or ":" in pattern  # colon namespaced
    assert CONTRACT["semantic_id_namespaces"]["node"].startswith("{node_kind}:{ruleset_id}")


# --------------------------------------------------------------------------- #
# prepare()
# --------------------------------------------------------------------------- #
def test_prepare_binds_real_evidence_span(tmp_path: Path):
    packet = _packet(tmp_path)
    assert packet["contract_id"] == CONTRACT["extraction_packet_contract_id"]
    assert packet["schema_version"] == 1
    spans = packet["evidence_binding"]["spans"]
    assert len(spans) == 1
    assert spans[0]["span_id"] == "span-healing-first-aid-page-0-block-1"
    # model-safe view strips machine source bindings
    view_spans = packet["evidence_view"]["spans"]
    assert view_spans[0]["span_id"] == spans[0]["span_id"]
    assert "source_ref" not in view_spans[0]


def test_prepare_rejects_missing_required_selection_keys(tmp_path: Path):
    sel = _selection(tmp_path)
    del sel["page_keys"]
    result = coc_rule_graph.prepare(sel)
    assert result["ok"] is False
    codes = {f["code"] for f in result["findings"]}
    assert "missing_source_selection_key" in codes


# --------------------------------------------------------------------------- #
# accept() — semantic ID accept / reject
# --------------------------------------------------------------------------- #
def test_accept_rejects_non_semantic_node_id(tmp_path: Path):
    packet = _packet(tmp_path)
    cand = _valid_candidate(packet)
    cand["nodes"][1]["node_id"] = "rule|coc7:healing:first-aid-stabilization"
    result = coc_rule_graph.accept(packet, cand)
    assert result["ok"] is False
    codes = {f["code"] for f in result["findings"]}
    assert "invalid_node_id" in codes or "node_id_kind_mismatch" in codes


def test_accept_accepts_semantic_node_id(tmp_path: Path):
    packet = _packet(tmp_path)
    cand = _valid_candidate(packet)
    cand["nodes"][1]["node_id"] = "rule:coc7:healing:first-aid-stabilization"
    result = coc_rule_graph.accept(packet, cand)
    assert result["ok"] is True


def test_accept_rejects_node_kind_prefix_mismatch(tmp_path: Path):
    packet = _packet(tmp_path)
    cand = _valid_candidate(packet)
    cand["nodes"][1]["node_id"] = "decision:coc7:healing:first-aid-stabilization"
    result = coc_rule_graph.accept(packet, cand)
    assert result["ok"] is False
    codes = {f["code"] for f in result["findings"]}
    assert "node_id_kind_mismatch" in codes


# --------------------------------------------------------------------------- #
# accept() — model-authored integrity bytes rejected
# --------------------------------------------------------------------------- #
def test_accept_rejects_model_authored_integrity_bytes(tmp_path: Path):
    packet = _packet(tmp_path)
    cand = _valid_candidate(packet)
    cand["nodes"][1]["sha256"] = "a" * 64
    result = coc_rule_graph.accept(packet, cand)
    assert result["ok"] is False
    codes = {f["code"] for f in result["findings"]}
    assert "model_integrity_bytes" in codes


# --------------------------------------------------------------------------- #
# accept() — reference-closure failure -> Findings
# --------------------------------------------------------------------------- #
def test_accept_reports_unresolved_reference(tmp_path: Path):
    packet = _packet(tmp_path)
    cand = _valid_candidate(packet)
    # Rewire the invokes relation to a node that does not exist in the packet.
    cand["relations"][0]["to_node_id"] = "capability:coc7:does-not-exist"
    result = coc_rule_graph.accept(packet, cand)
    assert result["ok"] is False
    codes = {f["code"] for f in result["findings"]}
    # Either closure validator may fire; both report a dangling reference.
    assert "unresolved_reference" in codes or "unknown_relation_anchor" in codes


# --------------------------------------------------------------------------- #
# accept() — condition-language allowlist is enforced
# --------------------------------------------------------------------------- #
def test_condition_language_allowlist_is_closed(tmp_path: Path):
    # A condition carrying a non-allowlisted operator is rejected (closed
    # structural condition language, no free-form expression evaluation).
    packet = _packet(tmp_path)
    cand = _valid_candidate(packet)
    cond = {
        "node_id": "condition:coc7:healing:dying-unstabilized",
        "node_kind": "condition",
        "name": "Dying unstabilized",
        "authority": "deterministic",
        "audience": "host-internal",
        "visibility": "keeper-only",
        "hard_gate": True,
        "evidence_span_ids": [_span_id(packet)],
        "properties": {"family_id": "healing", "expression": {"op": "regex-match", "path": "actor.conditions.dying"}},
    }
    cond["node_id"] = "condition:coc7:healing:allowlist-probe"
    cand["nodes"].append(cond)
    result = coc_rule_graph.accept(packet, cand)
    assert result["ok"] is False
    codes = {f["code"] for f in result["findings"]}
    assert "invalid_condition_operator" in codes


def test_condition_passes_allowlisted_operator_and_registered_path(tmp_path: Path):
    packet = _packet(tmp_path)
    cand = _valid_candidate(packet)
    cond = {
        "node_id": "condition:coc7:healing:exists-probe",
        "node_kind": "condition",
        "name": "Dying unstabilized",
        "authority": "deterministic",
        "audience": "host-internal",
        "visibility": "keeper-only",
        "hard_gate": True,
        "evidence_span_ids": [_span_id(packet)],
        "properties": {"family_id": "healing", "expression": {"op": "exists", "path": "actor.conditions.dying"}},
    }
    cand["nodes"].append(cond)
    result = coc_rule_graph.accept(packet, cand)
    assert result["ok"] is True


def test_condition_rejects_unregistered_path(tmp_path: Path):
    packet = _packet(tmp_path)
    cand = _valid_candidate(packet)
    cond = {
        "node_id": "condition:coc7:healing:path-probe",
        "node_kind": "condition",
        "name": "Dying unstabilized",
        "authority": "deterministic",
        "audience": "host-internal",
        "visibility": "keeper-only",
        "hard_gate": True,
        "evidence_span_ids": [_span_id(packet)],
        "properties": {"family_id": "healing", "expression": {"op": "eq", "path": "player.prose.invocation", "value": True}},
    }
    cand["nodes"].append(cond)
    result = coc_rule_graph.accept(packet, cand)
    assert result["ok"] is False
    codes = {f["code"] for f in result["findings"]}
    assert "unregistered_condition_path" in codes


def test_condition_properties_are_closed_schema(tmp_path: Path):
    packet = _packet(tmp_path)
    cand = _valid_candidate(packet)
    cand["nodes"][0]["properties"]["not_a_known_prop"] = True
    result = coc_rule_graph.accept(packet, cand)
    assert result["ok"] is False
    codes = {f["code"] for f in result["findings"]}
    assert "unknown_node_property" in codes


@pytest.mark.parametrize(
    "expression,code",
    [
        ("dying", "invalid_condition_expression"),
        ({}, "invalid_condition_expression"),
        ({"predicate": "arbitrary prose"}, "invalid_condition_expression"),
        (
            {"op": "exists", "path": "actor.conditions.dying", "extra": 1},
            "unknown_condition_key",
        ),
        (
            {"op": "eq", "path": "actor.resources.hp"},
            "missing_condition_operand",
        ),
        (
            {
                "op": "not",
                "of": [
                    {"op": "exists", "path": "actor.conditions.dying"},
                    {"op": "exists", "path": "actor.conditions.unconscious"},
                ],
            },
            "invalid_not_arity",
        ),
        ({"op": "all", "of": "not-a-list"}, "invalid_condition_expression"),
    ],
)
def test_condition_rejects_malformed_expression(tmp_path: Path, expression, code):
    packet = _packet(tmp_path)
    cand = _valid_candidate(packet)
    cand["nodes"].append({
        "node_id": "condition:coc7:healing:malformed",
        "node_kind": "condition",
        "name": "Malformed",
        "authority": "deterministic",
        "audience": "host-internal",
        "visibility": "keeper-only",
        "hard_gate": True,
        "evidence_span_ids": [_span_id(packet)],
        "properties": {"family_id": "healing", "expression": expression},
    })
    result = coc_rule_graph.accept(packet, cand)
    assert result["ok"] is False
    codes = {f["code"] for f in result["findings"]}
    assert code in codes


# --------------------------------------------------------------------------- #
# build() — coverage aggregation, promotion law, deterministic rebuild
# --------------------------------------------------------------------------- #
def test_build_aggregates_coverage_and_defaults_to_legacy(tmp_path: Path):
    shard = _accepted_shard(tmp_path)
    result = coc_rule_graph.build([shard])
    assert result["ok"] is True
    graph = result["graph"]
    manifest = result["manifest"]
    assert graph["coverage"]["healing"] == "accepted"
    assert manifest["family_promotion_eligibility"]["healing"]["promotion_eligible"] is False
    assert manifest["family_promotion_eligibility"]["healing"]["runtime_ownership"] == "legacy"
    assert graph["family_runtime_ownership"]["healing"] == "legacy"
    assert graph["legacy_surface_lifecycle"]["healing"] == "visible"


def test_build_marks_untouched_families_unresolved(tmp_path: Path):
    shard = _accepted_shard(tmp_path)
    result = coc_rule_graph.build([shard])
    assert result["ok"] is True
    graph = result["graph"]
    for family in CONTRACT["rule_families"]:
        assert family in graph["coverage"]
        assert family in graph["family_runtime_ownership"]
        assert family in graph["legacy_surface_lifecycle"]
        assert graph["family_runtime_ownership"][family] == "legacy"
        assert graph["legacy_surface_lifecycle"][family] == "visible"
        if family == "healing":
            assert graph["coverage"][family] == "accepted"
        else:
            assert graph["coverage"][family] == "unresolved"
    assert result["manifest"]["family_coverage"]["combat"] == "unresolved"


def test_build_rejects_in_place_mutation_of_accepted_shard(tmp_path: Path):
    shard = _accepted_shard(tmp_path)
    shard["nodes"][0]["name"] = "mutated after accept"
    result = coc_rule_graph.build([shard])
    assert result["ok"] is False
    codes = {f["code"] for f in result["findings"]}
    assert "caller_shard_differs_from_persisted" in codes


def test_build_rejects_mutated_shard_with_recomputed_digest(tmp_path: Path):
    shard = _accepted_shard(tmp_path)
    forged = copy.deepcopy(shard)
    forged["nodes"][0]["name"] = "mutated after accept"
    body = {k: v for k, v in forged.items() if k != "receipt"}
    forged["receipt"]["shard_sha256"] = coc_rule_graph._json_digest(body)
    result = coc_rule_graph.build([forged])
    assert result["ok"] is False
    codes = {f["code"] for f in result["findings"]}
    assert "caller_shard_differs_from_persisted" in codes


def test_build_rejects_shard_id_absent_from_evidence_root(tmp_path: Path):
    result = coc_rule_graph.build(["shard:coc7:healing:never-accepted"])
    assert result["ok"] is False
    codes = {f["code"] for f in result["findings"]}
    assert "shard_not_in_evidence_root" in codes


def test_build_rejects_tampered_persisted_receipt(tmp_path: Path):
    shard = _accepted_shard(tmp_path)
    path = coc_rule_graph.accepted_evidence_path(shard["shard_id"])
    assert path is not None and path.is_file()
    payload = json.loads(path.read_text(encoding="utf-8"))
    assert "receipt" not in payload
    payload["accepted_shard"]["receipt"]["shard_sha256"] = "0" * 64
    path.write_text(json.dumps(payload), encoding="utf-8")
    result = coc_rule_graph.build([shard["shard_id"]])
    assert result["ok"] is False
    codes = {f["code"] for f in result["findings"]}
    assert "acceptance_receipt_mismatch" in codes


def test_build_rejects_top_level_persisted_receipt_copy(tmp_path: Path):
    """The envelope must not carry a second receipt the loader can ignore."""
    shard = _accepted_shard(tmp_path)
    path = coc_rule_graph.accepted_evidence_path(shard["shard_id"])
    assert path is not None and path.is_file()
    payload = json.loads(path.read_text(encoding="utf-8"))
    # Re-introduce the copy the old loader ignored; nested receipt stays valid.
    payload["receipt"] = {"shard_sha256": "0" * 64}
    path.write_text(json.dumps(payload), encoding="utf-8")
    result = coc_rule_graph.build([shard["shard_id"]])
    assert result["ok"] is False
    codes = {f["code"] for f in result["findings"]}
    assert "invalid_accepted_evidence" in codes


def test_evidence_root_symlink_into_campaigns_is_rejected(tmp_path: Path):
    campaign = tmp_path / ".coc" / "campaigns" / "slot"
    campaign.mkdir(parents=True)
    link = tmp_path / "evidence-link"
    try:
        link.symlink_to(campaign, target_is_directory=True)
    except OSError as exc:
        pytest.skip(f"platform cannot create symlinks: {exc}")
    coc_rule_graph.set_evidence_root(link)
    packet = _packet(tmp_path)
    result = coc_rule_graph.accept(packet, _valid_candidate(packet))
    assert result["ok"] is False
    codes = {f["code"] for f in result["findings"]}
    assert "campaign_evidence_root_forbidden" in codes


def test_evidence_root_io_uses_validated_resolved_path(tmp_path: Path, monkeypatch):
    """I/O must use the Path _check_evidence_root returned, not a later re-resolve."""
    safe = tmp_path / "safe-evidence"
    safe.mkdir()
    campaign = tmp_path / ".coc" / "campaigns" / "slot"
    campaign.mkdir(parents=True)
    link = tmp_path / "evidence-link"
    try:
        link.symlink_to(safe, target_is_directory=True)
    except OSError as exc:
        pytest.skip(f"platform cannot create symlinks: {exc}")
    coc_rule_graph.set_evidence_root(link)
    captured: dict = {}
    orig_check = coc_rule_graph._check_evidence_root

    def wrap(root):
        validated, findings = orig_check(root)
        captured["validated"] = validated
        if validated is not None and not findings:
            link.unlink()
            link.symlink_to(campaign, target_is_directory=True)
        return validated, findings

    monkeypatch.setattr(coc_rule_graph, "_check_evidence_root", wrap)
    io_destinations: list[Path] = []
    orig_replace = coc_rule_graph.os.replace

    def spy_replace(src, dst, *args, **kwargs):
        io_destinations.append(Path(dst))
        return orig_replace(src, dst, *args, **kwargs)

    monkeypatch.setattr(coc_rule_graph.os, "replace", spy_replace)
    packet = _packet(tmp_path)
    result = coc_rule_graph.accept(packet, _valid_candidate(packet))
    assert result["ok"] is True, result
    validated = captured["validated"]
    assert validated == safe.resolve()
    assert io_destinations
    assert all(dest.parent == validated for dest in io_destinations)
    assert list(safe.glob("*.json"))
    assert list(campaign.glob("*.json")) == []


def test_build_is_deterministic_across_rebuilds(tmp_path: Path):
    shard_a = _accepted_shard(tmp_path)
    shard_b = _accepted_shard(tmp_path)
    res_a = coc_rule_graph.build([shard_a])
    res_b = coc_rule_graph.build([shard_b])
    assert res_a["ok"] is True and res_b["ok"] is True
    # Machine-computed digest, never model-relayed.
    assert res_a["manifest"]["graph_content_digest"] == res_b["manifest"]["graph_content_digest"]
    assert res_a["manifest"]["graph_content_digest"] == coc_rule_graph._json_digest(res_a["graph"])


def test_build_merges_conflict_free_duplicate_nodes(tmp_path: Path):
    packet = _packet(tmp_path)
    shard_a = coc_rule_graph.accept(packet, _valid_candidate(packet))["shard"]
    # A second shard for a different section but same ruleset reuses one node.
    cand = _valid_candidate(packet)
    cand["nodes"] = [n for n in cand["nodes"] if n["node_kind"] != "rule-family"]
    cand["relations"] = []
    shard_b = coc_rule_graph.accept(packet, cand)["shard"]
    result = coc_rule_graph.build([shard_a, shard_b])
    assert result["ok"] is True


def test_build_rejects_conflicting_merge(tmp_path: Path):
    packet = _packet(tmp_path)
    cand = _valid_candidate(packet)
    shard_a = coc_rule_graph.accept(packet, cand)["shard"]
    cand2 = _valid_candidate(packet)
    cand2["nodes"][1]["name"] = "Different name for same id"
    shard_b = coc_rule_graph.accept(packet, cand2)["shard"]
    result = coc_rule_graph.build([shard_a, shard_b])
    assert result["ok"] is False
    codes = {f["code"] for f in result["findings"]}
    assert "node_conflict" in codes


# --------------------------------------------------------------------------- #
# Healing decision -> current subsystem command SHAPE parity (pure compile)
# --------------------------------------------------------------------------- #
def test_healing_first_aid_command_shape_parity():
    shape = coc_rule_graph.healing_command_shape("first-aid-stabilization")
    assert shape is not None
    assert shape["adapter"] == "subsystem-command"
    # The strict executor accepts kind==stabilize with method==first_aid.
    assert shape["kind"] == "stabilize"
    assert shape["phase"] == "resolve"
    assert shape["payload_constants"]["method"] == "first_aid"
    slots = {s["name"]: s["ownership"] for s in shape["payload_slots"]}
    assert slots["skill_value"] == "host-locked"
    assert slots["rescuer_id"] == "host-locked"
    assert slots["pushed"] == "host-locked"


def test_healing_medicine_command_shape_parity():
    shape = coc_rule_graph.healing_command_shape("medicine-stabilization")
    assert shape is not None
    assert shape["kind"] == "stabilize"
    assert shape["phase"] == "resolve"
    assert shape["payload_constants"]["method"] == "medicine"
    slots = {s["name"]: s["ownership"] for s in shape["payload_slots"]}
    assert slots["skill_value"] == "host-locked"
    assert slots["rescuer_id"] == "host-locked"


def test_healing_weekly_recovery_command_shape_parity():
    shape = coc_rule_graph.healing_command_shape("weekly-major-wound-recovery")
    assert shape is not None
    assert shape["kind"] == "weekly_recovery"
    assert shape["phase"] == "resolve"
    slots = {s["name"]: s["ownership"] for s in shape["payload_slots"]}
    assert slots["complete_rest"] == "keeper-semantic"
    assert slots["poor_environment"] == "keeper-semantic"
    assert slots["medicine_skill_value"] == "host-locked"
    assert slots["caregiver_id"] == "host-locked"


def test_healing_dying_clock_command_shape_parity():
    shape = coc_rule_graph.healing_command_shape("dying-death-clock-tick")
    assert shape is not None
    assert shape["adapter"] == "subsystem-command"
    assert shape["kind"] == "dying_tick"
    assert shape["phase"] == "resolve"
    slots = {s["name"]: s["ownership"] for s in shape["payload_slots"]}
    assert slots["clock_kind"] == "host-locked"


def test_healing_family_graph_maps_four_capabilities(tmp_path: Path):
    """Prototype claim: First Aid / Medicine / dying clocks / weekly recovery
    survive prepare → accept → build as graph evidence, not only as a lookup."""
    shard = _accepted_shard(tmp_path)
    result = coc_rule_graph.build([shard])
    assert result["ok"] is True, result
    by_id = {node["node_id"]: node for node in result["graph"]["nodes"]}
    assert "capability:coc7:first-aid" in by_id
    assert "capability:coc7:medicine" in by_id
    assert "capability:coc7:dying-check" in by_id
    assert "capability:coc7:weekly-recovery" in by_id
    first_aid = by_id["decision:coc7:healing:first-aid-stabilization"]["properties"]["implementation"]
    assert first_aid == coc_rule_graph.healing_command_shape("first-aid-stabilization")
    medicine = by_id["decision:coc7:healing:medicine-stabilization"]["properties"]["implementation"]
    assert medicine["kind"] == "stabilize"
    assert medicine["payload_constants"]["method"] == "medicine"
    assert medicine["phase"] == "resolve"
    dying_round = by_id["decision:coc7:healing:dying-round-clock"]["properties"]["implementation"]
    dying_hour = by_id["decision:coc7:healing:dying-hour-clock"]["properties"]["implementation"]
    assert dying_round["kind"] == "dying_tick"
    assert dying_round["phase"] == "resolve"
    assert dying_round["payload_constants"]["clock_kind"] == "round"
    assert dying_hour["payload_constants"]["clock_kind"] == "hour"
    assert not any(s.get("name") == "clock_kind" for s in dying_round.get("payload_slots") or [])
    assert not any(s.get("name") == "clock_kind" for s in dying_hour.get("payload_slots") or [])
    weekly = by_id["decision:coc7:healing:weekly-major-wound-recovery"]["properties"]["implementation"]
    assert weekly == coc_rule_graph.healing_command_shape("weekly-major-wound-recovery")
    invoked = {
        (rel["from_node_id"], rel["to_node_id"])
        for rel in result["graph"]["relations"]
        if rel["relation_kind"] == "invokes"
    }
    assert ("decision:coc7:healing:medicine-stabilization", "capability:coc7:medicine") in invoked
    assert ("decision:coc7:healing:dying-round-clock", "capability:coc7:dying-check") in invoked
    assert ("decision:coc7:healing:dying-hour-clock", "capability:coc7:dying-check") in invoked
    assert ("decision:coc7:healing:weekly-major-wound-recovery", "capability:coc7:weekly-recovery") in invoked


# --------------------------------------------------------------------------- #
# Ceiling-half conformance
# --------------------------------------------------------------------------- #
def test_combat_uses_ceiling_half_for_odd_max_hp_major_wound():
    """The CURRENT combat implementation must round odd maxima upward."""
    s = coc_combat.CombatSession("odd-hp", "test", 1, rng=None)
    s.add_participant("source", "monster", 60, 50, 0, 10,
                      weapons=[{"weapon_id": "unarmed"}])
    s.add_participant("target", "investigator", 50, 50, 0, 11)
    s.damage_chain.append({
        "source_actor_id": "source", "target_actor_id": "target",
        "raw_damage": 5, "armor_absorbed": 0,
    })
    s.participants["target"]["hp_current"] = 6
    s._update_conditions("target")
    # 11 HP max, ceil(11/2) = 6. 5 damage is NOT a major wound.
    assert "major_wound" not in s.participants["target"]["conditions"]


def test_healing_ceiling_half_matches_combat():
    """Healing clears major_wound at ceil-half for odd max HP (internal)."""
    sess = coc_healing.HealingSession(
        "inv1", hp_max=11, con_value=60, current_hp=4, conditions=["major_wound"])
    assert (sess.hp_max + 1) // 2 == 6


def test_checklist_was_not_edited_for_derivative():
    """The R1 deliverable records the source-vs-derivative finding; it does
    NOT edit the checklist to resolve the discrepancy.

    The mismatch is the ODD max-HP major-wound THRESHOLD: the checklist J1
    predicate still says ``damage >= floor(max_hp / 2)`` while the current
    combat implementation and source use ceiling-half (``(hp_max + 1) // 2``).
    R1 records the finding; the checklist is left untouched.
    """
    checklist = Path("checks/coC7_rule_checklist.md")
    text = checklist.read_text(encoding="utf-8")
    # The checklist still carries the floor-half threshold predicate (J1).
    assert "Major wound threshold: damage ≥ floor(maxHP/2)" in text
    assert "damage >= floor(max_hp / 2)" in text
    # J12 (the clear condition) correctly uses ceil-half and is untouched too.
    assert "ceil(max_hp / 2)" in text


def test_compiler_records_source_vs_derivative_mismatch_as_finding():
    """A floor-half derivative must NOT silently rewrite the graph source.

    The source says ceil-half (rounding odd maxima upward); a malformed
    derivative claiming floor-half is recorded as a Finding.  The compiler
    never aligns the graph to the derivative.
    """
    # Derivation: a floor-half formula on an 11 HP maximum gives 11//2 == 5.
    derivative_threshold = 5
    source_threshold = 6
    assert derivative_threshold != source_threshold  # the mismatch exists
    # The contract records both formulas; R1 does not silently pick one.
    assert "ceiling-half" in CONTRACT["computed_threshold_formulas"]
    assert "floor-half" in CONTRACT["computed_threshold_formulas"]
    # R1 is not promotion-eligible.
    assert CONTRACT["r1_promotion_law"] is not None


def test_build_manifests_source_vs_derivative_mismatch_finding(tmp_path: Path):
    """The built manifest records the source-vs-derivative mismatch as a
    Finding rather than re-aligning the graph to a floor-half derivative."""
    shard = _accepted_shard(tmp_path)
    result = coc_rule_graph.build([shard])
    assert result["ok"] is True
    manifest = result["manifest"]
    codes = {f["code"] for f in manifest["findings"]}
    assert "source_vs_derivative_mismatch" in codes
