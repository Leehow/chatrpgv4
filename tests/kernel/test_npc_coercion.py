"""Contract §138.13 (docs/specs/npc-as-actor.md ticket 04, the part this line still lacked), over the emitted kernel.

CoC 7e, "When Used on Player Characters": when Charm, Fast Talk, Intimidate or Persuade is used successfully on an
investigator, the player is not compelled; if the player refuses, the coercer can put one penalty die on one roll of
that investigator. The opposing skill -- the matching social skill or Psychology, whichever is higher -- sets the
difficulty. An NPC's Intimidate on the investigator already rolled as his own check (§11.5.9); what it lacked was the
rule's difficulty and any consequence at all, so a pressed investigator was just prose.
"""

import json

from conftest import RpcClient, campaign_dir, open_turn, read_json

HAYES = "thomas-hayes"


def pressing(tmp_path, psychology=None):
    client = RpcClient(tmp_path / "ws", env={"COC_KERNEL_SEED": "4"})
    open_turn(client, "I lean over his desk.")
    if psychology is not None:
        path = campaign_dir(client.workspace) / "party" / f"{HAYES}.json"
        sheet = read_json(path)
        sheet.setdefault("skills", {})["Psychology"] = psychology
        path.write_text(json.dumps(sheet, ensure_ascii=False), encoding="utf-8")
    client.table("apply", call_id="t1-c1", effects=[{"kind": "npc", "name": "Steven Knott", "skill": {"name": "Intimidate", "value": 60},
                                                     "why": "a landlord used to bullying tenants"}])
    pressed = client.table("resolve", call_id="t1-c2", action={"actor": "Steven Knott", "intent": "social", "skill": "Intimidate", "target": "Thomas Hayes",
                                                              "goal": "make him back off", "method": "slams the ledger down"})
    roll = next(r for r in client.table("status")["receipts"] if r["kind"] == "roll" and r.get("call_id") == "t1-c2")
    return client, pressed, roll


def test_a_pressed_investigator_is_a_receipt_and_the_opposing_skill_sets_the_difficulty(tmp_path):
    client, pressed, roll = pressing(tmp_path)
    try:
        assert pressed["decision"] == "core-check:ordinary-check" and roll["skill"] == "Intimidate" and roll["actor_is_investigator"] is False
        assert roll["difficulty"] == "regular", "Hayes's Intimidate and Psychology are both under 50"
        assert roll["coercion"]["pressed"] is True and roll["coercion"]["investigator"] == HAYES and roll["coercion"]["npc"] == "steven-knott"
        assert pressed["coercion"] == roll["coercion"]
        [row] = [p for p in client.table("capsule")["pressures"] if p.get("kind") == "coercion"]
        assert row["receipt"] == roll["id"] and "penalty die" in row["cue"]
    finally:
        client.close()


def test_a_higher_opposing_psychology_makes_it_hard(tmp_path):
    client, _pressed, roll = pressing(tmp_path, psychology=60)
    try:
        assert roll["difficulty"] == "hard" and roll["threshold"] == 30
    finally:
        client.close()


def test_a_refusal_spends_one_penalty_die_on_one_roll_once(tmp_path):
    client, _pressed, roll = pressing(tmp_path)
    try:
        spent = client.table("resolve", call_id="t1-c3", action={"intent": "investigate", "skill": "Spot Hidden", "coercion": roll["id"],
                                                                 "goal": "find the back door", "method": "scan the room while Knott glares"})
        assert spent["decision"] == "core-check:ordinary-check"
        second = next(r for r in client.table("status")["receipts"] if r["kind"] == "roll" and r.get("call_id") == "t1-c3")
        assert second["penalty"] == 1 and second["coercion_spent"] == roll["id"]
        assert not [p for p in client.table("capsule")["pressures"] if p.get("kind") == "coercion"], "spent: it presses no more"
        again = client.table_err("resolve", call_id="t1-c4", action={"intent": "investigate", "skill": "Spot Hidden", "coercion": roll["id"],
                                                                     "goal": "look again", "method": "look again"})
        assert again["details"]["reason"] == "coercion_unavailable"
    finally:
        client.close()


def test_the_penalty_die_falls_on_the_coerced_investigators_own_roll(tmp_path):
    client, _pressed, roll = pressing(tmp_path)
    try:
        refused = client.table_err("resolve", call_id="t1-c3", action={"actor": "Steven Knott", "intent": "investigate", "skill": "Spot Hidden",
                                                                       "coercion": roll["id"], "goal": "watch him", "method": "watch him"})
        assert refused["details"]["field"] == "action.coercion"
    finally:
        client.close()
