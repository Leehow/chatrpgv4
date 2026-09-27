"""Contract §143.9 (docs/specs/npc-acts-first-tickets/10-flee-footing-and-pursuit.md), over the emitted kernel.

Two defects of the combat engine's flight, both found reviewing the 2026-09-26 live tables:

- Table `npc-actor-gate-a2`, turn 6: the Keeper resolved a flight for Knott, and the engine stamped him `fled` and
  ended the fight without asking whether he could move at all. Keeper Rulebook, Fleeing: a character flees on their
  own action, with an escape route and not physically restrained. The states that stop it are rules data,
  `combat.json` `flee.flee_blocked_by`; a person carrying one is answered `needs` naming it, nothing is stamped and
  the fight goes on. Knott was `prone`, and `prone` is not on the list: the rulebook's Prone rule (p.127) lets a prone
  character stand up when their turn comes and then act, so the flight stands him up -- `flee.flee_clears` -- and the
  receipt says so (`prone` lost, `fled` gained) instead of a man fleeing while still on the floor.
- Table `npc-actor-gate-a`, turn 12: the player walked out of the office and one `resolve` produced the flight, the
  end of the fight, a chase start, both speed rolls and a pursuer's Fighting roll, while the prose had Knott stay in
  his chair. An investigator's flight no longer starts a chase: the result hints the pursuit as an NPC's flight
  already did (§142.10), and the pursuer opens the chase with their own `resolve chase:start`.

The session view reads the same rules: a person the list blocks is not issued `combat:flee`.

Corbitt's fight from the starter (`test_npc_standing_action.py`): after the investigator's swing and his dodge it is
his turn in round 1. The saved fight is edited only to put a state on him, as `edit_fight` does for the table rows.
"""

import pytest

from conftest import campaign_dir, read_json
from test_npc_standing_action import CORBITT, INVESTIGATOR, client_with, corbitts_turn, edit_fight
from test_rules_families import resolve, resolve_err

FLEE = {"actor": "Walter Corbitt", "intent": "flee", "goal": "get away", "method": "run for the stairs"}
# How each listed state sits on a combat participant: a condition, or the engine's own hold, the active effect the
# ongoing_disadvantage manoeuvre writes (`applyEffect`, kernel-ts/combat/engine.ts).
HOLD_EFFECT = {"effect": "restrained", "source_actor_id": INVESTIGATOR, "applied_round": 1, "remaining_rounds": 999,
               "metadata": {"goal": "ongoing_disadvantage", "counter": False}}
STATES = {
    "grappled": {"conditions": ["grappled"]},
    "restrained": {"active_effects": [HOLD_EFFECT]},
    "unconscious": {"conditions": ["unconscious"]},
    # The save's own coherence rules: dying is at most 1 HP with a major wound, dead is 0 HP.
    "dying": {"conditions": ["major_wound", "dying", "unconscious"], "hp_current": 0},
    "dead": {"conditions": ["dead"], "hp_current": 0},
}
INCAPACITATING = {"unconscious", "dying", "dead"}


@pytest.fixture
def fight(tmp_path):
    client = client_with(tmp_path, {"disposition": "fights_to_the_end"})
    yield client
    client.close()


def saved_fight(client):
    return read_json(campaign_dir(client.workspace) / "save" / "combat.json")


def corbitt_in(combat):
    return next(p for p in combat["participants"] if p["actor_id"] == CORBITT)


def fight_rules(client):
    """The rules data the kernel reads (the fixture's copy of the shipped content)."""
    return read_json(client.content / "rulesets" / "coc7" / "rules-json" / "combat.json")["flee"]


def listed_states(client):
    return fight_rules(client)["flee_blocked_by"]


def issued_flights(client):
    return [a for a in client.table("look", focus="session")["session"]["actions"] if a["decision"] == "combat:flee"]


# ---- a person who cannot move cannot flee ------------------------------------------------------------------

def test_a_held_person_cannot_flee_and_the_fight_goes_on(fight):
    n = corbitts_turn(fight)
    edit_fight(fight, corbitt={"conditions": ["grappled"]})
    receipts = len(fight.table("status")["receipts"])

    refused = resolve_err(fight, f"t1-c{n}", **FLEE)
    assert refused["code"] == "needs", refused
    assert refused["details"]["reason"] == "grappled" and refused["details"]["blocked_by"] == ["grappled"]
    assert refused["details"]["actor"] == CORBITT
    assert "combat:maneuver" in refused["fix"] and "escape" in refused["fix"], "the fix names the way free"
    assert len(fight.table("status")["receipts"]) == receipts, "nothing was stamped"
    combat = saved_fight(fight)
    assert combat["status"] == "active" and combat["outcome"] is None, "the fight did not end"
    assert corbitt_in(combat)["conditions"] == ["grappled"], "no fled"
    session = fight.table("look", focus="session")["session"]
    assert session["kind"] == "combat" and session["turn_of"] == CORBITT, "still his turn: nothing was spent"

    # The hold gone, the same flight settles.
    edit_fight(fight, corbitt={"conditions": []})
    fled = resolve(fight, f"t1-c{n}", **FLEE)
    assert fled["decision"] == "combat:flee" and fled["outcome"]["turn_outcome"] == "fled"
    assert "fled" in corbitt_in(saved_fight(fight))["conditions"]


def test_a_prone_person_who_flees_stands_up_and_runs(fight):
    """Knott's shape on A2 turn 6, the rulebook's way (Prone, p.127): standing up comes with the flight, in the same
    receipt. Before this the condition receipt read `before ["prone"]`, `after ["prone", "fled"]`."""
    assert "prone" not in listed_states(fight) and "prone" in fight_rules(fight)["flee_clears"]
    n = corbitts_turn(fight)
    edit_fight(fight, corbitt={"conditions": ["prone"]})
    fled = resolve(fight, f"t1-c{n}", **FLEE)
    assert fled["decision"] == "combat:flee" and fled["outcome"]["turn_outcome"] == "fled"
    [receipt] = [r for r in fight.table("status")["receipts"] if r["kind"] == "condition" and r["id"] in fled["receipts"]]
    assert receipt["subject"] == CORBITT
    assert receipt["before"] == ["prone"] and receipt["after"] == ["fled"], receipt
    assert receipt["lost"] == ["prone"] and receipt["gained"] == ["fled"], receipt
    assert fight.table("look", focus="session")["session"] is None, "the fight ends on his flight, as before"


@pytest.mark.parametrize("state", list(STATES))
def test_every_listed_state_blocks_the_flight(fight, state):
    assert state in listed_states(fight), f"{state} is rules data in combat.json, not a list in the kernel"
    n = corbitts_turn(fight)
    edit_fight(fight, corbitt=STATES[state])
    refused = resolve_err(fight, f"t1-c{n}", **FLEE)
    assert refused["code"] == "needs" and state in refused["details"]["blocked_by"], refused
    # The reason is the first blocking state in the order he carries them (a dying man is unconscious too).
    assert refused["details"]["reason"] == refused["details"]["blocked_by"][0]
    assert saved_fight(fight)["status"] == "active"
    if state in INCAPACITATING:
        assert "takes no action" in refused["fix"], "no way free is offered to a person who cannot act"
    else:
        assert "combat:maneuver" in refused["fix"] and "escape" in refused["fix"]


@pytest.mark.parametrize("hold", ["grappled", "restrained"])
def test_the_escape_the_fix_names_frees_them_and_the_flight_then_settles(fight, hold):
    """The refusal's fix is executed literally, so it has to work: the held person's own escape manoeuvre breaks
    either form of the hold. His Fighting is raised and the investigator's defence lowered in the save so the
    opposed roll is not the subject."""
    n = corbitts_turn(fight)
    edit_fight(fight, corbitt={**STATES[hold], "combat_skill": 99}, investigator={"dodge_skill": 1, "combat_skill": 1})
    assert resolve_err(fight, f"t1-c{n}", **FLEE)["details"]["reason"] == hold

    escaped = resolve(fight, f"t1-c{n}", actor="Walter Corbitt", intent="combat", decision="combat:maneuver", goal="escape",
                      target=INVESTIGATOR, method="twists out of the grip")
    assert escaped["decision"] == "combat:maneuver" and escaped["outcome"]["turn_outcome"] == "escape_success", escaped["outcome"]
    freed = corbitt_in(saved_fight(fight))
    assert "grappled" not in freed["conditions"] and not [e for e in freed["active_effects"] if e["effect"] == "restrained"]
    assert fight.table("look", focus="session")["session"]["turn_of"] == INVESTIGATOR, "getting free was his turn"

    # Round 2 runs to his turn the ordinary way: the investigator swings, he dodges, and now he runs.
    resolve(fight, f"t1-c{n + 1}", intent="combat", goal="hit him", method="fists", target="Walter Corbitt", weapon="unarmed")
    resolve(fight, f"t1-c{n + 2}", intent="combat", goal="combat:defend", method="combat:defend", actor="Walter Corbitt", defense="dodge")
    assert fight.table("look", focus="session")["session"]["turn_of"] == CORBITT
    fled = resolve(fight, f"t1-c{n + 3}", **FLEE)
    assert fled["decision"] == "combat:flee" and fled["outcome"]["turn_outcome"] == "fled"


def test_the_session_view_does_not_issue_a_flight_the_rules_block(fight):
    """The view reads the same rules as the engine: a grappled Corbitt's turn carries no `combat:flee`, so a standing
    flee binds nothing and the turn is the Keeper's; free, he is issued it again."""
    corbitts_turn(fight)
    assert issued_flights(fight) == [{"decision": "combat:flee", "actor": CORBITT}]
    edit_fight(fight, corbitt={"conditions": ["grappled"]})
    session = fight.table("look", focus="session")["session"]
    assert session["turn_of"] == CORBITT and not issued_flights(fight), session["actions"]
    assert {a["decision"] for a in session["actions"]} >= {"combat:attack", "combat:maneuver", "combat:end"}, \
        "only the flight is withheld; his way free (the manoeuvre) is still issued"
    edit_fight(fight, corbitt={"conditions": []})
    assert issued_flights(fight) == [{"decision": "combat:flee", "actor": CORBITT}]


# ---- an investigator's flight starts no chase; the pursuer opens it ----------------------------------------

def investigator_flees(client):
    """Corbitt holds on his turn (§142.5), the round turns over to the investigator, and the investigator runs."""
    n = corbitts_turn(client)
    client.table("apply", call_id=f"t1-c{n}", effects=[{"kind": "npc", "name": "Walter Corbitt", "action": "hold", "why": "he freezes"}])
    assert client.table("look", focus="session")["session"]["turn_of"] == INVESTIGATOR
    fled = resolve(client, f"t1-c{n + 1}", intent="flee", goal="get out of the cellar", method="run for the stairs")
    return fled, n + 1


def test_an_investigators_flight_ends_the_fight_and_starts_no_chase(fight):
    fled, c = investigator_flees(fight)
    assert fled["decision"] == "combat:flee"
    assert fled["outcome"]["combat_outcome"] == "fled" and "continued" not in fled["outcome"]
    assert not [x for x in fled["continuations"] if x.get("executed")], "no continuation ran in the same call"
    assert f"session:combat-end-t1-c{c}" in fled["receipts"]
    assert not [r for r in fled["receipts"] if r.startswith("session:chase-")], fled["receipts"]
    sessions = [(r["family"], r["transition"], r.get("outcome")) for r in fight.table("status")["receipts"] if r["kind"] == "session"]
    assert ("combat", "end", "fled") in sessions and not [s for s in sessions if s[0] == "chase"], sessions
    assert not (campaign_dir(fight.workspace) / "save" / "chase.json").exists(), "no chase was filed"
    assert fight.table("look", focus="session")["session"] is None
    # The pursuit is a hint of the same shape as an NPC's flight: who may give chase, and that the pursuer opens it.
    [hint] = [h for h in fled["hints"] if "chase:start" in h]
    assert CORBITT in hint and INVESTIGATOR in hint and "pursuer" in hint, hint


def test_the_pursuer_opens_the_chase_with_their_own_resolve(fight):
    """What the hint says, done: the Keeper decides Corbitt runs after him and resolves the chase start as Corbitt."""
    fled, c = investigator_flees(fight)
    started = resolve(fight, f"t1-c{c + 1}", actor="Walter Corbitt", target=INVESTIGATOR, intent="flee",
                      decision="chase:start", goal="run him down", method="lurches up the stairs after him")
    assert started["decision"] == "chase:start" and started["outcome"]["kind"] == "chase"
    assert f"session:chase-start-t1-c{c + 1}" in started["receipts"], "the chase is the pursuer's own call"
    sides = {p["name"]: p["side"] for p in started["session"]["participants"]}
    assert sides == {INVESTIGATOR: "quarry", CORBITT: "pursuer"}
    rolls = [r for r in fight.table("status")["receipts"] if r["kind"] == "roll" and r.get("roll_kind") == "chase_check"]
    assert {r["call_id"] for r in rolls} == {f"t1-c{c + 1}"}, "the speed rolls belong to the pursuer's call, not the flight"
