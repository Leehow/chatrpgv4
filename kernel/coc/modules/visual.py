"""Visual reader drafts: source references, review and additive graph publication."""
from __future__ import annotations

import copy
import math
from typing import Any

from ..errors import RpcError, invalid_params
from ..fileio import canonical_json
from .contract import (COVERAGE_DOMAINS, COVERAGE_STATUSES, GRAPH_CONTRACT_ID, NODE_KINDS,
                       RELATION_KINDS, TRUTH_STATUSES, VISIBILITIES, module_node_id,
                       valid_semantic_id)


def reject(message: str, path: str = "/") -> None:
    raise invalid_params(message, fix="correct the draft using the original pages and submit again",
                         details={"reason": "reading_failed", "path": path})


def references(value: Any, page_count: int, seen: set[int] | None = None) -> list[dict[str, Any]]:
    if not isinstance(value, list) or not value:
        reject("source_refs must contain at least one original page")
    result = []
    for ref in value:
        if not isinstance(ref, dict) or set(ref) - {"page", "box"}:
            reject("a source reference contains only page and optional box")
        page = ref.get("page")
        if type(page) is not int or not 1 <= page <= page_count:
            reject("a source reference is outside the original PDF")
        if seen is not None and page not in seen:
            reject(f"physical page {page} was not actually viewed by this reader")
        if "box" in ref:
            box = ref["box"]
            if (not isinstance(box, list) or len(box) != 4 or
                any(type(v) not in (int, float) or not math.isfinite(v) for v in box) or
                not (0 <= box[0] < box[2] <= 1 and 0 <= box[1] < box[3] <= 1)):
                reject("box must be a normalized rectangle in the rotated page")
        if ref not in result:
            result.append(copy.deepcopy(ref))
    return result


def numeric_paths(value: Any, path: str = "") -> list[str]:
    if type(value) in (int, float):
        return [path]
    if isinstance(value, dict):
        return [p for key, item in value.items() for p in numeric_paths(item, path + "/" + str(key).replace("~", "~0").replace("/", "~1"))]
    if isinstance(value, list):
        return [p for i, item in enumerate(value) for p in numeric_paths(item, f"{path}/{i}")]
    return []


def required_view_pages(draft: dict[str, Any], baseline: dict[str, Any] | None = None) -> list[int]:
    """Tell the reader which changed records need source images before it finishes."""
    pages: set[int] = set()
    for collection in ("nodes", "claims"):
        def identity(row):
            return row.get("node_id") or row.get("claim_id") or canonical_json([row.get("subject_id"), row.get("predicate"), row.get("object")])
        old = {identity(r): r for r in (baseline or {}).get(collection, [])}
        for row in draft.get(collection, []):
            if old.get(identity(row)) == row:
                continue
            for ref in [*row.get("source_refs", []), *row.get("properties", {}).get("image_sources", [])]:
                if type(ref.get("page")) is int:
                    pages.add(ref["page"])
    return sorted(pages)


def pointer(value: Any, path: str) -> Any:
    if not isinstance(path, str) or not path.startswith("/"):
        reject("review path must be a JSON pointer into the draft")
    try:
        for key in path[1:].split("/"):
            key = key.replace("~1", "/").replace("~0", "~")
            value = value[int(key)] if isinstance(value, list) else value[key]
        return value
    except (KeyError, IndexError, TypeError, ValueError):
        reject("review path does not exist in the draft", path)


def check_draft(draft: Any, packet: dict[str, Any], seen: set[int] | None = None) -> dict[str, Any]:
    if not isinstance(draft, dict):
        reject("the draft must be an object")
    allowed = {"contract_id", "nodes", "claims", "node_refs", "coverage", "dependencies", "critical", "ready_nodes"}
    if set(draft) - allowed:
        reject(f"unknown draft keys: {sorted(set(draft) - allowed)}")
    if draft.get("contract_id", "coc.module-graph-shard.v4") != "coc.module-graph-shard.v4":
        reject("use the visual shard contract coc.module-graph-shard.v4")
    if draft.get("dependencies") != []:
        reject("resolve the current scope's source dependencies before publication", "/dependencies")
    for key in ("nodes", "claims", "node_refs", "critical", "ready_nodes"):
        if not isinstance(draft.get(key), list):
            reject(f"{key} must be an array", f"/{key}")
    coverage = draft.get("coverage")
    if not isinstance(coverage, dict) or set(coverage) - set(COVERAGE_DOMAINS) or any(v not in COVERAGE_STATUSES for v in coverage.values()):
        reject("coverage must use the supplied coverage vocabulary")
    filled = copy.deepcopy(draft)
    nodes = filled["nodes"]
    existing = {n["node_id"] for n in packet.get("known_nodes", [])}
    defined: set[str] = set()
    count = packet["source"]["page_count"]
    node_keys = {"node_id", "node_kind", "name", "aliases", "summary", "properties", "visibility", "source_refs"}
    for i, node in enumerate(nodes):
        if not isinstance(node, dict) or set(node) - node_keys:
            reject("invalid node fields", f"/nodes/{i}")
        nid, kind = node.get("node_id"), node.get("node_kind")
        if kind not in NODE_KINDS or not valid_semantic_id(nid) or not nid.startswith(kind + "-") or nid in defined:
            reject("node kind/id must be unique and use the supplied vocabulary", f"/nodes/{i}")
        if not isinstance(node.get("name"), str) or not node["name"].strip():
            reject("each node needs its source name", f"/nodes/{i}/name")
        if not isinstance(node.get("properties", {}), dict) or not isinstance(node.get("aliases", []), list):
            reject("properties must be an object and aliases an array", f"/nodes/{i}")
        if any(not isinstance(a, str) for a in node.get("aliases", [])):
            reject("aliases must contain names")
        props = node.get("properties", {})
        if "image_sources" in props:
            references(props["image_sources"], count, seen)
        if kind == "npc" and any(isinstance(props.get(k), dict) for k in ("stats", "skills", "characteristics", "derived")):
            if not isinstance((props.get("mechanics") or {}).get("profile"), dict):
                reject("put authored NPC numbers in properties.mechanics.profile (characteristics, derived, skills); a standalone stats dictionary does not reach the rules engine", f"/nodes/{i}/properties")
        node.setdefault("visibility", "keeper-only")
        if node["visibility"] not in VISIBILITIES:
            reject("node visibility must use the supplied vocabulary")
        node["source_refs"] = references(node.get("source_refs"), count, seen)
        defined.add(nid)
    ids = existing | defined | {module_node_id(packet["module_id"])}
    for nid in filled["node_refs"] + filled["ready_nodes"]:
        if not isinstance(nid, str) or nid not in ids:
            reject("a node reference must name a defined node")
    if not filled["ready_nodes"]:
        reject("declare the nodes whose material this task has prepared", "/ready_nodes")
    if not set(filled["ready_nodes"]) <= defined:
        reject("ready_nodes must be present in the draft so their material can be independently reviewed", "/ready_nodes")
    claim_keys = {"claim_id", "subject_id", "predicate", "object", "truth_status", "visibility", "source_refs", "reason", "known_by_ids", "asserted_by_ids", "validity"}
    claimed: set[str] = set()
    required = set(filled["critical"])
    for p in required:
        pointer(draft, p)
    for i, node in enumerate(nodes):
        required.update(numeric_paths({k: v for k, v in node.get("properties", {}).items() if k != "image_sources"}, f"/nodes/{i}/properties"))
        if node["node_id"] in filled["ready_nodes"]:
            required.add(f"/nodes/{i}")
    for i, claim in enumerate(filled["claims"]):
        if not isinstance(claim, dict) or set(claim) - claim_keys:
            reject("invalid claim fields", f"/claims/{i}")
        target = claim.get("object", {}).get("node_id") if isinstance(claim.get("object"), dict) else None
        if claim.get("subject_id") not in ids or target not in ids or claim.get("predicate") not in RELATION_KINDS:
            reject("a claim must connect defined nodes with a supplied predicate", f"/claims/{i}")
        if set(claim["object"]) != {"node_id"}:
            reject("claim objects contain only node_id")
        claim.setdefault("claim_id", f"claim-{claim['subject_id']}-{claim['predicate']}-{target}")
        if not valid_semantic_id(claim["claim_id"]) or claim["claim_id"] in claimed:
            reject("claim ids must be unique semantic identifiers")
        claimed.add(claim["claim_id"])
        if claim.get("truth_status") not in TRUTH_STATUSES:
            reject("claims must declare authored fact, belief, rumor, lie or inference using the vocabulary")
        claim.setdefault("visibility", "keeper-only")
        if claim["visibility"] not in VISIBILITIES:
            reject("invalid claim visibility")
        claim["source_refs"] = references(claim.get("source_refs"), count, seen)
        for key in ("known_by_ids", "asserted_by_ids"):
            claim.setdefault(key, [])
            if not isinstance(claim[key], list) or any(n not in ids for n in claim[key]):
                reject(f"{key} must name defined nodes")
        claim.setdefault("validity", None)
        required.add(f"/claims/{i}")
    filled["required_review"] = sorted(required)
    return filled


def check_review(draft: dict[str, Any], filled: dict[str, Any], review: Any, count: int, seen: set[int]) -> None:
    if not isinstance(review, dict) or not isinstance(review.get("missing"), list) or not isinstance(review.get("checked"), list):
        reject("review must contain checked facts and an empty missing list")
    if review["missing"]:
        reject("the independent review found missing or incorrect material: " + canonical_json(review["missing"]), "/review/missing")
    supported = set()
    for row in review["checked"]:
        if not isinstance(row, dict):
            reject("review entries must be objects")
        paths = row.get("paths", [row.get("path")])
        if not isinstance(paths, list) or not paths:
            reject("review entries need path or a non-empty paths array")
        for p in paths:
            pointer(draft, p)
        references(row.get("source_refs"), count, seen)
        if row.get("verdict") != "supported":
            reject(f"visual review did not support {paths}: {row.get('reason', '')}")
        supported.update(paths)
    missing = set(filled["required_review"]) - supported
    if missing:
        reject(f"visual review omitted required fields: {sorted(missing)}")


def merge_value(old: Any, new: Any, path: str = "") -> Any:
    if old == new:
        return copy.deepcopy(old)
    if isinstance(old, dict) and isinstance(new, dict):
        out = copy.deepcopy(old)
        for key, value in new.items():
            out[key] = merge_value(out[key], value, path + "/" + key) if key in out else copy.deepcopy(value)
        return out
    if path.endswith(("/aliases", "/source_refs", "/known_by_ids", "/asserted_by_ids")) and isinstance(old, list) and isinstance(new, list):
        return copy.deepcopy(old + [v for v in new if v not in old])
    raise RpcError("needs_choice", "the new reading contradicts a published value",
                   fix="compare both sources and preserve the existing fact until the conflict is explicitly resolved",
                   details={"path": path, "existing": old, "proposed": new})


def assemble_visual(previous: dict[str, Any] | None, filled: dict[str, Any], meta: dict[str, Any]) -> dict[str, Any]:
    from .assemble import _project_scene_records
    from .gates import relation_from_claim

    mid = module_node_id(meta["id"])
    graph = copy.deepcopy(previous or {"contract_id": GRAPH_CONTRACT_ID, "schema_version": 3,
        "module_id": meta["id"], "nodes": [{"node_id": mid, "node_kind": "module", "name": meta["title"],
            "visibility": "keeper-only", "properties": {}, "aliases": [], "summary": "",
            "source_refs": [{"source_id": f"pdf:{meta['id']}", "pdf_index": 0}]}], "claims": [], "relations": []})
    for kind, key in (("nodes", "node_id"), ("claims", "claim_id")):
        rows = {r[key]: r for r in graph.get(kind, [])}
        for raw in filled[kind]:
            row = copy.deepcopy(raw)
            row["source_refs"] = [{"source_id": f"pdf:{meta['id']}", "pdf_index": r["page"] - 1,
                                   **({"box": r["box"]} if "box" in r else {})} for r in raw["source_refs"]]
            rid = row[key]
            if rid == mid and previous is None:
                rows[rid] = {**rows[rid], **row}
            else:
                rows[rid] = merge_value(rows[rid], row, "/" + kind + "/" + rid) if rid in rows else row
        graph[kind] = list(rows.values())
    nodes = {n["node_id"]: n for n in graph["nodes"]}
    relations = {r["relation_id"]: r for r in graph.get("relations", [])}
    for claim in graph["claims"]:
        rel = relation_from_claim(claim)
        if rel:
            relations[rel["relation_id"]] = rel
        if claim["predicate"] == "knows":
            for other in graph["claims"]:
                if other["subject_id"] == claim["object"]["node_id"]:
                    known = other.setdefault("known_by_ids", [])
                    if claim["subject_id"] not in known:
                        known.append(claim["subject_id"])
    _project_scene_records(nodes, relations)
    graph["nodes"] = list(nodes.values())
    graph["relations"] = list(relations.values())
    props = nodes[mid].get("properties", {})
    for key in ("entry_scene_ids", "ending_scene_ids"):
        if key in props:
            graph[key] = props[key]
    graph["source_languages"] = meta.get("languages", [])
    graph["source_refs"] = list({canonical_json(r): r for n in graph["nodes"] for r in n.get("source_refs", [])}.values())
    graph["coverage"] = {**graph.get("coverage", {}), **filled["coverage"]}
    if meta.get("opening_choice"):
        from .assemble import apply_opening_choice
        apply_opening_choice(graph, meta["opening_choice"]["start_scene"])
    return graph
