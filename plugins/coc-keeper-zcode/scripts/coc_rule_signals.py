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
