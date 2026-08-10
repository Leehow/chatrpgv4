#!/usr/bin/env python3
"""Whole-book section index: the demand map for on-demand module parsing.

Why this exists
---------------
The progressive parser reaches module content by walking location edges.  A
survey of eleven published scenarios shows that is structurally insufficient:
nine of them keep their NPC stat blocks in a separate back section or appendix
with no edge pointing at it, all eleven open with a Keeper-truth section the
location graph never touches, and eight ship pregenerated investigators that
no scene references.  Without a whole-book index those pages are unreachable
no matter how good the per-page extractor is.

Why classification is its own lane
----------------------------------
Section identity is a global judgement, not a page-local one.  "Appendix A" is
player handout cards in one module and an NPC roster in another; the only way
to tell is the shape of the whole document.  A worker restricted to a one-to-
three page window cannot see that, so this lane takes the deterministic
outline (see :mod:`coc_source_outline`) plus bounded per-heading previews in a
single low-resolution pass instead.  The packet that carries them is built by
:mod:`coc_module_section_requests`; this module owns the answer side.

What the vocabulary is and is not
---------------------------------
The four label dimensions below are an output *schema* — the closed vocabulary
a classifier writes into.  They are not a classifier: nothing in this module
inspects titles, matches words, or decides what a section is.  Deciding is the
model's job; validating that the answer is well formed and provably bound to
this exact source is this module's job.
"""
from __future__ import annotations

import hashlib
import json
import re
from typing import Any

SCHEMA_VERSION = 1
CONTRACT_ID = "coc.section-index.v1"
REQUEST_CONTRACT_ID = "coc.section-classification-request.v1"
CLASSIFY_JOB_KIND = "classify_sections"
CLASSIFY_PURPOSE = "whole_book_section_pass"

# Who may see the content.  Drives whether a section can ever reach a
# player-facing surface.
AUDIENCES = frozenset({"keeper_only", "player_facing", "mixed"})
# When the content is needed.  Drives which deadline lane resolves it.
TIMINGS = frozenset({"pre_session", "opening", "on_demand", "resolution"})
# What shape the content has.  Drives which pack schema extracts it.
PAYLOADS = frozenset({
    "narrative", "entity_stats", "procedure", "table", "handout",
    "character_sheet", "setting_lore",
})
# What the content attaches to.
BINDING_KINDS = frozenset({"global", "entity"})
BINDING_ENTITY_KINDS = frozenset({
    "location", "npc", "item", "clue", "handout", "threat",
})
CONFIDENCE = frozenset({"low", "med", "high"})
SECTION_STATES = frozenset({"indexed", "resolved", "not_needed", "failed"})

PASS_STATUSES = frozenset({"pending", "complete"})

# Preview budgets for the classification request.  CJK bodies cost roughly
# three bytes per character, so budgets are byte counts, not lengths.  A page
# is previewed once no matter how many headings it carries: repeating the same
# page body under every subhead spends the budget on duplicates rather than on
# reach.  When a source has more headings than the budget affords, previews
# shrink rather than the outline being truncated — a heading with no preview is
# still classifiable from its title and position, but a heading dropped from
# the packet is unreachable for the rest of the campaign.
PREVIEW_MAX_BYTES = 240
PREVIEW_MIN_BYTES = 48
REQUEST_MAX_BYTES = 96_000
MAX_SECTIONS = 800
MAX_ENTITY_CATALOG = 800

_SECTION_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$")
_ENTITY_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_HEX = frozenset("0123456789abcdef")


class SectionIndexError(ValueError):
    """A section index or classification request violates its contract."""


def _require_sha256(value: Any, field: str) -> str:
    text = value if isinstance(value, str) else ""
    if len(text) != 64 or any(char not in _HEX for char in text):
        raise SectionIndexError(f"{field} must be a lowercase SHA-256 digest")
    return text


def section_id_for(order: int) -> str:
    return f"sec-{int(order):06d}"


# --------------------------------------------------------------------------
# Request projection: outline -> one bounded whole-book classification packet
# --------------------------------------------------------------------------

# --------------------------------------------------------------------------
# Result validation
# --------------------------------------------------------------------------

def _validate_binding(
    value: Any,
    *,
    prefix: str,
    entity_catalog: dict[str, set[str]] | None = None,
) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise SectionIndexError(f"{prefix}.binding must be an object")
    kind = str(value.get("kind") or "")
    if kind not in BINDING_KINDS:
        raise SectionIndexError(f"{prefix}.binding.kind invalid")
    entity_kind = value.get("entity_kind")
    entity_ids = value.get("entity_ids")
    if entity_ids is None:
        entity_ids = []
    if not isinstance(entity_ids, list) or any(
        not isinstance(item, str) or not item.strip() for item in entity_ids
    ):
        raise SectionIndexError(f"{prefix}.binding.entity_ids must be id strings")
    if kind == "global":
        if entity_kind is not None or entity_ids:
            raise SectionIndexError(
                f"{prefix}.binding global must not name an entity"
            )
    else:
        if entity_kind not in BINDING_ENTITY_KINDS:
            raise SectionIndexError(f"{prefix}.binding.entity_kind invalid")
        if not entity_ids:
            raise SectionIndexError(
                f"{prefix}.binding entity requires at least one entity id"
            )
        if entity_catalog is not None and any(
            entity_id.strip() not in entity_catalog.get(str(entity_kind), set())
            for entity_id in entity_ids
        ):
            raise SectionIndexError(
                f"{prefix}.binding entity_ids must come from request entity_catalog"
            )
    return {
        "kind": kind,
        "entity_kind": entity_kind if kind == "entity" else None,
        "entity_ids": [item.strip() for item in entity_ids],
    }


def validate_section_rows(
    rows: Any,
    *,
    request: dict[str, Any],
) -> list[dict[str, Any]]:
    """Validate classifier output against the exact request that produced it.

    Every row must name a candidate this request offered and select pages the
    request declared, so a classifier cannot invent a section, retarget one at
    a foreign page, or smuggle source prose back through the label channel.
    """
    if not isinstance(rows, list):
        raise SectionIndexError("section rows must be a list")
    if len(rows) > MAX_SECTIONS:
        raise SectionIndexError("section rows exceed the section cap")
    candidates = {
        str(row["section_id"]): row
        for row in request.get("candidates") or []
        if isinstance(row, dict) and row.get("section_id")
    }
    catalog_rows = request.get("entity_catalog") or []
    if not isinstance(catalog_rows, list) or len(catalog_rows) > MAX_ENTITY_CATALOG:
        raise SectionIndexError("request.entity_catalog invalid")
    entity_catalog: dict[str, set[str]] = {}
    for index, catalog_row in enumerate(catalog_rows):
        if not isinstance(catalog_row, dict) or set(catalog_row) != {"kind", "id"}:
            raise SectionIndexError(f"request.entity_catalog[{index}] invalid")
        kind = str(catalog_row.get("kind") or "")
        entity_id = str(catalog_row.get("id") or "").strip()
        if kind not in BINDING_ENTITY_KINDS or not _ENTITY_ID.match(entity_id):
            raise SectionIndexError(f"request.entity_catalog[{index}] invalid")
        known = entity_catalog.setdefault(kind, set())
        if entity_id in known:
            raise SectionIndexError(f"request.entity_catalog[{index}] duplicated")
        known.add(entity_id)
    page_count = int(request.get("page_count") or 0)
    seen: set[str] = set()
    validated: list[dict[str, Any]] = []
    for index, row in enumerate(rows):
        prefix = f"sections[{index}]"
        if not isinstance(row, dict):
            raise SectionIndexError(f"{prefix} must be an object")
        section_id = str(row.get("section_id") or "")
        if not _SECTION_ID.match(section_id):
            raise SectionIndexError(f"{prefix}.section_id malformed")
        candidate = candidates.get(section_id)
        if candidate is None:
            raise SectionIndexError(
                f"{prefix}.section_id {section_id!r} was not offered by this request"
            )
        if section_id in seen:
            raise SectionIndexError(f"{prefix}.section_id duplicated")
        seen.add(section_id)
        if str(row.get("title") or "") != str(candidate.get("title") or ""):
            raise SectionIndexError(
                f"{prefix}.title does not match the offered candidate title"
            )
        indices = row.get("pdf_indices")
        if (
            not isinstance(indices, list)
            or not indices
            or any(
                isinstance(value, bool) or not isinstance(value, int)
                for value in indices
            )
        ):
            raise SectionIndexError(f"{prefix}.pdf_indices must be a page list")
        pages = sorted({int(value) for value in indices})
        if pages[0] != int(candidate.get("pdf_index") or 0):
            raise SectionIndexError(
                f"{prefix}.pdf_indices must start at the candidate heading page"
            )
        if pages != list(range(pages[0], pages[0] + len(pages))):
            raise SectionIndexError(f"{prefix}.pdf_indices must be contiguous")
        if page_count and pages[-1] > page_count:
            raise SectionIndexError(f"{prefix}.pdf_indices exceed the page count")
        for field, allowed in (
            ("audience", AUDIENCES),
            ("timing", TIMINGS),
            ("payload", PAYLOADS),
            ("confidence", CONFIDENCE),
        ):
            if str(row.get(field) or "") not in allowed:
                raise SectionIndexError(f"{prefix}.{field} invalid")
        extra = set(row) - {
            "section_id", "title", "pdf_indices", "audience", "timing",
            "payload", "binding", "confidence",
        }
        if extra:
            raise SectionIndexError(
                f"{prefix} has unsupported fields: {sorted(extra)}"
            )
        validated.append({
            "section_id": section_id,
            "title": str(candidate.get("title") or ""),
            "pdf_indices": pages,
            "audience": str(row["audience"]),
            "timing": str(row["timing"]),
            "payload": str(row["payload"]),
            "binding": _validate_binding(
                row.get("binding"), prefix=prefix,
                entity_catalog=entity_catalog,
            ),
            "confidence": str(row["confidence"]),
            "parse_state": "indexed",
        })
    validated.sort(key=lambda item: (item["pdf_indices"][0], item["section_id"]))
    return validated


def section_index_digest(rows: list[dict[str, Any]], outline_sha256: str) -> str:
    material = json.dumps(
        {"outline_sha256": outline_sha256, "rows": rows},
        ensure_ascii=False, sort_keys=True, separators=(",", ":"),
    )
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def build_section_index(
    *,
    rows: list[dict[str, Any]],
    request: dict[str, Any],
) -> dict[str, Any]:
    validated = validate_section_rows(rows, request=request)
    if (
        not request.get("entity_catalog")
        and validated
        and all(row["binding"]["kind"] == "global" for row in validated)
    ):
        raise SectionIndexError(
            "section classification cannot complete with an empty entity catalog"
        )
    outline_sha256 = _require_sha256(
        request.get("outline_sha256"), "request.outline_sha256",
    )
    return {
        "schema_version": SCHEMA_VERSION,
        "contract_id": CONTRACT_ID,
        "source_id": str(request.get("source_id") or ""),
        "file_sha256": _require_sha256(
            request.get("file_sha256"), "request.file_sha256",
        ),
        "outline_sha256": outline_sha256,
        "outline_producer": str(request.get("outline_producer") or ""),
        "page_count": int(request.get("page_count") or 0),
        "pass_status": "complete",
        "candidate_count": len(request.get("candidates") or []),
        "sections": validated,
        "section_index_sha256": section_index_digest(validated, outline_sha256),
    }


def coverage_ledger(index: dict[str, Any]) -> dict[str, Any]:
    """Which pages any section claims, and which the index never reached.

    ``full_parse`` completing means every page was rendered, not that every
    page was understood.  This is the separate, honest answer to "what is
    still unaccounted for in this book".
    """
    page_count = int(index.get("page_count") or 0)
    claimed: set[int] = set()
    by_state: dict[str, int] = {}
    for section in index.get("sections") or []:
        if not isinstance(section, dict):
            continue
        claimed.update(int(value) for value in section.get("pdf_indices") or [])
        state = str(section.get("parse_state") or "indexed")
        by_state[state] = by_state.get(state, 0) + 1
    unclaimed = [
        page for page in range(1, page_count + 1) if page not in claimed
    ]
    return {
        "schema_version": SCHEMA_VERSION,
        "page_count": page_count,
        "claimed_page_count": len(claimed),
        "unclaimed_pdf_indices": unclaimed,
        "section_count": sum(by_state.values()),
        "sections_by_state": by_state,
        "coverage_ratio": (
            round(len(claimed) / page_count, 4) if page_count else 0.0
        ),
    }


def build_classification_request(**kwargs: Any) -> dict[str, Any]:
    """Re-export: the projection itself lives in the requests module."""
    from coc_module_section_requests import build_classification_request as impl

    return impl(**kwargs)


def build_classification_requests(**kwargs: Any) -> list[dict[str, Any]]:
    """Re-export: the projection itself lives in the requests module."""
    from coc_module_section_requests import build_classification_requests as impl

    return impl(**kwargs)
