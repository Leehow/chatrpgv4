#!/usr/bin/env python3
"""Graph-backed starter projection and local source-asset installation.

The committed graph contains structured, source-language semantic data only.
PDF page text, verbatim handout bodies, and image bytes remain in the ignored
module-assets store owned by the validated source-bundle pipeline.
"""
from __future__ import annotations

import argparse
import functools
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import coc_fileio
import coc_module_assets
import coc_module_graph
import coc_pdf_bundle


PROJECTION_CONTRACT_ID = "coc.module-graph-runtime-projection.v1"
ASSET_CATALOG_CONTRACT_ID = "coc.starter-graph-assets.v1"
GRAPH_FILENAME = "module-graph.json"
ASSET_CATALOG_FILENAME = "module-graph-assets.json"
ASSET_ROOT_ID = "the-haunting-keeper-rulebook-40th-full-v1"
SOURCE_ID = "pdf:call-of-cthulhu-keeper-rulebook-40th-the-haunting"

PROJECTED_DOCUMENTS: tuple[str, ...] = (
    "module-meta.json",
    "story-graph.json",
    "clue-graph.json",
    "npc-agendas.json",
    "threat-fronts.json",
    "pacing-map.json",
    "improvisation-boundaries.json",
    "quests.json",
    "handouts.json",
)

COLLECTION_SPECS: dict[str, tuple[tuple[str, str, str | None], ...]] = {
    "story-graph.json": (("scenes", "scene", "scene_id"),),
    "clue-graph.json": (("conclusions", "conclusion", "conclusion_id"),),
    "npc-agendas.json": (("npcs", "npc", "npc_id"),),
    "threat-fronts.json": (("fronts", "threat", "front_id"),),
    "pacing-map.json": (("pacing_curve", "beat", "scene_id"),),
    "improvisation-boundaries.json": (
        ("invent_allowed", "concept", None),
        ("keeper_secrets", "secret", "id"),
        ("never_invent", "concept", None),
    ),
    "quests.json": (("quests", "quest", "quest_id"),),
    "handouts.json": (("handouts", "handout", "asset_id"),),
}

_SEMANTIC_ID = re.compile(r"^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$")
_CJK = re.compile(r"[\u3400-\u9fff\u3040-\u30ff]")


class StarterGraphError(ValueError):
    """The curated starter graph or its projection is invalid."""


def _deepcopy(value: Any) -> Any:
    return json.loads(json.dumps(value, ensure_ascii=False))


def _canonical_bytes(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def _digest(value: Any) -> str:
    return hashlib.sha256(_canonical_bytes(value)).hexdigest()


def _slug(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    if not slug or not _SEMANTIC_ID.fullmatch(slug):
        raise StarterGraphError(f"cannot derive semantic id from {value!r}")
    return slug


def _node_id(kind: str, raw: str) -> str:
    candidate = raw if raw.startswith(f"{kind}-") else f"{kind}-{raw}"
    candidate = _slug(candidate)
    if not candidate.startswith(f"{kind}-"):
        raise StarterGraphError(f"node id {candidate!r} does not match kind {kind}")
    return candidate


def _contains_cjk(value: Any) -> bool:
    return bool(_CJK.search(json.dumps(value, ensure_ascii=False)))


def _read_object(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise StarterGraphError(f"invalid JSON {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise StarterGraphError(f"{path} must contain one object")
    return value


def _record_id(
    filename: str,
    collection: str,
    kind: str,
    id_field: str | None,
    record: Any,
    ordinal: int,
) -> str:
    raw = ""
    if id_field is not None and isinstance(record, dict):
        raw = str(record.get(id_field) or "").strip()
    if not raw:
        raw = f"{Path(filename).stem}-{collection}-{ordinal + 1}"
    return _node_id(kind, raw)


def _summary(record: Any, fallback: str) -> str:
    if isinstance(record, dict):
        for field in (
            "summary", "player_safe_summary", "description", "title",
            "display_name", "name", "note", "keeper_note",
        ):
            value = record.get(field)
            if isinstance(value, str) and value.strip() and not _CJK.search(value):
                return value.strip()
    if isinstance(record, str) and record.strip() and not _CJK.search(record):
        return record.strip()
    return fallback.replace("-", " ")


def _record_source_refs(record: Any, page_map: dict[int, int]) -> list[dict[str, Any]]:
    refs: dict[tuple[int, str], dict[str, Any]] = {}

    def visit(value: Any) -> None:
        if isinstance(value, dict):
            source_refs = value.get("source_refs")
            if isinstance(source_refs, list):
                for ref in source_refs:
                    if not isinstance(ref, dict):
                        continue
                    printed = ref.get("page")
                    anchor = str(ref.get("grep_anchor") or "").strip()
                    if not isinstance(printed, int) or printed not in page_map or not anchor:
                        continue
                    pdf_index = page_map[printed]
                    refs[(pdf_index, anchor)] = {
                        "source_id": SOURCE_ID,
                        "pdf_index": pdf_index,
                        "grep_anchor": anchor,
                    }
            for child in value.values():
                visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)

    visit(record)
    return [refs[key] for key in sorted(refs)]


def _relation(
    relation_id: str,
    kind: str,
    from_node_id: str,
    to_node_id: str,
    *,
    properties: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "relation_id": relation_id,
        "relation_kind": kind,
        "from_node_id": from_node_id,
        "to_node_id": to_node_id,
        "claim_id": None,
        "properties": dict(properties or {}),
    }


def build_starter_graph(
    starter_dir: Path | str,
    *,
    asset_catalog: Path | str | None = None,
) -> dict[str, Any]:
    """Mechanically lift curated Scenario IR into one property graph.

    This function performs no semantic reading. Existing curated records and
    their source refs become graph properties; cross-record links are derived
    only from structured IDs already present in those records.
    """
    root = Path(starter_dir)
    catalog_path = Path(asset_catalog) if asset_catalog else root / ASSET_CATALOG_FILENAME
    catalog = _read_object(catalog_path)
    if catalog.get("contract_id") != ASSET_CATALOG_CONTRACT_ID:
        raise StarterGraphError("starter asset catalog contract mismatch")
    if catalog.get("module_id") != "module-the-haunting":
        raise StarterGraphError("starter asset catalog module mismatch")
    page_rows = catalog.get("source_pages")
    if not isinstance(page_rows, list) or not page_rows:
        raise StarterGraphError("starter asset catalog requires source_pages")
    printed_to_pdf = {
        int(row["printed_page"]): int(row["pdf_index"])
        for row in page_rows
        if isinstance(row, dict)
    }
    if len(printed_to_pdf) != len(page_rows):
        raise StarterGraphError("starter source page map is invalid")

    module_id = "module-the-haunting"
    module_node: dict[str, Any] = {
        "node_id": module_id,
        "node_kind": "module",
        "name": "The Haunting",
        "visibility": "keeper-only",
        "aliases": [],
        "summary": "A source-bound 1920s Boston investigation of the Corbitt House.",
        "evidence_span_ids": [],
        "properties": {
            "asset_root_id": ASSET_ROOT_ID,
            "source_binding": _deepcopy(catalog.get("source_binding") or {}),
            "runtime_projection": {
                "contract_id": PROJECTION_CONTRACT_ID,
                "documents": [],
            },
        },
        "source_refs": [],
    }
    nodes: dict[str, dict[str, Any]] = {module_id: module_node}
    relations: list[dict[str, Any]] = []
    projection_documents: list[dict[str, Any]] = []
    relation_ordinal = 0

    def add_relation(kind: str, source: str, target: str, **properties: Any) -> None:
        nonlocal relation_ordinal
        relation_ordinal += 1
        relations.append(_relation(
            f"relation-{kind}-{relation_ordinal}",
            kind,
            source,
            target,
            properties=properties,
        ))

    for filename in PROJECTED_DOCUMENTS:
        document = _read_object(root / filename)
        if _contains_cjk(document):
            raise StarterGraphError(
                f"{filename} contains persisted module translation outside source language"
            )
        root_record = _deepcopy(document)
        collection_rows: list[dict[str, Any]] = []
        for collection, kind, id_field in COLLECTION_SPECS.get(filename, ()):
            raw_records = root_record.pop(collection, None)
            if not isinstance(raw_records, list):
                raise StarterGraphError(f"{filename}.{collection} must be an array")
            ordered_ids: list[str] = []
            for ordinal, record in enumerate(raw_records):
                node_id = _record_id(filename, collection, kind, id_field, record, ordinal)
                if node_id in nodes:
                    raise StarterGraphError(f"duplicate projection node {node_id}")
                source_refs = _record_source_refs(record, printed_to_pdf)
                node = {
                    "node_id": node_id,
                    "node_kind": kind,
                    "name": _summary(record, node_id),
                    "visibility": "keeper-only",
                    "aliases": [],
                    "summary": _summary(record, node_id),
                    "evidence_span_ids": [],
                    "properties": {
                        "runtime_projection": {
                            "document": filename,
                            "collection": collection,
                            "record": _deepcopy(record),
                        }
                    },
                    "source_refs": source_refs,
                }
                nodes[node_id] = node
                ordered_ids.append(node_id)
                add_relation("contains", module_id, node_id)
            collection_rows.append({"name": collection, "node_ids": ordered_ids})
        projection_documents.append({
            "filename": filename,
            "root": root_record,
            "collections": collection_rows,
        })

    module_node["properties"]["runtime_projection"]["documents"] = projection_documents

    # Player-safe clue nodes are queryable separately from the Keeper-only
    # lossless conclusion projection records.
    clue_document = _read_object(root / "clue-graph.json")
    conclusion_projection = {
        str(node["properties"]["runtime_projection"]["record"].get("conclusion_id")): node_id
        for node_id, node in nodes.items()
        if node.get("node_kind") == "conclusion"
        and isinstance(node.get("properties", {}).get("runtime_projection", {}).get("record"), dict)
    }
    for conclusion in clue_document.get("conclusions") or []:
        if not isinstance(conclusion, dict):
            continue
        conclusion_id = str(conclusion.get("conclusion_id") or "")
        target_node = conclusion_projection.get(conclusion_id)
        for clue in conclusion.get("clues") or []:
            if not isinstance(clue, dict) or not clue.get("clue_id"):
                continue
            clue_id = _node_id("clue", str(clue["clue_id"]))
            if clue_id not in nodes:
                source_refs = _record_source_refs(clue, printed_to_pdf)
                nodes[clue_id] = {
                    "node_id": clue_id,
                    "node_kind": "clue",
                    "name": _summary(clue, clue_id),
                    "visibility": "revealable",
                    "aliases": [],
                    "summary": _summary(clue, clue_id),
                    "evidence_span_ids": [],
                    "properties": {
                        "delivery_kind": clue.get("delivery_kind"),
                        "handout_asset_id": clue.get("handout_asset_id"),
                    },
                    "source_refs": source_refs,
                }
                add_relation("contains", module_id, clue_id)
            if target_node:
                add_relation("supports", clue_id, target_node)

    # Structured scene edges become real graph routes.
    for node_id, node in list(nodes.items()):
        projection = node.get("properties", {}).get("runtime_projection")
        record = projection.get("record") if isinstance(projection, dict) else None
        if node.get("node_kind") != "scene" or not isinstance(record, dict):
            continue
        for edge in record.get("scene_edges") or []:
            if not isinstance(edge, dict) or not edge.get("to"):
                continue
            target = _node_id("scene", str(edge["to"]))
            if target in nodes:
                add_relation(
                    "route-to",
                    node_id,
                    target,
                    edge_kind=edge.get("kind"),
                    when=edge.get("when"),
                )

    source_node_id = "source-document-keeper-rulebook-40th-the-haunting"
    nodes[source_node_id] = {
        "node_id": source_node_id,
        "node_kind": "source-document",
        "name": "Keeper Rulebook 40th Anniversary - The Haunting",
        "visibility": "keeper-only",
        "aliases": [],
        "summary": "The visually reviewed source window at PDF indices 446 through 462.",
        "evidence_span_ids": [],
        "properties": {"source_id": SOURCE_ID},
        "source_refs": [
            {"source_id": SOURCE_ID, "pdf_index": int(row["pdf_index"])}
            for row in page_rows
        ],
    }
    add_relation("contains", source_node_id, module_id)

    for raw in catalog.get("source_entities") or []:
        if not isinstance(raw, dict):
            raise StarterGraphError("source entity catalog row must be an object")
        node_id = str(raw.get("node_id") or "")
        kind = str(raw.get("node_kind") or "")
        if (
            kind not in coc_module_graph.NODE_KINDS
            or not _SEMANTIC_ID.fullmatch(node_id)
            or not node_id.startswith(f"{kind}-")
        ):
            raise StarterGraphError(f"source entity {node_id!r} has invalid identity")
        if node_id in nodes:
            raise StarterGraphError(f"duplicate source entity node {node_id}")
        pdf_indices = raw.get("pdf_indices") or []
        if (
            not isinstance(pdf_indices, list)
            or not pdf_indices
            or any(not isinstance(index, int) for index in pdf_indices)
        ):
            raise StarterGraphError(f"source entity {node_id} has invalid page scope")
        nodes[node_id] = {
            "node_id": node_id,
            "node_kind": kind,
            "name": str(raw.get("name") or node_id),
            "visibility": str(raw.get("visibility") or "keeper-only"),
            "aliases": _deepcopy(raw.get("aliases") or []),
            "summary": str(raw.get("summary") or raw.get("name") or node_id),
            "evidence_span_ids": [],
            "properties": _deepcopy(raw.get("properties") or {}),
            "source_refs": [
                {"source_id": SOURCE_ID, "pdf_index": index}
                for index in sorted(set(pdf_indices))
            ],
        }
        add_relation("contains", module_id, node_id)

    for raw in catalog.get("assets") or []:
        if not isinstance(raw, dict):
            raise StarterGraphError("asset catalog row must be an object")
        asset_id = _node_id("asset", str(raw.get("asset_id") or ""))
        if asset_id in nodes:
            raise StarterGraphError(f"duplicate asset node {asset_id}")
        pdf_index = int(raw["pdf_index"])
        nodes[asset_id] = {
            "node_id": asset_id,
            "node_kind": "asset",
            "name": str(raw.get("name") or asset_id),
            "visibility": str(raw.get("visibility") or "keeper-only"),
            "aliases": [],
            "summary": str(raw.get("summary") or raw.get("name") or asset_id),
            "evidence_span_ids": [],
            "properties": {
                "asset_ref": raw.get("asset_ref"),
                "media_type": raw.get("media_type"),
                "role": raw.get("role"),
                "pdf_index": pdf_index,
                "local_bytes_required": True,
            },
            "source_refs": [{"source_id": SOURCE_ID, "pdf_index": pdf_index}],
        }
        add_relation("contains", source_node_id, asset_id)
        for target in raw.get("depicts_node_ids") or []:
            target_id = str(target)
            if target_id in nodes:
                add_relation("depicts", asset_id, target_id)
        variant = raw.get("variant_of")
        if isinstance(variant, str) and variant in nodes:
            add_relation("variant-of", asset_id, variant)

    for raw in catalog.get("handouts") or []:
        if not isinstance(raw, dict):
            raise StarterGraphError("handout catalog row must be an object")
        handout_id = _node_id("handout", str(raw.get("asset_id") or ""))
        source_refs = [
            {"source_id": SOURCE_ID, "pdf_index": int(index)}
            for index in raw.get("source_page_indices") or []
        ]
        existing = nodes.get(handout_id)
        if existing is None:
            existing = {
                "node_id": handout_id,
                "node_kind": "handout",
                "name": str(raw.get("title") or handout_id),
                "visibility": "player-safe",
                "aliases": [],
                "summary": str(raw.get("summary") or raw.get("title") or handout_id),
                "evidence_span_ids": [],
                "properties": {},
                "source_refs": source_refs,
            }
            nodes[handout_id] = existing
            add_relation("contains", source_node_id, handout_id)
        existing["properties"].update({
            "asset_id": raw.get("asset_id"),
            "kind": raw.get("kind"),
            "player_visible": True,
            "source_page_indices": raw.get("source_page_indices") or [],
            "image_asset_id": raw.get("image_asset_id"),
            "image_ref": raw.get("image_ref"),
            "when_to_deliver": raw.get("when_to_deliver"),
        })
        existing["visibility"] = "player-safe"
        existing["name"] = str(raw.get("title") or existing["name"])
        existing["summary"] = str(raw.get("summary") or existing["summary"])
        existing["source_refs"] = source_refs
        for clue_ref in raw.get("clue_refs") or []:
            clue_node = _node_id("clue", str(clue_ref))
            if clue_node in nodes:
                add_relation("supports", handout_id, clue_node)
        for scene_ref in raw.get("scene_refs") or []:
            scene_node = _node_id("scene", str(scene_ref))
            if scene_node in nodes:
                add_relation("discoverable-at", handout_id, scene_node)
        image_asset_id = raw.get("image_asset_id")
        if isinstance(image_asset_id, str) and image_asset_id in nodes:
            add_relation("contains", handout_id, image_asset_id)

    existing_relation_ids = {row["relation_id"] for row in relations}
    for raw in catalog.get("source_relations") or []:
        if not isinstance(raw, dict):
            raise StarterGraphError("source relation catalog row must be an object")
        relation_id = str(raw.get("relation_id") or "")
        kind = str(raw.get("relation_kind") or "")
        source = str(raw.get("from_node_id") or "")
        target = str(raw.get("to_node_id") or "")
        if (
            not _SEMANTIC_ID.fullmatch(relation_id)
            or kind not in coc_module_graph.RELATION_KINDS
            or relation_id in existing_relation_ids
            or source not in nodes
            or target not in nodes
        ):
            raise StarterGraphError(f"source relation {relation_id!r} is invalid")
        relations.append(_relation(
            relation_id,
            kind,
            source,
            target,
            properties=_deepcopy(raw.get("properties") or {}),
        ))
        existing_relation_ids.add(relation_id)

    # Structured live-scene membership remains a source graph relation, not a
    # prose-derived presence inference.
    present_pairs: set[tuple[str, str]] = set()
    for scene_id, scene_node in list(nodes.items()):
        projection = scene_node.get("properties", {}).get("runtime_projection")
        record = projection.get("record") if isinstance(projection, dict) else None
        if scene_node.get("node_kind") != "scene" or not isinstance(record, dict):
            continue
        for npc_ref in record.get("npc_ids") or []:
            npc_node = _node_id("npc", str(npc_ref))
            if npc_node in nodes:
                present_pairs.add((npc_node, scene_id))
    for npc_id, npc_node in list(nodes.items()):
        projection = npc_node.get("properties", {}).get("runtime_projection")
        record = projection.get("record") if isinstance(projection, dict) else None
        if npc_node.get("node_kind") != "npc" or not isinstance(record, dict):
            continue
        for schedule in record.get("schedule") or []:
            if not isinstance(schedule, dict):
                continue
            for scene_ref in schedule.get("scene_ids") or []:
                scene_node = _node_id("scene", str(scene_ref))
                if scene_node in nodes:
                    present_pairs.add((npc_id, scene_node))
    for npc_id, scene_id in sorted(present_pairs):
        add_relation("present-in", npc_id, scene_id)

    # Quest target refs are already structured authoring decisions. Preserve
    # their reachability without inventing hard prerequisites.
    for quest_id, quest_node in list(nodes.items()):
        projection = quest_node.get("properties", {}).get("runtime_projection")
        record = projection.get("record") if isinstance(projection, dict) else None
        if quest_node.get("node_kind") != "quest" or not isinstance(record, dict):
            continue
        for target in record.get("target_refs") or []:
            if not isinstance(target, dict):
                continue
            target_kind = str(target.get("kind") or "")
            target_ref = str(target.get("ref_id") or "")
            if target_kind not in {"npc", "scene", "clue"} or not target_ref:
                continue
            target_node = _node_id(target_kind, target_ref)
            if target_node in nodes:
                add_relation("may-lead-to", quest_id, target_node)

    # Stable semantic EvidenceSpan IDs bind projection nodes to exact reviewed
    # page/anchor pairs without asking a model to relay hashes or paths.
    anchor_keys = sorted({
        (int(ref["pdf_index"]), str(ref["grep_anchor"]))
        for node in nodes.values()
        for ref in node.get("source_refs") or []
        if isinstance(ref, dict)
        and isinstance(ref.get("pdf_index"), int)
        and isinstance(ref.get("grep_anchor"), str)
        and ref["grep_anchor"]
    })
    span_ids: dict[tuple[int, str], str] = {}
    page_ordinals: dict[int, int] = {}
    for pdf_index, anchor in anchor_keys:
        page_ordinals[pdf_index] = page_ordinals.get(pdf_index, 0) + 1
        span_ids[(pdf_index, anchor)] = (
            f"span-page-{pdf_index}-anchor-{page_ordinals[pdf_index]}"
        )
    for node in nodes.values():
        node["evidence_span_ids"] = sorted({
            span_ids[(int(ref["pdf_index"]), str(ref["grep_anchor"]))]
            for ref in node.get("source_refs") or []
            if isinstance(ref, dict)
            and (int(ref.get("pdf_index", -1)), str(ref.get("grep_anchor") or ""))
            in span_ids
        })
    module_node["evidence_span_ids"] = sorted(span_ids.values())

    for relation in relations:
        source_kind = nodes[relation["from_node_id"]]["node_kind"]
        if relation["relation_kind"] == "contains" and source_kind in {
            "module", "source-document",
        }:
            relation["properties"]["context_traversal"] = False

    claims: list[dict[str, Any]] = []
    for relation in sorted(relations, key=lambda row: row["relation_id"]):
        claim_id = f"claim-{relation['relation_id'][len('relation-'):]}"
        relation["claim_id"] = claim_id
        source_node = nodes[relation["from_node_id"]]
        target_node = nodes[relation["to_node_id"]]
        visibilities = {source_node["visibility"], target_node["visibility"]}
        visibility = (
            "keeper-only"
            if "keeper-only" in visibilities
            else ("revealable" if "revealable" in visibilities else "player-safe")
        )
        claims.append({
            "claim_id": claim_id,
            "subject_id": relation["from_node_id"],
            "predicate": relation["relation_kind"],
            "object": {"node_id": relation["to_node_id"]},
            "truth_status": "authored-fact",
            "visibility": visibility,
            "evidence_span_ids": sorted({
                *source_node.get("evidence_span_ids", []),
                *target_node.get("evidence_span_ids", []),
            }),
            "asserted_by_ids": [],
            "known_by_ids": [],
            "validity": None,
            "confidence": 1.0,
            "reason": "Structured curated starter projection.",
        })

    if _contains_cjk(nodes):
        raise StarterGraphError("starter graph contains non-source-language prose")
    coverage = {domain: "accepted" for domain in coc_module_graph.COVERAGE_DOMAINS}
    graph = {
        "contract_id": coc_module_graph.GRAPH_CONTRACT_ID,
        "schema_version": coc_module_graph.SCHEMA_VERSION,
        "module_id": module_id,
        "source_languages": ["en"],
        "section_ids": ["section-curated-starter-projection"],
        "coverage": coverage,
        "coverage_by_section": {"section-curated-starter-projection": coverage},
        "node_refs_by_section": {"section-curated-starter-projection": []},
        "nodes": [nodes[key] for key in sorted(nodes)],
        "claims": claims,
        "relations": sorted(relations, key=lambda row: row["relation_id"]),
        "source_refs": [
            {"source_id": SOURCE_ID, "pdf_index": int(row["pdf_index"])}
            for row in page_rows
        ],
    }
    validate_starter_graph(graph)
    return graph


def validate_starter_graph(graph: dict[str, Any]) -> dict[str, Any]:
    if graph.get("contract_id") != coc_module_graph.GRAPH_CONTRACT_ID:
        raise StarterGraphError("starter graph contract mismatch")
    if graph.get("schema_version") != coc_module_graph.SCHEMA_VERSION:
        raise StarterGraphError("starter graph schema mismatch")
    if graph.get("source_languages") != ["en"] or _contains_cjk(graph):
        raise StarterGraphError("starter graph must remain English-only")
    nodes = graph.get("nodes")
    if not isinstance(nodes, list) or not nodes:
        raise StarterGraphError("starter graph requires nodes")
    by_id: dict[str, dict[str, Any]] = {}
    for node in nodes:
        if not isinstance(node, dict):
            raise StarterGraphError("starter graph node must be an object")
        node_id = str(node.get("node_id") or "")
        kind = str(node.get("node_kind") or "")
        if not _SEMANTIC_ID.fullmatch(node_id) or not node_id.startswith(f"{kind}-"):
            raise StarterGraphError(f"invalid starter graph node {node_id!r}")
        if node_id in by_id:
            raise StarterGraphError(f"duplicate starter graph node {node_id}")
        by_id[node_id] = node
    module = by_id.get("module-the-haunting")
    projection = (
        module.get("properties", {}).get("runtime_projection")
        if isinstance(module, dict) else None
    )
    if not isinstance(projection, dict) or projection.get("contract_id") != PROJECTION_CONTRACT_ID:
        raise StarterGraphError("starter graph runtime projection missing")
    for document in projection.get("documents") or []:
        if not isinstance(document, dict) or document.get("filename") not in PROJECTED_DOCUMENTS:
            raise StarterGraphError("starter graph projected document invalid")
        for collection in document.get("collections") or []:
            for node_id in collection.get("node_ids") or []:
                if node_id not in by_id:
                    raise StarterGraphError(
                        f"starter graph projection references missing node {node_id}"
                    )
    for relation in graph.get("relations") or []:
        if relation.get("from_node_id") not in by_id or relation.get("to_node_id") not in by_id:
            raise StarterGraphError("starter graph relation endpoint missing")
    claims = {
        claim.get("claim_id"): claim
        for claim in graph.get("claims") or []
        if isinstance(claim, dict)
    }
    if len(claims) != len(graph.get("claims") or []):
        raise StarterGraphError("starter graph claim identities are invalid")
    for relation in graph.get("relations") or []:
        claim = claims.get(relation.get("claim_id"))
        if (
            not isinstance(claim, dict)
            or claim.get("subject_id") != relation.get("from_node_id")
            or claim.get("predicate") != relation.get("relation_kind")
            or claim.get("object") != {"node_id": relation.get("to_node_id")}
        ):
            raise StarterGraphError("starter graph relation claim binding is invalid")
    return {
        "module_id": graph["module_id"],
        "node_count": len(by_id),
        "relation_count": len(graph.get("relations") or []),
        "document_count": len(projection.get("documents") or []),
    }


def project_starter_documents(graph: dict[str, Any]) -> dict[str, dict[str, Any]]:
    validate_starter_graph(graph)
    by_id = {node["node_id"]: node for node in graph["nodes"]}
    projection = by_id["module-the-haunting"]["properties"]["runtime_projection"]
    documents: dict[str, dict[str, Any]] = {}
    for spec in projection["documents"]:
        filename = str(spec["filename"])
        document = _deepcopy(spec.get("root") or {})
        for collection in spec.get("collections") or []:
            name = str(collection["name"])
            records: list[Any] = []
            for node_id in collection.get("node_ids") or []:
                node = by_id[node_id]
                runtime = node.get("properties", {}).get("runtime_projection")
                if not isinstance(runtime, dict) or runtime.get("document") != filename:
                    raise StarterGraphError(
                        f"projection node {node_id} is not bound to {filename}"
                    )
                records.append(_deepcopy(runtime.get("record")))
            document[name] = records
        documents[filename] = document
    if set(documents) != set(PROJECTED_DOCUMENTS):
        raise StarterGraphError("starter graph projected document set is incomplete")
    return documents


def load_starter_graph(starter_dir: Path | str) -> dict[str, Any]:
    graph, _documents = load_starter_bundle(starter_dir)
    return graph


@functools.lru_cache(maxsize=16)
def _cached_starter_bundle(
    graph_path_text: str,
    modified_ns: int,
    size: int,
) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    del modified_ns, size
    graph = _read_object(Path(graph_path_text))
    validate_starter_graph(graph)
    return graph, project_starter_documents(graph)


def load_starter_bundle(
    starter_dir: Path | str,
) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    graph_path = (Path(starter_dir) / GRAPH_FILENAME).resolve()
    stat = graph_path.stat()
    graph, documents = _cached_starter_bundle(
        str(graph_path), stat.st_mtime_ns, stat.st_size
    )
    return _deepcopy(graph), _deepcopy(documents)


def install_starter_graph(coc_root: Path | str, graph: dict[str, Any]) -> dict[str, Any]:
    validate_starter_graph(graph)
    supplied_root = Path(coc_root)
    root = coc_module_assets.assets_root(supplied_root).parent
    workspace_root = root.parent
    module = next(node for node in graph["nodes"] if node["node_id"] == "module-the-haunting")
    asset_root_id = str(module["properties"].get("asset_root_id") or ASSET_ROOT_ID)
    graph_digest = _digest(graph)
    generation = f"generation-{graph_digest}"
    graph_root = root / "module-assets" / asset_root_id / "graph"
    graph_path = graph_root / "generations" / generation / "module-graph.json"
    reused = graph_path.is_file()
    if graph_path.is_file():
        existing = _read_object(graph_path)
        if _digest(existing) != graph_digest:
            raise StarterGraphError("starter graph generation path drifted")
    else:
        coc_fileio.write_json_atomic(
            graph_path,
            graph,
            indent=2,
            ensure_ascii=False,
            trailing_newline=True,
        )
    source_binding = module["properties"].get("source_binding") or {}
    manifest = {
        "contract_id": coc_module_graph.BUILD_MANIFEST_CONTRACT_ID,
        "schema_version": 1,
        "asset_root_id": asset_root_id,
        "module_id": graph["module_id"],
        "graph_contract_id": graph["contract_id"],
        "graph_schema_version": graph["schema_version"],
        "build_status": "complete",
        "current_generation": generation,
        "module_graph_path": f"generations/{generation}/module-graph.json",
        "module_graph_sha256": graph_digest,
        "source_languages": graph["source_languages"],
        "source_bundles": [
            {
                "source_id": SOURCE_ID,
                "bundle_sha256": source_binding.get("bundle_sha256"),
                "file_sha256": source_binding.get("file_sha256"),
            }
        ],
        "planned_shards": [],
        "accepted_shards": [],
        "missing_shards": [],
        "coverage": graph["coverage"],
    }
    if set(manifest) != coc_module_graph.BUILD_MANIFEST_KEYS:
        raise StarterGraphError("starter graph build manifest fields drifted")
    coc_fileio.write_json_atomic(
        graph_root / "manifest.json",
        manifest,
        indent=2,
        ensure_ascii=False,
        trailing_newline=True,
    )
    coc_module_graph.load_installed_module_graph_installation(
        workspace_root,
        asset_root_id=asset_root_id,
    )
    return {"asset_root_id": asset_root_id, "generation": generation, "reused": reused}


def install_local_source_assets(
    workspace: Path | str,
    starter_dir: Path | str,
    source_bundle: Path | str,
    packs_dir: Path | str,
) -> dict[str, Any]:
    """Install validated local bytes/packs without committing or translating them."""
    graph = load_starter_graph(starter_dir)
    module = next(node for node in graph["nodes"] if node["node_id"] == "module-the-haunting")
    source_binding = module["properties"].get("source_binding") or {}
    bundle = coc_pdf_bundle.load_host_bundle(Path(source_bundle))
    if bundle.get("bundle_sha256") != source_binding.get("bundle_sha256"):
        raise StarterGraphError("local source bundle does not match starter graph binding")
    if bundle.get("source", {}).get("file_sha256") != source_binding.get("file_sha256"):
        raise StarterGraphError("local source PDF does not match starter graph binding")
    workspace_path = Path(workspace)
    registered = coc_module_assets.register_source_bundle(
        workspace_path,
        bundle,
        asset_root_id=ASSET_ROOT_ID,
        module_identity={
            "canonical_module_id": ASSET_ROOT_ID,
            "canonical_title": "The Haunting",
            "rules_edition": "coc7",
            "locale": "en",
        },
    )
    expected_handouts = {
        str(node.get("properties", {}).get("asset_id")): node
        for node in graph["nodes"]
        if node.get("node_kind") == "handout"
        and node.get("properties", {}).get("asset_id")
    }
    installed: list[str] = []
    for path in sorted(Path(packs_dir).glob("*.json")):
        pack = _read_object(path)
        asset_id = str(pack.get("asset_id") or "")
        if asset_id not in expected_handouts:
            raise StarterGraphError(f"local handout pack {asset_id!r} is not in graph")
        cleaned = {
            key: _deepcopy(value)
            for key, value in pack.items()
            if not key.startswith("localized_") and key != "localized_text"
        }
        expected_ref = expected_handouts[asset_id]["properties"].get("image_ref")
        cleaned["when_to_deliver"] = expected_handouts[asset_id]["properties"].get(
            "when_to_deliver"
        )
        if expected_ref:
            cleaned["image_ref"] = expected_ref
        else:
            cleaned.pop("image_ref", None)
        if _contains_cjk(cleaned):
            raise StarterGraphError(f"local handout pack {asset_id} contains persisted translation")
        handout_id = str(cleaned.get("handout_id") or asset_id)
        coc_module_assets.put_entity(
            workspace_path,
            ASSET_ROOT_ID,
            "handout",
            handout_id,
            cleaned,
        )
        installed.append(asset_id)
    missing = sorted(set(expected_handouts) - set(installed))
    if missing:
        raise StarterGraphError(f"local source handout packs missing: {missing}")
    coc_root = coc_module_assets.assets_root(workspace_path).parent
    graph_install = install_starter_graph(coc_root, graph)
    return {
        "asset_root_id": registered["asset_root_id"],
        "pages": len(bundle["pages"]),
        "assets": len(bundle.get("assets") or []),
        "handouts": len(installed),
        "graph_generation": graph_install["generation"],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    build = sub.add_parser("build")
    build.add_argument("--starter-dir", required=True)
    build.add_argument("--output", required=True)
    project = sub.add_parser("project")
    project.add_argument("--graph", required=True)
    project.add_argument("--output-dir", required=True)
    install_assets = sub.add_parser("install-local-assets")
    install_assets.add_argument("--workspace", required=True)
    install_assets.add_argument("--starter-dir", required=True)
    install_assets.add_argument("--source-bundle", required=True)
    install_assets.add_argument("--packs-dir", required=True)
    args = parser.parse_args(argv)
    if args.command == "build":
        graph = build_starter_graph(Path(args.starter_dir))
        coc_fileio.write_json_atomic(
            Path(args.output), graph, indent=2, ensure_ascii=False,
            trailing_newline=True,
        )
        print(json.dumps(validate_starter_graph(graph), ensure_ascii=False))
        return 0
    if args.command == "project":
        graph = _read_object(Path(args.graph))
        output = Path(args.output_dir)
        for filename, document in project_starter_documents(graph).items():
            coc_fileio.write_json_atomic(
                output / filename, document, indent=2, ensure_ascii=False,
                trailing_newline=True,
            )
        return 0
    result = install_local_source_assets(
        Path(args.workspace), Path(args.starter_dir),
        Path(args.source_bundle), Path(args.packs_dir),
    )
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
