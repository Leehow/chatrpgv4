"""Contract §143.14 (ticket 15 of docs/specs/npc-acts-first-tickets/, live table C3), over the emitted kernel.

What the table's own act of a person set out -- a ledger row the clerk opened with the host's `_generated` (§143.3,
§143.6) -- is settled only by the dice, a clock, an arrival or a departure, or given up. On live table C3 the Keeper
made "grab the telephone" `done` with a clue's `intent_ref` and a threat `done` with the intention variant, so the
situation packet told the generator every turn that the telephone was dealt with and the same threat came back four
times. Now `done` or `failed` on such a row by a write that is not the table's own and does not itself settle it is
`invalid_params` with the ticket's `fix`; `abandoned` stays open (spec D7); a Keeper-written row keeps §142.2's rules.

Knott is the person (the starter prints no numbers for him: the table pins an archetype first, §34.10).
"""

import pytest

from conftest import RpcClient, narrate, open_turn
from test_rules_families import resolve, resolve_err

KNOTT = "Steven Knott"
FIX = "a table act that rolled nothing is not done by saying so: abandon it (intent_outcome: abandoned), or let the dice settle it"
PHONE = "诺特一把抓起电话听筒，拇指压在叉簧上，盯着海斯。"


@pytest.fixture
def knott(tmp_path):
    client = RpcClient(tmp_path / "ws", env={"COC_KERNEL_SEED": "1"})
    open_turn(client, "I square up to Knott.")
    client.table("apply", call_id="t1-c1", effects=[{"kind": "npc", "name": KNOTT, "archetype": "ordinary_adult", "why": "an office man"}])
    yield client
    client.close()


def receipts(client):
    return client.table("status")["receipts"]


def ref_of(client, line):
    return next(r for r in receipts(client) if r["kind"] == "npc" and r.get("intent", {}).get("text") == line)["intent"]["ref"]


def table_act(client, call_id, line):
    """The clerk's opener of a generated act bound `intention_only` (§143.3 write 1, the host's mark set)."""
    client.table("apply", call_id=call_id, effects=[{"kind": "npc", "name": KNOTT, "intends": line, "outcome": "attempted", "_generated": True}])
    return ref_of(client, line)


def unsettled(error, ref, field):
    assert error["code"] == "invalid_params", error
    assert error["fix"] == FIX
    assert error["details"]["reason"] == "table_act_unsettled" and error["details"]["ref"] == ref and error["details"]["field"] == field, error["details"]
    return error


def status_of(client, ref):
    return next(row for row in client.ok("npc.situation", {"campaign": "c1", "name": KNOTT})["done"] if row["ref"] == ref)["status"]


def test_a_table_act_that_rolled_nothing_is_not_done_or_failed_by_saying_so_and_abandoned_is_allowed(knott):
    ref = table_act(knott, "t1-c2", PHONE)
    narrate(knott, "t1-c3", "诺特抓起了电话听筒。")
    knott.table("player_input", text="I tell him to put the phone down.")
    # The row now comes from the committed ledger (the fold carried the mark), not from this turn's receipts.
    unsettled(knott.table_err("apply", call_id="t2-c1", effects=[{"kind": "npc", "name": KNOTT, "intent_ref": ref, "intent_outcome": "done", "why": "he threatened"}]),
              ref, "npc.outcome")
    unsettled(knott.table_err("apply", call_id="t2-c2", effects=[{"kind": "npc", "name": KNOTT, "intent_ref": ref, "outcome": "failed"}]), ref, "npc.outcome")
    unsettled(knott.table_err("apply", call_id="t2-c3", effects=[{"kind": "npc", "name": KNOTT, "intends": PHONE, "outcome": "done"}]), ref, "npc.outcome")
    assert status_of(knott, ref) == "attempted", "nothing landed"
    knott.table("apply", call_id="t2-c4", effects=[{"kind": "npc", "name": KNOTT, "intent_ref": ref, "intent_outcome": "abandoned", "why": "he puts it down"}])
    assert status_of(knott, ref) == "abandoned", "the Keeper's overrule (D7) stands"


def test_a_clue_or_a_note_carrying_a_table_acts_ref_does_not_settle_it(knott):
    """Live table C3 T6: `clue:knott-commission-t6` made "grab the telephone" done."""
    ref = table_act(knott, "t1-c2", PHONE)
    error = unsettled(knott.table_err("apply", call_id="t1-c3", effects=[{"kind": "clue", "clue": "knott-research-leads", "intent_ref": ref}]),
                      ref, "effects[0].intent_outcome")
    assert error["details"]["outcome"] == "done", "an effect's intent_outcome defaults to done"
    unsettled(knott.table_err("apply", call_id="t1-c4", effects=[{"kind": "note", "name": "the telephone", "text": "Knott threatened to ring the police",
                                                                  "intent_ref": ref, "intent_outcome": "failed"}]), ref, "effects[0].intent_outcome")
    assert not any(r["kind"] in ("clue", "note") for r in receipts(knott)), "the refused batch wrote nothing"
    assert status_of(knott, ref) == "attempted"
    # The clue itself is still discoverable, without the ref; and a clue may still say the act is under way.
    knott.table("apply", call_id="t1-c5", effects=[{"kind": "clue", "clue": "knott-research-leads", "intent_ref": ref, "intent_outcome": "attempted"}])
    assert status_of(knott, ref) == "attempted"


def test_the_dice_settle_a_table_act_and_an_outcome_written_beside_them_is_refused_before_any_die(knott):
    ref = table_act(knott, "t1-c2", PHONE)
    before = len(receipts(knott))
    error = resolve_err(knott, "t1-c3", actor=KNOTT, intent="investigate", skill="Listen", goal="listen for the operator", method="listen", intent_ref=ref,
                        intent_outcome="done")
    assert error["code"] == "invalid_params" and error["details"]["reason"] == "table_act_unsettled" and error["details"]["field"] == "action.intent_outcome"
    assert "leave action.intent_outcome out" in error["fix"]
    assert len(receipts(knott)) == before, "refused before any die was thrown"
    resolve(knott, "t1-c4", actor=KNOTT, intent="investigate", skill="Listen", goal="listen for the operator", method="listen", intent_ref=ref)
    roll = next(r for r in receipts(knott) if r["kind"] == "roll" and r.get("call_id") == "t1-c4" and r.get("intent"))
    assert roll["intent"]["ref"] == ref and roll["intent"]["outcome"] == ("done" if roll["passed"] else "failed"), "the Keeper's roll settles it"
    # The clerk's own roll (the binding's check way, `_generated`) settles its row the same way.
    other = table_act(knott, "t1-c5", "诺特侧耳去听楼梯口有没有人。")
    resolve(knott, "t1-c6", actor=KNOTT, intent="investigate", skill="Listen", goal="listen", method="listen", intent_ref=other, _generated=True)
    rolled = next(r for r in receipts(knott) if r["kind"] == "roll" and r.get("call_id") == "t1-c6" and r.get("intent"))
    assert rolled["intent"]["generated"] is True and rolled["intent"]["outcome"] in ("done", "failed")


def test_a_clock_an_arrival_and_a_departure_settle_a_table_act(knott):
    clock = table_act(knott, "t1-c2", "诺特拿起听筒要摇巡警。")
    knott.table("apply", call_id="t1-c3", effects=[{"kind": "threat", "mint": True, "name": "the constable is sent for", "length": 4,
                                                    "on_full": "a constable knocks at the office door", "intent_ref": clock}])
    arrival = table_act(knott, "t1-c4", "诺特朝楼梯口大喊看门的上来。")
    knott.table("apply", call_id="t1-c5", effects=[{"kind": "npc", "name": "the porter", "to": "here", "walk_on": True, "intent_ref": arrival, "why": "he heard the shout"}])
    departure = table_act(knott, "t1-c6", "诺特抓起帽子往门口走。")
    knott.table("apply", call_id="t1-c7", effects=[{"kind": "npc", "name": KNOTT, "to": "away", "intent_ref": departure, "why": "he walks out"}])
    rows = {row["ref"]: row["status"] for row in knott.ok("npc.situation", {"campaign": "c1", "name": KNOTT})["done"]}
    assert (rows[clock], rows[arrival], rows[departure]) == ("done", "done", "done")


def test_the_tables_own_stance_write_settles_its_act_and_the_keepers_does_not(knott):
    """The binding's `stance` way (§143.3) is the table's own write; the same effect from the Keeper is saying so."""
    glare = table_act(knott, "t1-c2", "诺特冷下脸来，盯着海斯不说话。")
    unsettled(knott.table_err("apply", call_id="t1-c3", effects=[{"kind": "npc", "name": KNOTT, "stance": "hostile", "intent_ref": glare, "intent_outcome": "done"}]),
              glare, "effects[0].intent_outcome")
    knott.table("apply", call_id="t1-c4", effects=[{"kind": "npc", "name": KNOTT, "stance": "hostile", "intent_ref": glare, "intent_outcome": "done", "why": "the act",
                                                    "_generated": True}])
    assert status_of(knott, glare) == "done"


def test_a_keeper_written_row_keeps_its_rules(knott):
    line = "Knott threatens to ring the police."
    knott.table("apply", call_id="t1-c2", effects=[{"kind": "npc", "name": KNOTT, "intends": line, "outcome": "attempted"}])
    ref = ref_of(knott, line)
    knott.table("apply", call_id="t1-c3", effects=[{"kind": "npc", "name": KNOTT, "intent_ref": ref, "intent_outcome": "done", "why": "he said it"}])
    assert status_of(knott, ref) == "done", "the Keeper's own account of the Keeper's own row"
    other = "Knott tells the visitor about the house."
    knott.table("apply", call_id="t1-c4", effects=[{"kind": "npc", "name": KNOTT, "intends": other, "outcome": "attempted"}])
    knott.table("apply", call_id="t1-c5", effects=[{"kind": "clue", "clue": "knott-research-leads", "intent_ref": ref_of(knott, other)}])
    assert status_of(knott, ref_of(knott, other)) == "done", "a clue still settles a row the Keeper set out"
