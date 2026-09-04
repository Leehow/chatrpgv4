"""The standard that decides whether an assembled graph can be played.

Each case is a defect the standard was written because a real build had it,
and none of the per-section gates could see: they judge one shard against the
contract, and the contract is a vocabulary.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
sys.path.insert(0, str(SCRIPTS))
_spec = importlib.util.spec_from_file_location(
    "coc_module_graph_template_test", SCRIPTS / "coc_module_graph_template.py"
)
template = importlib.util.module_from_spec(_spec)
sys.modules["coc_module_graph_template_test"] = template
_spec.loader.exec_module(template)

SPAN = "span-page-1-block-1"


def _node(node_id, kind="scene", **properties):
    return {"node_id": node_id, "node_kind": kind, "name": node_id,
            "visibility": "keeper-only", "aliases": [], "summary": "",
            "evidence_span_ids": [SPAN], "properties": properties}


def _rel(source, target, kind="may-lead-to"):
    return {"relation_id": f"rel-{source}-{target}", "relation_kind": kind,
            "from_node_id": source, "to_node_id": target,
            "claim_id": f"claim-{source}-{target}", "properties": {}}


def _graph(nodes, relations, **extra):
    graph = {"nodes": nodes, "relations": relations, "claims": []}
    graph.update(extra)
    return graph


def _playable():
    return _graph(
        [_node("scene-a", is_entrance=True), _node("scene-b"),
         _node("ending-x", "ending")],
        [_rel("scene-a", "scene-b")],
    )


def _codes(graph, **kwargs):
    return template.check(graph, **kwargs)["finding_counts"]


def test_a_sound_graph_is_playable():
    """The standard has to be reachable, or it is only a way to fail."""
    result = template.check(_playable())
    assert result["status"] == "playable"
    assert result["findings"] == []


def test_a_scene_graph_in_pieces_is_named_piece_by_piece():
    """Twenty-six scenes in eight pieces passed every per-section gate."""
    graph = _playable()
    graph["nodes"] += [_node("scene-island-1"), _node("scene-island-2")]
    graph["relations"].append(_rel("scene-island-1", "scene-island-2"))
    result = template.check(graph)
    assert result["finding_counts"]["scene_graph_fragmented"] == 1
    assert result["measures"]["scene_components"] == 2
    assert result["measures"]["largest_component"] == 2
    assert "scene-island-1" in result["findings"][0]["detail"]


def test_reachability_is_not_rooted_at_whatever_has_no_way_in():
    """The first draft did exactly that, and eight fragments passed: every
    piece gets a root of its own, so everything is trivially reachable."""
    graph = _playable()
    graph["nodes"].append(_node("scene-orphan"))
    assert "scene_graph_fragmented" in _codes(graph)


def test_direction_is_checked_once_an_entrance_is_declared():
    graph = _graph(
        [_node("scene-a", is_entrance=True), _node("scene-b"),
         _node("ending-x", "ending")],
        [_rel("scene-b", "scene-a")],       # b leads to a, never the other way
    )
    assert _codes(graph).get("scene_unreachable_from_entrance") == 1


def test_no_entrance_reports_the_cause_and_not_one_finding_per_scene():
    """One root cause, one finding. Checking forward reachability with no
    entrance declared makes every scene unreachable, and the report that comes
    back is N copies of a symptom with the cause buried among them."""
    graph = _graph(
        [_node("scene-a"), _node("scene-b"), _node("scene-c"),
         _node("ending-x", "ending")],
        [_rel("scene-a", "scene-b"), _rel("scene-b", "scene-c")],
    )
    counts = _codes(graph)
    assert counts.get("no_entrance_declared") == 1
    assert "scene_unreachable_from_entrance" not in counts, (
        "direction was judged with nowhere declared to start from"
    )


def test_a_graph_that_declares_no_entrance_is_refused():
    graph = _graph([_node("scene-a"), _node("ending-x", "ending")], [])
    assert "no_entrance_declared" in _codes(graph)


def test_an_explicit_empty_entry_list_is_an_answer():
    """Accounting, not content: a book that names no entrance says so."""
    graph = _graph([_node("scene-a"), _node("ending-x", "ending")], [],
                   entry_scene_ids=[])
    assert "no_entrance_declared" not in _codes(graph)


def test_coverage_is_not_an_account():
    """A merged graph says `partial` about nearly every domain, so reading an
    account out of coverage leaves a door that is always open -- which is how
    the first draft went silent on a graph declaring no entrance at all."""
    graph = _graph([_node("scene-a"), _node("ending-x", "ending")], [],
                   coverage={"structure": "partial"})
    assert "no_entrance_declared" in _codes(graph)


def test_a_clue_that_answers_nothing_is_named():
    graph = _playable()
    graph["nodes"].append(_node("clue-footprint", "clue"))
    graph["relations"].append(_rel("clue-footprint", "scene-a", "discoverable-at"))
    assert _codes(graph).get("clue_supports_nothing") == 1


def test_a_clue_no_scene_holds_is_named():
    graph = _playable()
    graph["nodes"] += [_node("clue-footprint", "clue"),
                       _node("conclusion-who", "conclusion")]
    graph["relations"].append(_rel("clue-footprint", "conclusion-who", "supports"))
    assert _codes(graph).get("clue_nowhere_to_find") == 1


def test_a_conclusion_nothing_supports_is_named():
    graph = _playable()
    graph["nodes"].append(_node("conclusion-who", "conclusion"))
    assert _codes(graph).get("conclusion_without_support") == 1


def test_an_actor_no_scene_contains_is_named():
    """Twelve of twenty-two on a real build; an actor nothing holds is unmeetable."""
    graph = _playable()
    graph["nodes"] += [_node("npc-kloppe", "npc"), _node("creature-spawn", "creature")]
    assert _codes(graph).get("actor_in_no_scene") == 2


def test_an_actor_placed_in_a_scene_passes():
    graph = _playable()
    graph["nodes"].append(_node("npc-kloppe", "npc"))
    graph["relations"].append(_rel("npc-kloppe", "scene-a", "present-in"))
    assert "actor_in_no_scene" not in _codes(graph)


def test_a_node_with_no_page_is_named():
    graph = _playable()
    graph["nodes"].append({**_node("scene-c"), "evidence_span_ids": ["span-loose"]})
    assert _codes(graph).get("node_without_page") == 1


def test_a_relation_to_nothing_is_named():
    graph = _playable()
    graph["relations"].append(_rel("scene-a", "scene-missing"))
    assert _codes(graph).get("dangling_relation") == 1


def test_measures_are_reported_and_never_thresholded():
    """A one-scene handout has no branches and a campaign has forty; a floor
    that fits one calls the other broken."""
    result = template.check(_playable(), evidence_total=10)
    assert result["status"] == "playable"
    measures = result["measures"]
    assert measures["scenes"] == 2 and measures["endings"] == 1
    assert measures["span_consumption"] == 0.1
    declared = {row["code"] for row in template.TEMPLATE["measures"]}
    assert set(measures) <= declared, set(measures) - declared


def test_every_invariant_the_template_declares_can_fire():
    """A code in the template that no check emits is a promise nothing keeps."""
    emitted = set()
    for graph in (
        _graph([_node("scene-a", is_entrance=True), _node("ending-x", "ending")],
               [_rel("scene-a", "scene-missing")]),
        _graph([_node("scene-a"), _node("scene-b")], []),
        _graph([_node("scene-a", is_entrance=True), _node("scene-b"),
                _node("ending-x", "ending"), _node("clue-c", "clue"),
                _node("conclusion-d", "conclusion"), _node("npc-e", "npc"),
                {**_node("scene-f"), "evidence_span_ids": []}],
               [_rel("scene-a", "scene-b"), _rel("scene-b", "scene-a")]),
    ):
        emitted |= set(template.check(graph)["finding_counts"])
    declared = set(template.INVARIANTS)
    assert declared - emitted == set(), declared - emitted
