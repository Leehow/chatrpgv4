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

from collections.abc import Mapping
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


def require_registered_ruleset(
    ruleset_id: str,
    *,
    campaign_schema_version: int | None = None,
) -> str:
    """Validate one package binding before durable state is created.

    Directory presence is registration, but campaign creation also verifies
    that the registered manifest identifies that directory and explicitly
    supports the kernel's current campaign schema.  Conformance remains the
    exhaustive package audit; this is the narrow runtime fail-closed boundary.
    """
    ruleset_id = _require_known_ruleset(ruleset_id)
    manifest = load_manifest(ruleset_id)
    if manifest.get("ruleset_id") != ruleset_id:
        raise ValueError(
            f"ruleset {ruleset_id!r} manifest identity does not match its directory"
        )
    if campaign_schema_version is not None:
        versions = manifest.get("schema_versions")
        declared = versions.get("campaign") if isinstance(versions, dict) else None
        if declared != campaign_schema_version or isinstance(declared, bool):
            raise ValueError(
                f"ruleset {ruleset_id!r} does not support campaign schema "
                f"{campaign_schema_version}"
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


def ruleset_actor_state_dir(ruleset_id: str) -> str:
    """Return the package directory owning kernel-visible actor state.

    The manifest role is semantic; callers never infer it from a CoC-specific
    directory name.  Ambiguous or missing ownership fails closed because
    silently selecting a state store would make resource receipts unauditable.
    """
    state_dirs = load_manifest(ruleset_id).get("state_dirs")
    matches = [
        entry.get("name")
        for entry in (state_dirs if isinstance(state_dirs, list) else [])
        if isinstance(entry, dict)
        and entry.get("role") == "actor_state"
        and isinstance(entry.get("name"), str)
    ]
    if len(matches) != 1:
        raise ValueError(
            f"ruleset {ruleset_id!r} must declare exactly one actor_state directory"
        )
    return str(matches[0])


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
    """Return the exact package bound to a campaign.

    ``None`` is the only campaign-less preview context and resolves the
    documented default.  Once a campaign object exists, a missing, malformed,
    or unregistered binding is corruption rather than permission to substitute
    CoC7 silently.
    """
    if campaign is None:
        return DEFAULT_RULESET_ID
    if not isinstance(campaign, dict):
        raise ValueError("campaign ruleset binding requires an object")
    ruleset_id = campaign.get("ruleset_id")
    if not isinstance(ruleset_id, str) or not ruleset_id:
        raise ValueError("campaign ruleset_id must be a non-empty string")
    return _require_known_ruleset(ruleset_id)


# Required resolver callables, mirroring ruleset_conformance.REQUIRED_RESOLVER_ATTRS
# (contract §4/§9). Kept as a local literal so this registry stays stdlib-only
# and importable without the conformance module.
_REQUIRED_RESOLVER_ATTRS = ("check", "resource_delta", "public_api_index")

_RESOLVER_CACHE: dict[str, ModuleType] = {}
_RULE_GRAPH_ADAPTER_CACHE: dict[str, Any] = {}

_DAMAGE_STATE_EFFECT_FIELDS = frozenset({
    "schema_version",
    "actor_id",
    "decision_id",
    "amount",
    "before",
    "after",
    "maximum",
    "occurred_elapsed_minutes",
    "source_event_id",
})


def apply_damage_state_effect(
    resolver: Any,
    actor_state: dict[str, Any],
    event: dict[str, Any],
) -> dict[str, Any]:
    """Apply one optional package-owned consequence of settled damage.

    The kernel supplies only a typed, ruleset-neutral damage event and treats
    actor state as opaque. Packages without ``damage_state_effect`` receive an
    exact deep-copied no-op. A package hook must remain pure: it returns the
    replacement actor-state object and performs no campaign I/O.
    """
    if not isinstance(actor_state, dict):
        raise ValueError("damage state effect requires an actor-state object")
    if (
        not isinstance(event, dict)
        or set(event) != set(_DAMAGE_STATE_EFFECT_FIELDS)
    ):
        raise ValueError("damage state effect event does not match schema version 1")
    exact_ints = (
        event.get("amount"),
        event.get("before"),
        event.get("after"),
        event.get("maximum"),
        event.get("occurred_elapsed_minutes"),
    )
    if (
        event.get("schema_version") != 1
        or not isinstance(event.get("actor_id"), str)
        or not event["actor_id"]
        or not isinstance(event.get("decision_id"), str)
        or not event["decision_id"]
        or any(
            isinstance(value, bool) or not isinstance(value, int)
            for value in exact_ints
        )
        or int(event["amount"]) <= 0
        or not (
            0
            <= int(event["after"])
            < int(event["before"])
            <= int(event["maximum"])
        )
        or int(event["occurred_elapsed_minutes"]) < 0
        or (
            event.get("source_event_id") is not None
            and (
                not isinstance(event.get("source_event_id"), str)
                or not event["source_event_id"]
            )
        )
    ):
        raise ValueError("damage state effect event is invalid")
    hook = getattr(resolver, "damage_state_effect", None)
    if hook is None:
        return deepcopy(actor_state)
    if not callable(hook):
        raise ValueError("ruleset damage_state_effect must be callable")
    projected = hook(
        actor_state=deepcopy(actor_state),
        event=deepcopy(event),
    )
    if not isinstance(projected, dict):
        raise ValueError("ruleset damage_state_effect must return actor state")
    return projected


def resolve_actor_skill_value(
    resolver: Any,
    sheet: Mapping[str, Any] | None,
    skill_name: str,
) -> int | None:
    """Resolve an actor skill without teaching the kernel any ruleset values.

    A canonical sheet value wins. Only an omitted key may consult the active
    package's optional ``skill_base`` hook; absent sheets, corrupt explicit
    values, missing hooks, unknown skills, era-disabled skills, and non-flat
    bases all fail closed with ``None``.
    """
    if not isinstance(sheet, Mapping) or not isinstance(skill_name, str):
        return None
    skills = sheet.get("skills")
    if not isinstance(skills, Mapping):
        return None
    if skill_name in skills:
        raw = skills[skill_name]
        if isinstance(raw, Mapping):
            raw = raw.get("value")
        if isinstance(raw, bool) or raw is None:
            return None
        try:
            value = int(raw)
        except (TypeError, ValueError):
            return None
        return value if 0 <= value <= 100 else None
    hook = getattr(resolver, "skill_base", None)
    if not callable(hook):
        return None
    try:
        value = hook(skill_name, era=sheet.get("era"))
    except (OSError, TypeError, ValueError):
        return None
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or not 0 <= value <= 100
    ):
        return None
    return value


def get_resolver(campaign: dict[str, Any] | None = None) -> ModuleType:
    """Return the active campaign's ruleset resolver module (contract §4).

    Resolves the campaign's ``ruleset_id`` (the default only when no campaign
    exists),
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
    ruleset_id = get_campaign_ruleset_id(campaign)
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


def get_rule_graph_adapter(ruleset_id: str) -> Any | None:
    """Load the optional package-owned composed-settlement adapter.

    The generic RuleGraph runtime never imports a game system directly. A
    package declares this adapter only when some graph decisions need composed
    settlement beyond the generic one-plan/one-executor path.
    """
    ruleset_id = _require_known_ruleset(ruleset_id)
    if ruleset_id in _RULE_GRAPH_ADAPTER_CACHE:
        return _RULE_GRAPH_ADAPTER_CACHE[ruleset_id]
    manifest = load_manifest(ruleset_id)
    entry_points = manifest.get("entry_points")
    ref = entry_points.get("rule_graph_adapter") if isinstance(entry_points, dict) else None
    if ref is None:
        return None
    if not isinstance(ref, str) or not ref:
        raise ValueError(
            f"ruleset {ruleset_id!r} rule_graph_adapter must be a non-empty path"
        )
    package_dir = (RULESETS_ROOT / ruleset_id).resolve()
    path = (package_dir / ref).resolve()
    if not path.is_relative_to(package_dir) or not path.is_file():
        raise ValueError(
            f"ruleset {ruleset_id!r} rule_graph_adapter is missing or escapes its package"
        )
    module_name = f"coc_ruleset_rule_graph_adapter_{ruleset_id}"
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        raise ValueError(
            f"ruleset {ruleset_id!r} RuleGraph adapter at {path} is not loadable"
        )
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    try:
        spec.loader.exec_module(module)
        factory = getattr(module, "create_adapter", None)
        if not callable(factory):
            raise ValueError("create_adapter is missing")
        adapter = factory()
        if not callable(getattr(adapter, "settle", None)):
            raise ValueError("adapter.settle is missing")
    except Exception as exc:
        sys.modules.pop(module_name, None)
        raise ValueError(
            f"ruleset {ruleset_id!r} RuleGraph adapter failed to load: {exc}"
        ) from exc
    _RULE_GRAPH_ADAPTER_CACHE[ruleset_id] = adapter
    return adapter


def rule_graph_state_effect_domains(
    ruleset_id: str,
    decision_ref: str,
) -> tuple[str, ...]:
    """Trusted package declaration for one graph settlement's state domains."""
    adapter = get_rule_graph_adapter(ruleset_id)
    provider = getattr(adapter, "state_effect_domains", None)
    if not callable(provider):
        return ()
    raw = provider(decision_ref)
    if not isinstance(raw, (list, tuple, frozenset)):
        return ()
    declared_resources = {
        resource.get("key")
        for resource in ruleset_resources(ruleset_id)
        if isinstance(resource.get("key"), str)
    }
    allowed = declared_resources | {"condition"}
    domains = tuple(raw)
    if (
        any(not isinstance(domain, str) or domain not in allowed for domain in domains)
        or len(set(domains)) != len(domains)
    ):
        return ()
    return domains
