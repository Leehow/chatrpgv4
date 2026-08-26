#!/usr/bin/env python3
"""Read-only Git scanner for the authority history projection.

Walks the Commit Coordinator's sidecar bare repo at
``<root>/.coc/repos/campaigns/<id>.git`` and emits deterministic commit
records for the state/event extractors. Stdlib only; no SQLite here.

Read-only contract: this module never mutates the worktree, refs, index, or
object database. It runs only ``rev-list``, ``log``, ``ls-tree``,
``cat-file``, ``rev-parse``, and ``interpret-trailers`` against the bare
sidecar repo and never repairs, resets, or writes anything.

Model-facing identifier law: commit SHAs in the returned records and in
``commit_sha`` arguments are machine-internal integrity handles, never
model-facing semantic ids. Model-facing callers select commits semantically
via ``timeline_id`` / ``turn_number`` (``resolve_commit``); raw SHA relay is
a machine bookkeeping escape hatch only.
"""
from __future__ import annotations

import hashlib
import os
import re
import shutil
import subprocess
from pathlib import Path

# Same constraint as coc_state._SAFE_ID / coc_git_history._SAFE_ID.
# Duplicated so this scanner stays importable without loading the writer
# or campaign-state machinery.
_SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
# Same ref-unsafe spelling constraints as coc_git_history._GIT_REF_UNSAFE,
# duplicated for the same import-isolation reason.
_GIT_REF_UNSAFE = re.compile(r"[~^:?*\[\\ @]|\.\.|@\{|^\.|/\.|//|\.lock$|/")

DEFAULT_TIMELINE_ID = "tl-main"
DEFAULT_COMMIT_TYPE = "unknown"

TRAILER_COMMIT_TYPE = "COC-Commit-Type"
TRAILER_CAMPAIGN_ID = "Campaign-Id"
TRAILER_TIMELINE_ID = "Timeline-Id"
TRAILER_TURN_NUMBER = "Turn-Number"
TRAILER_FINALIZATION_ID = "Finalization-Id"

# The full projection ignore face (shared context
# ``History projection component interfaces``). These tracked paths are
# runtime bookkeeping, never projected history. Deliberately not imported
# from coc_git_history: that list is the writer's staging face and is being
# extended separately; the projection face is stable on its own.
IGNORE_PATHS: tuple[str, ...] = (
    "logs/pending-turns/",
    "save/session-state.json",
    "save/toolbox-ledger.json",
    "save/commit-snapshots/",
    "save/development-settlements/",
    "save/roll-operation-receipts.json",
    "save/run-identity.lock",
    "save/timeline-state.json",
    "memory/index.json",
    "memory/history-projection.db",
)

# The read face: only these tracked paths are listed and read. Everything
# else in the tree is invisible to the projection.
ALLOWED_ROOT_FILES: frozenset[str] = frozenset({"campaign.json", "party.json"})
# (prefix, allowed suffixes) pairs; a path qualifies when it starts with the
# prefix, ends with one of the suffixes, and has a non-empty name between.
ALLOWED_PREFIX_SUFFIXES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("save/", (".json",)),
    ("logs/", (".jsonl",)),
    ("scenario/", (".json",)),
    ("memory/temporal/", (".json", ".jsonl")),
)


class GitScanError(Exception):
    """A read-only campaign history scan operation failed."""


class GitScanUnavailableError(GitScanError):
    """The git binary is missing or cannot be executed."""

    def __init__(self, message: str | None = None) -> None:
        super().__init__(
            message
            or "git is required for campaign history scans but was not found on PATH"
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


def _is_valid_timeline_id(value: str) -> bool:
    """True when ``value`` is a semantic ``tl-*`` timeline id.

    Mirrors the writer's acceptance rule (``coc_git_history.
    _require_timeline_id``): safe-id charset, ``tl-`` prefix, and no
    ref-unsafe spelling — so every writer-legal timeline scans cleanly
    while spoofed or malformed ids fail closed.
    """
    if not value.startswith("tl-"):
        return False
    if _SAFE_ID.fullmatch(value) is None:
        return False
    return _GIT_REF_UNSAFE.search(value) is None


def _require_under(parent: Path, child: Path, *, label: str) -> Path:
    try:
        resolved = child.resolve(strict=False)
        resolved.relative_to(parent.resolve(strict=False))
    except (OSError, ValueError) as exc:
        raise ValueError(f"{label} path is unsafe") from exc
    if child.is_symlink():
        raise ValueError(f"{label} path is unsafe")
    return resolved


def repo_path_for(root: Path | str, campaign_id: str) -> Path:
    """Absolute path of the campaign's sidecar bare repo, after safety checks."""
    campaign_id = _require_campaign_id(campaign_id)
    repos = _coc_root(root) / "repos" / "campaigns"
    repo = repos / f"{campaign_id}.git"
    return _require_under(repos, repo, label="campaign repo")


def looks_like_git_repo(repo: Path) -> bool:
    """True when ``repo`` has the files of a git object database."""
    return repo.is_dir() and (repo / "HEAD").is_file() and (repo / "objects").is_dir()


def path_is_ignored(relpath: str) -> bool:
    """True when ``relpath`` is exactly on the projection ignore face.

    The name is compared exactly as tracked. It is never normalized,
    stripped, or rewritten: ``.save/session-state.json`` is a different name
    from ``save/session-state.json`` and is not ignored — it is simply not
    in the read face.
    """
    if not relpath:
        return False
    for pattern in IGNORE_PATHS:
        if pattern.endswith("/"):
            if relpath == pattern[:-1] or relpath.startswith(pattern):
                return True
        elif relpath == pattern:
            return True
    return False


def path_is_allowed(relpath: str) -> bool:
    """True when ``relpath`` is exactly inside the projection read face.

    Tracked names are validated byte-exact, never normalized or rewritten.
    Disguised spellings that a normalizing check would repair — leading
    ``.``/``./`` (``.save/x.json``), backslash separators, absolute or
    traversal-like names (``/save/x.json``, ``save/../x.json``, empty
    components) — are rejected, not admitted through transformation.
    Allow face and ignore face are independent filters: a path must be an
    allowed kind of file and must not be ignored.
    """
    if not isinstance(relpath, str) or not relpath:
        return False
    if relpath.startswith("/") or "\\" in relpath or "\x00" in relpath:
        return False
    if any(component in ("", ".", "..") for component in relpath.split("/")):
        return False
    if path_is_ignored(relpath):
        return False
    if relpath in ALLOWED_ROOT_FILES:
        return True
    for prefix, suffixes in ALLOWED_PREFIX_SUFFIXES:
        if not relpath.startswith(prefix):
            continue
        name = relpath[len(prefix) :]
        if name and any(name.endswith(suffix) for suffix in suffixes):
            return True
    return False


def _read_only_git_env() -> dict[str, str]:
    env = os.environ.copy()
    env["GIT_CONFIG_NOSYSTEM"] = "1"
    env["GIT_CONFIG_GLOBAL"] = os.devnull
    env["GIT_CONFIG_SYSTEM"] = os.devnull
    env["GIT_TERMINAL_PROMPT"] = "0"
    # Strip any inherited discovery state so the scanner cannot be aimed at
    # an unrelated repository or index.
    for key in (
        "GIT_DIR",
        "GIT_WORK_TREE",
        "GIT_INDEX_FILE",
        "GIT_OBJECT_DIRECTORY",
        "GIT_ALTERNATE_OBJECT_DIRECTORIES",
        "GIT_CEILING_DIRECTORIES",
    ):
        env.pop(key, None)
    return env


def _git_executable() -> str:
    git = shutil.which("git")
    if not git:
        raise GitScanUnavailableError()
    return git


def _run_git(
    args: list[str],
    *,
    repo: Path | None = None,
    input_text: str | None = None,
    check: bool = True,
) -> str:
    """Run one read-only git subprocess; return stdout as text."""
    return _run_git_bytes(
        args, repo=repo, input_text=input_text, check=check
    ).decode("utf-8", "replace")


def _run_git_bytes(
    args: list[str],
    *,
    repo: Path | None = None,
    input_text: str | None = None,
    check: bool = True,
) -> bytes:
    """Run one read-only git subprocess; return stdout as raw bytes.

    Callers that must not corrupt canonical Git bytes (tracked path names)
    use this and decode strictly themselves.
    """
    cmd = [_git_executable(), "-c", "safe.directory=*"]
    if repo is not None:
        cmd.append(f"--git-dir={repo}")
    cmd.extend(args)
    try:
        completed = subprocess.run(
            cmd,
            input=None if input_text is None else input_text.encode("utf-8"),
            env=_read_only_git_env(),
            capture_output=True,
            check=False,
        )
    except FileNotFoundError as exc:
        raise GitScanUnavailableError() from exc
    if completed.returncode != 0 and check:
        stderr = (completed.stderr or b"").decode("utf-8", "replace").strip()
        raise GitScanError(f"git {' '.join(args)} failed: {stderr}")
    return completed.stdout


def parse_trailers(message: str) -> dict[str, str]:
    """Parse git trailers via ``git interpret-trailers --parse``."""
    completed_stdout = _run_git(
        ["interpret-trailers", "--parse"], input_text=message
    )
    parsed: dict[str, str] = {}
    for line in completed_stdout.splitlines():
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


def _rev_list_commits(repo: Path) -> list[tuple[str, list[str]]]:
    """All commits oldest-first: ``rev-list --all --topo-order --reverse``."""
    stdout = _run_git(
        ["rev-list", "--all", "--topo-order", "--reverse", "--parents"],
        repo=repo,
    )
    commits: list[tuple[str, list[str]]] = []
    for line in stdout.splitlines():
        if not line:
            continue
        parts = line.split(" ")
        commits.append((parts[0], parts[1:]))
    return commits


def _commit_bodies(repo: Path) -> dict[str, str]:
    """Map commit sha -> full message body, walking all refs."""
    stdout = _run_git(
        ["log", "--all", "--format=%H%x1e%B%x1d"],
        repo=repo,
    )
    bodies: dict[str, str] = {}
    for chunk in stdout.split("\x1d"):
        piece = chunk.strip("\n")
        if not piece:
            continue
        sha, sep, body = piece.partition("\x1e")
        if not sep:
            continue
        bodies[sha.strip()] = body
    return bodies


def _list_commit_entries(repo: Path, sha: str) -> list[tuple[str, str]]:
    """Sorted ``[(path, blob_sha)]`` of the commit's allowed-face files.

    Path names come out of ``ls-tree`` as raw bytes and are decoded strictly.
    A tracked name that is not valid UTF-8 cannot be an exact member of the
    read face, so it is skipped — never transcoded or rewritten. The same
    applies to disguised names (``.save/...``, backslashes, traversal-like
    spellings): they fail the exact allow-face check unchanged.
    """
    stdout = _run_git_bytes(
        ["ls-tree", "-r", "-z", "--full-tree", sha],
        repo=repo,
    )
    entries: list[tuple[str, str]] = []
    for record in stdout.split(b"\0"):
        if not record:
            continue
        meta, sep, path_bytes = record.partition(b"\t")
        if not sep:
            continue
        parts = meta.split(b" ")
        if len(parts) != 3 or parts[1] != b"blob":
            continue
        try:
            relpath = path_bytes.decode("utf-8")
        except UnicodeDecodeError:
            continue
        if not path_is_allowed(relpath):
            continue
        entries.append((relpath, parts[2].decode("ascii")))
    return sorted(entries)


def _read_blob_texts(repo: Path, blob_shas: list[str]) -> dict[str, str]:
    """Read many blobs through one ``cat-file --batch`` subprocess."""
    if not blob_shas:
        return {}
    cmd = [_git_executable(), f"--git-dir={repo}", "cat-file", "--batch"]
    payload = "".join(f"{sha}\n" for sha in blob_shas).encode("ascii")
    try:
        completed = subprocess.run(
            cmd,
            input=payload,
            env=_read_only_git_env(),
            capture_output=True,
            check=False,
        )
    except FileNotFoundError as exc:
        raise GitScanUnavailableError() from exc
    if completed.returncode != 0:
        stderr = (completed.stderr or b"").decode("utf-8", "replace").strip()
        raise GitScanError(f"git cat-file --batch failed: {stderr}")
    output = completed.stdout
    texts: dict[str, str] = {}
    position = 0
    for sha in blob_shas:
        newline = output.find(b"\n", position)
        if newline < 0:
            raise GitScanError("truncated cat-file --batch output")
        header = output[position:newline].decode("ascii", "replace").strip()
        position = newline + 1
        parts = header.split(" ")
        if len(parts) < 2 or parts[1] == "missing":
            raise GitScanError(f"blob object missing: {sha}")
        object_type = parts[1]
        try:
            size = int(parts[-1])
        except ValueError as exc:
            raise GitScanError(f"malformed cat-file header for {sha}") from exc
        if object_type != "blob":
            raise GitScanError(f"object {sha} is {object_type}, not a blob")
        raw = output[position : position + size]
        if len(raw) != size:
            raise GitScanError(f"truncated cat-file content for {sha}")
        position += size
        if output[position : position + 1] == b"\n":
            position += 1
        try:
            texts[sha] = raw.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise GitScanError(
                f"blob {sha} is not valid UTF-8; refusing to decode "
                "canonical Git bytes with replacement"
            ) from exc
    return texts


def _tree_digest(entries: list[tuple[str, str]]) -> str:
    """Deterministic digest of the commit's allowed-face tree.

    Two commits whose allowed files are byte-identical share a digest even
    when their full trees differ on ignored paths.
    """
    digest = hashlib.sha256()
    for path, blob_sha in entries:
        digest.update(path.encode("utf-8"))
        digest.update(b"\x1f")
        digest.update(blob_sha.encode("ascii"))
        digest.update(b"\x00")
    return digest.hexdigest()


def scan_campaign_history(root: Path | str, campaign_id: str) -> list[dict]:
    """Scan one campaign's full history into deterministic commit records.

    Commits arrive in ``git rev-list --all --topo-order --reverse`` order
    (parents before children, oldest first); files within each commit are
    sorted by path. Only allowed-face tracked files are listed and read;
    ignored paths are skipped entirely. Tracked names are matched exactly —
    never normalized — so disguised spellings (``.save/...``, backslashes,
    absolute or traversal-like names) and non-UTF-8 names are skipped
    without transformation. No wall-clock fields are recorded.

    Fails closed with ``GitScanError`` when commit provenance cannot be
    trusted: a non-empty ``Campaign-Id`` trailer that differs from the
    requested campaign, a malformed ``Timeline-Id`` trailer, or an
    allowed-face blob whose canonical bytes are not valid UTF-8.

    Returns ``[]`` when the sidecar repo does not exist or has no commits.

    Record shape (shared with the extractors):

    ``{"sha", "campaign_id", "timeline_id", "turn_number",
    "finalization_id", "commit_type", "parents", "tree_digest", "files"}``

    where ``files`` items are ``{"path", "blob_sha", "text"}``.
    """
    campaign_id = _require_campaign_id(campaign_id)
    repo = repo_path_for(root, campaign_id)
    if not looks_like_git_repo(repo):
        return []
    headers = _rev_list_commits(repo)
    if not headers:
        return []
    bodies = _commit_bodies(repo)
    entries_by_sha: dict[str, list[tuple[str, str]]] = {}
    blob_shas: set[str] = set()
    for sha, _parents in headers:
        entries = _list_commit_entries(repo, sha)
        entries_by_sha[sha] = entries
        blob_shas.update(blob for _path, blob in entries)
    blob_texts = _read_blob_texts(repo, sorted(blob_shas))
    records: list[dict] = []
    for sha, parents in headers:
        trailers = parse_trailers(bodies.get(sha, ""))
        declared_campaign = trailers.get(TRAILER_CAMPAIGN_ID)
        if declared_campaign and declared_campaign != campaign_id:
            raise GitScanError(
                f"commit {sha} declares Campaign-Id {declared_campaign!r} "
                f"but campaign {campaign_id!r} was requested; refusing to "
                "project foreign provenance"
            )
        declared_timeline = trailers.get(TRAILER_TIMELINE_ID)
        if declared_timeline:
            if not _is_valid_timeline_id(declared_timeline):
                raise GitScanError(
                    f"commit {sha} declares invalid Timeline-Id "
                    f"{declared_timeline!r}; refusing to project malformed "
                    "timeline provenance"
                )
            timeline_id = declared_timeline
        else:
            timeline_id = DEFAULT_TIMELINE_ID
        turn_raw = trailers.get(TRAILER_TURN_NUMBER)
        try:
            turn_number = int(turn_raw) if turn_raw else None
        except ValueError:
            turn_number = None
        entries = entries_by_sha[sha]
        records.append(
            {
                "sha": sha,
                "campaign_id": declared_campaign or campaign_id,
                "timeline_id": timeline_id,
                "turn_number": turn_number,
                "finalization_id": (
                    trailers.get(TRAILER_FINALIZATION_ID) or None
                ),
                "commit_type": (
                    trailers.get(TRAILER_COMMIT_TYPE) or DEFAULT_COMMIT_TYPE
                ),
                "parents": list(parents),
                "tree_digest": _tree_digest(entries),
                "files": [
                    {
                        "path": path,
                        "blob_sha": blob,
                        "text": blob_texts[blob],
                    }
                    for path, blob in entries
                ],
            }
        )
    return records


def resolve_commit(
    commits: list[dict],
    *,
    timeline_id: str | None = None,
    turn_number: int | None = None,
    commit_sha: str | None = None,
) -> dict | None:
    """Resolve one commit record from scanned ``commits`` by selectors.

    All provided selectors are AND-ed; the latest matching commit in scan
    order wins. With no selectors the latest commit overall is returned.
    ``commit_sha`` accepts a full sha or a unique prefix and is a
    machine-internal handle — model-facing callers must prefer the semantic
    ``timeline_id`` / ``turn_number`` selectors. Returns ``None`` when
    nothing matches; raises ``GitScanError`` on an ambiguous prefix.
    """
    if commit_sha is not None and (not isinstance(commit_sha, str) or not commit_sha.strip()):
        raise ValueError("commit_sha must be a non-empty string when provided")
    if timeline_id is not None and (not isinstance(timeline_id, str) or not timeline_id.strip()):
        raise ValueError("timeline_id must be a non-empty string when provided")
    if turn_number is not None and (
        not isinstance(turn_number, int) or isinstance(turn_number, bool)
    ):
        raise ValueError("turn_number must be an int when provided")
    candidates = commits
    if commit_sha is not None:
        needle = commit_sha.strip()
        exact = [c for c in candidates if c.get("sha") == needle]
        if exact:
            candidates = exact
        else:
            prefixed = [c for c in candidates if str(c.get("sha", "")).startswith(needle)]
            if len(prefixed) > 1:
                raise GitScanError(
                    f"commit_sha prefix matched {len(prefixed)} commits"
                )
            if not prefixed:
                return None
            candidates = prefixed
    if timeline_id is not None:
        candidates = [c for c in candidates if c.get("timeline_id") == timeline_id]
    if turn_number is not None:
        candidates = [c for c in candidates if c.get("turn_number") == turn_number]
    if not candidates:
        return None
    return candidates[-1]


def _canonical_commit_sha(repo: Path, value: str) -> str:
    """Canonicalize a full sha or unique prefix to a full commit sha."""
    needle = value.strip()
    stdout = _run_git(
        ["rev-parse", "--verify", "--quiet", f"{needle}^{{commit}}"],
        repo=repo,
        check=False,
    )
    sha = stdout.strip()
    if not sha:
        raise GitScanError(f"unknown commit: {needle}")
    return sha


def diff_commits(
    root: Path | str,
    campaign_id: str,
    from_sha: str | None,
    to_sha: str | None,
) -> list[dict]:
    """Structured path-level diff between two commits' allowed-face files.

    ``from_sha`` / ``to_sha`` are machine-internal full shas or unique
    prefixes (``None`` means the empty tree, i.e. campaign start). Returns
    changes sorted by path as
    ``{"path", "change", "from_blob_sha", "to_blob_sha"}`` with
    ``change`` in ``added`` / ``removed`` / ``modified``. Paths outside the
    read face and ignored paths never appear, even when they differ.
    """
    campaign_id = _require_campaign_id(campaign_id)
    repo = repo_path_for(root, campaign_id)
    if not looks_like_git_repo(repo):
        raise GitScanError("campaign history repo not found")
    canonical_from = (
        None if from_sha is None else _canonical_commit_sha(repo, from_sha)
    )
    canonical_to = None if to_sha is None else _canonical_commit_sha(repo, to_sha)
    if canonical_from is not None and canonical_from == canonical_to:
        return []
    from_entries = (
        {} if canonical_from is None else dict(_list_commit_entries(repo, canonical_from))
    )
    to_entries = (
        {} if canonical_to is None else dict(_list_commit_entries(repo, canonical_to))
    )
    changes: list[dict] = []
    for path in sorted(set(from_entries) | set(to_entries)):
        before = from_entries.get(path)
        after = to_entries.get(path)
        if before == after:
            continue
        if before is None:
            change = "added"
        elif after is None:
            change = "removed"
        else:
            change = "modified"
        changes.append(
            {
                "path": path,
                "change": change,
                "from_blob_sha": before,
                "to_blob_sha": after,
            }
        )
    return changes
