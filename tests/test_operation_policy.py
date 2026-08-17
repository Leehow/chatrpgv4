"""Structured audience/phase/contract metadata for every toolbox operation."""
from __future__ import annotations

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


def test_every_registered_operation_has_valid_policy():
    names = sorted(coc_toolbox.TOOLS)
    assert len(names) == 110
    policies = coc_operation_policy.policies_for_operations(names)
    assert set(policies) == set(names)
    for name, policy in policies.items():
        public = coc_operation_policy.public_policy(policy)
        assert public["audience"] in coc_operation_policy.AUDIENCES
        assert public["phases"]
        assert set(public["phases"]) <= coc_operation_policy.PHASES
        assert public["contract"] in coc_operation_policy.CONTRACTS
        assert public["kp_surface"] in coc_operation_policy.KP_SURFACES
        assert public["advisory"] is True or public["advisory"] is False
        attached = coc_toolbox.TOOLS[name]["policy"]
        assert coc_operation_policy.public_policy(attached) == public


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
    assert coc_toolbox.operation_policy("development.settle")["audience"] == "audit"
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
    assert listed["rules.roll"]["policy"]["kp_surface"] == "rules"
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


