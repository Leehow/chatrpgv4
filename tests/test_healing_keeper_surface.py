"""Healing Keeper surface while RuleGraph remains shadow-owned."""
from __future__ import annotations

import json
from pathlib import Path

from test_operation_policy import HEALING_LEGACY_OPERATIONS, coc_toolbox
from toolbox_test_support import _run, campaign_ws  # noqa: F401


def test_shadow_healing_ops_remain_keeper_visible_and_callable(campaign_ws):
    for name in HEALING_LEGACY_OPERATIONS:
        assert name in coc_toolbox.TOOLS
        assert coc_toolbox.operation_policy(name)["kp_surface"] == "rules"
    investigator_id = campaign_ws["investigator_id"]
    state_path = (
        campaign_ws["campaign_dir"]
        / "save"
        / "investigator-state"
        / f"{investigator_id}.json"
    )
    state = json.loads(state_path.read_text(encoding="utf-8"))
    state.update({
        "current_hp": max(1, int(state.get("current_hp") or 1) - 1),
        "conditions": list(state.get("conditions") or []),
    })
    state_path.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
    result = _run(campaign_ws, "rules.first_aid", {
        "investigator": investigator_id,
        "skill_value": 99,
        "rescuer_id": investigator_id,
        "decision_id": "host-internal-first-aid-1",
        "seed": 7,
    })
    assert result["ok"] is True, result


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
        assert archive["operations"][name]["policy"]["kp_surface"] == "rules"
        assert name in projection["operations_by_surface"]["rules"]
    assert "rules.settle" not in projection["operations_by_surface"]["rules"]
    assert "rules.context" not in projection["operations_by_surface"]["context"]
    assert "rules.context" not in projection["operations_by_surface"]["rules"]
    regenerated = module.archive_to_canonical_bytes(archive)
    again = module.archive_to_canonical_bytes(module.build_archive(coc_toolbox))
    assert regenerated == again
    policy_bytes = module.policy_projection_to_canonical_bytes(projection)
    assert policy_bytes == module.policy_projection_to_canonical_bytes(
        module.build_policy_projection(coc_toolbox)
    )
