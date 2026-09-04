#!/usr/bin/env python3
"""Whether an assembled module graph can be played, as opposed to parsed.

The v3 contract is a vocabulary: which node kinds exist, how ids are spelled,
what shape a record takes. Three gates enforce it per section. Nothing ever
looked at the whole graph, and the failure that hides in that gap is quiet --
a build reporting every section accepted while five of twenty-six scenes sat
in pieces the Keeper had no move to reach.

Two layers, because modules differ too much for counts to be law. Invariants
are structural: properties any playable graph has whatever its size. Measures
are reported and never thresholded -- a one-scene handout has no branches and
a campaign has forty, and a floor that fits one calls the other broken.

Invariants ask that something be accounted for, not that a particular thing
exist. A book with no stated ending answers by saying so in coverage; what is
refused is silence.
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

_HERE = Path(__file__).resolve().parent
TEMPLATE_PATH = _HERE.parent / "references" / "module-graph-template-v1.json"
TEMPLATE = json.loads(TEMPLATE_PATH.read_text(encoding="utf-8"))
EXIT_KINDS = tuple(TEMPLATE["entrance_relation_kinds"])
ACTOR_KINDS = tuple(TEMPLATE["actor_kinds"])
INVARIANTS = {row["code"]: row for row in TEMPLATE["invariants"]}


def _finding(code: str, subject: str, detail: str) -> dict[str, str]:
    return {
        "code": code,
        "subject": subject,
        "message": INVARIANTS[code]["asks"],
        "detail": detail,
    }


def _nodes_by_kind(graph: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    by_kind: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for node in graph.get("nodes") or []:
        if isinstance(node, dict) and isinstance(node.get("node_id"), str):
            by_kind[str(node.get("node_kind"))].append(node)
    return by_kind


def _relations_by_kind(graph: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    by_kind: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for relation in graph.get("relations") or []:
        if isinstance(relation, dict):
            by_kind[str(relation.get("relation_kind"))].append(relation)
    return by_kind


def _accounted(graph: dict[str, Any], key: str) -> bool:
    """Whether the graph explicitly says this thing is absent from the book.

    Not read from `coverage`: a merged graph says `partial` about nearly every
    domain, because each section reviewed part of it, and treating `partial` as
    an account would leave a door that is always open -- the first draft of
    this check did exactly that, and both structural invariants went silent on
    a graph that declared no entrance at all.

    So the account has to be a statement about the thing itself: an explicit
    empty list under `entry_scene_ids` or `ending_scene_ids` says "the book
    names none", and its absence says nothing at all.
    """
    declared = graph.get(key)
    return isinstance(declared, list) and not declared


def _entrances(graph: dict[str, Any], scenes: set[str]) -> set[str]:
    """Scenes the graph names as where play begins.

    Two ways a graph can say it: an explicit `entry_scene_ids`, or scenes with
    no exit leading into them within a connected scene graph. Only the first is
    a declaration; the second is inference and is used for reachability, not
    for deciding whether an entrance was declared.
    """
    declared = graph.get("entry_scene_ids")
    if isinstance(declared, list):
        return {scene for scene in declared if scene in scenes}
    named: set[str] = set()
    for node in graph.get("nodes") or []:
        if not isinstance(node, dict) or node.get("node_id") not in scenes:
            continue
        properties = node.get("properties")
        if isinstance(properties, dict) and properties.get("is_entrance"):
            named.add(str(node["node_id"]))
    return named


def check(graph: Any, *, evidence_total: int | None = None) -> dict[str, Any]:
    """Invariant findings and measures for one assembled module graph."""
    if not isinstance(graph, dict):
        return {
            "status": "findings",
            "findings": [{"code": "invalid_graph", "subject": "/",
                          "message": "a module graph must be an object",
                          "detail": type(graph).__name__}],
            "measures": {},
        }

    by_kind = _nodes_by_kind(graph)
    rel_by_kind = _relations_by_kind(graph)
    node_ids = {
        node["node_id"] for nodes in by_kind.values() for node in nodes
    }
    scenes = {node["node_id"] for node in by_kind.get("scene", [])}
    findings: list[dict[str, str]] = []

    for relation in graph.get("relations") or []:
        if not isinstance(relation, dict):
            continue
        for end in ("from_node_id", "to_node_id"):
            target = relation.get(end)
            if target not in node_ids:
                findings.append(_finding(
                    "dangling_relation",
                    str(relation.get("relation_id") or "?"),
                    f"{end} = {target!r} is not a node this graph defines",
                ))

    # Scene reachability, from whatever the graph declares as its entrance and
    # otherwise from the scenes nothing leads into.
    exits: list[tuple[str, str]] = []
    for kind in EXIT_KINDS:
        for relation in rel_by_kind.get(kind, []):
            source, target = relation.get("from_node_id"), relation.get("to_node_id")
            if source in scenes and target in scenes:
                exits.append((str(source), str(target)))
    forward: dict[str, set[str]] = defaultdict(set)
    undirected: dict[str, set[str]] = defaultdict(set)
    for source, target in exits:
        forward[source].add(target)
        undirected[source].add(target)
        undirected[target].add(source)

    components = _components(scenes, undirected)
    declared_entrances = _entrances(graph, scenes)
    if scenes and not declared_entrances and not _accounted(graph, "entry_scene_ids"):
        findings.append(_finding(
            "no_entrance_declared", "/",
            "no entry_scene_ids, no scene marked is_entrance, and no explicit "
            "empty entry_scene_ids saying the book names none",
        ))

    # Fragmentation first, because it is what reachability was hiding. Rooting
    # a traversal at "scenes nothing leads into" gives every disconnected piece
    # a root of its own, so everything is reachable and eight fragments pass.
    if len(components) > 1:
        largest = max(components, key=len)
        for component in sorted(components, key=lambda c: (-len(c), sorted(c))):
            if component is largest:
                continue
            findings.append(_finding(
                "scene_graph_fragmented", sorted(component)[0],
                f"{len(component)} scene(s) joined to no exit chain that "
                f"reaches the main body of {len(largest)}: "
                + ", ".join(sorted(component)[:6]),
            ))

    # Direction matters only once somebody has said where play starts.
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
            findings.append(_finding(
                "scene_unreachable_from_entrance", scene,
                "exits exist, but none of them lead here from an entrance",
            ))

    if not by_kind.get("ending") and not _accounted(graph, "ending_scene_ids"):
        findings.append(_finding(
            "no_ending_declared", "/",
            "no ending node, and no explicit empty ending_scene_ids saying "
            "the book states none",
        ))

    supports = rel_by_kind.get("supports", [])
    conclusions = {node["node_id"] for node in by_kind.get("conclusion", [])}
    clues = {node["node_id"] for node in by_kind.get("clue", [])}
    supporting = {str(r.get("from_node_id")) for r in supports}
    supported = {str(r.get("to_node_id")) for r in supports}
    for clue in sorted(clues - supporting):
        findings.append(_finding("clue_supports_nothing", clue,
                                 "no supports relation leaves this clue"))
    for conclusion in sorted(conclusions - supported):
        findings.append(_finding("conclusion_without_support", conclusion,
                                 "no supports relation arrives here"))

    placed_clues = {
        str(r.get("from_node_id")) for r in rel_by_kind.get("discoverable-at", [])
    }
    for clue in sorted(clues - placed_clues):
        findings.append(_finding("clue_nowhere_to_find", clue,
                                 "no discoverable-at relation places it in a scene"))

    present = {str(r.get("from_node_id")) for r in rel_by_kind.get("present-in", [])}
    for kind in ACTOR_KINDS:
        for node in by_kind.get(kind, []):
            if node["node_id"] not in present:
                findings.append(_finding(
                    "actor_in_no_scene", node["node_id"],
                    f"no present-in relation puts this {kind} in a scene",
                ))

    cited_spans: set[str] = set()
    for collection in ("nodes", "claims"):
        for row in graph.get(collection) or []:
            if isinstance(row, dict):
                cited_spans.update(
                    span for span in (row.get("evidence_span_ids") or [])
                    if isinstance(span, str)
                )
    pages: set[str] = set()
    for span in cited_spans:
        if "-page-" in span:
            pages.add(span.split("-page-", 1)[1].split("-", 1)[0])
    for nodes in by_kind.values():
        for node in nodes:
            if not any(
                isinstance(span, str) and "-page-" in span
                for span in (node.get("evidence_span_ids") or [])
            ):
                findings.append(_finding("node_without_page", node["node_id"],
                                         "cites no span that names a page"))

    measures = {
        "nodes": len(node_ids),
        "relations": len(graph.get("relations") or []),
        "scenes": len(scenes),
        "scene_exits": len(exits),
        "scene_components": len(components),
        "largest_component": max((len(c) for c in components), default=0),
        "branches": sum(1 for scene in scenes if len(forward.get(scene, ())) > 1),
        "npcs": len(by_kind.get("npc", [])),
        "creatures": len(by_kind.get("creature", [])),
        "clues": len(clues),
        "conclusions": len(conclusions),
        "endings": len(by_kind.get("ending", [])),
        "rules": len(by_kind.get("rule", [])),
        "pages_covered": len(pages),
    }
    if evidence_total:
        measures["span_consumption"] = round(len(cited_spans) / evidence_total, 4)

    counts = Counter(f["code"] for f in findings)
    return {
        "status": "playable" if not findings else "findings",
        "findings": findings,
        "finding_counts": dict(counts),
        "measures": measures,
    }


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


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--graph", required=True, type=Path)
    parser.add_argument("--evidence-total", type=int, default=None)
    parser.add_argument("--max-findings", type=int, default=40)
    args = parser.parse_args(argv)
    result = check(
        json.loads(args.graph.read_text(encoding="utf-8")),
        evidence_total=args.evidence_total,
    )
    shown = dict(result)
    shown["findings"] = result["findings"][: args.max_findings]
    if len(result["findings"]) > args.max_findings:
        shown["findings_omitted"] = len(result["findings"]) - args.max_findings
    print(json.dumps(shown, ensure_ascii=False, indent=2))
    return 0 if result["status"] == "playable" else 1


if __name__ == "__main__":
    sys.exit(main())
