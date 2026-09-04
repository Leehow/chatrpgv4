"""The build driver's narrowing: a section too big for one generation.

The first unattended whole-book runs died mid-token at ~64K characters while
one faithful shard of the same book is 77K. The driver must not retry that
failure identically; it narrows the page range by bisection, down to a single
page, and reports rather than hides whatever still does not fit. These tests
pin that recursion with a scripted `ask`, so no model is involved.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import module_build_fixtures as fixtures  # noqa: E402

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



def _accepting_stub(_work: Path):
    """An `extract_section` stub that leaves behind what a real one leaves.

    Stopping at the status would let these tests pass over a driver that never
    assembles anything -- the exact silence the assembly step exists to break.
    """
    def stub(work_dir, ask=None, **kwargs):
        target = Path(work_dir)
        target.mkdir(parents=True, exist_ok=True)
        (target / "evidence-packet.json").write_text(
            json.dumps(fixtures.evidence_packet()), encoding="utf-8")
        (target / "accepted.shard.json").write_text(
            json.dumps(fixtures.shard(build.graph.assemble_model_shard, target.name),
                       ensure_ascii=False), encoding="utf-8")
        return {"status": "accepted", "attempts": 1, "rounds": [], "nodes": 1}
    return stub


def test_a_range_that_fits_is_extracted_once(script, tmp_path):
    results: list[dict] = []
    build._extract_ranged(
        tmp_path, tmp_path, "mod", "whole-book", 2, 2,
        read_with_agent=lambda work_dir, brief: None,
        max_rounds=3, results=results,
    )
    assert [r["section_id"] for r in results] == ["whole-book"]
    assert [r["status"] for r in results] == ["accepted"]
    assert len(script.calls) == 1


def test_a_wide_range_is_read_in_one_piece(script, tmp_path):
    """Bisection is gone with the limit that caused it.

    A section used to be halved whenever one reply could not carry its shard,
    which is a property of a single assistant message and not of the book. An
    agent writes the shard to a file over as many turns as it needs, so a wide
    range is read whole -- and reading it whole is what keeps the scene graph
    in one piece instead of one fragment per leaf.
    """
    results: list[dict] = []
    build._extract_ranged(
        tmp_path, tmp_path, "mod", "whole-book", 0, 17,
        read_with_agent=lambda work_dir, brief: None,
        max_rounds=3, results=results,
    )
    assert [r["section_id"] for r in results] == ["whole-book"]
    assert len(script.calls) == 1, "the range was split"


def test_an_empty_range_is_recorded_but_never_counted(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
):
    """A range that lands on declared bundle holes must not crash the run,
    and must not inflate either side of the accepted/failed tally."""
    monkeypatch.setattr(build.extract, "prepare", lambda *a, **k: {
        "status": "empty", "span_count": 0, "reason": "holes",
    })
    results: list[dict] = []
    build._extract_ranged(
        tmp_path, tmp_path, "mod", "whole-book", 4, 7,
        read_with_agent=lambda work_dir, brief: None,
        max_rounds=3, results=results,
    )
    assert [r["status"] for r in results] == ["empty"]


def _plan_of(*ranges: tuple[str, int, int]) -> dict:
    return {"status": "accepted", "sections": [
        {"section_id": sid, "pdf_index_start": lo, "pdf_index_end": hi}
        for sid, lo, hi in ranges
    ]}


def _shard_with_scene_pages(*pages: int) -> dict:
    return {"nodes": [{
        "node_kind": "scene",
        "evidence_span_ids": [
            f"span-skeleton-page-{page}-block-1" for page in pages
        ],
    }]}


def test_opening_sections_follow_the_evidence_pages_not_the_proposal():
    plan = _plan_of(("alpha", 0, 10), ("beta", 11, 20), ("gamma", 21, 30))
    opening = build.opening_sections(plan, _shard_with_scene_pages(13, 14))
    assert opening["sections"] == ["beta"]
    assert opening["entry_pages"] == [13, 14]


def test_opening_sections_without_evidence_decides_nothing():
    plan = _plan_of(("alpha", 0, 10))
    opening = build.opening_sections(plan, {"nodes": []})
    assert opening["sections"] == []
    assert "no entry scene" in opening["basis"]


def _fake_adapter(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    (tmp_path / "fake_adapter.py").write_text(
        'def ask(instruction, payload):\n    return \'{}\'\n\n\ndef read_with_agent(work_dir, brief):\n    """A host that runs no agent; tests stub the reading itself."""\n    return None\n', encoding="utf-8",
    )
    monkeypatch.syspath_prepend(str(tmp_path))


def _accepted_plan(tmp_path: Path, sections: list[dict]) -> Path:
    plan_path = tmp_path / "plan.json"
    plan_path.write_text(json.dumps(
        {"status": "accepted", "attempts": 1, "sections": sections},
        ensure_ascii=False,
    ), encoding="utf-8")
    return plan_path


def test_an_accepted_plan_file_skips_replanning(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
):
    """Forty-two section workers must not pay forty-two planning calls."""
    _fake_adapter(monkeypatch, tmp_path)

    def plan_module_boom(*args, **kwargs):
        raise AssertionError("plan_module ran despite --plan")

    monkeypatch.setattr(build, "plan_module", plan_module_boom)
    prepared: list[str] = []
    monkeypatch.setattr(
        build.extract, "prepare",
        lambda bundle, work_dir, **kwargs: (
            prepared.append(kwargs["section_id"]) or {"span_count": 1}),
    )
    monkeypatch.setattr(
        build, "extract_section", _accepting_stub(tmp_path / "w"),
    )
    plan = _accepted_plan(tmp_path, [
        {"section_id": "s1", "pdf_index_start": 0, "pdf_index_end": 1},
        {"section_id": "s2", "pdf_index_start": 2, "pdf_index_end": 3},
    ])
    rc = build.main([
        "--adapter", "fake_adapter",
        "--source-bundle", str(tmp_path),
        "--work-dir", str(tmp_path / "w"),
        "--module-id", "mod", "--no-stitch",
        "--plan", str(plan),
        "--only-section", "s2",
    ])
    assert rc == 0
    assert prepared == ["s2"]


def test_a_wide_section_is_pre_split_before_any_generation(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
):
    """Measured on Masks: every truncation-first narrowing burned a whole
    generation discovering a size the page count already predicts. Sections
    past the leaf budget split up front; the narrowing recursion remains as
    the safety net under each chunk."""
    _fake_adapter(monkeypatch, tmp_path)
    prepared: list[tuple[int, int]] = []
    monkeypatch.setattr(
        build.extract, "prepare",
        lambda bundle, work_dir, **kwargs: (
            prepared.append((kwargs["pdf_index_start"], kwargs["pdf_index_end"]))
            or {"span_count": 1}),
    )
    monkeypatch.setattr(
        build, "extract_section", _accepting_stub(tmp_path / "w"),
    )
    plan = _accepted_plan(tmp_path, [
        {"section_id": "wide", "pdf_index_start": 0, "pdf_index_end": 9},
    ])
    work = tmp_path / "w"
    rc = build.main([
        "--adapter", "fake_adapter",
        "--source-bundle", str(tmp_path),
        "--work-dir", str(work),
        "--module-id", "mod",
        "--plan", str(plan),
        "--no-skeleton",
        "--no-stitch",
        "--max-leaf-pages", "4",
    ])
    assert prepared == [(0, 3), (4, 7), (8, 9)]
    # Splitting is still available, and this is the price of using it: three
    # leaves that never saw each other's pages make three pieces the Keeper
    # cannot walk between, and the standard says so rather than passing.
    receipt = json.loads((work / "build.json").read_text())
    assert receipt["assembly"]["status"] == "assembled_not_playable"
    assert receipt["assembly"]["template"]["measures"]["scene_components"] == 3
    assert rc == 1
    receipt = json.loads((work / "build.json").read_text())
    assert [s["section_id"] for s in receipt["sections"]] == [
        "wide-p0-3", "wide-p4-7", "wide-p8-9",
    ]


def test_opening_only_deep_reads_only_the_skeletons_choice(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
):
    _fake_adapter(monkeypatch, tmp_path)
    monkeypatch.setattr(build, "skeleton_module", lambda *a, **k: {
        "status": "accepted", "attempts": 1,
        "opening": {"sections": ["s2"], "entry_pages": [5],
                    "basis": "evidence"},
    })
    prepared: list[str] = []
    monkeypatch.setattr(
        build.extract, "prepare",
        lambda bundle, work_dir, **kwargs: (
            prepared.append(kwargs["section_id"]) or {"span_count": 1}),
    )
    monkeypatch.setattr(
        build, "extract_section", _accepting_stub(tmp_path / "w"),
    )
    plan = _accepted_plan(tmp_path, [
        {"section_id": "s1", "pdf_index_start": 0, "pdf_index_end": 3},
        {"section_id": "s2", "pdf_index_start": 4, "pdf_index_end": 7},
        {"section_id": "s3", "pdf_index_start": 8, "pdf_index_end": 11},
    ])
    work = tmp_path / "w"
    rc = build.main([
        "--adapter", "fake_adapter",
        "--source-bundle", str(tmp_path),
        "--work-dir", str(work),
        "--module-id", "mod",
        "--plan", str(plan),
        "--opening-only",
    ])
    assert rc == 0
    assert prepared == ["s2"]
    receipt = json.loads((work / "build.json").read_text())
    assert receipt["skeleton"]["opening"]["sections"] == ["s2"]


def test_opening_only_without_evidence_refuses_to_guess(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
):
    _fake_adapter(monkeypatch, tmp_path)
    monkeypatch.setattr(build, "skeleton_module", lambda *a, **k: {
        "status": "accepted", "attempts": 1,
        "opening": {"sections": [], "entry_pages": [],
                    "basis": "the skeleton named no entry scene with evidence"},
    })
    plan = _accepted_plan(tmp_path, [
        {"section_id": "s1", "pdf_index_start": 0, "pdf_index_end": 3},
    ])
    rc = build.main([
        "--adapter", "fake_adapter",
        "--source-bundle", str(tmp_path),
        "--work-dir", str(tmp_path / "w"),
        "--module-id", "mod", "--no-stitch",
        "--plan", str(plan),
        "--opening-only",
    ])
    assert rc == 1


def test_plan_module_repairs_overflow_instead_of_retrying(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
):
    """The Masks proof oscillated 13 -> 1 -> 4 over-budget findings because
    the model cannot count characters. A proposal wrong only in arithmetic is
    repaired by the machine in the same round, and the receipt says so."""
    measured = {
        "status": "measured",
        "fits_whole_book": False,
        "section_budget_chars": 100,
        "page_chars": {"0": 90, "1": 90, "2": 90, "3": 90},
        "pdf_index_first": 0,
        "pdf_index_last": 3,
    }
    monkeypatch.setattr(build.planner, "dispatch", lambda *a, **k: {
        "status": "dispatch", "measured": measured,
        "structure_page_text": {},
    })
    instruction = tmp_path / "instruction.md"
    instruction.write_text("plan", encoding="utf-8")
    monkeypatch.setattr(build.planner, "INSTRUCTION_PATH", instruction)
    asks: list[str] = []

    def ask(instruction_text: str, payload: str) -> str:
        asks.append(payload)
        return json.dumps({"sections": [{
            "section_id": "whole", "title": "t",
            "pdf_index_start": 0, "pdf_index_end": 3, "reason": "r",
        }]})

    result = build.plan_module(tmp_path, ask)
    assert result["status"] == "accepted"
    assert [s["section_id"] for s in result["sections"]] == [
        "whole-a", "whole-b", "whole-c", "whole-d",
    ]
    assert result["repairs"][0]["into"] == 4
    assert result["rounds"][0]["status"] == "repaired"
    assert len(asks) == 1, "no second model round was spent on arithmetic"


def test_a_plan_file_that_never_passed_cannot_drive(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
):
    _fake_adapter(monkeypatch, tmp_path)
    plan_path = tmp_path / "plan.json"
    plan_path.write_text(json.dumps({"status": "not_accepted", "sections": []}))
    rc = build.main([
        "--adapter", "fake_adapter",
        "--source-bundle", str(tmp_path),
        "--work-dir", str(tmp_path / "w"),
        "--module-id", "mod", "--no-stitch",
        "--plan", str(plan_path),
    ])
    assert rc == 1


def test_plan_only_stops_before_any_section_work(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
):
    _fake_adapter(monkeypatch, tmp_path)
    monkeypatch.setattr(build, "plan_module", lambda *a, **k: {
        "status": "accepted", "attempts": 1,
        "sections": [{"section_id": "s1", "pdf_index_start": 0,
                      "pdf_index_end": 1}],
    })
    monkeypatch.setattr(build.extract, "prepare", lambda *a, **k: (
        (_ for _ in ()).throw(AssertionError("prepare ran during --plan-only"))
    ))
    work = tmp_path / "w"
    rc = build.main([
        "--adapter", "fake_adapter",
        "--source-bundle", str(tmp_path),
        "--work-dir", str(work),
        "--module-id", "mod",
        "--plan-only",
    ])
    assert rc == 0
    assert json.loads((work / "plan.json").read_text())["status"] == "accepted"


def test_a_section_worker_writes_its_own_receipt(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
):
    """Forty-two workers share one work dir; one build.json would corrupt."""
    _fake_adapter(monkeypatch, tmp_path)
    monkeypatch.setattr(
        build.extract, "prepare", lambda *a, **k: {"span_count": 1})
    monkeypatch.setattr(
        build, "extract_section", lambda *a, **k: {
            "status": "accepted", "attempts": 1, "rounds": [], "nodes": 1})
    plan = _accepted_plan(tmp_path, [
        {"section_id": "s1", "pdf_index_start": 0, "pdf_index_end": 1},
    ])
    work = tmp_path / "w"
    rc = build.main([
        "--adapter", "fake_adapter",
        "--source-bundle", str(tmp_path),
        "--work-dir", str(work),
        "--module-id", "mod",
        "--plan", str(plan),
        "--only-section", "s1",
    ])
    assert rc == 0
    assert (work / "build.s1.json").exists()
