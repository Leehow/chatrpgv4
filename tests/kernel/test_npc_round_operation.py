"""Contract §142.2, §142.5-138.6 (docs/specs/npc-as-actor.md ticket 02), over the emitted kernel.

An NPC's own turn of a fight is an operation with a receipt, whatever they spend it on. Before this, nothing but an
attack, a manoeuvre, aim, reload or flight could pass an NPC's turn, so a person who did anything else left the fight
stuck on them -- the Keeper's only way on was another blow, which is how Knott came to trade punches for eight turns
while "calling for help" only in speech (campaign game-26d5a671). And any roll the Keeper asked of an NPC in the fight
was silently settled as an attack.

Corbitt's fight (the starter prints his numbers): the investigator swings, Corbitt dodges, and it is his turn in
round 1. He is last in the DEX order, so a turn he spends ends the round.
"""

import pytest

from conftest import campaign_dir, narrate, read_json
from test_npc_standing_action import CORBITT, INVESTIGATOR, client_with, corbitts_turn
from test_rules_families import resolve, resolve_err

HURL = "Hurl the brass lamp at the investigator's lantern to plunge the cellar into darkness."


def ledger_intents(client):
    ledger = read_json(campaign_dir(client.workspace) / "npc-ledger.json")
    return next(entry for key, entry in ledger.items() if "corbitt" in key).get("intents", [])


def receipts_of(client, applied):
    return [r for r in client.table("status")["receipts"] if r["id"] in applied["receipts"]]


@pytest.fixture
def fight(tmp_path):
    client = client_with(tmp_path, {"disposition": "fights_to_the_end"})
    yield client
    client.close()


def test_an_npc_spends_their_own_turn_on_something_else_and_the_fight_moves_on(fight):
    n = corbitts_turn(fight)
    applied = fight.table("apply", call_id=f"t1-c{n}", effects=[{"kind": "npc", "name": "Walter Corbitt", "intends": HURL,
                                                                 "outcome": "attempted", "spend_turn": True, "why": "the light hurts him"}])
    [receipt] = receipts_of(fight, applied)
    assert receipt["intent"]["text"] == HURL and receipt["intent"]["outcome"] == "attempted" and receipt["intent"]["npc"] == CORBITT
    assert receipt["passes_turn"] == {"combat_id": "corbitt-final-combat-t1", "round": 1, "turn_of": INVESTIGATOR}
    session = fight.table("look", focus="session")["session"]
    assert session["turn_of"] == INVESTIGATOR and session["round"] == 2, "his turn is spent; the next round opens on the investigator"
    # The investigator can act: the fight no longer waits on Corbitt.
    attacked = resolve(fight, f"t1-c{n + 1}", intent="combat", goal="hit him", method="fists", target="Walter Corbitt", weapon="unarmed")
    assert attacked["decision"].endswith("combat:attack")
    narrate(fight, f"t1-c{n + 2}", "The lamp shatters against the wall.")
    [row] = ledger_intents(fight)
    assert row["text"] == HURL and row["status"] == "attempted"


def test_spend_turn_is_refused_off_their_turn_and_outside_a_fight(fight):
    n = corbitts_turn(fight)
    fight.table("apply", call_id=f"t1-c{n}", effects=[{"kind": "npc", "name": "Walter Corbitt", "action": "hold", "why": "he freezes"}])
    refused = fight.table_err("apply", call_id=f"t1-c{n + 1}", effects=[{"kind": "npc", "name": "Walter Corbitt", "intends": HURL,
                                                                          "outcome": "attempted", "spend_turn": True}])
    assert refused["code"] == "turn_state" and refused["details"]["turn_of"] == INVESTIGATOR
    # Refused before anything lands: a batch that also moves the clock moves nothing.
    clock = read_json(campaign_dir(fight.workspace) / "world.json")["clock"]
    batch = fight.table_err("apply", call_id=f"t1-c{n + 1}", effects=[{"kind": "time", "minutes": 5, "why": "a pause"},
                                                                      {"kind": "npc", "name": "Walter Corbitt", "intends": HURL, "outcome": "attempted", "spend_turn": True}])
    assert batch["code"] == "turn_state"
    assert read_json(campaign_dir(fight.workspace) / "world.json")["clock"] == clock, "the refused batch wrote nothing"
    fight.table("resolve", call_id=f"t1-c{n + 2}", action={"intent": "combat", "decision": "combat:end", "outcome": "stalemate",
                                                            "goal": "run", "method": "run"})
    outside = fight.table_err("apply", call_id=f"t1-c{n + 3}", effects=[{"kind": "npc", "name": "Walter Corbitt", "intends": HURL,
                                                                         "outcome": "attempted", "spend_turn": True}])
    assert outside["code"] == "invalid_params" and outside["details"]["field"] == "npc.spend_turn"


def test_the_stuck_turn_refusal_names_the_lawful_ways_on(fight):
    n = corbitts_turn(fight)
    refused = resolve_err(fight, f"t1-c{n}", intent="combat", goal="hit him", method="fists", target="Walter Corbitt", weapon="unarmed")
    assert refused["code"] == "turn_state" and refused["details"]["turn_of"] == CORBITT
    assert "spend_turn" in refused["fix"], "a person who spends the turn on something else is a way on"


def test_an_npcs_roll_in_a_fight_is_their_own_check_not_an_attack(fight):
    n = corbitts_turn(fight)
    rolled = resolve(fight, f"t1-c{n}", actor="Walter Corbitt", intent="investigate", skill="Spot Hidden",
                     goal="find the lantern's flame", method="scan the dark")
    assert rolled["decision"] == "core-check:ordinary-check", "before §142.6 this settled as decision:coc7:combat:attack"
    roll = next(r for r in fight.table("status")["receipts"] if r["kind"] == "roll" and r.get("call_id") == f"t1-c{n}")
    assert roll["actor_is_investigator"] is False
    assert fight.table("look", focus="session")["session"]["turn_of"] == CORBITT, "a roll alone does not spend the turn"


def test_a_roll_and_an_effect_report_an_intentions_result(fight):
    n = corbitts_turn(fight)
    applied = fight.table("apply", call_id=f"t1-c{n}", effects=[{"kind": "npc", "name": "Walter Corbitt", "intends": HURL, "outcome": "attempted"}])
    ref = receipts_of(fight, applied)[0]["intent"]["ref"]
    rolled = resolve(fight, f"t1-c{n + 1}", actor="Walter Corbitt", intent="investigate", skill="Throw",
                     goal="hit the lantern", method="throw the lamp", intent_ref=ref)
    roll = next(r for r in fight.table("status")["receipts"] if r["kind"] == "roll" and r.get("call_id") == f"t1-c{n + 1}")
    expected = "done" if roll["passed"] else "failed"
    assert roll["intent"] == {"ref": ref, "npc": CORBITT, "text": HURL, "outcome": expected}
    assert rolled["decision"] == "core-check:ordinary-check"
    # Settled now: the same intention is refused before a die is thrown.
    before = len(fight.table("status")["receipts"])
    again = resolve_err(fight, f"t1-c{n + 2}", actor="Walter Corbitt", intent="investigate", skill="Throw",
                        goal="hit the lantern", method="throw again", intent_ref=ref)
    assert again["details"]["reason"] == "intent_settled"
    assert len(fight.table("status")["receipts"]) == before, "nothing was rolled"


def test_any_effect_can_be_the_result_of_someone_elses_intention(fight):
    n = corbitts_turn(fight)
    applied = fight.table("apply", call_id=f"t1-c{n}", effects=[{"kind": "npc", "name": "Walter Corbitt", "intends": HURL, "outcome": "attempted"}])
    ref = receipts_of(fight, applied)[0]["intent"]["ref"]
    ticked = fight.table("apply", call_id=f"t1-c{n + 1}", effects=[{"kind": "threat", "name": "corbitt-haunting", "clock": "corbitt-awareness", "intent_ref": ref, "why": "the dark feeds him"}])
    [receipt] = receipts_of(fight, ticked)
    assert receipt["kind"] == "threat" and receipt["intent"] == {"ref": ref, "npc": CORBITT, "text": HURL, "outcome": "done"}
    refused = fight.table_err("apply", call_id=f"t1-c{n + 2}", effects=[{"kind": "threat", "name": "corbitt-haunting", "clock": "corbitt-awareness", "intent_ref": ref}])
    assert refused["details"]["reason"] == "intent_settled"
    bad = fight.table_err("apply", call_id=f"t1-c{n + 3}", effects=[{"kind": "threat", "name": "corbitt-haunting", "clock": "corbitt-awareness", "intent_ref": ref, "intent_outcome": "maybe"}])
    assert bad["details"]["field"].endswith("intent_outcome")


def test_an_npc_who_flees_flees_and_the_pursuit_is_the_investigators_choice(fight):
    """§142.10: the view issues flee on an NPC's turn, and a Keeper's `intent: flee` for him settles as a flight --
    before this it settled as `decision:coc7:combat:attack`, a punch instead of a run."""
    n = corbitts_turn(fight)
    actions = fight.table("look", focus="session")["session"]["actions"]
    assert {"decision": "combat:flee", "actor": CORBITT} in actions
    fled = resolve(fight, f"t1-c{n}", actor="Walter Corbitt", intent="flee", goal="get away", method="run for the stairs")
    assert fled["decision"].endswith("combat:flee")
    # §143.12 (2026-09-26): a chase admits him as its quarry, so the hint names the investigators still able to run
    # after him and the call the pursuer opens it with (§143.9 had withdrawn it while the chase knew only the
    # investigator as quarry); otherwise where he went is an `apply npc to`. The call itself: test_chase_npc_quarry.py.
    named = [hint for hint in fled["hints"] if CORBITT in hint]
    assert len(named) == 1, fled["hints"]
    hint = named[0]
    assert "apply npc to: away" in hint and "quarry" in hint, hint
    assert f"if {INVESTIGATOR} gives chase" in hint and "resolve chase:start" in hint and "actor: <that investigator>" in hint, hint
    assert f"target {CORBITT}" in hint, hint
    assert fight.table("look", focus="session")["session"] is None, "he was the only one fighting them: the fight is over"
    assert not [c for c in fled.get("continuations", []) if "chase" in str(c.get("decision", "")) and c.get("executed")], \
        "a pursuit is the investigators' choice, never started for them"


def test_every_refusal_of_a_ref_says_where_refs_are_and_lists_the_options(fight):
    """§143.7 (docs/specs/npc-acts-first.md ticket 06). Live gate A, T12: the Keeper wrote
    `intent_ref: "@intent-placeholder"` for an intention it had started in the same batch. Every refusal of a ref now
    says where refs come from and carries the options -- the person's intentions under way, or for a ref that names
    nobody, the table's with whose each is."""
    where = "refs are on the capsule at present[].history.intents[].ref, or in details.options here"
    n = corbitts_turn(fight)
    applied = fight.table("apply", call_id=f"t1-c{n}", effects=[{"kind": "npc", "name": "Walter Corbitt", "intends": HURL, "outcome": "attempted"}])
    ref = receipts_of(fight, applied)[0]["intent"]["ref"]
    under_way = [{"ref": ref, "intent": HURL, "status": "attempted"}]
    for bad, reason in [("@intent-placeholder", None), ("intent:walter-corbitt:0123456789ab", "unknown_intent")]:
        refused = fight.table_err("apply", call_id=f"t1-c{n + 1}", effects=[{"kind": "npc", "name": "Walter Corbitt", "intent_ref": bad, "intent_outcome": "done"}])
        assert refused["code"] == "invalid_params" and where in refused["fix"], refused
        assert refused["details"].get("reason") == reason and refused["details"]["options"] == under_way
    # A ref that names nobody, on an effect and on a roll: the table's intentions under way, with whose each is.
    nobody = fight.table_err("apply", call_id=f"t1-c{n + 1}", effects=[{"kind": "threat", "name": "corbitt-haunting", "clock": "corbitt-awareness", "intent_ref": "@intent-placeholder"}])
    assert where in nobody["fix"] and nobody["details"]["options"] == [{**under_way[0], "npc": CORBITT}]
    rolled = resolve_err(fight, f"t1-c{n + 1}", actor="Walter Corbitt", intent="investigate", skill="Throw", goal="hit the lantern",
                         method="throw the lamp", intent_ref="@intent-placeholder")
    assert where in rolled["fix"] and rolled["details"]["options"] == [{**under_way[0], "npc": CORBITT}]
    # Under way since turn 1 and announced again on turn 2: the fix names the ref to report and the options.
    narrate(fight, f"t1-c{n + 1}", "The lamp is in his hand.")
    fight.table("player_input", text="I keep swinging.")
    unresolved = fight.table_err("apply", call_id="t2-c1", effects=[{"kind": "npc", "name": "Walter Corbitt", "intent_ref": ref, "outcome": "attempted"}])
    assert unresolved["details"]["reason"] == "intent_unresolved" and where in unresolved["fix"] and "details.ref" in unresolved["fix"]
    assert unresolved["details"]["options"] == under_way
    # Settled: its result stands, and the refusal still says where refs are (nothing else is under way).
    fight.table("apply", call_id="t2-c1", effects=[{"kind": "npc", "name": "Walter Corbitt", "intent_ref": ref, "outcome": "failed"}])
    settled = fight.table_err("apply", call_id="t2-c2", effects=[{"kind": "npc", "name": "Walter Corbitt", "intent_ref": ref, "outcome": "abandoned"}])
    assert settled["details"]["reason"] == "intent_settled" and settled["fix"].startswith("its result stands") and where in settled["fix"]
    assert settled["details"]["options"] == []
