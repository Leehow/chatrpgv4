#!/usr/bin/env python3
"""Tests for phobia/mania state application (coc_sanity.py extension).

Validates (p.159, p.171):
- Bout-of-madness result 9 → phobia rolled on Table IX, recorded in conditions.
- Bout-of-madness result 10 → mania rolled on Table X, recorded in conditions.
- Insane investigator exposed to phobia/mania source → 1 penalty die (non-SAN).
- Sane investigator exposed → no penalty die.
"""
from __future__ import annotations

import importlib.util
import random
from pathlib import Path

import pytest


PLUGIN_ROOT = Path("plugins/coc-keeper")


def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, PLUGIN_ROOT / "scripts" / rel)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


coc_sanity = _load("coc_sanity", "coc_sanity.py")


def _make_session(san=65, int_val=60, seed=42):
    return coc_sanity.SanitySession("ada", san_max=san, int_value=int_val,
                                    rng=random.Random(seed))


# --------------------------------------------------------------------------- #
# Phobia / mania resolution (direct)
# --------------------------------------------------------------------------- #
def test_roll_phobia_records_name_and_condition():
    s = _make_session(seed=7)
    name = s._roll_phobia()
    assert name is not None
    assert s.phobia == name
    assert f"phobia:{name}" in s.conditions
    # an event was emitted (sanity module uses {"type": ...} event shape)
    assert any(ev.get("type") == "phobia_gained" for ev in s.events)


def test_roll_mania_records_name_and_condition():
    s = _make_session(seed=7)
    name = s._roll_mania()
    assert name is not None
    assert s.mania == name
    assert f"mania:{name}" in s.conditions
    assert any(ev.get("type") == "mania_gained" for ev in s.events)


def test_roll_phonia_uses_1d100_range():
    """The phobia roll should pick from the 100-entry table."""
    # Run many seeds; the chosen name must always be a valid table entry.
    table = coc_sanity._load_phobia_mania_table("phobias")
    assert len(table) >= 90  # the file has 100 entries
    for seed in range(20):
        s = _make_session(seed=seed)
        name = s._roll_phobia()
        assert name in table


def test_roll_phobia_does_not_duplicate_condition():
    s = _make_session(seed=3)
    s._roll_phobia()
    name_first = s.phobia
    # Force the same name by setting conditions already
    s._roll_phobia()  # may pick a different name, but no duplicate cond entry
    # count occurrences of any phobia: condition
    phobia_conds = [c for c in s.conditions if c.startswith("phobia:")]
    assert len(phobia_conds) == len(set(phobia_conds))  # no dupes


# --------------------------------------------------------------------------- #
# Bout-of-madness integration (result 9 / 10)
# --------------------------------------------------------------------------- #
def _seed_for_bout_roll(target_roll: int) -> int:
    """Find a seed where _trigger_temporary_insanity's bout_roll == target.

    _trigger_temporary_insanity draws: duration_hours=randint(1,10), then
    bout_roll=randint(1,10). We brute-force a seed producing the target.
    """
    for seed in range(500):
        rng = random.Random(seed)
        rng.randint(1, 10)  # duration_hours
        if rng.randint(1, 10) == target_roll:
            return seed
    raise RuntimeError(f"no seed found for bout_roll={target_roll}")


def test_bout_roll_9_yields_phobia():
    seed = _seed_for_bout_roll(9)
    s = _make_session(san=65, int_val=60, seed=seed)
    # Directly trigger (bypassing the sanity_check/INT chain) to isolate.
    s._trigger_temporary_insanity("test horror", alone=False, module_bout_override=None)
    assert s.phobia is not None
    assert s.mania is None
    last_bout = s.bouts_of_madness[-1]
    assert last_bout["bout_roll"] == 9
    assert "phobia" in last_bout


def test_bout_roll_10_yields_mania():
    seed = _seed_for_bout_roll(10)
    s = _make_session(san=65, int_val=60, seed=seed)
    s._trigger_temporary_insanity("test horror", alone=False, module_bout_override=None)
    assert s.mania is not None
    assert s.phobia is None
    last_bout = s.bouts_of_madness[-1]
    assert last_bout["bout_roll"] == 10
    assert "mania" in last_bout


def test_bout_roll_below_9_yields_no_phobia_or_mania():
    seed = _seed_for_bout_roll(5)
    s = _make_session(san=65, int_val=60, seed=seed)
    s._trigger_temporary_insanity("test horror", alone=False, module_bout_override=None)
    assert s.phobia is None
    assert s.mania is None


# --------------------------------------------------------------------------- #
# Penalty-die exposure logic (p.159)
# --------------------------------------------------------------------------- #
def test_penalty_die_zero_when_sane():
    s = _make_session()
    s.phobia = "Claustrophobia"
    # not insane
    assert s.is_insane is False
    assert s.penalty_die_for_exposure(phobia_source="Claustrophobia") == 0


def test_penalty_die_one_when_insane_and_phobia_exposed():
    s = _make_session()
    s.phobia = "Claustrophobia"
    s.temporary_insane = True
    assert s.is_insane is True
    assert s.penalty_die_for_exposure(phobia_source="Claustrophobia") == 1


def test_penalty_die_one_when_insane_and_mania_exposed():
    s = _make_session()
    s.mania = "Pyromania"
    s.indefinite_insane = True
    assert s.penalty_die_for_exposure(mania_source="Pyromania") == 1


def test_penalty_die_zero_when_source_does_not_match():
    s = _make_session()
    s.phobia = "Claustrophobia"
    s.temporary_insane = True
    assert s.penalty_die_for_exposure(phobia_source="Heights") == 0


def test_penalty_die_source_match_is_case_insensitive_substring():
    s = _make_session()
    s.phobia = "Arachnophobia"
    s.temporary_insane = True
    # substring + case-insensitive
    assert s.penalty_die_for_exposure(phobia_source="arachno") == 1


def test_penalty_die_stacks_phobia_and_mania():
    s = _make_session()
    s.phobia = "Claustrophobia"
    s.mania = "Pyromania"
    s.temporary_insane = True
    assert s.penalty_die_for_exposure(
        phobia_source="Claustrophobia", mania_source="Pyromania") == 2


# --------------------------------------------------------------------------- #
# Snapshot includes phobia/mania/conditions
# --------------------------------------------------------------------------- #
def test_snapshot_includes_phobia_mania_conditions():
    s = _make_session()
    s._roll_phobia()
    snap = s.snapshot()
    assert snap["phobia"] == s.phobia
    assert "conditions" in snap
    assert any(c.startswith("phobia:") for c in snap["conditions"])
