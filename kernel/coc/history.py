"""Sidecar bare repo per campaign (ADR-0001): .coc/repos/<id>.git with the
campaign directory as its work tree. One commit per campaign.create and per
successful narrate.

Contract §15 adds branches: a worldline is the branch `wl/<name>` and the campaign
directory is whichever one HEAD points at, so switching lines is a checkout and that
line's world, turns, memory and logs come back with it. Nothing here decides anything
about worldlines; it is the git verb list worldline.py drives."""

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


# ---- branches: one per worldline (contract §15.1) ------------------------------------------

#: Every worldline branch is namespaced, so a campaign's lines can never collide with a
#: branch name git or a human made.
BRANCH_PREFIX = "wl/"


def branch_ref(line: str) -> str:
    return f"refs/heads/{BRANCH_PREFIX}{line}"


def current_line(repo: Path, work_tree: Path) -> str | None:
    """The worldline HEAD is on, or None when HEAD is detached or on a branch outside the
    `wl/` namespace (a campaign made before worldlines existed)."""
    result = _git(repo, work_tree, "symbolic-ref", "--quiet", "HEAD")
    ref = result.stdout.strip() if result.returncode == 0 else ""
    prefix = f"refs/heads/{BRANCH_PREFIX}"
    return ref[len(prefix):] if ref.startswith(prefix) else None


def point_head_at(repo: Path, work_tree: Path, line: str) -> None:
    """Move HEAD's symbolic ref without touching the work tree or any commit -- how an
    unbranched campaign is adopted as `wl/main` (§15.1)."""
    _check(_git(repo, work_tree, "symbolic-ref", "HEAD", branch_ref(line)), "symbolic-ref")


def line_commit(repo: Path, work_tree: Path, line: str) -> str | None:
    """The short sha a worldline branch points at, or None when there is no such branch."""
    result = _git(repo, work_tree, "rev-parse", "--short", "--verify", f"{branch_ref(line)}^{{commit}}")
    return result.stdout.strip() if result.returncode == 0 else None


def lines(repo: Path, work_tree: Path) -> list[str]:
    result = _git(repo, work_tree, "for-each-ref", "--format=%(refname)", "refs/heads/")
    if result.returncode != 0:
        return []
    prefix = f"refs/heads/{BRANCH_PREFIX}"
    return sorted(ref[len(prefix):] for ref in result.stdout.split() if ref.startswith(prefix))


def create_branch(repo: Path, work_tree: Path, line: str, commit: str) -> None:
    _check(_git(repo, work_tree, "branch", f"{BRANCH_PREFIX}{line}", commit), "branch")


def delete_branch(repo: Path, work_tree: Path, line: str) -> None:
    """Only ever used to undo a branch this process just created and could not finish
    (§15.3 rollback); a worldline that ever held a turn is never deleted."""
    _git(repo, work_tree, "branch", "-D", f"{BRANCH_PREFIX}{line}")


def checkout(repo: Path, work_tree: Path, line: str, *, force: bool = False) -> None:
    """Make the work tree that line's. Fails closed on a dirty tree unless `force`: the
    caller commits first, so nothing a turn wrote is ever lost to a checkout."""
    args = ["checkout", "--quiet"] + (["--force"] if force else []) + [f"{BRANCH_PREFIX}{line}"]
    _check(_git(repo, work_tree, *args), "checkout")


def root_commit(repo: Path, work_tree: Path) -> str | None:
    """The campaign.create commit of the line HEAD is on -- the state a loop rewinds to
    when the anchor is the opening scene (§15.2)."""
    result = _git(repo, work_tree, "rev-list", "--max-parents=0", "--abbrev-commit", "HEAD")
    shas = result.stdout.split()
    return shas[-1] if result.returncode == 0 and shas else None


def is_dirty(repo: Path, work_tree: Path) -> bool:
    result = _git(repo, work_tree, "status", "--porcelain")
    _check(result, "status")
    return bool(result.stdout.strip())


def commit_if_dirty(repo: Path, work_tree: Path, message: str) -> str | None:
    """Commit whatever the work tree holds, or None when it holds nothing new. A turn
    leaves residue behind its own commit (the record learning its sha); a line must be
    clean before it is left, or the checkout would refuse."""
    if not is_dirty(repo, work_tree):
        return None
    return commit(repo, work_tree, message)


def read_blob(repo: Path, work_tree: Path, rev: str, path: str) -> str | None:
    """A file as some commit had it. The anchor snapshot of a time loop is read this way:
    the turn record keeps only a summary, the commit keeps the whole world (§15.2)."""
    result = _git(repo, work_tree, "show", f"{rev}:{path}")
    return result.stdout if result.returncode == 0 else None


def list_tree(repo: Path, work_tree: Path, rev: str, prefix: str) -> list[str]:
    result = _git(repo, work_tree, "ls-tree", "--name-only", rev, prefix)
    return sorted(result.stdout.split()) if result.returncode == 0 else []


def restore_tree(repo: Path, work_tree: Path, rev: str, prefix: str, *,
                 keep: tuple[str, ...] = ()) -> dict[str, list[str]]:
    """Put everything under `prefix` back exactly as `rev` had it.

    Writes what that commit carries and deletes what it does not — the deletion half matters,
    because a commit made before a file existed is a commit that says the file should not
    exist. `keep` names paths (relative to the work tree) left untouched on both sides.

    The whole tree is committed on every turn (`commit` stages `-A`), so the commit is the
    only place the whole campaign survives, this time read as a whole rather than file by
    file: a caller that had to name each state file it wanted back would be keeping a
    registry, and the file it forgot to register is exactly the one that silently survives a
    rewind it should not have."""
    kept = tuple(keep)
    def is_kept(path: str) -> bool:
        return any(path == k or path.startswith(k.rstrip("/") + "/") for k in kept)

    result = _git(repo, work_tree, "ls-tree", "-r", "--name-only", rev, "--", prefix)
    wanted = sorted(p for p in result.stdout.split() if p and not is_kept(p)) if result.returncode == 0 else []
    written, removed = [], []
    for path in wanted:
        blob = read_blob(repo, work_tree, rev, path)
        if blob is None:
            continue
        target = work_tree / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(blob, encoding="utf-8")
        written.append(path)
    root = work_tree / prefix
    if root.is_dir():
        for existing in sorted(root.rglob("*")):
            if not existing.is_file():
                continue
            path = str(existing.relative_to(work_tree))
            if path in wanted or is_kept(path):
                continue
            existing.unlink()
            removed.append(path)
    return {"written": written, "removed": removed}


def line_blob(repo: Path, work_tree: Path, line: str, path: str) -> str | None:
    """A file as another worldline has it (§15.4/§15.5 read every line this way, without
    ever checking one out)."""
    return read_blob(repo, work_tree, f"{BRANCH_PREFIX}{line}", path)


def line_tree(repo: Path, work_tree: Path, line: str, prefix: str) -> list[str]:
    return list_tree(repo, work_tree, f"{BRANCH_PREFIX}{line}", prefix)


def merge_parents(repo: Path, work_tree: Path, lines: list[str]) -> bool:
    """§15.4: record other worldlines as parents of the next commit without taking a byte
    of their trees (`-s ours`). What the merged campaign holds is computed by the kernel
    from the confluence report, never by git's merge; git is asked only to keep both
    histories reachable from the line the party plays on. Returns whether a merge was
    actually staged (nothing to record when the other line is already an ancestor)."""
    if not lines:
        return False
    revs = [f"{BRANCH_PREFIX}{line}" for line in lines]
    _check(_git(repo, work_tree, "merge", "-s", "ours", "--no-commit", "--no-ff", *revs), "merge")
    return (repo / "MERGE_HEAD").exists()


def abort_merge(repo: Path, work_tree: Path) -> None:
    """Undo a staged merge. Best effort: it runs on the rollback path, where the caller is
    already raising and a second failure must not hide the first."""
    _git(repo, work_tree, "merge", "--abort")
