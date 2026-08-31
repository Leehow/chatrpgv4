#!/usr/bin/env python3
"""Validate the thin system-level ontology composition registry.

The registry composes references across existing authority planes.  It does
not merge graph node bodies, execute graph programs, mutate campaign state, or
grant Director/Text any rules authority.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any, Mapping

from jsonschema import Draft202012Validator


SCRIPT_DIR = Path(__file__).resolve().parent
PLUGIN_ROOT = SCRIPT_DIR.parent
REPO_ROOT = PLUGIN_ROOT.parent.parent
CONTRACT_PATH = PLUGIN_ROOT / "references" / "system-ontology-contract-v1.json"
REGISTRY_PATH = PLUGIN_ROOT / "references" / "system-ontology-registry-v1.json"
MODULE_CONTRACT_PATH = PLUGIN_ROOT / "references" / "module-graph-contract-v3.json"
RULE_CONTRACT_PATH = PLUGIN_ROOT / "references" / "rule-graph-contract-v1.json"


def _load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain one JSON object")
    return value


CONTRACT = _load_json(CONTRACT_PATH)
SEMANTIC_ID_RE = re.compile(str(CONTRACT["semantic_id_pattern"]))
KEBAB_ID_RE = re.compile(r"^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$")


def _finding(code: str, path: str, message: str) -> dict[str, str]:
    return {"code": code, "path": path, "message": message}


def _schema_findings(registry: Any) -> list[dict[str, str]]:
    findings: list[dict[str, str]] = []
    validator = Draft202012Validator(CONTRACT["registry_schema"])
    for error in sorted(validator.iter_errors(registry), key=lambda row: list(row.path)):
        pointer = "/" + "/".join(str(part) for part in error.absolute_path)
        findings.append(_finding("closed_schema_violation", pointer, error.message))
    return findings


def _condition_paths(expression: Any) -> set[str]:
    paths: set[str] = set()
    if isinstance(expression, Mapping):
        path = expression.get("path")
        if isinstance(path, str):
            paths.add(path)
        for value in expression.values():
            paths.update(_condition_paths(value))
    elif isinstance(expression, list):
        for value in expression:
            paths.update(_condition_paths(value))
    return paths


def _resolve_module_operation(
    graph: Mapping[str, Any], ref: Mapping[str, Any], path: str,
) -> tuple[dict[str, Any] | None, list[dict[str, str]]]:
    findings: list[dict[str, str]] = []
    owner = next(
        (
            node
            for node in graph.get("nodes", [])
            if isinstance(node, dict) and node.get("node_id") == ref.get("owner_node_id")
        ),
        None,
    )
    if owner is None:
        return None, [_finding(
            "missing_target", f"{path}/owner_node_id", "module owner node does not exist"
        )]
    if owner.get("node_kind") != "scene":
        findings.append(_finding(
            "wrong_node_kind", f"{path}/owner_node_id", "authored operation owner must be a scene"
        ))
    projection = (owner.get("properties") or {}).get("runtime_projection") or {}
    record = projection.get("record") if isinstance(projection, Mapping) else None
    affordances = record.get("affordances") if isinstance(record, Mapping) else None
    affordance = next(
        (
            row
            for row in (affordances if isinstance(affordances, list) else [])
            if isinstance(row, dict) and row.get("id") == ref.get("operation_id")
        ),
        None,
    )
    operation = affordance.get("authored_operation") if isinstance(affordance, dict) else None
    if not isinstance(operation, dict):
        findings.append(_finding(
            "missing_target", f"{path}/operation_id", "module authored operation does not exist"
        ))
        return None, findings
    payload = operation.get("payload")
    if not isinstance(payload, Mapping) or payload.get("rule_ref") != ref.get("module_rule_ref"):
        findings.append(_finding(
            "module_declaration_drift",
            f"{path}/module_rule_ref",
            "registry locator no longer matches the authored module rule_ref",
        ))
    return {"node_kind": "authored-operation", "node_id": ref.get("semantic_id")}, findings


def _resolver_index(ruleset_id: str) -> Mapping[str, Any]:
    if str(SCRIPT_DIR) not in sys.path:
        sys.path.insert(0, str(SCRIPT_DIR))
    import coc_rulesets  # Imported lazily to preserve the validator's read-only seam.

    resolver = coc_rulesets.get_resolver({"ruleset_id": ruleset_id})
    advertised = resolver.public_api_index()
    if not isinstance(advertised, Mapping):
        raise ValueError(f"ruleset {ruleset_id!r} public_api_index is not a mapping")
    return advertised


def validate_registry(
    registry: Any,
    *,
    repo_root: Path | str = REPO_ROOT,
) -> list[dict[str, str]]:
    """Return deterministic findings; an empty list means the registry conforms."""
    findings = _schema_findings(registry)
    if findings or not isinstance(registry, dict):
        return findings

    root = Path(repo_root).resolve()
    graph_specs = CONTRACT["graph_kinds"]
    relation_specs = CONTRACT["relation_kinds"]
    owner_contracts = {
        "module": _load_json(MODULE_CONTRACT_PATH),
        "rule": _load_json(RULE_CONTRACT_PATH),
    }

    graphs: dict[str, dict[str, Any]] = {}
    loaded_graphs: dict[str, dict[str, Any]] = {}
    runtime_registries: dict[str, Any] = {}
    for index, graph in enumerate(registry["graphs"]):
        path = f"/graphs/{index}"
        graph_id = graph["graph_id"]
        if graph_id in graphs:
            findings.append(_finding("duplicate_graph_id", f"{path}/graph_id", graph_id))
            continue
        graphs[graph_id] = graph
        expected_plane = graph_specs[graph["graph_kind"]]["authority_plane"]
        if graph["authority_plane"] != expected_plane:
            findings.append(_finding(
                "authority_plane_mismatch", f"{path}/authority_plane",
                f"{graph['graph_kind']} requires {expected_plane}",
            ))
        if graph["availability"] == "runtime-registry":
            raw_registry_path = graph["registry_path"]
            path_text, separator, fragment = raw_registry_path.partition("#")
            registry_file = (root / path_text).resolve()
            try:
                registry_file.relative_to(root)
            except ValueError:
                findings.append(_finding(
                    "registry_path_escape", f"{path}/registry_path",
                    "runtime registry must stay inside the repository",
                ))
                continue
            if not separator or not fragment:
                findings.append(_finding(
                    "runtime_registry_unreadable", f"{path}/registry_path",
                    "runtime registry path requires a #fragment locator",
                ))
                continue
            if graph["graph_kind"] == "live-state":
                try:
                    registry_document = _load_json(registry_file)
                except (OSError, UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
                    findings.append(_finding(
                        "runtime_registry_unreadable", f"{path}/registry_path", str(exc)
                    ))
                    continue
                key = fragment.removeprefix("/")
                value = registry_document.get(key)
                if not isinstance(value, list) or not all(isinstance(row, str) for row in value):
                    findings.append(_finding(
                        "runtime_registry_unreadable", f"{path}/registry_path",
                        "live-state registry fragment must resolve to a string array",
                    ))
                    continue
                runtime_registries[graph_id] = set(value)
            elif graph["graph_kind"] == "execution":
                if not registry_file.is_file() or fragment != "public_api_index":
                    findings.append(_finding(
                        "runtime_registry_unreadable", f"{path}/registry_path",
                        "execution registry must resolve to an existing public_api_index",
                    ))
            continue
        if graph["availability"] != "production-artifact":
            continue
        artifact_path = (root / graph["artifact_path"]).resolve()
        try:
            artifact_path.relative_to(root)
        except ValueError:
            findings.append(_finding(
                "artifact_path_escape", f"{path}/artifact_path", "artifact must stay inside the repository"
            ))
            continue
        try:
            loaded = _load_json(artifact_path)
        except (OSError, UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
            findings.append(_finding("artifact_unreadable", f"{path}/artifact_path", str(exc)))
            continue
        expected_ontology = graph_specs[graph["graph_kind"]]["node_ontology_contract"]
        if graph.get("ontology_contract") != expected_ontology:
            findings.append(_finding(
                "ontology_contract_mismatch", f"{path}/ontology_contract",
                f"expected {expected_ontology!r}",
            ))
        owner_contract = owner_contracts.get(graph["graph_kind"])
        if owner_contract is not None:
            if loaded.get("contract_id") != owner_contract.get("graph_contract_id"):
                findings.append(_finding(
                    "artifact_contract_mismatch", f"{path}/artifact_path",
                    "artifact contract_id does not match its owning graph ontology",
                ))
            if loaded.get("schema_version") != owner_contract.get("schema_version"):
                findings.append(_finding(
                    "artifact_version_mismatch", f"{path}/artifact_path",
                    "artifact schema_version does not match its owning graph ontology",
                ))
        loaded_graphs[graph_id] = loaded

    expected_kinds = set(graph_specs)
    present_kinds = [graph["graph_kind"] for graph in registry["graphs"]]
    if set(present_kinds) != expected_kinds or len(present_kinds) != len(expected_kinds):
        findings.append(_finding(
            "graph_kind_coverage_mismatch", "/graphs",
            "graphs must declare each system graph kind exactly once",
        ))

    references: dict[str, dict[str, Any]] = {}
    resolved: dict[str, dict[str, Any]] = {}
    ref_paths: dict[str, str] = {}
    rule_contract = _load_json(RULE_CONTRACT_PATH)
    for index, ref in enumerate(registry["references"]):
        path = f"/references/{index}"
        ref_id = ref["ref_id"]
        ref_paths[ref_id] = path
        if ref_id in references:
            findings.append(_finding("duplicate_ref_id", f"{path}/ref_id", ref_id))
            continue
        references[ref_id] = ref
        graph = graphs.get(ref["graph_id"])
        if graph is None:
            findings.append(_finding("missing_graph", f"{path}/graph_id", ref["graph_id"]))
            continue
        if graph["availability"] == "absent-production-artifact":
            findings.append(_finding(
                "reference_to_unavailable_graph", f"{path}/graph_id",
                "an absent graph kind cannot have production references",
            ))
            continue
        kind = ref["reference_kind"]
        if kind == "artifact-node":
            artifact = loaded_graphs.get(ref["graph_id"])
            if artifact is None:
                findings.append(_finding("missing_target", path, "artifact graph was not loaded"))
                continue
            node = next(
                (
                    row for row in artifact.get("nodes", [])
                    if isinstance(row, dict) and row.get("node_id") == ref["semantic_id"]
                ),
                None,
            )
            if node is None:
                findings.append(_finding("missing_target", f"{path}/semantic_id", ref["semantic_id"]))
                continue
            if node.get("node_kind") != ref["node_kind"]:
                findings.append(_finding(
                    "wrong_node_kind", f"{path}/node_kind",
                    f"artifact declares {node.get('node_kind')!r}",
                ))
            pattern = (
                KEBAB_ID_RE if graph["graph_kind"] == "module"
                else re.compile(str(rule_contract["semantic_id_pattern"]))
            )
            if not pattern.fullmatch(ref["semantic_id"]):
                findings.append(_finding(
                    "invalid_semantic_id", f"{path}/semantic_id",
                    "semantic id does not match its owning graph contract",
                ))
            resolved[ref_id] = node
        elif kind == "module-authored-operation":
            if graph["graph_kind"] != "module":
                findings.append(_finding(
                    "wrong_graph_kind", f"{path}/graph_id",
                    "module-authored-operation requires a module graph",
                ))
                continue
            node, operation_findings = _resolve_module_operation(
                loaded_graphs.get(ref["graph_id"], {}), ref, path
            )
            findings.extend(operation_findings)
            if not SEMANTIC_ID_RE.fullmatch(ref["semantic_id"]):
                findings.append(_finding(
                    "invalid_semantic_id", f"{path}/semantic_id", "operation id must be namespaced semantic id"
                ))
            if node is not None:
                resolved[ref_id] = node
        elif kind == "registered-condition-path":
            if graph["graph_kind"] != "live-state":
                findings.append(_finding(
                    "wrong_graph_kind", f"{path}/graph_id",
                    "registered-condition-path requires the live-state graph kind",
                ))
            registered_condition_paths = runtime_registries.get(ref["graph_id"], set())
            if ref["locator"] not in registered_condition_paths:
                findings.append(_finding(
                    "missing_target", f"{path}/locator",
                    "condition path is absent from the production RuleGraph condition registry",
                ))
            if not SEMANTIC_ID_RE.fullmatch(ref["semantic_id"]):
                findings.append(_finding(
                    "invalid_semantic_id", f"{path}/semantic_id", "fact id must be namespaced semantic id"
                ))
            resolved[ref_id] = {"node_id": ref["semantic_id"], "node_kind": ref["node_kind"]}

    # Resolver refs depend on already-resolved RuleGraph declaration refs.
    resolver_indexes: dict[str, Mapping[str, Any]] = {}
    for ref_id, ref in references.items():
        if ref["reference_kind"] != "resolver-capability":
            continue
        path = ref_paths[ref_id]
        graph = graphs.get(ref["graph_id"])
        if graph is None:
            continue
        if graph["graph_kind"] != "execution":
            findings.append(_finding(
                "wrong_graph_kind", f"{path}/graph_id", "resolver-capability requires execution graph kind"
            ))
        declaration = references.get(ref["declaration_ref_id"])
        declared_node = resolved.get(ref["declaration_ref_id"])
        if (
            declaration is None
            or declared_node is None
            or declaration.get("semantic_id") != ref["semantic_id"]
            or declared_node.get("node_kind") != "capability"
            or (declared_node.get("properties") or {}).get("resolver_capability") != ref["locator"]
        ):
            findings.append(_finding(
                "capability_declaration_mismatch", f"{path}/declaration_ref_id",
                "execution capability must bind the matching RuleGraph capability declaration",
            ))
            continue
        tokens = ref["semantic_id"].split(":")
        ruleset_id = tokens[1] if len(tokens) > 2 else ""
        try:
            if ruleset_id not in resolver_indexes:
                resolver_indexes[ruleset_id] = _resolver_index(ruleset_id)
            index = resolver_indexes[ruleset_id]
        except (ImportError, OSError, ValueError) as exc:
            findings.append(_finding("runtime_registry_unreadable", f"{path}/locator", str(exc)))
            continue
        if ref["locator"] not in index:
            findings.append(_finding(
                "missing_target", f"{path}/locator", "capability is absent from resolver public_api_index"
            ))
        if not SEMANTIC_ID_RE.fullmatch(ref["semantic_id"]):
            findings.append(_finding(
                "invalid_semantic_id", f"{path}/semantic_id", "capability id must be namespaced semantic id"
            ))
        resolved[ref_id] = {"node_id": ref["semantic_id"], "node_kind": ref["node_kind"]}

    relation_ids: set[str] = set()
    adjacency: dict[str, list[str]] = {}
    for index, relation in enumerate(registry["relations"]):
        path = f"/relations/{index}"
        if relation["relation_id"] in relation_ids:
            findings.append(_finding(
                "duplicate_relation_id", f"{path}/relation_id", relation["relation_id"]
            ))
        relation_ids.add(relation["relation_id"])
        source = references.get(relation["from_ref"])
        target = references.get(relation["to_ref"])
        if source is None:
            findings.append(_finding("missing_source", f"{path}/from_ref", relation["from_ref"]))
            continue
        if target is None:
            findings.append(_finding("missing_target", f"{path}/to_ref", relation["to_ref"]))
            continue
        source_graph = graphs.get(source["graph_id"])
        target_graph = graphs.get(target["graph_id"])
        if source_graph is None or target_graph is None:
            continue
        spec = relation_specs[relation["relation_kind"]]
        source_kind = source_graph["graph_kind"]
        target_kind = target_graph["graph_kind"]
        effect = spec["authority_effect"]
        if source_kind in {"director", "text"} and effect in {
            "execution-request", "effect-declaration", "state-mutation"
        }:
            findings.append(_finding(
                "authority_violation", path,
                f"{source_kind} cannot claim {effect} authority",
            ))
        if source_kind not in spec["source_graph_kinds"]:
            findings.append(_finding(
                "wrong_source_graph_kind", f"{path}/from_ref",
                f"{relation['relation_kind']} does not allow {source_kind}",
            ))
        if target_kind not in spec["target_graph_kinds"]:
            findings.append(_finding(
                "wrong_target_graph_kind", f"{path}/to_ref",
                f"{relation['relation_kind']} does not allow {target_kind}",
            ))
        if target["node_kind"] not in spec["target_node_kinds"]:
            findings.append(_finding(
                "wrong_target_node_kind", f"{path}/to_ref",
                f"{relation['relation_kind']} does not allow {target['node_kind']}",
            ))
        adjacency.setdefault(relation["from_ref"], []).append(relation["to_ref"])

        source_node = resolved.get(relation["from_ref"])
        target_node = resolved.get(relation["to_ref"])
        if relation["relation_kind"] == "requires-live-state-fact" and source_node and target_node:
            source_artifact = loaded_graphs.get(source["graph_id"], {})
            condition_ids = {
                row.get("to_node_id")
                for row in source_artifact.get("relations", [])
                if isinstance(row, dict)
                and row.get("relation_kind") == "available-when"
                and row.get("from_node_id") == source_node.get("node_id")
            }
            condition_paths: set[str] = set()
            for row in source_artifact.get("nodes", []):
                if isinstance(row, dict) and row.get("node_id") in condition_ids:
                    condition_paths.update(_condition_paths((row.get("properties") or {}).get("expression")))
            if target.get("locator") not in condition_paths:
                findings.append(_finding(
                    "fact_dependency_not_declared", path,
                    "RuleDecision availability does not read the registered live-state fact",
                ))
        elif relation["relation_kind"] == "invokes-capability" and source_node:
            source_artifact = loaded_graphs.get(source["graph_id"], {})
            declaration = references.get(target.get("declaration_ref_id", ""), {})
            if not any(
                isinstance(row, dict)
                and row.get("relation_kind") == "invokes"
                and row.get("from_node_id") == source_node.get("node_id")
                and row.get("to_node_id") == declaration.get("semantic_id")
                for row in source_artifact.get("relations", [])
            ):
                findings.append(_finding(
                    "capability_invocation_not_declared", path,
                    "RuleGraph does not declare the matching decision invokes capability relation",
                ))
        elif relation["relation_kind"] == "may-emit-effect" and source_node and target_node:
            source_artifact = loaded_graphs.get(source["graph_id"], {})
            if not any(
                isinstance(row, dict)
                and row.get("relation_kind") == "emits"
                and row.get("from_node_id") == source_node.get("node_id")
                and row.get("to_node_id") == target_node.get("node_id")
                for row in source_artifact.get("relations", [])
            ):
                findings.append(_finding(
                    "effect_emission_not_declared", path,
                    "RuleGraph does not declare the matching decision emits effect relation",
                ))

    # Cycles are checked at exact semantic-reference granularity.  Legitimate
    # two-way graph-kind dependencies remain possible when they involve
    # different facts; circular authority for the same references fails.
    visiting: set[str] = set()
    visited: set[str] = set()
    cycle_reported = False

    def visit(node: str) -> bool:
        if node in visiting:
            return True
        if node in visited:
            return False
        visiting.add(node)
        for target in adjacency.get(node, []):
            if visit(target):
                return True
        visiting.remove(node)
        visited.add(node)
        return False

    for ref_id in sorted(references):
        if visit(ref_id):
            cycle_reported = True
            break
    if cycle_reported:
        findings.append(_finding(
            "cross_graph_authority_cycle", "/relations",
            "typed composition relations must not form a semantic authority cycle",
        ))

    coverage_rows: dict[str, dict[str, Any]] = {}
    for index, row in enumerate(registry["coverage"]):
        if row["graph_kind"] in coverage_rows:
            findings.append(_finding(
                "duplicate_coverage_kind", f"/coverage/{index}/graph_kind", row["graph_kind"]
            ))
        coverage_rows[row["graph_kind"]] = row
        for graph_id in row["graph_ids"]:
            graph = graphs.get(graph_id)
            if graph is None or graph["graph_kind"] != row["graph_kind"]:
                findings.append(_finding(
                    "coverage_graph_mismatch", f"/coverage/{index}/graph_ids", graph_id
                ))
        kind_graphs = {
            graph_id
            for graph_id, graph in graphs.items()
            if graph["graph_kind"] == row["graph_kind"]
        }
        if set(row["graph_ids"]) != kind_graphs:
            findings.append(_finding(
                "coverage_graph_mismatch", f"/coverage/{index}/graph_ids",
                "coverage graph_ids must exactly match the declared graph kind",
            ))
        expected_status = {
            "production-artifact": "production-linked",
            "runtime-registry": "runtime-registry-linked",
            "absent-production-artifact": "absent-production-artifact",
        }
        declared_graphs = [graphs[graph_id] for graph_id in kind_graphs]
        statuses = {expected_status[graph["availability"]] for graph in declared_graphs}
        if statuses != {row["status"]}:
            findings.append(_finding(
                "coverage_status_mismatch", f"/coverage/{index}/status",
                "coverage status must match the graph availability declaration",
            ))
    if set(coverage_rows) != expected_kinds:
        findings.append(_finding(
            "coverage_ledger_incomplete", "/coverage",
            "coverage must state the availability of every graph kind",
        ))

    return findings


def validate_file(path: Path | str = REGISTRY_PATH) -> list[dict[str, str]]:
    return validate_registry(_load_json(Path(path)))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("registry", nargs="?", type=Path, default=REGISTRY_PATH)
    args = parser.parse_args(argv)
    try:
        findings = validate_file(args.registry)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
        findings = [_finding("registry_unreadable", "/", str(exc))]
    print(json.dumps({"ok": not findings, "findings": findings}, ensure_ascii=False, indent=2))
    return 0 if not findings else 2


if __name__ == "__main__":
    raise SystemExit(main())
