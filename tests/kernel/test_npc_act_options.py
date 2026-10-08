"""Contract §143.3 (docs/specs/npc-acts-first.md D3, ticket 03), over the emitted kernel.

`npc.act.options {campaign, name, act?, produce?}` lists the ways the kernel can settle what this person does right now,
each with the closed options of its parameters, all from data the kernel already holds. Outside a fight there is no
attack and no flight (the first blow is how a person opens one); on their own turn of a fight the attack's targets are
only the opponents the running fight lists. `acted_on` is this turn's receipts that were done to them; `act` is the
identity of a generated line as one of their intentions; `produce` (asked only when a surprise of the stakes die let the
act bring something out, §143.19 -- it replaces D9's weapons-only `draw`) lists the rulebook's price list of the module's
era, weapons marked with their profile.

Knott is the ticket's person (the starter prints no numbers for him: the table pins an archetype, §34.10). With seed 1
the investigator's punch lands and it is Knott's turn in the fight afterwards (the §143.1 fixture's shape).
"""

import json
import re
from collections import Counter

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
    assert result["npc"] == {"handle": KNOTT, "name": "Steven Knott", "kind": "npc"}
    assert result["in_session"] is False and result["my_turn"] is False
    found = ways(result)
    assert "attack" not in found and "flee" not in found, found.keys()
    assert values(found["first_blow"], "target") == [INVESTIGATOR], "only the investigator can take a first blow (§142.11)"
    blow = next(row for row in result["ways"] if row["way"] == "first_blow")
    assert blow["ready"] is True and "preparation" not in blow, "the pinned archetype completes his block (§159.12)"
    assert "unarmed" in values(found["first_blow"], "weapon")
    # His own skills, from the pinned archetype's numbers (a label carries the value), and the rule's four social skills.
    skills = values(found["check"], "skill")
    assert skills and all(isinstance(value, str) for value in skills)
    assert sorted(values(found["coercion"], "skill")) == ["Charm", "Fast Talk", "Intimidate", "Persuade"], "the rule's four (§142.13)"
    assert values(found["coercion"], "investigator") == [INVESTIGATOR]
    assert "leave" in found and "stance" in found
    assert list(found)[-1] == "intention_only", "every act has somewhere to go"
    assert result["acted_on"] == [], "nothing was done to him this turn"
    assert result["play_language"], "the act is written in the campaign's language"


def test_a_person_with_no_numbers_is_offered_the_first_blow_only_as_preparation_and_no_check(knott):
    """§159.12's role-specific preparation (2026-10-05, 17f24438d) amends §143.3's `first_blow` row: a present person
    with no stat block still has the way, so an act already chosen is held for preparation rather than lost, but it is
    `ready: false` and names what the fight cannot read and how the Keeper completes it. No value is supplied."""
    open_turn(knott, "I look at Knott.")
    result = options(knott)
    rows = {row["way"]: row for row in result["ways"]}
    blow = rows["first_blow"]
    assert values(blow["params"], "target") == [INVESTIGATOR]
    assert blow["ready"] is False, "a fight needs a stat block: without one the first blow is never executable"
    assert blow["preparation"] == [{
        "actor": "Steven Knott", "role": "combat", "completion": "archetype",
        "missing": ["characteristics.STR", "characteristics.SIZ", "characteristics.DEX", "characteristics.CON"],
    }], "the fight's own gaps, completed by an archetype because he is a person"
    assert "check" not in rows, "no numbers and no pins: nothing of his own to roll"
    assert rows["intention_only"]["ready"] is True and "preparation" not in rows["intention_only"]


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


def test_the_produce_list_is_the_price_list_of_the_modules_era_and_only_when_asked(knott):
    """§143.19: every record the book prices for the era, by its price_id and the book's name; a weapon record carries
    its weapons.json profile, which is what the fight draws."""
    pinned(knott)
    assert "produce" not in options(knott) and "draw" not in options(knott)
    produce = options(knott, produce=True)["produce"]
    weapons = json.loads((CONTENT_DIR / "rulesets" / "coc7" / "rules-json" / "weapons.json").read_text(encoding="utf-8"))["weapons"]
    equipment = json.loads((CONTENT_DIR / "rulesets" / "coc7" / "rules-json" / "equipment.json").read_text(encoding="utf-8"))["records"]
    priced = {row["price_id"]: row for row in equipment}
    era = [row for row in equipment if row["era"] == "1920s"]
    # §143.30: the module's era comes first; other eras follow it (the next test).
    assert [option["value"] for option in produce][:len(era)] == [row["price_id"] for row in era], "the haunting is a 1920s module: every record of it, in the book's order"
    assert all(option["label"] == priced[option["value"]]["name"] and option["category"] == priced[option["value"]]["category"] for option in produce)
    armed = [option for option in produce if "weapon" in option]
    assert armed and all(option["weapon"] in weapons and priced[option["value"]]["entity_ref"]["entity_id"] == option["weapon"] for option in armed), \
        "a weapon record names its weapons.json profile"
    assert len([option for option in produce[:len(era)] if "weapon" in option]) == sum(1 for row in era if (row.get("entity_ref") or {}).get("kind") == "weapon")
    assert any(option["weapon"] == "automatic_25_derringer" for option in armed), "the pocket pistol the loop test draws"
    assert any(option["label"] == "Umbrella" and "weapon" not in option for option in produce), "and things that are not weapons"
    assert len(produce) >= 255, "longer than one Jev question holds: the host asks by its part first"


def book_name(name):
    """The kernel's name normalization, for the price list's plain names: lower case, runs of space, _ and - as one space."""
    return re.sub(r"[\s_\-]+", " ", name.lower()).strip()


def test_a_surprise_is_not_held_to_the_modules_era_and_the_modules_own_record_is_preferred(knott):
    """§143.30 (ticket 32, the owner: the top rung's surprise may be anachronistic): with `produce` the price list goes
    past the module's era -- the 1920s records first, in the book's order, then every other era's record whose name the
    list does not have yet -- so a thing out of its time still finds the book's numbers. Without `produce` nothing of it
    is listed at all."""
    pinned(knott)
    plain = options(knott)
    assert "produce" not in plain and "eq.modern." not in json.dumps(plain), "without produce: no price list, nothing of another era"
    produce = options(knott, produce=True)["produce"]
    equipment = json.loads((CONTENT_DIR / "rulesets" / "coc7" / "rules-json" / "equipment.json").read_text(encoding="utf-8"))["records"]
    priced = {row["price_id"]: row for row in equipment}
    era = [row for row in equipment if row["era"] == "1920s"]
    assert [option["value"] for option in produce[:len(era)]] == [row["price_id"] for row in era], "the module's era first"
    later = produce[len(era):]
    assert later and all(priced[option["value"]]["era"] != "1920s" for option in later), "then the other eras"
    era_names = {book_name(row["name"]) for row in era}
    assert not [option["label"] for option in later if book_name(option["label"]) in era_names], "a name the module's era prints is its own record"
    assert len({book_name(option["label"]) for option in later}) == len(later), "each other-era name once"
    assert [option["value"] for option in produce if option["label"] == "Hand Grenade*"] == \
        ["eq.1920s.weapon_table.table_xvii_explosives_heavy_weapons_misc.hand_grenade"], "printed in both eras: the module's record only"
    chainsaw = next(option for option in later if option.get("weapon") == "chainsaw")
    assert (chainsaw["value"], chainsaw["label"], chainsaw["category"]) == \
        ("eq.modern.weapon_table.table_xvii_hand_to_hand_weapons.chainsaw_i", "Chainsaw* (i)", "weapon_table"), "a modern weapon, with its profile"
    assert {"m79_grenade_launcher", "minigun"} <= {option.get("weapon") for option in later}
    parts = Counter(option["category"] for option in produce)
    assert max(parts.values()) + 1 <= 255, f"every part still fits one choice question beside none: {parts.most_common(3)}"



def test_refusals(knott):
    pinned(knott)
    assert knott.err("npc.act.options", {"campaign": "c1"})["code"] == "invalid_params"
    assert knott.err("npc.act.options", {"campaign": "c1", "name": "Nobody At All"})["code"] == "unknown_entity"
    assert knott.err("npc.act.options", {"campaign": "c1", "name": "Steven Knott", "produce": "yes"})["code"] == "invalid_params"
    assert knott.err("npc.act.options", {"campaign": "c1", "name": "Steven Knott", "act": ""})["code"] == "invalid_params"


def test_an_attack_waiting_for_its_defence_carries_its_intention_stamp_to_the_defence_roll(knott):
    """§143.3: the first blow at an investigator waits for their defence and rolls in the defence call; the stamp of the
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
    """§143.9 through §143.3: the ruleset's `flee_blocked_by` (a held person) keeps `flee` out of the ways, as it keeps
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


# ---------------------------------------------------------------------------------------------------
# §143.20 (ticket 21, live table B): `conversation` -- whether they took part in the exchange where the investigators
# stand, on the newest committed turn or earlier in this one. Structure only: a spoken line the speech markers
# attributed to them, an act or an intention of theirs; the newest committed turn counts while its scene is still the
# active one and they were among its `present`.
# ---------------------------------------------------------------------------------------------------

def spoke_at_the_office(client):
    """Turn 1: Knott says one line at the office (a say marker); turn 2 opens, nothing done yet."""
    open_turn(client, "I ask Knott about the house.")
    narrate(client, "t1-c1", "诺特靠回椅背。{{say:Steven Knott}}「那房子空了好些年。」{{/say}}")
    client.table("player_input", text="I keep asking.")


def test_a_line_he_said_last_turn_in_this_room_keeps_him_in_the_conversation(knott):
    spoke_at_the_office(knott)
    conversation = options(knott)["conversation"]
    assert conversation is not None and conversation["turn"] == 1 and conversation["by"] == ["speech"], conversation
    assert options(knott)["acted_on"] == [], "nothing was done to him this turn: this is the third trigger, not the first"


def test_an_intention_of_his_this_turn_is_his_part_now(knott):
    spoke_at_the_office(knott)
    knott.table("apply", call_id="t2-c1", effects=[{"kind": "npc", "name": "Steven Knott", "intends": "Ring for the porter.", "outcome": "attempted"}])
    conversation = options(knott)["conversation"]
    assert (conversation["turn"], conversation["by"]) == (2, ["intention"]), conversation


def test_leaving_the_room_ends_it_even_if_he_comes_along(knott):
    spoke_at_the_office(knott)
    knott.table("apply", call_id="t2-c1", effects=[{"kind": "move", "to": "newspaper-morgue"}])
    knott.table("apply", call_id="t2-c2", effects=[{"kind": "npc", "name": "Steven Knott", "to": "here", "why": "test fixture: he came along"}])
    moved = options(knott)
    assert moved["place"] == "newspaper-morgue" and moved["acted_on"] == [], "he stands beside the investigator again, and nothing was done to him"
    assert moved["conversation"] is None, "the office's exchange does not follow the party to the morgue"


def test_someone_who_said_nothing_is_not_in_it(knott):
    open_turn(knott, "I look around the office.")
    narrate(knott, "t1-c1", "诺特低头看文件，一言不发。")
    knott.table("player_input", text="I wait.")
    assert options(knott)["conversation"] is None
