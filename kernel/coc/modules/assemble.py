"""Skeleton + accepted shards → one module graph (contract §14.3 `module.assemble`).

Merging reports and never raises: a node id claimed with two kinds, a claim or
relation with two meanings, an unresolved `node_refs` entry, a relation whose
endpoint no shard defines — each is a row in the assemble report, and the graph
is written regardless. Then the playability check decides `assembled` versus
`assembled_not_playable`. The machine fills what it can derive on the way: the
module node and its `contains` relations, `source_refs` from span pages, and the
minimal `runtime_projection.record` the table's `ModuleGraph` reads for scenes."""

from __future__ import annotations

import copy
from typing import Any

from ..fileio import read_json
from ..module_graph import record_of
from ..text import normalize as normalize_name
from .contract import (COVERAGE_DOMAINS, GRAPH_CONTRACT_ID, PLAYABLE_KINDS, SCHEMA_VERSION,
                       WALKABLE_KINDS, module_node_id, span_page)
from .packet import span_catalog
from .playability import (check as playability_check, handle_of, opening_check,
                          start_scene_candidates)
from .store import ModuleStore

VISIBILITY_RANK = {"keeper-only": 0, "revealable": 1, "player-safe": 2}
INFERRED = "inferred-candidate"


def source_id_for(module_id: str) -> str:
    return f"pdf:{module_id}"


def _source_ref(source_id: str, span: dict[str, Any] | None, page: int | None) -> dict[str, Any] | None:
    if page is None:
        return None
    ref: dict[str, Any] = {"source_id": source_id, "pdf_index": int(page)}
    if span is not None:
        ref["grep_anchor"] = str(span.get("text") or "")[:80]
    return ref


def _refs_for(span_ids: list[Any], catalog: dict[str, dict[str, Any]], source_id: str) -> list[dict[str, Any]]:
    seen: dict[tuple[str, int], dict[str, Any]] = {}
    for span_id in span_ids or []:
        span = catalog.get(str(span_id))
        page = int(span["page"]) if span is not None else span_page(span_id)
        ref = _source_ref(source_id, span, page)
        if ref is not None:
            seen.setdefault((source_id, ref["pdf_index"]), ref)
    return [seen[key] for key in sorted(seen)]


def _merge_refs(left: list[dict[str, Any]], right: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: dict[tuple[str, int], dict[str, Any]] = {}
    for ref in [*left, *right]:
        if isinstance(ref, dict) and isinstance(ref.get("pdf_index"), int):
            rows.setdefault((str(ref.get("source_id")), int(ref["pdf_index"])), copy.deepcopy(ref))
    return [rows[key] for key in sorted(rows)]


def _merge_node(existing: dict[str, Any], proposed: dict[str, Any], prefer: str) -> dict[str, Any]:
    winner, loser = (proposed, existing) if prefer == "proposed" else (existing, proposed)
    merged = copy.deepcopy(winner)
    aliases = {a for a in [*(existing.get("aliases") or []), *(proposed.get("aliases") or [])]
               if isinstance(a, str) and a.strip() and a != merged.get("name")}
    losing_name = loser.get("name")
    if isinstance(losing_name, str) and losing_name.strip() and losing_name != merged.get("name"):
        aliases.add(losing_name)
    merged["aliases"] = sorted(aliases)
    merged["evidence_span_ids"] = sorted(set(existing.get("evidence_span_ids") or [])
                                         | set(proposed.get("evidence_span_ids") or []))
    merged["source_refs"] = _merge_refs(existing.get("source_refs") or [], proposed.get("source_refs") or [])
    visibilities = [v for v in (existing.get("visibility"), proposed.get("visibility")) if v in VISIBILITY_RANK]
    if visibilities:
        merged["visibility"] = min(visibilities, key=VISIBILITY_RANK.__getitem__)
    if not merged.get("summary") and loser.get("summary"):
        merged["summary"] = loser["summary"]
    props = dict(loser.get("properties") or {})
    props.update(merged.get("properties") or {})
    merged["properties"] = props
    return merged


def _merge_record(existing: dict[str, Any], proposed: dict[str, Any], kind: str,
                  record_id: str, report: list[dict[str, Any]]) -> dict[str, Any]:
    annotation = {"reason", "summary", "aliases", "confidence", "properties"}
    ignored = {"source_refs", "evidence_span_ids"} | annotation
    left_status, right_status = existing.get("truth_status"), proposed.get("truth_status")
    if left_status != right_status and INFERRED in (left_status, right_status):
        grounded = right_status if left_status == INFERRED else left_status
        existing = {**existing, "truth_status": grounded}
        proposed = {**proposed, "truth_status": grounded}
        report.append({"code": f"{kind}_truth_status_resolved", "id": record_id, "kept": grounded,
                       "yielded": INFERRED, "why": "a reading that cites the page outranks one that infers"})
    left = {k: v for k, v in existing.items() if k not in ignored}
    right = {k: v for k, v in proposed.items() if k not in ignored}
    if left != right:
        differing = sorted(k for k in set(left) | set(right) if left.get(k) != right.get(k))
        report.append({"code": f"{kind}_conflict", "id": record_id, "fields": differing,
                       "kept": "first", "why": "same id, different meaning; the first reading stands"})
    merged = copy.deepcopy(existing)
    for key in annotation:
        if merged.get(key) in (None, "", [], {}) and proposed.get(key) not in (None, "", [], {}):
            merged[key] = copy.deepcopy(proposed[key])
    if "evidence_span_ids" in existing or "evidence_span_ids" in proposed:
        merged["evidence_span_ids"] = sorted(set(existing.get("evidence_span_ids") or [])
                                             | set(proposed.get("evidence_span_ids") or []))
    if "source_refs" in existing or "source_refs" in proposed:
        merged["source_refs"] = _merge_refs(existing.get("source_refs") or [], proposed.get("source_refs") or [])
    return merged


def skeleton_nodes(module_id: str, title: str, source_language: str, first_span: dict[str, Any] | None,
                   source_id: str, module_props: dict[str, Any] | None = None) -> dict[str, Any]:
    """The machine-made module node: cites the book's first span (page 0 front matter)."""
    spans = [first_span["span_id"]] if first_span else []
    node = {
        "node_id": module_node_id(module_id),
        "node_kind": "module",
        "name": title,
        "visibility": "keeper-only",
        "aliases": [],
        "summary": title,
        "evidence_span_ids": spans,
        "properties": {"source_language": source_language, **(module_props or {})},
        "source_refs": [ref for ref in [_source_ref(source_id, first_span,
                                                     int(first_span["page"]) if first_span else None)]
                        if ref],
    }
    return node


def merge(shards: list[dict[str, Any]], catalogs: dict[str, dict[str, dict[str, Any]]],
          *, module_id: str, title: str, source_language: str, order: list[str]) -> tuple[dict[str, Any], dict[str, Any]]:
    """Merge accepted shards (in `order`) under the skeleton. Returns (graph, report)."""
    source_id = source_id_for(module_id)
    report: dict[str, Any] = {"notes": [], "conflicts": [], "unresolved_node_refs": [],
                              "dangling_relations": []}
    nodes: dict[str, dict[str, Any]] = {}
    origin: dict[str, tuple[str, int]] = {}
    claims: dict[str, dict[str, Any]] = {}
    relations: dict[str, dict[str, Any]] = {}
    all_refs: list[dict[str, Any]] = []
    rank = {section_id: position for position, section_id in enumerate(order)}
    ordered = sorted(shards, key=lambda s: (rank.get(str(s.get("section_id")), len(rank)), str(s.get("section_id"))))
    first_span: dict[str, Any] | None = None
    for shard in ordered:
        catalog = catalogs.get(str(shard.get("section_id")), {})
        for span in catalog.values():
            if int(span.get("page", -1)) == 0 and (first_span is None or span["span_id"] < first_span["span_id"]):
                first_span = span
    if first_span is None:
        for shard in ordered:
            catalog = catalogs.get(str(shard.get("section_id")), {})
            if catalog:
                first_span = min(catalog.values(), key=lambda s: (int(s.get("page", 0)), s["span_id"]))
                break
    module_props: dict[str, Any] = {}
    module_node = skeleton_nodes(module_id, title, source_language, first_span, source_id, module_props)
    nodes[module_node["node_id"]] = module_node
    origin[module_node["node_id"]] = ("skeleton", 0)
    all_refs = _merge_refs(all_refs, module_node["source_refs"])

    for shard in ordered:
        section_id = str(shard.get("section_id"))
        catalog = catalogs.get(section_id, {})
        for node in shard.get("nodes") or []:
            if not isinstance(node, dict) or not isinstance(node.get("node_id"), str):
                continue
            node_id = node["node_id"]
            proposed = copy.deepcopy(node)
            proposed["source_refs"] = _refs_for(proposed.get("evidence_span_ids") or [], catalog, source_id)
            all_refs = _merge_refs(all_refs, proposed["source_refs"])
            spans = len(proposed.get("evidence_span_ids") or [])
            if node_id not in nodes:
                nodes[node_id] = proposed
                origin[node_id] = (section_id, spans)
                continue
            existing = nodes[node_id]
            if existing.get("node_kind") != proposed.get("node_kind"):
                report["conflicts"].append({"code": "node_kind_conflict", "id": node_id,
                                            "kept": existing.get("node_kind"), "dropped": proposed.get("node_kind"),
                                            "kept_section": origin[node_id][0], "dropped_section": section_id})
                continue
            if node_id == module_node["node_id"]:
                # A reader may add to the machine's module node (an explicit empty
                # entry_scene_ids, say); its evidence and properties are kept.
                nodes[node_id] = _merge_node(existing, proposed, "existing")
                continue
            origin_section, origin_spans = origin[node_id]
            prefer = "proposed" if spans > origin_spans else "existing"
            conflicting = [f for f in ("name", "summary", "properties") if existing.get(f) != proposed.get(f)]
            if conflicting:
                report["notes"].append({"code": "node_field_conflict", "id": node_id, "fields": conflicting,
                                        "kept": section_id if prefer == "proposed" else origin_section,
                                        "dropped": origin_section if prefer == "proposed" else section_id,
                                        "basis": "section_order" if spans == origin_spans else "evidence_span_count"})
            nodes[node_id] = _merge_node(existing, proposed, prefer)
            if prefer == "proposed":
                origin[node_id] = (section_id, spans)
        for claim in shard.get("claims") or []:
            if not isinstance(claim, dict) or not isinstance(claim.get("claim_id"), str):
                continue
            proposed = copy.deepcopy(claim)
            proposed["source_refs"] = _refs_for(proposed.get("evidence_span_ids") or [], catalog, source_id)
            claim_id = proposed["claim_id"]
            claims[claim_id] = (_merge_record(claims[claim_id], proposed, "claim", claim_id, report["conflicts"])
                                if claim_id in claims else proposed)
        for relation in shard.get("relations") or []:
            if not isinstance(relation, dict) or not isinstance(relation.get("relation_id"), str):
                continue
            relation_id = relation["relation_id"]
            proposed = copy.deepcopy(relation)
            relations[relation_id] = (_merge_record(relations[relation_id], proposed, "relation", relation_id,
                                                    report["conflicts"])
                                      if relation_id in relations else proposed)
        for ref in shard.get("node_refs") or []:
            if isinstance(ref, str):
                report["unresolved_node_refs"].append({"section_id": section_id, "node_id": ref})

    defined = set(nodes)
    report["unresolved_node_refs"] = [row for row in report["unresolved_node_refs"] if row["node_id"] not in defined]

    # Machine-made: the module contains every playable node, evidenced by that node's own page.
    for node_id in sorted(nodes):
        node = nodes[node_id]
        if node.get("node_kind") not in PLAYABLE_KINDS:
            continue
        stem = f"{module_node['node_id']}-contains-{node_id}"
        claim_id = f"claim-{stem}"
        if claim_id in claims:
            continue
        claims[claim_id] = {
            "claim_id": claim_id, "subject_id": module_node["node_id"], "predicate": "contains",
            "object": {"node_id": node_id}, "truth_status": "authored-fact", "visibility": "keeper-only",
            "evidence_span_ids": list(node.get("evidence_span_ids") or []), "asserted_by_ids": [],
            "known_by_ids": [], "validity": None, "confidence": 1.0, "reason": "machine: the module contains this unit",
            "source_refs": list(node.get("source_refs") or []),
        }
        relations.setdefault(f"rel-{stem}", {"relation_id": f"rel-{stem}", "relation_kind": "contains",
                                             "from_node_id": module_node["node_id"], "to_node_id": node_id,
                                             "claim_id": claim_id, "properties": {}})

    for relation_id in sorted(relations):
        relation = relations[relation_id]
        for end in ("from_node_id", "to_node_id"):
            if relation.get(end) not in defined:
                report["dangling_relations"].append({"relation_id": relation_id, "end": end,
                                                     "node_id": relation.get(end),
                                                     "relation_kind": relation.get("relation_kind")})

    _project_scene_records(nodes, relations)

    coverage: dict[str, str] = {}
    for domain in COVERAGE_DOMAINS:
        statuses = {str((shard.get("coverage") or {}).get(domain, "unresolved")) for shard in ordered}
        coverage[domain] = next(iter(statuses)) if len(statuses) == 1 else "partial"
    graph = {
        "contract_id": GRAPH_CONTRACT_ID,
        "schema_version": SCHEMA_VERSION,
        "module_id": module_id,
        "source_languages": sorted({str(s.get("source_language")) for s in ordered} | {source_language}),
        "section_ids": [str(s.get("section_id")) for s in ordered],
        "source_refs": all_refs,
        "coverage": coverage,
        "coverage_by_section": {str(s.get("section_id")): dict(s.get("coverage") or {}) for s in ordered},
        "node_refs_by_section": {str(s.get("section_id")): sorted(s.get("node_refs") or []) for s in ordered},
        "nodes": [nodes[k] for k in sorted(nodes)],
        "claims": [claims[k] for k in sorted(claims)],
        "relations": [relations[k] for k in sorted(relations)],
        "merge_notes": report["notes"],
    }
    module_props = nodes[module_node["node_id"]].get("properties") or {}
    for key in ("entry_scene_ids", "ending_scene_ids"):
        if isinstance(module_props.get(key), list):
            graph[key] = list(module_props[key])
    if module_props.get("unpaged") is True:
        graph["unpaged"] = True
    report["counts"] = {"nodes": len(nodes), "claims": len(claims), "relations": len(relations),
                        "conflicts": len(report["conflicts"]),
                        "unresolved_node_refs": len(report["unresolved_node_refs"]),
                        "dangling_relations": len(report["dangling_relations"])}
    return graph, report


def _project_scene_records(nodes: dict[str, dict[str, Any]], relations: dict[str, dict[str, Any]]) -> None:
    """The minimal record `ModuleGraph` reads for a scene: scene_id, display_name,
    is_start, is_final — nothing the reader did not say."""
    for node in nodes.values():
        if node.get("node_kind") != "scene":
            continue
        props = node.setdefault("properties", {})
        existing = (props.get("runtime_projection") or {}).get("record")
        record = {
            "scene_id": handle_of(node),
            "display_name": node.get("name"),
            "is_start": False,
            "is_final": False,
            **(existing if isinstance(existing, dict) else {}),
            **{k: v for k, v in props.items() if k != "runtime_projection"},
        }
        if "is_entrance" in props or "is_start" in props:
            record["is_start"] = bool(props.get("is_entrance") is True or props.get("is_start") is True)
        if "is_ending" in props or "is_final" in props:
            record["is_final"] = bool(props.get("is_ending") is True or props.get("is_final") is True)
        props["runtime_projection"] = {"document": "story-graph.json", "collection": "scenes",
                                       "record": record}


def resolve_start_scene(graph: dict[str, Any], wanted: str) -> str | None:
    """Which declared opening the given word means: node id, scene handle or name, folded
    the way the rest of the kernel folds names. Only the book's own candidates can be
    named — the choice settles an ambiguity, it does not invent an entrance."""
    asked = normalize_name(wanted)
    for candidate in start_scene_candidates(graph):
        if asked in {normalize_name(candidate["node_id"]), normalize_name(candidate["scene"]),
                     normalize_name(candidate["name"])}:
            return candidate["node_id"]
    return None


def apply_opening_choice(graph: dict[str, Any], chosen: str) -> bool:
    """Write a settled start scene into the graph (§14.14).

    Two machine-owned places carry it: the graph-level `entry_scene_ids` declaration the
    playability check reads, and each scene's projected `record.is_start`, which is what
    `ModuleGraph.start_scene()` walks. What the book itself says about the scenes
    (`properties.is_entrance`) is evidence and is left exactly as the reader wrote it."""
    nodes = {str(n["node_id"]): n for n in graph.get("nodes") or []
             if isinstance(n, dict) and isinstance(n.get("node_id"), str)}
    node = nodes.get(chosen)
    if node is None or node.get("node_kind") not in WALKABLE_KINDS:
        return False
    for candidate in start_scene_candidates(graph):
        nodes[candidate["node_id"]].setdefault("properties", {})["is_entrance"] = True
    graph["entry_scene_ids"] = [chosen]
    for other in nodes.values():
        if other.get("node_kind") != "scene":
            continue
        record = record_of(other)
        if not record:
            continue
        record["is_start"] = other is node
    return True


def assemble(store: ModuleStore, module_id: str) -> dict[str, Any]:
    from .assets import registry_from_graph
    from ..fileio import write_json_atomic

    meta = store.module(module_id)
    if meta.get("source") != "pdf":
        from ..errors import invalid_params
        raise invalid_params(f"module {module_id!r} is a starter; its graph is installed as-is",
                             fix="module.assemble is for bound bundles")
    sections = store.read_sections(module_id)
    accepted = [row for row in sections if row.get("status") == "accepted"]
    shards: list[dict[str, Any]] = []
    catalogs: dict[str, dict[str, dict[str, Any]]] = {}
    evidence_texts: dict[str, str] = {}
    for row in accepted:
        shard_path = store.shard_path(module_id, str(row["id"]))
        if not shard_path.exists():
            continue
        shards.append(read_json(shard_path))
        packet_path = store.work_dir(module_id, str(row["id"])) / "packet.json"
        catalog = span_catalog(read_json(packet_path)) if packet_path.exists() else {}
        catalogs[str(row["id"])] = catalog
        for span_id, span in catalog.items():
            evidence_texts[span_id] = str(span.get("text") or "")
    order = [str(row["id"]) for row in sorted(sections, key=lambda r: (r.get("pages") or [0])[0])]
    graph, report = merge(shards, catalogs, module_id=module_id, title=str(meta.get("title") or module_id),
                          source_language=str((meta.get("languages") or ["und"])[0]), order=order)
    # A start scene someone settled outlives every later generation: it is replayed onto
    # each assembly rather than written once into a graph the next merge would overwrite (§14.14).
    chosen = str((meta.get("opening_choice") or {}).get("start_scene") or "")
    if chosen:
        report["opening_choice_applied"] = apply_opening_choice(graph, chosen)
    playability = playability_check(graph, evidence_total=len(evidence_texts) or None,
                                    evidence_texts=evidence_texts or None)
    opening = opening_check(graph)
    bundle_assets = list((read_json(store.assets_path(module_id)) if store.assets_path(module_id).exists()
                          else {}).get("bundle_assets") or [])
    registry = registry_from_graph(graph, bundle_assets)
    registry["bundle_assets"] = bundle_assets
    write_json_atomic(store.assets_path(module_id), registry)
    meta = store.write_graph(meta, graph)
    status = "assembled" if playability["status"] == "playable" else "assembled_not_playable"
    store.advance(meta, status)
    meta["playability"] = {k: v for k, v in playability.items()}
    meta["assemble_report"] = report
    meta["opening"] = opening
    meta["opening_ready"] = bool(opening["opening_ready"])
    meta["sections_accepted"] = [str(row["id"]) for row in accepted]
    store.write_module(meta)
    store.append_build_log(module_id, {"event": "assemble", "generation": meta["generation"],
                                       "status": meta["status"], "sections": len(shards),
                                       "findings": playability["finding_counts"],
                                       "dangling_relations": report["counts"]["dangling_relations"]})
    return {
        "module_id": module_id,
        "generation": meta["generation"],
        "status": meta["status"],
        "sections_merged": [str(s.get("section_id")) for s in shards],
        "playability": {"status": playability["status"], "finding_counts": playability["finding_counts"],
                        "findings": playability["findings"][:40], "measures": playability["measures"]},
        "merge": report["counts"],
        "conflicts": report["conflicts"][:40],
        "dangling_relations": report["dangling_relations"][:40],
        "opening_ready": opening["opening_ready"],
        "opening": opening,
        "graph_path": str(store.graph_path(module_id)),
    }
