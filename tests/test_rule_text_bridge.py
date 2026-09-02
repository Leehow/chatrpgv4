"""W1 runtime bridge: RuleGraph public effects -> finalization audit field.

Cross-graph wiring spec (docs/specs/pi-coc-cross-graph-wiring.md) §5 W1,
deliverables 1+2 only: the deterministic decision -> public-effect mapping
and its attachment as ``rule_effect_refs`` onto state effects derived from
graph-owned ``rules.settle`` receipts.  No rendering, no text-graph, no
ledger here.

Guards pinned:
- keeper-only effects (``effect:coc7:push-luck:luck-spend-mutate``) never
  surface through the bridge;
- non-graph families and receipts without ``decision_ref`` attach nothing;
- ``_stable_effect_id`` digest inputs/outputs are untouched (bit-equality of
  pre-bridge receipts).
"""
from __future__ import annotations

from pathlib import Path
import sys

SCRIPTS = Path(__file__).resolve().parents[1] / "plugins" / "coc-keeper" / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import coc_rules_runtime
import coc_rulesets
import coc_turn_finalization

KEEPER_ONLY_EFFECT = "effect:coc7:push-luck:luck-spend-mutate"
RULESET_ID = coc_rulesets.DEFAULT_RULESET_ID


def _load_graph() -> dict:
    loaded = coc_rules_runtime.load_ruleset_graph(RULESET_ID)
    assert loaded.get("ok"), f"coc7 RuleGraph must load: {loaded.get('findings')}"
    return loaded["graph"]


def _settle_call(
    *,
    decision_id: str = "turn-1:call-1",
    family: str | None = "development",
    decision_ref: str | None = "decision:coc7:development:settle-ending",
    with_receipt: bool = True,
) -> dict:
    data: dict = {"investigator_id": "inv-1"}
    if family is not None:
        data["family"] = family
    if decision_ref is not None:
        data["decision_ref"] = decision_ref
    if with_receipt:
        resource = coc_rulesets.ruleset_resources(RULESET_ID)[0]
        data["player_state_receipt"] = {
            "investigator_id": "inv-1",
            str(resource["key"]): {"before": 10, "after": 7},
        }
    return {"ok": True, "tool": "rules.settle",
            "args": {"decision_id": decision_id}, "data": data}


# --------------------------------------------------------------------------- #
# a. Mapping correctness on the real compiled coc7 RuleGraph
# --------------------------------------------------------------------------- #
def test_public_effect_refs_mapping_on_real_graph():
    refs = coc_rules_runtime.public_effect_refs_for_decision(
        "decision:coc7:development:settle-ending"
    )
    assert refs == [
        "effect:coc7:development:settle-ending-luck-recovery",
        "effect:coc7:development:settle-ending-san-reward",
        "effect:coc7:development:settle-ending-skill-improvement",
    ]
    assert coc_rules_runtime.public_effect_refs_for_decision(
        "decision:coc7:chase:start"
    ) == ["effect:coc7:chase:start-chase-started"]


def test_public_effect_refs_unknown_or_non_decision_input_is_empty():
    assert coc_rules_runtime.public_effect_refs_for_decision(
        "decision:coc7:no-such-family:no-such-decision"
    ) == []
    assert coc_rules_runtime.public_effect_refs_for_decision(KEEPER_ONLY_EFFECT) == []
    assert coc_rules_runtime.public_effect_refs_for_decision("") == []
    assert coc_rules_runtime.public_effect_refs_for_decision(None) == []  # type: ignore[arg-type]
    assert coc_rules_runtime.public_effect_refs_for_decision("garbage") == []


def test_runtime_method_matches_plan_for_visibility_semantics():
    graph = _load_graph()
    runtime = coc_rules_runtime.RulesRuntime(graph, ruleset_id=RULESET_ID)
    nodes = {node["node_id"]: node for node in graph["nodes"]}
    for decision_id in runtime.node_ids_by_kind("decision"):
        for effect_id in runtime.public_effect_refs_for(decision_id):
            effect = nodes[effect_id]
            visibility = (
                (effect.get("properties") or {}).get("visibility")
                or effect.get("visibility")
            )
            assert visibility not in {"keeper-only", "concealed-result"}


# --------------------------------------------------------------------------- #
# b. keeper-only guard: luck-spend-mutate never crosses the bridge
# --------------------------------------------------------------------------- #
def test_keeper_only_effect_never_returned_by_mapping():
    runtime = coc_rules_runtime.RulesRuntime(_load_graph(), ruleset_id=RULESET_ID)
    for decision_id in runtime.node_ids_by_kind("decision"):
        assert KEEPER_ONLY_EFFECT not in runtime.public_effect_refs_for(decision_id)
    # Its own emitter is graph-owned but must map to an empty public list.
    assert coc_rules_runtime.public_effect_refs_for_decision(
        "decision:coc7:push-luck:luck-spend"
    ) == []


def test_keeper_only_effect_never_attached_by_finalization():
    effects = coc_turn_finalization._project_state_deltas(
        [_settle_call(family="push-luck",
                      decision_ref="decision:coc7:push-luck:luck-spend")],
        ruleset_id=RULESET_ID,
    )
    assert effects, "the settle receipt must still project its state delta"
    for effect in effects:
        assert KEEPER_ONLY_EFFECT not in effect.get("rule_effect_refs", [])


def test_keeper_only_effect_node_stays_keeper_only_in_graph():
    # Derived from the graph, not hardcoded policy: the guard follows the
    # compiled visibility attribute.
    effect = next(
        node for node in _load_graph()["nodes"]
        if node.get("node_id") == KEEPER_ONLY_EFFECT
    )
    visibility = (effect.get("properties") or {}).get("visibility") or effect.get("visibility")
    assert visibility == "keeper-only"


# --------------------------------------------------------------------------- #
# c. No attachment for non-graph families / missing decision_ref
# --------------------------------------------------------------------------- #
def test_non_graph_family_receipt_attaches_nothing():
    effects = coc_turn_finalization._project_state_deltas(
        [_settle_call(family="not-a-graph-family",
                      decision_ref="decision:coc7:core-check:ordinary-check")],
        ruleset_id=RULESET_ID,
    )
    assert effects
    for effect in effects:
        assert "rule_effect_refs" not in effect


def test_receipt_without_decision_ref_attaches_nothing():
    effects = coc_turn_finalization._project_state_deltas(
        [_settle_call(family="development", decision_ref=None)],
        ruleset_id=RULESET_ID,
    )
    assert effects
    for effect in effects:
        assert "rule_effect_refs" not in effect


def test_non_settle_call_with_decision_ref_attaches_nothing():
    call = {
        "ok": True,
        "tool": "rules.damage",
        "args": {"decision_id": "turn-1:call-2"},
        "data": {
            "investigator_id": "inv-1",
            "decision_ref": "decision:coc7:combat:attack",
            "hp_before": 10,
            "hp_after": 6,
        },
    }
    effects = coc_turn_finalization._project_state_deltas([call], ruleset_id=RULESET_ID)
    assert effects
    for effect in effects:
        assert "rule_effect_refs" not in effect


# --------------------------------------------------------------------------- #
# d. Hash isolation: digest inputs/outputs byte-identical to pre-bridge
# --------------------------------------------------------------------------- #
# Pinned values captured BEFORE the bridge landed; any change means the
# digest input list moved, which the spec forbids (design decision 3).
_PINNED_STABLE_IDS = {
    ("decision-x", "scalar", "HP"): "turn-effect-v1:3e41fc262a7d9b1bcf4efe900954e29656e03367",
    ("decision:coc7:sanity:resolve-check", "scalar", "SAN"):
        "turn-effect-v1:566ec927b8357324db41805f5f11089667678d51",
}


def test_stable_effect_id_digest_unchanged():
    for (decision_id, category, key), pinned in _PINNED_STABLE_IDS.items():
        assert coc_turn_finalization._stable_effect_id(decision_id, category, key) == pinned


def test_old_receipt_shape_replays_byte_identically():
    """A pre-bridge settle receipt (no family/decision_ref) gains no key."""
    resource = coc_rulesets.ruleset_resources(RULESET_ID)[0]
    display = str(resource["display"])
    key = str(resource["key"])
    old_call = {
        "ok": True,
        "tool": "rules.settle",
        "args": {"decision_id": "turn-1:call-1"},
        "data": {
            "investigator_id": "inv-1",
            "player_state_receipt": {
                "investigator_id": "inv-1",
                key: {"before": 10, "after": 7},
            },
        },
    }
    effects = coc_turn_finalization._project_state_deltas([old_call], ruleset_id=RULESET_ID)
    assert effects == [{
        "schema_version": 1,
        "category": "state_delta",
        "effect_id": coc_turn_finalization._stable_effect_id(
            "turn-1:call-1", "scalar", display
        ),
        "effect_kind": "scalar",
        "resource": display,
        "investigator_id": "inv-1",
        "before": 10,
        "delta": -3,
        "after": 7,
        "source_decision_id": "turn-1:call-1",
    }]


def test_graph_owned_settle_attaches_public_refs_as_audit_field():
    effects = coc_turn_finalization._project_state_deltas(
        [_settle_call()], ruleset_id=RULESET_ID
    )
    assert effects
    expected = coc_rules_runtime.public_effect_refs_for_decision(
        "decision:coc7:development:settle-ending"
    )
    assert expected
    for effect in effects:
        assert effect.get("rule_effect_refs") == expected
        # Audit field only: the stable id stays derived from the old inputs.
        assert effect["effect_id"] == coc_turn_finalization._stable_effect_id(
            "turn-1:call-1", "scalar", effect["resource"]
        )
