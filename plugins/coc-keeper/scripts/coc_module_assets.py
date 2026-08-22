#!/usr/bin/env python3
"""Durable progressive module-asset store (skeleton + pages + entity packs).

Slice 1 of docs/active-plans/coc-on-demand-module-skeleton.md:
schema constants, store layout, registry, skeleton validation, page/entity
writes, parse-queue enqueue. No play/director integration yet.

Layout: workspace ``.coc/module-assets/`` (local only, not git).
"""
from __future__ import annotations

import argparse
import base64
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
    "resolve_threat_mechanics",
    "locate_mechanics_index",
    "partial_neighbor", "partial_opening", "ensure_stub",
    "full_parse", "classify_sections", "extract_section",
})
FULL_PARSE_BATCH_LIMIT = 32
# How many work groups one claim may lease.  Leases are disjoint and taken
# under the host-work lock, so this bounds batch size, not safety: the old
# value of 4 was inherited from how many leaf processes could run at once and
# forced a whole-book pass to drain its queue four items at a time.
MAX_CLAIM_LIMIT = 32
# A turn-blocking dependency still claims exactly its one job; batching is for
# work nobody is waiting on.
CURRENT_DEPENDENCY_CLAIM_LIMIT = 1
FULL_PARSE_MAX_RENDER_FAILURES = 3
FOREGROUND_OPENING_PURPOSE = "foreground_opening_slice"
MECHANICS_LOCATOR_PURPOSE = "mechanics_locator_pass"
MECHANICS_LOCATOR_TARGET_ID = "mechanics-index"
CLASSIFY_SECTIONS_KIND = "classify_sections"
EXTRACT_SECTION_KIND = "extract_section"
SECTION_INDEX_TARGET_ID = "section-index"
SECTION_INDEX_NAME = "section-index.json"
SECTIONS_DIR = "sections"
HOST_WORK_SCHEMA_VERSION = 2
CLASSIFICATION_ENTITY_CATALOG_MAX = 800
CLASSIFICATION_ENTITY_CATALOG_PROVENANCE_VERSION = 1
HOST_WORK_CLOSED_STATUSES = frozenset({
    "fulfilled", "cancelled", "superseded", "quarantined",
})
HOST_WORK_LEVELS = ("current_dependency", "near_term", "bounded_warm")
HOST_WORK_OPEN_CLASSES = (
    "runnable", "leased", "awaiting_scope", "awaiting_cache", "legacy_unowned",
)
HOST_WORK_DEPENDENCY_FIELDS = frozenset({
    "operation", "subject", "settlement_id", "decision_id",
    "source_scope_signature",
})
HOST_WORK_DEPENDENCY_SUBJECT_FIELDS = frozenset({"kind", "id"})
HOST_WORK_CONSUMER_FIELDS = frozenset({
    "campaign_id", "scenario_binding_sha256", "intent_kind",
})
HOST_WORK_CONSUMER_INTENTS = frozenset({
    "opening", "scene_enter", "player_dig", "neighbor_prefetch",
    "mechanics", "source_scope_reattach", "full_parse",
    # Demand no longer arrives only as location traversal.  A published module
    # is entered through its rules, its clock, its tables and its era as much
    # as through its map, and each of those needs a demand signal of its own or
    # the pages that answer it are never requested.
    "section_pass", "invoke_subsystem", "meet_actor", "consult_table",
    "timeline_tick", "era_query", "resolution",
})
OPENING_CLOCK_REQUIRED_FIELDS = frozenset({
    "calendar_mode",
    "local_datetime",
    "local_date",
    "timezone",
    "display",
    "time_precision",
    "day_phase_hint",
})
OPENING_CLOCK_OPTIONAL_FIELDS = frozenset({
    "location_id",
    "day_phase_boundaries",
})
OPENING_CLOCK_CALENDAR_MODES = frozenset({
    "relative", "gregorian", "julian", "proleptic_gregorian", "fictional",
})
OPENING_CLOCK_PRECISIONS = frozenset({
    "exact", "minute", "hour", "date", "day_phase", "unknown",
})
OPENING_CLOCK_DAY_PHASES = frozenset({
    "morning", "afternoon", "evening", "night",
})
OPENING_PAGE_CANDIDATE_PREVIEW_MAX_BYTES = 96
# text_preview caps are UTF-8 byte budgets (not char counts): CJK page bodies
# cost ~3 bytes per char and must share prepare_opening's 12 KiB data budget.
OPENING_PAGE_CANDIDATE_TEXT_PREVIEW_MAX_BYTES = 600
OPENING_PAGE_CANDIDATE_TEXT_PREVIEW_TOTAL_MAX_BYTES = 4096
FULFILLED_PACK_RECEIPT_SCHEMA_VERSION = 1
FULFILLED_PACK_DIGEST_KIND = "canonical_entity_pack"
FULFILLED_PACK_DIGEST_VERSION = 1
FULFILLED_PACK_INGEST_FIELD = "host_work_fulfillment"
# Subjects that can carry authored game numbers.  Monsters were previously
# excluded, which left every Mythos-entity stat block in a module's monster
# appendix unreachable: the entity existed as a threat, but nothing could
# resolve its characteristics, attacks or SAN loss.
MECHANICS_SUBJECT_KINDS = frozenset({"npc", "item", "threat"})
MECHANICS_JOB_FOR_SUBJECT = {
    "npc": "resolve_npc_mechanics",
    "item": "resolve_item_mechanics",
    "threat": "resolve_threat_mechanics",
}
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
_CACHED_PAGE_DRIFT_RE = re.compile(r"^cached (?:structured )?page (\d+) content drift")
_HTML_TAG_RE = re.compile(r"<[^>]*>")
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
_SCENE_EDGE_SOURCE_AUTHORITY_FIELDS = frozenset({
    "origin",
    "provenance",
    "source_refs",
    "source_page_indices",
    "source_span",
    "page_text_sha256",
    "source_evidence",
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
    if job_kind == "resolve_threat_mechanics":
        return "threat"
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
    if job_kind in {CLASSIFY_SECTIONS_KIND, EXTRACT_SECTION_KIND}:
        # Whole-book structure, not a page-window body or mechanics read.
        return "structure"
    return (
        "mechanics"
        if job_kind.startswith("resolve_") or job_kind == "locate_mechanics_index"
        else "body"
    )


def _default_host_work_level(job_kind: str) -> str:
    """Return advisory urgency only; never infer an exact current dependency."""
    if job_kind == "locate_mechanics_index":
        return "bounded_warm"
    if job_kind == CLASSIFY_SECTIONS_KIND:
        # One whole-book structure pass per source.  It gates every later
        # section request, so it outranks page-level warm prefetch, but it is
        # still never a current dependency of a live turn.
        return "near_term"
    if job_kind == "full_parse":
        # Whole-book background parse is the lowest-urgency host lane; it must
        # never compete with opening/entity work for coordinator dispatches.
        return "bounded_warm"
    return "near_term"


def validate_host_work_dependency_ref(value: Any) -> dict[str, Any]:
    """Validate the one exact consumer reference allowed on current work."""
    if not isinstance(value, dict) or set(value) - HOST_WORK_DEPENDENCY_FIELDS:
        raise ModuleAssetsError("dependency_ref has unsupported fields")
    operation = _require_id(value.get("operation"), "dependency_ref.operation")
    subject = value.get("subject")
    if (
        not isinstance(subject, dict)
        or set(subject) != HOST_WORK_DEPENDENCY_SUBJECT_FIELDS
    ):
        raise ModuleAssetsError(
            "dependency_ref.subject must contain exactly kind and id"
        )
    subject_kind = _require_id(subject.get("kind"), "dependency_ref.subject.kind")
    subject_id = _require_id(subject.get("id"), "dependency_ref.subject.id")
    identities = [
        field for field in (
            "settlement_id", "decision_id", "source_scope_signature",
        )
        if str(value.get(field) or "").strip()
    ]
    if len(identities) != 1:
        raise ModuleAssetsError(
            "dependency_ref requires exactly one settlement_id, decision_id, "
            "or source_scope_signature"
        )
    identity_field = identities[0]
    identity = _require_id(
        value.get(identity_field), f"dependency_ref.{identity_field}",
    )
    return {
        "operation": operation,
        "subject": {"kind": subject_kind, "id": subject_id},
        identity_field: identity,
    }


def current_dependency_projection_id(
    campaign_id: str,
    asset_root_id: str,
    dependency_ref: Any,
) -> str:
    """Derive one stable audit/wait identity without persisting new state."""
    campaign = _require_id(campaign_id, "campaign_id")
    root_id = _require_id(asset_root_id, "asset_root_id")
    canonical = validate_host_work_dependency_ref(dependency_ref)
    material = {
        "campaign_id": campaign,
        "asset_root_id": root_id,
        "dependency_ref": canonical,
    }
    return (
        "source-dependency-"
        + hashlib.sha256(
            json.dumps(
                material,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
        ).hexdigest()[:20]
    )


def validate_host_work_contract(
    work_level: Any,
    dependency_ref: Any = None,
) -> tuple[str, dict[str, Any] | None]:
    level = str(work_level or "").strip()
    if level not in HOST_WORK_LEVELS:
        raise ModuleAssetsError(
            f"work_level must be one of {list(HOST_WORK_LEVELS)}"
        )
    if level == "current_dependency":
        return level, validate_host_work_dependency_ref(dependency_ref)
    if dependency_ref is not None:
        raise ModuleAssetsError(
            "dependency_ref is allowed only for work_level=current_dependency"
        )
    return level, None


def _scenario_binding_sha256(scenario: dict[str, Any]) -> str:
    source = scenario.get("source") if isinstance(scenario.get("source"), dict) else {}
    material = {
        "source_cache_asset_root_id": scenario.get("source_cache_asset_root_id"),
        "progressive_asset_root_id": scenario.get("progressive_asset_root_id"),
        "source": {
            key: source.get(key)
            for key in ("source_id", "file_sha256", "bundle_sha256")
        },
    }
    return hashlib.sha256(
        json.dumps(material, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def campaign_consumer_ref(
    workspace: Path,
    campaign_id: str,
    asset_root_id: str,
    *,
    intent_kind: str,
) -> dict[str, Any]:
    campaign = _require_id(campaign_id, "campaign_id")
    intent = str(intent_kind or "").strip()
    if intent not in HOST_WORK_CONSUMER_INTENTS:
        raise ModuleAssetsError("consumer intent_kind is invalid")
    scenario_path = (
        _coc_root(workspace) / "campaigns" / campaign / "scenario" / "scenario.json"
    )
    if not scenario_path.is_file():
        raise ModuleAssetsError("consumer campaign scenario is missing")
    scenario = json.loads(scenario_path.read_text(encoding="utf-8"))
    pointers = {
        str(scenario.get("source_cache_asset_root_id") or "").strip(),
        str(scenario.get("progressive_asset_root_id") or "").strip(),
    } - {""}
    if asset_root_id not in pointers:
        raise ModuleAssetsError("consumer campaign is bound to another asset root")
    return {
        "campaign_id": campaign,
        "scenario_binding_sha256": _scenario_binding_sha256(scenario),
        "intent_kind": intent,
    }


def validate_host_work_consumer_refs(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list) or not value:
        raise ModuleAssetsError("consumer_refs must be a non-empty array")
    normalized: list[dict[str, Any]] = []
    for position, row in enumerate(value):
        if not isinstance(row, dict) or set(row) != HOST_WORK_CONSUMER_FIELDS:
            raise ModuleAssetsError(
                f"consumer_refs[{position}] must contain exactly campaign_id, "
                "scenario_binding_sha256, and intent_kind"
            )
        campaign_id = _require_id(
            row.get("campaign_id"), f"consumer_refs[{position}].campaign_id",
        )
        digest = _require_sha256(
            row.get("scenario_binding_sha256"),
            f"consumer_refs[{position}].scenario_binding_sha256",
        )
        intent = str(row.get("intent_kind") or "").strip()
        if intent not in HOST_WORK_CONSUMER_INTENTS:
            raise ModuleAssetsError(
                f"consumer_refs[{position}].intent_kind is invalid"
            )
        normalized.append({
            "campaign_id": campaign_id,
            "scenario_binding_sha256": digest,
            "intent_kind": intent,
        })
    unique = {
        json.dumps(row, sort_keys=True, separators=(",", ":")): row
        for row in normalized
    }
    return [unique[key] for key in sorted(unique)]


def handout_card_result_contract(
    *,
    job_id: str,
    target_id: str,
    cached_page_refs: list[dict[str, Any]],
    allowed_registered_asset_refs: list[dict[str, Any]],
    allowed_scene_refs: list[str],
    allowed_clue_refs: list[str],
) -> dict[str, Any]:
    """Return the one trusted closed source-card contract shape."""
    return {
        "schema_version": 1,
        "contract_id": "coc.handout-card-pack.v1",
        "closed": True,
        "fixed_fields": {
            "handout_id": target_id,
            "asset_id": target_id,
            "parse_state": "deep",
            "evidence_gap": False,
            "origin": "source",
            "player_visible": True,
        },
        "allowed_pack_fields": [
            "handout_id", "asset_id", "kind", "title", "summary",
            "text", "localized_text", "when_to_deliver", "image_ref",
            "source_refs", "scene_refs", "clue_refs", "player_visible",
            "parse_state", "evidence_gap", "origin", "provenance",
        ],
        "required_pack_fields": [
            "handout_id", "asset_id", "kind", "title", "source_refs",
            "player_visible", "parse_state", "evidence_gap", "origin",
            "provenance",
        ],
        "kind_values": ["document", "read_aloud", "map"],
        "allowed_exact_source_refs": [
            {
                "source_id": str(ref.get("source_id") or ""),
                "pdf_index": int(ref["pdf_index"]),
                "text_sha256": str(ref.get("text_sha256") or ""),
                "card_source_ref": f"pdf_index-{int(ref['pdf_index'])}",
            }
            for ref in cached_page_refs
        ],
        "allowed_registered_asset_refs": json.loads(json.dumps(
            allowed_registered_asset_refs
        )),
        "allowed_scene_refs": list(allowed_scene_refs),
        "allowed_clue_refs": list(allowed_clue_refs),
        "provenance": {
            "required": {
                "authority": "source_authored",
                "basis": "host_pack",
            },
        },
        "result_item": {
            "fixed_fields": {"job_id": job_id},
            "related_packs": "must_be_empty",
        },
        "rules": [
            "card source_refs are a non-empty exact subset of allowed_exact_source_refs.card_source_ref",
            "image_ref is omitted or equals one allowed_registered_asset_refs.image_ref",
            "an image_ref asset pdf_index must be one of the card source_refs pages",
            "scene_refs and clue_refs are unique subsets of the exact allowed request ids; when the allowed set is empty the result field is absent or empty",
            "player_visible is true; Keeper-only material is not a handout result",
            "when_to_deliver is semantic advice for Keeper judgment, never a machine condition",
            "no aliases, extra fields, prose scan, keyword classification, or parent repair",
        ],
    }


def handout_allowed_relation_refs(
    workspace: Path,
    asset_root_id: str,
    target_id: str,
) -> dict[str, list[str]]:
    """Project only stub-asserted relations that already exist canonically."""
    skeleton = get_skeleton(workspace, asset_root_id) or {}
    handout = get_entity(workspace, asset_root_id, "handout", target_id) or {}

    scene_ids: set[str] = set()
    clue_ids: set[str] = set()

    def add_id(target: set[str], value: Any) -> None:
        try:
            target.add(_require_id(value, "handout relation id"))
        except ModuleAssetsError:
            return

    for row in skeleton.get("locations") or []:
        if not isinstance(row, dict):
            continue
        location_id = row.get("location_id")
        try:
            canonical_id = _require_id(location_id, "location_id")
        except ModuleAssetsError:
            continue
        scene_ids.add(canonical_id)
        for clue_id in row.get("available_clue_ids") or []:
            add_id(clue_ids, clue_id)
        for clue in row.get("clues") or []:
            if isinstance(clue, dict):
                add_id(clue_ids, clue.get("clue_id"))

    def allowed(field: str, canonical: set[str]) -> list[str]:
        declared = handout.get(field)
        if not isinstance(declared, list):
            return []
        result: set[str] = set()
        for value in declared:
            try:
                relation_id = _require_id(value, f"handout.{field}")
            except ModuleAssetsError:
                continue
            if relation_id in canonical:
                result.add(relation_id)
        return sorted(result)

    return {
        "allowed_scene_refs": allowed("scene_refs", scene_ids),
        "allowed_clue_refs": allowed("clue_refs", clue_ids),
    }


def _validate_handout_registered_asset_refs(value: Any) -> list[dict[str, Any]]:
    """Validate the closed asset rows exposed to one handout source worker."""
    try:
        return coc_source_media.validate_registered_asset_ref_rows(value)
    except coc_source_media.SourceMediaError as exc:
        raise ModuleAssetsError(str(exc)) from exc


def validate_host_work_request_shape(request: Any) -> None:
    """Reject non-current durable rows instead of inferring contract fields."""
    if not isinstance(request, dict):
        raise ModuleAssetsError("host-work request must be an object")
    if request.get("schema_version") != HOST_WORK_SCHEMA_VERSION:
        raise ModuleAssetsError("host-work request schema_version is not current")
    if request.get("status") == "quarantined":
        _require_id(request.get("job_id"), "host-work.job_id")
        _require_id(request.get("asset_root_id"), "host-work.asset_root_id")
        _require_sha256(
            request.get("rejected_evidence_sha256"),
            "host-work.rejected_evidence_sha256",
        )
        if not isinstance(request.get("quarantine_reason"), str) or not str(
            request.get("quarantine_reason")
        ).strip():
            raise ModuleAssetsError("quarantined host-work requires reason")
        return
    if "consumer" in request or "dependency" in request:
        raise ModuleAssetsError(
            "host-work request contains removed dependency projection fields"
        )
    _require_id(request.get("job_id"), "host-work.job_id")
    kind = str(request.get("kind") or "")
    if kind not in JOB_KINDS:
        raise ModuleAssetsError("host-work kind is invalid")
    target_id = _require_id(request.get("target_id"), "host-work.target_id")
    play_languages = request.get("play_languages")
    if (
        not isinstance(play_languages, list)
        or any(
            not isinstance(language, str) or not language.strip()
            for language in play_languages
        )
        or play_languages != sorted(set(play_languages))
    ):
        raise ModuleAssetsError(
            "host-work play_languages must be a sorted unique string array"
        )
    level, dependency_ref = validate_host_work_contract(
        request.get("work_level"), request.get("dependency_ref"),
    )
    if level != "current_dependency" and "dependency_ref" in request:
        raise ModuleAssetsError(
            "non-current host-work request must omit dependency_ref"
        )
    if level == "current_dependency" and dependency_ref is None:
        raise ModuleAssetsError("current host-work request requires dependency_ref")
    consumer_refs = request.get("consumer_refs")
    if consumer_refs is None:
        if request.get("consumer_state") not in {None, "legacy_unowned"}:
            raise ModuleAssetsError("host-work consumer_state is invalid")
    else:
        canonical = validate_host_work_consumer_refs(consumer_refs)
        if canonical != consumer_refs:
            raise ModuleAssetsError("host-work consumer_refs are not canonical")
        if request.get("consumer_state") not in {None, "owned"}:
            raise ModuleAssetsError("owned host-work consumer_state is invalid")
    if kind == "deepen_handout":
        cached_page_refs = request.get("cached_page_refs")
        if not isinstance(cached_page_refs, list):
            raise ModuleAssetsError(
                "deepen_handout requires cached_page_refs and "
                "allowed_registered_asset_refs arrays"
            )
        allowed_assets = _validate_handout_registered_asset_refs(
            request.get("allowed_registered_asset_refs")
        )
        if allowed_assets != request.get("allowed_registered_asset_refs"):
            raise ModuleAssetsError(
                "allowed_registered_asset_refs are not canonical"
            )
        allowed_relations: dict[str, list[str]] = {}
        for field in ("allowed_scene_refs", "allowed_clue_refs"):
            values = request.get(field)
            if not isinstance(values, list):
                raise ModuleAssetsError(f"{field} must be a canonical id array")
            try:
                canonical_values = [
                    _require_id(value, field) for value in values
                ]
            except ModuleAssetsError as exc:
                raise ModuleAssetsError(
                    f"{field} must be a canonical id array"
                ) from exc
            if values != sorted(set(canonical_values)):
                raise ModuleAssetsError(f"{field} must be a canonical id array")
            allowed_relations[field] = canonical_values
        try:
            expected_contract = handout_card_result_contract(
                job_id=str(request["job_id"]),
                target_id=target_id,
                cached_page_refs=cached_page_refs,
                allowed_registered_asset_refs=allowed_assets,
                allowed_scene_refs=allowed_relations["allowed_scene_refs"],
                allowed_clue_refs=allowed_relations["allowed_clue_refs"],
            )
        except (KeyError, TypeError, ValueError) as exc:
            raise ModuleAssetsError(
                "deepen_handout cached page refs are invalid"
            ) from exc
        if request.get("result_contract") != expected_contract:
            raise ModuleAssetsError(
                "deepen_handout result_contract is not the canonical closed card contract"
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


def _source_ref_signature(rows: Any) -> tuple[tuple[str, int, str, str, int, str, str], ...]:
    """Return the source identity that makes one host request reusable."""
    if not isinstance(rows, list):
        return ()
    normalized: list[tuple[str, int, str, str, int, str, str]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        pdf_index = row.get("pdf_index")
        if isinstance(pdf_index, bool) or not isinstance(pdf_index, int):
            continue
        revision = row.get("ocr_revision")
        revision = revision if isinstance(revision, dict) else {}
        normalized.append((
            str(row.get("source_id") or ""),
            pdf_index,
            str(row.get("text_sha256") or ""),
            str(revision.get("layer") or ""),
            int(revision.get("revision") or 0),
            str(revision.get("content_sha256") or ""),
            str(
                (row.get("structured_data") or {}).get("sha256")
                if isinstance(row.get("structured_data"), dict) else ""
            ),
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
) -> tuple[tuple[str, int, str, str, int, str, str], ...]:
    """Validate and normalize one fact's exact source-id/page/text identity."""
    if not isinstance(rows, list) or not rows:
        raise ModuleAssetsError(f"{field} must be a non-empty list")
    normalized: list[tuple[str, int, str, str, int, str, str]] = []
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
        revision_ref = ref.get("ocr_revision")
        revision_ref = revision_ref if isinstance(revision_ref, dict) else {}
        normalized.append((
            source_id, pdf_index, text_sha256,
            str(revision_ref.get("layer") or ""),
            int(revision_ref.get("revision") or 0),
            str(revision_ref.get("content_sha256") or ""),
            str(
                (ref.get("structured_data") or {}).get("sha256")
                if isinstance(ref.get("structured_data"), dict) else ""
            ),
        ))
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


READ_ALOUD_TRIGGERS = frozenset({
    "on_enter", "on_first_enter", "on_clue", "on_exit", "keeper_choice",
})
READ_ALOUD_MAX_BYTES = 4_000
KEEPER_ONLY_MAX_BYTES = 6_000


def _validate_location_read_aloud(doc: dict[str, Any]) -> None:
    """Boxed passages the Keeper reads out, kept verbatim and attributed.

    Nearly every surveyed scenario prints these, and not one of them prints
    them as a section: they are typeset boxes inside a location's own pages,
    so the whole-book section index cannot reach them and they have to live on
    the location pack.  They are quoted to the table as written, which is why
    each one carries its own page evidence rather than inheriting the pack's.
    """
    rows = doc.get("read_aloud")
    if rows is None:
        return
    if not isinstance(rows, list):
        raise ModuleAssetsError("location read_aloud must be a list")
    seen: set[str] = set()
    for index, row in enumerate(rows):
        prefix = f"location read_aloud[{index}]"
        if not isinstance(row, dict):
            raise ModuleAssetsError(f"{prefix} must be an object")
        extra = set(row) - {
            "id", "trigger", "title", "text", "localized_title",
            "localized_text", "localized_language", "source_refs", "condition",
        }
        if extra:
            raise ModuleAssetsError(
                f"{prefix} has unsupported fields: {sorted(extra)}"
            )
        row_id = str(row.get("id") or "").strip()
        if not row_id:
            raise ModuleAssetsError(f"{prefix}.id is required")
        if row_id in seen:
            raise ModuleAssetsError(f"duplicate read_aloud id {row_id!r}")
        seen.add(row_id)
        trigger = str(row.get("trigger") or "")
        if trigger not in READ_ALOUD_TRIGGERS:
            raise ModuleAssetsError(
                f"{prefix}.trigger must be one of {sorted(READ_ALOUD_TRIGGERS)}"
            )
        text = row.get("text")
        if not isinstance(text, str) or not text.strip():
            raise ModuleAssetsError(f"{prefix}.text is required")
        if len(text.encode("utf-8")) > READ_ALOUD_MAX_BYTES:
            raise ModuleAssetsError(f"{prefix}.text exceeds the passage cap")
        if trigger == "on_clue" and not str(row.get("condition") or "").strip():
            raise ModuleAssetsError(
                f"{prefix} with trigger=on_clue requires a condition"
            )
        for field in ("title",):
            value = row.get(field)
            if value is not None and (
                not isinstance(value, str) or not value.strip()
            ):
                raise ModuleAssetsError(
                    f"{prefix}.{field} must be a non-empty string when supplied"
                )
        for field in ("localized_title", "localized_text"):
            value = row.get(field)
            if value is None:
                continue
            if isinstance(value, str):
                if not value.strip():
                    raise ModuleAssetsError(
                        f"{prefix}.{field} must not be blank"
                    )
                continue
            if not isinstance(value, dict) or not value:
                raise ModuleAssetsError(
                    f"{prefix}.{field} must be a non-empty locale map"
                )
            for language, localized_value in value.items():
                if (
                    not isinstance(language, str)
                    or not language.strip()
                    or not isinstance(localized_value, str)
                    or not localized_value.strip()
                ):
                    raise ModuleAssetsError(
                        f"{prefix}.{field} must map language tags to non-empty strings"
                    )
        refs = row.get("source_refs")
        if not isinstance(refs, list) or not refs:
            raise ModuleAssetsError(
                f"{prefix}.source_refs is required: read-aloud text is quoted "
                "to players verbatim and must carry its own page evidence"
            )


def _canonicalize_location_read_aloud_refs(
    workspace: Path,
    asset_root_id: str,
    doc: dict[str, Any],
    *,
    allowed_request_indices: set[int] | None = None,
) -> None:
    parent_indices = set(doc.get("source_page_indices") or [])
    for position, row in enumerate(doc.get("read_aloud") or []):
        if not isinstance(row, dict):
            continue
        field = f"location.read_aloud[{position}]"
        supplied_refs = row.get("source_refs")
        if not isinstance(supplied_refs, list) or not supplied_refs:
            raise ModuleAssetsError(f"{field}.source_refs must be a non-empty list")
        for supplied in supplied_refs:
            if (
                not isinstance(supplied, dict)
                or not isinstance(supplied.get("source_id"), str)
                or not supplied["source_id"].strip()
                or isinstance(supplied.get("pdf_index"), bool)
                or not isinstance(supplied.get("pdf_index"), int)
            ):
                raise ModuleAssetsError(
                    f"{field}.source_refs entries require source_id and integer pdf_index"
                )
        canonical_refs = _cached_source_refs(
            workspace,
            asset_root_id,
            row,
            field=field,
        )
        supplied_by_index = {
            int(supplied["pdf_index"]): supplied for supplied in supplied_refs
        }
        if len(supplied_by_index) != len(supplied_refs):
            raise ModuleAssetsError(f"{field}.source_refs contain duplicate pages")
        for canonical in canonical_refs:
            supplied = supplied_by_index[int(canonical["pdf_index"])]
            for evidence_field in (
                "bundle_sha256s", "review_state", "parse_confidence",
                "grep_anchors", "structured_data", "printed_page",
                "printed_label",
            ):
                if (
                    evidence_field in supplied
                    and supplied[evidence_field] != canonical.get(evidence_field)
                ):
                    raise ModuleAssetsError(
                        f"{field}.source_refs contain stale {evidence_field} evidence"
                    )
        child_indices = {int(ref["pdf_index"]) for ref in canonical_refs}
        if not child_indices.issubset(parent_indices):
            raise ModuleAssetsError(
                f"{field}.source_refs are outside its parent location source scope"
            )
        if (
            allowed_request_indices is not None
            and not child_indices.issubset(allowed_request_indices)
        ):
            raise ModuleAssetsError(
                f"{field}.source_refs are outside the host-work request source scope"
            )
        row["source_refs"] = canonical_refs


def _validate_location_read_aloud_locales(
    doc: dict[str, Any], required_languages: set[str]
) -> None:
    for position, row in enumerate(doc.get("read_aloud") or []):
        if not isinstance(row, dict):
            continue
        field = f"location.read_aloud[{position}]"
        for localized_field in ("localized_title", "localized_text"):
            value = row.get(localized_field)
            if isinstance(value, dict):
                missing = sorted(required_languages - set(value))
            elif isinstance(value, str):
                tagged = str(row.get("localized_language") or "").strip()
                missing = sorted(
                    language for language in required_languages
                    if language != tagged
                )
            else:
                missing = sorted(required_languages)
            if missing:
                raise ModuleAssetsError(
                    f"{field}.{localized_field} lacks full active play_language "
                    f"values: {missing}"
                )


def _validate_location_keeper_only(doc: dict[str, Any]) -> None:
    """The Keeper-facing notes printed beside a location's public description.

    Published scenarios interleave these constantly — one surveyed module
    prints 110 of them — and they are the difference between a Keeper who
    knows why a room matters and one reading a travel brochure.  They were
    previously discarded because the pack had nowhere to put them, and a clue
    is the wrong home: most are context, not discoverable information.

    Anything stored here is Keeper-only by construction; nothing may mark it
    otherwise, because a single mislabeled row leaks the scenario's solution
    onto a player-facing surface.
    """
    rows = doc.get("keeper_only")
    if rows is None:
        return
    if not isinstance(rows, list):
        raise ModuleAssetsError("location keeper_only must be a list")
    seen: set[str] = set()
    for index, row in enumerate(rows):
        prefix = f"location keeper_only[{index}]"
        if not isinstance(row, dict):
            raise ModuleAssetsError(f"{prefix} must be an object")
        extra = set(row) - {"id", "note", "source_refs"}
        if extra:
            raise ModuleAssetsError(
                f"{prefix} has unsupported fields: {sorted(extra)}; "
                "keeper_only rows are never player-facing and carry no "
                "audience or delivery of their own"
            )
        row_id = str(row.get("id") or "").strip()
        if not row_id:
            raise ModuleAssetsError(f"{prefix}.id is required")
        if row_id in seen:
            raise ModuleAssetsError(f"duplicate keeper_only id {row_id!r}")
        seen.add(row_id)
        note = row.get("note")
        if not isinstance(note, str) or not note.strip():
            raise ModuleAssetsError(f"{prefix}.note is required")
        if len(note.encode("utf-8")) > KEEPER_ONLY_MAX_BYTES:
            raise ModuleAssetsError(f"{prefix}.note exceeds the note cap")
        refs = row.get("source_refs")
        if not isinstance(refs, list) or not refs:
            raise ModuleAssetsError(f"{prefix}.source_refs is required")


def _validate_entity_pack(
    kind: str,
    doc: dict[str, Any],
    *,
    workspace: Path | None = None,
    asset_root_id: str | None = None,
    entity_id: str | None = None,
) -> None:
    """Validate meaning-bearing structures before a host pack becomes durable."""
    body_source_page_indices = doc.get("body_source_page_indices")
    if body_source_page_indices is not None:
        if str(doc.get("parse_state") or "") not in {"named_only", "toc_only"}:
            raise ModuleAssetsError(
                "body_source_page_indices is valid only on a named_only/toc_only "
                "locator stub"
            )
        if (
            not isinstance(body_source_page_indices, list)
            or not body_source_page_indices
            or any(
                isinstance(index, bool) or not isinstance(index, int) or index < 0
                for index in body_source_page_indices
            )
            or body_source_page_indices != sorted(set(body_source_page_indices))
        ):
            raise ModuleAssetsError(
                "body_source_page_indices must contain unique ascending "
                "non-negative integers"
            )
        entity_source_indices = set(_source_indices(
            doc,
            field=kind,
            allow_string_refs=(kind == "handout"),
        ))
        if not set(body_source_page_indices).issubset(entity_source_indices):
            raise ModuleAssetsError(
                "body_source_page_indices must be contained in the entity source scope"
            )
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
            if kind not in MECHANICS_SUBJECT_KINDS:
                raise ModuleAssetsError(
                    "not_authored mechanics only valid for "
                    f"{sorted(MECHANICS_SUBJECT_KINDS)}, not {kind!r}"
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
    if kind == "location":
        _validate_location_read_aloud(doc)
        _validate_location_keeper_only(doc)
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
    seen_semantic_identities: set[str] = set()
    alias_identities: dict[str, str] = {}
    for index, edge in enumerate(edges):
        if not isinstance(edge, dict) or not str(edge.get("to") or "").strip():
            raise ModuleAssetsError(
                f"location scene_edges[{index}] must be an object with to"
            )
        prefix = f"location.scene_edges[{index}]"
        _require_id(edge["to"], f"{prefix}.to")
        travel_minutes = edge.get("travel_minutes")
        if travel_minutes is not None and (
            isinstance(travel_minutes, bool)
            or not isinstance(travel_minutes, int)
            or travel_minutes <= 0
        ):
            raise ModuleAssetsError(
                f"{prefix}.travel_minutes must be a positive integer"
            )
        if travel_minutes is not None and edge.get("kind") != "travel":
            raise ModuleAssetsError(
                f"{prefix}.travel_minutes is valid only for kind='travel'"
            )
        aliases: list[str] = []
        for field in ("id", "edge_id"):
            if edge.get(field) is None:
                continue
            aliases.append(_require_id(edge[field], f"{prefix}.{field}"))
        semantic_identity = _canonical_scene_edge_identity(edge)
        if semantic_identity in seen_semantic_identities:
            raise ModuleAssetsError(
                f"{prefix} duplicates an existing scene edge exactly"
            )
        seen_semantic_identities.add(semantic_identity)
        for alias in aliases:
            previous_identity = alias_identities.get(alias)
            if (
                previous_identity is not None
                and previous_identity != semantic_identity
            ):
                raise ModuleAssetsError(
                    f"{prefix} conflicts with an existing scene edge alias "
                    f"{alias!r}"
                )
            alias_identities[alias] = semantic_identity
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


def _canonical_scene_edge_identity(edge: dict[str, Any]) -> str:
    """Return the exact semantic identity of one scene edge.

    Source authority and cache evidence are deliberately excluded: those
    fields prove a semantic edge but must never change which edge they prove.
    Every other field, including destination, condition, and explicit aliases,
    participates in the structured identity.
    """
    semantic = {
        key: json.loads(json.dumps(value))
        for key, value in edge.items()
        if key not in _SCENE_EDGE_SOURCE_AUTHORITY_FIELDS
    }
    return json.dumps(
        semantic,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def _scene_edge_is_campaign_local(edge: dict[str, Any]) -> bool:
    provenance = (
        edge.get("provenance")
        if isinstance(edge.get("provenance"), dict)
        else {}
    )
    authority = str(provenance.get("authority") or "")
    origin = str(edge.get("origin") or "")
    return (
        authority in {"campaign_improvised", "campaign_generated"}
        or origin in {"campaign_improvised", "campaign_generated"}
        or origin.startswith("campaign_")
    )


def _load_sibling(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPT_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_fileio = _load_sibling("coc_fileio_module_assets", "coc_fileio.py")
coc_pdf_bundle = _load_sibling("coc_pdf_bundle_module_assets", "coc_pdf_bundle.py")
coc_source_media = _load_sibling(
    "coc_source_media_module_assets", "coc_source_media.py",
)
coc_state = _load_sibling("coc_state_module_assets", "coc_state.py")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _coc_root(workspace: Path) -> Path:
    return coc_state.coc_root(Path(workspace).resolve())


def assets_root(workspace: Path) -> Path:
    return _coc_root(workspace) / "module-assets"


def registry_path(workspace: Path) -> Path:
    return assets_root(workspace) / REGISTRY_NAME


def full_parse_state_path(workspace: Path, asset_root_id: str) -> Path:
    """Durable full_parse progress document for one module asset root."""
    return _module_dir(workspace, asset_root_id) / "full-parse.json"


def section_index_path(workspace: Path, asset_root_id: str) -> Path:
    """Durable whole-book section index for one module asset root."""
    return _module_dir(workspace, asset_root_id) / SECTION_INDEX_NAME


def read_section_index(
    workspace: Path, asset_root_id: str,
) -> dict[str, Any] | None:
    path = section_index_path(workspace, asset_root_id)
    if not path.is_file():
        return None
    try:
        loaded = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return loaded if isinstance(loaded, dict) else None


def write_section_index(
    workspace: Path, asset_root_id: str, index: dict[str, Any],
) -> dict[str, Any]:
    """Persist a validated section index, refusing a foreign source binding.

    The index is only meaningful for the exact bytes it was derived from; a
    module whose PDF was replaced must be re-indexed rather than inherit page
    numbers that no longer point at the same content.
    """
    if not isinstance(index, dict):
        raise ModuleAssetsError("section index must be an object")
    expected = _module_identity_file_sha256(workspace, asset_root_id)
    declared = _require_sha256(index.get("file_sha256"), "index.file_sha256")
    if declared != expected:
        raise ModuleAssetsError(
            "section index file_sha256 does not match this module asset root"
        )
    path = section_index_path(workspace, asset_root_id)
    payload = dict(index)
    payload["updated_at"] = _now_iso()
    _write_json(path, payload)
    return payload


def section_body_path(
    workspace: Path, asset_root_id: str, section_id: str,
) -> Path:
    """Where the repository (never a worker) writes a section's prose body."""
    safe = _require_id(section_id, "section_id")
    return _module_dir(workspace, asset_root_id) / SECTIONS_DIR / f"{safe}.md"


def read_full_parse_state(
    workspace: Path, asset_root_id: str,
) -> dict[str, Any]:
    path = full_parse_state_path(workspace, asset_root_id)
    if not path.is_file():
        return {}
    try:
        loaded = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return loaded if isinstance(loaded, dict) else {}


def full_parse_page_count(
    workspace: Path, asset_root_id: str,
) -> int | None:
    """Return the bound PDF's total page count from the canonical identity."""
    identity_path = _module_dir(workspace, asset_root_id) / "identity.json"
    if not identity_path.is_file():
        return None
    try:
        identity = json.loads(identity_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    source = identity.get("source") if isinstance(identity, dict) else None
    if not isinstance(source, dict):
        return None
    page_count = source.get("page_count")
    if isinstance(page_count, bool) or not isinstance(page_count, int):
        return None
    return page_count


def full_parse_requested_indices(
    workspace: Path, asset_root_id: str,
) -> list[int]:
    """The whole-PDF page list full_parse must eventually cache.

    Module ``pdf_index`` is 0-based.  The base belongs to the source-bundle
    contract, not to this lane: ``coc_pdf_bundle`` enforces
    ``0 <= pdf_index < page_count`` and every module ingested through the host
    PDF skill is stored that way.  The corpus ordinal ``doc_N`` uses the same
    base, so ``pdf_index = doc_N`` and the requested set is
    ``0..page_count - 1``.

    This lane used to offset by one, on the stated belief that the PDF skill
    numbered pages from 1.  It does not.  Both lanes write ``pages/NNNN.md``
    into one module root, so the offset cached the same physical page twice:
    an observed 23-page scenario held 24 pages, with page 3 stored at both
    index 2 (bundle) and index 3 (OCR) and everything above shifted by one.
    Content addressing hid most of it -- first-writer-wins silently dropped
    the OCR pages that collided -- which is why it survived so long.
    """
    page_count = full_parse_page_count(workspace, asset_root_id)
    if not page_count or page_count < 1:
        return []
    return list(range(0, page_count))


def ocr_corpus_root(workspace: Path) -> Path:
    """Durable sha-keyed whole-book baiduocr corpus cache for this workspace.

    The corpus is the OCR extraction cache (``doc_N.md`` pages plus a small
    manifest): it is reused verbatim for every module root bound to the same
    PDF (same ``file_sha256``) and is never re-requested from the OCR API
    while it is complete.  Deleting it invalidates OCR reuse and forces a
    fresh paid extraction, so it follows the same persistence discipline as
    module-assets parse caches.
    """
    return _coc_root(workspace) / "ocr-corpus"


def ocr_corpus_dir(workspace: Path, file_sha256: str) -> Path:
    """The exact corpus directory for one source PDF sha."""
    return ocr_corpus_root(workspace) / _require_sha256(
        file_sha256, "file_sha256",
    )


def read_ocr_corpus_manifest(
    workspace: Path, file_sha256: str,
) -> dict[str, Any]:
    """Read the corpus completion manifest; missing/blank means unknown."""
    path = ocr_corpus_dir(workspace, file_sha256) / "manifest.json"
    if not path.is_file():
        return {}
    try:
        loaded = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return loaded if isinstance(loaded, dict) else {}


def write_ocr_corpus_manifest(
    workspace: Path,
    file_sha256: str,
    *,
    source_path: str,
    page_count: int | None,
    doc_page_count: int,
    status: str,
) -> dict[str, Any]:
    """Persist one corpus completion manifest (complete or incomplete)."""
    sha = _require_sha256(file_sha256, "file_sha256")
    corpus = ocr_corpus_dir(workspace, sha)
    corpus.mkdir(parents=True, exist_ok=True)
    manifest = {
        "schema_version": 1,
        "producer": "baiduocr",
        "source_file_sha256": sha,
        "source_path": str(source_path or ""),
        "page_count": int(page_count) if page_count else None,
        "doc_page_count": int(doc_page_count),
        "status": str(status),
        "updated_at": _now_iso(),
    }
    (corpus / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return manifest


def register_ocr_corpus(
    workspace: Path,
    asset_root_id: str,
    *,
    corpus_dir: Path | str,
) -> dict[str, Any]:
    """Register whole-book baiduocr corpus pages into the module page cache.

    Mapping and provenance (product design, S1 full-parse lane):

    - OCR ordinals and module ``pdf_index`` share one 0-based scale, so
      ``pdf_index = doc_N`` and scope is ``0..page_count - 1``.  The base is
      the source-bundle contract's; this lane must never offset against it or
      the same physical page lands under two numbers.
    - ``put_page`` content addressing is authoritative: an identical cached
      page is reused silently, a drifted page keeps the existing first writer
      (reviewed first-pack pages win over OCR pages) and records a
      ``first_writer_wins`` provenance entry in the full_parse progress
      document.
    - Every registered page carries provenance
      ``{source: "baiduocr", unreviewed: true, doc_ref}`` in its page meta.
      ``review_state`` is the mechanical usability tier: a page that passed
      the whole OCR pipeline, content addressing, and registration is
      ``auto_accepted`` and may back the opening window; ``unreviewed: true``
      keeps the honest claim that no human/LLM ever read the text.
    - OCR pages outside the module's bound page range are skipped and
      reported, never rejected as cache drift.

    After this call all later consumers read only module-assets markdown;
    the PDF is never reopened for full-parse consumption.
    """
    mod = _module_dir(workspace, asset_root_id)
    identity_path = mod / "identity.json"
    if not identity_path.is_file():
        raise ModuleAssetsError("init_module_root before register_ocr_corpus")
    identity = json.loads(identity_path.read_text(encoding="utf-8"))
    source = identity.get("source") if isinstance(identity, dict) else None
    if not isinstance(source, dict):
        raise ModuleAssetsError("module identity source is unavailable")
    file_sha256 = _require_sha256(
        identity.get("file_sha256") or source.get("file_sha256"),
        "identity.file_sha256",
    )
    page_count = full_parse_page_count(workspace, asset_root_id)
    if not page_count:
        raise ModuleAssetsError(
            "module identity page_count is required for OCR corpus registration"
        )
    requested = set(full_parse_requested_indices(workspace, asset_root_id))
    corpus = Path(corpus_dir).resolve()
    if not corpus.is_dir():
        raise ModuleAssetsError(f"ocr corpus directory is missing: {corpus}")
    doc_files = sorted(
        (
            path for path in corpus.glob("doc_*.md")
            if path.stem[len("doc_") :].isdigit()
        ),
        key=lambda path: int(path.stem[len("doc_") :]),
    )
    registered: list[int] = []
    reused_count = 0
    drift: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    source_id = str(source.get("source_id") or "")
    for doc_path in doc_files:
        doc_num = int(doc_path.stem[len("doc_") :])
        pdf_index = doc_num  # corpus ordinal and page cache share one base
        doc_ref = doc_path.name
        if pdf_index not in requested:
            skipped.append({
                "doc_ref": doc_ref,
                "doc_ordinal": doc_num,
                "pdf_index": pdf_index,
                "reason": "outside_requested_scope",
            })
            continue
        text = doc_path.read_text(encoding="utf-8")
        if not text.strip():
            skipped.append({
                "doc_ref": doc_ref,
                "doc_ordinal": doc_num,
                "pdf_index": pdf_index,
                "reason": "empty_text",
            })
            continue
        meta = {
            "source_id": source_id,
            "file_sha256": file_sha256,
            "producer": "baiduocr",
            # Mechanical usability tier: this page passed the OCR pipeline,
            # content addressing, and registration, so it may back the
            # opening window.  The ``source``/``unreviewed``/``doc_ref``
            # fields below keep the honest claim that no human/LLM read it.
            "review_state": "auto_accepted",
            "parse_confidence": None,
            "source": "baiduocr",
            "unreviewed": True,
            "doc_ref": doc_ref,
        }
        try:
            page_result = put_page(
                workspace, asset_root_id, pdf_index, text, meta=meta,
            )
        except ModuleAssetsError as exc:
            if "content drift" not in str(exc):
                raise
            existing_ref = cached_page_ref(
                workspace, asset_root_id, pdf_index,
            )
            if existing_ref is None:
                raise
            drift.append({
                "pdf_index": pdf_index,
                "doc_ref": doc_ref,
                "source": "baiduocr",
                "unreviewed": True,
                "incoming_text_sha256": hashlib.sha256(
                    _normalized_page_text(text).encode("utf-8")
                ).hexdigest(),
                "existing_text_sha256": str(
                    existing_ref.get("text_sha256") or ""
                ),
                "disposition": "first_writer_wins",
                "at": _now_iso(),
            })
            continue
        if page_result.get("reused"):
            reused_count += 1
        registered.append(pdf_index)
    if drift:
        update_full_parse_state(
            workspace,
            asset_root_id,
            status="in_progress",
            provenance=drift,
        )
    return {
        "source": "baiduocr",
        "asset_root_id": asset_root_id,
        "file_sha256": file_sha256,
        "registered_pdf_indices": sorted(set(registered)),
        "registered_page_count": len(set(registered)),
        "reused_page_count": reused_count,
        "drifted_page_count": len(drift),
        "drift": drift,
        "skipped": skipped,
        "corpus_dir": str(corpus),
    }


def write_full_parse_state(
    workspace: Path,
    asset_root_id: str,
    state: dict[str, Any],
) -> dict[str, Any]:
    path = full_parse_state_path(workspace, asset_root_id)
    _write_json(path, state)
    return state


def update_full_parse_state(
    workspace: Path,
    asset_root_id: str,
    *,
    status: str | None = None,
    parsed_indices: list[int] | None = None,
    job_id: str | None = None,
    failure_class: str | None = None,
    provenance: list[dict[str, Any]] | None = None,
    next_operation: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Refresh the full_parse progress document from authoritative facts.

    ``next_operation`` is the explicit retry instruction a consumer can run
    after a terminal OCR failure; it is cleared on a fresh attempt or on
    completion so the lane never strands without a visible next step.
    """
    current = read_full_parse_state(workspace, asset_root_id)
    requested = full_parse_requested_indices(workspace, asset_root_id)
    # The whole-book lane's coverage truth is review-agnostic: OCR pages are
    # cached with unreviewed baiduocr provenance and count as parsed, while
    # strict accepted evidence stays a separate boundary.
    cached = set(cached_pdf_indices(workspace, asset_root_id))
    parsed = sorted(cached & set(requested))
    if parsed_indices is not None:
        parsed = sorted(set(parsed) | set(parsed_indices))
    page_count = full_parse_page_count(workspace, asset_root_id)
    complete = bool(page_count) and len(parsed) >= page_count
    merged_provenance = list(current.get("provenance") or [])
    if provenance:
        merged_provenance.extend(provenance)
    merged: dict[str, Any] = {
        "schema_version": 1,
        "asset_root_id": asset_root_id,
        "source_file_sha256": current.get("source_file_sha256")
        or _module_identity_file_sha256(workspace, asset_root_id),
        "page_count": page_count,
        "job_id": job_id or current.get("job_id"),
        "status": status or current.get("status") or "queued",
        "parsed_pdf_indices": parsed,
        "complete": complete or current.get("complete") is True,
        "started_at": current.get("started_at"),
        "completed_at": current.get("completed_at"),
        "failure_class": failure_class
        if failure_class is not None
        else current.get("failure_class"),
        "next_operation": next_operation
        if next_operation is not None
        else current.get("next_operation"),
        "provenance": merged_provenance[-64:],
        "updated_at": _now_iso(),
    }
    if not merged["started_at"] and status in {"in_progress", "complete"}:
        merged["started_at"] = merged["updated_at"]
    if merged["complete"]:
        merged["status"] = "complete"
        merged["failure_class"] = None
        merged["next_operation"] = None
        if not merged["completed_at"]:
            merged["completed_at"] = _now_iso()
    if status in {"queued", "complete"}:
        # A fresh retry attempt or a completed parse clears any stale retry
        # instruction; terminal failures keep it visible for the next action.
        merged["next_operation"] = None
    return write_full_parse_state(workspace, asset_root_id, merged)


def close_full_parse_request(
    workspace: Path,
    asset_root_id: str,
    *,
    job_id: str,
    result: str,
    failure_class: str | None = None,
    next_operation: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Terminally close one full_parse host-work request and its queue row.

    ``result`` is ``complete`` (all pages cached; request fulfilled) or
    ``failed`` (renderer exhausted its bounded retries; request cancelled).
    The module full_parse progress document is refreshed from authoritative
    cache facts in the same transition.
    """
    module_root = _module_dir(workspace, asset_root_id)
    request_path = module_root / "host-work" / f"{job_id}.json"
    now = _now_iso()
    with coc_fileio.advisory_file_lock(module_root / "host-work.lock"):
        if request_path.is_file():
            try:
                request = json.loads(request_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                request = {}
            if isinstance(request, dict) and str(
                request.get("status") or "open",
            ) not in HOST_WORK_CLOSED_STATUSES:
                request["result"] = result
                request["closed_at"] = now
                if result == "complete":
                    request["status"] = "fulfilled"
                    request["fulfilled_at"] = now
                else:
                    request["status"] = "cancelled"
                    request["cancelled_at"] = now
                    request["failure_class"] = failure_class
                request.pop("dispatch_state", None)
                for key in (
                    "lease_id", "leased_at", "lease_expires_at", "executor_id",
                ):
                    request.pop(key, None)
                _write_json(request_path, request)
    _close_full_parse_queue_row(module_root, job_id, result=result)
    if result == "complete":
        # Whole-book OCR finishing means every page was rendered; it does not
        # mean any page was understood.  Chain the structure pass here so a
        # module is indexed before play needs it, rather than only when a
        # location edge happens to point somewhere.
        inherited_consumers = None
        if request_path.is_file():
            try:
                closed = json.loads(request_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                closed = {}
            if isinstance(closed, dict) and isinstance(
                closed.get("consumer_refs"), list,
            ):
                inherited_consumers = closed["consumer_refs"]
        _enqueue_section_pass_if_needed(
            workspace, asset_root_id, consumer_refs=inherited_consumers,
        )
        return update_full_parse_state(
            workspace, asset_root_id, status="complete", job_id=job_id,
        )
    return update_full_parse_state(
        workspace, asset_root_id, status="failed", job_id=job_id,
        failure_class=failure_class or "full_parse_failed",
        next_operation=next_operation,
    )


def _enqueue_section_pass_if_needed(
    workspace: Path,
    asset_root_id: str,
    *,
    consumer_refs: list[dict[str, Any]] | None = None,
) -> dict[str, Any] | None:
    """Queue the one structure pass for this source, once.

    The consumers are inherited from the full_parse request that triggered
    this, not re-derived: an unowned request is classified ``legacy_unowned``
    and is never claimable, so a pass queued without them would sit open
    forever while looking perfectly healthy in the queue.

    Best effort by design: a module that cannot be indexed right now must
    still finish its OCR normally.  A missing index degrades later requests,
    it does not invalidate the pages already cached.
    """
    existing = read_section_index(workspace, asset_root_id)
    if isinstance(existing, dict) and existing.get("sections"):
        return None
    try:
        return enqueue_job(
            workspace,
            asset_root_id,
            kind=CLASSIFY_SECTIONS_KIND,
            target_id=SECTION_INDEX_TARGET_ID,
            priority=60,
            reason="full_parse_complete",
            consumer_refs=consumer_refs or None,
        )
    except ModuleAssetsError:
        return None


def _close_full_parse_queue_row(
    module_root: Path,
    job_id: str,
    *,
    result: str,
) -> None:
    """Update one full_parse done-row result without re-locking host-work."""
    queue_path = module_root / "parse-queue.json"
    if not queue_path.is_file():
        return
    with coc_fileio.advisory_file_lock(module_root / "parse-queue.lock"):
        try:
            queue = json.loads(queue_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return
        done = list(queue.get("done") or [])
        changed = False
        now = _now_iso()
        for row in done:
            if str(row.get("job_id") or "") == job_id:
                row["result"] = result
                row["completed_at"] = now
                changed = True
        if changed:
            queue["done"] = done
            _write_json(queue_path, queue)


def record_full_parse_render_result(
    workspace: Path,
    asset_root_id: str,
    *,
    job_id: str,
    status: str,
    rendered_pdf_indices: list[int],
    failed_pdf_indices: list[int],
    failure_class: str | None = None,
    next_operation: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Record one render-batch outcome and transition the full_parse lane.

    - ``partial``: progress is recorded; the open host-work request stays
      claimable for the next batch (an expired lease is released in place).
    - ``complete``: the request is fulfilled and the queue row closed.
    - ``failed``: render failures are bounded; after the configured maximum
      the request is cancelled and the progress document marks failure.
    """
    module_root = _module_dir(workspace, asset_root_id)
    request_path = module_root / "host-work" / f"{job_id}.json"
    requested = full_parse_requested_indices(workspace, asset_root_id)
    requested_set = set(requested)
    if any(
        isinstance(value, bool) or not isinstance(value, int) or value not in requested_set
        for value in rendered_pdf_indices
    ):
        raise ModuleAssetsError(
            "full_parse rendered_pdf_indices must stay inside the request scope"
        )
    if any(
        isinstance(value, bool) or not isinstance(value, int) or value not in requested_set
        for value in failed_pdf_indices
    ):
        raise ModuleAssetsError(
            "full_parse failed_pdf_indices must stay inside the request scope"
        )
    state = update_full_parse_state(
        workspace,
        asset_root_id,
        status="in_progress" if status != "failed" else None,
        job_id=job_id,
        parsed_indices=rendered_pdf_indices,
        failure_class=(
            failure_class if status == "failed" else None
        ),
        next_operation=(
            next_operation if status == "failed" else None
        ),
    )
    if status == "complete":
        return close_full_parse_request(
            workspace, asset_root_id, job_id=job_id, result="complete",
        )
    if status == "failed":
        # Failure-path closure happens inside the host-work lock below so the
        # bounded retry transition is one atomic row write.
        pass
    with coc_fileio.advisory_file_lock(module_root / "host-work.lock"):
        if not request_path.is_file():
            return state
        try:
            request = json.loads(request_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return state
        if not isinstance(request, dict) or str(
            request.get("status") or "open",
        ) in HOST_WORK_CLOSED_STATUSES:
            return state
        if status == "failed":
            request["render_failure_count"] = int(
                request.get("render_failure_count") or 0
            ) + 1
            request["last_render_failure_class"] = failure_class
            request["last_render_failure_at"] = _now_iso()
            if (
                request["render_failure_count"]
                >= FULL_PARSE_MAX_RENDER_FAILURES
            ):
                request["result"] = "failed"
                request["closed_at"] = _now_iso()
                request["status"] = "cancelled"
                request["cancelled_at"] = request["closed_at"]
                request["failure_class"] = (
                    failure_class or "render_failed"
                )
                request.pop("dispatch_state", None)
                for key in (
                    "lease_id", "leased_at", "lease_expires_at", "executor_id",
                ):
                    request.pop(key, None)
                _write_json(request_path, request)
                _close_full_parse_queue_row(
                    module_root, job_id, result="failed",
                )
                return update_full_parse_state(
                    workspace,
                    asset_root_id,
                    status="failed",
                    job_id=job_id,
                    failure_class=failure_class or "render_failed",
                    next_operation=next_operation,
                )
        # partial or retryable failure: keep the request open and claimable.
        for key in (
            "lease_id", "leased_at", "lease_expires_at", "executor_id",
        ):
            request.pop(key, None)
        _sync_host_work_dispatch_state(request)
        _write_json(request_path, request)
    return update_full_parse_state(
        workspace, asset_root_id, job_id=job_id,
        status=(
            None if status == "failed" else "in_progress"
        ),
        failure_class=failure_class if status == "failed" else None,
        next_operation=next_operation if status == "failed" else None,
    )


def _module_identity_file_sha256(workspace: Path, asset_root_id: str) -> str:
    identity_path = _module_dir(workspace, asset_root_id) / "identity.json"
    try:
        identity = json.loads(identity_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return ""
    return str((identity or {}).get("file_sha256") or "")



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
    recovered_from_asset_root_id: str | None = None,
    recovery_family_root_id: str | None = None,
    publish_registry: bool = True,
) -> Path:
    """Create empty durable root and register it. Idempotent if same sha."""
    digest = _require_sha256(file_sha256, "file_sha256")
    root_id = _require_id(asset_root_id, "asset_root_id")
    if recovered_from_asset_root_id is not None:
        recovered_from_asset_root_id = _require_id(
            recovered_from_asset_root_id, "recovered_from_asset_root_id",
        )
    if recovery_family_root_id is not None:
        recovery_family_root_id = _require_id(
            recovery_family_root_id, "recovery_family_root_id",
        )
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
                        f"source identity {key} differs from the existing asset "
                        f"root {root_id!r}: existing={previous_source.get(key)!r}, "
                        f"new={source_identity.get(key)!r}. Reuse the existing "
                        f"{key} value in the bundle manifest, or delete "
                        f".coc/module-assets/{root_id}/ to re-register from scratch."
                    )
        if isinstance(prev.get("source_bundles"), list):
            identity_doc["source_bundles"] = json.loads(
                json.dumps(prev["source_bundles"])
            )
        if recovered_from_asset_root_id is None:
            previous_recovery = str(
                prev.get("recovered_from_asset_root_id") or ""
            ).strip()
            if previous_recovery:
                recovered_from_asset_root_id = previous_recovery
        previous_family = str(prev.get("recovery_family_root_id") or "").strip()
        if recovery_family_root_id is None and previous_family:
            recovery_family_root_id = previous_family
        elif (
            recovery_family_root_id is not None
            and previous_family
            and previous_family != recovery_family_root_id
        ):
            raise ModuleAssetsError(
                "recovery_family_root_id differs from the existing asset root"
            )
    if recovery_family_root_id is None:
        recovery_family_root_id = root_id
    if root_id == recovery_family_root_id and recovered_from_asset_root_id is not None:
        raise ModuleAssetsError("recovery family root cannot have recovered_from provenance")
    if recovered_from_asset_root_id is not None:
        identity_doc["recovered_from_asset_root_id"] = recovered_from_asset_root_id
    identity_doc["recovery_family_root_id"] = recovery_family_root_id
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

    if publish_registry:
        with coc_fileio.advisory_file_lock(
            assets_root(workspace) / "registry.lock"
        ):
            _publish_module_root_registry(
                workspace,
                root_id=root_id,
                digest=digest,
                identity=identity,
                recovered_from_asset_root_id=recovered_from_asset_root_id,
                recovery_family_root_id=recovery_family_root_id,
            )
    return mod


def _publish_module_root_registry(
    workspace: Path,
    *,
    root_id: str,
    digest: str,
    identity: dict[str, Any] | None,
    recovered_from_asset_root_id: str | None,
    recovery_family_root_id: str,
) -> None:
    """Move the content pointer only after a complete root is durable."""
    registry = load_registry(workspace)
    modules = registry.setdefault("modules", {})
    by_sha = registry.setdefault("by_file_sha256", {})
    owner = by_sha.get(digest)
    if owner and owner != root_id:
        owner_identity_path = _module_dir(workspace, str(owner)) / "identity.json"
        owner_family = ""
        if owner_identity_path.is_file():
            try:
                owner_identity = json.loads(
                    owner_identity_path.read_text(encoding="utf-8")
                )
                owner_family = str(
                    owner_identity.get("recovery_family_root_id")
                    or owner_identity.get("asset_root_id")
                    or ""
                ).strip()
            except (OSError, ValueError, json.JSONDecodeError):
                owner_family = ""
        same_family = bool(
            owner_family and owner_family == recovery_family_root_id
        )
        if recovered_from_asset_root_id != owner and not same_family:
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


def lookup_by_sha256(workspace: Path, file_sha256: str) -> dict[str, Any] | None:
    digest = _require_sha256(file_sha256, "file_sha256")
    registry = load_registry(workspace)
    root_id = (registry.get("by_file_sha256") or {}).get(digest)
    if not root_id:
        return None
    return (registry.get("modules") or {}).get(root_id)


def validate_opening_clock(value: Any) -> dict[str, Any]:
    """Validate the closed, no-default source-authored opening clock.

    Every precision-bearing field is explicit so downstream campaign clock
    projection cannot fill an omitted source fact from an era preset.
    """
    if not isinstance(value, dict):
        raise ModuleAssetsError("start_clock must be an object")
    fields = set(value)
    allowed = OPENING_CLOCK_REQUIRED_FIELDS | OPENING_CLOCK_OPTIONAL_FIELDS
    if fields - allowed or not OPENING_CLOCK_REQUIRED_FIELDS <= fields:
        raise ModuleAssetsError(
            "start_clock must contain exactly the required canonical precision "
            "fields plus optional location_id/day_phase_boundaries"
        )
    mode = value.get("calendar_mode")
    if mode not in OPENING_CLOCK_CALENDAR_MODES:
        raise ModuleAssetsError("start_clock.calendar_mode is invalid")
    precision = value.get("time_precision")
    if precision not in OPENING_CLOCK_PRECISIONS:
        raise ModuleAssetsError("start_clock.time_precision is invalid")
    display = value.get("display")
    if not isinstance(display, str) or not display.strip():
        raise ModuleAssetsError("start_clock.display must be non-empty")

    local_datetime = value.get("local_datetime")
    local_date = value.get("local_date")
    timezone_value = value.get("timezone")
    day_phase = value.get("day_phase_hint")
    if local_datetime is not None and not isinstance(local_datetime, str):
        raise ModuleAssetsError("start_clock.local_datetime must be string or null")
    if local_date is not None and not isinstance(local_date, str):
        raise ModuleAssetsError("start_clock.local_date must be string or null")
    if timezone_value is not None and (
        not isinstance(timezone_value, str) or not timezone_value.strip()
    ):
        raise ModuleAssetsError("start_clock.timezone must be non-empty string or null")
    if day_phase is not None and day_phase not in OPENING_CLOCK_DAY_PHASES:
        raise ModuleAssetsError("start_clock.day_phase_hint is invalid")

    normalized_datetime: str | None = None
    normalized_date: str | None = None
    if isinstance(local_datetime, str):
        try:
            parsed_datetime = datetime.fromisoformat(local_datetime)
        except ValueError as exc:
            raise ModuleAssetsError(
                "start_clock.local_datetime must be ISO local datetime"
            ) from exc
        if parsed_datetime.tzinfo is not None:
            raise ModuleAssetsError(
                "start_clock.local_datetime must not embed a timezone offset"
            )
        normalized_datetime = parsed_datetime.isoformat()
    if isinstance(local_date, str):
        try:
            normalized_date = datetime.strptime(local_date, "%Y-%m-%d").date().isoformat()
        except ValueError as exc:
            raise ModuleAssetsError(
                "start_clock.local_date must be ISO date"
            ) from exc

    if mode == "relative":
        if (
            normalized_datetime is not None
            or normalized_date is not None
            or timezone_value is not None
        ):
            raise ModuleAssetsError(
                "relative start_clock requires explicit null local_datetime, "
                "local_date, and timezone"
            )
        if precision not in {"day_phase", "unknown"}:
            raise ModuleAssetsError(
                "relative start_clock precision must be day_phase or unknown"
            )

    if precision in {"exact", "minute", "hour"}:
        if normalized_datetime is None:
            raise ModuleAssetsError(
                f"start_clock.time_precision={precision} requires local_datetime"
            )
        datetime_date = normalized_datetime.split("T", 1)[0]
        if normalized_date != datetime_date:
            raise ModuleAssetsError(
                "start_clock.local_date must match local_datetime precision"
            )
    elif precision == "date":
        if normalized_datetime is not None or normalized_date is None:
            raise ModuleAssetsError(
                "date precision requires null local_datetime and an ISO local_date"
            )
    elif precision == "day_phase":
        if normalized_datetime is not None or day_phase is None:
            raise ModuleAssetsError(
                "day_phase precision requires null local_datetime and a known "
                "day_phase_hint"
            )
        if mode != "relative" and normalized_date is None:
            raise ModuleAssetsError(
                "calendar day_phase precision requires an ISO local_date"
            )
    elif precision == "unknown":
        if normalized_datetime is not None or normalized_date is not None or day_phase is not None:
            raise ModuleAssetsError(
                "unknown precision requires null datetime/date/day_phase"
            )

    if precision != "day_phase" and day_phase is not None:
        raise ModuleAssetsError(
            "start_clock.day_phase_hint is only valid for day_phase precision"
        )
    boundaries = value.get("day_phase_boundaries")
    if boundaries is not None:
        if not isinstance(boundaries, dict) or set(boundaries) != {
            "morning_start", "afternoon_start", "evening_start", "night_start",
        }:
            raise ModuleAssetsError(
                "start_clock.day_phase_boundaries must contain exactly four starts"
            )
        for boundary in boundaries.values():
            if not isinstance(boundary, str) or re.fullmatch(
                r"(?:[01]\d|2[0-3]):[0-5]\d", boundary,
            ) is None:
                raise ModuleAssetsError(
                    "start_clock.day_phase_boundaries values must be HH:MM"
                )
    location_id = value.get("location_id")
    if location_id is not None:
        _require_id(location_id, "start_clock.location_id")

    normalized = json.loads(json.dumps(value))
    normalized["display"] = display.strip()
    normalized["local_datetime"] = normalized_datetime
    normalized["local_date"] = normalized_date
    if isinstance(timezone_value, str):
        normalized["timezone"] = timezone_value.strip()
    return normalized


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
        if subject_kind not in MECHANICS_SUBJECT_KINDS:
            errors.append(
                f"{prefix}.subject_kind must be one of "
                f"{sorted(MECHANICS_SUBJECT_KINDS)}"
            )
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
            doc["start_clock"] = validate_opening_clock(doc["start_clock"])
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


def _put_revisioned_page_unlocked(
    mod: Path,
    pdf_index: int,
    stem: str,
    normalized: str,
    digest: str,
    supplied_meta: dict[str, Any],
) -> dict[str, Any]:
    """Publish one immutable page revision while its stable-id lock is held."""
    revision_ref = supplied_meta.get("ocr_revision")
    if not isinstance(revision_ref, dict):
        raise ModuleAssetsError("ocr_revision must be an object")
    layer = str(revision_ref.get("layer") or "")
    revision = revision_ref.get("revision")
    if (
        layer not in coc_pdf_bundle.OCR_REVISION_LAYERS
        or revision_ref.get("stable_id") != f"page:{pdf_index}:{layer}"
        or revision_ref.get("pdf_index") != pdf_index
        or isinstance(revision, bool)
        or not isinstance(revision, int)
        or revision <= 0
    ):
        raise ModuleAssetsError("ocr_revision identity is invalid")
    content_sha256 = _require_sha256(
        revision_ref.get("content_sha256"), "ocr_revision.content_sha256",
    )
    structured_text = supplied_meta.pop("_structured_text", None)
    structured_sha256 = str(
        supplied_meta.get("structured_data_sha256") or ""
    ).strip().lower()
    if structured_text is not None:
        if not isinstance(structured_text, str):
            raise ModuleAssetsError("structured page content must be text")
        actual_structured = hashlib.sha256(
            structured_text.encode("utf-8")
        ).hexdigest()
        if actual_structured != structured_sha256:
            raise ModuleAssetsError(
                f"structured page {pdf_index} content hash drift"
            )
    revision_dir = (
        mod / "pages" / stem / layer / "revisions" / f"{revision:06d}"
    )
    md_path = revision_dir / "page.md"
    structured_path = revision_dir / "structured.json"
    revision_meta_path = revision_dir / "meta.json"
    head_path = mod / "pages" / stem / layer / "head.json"
    current_head = (
        json.loads(head_path.read_text(encoding="utf-8"))
        if head_path.is_file() else None
    )
    active_revision = int(
        (current_head or {}).get("ocr_revision", {}).get("revision") or 0
    )
    if revision_meta_path.is_file():
        existing_revision_meta = json.loads(
            revision_meta_path.read_text(encoding="utf-8")
        )
        if not md_path.is_file():
            raise ModuleAssetsError(
                f"cached page {pdf_index} immutable revision is incomplete"
            )
        existing_digest = hashlib.sha256(md_path.read_bytes()).hexdigest()
        existing_structured = (
            hashlib.sha256(structured_path.read_bytes()).hexdigest()
            if structured_path.is_file() else ""
        )
        immutable_meta_keys = (
            "source_id", "file_sha256", "producer_text_sha256",
            "review_state", "parse_confidence", "grep_anchors",
            "printed_page", "printed_label", "structured_data_sha256",
            "structured_data_format", "structured_data_producer",
            "structured_data_model",
        )
        if (
            existing_digest != digest
            or existing_structured != structured_sha256
            or existing_revision_meta.get("ocr_revision") != revision_ref
            or str(existing_revision_meta.get("text_sha256") or "") != digest
            or str(existing_revision_meta.get("structured_data_sha256") or "")
            != structured_sha256
            or any(
                existing_revision_meta.get(key) != supplied_meta.get(key)
                for key in immutable_meta_keys
            )
        ):
            raise ModuleAssetsError(
                f"cached page {pdf_index} immutable revision hash drift"
            )
        reused = True
    else:
        coc_fileio.write_text_atomic(md_path, normalized)
        if structured_text is not None:
            coc_fileio.write_text_atomic(structured_path, structured_text)
        revision_meta_doc = {
            **supplied_meta,
            "schema_version": SCHEMA_VERSION,
            "pdf_index": pdf_index,
            "ocr_revision": json.loads(json.dumps(revision_ref)),
            "text_sha256": digest,
            "structured_data_sha256": structured_sha256 or None,
            "path": str(md_path),
            "structured_data_path": (
                str(structured_path) if structured_text is not None else None
            ),
            "published_at": _now_iso(),
        }
        _write_json(revision_meta_path, revision_meta_doc)
        reused = False

    if revision > active_revision:
        _write_json(head_path, {
            "schema_version": SCHEMA_VERSION,
            "pdf_index": pdf_index,
            "layer": layer,
            "active_revision": revision,
            "latest_revision": revision,
            "ocr_revision": json.loads(json.dumps(revision_ref)),
            "text_sha256": digest,
            "structured_data_sha256": structured_sha256 or None,
            "revision_meta_path": str(revision_meta_path),
            "updated_at": _now_iso(),
        })
    elif revision == active_revision and (
        not isinstance(current_head, dict)
        or current_head.get("ocr_revision") != revision_ref
        or current_head.get("text_sha256") != digest
        or str(current_head.get("structured_data_sha256") or "")
        != structured_sha256
    ):
        raise ModuleAssetsError(
            f"cached page {pdf_index} {layer} active head hash drift"
        )
    # An already-known lower revision is immutable history, not an attempted
    # active downgrade.  It may be verified or backfilled without moving head.
    return {
        "pdf_index": pdf_index,
        "text_sha256": digest,
        "path": str(md_path),
        "reused": reused,
        "ocr_revision": json.loads(json.dumps(revision_ref)),
        "content_sha256": content_sha256,
        "structured_data_sha256": structured_sha256 or None,
    }


def _normalized_page_text(text: str) -> str:
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    if not normalized.endswith("\n"):
        normalized += "\n"
    return normalized


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
    normalized = _normalized_page_text(text)
    digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
    supplied_meta = dict(meta or {})
    revision_ref = supplied_meta.get("ocr_revision")
    if revision_ref is not None:
        if not isinstance(revision_ref, dict):
            raise ModuleAssetsError("ocr_revision must be an object")
        layer = str(revision_ref.get("layer") or "")
        if layer not in coc_pdf_bundle.OCR_REVISION_LAYERS:
            raise ModuleAssetsError("ocr_revision identity is invalid")
        lock_path = mod / "pages" / stem / layer / "publication.lock"
        with coc_fileio.advisory_file_lock(lock_path):
            return _put_revisioned_page_unlocked(
                mod, pdf_index, stem, normalized, digest, supplied_meta,
            )

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
                "identity instead of overwriting page evidence. The existing "
                "page was registered by a different producer/extraction. To "
                "re-extract, remove this pdf_index from the new bundle, or use "
                "a fresh asset root id (a different scenario_id) for this "
                "extraction run."
            )
        reused = True
        if meta_path.is_file():
            loaded_meta = json.loads(meta_path.read_text(encoding="utf-8"))
            if isinstance(loaded_meta, dict):
                existing_meta = loaded_meta
    else:
        coc_fileio.write_text_atomic(md_path, normalized)

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
    for layer in ("detail", "fast"):
        head_path = mod / "pages" / stem / layer / "head.json"
        if not head_path.is_file():
            continue
        head = json.loads(head_path.read_text(encoding="utf-8"))
        revision_ref = head.get("ocr_revision")
        if (
            not isinstance(revision_ref, dict)
            or revision_ref.get("stable_id") != f"page:{pdf_index}:{layer}"
            or revision_ref.get("pdf_index") != pdf_index
            or revision_ref.get("layer") != layer
        ):
            raise ModuleAssetsError(
                f"cached page {pdf_index} {layer} head identity mismatch"
            )
        meta_path = Path(str(head.get("revision_meta_path") or "")).resolve()
        expected_parent = (mod / "pages" / stem / layer / "revisions").resolve()
        try:
            meta_path.relative_to(expected_parent)
        except ValueError as exc:
            raise ModuleAssetsError(
                f"cached page {pdf_index} {layer} revision path escapes cache"
            ) from exc
        if not meta_path.is_file():
            raise ModuleAssetsError(
                f"cached page {pdf_index} {layer} revision metadata is missing"
            )
        revision_meta = json.loads(meta_path.read_text(encoding="utf-8"))
        if revision_meta.get("ocr_revision") != revision_ref:
            raise ModuleAssetsError(
                f"cached page {pdf_index} {layer} revision identity drift"
            )
        md_path = Path(str(revision_meta.get("path") or "")).resolve()
        if not md_path.is_file():
            raise ModuleAssetsError(
                f"cached page {pdf_index} {layer} revision text is missing"
            )
        text = md_path.read_text(encoding="utf-8")
        digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
        if digest != revision_meta.get("text_sha256") or digest != head.get("text_sha256"):
            raise ModuleAssetsError(
                f"cached page {pdf_index} {layer} immutable revision hash drift"
            )
        structured_path_text = str(revision_meta.get("structured_data_path") or "")
        if structured_path_text:
            structured_path = Path(structured_path_text).resolve()
            try:
                structured_path.relative_to(meta_path.parent.resolve())
            except ValueError as exc:
                raise ModuleAssetsError(
                    f"cached page {pdf_index} {layer} structured path escapes revision"
                ) from exc
            if (
                not structured_path.is_file()
            ):
                raise ModuleAssetsError(
                    f"cached page {pdf_index} {layer} structured artifact hash drift"
                )
            structured_digest = hashlib.sha256(structured_path.read_bytes()).hexdigest()
            if (
                structured_digest != revision_meta.get("structured_data_sha256")
                or structured_digest != head.get("structured_data_sha256")
            ):
                raise ModuleAssetsError(
                    f"cached page {pdf_index} {layer} structured artifact hash drift"
                )
        return {"pdf_index": pdf_index, "text": text, "meta": revision_meta}
    md_path = mod / "pages" / f"{stem}.md"
    if not md_path.is_file():
        return None
    meta_path = mod / "pages" / f"{stem}.meta.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.is_file() else {}
    return {"pdf_index": pdf_index, "text": md_path.read_text(encoding="utf-8"), "meta": meta}


def cached_page_ref(
    workspace: Path, asset_root_id: str, pdf_index: int,
) -> dict[str, Any] | None:
    """Project one active cached page into an exact host-readable artifact ref."""
    page = get_page(workspace, asset_root_id, pdf_index)
    if page is None:
        return None
    meta = page.get("meta") if isinstance(page.get("meta"), dict) else {}
    revision_ref = meta.get("ocr_revision")
    revision_ref = revision_ref if isinstance(revision_ref, dict) else None
    if revision_ref is not None:
        artifact_path = Path(str(meta.get("path") or "")).resolve()
    else:
        artifact_path = (
            _module_dir(workspace, asset_root_id)
            / "pages"
            / f"{pdf_index:04d}.md"
        ).resolve()
    if not artifact_path.is_file():
        raise ModuleAssetsError(
            f"cached page {pdf_index} active Markdown artifact is missing"
        )
    ref: dict[str, Any] = {
        "source_id": meta.get("source_id"),
        "pdf_index": pdf_index,
        "path": str(artifact_path),
        "text_sha256": meta.get("text_sha256"),
        "bundle_sha256s": list(meta.get("bundle_sha256s") or []),
        "review_state": meta.get("review_state"),
        "parse_confidence": meta.get("parse_confidence"),
        "grep_anchors": list(meta.get("grep_anchors") or []),
    }
    if revision_ref is not None:
        ref["ocr_revision"] = json.loads(json.dumps(revision_ref))
        ref["content_sha256"] = revision_ref.get("content_sha256")
    return ref


def _cached_page_producer(
    workspace: Path, asset_root_id: str, pdf_index: int,
) -> str | None:
    """Explicit producer label of one cached page, or None for pages the
    bundle lane registered (same extraction pipeline as incoming bundles)."""
    page = get_page(workspace, asset_root_id, pdf_index)
    if page is None:
        return None
    meta = page.get("meta") if isinstance(page.get("meta"), dict) else {}
    return str(meta.get("producer") or "").strip() or None


def _first_cached_page_drift(
    workspace: Path,
    root_id: str,
    pages: list[Any],
    *,
    incoming_producer: str | None = None,
) -> int | None:
    """Read-only scan: first bundle pdf_index drifting from the cached root.

    Bind runs this before any write into an existing root so a different
    extraction of the same PDF can be redirected to a fresh asset root
    without mutating the prior extraction's evidence.  Pages the ingest loop
    would reject (bad index, empty text) are skipped here and still fail
    later at put_page; revision-layer pages use a different integrity class
    and are not scanned.

    ``incoming_producer`` is the review-rebind lane.  A drifted page whose
    cached evidence declares a different explicit producer (for example the
    whole-book baiduocr lane) is a cross-producer re-extraction that the
    ingest loop references by content address instead of treating as a
    conflict; pages from the same pipeline stay conflicts.
    """
    pages_dir = _module_dir(workspace, root_id) / "pages"
    if not pages_dir.is_dir():
        return None
    for page in pages:
        if not isinstance(page, dict):
            continue
        pdf_index = page.get("pdf_index")
        if (
            isinstance(pdf_index, bool)
            or not isinstance(pdf_index, int)
            or pdf_index < 0
        ):
            continue
        if isinstance(page.get("ocr_revision"), dict):
            continue
        text = page.get("text")
        if isinstance(text, str) and text.strip():
            md_path = pages_dir / f"{pdf_index:04d}.md"
            if md_path.is_file():
                cached_digest = hashlib.sha256(
                    md_path.read_text(encoding="utf-8").encode("utf-8")
                ).hexdigest()
                digest = hashlib.sha256(
                    _normalized_page_text(text).encode("utf-8")
                ).hexdigest()
                if cached_digest != digest:
                    if (
                        incoming_producer is not None
                        and _is_cross_producer_cached_page(
                            workspace, root_id, pdf_index, incoming_producer,
                        )
                    ):
                        continue
                    return pdf_index
        structured = page.get("structured_data")
        if isinstance(structured, dict):
            structured_sha256 = str(structured.get("sha256") or "")
            structured_path = pages_dir / f"{pdf_index:04d}.structured.json"
            if (
                structured_sha256
                and structured_path.is_file()
                and hashlib.sha256(structured_path.read_bytes()).hexdigest()
                != structured_sha256
            ):
                if (
                    incoming_producer is not None
                    and _is_cross_producer_cached_page(
                        workspace, root_id, pdf_index, incoming_producer,
                    )
                ):
                    continue
                return pdf_index
    return None


def _is_cross_producer_cached_page(
    workspace: Path,
    asset_root_id: str,
    pdf_index: int,
    incoming_producer: str,
) -> bool:
    """True when an already-cached page was registered by a different,
    explicitly declared extraction pipeline than the incoming bundle.
    Pages without an explicit producer label came from the bundle lane (the
    same pipeline as incoming bundles) and stay hard conflicts."""
    if not incoming_producer:
        return False
    cached = get_page(workspace, asset_root_id, pdf_index)
    if cached is None:
        return False
    meta = cached.get("meta") if isinstance(cached.get("meta"), dict) else {}
    if isinstance(meta.get("ocr_revision"), dict):
        return False
    cached_producer = str(meta.get("producer") or "").strip() or None
    return bool(cached_producer) and cached_producer != incoming_producer


def _reference_cached_page(
    workspace: Path,
    asset_root_id: str,
    pdf_index: int,
    *,
    incoming_text_sha256: str,
    incoming_producer: str,
    cached_producer: str,
    bundle_sha256: str,
) -> dict[str, Any]:
    """Review-rebind lane: bind an already-cached page produced by a
    different extraction pipeline into the incoming bundle by content
    address.  The cached text/evidence stay authoritative and untouched;
    only the page meta's bundle coverage is extended, and the reference is
    recorded as durable provenance (disposition ``review_references_cache``).
    Same-pipeline conflicts never reach here."""
    mod = _module_dir(workspace, asset_root_id)
    stem = f"{pdf_index:04d}"
    md_path = mod / "pages" / f"{stem}.md"
    meta_path = mod / "pages" / f"{stem}.meta.json"
    if not md_path.is_file():
        raise ModuleAssetsError(
            f"cached page {pdf_index} reference artifact is missing"
        )
    meta = (
        json.loads(meta_path.read_text(encoding="utf-8"))
        if meta_path.is_file() else {}
    )
    cached_text_sha256 = str(meta.get("text_sha256") or "")
    if not re.fullmatch(r"[0-9a-f]{64}", cached_text_sha256):
        raise ModuleAssetsError(
            f"cached page {pdf_index} reference identity is invalid"
        )
    bundle_hashes = {
        str(value)
        for value in (meta.get("bundle_sha256s") or [])
        if isinstance(value, str) and value
    }
    for value in (meta.get("bundle_sha256"), bundle_sha256):
        if isinstance(value, str) and value:
            bundle_hashes.add(value)
    updated = dict(meta)
    updated["bundle_sha256s"] = sorted(bundle_hashes)
    updated["updated_at"] = _now_iso()
    _write_json(meta_path, updated)
    update_full_parse_state(
        workspace,
        asset_root_id,
        status="in_progress",
        provenance=[{
            "pdf_index": pdf_index,
            "source": "opening_review_transport",
            "incoming_producer": incoming_producer,
            "existing_producer": cached_producer,
            "incoming_text_sha256": incoming_text_sha256,
            "existing_text_sha256": cached_text_sha256,
            "disposition": "review_references_cache",
            "at": _now_iso(),
        }],
    )
    return {
        "pdf_index": pdf_index,
        "text_sha256": cached_text_sha256,
        "path": str(md_path),
        "reused": True,
        "referenced_cached": True,
    }


def _reference_cached_page_if_cross_producer(
    workspace: Path,
    asset_root_id: str,
    pdf_index: int,
    page: dict[str, Any],
    *,
    incoming_producer: str | None,
    bundle_sha256: str,
) -> dict[str, Any] | None:
    """Review-rebind lane per-page hook: when the incoming page drifted from
    an already-cached page that a different extraction pipeline produced,
    reference the cache identity by content address instead of comparing
    text.  Returns the referenced page-result row, or None when normal
    registration continues (uncached, identical, or same-pipeline pages)."""
    if not incoming_producer or not _is_cross_producer_cached_page(
        workspace, asset_root_id, pdf_index, incoming_producer,
    ):
        return None
    cached = get_page(workspace, asset_root_id, pdf_index)
    if cached is None:
        return None
    meta = cached.get("meta") if isinstance(cached.get("meta"), dict) else {}
    cached_text = cached.get("text")
    incoming_text = page.get("text")
    if (
        not isinstance(cached_text, str)
        or not cached_text.strip()
        or not isinstance(incoming_text, str)
        or not incoming_text.strip()
    ):
        return None
    cached_digest = str(meta.get("text_sha256") or "")
    incoming_digest = hashlib.sha256(
        _normalized_page_text(incoming_text).encode("utf-8")
    ).hexdigest()
    if (
        not re.fullmatch(r"[0-9a-f]{64}", cached_digest)
        or cached_digest == incoming_digest
    ):
        return None
    return _reference_cached_page(
        workspace,
        asset_root_id,
        pdf_index,
        incoming_text_sha256=incoming_digest,
        incoming_producer=incoming_producer,
        cached_producer=str(meta.get("producer") or "").strip(),
        bundle_sha256=bundle_sha256,
    )


def _recovery_family_root_id(workspace: Path, asset_root_id: str) -> str:
    """Resolve one immutable recovery family, rejecting malformed ancestry."""
    current = _require_id(asset_root_id, "asset_root_id")
    visited: set[str] = set()
    while True:
        if current in visited:
            raise ModuleAssetsError("asset-root recovery lineage contains a cycle")
        visited.add(current)
        path = _module_dir(workspace, current) / "identity.json"
        if not path.is_file():
            return current
        try:
            document = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError, json.JSONDecodeError) as exc:
            raise ModuleAssetsError(
                f"asset-root recovery identity {current!r} is unreadable"
            ) from exc
        declared = str(document.get("recovery_family_root_id") or "").strip()
        if declared:
            family = _require_id(declared, "recovery_family_root_id")
            if family == current:
                return family
            current = family
            continue
        parent = str(document.get("recovered_from_asset_root_id") or "").strip()
        if not parent:
            return current
        current = _require_id(parent, "recovered_from_asset_root_id")


def _bundle_pages_compatible_with_root(
    workspace: Path,
    asset_root_id: str,
    pages: list[Any],
) -> bool:
    """True only when at least one immutable page overlaps and none drift."""
    pages_dir = _module_dir(workspace, asset_root_id) / "pages"
    if not pages_dir.is_dir():
        return False
    overlap = False
    for page in pages:
        if not isinstance(page, dict) or isinstance(page.get("ocr_revision"), dict):
            continue
        pdf_index = page.get("pdf_index")
        if isinstance(pdf_index, bool) or not isinstance(pdf_index, int) or pdf_index < 0:
            continue
        text = page.get("text")
        markdown_path = pages_dir / f"{pdf_index:04d}.md"
        if isinstance(text, str) and text.strip() and markdown_path.is_file():
            overlap = True
            cached = hashlib.sha256(markdown_path.read_bytes()).hexdigest()
            incoming = hashlib.sha256(
                _normalized_page_text(text).encode("utf-8")
            ).hexdigest()
            if cached != incoming:
                return False
        structured = page.get("structured_data")
        structured_path = pages_dir / f"{pdf_index:04d}.structured.json"
        if isinstance(structured, dict) and structured_path.is_file():
            overlap = True
            if (
                hashlib.sha256(structured_path.read_bytes()).hexdigest()
                != str(structured.get("sha256") or "")
            ):
                return False
    return overlap


def _allocate_drift_recovery_root_id(
    workspace: Path,
    *,
    family_root_id: str,
    file_sha256: str,
    pages: list[Any],
) -> tuple[str, bool]:
    """Pick canonical family suffix; reuse only a content-compatible member."""
    family = _require_id(family_root_id, "recovery_family_root_id")
    family_path = _module_dir(workspace, family) / "identity.json"
    if family_path.is_file() and _bundle_pages_compatible_with_root(
        workspace, family, pages,
    ):
        return family, True
    suffix = 2
    while True:
        candidate = _require_id(f"{family}-r{suffix}", "asset_root_id")
        identity_path = _module_dir(workspace, candidate) / "identity.json"
        if not identity_path.is_file():
            return candidate, False
        try:
            document = json.loads(identity_path.read_text(encoding="utf-8"))
        except (OSError, ValueError, json.JSONDecodeError):
            document = None
        if (
            isinstance(document, dict)
            and str(document.get("file_sha256") or "") == file_sha256
            and str(
                document.get("recovery_family_root_id")
                or document.get("asset_root_id")
                or ""
            ) == family
            and _bundle_pages_compatible_with_root(
                workspace, candidate, pages,
            )
        ):
            return candidate, True
        suffix += 1


def _campaigns_referencing_asset_root(
    workspace: Path,
    asset_root_id: str,
) -> list[str]:
    """Campaign ids whose scenario pointers still name this asset root."""
    campaigns_dir = _coc_root(workspace) / "campaigns"
    if not campaigns_dir.is_dir():
        return []
    referencing: list[str] = []
    for scenario_path in sorted(campaigns_dir.glob("*/scenario/scenario.json")):
        try:
            scenario = json.loads(scenario_path.read_text(encoding="utf-8"))
        except (OSError, ValueError, json.JSONDecodeError):
            continue
        if not isinstance(scenario, dict):
            continue
        pointers = {
            str(scenario.get("source_cache_asset_root_id") or "").strip(),
            str(scenario.get("progressive_asset_root_id") or "").strip(),
        }
        if asset_root_id in pointers:
            referencing.append(scenario_path.parent.parent.name)
    return referencing


def _canonicalize_source_bundle(bundle: Any) -> dict[str, Any]:
    """Fully validate one already-loaded host bundle before cache writes."""
    if (
        not isinstance(bundle, dict)
        or bundle.get("schema_version") != coc_pdf_bundle.SCHEMA_VERSION
        or bundle.get("producer") != coc_pdf_bundle.PRODUCER
        or not isinstance(bundle.get("source"), dict)
        or not isinstance(bundle.get("pages"), list)
        or not bundle.get("pages")
    ):
        raise ModuleAssetsError("source bundle is not a validated host bundle")
    result = json.loads(json.dumps(bundle))
    source = result["source"]
    file_sha256 = _require_sha256(
        source.get("file_sha256"), "source.file_sha256",
    )
    normalized_source = _normalized_source_identity(
        source, file_sha256=file_sha256,
    )
    assert normalized_source is not None
    page_count = int(normalized_source["page_count"])
    seen: set[int] = set()
    canonical_pages: list[dict[str, Any]] = []
    for position, page in enumerate(result["pages"]):
        if not isinstance(page, dict):
            raise ModuleAssetsError(
                f"source bundle page {position} must be an object"
            )
        pdf_index = page.get("pdf_index")
        if (
            isinstance(pdf_index, bool)
            or not isinstance(pdf_index, int)
            or pdf_index < 0
        ):
            raise ModuleAssetsError(
                "source bundle page pdf_index must be a non-negative integer"
            )
        if not 0 <= pdf_index < page_count:
            raise ModuleAssetsError(
                "source bundle page pdf_index is outside source.page_count"
            )
        if pdf_index in seen:
            raise ModuleAssetsError(
                f"source bundle repeats pdf_index {pdf_index}"
            )
        seen.add(pdf_index)
        text = page.get("text")
        if not isinstance(text, str) or not text.strip():
            raise ModuleAssetsError("page text must be non-empty")
        normalized_text = _normalized_page_text(text)
        text_sha256 = hashlib.sha256(
            normalized_text.encode("utf-8")
        ).hexdigest()
        declared_text_sha256 = page.get("text_sha256")
        if (
            declared_text_sha256 is not None
            and _require_sha256(
                declared_text_sha256,
                f"pages[{position}].text_sha256",
            ) != text_sha256
        ):
            raise ModuleAssetsError(
                f"source bundle page {pdf_index} normalized text hash drift"
            )
        producer_text_sha256 = _require_sha256(
            page.get("producer_text_sha256"),
            f"pages[{position}].producer_text_sha256",
        )
        review_state = page.get("review_state")
        if review_state not in coc_pdf_bundle.ACCEPTED_REVIEW_STATES:
            raise ModuleAssetsError(
                f"source bundle page {pdf_index} review_state is invalid"
            )
        confidence = page.get("parse_confidence")
        if (
            isinstance(confidence, bool)
            or not isinstance(confidence, (int, float))
            or not 0 <= confidence <= 1
        ):
            raise ModuleAssetsError(
                f"source bundle page {pdf_index} parse_confidence is invalid"
            )
        anchors = page.get("grep_anchors")
        if not isinstance(anchors, list) or any(
            not isinstance(anchor, str) or not anchor.strip()
            for anchor in anchors
        ):
            raise ModuleAssetsError(
                f"source bundle page {pdf_index} grep_anchors are invalid"
            )
        structured = page.get("structured_data")
        if structured is not None:
            if not isinstance(structured, dict):
                raise ModuleAssetsError(
                    f"structured page {pdf_index} must be an object"
                )
            structured_text = structured.get("text")
            structured_sha256 = _require_sha256(
                structured.get("sha256"),
                f"pages[{position}].structured_data.sha256",
            )
            if not isinstance(structured_text, str) or (
                hashlib.sha256(structured_text.encode("utf-8")).hexdigest()
                != structured_sha256
            ):
                raise ModuleAssetsError(
                    f"structured page {pdf_index} content hash drift"
                )
        canonical = json.loads(json.dumps(page))
        canonical["text"] = normalized_text
        canonical["text_sha256"] = text_sha256
        canonical["producer_text_sha256"] = producer_text_sha256
        canonical["grep_anchors"] = sorted(set(anchors))
        canonical_pages.append(canonical)
    result["pages"] = sorted(canonical_pages, key=lambda row: row["pdf_index"])
    assets = result.get("assets") or []
    if not isinstance(assets, list):
        raise ModuleAssetsError("source bundle assets must be a list")
    expected_bundle_sha256 = coc_pdf_bundle._canonical_digest(
        source, result["pages"], assets,
    )
    declared_bundle_sha256 = _require_sha256(
        result.get("bundle_sha256") or source.get("bundle_sha256"),
        "bundle_sha256",
    )
    if expected_bundle_sha256 != declared_bundle_sha256:
        raise ModuleAssetsError("source bundle canonical digest drift")
    result["bundle_sha256"] = expected_bundle_sha256
    result["source"]["bundle_sha256"] = expected_bundle_sha256
    return result


def _prepare_source_bundle_assets(
    bundle: dict[str, Any],
    target_module_root: Path,
) -> list[dict[str, Any]]:
    try:
        return coc_source_media.prepare_bundle_assets(bundle, target_module_root)
    except coc_source_media.SourceMediaError as exc:
        raise ModuleAssetsError(str(exc)) from exc


def _publish_source_bundle_assets(
    target_module_root: Path,
    prepared: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    try:
        return coc_source_media.publish_prepared_assets(
            target_module_root, prepared,
        )
    except coc_source_media.SourceMediaError as exc:
        raise ModuleAssetsError(str(exc)) from exc


def registered_source_asset_refs(
    workspace: Path,
    asset_root_id: str,
    *,
    requested_pdf_indices: list[int],
) -> list[dict[str, Any]]:
    try:
        return coc_source_media.registered_asset_refs(
            _module_dir(workspace, asset_root_id),
            requested_pdf_indices=requested_pdf_indices,
        )
    except coc_source_media.SourceMediaError as exc:
        raise ModuleAssetsError(str(exc)) from exc


def register_source_bundle(
    workspace: Path,
    source_bundle: Path | str | dict[str, Any],
    *,
    asset_root_id: str | None = None,
    module_identity: dict[str, Any] | None = None,
    record_drift: bool = False,
    reference_cached_pages: bool = False,
) -> dict[str, Any]:
    """Bridge one validated host PDF window into the progressive page cache.

    Repeated registration is content-addressed and idempotent.  A second
    campaign using the same PDF reuses the existing asset root, while another
    host bundle window for that PDF adds only its previously unseen pages.

    ``record_drift`` is the full_parse batch lane.  The whole-book background
    parse may legitimately re-render a page that a different extraction path
    (first-pack, opening review, locator) already cached.  Content addressing
    keeps the cache immutable and first-writer-wins: an identical page is
    skipped, a drifted page keeps the existing evidence and is recorded in
    the module's full_parse provenance instead of failing the batch.

    ``reference_cached_pages`` is the opening-review rebind lane.  The
    coordinator-owned review transport rebinds a reviewed window against an
    already-populated cache where the whole-book OCR lane may have
    registered the same pdf_index first (cross-producer).  A cross-producer
    cached page is then referenced by content address: the cached text and
    evidence stay authoritative, the page meta gains the incoming bundle's
    coverage, and the reference is recorded as durable provenance
    (``review_references_cache``) instead of failing as text drift.  Pages
    from the same extraction pipeline stay hard conflicts: a same-producer
    page with different content is still rejected exactly as before.
    """
    if record_drift and reference_cached_pages:
        raise ModuleAssetsError(
            "register_source_bundle drift lanes are exclusive"
        )
    started = time.perf_counter()
    if isinstance(source_bundle, dict):
        bundle = source_bundle
    else:
        bundle = coc_pdf_bundle.load_host_bundle(source_bundle)
    bundle = _canonicalize_source_bundle(bundle)
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
    # Stable PDF sha hit: keep the already-populated root. Cross-producer
    # re-extractions (locator/pdf-skill vs baiduocr) must reference cached
    # pages by content address instead of forking a fresh -rN family member
    # on non-deterministic OCR/locator text jitter. Same-pipeline drift still
    # hard-conflicts and may auto-recover. record_drift stays exclusive.
    if existing and not record_drift:
        reference_cached_pages = True
    incoming_producer = (
        str(bundle.get("producer") or "").strip() or None
        if reference_cached_pages else None
    )
    def _ingest(
        target_root_id: str,
        target_identity: dict[str, Any],
        *,
        reused_existing: bool,
        recovered_from: str | None,
        recovery_family_root_id: str | None = None,
    ) -> dict[str, Any]:
        # Lock order is intentionally non-nested: initialize/merge identity
        # under source-bundles.lock, release it, publish pages under their
        # stable-id locks, then reacquire source-bundles.lock to append the
        # bundle row.  This prevents lost rows without holding one advisory
        # lock inside another.
        target_module_root = _module_dir(workspace, target_root_id)
        prepared_assets = _prepare_source_bundle_assets(
            bundle, target_module_root,
        )
        bundle_identity_lock = (
            target_module_root / "source-bundles.lock"
        )
        with coc_fileio.advisory_file_lock(bundle_identity_lock):
            mod = init_module_root(
                workspace,
                asset_root_id=target_root_id,
                identity=target_identity,
                file_sha256=file_sha256,
                source=source,
                recovered_from_asset_root_id=recovered_from,
                recovery_family_root_id=recovery_family_root_id,
                publish_registry=False,
            )

        with coc_fileio.advisory_file_lock(mod / "source-assets.lock"):
            # Revalidate collisions under the publishing lock.  The first
            # pass above fails malformed bundles before module mutation; this
            # second pass closes the concurrent-registration TOCTOU window.
            prepared_assets = _prepare_source_bundle_assets(bundle, mod)
            registered_assets = _publish_source_bundle_assets(
                mod, prepared_assets,
            )

        page_results: list[dict[str, Any]] = []
        referenced_text_sha256s: dict[int, str] = {}
        for page in bundle["pages"]:
            if not isinstance(page, dict):
                raise ModuleAssetsError("source bundle page must be an object")
            pdf_index = page.get("pdf_index")
            if (
                isinstance(pdf_index, bool)
                or not isinstance(pdf_index, int)
                or pdf_index < 0
            ):
                raise ModuleAssetsError(
                    "source bundle page pdf_index must be a non-negative integer"
                )
            if reference_cached_pages:
                referenced = _reference_cached_page_if_cross_producer(
                    workspace,
                    target_root_id,
                    pdf_index,
                    page,
                    incoming_producer=incoming_producer,
                    bundle_sha256=bundle_sha256,
                )
                if referenced is not None:
                    referenced_text_sha256s[pdf_index] = referenced["text_sha256"]
                    page_results.append(referenced)
                    continue
            structured = (
                page.get("structured_data")
                if isinstance(page.get("structured_data"), dict)
                else None
            )
            structured_meta: dict[str, Any] = {}
            if structured is not None:
                structured_text = structured.get("text")
                structured_sha256 = str(structured.get("sha256") or "")
                if not isinstance(structured_text, str):
                    raise ModuleAssetsError(
                        f"structured page {pdf_index} is missing validated JSON text"
                    )
                actual_structured_sha256 = hashlib.sha256(
                    structured_text.encode("utf-8")
                ).hexdigest()
                if actual_structured_sha256 != structured_sha256:
                    raise ModuleAssetsError(
                        f"structured page {pdf_index} content hash drift"
                    )
                revisioned = isinstance(page.get("ocr_revision"), dict)
                structured_path = (
                    mod / "pages" / f"{int(pdf_index):04d}.structured.json"
                )
                if not revisioned:
                    if structured_path.is_file():
                        existing_sha256 = hashlib.sha256(
                            structured_path.read_bytes()
                        ).hexdigest()
                        if existing_sha256 != structured_sha256:
                            raise ModuleAssetsError(
                                f"cached structured page {pdf_index} content drift; "
                                "reuse the accepted page artifact instead of overwriting it"
                            )
                    else:
                        coc_fileio.write_text_atomic(
                            structured_path, structured_text,
                        )
                structured_meta = {
                    "structured_data_path": (
                        str(structured_path) if not revisioned else None
                    ),
                    "structured_data_sha256": structured_sha256,
                    "structured_data_format": structured.get("format"),
                    "structured_data_producer": structured.get("producer"),
                    "structured_data_model": structured.get("model"),
                    **({"_structured_text": structured_text} if revisioned else {}),
                }
            page_result = None
            page_drift: dict[str, Any] | None = None
            try:
                page_result = put_page(
                    workspace,
                    target_root_id,
                    pdf_index,
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
                        "ocr_revision": page.get("ocr_revision"),
                        **structured_meta,
                    },
                )
            except ModuleAssetsError as exc:
                if not record_drift:
                    raise
                drift_message = str(exc)
                if "content drift" not in drift_message:
                    raise
                existing_ref = cached_page_ref(
                    workspace, target_root_id, pdf_index,
                )
                if existing_ref is None:
                    raise
                page_drift = {
                    "pdf_index": pdf_index,
                    "incoming_text_sha256": hashlib.sha256(
                        _normalized_page_text(page.get("text")).encode("utf-8")
                    ).hexdigest(),
                    "existing_text_sha256": str(
                        existing_ref.get("text_sha256") or ""
                    ),
                    "source_bundle_path": source.get("source_bundle_path"),
                    "disposition": "first_writer_wins",
                    "at": _now_iso(),
                }
                update_full_parse_state(
                    workspace,
                    target_root_id,
                    status="in_progress",
                    provenance=[page_drift],
                )
            if page_result is not None:
                if structured_meta:
                    page_result["structured_data"] = {
                        key: value for key, value in structured_meta.items()
                        if not key.startswith("_")
                    }
                page_results.append(page_result)

        identity_path = mod / "identity.json"
        with coc_fileio.advisory_file_lock(bundle_identity_lock):
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
                    if isinstance(row, dict)
                    and row.get("bundle_sha256") == bundle_sha256
                ),
                None,
            )
            bundle_rows.append({
                "bundle_sha256": bundle_sha256,
                "source_bundle_path": source.get("source_bundle_path"),
                "pdf_indices": sorted(
                    int(page["pdf_index"]) for page in bundle["pages"]
                ),
                "page_revisions": [
                    {
                        "pdf_index": int(page["pdf_index"]),
                        "text_sha256": str(
                            referenced_text_sha256s.get(int(page["pdf_index"]))
                            or page.get("text_sha256") or ""
                        ),
                        **(
                            {
                                "ocr_revision": json.loads(
                                    json.dumps(page["ocr_revision"])
                                )
                            }
                            if isinstance(page.get("ocr_revision"), dict) else {}
                        ),
                        **(
                            {
                                "structured_data_sha256": page[
                                    "structured_data"
                                ]["sha256"]
                            }
                            if isinstance(page.get("structured_data"), dict) else {}
                        ),
                    }
                    for page in sorted(
                        bundle["pages"], key=lambda row: int(row["pdf_index"])
                    )
                ],
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
        identity_doc = json.loads(identity_path.read_text(encoding="utf-8"))
        canonical_family = str(
            identity_doc.get("recovery_family_root_id") or target_root_id
        )
        if record_drift:
            # Bundle row is now registered, so the authoritative accepted-page
            # projection includes every page of this batch.
            update_full_parse_state(
                workspace, target_root_id, status="in_progress",
            )
        # Registry publication is the final commit point. A partial staged
        # family member may remain as evidence, but it is never current.
        with coc_fileio.advisory_file_lock(
            assets_root(workspace) / "registry.lock"
        ):
            _publish_module_root_registry(
                workspace,
                root_id=target_root_id,
                digest=file_sha256,
                identity=target_identity,
                recovered_from_asset_root_id=recovered_from,
                recovery_family_root_id=canonical_family,
            )
        elapsed_ms = max(0, round((time.perf_counter() - started) * 1000))
        return {
            "asset_root_id": target_root_id,
            "requested_asset_root_id": requested_root_id,
            "reused_existing_root": reused_existing,
            "bundle_sha256": bundle_sha256,
            "cached_pdf_indices": [row["pdf_index"] for row in page_results],
            "page_revisions": [
                {
                    "pdf_index": row["pdf_index"],
                    **(
                        {"ocr_revision": json.loads(json.dumps(row["ocr_revision"]))}
                        if isinstance(row.get("ocr_revision"), dict) else {}
                    ),
                    "text_sha256": row["text_sha256"],
                    **(
                        {"structured_data_sha256": row["structured_data_sha256"]}
                        if row.get("structured_data_sha256") else {}
                    ),
                }
                for row in page_results
            ],
            "new_page_count": sum(not row["reused"] for row in page_results),
            "reused_page_count": sum(bool(row["reused"]) for row in page_results),
            "referenced_cached_page_count": sum(
                bool(row.get("referenced_cached")) for row in page_results
            ),
            "referenced_cached_pdf_indices": sorted(
                int(row["pdf_index"])
                for row in page_results
                if row.get("referenced_cached")
            ),
            "bundle_validation_and_cache_ms": elapsed_ms,
            "registered_assets": registered_assets,
        }

    drifted_pdf_index = _first_cached_page_drift(
        workspace, root_id, bundle["pages"],
        incoming_producer=incoming_producer,
    )
    if record_drift and drifted_pdf_index is not None:
        # Full-parse batch lane: first writer wins per page.  Do not escalate
        # the pre-pass drift into auto-recovery; put_page records provenance
        # for each drifted page inside _ingest and keeps the accepted evidence.
        return _ingest(
            root_id,
            identity,
            reused_existing=bool(existing),
            recovered_from=None,
            recovery_family_root_id=_recovery_family_root_id(
                workspace, root_id,
            ),
        )
    if drifted_pdf_index is None:
        try:
            return _ingest(
                root_id, identity,
                reused_existing=bool(existing), recovered_from=None,
                recovery_family_root_id=_recovery_family_root_id(
                    workspace, root_id,
                ),
            )
        except ModuleAssetsError as exc:
            drift_match = _CACHED_PAGE_DRIFT_RE.match(str(exc))
            if drift_match is None:
                raise
            # A concurrent publish landed between the read-only scan and the
            # write; fall through to the same one-shot recovery.
            drifted_pdf_index = int(drift_match.group(1))

    family_root_id = _recovery_family_root_id(workspace, root_id)
    # Serialize family-member allocation and publication. Different accepted
    # concurrent extractions receive different immutable suffixes; no loser
    # can move the registry pointer onto a partial member.
    with coc_fileio.advisory_file_lock(
        assets_root(workspace) / f"{family_root_id}.recovery.lock"
    ):
        current = lookup_by_sha256(workspace, file_sha256)
        current_root_id = str(
            (current or {}).get("asset_root_id") or root_id
        )
        current_drift = _first_cached_page_drift(
            workspace, current_root_id, bundle["pages"],
            incoming_producer=incoming_producer,
        )
        if current_drift is None:
            return _ingest(
                current_root_id,
                {} if current else identity,
                reused_existing=bool(current),
                recovered_from=None,
                recovery_family_root_id=family_root_id,
            )
        drifted_pdf_index = current_drift
        root_id = current_root_id
        # Content-drift auto-recovery stages into a fresh family member. The
        # superseded root stays byte-identical prior extraction evidence.
        referencing = _campaigns_referencing_asset_root(workspace, root_id)
        if referencing:
            raise ModuleAssetsError(
                f"cached page {drifted_pdf_index} content drift; bind a different "
                "PDF identity instead of overwriting page evidence. Auto-recovery "
                f"into a fresh asset root is refused because campaign(s) still "
                f"reference asset root {root_id!r}: {', '.join(referencing)}. "
                "Re-point or retire those campaigns first, or register this "
                "extraction under an explicit unused asset root id."
            )
        fresh_root_id, reused_family_member = _allocate_drift_recovery_root_id(
            workspace,
            family_root_id=family_root_id,
            file_sha256=file_sha256,
            pages=bundle["pages"],
        )
        recovery_identity = dict(module_identity or {})
        recovery_identity.setdefault("canonical_module_id", fresh_root_id)
        recovery_identity.setdefault(
            "canonical_title", source.get("title") or fresh_root_id,
        )
        result = _ingest(
            fresh_root_id, recovery_identity,
            reused_existing=reused_family_member,
            recovered_from=None if reused_family_member else root_id,
            recovery_family_root_id=family_root_id,
        )
        result["auto_recovered_from_drift"] = {
            "requested_asset_root_id": requested_root_id,
            "superseded_asset_root_id": root_id,
            "fresh_asset_root_id": fresh_root_id,
            "drifted_pdf_index": drifted_pdf_index,
        }
        result["warnings"] = [
            f"cached page {drifted_pdf_index} content drift in asset root "
            f"{root_id!r}; this extraction was registered into fresh asset root "
            f"{fresh_root_id!r} instead. The superseded root was left untouched "
            "as prior extraction evidence, and by_file_sha256 now resolves to "
            "the recovered root.",
        ]
        return result


_HANDOUT_CARD_REF = re.compile(r"pdf_index-(\d+)")


def handout_card_ref_index(ref: str) -> int | None:
    """One handout card string ref -> its bundle page index, else None."""
    if not isinstance(ref, str):
        return None
    match = _HANDOUT_CARD_REF.fullmatch(ref.strip())
    return int(match.group(1)) if match is not None else None


def _validate_handout_entity_pack(doc: dict[str, Any]) -> None:
    """Card-contract validation for handout entity packs.

    A handout pack IS a verbatim info card: ``kind`` is required, and a
    ``text`` body must carry string ``source_refs`` tracing the verbatim
    excerpt to bundle pages. The canonical field checks live with the card
    contract in ``coc_scenario.validate_handout_card``.
    """
    scenario_mod = _load_sibling(
        "coc_scenario_module_assets", "coc_scenario.py",
    )
    handout_id = str(doc.get("handout_id") or "").strip()
    errors = scenario_mod.validate_handout_card(
        doc, prefix=f"handout {handout_id or '<missing id>'}",
    )
    if errors:
        raise ModuleAssetsError("; ".join(errors))


def _source_indices(
    value: dict[str, Any], *, field: str, allow_string_refs: bool = False,
) -> list[int]:
    declared_scopes: list[tuple[str, set[int]]] = []
    refs = value.get("source_refs")
    if refs is not None:
        if not isinstance(refs, list):
            raise ModuleAssetsError(f"{field}.source_refs must be a list")
        ref_indices: list[int] = []
        for position, ref in enumerate(refs):
            if isinstance(ref, str):
                # Verbatim handout cards carry compact string refs; only the
                # handout evidence path opts in. Non-``pdf_index-<n>`` strings
                # are tolerated as provenance labels (the same language the
                # asset index accepts) but contribute no page index — a deep
                # source-bound pack with zero derivable indices still fails
                # closed in _canonicalize_entity_source_evidence.
                if not allow_string_refs:
                    raise ModuleAssetsError(
                        f"{field}.source_refs[{position}] must be an object"
                    )
                derived = handout_card_ref_index(ref)
                if derived is None:
                    continue
                ref_indices.append(derived)
                continue
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
    allow_string_refs: bool = False,
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
    registered_revision_bundles: dict[tuple[int, str, int, str, str, str], set[str]] = {}
    for bundle_row in bundle_rows:
        bundle_sha256 = str(bundle_row.get("bundle_sha256") or "").strip()
        if not bundle_sha256:
            continue
        page_revisions = bundle_row.get("page_revisions")
        if isinstance(page_revisions, list) and page_revisions:
            for page_revision in page_revisions:
                if not isinstance(page_revision, dict):
                    continue
                revision_ref = page_revision.get("ocr_revision")
                if not isinstance(revision_ref, dict):
                    continue
                key = (
                    int(page_revision.get("pdf_index")),
                    str(revision_ref.get("layer") or ""),
                    int(revision_ref.get("revision") or 0),
                    str(revision_ref.get("content_sha256") or ""),
                    str(page_revision.get("text_sha256") or ""),
                    str(page_revision.get("structured_data_sha256") or ""),
                )
                registered_revision_bundles.setdefault(key, set()).add(bundle_sha256)
        for raw_index in bundle_row.get("pdf_indices") or []:
            if isinstance(raw_index, bool) or not isinstance(raw_index, int):
                continue
            registered_page_bundles.setdefault(raw_index, set()).add(bundle_sha256)
    indices = _source_indices(
        value, field=field, allow_string_refs=allow_string_refs,
    )
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
        revision_ref = meta.get("ocr_revision")
        revision_ref = revision_ref if isinstance(revision_ref, dict) else None
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
        if revision_ref is not None:
            revision_key = (
                pdf_index,
                str(revision_ref.get("layer") or ""),
                int(revision_ref.get("revision") or 0),
                str(revision_ref.get("content_sha256") or ""),
                cached_digest,
                str(meta.get("structured_data_sha256") or ""),
            )
            registered = registered_revision_bundles.get(revision_key) or set()
        else:
            registered = registered_page_bundles.get(pdf_index) or set()
        cached_bundle_hashes = {
            str(value)
            for value in (meta.get("bundle_sha256s") or [])
            if isinstance(value, str) and value
        }
        if revision_ref is not None:
            canonical_bundle_hashes = sorted(registered)
        else:
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
        if revision_ref is not None and supplied.get("ocr_revision") not in (
            None, revision_ref,
        ):
            raise ModuleAssetsError(
                f"{field}.source_refs for pdf_index {pdf_index} do not match "
                "the active OCR revision"
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
        if revision_ref is not None:
            ref["ocr_revision"] = json.loads(json.dumps(revision_ref))
        structured_path_text = str(meta.get("structured_data_path") or "").strip()
        structured_sha256 = str(
            meta.get("structured_data_sha256") or ""
        ).strip().lower()
        if structured_path_text or structured_sha256:
            structured_path = Path(structured_path_text).resolve()
            expected_path = (
                Path(structured_path_text).resolve()
                if revision_ref is not None
                else (mod / "pages" / f"{pdf_index:04d}.structured.json").resolve()
            )
            if structured_path != expected_path or not structured_path.is_file():
                raise ModuleAssetsError(
                    f"{field} cached pdf_index {pdf_index} structured artifact is missing"
                )
            actual_structured_sha256 = hashlib.sha256(
                structured_path.read_bytes()
            ).hexdigest()
            if actual_structured_sha256 != structured_sha256:
                raise ModuleAssetsError(
                    f"{field} cached pdf_index {pdf_index} structured artifact hash drift"
                )
            ref["structured_data"] = {
                "path": str(structured_path),
                "sha256": structured_sha256,
                "format": meta.get("structured_data_format"),
                "producer": meta.get("structured_data_producer"),
                "model": meta.get("structured_data_model"),
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


def canonical_campaign_source_refs(
    workspace: Path,
    asset_root_id: str,
    bundle_sha256: str,
    refs: Any,
    *,
    field: str,
) -> list[dict[str, Any]]:
    """Canonicalize exact page selectors against one campaign-bound bundle.

    Unlike ``validate_opening_source_window``, this evidence helper deliberately
    has no contiguity or 1..3-page opening semantics. Fast setup facts may cite
    any non-contiguous accepted pages in the currently bound bundle.
    """
    bundle_digest = _require_sha256(bundle_sha256, "bundle_sha256")
    if not isinstance(refs, list) or not refs:
        raise ModuleAssetsError(f"{field} must be a non-empty source-ref list")
    selectors: list[dict[str, Any]] = []
    seen: set[tuple[str, int]] = set()
    for ref in refs:
        if not isinstance(ref, dict):
            raise ModuleAssetsError(f"{field} entries must be objects")
        source_id = str(ref.get("source_id") or "").strip()
        pdf_index = ref.get("pdf_index")
        if (
            not source_id
            or isinstance(pdf_index, bool)
            or not isinstance(pdf_index, int)
            or pdf_index < 0
        ):
            raise ModuleAssetsError(
                f"{field} entries require source_id and a zero-based pdf_index"
            )
        key = (source_id, pdf_index)
        if key in seen:
            raise ModuleAssetsError(f"{field} must not contain duplicate selectors")
        seen.add(key)
        selectors.append({"source_id": source_id, "pdf_index": pdf_index})

    canonical = _cached_source_refs(
        workspace,
        asset_root_id,
        {"source_refs": selectors},
        field=field,
    )
    identity = json.loads(
        (_module_dir(workspace, asset_root_id) / "identity.json").read_text(
            encoding="utf-8"
        )
    )
    file_sha256 = _require_sha256(
        identity.get("file_sha256"), "identity.file_sha256"
    )
    enriched: list[dict[str, Any]] = []
    for supplied, cached in zip(refs, canonical, strict=True):
        if bundle_digest not in set(cached.get("bundle_sha256s") or []):
            raise ModuleAssetsError(
                f"{field} pdf_index {cached.get('pdf_index')} is not covered by "
                "the campaign-bound source bundle"
            )
        current = {
            **cached,
            "file_sha256": file_sha256,
            "bundle_sha256": bundle_digest,
        }
        # Initial callers submit the two-field selector. Stored evidence is
        # canonical and must match every current identity field on revalidation.
        if set(supplied) != {"source_id", "pdf_index"} and supplied != current:
            raise ModuleAssetsError(
                f"{field} pdf_index {cached.get('pdf_index')} evidence is stale "
                "or does not match the current source cache"
            )
        enriched.append(current)
    return enriched


def accepted_cached_pdf_indices(
    workspace: Path,
    asset_root_id: str,
) -> list[int]:
    """Return only page indices whose complete cached evidence still validates.

    OCR-lane pages are included once their mechanical tier is
    ``auto_accepted``; the accepted-evidence boundary is the usable set for
    content-addressed referencing and the opening window, independent of the
    honest ``unreviewed`` provenance claim."""
    pages_dir = _module_dir(workspace, asset_root_id) / "pages"
    if not pages_dir.is_dir():
        return []
    accepted: list[int] = []
    candidate_indices = {
        int(path.stem) for path in pages_dir.glob("*.md") if path.stem.isdigit()
    }
    candidate_indices.update(
        int(path.name) for path in pages_dir.iterdir()
        if path.is_dir() and path.name.isdigit()
    )
    for pdf_index in sorted(candidate_indices):
        try:
            _cached_source_refs(
                workspace,
                asset_root_id,
                {"source_page_indices": [pdf_index]},
                field="accepted_cached_pdf_indices",
            )
        except ModuleAssetsError:
            continue
        accepted.append(pdf_index)
    return accepted


def cached_pdf_indices(
    workspace: Path,
    asset_root_id: str,
) -> list[int]:
    """Return every page index with valid cached markdown, review-agnostic.

    The whole-book OCR lane caches baiduocr pages whose ``review_state`` is
    the mechanical usability tier (``auto_accepted``) while their
    ``unreviewed`` provenance stays honest about never being read by a
    human/LLM; this review-agnostic projection is the full_parse lane's own
    progress/coverage truth and counts every registered page.
    """
    pages_dir = _module_dir(workspace, asset_root_id) / "pages"
    if not pages_dir.is_dir():
        return []
    candidate_indices = sorted(
        {
            int(path.stem)
            for path in pages_dir.glob("*.md")
            if path.stem.isdigit()
        }
    )
    cached: list[int] = []
    for pdf_index in candidate_indices:
        try:
            page = get_page(workspace, asset_root_id, pdf_index)
        except ModuleAssetsError:
            continue
        if page is not None:
            cached.append(pdf_index)
    return cached


def _page_mechanical_tier(meta: dict[str, Any]) -> bool:
    """True for pages the whole-book OCR lane registered.

    They carry ``auto_accepted`` as the mechanical usability tier (the page
    passed the OCR pipeline, content addressing, and registration) while the
    ``source: baiduocr`` / ``unreviewed: true`` provenance keeps the honest
    claim that no human/LLM read them.  Their parse_confidence is not
    declared and they declare no grep_anchors."""
    return (
        str(meta.get("source") or "").strip() == "baiduocr"
        or meta.get("unreviewed") is True
        or str(meta.get("producer") or "").strip() == "baiduocr"
    )


def opening_page_candidate_catalog(
    workspace: Path,
    asset_root_id: str,
    *,
    bundle_sha256: str,
) -> dict[str, Any]:
    """Return the bound bundle's complete page selection hints.

    ``progressive.prepare_opening`` reuses this one catalog for foreground
    opening and deferred mechanics-locator selection.  The live Keeper chooses
    each exact window semantically.  Rows are hints, never source provenance;
    each row carries accepted page metadata plus a bounded whitespace-collapsed
    ``text_preview`` of the cached page body (markup tags stripped, byte-bounded
    so CJK pages cannot crowd out the prepare_opening data budget), and all
    previews together stay under one total byte cap.
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

    per_candidate_text_limit = min(
        OPENING_PAGE_CANDIDATE_TEXT_PREVIEW_MAX_BYTES,
        max(
            0,
            OPENING_PAGE_CANDIDATE_TEXT_PREVIEW_TOTAL_MAX_BYTES // len(pdf_indices),
        ),
    )

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

    def text_preview(text: str) -> str:
        collapsed = " ".join(_HTML_TAG_RE.sub(" ", text).split())
        if per_candidate_text_limit <= 0:
            return ""
        encoded = collapsed.encode("utf-8")
        if len(encoded) <= per_candidate_text_limit:
            return collapsed
        prefix = encoded[: per_candidate_text_limit - 3]
        while prefix:
            try:
                return prefix.decode("utf-8").rstrip() + "..."
            except UnicodeDecodeError:
                prefix = prefix[:-1]
        return "..."

    anchors_declared = False
    candidates: list[dict[str, Any]] = []
    for pdf_index in pdf_indices:
        meta = None
        for layer in ("detail", "fast"):
            head_path = module_root / "pages" / f"{pdf_index:04d}" / layer / "head.json"
            if not head_path.is_file():
                continue
            head = json.loads(head_path.read_text(encoding="utf-8"))
            revision_meta_path = Path(str(head.get("revision_meta_path") or ""))
            if not revision_meta_path.is_file():
                raise ModuleAssetsError(
                    f"opening cached pdf_index {pdf_index} metadata is missing"
                )
            meta = json.loads(revision_meta_path.read_text(encoding="utf-8"))
            if meta.get("ocr_revision") != head.get("ocr_revision"):
                raise ModuleAssetsError(
                    f"opening cached pdf_index {pdf_index} metadata is invalid"
                )
            break
        if meta is None:
            meta_path = module_root / "pages" / f"{pdf_index:04d}.meta.json"
            if not meta_path.is_file():
                raise ModuleAssetsError(
                    f"opening cached pdf_index {pdf_index} metadata is missing"
                )
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
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
        mechanical_tier = _page_mechanical_tier(meta)
        parse_confidence = meta.get("parse_confidence")
        if (
            not mechanical_tier
            and (
                isinstance(parse_confidence, bool)
                or not isinstance(parse_confidence, (int, float))
                or not 0 <= parse_confidence <= 1
            )
        ):
            raise ModuleAssetsError(
                f"opening cached pdf_index {pdf_index} parse_confidence is invalid"
            )
        anchors = meta.get("grep_anchors")
        if not mechanical_tier and not isinstance(anchors, list):
            raise ModuleAssetsError(
                f"opening cached pdf_index {pdf_index} grep_anchors are invalid"
            )
        if not isinstance(anchors, list):
            anchors = []
        if not mechanical_tier and any(
            not isinstance(anchor, str) or not anchor.strip()
            for anchor in anchors
        ):
            raise ModuleAssetsError(
                f"opening cached pdf_index {pdf_index} grep_anchors are invalid"
            )
        if mechanical_tier:
            # OCR pages declare no confidence and no anchors; the bounded
            # text_preview is their only window-selection signal and the
            # anchors_declared advisory already tells the Keeper to
            # exact-read adjacent cached pages before locking the window.
            parse_confidence = None
        revision_ref = meta.get("ocr_revision")
        if isinstance(revision_ref, dict):
            selected_revision = next(
                (
                    row for row in (selected_rows[0].get("page_revisions") or [])
                    if isinstance(row, dict)
                    and row.get("pdf_index") == pdf_index
                    and row.get("ocr_revision") == revision_ref
                    and row.get("text_sha256") == meta.get("text_sha256")
                    and str(row.get("structured_data_sha256") or "")
                    == str(meta.get("structured_data_sha256") or "")
                ),
                None,
            )
            if selected_revision is None:
                raise ModuleAssetsError(
                    f"opening cached pdf_index {pdf_index} is not bound to the selected source bundle"
                )
        else:
            cached_bundle_hashes = {
                str(value) for value in (meta.get("bundle_sha256s") or [])
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
        if isinstance(revision_ref, dict):
            text_path = Path(str(meta.get("path") or "")).resolve()
            try:
                text_path.relative_to(module_root.resolve())
            except ValueError as exc:
                raise ModuleAssetsError(
                    f"opening cached pdf_index {pdf_index} page text escapes cache"
                ) from exc
        else:
            text_path = module_root / "pages" / f"{pdf_index:04d}.md"
        if not text_path.is_file():
            raise ModuleAssetsError(
                f"opening cached pdf_index {pdf_index} page text is missing"
            )
        page_text = text_path.read_text(encoding="utf-8")
        if hashlib.sha256(page_text.encode("utf-8")).hexdigest() != str(
            meta.get("text_sha256") or ""
        ):
            raise ModuleAssetsError(
                f"opening cached pdf_index {pdf_index} page text drifted from "
                "its accepted metadata"
            )
        anchors_declared = anchors_declared or bool(anchors)
        candidates.append({
            "pdf_index": pdf_index,
            "review_state": review_state,
            "parse_confidence": parse_confidence,
            "grep_anchor_preview": bounded_preview(list(anchors)),
            "text_preview": text_preview(page_text),
        })
    result: dict[str, Any] = {
        "opening_page_candidates": candidates,
        "opening_page_candidate_total": len(candidates),
        "opening_page_candidate_complete": True,
        "opening_page_candidate_role": "selection_hint_only_not_provenance",
        "anchors_declared": anchors_declared,
    }
    if not anchors_declared:
        result["opening_window_selection_advisory"] = (
            "producer declared no grep_anchors; text_preview is the only "
            "window-selection signal, so exact-read adjacent cached pages "
            "before locking the opening window"
        )
    return result


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
    page_refs = []
    for ref in refs:
        page_ref = {
            "source_id": str(ref.get("source_id") or ""),
            "pdf_index": int(ref["pdf_index"]),
            "text_sha256": str(ref.get("text_sha256") or ""),
            "review_state": ref.get("review_state"),
            "parse_confidence": ref.get("parse_confidence"),
        }
        if isinstance(ref.get("ocr_revision"), dict):
            page_ref["ocr_revision"] = json.loads(json.dumps(ref["ocr_revision"]))
        if isinstance(ref.get("structured_data"), dict):
            page_ref["structured_data_sha256"] = ref["structured_data"].get("sha256")
        page_refs.append(page_ref)
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
    *,
    allowed_read_aloud_indices: set[int] | None = None,
    required_read_aloud_languages: set[str] | None = None,
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

    indices = _source_indices(
        doc, field=kind, allow_string_refs=(kind == "handout"),
    )
    if kind == "clue" and fact_authority == "source_authored":
        _canonicalize_source_authored_fact(
            workspace,
            asset_root_id,
            doc,
            field="clue",
        )
        indices = _source_indices(
            doc, field=kind, allow_string_refs=(kind == "handout"),
        )
    if kind == "handout":
        # A handout pack is a verbatim info card; the kind enum and the
        # text⇒source_refs tracing rule are hard pack requirements.
        _validate_handout_entity_pack(doc)
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
    # Handout cards carry contract string source_refs ("pdf_index-16"). The
    # canonical object-form scope below stays the evidence machinery's own
    # representation, so the card contract survives the round trip: capture
    # before, restore after.
    handout_card_refs: list[str] | None = None
    if kind == "handout" and isinstance(doc.get("source_refs"), list):
        handout_card_refs = [
            str(ref) for ref in doc["source_refs"] if isinstance(ref, str)
        ]
    refs = _cached_source_refs(
        workspace,
        asset_root_id,
        doc,
        field=kind,
        allow_string_refs=(kind == "handout"),
    )
    digests = [str(ref["text_sha256"]) for ref in refs]
    supplied_digests = doc.get("page_text_sha256")
    if supplied_digests is not None and supplied_digests != digests:
        raise ModuleAssetsError(
            f"{kind}.page_text_sha256 does not match the cached source pages"
        )
    _apply_canonical_source_scope(doc, refs)
    if handout_card_refs is not None:
        doc["source_refs"] = handout_card_refs
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
        _canonicalize_location_read_aloud_refs(
            workspace,
            asset_root_id,
            doc,
            allowed_request_indices=allowed_read_aloud_indices,
        )
        _validate_location_read_aloud_locales(
            doc, required_read_aloud_languages or set()
        )
        # Scene edges in a shared source pack inherit the exact validated
        # parent page scope unless they declare a narrower exact subset.
        # Campaign-local rows are never allowed to borrow that source
        # authority merely because they were embedded in a source pack.
        for position, edge in enumerate(doc.get("scene_edges") or []):
            if not isinstance(edge, dict):
                continue
            edge_field = f"location.scene_edges[{position}]"
            if _scene_edge_is_campaign_local(edge):
                borrowed_fields = sorted(
                    set(edge).intersection(
                        FACT_RECORD_CANONICAL_SOURCE_FIELDS
                        | FACT_RECORD_PARALLEL_SOURCE_FIELDS
                    )
                )
                if borrowed_fields:
                    raise ModuleAssetsError(
                        f"{edge_field} is campaign-local and must not borrow "
                        "source evidence: "
                        + ", ".join(sorted(set(borrowed_fields)))
                    )
                edge_provenance = edge.get("provenance")
                if (
                    isinstance(edge_provenance, dict)
                    and "source_refs" in edge_provenance
                ):
                    raise ModuleAssetsError(
                        f"{edge_field} is campaign-local and must not borrow "
                        "source evidence: provenance.source_refs"
                    )
                # Campaign-local provenance uses the same closed contract as
                # every other fact provenance object. This rejects source_refs
                # for campaign authority and fails closed on every nested
                # canonical/parallel source selector or unknown field.
                _validate_fact_provenance(
                    edge,
                    field=f"{edge_field}.provenance",
                    require=False,
                )
                continue
            edge_refs = _cached_source_refs(
                workspace,
                asset_root_id,
                edge,
                field=edge_field,
                inherited_indices=list(doc["source_page_indices"]),
            )
            _apply_canonical_source_scope(edge, edge_refs)
            edge["origin"] = "source"
            edge["provenance"] = {
                "authority": "source_authored",
                "source_refs": json.loads(json.dumps(edge_refs)),
                "basis": "location_scene_edge",
            }

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
            try:
                validate_host_work_request_shape(request)
            except ModuleAssetsError:
                if requested_job_id and path.stem == requested_job_id:
                    raise
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


def _mark_host_work_fulfilled_unlocked(
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
    path = (
        _module_dir(workspace, asset_root_id)
        / "host-work"
        / f"{_require_id(host_work_job_id, 'host_work_job_id')}.json"
    )
    if not path.is_file():
        raise ModuleAssetsError("host-work request is missing")
    request = json.loads(path.read_text(encoding="utf-8"))
    validate_host_work_request_shape(request)
    status = str(request.get("status") or "open")
    if status in HOST_WORK_CLOSED_STATUSES:
        raise ModuleAssetsError(
            f"host_work_job_id {host_work_job_id!r} is {status}; "
            "fulfill the replacement request"
        )
    if (
        str(request.get("target_id") or "") != entity_id
        or _job_entity_kind(str(request.get("kind") or "")) != kind
    ):
        raise ModuleAssetsError("host-work request does not match the entity pack")
    request["status"] = "fulfilled"
    request["dispatch_state"] = "fulfilled"
    request["fulfilled_at"] = fulfilled_at
    request["fulfilled_entity"] = json.loads(json.dumps(fulfilled_entity))
    request["repository_put_ms"] = repository_put_ms
    _write_json(path, request)


def put_skeleton_and_fulfill_locator_host_work(
    workspace: Path,
    asset_root_id: str,
    *,
    host_work_job_id: str,
    skeleton: dict[str, Any],
) -> dict[str, Any]:
    """Store one locator delta and close its exact request atomically."""
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
        validate_host_work_request_shape(request)
        if request.get("kind") != "locate_mechanics_index":
            raise ModuleAssetsError("host-work request is not a mechanics locator pass")
        if request.get("status") in {"fulfilled", "cancelled", "superseded"}:
            raise ModuleAssetsError(
                f"locator host-work request is already {request.get('status')}"
            )
        started = time.perf_counter()
        put_result = put_skeleton(workspace, asset_root_id, skeleton)
        repository_put_ms = max(
            0, round((time.perf_counter() - started) * 1000),
        )
        request.update({
            "status": "fulfilled",
            "dispatch_state": "fulfilled",
            "fulfilled_at": _now_iso(),
            "repository_put_ms": max(0, int(repository_put_ms)),
        })
        _write_json(path, request)
    return {"put": put_result, "repository_put_ms": repository_put_ms}


def put_section_index_and_fulfill_host_work(
    workspace: Path,
    asset_root_id: str,
    *,
    host_work_job_id: str,
    section_rows: Any,
) -> dict[str, Any]:
    """Validate one classifier result against its own request and store it.

    The request that produced the rows is the only authority for what may be
    in them, so it is re-read here rather than trusted from the caller: a row
    naming a heading this request never offered, or pages outside it, is a
    fabrication no matter how well formed it looks.
    """
    module_dir = _module_dir(workspace, asset_root_id)
    path = (
        module_dir / "host-work"
        / f"{_require_id(host_work_job_id, 'host_work_job_id')}.json"
    )
    if not path.is_file():
        raise ModuleAssetsError("section classification host-work request is missing")
    with coc_fileio.advisory_file_lock(module_dir / "host-work.lock"):
        request = json.loads(path.read_text(encoding="utf-8"))
        validate_host_work_request_shape(request)
        if request.get("kind") != CLASSIFY_SECTIONS_KIND:
            raise ModuleAssetsError(
                "host-work request is not a section classification pass"
            )
        if request.get("status") in {"fulfilled", "cancelled", "superseded"}:
            raise ModuleAssetsError(
                f"section host-work request is already {request.get('status')}"
            )
        classification = request.get("classification_request")
        if not isinstance(classification, dict):
            raise ModuleAssetsError(
                "section host-work request carries no classification packet"
            )
        if (
            _classification_catalog_is_empty(request)
            and _classification_rows_are_global(section_rows)
        ):
            request["classification_incomplete"] = {
                "reason": "entity_catalog_empty",
                "entity_catalog_provenance": json.loads(json.dumps(
                    classification.get("entity_catalog_provenance") or {}
                )),
            }
            _write_json(path, request)
            raise ModuleAssetsError(
                "section classification cannot complete with an empty entity catalog"
            )
        started = time.perf_counter()
        index = _sections_module().build_section_index(
            rows=section_rows, request=classification,
        )
        stored = write_section_index(workspace, asset_root_id, index)
        repository_put_ms = max(0, round((time.perf_counter() - started) * 1000))
        request.update({
            "status": "fulfilled",
            "dispatch_state": "fulfilled",
            "fulfilled_at": _now_iso(),
            "repository_put_ms": repository_put_ms,
        })
        _write_json(path, request)
    return {
        "section_index": stored,
        "coverage": _sections_module().coverage_ledger(stored),
        "repository_put_ms": repository_put_ms,
    }


def section_pack_path(
    workspace: Path, asset_root_id: str, section_id: str,
) -> Path:
    safe = _require_id(section_id, "section_id")
    return _module_dir(workspace, asset_root_id) / SECTIONS_DIR / f"{safe}.json"


def get_section_pack(
    workspace: Path, asset_root_id: str, section_id: str,
) -> dict[str, Any] | None:
    """Return one stored section head plus its document body, if extracted."""
    head_path = section_pack_path(workspace, asset_root_id, section_id)
    if not head_path.is_file():
        return None
    try:
        head = json.loads(head_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(head, dict):
        return None
    body_path = section_body_path(workspace, asset_root_id, section_id)
    head["body_path"] = str(body_path)
    head["body_present"] = body_path.is_file()
    return head


def _mark_section_resolved(
    workspace: Path, asset_root_id: str, section_id: str, *, pack_kind: str,
) -> None:
    index = read_section_index(workspace, asset_root_id)
    if not isinstance(index, dict):
        return
    changed = False
    for row in index.get("sections") or []:
        if isinstance(row, dict) and row.get("section_id") == section_id:
            row["parse_state"] = "resolved"
            row["pack_kind"] = pack_kind
            changed = True
    if changed:
        _write_json(section_index_path(workspace, asset_root_id), index)


def put_section_pack_and_fulfill_host_work(
    workspace: Path,
    asset_root_id: str,
    *,
    host_work_job_id: str,
    pack: Any,
) -> dict[str, Any]:
    """Store one extracted section: head as JSON, prose as a real document.

    The worker never writes to disk; it returns the prose inside its validated
    result and the repository persists it here.  That keeps the document real
    and readable while leaving the evidence chain — page refs, digests, the
    labels the index assigned — under repository control.
    """
    module_dir = _module_dir(workspace, asset_root_id)
    path = (
        module_dir / "host-work"
        / f"{_require_id(host_work_job_id, 'host_work_job_id')}.json"
    )
    if not path.is_file():
        raise ModuleAssetsError("section extraction host-work request is missing")
    packs = _section_packs_module()
    with coc_fileio.advisory_file_lock(module_dir / "host-work.lock"):
        request = json.loads(path.read_text(encoding="utf-8"))
        validate_host_work_request_shape(request)
        if request.get("kind") != EXTRACT_SECTION_KIND:
            raise ModuleAssetsError(
                "host-work request is not a section extraction"
            )
        if request.get("status") in {"fulfilled", "cancelled", "superseded"}:
            raise ModuleAssetsError(
                f"section host-work request is already {request.get('status')}"
            )
        extraction = request.get("extraction_request")
        if not isinstance(extraction, dict):
            raise ModuleAssetsError(
                "section host-work request carries no extraction packet"
            )
        started = time.perf_counter()
        body = pack.get("body_markdown") if isinstance(pack, dict) else None
        head = packs.validate_section_pack(pack, request=extraction)
        section_id = head["section_id"]
        body_path = section_body_path(workspace, asset_root_id, section_id)
        body_path.parent.mkdir(parents=True, exist_ok=True)
        coc_fileio.write_text_atomic(
            body_path, packs.section_document(head, body),
        )
        _write_json(section_pack_path(workspace, asset_root_id, section_id), head)
        _mark_section_resolved(
            workspace, asset_root_id, section_id, pack_kind=head["pack_kind"],
        )
        repository_put_ms = max(0, round((time.perf_counter() - started) * 1000))
        request.update({
            "status": "fulfilled",
            "dispatch_state": "fulfilled",
            "fulfilled_at": _now_iso(),
            "repository_put_ms": repository_put_ms,
        })
        _write_json(path, request)
    return {
        "section_pack": head,
        "body_path": str(body_path),
        "repository_put_ms": repository_put_ms,
    }


def _section_packs_module():
    global _SECTION_PACKS_MODULE
    if _SECTION_PACKS_MODULE is None:
        _SECTION_PACKS_MODULE = _load_sibling(
            "coc_module_section_packs_assets", "coc_module_section_packs.py",
        )
    return _SECTION_PACKS_MODULE


_SECTION_PACKS_MODULE = None


def _sections_module():
    global _SECTIONS_MODULE
    if _SECTIONS_MODULE is None:
        _SECTIONS_MODULE = _load_sibling(
            "coc_module_sections_assets", "coc_module_sections.py",
        )
    return _SECTIONS_MODULE


_SECTIONS_MODULE = None


def _classification_rows_are_global(rows: Any) -> bool:
    return bool(rows) and isinstance(rows, list) and all(
        isinstance(row, dict)
        and isinstance(row.get("binding"), dict)
        and row["binding"].get("kind") == "global"
        and row["binding"].get("entity_kind") is None
        and row["binding"].get("entity_ids") in (None, [])
        for row in rows
    )


def _classification_catalog_is_empty(request: dict[str, Any]) -> bool:
    classification = request.get("classification_request")
    return (
        isinstance(classification, dict)
        and isinstance(classification.get("entity_catalog"), list)
        and not classification["entity_catalog"]
    )


def _refresh_classification_entity_catalog(
    workspace: Path,
    asset_root_id: str,
    request: dict[str, Any],
) -> bool:
    """Durably refresh one open structure request before claim projection."""
    if str(request.get("kind") or "") != CLASSIFY_SECTIONS_KIND:
        return False
    classification = request.get("classification_request")
    if not isinstance(classification, dict):
        return False
    snapshot = classification_entity_catalog_snapshot(workspace, asset_root_id)
    changed = False
    for field in ("entity_catalog", "entity_catalog_provenance"):
        value = snapshot[field]
        if classification.get(field) != value:
            classification[field] = json.loads(json.dumps(value))
            changed = True
    provenance = snapshot["entity_catalog_provenance"]
    if request.get("classification_catalog_provenance") != provenance:
        request["classification_catalog_provenance"] = json.loads(
            json.dumps(provenance)
        )
        changed = True
    if snapshot["entity_catalog"]:
        if "classification_incomplete" in request:
            request.pop("classification_incomplete", None)
            changed = True
    else:
        incomplete = {
            "reason": "entity_catalog_empty",
            "entity_catalog_provenance": json.loads(json.dumps(provenance)),
        }
        if request.get("classification_incomplete") != incomplete:
            request["classification_incomplete"] = incomplete
            changed = True
    return changed


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
    if str(request.get("kind") or "") == CLASSIFY_SECTIONS_KIND:
        # A structure pass answers from its own packet.  Repopulating page refs
        # here would hand the classifier the page window the lane exists to
        # avoid, and would do it silently at claim time.
        return False
    requested = request.get("requested_pdf_indices")
    if not isinstance(requested, list) or any(
        isinstance(value, bool) or not isinstance(value, int)
        for value in requested
    ):
        return False
    refs: list[dict[str, Any]] = []
    for pdf_index in sorted(set(requested)):
        ref = cached_page_ref(workspace, asset_root_id, pdf_index)
        if ref is None:
            continue
        refs.append(ref)
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
    if request.get("consumer_state") == "legacy_unowned":
        return "legacy_unowned"
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
    if str(request.get("kind") or "") == CLASSIFY_SECTIONS_KIND:
        # A structure pass answers from its own packet of headings and
        # previews, so it holds no page window and can never satisfy the
        # cached-scope gate below. A missing canonical identity catalog is an
        # explicit defer: all-global output would otherwise falsely complete
        # an index that cannot yet bind authored entity sections.
        if _classification_catalog_is_empty(request):
            return "awaiting_scope"
        return "runnable"
    if str(request.get("kind") or "") == "full_parse":
        # Whole-book background parse is dispatchable while pages are still
        # missing: the renderer lane itself supplies the missing pages.  The
        # packet still carries exact cached refs plus the complete request
        # scope, so claims never widen or re-render accepted evidence.
        return "runnable"
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
    refs = request.get("consumer_refs")
    if isinstance(refs, list) and refs:
        live: list[dict[str, Any]] = []
        for ref in refs:
            if not isinstance(ref, dict):
                continue
            campaign_id = str(ref.get("campaign_id") or "")
            scenario_path = (
                _coc_root(workspace) / "campaigns" / campaign_id
                / "scenario" / "scenario.json"
            )
            try:
                scenario = json.loads(scenario_path.read_text(encoding="utf-8"))
            except (OSError, ValueError, json.JSONDecodeError):
                continue
            pointers = {
                str(scenario.get("source_cache_asset_root_id") or "").strip(),
                str(scenario.get("progressive_asset_root_id") or "").strip(),
            }
            if (
                asset_root_id in pointers
                and _scenario_binding_sha256(scenario)
                == ref.get("scenario_binding_sha256")
            ):
                live.append(ref)
        if live != refs:
            stale = [ref for ref in refs if ref not in live]
            request["stale_consumer_refs"] = [
                *list(request.get("stale_consumer_refs") or []),
                *stale,
            ]
            if live:
                request["consumer_refs"] = live
            else:
                if str(request.get("kind") or "") in {
                    "full_parse", CLASSIFY_SECTIONS_KIND,
                }:
                    # These are root-scoped: one job per module root serves
                    # every campaign bound to it.  The binding sha changes when
                    # the skeleton projection stamps the root (and on review
                    # rebinds), so stale per-campaign refs must never supersede
                    # them.  A section index describes the book, not a
                    # campaign, exactly as the whole-book parse does.  The
                    # request closes only through completion or its bounded
                    # failure cap.
                    request["consumer_state"] = "owned"
                    request["root_scoped_consumer"] = True
                else:
                    request.pop("consumer_refs", None)
                    request.pop("consumer_state", None)
            changed = True
        if (
            not live
            and str(request.get("status") or "open")
            not in HOST_WORK_CLOSED_STATUSES
            and str(request.get("kind") or "") not in {
                "full_parse", CLASSIFY_SECTIONS_KIND,
            }
        ):
            request["status"] = "superseded"
            request["superseded_at"] = now.isoformat()
            request["stale_reason"] = "consumer_binding_stale"
            request.pop("dispatch_state", None)
            for key in ("lease_id", "leased_at", "lease_expires_at", "executor_id"):
                request.pop(key, None)
            changed = True
    elif request.get("consumer_state") != "legacy_unowned":
        request["consumer_state"] = "legacy_unowned"
        changed = True
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


def _requeue_invalid_host_work_jobs(
    workspace: Path,
    asset_root_id: str,
    job_ids: list[str],
) -> None:
    """Rebuild rejected open handoffs only from their authoritative queue rows."""
    wanted = {str(value).strip() for value in job_ids if str(value).strip()}
    if not wanted:
        return
    module_root = _module_dir(workspace, asset_root_id)
    queue_path = module_root / "parse-queue.json"
    if not queue_path.is_file():
        return
    requeued: list[str] = []
    with coc_fileio.advisory_file_lock(module_root / "parse-queue.lock"):
        queue = json.loads(queue_path.read_text(encoding="utf-8"))
        pending = list(queue.get("pending") or [])
        in_flight = list(queue.get("in_flight") or [])
        done = list(queue.get("done") or [])
        indexed = {str(row.get("job_id") or ""): row for row in [*in_flight, *done]}
        for job_id in sorted(wanted):
            source = indexed.get(job_id)
            if source is None:
                continue
            kind = str(source.get("kind") or "")
            if kind not in JOB_KINDS:
                continue
            fresh = {
                key: source[key] for key in (
                    "job_id", "kind", "target_id", "priority", "reason",
                    "enqueued_at", "request_purpose", "requested_source_scope",
                    "source_scope_signature", "supersedes_host_job_ids",
                    "consumer_refs",
                )
                if key in source
            }
            try:
                level, dependency_ref = validate_host_work_contract(
                    source.get("work_level")
                    or _default_host_work_level(kind),
                    source.get("dependency_ref"),
                )
            except ModuleAssetsError:
                # A legacy request may describe urgency, but it cannot become
                # an exact current dependency without an authoritative caller.
                level, dependency_ref = _default_host_work_level(kind), None
            fresh["work_level"] = level
            if dependency_ref is not None:
                fresh["dependency_ref"] = dependency_ref
            if all(str(row.get("job_id") or "") != job_id for row in pending):
                pending.append(fresh)
            requeued.append(job_id)
        if requeued:
            queue["pending"] = sorted(
                pending,
                key=lambda row: (
                    -int(row.get("priority") or 0),
                    str(row.get("enqueued_at") or ""),
                ),
            )
            moved = set(requeued)
            queue["in_flight"] = [
                row for row in in_flight if str(row.get("job_id") or "") not in moved
            ]
            queue["done"] = [
                row for row in done if str(row.get("job_id") or "") not in moved
            ]
            _write_json(queue_path, queue)


def _quarantine_host_work_request(
    workspace: Path,
    asset_root_id: str,
    path: Path,
    raw_bytes: bytes,
    *,
    reason: str,
) -> dict[str, Any]:
    """Preserve rejected bytes append-only and disposition the live row."""
    digest = hashlib.sha256(raw_bytes).hexdigest()
    module_root = _module_dir(workspace, asset_root_id)
    rejected_dir = module_root / "host-work-rejected"
    rejected_dir.mkdir(parents=True, exist_ok=True)
    evidence_path = rejected_dir / f"{path.stem}-{digest}.json"
    if not evidence_path.is_file():
        _write_json(evidence_path, {
            "schema_version": 1,
            "source_path": str(path),
            "rejected_evidence_sha256": digest,
            "raw_base64": base64.b64encode(raw_bytes).decode("ascii"),
        })
    try:
        job_id = _require_id(path.stem, "host-work.job_id")
    except ModuleAssetsError:
        job_id = f"quarantine-{digest[:20]}"
    record = {
        "schema_version": HOST_WORK_SCHEMA_VERSION,
        "job_id": job_id,
        "asset_root_id": asset_root_id,
        "status": "quarantined",
        "dispatch_state": "quarantined",
        "quarantined_at": _now_iso(),
        "quarantine_reason": str(reason)[:320],
        "rejected_evidence_sha256": digest,
        "rejected_evidence_path": str(evidence_path),
    }
    _write_json(path, record)
    return record


def claim_host_work_requests(
    workspace: Path,
    asset_root_id: str,
    *,
    executor_id: str,
    limit: int = 1,
    lease_seconds: int = 600,
    cached_only: bool = True,
    result_delivery: str = "named_submit",
    max_dispatch_attempts: int | None = None,
    exact_job_id: str | None = None,
) -> dict[str, Any]:
    """Atomically lease bounded source-page work groups for host subagents.

    The repository still does not parse PDF content.  It only coalesces exact
    page scopes and returns contract packets.  A host-native child reads those
    cached pages. The packet's explicit result transport determines whether
    the child submits directly or returns exact rows to a lifecycle manager;
    the repository remains the sole canonical fulfillment boundary.
    """
    executor = str(executor_id or "").strip()
    if not executor or len(executor) > 128:
        raise ModuleAssetsError("executor_id must be 1..128 characters")
    if (
        isinstance(limit, bool)
        or not isinstance(limit, int)
        or not 1 <= limit <= MAX_CLAIM_LIMIT
    ):
        raise ModuleAssetsError(
            f"limit must be an integer from 1 through {MAX_CLAIM_LIMIT}"
        )
    if (
        isinstance(lease_seconds, bool)
        or not isinstance(lease_seconds, int)
        or not 30 <= lease_seconds <= 3600
    ):
        raise ModuleAssetsError("lease_seconds must be an integer from 30 through 3600")
    if cached_only is not True:
        raise ModuleAssetsError(
            "cached_only=false is unsupported; only exact cached work is claimable"
        )
    if result_delivery not in {"named_submit", "return_to_parent"}:
        raise ModuleAssetsError(
            "result_delivery must be named_submit or return_to_parent"
        )
    if max_dispatch_attempts is not None and (
        isinstance(max_dispatch_attempts, bool)
        or not isinstance(max_dispatch_attempts, int)
        or not 1 <= max_dispatch_attempts <= 100
    ):
        raise ModuleAssetsError(
            "max_dispatch_attempts must be null or an integer from 1 through 100"
        )
    if exact_job_id is not None:
        if (
            not isinstance(exact_job_id, str)
            or not exact_job_id
            or exact_job_id != exact_job_id.strip()
        ):
            raise ModuleAssetsError(
                "exact_job_id must be one non-empty job id"
            )

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
                raw_bytes = path.read_bytes()
            except OSError:
                continue
            try:
                request = json.loads(raw_bytes.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                _quarantine_host_work_request(
                    workspace, asset_root_id, path, raw_bytes,
                    reason=f"invalid_json:{type(exc).__name__}",
                )
                continue
            if not isinstance(request, dict):
                _quarantine_host_work_request(
                    workspace, asset_root_id, path, raw_bytes,
                    reason="host_work_request_not_object",
                )
                continue
            if str(request.get("status") or "open") in HOST_WORK_CLOSED_STATUSES:
                continue
            try:
                validate_host_work_request_shape(request)
            except ModuleAssetsError as exc:
                _quarantine_host_work_request(
                    workspace, asset_root_id, path, raw_bytes,
                    reason=str(exc),
                )
                continue
            changed = _refresh_classification_entity_catalog(
                workspace, asset_root_id, request,
            )
            changed = _refresh_host_work_lifecycle(
                workspace, asset_root_id, request, now=now,
            ) or changed
            if changed:
                _write_json(path, request)
            if host_work_operational_class(request) != "runnable":
                continue
            if (
                exact_job_id is not None
                and str(request.get("job_id") or "") != exact_job_id
            ):
                continue
            rows.append((path, request))

        grouped: dict[
            tuple[str, str],
            list[tuple[Path, dict[str, Any]]],
        ] = {}
        for path, request in rows:
            group_id = str(request.get("work_group_id") or request.get("job_id") or "")
            result_contract = request.get("result_contract")
            contract_family = (
                "sha256:" + _compact_canonical_sha256(result_contract)
                if isinstance(result_contract, dict)
                else "missing:" + str(request.get("kind") or "")
            )
            # Page-scope coalescing must not merge incompatible closed result
            # families into one claim packet. The Pi wire can deduplicate exact
            # repeated hashes, but two different contracts must remain separate
            # bounded leaves rather than overflow the transport projection.
            grouped.setdefault(
                (group_id, contract_family),
                [],
            ).append((path, request))
        if max_dispatch_attempts is not None:
            grouped = {
                group_id: members
                for group_id, members in grouped.items()
                if all(
                    int(request.get("dispatch_attempts") or 0)
                    < max_dispatch_attempts
                    for _path, request in members
                )
            }
        deadline_order = {
            "blocking_micro": 0,
            "next_turn_hot": 1,
            "hot_ring": 2,
            "idle_warm": 3,
        }

        def family_urgency(
            item: tuple[
                tuple[str, str],
                list[tuple[Path, dict[str, Any]]],
            ],
        ) -> tuple[Any, ...]:
            (_group_id, contract_family), members = item
            return (
                min(
                    deadline_order.get(
                        str(row[1].get("deadline_class") or "next_turn_hot"),
                        9,
                    )
                    for row in members
                ),
                0 if any(
                    str(row[1].get("work_level")) == "current_dependency"
                    for row in members
                ) else 1,
                min(
                    HOST_WORK_LEVELS.index(str(row[1].get("work_level")))
                    for row in members
                ),
                -max(int(row[1].get("priority") or 0) for row in members),
                min(str(row[1].get("created_at") or "") for row in members),
                contract_family,
                _group_id,
            )

        candidates_by_group: dict[
            str,
            list[
                tuple[
                    tuple[str, str],
                    list[tuple[Path, dict[str, Any]]],
                ]
            ],
        ] = {}
        for item in grouped.items():
            candidates_by_group.setdefault(item[0][0], []).append(item)
        selected_per_group: list[
            tuple[
                tuple[str, str],
                list[tuple[Path, dict[str, Any]]],
            ]
        ] = [
            min(candidates, key=family_urgency)
            for candidates in candidates_by_group.values()
        ]
        selected_groups = sorted(
            selected_per_group,
            key=family_urgency,
        )[:limit]

        packets: list[dict[str, Any]] = []
        for (group_id, _contract_family), members in selected_groups:
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
                packet_request = {
                    key: request.get(key)
                    for key in (
                        "job_id", "kind", "target_id", "priority", "reason",
                        "instruction", "requested_pdf_indices", "cached_page_refs",
                        "cached_scope_complete", "batch_subjects",
                        "request_purpose", "requested_source_scope",
                        "source_scope_signature", "result_contract",
                        "allowed_registered_asset_refs",
                        "allowed_scene_refs", "allowed_clue_refs",
                        "work_level", "consumer_refs", "consumer_state",
                        "play_languages",
                    )
                }
                # Structure work carries its own evidence: the whole input is a
                # repository-produced packet of headings and bounded previews,
                # not a page window to read.  Attach it only when present so
                # every other request keeps its exact existing shape.
                for structure_key in (
                    "classification_request", "extraction_request",
                ):
                    if request.get(structure_key) is not None:
                        packet_request[structure_key] = json.loads(
                            json.dumps(request[structure_key])
                        )
                if request["work_level"] == "current_dependency":
                    packet_request["dependency_ref"] = json.loads(
                        json.dumps(request["dependency_ref"])
                    )
                packet_requests.append(packet_request)
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
                        str(row[1].get("work_level") or "near_term")
                        for row in members
                    ),
                    key=lambda value: {
                        "current_dependency": 0,
                        "near_term": 1,
                        "bounded_warm": 2,
                    }.get(value, 9),
                ),
                "requested_pdf_indices": list(
                    exemplar.get("requested_pdf_indices") or []
                ),
                "cached_scope_complete": all(
                    row[1].get("cached_scope_complete") is True for row in members
                ),
                "result_delivery": result_delivery,
                "requests": packet_requests,
                "consumer_refs": json.loads(json.dumps(
                    exemplar.get("consumer_refs") or []
                )),
                "play_languages": list(exemplar.get("play_languages") or []),
            })
    result = {
        "packets": packets,
        "leased_group_count": len(packets),
        "ready_group_count": len(candidates_by_group),
        "cached_only": bool(cached_only),
    }
    result["lifecycle"] = host_work_lifecycle_summary(
        workspace, asset_root_id,
    )
    return result


# Release reasons that mean the host or transport gave up, not that this job's
# content failed. ``dispatch_attempts`` exists to stop a genuinely bad job from
# being retried forever; spending it on a projection bug, a killed session, or
# a deliberate deferral burns a campaign's only retries for reasons that have
# nothing to do with the work. These are our own emitted values, not free text.
_HOST_SIDE_RELEASE_REASONS = frozenset({
    "claim_projection_invalid",
    "coordinator_shutdown",
    "coordinator_aborted",
    "turn_pending_finalization",
})


def release_host_work_leases(
    workspace: Path,
    asset_root_id: str,
    *,
    executor_id: str,
    reason: str,
    lease_ids: list[str] | None = None,
) -> dict[str, Any]:
    """Gracefully release only leases owned by one exact executor.

    Abrupt process loss still relies on the durable TTL recovery path.  This
    operation intentionally cannot release by root, prefix, or lease id alone.
    """
    executor = str(executor_id or "").strip()
    if not executor or len(executor) > 128:
        raise ModuleAssetsError("executor_id must be 1..128 characters")
    release_reason = str(reason or "").strip()
    if not release_reason or len(release_reason) > 256:
        raise ModuleAssetsError("reason must be 1..256 characters")
    wanted = None
    if lease_ids is not None:
        if not isinstance(lease_ids, list) or any(
            not isinstance(value, str) or not value.strip() for value in lease_ids
        ):
            raise ModuleAssetsError("lease_ids must be non-empty strings")
        wanted = {value.strip() for value in lease_ids}
    module_root = _module_dir(workspace, asset_root_id)
    work_dir = module_root / "host-work"
    released: list[str] = []
    skipped: list[str] = []
    refunded: list[str] = []
    now = datetime.now(timezone.utc)
    with coc_fileio.advisory_file_lock(module_root / "host-work.lock"):
        for path in sorted(work_dir.glob("*.json")) if work_dir.is_dir() else []:
            try:
                request = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if not isinstance(request, dict):
                continue
            lease_id = str(request.get("lease_id") or "")
            if wanted is not None and lease_id not in wanted:
                continue
            job_id = str(request.get("job_id") or path.stem)
            if (
                str(request.get("status") or "open") in HOST_WORK_CLOSED_STATUSES
                or str(request.get("dispatch_state") or "") != "leased"
                or str(request.get("executor_id") or "") != executor
                or not lease_id
            ):
                skipped.append(job_id)
                continue
            request["last_lease_released_at"] = now.isoformat()
            request["last_lease_release_reason"] = release_reason
            request["last_lease_id"] = lease_id
            if release_reason in _HOST_SIDE_RELEASE_REASONS:
                # Refund the attempt this claim consumed: the host, not the
                # job, is why it came back. A lease lost to an abrupt crash
                # never reaches here, so TTL recovery still costs an attempt.
                request["dispatch_attempts"] = max(
                    0, int(request.get("dispatch_attempts") or 0) - 1,
                )
                refunded.append(job_id)
            request.pop("dispatch_state", None)
            for key in (
                "lease_id", "leased_at", "lease_expires_at", "executor_id",
            ):
                request.pop(key, None)
            _sync_host_work_dispatch_state(request)
            _write_json(path, request)
            released.append(job_id)
    return {
        "asset_root_id": asset_root_id,
        "executor_id": executor,
        "released_job_ids": released,
        "skipped_job_ids": skipped,
        "release_reason": release_reason,
        "dispatch_attempt_refunded_job_ids": refunded,
    }


def renew_host_work_leases(
    workspace: Path,
    asset_root_id: str,
    *,
    executor_id: str,
    lease_ids: list[str],
    lease_seconds: int,
) -> dict[str, Any]:
    """Extend live leases only when both executor and lease identity match."""
    executor = str(executor_id or "").strip()
    if not executor or len(executor) > 128:
        raise ModuleAssetsError("executor_id must be 1..128 characters")
    if not isinstance(lease_ids, list) or not lease_ids or any(
        not isinstance(value, str) or not value.strip() for value in lease_ids
    ):
        raise ModuleAssetsError("lease_ids must contain non-empty strings")
    if (
        isinstance(lease_seconds, bool)
        or not isinstance(lease_seconds, int)
        or not 30 <= lease_seconds <= 3600
    ):
        raise ModuleAssetsError("lease_seconds must be an integer from 30 through 3600")
    wanted = {value.strip() for value in lease_ids}
    module_root = _module_dir(workspace, asset_root_id)
    work_dir = module_root / "host-work"
    now = datetime.now(timezone.utc)
    renewed: list[str] = []
    skipped: list[str] = []
    with coc_fileio.advisory_file_lock(module_root / "host-work.lock"):
        for path in sorted(work_dir.glob("*.json")) if work_dir.is_dir() else []:
            try:
                request = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if not isinstance(request, dict):
                continue
            lease_id = str(request.get("lease_id") or "")
            if lease_id not in wanted:
                continue
            job_id = str(request.get("job_id") or path.stem)
            lifecycle_changed = _refresh_host_work_lifecycle(
                workspace, asset_root_id, request, now=now,
            )
            if lifecycle_changed:
                _write_json(path, request)
            if (
                str(request.get("status") or "open") in HOST_WORK_CLOSED_STATUSES
                or str(request.get("dispatch_state") or "") != "leased"
                or str(request.get("executor_id") or "") != executor
                or _lease_is_expired(request, now)
            ):
                skipped.append(job_id)
                continue
            request["lease_expires_at"] = (
                now + timedelta(seconds=lease_seconds)
            ).isoformat()
            request["lease_renewed_at"] = now.isoformat()
            _write_json(path, request)
            renewed.append(job_id)
    return {
        "asset_root_id": asset_root_id,
        "executor_id": executor,
        "renewed_job_ids": renewed,
        "skipped_job_ids": skipped,
        "lease_expires_after_seconds": lease_seconds,
    }


def _host_work_request_projection(
    request: dict[str, Any],
    path: Path,
    *,
    include_closed: bool,
) -> dict[str, Any] | None:
    """Project one already-validated host-work row without changing it."""
    status = str(request.get("status") or "open")
    if status == "quarantined":
        if not include_closed:
            return None
        return {
            "job_id": request.get("job_id"),
            "asset_root_id": request.get("asset_root_id"),
            "status": "quarantined",
            "dispatch_state": "quarantined",
            "operational_class": "stale",
            "quarantine_reason": request.get("quarantine_reason"),
            "rejected_evidence_sha256": request.get("rejected_evidence_sha256"),
            "rejected_evidence_path": request.get("rejected_evidence_path"),
            "path": str(path),
        }
    if not include_closed and status in HOST_WORK_CLOSED_STATUSES:
        return None
    requested_indices = list(request.get("requested_pdf_indices") or [])
    source_scope_known = bool(requested_indices)
    work_level = request["work_level"]
    projected = {
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
        "deadline_class": request.get("deadline_class") or "next_turn_hot",
        "work_level": work_level,
        "work_group_id": request.get("work_group_id"),
        "consumer_refs": json.loads(json.dumps(request.get("consumer_refs") or [])),
        "consumer_state": (
            request.get("consumer_state")
            or ("stale" if status == "superseded" else "legacy_unowned")
        ),
        "stale_consumer_refs": json.loads(
            json.dumps(request.get("stale_consumer_refs") or [])
        ),
        "stale_reason": request.get("stale_reason"),
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
    }
    if work_level == "current_dependency":
        projected["dependency_ref"] = json.loads(
            json.dumps(request["dependency_ref"])
        )
    return projected


def _list_host_work_requests_unlocked(
    workspace: Path,
    asset_root_id: str,
    *,
    include_closed: bool = False,
    limit: int | None = 8,
    invalid_job_ids: list[str] | None = None,
    mutating: bool = True,
) -> tuple[list[dict[str, Any]], bool]:
    """Return a bounded, deterministic projection of durable host handoffs.

    Queue ``done`` rows are a negative cache, not proof that semantic parsing
    finished.  This projection makes the still-open host boundary visible to
    normal Keeper tools without exposing an unbounded directory history.
    """
    work_dir = _module_dir(workspace, asset_root_id) / "host-work"
    if not work_dir.is_dir():
        return [], True
    try:
        before_directory_stat = work_dir.stat()
        paths = sorted(work_dir.glob("*.json"))
    except OSError:
        return [], False
    rows: list[dict[str, Any]] = []
    facts_complete = True
    now = datetime.now(timezone.utc)
    for path in paths:
        try:
            raw_bytes = path.read_bytes()
        except OSError:
            facts_complete = False
            continue
        try:
            request = json.loads(raw_bytes.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            if not mutating:
                facts_complete = False
                continue
            rejected = _quarantine_host_work_request(
                workspace, asset_root_id, path, raw_bytes,
                reason=f"invalid_json:{type(exc).__name__}",
            )
            if invalid_job_ids is not None:
                invalid_job_ids.append(str(rejected["job_id"]))
            continue
        if not isinstance(request, dict):
            if not mutating:
                facts_complete = False
                continue
            rejected = _quarantine_host_work_request(
                workspace, asset_root_id, path, raw_bytes,
                reason="host_work_request_not_object",
            )
            if invalid_job_ids is not None:
                invalid_job_ids.append(str(rejected["job_id"]))
            continue
        try:
            validate_host_work_request_shape(request)
        except ModuleAssetsError as exc:
            if not mutating:
                facts_complete = False
                continue
            rejected = _quarantine_host_work_request(
                workspace, asset_root_id, path, raw_bytes,
                reason=str(exc),
            )
            if invalid_job_ids is not None:
                invalid_job_ids.append(str(rejected["job_id"]))
            continue
        # Pure inspection reports only durable facts.  Do not even refresh an
        # in-memory copy: cache/lease/consumer reconciliation is materializing
        # lifecycle work, and a parallel reader must fail closed on facts it
        # cannot establish without that reconciliation.
        projected_request = request
        lifecycle_changed = False
        if mutating:
            try:
                lifecycle_changed = (
                    str(projected_request.get("status") or "open")
                    not in HOST_WORK_CLOSED_STATUSES
                    and _refresh_host_work_lifecycle(
                        workspace, asset_root_id, projected_request, now=now,
                    )
                )
            except (OSError, ValueError, ModuleAssetsError):
                raise
        if lifecycle_changed:
            _write_json(path, projected_request)
        projected = _host_work_request_projection(
            projected_request, path, include_closed=include_closed,
        )
        if projected is not None:
            rows.append(projected)
    if not mutating:
        try:
            after_directory_stat = work_dir.stat()
        except OSError:
            facts_complete = False
        else:
            if (
                before_directory_stat.st_ino != after_directory_stat.st_ino
                or before_directory_stat.st_mtime_ns != after_directory_stat.st_mtime_ns
                or before_directory_stat.st_ctime_ns != after_directory_stat.st_ctime_ns
            ):
                facts_complete = False
    rows.sort(
        key=lambda row: (
            -int(row.get("priority") or 0),
            str(row.get("created_at") or ""),
            str(row.get("job_id") or ""),
        )
    )
    if limit is not None:
        rows = rows[:max(0, int(limit))]
    return rows, facts_complete


def list_host_work_requests(
    workspace: Path,
    asset_root_id: str,
    *,
    include_closed: bool = False,
    limit: int | None = 8,
) -> list[dict[str, Any]]:
    """Read and refresh host work under its canonical lifecycle lock."""
    module_root = _module_dir(workspace, asset_root_id)
    invalid_job_ids: list[str] = []
    with coc_fileio.advisory_file_lock(module_root / "host-work.lock"):
        rows, _facts_complete = _list_host_work_requests_unlocked(
            workspace,
            asset_root_id,
            include_closed=include_closed,
            limit=limit,
            invalid_job_ids=invalid_job_ids,
        )
    _requeue_invalid_host_work_jobs(
        workspace, asset_root_id, invalid_job_ids,
    )
    return rows


def inspect_host_work_requests_pure(
    workspace: Path,
    asset_root_id: str,
    *,
    include_closed: bool = False,
    limit: int | None = 8,
) -> list[dict[str, Any]] | None:
    """Read one lifecycle decision without creating, refreshing, or repairing.

    This intentionally takes no advisory lock: acquiring the ordinary lifecycle
    lock can create ``host-work.lock``.  A malformed, unreadable, or otherwise
    incomplete snapshot returns ``None`` so a parallel caller must stay gated
    rather than treating missing facts as permission to proceed.
    """
    rows, facts_complete = _list_host_work_requests_unlocked(
        workspace,
        asset_root_id,
        include_closed=include_closed,
        limit=limit,
        mutating=False,
    )
    return rows if facts_complete else None


def get_host_work_request(
    workspace: Path,
    asset_root_id: str,
    job_id: str,
) -> dict[str, Any] | None:
    """Return one complete validated durable request for strict receivers.

    ``list_host_work_requests`` intentionally omits large private fields such
    as instructions and result contracts. Fulfillment needs the complete
    contract and therefore resolves one exact safe job id under the lifecycle
    lock instead of trying to enforce against that public projection.
    """
    jid = _require_id(job_id, "job_id")
    module_root = _module_dir(workspace, asset_root_id)
    path = module_root / "host-work" / f"{jid}.json"
    with coc_fileio.advisory_file_lock(module_root / "host-work.lock"):
        if not path.is_file():
            return None
        try:
            request = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ModuleAssetsError(
                f"host-work request {jid!r} is unreadable"
            ) from exc
        validate_host_work_request_shape(request)
        if str(request.get("job_id") or "") != jid:
            raise ModuleAssetsError("host-work request identity drift")
        return json.loads(json.dumps(request))


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
                row.get("work_level") == level
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


def _campaign_play_languages_for_asset(
    workspace: Path, asset_root_id: str
) -> set[str]:
    languages: set[str] = set()
    campaigns_dir = _coc_root(workspace) / "campaigns"
    for campaign_id in _campaigns_referencing_asset_root(workspace, asset_root_id):
        path = campaigns_dir / campaign_id / "campaign.json"
        try:
            campaign = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError, json.JSONDecodeError):
            continue
        language = (
            str(campaign.get("play_language") or "").strip()
            if isinstance(campaign, dict)
            else ""
        )
        languages.add(language or "zh-Hans")
    return languages


def _put_entity_host_work_constraints(
    workspace: Path,
    asset_root_id: str,
    kind: str,
    entity_id: str,
    host_work_job_id: Any,
) -> tuple[set[int] | None, set[str]]:
    requested_job_id = str(host_work_job_id or "").strip()
    if not requested_job_id:
        return None, _campaign_play_languages_for_asset(workspace, asset_root_id)
    job_id = _require_id(requested_job_id, "host_work_job_id")
    path = _module_dir(workspace, asset_root_id) / "host-work" / f"{job_id}.json"
    if not path.is_file():
        raise ModuleAssetsError(f"host_work_job_id {job_id!r} does not exist")
    try:
        request = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        raise ModuleAssetsError(
            f"host_work_job_id {job_id!r} is unreadable"
        ) from exc
    validate_host_work_request_shape(request)
    if (
        str(request.get("target_id") or "") != entity_id
        or _job_entity_kind(str(request.get("kind") or "")) != kind
    ):
        raise ModuleAssetsError(
            f"host_work_job_id {job_id!r} does not authorize this entity"
        )
    if str(request.get("status") or "open") in {"cancelled", "superseded"}:
        raise ModuleAssetsError(f"host_work_job_id {job_id!r} is closed")
    indices = request.get("requested_pdf_indices")
    if not isinstance(indices, list) or any(
        isinstance(index, bool) or not isinstance(index, int) or index < 0
        for index in indices
    ):
        raise ModuleAssetsError(
            f"host_work_job_id {job_id!r} has malformed requested_pdf_indices"
        )
    languages = {str(value) for value in request.get("play_languages") or []}
    return set(indices), languages


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
    allowed_read_aloud_indices, required_read_aloud_languages = (
        _put_entity_host_work_constraints(
            workspace,
            asset_root_id,
            kind,
            eid,
            transient_host_work_job_id,
        )
    )
    _canonicalize_entity_source_evidence(
        workspace,
        asset_root_id,
        kind,
        doc,
        allowed_read_aloud_indices=allowed_read_aloud_indices,
        required_read_aloud_languages=required_read_aloud_languages,
    )
    matched_host_work_job_id: str | None = None
    needs_host_work_boundary = (
        doc["parse_state"] in {"partial", "body_parsed", "deep"}
        or bool(str(transient_host_work_job_id or "").strip())
    )

    def commit_entity() -> int:
        nonlocal matched_host_work_job_id
        previous = (
            json.loads(path.read_text(encoding="utf-8"))
            if path.is_file()
            else None
        )
        if needs_host_work_boundary:
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
        # Validate after source canonicalization so PDF refs are concrete, and
        # pass workspace context so not_authored can bind to the locator row.
        _validate_entity_pack(
            kind,
            doc,
            workspace=workspace,
            asset_root_id=asset_root_id,
            entity_id=eid,
        )
        pending_mechanics_head: tuple[Path, dict[str, Any]] | None = None
        if (
            kind == "npc"
            and isinstance(doc.get("mechanics"), dict)
            and doc["mechanics"].get("status") == "authored"
        ):
            (
                doc["mechanics_revision_ref"],
                pending_mechanics_head,
            ) = _prepare_npc_mechanics_revision(
                mod, eid, doc, previous=previous,
            )
            if (
                matched_host_work_job_id is not None
                and isinstance(doc.get("ingest_timing"), dict)
            ):
                doc["ingest_timing"][FULFILLED_PACK_INGEST_FIELD] = (
                    canonical_ingest_fulfillment_receipt(
                        matched_host_work_job_id, kind, eid, doc,
                    )
                )
        fulfilled_entity_receipt = canonical_fulfilled_entity_receipt(
            kind, eid, doc,
        )
        # Publication order is deliberate: immutable revision artifact first
        # (prepared above), current entity projection second, active head last.
        # A crash can therefore leave harmless unreferenced history or a
        # fail-closed projection/head mismatch, never a silently current head.
        _write_json(path, doc)
        if pending_mechanics_head is not None:
            _write_json(*pending_mechanics_head)
        repository_put_ms = max(
            0, round((time.perf_counter() - started) * 1000),
        )
        _mark_host_work_fulfilled_unlocked(
            workspace,
            asset_root_id,
            host_work_job_id=matched_host_work_job_id,
            kind=kind,
            entity_id=eid,
            fulfilled_entity=fulfilled_entity_receipt,
            fulfilled_at=received_at,
            repository_put_ms=repository_put_ms,
        )
        return repository_put_ms

    mechanics_lock = mod / "entities" / f"npc-{eid}-mechanics.lock"

    def commit_with_entity_lock() -> int:
        if kind != "npc":
            return commit_entity()
        with coc_fileio.advisory_file_lock(mechanics_lock):
            return commit_entity()

    # Lock order is fixed and never reversed: host-work.lock, then the
    # stable NPC mechanics lock.  Page and source-bundle locks are disjoint.
    if needs_host_work_boundary:
        with coc_fileio.advisory_file_lock(mod / "host-work.lock"):
            repository_put_ms = commit_with_entity_lock()
    else:
        repository_put_ms = commit_with_entity_lock()
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
    out["repository_put_ms"] = repository_put_ms
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


def _npc_mechanics_revision_content(doc: dict[str, Any]) -> dict[str, Any]:
    mechanics = doc.get("mechanics")
    mechanics = mechanics if isinstance(mechanics, dict) else {}
    refs = mechanics.get("source_refs")
    if not isinstance(refs, list) or not refs:
        refs = doc.get("source_refs") if isinstance(doc.get("source_refs"), list) else []
    return {
        "mechanics": json.loads(json.dumps(mechanics)),
        "source_refs": json.loads(json.dumps(refs)),
    }


def _npc_mechanics_revision_digest(
    content: dict[str, Any],
) -> str:
    encoded = json.dumps(
        content, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _write_npc_mechanics_revision_artifact(
    root: Path,
    *,
    stable_id: str,
    revision: int,
    content: dict[str, Any],
) -> tuple[Path, str]:
    """Write or verify one immutable revision while the stable-id lock is held."""
    content_sha256 = _npc_mechanics_revision_digest(content)
    revision_path = root / "revisions" / f"{revision:06d}.json"
    if revision_path.is_file():
        stored = json.loads(revision_path.read_text(encoding="utf-8"))
        if (
            stored.get("stable_id") != stable_id
            or stored.get("revision") != revision
            or stored.get("content_sha256") != content_sha256
            or stored.get("content") != content
        ):
            raise ModuleAssetsError("NPC mechanics immutable revision hash drift")
        return revision_path, content_sha256
    _write_json(revision_path, {
        "schema_version": 1,
        "stable_id": stable_id,
        "revision": revision,
        "content_sha256": content_sha256,
        "authority": "source_authored",
        "content": content,
        "published_at": _now_iso(),
    })
    return revision_path, content_sha256


def _prepare_npc_mechanics_revision(
    module_dir: Path,
    npc_id: str,
    doc: dict[str, Any],
    *,
    previous: dict[str, Any] | None,
) -> tuple[dict[str, Any], tuple[Path, dict[str, Any]]]:
    """Prepare artifacts/ref/head while the stable NPC lock is held.

    The caller writes the current entity projection before committing the
    returned head document.
    """
    stable_id = f"npc:{npc_id}:mechanics"
    root = module_dir / "entities" / f"npc-{npc_id}-mechanics"
    head_path = root / "head.json"
    head = (
        json.loads(head_path.read_text(encoding="utf-8"))
        if head_path.is_file() else {}
    )
    if head and head.get("stable_id") != stable_id:
        raise ModuleAssetsError("NPC mechanics head identity mismatch")
    active_revision = int(head.get("active_revision") or 0)
    active_content_sha256 = str(head.get("content_sha256") or "")

    if active_revision > 0:
        active_path = root / "revisions" / f"{active_revision:06d}.json"
        if not active_path.is_file():
            raise ModuleAssetsError("NPC mechanics active revision is missing")
        active_doc = json.loads(active_path.read_text(encoding="utf-8"))
        active_content = active_doc.get("content")
        actual_active_sha256 = (
            _npc_mechanics_revision_digest(active_content)
            if isinstance(active_content, dict) else ""
        )
        if (
            active_doc.get("stable_id") != stable_id
            or active_doc.get("revision") != active_revision
            or active_doc.get("content_sha256") != actual_active_sha256
            or active_content_sha256 != actual_active_sha256
        ):
            raise ModuleAssetsError("NPC mechanics immutable revision hash drift")
    elif isinstance(previous, dict):
        previous_mechanics = previous.get("mechanics")
        previous_ref = previous.get("mechanics_revision_ref")
        previous_is_authored = (
            isinstance(previous_mechanics, dict)
            and previous_mechanics.get("status") == "authored"
        )
        if previous_is_authored and not isinstance(previous_ref, dict):
            # Pre-feature authored entities bootstrap their own canonical
            # mechanics as revision 1 before the incoming candidate is compared.
            previous_content = _npc_mechanics_revision_content(previous)
            _, active_content_sha256 = _write_npc_mechanics_revision_artifact(
                root, stable_id=stable_id, revision=1, content=previous_content,
            )
            active_revision = 1
        elif previous_is_authored and isinstance(previous_ref, dict):
            # Recover a crash after current projection but before head publish.
            prior_revision = previous_ref.get("revision")
            if (
                previous_ref.get("stable_id") != stable_id
                or isinstance(prior_revision, bool)
                or not isinstance(prior_revision, int)
                or prior_revision <= 0
            ):
                raise ModuleAssetsError("NPC mechanics revision ref is invalid")
            previous_content = _npc_mechanics_revision_content(previous)
            _, actual_previous_sha256 = _write_npc_mechanics_revision_artifact(
                root,
                stable_id=stable_id,
                revision=prior_revision,
                content=previous_content,
            )
            if previous_ref.get("content_sha256") != actual_previous_sha256:
                raise ModuleAssetsError("NPC mechanics immutable revision hash drift")
            active_revision = prior_revision
            active_content_sha256 = actual_previous_sha256

    content = _npc_mechanics_revision_content(doc)
    content_sha256 = _npc_mechanics_revision_digest(content)
    if active_revision > 0 and active_content_sha256 == content_sha256:
        revision = active_revision
        revision_path, _ = _write_npc_mechanics_revision_artifact(
            root, stable_id=stable_id, revision=revision, content=content,
        )
    else:
        revision = active_revision + 1
        revision_path, content_sha256 = _write_npc_mechanics_revision_artifact(
            root, stable_id=stable_id, revision=revision, content=content,
        )
    ref = {
        "stable_id": stable_id,
        "revision": revision,
        "content_sha256": content_sha256,
        "authority": "source_authored",
    }
    head_doc = {
        "schema_version": 1,
        "stable_id": stable_id,
        "active_revision": revision,
        "latest_revision": revision,
        "content_sha256": content_sha256,
        "revision_path": str(revision_path),
        "updated_at": _now_iso(),
    }
    return ref, (head_path, head_doc)


def classification_entity_catalog_snapshot(
    workspace: Path,
    asset_root_id: str,
) -> dict[str, Any]:
    """Return the bounded canonical identities available to section binding.

    This is intentionally a module-assets projection, not a heading heuristic:
    skeleton rosters and an already compiled opening pack are the only inputs.
    The digest is the durable version carried by the request and leaf packet.
    """
    skeleton = get_skeleton(workspace, asset_root_id) or {}
    identities: set[tuple[str, str]] = set()

    def add(kind: str, value: Any) -> None:
        if kind not in ENTITY_KINDS:
            return
        try:
            identities.add((kind, _require_id(value, "entity_catalog.id")))
        except ModuleAssetsError:
            return

    for kind, collection, field in (
        ("location", "locations", "location_id"),
        ("npc", "npc_roster", "npc_id"),
        ("item", "item_roster", "item_id"),
        ("handout", "handouts", "handout_id"),
        ("threat", "threats", "threat_id"),
    ):
        for row in skeleton.get(collection) or []:
            if isinstance(row, dict):
                add(kind, row.get(field))

    for opening_id in skeleton.get("start_candidates") or []:
        try:
            opening = get_entity(
                workspace, asset_root_id, "location", str(opening_id),
            )
        except (OSError, ValueError, ModuleAssetsError):
            continue
        if not isinstance(opening, dict):
            continue
        add("location", opening.get("location_id"))
        for clue_id in opening.get("available_clue_ids") or []:
            add("clue", clue_id)
        for clue in opening.get("clues") or []:
            if isinstance(clue, dict):
                add("clue", clue.get("clue_id"))
        for npc_id in opening.get("npc_ids") or []:
            add("npc", npc_id)
        for npc in opening.get("npcs") or []:
            if isinstance(npc, dict):
                add("npc", npc.get("npc_id"))

    entity_catalog = [
        {"kind": kind, "id": entity_id}
        for kind, entity_id in sorted(identities)
    ]
    if len(entity_catalog) > CLASSIFICATION_ENTITY_CATALOG_MAX:
        raise ModuleAssetsError("classification entity catalog exceeds its cap")
    encoded = json.dumps(
        entity_catalog, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
    ).encode("utf-8")
    return {
        "entity_catalog": entity_catalog,
        "entity_catalog_provenance": {
            "source": "canonical_module_assets",
            "version": CLASSIFICATION_ENTITY_CATALOG_PROVENANCE_VERSION,
            "catalog_sha256": hashlib.sha256(encoded).hexdigest(),
        },
    }


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
    doc = json.loads(path.read_text(encoding="utf-8"))
    if kind == "npc" and isinstance(doc.get("mechanics_revision_ref"), dict):
        ref = doc["mechanics_revision_ref"]
        stable_id = f"npc:{entity_id}:mechanics"
        revision = ref.get("revision")
        if (
            ref.get("stable_id") != stable_id
            or isinstance(revision, bool)
            or not isinstance(revision, int)
            or revision <= 0
        ):
            raise ModuleAssetsError("NPC mechanics revision ref is invalid")
        revision_root = path.parent / f"npc-{entity_id}-mechanics"
        head_path = revision_root / "head.json"
        revision_path = revision_root / "revisions" / f"{revision:06d}.json"
        if not head_path.is_file() or not revision_path.is_file():
            raise ModuleAssetsError("NPC mechanics active revision is missing")
        head = json.loads(head_path.read_text(encoding="utf-8"))
        stored = json.loads(revision_path.read_text(encoding="utf-8"))
        content = stored.get("content")
        encoded = json.dumps(
            content, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
        ).encode("utf-8")
        digest = hashlib.sha256(encoded).hexdigest()
        if (
            head.get("stable_id") != stable_id
            or not isinstance(head.get("active_revision"), int)
            or head.get("active_revision") != revision
            or head.get("content_sha256") != digest
            or not isinstance(head.get("latest_revision"), int)
            or head.get("latest_revision") < head.get("active_revision")
            or stored.get("stable_id") != stable_id
            or stored.get("revision") != revision
            or stored.get("content_sha256") != digest
            or digest != ref.get("content_sha256")
            or content != _npc_mechanics_revision_content(doc)
        ):
            raise ModuleAssetsError("NPC mechanics immutable revision hash drift")
    return doc


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
    body_source_scope: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Create named_only entity if missing; never overwrite deeper packs."""
    skeleton_scope = _skeleton_entity_source_scope(
        workspace, asset_root_id, kind, entity_id
    )
    inherited_indices: set[int] = set()
    for label, scope in (
        (f"{kind} skeleton scope", skeleton_scope),
        (f"{kind} mention scope", source_scope),
        (f"{kind} body locator scope", body_source_scope),
    ):
        if scope:
            inherited_indices.update(_source_indices(scope, field=label))
    body_source_indices = (
        _source_indices(body_source_scope, field=f"{kind} body locator scope")
        if body_source_scope
        else []
    )
    existing = get_entity(workspace, asset_root_id, kind, entity_id)
    if existing is not None:
        scope_updated = False
        if str(existing.get("parse_state") or "") in {"named_only", "toc_only"}:
            current_indices = set(_source_indices(existing, field=f"{kind} stub"))
            combined_indices = sorted(current_indices | inherited_indices)
            current_body_indices = list(
                existing.get("body_source_page_indices") or []
            )
            body_scope_changed = (
                bool(body_source_scope)
                and body_source_indices != current_body_indices
            )
            if combined_indices != sorted(current_indices) or body_scope_changed:
                enriched = json.loads(json.dumps(existing))
                # Let the cache rebuild canonical refs for the exact union.
                enriched["source_page_indices"] = combined_indices
                if body_source_scope:
                    enriched["body_source_page_indices"] = body_source_indices
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
    if body_source_scope:
        payload["body_source_page_indices"] = body_source_indices
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
    work_level: str | None = None,
    dependency_ref: dict[str, Any] | None = None,
    consumer_refs: list[dict[str, Any]] | None = None,
    kick_worker: bool = True,
    materialization_owner: str | None = None,
) -> dict[str, Any]:
    if kind not in JOB_KINDS:
        raise ModuleAssetsError(f"unknown job kind {kind!r}")
    tid = _require_id(target_id, "target_id")
    canonical_work_level, canonical_dependency_ref = validate_host_work_contract(
        work_level or _default_host_work_level(kind), dependency_ref,
    )
    canonical_consumer_refs = (
        validate_host_work_consumer_refs(consumer_refs)
        if consumer_refs is not None else None
    )
    canonical_materialization_owner = str(
        materialization_owner or ""
    ).strip() or None
    if canonical_materialization_owner is not None and (
        canonical_materialization_owner != "opening_bootstrap"
        or kind != "partial_opening"
        or canonical_work_level != "current_dependency"
        or kick_worker
    ):
        raise ModuleAssetsError(
            "caller-owned materialization is reserved for the blocking "
            "partial_opening/current_dependency bootstrap job"
        )
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

    def exact_dependency_matches(row: dict[str, Any]) -> bool:
        if canonical_work_level != "current_dependency":
            return True
        return (
            str(row.get("work_level") or "") == canonical_work_level
            and row.get("dependency_ref") == canonical_dependency_ref
        )

    def merge_consumers(row: dict[str, Any]) -> bool:
        if canonical_consumer_refs is None:
            return False
        existing_consumers = (
            validate_host_work_consumer_refs(row["consumer_refs"])
            if isinstance(row.get("consumer_refs"), list)
            and row.get("consumer_refs")
            else []
        )
        combined = validate_host_work_consumer_refs(
            [*existing_consumers, *canonical_consumer_refs]
        )
        if combined == existing_consumers:
            return False
        row["consumer_refs"] = combined
        return True

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
            pending_changed = False
            existing_level = str(
                job.get("work_level") or _default_host_work_level(
                    str(job.get("kind") or "")
                )
            )
            if canonical_work_level == "current_dependency":
                if existing_level == "current_dependency":
                    if job.get("dependency_ref") != canonical_dependency_ref:
                        raise ModuleAssetsError(
                            "host_work_dependency_conflict: pending work is bound "
                            "to another exact consumer"
                        )
                else:
                    job["work_level"] = canonical_work_level
                    job["dependency_ref"] = json.loads(
                        json.dumps(canonical_dependency_ref)
                    )
                    pending_changed = True
            if merge_consumers(job):
                pending_changed = True
            if canonical_materialization_owner is not None:
                existing_owner = str(
                    job.get("materialization_owner") or ""
                ).strip()
                if existing_owner not in {
                    "", canonical_materialization_owner,
                }:
                    raise ModuleAssetsError(
                        "caller_materialization_conflict: pending work has "
                        "another deterministic owner"
                    )
                if existing_owner != canonical_materialization_owner:
                    job["materialization_owner"] = (
                        canonical_materialization_owner
                    )
                    pending_changed = True
            if _job_depth(str(job.get("kind") or "")) < _job_depth(kind):
                job["promoted_from"] = job.get("kind")
                job["kind"] = kind
                job["priority"] = max(int(job.get("priority") or 0), int(priority))
                job["reason"] = str(reason or job.get("reason") or "")
                pending_changed = True
            if pending_changed:
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
                    and exact_dependency_matches(job)
                ):
                    if canonical_materialization_owner is not None and (
                        str(job.get("materialization_owner") or "").strip()
                        != canonical_materialization_owner
                    ):
                        raise ModuleAssetsError(
                            "caller_materialization_conflict: exact opening "
                            "work is already owned by another worker"
                        )
                    if exact_source_scope is not None and not exact_scoped_row_matches(job):
                        raise_exact_scope_conflict()
                    if merge_consumers(job):
                        queue["in_flight"] = list(queue.get("in_flight") or [])
                        _write_json(path, queue)
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
                        if not exact_dependency_matches(request):
                            continue
                        if not exact_scoped_row_matches(request):
                            raise_exact_scope_conflict()
                        if merge_consumers(row):
                            queue["done"] = list(queue.get("done") or [])
                            _write_json(path, queue)
                        deduped_job = row
                        dedupe_state = "awaiting_host_pack"
                        break
                    continue
                if (
                    kind == "full_parse"
                    and _same_entity_work(row, kind, tid)
                ):
                    # One full_parse job per module root, forever.  A
                    # completed parse returns without creating a second job.
                    # A terminally failed parse (or an abandoned open
                    # handoff) must never strand the lane: the enqueue
                    # creates a fresh retry job the worker can claim again
                    # (its bounded OCR failure accounting lives on the
                    # host-work request row, preserved across retries).
                    if row.get("result") == "complete":
                        deduped_job = row
                        dedupe_state = "done"
                        break
                    job_id = str(row.get("job_id") or "")
                    request_path = (
                        _module_dir(workspace, asset_root_id)
                        / "host-work"
                        / f"{job_id}.json"
                    )
                    request = {}
                    if request_path.is_file():
                        try:
                            loaded_request = json.loads(
                                request_path.read_text(encoding="utf-8")
                            )
                            if isinstance(loaded_request, dict):
                                request = loaded_request
                        except (OSError, json.JSONDecodeError):
                            request = {}
                    failed_row = (
                        row.get("failed") is True
                        or row.get("result") in {"failed", "error"}
                        or request.get("result") == "failed"
                    )
                    request_status = str(request.get("status") or "open")
                    if failed_row or request_status == "open":
                        deduped_job = None
                        dedupe_state = None
                        break
                    deduped_job = row
                    dedupe_state = "done"
                    break
                still_current = _host_request_still_current(
                    workspace,
                    asset_root_id,
                    row,
                    job_kind=kind,
                    target_id=tid,
                )
                if still_current:
                    if not exact_dependency_matches(row):
                        continue
                    if merge_consumers(row):
                        queue["done"] = list(queue.get("done") or [])
                        _write_json(path, queue)
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
                "work_level": canonical_work_level,
            }
            if canonical_dependency_ref is not None:
                job["dependency_ref"] = json.loads(
                    json.dumps(canonical_dependency_ref)
                )
            if canonical_consumer_refs is not None:
                job["consumer_refs"] = canonical_consumer_refs
            if canonical_materialization_owner is not None:
                job["materialization_owner"] = (
                    canonical_materialization_owner
                )
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
    if kind == "full_parse" and dedupe_state not in {"done", "awaiting_host_pack"}:
        update_full_parse_state(
            workspace,
            asset_root_id,
            status=(
                "queued"
                if dedupe_state in {None, "pending"}
                else "in_progress"
            ),
            job_id=str(job.get("job_id") or ""),
        )
    # Queue updates commit first, then host-work updates under its own lock.
    # Materialization performs the inverse *read* while holding host-work.lock,
    # but enqueue never nests these locks, so no cyclic lock ordering exists.
    if (
        dedupe_state in {"in_flight", "awaiting_host_pack"}
        and canonical_consumer_refs is not None
    ):
        request_path = (
            _module_dir(workspace, asset_root_id)
            / "host-work" / f"{job.get('job_id')}.json"
        )
        with coc_fileio.advisory_file_lock(
            _module_dir(workspace, asset_root_id) / "host-work.lock"
        ):
            if request_path.is_file():
                request = json.loads(request_path.read_text(encoding="utf-8"))
                existing_consumers = (
                    validate_host_work_consumer_refs(request["consumer_refs"])
                    if isinstance(request.get("consumer_refs"), list)
                    and request.get("consumer_refs")
                    else []
                )
                request["consumer_refs"] = validate_host_work_consumer_refs(
                    [*existing_consumers, *canonical_consumer_refs]
                )
                request["consumer_state"] = "owned"
                _sync_host_work_dispatch_state(request)
                _write_json(request_path, request)
    pending_supersedes = list(job.get("supersedes_host_job_ids") or [])
    # Non-blocking: dig/enter must not wait on host PDF. Background worker
    # claims pending jobs in parallel and merges ready packs.
    kick: dict[str, Any] | None = None
    if dedupe_state == "awaiting_host_pack":
        kick = {"started": False, "reason": "host_request_already_open"}
    elif dedupe_state == "done":
        kick = {"started": False, "reason": "full_parse_already_complete"}
    elif not kick_worker:
        kick = {"started": False, "reason": "caller_owns_materialization"}
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
