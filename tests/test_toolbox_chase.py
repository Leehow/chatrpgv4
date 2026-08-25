"""Behavior tests owned by the chase operation cell."""
from toolbox_test_support import *

def test_full_chase_session_is_reachable_through_shared_executor(campaign_ws):
    investigator_id = campaign_ws["investigator_id"]
    state = coc_state.load_investigator_state(campaign_ws["campaign_dir"], investigator_id)
    decision_id = "full-chase-start-1"
    participant = {
        "actor_id": investigator_id,
        "side": "quarry",
        "mov": 8,
        "dex": 60,
        "con": 50,
        "hp": int(state["current_hp"]),
        "fight": 50,
        "dodge": 30,
        "build": 0,
        "current_position": 1,
        "conditions": list(state.get("conditions") or []),
    }
    command = {
        "command_id": decision_id,
        "kind": "chase_start",
        "phase": "start",
        "payload": {
            "decision_id": decision_id,
            "chase_id": "chase-alley",
            "participants": [
                participant,
                {**participant, "actor_id": "pursuer-1", "side": "pursuer", "dex": 45, "current_position": 0},
            ],
            "locations": [
                {"label": "alley-mouth", "hazard": None, "barrier": None},
                {"label": "wet-stairs", "hazard": None, "barrier": None},
                {"label": "market", "hazard": None, "barrier": None},
            ],
        },
    }
    started = _run(campaign_ws, "chase.execute", {
        "decision_id": decision_id,
        "command": command,
        "seed": 4,
    })
    assert started["ok"] is True
    context = _run(campaign_ws, "chase.context")
    assert context["ok"] is True
    assert context["data"]["active"] is True
    assert context["data"]["snapshot"]["chase_id"] == "chase-alley"
