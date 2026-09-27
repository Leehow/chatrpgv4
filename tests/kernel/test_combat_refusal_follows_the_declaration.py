"""Contract §143.18 (docs/specs/npc-acts-first-tickets/19-keeper-turns-a-demand-into-a-blow.md), over the emitted kernel.

Live table C4 (`npc-acts-c4`), turn 8: the player demanded his twenty dollars in a running fight; the Keeper resolved a
`combat:maneuver` whose goal was the demand, and the kernel's refusal ended "to simply hit instead, resolve the attack
rather than the maneuver". The Keeper did exactly that, and the punch the player never declared was rolled. A refusal's
`fix` is executed literally (the memory note of that name), so a refusal of the investigator's fight action must never
propose a different fight action in its place: what the investigator does is what the player declared (§34 D2).

The structure, not the wording: for each refusal of an investigator's fight action reached here, the `fix` names no
combat decision other than the one refused -- neither as `combat:<name>` nor as the bare name -- where the decisions are
the kernel's own list (`table.resolve.options` `decisions`, family `combat`), never a list written here. An NPC's
refusal may name that person's own way on (their initiative is the Keeper's, §32.1; §143.9 pins a held person's escape).
"""

import re

import pytest

from conftest import CAMPAIGN, open_turn
from test_npc_standing_action import CORBITT, INVESTIGATOR, client_with, corbitts_turn, edit_fight
from test_rules_families import resolve, resolve_err

DEMAND = "钱呢？你说的二十块，现在就给我。"


@pytest.fixture
def fight(tmp_path):
    client = client_with(tmp_path)
    yield client
    client.close()


def combat_decisions(client):
    """The kernel's own decision list, the combat family's names (`combat:attack`, ...)."""
    decisions = client.ok("table.resolve.options", {"campaign": CAMPAIGN})["decisions"]
    names = sorted({row["name"] for row in decisions if row["family"] == "combat"})
    assert len(names) >= 4 and "combat:attack" in names and "combat:maneuver" in names, names
    return names


def named_decisions(fix, decisions):
    """The combat decisions a fix text names: `combat:<name>`, or `<name>` as a whole word."""
    return sorted(decision for decision in decisions
                  if decision in fix or re.search(rf"\b{re.escape(decision.split(':', 1)[1])}\b", fix, re.IGNORECASE))


def hayes_turn(client):
    """Corbitt's turn after the swing and his dodge; his hold passes it (§142.5): it is the investigator's turn."""
    n = corbitts_turn(client)
    held = client.table("apply", call_id=f"t1-c{n}", effects=[{"kind": "npc", "name": "Walter Corbitt", "action": "hold", "why": "he backs off"}])
    session = client.table("look", focus="session")["session"]
    assert session["turn_of"] == INVESTIGATOR and session["pending_defense"] is None, (held, session)
    return n + 1


# Each case puts the table in its state and makes one call the kernel refuses; it returns the refused decision's name.

def maneuver_whose_goal_is_the_demand(client):
    """C4 turn 8 itself: the demand written as a manoeuvre's goal, on the investigator's own turn."""
    n = hayes_turn(client)
    return "combat:maneuver", resolve_err(client, f"t1-c{n}", intent="combat", decision="combat:maneuver", goal="挥拳威逼，逼他把钱交出来",
                                          method="一拳逼他把钱交出来", target="Walter Corbitt", weapon="unarmed")


def defence_with_nothing_to_answer(client):
    n = hayes_turn(client)
    return "combat:defend", resolve_err(client, f"t1-c{n}", intent="combat", decision="combat:defend", defense="dodge",
                                        goal="躲开", method="侧身")


def blow_out_of_turn(client):
    """His turn, not the investigator's: the stuck-turn refusal (§142.5)."""
    n = corbitts_turn(client)
    return "combat:attack", resolve_err(client, f"t1-c{n}", intent="combat", goal="hit him", method="fists", target="Walter Corbitt", weapon="unarmed")


def blow_while_a_defence_is_owed(client):
    n = hayes_turn(client)
    resolve(client, f"t1-c{n}", intent="combat", goal="hit him", method="fists", target="Walter Corbitt", weapon="unarmed")
    return "combat:attack", resolve_err(client, f"t1-c{n + 1}", intent="combat", goal="hit him again", method="fists",
                                        target="Walter Corbitt", weapon="unarmed")


def flight_while_held(client):
    """§143.9's hold, on the investigator: the flight is refused, and the way free is the player's to declare."""
    n = hayes_turn(client)
    edit_fight(client, investigator={"conditions": ["grappled"]})
    return "combat:flee", resolve_err(client, f"t1-c{n}", intent="flee", decision="combat:flee", goal="get away", method="run for the stairs")


def flight_with_no_fight(client):
    open_turn(client, DEMAND)
    return "combat:flee", resolve_err(client, "t1-c1", intent="flee", decision="combat:flee", goal="get away", method="run")


CASES = [maneuver_whose_goal_is_the_demand, defence_with_nothing_to_answer, blow_out_of_turn, blow_while_a_defence_is_owed,
         flight_while_held, flight_with_no_fight]


@pytest.mark.parametrize("case", CASES, ids=[case.__name__ for case in CASES])
def test_an_investigators_refused_fight_action_names_no_other_fight_decision(fight, case):
    refused, error = case(fight)
    assert error["code"] in {"needs", "turn_state"}, error
    fix = error.get("fix") or ""
    assert fix, f"a refusal of a fight action says what to do: {error}"
    decisions = combat_decisions(fight)
    assert refused in decisions
    others = [decision for decision in decisions if decision != refused]
    assert named_decisions(fix, others) == [], f"the fix proposes another fight action in place of {refused}: {fix!r}"


def test_the_maneuver_refusal_still_names_the_four_and_changes_nothing(fight):
    n = hayes_turn(fight)
    receipts = len(fight.table("status")["receipts"])
    error = resolve_err(fight, f"t1-c{n}", intent="combat", decision="combat:maneuver", goal="挥拳威逼，逼他把钱交出来",
                        method="一拳逼他把钱交出来", target="Walter Corbitt", weapon="unarmed")
    assert error["code"] == "needs" and error["details"]["needs"]["field"] == "goal"
    assert sorted(error["details"]["needs"]["options"]) == ["disarm", "escape", "ongoing_disadvantage", "push"]
    session = fight.table("look", focus="session")["session"]
    assert session["turn_of"] == INVESTIGATOR and session["pending_defense"] is None, "nothing was declared or rolled"
    assert len(fight.table("status")["receipts"]) == receipts, "no receipt for the refused call"


def test_an_npcs_held_flight_still_names_his_way_free(fight):
    """The NPC side is unchanged (§143.9): his escape is the Keeper's to take for him, and the fix names it."""
    n = corbitts_turn(fight)
    edit_fight(fight, corbitt={"conditions": ["grappled"]})
    error = resolve_err(fight, f"t1-c{n}", actor="Walter Corbitt", intent="flee", goal="get away", method="run for the stairs")
    assert error["details"]["actor"] == CORBITT
    assert named_decisions(error["fix"], combat_decisions(fight)) == ["combat:maneuver"]
