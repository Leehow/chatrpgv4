"""Healing Keeper surface after RuleGraph graph/hidden cutover."""
from __future__ import annotations

from pathlib import Path

from test_operation_policy import HEALING_LEGACY_OPERATIONS, coc_toolbox
from toolbox_test_support import _run, campaign_ws  # noqa: F401


def test_graph_healing_hides_legacy_ops_and_exposes_settle(campaign_ws):
    for name in HEALING_LEGACY_OPERATIONS:
        assert name in coc_toolbox.TOOLS
        policy = coc_toolbox.operation_policy(name)
        assert policy["audience"] == "host"
        assert policy["kp_surface"] == "none"
    settle = coc_toolbox.operation_policy("rules.settle")
    assert settle["audience"] == "keeper"
    assert settle["kp_surface"] == "rules"


def test_rules_settle_denies_non_healing_families(campaign_ws):
    result = _run(campaign_ws, "rules.settle", {
        "investigator": campaign_ws["investigator_id"],
        "decision_ref": "decision:coc7:combat:ordinary-attack",
        "semantic_inputs": {},
        "decision_id": "settle-non-healing-1",
    })
    assert result["ok"] is False, result
    assert result["error"]["code"] == "no_candidate_in_compiled_scope"


def test_mcp_archive_and_generated_policy_are_deterministic():
    import importlib.util

    path = Path("plugins/coc-keeper/scripts/coc_mcp_contract_archive.py")
    spec = importlib.util.spec_from_file_location("coc_mcp_contract_archive", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    archive = module.build_archive(coc_toolbox)
    projection = module.build_policy_projection(coc_toolbox)
    assert archive["operation_count"] == 145
    assert "rules.settle" in archive["operations"]
    assert "rules.context" in archive["operations"]
    for name in HEALING_LEGACY_OPERATIONS:
        assert name in archive["operations"]
        assert archive["operations"][name]["policy"]["kp_surface"] == "none"
        assert name not in projection["operations_by_surface"]["rules"]
    assert "rules.settle" in projection["operations_by_surface"]["rules"]
    assert "rules.context" not in projection["operations_by_surface"]["context"]
    assert "rules.context" not in projection["operations_by_surface"]["rules"]
    regenerated = module.archive_to_canonical_bytes(archive)
    again = module.archive_to_canonical_bytes(module.build_archive(coc_toolbox))
    assert regenerated == again
    policy_bytes = module.policy_projection_to_canonical_bytes(projection)
    assert policy_bytes == module.policy_projection_to_canonical_bytes(
        module.build_policy_projection(coc_toolbox)
    )
