"""Published handouts and maps, keyed by identity with source-controlled visibility."""

from __future__ import annotations

import copy
from typing import Any

from ..module_graph import record_of
from .store import node_pages

REGISTRY_CONTRACT_ID = "coc.module-assets.v1"
NODE_KINDS = ("asset", "handout")
KINDS = ("handout", "map", "illustration")


def _kind_for(node: dict[str, Any], fallback: str) -> str:
    if node.get("node_kind") == "handout":
        return "handout"
    props = node.get("properties") or {}
    role = str(props.get("role") or record_of(node).get("kind") or "").lower()
    if "map" in role:
        return "map"
    if "handout" in role:
        return "handout"
    return fallback if fallback in KINDS else "illustration"


def _entry_from_node(node: dict[str, Any], bundle_row: dict[str, Any] | None) -> dict[str, Any]:
    props = node.get("properties") or {}
    record = record_of(node)
    entry: dict[str, Any] = {
        "id": str(node["node_id"]),
        "kind": _kind_for(node, str((bundle_row or {}).get("kind") or "illustration")),
        "name": str(node.get("name") or node["node_id"]),
        "aliases": [a for a in (node.get("aliases") or []) if isinstance(a, str)],
        "pages": sorted(node_pages(node)),
        "path": (props.get("asset_ref") if props.get("image_sources") else None) or (bundle_row or {}).get("path") or props.get("asset_ref"),
        "media_type": (props.get("media_type") if props.get("image_sources") else None) or (bundle_row or {}).get("media_type") or props.get("media_type"),
        "visibility": node.get("visibility") or "keeper-only",
        "node_id": str(node["node_id"]),
        "summary": node.get("summary") or "",
    }
    text = record.get("authored_text") or props.get("authored_text")
    if isinstance(text, str) and text.strip():
        entry["text"] = text
        entry["authored_text"] = text
    title = record.get("title")
    if isinstance(title, str) and title and title not in entry["aliases"] and title != entry["name"]:
        entry["aliases"].append(title)
    if bundle_row:
        entry["bundle_asset_id"] = bundle_row.get("bundle_asset_id") or bundle_row.get("id")
        entry["sha256"] = bundle_row.get("sha256")
    return entry


def registry_from_graph(graph: dict[str, Any], previous_assets: list[dict[str, Any]]) -> dict[str, Any]:
    """Carry registered assets forward by node identity, preserving legacy paths and aliases."""
    registry = {"contract_id": REGISTRY_CONTRACT_ID, "schema_version": 1, "assets": copy.deepcopy(previous_assets)}
    rows: list[dict[str, Any]] = registry["assets"]
    by_id = {row["id"]: row for row in rows}
    unclaimed = {row["id"] for row in rows}
    for node in graph.get("nodes") or []:
        if not isinstance(node, dict) or node.get("node_kind") not in NODE_KINDS:
            continue
        pages = node_pages(node)
        match: dict[str, Any] | None = None
        candidates = [row for row in rows if row["id"] in unclaimed and
                      (row.get("node_id") == node["node_id"] or row["id"] == node["node_id"])]
        if len(candidates) == 1:
            match = candidates[0]
        elif candidates:
            wanted = _kind_for(node, "illustration")
            same_kind = [row for row in candidates if row.get("kind") == wanted]
            match = same_kind[0] if len(same_kind) == 1 else None
        entry = _entry_from_node(node, match)
        if match is not None:
            unclaimed.discard(match["id"])
            rows.remove(match)
            by_id.pop(match["id"], None)
        if entry["id"] in by_id:
            rows.remove(by_id[entry["id"]])
        rows.append(entry)
        by_id[entry["id"]] = entry
    rows.sort(key=lambda row: (row.get("pages") or [10 ** 9], row["id"]))
    registry["assets"] = rows
    return registry


def player_visible(entry: dict[str, Any]) -> bool:
    return entry.get("visibility") in ("player-safe", "revealable")
