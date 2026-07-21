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
from datetime import datetime, timedelta, timezone
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
ENTITY_KINDS = frozenset({"location", "npc", "item", "clue", "handout", "threat"})
JOB_KINDS = frozenset({
    "deepen_location", "deepen_npc", "deepen_clue", "deepen_handout",
    "deepen_threat", "deepen_item",
    "resolve_npc_mechanics", "resolve_item_mechanics",
    "locate_mechanics_index",
    "partial_neighbor", "partial_opening", "ensure_stub",
})
FOREGROUND_OPENING_PURPOSE = "foreground_opening_slice"
MECHANICS_LOCATOR_PURPOSE = "mechanics_locator_pass"
MECHANICS_LOCATOR_TARGET_ID = "mechanics-index"
HOST_WORK_CLOSED_STATUSES = frozenset({
    "fulfilled", "cancelled", "superseded",
})
HOST_WORK_LEVELS = ("L1", "L2", "L3")
HOST_WORK_OPEN_CLASSES = (
    "runnable", "leased", "awaiting_scope", "awaiting_cache",
)
OPENING_PAGE_CANDIDATE_PREVIEW_MAX_BYTES = 96
FULFILLED_PACK_RECEIPT_SCHEMA_VERSION = 1
FULFILLED_PACK_DIGEST_KIND = "canonical_entity_pack"
FULFILLED_PACK_DIGEST_VERSION = 1
FULFILLED_PACK_INGEST_FIELD = "host_work_fulfillment"
JOB_KIND_FOR_ENTITY = {
    "location": "deepen_location",
    "npc": "deepen_npc",
    "item": "deepen_item",
    "clue": "deepen_clue",
    "handout": "deepen_handout",
    "threat": "deepen_threat",
}
_ENTITY_ID_KEY = {
    "location": "location_id",
    "npc": "npc_id",
    "item": "item_id",
    "clue": "clue_id",
    "handout": "handout_id",
    "threat": "threat_id",
}
_SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_HEX = frozenset("0123456789abcdef")
_EXIT_CONDITION_KINDS = frozenset({
    "always", "clue_discovered", "clock_reaches", "flag_set", "narrative",
})
LOCATOR_PASS_STATUSES = frozenset({"pending", "complete"})
SKELETON_MECHANICS_STATUSES = frozenset({"unresolved", "located", "not_authored"})
CLUE_DISCOVERY_MODES = frozenset({
    "automatic", "check", "conditional_check", "keeper_judgment",
})
CLUE_CHECK_DIFFICULTIES = frozenset({"regular", "hard", "extreme"})
# Starter IR continues to use these delivery kinds without discovery blocks.
STARTER_CHECK_DELIVERY_KINDS = frozenset({"skill_check", "characteristic_check"})
FACT_PROVENANCE_AUTHORITIES = frozenset({
    "source_authored", "campaign_improvised", "campaign_generated",
})
FACT_PROVENANCE_FIELDS = frozenset({"authority", "source_refs", "basis"})
FACT_RECORD_CANONICAL_SOURCE_FIELDS = frozenset({
    "source_refs",
    "source_page_indices",
    "source_span",
    "page_text_sha256",
    "source_evidence",
})
FACT_RECORD_PARALLEL_SOURCE_FIELDS = frozenset({
    "source_id",
    "file_sha256",
    "source_file_sha256",
    "bundle_sha256",
    "bundle_sha256s",
    "pdf_index",
    "pdf_indices",
    "text_sha256",
    "cached_page_refs",
})
_FULFILLED_PACK_OPERATIONAL_FIELDS = frozenset({
    # Repository/write timing and transient host measurements.
    "updated_at",
    "ingest_timing",
    "host_timing",
    # This is a host request selector, never authored content or authority.
    "host_work_job_id",
    # Queue/cache bookkeeping may change while semantic source content does not.
    "dig_pending",
    "queue_state",
    "merge_state",
    "cache_state",
})


class ModuleAssetsError(ValueError):
    """Module-assets store contract violation."""


class SkeletonStorePhaseError(ModuleAssetsError):
    """Skeleton committed, but its registry metadata phase did not finish."""

    def __init__(
        self,
        message: str,
        *,
        store_result: dict[str, Any],
        metadata_error: BaseException,
    ) -> None:
        super().__init__(message)
        self.stored = True
        self.store_result = json.loads(json.dumps(store_result))
        self.metadata_error = {
            "type": type(metadata_error).__name__[:80],
            "message": str(metadata_error)[:320],
        }


def deepen_job_kind(entity_kind: str) -> str:
    """Return the one canonical deepening job for an entity; fail closed."""
    try:
        return JOB_KIND_FOR_ENTITY[entity_kind]
    except KeyError as exc:
        raise ModuleAssetsError(f"unknown entity kind {entity_kind!r}") from exc


def _job_entity_kind(job_kind: str) -> str | None:
    if job_kind in {"deepen_location", "partial_neighbor", "partial_opening"}:
        return "location"
    if job_kind == "resolve_npc_mechanics":
        return "npc"
    if job_kind == "resolve_item_mechanics":
        return "item"
    for entity_kind, deepen_kind in JOB_KIND_FOR_ENTITY.items():
        if job_kind == deepen_kind:
            return entity_kind
    return None


def _job_depth(job_kind: str) -> int:
    if job_kind in {"partial_neighbor", "partial_opening"}:
        return 1
    if job_kind.startswith("deepen_"):
        return 2
    return 0


def _job_aspect(job_kind: str) -> str:
    return (
        "mechanics"
        if job_kind.startswith("resolve_") or job_kind == "locate_mechanics_index"
        else "body"
    )


def _same_entity_work(row: dict[str, Any], job_kind: str, target_id: str) -> bool:
    row_kind = str(row.get("kind") or "")
    if "locate_mechanics_index" in {row_kind, job_kind}:
        return row_kind == job_kind and str(row.get("target_id") or "") == target_id
    if "partial_opening" in {row_kind, job_kind} and row_kind != job_kind:
        return False
    return (
        str(row.get("target_id") or "") == target_id
        and _job_entity_kind(row_kind)
        == _job_entity_kind(job_kind)
        and _job_aspect(str(row.get("kind") or "")) == _job_aspect(job_kind)
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
    if not job_id:
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

    # Older workers attached the entire cached corpus when no exact page scope
    # existed.  Never reuse that unsafe negative-cache row: the replacement
    # request will carry zero page refs and an explicit defer instruction.
    if (
        not request.get("requested_pdf_indices")
        and request.get("cached_page_refs")
    ):
        return False
    if pack is None:
        return None

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
    if job_kind in {"resolve_npc_mechanics", "resolve_item_mechanics"}:
        request_path = (
            _module_dir(workspace, asset_root_id)
            / "host-work"
            / f"{str(row.get('job_id') or '')}.json"
        )
        try:
            request = json.loads(request_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            request = {}
        if not request.get("requested_pdf_indices"):
            skeleton = get_skeleton(workspace, asset_root_id) or {}
            locator_now_known = any(
                isinstance(locator, dict)
                and str(locator.get("subject_kind") or "") == str(entity_kind or "")
                and str(locator.get("subject_id") or "") == target_id
                and bool(_source_indices(locator, field="mechanics locator"))
                for locator in skeleton.get("mechanics_index") or []
            )
            # One unresolved unknown-scope request is the negative cache until
            # a validated locator row makes an exact replacement possible.
            return not locator_now_known
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


def _host_request_scope_is_covered(
    request: dict[str, Any], pack: dict[str, Any],
) -> bool:
    """Return whether one complete deep pack covers an older host request.

    A deep entity may replace an earlier partial-neighbor handoff, but only
    when it actually contains every requested source page.  This keeps an
    unrelated or wider open request visible instead of closing it merely
    because the entity ids match.
    """
    if str(pack.get("parse_state") or "") != "deep" or pack.get("evidence_gap"):
        return False
    requested = request.get("requested_pdf_indices")
    supplied = pack.get("source_page_indices")
    if not isinstance(requested, list) or not isinstance(supplied, list):
        return False
    if any(isinstance(value, bool) or not isinstance(value, int) for value in requested):
        return False
    if any(isinstance(value, bool) or not isinstance(value, int) for value in supplied):
        return False
    request_sha = str(request.get("file_sha256") or "")
    evidence = (
        pack.get("source_evidence")
        if isinstance(pack.get("source_evidence"), dict)
        else {}
    )
    pack_sha = str(evidence.get("file_sha256") or "")
    return (
        (not request_sha or not pack_sha or request_sha == pack_sha)
        and set(requested).issubset(set(supplied))
    )


def _supersede_covered_entity_host_requests(
    workspace: Path,
    asset_root_id: str,
    *,
    kind: str,
    entity_id: str,
    pack: dict[str, Any],
    fulfilled_job_id: str | None,
) -> list[str]:
    """Close obsolete partial/deep handoffs covered by a complete deep pack."""
    work_dir = _module_dir(workspace, asset_root_id) / "host-work"
    if not work_dir.is_dir():
        return []
    replacement = fulfilled_job_id or f"entity:{kind}:{entity_id}"
    superseded: list[str] = []
    for path in sorted(work_dir.glob("*.json")):
        try:
            request = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        job_id = str(request.get("job_id") or "").strip()
        if not job_id or job_id == fulfilled_job_id:
            continue
        if str(request.get("status") or "") in {
            "fulfilled", "cancelled", "superseded",
        }:
            continue
        request_kind = str(request.get("kind") or "")
        if (
            str(request.get("target_id") or "") != entity_id
            or _job_entity_kind(request_kind) != kind
            or not _host_request_scope_is_covered(request, pack)
        ):
            continue
        request.update({
            "status": "superseded",
            "dispatch_state": "superseded",
            "superseded_at": _now_iso(),
            "superseded_by_job_id": replacement,
            "superseded_by_entity": {"kind": kind, "entity_id": entity_id},
        })
        _write_json(path, request)
        superseded.append(job_id)
    return superseded


def _validate_locator_scope_object(
    scope: Any,
    *,
    field: str,
    expected_file_sha256: str | None = None,
    page_count: int | None = None,
) -> list[str]:
    errors: list[str] = []
    if not isinstance(scope, dict) or not scope:
        return [f"{field} must be a non-empty object"]
    if not str(scope.get("scope_kind") or "").strip():
        errors.append(f"{field}.scope_kind is required")
    pdf_indices = scope.get("pdf_indices")
    if (
        not isinstance(pdf_indices, list)
        or not pdf_indices
        or any(
            isinstance(value, bool) or not isinstance(value, int) or value < 0
            for value in pdf_indices
        )
    ):
        errors.append(f"{field}.pdf_indices must be a non-empty int list")
    elif len(pdf_indices) != len(set(pdf_indices)):
        errors.append(f"{field}.pdf_indices must not contain duplicates")
    elif page_count is not None and any(value >= page_count for value in pdf_indices):
        errors.append(
            f"{field}.pdf_indices must be within declared source.page_count"
        )
    digest = str(scope.get("source_file_sha256") or "").strip().lower()
    if len(digest) != 64 or any(ch not in _HEX for ch in digest):
        errors.append(f"{field}.source_file_sha256 must be a 64-char hex digest")
    elif expected_file_sha256 is not None and digest != expected_file_sha256:
        errors.append(
            f"{field}.source_file_sha256 must match source.file_sha256"
        )
    return errors


def _validated_fact_ref_signature(
    rows: Any, *, field: str,
) -> tuple[tuple[str, int, str], ...]:
    """Validate and normalize one fact's exact source-id/page/text identity."""
    if not isinstance(rows, list) or not rows:
        raise ModuleAssetsError(f"{field} must be a non-empty list")
    normalized: list[tuple[str, int, str]] = []
    seen_indices: set[int] = set()
    for position, ref in enumerate(rows):
        if not isinstance(ref, dict):
            raise ModuleAssetsError(f"{field}[{position}] must be an object")
        pdf_index = ref.get("pdf_index")
        if (
            isinstance(pdf_index, bool)
            or not isinstance(pdf_index, int)
            or pdf_index < 0
        ):
            raise ModuleAssetsError(
                f"{field}[{position}].pdf_index must be a non-negative integer"
            )
        if pdf_index in seen_indices:
            raise ModuleAssetsError(
                f"{field} contains duplicate pdf_index {pdf_index}"
            )
        seen_indices.add(pdf_index)
        source_id = str(ref.get("source_id") or "")
        text_sha256 = str(ref.get("text_sha256") or "").lower()
        if text_sha256 and (
            len(text_sha256) != 64 or any(ch not in _HEX for ch in text_sha256)
        ):
            raise ModuleAssetsError(
                f"{field}[{position}].text_sha256 must be a 64-char hex digest"
            )
        normalized.append((source_id, pdf_index, text_sha256))
    return tuple(sorted(normalized))


def _validate_closed_fact_provenance_fields(
    provenance: dict[str, Any], *, field: str,
) -> None:
    """Keep fact provenance closed around one optional source selector."""
    unsupported = sorted(set(provenance) - FACT_PROVENANCE_FIELDS)
    if unsupported:
        raise ModuleAssetsError(
            f"{field} rejects unsupported fields: {', '.join(unsupported)}; "
            "source_refs is the only source-bearing provenance field"
        )
    if "basis" in provenance:
        basis = provenance["basis"]
        if not isinstance(basis, str) or not basis.strip():
            raise ModuleAssetsError(
                f"{field}.basis must be a non-empty string"
            )


def _reject_parallel_record_source_fields(
    container: dict[str, Any], *, field: str,
) -> None:
    unsupported = sorted(
        set(container).intersection(FACT_RECORD_PARALLEL_SOURCE_FIELDS)
    )
    if unsupported:
        raise ModuleAssetsError(
            f"{field} rejects parallel record source fields: "
            f"{', '.join(unsupported)}"
        )


def _validate_fact_provenance(
    container: dict[str, Any],
    *,
    field: str,
    require: bool = True,
    require_authority: str | None = None,
) -> None:
    provenance = container.get("provenance")
    if provenance is None:
        if require:
            raise ModuleAssetsError(f"{field} is required")
        return
    if not isinstance(provenance, dict):
        raise ModuleAssetsError(f"{field} must be an object")
    _validate_closed_fact_provenance_fields(provenance, field=field)
    authority = str(provenance.get("authority") or "")
    if authority not in FACT_PROVENANCE_AUTHORITIES:
        raise ModuleAssetsError(
            f"{field}.authority must be one of "
            f"{sorted(FACT_PROVENANCE_AUTHORITIES)}"
        )
    if require_authority is not None and authority != require_authority:
        raise ModuleAssetsError(
            f"{field}.authority must be {require_authority!r}"
        )
    refs = provenance.get("source_refs")
    if refs is None:
        refs = []
    if not isinstance(refs, list):
        raise ModuleAssetsError(f"{field}.source_refs must be a list when present")
    record_refs = container.get("source_refs")
    if authority == "source_authored":
        _reject_parallel_record_source_fields(container, field=field)
        if "source_refs" in provenance and not refs:
            raise ModuleAssetsError(
                f"{field}.source_refs must be omitted or a non-empty exact fact scope"
            )
        effective = refs or record_refs
        if not isinstance(effective, list) or not effective:
            raise ModuleAssetsError(
                f"{field}: source_authored requires non-empty source_refs"
            )
        effective_signature = _validated_fact_ref_signature(
            effective, field=f"{field}.source_refs",
        )
        if refs and isinstance(record_refs, list) and record_refs:
            record_signature = _validated_fact_ref_signature(
                record_refs, field="source_refs",
            )
            if effective_signature != record_signature:
                raise ModuleAssetsError(
                    f"{field}.source_refs must bind exactly to record source_refs"
                )
    else:
        if "source_refs" in provenance:
            raise ModuleAssetsError(
                f"{field}: {authority} must not borrow PDF source_refs"
            )
        record_source_fields = sorted(
            set(container).intersection(
                FACT_RECORD_CANONICAL_SOURCE_FIELDS
                | FACT_RECORD_PARALLEL_SOURCE_FIELDS
            )
        )
        if record_source_fields:
            raise ModuleAssetsError(
                f"{field}: {authority} must not borrow record-level PDF source "
                f"fields: {', '.join(record_source_fields)}"
            )


def _validate_clue_discovery(clue: dict[str, Any], *, prefix: str) -> None:
    """Validate progressive clue discovery; never invent skill difficulty.

    Module-assets put_entity is the progressive/source-worker path. Every clue
    accepted here requires canonical ``discovery``. Starter IR
    ``delivery_kind=skill_check|characteristic_check`` without discovery is
    valid only at the explicit non-progressive scenario loader boundary, not
    here.
    """
    if "summary" in clue:
        raise ModuleAssetsError(
            f"{prefix} uses non-canonical summary; use player_safe_summary"
        )
    discovery = clue.get("discovery")
    delivery_kind = str(clue.get("delivery_kind") or "").strip()
    if discovery is None:
        if delivery_kind == "skill":
            raise ModuleAssetsError(
                f"{prefix}.delivery_kind=skill is non-canonical; "
                "use discovery.mode=check"
            )
        if delivery_kind in STARTER_CHECK_DELIVERY_KINDS:
            raise ModuleAssetsError(
                f"{prefix} progressive clue with delivery_kind={delivery_kind} "
                "requires discovery; starter skill_check without discovery is "
                "only valid at the non-progressive loader boundary"
            )
        if clue.get("skill") is not None:
            raise ModuleAssetsError(
                f"{prefix} has skill without discovery; use discovery.mode"
            )
        raise ModuleAssetsError(
            f"{prefix} requires discovery "
            f"(automatic|check|conditional_check|keeper_judgment)"
        )

    if not isinstance(discovery, dict):
        raise ModuleAssetsError(f"{prefix}.discovery must be an object")
    mode = str(discovery.get("mode") or "").strip()
    if mode not in CLUE_DISCOVERY_MODES:
        raise ModuleAssetsError(
            f"{prefix}.discovery.mode must be one of "
            f"{sorted(CLUE_DISCOVERY_MODES)}"
        )
    skill = discovery.get("skill")
    difficulty = discovery.get("difficulty")
    condition = discovery.get("condition")
    if mode == "automatic":
        if skill is not None or difficulty is not None:
            raise ModuleAssetsError(
                f"{prefix}.discovery.mode=automatic requires skill and "
                "difficulty to be null"
            )
    elif mode in {"check", "conditional_check"}:
        if not isinstance(skill, str) or not skill.strip():
            raise ModuleAssetsError(
                f"{prefix}.discovery.mode={mode} requires non-empty skill"
            )
        if str(difficulty or "") not in CLUE_CHECK_DIFFICULTIES:
            raise ModuleAssetsError(
                f"{prefix}.discovery.mode={mode} requires difficulty "
                "regular|hard|extreme"
            )
        if mode == "conditional_check" and (
            not isinstance(condition, dict) or not condition
        ):
            raise ModuleAssetsError(
                f"{prefix}.discovery.mode=conditional_check requires condition"
            )
    elif mode == "keeper_judgment":
        if difficulty is not None and str(difficulty) not in CLUE_CHECK_DIFFICULTIES:
            raise ModuleAssetsError(
                f"{prefix}.discovery.difficulty must be regular|hard|extreme "
                "when present"
            )
    # Campaign-local clues remain legal, but their authority may not borrow
    # PDF evidence. Source-worker rows use source_authored and are cache-bound
    # before this validator runs.
    _validate_fact_provenance(
        clue,
        field=f"{prefix}.provenance",
        require=True,
    )


def _skeleton_mechanics_row(
    workspace: Path,
    asset_root_id: str,
    kind: str,
    entity_id: str,
) -> dict[str, Any] | None:
    """Return the matching mechanics_index row for a subject, if any."""
    skeleton = get_skeleton(workspace, asset_root_id) or {}
    for locator in skeleton.get("mechanics_index") or []:
        if not isinstance(locator, dict):
            continue
        if (
            str(locator.get("subject_kind") or "") == kind
            and str(locator.get("subject_id") or "").strip() == str(entity_id)
        ):
            return locator
    return None


def _validate_entity_pack(
    kind: str,
    doc: dict[str, Any],
    *,
    workspace: Path | None = None,
    asset_root_id: str | None = None,
    entity_id: str | None = None,
) -> None:
    """Validate meaning-bearing structures before a host pack becomes durable."""
    if doc.get("mechanics") is not None:
        mechanics_mod = _load_sibling(
            "coc_mechanics_module_assets", "coc_mechanics.py",
        )
        expected_scope = None
        mechanics = doc["mechanics"]
        if (
            isinstance(mechanics, dict)
            and str(mechanics.get("status") or "") == "not_authored"
        ):
            if workspace is None or asset_root_id is None or entity_id is None:
                raise ModuleAssetsError(
                    "not_authored fulfillment requires workspace entity context"
                )
            if kind not in {"npc", "item"}:
                raise ModuleAssetsError(
                    f"not_authored mechanics only valid for npc/item, not {kind!r}"
                )
            row = _skeleton_mechanics_row(
                workspace, asset_root_id, kind, entity_id,
            )
            if not isinstance(row, dict):
                raise ModuleAssetsError(
                    "not_authored requires a matching skeleton mechanics_index row "
                    f"for {kind}:{entity_id}"
                )
            if str(row.get("locator_pass_status") or "") != "complete":
                raise ModuleAssetsError(
                    "not_authored requires skeleton mechanics_index row with "
                    "locator_pass_status=complete"
                )
            expected_scope = row.get("locator_scope")
            if not isinstance(expected_scope, dict):
                raise ModuleAssetsError(
                    "not_authored requires skeleton mechanics_index.locator_scope"
                )
        try:
            mechanics_mod.validate_mechanics_record(
                doc["mechanics"],
                subject_kind=kind,
                expected_locator_scope=expected_scope,
            )
        except mechanics_mod.MechanicsError as exc:
            raise ModuleAssetsError(str(exc)) from exc
    if kind == "clue":
        # named_only dig stubs are placeholders without delivery semantics yet.
        # Any delivery claim or deeper parse state requires canonical discovery.
        parse_state = str(doc.get("parse_state") or "")
        claims_delivery = (
            doc.get("discovery") is not None
            or bool(str(doc.get("delivery_kind") or "").strip())
            or doc.get("skill") is not None
        )
        if parse_state not in {"named_only", "toc_only"} or claims_delivery:
            _validate_clue_discovery(doc, prefix="clue")
    if kind == "location":
        for index, clue in enumerate(doc.get("clues") or []):
            if not isinstance(clue, dict):
                continue
            _validate_clue_discovery(clue, prefix=f"location clues[{index}]")
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
    source_file_sha256: str | None = None
    source_page_count: int | None = None
    if not isinstance(source, dict):
        errors.append("source must be an object")
    else:
        try:
            source_file_sha256 = _require_sha256(
                source.get("file_sha256"), "source.file_sha256",
            )
        except ModuleAssetsError as exc:
            errors.append(str(exc))
        if not str(source.get("source_id") or "").strip():
            errors.append("source.source_id is required")
        page_count = source.get("page_count")
        if (
            isinstance(page_count, bool)
            or not isinstance(page_count, int)
            or page_count <= 0
        ):
            errors.append("source.page_count must be a positive integer")
        else:
            source_page_count = page_count
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

    seen_item: set[str] = set()
    for i, item in enumerate(skeleton.get("item_roster") or []):
        prefix = f"item_roster[{i}]"
        if not isinstance(item, dict):
            errors.append(f"{prefix} must be an object")
            continue
        try:
            item_id = _require_id(item.get("item_id"), f"{prefix}.item_id")
        except ModuleAssetsError as exc:
            errors.append(str(exc))
            continue
        if item_id in seen_item:
            errors.append(f"duplicate item_id {item_id!r}")
        seen_item.add(item_id)
        if item.get("parse_state") not in PARSE_STATES:
            errors.append(f"{prefix}.parse_state invalid")

    # Skeleton-level locator pass: empty index must never look complete.
    global_pass = str(skeleton.get("mechanics_locator_pass_status") or "").strip()
    if global_pass not in LOCATOR_PASS_STATUSES:
        errors.append(
            "mechanics_locator_pass_status must be pending or complete"
        )
    global_scope = skeleton.get("mechanics_locator_scope")
    global_scope_errors: list[str] = []
    if global_pass == "complete":
        global_scope_errors = _validate_locator_scope_object(
            global_scope,
            field="mechanics_locator_scope",
            expected_file_sha256=source_file_sha256,
            page_count=source_page_count,
        )
        errors.extend(global_scope_errors)
    elif global_scope is not None:
        # Partial scope is allowed while pending; if present, shape must be valid.
        errors.extend(
            _validate_locator_scope_object(
                global_scope,
                field="mechanics_locator_scope",
                expected_file_sha256=source_file_sha256,
                page_count=source_page_count,
            )
        )

    mechanic_subjects: set[tuple[str, str]] = set()
    pending_or_invalid_rows = 0
    for i, locator in enumerate(skeleton.get("mechanics_index") or []):
        prefix = f"mechanics_index[{i}]"
        if not isinstance(locator, dict):
            errors.append(f"{prefix} must be an object")
            pending_or_invalid_rows += 1
            continue
        subject_kind = str(locator.get("subject_kind") or "")
        subject_id = str(locator.get("subject_id") or "").strip()
        if subject_kind not in {"npc", "item"}:
            errors.append(f"{prefix}.subject_kind must be npc or item")
        if not subject_id:
            errors.append(f"{prefix}.subject_id is required")
        subject_key = (subject_kind, subject_id)
        if subject_key in mechanic_subjects:
            errors.append(f"duplicate mechanics locator {subject_key!r}")
        mechanic_subjects.add(subject_key)
        status = str(locator.get("status") or "")
        if status not in SKELETON_MECHANICS_STATUSES:
            errors.append(f"{prefix}.status invalid")
        locator_pass = str(locator.get("locator_pass_status") or "")
        if locator_pass not in LOCATOR_PASS_STATUSES:
            errors.append(
                f"{prefix}.locator_pass_status must be pending or complete"
            )
            pending_or_invalid_rows += 1
        elif locator_pass == "pending" and status != "unresolved":
            errors.append(
                f"{prefix}: locator_pass_status=pending may only use "
                "status=unresolved"
            )
            pending_or_invalid_rows += 1
        elif locator_pass == "complete" and status not in {"located", "not_authored"}:
            errors.append(
                f"{prefix}: locator_pass_status=complete requires "
                "status located or not_authored"
            )
            pending_or_invalid_rows += 1
        if locator_pass == "pending":
            pending_or_invalid_rows += 1
        row_scope = locator.get("locator_scope")
        if locator_pass == "complete":
            scope_errors = _validate_locator_scope_object(
                row_scope,
                field=f"{prefix}.locator_scope",
                expected_file_sha256=source_file_sha256,
                page_count=source_page_count,
            )
            errors.extend(scope_errors)
            if (
                not scope_errors
                and global_pass == "complete"
                and not global_scope_errors
                and isinstance(global_scope, dict)
                and isinstance(row_scope, dict)
            ):
                global_indices = set(global_scope.get("pdf_indices") or [])
                row_indices = set(row_scope.get("pdf_indices") or [])
                if not row_indices.issubset(global_indices):
                    errors.append(
                        f"{prefix}.locator_scope.pdf_indices must be contained "
                        "in mechanics_locator_scope"
                    )
                if (
                    str(row_scope.get("source_file_sha256") or "").lower()
                    != str(global_scope.get("source_file_sha256") or "").lower()
                ):
                    errors.append(
                        f"{prefix}.locator_scope.source_file_sha256 must match "
                        "mechanics_locator_scope"
                    )
                if (
                    str(row_scope.get("scope_kind") or "").strip()
                    != str(global_scope.get("scope_kind") or "").strip()
                ):
                    errors.append(
                        f"{prefix}.locator_scope.scope_kind must match "
                        "mechanics_locator_scope.scope_kind"
                    )
        elif row_scope is not None:
            errors.extend(
                _validate_locator_scope_object(
                    row_scope,
                    field=f"{prefix}.locator_scope",
                    expected_file_sha256=source_file_sha256,
                    page_count=source_page_count,
                )
            )
        indices = locator.get("source_page_indices")
        if status == "located":
            indices_valid = (
                isinstance(indices, list)
                and bool(indices)
                and not any(
                    isinstance(value, bool)
                    or not isinstance(value, int)
                    or value < 0
                    for value in indices
                )
            )
            if not indices_valid:
                errors.append(f"{prefix}.source_page_indices required when located")
            else:
                if len(indices) != len(set(indices)):
                    errors.append(
                        f"{prefix}.source_page_indices must not contain duplicates"
                    )
                if source_page_count is not None and any(
                    value >= source_page_count for value in indices
                ):
                    errors.append(
                        f"{prefix}.source_page_indices must be within declared "
                        "source.page_count"
                    )
                if isinstance(row_scope, dict) and not set(indices).issubset(
                    set(row_scope.get("pdf_indices") or [])
                ):
                    errors.append(
                        f"{prefix}.source_page_indices must be contained in "
                        "locator_scope.pdf_indices"
                    )
        # Empty/unscanned indices cannot claim not_authored or complete absence.
        if status == "not_authored":
            if locator_pass != "complete":
                errors.append(
                    f"{prefix}: not_authored requires locator_pass_status=complete"
                )
            receipt = locator.get("absence_receipt")
            if not isinstance(receipt, dict):
                errors.append(
                    f"{prefix}: not_authored requires mechanics-grade absence_receipt"
                )
            else:
                if receipt.get("review_state") not in {
                    "manual_accepted", "auto_accepted",
                }:
                    errors.append(
                        f"{prefix}.absence_receipt.review_state must be "
                        "manual_accepted or auto_accepted"
                    )
                checked = receipt.get("checked_scope")
                checked_errors = _validate_locator_scope_object(
                    checked,
                    field=f"{prefix}.absence_receipt.checked_scope",
                    expected_file_sha256=source_file_sha256,
                    page_count=source_page_count,
                )
                errors.extend(checked_errors)
                digest = str(receipt.get("source_file_sha256") or "").strip().lower()
                if len(digest) != 64 or any(ch not in _HEX for ch in digest):
                    errors.append(
                        f"{prefix}.absence_receipt.source_file_sha256 must be "
                        "a 64-char hex digest"
                    )
                elif source_file_sha256 is not None and digest != source_file_sha256:
                    errors.append(
                        f"{prefix}.absence_receipt.source_file_sha256 must match "
                        "source.file_sha256"
                    )
                locator_scope = locator.get("locator_scope")
                if not checked_errors and isinstance(locator_scope, dict) and isinstance(checked, dict):
                    if (
                        str(locator_scope.get("scope_kind") or "").strip()
                        != str(checked.get("scope_kind") or "").strip()
                        or sorted(locator_scope.get("pdf_indices") or [])
                        != sorted(checked.get("pdf_indices") or [])
                        or str(locator_scope.get("source_file_sha256") or "").lower()
                        != digest
                        or str(checked.get("source_file_sha256") or "").lower()
                        != digest
                    ):
                        errors.append(
                            f"{prefix}: absence_receipt scope/hash must bind "
                            "exactly to locator_scope"
                        )
                elif not checked_errors:
                    errors.append(
                        f"{prefix}: absence_receipt.checked_scope must bind "
                        "exactly to locator_scope"
                    )

    roster_subjects: set[tuple[str, str]] = (
        {("npc", nid) for nid in seen_npc}
        | {("item", iid) for iid in seen_item}
    )
    if global_pass == "complete":
        if roster_subjects and not mechanic_subjects:
            errors.append(
                "mechanics_locator_pass_status=complete cannot have empty "
                "mechanics_index when npc_roster/item_roster is non-empty"
            )
        missing_subjects = sorted(roster_subjects - mechanic_subjects)
        for subject_kind, subject_id in missing_subjects:
            errors.append(
                "mechanics_locator_pass_status=complete missing mechanics_index "
                f"coverage for {subject_kind}:{subject_id}"
            )
        if pending_or_invalid_rows:
            errors.append(
                "mechanics_locator_pass_status=complete requires every "
                "mechanics_index row to be locator_pass_status=complete "
                "(located or not_authored)"
            )
    return errors


def _validate_source_bound_skeleton_locator_evidence(
    workspace: Path,
    asset_root_id: str,
    skeleton: dict[str, Any],
) -> None:
    """Bind every declared locator scope to registered accepted cached pages."""
    scopes: list[tuple[str, dict[str, Any]]] = []
    global_scope = skeleton.get("mechanics_locator_scope")
    if isinstance(global_scope, dict):
        scopes.append(("mechanics_locator_scope", global_scope))
    for index, row in enumerate(skeleton.get("mechanics_index") or []):
        if not isinstance(row, dict):
            continue
        row_scope = row.get("locator_scope")
        if isinstance(row_scope, dict):
            scopes.append((f"mechanics_index[{index}].locator_scope", row_scope))
    for field, scope in scopes:
        _cached_source_refs(
            workspace,
            asset_root_id,
            {"source_page_indices": list(scope.get("pdf_indices") or [])},
            field=field,
        )


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
    if identity.get("source_bundles"):
        _validate_source_bound_skeleton_locator_evidence(
            workspace, asset_root_id, doc,
        )
    doc["schema_version"] = SCHEMA_VERSION
    path = mod / "skeleton.json"
    _write_json(path, doc)
    store_result = {
        "path": str(path),
        "location_count": len(doc.get("locations") or []),
    }
    try:
        _bump_parse_tier(
            workspace, asset_root_id, int(doc.get("parse_tier") or 1),
        )
    except Exception as exc:
        raise SkeletonStorePhaseError(
            "skeleton.json committed but parse-tier registry metadata failed",
            store_result=store_result,
            metadata_error=exc,
        ) from exc
    return store_result


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
    declared_scopes: list[tuple[str, set[int]]] = []
    refs = value.get("source_refs")
    if refs is not None:
        if not isinstance(refs, list):
            raise ModuleAssetsError(f"{field}.source_refs must be a list")
        ref_indices: list[int] = []
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
            ref_indices.append(pdf_index)
        if len(ref_indices) != len(set(ref_indices)):
            raise ModuleAssetsError(
                f"{field}.source_refs must not repeat a pdf_index"
            )
        if ref_indices:
            declared_scopes.append(("source_refs", set(ref_indices)))
    explicit = value.get("source_page_indices")
    if explicit is not None:
        if not isinstance(explicit, list) or any(
            isinstance(index, bool) or not isinstance(index, int) or index < 0
            for index in explicit
        ):
            raise ModuleAssetsError(
                f"{field}.source_page_indices must be non-negative integers"
            )
        if len(explicit) != len(set(explicit)):
            raise ModuleAssetsError(
                f"{field}.source_page_indices must not contain duplicates"
            )
        if explicit:
            declared_scopes.append(("source_page_indices", set(explicit)))
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
        declared_scopes.append(("source_span", set(range(start, end + 1))))
    if declared_scopes:
        canonical_name, canonical = declared_scopes[0]
        for other_name, other in declared_scopes[1:]:
            if other != canonical:
                raise ModuleAssetsError(
                    f"{field}.{other_name} must select exactly the same pages as "
                    f"{field}.{canonical_name}; source scopes must not widen silently"
                )
        return sorted(canonical)
    return []


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
    file_sha256 = str(identity.get("file_sha256") or "").strip().lower()
    source_file_sha256 = str(source.get("file_sha256") or "").strip().lower()
    if not file_sha256 or source_file_sha256 != file_sha256:
        raise ModuleAssetsError(
            f"{field} cannot bind evidence: asset root source identity is inconsistent"
        )
    bundle_rows = [
        row for row in (identity.get("source_bundles") or [])
        if isinstance(row, dict)
    ]
    registered_page_bundles: dict[int, set[str]] = {}
    for bundle_row in bundle_rows:
        bundle_sha256 = str(bundle_row.get("bundle_sha256") or "").strip()
        if not bundle_sha256:
            continue
        for raw_index in bundle_row.get("pdf_indices") or []:
            if isinstance(raw_index, bool) or not isinstance(raw_index, int):
                continue
            registered_page_bundles.setdefault(raw_index, set()).add(bundle_sha256)
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
        if str(meta.get("source_id") or "").strip() != source_id:
            raise ModuleAssetsError(
                f"{field} cached pdf_index {pdf_index} has a different source_id"
            )
        if str(meta.get("file_sha256") or "").strip().lower() != file_sha256:
            raise ModuleAssetsError(
                f"{field} cached pdf_index {pdf_index} has a different source file identity"
            )
        if meta.get("review_state") not in coc_pdf_bundle.ACCEPTED_REVIEW_STATES:
            raise ModuleAssetsError(
                f"{field} cached pdf_index {pdf_index} is not in an accepted review state"
            )
        actual_digest = hashlib.sha256(page["text"].encode("utf-8")).hexdigest()
        cached_digest = str(meta.get("text_sha256") or "").lower()
        if cached_digest != actual_digest:
            raise ModuleAssetsError(
                f"{field} cached pdf_index {pdf_index} content hash drift"
            )
        registered = registered_page_bundles.get(pdf_index) or set()
        cached_bundle_hashes = {
            str(value)
            for value in (meta.get("bundle_sha256s") or [])
            if isinstance(value, str) and value
        }
        unregistered_bundle_hashes = cached_bundle_hashes - registered
        if unregistered_bundle_hashes:
            raise ModuleAssetsError(
                f"{field} cached pdf_index {pdf_index} claims unregistered "
                "source bundle coverage"
            )
        canonical_bundle_hashes = sorted(registered & cached_bundle_hashes)
        if not canonical_bundle_hashes:
            raise ModuleAssetsError(
                f"{field} cached pdf_index {pdf_index} is not covered by a "
                "registered accepted source bundle"
            )
        if supplied.get("text_sha256") not in (None, cached_digest):
            raise ModuleAssetsError(
                f"{field}.source_refs for pdf_index {pdf_index} do not match cached text"
            )
        ref: dict[str, Any] = {
            "source_id": source_id,
            "pdf_index": pdf_index,
            "text_sha256": cached_digest,
            "bundle_sha256s": canonical_bundle_hashes,
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


def opening_page_candidate_catalog(
    workspace: Path,
    asset_root_id: str,
    *,
    bundle_sha256: str,
) -> dict[str, Any]:
    """Return the bound bundle's complete meta-only page selection hints.

    ``progressive.prepare_opening`` reuses this one catalog for foreground
    opening and deferred mechanics-locator selection.  The live Keeper chooses
    each exact window semantically.  Rows are hints, never source provenance;
    page bodies are deliberately not read here.
    """
    bundle_digest = _require_sha256(bundle_sha256, "bundle_sha256")
    module_root = _module_dir(workspace, asset_root_id)
    identity_path = module_root / "identity.json"
    if not identity_path.is_file():
        raise ModuleAssetsError("unknown module assets root")
    try:
        identity = json.loads(identity_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ModuleAssetsError("module asset identity is unreadable") from exc
    if (
        not isinstance(identity, dict)
        or identity.get("schema_version") != SCHEMA_VERSION
        or str(identity.get("asset_root_id") or "") != asset_root_id
    ):
        raise ModuleAssetsError("module asset identity is invalid")
    source = identity.get("source") if isinstance(identity.get("source"), dict) else {}
    source_id = str(source.get("source_id") or "").strip()
    file_sha256 = _require_sha256(
        identity.get("file_sha256"), "identity.file_sha256",
    )
    if (
        not source_id
        or str(source.get("file_sha256") or "").strip().lower() != file_sha256
    ):
        raise ModuleAssetsError(
            "opening page catalog source identity is inconsistent"
        )
    page_count = source.get("page_count")
    if (
        isinstance(page_count, bool)
        or not isinstance(page_count, int)
        or page_count <= 0
    ):
        raise ModuleAssetsError("opening page catalog source page_count is invalid")

    bundle_rows = [
        row for row in (identity.get("source_bundles") or [])
        if isinstance(row, dict)
    ]
    selected_rows = [
        row for row in bundle_rows
        if str(row.get("bundle_sha256") or "") == bundle_digest
    ]
    if len(selected_rows) != 1:
        raise ModuleAssetsError(
            "opening source bundle is not uniquely registered for this asset root"
        )
    raw_indices = selected_rows[0].get("pdf_indices")
    if not isinstance(raw_indices, list) or not raw_indices:
        raise ModuleAssetsError("opening source bundle has no registered pages")
    if len(raw_indices) > coc_pdf_bundle.MAX_PAGES:
        raise ModuleAssetsError(
            "opening source bundle exceeds the bounded page-candidate limit"
        )
    if any(
        isinstance(value, bool)
        or not isinstance(value, int)
        or not 0 <= value < page_count
        for value in raw_indices
    ):
        raise ModuleAssetsError("opening source bundle has invalid pdf_indices")
    if len(raw_indices) != len(set(raw_indices)):
        raise ModuleAssetsError("opening source bundle repeats a pdf_index")
    pdf_indices = sorted(raw_indices)

    registered_page_bundles: dict[int, set[str]] = {}
    for row in bundle_rows:
        digest = str(row.get("bundle_sha256") or "").strip()
        if len(digest) != 64 or any(char not in _HEX for char in digest):
            continue
        indices = row.get("pdf_indices")
        if not isinstance(indices, list):
            continue
        for pdf_index in indices:
            if isinstance(pdf_index, bool) or not isinstance(pdf_index, int):
                continue
            registered_page_bundles.setdefault(pdf_index, set()).add(digest)

    def bounded_preview(anchors: list[str]) -> str:
        text = " | ".join(anchor.strip() for anchor in anchors)
        encoded = text.encode("utf-8")
        limit = OPENING_PAGE_CANDIDATE_PREVIEW_MAX_BYTES
        if len(encoded) <= limit:
            return text
        prefix = encoded[: limit - 3]
        while prefix:
            try:
                return prefix.decode("utf-8").rstrip() + "..."
            except UnicodeDecodeError:
                prefix = prefix[:-1]
        return "..."

    candidates: list[dict[str, Any]] = []
    for pdf_index in pdf_indices:
        meta_path = module_root / "pages" / f"{pdf_index:04d}.meta.json"
        if not meta_path.is_file():
            raise ModuleAssetsError(
                f"opening cached pdf_index {pdf_index} metadata is missing"
            )
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ModuleAssetsError(
                f"opening cached pdf_index {pdf_index} metadata is unreadable"
            ) from exc
        if (
            not isinstance(meta, dict)
            or meta.get("schema_version") != SCHEMA_VERSION
            or meta.get("pdf_index") != pdf_index
        ):
            raise ModuleAssetsError(
                f"opening cached pdf_index {pdf_index} metadata is invalid"
            )
        if str(meta.get("source_id") or "").strip() != source_id:
            raise ModuleAssetsError(
                f"opening cached pdf_index {pdf_index} has a different source_id"
            )
        if str(meta.get("file_sha256") or "").strip().lower() != file_sha256:
            raise ModuleAssetsError(
                f"opening cached pdf_index {pdf_index} has a different source file identity"
            )
        review_state = meta.get("review_state")
        if review_state not in coc_pdf_bundle.ACCEPTED_REVIEW_STATES:
            raise ModuleAssetsError(
                f"opening cached pdf_index {pdf_index} is not in an accepted review state"
            )
        parse_confidence = meta.get("parse_confidence")
        if (
            isinstance(parse_confidence, bool)
            or not isinstance(parse_confidence, (int, float))
            or not 0 <= parse_confidence <= 1
        ):
            raise ModuleAssetsError(
                f"opening cached pdf_index {pdf_index} parse_confidence is invalid"
            )
        anchors = meta.get("grep_anchors")
        if not isinstance(anchors, list) or any(
            not isinstance(anchor, str) or not anchor.strip()
            for anchor in anchors
        ):
            raise ModuleAssetsError(
                f"opening cached pdf_index {pdf_index} grep_anchors are invalid"
            )
        cached_bundle_hashes = {
            str(value)
            for value in (meta.get("bundle_sha256s") or [])
            if isinstance(value, str) and value
        }
        if isinstance(meta.get("bundle_sha256"), str) and meta["bundle_sha256"]:
            cached_bundle_hashes.add(str(meta["bundle_sha256"]))
        registered = registered_page_bundles.get(pdf_index) or set()
        if bundle_digest not in cached_bundle_hashes or bundle_digest not in registered:
            raise ModuleAssetsError(
                f"opening cached pdf_index {pdf_index} is not bound to the selected source bundle"
            )
        if cached_bundle_hashes - registered:
            raise ModuleAssetsError(
                f"opening cached pdf_index {pdf_index} claims unregistered source bundle coverage"
            )
        candidates.append({
            "pdf_index": pdf_index,
            "review_state": review_state,
            "parse_confidence": parse_confidence,
            "grep_anchor_preview": bounded_preview(list(anchors)),
        })
    return {
        "opening_page_candidates": candidates,
        "opening_page_candidate_total": len(candidates),
        "opening_page_candidate_complete": True,
        "opening_page_candidate_role": "selection_hint_only_not_provenance",
    }


def validate_opening_source_window(
    workspace: Path,
    asset_root_id: str,
    *,
    bundle_sha256: str,
    pdf_indices: list[int],
) -> dict[str, Any]:
    """Validate one exact, accepted 1..3-page foreground source window.

    This is a read-only evidence operation.  It never creates a cache row or
    repairs page metadata; callers must register the host-reviewed bundle
    before selecting the window.
    """
    bundle_digest = _require_sha256(bundle_sha256, "bundle_sha256")
    if not isinstance(pdf_indices, list) or not pdf_indices:
        raise ModuleAssetsError("opening pdf_indices must contain 1..3 pages")
    if len(pdf_indices) > 3:
        raise ModuleAssetsError("opening pdf_indices must contain 1..3 pages")
    if any(
        isinstance(value, bool) or not isinstance(value, int) or value < 0
        for value in pdf_indices
    ):
        raise ModuleAssetsError(
            "opening pdf_indices must be non-negative integers"
        )
    if len(pdf_indices) != len(set(pdf_indices)):
        raise ModuleAssetsError("opening pdf_indices must not contain duplicates")
    canonical_indices = sorted(pdf_indices)
    if canonical_indices != list(
        range(canonical_indices[0], canonical_indices[-1] + 1)
    ):
        raise ModuleAssetsError("opening pdf_indices must be contiguous")

    module_root = _module_dir(workspace, asset_root_id)
    identity_path = module_root / "identity.json"
    if not identity_path.is_file():
        raise ModuleAssetsError("unknown module assets root")
    identity = json.loads(identity_path.read_text(encoding="utf-8"))
    source = identity.get("source") if isinstance(identity.get("source"), dict) else {}
    bundle_row = next(
        (
            row
            for row in (identity.get("source_bundles") or [])
            if isinstance(row, dict)
            and str(row.get("bundle_sha256") or "") == bundle_digest
        ),
        None,
    )
    if bundle_row is None:
        raise ModuleAssetsError(
            "opening source bundle is not registered for this asset root"
        )
    covered = {
        value
        for value in (bundle_row.get("pdf_indices") or [])
        if isinstance(value, int) and not isinstance(value, bool)
    }
    if not set(canonical_indices) <= covered:
        raise ModuleAssetsError(
            "opening pdf_indices are not covered by the campaign-bound source bundle"
        )
    refs = _cached_source_refs(
        workspace,
        asset_root_id,
        {"source_page_indices": canonical_indices},
        field="opening_source_window",
    )
    for ref in refs:
        if bundle_digest not in set(ref.get("bundle_sha256s") or []):
            raise ModuleAssetsError(
                f"opening cached pdf_index {ref.get('pdf_index')} is not bound "
                "to the selected source bundle"
            )
    page_refs = [
        {
            "source_id": str(ref.get("source_id") or ""),
            "pdf_index": int(ref["pdf_index"]),
            "text_sha256": str(ref.get("text_sha256") or ""),
            "review_state": ref.get("review_state"),
            "parse_confidence": ref.get("parse_confidence"),
        }
        for ref in refs
    ]
    return {
        "source_id": str(source.get("source_id") or ""),
        "file_sha256": _require_sha256(
            identity.get("file_sha256"), "identity.file_sha256"
        ),
        "bundle_sha256": bundle_digest,
        "pdf_indices": canonical_indices,
        "page_refs": page_refs,
    }


def validate_opening_source_scope(
    workspace: Path,
    asset_root_id: str,
    scope: Any,
) -> dict[str, Any]:
    """Revalidate a durable exact opening job scope without widening it."""
    if not isinstance(scope, dict):
        raise ModuleAssetsError("requested_source_scope must be an object")
    allowed = {
        "source_id", "file_sha256", "bundle_sha256", "pdf_indices", "page_refs",
    }
    if set(scope) - allowed:
        raise ModuleAssetsError(
            "requested_source_scope contains unsupported fields"
        )
    canonical = validate_opening_source_window(
        workspace,
        asset_root_id,
        bundle_sha256=str(scope.get("bundle_sha256") or ""),
        pdf_indices=scope.get("pdf_indices"),
    )
    if scope.get("pdf_indices") != canonical["pdf_indices"]:
        raise ModuleAssetsError(
            "requested_source_scope.pdf_indices must be in canonical ascending order"
        )
    for field in ("source_id", "file_sha256"):
        if scope.get(field) != canonical[field]:
            raise ModuleAssetsError(
                f"requested_source_scope.{field} differs from the bound source"
            )
    if scope.get("page_refs") != canonical["page_refs"]:
        raise ModuleAssetsError(
            "requested_source_scope.page_refs differ from current accepted pages"
        )
    return canonical


def opening_source_scope_signature(scope: dict[str, Any]) -> str:
    """Content identity used only for exact opening request dedupe."""
    material = json.dumps(
        {
            "source_id": scope.get("source_id"),
            "file_sha256": scope.get("file_sha256"),
            "bundle_sha256": scope.get("bundle_sha256"),
            "pdf_indices": list(scope.get("pdf_indices") or []),
            "page_refs": list(scope.get("page_refs") or []),
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(material).hexdigest()


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


def _canonical_fact_source_evidence(
    workspace: Path,
    asset_root_id: str,
    refs: list[dict[str, Any]],
) -> dict[str, Any]:
    """Build the one repository-owned evidence object for a source fact."""
    identity = json.loads(
        (_module_dir(workspace, asset_root_id) / "identity.json").read_text(
            encoding="utf-8"
        )
    )
    source = identity.get("source") if isinstance(identity.get("source"), dict) else {}
    return {
        "schema_version": 1,
        "source_id": source.get("source_id"),
        "file_sha256": identity.get("file_sha256"),
        "bundle_sha256s": sorted({
            bundle_hash
            for ref in refs
            for bundle_hash in (ref.get("bundle_sha256s") or [])
            if isinstance(bundle_hash, str) and bundle_hash
        }),
        "pdf_indices": [int(ref["pdf_index"]) for ref in refs],
        "page_text_sha256": [str(ref["text_sha256"]) for ref in refs],
    }


def _canonicalize_source_authored_fact(
    workspace: Path,
    asset_root_id: str,
    container: dict[str, Any],
    *,
    field: str,
    inherited_indices: list[int] | None = None,
) -> None:
    """Canonicalize one source-authored fact and bind provenance to its scope.

    Record refs are the canonical semantic page selection. Provenance refs may
    be omitted; when supplied they must independently resolve through the same
    accepted cache and match the record source-id/page/text signature exactly.
    """
    provenance = container.get("provenance")
    if not isinstance(provenance, dict):
        return
    if str(provenance.get("authority") or "") != "source_authored":
        return
    identity = json.loads(
        (_module_dir(workspace, asset_root_id) / "identity.json").read_text(
            encoding="utf-8"
        )
    )
    if not identity.get("source_bundles"):
        raise ModuleAssetsError(
            f"{field} source_authored fact requires a registered accepted "
            "source bundle"
        )
    _validate_closed_fact_provenance_fields(
        provenance, field=f"{field}.provenance",
    )
    _reject_parallel_record_source_fields(container, field=field)
    if "source_refs" in container and not container.get("source_refs"):
        raise ModuleAssetsError(
            f"{field}.source_refs must be omitted for parent inheritance or "
            "contain a non-empty exact fact scope"
        )
    supplied_page_digests = json.loads(json.dumps(
        container.get("page_text_sha256")
    )) if "page_text_sha256" in container else None
    supplied_source_evidence = json.loads(json.dumps(
        container.get("source_evidence")
    )) if "source_evidence" in container else None
    record_refs = _cached_source_refs(
        workspace,
        asset_root_id,
        container,
        field=field,
        inherited_indices=inherited_indices,
    )
    if not record_refs:
        raise ModuleAssetsError(
            f"{field} source_authored fact requires an exact cached source scope"
        )
    canonical_page_digests = [str(ref["text_sha256"]) for ref in record_refs]
    if (
        "page_text_sha256" in container
        and supplied_page_digests != canonical_page_digests
    ):
        raise ModuleAssetsError(
            f"{field}.page_text_sha256 must exactly match the accepted cached pages"
        )
    canonical_evidence = _canonical_fact_source_evidence(
        workspace, asset_root_id, record_refs,
    )
    if (
        "source_evidence" in container
        and supplied_source_evidence != canonical_evidence
    ):
        raise ModuleAssetsError(
            f"{field}.source_evidence must exactly match repository-derived "
            "accepted source evidence"
        )
    _apply_canonical_source_scope(container, record_refs)
    container["source_evidence"] = canonical_evidence

    if "source_refs" not in provenance:
        return
    raw_provenance_refs = provenance.get("source_refs")
    if not isinstance(raw_provenance_refs, list) or not raw_provenance_refs:
        raise ModuleAssetsError(
            f"{field}.provenance.source_refs must be omitted or a non-empty "
            "exact fact scope"
        )
    provenance_refs = _cached_source_refs(
        workspace,
        asset_root_id,
        {"source_refs": raw_provenance_refs},
        field=f"{field}.provenance",
    )
    if _source_ref_signature(provenance_refs) != _source_ref_signature(record_refs):
        raise ModuleAssetsError(
            f"{field}.provenance.source_refs must bind exactly to record source_refs"
        )
    provenance["source_refs"] = json.loads(json.dumps(provenance_refs))


def _validate_source_bound_locator_scope(
    workspace: Path,
    asset_root_id: str,
    scope: Any,
    *,
    field: str,
) -> None:
    """Prove one entity locator scope belongs to the bound source/cache."""
    identity = json.loads(
        (_module_dir(workspace, asset_root_id) / "identity.json").read_text(
            encoding="utf-8"
        )
    )
    source = identity.get("source") if isinstance(identity.get("source"), dict) else {}
    errors = _validate_locator_scope_object(
        scope,
        field=field,
        expected_file_sha256=str(identity.get("file_sha256") or "").lower(),
        page_count=(
            source.get("page_count")
            if isinstance(source.get("page_count"), int)
            and not isinstance(source.get("page_count"), bool)
            else None
        ),
    )
    if errors:
        raise ModuleAssetsError("; ".join(errors))
    _cached_source_refs(
        workspace,
        asset_root_id,
        {"source_page_indices": list(scope.get("pdf_indices") or [])},
        field=field,
    )


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
    provenance = doc.get("provenance") if isinstance(doc.get("provenance"), dict) else {}
    fact_authority = str(provenance.get("authority") or "")
    campaign_authority = fact_authority in {
        "campaign_improvised", "campaign_generated",
    }
    requires_evidence = (
        source_bound
        and parse_state in {"partial", "body_parsed", "deep"}
        and not bool(doc.get("evidence_gap"))
        and not campaign_authority
    )

    # Mechanics appendix evidence is independent from narrative/body depth.
    # A named_only NPC may still carry a fully authored, accepted mechanics
    # pack, and that nested fact must prove its own source scope.
    mechanics = doc.get("mechanics")
    if isinstance(mechanics, dict):
        mechanics_status = str(mechanics.get("status") or "")
        if source_bound and mechanics_status in {"located", "not_authored"}:
            _validate_source_bound_locator_scope(
                workspace,
                asset_root_id,
                mechanics.get("locator_scope"),
                field=f"{kind}.mechanics.locator_scope",
            )
        mechanics_provenance = (
            mechanics.get("provenance")
            if isinstance(mechanics.get("provenance"), dict)
            else {}
        )
        if str(mechanics_provenance.get("authority") or "") == "source_authored":
            _canonicalize_source_authored_fact(
                workspace,
                asset_root_id,
                mechanics,
                field=f"{kind}.mechanics",
            )

    indices = _source_indices(doc, field=kind)
    if kind == "clue" and fact_authority == "source_authored":
        _canonicalize_source_authored_fact(
            workspace,
            asset_root_id,
            doc,
            field="clue",
        )
        indices = _source_indices(doc, field=kind)
    if kind == "location":
        for position, clue in enumerate(doc.get("clues") or []):
            if not isinstance(clue, dict):
                continue
            clue_provenance = (
                clue.get("provenance")
                if isinstance(clue.get("provenance"), dict)
                else {}
            )
            if str(clue_provenance.get("authority") or "") == "source_authored":
                _canonicalize_source_authored_fact(
                    workspace,
                    asset_root_id,
                    clue,
                    field=f"location.clues[{position}]",
                    inherited_indices=(list(indices) if indices else None),
                )
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
                child_field = f"location.{collection}[{position}]"
                child_provenance = (
                    row.get("provenance")
                    if isinstance(row.get("provenance"), dict)
                    else {}
                )
                child_authority = str(child_provenance.get("authority") or "")
                if collection == "clues" and child_authority in {
                    "campaign_improvised", "campaign_generated",
                }:
                    # Campaign facts deliberately do not inherit parent PDF refs.
                    child_refs = []
                elif collection == "clues" and child_authority == "source_authored":
                    _canonicalize_source_authored_fact(
                        workspace,
                        asset_root_id,
                        row,
                        field=child_field,
                        inherited_indices=list(doc["source_page_indices"]),
                    )
                    child_refs = list(row.get("source_refs") or [])
                    row.setdefault("origin", "source")
                else:
                    child_refs = _cached_source_refs(
                        workspace,
                        asset_root_id,
                        row,
                        field=child_field,
                        inherited_indices=list(doc["source_page_indices"]),
                    )
                    _apply_canonical_source_scope(row, child_refs)
                    row.setdefault("origin", "source")
                for mention_position, mention in enumerate(row.get("mentions") or []):
                    if not isinstance(mention, dict):
                        continue
                    if not child_refs:
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
) -> tuple[dict[str, Any], str | None]:
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
        if host_timing.get("measurement"):
            timing["source_timing_measurement"] = host_timing.get("measurement")
        if host_timing.get("task_id"):
            timing["source_task_id"] = host_timing.get("task_id")
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
    matched_job_id: str | None = None
    if matching:
        _path, latest = max(
            matching, key=lambda row: str(row[1].get("created_at") or "")
        )
        requested_at = str(latest.get("created_at") or "")
        matched_job_id = str(latest.get("job_id") or "").strip() or None
        timing["source_work_group_id"] = latest.get("work_group_id")
        timing["source_deadline_class"] = latest.get("deadline_class")
        timing["source_dispatch_attempts"] = int(
            latest.get("dispatch_attempts") or 0
        )
        if latest.get("executor_id"):
            timing["source_executor_id"] = latest.get("executor_id")
        if latest.get("lease_id"):
            timing["source_lease_id"] = latest.get("lease_id")
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
        dispatched_at = str(latest.get("leased_at") or "")
        if dispatched_at:
            timing["source_dispatched_at"] = dispatched_at
            try:
                timing["source_dispatch_to_pack_ms"] = max(
                    0,
                    round(
                        (
                            datetime.fromisoformat(received_at)
                            - datetime.fromisoformat(dispatched_at)
                        ).total_seconds()
                        * 1000
                    ),
                )
            except ValueError:
                pass
    return timing, matched_job_id


def _compact_canonical_sha256(value: Any) -> str:
    encoded = json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def canonical_fulfilled_pack_digest(doc: dict[str, Any]) -> str:
    """Hash canonical semantic/source content, never host-work bookkeeping.

    The digest is intentionally computed after repository source
    canonicalization.  Top-level operational fields are excluded explicitly;
    nested authored fields with similar names remain semantic content.
    """
    semantic = {
        key: value
        for key, value in doc.items()
        if key not in _FULFILLED_PACK_OPERATIONAL_FIELDS
    }
    return _compact_canonical_sha256(semantic)


def canonical_source_evidence_digest(doc: dict[str, Any]) -> str:
    evidence = (
        doc.get("source_evidence")
        if isinstance(doc.get("source_evidence"), dict)
        else {}
    )
    return _compact_canonical_sha256(evidence)


def canonical_fulfilled_entity_receipt(
    kind: str,
    entity_id: str,
    doc: dict[str, Any],
) -> dict[str, Any]:
    """Versioned content/evidence identity shared by put and readiness."""
    return {
        "schema_version": FULFILLED_PACK_RECEIPT_SCHEMA_VERSION,
        "kind": kind,
        "entity_id": entity_id,
        "digest_kind": FULFILLED_PACK_DIGEST_KIND,
        "digest_version": FULFILLED_PACK_DIGEST_VERSION,
        "fulfilled_pack_sha256": canonical_fulfilled_pack_digest(doc),
        "source_evidence_sha256": canonical_source_evidence_digest(doc),
    }


def canonical_ingest_fulfillment_receipt(
    job_id: str,
    kind: str,
    entity_id: str,
    doc: dict[str, Any],
) -> dict[str, Any]:
    return {
        "job_id": job_id,
        **canonical_fulfilled_entity_receipt(kind, entity_id, doc),
    }


def current_ingest_fulfillment_receipt(
    doc: dict[str, Any],
) -> dict[str, Any] | None:
    timing = (
        doc.get("ingest_timing")
        if isinstance(doc.get("ingest_timing"), dict)
        else {}
    )
    receipt = timing.get(FULFILLED_PACK_INGEST_FIELD)
    return (
        json.loads(json.dumps(receipt))
        if isinstance(receipt, dict)
        else None
    )


def fulfilled_request_matches_current_pack(
    request: dict[str, Any],
    pack: dict[str, Any],
    *,
    kind: str,
    entity_id: str,
) -> bool:
    """Prove one fulfilled request is for exactly this canonical pack."""
    current = current_ingest_fulfillment_receipt(pack)
    if not isinstance(current, dict):
        return False
    job_id = str(current.get("job_id") or "").strip()
    if not job_id or str(request.get("job_id") or "") != job_id:
        return False
    expected_entity = canonical_fulfilled_entity_receipt(
        kind, entity_id, pack,
    )
    expected_current = {"job_id": job_id, **expected_entity}
    return bool(
        request.get("status") == "fulfilled"
        and request.get("fulfilled_entity") == expected_entity
        and current == expected_current
    )


def _semantic_pack_digest(doc: dict[str, Any]) -> str:
    """Backward-compatible name for unchanged-pack reuse detection."""
    return canonical_fulfilled_pack_digest(doc)


def _mark_host_work_fulfilled(
    workspace: Path,
    asset_root_id: str,
    *,
    host_work_job_id: str | None,
    kind: str,
    entity_id: str,
    fulfilled_entity: dict[str, Any],
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
        request["dispatch_state"] = "fulfilled"
        request["fulfilled_at"] = fulfilled_at
        request["fulfilled_entity"] = json.loads(json.dumps(fulfilled_entity))
        request["repository_put_ms"] = repository_put_ms
        _write_json(path, request)
        return


def mark_locator_host_work_fulfilled(
    workspace: Path,
    asset_root_id: str,
    *,
    host_work_job_id: str,
    repository_put_ms: int,
) -> None:
    """Close one validated locator request after its skeleton delta is stored."""
    path = (
        _module_dir(workspace, asset_root_id)
        / "host-work"
        / f"{_require_id(host_work_job_id, 'host_work_job_id')}.json"
    )
    if not path.is_file():
        raise ModuleAssetsError("locator host-work request is missing")
    with coc_fileio.advisory_file_lock(
        _module_dir(workspace, asset_root_id) / "host-work.lock"
    ):
        request = json.loads(path.read_text(encoding="utf-8"))
        if request.get("kind") != "locate_mechanics_index":
            raise ModuleAssetsError("host-work request is not a mechanics locator pass")
        if request.get("status") in {"fulfilled", "cancelled", "superseded"}:
            raise ModuleAssetsError(
                f"locator host-work request is already {request.get('status')}"
            )
        request.update({
            "status": "fulfilled",
            "dispatch_state": "fulfilled",
            "fulfilled_at": _now_iso(),
            "repository_put_ms": max(0, int(repository_put_ms)),
        })
        _write_json(path, request)


def _refresh_host_work_cache(
    workspace: Path,
    asset_root_id: str,
    request: dict[str, Any],
) -> bool:
    """Refresh one request's exact cached-page projection in place.

    A later host PDF window may land after the request was created.  Claims
    must observe those newly cached pages without rebuilding or broadening the
    semantic request.
    """
    requested = request.get("requested_pdf_indices")
    if not isinstance(requested, list) or any(
        isinstance(value, bool) or not isinstance(value, int)
        for value in requested
    ):
        return False
    module_root = _module_dir(workspace, asset_root_id)
    refs: list[dict[str, Any]] = []
    for pdf_index in sorted(set(requested)):
        page = get_page(workspace, asset_root_id, pdf_index)
        if page is None:
            continue
        meta = page.get("meta") if isinstance(page.get("meta"), dict) else {}
        refs.append({
            "source_id": meta.get("source_id"),
            "pdf_index": pdf_index,
            "path": str(module_root / "pages" / f"{pdf_index:04d}.md"),
            "text_sha256": meta.get("text_sha256"),
            "bundle_sha256s": list(meta.get("bundle_sha256s") or []),
            "review_state": meta.get("review_state"),
            "parse_confidence": meta.get("parse_confidence"),
            "grep_anchors": list(meta.get("grep_anchors") or []),
        })
    changed = refs != list(request.get("cached_page_refs") or [])
    request["cached_page_refs"] = refs
    request["pages_cached"] = [f"{row['pdf_index']:04d}.md" for row in refs]
    request["cached_scope_complete"] = (
        set(requested) <= {int(row["pdf_index"]) for row in refs}
        if requested
        else None
    )
    return changed


def host_work_operational_class(request: dict[str, Any]) -> str:
    """Return one disjoint lifecycle class without trusting legacy ``ready``."""
    status = str(request.get("status") or "open")
    if status == "fulfilled":
        return "fulfilled"
    if status in {"cancelled", "superseded"}:
        return "stale"
    if str(request.get("dispatch_state") or "") == "leased":
        return "leased"
    requested = request.get("requested_pdf_indices")
    exact_scope = (
        isinstance(requested, list)
        and bool(requested)
        and not any(
            isinstance(value, bool) or not isinstance(value, int)
            for value in requested
        )
    )
    if not exact_scope:
        return "awaiting_scope"
    if request.get("cached_scope_complete") is not True:
        return "awaiting_cache"
    return "runnable"


def _sync_host_work_dispatch_state(request: dict[str, Any]) -> bool:
    """Persist the dispatch state implied by exact scope/cache/lease facts."""
    operational_class = host_work_operational_class(request)
    expected = (
        "ready" if operational_class == "runnable"
        else str(request.get("status") or "superseded")
        if operational_class == "stale"
        else operational_class
    )
    changed = str(request.get("dispatch_state") or "") != expected
    request["dispatch_state"] = expected
    return changed


def _refresh_host_work_lifecycle(
    workspace: Path,
    asset_root_id: str,
    request: dict[str, Any],
    *,
    now: datetime,
) -> bool:
    """Refresh cache availability and recover an expired lease in place."""
    changed = _refresh_host_work_cache(workspace, asset_root_id, request)
    if _lease_is_expired(request, now):
        request["last_lease_expired_at"] = now.isoformat()
        request.pop("dispatch_state", None)
        for key in (
            "lease_id", "leased_at", "lease_expires_at", "executor_id",
        ):
            request.pop(key, None)
        changed = True
    return _sync_host_work_dispatch_state(request) or changed


def _lease_is_expired(request: dict[str, Any], now: datetime) -> bool:
    if str(request.get("dispatch_state") or "ready") != "leased":
        return False
    expires_at = str(request.get("lease_expires_at") or "")
    try:
        expiry = datetime.fromisoformat(expires_at)
    except ValueError:
        return True
    if expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=timezone.utc)
    return expiry <= now


def claim_host_work_requests(
    workspace: Path,
    asset_root_id: str,
    *,
    executor_id: str,
    limit: int = 1,
    lease_seconds: int = 600,
    cached_only: bool = True,
) -> dict[str, Any]:
    """Atomically lease bounded source-page work groups for host subagents.

    The repository still does not parse PDF content.  It only coalesces exact
    page scopes and returns contract packets.  A host-native child reads those
    cached pages, while the parent Keeper remains the sole caller of the
    canonical fulfillment operation.
    """
    executor = str(executor_id or "").strip()
    if not executor or len(executor) > 128:
        raise ModuleAssetsError("executor_id must be 1..128 characters")
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 4:
        raise ModuleAssetsError("limit must be an integer from 1 through 4")
    if (
        isinstance(lease_seconds, bool)
        or not isinstance(lease_seconds, int)
        or not 30 <= lease_seconds <= 3600
    ):
        raise ModuleAssetsError("lease_seconds must be an integer from 30 through 3600")

    module_root = _module_dir(workspace, asset_root_id)
    work_dir = module_root / "host-work"
    if not work_dir.is_dir():
        return {
            "packets": [],
            "leased_group_count": 0,
            "ready_group_count": 0,
            "cached_only": bool(cached_only),
            "lifecycle": host_work_lifecycle_summary(
                workspace, asset_root_id,
            ),
        }
    now = datetime.now(timezone.utc)
    rows: list[tuple[Path, dict[str, Any]]] = []
    with coc_fileio.advisory_file_lock(module_root / "host-work.lock"):
        for path in sorted(work_dir.glob("*.json")):
            try:
                request = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if not isinstance(request, dict):
                continue
            if str(request.get("status") or "open") in HOST_WORK_CLOSED_STATUSES:
                continue
            changed = _refresh_host_work_lifecycle(
                workspace, asset_root_id, request, now=now,
            )
            if changed:
                _write_json(path, request)
            if host_work_operational_class(request) != "runnable":
                continue
            rows.append((path, request))

        grouped: dict[str, list[tuple[Path, dict[str, Any]]]] = {}
        for path, request in rows:
            group_id = str(request.get("work_group_id") or request.get("job_id") or "")
            grouped.setdefault(group_id, []).append((path, request))
        ordered_groups = sorted(
            grouped.items(),
            key=lambda item: (
                -max(int(row[1].get("priority") or 0) for row in item[1]),
                min(str(row[1].get("created_at") or "") for row in item[1]),
                item[0],
            ),
        )

        packets: list[dict[str, Any]] = []
        for group_id, members in ordered_groups[:limit]:
            lease_material = (
                f"{executor}:{group_id}:{now.isoformat()}:"
                + ",".join(str(row[1].get("job_id") or "") for row in members)
            ).encode("utf-8")
            lease_id = "source-lease-" + hashlib.sha256(lease_material).hexdigest()[:20]
            expires_at = now + timedelta(seconds=lease_seconds)
            packet_requests: list[dict[str, Any]] = []
            for path, request in members:
                request["dispatch_state"] = "leased"
                request["dispatch_attempts"] = int(
                    request.get("dispatch_attempts") or 0
                ) + 1
                request["executor_id"] = executor
                request["lease_id"] = lease_id
                request["leased_at"] = now.isoformat()
                request["lease_expires_at"] = expires_at.isoformat()
                _write_json(path, request)
                packet_requests.append({
                    key: request.get(key)
                    for key in (
                        "job_id", "kind", "target_id", "priority", "reason",
                        "instruction", "requested_pdf_indices", "cached_page_refs",
                        "cached_scope_complete", "batch_subjects",
                        "request_purpose", "requested_source_scope",
                        "source_scope_signature", "result_contract",
                        "work_level", "consumer", "dependency",
                    )
                })
            exemplar = members[0][1]
            packets.append({
                "schema_version": 1,
                "contract_id": "coc.source-pack-worker.v1",
                "packet_id": lease_id,
                "asset_root_id": asset_root_id,
                "work_group_id": group_id,
                "lease_expires_at": expires_at.isoformat(),
                "source_pdf": exemplar.get("source_pdf"),
                "source_id": exemplar.get("source_id"),
                "file_sha256": exemplar.get("file_sha256"),
                "source_aspect": exemplar.get("source_aspect") or "body",
                "request_purpose": exemplar.get("request_purpose"),
                "requested_source_scope": exemplar.get("requested_source_scope"),
                "source_scope_signature": exemplar.get("source_scope_signature"),
                "deadline_class": min(
                    (
                        str(row[1].get("deadline_class") or "next_turn_hot")
                        for row in members
                    ),
                    key=lambda value: {
                        "blocking_micro": 0,
                        "next_turn_hot": 1,
                        "hot_ring": 2,
                        "idle_warm": 3,
                    }.get(value, 9),
                ),
                "work_level": min(
                    (
                        str(row[1].get("work_level") or "L2_near_term")
                        for row in members
                    ),
                    key=lambda value: {
                        "L1_current_dependency": 0,
                        "L2_near_term": 1,
                        "L3_bounded_warm": 2,
                    }.get(value, 9),
                ),
                "requested_pdf_indices": list(
                    exemplar.get("requested_pdf_indices") or []
                ),
                "cached_scope_complete": all(
                    row[1].get("cached_scope_complete") is True for row in members
                ),
                "requests": packet_requests,
            })
    result = {
        "packets": packets,
        "leased_group_count": len(packets),
        "ready_group_count": len(ordered_groups),
        "cached_only": bool(cached_only),
    }
    result["lifecycle"] = host_work_lifecycle_summary(
        workspace, asset_root_id,
    )
    return result


def _list_host_work_requests_unlocked(
    workspace: Path,
    asset_root_id: str,
    *,
    include_closed: bool = False,
    limit: int | None = 8,
) -> list[dict[str, Any]]:
    """Return a bounded, deterministic projection of durable host handoffs.

    Queue ``done`` rows are a negative cache, not proof that semantic parsing
    finished.  This projection makes the still-open host boundary visible to
    normal Keeper tools without exposing an unbounded directory history.
    """
    work_dir = _module_dir(workspace, asset_root_id) / "host-work"
    if not work_dir.is_dir():
        return []
    rows: list[dict[str, Any]] = []
    now = datetime.now(timezone.utc)
    for path in sorted(work_dir.glob("*.json")):
        try:
            request = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(request, dict):
            continue
        status = str(request.get("status") or "open")
        if status not in HOST_WORK_CLOSED_STATUSES and _refresh_host_work_lifecycle(
            workspace, asset_root_id, request, now=now,
        ):
            _write_json(path, request)
        if not include_closed and status in HOST_WORK_CLOSED_STATUSES:
            continue
        requested_indices = list(request.get("requested_pdf_indices") or [])
        source_scope_known = bool(requested_indices)
        deadline_class = request.get("deadline_class") or "next_turn_hot"
        work_level = request.get("work_level") or (
            "L1_current_dependency" if deadline_class == "blocking_micro"
            else "L3_bounded_warm" if deadline_class == "idle_warm"
            else "L2_near_term"
        )
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
            "requested_pdf_indices": requested_indices,
            "request_purpose": request.get("request_purpose"),
            "requested_source_scope": request.get("requested_source_scope"),
            "source_scope_signature": request.get("source_scope_signature"),
            "cached_page_refs": (
                list(request.get("cached_page_refs") or [])
                if source_scope_known else []
            ),
            "source_scope_status": (
                request.get("source_scope_status")
                or ("known" if source_scope_known else "unknown")
            ),
            "cached_scope_complete": request.get("cached_scope_complete"),
            "batch_subjects": list(request.get("batch_subjects") or []),
            "source_aspect": request.get("source_aspect") or "body",
            "deadline_class": deadline_class,
            "work_level": work_level,
            "consumer": (
                json.loads(json.dumps(request.get("consumer")))
                if isinstance(request.get("consumer"), dict)
                else None
            ),
            "dependency": (
                json.loads(json.dumps(request.get("dependency")))
                if isinstance(request.get("dependency"), dict)
                else None
            ),
            "work_group_id": request.get("work_group_id"),
            "dispatch_state": request.get("dispatch_state") or "awaiting_scope",
            "operational_class": host_work_operational_class(request),
            "dispatch_attempts": int(request.get("dispatch_attempts") or 0),
            "executor_id": request.get("executor_id"),
            "lease_id": request.get("lease_id"),
            "leased_at": request.get("leased_at"),
            "lease_expires_at": request.get("lease_expires_at"),
            "fulfilled_at": request.get("fulfilled_at"),
            "fulfilled_entity": (
                json.loads(json.dumps(request.get("fulfilled_entity")))
                if isinstance(request.get("fulfilled_entity"), dict)
                else None
            ),
            "fulfillment_operation": {
                "tool": "progressive.fulfill_host_work",
                "args": {
                    "worker_result": "<exact completed child results[i] object>",
                    "host_task_timing": "<exact host task metadata when available>",
                },
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
    if limit is None:
        return rows
    return rows[:max(0, int(limit))]


def list_host_work_requests(
    workspace: Path,
    asset_root_id: str,
    *,
    include_closed: bool = False,
    limit: int | None = 8,
) -> list[dict[str, Any]]:
    """Read and refresh host work under its canonical lifecycle lock."""
    module_root = _module_dir(workspace, asset_root_id)
    with coc_fileio.advisory_file_lock(module_root / "host-work.lock"):
        return _list_host_work_requests_unlocked(
            workspace,
            asset_root_id,
            include_closed=include_closed,
            limit=limit,
        )


def host_work_lifecycle_summary(
    workspace: Path,
    asset_root_id: str,
) -> dict[str, Any]:
    """Return disjoint durable lifecycle counts, including per-level work."""
    rows = list_host_work_requests(
        workspace, asset_root_id, include_closed=True, limit=None,
    )
    classes = (*HOST_WORK_OPEN_CLASSES, "stale", "fulfilled")
    counts = {
        f"{name}_count": sum(
            row.get("operational_class") == name for row in rows
        )
        for name in classes
    }
    by_work_level = {
        level: {
            name: sum(
                str(row.get("work_level") or "L2").startswith(level)
                and row.get("operational_class") == name
                for row in rows
            )
            for name in HOST_WORK_OPEN_CLASSES
        }
        for level in HOST_WORK_LEVELS
    }
    open_host_work_count = sum(
        counts[f"{name}_count"] for name in HOST_WORK_OPEN_CLASSES
    )
    return {
        "open_host_work_count": open_host_work_count,
        **counts,
        "stranded_ready_count": sum(
            row.get("dispatch_state") == "ready"
            and row.get("operational_class") != "runnable"
            for row in rows
        ),
        "by_work_level": by_work_level,
    }


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
    # The worker/request ID selects one live fulfillment transaction. It is
    # converted into the canonical ingest receipt below and never persisted as
    # a second top-level authority.
    transient_host_work_job_id = doc.pop("host_work_job_id", None)
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
    fulfilled_entity_receipt = canonical_fulfilled_entity_receipt(
        kind, eid, doc,
    )
    matched_host_work_job_id: str | None = None
    # Validate after source canonicalization so PDF refs are concrete, and pass
    # workspace context so not_authored can bind to the skeleton locator row.
    if (
        doc["parse_state"] in {"partial", "body_parsed", "deep"}
        or bool(str(transient_host_work_job_id or "").strip())
    ):
        fresh_timing, matched_host_work_job_id = _host_ingest_timing(
            workspace,
            asset_root_id,
            kind,
            eid,
            received_at=received_at,
            host_timing=doc.get("host_timing"),
            host_work_job_id=transient_host_work_job_id,
        )
        if (
            isinstance(previous, dict)
            and isinstance(previous.get("ingest_timing"), dict)
            and matched_host_work_job_id is None
            and _semantic_pack_digest(previous) == _semantic_pack_digest(doc)
        ):
            doc["ingest_timing"] = json.loads(
                json.dumps(previous["ingest_timing"])
            )
            doc["ingest_timing"].pop("host_work_job_id", None)
            doc["ingest_timing"]["last_pack_received_at"] = received_at
            doc["ingest_timing"]["pack_reuse_count"] = (
                int(doc["ingest_timing"].get("pack_reuse_count") or 0) + 1
            )
        else:
            if matched_host_work_job_id is not None:
                fresh_timing[FULFILLED_PACK_INGEST_FIELD] = (
                    canonical_ingest_fulfillment_receipt(
                        matched_host_work_job_id, kind, eid, doc,
                    )
                )
            doc["ingest_timing"] = fresh_timing
    _validate_entity_pack(
        kind,
        doc,
        workspace=workspace,
        asset_root_id=asset_root_id,
        entity_id=eid,
    )
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
        host_work_job_id=matched_host_work_job_id,
        kind=kind,
        entity_id=eid,
        fulfilled_entity=fulfilled_entity_receipt,
        fulfilled_at=received_at,
        repository_put_ms=out["repository_put_ms"],
    )
    if parse_state == "deep" and not doc.get("evidence_gap"):
        fulfillment = current_ingest_fulfillment_receipt(doc) or {}
        out["superseded_host_job_ids"] = _supersede_covered_entity_host_requests(
            workspace,
            asset_root_id,
            kind=kind,
            entity_id=eid,
            pack=doc,
            fulfilled_job_id=str(fulfillment.get("job_id") or "") or None,
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


def revalidate_entity_pack(
    workspace: Path,
    asset_root_id: str,
    kind: str,
    entity_id: str,
) -> dict[str, Any] | None:
    """Read and revalidate one durable pack against current accepted evidence."""
    stored = get_entity(workspace, asset_root_id, kind, entity_id)
    if stored is None:
        return None
    doc = json.loads(json.dumps(stored))
    _canonicalize_entity_source_evidence(
        workspace, asset_root_id, kind, doc,
    )
    _validate_entity_pack(
        kind,
        doc,
        workspace=workspace,
        asset_root_id=asset_root_id,
        entity_id=entity_id,
    )
    return doc


def _skeleton_entity_source_scope(
    workspace: Path,
    asset_root_id: str,
    kind: str,
    entity_id: str,
) -> dict[str, Any] | None:
    """Return exact Tier-1 evidence for an entity, when the skeleton has it.

    A later scene mention contributes contextual pages; it must not replace a
    character/location profile page already named by the skeleton.  A roster
    row and mechanics locator may bind the same accepted page, which remains
    one exact source reference in the aggregate scope.
    """
    collection, id_field = {
        "location": ("locations", "location_id"),
        "npc": ("npc_roster", "npc_id"),
        "item": ("item_roster", "item_id"),
    }.get(kind, (None, None))
    skeleton = get_skeleton(workspace, asset_root_id) or {}
    scopes: list[dict[str, Any]] = []
    if collection is not None and id_field is not None:
        for row in skeleton.get(collection) or []:
            if (
                isinstance(row, dict)
                and str(row.get(id_field) or "").strip() == str(entity_id)
            ):
                scopes.append(row)
                break
    for locator in skeleton.get("mechanics_index") or []:
        if (
            isinstance(locator, dict)
            and str(locator.get("subject_kind") or "") == kind
            and str(locator.get("subject_id") or "").strip() == str(entity_id)
        ):
            scopes.append(locator)
            break
    if not scopes:
        return None
    indices: set[int] = set()
    refs_by_index: dict[int, dict[str, Any]] = {}
    for position, scope in enumerate(scopes):
        indices.update(_source_indices(scope, field=f"skeleton scope[{position}]"))
        scope_refs = (
            scope.get("source_refs")
            if isinstance(scope.get("source_refs"), list) else []
        )
        for ref in scope_refs:
            copied_ref = json.loads(json.dumps(ref))
            pdf_index = int(copied_ref["pdf_index"])
            previous = refs_by_index.get(pdf_index)
            if previous is None:
                refs_by_index[pdf_index] = copied_ref
                continue
            for identity_field in ("source_id", "text_sha256"):
                previous_value = str(previous.get(identity_field) or "")
                incoming_value = str(copied_ref.get(identity_field) or "")
                if (
                    previous_value
                    and incoming_value
                    and previous_value != incoming_value
                ):
                    raise ModuleAssetsError(
                        "skeleton scopes conflict for pdf_index "
                        f"{pdf_index}: {identity_field} differs"
                    )
                if not previous_value and incoming_value:
                    previous[identity_field] = copied_ref[identity_field]
    result: dict[str, Any] = {}
    if indices:
        result["source_page_indices"] = sorted(indices)
    if refs_by_index and set(refs_by_index) == indices:
        result["source_refs"] = [
            refs_by_index[pdf_index] for pdf_index in sorted(refs_by_index)
        ]
    return result or None


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
    elif kind == "item":
        payload["label"] = title or entity_id
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
    request_purpose: str | None = None,
    requested_source_scope: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if kind not in JOB_KINDS:
        raise ModuleAssetsError(f"unknown job kind {kind!r}")
    tid = _require_id(target_id, "target_id")
    exact_source_scope: dict[str, Any] | None = None
    exact_source_signature: str | None = None
    exact_request_purpose: str | None = None
    if kind == "partial_opening":
        if request_purpose != FOREGROUND_OPENING_PURPOSE:
            raise ModuleAssetsError(
                "partial_opening requires request_purpose="
                f"{FOREGROUND_OPENING_PURPOSE!r}"
            )
        exact_source_scope = validate_opening_source_scope(
            workspace, asset_root_id, requested_source_scope,
        )
        exact_source_signature = opening_source_scope_signature(
            exact_source_scope
        )
        exact_request_purpose = FOREGROUND_OPENING_PURPOSE
        priority = 100
    elif kind == "locate_mechanics_index":
        if request_purpose != MECHANICS_LOCATOR_PURPOSE:
            raise ModuleAssetsError(
                "locate_mechanics_index requires request_purpose="
                f"{MECHANICS_LOCATOR_PURPOSE!r}"
            )
        exact_source_scope = validate_opening_source_scope(
            workspace, asset_root_id, requested_source_scope,
        )
        exact_source_signature = opening_source_scope_signature(
            exact_source_scope
        )
        exact_request_purpose = MECHANICS_LOCATOR_PURPOSE
    elif request_purpose is not None or requested_source_scope is not None:
        raise ModuleAssetsError(
            "explicit request purpose/source scope is only valid for "
            "partial_opening or locate_mechanics_index"
        )
    path = _module_dir(workspace, asset_root_id) / "parse-queue.json"
    if not path.is_file():
        raise ModuleAssetsError("init_module_root before enqueue_job")
    lock_path = _module_dir(workspace, asset_root_id) / "parse-queue.lock"
    deduped_job: dict[str, Any] | None = None
    dedupe_state: str | None = None
    stale_host_rows: list[dict[str, Any]] = []

    def exact_scoped_row_matches(row: dict[str, Any]) -> bool:
        if exact_source_scope is None:
            return True
        if (
            str(row.get("request_purpose") or "")
            != exact_request_purpose
            or str(row.get("source_scope_signature") or "")
            != exact_source_signature
        ):
            return False
        try:
            return validate_opening_source_scope(
                workspace, asset_root_id, row.get("requested_source_scope"),
            ) == exact_source_scope
        except ModuleAssetsError:
            return False

    def raise_exact_scope_conflict() -> None:
        label = (
            "opening_source_scope_conflict"
            if kind == "partial_opening"
            else "mechanics_locator_source_scope_conflict"
        )
        raise ModuleAssetsError(
            f"{label}: another unresolved exact source scope exists"
        )

    with coc_fileio.advisory_file_lock(lock_path):
        queue = json.loads(path.read_text(encoding="utf-8"))
        pending = list(queue.get("pending") or [])
        for job in pending:
            if not _same_entity_work(job, kind, tid):
                continue
            if exact_source_scope is not None and not exact_scoped_row_matches(job):
                raise_exact_scope_conflict()
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
                    if exact_source_scope is not None and not exact_scoped_row_matches(job):
                        raise_exact_scope_conflict()
                    deduped_job = job
                    dedupe_state = "in_flight"
                    break
        if deduped_job is None and reason != "put_entity_deep":
            for row in reversed(queue.get("done") or []):
                if (
                    kind in {"partial_opening", "locate_mechanics_index"}
                    and _same_entity_work(row, kind, tid)
                ):
                    job_id = str(row.get("job_id") or "")
                    request_path = (
                        _module_dir(workspace, asset_root_id)
                        / "host-work"
                        / f"{job_id}.json"
                    )
                    request: dict[str, Any] = {}
                    if request_path.is_file():
                        try:
                            loaded_request = json.loads(
                                request_path.read_text(encoding="utf-8")
                            )
                            if isinstance(loaded_request, dict):
                                request = loaded_request
                        except (OSError, json.JSONDecodeError):
                            request = {}
                    if str(request.get("status") or "open") not in {
                        "fulfilled", "cancelled", "superseded",
                    }:
                        if not exact_scoped_row_matches(request):
                            raise_exact_scope_conflict()
                        deduped_job = row
                        dedupe_state = "awaiting_host_pack"
                        break
                    continue
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
            pending_supersedes = sorted({
                str(row.get("job_id") or "").strip()
                for row in stale_host_rows
                if str(row.get("job_id") or "").strip()
            })
            if pending_supersedes:
                # The queue worker carries these exact row identities into the
                # host-work lock, where replacement creation and stale closure
                # happen as one visible lifecycle transition.
                job["supersedes_host_job_ids"] = pending_supersedes
            if exact_source_scope is not None:
                job.update({
                    "request_purpose": exact_request_purpose,
                    "requested_source_scope": exact_source_scope,
                    "source_scope_signature": exact_source_signature,
                })
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
    pending_supersedes = list(job.get("supersedes_host_job_ids") or [])
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
        "superseded_host_job_ids": [],
        "pending_supersede_host_job_ids": pending_supersedes,
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
