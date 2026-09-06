"""Tests for the MP economy layer (Chapter 10). Ported from the old tree's
`tests/test_mp.py` (subject: `coc_mp.py`, now `kernel/coc/rules/mp.py`).

Validates: pool init (POW//5), spend + overspill to HP, regeneration rate
(1/hr, 2/hr if POW>100) with cap, mp-state snapshot persistence, and the
downtime-trigger integration (`handle_time_trigger`).

Dropped (subject deleted): the old `test_persist_events_appends_to_events_jsonl`
and the `coc_time` log-append half of `handle_time_trigger` — the ported engine
returns events to the caller instead of owning `logs/events.jsonl` (see
`mp.py`'s module docstring and `healing.py`'s: "the kernel's events.jsonl is a
closed enum"). `MPool.save()`/`load()` also gained a `tables: RuleTables`
parameter (the mp economy now comes from the rules tables rather than a
module-global `_load_mp_economy()`), and the snapshot lives at
`save/mp-state/<inv>.json` instead of the old shared `investigator-state`.
"""

from __future__ import annotations

import json
import sys

import pytest
from conftest import CONTENT_DIR, KERNEL_DIR

sys.path.insert(0, str(KERNEL_DIR))

from coc.rules.mp import MPool, handle_time_trigger  # noqa: E402
from coc.rules.tables import RuleTables  # noqa: E402

RULES = CONTENT_DIR / "rulesets" / "coc7" / "rules-json"


@pytest.fixture(scope="module")
def tables() -> RuleTables:
    return RuleTables(RULES)


# --------------------------------------------------------------------------- #
# Pool initialization
# --------------------------------------------------------------------------- #
def test_pool_init_is_pow_div_5():
    pool = MPool("inv1", pow_value=60)
    assert pool.mp_max == 12  # 60 // 5
    assert pool.current_mp == 12


def test_pool_init_floors_pow_div_5():
    pool = MPool("inv1", pow_value=63)
    assert pool.mp_max == 12  # 63 // 5 == 12 (floor)
    assert pool.current_mp == 12


def test_regen_rate_normal():
    pool = MPool("inv1", pow_value=60)
    assert pool.regen_per_hour == 1


def test_regen_rate_double_for_high_pow():
    pool = MPool("inv1", pow_value=120)
    assert pool.regen_per_hour == 2


# --------------------------------------------------------------------------- #
# spend_mp
# --------------------------------------------------------------------------- #
def test_spend_within_pool():
    pool = MPool("inv1", pow_value=50)  # mp_max=10
    ev = pool.spend_mp(4, source="castVOKE")
    assert pool.current_mp == 6
    assert ev["mp_before"] == 10
    assert ev["mp_after"] == 6
    assert ev["overspill_to_hp"] == 0


def test_spend_exactly_to_zero():
    pool = MPool("inv1", pow_value=50)  # mp_max=10
    pool.spend_mp(10)
    assert pool.current_mp == 0


def test_spend_overspills_to_hp():
    """When MP < 0, the deficit goes to HP 1:1 (p.137)."""
    pool = MPool("inv1", pow_value=50, current_hp=14)  # mp_max=10
    ev = pool.spend_mp(13, source="overcast")
    assert pool.current_mp == 0  # clamped at 0
    assert pool.current_hp == 11  # 14 - 3 overspill
    assert ev["overspill_to_hp"] == 3
    assert ev["hp_damage"] == 3


def test_can_spend_within_pool():
    pool = MPool("inv1", pow_value=50, current_hp=10)
    assert pool.can_spend(8) is True


def test_can_spend_rejects_fatal_overspill():
    """If overspill would kill (HP -> 0 or below), can_spend is False."""
    pool = MPool("inv1", pow_value=50, current_hp=2)  # mp_max=10
    # spending 20 -> overspill 10, HP would go to -8 (fatal)
    assert pool.can_spend(20) is False


def test_spend_without_hp_tracker_still_records_overspill():
    """If no HP tracker, overspill is recorded but HP not modified."""
    pool = MPool("inv1", pow_value=50)  # no current_hp
    ev = pool.spend_mp(13)
    assert pool.current_mp == 0
    assert ev["overspill_to_hp"] == 3
    assert ev["hp_damage"] == 0  # no HP tracker to damage


# --------------------------------------------------------------------------- #
# regen_mp
# --------------------------------------------------------------------------- #
def test_regen_capped_at_mp_max():
    pool = MPool("inv1", pow_value=50)  # mp_max=10
    pool.current_mp = 9
    gained = pool.regen_mp(5)  # would gain 5, but cap is 10
    assert gained == 1
    assert pool.current_mp == 10


def test_regen_proportional_to_hours():
    pool = MPool("inv1", pow_value=60)  # mp_max=12, 1/hr
    pool.current_mp = 0
    gained = pool.regen_mp(8)
    assert gained == 8
    assert pool.current_mp == 8


def test_regen_double_rate_for_high_pow():
    pool = MPool("inv1", pow_value=120)  # 2/hr
    pool.current_mp = 0
    gained = pool.regen_mp(3)
    assert gained == 6


def test_regen_zero_hours_is_noop():
    pool = MPool("inv1", pow_value=60)
    pool.current_mp = 5
    assert pool.regen_mp(0) == 0
    assert pool.current_mp == 5


# --------------------------------------------------------------------------- #
# Persistence (mp-state snapshot)
# --------------------------------------------------------------------------- #
@pytest.fixture
def campaign(tmp_path):
    camp = tmp_path / "campaign"
    (camp / "save" / "mp-state").mkdir(parents=True)
    return camp


def test_save_writes_mp_snapshot(campaign):
    pool = MPool("inv1", pow_value=50, current_hp=12)
    pool.spend_mp(3)
    path = pool.save(campaign)
    assert path.exists()
    data = json.loads(path.read_text())
    assert data["mp"] == 7
    assert data["mp_max"] == 10
    assert data["current_hp"] == 12


def test_save_merges_with_existing_snapshot(campaign):
    """save() must not clobber other fields already in the mp-state file."""
    path = campaign / "save" / "mp-state" / "inv1.json"
    path.write_text(json.dumps({"investigator_id": "inv1", "note": "keep-me"}))
    pool = MPool("inv1", pow_value=50)
    pool.save(campaign)
    data = json.loads(path.read_text())
    assert data["mp"] == 10
    assert data["note"] == "keep-me"  # preserved


def test_load_reconstructs_pool(tables, campaign):
    pool = MPool("inv1", pow_value=50, current_hp=12)
    pool.spend_mp(4)
    pool.save(campaign)
    loaded = MPool.load(tables, campaign, "inv1", pow_value=50)
    assert loaded.current_mp == 6
    assert loaded.mp_max == 10
    assert loaded.current_hp == 12


# --------------------------------------------------------------------------- #
# downtime integration: handle_time_trigger
# --------------------------------------------------------------------------- #
def test_handle_time_trigger_regenerates_and_persists(tables, campaign):
    # seed a depleted mp-state snapshot
    MPool("inv1", pow_value=50, current_hp=12).save(campaign)
    (campaign / "save" / "mp-state" / "inv1.json").write_text(json.dumps({
        "investigator_id": "inv1", "current_hp": 12, "mp": 2, "mp_max": 10,
    }))
    gained = handle_time_trigger(
        tables, campaign, "inv1", pow_value=50, delta_minutes=480, source="sleep_night"
    )
    assert gained == 8  # 8 hours * 1/hr, capped at 10 -> gained 8
    data = json.loads((campaign / "save" / "mp-state" / "inv1.json").read_text())
    assert data["mp"] == 10


def test_handle_time_trigger_zero_minutes_is_noop(tables, campaign):
    (campaign / "save" / "mp-state" / "inv1.json").write_text(json.dumps({
        "investigator_id": "inv1", "mp": 5, "mp_max": 10}))
    gained = handle_time_trigger(
        tables, campaign, "inv1", pow_value=50, delta_minutes=0)
    assert gained == 0
