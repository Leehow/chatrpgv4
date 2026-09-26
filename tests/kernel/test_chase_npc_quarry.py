"""Contract §139.12 (docs/specs/npc-acts-first-tickets/13-chase-with-an-npc-quarry.md), over the emitted kernel.

Ticket 10 measured the chase binding on the Corbitt fixture and found it had one shape: every present opponent with
a stat block a pursuer, the investigator always the quarry, `intent` only `flee`. So §138.10's hint for an NPC who
fled -- "if the investigators give chase, resolve chase:start with target <npc>" -- opened a chase in which the
investigator ran from the man who had just run from him (`[thomas-hayes quarry, walter-corbitt pursuer]`), and an
investigator could never chase anyone. Now `chase:start` with an investigator acting and a person named in `target`
makes that person the quarry when their flight still stands (a `fled` gained since the last fight or chase began and
since they were last moved), or when the investigator's own intent is not a flight (`move`, `combat`). A person who
acts is still the pursuer of an investigator (§139.9), an investigator who declares `flee` at someone with no flight
still runs from them, and with no one named the investigator still flees whoever is here.

The quarry's numbers come from his stat block through the pursuer's readers; a number the chase reads that a reader
would otherwise assume (MOV, the characteristics) is `needs`, never a default. Where a quarry who got away went is the
Keeper's `apply npc to` (the engine moves no quarry, an investigator's `apply move` is the Keeper's too); a caught one
is fought with `intent: combat`, the §11.5 end rule.

Corbitt's fight from the starter (`test_npc_standing_action.py`): after the investigator's swing and his dodge it is
his turn in round 1, and the Keeper resolves his flight. Chase outcomes use the engine's words, `escaped` and
`captured`. Both run-throughs are on the fixture's seed 7, played from `session.actions` as `test_sessions.py` plays
its chase; the capture changes only Corbitt's printed MOV (to 4) in a content copy, which is also the proof that his
MOV is read from his stat block.
"""

import json
import shutil

import pytest

from conftest import CONTENT_DIR, RpcClient, campaign_dir, open_turn, read_json
from test_npc_standing_action import CORBITT, INVESTIGATOR, corbitt_record, corbitts_turn
from test_rules_families import resolve, resolve_err, walk_to_confrontation

FLEE = {"actor": "Walter Corbitt", "intent": "flee", "goal": "get away", "method": "run for the stairs"}
KNOTT = "steven-knott"


def client_for(tmp_path, *, seed="7", profile=None):
    """The starter with Corbitt's printed stat block changed by `profile` (a function of the block), or as shipped."""
    content = None
    if profile is not None:
        content = tmp_path / "content"
        shutil.copytree(CONTENT_DIR, content)
        path = content / "starters" / "the-haunting" / "module-graph.json"
        graph = json.loads(path.read_text(encoding="utf-8"))
        profile(corbitt_record(graph)["mechanics"]["profile"])
        path.write_text(json.dumps(graph, ensure_ascii=False), encoding="utf-8")
    return RpcClient(tmp_path / "ws", env={"COC_KERNEL_SEED": seed}, content=content)


def with_mov(mov):
    def change(profile):
        profile["derived"]["MOV"] = mov
    return change


def without(section, key):
    def change(profile):
        del profile[section][key]
    return change


def corbitt_flees(client):
    """Corbitt's turn, and the Keeper resolves his flight: the fight ends, he is still in the cellar."""
    n = corbitts_turn(client)
    fled = resolve(client, f"t1-c{n}", **FLEE)
    assert fled["decision"] == "combat:flee" and fled["outcome"]["turn_outcome"] == "fled"
    return fled, n + 1


def chase_start(client, c, **action):
    return resolve(client, f"t1-c{c}", target="Walter Corbitt", decision="chase:start", goal="run him down",
                   method="after him up the stairs", **action)


def sides(session):
    return [(p["name"], p["side"]) for p in session["participants"]]


def chase_file(client):
    return campaign_dir(client.workspace) / "save" / "chase.json"


def play_out(client, c):
    """Play the chase from `session.actions` until it ends, as `test_sessions.py` does; the pursuer moves, the quarry
    runs. Returns the ending step and the next call number."""
    for _ in range(30):
        session = client.table("look")["where"]["session"]
        assert session is not None and session["status"] == "active"
        action = session["actions"][0]
        params = {"intent": "move", "goal": "keep after him", "method": "", "decision": action["decision"]}
        if session["turn_of"] != INVESTIGATOR:
            params.update(actor=session["turn_of"], intent="flee", goal="get away")
        if action["decision"] == "chase:conflict":
            params["target"] = action["targets"][0]
        step = client.table("resolve", call_id=f"t1-c{c}", action=params)
        assert step["decision"] == action["decision"]
        c += 1
        if step["outcome"]["status"] == "ended":
            return step, c
    raise AssertionError("the chase did not end in 30 steps")


# ---- the investigators run after a person ----------------------------------------------------------

@pytest.mark.parametrize("intent,actor", [("move", "Thomas Hayes"), ("combat", "Thomas Hayes"), ("flee", "Thomas Hayes"), ("move", None)],
                         ids=["move", "combat", "flee", "move-actor-absent"])
def test_the_investigator_runs_after_corbitt_who_fled(tmp_path, intent, actor):
    """The hint of his flight, done: the pursuer opens the chase, and Corbitt is its quarry. `flee` reads his flight on
    record (the investigator did not flee); `move` and `combat` are the pursuer's own intents; with actor absent the
    table's only investigator is the pursuer (`resolveActor`'s rule)."""
    client = client_for(tmp_path)
    try:
        fled, c = corbitt_flees(client)
        [hint] = [h for h in fled["hints"] if "chase:start" in h]
        assert f"target {CORBITT}" in hint and INVESTIGATOR in hint and "quarry" in hint and "apply npc to: away" in hint, hint
        started = chase_start(client, c, intent=intent, **({"actor": actor} if actor else {}))
        assert started["decision"] == "chase:start" and started["outcome"]["kind"] == "chase"
        assert sides(started["session"]) == [(INVESTIGATOR, "pursuer"), (CORBITT, "quarry")]
        assert f"session:chase-start-t1-c{c}" in started["receipts"]
        # Both speed rolls belong to this call: the investigator's CON and Corbitt's, read from his stat block.
        assert f"roll:con-t1-c{c}" in started["receipts"] and f"roll:con-{CORBITT}-t1-c{c}" in started["receipts"]
        saved = read_json(chase_file(client))
        assert saved["chase_id"] == f"chase:corbitt-confrontation:{CORBITT}-vs-{INVESTIGATOR}-t1"
        mine = {p["actor_id"]: p for p in saved["participants"]}
        assert (mine[CORBITT]["side"], mine[CORBITT]["mov_base"], mine[CORBITT]["dex"]) == ("quarry", 8, 35)
        assert (mine[INVESTIGATOR]["side"], mine[INVESTIGATOR]["mov_base"]) == ("pursuer", 7)
    finally:
        client.close()


@pytest.mark.parametrize("intent,expected", [("move", [(INVESTIGATOR, "pursuer"), (CORBITT, "quarry")]),
                                             ("flee", [(INVESTIGATOR, "quarry"), (CORBITT, "pursuer")])],
                         ids=["move-runs-after-him", "flee-runs-from-him"])
def test_with_no_flight_on_record_the_investigators_intent_says_who_runs(tmp_path, intent, expected):
    """No fight, no flight: the Keeper's `move` at a person present is the pursuit (he is running, by the Keeper's
    word); `flee` is the investigator running from him, the shape the chase had before, narrowed to the one named."""
    client = client_for(tmp_path)
    try:
        open_turn(client, "I go after him.")
        c = walk_to_confrontation(client)
        started = chase_start(client, c, intent=intent)
        assert sides(started["session"]) == expected
    finally:
        client.close()


def test_an_investigator_who_fled_is_the_quarry_whoever_the_keeper_names(tmp_path):
    """Ticket 10's shape stays: the investigator runs, Corbitt holds. A `chase:start` with the investigator acting and
    Corbitt named finds no flight of Corbitt's -- the flight on record is the investigator's -- so the investigator is
    the quarry, as the old binding had it."""
    client = client_for(tmp_path)
    try:
        n = corbitts_turn(client)
        client.table("apply", call_id=f"t1-c{n}", effects=[{"kind": "npc", "name": "Walter Corbitt", "action": "hold", "why": "he freezes"}])
        resolve(client, f"t1-c{n + 1}", intent="flee", goal="get out of the cellar", method="run for the stairs")
        started = chase_start(client, n + 2, intent="flee")
        assert sides(started["session"]) == [(INVESTIGATOR, "quarry"), (CORBITT, "pursuer")]
    finally:
        client.close()


# ---- the chase played out: escaped, captured -------------------------------------------------------

def test_corbitt_gets_away_and_where_he_went_is_the_keepers(tmp_path):
    """His printed MOV 8 against the investigator's 7: on seed 7 the speed rolls leave both at 7, so he keeps his
    two-location lead and runs off the end of the track. The engine moves nobody; the result says where he went is an
    `apply npc to`, and the Keeper's write is what takes him out of the scene."""
    client = client_for(tmp_path)
    try:
        _, c = corbitt_flees(client)
        started = chase_start(client, c, intent="move")
        assert started["session"]["status"] == "active", "the chase is run, not decided at the speed roll"
        again = resolve_err(client, f"t1-c{c + 1}", target="Walter Corbitt", decision="chase:start", intent="move", goal="x", method="y")
        assert again["code"] == "turn_state" and again["message"] == "a chase is already underway", again
        step, c = play_out(client, c + 1)
        assert step["outcome"]["chase_outcome"] == "escaped" and step["session"]["outcome"] == "escaped"
        [where] = [h for h in step.get("hints", []) if "got away" in h]
        assert where.startswith(CORBITT) and "apply npc to: away" in where, where
        world = read_json(campaign_dir(client.workspace) / "world.json")
        assert world["npc_presence"][CORBITT] == "corbitt-confrontation", "the engine did not move him"
        assert read_json(chase_file(client))["outcome"] == "escaped"
        moved = client.table("apply", call_id=f"t1-c{c}", effects=[{"kind": "npc", "name": "Walter Corbitt", "to": "away", "why": "he got away up the stairs"}])
        assert moved["receipts"]
        assert CORBITT not in read_json(campaign_dir(client.workspace) / "world.json")["npc_presence"]
    finally:
        client.close()


def test_corbitt_is_caught_and_the_fight_takes_up_again(tmp_path):
    """MOV 4 against 7: the investigator closes the gap, grabs him (a Fighting roll), and the chase ends `captured`;
    the §11.5 end rule is a fight, `intent: combat` against him."""
    client = client_for(tmp_path, profile=with_mov(4))
    try:
        _, c = corbitt_flees(client)
        started = chase_start(client, c, intent="move")
        assert started["session"]["status"] == "active"
        step, c = play_out(client, c + 1)
        assert step["outcome"]["chase_outcome"] == "captured" and step["session"]["outcome"] == "captured"
        final = read_json(chase_file(client))
        assert {p["actor_id"]: p["captured"] for p in final["participants"]}[CORBITT] is True
        grabs = [r for r in client.table("status")["receipts"] if r["kind"] == "roll" and r.get("actor") == INVESTIGATOR
                 and r.get("roll_kind") == "chase_check" and r.get("skill") == "Fighting"]
        assert grabs and grabs[-1]["passed"] is True, "the grab is the pursuer's Fighting roll"
        fight = resolve(client, f"t1-c{c}", intent="combat", goal="pin him down", method="fists", target="Walter Corbitt", weapon="unarmed")
        assert fight["decision"] == "combat:attack" and fight["session"]["kind"] == "combat"
    finally:
        client.close()


# ---- refusals say what is missing ------------------------------------------------------------------

@pytest.mark.parametrize("section,key", [("derived", "MOV"), ("characteristics", "CON")])
def test_a_quarry_missing_a_number_the_chase_reads_is_needs_never_a_default(tmp_path, section, key):
    """The reader would have given him MOV 8; a chase of him reads his own. CON is taken out without a fight (his
    fight would need it too), so the chase is opened on the Keeper's word."""
    client = client_for(tmp_path, profile=without(section, key))
    try:
        if key == "MOV":
            _, c = corbitt_flees(client)
        else:
            open_turn(client, "I go after him.")
            c = walk_to_confrontation(client)
        receipts = len(client.table("status")["receipts"])
        refused = resolve_err(client, f"t1-c{c}", target="Walter Corbitt", decision="chase:start", intent="move",
                              goal="run him down", method="after him")
        assert refused["code"] == "needs", refused
        assert refused["details"]["reason"] == "quarry_numbers_missing" and refused["details"]["npc"] == CORBITT
        assert refused["details"]["missing"] == [f"{section}.{key}"] and refused["details"]["needs"]["field"] == f"{section}.{key}"
        assert f"{section}.{key}" in refused["message"] and "none is assumed" in refused["message"]
        assert len(client.table("status")["receipts"]) == receipts and not chase_file(client).exists(), "nothing was rolled or filed"
    finally:
        client.close()


def test_a_quarry_with_no_stat_block_is_asked_for_one(kernel):
    """Knott has no numbers and nobody else in the office does: the refusal is about the person being chased (pin an
    archetype), not the pursuer message that used to list whoever did have numbers."""
    open_turn(kernel)
    refused = resolve_err(kernel, "t1-c1", target="Steven Knott", decision="chase:start", intent="move", goal="catch him", method="run")
    assert refused["code"] == "needs" and refused["details"]["reason"] == "quarry_has_no_stat_block", refused
    assert refused["details"]["npc"] == KNOTT and refused["details"]["needs"]["field"] == "archetype"
    assert "ordinary_adult" in refused["details"]["needs"]["options"] and "pursuer" not in refused["message"]


def test_a_wrong_intent_is_told_the_intents_a_chase_start_answers(tmp_path):
    """Ticket 10 measured `intent: move` with `decision: chase:start` refused "a chase needs a pursuer with a stat
    block present in the scene" with Corbitt, who has one, as its option. Now the three chase intents are admitted,
    a fourth is told which they are, and a pursuit with no one named is told to name whom."""
    client = client_for(tmp_path)
    try:
        _, c = corbitt_flees(client)
        wrong = resolve_err(client, f"t1-c{c}", target="Walter Corbitt", decision="chase:start", intent="investigate",
                            goal="run him down", method="after him")
        assert wrong["code"] == "needs" and wrong["details"]["reason"] == "chase_intent", wrong
        assert wrong["details"]["needs"] == {"field": "intent", "options": ["flee", "move", "combat"]}
        assert "stat block" not in wrong["message"] and "investigate" in wrong["message"]
        unnamed = resolve_err(client, f"t1-c{c}", decision="chase:start", intent="move", goal="run", method="after him")
        assert unnamed["code"] == "needs" and unnamed["details"]["reason"] == "quarry_does_not_flee", unnamed
        assert unnamed["details"]["needs"] == {"field": "target", "options": [CORBITT]}
        assert not chase_file(client).exists()
        # Named, the same call opens the chase.
        assert sides(chase_start(client, c, intent="move")["session"]) == [(INVESTIGATOR, "pursuer"), (CORBITT, "quarry")]
    finally:
        client.close()
