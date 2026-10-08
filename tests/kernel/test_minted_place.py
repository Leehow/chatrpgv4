"""Contract §187.2-§187.4: a minted place sits in the book, the book's people follow publication while the table's
ledger says who stayed, and the brief's rosters follow the reading window. Real entries only: `table.apply`,
`table.apply.options`, `table.capsule`, a fresh kernel process for the load path."""
from contextlib import closing
import copy
import hashlib
import json
import shutil
from pathlib import Path

from conftest import RpcClient, campaign_dir, narrate, open_turn, read_json
from setup_helpers import confirmed_investigator

ORIGIN = "commission-briefing"
LOBBY = "The Globe's back stair"
MORGUE = "newspaper-morgue"


OMITTED = object()


def mint(client, call_id, within=OMITTED, to=LOBBY):
    establish = {"summary": "A narrow service stair behind the newspaper offices."}
    if within is not OMITTED:
        establish["within"] = within
    return client.table("apply", call_id=call_id, effects=[
        {"kind": "move", "to": to, "via": "Round the back of the building", "establish": establish}])


def test_an_explicit_outside_mint_keeps_its_way_back_across_a_new_process(tmp_path):
    workspace = tmp_path / "ws"
    with closing(RpcClient(workspace)) as client:
        open_turn(client, "I slip round to the back of the newspaper building.")
        mint(client, "t1-c1", within=None)
        where = client.table("capsule")["where"]
        assert where["scene"] == LOBBY
        assert [exit["to"] for exit in where["exits"]] == [ORIGIN], "the route-to back edge is the minted room's exit"
        assert "within" not in where
        record = read_json(campaign_dir(workspace) / "world.json")["table_entities"][0]
        assert record["from"] == ORIGIN and "within" not in record
        narrate(client, "t1-c2", "You find the back stair.")
    with closing(RpcClient(workspace, fresh=True)) as client:
        client.table("open")
        assert [exit["to"] for exit in client.table("capsule")["where"]["exits"]] == [ORIGIN]


def test_within_writes_located_in_and_the_capsule_shows_the_book_place(tmp_path):
    workspace = tmp_path / "ws"
    with closing(RpcClient(workspace)) as client:
        open_turn(client, "I slip round to the back of the newspaper building.")
        mint(client, "t1-c1", within=MORGUE)
        within = client.table("capsule")["where"]["within"]
        assert within["name"] == MORGUE and within["display_name"] == "Boston Globe offices"
        assert isinstance(within["summary"], str) and within["summary"]
        assert {person["name"]: person["seated"] for person in within["people"]} == {"arty-wilmot": False, "ruth-blake": False}
        assert isinstance(within["clues"], int) and isinstance(within["exits"], list) and within["material"] == "ready"
        assert len(json.dumps(within, ensure_ascii=False).encode()) <= 2048
        assert read_json(campaign_dir(workspace) / "world.json")["table_entities"][0]["within"] == MORGUE
        # A person the ledger seats in the minted room reads seated.
        client.table("apply", call_id="t1-c2", effects=[{"kind": "npc", "name": "ruth-blake", "to": "here"}])
        seated = {person["name"]: person["seated"] for person in client.table("capsule")["where"]["within"]["people"]}
        assert seated == {"arty-wilmot": False, "ruth-blake": True}
        narrate(client, "t1-c3", "Ruth follows you onto the stair.")
    with closing(RpcClient(workspace, fresh=True)) as client:
        client.table("open")
        assert client.table("capsule")["where"]["within"]["name"] == MORGUE


def test_within_accepts_registered_table_places_but_never_people_or_unknowns(tmp_path):
    with closing(RpcClient(tmp_path / "ws")) as client:
        open_turn(client)
        for within in ["ruth-blake", "nowhere-at-all", ""]:
            error = client.table_err("apply", call_id="t1-c1", effects=[
                {"kind": "move", "to": LOBBY, "via": "Round the back", "establish": {"summary": "A stair.", "within": within}}])
            assert error["code"] == "invalid_params" and error["details"]["reason"] == "within_not_a_place", within
        assert not read_json(campaign_dir(client.workspace) / "world.json").get("table_entities")
        mint(client, "t1-c2")
        # §204.3: an explicitly registered table place can contain a new room.
        client.table("apply", call_id="t1-c3", effects=[
            {"kind": "move", "to": "A landing on the stair", "via": "Up", "establish": {"summary": "A landing.", "within": LOBBY}}])
        assert client.table("capsule")["where"]["within"]["name"] == LOBBY


def presence_offers(options):
    return [(c["effect"]["name"], c["effect"]["to"]) for c in options["candidates"] if c["description"]["kind"] == "source_presence"]


def unseat(workspace, handle):
    """Registry precondition (not play): the person is in the book but not on the table's ledger, as a person a later
    publication added is (§187.3.1); a source_reference book seats nobody at creation."""
    path = campaign_dir(workspace) / "world.json"
    world = read_json(path)
    del world["npc_presence"][handle]
    path.write_text(json.dumps(world, ensure_ascii=False, indent=2))


def test_the_within_place_offers_its_unseated_people_and_the_ledger_wins(tmp_path):
    workspace = tmp_path / "ws"
    with closing(RpcClient(workspace)) as client:
        open_turn(client, "I slip round to the back of the newspaper building.")
        mint(client, "t1-c1", within=MORGUE)
        assert presence_offers(client.table("apply.options")) == []
        narrate(client, "t1-c2", "You find the back stair.")
    unseat(workspace, "arty-wilmot")
    with closing(RpcClient(workspace, fresh=True)) as client:
        client.table("open")
        client.table("player_input", text="I listen at the stair.")
        offers = client.table("apply.options")
        assert presence_offers(offers) == [("arty-wilmot", MORGUE)], "the within place's book person is offered where the book puts him"
        offer = next(c for c in offers["candidates"] if c["description"]["kind"] == "source_presence")
        assert offer["description"]["within"] is True
        assert offer["description"]["authority"] == "authored_initial_presence_not_a_new_arrival"
        # Ruth is moved out by a receipt of this campaign (apply npc to: away writes `to: "away"` on the npc receipt).
        client.table("apply", call_id="t2-c1", effects=[{"kind": "npc", "name": "ruth-blake", "to": "away"}])
        offers = client.table("apply.options")
        assert presence_offers(offers) == [("arty-wilmot", MORGUE)]
        assert {row["name"]: row["reason"] for row in offers["source_presence_excluded"]} == {"ruth-blake": "moved"}
        assert next(row for row in offers["source_presence_excluded"] if row["name"] == "ruth-blake")["receipt"].startswith("npc:")


def test_a_dead_person_is_never_offered_by_the_book_again(tmp_path):
    workspace = tmp_path / "ws"
    with closing(RpcClient(workspace)) as client:
        open_turn(client, "I slip round to the back of the newspaper building.")
        mint(client, "t1-c1", within=MORGUE)
        # The ledger's death: `npc-ledger.json` `<node_id>.dead`, folded from the npc receipt's `dead: true`.
        client.table("apply", call_id="t1-c2", effects=[{"kind": "npc", "name": "arty-wilmot", "dead": True}])
        narrate(client, "t1-c3", "Arty does not get up again.")
    ledger = read_json(campaign_dir(workspace) / "npc-ledger.json")
    assert any(isinstance(entry.get("dead"), dict) for entry in ledger.values())
    unseat(workspace, "arty-wilmot")
    with closing(RpcClient(workspace, fresh=True)) as client:
        client.table("open")
        client.table("player_input", text="I look around the stair.")
        offers = client.table("apply.options")
        assert presence_offers(offers) == []
        assert [(row["name"], row["reason"]) for row in offers["source_presence_excluded"]] == [("arty-wilmot", "dead")]


# --- §187.4: the brief's rosters follow the reading window ---

FIXTURE = Path(__file__).parent / "fixtures/legacy-module"
MID = "grey-heron-dock"


def long_book(workspace):
    """The legacy fixture as a 200-page book with chapters, a person printed in the window (page 60) and many printed
    far from it (page 170) ahead of them in book order, so the 2,048-byte fit must cut."""
    target = workspace / ".coc/modules" / MID
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(FIXTURE, target)
    meta = read_json(target / "module.json")
    meta["page_count"] = 200
    meta.setdefault("source_document", {})["outline"] = [
        {"name": "Front", "page": 1}, {"name": "Dock", "page": 2}, {"name": "Town", "page": 50}, {"name": "Far", "page": 150}]
    (target / "module.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2))
    graph = read_json(target / "module-graph.json")
    template = next(node for node in graph["nodes"] if node["node_id"] == "npc-lao-zhou")
    def person(node_id, name, page):
        node = copy.deepcopy(template)
        node.update(node_id=node_id, name=name, aliases=[], summary=f"{name} keeps a long and particular account of the river trade " * 2)
        node["properties"] = {**node.get("properties", {}), "name": name}
        node["source_refs"] = [{"source_id": f"pdf:{MID}", "pdf_index": page - 1, "grep_anchor": name}]
        return node
    far = [person(f"npc-far-{i:02d}", f"Far Person Of The Lower River Wharves {i:03d}", 170) for i in range(120)]
    quay = {"node_id": "location-far-quay", "node_kind": "location", "name": "Far Quay", "aliases": [], "summary": "A quay far downriver.",
            "visibility": "keeper-only", "properties": {"name": "Far Quay"}, "source_refs": [{"source_id": f"pdf:{MID}", "pdf_index": 159, "grep_anchor": "Far Quay"}]}
    graph["nodes"] = far + graph["nodes"] + [person("npc-town-clerk", "Town Clerk", 60), quay]
    graph_path = target / "module-graph.json"
    graph_path.write_text(json.dumps(graph), encoding="utf-8")
    # The fixture is resealed as the test_fast_guidance fixture is: this is a test book, not a stored generation.
    manifest = read_json(target / "module-graph-manifest.json")
    manifest["graph_content_digest"] = hashlib.sha256(json.dumps(graph, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
    manifest["node_count"] = len(graph["nodes"])
    manifest["node_kinds"]["npc"] = sum(1 for node in graph["nodes"] if node["node_kind"] == "npc")
    (target / "module-graph-manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    meta["graph_digest"] = hashlib.sha256(graph_path.read_bytes()).hexdigest()
    (target / "module.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2))
    return target


def test_brief_lists_the_window_first_and_says_how_much_it_cut(tmp_path):
    with closing(RpcClient(tmp_path / "ws")) as client:
        long_book(client.workspace)
        client.ok("campaign.create", {"id": "c1", "module": MID, "play_language": "en"})
        confirmed_investigator(client)
        client.ok("setup.complete", {"campaign": "c1"})
        client.table("open")
        capsule = client.table("capsule", rehydrate=True)
        brief = capsule["module"]
        people = [entry["name"] for entry in brief["people"]]
        assert people[:2] == ["老周", "Town Clerk"], people
        assert brief["more"]["people"] == 122 - len(people) > 0
        assert capsule["_context"]["brief_window"] == {"first": 2, "last": 149, "chapters": ["Dock", "Town"]}
        # A room minted inside a book place anchors the window on that place (§187.2.1), not on the start scene.
        client.table("player_input", text="I take a boat downriver to a shed on the far quay.")
        client.table("apply", call_id="t1-c1", effects=[{"kind": "move", "to": "A net shed", "via": "By boat downriver",
            "establish": {"summary": "A tarred net shed on the quay.", "within": "Far Quay"}}])
        capsule = client.table("capsule", rehydrate=True)
        assert capsule["_context"]["brief_window"] == {"first": 150, "last": 200, "chapters": ["Far"]}
        assert capsule["module"]["people"][0]["name"].startswith("Far Person"), "the far chapter's people now come first"


def test_a_book_without_a_window_keeps_graph_order_and_says_nothing_cut(tmp_path):
    with closing(RpcClient(tmp_path / "ws")) as client:
        open_turn(client)
        capsule = client.table("capsule", rehydrate=True)
        assert capsule["_context"]["brief_window"] is None
        assert "more" not in capsule["module"] or capsule["module"]["more"]["people"] >= 0


def test_placement_candidates_include_active_table_context_but_no_unrelated_mints(tmp_path):
    """§187.2.3: the host's placement lane reads the book places through `table.apply.placement`."""
    with closing(RpcClient(tmp_path / "ws")) as client:
        open_turn(client, "I slip round to the back of the newspaper building.")
        before = client.table("apply.placement")
        sources = {row["name"]: row["source"] for row in before["candidates"]}
        assert sources[ORIGIN] == "here" and sources[MORGUE] == "exit" and before["window"] is None
        assert next(row for row in before["candidates"] if row["name"] == MORGUE)["display_name"] == "Boston Globe offices"
        mint(client, "t1-c1")
        after = client.table("apply.placement", limit=4)
        own = next(row for row in after["candidates"] if row["name"] == LOBBY)
        assert own["table_place"] is True and own["source"] == "here", "table-origin context is eligible for inside only"
        assert after["scene"]["name"] == LOBBY and len(after["candidates"]) == 4
        assert client.table_err("apply.placement", limit=0)["code"] == "invalid_params"
        mint(client, "t1-c2", within=None, to="A detached outbuilding")
        detached = client.table("apply.placement", limit=4)
        assert LOBBY not in [row["name"] for row in detached["candidates"]], "an unrelated table place is excluded"
