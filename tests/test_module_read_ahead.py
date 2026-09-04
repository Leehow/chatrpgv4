"""What to have read by the time the party arrives.

Reading the book up front was measured and rejected -- hours before anyone sits
down. Reading only where the party stands stalls the table for as long as a
section takes, twenty minutes on a real one. So the queue reads one move ahead,
and one move means two different things depending on where the party is: along
the exits the Keeper can offer, and on foot to a place that adjoins this one.

The second is not a nicety. Measured on a real eleven-section graph, every
cross-section warm target came through a connected place and none through a
scene exit, because exits are written inside the section that owns both ends.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
sys.path.insert(0, str(SCRIPTS))
_spec = importlib.util.spec_from_file_location(
    "coc_module_read_ahead_test", SCRIPTS / "coc_module_read_ahead.py"
)
ra = importlib.util.module_from_spec(_spec)
sys.modules["coc_module_read_ahead_test"] = ra
_spec.loader.exec_module(ra)

PLAN = {"sections": [
    {"section_id": "chapter-one", "pdf_index_start": 0, "pdf_index_end": 9},
    {"section_id": "chapter-two", "pdf_index_start": 10, "pdf_index_end": 19},
    {"section_id": "chapter-three", "pdf_index_start": 20, "pdf_index_end": 29},
]}


def _node(node_id, kind, page, name=None):
    return {"node_id": node_id, "node_kind": kind, "name": name or node_id,
            "evidence_span_ids": [f"span-page-{page}-block-1"]}


def _rel(kind, source, target):
    return {"relation_id": f"rel-{source}-{target}", "relation_kind": kind,
            "from_node_id": source, "to_node_id": target}


def test_a_node_belongs_to_the_section_whose_pages_hold_it():
    """By page, because the merged graph keeps no membership map."""
    assert ra.section_of_node(_node("scene-a", "scene", 3), PLAN) == "chapter-one"
    assert ra.section_of_node(_node("scene-b", "scene", 25), PLAN) == "chapter-three"
    assert ra.section_of_node({"evidence_span_ids": []}, PLAN) is None
    assert ra.section_of_node(_node("scene-c", "scene", 99), PLAN) is None


def test_an_exit_into_another_section_is_warmed():
    graph = {"nodes": [_node("scene-a", "scene", 3), _node("scene-b", "scene", 15)],
             "relations": [_rel("may-lead-to", "scene-a", "scene-b")]}
    out = ra.warm_targets(graph, PLAN, "scene-a")
    assert out["here"] == "chapter-one"
    assert out["warm"] == ["chapter-two"]
    assert "exit" in out["basis"][0]["why"]


def test_a_place_that_adjoins_this_one_is_warmed_too():
    """The book's next chapter is what a reader does next; a party at a
    location walks to a connected location, which may be printed forty pages
    away. Both answers are needed and only the position says which."""
    graph = {"nodes": [
        _node("scene-a", "scene", 3), _node("location-here", "location", 3),
        _node("location-there", "location", 25), _node("scene-far", "scene", 25),
    ], "relations": [
        _rel("occurs-at", "scene-a", "location-here"),
        _rel("adjacent-to", "location-here", "location-there"),
        _rel("occurs-at", "scene-far", "location-there"),
    ]}
    out = ra.warm_targets(graph, PLAN, "scene-a")
    assert out["warm"] == ["chapter-three"]
    assert "connected place" in out["basis"][0]["why"]


def test_a_route_is_walked_in_both_directions():
    """A room is inside a building and a building holds its rooms; a party can
    move either way, so `located-in` is followed either way."""
    graph = {"nodes": [
        _node("scene-a", "scene", 3), _node("location-room", "location", 3),
        _node("location-house", "location", 25),
    ], "relations": [
        _rel("occurs-at", "scene-a", "location-room"),
        _rel("located-in", "location-room", "location-house"),
    ]}
    assert ra.warm_targets(graph, PLAN, "scene-a")["warm"] == ["chapter-three"]

    inward = {"nodes": graph["nodes"], "relations": [
        _rel("occurs-at", "scene-a", "location-room"),
        _rel("located-in", "location-house", "location-room"),
    ]}
    assert ra.warm_targets(inward, PLAN, "scene-a")["warm"] == ["chapter-three"]


def test_the_section_the_party_is_already_in_is_never_warmed():
    graph = {"nodes": [_node("scene-a", "scene", 3), _node("scene-b", "scene", 8)],
             "relations": [_rel("may-lead-to", "scene-a", "scene-b")]}
    assert ra.warm_targets(graph, PLAN, "scene-a")["warm"] == []


def test_a_section_already_read_is_not_warmed_again():
    graph = {"nodes": [_node("scene-a", "scene", 3), _node("scene-b", "scene", 15)],
             "relations": [_rel("may-lead-to", "scene-a", "scene-b")]}
    out = ra.warm_targets(graph, PLAN, "scene-a", read_sections={"chapter-two"})
    assert out["warm"] == []
    assert "still unread" in out["reason"]


def test_only_one_move_is_warmed():
    """Two moves away is not warmed: the party has a section's worth of play
    before it gets there, which is the whole budget this buys."""
    graph = {"nodes": [
        _node("scene-a", "scene", 3), _node("scene-b", "scene", 15),
        _node("scene-c", "scene", 25),
    ], "relations": [
        _rel("may-lead-to", "scene-a", "scene-b"),
        _rel("may-lead-to", "scene-b", "scene-c"),
    ]}
    assert ra.warm_targets(graph, PLAN, "scene-a")["warm"] == ["chapter-two"]


def test_each_target_says_why_and_through_what():
    """A queue that warmed the wrong thing has to be answerable."""
    graph = {"nodes": [_node("scene-a", "scene", 3),
                       _node("scene-b", "scene", 15, name="码头")],
             "relations": [_rel("may-lead-to", "scene-a", "scene-b")]}
    row = ra.warm_targets(graph, PLAN, "scene-a")["basis"][0]
    assert row["via"] == "scene-b" and row["name"] == "码头"


def test_standing_nowhere_in_this_graph_says_so():
    out = ra.warm_targets({"nodes": [], "relations": []}, PLAN, "scene-ghost")
    assert out["here"] is None and out["warm"] == []
    assert "not a node" in out["reason"]
