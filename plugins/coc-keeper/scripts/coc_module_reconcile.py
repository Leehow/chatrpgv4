#!/usr/bin/env python3
"""Cross-section reconciliation: the one judgement deterministic merge cannot make.

Merging a parsed module is otherwise mechanical — each pack knows its own
entity and page, and the repository folds it in field by field.  One question
resists that treatment: whether two things named in different parts of a book
are the same thing.

It shows up in every scenario surveyed.  Nine of eleven keep their stat blocks
in a back section: the innkeeper described on page 7 and the ``DR. HAMILTON
FABRY`` block on page 21 are one person, and nothing in either page says so.
Endings live in their own section and refer to scenes by prose description
rather than id.  Deterministic code cannot resolve those without guessing, and
guessing wrong silently fuses two characters or splits one in half.

So this pass exists, and it is deliberately the narrowest agent in the system:

* It sees identifiers, titles, page numbers and labels — never section bodies.
  Reconciliation is a question about names and positions; giving it the prose
  would let it start reasoning about content it has no authority over.
* It emits mappings and conflicts, and nothing else.  It cannot create an
  entity, rename one, write prose, or change a label.  Every mapping names two
  things that already exist, and the repository re-checks both ends.
* Ambiguity becomes a recorded conflict, never a silent choice.  Two plausible
  matches is information the Keeper can act on; one arbitrary match is a
  fabrication that never surfaces again.
"""
from __future__ import annotations

import json
import re
from typing import Any

SCHEMA_VERSION = 1
CONTRACT_ID = "coc.section-reconciliation.v1"
REQUEST_CONTRACT_ID = "coc.section-reconciliation-request.v1"
RECONCILE_JOB_KIND = "reconcile_sections"
RECONCILE_PURPOSE = "cross_section_reconciliation"

# What a mapping may assert.  Each is a claim of identity or attachment
# between two existing records, never a new record.
MAPPING_KINDS = frozenset({
    # A back-section stat block and an in-body character are one person.
    "stats_for_entity",
    # A section documents an ending/outcome that belongs to a known scene.
    "resolution_for_scene",
    # A handout or pregen belongs with a known entity or scene.
    "handout_for_scene",
    # Two indexed sections are continuations of one authored section.
    "section_continues",
})
CONFLICT_KINDS = frozenset({
    "ambiguous_match", "conflicting_stats", "orphan_section", "duplicate_claim",
})
REVIEW_STATES = frozenset({"needs_review", "accepted"})
MAX_MAPPINGS = 400
MAX_CONFLICTS = 200
NOTE_MAX_CHARS = 200

_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")


class ReconciliationError(ValueError):
    """A reconciliation request or result violates its contract."""


def _text(value: Any) -> str:
    return " ".join(str(value or "").split())


def _require_id(value: Any, field: str) -> str:
    text = str(value or "").strip()
    if not _ID.match(text):
        raise ReconciliationError(f"{field} is not a valid id")
    return text


def build_reconciliation_request(
    *,
    index: dict[str, Any],
    skeleton: dict[str, Any],
    scenes: list[dict[str, Any]] | None = None,
    job_id: str,
) -> dict[str, Any]:
    """Project identifiers and positions only — never section bodies."""
    if not isinstance(index, dict):
        raise ReconciliationError("section index must be an object")
    sections = [
        {
            "section_id": row.get("section_id"),
            "title": row.get("title"),
            "pdf_indices": list(row.get("pdf_indices") or []),
            "audience": row.get("audience"),
            "timing": row.get("timing"),
            "payload": row.get("payload"),
            "pack_kind": row.get("pack_kind"),
            "binding": row.get("binding"),
            "parse_state": row.get("parse_state"),
        }
        for row in index.get("sections") or []
        if isinstance(row, dict)
    ]
    if not sections:
        raise ReconciliationError("section index has no sections to reconcile")
    skeleton = skeleton if isinstance(skeleton, dict) else {}
    known_npcs = [
        {
            "npc_id": row.get("npc_id"),
            "names": list(row.get("names") or []),
            "source_page_indices": list(row.get("source_page_indices") or []),
        }
        for row in skeleton.get("npc_roster") or []
        if isinstance(row, dict) and row.get("npc_id")
    ]
    known_items = [
        {
            "item_id": row.get("item_id"),
            "label": row.get("label") or row.get("title"),
            "source_page_indices": list(row.get("source_page_indices") or []),
        }
        for row in skeleton.get("item_roster") or []
        if isinstance(row, dict) and row.get("item_id")
    ]
    known_locations = [
        {
            "location_id": row.get("location_id"),
            "title": row.get("title"),
            "source_page_indices": list(row.get("source_page_indices") or []),
        }
        for row in skeleton.get("locations") or []
        if isinstance(row, dict) and row.get("location_id")
    ]
    known_scenes = [
        {"scene_id": row.get("scene_id"), "title": row.get("title")}
        for row in (scenes or [])
        if isinstance(row, dict) and row.get("scene_id")
    ]
    return {
        "schema_version": SCHEMA_VERSION,
        "contract_id": REQUEST_CONTRACT_ID,
        "job_id": str(job_id),
        "request_purpose": RECONCILE_PURPOSE,
        "source_id": str(index.get("source_id") or ""),
        "file_sha256": str(index.get("file_sha256") or ""),
        "sections": sections,
        "known_npcs": known_npcs,
        "known_items": known_items,
        "known_locations": known_locations,
        "known_scenes": known_scenes,
        "result_contract": {
            "contract_id": CONTRACT_ID,
            "mapping_kinds": sorted(MAPPING_KINDS),
            "conflict_kinds": sorted(CONFLICT_KINDS),
            "mapping_template": {
                "kind": "stats_for_entity",
                "section_id": "<existing section_id>",
                "target_kind": "npc",
                "target_id": "<existing npc_id>",
                "confidence": "high",
                "note": "",
            },
            "conflict_template": {
                "kind": "ambiguous_match",
                "section_id": "<existing section_id>",
                "candidate_ids": [],
                "note": "",
            },
            "rules": [
                "Both ends of every mapping must already exist in this "
                "request; never introduce an id.",
                "Emit no prose, summary, or section content of any kind.",
                "When two targets are equally plausible, emit a conflict "
                "listing both rather than choosing one.",
                "A section that matches nothing is an orphan_section conflict, "
                "not a forced mapping.",
            ],
        },
    }


def _known_ids(request: dict[str, Any]) -> dict[str, set[str]]:
    return {
        "npc": {
            str(row.get("npc_id")) for row in request.get("known_npcs") or []
        },
        "item": {
            str(row.get("item_id")) for row in request.get("known_items") or []
        },
        "location": {
            str(row.get("location_id"))
            for row in request.get("known_locations") or []
        },
        "scene": {
            str(row.get("scene_id")) for row in request.get("known_scenes") or []
        },
        "section": {
            str(row.get("section_id")) for row in request.get("sections") or []
        },
    }


_MAPPING_TARGETS = {
    "stats_for_entity": ("npc", "item"),
    "resolution_for_scene": ("scene",),
    "handout_for_scene": ("scene", "npc", "location"),
    "section_continues": ("section",),
}


def validate_reconciliation(
    result: Any,
    *,
    request: dict[str, Any],
) -> dict[str, Any]:
    """Validate mappings and conflicts against the exact request."""
    if not isinstance(result, dict):
        raise ReconciliationError("reconciliation result must be an object")
    extra = set(result) - {"mappings", "conflicts"}
    if extra:
        raise ReconciliationError(
            f"reconciliation result has unsupported fields: {sorted(extra)}"
        )
    known = _known_ids(request)
    mappings = result.get("mappings")
    conflicts = result.get("conflicts")
    if mappings is None:
        mappings = []
    if conflicts is None:
        conflicts = []
    if not isinstance(mappings, list) or not isinstance(conflicts, list):
        raise ReconciliationError("mappings and conflicts must be lists")
    if len(mappings) > MAX_MAPPINGS or len(conflicts) > MAX_CONFLICTS:
        raise ReconciliationError("reconciliation result exceeds its caps")

    seen: set[tuple[str, str, str]] = set()
    validated_mappings: list[dict[str, Any]] = []
    for index, row in enumerate(mappings):
        prefix = f"mappings[{index}]"
        if not isinstance(row, dict):
            raise ReconciliationError(f"{prefix} must be an object")
        allowed_fields = {
            "kind", "section_id", "target_kind", "target_id", "confidence", "note",
        }
        if set(row) - allowed_fields:
            raise ReconciliationError(
                f"{prefix} has unsupported fields: {sorted(set(row) - allowed_fields)}"
            )
        kind = str(row.get("kind") or "")
        if kind not in MAPPING_KINDS:
            raise ReconciliationError(f"{prefix}.kind invalid")
        section_id = _require_id(row.get("section_id"), f"{prefix}.section_id")
        if section_id not in known["section"]:
            raise ReconciliationError(
                f"{prefix}.section_id {section_id!r} is not in this request"
            )
        target_kind = str(row.get("target_kind") or "")
        if target_kind not in _MAPPING_TARGETS[kind]:
            raise ReconciliationError(
                f"{prefix}.target_kind {target_kind!r} is invalid for {kind}"
            )
        target_id = _require_id(row.get("target_id"), f"{prefix}.target_id")
        if target_id not in known[target_kind]:
            raise ReconciliationError(
                f"{prefix}.target_id {target_id!r} does not exist; "
                "reconciliation may not introduce records"
            )
        if kind == "section_continues" and target_id == section_id:
            raise ReconciliationError(f"{prefix} maps a section to itself")
        confidence = str(row.get("confidence") or "")
        if confidence not in {"low", "med", "high"}:
            raise ReconciliationError(f"{prefix}.confidence invalid")
        note = _text(row.get("note"))
        if len(note) > NOTE_MAX_CHARS:
            raise ReconciliationError(f"{prefix}.note is too long")
        identity = (kind, section_id, target_id)
        if identity in seen:
            raise ReconciliationError(f"{prefix} duplicates an earlier mapping")
        seen.add(identity)
        validated_mappings.append({
            "kind": kind,
            "section_id": section_id,
            "target_kind": target_kind,
            "target_id": target_id,
            "confidence": confidence,
            "note": note,
            # Nothing this pass produces is canonical on arrival.  A low or
            # medium match is a suggestion for the Keeper, not a merge.
            "review_state": "accepted" if confidence == "high" else "needs_review",
        })

    validated_conflicts: list[dict[str, Any]] = []
    for index, row in enumerate(conflicts):
        prefix = f"conflicts[{index}]"
        if not isinstance(row, dict):
            raise ReconciliationError(f"{prefix} must be an object")
        allowed_fields = {"kind", "section_id", "candidate_ids", "note"}
        if set(row) - allowed_fields:
            raise ReconciliationError(
                f"{prefix} has unsupported fields: {sorted(set(row) - allowed_fields)}"
            )
        kind = str(row.get("kind") or "")
        if kind not in CONFLICT_KINDS:
            raise ReconciliationError(f"{prefix}.kind invalid")
        section_id = _require_id(row.get("section_id"), f"{prefix}.section_id")
        if section_id not in known["section"]:
            raise ReconciliationError(
                f"{prefix}.section_id {section_id!r} is not in this request"
            )
        candidates = row.get("candidate_ids") or []
        if not isinstance(candidates, list):
            raise ReconciliationError(f"{prefix}.candidate_ids must be a list")
        every_known = set().union(*known.values())
        for candidate in candidates:
            if str(candidate) not in every_known:
                raise ReconciliationError(
                    f"{prefix}.candidate_ids names unknown {candidate!r}"
                )
        if kind == "ambiguous_match" and len(candidates) < 2:
            raise ReconciliationError(
                f"{prefix} claims ambiguity with fewer than two candidates"
            )
        note = _text(row.get("note"))
        if len(note) > NOTE_MAX_CHARS:
            raise ReconciliationError(f"{prefix}.note is too long")
        validated_conflicts.append({
            "kind": kind,
            "section_id": section_id,
            "candidate_ids": [str(value) for value in candidates],
            "note": note,
            "review_state": "needs_review",
        })

    return {
        "schema_version": SCHEMA_VERSION,
        "contract_id": CONTRACT_ID,
        "source_id": str(request.get("source_id") or ""),
        "file_sha256": str(request.get("file_sha256") or ""),
        "mappings": validated_mappings,
        "conflicts": validated_conflicts,
        "accepted_count": sum(
            1 for row in validated_mappings if row["review_state"] == "accepted"
        ),
        "needs_review_count": sum(
            1 for row in validated_mappings if row["review_state"] == "needs_review"
        ) + len(validated_conflicts),
    }


def apply_to_section_index(
    index: dict[str, Any], reconciliation: dict[str, Any],
) -> dict[str, Any]:
    """Attach accepted mappings to their sections without rewriting content.

    Only the link is recorded.  Section bodies, labels and page bindings are
    untouched, so a wrong mapping is a wrong pointer the Keeper can drop, never
    a corrupted section.
    """
    out = json.loads(json.dumps(index))
    by_section: dict[str, list[dict[str, Any]]] = {}
    for row in reconciliation.get("mappings") or []:
        by_section.setdefault(row["section_id"], []).append(row)
    conflicts_by_section: dict[str, list[dict[str, Any]]] = {}
    for row in reconciliation.get("conflicts") or []:
        conflicts_by_section.setdefault(row["section_id"], []).append(row)
    for section in out.get("sections") or []:
        if not isinstance(section, dict):
            continue
        section_id = str(section.get("section_id") or "")
        links = by_section.get(section_id)
        if links:
            section["links"] = [
                {
                    "kind": row["kind"],
                    "target_kind": row["target_kind"],
                    "target_id": row["target_id"],
                    "confidence": row["confidence"],
                    "review_state": row["review_state"],
                }
                for row in links
            ]
        issues = conflicts_by_section.get(section_id)
        if issues:
            section["conflicts"] = [
                {
                    "kind": row["kind"],
                    "candidate_ids": row["candidate_ids"],
                    "note": row["note"],
                }
                for row in issues
            ]
    out["reconciliation"] = {
        "accepted_count": reconciliation.get("accepted_count", 0),
        "needs_review_count": reconciliation.get("needs_review_count", 0),
    }
    return out
