#!/usr/bin/env python3
"""Module-agnostic runtime projection core for accepted ModuleGraphs.

One projector serves every graph-backed module. A graph carries its runtime
projection either embedded in node properties (the committed starter form) or
as a digest-bound sidecar written by the forward path
(prepare-packet -> extraction pass -> validate-records -> attach). Both
carriers load into one internal shape and project into identical documents.

Spec: docs/specs/pi-coc-module-source-pipeline-unification.md (Stage A).
"""
from __future__ import annotations

import argparse
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
import coc_module_graph


PROJECTION_CONTRACT_ID = "coc.module-graph-runtime-projection.v1"
PACKET_CONTRACT_ID = "coc.module-projection-packet.v1"
SIDECAR_FILENAME = "runtime-projection.json"

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

# Registered top-level record fields per document collection. A field lands
# here only after its consumer is confirmed; an unregistered field is an exact
# finding, never silently carried (the keeper_notes dead-field class).
RECORD_FIELD_REGISTRY: dict[str, dict[str, frozenset[str]]] = {
    "story-graph.json": {
        # Field set confirmed against coc-scenario-import's
        # story-graph-schema.md §2 (six-field scene contract, structured
        # edges/threat affinity, time-loop signals) plus the committed
        # starter's legacy fields.
        "scenes": frozenset({
            "affordances", "allowed_improvisation", "available_clues",
            "conclusion_contract", "destination_access", "destination_identity",
            "display_name", "dramatic_question", "entry_conditions",
            "exit_conditions", "exit_options", "failure_modes", "faction_ids",
            "goals", "is_final", "is_start", "location_tags", "loop_boundary",
            "mentions", "mode_affinity", "npc_ids",
            "npc_presence_requirements", "on_enter", "optional_rules",
            "origin", "player_retained_memory_ids", "player_safe_summary",
            "pressure_moves",
            "read_aloud", "required_reveals", "scene_contract", "scene_edges",
            "scene_function", "scene_id", "scene_tags", "scene_type",
            "source_refs", "storylet_tags", "threat_front_ids", "tone",
        }),
    },
    "clue-graph.json": {
        "conclusions": frozenset({
            "clues", "conclusion_id", "description", "fallback_policy",
            "importance", "minimum_routes", "origin",
        }),
    },
    "npc-agendas.json": {
        "npcs": frozenset({
            "active_reactions", "agenda", "availability", "deflect_options",
            "disclosure_order", "facts", "fear", "foreign_dialogue",
            "keeper_note", "known_fact_ids", "leverage_ids", "lie_options",
            "name", "npc_id", "origin", "player_safe_summary",
            "relationship_to_investigators",
            "revealable_fact_ids", "schedule", "secret", "social_role",
            "source_refs", "stats", "stats_absent", "voice",
        }),
    },
    "threat-fronts.json": {
        "fronts": frozenset({
            "clocks", "dangers", "description", "faction_ids", "front_id",
            "origin", "scene_ids", "scene_tags_any", "scope", "severity",
            "source_refs",
        }),
    },
    "pacing-map.json": {
        "pacing_curve": frozenset({
            "horror_stage", "note", "scene_id", "tension_target",
        }),
    },
    "improvisation-boundaries.json": {
        "invent_allowed": frozenset(),
        "keeper_secrets": frozenset({"category", "id", "prose"}),
        "never_invent": frozenset(),
    },
    "quests.json": {
        "quests": frozenset({
            "brief", "completion", "deadline", "destination_scene_id",
            "failure", "giver", "importance", "mainline_links",
            "player_safe_summary", "provenance", "quest_id", "quest_kinds",
            "secret", "source_refs", "target_refs", "title",
        }),
    },
    "handouts.json": {
        "handouts": frozenset({
            "asset_id", "authored_text", "clue_refs", "content_origin", "kind",
            "origin", "player_visible", "provenance", "source_type", "summary",
            "title", "when_to_deliver",
        }),
    },
    "module-meta.json": {},
}

_SEMANTIC_ID = re.compile(r"^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$")
_CJK = re.compile(r"[㐀-鿿぀-ヿ]")
_MACHINE_KEYS = frozenset({
    "sha256", "text_sha256", "grep_anchor", "bundle_sha256", "digest",
})


class ModuleProjectionError(ValueError):
    """A projection carrier, packet, or record set failed a closed check."""


def _deepcopy(value: Any) -> Any:
    return json.loads(json.dumps(value))


def _canonical_bytes(value: Any) -> bytes:
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")


def graph_digest(graph: dict[str, Any]) -> str:
    return hashlib.sha256(_canonical_bytes(graph)).hexdigest()


def _contains_cjk(value: Any) -> bool:
    return bool(_CJK.search(json.dumps(value, ensure_ascii=False)))


def _cjk_allowed(source_languages: Any) -> bool:
    rows = source_languages if isinstance(source_languages, list) else []
    return any(
        str(row).lower().startswith(("zh", "ja")) for row in rows
    )


def _nodes_by_id(graph: dict[str, Any]) -> dict[str, dict[str, Any]]:
    nodes = graph.get("nodes")
    if not isinstance(nodes, list) or not nodes:
        raise ModuleProjectionError("graph requires nodes")
    by_id: dict[str, dict[str, Any]] = {}
    for node in nodes:
        if not isinstance(node, dict):
            raise ModuleProjectionError("graph node must be an object")
        node_id = str(node.get("node_id") or "")
        kind = str(node.get("node_kind") or "")
        if not _SEMANTIC_ID.fullmatch(node_id) or not node_id.startswith(f"{kind}-"):
            raise ModuleProjectionError(f"invalid graph node {node_id!r}")
        if node_id in by_id:
            raise ModuleProjectionError(f"duplicate graph node {node_id}")
        by_id[node_id] = node
    return by_id


def _check_graph_shape(graph: dict[str, Any]) -> dict[str, dict[str, Any]]:
    if graph.get("contract_id") != coc_module_graph.GRAPH_CONTRACT_ID:
        raise ModuleProjectionError("graph contract mismatch")
    if graph.get("schema_version") != coc_module_graph.SCHEMA_VERSION:
        raise ModuleProjectionError("graph schema mismatch")
    by_id = _nodes_by_id(graph)
    claims = {
        claim.get("claim_id"): claim
        for claim in graph.get("claims") or []
        if isinstance(claim, dict)
    }
    if len(claims) != len(graph.get("claims") or []):
        raise ModuleProjectionError("graph claim identities are invalid")
    for relation in graph.get("relations") or []:
        if relation.get("from_node_id") not in by_id or relation.get("to_node_id") not in by_id:
            raise ModuleProjectionError("graph relation endpoint missing node")
        claim = claims.get(relation.get("claim_id"))
        if (
            not isinstance(claim, dict)
            or claim.get("subject_id") != relation.get("from_node_id")
            or claim.get("predicate") != relation.get("relation_kind")
            or claim.get("object") != {"node_id": relation.get("to_node_id")}
        ):
            raise ModuleProjectionError("graph relation claim binding is invalid")
    return by_id


def _embedded_projection(
    graph: dict[str, Any], by_id: dict[str, dict[str, Any]]
) -> dict[str, Any] | None:
    modules = [
        node for node in by_id.values()
        if node.get("node_kind") == "module"
        and isinstance(node.get("properties", {}).get("runtime_projection"), dict)
        and node["properties"]["runtime_projection"].get("contract_id")
        == PROJECTION_CONTRACT_ID
    ]
    if not modules:
        return None
    if len(modules) > 1:
        raise ModuleProjectionError("graph declares more than one runtime projection")
    module = modules[0]
    declaration = module["properties"]["runtime_projection"]
    records: dict[str, dict[str, Any]] = {}
    for node_id, node in by_id.items():
        runtime = node.get("properties", {}).get("runtime_projection")
        if isinstance(runtime, dict) and "record" in runtime:
            records[node_id] = {
                "document": runtime.get("document"),
                "collection": runtime.get("collection"),
                "record": runtime.get("record"),
            }
    return {
        "module_id": str(module["node_id"]),
        "documents": declaration.get("documents") or [],
        "records": records,
    }


def _sidecar_projection(
    graph: dict[str, Any], sidecar: dict[str, Any]
) -> dict[str, Any]:
    if sidecar.get("contract_id") != PROJECTION_CONTRACT_ID:
        raise ModuleProjectionError("sidecar projection contract mismatch")
    expected = graph_digest(graph)
    if sidecar.get("graph_digest") != expected:
        raise ModuleProjectionError("sidecar graph digest mismatch")
    records: dict[str, dict[str, Any]] = {}
    for row in sidecar.get("records") or []:
        if not isinstance(row, dict):
            raise ModuleProjectionError("sidecar record row must be an object")
        node_id = str(row.get("node_id") or "")
        if node_id in records:
            raise ModuleProjectionError(f"sidecar binds node {node_id} twice")
        records[node_id] = {
            "document": row.get("document"),
            "collection": row.get("collection"),
            "record": row.get("record"),
        }
    return {
        "module_id": str(sidecar.get("module_id") or ""),
        "documents": sidecar.get("documents") or [],
        "records": records,
    }


def load_projection(
    graph: dict[str, Any], sidecar: dict[str, Any] | None = None
) -> dict[str, Any]:
    """Load either carrier into the one internal projection shape."""
    by_id = _check_graph_shape(graph)
    if sidecar is not None:
        projection = _sidecar_projection(graph, sidecar)
    else:
        projection = _embedded_projection(graph, by_id)
        if projection is None:
            raise ModuleProjectionError("graph carries no runtime projection")
    projection["nodes_by_id"] = by_id
    return projection


def validate_module_projection(
    graph: dict[str, Any], sidecar: dict[str, Any] | None = None
) -> dict[str, Any]:
    projection = load_projection(graph, sidecar)
    by_id = projection["nodes_by_id"]
    records = projection["records"]
    cjk_ok = _cjk_allowed(graph.get("source_languages"))
    declared: list[str] = []
    bound_nodes: set[str] = set()
    for document in projection["documents"]:
        if not isinstance(document, dict):
            raise ModuleProjectionError("projected document entry must be an object")
        filename = str(document.get("filename") or "")
        if filename not in PROJECTED_DOCUMENTS:
            raise ModuleProjectionError(f"projected document {filename!r} is not registered")
        if filename in declared:
            raise ModuleProjectionError(f"projected document {filename} declared twice")
        declared.append(filename)
        spec_names = {name for name, _kind, _field in COLLECTION_SPECS.get(filename, ())}
        for collection in document.get("collections") or []:
            name = str(collection.get("name") or "")
            if name not in spec_names:
                raise ModuleProjectionError(
                    f"{filename} collection {name!r} is not registered"
                )
            registry = RECORD_FIELD_REGISTRY.get(filename, {}).get(name, frozenset())
            for node_id in collection.get("node_ids") or []:
                if node_id not in by_id:
                    raise ModuleProjectionError(
                        f"projection references missing node {node_id}"
                    )
                if node_id in bound_nodes:
                    raise ModuleProjectionError(
                        f"projection binds node {node_id} twice"
                    )
                bound_nodes.add(node_id)
                runtime = records.get(node_id)
                if runtime is None:
                    raise ModuleProjectionError(
                        f"projection node {node_id} carries no runtime record"
                    )
                if runtime.get("document") != filename:
                    raise ModuleProjectionError(
                        f"projection node {node_id} is not bound to {filename}"
                    )
                record = runtime.get("record")
                if isinstance(record, dict):
                    unregistered = sorted(set(record) - registry)
                    if unregistered:
                        raise ModuleProjectionError(
                            f"{filename}.{name} record {node_id} carries "
                            f"unregistered fields {unregistered}"
                        )
                if not cjk_ok and _contains_cjk(record):
                    raise ModuleProjectionError(
                        f"projection record {node_id} carries CJK text outside "
                        "the graph source languages"
                    )
    if not declared:
        raise ModuleProjectionError("projection declares no documents")
    return {
        "module_id": projection["module_id"],
        "node_count": len(by_id),
        "relation_count": len(graph.get("relations") or []),
        "document_count": len(declared),
        "documents": declared,
        "complete_document_set": set(declared) == set(PROJECTED_DOCUMENTS),
    }


def project_module_documents(
    graph: dict[str, Any], sidecar: dict[str, Any] | None = None
) -> dict[str, dict[str, Any]]:
    validate_module_projection(graph, sidecar)
    projection = load_projection(graph, sidecar)
    records = projection["records"]
    documents: dict[str, dict[str, Any]] = {}
    for spec in projection["documents"]:
        filename = str(spec["filename"])
        document = _deepcopy(spec.get("root") or {})
        for collection in spec.get("collections") or []:
            name = str(collection["name"])
            rows: list[Any] = []
            for node_id in collection.get("node_ids") or []:
                rows.append(_deepcopy(records[node_id].get("record")))
            document[name] = rows
        documents[filename] = document
    return documents


def install_projected_scenario(
    workspace: Path | str,
    campaign_id: str,
    graph: dict[str, Any],
    sidecar: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Install a graph-backed module into a campaign as a complete scenario.

    A graph-backed module already carries its whole playable IR, so it installs
    the way a starter does — write the materialized views, take the era the
    module authored, and activate the opening scene — rather than entering the
    raw-PDF progressive lane, whose opening-projection coordinator exists to
    answer questions this module has already answered.
    """
    documents = project_module_documents(graph, sidecar)
    root = Path(workspace)
    coc_root = root if root.name == ".coc" else root / ".coc"
    campaign_dir = coc_root / "campaigns" / campaign_id
    if not campaign_dir.is_dir():
        raise ModuleProjectionError(f"unknown campaign: {campaign_id}")
    scenario_dir = campaign_dir / "scenario"
    scenario_dir.mkdir(parents=True, exist_ok=True)
    for filename in documents:
        if (scenario_dir / filename).exists():
            raise ModuleProjectionError(
                f"campaign {campaign_id} already has scenario file {filename}"
            )
    for filename, document in documents.items():
        coc_fileio.write_json_atomic(
            scenario_dir / filename, document, indent=1, trailing_newline=True
        )

    meta = documents.get("module-meta.json") or {}
    scenario_id = str(meta.get("scenario_id") or "")
    scenes = (documents.get("story-graph.json") or {}).get("scenes") or []
    opening = str(meta.get("opening_scene") or "")
    if not any(str(row.get("scene_id")) == opening for row in scenes):
        opening = str(scenes[0].get("scene_id")) if scenes else ""

    campaign_path = campaign_dir / "campaign.json"
    campaign = json.loads(campaign_path.read_text(encoding="utf-8"))
    campaign["active_scenario_id"] = scenario_id or campaign.get("active_scenario_id")
    campaign["active_scene_id"] = opening or campaign.get("active_scene_id")
    authored_era = str(meta.get("era") or "").strip()
    if authored_era:
        # The installer is an explicit caller supplying the module's own era,
        # which is what `declared` means; it is not a creation-time placeholder.
        campaign["era"] = authored_era
        campaign["era_source"] = "declared"
    coc_fileio.write_json_atomic(
        campaign_path, campaign, indent=2, trailing_newline=True
    )

    start_clock = meta.get("start_clock")
    if isinstance(start_clock, dict):
        # A module that authored its opening moment owns the table clock; a
        # starter takes the same path through reset_campaign_time_state.
        import coc_state

        coc_state.reset_campaign_time_state(
            campaign_dir,
            campaign_id,
            era=str(campaign.get("era") or "1920s"),
            start_clock=start_clock,
        )

    world_path = campaign_dir / "save" / "world-state.json"
    world = (
        json.loads(world_path.read_text(encoding="utf-8"))
        if world_path.is_file() else {}
    )
    world["scenario_id"] = scenario_id or world.get("scenario_id")
    world["status"] = "active"
    world["active_subsystem"] = "play"
    if opening:
        world["active_scene_id"] = opening
        visited = [str(v) for v in (world.get("visited_scene_ids") or []) if str(v)]
        if opening not in visited:
            visited.append(opening)
        world["visited_scene_ids"] = visited
    coc_fileio.write_json_atomic(
        world_path, world, indent=2, trailing_newline=True
    )
    return {
        "campaign_id": campaign_id,
        "scenario_id": scenario_id,
        "scenario_dir": str(scenario_dir),
        "documents": sorted(documents),
        "active_scene_id": opening,
    }


def check_projection_parity(
    graph: dict[str, Any],
    ir_dir: Path | str,
    sidecar: dict[str, Any] | None = None,
) -> dict[str, Any]:
    projected = project_module_documents(graph, sidecar)
    root = Path(ir_dir)
    files: dict[str, str] = {}
    for filename, document in projected.items():
        path = root / filename
        if not path.is_file():
            files[filename] = "missing"
            continue
        committed = json.loads(path.read_text(encoding="utf-8"))
        files[filename] = "equal" if committed == document else "drifted"
    status = "equal" if set(files.values()) <= {"equal"} else "drifted"
    return {"status": status, "files": files}


def _model_safe_properties(properties: Any) -> dict[str, Any]:
    if not isinstance(properties, dict):
        return {}
    safe = {
        key: _deepcopy(value)
        for key, value in properties.items()
        if key != "runtime_projection" and key not in _MACHINE_KEYS
    }
    return safe


def _model_safe_source_refs(refs: Any) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for ref in refs if isinstance(refs, list) else []:
        if isinstance(ref, dict):
            rows.append({
                "source_id": ref.get("source_id"),
                "pdf_index": ref.get("pdf_index"),
            })
    return rows


def prepare_projection_packet(
    graph: dict[str, Any], filename: str
) -> dict[str, Any]:
    """Build the closed packet the projection extraction pass consumes.

    The packet restates graph semantics in model-safe form; the extraction
    pass authors runtime records bound to these node ids and must not
    introduce entities or numbers absent from the graph.
    """
    if filename not in PROJECTED_DOCUMENTS:
        raise ModuleProjectionError(f"projected document {filename!r} is not registered")
    by_id = _check_graph_shape(graph)
    modules = [n for n in by_id.values() if n.get("node_kind") == "module"]
    if len(modules) != 1:
        raise ModuleProjectionError("packet requires exactly one module node")
    nodes = []
    for node in by_id.values():
        nodes.append({
            "node_id": node["node_id"],
            "node_kind": node["node_kind"],
            "name": node.get("name"),
            "visibility": node.get("visibility"),
            "aliases": _deepcopy(node.get("aliases") or []),
            "summary": node.get("summary"),
            "properties": _model_safe_properties(node.get("properties")),
            "source_refs": _model_safe_source_refs(node.get("source_refs")),
        })
    relations = [
        {
            "relation_kind": row.get("relation_kind"),
            "from_node_id": row.get("from_node_id"),
            "to_node_id": row.get("to_node_id"),
        }
        for row in graph.get("relations") or []
    ]
    return {
        "contract_id": PACKET_CONTRACT_ID,
        "module_id": str(modules[0]["node_id"]),
        "filename": filename,
        "source_languages": _deepcopy(graph.get("source_languages") or []),
        "collections": [
            {
                "name": name,
                "record_kind": kind,
                "id_field": id_field,
                "registered_fields": sorted(
                    RECORD_FIELD_REGISTRY.get(filename, {}).get(name, frozenset())
                ),
            }
            for name, kind, id_field in COLLECTION_SPECS.get(filename, ())
        ],
        "nodes": nodes,
        "relations": relations,
    }


def validate_projection_records(
    graph: dict[str, Any], payload: dict[str, Any]
) -> list[dict[str, str]]:
    """Deterministically check one document's authored runtime records.

    Returns exact findings; an empty list is the only acceptance signal.
    """
    findings: list[dict[str, str]] = []

    def finding(code: str, path: str, message: str) -> None:
        findings.append({"code": code, "path": path, "message": message})

    if not isinstance(payload, dict):
        return [{"code": "invalid_payload", "path": "/", "message": "payload must be an object"}]
    filename = str(payload.get("filename") or "")
    if filename not in PROJECTED_DOCUMENTS:
        finding("unknown_document", "/filename", f"{filename!r} is not registered")
        return findings
    try:
        by_id = _check_graph_shape(graph)
    except ModuleProjectionError as exc:
        return [{"code": "invalid_graph", "path": "/", "message": str(exc)}]
    cjk_ok = _cjk_allowed(graph.get("source_languages"))
    specs = {name: (kind, id_field) for name, kind, id_field in COLLECTION_SPECS.get(filename, ())}
    seen_nodes: set[str] = set()
    collections = payload.get("collections")
    if not isinstance(collections, list):
        finding("invalid_collections", "/collections", "collections must be an array")
        return findings
    for index, collection in enumerate(collections):
        base = f"/collections/{index}"
        if not isinstance(collection, dict):
            finding("invalid_collection", base, "collection must be an object")
            continue
        name = str(collection.get("name") or "")
        if name not in specs:
            finding("unknown_collection", f"{base}/name", f"{name!r} is not registered for {filename}")
            continue
        _kind, id_field = specs[name]
        registry = RECORD_FIELD_REGISTRY.get(filename, {}).get(name, frozenset())
        rows = collection.get("records")
        if not isinstance(rows, list):
            finding("invalid_records", f"{base}/records", "records must be an array")
            continue
        for row_index, row in enumerate(rows):
            row_path = f"{base}/records/{row_index}"
            if not isinstance(row, dict):
                finding("invalid_record_row", row_path, "record row must be an object")
                continue
            node_id = str(row.get("node_id") or "")
            if node_id not in by_id:
                finding("unknown_node", f"{row_path}/node_id", f"{node_id!r} is not a graph node")
            elif node_id in seen_nodes:
                finding("duplicate_node", f"{row_path}/node_id", f"{node_id} bound twice")
            else:
                seen_nodes.add(node_id)
            record = row.get("record")
            if id_field is None:
                if isinstance(record, (dict, list)):
                    finding("invalid_scalar_record", f"{row_path}/record", "record must be a scalar")
                continue
            if not isinstance(record, dict):
                finding("invalid_record", f"{row_path}/record", "record must be an object")
                continue
            if not record.get(id_field):
                finding("missing_record_id", f"{row_path}/record/{id_field}", f"{id_field} is required")
            unregistered = sorted(set(record) - registry)
            if unregistered:
                finding(
                    "unregistered_fields",
                    f"{row_path}/record",
                    f"unregistered fields {unregistered}",
                )
            if not cjk_ok and _contains_cjk(record):
                finding(
                    "language_contamination",
                    f"{row_path}/record",
                    "record carries CJK text outside the graph source languages",
                )
    return findings


def build_projection_sidecar(
    graph: dict[str, Any], payloads: list[dict[str, Any]]
) -> dict[str, Any]:
    """Assemble validated per-document payloads into one sidecar object."""
    documents: list[dict[str, Any]] = []
    records: list[dict[str, Any]] = []
    module_id = ""
    for payload in payloads:
        findings = validate_projection_records(graph, payload)
        if findings:
            raise ModuleProjectionError(
                f"payload for {payload.get('filename')!r} has "
                f"{len(findings)} findings; first: {findings[0]['message']}"
            )
        filename = str(payload["filename"])
        collections: list[dict[str, Any]] = []
        for collection in payload.get("collections") or []:
            name = str(collection["name"])
            node_ids: list[str] = []
            for row in collection.get("records") or []:
                node_id = str(row["node_id"])
                node_ids.append(node_id)
                records.append({
                    "node_id": node_id,
                    "document": filename,
                    "collection": name,
                    "record": _deepcopy(row.get("record")),
                })
            collections.append({"name": name, "node_ids": node_ids})
        documents.append({
            "filename": filename,
            "root": _deepcopy(payload.get("root") or {}),
            "collections": collections,
        })
    by_id = _check_graph_shape(graph)
    modules = [n for n in by_id.values() if n.get("node_kind") == "module"]
    if len(modules) == 1:
        module_id = str(modules[0]["node_id"])
    sidecar = {
        "contract_id": PROJECTION_CONTRACT_ID,
        "module_id": module_id,
        "graph_digest": graph_digest(graph),
        "documents": documents,
        "records": records,
    }
    # The assembled sidecar must satisfy the same closed validation as any
    # other carrier before it may be written.
    validate_module_projection(graph, sidecar)
    return sidecar


def write_projection_sidecar(
    path: Path | str, graph: dict[str, Any], payloads: list[dict[str, Any]]
) -> dict[str, Any]:
    sidecar = build_projection_sidecar(graph, payloads)
    coc_fileio.write_json_atomic(Path(path), sidecar)
    return sidecar


def load_projection_sidecar(
    path: Path | str, graph: dict[str, Any]
) -> dict[str, Any]:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ModuleProjectionError("sidecar must be a JSON object")
    # Digest binding is enforced on load.
    _sidecar_projection(graph, payload)
    return payload


def _read_json(path: str) -> Any:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _print_json(payload: Any) -> None:
    json.dump(payload, sys.stdout, ensure_ascii=False, indent=2, sort_keys=True)
    sys.stdout.write("\n")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    install = sub.add_parser("install")
    install.add_argument("--graph", required=True)
    install.add_argument("--sidecar")
    install.add_argument("--workspace", required=True)
    install.add_argument("--campaign", required=True)

    for name in ("validate", "project", "parity", "prepare-packet"):
        cmd = sub.add_parser(name)
        cmd.add_argument("--graph", required=True)
        cmd.add_argument("--sidecar")
        if name == "parity":
            cmd.add_argument("--ir-dir", required=True)
        if name == "prepare-packet":
            cmd.add_argument("--document", required=True)

    records = sub.add_parser("validate-records")
    records.add_argument("--graph", required=True)
    records.add_argument("--payload", required=True)

    attach = sub.add_parser("attach")
    attach.add_argument("--graph", required=True)
    attach.add_argument("--payload", action="append", required=True)
    attach.add_argument("--out", required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    graph = _read_json(args.graph)
    sidecar = _read_json(args.sidecar) if getattr(args, "sidecar", None) else None
    try:
        if args.command == "validate":
            _print_json(validate_module_projection(graph, sidecar))
        elif args.command == "project":
            _print_json(project_module_documents(graph, sidecar))
        elif args.command == "parity":
            _print_json(check_projection_parity(graph, args.ir_dir, sidecar))
        elif args.command == "install":
            _print_json(install_projected_scenario(
                args.workspace, args.campaign, graph, sidecar
            ))
        elif args.command == "prepare-packet":
            _print_json(prepare_projection_packet(graph, args.document))
        elif args.command == "validate-records":
            findings = validate_projection_records(graph, _read_json(args.payload))
            _print_json({"finding_count": len(findings), "findings": findings})
            return 0 if not findings else 1
        elif args.command == "attach":
            payloads = [_read_json(path) for path in args.payload]
            sidecar = write_projection_sidecar(args.out, graph, payloads)
            _print_json({
                "written": args.out,
                "graph_digest": sidecar["graph_digest"],
                "documents": [row["filename"] for row in sidecar["documents"]],
            })
    except ModuleProjectionError as exc:
        _print_json({"error": str(exc)})
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
