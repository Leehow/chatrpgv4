#!/usr/bin/env python3
"""Tests for the magic casting + learning engine (coc_magic.py).

Validates Chapter 9 (pp.176-179):
- First PC cast: Hard POW roll (success/failure).
- NPC cast: auto-success.
- Subsequent PC cast: auto-success.
- Pushed cast: MP x1D6, HP overspill, spell always works.
- Learning: Hard INT roll, 2D6 weeks (tome) / 1D8 days (person).
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


coc_magic = _load("coc_magic", "coc_magic.py")
coc_mp = _load("coc_mp", "coc_mp.py")
coc_rules = _load("coc_rules", "coc_rules.py")


# --------------------------------------------------------------------------- #
# cast_spell -- first cast (Hard POW)
# --------------------------------------------------------------------------- #
def test_first_cast_success_on_hard_pow():
    # POW 60 -> hard target 30. Force a roll <= 30 -> success.
    rng = random.Random(1)  # randint(1,100); try a few seeds for a low roll
    for seed in range(1, 200):
        rng = random.Random(seed)
        # peek the roll this seed would produce via percentile_check
        probe = coc_magic.coc_roll.percentile_check(60, difficulty="hard", rng=random.Random(seed))
        if probe["roll"] <= 30:
            rng = random.Random(seed)
            break
    state = {"pow": 60, "current_mp": 20, "current_hp": 12, "current_san": 70}
    res = coc_magic.cast_spell("Cloud Memory", state, is_first_cast=True, rng=random.Random(seed))
    assert res["is_first_cast"] is True
    assert res["is_npc"] is False
    assert res["roll_result"] is not None
    assert res["success"] is True
    assert res["pushed"] is False


def test_first_cast_failure_on_high_roll():
    # Find a seed whose roll > hard target (POW 60 -> target 30).
    seed = None
    for s in range(1, 400):
        probe = coc_magic.coc_roll.percentile_check(60, difficulty="hard", rng=random.Random(s))
        if probe["roll"] > 30:
            seed = s
            break
    assert seed is not None
    state = {"pow": 60, "current_mp": 20, "current_hp": 12, "current_san": 70}
    res = coc_magic.cast_spell("Cloud Memory", state, is_first_cast=True, rng=random.Random(seed))
    assert res["success"] is False
    assert res["roll_result"]["outcome"] not in ("regular", "hard", "extreme", "critical")
    # Failed first cast loses no SAN/MP beyond the base (none charged on fail).
    assert res["san_lost"] == 0


# --------------------------------------------------------------------------- #
# cast_spell -- NPC caster
# --------------------------------------------------------------------------- #
def test_npc_cast_auto_success_no_roll():
    state = {"pow": 20, "current_mp": 30, "current_hp": 14, "current_san": 60}
    res = coc_magic.cast_spell("Cloud Memory", state, is_first_cast=True,
                               is_npc=True, rng=random.Random(7))
    assert res["success"] is True
    assert res["roll_result"] is None  # no roll for NPC
    assert res["is_npc"] is True


# --------------------------------------------------------------------------- #
# cast_spell -- subsequent cast (auto-success)
# --------------------------------------------------------------------------- #
def test_subsequent_cast_auto_success():
    state = {"pow": 60, "current_mp": 20, "current_hp": 12, "current_san": 70}
    res = coc_magic.cast_spell("Cloud Memory", state, is_first_cast=False,
                               rng=random.Random(3))
    assert res["success"] is True
    assert res["roll_result"] is None
    assert res["is_first_cast"] is False


# --------------------------------------------------------------------------- #
# cast_spell -- MP deduction via inline state
# --------------------------------------------------------------------------- #
def test_cast_deducts_mp_from_state():
    # Cloud Memory cost_mp = 1D6 (range 1..6).
    state = {"pow": 60, "current_mp": 10, "current_hp": 12, "current_san": 70}
    res = coc_magic.cast_spell("Cloud Memory", state, is_first_cast=False,
                               rng=random.Random(5))
    assert 1 <= res["mp_spent"] <= 6
    assert state["current_mp"] == 10 - res["mp_spent"]
    assert res["hp_damage"] == 0


def test_cast_overspills_mp_to_hp():
    """When MP goes negative, overspill damages HP 1-for-1 (p.137)."""
    # Cloud Memory cost_mp = 1D6; only 2 MP available -> overspill = cost - 2.
    state = {"pow": 60, "current_mp": 2, "current_hp": 12, "current_san": 70}
    res = coc_magic.cast_spell("Cloud Memory", state, is_first_cast=False,
                               rng=random.Random(5))
    expected = max(0, res["mp_spent"] - 2)
    assert state["current_mp"] == 0
    assert res["hp_damage"] == expected
    assert state["current_hp"] == 12 - expected


def test_cast_deducts_san_on_success():
    # Use a spell with a concrete SAN cost. "Breath of the Deep" cost_sanity 1D6.
    state = {"pow": 60, "current_mp": 20, "current_hp": 12, "current_san": 70}
    res = coc_magic.cast_spell("Breath of the Deep", state, is_first_cast=False,
                               rng=random.Random(9))
    assert res["success"] is True
    assert res["san_lost"] >= 1
    assert state["current_san"] == 70 - res["san_lost"]


def test_cast_zero_mp_spell_spends_nothing():
    # "Bless Blade" cost_mp = 0.
    state = {"pow": 60, "current_mp": 5, "current_hp": 12, "current_san": 70}
    res = coc_magic.cast_spell("Bless Blade", state, is_first_cast=False,
                               rng=random.Random(2))
    assert res["mp_spent"] == 0
    assert state["current_mp"] == 5


# --------------------------------------------------------------------------- #
# cast_spell -- pushed cast
# --------------------------------------------------------------------------- #
def test_pushed_cast_multiplies_mp_by_1d6():
    """Pushed cast: base MP x 1D6 multiplier, with HP overspill."""
    # Breath of the Deep cost_mp = 8 (fixed). Multiplier is 1D6.
    state = {"pow": 60, "current_mp": 100, "current_hp": 12, "current_san": 70}
    res = coc_magic.cast_spell("Breath of the Deep", state, is_first_cast=False,
                               pushed=True, rng=random.Random(11))
    assert res["pushed"] is True
    # base 8 * multiplier(1..6) -> mp_spent in {8,16,24,32,40,48}
    assert res["base_mp_cost"] == 8
    assert res["mp_spent"] in {8, 16, 24, 32, 40, 48}
    assert res["mp_spent"] % 8 == 0


def test_pushed_cast_overspills_to_hp():
    # Force overspill: small MP pool, pushed multiplies cost.
    state = {"pow": 60, "current_mp": 2, "current_hp": 14, "current_san": 70}
    res = coc_magic.cast_spell("Breath of the Deep", state, is_first_cast=False,
                               pushed=True, rng=random.Random(4))
    assert res["pushed"] is True
    assert res["hp_damage"] >= 1
    assert state["current_mp"] == 0


def _seed_for_hard_pow(pow_value: int, *, succeed: bool) -> int:
    """Find an RNG seed whose Hard POW percentile outcome matches succeed."""
    target = pow_value // 2
    for s in range(1, 800):
        probe = coc_magic.coc_roll.percentile_check(
            pow_value, difficulty="hard", rng=random.Random(s)
        )
        ok = probe["roll"] <= target
        if ok == succeed:
            return s
    raise AssertionError("no suitable seed found")


def test_pushed_cast_failure_multiplies_san_and_rolls_side_effect():
    """Failed pushed cast (p.178-179): MP×1D6, SAN×1D6, plus 1D8 side-effect."""
    # Breath of the Deep: cost_mp=8, cost_sanity=1D6. No tier field → minor (mp<10).
    seed = _seed_for_hard_pow(60, succeed=False)
    state = {"pow": 60, "current_mp": 100, "current_hp": 12, "current_san": 70}
    res = coc_magic.cast_spell(
        "Breath of the Deep", state, is_first_cast=True,
        pushed=True, rng=random.Random(seed),
    )
    assert res["pushed"] is True
    assert res["success"] is False
    assert res["mp_spent"] in {8, 16, 24, 32, 40, 48}
    # SAN cost (1D6) × same push multiplier as MP.
    multiplier = res["mp_spent"] // 8
    assert 1 <= multiplier <= 6
    assert res["san_lost"] >= 1
    assert res["san_lost"] % multiplier == 0 or multiplier == 1
    base_san = res["san_lost"] // multiplier
    assert 1 <= base_san <= 6
    assert state["current_san"] == 70 - res["san_lost"]
    se = res["side_effect"]
    assert se["tier"] == "minor"
    assert 1 <= se["roll"] <= 8
    assert isinstance(se["effect"], str) and se["effect"]


def test_pushed_cast_failure_major_tier_when_mp_cost_ge_10():
    """No push_tier field: resolved mp_cost >= 10 → major side-effect table."""
    # Apportion Ka: cost_mp=10 → major tier.
    seed = _seed_for_hard_pow(60, succeed=False)
    state = {"pow": 60, "current_mp": 200, "current_hp": 12, "current_san": 70}
    res = coc_magic.cast_spell(
        "Apportion Ka", state, is_first_cast=True,
        pushed=True, rng=random.Random(seed),
    )
    assert res["success"] is False
    assert res["side_effect"]["tier"] == "major"
    assert 1 <= res["side_effect"]["roll"] <= 8


def test_pushed_cast_success_has_no_side_effect_table():
    """Successful pushed cast still multiplies MP but skips the side-effect table."""
    seed = _seed_for_hard_pow(60, succeed=True)
    state = {"pow": 60, "current_mp": 100, "current_hp": 12, "current_san": 70}
    res = coc_magic.cast_spell(
        "Breath of the Deep", state, is_first_cast=True,
        pushed=True, rng=random.Random(seed),
    )
    assert res["success"] is True
    assert res["pushed"] is True
    assert res.get("side_effect") is None
    assert res["mp_spent"] in {8, 16, 24, 32, 40, 48}


# --------------------------------------------------------------------------- #
# cast_spell -- interruption (p.178)
# --------------------------------------------------------------------------- #
def test_interrupted_cast_fails_loses_committed_mp_no_side_effect():
    state = {"pow": 60, "current_mp": 20, "current_hp": 12, "current_san": 70}
    res = coc_magic.cast_spell(
        "Breath of the Deep", state, is_first_cast=True,
        interrupted=True, rng=random.Random(3),
    )
    assert res["interrupted"] is True
    assert res["success"] is False
    assert res["mp_spent"] == 8  # base cost committed and lost
    assert state["current_mp"] == 12
    assert res.get("side_effect") is None
    assert res["san_lost"] == 0  # no SAN multiplier / no success SAN


def test_interrupted_pushed_cast_skips_side_effect_and_san_multiplier():
    """Interrupted takes precedence: no side-effect table, no SAN×1D6."""
    state = {"pow": 60, "current_mp": 100, "current_hp": 12, "current_san": 70}
    res = coc_magic.cast_spell(
        "Breath of the Deep", state, is_first_cast=True,
        pushed=True, interrupted=True, rng=random.Random(99),
    )
    assert res["interrupted"] is True
    assert res["success"] is False
    assert res.get("side_effect") is None
    assert res["san_lost"] == 0
    assert state["current_san"] == 70


# --------------------------------------------------------------------------- #
# cast_spell -- POW cost settlement
# --------------------------------------------------------------------------- #
def test_cast_deducts_pow_when_spell_has_cost_pow():
    # Bless Blade: cost_mp=0, cost_pow=5.
    state = {"pow": 60, "current_mp": 10, "current_hp": 12, "current_san": 70}
    res = coc_magic.cast_spell(
        "Bless Blade", state, is_first_cast=False, rng=random.Random(2),
    )
    assert res["success"] is True
    assert res["pow_spent"] == 5
    assert state["pow"] == 55


def test_cast_pow_spent_zero_when_no_pow_cost():
    state = {"pow": 60, "current_mp": 20, "current_hp": 12, "current_san": 70}
    res = coc_magic.cast_spell(
        "Breath of the Deep", state, is_first_cast=False, rng=random.Random(5),
    )
    assert res["pow_spent"] == 0
    assert state["pow"] == 60


# --------------------------------------------------------------------------- #
# cast_spell -- MP via coc_mp.MPool
# --------------------------------------------------------------------------- #
def test_cast_uses_mpool_when_provided():
    pool = coc_mp.MPool("inv1", pow_value=60, current_hp=12)  # mp_max=12
    state = {"pow": 60, "current_san": 70}
    res = coc_magic.cast_spell("Breath of the Deep", state, is_first_cast=False,
                               rng=random.Random(5), mp_pool=pool)
    assert res["mp_spent"] == 8
    assert pool.current_mp == 4  # 12 - 8
    assert res["hp_damage"] == 0


def test_cast_mpool_overspills_to_hp():
    pool = coc_mp.MPool("inv1", pow_value=20, current_hp=12)  # mp_max=4
    state = {"pow": 20, "current_san": 70}
    # Breath of the Deep cost 8, pool only has 4 MP -> 4 overspill -> 4 HP dmg.
    res = coc_magic.cast_spell("Breath of the Deep", state, is_first_cast=False,
                               rng=random.Random(5), mp_pool=pool)
    assert pool.current_mp == 0
    assert res["hp_damage"] == 4


# --------------------------------------------------------------------------- #
# learn_spell
# --------------------------------------------------------------------------- #
def test_learn_spell_hard_int_success_tome():
    # Find a seed where INT(hard) succeeds (INT 70 -> target 35).
    seed = None
    for s in range(1, 400):
        probe = coc_magic.coc_roll.percentile_check(70, difficulty="hard", rng=random.Random(s))
        if probe["roll"] <= 35:
            seed = s
            break
    assert seed is not None
    state = {"int": 70}
    res = coc_magic.learn_spell("Cloud Memory", state, source="tome",
                                rng=random.Random(seed))
    assert res["learned"] is True
    assert res["source"] == "tome"
    assert 2 <= res["study_weeks"] <= 12  # 2D6
    assert res["study_days"] == res["study_weeks"] * 7
    assert res["completion_trigger_id"] is None  # no campaign_dir


def test_learn_spell_hard_int_failure():
    seed = None
    for s in range(1, 400):
        probe = coc_magic.coc_roll.percentile_check(70, difficulty="hard", rng=random.Random(s))
        if probe["roll"] > 35:
            seed = s
            break
    assert seed is not None
    state = {"int": 70}
    res = coc_magic.learn_spell("Cloud Memory", state, source="tome",
                                rng=random.Random(seed))
    assert res["learned"] is False
    assert res["study_weeks"] == 0  # not learned -> no study time


def test_learn_spell_from_person_uses_days():
    # Find a success seed.
    seed = None
    for s in range(1, 400):
        probe = coc_magic.coc_roll.percentile_check(70, difficulty="hard", rng=random.Random(s))
        if probe["roll"] <= 35:
            seed = s
            break
    state = {"int": 70}
    res = coc_magic.learn_spell("Cloud Memory", state, source="person",
                                rng=random.Random(seed))
    assert res["learned"] is True
    assert res["study_weeks"] == 0  # person study is in days, not weeks
    assert 1 <= res["study_days"] <= 8  # 1D8


def test_learn_spell_from_entity_returns_san_floor():
    """Entity-taught spells: SAN floor from learning.from_entity_min_sanity_cost."""
    seed = None
    for s in range(1, 400):
        probe = coc_magic.coc_roll.percentile_check(70, difficulty="hard", rng=random.Random(s))
        if probe["roll"] <= 35:
            seed = s
            break
    assert seed is not None
    state = {"int": 70}
    res = coc_magic.learn_spell(
        "Cloud Memory", state, source="entity", rng=random.Random(seed),
    )
    assert res["learned"] is True
    assert res["source"] == "entity"
    assert res["san_cost_expr"] == "1D6"  # learning.from_entity_min_sanity_cost
    assert res["study_weeks"] == 0
    assert res["study_days"] == 0  # entity teaching has no study delay


def test_learn_spell_invalid_source_raises():
    state = {"int": 70}
    with pytest.raises(ValueError):
        coc_magic.learn_spell("Cloud Memory", state, source="tablet",
                              rng=random.Random(1))


# --------------------------------------------------------------------------- #
# learn_spell -- coc_time completion trigger
# --------------------------------------------------------------------------- #
@pytest.fixture
def campaign(tmp_path):
    camp = tmp_path / "campaign"
    (camp / "save").mkdir(parents=True)
    (camp / "logs").mkdir(parents=True)
    return camp


def test_learn_spell_schedules_completion_trigger(campaign):
    # Find a success seed.
    seed = None
    for s in range(1, 400):
        probe = coc_magic.coc_roll.percentile_check(70, difficulty="hard", rng=random.Random(s))
        if probe["roll"] <= 35:
            seed = s
            break
    state = {"int": 70}
    res = coc_magic.learn_spell("Cloud Memory", state, source="tome",
                                rng=random.Random(seed), campaign_dir=campaign)
    assert res["learned"] is True
    assert res["completion_trigger_id"] is not None
    # The trigger was persisted in save/time-triggers.json.
    import json
    trig_path = campaign / "save" / "time-triggers.json"
    assert trig_path.exists()
    data = json.loads(trig_path.read_text())
    ids = [t.get("trigger_id") for t in data.get("triggers", [])]
    assert res["completion_trigger_id"] in ids


def test_learn_spell_failure_schedules_no_trigger(campaign):
    seed = None
    for s in range(1, 400):
        probe = coc_magic.coc_roll.percentile_check(70, difficulty="hard", rng=random.Random(s))
        if probe["roll"] > 35:
            seed = s
            break
    state = {"int": 70}
    res = coc_magic.learn_spell("Cloud Memory", state, source="tome",
                                rng=random.Random(seed), campaign_dir=campaign)
    assert res["learned"] is False
    assert res["completion_trigger_id"] is None


# --------------------------------------------------------------------------- #
# cast_spell -- record shape
# --------------------------------------------------------------------------- #
def test_cast_record_keys():
    state = {"pow": 60, "current_mp": 20, "current_hp": 12, "current_san": 70}
    res = coc_magic.cast_spell("Cloud Memory", state, is_first_cast=False,
                               rng=random.Random(1))
    for key in ("spell", "success", "pushed", "is_npc", "is_first_cast",
                "roll_result", "mp_spent", "hp_damage", "san_lost"):
        assert key in res, f"missing key: {key}"


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def test_resolve_mp_cost_dice_expression():
    rng = random.Random(0)
    # 1D4+3 -> 4..7
    val = coc_magic._resolve_mp_cost("1D4+3", rng)
    assert 4 <= val <= 7


def test_resolve_mp_cost_bare_int():
    assert coc_magic._resolve_mp_cost("8", random.Random(0)) == 8


def test_resolve_mp_cost_trailing_plus():
    # "6+" -> base 6 (variable spells assume single caster).
    assert coc_magic._resolve_mp_cost("6+", random.Random(0)) == 6


def test_resolve_sanity_cost_variable_is_zero():
    assert coc_magic._resolve_sanity_cost("variable", random.Random(0)) == 0
