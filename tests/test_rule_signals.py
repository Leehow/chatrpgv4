"""Tests for coc_rule_signals: pure functions translating rule state to director signals.

These verify the translation layer (rule state -> director signal enums) in
isolation. No director, no scoring, no side effects.
"""
import importlib.util
import random

import pytest


def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, rel)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


coc_rule_signals = _load("coc_rule_signals", "plugins/coc-keeper/scripts/coc_rule_signals.py")


# --------------------------------------------------------------------------- #
# Task 1: HP / Sanity / Credit tier
# --------------------------------------------------------------------------- #
def test_hp_state_healthy():
    assert coc_rule_signals.read_hp_state(current_hp=12, max_hp=12, conditions=[]) == "healthy"


def test_hp_state_wounded():
    assert coc_rule_signals.read_hp_state(current_hp=8, max_hp=12, conditions=[]) == "wounded"


def test_hp_state_major_wound():
    assert coc_rule_signals.read_hp_state(current_hp=4, max_hp=12, conditions=["major_wound"]) == "major_wound"


def test_hp_state_dying():
    assert coc_rule_signals.read_hp_state(current_hp=0, max_hp=12, conditions=["major_wound", "dying"]) == "dying"


def test_hp_state_dead():
    assert coc_rule_signals.read_hp_state(current_hp=-2, max_hp=12, conditions=[]) == "dead"


def test_hp_state_zero_no_major_wound_is_unconscious_not_dead():
    # HP=0 alone (no major wound) -> unconscious, classified as wounded (not dying)
    assert coc_rule_signals.read_hp_state(current_hp=0, max_hp=12, conditions=[]) == "wounded"


def test_sanity_state_stable():
    assert coc_rule_signals.read_sanity_state(current_san=55, max_san=99, bout_active=False, lost_this_event=0) == "stable"


def test_sanity_state_shaken():
    assert coc_rule_signals.read_sanity_state(current_san=55, max_san=99, bout_active=False, lost_this_event=3) == "shaken"


def test_sanity_state_temp_insane():
    assert coc_rule_signals.read_sanity_state(current_san=55, max_san=99, bout_active=False, lost_this_event=5) == "temp_insane"


def test_sanity_state_bout_active():
    assert coc_rule_signals.read_sanity_state(current_san=55, max_san=99, bout_active=True, lost_this_event=5) == "bout_active"


def test_credit_tier_penniless():
    assert coc_rule_signals.read_credit_tier(credit_rating=0) == "penniless"


def test_credit_tier_poor():
    assert coc_rule_signals.read_credit_tier(credit_rating=5) == "poor"


def test_credit_tier_average():
    assert coc_rule_signals.read_credit_tier(credit_rating=30) == "average"


def test_credit_tier_wealthy():
    assert coc_rule_signals.read_credit_tier(credit_rating=65) == "wealthy"


def test_credit_tier_rich():
    assert coc_rule_signals.read_credit_tier(credit_rating=95) == "rich"


def test_credit_tier_super_rich():
    assert coc_rule_signals.read_credit_tier(credit_rating=99) == "super_rich"


# --------------------------------------------------------------------------- #
# Task 2: NPC reaction / Luck / Crit-Fumble / Stalled / Tension
# --------------------------------------------------------------------------- #
def test_npc_reaction_success_uses_higher_of_app_or_cr():
    # APP=45, CR=65 -> target=65; seeded rng rolls low -> helpful
    result = coc_rule_signals.roll_npc_reaction(
        app=45, credit_rating=65, rng=random.Random(100)
    )
    assert result["used"] == "credit_rating"
    assert result["target"] == 65
    assert result["disposition"] == "helpful"


def test_npc_reaction_failure_hostile():
    # target=65; seeded rng rolls high (80) -> hostile
    result = coc_rule_signals.roll_npc_reaction(
        app=45, credit_rating=65, rng=random.Random(5)
    )
    assert result["disposition"] in ("neutral", "hostile")


def test_luck_signal_high():
    assert coc_rule_signals.read_luck_signal(current_luck=70, luck_spent_last=0) == ("high", False)


def test_luck_signal_depleted():
    assert coc_rule_signals.read_luck_signal(current_luck=5, luck_spent_last=20) == ("depleted", True)


def test_luck_signal_moderate_with_spend():
    level, spent = coc_rule_signals.read_luck_signal(current_luck=40, luck_spent_last=15)
    assert level == "moderate"
    assert spent is True


def test_critical_fumble_none():
    assert coc_rule_signals.read_critical_fumble(last_roll_outcome=None) == (False, False)


def test_critical_fumble_detects_critical():
    crit, fumble = coc_rule_signals.read_critical_fumble("critical")
    assert crit is True and fumble is False


def test_critical_fumble_detects_fumble():
    crit, fumble = coc_rule_signals.read_critical_fumble("fumble")
    assert crit is False and fumble is True


def test_stalled_turns_zero():
    assert coc_rule_signals.read_stalled_turns(recent_intent_classes=["investigate", "social"]) == 0


def test_stalled_turns_counts_idle():
    assert coc_rule_signals.read_stalled_turns(recent_intent_classes=["idle", "idle", "idle"]) == 3


def test_tension_clock_low():
    sig = coc_rule_signals.read_tension_clock(tension_level="low", lethal_chances_used=0)
    assert sig["tension_level"] == "low"
    assert sig["lethal_chances_used"] == 0
    assert sig["death_allowed"] is False


def test_tension_clock_death_allowed_after_3():
    sig = coc_rule_signals.read_tension_clock(tension_level="climax", lethal_chances_used=3)
    assert sig["death_allowed"] is True


# --------------------------------------------------------------------------- #
# Task 3: v2 translation functions (phobia / psychology / pushed / contacts)
# --------------------------------------------------------------------------- #
def test_phobia_penalty_active_when_insane_and_trigger_present():
    result = coc_rule_signals.read_phobia_penalty(insane=True, trigger_in_scene=True)
    assert result["penalty_die"] is True

def test_phobia_penalty_inactive_when_sane():
    result = coc_rule_signals.read_phobia_penalty(insane=False, trigger_in_scene=True)
    assert result["penalty_die"] is False

def test_psychology_concealed_returns_feed_direction():
    result = coc_rule_signals.read_psychology_concealed(skill_value=60, roll=34, npc_lying=True)
    assert result["feed_accurate"] is True
    result2 = coc_rule_signals.read_psychology_concealed(skill_value=60, roll=70, npc_lying=True)
    assert result2["feed_accurate"] is False  # failed → feed false read

def test_pushed_fail_pending():
    assert coc_rule_signals.read_pushed_fail_pending(is_pushed=True, outcome="failure") is True
    assert coc_rule_signals.read_pushed_fail_pending(is_pushed=False, outcome="failure") is False
    assert coc_rule_signals.read_pushed_fail_pending(is_pushed=True, outcome="success") is False

def test_contacts_difficulty_home_same_profession():
    assert coc_rule_signals.read_contacts_difficulty(home_ground=True, same_profession=True) == "regular"

def test_contacts_difficulty_foreign_remote():
    assert coc_rule_signals.read_contacts_difficulty(home_ground=False, same_profession=False) == "hard"


def test_bout_active_not_inferred_from_temporary_insane(tmp_path):
    """W0-5: temporary insanity (underlying phase, 1D10 hours) must NOT be
    conflated with an active bout (1D10 rounds, p.157)."""
    import json as _json
    inv = tmp_path / "save" / "investigator-state"
    inv.mkdir(parents=True)
    (inv / "h.json").write_text(_json.dumps({"temporary_insane": True}))
    sig = coc_rule_signals.read_sanity_engine_state(tmp_path, "h")
    assert sig["bout_active"] is False
    assert sig["temporary_insane"] is True


def test_bout_active_read_from_explicit_field(tmp_path):
    import json as _json
    inv = tmp_path / "save" / "investigator-state"
    inv.mkdir(parents=True)
    (inv / "h.json").write_text(_json.dumps({"bout_active": True}))
    sig = coc_rule_signals.read_sanity_engine_state(tmp_path, "h")
    assert sig["bout_active"] is True
