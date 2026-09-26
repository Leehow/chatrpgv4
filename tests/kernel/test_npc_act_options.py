"""Contract §139.3 (docs/specs/npc-acts-first.md D3, ticket 03), over the emitted kernel.

`npc.act.options {campaign, name, act?, draw?}` lists the ways the kernel can settle what this person does right now,
each with the closed options of its parameters, all from data the kernel already holds. Outside a fight there is no
attack and no flight (the first blow is how a person opens one); on their own turn of a fight the attack's targets are
only the opponents the running fight lists. `acted_on` is this turn's receipts that were done to them; `act` is the
identity of a generated line as one of their intentions; `draw` (asked only on a severe stakes roll) lists the
rulebook's priced weapons of the module's era.

Knott is the ticket's person (the starter prints no numbers for him: the table pins an archetype, §34.10). With seed 1
the investigator's punch lands and it is Knott's turn in the fight afterwards (the §139.1 fixture's shape).
"""

import json

import pytest

from conftest import CONTENT_DIR, RpcClient, campaign_dir, narrate, open_turn, read_json
from test_rules_families import resolve

KNOTT = "steven-knott"
INVESTIGATOR = "thomas-hayes"


def options(client, name="Steven Knott", **extra):
    return client.ok("npc.act.options", {"campaign": "c1", "name": name, **extra})


def ways(result):
    return {row["way"]: row["params"] for row in result["ways"]}


def values(params, name):
    return [option["value"] for option in params[name]]


@pytest.fixture
def knott(tmp_path):
    client = RpcClient(tmp_path / "ws", env={"COC_KERNEL_SEED": "1"})
    yield client
    client.close()


def pinned(client):
    open_turn(client, "I square up to Knott.")
    client.table("apply", call_id="t1-c1", effects=[{"kind": "npc", "name": "Steven Knott", "archetype": "ordinary_adult", "why": "an office man"}])


def knotts_turn(client):
    """Turn 1 pins his numbers; turn 2 the punch lands and his defence is none: it is his turn, the turn still open."""
    pinned(client)
    narrate(client, "t1-c2", "Knott gets up from behind the desk.")
    client.table("player_input", text="I punch Knott in the face.")
    resolve(client, "t2-c1", intent="combat", goal="hit him", method="fists", target="Steven Knott", weapon="unarmed")
    resolve(client, "t2-c2", intent="combat", goal="combat:defend", method="combat:defend", actor="Steven Knott", defense="none")
    assert client.table("look", focus="session")["session"]["turn_of"] == KNOTT


def test_outside_a_fight_there_is_no_attack_and_no_flight_the_first_blow_is_how_one_opens(knott):
    pinned(knott)
    result = options(knott)
    assert result["npc"] == {"handle": KNOTT, "name": "Steven Knott"}
    assert result["in_session"] is False and result["my_turn"] is False
    found = ways(result)
    assert "attack" not in found and "flee" not in found, found.keys()
    assert values(found["first_blow"], "target") == [INVESTIGATOR], "only the investigator can take a first blow (§138.11)"
    assert "unarmed" in values(found["first_blow"], "weapon")
    # His own skills, from the pinned archetype's numbers (a label carries the value), and the rule's four social skills.
    skills = values(found["check"], "skill")
    assert skills and all(isinstance(value, str) for value in skills)
    assert sorted(values(found["coercion"], "skill")) == ["Charm", "Fast Talk", "Intimidate", "Persuade"], "the rule's four (§138.13)"
    assert values(found["coercion"], "investigator") == [INVESTIGATOR]
    assert "leave" in found and "stance" in found
    assert list(found)[-1] == "intention_only", "every act has somewhere to go"
    assert result["acted_on"] == [], "nothing was done to him this turn"
    assert result["play_language"], "the act is written in the campaign's language"


def test_a_person_with_no_numbers_has_no_first_blow_and_no_check(knott):
    open_turn(knott, "I look at Knott.")
    found = ways(options(knott))
    assert "first_blow" not in found, "a fight needs a stat block: the rules refuse one without it"
    assert "check" not in found, "no numbers and no pins: nothing of his own to roll"
    assert "intention_only" in found


def test_on_his_turn_of_the_fight_the_attack_targets_only_opponents_and_flight_is_offered(knott):
    knotts_turn(knott)
    result = options(knott)
    assert result["in_session"] is True and result["my_turn"] is True
    found = ways(result)
    assert values(found["attack"], "target") == [INVESTIGATOR], "the fight's own opponents who can still fight"
    assert values(found["attack"], "weapon"), "the weapons in his hands in the fight"
    assert "flee" in found
    assert "first_blow" not in found and "leave" not in found and "walk_on" not in found, "a fight is not left by walking out"
    # The punch this turn: a roll made against him and the hit points it cost, never his own defence roll.
    kinds = sorted({row["kind"] for row in result["acted_on"]})
    assert kinds == ["delta", "roll_against"], result["acted_on"]


def test_off_his_turn_of_the_fight_nothing_of_the_fight_is_his_to_bind(knott):
    knotts_turn(knott)
    combat_path = campaign_dir(knott.workspace) / "save" / "combat.json"
    combat = read_json(combat_path)
    combat["initiative_cursor"] = next(i for i, value in enumerate(combat["current_initiative"]) if value["actor_id"] == INVESTIGATOR)
    combat_path.write_text(json.dumps(combat), encoding="utf-8")
    result = options(knott)
    assert result["in_session"] is True and result["my_turn"] is False
    found = ways(result)
    assert "attack" not in found and "flee" not in found


def test_the_act_is_an_intention_of_his_the_same_line_under_way_continues_it_a_settled_one_is_a_new_attempt(knott):
    pinned(knott)
    line = "Ring the brass bell for the porter."
    fresh = options(knott, act=line)["act"]
    assert fresh["line"] == line and fresh["ref"].startswith(f"intent:{KNOTT}:") and fresh["continues"] is None
    knott.table("apply", call_id="t1-c2", effects=[{"kind": "npc", "name": "Steven Knott", "intends": line, "outcome": "attempted"}])
    under_way = options(knott, act=f"  {line} ")["act"]
    assert under_way["ref"] == fresh["ref"] and under_way["continues"]["ref"] == fresh["ref"]
    assert under_way["continues"]["status"] == "attempted"
    knott.table("apply", call_id="t1-c3", effects=[{"kind": "npc", "name": "Steven Knott", "intent_ref": fresh["ref"], "outcome": "failed"}])
    again = options(knott, act=line)["act"]
    assert again["continues"] is None and again["line"] == f"{line} (turn 1)" and again["ref"] != fresh["ref"], \
        "a settled intention is not tried again: a new attempt is a new line"


def test_the_draw_list_is_the_priced_rulebook_weapons_of_the_modules_era_and_only_when_asked(knott):
    pinned(knott)
    assert "draw" not in options(knott)
    draw = options(knott, draw=True)["draw"]
    weapons = json.loads((CONTENT_DIR / "rulesets" / "coc7" / "rules-json" / "weapons.json").read_text(encoding="utf-8"))["weapons"]
    equipment = json.loads((CONTENT_DIR / "rulesets" / "coc7" / "rules-json" / "equipment.json").read_text(encoding="utf-8"))["records"]
    priced = {row["price_id"]: row for row in equipment}
    assert draw and all(option["value"] in weapons for option in draw), "every option is a weapons.json profile"
    assert len({option["value"] for option in draw}) == len(draw), "one option per profile"
    assert all(priced[option["price_id"]]["era"] == "1920s" for option in draw), "the haunting is a 1920s module"
    assert any(option["value"] == "revolver_38_or_9mm" for option in draw)


def test_refusals(knott):
    pinned(knott)
    assert knott.err("npc.act.options", {"campaign": "c1"})["code"] == "invalid_params"
    assert knott.err("npc.act.options", {"campaign": "c1", "name": "Nobody At All"})["code"] == "unknown_entity"
    assert knott.err("npc.act.options", {"campaign": "c1", "name": "Steven Knott", "draw": "yes"})["code"] == "invalid_params"
    assert knott.err("npc.act.options", {"campaign": "c1", "name": "Steven Knott", "act": ""})["code"] == "invalid_params"


def test_an_attack_waiting_for_its_defence_carries_its_intention_stamp_to_the_defence_roll(knott):
    """§139.3: the first blow at an investigator waits for their defence and rolls in the defence call; the stamp of the
    act it settles waits with it (never on the fight snapshot, whose contract admits no extra key) and lands on the
    attacker's graded roll there -- done when it hit, failed when it did not."""
    pinned(knott)
    line = "Grab the letter opener and lunge at the visitor."
    knott.table("apply", call_id="t1-c2", effects=[{"kind": "npc", "name": "Steven Knott", "intends": line, "outcome": "attempted", "_generated": True}])
    ref = next(r for r in knott.table("status")["receipts"] if r["kind"] == "npc" and r.get("intent", {}).get("text") == line)["intent"]["ref"]
    resolve(knott, "t1-c3", actor="Steven Knott", intent="combat", target="Thomas Hayes", goal="lunge", method="lunge", intent_ref=ref, _generated=True)
    assert knott.table("look", focus="session")["session"]["pending_defense"]["actor"] == INVESTIGATOR, "the blow waits for the defence"
    carried = read_json(campaign_dir(knott.workspace) / "save" / "attack-intents.json")
    assert list(carried.values()) == [{"ref": ref, "npc": KNOTT, "text": line, "generated": True}]
    resolve(knott, "t1-c4", intent="combat", goal="combat:defend", method="combat:defend", actor="Thomas Hayes", defense="dodge")
    receipts = knott.table("status")["receipts"]
    attack = next(r for r in receipts if r["kind"] == "roll" and r.get("actor") == KNOTT and r.get("call_id") == "t1-c4")
    assert attack["intent"]["ref"] == ref and attack["intent"]["generated"] is True
    assert attack["intent"]["outcome"] == ("done" if attack["passed"] else "failed"), "the roll settled the act"
    assert read_json(campaign_dir(knott.workspace) / "save" / "attack-intents.json") == {}, "taken once"


def test_the_generated_mark_is_true_or_absent(knott):
    pinned(knott)
    error = knott.table_err("apply", call_id="t1-c2", effects=[{"kind": "npc", "name": "Steven Knott", "intends": "Leave.", "outcome": "attempted", "_generated": "yes"}])
    assert error["code"] == "invalid_params" and error["details"]["field"] == "npc._generated"


def test_a_person_the_flight_rules_block_is_not_offered_flee(knott):
    """§139.9 through §139.3: the ruleset's `flee_blocked_by` (a held person) keeps `flee` out of the ways, as it keeps
    `combat:flee` out of the session view; free again, the way is back."""
    knotts_turn(knott)
    path = campaign_dir(knott.workspace) / "save" / "combat.json"
    combat = read_json(path)
    knott_row = next(p for p in combat["participants"] if p["actor_id"] == KNOTT)
    knott_row["conditions"] = [*knott_row.get("conditions", []), "grappled"]
    path.write_text(json.dumps(combat, ensure_ascii=False, indent=2), encoding="utf-8")
    assert "flee" not in ways(options(knott)), "a held person cannot run"
    knott_row["conditions"] = [c for c in knott_row["conditions"] if c != "grappled"]
    path.write_text(json.dumps(combat, ensure_ascii=False, indent=2), encoding="utf-8")
    assert "flee" in ways(options(knott))
