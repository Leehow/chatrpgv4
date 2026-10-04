"""Contract §143.1 (docs/specs/npc-acts-first.md D1, ticket 01), over the emitted kernel.

`npc.situation {campaign, name}` is what one person faces right now, for the step that generates what they do next:
who they are, what was just done to them (code-composed sentences from the receipts of this turn and the last, then
the player's declaration), their body and stance, what is at hand, what they already set out to do, what the book and
the active Mods require of them -- within a byte budget that cuts constraints, then what is at hand, then the oldest
of what they did.

Knott is the ticket's person: the starter prints no numbers for him, so the table pins an archetype first (§34.10);
with seed 1 the investigator's punch lands (HP 8 -> 7) and it is Knott's turn in the fight afterwards. Corbitt's
printed profile is where holdings are read from.
"""

import json
import shutil

import pytest

from conftest import CONTENT_DIR, RpcClient, campaign_dir, narrate, open_turn, read_json
from test_npc_holdings import give_corbitt_a_weapon
from test_rules_families import resolve, walk_to_confrontation

KNOTT = "steven-knott"
INVESTIGATOR = "thomas-hayes"
PUNCH = "I punch Knott in the face."
SNATCH = "I snatch the wallet out of his coat."


def situation(client, name="Steven Knott"):
    return client.ok("npc.situation", {"campaign": "c1", "name": name})


def packet_bytes(packet):
    # The kernel's measure (`jsonSize`): Python's json.dumps spacing, UTF-8, non-ASCII kept as it is.
    return len(json.dumps(packet, ensure_ascii=False).encode("utf-8"))


def receipts(client):
    return client.table("status")["receipts"]


def knott_hit_then_robbed(client):
    """Turn 1 pins Knott's numbers; turn 2 the punch lands; turn 3 (open) his money is taken."""
    open_turn(client, "I square up to Knott.")
    client.table("apply", call_id="t1-c1", effects=[{"kind": "npc", "name": "Steven Knott", "archetype": "ordinary_adult", "why": "an office man"}])
    narrate(client, "t1-c2", "Knott gets up from behind the desk.")
    client.table("player_input", text=PUNCH)
    resolve(client, "t2-c1", intent="combat", goal="hit him", method="fists", target="Steven Knott", weapon="unarmed")
    resolve(client, "t2-c2", intent="combat", goal="combat:defend", method="combat:defend", actor="Steven Knott", defense="none")
    hit = next(r for r in receipts(client) if r["kind"] == "delta" and r.get("resource") == "hp" and r.get("subject") == KNOTT)
    assert hit["after"] < hit["before"], "seed 1: the punch lands"
    narrate(client, "t2-c3", "The punch lands.")
    client.table("player_input", text=SNATCH)
    client.table("apply", call_id="t3-c1", effects=[{"kind": "cash", "subject": "Thomas Hayes", "delta": 20, "source": "found",
                                                     "with": "Steven Knott", "why": "taken from his coat"}])
    cash = next(r for r in receipts(client) if r["kind"] == "cash")
    return hit, cash


@pytest.fixture
def knott(tmp_path):
    client = RpcClient(tmp_path / "ws", env={"COC_KERNEL_SEED": "1"})
    yield client
    client.close()


def test_a_landed_blow_last_turn_and_a_purse_taken_this_turn_are_two_sentences_and_nothing_else(knott):
    hit, cash = knott_hit_then_robbed(knott)
    packet = situation(knott)
    assert packet["npc"] == {"handle": KNOTT, "name": "Steven Knott", "kind": "npc"}
    happened = packet["happened"]
    # Two sentences from receipts -- last turn's blow, this turn's cash -- then the player's declaration of this turn.
    # The archetype pin (turn 1) is outside the window, and bookkeeping besides.
    assert len(happened) == 3, happened
    blow, purse, declared = happened
    assert blow.startswith("turn 2: ") and "Fighting (Brawl) (attack) against Steven Knott" in blow, blow
    assert f"Steven Knott's hp {hit['before']} -> {hit['after']}" in blow, "the attack, its damage roll and the hp it cost are one sentence"
    assert purse.startswith("turn 3: ") and f"{cash['subject_label']}'s cash +20 USD, with Steven Knott" in purse, purse
    assert "(why: taken from his coat)" in purse
    assert declared == f'{cash["subject_label"]} (investigator) declared: "{SNATCH}"'
    assert not any(PUNCH in line for line in happened), "the declaration is this turn's, not last turn's"


def test_the_state_reads_the_fight_the_ledger_and_the_room(knott):
    _, cash = knott_hit_then_robbed(knott)
    packet = situation(knott)
    combat = read_json(campaign_dir(knott.workspace) / "save" / "combat.json")
    fighter = next(p for p in combat["participants"] if p["actor_id"] == KNOTT)
    state = packet["state"]
    assert (state["hp"], state["hp_max"]) == (fighter["hp_current"], fighter["hp_max"]) and state["hp"] < state["hp_max"]
    assert state["stance"] == "hostile", "a person fought this turn stands hostile (§17.3)"
    assert state["in_session"] is True
    assert knott.table("look", focus="session")["session"]["turn_of"] == KNOTT and state["my_turn"] is True
    at_hand = packet["at_hand"]
    assert at_hand["present"] == [cash["subject_label"]], "the investigator is here; Knott is not listed with himself; Corbitt is elsewhere"
    assert at_hand["exits"], "the office's ways out, by the table's labels"
    assert packet["truncated"] == []
    assert packet_bytes(packet) <= 6144


def test_an_intention_under_way_is_in_done_and_not_in_happened(knott):
    open_turn(knott, "I tell Knott I will not take the job.")
    line = "Call the porter up from the lobby and have the visitor shown out."
    settled = "Offer the visitor a bonus to reconsider the job."
    knott.table("apply", call_id="t1-c1", effects=[{"kind": "npc", "name": "Steven Knott", "intends": settled, "outcome": "failed"}])
    knott.table("apply", call_id="t1-c2", effects=[{"kind": "npc", "name": "Steven Knott", "intends": line, "outcome": "attempted"}])
    ref = next(r for r in receipts(knott) if r["kind"] == "npc" and r["intent"]["text"] == line)["intent"]["ref"]
    # Still the open turn: the committed ledger has not folded either row yet; the read folds the open turn onto a copy.
    ledger = campaign_dir(knott.workspace) / "npc-ledger.json"
    assert not ledger.exists() or not read_json(ledger).get("npc-steven-knott", {}).get("intents")
    packet = situation(knott)
    first, second = packet["done"]
    # intentsView's own row shape (the card's, §142.3).
    assert first == {"ref": ref, "intent": line, "status": "attempted", "since_turn": 1, "turn": 1}, "under way first"
    assert second["intent"] == settled and second["status"] == "failed"
    [declared] = packet["happened"]
    assert declared.endswith('(investigator) declared: "I tell Knott I will not take the job."'), \
        "an intention-only receipt is in done, not in happened"


def test_an_intention_given_up_is_said_in_happened_the_next_turn(knott):
    """§143.14: a receipt that settles one of theirs `abandoned` is a sentence -- the table's repeat given up (why:
    repeated, §143.5) or the Keeper's overrule -- so the next act is generated knowing the thread was put down."""
    open_turn(knott, "I tell Knott I will not take the job.")
    line = "Lift the telephone receiver and threaten to ring the police."
    knott.table("apply", call_id="t1-c1", effects=[{"kind": "npc", "name": "Steven Knott", "intends": line, "outcome": "attempted", "_generated": True}])
    ref = next(r for r in receipts(knott) if r["kind"] == "npc" and r["intent"]["text"] == line)["intent"]["ref"]
    knott.table("apply", call_id="t1-c2", effects=[{"kind": "npc", "name": "Steven Knott", "intent_ref": ref, "outcome": "abandoned", "why": "repeated",
                                                    "_generated": True}])
    narrate(knott, "t1-c3", "Knott sets the receiver down.")
    knott.table("player_input", text="I wait.")
    packet = situation(knott)
    gave_up, declared = packet["happened"]
    assert gave_up == f'turn 1: Steven Knott gave up "{line}" without doing it (why: repeated)', gave_up
    assert declared.endswith('declared: "I wait."')
    assert [(row["ref"], row["status"]) for row in packet["done"]] == [(ref, "abandoned")]


def test_thirty_settled_intentions_fit_the_budget_and_the_newest_survives(knott):
    open_turn(knott, "I keep Knott talking all afternoon.")
    lines = [f"Intention {n:02d}: steer the visitor back to the job, remind him of the deadline, the wages, the keys on the desk, "
             f"the address in Roxbury and the newspaper men who will not stop asking about the house -- variant {n:02d}."
             for n in range(1, 31)]
    for n, line in enumerate(lines, start=1):
        knott.table("apply", call_id=f"t1-c{n}", effects=[{"kind": "npc", "name": "Steven Knott", "intends": line, "outcome": "done"}])
    packet = situation(knott)
    assert packet_bytes(packet) <= 6144, packet_bytes(packet)
    assert packet["truncated"] == ["at_hand", "history"], "binding constraints survive before optional surroundings and old intentions"
    assert packet["canonical_context"]["player_declaration"] == "I keep Knott talking all afternoon."
    assert packet["at_hand"] == {"holdings": [], "objects": [], "exits": [], "present": []}
    assert 1 <= len(packet["done"]) < 30
    assert packet["done"][0]["intent"] == lines[-1], "the newest row is the one kept"
    assert [row["intent"] for row in packet["done"]] == lines[::-1][:len(packet["done"])], "the oldest rows go first"


def test_the_budget_is_the_named_default_in_host_budgets(tmp_path):
    content = tmp_path / "content"
    shutil.copytree(CONTENT_DIR, content)
    path = content / "rulesets" / "coc7" / "host-budgets.json"
    budgets = json.loads(path.read_text(encoding="utf-8"))
    assert budgets["npc_situation"] == {"max_bytes": 6144}
    budgets["npc_situation"]["max_bytes"] = 1024
    path.write_text(json.dumps(budgets), encoding="utf-8")
    client = RpcClient(tmp_path / "ws", env={"COC_KERNEL_SEED": "1"}, content=content)
    try:
        open_turn(client, "I look Knott over.")
        packet = situation(client)
        assert packet_bytes(packet) <= 1024, packet_bytes(packet)
        assert packet["truncated"] == ["at_hand", "constraints"], "constraints are cut last, with an explicit unavailable marker for the actor"
        assert not packet["at_hand"]["exits"] and not packet["at_hand"]["present"]
        assert packet["happened"][-1].endswith('declared: "I look Knott over."'), "the declaration is never cut"
    finally:
        client.close()


def test_holdings_are_the_weapons_combat_reads_and_what_he_owns(tmp_path):
    client = RpcClient(tmp_path / "ws", env={"COC_KERNEL_SEED": "7"})
    try:
        open_turn(client, "I creep into the cellar.")
        walk_to_confrontation(client)
        give_corbitt_a_weapon(client)
        packet = situation(client, "Walter Corbitt")
        holdings = packet["at_hand"]["holdings"]
        assert "Clawed fingernails (kick, punch, claw)" in holdings and "floating-knife" in holdings, "the printed profile's weapons"
        assert "heavy chair" in holdings and holdings.count("heavy chair") == 1, "an owned object, once"
        state = packet["state"]
        assert (state["hp"], state["hp_max"]) == (16, 16), "outside a fight: the printed profile's HP"
        assert state["in_session"] is False and state["my_turn"] is False
        assert packet["at_hand"]["present"], "the investigator is in the cellar with him"
    finally:
        client.close()


def test_a_name_is_required_and_must_be_someone(kernel):
    open_turn(kernel)
    assert kernel.err("npc.situation", {"campaign": "c1"})["code"] == "invalid_params"
    assert kernel.err("npc.situation", {"campaign": "c1", "name": "Nobody At All"})["code"] == "unknown_entity"


def test_constraints_are_the_capsules_rows_that_name_him(knott):
    open_turn(knott, "I look Knott over.")
    constraints = situation(knott)["constraints"]
    capsule = knott.table("capsule")
    scene_rows = [row for row in capsule["obligations"] if row.get("kind") == "scene" and row.get("who") == "Steven Knott"]
    contacts = [row for row in capsule["mods"]["pending_contacts"] if row["target"] == "Steven Knott"]
    assert scene_rows and contacts, "the office: the book's commission obligation and the active Mod's first-impression check"
    assert constraints == [f"scene obligation {row['name']} ({row['state']}): {row['cue']}" for row in scene_rows] + \
        [f"Mod check {row['decision']} between {row['actor']} and Steven Knott is still to come: {row['when']}" for row in contacts]


# ---------------------------------------------------------------------------------------------------
# §143.21 (ticket 22, live table B turn 1): the player's words reach only the person they were said to. The player told
# Crane "I'll take the job, give me the keys and the money, I'm off to the Globe"; the clerk moved the party to the
# Globe in the same turn, and the editor there got that line as the last thing that happened to him -- so he handed
# over keys and money. The host now says, per person, whether the declaration was said to them (`addressed`) and
# whether it was put before a move brought the investigator to them (`declared_before_move`).
# ---------------------------------------------------------------------------------------------------

ASK_THE_EDITOR = "I take the job. Give me the keys and the money; I'm off to the Globe to read the old papers."
ARTY = "Arty Wilmot"
MORGUE = "newspaper-morgue"


def moved_to_the_morgue(client):
    """One turn: the player speaks at the office, then the clerk's move takes the party to the morgue, where Arty stands."""
    open_turn(client, ASK_THE_EDITOR)
    client.table("apply", call_id="t1-c1", effects=[{"kind": "move", "to": MORGUE}])
    assert any(person.get("name") == ARTY for person in client.table("capsule")["present"]), "the city editor stands in the morgue"


def test_said_before_a_move_the_line_is_not_theirs_and_the_arrival_stands_in_for_it(knott):
    moved_to_the_morgue(knott)
    before = situation(knott, ARTY)["happened"]
    assert before[-1].endswith(f'declared: "{ASK_THE_EDITOR}"'), "without the host's reading, §143.1 as it was"
    who = before[-1].split(" (investigator) declared: ")[0]
    packet = knott.ok("npc.situation", {"campaign": "c1", "name": ARTY, "declared_before_move": True})
    happened = packet["happened"]
    assert not any(ASK_THE_EDITOR in line for line in happened), happened
    assert happened[-1] == f"{who} (investigator) has just arrived where {ARTY} is", happened
    # The move outranks the addressee: a line said at the office before the move was not said here.
    both = knott.ok("npc.situation", {"campaign": "c1", "name": ARTY, "declared_before_move": True, "addressed": True})["happened"]
    assert not any(ASK_THE_EDITOR in line for line in both) and both[-1] == happened[-1]


def test_the_person_it_was_said_to_has_it_and_no_one_else_does(knott):
    open_turn(knott, "I tell Knott I will not take the job.")
    addressed = knott.ok("npc.situation", {"campaign": "c1", "name": "Steven Knott", "addressed": True, "declared_before_move": False})["happened"]
    assert addressed[-1].endswith('declared: "I tell Knott I will not take the job."'), addressed
    other = knott.ok("npc.situation", {"campaign": "c1", "name": "Steven Knott", "addressed": False})["happened"]
    assert not any("I will not take the job" in line for line in other), "said to someone else: nothing stands in for it"
    assert not any("has just arrived" in line for line in other)


def test_the_readings_are_booleans_or_absent(knott):
    open_turn(knott, "I look Knott over.")
    for field in ("addressed", "declared_before_move"):
        error = knott.err("npc.situation", {"campaign": "c1", "name": "Steven Knott", field: "yes"})
        assert error["code"] == "invalid_params" and error["details"]["field"] == field, error


# ---------------------------------------------------------------------------------------------------
# §143.23 (ticket 24, live table B2 turn 10): words that named no one. Arthur and Ruth were both in the conversation, the
# compile could not say who "you" was, both packets closed on the player's line as if it were said to each of them, and
# Ruth answered words said to Arthur. The host now says when the compile named no one present (`named_no_one`); the
# line then reaches the person as said to no one by name, and the generator judges whether it was theirs.
# ---------------------------------------------------------------------------------------------------

GIVE_IT_BACK = "Then give me back my five dollars first."


def test_words_that_named_no_one_are_said_to_no_one_by_name(knott):
    open_turn(knott, GIVE_IT_BACK)
    plain = knott.ok("npc.situation", {"campaign": "c1", "name": "Steven Knott", "addressed": True, "named_no_one": False})["happened"]
    who = plain[-1].split(" (investigator) declared: ")[0]
    assert plain[-1] == f'{who} (investigator) declared: "{GIVE_IT_BACK}"', "named him: the words as they were"
    unnamed = knott.ok("npc.situation", {"campaign": "c1", "name": "Steven Knott", "addressed": True, "named_no_one": True})["happened"]
    assert unnamed[-1] == f'{who} (investigator) declared (to no one by name): "{GIVE_IT_BACK}"', unnamed
    assert sum(GIVE_IT_BACK in line for line in unnamed) == 1, "the words once, as the closing sentence"
    # A named other is evidence; a missing name is not: `addressed: false` still leaves nothing in the words' place.
    other = knott.ok("npc.situation", {"campaign": "c1", "name": "Steven Knott", "addressed": False, "named_no_one": True})["happened"]
    assert not any(GIVE_IT_BACK in line for line in other), other
    # The arrival still outranks every reading of the words.
    moved = knott.ok("npc.situation", {"campaign": "c1", "name": "Steven Knott", "declared_before_move": True, "named_no_one": True})["happened"]
    assert moved[-1] == f"{who} (investigator) has just arrived where Steven Knott is", moved


def test_named_no_one_is_a_boolean_or_absent(knott):
    open_turn(knott, "I look Knott over.")
    error = knott.err("npc.situation", {"campaign": "c1", "name": "Steven Knott", "named_no_one": "yes"})
    assert error["code"] == "invalid_params" and error["details"]["field"] == "named_no_one", error
