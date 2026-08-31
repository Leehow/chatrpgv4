#!/usr/bin/env python3
"""CoC 7e RuleGraph settlement adapter.

The generic RulesRuntime owns graph validation, applicability, grants, plan
compilation, and the single executor call. This package-owned adapter owns the
few composed CoC 7e candidate flows that need more than that generic call.

Healing is graph-owned in the production package; the remaining composed
families stay candidate-only until their own source and promotion gates pass.
This adapter keeps CoC-specific host binding and command shape out of the
generic RulesRuntime in both cases.
"""
from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from types import MappingProxyType, MethodType
from typing import Any, Callable, Mapping
from weakref import WeakKeyDictionary

import coc_rules_runtime as _generic_runtime

FamilyOwnershipMismatch = _generic_runtime.FamilyOwnershipMismatch


def _freeze(value: Any) -> Any:
    if isinstance(value, Mapping):
        return MappingProxyType({
            str(key): _freeze(item) for key, item in value.items()
        })
    if isinstance(value, (list, tuple)):
        return tuple(_freeze(item) for item in value)
    if isinstance(value, set):
        return frozenset(_freeze(item) for item in value)
    return deepcopy(value)


def _thaw(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {str(key): _thaw(item) for key, item in value.items()}
    if isinstance(value, (tuple, frozenset)):
        return [_thaw(item) for item in value]
    return deepcopy(value)


def _json_digest(value: Any) -> str:
    raw = json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


PSYCHOLOGY_REALIZATION_PUBLIC_KEYS = frozenset({"external_behavior"})
PSYCHOLOGY_OBSERVE_DECISION_SUFFIX = ":observe-concealed"
PSYCHOLOGY_REALIZE_DECISION_SUFFIX = ":realize-player-safe"
_PSYCHOLOGY_REALIZE_REF = "decision:coc7:psychology:realize-player-safe"
_CHECK_FAILURE_OUTCOMES = frozenset({"failure"})
_CHECK_FUMBLE_OUTCOMES = frozenset({"fumble"})
_PUSHED_ROLL_REF = "decision:coc7:push-luck:pushed-roll"
_LUCK_SPEND_REF = "decision:coc7:push-luck:luck-spend"
_RESOURCE_KEYS = frozenset({"hp", "mp", "luck", "san"})
LOOKUP_CONTEXT_DECISION_REFS = (
    "decision:coc7:development:skill-describe",
    "decision:coc7:development:catalog-search",
    "decision:coc7:development:build-scale",
    "decision:coc7:development:cash-assets",
)
_SKILL_DESCRIBE_REF = LOOKUP_CONTEXT_DECISION_REFS[0]
_CATALOG_SEARCH_REF = LOOKUP_CONTEXT_DECISION_REFS[1]
_BUILD_SCALE_REF = LOOKUP_CONTEXT_DECISION_REFS[2]
_CASH_ASSETS_REF = LOOKUP_CONTEXT_DECISION_REFS[3]
_SANITY_SESSION_EXCEPTION_REF = "exception:coc7:sanity:session-engine-uncompiled"
_DAMAGE_KINDS = frozenset({"damage", "heal"})
_HEALING_SETTLE_DECISION_REFS = (
    "decision:coc7:healing:dying-hour-clock",
    "decision:coc7:healing:dying-round-clock",
    "decision:coc7:healing:first-aid-ordinary",
    "decision:coc7:healing:first-aid-stabilization",
    "decision:coc7:healing:medicine-ordinary",
    "decision:coc7:healing:medicine-stabilization",
    "decision:coc7:healing:weekly-major-wound-recovery",
)
_CORE_SETTLE_DECISION_REFS = (
    "decision:coc7:core-check:ordinary-check",
    "decision:coc7:core-check:combined-check",
    "decision:coc7:core-check:opposed-check",
)
_PUSH_LUCK_SETTLE_DECISION_REFS = (
    "decision:coc7:push-luck:pushed-roll",
    "decision:coc7:push-luck:luck-spend",
    "decision:coc7:push-luck:luck-roll",
)
_SOCIAL_SETTLE_DECISION_REFS = (
    "decision:coc7:social:adjudicate-difficulty",
)
_PSYCHOLOGY_SETTLE_DECISION_REFS = (
    "decision:coc7:psychology:observe-concealed",
    "decision:coc7:psychology:realize-player-safe",
)
_COMBAT_CONTEXT_REF = "decision:coc7:combat:context"
_COMBAT_SETTLE_DECISION_REFS = (
    "decision:coc7:combat:attack",
    "decision:coc7:combat:defend",
    "decision:coc7:combat:aim",
    "decision:coc7:combat:reload",
    "decision:coc7:combat:maneuver",
    "decision:coc7:combat:flee",
    "decision:coc7:combat:end",
)
_SANITY_CONTEXT_REF = "decision:coc7:sanity:context"
_SANITY_SETTLE_DECISION_REFS = (
    "decision:coc7:sanity:check",
    "decision:coc7:sanity:bout-tick",
    "decision:coc7:sanity:bout-end",
    "decision:coc7:sanity:reality-check",
    "decision:coc7:sanity:gain-current-san",
    "decision:coc7:sanity:insane-insight",
    "decision:coc7:sanity:apply-treatment",
    "decision:coc7:sanity:recover-temporary",
)
_GROUP_ONE_SETTLE_DECISION_REFS = (
    *_HEALING_SETTLE_DECISION_REFS,
    *_CORE_SETTLE_DECISION_REFS,
    *_PUSH_LUCK_SETTLE_DECISION_REFS,
    *_SOCIAL_SETTLE_DECISION_REFS,
    *_PSYCHOLOGY_SETTLE_DECISION_REFS,
    *_COMBAT_SETTLE_DECISION_REFS,
    *_SANITY_SETTLE_DECISION_REFS,
)


def _observation_inference_ceiling(data: Mapping[str, Any]) -> str | None:
    for key in ("inference_depth", "inference_ceiling"):
        value = data.get(key)
        if isinstance(value, str) and value:
            return value
    return None


def _observation_public_outcome(frozen: Mapping[str, Any]) -> dict[str, Any]:
    concealed = frozen.get("concealed")
    if not isinstance(concealed, Mapping):
        return {"inference_ceiling": frozen.get("inference_ceiling")}
    outcome = concealed.get("outcome")
    row: dict[str, Any] = {"realm": "psychology"}
    if isinstance(outcome, str) and outcome:
        row["outcome"] = outcome
    return row


def _paired_observe_decision_id(realize_decision_id: str) -> str | None:
    id_text = str(realize_decision_id or "")
    if not id_text.endswith(PSYCHOLOGY_REALIZE_DECISION_SUFFIX):
        return None
    prefix = id_text[: -len(PSYCHOLOGY_REALIZE_DECISION_SUFFIX)]
    if not prefix.startswith("psychology:"):
        return None
    return prefix + PSYCHOLOGY_OBSERVE_DECISION_SUFFIX


def _semantic_slug(value: Any) -> str:
    return "-".join(
        token for token in "".join(
            char.lower() if char.isalnum() else " " for char in str(value or "")
        ).split() if token
    )


def _sheet_check(
    sheet: Mapping[str, Any], ref: str,
) -> tuple[str, int] | None:
    kind, separator, slug = str(ref or "").partition(":")
    if not separator or not slug:
        return None
    if kind == "skill":
        skills = sheet.get("skills") if isinstance(sheet.get("skills"), Mapping) else {}
        for label, value in skills.items():
            if (
                _semantic_slug(label) == _semantic_slug(slug)
                and isinstance(value, int) and not isinstance(value, bool)
                and 0 <= value <= 100
            ):
                return str(label), int(value)
    if kind == "characteristic":
        values = (
            sheet.get("characteristics")
            if isinstance(sheet.get("characteristics"), Mapping) else {}
        )
        for label, value in values.items():
            if (
                _semantic_slug(label) == _semantic_slug(slug)
                and isinstance(value, int) and not isinstance(value, bool)
                and 0 <= value <= 100
            ):
                return str(label).upper(), int(value)
    return None


def _npc_check(ctx: Any, ref: str) -> tuple[str, int] | None:
    parts = str(ref or "").split(":")
    if len(parts) != 4 or parts[0] != "npc" or parts[2] != "skill":
        return None
    npc_id, skill_slug = parts[1], parts[3]
    document = getattr(ctx, "npc_agendas", None)
    rows: list[Mapping[str, Any]] = []
    if isinstance(document, Mapping):
        raw = document.get("npcs")
        if isinstance(raw, list):
            rows = [row for row in raw if isinstance(row, Mapping)]
        elif isinstance(raw, Mapping):
            rows = [row for row in raw.values() if isinstance(row, Mapping)]
    npc = next(
        (row for row in rows if str(row.get("npc_id") or row.get("id") or "") == npc_id),
        None,
    )
    if npc is None:
        return None
    skills = npc.get("skills") if isinstance(npc.get("skills"), Mapping) else {}
    for label, value in skills.items():
        if (
            _semantic_slug(label) == _semantic_slug(skill_slug)
            and isinstance(value, int) and not isinstance(value, bool)
            and 0 <= value <= 100
        ):
            return f"{npc_id} {label}", int(value)
    return None


_SETTLEMENT_METHOD_BY_DECISION = {
    "decision:coc7:social:adjudicate-difficulty": "_settle_social",
    "decision:coc7:psychology:observe-concealed": "_settle_psychology_observe",
    "decision:coc7:psychology:realize-player-safe": "_settle_psychology_realize",
    "decision:coc7:core-check:ordinary-check": "_settle_ordinary_check",
    "decision:coc7:core-check:resource-delta": "_settle_resource_delta",
    "decision:coc7:push-luck:pushed-roll": "_settle_pushed_roll",
    "decision:coc7:push-luck:luck-spend": "_settle_luck_spend",
    "decision:coc7:push-luck:luck-roll": "_settle_luck_roll",
    "decision:coc7:combat:apply-damage": "_settle_damage",
    "decision:coc7:sanity:non-session-loss": "_settle_sanity_loss",
}

_ADAPTER_STATE_KEYS = frozenset({
    "_psychology_frozen",
    "_psychology_realized",
    "_check_frozen",
    "_push_frozen",
    "_luck_spend_frozen",
    "_resource_frozen",
    "_damage_frozen",
    "_sanity_frozen",
})


class _RuntimeView:
    """Bind package methods to one generic runtime without inheritance."""

    def __init__(self, adapter: "Coc7RuleGraphAdapter", runtime: Any) -> None:
        object.__setattr__(self, "_adapter", adapter)
        object.__setattr__(self, "_runtime", runtime)

    def __getattr__(self, name: str) -> Any:
        adapter = object.__getattribute__(self, "_adapter")
        runtime = object.__getattribute__(self, "_runtime")
        if name in _ADAPTER_STATE_KEYS:
            return adapter._state_for(runtime)[name]
        descriptor = type(adapter).__dict__.get(name)
        if isinstance(descriptor, staticmethod):
            return descriptor.__func__
        if callable(descriptor):
            return MethodType(descriptor, self)
        return getattr(runtime, name)

    def __setattr__(self, name: str, value: Any) -> None:
        adapter = object.__getattribute__(self, "_adapter")
        runtime = object.__getattribute__(self, "_runtime")
        if name in _ADAPTER_STATE_KEYS:
            adapter._state_for(runtime)[name] = value
            return
        setattr(runtime, name, value)


class Coc7RuleGraphAdapter:
    """Package adapter for composed candidate settlements.

    Returning ``None`` means the generic one-plan/one-executor settlement is
    sufficient. A handled decision returns the normal RulesRuntime envelope.
    """

    def __init__(self) -> None:
        self._runtime_state: WeakKeyDictionary[Any, dict[str, Any]] = (
            WeakKeyDictionary()
        )

    def _state_for(self, runtime: Any) -> dict[str, Any]:
        state = self._runtime_state.get(runtime)
        if state is None:
            state = {key: {} for key in _ADAPTER_STATE_KEYS}
            self._runtime_state[runtime] = state
        return state

    def _view(self, runtime: Any) -> _RuntimeView:
        return _RuntimeView(self, runtime)

    @staticmethod
    def promotion_blockers(family: str) -> list[str]:
        if family in {
            "healing", "core-check", "push-luck", "social", "psychology", "combat",
            "sanity",
        }:
            return []
        candidate_families = {
            decision_ref.split(":", 3)[2]
            for decision_ref in _SETTLEMENT_METHOD_BY_DECISION
        }
        if family not in candidate_families:
            return []
        return [
            "composed candidate settlement still uses process-local replay state; "
            "bind it to canonical toolbox receipts before promotion"
        ]

    @staticmethod
    def settle_schema() -> dict[str, Any]:
        return {
            "investigator": {
                "type": "string",
                "desc": "injured or recovering investigator id",
            },
            "decision_ref": {
                "type": "string",
                "required": True,
                "enum": list(_GROUP_ONE_SETTLE_DECISION_REFS),
                "desc": "semantic decision ref from a machine-projected card",
            },
            "semantic_inputs": {
                "type": "object",
                "required": True,
                "additionalProperties": False,
                "desc": "Keeper-semantic inputs; host-locked fields are forbidden",
                "properties": {
                    "rescuer_ref": {"type": "string"},
                    "assistant_rescuer_ref": {"type": "string"},
                    "changed_method": {"type": "string"},
                    "failure_consequence": {"type": "string"},
                    "complete_rest": {"type": "boolean"},
                    "poor_environment": {"type": "boolean"},
                    "skill": {"type": "string"},
                    "characteristic": {"type": "string"},
                    "combined_target_refs": {
                        "type": "array", "items": {"type": "string"},
                    },
                    "combined_mode": {"type": "string", "enum": ["any", "all"]},
                    "difficulty": {
                        "type": "string", "enum": ["regular", "hard", "extreme"],
                    },
                    "goal": {"type": "string"},
                    "stakes": {"type": "object"},
                    "difficulty_basis": {"type": "string"},
                    "bonus": {"type": "integer"},
                    "penalty": {"type": "integer"},
                    "actor_check_ref": {"type": "string"},
                    "opponent_check_ref": {"type": "string"},
                    "method_changed": {"type": "string"},
                    "failure_consequence": {"type": "string"},
                    "player_confirmed_risk": {"type": "boolean"},
                    "points": {"type": "integer"},
                    "described_action": {"type": "string"},
                    "target_ref": {"type": "string"},
                    "commitment_ref": {"type": "string"},
                    "approach": {
                        "type": "string",
                        "enum": ["charm", "fast_talk", "intimidate", "persuade"],
                    },
                    "motive_direction": {
                        "type": "string",
                        "enum": ["support", "neutral", "oppose"],
                    },
                    "motive_intensity": {"type": "integer"},
                    "supporting_action": {"type": "object"},
                    "feasibility": {
                        "type": "string",
                        "enum": ["automatic", "roll", "conditional", "impossible"],
                    },
                    "target_ref": {"type": "string"},
                    "question": {"type": "string"},
                    "external_behavior": {"type": "string"},
                    "candidate_ref": {"type": "string"},
                    "weapon_ref": {"type": "string"},
                    "weapon_effect_refs": {
                        "type": "array", "items": {"type": "string"},
                    },
                    "luck_spend_max": {"type": "integer"},
                    "defense_kind": {
                        "type": "string",
                        "enum": ["dodge", "fight_back", "dive_for_cover", "none"],
                    },
                    "source": {"type": "string"},
                    "loss_success": {"type": "string"},
                    "loss_failure": {"type": "string"},
                    "trigger_ref": {"type": "string"},
                    "involuntary_kind": {"type": "string"},
                    "involuntary_summary": {"type": "string"},
                    "request_reality_check": {"type": "boolean"},
                    "gain_source": {"type": "string"},
                    "insight": {"type": "string"},
                    "outcome": {"type": "string"},
                },
            },
            "decision_id": {
                "type": "string",
                "required": True,
                "desc": "idempotency key",
            },
        }

    @staticmethod
    def state_effect_domains(decision_ref: str) -> tuple[str, ...]:
        """Package-owned authority for graph settlement state receipts."""
        if decision_ref in _HEALING_SETTLE_DECISION_REFS:
            return ("hp", "condition")
        if decision_ref == _LUCK_SPEND_REF:
            return ("luck",)
        if decision_ref in _SANITY_SETTLE_DECISION_REFS:
            return ("san", "condition")
        return ()

    @staticmethod
    def context_schema() -> dict[str, Any]:
        return {
            "investigator": {
                "type": "string",
                "desc": "investigator whose live state binds the card grant",
            },
            "family": {
                "type": "string",
                "enum": [
                    "healing", "core-check", "push-luck", "social", "psychology",
                    "combat",
                    "sanity",
                ],
                "desc": "source-accepted compiled family",
            },
            "selected_affordance_ids": {
                "type": "array",
                "items": {"type": "string"},
                "desc": "optional semantic decision refs to narrow the card set",
            },
        }

    @staticmethod
    def operation_policy_overrides(
        package_manifest: Mapping[str, Any],
    ) -> dict[str, dict[str, Any]]:
        ownership = {
            str(row.get("family_id")): (
                str(row.get("runtime_owner") or "legacy"),
                str(row.get("legacy_surface") or "visible"),
            )
            for row in package_manifest.get("rule_families") or []
            if isinstance(row, Mapping) and isinstance(row.get("family_id"), str)
        }
        legacy_by_family = {
            "healing": (
                "rules.first_aid", "rules.dying_check", "rules.medicine",
                "rules.weekly_recovery",
            ),
            "core-check": ("rules.roll", "rules.opposed", "rules.check"),
            "push-luck": ("rules.push", "rules.luck_spend"),
            "social": ("rules.social_adjudicate",),
            "psychology": ("rules.psychology_observe",),
            "combat": ("combat.context", "combat.resolve", "combat.end"),
            "sanity": ("rules.sanity_check", "sanity.context", "sanity.execute"),
        }
        overrides: dict[str, dict[str, Any]] = {}
        any_graph_visible = False
        for family, legacy_operations in legacy_by_family.items():
            owner, surface = ownership.get(family, ("legacy", "visible"))
            graph_visible = owner == "graph" and surface in {"hidden", "removed"}
            any_graph_visible = any_graph_visible or graph_visible
            for operation in legacy_operations:
                overrides[operation] = (
                    {
                        "audience": "host",
                        "kp_surface": "none",
                        "phases": ("live_turn",),
                    }
                    if graph_visible
                    else {
                        "audience": "keeper",
                        "kp_surface": "rules",
                        "phases": ("live_turn",),
                    }
                )
        overrides["rules.settle"] = (
            {
                "audience": "keeper",
                "kp_surface": "rules",
                "phases": ("live_turn",),
            }
            if any_graph_visible
            else {
                "audience": "host",
                "kp_surface": "none",
                "phases": ("live_turn",),
            }
        )
        return overrides

    @staticmethod
    def host_capability_index() -> dict[str, dict[str, Any]]:
        """Existing typed host operations accepted by the graph compiler."""
        return {
            "combat.resolve": {"adapter": "typed_operation"},
            "combat.end": {"adapter": "typed_operation"},
            "rules.sanity_check": {"adapter": "typed_operation"},
            "sanity.context": {"adapter": "typed_operation"},
            "sanity.execute": {"adapter": "typed_operation"},
            "sanity.session.gain_san": {"adapter": "sanity.execute"},
            "sanity.session.reality_check": {"adapter": "sanity.execute"},
            "time.recover_temporary_insanity": {"adapter": "sanity.execute"},
            "time.apply_psychoanalysis_treatment": {"adapter": "sanity.execute"},
        }

    @staticmethod
    def augment_facts(
        runtime: Any,
        selected: Mapping[str, Any] | None,
        facts: Mapping[str, Any],
    ) -> dict[str, Any]:
        augmented = dict(facts)
        augmented.setdefault("intent.rescuer_count", 1)
        semantic = (
            selected.get("semantic_inputs")
            if isinstance(selected, Mapping)
            and isinstance(selected.get("semantic_inputs"), Mapping)
            else {}
        )
        assistant = semantic.get("assistant_rescuer_ref")
        if isinstance(assistant, str) and assistant.strip():
            augmented["intent.rescuer_count"] = 2
        source_receipt = (
            selected.get("_host_source_receipt")
            if isinstance(selected, Mapping)
            and isinstance(selected.get("_host_source_receipt"), Mapping)
            else {}
        )
        if source_receipt:
            outcome = source_receipt.get("outcome")
            if isinstance(outcome, str) and outcome:
                augmented["receipt.last_outcome"] = outcome
            augmented["intent.pushed"] = bool(source_receipt.get("pushed", False))
        return augmented

    @staticmethod
    def host_locked_provider(
        ctx: Any,
        args: dict[str, Any],
        selected: Mapping[str, Any],
        *,
        resolve_investigator: Callable[[Any, dict[str, Any]], str],
        safe_sheet: Callable[[Any, str], Mapping[str, Any] | None],
        skill_value: Callable[[Mapping[str, Any] | None, str], int | None],
        card_grant: Mapping[str, Any] | None = None,
    ) -> Callable[[str], Mapping[str, Any]]:
        semantic = (
            selected.get("semantic_inputs")
            if isinstance(selected.get("semantic_inputs"), Mapping)
            else {}
        )

        def provider(decision_ref: str) -> Mapping[str, Any]:
            investigator_id = resolve_investigator(ctx, args)
            rescuer_id = str(semantic.get("rescuer_ref") or investigator_id)
            locked: dict[str, Any] = {}
            if "first-aid" in decision_ref:
                sheet = safe_sheet(ctx, rescuer_id) or safe_sheet(
                    ctx, investigator_id,
                ) or {}
                value = skill_value(sheet, "First Aid")
                if value is not None:
                    locked["skill_value"] = value
                locked["rescuer_id"] = rescuer_id
                locked["pushed"] = bool(
                    semantic.get("changed_method")
                    or semantic.get("failure_consequence")
                )
                assistant_id = semantic.get("assistant_rescuer_ref")
                if isinstance(assistant_id, str) and assistant_id.strip():
                    assistant_id = assistant_id.strip()
                    assistant_sheet = safe_sheet(ctx, assistant_id)
                    assistant_value = skill_value(
                        assistant_sheet, "First Aid",
                    )
                    if assistant_value is not None:
                        locked["assistant_skill_value"] = assistant_value
                        locked["assistant_rescuer_id"] = assistant_id
            elif "medicine" in decision_ref:
                sheet = safe_sheet(ctx, rescuer_id) or safe_sheet(
                    ctx, investigator_id,
                ) or {}
                value = skill_value(sheet, "Medicine")
                if value is not None:
                    locked["skill_value"] = value
                locked["rescuer_id"] = rescuer_id
            elif "weekly" in decision_ref:
                caregiver = str(semantic.get("rescuer_ref") or investigator_id)
                sheet = safe_sheet(ctx, caregiver) or {}
                value = skill_value(sheet, "Medicine")
                if value is not None:
                    locked["medicine_skill_value"] = value
                    locked["caregiver_id"] = caregiver
            elif decision_ref in _CORE_SETTLE_DECISION_REFS or decision_ref == "decision:coc7:push-luck:luck-roll":
                sheet = safe_sheet(ctx, investigator_id) or {}
                locked["investigator_id"] = investigator_id
                if decision_ref.endswith(":ordinary-check"):
                    ref = (
                        f"skill:{semantic['skill']}" if semantic.get("skill")
                        else f"characteristic:{semantic['characteristic']}"
                        if semantic.get("characteristic") else ""
                    )
                    resolved = _sheet_check(sheet, ref)
                    if resolved is not None:
                        locked["target"] = resolved[1]
                elif decision_ref.endswith(":combined-check"):
                    rows = []
                    for ref in semantic.get("combined_target_refs") or []:
                        resolved = _sheet_check(sheet, str(ref))
                        if resolved is not None:
                            rows.append({"label": resolved[0], "value": resolved[1]})
                    if rows:
                        locked["combined_targets"] = rows
                elif decision_ref.endswith(":opposed-check"):
                    actor = _sheet_check(sheet, str(semantic.get("actor_check_ref") or ""))
                    opponent = _npc_check(ctx, str(semantic.get("opponent_check_ref") or ""))
                    if actor is not None:
                        locked["investigator_target"] = actor[1]
                    if opponent is not None:
                        locked["opponent_value"] = opponent[1]
                elif decision_ref.endswith(":luck-roll"):
                    resolved = _sheet_check(sheet, "characteristic:luck")
                    if resolved is not None:
                        locked["target"] = resolved[1]
            elif decision_ref in {_PUSHED_ROLL_REF, _LUCK_SPEND_REF}:
                source_decision_id = (
                    str(card_grant.get("source_decision_id") or "")
                    if isinstance(card_grant, Mapping) else ""
                )
                prior = (
                    ctx.ledger_lookup("rules.settle", source_decision_id)
                    if source_decision_id else None
                )
                prior_data = (
                    prior.get("data") if isinstance(prior, Mapping)
                    and isinstance(prior.get("data"), Mapping) else {}
                )
                settlement = (
                    prior_data.get("settlement")
                    if isinstance(prior_data.get("settlement"), Mapping) else {}
                )
                result = (
                    settlement.get("result")
                    if isinstance(settlement.get("result"), Mapping) else {}
                )
                check = (
                    result.get("bound_check")
                    if isinstance(result.get("bound_check"), Mapping) else {}
                )
                if source_decision_id and check:
                    locked.update({
                        "original_check_decision_id": source_decision_id,
                        "canonical_roll_receipt": _thaw(check),
                        "continuation_grant": _thaw(dict(card_grant or {})),
                        "investigator_id": check.get("investigator_id"),
                    })
                    if decision_ref == _LUCK_SPEND_REF:
                        locked["source_roll_id"] = check.get("roll_id")
                    else:
                        for key in ("target", "difficulty", "bonus", "penalty", "skill"):
                            if check.get(key) is not None:
                                locked[key] = check[key]
            elif decision_ref in _SOCIAL_SETTLE_DECISION_REFS:
                binding = (
                    selected.get("_host_social_binding")
                    if isinstance(selected.get("_host_social_binding"), Mapping)
                    else {}
                )
                evidence = binding.get("motive_evidence")
                if isinstance(evidence, (list, tuple)):
                    locked["motive_evidence"] = list(evidence)
            elif decision_ref in _PSYCHOLOGY_SETTLE_DECISION_REFS:
                binding = (
                    selected.get("_host_psychology_binding")
                    if isinstance(selected.get("_host_psychology_binding"), Mapping)
                    else {}
                )
                for key in (
                    "investigator_id", "npc_id", "observer_skill",
                    "target_opposing_social", "conversation_window_id",
                    "observation_revision", "observer_scope",
                    "observable_fact_refs", "inference_ceiling",
                    "observation_receipt_ref",
                ):
                    if binding.get(key) is not None:
                        locked[key] = _thaw(binding[key])
            elif decision_ref in _COMBAT_SETTLE_DECISION_REFS:
                binding = (
                    selected.get("_host_combat_binding")
                    if isinstance(selected.get("_host_combat_binding"), Mapping)
                    else {}
                )
                for key, value in binding.items():
                    if value is not None:
                        locked[str(key)] = _thaw(value)
            elif decision_ref in _SANITY_SETTLE_DECISION_REFS:
                binding = (
                    selected.get("_host_sanity_binding")
                    if isinstance(selected.get("_host_sanity_binding"), Mapping)
                    else {}
                )
                for key, value in binding.items():
                    if value is not None:
                        locked[str(key)] = _thaw(value)
            return locked

        return provider

    @staticmethod
    def executor_args(
        ctx: Any,
        plan: Mapping[str, Any],
        selected: Mapping[str, Any],
        args: dict[str, Any],
        *,
        resolve_investigator: Callable[[Any, dict[str, Any]], str],
        tool_error: Callable[..., Exception],
    ) -> dict[str, Any]:
        payload = (plan.get("command") or {}).get("payload") or {}
        if not isinstance(payload, dict):
            payload = {}
        semantic = (
            selected.get("semantic_inputs")
            if isinstance(selected.get("semantic_inputs"), Mapping)
            else {}
        )
        investigator_id = str(args.get("investigator") or "") or None
        if not investigator_id:
            investigator_id = resolve_investigator(ctx, args)
        out: dict[str, Any] = {
            "investigator": investigator_id,
            "decision_id": str(args["decision_id"]),
        }
        if args.get("seed") is not None:
            # Host/test transport only. The model-visible rules.settle schema
            # deliberately omits RNG control.
            out["seed"] = args["seed"]
        capability = (plan.get("capability") or {}).get("resolver_capability")
        if capability == "first_aid":
            if "skill_value" not in payload:
                raise tool_error(
                    "missing_param",
                    "host-locked First Aid skill_value could not be resolved",
                )
            out.update({
                "skill_value": payload["skill_value"],
                "rescuer_id": (
                    payload.get("rescuer_id")
                    or semantic.get("rescuer_ref")
                    or investigator_id
                ),
                "pushed": bool(payload.get("pushed", False)),
            })
            for key in ("changed_method", "failure_consequence"):
                if semantic.get(key):
                    out[key] = semantic[key]
            assistant_ref = semantic.get("assistant_rescuer_ref")
            if isinstance(assistant_ref, str) and assistant_ref.strip():
                if (
                    payload.get("assistant_skill_value") is None
                    or not isinstance(payload.get("assistant_rescuer_id"), str)
                ):
                    raise tool_error(
                        "missing_param",
                        "host-locked assistant First Aid skill could not be resolved",
                    )
                out["assistant_skill_value"] = payload["assistant_skill_value"]
                out["assistant_rescuer_id"] = payload["assistant_rescuer_id"]
        elif capability == "medicine":
            if "skill_value" not in payload:
                raise tool_error(
                    "missing_param",
                    "host-locked Medicine skill_value could not be resolved",
                )
            out.update({
                "skill_value": payload["skill_value"],
                "rescuer_id": (
                    payload.get("rescuer_id")
                    or semantic.get("rescuer_ref")
                    or investigator_id
                ),
            })
        elif capability == "dying_check":
            out["clock_kind"] = payload.get("clock_kind")
        elif capability == "weekly_recovery":
            out["complete_rest"] = semantic.get(
                "complete_rest", payload.get("complete_rest")
            )
            out["poor_environment"] = semantic.get(
                "poor_environment", payload.get("poor_environment")
            )
            for key in ("medicine_skill_value", "caregiver_id"):
                if payload.get(key) is not None:
                    out[key] = payload[key]
        elif capability == "check":
            for key in (
                "skill", "characteristic", "target", "combined_targets",
                "combined_mode", "difficulty", "goal", "stakes",
                "difficulty_basis", "bonus", "penalty", "npc_id",
                "social_adjudication_ref",
            ):
                if payload.get(key) is not None:
                    out[key] = _thaw(payload[key])
            # Luck-roll's graph constant is authoritative.
            if payload.get("characteristic") == "LUCK":
                out["characteristic"] = "LUCK"
        elif capability == "opposed":
            actor_ref = str(payload.get("actor_check_ref") or "")
            kind, _, label = actor_ref.partition(":")
            if kind == "skill" and label:
                out["skill"] = label.replace("-", " ").title()
            elif kind == "characteristic" and label:
                out["characteristic"] = label.upper()
            else:
                raise tool_error(
                    "invalid_semantic_input",
                    "actor_check_ref must be skill:<slug> or characteristic:<slug>",
                )
            if payload.get("investigator_target") is not None:
                out["target"] = payload["investigator_target"]
            if payload.get("opponent_value") is None:
                raise tool_error(
                    "missing_param", "host-locked opponent value could not be resolved",
                )
            out.update({
                "contest_kind": "noncombat",
                "opponent_value": payload["opponent_value"],
                "opponent_label": str(payload.get("opponent_check_ref") or "opponent"),
                "reason": "RuleGraph opposed check",
            })
        elif capability == "push_policy":
            for key in (
                "original_check_decision_id", "method_changed",
                "failure_consequence",
            ):
                if payload.get(key) is not None:
                    out[key] = payload[key]
        elif capability == "luck_spend":
            for key in ("points", "source_roll_id"):
                if payload.get(key) is not None:
                    out[key] = payload[key]
        elif capability == "social_difficulty":
            binding = (
                selected.get("_host_social_binding")
                if isinstance(selected.get("_host_social_binding"), Mapping)
                else {}
            )
            required_binding = (
                "npc_id", "conversation_window_id", "commitment_id",
                "motive_evidence",
            )
            missing = [key for key in required_binding if not binding.get(key)]
            if missing:
                raise tool_error(
                    "social_candidate_stale",
                    "canonical social target binding is unavailable",
                    details={"missing": missing},
                )
            out.update({
                "npc_id": binding["npc_id"],
                "conversation_window_id": binding["conversation_window_id"],
                "commitment_id": binding["commitment_id"],
                "approach": payload.get("approach"),
                "goal_summary": payload.get("goal"),
                "motive": {
                    "direction": payload.get("motive_direction"),
                    "intensity": payload.get("motive_intensity"),
                    "evidence_refs": list(binding["motive_evidence"]),
                },
                "feasibility": payload.get("feasibility"),
                "feasibility_refs": list(binding["motive_evidence"]),
            })
            if payload.get("npc_defense") is not None:
                out["npc_defense_value"] = payload["npc_defense"]
            supporting = payload.get("supporting_action")
            if isinstance(supporting, Mapping) and supporting.get("level") == 1:
                source_ref = str(supporting.get("source_ref") or "").strip()
                if not source_ref:
                    raise tool_error(
                        "invalid_semantic_input",
                        "supporting_action level 1 requires canonical source_ref",
                    )
                out["leverage"] = [{
                    "leverage_id": str(
                        supporting.get("leverage_id") or f"support:{source_ref}"
                    ),
                    "source_ref": source_ref,
                    "independence_group": str(
                        supporting.get("independence_group") or source_ref
                    ),
                    "credibility": "verified",
                    "relevance": "direct",
                    "reason": str(supporting.get("description") or "supporting case"),
                    "type": str(supporting.get("type") or "supporting_action"),
                }]
            else:
                out["leverage"] = []
        elif capability in {"psychology_check_contract", "psychology_policy"}:
            binding = (
                selected.get("_host_psychology_binding")
                if isinstance(selected.get("_host_psychology_binding"), Mapping)
                else {}
            )
            required = (
                "npc_id", "conversation_window_id", "observation_revision",
                "observer_scope",
            )
            missing = [key for key in required if binding.get(key) is None]
            if missing:
                raise tool_error(
                    "psychology_candidate_stale",
                    "canonical Psychology target binding is unavailable",
                    details={"missing": missing},
                )
            out.update({
                "action": (
                    "realize" if capability == "psychology_policy" else "settle"
                ),
                "npc_id": binding["npc_id"],
                "conversation_window_id": binding["conversation_window_id"],
                "observation_revision": binding["observation_revision"],
                "observer_scope": binding["observer_scope"],
                "question": str(
                    payload.get("question") or binding.get("question") or ""
                ),
            })
            if capability == "psychology_check_contract":
                out["observable_fact_refs"] = list(
                    binding.get("observable_fact_refs") or []
                )
            else:
                out.update({
                    "insight_id": binding.get("observation_receipt_ref"),
                    "visible_observation": payload.get("external_behavior"),
                })
        elif capability == "combat.resolve":
            action = str(plan.get("decision_ref") or "").rsplit(":", 1)[-1]
            if not action:
                raise tool_error("missing_param", "host-locked combat action is unavailable")
            out["action_kind"] = action
            for source, target in (
                ("affordance_id", "affordance_id"),
                ("target_npc_id", "target_npc_id"),
                ("weapon_id", "weapon_id"),
                ("weapon_effect_ids", "weapon_effect_ids"),
                ("combat_revision", "combat_revision"),
                ("defense_kind", "defense_kind"),
                ("luck_spend_max", "luck_spend_max"),
                ("goal", "goal"),
            ):
                if payload.get(source) is not None:
                    out[target] = _thaw(payload[source])
        elif capability == "combat.end":
            outcome = str(payload.get("outcome") or "")
            if not outcome:
                raise tool_error(
                    "combat_outcome_unavailable",
                    "combat.end requires a mechanically concluded canonical outcome",
                )
            out["outcome"] = outcome
        elif capability == "rules.sanity_check":
            out.update({
                "source": payload.get("source"),
                "loss_success": payload.get("loss_success", "0"),
                "loss_failure": payload.get("loss_failure"),
                "trigger_id": payload.get("trigger_id"),
                "involuntary_action": {
                    "kind": payload.get("involuntary_kind"),
                    "summary": payload.get("involuntary_summary"),
                },
            })
        elif capability in {
            "sanity.execute", "sanity.session.gain_san",
            "sanity.session.reality_check", "sanity.context",
            "time.recover_temporary_insanity",
            "time.apply_psychoanalysis_treatment",
        }:
            suffix = str(plan.get("decision_ref") or "").rsplit(":", 1)[-1]
            kind = {
                "bout-tick": "bout_tick",
                "bout-end": "bout_end",
                "reality-check": "reality_check",
                "gain-current-san": "gain_current_san",
                "insane-insight": "insane_insight",
                "apply-treatment": "apply_psychoanalysis_treatment",
                "recover-temporary": "recover_temporary_insanity",
            }.get(suffix)
            phase = str((plan.get("command") or {}).get("phase") or "resolve")
            if not kind:
                raise tool_error("unsupported_ruleset_operation", "unknown sanity phase")
            command_id = f"{args['decision_id']}:command"
            command_payload: dict[str, Any] = {"decision_id": str(args["decision_id"])}
            if kind in {"bout_tick", "bout_end"}:
                command_payload.update({
                    "choice_id": payload.get("pending_choice_ref"),
                    "responder": "keeper",
                    "revision": payload.get("bout_revision"),
                    "action": "tick" if kind == "bout_tick" else "end",
                    "terminal_command_ids": [command_id],
                })
                phase = "resolve"
            elif kind == "reality_check":
                command_payload["request_reality_check"] = payload.get(
                    "request_reality_check"
                )
            elif kind == "gain_current_san":
                if payload.get("san_gain") is None:
                    raise tool_error(
                        "sanity_gain_receipt_unavailable",
                        "gain-current-san requires a canonical host SAN gain receipt",
                    )
                command_payload.update({
                    "san_gain": payload.get("san_gain"),
                    "gain_source": payload.get("gain_source"),
                })
            elif kind == "insane_insight":
                command_payload["insight"] = payload.get("insight")
            elif kind == "apply_psychoanalysis_treatment":
                command_payload["treatment_trigger_ref"] = payload.get(
                    "treatment_trigger_ref"
                )
            elif kind == "recover_temporary_insanity":
                command_payload["recovery_trigger_ref"] = payload.get(
                    "recovery_trigger_ref"
                )
            out["command"] = {
                "command_id": command_id,
                "kind": kind,
                "phase": phase,
                "payload": command_payload,
            }
        else:
            raise tool_error(
                "unsupported_ruleset_operation",
                f"no CoC7 adapter for capability {capability!r}",
            )
        return out

    @staticmethod
    def is_context_only(decision_ref: str) -> bool:
        return decision_ref in (
            *LOOKUP_CONTEXT_DECISION_REFS, _COMBAT_CONTEXT_REF, _SANITY_CONTEXT_REF,
        )

    def context_lookup(
        self,
        runtime: Any,
        question: Mapping[str, Any],
        family: str,
        facts: Mapping[str, Any],
    ) -> dict[str, Any]:
        return self._view(runtime)._context_lookup(question, family, facts)

    def prepare_settlement(
        self,
        runtime: Any,
        decision_ref: str,
        decision_id: str,
        selected: Mapping[str, Any],
    ) -> dict[str, Any]:
        if (
            decision_ref != _PSYCHOLOGY_REALIZE_REF
            or isinstance(selected.get("_host_psychology_binding"), Mapping)
        ):
            return {}
        observe_id = _paired_observe_decision_id(decision_id)
        frozen = (
            self._view(runtime)._psychology_frozen.get(observe_id)
            if observe_id is not None else None
        )
        if observe_id is None or frozen is None:
            return {}
        return {"host_locked": {
            "inference_ceiling": frozen["inference_ceiling"],
        }}

    def settle(
        self,
        runtime: Any,
        executor: Callable[..., Any],
        plan: Mapping[str, Any],
        decision_id: str,
        selected: Mapping[str, Any],
        facts: Mapping[str, Any],
        envelope: dict[str, Any],
    ) -> dict[str, Any] | None:
        method_name = _SETTLEMENT_METHOD_BY_DECISION.get(
            str(plan.get("decision_ref") or "")
        )
        if method_name is None:
            return None
        method = getattr(self._view(runtime), method_name, None)
        if not callable(method):
            raise RuntimeError(
                f"CoC7 RuleGraph adapter requires runtime method {method_name}"
            )
        return method(executor, plan, decision_id, selected, facts, envelope)
    @staticmethod
    def _split_executor_result(executed: Any) -> tuple[Any, list[str], list[str]]:
        data = executed
        warnings: list[str] = []
        hints: list[str] = []
        if isinstance(executed, tuple):
            data = executed[0] if executed else None
            if len(executed) > 1 and isinstance(executed[1], list):
                warnings = list(executed[1])
            if len(executed) > 2 and isinstance(executed[2], list):
                hints = list(executed[2])
        return data, warnings, hints

    @staticmethod
    def _settled_envelope(
        envelope: dict[str, Any],
        plan: Mapping[str, Any],
        result: Any,
        warnings: list[str],
        hints: list[str],
        *,
        extra: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        base = {
            "status": "settled",
            "settlement": {
                "existing_result_envelope": True,
                "execution": "canonical-resolver-subsystem",
                "plan": plan,
                "result": result,
            },
        }
        if extra:
            base.update(extra)
        envelope.update(base)
        if warnings:
            envelope["warnings"] = warnings
        if hints:
            envelope["hints"] = hints
        return envelope

    @staticmethod
    def _validate_social_provenance(payload: Mapping[str, Any]) -> dict[str, Any] | None:
        """Deterministic social provenance gate (mirrors the R4 contract).

        Returns a failure dict (code/message/fields/missing), or None when
        the semantics are coherent.  These are the R4 contract's own
        requirements expressed as runtime gates so an incoherent selection
        never reaches the executor.
        """
        direction = str(payload.get("motive_direction") or "")
        intensity = payload.get("motive_intensity")
        evidence = payload.get("motive_evidence")
        if isinstance(evidence, (tuple, frozenset)):
            evidence = list(evidence)
        if direction not in {"support", "neutral", "oppose"}:
            return {
                "code": "invalid_semantic_input",
                "message": "motive_direction must be support|neutral|oppose",
                "fields": ["motive_direction"],
            }
        if isinstance(intensity, bool) or not isinstance(intensity, int) or intensity not in (0, 1, 2):
            return {
                "code": "invalid_semantic_input",
                "message": "motive_intensity must be 0, 1, or 2",
                "fields": ["motive_intensity"],
            }
        if intensity > 0 and not isinstance(evidence, list):
            return {
                "code": "invalid_semantic_input",
                "message": (
                    "motive.intensity > 0 requires motive.evidence_refs"
                ),
                "fields": ["motive_evidence"],
                "missing": ["motive_evidence"],
            }
        if intensity > 0 and not evidence:
            return {
                "code": "invalid_semantic_input",
                "message": (
                    "motive.intensity > 0 requires at least one "
                    "motive.evidence_ref"
                ),
                "fields": ["motive_evidence"],
                "missing": ["motive_evidence"],
            }
        supporting_action = payload.get("supporting_action")
        if supporting_action is not None:
            if not isinstance(supporting_action, Mapping):
                return {
                    "code": "invalid_semantic_input",
                    "message": "supporting_action must be an object",
                    "fields": ["supporting_action"],
                }
            description = supporting_action.get("description", "")
            if not isinstance(description, str):
                return {
                    "code": "invalid_semantic_input",
                    "message": (
                        "supporting_action.description must be a string"
                    ),
                    "fields": ["supporting_action"],
                }
            level = supporting_action.get("level", 0)
            if (
                isinstance(level, bool)
                or not isinstance(level, int)
                or level not in {0, 1}
            ):
                return {
                    "code": "invalid_semantic_input",
                    "message": "supporting_action.level must be 0 or 1",
                    "fields": ["supporting_action"],
                }
            provenance = supporting_action.get("provenance", "")
            if not isinstance(provenance, str):
                return {
                    "code": "invalid_semantic_input",
                    "message": (
                        "supporting_action.provenance must be a string"
                    ),
                    "fields": ["supporting_action"],
                }
        return None

    def _settle_social(
        self,
        executor: Callable[..., Any],
        plan: Mapping[str, Any],
        decision_id: str,
        selected: Mapping[str, Any],
        facts: Mapping[str, Any],
        envelope: dict[str, Any],
    ) -> dict[str, Any]:
        """One social settlement: adjudicate + bound check (spec §11.2).

        Single settlement combining adjudication and the bound percentile
        check.  ``executor`` is invoked for the adjudication only; if (and
        ONLY if) ``feasibility == 'roll'`` the runtime machine-derives the
        bound-check plan from the adjudication result (skill = approach
        skill, difficulty = final difficulty, bonus/penalty dice = the
        adjudication's own arithmetic) — never from the model's inputs — and
        invokes the SAME executor for that check.  Automatic/conditional
        results return without rolling.  No second model-authored transfer of
        skill, difficulty, bonus/penalty, NPC, or goal identity.
        """
        payload = (plan.get("command") or {}).get("payload") or {}
        if not isinstance(payload, Mapping):
            payload = {}
        provenance = self._validate_social_provenance(payload)
        if provenance is not None:
            return {
                "schema_version": self.SCHEMA_VERSION,
                "decision_ref": plan["decision_ref"],
                "decision_id": decision_id,
                "family": plan["family"],
                "status": "invalid_semantic_input",
                "failure": provenance,
            }
        adjudicated = executor(_thaw(plan), decision_id, selected)
        data, warnings, hints = self._split_executor_result(adjudicated)
        if not isinstance(data, Mapping) or "feasibility" not in data:
            return {
                "schema_version": self.SCHEMA_VERSION,
                "decision_ref": plan["decision_ref"],
                "decision_id": decision_id,
                "family": plan["family"],
                "status": "invalid_settlement_result",
                "failure": {
                    "code": "invalid_settlement_result",
                    "message": (
                        "bound adjudication must return feasibility; no second "
                        "model-authored transfer is accepted"
                    ),
                },
            }
        feasibility = str(data.get("feasibility") or "")
        result: dict[str, Any] = {"adjudication": _thaw(data)}
        if feasibility == "roll":
            # Machine-derived bound check; the model NEVER re-expresses skill,
            # difficulty, bonus/penalty, NPC, or goal identity (spec §11.2).
            derived = self._social_bound_check_plan(plan, data)
            check = executor(_thaw(derived), decision_id, selected)
            check_data, check_warnings, check_hints = self._split_executor_result(check)
            warnings = list(warnings) + list(check_warnings)
            hints = list(hints) + list(check_hints)
            result["bound_check"] = _thaw(check_data)
            result["bound_check_plan"] = _freeze(derived)
        else:
            hints = list(hints) + [
                f"feasibility is {feasibility}: no bound roll is settled"
            ]
            if feasibility == "automatic":
                hints.append("automatic success — play the compliance in fiction")
            elif feasibility == "conditional":
                hints.append(
                    "the goal cannot be settled by a roll now; pursue the "
                    "recorded requirements or change approach/target"
                )
        return self._settled_envelope(
            envelope, plan, _freeze(result), warnings, hints,
            extra={"visibility": "keeper-only"},
        )

    def _social_bound_check_plan(
        self,
        plan: Mapping[str, Any],
        adjudication: Mapping[str, Any],
    ) -> dict[str, Any]:
        """Machine-derived percentile check for one rolled social attempt."""
        payload = (plan.get("command") or {}).get("payload") or {}
        if not isinstance(payload, Mapping):
            payload = {}
        rule_refs = list(plan.get("rule_refs") or [])
        check_payload: dict[str, Any] = {
            "skill": str(adjudication.get("approach_skill") or ""),
            "difficulty": str(adjudication.get("final_difficulty") or "regular"),
            "bonus": int(adjudication.get("bonus_dice") or 0),
            "penalty": int(adjudication.get("penalty_dice") or 0),
            "difficulty_basis": "opponent_skill",
            "goal": payload.get("goal"),
            "npc_id": adjudication.get("npc_id"),
            "social_adjudication_ref": adjudication.get("goal_key"),
        }
        return {
            "schema_version": self.SCHEMA_VERSION,
            "decision_ref": plan["decision_ref"],
            "family": plan["family"],
            "capability": {
                "ref": "capability:coc7:check",
                "adapter": "resolver",
                "resolver_capability": "check",
            },
            "command": {
                "kind": "check",
                "phase": "resolve",
                "payload": _freeze(check_payload),
            },
            "rule_refs": rule_refs,
            "source_refs": list(plan.get("source_refs") or []),
            "resource_effects": [],
            "visibility": "keeper-only",
            "pending_choices": [],
            "next_decisions": [],
            "machine_derived": True,
        }

    def _settle_psychology_observe(
        self,
        executor: Callable[..., Any],
        plan: Mapping[str, Any],
        decision_id: str,
        selected: Mapping[str, Any],
        facts: Mapping[str, Any],
        envelope: dict[str, Any],
    ) -> dict[str, Any]:
        """Execute the existing durable concealed-observation operation once."""
        durable = isinstance(selected.get("_host_psychology_binding"), Mapping)
        if not durable and decision_id in self._psychology_frozen:
            record = self._psychology_frozen[decision_id]
            return self._settled_envelope(
                envelope, plan, _freeze(record), [],
                ["frozen observation reused: realization may bind it"],
                extra={"visibility": "concealed-result"},
            )
        executed = executor(_thaw(plan), decision_id, selected)
        data, warnings, hints = self._split_executor_result(executed)
        if not isinstance(data, Mapping):
            return {
                "schema_version": self.SCHEMA_VERSION,
                "decision_ref": plan["decision_ref"],
                "decision_id": decision_id,
                "family": plan["family"],
                "status": "invalid_settlement_result",
                "failure": {
                    "code": "invalid_settlement_result",
                    "message": "concealed observation must return a record",
                },
            }
        ceiling = _observation_inference_ceiling(data)
        insight_id = data.get("insight_id")
        if ceiling is None or (
            durable and (not isinstance(insight_id, str) or not insight_id)
        ):
            return {
                "schema_version": self.SCHEMA_VERSION,
                "decision_ref": plan["decision_ref"],
                "decision_id": decision_id,
                "family": plan["family"],
                "status": "invalid_settlement_result",
                "failure": {
                    "code": "invalid_settlement_result",
                    "message": (
                        "concealed observation result lacks durable insight "
                        "identity or inference ceiling"
                    ),
                },
            }
        if durable:
            continuation = self._card(
                _PSYCHOLOGY_REALIZE_REF, self._facts_for_decision(selected),
            )
            if continuation.get("applicability") == "applicable":
                self._issue_card_grant(
                    [continuation], source_decision_id=decision_id,
                )
            result = _thaw(data)
        else:
            result = {
                "decision_id": decision_id,
                "realm": "psychology",
                "inference_ceiling": ceiling,
                "concealed": _thaw(data),
            }
            self._psychology_frozen[decision_id] = deepcopy(result)
        hints = list(hints) + [
            "the roll and outcome are keeper-concealed: the player sees only "
            "the realization's external_behavior; do not expose the die",
        ]
        return self._settled_envelope(
            envelope, plan, _freeze(result), warnings, hints,
            extra={"visibility": "concealed-result"},
        )

    def _settle_psychology_realize(
        self,
        executor: Callable[..., Any],
        plan: Mapping[str, Any],
        decision_id: str,
        selected: Mapping[str, Any],
        facts: Mapping[str, Any],
        envelope: dict[str, Any],
    ) -> dict[str, Any]:
        """Bind player-safe prose through the durable Psychology operation."""
        if not isinstance(selected.get("_host_psychology_binding"), Mapping):
            observe_decision_id = _paired_observe_decision_id(decision_id)
            if observe_decision_id is None:
                return {
                    "schema_version": self.SCHEMA_VERSION,
                    "decision_ref": plan["decision_ref"],
                    "decision_id": decision_id,
                    "family": plan["family"],
                    "status": "invalid_decision_id",
                    "failure": {
                        "code": "invalid_decision_id",
                        "message": "realization decision_id is not paired to an observation",
                    },
                }
            frozen = self._psychology_frozen.get(observe_decision_id)
            if frozen is None:
                return {
                    "schema_version": self.SCHEMA_VERSION,
                    "decision_ref": plan["decision_ref"],
                    "decision_id": decision_id,
                    "family": plan["family"],
                    "status": "rule_decision_not_applicable",
                    "failure": {
                        "code": "rule_decision_not_applicable",
                        "message": "no frozen observation exists for the realization",
                    },
                }
            request_identity = _json_digest({
                "decision_ref": plan["decision_ref"],
                "semantic": selected.get("semantic_inputs"),
            })
            prior = self._psychology_realized.get(decision_id)
            if prior is not None:
                if prior.get("request_identity") != request_identity:
                    return {
                        "schema_version": self.SCHEMA_VERSION,
                        "decision_ref": plan["decision_ref"],
                        "decision_id": decision_id,
                        "family": plan["family"],
                        "status": "decision_conflict",
                        "failure": {
                            "code": "decision_conflict",
                            "message": "decision changed; executor not invoked",
                        },
                    }
                return self._settled_envelope(
                    envelope, plan, _freeze(prior["result"]), [],
                    ["frozen realization reused: identical decision_id"],
                    extra={
                        "visibility": "public",
                        "player_projection": deepcopy(prior["player_projection"]),
                        "concealed_result": deepcopy(prior["concealed_result"]),
                    },
                )
            realized = executor(_thaw(plan), decision_id, selected)
            data, warnings, hints = self._split_executor_result(realized)
            public = data.get("player_projection") if isinstance(data, Mapping) else None
            if not isinstance(public, Mapping):
                return {
                    "schema_version": self.SCHEMA_VERSION,
                    "decision_ref": plan["decision_ref"],
                    "decision_id": decision_id,
                    "family": plan["family"],
                    "status": "concealed_projection_violation",
                    "failure": {"code": "concealed_projection_violation", "message": "missing projection"},
                }
            leaked = sorted(set(public) - PSYCHOLOGY_REALIZATION_PUBLIC_KEYS)
            if leaked:
                return {
                    "schema_version": self.SCHEMA_VERSION,
                    "decision_ref": plan["decision_ref"],
                    "decision_id": decision_id,
                    "family": plan["family"],
                    "status": "concealed_projection_violation",
                    "failure": {"code": "concealed_projection_violation", "leaked": leaked},
                }
            projection = {"external_behavior": _thaw(public.get("external_behavior"))}
            concealed_outcome = _observation_public_outcome(frozen)
            result = {
                "player_projection": _freeze(projection),
                "bound_to_observe": observe_decision_id,
            }
            self._psychology_realized[decision_id] = {
                "request_identity": request_identity,
                "result": _thaw(result),
                "player_projection": dict(projection),
                "concealed_result": dict(concealed_outcome),
            }
            return self._settled_envelope(
                envelope, plan, _freeze(result), warnings, hints,
                extra={
                    "visibility": "public",
                    "player_projection": deepcopy(projection),
                    "concealed_result": concealed_outcome,
                },
            )
        realized = executor(_thaw(plan), decision_id, selected)
        data, warnings, hints = self._split_executor_result(realized)
        if not isinstance(data, Mapping):
            return {
                "schema_version": self.SCHEMA_VERSION,
                "decision_ref": plan["decision_ref"],
                "decision_id": decision_id,
                "family": plan["family"],
                "status": "invalid_settlement_result",
                "failure": {
                    "code": "invalid_settlement_result",
                    "message": "realization must return a projection",
                },
            }
        public = data.get("player_projection")
        if not isinstance(public, Mapping):
            return {
                "schema_version": self.SCHEMA_VERSION,
                "decision_ref": plan["decision_ref"],
                "decision_id": decision_id,
                "family": plan["family"],
                "status": "concealed_projection_violation",
                "failure": {
                    "code": "concealed_projection_violation",
                    "message": (
                        "realization has no player_projection; concealed "
                        "dice/outcome must never surface publicly"
                    ),
                },
            }
        leaked = sorted(
            set(public) - PSYCHOLOGY_REALIZATION_PUBLIC_KEYS
        )
        if leaked:
            return {
                "schema_version": self.SCHEMA_VERSION,
                "decision_ref": plan["decision_ref"],
                "decision_id": decision_id,
                "family": plan["family"],
                "status": "concealed_projection_violation",
                "failure": {
                    "code": "concealed_projection_violation",
                    "message": (
                        "player-safe realization leaked concealed fields"
                    ),
                    "leaked": leaked,
                },
            }
        projection = {"external_behavior": _thaw(public.get("external_behavior"))}
        concealed = data.get("concealed_result")
        concealed_outcome = _thaw(concealed) if isinstance(concealed, Mapping) else {}
        result = _thaw(data)
        return self._settled_envelope(
            envelope, plan, _freeze(result), warnings, hints,
            extra={
                "visibility": "public",
                "player_projection": deepcopy(projection),
                "concealed_result": concealed_outcome,
            },
        )

    @staticmethod
    def _check_request_identity(
        plan: Mapping[str, Any], selected: Mapping[str, Any],
    ) -> str:
        return _json_digest({
            "decision_ref": plan["decision_ref"],
            "semantic": selected.get("semantic_inputs"),
        })

    def _replay_or_conflict(
        self,
        store: dict[str, dict[str, Any]],
        decision_id: str,
        request_identity: str,
        plan: Mapping[str, Any],
        envelope: dict[str, Any],
        *,
        extra: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        prior = store.get(decision_id)
        if prior is None:
            return None
        if prior.get("request_identity") == request_identity:
            return self._settled_envelope(
                envelope, plan, _freeze(prior["result"]), [],
                ["frozen settlement reused: identical decision_id"],
                extra=extra,
            )
        return {
            "schema_version": self.SCHEMA_VERSION,
            "decision_ref": plan["decision_ref"],
            "decision_id": decision_id,
            "family": plan["family"],
            "status": "decision_conflict",
            "failure": {
                "code": "decision_conflict",
                "message": (
                    "decision_id already bound to a different request; "
                    "executor not invoked"
                ),
            },
        }

    @staticmethod
    def _validate_ordinary_check_provenance(
        payload: Mapping[str, Any],
    ) -> dict[str, Any] | None:
        skill = str(payload.get("skill") or "").strip()
        characteristic = str(payload.get("characteristic") or "").strip()
        if not skill and not characteristic:
            return {
                "code": "invalid_semantic_input",
                "message": (
                    "ordinary check requires skill or characteristic"
                ),
                "missing": ["skill"],
            }
        difficulty = str(payload.get("difficulty") or "").strip()
        if difficulty not in {"regular", "hard", "extreme"}:
            return {
                "code": "invalid_semantic_input",
                "message": "difficulty must be regular, hard, or extreme",
                "fields": ["difficulty"],
            }
        goal = payload.get("goal")
        if not isinstance(goal, str) or not goal.strip():
            return {
                "code": "invalid_semantic_input",
                "message": "goal must be a non-empty string",
                "fields": ["goal"],
            }
        stakes = payload.get("stakes")
        if not isinstance(stakes, Mapping):
            return {
                "code": "invalid_semantic_input",
                "message": "stakes must be {on_success, on_failure}",
                "fields": ["stakes"],
            }
        return None

    def _context_lookup(
        self,
        question: Mapping[str, Any],
        family: str,
        facts: Mapping[str, Any],
    ) -> dict[str, Any]:
        """Read-only table lookup on rules.context (spec §R6). Never settles."""
        lookup_ref = question.get("lookup_ref") or question.get("decision_ref")
        if not isinstance(lookup_ref, str) or not lookup_ref.strip():
            return {}
        lookup_ref = lookup_ref.strip()
        if lookup_ref not in LOOKUP_CONTEXT_DECISION_REFS:
            return {
                "status": "no_candidate_in_compiled_scope",
                "lookup": None,
                "failure": {
                    "code": "no_candidate_in_compiled_scope",
                    "message": (
                        f"{lookup_ref!r} is not a compiled context lookup"
                    ),
                },
            }
        node = self._nodes.get(lookup_ref) or {}
        node_family = str((node.get("properties") or {}).get("family_id") or "")
        if node_family != family:
            return {
                "status": "no_candidate_in_compiled_scope",
                "lookup": None,
                "failure": {
                    "code": "no_candidate_in_compiled_scope",
                    "message": (
                        f"lookup {lookup_ref!r} is not in family {family!r}"
                    ),
                },
            }
        semantic = question.get("semantic_inputs") or {}
        if semantic is None:
            semantic = {}
        if not isinstance(semantic, Mapping):
            return {
                "status": "invalid_semantic_input",
                "lookup": None,
                "failure": {
                    "code": "invalid_semantic_input",
                    "message": "semantic_inputs must be an object",
                },
            }
        lookup_fail = self._validate_lookup_provenance(lookup_ref, semantic)
        if lookup_fail is not None:
            return {
                "status": lookup_fail["code"],
                "lookup": None,
                "failure": lookup_fail,
            }
        compiled = self._compile_plan(lookup_ref, semantic, facts=facts)
        if compiled.get("failure"):
            failure = compiled["failure"]
            return {
                "status": str(failure.get("code") or "no_candidate_in_compiled_scope"),
                "lookup": None,
                "failure": failure,
            }
        plan = compiled["plan"]
        try:
            owner, _surface = self.family_ownership(family)
        except FamilyOwnershipMismatch:
            owner = "legacy"
        if owner != "graph":
            return {
                "lookup": {
                    "decision_ref": lookup_ref,
                    "execution": "deferred-to-legacy",
                    "plan": _thaw(plan),
                },
            }
        if self._lookup_executor is None:
            return {
                "status": "rules_graph_unavailable",
                "lookup": None,
                "failure": {
                    "code": "rules_graph_unavailable",
                    "message": (
                        "graph-owned lookup requires the canonical read-only "
                        "resolver executor; no legacy fallback"
                    ),
                },
            }
        executed = self._lookup_executor(_thaw(plan), lookup_ref, semantic)
        data, warnings, hints = self._split_executor_result(executed)
        if not isinstance(data, Mapping):
            return {
                "status": "invalid_settlement_result",
                "lookup": None,
                "failure": {
                    "code": "invalid_settlement_result",
                    "message": "lookup executor must return an object",
                },
            }
        payload = _thaw(data)
        if lookup_ref == _CATALOG_SEARCH_REF:
            payload = self._project_catalog_lookup(payload)
        result: dict[str, Any] = {
            "status": "ok",
            "lookup": {
                "decision_ref": lookup_ref,
                "execution": "canonical-resolver-subsystem",
                "plan": _thaw(plan),
                "result": payload,
            },
        }
        if warnings:
            result["lookup_warnings"] = warnings
        if hints:
            result["lookup_hints"] = hints
        return result

    @staticmethod
    def _project_catalog_lookup(payload: Mapping[str, Any]) -> dict[str, Any]:
        """Keep secret:true rows secret; never invent a selected entity."""
        row = dict(payload)
        row["authority"] = "advisory"
        row["candidate_only"] = True
        row["selected"] = None
        secret = False
        for candidate in row.get("candidates") or []:
            if isinstance(candidate, Mapping) and candidate.get("secret") is True:
                secret = True
                break
        if secret:
            row["secret"] = True
        return row

    @staticmethod
    def _validate_lookup_provenance(
        lookup_ref: str, semantic: Mapping[str, Any],
    ) -> dict[str, Any] | None:
        if lookup_ref == _CATALOG_SEARCH_REF:
            query = semantic.get("query")
            if not isinstance(query, str) or not query.strip():
                return {
                    "code": "missing_semantic_input",
                    "message": "catalog search requires a non-empty query",
                    "missing": ["query"],
                }
        if lookup_ref == _CASH_ASSETS_REF:
            credit = semantic.get("credit_rating")
            if isinstance(credit, bool) or not isinstance(credit, int):
                return {
                    "code": "invalid_semantic_input",
                    "message": "credit_rating must be an integer",
                    "fields": ["credit_rating"],
                }
        if lookup_ref == _BUILD_SCALE_REF:
            build = semantic.get("build")
            actor = semantic.get("actor_build")
            target = semantic.get("target_build")
            def _is_int(value: Any) -> bool:
                return isinstance(value, int) and not isinstance(value, bool)
            if build is None and actor is None and target is None:
                return {
                    "code": "missing_semantic_input",
                    "message": "provide build, or actor_build and target_build",
                    "missing": ["build"],
                }
            if (actor is None) != (target is None):
                return {
                    "code": "invalid_semantic_input",
                    "message": "actor_build and target_build must be given together",
                    "fields": ["actor_build", "target_build"],
                }
            for name, value in (("build", build), ("actor_build", actor), ("target_build", target)):
                if value is not None and not _is_int(value):
                    return {
                        "code": "invalid_semantic_input",
                        "message": f"{name} must be an integer",
                        "fields": [name],
                    }
        if lookup_ref == _SKILL_DESCRIBE_REF:
            skill = semantic.get("skill")
            skills = semantic.get("skills")
            if skill is not None and (not isinstance(skill, str) or not skill.strip()):
                return {
                    "code": "invalid_semantic_input",
                    "message": "skill must be a non-empty string",
                    "fields": ["skill"],
                }
            if skills is not None and not isinstance(skills, (list, tuple)):
                return {
                    "code": "invalid_semantic_input",
                    "message": "skills must be an array of strings",
                    "fields": ["skills"],
                }
        return None



    @staticmethod
    def _validate_damage_provenance(payload: Mapping[str, Any]) -> dict[str, Any] | None:
        amount = payload.get("amount")
        if isinstance(amount, bool) or amount is None:
            return {
                "code": "missing_semantic_input",
                "message": "damage requires a non-empty amount",
                "missing": ["amount"],
            }
        if isinstance(amount, int):
            pass
        elif not isinstance(amount, str) or not str(amount).strip():
            return {
                "code": "invalid_semantic_input",
                "message": "amount must be an integer or dice expression string",
                "fields": ["amount"],
            }
        kind = payload.get("kind", "damage")
        if kind is None:
            kind = "damage"
        if kind not in _DAMAGE_KINDS:
            return {
                "code": "invalid_semantic_input",
                "message": "kind must be damage or heal",
                "fields": ["kind"],
            }
        return None

    def _settle_damage(
        self,
        executor: Callable[..., Any],
        plan: Mapping[str, Any],
        decision_id: str,
        selected: Mapping[str, Any],
        facts: Mapping[str, Any],
        envelope: dict[str, Any],
    ) -> dict[str, Any]:
        """Non-session HP damage/heal; combat session engine is not invoked."""
        payload = (plan.get("command") or {}).get("payload") or {}
        if not isinstance(payload, Mapping):
            payload = {}
        provenance = self._validate_damage_provenance(payload)
        if provenance is not None:
            return {
                "schema_version": self.SCHEMA_VERSION,
                "decision_ref": plan["decision_ref"],
                "decision_id": decision_id,
                "family": plan["family"],
                "status": provenance["code"],
                "failure": provenance,
            }
        request_identity = self._check_request_identity(plan, selected)
        replayed = self._replay_or_conflict(
            self._damage_frozen, decision_id, request_identity, plan, envelope,
            extra={"visibility": "public"},
        )
        if replayed is not None:
            return replayed
        executed = executor(_thaw(plan), decision_id, selected)
        data, warnings, hints = self._split_executor_result(executed)
        if not isinstance(data, Mapping):
            return {
                "schema_version": self.SCHEMA_VERSION,
                "decision_ref": plan["decision_ref"],
                "decision_id": decision_id,
                "family": plan["family"],
                "status": "invalid_settlement_result",
                "failure": {
                    "code": "invalid_settlement_result",
                    "message": "damage must return an HP change record",
                },
            }
        result = {
            "kind": data.get("kind") or payload.get("kind") or "damage",
            "amount": data.get("amount"),
            "hp_before": data.get("hp_before"),
            "hp_after": data.get("hp_after"),
            "max_hp": data.get("max_hp"),
            "bound": _thaw(data),
            "session": False,
        }
        self._damage_frozen[decision_id] = {
            "request_identity": request_identity,
            "result": deepcopy(result),
        }
        return self._settled_envelope(
            envelope, plan, _freeze(result), warnings, hints,
            extra={"visibility": "public"},
        )

    @staticmethod
    def _validate_sanity_provenance(payload: Mapping[str, Any]) -> dict[str, Any] | None:
        source = payload.get("source")
        if not isinstance(source, str) or not source.strip():
            return {
                "code": "missing_semantic_input",
                "message": "SAN loss requires a non-empty source",
                "missing": ["source"],
            }
        loss_failure = payload.get("loss_failure")
        if loss_failure is None or (
            isinstance(loss_failure, str) and not loss_failure.strip()
        ):
            return {
                "code": "missing_semantic_input",
                "message": "SAN loss requires loss_failure",
                "missing": ["loss_failure"],
            }
        if isinstance(loss_failure, bool) or not isinstance(loss_failure, (str, int)):
            return {
                "code": "invalid_semantic_input",
                "message": "loss_failure must be a constant or NdM expression",
                "fields": ["loss_failure"],
            }
        loss_success = payload.get("loss_success")
        if loss_success is not None and (
            isinstance(loss_success, bool)
            or not isinstance(loss_success, (str, int))
        ):
            return {
                "code": "invalid_semantic_input",
                "message": "loss_success must be a constant or NdM expression",
                "fields": ["loss_success"],
            }
        return None

    def _settle_sanity_loss(
        self,
        executor: Callable[..., Any],
        plan: Mapping[str, Any],
        decision_id: str,
        selected: Mapping[str, Any],
        facts: Mapping[str, Any],
        envelope: dict[str, Any],
    ) -> dict[str, Any]:
        """Keeper-adjudicated SAN check+loss; session engine stays the adapter."""
        payload = (plan.get("command") or {}).get("payload") or {}
        if not isinstance(payload, Mapping):
            payload = {}
        provenance = self._validate_sanity_provenance(payload)
        if provenance is not None:
            return {
                "schema_version": self.SCHEMA_VERSION,
                "decision_ref": plan["decision_ref"],
                "decision_id": decision_id,
                "family": plan["family"],
                "status": provenance["code"],
                "failure": provenance,
            }
        request_identity = self._check_request_identity(plan, selected)
        replayed = self._replay_or_conflict(
            self._sanity_frozen, decision_id, request_identity, plan, envelope,
            extra={"visibility": "public"},
        )
        if replayed is not None:
            return replayed
        executed = executor(_thaw(plan), decision_id, selected)
        data, warnings, hints = self._split_executor_result(executed)
        if not isinstance(data, Mapping):
            return {
                "schema_version": self.SCHEMA_VERSION,
                "decision_ref": plan["decision_ref"],
                "decision_id": decision_id,
                "family": plan["family"],
                "status": "invalid_settlement_result",
                "failure": {
                    "code": "invalid_settlement_result",
                    "message": "SAN loss must return a sanity-check record",
                },
            }
        result = {
            "source": data.get("source") or payload.get("source"),
            "success": data.get("success"),
            "san_loss": data.get("san_loss"),
            "san_before": data.get("san_before"),
            "san_after": data.get("san_after"),
            "bound": _thaw(data),
            "session_engine": "retained",
            "session_exception_ref": _SANITY_SESSION_EXCEPTION_REF,
        }
        self._sanity_frozen[decision_id] = {
            "request_identity": request_identity,
            "result": deepcopy(result),
        }
        return self._settled_envelope(
            envelope, plan, _freeze(result), warnings, hints,
            extra={"visibility": "public"},
        )

    def _settle_ordinary_check(
        self,
        executor: Callable[..., Any],
        plan: Mapping[str, Any],
        decision_id: str,
        selected: Mapping[str, Any],
        facts: Mapping[str, Any],
        envelope: dict[str, Any],
    ) -> dict[str, Any]:
        """One ordinary skill/characteristic check: one bound roll (spec R5).

        Combined settlement: Keeper-selected skill/characteristic, difficulty,
        goal, and stakes compile to exactly one resolver.check invocation.
        No second model-authored transfer and no reroll primitive.  An ordinary
        failure projects Push and Luck-spend continuation cards; a fumble does
        not (source: pushed-roll.json / luck.json).
        """
        payload = (plan.get("command") or {}).get("payload") or {}
        if not isinstance(payload, Mapping):
            payload = {}
        provenance = self._validate_ordinary_check_provenance(payload)
        if provenance is not None:
            return {
                "schema_version": self.SCHEMA_VERSION,
                "decision_ref": plan["decision_ref"],
                "decision_id": decision_id,
                "family": plan["family"],
                "status": "invalid_semantic_input",
                "failure": provenance,
            }
        request_identity = self._check_request_identity(plan, selected)
        replayed = self._replay_or_conflict(
            self._check_frozen, decision_id, request_identity, plan, envelope,
            extra={"visibility": "public"},
        )
        if replayed is not None:
            return replayed
        executed = executor(_thaw(plan), decision_id, selected)
        data, warnings, hints = self._split_executor_result(executed)
        if not isinstance(data, Mapping):
            return {
                "schema_version": self.SCHEMA_VERSION,
                "decision_ref": plan["decision_ref"],
                "decision_id": decision_id,
                "family": plan["family"],
                "status": "invalid_settlement_result",
                "failure": {
                    "code": "invalid_settlement_result",
                    "message": "ordinary check must return a roll record",
                },
            }
        outcome = str(data.get("outcome") or "")
        result = {
            "bound_check": _thaw(data),
            "outcome": outcome,
            "pushed": False,
        }
        if outcome in _CHECK_FAILURE_OUTCOMES:
            result["next_continuations"] = [_PUSHED_ROLL_REF, _LUCK_SPEND_REF]
            continuation_selected = {
                **dict(selected),
                "_host_source_receipt": _thaw(data),
            }
            continuation_cards = [
                self._card(ref, self._facts_for_decision(continuation_selected))
                for ref in result["next_continuations"]
                if isinstance(self._nodes.get(ref), Mapping)
            ]
            continuation_cards = [
                card for card in continuation_cards
                if card.get("applicability") == "applicable"
            ]
            if continuation_cards:
                self._issue_card_grant(
                    continuation_cards,
                    source_decision_id=decision_id,
                )
            hints = list(hints) + [
                "ordinary failure: the player may push this roll with a "
                "changed method and an announced consequence, or spend Luck; "
                "not both"
            ]
        elif outcome in _CHECK_FUMBLE_OUTCOMES:
            result["next_continuations"] = []
            hints = list(hints) + [
                "a fumble cannot be pushed or bought off with Luck"
            ]
        else:
            result["next_continuations"] = []
        self._check_frozen[decision_id] = {
            "request_identity": request_identity,
            "result": deepcopy(result),
        }
        return self._settled_envelope(
            envelope, plan, _freeze(result), warnings, hints,
            extra={"visibility": "public"},
        )

    def _hydrate_original_check(
        self,
        payload: Mapping[str, Any],
    ) -> tuple[str, Mapping[str, Any] | None]:
        original_id = str(payload.get("original_check_decision_id") or "").strip()
        original = self._check_frozen.get(original_id) if original_id else None
        receipt = payload.get("canonical_roll_receipt")
        if original is None and original_id and isinstance(receipt, Mapping):
            result = {
                "bound_check": _thaw(receipt),
                "outcome": str(receipt.get("outcome") or ""),
                "pushed": False,
                "luck_roll": False,
            }
            original = {"request_identity": "canonical-receipt", "result": result}
            self._check_frozen[original_id] = deepcopy(original)
        return original_id, original

    def _settle_luck_roll(
        self,
        executor: Callable[..., Any],
        plan: Mapping[str, Any],
        decision_id: str,
        selected: Mapping[str, Any],
        facts: Mapping[str, Any],
        envelope: dict[str, Any],
    ) -> dict[str, Any]:
        """Luck as a percentile check. Luck may not be spent on Luck rolls."""
        request_identity = self._check_request_identity(plan, selected)
        replayed = self._replay_or_conflict(
            self._check_frozen, decision_id, request_identity, plan, envelope,
            extra={"visibility": "public"},
        )
        if replayed is not None:
            return replayed
        executed = executor(_thaw(plan), decision_id, selected)
        data, warnings, hints = self._split_executor_result(executed)
        if not isinstance(data, Mapping):
            return {
                "schema_version": self.SCHEMA_VERSION,
                "decision_ref": plan["decision_ref"],
                "decision_id": decision_id,
                "family": plan["family"],
                "status": "invalid_settlement_result",
                "failure": {
                    "code": "invalid_settlement_result",
                    "message": "Luck roll must return a roll record",
                },
            }
        result = {
            "bound_check": _thaw(data),
            "outcome": str(data.get("outcome") or ""),
            "luck_roll": True,
            "next_continuations": [],
        }
        hints = list(hints) + [
            "Luck may not be spent on Luck rolls (luck.json constraints)"
        ]
        self._check_frozen[decision_id] = {
            "request_identity": request_identity,
            "result": deepcopy(result),
        }
        return self._settled_envelope(
            envelope, plan, _freeze(result), warnings, hints,
            extra={"visibility": "public"},
        )

    def _settle_pushed_roll(
        self,
        executor: Callable[..., Any],
        plan: Mapping[str, Any],
        decision_id: str,
        selected: Mapping[str, Any],
        facts: Mapping[str, Any],
        envelope: dict[str, Any],
    ) -> dict[str, Any]:
        """Push: failed non-pushed check, Keeper consequence, then player confirm.

        Source (pushed-roll.json required_stages): player_reframes_action,
        keeper_foreshadows_failure, player_confirms_risk, roll_resolved.
        The Keeper owns and announces ``failure_consequence``. Player
        confirmation is a separate structured boolean ``player_confirmed_risk``;
        presence of consequence text is not confirmation. The original
        ordinary-check identity is host-reattached (locked slots).
        """
        payload = (plan.get("command") or {}).get("payload") or {}
        if not isinstance(payload, Mapping):
            payload = {}
        method = str(payload.get("method_changed") or "").strip()
        consequence = str(payload.get("failure_consequence") or "").strip()
        if not method or not consequence:
            return {
                "schema_version": self.SCHEMA_VERSION,
                "decision_ref": plan["decision_ref"],
                "decision_id": decision_id,
                "family": plan["family"],
                "status": "invalid_semantic_input",
                "failure": {
                    "code": "invalid_semantic_input",
                    "message": (
                        "pushed roll requires method_changed and "
                        "failure_consequence locked before the roll"
                    ),
                    "missing": [
                        name for name, value in (
                            ("method_changed", method),
                            ("failure_consequence", consequence),
                        ) if not value
                    ],
                },
            }
        confirmed = payload.get("player_confirmed_risk")
        if confirmed is not True:
            return {
                "schema_version": self.SCHEMA_VERSION,
                "decision_ref": plan["decision_ref"],
                "decision_id": decision_id,
                "family": plan["family"],
                "status": "invalid_semantic_input",
                "failure": {
                    "code": "invalid_semantic_input",
                    "message": (
                        "pushed roll requires player_confirmed_risk=true "
                        "after the Keeper announces the failure consequence; "
                        "do not infer confirmation from consequence text"
                    ),
                    "fields": ["player_confirmed_risk"],
                },
            }
        original_id, original = self._hydrate_original_check(payload)
        if original is None:
            return {
                "schema_version": self.SCHEMA_VERSION,
                "decision_ref": plan["decision_ref"],
                "decision_id": decision_id,
                "family": plan["family"],
                "status": "rule_decision_not_applicable",
                "failure": {
                    "code": "rule_decision_not_applicable",
                    "message": (
                        "pushed roll requires a frozen failed non-pushed "
                        "ordinary check; host re-attaches the original "
                        "decision_id"
                    ),
                },
            }
        original_result = original.get("result") or {}
        original_outcome = str(original_result.get("outcome") or "")
        if original_result.get("pushed") or original_result.get("luck_roll"):
            return {
                "schema_version": self.SCHEMA_VERSION,
                "decision_ref": plan["decision_ref"],
                "decision_id": decision_id,
                "family": plan["family"],
                "status": "rule_decision_not_applicable",
                "failure": {
                    "code": "rule_decision_not_applicable",
                    "message": (
                        "only a failed non-pushed ordinary check may be pushed"
                    ),
                },
            }
        if original_outcome in _CHECK_FUMBLE_OUTCOMES:
            return {
                "schema_version": self.SCHEMA_VERSION,
                "decision_ref": plan["decision_ref"],
                "decision_id": decision_id,
                "family": plan["family"],
                "status": "rule_decision_not_applicable",
                "failure": {
                    "code": "rule_decision_not_applicable",
                    "message": "a fumble cannot be pushed; it is final",
                },
            }
        if original_outcome not in _CHECK_FAILURE_OUTCOMES:
            return {
                "schema_version": self.SCHEMA_VERSION,
                "decision_ref": plan["decision_ref"],
                "decision_id": decision_id,
                "family": plan["family"],
                "status": "rule_decision_not_applicable",
                "failure": {
                    "code": "rule_decision_not_applicable",
                    "message": (
                        "only an ordinary failed original check may be pushed"
                    ),
                },
            }
        if original_id in self._luck_spend_frozen:
            return {
                "schema_version": self.SCHEMA_VERSION,
                "decision_ref": plan["decision_ref"],
                "decision_id": decision_id,
                "family": plan["family"],
                "status": "rule_decision_not_applicable",
                "failure": {
                    "code": "rule_decision_not_applicable",
                    "message": "push or spend Luck, but not both",
                },
            }
        request_identity = self._check_request_identity(plan, selected)
        replayed = self._replay_or_conflict(
            self._push_frozen, decision_id, request_identity, plan, envelope,
            extra={"visibility": "public"},
        )
        if replayed is not None:
            return replayed
        executed = executor(_thaw(plan), decision_id, selected)
        data, warnings, hints = self._split_executor_result(executed)
        if not isinstance(data, Mapping):
            return {
                "schema_version": self.SCHEMA_VERSION,
                "decision_ref": plan["decision_ref"],
                "decision_id": decision_id,
                "family": plan["family"],
                "status": "invalid_settlement_result",
                "failure": {
                    "code": "invalid_settlement_result",
                    "message": "pushed roll must return a roll record",
                },
            }
        result = {
            "bound_check": _thaw(data),
            "outcome": str(data.get("outcome") or ""),
            "pushed": True,
            "original_check_decision_id": original_id,
            "failure_consequence": consequence,
            "method_changed": method,
            "player_confirmed_risk": True,
        }
        hints = list(hints) + [
            "the recorded failure_consequence is authoritative; apply it if "
            "the pushed roll fails"
        ]
        self._push_frozen[decision_id] = {
            "request_identity": request_identity,
            "result": deepcopy(result),
            "original_check_decision_id": original_id,
        }
        return self._settled_envelope(
            envelope, plan, _freeze(result), warnings, hints,
            extra={"visibility": "public"},
        )

    def _settle_luck_spend(
        self,
        executor: Callable[..., Any],
        plan: Mapping[str, Any],
        decision_id: str,
        selected: Mapping[str, Any],
        facts: Mapping[str, Any],
        envelope: dict[str, Any],
    ) -> dict[str, Any]:
        """Luck spend: receipt-bound continuation of one ordinary check."""
        payload = (plan.get("command") or {}).get("payload") or {}
        if not isinstance(payload, Mapping):
            payload = {}
        points = payload.get("points")
        if isinstance(points, bool) or not isinstance(points, int) or points <= 0:
            return {
                "schema_version": self.SCHEMA_VERSION,
                "decision_ref": plan["decision_ref"],
                "decision_id": decision_id,
                "family": plan["family"],
                "status": "invalid_semantic_input",
                "failure": {
                    "code": "invalid_semantic_input",
                    "message": "points must be a positive integer",
                    "fields": ["points"],
                },
            }
        source_roll_id = str(payload.get("source_roll_id") or "").strip()
        if not source_roll_id:
            return {
                "schema_version": self.SCHEMA_VERSION,
                "decision_ref": plan["decision_ref"],
                "decision_id": decision_id,
                "family": plan["family"],
                "status": "invalid_semantic_input",
                "failure": {
                    "code": "invalid_semantic_input",
                    "message": "source_roll_id is host-locked from the original receipt",
                    "missing": ["source_roll_id"],
                },
            }
        original_id, original = self._hydrate_original_check(payload)
        if original is not None:
            original_result = original.get("result") or {}
            if original_result.get("luck_roll"):
                return {
                    "schema_version": self.SCHEMA_VERSION,
                    "decision_ref": plan["decision_ref"],
                    "decision_id": decision_id,
                    "family": plan["family"],
                    "status": "rule_decision_not_applicable",
                    "failure": {
                        "code": "rule_decision_not_applicable",
                        "message": "Luck may not be spent on Luck rolls",
                    },
                }
            if original_id in {
                row.get("original_check_decision_id")
                for row in self._push_frozen.values()
            }:
                return {
                    "schema_version": self.SCHEMA_VERSION,
                    "decision_ref": plan["decision_ref"],
                    "decision_id": decision_id,
                    "family": plan["family"],
                    "status": "rule_decision_not_applicable",
                    "failure": {
                        "code": "rule_decision_not_applicable",
                        "message": "push or spend Luck, but not both",
                    },
                }
        request_identity = self._check_request_identity(plan, selected)
        replayed = self._replay_or_conflict(
            self._luck_spend_frozen, decision_id, request_identity, plan,
            envelope, extra={"visibility": "public"},
        )
        if replayed is not None:
            return replayed
        executed = executor(_thaw(plan), decision_id, selected)
        data, warnings, hints = self._split_executor_result(executed)
        if not isinstance(data, Mapping):
            return {
                "schema_version": self.SCHEMA_VERSION,
                "decision_ref": plan["decision_ref"],
                "decision_id": decision_id,
                "family": plan["family"],
                "status": "invalid_settlement_result",
                "failure": {
                    "code": "invalid_settlement_result",
                    "message": "Luck spend must return a receipt",
                },
            }
        result = {
            "luck_spend": _thaw(data),
            "source_roll_id": source_roll_id,
            "points": points,
            "resource_key": "luck",
        }
        self._luck_spend_frozen[decision_id] = {
            "request_identity": request_identity,
            "result": deepcopy(result),
            "original_check_decision_id": original_id,
        }
        if original_id:
            self._luck_spend_frozen[original_id] = self._luck_spend_frozen[decision_id]
        return self._settled_envelope(
            envelope, plan, _freeze(result), warnings, hints,
            extra={"visibility": "public"},
        )

    def _settle_resource_delta(
        self,
        executor: Callable[..., Any],
        plan: Mapping[str, Any],
        decision_id: str,
        selected: Mapping[str, Any],
        facts: Mapping[str, Any],
        envelope: dict[str, Any],
    ) -> dict[str, Any]:
        """Host-internal generic resource delta with provenance (spec §11.1)."""
        payload = (plan.get("command") or {}).get("payload") or {}
        if not isinstance(payload, Mapping):
            payload = {}
        resource = str(payload.get("resource") or "").strip().lower()
        direction = str(payload.get("direction") or "").strip()
        if resource not in _RESOURCE_KEYS:
            return {
                "schema_version": self.SCHEMA_VERSION,
                "decision_ref": plan["decision_ref"],
                "decision_id": decision_id,
                "family": plan["family"],
                "status": "invalid_semantic_input",
                "failure": {
                    "code": "invalid_semantic_input",
                    "message": "resource must be a declared actor pool",
                    "fields": ["resource"],
                },
            }
        if direction not in {"loss", "gain"}:
            return {
                "schema_version": self.SCHEMA_VERSION,
                "decision_ref": plan["decision_ref"],
                "decision_id": decision_id,
                "family": plan["family"],
                "status": "invalid_semantic_input",
                "failure": {
                    "code": "invalid_semantic_input",
                    "message": "direction must be loss or gain",
                    "fields": ["direction"],
                },
            }
        request_identity = self._check_request_identity(plan, selected)
        replayed = self._replay_or_conflict(
            self._resource_frozen, decision_id, request_identity, plan, envelope,
            extra={"visibility": "keeper-only"},
        )
        if replayed is not None:
            return replayed
        executed = executor(_thaw(plan), decision_id, selected)
        data, warnings, hints = self._split_executor_result(executed)
        if not isinstance(data, Mapping):
            return {
                "schema_version": self.SCHEMA_VERSION,
                "decision_ref": plan["decision_ref"],
                "decision_id": decision_id,
                "family": plan["family"],
                "status": "invalid_settlement_result",
                "failure": {
                    "code": "invalid_settlement_result",
                    "message": "resource_delta must return a receipt",
                },
            }
        result = {
            "resource_delta": _thaw(data),
            "resource": resource,
            "direction": direction,
            "provenance": {
                "decision_id": decision_id,
                "decision_ref": plan["decision_ref"],
            },
        }
        self._resource_frozen[decision_id] = {
            "request_identity": request_identity,
            "result": deepcopy(result),
        }
        return self._settled_envelope(
            envelope, plan, _freeze(result), warnings, hints,
            extra={"visibility": "keeper-only"},
        )


def create_adapter() -> Coc7RuleGraphAdapter:
    return Coc7RuleGraphAdapter()
