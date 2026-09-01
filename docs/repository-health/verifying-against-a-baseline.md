# Verifying a change against a baseline

> **Status:** Standing practice. Tool: `scripts/verify_against_baseline.py`.
> **Date:** 2026-08-31

## Why a plain test run is not enough here

`pytest tests` on this repository reports a large number of pre-existing
failures (172 on `60c1c4b4` in a checkout without gitignored directories; 140
in a full local checkout). In that situation the suite cannot answer the only
question a change needs answered — *did I break anything* — because a red test
stays red either way.

The sharper problem is that **an already-failing test absorbs new violations
silently.** A contract test that collects offending files and asserts the list
is empty keeps failing whether the list has three entries or four. A newly
introduced violation is then invisible in pass/fail.

This is not hypothetical. During the DirectorGraph work
`scripts/gen_director_decision_baseline.py` was written with a usage
docstring that invoked the interpreter directly instead of through
`uv run --frozen`, violating the repository's single-interpreter contract.
(Quoting the offending form here would itself trip the check, which is a fair
illustration of how blunt these contract scans are.)
`tests/test_python_contract.py` was already red
from unrelated findings, so the violation produced no signal at all. It was
found by diffing the *contents* of that already-failing test between the
working tree and the baseline.

## The method

Compare two things, not one:

1. **Failure sets.** Which tests fail here but not on the baseline. That set is
   the regression list and is the only direction that matters.
2. **Failure contents.** For tests failing on *both* trees, the file paths named
   inside the failure output. A path that appears only in the working tree's
   failure is a new violation hiding behind an old one.

Two asymmetries to keep straight, because both look like good news and are not:

- **`baseline_only` failures are not fixes.** A baseline worktree has no
  gitignored directories — no `.coc/`, no `node_modules/`. Every test needing
  them fails there and passes here. On the DirectorGraph work that accounted
  for all 32 of the baseline's extra failures (18 in `test_pi_package` alone).
  Never report those as an improvement.
- **Nested worktrees are not your change.** `.claude/worktrees/` and
  `.pi/worktrees/` hold other agents' checkouts inside this repository. They
  exist in the working tree and not in a fresh baseline worktree, so a contract
  scan that walks them reports their files as newly introduced. The tool filters
  those paths out of the content diff; without the filter it flagged two files
  from an unrelated agent's branch as masked violations.
- **A file outside the tree gets two spellings.** pytest renders a traceback
  frame relative when `..` can reach it and absolute otherwise, so the same
  CPython stdlib file appears as `../../../Library/...` from a shallow tree and
  as `/Users/.../Library/...` from a deep one. That alone produced a
  `regressions` verdict on a run whose own counts were `regressions: 0`. Paths
  are now resolved against their owning tree and anything landing outside it is
  dropped — a stdlib or site-packages frame is not a file this change could
  have introduced a violation into.
- **Absolute paths are not comparable across the two trees.** Failure output
  mixes absolute and relative paths, and the baseline lives in a temporary
  worktree at a different root, so comparing raw strings makes every absolute
  path a difference. A run launched from a worktree reported ~50 spurious
  masked violations this way; all of them vanished once both roots were
  stripped. The tool now normalises to repo-relative before diffing. This was
  found by a worker using the tool, not by the tool's own tests — running it
  only from the main checkout hid it, because there the two roots coincide
  often enough to look fine.
- **A target the baseline does not have collapses the comparison.** Naming a
  test file the change adds makes the baseline run collect nothing, so every
  failure here reads as a regression. The tool splits those out as
  `failures_in_new_tests`; they need review on their own merits.

## Running it

```bash
PYTHONDONTWRITEBYTECODE=1 uv run --frozen python scripts/verify_against_baseline.py <baseline-ref> <test-target> ...
```

Name the test files the change could plausibly affect. With no target it runs
the whole suite on both trees, which took just over an hour per side on the
DirectorGraph work.

`verdict` is `clean` only when `regressions`, `masked_new_violations` and
`failures_in_new_tests` are all empty.

## When to use it

Any change to this repository that is verified by running tests. It is
cheapest when scoped to the affected files, and its value is highest exactly
where intuition says it is lowest: on contract, architecture, inventory and
audit tests that are *already failing*, because those are the ones that hide
new violations.
