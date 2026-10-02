"""Contract §143.24 (ticket 25 of docs/specs/npc-acts-first-tickets/, spec section 九's table B2), over the emitted kernel.

The lines the Keeper gives a person in a delivery are held to the same "not the same thing twice" as the table's own
act (§143.5, §143.14). The kernel's part: `npc.threads {campaign, text}` lists who speaks in a delivery by the Keeper's
own say tokens -- someone the table acted for this turn, or who is in the conversation (§143.20) -- with their rows
never carried out (under way since an earlier turn, or given up); and `table.narrate` records a `purpose_repeated`
finding when the host's `purpose_repeats` names one of those rows for that speaker. Whether a line is the same purpose
is Jev's question on the host side; here the host's reading is given directly.

§166 (owner ruling 2026-10-01) supersedes §143.24's refusal: the first draft is delivered, never refused for a repeated
purpose, so there is no `purpose_gate`; the detection is the finding on the turn record and the `lane: "delivery"`
telemetry row with `outcome: "delivered"`.

Knott is the person (the starter prints no numbers for him: the table pins an archetype first, §34.10).
"""

import pytest

from conftest import RpcClient, campaign_dir, narrate, open_turn, read_json, read_jsonl
from test_rules_families import resolve

KNOTT = "Steven Knott"
HANDLE = "steven-knott"
PAPERS = "诺特把文件推回来：「先带介绍信来，我照章程办。」"
SILENT = "诺特把钥匙揣进口袋，走到门边，按着门把手瞪着海斯。"
AGAIN = f"诺特没有让开。{{{{say:{KNOTT}}}}}「昨天的话不变：带介绍信来，带人来，随你挑。」{{{{/say}}}}"


@pytest.fixture
def knott(tmp_path):
    client = RpcClient(tmp_path / "ws", env={"COC_KERNEL_SEED": "1"})
    open_turn(client, "我请诺特把旧档案借我。")
    client.table("apply", call_id="t1-c1", effects=[{"kind": "npc", "name": KNOTT, "archetype": "ordinary_adult", "why": "an office man"}])
    yield client
    client.close()


def receipts(client):
    return client.table("status")["receipts"]


def ref_of(client, line):
    return next(r for r in receipts(client) if r.get("intent", {}).get("text") == line)["intent"]["ref"]


def table_act(client, call_id, line):
    """The clerk's opener of a generated act bound `intention_only` (§143.3 write 1, the host's mark set)."""
    client.table("apply", call_id=call_id, effects=[{"kind": "npc", "name": KNOTT, "intends": line, "outcome": "attempted", "_generated": True}])
    return ref_of(client, line)


def threads(client, text):
    return client.ok("npc.threads", {"campaign": "c1", "text": text})


def papers_then_silence(client):
    """Turn 1: the table's act of Knott asks for papers (under way); turn 2: his act is a silent one (the B2 T9 shape)."""
    papers = table_act(client, "t1-c2", PAPERS)
    narrate(client, "t1-c3", f"诺特把文件推回来。{{{{say:{KNOTT}}}}}「先带介绍信来，我照章程办。」{{{{/say}}}}")
    client.table("player_input", text="我拿侦探执照押在这儿，行不行？")
    silent = table_act(client, "t2-c1", SILENT)
    return papers, silent


def turn_json(client):
    return read_json(campaign_dir(client.workspace, "c1") / "turn.json")


def record(client, turn):
    return read_json(campaign_dir(client.workspace, "c1") / "turns" / f"{turn:04d}.json")


def delivery_rows(client):
    return [row for row in read_jsonl(campaign_dir(client.workspace, "c1") / "telemetry.jsonl")
            if row.get("lane") == "delivery" and row.get("reason") == "purpose_repeated"]


def test_the_keepers_line_against_a_row_under_way_since_an_earlier_turn_is_listed_and_this_turns_act_is_not(knott):
    papers, silent = papers_then_silence(knott)
    found = threads(knott, AGAIN)
    assert found["turn"] == 2
    [person] = found["people"]
    assert (person["npc"], person["name"], person["trigger"]) == (HANDLE, KNOTT, "act"), person
    assert person["lines"] == ["「昨天的话不变：带介绍信来，带人来，随你挑。」"]
    assert [row["ref"] for row in person["threads"]] == [papers], "the row set out on turn 1; this turn's silent act is what the prose renders"
    assert person["threads"][0]["status"] == "attempted" and person["threads"][0]["since_turn"] == 1
    assert silent not in [row["ref"] for row in person["threads"]]
    # No line of theirs, no one: prose with no say token names nobody.
    assert threads(knott, "诺特没有说话。")["people"] == []
    error = knott.err("npc.threads", {"campaign": "c1"})
    assert error["code"] == "invalid_params" and error["details"]["field"] == "text"


def test_a_delivery_naming_the_row_goes_out_first_time_with_a_finding(knott):
    """§166: the delivery the host's reading names is not refused; it goes out with the finding. The refusal, the
    `purpose_gate` and the delivery after it are gone; what the refusal named is on the finding."""
    papers, _ = papers_then_silence(knott)
    named = [{"npc": HANDLE, "ref": papers}]
    delivered = knott.table("narrate", call_id="t2-c2", text=AGAIN, purpose_repeats=named)
    assert delivered["turn"] == 2
    warnings = record(knott, 2).get("warnings", [])
    finding = [row for row in warnings if row["kind"] == "purpose_repeated"]
    assert [(row["lane"], row["ref"]) for row in finding] == [("speech", papers)], finding
    assert finding[0]["quote"] == "「昨天的话不变：带介绍信来，带人来，随你挑。」"
    assert finding[0]["why"].startswith(f'{KNOTT} already set out on turn 1 to "{PAPERS}" and it has no result'), finding[0]["why"]
    assert "do not have them say" in finding[0]["fix"], finding[0]["fix"]
    # The row under way is owed a result too (§142.7): with no refusals the two checks no longer race, and each
    # leaves its own finding on the same row.
    assert [row["ref"] for row in warnings if row["kind"] == "intent_result_owed"] == [papers]
    assert [(row["ok"], row["outcome"], row["call_id"]) for row in delivery_rows(knott)] == [(True, "delivered", "t2-c2")]
    assert "purpose_gate" not in turn_json(knott)


def test_a_row_given_up_turns_ago_is_a_thread_and_a_row_settled_by_the_dice_is_not(knott):
    papers = table_act(knott, "t1-c2", PAPERS)
    knott.table("apply", call_id="t1-c3", effects=[{"kind": "npc", "name": KNOTT, "intent_ref": papers, "intent_outcome": "abandoned", "why": "he lets it go"}])
    narrate(knott, "t1-c4", f"诺特摆摆手。{{{{say:{KNOTT}}}}}「算了。」{{{{/say}}}}")
    knott.table("player_input", text="我等着。")
    listen = table_act(knott, "t2-c1", "诺特侧耳听走廊里的动静。")
    resolve(knott, "t2-c2", actor=KNOTT, intent="investigate", skill="Listen", goal="listen", method="listen", intent_ref=listen, _generated=True)
    narrate(knott, "t2-c3", f"诺特听了听走廊。{{{{say:{KNOTT}}}}}「没人。」{{{{/say}}}}")
    knott.table("player_input", text="我还是等着。")
    table_act(knott, "t3-c1", SILENT)
    [person] = threads(knott, AGAIN)["people"]
    assert [(row["ref"], row["status"]) for row in person["threads"]] == [(papers, "abandoned")], \
        "given up two turns ago is still never carried out; the Listen the dice settled is not a thread"
    # The same reading passed to narrate names a row that is this speaker's thread: delivered (§166), with the finding
    # worded by the row's status.
    assert knott.table("narrate", call_id="t3-c2", text=AGAIN, purpose_repeats=[{"npc": HANDLE, "ref": papers}])["turn"] == 3
    [finding] = [row for row in record(knott, 3).get("warnings", []) if row["kind"] == "purpose_repeated"]
    assert finding["ref"] == papers and "gave it up on turn 1" in finding["why"], finding
    assert [(row["ok"], row["outcome"], row["call_id"]) for row in delivery_rows(knott)] == [(True, "delivered", "t3-c2")]


def test_a_row_set_out_this_turn_by_the_keeper_is_what_the_prose_renders_and_not_a_thread(knott):
    papers, silent = papers_then_silence(knott)
    own = "诺特打算打电话叫楼下的看门人上来。"
    knott.table("apply", call_id="t2-c2", effects=[{"kind": "npc", "name": KNOTT, "intends": own, "outcome": "attempted", "why": "he reaches for the phone"}])
    [person] = threads(knott, AGAIN)["people"]
    assert [row["ref"] for row in person["threads"]] == [papers], "the table's act and the Keeper's own of this turn are both this turn's"
    assert ref_of(knott, own) not in [row["ref"] for row in person["threads"]]


def test_a_person_neither_acted_for_nor_in_the_conversation_is_not_held_and_a_wrong_reading_refuses_nothing(knott):
    papers = table_act(knott, "t1-c2", PAPERS)
    knott.table("apply", call_id="t1-c3", effects=[{"kind": "npc", "name": KNOTT, "intent_ref": papers, "intent_outcome": "abandoned", "why": "he lets it go"}])
    narrate(knott, "t1-c4", "诺特低头看报纸。")
    knott.table("player_input", text="我翻看架子上的旧报。")
    narrate(knott, "t2-c1", "你翻了半天旧报。")
    knott.table("player_input", text="我回头问诺特。")
    # Turn 3: nothing of Knott's this turn or last -- he is not in the conversation, and the table did not act for him.
    assert threads(knott, AGAIN)["people"] == []
    # A reading that names a row not this speaker's, or a person who does not speak, is ignored: delivered first time.
    delivered = knott.table("narrate", call_id="t3-c1", text=AGAIN, purpose_repeats=[{"npc": HANDLE, "ref": papers}, {"npc": "arty-wilmot", "ref": papers}])
    assert delivered["turn"] == 3
    assert not [row for row in record(knott, 3).get("warnings", []) if row["kind"] == "purpose_repeated"]
    assert delivery_rows(knott) == []


def test_a_line_the_host_wrapped_is_never_held(knott):
    papers, _ = papers_then_silence(knott)
    knott.table("apply", call_id="t2-c2", effects=[{"kind": "npc", "name": KNOTT, "intent_ref": papers, "intent_outcome": "abandoned", "why": "he drops it"}])
    assert threads(knott, AGAIN)["people"][0]["threads"][0]["ref"] == papers, "given up, it is still his thread"
    # The only line of Knott's is one the host wrapped (§128.3): not the Keeper's, so never refused for its purpose.
    delivered = knott.table("narrate", call_id="t2-c3", text=AGAIN, host_attributed=[0], purpose_repeats=[{"npc": HANDLE, "ref": papers}])
    assert delivered["turn"] == 2
    assert delivery_rows(knott) == []
    assert not [row for row in record(knott, 2).get("warnings", []) if row["kind"] == "purpose_repeated"]
