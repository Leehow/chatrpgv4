"""Contract §143.8 (docs/specs/npc-acts-first.md D9, ticket 09), over the emitted kernel.

`npc.stakes {campaign, name}` is the Keeper's stakes die for a person whose reaction the book does not preordain: a rung read
from `content/rulesets/coc7/rules-json/npc-stakes.json` (base from the person's combat disposition, else the archetype the
table pinned, else the table's default; moved by the table's shifts), one d100 on the kernel's seeded die, and one
keeper-visible `roll` receipt of family `stakes` in the open turn -- once per person per turn. `npc.situation` carries
`{rung, outcome, line, surprise, surprise_line}` read from that receipt and never rolls.

§143.19 (ticket 20, spec D10): the same roll at most the rung's `surprise_at_most` is a surprise -- this person may bring
out something no one at the table knew they had; the table's permission line rides with it (`severe_surprise` on a severe
roll). The three columns rise with the rung, or the table is refused.

§143.26 (ticket 27, the table `npc-acts-d`): a person being fought is not calm between blows. Two structural shifts join
the table -- `in_fight_with_investigators` (a fight is running with them and an investigator among its participants) and
`attacked_last_turn` (this turn's predicate over the newest committed turn). With `attacked_this_turn` they are one
dimension, violence toward this person: the table groups them (`shift_groups`), and a group moves the rung once, by its
largest step -- the punch that opens a fight is +1, not +2 (the lead's ruling, 2026-09-26).

Corbitt is the person. As the starter ships, the natural-npc Mod's first-impression check against him is still to come:
a row of his `constraints` for the generator, and no prepared reaction -- only the book's preordained reaction is one
(Arty Wilmot's, below). His book gives him no combat disposition, so his base is the table's default. The investigator's
punch opens a fight with him in it: since §143.26 both the blow and the fight hold, one group, one rung up. With seeds 3,
2 and 1 the punch lands (its damage die is rolled; his Flesh Ward armour takes it, so his hit points stay whole) and the
die then says severe, escalates and nothing. Every expected number is read from the shipped table, never restated.
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
# Re-read for ticket 20's thresholds (dangerous 15/45): seed 3 rolls 5, seed 2 rolls 30, seed 1 rolls 56.
# §143.26: the fight the punch opens is in the blow's group, so the rung is still dangerous and these seeds stand.
LANDED = {3: "severe", 2: "escalates", 1: "nothing"}
# §143.19: seeds whose die, after the punch (landed or not, the rung is dangerous), falls on each side of the rung's
# surprise column (30): 5 and 30 (the boundary) allow a surprise, 39 and 56 do not. Chosen by running them, as above.
SURPRISE_SEEDS = {3: True, 2: True, 7: False, 1: False}
# §143.26: the two shifts the fight and the blow put on him, in the table's order -- one group, one rung.
IN_A_FIGHT = ["attacked_this_turn", "in_fight_with_investigators"]


def rules():
    return json.loads(TABLE.read_text(encoding="utf-8"))


def rung_names():
    return [rung["name"] for rung in rules()["rungs"]]


def rung_row(name):
    return next(rung for rung in rules()["rungs"] if rung["name"] == name)


def moved(base, shifts):
    """The rung the table puts `base` on after `shifts`, clamped to its ends. §143.26: a shift of no group adds its step;
    the shifts of one group add once, the largest step among them."""
    names, table = rung_names(), rules()
    alone, grouped = 0, {}
    for name in shifts:
        shift = table["shifts"][name]
        if "group" not in shift:
            alone += shift["step"]
        elif abs(shift["step"]) > abs(grouped.get(shift["group"], 0)):
            grouped[shift["group"]] = shift["step"]
    index = names.index(base) + alone + sum(grouped.values())
    return names[max(0, min(len(names) - 1, index))]


def outcome_of(rung, roll):
    return "severe" if roll <= rung["severe_at_most"] else "escalates" if roll <= rung["escalates_at_most"] else "nothing"


def view_of(rung, roll):
    """The `{rung, outcome, line, surprise, surprise_line}` the shipped table gives this roll on this rung (§143.19)."""
    outcome = outcome_of(rung, roll)
    surprise = roll <= rung["surprise_at_most"]
    permission = rung["lines"]["severe_surprise" if outcome == "severe" else "surprise"] if surprise else None
    return {"rung": rung["name"], "outcome": outcome, "line": rung["lines"].get(outcome), "surprise": surprise, "surprise_line": permission}


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


def at_corbitt(client):
    """Turn 1: walk down to Corbitt. Returns the next call number."""
    open_turn(client, "I hit him.")
    return walk_to_confrontation(client)


def hit_corbitt(client):
    """`at_corbitt`, then the investigator's punch and Corbitt's dodge. Returns the next call number."""
    n = at_corbitt(client)
    resolve(client, f"t1-c{n}", intent="combat", goal="hit him", method="fists", target="Walter Corbitt", weapon="unarmed")
    resolve(client, f"t1-c{n + 1}", intent="combat", goal="combat:defend", method="combat:defend", actor="Walter Corbitt", defense="dodge")
    return n + 2


# ---- the acceptance: a landed blow, the die, the Keeper's eyes only ---------------------------------------------------

@pytest.mark.parametrize("seed,outcome", LANDED.items(), ids=[f"seed{seed}-{outcome}" for seed, outcome in LANDED.items()])
def test_after_a_landed_blow_the_rung_is_one_above_his_base_and_only_the_keeper_sees_the_die(tmp_path, seed, outcome):
    client = client_for(tmp_path, seed)
    try:
        hit_corbitt(client)
        contact = [line for line in situation(client)["constraints"] if line.startswith("Mod check natural-npc:first-impression")]
        assert contact, "the Mod's first contact with him is still to come: a row for the generator, not a prepared reaction"
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
        assert receipt["shifts"] == IN_A_FIGHT, "the blow, and the fight it opened (§143.26)"
        assert names.index(receipt["rung"]) == names.index(base) + 1, "one rung above the base: the blow and the fight are one group"
        assert receipt["rung"] == moved(base, IN_A_FIGHT)
        rung = rung_row(receipt["rung"])
        assert isinstance(receipt["roll"], int) and 1 <= receipt["roll"] <= 100
        assert receipt["outcome"] == outcome_of(rung, receipt["roll"]) == outcome, f"seed {seed} rolls {receipt['roll']}"
        line = rung["lines"].get(outcome)
        # §143.19: the view carries the surprise the same roll allows on this rung, and its permission line.
        assert result == {"stakes": view_of(rung, receipt["roll"])}
        assert result["stakes"]["line"] == line
        assert (line is None) == (outcome == "nothing")
        assert receipt["kind"] == "roll" and receipt["family"] == "stakes" and receipt["actor"] == CORBITT
        assert receipt["actor_is_investigator"] is False

        # The Keeper's receipt: hidden on the player's card, and projected for the log with its tier.
        mechanics = client.table("status")["mechanics"]
        assert receipt["id"] not in [m["receipt"] for m in player_facing(mechanics)], "the player is never told the die was rolled"
        row = next(m for m in mechanics if m["receipt"] == receipt["id"])
        assert row["visibility"] == "keeper" and row["family"] == "stakes" and receipt["visibility"] == "keeper"

        after = situation(client)
        assert after["stakes"] == result["stakes"], "the packet reads the same {rung, outcome, line, surprise, surprise_line} from the receipt"
        assert after["happened"] == before["happened"], "the die is not something that happened to him"
    finally:
        client.close()


# ---- §143.19: the same roll allows a surprise, at most the rung's own column ----------------------------------------

@pytest.mark.parametrize("seed,expected", SURPRISE_SEEDS.items(), ids=[f"seed{seed}-{'surprise' if e else 'none'}" for seed, e in SURPRISE_SEEDS.items()])
def test_on_the_dangerous_rung_a_roll_at_most_its_surprise_column_allows_a_surprise(tmp_path, seed, expected):
    client = client_for(tmp_path, seed)
    try:
        hit_corbitt(client)
        result = stakes(client)
        [receipt] = stakes_receipts(client)
        assert receipt["rung"] == "dangerous" == moved(rules()["default_rung"], IN_A_FIGHT), "the punch moves him to dangerous"
        rung = rung_row(receipt["rung"])
        assert receipt["surprise_at_most"] == rung["surprise_at_most"] == 30, "the ticket's dangerous surprise column"
        assert receipt["surprise"] is (receipt["roll"] <= rung["surprise_at_most"]) is expected, f"seed {seed} rolls {receipt['roll']}"
        expected_line = rung["lines"]["severe_surprise" if receipt["outcome"] == "severe" else "surprise"] if expected else None
        assert receipt["surprise_line"] == expected_line, "the table's permission, the severe one on a severe roll"
        assert result == {"stakes": view_of(rung, receipt["roll"])}
        packet = situation(client)["stakes"]
        assert packet["surprise"] is receipt["surprise"] and packet["surprise_line"] == receipt["surprise_line"], \
            "the situation's stakes.surprise is the receipt's"
        assert packet == result["stakes"]
    finally:
        client.close()


def test_a_severe_roll_that_surprises_carries_the_severe_permission(tmp_path):
    client = client_for(tmp_path, 3)
    try:
        hit_corbitt(client)
        view = stakes(client)["stakes"]
        rung = rung_row(view["rung"])
        assert view["outcome"] == "severe" and view["surprise"] is True
        assert view["surprise_line"] == rung["lines"]["severe_surprise"] != rung["lines"]["surprise"]
    finally:
        client.close()


# §143.30 (ticket 32): the owner's words, 2026-09-26 -- the top rung's surprise is the table's fun, not a plausible thing.
# The lower permission is ticket 20's, unchanged.
TOP_RUNG_INVITES = ("need not be plausible", "the table's fun", "the less anyone could have guessed it, the better",
                    "Absurd, out of its time or wildly out of proportion", "as long as the table can picture them bringing it out right now")
LOWER_SURPRISE = "This person may have something on them or within reach that no one at the table knew they had, and may bring it out now."


def test_a_severe_surprise_packet_carries_the_permission_to_be_unexpected(tmp_path):
    """§143.30: seed 3's severe surprise reaches the generator's packet with the top rung's permission -- it need not be
    plausible, the less guessable the better, absurd, anachronistic or out of proportion, as long as it can be pictured
    brought out now -- on every rung; the lower surprise keeps "something on them or within reach no one knew of"."""
    client = client_for(tmp_path, 3)
    try:
        hit_corbitt(client)
        stakes(client)
        packet = situation(client)["stakes"]
        assert packet["outcome"] == "severe" and packet["surprise"] is True
        missing = [phrase for phrase in TOP_RUNG_INVITES if phrase not in packet["surprise_line"]]
        assert not missing, f"the packet's permission lacks {missing}: {packet['surprise_line']}"
        for rung in rules()["rungs"]:
            assert rung["lines"]["severe_surprise"] == packet["surprise_line"], f"{rung['name']}: every rung's top surprise invites it"
            assert rung["lines"]["surprise"] == LOWER_SURPRISE, f"{rung['name']}: the lower surprise is unchanged"
    finally:
        client.close()


# ---- prepared: only a reaction the book preordains keeps the die in the cup ------------------------------------------

def test_a_first_contact_row_and_an_open_obligation_do_not_prepare_him(tmp_path):
    """Knott in his office: the book's commission obligation is open and names him, and the Mod's first-impression
    check with him is still to come. Both stay in his `constraints` for the generator; neither is a reaction the book
    prepared, so the die rolls."""
    client = client_for(tmp_path, 7)
    try:
        open_turn(client, "I tell Knott I will not take the job.")
        constraints = situation(client, "Steven Knott")["constraints"]
        obligation = [line for line in constraints if line.startswith("scene obligation knott-accept-commission (open)")]
        contact = [line for line in constraints if line.startswith("Mod check natural-npc:first-impression")]
        assert obligation and contact and len(constraints) == 2, constraints
        assert not any("reaction roll" in line for line in constraints), "the commission is plot, not a preordained reaction"
        result = stakes(client, "Steven Knott")
        assert result.get("reason") != "prepared" and result["stakes"] is not None, \
            f"a first-contact row and an open obligation prepare nothing: {result}"
        [receipt] = stakes_receipts(client)
        assert receipt["actor"] == "steven-knott" and result["stakes"]["rung"] == receipt["rung"]
        assert situation(client, "Steven Knott")["constraints"] == constraints, "the rows stay in the packet"
    finally:
        client.close()


def test_a_reaction_the_book_preordains_is_prepared_until_its_obligation_is_done(tmp_path):
    """Arty Wilmot: the book skips his reaction roll (`requirement-globe-clippings-access`, `reaction: preordained`).
    While that obligation is open the die stays in its cup and nothing is written; once it is waived the book has
    nothing more prepared for him, and the die rolls."""
    client = client_for(tmp_path, 7)
    try:
        open_turn(client, "I ask at the Globe for the old clippings.")
        preordained = [line for line in situation(client, "Arty Wilmot")["constraints"]
                       if line.startswith("scene obligation globe-clippings-access (open)")]
        assert preordained and "the book skips Arty Wilmot's reaction roll" in preordained[0]
        assert stakes(client, "Arty Wilmot") == {"stakes": None, "reason": "prepared"}
        assert stakes_receipts(client) == [] and situation(client, "Arty Wilmot")["stakes"] is None

        client.table("apply", call_id="t1-c1", effects=[{"kind": "flag", "name": "newspaper-morgue-clippings-access",
                                                         "value": True, "why": "he let us into the morgue"}])
        assert any(line.startswith("scene obligation globe-clippings-access (waived)")
                   for line in situation(client, "Arty Wilmot")["constraints"])
        result = stakes(client, "Arty Wilmot")
        [receipt] = stakes_receipts(client)
        assert receipt["actor"] == "arty-wilmot" and result["stakes"]["rung"] == receipt["rung"]
    finally:
        client.close()


# ---- once per person per turn ----------------------------------------------------------------------------------------

def test_the_die_is_rolled_once_per_person_per_turn_and_only_in_an_open_turn(tmp_path):
    client = client_for(tmp_path, 2)
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

        # The next turn is a new turn: last turn's die is not this turn's, and nothing was done to him yet this turn --
        # but since §143.26 last turn's punch and the fight still running move him (one group: one rung).
        client.table("player_input", text="I back away from him.")
        assert situation(client)["stakes"] is None
        second = stakes(client)
        [again] = stakes_receipts(client)
        assert again["id"] != receipt["id"] and again["shifts"] == ["attacked_last_turn", "in_fight_with_investigators"]
        assert again["rung"] == moved(rules()["default_rung"], again["shifts"])
        assert second["stakes"]["rung"] == again["rung"]
    finally:
        client.close()


# ---- the die is no check: the readers that take a roll for one skip it -----------------------------------------------

def test_the_die_is_no_interaction_no_fact_and_not_the_last_roll(tmp_path):
    client = client_for(tmp_path, 2)
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
        at_corbitt(client)
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


# (id, setup once he is reached, expected shifts). The awareness clock has four segments: three is past half,
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
        n = at_corbitt(client)
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
        assert receipt["shifts"] == [*IN_A_FIGHT, "hp_at_most_half"]
        names, base = rung_names(), rules()["base_by_disposition"]["fights_to_the_end"]
        assert names.index(base) + 2 > len(names) - 1, "the case is one the clamp decides"
        assert receipt["rung"] == names[-1], "clamped to the last rung"
    finally:
        client.close()


# ---- §143.26: a person being fought is not calm between blows (ticket 27) --------------------------------------------
#
# The table `npc-acts-d`: the Keeper gave Knott `avoids_fighting` (base calm), and the only upward shift a fight moved
# was "attacked this turn" -- so on his own turn of the fight, a turn after a punch, and when he had just been chased and
# struck, he stood on calm. Corbitt carries the same authored disposition here.

CALM = {"disposition": "avoids_fighting"}


def at_least(name, floor):
    names = rung_names()
    return names.index(name) >= names.index(floor)


def test_in_a_fight_with_the_investigators_a_calm_man_is_at_least_tense_though_no_one_struck_him(tmp_path):
    """He throws the first punch: a fight runs with him and the investigator in it, and no attack roll was made against
    him and he lost no hit points, this turn or before. The fight alone moves him."""
    client = client_for(tmp_path, 7, combat=CALM)
    try:
        n = at_corbitt(client)
        swing = resolve(client, f"t1-c{n}", intent="combat", goal="he lunges", method="", actor="Walter Corbitt", target="Thomas Hayes")
        session = swing["session"]
        assert session["kind"] == "combat" and session["status"] == "active"
        assert {CORBITT, INVESTIGATOR} <= {p["name"] for p in session["participants"]}, "he and the investigator are in the fight"
        receipts = client.table("status")["receipts"]
        assert not any(r["kind"] == "roll" and r.get("combat_action") == "attack" and r.get("npc") == CORBITT and r.get("actor") != CORBITT
                       for r in receipts), "no attack was made against him"
        assert not any(r["kind"] == "delta" and r.get("resource") == "hp" and r.get("subject") == CORBITT for r in receipts)
        assert situation(client)["state"]["in_session"] is True
        stakes(client)
        [receipt] = stakes_receipts(client)
        base = rules()["base_by_disposition"]["avoids_fighting"]
        assert receipt["base"] == {"rung": base, "from": "disposition", "word": "avoids_fighting"} and base == "calm"
        assert receipt["shifts"] == ["in_fight_with_investigators"]
        assert receipt["rung"] == moved(base, ["in_fight_with_investigators"])
        assert at_least(receipt["rung"], "tense"), "a man in a fight is not calm"
    finally:
        client.close()


def test_a_punch_that_opens_a_fight_is_one_rung_not_two(tmp_path):
    """The lead's ruling (2026-09-26): being struck, being struck last turn and being in the fight are one dimension,
    violence toward this person. The punch that opens the fight makes two of them hold; he moves one rung."""
    client = client_for(tmp_path, 2, combat=CALM)
    try:
        hit_corbitt(client)
        stakes(client)
        [receipt] = stakes_receipts(client)
        names = rung_names()
        assert receipt["base"]["rung"] == "calm" and receipt["shifts"] == IN_A_FIGHT
        assert names.index(receipt["rung"]) - names.index("calm") == 1, "+1, not +2"
        assert receipt["rung"] == "tense"
    finally:
        client.close()


def test_all_three_violence_facts_at_once_are_still_one_rung(tmp_path):
    """Turn 1 the investigator's punch; turn 2, the fight still running, he swings back and the investigator punches him
    again: struck this turn, struck last turn and in the fight -- the group moves him once."""
    client = client_for(tmp_path, 2, combat=CALM)
    try:
        n = hit_corbitt(client)
        narrate(client, f"t1-c{n}", "他挨了一拳，退到墙边。")
        client.table("player_input", text="I hit him again.")
        resolve(client, "t2-c1", intent="combat", goal="he swings back", method="", actor="Walter Corbitt", target="Thomas Hayes")
        resolve(client, "t2-c2", intent="combat", goal="combat:defend", method="combat:defend", actor="thomas-hayes", defense="dodge")
        resolve(client, "t2-c3", intent="combat", goal="hit him", method="fists", target="Walter Corbitt", weapon="unarmed")
        resolve(client, "t2-c4", intent="combat", goal="combat:defend", method="combat:defend", actor="Walter Corbitt", defense="dodge")
        stakes(client)
        [receipt] = stakes_receipts(client)
        assert receipt["shifts"] == ["attacked_this_turn", "attacked_last_turn", "in_fight_with_investigators"]
        assert receipt["rung"] == "tense" == moved("calm", receipt["shifts"]), "three facts of one group: one rung"
    finally:
        client.close()


def test_his_own_turn_of_the_fight_a_turn_after_the_punch_is_tense(tmp_path):
    """Table D, turn 4: calm base, the fight still runs and last turn's punch stands against him. Nothing was done to him
    yet this turn; both shifts hold, one group, one rung: tense (the lead's ruling, 2026-09-26)."""
    client = client_for(tmp_path, 2, combat=CALM)
    try:
        n = hit_corbitt(client)
        narrate(client, f"t1-c{n}", "他挨了一拳，退到墙边。")
        client.table("player_input", text="I grab the envelope.")
        assert situation(client)["state"]["in_session"] is True
        stakes(client)
        [receipt] = stakes_receipts(client)
        assert receipt["shifts"] == ["attacked_last_turn", "in_fight_with_investigators"]
        assert receipt["rung"] == moved("calm", receipt["shifts"]) == "tense"
    finally:
        client.close()


def test_last_turns_blow_moves_him_with_no_fight_running_and_only_the_newest_committed_turn_counts(tmp_path):
    """Turn 1 the punch, then the fight is ended; turn 2 no fight runs and nothing is done to him: last turn's blow alone
    moves him. Turn 3: the blow is two committed turns back, not the newest -- calm again."""
    client = client_for(tmp_path, 2, combat=CALM)
    try:
        n = hit_corbitt(client)
        resolve(client, f"t1-c{n}", intent="combat", goal="both back off", method="", decision="combat:end", outcome="stalemate")
        assert client.table("look")["where"]["session"] is None
        narrate(client, f"t1-c{n + 1}", "两人都退开了。")
        record = read_json(campaign_dir(client.workspace) / "turns" / "0001.json")
        assert any(r["kind"] == "roll" and r.get("combat_action") == "attack" and r.get("npc") == CORBITT for r in record["receipts"]), \
            "the committed turn holds the attack made against him"

        client.table("player_input", text="I watch him from the doorway.")
        assert situation(client)["state"]["in_session"] is False, "no fight runs"
        stakes(client)
        [second] = stakes_receipts(client)
        assert second["shifts"] == ["attacked_last_turn"]
        assert second["rung"] == moved("calm", ["attacked_last_turn"]) and at_least(second["rung"], "tense")
        narrate(client, "t2-c1", "他没有动。")

        client.table("player_input", text="I keep watching him.")
        stakes(client)
        [third] = stakes_receipts(client)
        assert third["shifts"] == [] and third["rung"] == "calm", "a blow two committed turns back is not last turn's"
    finally:
        client.close()


def test_nothing_done_and_no_fight_is_calm_as_before(tmp_path):
    client = client_for(tmp_path, 7, combat=CALM)
    try:
        at_corbitt(client)
        stakes(client)
        [receipt] = stakes_receipts(client)
        assert receipt["shifts"] == [] and receipt["rung"] == "calm"
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


def fight_shift_with_a_parameter(table):
    """§143.26: the two structural shifts take no parameter."""
    table["shifts"]["in_fight_with_investigators"]["hp_fraction_at_most"] = 0.5


def last_turn_shift_without_an_integer_step(table):
    table["shifts"]["attacked_last_turn"]["step"] = 0.5


def shift_names_an_undeclared_group(table):
    table["shifts"]["hp_at_most_half"]["group"] = "rage"


def group_of_one_shift(table):
    for name in ("attacked_last_turn", "in_fight_with_investigators"):
        del table["shifts"][name]["group"]


def group_whose_steps_move_both_ways(table):
    table["shifts"]["stance_friendly"]["group"] = "violence"


def group_without_a_note(table):
    table["shift_groups"]["violence"] = " "


BROKEN = [certain_severe, unknown_shift, default_is_no_rung, falling_rungs, fight_shift_with_a_parameter, last_turn_shift_without_an_integer_step,
          shift_names_an_undeclared_group, group_of_one_shift, group_whose_steps_move_both_ways, group_without_a_note]


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


# §143.19: the surprise column is read the same way; each of the three columns rises (or stays) with the rung.
def falling_surprise(table):
    table["rungs"][1]["surprise_at_most"] = table["rungs"][0]["surprise_at_most"] - 1


def falling_escalates(table):
    table["rungs"][-1]["escalates_at_most"] = table["rungs"][-2]["escalates_at_most"] - 1


def surprise_off_the_die(table):
    table["rungs"][-1]["surprise_at_most"] = 101


def no_surprise_column(table):
    del table["rungs"][0]["surprise_at_most"]


def no_permission_line(table):
    del table["rungs"][0]["lines"]["surprise"]


def no_severe_permission_line(table):
    del table["rungs"][2]["lines"]["severe_surprise"]


SURPRISE_BROKEN = [falling_surprise, falling_escalates, surprise_off_the_die, no_surprise_column, no_permission_line, no_severe_permission_line]


def with_table(tmp_path, change):
    content = tmp_path / "content"
    shutil.copytree(CONTENT_DIR, content)
    path = content / "rulesets" / "coc7" / "rules-json" / "npc-stakes.json"
    table = json.loads(path.read_text(encoding="utf-8"))
    change(table)
    path.write_text(json.dumps(table), encoding="utf-8")
    return content


@pytest.mark.parametrize("breaking", SURPRISE_BROKEN, ids=[f.__name__ for f in SURPRISE_BROKEN])
def test_a_column_that_falls_or_a_missing_surprise_is_refused_before_a_roll(tmp_path, breaking):
    client = RpcClient(tmp_path / "ws", env={"COC_KERNEL_SEED": "7"}, content=with_table(tmp_path, breaking))
    try:
        open_turn(client, "I ask around the neighbourhood.")
        error = client.err("npc.stakes", {"campaign": "c1", "name": "Mr. Dooley"})
        assert error["code"] == "campaign_not_ready" and "npc-stakes.json" in error["fix"], error
        assert stakes_receipts(client) == []
    finally:
        client.close()


def test_a_table_whose_columns_rise_or_stay_is_read(tmp_path):
    """Monotone, not strictly rising: a surprise column that stays level across every rung is a table the kernel reads."""
    def level(table):
        for rung in table["rungs"]:
            rung["surprise_at_most"] = 25
    client = RpcClient(tmp_path / "ws", env={"COC_KERNEL_SEED": "7"}, content=with_table(tmp_path, level))
    try:
        open_turn(client, "I ask around the neighbourhood.")
        view = stakes(client, "Mr. Dooley")["stakes"]
        [receipt] = stakes_receipts(client)
        assert receipt["surprise_at_most"] == 25 and view["surprise"] is (receipt["roll"] <= 25)
    finally:
        client.close()


def test_the_shipped_columns_are_the_tickets_and_rise_with_the_rung():
    columns = {rung["name"]: (rung["severe_at_most"], rung["escalates_at_most"], rung["surprise_at_most"]) for rung in rules()["rungs"]}
    assert columns == {"calm": (3, 15, 10), "tense": (8, 30, 20), "dangerous": (15, 45, 30), "lethal": (30, 65, 45)}, "ticket 20's table"
    values = list(columns.values())
    for column in range(3):
        assert all(a[column] <= b[column] for a, b in zip(values, values[1:])), f"column {column} rises with the rung"
    for rung in rules()["rungs"]:
        assert set(rung["lines"]) == {"severe", "escalates", "surprise", "severe_surprise"}


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
    assert set(table["shifts"]) == {"attacked_this_turn", "attacked_last_turn", "in_fight_with_investigators", "hp_at_most_half",
                                    "table_clock_past_half", "stance_friendly"}
    # §143.26: violence toward this person is one group; the other shifts stand alone.
    assert set(table["shift_groups"]) == {"violence"}
    assert {name for name, shift in table["shifts"].items() if shift.get("group") == "violence"} == \
        {"attacked_this_turn", "attacked_last_turn", "in_fight_with_investigators"}
    assert not any("group" in table["shifts"][name] for name in ("hp_at_most_half", "table_clock_past_half", "stance_friendly"))
