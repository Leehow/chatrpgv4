"""Strict, resolved runtime pipeline configuration.

The legacy ``brain`` toggle ambiguously made Pi both a rules proxy and a
narrator.  Runtime v2 makes the composition explicit: deterministic planning
and rules are always local; a model, when configured, is only a bounded player
or narrator component.
"""
from __future__ import annotations

import copy
import importlib.util
import json
import warnings
from pathlib import Path
from typing import Any


CURRENT_SCHEMA_VERSION = 2
_PIPELINE_KEYS = ("schema_version", "planner", "rules", "narrator", "player")
_COMPONENT_KINDS = {
    "planner": frozenset({"deterministic"}),
    "rules": frozenset({"deterministic"}),
    "narrator": frozenset({"template", "pi"}),
    "player": frozenset({"human", "pi"}),
}
_DEFAULT_PIPELINE = {
    "schema_version": CURRENT_SCHEMA_VERSION,
    "planner": {"kind": "deterministic"},
    "rules": {"kind": "deterministic"},
    "narrator": {"kind": "template"},
    "player": {"kind": "human"},
}
ALLOWED_BRAINS = frozenset({"debug", "pi"})  # legacy migration only


def _load_paths_module():
    path = Path(__file__).resolve().parent / "paths.py"
    spec = importlib.util.spec_from_file_location("runtime_paths_config", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def default_runtime_config() -> dict[str, Any]:
    """Return a fresh canonical v2 pipeline (safe to freeze in a session)."""
    return copy.deepcopy(_DEFAULT_PIPELINE)


def _validate_component(name: str, value: Any) -> dict[str, str]:
    if not isinstance(value, dict) or set(value) != {"kind"}:
        raise ValueError(f"runtime.json {name} must be exactly {{'kind': ...}}")
    kind = value.get("kind")
    if not isinstance(kind, str) or kind not in _COMPONENT_KINDS[name]:
        raise ValueError(
            f"runtime.json {name}.kind must be one of "
            f"{sorted(_COMPONENT_KINDS[name])}"
        )
    return {"kind": kind}


def _validate_v2(raw: dict[str, Any]) -> dict[str, Any]:
    if set(raw) != set(_PIPELINE_KEYS):
        raise ValueError(
            "runtime.json v2 keys must be exactly " + ", ".join(_PIPELINE_KEYS)
        )
    schema_version = raw.get("schema_version")
    if isinstance(schema_version, bool) or schema_version != CURRENT_SCHEMA_VERSION:
        raise ValueError("runtime.json schema_version must be integer 2")
    return {
        "schema_version": CURRENT_SCHEMA_VERSION,
        **{name: _validate_component(name, raw[name]) for name in _COMPONENT_KINDS},
    }


def migrate_legacy_brain(raw: dict[str, Any]) -> dict[str, Any]:
    """Resolve v1 ``brain`` config without writing or retaining legacy state."""
    allowed = {"schema_version", "brain"}
    if set(raw) - allowed:
        raise ValueError("legacy runtime.json keys must be schema_version and brain")
    version = raw.get("schema_version", 1)
    if isinstance(version, bool) or not isinstance(version, int) or version != 1:
        raise ValueError("runtime.json schema_version must be integer 1 or 2")
    brain = raw.get("brain", "debug")
    if brain not in ALLOWED_BRAINS:
        raise ValueError(f"invalid brain: {brain!r}; allowed={sorted(ALLOWED_BRAINS)}")
    resolved = default_runtime_config()
    if brain == "pi":
        resolved["narrator"] = {"kind": "pi"}
    warnings.warn(
        "runtime.json 'brain' is deprecated; it was resolved to a v2 "
        "deterministic planner/rules pipeline in memory. Write an explicit "
        "v2 pipeline to remove this warning.",
        DeprecationWarning,
        stacklevel=3,
    )
    return resolved


def load_runtime_config(workspace: Path | str) -> dict[str, Any]:
    """Load and validate a resolved pipeline; legacy migration is in-memory only."""
    paths = _load_paths_module()
    root = paths.workspace_root(workspace)
    coc = paths.coc_root(root)
    path = paths.contained_path(coc, coc / "runtime.json")
    if not path.exists():
        return default_runtime_config()
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("runtime.json must contain a JSON object") from exc
    if not isinstance(raw, dict):
        raise ValueError("runtime.json must be a JSON object")
    version = raw.get("schema_version", 1)
    if isinstance(version, bool) or not isinstance(version, int):
        raise ValueError("runtime.json schema_version must be integer 1 or 2")
    if version == 1:
        return migrate_legacy_brain(raw)
    if version == CURRENT_SCHEMA_VERSION:
        return _validate_v2(raw)
    raise ValueError("runtime.json schema_version must be integer 1 or 2")
