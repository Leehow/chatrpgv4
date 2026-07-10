"""Tests for coc_exit_conditions: structured exit-condition normalization/eval.

Shared choke point for coc_story_director._eval_exit and
coc_director_apply._director_exit_eval — no free-text keyword scanning in
either consumer (Semantic Matcher Constitution).
"""
import importlib.util


def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, rel)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


coc_exit_conditions = _load(
    "coc_exit_conditions", "plugins/coc-keeper/scripts/coc_exit_conditions.py"
)

normalize = coc_exit_conditions.normalize_exit_condition
evaluate = coc_exit_conditions.evaluate_exit_condition


def _never_clock(clock_id, threshold):
    return False


# ---------------------------------------------------------------------------
# normalize: structured objects pass through
# ---------------------------------------------------------------------------

def test_normalize_structured_clue_discovered():
    cond = normalize({"kind": "clue_discovered", "clue_id": "clue-chapel-link"})
    assert cond == {"kind": "clue_discovered", "clue_id": "clue-chapel-link"}


def test_normalize_structured_clock_reaches_with_and_without_clock_id():
    assert normalize({"kind": "clock_reaches", "threshold": 3}) == {
        "kind": "clock_reaches", "threshold": 3,
    }
    assert normalize({"kind": "clock_reaches", "clock_id": "c1", "threshold": "4"}) == {
        "kind": "clock_reaches", "clock_id": "c1", "threshold": 4,
    }


def test_normalize_structured_narrative():
    cond = normalize({"kind": "narrative", "description": "investigators accept the job"})
    assert cond["kind"] == "narrative"
    assert cond["description"] == "investigators accept the job"


def test_normalize_malformed_dict_degrades_to_narrative():
    assert normalize({"kind": "clue_discovered"})["kind"] == "narrative"
    assert normalize({"kind": "clock_reaches", "threshold": "many"})["kind"] == "narrative"
    assert normalize({"kind": "unknown_kind"})["kind"] == "narrative"


# ---------------------------------------------------------------------------
# normalize: legacy string DSL converts at this single choke point
# ---------------------------------------------------------------------------

def test_normalize_legacy_clue_discovered_string():
    cond = normalize("clue-A discovered")
    assert cond["kind"] == "clue_discovered"
    assert cond["clue_id"] == "clue-A"
    assert cond["legacy_source"] == "clue-A discovered"


def test_normalize_legacy_clock_string():
    cond = normalize("pressure clock reaches 3")
    assert cond["kind"] == "clock_reaches"
    assert cond["threshold"] == 3
    assert cond["legacy_source"] == "pressure clock reaches 3"


def test_normalize_free_prose_becomes_narrative_not_keyword_match():
    """Free prose that merely CONTAINS 'discovered' must not be treated as a
    machine-checkable clue condition (anchored legacy pattern only)."""
    cond = normalize("the investigators discovered their courage")
    assert cond["kind"] == "narrative"
    cond2 = normalize("investigators accept the job")
    assert cond2["kind"] == "narrative"


def test_normalize_empty_and_none():
    assert normalize("")["kind"] == "narrative"
    assert normalize(None)["kind"] == "narrative"


# ---------------------------------------------------------------------------
# evaluate
# ---------------------------------------------------------------------------

def test_evaluate_clue_discovered():
    cond = {"kind": "clue_discovered", "clue_id": "clue-A"}
    assert evaluate(cond, discovered_clue_ids={"clue-A"}, clock_reached=_never_clock)
    assert not evaluate(cond, discovered_clue_ids={"clue-B"}, clock_reached=_never_clock)


def test_evaluate_clock_reaches_delegates_to_lookup():
    seen = []

    def clock_reached(clock_id, threshold):
        seen.append((clock_id, threshold))
        return threshold <= 3

    assert evaluate({"kind": "clock_reaches", "threshold": 3},
                    discovered_clue_ids=set(), clock_reached=clock_reached)
    assert not evaluate({"kind": "clock_reaches", "clock_id": "c1", "threshold": 5},
                        discovered_clue_ids=set(), clock_reached=clock_reached)
    assert seen == [(None, 3), ("c1", 5)]


def test_evaluate_narrative_always_false():
    assert not evaluate({"kind": "narrative", "description": "anything"},
                        discovered_clue_ids={"clue-A"}, clock_reached=lambda c, t: True)
    assert not evaluate("investigators accept the job",
                        discovered_clue_ids=set(), clock_reached=lambda c, t: True)


def test_evaluate_legacy_string_end_to_end():
    assert evaluate("clue-A discovered",
                    discovered_clue_ids={"clue-A"}, clock_reached=_never_clock)
    assert evaluate("pressure clock reaches 2",
                    discovered_clue_ids=set(), clock_reached=lambda c, t: t == 2)
