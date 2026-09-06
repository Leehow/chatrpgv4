"""The extraction packet for one section (contract §14.3 `module.packet`).

Page text becomes evidence spans with machine-minted ids (`span-p<page>-<n>`),
cut at blank lines and capped at a fixed length — the only cutting this package
does. The packet also carries the `page_window` (which pages this section
covers, how many lie before and after), the skeleton (the module node and the
roster of everything accepted shards already defined), the vocabulary, and the
keys the machine fills. The reader is told which commands to run in `brief`."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from ..fileio import write_json_atomic
from .contract import (COVERAGE_DOMAINS, MACHINE_FILLED_KEYS, module_node_id, span_id_for,
                       vocabulary)

PACKET_CONTRACT_ID = "coc.module-packet.v1"
MAX_SPAN_CHARS = 1600
DEFAULT_ASPECTS: tuple[str, ...] = tuple(COVERAGE_DOMAINS)
DEFAULT_OUTPUT_BUDGET = {"max_nodes": 200, "max_relations": 400}
ROSTER_KINDS: tuple[str, ...] = ("module", "scene", "beat", "event", "ending", "npc", "creature",
                                 "clue", "conclusion", "location", "faction", "organization",
                                 "handout", "asset")

_PARAGRAPH_BREAK = re.compile(r"\n[ \t]*\n+")


def split_blocks(text: str, *, max_chars: int = MAX_SPAN_CHARS) -> list[str]:
    blocks: list[str] = []
    for paragraph in _PARAGRAPH_BREAK.split(text):
        exact = paragraph.strip()
        if not exact:
            continue
        if len(exact) <= max_chars:
            blocks.append(exact)
            continue
        for start in range(0, len(exact), max_chars):
            chunk = exact[start:start + max_chars]
            if chunk:
                blocks.append(chunk)
    return blocks


def spans_for_pages(pages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Page-scoped span ids: ordinals restart per page, so the same page cut twice
    yields the same ids."""
    spans: list[dict[str, Any]] = []
    for page in sorted(pages, key=lambda row: int(row["pdf_index"])):
        index = int(page["pdf_index"])
        for ordinal, block in enumerate(split_blocks(str(page.get("text") or "")), start=1):
            spans.append({"span_id": span_id_for(index, ordinal), "page": index, "text": block})
    return spans


def page_window(all_pages: list[int], first: int, last: int) -> dict[str, int]:
    return {
        "first_page": first,
        "last_page": last,
        "pages_before": sum(1 for index in all_pages if index < first),
        "pages_after": sum(1 for index in all_pages if index > last),
    }


def skeleton(module_id: str, title: str, accepted_shards: list[dict[str, Any]],
             page0_span: str | None) -> dict[str, Any]:
    """The module node plus the roster of nodes already accepted, for reference."""
    roster: dict[str, dict[str, Any]] = {}
    for shard in accepted_shards:
        section_id = str(shard.get("section_id") or "")
        for node in shard.get("nodes") or []:
            if not isinstance(node, dict) or node.get("node_kind") not in ROSTER_KINDS:
                continue
            node_id = str(node.get("node_id") or "")
            if not node_id or node_id in roster:
                continue
            roster[node_id] = {"node_id": node_id, "node_kind": node.get("node_kind"),
                               "name": node.get("name"), "visibility": node.get("visibility"),
                               "section_id": section_id}
    return {
        "module_node": {"node_id": module_node_id(module_id), "node_kind": "module", "name": title,
                        "visibility": "keeper-only",
                        "evidence_span_ids": [page0_span] if page0_span else [],
                        "note": "machine-made; reference it with node_refs or claims, "
                                "declare entry_scene_ids / ending_scene_ids on it only if you "
                                "must say the book names none"},
        "known_nodes": [roster[key] for key in sorted(roster)],
    }


def build(*, module_id: str, title: str, source_language: str, section: dict[str, Any],
          pages: list[dict[str, Any]], all_page_indices: list[int],
          accepted_shards: list[dict[str, Any]], work_dir: Path,
          aspects: tuple[str, ...] = DEFAULT_ASPECTS) -> dict[str, Any]:
    first, last = int(section["pages"][0]), int(section["pages"][1])
    section_pages = [p for p in pages if first <= int(p["pdf_index"]) <= last]
    spans = spans_for_pages(section_pages)
    page0 = [p for p in pages if int(p["pdf_index"]) == 0]
    page0_span = spans_for_pages(page0)[0]["span_id"] if page0 and spans_for_pages(page0) else None
    packet = {
        "contract_id": PACKET_CONTRACT_ID,
        "schema_version": 1,
        "module_id": module_id,
        "module_title": title,
        "section_id": str(section["id"]),
        "section_title": section.get("title") or "",
        "section_kind": section.get("kind"),
        "source_language": source_language,
        "aspects": list(aspects),
        "default_visibility": "keeper-only",
        "output_budget": dict(DEFAULT_OUTPUT_BUDGET),
        "page_window": page_window(all_page_indices, first, last),
        "spans": spans,
        "skeleton": skeleton(module_id, title, accepted_shards, page0_span),
        "vocabulary": vocabulary(),
        "coverage_domains": list(COVERAGE_DOMAINS),
        "machine_filled_keys": {k: list(v) for k, v in MACHINE_FILLED_KEYS.items()},
    }
    work_dir.mkdir(parents=True, exist_ok=True)
    write_json_atomic(work_dir / "packet.json", packet)
    return packet


def span_catalog(packet: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {str(row["span_id"]): row for row in packet.get("spans") or [] if isinstance(row, dict)}
