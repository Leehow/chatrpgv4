#!/usr/bin/env python3
"""Compare a working tree's test failures against a baseline commit.

Why this exists
---------------
This repository carries a large set of pre-existing test failures. In that
situation a plain ``pytest`` run cannot answer the only question that matters
for a change — *did I break anything* — because a red test stays red either
way. Worse, **an already-failing test silently absorbs new violations**: a
contract test that enumerates offending files will keep failing whether it
names three files or four, so a newly introduced violation is invisible in
pass/fail.

That is not hypothetical. During the DirectorGraph work a new
single-interpreter-contract violation was introduced and went undetected by
the suite; it was caught only by diffing the *contents* of an
already-failing test between the two trees.

So this tool compares two things:

1. **failure sets** — which tests fail here but not on the baseline. That is
   the regression list, and it is the only direction that matters. Tests that
   fail on the baseline but pass here are reported separately and are usually
   environment differences, never evidence that the change "fixed" something.
2. **failure contents** — for tests that fail on BOTH trees, the file paths
   named inside the failure output. A path that appears only in the working
   tree's failure is a new violation hiding behind an old one.

A baseline worktree does not carry gitignored directories (``.coc``,
``node_modules``, ``.venv``). Tests that need them fail there and not here.
That asymmetry is expected, is reported as ``baseline_only``, and is never
counted as an improvement.

Usage
-----
    PYTHONDONTWRITEBYTECODE=1 uv run --frozen python \\
      scripts/verify_against_baseline.py <baseline-ref> [pytest-target ...]

With no target it runs the whole suite on both trees, which is slow. Prefer
naming the test files a change could plausibly affect.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
_PATH_IN_OUTPUT = re.compile(r"[A-Za-z0-9_./-]+\.(?:md|py|json|ts|mjs|sh)")

# Nested worktrees live inside the repository (.claude/worktrees, .pi/worktrees)
# and belong to other agents. They exist in the working tree and not in a fresh
# baseline worktree, so a contract scan that walks them reports their files as
# "new" — a false positive that has nothing to do with the change under test.
_FOREIGN_TREE_PARTS = (".claude/worktrees/", ".pi/worktrees/", "node_modules/")


def _is_foreign(path: str) -> bool:
    return any(part in path for part in _FOREIGN_TREE_PARTS)
_OUTCOME = re.compile(r"^(?:FAILED|ERROR) (\S+)")


def _run_pytest(cwd: Path, targets: list[str], *, verbose: bool) -> str:
    command = [
        sys.executable, "-m", "pytest", *(targets or ["tests"]),
        "-q", "-p", "no:cacheprovider", "--tb=long" if verbose else "--tb=no",
    ]
    if verbose:
        command.append("-vv")
    completed = subprocess.run(
        command, cwd=cwd, capture_output=True, text=True,
        env={"PYTHONDONTWRITEBYTECODE": "1", "PATH": __import__("os").environ["PATH"]},
    )
    return completed.stdout + completed.stderr


def _failures(output: str) -> set[str]:
    found = set()
    for line in output.splitlines():
        match = _OUTCOME.match(line)
        if match:
            found.add(match.group(1))
    return found


def _named_paths(output: str) -> set[str]:
    return {p for p in _PATH_IN_OUTPUT.findall(output) if not _is_foreign(p)}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("baseline_ref")
    parser.add_argument("targets", nargs="*")
    parser.add_argument(
        "--skip-content", action="store_true",
        help="skip the slower content diff (sets only)",
    )
    args = parser.parse_args(argv)

    with tempfile.TemporaryDirectory(prefix="verify-baseline-") as tmp:
        worktree = Path(tmp) / "baseline"
        subprocess.run(
            ["git", "worktree", "add", "--detach", str(worktree), args.baseline_ref],
            cwd=ROOT, check=True, capture_output=True,
        )
        try:
            # A target the baseline does not have (a test file this change
            # adds) collapses the baseline run to zero collected tests, which
            # would make every failure here look like a regression. Split
            # those out and say so instead.
            baseline_targets, new_targets = [], []
            for target in args.targets:
                head = target.split("::")[0]
                (baseline_targets if (worktree / head).exists()
                 else new_targets).append(target)
            if args.targets and not baseline_targets:
                print(json.dumps({
                    "verdict": "no-baseline-coverage",
                    "reason": "every named target is new in this tree",
                    "new_targets": new_targets,
                }, indent=2))
                return 0

            mine = _run_pytest(ROOT, args.targets, verbose=False)
            base = _run_pytest(worktree, baseline_targets, verbose=False)
            # Failures inside files that do not exist on the baseline cannot
            # be regressions; they are new tests and are reported separately.
            new_heads = {t.split("::")[0] for t in new_targets}
            mine_fail, base_fail = _failures(mine), _failures(base)
            new_test_failures = sorted(
                name for name in mine_fail
                if name.split("::")[0] in new_heads
            )
            mine_fail = {
                name for name in mine_fail
                if name.split("::")[0] not in new_heads
            }
            regressions = sorted(mine_fail - base_fail)
            baseline_only = sorted(base_fail - mine_fail)

            masked: list[str] = []
            if not args.skip_content and (mine_fail & base_fail):
                shared = sorted(mine_fail & base_fail)
                files = sorted({name.split("::")[0] for name in shared})
                mine_v = _run_pytest(ROOT, files, verbose=True)
                base_v = _run_pytest(worktree, files, verbose=True)
                masked = sorted(_named_paths(mine_v) - _named_paths(base_v))
        finally:
            subprocess.run(
                ["git", "worktree", "remove", str(worktree), "--force"],
                cwd=ROOT, check=False, capture_output=True,
            )

    verdict = (
        "clean" if not regressions and not masked and not new_test_failures
        else "regressions"
    )
    report = {
        "verdict": verdict,
        "baseline_ref": args.baseline_ref,
        "counts": {
            "failing_here": len(mine_fail),
            "failing_on_baseline": len(base_fail),
            "regressions": len(regressions),
            "masked_new_violations": len(masked),
            "baseline_only": len(baseline_only),
            "failures_in_new_tests": len(new_test_failures),
        },
        "failures_in_new_tests": new_test_failures,
        "regressions": regressions,
        "masked_new_violations": masked,
        "baseline_only_note": (
            "expected when the baseline worktree lacks gitignored directories "
            "(.coc, node_modules); never evidence the change fixed anything"
        ),
        "baseline_only": baseline_only[:40],
    }
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0 if verdict == "clean" else 1


if __name__ == "__main__":
    raise SystemExit(main())
