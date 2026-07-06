#!/usr/bin/env python3
"""Tests for firearm malfunction (Table XVII p.401) in coc_combat.

A firearm with a ``malfunction`` number jams when the attack roll >= that
number; the weapon becomes unusable until repaired. The event is recorded on
the turn and appended to the damage_chain.
"""
import importlib.util
import random

import pytest


def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, rel)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


coc_combat = _load("coc_combat", "plugins/coc-keeper/scripts/coc_combat.py")
coc_roll = _load("coc_roll", "plugins/coc-keeper/scripts/coc_roll.py")


# --------------------------------------------------------------------------- #
# Direct helper tests (no full combat round needed)
# --------------------------------------------------------------------------- #
def test_check_malfunction_returns_none_when_no_malfunction_field():
    rng = random.Random(1)
    s = coc_combat.CombatSession("m1", "sc", started_at_turn=1, rng=rng)
    s.add_participant("hero", "investigator", dex=70, combat_skill=60, build=0,
                      hp_max=10, weapons=[{"weapon_id": "club",
                                           "skill": "Fighting (Brawl)",
                                           "damage": "1D6", "impales": False}])
    weapon = s._weapon("hero", "club")
    # Melee weapon -> no malfunction field -> None
    ev = s._check_malfunction("hero", weapon, roll_value=100, turn_id="t1")
    assert ev is None


def test_check_malfunction_returns_none_when_roll_below_threshold():
    rng = random.Random(1)
    s = coc_combat.CombatSession("m2", "sc", started_at_turn=1, rng=rng)
    s.add_participant("hero", "investigator", dex=70, combat_skill=60, build=0,
                      hp_max=10, weapons=[{"weapon_id": "revolver_38",
                                           "skill": "Firearms (Handgun)",
                                           "damage": "1D8", "impales": True}])
    weapon = s._weapon("hero", "revolver_38")
    threshold = weapon.get("malfunction")
    assert threshold is not None  # catalog carries the field
    ev = s._check_malfunction("hero", weapon, roll_value=int(threshold) - 1,
                              turn_id="t1")
    assert ev is None
    assert len(s.jammed_weapons) == 0


def test_check_malfunction_jams_at_or_above_threshold():
    rng = random.Random(1)
    s = coc_combat.CombatSession("m3", "sc", started_at_turn=1, rng=rng)
    s.add_participant("hero", "investigator", dex=70, combat_skill=60, build=0,
                      hp_max=10, weapons=[{"weapon_id": "revolver_38",
                                           "skill": "Firearms (Handgun)",
                                           "damage": "1D8", "impales": True}])
    weapon = s._weapon("hero", "revolver_38")
    threshold = int(weapon["malfunction"])
    ev = s._check_malfunction("hero", weapon, roll_value=threshold, turn_id="t1")
    assert ev is not None
    assert ev["effect"] == "jammed_until_repaired"
    assert ev["malfunction_threshold"] == threshold
    assert "hero:revolver_38" in s.jammed_weapons
    # Appended to damage_chain for audit.
    assert s.damage_chain[-1] is ev or s.damage_chain[-1].get("weapon_id") == "revolver_38"


def test_check_malfunction_exact_equality_jams():
    """Roll exactly equal to the malfunction number jams (>= comparison)."""
    rng = random.Random(1)
    s = coc_combat.CombatSession("m4", "sc", started_at_turn=1, rng=rng)
    s.add_participant("hero", "investigator", dex=70, combat_skill=60, build=0,
                      hp_max=10, weapons=[{"weapon_id": "revolver_38",
                                           "skill": "Firearms (Handgun)",
                                           "damage": "1D8", "impales": True}])
    weapon = s._weapon("hero", "revolver_38")
    threshold = int(weapon["malfunction"])
    ev = s._check_malfunction("hero", weapon, roll_value=threshold, turn_id="t1")
    assert ev is not None


# --------------------------------------------------------------------------- #
# Integration: malfunction fires during _resolve_attack
# --------------------------------------------------------------------------- #
def _find_high_roll_seed(skill_value, difficulty, target_roll):
    """Find a seed whose percentile roll >= target_roll."""
    for seed in range(1, 2000):
        probe = coc_roll.percentile_check(skill_value, difficulty=difficulty,
                                          rng=random.Random(seed))
        if probe["roll"] >= target_roll:
            return seed
    pytest.skip(f"no seed produced roll >= {target_roll}")


def test_malfunction_fires_in_resolve_attack_on_high_roll():
    """When a firearm attack roll >= malfunction, the turn records a jam."""
    # revolver_38 malfunction is 96 (from Table XVII).
    catalog = coc_combat.resolve_module_weapons(None)
    malf = catalog["revolver_38"]["malfunction"]
    seed = _find_high_roll_seed(skill_value=60, difficulty="regular",
                                target_roll=int(malf))
    rng = random.Random(seed)
    s = coc_combat.CombatSession("m5", "sc", started_at_turn=1, rng=rng)
    s.add_participant("hero", "investigator", dex=70, combat_skill=60, build=0,
                      hp_max=10, weapons=[{"weapon_id": "revolver_38",
                                           "skill": "Firearms (Handgun)",
                                           "damage": "1D8", "impales": True}])
    s.add_participant("target", "monster", dex=10, combat_skill=5, build=0,
                      hp_max=12, weapons=[{"weapon_id": "claws",
                                           "skill": "Fighting",
                                           "damage": "1D3", "impales": False}])
    s.begin_round()
    turn = s.declare_and_resolve_turn(
        "hero", "shoot the target", "attack",
        target_actor_id="target", defense_kind="none", weapon_id="revolver_38")
    assert "malfunction" in turn
    assert turn["malfunction"]["effect"] == "jammed_until_repaired"
    assert "hero:revolver_38" in s.jammed_weapons


def test_malfunction_does_not_fire_on_low_roll():
    """When the attack roll is below the malfunction number, no jam."""
    catalog = coc_combat.resolve_module_weapons(None)
    malf = int(catalog["revolver_38"]["malfunction"])
    # Find a seed with a low roll (well below the threshold).
    seed = None
    for s2 in range(1, 2000):
        probe = coc_roll.percentile_check(60, difficulty="regular",
                                          rng=random.Random(s2))
        if probe["roll"] < 50:  # comfortably below any malfunction (>=95)
            seed = s2
            break
    assert seed is not None
    rng = random.Random(seed)
    s = coc_combat.CombatSession("m6", "sc", started_at_turn=1, rng=rng)
    s.add_participant("hero", "investigator", dex=70, combat_skill=60, build=0,
                      hp_max=10, weapons=[{"weapon_id": "revolver_38",
                                           "skill": "Firearms (Handgun)",
                                           "damage": "1D8", "impales": True}])
    s.add_participant("target", "monster", dex=10, combat_skill=5, build=0,
                      hp_max=12, weapons=[{"weapon_id": "claws",
                                           "skill": "Fighting",
                                           "damage": "1D3", "impales": False}])
    s.begin_round()
    turn = s.declare_and_resolve_turn(
        "hero", "shoot the target", "attack",
        target_actor_id="target", defense_kind="none", weapon_id="revolver_38")
    assert "malfunction" not in turn
    assert len(s.jammed_weapons) == 0


def test_jammed_weapons_set_initialized_empty():
    s = coc_combat.CombatSession("m7", "sc", started_at_turn=1,
                                 rng=random.Random(0))
    assert s.jammed_weapons == set()
