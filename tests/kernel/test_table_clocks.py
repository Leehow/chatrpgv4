"""Contract §142.9 (docs/specs/npc-as-actor.md ticket 06), over the emitted kernel.

A consequence the book never paced -- the neighbours who heard the fight, the police someone telephoned -- becomes a
clock of this table: the Keeper states its length and what a full clock means, the kernel keeps the count beside the
book's clocks and never touches the module graph. Before this `apply threat` knew only the book's threats, so Knott's
shout for help had nothing it could move.
"""

from conftest import RpcClient, campaign_dir, narrate, open_turn, read_json

NEIGHBOURS = "the neighbours downstairs"
PATROLMAN = "a patrolman comes up the stairs"


def mint(client, call_id, **extra):
    effect = {"kind": "threat", "mint": True, "name": NEIGHBOURS, "length": 4, "on_full": PATROLMAN, "why": "the fight is loud", **extra}
    return client.table("apply", call_id=call_id, effects=[effect])


def receipt(client, applied):
    return next(r for r in client.table("status")["receipts"] if r["id"] in applied["receipts"])


def test_a_table_clock_is_started_advanced_by_its_name_and_lands(kernel):
    open_turn(kernel, "I shove him into the desk.")
    started = receipt(kernel, mint(kernel, "t1-c1"))
    assert started["kind"] == "threat" and started["minted"] is True and started["name"] == NEIGHBOURS
    assert (started["before"], started["after"], started["segments"], started["full"]) == (0, 1, 4, False)
    handle = started["threat"]
    assert handle.startswith("table-threat-")
    world = read_json(campaign_dir(kernel.workspace) / "world.json")
    assert world["table_threats"][handle]["on_full"] == PATROLMAN and world["threat_clocks"][handle] == {"clock": 1}
    capsule = kernel.table("capsule")
    pressed = next(p for p in capsule["pressures"] if p.get("minted"))
    assert (pressed["name"], pressed["state"], pressed["on_full"]) == (NEIGHBOURS, "1/4", PATROLMAN)
    [pacing] = [c for c in capsule["mods"]["pacing"]["threat_clocks"] if c.get("minted")]
    assert pacing["threat"] == handle and pacing["state"] == "1/4" and PATROLMAN in pacing["next"]
    advanced = receipt(kernel, kernel.table("apply", call_id="t1-c2", effects=[{"kind": "threat", "name": NEIGHBOURS}]))
    assert (advanced["before"], advanced["after"], advanced["full"]) == (1, 2, False)
    landed = receipt(kernel, kernel.table("apply", call_id="t1-c3", effects=[{"kind": "threat", "name": NEIGHBOURS, "segments": 2}]))
    assert (landed["after"], landed["full"], landed["on_full"]) == (4, True, PATROLMAN)
    assert not [p for p in kernel.table("capsule")["pressures"] if p.get("minted")], "a landed clock presses no more"


def test_a_table_clock_survives_a_restart_and_is_listed_when_a_name_misses(tmp_path):
    client = RpcClient(tmp_path / "ws")
    try:
        open_turn(client, "I shove him into the desk.")
        mint(client, "t1-c1")
        narrate(client, "t1-c2", "Somewhere below, a door opens.")
    finally:
        client.close()
    resumed = RpcClient(tmp_path / "ws")
    try:
        resumed.table("player_input", text="I keep at it.")
        moved = receipt(resumed, resumed.table("apply", call_id="t2-c1", effects=[{"kind": "threat", "name": NEIGHBOURS}]))
        assert (moved["before"], moved["after"]) == (1, 2)
        missed = resumed.table_err("apply", call_id="t2-c2", effects=[{"kind": "threat", "name": "the landlady"}])
        assert NEIGHBOURS in missed["details"]["options"]
    finally:
        resumed.close()


def test_minting_is_refused_for_the_books_threats_a_second_time_and_without_its_terms(kernel):
    open_turn(kernel, "I shove him into the desk.")
    assert kernel.table_err("apply", call_id="t1-c1", effects=[{"kind": "threat", "mint": True, "name": "corbitt-haunting", "length": 4, "on_full": PATROLMAN}])["details"]["field"] == "threat.name"
    mint(kernel, "t1-c2")
    assert kernel.table_err("apply", call_id="t1-c3", effects=[{"kind": "threat", "mint": True, "name": NEIGHBOURS, "length": 4, "on_full": PATROLMAN}])["details"]["field"] == "threat.name"
    for bad, field in [({"length": 1}, "threat.length"), ({"length": 13}, "threat.length"), ({"on_full": ""}, "threat.on_full"),
                       ({"on_full": "{{say:x}}"}, "threat.on_full"), ({"segments": 9}, "threat.segments")]:
        effect = {"kind": "threat", "mint": True, "name": "the telephone call", "length": 4, "on_full": PATROLMAN, **bad}
        assert kernel.table_err("apply", call_id="t1-c4", effects=[effect])["details"]["field"] == field


def test_a_table_clock_can_be_the_result_of_someones_intention(kernel):
    open_turn(kernel, "I shove him into the desk.")
    declared = receipt(kernel, kernel.table("apply", call_id="t1-c1", effects=[{"kind": "npc", "name": "Steven Knott", "intends": "Shout down the stairwell for help.", "outcome": "attempted"}]))
    ref = declared["intent"]["ref"]
    started = receipt(kernel, mint(kernel, "t1-c2", intent_ref=ref))
    assert started["intent"] == {"ref": ref, "npc": "steven-knott", "text": "Shout down the stairwell for help.", "outcome": "done"}
