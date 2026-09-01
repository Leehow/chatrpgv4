"""Structured audience/phase/contract metadata for every toolbox operation."""
from __future__ import annotations

from dataclasses import FrozenInstanceError
import importlib.util
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "plugins" / "coc-keeper" / "scripts"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_toolbox = _load("coc_toolbox_operation_policy", SCRIPTS / "coc_toolbox.py")
coc_operation_policy = coc_toolbox.coc_operation_policy


def test_registry_owns_immutable_normalized_specs_per_toolbox_instance():
    registry = coc_toolbox.OPERATION_REGISTRY
    assert isinstance(coc_toolbox.TOOLS, dict)
    assert set(registry.specs) == set(coc_toolbox.TOOLS)

    finalizer = registry.get("turn.finalize")
    assert finalizer.name == "turn.finalize"
    assert finalizer.handler is coc_toolbox.TOOLS["turn.finalize"]["handler"]
    assert finalizer.policy.public() == coc_toolbox.operation_policy(
        "turn.finalize"
    )
    assert finalizer.execution_class == "serial_campaign"
    assert finalizer.params["decision_id"]["required"] is True
    with pytest.raises(FrozenInstanceError):
        finalizer.name = "turn.changed"
    with pytest.raises(TypeError):
        finalizer.params["decision_id"] = {"type": "string"}

    second = _load(
        "coc_toolbox_operation_policy_isolated",
        SCRIPTS / "coc_toolbox.py",
    )
    assert second.OPERATION_REGISTRY is not registry
    assert second.TOOLS is not coc_toolbox.TOOLS
    assert set(second.OPERATION_REGISTRY.specs) == set(registry.specs)


def test_temporary_legacy_registration_is_removed_from_registry_with_dict_entry():
    name = "test.registry_cleanup"

    @coc_toolbox.tool(name, "temporary", {}, needs_campaign=False)
    def _temporary(_ctx, _args):
        return {}, [], []

    try:
        assert name in coc_toolbox.TOOLS
        assert name in coc_toolbox.OPERATION_REGISTRY.specs
    finally:
        del coc_toolbox.TOOLS[name]
    assert name not in coc_toolbox.OPERATION_REGISTRY.specs


def test_every_registered_operation_has_valid_policy():
    names = sorted(coc_toolbox.TOOLS)
    assert "state.deliver_handout" in names
    assert "state.replay_handout" in names
    policies = coc_operation_policy.policies_for_operations(names)
    assert set(policies) == set(names)
    for name, policy in policies.items():
        public = coc_operation_policy.public_policy(policy)
        assert public["audience"] in coc_operation_policy.AUDIENCES
        assert public["phases"]
        assert set(public["phases"]) <= coc_operation_policy.PHASES
        assert public["contract"] in coc_operation_policy.CONTRACTS
        assert public["kp_surface"] in coc_operation_policy.KP_SURFACES
        assert public["discovery"] in coc_operation_policy.DISCOVERY_MODES
        assert public["advisory"] is True or public["advisory"] is False
        attached = coc_toolbox.TOOLS[name]["policy"]
        assert coc_operation_policy.public_policy(attached) == public


def test_execution_class_is_explicit_exported_and_fails_closed():
    allowed = {"parallel_read", "serial_campaign", "serial_global"}
    assert {spec["execution_class"] for spec in coc_toolbox.TOOLS.values()} <= allowed
    assert {
        name for name, spec in coc_toolbox.TOOLS.items()
        if spec["execution_class"] == "parallel_read"
    } == {"rules.context", "rules.skill_describe", "setup.phase"}
    for name in (
        "npc.reaction",
        "progressive.prepare_opening",
        "state.inventory_list",
        "rules.roll",
        "rules.roll_dice",
        "state.journal",
        "state.move_scene",
        "setup.complete",
        "turn.finalize",
    ):
        assert coc_toolbox.TOOLS[name]["execution_class"] == "serial_campaign"
    assert coc_toolbox._describe("setup.phase")["execution_class"] == "parallel_read"
    listed = {row["name"]: row for row in coc_toolbox.list_tools()}
    assert listed["progressive.prepare_opening"]["execution_class"] == "serial_campaign"

    with pytest.raises(ValueError, match="parallel_read requires strict_read_only"):
        coc_toolbox.tool(
            "test.invalid_parallel_read", "test", {}, access="query",
            execution_class="parallel_read",
        )

    @coc_toolbox.tool("test.unknown_execution_class", "test", {}, access="query", execution_class="unknown")
    def _unknown_execution_class(_ctx, _args):
        return {}, [], []

    try:
        assert coc_toolbox.TOOLS["test.unknown_execution_class"]["execution_class"] == "serial_campaign"
    finally:
        del coc_toolbox.TOOLS["test.unknown_execution_class"]


def test_exception_map_must_match_registry_exactly():
    with pytest.raises(ValueError, match="exceptions not present"):
        coc_operation_policy.policies_for_operations(
            name for name in coc_toolbox.TOOLS if name != "steward.scene_supply"
        )


def test_unknown_domain_fails_closed():
    with pytest.raises(KeyError, match="no domain policy default"):
        coc_operation_policy.policy_for_operation("unknown.op")


def test_source_worker_lifecycle_is_not_live_kp():
    live = set(coc_toolbox.query_operations(audience="keeper"))
    hidden = coc_operation_policy.SOURCE_WORKER_LIFECYCLE_OPERATIONS
    assert hidden <= set(coc_toolbox.TOOLS)
    assert live.isdisjoint(hidden)
    for name in hidden:
        policy = coc_toolbox.operation_policy(name)
        assert policy["audience"] == "source_worker"
        assert policy["contract"] == "source_lifecycle"
        assert policy["kp_surface"] == "none"


def test_audit_and_host_publication_are_not_live_kp():
    live = set(coc_toolbox.query_operations(audience="keeper"))
    assert "development.settle" not in live
    assert coc_toolbox.operation_policy("development.settle")["audience"] == "host"
    assert "progressive.project_opening" not in live
    assert "progressive.status" not in live
    assert "progressive.claim_host_work" not in live


def test_host_invoke_compat_excludes_steward_writes():
    compat = coc_operation_policy.HOST_INVOKE_COMPAT_OPERATIONS
    assert "progressive.status" in compat
    assert "steward.domain_put" not in compat
    assert "progressive.claim_host_work" not in compat


def test_steward_writes_are_not_live_kp():
    live = set(coc_toolbox.query_operations(audience="keeper"))
    for name in (
        "steward.domain_put",
        "steward.scene_bundle_put",
        "steward.deliver",
        "steward.mark_consumed",
        "steward.notebook_put",
        "steward.notebook_pay",
    ):
        assert name not in live
        assert coc_toolbox.operation_policy(name)["kp_surface"] == "none"
        assert coc_toolbox.operation_policy(name)["audience"] == "host"


OPENING_CHARACTER_SETUP_REQUIRED = (
    "setup.adopt_source_facts",
    "setup.investigator_contract",
    "setup.invoke",
    "rules.roll_dice",
    "rules.cash_assets",
    "state.cash_semantic",
)


def test_opening_character_setup_ops_are_phase_allowed_without_opening_all_writes():
    for name in OPENING_CHARACTER_SETUP_REQUIRED:
        policy = coc_toolbox.operation_policy(name)
        assert "opening" in policy["phases"], name
        assert "cold_start" in policy["phases"], name
    assert "opening" not in coc_toolbox.operation_policy("rules.roll")["phases"]
    assert "opening" not in coc_toolbox.operation_policy("state.move_scene")["phases"]
    assert "cold_start" not in coc_toolbox.operation_policy("state.record_clue")["phases"]
    live = set(coc_toolbox.query_operations(audience="keeper"))
    for name in (
        "steward.domain_put",
        "steward.scene_bundle_put",
        "steward.deliver",
        "steward.mark_consumed",
        "steward.notebook_put",
        "steward.notebook_pay",
        "progressive.claim_host_work",
        "progressive.fulfill_host_work",
        "development.settle",
    ):
        assert name not in live


def test_pending_finalization_is_encoded_on_repair_ops():
    pending = set(coc_toolbox.query_operations(phase="pending_finalization"))
    assert {
        "turn.finalize",
        "turn.output_context",
        "state.journal",
        "state.exceptional_effect",
        "state.supersede_settlement",
        "scene.context",
    } <= pending
    assert "state.move_scene" not in pending
    assert "rules.roll" not in pending


def test_recovery_exposes_turn_closure_without_new_mutations():
    recovery = set(coc_toolbox.query_operations(phase="recovery"))
    assert {
        "turn.finalize",
        "turn.output_context",
        "state.journal",
        "session.resume",
        "state.supersede_settlement",
    } <= recovery
    for name in (
        "rules.roll",
        "rules.social_adjudicate",
        "state.move_scene",
        "state.promote_scene",
        "state.item_grant",
        "state.cash_semantic",
        "state.exceptional_effect",
        "evidence.table_opening",
        "progressive.on_enter_scene",
    ):
        assert name not in recovery, name
    if "state.cash_grant" in coc_toolbox.TOOLS:
        assert "state.cash_grant" not in recovery
    if "state.cash_spend" in coc_toolbox.TOOLS:
        assert "state.cash_spend" not in recovery


def test_kp_can_consume_steward_scene_supply():
    policy = coc_toolbox.operation_policy("steward.scene_supply")
    assert policy["audience"] == "keeper"
    assert policy["kp_surface"] == "context"
    assert "steward.scene_supply" in coc_toolbox.query_operations(
        audience="keeper", kp_surface="context"
    )
    assert coc_toolbox.operation_policy("steward.domain_put")["audience"] == "host"
    assert coc_toolbox.operation_policy("steward.domain_put")["kp_surface"] == "none"
    resume = coc_toolbox.operation_policy("session.resume")
    assert resume["audience"] == "keeper"
    assert resume["kp_surface"] == "setup"


def test_advisory_is_not_rewritten_as_query_access():
    advise = coc_toolbox.operation_policy("director.advise")
    assert advise["advisory"] is True
    assert advise["contract"] == "advisory"
    # access stays whatever the tool already declared; advisory is not a rewrite.
    assert coc_toolbox.TOOLS["director.advise"]["access"] in {"query", "mutation"}
    roll = coc_toolbox.operation_policy("rules.roll")
    assert roll["advisory"] is False
    assert roll["contract"] == "rules"
    assert coc_toolbox.TOOLS["rules.roll"]["access"] == "mutation"
    journal = coc_toolbox.operation_policy("state.journal")
    assert journal["advisory"] is False
    assert journal["contract"] == "state"
    assert coc_toolbox.TOOLS["state.journal"]["access"] == "mutation"


def test_describe_and_list_carry_policy_without_changing_access():
    described = coc_toolbox._describe("turn.finalize")
    assert described["access"] == "mutation"
    assert described["policy"]["contract"] == "finalize"
    assert described["policy"]["audience"] == "keeper"
    listed = {entry["name"]: entry for entry in coc_toolbox.list_tools()}
    assert listed["rules.roll"]["access"] == "mutation"
    assert listed["rules.roll"]["policy"]["kp_surface"] == "none"
    assert listed["rules.settle"]["policy"]["kp_surface"] == "rules"
    assert listed["setup.inspect"]["policy"]["audience"] == "setup"


def test_query_helper_is_structured_not_keyword():
    source = coc_toolbox.query_operations(contract="source_lifecycle")
    assert "progressive.claim_host_work" in source
    assert "rules.roll" not in source
    opening_setup = coc_toolbox.query_operations(
        audience="keeper", phase="opening", kp_surface="setup"
    )
    assert "progressive.prepare_opening" in opening_setup
    assert "progressive.fulfill_host_work" not in opening_setup


HEALING_LEGACY_OPERATIONS = (
    "rules.first_aid",
    "rules.dying_check",
    "rules.medicine",
    "rules.weekly_recovery",
)


def test_healing_legacy_ops_are_host_internal_after_graph_cutover():
    live = set(coc_toolbox.query_operations(audience="keeper"))
    live_rules = set(coc_toolbox.query_operations(audience="keeper", kp_surface="rules"))
    for name in HEALING_LEGACY_OPERATIONS:
        assert name in coc_toolbox.TOOLS
        assert name not in live
        assert name not in live_rules
        policy = coc_toolbox.operation_policy(name)
        assert policy["audience"] == "host"
        assert policy["kp_surface"] == "none"
    assert "rules.settle" in live_rules
    settle = coc_toolbox.operation_policy("rules.settle")
    assert settle["audience"] == "keeper"
    assert settle["kp_surface"] == "rules"
    assert settle["phases"] == ["live_turn"]


HIDDEN_CHECK_LUCK_PRIMITIVES = (
    "rules.check",
    "rules.resource_delta",
)


def test_check_and_resource_delta_are_host_internal_not_keeper_visible():
    live = set(coc_toolbox.query_operations(audience="keeper"))
    live_rules = set(coc_toolbox.query_operations(audience="keeper", kp_surface="rules"))
    for name in HIDDEN_CHECK_LUCK_PRIMITIVES:
        assert name in coc_toolbox.TOOLS
        assert name not in live
        assert name not in live_rules
        policy = coc_toolbox.operation_policy(name)
        assert policy["audience"] == "host"
        assert policy["kp_surface"] == "none"
    assert "rules.roll" not in live_rules
    assert "rules.push" not in live_rules
    assert "rules.luck_spend" not in live_rules
    assert "rules.settle" in live_rules


def test_rules_context_is_keeper_visible_on_the_normal_rules_surface():
    policy = coc_toolbox.operation_policy("rules.context")
    assert policy["audience"] == "keeper"
    assert policy["kp_surface"] == "rules"
    assert policy["phases"] == ["live_turn"]
    assert policy["discovery"] == "surface"
    assert "rules.context" in coc_toolbox.query_operations(
        audience="keeper", kp_surface="rules", phase="live_turn",
        discovery="surface",
    )
    assert "rules.context" not in coc_toolbox.query_operations(kp_surface="context")


def test_rules_settle_schema_has_no_model_controlled_rng_seed():
    assert "seed" not in coc_toolbox.TOOLS["rules.settle"]["params"]


def test_no_hard_rules_operation_exposes_test_rng_seed_to_the_model():
    exposed = [
        name for name, spec in coc_toolbox.TOOLS.items()
        if coc_toolbox.operation_policy(name)["contract"] == "rules"
        and "seed" in spec["params"]
    ]
    assert exposed == []
