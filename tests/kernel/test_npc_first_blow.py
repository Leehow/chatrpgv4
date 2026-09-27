"""Contract §142.11 (docs/specs/npc-as-actor.md ticket 05), over the emitted kernel.

A person present can strike the first blow at an investigator. Before this "An NPC cannot open the round itself":
nothing an NPC did could start a fight, so a cornered Knott swinging a chair, or Corbitt lunging out of the dark, could
only be narrated. Rulebook, "Striking the First Blow (Surprise)": whoever makes a sudden attack acts first, out of DEX
order; a target who saw it coming may dodge or fight back, one who did not neither dodges nor fights back and the
attacker gains one bonus die (the Harvey example); then the rounds run in DEX order.
"""

from conftest import RpcClient, open_turn, read_json, campaign_dir
from test_rules_families import walk_to_confrontation

CORBITT, HAYES = "walter-corbitt", "thomas-hayes"


def at_corbitt(tmp_path):
    client = RpcClient(tmp_path / "ws", env={"COC_KERNEL_SEED": "7"})
    open_turn(client, "I creep into the cellar.")
    return client, walk_to_confrontation(client)


def first_blow(client, n, **extra):
    action = {"actor": "Walter Corbitt", "intent": "combat", "target": "Thomas Hayes", "goal": "strike", "method": "lunges out of the dark", **extra}
    return client.table("resolve", call_id=f"t1-c{n}", action=action)


def test_a_first_blow_nobody_saw_coming_is_unopposed_with_a_bonus_die(tmp_path):
    client, n = at_corbitt(tmp_path)
    try:
        opened = first_blow(client, n, surprise=True)
        assert opened["decision"].endswith("combat:attack")
        roll = next(r for r in client.table("status")["receipts"] if r["kind"] == "roll" and r.get("actor") == CORBITT and r.get("combat_action") == "attack")
        assert roll["bonus"] == 1 and len(roll["tens_values"]) == 2, "one bonus die for the attacker"
        defended = [r for r in client.table("status")["receipts"] if r["kind"] == "roll" and r.get("actor") == HAYES]
        assert defended == [], "no dodge and no fighting back"
        session = client.table("look", focus="session")["session"]
        assert session["pending_defense"] is None and session["round"] == 1
        combat = read_json(campaign_dir(client.workspace) / "save" / "combat.json")
        order = [value["actor_id"] for value in combat["current_initiative"]]
        assert session["turn_of"] == order[0], "round 1 opens in DEX order after the blow; it spent no one's turn"
        if roll["passed"]:
            assert any(r["kind"] == "delta" and r.get("resource") == "hp" and r.get("subject") == HAYES for r in client.table("status")["receipts"])
    finally:
        client.close()


def test_a_first_blow_seen_coming_is_answered_with_a_defence_and_spends_no_turn(tmp_path):
    client, n = at_corbitt(tmp_path)
    try:
        opened = first_blow(client, n)
        pending = client.table("look", focus="session")["session"]["pending_defense"]
        assert pending["actor"] == HAYES and pending["attacker"] == CORBITT and pending["for"] == "player"
        assert any("sees it coming" in hint for hint in opened["hints"])
        combat = read_json(campaign_dir(client.workspace) / "save" / "combat.json")
        cursor_before = combat["initiative_cursor"]
        client.table("resolve", call_id=f"t1-c{n + 1}", action={"actor": "Thomas Hayes", "intent": "combat", "decision": "combat:defend",
                                                                 "defense": "dodge", "goal": "combat:defend", "method": "combat:defend"})
        after = read_json(campaign_dir(client.workspace) / "save" / "combat.json")
        assert after["pending_attack"] is None
        assert after["initiative_cursor"] == cursor_before, "the first blow's defence moved no one's turn"
        assert not any(value.get("acted") for value in after.get("initiative_progress", []))
    finally:
        client.close()


def test_only_a_person_present_opens_a_fight_on_an_investigator(tmp_path):
    client, n = at_corbitt(tmp_path)
    try:
        refused = client.table_err("resolve", call_id=f"t1-c{n}", action={"actor": "Walter Corbitt", "intent": "combat", "target": "Walter Corbitt",
                                                                        "goal": "strike", "method": "lunges"})
        assert refused["code"] in ("needs", "unknown_entity", "turn_state")
    finally:
        client.close()
