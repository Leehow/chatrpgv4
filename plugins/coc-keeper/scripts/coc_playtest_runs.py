#!/usr/bin/env python3
"""Canonical boundary between published playtest runs and private staging."""
from __future__ import annotations

from pathlib import Path
from typing import Iterator, Any


STAGING_NAMESPACE = ".staging"


def is_final_run_name(name: Any) -> bool:
    return isinstance(name, str) and bool(name) and not name.startswith(".")


def _canonical_relative_parts(path: Path) -> tuple[str, ...] | None:
    parts = path.absolute().parts
    marker: int | None = None
    for index in range(len(parts) - 1):
        if parts[index : index + 2] == (".coc", "playtests"):
            marker = index + 2
    return tuple(parts[marker:]) if marker is not None else None


def is_final_run_path(path: Any) -> bool:
    """Reject private/non-final entries when a path is under canonical playtests."""
    if getattr(path, "_coc_anchored_path", False):
        return True
    candidate = Path(path)
    relative = _canonical_relative_parts(candidate)
    if relative is None:
        return True
    return len(relative) == 1 and is_final_run_name(relative[0])


def require_final_run_path(path: Any, *, purpose: str = "playtest consumer") -> Any:
    if not is_final_run_path(path):
        raise ValueError(f"{purpose} requires a published final playtest run")
    return path


def iter_final_run_metadata(playtests_dir: Path) -> Iterator[Path]:
    """Yield playtest.json only from one-level, non-hidden, real run directories."""
    if not playtests_dir.is_dir() or playtests_dir.is_symlink():
        return
    for run_dir in sorted(playtests_dir.iterdir(), key=lambda item: item.name):
        if (
            not is_final_run_name(run_dir.name)
            or run_dir.is_symlink()
            or not run_dir.is_dir()
        ):
            continue
        metadata = run_dir / "playtest.json"
        if metadata.is_symlink() or not metadata.is_file():
            continue
        yield metadata
