"""Contract §139.1 (docs/specs/npc-acts-first.md D1, ticket 01), over the emitted kernel.

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
    assert packet["npc"] == {"handle": KNOTT, "name": "Steven Knott"}
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
    # intentsView's own row shape (the card's, §138.3).
    assert first == {"ref": ref, "intent": line, "status": "attempted", "since_turn": 1, "turn": 1}, "under way first"
    assert second["intent"] == settled and second["status"] == "failed"
    [declared] = packet["happened"]
    assert declared.endswith('(investigator) declared: "I tell Knott I will not take the job."'), \
        "an intention-only receipt is in done, not in happened"


def test_an_intention_given_up_is_said_in_happened_the_next_turn(knott):
    """§139.14: a receipt that settles one of theirs `abandoned` is a sentence -- the table's repeat given up (why:
    repeated, §139.5) or the Keeper's overrule -- so the next act is generated knowing the thread was put down."""
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
    assert packet["truncated"] == ["constraints", "at_hand", "history"], "the ticket's order: constraints, what is at hand, the oldest done"
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
        assert packet["truncated"] == ["constraints"], "the first section cut, and the only one this packet needed"
        assert packet["at_hand"]["exits"] and packet["at_hand"]["present"]
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
