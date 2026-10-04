"""§138.9 (BR-05): the minutes of a road are data on the module graph, filled once at build.

Through the emitted kernel. A shipped starter's filled road carries its minutes into a move that names none, so the
road's time lands with the move and no second `time` effect is needed. A publication (`module.read.finish`, the one
publication entry) lands the host's band on the roads it adds: the travel row's `default`, never a roll; 0 for
`adjacent`; a road that already carries minutes untouched; a band that does not fit skipped with its reason and never
a refused reading; and the minutes survive the next publication's re-assembly of relations from claims.
"""
import json
from pathlib import Path

import pytest

from conftest import CONTENT_DIR, OPENING_SCENE, campaign_dir, create_campaign, narrate_opening, read_json, read_jsonl, written
from module_helpers import claim, finish, indexed, observed, opening, request, write

STARTERS = ["the-haunting", "mystery-house", "voice-bench", "the-haunting-rulebook"]
TIME_COSTS = json.loads((CONTENT_DIR / "rulesets" / "coc7" / "rules-json" / "time-costs.json").read_text(encoding="utf-8"))["categories"]
LOCAL, LONG = TIME_COSTS["local_travel"]["default"], TIME_COSTS["long_travel"]["default"]


def shipped(module_id):
    return json.loads((CONTENT_DIR / "starters" / module_id / "module-graph.json").read_text(encoding="utf-8"))


def published(kernel, module_id):
    folder = kernel.workspace / ".coc" / "modules" / module_id
    return read_json(folder / read_json(folder / "module.json").get("graph_file", "module-graph.json"))


def roads(graph, a, b):
    return [r for r in graph["relations"] if r["relation_kind"] == "route-to" and {r["from_node_id"], r["to_node_id"]} == {a, b}]


@pytest.mark.parametrize("module_id", STARTERS)
def test_every_shipped_road_minute_is_a_banded_default_or_absent(module_id):
    """The regenerated data states each road's number as the fill wrote it: a travel row's default or 0 for adjacent,
    with its provenance; a road the gate left open carries neither; no other relation kind carries either."""
    graph = shipped(module_id)
    counted = 0
    for relation in graph["relations"]:
        properties = relation.get("properties") or {}
        if relation["relation_kind"] != "route-to":
            assert "travel_minutes" not in properties and "travel" not in properties
            continue
        if "travel_minutes" not in properties:
            assert "travel" not in properties
            continue
        counted += 1
        travel = properties["travel"]
        assert set(travel) == {"basis", "band", "confidence"} and travel["basis"] == "banded"
        assert 0 <= travel["confidence"] <= 1
        expected = 0 if travel["band"] == "adjacent" else TIME_COSTS[travel["band"]]["default"]
        assert travel["band"] in ("adjacent", "local_travel", "long_travel")
        assert properties["travel_minutes"] == expected, relation["relation_id"]
    assert counted, f"{module_id} ships no filled road"
    # The same road is the same length both ways: every filled pair agrees.
    by_pair = {}
    for relation in graph["relations"]:
        minutes = (relation.get("properties") or {}).get("travel_minutes")
        if relation["relation_kind"] == "route-to" and minutes is not None:
            by_pair.setdefault(frozenset((relation["from_node_id"], relation["to_node_id"])), set()).add(minutes)
    assert all(len(values) == 1 for values in by_pair.values())


def test_a_move_to_a_filled_exit_lands_with_the_roads_minutes(kernel):
    graph = shipped("the-haunting")
    road = roads(graph, f"scene-{OPENING_SCENE}", "scene-hall-of-records")
    minutes = road[0]["properties"]["travel_minutes"]
    assert minutes == LOCAL and road[0]["properties"]["travel"]["band"] == "local_travel"
    create_campaign(kernel)
    narrate_opening(kernel)
    capsule = kernel.table("player_input", text="我去档案馆。")["capsule"]
    exits = {exit["to"]: exit for exit in capsule["where"]["exits"]}
    assert exits["hall-of-records"]["travel_minutes"] == minutes
    moved = kernel.table("apply", call_id="t1-c1", effects=[{"kind": "move", "to": "hall-of-records"}])
    assert moved["world"]["clock"] == {"minutes": minutes}
    receipts = written(read_json(campaign_dir(kernel.workspace) / "turn.json")["receipts"])  # without the clerk's first impression
    assert [r["kind"] for r in receipts] == ["move"] and receipts[0]["minutes"] == minutes
    event = [e for e in read_jsonl(campaign_dir(kernel.workspace) / "events.jsonl") if e["type"] == "scene-moved"][-1]
    assert event["data"]["minutes"] == minutes
    # The Keeper's own number still wins over the edge.
    back = kernel.table("apply", call_id="t1-c2", effects=[{"kind": "move", "to": OPENING_SCENE, "travel_minutes": 5}])
    assert back["world"]["clock"] == {"minutes": minutes + 5}


def publish_opening(kernel, tmp_path, travel=None):
    mid, _ = indexed(kernel, tmp_path)
    job, _, _ = opening(kernel, mid)
    result = finish(kernel, job, **({"travel": travel} if travel is not None else {}))
    return mid, result


@pytest.mark.parametrize("band,minutes", [("local_travel", LOCAL), ("long_travel", LONG), ("adjacent", 0)])
def test_a_publication_lands_the_hosts_band_as_the_rows_default(kernel, tmp_path, band, minutes):
    mid, result = publish_opening(kernel, tmp_path, [{"from": "scene-tower", "to": "scene-dock", "band": band, "confidence": 0.83}])
    assert result["travel"] == {"filled": 1, "skipped": []}
    [road] = roads(published(kernel, mid), "scene-dock", "scene-tower")
    assert road["properties"] == {"travel_minutes": minutes, "travel": {"basis": "banded", "band": band, "confidence": 0.83}}


def test_without_a_band_a_road_keeps_no_minutes(kernel, tmp_path):
    mid, result = publish_opening(kernel, tmp_path)
    assert "travel" not in result
    [road] = roads(published(kernel, mid), "scene-dock", "scene-tower")
    assert road["properties"] == {}


def test_a_band_that_does_not_fit_is_skipped_and_the_reading_still_publishes(kernel, tmp_path):
    entries = [
        {"from": "scene-dock", "to": "scene-tower", "band": "sleep_night", "confidence": 0.9},   # a row, not a travel row
        {"from": "scene-dock", "to": "scene-dock", "band": "local_travel", "confidence": 0.9},
        {"from": "scene-dock", "to": "npc-lena", "band": "local_travel", "confidence": 0.9},
        {"from": "scene-dock", "to": "scene-tower", "band": "local_travel", "confidence": 1.5},
        {"from": "scene-dock", "to": "scene-tower", "band": "local_travel", "confidence": 0.9, "minutes": 7},
    ]
    mid, result = publish_opening(kernel, tmp_path, entries)
    assert result["generation"] >= 1 and result["travel"]["filled"] == 0
    assert [row["reason"] for row in result["travel"]["skipped"]] == [
        "band_unknown", "not_two_scenes", "not_two_scenes", "confidence", "entry_shape"]
    [road] = roads(published(kernel, mid), "scene-dock", "scene-tower")
    assert "travel_minutes" not in road["properties"]


def test_a_filled_road_survives_the_next_publication_and_is_never_overwritten(kernel, tmp_path):
    mid, _ = publish_opening(kernel, tmp_path, [{"from": "scene-dock", "to": "scene-tower", "band": "local_travel", "confidence": 0.7}])
    request(kernel, mid, "detail", focus="Lena", question="What does she remember about the tower?")
    job = claim(kernel, mid)
    refs = [{"page": 2}]
    # The detail restates the road's claim, so the publication re-assembles that relation from it.
    draft = {"nodes": [{"node_id": "npc-lena", "node_kind": "npc", "name": "Lena", "source_refs": refs,
                        "properties": {"knowledge": ["She remembers the tower keeper."]}}],
             "claims": [{"subject_id": "scene-dock", "predicate": "route-to", "object": {"node_id": "scene-tower"},
                         "truth_status": "authored-fact", "source_refs": refs}],
             "node_refs": ["scene-dock", "scene-tower"], "coverage": {}, "dependencies": [], "critical": [], "ready_nodes": ["npc-lena"]}
    write(Path(job["work_dir"]) / "draft.json", draft)
    write(Path(job["work_dir"]) / "review.json", {"checked": [{"paths": ["/nodes/0", "/claims/0", "/coverage"], "verdict": "supported",
        "source_refs": refs, "reason": "Fixture."}], "missing": []})
    observed(job, read_pages=[2], review_pages=[2])
    result = finish(kernel, job, travel=[{"from": "scene-dock", "to": "scene-tower", "band": "long_travel", "confidence": 0.99}])
    assert result["travel"] == {"filled": 0, "skipped": [{"from": "scene-dock", "to": "scene-tower", "band": "long_travel", "reason": "no_unfilled_road"}]}
    [road] = roads(published(kernel, mid), "scene-dock", "scene-tower")
    assert road["properties"] == {"travel_minutes": LOCAL, "travel": {"basis": "banded", "band": "local_travel", "confidence": 0.7}}
