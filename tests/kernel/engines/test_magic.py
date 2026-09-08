"""Tests for the magic casting + learning engine (Chapter 9, pp.176-179). Ported
from the old tree's `tests/test_magic.py` (subject: `coc_magic.py`, now
`kernel/coc/rules/magic.py`).

Validates:
- First PC cast: Hard POW roll (success/failure).
- NPC cast: auto-success.
- Subsequent PC cast: auto-success.
- Pushed cast: MP x1D6, HP overspill, spell always works, push side-effects.
- Interrupted cast: mp paid and lost, no side-effect, no push SAN multiplier.
- Learning: Hard INT roll (entity: Regular INT), 2D6 weeks (tome) / 1D8 days
  (person), the entity SAN floor.

API changes from the port:
- `cast_spell` / `learn_spell` / `spell_by_name` / `push_side_effect_tables` now
  take explicit `tables: RuleTables` and (for spell lookup) `catalog: Catalog`
  arguments instead of reading a module-global `coc_rules` singleton -- spell
  name resolution moved out of `coc_rules.py` into `magic.resolve_spell_name`,
  consulting the catalog for parameterised/module-authored spells.
- `learn_spell` no longer owns study-completion scheduling: the old
  `campaign_dir` / `investigator_id` kwargs, the `coc_time` trigger it wrote to
  `save/time-triggers.json`, and the `completion_trigger_id` result key are all
  gone. Per the module docstring, "the kernel has one world clock
  (`world.clock.minutes`)" -- `learn_spell` now takes a plain `clock_minutes`
  and reports `study_completion_elapsed_minutes` directly; the settlement layer
  (not this engine) is responsible for persisting/dispatching it. The three old
  tests that drove the deleted trigger machinery
  (`test_learn_spell_schedules_completion_trigger`,
  `test_learn_spell_refuses_to_schedule_a_study_it_cannot_grant`,
  `test_learn_spell_failure_schedules_no_trigger`) are dropped; a replacement
  below exercises the new `clock_minutes` -> `study_completion_elapsed_minutes`
  contract directly.
"""

from __future__ import annotations

import random
import sys

import pytest
from conftest import CONTENT_DIR, KERNEL_DIR

sys.path.insert(0, str(KERNEL_DIR))

from coc.rules import percentile  # noqa: E402
from coc.rules.catalog import Catalog  # noqa: E402
from coc.rules.magic import (  # noqa: E402
    UnpricedSpellError,
    _resolve_mp_cost,
    _resolve_sanity_cost,
    cast_spell,
    learn_spell,
    push_side_effect_tables,
    spell_by_name,
)
from coc.rules.mp import MPool  # noqa: E402
from coc.rules.tables import RuleTables  # noqa: E402

RULES = CONTENT_DIR / "rulesets" / "coc7" / "rules-json"


@pytest.fixture(scope="module")
def tables() -> RuleTables:
    return RuleTables(RULES)


@pytest.fixture(scope="module")
def catalog(tables) -> Catalog:
    return Catalog(tables)


def _hard_pow_check(tables, pow_value, seed):
    return percentile.percentile_check(tables, pow_value, difficulty="hard", rng=random.Random(seed))


# --------------------------------------------------------------------------- #
# cast_spell -- first cast (Hard POW)
# --------------------------------------------------------------------------- #
def test_first_cast_success_on_hard_pow(tables, catalog):
    # POW 60 -> hard target 30. Find a seed whose roll <= 30 -> success.
    seed = None
    for s in range(1, 200):
        if _hard_pow_check(tables, 60, s)["roll"] <= 30:
            seed = s
            break
    assert seed is not None
    state = {"pow": 60, "current_mp": 20, "current_hp": 12, "current_san": 70}
    res = cast_spell(tables, catalog, "Cloud Memory", state, is_first_cast=True, rng=random.Random(seed))
    assert res["is_first_cast"] is True
    assert res["is_npc"] is False
    assert res["roll_result"] is not None
    assert res["success"] is True
    assert res["pushed"] is False


def test_first_cast_failure_on_high_roll(tables, catalog):
    seed = None
    for s in range(1, 400):
        if _hard_pow_check(tables, 60, s)["roll"] > 30:
            seed = s
            break
    assert seed is not None
    state = {"pow": 60, "current_mp": 20, "current_hp": 12, "current_san": 70}
    res = cast_spell(tables, catalog, "Cloud Memory", state, is_first_cast=True, rng=random.Random(seed))
    assert res["success"] is False
    assert res["roll_result"]["outcome"] not in ("regular", "hard", "extreme", "critical")
    # Failed first cast loses no SAN; its base MP was committed.
    assert res["san_lost"] == 0


# --------------------------------------------------------------------------- #
# cast_spell -- NPC caster
# --------------------------------------------------------------------------- #
def test_npc_cast_auto_success_no_roll(tables, catalog):
    state = {"pow": 20, "current_mp": 30, "current_hp": 14, "current_san": 60}
    res = cast_spell(tables, catalog, "Cloud Memory", state, is_first_cast=True,
                     is_npc=True, rng=random.Random(7))
    assert res["success"] is True
    assert res["roll_result"] is None  # no roll for NPC
    assert res["is_npc"] is True


# --------------------------------------------------------------------------- #
# cast_spell -- subsequent cast (auto-success)
# --------------------------------------------------------------------------- #
def test_subsequent_cast_auto_success(tables, catalog):
    state = {"pow": 60, "current_mp": 20, "current_hp": 12, "current_san": 70}
    res = cast_spell(tables, catalog, "Cloud Memory", state, is_first_cast=False, rng=random.Random(3))
    assert res["success"] is True
    assert res["roll_result"] is None
    assert res["is_first_cast"] is False


# --------------------------------------------------------------------------- #
# cast_spell -- MP deduction via inline state
# --------------------------------------------------------------------------- #
def test_cast_deducts_mp_from_state(tables, catalog):
    # Cloud Memory cost_mp = 1D6 (range 1..6).
    state = {"pow": 60, "current_mp": 10, "current_hp": 12, "current_san": 70}
    res = cast_spell(tables, catalog, "Cloud Memory", state, is_first_cast=False, rng=random.Random(5))
    assert 1 <= res["mp_spent"] <= 6
    assert state["current_mp"] == 10 - res["mp_spent"]
    assert res["hp_damage"] == 0


def test_cast_overspills_mp_to_hp(tables, catalog):
    """When MP goes negative, overspill damages HP 1-for-1 (p.137)."""
    state = {"pow": 60, "current_mp": 2, "current_hp": 12, "current_san": 70}
    res = cast_spell(tables, catalog, "Cloud Memory", state, is_first_cast=False, rng=random.Random(5))
    expected = max(0, res["mp_spent"] - 2)
    assert state["current_mp"] == 0
    assert res["hp_damage"] == expected
    assert state["current_hp"] == 12 - expected


def test_cast_deducts_san_on_success(tables, catalog):
    # "Breath of the Deep" cost_sanity 1D6.
    state = {"pow": 60, "current_mp": 20, "current_hp": 12, "current_san": 70}
    res = cast_spell(tables, catalog, "Breath of the Deep", state, is_first_cast=False, rng=random.Random(9))
    assert res["success"] is True
    assert res["san_lost"] >= 1
    assert state["current_san"] == 70 - res["san_lost"]


def test_cast_zero_mp_spell_spends_nothing(tables, catalog):
    # "Bless Blade" cost_mp = 0.
    state = {"pow": 60, "current_mp": 5, "current_hp": 12, "current_san": 70}
    res = cast_spell(tables, catalog, "Bless Blade", state, is_first_cast=False, rng=random.Random(2))
    assert res["mp_spent"] == 0
    assert state["current_mp"] == 5


# --------------------------------------------------------------------------- #
# cast_spell -- pushed cast
# --------------------------------------------------------------------------- #
def test_pushed_cast_multiplies_mp_by_1d6(tables, catalog):
    """Pushed cast: base MP x 1D6 multiplier, with HP overspill."""
    state = {"pow": 60, "current_mp": 100, "current_hp": 12, "current_san": 70}
    res = cast_spell(tables, catalog, "Breath of the Deep", state, is_first_cast=False,
                     pushed=True, rng=random.Random(11))
    assert res["pushed"] is True
    assert res["base_mp_cost"] == 8
    assert res["mp_spent"] in {8, 16, 24, 32, 40, 48}
    assert res["mp_spent"] % 8 == 0


def test_pushed_cast_overspills_to_hp(tables, catalog):
    state = {"pow": 60, "current_mp": 2, "current_hp": 14, "current_san": 70}
    res = cast_spell(tables, catalog, "Breath of the Deep", state, is_first_cast=False,
                     pushed=True, rng=random.Random(4))
    assert res["pushed"] is True
    assert res["hp_damage"] >= 1
    assert state["current_mp"] == 0


def _seed_for_hard_pow(tables, pow_value: int, *, succeed: bool) -> int:
    """Find an RNG seed whose Hard POW percentile outcome matches succeed."""
    target = pow_value // 2
    for s in range(1, 800):
        ok = _hard_pow_check(tables, pow_value, s)["roll"] <= target
        if ok == succeed:
            return s
    raise AssertionError("no suitable seed found")


def test_pushed_cast_failure_multiplies_san_and_rolls_side_effect(tables, catalog):
    """Failed pushed cast (p.178-179): MP x1D6, SAN x1D6, plus 1D8 side-effect."""
    seed = _seed_for_hard_pow(tables, 60, succeed=False)
    state = {"pow": 60, "current_mp": 100, "current_hp": 12, "current_san": 70}
    res = cast_spell(tables, catalog, "Breath of the Deep", state, is_first_cast=True,
                     pushed=True, rng=random.Random(seed))
    assert res["pushed"] is True
    assert res["success"] is True
    assert res["mp_spent"] in {8, 16, 24, 32, 40, 48}
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


def test_pushed_cast_failure_major_tier_when_mp_cost_ge_10(tables, catalog):
    """No push_tier field: resolved mp_cost >= 10 -> major side-effect table."""
    seed = _seed_for_hard_pow(tables, 60, succeed=False)
    state = {"pow": 60, "current_mp": 200, "current_hp": 12, "current_san": 70}
    res = cast_spell(tables, catalog, "Apportion Ka", state, is_first_cast=True,
                     pushed=True, rng=random.Random(seed))
    assert res["success"] is True
    assert res["side_effect"]["tier"] == "major"
    assert 1 <= res["side_effect"]["roll"] <= 8


def test_pushed_cast_success_has_no_side_effect_table(tables, catalog):
    """Successful pushed cast pays the ordinary attempt cost and has no side-effect."""
    seed = _seed_for_hard_pow(tables, 60, succeed=True)
    state = {"pow": 60, "current_mp": 100, "current_hp": 12, "current_san": 70}
    res = cast_spell(tables, catalog, "Breath of the Deep", state, is_first_cast=True,
                     pushed=True, rng=random.Random(seed))
    assert res["success"] is True
    assert res["pushed"] is True
    assert res.get("side_effect") is None
    assert res["mp_spent"] == 8


# --------------------------------------------------------------------------- #
# cast_spell -- interruption (p.178)
# --------------------------------------------------------------------------- #
def test_interrupted_cast_fails_loses_committed_mp_no_side_effect(tables, catalog):
    state = {"pow": 60, "current_mp": 20, "current_hp": 12, "current_san": 70}
    res = cast_spell(tables, catalog, "Breath of the Deep", state, is_first_cast=True,
                     interrupted=True, rng=random.Random(3))
    assert res["interrupted"] is True
    assert res["success"] is False
    assert res["mp_spent"] == 8  # base cost committed and lost
    assert state["current_mp"] == 12
    assert res.get("side_effect") is None
    assert res["san_lost"] >= 1
    assert state["current_san"] == 70 - res["san_lost"]


def test_interrupted_pushed_cast_skips_side_effect_and_san_multiplier(tables, catalog):
    """Interrupted takes precedence: no side-effect table, no SAN x1D6."""
    state = {"pow": 60, "current_mp": 100, "current_hp": 12, "current_san": 70}
    res = cast_spell(tables, catalog, "Breath of the Deep", state, is_first_cast=True,
                     pushed=True, interrupted=True, rng=random.Random(99))
    assert res["interrupted"] is True
    assert res["success"] is False
    assert res.get("side_effect") is None
    assert res["san_lost"] >= 1
    assert state["current_san"] == 70 - res["san_lost"]


# --------------------------------------------------------------------------- #
# cast_spell -- POW cost settlement
# --------------------------------------------------------------------------- #
def test_cast_deducts_pow_when_spell_has_cost_pow(tables, catalog):
    # Bless Blade: cost_mp=0, cost_pow=5.
    state = {"pow": 60, "current_mp": 10, "current_hp": 12, "current_san": 70}
    res = cast_spell(tables, catalog, "Bless Blade", state, is_first_cast=False, rng=random.Random(2))
    assert res["success"] is True
    assert res["pow_spent"] == 5
    assert state["pow"] == 55


def test_cast_pow_spent_zero_when_no_pow_cost(tables, catalog):
    state = {"pow": 60, "current_mp": 20, "current_hp": 12, "current_san": 70}
    res = cast_spell(tables, catalog, "Breath of the Deep", state, is_first_cast=False, rng=random.Random(5))
    assert res["pow_spent"] == 0
    assert state["pow"] == 60


# --------------------------------------------------------------------------- #
# cast_spell -- MP via MPool
# --------------------------------------------------------------------------- #
def test_cast_uses_mpool_when_provided(tables, catalog):
    pool = MPool("inv1", pow_value=60, current_hp=12)  # mp_max=12
    state = {"pow": 60, "current_san": 70}
    res = cast_spell(tables, catalog, "Breath of the Deep", state, is_first_cast=False,
                     rng=random.Random(5), mp_pool=pool)
    assert res["mp_spent"] == 8
    assert pool.current_mp == 4  # 12 - 8
    assert res["hp_damage"] == 0


def test_cast_mpool_overspills_to_hp(tables, catalog):
    pool = MPool("inv1", pow_value=20, current_hp=12)  # mp_max=4
    state = {"pow": 20, "current_san": 70}
    # Breath of the Deep cost 8, pool only has 4 MP -> 4 overspill -> 4 HP dmg.
    res = cast_spell(tables, catalog, "Breath of the Deep", state, is_first_cast=False,
                     rng=random.Random(5), mp_pool=pool)
    assert pool.current_mp == 0
    assert res["hp_damage"] == 4


# --------------------------------------------------------------------------- #
# learn_spell
# --------------------------------------------------------------------------- #
def test_learn_spell_hard_int_success_tome(tables, catalog):
    seed = None
    for s in range(1, 400):
        if _hard_pow_check(tables, 70, s)["roll"] <= 35:
            seed = s
            break
    assert seed is not None
    state = {"int": 70}
    res = learn_spell(tables, catalog, "Cloud Memory", state, source="tome", rng=random.Random(seed))
    assert res["learned"] is True
    assert res["source"] == "tome"
    assert 2 <= res["study_weeks"] <= 12  # 2D6
    assert res["study_days"] == res["study_weeks"] * 7
    assert res["study_completion_elapsed_minutes"] is None  # no clock_minutes given


def test_learn_spell_hard_int_failure(tables, catalog):
    seed = None
    for s in range(1, 400):
        if _hard_pow_check(tables, 70, s)["roll"] > 35:
            seed = s
            break
    assert seed is not None
    state = {"int": 70}
    res = learn_spell(tables, catalog, "Cloud Memory", state, source="tome", rng=random.Random(seed))
    assert res["learned"] is False
    assert res["study_weeks"] == 0  # not learned -> no study time


def test_learn_spell_from_person_uses_days(tables, catalog):
    seed = None
    for s in range(1, 400):
        if _hard_pow_check(tables, 70, s)["roll"] <= 35:
            seed = s
            break
    state = {"int": 70}
    res = learn_spell(tables, catalog, "Cloud Memory", state, source="person", rng=random.Random(seed))
    assert res["learned"] is True
    assert res["study_weeks"] == 0  # person study is in days, not weeks
    assert 1 <= res["study_days"] <= 8  # 1D8


def test_learn_spell_from_entity_returns_san_floor(tables, catalog):
    """Entity-taught spells: SAN floor from learning.from_entity_min_sanity_cost."""
    seed = None
    for s in range(1, 400):
        if _hard_pow_check(tables, 70, s)["roll"] <= 35:
            seed = s
            break
    assert seed is not None
    state = {"int": 70}
    res = learn_spell(tables, catalog, "Cloud Memory", state, source="entity", rng=random.Random(seed))
    assert res["learned"] is True
    assert res["source"] == "entity"
    assert res["san_cost_expr"] == "1D6"  # learning.from_entity_min_sanity_cost
    assert res["study_weeks"] == 0
    assert res["study_days"] == 0  # entity teaching has no study delay


def test_entity_learning_uses_regular_not_hard_int_success(tables, catalog):
    seed = next(
        value for value in range(1, 500)
        if 30 < percentile.percentile_check(tables, 60, difficulty="regular", rng=random.Random(value))["roll"] <= 60
    )
    state = {"int": 60, "current_san": 70}
    result = learn_spell(tables, catalog, "Cloud Memory", state, source="entity", rng=random.Random(seed))
    assert result["learned"] is True
    assert result["roll_result"]["difficulty"] == "regular"


def test_push_side_effect_tables_match_rulebook_rows(tables):
    side_effects = push_side_effect_tables(tables)
    assert side_effects["minor"][0]["effect"] == "Blurred vision or temporary blindness."
    assert side_effects["minor"][7]["effect"] == "Mythos monster is accidentally summoned."
    assert side_effects["major"][0]["effect"] == "Earth shaking, walls rent asunder."
    assert side_effects["major"][7]["effect"] == "Mythos deity is accidentally called."


def test_spell_by_name_success_and_missing_key(tables, catalog):
    """spell_by_name returns the row for a known spell and raises KeyError otherwise.
    Ported from the old tree's `tests/test_rules.py::test_spell_by_name_success_and_missing_key`
    -- the accessor moved from `coc_rules.py` into `magic.py` and now needs a `Catalog`."""
    row = spell_by_name(tables, catalog, "Flesh Ward")
    assert row["cost_sanity"] == "1D4"
    # #83: was 253, which is where nothing named Flesh Ward is printed. The entry's
    # heading and Cost block are on p.259; the old number came from an extraction
    # whose page counter drifted once the Gate sidebar interrupted the alphabet.
    assert row["source_page"] == 259

    row2 = spell_by_name(tables, catalog, "Dominate")
    assert row2["cost_mp"] == "1"

    with pytest.raises(KeyError):
        spell_by_name(tables, catalog, "Nonexistent Spell")


@pytest.mark.parametrize("spell", [
    "Mantle of Cthulhu", "Resurrection of Me", "Seal of Nyarlathotep",
    "See Invisible", "Steal Mind", "Summon Hellfire", "Swim Like a Fish",
    "Touch of Death", "True Seeing", "Walk the Path",
])
def test_unbacked_spells_are_not_in_production_catalog(tables, catalog, spell):
    with pytest.raises(KeyError):
        spell_by_name(tables, catalog, spell)


def test_learn_spell_invalid_source_raises(tables, catalog):
    state = {"int": 70}
    with pytest.raises(ValueError):
        learn_spell(tables, catalog, "Cloud Memory", state, source="tablet", rng=random.Random(1))


# --------------------------------------------------------------------------- #
# learn_spell -- world-clock completion minute (replaces the old coc_time trigger)
# --------------------------------------------------------------------------- #
def test_learn_spell_reports_completion_elapsed_minutes_from_clock(tables, catalog):
    """With `clock_minutes` given, a learned tome/person study reports the due
    elapsed minute directly; scheduling/dispatch is the settlement layer's job
    now, not this engine's (see module docstring)."""
    seed = None
    for s in range(1, 400):
        if _hard_pow_check(tables, 70, s)["roll"] <= 35:
            seed = s
            break
    assert seed is not None
    state = {"int": 70}
    res = learn_spell(tables, catalog, "Cloud Memory", state, source="tome",
                      rng=random.Random(seed), clock_minutes=1000)
    assert res["learned"] is True
    assert res["study_completion_elapsed_minutes"] == 1000 + res["study_days"] * 24 * 60


def test_learn_spell_failure_reports_no_completion_minute(tables, catalog):
    seed = None
    for s in range(1, 400):
        if _hard_pow_check(tables, 70, s)["roll"] > 35:
            seed = s
            break
    state = {"int": 70}
    res = learn_spell(tables, catalog, "Cloud Memory", state, source="tome",
                      rng=random.Random(seed), clock_minutes=1000)
    assert res["learned"] is False
    assert res["study_completion_elapsed_minutes"] is None


# --------------------------------------------------------------------------- #
# cast_spell -- record shape
# --------------------------------------------------------------------------- #
def test_cast_record_keys(tables, catalog):
    state = {"pow": 60, "current_mp": 20, "current_hp": 12, "current_san": 70}
    res = cast_spell(tables, catalog, "Cloud Memory", state, is_first_cast=False, rng=random.Random(1))
    for key in ("spell", "success", "pushed", "is_npc", "is_first_cast",
                "roll_result", "mp_spent", "hp_damage", "san_lost"):
        assert key in res, f"missing key: {key}"


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def test_resolve_mp_cost_dice_expression():
    rng = random.Random(0)
    # 1D4+3 -> 4..7
    val = _resolve_mp_cost("1D4+3", rng)
    assert 4 <= val <= 7


def test_resolve_mp_cost_bare_int():
    assert _resolve_mp_cost("8", random.Random(0)) == 8


def test_resolve_mp_cost_trailing_plus():
    # "6+" -> base 6 (variable spells assume single caster).
    assert _resolve_mp_cost("6+", random.Random(0)) == 6


def test_resolve_sanity_cost_variable_is_zero():
    assert _resolve_sanity_cost("variable", random.Random(0)) == 0
