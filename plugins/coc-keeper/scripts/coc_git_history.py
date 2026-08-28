#!/usr/bin/env python3
"""Sole writer of per-campaign git history (Commit Coordinator).

Sidecar bare repo at ``<root>/.coc/repos/campaigns/<id>.git``; the campaign
directory is the worktree. Never writes ``.git`` inside the campaign tree.
"""
from __future__ import annotations

import contextlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping

_SCRIPT_DIR = Path(__file__).resolve().parent
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))

import coc_fileio
import coc_temporal_memory_contract as tm_contract

# Same constraint as coc_state._SAFE_ID. Duplicated so this module stays
# importable without loading campaign-state machinery.
_SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_GIT_REF_UNSAFE = re.compile(r"[~^:?*\[\\ @]|\.\.|@\{|^\.|/\.|//|\.lock$|/")

GIT_USER_NAME = "coc-keeper"
GIT_USER_EMAIL = "coc-keeper@localhost"
DEFAULT_TIMELINE_ID = tm_contract.ROOT_TIMELINE_ID
DEFAULT_BRANCH = "main"
TIMELINE_REF_PREFIX = "refs/heads/timelines/"
TIMELINE_STATE_RELPATH = "save/timeline-state.json"
TIMELINE_STATE_SCHEMA = "timeline-state-1"

# Single source of truth for the ignore face. Written to the bare repo's
# ``info/exclude``; never materialized as a campaign-tree ``.gitignore``.
IGNORE_PATHS: tuple[str, ...] = (
    ".campaign.lock",
    "setup-handoff.lock",
    "logs/.recorder.lock",
    "logs/pending-turns/",
    "save/session-state.json",
    "save/toolbox-ledger.json",
    "save/commit-snapshots/",
    "save/development-settlements/",
    "save/roll-operation-receipts.json",
    "save/run-identity.lock",
    "save/timeline-state.json",
    "save/working-set-cache/",
    "save/working-set-revisions.json",
    "memory/index.json",
    "memory/events-projection.db",
    "memory/events-projection.db-shm",
    "memory/events-projection.db-wal",
    "memory/history-projection.db",
    # Derived, rebuildable confluence enumeration cache written by
    # timeline.confluence_query (coc_confluence_manifest_store): a pure
    # function of two immutable parent tips, re-verified by digest and
    # anchors at confirm time. Never authoritative; never committed.
    "memory/temporal/confluence-manifests/",
)

# Narrow prefix face for crash-left atomic temp files of the rebuildable
# history projection cache
# (``coc_history_projection_schema.atomic_projection_target`` reserves
# ``memory/.history-projection-*.tmp`` beside the cache). Deterministic
# fixed-prefix + fixed-suffix pairs only: not a glob engine, and nothing
# outside these exact prefixes is ever matched. The canonical memory
# records under ``memory/temporal/`` are NOT on this face.
IGNORE_TEMP_PREFIXES: tuple[tuple[str, str], ...] = (
    ("memory/.history-projection-", ".tmp"),
)

# Transient machine-internal lock files that live-play commits swept into
# campaign trees before the tracking face excluded them. Their byte content
# (pid/timestamp) is meaningless across epochs and must never gate or fail a
# worldline merge; when two parent tips disagree, the merge carries the left
# side deterministically instead of failing closed. Measured blocker: the
# worldline-accept-20260827 run failed its first real confluence merge with
# "unresolved confluence tree paths: .campaign.lock".
CONFLUENCE_TRANSIENT_LOCK_PATHS: frozenset[str] = frozenset({
    ".campaign.lock",
    "logs/.recorder.lock",
    "setup-handoff.lock",
})

# Independent of IGNORE_PATHS: the save/ subset the old copytree snapshot
# captured, and therefore the only paths restore may rewrite.
RESTORE_SAVE_EXCLUDES: frozenset[str] = frozenset({
    "commit-snapshots",
    "development-settlements",
    "session-state.json",
    "toolbox-ledger.json",
    "roll-operation-receipts.json",
})

# Required tracked paths that prove campaign state in HEAD. Ignore-face
# paths are never authoritative. Receipts log is required only after a
# finalized turn exists.
AUTHORITATIVE_STATE_PATHS: tuple[str, ...] = (
    "campaign.json",
    "save/world-state.json",
    "logs/turn-finalizations.jsonl",
)
AUTHORITATIVE_STATE_PREFIXES: tuple[str, ...] = ("save/",)
PENDING_TURN_RELPATH = "save/pending-turn.json"

# Used only when recovering a corrupt object database with no caller-supplied
# generation string. Keep in sync with coc_state.CURRENT_SCHEMA_VERSIONS.
_FALLBACK_SCHEMA_GENERATION = "campaign-3/world-2/pacing-1/investigator-1"

_GIT_CONFIG_ARGS: tuple[str, ...] = (
    "-c",
    f"user.name={GIT_USER_NAME}",
    "-c",
    f"user.email={GIT_USER_EMAIL}",
    "-c",
    "commit.gpgsign=false",
    "-c",
    "safe.directory=*",
)

_LOCK_MARKERS = ("index.lock",)
_CORRUPT_MARKERS = (
    "corrupt",
    "corrupted",
    "loose object",
    "packed object",
    "bad object",
    "missing object",
    "broken link",
    "invalid object",
    "object not found",
    # "fatal: not a git repository" is deliberately absent: that error means
    # the git-dir path did not resolve (caller cwd / relative root), not that
    # the object database is damaged. Treating it as corruption renamed and
    # reset healthy repos. Structural repo damage is still caught by
    # ensure_repo's looks-like-repo probe and fsck health check.
)

_SCHEMA_GENERATION_KEYS = ("campaign", "world", "pacing", "investigator")


class GitHistoryError(Exception):
    """A campaign git-history operation failed."""


class GitHistoryUnavailableError(GitHistoryError):
    """The git binary is missing or cannot be executed."""

    def __init__(self, message: str | None = None) -> None:
        super().__init__(
            message
            or "git is required for campaign history but was not found on PATH"
        )


def format_schema_generation(versions: dict[str, int]) -> str:
    """Render ``campaign-3/world-2/...`` from a schema-version map."""
    return "/".join(
        f"{key}-{int(versions[key])}"
        for key in _SCHEMA_GENERATION_KEYS
        if key in versions
    )


def _coc_root(root: Path | str) -> Path:
    root_path = Path(root)
    if root_path.name == ".coc":
        return root_path
    return root_path / ".coc"


def _require_campaign_id(campaign_id: str) -> str:
    if not isinstance(campaign_id, str) or _SAFE_ID.fullmatch(campaign_id) is None:
        raise ValueError("campaign_id must be a stable safe id")
    return campaign_id


def _require_under(parent: Path, child: Path, *, label: str) -> Path:
    try:
        resolved = child.resolve(strict=False)
        resolved.relative_to(parent.resolve(strict=False))
    except (OSError, ValueError) as exc:
        raise ValueError(f"{label} path is unsafe") from exc
    if child.is_symlink():
        raise ValueError(f"{label} path is unsafe")
    # Always hand back an absolute path: git subprocesses run with cwd at the
    # worktree, so a root-relative --git-dir would resolve against the wrong
    # directory and read as "not a git repository".
    return resolved


def repo_path_for(root: Path | str, campaign_id: str) -> Path:
    campaign_id = _require_campaign_id(campaign_id)
    repos = _coc_root(root) / "repos" / "campaigns"
    repo = repos / f"{campaign_id}.git"
    return _require_under(repos, repo, label="campaign repo")


def worktree_path_for(root: Path | str, campaign_id: str) -> Path:
    campaign_id = _require_campaign_id(campaign_id)
    campaigns = _coc_root(root) / "campaigns"
    campaign_dir = campaigns / campaign_id
    return _require_under(campaigns, campaign_dir, label="campaign")


def looks_like_git_repo(repo: Path) -> bool:
    """True when ``repo`` has the files of a git object database."""
    return _looks_like_git_repo(repo)


def path_is_ignored(relpath: str) -> bool:
    """True when ``relpath`` is on the Coordinator ignore face.

    Exact-name and directory-prefix semantics over ``IGNORE_PATHS``, plus
    the narrow ``IGNORE_TEMP_PREFIXES`` face for crash-left atomic temp
    files (fixed prefix, fixed suffix, non-empty middle). No general glob
    behavior exists here.
    """
    normalized = relpath.replace("\\", "/")
    while normalized.startswith("./"):
        normalized = normalized[2:]
    if not normalized:
        return False
    for pattern in IGNORE_PATHS:
        if pattern.endswith("/"):
            if normalized == pattern[:-1] or normalized.startswith(pattern):
                return True
        elif normalized == pattern:
            return True
    for prefix, suffix in IGNORE_TEMP_PREFIXES:
        middle_end = len(normalized) - len(suffix)
        if (
            middle_end > len(prefix)
            and normalized.startswith(prefix)
            and normalized.endswith(suffix)
            and "/" not in normalized[len(prefix):middle_end]
        ):
            return True
    return False


def is_authoritative_state_path(relpath: str) -> bool:
    """True when ``relpath`` is tracked campaign state (not ignore-face)."""
    normalized = relpath.replace("\\", "/").lstrip("./")
    if not normalized or path_is_ignored(normalized):
        return False
    if normalized in AUTHORITATIVE_STATE_PATHS:
        return True
    return any(normalized.startswith(prefix) for prefix in AUTHORITATIVE_STATE_PREFIXES)


def _isolated_git_env(*, extra: dict[str, str] | None = None) -> dict[str, str]:
    env = os.environ.copy()
    env["GIT_CONFIG_NOSYSTEM"] = "1"
    env["GIT_CONFIG_GLOBAL"] = os.devnull
    env["GIT_CONFIG_SYSTEM"] = os.devnull
    env["GIT_TERMINAL_PROMPT"] = "0"
    env["GIT_AUTHOR_NAME"] = GIT_USER_NAME
    env["GIT_AUTHOR_EMAIL"] = GIT_USER_EMAIL
    env["GIT_COMMITTER_NAME"] = GIT_USER_NAME
    env["GIT_COMMITTER_EMAIL"] = GIT_USER_EMAIL
    env.pop("GIT_DIR", None)
    env.pop("GIT_WORK_TREE", None)
    env.pop("GIT_INDEX_FILE", None)
    env.pop("GIT_OBJECT_DIRECTORY", None)
    env.pop("GIT_ALTERNATE_OBJECT_DIRECTORIES", None)
    if extra:
        env.update(extra)
    return env


def _git_executable() -> str:
    git = shutil.which("git")
    if not git:
        raise GitHistoryUnavailableError(
            "git is required for campaign history but was not found on PATH"
        )
    return git


def _is_lock_error(stderr: str) -> bool:
    lowered = stderr.lower()
    return any(marker in lowered for marker in _LOCK_MARKERS)


def _is_corrupt_error(stderr: str) -> bool:
    lowered = stderr.lower()
    return any(marker in lowered for marker in _CORRUPT_MARKERS)


def _run_git(
    args: list[str],
    *,
    repo: Path | None = None,
    worktree: Path | None = None,
    check: bool = True,
    input_text: str | None = None,
    allow_lock_retry: bool = True,
    extra_env: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    git = _git_executable()
    cmd = [git, *_GIT_CONFIG_ARGS]
    if repo is not None:
        cmd.append(f"--git-dir={repo}")
    if worktree is not None:
        cmd.append(f"--work-tree={worktree}")
    cmd.extend(args)
    cwd = str(worktree) if worktree is not None else None
    try:
        completed = subprocess.run(
            cmd,
            input=input_text,
            cwd=cwd,
            env=_isolated_git_env(extra=extra_env),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )
    except FileNotFoundError as cop_exc:
        raise GitHistoryUnavailableError(
            "git is required for campaign history but was not found on PATH"
        ) from cop_exc
    if completed.returncode == 0 or not check:
        return completed
    stderr = completed.stderr or ""
    if (
        allow_lock_retry
        and repo is not None
        and _is_lock_error(stderr)
    ):
        lock_path = repo / "index.lock"
        try:
            lock_path.unlink(missing_ok=True)
        except OSError:
            pass
        return _run_git(
            args,
            repo=repo,
            worktree=worktree,
            check=check,
            input_text=input_text,
            allow_lock_retry=False,
            extra_env=extra_env,
        )
    if not allow_lock_retry and repo is not None and _is_lock_error(stderr):
        raise GitHistoryError(
            f"git {' '.join(args)} failed after index.lock retry: {stderr.strip()}"
        )
    raise GitHistoryError(f"git {' '.join(args)} failed: {stderr.strip()}")


def _write_exclude(repo: Path) -> None:
    exclude = repo / "info" / "exclude"
    exclude.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        *IGNORE_PATHS,
        # Git-pattern rendering of the temp-prefix face: ``*`` never
        # crosses ``/``, so only files directly under ``memory/`` match.
        *(f"{prefix}*{suffix}" for prefix, suffix in IGNORE_TEMP_PREFIXES),
    ]
    exclude.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _init_bare_repo(repo: Path) -> None:
    repo.parent.mkdir(parents=True, exist_ok=True)
    _run_git(
        ["init", "--bare", f"--initial-branch={DEFAULT_BRANCH}", "--", str(repo)],
        allow_lock_retry=False,
    )
    _write_exclude(repo)


def _looks_like_git_repo(repo: Path) -> bool:
    return repo.is_dir() and (repo / "HEAD").is_file() and (repo / "objects").is_dir()


def _repo_is_healthy(repo: Path, worktree: Path) -> bool:
    probe = _run_git(
        ["rev-parse", "--is-bare-repository"],
        repo=repo,
        worktree=worktree,
        check=False,
    )
    if probe.returncode != 0:
        return False
    fsck = _run_git(
        ["fsck"],
        repo=repo,
        worktree=worktree,
        check=False,
    )
    return fsck.returncode == 0


def _rev_sha(repo: Path, worktree: Path, rev: str) -> str | None:
    completed = _run_git(
        ["rev-parse", "--verify", "-q", rev],
        repo=repo,
        worktree=worktree,
        check=False,
    )
    if completed.returncode != 0:
        return None
    sha = completed.stdout.strip()
    return sha or None


def _head_sha(repo: Path, worktree: Path) -> str | None:
    return _rev_sha(repo, worktree, "HEAD")


def _sanitize_single_line(value: str) -> str:
    """Collapse whitespace to one line so a value (e.g. raw git stderr in a
    ``COC-History-Reset`` reason) cannot inject forged trailers."""
    return re.sub(r"\s+", " ", value).strip()[:200]


def _format_commit_message(subject: str, trailers: list[tuple[str, str]]) -> str:
    args = ["interpret-trailers"]
    for key, value in trailers:
        args.extend(["--trailer", f"{key}: {_sanitize_single_line(value)}"])
    completed = _run_git(
        args,
        input_text=f"{_sanitize_single_line(subject)}\n",
        allow_lock_retry=False,
    )
    return completed.stdout


def parse_trailers(message: str) -> dict[str, str]:
    """Parse git trailers via ``git interpret-trailers --parse``."""
    completed = _run_git(
        ["interpret-trailers", "--parse"],
        input_text=message,
        allow_lock_retry=False,
    )
    parsed: dict[str, str] = {}
    for line in completed.stdout.splitlines():
        if not line:
            continue
        if ": " in line:
            key, value = line.split(": ", 1)
        elif ":" in line:
            key, value = line.split(":", 1)
            value = value.strip()
        else:
            continue
        parsed[key] = value
    return parsed


def _commit_log_records(
    repo: Path,
    worktree: Path,
    *,
    rev: str | None = None,
    all_refs: bool = False,
) -> list[tuple[str, str]]:
    if all_refs:
        if _head_sha(repo, worktree) is None and not _list_timeline_refs(repo, worktree):
            return []
        args = ["log", "--all", "--format=%H%x1e%B%x1d"]
    else:
        target = rev or "HEAD"
        if _rev_sha(repo, worktree, target) is None:
            return []
        args = ["log", "--format=%H%x1e%B%x1d", target]
    completed = _run_git(
        args,
        repo=repo,
        worktree=worktree,
    )
    records: list[tuple[str, str]] = []
    for chunk in completed.stdout.split("\x1d"):
        piece = chunk.strip("\n")
        if not piece:
            continue
        sha, sep, body = piece.partition("\x1e")
        if not sep:
            continue
        records.append((sha.strip(), body))
    return records


def _sha_for_finalization_id(
    repo: Path, worktree: Path, finalization_id: str
) -> str | None:
    for sha, body in _commit_log_records(repo, worktree, all_refs=True):
        trailers = parse_trailers(body)
        if trailers.get("Finalization-Id") == finalization_id:
            return sha
    return None


def _stage_and_commit(
    repo: Path,
    worktree: Path,
    message: str,
) -> str:
    worktree.mkdir(parents=True, exist_ok=True)
    _run_git(["add", "-A", "--", "."], repo=repo, worktree=worktree)
    _prune_ignored_index_paths(repo, worktree)
    _run_git(
        ["commit", "--allow-empty", "-m", message],
        repo=repo,
        worktree=worktree,
    )
    sha = _head_sha(repo, worktree)
    if sha is None:
        raise GitHistoryError("git commit succeeded but HEAD is missing")
    return sha


def _prune_ignored_index_paths(repo: Path, worktree: Path) -> None:
    """Remove runtime-only paths from the index while preserving files.

    ``info/exclude`` prevents new files from being added, but Git continues
    tracking paths that entered an older campaign commit.  Finalization is
    the one writer seam, so it also repairs that historical over-tracking on
    the next commit.  ``update-index --force-remove`` changes only the private
    sidecar index; campaign files remain byte-for-byte in the worktree.
    """
    listed = _run_git(
        ["ls-files", "-z"], repo=repo, worktree=worktree
    ).stdout.split("\0")
    ignored = sorted(path for path in listed if path and path_is_ignored(path))
    if not ignored:
        return
    _run_git(
        ["update-index", "--force-remove", "-z", "--stdin"],
        repo=repo,
        worktree=worktree,
        input_text="\0".join(ignored) + "\0",
    )


def _recover_corrupt_repo(
    root: Path | str,
    campaign_id: str,
    *,
    reason: str,
    schema_generation: str,
) -> Path:
    repo = repo_path_for(root, campaign_id)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    dest = repo.with_name(f"{repo.name}.corrupt-{timestamp}")
    suffix = 0
    while dest.exists():
        suffix += 1
        dest = repo.with_name(f"{repo.name}.corrupt-{timestamp}-{suffix}")
    repo.rename(dest)
    return ensure_repo(
        root,
        campaign_id,
        _allow_recover=False,
        _reset_reason=reason,
        _reset_schema_generation=schema_generation,
    )


def _maybe_recover(
    root: Path | str,
    campaign_id: str,
    repo: Path,
    worktree: Path,
    exc: GitHistoryError,
    *,
    schema_generation: str,
    allow_recover: bool,
) -> Path | None:
    if not allow_recover or not _is_corrupt_error(str(exc)):
        return None
    return _recover_corrupt_repo(
        root,
        campaign_id,
        reason=str(exc),
        schema_generation=schema_generation,
    )


def ensure_repo(
    root: Path | str,
    campaign_id: str,
    *,
    _allow_recover: bool = True,
    _reset_reason: str | None = None,
    _reset_schema_generation: str | None = None,
) -> Path:
    """Idempotently create the sidecar bare repo and refresh info/exclude."""
    campaign_id = _require_campaign_id(campaign_id)
    repo = repo_path_for(root, campaign_id)
    worktree = worktree_path_for(root, campaign_id)
    worktree.mkdir(parents=True, exist_ok=True)
    if repo.exists() and not repo.is_dir():
        raise ValueError("campaign repo path is unsafe")
    if not _looks_like_git_repo(repo):
        if repo.exists():
            # Empty leftover directory: git init can occupy it. Anything that
            # already has objects but is unreadable is treated as corrupt.
            if any(repo.iterdir()) and (repo / "objects").exists():
                if _allow_recover:
                    return _recover_corrupt_repo(
                        root,
                        campaign_id,
                        reason="object database unreadable",
                        schema_generation=(
                            _reset_schema_generation or _FALLBACK_SCHEMA_GENERATION
                        ),
                    )
                raise GitHistoryError("campaign git repo is unreadable")
        _init_bare_repo(repo)
    else:
        try:
            healthy = _repo_is_healthy(repo, worktree)
        except GitHistoryError as exc:
            recovered = _maybe_recover(
                root,
                campaign_id,
                repo,
                worktree,
                exc,
                schema_generation=(
                    _reset_schema_generation or _FALLBACK_SCHEMA_GENERATION
                ),
                allow_recover=_allow_recover,
            )
            if recovered is not None:
                return recovered
            raise
        if not healthy:
            if _allow_recover:
                return _recover_corrupt_repo(
                    root,
                    campaign_id,
                    reason="git fsck failed",
                    schema_generation=(
                        _reset_schema_generation or _FALLBACK_SCHEMA_GENERATION
                    ),
                )
            raise GitHistoryError("campaign git repo failed fsck")
        _write_exclude(repo)
    if _reset_reason:
        _commit_new_baseline(
            repo,
            worktree,
            campaign_id,
            schema_generation=_reset_schema_generation or _FALLBACK_SCHEMA_GENERATION,
            note="history reset after corrupt object database",
            history_reset=_reset_reason,
        )
    return repo


def _commit_new_baseline(
    repo: Path,
    worktree: Path,
    campaign_id: str,
    *,
    schema_generation: str,
    note: str,
    history_reset: str | None = None,
) -> str:
    trailers: list[tuple[str, str]] = [
        ("COC-Commit-Type", "baseline"),
        ("Campaign-Id", campaign_id),
        ("Timeline-Id", DEFAULT_TIMELINE_ID),
        ("Schema-Generation", schema_generation),
    ]
    if history_reset:
        trailers.append(("COC-History-Reset", history_reset))
    message = _format_commit_message(f"coc baseline: {note}", trailers)
    return _stage_and_commit(repo, worktree, message)


def commit_baseline(
    root: Path | str,
    campaign_id: str,
    *,
    schema_generation: str,
    note: str,
) -> str:
    """Land the one-time baseline commit; return existing HEAD if present."""
    campaign_id = _require_campaign_id(campaign_id)
    if not isinstance(schema_generation, str) or not schema_generation.strip():
        raise ValueError("schema_generation must be a non-empty string")
    if not isinstance(note, str) or not note.strip():
        raise ValueError("note must be a non-empty string")
    repo = ensure_repo(root, campaign_id)
    worktree = worktree_path_for(root, campaign_id)
    existing = _head_sha(repo, worktree)
    if existing is not None:
        return existing
    try:
        return _commit_new_baseline(
            repo,
            worktree,
            campaign_id,
            schema_generation=schema_generation.strip(),
            note=note.strip(),
        )
    except GitHistoryError as exc:
        recovered = _maybe_recover(
            root,
            campaign_id,
            repo,
            worktree,
            exc,
            schema_generation=schema_generation.strip(),
            allow_recover=True,
        )
        if recovered is None:
            raise
        head = _head_sha(recovered, worktree)
        if head is None:
            raise GitHistoryError("history reset did not produce a baseline") from exc
        return head


def _require_token(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} must be a non-empty string")
    return value.strip()


def commit_finalized_turn(
    root: Path | str,
    campaign_id: str,
    *,
    turn_number: int,
    finalization_id: str,
    journal_decision_id: str,
    settlement_snapshot_id: str,
    rendered_text_sha256: str,
    schema_generation: str,
    timeline_id: str | None = None,
) -> str:
    """Commit the current worktree as one finalized turn.

    Replay of the same ``Finalization-Id`` returns the existing commit and
    does not create another. Distinct finalizations always record a commit
    (``--allow-empty``). A new commit is refused while
    ``save/pending-turn.json`` is present so an unfinalized later turn cannot
    bind into this receipt. Commits land on the active timeline ref; ``main``
    / ``HEAD`` stay unchanged when that timeline is not ``tl-main``.
    """
    campaign_id = _require_campaign_id(campaign_id)
    if not isinstance(turn_number, int) or isinstance(turn_number, bool) or turn_number < 0:
        raise ValueError("turn_number must be a non-negative int")
    finalization_id = _require_token(finalization_id, "finalization_id")
    journal_decision_id = _require_token(journal_decision_id, "journal_decision_id")
    settlement_snapshot_id = _require_token(
        settlement_snapshot_id, "settlement_snapshot_id"
    )
    rendered_text_sha256 = _require_token(rendered_text_sha256, "rendered_text_sha256")
    schema_generation = _require_token(schema_generation, "schema_generation")

    repo = ensure_repo(root, campaign_id)
    worktree = worktree_path_for(root, campaign_id)
    active = active_timeline_id(root, campaign_id)
    if timeline_id is None:
        timeline_id = active
    else:
        timeline_id = _require_timeline_id(timeline_id)
        if timeline_id != active:
            raise GitHistoryError(
                f"timeline_id {timeline_id!r} does not match active "
                f"timeline {active!r}"
            )
    existing = _sha_for_finalization_id(repo, worktree, finalization_id)
    if existing is not None:
        return existing
    pending = worktree / PENDING_TURN_RELPATH
    if pending.is_file() and not pending.is_symlink():
        raise GitHistoryError(
            "refusing to commit a finalized turn while "
            f"{PENDING_TURN_RELPATH} exists"
        )
    subject = f"coc turn {turn_number:04d}: {finalization_id}"
    trailers = [
        ("COC-Commit-Type", "turn"),
        ("Campaign-Id", campaign_id),
        ("Timeline-Id", timeline_id),
        ("Turn-Number", str(turn_number)),
        ("Finalization-Id", finalization_id),
        ("Journal-Decision-Id", journal_decision_id),
        ("Settlement-Snapshot-Id", settlement_snapshot_id),
        ("Rendered-Text-SHA256", rendered_text_sha256),
        ("Schema-Generation", schema_generation),
    ]
    message = _format_commit_message(subject, trailers)
    try:
        return _commit_to_timeline(repo, worktree, timeline_id=timeline_id, message=message)
    except GitHistoryError as exc:
        recovered = _maybe_recover(
            root,
            campaign_id,
            repo,
            worktree,
            exc,
            schema_generation=schema_generation,
            allow_recover=True,
        )
        if recovered is None:
            raise
        replay = _sha_for_finalization_id(recovered, worktree, finalization_id)
        if replay is not None:
            return replay
        return _commit_to_timeline(
            recovered, worktree, timeline_id=timeline_id, message=message
        )


def remove_repo(root: Path | str, campaign_id: str) -> Path | None:
    """Retire the sidecar repo by rename; evidence is never destroyed.

    History is sole playtest evidence, so removal archives the repo as
    ``<id>.git.discarded-<utc>`` beside the canonical location (same
    rename-first convention as corrupt-object recovery). A later
    ``ensure_repo`` creates a fresh repo at the canonical path; the archive
    stays for audit and export. Never touches the campaign worktree.
    Returns the archive path, or ``None`` when there was no repo to retire.
    """
    campaign_id = _require_campaign_id(campaign_id)
    repo = repo_path_for(root, campaign_id)
    if not repo.exists() and not repo.is_symlink():
        return None
    if not repo.is_dir() or repo.is_symlink():
        raise ValueError("campaign repo path is unsafe")
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    dest = repo.with_name(f"{repo.name}.discarded-{timestamp}")
    suffix = 0
    while dest.exists():
        suffix += 1
        dest = repo.with_name(f"{repo.name}.discarded-{timestamp}-{suffix}")
    repo.rename(dest)
    return dest


def _is_restorable_save_path(relpath: str) -> bool:
    if not relpath.startswith("save/"):
        return False
    first = relpath[5:].split("/", 1)[0]
    return bool(first) and first not in RESTORE_SAVE_EXCLUDES


def restore_save_subset(root: Path | str, campaign_id: str) -> str | None:
    """Checkout HEAD's turn-scoped save/ subset into the campaign worktree.

    Restores exactly the paths the retired copytree snapshot captured.
    Leaves session-state, toolbox-ledger, development-settlements,
    roll-operation-receipts, and any leftover commit-snapshots directory
    untouched. Does not import, read, or delete a leftover snapshot dir.

    Returns the HEAD ``Finalization-Id`` when a turn commit was restored,
    or ``None`` when there is no turn commit to restore from.
    """
    campaign_id = _require_campaign_id(campaign_id)
    repo = repo_path_for(root, campaign_id)
    worktree = worktree_path_for(root, campaign_id)
    if not _looks_like_git_repo(repo) or _head_sha(repo, worktree) is None:
        return None
    message = _run_git(
        ["log", "-1", "--format=%B"],
        repo=repo,
        worktree=worktree,
    ).stdout
    trailers = parse_trailers(message)
    if trailers.get("COC-Commit-Type") != "turn":
        return None
    listed = _run_git(
        ["ls-tree", "-r", "--name-only", "HEAD"],
        repo=repo,
        worktree=worktree,
    )
    paths = [
        name for name in listed.stdout.splitlines() if _is_restorable_save_path(name)
    ]
    save_dir = worktree / "save"
    save_dir.mkdir(parents=True, exist_ok=True)
    for child in list(save_dir.iterdir()):
        if child.name in RESTORE_SAVE_EXCLUDES:
            continue
        if child.is_dir() and not child.is_symlink():
            shutil.rmtree(child)
        else:
            child.unlink()
    if paths:
        batch_size = 200
        for start in range(0, len(paths), batch_size):
            batch = paths[start : start + batch_size]
            _run_git(
                ["checkout", "HEAD", "--", *batch],
                repo=repo,
                worktree=worktree,
            )
    finalization_id = trailers.get("Finalization-Id")
    return finalization_id or None


# ---------------------------------------------------------------------------
# Timeline DAG (fork / confluence / history query)
# ---------------------------------------------------------------------------


def timeline_ref_name(timeline_id: str) -> str:
    """Git ref for a semantic timeline id. ``tl-main`` stays ``refs/heads/main``."""
    timeline_id = _require_timeline_id(timeline_id)
    if timeline_id == DEFAULT_TIMELINE_ID:
        return f"refs/heads/{DEFAULT_BRANCH}"
    return f"{TIMELINE_REF_PREFIX}{timeline_id}"


def _require_timeline_id(value: str) -> str:
    token = _require_token(value, "timeline_id")
    if not token.startswith("tl-") or _GIT_REF_UNSAFE.search(token) is not None:
        raise ValueError("timeline_id must be a git-safe semantic id with tl- prefix")
    try:
        tm_contract._check_semantic_id(
            token,
            kind="timeline",
            field="timeline_id",
            prefix=tm_contract.ID_PREFIX["timeline"],
        )
    except tm_contract.TemporalMemoryContractError as exc:
        raise ValueError(str(exc)) from exc
    return token


def _list_timeline_refs(repo: Path, worktree: Path) -> list[str]:
    completed = _run_git(
        ["for-each-ref", "--format=%(refname)", TIMELINE_REF_PREFIX],
        repo=repo,
        worktree=worktree,
        check=False,
    )
    if completed.returncode != 0:
        return []
    return [line.strip() for line in completed.stdout.splitlines() if line.strip()]


def _commit_to_timeline(
    repo: Path,
    worktree: Path,
    *,
    timeline_id: str,
    message: str,
) -> str:
    if timeline_id == DEFAULT_TIMELINE_ID:
        return _stage_and_commit(repo, worktree, message)
    ref = timeline_ref_name(timeline_id)
    parent = _rev_sha(repo, worktree, ref)
    if parent is None:
        raise GitHistoryError(f"timeline ref missing: {timeline_id}")
    worktree.mkdir(parents=True, exist_ok=True)
    _run_git(["add", "-A", "--", "."], repo=repo, worktree=worktree)
    _prune_ignored_index_paths(repo, worktree)
    tree = _run_git(["write-tree"], repo=repo, worktree=worktree).stdout.strip()
    if not tree:
        raise GitHistoryError("git write-tree produced an empty tree id")
    sha = _run_git(
        ["commit-tree", tree, "-p", parent, "-m", message],
        repo=repo,
        worktree=worktree,
    ).stdout.strip()
    if not sha:
        raise GitHistoryError("git commit-tree succeeded but produced no sha")
    _run_git(
        ["update-ref", ref, sha, parent],
        repo=repo,
        worktree=worktree,
    )
    return sha


def _timeline_state_path(worktree: Path) -> Path:
    return worktree / TIMELINE_STATE_RELPATH


def _default_timeline_state(campaign_id: str) -> dict[str, Any]:
    return {
        "schema_generation": TIMELINE_STATE_SCHEMA,
        "campaign_id": campaign_id,
        "active_timeline_id": DEFAULT_TIMELINE_ID,
        "timelines": [
            {
                "timeline_id": DEFAULT_TIMELINE_ID,
                "campaign_id": campaign_id,
                "kind": "root",
                "parents": [],
                "fork_point": None,
                "created_by": "initial",
            }
        ],
        "confluences": [],
        "game_reasons": {},
    }


def _read_timeline_state_file(worktree: Path, campaign_id: str) -> dict[str, Any]:
    path = _timeline_state_path(worktree)
    if not path.is_file() or path.is_symlink():
        return _default_timeline_state(campaign_id)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise GitHistoryError(f"timeline-state.json is unreadable: {exc}") from exc
    if not isinstance(payload, dict):
        raise GitHistoryError("timeline-state.json must be a JSON object")
    generation = payload.get("schema_generation")
    if generation != TIMELINE_STATE_SCHEMA:
        raise GitHistoryError(
            "timeline-state.json schema_generation must be "
            f"{TIMELINE_STATE_SCHEMA!r}"
        )
    return payload


def _write_timeline_state(worktree: Path, state: Mapping[str, Any]) -> None:
    path = _timeline_state_path(worktree)
    path.parent.mkdir(parents=True, exist_ok=True)
    coc_fileio.write_json_atomic(
        path,
        dict(state),
        indent=2,
        ensure_ascii=False,
        trailing_newline=True,
    )


def _validate_state_timelines(state: Mapping[str, Any]) -> None:
    try:
        tm_contract.validate_timeline_set(
            state.get("timelines") or [],
            active_timeline_id=state.get("active_timeline_id"),
        )
        for record in state.get("confluences") or []:
            tm_contract.validate_confluence(record)
    except tm_contract.TemporalMemoryContractError as exc:
        raise GitHistoryError(str(exc)) from exc


def _campaign_lock(worktree: Path):
    # Toolbox transactions already hold the campaign's exclusive lock around
    # every campaign operation; a coordinator call nested inside one re-enters
    # without re-acquiring so the same process cannot self-deadlock. A foreign
    # (or absent) holder still takes the real exclusive lock, so cross-process
    # serialization is unchanged.
    if coc_fileio.campaign_lock_held_by_current_process(worktree):
        return contextlib.nullcontext(worktree / ".campaign.lock")
    return coc_fileio.campaign_lock(worktree, wait_seconds=5.0)


def load_timeline_state(root: Path | str, campaign_id: str) -> dict[str, Any]:
    """Return the persisted timeline set, or the implied ``tl-main`` default."""
    campaign_id = _require_campaign_id(campaign_id)
    worktree = worktree_path_for(root, campaign_id)
    state = _read_timeline_state_file(worktree, campaign_id)
    _validate_state_timelines(state)
    return state


def active_timeline_id(root: Path | str, campaign_id: str) -> str:
    """Semantic id of the timeline ``turn.finalize`` currently commits to."""
    campaign_id = _require_campaign_id(campaign_id)
    worktree = worktree_path_for(root, campaign_id)
    state = _read_timeline_state_file(worktree, campaign_id)
    active = state.get("active_timeline_id") or DEFAULT_TIMELINE_ID
    return _require_timeline_id(str(active))


def _trailers_for_commit(
    repo: Path, worktree: Path, sha: str
) -> dict[str, str]:
    message = _run_git(
        ["log", "-1", "--format=%B", sha],
        repo=repo,
        worktree=worktree,
    ).stdout
    return parse_trailers(message)


def _turn_from_commit(repo: Path, worktree: Path, sha: str) -> int:
    trailers = _trailers_for_commit(repo, worktree, sha)
    raw = trailers.get("Turn-Number") or ""
    if not raw.isdigit():
        raise GitHistoryError(
            "fork/history source commit is not a turn commit with Turn-Number"
        )
    turn = int(raw)
    if turn < 1:
        raise GitHistoryError("fork_point.turn must be >= 1")
    return turn


def _resolve_source_commit(
    repo: Path,
    worktree: Path,
    *,
    source_timeline_id: str,
    source_turn: int | None,
    source_commit: str | None,
) -> str:
    ref = timeline_ref_name(source_timeline_id)
    if source_commit:
        token = source_commit.strip().lower()
        if tm_contract.COMMIT_SHA_RE.fullmatch(token) is None:
            raise ValueError("source_commit must be a git object id")
        resolved = _rev_sha(repo, worktree, token)
        if resolved is None:
            raise GitHistoryError("source_commit is not in the campaign repository")
        if _rev_sha(repo, worktree, ref) is None:
            raise GitHistoryError(f"source timeline ref missing: {source_timeline_id}")
        ancestor = _run_git(
            ["merge-base", "--is-ancestor", resolved, ref],
            repo=repo,
            worktree=worktree,
            check=False,
        )
        if ancestor.returncode != 0:
            raise GitHistoryError(
                "source_commit is not on the source timeline"
            )
        return resolved
    if source_turn is not None:
        if not isinstance(source_turn, int) or isinstance(source_turn, bool) or source_turn < 1:
            raise ValueError("source_turn must be an int >= 1")
        for sha, body in _commit_log_records(repo, worktree, rev=ref):
            trailers = parse_trailers(body)
            if (
                trailers.get("COC-Commit-Type") == "turn"
                and trailers.get("Turn-Number") == str(source_turn)
                and trailers.get("Timeline-Id") == source_timeline_id
            ):
                return sha
        raise GitHistoryError(
            f"no turn {source_turn} on timeline {source_timeline_id}"
        )
    tip = _rev_sha(repo, worktree, ref)
    if tip is None:
        raise GitHistoryError(f"source timeline ref missing: {source_timeline_id}")
    return tip


def _ls_tree_blobs(
    repo: Path, worktree: Path, rev: str
) -> dict[str, tuple[str, str]]:
    completed = _run_git(
        ["ls-tree", "-r", "--full-tree", rev],
        repo=repo,
        worktree=worktree,
    )
    blobs: dict[str, tuple[str, str]] = {}
    for line in completed.stdout.splitlines():
        if "\t" not in line:
            continue
        meta, path = line.split("\t", 1)
        parts = meta.split()
        if len(parts) >= 3 and parts[1] == "blob" and path:
            blobs[path] = (parts[0], parts[2])
    return blobs


def _hash_blob(repo: Path, worktree: Path, data: bytes) -> str:
    completed = subprocess.run(
        [_git_executable(), *_GIT_CONFIG_ARGS, f"--git-dir={repo}", "hash-object", "-w", "--stdin"],
        input=data,
        cwd=str(worktree),
        env=_isolated_git_env(),
        capture_output=True,
        check=False,
    )
    if completed.returncode != 0:
        stderr = (completed.stderr or b"").decode("utf-8", errors="replace")
        raise GitHistoryError(f"git hash-object failed: {stderr.strip()}")
    sha = completed.stdout.decode("utf-8", errors="replace").strip()
    if not sha:
        raise GitHistoryError("git hash-object produced no sha")
    return sha


def _write_tree_from_entries(
    repo: Path,
    worktree: Path,
    entries: list[tuple[str, tuple[str, str]]],
) -> str:
    with tempfile.TemporaryDirectory(prefix="coc-timeline-index-") as tmp:
        extra = {"GIT_INDEX_FILE": str(Path(tmp) / "index")}
        _run_git(
            ["read-tree", "--empty"],
            repo=repo,
            worktree=worktree,
            extra_env=extra,
        )
        if entries:
            payload = "".join(
                f"{mode} blob {sha}\t{path}\n" for path, (mode, sha) in entries
            )
            _run_git(
                ["update-index", "--index-info"],
                repo=repo,
                worktree=worktree,
                extra_env=extra,
                input_text=payload,
            )
        tree = _run_git(
            ["write-tree"],
            repo=repo,
            worktree=worktree,
            extra_env=extra,
        ).stdout.strip()
    if not tree:
        raise GitHistoryError("confluence write-tree produced no tree id")
    return tree


def _conflict_paths(conflict: Mapping[str, Any]) -> list[str]:
    """Tree paths a conflict claims (left/right ``refs``)."""
    paths: list[str] = []
    for side in ("left", "right"):
        value = conflict.get(side)
        if not isinstance(value, Mapping):
            raise GitHistoryError(
                "conflict "
                f"{conflict.get('conflict_id')!r} has a non-mapping side"
            )
        for ref in value.get("refs") or []:
            if isinstance(ref, str) and ref:
                paths.append(ref)
    return paths


def _claimed_tree_paths(refs: list[str], tree_paths: list[str]) -> list[str]:
    """Tree paths named by conflict refs, directly or as their content.

    A ref claims the longest tree path ``P`` with ``ref == P`` or
    ``ref.startswith(P + "/")``: a leaf-pointer ref such as
    ``save/world-state.json/day`` names content of the tracked file
    ``save/world-state.json``, and a source-log ref claims its JSONL file.
    Refs naming no tree path (semantic row ids like ``roll-42``) are
    semantic-only refs and claim nothing — they stay valid refs on the
    conflict record while the tree is decided by the refs that do name
    paths. Deterministic: only the actual left/right tree path set is
    consulted, never a pattern guess.
    """
    claimed: list[str] = []
    for ref in refs:
        match: str | None = None
        for path in tree_paths:
            if ref == path or ref.startswith(path + "/"):
                if match is None or len(path) > len(match):
                    match = path
        if match is not None:
            claimed.append(match)
    return claimed


def _read_blob_text(repo: Path, worktree: Path, blob_sha: str) -> str:
    """UTF-8 text of one blob (read-only object read)."""
    return _run_git(
        ["cat-file", "blob", blob_sha], repo=repo, worktree=worktree
    ).stdout


def _additive_union(value_a: Any, value_b: Any, path: str, pointer: str) -> Any:
    """Deep union of two JSON values over disjoint additions only.

    Shared leaves with different values are genuine uncovered conflicts and
    fail closed (they must be dispositioned through a conflict, never merged
    here); lists merge only when equal. Purely additive: nothing is invented
    and nothing silently overwrites.
    """
    if isinstance(value_a, dict) and isinstance(value_b, dict):
        merged: dict[str, Any] = {}
        for key in sorted(set(value_a) | set(value_b)):
            if key in value_a and key in value_b:
                merged[key] = _additive_union(
                    value_a[key], value_b[key], path, f"{pointer}/{key}"
                )
            else:
                merged[key] = value_a.get(key, value_b.get(key))
        return merged
    if value_a == value_b:
        return value_a
    raise GitHistoryError(
        f"unresolved confluence tree paths: {path}: {pointer or '/'} differs "
        "between the parents without a conflict disposition"
    )


def _additive_blob(
    repo: Path,
    worktree: Path,
    path: str,
    left_blob: tuple[str, str] | None,
    right_blob: tuple[str, str] | None,
) -> tuple[str, str]:
    """Additive tree resolution for a differing path no conflict claims.

    One-sided growth keeps the side that has it. Growth on both sides unions
    additively: JSONL files union by lines (append-only canonical logs),
    JSON files union over disjoint leaves — a shared leaf with different
    values is an uncovered conflict and fails closed with the same
    unresolved-path error as before. Nothing is dispositioned here; the
    enumeration already surfaced every such addition to the KP.
    """
    if left_blob is None:
        assert right_blob is not None
        return right_blob
    if right_blob is None:
        return left_blob
    if path in CONFLUENCE_TRANSIENT_LOCK_PATHS:
        # Machine-internal bookkeeping: byte identity across epochs is not
        # meaningful, so deterministic carry beats a hard failure.
        return left_blob
    left_text = _read_blob_text(repo, worktree, left_blob[1])
    right_text = _read_blob_text(repo, worktree, right_blob[1])
    if left_text == right_text:
        return left_blob
    if path.endswith(".jsonl"):
        left_lines = left_text.splitlines()
        seen = set(left_lines)
        merged_lines = left_lines + [
            line for line in right_text.splitlines() if line not in seen
        ]
        merged_text = "".join(f"{line}\n" for line in merged_lines)
    elif path.endswith(".json"):
        try:
            merged_value = _additive_union(
                json.loads(left_text), json.loads(right_text), path, ""
            )
        except json.JSONDecodeError as exc:
            raise GitHistoryError(
                f"unresolved confluence tree paths: {path}: not valid JSON "
                f"({exc})"
            ) from exc
        merged_text = json.dumps(
            merged_value, ensure_ascii=False, sort_keys=True, indent=2
        ) + "\n"
    else:
        raise GitHistoryError(
            f"unresolved confluence tree paths: {path}: no conflict claims it "
            "and its face is not additively mergeable"
        )
    return (left_blob[0], _hash_blob(repo, worktree, merged_text.encode("utf-8")))


def _derive_confluence_resolutions(
    left_blobs: Mapping[str, tuple[str, str]],
    right_blobs: Mapping[str, tuple[str, str]],
    conflicts: list[Any] | None,
) -> dict[str, dict[str, str]]:
    """Deterministically derive per-path tree resolutions from the
    validated conflict manifest.

    The committed tree is a pure function of the two parent trees and this
    mapping: every tree path that differs between the parents must be
    claimed by a conflict whose ``refs`` name that exact path, and the
    conflict's disposition decides the outcome. ``choose_left``/
    ``choose_right`` take that side's blob, ``sacrifice``/``defer``/
    ``paradox`` drop the path, and the content-producing modes
    (``transform``/``combine``/``duplicate``) require canonical resolver
    content supplied separately. ``transform`` is a hard-mechanics merge and
    is restricted to hard-state conflict classes with resolver evidence.
    """
    claims: dict[str, tuple[str, str]] = {}
    tree_paths = sorted(set(left_blobs) | set(right_blobs))
    for conflict in conflicts or []:
        if not isinstance(conflict, Mapping):
            raise GitHistoryError("conflict entry is not a mapping")
        conflict_id = str(conflict.get("conflict_id") or "")
        disposition = conflict.get("disposition")
        if not isinstance(disposition, Mapping):
            raise GitHistoryError(
                f"conflict {conflict_id!r} has no disposition mapping"
            )
        mode = disposition.get("mode")
        if mode not in tm_contract.DISPOSITION_MODES:
            raise GitHistoryError(
                f"disposition mode {mode!r} is not a closed disposition"
            )
        if mode == "transform" and (
            conflict.get("class") not in tm_contract.HARD_STATE_CONFLICT_CLASSES
        ):
            raise GitHistoryError(
                "transform dispositions require a hard-state conflict class; "
                f"got {conflict.get('class')!r} (conflict {conflict_id!r})"
            )
        for path in _claimed_tree_paths(_conflict_paths(conflict), tree_paths):
            prior = claims.get(path)
            if prior is not None and prior[0] != mode:
                raise GitHistoryError(
                    f"path {path} has conflicting dispositions "
                    f"{prior[0]!r} and {mode!r}"
                )
            claims[path] = (mode, conflict_id)
    resolutions: dict[str, dict[str, str]] = {}
    uncovered = [
        path
        for path in sorted(set(left_blobs) | set(right_blobs))
        if left_blobs.get(path) != right_blobs.get(path) and path not in claims
    ]
    if uncovered:
        # Differing paths no conflict claims are not silently dropped: they
        # resolve additively (one-sided growth keeps its side; both-side
        # growth unions), and any true uncovered conflict inside them fails
        # closed at assembly with the unresolved-path error.
        for path in uncovered:
            resolutions[path] = {"source": "additive", "mode": "additive"}
    for path, (mode, conflict_id) in sorted(claims.items()):
        if mode == "choose_left":
            if path not in left_blobs:
                raise GitHistoryError(
                    f"choose_left disposition for {path} has no left blob "
                    f"(conflict {conflict_id!r})"
                )
            resolutions[path] = {"source": "left", "mode": mode}
        elif mode == "choose_right":
            if path not in right_blobs:
                raise GitHistoryError(
                    f"choose_right disposition for {path} has no right blob "
                    f"(conflict {conflict_id!r})"
                )
            resolutions[path] = {"source": "right", "mode": mode}
        elif mode in {"sacrifice", "defer", "paradox"}:
            resolutions[path] = {"source": "none", "mode": mode}
        else:
            if path not in left_blobs and path not in right_blobs:
                raise GitHistoryError(
                    f"{mode} disposition for {path} names a path present in "
                    f"neither parent (conflict {conflict_id!r})"
                )
            resolutions[path] = {"source": "content", "mode": mode}
    return resolutions


def _assemble_confluence_tree(
    repo: Path,
    worktree: Path,
    left_sha: str,
    right_sha: str,
    conflicts: list[Any],
    path_resolutions: Mapping[str, Any] | None,
) -> str:
    """Build the merged tree deterministically from the conflict manifest.

    ``path_resolutions`` cannot decide tree content on its own. Each entry
    must correspond to a conflict-claimed path and may only *echo* the
    manifest disposition mode, or supply the canonical resolver content for
    a content-producing disposition (``transform``/``combine``/
    ``duplicate``). Any entry that contradicts, exceeds, or is absent from
    the manifest fails closed.
    """
    left = _ls_tree_blobs(repo, worktree, left_sha)
    right = _ls_tree_blobs(repo, worktree, right_sha)
    derived = _derive_confluence_resolutions(left, right, list(conflicts or []))
    supplied = dict(path_resolutions or {})
    content_by_path: dict[str, str] = {}
    for path, raw in sorted(supplied.items()):
        resolution = derived.get(path)
        if resolution is None:
            raise GitHistoryError(
                f"path resolution for {path} does not correspond to any "
                "conflict in the manifest"
            )
        mode = resolution["mode"]
        if resolution["source"] != "content":
            if isinstance(raw, str):
                echoed = raw
                extra_keys: list[str] = []
            elif isinstance(raw, Mapping):
                echoed = str(raw.get("mode") or "")
                extra_keys = sorted(set(raw) - {"mode"})
            else:
                raise GitHistoryError(
                    f"path resolution for {path} is not a mode or mapping"
                )
            if echoed != mode or extra_keys:
                raise GitHistoryError(
                    f"path resolution for {path} contradicts the manifest "
                    f"disposition {mode!r}"
                )
            continue
        if isinstance(raw, str):
            content_by_path[path] = raw
            continue
        if not isinstance(raw, Mapping) or sorted(raw) != ["content", "mode"]:
            raise GitHistoryError(
                f"content resolution for {path} must be canonical text or a "
                "mapping with mode and content"
            )
        echoed_mode = str(raw.get("mode") or "")
        content = raw.get("content")
        if echoed_mode != mode or not isinstance(content, str):
            raise GitHistoryError(
                f"path resolution for {path} contradicts the manifest "
                f"disposition {mode!r} or lacks canonical content"
            )
        content_by_path[path] = content
    entries: list[tuple[str, tuple[str, str]]] = []
    for path in sorted(set(left) | set(right)):
        resolution = derived.get(path)
        if resolution is None:
            entries.append((path, left[path]))
            continue
        source = resolution["source"]
        if source == "left":
            entries.append((path, left[path]))
        elif source == "right":
            entries.append((path, right[path]))
        elif source == "none":
            continue
        elif source == "additive":
            entries.append(
                (path, _additive_blob(repo, worktree, path, left.get(path), right.get(path)))
            )
        else:
            content = content_by_path.get(path)
            if content is None:
                raise GitHistoryError(
                    f"content resolution for {path} requires canonical "
                    "resolver content"
                )
            blob = _hash_blob(repo, worktree, content.encode("utf-8"))
            filemode = (left.get(path) or right.get(path) or ("100644", ""))[0]
            entries.append((path, (filemode, blob)))
    return _write_tree_from_entries(repo, worktree, entries)


def _sync_worktree_to_tree(repo: Path, worktree: Path, commit_sha: str) -> None:
    """Materialize one commit's tree into the campaign worktree.

    Used after a fresh confluence registration with activation: the merged
    tree is the new canonical state of the active line, so the worktree
    (campaign directory) must carry exactly it — otherwise the next
    finalized turn snapshots whatever stale parent content happened to be
    lying around, silently reverting the KP's dispositions. Mirrors
    ``restore_save_subset``: tracked paths are checked out in batches;
    paths tracked in the index but absent from the tree (sacrificed or
    paradoxed content) are removed from the worktree and index; ignore-face
    files are untracked and never touched. Only safe while the line owns
    no commits beyond ``commit_sha``.
    """
    listed = _run_git(
        ["ls-tree", "-r", "--name-only", commit_sha],
        repo=repo,
        worktree=worktree,
    )
    tree_paths = [name for name in listed.stdout.splitlines() if name]
    index_listed = _run_git(
        ["ls-files", "-z"], repo=repo, worktree=worktree, check=False
    )
    index_paths = {
        name for name in index_listed.stdout.split("\0") if name
    }
    for relpath in sorted(index_paths - set(tree_paths)):
        _run_git(
            ["rm", "--cached", "--ignore-unmatch", "--", relpath],
            repo=repo,
            worktree=worktree,
        )
        target = worktree / relpath
        try:
            if target.is_file() or target.is_symlink():
                target.unlink()
        except OSError as exc:
            raise GitHistoryError(
                f"cannot remove sacrificed confluence path {relpath}: {exc}"
            ) from exc
    batch_size = 200
    for start in range(0, len(tree_paths), batch_size):
        batch = tree_paths[start : start + batch_size]
        _run_git(
            ["checkout", commit_sha, "--", *batch],
            repo=repo,
            worktree=worktree,
        )


def _index_blobs(
    repo: Path, worktree: Path
) -> tuple[dict[str, tuple[str, str]], list[str]]:
    """Current stage-0 index entries plus any unsafe unmerged-stage findings."""
    listed = _run_git(
        ["ls-files", "-s", "-z"], repo=repo, worktree=worktree
    )
    blobs: dict[str, tuple[str, str]] = {}
    problems: list[str] = []
    for entry in listed.stdout.split("\0"):
        if not entry or "\t" not in entry:
            continue
        meta, path = entry.split("\t", 1)
        parts = meta.split()
        if len(parts) != 3 or not path:
            problems.append("campaign index contains an unreadable entry")
            continue
        mode, blob, stage = parts
        if stage != "0":
            problems.append(f"{path}: campaign index is unmerged at stage {stage}")
            continue
        blobs[path] = (mode, blob)
    return blobs, problems


def _worktree_blob(
    repo: Path,
    worktree: Path,
    relpath: str,
) -> tuple[str, str] | None:
    """Read-only Git blob identity for one on-disk tracked path."""
    target = worktree / relpath
    try:
        target.parent.resolve(strict=False).relative_to(
            worktree.resolve(strict=False)
        )
    except (OSError, ValueError) as exc:
        raise GitHistoryError(
            f"unsafe campaign worktree path while recovering confluence: {relpath}"
        ) from exc
    if target.is_symlink():
        mode = "120000"
        data = os.readlink(target).encode("utf-8", errors="surrogateescape")
    elif target.is_file():
        try:
            stat_result = target.stat()
            data = target.read_bytes()
        except OSError as exc:
            raise GitHistoryError(
                f"cannot inspect campaign worktree path {relpath}: {exc}"
            ) from exc
        mode = "100755" if stat_result.st_mode & 0o111 else "100644"
    elif target.exists():
        raise GitHistoryError(
            f"campaign worktree path {relpath} is not a file or symlink"
        )
    else:
        return None
    completed = subprocess.run(
        [
            _git_executable(),
            *_GIT_CONFIG_ARGS,
            f"--git-dir={repo}",
            "hash-object",
            "--stdin",
        ],
        input=data,
        cwd=str(worktree),
        env=_isolated_git_env(),
        capture_output=True,
        check=False,
    )
    if completed.returncode != 0:
        stderr = (completed.stderr or b"").decode("utf-8", errors="replace")
        raise GitHistoryError(
            f"cannot hash campaign worktree path {relpath}: {stderr.strip()}"
        )
    blob = completed.stdout.decode("ascii", errors="strict").strip()
    if not blob:
        raise GitHistoryError(
            f"cannot hash campaign worktree path {relpath}: empty object id"
        )
    return mode, blob


def _confluence_materialization_recovery_problems(
    repo: Path,
    worktree: Path,
    *,
    merge_sha: str,
) -> list[str]:
    """Why replay cannot safely finish a previously failed tree sync.

    A failed checkout can leave the index/worktree wholly on either parent or
    partially on the merge tree. Recovery is safe only while every tracked
    path is byte/mode-identical to one of those three immutable trees and no
    non-ignored untracked path exists. Any third value is unrelated campaign
    work and must never be overwritten by an old idempotent retry.
    """
    parents = _run_git(
        ["rev-list", "--no-walk", "--parents", merge_sha],
        repo=repo,
        worktree=worktree,
    ).stdout.strip().split()
    if len(parents) != 3 or parents[0] != merge_sha:
        return ["registered confluence commit no longer has exactly two parents"]
    trees = [
        _ls_tree_blobs(repo, worktree, sha)
        for sha in (merge_sha, parents[1], parents[2])
    ]
    paths = set().union(*(tree.keys() for tree in trees))
    index, problems = _index_blobs(repo, worktree)
    paths.update(index)
    untracked = _run_git(
        ["ls-files", "--others", "--exclude-standard", "-z"],
        repo=repo,
        worktree=worktree,
    )
    for path in sorted(
        item
        for item in untracked.stdout.split("\0")
        if item and item != ".campaign.lock"
    ):
        problems.append(f"{path}: unrelated untracked campaign worktree path")
    for path in sorted(paths):
        allowed = {tree.get(path) for tree in trees}
        indexed = index.get(path)
        if indexed not in allowed:
            problems.append(f"{path}: unrelated index change")
        on_disk = _worktree_blob(repo, worktree, path)
        if on_disk not in allowed:
            problems.append(f"{path}: unrelated worktree change")
    return problems


def check_confluence_tree_binding(
    repo: Path,
    worktree: Path,
    *,
    merge_sha: str,
    left_sha: str,
    right_sha: str,
    conflicts: list[Any] | None,
) -> list[str]:
    """Read-only: verify the merge commit tree follows the conflict manifest.

    Recomputes the deterministic per-path resolutions from the recorded
    conflicts and compares them with the merge commit tree: mechanical
    dispositions must match the chosen parent blob exactly, dropped paths
    must be absent, content-producing dispositions must leave the path
    present, and no path may appear from outside the manifest. Returns a
    list of problems; an empty list means the tree is bound to the
    manifest.
    """
    try:
        left = _ls_tree_blobs(repo, worktree, left_sha)
        right = _ls_tree_blobs(repo, worktree, right_sha)
        merge = _ls_tree_blobs(repo, worktree, merge_sha)
        derived = _derive_confluence_resolutions(left, right, list(conflicts or []))
    except GitHistoryError as exc:
        return [str(exc)]
    problems: list[str] = []
    for path in sorted(set(merge)):
        if path in derived:
            continue
        if path in left and path in right and left[path] == right[path]:
            continue
        problems.append(
            f"{path}: merge-tree path differs from both parents without a "
            "manifest disposition"
        )
    for path, resolution in sorted(derived.items()):
        mode = resolution["mode"]
        source = resolution["source"]
        if source == "none":
            if path in merge:
                problems.append(
                    f"{path}: disposition {mode} must drop the path but the "
                    "merge tree keeps it"
                )
            continue
        merge_blob = merge.get(path)
        if merge_blob is None:
            problems.append(
                f"{path}: disposition {mode} requires the path in the merge "
                "tree but it is absent"
            )
            continue
        if source == "left" and merge_blob != left.get(path):
            problems.append(
                f"{path}: disposition choose_left must carry the left parent "
                "blob"
            )
        elif source == "right" and merge_blob != right.get(path):
            problems.append(
                f"{path}: disposition choose_right must carry the right "
                "parent blob"
            )
        elif source == "additive":
            expected = _additive_blob(
                repo, worktree, path, left.get(path), right.get(path)
            )
            if merge_blob != expected:
                problems.append(
                    f"{path}: additive resolution must carry the additive "
                    "union of both parent blobs"
                )
    return problems


def _normalize_selector(selector: Any) -> dict[str, Any]:
    if isinstance(selector, str):
        token = selector.strip()
        if token.startswith("tl-"):
            return {"timeline_id": _require_timeline_id(token)}
        if tm_contract.COMMIT_SHA_RE.fullmatch(token.lower()):
            return {"commit": token.lower()}
        raise ValueError("selector string must be a timeline id or commit sha")
    if not isinstance(selector, Mapping):
        raise ValueError("selector must be a mapping or string")
    return dict(selector)


def resolve_history_selector(
    root: Path | str,
    campaign_id: str,
    selector: Any,
) -> dict[str, Any]:
    """Resolve a semantic timeline/turn selector to a commit (machine sha)."""
    campaign_id = _require_campaign_id(campaign_id)
    repo = repo_path_for(root, campaign_id)
    worktree = worktree_path_for(root, campaign_id)
    if not _looks_like_git_repo(repo):
        raise GitHistoryError("campaign git repo is missing")
    spec = _normalize_selector(selector)
    commit = spec.get("commit")
    if isinstance(commit, str) and commit.strip():
        sha = _rev_sha(repo, worktree, commit.strip().lower())
        if sha is None:
            raise GitHistoryError("selector commit is not in the campaign repository")
        trailers = _trailers_for_commit(repo, worktree, sha)
        return {
            "commit": sha,
            "timeline_id": trailers.get("Timeline-Id"),
            "turn_number": trailers.get("Turn-Number"),
            "commit_type": trailers.get("COC-Commit-Type"),
            "trailers": trailers,
        }
    timeline_id = _require_timeline_id(str(spec.get("timeline_id") or DEFAULT_TIMELINE_ID))
    ref = timeline_ref_name(timeline_id)
    if _rev_sha(repo, worktree, ref) is None:
        raise GitHistoryError(f"timeline ref missing: {timeline_id}")
    turn = spec.get("turn", spec.get("turn_number"))
    if turn is None:
        sha = _rev_sha(repo, worktree, ref)
        assert sha is not None
        trailers = _trailers_for_commit(repo, worktree, sha)
        return {
            "commit": sha,
            "timeline_id": timeline_id,
            "turn_number": trailers.get("Turn-Number"),
            "commit_type": trailers.get("COC-Commit-Type"),
            "trailers": trailers,
            "ref": ref,
        }
    if not isinstance(turn, int) or isinstance(turn, bool) or turn < 1:
        raise ValueError("selector turn must be an int >= 1")
    for sha, body in _commit_log_records(repo, worktree, rev=ref):
        trailers = parse_trailers(body)
        if (
            trailers.get("COC-Commit-Type") == "turn"
            and trailers.get("Turn-Number") == str(turn)
            and trailers.get("Timeline-Id") == timeline_id
        ):
            return {
                "commit": sha,
                "timeline_id": timeline_id,
                "turn_number": str(turn),
                "commit_type": "turn",
                "trailers": trailers,
                "ref": ref,
            }
    raise GitHistoryError(f"no turn {turn} on timeline {timeline_id}")


def history_query(
    root: Path | str,
    campaign_id: str,
    selector: Any,
) -> dict[str, Any]:
    """Read-only: resolve a selector to commit metadata and tree blobs.

    File bytes are fetched only via ``git show <rev>:<path>`` when ``path``
    (or ``paths``) is present. Never mutates the worktree.
    """
    resolved = resolve_history_selector(root, campaign_id, selector)
    campaign_id = _require_campaign_id(campaign_id)
    repo = repo_path_for(root, campaign_id)
    worktree = worktree_path_for(root, campaign_id)
    sha = resolved["commit"]
    blobs = _ls_tree_blobs(repo, worktree, sha)
    tree = [
        {"path": path, "mode": mode, "blob": blob}
        for path, (mode, blob) in blobs.items()
    ]
    payload: dict[str, Any] = {
        **resolved,
        "tree": tree,
    }
    spec = _normalize_selector(selector)
    paths: list[str] = []
    if isinstance(spec.get("path"), str) and spec["path"]:
        paths.append(spec["path"])
    extra_paths = spec.get("paths")
    if isinstance(extra_paths, (list, tuple)):
        paths.extend(str(item) for item in extra_paths if item)
    contents: dict[str, str] = {}
    for relpath in paths:
        normalized = relpath.replace("\\", "/").lstrip("./")
        if not normalized or normalized.startswith("/") or ".." in normalized.split("/"):
            raise ValueError(f"unsafe history path: {relpath}")
        shown = _run_git(
            ["show", f"{sha}:{normalized}"],
            repo=repo,
            worktree=worktree,
            check=False,
        )
        if shown.returncode != 0:
            raise GitHistoryError(f"path {normalized} is not in commit")
        contents[normalized] = shown.stdout
    if contents:
        payload["content"] = contents
    return payload


def history_diff(
    root: Path | str,
    campaign_id: str,
    from_selector: Any,
    to_selector: Any,
) -> dict[str, Any]:
    """Read-only structured diff between two selectors. No worktree mutation."""
    campaign_id = _require_campaign_id(campaign_id)
    repo = repo_path_for(root, campaign_id)
    worktree = worktree_path_for(root, campaign_id)
    left = resolve_history_selector(root, campaign_id, from_selector)
    right = resolve_history_selector(root, campaign_id, to_selector)
    completed = _run_git(
        [
            "diff-tree",
            "-r",
            "--raw",
            "--no-commit-id",
            left["commit"],
            right["commit"],
        ],
        repo=repo,
        worktree=worktree,
    )
    changes: list[dict[str, Any]] = []
    for line in completed.stdout.splitlines():
        if not line.startswith(":") or "\t" not in line:
            continue
        meta, path = line[1:].split("\t", 1)
        parts = meta.split()
        if len(parts) < 5:
            continue
        changes.append(
            {
                "path": path,
                "from_mode": parts[0],
                "to_mode": parts[1],
                "from_blob": parts[2],
                "to_blob": parts[3],
                "status": parts[4],
            }
        )
    return {
        "from": left,
        "to": right,
        "changes": changes,
    }


def set_active_timeline(
    root: Path | str,
    campaign_id: str,
    timeline_id: str,
) -> str:
    """Persist the active timeline pointer. Never ``git reset`` or force-push."""
    campaign_id = _require_campaign_id(campaign_id)
    timeline_id = _require_timeline_id(timeline_id)
    repo = ensure_repo(root, campaign_id)
    worktree = worktree_path_for(root, campaign_id)
    try:
        with _campaign_lock(worktree):
            state = _read_timeline_state_file(worktree, campaign_id)
            ids = {item.get("timeline_id") for item in state.get("timelines") or []}
            if timeline_id not in ids:
                raise GitHistoryError(
                    f"active timeline {timeline_id!r} is not in the timeline set"
                )
            if _rev_sha(repo, worktree, timeline_ref_name(timeline_id)) is None:
                raise GitHistoryError(f"timeline ref missing: {timeline_id}")
            state["active_timeline_id"] = timeline_id
            _validate_state_timelines(state)
            _write_timeline_state(worktree, state)
            return timeline_id
    except coc_fileio.CampaignLockError as exc:
        raise GitHistoryError(f"campaign lock failed: {exc}") from exc


def fork_timeline(
    root: Path | str,
    campaign_id: str,
    *,
    timeline_id: str,
    game_reason: str,
    source_timeline_id: str = DEFAULT_TIMELINE_ID,
    source_turn: int | None = None,
    source_commit: str | None = None,
    created_by: str = "kp_decision",
    activate: bool = False,
) -> dict[str, Any]:
    """Point a new timeline ref at an existing commit. No rewrite, no reset.

    Transactional like confluence: the record is validated before
    ``update-ref``; a timeline-state persistence failure afterwards rolls
    the just-created ref back (the fork commit is an existing parent —
    nothing is rewritten or deleted), and a ref left by a hard crash in
    that window is registered only when it still points at this fork
    point; anything else fails closed.
    """
    campaign_id = _require_campaign_id(campaign_id)
    timeline_id = _require_timeline_id(timeline_id)
    source_timeline_id = _require_timeline_id(source_timeline_id)
    game_reason = _sanitize_single_line(_require_token(game_reason, "game_reason"))
    if timeline_id == DEFAULT_TIMELINE_ID:
        raise GitHistoryError("cannot fork onto the root timeline id")
    if created_by not in tm_contract.TIMELINE_CREATED_BY:
        raise ValueError("created_by is not a closed TIMELINE_CREATED_BY value")
    repo = ensure_repo(root, campaign_id)
    worktree = worktree_path_for(root, campaign_id)
    try:
        with _campaign_lock(worktree):
            state = _read_timeline_state_file(worktree, campaign_id)
            existing = next(
                (
                    item
                    for item in state.get("timelines") or []
                    if item.get("timeline_id") == timeline_id
                ),
                None,
            )
            source_sha = _resolve_source_commit(
                repo,
                worktree,
                source_timeline_id=source_timeline_id,
                source_turn=source_turn,
                source_commit=source_commit,
            )
            turn = _turn_from_commit(repo, worktree, source_sha)
            episode_id = tm_contract.episode_id_for(
                campaign_id, source_timeline_id, turn
            )
            record = {
                "timeline_id": timeline_id,
                "campaign_id": campaign_id,
                "kind": "fork",
                "parents": [source_timeline_id],
                "fork_point": {
                    "commit": source_sha,
                    "turn": turn,
                    "episode_id": episode_id,
                },
                "created_by": created_by,
            }
            ref = timeline_ref_name(timeline_id)
            current = _rev_sha(repo, worktree, ref)
            if existing is not None:
                if existing.get("fork_point", {}).get("commit") != source_sha:
                    raise GitHistoryError(
                        f"timeline {timeline_id} already exists at a different fork point"
                    )
                if current is not None and current != source_sha and not _is_descendant(
                    repo, worktree, ancestor=source_sha, descendant=current
                ):
                    raise GitHistoryError(
                        f"timeline {timeline_id} ref moved off its fork point"
                    )
                if current is None:
                    _run_git(
                        ["update-ref", ref, source_sha, "0" * 40],
                        repo=repo,
                        worktree=worktree,
                    )
                if activate:
                    state["active_timeline_id"] = timeline_id
                    _validate_state_timelines(state)
                    _write_timeline_state(worktree, state)
                return {
                    "timeline_id": timeline_id,
                    "ref": ref,
                    "source_commit": source_sha,
                    "idempotent": True,
                }
            if current is not None:
                if current != source_sha:
                    raise GitHistoryError(
                        f"timeline ref {ref} already exists without "
                        "timeline-state and does not point at this fork point"
                    )
                # Crash-window residue: the ref was created between
                # ``update-ref`` and the timeline-state write. Registering
                # the fork completes the interrupted transaction; the ref
                # never silently stays unregistered.
                state.setdefault("timelines", []).append(record)
                state.setdefault("game_reasons", {})[timeline_id] = game_reason
                if activate:
                    state["active_timeline_id"] = timeline_id
                _validate_state_timelines(state)
                _write_timeline_state(worktree, state)
                return {
                    "timeline_id": timeline_id,
                    "ref": ref,
                    "source_commit": source_sha,
                    "turn": turn,
                    "episode_id": episode_id,
                    "game_reason": game_reason,
                    "idempotent": False,
                    "recovered": True,
                }
            try:
                tm_contract.validate_timeline(record)
            except tm_contract.TemporalMemoryContractError as exc:
                raise GitHistoryError(str(exc)) from exc
            _run_git(
                ["update-ref", ref, source_sha, "0" * 40],
                repo=repo,
                worktree=worktree,
            )
            try:
                # Confirm parent ref unchanged (no rewrite).
                parent_ref = timeline_ref_name(source_timeline_id)
                parent_after = _rev_sha(repo, worktree, parent_ref)
                if parent_after is None:
                    raise GitHistoryError(
                        "source timeline ref disappeared during fork"
                    )
                state.setdefault("timelines", []).append(record)
                state.setdefault("game_reasons", {})[timeline_id] = game_reason
                if activate:
                    state["active_timeline_id"] = timeline_id
                _validate_state_timelines(state)
                _write_timeline_state(worktree, state)
            except Exception as exc:
                rollback_error = _rollback_created_ref(repo, worktree, ref)
                if rollback_error is not None:
                    raise GitHistoryError(
                        f"fork failed ({exc}) and ref rollback also failed: "
                        f"{rollback_error}"
                    ) from exc
                raise
            return {
                "timeline_id": timeline_id,
                "ref": ref,
                "source_commit": source_sha,
                "turn": turn,
                "episode_id": episode_id,
                "game_reason": game_reason,
                "idempotent": False,
            }
    except coc_fileio.CampaignLockError as exc:
        raise GitHistoryError(f"campaign lock failed: {exc}") from exc


def _is_descendant(
    repo: Path, worktree: Path, *, ancestor: str, descendant: str
) -> bool:
    completed = _run_git(
        ["merge-base", "--is-ancestor", ancestor, descendant],
        repo=repo,
        worktree=worktree,
        check=False,
    )
    return completed.returncode == 0


def _rollback_created_ref(repo: Path, worktree: Path, ref: str) -> str | None:
    """Remove a ref created moments ago by this same transaction.

    The timeline-state registration failed, so the ref never became
    registered history; deleting the pointer returns the repository to the
    pre-call state (no reset, no force push, no parent mutation). Commit,
    tree, and blob objects stay in the object database — history is
    append-only evidence and nothing is ever purged. Returns an error string
    when even this rollback fails; the residue is then an orphan ref the
    verifier reports and a later call with the same arguments can recover.
    """
    try:
        _run_git(["update-ref", "-d", ref], repo=repo, worktree=worktree)
    except GitHistoryError as exc:
        return str(exc)
    return None


def _confluence_recovery_problems(
    repo: Path,
    worktree: Path,
    *,
    ref_sha: str,
    campaign_id: str,
    timeline_id: str,
    confluence_id: str,
    left_timeline_id: str,
    right_timeline_id: str,
    left_sha: str,
    right_sha: str,
    conflict_digest: str,
    disposition_digest: str,
    schema_generation: str,
    game_reason: str,
    conflicts: list[Any],
) -> list[str]:
    """Why an existing ref cannot be registered as this confluence.

    A ref that exists without a timeline-state record is a crash-window
    residue: created between ``update-ref`` and the timeline-state write. It
    may be registered only when it is exactly the commit this call would
    create — trailers, digests, parents — and its tree still binds to the
    manifest. Anything else fails closed.
    """
    trailers = _trailers_for_commit(repo, worktree, ref_sha)
    expected = {
        "COC-Commit-Type": "confluence",
        "Campaign-Id": campaign_id,
        "Timeline-Id": timeline_id,
        "Confluence-Id": confluence_id,
        "Parent-Timeline-Left": left_timeline_id,
        "Parent-Timeline-Right": right_timeline_id,
        "Conflict-Manifest-SHA256": conflict_digest,
        "Disposition-Manifest-SHA256": disposition_digest,
        "Schema-Generation": schema_generation,
        "Game-Reason": game_reason,
    }
    problems = [
        f"{key}={trailers.get(key)!r}"
        for key, value in expected.items()
        if trailers.get(key) != value
    ]
    parents_line = _run_git(
        ["rev-list", "--no-walk", "--parents", ref_sha],
        repo=repo,
        worktree=worktree,
    ).stdout.strip().split()
    if parents_line[1:] != [left_sha, right_sha]:
        problems.append(f"parents={parents_line[1:]}")
    problems.extend(
        check_confluence_tree_binding(
            repo,
            worktree,
            merge_sha=ref_sha,
            left_sha=left_sha,
            right_sha=right_sha,
            conflicts=conflicts,
        )
    )
    return problems


def confluence_timelines(
    root: Path | str,
    campaign_id: str,
    *,
    timeline_id: str,
    left_timeline_id: str,
    right_timeline_id: str,
    receipt: str,
    schema_generation: str,
    conflicts: list[Any] | None = None,
    path_resolutions: Mapping[str, Any] | None = None,
    confluence_id: str | None = None,
    created_by: str = "confluence",
    game_reason: str = "timeline confluence",
    activate: bool = False,
) -> dict[str, Any]:
    """Create a two-parent merge commit on a new timeline. No worktree merge.

    The committed tree is deterministically derived from the validated
    conflict manifest: every tree path differing between the parent tips
    must be claimed by a conflict whose ``refs`` name that path, and the
    conflict disposition decides the outcome. ``path_resolutions`` cannot
    contradict the manifest — it may only echo a mechanical disposition
    mode or carry the canonical resolver content for a content-producing
    disposition (``transform``/``combine``/``duplicate``; ``transform`` is
    hard-state only and needs ``resolver_receipt`` evidence). Mismatched
    or unmanifested entries fail closed before anything is registered.

    Registration is transactional: every validation (including tree
    assembly) happens before ``update-ref``; if the timeline-state
    persistence then fails, the just-created ref is rolled back so no
    unregistered confluence commit is silently registered. A ref left by a
    hard crash in that window is recovered (registered) only when it is
    exactly the commit this call would create and its tree still binds to
    the manifest; otherwise the call fails closed. An activated idempotent
    retry also finishes a previously failed worktree materialization, but only
    while the registered ref has not advanced and every live path is still an
    immutable merge/parent-tree value; unrelated work fails closed.
    """
    campaign_id = _require_campaign_id(campaign_id)
    timeline_id = _require_timeline_id(timeline_id)
    left_timeline_id = _require_timeline_id(left_timeline_id)
    right_timeline_id = _require_timeline_id(right_timeline_id)
    if left_timeline_id == right_timeline_id:
        raise GitHistoryError("confluence requires two distinct parent timelines")
    if timeline_id in {left_timeline_id, right_timeline_id, DEFAULT_TIMELINE_ID}:
        raise GitHistoryError("merged timeline must be a third timeline")
    receipt = _require_token(receipt, "receipt")
    schema_generation = _require_token(schema_generation, "schema_generation")
    game_reason = _sanitize_single_line(_require_token(game_reason, "game_reason"))
    if created_by not in tm_contract.TIMELINE_CREATED_BY:
        raise ValueError("created_by is not a closed TIMELINE_CREATED_BY value")
    if confluence_id is None:
        confluence_id = f"confluence-{campaign_id}-{timeline_id}"
    try:
        tm_contract._check_semantic_id(
            confluence_id,
            kind="confluence",
            field="confluence_id",
            prefix=tm_contract.ID_PREFIX["confluence"],
        )
    except tm_contract.TemporalMemoryContractError as exc:
        raise ValueError(str(exc)) from exc
    conflict_list = list(conflicts or [])
    repo = ensure_repo(root, campaign_id)
    worktree = worktree_path_for(root, campaign_id)
    try:
        with _campaign_lock(worktree):
            state = _read_timeline_state_file(worktree, campaign_id)
            existing = next(
                (
                    item
                    for item in state.get("confluences") or []
                    if item.get("confluence_id") == confluence_id
                ),
                None,
            )
            if existing is not None:
                if activate:
                    existing_timeline = str(existing.get("timeline_id") or "")
                    existing_merge = str(existing.get("merge_commit") or "")
                    if state.get("active_timeline_id") != existing_timeline:
                        raise GitHistoryError(
                            "cannot recover confluence worktree materialization: "
                            "the registered confluence is no longer the active "
                            "timeline"
                        )
                    existing_ref = timeline_ref_name(existing_timeline)
                    if _rev_sha(repo, worktree, existing_ref) != existing_merge:
                        raise GitHistoryError(
                            "cannot recover confluence worktree materialization: "
                            "the active timeline advanced beyond the registered "
                            "merge commit"
                        )
                    recovery_problems = (
                        _confluence_materialization_recovery_problems(
                            repo,
                            worktree,
                            merge_sha=existing_merge,
                        )
                    )
                    if recovery_problems:
                        raise GitHistoryError(
                            "unsafe confluence worktree materialization recovery: "
                            + "; ".join(recovery_problems)
                        )
                    _sync_worktree_to_tree(repo, worktree, existing_merge)
                return {
                    "timeline_id": existing["timeline_id"],
                    "confluence_id": confluence_id,
                    "merge_commit": existing["merge_commit"],
                    "ref": timeline_ref_name(existing["timeline_id"]),
                    "idempotent": True,
                }
            left_sha = _rev_sha(repo, worktree, timeline_ref_name(left_timeline_id))
            right_sha = _rev_sha(repo, worktree, timeline_ref_name(right_timeline_id))
            if left_sha is None or right_sha is None:
                raise GitHistoryError("confluence parent timeline ref is missing")
            left_turn = _turn_from_commit(repo, worktree, left_sha)
            conflict_digest = tm_contract.record_digest({"conflicts": conflict_list})
            dispositions = [
                {
                    "conflict_id": item.get("conflict_id"),
                    "disposition": item.get("disposition"),
                }
                for item in conflict_list
                if isinstance(item, Mapping)
            ]
            disposition_digest = tm_contract.record_digest(
                {"dispositions": dispositions}
            )
            placeholder = "0" * 40
            confluence_record = {
                "confluence_id": confluence_id,
                "campaign_id": campaign_id,
                "timeline_id": timeline_id,
                "parents": [left_timeline_id, right_timeline_id],
                "merge_commit": placeholder,
                "receipt": receipt,
                "conflicts": conflict_list,
            }
            try:
                tm_contract.validate_confluence(confluence_record)
            except tm_contract.TemporalMemoryContractError as exc:
                raise GitHistoryError(str(exc)) from exc
            # Validate before any ref mutation: the tree is derived from (and
            # bound to) the validated conflict manifest above, so a manifest
            # that cannot produce a tree fails before anything is registered.
            tree = _assemble_confluence_tree(
                repo, worktree, left_sha, right_sha, conflict_list, path_resolutions
            )
            trailers = [
                ("COC-Commit-Type", "confluence"),
                ("Campaign-Id", campaign_id),
                ("Timeline-Id", timeline_id),
                ("Confluence-Id", confluence_id),
                ("Parent-Timeline-Left", left_timeline_id),
                ("Parent-Timeline-Right", right_timeline_id),
                ("Conflict-Manifest-SHA256", conflict_digest),
                ("Disposition-Manifest-SHA256", disposition_digest),
                ("Schema-Generation", schema_generation),
                ("Game-Reason", game_reason),
            ]
            message = _format_commit_message(
                f"coc confluence: {confluence_id}", trailers
            )
            merge_sha = _run_git(
                [
                    "commit-tree",
                    tree,
                    "-p",
                    left_sha,
                    "-p",
                    right_sha,
                    "-m",
                    message,
                ],
                repo=repo,
                worktree=worktree,
            ).stdout.strip()
            if not merge_sha:
                raise GitHistoryError("confluence commit-tree produced no sha")
            parents_line = _run_git(
                ["rev-list", "--no-walk", "--parents", merge_sha],
                repo=repo,
                worktree=worktree,
            ).stdout.strip().split()
            if parents_line != [merge_sha, left_sha, right_sha]:
                raise GitHistoryError(
                    "confluence commit must have exactly the two parent "
                    f"tips in order, got {parents_line[1:]}"
                )
            confluence_record["merge_commit"] = merge_sha
            try:
                tm_contract.validate_confluence(confluence_record)
            except tm_contract.TemporalMemoryContractError as exc:
                raise GitHistoryError(str(exc)) from exc
            timeline_record = {
                "timeline_id": timeline_id,
                "campaign_id": campaign_id,
                "kind": "confluence",
                "parents": [left_timeline_id, right_timeline_id],
                "fork_point": {
                    "commit": merge_sha,
                    "turn": left_turn,
                    "episode_id": tm_contract.episode_id_for(
                        campaign_id, timeline_id, left_turn
                    ),
                },
                "created_by": created_by,
            }
            try:
                tm_contract.validate_timeline(timeline_record)
            except tm_contract.TemporalMemoryContractError as exc:
                raise GitHistoryError(str(exc)) from exc
            ref = timeline_ref_name(timeline_id)
            ref_sha = _rev_sha(repo, worktree, ref)
            if ref_sha is not None:
                # Crash-window residue (or foreign ref): register only the
                # exact commit this call would have created.
                problems = _confluence_recovery_problems(
                    repo,
                    worktree,
                    ref_sha=ref_sha,
                    campaign_id=campaign_id,
                    timeline_id=timeline_id,
                    confluence_id=confluence_id,
                    left_timeline_id=left_timeline_id,
                    right_timeline_id=right_timeline_id,
                    left_sha=left_sha,
                    right_sha=right_sha,
                    conflict_digest=conflict_digest,
                    disposition_digest=disposition_digest,
                    schema_generation=schema_generation,
                    game_reason=game_reason,
                    conflicts=conflict_list,
                )
                if problems:
                    raise GitHistoryError(
                        "timeline ref exists without timeline-state "
                        "registration and does not match this confluence: "
                        + "; ".join(problems)
                    )
                # Register the orphan commit itself: the freshly created
                # commit-tree may differ (timestamp) and is unreachable —
                # the ref already carries the authoritative merge.
                confluence_record["merge_commit"] = ref_sha
                timeline_record["fork_point"]["commit"] = ref_sha
                try:
                    tm_contract.validate_confluence(confluence_record)
                    tm_contract.validate_timeline(timeline_record)
                except tm_contract.TemporalMemoryContractError as exc:
                    raise GitHistoryError(str(exc)) from exc
                state.setdefault("timelines", []).append(timeline_record)
                state.setdefault("confluences", []).append(confluence_record)
                state.setdefault("game_reasons", {})[timeline_id] = game_reason
                if activate:
                    state["active_timeline_id"] = timeline_id
                _validate_state_timelines(state)
                _write_timeline_state(worktree, state)
                if activate:
                    _sync_worktree_to_tree(repo, worktree, ref_sha)
                return {
                    "timeline_id": timeline_id,
                    "confluence_id": confluence_id,
                    "merge_commit": ref_sha,
                    "ref": ref,
                    "parents": [left_timeline_id, right_timeline_id],
                    "conflict_manifest_sha256": conflict_digest,
                    "disposition_manifest_sha256": disposition_digest,
                    "idempotent": False,
                    "recovered": True,
                }
            _run_git(
                ["update-ref", ref, merge_sha, "0" * 40],
                repo=repo,
                worktree=worktree,
            )
            try:
                left_after = _rev_sha(
                    repo, worktree, timeline_ref_name(left_timeline_id)
                )
                right_after = _rev_sha(
                    repo, worktree, timeline_ref_name(right_timeline_id)
                )
                if left_after != left_sha or right_after != right_sha:
                    raise GitHistoryError("confluence mutated a parent timeline ref")
                state.setdefault("timelines", []).append(timeline_record)
                state.setdefault("confluences", []).append(confluence_record)
                state.setdefault("game_reasons", {})[timeline_id] = game_reason
                if activate:
                    state["active_timeline_id"] = timeline_id
                _validate_state_timelines(state)
                _write_timeline_state(worktree, state)
            except Exception as exc:
                rollback_error = _rollback_created_ref(repo, worktree, ref)
                if rollback_error is not None:
                    raise GitHistoryError(
                        f"confluence failed ({exc}) and ref rollback also "
                        f"failed: {rollback_error}"
                    ) from exc
                raise
            if activate:
                # The worktree now represents the freshly activated merged
                # line: carry its resolved tree into the campaign directory
                # so the next finalized turn commits the dispositions, not
                # stale parent content. Failure here leaves refs and state
                # registered — the campaign files simply stay stale until a
                # repair, which is reported rather than silently accepted.
                try:
                    _sync_worktree_to_tree(repo, worktree, merge_sha)
                except GitHistoryError as exc:
                    raise GitHistoryError(
                        "confluence registered but the campaign worktree "
                        f"could not be synced to the merged tree: {exc}"
                    ) from exc
            return {
                "timeline_id": timeline_id,
                "confluence_id": confluence_id,
                "merge_commit": merge_sha,
                "ref": ref,
                "parents": [left_timeline_id, right_timeline_id],
                "conflict_manifest_sha256": conflict_digest,
                "disposition_manifest_sha256": disposition_digest,
                "idempotent": False,
            }
    except coc_fileio.CampaignLockError as exc:
        raise GitHistoryError(f"campaign lock failed: {exc}") from exc
