"""How a module gets cut is decided from the module, not from a rule.

Four books, measured:

    they-did-not-think-it-too-many    20 pages      33,280 chars
    cursed-be-the-city                18 pages      24,756 chars
    blood-highway                    111 pages     171,791 chars
    masks-of-nyarlathotep            654 pages   2,166,912 chars

The first two extract whole-book. The third cannot: the shard contract caps one
packet at 200 nodes and 400 relations. The fourth cannot be cut by chapter
either -- each of its seven chapters is larger than blood-highway entire.

The first cut of this planner scored heading depths and picked one. It chose 93
sections for blood-highway where seven were right, and 627 for Masks, whose
text layer marks 1,522 lines as depth-1. Masks states its own structure in a
paragraph on page 11 -- "The campaign is divided into seven core chapters" --
which no heading scan can read. So the decision belongs to a model and the
measuring and checking belong here, which is the same division the extractor
already uses and the reason an unseen book needs no new code.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
LIBRARY = ROOT / ".coc" / "module-library"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


planner = _load("coc_module_plan_tests", SCRIPTS / "coc_module_plan.py")


def _bundle(name: str) -> Path:
    path = LIBRARY / name
    if not path.is_dir():
        pytest.skip(f"{name} is not installed in this checkout")
    return path


def _measured(name: str) -> dict:
    return planner.measure(_bundle(name))


BLOOD_HIGHWAY_SEVEN = [
    ("front-and-keeper-info", 0, 14),
    ("prologue-and-town", 15, 41),
    ("the-compound", 42, 55),
    ("old-mine", 56, 65),
    ("serpent-caves", 66, 74),
    ("event-timeline", 75, 79),
    ("appendices", 80, 110),
]


def _plan(rows) -> dict:
    return {"sections": [
        {"section_id": sid, "pdf_index_start": lo, "pdf_index_end": hi}
        for sid, lo, hi in rows
    ]}


def test_a_short_module_is_planned_whole_book():
    measured = _measured("they-did-not-think-it-too-many")
    assert measured["fits_whole_book"] is True
    assert measured["module_chars"] <= measured["section_budget_chars"]


def test_a_long_module_is_not():
    for name in ("blood-highway", "masks-of-nyarlathotep"):
        measured = _measured(name)
        assert measured["fits_whole_book"] is False, name


def test_the_measurement_never_decides():
    """It reports what each depth would cost, and stops there.

    A `strategy` or `chosen_depth` field here would be the heuristic coming
    back: on Masks it picked 627 sections, one per page, from a text layer
    whose depth-1 headings are noise.
    """
    measured = _measured("blood-highway")
    assert "heading_depth_cuts" in measured
    for forbidden in ("strategy", "sections", "chosen_depth", "recommended_depth"):
        assert forbidden not in measured, (
            f"the measurement decided {forbidden!r}; deciding is the reading step"
        )


def test_the_books_own_structure_page_is_offered_to_the_reader():
    """Masks page 11 states its structure; blood-highway page 2 is its contents.

    Both are what a model needs and neither is findable by asking whether a
    page says "contents": Masks's chapter names are Peru, Egypt, Kenya, China,
    every one under seven characters, and its structure page is prose.
    """
    assert 11 in _measured("masks-of-nyarlathotep")["structure_page_candidates"]
    assert 2 in _measured("blood-highway")["structure_page_candidates"]


def test_the_reader_gets_a_fraction_of_the_book():
    """Planning must not cost what extraction costs."""
    dispatched = planner.dispatch(_bundle("masks-of-nyarlathotep"))
    payload = json.dumps({
        "measured": {k: v for k, v in dispatched["measured"].items()
                     if k != "page_chars"},
        "structure_page_text": dispatched["structure_page_text"],
    }, ensure_ascii=False)
    whole = dispatched["measured"]["module_chars"]
    assert len(payload) < whole / 20, (
        f"the planning input is {len(payload)} against a {whole}-character book"
    )


def test_the_plan_dispatch_names_no_binary_and_no_provider():
    dispatched = planner.dispatch(_bundle("blood-highway"))["dispatch"]
    assert dispatched["model_policy"] == "inherit_parent"

    def executable_keys(value, path=""):
        found = []
        if isinstance(value, dict):
            for key, item in value.items():
                if key in {"argv", "command", "cmd", "executable", "binary",
                           "provider", "api_key", "model"}:
                    found.append(f"{path}/{key}")
                found.extend(executable_keys(item, f"{path}/{key}"))
        elif isinstance(value, list):
            for index, item in enumerate(value):
                found.extend(executable_keys(item, f"{path}[{index}]"))
        return found

    assert not executable_keys(dispatched)


def test_a_faithful_plan_is_accepted():
    """The seven sections a reader cut blood-highway into by hand."""
    assert planner.check(_measured("blood-highway"), _plan(BLOOD_HIGHWAY_SEVEN)) == []


def test_a_plan_that_skips_pages_is_refused():
    """A page nobody reads is indistinguishable from a page the book lacks."""
    dropped = [row for row in BLOOD_HIGHWAY_SEVEN if row[0] != "old-mine"]
    findings = planner.check(_measured("blood-highway"), _plan(dropped))
    assert [f["code"] for f in findings] == ["pages_not_covered"]
    assert 56 in findings[0]["pdf_indices"]


def test_a_plan_that_claims_a_page_twice_is_refused():
    overlapping = BLOOD_HIGHWAY_SEVEN + [("overlap", 20, 30)]
    findings = planner.check(_measured("blood-highway"), _plan(overlapping))
    assert {f["code"] for f in findings} == {"page_claimed_twice"}


def test_a_section_over_budget_is_refused():
    findings = planner.check(
        _measured("blood-highway"), _plan([("everything", 0, 110)])
    )
    assert [f["code"] for f in findings] == ["section_over_budget"]
    assert findings[0]["chars"] > _measured("blood-highway")["section_budget_chars"]


def test_a_malformed_section_id_is_refused():
    rows = [("Front Matter", 0, 14)] + BLOOD_HIGHWAY_SEVEN[1:]
    findings = planner.check(_measured("blood-highway"), _plan(rows))
    assert [f["code"] for f in findings] == ["invalid_section_id"]


def test_the_instruction_forbids_inventing_a_structure():
    text = planner.INSTRUCTION_PATH.read_text(encoding="utf-8")
    assert "不知道就说不知道" in text
    assert "不要按页数" in text
