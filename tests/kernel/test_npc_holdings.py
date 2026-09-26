"""Contract §138.12 (docs/specs/npc-as-actor.md ticket 08), over the emitted kernel.

What an NPC carries is theirs in a fight. The spec's appendix A read this as a gap; on this line it is not: the managed
object system lets a person present own a thing and take one (`apply object` with `to` an NPC, `handover: taken`), the
fight's weapon catalog holds every owned weapon object, and the NPC's attack binds the one they hold. These tests pin
that chain (a mutation that drops the NPC's owned weapons from the opening participant leaves them green, which is how
the premise was found to be already met). Corbitt here: the starter prints him, and the save holds a weapon he owns.
"""

import json

from conftest import RpcClient, campaign_dir, open_turn, read_json
from test_rules_families import walk_to_confrontation

CORBITT = "walter-corbitt"


def give_corbitt_a_weapon(client):
    path = campaign_dir(client.workspace) / "world.json"
    world = read_json(path)
    objects = world.setdefault("objects", {})
    objects.setdefault("definitions", {})["def-heavy-chair"] = {"id": "def-heavy-chair", "name": "heavy chair", "category": "item",
                                                                 "parameters": {"skill": "Fighting (Brawl)", "damage": "1D8", "uses_per_round": 1}}
    objects.setdefault("instances", {})["obj-heavy-chair"] = {"id": "obj-heavy-chair", "name": "heavy chair", "definition": "def-heavy-chair",
                                                              "owner": {"kind": "npc", "id": CORBITT, "name": "Walter Corbitt"}, "quantity": 1,
                                                              "state": {"condition": "intact"}}
    path.write_text(json.dumps(world, ensure_ascii=False), encoding="utf-8")


def test_an_npcs_owned_weapon_is_in_their_hands_from_the_first_blow(tmp_path):
    client = RpcClient(tmp_path / "ws", env={"COC_KERNEL_SEED": "7"})
    try:
        open_turn(client, "I creep into the cellar.")
        n = walk_to_confrontation(client)
        give_corbitt_a_weapon(client)
        client.table("resolve", call_id=f"t1-c{n}", action={"actor": "Walter Corbitt", "intent": "combat", "target": "Thomas Hayes",
                                                             "goal": "strike", "method": "swings the chair"})
        combat = read_json(campaign_dir(client.workspace) / "save" / "combat.json")
        corbitt = next(p for p in combat["participants"] if p["actor_id"] == CORBITT)
        held = [w.get("weapon_id") if isinstance(w, dict) else w for w in corbitt["weapons"]]
        assert "obj-heavy-chair" in held, held
        assert held.count("obj-heavy-chair") == 1
        assert "obj-heavy-chair" in combat["weapon_catalog"]
    finally:
        client.close()


def test_an_npc_strikes_with_the_thing_they_hold(tmp_path):
    client = RpcClient(tmp_path / "ws", env={"COC_KERNEL_SEED": "7"})
    try:
        open_turn(client, "I creep into the cellar.")
        n = walk_to_confrontation(client)
        give_corbitt_a_weapon(client)
        client.table("resolve", call_id=f"t1-c{n}", action={"actor": "Walter Corbitt", "intent": "combat", "target": "Thomas Hayes", "weapon": "heavy chair",
                                                             "surprise": True, "goal": "strike", "method": "swings the chair"})
        roll = next(r for r in client.table("status")["receipts"] if r["kind"] == "roll" and r.get("actor") == CORBITT and r.get("combat_action") == "attack")
        assert roll["skill"] == "Fighting (Brawl)", roll
    finally:
        client.close()
