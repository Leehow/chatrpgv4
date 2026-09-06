"""Whether an assembled module graph can be played (contract §14.3, template v1).

Two layers: the ten invariants from `module-graph-template-v1.json` (structural,
must all hold), and the measures (reported, never thresholded). An invariant
asks that something be *accounted for*: a book with no ending answers with an
explicit empty `ending_scene_ids`; what is refused is silence.

Judged the way this kernel plays the graph, not the way the old projection did:

- the walkable graph is the `scene` nodes (what `ModuleGraph.scene()` and `apply move`
  resolve; the template's four kinds were the old projection's), and exits are
  `route-to` plus the template's entrance kinds and a scene record's `scene_edges`
  (what `ModuleGraph.scene_exits` walks);
- a `beat` whose record names a `scene_id` is a pacing note on that scene (what
  `ModuleGraph.scene_beat` reads); it travels with the scene into the opening
  neighbourhood and is not a place;
- an entrance is `entry_scene_ids` (graph or module node), `properties.is_entrance`,
  or the record's `is_start` (what `ModuleGraph.start_scene` reads); an ending is
  an `ending` node, `ending_scene_ids`, `properties.is_ending`, or the record's
  `is_final`;
- a clue is placed by `discoverable-at` or a scene record's `available_clues`; an
  actor by `present-in` or a scene record's `npc_ids`;
- a node has a page when any span, source_ref or property names one; a module with no
  source document says so with `unpaged: true` (graph level or module node), which is
  the account `node_without_page` asks for."""

from __future__ import annotations

import copy
from collections import Counter, defaultdict
from typing import Any

from ..module_graph import record_of
from ..text import strip_prefix
from .contract import (ACTOR_KINDS, EXIT_RELATION_KINDS, INVARIANTS, MEASURES,
                       SUBSTANTIVE_SPAN_CHARS, WALKABLE_KINDS)
from .store import node_pages


def _finding(code: str, subject: str, detail: str) -> dict[str, str]:
    return {"code": code, "subject": subject, "message": INVARIANTS[code]["asks"], "detail": detail}


def _nodes(graph: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {str(n["node_id"]): n for n in graph.get("nodes") or []
            if isinstance(n, dict) and isinstance(n.get("node_id"), str)}


def _by_kind(nodes: dict[str, dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    out: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for node in nodes.values():
        out[str(node.get("node_kind"))].append(node)
    return out


def _rel_by_kind(graph: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    out: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for rel in graph.get("relations") or []:
        if isinstance(rel, dict):
            out[str(rel.get("relation_kind"))].append(rel)
    return out


def _module_node(nodes: dict[str, dict[str, Any]]) -> dict[str, Any] | None:
    for node in nodes.values():
        if node.get("node_kind") == "module":
            return node
    return None


def _declaration(graph: dict[str, Any], key: str) -> list[str] | None:
    """`entry_scene_ids` / `ending_scene_ids` at graph level or on the module node; a
    list (even empty) is a declaration, absence is silence."""
    value = graph.get(key)
    if isinstance(value, list):
        return [str(v) for v in value]
    module = _module_node(_nodes(graph))
    if module is not None:
        props = module.get("properties") or {}
        value = props.get(key)
        if isinstance(value, list):
            return [str(v) for v in value]
    return None


def _flag(graph: dict[str, Any], key: str) -> bool:
    """A boolean declared at graph level or on the module node's properties."""
    if graph.get(key) is True:
        return True
    module = _module_node(_nodes(graph))
    return bool(module is not None and (module.get("properties") or {}).get(key) is True)


def handle_of(node: dict[str, Any]) -> str:
    record = record_of(node)
    if node.get("node_kind") == "scene" and isinstance(record.get("scene_id"), str):
        return record["scene_id"]
    return strip_prefix(str(node["node_id"]), str(node.get("node_kind")))


def entrances(graph: dict[str, Any], scenes: set[str]) -> set[str]:
    declared = _declaration(graph, "entry_scene_ids")
    nodes = _nodes(graph)
    if declared is not None:
        found = set()
        by_handle = {handle_of(nodes[s]): s for s in scenes}
        for value in declared:
            if value in scenes:
                found.add(value)
            elif value in by_handle:
                found.add(by_handle[value])
        return found
    found = set()
    for scene_id in scenes:
        node = nodes[scene_id]
        props = node.get("properties") or {}
        if props.get("is_entrance") is True or props.get("is_start") is True \
                or record_of(node).get("is_start") is True:
            found.add(scene_id)
    return found


def endings(graph: dict[str, Any], nodes: dict[str, dict[str, Any]]) -> tuple[set[str], bool]:
    """(ending node ids, accounted) — accounted is True when the book explicitly names none."""
    found = {nid for nid, n in nodes.items() if n.get("node_kind") == "ending"}
    for nid, node in nodes.items():
        props = node.get("properties") or {}
        if props.get("is_ending") is True or props.get("is_final") is True \
                or record_of(node).get("is_final") is True:
            found.add(nid)
    declared = _declaration(graph, "ending_scene_ids")
    if declared is not None:
        found.update(v for v in declared if v in nodes)
        return found, True
    return found, False


def scene_edges(graph: dict[str, Any], nodes: dict[str, dict[str, Any]], scenes: set[str]) -> list[tuple[str, str]]:
    """Directed exits between playable nodes: exit relations plus record scene_edges."""
    rel_by_kind = _rel_by_kind(graph)
    exits: list[tuple[str, str]] = []
    for kind in EXIT_RELATION_KINDS:
        for rel in rel_by_kind.get(kind, []):
            source, target = rel.get("from_node_id"), rel.get("to_node_id")
            if source in scenes and target in scenes:
                exits.append((str(source), str(target)))
    by_handle = {handle_of(nodes[s]): s for s in scenes}
    for scene_id in scenes:
        for edge in record_of(nodes[scene_id]).get("scene_edges") or []:
            to = edge.get("to") if isinstance(edge, dict) else None
            target = by_handle.get(to) if isinstance(to, str) else None
            if target and (scene_id, target) not in exits:
                exits.append((scene_id, target))
    return exits


def _components(scenes: set[str], undirected: dict[str, set[str]]) -> list[set[str]]:
    seen: set[str] = set()
    out: list[set[str]] = []
    for scene in sorted(scenes):
        if scene in seen:
            continue
        stack, component = [scene], set()
        while stack:
            current = stack.pop()
            if current in component:
                continue
            component.add(current)
            stack.extend(undirected.get(current, ()))
        seen |= component
        out.append(component)
    return out


def check(graph: Any, *, evidence_total: int | None = None,
          evidence_texts: dict[str, str] | None = None) -> dict[str, Any]:
    """Invariant findings and measures for one module graph."""
    if not isinstance(graph, dict):
        return {"status": "findings", "findings": [{"code": "invalid_graph", "subject": "/",
                                                    "message": "a module graph must be an object",
                                                    "detail": type(graph).__name__}],
                "finding_counts": {"invalid_graph": 1}, "measures": {}}
    nodes = _nodes(graph)
    by_kind = _by_kind(nodes)
    rel_by_kind = _rel_by_kind(graph)
    scenes = {nid for nid, n in nodes.items() if n.get("node_kind") in WALKABLE_KINDS}
    findings: list[dict[str, str]] = []

    for rel in graph.get("relations") or []:
        if not isinstance(rel, dict):
            continue
        for end in ("from_node_id", "to_node_id"):
            if rel.get(end) not in nodes:
                findings.append(_finding("dangling_relation", str(rel.get("relation_id") or "?"),
                                         f"{end} = {rel.get(end)!r} is not a node this graph defines"))

    exits = scene_edges(graph, nodes, scenes)
    forward: dict[str, set[str]] = defaultdict(set)
    undirected: dict[str, set[str]] = defaultdict(set)
    for source, target in exits:
        forward[source].add(target)
        undirected[source].add(target)
        undirected[target].add(source)

    components = _components(scenes, undirected)
    declared_entrances = entrances(graph, scenes)
    entry_declaration = _declaration(graph, "entry_scene_ids")
    if scenes and not declared_entrances and entry_declaration is None:
        findings.append(_finding("no_entrance_declared", "/",
                                 "no entry_scene_ids, no scene marked is_entrance/is_start, and no "
                                 "explicit empty entry_scene_ids saying the book names none"))
    if len(components) > 1:
        largest = max(components, key=len)
        for component in sorted(components, key=lambda c: (-len(c), sorted(c))):
            if component is largest:
                continue
            findings.append(_finding("scene_graph_fragmented", sorted(component)[0],
                                     f"{len(component)} scene(s) joined to no exit chain that reaches "
                                     f"the main body of {len(largest)}: " + ", ".join(sorted(component)[:6])))
    if declared_entrances:
        reached: set[str] = set()
        stack = list(declared_entrances)
        while stack:
            scene = stack.pop()
            if scene in reached:
                continue
            reached.add(scene)
            stack.extend(forward.get(scene, ()))
        for scene in sorted(scenes - reached):
            findings.append(_finding("scene_unreachable_from_entrance", scene,
                                     "exits exist, but none of them lead here from an entrance"))

    ending_ids, endings_accounted = endings(graph, nodes)
    if not ending_ids and not endings_accounted:
        findings.append(_finding("no_ending_declared", "/",
                                 "no ending node, no scene marked is_final/is_ending, and no explicit "
                                 "empty ending_scene_ids saying the book states none"))

    supports = rel_by_kind.get("supports", [])
    clues = {n["node_id"] for n in by_kind.get("clue", [])}
    conclusions = {n["node_id"] for n in by_kind.get("conclusion", [])}
    supporting = {str(r.get("from_node_id")) for r in supports}
    supported = {str(r.get("to_node_id")) for r in supports}
    for clue in sorted(clues - supporting):
        findings.append(_finding("clue_supports_nothing", clue, "no supports relation leaves this clue"))
    for conclusion in sorted(conclusions - supported):
        findings.append(_finding("conclusion_without_support", conclusion, "no supports relation arrives here"))

    placed = {str(r.get("from_node_id")) for r in rel_by_kind.get("discoverable-at", [])}
    present = {str(r.get("from_node_id")) for r in rel_by_kind.get("present-in", [])}
    for scene_id in scenes:
        record = record_of(nodes[scene_id])
        placed.update(str(c) for c in (record.get("available_clues") or []))
        present.update(str(a) for a in (record.get("npc_ids") or []))
    for clue in sorted(clues - placed):
        findings.append(_finding("clue_nowhere_to_find", clue, "no discoverable-at relation places it in a scene"))
    for kind in ACTOR_KINDS:
        for node in by_kind.get(kind, []):
            if node["node_id"] not in present:
                findings.append(_finding("actor_in_no_scene", node["node_id"],
                                         f"no present-in relation puts this {kind} in a scene"))

    cited: set[str] = set()
    for collection in ("nodes", "claims"):
        for row in graph.get(collection) or []:
            if isinstance(row, dict):
                cited.update(s for s in (row.get("evidence_span_ids") or []) if isinstance(s, str))
    # `unpaged: true` (graph level or module node) is the account a module with no source
    # document gives: there are no pages to cite, and the invariant asks for an account,
    # not for a particular thing to exist. A module with pages must cite them.
    unpaged = _flag(graph, "unpaged")
    pages: set[int] = set()
    for node in nodes.values():
        node_page_set = node_pages(node)
        if not node_page_set and not unpaged:
            findings.append(_finding("node_without_page", node["node_id"],
                                     "cites no span, source_ref or property that names a page"))
        pages.update(node_page_set)

    measures: dict[str, Any] = {code: None for code in MEASURES}
    measures.update({
        "nodes": len(nodes),
        "relations": len(graph.get("relations") or []),
        "scenes": len(scenes),
        "scene_exits": len(exits),
        "scene_components": len(components),
        "largest_component": max((len(c) for c in components), default=0),
        "branches": sum(1 for s in scenes if len(forward.get(s, ())) > 1),
        "npcs": len(by_kind.get("npc", [])),
        # §17.2: who the book gave nothing to play — no dossier key and no dossier claim.
        # Reported, never thresholded: a one-scene handout may legitimately have none.
        "npcs_without_material": len(_npcs_without_material(graph, nodes, by_kind)),
        "creatures": len(by_kind.get("creature", [])),
        "clues": len(clues),
        "conclusions": len(conclusions),
        "endings": len(ending_ids),
        "rules": len(by_kind.get("rule", [])),
        "pages_covered": len(pages),
    })
    if evidence_total:
        measures["span_consumption"] = round(len(cited) / evidence_total, 4)
    if evidence_texts:
        measures["substantive_spans_uncited"] = sum(
            1 for span_id, text in evidence_texts.items()
            if span_id not in cited and len(text) >= SUBSTANTIVE_SPAN_CHARS)
    counts = Counter(f["code"] for f in findings)
    return {"status": "playable" if not findings else "findings", "findings": findings,
            "finding_counts": dict(sorted(counts.items())), "measures": measures}


#: §17.2: the dossier keys and claim predicates that make an NPC playable at the table.
NPC_PROFILE_KEYS = ("agenda", "fear", "secret", "voice", "relationship_to_investigators")
NPC_DOSSIER_PREDICATES = ("knows", "believes", "asserts", "hides")


def npcs_without_material(graph: dict[str, Any]) -> list[str]:
    """§17.2 / §14.3: the npc node ids the book left as a stat block — nothing they want,
    fear, hide, know or would say. The brief names them; nothing fails because of them."""
    nodes = _nodes(graph)
    return _npcs_without_material(graph, nodes, _by_kind(nodes))


def _npcs_without_material(graph: dict[str, Any], nodes: dict[str, Any],
                           by_kind: dict[str, list[Any]]) -> list[str]:
    with_claims = {str(c.get("subject_id")) for c in graph.get("claims") or []
                   if isinstance(c, dict) and c.get("predicate") in NPC_DOSSIER_PREDICATES}
    bare: list[str] = []
    for node in by_kind.get("npc", []):
        node_id = node.get("node_id") if isinstance(node, dict) else None
        if not isinstance(node_id, str):
            continue
        props = node.get("properties") or {}
        record = (props.get("runtime_projection") or {}).get("record") or {}
        has_key = any(str(props.get(k) or record.get(k) or "").strip() for k in NPC_PROFILE_KEYS)
        if not has_key and node_id not in with_claims and not record.get("facts"):
            bare.append(node_id)
    return sorted(bare)


def opening_subgraph(graph: dict[str, Any]) -> tuple[dict[str, Any] | None, list[str], str | None]:
    """The start scene's neighbourhood (§14.3): module node, start scene, the scenes its
    exits point to, its NPCs, its clues and the conclusions they support. Returns the
    induced subgraph (or None), what is missing, and the start scene id."""
    nodes = _nodes(graph)
    missing: list[str] = []
    module = _module_node(nodes)
    if module is None:
        missing.append("module_node")
    scenes = {nid for nid, n in nodes.items() if n.get("node_kind") in WALKABLE_KINDS}
    starts = sorted(entrances(graph, scenes))
    if len(starts) != 1:
        missing.append("start_scene" if not starts else f"start_scene_ambiguous:{','.join(starts)}")
        return None, missing, None
    start = starts[0]
    keep: set[str] = {start}
    if module is not None:
        keep.add(str(module["node_id"]))
    rel_by_kind = _rel_by_kind(graph)
    for kind in EXIT_RELATION_KINDS:
        for rel in rel_by_kind.get(kind, []):
            if rel.get("from_node_id") == start:
                target = rel.get("to_node_id")
                if target in nodes:
                    keep.add(str(target))
                else:
                    missing.append(f"exit:{target}")
    by_handle = {handle_of(nodes[s]): s for s in scenes}
    record = record_of(nodes[start])
    for edge in record.get("scene_edges") or []:
        to = edge.get("to") if isinstance(edge, dict) else None
        if isinstance(to, str):
            if to in by_handle:
                keep.add(by_handle[to])
            else:
                missing.append(f"exit:{to}")
    for rel in rel_by_kind.get("present-in", []) + rel_by_kind.get("discoverable-at", []):
        if rel.get("to_node_id") == start and rel.get("from_node_id") in nodes:
            keep.add(str(rel["from_node_id"]))
    for key in ("npc_ids", "available_clues"):
        for nid in record.get(key) or []:
            if nid in nodes:
                keep.add(str(nid))
            else:
                missing.append(f"{key}:{nid}")
    for rel in rel_by_kind.get("supports", []):
        if rel.get("from_node_id") in keep and rel.get("to_node_id") in nodes:
            keep.add(str(rel["to_node_id"]))
    sub = {
        "contract_id": graph.get("contract_id"),
        "schema_version": graph.get("schema_version"),
        "module_id": graph.get("module_id"),
        "nodes": [copy.deepcopy(nodes[nid]) for nid in sorted(keep)],
        "claims": [c for c in graph.get("claims") or []
                   if isinstance(c, dict) and c.get("subject_id") in keep
                   and isinstance(c.get("object"), dict) and c["object"].get("node_id") in keep],
        "relations": [r for r in graph.get("relations") or []
                      if isinstance(r, dict) and r.get("from_node_id") in keep and r.get("to_node_id") in keep],
        "entry_scene_ids": [start],
    }
    # The account is a whole-book statement; the ending node itself may live in a section
    # not yet read. Carry the declaration, not the node.
    ending_ids, accounted = endings(graph, nodes)
    if ending_ids or accounted:
        sub["ending_scene_ids"] = sorted(ending_ids)
    return sub, missing, start


def opening_check(graph: dict[str, Any]) -> dict[str, Any]:
    sub, missing, start = opening_subgraph(graph)
    if sub is None:
        return {"opening_ready": False, "start_scene": start, "missing": missing, "findings": [],
                "finding_counts": {}}
    report = check(sub)
    findings = list(report["findings"])
    ready = not missing and not findings
    return {"opening_ready": ready, "start_scene": start, "missing": missing, "findings": findings,
            "finding_counts": report["finding_counts"], "nodes": len(sub["nodes"])}
