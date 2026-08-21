#!/usr/bin/env python3
"""Atomic text/JSON persistence helpers for campaign save paths.

Crash-safe writes: stage into a same-directory temp file, fsync, then
``os.replace`` onto the target so readers never observe a truncated file.

Also provides an optional advisory ``campaign_lock`` to keep two concurrent
sessions from corrupting one campaign directory.
"""
from __future__ import annotations

import fcntl
import hashlib
import json
import os
import stat
import tempfile
import time
from contextlib import contextmanager
from threading import Condition, Lock
from pathlib import Path
from typing import Any, Iterator


class CampaignLockError(RuntimeError):
    """Raised when a campaign advisory lock cannot be acquired."""


@contextmanager
def advisory_file_lock(
    lock_path: Path,
    *,
    wait_seconds: float = 5.0,
    poll_seconds: float = 0.01,
) -> Iterator[Path]:
    """Cross-process flock for shared resources outside one campaign.

    Unlike ``campaign_lock`` this lock is descriptor-owned, so two threads in
    the same host process still serialize instead of treating the shared PID
    as an accidental nested campaign entry.  The lock file is stable and may
    remain on disk; process exit releases the kernel lock automatically.
    """
    lock_path = Path(lock_path)
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(str(lock_path), os.O_CREAT | os.O_RDWR, 0o600)
    deadline = time.monotonic() + max(0.0, float(wait_seconds))
    try:
        while True:
            try:
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise CampaignLockError(
                        f"shared resource lock busy at {lock_path}"
                    ) from None
                time.sleep(max(0.001, float(poll_seconds)))
        try:
            yield lock_path
        finally:
            fcntl.flock(descriptor, fcntl.LOCK_UN)
    finally:
        os.close(descriptor)


@contextmanager
def advisory_file_lock_at(
    root_fd: int,
    directory_components: tuple[str, ...],
    lock_name: str,
    *,
    display_path: Path,
    wait_seconds: float = 5.0,
    poll_seconds: float = 0.01,
) -> Iterator[Path]:
    """Acquire a lock through one already trusted directory descriptor."""
    components = (*directory_components, lock_name)
    if any(
        not isinstance(item, str)
        or not item
        or item in {".", ".."}
        or "/" in item
        for item in components
    ):
        raise ValueError("descriptor lock path contains an unsafe component")
    opened = [os.dup(root_fd)]
    descriptor: int | None = None
    try:
        current_fd = opened[0]
        for component in directory_components:
            try:
                child_fd = os.open(
                    component,
                    os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                    dir_fd=current_fd,
                )
            except FileNotFoundError:
                try:
                    os.mkdir(component, mode=0o700, dir_fd=current_fd)
                except FileExistsError:
                    pass
                child_fd = os.open(
                    component,
                    os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                    dir_fd=current_fd,
                )
            opened.append(child_fd)
            current_fd = child_fd
        descriptor = os.open(
            lock_name,
            os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW,
            0o600,
            dir_fd=current_fd,
        )
        if not stat.S_ISREG(os.fstat(descriptor).st_mode):
            raise ValueError(f"shared resource lock is not regular: {display_path}")
        deadline = time.monotonic() + max(0.0, float(wait_seconds))
        while True:
            try:
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise CampaignLockError(
                        f"shared resource lock busy at {display_path}"
                    ) from None
                time.sleep(max(0.001, float(poll_seconds)))
        try:
            yield display_path
        finally:
            fcntl.flock(descriptor, fcntl.LOCK_UN)
    finally:
        if descriptor is not None:
            os.close(descriptor)
        for directory_fd in reversed(opened):
            os.close(directory_fd)


def write_text_atomic(path: Path, text: str, encoding: str = "utf-8") -> None:
    """Write ``text`` to ``path`` via temp file + fsync + ``os.replace``."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            "w",
            encoding=encoding,
            dir=path.parent,
            delete=False,
        ) as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
            tmp_path = Path(handle.name)
        os.replace(tmp_path, path)
        tmp_path = None
    except Exception:
        if tmp_path is not None:
            try:
                tmp_path.unlink(missing_ok=True)
            except OSError:
                pass
        raise


def write_json_atomic(
    path: Path,
    payload: Any,
    *,
    indent: int | None = 2,
    ensure_ascii: bool = False,
    trailing_newline: bool = False,
) -> None:
    """Serialize ``payload`` as JSON and write it atomically."""
    text = json.dumps(payload, indent=indent, ensure_ascii=ensure_ascii)
    if trailing_newline:
        text += "\n"
    write_text_atomic(path, text)


def _pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        # Process exists but we cannot signal it.
        return True
    except OSError:
        return False
    return True


def _lock_is_stale(payload: dict[str, Any], *, stale_minutes: float) -> bool:
    pid = int(payload.get("pid") or 0)
    if not _pid_alive(pid):
        return True
    acquired_at = float(payload.get("acquired_at") or 0.0)
    if acquired_at <= 0:
        return True
    age_seconds = time.time() - acquired_at
    return age_seconds > float(stale_minutes) * 60.0


def _read_lock_payload(lock_path: Path) -> dict[str, Any] | None:
    try:
        raw = json.loads(lock_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return None
    return raw if isinstance(raw, dict) else None


def _lock_payload_is_valid(payload: dict[str, Any] | None) -> bool:
    if payload is None:
        return False
    try:
        return int(payload.get("pid") or 0) > 0 and float(
            payload.get("acquired_at") or 0.0
        ) > 0.0
    except (TypeError, ValueError):
        return False


def _unreadable_lock_is_stale(lock_path: Path, *, stale_minutes: float) -> bool:
    """Use file age for a lock whose owner payload is not readable yet."""
    try:
        modified_at = lock_path.stat().st_mtime
    except FileNotFoundError:
        return False
    return time.time() - modified_at > float(stale_minutes) * 60.0


class _ProcessCampaignRWLock:
    """Small process-local companion to the cross-process flock lock."""

    def __init__(self) -> None:
        self._condition = Condition()
        self._readers = 0
        self._writer = False

    def acquire(self, *, shared: bool, deadline: float) -> None:
        with self._condition:
            while self._writer or (not shared and self._readers):
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise CampaignLockError("campaign lock held in this process")
                self._condition.wait(remaining)
            if shared:
                self._readers += 1
            else:
                self._writer = True

    def release(self, *, shared: bool) -> None:
        with self._condition:
            if shared:
                self._readers -= 1
            else:
                self._writer = False
            self._condition.notify_all()


_PROCESS_CAMPAIGN_LOCKS: dict[str, _ProcessCampaignRWLock] = {}
_PROCESS_CAMPAIGN_LOCKS_GUARD = Lock()


def _process_campaign_lock(campaign_dir: Path) -> _ProcessCampaignRWLock:
    key = os.fspath(campaign_dir.resolve())
    with _PROCESS_CAMPAIGN_LOCKS_GUARD:
        return _PROCESS_CAMPAIGN_LOCKS.setdefault(key, _ProcessCampaignRWLock())


def _campaign_rwlock_path(campaign_dir: Path) -> Path:
    """Keep the flock inode outside campaign evidence/state projections."""
    digest = hashlib.sha256(os.fspath(campaign_dir.resolve()).encode("utf-8")).hexdigest()
    return Path(tempfile.gettempdir()) / "coc-campaign-rwlocks" / f"{digest}.lock"


def _audit_append_lock_path(log_path: Path) -> Path:
    """Stable cross-process lock inode for one append-only audit stream."""
    digest = hashlib.sha256(os.fspath(log_path.resolve()).encode("utf-8")).hexdigest()
    return Path(tempfile.gettempdir()) / "coc-audit-append-locks" / f"{digest}.lock"


@contextmanager
def audit_append_lock(
    log_path: Path,
    *,
    wait_seconds: float = 5.0,
    poll_seconds: float = 0.01,
) -> Iterator[Path]:
    """Serialize one audit append without upgrading the campaign state lock.

    The process-local companion prevents same-process thread interleaving;
    the descriptor-owned flock serializes independent MCP/toolbox processes.
    Its inode deliberately lives outside campaign evidence so retaining an
    audit receipt never rewrites gameplay state, cache, RNG, or receipts.
    """
    log_path = Path(log_path)
    wait_seconds = max(0.0, float(wait_seconds))
    process_lock = _process_campaign_lock(_audit_append_lock_path(log_path))
    deadline = time.monotonic() + wait_seconds
    process_lock.acquire(shared=False, deadline=deadline)
    try:
        with advisory_file_lock(
            _audit_append_lock_path(log_path),
            wait_seconds=wait_seconds,
            poll_seconds=poll_seconds,
        ):
            yield log_path
    finally:
        process_lock.release(shared=False)


def _flock_campaign_rwlock(
    lock_path: Path,
    *,
    shared: bool,
    deadline: float,
    poll_seconds: float,
) -> int:
    """Acquire the stable kernel lock; callers always close the descriptor."""
    try:
        lock_path.parent.mkdir(parents=True, exist_ok=True)
        descriptor = os.open(str(lock_path), os.O_CREAT | os.O_RDWR, 0o600)
    except OSError as exc:
        raise CampaignLockError(f"could not open campaign rw lock {lock_path}: {exc}") from exc
    operation = (fcntl.LOCK_SH if shared else fcntl.LOCK_EX) | fcntl.LOCK_NB
    try:
        while True:
            try:
                fcntl.flock(descriptor, operation)
                return descriptor
            except (BlockingIOError, OSError) as exc:
                if time.monotonic() >= deadline:
                    raise CampaignLockError(
                        f"campaign rw lock busy at {lock_path}"
                    ) from exc
                time.sleep(min(poll_seconds, max(0.0, deadline - time.monotonic())))
    except Exception:
        os.close(descriptor)
        raise


def _release_flock(descriptor: int) -> None:
    try:
        fcntl.flock(descriptor, fcntl.LOCK_UN)
    finally:
        os.close(descriptor)


@contextmanager
def campaign_lock(
    campaign_dir: Path,
    *,
    stale_minutes: float = 30.0,
    wait_seconds: float = 0.0,
    poll_seconds: float = 0.05,
    mode: str = "exclusive",
) -> Iterator[Path]:
    """Campaign shared-read/exclusive-write lock, fail-closed by default.

    ``mode='shared'`` is for an explicitly reviewed ``parallel_read`` only.
    Every other value, unsupported shared-lock platform, or lock error falls
    back to (or fails as) the legacy exclusive path.  The legacy marker stays
    authoritative for stale-lock recovery; the stable flock inode coordinates
    readers with writers across processes.
    """
    campaign_dir = Path(campaign_dir)
    campaign_dir.mkdir(parents=True, exist_ok=True)
    wait_seconds = max(0.0, float(wait_seconds))
    poll_seconds = max(0.001, float(poll_seconds))
    deadline = time.monotonic() + wait_seconds
    shared = mode == "shared" and hasattr(fcntl, "LOCK_SH")
    process_lock = _process_campaign_lock(campaign_dir)
    process_lock.acquire(shared=shared, deadline=deadline)
    lock_path = campaign_dir / ".campaign.lock"
    rwlock_path = _campaign_rwlock_path(campaign_dir)

    if shared:
        descriptor: int | None = None
        try:
            # A marker can be created just before a writer acquires flock. Check
            # both sides of LOCK_SH so a reader never crosses that write entry.
            while lock_path.exists():
                if time.monotonic() >= deadline:
                    raise CampaignLockError(f"campaign lock held at {lock_path}")
                time.sleep(min(poll_seconds, max(0.0, deadline - time.monotonic())))
            descriptor = _flock_campaign_rwlock(
                rwlock_path, shared=True, deadline=deadline, poll_seconds=poll_seconds,
            )
            if lock_path.exists():
                _release_flock(descriptor)
                descriptor = None
                if time.monotonic() >= deadline:
                    raise CampaignLockError(f"campaign lock held at {lock_path}")
                # Re-enter through the same bounded path rather than reading
                # while a writer has announced itself.
                while lock_path.exists():
                    if time.monotonic() >= deadline:
                        raise CampaignLockError(f"campaign lock held at {lock_path}")
                    time.sleep(min(poll_seconds, max(0.0, deadline - time.monotonic())))
                descriptor = _flock_campaign_rwlock(
                    rwlock_path, shared=True, deadline=deadline, poll_seconds=poll_seconds,
                )
            yield lock_path
        finally:
            if descriptor is not None:
                _release_flock(descriptor)
            process_lock.release(shared=True)
        return

    payload = {"pid": os.getpid(), "acquired_at": time.time()}
    descriptor = None
    marker_acquired = False
    try:
        while True:
            try:
                fd = os.open(str(lock_path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            except FileExistsError:
                existing = _read_lock_payload(lock_path)
                payload_valid = _lock_payload_is_valid(existing)
                unreadable_and_fresh = not payload_valid and not _unreadable_lock_is_stale(
                    lock_path, stale_minutes=stale_minutes
                )
                valid_and_fresh = payload_valid and not _lock_is_stale(
                    existing, stale_minutes=stale_minutes
                )
                if unreadable_and_fresh or valid_and_fresh:
                    holder = existing.get("pid") if payload_valid else "unknown"
                    held_by_this_process = payload_valid and int(holder or 0) == os.getpid()
                    if held_by_this_process or time.monotonic() >= deadline:
                        raise CampaignLockError(
                            f"campaign lock held by pid={holder} at {lock_path}"
                        ) from None
                    time.sleep(min(poll_seconds, max(0.0, deadline - time.monotonic())))
                    continue
                try:
                    lock_path.unlink(missing_ok=True)
                except FileNotFoundError:
                    continue
                except OSError as exc:
                    raise CampaignLockError(
                        f"could not clear stale campaign lock at {lock_path}: {exc}"
                    ) from exc
                continue
            try:
                os.write(fd, json.dumps(payload).encode("utf-8"))
            finally:
                os.close(fd)
            marker_acquired = True
            break
        descriptor = _flock_campaign_rwlock(
            rwlock_path, shared=False, deadline=deadline, poll_seconds=poll_seconds,
        )
        yield lock_path
    finally:
        if descriptor is not None:
            _release_flock(descriptor)
        if marker_acquired:
            try:
                current = _read_lock_payload(lock_path)
                if current is None or int(current.get("pid") or 0) == os.getpid():
                    lock_path.unlink(missing_ok=True)
            except OSError:
                pass
        process_lock.release(shared=False)
