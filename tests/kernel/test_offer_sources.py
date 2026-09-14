"""Coherent offer sources through the current TS RPC; fixtures are not genuine-play evidence."""
import json

import pytest

from conftest import CAMPAIGN, campaign_dir, create_campaign, narrate, narrate_opening, open_turn, read_json
from test_rules_families import first_failure, resolve


@pytest.mark.parametrize("close_by", ["ask", "narrate"])
def test_clock_target_survives_capsule_to_closed_turn(kernel, close_by):
    capsule = open_turn(kernel, "I wait for the landlord's response.")["capsule"]
    offered = next(row for row in capsule["director"]["offer"] if row.get("target"))
    target = offered["target"]
    kernel.table("apply", call_id="t1-c1", effects=[{
        "kind": "threat", "name": target["threat"], "clock": target["clock"], "segments": 1,
    }])
    if close_by == "ask":
        kernel.table("ask", call_id="t1-c2", kind="mechanics", options=["accept"], text="The landlord drums his fingers.")
    else:
        narrate(kernel, "t1-c2", "The landlord drums his fingers.")
    record = read_json(campaign_dir(kernel.workspace) / "turns" / "0001.json")
    assert record["closed_by"] == close_by
    assert record["director_adoption"]["offer_taken"] == [f"pressure:{target['threat']}/{target['clock']}"]
    telemetry = [json.loads(line) for line in (campaign_dir(kernel.workspace) / "telemetry.jsonl").read_text().splitlines() if line.strip()]
    ledger = next(row for row in telemetry if row.get("lane") == "offers" and row["turn"] == 1)
    assert ledger["taken"] == [f"clock:{target['threat']}/{target['clock']}"]


def test_unanswered_continuations_have_one_base_projection(seeded_kernel):
    open_turn(seeded_kernel, "I climb to the upper window.")
    _, failed = first_failure(seeded_kernel, "t1-c", intent="investigate", goal="Reach the upper window", method="Climb the drainpipe", skill="Climb")
    assert failed["continuations"]
    narrate(seeded_kernel, "t1-c99", "The pipe flexes and you lower yourself back down.")
    capsule = seeded_kernel.table("player_input", text="I consider another attempt.")["capsule"]
    expected = {row["decision"] for row in failed["continuations"] if not row.get("executed")}
    continuations = [row for row in capsule["obligations"] if row["kind"] == "continuation"]
    assert {row["name"] for row in continuations} == expected
    assert len(continuations) == len(expected)
    assert all(row["who"] == "player" and row.get("cue") for row in continuations)
    assert not any(row["kind"] == "rule" or row.get("name") in expected for row in capsule["pressures"])
    result = resolve(seeded_kernel, "t2-c1", intent="investigate", goal="Reach the upper window", method="Climb another pipe", skill="Climb", stakes="The pipe snaps and the fall causes injury", push=True)
    assert result["decision"] == "push-luck:pushed-roll"
    answered = seeded_kernel.table("capsule")
    assert not any(row["kind"] == "continuation" and row["name"] in expected for row in answered["obligations"])


def test_core_threat_projection_does_not_require_pacing(kernel):
    create_campaign(kernel)
    kernel.ok("mods.configure", {"campaign": CAMPAIGN, "id": "keeper-pacing", "enabled": False})
    kernel.ok("mods.configure", {"campaign": CAMPAIGN, "id": "story-thread", "enabled": False})
    narrate_opening(kernel)
    kernel.table("player_input", text="I watch the people in the room.")
    kernel.table("apply", call_id="t1-c1", effects=[{
        "kind": "npc", "name": "Walter Corbitt", "to": "commission-briefing", "why": "Put the source-linked person in this test scene",
    }])
    capsule = kernel.table("capsule")
    assert "pacing" not in capsule["mods"] and "thread" not in capsule["mods"]
    assert any(row["kind"] == "threat" and row["name"] == "corbitt-haunting" for row in capsule["pressures"])
