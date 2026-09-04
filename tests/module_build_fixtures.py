"""A toy section that meets the same standard a real one must.

Fixtures used to write the smallest shard the contract would accept: one scene,
no exits, no entrance, spans named after the section. Every one of those is a
thing the playability standard refuses, so once the standard existed the
fixtures were testing the merge against a shape no build may produce.

A sound toy section is barely larger: two scenes joined by an exit, the first
marked as where play opens, an ending, and page-shaped span ids so provenance
can be read out of them.
"""
from __future__ import annotations

from typing import Any

SPAN_ID = "span-page-0-block-1"


def evidence_packet() -> dict[str, Any]:
    return {"spans": [{
        "span_id": SPAN_ID, "text": "toy",
        "source_ref": {"source_id": "pdf:mod", "pdf_index": 0,
                       "grep_anchor": "toy", "text_sha256": "0" * 64},
    }]}


def nodes(section: str) -> list[dict[str, Any]]:
    def scene(suffix: str, kind: str = "scene", **properties: Any):
        return {"node_id": f"{kind}-{section}-{suffix}", "node_kind": kind,
                "name": f"{section} {suffix}", "visibility": "keeper-only",
                "aliases": [], "summary": "", "evidence_span_ids": [SPAN_ID],
                "properties": properties}
    return [
        scene("open", is_entrance=True),
        scene("next"),
        scene("end", kind="ending"),
    ]


def claims(section: str) -> list[dict[str, Any]]:
    return [{
        "claim_id": f"claim-{section}-opens-into",
        "subject_id": f"scene-{section}-open",
        "predicate": "may-lead-to",
        "object": {"node_id": f"scene-{section}-next"},
        "truth_status": "authored-fact", "evidence_span_ids": [SPAN_ID],
        "confidence": 1.0, "reason": "书上写着",
    }]


def shard(assemble, section: str, *, extra_nodes=None, extra_claims=None,
          node_refs=None) -> dict[str, Any]:
    """One sound shard. `assemble` is `coc_module_graph.assemble_model_shard`.

    Claims go in before assembly: relations are derived only when the shard
    carries no `relations` list, so adding claims afterwards leaves the exits
    underived and every scene its own island.
    """
    return assemble({
        "contract_id": "coc.module-graph-shard.v3", "schema_version": 3,
        "module_id": "mod", "section_id": section, "source_language": "zh-Hans",
        "aspects": ["structure"], "evidence_span_ids": [SPAN_ID],
        "node_refs": list(node_refs or []), "coverage": {},
        "nodes": nodes(section) + list(extra_nodes or []),
        "claims": claims(section) + list(extra_claims or []),
    })
