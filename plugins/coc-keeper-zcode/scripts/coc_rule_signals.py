#!/usr/bin/env python3
"""Pure functions translating Call of Cthulhu rule state into director signals.

These functions are read-only and side-effect-free. They take rule state
(hp, sanity, credit rating, etc.) and return signal enum values that the
story director uses in its scoring. Each function is independently testable.

Rulebook refs (Keeper Rulebook 40th Anniversary):
- HP states: p.119-120
- Sanity states: p.154-158
- Credit Rating tiers: p.45-47 (cash-assets.json)

Spec: docs/superpowers/specs/2026-07-05-story-director-design.md
"""
from __future__ import annotations

import json
import random
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
RULES_DIR = SCRIPT_DIR.parent / "references" / "rules-json"

# Sanity thresholds (rulebook p.155-156)
TEMP_INSANITY_LOSS_THRESHOLD = 5
INDEFINITE_INSANITY_DAILY_FRACTION = 0.2


def read_hp_state(current_hp: int, max_hp: int, conditions: list[str]) -> str:
    """Classify HP/wound state. Rulebook p.119-120.

    Returns: healthy | wounded | major_wound | dying | dead
    - dead: hp < 0
    - dying: hp == 0 AND major_wound in conditions (p.120)
    - major_wound: major_wound in conditions (damage >= half max hp, p.119)
    - wounded: hp < max_hp (but not in a critical state above)
    - healthy: hp == max_hp
    """
    if current_hp < 0:
        return "dead"
    if current_hp == 0 and "major_wound" in conditions:
        return "dying"
    if "major_wound" in conditions:
        return "major_wound"
    if current_hp < max_hp:
        return "wounded"
    return "healthy"


def read_sanity_state(current_san: int, max_san: int, bout_active: bool, lost_this_event: int) -> str:
    """Classify sanity state. Rulebook p.154-158.

    Returns: stable | shaken | temp_insane | indefinite_insane | bout_active
    - bout_active overrides everything (Keeper controls investigator, p.156)
    - temp_insane: lost >= 5 SAN from single source (p.155)
    - shaken: lost some SAN but below temp threshold
    - stable: no recent loss
    """
    if bout_active:
        return "bout_active"
    if lost_this_event >= TEMP_INSANITY_LOSS_THRESHOLD:
        return "temp_insane"
    if lost_this_event > 0:
        return "shaken"
    return "stable"


def read_credit_tier(credit_rating: int) -> str:
    """Map Credit Rating to living-standard tier. Rulebook p.45-47.

    Returns: penniless | poor | average | wealthy | rich | super_rich
    Tiers align with cash-assets.json living_standard values.
    """
    if credit_rating <= 0:
        return "penniless"
    if credit_rating <= 9:
        return "poor"
    if credit_rating <= 49:
        return "average"
    if credit_rating <= 89:
        return "wealthy"
    return "super_rich"


# --------------------------------------------------------------------------- #
# Task 2: NPC reaction / Luck / Crit-Fumble / Stalled / Tension
# --------------------------------------------------------------------------- #

def _load_sibling(name: str, filename: str):
    """Resolve a sibling script module without a package context."""
    import importlib.util
    spec = importlib.util.spec_from_file_location(name, SCRIPT_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_roll = _load_sibling("coc_roll", "coc_roll.py")


def roll_npc_reaction(app: int, credit_rating: int, rng: random.Random | None = None) -> dict[str, Any]:
    """Concealed APP/CR roll to set NPC disposition. Rulebook p.191.

    Use the higher of APP or Credit Rating as target (rulebook: "if you are
    unsure, use the higher of the two"). Roll 1D100; below half = helpful
    (positive, strong), below target = neutral (positive), above = hostile.
    Returns dict with used/target/roll/disposition.
    """
    rng = rng or random.Random()
    used = "credit_rating" if credit_rating >= app else "app"
    target = max(app, credit_rating)
    roll = rng.randint(1, 100)
    if roll <= target // 2:
        disposition = "helpful"
    elif roll <= target:
        disposition = "neutral"
    else:
        disposition = "hostile"
    return {"used": used, "target": target, "roll": roll, "disposition": disposition}


def read_luck_signal(current_luck: int, luck_spent_last: int) -> tuple[str, bool]:
    """Classify Luck level + whether player spent luck last turn. Rulebook p.99.

    Returns (level, spent_last) where level: high | moderate | low | depleted.
    Luck is a depleting tension clock; low-luck investigators attract
    misfortune (group-Luck rule).
    """
    if current_luck >= 60:
        level = "high"
    elif current_luck >= 30:
        level = "moderate"
    elif current_luck >= 10:
        level = "low"
    else:
        level = "depleted"
    return (level, luck_spent_last > 0)


def read_critical_fumble(last_roll_outcome: str | None) -> tuple[bool, bool]:
    """Detect critical (01) / fumble (96-100) from last roll outcome string.

    Returns (is_critical, is_fumble). Both drive mandatory director action
    (rulebook p.89): critical -> invent benefit; fumble -> invent immediate
    misfortune, cannot be negated by pushing.
    """
    if last_roll_outcome is None:
        return (False, False)
    return (last_roll_outcome == "critical", last_roll_outcome == "fumble")


def read_stalled_turns(recent_intent_classes: list[str]) -> int:
    """Count trailing idle/stuck turns from recent player intent classes.

    Used by the Idea Roll recovery valve (rulebook p.199). Director triggers
    RECOVER action when stalled >= 3.
    """
    count = 0
    for cls in reversed(recent_intent_classes):
        if cls in ("idle", "stuck"):
            count += 1
        else:
            break
    return count


def read_tension_clock(tension_level: str, lethal_chances_used: int) -> dict[str, Any]:
    """Read pacing/tension state. Rulebook p.198, p.209 (three chances).

    Returns dict with tension_level, lethal_chances_used, death_allowed.
    death_allowed only after 3+ lethal chances used (p.209 "give players up
    to three chances to avoid certain death").
    """
    return {
        "tension_level": tension_level,
        "lethal_chances_used": lethal_chances_used,
        "death_allowed": lethal_chances_used >= 3,
    }
