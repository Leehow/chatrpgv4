"""Deliberately tiny non-CoC resolver for the public vertical contract."""
from __future__ import annotations

import random
from typing import Any


def validate_actor(sheet: dict[str, Any]) -> dict[str, Any]:
    if set(sheet) != {"name", "energy"}:
        raise ValueError("Spark actor sheet requires exactly name and energy")
    if not isinstance(sheet.get("name"), str) or not sheet["name"].strip():
        raise ValueError("Spark actor name must be non-empty")
    energy = sheet.get("energy")
    if isinstance(energy, bool) or not isinstance(energy, int) or energy < 0:
        raise ValueError("Spark actor energy must be a non-negative integer")
    return {
        "sheet": {"name": sheet["name"].strip()},
        "resources": {"energy": energy},
    }


def check(
    stat: int,
    skill: int,
    difficulty: int,
    *,
    rng: random.Random | None = None,
) -> dict[str, Any]:
    if any(isinstance(value, bool) or not isinstance(value, int) for value in (
        stat, skill, difficulty,
    )):
        raise ValueError("stat, skill, and difficulty must be integers")
    die = (rng or random.Random()).randint(1, 10)
    total = die + stat + skill
    success = total >= difficulty
    return {
        "label": "Spark check",
        "stat": stat,
        "skill": skill,
        "difficulty": difficulty,
        "target": difficulty,
        "outcome": "success" if success else "failure",
        "success": success,
        "roll": {
            "expression": f"1D10+{stat + skill}",
            "faces": [die],
            "total": total,
        },
    }


def resource_delta(
    resource: str,
    current: int,
    amount: int,
    *,
    direction: str = "spend",
    maximum: int | None = None,
    rng: random.Random | None = None,
) -> dict[str, Any]:
    del rng
    if resource != "energy":
        raise ValueError("resource must be 'energy'")
    if any(isinstance(value, bool) or not isinstance(value, int) for value in (
        current, amount,
    )):
        raise ValueError("current and amount must be integers")
    if current < 0 or amount < 0:
        raise ValueError("current and amount must be non-negative")
    if direction == "spend":
        after = max(0, current - amount)
    elif direction == "gain":
        after = current + amount
        if maximum is not None:
            after = min(maximum, after)
    else:
        raise ValueError("direction must be 'spend' or 'gain'")
    return {
        "resource": resource,
        "direction": direction,
        "amount": amount,
        "before": current,
        "after": after,
        "delta": after - current,
        "maximum": maximum,
    }


def public_api_index() -> dict[str, dict[str, str]]:
    return {
        "validate_actor": {"signature": "validate_actor(sheet)"},
        "check": {"signature": "check(stat, skill, difficulty, rng=None)"},
        "resource_delta": {
            "signature": "resource_delta(resource, current, amount, direction='spend', maximum=None, rng=None)"
        },
    }
