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
INVESTIGATOR_CREATE_CONTRACT_PATH = PACKAGE_DIR / "investigator-create-contract.json"


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

_SOCIAL_APPROACH_SKILLS = {
    "charm": "Charm",
    "fast_talk": "Fast Talk",
    "intimidate": "Intimidate",
    "persuade": "Persuade",
}
_SOCIAL_DIFFICULTIES = ("regular", "hard", "extreme")
_PSYCHOLOGY_OPPOSING_SOCIAL_SKILLS = ("Charm", "Fast Talk", "Intimidate", "Persuade")
_PSYCHOLOGY_INFERENCE_DEPTHS = frozenset(
    {"deep_conflict", "motive_link", "immediate_intent", "uncertain"}
)
_PSYCHOLOGY_FAILURE_OUTCOMES = frozenset({"failure", "fumble"})
# Keeper Rulebook Psychology (10%) — pdf 83 / printed 72, block 48.
# Graph nodes reference this resolver-owned constant; they must not carry it.
PSYCHOLOGY_BASE_CHANCE = 10
# §11.3: player-safe realization may release only the external-behavior conclusion.
PSYCHOLOGY_REALIZATION_PUBLIC_KEYS = frozenset({"external_behavior"})
_PSYCHOLOGY_REALIZATION_LOCKED_INPUTS = frozenset({"reroll", "reexecution"})
_PSYCHOLOGY_OWNED_CONSTANTS = frozenset({"observer_skill_base_chance"})


def social_difficulty(
    request: dict[str, Any], npc_defense: int | None
) -> dict[str, Any]:
    """Apply the CoC 7e social ladder after kernel provenance validation.

    The request contains only already-validated structured values.  Resolving
    references, stable attempt identity, and persistence remain kernel work.
    """
    approach = str(request.get("approach") or "")
    if approach not in _SOCIAL_APPROACH_SKILLS:
        raise ValueError("unknown CoC 7e social approach")
    if npc_defense is not None and (
        isinstance(npc_defense, bool)
        or not isinstance(npc_defense, int)
        or not 0 <= npc_defense <= 100
    ):
        raise ValueError("npc_defense must be an integer 0-100 or None")
    direction = str(request.get("motive_direction") or "neutral")
    intensity = request.get("motive_intensity", 0)
    bonus = request.get("bonus", 0)
    penalty = request.get("penalty", 0)
    if direction not in {"support", "neutral", "oppose"}:
        raise ValueError("invalid motive direction")
    if isinstance(intensity, bool) or intensity not in {0, 1, 2}:
        raise ValueError("invalid motive intensity")
    described_action = request.get("described_action")
    if described_action is not None and not isinstance(described_action, str):
        raise ValueError("described_action must be a string")
    goal = request.get("goal")
    if goal is not None and not isinstance(goal, str):
        raise ValueError("goal must be a string")
    motive_evidence = request.get("motive_evidence")
    if motive_evidence is not None and not isinstance(motive_evidence, list):
        raise ValueError("motive_evidence must be a list")
    supporting_action = request.get("supporting_action")
    if supporting_action is None:
        supporting_action = {"description": "", "level": 0, "provenance": ""}
    elif not isinstance(supporting_action, dict):
        raise ValueError("supporting_action must be an object")
    else:
        description = supporting_action.get("description", "")
        if not isinstance(description, str):
            raise ValueError("supporting_action.description must be a string")
        level = supporting_action.get("level", 0)
        if (
            isinstance(level, bool)
            or not isinstance(level, int)
            or level not in {0, 1}
        ):
            raise ValueError("supporting_action.level must be 0 or 1")
        provenance = supporting_action.get("provenance", "")
        if not isinstance(provenance, str):
            raise ValueError("supporting_action.provenance must be a string")
        supporting_action = {
            "description": description,
            "level": level,
            "provenance": provenance,
        }
    sa_level = supporting_action["level"]
    if "leverage_one_level" in request:
        flag = request.get("leverage_one_level")
        if flag not in {True, False}:
            raise ValueError("leverage_one_level must be a boolean")
        existing = 1 if flag else 0
    else:
        strategic_count = request.get("strategic_count", 0)
        if isinstance(strategic_count, bool) or not isinstance(strategic_count, int):
            raise ValueError("strategic_count must be an integer")
        if not 0 <= strategic_count <= 2:
            raise ValueError("strategic_count must be 0-2")
        # Source (pdf 104 / printed 93 block 88) authorizes one level only.
        existing = 1 if strategic_count else 0
    leverage_adj = 1 if (existing or sa_level) else 0
    if any(isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 2 for value in (bonus, penalty)):
        raise ValueError("bonus and penalty must be integers 0-2")

    base = 0 if npc_defense is None or npc_defense < 50 else (1 if npc_defense < 90 else 2)
    motive_delta = (
        intensity
        if direction == "oppose"
        else (-1 if direction == "support" and intensity > 0 else 0)
    )
    final = base + motive_delta - leverage_adj
    if direction == "support" and intensity > 0:
        # pdf 104 / printed 93 block 85: positively inclined NPCs agree without a roll.
        feasibility = "automatic"
    elif direction == "oppose" and intensity == 2 and leverage_adj == 0:
        feasibility = "conditional"
    elif final > 2:
        feasibility = "conditional"
    elif final < 0:
        feasibility = "automatic"
    else:
        feasibility = "roll"
    return {
        "approach_skill": _SOCIAL_APPROACH_SKILLS[approach],
        "defense_skills": ["Psychology", _SOCIAL_APPROACH_SKILLS[approach]],
        "base_difficulty": _SOCIAL_DIFFICULTIES[base],
        "motive_adjustment": motive_delta,
        "leverage_one_level": bool(leverage_adj),
        "strategic_adjustment": -leverage_adj,
        "described_action": str(described_action or ""),
        "goal": str(goal or ""),
        "supporting_action": supporting_action,
        "final_difficulty": _SOCIAL_DIFFICULTIES[max(0, min(2, final))],
        "feasibility": feasibility,
        "bonus_dice": bonus,
        "penalty_dice": penalty,
    }


def social_skill_names() -> tuple[str, ...]:
    """Skills which require a bound social adjudication for an NPC goal."""
    return tuple(_SOCIAL_APPROACH_SKILLS.values())


def psychology_realization_public_projection(
    result: dict[str, Any],
) -> dict[str, Any]:
    """Allowlist the player-safe realization: external-behavior conclusion only.

    Concealed internals (inference ceiling, question, observable facts,
    settlement identity, dice/outcome, and audit flags) never enter this view,
    even when the payload is stuffed with them.  Spec §11.3.
    """
    if not isinstance(result, dict):
        raise ValueError("realization result must be an object")
    behavior = result.get("external_behavior")
    if not isinstance(behavior, str) or not behavior.strip():
        raise ValueError("external_behavior is required for public realization")
    return {"external_behavior": behavior}


def psychology_policy(check_result: dict[str, Any], question_kind: str) -> dict[str, Any]:
    """Return the Keeper-only CoC 7e realization ceiling for a concealed read.

    Realization mode consumes frozen ``inference_ceiling`` plus
    ``external_behavior`` and has no roll path: it never inspects a new roll,
    never accepts ``reroll``/``reexecution`` payload constants, and never
    returns those flags.  Settlement mode maps a concealed check outcome to
    an inference depth.  Source (pdf 215 / printed 204 block 96): a lost roll
    may yield any unreliable information including the opposite; inversion is
    not compelled.
    """
    del question_kind  # semantic question classification is Keeper-owned in v1.
    if not isinstance(check_result, dict):
        raise ValueError("check_result must be an object")
    if "inference_ceiling" in check_result or "external_behavior" in check_result:
        locked = sorted(
            key for key in _PSYCHOLOGY_REALIZATION_LOCKED_INPUTS if key in check_result
        )
        if locked:
            raise ValueError(
                "realization has no roll path; do not supply " + ", ".join(locked)
            )
        ceiling = str(check_result.get("inference_ceiling") or "").strip()
        behavior = str(check_result.get("external_behavior") or "").strip()
        if not ceiling:
            raise ValueError("inference_ceiling is required for realization")
        if ceiling not in _PSYCHOLOGY_INFERENCE_DEPTHS:
            raise ValueError("inference_ceiling is not a frozen observation depth")
        if not behavior:
            raise ValueError("external_behavior is required for realization")
        public = psychology_realization_public_projection(
            {"external_behavior": behavior}
        )
        return {
            "player_projection": public,
            "concealed_result": {"inference_ceiling": ceiling},
        }
    outcome = str(check_result.get("outcome") or "failure")
    if outcome in {"critical", "extreme"}:
        depth = "deep_conflict"
    elif outcome == "hard":
        depth = "motive_link"
    elif outcome == "regular":
        depth = "immediate_intent"
    else:
        depth = "uncertain"
    return {
        "inference_depth": depth,
        "misread_policy": (
            "any_unreliable_including_opposite"
            if outcome in _PSYCHOLOGY_FAILURE_OUTCOMES or depth == "uncertain"
            else "none"
        ),
    }


def _psychology_int_field(value: Any, name: str) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 100:
        raise ValueError(f"{name} must be an integer 0-100 or None")
    return value


def psychology_check_contract(
    npc_psychology: int | dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Return the package-owned concealed Psychology check contract.

    Difficulty comes from the *target's* relevant social skill (Charm, Fast
    Talk, Intimidate, or Persuade) — pdf 84 / printed 73 blocks 52-53 — not
    from the observer's or target's Psychology sheet value.  Observer
    Psychology defaults to 10% (pdf 83 / printed 72 block 48).
    """
    if isinstance(npc_psychology, dict):
        request = npc_psychology
        owned = sorted(key for key in _PSYCHOLOGY_OWNED_CONSTANTS if key in request)
        if owned:
            raise ValueError(
                "observer_skill_base_chance is resolver-owned "
                "(PSYCHOLOGY_BASE_CHANCE); do not supply it as payload"
            )
        opposing = _psychology_int_field(
            request.get("target_opposing_social"), "target_opposing_social"
        )
        observer_skill = _psychology_int_field(
            request.get("observer_skill"), "observer_skill"
        )
        question = request.get("question")
        if question is not None and not isinstance(question, str):
            raise ValueError("question must be a string")
        observable_facts = request.get("observable_facts")
        if observable_facts is not None and not isinstance(observable_facts, list):
            raise ValueError("observable_facts must be a list")
    else:
        opposing = _psychology_int_field(npc_psychology, "target_opposing_social")
        observer_skill = None
        question = None
        observable_facts = None
    if observer_skill is None:
        observer_skill = PSYCHOLOGY_BASE_CHANCE
        observer_skill_source = "rulebook_base"
    else:
        observer_skill_source = "sheet"
    difficulty = (
        "regular"
        if opposing is None or opposing < 50
        else "hard" if opposing < 90 else "extreme"
    )
    return {
        "skill": "Psychology",
        "observer_skill": observer_skill,
        "observer_skill_base_chance": PSYCHOLOGY_BASE_CHANCE,
        "observer_skill_source": observer_skill_source,
        "target_opposing_social": opposing,
        "question": question or "",
        "observable_facts": list(observable_facts or []),
        "defense_skills": list(_PSYCHOLOGY_OPPOSING_SOCIAL_SKILLS),
        "difficulty": difficulty,
        "difficulty_basis": "opponent_skill",
        "stakes": {
            "on_success": "the observer reads the current behavior correctly",
            "on_failure": (
                "the Keeper may give any unreliable information including the "
                "opposite of the truth; inversion is not compelled"
            ),
        },
    }


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


def validate_san_loss_expression(expression: Any) -> dict[str, Any]:
    """Validate one SAN loss expression (constant or NdM(+k)); raises ValueError."""
    return coc_sanity.validate_san_loss_expression(str(expression))


def sanity_snapshot_exists(campaign_dir: Any, investigator_id: str) -> bool:
    """Whether the canonical per-investigator SanitySession snapshot exists."""
    return coc_sanity.sanity_snapshot_exists(Path(campaign_dir), investigator_id)


def sanity_session_load(
    campaign_dir: Any,
    investigator_id: str,
    *,
    int_value: int,
    rng: random.Random | None,
    cm_value: int,
) -> Any:
    """Load the canonical SanitySession engine for one investigator.

    The session owns the full 7e insanity pipeline (5+ loss INT check, bout of
    madness, daily 1/5 indefinite threshold, SAN 0 permanent) as authoritative
    state; callers persist with ``session.save(campaign_dir)``.
    """
    return coc_sanity.SanitySession.load(
        Path(campaign_dir),
        investigator_id,
        int_value=int_value,
        rng=rng,
        cm_value=cm_value,
    )


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


def investigator_create_contract() -> dict[str, Any]:
    """Return this package's versioned ``investigator.create`` payload contract.

    The package-owned JSON is construction guidance for the Keeper. Existing
    deterministic materialization and validation remain authoritative in the
    established ``investigator.create`` runtime path. Parsing on each call
    guarantees callers receive independent data that cannot mutate resolver
    state or another caller's result.
    """
    contract = json.loads(
        INVESTIGATOR_CREATE_CONTRACT_PATH.read_text(encoding="utf-8")
    )
    if not isinstance(contract, dict):
        raise ValueError("investigator create contract must be an object")
    skill_rules = coc_rules.load_rule_table("skills")
    catalog = skill_rules["skills"]
    supported_eras = sorted(
        str(era)
        for era, spec in skill_rules["standard_sheet"].items()
        if isinstance(spec, dict)
    )
    standard_1920s = set(
        skill_rules["standard_sheet"]["1920s"]["default_skill_ids"]
    )
    contract["guided_quick_fire_skill_catalog"] = {
        "source": "rules-json/skills.json",
        "starting_skill_cap": (
            skill_rules["guided_creation_policy"]["starting_skill_cap"]
        ),
        "starting_skill_cap_scope": (
            "player_allocated_and_non_characteristic_derived_final_values"
        ),
        "characteristic_derived_base_policy": (
            "authoritative_when_unallocated_even_above_starting_skill_cap"
        ),
        "starting_skill_cap_source_ref": (
            skill_rules["guided_creation_policy"]["source_ref"]
        ),
        "default_era": "1920s",
        "supported_eras": supported_eras,
        "standard_sheet_source_ref": (
            skill_rules["standard_sheet"]["1920s"]["source_ref"]
        ),
        "columns": [
            "skill_id",
            "base_chance",
            "zh-Hans",
            "modern_only",
            "uncommon",
            "standard_sheet_1920s",
        ],
        "rows": [
            [
                skill_id,
                spec.get("base_chance"),
                (spec.get("localized_labels") or {}).get("zh-Hans", skill_id),
                spec.get("modern_only") is True,
                spec.get("uncommon") is True,
                skill_id in standard_1920s,
            ]
            for skill_id, spec in catalog.items()
        ],
        "instruction": (
            "construct the complete era-appropriate standard machine skill "
            "map from these canonical bases, add both allocation maps, and "
            "let investigator.create regenerate the zh-Hans skill rows"
        ),
    }
    return contract


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


def _catalog_module():
    name = "coc7_catalog_adapter"
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, PACKAGE_DIR / "catalog.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def catalog_supported_kinds() -> list[str]:
    return list(_catalog_module().supported_kinds())


def catalog_records(kinds: list[str] | tuple[str, ...] | None = None) -> list[dict[str, Any]]:
    return list(_catalog_module().catalog_records(kinds))


def catalog_search(kinds: list[str] | tuple[str, ...] | None = None) -> list[dict[str, Any]]:
    """Capability marker for toolbox ``rules.catalog_search`` (kernel owns recall)."""
    return catalog_records(kinds)


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
        "social_difficulty": {
            "aliases": [],
            "signature": "social_difficulty(request, npc_defense)",
            "returns": "CoC 7e social difficulty, adjustment, and tactical-dice policy",
        },
        "social_skill_names": {
            "aliases": [],
            "signature": "social_skill_names()",
            "returns": "package-owned NPC social check skill names",
        },
        "psychology_policy": {
            "aliases": [],
            "signature": "psychology_policy(check_result, question_kind)",
            "returns": (
                "concealed Psychology inference ceiling, or a no-roll realization "
                "split into player_projection (external_behavior only) and "
                "concealed_result (inference_ceiling)"
            ),
        },
        "psychology_realization_public_projection": {
            "aliases": [],
            "signature": "psychology_realization_public_projection(result)",
            "returns": (
                "§11.3 allowlist: only external_behavior; concealed fields dropped"
            ),
        },
        "psychology_check_contract": {
            "aliases": [],
            "signature": "psychology_check_contract(npc_psychology)",
            "returns": (
                "Psychology observer skill defaulting to resolver-owned "
                "PSYCHOLOGY_BASE_CHANCE=10 and difficulty from the target's "
                "relevant social skill"
            ),
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
        "validate_san_loss_expression": {
            "aliases": [],
            "signature": "validate_san_loss_expression(expression)",
            "returns": "parsed loss expression spec; raises ValueError on invalid input",
        },
        "sanity_snapshot_exists": {
            "aliases": [],
            "signature": "sanity_snapshot_exists(campaign_dir, investigator_id)",
            "returns": "whether the canonical per-investigator SanitySession snapshot exists",
        },
        "sanity_session_load": {
            "aliases": ["sanity_session"],
            "signature": "sanity_session_load(campaign_dir, investigator_id, *, int_value, rng, cm_value)",
            "returns": (
                "the canonical SanitySession engine owning the full 7e insanity "
                "pipeline (INT check on 5+ loss, bout of madness, daily 1/5 "
                "indefinite threshold, SAN 0 permanent) as authoritative state"
            ),
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
        "investigator_create_contract": {
            "aliases": [],
            "signature": "investigator_create_contract()",
            "returns": (
                "package-owned versioned construction contract for the complete "
                "investigator.create payload"
            ),
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
        "catalog_search": {
            "aliases": ["catalog_records"],
            "signature": "catalog_search(query, kinds=None, era=None, limit=None)",
            "returns": "advisory candidate-only catalog recall; never selects entity_id",
        },
    }
    for name, entry in coc_roll.public_api_index().items():
        index.setdefault(name, entry)
    return index
