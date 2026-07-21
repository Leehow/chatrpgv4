#!/usr/bin/env python3
"""coc7 ruleset resolver (docs/ruleset-contract.md §4).

Thin wrapper over the existing CoC 7e execution modules in
``plugins/coc-keeper/scripts/`` — the reference implementation the contract
anticipates ("wraps the existing coc_rules.py / coc_roll.py / ... modules
rather than rewriting them"). No arithmetic is reimplemented here:

- ``check`` delegates to ``coc_roll.percentile_check``, the same canonical
  function toolbox ``rules.roll`` settles through.
- ``opposed`` runs both sides through ``percentile_check`` and applies the
  non-combat winner rule the toolbox ``rules.opposed`` handler applied
  inline (higher success level wins; ties favor the higher value).
- ``push_policy`` is the pushed-roll eligibility rule (only an ordinary
  failure, once) the toolbox enforced inline; it returns a verdict string
  and the handler keeps owning the error envelope.
- ``sanity_check`` composes ``check`` with SAN loss-expression settlement
  (``coc_sanity.validate_san_loss_expression`` + ``coc_roll.roll_expression``)
  exactly as the toolbox ``rules.sanity_check`` handler did inline.
- ``damage`` resolves integer/dice amounts and HP clamp arithmetic exactly
  as the toolbox ``rules.damage`` handler did inline; ``resource_delta``
  mirrors the same pool clamps for direct callers.
- ``roll_dice`` / ``luck_spend`` delegate to ``coc_roll.roll_expression`` /
  ``coc_roll.spend_luck``; ``cash_assets`` / ``build_scale`` delegate to the
  ``coc_rules`` lookups; ``skill_describe`` reads this package's own
  ``rules-json/skill-descriptions.json``.
- ``first_aid`` / ``medicine`` / ``weekly_recovery`` / ``dying_check`` build
  the canonical healing-chain command requests this package owns; the
  toolbox submits them to the shared subsystem executor unchanged (the
  executor is kernel machinery, not ruleset code).

Resolvers are pure functions of their inputs plus an injectable RNG: no
global state, no campaign I/O. State writes remain kernel-owned
(transactional, ``decision_id``-idempotent) in the toolbox layer. The toolbox
fetches this module through ``coc_rulesets.get_resolver(campaign)``.
"""
from __future__ import annotations

import importlib.util
import json
import random
import sys
from pathlib import Path
from typing import Any

PACKAGE_DIR = Path(__file__).resolve().parent
PLUGIN_ROOT = PACKAGE_DIR.parents[1]
SCRIPTS_DIR = PLUGIN_ROOT / "scripts"
RULES_DIR = PACKAGE_DIR / "rules-json"


def _load_sibling(name: str, filename: str):
    """Load one execution module from ``scripts/``, sharing one instance.

    Same pattern as the toolbox's own ``_load_sibling``: the first loader
    registers the module in ``sys.modules`` under its plain name, so the
    resolver and the toolbox always drive the *same* module object (kept
    monkeypatch-visible for tests, and identical dice/rule arithmetic).
    """
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, SCRIPTS_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


coc_roll = _load_sibling("coc_roll", "coc_roll.py")
coc_rules = _load_sibling("coc_rules", "coc_rules.py")
coc_sanity = _load_sibling("coc_sanity", "coc_sanity.py")

# Pool resources declared in manifest.json.
_RESOURCE_KEYS = frozenset({"hp", "san", "mp", "luck"})

_DIRECTIONS = frozenset({"loss", "gain"})


def check(
    target: int,
    difficulty: str = "regular",
    bonus: int = 0,
    penalty: int = 0,
    rng: random.Random | None = None,
) -> dict[str, Any]:
    """Resolve one percentile check end-to-end with a source-traceable receipt.

    Same signature and semantics as ``coc_roll.percentile_check`` (the
    function toolbox ``rules.roll`` settles through): dice, bonus/penalty
    netting, effective target arithmetic, and distinct required/achieved
    success levels. Deterministic given the injected RNG.
    """
    return coc_roll.percentile_check(target, difficulty, bonus, penalty, rng=rng)


def resource_delta(
    resource: str,
    current: int,
    amount: int | str,
    *,
    direction: str = "loss",
    maximum: int | None = None,
    rng: random.Random | None = None,
) -> dict[str, Any]:
    """Apply and validate arithmetic on one declared pool resource.

    Mirrors the toolbox application layer exactly: ``amount`` accepts an
    integer or a dice expression settled via ``coc_roll.roll_expression``
    (``rules.damage`` behavior); a loss clamps at 0 (``rules.sanity_check`` /
    ``rules.damage``); a gain clamps at ``maximum`` when one is supplied
    (``rules.damage`` heal). Returns the computed receipt only — persisting
    the new value stays with the kernel's transactional state tools.
    """
    if resource not in _RESOURCE_KEYS:
        raise ValueError(
            f"unknown resource {resource!r}; expected one of {sorted(_RESOURCE_KEYS)}"
        )
    if direction not in _DIRECTIONS:
        raise ValueError("direction must be 'loss' or 'gain'")
    if isinstance(current, bool) or not isinstance(current, int) or current < 0:
        raise ValueError("current must be a non-negative integer")
    if maximum is not None and (
        isinstance(maximum, bool) or not isinstance(maximum, int) or maximum < 0
    ):
        raise ValueError("maximum must be a non-negative integer")

    detail: dict[str, Any] | None = None
    if isinstance(amount, str):
        rolled = coc_roll.roll_expression(amount, rng=rng)
        value = max(0, int(rolled["total"]))
        detail = rolled
    elif isinstance(amount, bool) or not isinstance(amount, int):
        raise ValueError("amount must be an integer or a dice expression")
    else:
        value = abs(amount)

    if direction == "loss":
        after = max(0, current - value)
    else:
        after = min(maximum, current + value) if maximum is not None else current + value

    receipt: dict[str, Any] = {
        "ruleset_id": "coc7",
        "resource": resource,
        "direction": direction,
        "amount": value,
        "before": current,
        "after": after,
        "delta": after - current,
        "maximum": maximum,
    }
    if detail is not None:
        receipt["roll_detail"] = detail
    return receipt


def roll_dice(expression: str, *, rng: random.Random | None = None) -> dict[str, Any]:
    """Roll one arbitrary dice expression (toolbox ``rules.roll_dice``)."""
    return coc_roll.roll_expression(expression, rng=rng)


def opposed(
    investigator_target: int,
    opponent_value: int,
    *,
    rng: random.Random | None = None,
) -> dict[str, Any]:
    """Resolve one NON-COMBAT opposed check (toolbox ``rules.opposed``).

    Both sides settle through ``coc_roll.percentile_check`` at regular
    difficulty with no dice modifiers, in investigator-then-opponent RNG
    order. The winner rule is the one the toolbox handler applied inline:
    higher success level wins; tied levels favor the higher target value;
    tied double-failure has no winner.
    """
    mine = check(investigator_target, "regular", 0, 0, rng=rng)
    theirs = check(opponent_value, "regular", 0, 0, rng=rng)
    levels = {"fumble": 0, "failure": 0, "regular": 1, "hard": 2, "extreme": 3, "critical": 4}
    my_level = levels.get(str(mine["outcome"]), 0)
    their_level = levels.get(str(theirs["outcome"]), 0)
    if my_level != their_level:
        winner = "investigator" if my_level > their_level else "opponent"
    elif my_level == 0:
        winner = "none"
    else:
        winner = "investigator" if investigator_target >= opponent_value else "opponent"
    return {
        "investigator_roll": mine,
        "opponent_roll": theirs,
        "winner": winner,
    }


def push_policy(original_outcome: Any, already_pushed: bool) -> str | None:
    """Pushed-roll eligibility verdict (toolbox ``rules.push``).

    Returns ``None`` when the original check may be pushed, otherwise the
    violation message. The handler owns the error envelope; the ruleset owns
    the rule: only an ordinary failure may be pushed, and only once.
    """
    if original_outcome != "failure":
        return (
            "only an ordinary failed original check may be pushed; "
            "fumbles are final"
        )
    if already_pushed:
        return "the original check has already been pushed"
    return None


def _san_loss(expression: Any, rng: random.Random | None) -> tuple[int, dict[str, Any]]:
    """Settle one SAN loss expression (constant or NdM(+k)) with its detail."""
    text = str(expression if expression is not None else "0").strip()
    if text in ("0", ""):
        return 0, {"kind": "constant", "value": 0}
    spec = coc_sanity.validate_san_loss_expression(text)
    if spec["kind"] == "constant":
        return int(spec["value"]), spec
    rolled = coc_roll.roll_expression(
        f"{spec['count']}D{spec['sides']}" + (f"+{spec['modifier']}" if spec.get("modifier") else ""),
        rng=rng,
    )
    return int(rolled["total"]), {**spec, "rolls": rolled["rolls"], "total": rolled["total"]}


def sanity_check(
    current_san: int,
    loss_success: Any,
    loss_failure: Any,
    *,
    rng: random.Random | None = None,
) -> dict[str, Any]:
    """SAN check mechanics for toolbox ``rules.sanity_check``.

    Check-then-loss in that RNG order, exactly as the handler settled inline:
    regular-difficulty percentile check against current SAN; success levels
    regular/hard/extreme/critical avoid the failure loss expression; the loss
    clamps SAN at 0. State writes, trigger bookkeeping, and roll logging stay
    with the kernel handler.
    """
    settled = check(current_san, "regular", 0, 0, rng=rng)
    success = settled["outcome"] in ("regular", "hard", "extreme", "critical")
    loss, loss_detail = _san_loss(loss_success if success else loss_failure, rng)
    return {
        "check": settled,
        "success": success,
        "san_loss": loss,
        "loss_detail": loss_detail,
        "san_before": current_san,
        "san_after": max(0, current_san - loss),
    }


def damage(
    amount: Any,
    current_hp: int,
    max_hp: int,
    *,
    kind: str = "damage",
    rng: random.Random | None = None,
) -> dict[str, Any]:
    """HP damage/heal arithmetic for toolbox ``rules.damage``.

    Amount accepts an integer string or a dice expression, resolved exactly
    as the handler did inline (digit strings never hit the dice parser);
    damage clamps at 0, healing clamps at ``max_hp``. Condition transitions
    and state writes stay with the kernel handler.
    """
    if kind not in ("damage", "heal"):
        raise ValueError("kind must be damage or heal")
    raw = str(amount).strip()
    detail: dict[str, Any] | None = None
    if raw.lstrip("+-").isdigit():
        value = abs(int(raw))
    else:
        rolled = coc_roll.roll_expression(raw, rng=rng)
        value = max(0, int(rolled["total"]))
        detail = rolled
    after = (
        min(max_hp, current_hp + value)
        if kind == "heal"
        else max(0, current_hp - value)
    )
    return {
        "amount": value,
        "roll_detail": detail,
        "hp_before": current_hp,
        "hp_after": after,
        "max_hp": max_hp,
    }


def luck_spend(
    result: dict[str, Any],
    points: int,
    current_luck: int,
    *,
    roll_kind: str = "skill",
) -> dict[str, Any]:
    """Recompute one settled check after a Luck spend (toolbox ``rules.luck_spend``)."""
    return coc_roll.spend_luck(result, points, current_luck, roll_kind=roll_kind)


def build_scale(
    build: int | None = None,
    *,
    actor_build: int | None = None,
    target_build: int | None = None,
) -> dict[str, Any]:
    """Comparative build scale lookups (toolbox ``rules.build_scale``)."""
    data: dict[str, Any] = {}
    if build is not None:
        data["scale"] = coc_rules.build_scale_row(build)
    if actor_build is not None:
        data["comparison"] = coc_rules.compare_builds(actor_build, target_build)
    return data


def cash_assets(credit_rating: int, period: str = "1920s") -> dict[str, Any]:
    """Credit Rating to cash/assets/spending level (toolbox ``rules.cash_assets``)."""
    return coc_rules.cash_and_assets(credit_rating, period=period)


def skill_describe() -> dict[str, Any]:
    """This package's parsed ``rules-json/skill-descriptions.json`` catalog.

    Read-only; raises ``OSError``/``json.JSONDecodeError`` for an unreadable
    file so the toolbox handler keeps owning its error envelope.
    """
    return json.loads(
        (RULES_DIR / "skill-descriptions.json").read_text(encoding="utf-8")
    )


def first_aid(
    decision_id: str,
    skill_value: int,
    rescuer_id: str,
    *,
    pushed: bool = False,
    changed_method: str | None = None,
    failure_consequence: str | None = None,
) -> dict[str, Any]:
    """Build this package's canonical First Aid stabilize request.

    The toolbox submits the returned request to the shared subsystem
    executor unchanged; execution and state writes stay kernel-owned.
    """
    request: dict[str, Any] = {
        "kind": "stabilize",
        "command_id": f"{decision_id}-first-aid",
        "method": "first_aid",
        "skill_value": skill_value,
        "rescuer_id": rescuer_id,
        "pushed": pushed,
    }
    if pushed:
        request["changed_method"] = changed_method
        request["failure_consequence"] = failure_consequence
    return request


def medicine(decision_id: str, skill_value: int, rescuer_id: str) -> dict[str, Any]:
    """Build this package's canonical Medicine stabilize request."""
    return {
        "kind": "stabilize",
        "command_id": f"{decision_id}-medicine",
        "method": "medicine",
        "skill_value": skill_value,
        "rescuer_id": rescuer_id,
    }


def weekly_recovery(
    decision_id: str,
    complete_rest: bool,
    poor_environment: bool,
    *,
    medicine_skill_value: int | None = None,
    caregiver_id: str | None = None,
) -> dict[str, Any]:
    """Build this package's canonical major-wound weekly recovery request."""
    request: dict[str, Any] = {
        "kind": "weekly_recovery",
        "command_id": f"{decision_id}-weekly-recovery",
        "complete_rest": complete_rest,
        "poor_environment": poor_environment,
    }
    if medicine_skill_value is not None:
        request["medicine_skill_value"] = medicine_skill_value
        request["caregiver_id"] = caregiver_id
    return request


def dying_check(decision_id: str, clock_kind: str) -> dict[str, Any]:
    """Build this package's canonical CON death-clock tick request."""
    return {
        "kind": "dying_tick",
        "command_id": f"{decision_id}-dying-{clock_kind}",
        "clock_kind": clock_kind,
    }


def public_api_index() -> dict[str, dict[str, Any]]:
    """Discoverability of the operations this resolver supports (contract §4).

    Exposes the wrapped resolver operations plus the public helper index
    ``coc_roll`` already publishes for live-play tool discovery.
    """
    index: dict[str, dict[str, Any]] = {
        "check": {
            "aliases": ["percentile_check", "roll_percentile"],
            "signature": "check(target, difficulty='regular', bonus=0, penalty=0, rng=None)",
            "returns": "percentile check receipt with distinct required and achieved levels",
        },
        "resource_delta": {
            "aliases": [],
            "signature": (
                "resource_delta(resource, current, amount, "
                "direction='loss', maximum=None, rng=None)"
            ),
            "returns": "validated pool arithmetic receipt (no state write)",
        },
        "roll_dice": {
            "aliases": ["roll_expression"],
            "signature": "roll_dice(expression, rng=None)",
            "returns": "dice expression result with individual faces",
        },
        "opposed": {
            "aliases": ["opposed_check"],
            "signature": "opposed(investigator_target, opponent_value, rng=None)",
            "returns": "both percentile receipts plus the non-combat winner",
        },
        "push_policy": {
            "aliases": [],
            "signature": "push_policy(original_outcome, already_pushed)",
            "returns": "None when the check may be pushed, else the violation message",
        },
        "sanity_check": {
            "aliases": ["san_check"],
            "signature": "sanity_check(current_san, loss_success, loss_failure, rng=None)",
            "returns": "SAN check receipt with settled loss and before/after values",
        },
        "damage": {
            "aliases": ["hp_delta"],
            "signature": "damage(amount, current_hp, max_hp, kind='damage', rng=None)",
            "returns": "settled amount, optional dice detail, and clamped hp_after",
        },
        "luck_spend": {
            "aliases": ["spend_luck"],
            "signature": "luck_spend(result, points, current_luck, roll_kind='skill')",
            "returns": "recomputed result after spending Luck (p.99)",
        },
        "build_scale": {
            "aliases": [],
            "signature": "build_scale(build=None, actor_build=None, target_build=None)",
            "returns": "scale row and/or lift/throw comparison (Table XV, p.279)",
        },
        "cash_assets": {
            "aliases": [],
            "signature": "cash_assets(credit_rating, period='1920s')",
            "returns": "cash/assets/spending level and living standard",
        },
        "skill_describe": {
            "aliases": ["skill_descriptions"],
            "signature": "skill_describe()",
            "returns": "parsed skill-descriptions.json catalog for this package",
        },
        "first_aid": {
            "aliases": [],
            "signature": (
                "first_aid(decision_id, skill_value, rescuer_id, pushed=False, "
                "changed_method=None, failure_consequence=None)"
            ),
            "returns": "canonical stabilize request for the subsystem executor",
        },
        "medicine": {
            "aliases": [],
            "signature": "medicine(decision_id, skill_value, rescuer_id)",
            "returns": "canonical stabilize request for the subsystem executor",
        },
        "weekly_recovery": {
            "aliases": [],
            "signature": (
                "weekly_recovery(decision_id, complete_rest, poor_environment, "
                "medicine_skill_value=None, caregiver_id=None)"
            ),
            "returns": "canonical weekly recovery request for the subsystem executor",
        },
        "dying_check": {
            "aliases": [],
            "signature": "dying_check(decision_id, clock_kind)",
            "returns": "canonical dying-tick request for the subsystem executor",
        },
    }
    for name, entry in coc_roll.public_api_index().items():
        index.setdefault(name, entry)
    return index
