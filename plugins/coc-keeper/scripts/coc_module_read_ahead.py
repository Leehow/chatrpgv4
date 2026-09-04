#!/usr/bin/env python3
"""Which sections to have read by the time the party gets there.

Reading a whole book up front was measured and rejected: hours before anyone
sits down. Reading only where the party stands is worse in a different way --
every move into a new chapter stalls the table for as long as a section takes
(twenty minutes, measured). So the queue reads one move ahead of the party, and
this module decides what "one move ahead" means for a given position.

It is not the spine. The book's chapter order is what a reader of the book does
next, and a party at a location does something else: it walks to a connected
location, which may be printed forty pages away. So a location's neighbours are
warmed alongside the section the spine names next -- the two answers differ, and
which one is right depends on where the party is standing rather than on a
preference this module could hold.

Deciding is all this does. It runs no model, touches no queue, and enqueues
nothing: the runtime owns `progressive.on_enter_scene` and the claim/fulfill
contract, and this hands it an ordered answer with the reason attached, so a
queue that warmed the wrong thing can be asked why.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

# Where the party can go from a scene: what the campaign projection turns into
# an exit card.
EXIT_KINDS = ("play-precedes", "may-lead-to", "alternative-to", "hands-off-to")
# Where the party can walk from a location. `located-in` is followed both ways:
# out of a room into its building, and from a building into the rooms it holds.
PLACE_KINDS = ("adjacent-to", "route-to", "located-in")
# What ties a scene to the ground it happens on.
SITE_KINDS = ("occurs-at",)
PLAYABLE_KINDS = ("scene", "beat", "event", "ending")


def _pages_of(node: dict[str, Any]) -> set[int]:
    out: set[int] = set()
    for span in node.get("evidence_span_ids") or []:
        match = re.search(r"-page-(\d+)-", str(span))
        if match:
            out.add(int(match.group(1)))
    return out


def section_of_node(node: dict[str, Any], plan: dict[str, Any]) -> str | None:
    """The planned section whose pages hold this node.

    By page, because the merged graph keeps no membership map -- `node_refs_by_section`
    records what a section borrowed, not what it owns. Pages are what the plan
    is written in, so they are what the answer can be derived from.
    """
    pages = _pages_of(node)
    if not pages:
        return None
    for section in plan.get("sections") or []:
        try:
            first = int(section["pdf_index_start"])
            last = int(section["pdf_index_end"])
        except (KeyError, TypeError, ValueError):
            continue
        if any(first <= page <= last for page in pages):
            return str(section["section_id"])
    return None


def warm_targets(
    graph: dict[str, Any],
    plan: dict[str, Any],
    at_node_id: str,
    *,
    read_sections: set[str] | None = None,
) -> dict[str, Any]:
    """The sections the party could need next, nearest first, with reasons."""
    nodes = {
        node["node_id"]: node
        for node in graph.get("nodes") or []
        if isinstance(node, dict) and isinstance(node.get("node_id"), str)
    }
    if at_node_id not in nodes:
        return {"here": None, "warm": [], "basis": [],
                "reason": f"{at_node_id!r} is not a node in this graph"}

    by_kind: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for relation in graph.get("relations") or []:
        if isinstance(relation, dict):
            by_kind[str(relation.get("relation_kind"))].append(relation)

    def step(kinds, source: str, *, both_ways: bool) -> set[str]:
        found: set[str] = set()
        for kind in kinds:
            for relation in by_kind.get(kind, []):
                if relation.get("from_node_id") == source:
                    found.add(str(relation.get("to_node_id")))
                elif both_ways and relation.get("to_node_id") == source:
                    found.add(str(relation.get("from_node_id")))
        return found

    here = section_of_node(nodes[at_node_id], plan)
    basis: list[dict[str, Any]] = []
    seen: set[str] = set()

    def offer(node_id: str, why: str, via: str) -> None:
        node = nodes.get(node_id)
        if node is None:
            return
        section = section_of_node(node, plan)
        if not section or section == here or section in seen:
            return
        seen.add(section)
        basis.append({"section_id": section, "why": why, "via": node_id,
                      "name": node.get("name")})

    # One move by exit: wherever the party can go from where it stands.
    for target in sorted(step(EXIT_KINDS, at_node_id, both_ways=False)):
        offer(target, "an exit leads here from where the party stands", target)

    # One move on foot: the ground this scene stands on, and what adjoins it.
    for site in sorted(step(SITE_KINDS, at_node_id, both_ways=False)):
        for neighbour in sorted(step(PLACE_KINDS, site, both_ways=True)):
            offer(neighbour, "a connected place, reachable on foot", neighbour)
            # A place is warmed for the scenes it holds, not for itself.
            for relation in by_kind.get("occurs-at", []):
                if relation.get("to_node_id") == neighbour:
                    offer(str(relation.get("from_node_id")),
                          "a scene at a connected place", neighbour)

    warm = [row["section_id"] for row in basis]
    if read_sections:
        warm = [section for section in warm if section not in read_sections]
        basis = [row for row in basis if row["section_id"] in set(warm)]
    return {"here": here, "warm": warm, "basis": basis,
            "reason": "" if warm else "nothing one move away is still unread"}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--graph", required=True, type=Path)
    parser.add_argument("--plan", required=True, type=Path)
    parser.add_argument("--at", required=True, help="the node the party is at")
    parser.add_argument("--read", nargs="*", default=(),
                        help="sections already deep-read")
    args = parser.parse_args(argv)
    print(json.dumps(warm_targets(
        json.loads(args.graph.read_text(encoding="utf-8")),
        json.loads(args.plan.read_text(encoding="utf-8")),
        args.at,
        read_sections=set(args.read),
    ), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
