"""Behavior tests owned by the finance operation cell."""
from toolbox_test_support import *


def test_finance_cell_registry_surface_is_local():
    module_name = coc_toolbox.OPERATION_MODULES["finance"].__name__
    registered = {
        name
        for name, spec in coc_toolbox.TOOLS.items()
        if spec["handler"].__module__ == module_name
    }
    assert registered == {
        "rules.cash_assets",
        "state.assets_liquidate",
        "state.cash_grant",
        "state.cash_query",
        "state.cash_semantic",
        "state.cash_spend",
        "state.finance_query",
        "state.purchase",
    }


def test_rules_cash_assets_lookup_and_validation(tmp_path):
    described = coc_toolbox._describe("rules.cash_assets")
    assert described["needs_campaign"] is False
    assert described["params"]["credit_rating"]["required"] is True

    result = coc_toolbox.run_tool(
        "rules.cash_assets", tmp_path, None, {"credit_rating": 41}
    )
    assert result["ok"] is True
    data = result["data"]
    assert data["living_standard"] == "Average"
    assert data["cash"]["amount"] == 82  # CR x 2 (Table II, p.45-47)
    assert data["assets"]["amount"] == 2050  # CR x 50
    assert data["period"] == "1920s"

    penniless = coc_toolbox.run_tool(
        "rules.cash_assets", tmp_path, None, {"credit_rating": 0}
    )
    assert penniless["ok"] is True
    assert penniless["data"]["living_standard"] == "Penniless"

    bad_period = coc_toolbox.run_tool(
        "rules.cash_assets",
        tmp_path,
        None,
        {"credit_rating": 41, "period": "1870s"},
    )
    assert bad_period["ok"] is False
    assert bad_period["error"]["code"] == "invalid_param"
