"""Canonical identifiers and filesystem containment for the runtime boundary."""
from __future__ import annotations

import os
import re
from pathlib import Path


ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


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
    inv_dir = contained_path(save, save / "investigator-state")
    return {
        "campaign": resolved_campaign,
        "save": save,
        "campaign_state": contained_path(resolved_campaign, resolved_campaign / "campaign.json"),
        "world_state": contained_path(save, save / "world-state.json"),
        "pacing_state": contained_path(save, save / "pacing-state.json"),
        "investigator_state": contained_path(inv_dir, inv_dir / f"{investigator_id}.json"),
    }
