"""Behavior tests owned by the sanity-recovery operation cell."""
from toolbox_test_support import *

def test_full_sanity_session_is_reachable_through_shared_executor(campaign_ws):
    decision_id = "full-san-check-1"
    command = {
        "command_id": decision_id,
        "kind": "sanity_check",
        "phase": "resolve",
        "payload": {
            "decision_id": decision_id,
            "roll_id": decision_id,
            "skill": "SAN",
            "difficulty": "regular",
            "san_loss_success": 0,
            "san_loss_fail_expr": "1",
            "source": "A structured unnatural encounter",
        },
    }
    resolved = _run(campaign_ws, "sanity.execute", {
        "decision_id": decision_id,
        "command": command,
        "seed": 9,
    })
    assert resolved["ok"] is True
    assert resolved["data"]["authority"] == "deterministic_subsystem"
    context = _run(campaign_ws, "sanity.context")
    assert context["ok"] is True
    assert context["data"]["active"] is True

def test_sanity_fumble_records_the_structured_authored_loss_consequence(campaign_ws):
    settled = _run(
        campaign_ws,
        "rules.sanity_check",
        {
            "investigator": campaign_ws["investigator_id"],
            "source": "structured horror",
            "loss_success": "0",
            "loss_failure": "1D4",
            "decision_id": "san-fumble-evidence",
            "seed": 23,
        },
    )
    assert settled["ok"] is True
    assert settled["data"]["check"]["outcome"] == "fumble"
    check_roll_id = settled["data"]["check_roll_id"]
    roll = next(
        row
        for row in _read_jsonl(
            campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl"
        )
        if row.get("roll_id") == check_roll_id
    )
    consequence = roll["payload"]["fumble_consequence"]
    assert consequence["effect"]["kind"] == "san_loss"
    assert consequence["effect"]["amount"] == settled["data"]["san_loss"]
