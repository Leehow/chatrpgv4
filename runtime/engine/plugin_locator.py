"""Single resolution point for the canonical plugin location (Phase 1 seam 4).

Every runtime module resolves the plugin root and its scripts/skills
directories through this locator instead of hand-building
``plugins/coc-keeper/...`` path literals. The default layout is unchanged:
``<repo>/plugins/coc-keeper``. A workspace may override the plugin root with
the optional ``plugin_root`` key in ``.coc/runtime.json`` — an absolute path,
or a path relative to the repository root (the same base as the default).
Workspace-less call sites (import-time bindings) resolve the default.

Stdlib only, no runtime imports beyond the sibling ``paths`` containment
helper, so every runtime module may load this locator without circularity.
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import sys
import threading
from typing import Any, Mapping

DEFAULT_PLUGIN_ID = "coc-keeper"
SCRIPTS_DIRNAME = "scripts"
SKILLS_DIRNAME = "skills"
CURRENT_CAMPAIGN_SCHEMA_VERSION = 2
_WORKSPACE_PLUGIN_ROOT_PREFIX = "@workspace/"


def repo_root() -> Path:
    """Runtime installation root (``runtime/engine/plugin_locator.py``)."""
    return Path(__file__).resolve().parents[2]


def default_plugin_root() -> Path:
    """The built-in plugin root; byte-identical to the previous literals."""
    return repo_root() / "plugins" / DEFAULT_PLUGIN_ID


def _load_paths():
    path = Path(__file__).resolve().parent / "paths.py"
    spec = importlib.util.spec_from_file_location("runtime_paths_plugin_locator", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def _resolve_plugin_root_value(
    value: str, workspace: Path | str | None = None,
) -> Path:
    if value.startswith(_WORKSPACE_PLUGIN_ROOT_PREFIX):
        if workspace is None:
            raise ValueError("workspace-relative frozen plugin root needs workspace")
        relative = value.removeprefix(_WORKSPACE_PLUGIN_ROOT_PREFIX)
        return (Path(workspace).expanduser().resolve(strict=False) / relative).resolve(
            strict=False
        )
    candidate = Path(value).expanduser()
    if not candidate.is_absolute():
        candidate = repo_root() / candidate
    return candidate.resolve(strict=False)


def _plugin_root_override(workspace: Path | str) -> Path | None:
    """Tolerantly read the optional ``plugin_root`` key from ``.coc/runtime.json``.

    Strict validation of the key happens in ``config.load_runtime_config`` at
    the session boundary. This reader never introduces a new failure mode
    into paths that did not previously parse ``runtime.json``: any
    unreadable, malformed, or non-string value resolves to the default.
    """
    try:
        paths = _load_paths()
        root = paths.workspace_root(workspace)
        coc = paths.coc_root(root)
        path = paths.contained_path(coc, coc / "runtime.json")
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, TypeError, ValueError):
        return None
    if not isinstance(raw, dict):
        return None
    value = raw.get("plugin_root")
    if not isinstance(value, str) or not value.strip():
        return None
    return _resolve_plugin_root_value(value, workspace)


def plugin_root(
    workspace: Path | str | None = None,
    *,
    resolved_config: Mapping[str, Any] | None = None,
) -> Path:
    """Resolve the canonical plugin root.

    Default: ``<repo>/plugins/coc-keeper``. When ``workspace`` is given, an
    optional ``plugin_root`` key in that workspace's ``.coc/runtime.json``
    wins (absolute, or relative to the repository root).
    """
    if resolved_config is not None:
        value = resolved_config.get("plugin_root")
        if isinstance(value, str) and value.strip():
            return _resolve_plugin_root_value(value, workspace)
        return default_plugin_root()
    if workspace is not None:
        override = _plugin_root_override(workspace)
        if override is not None:
            return override
    return default_plugin_root()


def plugin_scripts_dir(
    workspace: Path | str | None = None,
    *,
    resolved_config: Mapping[str, Any] | None = None,
) -> Path:
    """Resolve the plugin's scripts directory (toolbox/state/rules modules)."""
    return plugin_root(workspace, resolved_config=resolved_config) / SCRIPTS_DIRNAME


def plugin_skills_dir(
    workspace: Path | str | None = None,
    *,
    resolved_config: Mapping[str, Any] | None = None,
) -> Path:
    """Resolve the plugin's canonical skills tree."""
    return plugin_root(workspace, resolved_config=resolved_config) / SKILLS_DIRNAME


def active_ruleset_binding(
    workspace: Path | str,
    campaign_id: str,
    *,
    resolved_config: Mapping[str, Any] | None = None,
) -> tuple[str, Path, dict[str, Any]]:
    """Validate and return the exact persisted campaign/package binding.

    Runtime uses the same clean-slate boundary as the canonical state layer:
    schema-v2 campaign, exact manifest identity, and package-declared support
    for campaign schema 2. No missing or incompatible binding selects CoC7.
    """
    paths = _load_paths()
    root = paths.workspace_root(workspace)
    campaign = paths.campaign_dir(root, campaign_id)
    campaign_path = paths.contained_path(campaign, campaign / "campaign.json")
    try:
        raw = json.loads(campaign_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("active campaign metadata is unreadable") from exc
    ruleset_id = raw.get("ruleset_id") if isinstance(raw, dict) else None
    campaign_schema = raw.get("schema_version") if isinstance(raw, dict) else None
    if (
        isinstance(campaign_schema, bool)
        or campaign_schema != CURRENT_CAMPAIGN_SCHEMA_VERSION
    ):
        raise ValueError("active campaign schema is unsupported")
    if raw.get("campaign_id") != campaign_id:
        raise ValueError("active campaign identity mismatch")
    if not isinstance(ruleset_id, str) or not ruleset_id:
        raise ValueError("active campaign is missing ruleset_id")

    root_plugin = plugin_root(root, resolved_config=resolved_config)
    rulesets_root = paths.contained_path(root_plugin, root_plugin / "rulesets")
    package = paths.contained_path(rulesets_root, rulesets_root / ruleset_id)
    manifest_path = paths.contained_path(package, package / "manifest.json")
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"unknown or unreadable ruleset {ruleset_id!r}") from exc
    if not isinstance(manifest, dict) or manifest.get("ruleset_id") != ruleset_id:
        raise ValueError(f"ruleset manifest identity mismatch for {ruleset_id!r}")
    schema_versions = manifest.get("schema_versions")
    if (
        not isinstance(schema_versions, dict)
        or isinstance(schema_versions.get("campaign"), bool)
        or schema_versions.get("campaign") != campaign_schema
    ):
        raise ValueError(
            f"ruleset {ruleset_id!r} does not support campaign schema "
            f"{campaign_schema!r}"
        )
    return ruleset_id, package, manifest


def active_ruleset_skills_dir(
    workspace: Path | str,
    campaign_id: str,
    *,
    resolved_config: Mapping[str, Any] | None = None,
) -> Path:
    """Resolve the strict active binding's manifest-declared skill pack."""
    paths = _load_paths()
    ruleset_id, package, manifest = active_ruleset_binding(
        workspace, campaign_id, resolved_config=resolved_config
    )
    entry_points = manifest.get("entry_points")
    skills_ref = entry_points.get("skills") if isinstance(entry_points, dict) else None
    if (
        not isinstance(skills_ref, str)
        or not skills_ref.strip()
        or Path(skills_ref).is_absolute()
    ):
        raise ValueError(f"ruleset {ruleset_id!r} has no valid skills entry point")
    skills = paths.contained_path(package, package / skills_ref)
    if not skills.is_dir():
        raise ValueError(f"ruleset {ruleset_id!r} skills entry point is missing")
    return skills


def keeper_skill_dirs(
    workspace: Path | str,
    campaign_id: str,
    *,
    resolved_config: Mapping[str, Any] | None = None,
) -> tuple[Path, Path]:
    """Kernel protocol skills plus the active ruleset package skills."""
    return (
        plugin_skills_dir(workspace, resolved_config=resolved_config),
        active_ruleset_skills_dir(
            workspace, campaign_id, resolved_config=resolved_config
        ),
    )


def load_plugin_module(module_name: str, path: Path | str):
    """Load one relocated plugin module with its sibling imports isolated.

    Canonical plugin scripts use historical absolute sibling imports such as
    ``import coc_state``. A process may already have loaded those names from a
    different plugin root, so temporarily clear just the target scripts'
    module names while executing, then restore the prior process registry.
    The returned module retains direct references to its correctly rooted
    dependencies without contaminating later sessions.
    """
    lock = getattr(sys, "_chatrpg_plugin_import_lock", None)
    if lock is None:
        lock = threading.RLock()
        setattr(sys, "_chatrpg_plugin_import_lock", lock)
    with lock:
        module_path = Path(path).resolve(strict=False)
        scripts = module_path.parent
        sibling_names = {
            candidate.stem for candidate in scripts.glob("*.py") if candidate.is_file()
        }
        sibling_names.add(module_name)
        saved = {name: sys.modules[name] for name in sibling_names if name in sys.modules}
        for name in sibling_names:
            sys.modules.pop(name, None)
        old_path = list(sys.path)
        try:
            sys.path.insert(0, str(scripts))
            spec = importlib.util.spec_from_file_location(module_name, module_path)
            if spec is None or spec.loader is None:
                raise ImportError(f"plugin module is not loadable: {module_path}")
            module = importlib.util.module_from_spec(spec)
            sys.modules[module_name] = module
            spec.loader.exec_module(module)
            return module
        finally:
            sys.path[:] = old_path
            for name in sibling_names:
                sys.modules.pop(name, None)
            sys.modules.update(saved)
