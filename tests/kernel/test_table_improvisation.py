"""Section 150 transaction regressions, not Keeper play acceptance."""
from contextlib import closing
import json
from conftest import RpcClient, campaign_dir, narrate, open_turn, read_json

SHOP = "Riverside photographic shop"
CLUE = "The shopkeeper's delivery address"


def test_improvised_place_person_and_clue_survive_return_and_restart(tmp_path):
    workspace = tmp_path / "ws"
    with closing(RpcClient(workspace)) as client:
        open_turn(client, "I visit the photographic shop and ask about the delivery.")
        origin = client.table("capsule")["where"]["scene"]
        client.table("apply", call_id="t1-c1", effects=[
            {"kind": "move", "to": SHOP, "via": "Walk along the riverside street",
             "establish": {"summary": "A photographic shop with a public counter."}},
            {"kind": "npc", "name": "the photographic shopkeeper", "walk_on": True, "to": "here"},
            {"kind": "clue", "clue": CLUE, "establish": {"summary": "The delivery went to the north warehouse."},
             "from": "the photographic shopkeeper", "how": "The shopkeeper showed the address in her delivery book."},
        ])
        assert read_json(campaign_dir(client.workspace) / "world.json")["active_scene"] == SHOP
        found = client.table("lookup", kind="module", query=CLUE)["entities"]
        assert len(found) == 1 and found[0]["summary"] == "The delivery went to the north warehouse."
        narrate(client, "t1-c2", "The shopkeeper shows you the warehouse address in her book.")
        client.table("player_input", text="I leave and then return to the same shop.")
        client.table("apply", call_id="t2-c1", effects=[{"kind": "move", "to": origin}, {"kind": "move", "to": SHOP, "via": "Return along the same street"}])
        narrate(client, "t2-c2", "You return to the counter and the same shopkeeper looks up.")
    with closing(RpcClient(workspace)) as client:
        client.table("player_input", text="I ask the shopkeeper about the address again.")
        assert read_json(campaign_dir(client.workspace) / "world.json")["active_scene"] == SHOP
        assert any(p["name"] == "the photographic shopkeeper" for p in client.table("capsule")["present"])
        world = read_json(campaign_dir(workspace) / "world.json")
        assert CLUE in world["discovered_clues"]
        assert len(world["table_entities"]) == 2
        assert client.table("lookup", kind="module", query=CLUE)["entities"][0]["summary"] == "The delivery went to the north warehouse."


def test_a_new_kernel_process_opens_and_plays_from_an_improvised_active_scene(tmp_path):
    """2026-09-29: a turn settled `apply move ... establish` onto a place that exists only in
    world.table_entities, and the table was then reopened by another process. That process must
    project the record on load (section 150) -- not answer `no scene named ... in the module graph`
    to every call, which is what a kernel without the projection does. The first client stands
    for the long-running App process; the second is a real new process, not the pooled kernel."""
    bench = "Street park bench"
    workspace = tmp_path / "ws"
    with closing(RpcClient(workspace)) as client:
        open_turn(client, "I sit on a bench in the little park by the street.")
        origin = client.table("capsule")["where"]["scene"]
        client.table("apply", call_id="t1-c1", effects=[
            {"kind": "move", "to": bench, "via": "Walk to the green beside the street",
             "establish": {"summary": "A strip of public green with a gravel path and two benches."}}])
        narrate(client, "t1-c2", "You sit on the bench and sort the photographs.")
    world = read_json(campaign_dir(workspace) / "world.json")
    assert world["active_scene"] == bench
    assert [entity["name"] for entity in world["table_entities"]] == [bench]
    with closing(RpcClient(workspace, fresh=True)) as client:
        assert not client.pooled
        opened = client.table("open")
        assert opened["scene"]["name"] == bench
        assert opened["turn"]["state"] == "awaiting_player"
        where = client.table("look", focus="scene")["where"]
        assert where["scene"] == bench and where["origin"]["kind"] == "table"
        assert client.table("capsule")["where"]["scene"] == bench
        client.table("player_input", text="I get up, walk back, and then return to the bench.")
        client.table("apply", call_id="t2-c1", effects=[{"kind": "move", "to": origin},
                                                         {"kind": "move", "to": bench, "via": "Back along the street"}])
        narrate(client, "t2-c2", "You walk back and settle on the same bench.")
        assert read_json(campaign_dir(workspace) / "world.json")["active_scene"] == bench
        assert len(read_json(campaign_dir(workspace) / "world.json")["table_entities"]) == 1


def test_undeclared_location_and_failed_batch_create_nothing(tmp_path):
    with closing(RpcClient(tmp_path / "ws")) as client:
        open_turn(client)
        before = read_json(campaign_dir(client.workspace) / "world.json")
        assert client.table_err("apply", call_id="t1-c1", effects=[{"kind": "move", "to": SHOP}])["code"] == "unknown_entity"
        client.table_err("apply", call_id="t1-c2", effects=[
            {"kind": "move", "to": SHOP, "via": "Walk", "establish": {"summary": "A photographic shop."}},
            {"kind": "clue", "clue": CLUE, "establish": {"summary": "An address."}},
        ])
        after = read_json(campaign_dir(client.workspace) / "world.json")
        assert after.get("table_entities") == before.get("table_entities")
        assert after["active_scene"] == before["active_scene"]


def test_establish_cannot_replace_authored_scene(tmp_path):
    with closing(RpcClient(tmp_path / "ws")) as client:
        open_turn(client)
        origin = client.table("capsule")["where"]["scene"]
        error = client.table_err("apply", call_id="t1-c1", effects=[
            {"kind": "move", "to": origin, "establish": {"summary": "A different place."}}])
        assert error["code"] == "invalid_params"
        assert not read_json(campaign_dir(client.workspace) / "world.json").get("table_entities")


def test_known_memory_reference_is_not_a_note_and_cannot_block_a_legal_move(tmp_path):
    with closing(RpcClient(tmp_path / "ws")) as client:
        open_turn(client, "I go to the newspaper office.")
        # A registry precondition for this deterministic contract test, not a play trace.
        memory = campaign_dir(client.workspace) / "memory" / "candidates.jsonl"
        memory.parent.mkdir(parents=True, exist_ok=True)
        original = json.dumps({"id": "mem:t1-3", "kind": "promise", "statement": "A prior service promise.", "state": "accurate", "status": "candidate"}) + "\n"
        memory.write_text(original)
        effects = [{"kind": "move", "to": "newspaper-morgue"},
                   {"kind": "note", "closes": "mem:t1-3", "name": "service-done", "text": "The service is complete."}]
        result = client.table("apply", call_id="t1-c1", effects=effects)
        assert result["world"]["active_scene"] == "newspaper-morgue"
        assert len(result["receipts"]) == 1
        assert result["not_landed"][0]["details"]["reason"] == "note_reference_owner"
        assert memory.read_text() == original
        assert not (campaign_dir(client.workspace) / "notes.jsonl").exists()
        assert client.table("apply", call_id="t1-c1", effects=effects)["replayed"]


def test_guessed_memory_id_does_not_bypass_atomic_note_validation(tmp_path):
    with closing(RpcClient(tmp_path / "ws")) as client:
        open_turn(client)
        before = read_json(campaign_dir(client.workspace) / "world.json")["active_scene"]
        error = client.table_err("apply", call_id="t1-c1", effects=[
            {"kind": "move", "to": "newspaper-morgue"},
            {"kind": "note", "closes": "mem:t999-3", "name": "replacement", "text": "Not a real memory reference."},
        ])
        assert error["details"]["reason"] == "note_not_open"
        assert read_json(campaign_dir(client.workspace) / "world.json")["active_scene"] == before
        assert not (campaign_dir(client.workspace) / "notes.jsonl").exists()


def test_foreign_note_does_not_relax_linked_or_multiple_note_batches(tmp_path):
    with closing(RpcClient(tmp_path / "ws")) as client:
        open_turn(client)
        memory = campaign_dir(client.workspace) / "memory" / "candidates.jsonl"
        memory.parent.mkdir(parents=True, exist_ok=True)
        memory.write_text(json.dumps({"id": "mem:t1-3", "kind": "promise"}) + "\n")
        before = read_json(campaign_dir(client.workspace) / "world.json")["active_scene"]
        for notes in [
            [{"kind": "note", "closes": "mem:t1-3", "intent_ref": "an-intention"}],
            [{"kind": "note", "closes": "mem:t1-3"}, {"kind": "note", "name": "new-note", "text": "A dependent replacement."}],
        ]:
            error = client.table_err("apply", call_id="t1-c1", effects=[{"kind": "move", "to": "newspaper-morgue"}, *notes])
            assert error["details"]["reason"] == "note_reference_owner"
            assert read_json(campaign_dir(client.workspace) / "world.json")["active_scene"] == before
            assert not (campaign_dir(client.workspace) / "notes.jsonl").exists()


def test_real_manual_note_wins_over_a_colliding_memory_reference(tmp_path):
    with closing(RpcClient(tmp_path / "ws")) as client:
        open_turn(client)
        memory = campaign_dir(client.workspace) / "memory" / "candidates.jsonl"
        memory.parent.mkdir(parents=True, exist_ok=True)
        original = json.dumps({"id": "mem:t1-3", "kind": "promise"}) + "\n"
        memory.write_text(original)
        client.table("apply", call_id="t1-c1", effects=[{"kind": "note", "name": "mem:t1-3", "text": "An actual manual note."}])
        result = client.table("apply", call_id="t1-c2", effects=[{"kind": "note", "closes": "mem:t1-3"}])
        assert len(result["receipts"]) == 1 and not result.get("not_landed")
        assert memory.read_text() == original
