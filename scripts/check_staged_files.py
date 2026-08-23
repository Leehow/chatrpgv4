#!/usr/bin/env python3
"""Report suspicious proposed files from the index or a committed range."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from fnmatch import fnmatchcase
from pathlib import Path, PurePosixPath
import subprocess
import sys


DEFAULT_MAX_BYTES = 25 * 1024 * 1024
GUARDED_ROOT_PATTERNS = (
    "/artifacts/",
    "/.tmp/",
    "/.playwright-cli/",
    "/driver.pid",
    "/gui-test-screenshots/*.png",
)
GUARDED_BUILD_PREFIXES = ("desktop/build/", "desktop/dist/")


@dataclass(frozen=True)
class ProposedEntry:
    path: str
    oid: str
    size: int


def _git(repo: Path, *args: str) -> bytes:
    return subprocess.check_output(("git", *args), cwd=repo)


def staged_entries(repo: Path) -> list[ProposedEntry]:
    changed = {
        item.decode("utf-8", errors="surrogateescape")
        for item in _git(
            repo,
            "diff",
            "--cached",
            "--name-only",
            "-z",
            "--diff-filter=ACMR",
        ).split(b"\0")
        if item
    }
    if not changed:
        return []
    index: dict[str, str] = {}
    for record in _git(repo, "ls-files", "--stage", "-z").split(b"\0"):
        if not record:
            continue
        metadata, raw_path = record.split(b"\t", 1)
        _mode, raw_oid, raw_stage = metadata.split(b" ", 2)
        if raw_stage != b"0":
            continue
        file_path = raw_path.decode("utf-8", errors="surrogateescape")
        if file_path in changed:
            index[file_path] = raw_oid.decode("ascii")

    entries = []
    for file_path in sorted(changed):
        oid = index.get(file_path)
        if oid is None:
            continue
        size = int(_git(repo, "cat-file", "-s", oid).strip())
        entries.append(ProposedEntry(path=file_path, oid=oid, size=size))
    return entries


def committed_entries(repo: Path, *, base: str, head: str) -> list[ProposedEntry]:
    changed = {
        item.decode("utf-8", errors="surrogateescape")
        for item in _git(
            repo,
            "diff",
            base,
            head,
            "--name-only",
            "-z",
            "--diff-filter=ACMR",
        ).split(b"\0")
        if item
    }
    if not changed:
        return []

    tree: dict[str, str] = {}
    for record in _git(repo, "ls-tree", "-r", "-z", head).split(b"\0"):
        if not record:
            continue
        metadata, raw_path = record.split(b"\t", 1)
        _mode, object_type, raw_oid = metadata.split(b" ", 2)
        file_path = raw_path.decode("utf-8", errors="surrogateescape")
        if object_type == b"blob" and file_path in changed:
            tree[file_path] = raw_oid.decode("ascii")

    entries = []
    for file_path in sorted(changed):
        oid = tree.get(file_path)
        if oid is None:
            continue
        size = int(_git(repo, "cat-file", "-s", oid).strip())
        entries.append(ProposedEntry(path=file_path, oid=oid, size=size))
    return entries


def is_guarded_project_path(file_path: str) -> bool:
    candidate = PurePosixPath(file_path)
    for pattern in GUARDED_ROOT_PATTERNS:
        project_pattern = pattern.removeprefix("/")
        if project_pattern.endswith("/"):
            if file_path.startswith(project_pattern):
                return True
            continue
        pattern_path = PurePosixPath(project_pattern)
        if "*" in pattern_path.name:
            if candidate.parent == pattern_path.parent and fnmatchcase(
                candidate.name, pattern_path.name
            ):
                return True
            continue
        if candidate == pattern_path:
            return True
    return False


def suspicious_reasons(
    entry: ProposedEntry,
    *,
    max_bytes: int,
    guarded_project_path: bool,
) -> list[str]:
    reasons = []
    if guarded_project_path:
        reasons.append("path is protected by committed repository policy")

    parts = PurePosixPath(entry.path).parts
    if entry.path.startswith(GUARDED_BUILD_PREFIXES) or any(
        part.endswith(".app") for part in parts
    ):
        reasons.append("generated App or desktop build payload")

    if entry.size > max_bytes:
        reasons.append(f"blob exceeds {max_bytes} bytes")
    return reasons


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path.cwd())
    parser.add_argument("--max-bytes", type=int, default=DEFAULT_MAX_BYTES)
    parser.add_argument(
        "--base",
        help="inspect files changed from this committed revision instead of the index",
    )
    parser.add_argument("--head", help="range head used with --base (default: HEAD)")
    args = parser.parse_args(argv)
    if args.head and not args.base:
        parser.error("--head requires --base")
    if args.base and not args.head:
        args.head = "HEAD"
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    repo = args.repo.resolve()
    entries = (
        committed_entries(repo, base=args.base, head=args.head)
        if args.base
        else staged_entries(repo)
    )
    findings = []
    for entry in entries:
        for reason in suspicious_reasons(
            entry,
            max_bytes=args.max_bytes,
            guarded_project_path=is_guarded_project_path(entry.path),
        ):
            findings.append((entry, reason))
    label = "committed-range" if args.base else "staged-file"
    if not findings:
        print(f"{label} guard: no suspicious proposed files")
        return 0

    print(f"{label} guard: suspicious proposed files", file=sys.stderr)
    for entry, reason in findings:
        print(f"{entry.path}\t{entry.size} bytes\t{reason}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
