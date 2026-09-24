"""T12 read-only apply options and fail-closed fulfillment metadata over TypeScript RPC.

Fixtures verify protocol and storage behavior only. They do not authorize effects or claim gameplay.
"""

from __future__ import annotations

import hashlib
import json

from conftest import CAMPAIGN, CONTENT_DIR, campaign_dir, git_log, narrate, open_turn


def options(client):
    return client.ok("table.apply.options", {"campaign": CAMPAIGN})


def fingerprint(client):
    root = campaign_dir(client.workspace)
    return {
        "files": {path.relative_to(root).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
                  for path in root.rglob("*") if path.is_file()},
        "git": git_log(client.workspace),
    }


def test_apply_options_is_read_only_unique_and_derived_from_current_graph_state(kernel):
    open_turn(kernel)
    before = fingerprint(kernel)
    snapshot = options(kernel)

    assert fingerprint(kernel) == before
    assert snapshot["version"] == 1
    assert snapshot["revision"] and snapshot["world_revision"]
    aliases = [row["alias"] for row in snapshot["candidates"]]
    assert aliases == [f"effect:{index}" for index in range(len(aliases))]
    assert len(aliases) == len(set(aliases))
    effects = [row["effect"] for row in snapshot["candidates"]]
    assert all(set(effect) in ({"kind", "clue"}, {"kind", "to"}) for effect in effects)
    assert {effect["kind"] for effect in effects} == {"clue", "move"}
    assert {effect["clue"] for effect in effects if effect["kind"] == "clue"} == {
        "knott-commission", "knott-research-leads", "knott-macario-summary", "knott-keys",
    }
    assert "hall-of-records" in {effect["to"] for effect in effects if effect["kind"] == "move"}
    assert all(row["description"]["authority"] in
               {"authored_candidate_not_discovered", "available_route_not_player_choice"}
               for row in snapshot["candidates"])
    assert snapshot["context"] == {**snapshot["context"], "scene": "Knott's Office",
                                    "pending_choice": None, "session": None,
                                    "present": ["Steven Knott"], "current_receipts": []}
    assert snapshot["context"]["coverage"]["effect_families"] == ["clue", "move"]


def test_apply_options_removes_discovered_clue_and_reports_current_receipt_without_writing(kernel):
    open_turn(kernel)
    applied = kernel.table("apply", call_id="t1-c1", effects=[{"kind": "clue", "clue": "knott-commission"}])
    before = fingerprint(kernel)

    snapshot = options(kernel)

    assert fingerprint(kernel) == before
    assert "knott-commission" not in {row["effect"].get("clue") for row in snapshot["candidates"]}
    assert snapshot["context"]["current_receipts"] == [{"kind": "clue", "clue": "knott-commission", "from": None}]
    assert snapshot["world_revision"]
    assert applied["receipts"]


def test_apply_options_rejects_foreign_closed_and_extra_requests(kernel):
    open_turn(kernel)
    assert kernel.err("table.apply.options", {"campaign": "other"})["code"] == "campaign_not_found"
    assert kernel.err("table.apply.options", {})["code"] == "invalid_params"
    assert kernel.err("table.apply.options", {"campaign": CAMPAIGN, "extra": True})["code"] == "invalid_params"
    narrate(kernel, "t1-c1", "The turn closes without an effect.")
    assert kernel.err("table.apply.options", {"campaign": CAMPAIGN})["code"] == "campaign_not_ready"


def test_existing_apply_batch_remains_atomic_and_exactly_replayable(kernel):
    open_turn(kernel)
    before = fingerprint(kernel)
    refused = kernel.table_err("apply", call_id="t1-c1", effects=[
        {"kind": "time", "minutes": 5}, {"kind": "clue", "clue": "not-an-authored-clue"},
    ])
    assert refused["code"] in {"invalid_params", "unknown_entity"}
    assert fingerprint(kernel) == before

    result = kernel.table("apply", call_id="t1-c1", effects=[{"kind": "time", "minutes": 5}])
    written = fingerprint(kernel)
    replay = kernel.table("apply", call_id="t1-c1", effects=[{"kind": "time", "minutes": 5}])
    assert replay == {**result, "replayed": True}
    assert fingerprint(kernel) == written


def test_fulfillment_metadata_is_never_silently_ignored_or_allowed_to_apply_effects(kernel):
    open_turn(kernel)
    before = fingerprint(kernel)
    for ordinal, fulfillment in enumerate((
        {"kind": "unknown-binding", "candidate": "effect:0"},
        {"kind": "clue", "candidate": "effect:0", "claim": "not yet validated"},
    ), start=1):
        error = kernel.err("table.apply", {"campaign": CAMPAIGN, "call_id": f"t1-c{ordinal}",
            "effects": [{"kind": "clue", "clue": "knott-commission"}], "_fulfillments": [fulfillment]})
        assert error["code"] == "needs"
        assert error["details"]["reason"] == "unsupported_terms"
        assert fingerprint(kernel) == before

    # Refused private metadata did not consume the public call identity or discover the clue.
    accepted = kernel.table("apply", call_id="t1-c1", effects=[{"kind": "clue", "clue": "knott-commission"}])
    assert accepted["receipts"]


def _haunting_scene(handle):
    graph = json.loads((CONTENT_DIR / "starters" / "the-haunting" / "module-graph.json").read_text("utf-8"))
    nodes = {node["node_id"]: node for node in graph["nodes"]}
    return nodes, nodes[f"scene-{handle}"], nodes[f"scene-{handle}"]["properties"]["runtime_projection"]["record"]


def _move(snapshot, to):
    [row] = [row for row in snapshot["candidates"] if row["effect"] == {"kind": "move", "to": to}]
    return row["description"]


def test_move_row_says_what_the_place_is_from_the_graph_and_the_world(kernel):
    """Contract §135.30.4: the sanatorium is named, and its where-words and people ride with it; a placeholder summary
    (the graph's summary is its name) is not repeated. Expected values are read from the module on disk."""
    open_turn(kernel)
    _, node, record = _haunting_scene("previous-tenants")
    identity = record["destination_identity"]
    description = _move(options(kernel), "previous-tenants")

    assert description["display_name"] == identity["canonical_name"] == "Roxbury Sanitarium"
    destination = description["destination"]
    assert destination["names"] == [name for name in identity["aliases"] if name != identity["canonical_name"]]
    assert destination["where"] == record["location_tags"]
    assert destination["people"] == ["Gabriela Macario", "Vittorio Macario"]
    assert node["summary"] == node["name"] and "summary" not in destination
    # The morgue's handout is a thing there; a place without people carries no `people` key.
    morgue = _move(options(kernel), "newspaper-morgue")["destination"]
    assert morgue["things"] and all(isinstance(thing, str) for thing in morgue["things"])
    assert "people" not in _move(options(kernel), "central-library")["destination"]


def test_unmet_unlock_names_the_clue_its_words_and_where_the_book_puts_it(kernel):
    """Contract §135.30.4: an exit held by `clue_discovered` says the clue's own words and each scene and affordance cue
    that grants it; once the clue is found the unlock is met and says nothing more."""
    open_turn(kernel)
    nodes, _, briefing = _haunting_scene("commission-briefing")
    clue = nodes["clue-knott-research-leads"]
    cues = [aff["cue"] for aff in briefing["affordances"] if aff.get("clue_id") == "clue-knott-research-leads"]
    unlock = _move(options(kernel), "previous-tenants")["unlock_when"]

    assert unlock["met"] is False and unlock["condition"] == "clue_discovered: knott-research-leads"
    assert unlock["clue"] == {"clue": "knott-research-leads", "says": clue["summary"],
                              "found_at": [{"scene": "commission-briefing", "display_name": "Knott's Office", "cues": cues}]}
    assert cues, "the book grants the clue at the office"

    kernel.table("apply", call_id="t1-c1", effects=[{"kind": "clue", "clue": "knott-research-leads"}])
    assert _move(options(kernel), "previous-tenants")["unlock_when"] == {"condition": "clue_discovered: knott-research-leads", "met": True}
    # The keys still hold the house, now named, and its guard names the keys.
    house = _move(options(kernel), "corbitt-house-ground")
    assert house["display_name"] == "The Corbitt House"
    assert house["unlock_when"]["clue"]["clue"] == "knott-keys"
    assert house["unlock_when"]["clue"]["says"] == nodes["clue-knott-keys"]["summary"]


def test_unmet_unlock_says_the_place_and_its_entrance_exist_from_where_the_party_is(kernel):
    """Contract §135.30.6 (SL-40): a held exit is a pacing condition. Its unlock says the place and the way to it exist, from
    the scene the party is in; a met unlock says nothing more. At the ground floor the basement's way is the ground floor's."""
    open_turn(kernel)
    unlock = _move(options(kernel), "newspaper-morgue")["unlock_when"]
    assert unlock["met"] is False
    assert unlock["exists"] == {"place": True, "entrance": True, "from": "commission-briefing", "from_place": "Knott's Office"}
    house = _move(options(kernel), "corbitt-house-ground")["display_name"]

    kernel.table("apply", call_id="t1-c1", effects=[{"kind": "clue", "clue": "knott-research-leads"}, {"kind": "clue", "clue": "knott-keys"}])
    assert "exists" not in _move(options(kernel), "newspaper-morgue")["unlock_when"]
    kernel.table("apply", call_id="t1-c2", effects=[{"kind": "move", "to": "corbitt-house-ground"}])
    basement = _move(options(kernel), "basement-rites")["unlock_when"]
    assert basement["met"] is False and basement["clue"]["clue"] == "corbitt-diaries"
    assert basement["exists"] == {"place": True, "entrance": True, "from": "corbitt-house-ground", "from_place": house}


def test_destination_people_by_this_tables_name_and_things_without_the_places_media(kernel):
    """Contract §135.30.4: a person is named as this table calls them (§79); `things` are what the place holds, never the
    maps and pictures of it (graph nodes of kind `asset`)."""
    open_turn(kernel, "I wait for the man to speak.")
    label = "The man with the keys"
    kernel.table("apply", call_id="t1-c1", effects=[{"kind": "person", "who": "Steven Knott", "name": label},
                                                     {"kind": "clue", "clue": "knott-research-leads"}])
    kernel.table("apply", call_id="t1-c2", effects=[{"kind": "move", "to": "central-library"}])
    back = _move(options(kernel), "commission-briefing")["destination"]
    assert back["people"] == [label]

    nodes, _, _ = _haunting_scene("corbitt-house-ground")
    graph = json.loads((CONTENT_DIR / "starters" / "the-haunting" / "module-graph.json").read_text("utf-8"))
    held = [nodes[rel["from_node_id"]] for rel in graph["relations"]
            if rel["to_node_id"] == "scene-corbitt-house-ground" and rel["relation_kind"] in ("depicts", "discoverable-at", "located-in")
            and rel["from_node_id"] in nodes and nodes[rel["from_node_id"]]["node_kind"] != "clue"]
    other = {node["name"] for node in held if node["node_kind"] != "asset"}
    media = {node["name"] for node in held if node["node_kind"] == "asset"} - other
    assert media, "the house has maps or pictures of its own, so the filter is under test"
    things = _move(options(kernel), "corbitt-house-ground")["destination"]["things"]
    assert things and set(things) <= other and not media & set(things)
