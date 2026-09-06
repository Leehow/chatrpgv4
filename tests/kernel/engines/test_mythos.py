"""Tests for Cthulhu Mythos tracking (Chapter 8, p.167/p.179). Ported from the
old tree's `tests/test_mythos.py` (subject: `coc_mythos.py`, now
`kernel/coc/rules/mythos.py`).

Validates:
- First Mythos encounter -> +5 CM; subsequent -> +1 CM (p.167).
- max_san = 99 - cm_value (p.167, F9).
- Current SAN clamped to the new max when CM rises.
- become_believer: the "believer bomb" (p.179) SAN cost on a first-hand
  encounter vs. a tome (no SAN cost, CM still rises).

Dropped (subject deleted): `gain_mythos_persisted` / `become_believer_persisted`
and their investigator-state file roundtrip (`_write_inv_state`, `_read_inv_state`,
the `logs/events.jsonl` append). The kernel keeps `cm_value` / `max_san` /
`current_san` directly on the party sheet — mythos.py's module docstring: "the
persisted variants here mutate the sheet dict the caller then writes; there is
no separate investigator-state file." `gain_mythos` and `become_believer`
themselves are otherwise a verbatim port (same signatures, same arithmetic).

The old file's bout-of-madness tests (`test_bout_resolves_result_and_kind_from_table`,
`test_bout_summary_mode_when_alone`, `test_bout_realtime_mode_when_not_alone`,
`test_resolve_bout_result_*`) exercise `coc_sanity.SanitySession`, not
`coc_mythos.py` — they are ported instead in `tests/kernel/engines/test_sanity.py`.
"""

from __future__ import annotations

import sys

from conftest import KERNEL_DIR

sys.path.insert(0, str(KERNEL_DIR))

from coc.rules.mythos import become_believer, gain_mythos, max_san_for  # noqa: E402


# --------------------------------------------------------------------------- #
# max_san_for
# --------------------------------------------------------------------------- #
def test_max_san_for_zero_cm():
    assert max_san_for(0) == 99


def test_max_san_for_nonzero_cm():
    assert max_san_for(10) == 89
    assert max_san_for(50) == 49


def test_max_san_for_clamps_at_zero():
    assert max_san_for(100) == 0
    assert max_san_for(150) == 0


# --------------------------------------------------------------------------- #
# gain_mythos -- first encounter
# --------------------------------------------------------------------------- #
def test_first_encounter_grants_5_cm():
    state = {"cm_value": 0, "current_san": 70, "max_san": 99}
    ev = gain_mythos(state, is_first=True)
    assert state["cm_value"] == 5
    assert ev["cm_gain"] == 5
    assert ev["is_first"] is True


def test_first_encounter_reduces_max_san():
    state = {"cm_value": 0, "current_san": 99, "max_san": 99}
    gain_mythos(state, is_first=True)
    assert state["max_san"] == 94  # 99 - 5


def test_first_encounter_clamps_current_san():
    """If current SAN exceeds the new max, it is clamped down."""
    state = {"cm_value": 0, "current_san": 99, "max_san": 99}
    ev = gain_mythos(state, is_first=True)
    assert state["current_san"] == 94  # clamped to new max
    assert ev["san_clamped"] == 5


def test_first_encounter_no_clamp_when_below_max():
    state = {"cm_value": 0, "current_san": 50, "max_san": 99}
    ev = gain_mythos(state, is_first=True)
    assert state["current_san"] == 50  # unchanged (below new max 94)
    assert ev["san_clamped"] == 0


# --------------------------------------------------------------------------- #
# gain_mythos -- subsequent encounters
# --------------------------------------------------------------------------- #
def test_subsequent_encounter_grants_1_cm():
    state = {"cm_value": 5, "current_san": 60, "max_san": 94}
    ev = gain_mythos(state, is_first=False)
    assert state["cm_value"] == 6
    assert ev["cm_gain"] == 1
    assert state["max_san"] == 93  # 99 - 6


def test_explicit_amount_overrides_is_first():
    state = {"cm_value": 10, "current_san": 60, "max_san": 89}
    ev = gain_mythos(state, amount=7)
    assert state["cm_value"] == 17
    assert ev["cm_gain"] == 7
    assert state["max_san"] == 82  # 99 - 17


def test_gain_mythos_defaults_cm_to_zero_when_absent():
    state = {"current_san": 70}
    gain_mythos(state, is_first=True)
    assert state["cm_value"] == 5


# --------------------------------------------------------------------------- #
# become_believer -- believer flag (p.179 / W2-6)
# --------------------------------------------------------------------------- #
def test_become_believer_sets_believer_flag_in_memory():
    state = {"cm_value": 10, "current_san": 70, "max_san": 89}
    ev = become_believer(state, source="first_hand_encounter", is_first=False)
    assert state["believer"] is True
    assert ev["event_type"] == "become_believer"


def test_become_believer_first_hand_costs_san_equal_to_cm():
    """The 'believer bomb' (F3): first-hand encounter costs SAN = current CM."""
    state = {"cm_value": 10, "current_san": 70, "max_san": 89}
    ev = become_believer(state, source="first_hand_encounter", is_first=False)
    assert ev["san_lost"] == 10
    assert state["current_san"] == 60
    assert ev["permanently_insane"] is False


def test_become_believer_tome_costs_no_san():
    """Reading a tome may let the investigator choose not to believe: CM still
    rises, but no SAN is lost."""
    state = {"cm_value": 10, "current_san": 70, "max_san": 89}
    ev = become_believer(state, source="tome", is_first=False)
    assert ev["san_lost"] == 0
    assert state["current_san"] == 70
    assert state["cm_value"] == 11


def test_become_believer_rejects_unknown_source():
    state = {"cm_value": 0, "current_san": 70, "max_san": 99}
    try:
        become_believer(state, source="rumor")
    except ValueError as exc:
        assert "rumor" in str(exc)
    else:
        raise AssertionError("expected ValueError for an unsupported believer source")
