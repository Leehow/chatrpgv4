"""Contract §139.13 (docs/specs/npc-acts-first-tickets/14-pursuit-after-the-flight-turn.md), over the emitted kernel.

Table `npc-acts-c`, turns 4 and 5. Knott's generated act bound as a flight; the engine stamped him `fled` and ended the
fight, and the Keeper -- as the flight hint said -- wrote `apply npc to: away` in the same turn. On turn 5 the player
ran after him down the stairs. The Keeper's `resolve chase:start target: Steven Knott` was refused `unknown_entity:
Steven Knott is not in the current scene`, and the same call without a target was told "a chase needs a pursuer with a
stat block present in the scene". §139.12's standing flight had ended at the `to` the hint itself asked for, so the
pursuer was always a turn late.

Now a flight stands through its own turn and the next one, whatever the Keeper wrote about where the person went: a
chase start at them opens the chase here, with them as its quarry; a chase start that names no one is told whom; any
other action at them is told only a chase reaches them. From the turn after that the window has closed and they are
simply not here. While the chase runs they are where the chase is, and its end says what the Keeper still has to write.

Corbitt's fight from the starter (`test_npc_standing_action.py`): after the investigator's swing and his dodge it is
his turn in round 1, and the Keeper resolves his flight. Seed 7, as `test_chase_npc_quarry.py` plays its chases: his
printed MOV 8 keeps his lead and he escapes; with MOV 4 in a content copy he is caught.
"""

import json

import pytest

from conftest import campaign_dir, narrate, read_json
from test_chase_npc_quarry import FLEE, client_for, sides, with_mov
from test_npc_standing_action import CORBITT, INVESTIGATOR, client_with, corbitts_turn
from test_rules_families import resolve, resolve_err

SCENE = "corbitt-confrontation"
AWAY = {"kind": "npc", "name": "Walter Corbitt", "to": "away", "why": "he bolts up the cellar stairs"}


@pytest.fixture
def fight(tmp_path):
    client = client_with(tmp_path)
    yield client
    client.close()


def presence(client):
    return read_json(campaign_dir(client.workspace) / "world.json").get("npc_presence", {})


def chase_file(client):
    return campaign_dir(client.workspace) / "save" / "chase.json"


def flight_turn(client, *, away=True):
    """Turn 1: Corbitt flees, the Keeper writes where he went (`to: away`) in the same turn, and the turn closes.
    Opens turn 2 with the player's pursuit. Returns the flight's result."""
    n = corbitts_turn(client)
    fled = resolve(client, f"t1-c{n}", **FLEE)
    assert fled["decision"] == "combat:flee" and fled["outcome"]["turn_outcome"] == "fled"
    if away:
        client.table("apply", call_id=f"t1-c{n + 1}", effects=[AWAY])
        assert CORBITT not in presence(client), "the Keeper's write took him off the scene"
    narrate(client, f"t1-c{n + 2}", "He is gone up the stairs.")
    opened = client.table("player_input", text="I run up the stairs after him.")
    assert opened["turn"] == 2
    return fled


def chase_start(client, call_id, **action):
    return resolve(client, call_id, target="Walter Corbitt", decision="chase:start", goal="run him down",
                   method="up the stairs after him", **action)


def play_out(client, turn, c, hints=None):
    """Play the chase from `session.actions` until it ends, as `test_chase_npc_quarry.py` does, on turn `turn`;
    every step's hints are collected into `hints` when given."""
    for _ in range(30):
        session = client.table("look")["where"]["session"]
        assert session is not None and session["status"] == "active"
        action = session["actions"][0]
        params = {"intent": "move", "goal": "keep after him", "method": "", "decision": action["decision"]}
        if session["turn_of"] != INVESTIGATOR:
            params.update(actor=session["turn_of"], intent="flee", goal="get away")
        if action["decision"] == "chase:conflict":
            params["target"] = action["targets"][0]
        step = client.table("resolve", call_id=f"t{turn}-c{c}", action=params)
        assert step["decision"] == action["decision"]
        if hints is not None:
            hints.extend(step.get("hints", []))
        c += 1
        if step["outcome"]["status"] == "ended":
            return step, c
    raise AssertionError("the chase did not end in 30 steps")


# ---- the window survives the Keeper's write ----------------------------------------------------------------------

@pytest.mark.parametrize("intent", ["flee", "move"], ids=["flee-as-table-c-wrote-it", "move-as-the-hint-says"])
def test_the_next_turn_runs_after_the_man_the_keeper_already_wrote_away(fight, intent):
    """Table C turn 5, done: the pursuit on the player's next turn opens the chase in the current scene, the
    investigator pursuing and Corbitt the quarry, though turn 1 wrote him away. `flee` is what the table's Keeper
    wrote for the pursuit; `move` is what the hint asks for."""
    fled = flight_turn(fight)
    [hint] = [h for h in fled["hints"] if "chase:start" in h]
    assert "does not end the pursuit" in hint and "next turn" in hint, hint
    started = chase_start(fight, "t2-c1", actor="Thomas Hayes", intent=intent)
    assert started["decision"] == "chase:start" and started["outcome"]["kind"] == "chase"
    assert sides(started["session"]) == [(INVESTIGATOR, "pursuer"), (CORBITT, "quarry")]
    assert "session:chase-start-t2-c1" in started["receipts"]
    assert "roll:con-t2-c1" in started["receipts"] and f"roll:con-{CORBITT}-t2-c1" in started["receipts"]
    saved = read_json(chase_file(fight))
    assert saved["chase_id"] == f"chase:{SCENE}:{CORBITT}-vs-{INVESTIGATOR}-t2"
    assert saved["location_chain"][0]["label"] == SCENE, "the chase opens where he ran from, where the player stands"
    assert CORBITT not in presence(fight), "the chase start moves nobody: where he is stays the Keeper's write"


def test_the_flights_own_turn_runs_after_him_too(fight):
    """The same window inside the flight's turn: `to: away`, then the pursuit, still opens the chase."""
    n = corbitts_turn(fight)
    resolve(fight, f"t1-c{n}", **FLEE)
    fight.table("apply", call_id=f"t1-c{n + 1}", effects=[AWAY])
    started = chase_start(fight, f"t1-c{n + 2}", intent="move")
    assert sides(started["session"]) == [(INVESTIGATOR, "pursuer"), (CORBITT, "quarry")]


def test_a_turn_later_the_window_has_closed_and_he_is_not_here(fight):
    """No pursuit on turn 2: from turn 3 the flight has lapsed unused, and the ordinary refusal stands."""
    flight_turn(fight)
    narrate(fight, "t2-c1", "You let him go.")
    assert fight.table("player_input", text="Now I run after him.")["turn"] == 3
    refused = resolve_err(fight, "t3-c1", actor="Thomas Hayes", target="Walter Corbitt", decision="chase:start",
                          intent="move", goal="run him down", method="up the stairs")
    assert refused["code"] == "unknown_entity" and refused["message"] == "Walter Corbitt is not in the current scene", refused
    # A nameless pursuit no longer names him: nobody here, nobody who ran from here.
    unnamed = resolve_err(fight, "t3-c1", actor="Thomas Hayes", decision="chase:start", intent="move", goal="run", method="up the stairs")
    assert unnamed["details"]["reason"] == "quarry_does_not_flee" and unnamed["details"]["needs"] == {"field": "target", "options": []}, unnamed
    assert "fled" not in unnamed["details"] and "pursuer" not in unnamed["message"]
    assert not chase_file(fight).exists()


def test_a_person_still_here_after_the_window_is_no_longer_running(fight):
    """The window is the same whether or not the Keeper moved him: Corbitt fled and was never written anywhere. On
    turn 2 a `flee` at him is still the pursuit; on turn 3 his flight has lapsed, and `flee` at him is the
    investigator running from him (§139.12's shape with no standing flight)."""
    flight_turn(fight, away=False)
    assert presence(fight)[CORBITT] == SCENE
    narrate(fight, "t2-c1", "He hesitates at the foot of the stairs.")
    fight.table("player_input", text="I back away from him.")
    started = chase_start(fight, "t3-c1", actor="Thomas Hayes", intent="flee")
    assert sides(started["session"]) == [(INVESTIGATOR, "quarry"), (CORBITT, "pursuer")]


# ---- the refusals in the window say whom, and what reaches him ---------------------------------------------------

@pytest.mark.parametrize("intent,reason", [("flee", "chase_names_no_one"), ("move", "quarry_does_not_flee")])
def test_a_chase_start_that_names_no_one_is_told_to_name_him(fight, intent, reason):
    """Table C turn 5's second call: no target. The refusal names the man who ran from here as the option and says to
    target him; it is never the pursuer message."""
    flight_turn(fight)
    refused = resolve_err(fight, "t2-c1", actor="Thomas Hayes", decision="chase:start", intent=intent,
                          goal="run him down", method="up the stairs")
    assert refused["code"] == "needs" and refused["details"]["reason"] == reason, refused
    assert refused["details"]["needs"]["field"] == "target" and CORBITT in refused["details"]["needs"]["options"]
    assert refused["details"]["fled"] == [{"npc": CORBITT, "flight": refused["details"]["fled"][0]["flight"]}]
    assert refused["details"]["fled"][0]["flight"].startswith(f"condition:{CORBITT}-t1-")
    assert "target: Walter Corbitt" in refused["fix"], refused["fix"]
    assert "pursuer" not in refused["message"] and "stat block" not in refused["message"], refused["message"]
    assert not chase_file(fight).exists()
    # Named, the same call opens the chase.
    assert sides(chase_start(fight, "t2-c1", actor="Thomas Hayes", intent=intent)["session"]) == \
        [(INVESTIGATOR, "pursuer"), (CORBITT, "quarry")]


def test_anything_but_a_chase_at_the_man_who_ran_is_told_only_a_chase_reaches_him(fight):
    """Not `unknown_entity`'s "not in the current scene": he ran from here and a chase still reaches him, and the
    refusal says which call does."""
    flight_turn(fight)
    refused = resolve_err(fight, "t2-c1", actor="Thomas Hayes", target="Walter Corbitt", intent="combat",
                          goal="tackle him", method="fists", weapon="unarmed")
    assert refused["code"] == "needs" and refused["details"]["reason"] == "fled_from_here", refused
    assert refused["details"]["npc"] == CORBITT and refused["details"]["needs"] == {"field": "decision", "options": ["chase:start"]}
    assert "ran from here" in refused["message"] and "chase:start" in refused["fix"] and "target: Walter Corbitt" in refused["fix"]
    assert fight.table("look", focus="session")["session"] is None, "nothing was opened"


# ---- the chase with a quarry the Keeper already wrote away --------------------------------------------------------

def test_he_gets_away_and_nothing_more_is_written(tmp_path):
    """Seed 7, his printed MOV 8: he keeps his lead and escapes. He is already off the scene (turn 1's `to: away`), so
    the end says so instead of "until then they are still present here"."""
    client = client_for(tmp_path)
    try:
        flight_turn(client)
        started = chase_start(client, "t2-c1", actor="Thomas Hayes", intent="move")
        assert started["session"]["status"] == "active"
        step, _ = play_out(client, 2, 2)
        assert step["outcome"]["chase_outcome"] == "escaped"
        [where] = [h for h in step.get("hints", []) if "got away" in h]
        assert where.startswith(CORBITT) and "already" in where and "still present here" not in where, where
        assert CORBITT not in presence(client)
    finally:
        client.close()


def test_he_is_caught_brought_back_and_fought(tmp_path):
    """MOV 4: the pursuer's grab reaches the quarry the world has away (he is in the running chase), the chase ends
    `captured`, and the hint says to write him back here before the fight -- which then opens."""
    client = client_for(tmp_path, profile=with_mov(4))
    try:
        flight_turn(client)
        chase_start(client, "t2-c1", actor="Thomas Hayes", intent="move")
        hints = []
        step, c = play_out(client, 2, 2, hints)
        assert step["outcome"]["chase_outcome"] == "captured"
        [caught] = [h for h in hints if "is caught" in h]
        assert caught.startswith(CORBITT) and "apply npc to: here" in caught and "intent combat" in caught, caught
        grabs = [r for r in client.table("status")["receipts"] if r["kind"] == "roll" and r.get("actor") == INVESTIGATOR
                 and r.get("roll_kind") == "chase_check" and r.get("skill") == "Fighting"]
        assert grabs and grabs[-1]["passed"] is True, "the grab reached him"
        refused = resolve_err(client, f"t2-c{c}", actor="Thomas Hayes", intent="combat", goal="pin him down",
                              method="fists", target="Walter Corbitt", weapon="unarmed")
        assert refused["code"] == "unknown_entity", "the chase consumed the window; where he is is the Keeper's write"
        client.table("apply", call_id=f"t2-c{c}", effects=[{"kind": "npc", "name": "Walter Corbitt", "to": "here", "why": "caught on the stairs"}])
        fight = resolve(client, f"t2-c{c + 1}", actor="Thomas Hayes", intent="combat", goal="pin him down",
                        method="fists", target="Walter Corbitt", weapon="unarmed")
        assert fight["decision"] == "combat:attack" and fight["session"]["kind"] == "combat"
    finally:
        client.close()


def test_the_pursuers_grab_reaches_him_where_the_chase_is(tmp_path):
    """The explicit grab, `chase:conflict target: Walter Corbitt`, names a man the world has away: he is in the running
    chase, so the refusal of a person not here does not apply to him. The pursuer is put at his location by editing the
    saved chase (both his position and where it started), as `edit_fight` edits a saved fight; the view then issues the
    conflict."""
    client = client_for(tmp_path)
    try:
        flight_turn(client)
        chase_start(client, "t2-c1", actor="Thomas Hayes", intent="move")
        saved = read_json(chase_file(client))
        for participant in saved["participants"]:
            if participant["actor_id"] == CORBITT:
                participant["position"] = participant["position_origin"] = 0
        chase_file(client).write_text(json.dumps(saved), encoding="utf-8")
        [action] = client.table("look")["where"]["session"]["actions"]
        assert action["decision"] == "chase:conflict" and action["targets"] == [CORBITT]
        grab = resolve(client, "t2-c2", actor="Thomas Hayes", intent="move", decision="chase:conflict",
                       target="Walter Corbitt", goal="grab him", method="")
        assert grab["decision"] == "chase:conflict"
        assert {p["actor_id"]: p["captured"] for p in read_json(chase_file(client))["participants"]}[CORBITT] is True
        [caught] = [h for h in grab.get("hints", []) if "is caught" in h]
        assert "apply npc to: here" in caught, caught
    finally:
        client.close()
