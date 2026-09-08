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
# regen_mp: sub-hour advances bank a remainder instead of rounding up
# (defect #75 — see kernel/coc/rules/mp.py's `regen_mp` docstring for the
# rulebook citation). A hard `if gain < 1: gain = 1` floor used to hand out a
# free Magic point for ANY nonzero advance, so a keeper passing 5 minutes at a
# time gave the party free MP every turn. These assert the replacement: an
# advance under an hour earns nothing yet, the minutes are banked
# (`regen_remainder_minutes`), and a later advance that completes the hour
# pays out exactly what the elapsed time earned — no more, no less.
# --------------------------------------------------------------------------- #
def test_regen_under_an_hour_gains_nothing_yet():
    """Reverting the fix (`if gain < 1: gain = 1`) turns this red: a 5-minute
    advance would hand back 1 MP instead of 0."""
    pool = MPool("inv1", pow_value=60)  # mp_max=12, 1/hr
    pool.current_mp = 5
    gained = pool.regen_mp(5 / 60)
    assert gained == 0
    assert pool.current_mp == 5


def test_regen_under_an_hour_banks_the_minutes():
    pool = MPool("inv1", pow_value=60)
    assert pool.regen_remainder_minutes == 0
    pool.regen_mp(5 / 60)
    assert pool.regen_remainder_minutes == 5


def test_regen_banked_minutes_pay_out_once_an_hour_completes():
    """Two 30-minute advances in the same in-memory pool (no reload) must sum
    to exactly the one point a full hour earns — not two, not zero."""
    pool = MPool("inv1", pow_value=60)  # mp_max=12, 1/hr
    pool.current_mp = 0
    first = pool.regen_mp(30 / 60)
    assert first == 0
    assert pool.regen_remainder_minutes == 30
    second = pool.regen_mp(30 / 60)
    assert second == 1
    assert pool.current_mp == 1
    assert pool.regen_remainder_minutes == 0


def test_regen_banked_minutes_scale_with_high_pow_rate():
    """POW>100 regenerates 2/hr, so the banked hour is worth 2 points, not 1."""
    pool = MPool("inv1", pow_value=120)  # 2/hr
    pool.current_mp = 0
    pool.regen_mp(45 / 60)
    assert pool.current_mp == 0
    gained = pool.regen_mp(15 / 60)
    assert gained == 2
    assert pool.current_mp == 2


def test_regen_remainder_survives_save_and_load(tables, campaign):
    """The remainder must persist across a save/load cycle: `handle_time_trigger`
    loads a fresh MPool from disk on every call, so banked minutes that only
    lived on the in-memory instance would be lost between downtime triggers."""
    pool = MPool("inv1", pow_value=60, current_hp=12)
    pool.current_mp = 0
    pool.regen_mp(40 / 60)
    assert pool.regen_remainder_minutes == 40
    pool.save(campaign)

    reloaded = MPool.load(tables, campaign, "inv1", pow_value=60)
    assert reloaded.regen_remainder_minutes == 40
    gained = reloaded.regen_mp(20 / 60)  # 40 + 20 = 60 minutes -> exactly 1 hour
    assert gained == 1
    assert reloaded.current_mp == 1
    assert reloaded.regen_remainder_minutes == 0


def test_regen_remainder_does_not_let_the_cap_be_exceeded():
    """Banking minutes must not create a backdoor around the POW/5 ceiling:
    a huge advance still caps at mp_max regardless of how many whole hours
    it represents."""
    pool = MPool("inv1", pow_value=60)  # mp_max=12
    pool.current_mp = 11
    gained = pool.regen_mp(10)  # 10 hours * 1/hr = 10, would overshoot to 21
    assert gained == 1
    assert pool.current_mp == 12


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
