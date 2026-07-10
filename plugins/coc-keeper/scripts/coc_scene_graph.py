#!/usr/bin/env python3
"""Scene graph substrate: scene_edges, unlock model, transition candidates.

R-3 (C1/C2/C3): story progression is a real graph, not array order.

- Scenes may declare ``scene_edges: [{to, when, kind}]`` where ``when`` reuses
  ``coc_exit_conditions`` structured vocabulary.
- Graphs without any ``scene_edges`` keep legacy linear behavior via derived
  edges marked ``legacy: True`` (array order as implicit travel edges).
- World-state tracks ``unlocked_scene_ids`` / ``visited_scene_ids`` /
  ``exhausted_scene_ids`` / ``scene_history``.
- CUT is cinematic travel among already-unlocked reachable targets — never an
  unlock mechanism.

Semantic Matcher Constitution: no free-text keyword scanning.
"""
from __future__ import annotations

import importlib.util
from pathlib import Path
from typing import Any, Callable

_HERE = Path(__file__).resolve().parent


def _load_sibling(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, _HERE / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_exit_conditions = _load_sibling("coc_exit_conditions", "coc_exit_conditions.py")

SCENE_EDGE_KINDS = ("travel", "unlock", "cut")


def _scenes(story_graph: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not isinstance(story_graph, dict):
        return []
    return [s for s in (story_graph.get("scenes") or []) if isinstance(s, dict) and s.get("scene_id")]


def _scene_by_id(story_graph: dict[str, Any] | None, scene_id: str | None) -> dict[str, Any] | None:
    if not scene_id:
        return None
    for scene in _scenes(story_graph):
        if str(scene.get("scene_id")) == str(scene_id):
            return scene
    return None


def _graph_declares_scene_edges(story_graph: dict[str, Any] | None) -> bool:
    """True when any scene carries an explicit ``scene_edges`` list (even empty).

    Empty ``scene_edges: []`` on a scene is intentional (terminal / no outs).
    Legacy fallback only applies when *no* scene declares the field at all.
    """
    for scene in _scenes(story_graph):
        if "scene_edges" in scene:
            return True
    return False


def _normalize_edge(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    to = str(raw.get("to") or "").strip()
    if not to:
        return None
    kind = str(raw.get("kind") or "travel").strip()
    if kind not in SCENE_EDGE_KINDS:
        kind = "travel"
    when_raw = raw.get("when")
    if when_raw is None:
        when = {"kind": "always"}
    else:
        when = coc_exit_conditions.normalize_exit_condition(when_raw)
    edge: dict[str, Any] = {"to": to, "kind": kind, "when": when}
    if raw.get("legacy") is True:
        edge["legacy"] = True
    return edge


def derive_scene_edges(story_graph: dict[str, Any] | None) -> dict[str, list[dict[str, Any]]]:
    """Return ``{scene_id: [edge, ...]}``.

    Explicit ``scene_edges`` win. When the graph never declares the field,
    synthesize linear travel edges from array order (legacy).
    """
    scenes = _scenes(story_graph)
    out: dict[str, list[dict[str, Any]]] = {}
    if _graph_declares_scene_edges(story_graph):
        for scene in scenes:
            sid = str(scene["scene_id"])
            edges: list[dict[str, Any]] = []
            for raw in scene.get("scene_edges") or []:
                edge = _normalize_edge(raw)
                if edge is not None:
                    edges.append(edge)
            out[sid] = edges
        return out

    # LEGACY: array order as implicit linear travel edges (no unlock model).
    for i, scene in enumerate(scenes):
        sid = str(scene["scene_id"])
        if i + 1 < len(scenes):
            nxt = str(scenes[i + 1]["scene_id"])
            out[sid] = [
                {
                    "to": nxt,
                    "kind": "travel",
                    "when": {"kind": "always"},
                    "legacy": True,
                }
            ]
        else:
            out[sid] = []
    return out


def start_scene_id(story_graph: dict[str, Any] | None) -> str | None:
    scenes = _scenes(story_graph)
    for scene in scenes:
        if scene.get("is_start") is True:
            return str(scene["scene_id"])
    if scenes:
        return str(scenes[0]["scene_id"])
    return None


def ensure_world_scene_fields(
    world: dict[str, Any],
    story_graph: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Ensure unlock/visit/history lists exist; unlock start scene by default."""
    if not isinstance(world, dict):
        world = {}
    for key in (
        "unlocked_scene_ids",
        "visited_scene_ids",
        "exhausted_scene_ids",
        "scene_history",
    ):
        if not isinstance(world.get(key), list):
            world[key] = []

    start = start_scene_id(story_graph)
    active = world.get("active_scene_id")
    seed = start or (str(active) if active else None)
    unlocked = list(world["unlocked_scene_ids"])
    if seed and seed not in unlocked:
        unlocked.append(seed)
    # Active scene is always considered unlocked (resume safety).
    if active and str(active) not in unlocked:
        unlocked.append(str(active))
    world["unlocked_scene_ids"] = unlocked
    return world


def evaluate_edge_when(
    when: Any,
    *,
    discovered_clue_ids: set[str],
    clock_reached: Callable[[str | None, int], bool],
    flags_set: set[str] | None = None,
) -> bool:
    return coc_exit_conditions.evaluate_exit_condition(
        when,
        discovered_clue_ids=discovered_clue_ids,
        clock_reached=clock_reached,
        flags_set=flags_set,
    )


def evaluate_unlocks(
    story_graph: dict[str, Any] | None,
    world: dict[str, Any],
    *,
    discovered_clue_ids: set[str] | None = None,
    clock_reached: Callable[[str | None, int], bool] | None = None,
    flags_set: set[str] | None = None,
) -> list[str]:
    """Return newly unlocked scene ids (not yet in world.unlocked_scene_ids).

    Evaluates every ``kind=unlock`` edge (and travel edges whose ``when`` is
    already satisfied may also unlock their target so travel destinations
    become reachable once their gate opens). Unlock is additive and global.
    """
    world = ensure_world_scene_fields(world, story_graph)
    discovered = discovered_clue_ids
    if discovered is None:
        discovered = {str(c) for c in (world.get("discovered_clue_ids") or [])}
    if clock_reached is None:
        clock_reached = lambda _cid, _t: False  # noqa: E731
    flags = flags_set if flags_set is not None else set()

    already = {str(s) for s in world.get("unlocked_scene_ids") or []}
    newly: list[str] = []
    edges_by_scene = derive_scene_edges(story_graph)
    for _from_id, edges in edges_by_scene.items():
        for edge in edges:
            # Unlock edges always participate; travel/cut edges also unlock
            # their target when ``when`` is satisfied so the destination
            # becomes a legal CUT/travel candidate.
            if edge.get("kind") not in ("unlock", "travel", "cut"):
                continue
            if not evaluate_edge_when(
                edge.get("when"),
                discovered_clue_ids=discovered,
                clock_reached=clock_reached,
                flags_set=flags,
            ):
                continue
            target = str(edge["to"])
            if target not in already and target not in newly:
                newly.append(target)
    return newly


def apply_unlocks_to_world(
    world: dict[str, Any],
    newly: list[str],
) -> list[str]:
    """Mutate world unlocked list; return ids that were actually added."""
    ensure_world_scene_fields(world)
    unlocked = list(world.get("unlocked_scene_ids") or [])
    added: list[str] = []
    for sid in newly:
        if sid and sid not in unlocked:
            unlocked.append(sid)
            added.append(sid)
    world["unlocked_scene_ids"] = unlocked
    return added


def transition_candidates(
    from_scene_id: str | None,
    story_graph: dict[str, Any] | None,
    world: dict[str, Any],
) -> list[str]:
    """Unlocked, non-exhausted scenes reachable via edges from ``from_scene_id``.

    CUT/travel may only target these. Does not evaluate ``when`` again for
    travel — unlock evaluation already gated membership in unlocked_scene_ids;
    candidates further require an edge from the current scene.
    """
    if not from_scene_id:
        return []
    world = ensure_world_scene_fields(world, story_graph)
    unlocked = {str(s) for s in world.get("unlocked_scene_ids") or []}
    exhausted = {str(s) for s in world.get("exhausted_scene_ids") or []}
    edges = derive_scene_edges(story_graph).get(str(from_scene_id), [])
    out: list[str] = []
    seen: set[str] = set()
    for edge in edges:
        target = str(edge["to"])
        if target in seen:
            continue
        if target not in unlocked:
            continue
        if target in exhausted:
            continue
        seen.add(target)
        out.append(target)
    return out


def pick_transition_target(
    from_scene_id: str | None,
    story_graph: dict[str, Any] | None,
    world: dict[str, Any],
    *,
    requested: str | None = None,
    discovered_clue_ids: set[str] | None = None,
) -> str | None:
    """Choose a legal transition target.

    Prefer ``requested`` when it is among candidates. An explicit requested
    target that is *not* a candidate is refused (CUT cannot unlock). When no
    request is given, pick the first candidate that still has undiscovered
    clues (or any candidate).
    """
    candidates = transition_candidates(from_scene_id, story_graph, world)
    if not candidates:
        return None
    if requested:
        return requested if requested in candidates else None
    discovered = discovered_clue_ids
    if discovered is None:
        discovered = {str(c) for c in (world.get("discovered_clue_ids") or [])}
    for sid in candidates:
        scene = _scene_by_id(story_graph, sid)
        if scene is None:
            continue
        clues = scene.get("available_clues") or []
        if not clues or any(c not in discovered for c in clues):
            return sid
    return candidates[0]


def record_scene_enter(
    world: dict[str, Any],
    scene_id: str,
    *,
    decision_id: str | None = None,
    ts: str | None = None,
    mark_previous_exhausted: str | None = None,
) -> None:
    """Update visited/history (and optionally mark prior scene exhausted)."""
    ensure_world_scene_fields(world)
    sid = str(scene_id)
    visited = list(world.get("visited_scene_ids") or [])
    if sid not in visited:
        visited.append(sid)
    world["visited_scene_ids"] = visited
    unlocked = list(world.get("unlocked_scene_ids") or [])
    if sid not in unlocked:
        unlocked.append(sid)
    world["unlocked_scene_ids"] = unlocked
    history = list(world.get("scene_history") or [])
    entry: dict[str, Any] = {"scene_id": sid}
    if decision_id:
        entry["entered_at_decision_id"] = decision_id
    if ts:
        entry["ts"] = ts
    history.append(entry)
    world["scene_history"] = history
    if mark_previous_exhausted:
        exhausted = list(world.get("exhausted_scene_ids") or [])
        prev = str(mark_previous_exhausted)
        if prev and prev not in exhausted:
            exhausted.append(prev)
        world["exhausted_scene_ids"] = exhausted


def is_terminal_scene(
    scene: dict[str, Any] | None,
    story_graph: dict[str, Any] | None,
) -> bool:
    """Terminal = is_final / resolution / no outgoing edges (or legacy last)."""
    if not isinstance(scene, dict):
        return False
    if scene.get("is_final") is True:
        return True
    if str(scene.get("scene_type") or "") == "resolution":
        return True
    sid = scene.get("scene_id")
    if not sid:
        return False
    edges_map = derive_scene_edges(story_graph)
    outs = edges_map.get(str(sid), [])
    if _graph_declares_scene_edges(story_graph):
        return len(outs) == 0
    # LEGACY: last array entry is terminal when no explicit edges exist.
    scenes = _scenes(story_graph)
    if scenes and scenes[-1] is scene:
        return True
    if scenes and scenes[-1].get("scene_id") == sid:
        return True
    return len(outs) == 0


def outgoing_edge_count(scene_id: str, story_graph: dict[str, Any] | None) -> int:
    return len(derive_scene_edges(story_graph).get(str(scene_id), []))


__all__ = [
    "SCENE_EDGE_KINDS",
    "derive_scene_edges",
    "start_scene_id",
    "ensure_world_scene_fields",
    "evaluate_edge_when",
    "evaluate_unlocks",
    "apply_unlocks_to_world",
    "transition_candidates",
    "pick_transition_target",
    "record_scene_enter",
    "is_terminal_scene",
    "outgoing_edge_count",
]
