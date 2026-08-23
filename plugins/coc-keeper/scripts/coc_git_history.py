#!/usr/bin/env python3
"""Sole writer of per-campaign git history (Commit Coordinator).

Sidecar bare repo at ``<root>/.coc/repos/campaigns/<id>.git``; the campaign
directory is the worktree. Never writes ``.git`` inside the campaign tree.
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Same constraint as coc_state._SAFE_ID. Duplicated so this module stays
# importable without loading campaign-state machinery.
_SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")

GIT_USER_NAME = "coc-keeper"
GIT_USER_EMAIL = "coc-keeper@localhost"
DEFAULT_TIMELINE_ID = "tl-main"
DEFAULT_BRANCH = "main"

# Single source of truth for the ignore face. Written to the bare repo's
# ``info/exclude``; never materialized as a campaign-tree ``.gitignore``.
IGNORE_PATHS: tuple[str, ...] = (
    "logs/pending-turns/",
    "save/session-state.json",
    "save/toolbox-ledger.json",
    "save/commit-snapshots/",
    "save/development-settlements/",
    "save/roll-operation-receipts.json",
    "save/run-identity.lock",
    "memory/index.json",
)

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
    "fatal: not a git repository",
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
        child.resolve(strict=False).relative_to(parent.resolve(strict=False))
    except (OSError, ValueError) as exc:
        raise ValueError(f"{label} path is unsafe") from exc
    if child.is_symlink():
        raise ValueError(f"{label} path is unsafe")
    return child


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
    """True when ``relpath`` is on the Coordinator ignore face."""
    normalized = relpath.replace("\\", "/").lstrip("./")
    if not normalized:
        return False
    for pattern in IGNORE_PATHS:
        if pattern.endswith("/"):
            if normalized == pattern[:-1] or normalized.startswith(pattern):
                return True
        elif normalized == pattern:
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


def _isolated_git_env() -> dict[str, str]:
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
            env=_isolated_git_env(),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )
    except FileNotFoundError as exc:
        raise GitHistoryUnavailableError(
            "git is required for campaign history but was not found on PATH"
        ) from exc
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
        )
    if not allow_lock_retry and repo is not None and _is_lock_error(stderr):
        raise GitHistoryError(
            f"git {' '.join(args)} failed after index.lock retry: {stderr.strip()}"
        )
    raise GitHistoryError(f"git {' '.join(args)} failed: {stderr.strip()}")


def _write_exclude(repo: Path) -> None:
    exclude = repo / "info" / "exclude"
    exclude.parent.mkdir(parents=True, exist_ok=True)
    exclude.write_text("\n".join(IGNORE_PATHS) + "\n", encoding="utf-8")


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


def _head_sha(repo: Path, worktree: Path) -> str | None:
    completed = _run_git(
        ["rev-parse", "--verify", "-q", "HEAD"],
        repo=repo,
        worktree=worktree,
        check=False,
    )
    if completed.returncode != 0:
        return None
    sha = completed.stdout.strip()
    return sha or None


def _format_commit_message(subject: str, trailers: list[tuple[str, str]]) -> str:
    args = ["interpret-trailers"]
    for key, value in trailers:
        args.extend(["--trailer", f"{key}: {value}"])
    completed = _run_git(args, input_text=f"{subject}\n", allow_lock_retry=False)
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


def _commit_log_records(repo: Path, worktree: Path) -> list[tuple[str, str]]:
    if _head_sha(repo, worktree) is None:
        return []
    completed = _run_git(
        ["log", "--format=%H%x1e%B%x1d"],
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
    for sha, body in _commit_log_records(repo, worktree):
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
    _run_git(
        ["commit", "--allow-empty", "-m", message],
        repo=repo,
        worktree=worktree,
    )
    sha = _head_sha(repo, worktree)
    if sha is None:
        raise GitHistoryError("git commit succeeded but HEAD is missing")
    return sha


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
    timeline_id: str = DEFAULT_TIMELINE_ID,
) -> str:
    """Commit the current worktree as one finalized turn.

    Replay of the same ``Finalization-Id`` returns the existing commit and
    does not create another. Distinct finalizations always record a commit
    (``--allow-empty``). A new commit is refused while
    ``save/pending-turn.json`` is present so an unfinalized later turn cannot
    bind into this receipt.
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
    timeline_id = _require_token(timeline_id, "timeline_id")

    repo = ensure_repo(root, campaign_id)
    worktree = worktree_path_for(root, campaign_id)
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
        return _stage_and_commit(repo, worktree, message)
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
        return _stage_and_commit(recovered, worktree, message)


def remove_repo(root: Path | str, campaign_id: str) -> None:
    """Delete the sidecar repo only. Never touches the campaign worktree."""
    repo = repo_path_for(root, campaign_id)
    if repo.exists():
        if not repo.is_dir() or repo.is_symlink():
            raise ValueError("campaign repo path is unsafe")
        shutil.rmtree(repo)


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
