#!/usr/bin/env python3
"""Ruleset package conformance checks (docs/ruleset-contract.md §9).

Implements the Phase-0 skeleton of the conformance suite: §9 items 1
(manifest schema + id match), 2 (resolver interface presence), 3
(rules-json metadata + rule index), and 5 (skill pack frontmatter).
Item 4 (offline audit snapshots per package) is deferred to Phase 1, when
the first package ships its ``checks/<ruleset>-*-ref.json`` snapshots.

Stdlib + jsonschema only: this module must stay importable without the
``coc_*`` plugin modules so the conformance suite can run standalone.
"""
from __future__ import annotations

import importlib.util
import json
import re
import sys
from pathlib import Path

import jsonschema

SCHEMA_PATH = (
    Path(__file__).resolve().parents[1]
    / "references"
    / "ruleset-manifest-schema.json"
)
RULE_GRAPH_CONTRACT_PATH = (
    Path(__file__).resolve().parents[1]
    / "references"
    / "rule-graph-contract-v1.json"
)
_FAMILY_RUNTIME_OWNERS = {"legacy", "shadow", "graph"}
_FAMILY_LEGACY_SURFACES = {"visible", "hidden", "removed"}
REQUIRED_RESOLVER_ATTRS = ("check", "resource_delta", "public_api_index")
_FRONTMATTER_KEY = re.compile(r"^([A-Za-z_]+):", re.MULTILINE)


def _load_json(path: Path, problems: list[str]) -> dict | None:
    """Parse a JSON file, recording a problem instead of raising."""
    if not path.is_file():
        problems.append(f"{path.name}: file is missing")
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        problems.append(f"{path.name}: failed to parse: {exc}")
        return None


def _check_manifest(package_dir: Path, problems: list[str]) -> dict | None:
    manifest_path = package_dir / "manifest.json"
    manifest = _load_json(manifest_path, problems)
    if manifest is None:
        return None
    if not SCHEMA_PATH.is_file():
        problems.append(f"manifest schema is missing at {SCHEMA_PATH}")
        return manifest
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    try:
        jsonschema.validate(instance=manifest, schema=schema)
    except jsonschema.ValidationError as exc:
        problems.append(f"manifest.json: schema violation: {exc.message}")
    ruleset_id = manifest.get("ruleset_id")
    if ruleset_id != package_dir.name:
        problems.append(
            f"manifest.json: ruleset_id {ruleset_id!r} does not match "
            f"directory name {package_dir.name!r}"
        )
    return manifest


def _check_resolver(package_dir: Path, problems: list[str]) -> None:
    resolver_path = package_dir / "resolver.py"
    if not resolver_path.is_file():
        problems.append("resolver.py: file is missing")
        return
    module_name = f"ruleset_conformance_{package_dir.name}_resolver"
    spec = importlib.util.spec_from_file_location(module_name, resolver_path)
    if spec is None or spec.loader is None:
        problems.append(f"resolver.py: cannot load module spec from {resolver_path}")
        return
    module = importlib.util.module_from_spec(spec)
    try:
        sys.modules[module_name] = module
        spec.loader.exec_module(module)
    except Exception as exc:
        problems.append(f"resolver.py: failed to import: {exc}")
        return
    finally:
        sys.modules.pop(module_name, None)
    for attr in REQUIRED_RESOLVER_ATTRS:
        if not callable(getattr(module, attr, None)):
            problems.append(
                f"resolver.py: missing required callable attribute {attr!r}"
            )


def _check_actor_state_role(manifest: dict | None, problems: list[str]) -> None:
    """Every mandatory resource primitive needs one unambiguous state owner."""
    state_dirs = (manifest or {}).get("state_dirs")
    matches = [
        entry
        for entry in (state_dirs if isinstance(state_dirs, list) else [])
        if isinstance(entry, dict) and entry.get("role") == "actor_state"
    ]
    if len(matches) != 1:
        problems.append(
            "manifest.json: exactly one state_dirs entry must declare role 'actor_state'"
        )


def _check_rules_json(
    package_dir: Path, manifest: dict | None, problems: list[str]
) -> None:
    data_dir = package_dir / "rules-json"
    metadata = _load_json(data_dir / "metadata.json", problems)
    if metadata is not None:
        ruleset_id = (manifest or {}).get("ruleset_id")
        if ruleset_id is not None and metadata.get("ruleset") != ruleset_id:
            problems.append(
                f"rules-json/metadata.json: ruleset "
                f"{metadata.get('ruleset')!r} does not match manifest "
                f"ruleset_id {ruleset_id!r}"
            )
        schema_version = metadata.get("schema_version")
        if not isinstance(schema_version, int) or isinstance(schema_version, bool):
            problems.append(
                "rules-json/metadata.json: schema_version must be an integer"
            )
    index = _load_json(data_dir / "rule-index.json", problems)
    if index is None:
        return
    rules = index.get("rules")
    if not isinstance(rules, list):
        problems.append("rules-json/rule-index.json: 'rules' must be a list")
        return
    seen: set[str] = set()
    for record in rules:
        if not isinstance(record, dict):
            problems.append("rules-json/rule-index.json: rule record is not an object")
            continue
        record_id = record.get("id")
        if record_id in seen:
            problems.append(
                f"rules-json/rule-index.json: duplicate rule id {record_id!r}"
            )
        seen.add(record_id)
        source_table = record.get("source_table")
        if not isinstance(source_table, str) or not (
            data_dir / source_table
        ).is_file():
            problems.append(
                f"rules-json/rule-index.json: rule {record_id!r} source_table "
                f"{source_table!r} does not name an existing file in rules-json/"
            )


def _frontmatter_keys(path: Path) -> set[str] | None:
    """Return frontmatter keys of a SKILL.md, or None when it has none.

    Manual parse in the style of coc_memory._frontmatter: no YAML
    dependency, keys are simple ``name:`` lines.
    """
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        return None
    end = text.find("\n---", 4)
    if end == -1:
        return None
    return set(_FRONTMATTER_KEY.findall(text[4:end]))


def _check_skills(package_dir: Path, problems: list[str]) -> None:
    skills_dir = package_dir / "skills"
    if not skills_dir.is_dir():
        problems.append("skills/: directory is missing")
        return
    for skill_path in sorted(skills_dir.glob("*/SKILL.md")):
        rel = skill_path.relative_to(package_dir)
        keys = _frontmatter_keys(skill_path)
        if keys is None:
            problems.append(f"{rel}: missing YAML frontmatter")
            continue
        for required in ("name", "description"):
            if required not in keys:
                problems.append(
                    f"{skill_path.relative_to(package_dir)}: frontmatter "
                    f"is missing {required!r}"
                )


def _check_rule_families(manifest: dict | None, problems: list[str]) -> None:
    """Validate per-family runtime ownership (contract §2.2).

    Absent ``rule_families`` is legal and defaults every family to
    ``legacy`` runtime ownership with a ``visible`` legacy Keeper surface.
    Present entries must: use the rule-graph contract's family ids; respect
    the owner/surface enums (also schema-enforced); pair with the R1
    entry-point rule (shadow/graph owners require the graph artifacts); and
    obey the promotion pairing law (graph owner cannot keep a visible legacy
    Keeper surface).
    """
    families = (manifest or {}).get("rule_families")
    if families is None:
        return  # default: every family legacy/visible
    if not isinstance(families, list):
        problems.append("manifest.json: rule_families must be an array")
        return

    contract = None
    if RULE_GRAPH_CONTRACT_PATH.is_file():
        try:
            contract = json.loads(RULE_GRAPH_CONTRACT_PATH.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            contract = None
    known_families = set(contract.get("rule_families") or []) if contract else set()

    entry_points = (manifest or {}).get("entry_points") or {}
    graph_declared = isinstance(entry_points.get("rule_graph"), str) and \
        isinstance(entry_points.get("rule_graph_manifest"), str)

    seen: set[str] = set()
    for index, entry in enumerate(families):
        prefix = f"manifest.json: rule_families[{index}]"
        if not isinstance(entry, dict):
            problems.append(f"{prefix}: must be an object")
            continue
        family_id = entry.get("family_id")
        runtime_owner = entry.get("runtime_owner")
        legacy_surface = entry.get("legacy_surface")
        if not isinstance(family_id, str) or not family_id:
            problems.append(f"{prefix}: family_id must be a non-empty string")
            continue
        if family_id in seen:
            problems.append(f"{prefix}: duplicate family_id {family_id!r}")
            continue
        seen.add(family_id)
        if known_families and family_id not in known_families:
            problems.append(
                f"{prefix}: family_id {family_id!r} is not a known rule-graph family"
            )
        if runtime_owner not in _FAMILY_RUNTIME_OWNERS:
            problems.append(
                f"{prefix}: runtime_owner must be one of "
                f"{sorted(_FAMILY_RUNTIME_OWNERS)}"
            )
        if legacy_surface not in _FAMILY_LEGACY_SURFACES:
            problems.append(
                f"{prefix}: legacy_surface must be one of "
                f"{sorted(_FAMILY_LEGACY_SURFACES)}"
            )
        if runtime_owner in {"shadow", "graph"} and not graph_declared:
            problems.append(
                f"{prefix}: runtime_owner {runtime_owner!r} requires the paired "
                "entry_points.rule_graph and entry_points.rule_graph_manifest "
                "(R1 entry-point rule)"
            )
        if runtime_owner == "graph" and legacy_surface == "visible":
            problems.append(
                f"{prefix}: a graph-owned family cannot keep its legacy Keeper "
                "surface visible (spec §7.7)"
            )


def _check_family_ownership_agreement(
    *,
    package_manifest: dict | None,
    graph: dict,
    graph_manifest: dict,
    problems: list[str],
) -> None:
    """Fail closed when the three artifacts disagree on family ownership."""
    families: set[str] = set()
    for entry in (package_manifest or {}).get("rule_families") or []:
        if isinstance(entry, dict) and isinstance(entry.get("family_id"), str):
            families.add(entry["family_id"])
    owner_map = graph.get("family_runtime_ownership") or {}
    surface_map = graph.get("legacy_surface_lifecycle") or {}
    if isinstance(owner_map, dict):
        families.update(str(key) for key in owner_map)
    if isinstance(surface_map, dict):
        families.update(str(key) for key in surface_map)
    promo_map = graph_manifest.get("family_promotion_eligibility") or {}
    if isinstance(promo_map, dict):
        families.update(str(key) for key in promo_map)

    def _package_view(family: str) -> tuple[str, str]:
        for entry in (package_manifest or {}).get("rule_families") or []:
            if isinstance(entry, dict) and entry.get("family_id") == family:
                return (
                    str(entry.get("runtime_owner") or "legacy"),
                    str(entry.get("legacy_surface") or "visible"),
                )
        return ("legacy", "visible")

    for family in sorted(families):
        views: dict[str, tuple[str, str | None]] = {
            "package": _package_view(family),
        }
        if isinstance(owner_map, dict) and (
            family in owner_map or (
                isinstance(surface_map, dict) and family in surface_map
            )
        ):
            views["graph"] = (
                str((owner_map or {}).get(family) or "legacy"),
                str((surface_map or {}).get(family) or "visible"),
            )
        promo = promo_map.get(family) if isinstance(promo_map, dict) else None
        if isinstance(promo, dict) and promo.get("runtime_ownership") in _FAMILY_RUNTIME_OWNERS:
            surf = (
                str(surface_map[family])
                if isinstance(surface_map, dict) and family in surface_map
                else None
            )
            views["graph_manifest"] = (str(promo["runtime_ownership"]), surf)
        package_owner = views["package"][0]
        if package_owner == "graph" and (
            not isinstance(promo, dict)
            or promo.get("promotion_eligible") is not True
        ):
            problems.append(
                f"rule family {family!r}: graph-owned family requires "
                "promotion_eligible true in rule-graph-manifest.json"
            )
        owners = [pair[0] for pair in views.values()]
        surfaces = [pair[1] for pair in views.values() if pair[1] is not None]
        if any(owner != owners[0] for owner in owners):
            problems.append(
                f"rule family {family!r}: runtime_owner disagrees across "
                f"manifest.json / rule-graph.json / rule-graph-manifest.json: {views}"
            )
        if surfaces and any(surface != surfaces[0] for surface in surfaces):
            problems.append(
                f"rule family {family!r}: legacy_surface disagrees across "
                f"manifest.json / rule-graph.json / rule-graph-manifest.json: {views}"
            )


def _check_rule_graph(package_dir: Path, manifest: dict | None, problems: list[str]) -> None:
    """Validate optional rule-graph artifacts when the package declares them.

    Contract (docs/ruleset-contract.md §2): a package MAY declare
    ``entry_points.rule_graph`` and ``entry_points.rule_graph_manifest`` for
    generated RuleGraph artifacts.  Absence is legal — every family then
    defaults to legacy runtime ownership with a visible legacy surface.
    """
    entry_points = (manifest or {}).get("entry_points") or {}
    graph_ref = entry_points.get("rule_graph")
    manifest_ref = entry_points.get("rule_graph_manifest")
    adapter_ref = entry_points.get("rule_graph_adapter")
    graph_declared = isinstance(graph_ref, str)
    manifest_declared = isinstance(manifest_ref, str)
    if graph_ref is not None and not graph_declared:
        problems.append("manifest.json: entry_points.rule_graph must be a path string")
    if manifest_ref is not None and not manifest_declared:
        problems.append("manifest.json: entry_points.rule_graph_manifest must be a path string")
    if adapter_ref is not None and not isinstance(adapter_ref, str):
        problems.append("manifest.json: entry_points.rule_graph_adapter must be a path string")
    if not graph_declared and not manifest_declared:
        return  # no graph artifacts declared; absence is legal
    if graph_declared != manifest_declared:
        problems.append(
            "manifest.json: entry_points.rule_graph and "
            "entry_points.rule_graph_manifest must be declared together"
        )
    if isinstance(adapter_ref, str):
        if not graph_declared or not manifest_declared:
            problems.append(
                "manifest.json: entry_points.rule_graph_adapter requires the paired "
                "RuleGraph artifacts"
            )
        else:
            adapter_path = (package_dir / adapter_ref).resolve()
            if not adapter_path.is_relative_to(package_dir.resolve()):
                problems.append(
                    f"{adapter_ref}: rule graph adapter must stay inside its package"
                )
            elif not adapter_path.is_file():
                problems.append(f"{adapter_ref}: rule graph adapter file is missing")

    graph_path = package_dir / graph_ref if graph_declared else None
    manifest_path = package_dir / manifest_ref if manifest_declared else None

    if graph_ref and graph_path is not None and not graph_path.is_file():
        problems.append(f"{graph_ref}: rule graph file is missing")
    if manifest_ref and manifest_path is not None and not manifest_path.is_file():
        problems.append(f"{manifest_ref}: rule graph manifest file is missing")

    graph = _load_json(graph_path, problems) if graph_ref and graph_path is not None else None
    graph_manifest = _load_json(manifest_path, problems) if manifest_ref and manifest_path is not None else None
    package_manifest = manifest

    if not isinstance(graph_manifest, dict):
        if manifest_ref:
            problems.append(f"{manifest_ref}: rule graph manifest must be an object")
        return

    # Manifest identity fields, per the spec's rule-graph-manifest contract.
    for field in ("contract_id", "ruleset_id", "ruleset_version",
                  "graph_content_digest", "compiler_identity", "review_status"):
        if field not in graph_manifest:
            problems.append(f"{manifest_ref}: missing rule graph manifest field {field!r}")

    contract_id = graph_manifest.get("contract_id")
    if isinstance(contract_id, str) and RULE_GRAPH_CONTRACT_PATH.is_file():
        contract = json.loads(RULE_GRAPH_CONTRACT_PATH.read_text(encoding="utf-8"))
        if contract_id != contract.get("build_manifest_contract_id"):
            problems.append(
                f"{manifest_ref}: contract_id {contract_id!r} does not match "
                f"{contract.get('build_manifest_contract_id')!r}"
            )

    if isinstance(graph, dict) and isinstance(graph_manifest.get("ruleset_id"), str):
        if graph.get("ruleset_id") != graph_manifest.get("ruleset_id"):
            problems.append(
                f"{graph_ref}: ruleset_id does not match the rule graph manifest"
            )

    # A manifest that claims graph runtime ownership must not leave the legacy
    # Keeper surface visible.  Without an accepted source bundle we cannot
    # verify legacy surface, so we only check the manifest declares it.
    if graph_manifest.get("review_status") not in {
        "deterministic-accepted", "accepted"
    }:
        problems.append(
            f"{manifest_ref}: review_status must indicate an accepted build"
        )

    if isinstance(graph, dict):
        _check_family_ownership_agreement(
            package_manifest=package_manifest,
            graph=graph,
            graph_manifest=graph_manifest,
            problems=problems,
        )


def validate_package(package_dir: Path) -> list[str]:
    """Check one ruleset package directory; return human-readable problems.

    An empty list means the package conforms to the Phase-0 checks.
    """
    package_dir = Path(package_dir)
    problems: list[str] = []
    if not package_dir.is_dir():
        return [f"package directory {package_dir} does not exist"]
    manifest = _check_manifest(package_dir, problems)
    _check_actor_state_role(manifest, problems)
    _check_resolver(package_dir, problems)
    _check_rules_json(package_dir, manifest, problems)
    _check_skills(package_dir, problems)
    _check_rule_graph(package_dir, manifest, problems)
    _check_rule_families(manifest, problems)
    return problems
