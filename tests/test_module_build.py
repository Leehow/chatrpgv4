"""The build driver's narrowing: a section too big for one generation.

The first unattended whole-book runs died mid-token at ~64K characters while
one faithful shard of the same book is 77K. The driver must not retry that
failure identically; it narrows the page range by bisection, down to a single
page, and reports rather than hides whatever still does not fit. These tests
pin that recursion with a scripted `ask`, so no model is involved.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


build = _load("coc_module_build_tests", SCRIPTS / "coc_module_build.py")


class _Script:
    """Multi-page ranges always overflow; single pages too, once named in
    `overflow`. Every prepare call is recorded so tests can see the shape of
    the narrowing."""

    def __init__(self) -> None:
        self.calls: list[dict] = []
        self.overflow: set[str] = set()

    def prepare(self, bundle, work_dir, **kwargs):
        self.calls.append({
            "section_id": kwargs["section_id"],
            "start": kwargs["pdf_index_start"],
            "end": kwargs["pdf_index_end"],
        })
        return {"span_count": 10}

    def extract_section(self, work_dir, ask, *, max_rounds):
        call = next(
            c for c in reversed(self.calls) if c["section_id"] == work_dir.name
        )
        if call["end"] > call["start"] or call["section_id"] in self.overflow:
            return {"status": "output_over_generation_budget", "attempts": 1,
                    "rounds": []}
        return {"status": "accepted", "attempts": 1, "rounds": [],
                "nodes": 3, "claims": 2, "relations": 2,
                "shard_path": str(work_dir / "shard.json")}


@pytest.fixture
def script(monkeypatch: pytest.MonkeyPatch) -> _Script:
    scripted = _Script()
    monkeypatch.setattr(build.extract, "prepare", scripted.prepare)
    monkeypatch.setattr(build, "extract_section", scripted.extract_section)
    return scripted


def test_an_oversize_section_is_narrowed_by_bisection(script, tmp_path):
    results: list[dict] = []
    build._extract_ranged(
        tmp_path, tmp_path, "mod", "whole-book", 0, 3,
        ask=lambda i, p: "{}", max_rounds=3, results=results,
    )
    assert [r["section_id"] for r in results] == [
        "whole-book-p0-0", "whole-book-p1-1",
        "whole-book-p2-2", "whole-book-p3-3",
    ]
    assert all(r["status"] == "accepted" for r in results)
    # one prepare for the root range, then per bisection level: 1 + 2 + 4
    assert len(script.calls) == 7


def test_a_single_page_that_still_overflows_is_reported_not_hidden(
    script, tmp_path,
):
    script.overflow.add("whole-book")
    results: list[dict] = []
    build._extract_ranged(
        tmp_path, tmp_path, "mod", "whole-book", 0, 0,
        ask=lambda i, p: "{}", max_rounds=3, results=results,
    )
    assert [r["status"] for r in results] == ["output_over_generation_budget"]
    assert len(script.calls) == 1


def test_a_range_that_fits_is_extracted_once(script, tmp_path):
    results: list[dict] = []
    build._extract_ranged(
        tmp_path, tmp_path, "mod", "whole-book", 2, 2,
        ask=lambda i, p: "{}", max_rounds=3, results=results,
    )
    assert [r["section_id"] for r in results] == ["whole-book"]
    assert [r["status"] for r in results] == ["accepted"]
    assert len(script.calls) == 1
