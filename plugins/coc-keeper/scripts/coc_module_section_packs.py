#!/usr/bin/env python3
"""Extraction contract for one indexed module section.

The section index says a heading exists, who it is for, and where it sits.
This module governs what may come back when that section is actually read.

Two rules shape the design.

First, the worker still returns one bare JSON object and still has no tools.
Its isolation is what makes the evidence chain checkable — page refs bound to
accepted cache entries, digests over exact text — and handing it a file to
write would remove that in exchange for nothing it cannot already express.
The prose it compiles travels inside the JSON as ``body_markdown``, and the
*repository* writes it to ``sections/<section_id>.md``.  The document on disk
is real; the authority for producing it is not delegated.

Second, most of what a published scenario keeps outside its map is prose:
the Keeper's account of what is actually happening, the era it takes place in,
how the ending is judged.  A schema that only admits rows and enums cannot
hold that, and forcing it to would either drop the content or invite the model
to invent structure the source never had.  So each pack pairs a small closed
head — identity, provenance, labels the index already established — with a
verbatim body, and the head is what the rest of the system reasons over.
"""
from __future__ import annotations

import hashlib
import json
import re
from typing import Any

SCHEMA_VERSION = 1
CONTRACT_ID = "coc.section-pack.v1"
EXTRACT_JOB_KIND = "extract_section"
EXTRACT_PURPOSE = "section_body_extraction"

# One pack kind per payload shape the index can assign.  These exist because
# eleven surveyed scenarios kept producing the same handful of non-map
# sections, not because the vocabulary was chosen up front:
#   keeper_truth     11/11 - what is really going on, always in the first pages
#   player_hook      11/11 - the briefing the investigators actually receive
#   resolution       10/11 - endings, and how each one is judged
#   pregen            8/11 - ready-made investigators the scenario ships
#   handout           8/11 - player-facing documents and cards
#   content_warning   8/11 - the material the table should agree to up front
#   progression       7/11 - timelines, acts, scheduled and triggered events
#   era_pack          5/11 - the period's prices, news, customs, technology
#   rules_note        5/11 - module-local rules, spells, items, subsystems
#   reference         -    - glossaries, bibliographies, anything else indexed
PACK_KINDS = frozenset({
    "keeper_truth", "player_hook", "resolution", "pregen", "handout",
    "content_warning", "progression", "era_pack", "rules_note", "reference",
})

# Which pack kind an index payload label resolves to.  A payload can serve
# several kinds (narrative covers truth, hook, resolution and progression), so
# the request carries the candidate set and the extractor picks within it from
# what the pages actually contain.
PAYLOAD_PACK_KINDS = {
    "narrative": ("keeper_truth", "player_hook", "resolution",
                  "progression", "content_warning", "reference"),
    "procedure": ("rules_note", "progression", "resolution"),
    "table": ("rules_note", "era_pack", "progression", "reference"),
    "entity_stats": ("rules_note", "reference"),
    "handout": ("handout",),
    "character_sheet": ("pregen",),
    "setting_lore": ("era_pack", "keeper_truth", "reference"),
}

BODY_MAX_BYTES = 24_000
MAX_HIGHLIGHTS = 24
HIGHLIGHT_MAX_CHARS = 200

_SECTION_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$")
_HEX = frozenset("0123456789abcdef")


class SectionPackError(ValueError):
    """A section extraction request or result violates its contract."""


def _require_sha256(value: Any, field: str) -> str:
    text = value if isinstance(value, str) else ""
    if len(text) != 64 or any(char not in _HEX for char in text):
        raise SectionPackError(f"{field} must be a lowercase SHA-256 digest")
    return text


def _text(value: Any) -> str:
    return " ".join(str(value or "").split())


def build_extraction_request(
    *,
    section: dict[str, Any],
    index: dict[str, Any],
    cached_page_refs: list[dict[str, Any]],
    job_id: str,
) -> dict[str, Any]:
    """Project one indexed section into its bounded extraction request."""
    if not isinstance(section, dict):
        raise SectionPackError("section must be an object")
    section_id = str(section.get("section_id") or "")
    if not _SECTION_ID.match(section_id):
        raise SectionPackError("section.section_id malformed")
    pages = [int(value) for value in section.get("pdf_indices") or []]
    if not pages:
        raise SectionPackError("section has no pages to extract")
    payload = str(section.get("payload") or "")
    allowed = PAYLOAD_PACK_KINDS.get(payload)
    if not allowed:
        raise SectionPackError(f"section payload {payload!r} has no pack kinds")
    ref_pages = {int(ref.get("pdf_index") or 0) for ref in cached_page_refs}
    missing = sorted(set(pages) - ref_pages)
    if missing:
        raise SectionPackError(
            f"section pages {missing} are not in the accepted cache"
        )
    return {
        "schema_version": SCHEMA_VERSION,
        "contract_id": "coc.section-extraction-request.v1",
        "job_id": str(job_id),
        "request_purpose": EXTRACT_PURPOSE,
        "section_id": section_id,
        "title": str(section.get("title") or ""),
        "audience": str(section.get("audience") or ""),
        "timing": str(section.get("timing") or ""),
        "payload": payload,
        "binding": json.loads(json.dumps(section.get("binding") or {})),
        "source_id": str(index.get("source_id") or ""),
        "file_sha256": _require_sha256(
            index.get("file_sha256"), "index.file_sha256",
        ),
        "requested_pdf_indices": sorted(pages),
        "cached_page_refs": [
            ref for ref in cached_page_refs
            if int(ref.get("pdf_index") or 0) in set(pages)
        ],
        "result_contract": {
            "contract_id": CONTRACT_ID,
            "allowed_pack_kinds": list(allowed),
            "body_max_bytes": BODY_MAX_BYTES,
            "max_highlights": MAX_HIGHLIGHTS,
            "row_template": {
                "section_id": section_id,
                "pack_kind": allowed[0],
                "title": str(section.get("title") or ""),
                "body_markdown": "<verbatim-faithful Markdown of these pages>",
                "highlights": [],
                "source_refs": [],
            },
            "rules": [
                "Read only cached_page_refs; never open the source file.",
                "body_markdown restates only what these pages say. Preserve "
                "authored numbers, names and conditions exactly; do not add "
                "interpretation, advice, or continuity the pages do not have.",
                "highlights are short pointers for the Keeper to scan, not a "
                "summary that replaces the body.",
                "source_refs must name pages from this request only.",
                "Return status=abstain with no pack when the pages do not "
                "support the section the index expected.",
            ],
        },
    }


def _validate_highlights(value: Any) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise SectionPackError("highlights must be a list")
    if len(value) > MAX_HIGHLIGHTS:
        raise SectionPackError("highlights exceed the cap")
    out: list[str] = []
    for index, item in enumerate(value):
        text = _text(item)
        if not text:
            raise SectionPackError(f"highlights[{index}] is empty")
        if len(text) > HIGHLIGHT_MAX_CHARS:
            raise SectionPackError(f"highlights[{index}] is too long")
        out.append(text)
    return out


def validate_section_pack(
    pack: Any,
    *,
    request: dict[str, Any],
) -> dict[str, Any]:
    """Validate one extraction result against the request that produced it."""
    if not isinstance(pack, dict):
        raise SectionPackError("section pack must be an object")
    extra = set(pack) - {
        "section_id", "pack_kind", "title", "body_markdown", "highlights",
        "source_refs",
    }
    if extra:
        raise SectionPackError(f"section pack has unsupported fields: {sorted(extra)}")
    section_id = str(pack.get("section_id") or "")
    if section_id != str(request.get("section_id") or ""):
        raise SectionPackError("section pack is bound to a different section")
    pack_kind = str(pack.get("pack_kind") or "")
    allowed = list(request.get("result_contract", {}).get("allowed_pack_kinds") or [])
    if pack_kind not in PACK_KINDS or pack_kind not in allowed:
        raise SectionPackError(
            f"pack_kind {pack_kind!r} is not allowed for this section payload"
        )
    if str(pack.get("title") or "") != str(request.get("title") or ""):
        raise SectionPackError("section pack retitles the indexed section")
    body = pack.get("body_markdown")
    if not isinstance(body, str) or not body.strip():
        raise SectionPackError("section pack body_markdown is empty")
    body_bytes = len(body.encode("utf-8"))
    if body_bytes > BODY_MAX_BYTES:
        raise SectionPackError(
            f"section body is {body_bytes} bytes, over the {BODY_MAX_BYTES} cap"
        )
    requested = {int(value) for value in request.get("requested_pdf_indices") or []}
    refs = pack.get("source_refs")
    if not isinstance(refs, list) or not refs:
        raise SectionPackError("section pack requires source_refs")
    normalized_refs: list[dict[str, Any]] = []
    for index, ref in enumerate(refs):
        if not isinstance(ref, dict):
            raise SectionPackError(f"source_refs[{index}] must be an object")
        pdf_index = ref.get("pdf_index")
        if isinstance(pdf_index, bool) or not isinstance(pdf_index, int):
            raise SectionPackError(f"source_refs[{index}].pdf_index invalid")
        if pdf_index not in requested:
            raise SectionPackError(
                f"source_refs[{index}] cites page {pdf_index} outside this request"
            )
        if str(ref.get("source_id") or "") != str(request.get("source_id") or ""):
            raise SectionPackError(f"source_refs[{index}] names a foreign source")
        normalized_refs.append({
            "source_id": str(request.get("source_id") or ""),
            "pdf_index": pdf_index,
        })
    return {
        "schema_version": SCHEMA_VERSION,
        "contract_id": CONTRACT_ID,
        "section_id": section_id,
        "pack_kind": pack_kind,
        "title": str(request.get("title") or ""),
        # Labels come from the index, never from the extractor: a worker that
        # could relabel its own section could move Keeper-only material onto a
        # player-facing surface.
        "audience": str(request.get("audience") or ""),
        "timing": str(request.get("timing") or ""),
        "payload": str(request.get("payload") or ""),
        "binding": json.loads(json.dumps(request.get("binding") or {})),
        "source_id": str(request.get("source_id") or ""),
        "file_sha256": str(request.get("file_sha256") or ""),
        "source_page_indices": sorted(requested),
        "source_refs": normalized_refs,
        "highlights": _validate_highlights(pack.get("highlights")),
        "body_sha256": hashlib.sha256(body.encode("utf-8")).hexdigest(),
        "body_bytes": body_bytes,
        "provenance": {"authority": "source_authored"},
        "parse_state": "resolved",
    }


def split_body(pack: dict[str, Any], body_markdown: str) -> tuple[dict[str, Any], str]:
    """Separate the document the repository writes from the head it indexes."""
    head = dict(pack)
    head.pop("body_markdown", None)
    return head, body_markdown


def section_document(head: dict[str, Any], body_markdown: str) -> str:
    """Render the on-disk section document with an auditable provenance header.

    Anyone opening this file — a Keeper, a reviewer, a later agent — should be
    able to see which pages it came from without consulting the index.
    """
    pages = ", ".join(str(value) for value in head.get("source_page_indices") or [])
    lines = [
        f"# {head.get('title') or head.get('section_id')}",
        "",
        f"<!-- section_id: {head.get('section_id')} -->",
        f"<!-- pack_kind: {head.get('pack_kind')} -->",
        f"<!-- audience: {head.get('audience')} | timing: {head.get('timing')} -->",
        f"<!-- source: {head.get('source_id')} pages {pages} -->",
        f"<!-- file_sha256: {head.get('file_sha256')} -->",
        "",
    ]
    highlights = head.get("highlights") or []
    if highlights:
        lines.append("## Highlights")
        lines.append("")
        lines.extend(f"- {item}" for item in highlights)
        lines.append("")
    lines.append(body_markdown.rstrip("\n"))
    lines.append("")
    return "\n".join(lines)
