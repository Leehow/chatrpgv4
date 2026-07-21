#!/usr/bin/env python3
"""Ruleset registry (docs/ruleset-contract.md).

Single resolution point for ruleset package discovery, rules-data paths, and
manifest facts. Phase 1 seam 1b: campaigns persist ``ruleset_id`` at creation,
and every rules-data path in the plugin derives from ``ruleset_data_dir``
instead of hand-building ``rulesets/<id>/rules-json``. Phase 1 seam 3: kernel
machinery reads resource lists, package-owned state directories, and
localization boundary terms from the active ruleset's ``manifest.json``
through the accessors below instead of hardcoding CoC literals. Phase 1 seam
2: toolbox ``rules.*`` handlers obtain the active campaign's resolver through
``get_resolver`` below instead of importing ruleset execution modules
directly. Behavior is identical for the ``coc7`` reference package.

Stdlib only, no plugin imports: every sibling module may load this registry
without circularity. Resolvers load lazily inside ``get_resolver`` (importlib,
per-id cache), never at module import time.
"""
from __future__ import annotations

from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import sys
from types import ModuleType
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
PLUGIN_ROOT = SCRIPT_DIR.parent
RULESETS_ROOT = PLUGIN_ROOT / "rulesets"

DEFAULT_RULESET_ID = "coc7"


def known_rulesets() -> list[str]:
    """Ids of registered ruleset packages.

    Registration is directory presence per the contract: a package is known
    when ``rulesets/<id>/manifest.json`` exists. There is no central
    registry file to edit.
    """
    if not RULESETS_ROOT.is_dir():
        return []
    return sorted(
        path.name
        for path in RULESETS_ROOT.iterdir()
        if path.is_dir() and (path / "manifest.json").is_file()
    )


def _require_known_ruleset(ruleset_id: str) -> str:
    """Return a registered ruleset id or fail closed."""
    if not isinstance(ruleset_id, str) or not ruleset_id:
        raise ValueError(f"ruleset_id must be a non-empty string, got {ruleset_id!r}")
    known = known_rulesets()
    if ruleset_id not in known:
        raise ValueError(
            f"unknown ruleset {ruleset_id!r}; registered rulesets: "
            f"{', '.join(known) if known else '(none)'}"
        )
    return ruleset_id


def ruleset_data_dir(ruleset_id: str) -> Path:
    """Resolve ``rulesets/<id>/rules-json`` for a registered ruleset id."""
    return RULESETS_ROOT / _require_known_ruleset(ruleset_id) / "rules-json"


_MANIFEST_CACHE: dict[str, dict[str, Any]] = {}


def load_manifest(ruleset_id: str) -> dict[str, Any]:
    """Return the package's ``manifest.json`` as a dict.

    Parsed manifests are cached per id; every call returns a deep copy so
    callers can never mutate the cache. Unknown ids fail closed like
    ``ruleset_data_dir``. Safe before any campaign exists: pass
    ``DEFAULT_RULESET_ID`` (directly or via ``get_campaign_ruleset_id``).
    Shape validation against the manifest schema is the conformance suite's
    job; the accessors below tolerate missing optional keys rather than
    re-validating here.
    """
    ruleset_id = _require_known_ruleset(ruleset_id)
    if ruleset_id not in _MANIFEST_CACHE:
        path = RULESETS_ROOT / ruleset_id / "manifest.json"
        try:
            manifest = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError(
                f"ruleset {ruleset_id!r} manifest unreadable: {exc}"
            ) from exc
        if not isinstance(manifest, dict):
            raise ValueError(f"ruleset {ruleset_id!r} manifest is not an object")
        _MANIFEST_CACHE[ruleset_id] = manifest
    return deepcopy(_MANIFEST_CACHE[ruleset_id])


def ruleset_resources(ruleset_id: str) -> tuple[dict[str, Any], ...]:
    """Declared resources in manifest order (contract §6).

    Each entry keeps the manifest shape (``key``/``display``/``kind``/
    ``reset``/optional ``projected``/``recovery_rule``). Order is load-bearing:
    player-visible mechanics enumerate resources in this exact order.
    """
    resources = load_manifest(ruleset_id).get("resources")
    if not isinstance(resources, list):
        return ()
    return tuple(resource for resource in resources if isinstance(resource, dict))


def ruleset_projected_resource_fields(ruleset_id: str) -> tuple[str, ...]:
    """Investigator-state field names projected to the runtime surface.

    A resource projects only when it carries ``"projected": true`` (default
    ``false`` when the key is absent, per contract §6); the field name is the
    kernel convention ``current_<key>``.
    """
    return tuple(
        f"current_{resource['key']}"
        for resource in ruleset_resources(ruleset_id)
        if resource.get("projected") is True and isinstance(resource.get("key"), str)
    )


def ruleset_state_dirs(ruleset_id: str) -> tuple[str, ...]:
    """Package-owned directory names directly under the campaign ``save/`` dir."""
    state_dirs = load_manifest(ruleset_id).get("state_dirs")
    if not isinstance(state_dirs, list):
        return ()
    return tuple(
        entry["name"]
        for entry in state_dirs
        if isinstance(entry, dict) and isinstance(entry.get("name"), str)
    )


def ruleset_campaign_init_dirs(ruleset_id: str) -> tuple[str, ...]:
    """Campaign-relative package dirs the kernel creates at campaign init.

    Subset of ``state_dirs`` flagged ``create_on_init`` (default ``false``),
    returned as ``save/<name>`` in declared order.
    """
    state_dirs = load_manifest(ruleset_id).get("state_dirs")
    if not isinstance(state_dirs, list):
        return ()
    return tuple(
        f"save/{entry['name']}"
        for entry in state_dirs
        if isinstance(entry, dict)
        and isinstance(entry.get("name"), str)
        and entry.get("create_on_init") is True
    )


def ruleset_boundary_terms(ruleset_id: str) -> frozenset[str]:
    """ASCII machine terms that localize only on token boundaries (contract §6)."""
    terms = load_manifest(ruleset_id).get("boundary_terms")
    if not isinstance(terms, list):
        return frozenset()
    return frozenset(term for term in terms if isinstance(term, str))


def get_campaign_ruleset_id(campaign: dict[str, Any] | None) -> str:
    """Return the campaign's bound ruleset id, or the default.

    Campaign-less contexts (char-gen previews, rule lookups before a
    campaign exists) and campaigns predating the binding keep working by
    falling back to ``DEFAULT_RULESET_ID``. An id that is present but not
    registered also falls back rather than failing closed here — path
    resolution through ``ruleset_data_dir`` is the fail-closed boundary.
    """
    if isinstance(campaign, dict):
        ruleset_id = campaign.get("ruleset_id")
        if isinstance(ruleset_id, str) and ruleset_id in known_rulesets():
            return ruleset_id
    return DEFAULT_RULESET_ID


# Required resolver callables, mirroring ruleset_conformance.REQUIRED_RESOLVER_ATTRS
# (contract §4/§9). Kept as a local literal so this registry stays stdlib-only
# and importable without the conformance module.
_REQUIRED_RESOLVER_ATTRS = ("check", "resource_delta", "public_api_index")

_RESOLVER_CACHE: dict[str, ModuleType] = {}


def get_resolver(campaign: dict[str, Any] | None = None) -> ModuleType:
    """Return the active campaign's ruleset resolver module (contract §4).

    Resolves the campaign's ``ruleset_id`` (the default when the key is
    absent, so pre-binding campaigns and campaign-less contexts keep working),
    loads ``rulesets/<id>/resolver.py`` via importlib, and caches one module
    per ruleset id. Fail-closed with ``ValueError``: an id that is present
    but not registered, a missing/unloadable resolver, or a resolver lacking
    the required callables (``check``/``resource_delta``/``public_api_index``)
    is never silently substituted with another ruleset. Failed loads are not
    cached, so repairing the package and retrying succeeds in-process.

    Phase 2 note: package-contributed ``@tool`` registration (a ruleset
    adding its own toolbox tools) will hang off this same per-campaign
    lookup point once a second ruleset actually needs it; that machinery is
    deliberately descoped in Phase 1 seam 2.
    """
    ruleset_id: Any = None
    if isinstance(campaign, dict):
        ruleset_id = campaign.get("ruleset_id")
    if not isinstance(ruleset_id, str) or not ruleset_id:
        ruleset_id = DEFAULT_RULESET_ID
    _require_known_ruleset(ruleset_id)
    if ruleset_id in _RESOLVER_CACHE:
        return _RESOLVER_CACHE[ruleset_id]
    path = RULESETS_ROOT / ruleset_id / "resolver.py"
    if not path.is_file():
        raise ValueError(f"ruleset {ruleset_id!r} has no resolver.py at {path}")
    module_name = f"coc_ruleset_resolver_{ruleset_id}"
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        raise ValueError(
            f"ruleset {ruleset_id!r} resolver at {path} is not loadable"
        )
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    try:
        spec.loader.exec_module(module)
    except Exception as exc:
        sys.modules.pop(module_name, None)
        raise ValueError(
            f"ruleset {ruleset_id!r} resolver failed to load: {exc}"
        ) from exc
    missing = [
        attr
        for attr in _REQUIRED_RESOLVER_ATTRS
        if not callable(getattr(module, attr, None))
    ]
    if missing:
        sys.modules.pop(module_name, None)
        raise ValueError(
            f"ruleset {ruleset_id!r} resolver is missing required attributes: "
            + ", ".join(missing)
        )
    _RESOLVER_CACHE[ruleset_id] = module
    return module
