"""Contract §87.7 over the emitted kernel: a table name is a name, and a newcomer is declared.

temper-c t4-c4 (`.coc/playtests/prose-npc-temper-20260926/home-c`, module voice-bench): the dock labourer
王铁柱 was present and untold, and the Keeper did what the capsule's `untold.use` says -- `apply person
{who: 王铁柱, name: 扛包的汉子}` and then `apply npc {name: 扛包的汉子, stance: wary}` in the same batch.
The npc effect minted a runtime person `npc-table-…` called 扛包的汉子, so turns 4-5 wrote his stance
and his lines onto a duplicate and the same man ended the session with two ledger rows and two voices.

Steven Knott is this fixture's 王铁柱: present in the opening and never named to the player.
"""

import json

from conftest import RpcClient, campaign_dir, open_turn, read_json

KNOTT = "Steven Knott"
EPITHET = "门口的房东"  # what the table has been calling him; the kernel compares nothing to it


def world(client):
    return read_json(campaign_dir(client.workspace) / "world.json")


def npc_receipts(client, applied):
    return [r for r in client.table("status")["receipts"] if r["id"] in applied["receipts"] and r["kind"] == "npc"]


def test_the_word_apply_person_gave_is_the_person_apply_npc_writes_to(tmp_path):
    client = RpcClient(tmp_path / "ws")
    try:
        open_turn(client)
        applied = client.table("apply", call_id="t1-c1", effects=[
            {"kind": "person", "who": KNOTT, "name": EPITHET, "why": "all she can tell of him is that he keeps the door"},
            {"kind": "npc", "name": EPITHET, "stance": "wary", "why": "she opened with the question he least wants"}])
        [staged] = npc_receipts(client, applied)
        assert staged["handle"] == "steven-knott" and "established" not in staged, staged
        # And on a later call, read back from world state rather than from this batch.
        later = client.table("apply", call_id="t1-c2", effects=[{"kind": "npc", "name": EPITHET, "stance": "hostile", "why": "asked twice"}])
        assert npc_receipts(client, later)[0]["handle"] == "steven-knott"
        assert not world(client).get("table_people"), "nobody new was established"
        assert EPITHET not in world(client)["npc_presence"]
    finally:
        client.close()


def test_a_word_nobody_carries_is_refused_without_walk_on_and_the_refusal_runs_as_written(tmp_path):
    client = RpcClient(tmp_path / "ws")
    try:
        open_turn(client)
        effect = {"kind": "npc", "name": EPITHET, "stance": "wary", "why": "she opened with the question he least wants"}
        refused = client.table_err("apply", call_id="t1-c1", effects=[effect])
        assert refused["code"] == "unknown_entity", refused
        assert not world(client).get("table_people"), "the silent mint is gone: nothing was established"
        details = refused["details"]
        assert details["walk_on"] == {**effect, "walk_on": True}
        [knott] = [person for person in details["present"] if person["name"] == KNOTT]
        assert knott["introduce"] == {"kind": "person", "who": KNOTT, "name": EPITHET}
        # The fix is executed literally: his introduce effect first, this effect after it, unchanged.
        applied = client.table("apply", call_id="t1-c2", effects=[knott["introduce"], effect])
        [staged] = npc_receipts(client, applied)
        assert staged["handle"] == "steven-knott" and "established" not in staged
        assert world(client)["person_labels"]["steven-knott"]["name"] == EPITHET
        assert not world(client).get("table_people")
    finally:
        client.close()


def test_walk_on_establishes_a_newcomer_and_the_next_one_as_well(tmp_path):
    client = RpcClient(tmp_path / "ws")
    try:
        open_turn(client)
        porter = npc_receipts(client, client.table("apply", call_id="t1-c1", effects=[
            {"kind": "npc", "name": "the porter", "to": "here", "walk_on": True, "why": "he heard the shouting"}]))[0]
        assert porter["established"] == "table"
        # The roster of table people is a list to pick from, never a reason to refuse the next newcomer.
        constable = npc_receipts(client, client.table("apply", call_id="t1-c2", effects=[
            {"kind": "npc", "name": "the constable", "to": "here", "walk_on": True, "why": "the porter fetched him"}]))[0]
        assert constable["established"] == "table" and constable["handle"] != porter["handle"]
        assert sorted(person["name"] for person in world(client)["table_people"]) == ["the constable", "the porter"]
        # Once established they are somebody this table has, and are written to by name alone.
        again = npc_receipts(client, client.table("apply", call_id="t1-c3", effects=[
            {"kind": "npc", "name": "the porter", "stance": "wary", "why": "he does not like the look of her"}]))[0]
        assert again["handle"] == porter["handle"] and "established" not in again
        assert len(world(client)["table_people"]) == 2
    finally:
        client.close()


def test_walk_on_for_someone_this_table_has_is_their_arrival(tmp_path):
    """Contract §198.1 (amends the §87.7 refusal): TR-F2 run 2 sent walk_on for Aganin, Gapon and Pyotr -- each the book's
    person -- and each refusal cost a round trip; on turn 18 the Keeper gave up at Pyotr's door. Nothing is minted: the
    effect is the person's arrival, `to: here` when it names no `to`, and the receipt and the result say how walk_on was read."""
    client = RpcClient(tmp_path / "ws")
    try:
        open_turn(client)
        active = world(client)["active_scene"]
        client.table("apply", call_id="t1-c1", effects=[{"kind": "npc", "name": KNOTT, "to": "away", "why": "he steps out"}])
        assert "steven-knott" not in world(client)["npc_presence"]
        applied = client.table("apply", call_id="t1-c2", effects=[
            {"kind": "npc", "name": KNOTT, "stance": "wary", "walk_on": True, "why": "he comes back up the stairs"}])
        [staged] = npc_receipts(client, applied)
        assert staged["handle"] == "steven-knott" and "established" not in staged, staged
        assert staged["to"] == active and world(client)["npc_presence"]["steven-knott"] == active
        assert staged["walk_on_read"] == {"read_as": "arrival", "person": KNOTT}
        assert applied["walk_on_read"] == [{"index": 0, "name": KNOTT, "person": KNOTT, "read_as": "arrival"}]
        client.table("apply", call_id="t1-c3", effects=[{"kind": "person", "who": KNOTT, "name": EPITHET}])
        by_word = client.table("apply", call_id="t1-c4", effects=[
            {"kind": "npc", "name": EPITHET, "stance": "hostile", "walk_on": True, "why": "x"}])
        [again] = npc_receipts(client, by_word)
        # Contract §177.3: the note names the person by this table's word for them, never by the book's name.
        assert again["handle"] == "steven-knott" and by_word["walk_on_read"][0]["person"] == EPITHET
        assert KNOTT not in by_word["walk_on_note"]
        assert not world(client).get("table_people")
    finally:
        client.close()


def test_a_pin_rides_on_the_call_that_declares_the_newcomer(tmp_path):
    client = RpcClient(tmp_path / "ws")
    try:
        open_turn(client)
        staged = npc_receipts(client, client.table("apply", call_id="t1-c1", effects=[
            {"kind": "npc", "name": "the porter", "to": "here", "walk_on": True, "archetype": "capable_adult",
             "why": "a big man used to hauling coal"}]))[0]
        assert staged["established"] == "table" and staged["profile"]["archetype"] == "capable_adult"
    finally:
        client.close()


def test_one_word_given_to_two_people_is_refused_not_picked(tmp_path):
    client = RpcClient(tmp_path / "ws")
    try:
        open_turn(client)
        # A table written before §103.7, which now refuses a second person the same word: the record is put in place.
        path = campaign_dir(client.workspace) / "world.json"
        state = read_json(path)
        state.setdefault("person_labels", {}).update({"steven-knott": {"name": "那个人"}, "walter-corbitt": {"name": "那个人"}})
        path.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
        refused = client.table_err("apply", call_id="t1-c2", effects=[{"kind": "npc", "name": "那个人", "stance": "wary", "why": "x"}])
        assert refused["code"] == "unknown_entity"
        assert sorted(candidate["name"] for candidate in refused["details"]["candidates"]) == ["steven-knott", "walter-corbitt"]
        assert not world(client).get("table_people")
    finally:
        client.close()


def test_walk_on_never_establishes_the_investigator_or_a_place(tmp_path):
    client = RpcClient(tmp_path / "ws")
    try:
        open_turn(client)
        [sheet] = [read_json(path) for path in (campaign_dir(client.workspace) / "party").glob("*.json")]
        own = client.table_err("apply", call_id="t1-c1", effects=[
            {"kind": "npc", "name": sheet["name"], "to": "here", "walk_on": True, "why": "x"}])
        assert own["code"] == "unknown_entity" and own["details"]["is_investigator"] is True, own
        place = client.table_err("apply", call_id="t1-c2", effects=[
            {"kind": "npc", "name": "hall-of-records", "to": "here", "walk_on": True, "why": "x"}])
        assert place["code"] == "unknown_entity" and place["details"]["matched_kind"] == "scene", place
        assert not world(client).get("table_people")
    finally:
        client.close()
