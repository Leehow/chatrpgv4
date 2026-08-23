"""First-aid pushed-failure obligations can close through turn.finalize."""
from __future__ import annotations

import json

from test_coc_toolbox import (
    _apply_first_aid_cost,
    _fail_pushed_first_aid,
    _first_aid_roll_id,
)
from test_toolbox import _finalize_pending_turn_for_test, _run, campaign_ws


def test_first_aid_pushed_failure_can_finalize_after_authoritative_effect(
    campaign_ws,
):
    settled = _fail_pushed_first_aid(campaign_ws)
    roll_id = _first_aid_roll_id(campaign_ws, "t20-first-aid-push-001")
    assert settled["pushed"]["data"]["event"]["outcome"] == "failure"

    journaled = _run(
        campaign_ws,
        "state.journal",
        {
            "summary": "二次急救仍失败，伤口没有稳住。",
            "player_action": "改用加压包扎再试一次急救",
            "player_text": "我改用衣襟勒紧伤口再试一次。",
            "intent_class": "assist",
            "decision_id": "t20-journal-001",
        },
    )
    assert journaled["ok"] is True, journaled

    context = _run(campaign_ws, "turn.output_context")
    assert context["ok"] is True, context
    assert context["data"]["missing_substantive_effects"] == [{
        "obligation_id": f"roll:{roll_id}",
        "source_roll_id": roll_id,
        "required_direction": "cost",
    }]

    applied = _apply_first_aid_cost(
        campaign_ws,
        source_roll_id=roll_id,
        decision_id="t20-push-fail-cost-001",
    )
    assert applied["ok"] is True, applied

    repaired = _run(campaign_ws, "turn.output_context")
    assert repaired["ok"] is True, repaired
    assert repaired["data"]["missing_substantive_effects"] == []

    finalized = _finalize_pending_turn_for_test(
        campaign_ws, decision_id="t20-finalize-001"
    )
    assert finalized["ok"] is True, finalized
    manifest_path = (
        campaign_ws["campaign_dir"]
        / "save"
        / "turn-manifests"
        / f"{repaired['data']['turn_id']}.json"
    )
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert manifest["status"] == "finalized"
    assert manifest["finalization_id"] == finalized["data"]["finalization_id"]
