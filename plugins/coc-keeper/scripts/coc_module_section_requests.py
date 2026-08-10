#!/usr/bin/env python3
"""Projection of a deterministic outline into a section-classification packet.

Splitting this from :mod:`coc_module_sections` keeps the two directions of the
contract apart: this module decides what a classifier is *allowed to see*, and
that module decides what it is *allowed to say*.

The packet carries headings, page numbers and short per-page previews — never
full page bodies.  Widening it would recreate the page-window lane this pass
exists to replace, and the whole reason the pass is worth a separate lane is
that section identity is a global judgement: the same appendix title means
player handouts in one module and an NPC roster in another, and only the shape
of the whole document distinguishes them.
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from coc_module_sections import (  # noqa: E402
    AUDIENCES,
    BINDING_ENTITY_KINDS,
    BINDING_KINDS,
    CLASSIFY_PURPOSE,
    CONFIDENCE,
    CONTRACT_ID,
    MAX_ENTITY_CATALOG,
    MAX_SECTIONS,
    PAYLOADS,
    PREVIEW_MAX_BYTES,
    PREVIEW_MIN_BYTES,
    REQUEST_CONTRACT_ID,
    REQUEST_MAX_BYTES,
    SCHEMA_VERSION,
    TIMINGS,
    SectionIndexError,
    _ENTITY_ID,
    _require_sha256,
    section_id_for,
)


def _clip_bytes(text: str, limit: int) -> str:
    raw = " ".join(str(text or "").split()).encode("utf-8")
    if len(raw) <= limit:
        return raw.decode("utf-8")
    return raw[:limit].decode("utf-8", errors="ignore")



def _preview_budget(
    candidates: list[dict[str, Any]],
    *,
    preview_pages: list[int],
    ceiling: int,
) -> int:
    """Per-page preview size that keeps the whole packet inside its cap.

    Returns zero when even the minimum preview would not fit; the packet then
    carries titles and positions only, which still classifies most sections
    and always beats dropping headings to make room.
    """
    if not preview_pages:
        return 0
    skeleton = len(json.dumps(
        [{**row, "preview": ""} for row in candidates], ensure_ascii=False,
    ).encode("utf-8"))
    # Leave headroom for the envelope and result contract around candidates.
    spare = REQUEST_MAX_BYTES - skeleton - 4_096
    if spare <= 0:
        return 0
    per_page = spare // len(preview_pages)
    if per_page < PREVIEW_MIN_BYTES:
        return 0
    return min(ceiling, per_page)



def build_classification_request(
    *,
    outline: dict[str, Any],
    page_previews: dict[int, str],
    accepted_pdf_indices: list[int],
    job_id: str,
    entity_catalog: list[dict[str, Any]] | None = None,
    entity_catalog_provenance: dict[str, Any] | None = None,
    preview_max_bytes: int = PREVIEW_MAX_BYTES,
    chunk: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Project a deterministic outline into the classifier's only input.

    The packet carries headings, page numbers and short previews — never full
    page bodies.  A classifier that cannot answer from this must abstain
    rather than ask for the book, because widening the window here would
    recreate the per-page lane this pass exists to avoid.
    """
    if not isinstance(outline, dict):
        raise SectionIndexError("outline must be an object")
    rows = outline.get("rows")
    if not isinstance(rows, list) or not rows:
        raise SectionIndexError("outline has no heading rows to classify")
    if len(rows) > MAX_SECTIONS:
        raise SectionIndexError(
            f"outline has {len(rows)} headings, over the {MAX_SECTIONS} cap"
        )
    catalog = entity_catalog or []
    if not isinstance(catalog, list) or len(catalog) > MAX_ENTITY_CATALOG:
        raise SectionIndexError("entity_catalog exceeds the bounded catalog cap")
    normalized_catalog: list[dict[str, str]] = []
    seen_catalog: set[tuple[str, str]] = set()
    for index, entry in enumerate(catalog):
        if not isinstance(entry, dict) or set(entry) != {"kind", "id"}:
            raise SectionIndexError(f"entity_catalog[{index}] must contain kind and id")
        kind = str(entry.get("kind") or "")
        entity_id = str(entry.get("id") or "").strip()
        if kind not in BINDING_ENTITY_KINDS or not _ENTITY_ID.match(entity_id):
            raise SectionIndexError(f"entity_catalog[{index}] is invalid")
        key = (kind, entity_id)
        if key in seen_catalog:
            raise SectionIndexError(f"entity_catalog[{index}] is duplicated")
        seen_catalog.add(key)
        normalized_catalog.append({"kind": kind, "id": entity_id})
    normalized_catalog.sort(key=lambda entry: (entry["kind"], entry["id"]))
    normalized_provenance: dict[str, Any] | None = None
    if entity_catalog_provenance is not None:
        if (
            not isinstance(entity_catalog_provenance, dict)
            or set(entity_catalog_provenance) != {
                "source", "version", "catalog_sha256",
            }
            or not isinstance(entity_catalog_provenance.get("source"), str)
            or not entity_catalog_provenance["source"].strip()
            or isinstance(entity_catalog_provenance.get("version"), bool)
            or not isinstance(entity_catalog_provenance.get("version"), int)
            or entity_catalog_provenance["version"] < 1
        ):
            raise SectionIndexError("entity_catalog_provenance is invalid")
        catalog_sha256 = hashlib.sha256(json.dumps(
            normalized_catalog, ensure_ascii=False, sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")).hexdigest()
        if entity_catalog_provenance.get("catalog_sha256") != catalog_sha256:
            raise SectionIndexError("entity_catalog_provenance digest drift")
        normalized_provenance = {
            "source": entity_catalog_provenance["source"].strip(),
            "version": entity_catalog_provenance["version"],
            "catalog_sha256": catalog_sha256,
        }
    chunk = dict(chunk or {"index": 1, "count": 1, "page_from": 1, "page_to": 0})
    file_sha256 = _require_sha256(outline.get("file_sha256"), "outline.file_sha256")
    outline_sha256 = _require_sha256(
        outline.get("outline_sha256"), "outline.outline_sha256",
    )
    accepted = sorted({int(value) for value in accepted_pdf_indices})
    accepted_set = set(accepted)
    candidates: list[dict[str, Any]] = []
    preview_pages: list[int] = []
    for row in rows:
        if not isinstance(row, dict):
            raise SectionIndexError("outline rows must be objects")
        pdf_index = int(row.get("pdf_index") or 0)
        first_on_page = pdf_index not in preview_pages
        if first_on_page and page_previews.get(pdf_index):
            preview_pages.append(pdf_index)
        candidates.append({
            "section_id": section_id_for(row.get("order") or len(candidates) + 1),
            "title": str(row.get("text") or ""),
            "pdf_index": pdf_index,
            "size_rank": int(row.get("size_rank") or 0),
            "emphasis": bool(row.get("emphasis")),
            "page_cached": pdf_index in accepted_set,
            "preview": "",
            "_preview_owner": first_on_page,
        })
    budget = _preview_budget(
        candidates,
        preview_pages=preview_pages,
        ceiling=preview_max_bytes,
    )
    for candidate in candidates:
        owns = candidate.pop("_preview_owner")
        if owns and budget > 0:
            candidate["preview"] = _clip_bytes(
                page_previews.get(candidate["pdf_index"], ""), budget,
            )
    request = {
        "schema_version": SCHEMA_VERSION,
        "contract_id": REQUEST_CONTRACT_ID,
        "job_id": str(job_id),
        "request_purpose": CLASSIFY_PURPOSE,
        "source_id": str(outline.get("source_id") or ""),
        "file_sha256": file_sha256,
        "outline_sha256": outline_sha256,
        "outline_producer": str(outline.get("producer") or ""),
        "outline_confidence_class": str(outline.get("confidence_class") or ""),
        "page_count": int(outline.get("page_count") or 0),
        "accepted_pdf_indices": accepted,
        "entity_catalog": normalized_catalog,
        **({"entity_catalog_provenance": normalized_provenance}
           if normalized_provenance is not None else {}),
        # A source whose outline does not fit one packet is classified in
        # contiguous page slices.  The classifier is told so explicitly, so a
        # missing later appendix reads as "not in this slice" rather than as
        # "this book has none".
        "chunk": {
            "index": int(chunk.get("index") or 1),
            "count": int(chunk.get("count") or 1),
            "page_from": int(chunk.get("page_from") or 1),
            "page_to": int(chunk.get("page_to") or outline.get("page_count") or 0),
        },
        "candidates": candidates,
        "result_contract": {
            "contract_id": CONTRACT_ID,
            "audiences": sorted(AUDIENCES),
            "timings": sorted(TIMINGS),
            "payloads": sorted(PAYLOADS),
            "binding_kinds": sorted(BINDING_KINDS),
            "binding_entity_kinds": sorted(BINDING_ENTITY_KINDS),
            "confidence": sorted(CONFIDENCE),
            "row_template": {
                "section_id": "<exact candidate section_id>",
                "title": "<exact candidate title>",
                "pdf_indices": [0],
                "audience": "keeper_only",
                "timing": "on_demand",
                "payload": "narrative",
                "binding": {"kind": "global", "entity_kind": None, "entity_ids": []},
                "confidence": "med",
            },
            "rules": [
                "Every section_id and title must come from candidates unchanged.",
                "pdf_indices must be a contiguous ascending run starting at the "
                "candidate's own pdf_index and stopping before the next "
                "classified candidate's page.",
                "Never emit source text, summaries, or quoted passages.",
                "Entity bindings may name only an exact id from entity_catalog with "
                "the same kind; never invent an id. Use global only when the "
                "section truly applies globally, and omit a candidate when its "
                "entity binding is uncertain.",
                "Omit a candidate entirely rather than guessing its labels; a "
                "missing row leaves that heading unclassified, which is "
                "recoverable, while a wrong label is not.",
            ],
        },
    }
    size = len(json.dumps(request, ensure_ascii=False).encode("utf-8"))
    if size > REQUEST_MAX_BYTES:
        raise SectionIndexError(
            f"classification request is {size} bytes, over the "
            f"{REQUEST_MAX_BYTES} cap; split the source into page chunks"
        )
    request["request_bytes"] = size
    return request


def build_classification_requests(
    *,
    outline: dict[str, Any],
    page_previews: dict[int, str],
    accepted_pdf_indices: list[int],
    job_id: str,
    entity_catalog: list[dict[str, Any]] | None = None,
    entity_catalog_provenance: dict[str, Any] | None = None,
    preview_max_bytes: int = PREVIEW_MAX_BYTES,
) -> list[dict[str, Any]]:
    """One packet when the outline fits; contiguous page chunks when it does not.

    Chunking is a degradation, not the design: a classifier seeing the whole
    outline can tell a player-handout appendix from an NPC appendix by their
    contrast, and a chunked one partly loses that.  It is still far better than
    the alternatives — dropping headings makes pages permanently unreachable,
    and falling back to the per-page lane loses global context entirely.
    Only long reference books have needed it in practice; every surveyed
    scenario fits a single packet.
    """
    rows = outline.get("rows") if isinstance(outline, dict) else None
    if not isinstance(rows, list) or not rows:
        raise SectionIndexError("outline has no heading rows to classify")
    try:
        return [build_classification_request(
            outline=outline, page_previews=page_previews,
            accepted_pdf_indices=accepted_pdf_indices, job_id=job_id,
            entity_catalog=entity_catalog,
            entity_catalog_provenance=entity_catalog_provenance,
            preview_max_bytes=preview_max_bytes,
        )]
    except SectionIndexError as exc:
        if "split the source" not in str(exc) and "over the" not in str(exc):
            raise
    page_count = int(outline.get("page_count") or 0)
    chunks = 2
    while chunks <= 16:
        span = max(1, -(-page_count // chunks))
        requests: list[dict[str, Any]] = []
        try:
            for index in range(chunks):
                first = index * span + 1
                last = min(page_count, first + span - 1)
                if first > page_count:
                    break
                slice_rows = [
                    row for row in rows
                    if first <= int(row.get("pdf_index") or 0) <= last
                ]
                if not slice_rows:
                    continue
                requests.append(build_classification_request(
                    outline={**outline, "rows": slice_rows},
                    page_previews={
                        page: text for page, text in page_previews.items()
                        if first <= page <= last
                    },
                    accepted_pdf_indices=accepted_pdf_indices,
                    job_id=f"{job_id}-c{index + 1}",
                    entity_catalog=entity_catalog,
                    entity_catalog_provenance=entity_catalog_provenance,
                    preview_max_bytes=preview_max_bytes,
                    chunk={
                        "index": index + 1, "count": chunks,
                        "page_from": first, "page_to": last,
                    },
                ))
        except SectionIndexError:
            chunks *= 2
            continue
        for request in requests:
            request["chunk"]["count"] = len(requests)
        return requests
    raise SectionIndexError(
        "outline cannot be chunked into classification packets"
    )


