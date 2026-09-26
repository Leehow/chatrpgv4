"""Contract §139.23 (docs/specs/npc-acts-first-tickets/24-who-the-words-were-said-to.md), over the emitted kernel.

Live table B2, turn 10: the player told Arthur "then give me back my five dollars" -- the money had been with him since
his lines the turn before -- and the compile could not say who "you" was (`unclear` 0.83), because its state held the
player's sentence, the scene and the names present, and nothing about who had just been talking with the investigator.
`table.status` now carries `last_exchange`: the newest committed turn's words and the lines its delivery's speech
markers attributed to a person (the record's `speech`), while the investigators still stand where that turn closed.
Structure only; no prose is read.
"""

import pytest

from conftest import RpcClient, create_campaign, narrate, narrate_opening, open_turn

MORGUE = "newspaper-morgue"
ASKED = "我问诺特那栋房子的事。"
KNOTT_SAID = "「那房子空了好些年。」"
EDNA_SAID = "「钥匙在我这儿。」"


@pytest.fixture
def client(tmp_path):
    rpc = RpcClient(tmp_path / "ws", env={"COC_KERNEL_SEED": "1"})
    yield rpc
    rpc.close()


def status(client):
    return client.table("status")


def label(client, name):
    """The table's name for a person present, as the capsule gives it (the compile's addressee rows read the same)."""
    person = next(value for value in client.table("capsule")["present"] if value["name"] == name)
    return (person.get("called") or {}).get("name") or person["name"]


def both_spoke(client):
    """Turn 1 at the office: Edna Hale walks in, and Knott and she each say a line the markers attribute to them."""
    open_turn(client, ASKED)
    client.table("apply", call_id="t1-c1", effects=[{"kind": "npc", "name": "Edna Hale", "to": "here", "why": "test fixture: the landlord's clerk"}])
    narrate(client, "t1-c2", f"诺特靠回椅背。{{{{say:Steven Knott}}}}{KNOTT_SAID}{{{{/say}}}}埃德娜抬起头。{{{{say:Edna Hale}}}}{EDNA_SAID}{{{{/say}}}}")


def test_the_last_turns_words_and_the_lines_its_markers_gave_each_person(client):
    both_spoke(client)
    client.table("player_input", text="那你先把钥匙给我。")
    exchange = status(client)["last_exchange"]
    assert exchange == {"turn": 1, "player_text": ASKED, "speech": [
        {"who": label(client, "Steven Knott"), "line": KNOTT_SAID},
        {"who": label(client, "Edna Hale"), "line": EDNA_SAID},
    ]}, exchange


def test_no_committed_turn_before_this_one_is_no_exchange(client):
    create_campaign(client)
    assert status(client)["turn"] == 0
    assert status(client)["last_exchange"] is None


def test_a_turn_with_neither_words_nor_attributed_lines_is_no_exchange(client):
    # The opening (turn 0) has no player words, and its narration here puts no line in anyone's mouth.
    open_turn(client)
    assert status(client)["last_exchange"] is None


def test_the_opening_is_an_exchange_when_someone_spoke_in_it(client):
    create_campaign(client)
    narrate_opening(client, f"开场。诺特抬头。{{{{say:Steven Knott}}}}{KNOTT_SAID}{{{{/say}}}}")
    client.table("player_input", text="你说什么？")
    assert status(client)["last_exchange"] == {"turn": 0, "player_text": None, "speech": [{"who": label(client, "Steven Knott"), "line": KNOTT_SAID}]}


def test_leaving_the_scene_ends_the_exchange(client):
    both_spoke(client)
    client.table("player_input", text="我去《环球报》报馆翻旧报纸。")
    assert status(client)["last_exchange"] is not None, "still at the office: the exchange stands"
    client.table("apply", call_id="t2-c1", effects=[{"kind": "move", "to": MORGUE}])
    assert status(client)["last_exchange"] is None, "the party moved: the office's exchange is not this room's"


def test_the_delivery_s_last_six_lines_each_bounded_and_an_unresolved_speaker_left_out(client):
    open_turn(client, ASKED)
    long_line = "「" + "很" * 300 + "」"
    lines = "".join(f"{{{{say:Steven Knott}}}}「第{n}句。」{{{{/say}}}}" for n in range(1, 8))
    narrate(client, "t1-c1", f"{{{{say:a passer-by nobody knows}}}}「借过。」{{{{/say}}}}{lines}{{{{say:Steven Knott}}}}{long_line}{{{{/say}}}}")
    client.table("player_input", text="你到底想说什么？")
    speech = status(client)["last_exchange"]["speech"]
    assert [value["line"] for value in speech[:-1]] == [f"「第{n}句。」" for n in range(3, 8)], speech
    last = speech[-1]["line"]
    assert len(last) == 200 and last.endswith("..."), last
    assert not any("借过" in value["line"] for value in speech), "a speaker the markers resolved to nobody is not in the exchange"
