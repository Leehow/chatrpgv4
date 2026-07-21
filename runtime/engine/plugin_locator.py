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

DEFAULT_PLUGIN_ID = "coc-keeper"
SCRIPTS_DIRNAME = "scripts"
SKILLS_DIRNAME = "skills"


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
    candidate = Path(value).expanduser()
    if not candidate.is_absolute():
        candidate = repo_root() / candidate
    return candidate.resolve(strict=False)


def plugin_root(workspace: Path | str | None = None) -> Path:
    """Resolve the canonical plugin root.

    Default: ``<repo>/plugins/coc-keeper``. When ``workspace`` is given, an
    optional ``plugin_root`` key in that workspace's ``.coc/runtime.json``
    wins (absolute, or relative to the repository root).
    """
    if workspace is not None:
        override = _plugin_root_override(workspace)
        if override is not None:
            return override
    return default_plugin_root()


def plugin_scripts_dir(workspace: Path | str | None = None) -> Path:
    """Resolve the plugin's scripts directory (toolbox/state/rules modules)."""
    return plugin_root(workspace) / SCRIPTS_DIRNAME


def plugin_skills_dir(workspace: Path | str | None = None) -> Path:
    """Resolve the plugin's canonical skills tree."""
    return plugin_root(workspace) / SKILLS_DIRNAME
