"""§14.3 the ten invariants over a whole graph, judged the way this kernel plays it."""

from __future__ import annotations

import copy
import json

from conftest import CONTENT_DIR, MODULE
from module_helpers import KERNEL_DIR  # noqa: F401  (puts kernel/ on sys.path)

from coc.modules.playability import check, opening_check


def starter_graph() -> dict:
    return json.loads((CONTENT_DIR / "starters" / MODULE / "module-graph.json").read_text(encoding="utf-8"))


def test_the_haunting_is_one_walkable_piece_with_its_own_gaps_reported():
    report = check(starter_graph())
    assert report["status"] == "findings"
    assert set(report["finding_counts"]) == {"actor_in_no_scene", "node_without_page"}
    assert report["finding_counts"]["actor_in_no_scene"] == 2
    measures = report["measures"]
    assert measures["scenes"] == 12 and measures["scene_components"] == 1 and measures["largest_component"] == 12
    assert measures["endings"] == 1, "is_final on the confrontation scene is the declared ending"
    assert set(measures) == {"scenes", "scene_exits", "scene_components", "largest_component", "branches", "npcs",
                             "creatures", "clues", "conclusions", "endings", "rules", "nodes", "relations",
                             "span_consumption", "pages_covered", "substantive_spans_uncited",
                                 "npcs_without_material"}  # §17.2 (#29)
    opening = opening_check(starter_graph())
    assert opening["opening_ready"] is True and opening["start_scene"] == "scene-commission-briefing"


def test_unpaged_is_the_account_for_a_module_without_a_source_document():
    graph = starter_graph()
    graph["unpaged"] = True
    report = check(graph)
    assert set(report["finding_counts"]) == {"actor_in_no_scene"}
    graph = starter_graph()
    module = next(n for n in graph["nodes"] if n["node_kind"] == "module")
    module["properties"]["unpaged"] = True
    assert "node_without_page" not in check(graph)["finding_counts"]


def test_silence_about_entrance_and_ending_is_refused_but_an_explicit_none_is_an_answer():
    graph = starter_graph()
    for node in graph["nodes"]:
        record = ((node.get("properties") or {}).get("runtime_projection") or {}).get("record")
        if isinstance(record, dict):
            record.pop("is_start", None)
            record.pop("is_final", None)
    silent = check(copy.deepcopy(graph))["finding_counts"]
    assert silent["no_entrance_declared"] == 1 and silent["no_ending_declared"] == 1
    graph["entry_scene_ids"] = []
    module = next(n for n in graph["nodes"] if n["node_kind"] == "module")
    module["properties"]["ending_scene_ids"] = []
    accounted = check(graph)["finding_counts"]
    assert "no_entrance_declared" not in accounted and "no_ending_declared" not in accounted
    assert opening_check(graph)["missing"] == ["start_scene"]


def test_dangling_relation_and_unreachable_scene_are_found():
    graph = starter_graph()
    graph["relations"].append({"relation_id": "relation-route-to-ghost", "relation_kind": "route-to",
                               "from_node_id": "scene-commission-briefing", "to_node_id": "scene-ghost",
                               "claim_id": "claim-ghost", "properties": {}})
    graph["nodes"].append({"node_id": "scene-island", "node_kind": "scene", "name": "island", "visibility": "keeper-only",
                           "aliases": [], "summary": "", "evidence_span_ids": ["span-p1-1"], "properties": {}})
    counts = check(graph)["finding_counts"]
    assert counts["dangling_relation"] == 1 and counts["scene_graph_fragmented"] == 1
    assert counts["scene_unreachable_from_entrance"] == 1
