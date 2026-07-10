#!/usr/bin/env python3
"""Small platform-neutral recorder queue for fast live play.

The live Keeper path only needs save-state mutations before narration returns.
Verbose JSONL audit logs can be queued into one durable turn file and flushed by
an out-of-band worker, a later turn, or a manual command.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import coc_fileio

SUPPORTED_MODES = {"sync", "fast", "minimal"}
ASYNC_MODES = {"fast", "minimal"}
SUPPORTED_FLUSH_POLICIES = {"manual", "background"}


def normalize_recording_mode(value: str | None) -> str:
    mode = (value or "sync").strip().lower()
    if mode not in SUPPORTED_MODES:
        return "sync"
    return mode


def resolve_recording_mode(plan: dict[str, Any] | None = None, explicit: str | None = None) -> str:
    """Resolve recording mode from explicit arg, plan directive, then env."""
    if explicit:
        return normalize_recording_mode(explicit)
    directives = (plan or {}).get("narrative_directives") or {}
    if isinstance(directives, dict) and directives.get("recording_mode"):
        return normalize_recording_mode(str(directives["recording_mode"]))
    plan_mode = (plan or {}).get("recording_mode")
    if plan_mode:
        return normalize_recording_mode(str(plan_mode))
    return normalize_recording_mode(os.environ.get("COC_KEEPER_RECORDING_MODE"))


def normalize_flush_policy(value: str | None) -> str:
    policy = (value or "manual").strip().lower()
    if policy in {"auto", "async"}:
        return "background"
    if policy not in SUPPORTED_FLUSH_POLICIES:
        return "manual"
    return policy


def resolve_recording_flush(plan: dict[str, Any] | None = None, explicit: str | None = None) -> str:
    """Resolve pending-batch flush policy from explicit arg, plan directive, then env."""
    if explicit:
        return normalize_flush_policy(explicit)
    directives = (plan or {}).get("narrative_directives") or {}
    if isinstance(directives, dict) and directives.get("recording_flush"):
        return normalize_flush_policy(str(directives["recording_flush"]))
    plan_policy = (plan or {}).get("recording_flush")
    if plan_policy:
        return normalize_flush_policy(str(plan_policy))
    return normalize_flush_policy(os.environ.get("COC_KEEPER_RECORDING_FLUSH"))


def _safe_slug(value: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9_.-]+", "-", value).strip("-")
    return slug[:96] or "turn"


def _relative_path(campaign_dir: Path, path: Path) -> str | None:
    try:
        return path.resolve().relative_to(campaign_dir.resolve()).as_posix()
    except ValueError:
        return None


def _append_jsonl_sync(path: Path, record: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


class JsonlRecorder:
    """Collect JSONL appends for one turn and persist them as a pending batch."""

    def __init__(
        self,
        campaign_dir: Path,
        *,
        mode: str,
        decision_id: str,
        created_at: str | None = None,
    ) -> None:
        self.campaign_dir = Path(campaign_dir)
        self.mode = normalize_recording_mode(mode)
        self.decision_id = str(decision_id or "unknown")
        self.created_at = created_at or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        self.entries: list[dict[str, Any]] = []

    @property
    def async_enabled(self) -> bool:
        return self.mode in ASYNC_MODES

    def append_jsonl(self, path: Path, record: dict[str, Any]) -> None:
        target = Path(path)
        if not self.async_enabled:
            _append_jsonl_sync(target, record)
            return
        relative = _relative_path(self.campaign_dir, target)
        if relative is None:
            _append_jsonl_sync(target, record)
            return
        self.entries.append({
            "relative_path": relative,
            "record": record,
        })

    def commit(self) -> Path | None:
        """Persist queued entries to logs/pending-turns and return the batch path."""
        if not self.async_enabled or not self.entries:
            return None
        pending_dir = self.campaign_dir / "logs" / "pending-turns"
        pending_dir.mkdir(parents=True, exist_ok=True)
        stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
        unique = time.time_ns()
        filename = f"{stamp}-{_safe_slug(self.decision_id)}-{unique}.json"
        target = pending_dir / filename
        payload = {
            "schema_version": 1,
            "recording_mode": self.mode,
            "created_at": self.created_at,
            "decision_id": self.decision_id,
            "entries": self.entries,
        }
        coc_fileio.write_json_atomic(
            target, payload, indent=2, ensure_ascii=False, trailing_newline=True
        )
        return target


def _pending_files(campaign_dir: Path) -> list[Path]:
    pending_dir = Path(campaign_dir) / "logs" / "pending-turns"
    if not pending_dir.is_dir():
        return []
    return sorted(p for p in pending_dir.glob("*.json") if p.is_file())


def pending_record_count(campaign_dir: Path) -> int:
    return len(_pending_files(campaign_dir))


def pending_stuck_check(
    campaign_dir: Path,
    *,
    max_age_seconds: int = 30,
    max_count: int = 50,
) -> dict[str, Any]:
    """Detect pending JSONL batches that are too old or too numerous.

    A maintenance health check (P2-6, conservative). Returning ``stuck=True``
    tells the runner to force a synchronous flush on its maintenance path —
    this is NOT the per-turn narration path, which stays non-blocking.

    Returns a dict with: ``stuck`` (bool), ``pending_count`` (int),
    ``oldest_age_seconds`` (float | None), ``max_age_seconds`` (int),
    ``max_count`` (int), ``pending_dir`` (str), ``reasons`` (list[str]).
    """
    max_age_seconds = max(0, int(max_age_seconds))
    max_count = max(0, int(max_count))
    pending_dir = Path(campaign_dir) / "logs" / "pending-turns"
    files = _pending_files(campaign_dir)
    pending_count = len(files)

    oldest_age: float | None = None
    if files:
        now = time.time()
        oldest_age = now - min(f.stat().st_mtime for f in files)

    reasons: list[str] = []
    if oldest_age is not None and max_age_seconds > 0 and oldest_age >= max_age_seconds:
        reasons.append("max_age_exceeded")
    if max_count > 0 and pending_count > max_count:
        reasons.append("max_count_exceeded")

    return {
        "stuck": bool(reasons),
        "pending_count": pending_count,
        "oldest_age_seconds": oldest_age,
        "max_age_seconds": max_age_seconds,
        "max_count": max_count,
        "pending_dir": str(pending_dir),
        "reasons": reasons,
    }


def flush_pending_records(campaign_dir: Path, *, limit: int | None = None) -> dict[str, int]:
    """Replay queued JSONL batches into their target logs, then remove them."""
    campaign = Path(campaign_dir)
    files = _pending_files(campaign)
    if limit is not None:
        files = files[:max(0, int(limit))]

    flushed_files = 0
    flushed_entries = 0
    for pending in files:
        payload = json.loads(pending.read_text(encoding="utf-8"))
        entries = payload.get("entries", [])
        if not isinstance(entries, list):
            entries = []
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            relative = entry.get("relative_path")
            record = entry.get("record")
            if not isinstance(relative, str) or not isinstance(record, dict):
                continue
            target = (campaign / relative).resolve()
            try:
                target.relative_to(campaign.resolve())
            except ValueError:
                continue
            _append_jsonl_sync(target, record)
            flushed_entries += 1
        pending.unlink()
        flushed_files += 1

    return {
        "flushed_files": flushed_files,
        "flushed_entries": flushed_entries,
        "remaining_files": pending_record_count(campaign),
    }


def spawn_background_flush(campaign_dir: Path, *, limit: int | None = None) -> dict[str, Any]:
    """Start a detached local process that flushes pending JSONL batches.

    Records an audit marker in ``logs/flush-attempts.jsonl`` ({ts, pid,
    pending_before, campaign_dir}) so that flush attempts are observable even
    though the worker itself is fire-and-forget. Marker write is best-effort —
    it must never block or fail the spawn.
    """
    campaign = Path(campaign_dir)
    args = [sys.executable, str(Path(__file__).resolve()), "flush", str(campaign)]
    if limit is not None:
        args.extend(["--limit", str(int(limit))])
    proc = subprocess.Popen(
        args,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        close_fds=True,
    )
    pending_before = pending_record_count(campaign)
    try:
        marker = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "pid": proc.pid,
            "pending_before": pending_before,
            "campaign_dir": str(campaign),
            "limit": limit,
        }
        _append_jsonl_sync(campaign / "logs" / "flush-attempts.jsonl", marker)
    except OSError:
        # Best-effort: a failure to record the audit marker must not affect the
        # actual flush, which is the load-bearing part of this call.
        pass
    return {"started": True, "pid": proc.pid, "pending_before": pending_before}


def _main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Flush pending CoC JSONL recorder batches.")
    sub = parser.add_subparsers(dest="command", required=True)
    flush_parser = sub.add_parser("flush")
    flush_parser.add_argument("campaign_dir")
    flush_parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args(argv)
    if args.command == "flush":
        flush_pending_records(Path(args.campaign_dir), limit=args.limit)
        return 0
    return 2


if __name__ == "__main__":
    raise SystemExit(_main())
