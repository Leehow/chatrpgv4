#!/usr/bin/env python3
"""Deterministically build the production CoC7 RuleGraph from accepted shards."""
from __future__ import annotations

import copy
import importlib.util
import json
import sys
import tempfile
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
PACKAGE = ROOT / "plugins" / "coc-keeper" / "rulesets" / "coc7"
CANDIDATES = PACKAGE / "rule-graph-candidates"
ONTOLOGY = ROOT / "plugins" / "coc-keeper" / "references" / "system-ontology-registry-v1.json"
EXPECTED_FAMILIES = {
    "chase", "combat", "core-check", "development", "healing",
    "magic", "psychology", "push-luck", "sanity", "social",
}
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import coc_rule_graph as rg  # noqa: E402


def _read(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, indent=2).encode("utf-8") + b"\n"


def _accepted_shard_paths() -> list[Path]:
    return sorted(set(CANDIDATES.glob("**/accepted-shard.json")) | set(
        CANDIDATES.glob("**/*.accepted-shard.json")
    ))


def load_accepted_shards() -> dict[str, dict[str, Any]]:
    by_family: dict[str, dict[str, Any]] = {}
    for path in _accepted_shard_paths():
        value = _read(path)
        shard = value.get("accepted_shard") if "accepted_shard" in value else value
        if not isinstance(shard, dict) or shard.get("contract_id") != rg.SHARD_CONTRACT_ID:
            continue
        family = str(shard.get("family_id") or "")
        if family in by_family:
            raise ValueError(f"duplicate accepted shard for {family}: {path}")
        if shard.get("coverage") != {family: "accepted"}:
            raise ValueError(f"family {family} is not source-accepted")
        by_family[family] = shard
    missing = EXPECTED_FAMILIES - set(by_family)
    extra = set(by_family) - EXPECTED_FAMILIES
    if missing or extra:
        raise ValueError(f"accepted family mismatch: missing={sorted(missing)} extra={sorted(extra)}")
    return by_family


def _source_identity_rows() -> list[dict[str, str]]:
    rows: dict[tuple[str, str, str], dict[str, str]] = {}
    paths = sorted(CANDIDATES.glob("**/provenance.json"))
    paths += sorted(CANDIDATES.glob("**/*.provenance.json"))
    paths += sorted(CANDIDATES.glob("**/source-review.json"))
    for path in paths:
        value = _read(path)
        candidates: list[dict[str, Any]] = []
        if all(isinstance(value.get(key), str) for key in (
            "source_id", "bundle_sha256", "file_sha256",
        )):
            candidates.append(value)
        if isinstance(value.get("source"), dict):
            candidates.append(value["source"])
        if isinstance(value.get("source_bundles"), list):
            candidates.extend(row for row in value["source_bundles"] if isinstance(row, dict))
        for row in candidates:
            source_id = row.get("source_id")
            bundle = row.get("bundle_sha256")
            file_hash = row.get("file_sha256")
            if not all(isinstance(item, str) and len(item) > 0 for item in (
                source_id, bundle, file_hash,
            )):
                continue
            key = (source_id, bundle, file_hash)
            rows[key] = {
                "source_id": source_id,
                "bundle_sha256": bundle,
                "file_sha256": file_hash,
            }
    return [rows[key] for key in sorted(rows)]


def _ruleset_ownership(graph: dict[str, Any], manifest: dict[str, Any]) -> None:
    package = _read(PACKAGE / "manifest.json")
    ownership = {family: "legacy" for family in sorted(EXPECTED_FAMILIES)}
    lifecycle = {family: "visible" for family in sorted(EXPECTED_FAMILIES)}
    for row in package.get("rule_families") or []:
        family = row["family_id"]
        ownership[family] = row["runtime_owner"]
        lifecycle[family] = row["legacy_surface"]
    graph["family_runtime_ownership"] = ownership
    graph["legacy_surface_lifecycle"] = lifecycle
    manifest["family_promotion_eligibility"] = {
        family: {
            "promotion_eligible": ownership[family] == "graph",
            "runtime_ownership": ownership[family],
        }
        for family in sorted(EXPECTED_FAMILIES)
    }


def build_production() -> tuple[dict[str, Any], dict[str, Any]]:
    shards = load_accepted_shards()
    with tempfile.TemporaryDirectory(prefix="rulegraph-production-evidence-") as raw:
        evidence_root = Path(raw)
        for shard in shards.values():
            findings = rg._persist_accepted_shard(shard, evidence_root)
            if findings:
                raise ValueError(findings)
        built = rg.build(
            [shards[family]["shard_id"] for family in sorted(shards)],
            evidence_root=evidence_root,
        )
    if not built.get("ok"):
        raise ValueError(built.get("findings"))
    graph = copy.deepcopy(built["graph"])
    manifest = copy.deepcopy(built["manifest"])
    source_rows = _source_identity_rows()
    healing_source = next(
        row for row in source_rows
        if row["bundle_sha256"]
        == "96f09b55e1e9cbe65139e2bbe0498079a063b18140a93b1d94740d15fc25d2d5"
    )
    graph, manifest = rg.apply_healing_graph_package(
        graph,
        manifest,
        source_bundle_identity=healing_source,
        reviewer_identity="production-composite:accepted-family-reviews",
    )
    _ruleset_ownership(graph, manifest)
    manifest["source_bundles"] = source_rows
    manifest["reviewer_identity"] = "production-composite:accepted-family-reviews"
    manifest["review_status"] = "accepted"
    manifest["graph_content_digest"] = rg._json_digest(graph)
    return graph, manifest


def _resolver_capabilities() -> set[str]:
    path = PACKAGE / "resolver.py"
    spec = importlib.util.spec_from_file_location("coc7_resolver_ontology", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return set(module.public_api_index())


def _semantic_ref(node: dict[str, Any]) -> dict[str, Any]:
    node_id = node["node_id"]
    parts = node_id.split(":")
    if len(parts) >= 4 and parts[2] == "healing":
        suffix = "-".join(parts[3:])
        label = suffix if parts[0] == "decision" else f"{parts[0]}-{suffix}"
    elif len(parts) == 3 and parts[0] == "capability":
        label = f"capability-{parts[2]}"
    else:
        label = node_id.replace(":", "-")
    return {
        "ref_id": "ref:rule:coc7:" + label,
        "graph_id": "graph:rule:coc7",
        "semantic_id": node_id,
        "reference_kind": "artifact-node",
        "node_kind": node["node_kind"],
    }


def _condition_paths(value: Any) -> set[str]:
    if isinstance(value, list):
        return set().union(*(_condition_paths(item) for item in value), set())
    if not isinstance(value, dict):
        return set()
    found = {value["path"]} if isinstance(value.get("path"), str) else set()
    for child in value.values():
        found.update(_condition_paths(child))
    return found


def _live_state_ref(path: str) -> dict[str, Any]:
    legacy = {
        "actor.conditions.dying": "actor-conditions-dying",
        "actor.recovery.major_wound_week_due": "major-wound-week-due",
    }
    label = legacy.get(path, path.replace(".", "-").replace("_", "-"))
    return {
        "ref_id": f"ref:live-state:{label}",
        "graph_id": "graph:live-state:campaign",
        "semantic_id": f"fact:live-state:{label}",
        "reference_kind": "registered-condition-path",
        "node_kind": "live-state-fact",
        "locator": path,
    }


def compose_ontology(graph: dict[str, Any]) -> dict[str, Any]:
    registry = _read(ONTOLOGY)
    # Module links are authored instances and survive rebuild. Rule,
    # execution, and live-state refs are generated afresh from the current
    # production graph/registries so stale identities cannot accumulate.
    references = {
        row["ref_id"]: row for row in registry["references"]
        if row.get("graph_id") == "graph:module:the-haunting"
    }
    relations = {
        row["relation_id"]: row for row in registry["relations"]
        if row.get("relation_kind") in {"uses-rule", "requires-module-fact"}
    }
    nodes = {node["node_id"]: node for node in graph["nodes"]}
    capabilities = _resolver_capabilities()
    for relation in graph["relations"]:
        source = nodes.get(relation.get("from_node_id"))
        target = nodes.get(relation.get("to_node_id"))
        if not source or not target:
            continue
        if relation.get("relation_kind") == "emits" and target.get("node_kind") == "effect":
            source_ref = _semantic_ref(source)
            target_ref = _semantic_ref(target)
            references[source_ref["ref_id"]] = source_ref
            references[target_ref["ref_id"]] = target_ref
            relation_id = "relation:system:" + relation["relation_id"].replace(":", "-")
            relations[relation_id] = {
                "relation_id": relation_id,
                "relation_kind": "may-emit-effect",
                "from_ref": source_ref["ref_id"],
                "to_ref": target_ref["ref_id"],
            }
            continue
        if relation.get("relation_kind") == "available-when" and target.get("node_kind") == "condition":
            source_ref = _semantic_ref(source)
            references[source_ref["ref_id"]] = source_ref
            for path in sorted(_condition_paths((target.get("properties") or {}).get("expression"))):
                live_ref = _live_state_ref(path)
                references[live_ref["ref_id"]] = live_ref
                relation_id = (
                    "relation:system:" + relation["relation_id"].replace(":", "-")
                    + ":requires:" + path.replace(".", "-").replace("_", "-")
                )
                relations[relation_id] = {
                    "relation_id": relation_id,
                    "relation_kind": "requires-live-state-fact",
                    "from_ref": source_ref["ref_id"],
                    "to_ref": live_ref["ref_id"],
                }
            continue
        if relation.get("relation_kind") != "invokes":
            continue
        capability = (target or {}).get("properties", {}).get("resolver_capability")
        if capability not in capabilities:
            continue
        source_ref = _semantic_ref(source)
        target_ref = _semantic_ref(target)
        execution_ref = {
            "ref_id": f"ref:execution:coc7:{capability.replace('_', '-')}",
            "graph_id": "graph:execution:coc7-resolver",
            "semantic_id": target["node_id"],
            "reference_kind": "resolver-capability",
            "node_kind": "capability",
            "locator": capability,
            "declaration_ref_id": target_ref["ref_id"],
        }
        references[source_ref["ref_id"]] = source_ref
        references[target_ref["ref_id"]] = target_ref
        references[execution_ref["ref_id"]] = execution_ref
        relation_id = "relation:system:" + relation["relation_id"].replace(":", "-")
        relations[relation_id] = {
            "relation_id": relation_id,
            "relation_kind": "invokes-capability",
            "from_ref": source_ref["ref_id"],
            "to_ref": execution_ref["ref_id"],
        }
    registry["references"] = [references[key] for key in sorted(references)]
    registry["relations"] = [relations[key] for key in sorted(relations)]
    for row in registry["coverage"]:
        if row.get("graph_kind") == "rule":
            row["reason"] = "The production coc7 RuleGraph contains ten source-accepted families; ontology links only proven artifact-to-runtime instances."
        elif row.get("graph_kind") in {"director", "text"}:
            row["composition_status"] = "not-applicable"
    return registry


def write_production(graph: dict[str, Any], manifest: dict[str, Any]) -> None:
    (PACKAGE / "rule-graph.json").write_bytes(_canonical_bytes(graph))
    (PACKAGE / "rule-graph-manifest.json").write_bytes(_canonical_bytes(manifest))
    ONTOLOGY.write_bytes(_canonical_bytes(compose_ontology(graph)))


def main() -> None:
    graph, manifest = build_production()
    write_production(graph, manifest)
    print(json.dumps({
        "families": manifest["family_coverage"],
        "nodes": len(graph["nodes"]),
        "relations": len(graph["relations"]),
        "shards": len(manifest["shards"]),
        "sources": len(manifest["source_bundles"]),
        "graph_content_digest": manifest["graph_content_digest"],
    }, sort_keys=True))


if __name__ == "__main__":
    main()
