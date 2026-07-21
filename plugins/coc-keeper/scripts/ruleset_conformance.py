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


def validate_package(package_dir: Path) -> list[str]:
    """Check one ruleset package directory; return human-readable problems.

    An empty list means the package conforms to the Phase-0 checks.
    """
    package_dir = Path(package_dir)
    problems: list[str] = []
    if not package_dir.is_dir():
        return [f"package directory {package_dir} does not exist"]
    manifest = _check_manifest(package_dir, problems)
    _check_resolver(package_dir, problems)
    _check_rules_json(package_dir, manifest, problems)
    _check_skills(package_dir, problems)
    return problems
