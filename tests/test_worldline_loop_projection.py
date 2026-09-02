"""A module that declares a loop must carry it, whatever it loops.

`resets-to` and `persists-across-loop` have been in the ModuleGraph contract
since v3 and nothing has ever produced or read them, so a module built entirely
on a time loop — 《不息的渴望》, whose own concept node carries a six-step
timeline ending in "时光圈重置" — projected no loop at all. At the table the
Keeper reached the reset, gestured at it in prose, and the system recorded
nothing: zero `timeline.*` calls, no fork, no ageing.

The carrying contract is deliberately empty of judgement. The relation kinds
have no domain or range, homebrew modules will carry things across a loop that
no one here would predict, and a fixed vocabulary of "what may persist" would
silently drop precisely the thing a given author cared about. So the projection
resolves endpoints to readable names and stops.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


projection = _load("coc_module_projection_loop_tests", SCRIPTS / "coc_module_projection.py")


def _graph(relations, nodes=None):
    return {
        "nodes": nodes if nodes is not None else [
            {"node_id": "concept-time-loop", "node_kind": "concept", "name": "时光圈"},
            {"node_id": "npc-sarah", "node_kind": "npc", "name": "莎拉"},
            {"node_id": "party-knowledge", "node_kind": "concept", "name": "调查员的记忆"},
            {"node_id": "homebrew-thing", "node_kind": "item", "name": "村规带过去的东西"},
        ],
        "relations": relations,
    }


def test_a_module_without_loop_edges_declares_nothing():
    assert projection.worldline_loop_edges(_graph([])) == []
    assert projection.worldline_loop_edges({"nodes": [], "relations": []}) == []


def test_the_authored_edges_come_through_verbatim():
    edges = projection.worldline_loop_edges(_graph([
        {"relation_kind": "resets-to", "from_node_id": "npc-sarah",
         "to_node_id": "concept-time-loop"},
        {"relation_kind": "persists-across-loop", "from_node_id": "party-knowledge",
         "to_node_id": "concept-time-loop"},
    ]))
    assert [row["relation"] for row in edges] == [
        "persists-across-loop", "resets-to",
    ]
    persists = edges[0]
    assert persists["from"] == {
        "node_id": "party-knowledge", "node_kind": "concept", "name": "调查员的记忆",
    }
    assert persists["to"]["node_id"] == "concept-time-loop"


def test_any_node_kind_may_cross_the_loop():
    """No vocabulary of our own: a homebrew module carries what it carries."""
    edges = projection.worldline_loop_edges(_graph([
        {"relation_kind": "persists-across-loop", "from_node_id": "homebrew-thing",
         "to_node_id": "concept-time-loop"},
    ]))
    assert edges[0]["from"]["node_kind"] == "item"
    assert edges[0]["from"]["name"] == "村规带过去的东西"


def test_direction_is_not_inferred():
    """The contract puts no domain or range on these kinds.

    Grouping or flipping an edge here would be this layer inventing a semantics
    the author never wrote, so both directions survive exactly as authored.
    """
    edges = projection.worldline_loop_edges(_graph([
        {"relation_kind": "resets-to", "from_node_id": "concept-time-loop",
         "to_node_id": "npc-sarah"},
    ]))
    assert edges[0]["from"]["node_id"] == "concept-time-loop"
    assert edges[0]["to"]["node_id"] == "npc-sarah"


def test_an_unknown_endpoint_still_reports_its_id():
    edges = projection.worldline_loop_edges(_graph([
        {"relation_kind": "resets-to", "from_node_id": "node-that-vanished",
         "to_node_id": "concept-time-loop"},
    ]))
    assert edges[0]["from"] == {
        "node_id": "node-that-vanished", "node_kind": "", "name": "",
    }


def test_other_relation_kinds_are_left_alone():
    edges = projection.worldline_loop_edges(_graph([
        {"relation_kind": "triggers", "from_node_id": "npc-sarah",
         "to_node_id": "concept-time-loop"},
    ]))
    assert edges == []


def test_the_block_appears_in_module_meta_only_when_declared():
    """And a module with no loop must not gain an empty shell."""
    source = (SCRIPTS / "coc_module_projection.py").read_text(encoding="utf-8")
    assert 'documents["module-meta.json"]["worldline_loop"]' in source
    assert "if loop_edges and" in source, (
        "a module without loop edges must project no block at all"
    )
