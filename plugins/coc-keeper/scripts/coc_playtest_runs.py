#!/usr/bin/env python3
"""Canonical boundary between published playtest runs and private staging."""
from __future__ import annotations

from contextlib import contextmanager
from functools import wraps
import os
import stat
from pathlib import Path
from typing import Any, Iterator


STAGING_NAMESPACE = ".staging"
PUBLIC_RESULT_PATH_FIELDS = (
    "report_path",
    "evaluation_report_path",
    "report_completeness_path",
)


def _read_regular_file_at(directory_fd: int, name: str) -> bytes:
    descriptor = os.open(
        name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory_fd
    )
    try:
        if not stat.S_ISREG(os.fstat(descriptor).st_mode):
            raise ValueError("published run metadata is not a regular file")
        chunks: list[bytes] = []
        while True:
            chunk = os.read(descriptor, 1024 * 1024)
            if not chunk:
                return b"".join(chunks)
            chunks.append(chunk)
    finally:
        os.close(descriptor)


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


def _open_directory_at(parent_fd: int, name: str) -> int:
    return os.open(
        name,
        os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
        dir_fd=parent_fd,
    )


@contextmanager
def open_published_run(
    path: Any,
    *,
    purpose: str = "playtest consumer",
    require_metadata: bool = False,
    allow_missing: bool = False,
):
    """Retain the validated run inode for the complete consumer operation."""
    from coc_run_identity import AnchoredRunPath

    if getattr(path, "_coc_anchored_path", False):
        pinned = getattr(path, "_pinned_files", {})
        if not require_metadata or ("playtest.json",) in pinned:
            yield path
            return
        run_fd = path._open_dir(path.parts)
        try:
            try:
                _read_regular_file_at(run_fd, "playtest.json")
            except (OSError, ValueError) as exc:
                raise ValueError(
                    f"{purpose} requires a published final playtest run"
                ) from exc
            yield path
        finally:
            os.close(run_fd)
        return

    try:
        candidate = Path(path)
        absolute = _lexical_absolute(candidate)
        layout = _canonical_layout(candidate)
    except (TypeError, ValueError) as exc:
        raise ValueError(
            f"{purpose} requires a published final playtest run"
        ) from exc

    opened: list[int] = []
    run_fd: int | None = None
    try:
        if layout is not None:
            parts, marker = layout
            relative = tuple(parts[marker:])
            if len(relative) != 1 or not is_final_run_name(relative[0]):
                raise ValueError
            prefix = Path(*parts[: marker - 2])
            current = os.open(
                prefix, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
            )
            opened.append(current)
            for component in (".coc", "playtests", relative[0]):
                current = _open_directory_at(current, component)
                opened.append(current)
            run_fd = current
        else:
            parent_fd = os.open(
                absolute.parent, os.O_RDONLY | os.O_DIRECTORY
            )
            opened.append(parent_fd)
            run_fd = _open_directory_at(parent_fd, absolute.name)
            opened.append(run_fd)
    except FileNotFoundError:
        if allow_missing:
            yield None
            return
        raise ValueError(f"{purpose} requires a published final playtest run")
    except (OSError, ValueError) as exc:
        raise ValueError(
            f"{purpose} requires a published final playtest run"
        ) from exc
    try:
        pinned: dict[tuple[str, ...], bytes] = {}
        if require_metadata:
            try:
                pinned[("playtest.json",)] = _read_regular_file_at(
                    run_fd, "playtest.json"
                )
            except (OSError, ValueError) as exc:
                raise ValueError(
                    f"{purpose} requires a published final playtest run"
                ) from exc
        yield AnchoredRunPath(
            run_fd,
            pinned_files=pinned,
            lexical_path=absolute,
        )
    finally:
        for descriptor in reversed(opened):
            os.close(descriptor)


def published_run_consumer(*, require_metadata: bool = False):
    """Decorate a consumer so all of its run I/O stays fd-anchored."""
    def decorate(function):
        @wraps(function)
        def wrapped(run_dir, *args, **kwargs):
            caller_anchored = getattr(run_dir, "_coc_anchored_path", False)
            with open_published_run(
                run_dir,
                purpose=function.__name__,
                require_metadata=require_metadata,
            ) as anchored:
                result = function(anchored, *args, **kwargs)
                # Consumer implementations may naturally return a child of
                # their anchored input.  Preserve the public API's lexical
                # result for ordinary callers without reopening it internally.
                if (
                    not caller_anchored
                    and getattr(result, "_coc_anchored_path", False)
                ):
                    lexical = Path(run_dir)
                    for part in result.parts:
                        lexical /= part
                    return lexical
                if not caller_anchored and isinstance(result, dict):
                    result = dict(result)
                    for field in PUBLIC_RESULT_PATH_FIELDS:
                        value = result.get(field)
                        if (
                            isinstance(value, str)
                            and value
                            and not Path(value).is_absolute()
                        ):
                            result[field] = str(Path(run_dir) / value)
                return result
        return wrapped
    return decorate


def iter_final_run_metadata(playtests_dir: Path) -> Iterator[Path]:
    """Yield playtest.json only from one-level, non-hidden, real run directories."""
    from coc_run_identity import AnchoredRunPath

    try:
        layout = _canonical_layout(playtests_dir)
    except ValueError:
        return
    opened: list[int] = []
    try:
        try:
            if layout is not None:
                parts, marker = layout
                if tuple(parts[marker:]):
                    return
                prefix = Path(*parts[: marker - 2])
                current = os.open(
                    prefix, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
                )
                opened.append(current)
                for component in (".coc", "playtests"):
                    current = _open_directory_at(current, component)
                    opened.append(current)
                playtests_fd = current
            else:
                playtests_fd = os.open(
                    _lexical_absolute(playtests_dir),
                    os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                )
                opened.append(playtests_fd)
        except OSError:
            return
        for name in sorted(os.listdir(playtests_fd)):
            if not is_final_run_name(name):
                continue
            try:
                run_fd = _open_directory_at(playtests_fd, name)
            except OSError:
                continue
            try:
                try:
                    metadata = _read_regular_file_at(run_fd, "playtest.json")
                except (OSError, ValueError):
                    continue
                yield AnchoredRunPath(
                    run_fd,
                    pinned_files={("playtest.json",): metadata},
                    lexical_path=_lexical_absolute(playtests_dir) / name,
                ) / "playtest.json"
            finally:
                os.close(run_fd)
    finally:
        for descriptor in reversed(opened):
            os.close(descriptor)
