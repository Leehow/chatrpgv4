"""Contract §139.8 (docs/specs/npc-acts-first.md D9, ticket 09), over the emitted kernel.

`npc.stakes {campaign, name}` is the Keeper's stakes die for a person with no prepared reaction this turn: a rung read
from `content/rulesets/coc7/rules-json/npc-stakes.json` (base from the person's combat disposition, else the archetype the
table pinned, else the table's default; moved by the table's shifts), one d100 on the kernel's seeded die, and one
keeper-visible `roll` receipt of family `stakes` in the open turn -- once per person per turn. `npc.situation` carries
`{rung, outcome, line}` read from that receipt and never rolls.

Corbitt is the person. As the starter ships, the natural-npc Mod's first-impression check against him is still to come,
which is a prepared reaction (§139.1 `constraints`); the fights below make that check first, so nothing is prepared for
him any more. His book gives him no combat disposition, so his base is the table's default. With seeds 8, 6 and 4 the
investigator's punch lands (its damage die is rolled; his Flesh Ward armour takes it, so his hit points stay whole) and
the die then says severe, escalates and nothing. Every expected number is read from the shipped table, never restated.
"""

import json
import shutil

import pytest

from conftest import CONTENT_DIR, RpcClient, campaign_dir, narrate, open_turn, read_json
from test_npc_standing_action import content_with, edit_fight
from test_rules_families import resolve, walk_to_confrontation

CORBITT = "walter-corbitt"
INVESTIGATOR = "thomas-hayes"
TABLE = CONTENT_DIR / "rulesets" / "coc7" / "rules-json" / "npc-stakes.json"
# Seeds whose landed blow is followed by each outcome of the die (chosen by running them; the die is the kernel's).
LANDED = {8: "severe", 6: "escalates", 4: "nothing"}


def rules():
    return json.loads(TABLE.read_text(encoding="utf-8"))


def rung_names():
    return [rung["name"] for rung in rules()["rungs"]]


def rung_row(name):
    return next(rung for rung in rules()["rungs"] if rung["name"] == name)


def moved(base, shifts):
    """The rung the table puts `base` on after `shifts`, clamped to its ends."""
    names, table = rung_names(), rules()
    index = names.index(base) + sum(table["shifts"][name]["step"] for name in shifts)
    return names[max(0, min(len(names) - 1, index))]


def outcome_of(rung, roll):
    return "severe" if roll <= rung["severe_at_most"] else "escalates" if roll <= rung["escalates_at_most"] else "nothing"


def stakes(client, name="Walter Corbitt"):
    return client.ok("npc.stakes", {"campaign": "c1", "name": name})


def situation(client, name="Walter Corbitt"):
    return client.ok("npc.situation", {"campaign": "c1", "name": name})


def stakes_receipts(client):
    return [r for r in client.table("status")["receipts"] if r["kind"] == "roll" and r.get("family") == "stakes"]


def player_facing(mechanics):
    """§16.5: a surface that renders for the player hides every `visibility: keeper` row (the player's card,
    `playerVisible` in pipicoc/mechanics.js); a `concealed` row stays, without its figures."""
    return [row for row in mechanics if row.get("visibility") != "keeper"]


def client_for(tmp_path, seed, combat=None):
    content = content_with(tmp_path, combat) if combat is not None else None
    return RpcClient(tmp_path / "ws", env={"COC_KERNEL_SEED": str(seed)}, content=content)


def met_corbitt(client):
    """Turn 1: walk down to Corbitt and make the Mod's first-impression check against him, so no prepared reaction is
    left for him. A content copy carries no Mod (the packages sit beside the shipped content, not inside it), so there
    is no check to make there. Returns the next call number."""
    open_turn(client, "I hit him.")
    n = walk_to_confrontation(client)
    if situation(client)["constraints"]:
        resolve(client, f"t1-c{n}", intent="social", decision="natural-npc:first-impression", target="Walter Corbitt", goal="size him up")
        n += 1
    assert situation(client)["constraints"] == [], "nothing is prepared for him now"
    return n


def hit_corbitt(client):
    """`met_corbitt`, then the investigator's punch and Corbitt's dodge. Returns the next call number."""
    n = met_corbitt(client)
    resolve(client, f"t1-c{n}", intent="combat", goal="hit him", method="fists", target="Walter Corbitt", weapon="unarmed")
    resolve(client, f"t1-c{n + 1}", intent="combat", goal="combat:defend", method="combat:defend", actor="Walter Corbitt", defense="dodge")
    return n + 2


# ---- the acceptance: a landed blow, the die, the Keeper's eyes only ---------------------------------------------------

@pytest.mark.parametrize("seed,outcome", LANDED.items(), ids=[f"seed{seed}-{outcome}" for seed, outcome in LANDED.items()])
def test_after_a_landed_blow_the_rung_is_one_above_his_base_and_only_the_keeper_sees_the_die(tmp_path, seed, outcome):
    client = client_for(tmp_path, seed)
    try:
        hit_corbitt(client)
        receipts = client.table("status")["receipts"]
        attack = next(r for r in receipts if r["kind"] == "roll" and r.get("combat_action") == "attack")
        assert attack["actor"] == INVESTIGATOR and attack["npc"] == CORBITT
        assert any(r["kind"] == "roll" and r.get("form") == "dice" and r.get("actor") == INVESTIGATOR for r in receipts), \
            f"seed {seed}: the punch lands (its damage die is rolled)"
        before = situation(client)
        assert before["stakes"] is None, "reading the situation never rolls the die"

        result = stakes(client)
        [receipt] = stakes_receipts(client)
        table, names = rules(), rung_names()
        base = table["default_rung"]
        assert receipt["base"] == {"rung": base, "from": "default"}, "no disposition, no archetype: the table's default"
        assert receipt["shifts"] == ["attacked_this_turn"]
        assert names.index(receipt["rung"]) == names.index(base) + 1, "one rung above the base"
        assert receipt["rung"] == moved(base, ["attacked_this_turn"])
        rung = rung_row(receipt["rung"])
        assert isinstance(receipt["roll"], int) and 1 <= receipt["roll"] <= 100
        assert receipt["outcome"] == outcome_of(rung, receipt["roll"]) == outcome, f"seed {seed} rolls {receipt['roll']}"
        line = rung["lines"].get(outcome)
        assert result == {"stakes": {"rung": receipt["rung"], "outcome": outcome, "line": line}}
        assert (line is None) == (outcome == "nothing")
        assert receipt["kind"] == "roll" and receipt["family"] == "stakes" and receipt["actor"] == CORBITT
        assert receipt["actor_is_investigator"] is False

        # The Keeper's receipt: hidden on the player's card, and projected for the log with its tier.
        mechanics = client.table("status")["mechanics"]
        assert receipt["id"] not in [m["receipt"] for m in player_facing(mechanics)], "the player is never told the die was rolled"
        row = next(m for m in mechanics if m["receipt"] == receipt["id"])
        assert row["visibility"] == "keeper" and row["family"] == "stakes" and receipt["visibility"] == "keeper"

        after = situation(client)
        assert after["stakes"] == result["stakes"], "the packet reads the same {rung, outcome, line} from the receipt"
        assert after["happened"] == before["happened"], "the die is not something that happened to him"
    finally:
        client.close()


# ---- prepared: no die ------------------------------------------------------------------------------------------------

def test_a_person_with_a_prepared_reaction_gets_no_die(tmp_path):
    client = client_for(tmp_path, 7)
    try:
        open_turn(client, "I creep into the cellar.")
        walk_to_confrontation(client)
        # The Mod's contact check with Corbitt is still to come.
        assert any(line.startswith("Mod check natural-npc:first-impression") for line in situation(client)["constraints"])
        assert stakes(client) == {"stakes": None, "reason": "prepared"}
        # The book skips Arty Wilmot's reaction roll: a preordained reaction of a scene obligation.
        assert any("Arty Wilmot" in line for line in situation(client, "Arty Wilmot")["constraints"])
        assert stakes(client, "Arty Wilmot") == {"stakes": None, "reason": "prepared"}
        assert stakes_receipts(client) == []
        assert situation(client)["stakes"] is None and situation(client, "Arty Wilmot")["stakes"] is None
    finally:
        client.close()


# ---- once per person per turn ----------------------------------------------------------------------------------------

def test_the_die_is_rolled_once_per_person_per_turn_and_only_in_an_open_turn(tmp_path):
    client = client_for(tmp_path, 6)
    try:
        n = hit_corbitt(client)
        first = stakes(client)
        [receipt] = stakes_receipts(client)
        assert stakes(client) == first, "a second call answers the receipt already written"
        assert stakes_receipts(client) == [receipt], "and writes nothing"
        assert situation(client)["stakes"] == first["stakes"]

        narrate(client, f"t1-c{n}", "他挨了一拳，退到墙边。")
        error = client.err("npc.stakes", {"campaign": "c1", "name": "Walter Corbitt"})
        assert error["code"] == "turn_state" and error["details"]["state"] == "awaiting_player"
        assert read_json(campaign_dir(client.workspace) / "turn.json")["receipts"] == []

        # The next turn is a new turn: last turn's die is not this turn's, and nothing was done to him yet.
        client.table("player_input", text="I back away from him.")
        assert situation(client)["stakes"] is None
        second = stakes(client)
        [again] = stakes_receipts(client)
        assert again["id"] != receipt["id"] and again["shifts"] == [] and again["rung"] == rules()["default_rung"]
        assert second["stakes"]["rung"] == again["rung"]
    finally:
        client.close()


# ---- the die is no check: the readers that take a roll for one skip it -----------------------------------------------

def test_the_die_is_no_interaction_no_fact_and_not_the_last_roll(tmp_path):
    client = client_for(tmp_path, 8)
    try:
        n = hit_corbitt(client)
        stakes(client)
        [receipt] = stakes_receipts(client)
        turn = client.table("status")["receipts"]
        narrate(client, f"t1-c{n}", "他挨了一拳，眼神变了。")

        ledger = read_json(campaign_dir(client.workspace) / "npc-ledger.json")["npc-walter-corbitt"]
        assert receipt["id"] not in [row["receipt"] for row in ledger["interactions"]], "the ledger's fold reads no interaction from it"
        record = read_json(campaign_dir(client.workspace) / "turns" / "0001.json")
        committed = record["facts"]["committed"]
        assert not any("None" in line for line in committed), f"no committed fact is read off the die: {committed}"

        # The Director's last roll is the turn's last check, not the die rolled after it.
        checks = [r for r in turn if r["kind"] == "roll" and r.get("form") != "dice" and r.get("family") != "stakes"]
        last = checks[-1]
        expected = last["level"] if last.get("level") in ("critical", "fumble") else "passed" if last.get("passed") else "failed"
        assert expected != "failed", "the seed is chosen so that the die (which passes nothing) would read differently"
        director = client.table("player_input", text="I step back.")["capsule"]["director"]
        assert f"last_roll = {expected}" in director["because"]
    finally:
        client.close()


def test_a_die_rolled_for_someone_elsewhere_names_no_one_into_the_journal(tmp_path):
    client = client_for(tmp_path, 7)
    try:
        open_turn(client, "I ask Knott about the house.")
        world = read_json(campaign_dir(client.workspace) / "world.json")
        assert world["npc_presence"]["dooley"] != world["active_scene"], "Dooley is not in the office"
        stakes(client, "Mr. Dooley")
        assert len(stakes_receipts(client)) == 1
        narrate(client, "t1-c1", "诺特点了点头。")
        packet = client.ok("journal.job", {"campaign": "c1", "turn": 1})
        assert "Mr. Dooley" not in packet["recordable"], "the Keeper's die is no meeting the player had"
    finally:
        client.close()


# ---- the base rung ---------------------------------------------------------------------------------------------------

def test_the_base_is_the_disposition_word_first(tmp_path):
    client = client_for(tmp_path, 7, combat={"disposition": "fights_to_the_end"})
    try:
        met_corbitt(client)
        stakes(client)
        [receipt] = stakes_receipts(client)
        base = rules()["base_by_disposition"]["fights_to_the_end"]
        assert receipt["base"] == {"rung": base, "from": "disposition", "word": "fights_to_the_end"}
        assert receipt["shifts"] == [] and receipt["rung"] == base
    finally:
        client.close()


def test_without_a_disposition_the_pinned_archetype_gives_the_base(tmp_path):
    client = client_for(tmp_path, 7)
    try:
        open_turn(client, "I ask around the neighbourhood.")
        client.table("apply", call_id="t1-c1", effects=[{"kind": "npc", "name": "Mr. Dooley", "archetype": "dangerous_actor", "why": "a hard man"}])
        assert situation(client, "Mr. Dooley")["constraints"] == []
        stakes(client, "Mr. Dooley")
        [receipt] = stakes_receipts(client)
        base = rules()["base_by_archetype"]["dangerous_actor"]
        assert receipt["actor"] == "dooley" and receipt["base"] == {"rung": base, "from": "archetype", "word": "dangerous_actor"}
        assert receipt["rung"] == base
    finally:
        client.close()


# ---- the shifts, each as the table states it -------------------------------------------------------------------------

def advance_awareness(segments):
    return lambda client, n: client.table("apply", call_id=f"t1-c{n}", effects=[
        {"kind": "threat", "name": "threat-corbitt-haunting", "clock": "corbitt-awareness", "segments": segments, "why": "test"}])


def set_stance(word):
    return lambda client, n: client.table("apply", call_id=f"t1-c{n}", effects=[
        {"kind": "npc", "name": "Walter Corbitt", "stance": word, "why": "test"}])


# (id, setup after the first impression, expected shifts). The awareness clock has four segments: three is past half,
# two is exactly half and not past it.
SHIFT_CASES = [
    ("clock-past-half", advance_awareness(3), ["table_clock_past_half"]),
    ("clock-at-half", advance_awareness(2), []),
    ("stance-warm", set_stance("warm"), ["stance_friendly"]),
    ("stance-wary", set_stance("wary"), []),
]


@pytest.mark.parametrize("setup,expected", [case[1:] for case in SHIFT_CASES], ids=[case[0] for case in SHIFT_CASES])
def test_each_shift_is_the_tables(tmp_path, setup, expected):
    client = client_for(tmp_path, 7)
    try:
        n = met_corbitt(client)
        setup(client, n)
        stakes(client)
        [receipt] = stakes_receipts(client)
        assert receipt["shifts"] == expected
        assert receipt["rung"] == moved(rules()["default_rung"], expected)
    finally:
        client.close()


def test_hit_points_at_half_move_him_up_and_the_last_rung_holds(tmp_path):
    client = client_for(tmp_path, 6, combat={"disposition": "fights_to_the_end"})
    try:
        hit_corbitt(client)
        edit_fight(client, hp_fraction=rules()["shifts"]["hp_at_most_half"]["hp_fraction_at_most"])
        stakes(client)
        [receipt] = stakes_receipts(client)
        assert receipt["shifts"] == ["attacked_this_turn", "hp_at_most_half"]
        names, base = rung_names(), rules()["base_by_disposition"]["fights_to_the_end"]
        assert names.index(base) + 2 > len(names) - 1, "the case is one the clamp decides"
        assert receipt["rung"] == names[-1], "clamped to the last rung"
    finally:
        client.close()


# ---- the table is checked whole before anything is rolled ------------------------------------------------------------

def certain_severe(table):
    table["rungs"][-1]["severe_at_most"] = 100
    table["rungs"][-1]["escalates_at_most"] = 100


def unknown_shift(table):
    table["shifts"]["outnumbered"] = {"step": 1}


def default_is_no_rung(table):
    table["default_rung"] = "furious"


def falling_rungs(table):
    table["rungs"][0]["severe_at_most"] = table["rungs"][-1]["severe_at_most"] + 1


BROKEN = [certain_severe, unknown_shift, default_is_no_rung, falling_rungs]


@pytest.mark.parametrize("breaking", BROKEN, ids=[f.__name__ for f in BROKEN])
def test_a_table_the_kernel_cannot_read_is_refused_and_nothing_is_rolled(tmp_path, breaking):
    content = tmp_path / "content"
    shutil.copytree(CONTENT_DIR, content)
    path = content / "rulesets" / "coc7" / "rules-json" / "npc-stakes.json"
    table = json.loads(path.read_text(encoding="utf-8"))
    breaking(table)
    path.write_text(json.dumps(table), encoding="utf-8")
    client = RpcClient(tmp_path / "ws", env={"COC_KERNEL_SEED": "7"}, content=content)
    try:
        open_turn(client, "I ask around the neighbourhood.")
        error = client.err("npc.stakes", {"campaign": "c1", "name": "Mr. Dooley"})
        assert error["code"] == "campaign_not_ready" and "npc-stakes.json" in error["fix"]
        assert stakes_receipts(client) == []
    finally:
        client.close()


def test_the_shipped_table_names_every_disposition_and_archetype_and_no_certain_rung():
    table = rules()
    assert table["contract_id"] == "coc.npc-stakes.v1"
    names = rung_names()
    archetypes = json.loads((CONTENT_DIR / "rulesets" / "coc7" / "rules-json" / "npc-stat-archetypes.json").read_text(encoding="utf-8"))
    assert set(table["base_by_archetype"]) == {a["archetype_id"] for a in archetypes["archetypes"]}
    disposition = json.loads((CONTENT_DIR / "rulesets" / "coc7" / "rules-json" / "npc-combat-disposition.json").read_text(encoding="utf-8"))
    assert set(table["base_by_disposition"]) == set(disposition["dispositions"])
    assert all(rung["severe_at_most"] < 100 for rung in table["rungs"]), "no rung makes severe certain (spec D9)"
    assert table["default_rung"] in names
    assert set(table["shifts"]) == {"attacked_this_turn", "hp_at_most_half", "table_clock_past_half", "stance_friendly"}
