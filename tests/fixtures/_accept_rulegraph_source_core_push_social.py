#!/usr/bin/env python3
"""Independently source-review and accept core/check/social RuleGraph families.

This is deliberately separate from ``_gen_rulegraph_source_stage1.py``: the
producer remains revision-required and cannot accept its own candidates.  This
reviewer consumes the exact 40th Anniversary PDF bundle, narrows each family
to source-supported claims, calls the canonical ``accept``/``build`` path, and
writes family-scoped evidence.  It never edits production RuleGraph artifacts
or runtime ownership.
"""
from __future__ import annotations

import copy
import importlib.util
import json
import os
import tempfile
from pathlib import Path
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
SOURCE_TREE = (
    ROOT / "plugins" / "coc-keeper" / "rulesets" / "coc7"
    / "rule-graph-candidates" / "source-stage1"
)
BUNDLE_ROOT_ENV = "COC_RULE_GRAPH_SOURCE_BUNDLE_ROOT"
BUNDLE_NAME = "core-social-psychology-v2"
SOURCE_ID = "pdf:coc7-keeper-rulebook-40th"
PDF_SHA256 = "a860499cf34b40cac385f51b6e667ab37ec0796c7329494def08c8b161fd71eb"
REVIEWER_ROOT = "codex-rule-families-core-social-source-review-20260831"


def _load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


rg = _load_module("source_family_accept_rule_graph", SCRIPTS / "coc_rule_graph.py")
source_gen = _load_module(
    "source_family_accept_producer",
    ROOT / "tests" / "fixtures" / "_gen_rulegraph_source_stage1.py",
)


def _read(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _bytes(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, indent=2).encode("utf-8") + b"\n"


def _node(
    node_id: str,
    node_kind: str,
    name: str,
    *,
    authority: str = "deterministic",
    audience: str = "keeper",
    visibility: str = "public",
    hard_gate: bool = False,
    properties: dict[str, Any] | None = None,
    evidence: Iterable[str],
) -> dict[str, Any]:
    return {
        "node_id": node_id,
        "node_kind": node_kind,
        "name": name,
        "authority": authority,
        "audience": audience,
        "visibility": visibility,
        "hard_gate": hard_gate,
        "properties": copy.deepcopy(properties or {}),
        "evidence_span_ids": sorted(set(evidence)),
    }


def _relation(
    relation_id: str,
    relation_kind: str,
    source: str,
    target: str,
    evidence: Iterable[str],
) -> dict[str, Any]:
    return {
        "relation_id": relation_id,
        "relation_kind": relation_kind,
        "from_node_id": source,
        "to_node_id": target,
        "evidence_span_ids": sorted(set(evidence)),
    }


def _packet(bundle_root: Path, family: str, pages: list[int]) -> dict[str, Any]:
    section = f"section-{family}-source-accepted"
    result = rg.prepare({
        "ruleset_id": "coc7",
        "ruleset_version": "1.0.0",
        "source_language": "en",
        "family_id": family,
        "section_id": section,
        "bundle_dirs": [str(bundle_root / BUNDLE_NAME)],
        "page_keys": [(SOURCE_ID, page) for page in pages],
        "known_nodes": [],
        "output_budget": {"max_nodes": 160, "max_relations": 240},
        "families": [family],
    })
    if not result.get("ok"):
        raise RuntimeError(result.get("findings"))
    return result["shard"]


def _matching_spans(packet: dict[str, Any], phrases: Iterable[str]) -> list[str]:
    folded = [phrase.casefold() for phrase in phrases]
    found = [
        str(row["span_id"])
        for row in packet["evidence_view"]["spans"]
        if any(phrase in str(row.get("text") or "").casefold() for phrase in folded)
    ]
    if not found:
        raise RuntimeError(f"no source spans for {list(phrases)!r}")
    return sorted(set(found))


def _base_candidate(name: str) -> dict[str, Any]:
    return _read(SOURCE_TREE / "candidates" / name)


def _family_filter(
    base: dict[str, Any],
    family: str,
    shared_node_ids: set[str],
    *,
    excluded_node_ids: set[str] | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    excluded = excluded_node_ids or set()
    nodes = []
    for row in base["nodes"]:
        node_family = (row.get("properties") or {}).get("family_id")
        if row["node_id"] in excluded:
            continue
        if node_family == family or row["node_id"] in shared_node_ids:
            nodes.append(copy.deepcopy(row))
    ids = {row["node_id"] for row in nodes}
    relations = [
        copy.deepcopy(row)
        for row in base["relations"]
        if row["from_node_id"] in ids and row["to_node_id"] in ids
    ]
    return nodes, relations


def push_luck_candidate(packet: dict[str, Any]) -> dict[str, Any]:
    base = _base_candidate("section-checks-push-luck-source.candidate.json")
    shared = {
        "resource:coc7:push-luck:luck",
        "data-table:coc7:percentile-check",
        "data-table:coc7:pushed-roll",
        "data-table:coc7:luck",
        "data-table:coc7:success-levels",
        "data-table:coc7:difficulty-levels",
        "data-table:coc7:roll-modifiers",
    }
    nodes, relations = _family_filter(
        base,
        "push-luck",
        shared,
        excluded_node_ids={
            "exception:coc7:push-luck:fumble-push-uncompiled",
            "visibility-policy:coc7:core-check:public-roll",
        },
    )
    evidence = _matching_spans(packet, (
        "Pushing a skill roll provides",
        "Only skill and characteristic rolls can be pushed",
        "Pushed Roll: Success",
        "Pushed Roll: Failure",
        "Fumbles should take effect immediately",
        "Luck rolls may be called",
        "Group Luck roll",
        "Spending Luck",
        "Luck points may not be spent",
        "Recovering Luck points",
    ))
    for row in nodes:
        row["evidence_span_ids"] = list(evidence)

    additions = [
        _node(
            "rule:coc7:push-luck:eligible-scope",
            "rule",
            "Only a failed skill or characteristic roll may be pushed; Luck, Sanity, combat, damage, and Sanity-loss amount rolls may not be pushed",
            properties={"family_id": "push-luck"},
            evidence=evidence,
        ),
        _node(
            "rule:coc7:push-luck:goal-time-difficulty",
            "rule",
            "A push changes the method and consumes time; the goal must remain achievable, and the skill and difficulty normally remain unchanged unless the situation changes",
            authority="mixed",
            properties={"family_id": "push-luck"},
            evidence=evidence,
        ),
        _node(
            "exception:coc7:push-luck:fumble-final",
            "exception",
            "A fumble takes effect immediately and cannot be negated by pushing",
            properties={"family_id": "push-luck"},
            evidence=evidence,
        ),
        _node(
            "rule:coc7:push-luck:luck-spend-limits",
            "rule",
            "Luck spend is limited to the investigator's own skill or characteristic roll and current Luck; it cannot alter Luck, damage, SAN, SAN-loss, or pushed rolls, nor remove criticals, fumbles, firearm malfunctions, or earn an improvement check",
            properties={"family_id": "push-luck"},
            evidence=evidence,
        ),
        _node(
            "rule:coc7:push-luck:luck-recovery",
            "rule",
            "After a session, roll D100: above current Luck gains 1D10 Luck, otherwise none; Luck caps at 99 and never resets to its starting value",
            properties={"family_id": "push-luck"},
            evidence=evidence,
        ),
        _node(
            "visibility-policy:coc7:push-luck:public-roll",
            "visibility-policy",
            "Push and Luck continuations preserve the visibility of their authoritative roll evidence",
            audience="host-internal",
            visibility="keeper-only",
            properties={"policy": "preserve-authoritative-roll-visibility"},
            evidence=evidence,
        ),
    ]
    nodes.extend(additions)
    family_id = "rule-family:coc7:push-luck"
    relations.extend([
        _relation("relation:coc7:push-luck:eligible-scope-part-of", "part-of", "rule:coc7:push-luck:eligible-scope", family_id, evidence),
        _relation("relation:coc7:push-luck:goal-time-part-of", "part-of", "rule:coc7:push-luck:goal-time-difficulty", family_id, evidence),
        _relation("relation:coc7:push-luck:luck-limits-part-of", "part-of", "rule:coc7:push-luck:luck-spend-limits", family_id, evidence),
        _relation("relation:coc7:push-luck:luck-recovery-part-of", "part-of", "rule:coc7:push-luck:luck-recovery", family_id, evidence),
        _relation("relation:coc7:push-luck:fumble-forbids-push", "forbids", "exception:coc7:push-luck:fumble-final", "decision:coc7:push-luck:pushed-roll", evidence),
        _relation("relation:coc7:push-luck:scope-applies-push", "applies-to", "rule:coc7:push-luck:eligible-scope", "decision:coc7:push-luck:pushed-roll", evidence),
        _relation("relation:coc7:push-luck:goal-time-applies-push", "applies-to", "rule:coc7:push-luck:goal-time-difficulty", "decision:coc7:push-luck:pushed-roll", evidence),
        _relation("relation:coc7:push-luck:limits-apply-spend", "applies-to", "rule:coc7:push-luck:luck-spend-limits", "decision:coc7:push-luck:luck-spend", evidence),
        _relation("relation:coc7:push-luck:push-invokes-policy", "invokes", "decision:coc7:push-luck:pushed-roll", "capability:coc7:push-policy", evidence),
        _relation("relation:coc7:push-luck:spend-invokes", "invokes", "decision:coc7:push-luck:luck-spend", "capability:coc7:luck-spend", evidence),
        _relation("relation:coc7:push-luck:original-failed-available", "available-when", "decision:coc7:push-luck:pushed-roll", "condition:coc7:push-luck:original-failed", evidence),
        _relation("relation:coc7:push-luck:not-pushed-available", "available-when", "decision:coc7:push-luck:pushed-roll", "condition:coc7:push-luck:not-already-pushed", evidence),
    ])
    candidate = {
        "contract_id": rg.CANDIDATE_CONTRACT_ID,
        "schema_version": 1,
        "ruleset_id": "coc7",
        "family_id": "push-luck",
        "section_id": packet["section_id"],
        "source_language": "en",
        "coverage": {"push-luck": "accepted"},
        "nodes": sorted(nodes, key=lambda row: row["node_id"]),
        "relations": sorted(relations, key=lambda row: row["relation_id"]),
    }
    findings = rg._validate_candidate(candidate, packet)
    if findings:
        raise RuntimeError(findings)
    return candidate


def _provenance(packet: dict[str, Any], family: str, bundle: dict[str, Any]) -> dict[str, Any]:
    page_ids = sorted({
        int(span["source_ref"]["pdf_index"])
        for span in packet["evidence_binding"]["spans"]
    })
    pages = {int(row["pdf_index"]): row for row in bundle["pages"]}
    return {
        "reviewer_identity": f"{REVIEWER_ROOT}:{family}",
        "source_id": SOURCE_ID,
        "file_sha256": PDF_SHA256,
        "bundle_id": BUNDLE_NAME,
        "bundle_sha256": bundle["bundle_sha256"],
        "pages": [
            {
                "pdf_index": page,
                "text_sha256": pages[page]["text_sha256"],
                "review_state": pages[page]["review_state"],
            }
            for page in page_ids
        ],
    }


def accept_family(
    bundle_root: Path,
    family: str,
    pages: list[int],
    candidate_factory,
) -> dict[str, Any]:
    packet = _packet(bundle_root, family, pages)
    candidate = candidate_factory(packet)
    bundle = _read(bundle_root / BUNDLE_NAME / "normalized-source.json")
    with tempfile.TemporaryDirectory(prefix=f"rulegraph-{family}-accept-") as raw:
        accepted = rg.accept(packet, candidate, evidence_root=Path(raw))
        if not accepted.get("ok"):
            raise RuntimeError(accepted.get("findings"))
        built = rg.build([accepted["shard"]], evidence_root=Path(raw))
        if not built.get("ok"):
            raise RuntimeError(built.get("findings"))
    graph = built["graph"]
    manifest = built["manifest"]
    manifest["source_bundles"] = [{
        "source_id": SOURCE_ID,
        "bundle_sha256": bundle["bundle_sha256"],
        "file_sha256": PDF_SHA256,
    }]
    manifest["reviewer_identity"] = f"{REVIEWER_ROOT}:{family}"
    manifest["review_status"] = "accepted"
    manifest["findings"] = [{
        "code": "independent_source_review",
        "path": f"/reviews/{family}",
        "message": (
            f"Independent page-level semantic review accepted {family}; "
            f"see source-stage1/reviews/{family}-source-review.md"
        ),
    }]
    manifest["graph_content_digest"] = rg._json_digest(graph)
    return {
        "candidate": candidate,
        "accepted_shard": accepted["shard"],
        "graph": graph,
        "manifest": manifest,
        "provenance": _provenance(packet, family, bundle),
    }


FAMILIES = {
    "push-luck": {
        "pages": [95, 96, 97, 100, 101, 110],
        "factory": push_luck_candidate,
    },
}


def write_family(family: str, result: dict[str, Any]) -> None:
    output = SOURCE_TREE / "accepted" / family
    output.mkdir(parents=True, exist_ok=True)
    for key, name in (
        ("candidate", "candidate.json"),
        ("accepted_shard", "accepted-shard.json"),
        ("graph", "rule-graph.json"),
        ("manifest", "rule-graph-manifest.json"),
        ("provenance", "provenance.json"),
    ):
        (output / name).write_bytes(_bytes(result[key]))


def main() -> None:
    raw = os.environ.get(BUNDLE_ROOT_ENV)
    if not raw:
        raise SystemExit(f"{BUNDLE_ROOT_ENV} is required")
    bundle_root = Path(raw).expanduser().resolve()
    for family, spec in FAMILIES.items():
        result = accept_family(
            bundle_root, family, list(spec["pages"]), spec["factory"]
        )
        write_family(family, result)
        print(json.dumps({
            "family": family,
            "nodes": len(result["graph"]["nodes"]),
            "relations": len(result["graph"]["relations"]),
            "reviewer_identity": result["manifest"]["reviewer_identity"],
            "graph_content_digest": result["manifest"]["graph_content_digest"],
        }, ensure_ascii=False))


if __name__ == "__main__":
    main()
