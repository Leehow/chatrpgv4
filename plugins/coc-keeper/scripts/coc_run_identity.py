#!/usr/bin/env python3
"""Opaque, durable playtest run identities.

Artifact directory names are presentation only.  A run identity is minted once,
persisted inside the physical artifact with an atomic create, and reused when
that same artifact is reopened.
"""
from __future__ import annotations

import ctypes
import errno
import fnmatch
import hashlib
import io
import json
import os
import stat
import sys
import time
import uuid
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from coc_playtest_runs import open_published_run


RUN_IDENTITY_SCHEMA_VERSION = 2
LEGACY_RUN_IDENTITY_SCHEMA_VERSION = 1
RUN_IDENTITY_FILENAME = "run-identity.json"
RUN_ID_PREFIX = "coc-run-v1:"
PRIVATE_GENERATION_NAMESPACE = ".staging"


class AnchoredRunPath:
    """Small pathlib-compatible view rooted at a retained directory fd."""

    _coc_anchored_path = True

    def __init__(
        self,
        root_fd: int,
        parts: tuple[str, ...] = (),
        pinned_files: dict[tuple[str, ...], bytes] | None = None,
    ) -> None:
        self.root_fd = root_fd
        self.parts = parts
        self._pinned_files = pinned_files or {}

    def __truediv__(self, child: str) -> "AnchoredRunPath":
        raw = str(child)
        pieces = tuple(piece for piece in raw.split("/") if piece not in {"", "."})
        if any(piece == ".." for piece in pieces):
            raise ValueError("anchored run path cannot escape its root")
        return AnchoredRunPath(
            self.root_fd, self.parts + pieces, self._pinned_files
        )

    def __str__(self) -> str:
        return "/".join(self.parts) if self.parts else "."

    def __repr__(self) -> str:
        return f"AnchoredRunPath({str(self)!r})"

    def __lt__(self, other: object) -> bool:
        return str(self) < str(other)

    @property
    def name(self) -> str:
        return self.parts[-1] if self.parts else ""

    @property
    def parent(self) -> "AnchoredRunPath":
        return AnchoredRunPath(
            self.root_fd, self.parts[:-1], self._pinned_files
        )

    @property
    def parents(self) -> tuple["AnchoredRunPath", ...]:
        return tuple(
            AnchoredRunPath(
                self.root_fd, self.parts[:index], self._pinned_files
            )
            for index in range(len(self.parts) - 1, -1, -1)
        )

    @property
    def suffix(self) -> str:
        return Path(self.name).suffix

    def with_name(self, name: str) -> "AnchoredRunPath":
        return self.parent / name

    def relative_to(self, other: object) -> Path:
        other_parts = getattr(other, "parts", ())
        if tuple(self.parts[: len(other_parts)]) != tuple(other_parts):
            raise ValueError("anchored paths are unrelated")
        return Path(*self.parts[len(other_parts):])

    def resolve(self, *args: Any, **kwargs: Any) -> "AnchoredRunPath":
        return self

    def absolute(self) -> "AnchoredRunPath":
        return self

    def _open_dir(self, parts: tuple[str, ...], *, create: bool = False) -> int:
        current = os.dup(self.root_fd)
        try:
            for component in parts:
                if create:
                    try:
                        os.mkdir(component, 0o700, dir_fd=current)
                    except FileExistsError:
                        pass
                following = os.open(
                    component,
                    os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                    dir_fd=current,
                )
                os.close(current)
                current = following
            return current
        except Exception:
            os.close(current)
            raise

    def mkdir(
        self,
        mode: int = 0o777,
        parents: bool = False,
        exist_ok: bool = False,
    ) -> None:
        if not self.parts:
            return
        if parents:
            fd = self._open_dir(self.parts, create=True)
            os.close(fd)
            return
        parent_fd = self._open_dir(self.parts[:-1], create=False)
        try:
            try:
                os.mkdir(self.name, mode, dir_fd=parent_fd)
            except FileExistsError:
                if not exist_ok:
                    raise
        finally:
            os.close(parent_fd)

    def _lstat(self):
        if not self.parts:
            return os.fstat(self.root_fd)
        parent_fd = self._open_dir(self.parts[:-1])
        try:
            return os.stat(self.name, dir_fd=parent_fd, follow_symlinks=False)
        finally:
            os.close(parent_fd)

    def exists(self) -> bool:
        try:
            self._lstat()
        except (FileNotFoundError, NotADirectoryError):
            return False
        return True

    def is_file(self) -> bool:
        try:
            return stat.S_ISREG(self._lstat().st_mode)
        except (FileNotFoundError, NotADirectoryError):
            return False

    def is_dir(self) -> bool:
        try:
            return stat.S_ISDIR(self._lstat().st_mode)
        except (FileNotFoundError, NotADirectoryError):
            return False

    def is_symlink(self) -> bool:
        try:
            return stat.S_ISLNK(self._lstat().st_mode)
        except (FileNotFoundError, NotADirectoryError):
            return False

    def stat(self, *, follow_symlinks: bool = True):
        if follow_symlinks:
            descriptor = self._open_file_fd(os.O_RDONLY)
            try:
                return os.fstat(descriptor)
            finally:
                os.close(descriptor)
        return self._lstat()

    def _open_file_fd(self, flags: int, mode: int = 0o600) -> int:
        if not self.parts:
            return os.dup(self.root_fd)
        create_parent = bool(flags & (os.O_CREAT | os.O_WRONLY | os.O_RDWR))
        parent_fd = self._open_dir(self.parts[:-1], create=create_parent)
        try:
            return os.open(
                self.name,
                flags | os.O_NOFOLLOW,
                mode,
                dir_fd=parent_fd,
            )
        finally:
            os.close(parent_fd)

    def open(
        self,
        mode: str = "r",
        buffering: int = -1,
        encoding: str | None = None,
        errors: str | None = None,
        newline: str | None = None,
    ):
        binary = "b" in mode
        pinned = self._pinned_files.get(self.parts)
        if pinned is not None and not any(flag in mode for flag in "wax+"):
            raw = io.BytesIO(pinned)
            if binary:
                return raw
            return io.TextIOWrapper(
                raw,
                encoding=encoding or "utf-8",
                errors=errors,
                newline=newline,
            )
        updating = "+" in mode
        flags = os.O_RDWR if updating else os.O_RDONLY
        if "w" in mode:
            flags = (os.O_RDWR if updating else os.O_WRONLY) | os.O_CREAT | os.O_TRUNC
        elif "a" in mode:
            flags = (os.O_RDWR if updating else os.O_WRONLY) | os.O_CREAT | os.O_APPEND
        elif "x" in mode:
            flags = (os.O_RDWR if updating else os.O_WRONLY) | os.O_CREAT | os.O_EXCL
        descriptor = self._open_file_fd(flags)
        if binary:
            return os.fdopen(descriptor, mode, buffering=buffering)
        return os.fdopen(
            descriptor,
            mode,
            buffering=buffering,
            encoding=encoding,
            errors=errors,
            newline=newline,
        )

    def read_text(self, encoding: str = "utf-8", errors: str | None = None) -> str:
        with self.open("r", encoding=encoding, errors=errors) as handle:
            return handle.read()

    def read_bytes(self) -> bytes:
        with self.open("rb") as handle:
            return handle.read()

    def write_text(self, data: str, encoding: str = "utf-8", errors=None, newline=None) -> int:
        with self.open("w", encoding=encoding, errors=errors, newline=newline) as handle:
            written = handle.write(data)
        if self.parts in self._pinned_files:
            self._pinned_files[self.parts] = data.encode(
                encoding, errors or "strict"
            )
        return written

    def write_bytes(self, data: bytes) -> int:
        with self.open("wb") as handle:
            written = handle.write(data)
        if self.parts in self._pinned_files:
            self._pinned_files[self.parts] = bytes(data)
        return written

    def unlink(self, missing_ok: bool = False) -> None:
        parent_fd = self._open_dir(self.parts[:-1])
        try:
            try:
                os.unlink(self.name, dir_fd=parent_fd)
            except FileNotFoundError:
                if not missing_ok:
                    raise
        finally:
            os.close(parent_fd)

    def replace(self, target: "AnchoredRunPath") -> "AnchoredRunPath":
        if not getattr(target, "_coc_anchored_path", False) or target.root_fd != self.root_fd:
            raise ValueError("anchored replace requires the same root")
        source_parent = self._open_dir(self.parts[:-1])
        target_parent = target._open_dir(target.parts[:-1], create=True)
        try:
            os.replace(
                self.name,
                target.name,
                src_dir_fd=source_parent,
                dst_dir_fd=target_parent,
            )
        finally:
            os.close(source_parent)
            os.close(target_parent)
        return target

    def iterdir(self):
        directory_fd = self._open_dir(self.parts)
        try:
            names = os.listdir(directory_fd)
        finally:
            os.close(directory_fd)
        return iter(self / name for name in names)

    def glob(self, pattern: str):
        patterns = tuple(part for part in pattern.split("/") if part)
        current = [self]
        for item in patterns:
            following = []
            for base in current:
                if not base.is_dir():
                    continue
                for child in base.iterdir():
                    if fnmatch.fnmatch(child.name, item):
                        following.append(child)
            current = following
        return iter(current)


def is_anchored_path(value: Any) -> bool:
    return getattr(value, "_coc_anchored_path", False) is True


class RunIdentityError(ValueError):
    """A play artifact cannot be bound to one unambiguous campaign run."""

    code = "run_identity_conflict"


class AnchoredRunDirectory:
    """A default run staged outside the swappable playtests pathname.

    The destination directory descriptor remains open until the complete run
    is atomically renamed into place.  Intermediate writers use
    ``staging_path``; no post-allocation pathname lookup can redirect them into
    a replacement ``.coc/playtests`` tree.
    """

    def __init__(
        self,
        final_path: Path,
        staging_path: Path,
        parent_fd: int,
        source_parent_fd: int,
        source_name: str,
        staging_fd: int,
    ) -> None:
        self.final_path = final_path
        self.staging_path = staging_path
        self.parent_fd = parent_fd
        self.source_parent_fd = source_parent_fd
        self.source_name = source_name
        self.staging_fd = staging_fd
        self._committed = False
        self._closed = False

    def activate(self) -> AnchoredRunPath:
        """Return an fd-rooted path facade without changing process cwd."""
        if self._closed:
            raise RunIdentityError("playtest staging activation is invalid")
        info = os.fstat(self.staging_fd)
        if not stat.S_ISDIR(info.st_mode):
            raise RunIdentityError("playtest staging inode is not a directory")
        return AnchoredRunPath(self.staging_fd)

    def _current_source_name(self) -> str:
        expected = os.fstat(self.staging_fd)
        if not stat.S_ISDIR(expected.st_mode):
            raise RunIdentityError("playtest staging inode is not a directory")
        for name in os.listdir(self.source_parent_fd):
            try:
                current = os.stat(
                    name,
                    dir_fd=self.source_parent_fd,
                    follow_symlinks=False,
                )
            except FileNotFoundError:
                continue
            if (
                stat.S_ISDIR(current.st_mode)
                and (current.st_dev, current.st_ino)
                == (expected.st_dev, expected.st_ino)
            ):
                return name
        raise RunIdentityError("playtest staging inode left its trusted parent")

    def _remove_replacement_source_name(self) -> None:
        try:
            info = os.stat(
                self.source_name,
                dir_fd=self.source_parent_fd,
                follow_symlinks=False,
            )
        except FileNotFoundError:
            return
        expected = os.fstat(self.staging_fd)
        if (info.st_dev, info.st_ino) == (expected.st_dev, expected.st_ino):
            return
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
            os.unlink(self.source_name, dir_fd=self.source_parent_fd)

    def assert_parent_binding(self) -> None:
        try:
            by_name = os.stat(self.final_path.parent, follow_symlinks=False)
            by_fd = os.fstat(self.parent_fd)
        except OSError as exc:
            raise RunIdentityError("playtest parent binding was lost") from exc
        if not stat.S_ISDIR(by_name.st_mode) or (
            by_name.st_dev,
            by_name.st_ino,
        ) != (by_fd.st_dev, by_fd.st_ino):
            raise RunIdentityError("playtest parent binding was replaced")

    def commit(self) -> Path:
        if self._closed:
            raise RunIdentityError("playtest allocation is already closed")
        if self._committed:
            return self.final_path
        self.assert_parent_binding()
        generation_parent_fd: int | None = None
        generation_fd: int | None = None
        generation_name = uuid.uuid4().hex
        try:
            try:
                os.mkdir(
                    PRIVATE_GENERATION_NAMESPACE,
                    mode=0o700,
                    dir_fd=self.parent_fd,
                )
            except FileExistsError:
                pass
            generation_parent_fd = os.open(
                PRIVATE_GENERATION_NAMESPACE,
                os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                dir_fd=self.parent_fd,
            )
            os.mkdir(generation_name, mode=0o700, dir_fd=generation_parent_fd)
            generation_fd = os.open(
                generation_name,
                os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                dir_fd=generation_parent_fd,
            )
        except FileExistsError as exc:
            raise RunIdentityError("private playtest generation already exists") from exc
        try:
            _copy_tree_fd(self.staging_fd, generation_fd)
            os.fsync(generation_fd)
            os.fsync(generation_parent_fd)
            _rename_noreplace_at(
                generation_parent_fd,
                generation_name,
                self.parent_fd,
                self.final_path.name,
            )
            # Atomic no-replace rename is the commit authority. From this
            # instruction onward, a complete generation has been published;
            # cleanup must never remove the final entry by name.
            self._committed = True
            os.fsync(self.parent_fd)
            source_name = self._current_source_name()
            _remove_tree_at(self.source_parent_fd, source_name)
            self._remove_replacement_source_name()
            self.assert_parent_binding()
            return self.final_path
        except FileExistsError as exc:
            raise RunIdentityError("allocated playtest destination already exists") from exc
        finally:
            if generation_fd is not None:
                if not self._committed:
                    if self._official_generation_matches(generation_fd):
                        self._committed = True
                    elif generation_parent_fd is not None:
                        _remove_owned_generation(
                            generation_parent_fd, generation_fd
                        )
                os.close(generation_fd)
            if generation_parent_fd is not None:
                os.close(generation_parent_fd)

    def _official_generation_matches(self, generation_fd: int) -> bool:
        try:
            official = os.stat(
                self.final_path.name,
                dir_fd=self.parent_fd,
                follow_symlinks=False,
            )
        except FileNotFoundError:
            return False
        owned = os.fstat(generation_fd)
        return stat.S_ISDIR(official.st_mode) and (
            official.st_dev,
            official.st_ino,
        ) == (owned.st_dev, owned.st_ino)

    def close(self) -> None:
        if self._closed:
            return
        try:
            source_name = self._current_source_name()
            _remove_tree_at(self.source_parent_fd, source_name)
            self._remove_replacement_source_name()
        except (FileNotFoundError, RunIdentityError):
            pass
        os.close(self.staging_fd)
        os.close(self.source_parent_fd)
        os.close(self.parent_fd)
        self._closed = True


def _remove_tree_at(parent_fd: int, name: str) -> None:
    directory_fd = os.open(
        name,
        os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
        dir_fd=parent_fd,
    )
    try:
        for child in os.listdir(directory_fd):
            info = os.stat(child, dir_fd=directory_fd, follow_symlinks=False)
            if stat.S_ISDIR(info.st_mode):
                _remove_tree_at(directory_fd, child)
            else:
                os.unlink(child, dir_fd=directory_fd)
    finally:
        os.close(directory_fd)
    os.rmdir(name, dir_fd=parent_fd)


def _remove_tree_contents_fd(directory_fd: int) -> None:
    """Remove only entries reached through an already-owned directory fd."""
    for name in os.listdir(directory_fd):
        info = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
        if stat.S_ISDIR(info.st_mode):
            child_fd = os.open(
                name,
                os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                dir_fd=directory_fd,
            )
            try:
                _remove_tree_contents_fd(child_fd)
                current = os.stat(
                    name, dir_fd=directory_fd, follow_symlinks=False
                )
                opened = os.fstat(child_fd)
                if (current.st_dev, current.st_ino) == (
                    opened.st_dev,
                    opened.st_ino,
                ):
                    os.rmdir(name, dir_fd=directory_fd)
            finally:
                os.close(child_fd)
        else:
            os.unlink(name, dir_fd=directory_fd)


def _remove_owned_generation(parent_fd: int, generation_fd: int) -> None:
    """Clean only the private generation whose inode this handle owns."""
    expected = os.fstat(generation_fd)
    _remove_tree_contents_fd(generation_fd)
    for name in os.listdir(parent_fd):
        try:
            current = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
        except FileNotFoundError:
            continue
        if not stat.S_ISDIR(current.st_mode) or (
            current.st_dev,
            current.st_ino,
        ) != (expected.st_dev, expected.st_ino):
            continue
        # Reopen and recheck immediately before unlinking the empty owned dir.
        opened_fd = os.open(
            name,
            os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
            dir_fd=parent_fd,
        )
        try:
            opened = os.fstat(opened_fd)
            named = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
            if (opened.st_dev, opened.st_ino) == (
                expected.st_dev,
                expected.st_ino,
            ) and (named.st_dev, named.st_ino) == (
                expected.st_dev,
                expected.st_ino,
            ):
                os.rmdir(name, dir_fd=parent_fd)
        finally:
            os.close(opened_fd)
        return


def _rename_noreplace_at(
    source_parent_fd: int,
    source_name: str,
    destination_parent_fd: int,
    destination_name: str,
) -> None:
    """Atomically publish a directory without replacing an existing entry."""
    libc = ctypes.CDLL(None, use_errno=True)
    if sys.platform == "darwin" and hasattr(libc, "renameatx_np"):
        rename = libc.renameatx_np
        rename.argtypes = [
            ctypes.c_int,
            ctypes.c_char_p,
            ctypes.c_int,
            ctypes.c_char_p,
            ctypes.c_uint,
        ]
        rename.restype = ctypes.c_int
        result = rename(
            source_parent_fd,
            os.fsencode(source_name),
            destination_parent_fd,
            os.fsencode(destination_name),
            0x00000004,  # RENAME_EXCL
        )
    elif hasattr(libc, "renameat2"):
        rename = libc.renameat2
        rename.argtypes = [
            ctypes.c_int,
            ctypes.c_char_p,
            ctypes.c_int,
            ctypes.c_char_p,
            ctypes.c_uint,
        ]
        rename.restype = ctypes.c_int
        result = rename(
            source_parent_fd,
            os.fsencode(source_name),
            destination_parent_fd,
            os.fsencode(destination_name),
            0x00000001,  # RENAME_NOREPLACE
        )
    else:
        raise RunIdentityError("runtime lacks atomic no-replace publication")
    if result == 0:
        return
    error = ctypes.get_errno()
    if error in {errno.EEXIST, errno.ENOTEMPTY}:
        raise FileExistsError(error, os.strerror(error), destination_name)
    raise OSError(error, os.strerror(error), destination_name)


def _copy_tree_fd(source_fd: int, destination_fd: int) -> None:
    for name in os.listdir(source_fd):
        info = os.stat(name, dir_fd=source_fd, follow_symlinks=False)
        if stat.S_ISDIR(info.st_mode):
            os.mkdir(name, mode=info.st_mode & 0o777, dir_fd=destination_fd)
            source_child = os.open(
                name,
                os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                dir_fd=source_fd,
            )
            destination_child = os.open(
                name,
                os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                dir_fd=destination_fd,
            )
            try:
                _copy_tree_fd(source_child, destination_child)
                os.fsync(destination_child)
            finally:
                os.close(source_child)
                os.close(destination_child)
        elif stat.S_ISREG(info.st_mode):
            source_file = os.open(
                name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=source_fd
            )
            destination_file = os.open(
                name,
                os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                info.st_mode & 0o777,
                dir_fd=destination_fd,
            )
            try:
                while True:
                    chunk = os.read(source_file, 1024 * 1024)
                    if not chunk:
                        break
                    view = memoryview(chunk)
                    while view:
                        view = view[os.write(destination_file, view):]
                os.fsync(destination_file)
            finally:
                os.close(source_file)
                os.close(destination_file)
        else:
            raise RunIdentityError("playtest generation contains an unsafe entry")


def normalize_run_id(value: Any) -> str:
    if (
        not isinstance(value, str)
        or not value.strip()
        or value != value.strip()
    ):
        raise RunIdentityError("run_id must be a non-empty string")
    return value


def mint_run_id() -> str:
    """Mint an opaque identifier; campaign scope is bound by the identity file."""
    return f"{RUN_ID_PREFIX}{uuid.uuid4().hex}"


def _artifact_location_sha256(run_dir: Path | str) -> str:
    """Hash the canonical current-artifact location without persisting its path."""
    try:
        raw = Path(run_dir)
        canonical = (
            raw.resolve(strict=True)
            if raw.exists()
            else raw.parent.resolve(strict=True) / raw.name
        )
    except OSError as exc:
        raise RunIdentityError(
            "artifact location cannot be resolved"
        ) from exc
    return hashlib.sha256(str(canonical).encode("utf-8")).hexdigest()


def _identity_body(
    campaign_id: str,
    run_id: str,
    *,
    artifact_location_sha256: str,
) -> dict[str, Any]:
    campaign = str(campaign_id).strip()
    if not campaign:
        raise RunIdentityError("campaign_id must be a non-empty string")
    return {
        "schema_version": RUN_IDENTITY_SCHEMA_VERSION,
        "campaign_id": campaign,
        "run_id": normalize_run_id(run_id),
        "artifact_location_sha256": artifact_location_sha256,
    }


def read_artifact_run_identity(run_dir: Path | str) -> dict[str, Any] | None:
    """Read an identity as historical evidence without asserting current location.

    Location validation belongs to :func:`ensure_artifact_run_identity`.  This
    distinction keeps completed artifacts portable when used only as a resume
    source while preventing a copied artifact from becoming a second current
    run instance.
    """
    with open_published_run(
        run_dir, purpose="run identity read", allow_missing=True
    ) as directory:
        if directory is None:
            return None
        return _read_identity_from_open_run(directory)


def _read_identity_from_open_run(directory: AnchoredRunPath) -> dict[str, Any] | None:
    path = directory / RUN_IDENTITY_FILENAME
    if not path.exists() and not path.is_symlink():
        return None
    try:
        mode = path._lstat().st_mode if is_anchored_path(path) else path.lstat().st_mode
    except OSError as exc:
        raise RunIdentityError("artifact run identity is unreadable") from exc
    if not stat.S_ISREG(mode):
        raise RunIdentityError("artifact run identity is not a regular file")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise RunIdentityError("artifact run identity is unreadable") from exc
    if not isinstance(payload, dict):
        raise RunIdentityError("artifact run identity has an invalid contract")
    schema_version = payload.get("schema_version")
    expected_keys = (
        {"schema_version", "campaign_id", "run_id"}
        if schema_version == LEGACY_RUN_IDENTITY_SCHEMA_VERSION
        else {
            "schema_version",
            "campaign_id",
            "run_id",
            "artifact_location_sha256",
        }
        if schema_version == RUN_IDENTITY_SCHEMA_VERSION
        else set()
    )
    location_witness = payload.get("artifact_location_sha256")
    if (
        not isinstance(schema_version, int)
        or isinstance(schema_version, bool)
        or set(payload) != expected_keys
        or not isinstance(payload.get("campaign_id"), str)
        or not payload["campaign_id"].strip()
        or payload["campaign_id"] != payload["campaign_id"].strip()
        or not isinstance(payload.get("run_id"), str)
        or not payload["run_id"].strip()
        or payload["run_id"] != payload["run_id"].strip()
        or (
            schema_version == RUN_IDENTITY_SCHEMA_VERSION
            and (
                not isinstance(location_witness, str)
                or len(location_witness) != 64
                or any(char not in "0123456789abcdef" for char in location_witness)
            )
        )
    ):
        raise RunIdentityError("artifact run identity has an invalid contract")
    return payload


def _validate_current_identity(
    identity: dict[str, Any],
    directory: Path,
    campaign: str,
    requested: str | None,
) -> str:
    if identity["campaign_id"] != campaign:
        raise RunIdentityError(
            "artifact run identity belongs to a different campaign"
        )
    if identity["schema_version"] != RUN_IDENTITY_SCHEMA_VERSION:
        raise RunIdentityError(
            "legacy current artifact identity cannot prove its physical location"
        )
    if identity["artifact_location_sha256"] != _artifact_location_sha256(directory):
        raise RunIdentityError(
            "artifact run identity belongs to a different physical location"
        )
    if requested is not None and identity["run_id"] != requested:
        raise RunIdentityError(
            "artifact run identity conflicts with the requested run_id"
        )
    return str(identity["run_id"])


def _fsync_directory(path: Path) -> None:
    flags = os.O_RDONLY
    if hasattr(os, "O_DIRECTORY"):
        flags |= os.O_DIRECTORY
    try:
        fd = os.open(path, flags)
    except OSError:
        return
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def ensure_artifact_run_identity(
    run_dir: Path | str,
    campaign_id: str,
    *,
    requested_run_id: str | None = None,
    artifact_location_path: Path | str | None = None,
) -> str:
    """Atomically create or validate one physical artifact's identity.

    Concurrent unrequested opens converge on the winning persisted identity.
    A caller that already owns a run ID must match the persisted value exactly.
    """
    directory = run_dir if is_anchored_path(run_dir) else Path(run_dir)
    directory.mkdir(parents=True, exist_ok=True)
    campaign = str(campaign_id).strip()
    if not campaign:
        raise RunIdentityError("campaign_id must be a non-empty string")
    requested = (
        normalize_run_id(requested_run_id)
        if requested_run_id is not None
        else None
    )

    location_directory = Path(artifact_location_path or directory)
    existing = read_artifact_run_identity(directory)
    if existing is not None:
        return _validate_current_identity(
            existing,
            location_directory,
            campaign,
            requested,
        )

    candidate = requested or mint_run_id()
    body = _identity_body(
        campaign,
        candidate,
        artifact_location_sha256=_artifact_location_sha256(location_directory),
    )
    encoded = (
        json.dumps(body, ensure_ascii=False, indent=2) + "\n"
    ).encode("utf-8")
    target = directory / RUN_IDENTITY_FILENAME
    if is_anchored_path(directory):
        try:
            with target.open("xb") as handle:
                handle.write(encoded)
                handle.flush()
                os.fsync(handle.fileno())
            os.fsync(directory.root_fd)
            return candidate
        except FileExistsError:
            existing = read_artifact_run_identity(directory)
            if existing is None:
                raise RunIdentityError(
                    "artifact run identity publication was indeterminate"
                )
            return _validate_current_identity(
                existing,
                location_directory,
                campaign,
                requested,
            )
    temp = directory / f".{RUN_IDENTITY_FILENAME}.{os.getpid()}.{uuid.uuid4().hex}.tmp"
    try:
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        fd = os.open(temp, flags, 0o600)
        with os.fdopen(fd, "wb") as handle:
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
        try:
            os.link(temp, target)
            _fsync_directory(directory)
            return candidate
        except FileExistsError:
            # Another opener won the atomic publication race.  Unrequested
            # reentry adopts that durable identity; requested callers compare.
            existing = read_artifact_run_identity(directory)
            if existing is None:
                raise RunIdentityError(
                    "artifact run identity publication was indeterminate"
                )
            return _validate_current_identity(
                existing,
                location_directory,
                campaign,
                requested,
            )
    finally:
        try:
            temp.unlink()
        except FileNotFoundError:
            pass


def allocate_default_run_dir(
    parent: Path | str,
    *,
    stamp: str | None = None,
    trusted_root: Path | str | None = None,
) -> Path | AnchoredRunDirectory:
    """Atomically allocate a unique default artifact directory."""
    root = Path(parent).absolute()
    timestamp = stamp or time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    if trusted_root is None:
        root.mkdir(parents=True, exist_ok=True)
        for _attempt in range(128):
            candidate = root / f"live-match-{timestamp}-{uuid.uuid4().hex[:12]}"
            try:
                candidate.mkdir()
            except FileExistsError:
                continue
            return candidate
        raise RunIdentityError("could not allocate a unique playtest run directory")

    anchor = Path(trusted_root).absolute()
    try:
        relative = root.relative_to(anchor)
    except ValueError as exc:
        raise RunIdentityError("playtest parent escapes trusted root") from exc
    opened: list[int] = []
    try:
        current_fd = os.open(
            anchor, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
        )
        opened.append(current_fd)
        for component in relative.parts:
            try:
                child_fd = os.open(
                    component,
                    os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                    dir_fd=current_fd,
                )
            except FileNotFoundError:
                os.mkdir(component, mode=0o700, dir_fd=current_fd)
                child_fd = os.open(
                    component,
                    os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                    dir_fd=current_fd,
                )
            current_fd = child_fd
            opened.append(current_fd)
        for _attempt in range(128):
            basename = f"live-match-{timestamp}-{uuid.uuid4().hex[:12]}"
            try:
                os.stat(basename, dir_fd=current_fd, follow_symlinks=False)
            except FileNotFoundError:
                source_name = f".coc-run-stage-{basename}-{uuid.uuid4().hex}"
                try:
                    os.mkdir(source_name, mode=0o700, dir_fd=opened[0])
                except FileExistsError:
                    continue
                staging_fd = os.open(
                    source_name,
                    os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                    dir_fd=opened[0],
                )
                return AnchoredRunDirectory(
                    root / basename,
                    anchor / source_name,
                    os.dup(current_fd),
                    os.dup(opened[0]),
                    source_name,
                    staging_fd,
                )
            else:
                continue
        raise RunIdentityError("could not allocate a unique playtest run directory")
    finally:
        for directory_fd in reversed(opened):
            os.close(directory_fd)
