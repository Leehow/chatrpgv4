#!/usr/bin/env python3
"""Durable progressive module-asset store (skeleton + pages + entity packs).

Slice 1 of docs/active-plans/coc-on-demand-module-skeleton.md:
schema constants, store layout, registry, skeleton validation, page/entity
writes, parse-queue enqueue. No play/director integration yet.

Layout: workspace ``.coc/module-assets/`` (local only, not git).
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent

SCHEMA_VERSION = 1
REGISTRY_NAME = "registry.json"
LICENSE_NOTE = (
    "Local progressive parse cache for a user-supplied PDF. "
    "Do not commit Product Identity prose to git.\n"
)
PARSE_STATES = frozenset({
    "named_only", "toc_only", "partial", "body_parsed", "deep", "failed",
})
EDGE_KINDS = frozenset({
    "travel", "contains", "unlock", "mentioned", "chapter_handoff",
})
EDGE_CONFIDENCE = frozenset({"low", "med", "high"})
EDGE_EVIDENCE = frozenset({
    "toc_adjacency", "map", "body_mention", "clue", "handout", "npc_dialogue",
})
ENTITY_KINDS = frozenset({"location", "npc", "clue", "handout", "threat"})
JOB_KINDS = frozenset({
    "deepen_location", "deepen_npc", "deepen_clue", "deepen_handout",
    "deepen_threat",
    "partial_neighbor", "ensure_stub",
})
JOB_KIND_FOR_ENTITY = {
    "location": "deepen_location",
    "npc": "deepen_npc",
    "clue": "deepen_clue",
    "handout": "deepen_handout",
    "threat": "deepen_threat",
}
_ENTITY_ID_KEY = {
    "location": "location_id",
    "npc": "npc_id",
    "clue": "clue_id",
    "handout": "handout_id",
    "threat": "threat_id",
}
_SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_HEX = frozenset("0123456789abcdef")
_EXIT_CONDITION_KINDS = frozenset({
    "always", "clue_discovered", "clock_reaches", "flag_set", "narrative",
})


class ModuleAssetsError(ValueError):
    """Module-assets store contract violation."""


def deepen_job_kind(entity_kind: str) -> str:
    """Return the one canonical deepening job for an entity; fail closed."""
    try:
        return JOB_KIND_FOR_ENTITY[entity_kind]
    except KeyError as exc:
        raise ModuleAssetsError(f"unknown entity kind {entity_kind!r}") from exc


def _job_entity_kind(job_kind: str) -> str | None:
    if job_kind in {"deepen_location", "partial_neighbor"}:
        return "location"
    for entity_kind, deepen_kind in JOB_KIND_FOR_ENTITY.items():
        if job_kind == deepen_kind:
            return entity_kind
    return None


def _job_depth(job_kind: str) -> int:
    if job_kind == "partial_neighbor":
        return 1
    if job_kind.startswith("deepen_"):
        return 2
    return 0


def _same_entity_work(row: dict[str, Any], job_kind: str, target_id: str) -> bool:
    return (
        str(row.get("target_id") or "") == target_id
        and _job_entity_kind(str(row.get("kind") or ""))
        == _job_entity_kind(job_kind)
    )


def _source_ref_signature(rows: Any) -> tuple[tuple[str, int, str], ...]:
    """Return the source identity that makes one host request reusable."""
    if not isinstance(rows, list):
        return ()
    normalized: list[tuple[str, int, str]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        pdf_index = row.get("pdf_index")
        if isinstance(pdf_index, bool) or not isinstance(pdf_index, int):
            continue
        normalized.append((
            str(row.get("source_id") or ""),
            pdf_index,
            str(row.get("text_sha256") or ""),
        ))
    return tuple(sorted(normalized))


def _host_request_scope_matches_pack(
    workspace: Path,
    asset_root_id: str,
    row: dict[str, Any],
    pack: dict[str, Any] | None,
) -> bool | None:
    """Compare an open host request with the pack's exact source scope.

    ``evidence_gap`` and ``dig_pending`` are request-state metadata.  Updating
    either must not turn one unresolved source request into a second request
    for the same cached pages.  A genuinely wider/different page scope does
    invalidate the negative cache and returns ``False``.
    """
    job_id = str(row.get("job_id") or "").strip()
    if not job_id or pack is None:
        return None
    request_path = (
        _module_dir(workspace, asset_root_id) / "host-work" / f"{job_id}.json"
    )
    if not request_path.is_file():
        return None
    try:
        request = json.loads(request_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if str(request.get("status") or "") in {
        "fulfilled", "cancelled", "superseded",
    }:
        return False

    requested_refs = _source_ref_signature(request.get("cached_page_refs"))
    pack_refs = _source_ref_signature(pack.get("source_refs"))
    if requested_refs and pack_refs:
        request_sha = str(request.get("file_sha256") or "")
        evidence = (
            pack.get("source_evidence")
            if isinstance(pack.get("source_evidence"), dict)
            else {}
        )
        pack_sha = str(evidence.get("file_sha256") or "")
        return (
            (not request_sha or not pack_sha or request_sha == pack_sha)
            and requested_refs == pack_refs
        )

    requested_indices = request.get("requested_pdf_indices")
    pack_indices = pack.get("source_page_indices")
    if isinstance(requested_indices, list) and isinstance(pack_indices, list):
        return sorted(requested_indices) == sorted(pack_indices)
    return None


def _host_request_still_current(
    workspace: Path,
    asset_root_id: str,
    row: dict[str, Any],
    *,
    job_kind: str,
    target_id: str,
) -> bool:
    """Treat one unresolved host request as a negative cache entry.

    The cache remains current while the exact cached source scope is unchanged.
    A host ``put_entity`` deep fulfillment closes the request and may then
    enqueue the one merge job needed for the new pack.  Request-state-only
    updates on a stub do not create one host request per player question.
    """
    if row.get("result") != "awaiting_host_pack":
        return False
    if not _same_entity_work(row, job_kind, target_id):
        return False
    if _job_depth(str(row.get("kind") or "")) < _job_depth(job_kind):
        return False
    entity_kind = _job_entity_kind(job_kind)
    pack = (
        get_entity(workspace, asset_root_id, entity_kind, target_id)
        if entity_kind else None
    )
    scope_match = _host_request_scope_matches_pack(
        workspace, asset_root_id, row, pack,
    )
    if scope_match is not None:
        return scope_match
    updated_at = str((pack or {}).get("updated_at") or "")
    completed_at = str(row.get("completed_at") or "")
    return not updated_at or not completed_at or updated_at <= completed_at


def _supersede_host_requests(
    workspace: Path,
    asset_root_id: str,
    rows: list[dict[str, Any]],
    *,
    replacement_job_id: str,
) -> list[str]:
    """Close open handoffs whose exact entity evidence scope has changed."""
    superseded: list[str] = []
    for row in rows:
        job_id = str(row.get("job_id") or "").strip()
        if not job_id:
            continue
        path = _module_dir(workspace, asset_root_id) / "host-work" / f"{job_id}.json"
        if not path.is_file():
            continue
        try:
            request = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if str(request.get("status") or "") in {
            "fulfilled", "cancelled", "superseded",
        }:
            continue
        request.update({
            "status": "superseded",
            "superseded_at": _now_iso(),
            "superseded_by_job_id": replacement_job_id,
        })
        _write_json(path, request)
        superseded.append(job_id)
    return superseded


def _validate_entity_pack(kind: str, doc: dict[str, Any]) -> None:
    """Validate meaning-bearing structures before a host pack becomes durable."""
    if kind == "location":
        for index, clue in enumerate(doc.get("clues") or []):
            if not isinstance(clue, dict):
                continue
            if str(clue.get("delivery_kind") or "") != "npc_dialogue":
                continue
            source_npc_ids = clue.get("source_npc_ids")
            if (
                not isinstance(source_npc_ids, list)
                or not source_npc_ids
                or any(
                    not isinstance(npc_id, str) or not npc_id.strip()
                    for npc_id in source_npc_ids
                )
                or len(source_npc_ids) != len(set(source_npc_ids))
            ):
                raise ModuleAssetsError(
                    f"location clues[{index}] with delivery_kind=npc_dialogue "
                    "requires unique non-empty source_npc_ids"
                )
    if kind == "location" and doc.get("san_triggers") is not None:
        triggers = doc.get("san_triggers")
        if not isinstance(triggers, list):
            raise ModuleAssetsError("location san_triggers must be a list")
        seen_trigger_ids: set[str] = set()
        for index, trigger in enumerate(triggers):
            prefix = f"location san_triggers[{index}]"
            if not isinstance(trigger, dict):
                raise ModuleAssetsError(f"{prefix} must be an object")
            trigger_id = str(trigger.get("trigger_id") or "").strip()
            if not trigger_id:
                raise ModuleAssetsError(f"{prefix}.trigger_id is required")
            if trigger_id in seen_trigger_ids:
                raise ModuleAssetsError(f"duplicate SAN trigger_id {trigger_id!r}")
            seen_trigger_ids.add(trigger_id)
            if not str(trigger.get("source") or "").strip():
                raise ModuleAssetsError(f"{prefix}.source is required")
            if type(trigger.get("san_loss_success")) is not int:
                raise ModuleAssetsError(
                    f"{prefix}.san_loss_success must be an integer"
                )
            if not str(trigger.get("san_loss_fail_expr") or "").strip():
                raise ModuleAssetsError(
                    f"{prefix}.san_loss_fail_expr is required"
                )
    if kind != "location" or doc.get("scene_edges") is None:
        return
    edges = doc.get("scene_edges")
    if not isinstance(edges, list):
        raise ModuleAssetsError("location scene_edges must be a list")
    for index, edge in enumerate(edges):
        if not isinstance(edge, dict) or not str(edge.get("to") or "").strip():
            raise ModuleAssetsError(
                f"location scene_edges[{index}] must be an object with to"
            )
        condition = edge.get("when")
        if condition is None:
            continue
        if not isinstance(condition, dict):
            raise ModuleAssetsError(
                f"location scene_edges[{index}].when must be an object"
            )
        condition_kind = str(condition.get("kind") or "").strip()
        if condition_kind not in _EXIT_CONDITION_KINDS:
            allowed = ", ".join(sorted(_EXIT_CONDITION_KINDS))
            raise ModuleAssetsError(
                f"location scene_edges[{index}].when.kind {condition_kind!r} "
                f"is unsupported; expected one of: {allowed}"
            )
        if condition_kind == "clue_discovered" and not str(
            condition.get("clue_id") or ""
        ).strip():
            raise ModuleAssetsError(
                f"location scene_edges[{index}].when.clue_id is required"
            )
        if condition_kind == "clock_reaches" and type(
            condition.get("threshold")
        ) is not int:
            raise ModuleAssetsError(
                f"location scene_edges[{index}].when.threshold must be an integer"
            )
        if condition_kind == "flag_set" and not str(
            condition.get("flag_id") or ""
        ).strip():
            raise ModuleAssetsError(
                f"location scene_edges[{index}].when.flag_id is required"
            )


def _load_sibling(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPT_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_fileio = _load_sibling("coc_fileio_module_assets", "coc_fileio.py")
coc_pdf_bundle = _load_sibling("coc_pdf_bundle_module_assets", "coc_pdf_bundle.py")
coc_state = _load_sibling("coc_state_module_assets", "coc_state.py")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _coc_root(workspace: Path) -> Path:
    return coc_state.coc_root(Path(workspace).resolve())


def assets_root(workspace: Path) -> Path:
    return _coc_root(workspace) / "module-assets"


def registry_path(workspace: Path) -> Path:
    return assets_root(workspace) / REGISTRY_NAME


def resolve_asset_root_id(
    *,
    canonical_module_id: str | None = None,
    file_sha256: str | None = None,
) -> str:
    cid = (canonical_module_id or "").strip()
    if cid:
        return _require_id(cid, "canonical_module_id")
    return f"pdf-{_require_sha256(file_sha256, 'file_sha256')[:16]}"


def _require_sha256(value: Any, field: str) -> str:
    if not isinstance(value, str) or len(value) != 64 or any(c not in _HEX for c in value):
        raise ModuleAssetsError(f"{field} must be a lowercase SHA-256 digest")
    return value


def _require_id(value: Any, field: str) -> str:
    text = str(value or "").strip()
    if not _SAFE_ID.match(text) or "/" in text or ".." in text:
        raise ModuleAssetsError(f"{field} must be a safe id")
    return text


def _module_dir(workspace: Path, asset_root_id: str) -> Path:
    root = assets_root(workspace).resolve()
    path = (root / _require_id(asset_root_id, "asset_root_id")).resolve()
    try:
        path.relative_to(root)
    except ValueError as exc:
        raise ModuleAssetsError("asset_root_id escapes module-assets root") from exc
    return path


def _write_json(path: Path, payload: Any) -> None:
    coc_fileio.write_json_atomic(
        path, payload, indent=2, ensure_ascii=False, trailing_newline=True,
    )


def empty_registry() -> dict[str, Any]:
    return {"schema_version": SCHEMA_VERSION, "modules": {}, "by_file_sha256": {}}


def load_registry(workspace: Path) -> dict[str, Any]:
    path = registry_path(workspace)
    if not path.is_file():
        return empty_registry()
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or data.get("schema_version") != SCHEMA_VERSION:
        raise ModuleAssetsError("module-assets registry schema_version mismatch")
    data.setdefault("modules", {})
    data.setdefault("by_file_sha256", {})
    return data


def save_registry(workspace: Path, registry: dict[str, Any]) -> None:
    registry = dict(registry)
    registry["schema_version"] = SCHEMA_VERSION
    _write_json(registry_path(workspace), registry)


def _normalized_source_identity(
    source: dict[str, Any] | None,
    *,
    file_sha256: str,
) -> dict[str, Any] | None:
    """Keep the validated PDF identity beside its progressive page cache.

    The source bundle itself remains host-owned.  This record is only the
    content identity needed to prove that cached pages and later entity packs
    belong to the same PDF.
    """
    if source is None:
        return None
    if not isinstance(source, dict):
        raise ModuleAssetsError("source identity must be an object")
    source_id = str(source.get("source_id") or "").strip()
    if not source_id:
        raise ModuleAssetsError("source.source_id is required")
    declared_sha = _require_sha256(source.get("file_sha256"), "source.file_sha256")
    if declared_sha != file_sha256:
        raise ModuleAssetsError(
            "source.file_sha256 differs from the module asset root identity"
        )
    page_count = source.get("page_count")
    if isinstance(page_count, bool) or not isinstance(page_count, int) or page_count <= 0:
        raise ModuleAssetsError("source.page_count must be a positive integer")
    producer = str(source.get("producer") or "").strip()
    if producer != coc_pdf_bundle.PRODUCER:
        raise ModuleAssetsError(
            f"source.producer must equal {coc_pdf_bundle.PRODUCER!r}"
        )
    normalized = {
        "source_id": source_id,
        "title": str(source.get("title") or "").strip(),
        "path": str(source.get("path") or "").strip(),
        "file_sha256": declared_sha,
        "page_count": page_count,
        "producer": producer,
    }
    return normalized


def init_module_root(
    workspace: Path,
    *,
    asset_root_id: str,
    identity: dict[str, Any],
    file_sha256: str,
    source: dict[str, Any] | None = None,
) -> Path:
    """Create empty durable root and register it. Idempotent if same sha."""
    digest = _require_sha256(file_sha256, "file_sha256")
    root_id = _require_id(asset_root_id, "asset_root_id")
    mod = _module_dir(workspace, root_id)
    mod.mkdir(parents=True, exist_ok=True)
    for sub in ("pages", "entities", "handouts"):
        (mod / sub).mkdir(exist_ok=True)

    source_identity = _normalized_source_identity(source, file_sha256=digest)
    identity_doc: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "asset_root_id": root_id,
        "file_sha256": digest,
        "module_identity": dict(identity or {}),
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
    }
    existing = mod / "identity.json"
    if existing.is_file():
        prev = json.loads(existing.read_text(encoding="utf-8"))
        if prev.get("file_sha256") and prev["file_sha256"] != digest:
            raise ModuleAssetsError(
                f"asset_root_id {root_id!r} already bound to a different file_sha256"
            )
        identity_doc["created_at"] = prev.get("created_at") or identity_doc["created_at"]
        if isinstance(prev.get("module_identity"), dict) and not identity:
            identity_doc["module_identity"] = prev["module_identity"]
        previous_source = prev.get("source")
        if source_identity is None and isinstance(previous_source, dict):
            source_identity = dict(previous_source)
        elif source_identity is not None and isinstance(previous_source, dict):
            for key in ("source_id", "file_sha256", "page_count", "producer"):
                if previous_source.get(key) != source_identity.get(key):
                    raise ModuleAssetsError(
                        f"source identity {key} differs from the existing asset root"
                    )
        if isinstance(prev.get("source_bundles"), list):
            identity_doc["source_bundles"] = json.loads(
                json.dumps(prev["source_bundles"])
            )
    if source_identity is not None:
        identity_doc["source"] = source_identity
    identity_doc.setdefault("source_bundles", [])
    _write_json(mod / "identity.json", identity_doc)

    for name, payload in (
        ("mentions-index.json", {"schema_version": SCHEMA_VERSION, "entities": {}}),
        ("parse-queue.json", {
            "schema_version": SCHEMA_VERSION,
            "pending": [], "in_flight": [], "done": [],
        }),
    ):
        path = mod / name
        if not path.is_file():
            _write_json(path, payload)
    license_path = mod / "LICENSE-note.md"
    if not license_path.is_file():
        coc_fileio.write_text_atomic(license_path, LICENSE_NOTE)

    registry = load_registry(workspace)
    modules = registry.setdefault("modules", {})
    by_sha = registry.setdefault("by_file_sha256", {})
    owner = by_sha.get(digest)
    if owner and owner != root_id:
        raise ModuleAssetsError(
            f"file_sha256 already registered under asset_root_id {owner!r}"
        )
    modules[root_id] = {
        "asset_root_id": root_id,
        "file_sha256": digest,
        "canonical_module_id": (identity or {}).get("canonical_module_id") or root_id,
        "updated_at": _now_iso(),
        "parse_tier_max": int(modules.get(root_id, {}).get("parse_tier_max") or 0),
    }
    by_sha[digest] = root_id
    save_registry(workspace, registry)
    return mod


def lookup_by_sha256(workspace: Path, file_sha256: str) -> dict[str, Any] | None:
    digest = _require_sha256(file_sha256, "file_sha256")
    registry = load_registry(workspace)
    root_id = (registry.get("by_file_sha256") or {}).get(digest)
    if not root_id:
        return None
    return (registry.get("modules") or {}).get(root_id)


def validate_skeleton(skeleton: dict[str, Any]) -> list[str]:
    """Return error strings; empty list means skeleton publish gate passes."""
    errors: list[str] = []
    if not isinstance(skeleton, dict):
        return ["skeleton must be an object"]
    if skeleton.get("schema_version") != SCHEMA_VERSION:
        errors.append("schema_version must be 1")
    if skeleton.get("parse_tier") not in (0, 1, 2, 3, 4, 5):
        errors.append("parse_tier must be an integer 0..5")
    source = skeleton.get("source")
    if not isinstance(source, dict):
        errors.append("source must be an object")
    else:
        try:
            _require_sha256(source.get("file_sha256"), "source.file_sha256")
        except ModuleAssetsError as exc:
            errors.append(str(exc))
        if not str(source.get("source_id") or "").strip():
            errors.append("source.source_id is required")
    starts = skeleton.get("start_candidates")
    if not isinstance(starts, list) or not starts or not all(
        isinstance(x, str) and x.strip() for x in starts
    ):
        errors.append("start_candidates must be a non-empty string list")
        start_set: set[str] = set()
    else:
        start_set = {x.strip() for x in starts}

    locations = skeleton.get("locations")
    loc_ids: set[str] = set()
    if not isinstance(locations, list) or not locations:
        errors.append("locations must be a non-empty list")
    else:
        for i, loc in enumerate(locations):
            prefix = f"locations[{i}]"
            if not isinstance(loc, dict):
                errors.append(f"{prefix} must be an object")
                continue
            try:
                lid = _require_id(loc.get("location_id"), f"{prefix}.location_id")
            except ModuleAssetsError as exc:
                errors.append(str(exc))
                continue
            if lid in loc_ids:
                errors.append(f"duplicate location_id {lid!r}")
            loc_ids.add(lid)
            if not str(loc.get("title") or "").strip():
                errors.append(f"{prefix}.title is required")
            if loc.get("parse_state") not in PARSE_STATES:
                errors.append(f"{prefix}.parse_state invalid")
    for sid in start_set:
        if loc_ids and sid not in loc_ids:
            errors.append(f"start_candidates entry {sid!r} missing from locations")

    for i, edge in enumerate(skeleton.get("edges_provisional") or []):
        prefix = f"edges_provisional[{i}]"
        if not isinstance(edge, dict):
            errors.append(f"{prefix} must be an object")
            continue
        if edge.get("kind") not in EDGE_KINDS:
            errors.append(f"{prefix}.kind invalid")
        if edge.get("confidence") not in EDGE_CONFIDENCE:
            errors.append(f"{prefix}.confidence invalid")
        if edge.get("evidence") not in EDGE_EVIDENCE:
            errors.append(f"{prefix}.evidence invalid")
        for end in ("from", "to"):
            node = str(edge.get(end) or "").strip()
            if not node:
                errors.append(f"{prefix}.{end} required")
            elif loc_ids and node not in loc_ids:
                errors.append(f"{prefix}.{end} unknown location {node!r}")

    seen_npc: set[str] = set()
    for i, npc in enumerate(skeleton.get("npc_roster") or []):
        prefix = f"npc_roster[{i}]"
        if not isinstance(npc, dict):
            errors.append(f"{prefix} must be an object")
            continue
        try:
            nid = _require_id(npc.get("npc_id"), f"{prefix}.npc_id")
        except ModuleAssetsError as exc:
            errors.append(str(exc))
            continue
        if nid in seen_npc:
            errors.append(f"duplicate npc_id {nid!r}")
        seen_npc.add(nid)
        if npc.get("parse_state") not in PARSE_STATES:
            errors.append(f"{prefix}.parse_state invalid")
    return errors


def put_skeleton(
    workspace: Path, asset_root_id: str, skeleton: dict[str, Any],
) -> dict[str, Any]:
    mod = _module_dir(workspace, asset_root_id)
    if not (mod / "identity.json").is_file():
        raise ModuleAssetsError("init_module_root before put_skeleton")
    doc = json.loads(json.dumps(skeleton))
    identity = json.loads((mod / "identity.json").read_text(encoding="utf-8"))
    if identity.get("source_bundles"):
        source = doc.get("source") if isinstance(doc.get("source"), dict) else {}
        bound_source = (
            identity.get("source") if isinstance(identity.get("source"), dict) else {}
        )
        for key in ("source_id", "file_sha256", "page_count", "producer"):
            if source.get(key) != bound_source.get(key):
                raise ModuleAssetsError(
                    f"skeleton source.{key} differs from the bound source bundle"
                )
        start_clock_status = str(doc.get("start_clock_status") or "").strip()
        allowed_clock_status = {
            "source", "not_authored", "unresolved", "campaign_override",
        }
        if start_clock_status not in allowed_clock_status:
            raise ModuleAssetsError(
                "source-bound skeleton requires start_clock_status: source, "
                "not_authored, unresolved, or campaign_override"
            )
        if start_clock_status == "source":
            if not isinstance(doc.get("start_clock"), dict):
                raise ModuleAssetsError(
                    "start_clock_status=source requires start_clock"
                )
            clock_refs = doc.get("start_clock_source_refs")
            if not isinstance(clock_refs, list) or not clock_refs:
                raise ModuleAssetsError(
                    "start_clock_status=source requires start_clock_source_refs"
                )
            doc["start_clock_source_refs"] = _cached_source_refs(
                workspace,
                asset_root_id,
                {"source_refs": clock_refs},
                field="start_clock",
            )
        elif start_clock_status != "campaign_override" and doc.get("start_clock") is not None:
            raise ModuleAssetsError(
                f"start_clock_status={start_clock_status} must not carry start_clock"
            )
    errors = validate_skeleton(doc)
    if errors:
        raise ModuleAssetsError("skeleton invalid: " + "; ".join(errors))
    doc["schema_version"] = SCHEMA_VERSION
    path = mod / "skeleton.json"
    _write_json(path, doc)
    _bump_parse_tier(workspace, asset_root_id, int(doc.get("parse_tier") or 1))
    return {"path": str(path), "location_count": len(doc.get("locations") or [])}


def get_skeleton(workspace: Path, asset_root_id: str) -> dict[str, Any] | None:
    path = _module_dir(workspace, asset_root_id) / "skeleton.json"
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def put_page(
    workspace: Path,
    asset_root_id: str,
    pdf_index: int,
    text: str,
    *,
    meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if not isinstance(pdf_index, int) or isinstance(pdf_index, bool) or pdf_index < 0:
        raise ModuleAssetsError("pdf_index must be a non-negative integer")
    if not isinstance(text, str) or not text.strip():
        raise ModuleAssetsError("page text must be non-empty")
    mod = _module_dir(workspace, asset_root_id)
    if not (mod / "identity.json").is_file():
        raise ModuleAssetsError("init_module_root before put_page")
    stem = f"{pdf_index:04d}"
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    if not normalized.endswith("\n"):
        normalized += "\n"
    digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
    md_path = mod / "pages" / f"{stem}.md"
    meta_path = mod / "pages" / f"{stem}.meta.json"
    existing_meta: dict[str, Any] = {}
    reused = False
    if md_path.is_file():
        existing_text = md_path.read_text(encoding="utf-8")
        existing_digest = hashlib.sha256(existing_text.encode("utf-8")).hexdigest()
        if existing_digest != digest:
            raise ModuleAssetsError(
                f"cached page {pdf_index} content drift; bind a different PDF "
                "identity instead of overwriting page evidence"
            )
        reused = True
        if meta_path.is_file():
            loaded_meta = json.loads(meta_path.read_text(encoding="utf-8"))
            if isinstance(loaded_meta, dict):
                existing_meta = loaded_meta
    else:
        coc_fileio.write_text_atomic(md_path, normalized)

    supplied_meta = dict(meta or {})
    bundle_hashes = {
        str(value)
        for value in (existing_meta.get("bundle_sha256s") or [])
        if isinstance(value, str) and value
    }
    for value in (
        existing_meta.get("bundle_sha256"),
        supplied_meta.get("bundle_sha256"),
    ):
        if isinstance(value, str) and value:
            bundle_hashes.add(value)
    meta_doc = {
        **existing_meta,
        **supplied_meta,
        "schema_version": SCHEMA_VERSION,
        "pdf_index": pdf_index,
        "text_sha256": digest,
        "updated_at": _now_iso(),
    }
    if bundle_hashes:
        meta_doc["bundle_sha256s"] = sorted(bundle_hashes)
    _write_json(meta_path, meta_doc)
    return {
        "pdf_index": pdf_index,
        "text_sha256": digest,
        "path": str(md_path),
        "reused": reused,
    }


def get_page(
    workspace: Path, asset_root_id: str, pdf_index: int,
) -> dict[str, Any] | None:
    mod = _module_dir(workspace, asset_root_id)
    stem = f"{pdf_index:04d}"
    md_path = mod / "pages" / f"{stem}.md"
    if not md_path.is_file():
        return None
    meta_path = mod / "pages" / f"{stem}.meta.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.is_file() else {}
    return {"pdf_index": pdf_index, "text": md_path.read_text(encoding="utf-8"), "meta": meta}


def register_source_bundle(
    workspace: Path,
    source_bundle: Path | str | dict[str, Any],
    *,
    asset_root_id: str | None = None,
    module_identity: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Bridge one validated host PDF window into the progressive page cache.

    Repeated registration is content-addressed and idempotent.  A second
    campaign using the same PDF reuses the existing asset root, while another
    host bundle window for that PDF adds only its previously unseen pages.
    """
    started = time.perf_counter()
    if isinstance(source_bundle, dict):
        bundle = source_bundle
    else:
        bundle = coc_pdf_bundle.load_host_bundle(source_bundle)
    if (
        not isinstance(bundle, dict)
        or bundle.get("schema_version") != coc_pdf_bundle.SCHEMA_VERSION
        or bundle.get("producer") != coc_pdf_bundle.PRODUCER
        or not isinstance(bundle.get("source"), dict)
        or not isinstance(bundle.get("pages"), list)
    ):
        raise ModuleAssetsError("source bundle is not a validated host bundle")
    source = dict(bundle["source"])
    file_sha256 = _require_sha256(source.get("file_sha256"), "source.file_sha256")
    bundle_sha256 = _require_sha256(
        bundle.get("bundle_sha256") or source.get("bundle_sha256"),
        "bundle_sha256",
    )
    existing = lookup_by_sha256(workspace, file_sha256)
    requested_root_id = (
        _require_id(asset_root_id, "asset_root_id") if asset_root_id else None
    )
    root_id = (
        str(existing["asset_root_id"])
        if isinstance(existing, dict) and existing.get("asset_root_id")
        else requested_root_id
        or resolve_asset_root_id(file_sha256=file_sha256)
    )
    # A content hit belongs to the already-registered module identity.  A new
    # campaign-local scenario id must not rename the shared parse cache.
    identity = {} if existing else dict(module_identity or {})
    if not existing:
        identity.setdefault("canonical_module_id", root_id)
        identity.setdefault("canonical_title", source.get("title") or root_id)
    mod = init_module_root(
        workspace,
        asset_root_id=root_id,
        identity=identity,
        file_sha256=file_sha256,
        source=source,
    )

    page_results: list[dict[str, Any]] = []
    for page in bundle["pages"]:
        if not isinstance(page, dict):
            raise ModuleAssetsError("source bundle page must be an object")
        page_results.append(
            put_page(
                workspace,
                root_id,
                page.get("pdf_index"),
                page.get("text"),
                meta={
                    "source_id": source.get("source_id"),
                    "file_sha256": file_sha256,
                    "bundle_sha256": bundle_sha256,
                    "producer_text_sha256": page.get("producer_text_sha256"),
                    "review_state": page.get("review_state"),
                    "parse_confidence": page.get("parse_confidence"),
                    "grep_anchors": list(page.get("grep_anchors") or []),
                    "printed_page": page.get("printed_page"),
                    "printed_label": page.get("printed_label"),
                    "source_bundle_path": source.get("source_bundle_path"),
                    "markdown_path": page.get("markdown_path"),
                },
            )
        )

    identity_path = mod / "identity.json"
    identity_doc = json.loads(identity_path.read_text(encoding="utf-8"))
    bundle_rows = [
        row
        for row in (identity_doc.get("source_bundles") or [])
        if isinstance(row, dict) and row.get("bundle_sha256") != bundle_sha256
    ]
    previous = next(
        (
            row
            for row in (identity_doc.get("source_bundles") or [])
            if isinstance(row, dict) and row.get("bundle_sha256") == bundle_sha256
        ),
        None,
    )
    bundle_rows.append({
        "bundle_sha256": bundle_sha256,
        "source_bundle_path": source.get("source_bundle_path"),
        "pdf_indices": sorted(int(page["pdf_index"]) for page in bundle["pages"]),
        "registered_at": (
            previous.get("registered_at")
            if isinstance(previous, dict) and previous.get("registered_at")
            else _now_iso()
        ),
    })
    identity_doc["source_bundles"] = sorted(
        bundle_rows, key=lambda row: str(row.get("bundle_sha256") or "")
    )
    identity_doc["updated_at"] = _now_iso()
    _write_json(identity_path, identity_doc)
    elapsed_ms = max(0, round((time.perf_counter() - started) * 1000))
    return {
        "asset_root_id": root_id,
        "requested_asset_root_id": requested_root_id,
        "reused_existing_root": bool(existing),
        "bundle_sha256": bundle_sha256,
        "cached_pdf_indices": [row["pdf_index"] for row in page_results],
        "new_page_count": sum(not row["reused"] for row in page_results),
        "reused_page_count": sum(bool(row["reused"]) for row in page_results),
        "bundle_validation_and_cache_ms": elapsed_ms,
    }


def _source_indices(value: dict[str, Any], *, field: str) -> list[int]:
    indices: set[int] = set()
    refs = value.get("source_refs")
    if refs is not None:
        if not isinstance(refs, list):
            raise ModuleAssetsError(f"{field}.source_refs must be a list")
        for position, ref in enumerate(refs):
            if not isinstance(ref, dict):
                raise ModuleAssetsError(
                    f"{field}.source_refs[{position}] must be an object"
                )
            pdf_index = ref.get("pdf_index")
            if (
                isinstance(pdf_index, bool)
                or not isinstance(pdf_index, int)
                or pdf_index < 0
            ):
                raise ModuleAssetsError(
                    f"{field}.source_refs[{position}].pdf_index must be a "
                    "non-negative integer"
                )
            indices.add(pdf_index)
    explicit = value.get("source_page_indices")
    if explicit is not None:
        if not isinstance(explicit, list) or any(
            isinstance(index, bool) or not isinstance(index, int) or index < 0
            for index in explicit
        ):
            raise ModuleAssetsError(
                f"{field}.source_page_indices must be non-negative integers"
            )
        indices.update(explicit)
    span = value.get("source_span")
    if span is not None:
        if not isinstance(span, dict):
            raise ModuleAssetsError(f"{field}.source_span must be an object")
        start = span.get("pdf_index_start")
        end = span.get("pdf_index_end")
        if (
            isinstance(start, bool)
            or isinstance(end, bool)
            or not isinstance(start, int)
            or not isinstance(end, int)
            or start < 0
            or end < start
        ):
            raise ModuleAssetsError(
                f"{field}.source_span requires 0 <= pdf_index_start <= pdf_index_end"
            )
        indices.update(range(start, end + 1))
    return sorted(indices)


def _cached_source_refs(
    workspace: Path,
    asset_root_id: str,
    value: dict[str, Any],
    *,
    field: str,
    inherited_indices: list[int] | None = None,
) -> list[dict[str, Any]]:
    mod = _module_dir(workspace, asset_root_id)
    identity = json.loads((mod / "identity.json").read_text(encoding="utf-8"))
    source = identity.get("source") if isinstance(identity.get("source"), dict) else {}
    source_id = str(source.get("source_id") or "").strip()
    indices = _source_indices(value, field=field)
    if not indices and inherited_indices:
        indices = list(inherited_indices)
    input_refs = {
        int(ref["pdf_index"]): ref
        for ref in (value.get("source_refs") or [])
        if isinstance(ref, dict) and isinstance(ref.get("pdf_index"), int)
    }
    refs: list[dict[str, Any]] = []
    for pdf_index in indices:
        page = get_page(workspace, asset_root_id, pdf_index)
        if page is None:
            raise ModuleAssetsError(
                f"{field} cites uncached pdf_index {pdf_index}; register the host "
                "source bundle window before accepting the entity pack"
            )
        meta = page.get("meta") if isinstance(page.get("meta"), dict) else {}
        supplied = input_refs.get(pdf_index) or {}
        supplied_source_id = str(supplied.get("source_id") or source_id).strip()
        if not source_id or supplied_source_id != source_id:
            raise ModuleAssetsError(
                f"{field}.source_refs for pdf_index {pdf_index} use a different source_id"
            )
        cached_digest = str(meta.get("text_sha256") or "")
        if supplied.get("text_sha256") not in (None, cached_digest):
            raise ModuleAssetsError(
                f"{field}.source_refs for pdf_index {pdf_index} do not match cached text"
            )
        ref: dict[str, Any] = {
            "source_id": source_id,
            "pdf_index": pdf_index,
            "text_sha256": cached_digest,
            "bundle_sha256s": list(meta.get("bundle_sha256s") or []),
            "review_state": meta.get("review_state"),
            "parse_confidence": meta.get("parse_confidence"),
            "grep_anchors": list(meta.get("grep_anchors") or []),
        }
        for key in ("printed_page", "printed_label"):
            if meta.get(key) is not None:
                ref[key] = meta[key]
        if supplied.get("grep_anchor") is not None:
            anchor = str(supplied["grep_anchor"])
            if anchor not in page["text"]:
                raise ModuleAssetsError(
                    f"{field}.source_refs grep_anchor is absent from cached pdf_index "
                    f"{pdf_index}"
                )
            ref["grep_anchor"] = anchor
        refs.append(ref)
    return refs


def _apply_canonical_source_scope(
    target: dict[str, Any],
    refs: list[dict[str, Any]],
) -> None:
    """Materialize one exact, cache-backed source scope on a semantic row.

    ``source_span`` is only truthful for a contiguous page range.  Disjoint
    evidence stays represented by ``source_page_indices``/``source_refs`` so
    later workers do not accidentally widen the requested PDF scope.
    """
    copied_refs = json.loads(json.dumps(refs))
    indices = [int(ref["pdf_index"]) for ref in copied_refs]
    target["source_refs"] = copied_refs
    target["source_page_indices"] = indices
    target["page_text_sha256"] = [
        str(ref["text_sha256"]) for ref in copied_refs
    ]
    if indices and indices == list(range(indices[0], indices[-1] + 1)):
        target["source_span"] = {
            "pdf_index_start": indices[0],
            "pdf_index_end": indices[-1],
        }
    else:
        target.pop("source_span", None)


def _canonicalize_entity_source_evidence(
    workspace: Path,
    asset_root_id: str,
    kind: str,
    doc: dict[str, Any],
) -> None:
    identity_path = _module_dir(workspace, asset_root_id) / "identity.json"
    identity = json.loads(identity_path.read_text(encoding="utf-8"))
    source_bound = bool(identity.get("source_bundles"))
    parse_state = str(doc.get("parse_state") or "")
    requires_evidence = (
        source_bound
        and parse_state in {"partial", "body_parsed", "deep"}
        and not bool(doc.get("evidence_gap"))
    )
    indices = _source_indices(doc, field=kind)
    if requires_evidence and not indices:
        raise ModuleAssetsError(
            f"source-bound {kind} pack with parse_state={parse_state} requires "
            "source_refs, source_page_indices, or source_span"
        )
    if not source_bound or not indices:
        return
    missing_indices = [
        pdf_index
        for pdf_index in indices
        if get_page(workspace, asset_root_id, pdf_index) is None
    ]
    if missing_indices:
        if requires_evidence:
            raise ModuleAssetsError(
                f"{kind} cites uncached pdf_index {missing_indices[0]}; register "
                "the host source bundle window before accepting the entity pack"
            )
        # A Tier-1/named-only stub is the request for these pages, not proof
        # that the pages have already been extracted. Preserve the exact fetch
        # scope, but strip any stale accepted-evidence projection until a host
        # bundle registers every cited page. Deep/partial packs still fail
        # closed above.
        doc["source_page_indices"] = list(indices)
        if indices == list(range(indices[0], indices[-1] + 1)):
            doc["source_span"] = {
                "pdf_index_start": indices[0],
                "pdf_index_end": indices[-1],
            }
        else:
            doc.pop("source_span", None)
        for field in ("source_refs", "page_text_sha256", "source_evidence"):
            doc.pop(field, None)
        doc.setdefault("origin", "source")
        return
    refs = _cached_source_refs(
        workspace,
        asset_root_id,
        doc,
        field=kind,
    )
    digests = [str(ref["text_sha256"]) for ref in refs]
    supplied_digests = doc.get("page_text_sha256")
    if supplied_digests is not None and supplied_digests != digests:
        raise ModuleAssetsError(
            f"{kind}.page_text_sha256 does not match the cached source pages"
        )
    _apply_canonical_source_scope(doc, refs)
    bundle_hashes = sorted({
        bundle_hash
        for ref in refs
        for bundle_hash in (ref.get("bundle_sha256s") or [])
        if isinstance(bundle_hash, str) and bundle_hash
    })
    source = identity.get("source") or {}
    doc["source_evidence"] = {
        "schema_version": 1,
        "source_id": source.get("source_id"),
        "file_sha256": identity.get("file_sha256"),
        "bundle_sha256s": bundle_hashes,
        "pdf_indices": list(doc["source_page_indices"]),
        "page_text_sha256": list(digests),
    }
    doc.setdefault("origin", "source")

    # A location pack is the semantic compile unit for its nested clues, NPCs,
    # and secret rows.  Give every nested source-derived object an explicit
    # evidence binding instead of relying on an implicit parent relationship.
    if kind == "location":
        for collection in ("clues", "npcs", "keeper_secret_refs"):
            for position, row in enumerate(doc.get(collection) or []):
                if not isinstance(row, dict):
                    continue
                child_refs = _cached_source_refs(
                    workspace,
                    asset_root_id,
                    row,
                    field=f"location.{collection}[{position}]",
                    inherited_indices=list(doc["source_page_indices"]),
                )
                _apply_canonical_source_scope(row, child_refs)
                row.setdefault("origin", "source")
                for mention_position, mention in enumerate(row.get("mentions") or []):
                    if not isinstance(mention, dict):
                        continue
                    mention_refs = _cached_source_refs(
                        workspace,
                        asset_root_id,
                        mention,
                        field=(
                            f"location.{collection}[{position}]."
                            f"mentions[{mention_position}]"
                        ),
                        inherited_indices=list(row["source_page_indices"]),
                    )
                    _apply_canonical_source_scope(mention, mention_refs)

        # Top-level structured mentions are source-derived graph edges too.
        # Carry their exact scope forward so a newly created stub can request
        # only the pages that introduced it.
        for position, mention in enumerate(doc.get("mentions") or []):
            if not isinstance(mention, dict):
                continue
            mention_refs = _cached_source_refs(
                workspace,
                asset_root_id,
                mention,
                field=f"location.mentions[{position}]",
                inherited_indices=list(doc["source_page_indices"]),
            )
            _apply_canonical_source_scope(mention, mention_refs)


def _host_ingest_timing(
    workspace: Path,
    asset_root_id: str,
    kind: str,
    entity_id: str,
    *,
    received_at: str,
    host_timing: Any,
    host_work_job_id: Any = None,
) -> dict[str, Any]:
    timing: dict[str, Any] = {
        "pack_received_at": received_at,
        "host_timing_status": "missing",
    }
    if isinstance(host_timing, dict):
        duration = host_timing.get("duration_ms")
        if (
            isinstance(duration, bool)
            or not isinstance(duration, int)
            or duration < 0
        ):
            raise ModuleAssetsError("host_timing.duration_ms must be a non-negative integer")
        if not str(host_timing.get("started_at") or "").strip() or not str(
            host_timing.get("completed_at") or ""
        ).strip():
            raise ModuleAssetsError(
                "host_timing requires started_at and completed_at"
            )
        timing.update({
            "host_timing_status": "reported",
            "source_compile_ms": duration,
            "source_compile_started_at": host_timing["started_at"],
            "source_compile_completed_at": host_timing["completed_at"],
            "producer": host_timing.get("producer") or "host_pdf_skill",
        })
    requested_job_id = str(host_work_job_id or "").strip()
    work_dir = _module_dir(workspace, asset_root_id) / "host-work"
    matching: list[tuple[Path, dict[str, Any]]] = []
    if work_dir.is_dir():
        for path in work_dir.glob("*.json"):
            try:
                request = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if not isinstance(request, dict) or request.get("fulfilled_at"):
                continue
            job_id = str(request.get("job_id") or "")
            request_status = str(request.get("status") or "")
            if (
                requested_job_id
                and job_id == requested_job_id
                and request_status in {"cancelled", "superseded"}
            ):
                raise ModuleAssetsError(
                    f"host_work_job_id {requested_job_id!r} is {request_status}; "
                    "fulfill the replacement request with the current source scope"
                )
            if request_status in {"cancelled", "superseded"}:
                continue
            if requested_job_id and job_id != requested_job_id:
                continue
            if (
                str(request.get("target_id") or "") == entity_id
                and _job_entity_kind(str(request.get("kind") or "")) == kind
            ):
                matching.append((path, request))
    if matching:
        _path, latest = max(
            matching, key=lambda row: str(row[1].get("created_at") or "")
        )
        requested_at = str(latest.get("created_at") or "")
        timing["host_work_job_id"] = str(latest.get("job_id") or "")
        if requested_at:
            timing["host_request_created_at"] = requested_at
            try:
                timing["host_request_to_pack_ms"] = max(
                    0,
                    round(
                        (
                            datetime.fromisoformat(received_at)
                            - datetime.fromisoformat(requested_at)
                        ).total_seconds()
                        * 1000
                    ),
                )
            except ValueError:
                pass
    return timing


def _semantic_pack_digest(doc: dict[str, Any]) -> str:
    semantic = {
        key: value
        for key, value in doc.items()
        if key not in {"updated_at", "ingest_timing"}
    }
    encoded = json.dumps(
        semantic, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _mark_host_work_fulfilled(
    workspace: Path,
    asset_root_id: str,
    *,
    host_work_job_id: str | None,
    kind: str,
    entity_id: str,
    fulfilled_at: str,
    repository_put_ms: int,
) -> None:
    if not host_work_job_id:
        return
    work_dir = _module_dir(workspace, asset_root_id) / "host-work"
    if not work_dir.is_dir():
        return
    for path in work_dir.glob("*.json"):
        try:
            request = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if str(request.get("job_id") or "") != host_work_job_id:
            continue
        request["status"] = "fulfilled"
        request["fulfilled_at"] = fulfilled_at
        request["fulfilled_entity"] = {
            "kind": kind,
            "entity_id": entity_id,
        }
        request["repository_put_ms"] = repository_put_ms
        _write_json(path, request)
        return


def list_host_work_requests(
    workspace: Path,
    asset_root_id: str,
    *,
    include_closed: bool = False,
    limit: int = 8,
) -> list[dict[str, Any]]:
    """Return a bounded, deterministic projection of durable host handoffs.

    Queue ``done`` rows are a negative cache, not proof that semantic parsing
    finished.  This projection makes the still-open host boundary visible to
    normal Keeper tools without exposing an unbounded directory history.
    """
    work_dir = _module_dir(workspace, asset_root_id) / "host-work"
    if not work_dir.is_dir():
        return []
    closed = {"fulfilled", "cancelled", "superseded"}
    rows: list[dict[str, Any]] = []
    for path in sorted(work_dir.glob("*.json")):
        try:
            request = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(request, dict):
            continue
        status = str(request.get("status") or "open")
        if not include_closed and status in closed:
            continue
        rows.append({
            "job_id": request.get("job_id"),
            "asset_root_id": request.get("asset_root_id"),
            "kind": request.get("kind"),
            "target_id": request.get("target_id"),
            "priority": request.get("priority"),
            "reason": request.get("reason"),
            "status": status,
            "created_at": request.get("created_at"),
            "source_pdf": request.get("source_pdf"),
            "source_id": request.get("source_id"),
            "file_sha256": request.get("file_sha256"),
            "requested_pdf_indices": list(
                request.get("requested_pdf_indices") or []
            ),
            "cached_page_refs": list(request.get("cached_page_refs") or []),
            "cached_scope_complete": request.get("cached_scope_complete"),
            "fulfillment_operation": {
                "tool": "progressive.fulfill_host_work",
                "args": {"job_id": request.get("job_id"), "pack": "<host PDF semantic pack>"},
            },
            "path": str(path),
        })
    rows.sort(
        key=lambda row: (
            -int(row.get("priority") or 0),
            str(row.get("created_at") or ""),
            str(row.get("job_id") or ""),
        )
    )
    return rows[:max(0, int(limit))]


def put_entity(
    workspace: Path,
    asset_root_id: str,
    kind: str,
    entity_id: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    started = time.perf_counter()
    if kind not in ENTITY_KINDS:
        raise ModuleAssetsError(f"unknown entity kind {kind!r}")
    eid = _require_id(entity_id, "entity_id")
    if not isinstance(payload, dict):
        raise ModuleAssetsError("entity payload must be an object")
    mod = _module_dir(workspace, asset_root_id)
    if not (mod / "identity.json").is_file():
        raise ModuleAssetsError("init_module_root before put_entity")
    path = mod / "entities" / f"{kind}-{eid}.json"
    previous = (
        json.loads(path.read_text(encoding="utf-8"))
        if path.is_file()
        else None
    )
    doc = json.loads(json.dumps(payload))
    doc["schema_version"] = SCHEMA_VERSION
    doc.setdefault("parse_state", "named_only")
    if doc["parse_state"] not in PARSE_STATES:
        raise ModuleAssetsError("entity parse_state invalid")
    received_at = _now_iso()
    doc["updated_at"] = received_at
    doc[_ENTITY_ID_KEY[kind]] = eid
    _canonicalize_entity_source_evidence(
        workspace,
        asset_root_id,
        kind,
        doc,
    )
    if doc["parse_state"] in {"partial", "body_parsed", "deep"}:
        fresh_timing = _host_ingest_timing(
            workspace,
            asset_root_id,
            kind,
            eid,
            received_at=received_at,
            host_timing=doc.get("host_timing"),
            host_work_job_id=doc.get("host_work_job_id"),
        )
        if (
            isinstance(previous, dict)
            and isinstance(previous.get("ingest_timing"), dict)
            and not fresh_timing.get("host_work_job_id")
            and _semantic_pack_digest(previous) == _semantic_pack_digest(doc)
        ):
            doc["ingest_timing"] = json.loads(
                json.dumps(previous["ingest_timing"])
            )
            doc["ingest_timing"]["last_pack_received_at"] = received_at
            doc["ingest_timing"]["pack_reuse_count"] = (
                int(doc["ingest_timing"].get("pack_reuse_count") or 0) + 1
            )
        else:
            doc["ingest_timing"] = fresh_timing
    _validate_entity_pack(kind, doc)
    _write_json(path, doc)
    out: dict[str, Any] = {
        "path": str(path),
        "kind": kind,
        "entity_id": eid,
        "source_evidence": doc.get("source_evidence"),
        "ingest_timing": doc.get("ingest_timing"),
    }
    # When a deep pack lands, re-enqueue high-priority merge and kick workers
    # so campaigns update without blocking the host put path.
    parse_state = str(doc.get("parse_state") or "")
    if parse_state == "deep" and not doc.get("evidence_gap"):
        try:
            worker = _load_sibling(
                "coc_module_queue_worker_put_entity", "coc_module_queue_worker.py",
            )
            out["worker"] = worker.reenqueue_merge_for_entity(
                workspace,
                asset_root_id,
                kind=kind,
                target_id=eid,
                reason="put_entity_deep",
            )
        except Exception:  # noqa: BLE001
            out["worker"] = {"error": "reenqueue_kick_failed"}
    out["repository_put_ms"] = max(
        0, round((time.perf_counter() - started) * 1000)
    )
    _mark_host_work_fulfilled(
        workspace,
        asset_root_id,
        host_work_job_id=(doc.get("ingest_timing") or {}).get("host_work_job_id"),
        kind=kind,
        entity_id=eid,
        fulfilled_at=received_at,
        repository_put_ms=out["repository_put_ms"],
    )
    return out


def get_entity(
    workspace: Path, asset_root_id: str, kind: str, entity_id: str,
) -> dict[str, Any] | None:
    if kind not in ENTITY_KINDS:
        raise ModuleAssetsError(f"unknown entity kind {kind!r}")
    path = _module_dir(workspace, asset_root_id) / "entities" / (
        f"{kind}-{_require_id(entity_id, 'entity_id')}.json"
    )
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def _skeleton_entity_source_scope(
    workspace: Path,
    asset_root_id: str,
    kind: str,
    entity_id: str,
) -> dict[str, Any] | None:
    """Return exact Tier-1 evidence for an entity, when the skeleton has it.

    A later scene mention contributes contextual pages; it must not replace a
    character/location profile page already named by the skeleton.  Only the
    two skeleton collections with stable entity identities participate here.
    """
    collection, id_field = {
        "location": ("locations", "location_id"),
        "npc": ("npc_roster", "npc_id"),
    }.get(kind, (None, None))
    if collection is None or id_field is None:
        return None
    skeleton = get_skeleton(workspace, asset_root_id) or {}
    for row in skeleton.get(collection) or []:
        if (
            isinstance(row, dict)
            and str(row.get(id_field) or "").strip() == str(entity_id)
        ):
            return {
                field: json.loads(json.dumps(row[field]))
                for field in (
                    "source_refs", "source_span", "source_page_indices",
                    "page_text_sha256",
                )
                if row.get(field) is not None
            }
    return None


def ensure_stub(
    workspace: Path,
    asset_root_id: str,
    kind: str,
    entity_id: str,
    *,
    title: str | None = None,
    reason: str | None = None,
    source_scope: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Create named_only entity if missing; never overwrite deeper packs."""
    skeleton_scope = _skeleton_entity_source_scope(
        workspace, asset_root_id, kind, entity_id
    )
    inherited_indices: set[int] = set()
    for label, scope in (
        (f"{kind} skeleton scope", skeleton_scope),
        (f"{kind} mention scope", source_scope),
    ):
        if scope:
            inherited_indices.update(_source_indices(scope, field=label))
    existing = get_entity(workspace, asset_root_id, kind, entity_id)
    if existing is not None:
        scope_updated = False
        if inherited_indices and str(existing.get("parse_state") or "") == "named_only":
            current_indices = set(_source_indices(existing, field=f"{kind} stub"))
            combined_indices = sorted(current_indices | inherited_indices)
            if combined_indices != sorted(current_indices):
                enriched = json.loads(json.dumps(existing))
                # Let the cache rebuild canonical refs for the exact union.
                enriched["source_page_indices"] = combined_indices
                enriched.pop("source_refs", None)
                enriched.pop("source_span", None)
                enriched.pop("page_text_sha256", None)
                enriched.pop("source_evidence", None)
                put_entity(
                    workspace,
                    asset_root_id,
                    kind,
                    entity_id,
                    enriched,
                )
                existing = get_entity(workspace, asset_root_id, kind, entity_id)
                scope_updated = True
        return {
            "created": False,
            "source_scope_updated": scope_updated,
            "entity": existing,
        }
    payload: dict[str, Any] = {
        "parse_state": "named_only",
        "evidence_gap": False,
        "first_reason": reason or "ensure_stub",
    }
    if inherited_indices:
        payload["source_page_indices"] = sorted(inherited_indices)
    elif source_scope:
        for field in (
            "source_refs", "source_span", "source_page_indices",
            "page_text_sha256",
        ):
            if source_scope.get(field) is not None:
                payload[field] = json.loads(json.dumps(source_scope[field]))
    if kind == "location" and title:
        payload["title"] = title
    elif kind == "npc":
        payload["names"] = [title] if title else [entity_id]
    elif title:
        payload["label"] = title
    put_entity(workspace, asset_root_id, kind, entity_id, payload)
    entity = get_entity(workspace, asset_root_id, kind, entity_id)
    _record_mention(workspace, asset_root_id, kind, entity_id, reason=reason)
    return {
        "created": True,
        "source_scope_updated": bool(inherited_indices or source_scope),
        "entity": entity,
    }


def enqueue_job(
    workspace: Path,
    asset_root_id: str,
    *,
    kind: str,
    target_id: str,
    priority: int = 50,
    reason: str = "",
) -> dict[str, Any]:
    if kind not in JOB_KINDS:
        raise ModuleAssetsError(f"unknown job kind {kind!r}")
    tid = _require_id(target_id, "target_id")
    path = _module_dir(workspace, asset_root_id) / "parse-queue.json"
    if not path.is_file():
        raise ModuleAssetsError("init_module_root before enqueue_job")
    lock_path = _module_dir(workspace, asset_root_id) / "parse-queue.lock"
    deduped_job: dict[str, Any] | None = None
    dedupe_state: str | None = None
    stale_host_rows: list[dict[str, Any]] = []
    with coc_fileio.advisory_file_lock(lock_path):
        queue = json.loads(path.read_text(encoding="utf-8"))
        pending = list(queue.get("pending") or [])
        for job in pending:
            if not _same_entity_work(job, kind, tid):
                continue
            if _job_depth(str(job.get("kind") or "")) < _job_depth(kind):
                job["promoted_from"] = job.get("kind")
                job["kind"] = kind
                job["priority"] = max(int(job.get("priority") or 0), int(priority))
                job["reason"] = str(reason or job.get("reason") or "")
                pending.sort(
                    key=lambda item: (
                        -int(item.get("priority") or 0),
                        item.get("enqueued_at") or "",
                    )
                )
                queue["pending"] = pending
                _write_json(path, queue)
            deduped_job = job
            dedupe_state = "pending"
            break
        if deduped_job is None:
            for job in queue.get("in_flight") or []:
                if (
                    _same_entity_work(job, kind, tid)
                    and _job_depth(str(job.get("kind") or "")) >= _job_depth(kind)
                ):
                    deduped_job = job
                    dedupe_state = "in_flight"
                    break
        if deduped_job is None and reason != "put_entity_deep":
            for row in reversed(queue.get("done") or []):
                still_current = _host_request_still_current(
                    workspace,
                    asset_root_id,
                    row,
                    job_kind=kind,
                    target_id=tid,
                )
                if still_current:
                    deduped_job = row
                    dedupe_state = "awaiting_host_pack"
                    break
                if (
                    row.get("result") == "awaiting_host_pack"
                    and _same_entity_work(row, kind, tid)
                    and _job_depth(str(row.get("kind") or ""))
                    >= _job_depth(kind)
                ):
                    stale_host_rows.append(row)
        if deduped_job is None:
            job = {
                "job_id": (
                    "job-"
                    + hashlib.sha256(
                        f"{kind}:{tid}:{_now_iso()}".encode()
                    ).hexdigest()[:12]
                ),
                "kind": kind,
                "target_id": tid,
                "priority": int(priority),
                "reason": str(reason or ""),
                "enqueued_at": _now_iso(),
            }
            pending.append(job)
            pending.sort(
                key=lambda item: (
                    -int(item.get("priority") or 0),
                    item.get("enqueued_at") or "",
                )
            )
            queue["pending"] = pending
            queue["schema_version"] = SCHEMA_VERSION
            _write_json(path, queue)
        else:
            job = deduped_job
    superseded_host_job_ids = (
        _supersede_host_requests(
            workspace,
            asset_root_id,
            stale_host_rows,
            replacement_job_id=str(job.get("job_id") or ""),
        )
        if deduped_job is None and stale_host_rows
        else []
    )
    # Non-blocking: dig/enter must not wait on host PDF. Background worker
    # claims pending jobs in parallel and merges ready packs.
    kick: dict[str, Any] | None = None
    if dedupe_state == "awaiting_host_pack":
        kick = {"started": False, "reason": "host_request_already_open"}
    else:
        try:
            worker = _load_sibling(
                "coc_module_queue_worker_from_assets", "coc_module_queue_worker.py",
            )
            kick = worker.kick_background_worker(workspace)
        except Exception:  # noqa: BLE001 — enqueue must never fail because of kick
            kick = {"started": False, "error": "kick_failed"}
    return {
        "enqueued": deduped_job is None,
        "job": job,
        "deduped": deduped_job is not None,
        "dedupe_state": dedupe_state,
        "superseded_host_job_ids": superseded_host_job_ids,
        "worker_kick": kick,
    }


def list_queue(workspace: Path, asset_root_id: str) -> dict[str, Any]:
    path = _module_dir(workspace, asset_root_id) / "parse-queue.json"
    if not path.is_file():
        raise ModuleAssetsError("unknown module assets root")
    return json.loads(path.read_text(encoding="utf-8"))


def dedupe_done_jobs(
    rows: list[dict[str, Any]], *, limit: int = 200,
) -> list[dict[str, Any]]:
    """Keep only the latest completion row for each durable queue job id."""
    seen: set[str] = set()
    newest_first: list[dict[str, Any]] = []
    for row in reversed(rows):
        job_id = str(row.get("job_id") or "")
        if job_id and job_id in seen:
            continue
        if job_id:
            seen.add(job_id)
        newest_first.append(row)
    return list(reversed(newest_first))[-max(0, int(limit)) :]


def _record_mention(
    workspace: Path,
    asset_root_id: str,
    kind: str,
    entity_id: str,
    *,
    reason: str | None,
) -> None:
    path = _module_dir(workspace, asset_root_id) / "mentions-index.json"
    if not path.is_file():
        return
    index = json.loads(path.read_text(encoding="utf-8"))
    entities = index.setdefault("entities", {})
    key = f"{kind}:{entity_id}"
    if key not in entities:
        entities[key] = {
            "first_seen": reason or "ensure_stub",
            "first_reason": reason or "ensure_stub",
            "refs": [],
        }
        _write_json(path, index)


def note_parse_tier(workspace: Path, asset_root_id: str, tier: int) -> None:
    """Raise registry parse_tier_max for this asset root (monotonic)."""
    registry = load_registry(workspace)
    entry = (registry.get("modules") or {}).get(asset_root_id)
    if not entry:
        return
    entry["parse_tier_max"] = max(int(entry.get("parse_tier_max") or 0), int(tier))
    entry["updated_at"] = _now_iso()
    save_registry(workspace, registry)


def _bump_parse_tier(workspace: Path, asset_root_id: str, tier: int) -> None:
    note_parse_tier(workspace, asset_root_id, tier)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Progressive module-assets store")
    parser.add_argument("--workspace", default=".")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("init")
    p.add_argument("--asset-root-id", required=True)
    p.add_argument("--file-sha256", required=True)
    p.add_argument("--identity-json", default="{}")

    p = sub.add_parser("lookup")
    p.add_argument("--file-sha256", required=True)

    p = sub.add_parser("put-skeleton")
    p.add_argument("--asset-root-id", required=True)
    p.add_argument("--skeleton-json", required=True)

    p = sub.add_parser("get-skeleton")
    p.add_argument("--asset-root-id", required=True)

    p = sub.add_parser("put-page")
    p.add_argument("--asset-root-id", required=True)
    p.add_argument("--pdf-index", type=int, required=True)
    p.add_argument("--text-file", required=True)

    p = sub.add_parser("register-bundle")
    p.add_argument("--source-bundle", required=True)
    p.add_argument("--asset-root-id", default="")
    p.add_argument("--identity-json", default="{}")

    p = sub.add_parser("put-entity")
    p.add_argument("--asset-root-id", required=True)
    p.add_argument("--kind", required=True, choices=sorted(ENTITY_KINDS))
    p.add_argument("--entity-id", required=True)
    p.add_argument("--entity-json", required=True)

    p = sub.add_parser("ensure-stub")
    p.add_argument("--asset-root-id", required=True)
    p.add_argument("--kind", required=True, choices=sorted(ENTITY_KINDS))
    p.add_argument("--entity-id", required=True)
    p.add_argument("--title", default="")
    p.add_argument("--reason", default="")

    p = sub.add_parser("enqueue")
    p.add_argument("--asset-root-id", required=True)
    p.add_argument("--kind", required=True, choices=sorted(JOB_KINDS))
    p.add_argument("--target-id", required=True)
    p.add_argument("--priority", type=int, default=50)
    p.add_argument("--reason", default="")

    p = sub.add_parser("queue")
    p.add_argument("--asset-root-id", required=True)

    args = parser.parse_args(argv)
    ws = Path(args.workspace).resolve()
    try:
        if args.cmd == "init":
            identity = json.loads(args.identity_json)
            path = init_module_root(
                ws,
                asset_root_id=args.asset_root_id,
                identity=identity if isinstance(identity, dict) else {},
                file_sha256=args.file_sha256,
            )
            print(json.dumps({"ok": True, "path": str(path)}, ensure_ascii=False))
        elif args.cmd == "lookup":
            print(json.dumps(
                {"ok": True, "entry": lookup_by_sha256(ws, args.file_sha256)},
                ensure_ascii=False,
            ))
        elif args.cmd == "put-skeleton":
            skeleton = json.loads(Path(args.skeleton_json).read_text(encoding="utf-8"))
            result = put_skeleton(ws, args.asset_root_id, skeleton)
            print(json.dumps({"ok": True, **result}, ensure_ascii=False))
        elif args.cmd == "get-skeleton":
            print(json.dumps(
                {"ok": True, "skeleton": get_skeleton(ws, args.asset_root_id)},
                ensure_ascii=False,
            ))
        elif args.cmd == "put-page":
            text = Path(args.text_file).read_text(encoding="utf-8")
            result = put_page(ws, args.asset_root_id, args.pdf_index, text)
            print(json.dumps({"ok": True, **result}, ensure_ascii=False))
        elif args.cmd == "register-bundle":
            identity = json.loads(args.identity_json)
            result = register_source_bundle(
                ws,
                args.source_bundle,
                asset_root_id=args.asset_root_id or None,
                module_identity=identity if isinstance(identity, dict) else {},
            )
            print(json.dumps({"ok": True, **result}, ensure_ascii=False))
        elif args.cmd == "put-entity":
            entity = json.loads(Path(args.entity_json).read_text(encoding="utf-8"))
            if not isinstance(entity, dict):
                raise ModuleAssetsError("entity JSON must be an object")
            result = put_entity(
                ws,
                args.asset_root_id,
                args.kind,
                args.entity_id,
                entity,
            )
            print(json.dumps({"ok": True, **result}, ensure_ascii=False))
        elif args.cmd == "ensure-stub":
            result = ensure_stub(
                ws, args.asset_root_id, args.kind, args.entity_id,
                title=args.title or None, reason=args.reason or None,
            )
            print(json.dumps({"ok": True, **result}, ensure_ascii=False))
        elif args.cmd == "enqueue":
            result = enqueue_job(
                ws, args.asset_root_id, kind=args.kind, target_id=args.target_id,
                priority=args.priority, reason=args.reason,
            )
            print(json.dumps({"ok": True, **result}, ensure_ascii=False))
        elif args.cmd == "queue":
            print(json.dumps(
                {"ok": True, "queue": list_queue(ws, args.asset_root_id)},
                ensure_ascii=False,
            ))
        else:
            return 1
        return 0
    except (
        ModuleAssetsError,
        coc_pdf_bundle.PdfSourceBundleError,
        OSError,
        json.JSONDecodeError,
        TypeError,
    ) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
