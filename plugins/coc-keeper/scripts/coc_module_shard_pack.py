#!/usr/bin/env python3
"""Compile an accepted section shard into the pack the progressive lane stores.

Two extraction lanes meet at fulfillment: the graph lane reads a section into
a GraphShard (nodes, claims, relations, evidence spans), and the progressive
runtime stores and serves section *packs* (a markdown body with a validated
head). This module is the bridge: a deterministic projection from shard to
pack, so the pack becomes a view of the graph rather than a second reading of
the book.

What it is not: a summarizer. Every line in the body is rendered from a node
or claim that already passed the gates -- nothing is paraphrased, inferred,
or added. If the shard does not fit the body cap, lower-priority groups are
dropped with an explicit overflow note; a silently shortened pack would read
exactly like a section that simply lacks that content.
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any

_HERE = Path(__file__).resolve().parent
import sys

sys.path.insert(0, str(_HERE))

import coc_module_section_packs as packs  # noqa: E402

# Render order: what a Keeper reaching for the section needs first.
_GROUP_ORDER = (
    ("scene", "场景"),
    ("event", "事件"),
    ("npc", "NPC"),
    ("creature", "生物"),
    ("faction", "势力"),
    ("location", "地点"),
    ("clue", "线索"),
    ("conclusion", "结论"),
    ("rule", "规则"),
    ("object", "物品"),
)

_KIND_HEADING = {kind: heading for kind, heading in _GROUP_ORDER}
_GROUP_PRIORITY = {kind: index for index, (kind, _) in enumerate(_GROUP_ORDER)}

_SPAN_PAGE = re.compile(r"-page-(\d+)-")


def _pages_of(node: dict[str, Any]) -> list[int]:
    pages = set()
    for span_id in node.get("evidence_span_ids") or []:
        match = _SPAN_PAGE.search(str(span_id))
        if match:
            pages.add(int(match.group(1)))
    return sorted(pages)


def _render_node(node: dict[str, Any]) -> str:
    name = str(node.get("name") or node.get("node_id") or "").strip()
    summary = str(node.get("summary") or "").strip()
    pages = _pages_of(node)
    page_note = f"(p.{','.join(str(p) for p in pages)})" if pages else ""
    first = f"- **{name}**{page_note}"
    return f"{first}: {summary}" if summary else first


def _render_body(shard: dict[str, Any]) -> str:
    lines = [f"# {shard.get('module_id')} / {shard.get('section_id')}", ""]
    for kind, heading in _GROUP_ORDER:
        nodes = [
            n for n in (shard.get("nodes") or [])
            if isinstance(n, dict) and n.get("node_kind") == kind
        ]
        if not nodes:
            continue
        lines.append(f"## {heading}")
        lines.extend(_render_node(node) for node in nodes)
        lines.append("")
    return "\n".join(lines).strip() + "\n"


def _capped(body: str, shard: dict[str, Any]) -> str:
    """Fit the body cap by dropping the lowest-priority group, loudly."""
    encoded = body.encode("utf-8")
    if len(encoded) <= packs.BODY_MAX_BYTES:
        return body
    nodes = [
        n for n in (shard.get("nodes") or [])
        if isinstance(n, dict) and n.get("node_kind") in _KIND_HEADING
    ]
    for kind in sorted(_KIND_HEADING, key=_GROUP_PRIORITY.get, reverse=True):
        remaining = [n for n in nodes if n.get("node_kind") != kind]
        shrunk = dict(shard, nodes=remaining)
        body = _render_body(shrunk) + (
            f"\n> 溢出说明:为装入 pack 上限,本包略去了「{_KIND_HEADING[kind]}」"
            "组;完整内容以图谱 shard 为准。\n"
        )
        if len(body.encode("utf-8")) <= packs.BODY_MAX_BYTES:
            return body
        nodes = remaining
    return body.encode("utf-8")[: packs.BODY_MAX_BYTES].decode(
        "utf-8", errors="ignore"
    ) + "\n> 溢出说明:本包已到 pack 上限,完整内容以图谱 shard 为准。\n"


def shard_to_pack(
    shard: dict[str, Any], request: dict[str, Any]
) -> dict[str, Any]:
    """One accepted shard -> one request-valid section pack."""
    allowed = list(request.get("result_contract", {}).get("allowed_pack_kinds") or [])
    pack_kind = (
        "keeper_truth" if "keeper_truth" in allowed
        else allowed[0] if allowed
        else "keeper_truth"
    )
    requested = {
        int(value) for value in (request.get("requested_pdf_indices") or [])
    }
    body = _capped(_render_body(shard), shard)
    highlights: list[str] = []
    for node in shard.get("nodes") or []:
        if not isinstance(node, dict):
            continue
        if node.get("node_kind") in ("scene", "clue", "conclusion"):
            text = str(node.get("name") or "").strip()
            if text and len(highlights) < packs.MAX_HIGHLIGHTS:
                highlights.append(text[: packs.HIGHLIGHT_MAX_CHARS])
    # A shard carries no source_refs of its own; its evidence spans do.
    span_pages: set[int] = set()
    for span_id in shard.get("evidence_span_ids") or []:
        match = _SPAN_PAGE.search(str(span_id))
        if match:
            span_pages.add(int(match.group(1)))
    source_id = str(request.get("source_id") or "")
    pack = {
        "section_id": str(request.get("section_id") or ""),
        "pack_kind": pack_kind,
        "title": str(request.get("title") or ""),
        "body_markdown": body,
        "highlights": highlights,
        "source_refs": [
            {"source_id": source_id, "pdf_index": page}
            for page in sorted(span_pages & requested)
        ],
    }
    # The pack is validated against the request before it leaves here; a
    # compiler bug must fail at compile time, not at the fulfill boundary.
    # validate() returns the indexed head; the body rides back with it so the
    # caller can `split_body` exactly as the lane already does.
    validated = packs.validate_section_pack(pack, request=request)
    validated["body_markdown"] = body
    return validated
