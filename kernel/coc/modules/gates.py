"""Machine fills and the three deterministic gates over one shard (contract §14.3).

Order is fixed: fill, then `shape`, `grounding`, `coverage` — every gate runs,
none downgrades, and each finding says which gate refused it. The gates are
lexical: the shape gate checks keys, id grammars and vocabulary closure; the
grounding gate checks that every declared name and every digit run occurs in
the spans the node or claim itself cites; the coverage gate checks that every
domain is accounted for and *reports* span consumption. No gate reads prose for
meaning."""

from __future__ import annotations

import copy
import hashlib
import re
import unicodedata
from typing import Any, Iterable

from .contract import (CLAIM_KEYS, COVERAGE_DOMAINS, COVERAGE_STATUSES, NODE_KEYS, NODE_KINDS,
                       RELATION_KEYS, RELATION_KINDS, SCHEMA_VERSION, SHARD_CONTRACT_ID,
                       SHARD_KEYS, SUBSTANTIVE_SPAN_CHARS, TRUTH_STATUSES, VISIBILITIES,
                       valid_semantic_id, valid_source_language)

# Node kinds whose `name` is the book's own word: the page prints it, so a name absent
# from every cited span is a fabrication or a miscitation. Analytic labels (clue,
# conclusion, rule, secret, scene ...) are the reader's and no page must contain them.
# This is a statement about the contract's vocabulary, not a classifier over prose.
SOURCE_NAMED_KINDS: frozenset[str] = frozenset({
    "npc", "creature", "faction", "organization", "location", "object", "artifact", "tome",
    "spell", "vehicle", "handout", "investigator-template",
})
_DIGIT_RUN = re.compile(r"\d+")


def finding(gate: str, code: str, path: str, message: str, **extra: Any) -> dict[str, Any]:
    return {"gate": gate, "code": code, "path": path, "message": message, **extra}


# ---- machine fills ---------------------------------------------------------------------------

def canonical_claim_id(claim: dict[str, Any]) -> str | None:
    subject = claim.get("subject_id")
    predicate = claim.get("predicate")
    obj = claim.get("object")
    target = obj.get("node_id") if isinstance(obj, dict) else None
    if not all(isinstance(v, str) and v for v in (subject, predicate, target)):
        return None
    stem = f"claim-{subject}-{predicate}-{target}"
    if len(stem) <= 160:
        return stem
    digest = hashlib.sha256(stem.encode("utf-8")).hexdigest()[:16]
    return f"claim-{str(subject)[:60]}-{digest}"


def relation_from_claim(claim: dict[str, Any]) -> dict[str, Any] | None:
    claim_id = claim.get("claim_id")
    predicate = claim.get("predicate")
    subject_id = claim.get("subject_id")
    obj = claim.get("object")
    if not isinstance(claim_id, str) or predicate not in RELATION_KINDS:
        return None
    if not isinstance(subject_id, str) or not isinstance(obj, dict):
        return None
    target = obj.get("node_id")
    if not isinstance(target, str):
        return None
    stem = claim_id[len("claim-"):] if claim_id.startswith("claim-") else claim_id
    return {"relation_id": f"rel-{stem}", "relation_kind": predicate, "from_node_id": subject_id,
            "to_node_id": target, "claim_id": claim_id, "properties": {}}


def fill(shard: Any, packet: dict[str, Any]) -> tuple[Any, list[str]]:
    """Fill what the machine owns; return the filled shard and the keys it filled."""
    if not isinstance(shard, dict):
        return copy.deepcopy(shard), []
    filled = copy.deepcopy(shard)
    touched: list[str] = []
    defaults = {
        "contract_id": SHARD_CONTRACT_ID,
        "schema_version": SCHEMA_VERSION,
        "module_id": packet.get("module_id"),
        "section_id": packet.get("section_id"),
        "source_language": packet.get("source_language"),
        "aspects": list(packet.get("aspects") or COVERAGE_DOMAINS),
        "node_refs": [],
    }
    for key, value in defaults.items():
        if key not in filled:
            filled[key] = copy.deepcopy(value)
            touched.append(key)

    span_ids: set[str] = set()
    proposed = filled.get("evidence_span_ids")
    if isinstance(proposed, list):
        span_ids.update(v for v in proposed if isinstance(v, str))
    for collection in ("nodes", "claims"):
        rows = filled.get(collection)
        if not isinstance(rows, list):
            continue
        for row in rows:
            if isinstance(row, dict) and isinstance(row.get("evidence_span_ids"), list):
                span_ids.update(v for v in row["evidence_span_ids"] if isinstance(v, str))
    filled["evidence_span_ids"] = sorted(span_ids)
    touched.append("evidence_span_ids")

    coverage = filled.get("coverage")
    accounted = dict(coverage) if isinstance(coverage, dict) else {}
    for domain in COVERAGE_DOMAINS:
        if domain not in accounted:
            accounted[domain] = "unresolved"
    filled["coverage"] = accounted
    touched.append("coverage")

    default_visibility = str(packet.get("default_visibility") or "keeper-only")
    claims = filled.get("claims")
    if isinstance(claims, list):
        for claim in claims:
            if not isinstance(claim, dict):
                continue
            if not claim.get("claim_id"):
                canonical = canonical_claim_id(claim)
                if canonical:
                    claim["claim_id"] = canonical
            claim.setdefault("visibility", default_visibility)
            claim.setdefault("asserted_by_ids", [])
            claim.setdefault("known_by_ids", [])
            claim.setdefault("validity", None)
    for node in filled.get("nodes") or [] if isinstance(filled.get("nodes"), list) else []:
        if isinstance(node, dict):
            node.setdefault("visibility", default_visibility)
            node.setdefault("aliases", [])
            node.setdefault("properties", {})
            node.setdefault("summary", "")
    if filled.get("relations") is None:
        filled["relations"] = [
            rel for rel in (relation_from_claim(c) for c in (claims or []) if isinstance(c, dict))
            if rel is not None
        ]
        touched.append("relations")
    return filled, touched


# ---- gate 1: shape ---------------------------------------------------------------------------

def _span_ids(value: Any, path: str, catalog: dict[str, Any]) -> list[dict[str, Any]]:
    if not isinstance(value, list) or not value:
        return [finding("shape", "evidence_span_ids_required", path, "must be non-empty")]
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for index, span_id in enumerate(value):
        item = f"{path}/{index}"
        if not valid_semantic_id(span_id):
            out.append(finding("shape", "invalid_span_id", item, "must be a semantic id"))
        elif span_id in seen:
            out.append(finding("shape", "duplicate_evidence_span", item, str(span_id)))
        else:
            seen.add(span_id)
            if span_id not in catalog:
                out.append(finding("shape", "unknown_evidence_span", item,
                                   f"{span_id} is not a span this packet carries"))
    return out


def shape(shard: Any, packet: dict[str, Any], catalog: dict[str, Any]) -> list[dict[str, Any]]:
    if not isinstance(shard, dict):
        return [finding("shape", "invalid_shard", "/", "the shard must be one JSON object")]
    out: list[dict[str, Any]] = []
    for key in sorted(set(shard) - SHARD_KEYS):
        out.append(finding("shape", "unknown_shard_key", f"/{key}", "not in contract"))
    if shard.get("contract_id") != SHARD_CONTRACT_ID:
        out.append(finding("shape", "contract_mismatch", "/contract_id", f"expected {SHARD_CONTRACT_ID}"))
    if shard.get("schema_version") != SCHEMA_VERSION:
        out.append(finding("shape", "version_mismatch", "/schema_version", f"expected {SCHEMA_VERSION}"))
    for field in ("module_id", "section_id"):
        if not valid_semantic_id(shard.get(field)):
            out.append(finding("shape", "invalid_semantic_id", f"/{field}", "must be a semantic id"))
        elif packet.get(field) and shard.get(field) != packet.get(field):
            out.append(finding("shape", f"{field}_mismatch", f"/{field}",
                               f"packet says {packet.get(field)!r}"))
    if not valid_source_language(shard.get("source_language")):
        out.append(finding("shape", "invalid_source_language", "/source_language",
                           "must be a BCP 47 tag such as en or zh-Hans"))
    out.extend(_span_ids(shard.get("evidence_span_ids"), "/evidence_span_ids", catalog))
    shard_spans = set(shard.get("evidence_span_ids") or [])

    aspects = shard.get("aspects")
    declared: set[str] = set()
    if not isinstance(aspects, list) or not aspects:
        out.append(finding("shape", "aspects_required", "/aspects", "must be non-empty"))
    else:
        for index, aspect in enumerate(aspects):
            path = f"/aspects/{index}"
            if aspect not in COVERAGE_DOMAINS:
                out.append(finding("shape", "invalid_aspect", path, str(aspect)))
            elif aspect in declared:
                out.append(finding("shape", "duplicate_aspect", path, str(aspect)))
            else:
                declared.add(aspect)

    nodes = shard.get("nodes")
    node_ids: set[str] = set()
    if not isinstance(nodes, list):
        out.append(finding("shape", "invalid_nodes", "/nodes", "must be an array"))
        nodes = []
    for index, node in enumerate(nodes):
        path = f"/nodes/{index}"
        if not isinstance(node, dict):
            out.append(finding("shape", "invalid_node", path, "must be an object"))
            continue
        for key in sorted(set(node) - NODE_KEYS):
            out.append(finding("shape", "unknown_node_key", f"{path}/{key}", "not in contract"))
        node_id = node.get("node_id")
        if not valid_semantic_id(node_id):
            out.append(finding("shape", "invalid_node_id", f"{path}/node_id",
                               "must be lowercase kebab-case ASCII"))
        elif node_id in node_ids:
            out.append(finding("shape", "duplicate_node_id", f"{path}/node_id", str(node_id)))
        else:
            node_ids.add(node_id)
        kind = node.get("node_kind")
        if kind not in NODE_KINDS:
            out.append(finding("shape", "invalid_node_kind", f"{path}/node_kind", f"unknown kind {kind!r}"))
        elif valid_semantic_id(node_id) and not str(node_id).startswith(f"{kind}-"):
            out.append(finding("shape", "node_id_kind_mismatch", f"{path}/node_id",
                               f"must start with {kind}-"))
        if node.get("visibility") not in VISIBILITIES:
            out.append(finding("shape", "invalid_visibility", f"{path}/visibility", "unknown visibility"))
        if not isinstance(node.get("name"), str) or not node["name"].strip():
            out.append(finding("shape", "node_name_required", f"{path}/name", "must be non-empty"))
        if not isinstance(node.get("aliases", []), list):
            out.append(finding("shape", "invalid_aliases", f"{path}/aliases", "must be an array"))
        if not isinstance(node.get("properties", {}), dict):
            out.append(finding("shape", "invalid_properties", f"{path}/properties", "must be an object"))
        out.extend(_span_ids(node.get("evidence_span_ids"), f"{path}/evidence_span_ids", catalog))
        if not set(node.get("evidence_span_ids") or []).issubset(shard_spans):
            out.append(finding("shape", "evidence_span_out_of_scope", f"{path}/evidence_span_ids",
                               "node evidence must be within the shard's evidence scope"))

    node_refs = shard.get("node_refs", [])
    external: set[str] = set()
    if not isinstance(node_refs, list):
        out.append(finding("shape", "invalid_node_refs", "/node_refs", "must be an array"))
        node_refs = []
    else:
        for index, ref in enumerate(node_refs):
            path = f"/node_refs/{index}"
            if not valid_semantic_id(ref):
                out.append(finding("shape", "invalid_node_ref", path, "must be a semantic id"))
            elif ref in external:
                out.append(finding("shape", "duplicate_node_ref", path, str(ref)))
            elif ref in node_ids:
                out.append(finding("shape", "redundant_node_ref", path, str(ref)))
            else:
                external.add(ref)
    available = node_ids | external

    claims = shard.get("claims")
    claim_ids: set[str] = set()
    by_claim: dict[str, dict[str, Any]] = {}
    if not isinstance(claims, list):
        out.append(finding("shape", "invalid_claims", "/claims", "must be an array"))
        claims = []
    for index, claim in enumerate(claims):
        path = f"/claims/{index}"
        if not isinstance(claim, dict):
            out.append(finding("shape", "invalid_claim", path, "must be an object"))
            continue
        for key in sorted(set(claim) - CLAIM_KEYS):
            out.append(finding("shape", "unknown_claim_key", f"{path}/{key}", "not in contract"))
        claim_id = claim.get("claim_id")
        if not valid_semantic_id(claim_id):
            out.append(finding("shape", "invalid_claim_id", f"{path}/claim_id", "must be a semantic id"))
        elif not str(claim_id).startswith("claim-"):
            out.append(finding("shape", "claim_id_prefix_missing", f"{path}/claim_id", "must start with claim-"))
        elif claim_id in claim_ids:
            out.append(finding("shape", "duplicate_claim_id", f"{path}/claim_id", str(claim_id)))
        else:
            claim_ids.add(claim_id)
            by_claim[claim_id] = claim
        if claim.get("subject_id") not in available:
            out.append(finding("shape", "unknown_claim_subject", f"{path}/subject_id",
                               f"{claim.get('subject_id')!r} is neither a node nor a node_ref"))
        if claim.get("predicate") not in RELATION_KINDS:
            out.append(finding("shape", "invalid_predicate", f"{path}/predicate", "unknown predicate"))
        obj = claim.get("object")
        if not isinstance(obj, dict) or set(obj) != {"node_id"}:
            out.append(finding("shape", "claim_object_node_required", f"{path}/object",
                               "claims target one node; scalar facts live in node properties"))
        elif obj["node_id"] not in available:
            out.append(finding("shape", "unknown_claim_object", f"{path}/object/node_id",
                               f"{obj['node_id']!r} is neither a node nor a node_ref"))
        if claim.get("truth_status") not in TRUTH_STATUSES:
            out.append(finding("shape", "invalid_truth_status", f"{path}/truth_status", "unknown status"))
        if claim.get("visibility") not in VISIBILITIES:
            out.append(finding("shape", "invalid_visibility", f"{path}/visibility", "unknown visibility"))
        for field in ("asserted_by_ids", "known_by_ids"):
            values = claim.get(field, [])
            if not isinstance(values, list) or any(v not in available for v in values):
                out.append(finding("shape", "invalid_actor_refs", f"{path}/{field}",
                                   "must reference declared nodes"))
        confidence = claim.get("confidence")
        if confidence is not None and (isinstance(confidence, bool)
                                       or not isinstance(confidence, (int, float))
                                       or not 0 <= confidence <= 1):
            out.append(finding("shape", "invalid_claim_confidence", f"{path}/confidence", "0 through 1"))
        if claim.get("validity") is not None and not isinstance(claim.get("validity"), dict):
            out.append(finding("shape", "invalid_claim_validity", f"{path}/validity", "must be an object"))
        reason = claim.get("reason")
        if reason is not None and (not isinstance(reason, str) or not reason.strip()):
            out.append(finding("shape", "invalid_claim_reason", f"{path}/reason", "must be non-empty"))
        out.extend(_span_ids(claim.get("evidence_span_ids"), f"{path}/evidence_span_ids", catalog))
        if not set(claim.get("evidence_span_ids") or []).issubset(shard_spans):
            out.append(finding("shape", "evidence_span_out_of_scope", f"{path}/evidence_span_ids",
                               "claim evidence must be within the shard's evidence scope"))

    relations = shard.get("relations")
    relation_ids: set[str] = set()
    if not isinstance(relations, list):
        out.append(finding("shape", "invalid_relations", "/relations", "must be an array"))
        relations = []
    for index, relation in enumerate(relations):
        path = f"/relations/{index}"
        if not isinstance(relation, dict):
            out.append(finding("shape", "invalid_relation", path, "must be an object"))
            continue
        for key in sorted(set(relation) - RELATION_KEYS):
            out.append(finding("shape", "unknown_relation_key", f"{path}/{key}", "not in contract"))
        relation_id = relation.get("relation_id")
        if not valid_semantic_id(relation_id):
            out.append(finding("shape", "invalid_relation_id", f"{path}/relation_id", "must be a semantic id"))
        elif relation_id in relation_ids:
            out.append(finding("shape", "duplicate_relation_id", f"{path}/relation_id", str(relation_id)))
        else:
            relation_ids.add(relation_id)
        if relation.get("relation_kind") not in RELATION_KINDS:
            out.append(finding("shape", "invalid_relation_kind", f"{path}/relation_kind", "unknown kind"))
        for field in ("from_node_id", "to_node_id"):
            if relation.get(field) not in available:
                out.append(finding("shape", "unknown_relation_endpoint", f"{path}/{field}", "not declared"))
        bound_id = relation.get("claim_id")
        if bound_id not in claim_ids:
            out.append(finding("shape", "unknown_relation_claim", f"{path}/claim_id", "not in shard"))
        else:
            bound = by_claim[bound_id]
            bound_obj = bound.get("object")
            if (relation.get("relation_kind") != bound.get("predicate")
                    or relation.get("from_node_id") != bound.get("subject_id")
                    or not isinstance(bound_obj, dict)
                    or relation.get("to_node_id") != bound_obj.get("node_id")):
                out.append(finding("shape", "relation_claim_mismatch", path,
                                   "relation kind and endpoints must project the bound claim exactly"))
        if relation.get("properties") is not None and not isinstance(relation.get("properties"), dict):
            out.append(finding("shape", "invalid_relation_properties", f"{path}/properties", "must be an object"))

    used: set[str] = set()
    for claim in claims:
        if not isinstance(claim, dict):
            continue
        obj = claim.get("object")
        for value in (claim.get("subject_id"), obj.get("node_id") if isinstance(obj, dict) else None):
            if isinstance(value, str):
                used.add(value)
        for field in ("asserted_by_ids", "known_by_ids"):
            used.update(v for v in (claim.get(field) or []) if isinstance(v, str))
    for relation in relations:
        if isinstance(relation, dict):
            used.update(v for v in (relation.get("from_node_id"), relation.get("to_node_id"))
                        if isinstance(v, str))
    for index, ref in enumerate(node_refs):
        if isinstance(ref, str) and ref in external and ref not in used:
            out.append(finding("shape", "unused_node_ref", f"/node_refs/{index}",
                               "external refs must take part in a claim or relation"))
    return out


# ---- gate 2: grounding ---------------------------------------------------------------------

def fold(text: str) -> str:
    """Width-folded, whitespace-free, case-folded: a paraphrase still matches the page."""
    return "".join(unicodedata.normalize("NFKC", str(text)).split()).casefold()


def cited_text(span_ids: Iterable[Any], catalog: dict[str, Any]) -> str:
    parts = []
    for span_id in span_ids or []:
        row = catalog.get(str(span_id))
        parts.append(str(row.get("text") or "") if isinstance(row, dict) else "")
    return fold("\n".join(parts))


def numbers(value: Any) -> list[str]:
    out: list[str] = []
    if isinstance(value, bool):
        return out
    if isinstance(value, str):
        out.extend(_DIGIT_RUN.findall(unicodedata.normalize("NFKC", value)))
    elif isinstance(value, (int, float)):
        out.extend(_DIGIT_RUN.findall(str(value)))
    elif isinstance(value, dict):
        for key, item in value.items():
            out.extend(_DIGIT_RUN.findall(unicodedata.normalize("NFKC", str(key))))
            out.extend(numbers(item))
    elif isinstance(value, list):
        for item in value:
            out.extend(numbers(item))
    return out


def grounding(shard: Any, catalog: dict[str, Any]) -> list[dict[str, Any]]:
    if not isinstance(shard, dict):
        return []
    out: list[dict[str, Any]] = []
    for index, node in enumerate(shard.get("nodes") or []):
        if not isinstance(node, dict):
            continue
        path = f"/nodes/{index}"
        node_id = str(node.get("node_id") or "")
        cited = cited_text(node.get("evidence_span_ids") or [], catalog)
        declared = [node.get("name"), *(node.get("aliases") or [])]
        names = [fold(str(n)) for n in declared if str(n or "").strip()]
        kind = str(node.get("node_kind") or "")
        if kind in SOURCE_NAMED_KINDS and names and not any(n in cited for n in names):
            out.append(finding("grounding", "name_not_on_cited_pages", f"{path}/name",
                               "no declared name or alias occurs in the spans this node cites",
                               node_id=node_id, declared=[str(n) for n in declared if n]))
        wanted = numbers(node.get("summary")) + numbers(node.get("properties"))
        missing = sorted({n for n in wanted if n not in cited})
        if missing:
            out.append(finding("grounding", "number_not_on_cited_pages", f"{path}/properties",
                               "numbers appear here that the spans this node cites do not carry",
                               node_id=node_id, numbers=missing))
    for index, claim in enumerate(shard.get("claims") or []):
        if not isinstance(claim, dict):
            continue
        path = f"/claims/{index}"
        cited = cited_text(claim.get("evidence_span_ids") or [], catalog)
        missing = sorted({n for n in numbers(claim.get("reason")) if n not in cited})
        if missing:
            out.append(finding("grounding", "number_not_on_cited_pages", f"{path}/reason",
                               "numbers appear in this claim's reason that its own spans do not carry",
                               claim_id=str(claim.get("claim_id") or ""), numbers=missing))
    return out


# ---- gate 3: coverage --------------------------------------------------------------------

def coverage(shard: Any, catalog: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Every domain accounted for (a finding when not); consumption only reported."""
    out: list[dict[str, Any]] = []
    measures: dict[str, Any] = {"available_spans": len(catalog)}
    if not isinstance(shard, dict):
        return out, measures
    declared = shard.get("coverage")
    aspects = set(shard.get("aspects") or []) if isinstance(shard.get("aspects"), list) else set()
    if not isinstance(declared, dict) or set(declared) != set(COVERAGE_DOMAINS):
        out.append(finding("coverage", "invalid_coverage_domains", "/coverage",
                           "must account for every domain exactly once"))
    else:
        for domain, status in declared.items():
            if status not in COVERAGE_STATUSES:
                out.append(finding("coverage", "invalid_coverage_status", f"/coverage/{domain}",
                                   f"unknown status {status!r}"))
            elif domain not in aspects and status != "unresolved":
                out.append(finding("coverage", "coverage_outside_aspects", f"/coverage/{domain}",
                                   "an undeclared aspect is exactly unresolved"))
    cited: set[str] = set()
    for collection in ("nodes", "claims"):
        for row in shard.get(collection) or []:
            if isinstance(row, dict):
                cited.update(str(s) for s in (row.get("evidence_span_ids") or []))
    used = cited & set(catalog)
    measures["cited_spans"] = len(used)
    measures["span_consumption"] = round(len(used) / len(catalog), 4) if catalog else 0.0
    measures["substantive_spans_uncited"] = sum(
        1 for span_id, row in catalog.items()
        if span_id not in used and len(str(row.get("text") or "")) >= SUBSTANTIVE_SPAN_CHARS)
    measures["nodes"] = len(shard.get("nodes") or []) if isinstance(shard.get("nodes"), list) else 0
    measures["claims"] = len(shard.get("claims") or []) if isinstance(shard.get("claims"), list) else 0
    measures["relations"] = (len(shard.get("relations") or [])
                             if isinstance(shard.get("relations"), list) else 0)
    return out, measures


# ---- review ------------------------------------------------------------------------------

def review(shard: Any, packet: dict[str, Any], catalog: dict[str, Any]) -> dict[str, Any]:
    """Fill, then all three gates; `accepted` only when every gate is silent."""
    filled, touched = fill(shard, packet)
    findings: list[dict[str, Any]] = []
    findings.extend(shape(filled, packet, catalog))
    findings.extend(grounding(filled, catalog))
    coverage_findings, measures = coverage(filled, catalog)
    findings.extend(coverage_findings)
    gates = {"shape": 0, "grounding": 0, "coverage": 0}
    for row in findings:
        gates[row["gate"]] = gates.get(row["gate"], 0) + 1
    return {
        "accepted": not findings,
        "findings": findings,
        "gates": gates,
        "measures": measures,
        "machine_filled": touched,
        "shard": filled,
    }
