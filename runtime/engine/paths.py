"""Canonical identifiers and filesystem containment for the runtime boundary."""
from __future__ import annotations

import importlib.util
import os
import re
from pathlib import Path


ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


def _load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def _default_ruleset_state_dirs() -> tuple[str, ...]:
    """Package-owned save dir names from the default ruleset's manifest.

    Workspace-less import-time binding resolves the built-in plugin layout —
    the same rule ``plugin_locator`` documents for import-time call sites.
    Loading the locator by path is cycle-safe: its module top level never
    calls back into this module.
    """
    locator = _load_module(
        "runtime_plugin_locator_paths",
        Path(__file__).resolve().parent / "plugin_locator.py",
    )
    scripts = locator.plugin_scripts_dir()
    rulesets = _load_module("runtime_coc_rulesets_paths", scripts / "coc_rulesets.py")
    return tuple(rulesets.ruleset_state_dirs(rulesets.DEFAULT_RULESET_ID))


# Phase 1 seam 3: ruleset-owned save package directory names are read from
# the active ruleset manifest ``state_dirs`` (docs/ruleset-contract.md §6)
# instead of a kernel literal. The two DIRNAME constants stay declared as the
# named anchors ``campaign_save_paths`` builds concrete per-subsystem files
# under; for coc7 they are exactly the manifest dirs, in manifest order.
INVESTIGATOR_STATE_DIRNAME = "investigator-state"
SANITY_STATE_DIRNAME = "sanity-state"
SAVE_PACKAGE_DIRNAMES = _default_ruleset_state_dirs()


def validate_id(value: str, field: str) -> str:
    """Return a conservative runtime ID or reject it before it reaches a path."""
    if not isinstance(value, str) or not ID_RE.fullmatch(value):
        raise ValueError(f"invalid {field}")
    return value


def workspace_root(workspace: Path | str) -> Path:
    """Return the resolved workspace root without accepting an empty path."""
    try:
        return Path(workspace).expanduser().resolve(strict=False)
    except (OSError, TypeError, ValueError) as exc:
        raise ValueError("invalid workspace") from exc


def contained_path(root: Path | str, candidate: Path | str) -> Path:
    """Resolve ``candidate`` and require it to remain inside ``root``.

    Resolving both operands catches ``..`` segments and symlinks that point
    outside the allowed tree.  The candidate is relative to root when it is
    not already absolute.
    """
    try:
        resolved_root = Path(root).expanduser().resolve(strict=False)
        raw_candidate = Path(candidate).expanduser()
        resolved_candidate = (
            raw_candidate if raw_candidate.is_absolute() else resolved_root / raw_candidate
        ).resolve(strict=False)
        resolved_candidate.relative_to(resolved_root)
    except (OSError, TypeError, ValueError) as exc:
        raise ValueError("path escapes containment") from exc
    return resolved_candidate


def coc_root(workspace: Path | str) -> Path:
    root = workspace_root(workspace)
    return contained_path(root, root / ".coc")


def campaign_dir(workspace: Path | str, campaign_id: str) -> Path:
    campaign_id = validate_id(campaign_id, "campaign_id")
    coc = coc_root(workspace)
    campaigns = contained_path(coc, coc / "campaigns")
    return contained_path(campaigns, campaigns / campaign_id)


def investigator_character_path(workspace: Path | str, investigator_id: str) -> Path:
    investigator_id = validate_id(investigator_id, "investigator_id")
    coc = coc_root(workspace)
    investigators = contained_path(coc, coc / "investigators")
    return contained_path(
        investigators, investigators / investigator_id / "character.json"
    )


def canonical_workspace_relative_path(
    workspace: Path | str,
    candidate: Path | str,
    *,
    field: str,
    allowed_root: Path | str,
) -> str:
    """Canonicalize a caller-supplied path to a workspace-relative POSIX path."""
    try:
        raw_text = os.fspath(candidate)
    except TypeError as exc:
        raise ValueError(f"invalid {field}") from exc
    if not isinstance(raw_text, str) or "\\" in raw_text:
        raise ValueError(f"invalid {field}")
    raw_path = Path(raw_text)
    if not raw_path.is_absolute() and ".." in raw_path.parts:
        raise ValueError(f"invalid {field}")
    root = workspace_root(workspace)
    resolved = contained_path(
        allowed_root,
        raw_path if raw_path.is_absolute() else root / raw_path,
    )
    try:
        return resolved.relative_to(root).as_posix()
    except ValueError as exc:
        raise ValueError(f"invalid {field}") from exc


def campaign_save_paths(campaign: Path | str, investigator_id: str) -> dict[str, Path]:
    """Resolve every runtime state location before an adapter can consume it."""
    investigator_id = validate_id(investigator_id, "investigator_id")
    resolved_campaign = Path(campaign).resolve(strict=False)
    save = contained_path(resolved_campaign, resolved_campaign / "save")
    inv_dir = contained_path(save, save / INVESTIGATOR_STATE_DIRNAME)
    sanity_dir = contained_path(save, save / SANITY_STATE_DIRNAME)
    canonical_sanity = contained_path(
        sanity_dir, sanity_dir / f"{investigator_id}.json"
    )
    legacy_sanity = contained_path(save, save / "sanity.json")
    paths = {
        "campaign": resolved_campaign,
        "save": save,
        "campaign_state": contained_path(resolved_campaign, resolved_campaign / "campaign.json"),
        "world_state": contained_path(save, save / "world-state.json"),
        "pacing_state": contained_path(save, save / "pacing-state.json"),
        "investigator_state": contained_path(inv_dir, inv_dir / f"{investigator_id}.json"),
        "active_scene": contained_path(save, save / "active-scene.json"),
        "subsystem_state": contained_path(save, save / "subsystem-state.json"),
        "combat_state": contained_path(save, save / "combat.json"),
        # Prefer identity-bound state.  The singleton remains a read-only
        # compatibility source until that investigator has migrated once.
        "sanity_state": (
            canonical_sanity if canonical_sanity.is_file() else legacy_sanity
        ),
        "chase_state": contained_path(save, save / "chase.json"),
        "time_state": contained_path(save, save / "time-state.json"),
        "time_triggers": contained_path(save, save / "time-triggers.json"),
    }
    # Runtime adapters and the live-turn engine consume additional save files
    # over time. Validate the complete extant tree on every boundary access so
    # a post-create symlink cannot bypass a stale fixed-name registry.
    if save.is_dir():
        for directory, dirnames, filenames in os.walk(save, followlinks=False):
            for name in [*dirnames, *filenames]:
                contained_path(save, Path(directory) / name)
    return paths
