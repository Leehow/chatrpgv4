#!/usr/bin/env python3
"""Validate Pi-Coc module ownership and project mechanical worker scope."""
from __future__ import annotations

import argparse
import ast
import json
from pathlib import Path
from typing import Any, Iterable


REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_MANIFEST = REPO_ROOT / "docs" / "specs" / "pi-coc-module-ownership.json"


class OwnershipError(ValueError):
    pass


def load_manifest(path: Path = DEFAULT_MANIFEST) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise OwnershipError(f"ownership manifest is unreadable: {path}: {exc}") from exc
    if not isinstance(value, dict) or value.get("kind") != "pi_coc_module_ownership":
        raise OwnershipError("ownership manifest kind is invalid")
    return value


def all_modules(manifest: dict[str, Any]) -> list[dict[str, Any]]:
    return [*manifest.get("python_modules", []), *manifest.get("pi_modules", [])]


def module_by_id(manifest: dict[str, Any], module_id: str) -> dict[str, Any]:
    matches = [row for row in all_modules(manifest) if row.get("module_id") == module_id]
    if len(matches) != 1:
        raise OwnershipError(f"unknown or duplicate module_id: {module_id}")
    return matches[0]


def _relative(path: str | Path) -> str:
    candidate = Path(path)
    if candidate.is_absolute():
        try:
            candidate = candidate.resolve().relative_to(REPO_ROOT.resolve())
        except ValueError as exc:
            raise OwnershipError(f"path is outside repository: {path}") from exc
    normalized = candidate.as_posix()
    if normalized.startswith("../") or normalized == "..":
        raise OwnershipError(f"path escapes repository: {path}")
    return normalized.removeprefix("./")


def validate_manifest(manifest: dict[str, Any]) -> dict[str, Any]:
    if manifest.get("active_implementation_track") != "pi-coc":
        raise OwnershipError("active implementation track must be pi-coc")
    modules = all_modules(manifest)
    ids = [str(row.get("module_id") or "") for row in modules]
    if not ids or len(ids) != len(set(ids)) or any(not value for value in ids):
        raise OwnershipError("module ids must be non-empty and unique")

    operations: dict[str, str] = {}
    missing_paths: list[str] = []
    valid_states = set(manifest.get("migration_states", {}))
    for row in modules:
        if row.get("migration_state") not in valid_states:
            raise OwnershipError(
                f"{row['module_id']} has invalid migration_state {row.get('migration_state')!r}"
            )
        for operation in row.get("operation_ids", []):
            prior = operations.get(operation)
            if prior is not None:
                raise OwnershipError(
                    f"operation {operation} is owned by both {prior} and {row['module_id']}"
                )
            operations[operation] = row["module_id"]
        if row.get("migration_state") == "migrated":
            for owned_path in row.get("owned_paths", []):
                normalized = _relative(owned_path)
                if not (REPO_ROOT / normalized).exists():
                    missing_paths.append(normalized)

    expected_count = manifest.get("baseline", {}).get("canonical_operation_count")
    if expected_count != len(operations):
        raise OwnershipError(
            f"manifest operation count is {len(operations)}, expected {expected_count}"
        )
    if missing_paths:
        raise OwnershipError("owned paths do not exist: " + ", ".join(sorted(missing_paths)))
    return {
        "module_count": len(modules),
        "python_module_count": len(manifest.get("python_modules", [])),
        "pi_module_count": len(manifest.get("pi_modules", [])),
        "operation_count": len(operations),
    }


def prompt_projection(
    manifest: dict[str, Any], module_id: str, *, base_commit: str | None = None
) -> str:
    validate_manifest(manifest)
    row = module_by_id(manifest, module_id)
    base = base_commit or str(manifest["baseline"]["commit"])
    focused_validation = [
        *row.get("owned_paths", [])[1:2],
        *row.get("focused_validation", row.get("regression_validation", [])),
    ]
    lines = [
        "[PI_COC_MODULE_SCOPE_V1]",
        f"ACTIVE_IMPLEMENTATION_TRACK={manifest['active_implementation_track']}",
        f"base_commit={base}",
        f"module_id={module_id}",
        f"migration_state={row['migration_state']}",
        "owned_paths:",
        *[f"- {path}" for path in row.get("owned_paths", [])],
        "operation_ids:",
        *[f"- {name}" for name in row.get("operation_ids", [])],
        "may_depend_on:",
        *[f"- {name}" for name in row.get("may_depend_on", [])],
        "implementation_dependencies_read_only:",
        *[f"- {path}" for path in row.get("implementation_dependencies", [])],
        "integration_only_off_limits:",
        *[f"- {path}" for path in manifest.get("integration_only_paths", [])],
        "generated_paths_off_limits:",
        *[f"- {path}" for path in manifest.get("generated_paths", [])],
        f"opposite_track_off_limits={manifest['opposite_track_off_limits']}",
        "focused_validation:",
        *[f"- {path}" for path in focused_validation],
        "[/PI_COC_MODULE_SCOPE_V1]",
    ]
    return "\n".join(lines) + "\n"


def validate_owned_paths(
    manifest: dict[str, Any], module_id: str, paths: Iterable[str | Path]
) -> list[str]:
    validate_manifest(manifest)
    row = module_by_id(manifest, module_id)
    allowed = {_relative(path) for path in row.get("owned_paths", [])}
    forbidden = {
        _relative(path)
        for path in [
            *manifest.get("integration_only_paths", []),
            *manifest.get("generated_paths", []),
        ]
    }
    normalized = [_relative(path) for path in paths]
    violations = [path for path in normalized if path not in allowed or path in forbidden]
    if violations:
        raise OwnershipError(
            f"{module_id} path ownership violation: " + ", ".join(sorted(violations))
        )
    return normalized


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("validate")
    prompt = subparsers.add_parser("prompt")
    prompt.add_argument("module_id")
    prompt.add_argument("--base-commit")
    guard = subparsers.add_parser("guard")
    guard.add_argument("module_id")
    guard.add_argument("paths", nargs="+")
    args = parser.parse_args(argv)

    try:
        manifest = load_manifest(args.manifest)
        if args.command == "validate":
            print(json.dumps({"ok": True, **validate_manifest(manifest)}, indent=2))
        elif args.command == "prompt":
            print(
                prompt_projection(
                    manifest, args.module_id, base_commit=args.base_commit
                ),
                end="",
            )
        else:
            paths = validate_owned_paths(manifest, args.module_id, args.paths)
            print(json.dumps({"ok": True, "paths": paths}, indent=2))
        return 0
    except OwnershipError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, indent=2))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
