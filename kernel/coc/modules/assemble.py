"""Runtime scene projection and authored opening selection for published graphs."""
from __future__ import annotations
from typing import Any
from ..module_graph import record_of
from ..text import normalize as normalize_name
from .contract import WALKABLE_KINDS
from .playability import handle_of, start_scene_candidates


def _project_scene_records(nodes: dict[str, dict[str, Any]], relations: dict[str, dict[str, Any]]) -> None:
    """The minimal record `ModuleGraph` reads for a scene: scene_id, display_name,
    is_start, is_final — nothing the reader did not say."""
    for node in nodes.values():
        if node.get("node_kind") != "scene":
            continue
        props = node.setdefault("properties", {})
        existing = (props.get("runtime_projection") or {}).get("record")
        record = {
            "scene_id": handle_of(node),
            "display_name": node.get("name"),
            "is_start": False,
            "is_final": False,
            **(existing if isinstance(existing, dict) else {}),
            **{k: v for k, v in props.items() if k != "runtime_projection"},
        }
        if "is_entrance" in props or "is_start" in props:
            record["is_start"] = bool(props.get("is_entrance") is True or props.get("is_start") is True)
        if "is_ending" in props or "is_final" in props:
            record["is_final"] = bool(props.get("is_ending") is True or props.get("is_final") is True)
        props["runtime_projection"] = {"document": "story-graph.json", "collection": "scenes",
                                       "record": record}


def resolve_start_scene(graph: dict[str, Any], wanted: str) -> str | None:
    """Which declared opening the given word means: node id, scene handle or name, folded
    the way the rest of the kernel folds names. Only the book's own candidates can be
    named — the choice settles an ambiguity, it does not invent an entrance."""
    asked = normalize_name(wanted)
    for candidate in start_scene_candidates(graph):
        if asked in {normalize_name(candidate["node_id"]), normalize_name(candidate["scene"]),
                     normalize_name(candidate["name"])}:
            return candidate["node_id"]
    return None


def apply_opening_choice(graph: dict[str, Any], chosen: str) -> bool:
    """Write a settled start scene into the graph (§14.14).

    Two machine-owned places carry it: the graph-level `entry_scene_ids` declaration the
    playability check reads, and each scene's projected `record.is_start`, which is what
    `ModuleGraph.start_scene()` walks. What the book itself says about the scenes
    (`properties.is_entrance`) is evidence and is left exactly as the reader wrote it."""
    nodes = {str(n["node_id"]): n for n in graph.get("nodes") or []
             if isinstance(n, dict) and isinstance(n.get("node_id"), str)}
    node = nodes.get(chosen)
    if node is None or node.get("node_kind") not in WALKABLE_KINDS:
        return False
    for candidate in start_scene_candidates(graph):
        nodes[candidate["node_id"]].setdefault("properties", {})["is_entrance"] = True
    graph["entry_scene_ids"] = [chosen]
    for other in nodes.values():
        if other.get("node_kind") != "scene":
            continue
        record = record_of(other)
        if not record:
            continue
        record["is_start"] = other is node
    return True
