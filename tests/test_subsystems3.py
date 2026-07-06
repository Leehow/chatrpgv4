#!/usr/bin/env python3
"""Tests for Batch 3 subsystems:
1. Opposed-roll difficulty from opponent skill (p.83).
2. Mythos-Hardened SAN-loss halving (p.169).
3. Awfulness cap per creature type (p.169).
4. SAN reward at skill 90+ (p.95).
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


coc_rules = _load("coc_rules", "coc_rules.py")
coc_sanity = _load("coc_sanity", "coc_sanity.py")
coc_roll = _load("coc_roll", "coc_roll.py")


# --------------------------------------------------------------------------- #
# 1. Opposed-roll difficulty from opponent skill (p.83)
# --------------------------------------------------------------------------- #
def test_difficulty_from_opponent_below_50_is_regular():
    assert coc_rules.difficulty_from_opponent(30) == "regular"
    assert coc_rules.difficulty_from_opponent(49) == "regular"


def test_difficulty_from_opponent_50_to_89_is_hard():
    assert coc_rules.difficulty_from_opponent(50) == "hard"
    assert coc_rules.difficulty_from_opponent(75) == "hard"
    assert coc_rules.difficulty_from_opponent(89) == "hard"


def test_difficulty_from_opponent_90_plus_is_extreme():
    assert coc_rules.difficulty_from_opponent(90) == "extreme"
    assert coc_rules.difficulty_from_opponent(99) == "extreme"


def test_difficulty_from_opponent_zero_is_regular():
    assert coc_rules.difficulty_from_opponent(0) == "regular"


def test_difficulty_target_rejects_from_opponent():
    """from_opponent is a lookup block, not a divisor-based difficulty."""
    with pytest.raises(ValueError):
        coc_rules.difficulty_target(50, "from_opponent")


def test_difficulty_target_still_works_for_regular_hard_extreme():
    assert coc_rules.difficulty_target(60, "regular") == 60
    assert coc_rules.difficulty_target(60, "hard") == 30
    assert coc_rules.difficulty_target(60, "extreme") == 12


# --------------------------------------------------------------------------- #
# 2. Mythos-Hardened SAN-loss halving (p.169)
# --------------------------------------------------------------------------- #
def _san_session_with_cm(cm_value, san_current, int_value=60, san_max=70, rng_seed=1):
    """Build a SanitySession with a CM score and a seeded RNG."""
    rng = random.Random(rng_seed)
    s = coc_sanity.SanitySession("inv1", san_max=san_max, int_value=int_value,
                                 rng=rng, cm_value=cm_value)
    s.san_current = san_current
    return s


def _san_roll(session):
    """Return the SAN roll record (skill == 'SAN') from pending_rolls."""
    for r in reversed(session.pending_rolls):
        if r.get("skill") == "SAN":
            return r
    return session.pending_rolls[-1]


def test_mythos_hardened_halves_san_loss():
    """When CM > current SAN, SAN loss is halved (round down)."""
    # CM 30 > SAN 20 -> Mythos-Hardened. Force a failure losing 1D6.
    for seed in range(1, 500):
        s = _san_session_with_cm(cm_value=30, san_current=20, rng_seed=seed)
        s.sanity_check("deep one", san_loss_success=0,
                       san_loss_fail_expr="1D6", involuntary_kind="freeze")
        roll = _san_roll(s)
        if roll["outcome"] in ("failure", "fumble"):
            # Compare to a non-hardened session on the same seed.
            s2 = _san_session_with_cm(cm_value=0, san_current=20, rng_seed=seed)
            s2.sanity_check("deep one", san_loss_success=0,
                            san_loss_fail_expr="1D6", involuntary_kind="freeze")
            raw_loss = _san_roll(s2)["san_loss"]
            hardened_loss = roll["san_loss"]
            assert hardened_loss == raw_loss // 2
            assert roll["mythos_hardened"] is True
            return
    pytest.skip("no failure seed found")


def test_mythos_hardened_not_applied_when_cm_below_san():
    """When CM <= current SAN, no halving."""
    s = _san_session_with_cm(cm_value=10, san_current=50, rng_seed=5)
    s.sanity_check("deep one", san_loss_success=0,
                   san_loss_fail_expr="1D6", involuntary_kind="freeze")
    roll = _san_roll(s)
    # CM 10 < SAN 50 -> not hardened.
    assert roll["mythos_hardened"] is False


def test_mythos_hardened_rounds_down():
    """Halving rounds down (e.g. 5 -> 2)."""
    # CM 30 > SAN 20 -> hardened. Find a failure seed where raw loss is odd.
    for seed in range(1, 500):
        s2 = _san_session_with_cm(cm_value=0, san_current=20, rng_seed=seed)
        s2.sanity_check("deep one", san_loss_success=0,
                        san_loss_fail_expr="1D6", involuntary_kind="freeze")
        roll2 = _san_roll(s2)
        if roll2["outcome"] in ("failure", "fumble") and roll2["san_loss"] % 2 == 1:
            # Now run hardened on the same seed.
            s = _san_session_with_cm(cm_value=30, san_current=20, rng_seed=seed)
            s.sanity_check("deep one", san_loss_success=0,
                           san_loss_fail_expr="1D6", involuntary_kind="freeze")
            hardened = _san_roll(s)["san_loss"]
            assert hardened == roll2["san_loss"] // 2
            return
    pytest.skip("no odd-loss failure seed found")


# --------------------------------------------------------------------------- #
# 3. Awfulness cap per creature type (p.169)
# --------------------------------------------------------------------------- #
def test_awfulness_cap_tracks_cumulative_loss():
    """Repeated encounters with the same creature type cap at max possible loss."""
    # san_loss_success=1, san_loss_fail=1D4 -> max possible = 1 + 4 = 5.
    s = coc_sanity.SanitySession("inv1", san_max=99, int_value=60,
                                 rng=random.Random(7))
    s.sanity_current = 90
    # First encounter: lose some SAN.
    s.sanity_check("ghoul", san_loss_success=1, san_loss_fail_expr="1D4",
                   involuntary_kind="freeze", creature_type="ghoul")
    assert s.awfulness_caps.get("ghoul", 0) > 0


def test_awfulness_cap_zero_after_max_reached():
    """Once cumulative loss hits the cap, further losses are zero."""
    s = coc_sanity.SanitySession("inv1", san_max=99, int_value=60,
                                 rng=random.Random(3))
    s.san_current = 90
    # Pre-fill the cap to the max (success 1 + max fail 4 = 5).
    s.awfulness_caps["ghoul"] = 5
    before = s.san_current
    s.sanity_check("ghoul", san_loss_success=1, san_loss_fail_expr="1D4",
                   involuntary_kind="freeze", creature_type="ghoul")
    assert s.san_current == before  # no loss (capped out)


def test_awfulness_cap_independent_per_creature_type():
    s = coc_sanity.SanitySession("inv1", san_max=99, int_value=60,
                                 rng=random.Random(3))
    s.san_current = 90
    s.awfulness_caps["ghoul"] = 5  # ghoul capped
    before = s.san_current
    # A different creature type still loses SAN.
    s.sanity_check("deep_one", san_loss_success=1, san_loss_fail_expr="1D4",
                   involuntary_kind="freeze", creature_type="deep_one")
    assert s.san_current <= before
    assert s.awfulness_caps.get("deep_one", 0) > 0


def test_awfulness_cap_no_creature_type_does_not_track():
    """When creature_type is None, no awfulness tracking happens."""
    s = coc_sanity.SanitySession("inv1", san_max=99, int_value=60,
                                 rng=random.Random(2))
    s.san_current = 90
    s.sanity_check("horror", san_loss_success=1, san_loss_fail_expr="1D4",
                   involuntary_kind="freeze")
    assert s.awfulness_caps == {}


# --------------------------------------------------------------------------- #
# 4. SAN reward at skill 90+ (p.95)
# --------------------------------------------------------------------------- #
def test_sanity_reward_rule_block():
    rule = coc_rules.sanity_reward_rule()
    assert rule["reward"] == "2D6"
    assert "90" in rule["applies_when"]


def test_development_rule_includes_sanity_reward():
    rule = coc_rules.development_rule()
    assert "sanity_reward" in rule
    assert rule["sanity_reward"]["reward"] == "2D6"


def test_sanity_reward_grants_2d6_capped_at_max():
    """gain_san with a 2D6 reward cannot exceed san_max."""
    s = coc_sanity.SanitySession("inv1", san_max=70, int_value=60,
                                 rng=random.Random(1))
    s.san_current = 68
    # Simulate a 2D6 reward roll (2..12). Cap at san_max=70.
    dice = coc_roll.roll_expression("2D6", rng=random.Random(4))
    reward = int(dice["total"])
    s.gain_san(reward, source="skill_90_reward")
    assert s.san_current == 70  # capped


def test_sanity_reward_below_max_adds_full():
    s = coc_sanity.SanitySession("inv1", san_max=70, int_value=60,
                                 rng=random.Random(1))
    s.san_current = 50
    dice = coc_roll.roll_expression("2D6", rng=random.Random(4))
    reward = int(dice["total"])
    s.gain_san(reward, source="skill_90_reward")
    assert s.san_current == 50 + reward
