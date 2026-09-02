"""Drift test for docs/status/module-reachability-ledger.md.

Spec: docs/specs/pi-coc-module-reachability-lint.md §8 (slice L2)

The ledger is generated, so the only thing that keeps it honest is regenerating
it here and comparing byte-for-byte, exactly as `tests/test_text_graph.py` does
for the text-grounding ledger. The rest of this file guards the two ways this
pattern is usually implemented wrong: a wall-clock line that makes the
comparison fail once a day, and a generator that reaches into `.coc/` runtime
data that a fresh clone does not have.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
GENERATOR = REPO / "scripts" / "gen_module_reachability_ledger.py"
LEDGER = REPO / "docs" / "status" / "module-reachability-ledger.md"
LINT = REPO / "plugins" / "coc-keeper" / "scripts" / "coc_module_reachability.py"

REGENERATE = (
    "Re-run:  uv run --frozen python scripts/gen_module_reachability_ledger.py"
    " --write"
)


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def generator():
    if not LINT.is_file():
        pytest.fail(
            f"the lint module {LINT.relative_to(REPO)} is missing; the ledger "
            "cannot be generated or checked without it"
        )
    return _load("gen_module_reachability_ledger_test", GENERATOR)


def test_the_ledger_matches_a_fresh_generation(generator):
    """Regenerate and compare, so the published ledger cannot rot."""
    assert LEDGER.is_file(), f"{LEDGER.relative_to(REPO)} is missing. {REGENERATE}"
    on_disk = LEDGER.read_text("utf-8")
    fresh = generator.render(generator.build())
    assert fresh == on_disk, (
        f"{LEDGER.relative_to(REPO)} no longer matches what the generator "
        f"produces from the committed starter. {REGENERATE}\n"
        "If the difference is a real change in the starter or the lint, review "
        "it — do not quietly accept a new expectation."
    )


def test_generation_is_deterministic(generator):
    """Same inputs, byte-identical output, twice in the same process."""
    assert generator.render(generator.build()) == generator.render(generator.build())


def test_the_ledger_carries_no_wall_clock(generator):
    """A generated date would fail the drift test once a day."""
    source = GENERATOR.read_text("utf-8")
    for banned in ("import time", "import datetime", "from datetime",
                   "datetime.now", "time.time(", "date.today"):
        assert banned not in source, (
            f"{GENERATOR.name} must not read a clock: found {banned!r}"
        )


def test_the_ledger_covers_only_the_committed_starter(generator):
    """`.coc/` is gitignored runtime data; a ledger over it would not survive a
    fresh clone, and this drift test would be unrunnable for everyone else."""
    assert ".coc/campaigns" not in GENERATOR.read_text("utf-8")
    assert ".coc/campaigns" not in LEDGER.read_text("utf-8")
    assert generator.STARTER.is_relative_to(REPO / "plugins")
    assert generator.STARTER.is_dir()
    assert "the-haunting" in LEDGER.read_text("utf-8")


def test_the_ledger_states_what_it_does_not_prove(generator):
    """§8's whole purpose: silence must be distinguishable from absence."""
    ledger = LEDGER.read_text("utf-8")
    assert "## What this measures" in ledger
    assert "## Per check code" in ledger
    assert "not-measured" in ledger
    assert "Do not hand-edit" in ledger
    assert "gen_module_reachability_ledger.py" in ledger


def test_every_check_code_has_a_row(generator):
    """The per-code table is the ledger, so it may never be a partial list."""
    lint = generator._load_lint()
    data = generator.build()
    assert [row["code"] for row in data["per_code"]] == list(lint.CHECK_CODES)
    ledger = LEDGER.read_text("utf-8")
    for code in lint.CHECK_CODES:
        assert f"| `{code}` |" in ledger


def test_the_coverage_contradiction_is_recomputed_not_copied(generator):
    """Spec §2.2's measured facts, re-derived from the committed files.

    If a starter change moves any of these, the ledger's central claim changed
    and a human reviews it — the numbers are not quietly refreshed.
    """
    graph = generator.build()["graph"]
    assert len(graph["coverage_domains"]) == 10
    assert graph["coverage_accepted"] == graph["coverage_domains"]
    assert graph["clue_nodes"] == 39
    assert graph["acquisition_relations_on_clues"] == 0
    assert graph["declared_clues"] == 39
    assert graph["declared_clues_placed"] == 39
    assert all(count == 0 for _, count in graph["absent_node_kinds"])


def test_the_starter_finding_set_is_the_golden_expectation(generator):
    """§9: the starter's exact finding set is reviewed, never auto-adopted."""
    report = generator.build()["report"]
    assert report["scenario_id"] == "the-haunting"
    assert not report["progressive"]
    assert [(f["code"], f["subject_id"], f["completeness"])
            for f in report["findings"]] == [
        ("declared-minimum-shortfall", "corbitt-house-documentary-history", "dead")
    ]
