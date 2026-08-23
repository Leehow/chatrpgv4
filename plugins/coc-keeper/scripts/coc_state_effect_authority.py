"""Canonical read-only authority for typed visible state mutations.

Finalization and battle-report export share this predicate so a receipt that
proves a typed effect at ``turn.finalize`` is the same receipt the exporter
accepts. Replay-only rows never prove; they may only sit beside an original
successful writer receipt.
"""
from __future__ import annotations

from typing import Any, Iterable

import coc_operation_policy


PLAYER_STATE_EFFECT_KINDS = frozenset({
    "scalar", "condition", "loaded_ammunition",
})
TIME_EFFECT_KINDS = frozenset({"time", "time_appearance"})
STATE_KIND_OPERATION_NAMES = {
    "item": frozenset({
        "state.item_grant", "state.item_remove", "state.item_use",
    }),
    "cash": frozenset({"state.cash_grant", "state.cash_spend"}),
    "time": frozenset({"state.advance_time"}),
    "time_appearance": frozenset({"state.time_appearance"}),
    "rest": frozenset({"state.mark_safe_rest"}),
    "purchase": frozenset({"state.purchase"}),
    "assets_liquidate": frozenset({"state.assets_liquidate"}),
    "condition": frozenset({"state.clear_transient_condition"}),
    "exceptional_effect": frozenset({"state.exceptional_effect"}),
}
PLAYER_STATE_WRITER_DOMAINS = {
    "rules.damage": frozenset({"hp", "condition"}),
    "rules.first_aid": frozenset({"hp", "condition"}),
    "rules.medicine": frozenset({"hp", "condition"}),
    "rules.weekly_recovery": frozenset({"hp", "condition"}),
    "rules.dying_check": frozenset({"hp", "condition"}),
    "rules.sanity_check": frozenset({"san"}),
    "rules.luck_spend": frozenset({"luck"}),
    "rules.resource_delta": frozenset({"hp", "san", "luck", "mp"}),
    "combat.resolve": frozenset({"hp", "condition", "loaded_ammunition"}),
    "sanity.execute": frozenset({"san", "hp", "condition"}),
    "state.clear_transient_condition": frozenset({"condition"}),
}
_SCALAR_RESOURCE_KEYS = {
    "HP": "hp",
    "hp": "hp",
    "SAN": "san",
    "san": "san",
    "Luck": "luck",
    "luck": "luck",
    "LUCK": "luck",
    "MP": "mp",
    "mp": "mp",
}
_REASON_PRIORITY = ("mismatch", "advisory", "unknown", "failed", "replay", "missing")


def is_typed_state_delta(effect: Any) -> bool:
    """Recognize typed before/after or delta payloads; never infer from prose."""
    if not isinstance(effect, dict):
        return False
    keys = {str(key) for key in effect}
    if "before" in keys and "after" in keys:
        return True
    if keys & {"delta", "applied_delta", "state_delta", "change"}:
        return True
    if (
        effect.get("category") in {"state_delta", "asset_delta"}
        and effect.get("effect_id")
        and effect.get("action")
    ):
        return True
    before_stems = {key[:-7] for key in keys if key.endswith("_before")}
    after_stems = {key[:-6] for key in keys if key.endswith("_after")}
    return bool(before_stems & after_stems)


def call_decision_id(call: Any) -> str:
    if not isinstance(call, dict):
        return ""
    args = call.get("args") if isinstance(call.get("args"), dict) else {}
    return str(args.get("decision_id") or "").strip()


def is_idempotent_replay(call: Any) -> bool:
    return isinstance(call, dict) and call.get("idempotent_replay") is True


def default_registry() -> dict[str, Any]:
    import coc_toolbox

    return coc_toolbox.TOOLS


def operation_is_advisory(name: str, spec: dict[str, Any]) -> bool:
    if spec.get("access") == "query":
        return True
    try:
        return bool(coc_operation_policy.policy_for_operation(name)["advisory"])
    except KeyError:
        return False


def writer_domains(tool: str, call: dict[str, Any] | None = None) -> frozenset[str]:
    domains = PLAYER_STATE_WRITER_DOMAINS.get(tool)
    if domains is None:
        return frozenset()
    if tool != "rules.resource_delta":
        return domains
    data = _data(call or {})
    result = data.get("result") if isinstance(data.get("result"), dict) else {}
    resource = _scalar_resource_key(result.get("resource"))
    if resource and resource in domains and data.get("state_bound") is True:
        return frozenset({resource})
    return frozenset()


def receipt_proves_effect(
    call: Any,
    effect: dict[str, Any],
    *,
    registry: dict[str, Any] | None = None,
) -> str | None:
    """Return a rejection token, or None when this original call proves."""
    if not isinstance(call, dict) or not isinstance(effect, dict):
        return "missing"
    if is_idempotent_replay(call):
        return "replay"
    tools = registry if registry is not None else default_registry()
    tool = str(call.get("tool") or "")
    spec = tools.get(tool)
    if not isinstance(spec, dict):
        return "unknown"
    if spec.get("access", "mutation") != "mutation" or operation_is_advisory(tool, spec):
        return "advisory"
    if call.get("ok") is not True:
        return "failed"
    decision_id = str(effect.get("source_decision_id") or "").strip()
    if not decision_id or call_decision_id(call) != decision_id:
        return "mismatch"
    kind = _effect_kind(effect)
    if not _operation_may_write(tool, kind, call, effect):
        return "mismatch"
    if not _subject_matches(call, effect, kind):
        return "mismatch"
    if not _structured_delta_matches(call, effect, kind, tool):
        return "mismatch"
    return None


def proving_call(
    effect: dict[str, Any],
    window: Iterable[Any],
    *,
    registry: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    tools = registry if registry is not None else default_registry()
    decision_id = str(effect.get("source_decision_id") or "").strip()
    if not decision_id:
        return None
    for call in window:
        if not isinstance(call, dict) or call_decision_id(call) != decision_id:
            continue
        if receipt_proves_effect(call, effect, registry=tools) is None:
            return call
    return None


def state_delta_proof_reason(
    effect: dict[str, Any],
    window: Iterable[Any],
    *,
    registry: dict[str, Any] | None = None,
) -> str | None:
    tools = registry if registry is not None else default_registry()
    decision_id = str(effect.get("source_decision_id") or "").strip()
    if not decision_id:
        return "missing"
    reasons: list[str] = []
    saw_replay = False
    for call in window:
        if not isinstance(call, dict) or call_decision_id(call) != decision_id:
            continue
        if is_idempotent_replay(call):
            saw_replay = True
            continue
        reason = receipt_proves_effect(call, effect, registry=tools)
        if reason is None:
            return None
        reasons.append(reason)
    if not reasons:
        return "replay" if saw_replay else "missing"
    for token in _REASON_PRIORITY:
        if token in reasons:
            return token
    return "missing"


def state_delta_proof_violations(
    window: Iterable[Any],
    effects: Any,
    *,
    registry: dict[str, Any] | None = None,
) -> list[dict[str, str]]:
    """Fail closed when a typed visible delta lacks a registered write receipt."""
    tools = registry if registry is not None else default_registry()
    violations: list[dict[str, str]] = []
    seen: set[str] = set()
    for effect in effects or []:
        if not is_typed_state_delta(effect):
            continue
        effect_id = str(effect.get("effect_id") or "").strip() or "unknown"
        if effect_id in seen:
            continue
        seen.add(effect_id)
        reason = state_delta_proof_reason(effect, window, registry=tools)
        if reason is None:
            continue
        violations.append({
            "stage": "state_proof",
            "code": "unproven_state_delta",
            "message": (
                f"{effect_id}: typed state effect lacks a successful registered "
                f"canonical state operation ({reason})"
            ),
        })
    return violations


def _effect_kind(effect: dict[str, Any]) -> str:
    if effect.get("category") == "exceptional_effect":
        return "exceptional_effect"
    return str(effect.get("effect_kind") or "")


def _operation_may_write(
    tool: str,
    kind: str,
    call: dict[str, Any],
    effect: dict[str, Any],
) -> bool:
    if kind == "scalar":
        resource = _scalar_resource_key(effect.get("resource"))
        return bool(resource) and resource in writer_domains(tool, call)
    if kind in PLAYER_STATE_EFFECT_KINDS:
        domain = "condition" if kind == "condition" else "loaded_ammunition"
        return domain in writer_domains(tool, call)
    allowed = STATE_KIND_OPERATION_NAMES.get(kind)
    if allowed is not None:
        return tool in allowed
    return tool.startswith("state.")


def _subject_matches(call: dict[str, Any], effect: dict[str, Any], kind: str) -> bool:
    subject = str(effect.get("investigator_id") or "").strip()
    found = _investigator_ids(call)
    if kind in TIME_EFFECT_KINDS or kind == "exceptional_effect":
        return not subject or not found or subject in found
    if not subject:
        return False
    return subject in found


def _structured_delta_matches(
    call: dict[str, Any],
    effect: dict[str, Any],
    kind: str,
    tool: str,
) -> bool:
    data = _data(call)
    args = _args(call)
    if kind == "scalar":
        return _scalar_matches(tool, data, effect)
    if kind == "condition":
        return _condition_matches(data, effect)
    if kind == "loaded_ammunition":
        return _ammo_matches(data, effect)
    if kind == "item":
        return _item_matches(args, data, effect)
    if kind == "cash":
        return _cash_matches(data, effect)
    if kind == "time":
        return _pair_equals(
            data.get("from_elapsed"),
            data.get("to_elapsed"),
            effect.get("before"),
            effect.get("after"),
        )
    if kind == "time_appearance":
        previous = data.get("previous_time") if isinstance(data.get("previous_time"), dict) else {}
        current = data.get("current_time") if isinstance(data.get("current_time"), dict) else {}
        return (
            previous.get("player_time") == effect.get("player_time_before")
            and current.get("player_time") == effect.get("player_time_after")
        )
    if kind == "rest":
        return data.get("at_elapsed") == effect.get("at_elapsed")
    if kind == "purchase":
        return (
            str(data.get("item_id") or args.get("item_id") or "") == str(effect.get("item_id") or "")
            and str(data.get("currency") or "") == str(effect.get("currency") or "")
            and data.get("cash_balance_before") == effect.get("cash_balance_before")
            and data.get("cash_balance_after") == effect.get("cash_balance_after")
            and bool(str(effect.get("item_id") or "").strip())
        )
    if kind == "assets_liquidate":
        return (
            str(data.get("currency") or "") == str(effect.get("currency") or "")
            and data.get("assets_balance_before") == effect.get("assets_balance_before")
            and data.get("assets_balance_after") == effect.get("assets_balance_after")
            and data.get("cash_balance_before") == effect.get("cash_balance_before")
            and data.get("cash_balance_after") == effect.get("cash_balance_after")
            and bool(str(effect.get("currency") or "").strip())
        )
    if kind == "exceptional_effect":
        recorded = data.get("effect") if isinstance(data.get("effect"), dict) else {}
        effect_id = str(effect.get("effect_id") or "").strip()
        action = str(data.get("action") or "")
        return (
            bool(effect_id)
            and recorded.get("effect_id") == effect_id
            and action in {"apply", "consume", "resolve"}
        )
    return True


def _scalar_matches(tool: str, data: dict[str, Any], effect: dict[str, Any]) -> bool:
    resource = _scalar_resource_key(effect.get("resource"))
    if not resource:
        return False
    for before, after in _scalar_pairs(tool, data, resource):
        if _pair_equals(before, after, effect.get("before"), effect.get("after")):
            if _delta_agrees(effect, before, after):
                return True
    return False


def _scalar_pairs(
    tool: str,
    data: dict[str, Any],
    resource: str,
) -> list[tuple[Any, Any]]:
    pairs: list[tuple[Any, Any]] = []
    receipt = _player_state_receipt(data)
    if receipt is not None:
        values = receipt.get(resource)
        if isinstance(values, dict):
            pairs.append((values.get("before"), values.get("after")))
    if tool == "rules.damage" and resource == "hp":
        pairs.append((data.get("hp_before"), data.get("hp_after")))
    elif tool == "rules.sanity_check" and resource == "san":
        pairs.append((data.get("san_before"), data.get("san_after")))
    elif tool == "rules.luck_spend" and resource == "luck":
        pairs.append((data.get("luck_before"), data.get("luck_after")))
    elif tool == "rules.resource_delta":
        result = data.get("result") if isinstance(data.get("result"), dict) else {}
        if (
            data.get("state_bound") is True
            and _scalar_resource_key(result.get("resource")) == resource
        ):
            pairs.append((result.get("before"), result.get("after")))
    return pairs


def _condition_matches(data: dict[str, Any], effect: dict[str, Any]) -> bool:
    condition = str(effect.get("condition") or "").strip()
    action = str(effect.get("action") or "")
    if not condition or action not in {"added", "removed"}:
        return False
    before, after = _condition_lists(data)
    if before is None or after is None:
        return False
    if action == "added":
        return condition in after and condition not in before
    return condition in before and condition not in after


def _condition_lists(data: dict[str, Any]) -> tuple[set[str] | None, set[str] | None]:
    receipt = _player_state_receipt(data)
    raw_before = raw_after = None
    if receipt is not None:
        raw_before = receipt.get("conditions_before")
        raw_after = receipt.get("conditions_after")
    if not isinstance(raw_before, list) or not isinstance(raw_after, list):
        raw_before = data.get("conditions_before")
        raw_after = data.get("conditions_after")
    if not isinstance(raw_before, list) or not isinstance(raw_after, list):
        return None, None
    return {str(value) for value in raw_before}, {str(value) for value in raw_after}


def _ammo_matches(data: dict[str, Any], effect: dict[str, Any]) -> bool:
    weapon_id = str(effect.get("weapon_id") or "").strip()
    receipt = _player_state_receipt(data)
    if not weapon_id or receipt is None:
        return False
    for ammo in receipt.get("loaded_ammunition") or []:
        if not isinstance(ammo, dict):
            continue
        if str(ammo.get("weapon_id") or "") != weapon_id:
            continue
        if _pair_equals(
            ammo.get("before"),
            ammo.get("after"),
            effect.get("before"),
            effect.get("after"),
        ) and _delta_agrees(effect, ammo.get("before"), ammo.get("after")):
            return True
    return False


def _item_matches(args: dict[str, Any], data: dict[str, Any], effect: dict[str, Any]) -> bool:
    item_id = str(data.get("item_id") or args.get("item_id") or "").strip()
    expected = str(effect.get("item_id") or "").strip()
    if not item_id or item_id != expected:
        return False
    if "present_before" in data or "present_after" in data:
        return (
            data.get("present_before") == effect.get("present_before")
            and data.get("present_after") == effect.get("present_after")
        )
    if "before" in effect and "after" in effect:
        remaining = data.get("remaining", data.get("after"))
        before = data.get("before")
        if before is None and _exact_int(remaining) and _exact_int(data.get("count")):
            before = remaining + data["count"]
        return _pair_equals(before, remaining, effect.get("before"), effect.get("after"))
    return False


def _cash_matches(data: dict[str, Any], effect: dict[str, Any]) -> bool:
    currency = str(data.get("currency") or "").strip()
    expected = str(effect.get("currency") or "").strip()
    return (
        bool(currency)
        and currency == expected
        and data.get("balance_before") == effect.get("balance_before")
        and data.get("balance_after") == effect.get("balance_after")
    )


def _player_state_receipt(data: dict[str, Any]) -> dict[str, Any] | None:
    receipt = data.get("player_state_receipt")
    if isinstance(receipt, dict) and receipt.get("schema_version") == 1:
        return receipt
    return None


def _investigator_ids(call: dict[str, Any]) -> list[str]:
    found: list[str] = []
    seen: set[str] = set()

    def add(value: Any) -> None:
        text = str(value or "").strip()
        if text and text not in seen and _valid_investigator_id(text):
            seen.add(text)
            found.append(text)

    for payload in (_args(call), _data(call)):
        add(payload.get("investigator"))
        add(payload.get("investigator_id"))
    receipt = _player_state_receipt(_data(call))
    if receipt is not None:
        add(receipt.get("investigator_id"))
    return found


def _valid_investigator_id(value: str) -> bool:
    return bool(
        value
        and value == value.strip()
        and value not in {".", ".."}
        and "/" not in value
        and "\\" not in value
    )


def _scalar_resource_key(value: Any) -> str:
    return _SCALAR_RESOURCE_KEYS.get(str(value or "").strip(), "")


def _pair_equals(before: Any, after: Any, expected_before: Any, expected_after: Any) -> bool:
    if before is None or after is None:
        return False
    return before == expected_before and after == expected_after and before != after


def _delta_agrees(effect: dict[str, Any], before: Any, after: Any) -> bool:
    if not _exact_int(before) or not _exact_int(after):
        return True
    expected = after - before
    for key in ("delta", "change"):
        if key in effect and effect.get(key) != expected:
            return False
    return True


def _exact_int(value: Any) -> bool:
    return not isinstance(value, bool) and isinstance(value, int)


def _args(call: dict[str, Any]) -> dict[str, Any]:
    args = call.get("args")
    return args if isinstance(args, dict) else {}


def _data(call: dict[str, Any]) -> dict[str, Any]:
    data = call.get("data")
    return data if isinstance(data, dict) else {}
