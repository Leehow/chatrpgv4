"""The generated projections, and the constants that must not duplicate them.

Three lines develop in parallel — rules, director, text — and the operation
surface is the seam they all touch. Two failure shapes come out of that seam,
and both cost real time on 2026-09-01:

* `mcp-operation-contracts.json` and `operation-policy.generated.ts` are
  generated, committed, and rebuilt by every line, so a concurrent addition
  conflicts on `operation_count` and `content_sha256` every time. The
  resolution is always the same and never a judgement call: take either side,
  then regenerate. This test is what makes forgetting the second half
  impossible, and it lives with the generator rather than inside one layer's
  test file — the byte-identity guard that existed was inside
  `test_text_graph.py`, so retiring that slice would have taken the guard for a
  repository-wide artifact with it.

* The operation count was hardcoded in three separate test files. One
  deliberate addition (`state.characteristic_delta`) broke them one at a time,
  in three different suites, hours apart, each looking like a fresh failure.
  A count is derivable; writing it down again is a copy that another line's
  correct work will break.
"""
from __future__ import annotations

import ast
import importlib.util
import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
GENERATOR = SCRIPTS / "coc_mcp_contract_archive.py"
ARCHIVE = ROOT / "plugins" / "coc-keeper" / "references" / "mcp-operation-contracts.json"
POLICY_TS = ROOT / "plugins" / "coc-keeper" / "pi" / "lib" / "operation-policy.generated.ts"

REGENERATE = (
    "uv run --frozen python "
    "plugins/coc-keeper/scripts/coc_mcp_contract_archive.py build"
)


def test_both_generated_projections_are_current():
    """The whole correctness mechanism for a merge that touched the surface.

    A stale or hand-resolved projection fails here rather than at a table, and
    the message carries the one command that fixes it.
    """
    result = subprocess.run(
        [sys.executable, str(GENERATOR), "check"],
        capture_output=True, text=True, cwd=ROOT,
    )
    assert result.returncode == 0, (
        "the generated projections drift from the canonical operation registry.\n"
        f"Regenerate them: {REGENERATE}\n"
        "After a merge conflict in either file, take either side and regenerate; "
        "both are derived, so neither side is more correct.\n"
        f"{result.stdout}{result.stderr}"
    )


def test_the_generator_covers_both_files_this_test_names():
    """If a third projection is added, this guard must learn about it."""
    spec = importlib.util.spec_from_file_location("coc_mcp_contract_archive_gen", GENERATOR)
    module = importlib.util.module_from_spec(spec)
    sys.modules["coc_mcp_contract_archive_gen"] = module
    assert spec.loader is not None
    spec.loader.exec_module(module)
    assert module.DEFAULT_ARCHIVE_PATH.resolve() == ARCHIVE.resolve()
    assert module.DEFAULT_POLICY_PATH.resolve() == POLICY_TS.resolve()


def test_the_archive_is_self_consistent():
    archive = json.loads(ARCHIVE.read_text(encoding="utf-8"))
    assert archive["operation_count"] == len(archive["operations"])


def test_no_test_hardcodes_the_operation_count():
    """The count is derivable; a second copy is a cross-layer tripwire.

    `state.characteristic_delta` broke three of these in three suites hours
    apart. Each looked like an unrelated regression, and each was one line's
    correct work tripping another line's frozen constant.

    Parsed rather than grepped: the first draft of this guard matched the
    sentence you are reading, which is exactly the kind of false positive that
    teaches people to delete a check.
    """
    offenders: list[str] = []
    for path in sorted((ROOT / "tests").rglob("*.py")):
        if path.resolve() == Path(__file__).resolve():
            continue
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"))
        except SyntaxError:
            continue
        for node in ast.walk(tree):
            if not isinstance(node, ast.Compare):
                continue
            operands = [node.left, *node.comparators]
            names = {
                part.value
                for operand in operands
                for part in ast.walk(operand)
                if isinstance(part, ast.Constant) and isinstance(part.value, str)
            }
            counts_the_surface = "operation_count" in names or any(
                isinstance(part, ast.Attribute) and part.attr == "operation_count"
                for operand in operands
                for part in ast.walk(operand)
            )
            if not counts_the_surface:
                continue
            frozen = [
                operand for operand in operands
                if isinstance(operand, ast.Constant)
                and isinstance(operand.value, int)
                and not isinstance(operand.value, bool)
            ]
            if frozen:
                offenders.append(
                    f"{path.relative_to(ROOT)}:{node.lineno}: compares the "
                    f"operation surface to {frozen[0].value}"
                )
    assert not offenders, (
        "these compare the operation surface to a frozen number, so any line "
        "that legitimately adds an operation turns them red in a suite its "
        "author was not editing. Assert what the test is actually about "
        "instead — self-consistency (`== len(archive['operations'])`) or the "
        "membership the test needs:\n  " + "\n  ".join(offenders)
    )
