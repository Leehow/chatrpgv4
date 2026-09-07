#!/usr/bin/env python3
"""Project a starter's Scenario IR (the seven-to-nine JSON files under
`content/starters/<id>/`) into one v3 module graph (contract §14.9).

A port of the old tree's `coc_starter_graph.build_starter_graph`: the same
mechanical lift — records become nodes with their runtime record embedded, the
structured ids already inside those records become relations, nothing is read for
meaning — generalized from the one module it served to any starter directory:

- the module identity comes from `module-meta.json` (`scenario_id`, `title`) and the
  optional asset catalog `module-graph-assets.json` (source binding, reviewed pages,
  source entities, assets, handouts); a starter without a catalog has no source
  document node, no page refs and no assets, and says so;
- a document the starter does not ship is projected as an explicit empty declaration
  (`absent: true`, no records), never invented; the manifest lists them;
- a story graph that declares no `scene_edges` at all gets its routes derived from
  the authored exit/entry condition flags (an exit flag of A that is an entry flag of
  B is a route A→B), its entrance from the scene no derived route reaches and its
  ending from the scene no derived route leaves; every derived field is recorded on
  the node (`properties.derived`) and in the manifest;
- text outside the declared source languages is counted and reported, not refused.

Usage (from the worktree root):

    uv run --frozen python scripts/starter_graph.py build --starter-dir content/starters/mystery-house
    uv run --frozen python scripts/starter_graph.py diff  --starter-dir <old-tree>/the-haunting --against content/starters/the-haunting/module-graph.json
    uv run --frozen python scripts/starter_graph.py check --graph content/starters/mystery-house/module-graph.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = REPO_ROOT / "content" / "modules" / "module-graph-contract-v3.json"

PROJECTION_CONTRACT_ID = "coc.module-graph-runtime-projection.v1"
ASSET_CATALOG_CONTRACT_ID = "coc.starter-graph-assets.v1"
MANIFEST_CONTRACT_ID = "coc.module-graph-manifest.v1"
GRAPH_FILENAME = "module-graph.json"
MANIFEST_FILENAME = "module-graph-manifest.json"
ASSET_CATALOG_FILENAME = "module-graph-assets.json"
SECTION_ID = "section-curated-starter-projection"

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

# (collection name, runtime record kind, record id field or None for scalars)
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
#: §17.2: the dossier keys projected up to first-class `properties` on an npc node, so a
#: starter and a book built from a PDF are read the same way. The list is the module
#: contract's (`actor_dossier`), read from the same file the gates read.
NPC_PROFILE_KEYS: tuple[str, ...] = tuple(
    json.loads((Path(__file__).resolve().parents[1] / "content" / "modules"
                / "module-graph-contract-v3.json").read_text(encoding="utf-8"))["actor_dossier"]["profile_keys"])

# Which documents feed each coverage domain; a domain is `accepted` when every one of
# its documents is present, `partial` when some are, `absent` when none is.
DOMAIN_DOCUMENTS: dict[str, tuple[str, ...]] = {
    "structure": ("module-meta.json", "story-graph.json"),
    "world": ("story-graph.json",),
    "actors": ("npc-agendas.json",),
    "relationships": ("npc-agendas.json", "story-graph.json"),
    "events": ("story-graph.json", "threat-fronts.json"),
    "knowledge": ("clue-graph.json",),
    "causal": ("clue-graph.json",),
    "mechanics": ("story-graph.json", "npc-agendas.json"),
    "assets": ("handouts.json",),
    "direction": ("pacing-map.json", "improvisation-boundaries.json", "quests.json", "threat-fronts.json"),
}

_SEMANTIC_ID = re.compile(r"^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$")
_CJK = re.compile(r"[㐀-鿿぀-ヿ]")


class StarterGraphError(ValueError):
    """The curated starter IR or its projection is invalid."""


def _contract() -> dict[str, Any]:
    with open(CONTRACT_PATH, encoding="utf-8") as handle:
        return json.load(handle)


def _deepcopy(value: Any) -> Any:
    return json.loads(json.dumps(value, ensure_ascii=False))


def _canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


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


def _handle_of(node_id: str) -> str:
    """The handle the table uses for a node id (`clue-knott-commission` -> `knott-commission`),
    the same spelling `ModuleGraph.handle` produces."""
    kind, _, rest = node_id.partition("-")
    return rest or node_id


def _cjk_count(value: Any) -> int:
    return len(_CJK.findall(json.dumps(value, ensure_ascii=False)))


def _cjk_declared(source_languages: list[str]) -> bool:
    return any(str(row).lower().startswith(("zh", "ja")) for row in source_languages)


def _read_object(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise StarterGraphError(f"invalid JSON {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise StarterGraphError(f"{path} must contain one object")
    return value


def _record_id(filename: str, collection: str, kind: str, id_field: str | None, record: Any, ordinal: int) -> str:
    raw = ""
    if id_field is not None and isinstance(record, dict):
        raw = str(record.get(id_field) or "").strip()
    if not raw:
        raw = f"{Path(filename).stem}-{collection}-{ordinal + 1}"
    return _node_id(kind, raw)


def _summary(record: Any, fallback: str) -> str:
    if isinstance(record, dict):
        for field in ("summary", "player_safe_summary", "description", "title",
                      "display_name", "name", "note", "keeper_note"):
            value = record.get(field)
            if isinstance(value, str) and value.strip() and not _CJK.search(value):
                return value.strip()
    if isinstance(record, str) and record.strip() and not _CJK.search(record):
        return record.strip()
    return fallback.replace("-", " ")


def _record_source_refs(record: Any, page_map: dict[int, int], source_id: str | None) -> list[dict[str, Any]]:
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
                    refs[(pdf_index, anchor)] = {"source_id": source_id, "pdf_index": pdf_index, "grep_anchor": anchor}
            for child in value.values():
                visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)

    if source_id is not None:
        visit(record)
    return [refs[key] for key in sorted(refs)]


def _relation(relation_id: str, kind: str, from_node_id: str, to_node_id: str, *,
              properties: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"relation_id": relation_id, "relation_kind": kind, "from_node_id": from_node_id,
            "to_node_id": to_node_id, "claim_id": None, "properties": dict(properties or {})}


# ---- derived structure ---------------------------------------------------------------------

def derive_routes_from_flags(scene_records: list[tuple[str, dict[str, Any]]]) -> dict[str, Any]:
    """Routes from exit→entry condition flags, for a story graph with no scene_edges.
    Returns the routes, the entrances (no route in) and the endings (no route out)."""
    entries: dict[str, list[str]] = {}
    for node_id, record in scene_records:
        for flag in record.get("entry_conditions") or []:
            if isinstance(flag, str):
                entries.setdefault(flag, []).append(node_id)
    routes: list[tuple[str, str, str]] = []
    for node_id, record in scene_records:
        for flag in record.get("exit_conditions") or []:
            if not isinstance(flag, str):
                continue
            for target in entries.get(flag, []):
                if target != node_id and (node_id, target, flag) not in routes:
                    routes.append((node_id, target, flag))
    incoming = {target for _, target, _ in routes}
    outgoing = {source for source, _, _ in routes}
    order = [node_id for node_id, _ in scene_records]
    return {"routes": routes,
            "entrances": [n for n in order if n not in incoming],
            "endings": [n for n in order if n not in outgoing]}


# ---- the projection ------------------------------------------------------------------------

def build_starter_graph(starter_dir: Path | str, *, asset_catalog: Path | str | None = None,
                        module_name: str | None = None, module_summary: str | None = None,
                        source_document_id: str | None = None, source_document_name: str | None = None,
                        source_languages: list[str] | None = None) -> tuple[dict[str, Any], dict[str, Any]]:
    """Mechanically lift curated Scenario IR into one property graph.

    Returns (graph, accounting). No semantic reading: records and their source refs
    become graph properties; cross-record links come only from structured ids already
    present in those records. `accounting` is what the manifest reports: absent
    documents, text outside the declared languages, unregistered record fields, and
    every derived field."""
    contract = _contract()
    root = Path(starter_dir)
    meta = _read_object(root / "module-meta.json")
    scenario_id = str(meta.get("scenario_id") or root.name)
    module_id = _node_id("module", scenario_id)
    catalog_path = Path(asset_catalog) if asset_catalog else root / ASSET_CATALOG_FILENAME
    catalog = _read_object(catalog_path) if catalog_path.exists() else None

    declared_languages = list(source_languages or [])
    if not declared_languages:
        if isinstance(meta.get("source_languages"), list):
            declared_languages = [str(v) for v in meta["source_languages"]]
        elif isinstance(meta.get("source_language"), str):
            declared_languages = [meta["source_language"]]
        elif catalog and isinstance(catalog.get("source_language"), str):
            declared_languages = [catalog["source_language"]]
    if not declared_languages:
        raise StarterGraphError("module-meta.json declares no source_language; pass --source-languages")

    accounting: dict[str, Any] = {"module_id": module_id, "scenario_id": scenario_id,
                                  "catalog": str(catalog_path.name) if catalog else None,
                                  "source_languages": declared_languages, "absent_documents": [],
                                  "cjk_outside_declared_languages": {}, "unregistered_fields": {},
                                  "derived": {}}

    source_id: str | None = None
    printed_to_pdf: dict[int, int] = {}
    page_rows: list[dict[str, Any]] = []
    if catalog:
        if catalog.get("contract_id") != ASSET_CATALOG_CONTRACT_ID:
            raise StarterGraphError("starter asset catalog contract mismatch")
        if catalog.get("module_id") != module_id:
            raise StarterGraphError(f"starter asset catalog is for {catalog.get('module_id')!r}, not {module_id!r}")
        page_rows = [row for row in catalog.get("source_pages") or [] if isinstance(row, dict)]
        if not page_rows:
            raise StarterGraphError("starter asset catalog requires source_pages")
        printed_to_pdf = {int(row["printed_page"]): int(row["pdf_index"]) for row in page_rows}
        if len(printed_to_pdf) != len(page_rows):
            raise StarterGraphError("starter source page map is invalid")
        source_id = str((catalog.get("source_binding") or {}).get("source_id") or "")
        if not source_id:
            raise StarterGraphError("starter asset catalog source_binding needs a source_id")

    module_node: dict[str, Any] = {
        "node_id": module_id,
        "node_kind": "module",
        "name": module_name or str(meta.get("title") or scenario_id),
        "visibility": "keeper-only",
        "aliases": [],
        "summary": module_summary or _summary({"summary": meta.get("one_liner")}, module_id),
        "evidence_span_ids": [],
        "properties": {
            "asset_root_id": meta.get("module_graph_asset_root_id"),
            "source_binding": _deepcopy((catalog or {}).get("source_binding") or {}),
            "runtime_projection": {"contract_id": PROJECTION_CONTRACT_ID, "documents": []},
        },
        "source_refs": [],
    }
    nodes: dict[str, dict[str, Any]] = {module_id: module_node}
    relations: list[dict[str, Any]] = []
    projection_documents: list[dict[str, Any]] = []
    relation_ordinal = 0

    #: §17.2: relation id -> the claim's truth status when it is not `authored-fact`. The
    #: starter IR states a lie as a lie; stamping it `authored-fact` like everything else
    #: would make the table read it as something the person truly says.
    claim_truth: dict[str, str] = {}

    def add_relation(kind: str, source: str, target: str, truth_status: str | None = None,
                     **properties: Any) -> None:
        nonlocal relation_ordinal
        relation_ordinal += 1
        relation_id = f"relation-{kind}-{relation_ordinal}"
        if truth_status:
            claim_truth[relation_id] = truth_status
        relations.append(_relation(relation_id, kind, source, target, properties=properties))

    registry = contract.get("record_field_registry") or {}
    for filename in PROJECTED_DOCUMENTS:
        path = root / filename
        if not path.exists():
            accounting["absent_documents"].append(filename)
            projection_documents.append({"filename": filename, "root": {}, "absent": True,
                                         "collections": [{"name": collection, "node_ids": []}
                                                         for collection, _kind, _field in COLLECTION_SPECS.get(filename, ())]})
            continue
        document = _read_object(path)
        cjk = _cjk_count(document)
        if cjk and not _cjk_declared(declared_languages):
            accounting["cjk_outside_declared_languages"][filename] = cjk
        root_record = _deepcopy(document)
        collection_rows: list[dict[str, Any]] = []
        for collection, kind, id_field in COLLECTION_SPECS.get(filename, ()):
            raw_records = root_record.pop(collection, None)
            if not isinstance(raw_records, list):
                raise StarterGraphError(f"{filename}.{collection} must be an array")
            registered = set((registry.get(filename) or {}).get(collection) or [])
            ordered_ids: list[str] = []
            for ordinal, record in enumerate(raw_records):
                node_id = _record_id(filename, collection, kind, id_field, record, ordinal)
                if node_id in nodes:
                    raise StarterGraphError(f"duplicate projection node {node_id}")
                if registered and isinstance(record, dict):
                    extra = sorted(set(record) - registered)
                    if extra:
                        accounting["unregistered_fields"].setdefault(f"{filename}.{collection}", {})[node_id] = extra
                source_refs = _record_source_refs(record, printed_to_pdf, source_id)
                nodes[node_id] = {
                    "node_id": node_id,
                    "node_kind": kind,
                    "name": _summary(record, node_id),
                    "visibility": "keeper-only",
                    "aliases": [],
                    "summary": _summary(record, node_id),
                    "evidence_span_ids": [],
                    "properties": {"runtime_projection": {"document": filename, "collection": collection,
                                                          "record": _deepcopy(record)}},
                    "source_refs": source_refs,
                }
                ordered_ids.append(node_id)
                add_relation("contains", module_id, node_id)
            collection_rows.append({"name": collection, "node_ids": ordered_ids})
        projection_documents.append({"filename": filename, "root": root_record, "collections": collection_rows})

    module_node["properties"]["runtime_projection"]["documents"] = projection_documents

    # Player-safe clue nodes are queryable separately from the Keeper-only lossless
    # conclusion projection records.
    clue_path = root / "clue-graph.json"
    clue_document = _read_object(clue_path) if clue_path.exists() else {}
    conclusion_projection = {
        str(node["properties"]["runtime_projection"]["record"].get("conclusion_id")): node_id
        for node_id, node in nodes.items()
        if node.get("node_kind") == "conclusion"
        and isinstance(node.get("properties", {}).get("runtime_projection", {}).get("record"), dict)
    }
    for conclusion in clue_document.get("conclusions") or []:
        if not isinstance(conclusion, dict):
            continue
        target_node = conclusion_projection.get(str(conclusion.get("conclusion_id") or ""))
        for clue in conclusion.get("clues") or []:
            if not isinstance(clue, dict) or not clue.get("clue_id"):
                continue
            clue_id = _node_id("clue", str(clue["clue_id"]))
            if clue_id not in nodes:
                nodes[clue_id] = {
                    "node_id": clue_id,
                    "node_kind": "clue",
                    "name": _summary(clue, clue_id),
                    "visibility": "revealable",
                    "aliases": [],
                    "summary": _summary(clue, clue_id),
                    "evidence_span_ids": [],
                    "properties": {"delivery_kind": clue.get("delivery_kind"),
                                   "handout_asset_id": clue.get("handout_asset_id")},
                    "source_refs": _record_source_refs(clue, printed_to_pdf, source_id),
                }
                add_relation("contains", module_id, clue_id)
            if target_node:
                add_relation("supports", clue_id, target_node)

    # Structured scene edges become real graph routes.
    scene_records: list[tuple[str, dict[str, Any]]] = []
    for node_id, node in list(nodes.items()):
        projection = node.get("properties", {}).get("runtime_projection")
        record = projection.get("record") if isinstance(projection, dict) else None
        if node.get("node_kind") != "scene" or not isinstance(record, dict):
            continue
        scene_records.append((node_id, record))
        for edge in record.get("scene_edges") or []:
            if not isinstance(edge, dict) or not edge.get("to"):
                continue
            target = _node_id("scene", str(edge["to"]))
            if target in nodes:
                add_relation("route-to", node_id, target, edge_kind=edge.get("kind"), when=edge.get("when"))

    # A story graph that authored no edges at all: routes, entrance and ending are
    # derived from its exit/entry flags and every derivation is written down.
    if scene_records and not any(record.get("scene_edges") for _, record in scene_records):
        derived = derive_routes_from_flags(scene_records)
        for source, target, flag in derived["routes"]:
            add_relation("route-to", source, target, edge_kind="derived", derived_from="exit-entry-flag", flag=flag)
        starts = [n for n, r in scene_records if r.get("is_start") is True]
        finals = [n for n, r in scene_records if r.get("is_final") is True]
        if not starts:
            if len(derived["entrances"]) != 1:
                raise StarterGraphError(f"derived entrances are not unique: {derived['entrances']}; fix the IR")
            for node_id in derived["entrances"]:
                nodes[node_id]["properties"]["runtime_projection"]["record"]["is_start"] = True
                nodes[node_id]["properties"].setdefault("derived", []).append("is_start")
            starts = derived["entrances"]
        if not finals:
            for node_id in derived["endings"]:
                nodes[node_id]["properties"]["runtime_projection"]["record"]["is_final"] = True
                nodes[node_id]["properties"].setdefault("derived", []).append("is_final")
            finals = derived["endings"]
        module_node["properties"]["entry_scene_ids"] = list(starts)
        module_node["properties"]["ending_scene_ids"] = list(finals)
        accounting["derived"] = {"rule": "exit-entry-flag", "route_to": len(derived["routes"]),
                                 "entry_scene_ids": starts, "ending_scene_ids": finals}

    source_node_id: str | None = None
    if catalog:
        source_node_id = source_document_id or _node_id("source-document", source_id.split(":", 1)[-1])
        indices = sorted(int(row["pdf_index"]) for row in page_rows)
        nodes[source_node_id] = {
            "node_id": source_node_id,
            "node_kind": "source-document",
            "name": source_document_name or f"{module_node['name']} source document",
            "visibility": "keeper-only",
            "aliases": [],
            "summary": f"The visually reviewed source window at PDF indices {indices[0]} through {indices[-1]}.",
            "evidence_span_ids": [],
            "properties": {"source_id": source_id},
            "source_refs": [{"source_id": source_id, "pdf_index": int(row["pdf_index"])} for row in page_rows],
        }
        add_relation("contains", source_node_id, module_id)

        node_kinds = set(contract["node_kinds"])
        relation_kinds = set(contract["relation_kinds"])
        for raw in catalog.get("source_entities") or []:
            if not isinstance(raw, dict):
                raise StarterGraphError("source entity catalog row must be an object")
            node_id = str(raw.get("node_id") or "")
            kind = str(raw.get("node_kind") or "")
            if kind not in node_kinds or not _SEMANTIC_ID.fullmatch(node_id) or not node_id.startswith(f"{kind}-"):
                raise StarterGraphError(f"source entity {node_id!r} has invalid identity")
            if node_id in nodes:
                raise StarterGraphError(f"duplicate source entity node {node_id}")
            pdf_indices = raw.get("pdf_indices") or []
            if not isinstance(pdf_indices, list) or not pdf_indices or any(not isinstance(i, int) for i in pdf_indices):
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
                "source_refs": [{"source_id": source_id, "pdf_index": index} for index in sorted(set(pdf_indices))],
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
                "properties": {"asset_ref": raw.get("asset_ref"), "media_type": raw.get("media_type"),
                               "role": raw.get("role"), "pdf_index": pdf_index, "local_bytes_required": True},
                "source_refs": [{"source_id": source_id, "pdf_index": pdf_index}],
            }
            add_relation("contains", source_node_id, asset_id)
            for target in raw.get("depicts_node_ids") or []:
                if str(target) in nodes:
                    add_relation("depicts", asset_id, str(target))
            variant = raw.get("variant_of")
            if isinstance(variant, str) and variant in nodes:
                add_relation("variant-of", asset_id, variant)

        for raw in catalog.get("handouts") or []:
            if not isinstance(raw, dict):
                raise StarterGraphError("handout catalog row must be an object")
            handout_id = _node_id("handout", str(raw.get("asset_id") or ""))
            source_refs = [{"source_id": source_id, "pdf_index": int(index)} for index in raw.get("source_page_indices") or []]
            existing = nodes.get(handout_id)
            if existing is None:
                existing = {
                    "node_id": handout_id, "node_kind": "handout", "name": str(raw.get("title") or handout_id),
                    "visibility": "player-safe", "aliases": [],
                    "summary": str(raw.get("summary") or raw.get("title") or handout_id),
                    "evidence_span_ids": [], "properties": {}, "source_refs": source_refs,
                }
                nodes[handout_id] = existing
                add_relation("contains", source_node_id, handout_id)
            existing["properties"].update({
                "asset_id": raw.get("asset_id"), "kind": raw.get("kind"), "player_visible": True,
                "source_page_indices": raw.get("source_page_indices") or [],
                "image_asset_id": raw.get("image_asset_id"), "image_ref": raw.get("image_ref"),
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
            if (not _SEMANTIC_ID.fullmatch(relation_id) or kind not in relation_kinds
                    or relation_id in existing_relation_ids or source not in nodes or target not in nodes):
                raise StarterGraphError(f"source relation {relation_id!r} is invalid")
            relations.append(_relation(relation_id, kind, source, target, properties=_deepcopy(raw.get("properties") or {})))
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

    # §17.2: the dossier the keeper plays a person from becomes first-class properties, and
    # what they know becomes `knows` claims — the same two readings a built book gives.
    # `min_trust` is dropped: nothing consumes it, and a number no rule reads is not a fact.
    for npc_id, npc_node in sorted(nodes.items()):
        if npc_node.get("node_kind") != "npc":
            continue
        record = (npc_node.get("properties", {}).get("runtime_projection") or {}).get("record")
        if not isinstance(record, dict):
            continue
        for key in NPC_PROFILE_KEYS:
            value = record.get(key)
            if isinstance(value, str) and value.strip():
                npc_node["properties"][key] = value.strip()
        by_fact: dict[str, str] = {}
        for fact in record.get("facts") or []:
            if not isinstance(fact, dict):
                continue
            clue_node = _node_id("clue", str(fact.get("clue_id")))
            if clue_node in nodes and nodes[clue_node].get("node_kind") == "clue":
                add_relation("knows", npc_id, clue_node)
                if isinstance(fact.get("fact_id"), str):
                    by_fact[fact["fact_id"]] = clue_node
        # §17.2: what he would say instead of the plain truth. A lie is about a fact, so it
        # is an `asserts` claim on that clue; a deflection is a line, and the contract keeps
        # prose in `properties` -- so the line stays there, next to the fact it stalls.
        for lie in record.get("lie_options") or []:
            clue_node = by_fact.get(str(lie.get("fact_id"))) if isinstance(lie, dict) else None
            if clue_node:
                add_relation("asserts", npc_id, clue_node, truth_status="authored-lie")
        deflects = [{"line": d["player_safe_line"],
                     **({"clue": _handle_of(by_fact[str(d.get("fact_id"))])} if by_fact.get(str(d.get("fact_id"))) else {})}
                    for d in record.get("deflect_options") or []
                    if isinstance(d, dict) and isinstance(d.get("player_safe_line"), str) and d["player_safe_line"].strip()]
        if deflects:
            npc_node["properties"]["deflect_lines"] = deflects

    # Quest target refs are already structured authoring decisions.
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

    # Stable semantic EvidenceSpan ids bind projection nodes to exact reviewed
    # page/anchor pairs.
    anchor_keys = sorted({
        (int(ref["pdf_index"]), str(ref["grep_anchor"]))
        for node in nodes.values()
        for ref in node.get("source_refs") or []
        if isinstance(ref, dict) and isinstance(ref.get("pdf_index"), int)
        and isinstance(ref.get("grep_anchor"), str) and ref["grep_anchor"]
    })
    span_ids: dict[tuple[int, str], str] = {}
    page_ordinals: dict[int, int] = {}
    for pdf_index, anchor in anchor_keys:
        page_ordinals[pdf_index] = page_ordinals.get(pdf_index, 0) + 1
        span_ids[(pdf_index, anchor)] = f"span-page-{pdf_index}-anchor-{page_ordinals[pdf_index]}"
    for node in nodes.values():
        node["evidence_span_ids"] = sorted({
            span_ids[(int(ref["pdf_index"]), str(ref["grep_anchor"]))]
            for ref in node.get("source_refs") or []
            if isinstance(ref, dict) and (int(ref.get("pdf_index", -1)), str(ref.get("grep_anchor") or "")) in span_ids
        })
    module_node["evidence_span_ids"] = sorted(span_ids.values())

    for relation in relations:
        source_kind = nodes[relation["from_node_id"]]["node_kind"]
        if relation["relation_kind"] == "contains" and source_kind in {"module", "source-document"}:
            relation["properties"]["context_traversal"] = False

    claims: list[dict[str, Any]] = []
    for relation in sorted(relations, key=lambda row: row["relation_id"]):
        claim_id = f"claim-{relation['relation_id'][len('relation-'):]}"
        relation["claim_id"] = claim_id
        source_node = nodes[relation["from_node_id"]]
        target_node = nodes[relation["to_node_id"]]
        visibilities = {source_node["visibility"], target_node["visibility"]}
        visibility = ("keeper-only" if "keeper-only" in visibilities
                      else ("revealable" if "revealable" in visibilities else "player-safe"))
        claims.append({
            "claim_id": claim_id,
            "subject_id": relation["from_node_id"],
            "predicate": relation["relation_kind"],
            "object": {"node_id": relation["to_node_id"]},
            "truth_status": claim_truth.get(relation["relation_id"], "authored-fact"),
            "visibility": visibility,
            "evidence_span_ids": sorted({*source_node.get("evidence_span_ids", []), *target_node.get("evidence_span_ids", [])}),
            "asserted_by_ids": [],
            "known_by_ids": [],
            "validity": None,
            "confidence": 1.0,
            "reason": "Structured curated starter projection.",
        })

    present_documents = [d["filename"] for d in projection_documents if not d.get("absent")]
    coverage: dict[str, str] = {}
    for domain in contract["coverage_domains"]:
        sources = DOMAIN_DOCUMENTS.get(domain, ())
        have = sum(1 for filename in sources if filename in present_documents)
        coverage[domain] = "accepted" if have == len(sources) else ("partial" if have else "absent")
    graph = {
        "contract_id": contract["graph_contract_id"],
        "schema_version": contract["schema_version"],
        "module_id": module_id,
        "source_languages": declared_languages,
        "section_ids": [SECTION_ID],
        "coverage": coverage,
        "coverage_by_section": {SECTION_ID: coverage},
        "node_refs_by_section": {SECTION_ID: []},
        "nodes": [nodes[key] for key in sorted(nodes)],
        "claims": claims,
        "relations": sorted(relations, key=lambda row: row["relation_id"]),
        "source_refs": [{"source_id": source_id, "pdf_index": int(row["pdf_index"])} for row in page_rows],
    }
    validate_starter_graph(graph)
    return graph, accounting


def validate_starter_graph(graph: dict[str, Any]) -> dict[str, Any]:
    """Shape only: the v3 vocabulary, id laws, endpoints, claim bindings, and the
    projection's document and collection registration."""
    contract = _contract()
    if graph.get("contract_id") != contract["graph_contract_id"]:
        raise StarterGraphError("starter graph contract mismatch")
    if graph.get("schema_version") != contract["schema_version"]:
        raise StarterGraphError("starter graph schema mismatch")
    node_kinds = set(contract["node_kinds"])
    relation_kinds = set(contract["relation_kinds"])
    by_id: dict[str, dict[str, Any]] = {}
    for node in graph.get("nodes") or []:
        node_id = str(node.get("node_id") or "")
        kind = str(node.get("node_kind") or "")
        if kind not in node_kinds or not _SEMANTIC_ID.fullmatch(node_id) or not node_id.startswith(f"{kind}-"):
            raise StarterGraphError(f"invalid graph node {node_id!r}")
        if node_id in by_id:
            raise StarterGraphError(f"duplicate graph node {node_id}")
        by_id[node_id] = node
    claims = {c.get("claim_id"): c for c in graph.get("claims") or []}
    if len(claims) != len(graph.get("claims") or []):
        raise StarterGraphError("graph claim identities are invalid")
    for relation in graph.get("relations") or []:
        if relation.get("relation_kind") not in relation_kinds:
            raise StarterGraphError(f"unknown relation kind {relation.get('relation_kind')!r}")
        if relation.get("from_node_id") not in by_id or relation.get("to_node_id") not in by_id:
            raise StarterGraphError(f"graph relation {relation.get('relation_id')} endpoint missing node")
        claim = claims.get(relation.get("claim_id"))
        if (not isinstance(claim, dict) or claim.get("subject_id") != relation.get("from_node_id")
                or claim.get("predicate") != relation.get("relation_kind")
                or claim.get("object") != {"node_id": relation.get("to_node_id")}):
            raise StarterGraphError("graph relation claim binding is invalid")
    modules = [n for n in by_id.values() if n.get("node_kind") == "module"]
    if len(modules) != 1:
        raise StarterGraphError("graph must carry exactly one module node")
    declaration = modules[0]["properties"]["runtime_projection"]
    if declaration.get("contract_id") != PROJECTION_CONTRACT_ID:
        raise StarterGraphError("module node runtime projection contract mismatch")
    declared: list[str] = []
    bound: set[str] = set()
    for document in declaration.get("documents") or []:
        filename = str(document.get("filename") or "")
        if filename not in PROJECTED_DOCUMENTS or filename in declared:
            raise StarterGraphError(f"projected document {filename!r} is not registered or declared twice")
        declared.append(filename)
        spec_names = {name for name, _k, _f in COLLECTION_SPECS.get(filename, ())}
        for collection in document.get("collections") or []:
            if collection.get("name") not in spec_names:
                raise StarterGraphError(f"{filename} collection {collection.get('name')!r} is not registered")
            for node_id in collection.get("node_ids") or []:
                if node_id not in by_id or node_id in bound:
                    raise StarterGraphError(f"projection references missing or twice-bound node {node_id}")
                bound.add(node_id)
                runtime = by_id[node_id].get("properties", {}).get("runtime_projection") or {}
                if runtime.get("document") != filename:
                    raise StarterGraphError(f"projection node {node_id} is not bound to {filename}")
    if set(declared) != set(PROJECTED_DOCUMENTS):
        raise StarterGraphError("starter graph must declare every projected document (absent ones as empty)")
    return {"module_id": graph["module_id"], "node_count": len(by_id),
            "relation_count": len(graph.get("relations") or []), "document_count": len(declared)}


def build_manifest(graph: dict[str, Any], accounting: dict[str, Any]) -> dict[str, Any]:
    """The summary beside the graph, hashed the way the rule graph is (no timestamp, so
    a re-projection reproduces it byte for byte)."""
    kinds: dict[str, int] = {}
    for node in graph["nodes"]:
        kinds[node["node_kind"]] = kinds.get(node["node_kind"], 0) + 1
    return {
        "contract_id": MANIFEST_CONTRACT_ID,
        "schema_version": 1,
        "module_id": graph["module_id"],
        "generation": 1,
        "graph_contract_id": graph["contract_id"],
        "graph_content_digest": _digest(graph),
        "node_count": len(graph["nodes"]),
        "relation_count": len(graph["relations"]),
        "claim_count": len(graph["claims"]),
        "node_kinds": dict(sorted(kinds.items())),
        "section_ids": list(graph["section_ids"]),
        "coverage": dict(graph["coverage"]),
        "projector": "scripts/starter_graph.py",
        "projection": accounting,
    }


def dumps(payload: Any) -> str:
    return json.dumps(payload, indent=2, ensure_ascii=False) + "\n"


# ---- CLI ---------------------------------------------------------------------------------------

def _common(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--starter-dir", required=True)
    parser.add_argument("--asset-catalog")
    parser.add_argument("--module-name")
    parser.add_argument("--module-summary")
    parser.add_argument("--source-document-id")
    parser.add_argument("--source-document-name")
    parser.add_argument("--source-languages", nargs="*")


def _build_from_args(args: argparse.Namespace) -> tuple[dict[str, Any], dict[str, Any]]:
    return build_starter_graph(Path(args.starter_dir), asset_catalog=args.asset_catalog,
                               module_name=args.module_name, module_summary=args.module_summary,
                               source_document_id=args.source_document_id,
                               source_document_name=args.source_document_name,
                               source_languages=args.source_languages)


def _diff_report(expected: str, actual: str) -> dict[str, Any]:
    if expected == actual:
        return {"identical": True}
    old = json.loads(expected)
    new = json.loads(actual)
    differences: list[str] = []

    def walk(a: Any, b: Any, path: str) -> None:
        if len(differences) >= 40:
            return
        if isinstance(a, dict) and isinstance(b, dict):
            for key in sorted(set(a) | set(b)):
                if key not in a or key not in b:
                    differences.append(f"{path}/{key}: {'missing in new' if key not in b else 'missing in old'}")
                else:
                    walk(a[key], b[key], f"{path}/{key}")
        elif isinstance(a, list) and isinstance(b, list):
            if len(a) != len(b):
                differences.append(f"{path}: length {len(a)} -> {len(b)}")
            for index, (x, y) in enumerate(zip(a, b)):
                key = x.get("node_id") or x.get("relation_id") or x.get("claim_id") if isinstance(x, dict) else None
                walk(x, y, f"{path}[{key or index}]")
        elif a != b:
            differences.append(f"{path}: {json.dumps(a, ensure_ascii=False)[:80]} -> {json.dumps(b, ensure_ascii=False)[:80]}")

    walk(old, new, "")
    return {"identical": False, "differences": differences}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    build = sub.add_parser("build", help="project a starter directory to module-graph.json (+ manifest)")
    _common(build)
    build.add_argument("--output", help="graph path (default <starter-dir>/module-graph.json)")
    build.add_argument("--manifest", help="manifest path (default <starter-dir>/module-graph-manifest.json)")
    diff = sub.add_parser("diff", help="re-project and compare byte for byte against a committed graph")
    _common(diff)
    diff.add_argument("--against", required=True)
    check = sub.add_parser("check", help="run the kernel's playability check on a graph")
    check.add_argument("--graph", required=True)
    args = parser.parse_args(argv)

    if args.command == "build":
        graph, accounting = _build_from_args(args)
        output = Path(args.output) if args.output else Path(args.starter_dir) / GRAPH_FILENAME
        manifest_path = Path(args.manifest) if args.manifest else Path(args.starter_dir) / MANIFEST_FILENAME
        output.write_text(dumps(graph), encoding="utf-8")
        manifest = build_manifest(graph, accounting)
        manifest_path.write_text(dumps(manifest), encoding="utf-8")
        print(json.dumps({"graph": str(output), "manifest": str(manifest_path),
                          **validate_starter_graph(graph), "projection": accounting}, ensure_ascii=False))
        return 0
    if args.command == "diff":
        graph, _ = _build_from_args(args)
        expected = Path(args.against).read_text(encoding="utf-8")
        report = _diff_report(expected, dumps(graph))
        print(json.dumps(report, ensure_ascii=False, indent=1))
        return 0 if report["identical"] else 1
    sys.path.insert(0, str(REPO_ROOT / "kernel"))
    from coc.modules.playability import check as playability_check  # type: ignore[import-not-found]
    graph = _read_object(Path(args.graph))
    report = playability_check(graph)
    print(json.dumps({"status": report["status"], "finding_counts": report["finding_counts"],
                      "measures": report["measures"]}, ensure_ascii=False, indent=1))
    return 0 if report["status"] == "playable" else 1


if __name__ == "__main__":
    raise SystemExit(main())
