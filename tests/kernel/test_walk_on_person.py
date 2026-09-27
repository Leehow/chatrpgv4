"""Ticket 07 of docs/specs/npc-as-actor.md (owner ruling 2026-09-26: a walk-on is a runtime person, not a graph node),
over the emitted kernel. On this line §87's table people already are exactly that; this test pins the chain the ruling
asked for, end to end with an intention (§142): Knott shouts for help, and on the next turn the porter he called comes
up the stairs -- a person the book never had -- as the result of that shout.

Since line-2's §87.7 a newcomer is declared (`walk_on: true`): a word nobody carries is otherwise refused, because it
could as well be an authored person not introduced yet. The arrival is sent first as it was written before that rule,
so the test also holds that the refusal hands back the declared effect with the shout's `intent_ref` still on it: the
Keeper who sends it as written settles the shout, and nothing of the undeclared call was written.
"""

from conftest import RpcClient, narrate, open_turn, read_json, campaign_dir

SHOUT = "Shout down the stairwell for the porter."
PORTER = "the porter"


def receipt(client, applied):
    return next(r for r in client.table("status")["receipts"] if r["id"] in applied["receipts"])


def test_a_walk_on_arrives_as_the_result_of_a_shout_and_stays_a_person_of_this_table(tmp_path):
    client = RpcClient(tmp_path / "ws")
    try:
        open_turn(client, "I hit him again.")
        ref = receipt(client, client.table("apply", call_id="t1-c1", effects=[{"kind": "npc", "name": "Steven Knott", "intends": SHOUT, "outcome": "attempted"}]))["intent"]["ref"]
        narrate(client, "t1-c2", "Knott bellows down the stairwell.")
        client.table("player_input", text="I keep at him.")
        arrival = {"kind": "npc", "name": PORTER, "to": "here", "intent_ref": ref, "why": "he heard Knott shouting"}
        refused = client.table_err("apply", call_id="t2-c1", effects=[arrival])
        assert refused["code"] == "unknown_entity", refused
        assert refused["details"]["walk_on"] == {**arrival, "walk_on": True}, "the effect to send instead keeps the shout's ref"
        assert not any(person["name"] == PORTER for person in client.table("capsule")["present"]), "nothing was written"
        # The declared newcomer, exactly as the refusal hands it back.
        arrived = receipt(client, client.table("apply", call_id="t2-c2", effects=[refused["details"]["walk_on"]]))
        assert arrived["established"] == "table" and arrived["intent"]["ref"] == ref and arrived["intent"]["outcome"] == "done"
        handle = arrived["handle"]
        # Established, the word is his: a table person resolves by the word with no flag (§87.7), and no second row is minted.
        pinned = receipt(client, client.table("apply", call_id="t2-c3", effects=[{"kind": "npc", "name": PORTER, "archetype": "capable_adult",
                                                                                  "why": "a big man used to hauling coal"}]))
        assert pinned["profile"]["archetype"] == "capable_adult" and pinned["handle"] == handle and "established" not in pinned
        assert any(person["name"] == PORTER for person in client.table("capsule")["present"])
        delivered = narrate(client, "t2-c4", "{{say:the porter}}What's all this, then?{{/say}}")
        assert delivered["speech"][0]["who"]["npc"] == handle
    finally:
        client.close()
    resumed = RpcClient(tmp_path / "ws")
    try:
        resumed.table("player_input", text="I turn to the porter.")
        assert any(person["name"] == PORTER for person in resumed.table("capsule")["present"]), "a table person survives a restart"
        ledger = read_json(campaign_dir(resumed.workspace) / "npc-ledger.json")
        knott = next(entry for key, entry in ledger.items() if "knott" in key)
        assert [(row["text"], row["status"]) for row in knott["intents"]] == [(SHOUT, "done")]
    finally:
        resumed.close()
