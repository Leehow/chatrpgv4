#!/usr/bin/env python3
"""Atomic text/JSON persistence helpers for campaign save paths.

Crash-safe writes: stage into a same-directory temp file, fsync, then
``os.replace`` onto the target so readers never observe a truncated file.

Also provides an optional advisory ``campaign_lock`` to keep two concurrent
sessions from corrupting one campaign directory.
"""
from __future__ import annotations

import json
import os
import tempfile
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator


class CampaignLockError(RuntimeError):
    """Raised when a campaign advisory lock cannot be acquired."""


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


@contextmanager
def campaign_lock(
    campaign_dir: Path,
    *,
    stale_minutes: float = 30.0,
    wait_seconds: float = 0.0,
    poll_seconds: float = 0.05,
) -> Iterator[Path]:
    """Advisory exclusive lock for one campaign directory.

    Uses ``O_CREAT|O_EXCL`` on ``.campaign.lock`` with ``{pid, acquired_at}``.
    Stale locks (dead pid or older than ``stale_minutes``) are removed and
    re-acquired. Intended for top-level turn entry (e.g. ``run_live_turn``),
    not every helper write. By default acquisition remains fail-closed. A
    positive ``wait_seconds`` lets top-level CLI transactions queue briefly
    behind another process. A lock held by this process still fails
    immediately so accidentally nested entry points cannot self-deadlock.
    """
    campaign_dir = Path(campaign_dir)
    campaign_dir.mkdir(parents=True, exist_ok=True)
    lock_path = campaign_dir / ".campaign.lock"
    payload = {
        "pid": os.getpid(),
        "acquired_at": time.time(),
    }
    wait_seconds = max(0.0, float(wait_seconds))
    poll_seconds = max(0.001, float(poll_seconds))
    deadline = time.monotonic() + wait_seconds
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
                held_by_this_process = (
                    payload_valid and int(holder or 0) == os.getpid()
                )
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
        break

    try:
        yield lock_path
    finally:
        try:
            current = _read_lock_payload(lock_path)
            if current is None or int(current.get("pid") or 0) == os.getpid():
                lock_path.unlink(missing_ok=True)
        except OSError:
            pass
