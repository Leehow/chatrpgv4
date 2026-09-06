"""Sidecar bare repo per campaign (ADR-0001): .coc/repos/<id>.git with the
campaign directory as its work tree. One commit per campaign.create and per
successful narrate."""

from __future__ import annotations

import subprocess
from pathlib import Path

GIT_IDENTITY = [
    "-c", "user.name=coc-kernel",
    "-c", "user.email=kernel@coc.invalid",
    "-c", "commit.gpgsign=false",
    "-c", "core.autocrlf=false",
]


class CommitFailed(Exception):
    pass


def _git(repo: Path, work_tree: Path, *args: str) -> subprocess.CompletedProcess[str]:
    cmd = ["git", *GIT_IDENTITY, f"--git-dir={repo}", f"--work-tree={work_tree}", *args]
    try:
        return subprocess.run(cmd, cwd=work_tree, capture_output=True, text=True,
                              encoding="utf-8", check=False, timeout=60)
    except (OSError, subprocess.SubprocessError) as exc:
        raise CommitFailed(f"{' '.join(args[:1])}: {exc}") from exc


def _check(result: subprocess.CompletedProcess[str], what: str) -> None:
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()
        raise CommitFailed(f"git {what} failed ({result.returncode}): {detail}")


def init_repo(repo: Path, work_tree: Path) -> None:
    repo.parent.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(["git", *GIT_IDENTITY, "init", "--quiet", "--bare", str(repo)],
                            capture_output=True, text=True, check=False)
    _check(result, "init")


def commit(repo: Path, work_tree: Path, message: str) -> str:
    """Stage the whole work tree and commit. Returns the short sha."""
    _check(_git(repo, work_tree, "add", "-A", "."), "add")
    _check(_git(repo, work_tree, "commit", "--quiet", "--allow-empty", "-m", message), "commit")
    head = _git(repo, work_tree, "rev-parse", "--short", "HEAD")
    _check(head, "rev-parse")
    return head.stdout.strip()


def head_sha(repo: Path, work_tree: Path) -> str | None:
    result = _git(repo, work_tree, "rev-parse", "--short", "HEAD")
    return result.stdout.strip() if result.returncode == 0 else None


def head_subject(repo: Path, work_tree: Path) -> str | None:
    """The subject line of HEAD: `turn <n>: ...` after a narrate, `campaign <id>: created`
    before any. The continuation checkpoint reads the turn number from it (§12.2)."""
    result = _git(repo, work_tree, "log", "-1", "--format=%s")
    return result.stdout.strip() if result.returncode == 0 else None


def head_turn(repo: Path, work_tree: Path) -> int | None:
    subject = head_subject(repo, work_tree)
    if not subject or not subject.startswith("turn "):
        return None
    number = subject[len("turn "):].split(":", 1)[0].strip()
    return int(number) if number.isdigit() else None
