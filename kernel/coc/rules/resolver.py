"""coc7 ruleset resolver: thin wrappers over the engines. Ported from
rulesets/coc7/resolver.py.

Resolvers are pure functions of their inputs plus an injectable RNG: no campaign
I/O. State writes stay with the settlement layer. The healing-chain helpers
build the canonical command requests the engines consume; `public_api_index`
is what the RuleGraph runtime validates capability nodes against."""

from __future__ import annotations

import random
import re
from copy import deepcopy
from typing import Any

from . import percentile
from .healing import establish_damage_wound
from .tables import RuleTables

_RESOURCE_KEYS = frozenset({"hp", "san", "mp", "luck"})
_DIRECTIONS = frozenset({"loss", "gain"})

SOCIAL_APPROACH_SKILLS = {
    "charm": "Charm",
    "fast_talk": "Fast Talk",
    "intimidate": "Intimidate",
    "persuade": "Persuade",
}
_SOCIAL_DIFFICULTIES = ("regular", "hard", "extreme")
_PSYCHOLOGY_OPPOSING_SOCIAL_SKILLS = ("Charm", "Fast Talk", "Intimidate", "Persuade")
_PSYCHOLOGY_INFERENCE_DEPTHS = frozenset({"deep_conflict", "motive_link", "immediate_intent", "uncertain"})
_PSYCHOLOGY_FAILURE_OUTCOMES = frozenset({"failure", "fumble"})
# Keeper Rulebook Psychology (10%) — pdf 83 / printed 72, block 48.
PSYCHOLOGY_BASE_CHANCE = 10
PSYCHOLOGY_REALIZATION_PUBLIC_KEYS = frozenset({"external_behavior"})
_PSYCHOLOGY_REALIZATION_LOCKED_INPUTS = frozenset({"reroll", "reexecution"})
_PSYCHOLOGY_OWNED_CONSTANTS = frozenset({"observer_skill_base_chance"})

# SAN loss grammar (from the old coc_sanity.validate_san_loss_expression).
_SAN_LOSS_DICE = re.compile(r"^(?P<count>\d+)[dD](?P<sides>\d+)(?:\+(?P<modifier>\d+))?$")
SAN_LOSS_MAX_DICE_COUNT = 100
SAN_LOSS_MAX_DIE_SIDES = 1_000
SAN_LOSS_MAX_MODIFIER = 100_000
SAN_LOSS_MAX_TOTAL = 100_000


def validate_san_loss_expression(expression: Any) -> dict[str, int | str]:
    """Parse the canonical SAN-loss grammar (constant or NdM(+k)) without consuming RNG."""
    if not isinstance(expression, str):
        raise ValueError("SAN loss expression must be a string")
    normalized = expression.strip()
    if len(normalized) > 32:
        raise ValueError("SAN loss expression is too long")
    if normalized.isdigit():
        value = int(normalized)
        if value <= 0:
            raise ValueError("SAN loss constant must be positive")
        if value > SAN_LOSS_MAX_TOTAL:
            raise ValueError("SAN loss constant exceeds the supported maximum")
        return {"kind": "constant", "value": value}
    match = _SAN_LOSS_DICE.fullmatch(normalized)
    if match is None:
        raise ValueError("invalid SAN loss expression")
    count, sides = int(match.group("count")), int(match.group("sides"))
    modifier = int(match.group("modifier") or 0)
    if count <= 0 or sides <= 0:
        raise ValueError("SAN loss dice count and sides must be positive")
    if count > SAN_LOSS_MAX_DICE_COUNT or sides > SAN_LOSS_MAX_DIE_SIDES or modifier > SAN_LOSS_MAX_MODIFIER:
        raise ValueError("SAN loss expression exceeds the supported maximum")
    if count * sides + modifier > SAN_LOSS_MAX_TOTAL:
        raise ValueError("SAN loss maximum exceeds the supported total")
    return {"kind": "dice", "count": count, "sides": sides, "modifier": modifier}


class Resolver:
    def __init__(self, tables: RuleTables) -> None:
        self.tables = tables

    # ---- skills / bases ---------------------------------------------------

    def skill_base(self, skill_name: str, *, era: str | None = None) -> int | None:
        """One flat catalog base for a missing sheet skill; characteristic-derived and
        variable bases stay unresolved (None). Modern-only skills need the modern era."""
        if not isinstance(skill_name, str) or not skill_name:
            return None
        try:
            spec = self.tables.skill_by_name(skill_name)
        except (KeyError, OSError, ValueError):
            return None
        if spec.get("modern_only") is True and str(era or "").strip().casefold() != "modern":
            return None
        base = spec.get("base_chance")
        if isinstance(base, bool) or not isinstance(base, int) or not 0 <= base <= 100:
            return None
        return base

    def actor_skill_value(self, sheet: dict[str, Any] | None, skill_name: str) -> int | None:
        """Sheet value first; only an omitted key consults the flat rulebook base."""
        if not isinstance(sheet, dict) or not isinstance(skill_name, str):
            return None
        skills = sheet.get("skills")
        if not isinstance(skills, dict):
            return None
        if skill_name in skills:
            raw = skills[skill_name]
            if isinstance(raw, dict):
                raw = raw.get("value")
            if isinstance(raw, bool) or raw is None:
                return None
            try:
                value = int(raw)
            except (TypeError, ValueError):
                return None
            return value if 0 <= value <= 100 else None
        return self.skill_base(skill_name, era=sheet.get("era"))

    # ---- damage bookkeeping ----------------------------------------------

    @staticmethod
    def damage_state_effect(*, actor_state: dict[str, Any], event: dict[str, Any]) -> dict[str, Any]:
        """Project settled HP damage into the wound ledger (no campaign I/O)."""
        state = deepcopy(actor_state)
        establish_damage_wound(
            state,
            decision_id=str(event["decision_id"]),
            occurred_elapsed_minutes=int(event["occurred_elapsed_minutes"]),
            source_damage_roll_id=(str(event["source_event_id"]) if event.get("source_event_id") is not None else None),
        )
        return state

    # ---- social -----------------------------------------------------------

    @staticmethod
    def social_difficulty(request: dict[str, Any], npc_defense: int | None) -> dict[str, Any]:
        """Apply the CoC 7e social ladder to already-validated structured values."""
        approach = str(request.get("approach") or "")
        if approach not in SOCIAL_APPROACH_SKILLS:
            raise ValueError("unknown CoC 7e social approach")
        if npc_defense is not None and (isinstance(npc_defense, bool) or not isinstance(npc_defense, int)
                                        or not 0 <= npc_defense <= 100):
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
            if isinstance(level, bool) or not isinstance(level, int) or level not in {0, 1}:
                raise ValueError("supporting_action.level must be 0 or 1")
            provenance = supporting_action.get("provenance", "")
            if not isinstance(provenance, str):
                raise ValueError("supporting_action.provenance must be a string")
            supporting_action = {"description": description, "level": level, "provenance": provenance}
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
            existing = 1 if strategic_count else 0
        leverage_adj = 1 if (existing or sa_level) else 0
        if any(isinstance(v, bool) or not isinstance(v, int) or not 0 <= v <= 2 for v in (bonus, penalty)):
            raise ValueError("bonus and penalty must be integers 0-2")

        base = 0 if npc_defense is None or npc_defense < 50 else (1 if npc_defense < 90 else 2)
        motive_delta = intensity if direction == "oppose" else (-1 if direction == "support" and intensity > 0 else 0)
        final = base + motive_delta - leverage_adj
        if direction == "support" and intensity > 0:
            feasibility = "automatic"
        elif final > 2:
            feasibility = "conditional"
        elif final < 0:
            feasibility = "automatic"
        else:
            feasibility = "roll"
        return {
            "approach_skill": SOCIAL_APPROACH_SKILLS[approach],
            "defense_skills": ["Psychology", SOCIAL_APPROACH_SKILLS[approach]],
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

    @staticmethod
    def social_skill_names() -> tuple[str, ...]:
        return tuple(SOCIAL_APPROACH_SKILLS.values())

    # ---- psychology -------------------------------------------------------

    @staticmethod
    def psychology_realization_public_projection(result: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(result, dict):
            raise ValueError("realization result must be an object")
        behavior = result.get("external_behavior")
        if not isinstance(behavior, str) or not behavior.strip():
            raise ValueError("external_behavior is required for public realization")
        return {"external_behavior": behavior}

    def psychology_policy(self, check_result: dict[str, Any], question_kind: str) -> dict[str, Any]:
        """Settlement mode maps a concealed outcome to an inference depth; realization mode
        splits a frozen ceiling + external behavior into a player projection."""
        del question_kind
        if not isinstance(check_result, dict):
            raise ValueError("check_result must be an object")
        if "inference_ceiling" in check_result or "external_behavior" in check_result:
            locked = sorted(k for k in _PSYCHOLOGY_REALIZATION_LOCKED_INPUTS if k in check_result)
            if locked:
                raise ValueError("realization has no roll path; do not supply " + ", ".join(locked))
            ceiling = str(check_result.get("inference_ceiling") or "").strip()
            behavior = str(check_result.get("external_behavior") or "").strip()
            if not ceiling:
                raise ValueError("inference_ceiling is required for realization")
            if ceiling not in _PSYCHOLOGY_INFERENCE_DEPTHS:
                raise ValueError("inference_ceiling is not a frozen observation depth")
            if not behavior:
                raise ValueError("external_behavior is required for realization")
            return {"player_projection": self.psychology_realization_public_projection({"external_behavior": behavior}),
                    "concealed_result": {"inference_ceiling": ceiling}}
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
            "misread_policy": ("any_unreliable_including_opposite"
                               if outcome in _PSYCHOLOGY_FAILURE_OUTCOMES or depth == "uncertain" else "none"),
        }

    @staticmethod
    def _psychology_int_field(value: Any, name: str) -> int | None:
        if value is None:
            return None
        if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 100:
            raise ValueError(f"{name} must be an integer 0-100 or None")
        return value

    def psychology_check_contract(self, npc_psychology: int | dict[str, Any] | None = None) -> dict[str, Any]:
        """Difficulty comes from the target's relevant social skill; observer Psychology
        defaults to the rulebook base (10%)."""
        if isinstance(npc_psychology, dict):
            request = npc_psychology
            owned = sorted(k for k in _PSYCHOLOGY_OWNED_CONSTANTS if k in request)
            if owned:
                raise ValueError("observer_skill_base_chance is resolver-owned; do not supply it as payload")
            opposing = self._psychology_int_field(request.get("target_opposing_social"), "target_opposing_social")
            observer_skill = self._psychology_int_field(request.get("observer_skill"), "observer_skill")
            question = request.get("question")
            if question is not None and not isinstance(question, str):
                raise ValueError("question must be a string")
            observable_facts = request.get("observable_facts")
            if observable_facts is not None and not isinstance(observable_facts, list):
                raise ValueError("observable_facts must be a list")
        else:
            opposing = self._psychology_int_field(npc_psychology, "target_opposing_social")
            observer_skill = None
            question = None
            observable_facts = None
        if observer_skill is None:
            observer_skill = PSYCHOLOGY_BASE_CHANCE
            observer_skill_source = "rulebook_base"
        else:
            observer_skill_source = "sheet"
        difficulty = "regular" if opposing is None or opposing < 50 else "hard" if opposing < 90 else "extreme"
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
                "on_failure": ("the Keeper may give any unreliable information including the opposite of the "
                               "truth; inversion is not compelled"),
            },
        }

    # ---- checks -----------------------------------------------------------

    def check(self, target: int, difficulty: str = "regular", bonus: int = 0, penalty: int = 0,
              rng: random.Random | None = None) -> dict[str, Any]:
        return percentile.percentile_check(self.tables, target, difficulty, bonus, penalty, rng=rng)

    def resource_delta(self, resource: str, current: int, amount: int | str, *, direction: str = "loss",
                       maximum: int | None = None, rng: random.Random | None = None) -> dict[str, Any]:
        if resource not in _RESOURCE_KEYS:
            raise ValueError(f"unknown resource {resource!r}; expected one of {sorted(_RESOURCE_KEYS)}")
        if direction not in _DIRECTIONS:
            raise ValueError("direction must be 'loss' or 'gain'")
        if isinstance(current, bool) or not isinstance(current, int) or current < 0:
            raise ValueError("current must be a non-negative integer")
        if maximum is not None and (isinstance(maximum, bool) or not isinstance(maximum, int) or maximum < 0):
            raise ValueError("maximum must be a non-negative integer")
        detail: dict[str, Any] | None = None
        if isinstance(amount, str):
            rolled = percentile.roll_expression(amount, rng=rng)
            value = max(0, int(rolled["total"]))
            detail = rolled
        elif isinstance(amount, bool) or not isinstance(amount, int):
            raise ValueError("amount must be an integer or a dice expression")
        else:
            value = abs(amount)
        after = max(0, current - value) if direction == "loss" else (
            min(maximum, current + value) if maximum is not None else current + value)
        receipt: dict[str, Any] = {"ruleset_id": "coc7", "resource": resource, "direction": direction,
                                   "amount": value, "before": current, "after": after, "delta": after - current,
                                   "maximum": maximum}
        if detail is not None:
            receipt["roll_detail"] = detail
        return receipt

    @staticmethod
    def roll_dice(expression: str, *, rng: random.Random | None = None) -> dict[str, Any]:
        return percentile.roll_expression(expression, rng=rng)

    def opposed(self, investigator_target: int, opponent_value: int, *,
                rng: random.Random | None = None) -> dict[str, Any]:
        """Non-combat opposed check: higher success level wins; tied levels favor the
        higher target; tied double-failure has no winner."""
        mine = self.check(investigator_target, "regular", 0, 0, rng=rng)
        theirs = self.check(opponent_value, "regular", 0, 0, rng=rng)
        levels = {"fumble": 0, "failure": 0, "regular": 1, "hard": 2, "extreme": 3, "critical": 4}
        my_level = levels.get(str(mine["outcome"]), 0)
        their_level = levels.get(str(theirs["outcome"]), 0)
        if my_level != their_level:
            winner = "investigator" if my_level > their_level else "opponent"
        elif my_level == 0:
            winner = "none"
        else:
            winner = "investigator" if investigator_target >= opponent_value else "opponent"
        return {"investigator_roll": mine, "opponent_roll": theirs, "winner": winner}

    def combined_roll(self, targets: list[dict[str, Any]], *, roll: int, required_level: str,
                      comparison_mode: str) -> dict[str, Any]:
        """Many target verdicts from one D100 (ported from the old _combined_roll_projection)."""
        if comparison_mode not in {"any", "all"}:
            raise ValueError("combined_mode must be any or all")
        comparisons = []
        for target in targets:
            settled = percentile.resolve_percentile_roll(self.tables, roll, int(target["value"]), required_level)
            comparisons.append({"label": str(target["label"]), "value": int(target["value"]),
                                "required_target": int(settled["required_target"]),
                                "achieved_level": str(settled["achieved_level"]),
                                "outcome": str(settled["outcome"]), "success": bool(settled["success"])})
        overall = (any(row["success"] for row in comparisons) if comparison_mode == "any"
                   else all(row["success"] for row in comparisons))
        return {"rule_ref": "core.combined_roll", "roll_count": 1, "comparison_mode": comparison_mode,
                "targets": comparisons, "overall_success": overall, "development_tick_eligible": False,
                "push_eligible": False, "luck_spend_eligible": False}

    # ---- push / luck ------------------------------------------------------

    def skill_pushable(self, skill: Any) -> bool:
        """False only for the skills pushed-roll.json excludes (combat skills)."""
        name = str(skill or "").strip()
        if not name:
            return True
        rule = self.tables.pushed_roll_rule()
        if name in set(rule["non_pushable_skill_names"]):
            return False
        groups = set(rule["non_pushable_specialization_groups"])
        if name in groups:
            return False
        try:
            spec = self.tables.skill_by_name(name)
        except (KeyError, OSError, ValueError):
            return True
        group = spec.get("group")
        return not (isinstance(group, str) and group in groups)

    def push_policy(self, original_outcome: Any, already_pushed: bool, skill: Any = None) -> str | None:
        """None when the original check may be pushed, else the violation message."""
        if not self.skill_pushable(skill):
            return (f"{str(skill).strip()} is a combat skill and cannot be pushed; the next attempt is the "
                    "next attack, not a pushed roll")
        if original_outcome != "failure":
            return "only an ordinary failed original check may be pushed; fumbles are final"
        if already_pushed:
            return "the original check has already been pushed"
        return None

    def luck_spend(self, result: dict[str, Any], points: int, current_luck: int, *,
                   roll_kind: str = "skill") -> dict[str, Any]:
        return percentile.spend_luck(self.tables, result, points, current_luck, roll_kind=roll_kind)

    # ---- sanity / damage --------------------------------------------------

    @staticmethod
    def _san_loss(expression: Any, rng: random.Random | None) -> tuple[int, dict[str, Any]]:
        text = str(expression if expression is not None else "0").strip()
        if text in ("0", ""):
            return 0, {"kind": "constant", "value": 0}
        spec = validate_san_loss_expression(text)
        if spec["kind"] == "constant":
            return int(spec["value"]), spec
        rolled = percentile.roll_expression(
            f"{spec['count']}D{spec['sides']}" + (f"+{spec['modifier']}" if spec.get("modifier") else ""), rng=rng)
        return int(rolled["total"]), {**spec, "rolls": rolled["rolls"], "total": rolled["total"]}

    def sanity_check(self, current_san: int, loss_success: Any, loss_failure: Any, *,
                     rng: random.Random | None = None) -> dict[str, Any]:
        settled = self.check(current_san, "regular", 0, 0, rng=rng)
        success = settled["outcome"] in percentile.SUCCESS_OUTCOMES
        loss, loss_detail = self._san_loss(loss_success if success else loss_failure, rng)
        return {"check": settled, "success": success, "san_loss": loss, "loss_detail": loss_detail,
                "san_before": current_san, "san_after": max(0, current_san - loss)}

    @staticmethod
    def validate_san_loss_expression(expression: Any) -> dict[str, Any]:
        return validate_san_loss_expression(str(expression))

    @staticmethod
    def damage(amount: Any, current_hp: int, max_hp: int, *, kind: str = "damage",
               rng: random.Random | None = None) -> dict[str, Any]:
        if kind not in ("damage", "heal"):
            raise ValueError("kind must be damage or heal")
        raw = str(amount).strip()
        detail: dict[str, Any] | None = None
        if raw.lstrip("+-").isdigit():
            value = abs(int(raw))
        else:
            rolled = percentile.roll_expression(raw, rng=rng)
            value = max(0, int(rolled["total"]))
            detail = rolled
        after = min(max_hp, current_hp + value) if kind == "heal" else max(0, current_hp - value)
        return {"amount": value, "roll_detail": detail, "hp_before": current_hp, "hp_after": after, "max_hp": max_hp}

    # ---- lookups ----------------------------------------------------------

    def build_scale(self, build: int | None = None, *, actor_build: int | None = None,
                    target_build: int | None = None) -> dict[str, Any]:
        data: dict[str, Any] = {}
        if build is not None:
            data["scale"] = self.tables.build_scale_row(build)
        if actor_build is not None:
            data["comparison"] = self.tables.compare_builds(actor_build, target_build)
        return data

    def cash_assets(self, credit_rating: int, period: str = "1920s") -> dict[str, Any]:
        return self.tables.cash_and_assets(credit_rating, period=period)

    def skill_describe(self) -> dict[str, Any]:
        return self.tables.skill_descriptions()

    # ---- healing-chain command requests ------------------------------------

    @staticmethod
    def first_aid(decision_id: str, skill_value: int, rescuer_id: str, *, pushed: bool = False,
                  changed_method: str | None = None, failure_consequence: str | None = None,
                  assistant_skill_value: int | None = None,
                  assistant_rescuer_id: str | None = None) -> dict[str, Any]:
        request: dict[str, Any] = {"kind": "stabilize", "command_id": f"{decision_id}-first-aid",
                                   "method": "first_aid", "skill_value": skill_value,
                                   "rescuer_id": rescuer_id, "pushed": pushed}
        if pushed:
            request["changed_method"] = changed_method
            request["failure_consequence"] = failure_consequence
        if (assistant_skill_value is None) != (assistant_rescuer_id is None):
            raise ValueError("assistant First Aid requires both skill value and rescuer id")
        if assistant_skill_value is not None:
            request["assistant_skill_value"] = assistant_skill_value
            request["assistant_rescuer_id"] = assistant_rescuer_id
        return request

    @staticmethod
    def medicine(decision_id: str, skill_value: int, rescuer_id: str) -> dict[str, Any]:
        return {"kind": "stabilize", "command_id": f"{decision_id}-medicine", "method": "medicine",
                "skill_value": skill_value, "rescuer_id": rescuer_id}

    @staticmethod
    def weekly_recovery(decision_id: str, complete_rest: bool, poor_environment: bool, *,
                        medicine_skill_value: int | None = None,
                        caregiver_id: str | None = None) -> dict[str, Any]:
        request: dict[str, Any] = {"kind": "weekly_recovery", "command_id": f"{decision_id}-weekly-recovery",
                                   "complete_rest": complete_rest, "poor_environment": poor_environment}
        if medicine_skill_value is not None:
            request["medicine_skill_value"] = medicine_skill_value
            request["caregiver_id"] = caregiver_id
        return request

    @staticmethod
    def dying_check(decision_id: str, clock_kind: str) -> dict[str, Any]:
        return {"kind": "dying_tick", "command_id": f"{decision_id}-dying-{clock_kind}", "clock_kind": clock_kind}

    # ---- discoverability --------------------------------------------------

    @staticmethod
    def public_api_index() -> dict[str, dict[str, Any]]:
        """Capabilities the RuleGraph runtime may bind. Keys are the resolver_capability
        identities on the graph's capability nodes; the session capabilities of the
        second half (combat.*, chase.*, sanity.*) are registered by executors.py."""
        names = {
            "check": "percentile check receipt with distinct required and achieved levels",
            "percentile_check": "alias of check", "roll_percentile": "alias of check",
            "resource_delta": "validated pool arithmetic receipt (no state write)",
            "social_difficulty": "CoC 7e social difficulty, adjustment, and tactical-dice policy",
            "social_skill_names": "package-owned NPC social check skill names",
            "psychology_policy": "concealed Psychology inference ceiling or player-safe realization",
            "psychology_realization_public_projection": "external_behavior only",
            "psychology_check_contract": "Psychology observer skill and difficulty from the target's social skill",
            "roll_dice": "dice expression result with individual faces",
            "opposed": "both percentile receipts plus the non-combat winner",
            "push_policy": "None when the check may be pushed, else the violation message",
            "skill_pushable": "False only for the skills the rulebook excludes from pushing",
            "sanity_check": "SAN check receipt with settled loss and before/after values",
            "validate_san_loss_expression": "parsed loss expression spec",
            "damage": "settled amount, optional dice detail, and clamped hp_after",
            "luck_spend": "recomputed result after spending Luck (p.99)",
            "build_scale": "scale row and/or lift/throw comparison (Table XV, p.279)",
            "cash_assets": "cash/assets/spending level and living standard",
            "skill_describe": "parsed skill-descriptions.json catalog",
            "first_aid": "canonical stabilize request for the healing engine",
            "medicine": "canonical stabilize request for the healing engine",
            "weekly_recovery": "canonical weekly recovery request for the healing engine",
            "dying_check": "canonical dying-tick request for the healing engine",
            "catalog_search": "advisory candidate-only catalog recall; never selects entity_id",
            "roll_expression": "alias of roll_dice", "spend_luck": "alias of luck_spend",
            "recover_luck": "session-end Luck recovery roll result (p.99)",
            "idea_roll": "INT percentile check", "know_roll": "EDU percentile check",
        }
        return {name: {"returns": returns} for name, returns in names.items()}
