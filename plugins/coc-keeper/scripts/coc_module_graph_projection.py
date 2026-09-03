#!/usr/bin/env python3
"""Project one accepted ModuleGraph into the Tier-1 skeleton shape.

The unification spec's forward path is
``ModuleGraph -> prepare-projection -> validate -> project (seven IR files)``.
Everything downstream of the skeleton already exists:
``coc_module_project.project_skeleton_to_campaign`` materializes the seven
canonical IR documents and writes them into a campaign. What was missing is
this seam -- the graph's semantic nodes and relations expressed as the
topology the skeleton contract accepts.

Two rules the whole file exists to hold:

**Nothing is invented here.** Every scene, NPC, clue and edge comes from a
graph node or a relation between two of them, and each carries the graph's own
``evidence_span_ids`` forward as ``source_refs``. A field the graph does not
answer stays absent or ``unresolved``; it never receives a plausible default.
On 2026-09-02 a bind-guessed era recorded a Roman module as 1920s, and a
pacing curve stamped with one stage per scene "looked authored and was not".

**The graph decides, not the array order.** Scene ordering comes from
``play-precedes`` relations, not from the order nodes happen to appear -- the
graph contract's own ordering law says exactly that, and array order is not
evidence of anything.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

SCHEMA_VERSION = 1

# Graph node kinds that become skeleton locations (the story-graph's scenes).
SCENE_KINDS = frozenset({"scene", "beat", "event", "ending"})
# Graph node kinds that become the NPC roster.
ACTOR_KINDS = frozenset({"npc", "creature", "faction", "organization"})

# Relation kinds that carry scene topology, and the skeleton edge kind each
# projects to. `travel` is the skeleton's word for "play moves from here to
# there"; the graph distinguishes why, and that distinction is kept in the
# edge's evidence field rather than flattened away.
SCENE_EDGE_KINDS: dict[str, tuple[str, str]] = {
    "play-precedes": ("travel", "toc_adjacency"),
    "may-lead-to": ("travel", "body_mention"),
    "alternative-to": ("travel", "body_mention"),
    "hands-off-to": ("chapter_handoff", "body_mention"),
    "route-to": ("travel", "map"),
    "triggers": ("unlock", "body_mention"),
}

# Relations that place a clue in a scene, and that bind a clue to a conclusion.
CLUE_PLACEMENT = frozenset({"discoverable-at", "held-by", "delivered-by"})
CLUE_SUPPORT = frozenset({"supports", "reveals", "resolves"})


class ProjectionError(Exception):
    """One projection refusal with the findings that caused it."""

    def __init__(self, findings: list[dict[str, str]]):
        super().__init__("; ".join(f["message"] for f in findings))
        self.findings = findings


def _finding(code: str, path: str, message: str) -> dict[str, str]:
    return {"code": code, "path": path, "message": message}


def _nodes_by_id(graph: dict[str, Any]) -> dict[str, dict[str, Any]]:
    rows: dict[str, dict[str, Any]] = {}
    for node in graph.get("nodes") or []:
        if isinstance(node, dict) and isinstance(node.get("node_id"), str):
            rows[node["node_id"]] = node
    return rows


def _source_refs(node: dict[str, Any], source_id: str) -> list[dict[str, Any]]:
    """Carry the graph's evidence spans forward as page-bound source refs.

    A span id is ``span-<section>-page-<n>-block-<n>``; the page index is the
    part that survives into the IR, because that is what a Keeper or an auditor
    can open. A span whose shape does not carry one is dropped rather than
    guessed at -- an unprovable citation is worse than a missing one.
    """
    refs: list[dict[str, Any]] = []
    seen: set[int] = set()
    for span_id in node.get("evidence_span_ids") or []:
        if not isinstance(span_id, str) or "-page-" not in span_id:
            continue
        tail = span_id.split("-page-", 1)[1]
        page = tail.split("-", 1)[0]
        if not page.isdigit():
            continue
        index = int(page)
        if index in seen:
            continue
        seen.add(index)
        refs.append({"source_id": source_id, "pdf_index": index})
    return refs


def _relations_by_kind(graph: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    rows: dict[str, list[dict[str, Any]]] = {}
    for relation in graph.get("relations") or []:
        if not isinstance(relation, dict):
            continue
        kind = relation.get("relation_kind")
        if isinstance(kind, str):
            rows.setdefault(kind, []).append(relation)
    return rows


def _start_scene_ids(
    scene_ids: list[str], edges: list[dict[str, Any]],
) -> list[str]:
    """Scenes nothing leads into.

    A start is a graph property, not a declaration: if every scene is a target
    the graph has a cycle and no entrance, and this returns the first scene in
    graph order rather than inventing one -- the reachability lint will then
    report `start-scene-count` against a real topology instead of a guess.
    """
    targets = {str(edge.get("to")) for edge in edges}
    starts = [sid for sid in scene_ids if sid not in targets]
    return starts or scene_ids[:1]


def _final_scene_ids(
    scene_ids: list[str],
    edges: list[dict[str, Any]],
    nodes: dict[str, dict[str, Any]],
) -> list[str]:
    """Scenes nothing leads out of, plus anything the graph calls an ending."""
    sources = {str(edge.get("from")) for edge in edges}
    finals = [sid for sid in scene_ids if sid not in sources]
    for sid in scene_ids:
        if nodes.get(sid, {}).get("node_kind") == "ending" and sid not in finals:
            finals.append(sid)
    return finals


def _module_identity(
    module_id: str, nodes: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    """Identity, with the era taken from the graph or left unanswered.

    A `temporal-frame` node may carry `properties.era_key`: one of the
    runtime's canonical era keys, chosen by whoever read the page rather than
    inferred from prose here. `normalize_era` silently defaults anything it
    does not recognise to 1920s, and on 2026-09-03 that recorded a module set
    in AD 80 as the 1920s while every fact beside it said otherwise. So an
    absent or unrecognised key leaves the era out entirely and the downstream
    projection reports `unknown`, which is answerable; a wrong century is not.
    """
    identity: dict[str, Any] = {
        "canonical_module_id": module_id,
        "canonical_title": module_id,
    }
    for node in nodes.values():
        if node.get("node_kind") != "temporal-frame":
            continue
        era_key = (node.get("properties") or {}).get("era_key")
        if isinstance(era_key, str) and era_key.strip():
            identity["era"] = era_key.strip()
            break
    return identity


def project_graph_to_skeleton(
    graph: dict[str, Any],
    *,
    source_id: str,
    file_sha256: str,
    page_count: int,
    parse_tier: int = 2,
) -> dict[str, Any]:
    """Build a skeleton whose every record is graph-derived and page-bound."""
    findings: list[dict[str, str]] = []
    if not isinstance(graph, dict):
        raise ProjectionError([_finding("invalid_graph", "/", "must be an object")])
    module_id = str(graph.get("module_id") or "").strip()
    if not module_id:
        findings.append(_finding("module_id_required", "/module_id", "required"))

    nodes = _nodes_by_id(graph)
    by_kind = _relations_by_kind(graph)

    scene_ids = [
        nid for nid, node in nodes.items()
        if node.get("node_kind") in SCENE_KINDS
    ]
    if not scene_ids:
        findings.append(
            _finding("no_scenes", "/nodes", "graph carries no scene-kind node")
        )
    if findings:
        raise ProjectionError(findings)

    scene_set = set(scene_ids)
    edges: list[dict[str, Any]] = []
    for kind, (edge_kind, evidence) in SCENE_EDGE_KINDS.items():
        for relation in by_kind.get(kind, []):
            src = str(relation.get("from_node_id") or "")
            dst = str(relation.get("to_node_id") or "")
            if src not in scene_set or dst not in scene_set or src == dst:
                continue
            edges.append({
                "from": src,
                "to": dst,
                "kind": edge_kind,
                # `play-precedes` is the source's own recommended order, so it
                # is high confidence; the rest are inferred from body prose.
                "confidence": "high" if kind == "play-precedes" else "med",
                "evidence": evidence,
            })

    starts = _start_scene_ids(scene_ids, edges)
    finals = set(_final_scene_ids(scene_ids, edges, nodes))

    # A clue placement is one fact with two readers: the clue-graph lists the
    # scenes a clue appears in, and the reachability lint asks each scene which
    # clues it offers. Writing only the first leaves every clue reported
    # `clue-unplaced` while the artifact upstream says it is placed.
    clues_in_scene: dict[str, list[str]] = {}
    for kind in CLUE_PLACEMENT:
        for relation in by_kind.get(kind, []):
            clue = str(relation.get("from_node_id") or "")
            scene = str(relation.get("to_node_id") or "")
            if scene in scene_set and nodes.get(clue, {}).get("node_kind") == "clue":
                clues_in_scene.setdefault(scene, []).append(clue)

    npcs_in_scene: dict[str, list[str]] = {}
    for relation in by_kind.get("present-in", []):
        actor = str(relation.get("from_node_id") or "")
        scene = str(relation.get("to_node_id") or "")
        if scene in scene_set and nodes.get(actor, {}).get("node_kind") in ACTOR_KINDS:
            npcs_in_scene.setdefault(scene, []).append(actor)

    locations = []
    for sid in scene_ids:
        node = nodes[sid]
        row: dict[str, Any] = {
            "location_id": sid,
            "title": str(node.get("name") or sid),
            # `deep` is reserved for a body-parsed entity pack. A graph node is
            # a read of the source, not a full parse of the entity, so it is
            # `body_parsed` and says so.
            "parse_state": "body_parsed",
            "source_refs": _source_refs(node, source_id),
            "available_clue_ids": sorted(set(clues_in_scene.get(sid) or [])),
            "npc_ids": sorted(set(npcs_in_scene.get(sid) or [])),
        }
        summary = str(node.get("summary") or "").strip()
        if summary:
            row["summary"] = summary
        if sid in finals:
            row["is_final"] = True
        if sid in starts:
            # The opening window must be an exact contiguous 1..3 page span:
            # the host materializes those pages for the table opening, and a
            # scattered set is not a window. A start whose evidence does not
            # form one is left without a locator so the guard refuses it,
            # rather than being handed a plausible slice of itself.
            pages = [ref["pdf_index"] for ref in row["source_refs"]]
            if pages and pages == list(range(pages[0], pages[0] + len(pages))) \
                    and 1 <= len(pages) <= 3:
                row["opening_start_locator"] = [
                    dict(ref) for ref in row["source_refs"]
                ]
        locations.append(row)

    npc_roster = []
    for nid, node in nodes.items():
        if node.get("node_kind") not in ACTOR_KINDS:
            continue
        npc_roster.append({
            "npc_id": nid,
            "names": [str(node.get("name") or nid)],
            "parse_state": "body_parsed",
            "source_refs": _source_refs(node, source_id),
            **(
                {"summary": str(node.get("summary")).strip()}
                if str(node.get("summary") or "").strip() else {}
            ),
        })

    # Conclusions and the clues that support them. A conclusion with no
    # supporting clue is still projected: the reachability lint reports
    # `conclusion-without-clues`, and hiding it here would hide a real gap.
    clue_scene: dict[str, list[str]] = {}
    for scene, clue_ids in clues_in_scene.items():
        for clue in clue_ids:
            clue_scene.setdefault(clue, []).append(scene)

    conclusion_buckets = []
    for nid, node in nodes.items():
        if node.get("node_kind") != "conclusion":
            continue
        clues = []
        for kind in CLUE_SUPPORT:
            for relation in by_kind.get(kind, []):
                if str(relation.get("to_node_id") or "") != nid:
                    continue
                clue_id = str(relation.get("from_node_id") or "")
                clue_node = nodes.get(clue_id)
                if clue_node is None:
                    continue
                clues.append({
                    "clue_id": clue_id,
                    "statement": str(clue_node.get("summary") or clue_node.get("name") or clue_id),
                    "scene_ids": sorted(set(clue_scene.get(clue_id) or [])),
                    "source_refs": _source_refs(clue_node, source_id),
                })
        conclusion_buckets.append({
            "id": nid,
            "title": str(node.get("name") or nid),
            "importance": "core" if len(clues) > 1 else "supporting",
            "clues": clues,
            "source_refs": _source_refs(node, source_id),
        })

    skeleton: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "parse_tier": parse_tier,
        "source": {
            "source_id": source_id,
            "file_sha256": file_sha256,
            "page_count": page_count,
            "producer": "coc_module_graph_projection",
        },
        "module_identity": _module_identity(module_id, nodes),
        "start_candidates": starts,
        "locations": locations,
        "edges_provisional": edges,
        "npc_roster": npc_roster,
        "conclusion_buckets": conclusion_buckets,
        "finale_buckets": [{"id": sid} for sid in sorted(finals)],
        # The graph has not been asked for mechanics locators or a clock, and
        # an unasked question stays unresolved rather than defaulted.
        "mechanics_locator_pass_status": "pending",
        "mechanics_index": [],
        "start_clock_status": "unresolved",
    }
    return skeleton


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Project one ModuleGraph into a Tier-1 skeleton.",
    )
    parser.add_argument("graph")
    parser.add_argument("--source-id", required=True)
    parser.add_argument("--file-sha256", required=True)
    parser.add_argument("--page-count", type=int, required=True)
    parser.add_argument("--output")
    args = parser.parse_args(argv)

    graph = json.loads(Path(args.graph).read_text(encoding="utf-8"))
    try:
        skeleton = project_graph_to_skeleton(
            graph,
            source_id=args.source_id,
            file_sha256=args.file_sha256,
            page_count=args.page_count,
        )
    except ProjectionError as exc:
        print(json.dumps({
            "status": "FAIL",
            "finding_count": len(exc.findings),
            "findings": exc.findings,
        }, ensure_ascii=False, indent=2))
        return 1

    payload = json.dumps(skeleton, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        Path(args.output).write_text(payload, encoding="utf-8")
        print(json.dumps({
            "status": "PASS",
            "output": args.output,
            "scenes": len(skeleton["locations"]),
            "npcs": len(skeleton["npc_roster"]),
            "edges": len(skeleton["edges_provisional"]),
            "conclusions": len(skeleton["conclusion_buckets"]),
        }, ensure_ascii=False, indent=2))
    else:
        sys.stdout.write(payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
