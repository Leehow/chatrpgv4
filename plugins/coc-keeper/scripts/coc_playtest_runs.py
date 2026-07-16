#!/usr/bin/env python3
"""Canonical boundary between published playtest runs and private staging."""
from __future__ import annotations

import stat
from pathlib import Path
from typing import Any, Iterator


STAGING_NAMESPACE = ".staging"


def is_final_run_name(name: Any) -> bool:
    return isinstance(name, str) and bool(name) and not name.startswith(".")


def _lexical_absolute(path: Path) -> Path:
    if ".." in path.parts:
        raise ValueError("published playtest path cannot contain parent traversal")
    return path if path.is_absolute() else Path.cwd() / path


def _canonical_layout(path: Path) -> tuple[tuple[str, ...], int] | None:
    parts = _lexical_absolute(path).parts
    marker: int | None = None
    for index in range(len(parts) - 1):
        if parts[index : index + 2] == (".coc", "playtests"):
            marker = index + 2
    return (parts, marker) if marker is not None else None


def _real_directory(path: Path) -> bool:
    try:
        return stat.S_ISDIR(path.lstat().st_mode) and not path.is_symlink()
    except OSError:
        return False


def _real_regular_file(path: Path) -> bool:
    try:
        return stat.S_ISREG(path.lstat().st_mode) and not path.is_symlink()
    except OSError:
        return False


def _canonical_ancestors_are_real(
    parts: tuple[str, ...], marker: int
) -> bool:
    coc_dir = Path(*parts[: marker - 1])
    playtests_dir = Path(*parts[:marker])
    return _real_directory(coc_dir) and _real_directory(playtests_dir)


def is_final_run_path(
    path: Any,
    *,
    require_metadata: bool = False,
    allow_missing: bool = False,
) -> bool:
    """Validate a published run without following its directory or metadata leaf."""
    if getattr(path, "_coc_anchored_path", False):
        return True
    try:
        candidate = Path(path)
        absolute = _lexical_absolute(candidate)
        layout = _canonical_layout(candidate)
    except (TypeError, ValueError):
        return False
    if layout is not None:
        parts, marker = layout
        relative = tuple(parts[marker:])
        if len(relative) != 1 or not is_final_run_name(relative[0]):
            return False
        if not _canonical_ancestors_are_real(parts, marker):
            return False
    try:
        absolute.lstat()
    except FileNotFoundError:
        return allow_missing
    except OSError:
        return False
    if not _real_directory(absolute):
        return False
    if require_metadata and not _real_regular_file(absolute / "playtest.json"):
        return False
    return True


def require_final_run_path(
    path: Any,
    *,
    purpose: str = "playtest consumer",
    require_metadata: bool = False,
    allow_missing: bool = False,
) -> Any:
    if not is_final_run_path(
        path,
        require_metadata=require_metadata,
        allow_missing=allow_missing,
    ):
        raise ValueError(f"{purpose} requires a published final playtest run")
    return path


def iter_final_run_metadata(playtests_dir: Path) -> Iterator[Path]:
    """Yield playtest.json only from one-level, non-hidden, real run directories."""
    try:
        layout = _canonical_layout(playtests_dir)
    except ValueError:
        return
    if layout is not None:
        parts, marker = layout
        if tuple(parts[marker:]) or not _canonical_ancestors_are_real(parts, marker):
            return
    elif not _real_directory(_lexical_absolute(playtests_dir)):
        return
    for run_dir in sorted(playtests_dir.iterdir(), key=lambda item: item.name):
        if not is_final_run_path(run_dir, require_metadata=True):
            continue
        metadata = run_dir / "playtest.json"
        yield metadata
