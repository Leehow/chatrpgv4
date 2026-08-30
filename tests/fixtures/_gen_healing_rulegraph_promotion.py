#!/usr/bin/env python3
"""Rebuild and package the source-reviewed CoC7 healing RuleGraph shard."""
from __future__ import annotations

import copy
import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Any, Mapping


ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import coc_rule_graph as rg  # noqa: E402


BUNDLE_ENV = "COC_HEALING_RULE_GRAPH_SOURCE_BUNDLE"
SOURCE_ID = "pdf:coc7-keeper-rulebook-40th"
FILE_SHA256 = "a860499cf34b40cac385f51b6e667ab37ec0796c7329494def08c8b161fd71eb"
BUNDLE_SHA256 = "96f09b55e1e9cbe65139e2bbe0498079a063b18140a93b1d94740d15fc25d2d5"
REVIEWER_IDENTITY = "codex-main-healing-source-review-20260830"
BASE_GRAPH = ROOT / "tests" / "fixtures" / "coc7-rule-graph-pre-stage1.json"
PACKAGE = ROOT / "plugins" / "coc-keeper" / "rulesets" / "coc7"
REMOVED_EXCEPTIONS = {
    "exception:coc7:healing:first-aid-window-uncompiled",
    "exception:coc7:healing:first-aid-teamwork-uncompiled",
}
FIRST_AID_DECISIONS = (
    "decision:coc7:healing:first-aid-ordinary",
    "decision:coc7:healing:first-aid-stabilization",
)


PHRASES = {
    "damage": (
        "Major Wound: The Effects",
        "Damage of 8 or more will inflict a Major Wound",
        "Zero Hit Points: The Effects",
        "amount of damage greater than the character's maximum hit points",
    ),
    "first-aid": (
        "First Aid must be delivered within one hour",
        "Two people can work together to administer First Aid",
        "First Aid to stabilize a dying character",
    ),
    "medicine": (
        "Treatment of injuries using the Medicine skill",
        "Medicine skill should be used to treat a dying character",
    ),
    "dying": (
        "A character is dying when their hit points are reduced to zero",
        "CON roll at the end of the next round and every round thereafter",
        "First Aid to stabilize a dying character",
        "Healing begins: Uncheck",
    ),
    "recovery": (
        "Regular Damage Recovery",
        "Major Wound Recovery",
        "CON roll should be made at the end of each week",
        "Add a bonus die:",
        "Add a penalty die:",
        "There are two ways to heal a major wound",
        "If the roll is a fumble",
        "Major Wound Healing",
    ),
}


def _read(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, indent=2).encode("utf-8") + b"\n"


def _prepare(bundle: Path) -> dict[str, Any]:
    result = rg.prepare({
        "ruleset_id": "coc7",
        "ruleset_version": "1.0.0",
        "source_language": "en",
        "family_id": "healing",
        "section_id": "section-wounds-and-healing",
        "bundle_dirs": [str(bundle)],
        "page_keys": [(SOURCE_ID, index) for index in (131, 132, 133)],
        "known_nodes": [],
        "output_budget": {"max_nodes": 120, "max_relations": 180},
        "families": ["healing"],
    })
    if not result.get("ok"):
        raise ValueError(result.get("findings"))
    return result["shard"]


def _spans_for(packet: Mapping[str, Any], group: str) -> list[str]:
    phrases = PHRASES[group]
    rows = [
        str(span["span_id"])
        for span in (packet.get("evidence_view") or {}).get("spans") or []
        if any(
            phrase.casefold() in str(span.get("text") or "").casefold()
            for phrase in phrases
        )
    ]
    if not rows:
        raise ValueError(f"source group {group!r} selected no spans")
    return sorted(set(rows))


def _group_for(identity: str) -> str:
    value = identity.casefold()
    if any(token in value for token in (
        "weekly", "recovery", "complete-rest", "poor-environment",
        "caregiver", "fumble",
    )):
        return "recovery"
    if "medicine" in value:
        return "medicine"
    if any(token in value for token in ("dying", "hour-clock", "round-clock")):
        return "dying"
    if any(token in value for token in ("first-aid", "rescuer")):
        return "first-aid"
    if any(token in value for token in (
        "major-wound", "zero-hit", "instant-death",
    )):
        return "damage"
    return "damage"


def _assistant_nodes() -> list[dict[str, Any]]:
    return [
        {
            "node_id": "input-slot:coc7:healing:rescuer-ref",
            "node_kind": "input-slot",
            "name": "Optional acting rescuer selected by the Keeper",
            "authority": "keeper-semantic",
            "audience": "keeper",
            "visibility": "keeper-only",
            "hard_gate": False,
            "properties": {
                "family_id": "healing",
                "ownership": "optional-semantic",
                "value_type": "string",
            },
            "evidence_span_ids": [],
        },
        {
            "node_id": "input-slot:coc7:healing:assistant-rescuer-ref",
            "node_kind": "input-slot",
            "name": "Optional second First Aid rescuer selected by the Keeper",
            "authority": "keeper-semantic",
            "audience": "keeper",
            "visibility": "keeper-only",
            "hard_gate": False,
            "properties": {
                "family_id": "healing",
                "ownership": "optional-semantic",
                "value_type": "string",
            },
            "evidence_span_ids": [],
        },
        {
            "node_id": "input-slot:coc7:healing:assistant-skill-value",
            "node_kind": "input-slot",
            "name": "Second rescuer First Aid value from the canonical sheet",
            "authority": "deterministic",
            "audience": "host-internal",
            "visibility": "keeper-only",
            "hard_gate": False,
            "properties": {
                "family_id": "healing",
                "ownership": "host-locked",
                "value_type": "int",
                "path": "actor.sheet.first_aid",
            },
            "evidence_span_ids": [],
        },
        {
            "node_id": "input-slot:coc7:healing:assistant-rescuer-id",
            "node_kind": "input-slot",
            "name": "Resolved second rescuer identity",
            "authority": "deterministic",
            "audience": "host-internal",
            "visibility": "keeper-only",
            "hard_gate": False,
            "properties": {
                "family_id": "healing",
                "ownership": "host-locked",
                "value_type": "string",
                "path": "actor.id",
            },
            "evidence_span_ids": [],
        },
    ]


def _assistant_relations() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    targets = (
        ("assistant-ref", "requires-input", "assistant-rescuer-ref"),
        ("assistant-skill", "locks-input", "assistant-skill-value"),
        ("assistant-id", "locks-input", "assistant-rescuer-id"),
    )
    for decision_ref in FIRST_AID_DECISIONS:
        branch = decision_ref.rsplit(":", 1)[-1]
        for suffix, relation_kind, target in targets:
            rows.append({
                "relation_id": f"relation:coc7:healing:{branch}-{suffix}",
                "relation_kind": relation_kind,
                "from_node_id": decision_ref,
                "to_node_id": f"input-slot:coc7:healing:{target}",
                "evidence_span_ids": [],
            })
    for decision_ref in (
        *FIRST_AID_DECISIONS,
        "decision:coc7:healing:medicine-ordinary",
        "decision:coc7:healing:medicine-stabilization",
        "decision:coc7:healing:weekly-major-wound-recovery",
    ):
        branch = decision_ref.rsplit(":", 1)[-1]
        rows.append({
            "relation_id": f"relation:coc7:healing:{branch}-rescuer-ref",
            "relation_kind": "requires-input",
            "from_node_id": decision_ref,
            "to_node_id": "input-slot:coc7:healing:rescuer-ref",
            "evidence_span_ids": [],
        })
    return rows


def build_candidate(packet: Mapping[str, Any]) -> dict[str, Any]:
    base = _read(BASE_GRAPH)
    nodes = [
        copy.deepcopy(node)
        for node in base["nodes"]
        if node.get("node_id") not in REMOVED_EXCEPTIONS
    ]
    relations = [
        copy.deepcopy(row)
        for row in base["relations"]
        if row.get("from_node_id") not in REMOVED_EXCEPTIONS
        and row.get("to_node_id") not in REMOVED_EXCEPTIONS
    ]
    nodes.extend(_assistant_nodes())
    relations.extend(_assistant_relations())

    by_id = {str(node["node_id"]): node for node in nodes}
    for node in nodes:
        if node.get("node_kind") == "decision":
            node["audience"] = "keeper"
    condition = by_id["condition:coc7:healing:first-aid-ordinary-eligible"]
    condition["name"] = "Not dying and within sixty minutes of the active wound"
    condition["hard_gate"] = True
    condition["properties"]["expression"] = {
        "op": "all",
        "of": [
            {
                "op": "not",
                "of": {
                    "op": "exists",
                    "path": "actor.conditions.dying",
                },
            },
            {
                "op": "lte",
                "path": "time.minutes_since_injury",
                "value": 60,
            },
        ],
    }
    medicine_condition = by_id[
        "condition:coc7:healing:medicine-ordinary-eligible"
    ]
    medicine_condition["hard_gate"] = True
    recovery_condition = by_id[
        "condition:coc7:healing:major-wound-not-dying"
    ]
    recovery_condition["name"] = (
        "Major wound active, not dying, and weekly recovery interval due"
    )
    recovery_condition["hard_gate"] = True
    recovery_condition["properties"]["expression"] = {
        "op": "all",
        "of": [
            {
                "op": "exists",
                "path": "actor.conditions.major_wound",
            },
            {
                "op": "not",
                "of": {
                    "op": "exists",
                    "path": "actor.conditions.dying",
                },
            },
            {
                "op": "eq",
                "path": "actor.recovery.major_wound_week_due",
                "value": True,
            },
        ],
    }
    for decision_ref in FIRST_AID_DECISIONS:
        slots = by_id[decision_ref]["properties"]["implementation"]["payload_slots"]
        for name in ("assistant_skill_value", "assistant_rescuer_id"):
            if not any(row.get("name") == name for row in slots):
                slots.append({"name": name, "ownership": "host-locked"})

    groups = {name: _spans_for(packet, name) for name in PHRASES}
    all_spans = sorted({span for values in groups.values() for span in values})
    for node in nodes:
        group = _group_for(str(node["node_id"]))
        node["evidence_span_ids"] = list(groups.get(group, all_spans))
    for relation in relations:
        spans = {
            span
            for identity in (
                str(relation.get("from_node_id") or ""),
                str(relation.get("to_node_id") or ""),
            )
            for span in groups.get(_group_for(identity), all_spans)
        }
        relation["evidence_span_ids"] = sorted(spans)

    candidate = {
        "contract_id": rg.CANDIDATE_CONTRACT_ID,
        "schema_version": 1,
        "ruleset_id": "coc7",
        "family_id": "healing",
        "section_id": "section-wounds-and-healing",
        "source_language": "en",
        "coverage": {"healing": "accepted"},
        "nodes": sorted(nodes, key=lambda row: str(row["node_id"])),
        "relations": sorted(relations, key=lambda row: str(row["relation_id"])),
    }
    findings = rg._validate_candidate(candidate, dict(packet))
    if findings:
        raise ValueError(findings)
    return candidate


def build_package(bundle: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    normalized = _read(bundle / "normalized-source.json")
    if normalized.get("bundle_sha256") != BUNDLE_SHA256:
        raise ValueError("healing source bundle digest drift")
    if [row.get("pdf_index") for row in normalized.get("pages") or []] != [131, 132, 133]:
        raise ValueError("healing source bundle page scope drift")
    packet = _prepare(bundle)
    candidate = build_candidate(packet)
    rg.clear_accepted_session()
    with tempfile.TemporaryDirectory(prefix="healing-rulegraph-evidence-") as raw:
        evidence_root = Path(raw)
        accepted = rg.accept(packet, candidate, evidence_root=evidence_root)
        if not accepted.get("ok"):
            raise ValueError(accepted.get("findings"))
        built = rg.build([accepted["shard"]], evidence_root=evidence_root)
        if not built.get("ok"):
            raise ValueError(built.get("findings"))
    source = normalized["source"]
    return rg.apply_healing_graph_package(
        built["graph"],
        built["manifest"],
        source_bundle_identity={
            "source_id": source["source_id"],
            "bundle_sha256": normalized["bundle_sha256"],
            "file_sha256": source["file_sha256"],
        },
        reviewer_identity=REVIEWER_IDENTITY,
    )


def write_package(graph: Mapping[str, Any], manifest: Mapping[str, Any]) -> None:
    (PACKAGE / "rule-graph.json").write_bytes(_canonical_bytes(graph))
    (PACKAGE / "rule-graph-manifest.json").write_bytes(_canonical_bytes(manifest))


def main() -> None:
    raw = os.environ.get(BUNDLE_ENV)
    if not raw:
        raise SystemExit(f"{BUNDLE_ENV} is required")
    graph, manifest = build_package(Path(raw).expanduser().resolve())
    write_package(graph, manifest)
    print(json.dumps({
        "nodes": len(graph["nodes"]),
        "relations": len(graph["relations"]),
        "graph_content_digest": manifest["graph_content_digest"],
        "runtime_owner": graph["family_runtime_ownership"]["healing"],
        "legacy_surface": graph["legacy_surface_lifecycle"]["healing"],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
