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


def test_credit_tier_super_rich():
    assert coc_rule_signals.read_credit_tier(credit_rating=95) == "super_rich"
