#!/usr/bin/env python3
"""Canonical stateful bridge from Director subsystem commands to CoC engines.

The executor validates a complete command batch before it consumes randomness
or mutates campaign state.  Successful results are snapshotted in
``save/subsystem-state.json`` so retries after a process restart are exact,
side-effect-free replays.
"""
from __future__ import annotations

import base64
import hashlib
import importlib.util
import json
import math
import os
import random
import re
import stat
import time
from pathlib import Path
from typing import Any, Callable, TypedDict


SCRIPT_DIR = Path(__file__).resolve().parent
STATE_SCHEMA_VERSION = 3
STATE_RELATIVE_PATH = Path("save/subsystem-state.json")

COMMAND_KEYS = frozenset({"command_id", "kind", "phase", "payload"})
RESULT_KEYS = frozenset({
    "command_id",
    "kind",
    "status",
    "events",
    "pending_choice",
    "state_refs",
})
ROLL_COMMAND_KINDS = frozenset({
    "skill_check",
    "characteristic_check",
    "sanity_check",
    "opposed_check",
    "idea_roll",
})
PUSH_COMMAND_KINDS = frozenset({"push_offer", "push_confirm", "push_resolve"})
BOUT_COMMAND_KINDS = frozenset({"bout_tick", "bout_end"})
COMBAT_COMMAND_KINDS = frozenset({
    "combat_start", "combat_attack", "combat_defend", "dying_tick",
    "stabilize", "weekly_recovery", "combat_end",
})
REWARD_COMMAND_KINDS = frozenset({"sanity_reward"})
AUTHORED_OPERATION_COMMAND_KINDS = frozenset({
    "environmental_hazard", "mythos_tome_study",
})
CHASE_COMMAND_KINDS = frozenset({
    "chase_start", "chase_move", "chase_hazard", "chase_barrier",
    "chase_conflict", "chase_end",
})
CHARACTER_REQUIRED_COMMAND_KINDS = (
    ROLL_COMMAND_KINDS | PUSH_COMMAND_KINDS | BOUT_COMMAND_KINDS
    | COMBAT_COMMAND_KINDS
    | CHASE_COMMAND_KINDS | REWARD_COMMAND_KINDS
    | AUTHORED_OPERATION_COMMAND_KINDS
)
RNG_CONSUMING_COMMAND_KINDS = ROLL_COMMAND_KINDS | {
    "push_resolve", "combat_defend", "dying_tick", "stabilize",
    "weekly_recovery", "chase_hazard", "chase_barrier", "sanity_reward",
    "environmental_hazard", "mythos_tome_study",
}
ROLL_EVIDENCE_COMMAND_KINDS = ROLL_COMMAND_KINDS | {
    "push_resolve", "combat_defend", "dying_tick", "stabilize",
    "weekly_recovery", "chase_hazard", "chase_barrier", "sanity_reward",
}
SAN_MUTATION_COMMAND_KINDS = frozenset({
    "sanity_check", "sanity_reward", "bout_tick", "bout_end",
})
SUPPORTED_COMMAND_KINDS = (
    ROLL_COMMAND_KINDS | PUSH_COMMAND_KINDS | BOUT_COMMAND_KINDS
    | COMBAT_COMMAND_KINDS
    | CHASE_COMMAND_KINDS | REWARD_COMMAND_KINDS
    | AUTHORED_OPERATION_COMMAND_KINDS
)
EXPECTED_PHASE = {
    **{kind: "resolve" for kind in ROLL_COMMAND_KINDS},
    "push_offer": "offer",
    "push_confirm": "confirm",
    "push_resolve": "resolve",
    "bout_tick": "resolve",
    "bout_end": "resolve",
    "combat_start": "start",
    "combat_attack": "declare",
    "combat_defend": "resolve",
    "dying_tick": "resolve",
    "stabilize": "resolve",
    "weekly_recovery": "resolve",
    "combat_end": "end",
    "sanity_reward": "resolve",
    "environmental_hazard": "resolve",
    "mythos_tome_study": "resolve",
    "chase_start": "start",
    "chase_move": "resolve",
    "chase_hazard": "resolve",
    "chase_barrier": "resolve",
    "chase_conflict": "resolve",
    "chase_end": "end",
}
RESULT_STATUSES_BY_KIND = {
    **{kind: frozenset({"completed"}) for kind in ROLL_COMMAND_KINDS},
    "sanity_check": frozenset({"completed", "pending_choice"}),
    "push_offer": frozenset({"pending_choice"}),
    "push_confirm": frozenset({"cancelled", "completed"}),
    "push_resolve": frozenset({"completed"}),
    "bout_tick": frozenset({"completed", "pending_choice"}),
    "bout_end": frozenset({"completed"}),
    **{kind: frozenset({"completed"}) for kind in COMBAT_COMMAND_KINDS},
    **{kind: frozenset({"completed"}) for kind in CHASE_COMMAND_KINDS},
    "sanity_reward": frozenset({"completed"}),
    "environmental_hazard": frozenset({"completed"}),
    "mythos_tome_study": frozenset({"completed"}),
    "chase_move": frozenset({"completed", "pending_choice"}),
}
SUCCESS_OUTCOMES = frozenset({
    "critical",
    "extreme",
    "hard",
    "regular",
    "success",
    "critical_success",
    "extreme_success",
    "hard_success",
    "regular_success",
})
TRANSIENT_COMBAT_CONDITIONS = frozenset({
    "prone", "grappled", "surprised", "outnumbered", "fled",
})
_SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")


def _command_requires_roll_evidence(command: dict[str, Any]) -> bool:
    kind = command.get("kind")
    if kind == "environmental_hazard":
        return True
    if kind == "mythos_tome_study":
        return True
    if kind in ROLL_EVIDENCE_COMMAND_KINDS:
        return True
    if kind == "combat_start":
        payload = command.get("payload") if isinstance(command.get("payload"), dict) else {}
        return any(
            isinstance(item, dict) and isinstance(item.get("armor_dice"), str)
            for item in payload.get("preparations", []) or []
        )
    return False


def _result_requires_roll_evidence(
    result: dict[str, Any], command: dict[str, Any] | None = None,
) -> bool:
    """Recover the evidence contract from persisted results on later loads.

    Most historical receipts do not retain the complete originating command,
    so ordinary roll kinds must continue to classify from ``result.kind``.
    ``combat_start`` is the sole conditional case: it consumes randomness only
    when an authored preparation rolled armor, which is represented by a
    preparation event carrying a roll id.
    """
    if result.get("kind") == "mythos_tome_study":
        return any(isinstance(event.get("roll_id"), str) for event in result.get("events", []))
    if result.get("kind") in ROLL_EVIDENCE_COMMAND_KINDS:
        return True
    if isinstance(command, dict) and _command_requires_roll_evidence(command):
        return True
    return result.get("kind") == "combat_start" and any(
        isinstance(event, dict) and isinstance(event.get("roll_id"), str)
        for event in result.get("events", []) or []
    )
_TRANSACTION_DIR_FD_SUPPORTED = all(
    function in os.supports_dir_fd for function in (os.open, os.stat, os.unlink)
)
_TRANSACTION_NOFOLLOW_STAT_SUPPORTED = os.stat in os.supports_follow_symlinks


class SubsystemCommand(TypedDict):
    command_id: str
    kind: str
    phase: str
    payload: dict[str, Any]


class SubsystemResult(TypedDict):
    command_id: str
    kind: str
    status: str
    events: list[dict[str, Any]]
    pending_choice: dict[str, Any] | None
    state_refs: list[str]


def _load_sibling(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPT_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_fileio = _load_sibling("coc_fileio_subsystem_executor", "coc_fileio.py")
coc_roll = _load_sibling("coc_roll_subsystem_executor", "coc_roll.py")
coc_sanity = _load_sibling("coc_sanity_subsystem_executor", "coc_sanity.py")
coc_combat = _load_sibling("coc_combat_subsystem_executor", "coc_combat.py")
coc_chase = _load_sibling("coc_chase_subsystem_executor", "coc_chase.py")
coc_healing = _load_sibling("coc_healing_subsystem_executor", "coc_healing.py")
coc_hazards = _load_sibling("coc_hazards_subsystem_executor", "coc_hazards.py")
coc_time = _load_sibling("coc_time_subsystem_executor", "coc_time.py")


class SubsystemExecutorError(ValueError):
    """Stable typed failure for command, state, and executor preflight errors."""

    def __init__(self, code: str, path: str, message: str) -> None:
        self.code = str(code)
        self.path = str(path)
        self.message = str(message)
        super().__init__(f"{self.code} at {self.path}: {self.message}")

    def to_dict(self) -> dict[str, str]:
        return {"code": self.code, "path": self.path, "message": self.message}


def _error(code: str, path: str, message: str) -> SubsystemExecutorError:
    return SubsystemExecutorError(code, path, message)


def _json_copy(value: Any) -> Any:
    return json.loads(json.dumps(value, ensure_ascii=False, allow_nan=False))


def _json_deep_equal(left: Any, right: Any) -> bool:
    """Compare JSON values without Python's bool/int equality aliasing."""
    try:
        options = {
            "ensure_ascii": False,
            "sort_keys": True,
            "separators": (",", ":"),
            "allow_nan": False,
        }
        return json.dumps(left, **options) == json.dumps(right, **options)
    except (TypeError, ValueError):
        return False


def _validate_json_value(value: Any, path: str) -> None:
    if value is None or isinstance(value, (str, bool, int)):
        return
    if isinstance(value, float):
        if not math.isfinite(value):
            raise _error("invalid_json_value", path, "numbers must be finite")
        return
    if isinstance(value, list):
        for index, item in enumerate(value):
            _validate_json_value(item, f"{path}[{index}]")
        return
    if isinstance(value, dict):
        for key, item in value.items():
            if not isinstance(key, str):
                raise _error("invalid_json_value", path, "object keys must be strings")
            _validate_json_value(item, f"{path}.{key}")
        return
    raise _error(
        "invalid_json_value",
        path,
        f"unsupported JSON value type: {type(value).__name__}",
    )


def _canonical_command_hash(command: dict[str, Any]) -> str:
    encoded = json.dumps(
        command,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _canonical_json_hash(value: Any) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _push_choice_id(command_id: str) -> str:
    """Return a stable safe push-choice ID for every valid command ID."""
    legacy = f"{command_id}:confirm"
    if _SAFE_ID.fullmatch(legacy):
        return legacy
    digest = hashlib.sha256(command_id.encode("utf-8")).hexdigest()
    return f"push:{digest}:confirm"


def _bout_choice_id(command_id: str) -> str:
    legacy = f"{command_id}:bout"
    if _SAFE_ID.fullmatch(legacy):
        return legacy
    digest = hashlib.sha256(command_id.encode("utf-8")).hexdigest()
    return f"bout:{digest}"


def _chase_choice_id(command_id: str) -> str:
    legacy = f"{command_id}:chase"
    if _SAFE_ID.fullmatch(legacy):
        return legacy
    return f"chase:{hashlib.sha256(command_id.encode('utf-8')).hexdigest()}"


# Pending-kind behavior is registered per result kind so Task 6 can add a
# second lifecycle without weakening or duplicating the push contract.
PENDING_CHOICE_CONTRACTS: dict[str, dict[str, Any]] = {
    "push_offer": {
        "status": "pending_choice",
        "choice_kind": "push_confirm",
        "choice_id": _push_choice_id,
        "responder": "player",
        "options": [
            {"action": "confirm", "label": "Push the roll"},
            {"action": "cancel", "label": "Keep the original failure"},
        ],
        "localized_options": {
            "zh-Hans": [
                {"action": "confirm", "label": "确认孤注一掷"},
                {"action": "cancel", "label": "保留原失败"},
            ],
        },
        "scope": "global",
    },
    "sanity_check": {
        "status": "pending_choice",
        "choice_kind": "bout_keeper_action",
        "choice_id": _bout_choice_id,
        "responder": "keeper",
        "options": [
            {"action": "tick", "label": "Advance Keeper-controlled round"},
            {"action": "end", "label": "End the bout now"},
        ],
        "scope": "global",
    },
    "bout_tick": {
        "status": "pending_choice",
        "choice_kind": "bout_keeper_action",
        "choice_id": None,
        "responder": "keeper",
        "options": [
            {"action": "tick", "label": "Advance Keeper-controlled round"},
            {"action": "end", "label": "End the bout now"},
        ],
        "scope": "global",
    },
    "chase_move": {
        "status": "pending_choice",
        "choice_kind": "chase_action",
        "choice_id": _chase_choice_id,
        "responder": "player",
        "options": None,
        "scope": "global",
    },
}


def _campaign_play_language(campaign_dir: Path) -> str:
    try:
        campaign = json.loads(
            (campaign_dir / "campaign.json").read_text(encoding="utf-8")
        )
    except (OSError, UnicodeError, json.JSONDecodeError):
        return "en-US"
    language = campaign.get("play_language") if isinstance(campaign, dict) else None
    return language.strip() if isinstance(language, str) and language.strip() else "en-US"


def _push_choice_content(
    skill: str,
    consequence_summary: str,
    play_language: str,
) -> tuple[str, list[dict[str, str]]]:
    if play_language == "zh-Hans":
        prompt = (
            f"是否要孤注一掷这次失败的{skill}检定？"
            f"若再次失败：{consequence_summary}"
        )
        options = PENDING_CHOICE_CONTRACTS["push_offer"]["localized_options"][
            "zh-Hans"
        ]
    else:
        prompt = (
            f"Push the failed {skill} roll? Failure consequence: "
            f"{consequence_summary}"
        )
        options = PENDING_CHOICE_CONTRACTS["push_offer"]["options"]
    return prompt, _json_copy(options)


def _localized_consequence_summary(
    consequence: dict[str, Any], play_language: str
) -> str:
    localized = consequence.get("localized_summaries")
    if isinstance(localized, dict):
        value = localized.get(play_language)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return str(consequence.get("summary") or "").strip()

PUBLIC_PENDING_CHOICE_KEYS = frozenset({
    "choice_id",
    "kind",
    "command_id",
    "responder",
    "revision",
    "prompt",
    "options",
})
PUSH_CONTEXT_KEYS = frozenset({
    "choice_id",
    "kind",
    "investigator_id",
    "character_id",
    "origin_command_id",
    "offer_command_id",
    "revision",
    "original_roll",
    "changed_method_evidence",
    "announced_consequence",
    "source_time_profile",
    "resolution_context",
    "origin_decision_id",
    "offer_command",
    "continuation_capsule",
})
PUSH_HISTORY_EXTRA_KEYS = frozenset({
    "public_choice",
    "terminal_action",
    "terminal_revision",
    "terminal_command_ids",
    "terminal_commands",
    "terminal_results",
    "terminal_result_receipt_hashes",
    "response_changed_method_evidence",
})
BOUT_CONTEXT_KEYS = frozenset({
    "choice_id",
    "kind",
    "investigator_id",
    "character_id",
    "origin_command_id",
    "bout_id",
    "revision",
    "remaining_rounds",
})
BOUT_HISTORY_EXTRA_KEYS = frozenset({
    "public_choice",
    "terminal_action",
    "terminal_revision",
    "terminal_command_ids",
    "terminal_commands",
    "terminal_results",
    "terminal_result_receipt_hashes",
})
CHASE_CONTEXT_KEYS = frozenset({
    "choice_id", "kind", "investigator_id", "character_id",
    "origin_command_id", "offer_command_id", "revision", "actor_id",
    "offer_command", "chase_id", "action_context",
})
CHASE_HISTORY_EXTRA_KEYS = frozenset({
    "public_choice", "terminal_action", "terminal_revision",
    "terminal_command_ids", "terminal_commands", "terminal_results",
    "terminal_result_receipt_hashes",
})
CHANGED_METHOD_SOURCES = frozenset({
    "player_proposal",
    "keeper_prompt",
    "module_instruction",
})

PUSH_CAPSULE_REQUIRED_KEYS = frozenset({
    "schema_version",
    "kind",
    "continuation_id",
    "campaign_binding",
    "actor_binding",
    "authority_revision",
    "roll_spec",
    "settlement",
    "source_evidence",
    "idempotency",
})
PUSH_CAPSULE_OPTIONAL_KEYS = frozenset({"audit_compatibility"})


def _campaign_binding(campaign_dir: Path | str) -> str:
    material = str(Path(campaign_dir).resolve()).encode("utf-8")
    return hashlib.sha256(material).hexdigest()


def _typed_push_consequence(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict) or not isinstance(value.get("summary"), str):
        return None
    if not value["summary"].strip() or set(value) - {
        "summary", "effect", "localized_summaries",
    }:
        return None
    localized = value.get("localized_summaries", {})
    if not isinstance(localized, dict) or any(
        not isinstance(language, str) or not language.strip()
        or not isinstance(summary, str) or not summary.strip()
        for language, summary in localized.items()
    ):
        return None
    effect = value.get("effect")
    if effect is not None and not isinstance(effect, dict):
        return None
    return _json_copy(value)


def _is_exact_source_time_profile(value: Any) -> bool:
    """Recognize the exact time authority accepted by Push commands.

    A Director fallback such as ``{mode: instant, category: null}`` describes
    runtime scheduling, not authored route authority, and must never be sealed
    into a continuation capsule.
    """
    return value is None or (
        isinstance(value, dict)
        and set(value) == {"mode", "category", "delta_minutes"}
        and value.get("mode") in {
            "instant", "elapsed", "downtime", "subsystem"
        }
        and isinstance(value.get("category"), str)
        and bool(value["category"].strip())
        and not isinstance(value.get("delta_minutes"), bool)
        and isinstance(value.get("delta_minutes"), int)
        and value["delta_minutes"] >= 0
    )


def _validate_sealed_route_transaction(value: Any) -> dict[str, Any] | None:
    if value is None:
        return None
    keys = {
        "schema_version", "kind", "scene_id", "route_id",
        "requires_completed_route_ids", "direct_grant_clue_ids",
        "remaining_clue_ids", "sets_flags", "completion_policy",
        "repeatable", "player_visible_goal", "player_visible_outcome",
        "source_time_profile", "source_provenance",
    }
    if not isinstance(value, dict) or set(value) != keys:
        raise _error("push_continuation_unbound", "continuation_capsule.settlement.route_transaction", "sealed route transaction has an invalid field set")
    if value.get("schema_version") != 1 or value.get("kind") != "authored_route_completion":
        raise _error("push_continuation_unbound", "continuation_capsule.settlement.route_transaction", "unsupported sealed route transaction")
    for field in ("scene_id", "route_id"):
        if not isinstance(value.get(field), str) or not _SAFE_ID.fullmatch(value[field]):
            raise _error("push_continuation_unbound", f"continuation_capsule.settlement.route_transaction.{field}", "sealed route identity must be a safe ID")
    for field in (
        "requires_completed_route_ids", "direct_grant_clue_ids",
        "remaining_clue_ids", "sets_flags",
    ):
        items = value.get(field)
        if (
            not isinstance(items, list)
            or len(items) != len(set(items))
            or any(not isinstance(item, str) or not _SAFE_ID.fullmatch(item) for item in items)
        ):
            raise _error("push_continuation_unbound", f"continuation_capsule.settlement.route_transaction.{field}", "sealed route ID lists must be unique safe IDs")
    if not isinstance(value.get("repeatable"), bool):
        raise _error("push_continuation_unbound", "continuation_capsule.settlement.route_transaction.repeatable", "repeatable must be boolean")
    if value.get("completion_policy") is not None and (
        not isinstance(value.get("completion_policy"), str)
        or not value["completion_policy"].strip()
    ):
        raise _error("push_continuation_unbound", "continuation_capsule.settlement.route_transaction.completion_policy", "completion policy must be null or non-empty")
    for field in ("player_visible_goal", "player_visible_outcome"):
        if not isinstance(value.get(field), str):
            raise _error("push_continuation_unbound", f"continuation_capsule.settlement.route_transaction.{field}", "visible route text must be a string")
    if not _is_exact_source_time_profile(value.get("source_time_profile")):
        raise _error(
            "push_continuation_unbound",
            "continuation_capsule.settlement.route_transaction.source_time_profile",
            "sealed route time profile must be null or exact structured authority",
        )
    provenance = value.get("source_provenance")
    if (
        not isinstance(provenance, dict)
        or set(provenance) != {"kind", "story_graph_sha256"}
        or provenance.get("kind") != "sealed_story_graph_route"
        or not isinstance(provenance.get("story_graph_sha256"), str)
        or not _SHA256.fullmatch(provenance["story_graph_sha256"])
    ):
        raise _error("push_continuation_unbound", "continuation_capsule.settlement.route_transaction.source_provenance", "sealed route provenance is invalid")
    return _json_copy(value)


def _validate_push_capsule(
    capsule: Any,
    *,
    campaign_dir: Path | str | None,
    investigator_id: str,
    character_id: str,
) -> dict[str, Any]:
    if (
        not isinstance(capsule, dict)
        or not PUSH_CAPSULE_REQUIRED_KEYS <= set(capsule)
        or set(capsule) - PUSH_CAPSULE_REQUIRED_KEYS - PUSH_CAPSULE_OPTIONAL_KEYS
    ):
        raise _error(
            "push_continuation_unbound",
            "continuation_capsule",
            "persisted Push continuation capsule has an invalid field set",
        )
    if capsule.get("schema_version") != 1 or capsule.get("kind") != "push_continuation":
        raise _error(
            "push_continuation_unbound",
            "continuation_capsule",
            "unsupported Push continuation capsule schema",
        )
    continuation_id = capsule.get("continuation_id")
    if not isinstance(continuation_id, str) or not _SAFE_ID.fullmatch(continuation_id):
        raise _error("push_continuation_unbound", "continuation_capsule.continuation_id", "invalid continuation capability")
    if campaign_dir is not None and capsule.get("campaign_binding") != _campaign_binding(campaign_dir):
        raise _error("push_continuation_campaign_mismatch", "continuation_capsule.campaign_binding", "continuation belongs to a different campaign")
    actor = capsule.get("actor_binding")
    if not isinstance(actor, dict) or set(actor) != {"investigator_id", "character_id"}:
        raise _error("push_continuation_unbound", "continuation_capsule.actor_binding", "invalid actor binding")
    if actor != {"investigator_id": investigator_id, "character_id": character_id}:
        raise _error("push_origin_actor_mismatch", "continuation_capsule.actor_binding", "continuation belongs to a different actor")
    if capsule.get("authority_revision") != 0:
        raise _error("stale_pending_choice_response", "continuation_capsule.authority_revision", "continuation authority revision is stale")
    roll_spec = capsule.get("roll_spec")
    if not isinstance(roll_spec, dict) or set(roll_spec) != {
        "kind", "skill", "target", "difficulty", "bonus_penalty_dice",
        "reason", "roll_contract",
    }:
        raise _error("push_continuation_unbound", "continuation_capsule.roll_spec", "invalid immutable roll authority")
    settlement = capsule.get("settlement")
    if not isinstance(settlement, dict) or set(settlement) != {
        "plan_slice", "route_resolution", "request_id", "announced_consequence",
        "source_time_profile", "route_transaction",
    }:
        raise _error("push_continuation_unbound", "continuation_capsule.settlement", "invalid immutable settlement authority")
    if not isinstance(settlement.get("plan_slice"), dict):
        raise _error("push_continuation_unbound", "continuation_capsule.settlement.plan_slice", "missing settlement plan")
    if _typed_push_consequence(settlement.get("announced_consequence")) is None:
        raise _error("push_continuation_unbound", "continuation_capsule.settlement.announced_consequence", "missing typed Push consequence")
    transaction = _validate_sealed_route_transaction(
        settlement.get("route_transaction")
    )
    source_time_profile = settlement.get("source_time_profile")
    if not _is_exact_source_time_profile(source_time_profile):
        raise _error(
            "push_continuation_unbound",
            "continuation_capsule.settlement.source_time_profile",
            "Push time authority must be null or an exact structured profile",
        )
    if (
        isinstance(transaction, dict)
        and not _json_deep_equal(
            source_time_profile, transaction.get("source_time_profile")
        )
    ):
        raise _error(
            "push_continuation_unbound",
            "continuation_capsule.settlement.source_time_profile",
            "Push time authority is detached from the sealed authored route",
        )
    request_id = settlement.get("request_id")
    if not isinstance(request_id, str) or not _SAFE_ID.fullmatch(request_id):
        raise _error("push_continuation_unbound", "continuation_capsule.settlement.request_id", "missing settlement request capability")
    source = capsule.get("source_evidence")
    if not isinstance(source, dict) or set(source) != {
        "origin_command_id", "origin_decision_id", "roll_id", "scene_id",
    }:
        raise _error("push_continuation_unbound", "continuation_capsule.source_evidence", "invalid source evidence")
    idem = capsule.get("idempotency")
    if not isinstance(idem, dict) or set(idem) != {"key", "mode", "consumption_ledger"} or idem.get("mode") != "exact_once" or idem.get("consumption_ledger") != "choice_history":
        raise _error("push_continuation_unbound", "continuation_capsule.idempotency", "invalid exact-once authority")
    if not isinstance(idem.get("key"), str) or not _SAFE_ID.fullmatch(idem["key"]):
        raise _error("push_continuation_unbound", "continuation_capsule.idempotency.key", "invalid idempotency key")
    if "audit_compatibility" in capsule and not isinstance(
        capsule.get("audit_compatibility"), dict
    ):
        raise _error("push_continuation_unbound", "continuation_capsule.audit_compatibility", "invalid audit compatibility record")
    expected_material = _json_copy(capsule)
    expected_material.pop("audit_compatibility", None)
    expected_material["continuation_id"] = None
    expected_material["settlement"]["request_id"] = None
    if isinstance(expected_material["settlement"]["route_resolution"], dict):
        expected_material["settlement"]["route_resolution"]["request_id"] = None
    expected_material["idempotency"]["key"] = None
    digest = _canonical_json_hash(expected_material)
    expected_id = f"push-cont:{digest}"
    if continuation_id != expected_id:
        raise _error("push_continuation_unbound", "continuation_capsule.continuation_id", "continuation capability does not match immutable authority")
    expected_request_id = f"push-settle:{digest}"
    expected_idem = f"push-once:{digest}"
    if request_id != expected_request_id or idem.get("key") != expected_idem:
        raise _error("push_continuation_unbound", "continuation_capsule", "continuation settlement identifiers are forged")
    return _json_copy(capsule)


def _default_state() -> dict[str, Any]:
    return {
        "schema_version": STATE_SCHEMA_VERSION,
        "applied_command_ids": [],
        "command_hashes": {},
        "command_provenance": {},
        "result_snapshots": {},
        "pending_choices": {},
        "pending_contexts": {},
        "choice_history": {},
        "inflight": None,
    }


def _unsafe_state_path(message: str) -> SubsystemExecutorError:
    return _error(
        "unsafe_subsystem_state_path",
        STATE_RELATIVE_PATH.as_posix(),
        message,
    )


class _ExecutorStateDirectory:
    """Descriptor-anchored access to the executor-owned state file.

    POSIX directory descriptors keep reads, temporary creation, and replace
    bound to the directory that was actually opened. Inode verification makes
    namespace swaps fail closed instead of following a newly inserted symlink.
    """

    _STATE_FILENAME = "subsystem-state.json"

    def __init__(self, campaign_dir: Path) -> None:
        directory_flag = getattr(os, "O_DIRECTORY", None)
        nofollow_flag = getattr(os, "O_NOFOLLOW", None)
        if directory_flag is None or nofollow_flag is None:
            raise _unsafe_state_path(
                "runtime lacks required O_DIRECTORY/O_NOFOLLOW primitives"
            )
        required_dir_fd = (os.open, os.mkdir, os.stat, os.unlink)
        if (
            any(function not in os.supports_dir_fd for function in required_dir_fd)
            or os.stat not in os.supports_follow_symlinks
        ):
            raise _unsafe_state_path(
                "runtime lacks required dir_fd/follow_symlinks primitives"
            )
        try:
            self.campaign_path = Path(campaign_dir).resolve()
            flags = os.O_RDONLY | directory_flag | nofollow_flag | getattr(os, "O_CLOEXEC", 0)
            self.campaign_fd = os.open(self.campaign_path, flags)
        except (OSError, RuntimeError) as exc:
            raise _unsafe_state_path("campaign root could not be opened safely") from exc
        self._directory_flags = flags
        self.save_fd: int | None = None
        self._save_identity: tuple[int, int] | None = None
        try:
            self._verify_campaign_identity()
            self._open_existing_save()
        except Exception:
            self.close()
            raise

    def __enter__(self) -> "_ExecutorStateDirectory":
        return self

    def __exit__(self, _exc_type, _exc, _tb) -> None:
        self.close()

    @staticmethod
    def _identity(info: os.stat_result) -> tuple[int, int]:
        return int(info.st_dev), int(info.st_ino)

    def _verify_campaign_identity(self) -> None:
        try:
            opened = os.fstat(self.campaign_fd)
            named = os.stat(self.campaign_path, follow_symlinks=False)
        except OSError as exc:
            raise _unsafe_state_path("campaign root identity could not be verified") from exc
        if (
            not stat.S_ISDIR(opened.st_mode)
            or not stat.S_ISDIR(named.st_mode)
            or self._identity(opened) != self._identity(named)
        ):
            raise _unsafe_state_path("campaign root identity changed")

    def _open_existing_save(self) -> None:
        try:
            self.save_fd = os.open(
                "save",
                self._directory_flags,
                dir_fd=self.campaign_fd,
            )
        except FileNotFoundError:
            self.save_fd = None
            self._save_identity = None
            return
        except (OSError, TypeError) as exc:
            raise _unsafe_state_path("save directory could not be opened without following links") from exc
        opened = os.fstat(self.save_fd)
        self._save_identity = self._identity(opened)
        self.verify_parent()

    def ensure_save(self) -> int:
        if self.save_fd is not None:
            self.verify_parent()
            return self.save_fd
        try:
            os.mkdir("save", mode=0o755, dir_fd=self.campaign_fd)
        except FileExistsError:
            pass
        except (OSError, TypeError) as exc:
            raise _unsafe_state_path("save directory could not be created safely") from exc
        self._open_existing_save()
        if self.save_fd is None:
            raise _unsafe_state_path("save directory disappeared during creation")
        return self.save_fd

    def verify_parent(self) -> None:
        if self.save_fd is None or self._save_identity is None:
            return
        self._verify_campaign_identity()
        try:
            opened = os.fstat(self.save_fd)
            named = os.stat(
                "save",
                dir_fd=self.campaign_fd,
                follow_symlinks=False,
            )
        except (OSError, TypeError) as exc:
            raise _unsafe_state_path("save directory identity could not be verified") from exc
        if (
            not stat.S_ISDIR(opened.st_mode)
            or not stat.S_ISDIR(named.st_mode)
            or self._identity(opened) != self._save_identity
            or self._identity(named) != self._save_identity
        ):
            raise _unsafe_state_path("save directory identity changed during state access")

    def read_bytes(self) -> bytes | None:
        if self.save_fd is None:
            return None
        self.verify_parent()
        try:
            state_fd = os.open(
                self._STATE_FILENAME,
                os.O_RDONLY | getattr(os, "O_NOFOLLOW") | getattr(os, "O_CLOEXEC", 0),
                dir_fd=self.save_fd,
            )
        except FileNotFoundError:
            self.verify_parent()
            return None
        except (OSError, TypeError) as exc:
            raise _unsafe_state_path("executor state file could not be opened safely") from exc
        try:
            if not stat.S_ISREG(os.fstat(state_fd).st_mode):
                raise _unsafe_state_path("executor state target must be a regular file")
            chunks: list[bytes] = []
            while True:
                chunk = os.read(state_fd, 64 * 1024)
                if not chunk:
                    break
                chunks.append(chunk)
        finally:
            os.close(state_fd)
        self.verify_parent()
        return b"".join(chunks)

    def write_bytes(self, payload: bytes) -> None:
        save_fd = self.ensure_save()
        self.verify_parent()
        temp_name = (
            f".subsystem-state.{os.getpid()}.{time.time_ns()}.tmp"
        )
        temp_fd: int | None = None
        replaced = False
        try:
            temp_fd = os.open(
                temp_name,
                os.O_WRONLY
                | os.O_CREAT
                | os.O_EXCL
                | getattr(os, "O_NOFOLLOW")
                | getattr(os, "O_CLOEXEC", 0),
                0o600,
                dir_fd=save_fd,
            )
            view = memoryview(payload)
            while view:
                written = os.write(temp_fd, view)
                view = view[written:]
            os.fsync(temp_fd)
            os.close(temp_fd)
            temp_fd = None
            self.verify_parent()
            os.replace(
                temp_name,
                self._STATE_FILENAME,
                src_dir_fd=save_fd,
                dst_dir_fd=save_fd,
            )
            replaced = True
            os.fsync(save_fd)
            self.verify_parent()
        except TypeError as exc:
            raise _unsafe_state_path(
                "runtime lacks required dir_fd atomic replace primitives"
            ) from exc
        finally:
            if temp_fd is not None:
                os.close(temp_fd)
            if not replaced:
                try:
                    os.unlink(temp_name, dir_fd=save_fd)
                except FileNotFoundError:
                    pass
                except (OSError, TypeError):
                    pass

    def close(self) -> None:
        if self.save_fd is not None:
            os.close(self.save_fd)
            self.save_fd = None
        campaign_fd = getattr(self, "campaign_fd", None)
        if campaign_fd is not None:
            os.close(campaign_fd)
            self.campaign_fd = None


def _state_error(message: str) -> SubsystemExecutorError:
    return _error(
        "malformed_subsystem_state",
        STATE_RELATIVE_PATH.as_posix(),
        message,
    )


def _command_provenance(
    command: dict[str, Any],
    investigator_id: str,
    character: dict[str, Any] | None,
) -> dict[str, Any]:
    kind = command["kind"]
    character_id = None
    if kind in CHARACTER_REQUIRED_COMMAND_KINDS:
        assert character is not None
        character_id = character["id"]
    return {
        "investigator_id": investigator_id,
        "character_id": character_id,
        "decision_id": command["payload"].get("decision_id"),
    }


def _validate_pending_choice_contract(
    command_id: str,
    result_kind: str,
    status: str,
    pending: Any,
) -> None:
    contract = PENDING_CHOICE_CONTRACTS.get(result_kind)
    if contract is None:
        if pending is not None:
            raise _state_error(
                f"result snapshot {command_id!r} cannot carry a pending choice"
            )
        return
    if pending is None:
        if status == contract["status"]:
            raise _state_error(
                f"result snapshot {command_id!r} lacks its pending choice"
            )
        return
    if status != contract["status"] or not isinstance(pending, dict):
        raise _state_error(
            f"result snapshot {command_id!r} has an invalid pending status/choice"
        )
    choice_id_factory = contract.get("choice_id")
    expected_choice_id = (
        choice_id_factory(command_id) if callable(choice_id_factory) else None
    )
    if expected_choice_id is not None and pending.get("choice_id") != expected_choice_id:
        raise _state_error(
            f"result snapshot {command_id!r} has an invalid pending choice_id"
        )
    if not isinstance(pending.get("choice_id"), str) or not _SAFE_ID.fullmatch(
        pending["choice_id"]
    ):
        raise _state_error(
            f"result snapshot {command_id!r} has an unsafe pending choice_id"
        )
    if pending.get("kind") != contract["choice_kind"]:
        raise _state_error(
            f"result snapshot {command_id!r} has an invalid pending choice kind"
        )
    if pending.get("command_id") != command_id:
        raise _state_error(
            f"result snapshot {command_id!r} has a mismatched pending command_id"
        )
    if set(pending) != PUBLIC_PENDING_CHOICE_KEYS:
        raise _state_error(
            f"result snapshot {command_id!r} has an invalid public choice contract"
        )
    if pending.get("responder") != contract["responder"]:
        raise _state_error(
            f"result snapshot {command_id!r} has an invalid choice responder"
        )
    revision = pending.get("revision")
    if isinstance(revision, bool) or not isinstance(revision, int) or revision < 0:
        raise _state_error(
            f"result snapshot {command_id!r} has an invalid choice revision"
        )
    prompt = pending.get("prompt")
    if not isinstance(prompt, str) or not prompt.strip():
        raise _state_error(
            f"result snapshot {command_id!r} has an empty public choice prompt"
        )
    localized_options = contract.get("localized_options")
    if isinstance(localized_options, dict):
        allowed_options = [contract["options"], *localized_options.values()]
        if not any(
            _json_deep_equal(pending.get("options"), option_set)
            for option_set in allowed_options
        ):
            raise _state_error(
                f"result snapshot {command_id!r} has invalid player-safe options"
            )
    elif contract["options"] is None:
        options = pending.get("options")
        if (
            not isinstance(options, list) or len(options) < 2
            or any(not isinstance(option, dict) or set(option) != {"action", "label"}
                   or not isinstance(option.get("action"), str)
                   or not _SAFE_ID.fullmatch(option["action"])
                   or not isinstance(option.get("label"), str)
                   or not option["label"].strip() for option in options)
            or len({option["action"] for option in options}) != len(options)
        ):
            raise _state_error(
                f"result snapshot {command_id!r} has invalid player-safe options"
            )
    elif not _json_deep_equal(pending.get("options"), contract["options"]):
        raise _state_error(
            f"result snapshot {command_id!r} has invalid player-safe options"
        )


def _pending_scope_key(
    result_kind: str,
    *,
    pending_choice: dict[str, Any] | None = None,
    command: dict[str, Any] | None = None,
) -> str:
    contract = PENDING_CHOICE_CONTRACTS[result_kind]
    resolver = contract.get("scope", "global")
    if callable(resolver):
        return str(
            resolver(
                result_kind=result_kind,
                pending_choice=pending_choice,
                command=command,
            )
        )
    return str(resolver)


def _validate_result_snapshot(command_id: str, result: Any) -> None:
    if not isinstance(result, dict) or set(result) != RESULT_KEYS:
        raise _state_error(f"result snapshot {command_id!r} has an invalid contract")
    if result.get("command_id") != command_id:
        raise _state_error(f"result snapshot {command_id!r} has a mismatched command_id")
    kind = result.get("kind")
    status = result.get("status")
    if not isinstance(kind, str) or not isinstance(status, str):
        raise _state_error(f"result snapshot {command_id!r} has invalid kind/status")
    if kind not in RESULT_STATUSES_BY_KIND or status not in RESULT_STATUSES_BY_KIND[kind]:
        raise _state_error(f"result snapshot {command_id!r} has unsupported kind/status")
    events = result.get("events")
    if not isinstance(events, list) or not all(isinstance(item, dict) for item in events):
        raise _state_error(f"result snapshot {command_id!r} has invalid events")
    pending = result.get("pending_choice")
    if pending is not None and not isinstance(pending, dict):
        raise _state_error(f"result snapshot {command_id!r} has invalid pending_choice")
    _validate_pending_choice_contract(command_id, kind, status, pending)
    refs = result.get("state_refs")
    if not isinstance(refs, list) or not all(isinstance(item, str) for item in refs):
        raise _state_error(f"result snapshot {command_id!r} has invalid state_refs")
    try:
        _validate_json_value(result, f"result_snapshots.{command_id}")
    except SubsystemExecutorError as exc:
        raise _state_error(str(exc)) from exc


def _allowed_preimage_path(path: str) -> bool:
    if path in {
        "save/sanity.json",
        "save/combat.json",
        "save/chase.json",
        "save/time-state.json",
        "save/time-triggers.json",
    }:
        return True
    prefix = "save/investigator-state/"
    suffix = ".json"
    if path.startswith(prefix) and path.endswith(suffix):
        investigator_id = path[len(prefix):-len(suffix)]
        return bool(_SAFE_ID.fullmatch(investigator_id))
    prefix = "save/sanity-state/"
    if path.startswith(prefix) and path.endswith(suffix):
        investigator_id = path[len(prefix):-len(suffix)]
        return bool(_SAFE_ID.fullmatch(investigator_id))
    return False


def _validate_inflight(inflight: Any) -> None:
    if inflight is None:
        return
    if not isinstance(inflight, dict) or set(inflight) != {
        "commands", "preimages", "log_offsets",
    }:
        raise _state_error("inflight must contain commands, preimages, and log_offsets")
    commands = inflight.get("commands")
    if not isinstance(commands, list) or not commands:
        raise _state_error("inflight.commands must be a non-empty list")
    for entry in commands:
        if not isinstance(entry, dict) or set(entry) != {"command_id", "command_hash"}:
            raise _state_error("inflight command entries have an invalid contract")
        if not isinstance(entry["command_id"], str) or not _SAFE_ID.fullmatch(entry["command_id"]):
            raise _state_error("inflight command_id must be a stable safe ID")
        if not isinstance(entry["command_hash"], str) or not _SHA256.fullmatch(entry["command_hash"]):
            raise _state_error("inflight command_hash must be SHA-256 hex")

    preimages = inflight.get("preimages")
    if not isinstance(preimages, dict):
        raise _state_error("inflight.preimages must be an object")
    for relative, preimage in preimages.items():
        if not isinstance(relative, str) or not _allowed_preimage_path(relative):
            raise _state_error(f"unsafe inflight preimage path: {relative!r}")
        if not isinstance(preimage, dict) or set(preimage) != {"exists", "encoding", "data"}:
            raise _state_error(f"invalid preimage contract for {relative!r}")
        exists = preimage.get("exists")
        if not isinstance(exists, bool) or preimage.get("encoding") != "base64":
            raise _state_error(f"invalid preimage metadata for {relative!r}")
        data = preimage.get("data")
        if not exists:
            if data is not None:
                raise _state_error(f"absent preimage {relative!r} must have null data")
            continue
        if not isinstance(data, str):
            raise _state_error(f"present preimage {relative!r} must contain base64 data")
        try:
            decoded = base64.b64decode(data.encode("ascii"), validate=True)
            decoded.decode("utf-8")
        except (ValueError, UnicodeError) as exc:
            raise _state_error(f"invalid base64/UTF-8 preimage for {relative!r}") from exc

    offsets = inflight.get("log_offsets")
    if not isinstance(offsets, dict) or set(offsets) - {
        "logs/rolls.jsonl",
        "logs/time.jsonl",
            "logs/subsystem-results.jsonl",
            "logs/push-offers.jsonl",
            "logs/chase-offers.jsonl",
            "logs/chase-conflicts.jsonl",
            "logs/chase-genesis.jsonl",
        }:
        raise _state_error("inflight.log_offsets contains an unsafe path")
    for relative, offset in offsets.items():
        if not isinstance(offset, dict) or set(offset) != {"exists", "size"}:
            raise _state_error(f"invalid log offset contract for {relative!r}")
        if not isinstance(offset.get("exists"), bool):
            raise _state_error(f"invalid log existence marker for {relative!r}")
        size = offset.get("size")
        if isinstance(size, bool) or not isinstance(size, int) or size < 0:
            raise _state_error(f"invalid log size for {relative!r}")


_SCHEMA_V2_KEYS = frozenset({
    "schema_version",
    "applied_command_ids",
    "command_hashes",
    "command_provenance",
    "result_snapshots",
    "pending_choices",
    "inflight",
})


def _migrate_schema_v2(state: Any) -> dict[str, Any]:
    """Validate and migrate the released Task 5 shape without inventing secrets."""
    if not isinstance(state, dict) or set(state) != _SCHEMA_V2_KEYS:
        raise _state_error("schema v2 state root has an invalid field set")
    pending = state.get("pending_choices")
    if not isinstance(pending, dict):
        raise _state_error("schema v2 pending_choices must be an object")
    if pending:
        raise _state_error(
            "schema v2 pending choices cannot be migrated without private context"
        )
    migrated = _json_copy(state)
    migrated["schema_version"] = STATE_SCHEMA_VERSION
    migrated["pending_contexts"] = {}
    migrated["choice_history"] = {}
    return _validate_state(migrated)


def _validate_push_pending_context(
    choice_id: str,
    context: Any,
    *,
    choice: dict[str, Any],
    applied_ids: set[str],
    snapshots: dict[str, Any],
    provenance: dict[str, Any],
    hashes: dict[str, str],
) -> None:
    if not isinstance(context, dict) or set(context) != PUSH_CONTEXT_KEYS:
        raise _state_error(f"pending context {choice_id!r} has an invalid contract")
    if context.get("choice_id") != choice_id or context.get("kind") != choice.get("kind"):
        raise _state_error(f"pending context {choice_id!r} mismatches its public choice")
    if context.get("offer_command_id") != choice.get("command_id"):
        raise _state_error(f"pending context {choice_id!r} mismatches its creator command")
    offer_command = context.get("offer_command")
    offer_id = context.get("offer_command_id")
    if (
        not isinstance(offer_command, dict)
        or offer_command.get("command_id") != context.get("offer_command_id")
        or offer_command.get("kind") != "push_offer"
        or offer_command.get("phase") != "offer"
        or set(offer_command) != COMMAND_KEYS
        or _canonical_command_hash(offer_command)
        != hashes.get(offer_id)
    ):
        raise _state_error(f"pending context {choice_id!r} lacks its immutable creator command")
    if context.get("revision") != choice.get("revision"):
        raise _state_error(f"pending context {choice_id!r} mismatches its revision")
    investigator_id = context.get("investigator_id")
    character_id = context.get("character_id")
    if (
        not isinstance(investigator_id, str)
        or not _SAFE_ID.fullmatch(investigator_id)
        or character_id != investigator_id
    ):
        raise _state_error(f"pending context {choice_id!r} has invalid actor identity")
    origin_id = context.get("origin_command_id")
    if not isinstance(origin_id, str) or origin_id not in applied_ids:
        raise _state_error(f"pending context {choice_id!r} has an invalid origin command")
    origin_snapshot = snapshots[origin_id]
    origin_provenance = provenance[origin_id]
    offer_provenance = provenance.get(offer_id)
    if (
        offer_id not in applied_ids
        or snapshots[offer_id].get("kind") != "push_offer"
        or not isinstance(offer_provenance, dict)
        or offer_provenance.get("investigator_id") != investigator_id
        or offer_provenance.get("character_id") != character_id
        or offer_provenance.get("decision_id")
        != offer_command.get("payload", {}).get("decision_id")
    ):
        raise _state_error(f"pending context {choice_id!r} has invalid creator provenance")
    if origin_snapshot.get("kind") not in {"skill_check", "characteristic_check"}:
        raise _state_error(f"pending context {choice_id!r} has an ineligible origin kind")
    if (
        origin_provenance.get("investigator_id") != investigator_id
        or origin_provenance.get("character_id") != character_id
        or context.get("origin_decision_id") != origin_provenance.get("decision_id")
    ):
        raise _state_error(f"pending context {choice_id!r} has mismatched origin provenance")
    origin_events = origin_snapshot.get("events") or []
    if len(origin_events) != 1 or not _json_deep_equal(
        context.get("original_roll"), origin_events[0]
    ):
        raise _state_error(f"pending context {choice_id!r} mismatches persisted roll evidence")
    if not _json_deep_equal(
        context.get("resolution_context"), origin_events[0].get("resolution_context") or {}
    ):
        raise _state_error(f"pending context {choice_id!r} mismatches origin resolution context")
    capsule = origin_events[0].get("push_continuation_capsule")
    if not isinstance(capsule, dict) or not _json_deep_equal(
        context.get("continuation_capsule"), capsule
    ):
        raise _state_error(f"pending context {choice_id!r} mismatches continuation authority")
    offer_payload = offer_command.get("payload")
    if not isinstance(offer_payload, dict) or (
        (
            offer_payload.get("continuation_id") != capsule.get("continuation_id")
            if offer_payload.get("continuation_id") is not None
            else offer_payload.get("original_command_id") != origin_id
        )
        or not _json_deep_equal(
            context.get("changed_method_evidence"),
            offer_payload.get("changed_method_evidence"),
        )
        or not _json_deep_equal(
            context.get("announced_consequence"),
            offer_payload.get("announced_consequence"),
        )
        or not _json_deep_equal(
            context.get("source_time_profile"),
            offer_payload.get("source_time_profile"),
        )
    ):
        raise _state_error(f"pending context {choice_id!r} diverges from its creator command")
    skill = str(origin_events[0].get("skill") or "ordinary")
    consequence = offer_payload["announced_consequence"]
    valid_choice_content = [
        _push_choice_content(
            skill,
            _localized_consequence_summary(consequence, language),
            language,
        )
        for language in ("en-US", "zh-Hans")
    ]
    if not any(
        choice.get("prompt") == prompt
        and _json_deep_equal(choice.get("options"), options)
        for prompt, options in valid_choice_content
    ):
        raise _state_error(f"pending context {choice_id!r} has a forged public prompt")
    try:
        _validate_json_value(context, f"pending_contexts.{choice_id}")
    except SubsystemExecutorError as exc:
        raise _state_error(str(exc)) from exc


def _validate_bout_pending_context(
    choice_id: str,
    context: Any,
    *,
    choice: dict[str, Any],
    applied_ids: set[str],
    snapshots: dict[str, Any],
    provenance: dict[str, Any],
    hashes: dict[str, str],
) -> None:
    _ = hashes
    if not isinstance(context, dict) or set(context) != BOUT_CONTEXT_KEYS:
        raise _state_error(f"pending context {choice_id!r} has an invalid bout contract")
    if context.get("choice_id") != choice_id or context.get("kind") != "bout_keeper_action":
        raise _state_error(f"pending context {choice_id!r} mismatches its public bout choice")
    if context.get("revision") != choice.get("revision"):
        raise _state_error(f"pending context {choice_id!r} mismatches its bout revision")
    investigator_id = context.get("investigator_id")
    if (
        not isinstance(investigator_id, str)
        or not _SAFE_ID.fullmatch(investigator_id)
        or context.get("character_id") != investigator_id
    ):
        raise _state_error(f"pending context {choice_id!r} has invalid bout actor identity")
    origin_id = context.get("origin_command_id")
    if not isinstance(origin_id, str) or origin_id not in applied_ids:
        raise _state_error(f"pending context {choice_id!r} has an invalid bout origin")
    if snapshots[origin_id].get("kind") != "sanity_check":
        raise _state_error(f"pending context {choice_id!r} has a non-SAN bout origin")
    origin_provenance = provenance[origin_id]
    if (
        origin_provenance.get("investigator_id") != investigator_id
        or origin_provenance.get("character_id") != investigator_id
    ):
        raise _state_error(f"pending context {choice_id!r} mismatches bout origin provenance")
    bout_id = context.get("bout_id")
    remaining = context.get("remaining_rounds")
    if not isinstance(bout_id, str) or not _SAFE_ID.fullmatch(bout_id):
        raise _state_error(f"pending context {choice_id!r} has an invalid bout_id")
    if isinstance(remaining, bool) or not isinstance(remaining, int) or remaining < 1:
        raise _state_error(f"pending context {choice_id!r} has invalid remaining rounds")
    creator_id = choice.get("command_id")
    creator = snapshots.get(creator_id, {})
    expected_bout_id = None
    expected_remaining = None
    for event in creator.get("events") or []:
        if not isinstance(event, dict):
            continue
        if event.get("event_type") == "bout_tick":
            expected_bout_id = event.get("bout_id")
            expected_remaining = event.get("remaining_rounds")
        elif event.get("event_type") == "bout_of_madness":
            expected_bout_id = event.get("bout_id")
            expected_remaining = event.get("duration_rounds")
    if expected_bout_id != bout_id or expected_remaining != remaining:
        raise _state_error(f"pending context {choice_id!r} diverges from its creator bout result")
    try:
        _validate_json_value(context, f"pending_contexts.{choice_id}")
    except SubsystemExecutorError as exc:
        raise _state_error(str(exc)) from exc


def _validate_chase_pending_context(
    choice_id: str, context: Any, *, choice: dict[str, Any],
    applied_ids: set[str], snapshots: dict[str, Any],
    provenance: dict[str, Any], hashes: dict[str, str],
) -> None:
    if not isinstance(context, dict) or set(context) != CHASE_CONTEXT_KEYS:
        raise _state_error(f"pending context {choice_id!r} has an invalid chase contract")
    if context.get("choice_id") != choice_id or context.get("kind") != "chase_action":
        raise _state_error(f"pending context {choice_id!r} has invalid chase identity")
    offer_id = context.get("offer_command_id")
    offer = context.get("offer_command")
    if (
        not isinstance(offer_id, str) or offer_id not in applied_ids
        or not isinstance(offer, dict) or offer.get("command_id") != offer_id
        or hashes.get(offer_id) != _canonical_command_hash(offer)
        or snapshots.get(offer_id, {}).get("kind") != "chase_move"
        or not _json_deep_equal(snapshots[offer_id].get("pending_choice"), choice)
    ):
        raise _state_error(f"pending context {choice_id!r} is not anchored to its chase offer")
    payload = offer.get("payload") or {}
    action_context = context.get("action_context")
    barrier = action_context.get("barrier") if isinstance(action_context, dict) else None
    barrier_id = barrier.get("barrier_id") if isinstance(barrier, dict) else None
    expected_options = [
        {"action": f"barrier:{barrier_id}:negotiate", "label": f"Negotiate {barrier_id}"},
        {"action": f"barrier:{barrier_id}:break", "label": f"Break through {barrier_id}"},
    ]
    if (
        payload.get("action_id") != "choice:offer"
        or context.get("origin_command_id") != offer_id
        or context.get("revision") != payload.get("revision")
        or context.get("actor_id") != payload.get("actor_id")
        or context.get("chase_id") is None
        or not isinstance(action_context, dict)
        or set(action_context) != {"barrier", "location_index"}
        or not isinstance(barrier_id, str)
        or not _json_deep_equal(choice.get("options"), expected_options)
        or context.get("investigator_id") != provenance[offer_id].get("investigator_id")
        or context.get("character_id") != provenance[offer_id].get("character_id")
        or choice.get("revision") != 0
    ):
        raise _state_error(f"pending context {choice_id!r} diverges from its chase offer")


def _validate_private_choice_context(
    choice_id: str,
    context: Any,
    *,
    choice: dict[str, Any],
    applied_ids: set[str],
    snapshots: dict[str, Any],
    provenance: dict[str, Any],
    hashes: dict[str, str],
) -> None:
    validator = (
        _validate_push_pending_context
        if choice.get("kind") == "push_confirm"
        else _validate_bout_pending_context
        if choice.get("kind") == "bout_keeper_action"
        else _validate_chase_pending_context
        if choice.get("kind") == "chase_action"
        else None
    )
    if validator is None:
        raise _state_error(f"pending context {choice_id!r} has unsupported choice kind")
    validator(
        choice_id,
        context,
        choice=choice,
        applied_ids=applied_ids,
        snapshots=snapshots,
        provenance=provenance,
        hashes=hashes,
    )


def _validate_history_terminal_snapshot(
    choice_id: str,
    entry: dict[str, Any],
    command: dict[str, Any],
    snapshot: dict[str, Any],
    all_snapshots: dict[str, Any],
) -> None:
    """Bind a consumed choice to the exact terminal result contract."""
    command_id = command["command_id"]
    kind = command["kind"]
    action = entry["terminal_action"]
    history_ref = f"save/subsystem-state.json#choice_history/{choice_id}"
    if snapshot.get("pending_choice") is not None:
        raise _state_error(f"choice history {choice_id!r} terminal result cannot remain pending")

    if kind == "push_confirm":
        expected_status = "cancelled" if action == "cancel" else "completed"
        expected_events: list[dict[str, Any]] = []
        if action == "confirm":
            expected_events = [{
                "event_type": "push_confirmed",
                "kind": "push_confirm",
                "choice_id": choice_id,
                "revision": entry["terminal_revision"],
                "source_command_id": command_id,
                "original_command_id": entry["origin_command_id"],
                "changed_method_evidence": _json_copy(
                    entry["response_changed_method_evidence"]
                ),
            }]
        if (
            snapshot.get("status") != expected_status
            or not _json_deep_equal(snapshot.get("events"), expected_events)
            or snapshot.get("state_refs") != [history_ref]
        ):
            raise _state_error(f"choice history {choice_id!r} has an invalid push-confirm result")
        return

    if kind == "push_resolve":
        events = snapshot.get("events")
        if (
            snapshot.get("status") != "completed"
            or snapshot.get("state_refs")
            != [f"logs/rolls.jsonl#{command_id}", history_ref]
            or not isinstance(events, list)
            or len(events) != 1
        ):
            raise _state_error(f"choice history {choice_id!r} has an invalid push-resolve result")
        event = events[0]
        original = entry["original_roll"]
        capsule = entry["continuation_capsule"]
        roll_spec = capsule["roll_spec"]
        expected_roll_contract, _ = _settle_percentile_fumble_contract(
            roll_spec.get("roll_contract"),
            event.get("outcome"),
            path=f"commands.{command_id}.payload.roll_contract",
        )
        expected_keys = {
            "roll_id", "decision_id", "kind", "skill", "target", "difficulty",
            "reason", "request_id", "bonus_penalty_dice", "roll",
            "effective_target", "outcome", "success", "roll_contract",
            "resolution_context", "pushed", "push_gate", "original_command_id",
            "original_roll_id", "announced_consequence", "changed_method_evidence",
            "source_command_id",
            "continuation_id", "continuation_idempotency_key",
        }
        if event.get("outcome") == "fumble":
            expected_keys.add("fumble_consequence")
        expected_static = {
            "roll_id": command["payload"]["roll_id"],
            "decision_id": command["payload"]["decision_id"],
            "kind": roll_spec.get("kind"),
            "skill": roll_spec.get("skill"),
            "target": roll_spec.get("target"),
            "difficulty": str(roll_spec.get("difficulty") or "regular"),
            "reason": roll_spec.get("reason"),
            "request_id": capsule["settlement"]["request_id"],
            "bonus_penalty_dice": int(roll_spec.get("bonus_penalty_dice", 0) or 0),
            "roll_contract": expected_roll_contract,
            "resolution_context": {
                **_json_copy(capsule["settlement"]["plan_slice"]),
                **(
                    {"route_resolution": _json_copy(capsule["settlement"]["route_resolution"])}
                    if isinstance(capsule["settlement"].get("route_resolution"), dict)
                    else {}
                ),
            },
            "pushed": True,
            "push_gate": {
                "method_changed": True,
                "consequence_announced": True,
                "player_confirmed": True,
            },
            "original_command_id": entry["origin_command_id"],
            "original_roll_id": original.get("roll_id"),
            "announced_consequence": _json_copy(entry["announced_consequence"]),
            "changed_method_evidence": _json_copy(
                entry["response_changed_method_evidence"]
            ),
            "source_command_id": command_id,
            "continuation_id": entry["continuation_capsule"]["continuation_id"],
            "continuation_idempotency_key": entry["continuation_capsule"]["idempotency"]["key"],
        }
        if event.get("outcome") == "fumble":
            expected_static["fumble_consequence"] = _json_copy(
                entry["announced_consequence"]
            )
        if set(event) != expected_keys or any(
            not _json_deep_equal(event.get(key), value)
            for key, value in expected_static.items()
        ):
            raise _state_error(f"choice history {choice_id!r} has forged push-roll evidence")
        expected_effective_target = coc_roll._effective_target(
            int(roll_spec.get("target")), str(roll_spec.get("difficulty") or "regular")
        )
        expected_outcome = (
            coc_roll.coc_rules.success_level(event.get("roll"), expected_effective_target)
            if isinstance(event.get("roll"), int) and not isinstance(event.get("roll"), bool)
            else None
        )
        if (
            isinstance(event.get("roll"), bool)
            or not isinstance(event.get("roll"), int)
            or not 1 <= event["roll"] <= 100
            or isinstance(event.get("effective_target"), bool)
            or not isinstance(event.get("effective_target"), int)
            or event.get("effective_target") != expected_effective_target
            or event.get("outcome") != expected_outcome
            or event.get("success") != (event.get("outcome") in SUCCESS_OUTCOMES)
        ):
            raise _state_error(f"choice history {choice_id!r} has invalid pushed-roll outcome")
        return

    if kind in CHASE_COMMAND_KINDS:
        if (
            snapshot.get("status") != "completed"
            or snapshot.get("pending_choice") is not None
            or history_ref not in (snapshot.get("state_refs") or [])
        ):
            raise _state_error(f"choice history {choice_id!r} has invalid chase result")
        if kind == "chase_end":
            events = snapshot.get("events")
            event = events[0] if isinstance(events, list) and len(events) == 1 else None
            payload = command["payload"]
            if (not isinstance(event, dict)
                    or set(event) != {"event_type", "chase_id", "revision", "outcome",
                                          "scenario_terminal", "source_command_id", "cancelled_choice_id"}
                    or event.get("event_type") != "chase_ended"
                    or event.get("chase_id") != payload.get("chase_id")
                    or event.get("outcome") != payload.get("outcome")
                    or event.get("source_command_id") != command_id
                    or event.get("cancelled_choice_id") != choice_id
                    or event.get("scenario_terminal") is not False
                    or not isinstance(event.get("revision"), int)
                    or event["revision"] != payload.get("revision") + 1):
                raise _state_error(f"choice history {choice_id!r} has forged chase-end evidence")
        return
    if kind not in BOUT_COMMAND_KINDS:
        raise _state_error(f"choice history {choice_id!r} has unsupported terminal kind")
    expected_refs = [
        f"save/sanity-state/{entry['investigator_id']}.json#{entry['bout_id']}",
        f"save/investigator-state/{entry['investigator_id']}.json#bout_active",
        history_ref,
    ]
    legacy_expected_refs = [
        f"save/sanity.json#{entry['bout_id']}",
        f"save/investigator-state/{entry['investigator_id']}.json#bout_active",
        history_ref,
    ]
    events = snapshot.get("events")
    expected_types = ["bout_ended"] if kind == "bout_end" else ["bout_tick", "bout_ended"]
    if (
        snapshot.get("status") != "completed"
        or snapshot.get("state_refs") not in (expected_refs, legacy_expected_refs)
        or not isinstance(events, list)
        or [event.get("event_type") for event in events] != expected_types
    ):
        raise _state_error(f"choice history {choice_id!r} has an invalid terminal bout result")
    if kind == "bout_tick" and events[0] != {
        "event_type": "bout_tick",
        "bout_id": entry["bout_id"],
        "remaining_rounds": 0,
        "source_command_id": command_id,
    }:
        raise _state_error(f"choice history {choice_id!r} has forged bout-tick evidence")
    ended = events[-1]
    origin_events = all_snapshots[entry["origin_command_id"]].get("events") or []
    origin_bout = next(
        (
            event for event in origin_events
            if isinstance(event, dict)
            and event.get("event_type") == "bout_of_madness"
            and event.get("bout_id") == entry["bout_id"]
        ),
        None,
    )
    if not isinstance(origin_bout, dict):
        raise _state_error(f"choice history {choice_id!r} lacks canonical bout origin evidence")
    expected_suggestion = origin_bout.get("backstory_amend_suggestion")
    ended_keys = {"event_id", "bout_id", "summary", "event_type"}
    if "backstory_amend_suggestion" in ended:
        ended_keys.add("backstory_amend_suggestion")
        suggestion = ended.get("backstory_amend_suggestion")
        if (
            not isinstance(suggestion, dict)
            or set(suggestion) != {"mode", "backstory_field", "keeper_note"}
            or suggestion.get("mode") not in {"corrupt_existing", "add_irrational"}
            or not isinstance(suggestion.get("backstory_field"), str)
            or not suggestion.get("backstory_field")
            or not isinstance(suggestion.get("keeper_note"), str)
            or not suggestion.get("keeper_note")
        ):
            raise _state_error(f"choice history {choice_id!r} has forged bout backstory evidence")
    if not _json_deep_equal(ended.get("backstory_amend_suggestion"), expected_suggestion):
        raise _state_error(f"choice history {choice_id!r} diverges from canonical bout backstory evidence")
    if (
        set(ended) != ended_keys
        or ended.get("bout_id") != entry["bout_id"]
        or not isinstance(ended.get("event_id"), str)
        or not re.fullmatch(r"se[1-9][0-9]*", ended["event_id"])
        or ended.get("summary") != (
            f"{entry['investigator_id']} bout of madness ends; control returns "
            "to the player (underlying insanity continues)."
        )
    ):
        raise _state_error(f"choice history {choice_id!r} has forged bout-end evidence")


def _validate_state(state: Any) -> dict[str, Any]:
    if not isinstance(state, dict):
        raise _state_error("state root must be an object")
    schema_version = state.get("schema_version")
    if schema_version == 1:
        raise _state_error(
            "schema v1 cannot be migrated without command provenance; "
            "discard the unreleased Task 5 state explicitly"
        )
    if schema_version != STATE_SCHEMA_VERSION:
        raise _state_error(f"unsupported schema_version: {schema_version!r}")
    expected_keys = set(_default_state())
    if set(state) != expected_keys:
        raise _state_error("state root must contain exactly the schema v3 fields")

    applied = state.get("applied_command_ids")
    if (
        not isinstance(applied, list)
        or not all(isinstance(item, str) and _SAFE_ID.fullmatch(item) for item in applied)
        or len(applied) != len(set(applied))
    ):
        raise _state_error("applied_command_ids must be unique stable IDs")

    hashes = state.get("command_hashes")
    provenance = state.get("command_provenance")
    snapshots = state.get("result_snapshots")
    pending = state.get("pending_choices")
    pending_contexts = state.get("pending_contexts")
    history = state.get("choice_history")
    if (
        not isinstance(hashes, dict)
        or not isinstance(provenance, dict)
        or not isinstance(snapshots, dict)
        or not isinstance(pending, dict)
        or not isinstance(pending_contexts, dict)
        or not isinstance(history, dict)
    ):
        raise _state_error(
            "hash, provenance, snapshot, pending-choice, private-context, and history indexes must be objects"
        )
    applied_ids = set(applied)
    if set(hashes) != applied_ids or set(provenance) != applied_ids or set(snapshots) != applied_ids:
        raise _state_error(
            "applied IDs, command hashes, provenance, and result snapshots must match"
        )
    if not all(isinstance(value, str) and _SHA256.fullmatch(value) for value in hashes.values()):
        raise _state_error("command_hashes must contain SHA-256 hex digests")
    for command_id, result in snapshots.items():
        _validate_result_snapshot(command_id, result)
        command_provenance = provenance[command_id]
        if not isinstance(command_provenance, dict) or set(command_provenance) != {
            "investigator_id", "character_id", "decision_id",
        }:
            raise _state_error(f"command provenance {command_id!r} has an invalid contract")
        stored_investigator = command_provenance.get("investigator_id")
        if not isinstance(stored_investigator, str) or not _SAFE_ID.fullmatch(stored_investigator):
            raise _state_error(f"command provenance {command_id!r} has an invalid investigator_id")
        stored_decision = command_provenance.get("decision_id")
        if stored_decision is not None and (
            not isinstance(stored_decision, str) or not _SAFE_ID.fullmatch(stored_decision)
        ):
            raise _state_error(f"command provenance {command_id!r} has an invalid decision_id")
        stored_character = command_provenance.get("character_id")
        if result["kind"] in CHARACTER_REQUIRED_COMMAND_KINDS:
            if (
                not isinstance(stored_character, str)
                or not _SAFE_ID.fullmatch(stored_character)
                or stored_character != stored_investigator
            ):
                raise _state_error(
                    f"character-bound command provenance {command_id!r} has an invalid character identity"
                )
        elif stored_character is not None:
            raise _state_error(
                f"non-character command provenance {command_id!r} must have null character_id"
            )
    if set(pending_contexts) != set(pending):
        raise _state_error("active public choices and private contexts must have identical keys")
    if set(history) & set(pending):
        raise _state_error("active choices cannot also appear in immutable history")
    for choice_id, entry in history.items():
        if not isinstance(choice_id, str) or not _SAFE_ID.fullmatch(choice_id):
            raise _state_error("choice history keys must be stable IDs")
        if not isinstance(entry, dict):
            raise _state_error(f"choice history {choice_id!r} has an invalid contract")
        public_choice = entry.get("public_choice")
        if not isinstance(public_choice, dict):
            raise _state_error(f"choice history {choice_id!r} lacks its public creator choice")
        creator_id = public_choice.get("command_id")
        if not isinstance(creator_id, str) or creator_id not in applied_ids:
            raise _state_error(f"choice history {choice_id!r} has an invalid creator command")
        creator_snapshot = snapshots[creator_id]
        if not _json_deep_equal(
            creator_snapshot.get("pending_choice"), public_choice
        ):
            raise _state_error(
                f"choice history {choice_id!r} does not match its creator snapshot"
            )
        _validate_pending_choice_contract(
            creator_id,
            creator_snapshot["kind"],
            creator_snapshot["status"],
            public_choice,
        )
        action = entry.get("terminal_action")
        revision = entry.get("terminal_revision")
        command_ids = entry.get("terminal_command_ids")
        terminal_commands = entry.get("terminal_commands")
        terminal_results = entry.get("terminal_results")
        terminal_receipt_hashes = entry.get("terminal_result_receipt_hashes")
        if public_choice.get("kind") == "push_confirm":
            expected_keys = set(PUSH_CONTEXT_KEYS) | set(PUSH_HISTORY_EXTRA_KEYS)
            allowed_actions = {"confirm", "cancel"}
            expected_count = 2 if action == "confirm" else 1
            base_keys = PUSH_CONTEXT_KEYS
        elif public_choice.get("kind") == "bout_keeper_action":
            expected_keys = set(BOUT_CONTEXT_KEYS) | set(BOUT_HISTORY_EXTRA_KEYS)
            allowed_actions = {"tick", "end"}
            expected_count = 1
            base_keys = BOUT_CONTEXT_KEYS
        elif public_choice.get("kind") == "chase_action":
            expected_keys = set(CHASE_CONTEXT_KEYS) | set(CHASE_HISTORY_EXTRA_KEYS)
            allowed_actions = {
                option["action"] for option in public_choice.get("options") or []
                if isinstance(option, dict) and isinstance(option.get("action"), str)
            }
            allowed_actions.add("cancelled_by_chase_end")
            expected_count = 1
            base_keys = CHASE_CONTEXT_KEYS
        else:
            raise _state_error(f"choice history {choice_id!r} has unsupported kind")
        if set(entry) != expected_keys:
            raise _state_error(f"choice history {choice_id!r} has an invalid field set")
        base_context = {key: _json_copy(entry[key]) for key in base_keys}
        _validate_private_choice_context(
            choice_id,
            base_context,
            choice=public_choice,
            applied_ids=applied_ids,
            snapshots=snapshots,
            provenance=provenance,
            hashes=hashes,
        )
        if action not in allowed_actions or revision != public_choice.get("revision"):
            raise _state_error(f"choice history {choice_id!r} has invalid terminal metadata")
        if (
            not isinstance(command_ids, list)
            or len(command_ids) != expected_count
            or not all(command_id in applied_ids for command_id in command_ids)
        ):
            raise _state_error(f"choice history {choice_id!r} has invalid terminal commands")
        ids = _resume_ids(choice_id, int(revision), str(action))
        chase_end_cancel = (
            public_choice.get("kind") == "chase_action"
            and action == "cancelled_by_chase_end"
        )
        expected_command_ids = (
            [terminal_commands[0].get("command_id")]
            if chase_end_cancel and isinstance(terminal_commands, list)
            and len(terminal_commands) == 1 and isinstance(terminal_commands[0], dict)
            else [ids["confirm_command_id"]]
        )
        expected_kinds = [
            "push_confirm" if public_choice.get("kind") == "push_confirm"
            else "bout_tick" if public_choice.get("kind") == "bout_keeper_action" and action == "tick"
            else "bout_end" if public_choice.get("kind") == "bout_keeper_action"
            else "chase_barrier" if str(action).startswith("barrier:")
            else "chase_end" if chase_end_cancel
            else "chase_move"
        ]
        if public_choice.get("kind") == "push_confirm" and action == "confirm":
            expected_command_ids.append(ids["resolve_command_id"])
            expected_kinds.append("push_resolve")
        if command_ids != expected_command_ids:
            raise _state_error(f"choice history {choice_id!r} has non-canonical terminal command IDs")
        if (
            not isinstance(terminal_commands, list)
            or len(terminal_commands) != expected_count
            or [
                command.get("command_id") if isinstance(command, dict) else None
                for command in terminal_commands
            ] != expected_command_ids
        ):
            raise _state_error(f"choice history {choice_id!r} lacks exact terminal command receipts")
        if not isinstance(terminal_results, list) or len(terminal_results) != expected_count:
            raise _state_error(f"choice history {choice_id!r} lacks exact terminal result receipts")
        if (
            not isinstance(terminal_receipt_hashes, list)
            or len(terminal_receipt_hashes) != expected_count
            or not all(isinstance(value, str) and _SHA256.fullmatch(value)
                       for value in terminal_receipt_hashes)
        ):
            raise _state_error(
                f"choice history {choice_id!r} lacks canonical terminal receipt hashes"
            )
        response = {
            "choice_id": choice_id,
            "responder": public_choice["responder"],
            "revision": revision,
            "action": action,
        }
        try:
            validated_commands = _validate_batch(terminal_commands)
            if chase_end_cancel:
                expected_commands = validated_commands
                end_payload = validated_commands[0]["payload"]
                if (validated_commands[0]["kind"] != "chase_end"
                        or end_payload.get("revision") != entry.get("revision")):
                    raise _error("invalid_pending_resolution_batch", "commands", "chase end cancellation is not canonical")
            else:
                expected_plan = _pending_resume_plan_from_state(
                    state, None, entry["investigator_id"], response
                )
                expected_commands = commands_from_rules_requests(expected_plan)
        except SubsystemExecutorError as exc:
            raise _state_error(
                f"choice history {choice_id!r} has invalid terminal command receipts: {exc}"
            ) from exc
        if not _json_deep_equal(validated_commands, expected_commands):
            raise _state_error(f"choice history {choice_id!r} terminal receipts are non-canonical")
        for terminal_id, expected_kind, terminal_command, terminal_result in zip(
            command_ids, expected_kinds, terminal_commands, terminal_results
        ):
            if (
                snapshots[terminal_id].get("kind") != expected_kind
                or provenance[terminal_id].get("investigator_id")
                != entry.get("investigator_id")
                or provenance[terminal_id].get("character_id")
                != entry.get("character_id")
                or provenance[terminal_id].get("decision_id") != (
                    terminal_command["payload"].get("decision_id")
                    if chase_end_cancel else ids["decision_id"]
                )
                or hashes[terminal_id] != _canonical_command_hash(terminal_command)
            ):
                raise _state_error(f"choice history {choice_id!r} has invalid terminal provenance")
            if not _json_deep_equal(terminal_result, snapshots[terminal_id]):
                raise _state_error(f"choice history {choice_id!r} terminal result receipt diverges")
            _validate_history_terminal_snapshot(
                choice_id, entry, terminal_command, snapshots[terminal_id], snapshots
            )
        if public_choice.get("kind") == "push_confirm":
            changed = entry.get("response_changed_method_evidence")
            if action == "confirm" and not isinstance(changed, dict):
                raise _state_error(f"choice history {choice_id!r} lacks changed-method evidence")
            if action == "cancel" and changed is not None:
                raise _state_error(f"cancelled choice history {choice_id!r} cannot carry changed-method evidence")
        try:
            _validate_json_value(entry, f"choice_history.{choice_id}")
        except SubsystemExecutorError as exc:
            raise _state_error(str(exc)) from exc
    pending_scopes: dict[str, str] = {}
    for choice_id, choice in pending.items():
        if not isinstance(choice_id, str) or not _SAFE_ID.fullmatch(choice_id):
            raise _state_error("pending choice keys must be stable IDs")
        if not isinstance(choice, dict) or choice.get("choice_id") != choice_id:
            raise _state_error(f"pending choice {choice_id!r} has an invalid contract")
        if not isinstance(choice.get("kind"), str) or not isinstance(choice.get("command_id"), str):
            raise _state_error(f"pending choice {choice_id!r} is missing stable identifiers")
        command_id = choice["command_id"]
        if command_id not in applied_ids:
            raise _state_error(
                f"pending choice {choice_id!r} references an unapplied command"
            )
        snapshot = snapshots[command_id]
        if not _json_deep_equal(snapshot.get("pending_choice"), choice):
            raise _state_error(
                f"pending choice {choice_id!r} does not match its result snapshot"
            )
        _validate_pending_choice_contract(
            command_id,
            snapshot["kind"],
            snapshot["status"],
            choice,
        )
        _validate_private_choice_context(
            choice_id,
            pending_contexts[choice_id],
            choice=choice,
            applied_ids=applied_ids,
            snapshots=snapshots,
            provenance=provenance,
            hashes=hashes,
        )
        scope = _pending_scope_key(snapshot["kind"], pending_choice=choice)
        if scope in pending_scopes:
            raise _state_error(
                f"pending choices {pending_scopes[scope]!r} and {choice_id!r} "
                f"share blocking scope {scope!r}"
            )
        pending_scopes[scope] = choice_id
        try:
            _validate_json_value(choice, f"pending_choices.{choice_id}")
        except SubsystemExecutorError as exc:
            raise _state_error(str(exc)) from exc
    _validate_inflight(state.get("inflight"))
    return state


_RESULT_RECEIPT_LOG = Path("logs/subsystem-results.jsonl")
_PUSH_OFFER_EVIDENCE_LOG = Path("logs/push-offers.jsonl")
_CHASE_OFFER_EVIDENCE_LOG = Path("logs/chase-offers.jsonl")
_CHASE_CONFLICT_LEDGER = Path("logs/chase-conflicts.jsonl")
_CHASE_GENESIS_LEDGER = Path("logs/chase-genesis.jsonl")


def _result_choice_id(
    command: dict[str, Any], result: dict[str, Any], state: dict[str, Any]
) -> str | None:
    pending = result.get("pending_choice")
    if isinstance(pending, dict):
        return pending.get("choice_id")
    payload = command.get("payload")
    if isinstance(payload, dict) and isinstance(payload.get("choice_id"), str):
        return payload["choice_id"]
    command_id = command.get("command_id")
    for choice_id, history in state.get("choice_history", {}).items():
        if isinstance(history, dict) and command_id in (history.get("terminal_command_ids") or []):
            return choice_id
    return None


def _result_receipt_record(
    sequence: int,
    command: dict[str, Any],
    result: dict[str, Any],
    state: dict[str, Any],
) -> dict[str, Any]:
    command_id = command["command_id"]
    material = {
        "record_type": "subsystem_result_receipt",
        "sequence": sequence,
        "command_id": command_id,
        "command_hash": state["command_hashes"][command_id],
        "command_provenance": _json_copy(state["command_provenance"][command_id]),
        "choice_id": _result_choice_id(command, result, state),
        "result": _json_copy(result),
    }
    material["receipt_hash"] = _canonical_json_hash(material)
    return material


def _push_offer_evidence_record(
    sequence: int,
    command: dict[str, Any],
    result: dict[str, Any],
    state: dict[str, Any],
) -> dict[str, Any]:
    command_id = command["command_id"]
    public_choice = result["pending_choice"]
    material = {
        "record_type": "push_offer_evidence",
        "sequence": sequence,
        "actor": state["command_provenance"][command_id]["investigator_id"],
        "command_id": command_id,
        "command_hash": state["command_hashes"][command_id],
        "command_provenance": _json_copy(state["command_provenance"][command_id]),
        "choice_id": public_choice["choice_id"],
        "command": _json_copy(command),
        "public_choice": _json_copy(public_choice),
        "announced_consequence": _json_copy(
            command["payload"]["announced_consequence"]
        ),
    }
    material["evidence_hash"] = _canonical_json_hash(material)
    return material


def _chase_offer_evidence_record(
    sequence: int, command: dict[str, Any], result: dict[str, Any], state: dict[str, Any],
) -> dict[str, Any]:
    command_id = command["command_id"]
    choice = result["pending_choice"]
    context = state["pending_contexts"][choice["choice_id"]]
    material = {
        "record_type": "chase_offer_evidence", "sequence": sequence,
        "command_id": command_id, "command_hash": state["command_hashes"][command_id],
        "command_provenance": _json_copy(state["command_provenance"][command_id]),
        "choice_id": choice["choice_id"], "chase_id": context["chase_id"],
        "revision": context["revision"], "actor_id": context["actor_id"],
        "location": _json_copy(context["action_context"]),
        "options": _json_copy(choice["options"]), "command": _json_copy(command),
        "public_choice": _json_copy(choice),
    }
    material["evidence_hash"] = _canonical_json_hash(material)
    return material


def _chase_conflict_record(
    campaign_dir: Path, sequence: int, command: dict[str, Any],
    result: dict[str, Any], state: dict[str, Any],
) -> dict[str, Any]:
    event = result["events"][0]
    receipt = event["combat_receipt"]
    combat_result_receipt = _canonical_result_receipt(
        campaign_dir, receipt["combat_command_id"]
    )
    material = {
        "record_type": "chase_conflict_consumption", "sequence": sequence,
        "chase_command_id": command["command_id"],
        "chase_command_hash": state["command_hashes"][command["command_id"]],
        "chase_command_provenance": _json_copy(
            state["command_provenance"][command["command_id"]]
        ),
        "chase_command": _json_copy(command),
        "chase_event": _json_copy(event),
        "chase_id": event["chase_id"], "post_chase_revision": event["revision"],
        "actor_id": command["payload"]["actor_id"],
        "target_actor_id": command["payload"]["target_actor_id"],
        "combat_command_id": receipt["combat_command_id"],
        "combat_receipt_hash": receipt["receipt_hash"],
        "combat_receipt": _json_copy(receipt),
        "combat_result_receipt": _json_copy(combat_result_receipt),
    }
    material["consumption_hash"] = _canonical_json_hash(material)
    return material


def _read_jsonl_records(path: Path, *, label: str) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    records: list[dict[str, Any]] = []
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                value = json.loads(line)
                if not isinstance(value, dict):
                    raise ValueError("record is not an object")
                records.append(value)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        raise _state_error(f"{label} is invalid: {exc}") from exc
    return records


def _read_investigator_sanity_snapshot(
    campaign_dir: Path,
    investigator_id: str,
) -> dict[str, Any] | None:
    """Read the identity-bound SAN source without mutating legacy state."""
    canonical = coc_sanity.sanity_snapshot_path(campaign_dir, investigator_id)
    legacy = coc_sanity.legacy_sanity_snapshot_path(campaign_dir)
    path = canonical if canonical.is_file() else legacy
    if not path.is_file():
        return None
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise _state_error(
            f"canonical sanity snapshot for {investigator_id!r} is invalid: {exc}"
        ) from exc
    if not isinstance(value, dict):
        raise _state_error(
            f"canonical sanity snapshot for {investigator_id!r} is not an object"
        )
    if value.get("investigator_id") != investigator_id:
        # A legacy singleton may legitimately belong to another linked party
        # member.  It is not evidence for this investigator.
        if path == legacy:
            return None
        raise _state_error(
            f"canonical sanity snapshot for {investigator_id!r} has mismatched identity"
        )
    return value


def load_combat_damage_evidence(
    campaign_dir: Path | str,
) -> list[dict[str, Any]]:
    """Return canonical roll rows carrying externally anchored combat damage."""
    rows = _read_jsonl_records(
        Path(campaign_dir) / "logs" / "rolls.jsonl",
        label="canonical combat damage roll log",
    )
    return [
        _json_copy(row) for row in rows
        if isinstance(row.get("payload"), dict)
        and isinstance(row["payload"].get("combat_damage_receipt"), dict)
    ]


def _load_combat_session(
    campaign_dir: Path | str, *, rng: random.Random,
    investigator_id: str | None = None,
) -> Any:
    return coc_combat.CombatSession.load(
        Path(campaign_dir), rng=rng,
        damage_evidence=load_combat_damage_evidence(campaign_dir),
        damage_evidence_actor=investigator_id,
    )


def _validate_result_source_evidence(
    campaign_dir: Path,
    state: dict[str, Any],
    commands_by_id: dict[str, dict[str, Any]],
) -> None:
    roll_records = _read_jsonl_records(
        campaign_dir / "logs" / "rolls.jsonl", label="canonical roll log"
    )
    rolls_by_command: dict[str, list[dict[str, Any]]] = {}
    for row in roll_records:
        command_id = row.get("command_id")
        if isinstance(command_id, str):
            rolls_by_command.setdefault(command_id, []).append(row)

    # The executor state and subsystem-result ledger are mutually redundant
    # copies and can therefore be rewritten together.  Bind every executor
    # percentile result to the separately persisted append-only roll evidence,
    # including ordinary rolls later used as pushed-roll origins.  Validate the
    # complete payload so roll identity, request/source context, target,
    # modifier, percentile and derived outcome cannot be substituted piecemeal.
    seen_roll_ids: dict[str, str] = {}
    legacy_row_keys = frozenset({"type", "actor", "command_id", "payload", "ts"})
    canonical_row_keys = legacy_row_keys | frozenset({
        "event_type", "roll_id", "visibility", "source", "source_ref",
    })

    def row_matches_event(
        row: Any, event: dict[str, Any], *, actor: Any, command_id: str,
    ) -> bool:
        """Validate legacy evidence or the canonical v2 roll projection.

        The executor snapshot remains the semantic source of truth.  The v2
        log wraps that exact event with report-facing identity, visibility and
        provenance fields; those fields must agree with both the row and the
        nested payload.
        """
        if not isinstance(row, dict):
            return False
        row_keys = frozenset(row)
        if row_keys not in {legacy_row_keys, canonical_row_keys}:
            return False
        semantic_actor = event.get("actor_id") or actor
        # Compatibility for canonical rows emitted before actor-aware roll
        # projection: those rows always used the investigator provenance even
        # when the nested event identified a monster or NPC actor.  New writes
        # use semantic_actor; old trusted rows remain readable for resume.
        allowed_actors = {semantic_actor, actor}
        if (
            row.get("type") != "roll"
            or row.get("actor") not in allowed_actors
            or row.get("command_id") != command_id
            or not isinstance(row.get("ts"), str)
            or not row["ts"]
        ):
            return False
        if row_keys == legacy_row_keys:
            return _json_deep_equal(row.get("payload"), event)

        expected_payload = _json_copy(event)
        visibility = str(
            expected_payload.get("visibility")
            or (
                "consequence_public"
                if expected_payload.get("skill") == "HP Damage"
                else "public"
            )
        )
        expected_payload["visibility"] = visibility
        roll_id = str(event["roll_id"])
        return bool(
            row.get("event_type") == "roll"
            and row.get("roll_id") == roll_id
            and row.get("visibility") == visibility
            and row.get("source") == "subsystem_executor"
            and row.get("source_ref") == f"logs/rolls.jsonl#{roll_id}"
            and _json_deep_equal(row.get("payload"), expected_payload)
        )

    for command_id in state["applied_command_ids"]:
        result = state["result_snapshots"][command_id]
        command = commands_by_id.get(command_id)
        if not _result_requires_roll_evidence(result, command):
            continue
        expected_events = [
            event for event in result.get("events") or []
            if isinstance(event, dict) and isinstance(event.get("roll_id"), str)
        ]
        rows = rolls_by_command.get(command_id, [])
        if not expected_events or len(rows) != len(expected_events):
            raise _state_error(
                f"canonical roll evidence for {command_id!r} is missing or duplicated"
            )
        provenance = state["command_provenance"][command_id]
        for event, row in zip(expected_events, rows):
            roll_id = event["roll_id"]
            previous = seen_roll_ids.get(roll_id)
            if previous is not None:
                raise _state_error(
                    f"canonical roll_id {roll_id!r} is shared by "
                    f"{previous!r} and {command_id!r}"
                )
            seen_roll_ids[roll_id] = command_id
            if not row_matches_event(
                row, event,
                actor=provenance.get("investigator_id"),
                command_id=command_id,
            ):
                raise _state_error(
                    f"canonical roll evidence for {command_id!r} diverges"
                )
    for choice_id, history in state["choice_history"].items():
        for command_id in history["terminal_command_ids"]:
            result = state["result_snapshots"][command_id]
            if result["kind"] == "push_resolve":
                rows = rolls_by_command.get(command_id, [])
                row = rows[0] if len(rows) == 1 else None
                provenance = state["command_provenance"][command_id]
                if not row_matches_event(
                    row,
                    result["events"][0],
                    actor=provenance.get("investigator_id"),
                    command_id=command_id,
                ):
                    raise _state_error(
                        f"choice history {choice_id!r} diverges from canonical roll receipt"
                    )
            if result["kind"] in BOUT_COMMAND_KINDS and result["status"] == "completed":
                sanity = _read_investigator_sanity_snapshot(
                    campaign_dir, str(history["investigator_id"])
                )
                if not isinstance(sanity, dict):
                    raise _state_error(
                        f"choice history {choice_id!r} lacks canonical sanity source"
                    )
                raw_events = sanity.get("events") or []
                ended = result["events"][-1]
                source = next(
                    (row for row in raw_events if isinstance(row, dict)
                     and row.get("event_id") == ended.get("event_id")),
                    None,
                )
                expected = None
                if isinstance(source, dict):
                    payload = source.get("payload") if isinstance(source.get("payload"), dict) else {}
                    expected = {"event_id": source.get("event_id"), **payload,
                                "event_type": source.get("type")}
                if not _json_deep_equal(expected, ended):
                    raise _state_error(
                        f"choice history {choice_id!r} diverges from canonical sanity event"
                    )
                origin = state["result_snapshots"][history["origin_command_id"]]
                origin_bout = next(
                    (event for event in origin.get("events") or [] if isinstance(event, dict)
                     and event.get("event_type") == "bout_of_madness"
                     and event.get("bout_id") == history["bout_id"]),
                    None,
                )
                persisted_bout = next(
                    (row for row in sanity.get("bouts_of_madness") or [] if isinstance(row, dict)
                     and row.get("bout_id") == history["bout_id"]),
                    None,
                )
                if not isinstance(origin_bout, dict) or not isinstance(persisted_bout, dict) or not _json_deep_equal(
                    origin_bout.get("backstory_amend_suggestion"),
                    persisted_bout.get("backstory_amend_suggestion"),
                ):
                    raise _state_error(
                        f"choice history {choice_id!r} diverges from canonical bout source"
                    )


def _validate_push_offer_evidence(
    campaign_dir: Path,
    state: dict[str, Any],
) -> None:
    records = _read_jsonl_records(
        campaign_dir / _PUSH_OFFER_EVIDENCE_LOG,
        label="canonical push offer evidence",
    )
    offer_ids = [
        command_id for command_id in state["applied_command_ids"]
        if state["result_snapshots"][command_id]["kind"] == "push_offer"
    ]
    if len(records) != len(offer_ids):
        raise _state_error("canonical push offer evidence length diverges")
    evidence_keys = {
        "record_type", "sequence", "actor", "command_id", "command_hash",
        "command_provenance", "choice_id", "command", "public_choice",
        "announced_consequence", "evidence_hash",
    }
    for sequence, (command_id, record) in enumerate(zip(offer_ids, records), 1):
        result = state["result_snapshots"][command_id]
        public_choice = result["pending_choice"]
        choice_id = public_choice["choice_id"]
        context = (
            state["pending_contexts"].get(choice_id)
            or state["choice_history"].get(choice_id)
        )
        command = context.get("offer_command") if isinstance(context, dict) else None
        provenance = state["command_provenance"][command_id]
        material = {
            key: _json_copy(value)
            for key, value in record.items()
            if key != "evidence_hash"
        }
        if (
            set(record) != evidence_keys
            or record.get("record_type") != "push_offer_evidence"
            or record.get("sequence") != sequence
            or record.get("command_id") != command_id
            or record.get("actor") != provenance["investigator_id"]
            or record.get("command_hash") != state["command_hashes"][command_id]
            or not _json_deep_equal(record.get("command_provenance"), provenance)
            or record.get("choice_id") != choice_id
            or not _json_deep_equal(record.get("command"), command)
            or not _json_deep_equal(record.get("public_choice"), public_choice)
            or not isinstance(command, dict)
            or not _json_deep_equal(
                record.get("announced_consequence"),
                command.get("payload", {}).get("announced_consequence"),
            )
            or record.get("evidence_hash") != _canonical_json_hash(material)
        ):
            raise _state_error(
                f"canonical push offer evidence for {command_id!r} diverges"
            )


def _validate_chase_offer_evidence(campaign_dir: Path, state: dict[str, Any]) -> None:
    records = _read_jsonl_records(
        campaign_dir / _CHASE_OFFER_EVIDENCE_LOG, label="canonical chase offer evidence"
    )
    offer_ids = [
        cid for cid in state["applied_command_ids"]
        if state["result_snapshots"][cid]["kind"] == "chase_move"
        and state["result_snapshots"][cid].get("status") == "pending_choice"
    ]
    if len(records) != len(offer_ids):
        raise _state_error("canonical chase offer evidence length diverges")
    keys = {"record_type", "sequence", "command_id", "command_hash", "command_provenance",
            "choice_id", "chase_id", "revision", "actor_id", "location", "options",
            "command", "public_choice", "evidence_hash"}
    for sequence, (command_id, record) in enumerate(zip(offer_ids, records), 1):
        choice = state["result_snapshots"][command_id]["pending_choice"]
        choice_id = choice["choice_id"]
        context = state["pending_contexts"].get(choice_id) or state["choice_history"].get(choice_id)
        material = {key: _json_copy(value) for key, value in record.items() if key != "evidence_hash"}
        expected_context = {
            "chase_id": record.get("chase_id"), "revision": record.get("revision"),
            "actor_id": record.get("actor_id"), "action_context": _json_copy(record.get("location")),
        }
        if (set(record) != keys or record.get("record_type") != "chase_offer_evidence"
                or record.get("sequence") != sequence or record.get("command_id") != command_id
                or record.get("command_hash") != state["command_hashes"][command_id]
                or not _json_deep_equal(record.get("command_provenance"), state["command_provenance"][command_id])
                or record.get("choice_id") != choice_id
                or not _json_deep_equal(record.get("public_choice"), choice)
                or not _json_deep_equal(record.get("options"), choice.get("options"))
                or not isinstance(context, dict)
                or not _json_deep_equal(record.get("command"), context.get("offer_command"))
                or any(not _json_deep_equal(context.get(key), value) for key, value in expected_context.items())
                or record.get("evidence_hash") != _canonical_json_hash(material)):
            raise _state_error(f"canonical chase offer evidence for {command_id!r} diverges")


def _validate_chase_conflict_ledger(campaign_dir: Path, state: dict[str, Any]) -> None:
    records = _read_jsonl_records(
        campaign_dir / _CHASE_CONFLICT_LEDGER, label="canonical chase conflict ledger"
    )
    conflict_ids = [cid for cid in state["applied_command_ids"]
                    if state["result_snapshots"][cid]["kind"] == "chase_conflict"]
    if len(records) != len(conflict_ids):
        raise _state_error("canonical chase conflict ledger length diverges")
    seen: set[tuple[str, str]] = set()
    chase_snapshot: dict[str, Any] = {}
    chase_path = campaign_dir / "save" / "chase.json"
    if chase_path.is_file():
        try:
            loaded = json.loads(chase_path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                chase_snapshot = loaded
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise _state_error(f"canonical chase conflict source is invalid: {exc}") from exc
    keys = {"record_type", "sequence", "chase_command_id", "chase_command_hash",
            "chase_command_provenance", "chase_command", "chase_event",
            "chase_id", "post_chase_revision", "actor_id", "target_actor_id",
            "combat_command_id", "combat_receipt_hash", "combat_receipt",
            "combat_result_receipt", "consumption_hash"}
    result_receipts = {
        row.get("command_id"): row for row in _read_jsonl_records(
            campaign_dir / _RESULT_RECEIPT_LOG,
            label="canonical subsystem result ledger",
        )
    }
    for sequence, (command_id, record) in enumerate(zip(conflict_ids, records), 1):
        event = state["result_snapshots"][command_id]["events"][0]
        receipt = event.get("combat_receipt")
        chase_command = record.get("chase_command")
        chase_payload = chase_command.get("payload") if isinstance(chase_command, dict) else None
        combat_result_receipt = record.get("combat_result_receipt")
        canonical_combat_receipt = result_receipts.get(record.get("combat_command_id"))
        combat_result = (
            combat_result_receipt.get("result")
            if isinstance(combat_result_receipt, dict) else None
        )
        combat_event = (
            combat_result.get("events", [None])[0]
            if isinstance(combat_result, dict) and combat_result.get("events") else None
        )
        combat_turn = combat_event.get("turn") if isinstance(combat_event, dict) else None
        material = {key: _json_copy(value) for key, value in record.items() if key != "consumption_hash"}
        key = (record.get("combat_command_id"), record.get("combat_receipt_hash"))
        if (set(record) != keys or record.get("record_type") != "chase_conflict_consumption"
                or record.get("sequence") != sequence or record.get("chase_command_id") != command_id
                or record.get("chase_command_hash") != state["command_hashes"][command_id]
                or not isinstance(chase_command, dict)
                or chase_command.get("command_id") != command_id
                or chase_command.get("kind") != "chase_conflict"
                or _canonical_command_hash(chase_command) != record.get("chase_command_hash")
                or not _json_deep_equal(
                    record.get("chase_command_provenance"),
                    state["command_provenance"][command_id],
                )
                or not isinstance(chase_payload, dict)
                or chase_payload.get("actor_id") != record.get("actor_id")
                or chase_payload.get("target_actor_id") != record.get("target_actor_id")
                or chase_payload.get("combat_command_id") != record.get("combat_command_id")
                or chase_payload.get("action_id") != f"conflict:{record.get('target_actor_id')}"
                or not _json_deep_equal(record.get("chase_event"), event)
                or not _json_deep_equal(record.get("combat_receipt"), receipt)
                or record.get("combat_command_id") != (receipt or {}).get("combat_command_id")
                or record.get("combat_receipt_hash") != (receipt or {}).get("receipt_hash")
                or record.get("chase_id") != event.get("chase_id")
                or record.get("post_chase_revision") != event.get("revision")
                or not _json_deep_equal(combat_result_receipt, canonical_combat_receipt)
                or not isinstance(combat_result_receipt, dict)
                or combat_result_receipt.get("command_id") != record.get("combat_command_id")
                or combat_result_receipt.get("command_hash") != (receipt or {}).get("command_hash")
                or combat_result_receipt.get("receipt_hash") != record.get("combat_receipt_hash")
                or not _json_deep_equal(
                    combat_result, state["result_snapshots"].get(record.get("combat_command_id"))
                )
                or not isinstance(combat_event, dict)
                or combat_event.get("source_command_id") != record.get("combat_command_id")
                or combat_event.get("combat_id") != (receipt or {}).get("combat_id")
                or combat_event.get("revision") != (receipt or {}).get("combat_revision")
                or not isinstance(combat_turn, dict)
                or combat_turn.get("actor_id") != record.get("actor_id")
                or combat_turn.get("target_actor_id") != record.get("target_actor_id")
                or record.get("consumption_hash") != _canonical_json_hash(material)
                or key in seen):
            raise _state_error(f"canonical chase conflict consumption {command_id!r} diverges")
        if chase_snapshot.get("chase_id") == record.get("chase_id"):
            persisted_receipts = chase_snapshot.get("consumed_combat_receipts") or []
            persisted_actions = [
                action
                for chase_round in chase_snapshot.get("rounds") or []
                for turn in chase_round.get("turns") or []
                for action in turn.get("actions_taken") or []
                if isinstance(action, dict)
                and action.get("combat_command_id") == record.get("combat_command_id")
            ]
            if (not any(_json_deep_equal(row, receipt) for row in persisted_receipts)
                    or len(persisted_actions) != 1
                    or persisted_actions[0].get("attacker_id") != record.get("actor_id")
                    or persisted_actions[0].get("defender_id") != record.get("target_actor_id")
                    or not _json_deep_equal(persisted_actions[0].get("combat_receipt"), receipt)
                    or persisted_actions[0].get("combat_id") != (receipt or {}).get("combat_id")
                    or persisted_actions[0].get("combat_revision") != (receipt or {}).get("combat_revision")
                    or not isinstance(chase_snapshot.get("revision"), int)
                    or chase_snapshot["revision"] < record["post_chase_revision"]):
                raise _state_error(
                    f"canonical chase conflict consumption {command_id!r} diverges from chase snapshot"
                )
        seen.add(key)


def _chase_genesis_record(
    sequence: int, command: dict[str, Any], state: dict[str, Any],
) -> dict[str, Any]:
    participants = []
    for source in command["payload"]["participants"]:
        participants.append({
            "actor_id": source["actor_id"],
            "side": source["side"],
            "move_rate": source["mov"],
            "build": source["build"],
            "dex": source["dex"],
            "hp": source["hp"],
            "conditions": _json_copy(source["conditions"]),
            "position_origin": source["current_position"],
        })
    location_chain = [
        coc_chase._normalize_location(location, index)
        for index, location in enumerate(command["payload"]["locations"])
    ]
    material = {
        "record_type": "chase_genesis_v1",
        "sequence": sequence,
        "command_id": command["command_id"],
        "command_hash": state["command_hashes"][command["command_id"]],
        "command_provenance": _json_copy(
            state["command_provenance"][command["command_id"]]
        ),
        "command": _json_copy(command),
        "chase_id": command["payload"]["chase_id"],
        "participants": participants,
        "location_chain": location_chain,
        "location_chain_identity": coc_chase.ChaseSession._location_chain_identity(
            location_chain
        ),
    }
    return {**material, "genesis_hash": _canonical_json_hash(material)}


def _validate_chase_genesis_ledger(
    campaign_dir: Path, state: dict[str, Any], *, load_snapshot: bool = True,
) -> dict[str, Any] | None:
    records = _read_jsonl_records(
        campaign_dir / _CHASE_GENESIS_LEDGER,
        label="canonical chase genesis evidence",
    )
    start_ids = [
        command_id for command_id in state["applied_command_ids"]
        if state["result_snapshots"][command_id]["kind"] == "chase_start"
    ]
    if len(records) != len(start_ids):
        raise _state_error("canonical chase genesis evidence length diverges")
    keys = {
        "record_type", "sequence", "command_id", "command_hash",
        "command_provenance", "command", "chase_id", "participants",
        "location_chain", "location_chain_identity", "genesis_hash",
    }
    for sequence, (command_id, record) in enumerate(zip(start_ids, records), 1):
        material = {
            key: _json_copy(value) for key, value in record.items()
            if key != "genesis_hash"
        } if isinstance(record, dict) else {}
        command = record.get("command") if isinstance(record, dict) else None
        payload = command.get("payload") if isinstance(command, dict) else None
        participants = record.get("participants") if isinstance(record, dict) else None
        source_participants = payload.get("participants") if isinstance(payload, dict) else None
        source_locations = payload.get("locations") if isinstance(payload, dict) else None
        expected_locations = (
            [coc_chase._normalize_location(row, index)
             for index, row in enumerate(source_locations)]
            if isinstance(source_locations, list) else None
        )
        expected_participants = []
        if isinstance(source_participants, list) and isinstance(participants, list):
            expected_participants = [{
                "actor_id": row.get("actor_id"), "side": row.get("side"),
                "move_rate": row.get("mov"), "build": row.get("build"),
                "dex": row.get("dex"), "hp": row.get("hp"),
                "conditions": _json_copy(row.get("conditions")),
                "position_origin": row.get("current_position"),
            } for row in source_participants if isinstance(row, dict)]
        if (
            not isinstance(record, dict) or set(record) != keys
            or record.get("record_type") != "chase_genesis_v1"
            or isinstance(record.get("sequence"), bool)
            or record.get("sequence") != sequence
            or record.get("command_id") != command_id
            or not isinstance(command, dict)
            or command.get("command_id") != command_id
            or command.get("kind") != "chase_start"
            or _canonical_command_hash(command) != record.get("command_hash")
            or record.get("command_hash") != state["command_hashes"][command_id]
            or not _json_deep_equal(
                record.get("command_provenance"),
                state["command_provenance"][command_id],
            )
            or not isinstance(payload, dict)
            or record.get("chase_id") != payload.get("chase_id")
            or not _json_deep_equal(participants, expected_participants)
            or not _json_deep_equal(record.get("location_chain"), expected_locations)
            or record.get("location_chain_identity")
            != coc_chase.ChaseSession._location_chain_identity(
                record.get("location_chain") if isinstance(record.get("location_chain"), list) else []
            )
            or record.get("genesis_hash") != _canonical_json_hash(material)
        ):
            raise _state_error(f"canonical chase genesis evidence for {command_id!r} diverges")
    evidence = records[-1] if records else None
    chase_path = campaign_dir / "save" / "chase.json"
    if load_snapshot and chase_path.is_file():
        if evidence is None:
            raise _state_error("persisted chase snapshot has no canonical genesis evidence")
        try:
            coc_chase.ChaseSession.load(
                chase_path, rng=random.Random(0), genesis_evidence=evidence,
            )
        except (OSError, ValueError) as exc:
            raise _state_error(f"canonical chase genesis validation failed: {exc}") from exc
    return _json_copy(evidence) if evidence is not None else None


def _validate_external_result_receipts(campaign_dir: Path, state: dict[str, Any]) -> None:
    records = _read_jsonl_records(
        campaign_dir / _RESULT_RECEIPT_LOG, label="canonical subsystem result ledger"
    )
    applied = state["applied_command_ids"]
    if len(records) != len(applied):
        raise _state_error("canonical subsystem result ledger length diverges")
    commands_by_id: dict[str, dict[str, Any]] = {}
    for index, (command_id, record) in enumerate(zip(applied, records), 1):
        expected_keys = {
            "record_type", "sequence", "command_id", "command_hash",
            "command_provenance", "choice_id", "result", "receipt_hash",
        }
        if set(record) != expected_keys or record.get("record_type") != "subsystem_result_receipt":
            raise _state_error("canonical subsystem result receipt has an invalid contract")
        receipt_hash = record.get("receipt_hash")
        material = {key: _json_copy(value) for key, value in record.items() if key != "receipt_hash"}
        if (
            record.get("sequence") != index
            or record.get("command_id") != command_id
            or receipt_hash != _canonical_json_hash(material)
            or record.get("command_hash") != state["command_hashes"][command_id]
            or not _json_deep_equal(record.get("command_provenance"), state["command_provenance"][command_id])
            or not _json_deep_equal(record.get("result"), state["result_snapshots"][command_id])
        ):
            raise _state_error(f"canonical result receipt {command_id!r} diverges")
        # Terminal command copies provide the exact command needed to recompute
        # the receipt's choice binding. Non-terminal commands bind through their
        # persisted public choice or null choice.
        command = next(
            (cmd for history in state["choice_history"].values()
             for cmd in history.get("terminal_commands", [])
             if isinstance(cmd, dict) and cmd.get("command_id") == command_id),
            {"command_id": command_id, "payload": {}},
        )
        commands_by_id[command_id] = command
        expected_choice = _result_choice_id(command, state["result_snapshots"][command_id], state)
        if record.get("choice_id") != expected_choice:
            raise _state_error(f"canonical result receipt {command_id!r} has wrong choice binding")
    receipts_by_id = {row["command_id"]: row for row in records}
    for choice_id, history in state["choice_history"].items():
        expected_hashes = [receipts_by_id[command_id]["receipt_hash"]
                           for command_id in history["terminal_command_ids"]]
        if history["terminal_result_receipt_hashes"] != expected_hashes:
            raise _state_error(f"choice history {choice_id!r} has wrong canonical receipt references")
    _validate_result_source_evidence(campaign_dir, state, commands_by_id)
    _validate_push_offer_evidence(campaign_dir, state)
    _validate_chase_offer_evidence(campaign_dir, state)
    _validate_chase_conflict_ledger(campaign_dir, state)
    _validate_chase_genesis_ledger(campaign_dir, state)


def _load_state(campaign_dir: Path) -> dict[str, Any]:
    with _ExecutorStateDirectory(campaign_dir) as state_directory:
        encoded = state_directory.read_bytes()
    if encoded is None:
        return _default_state()
    try:
        raw = json.loads(encoded.decode("utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise _state_error(f"could not read valid JSON: {exc}") from exc
    if isinstance(raw, dict) and raw.get("schema_version") == 2:
        migrated = _migrate_schema_v2(raw)
        _write_executor_state(Path(campaign_dir), migrated)
        return migrated
    return _validate_state(raw)


def load_canonical_state_readonly(campaign_dir: Path | str) -> dict[str, Any]:
    """Read and validate schema-v3 executor state without recovery or migration.

    Audience gateways must never repair, migrate, or otherwise mutate private
    rule state merely to render a public snapshot.
    """
    campaign = Path(campaign_dir)
    with _ExecutorStateDirectory(campaign) as state_directory:
        encoded = state_directory.read_bytes()
    if encoded is None:
        return _default_state()
    try:
        raw = json.loads(encoded.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise _state_error(f"could not read valid JSON: {exc}") from exc
    state = _validate_state(raw)
    _validate_external_result_receipts(campaign, state)
    return _json_copy(state)


def project_player_pending_choice(campaign_dir: Path | str) -> dict[str, Any] | None:
    """Return the sole canonical player choice with a recursively exact contract."""
    state = load_canonical_state_readonly(campaign_dir)
    choices = state["pending_choices"]
    player_choices = [
        choice for choice in choices.values()
        if isinstance(choice, dict) and choice.get("responder") == "player"
    ]
    if not player_choices:
        return None
    if len(player_choices) != 1:
        raise _state_error("multiple player pending choices are not projectable")
    choice = player_choices[0]
    if set(choice) != PUBLIC_PENDING_CHOICE_KEYS:
        raise _state_error("public pending choice has an invalid root contract")
    options = choice.get("options")
    if (
        not isinstance(options, list)
        or not options
        or any(
            not isinstance(option, dict)
            or set(option) != {"action", "label"}
            or not isinstance(option.get("action"), str)
            or not option["action"].strip()
            or not isinstance(option.get("label"), str)
            or not option["label"].strip()
            for option in options
        )
    ):
        raise _state_error("public pending choice options have an invalid contract")
    return _json_copy(choice)


def _seal_authored_route_transaction(
    campaign_dir: Path,
    *,
    scene_id: str,
    route_id: str,
) -> dict[str, Any] | None:
    path = campaign_dir / "scenario" / "story-graph.json"
    try:
        encoded = path.read_bytes()
        story = json.loads(encoded.decode("utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return None
    if not isinstance(story, dict):
        return None
    scene = next(
        (
            row for row in story.get("scenes", [])
            if isinstance(row, dict) and str(row.get("scene_id") or "") == scene_id
        ),
        None,
    )
    if not isinstance(scene, dict):
        return None
    route = next(
        (
            row for row in scene.get("affordances", [])
            if isinstance(row, dict)
            and str(row.get("id") or row.get("route_id") or "") == route_id
        ),
        None,
    )
    if not isinstance(route, dict):
        return None
    direct_grants = list(dict.fromkeys(
        str(value).strip()
        for value in [route.get("clue_id"), *(route.get("grants_clue_ids") or [])]
        if str(value or "").strip()
    ))
    remaining = list(dict.fromkeys(
        str(value).strip()
        for value in route.get("remaining_clue_ids") or []
        if str(value or "").strip()
    ))
    required = list(dict.fromkeys(
        str(value).strip()
        for value in route.get("requires_completed_route_ids") or []
        if str(value or "").strip()
    ))
    flags = list(dict.fromkeys(
        str(value).strip()
        for value in route.get("sets_flags") or []
        if str(value or "").strip()
    ))
    public_goal = str(
        route.get("cue") or route.get("player_visible_cue") or ""
    ).strip()
    public_outcome = str(
        route.get("player_visible_outcome")
        or route.get("player_visible_success")
        or route.get("on_success_visible")
        or route.get("visible_benefit")
        or (f"Completed public action: {public_goal}" if public_goal else "")
    ).strip()
    source_time_profile = route.get("time_profile") if "time_profile" in route else None
    if not _is_exact_source_time_profile(source_time_profile):
        # An authored but malformed/partial non-null value is ambiguous
        # execution authority.  Do not mint a Push capability for the route.
        return None
    transaction = {
        "schema_version": 1,
        "kind": "authored_route_completion",
        "scene_id": scene_id,
        "route_id": route_id,
        "requires_completed_route_ids": required,
        "direct_grant_clue_ids": direct_grants,
        "remaining_clue_ids": remaining,
        "sets_flags": flags,
        "completion_policy": (
            str(route.get("completion_policy")).strip()
            if route.get("completion_policy") is not None
            else None
        ),
        "repeatable": bool(
            route.get("repeatable") is True
            or str(route.get("status") or "") in {"repeatable", "resume"}
            or str(route.get("completion_policy") or "") == "repeatable"
        ),
        "player_visible_goal": public_goal,
        "player_visible_outcome": public_outcome,
        "source_time_profile": _json_copy(source_time_profile),
        "source_provenance": {
            "kind": "sealed_story_graph_route",
            "story_graph_sha256": hashlib.sha256(encoded).hexdigest(),
        },
    }
    return _validate_sealed_route_transaction(transaction)


def _mint_push_continuation_capsule(
    campaign_dir: Path,
    investigator_id: str,
    character_id: str,
    command: dict[str, Any],
    event: dict[str, Any],
) -> dict[str, Any] | None:
    """Compile immutable Push execution authority at the original failure.

    Missing or ambiguous structured source evidence simply makes the failed
    roll non-pushable.  It is never repaired later from prose or adjacent IDs.
    """
    if event.get("success") is not False or event.get("outcome") != "failure":
        return None
    contract = event.get("roll_contract")
    policy = contract.get("push_policy") if isinstance(contract, dict) else None
    consequence = _typed_push_consequence(
        contract.get("push_failure_consequence") if isinstance(contract, dict) else None
    )
    if not isinstance(policy, dict) or policy.get("eligible") is not True or consequence is None:
        return None
    resolution = event.get("resolution_context")
    if not isinstance(resolution, dict):
        return None
    plan_slice = _json_copy(resolution)
    route_resolution = plan_slice.pop("route_resolution", None)
    context_time_profile = plan_slice.pop("source_time_profile", None)
    turn_input = resolution.get("turn_input")
    rich = (
        turn_input.get("player_intent_rich")
        if isinstance(turn_input, dict) and isinstance(turn_input.get("player_intent_rich"), dict)
        else {}
    )
    action_resolution = (
        rich.get("action_resolution")
        if isinstance(rich.get("action_resolution"), dict)
        else {}
    )
    action_route_ids = list(dict.fromkeys(
        str(value).strip()
        for value in action_resolution.get("matched_affordance_ids") or []
        if str(value or "").strip()
    ))
    clue_policy = resolution.get("clue_policy")
    policy_route_ids = list(dict.fromkeys(
        str(value).strip()
        for value in (
            clue_policy.get("matched_route_ids") if isinstance(clue_policy, dict) else []
        ) or []
        if str(value or "").strip()
    ))
    receipt_route_ids = list(dict.fromkeys(
        str(value).strip()
        for value in (
            route_resolution.get("matched_route_ids")
            if isinstance(route_resolution, dict)
            else []
        ) or []
        if str(value or "").strip()
    ))
    route_claimed = bool(action_route_ids or policy_route_ids or receipt_route_ids)
    route_id: str | None = None
    clue_ids: list[str] = []
    scene_id = str(turn_input.get("active_scene_id") or "").strip() if isinstance(turn_input, dict) else ""
    if route_claimed:
        if (
            not isinstance(route_resolution, dict)
            or route_resolution.get("schema_version") != 1
            or len(receipt_route_ids) != 1
            or not scene_id
            or receipt_route_ids[0] not in set(action_route_ids or policy_route_ids)
            or (
                action_route_ids and policy_route_ids
                and receipt_route_ids[0] not in set(action_route_ids) & set(policy_route_ids)
            )
        ):
            return None
        route_id = receipt_route_ids[0]
        clue_ids = list(dict.fromkeys(
            str(value).strip()
            for value in route_resolution.get("clue_ids") or []
            if str(value or "").strip()
        ))
        generated = bool(
            contract.get("generated_clue_gate") is True
            or contract.get("authored_clue_bonus") is True
        )
        policy_clues = list(dict.fromkeys(
            str(value).strip()
            for value in (
                clue_policy.get("reveal") if isinstance(clue_policy, dict) else []
            ) or []
            if str(value or "").strip()
        ))
        if generated and (len(clue_ids) != 1 or clue_ids != policy_clues):
            return None
    route_transaction = None
    if route_id is not None:
        route_transaction = _seal_authored_route_transaction(
            campaign_dir,
            scene_id=scene_id,
            route_id=route_id,
        )
        if route_transaction is None:
            return None
    if isinstance(route_transaction, dict):
        # Route authority comes only from the exact authored route snapshot.
        # Director/runtime fallback timing is intentionally not reusable by a
        # later Push attempt.
        source_time = route_transaction.get("source_time_profile")
    else:
        source_time = (
            contract.get("push_time_profile")
            if isinstance(contract, dict)
            and contract.get("push_time_profile") is not None
            else context_time_profile
        )
        if not _is_exact_source_time_profile(source_time):
            return None
    settlement_route = None
    if route_id is not None:
        settlement_route = {
            "schema_version": 1,
            "matched_route_ids": [route_id],
            "request_id": None,
        }
        if clue_ids:
            settlement_route["clue_ids"] = clue_ids
    capsule: dict[str, Any] = {
        "schema_version": 1,
        "kind": "push_continuation",
        "continuation_id": None,
        "campaign_binding": _campaign_binding(campaign_dir),
        "actor_binding": {
            "investigator_id": investigator_id,
            "character_id": character_id,
        },
        "authority_revision": 0,
        "roll_spec": {
            "kind": event.get("kind"),
            "skill": event.get("skill") or event.get("characteristic"),
            "target": event.get("target"),
            "difficulty": event.get("difficulty"),
            "bonus_penalty_dice": event.get("bonus_penalty_dice", 0),
            "reason": event.get("reason"),
            "roll_contract": _json_copy(contract),
        },
        "settlement": {
            "plan_slice": plan_slice,
            "route_resolution": settlement_route,
            "request_id": None,
            "announced_consequence": consequence,
            "source_time_profile": _json_copy(source_time),
            "route_transaction": route_transaction,
        },
        "source_evidence": {
            "origin_command_id": command["command_id"],
            "origin_decision_id": command["payload"].get("decision_id"),
            "roll_id": event.get("roll_id"),
            "scene_id": scene_id or None,
        },
        "idempotency": {
            "key": None,
            "mode": "exact_once",
            "consumption_ledger": "choice_history",
        },
    }
    digest = _canonical_json_hash(capsule)
    capsule["continuation_id"] = f"push-cont:{digest}"
    capsule["settlement"]["request_id"] = f"push-settle:{digest}"
    capsule["idempotency"]["key"] = f"push-once:{digest}"
    if isinstance(capsule["settlement"]["route_resolution"], dict):
        capsule["settlement"]["route_resolution"]["request_id"] = (
            capsule["settlement"]["request_id"]
        )
    return _validate_push_capsule(
        capsule,
        campaign_dir=campaign_dir,
        investigator_id=investigator_id,
        character_id=character_id,
    )


def project_latest_eligible_push_candidate(
    campaign_dir: Path | str,
    investigator_id: str,
    character_id: str,
) -> dict[str, Any] | None:
    """Project the latest unconsumed ordinary failed roll for semantic routing.

    The projection is deliberately singular and bounded. Any later roll by the
    same actor makes an older failure stale, while combat/sanity/ineligible,
    successful, fumbled, ambiguous-route, or already-used results fail closed.
    Numeric dice and private resolution context never cross this boundary.
    """
    state = load_canonical_state_readonly(campaign_dir)
    if state["pending_choices"]:
        return None
    for command_id in reversed(state["applied_command_ids"]):
        provenance = state["command_provenance"].get(command_id)
        snapshot = state["result_snapshots"].get(command_id)
        if (
            not isinstance(provenance, dict)
            or provenance.get("investigator_id") != investigator_id
            or provenance.get("character_id") != character_id
            or not isinstance(snapshot, dict)
        ):
            continue
        roll_events = [
            event for event in snapshot.get("events") or []
            if isinstance(event, dict) and isinstance(event.get("roll_id"), str)
        ]
        if not roll_events:
            continue
        if snapshot.get("kind") not in {"skill_check", "characteristic_check"}:
            return None
        if len(roll_events) != 1:
            return None
        event = roll_events[0]
        contract = event.get("roll_contract")
        policy = contract.get("push_policy") if isinstance(contract, dict) else None
        if (
            event.get("success") is not False
            or event.get("outcome") != "failure"
            or not isinstance(policy, dict)
            or policy.get("eligible") is not True
            or _push_origin_in_use(state, command_id)
        ):
            return None
        capsule = event.get("push_continuation_capsule")
        if not isinstance(capsule, dict):
            return None
        capsule = _validate_push_capsule(
            capsule,
            campaign_dir=campaign_dir,
            investigator_id=investigator_id,
            character_id=character_id,
        )
        transaction = capsule["settlement"].get("route_transaction")
        route_id = str(
            transaction.get("route_id") if isinstance(transaction, dict) else ""
        ).strip()
        skill = event.get("skill") or event.get("characteristic")
        if not isinstance(skill, str) or not skill.strip():
            return None
        return {
            "candidate_id": capsule["continuation_id"],
            "continuation_id": capsule["continuation_id"],
            "original_command_id": command_id,
            "original_roll_id": event["roll_id"],
            "kind": snapshot["kind"],
            "skill_or_characteristic": skill.strip(),
            "target": event.get("target"),
            "difficulty": event.get("difficulty"),
            "goal": contract.get("goal") if isinstance(contract, dict) else None,
            "route_id": route_id,
            "failure_outcome_mode": (
                contract.get("failure_outcome_mode")
                if isinstance(contract, dict) else None
            ),
            "requires_changed_method": policy.get("requires_changed_method") is True,
            "keeper_must_foreshadow_failure": (
                policy.get("keeper_must_foreshadow_failure") is True
            ),
            "announced_consequence": _json_copy(
                capsule["settlement"]["announced_consequence"]
            ),
            "source_time_profile": _json_copy(
                capsule["settlement"]["source_time_profile"]
            ),
        }
    return None


def project_player_combat_defense(
    campaign_dir: Path | str,
    investigator_id: str,
) -> dict[str, Any] | None:
    """Project an active attack as an exact player-only defense choice."""
    campaign = Path(campaign_dir)
    path = campaign / "save" / "combat.json"
    if not path.exists():
        return None
    session = _load_combat_session(
        campaign, rng=random.Random(0), investigator_id=investigator_id,
    )
    pending = session.pending_attack
    if session.status != "active" or not isinstance(pending, dict):
        return None
    # A defense is player-owned only when this session's investigator is the
    # target. NPC defenses remain private Keeper continuations and are never
    # projected through PublicState.
    if pending.get("target_actor_id") != investigator_id:
        return None
    labels = {
        "dodge": "Dodge", "fight_back": "Fight Back",
        "dive_for_cover": "Dive for Cover", "none": "Take No Defense",
    }
    attack_id = pending["attack_command_id"]
    return {
        "choice_id": f"combat-defense:{attack_id}",
        "kind": "combat_defense", "command_id": attack_id,
        "responder": "player", "revision": session.revision,
        "prompt": "Choose a legal combat defense.",
        "options": [
            {"action": action, "label": labels[action]}
            for action in pending["allowed_defenses"]
        ],
        "attack_id": attack_id, "audience": "player",
    }


def _unsafe_transaction_path(relative: str, message: str) -> SubsystemExecutorError:
    return _error("unsafe_subsystem_transaction_path", relative, message)


class _AnchoredTransactionTarget:
    """No-follow access to one fixed transaction target below a campaign.

    Every parent component stays open while the target is accessed. Named
    parent identities are rechecked around mutations, so a concurrent rename
    plus symlink replacement cannot redirect rollback outside the campaign.
    """

    def __init__(self, campaign_dir: Path, relative: str) -> None:
        if not (
            _allowed_preimage_path(relative)
            or relative in {
                "logs/rolls.jsonl", "logs/time.jsonl", "logs/subsystem-results.jsonl",
                "logs/push-offers.jsonl", "logs/chase-offers.jsonl",
                "logs/chase-conflicts.jsonl", "logs/chase-genesis.jsonl",
            }
        ):
            raise _unsafe_transaction_path(relative, "target is not transaction-owned")
        directory_flag = getattr(os, "O_DIRECTORY", None)
        nofollow_flag = getattr(os, "O_NOFOLLOW", None)
        if directory_flag is None or nofollow_flag is None:
            raise _unsafe_transaction_path(
                relative,
                "runtime lacks required O_DIRECTORY/O_NOFOLLOW primitives",
            )
        if (
            not _TRANSACTION_DIR_FD_SUPPORTED
            or not _TRANSACTION_NOFOLLOW_STAT_SUPPORTED
        ):
            raise _unsafe_transaction_path(
                relative,
                "runtime lacks required dir_fd/follow_symlinks primitives",
            )

        self.relative = relative
        self.campaign_path = Path(campaign_dir).resolve()
        self._directory_flags = (
            os.O_RDONLY
            | directory_flag
            | nofollow_flag
            | getattr(os, "O_CLOEXEC", 0)
        )
        self.campaign_fd: int | None = None
        self.parent_fd: int | None = None
        self._opened_parent_fds: list[int] = []
        self._parent_entries: list[tuple[int, str, int, tuple[int, int]]] = []
        self._missing_parent: tuple[int, str] | None = None
        parts = Path(relative).parts
        self.leaf_name = parts[-1]
        try:
            self.campaign_fd = os.open(self.campaign_path, self._directory_flags)
            container_fd = self.campaign_fd
            for component in parts[:-1]:
                try:
                    child_fd = os.open(
                        component,
                        self._directory_flags,
                        dir_fd=container_fd,
                    )
                except FileNotFoundError:
                    self._missing_parent = (container_fd, component)
                    break
                try:
                    opened = os.fstat(child_fd)
                except Exception:
                    os.close(child_fd)
                    raise
                if not stat.S_ISDIR(opened.st_mode):
                    os.close(child_fd)
                    raise _unsafe_transaction_path(
                        relative,
                        f"parent component {component!r} is not a directory",
                    )
                identity = self._identity(opened)
                self._opened_parent_fds.append(child_fd)
                self._parent_entries.append(
                    (container_fd, component, child_fd, identity)
                )
                container_fd = child_fd
            else:
                self.parent_fd = container_fd
            self.verify_parents()
        except Exception as exc:
            self.close()
            if isinstance(exc, SubsystemExecutorError):
                raise
            raise _unsafe_transaction_path(
                relative,
                f"transaction parent could not be opened safely: {exc}",
            ) from exc

    def __enter__(self) -> "_AnchoredTransactionTarget":
        return self

    def __exit__(self, _exc_type, _exc, _tb) -> None:
        self.close()

    @staticmethod
    def _identity(info: os.stat_result) -> tuple[int, int]:
        return int(info.st_dev), int(info.st_ino)

    def verify_parents(self) -> None:
        assert self.campaign_fd is not None
        try:
            opened_campaign = os.fstat(self.campaign_fd)
            named_campaign = os.stat(self.campaign_path, follow_symlinks=False)
            if (
                not stat.S_ISDIR(opened_campaign.st_mode)
                or not stat.S_ISDIR(named_campaign.st_mode)
                or self._identity(opened_campaign) != self._identity(named_campaign)
            ):
                raise _unsafe_transaction_path(
                    self.relative,
                    "campaign root identity changed",
                )
            for container_fd, component, child_fd, identity in self._parent_entries:
                opened = os.fstat(child_fd)
                named = os.stat(
                    component,
                    dir_fd=container_fd,
                    follow_symlinks=False,
                )
                if (
                    not stat.S_ISDIR(opened.st_mode)
                    or not stat.S_ISDIR(named.st_mode)
                    or self._identity(opened) != identity
                    or self._identity(named) != identity
                ):
                    raise _unsafe_transaction_path(
                        self.relative,
                        f"parent component {component!r} changed during access",
                    )
            if self._missing_parent is not None:
                container_fd, component = self._missing_parent
                try:
                    os.stat(
                        component,
                        dir_fd=container_fd,
                        follow_symlinks=False,
                    )
                except FileNotFoundError:
                    pass
                else:
                    raise _unsafe_transaction_path(
                        self.relative,
                        f"missing parent component {component!r} appeared during access",
                    )
        except SubsystemExecutorError:
            raise
        except (OSError, TypeError) as exc:
            raise _unsafe_transaction_path(
                self.relative,
                f"transaction parent identity could not be verified: {exc}",
            ) from exc

    def _leaf_info(self) -> os.stat_result | None:
        if self.parent_fd is None:
            self.verify_parents()
            return None
        self.verify_parents()
        try:
            info = os.stat(
                self.leaf_name,
                dir_fd=self.parent_fd,
                follow_symlinks=False,
            )
        except FileNotFoundError:
            self.verify_parents()
            return None
        except (OSError, TypeError) as exc:
            raise _unsafe_transaction_path(
                self.relative,
                f"transaction target could not be inspected safely: {exc}",
            ) from exc
        if not stat.S_ISREG(info.st_mode):
            raise _unsafe_transaction_path(
                self.relative,
                "transaction target must be a regular file",
            )
        self.verify_parents()
        return info

    def _verify_leaf_identity(self, expected: os.stat_result | None) -> None:
        assert self.parent_fd is not None
        try:
            current = os.stat(
                self.leaf_name,
                dir_fd=self.parent_fd,
                follow_symlinks=False,
            )
        except FileNotFoundError:
            current = None
        except (OSError, TypeError) as exc:
            raise _unsafe_transaction_path(
                self.relative,
                f"transaction target identity could not be verified: {exc}",
            ) from exc
        if expected is None:
            if current is not None:
                raise _unsafe_transaction_path(
                    self.relative,
                    "transaction target appeared during access",
                )
            return
        if (
            current is None
            or not stat.S_ISREG(current.st_mode)
            or self._identity(current) != self._identity(expected)
        ):
            raise _unsafe_transaction_path(
                self.relative,
                "transaction target identity changed during access",
            )

    def read_bytes(self) -> bytes | None:
        info = self._leaf_info()
        if info is None:
            return None
        assert self.parent_fd is not None
        target_fd: int | None = None
        try:
            target_fd = os.open(
                self.leaf_name,
                os.O_RDONLY | getattr(os, "O_NOFOLLOW") | getattr(os, "O_CLOEXEC", 0),
                dir_fd=self.parent_fd,
            )
            opened = os.fstat(target_fd)
            if (
                not stat.S_ISREG(opened.st_mode)
                or self._identity(opened) != self._identity(info)
            ):
                raise _unsafe_transaction_path(
                    self.relative,
                    "transaction target changed while being opened",
                )
            chunks: list[bytes] = []
            while True:
                chunk = os.read(target_fd, 64 * 1024)
                if not chunk:
                    break
                chunks.append(chunk)
            self._verify_leaf_identity(info)
            self.verify_parents()
            return b"".join(chunks)
        except SubsystemExecutorError:
            raise
        except (OSError, TypeError) as exc:
            raise _unsafe_transaction_path(
                self.relative,
                f"transaction target could not be read safely: {exc}",
            ) from exc
        finally:
            if target_fd is not None:
                os.close(target_fd)

    def file_size(self) -> tuple[bool, int]:
        info = self._leaf_info()
        if info is None:
            return False, 0
        assert self.parent_fd is not None
        target_fd: int | None = None
        try:
            target_fd = os.open(
                self.leaf_name,
                os.O_RDONLY | getattr(os, "O_NOFOLLOW") | getattr(os, "O_CLOEXEC", 0),
                dir_fd=self.parent_fd,
            )
            opened = os.fstat(target_fd)
            if (
                not stat.S_ISREG(opened.st_mode)
                or self._identity(opened) != self._identity(info)
            ):
                raise _unsafe_transaction_path(
                    self.relative,
                    "transaction log changed while being opened",
                )
            self._verify_leaf_identity(info)
            self.verify_parents()
            return True, int(opened.st_size)
        except SubsystemExecutorError:
            raise
        except (OSError, TypeError) as exc:
            raise _unsafe_transaction_path(
                self.relative,
                f"transaction log size could not be read safely: {exc}",
            ) from exc
        finally:
            if target_fd is not None:
                os.close(target_fd)

    def write_bytes_atomic(self, payload: bytes) -> None:
        if self.parent_fd is None:
            raise _unsafe_transaction_path(
                self.relative,
                "transaction target parent is missing",
            )
        original = self._leaf_info()
        temp_name = f".{self.leaf_name}.{os.getpid()}.{time.time_ns()}.tmp"
        temp_fd: int | None = None
        replaced = False
        try:
            temp_fd = os.open(
                temp_name,
                os.O_WRONLY
                | os.O_CREAT
                | os.O_EXCL
                | getattr(os, "O_NOFOLLOW")
                | getattr(os, "O_CLOEXEC", 0),
                0o600,
                dir_fd=self.parent_fd,
            )
            view = memoryview(payload)
            while view:
                written = os.write(temp_fd, view)
                view = view[written:]
            os.fsync(temp_fd)
            os.close(temp_fd)
            temp_fd = None
            self.verify_parents()
            self._verify_leaf_identity(original)
            os.replace(
                temp_name,
                self.leaf_name,
                src_dir_fd=self.parent_fd,
                dst_dir_fd=self.parent_fd,
            )
            replaced = True
            os.fsync(self.parent_fd)
            self.verify_parents()
        except SubsystemExecutorError:
            raise
        except (OSError, TypeError) as exc:
            raise _unsafe_transaction_path(
                self.relative,
                f"transaction target could not be replaced safely: {exc}",
            ) from exc
        finally:
            if temp_fd is not None:
                os.close(temp_fd)
            if not replaced:
                try:
                    os.unlink(temp_name, dir_fd=self.parent_fd)
                except (FileNotFoundError, OSError, TypeError):
                    pass

    def unlink_if_exists(self) -> None:
        info = self._leaf_info()
        if info is None:
            return
        assert self.parent_fd is not None
        try:
            self.verify_parents()
            self._verify_leaf_identity(info)
            os.unlink(self.leaf_name, dir_fd=self.parent_fd)
            os.fsync(self.parent_fd)
            self.verify_parents()
        except SubsystemExecutorError:
            raise
        except (OSError, TypeError) as exc:
            raise _unsafe_transaction_path(
                self.relative,
                f"transaction target could not be removed safely: {exc}",
            ) from exc

    def truncate(self, expected_size: int) -> None:
        info = self._leaf_info()
        if info is None:
            raise _state_error(
                f"missing log required for inflight recovery: {self.relative!r}"
            )
        assert self.parent_fd is not None
        target_fd: int | None = None
        try:
            target_fd = os.open(
                self.leaf_name,
                os.O_RDWR | getattr(os, "O_NOFOLLOW") | getattr(os, "O_CLOEXEC", 0),
                dir_fd=self.parent_fd,
            )
            opened = os.fstat(target_fd)
            if (
                not stat.S_ISREG(opened.st_mode)
                or self._identity(opened) != self._identity(info)
            ):
                raise _unsafe_transaction_path(
                    self.relative,
                    "transaction log changed while being opened",
                )
            if int(opened.st_size) < expected_size:
                raise _state_error(
                    f"log {self.relative!r} is shorter than its pre-append offset"
                )
            self.verify_parents()
            self._verify_leaf_identity(info)
            os.ftruncate(target_fd, expected_size)
            os.fsync(target_fd)
            self.verify_parents()
        except SubsystemExecutorError:
            raise
        except (OSError, TypeError) as exc:
            raise _unsafe_transaction_path(
                self.relative,
                f"transaction log could not be truncated safely: {exc}",
            ) from exc
        finally:
            if target_fd is not None:
                os.close(target_fd)

    def close(self) -> None:
        for parent_fd in reversed(self._opened_parent_fds):
            os.close(parent_fd)
        self._opened_parent_fds.clear()
        if self.campaign_fd is not None:
            os.close(self.campaign_fd)
            self.campaign_fd = None
        self.parent_fd = None


def _capture_preimage(campaign_dir: Path, relative: str) -> dict[str, Any]:
    with _AnchoredTransactionTarget(campaign_dir, relative) as target:
        raw = target.read_bytes()
    if raw is None:
        return {"exists": False, "encoding": "base64", "data": None}
    try:
        raw.decode("utf-8")
    except UnicodeError as exc:
        raise _error(
            "subsystem_transaction_preflight_failed",
            relative,
            f"could not capture UTF-8 preimage: {exc}",
        ) from exc
    return {
        "exists": True,
        "encoding": "base64",
        "data": base64.b64encode(raw).decode("ascii"),
    }


def _build_inflight(
    campaign_dir: Path,
    investigator_id: str,
    commands_with_hashes: list[tuple[dict[str, Any], str]],
) -> dict[str, Any]:
    structured_sanity = any(
        command["kind"] in SAN_MUTATION_COMMAND_KINDS
        and (
            command["kind"] != "sanity_check"
            or "san_loss_fail_expr" in command["payload"]
        )
        for command, _command_hash in commands_with_hashes
    )
    structured_combat = any(
        command["kind"] in COMBAT_COMMAND_KINDS
        for command, _command_hash in commands_with_hashes
    )
    structured_chase = any(
        command["kind"] in CHASE_COMMAND_KINDS
        for command, _command_hash in commands_with_hashes
    )
    structured_authored = any(
        command["kind"] in AUTHORED_OPERATION_COMMAND_KINDS
        for command, _command_hash in commands_with_hashes
    )
    preimage_relatives: list[str] = []
    if structured_sanity:
        preimage_relatives = [
            f"save/sanity-state/{investigator_id}.json",
            # The legacy singleton may still be this investigator's
            # compatibility mirror.  Capture both paths so rollback cannot
            # leave a newer canonical snapshot behind a restored mirror.
            "save/sanity.json",
            f"save/investigator-state/{investigator_id}.json",
            "save/time-state.json",
            "save/time-triggers.json",
        ]
    if structured_combat:
        for relative in (
            "save/combat.json",
            f"save/investigator-state/{investigator_id}.json",
        ):
            if relative not in preimage_relatives:
                preimage_relatives.append(relative)
    if structured_chase:
        for relative in (
            "save/chase.json",
            f"save/investigator-state/{investigator_id}.json",
        ):
            if relative not in preimage_relatives:
                preimage_relatives.append(relative)
    if structured_authored:
        for relative in (
            f"save/investigator-state/{investigator_id}.json",
            "save/time-state.json",
            "save/time-triggers.json",
        ):
            if relative not in preimage_relatives:
                preimage_relatives.append(relative)
    has_roll_evidence = any(
        _command_requires_roll_evidence(command)
        for command, _command_hash in commands_with_hashes
    )
    log_offsets: dict[str, dict[str, Any]] = {}
    log_relatives: list[str] = ["logs/subsystem-results.jsonl"]
    if any(command["kind"] == "push_offer" for command, _ in commands_with_hashes):
        log_relatives.append("logs/push-offers.jsonl")
    if any(command["kind"] == "chase_move" and command["payload"].get("action_id") == "choice:offer"
           for command, _ in commands_with_hashes):
        log_relatives.append(_CHASE_OFFER_EVIDENCE_LOG.as_posix())
    if any(command["kind"] == "chase_conflict" for command, _ in commands_with_hashes):
        log_relatives.append(_CHASE_CONFLICT_LEDGER.as_posix())
    if any(command["kind"] == "chase_start" for command, _ in commands_with_hashes):
        log_relatives.append(_CHASE_GENESIS_LEDGER.as_posix())
    if has_roll_evidence:
        log_relatives.append("logs/rolls.jsonl")
    if structured_sanity:
        log_relatives.append("logs/time.jsonl")
    if structured_authored and "logs/time.jsonl" not in log_relatives:
        log_relatives.append("logs/time.jsonl")
    for relative in log_relatives:
        with _AnchoredTransactionTarget(campaign_dir, relative) as target:
            exists, size = target.file_size()
        log_offsets[relative] = {"exists": exists, "size": size}
    inflight = {
        "commands": [
            {
                "command_id": command["command_id"],
                "command_hash": command_hash,
            }
            for command, command_hash in commands_with_hashes
        ],
        "preimages": {
            relative: _capture_preimage(campaign_dir, relative)
            for relative in preimage_relatives
        },
        "log_offsets": log_offsets,
    }
    _validate_inflight(inflight)
    return inflight


def _restore_inflight_targets(campaign_dir: Path, inflight: dict[str, Any]) -> None:
    _validate_inflight(inflight)
    for relative, preimage in inflight["preimages"].items():
        with _AnchoredTransactionTarget(campaign_dir, relative) as target:
            if preimage["exists"]:
                raw = base64.b64decode(preimage["data"].encode("ascii"), validate=True)
                target.write_bytes_atomic(raw)
            else:
                target.unlink_if_exists()

    for relative, offset in inflight["log_offsets"].items():
        with _AnchoredTransactionTarget(campaign_dir, relative) as target:
            if not offset["exists"]:
                target.unlink_if_exists()
            else:
                target.truncate(int(offset["size"]))


def _write_executor_state(campaign_dir: Path, state: dict[str, Any]) -> None:
    _validate_state(state)
    encoded = (
        json.dumps(state, indent=2, ensure_ascii=False) + "\n"
    ).encode("utf-8")
    with _ExecutorStateDirectory(campaign_dir) as state_directory:
        state_directory.write_bytes(encoded)


def _recover_inflight(campaign_dir: Path, state: dict[str, Any]) -> dict[str, Any]:
    inflight = state.get("inflight")
    if not isinstance(inflight, dict):
        return state
    try:
        _restore_inflight_targets(campaign_dir, inflight)
        recovered = _json_copy(state)
        recovered["inflight"] = None
        _write_executor_state(campaign_dir, recovered)
        return recovered
    except Exception as exc:
        if isinstance(exc, SubsystemExecutorError):
            raise
        raise _error(
            "subsystem_inflight_recovery_failed",
            STATE_RELATIVE_PATH.as_posix(),
            str(exc),
        ) from exc


def _rollback_transaction(
    campaign_dir: Path,
    base_state: dict[str, Any],
    inflight: dict[str, Any],
) -> None:
    _restore_inflight_targets(campaign_dir, inflight)
    restored = _json_copy(base_state)
    restored["inflight"] = None
    _write_executor_state(campaign_dir, restored)


def _validate_command(command: Any, index: int) -> dict[str, Any]:
    base = f"commands[{index}]"
    if not isinstance(command, dict) or set(command) != COMMAND_KEYS:
        raise _error(
            "invalid_command_contract",
            base,
            "command must contain exactly command_id, kind, phase, and payload",
        )
    command_id = command.get("command_id")
    if not isinstance(command_id, str) or not _SAFE_ID.fullmatch(command_id):
        raise _error("invalid_command_id", f"{base}.command_id", "expected a stable safe ID")
    kind = command.get("kind")
    if kind not in SUPPORTED_COMMAND_KINDS:
        raise _error(
            "unsupported_command_kind",
            f"{base}.kind",
            f"unsupported kind: {kind!r}",
        )
    phase = command.get("phase")
    if phase != EXPECTED_PHASE[kind]:
        raise _error(
            "invalid_command_phase",
            f"{base}.phase",
            f"{kind} requires phase {EXPECTED_PHASE[kind]!r}",
        )
    payload = command.get("payload")
    if not isinstance(payload, dict):
        raise _error("invalid_command_payload", f"{base}.payload", "payload must be an object")
    _validate_json_value(payload, f"{base}.payload")
    return _json_copy(command)


def _validate_payload_fields(command: dict[str, Any], index: int) -> None:
    payload = command["payload"]
    base = f"commands[{index}].payload"
    difficulty = payload.get("difficulty", "regular")
    if difficulty not in {"regular", "hard", "extreme"}:
        raise _error(
            "invalid_command_payload",
            f"{base}.difficulty",
            "difficulty must be regular, hard, or extreme",
        )
    decision_id = payload.get("decision_id")
    if decision_id is not None and (
        not isinstance(decision_id, str) or not _SAFE_ID.fullmatch(decision_id)
    ):
        raise _error(
            "invalid_command_payload",
            f"{base}.decision_id",
            "decision_id must be null or a stable safe ID",
        )
    kind = command["kind"]
    if kind == "environmental_hazard":
        required = {
            "luck_skill", "jump_skill", "damage_expr", "source", "rule_ref",
        }
        optional = {"decision_id", "roll_id", "request_index", "request_id", "route_resolution"}
        if not required <= set(payload) or set(payload) - required - optional:
            raise _error("invalid_command_payload", base, "invalid environmental_hazard contract")
        if payload.get("damage_expr") != "1D6":
            raise _error("invalid_command_payload", f"{base}.damage_expr", "only 1D6 is supported")
        for field in ("luck_skill", "jump_skill", "source", "rule_ref"):
            if not isinstance(payload.get(field), str) or not payload[field].strip():
                raise _error("invalid_command_payload", f"{base}.{field}", "expected non-empty string")
    if kind == "mythos_tome_study":
        required = {
            "tome_id", "language_skill", "language_threshold", "duration_minutes",
            "mythos_gain", "max_san_reduction", "rule_ref",
        }
        optional = {"decision_id", "roll_id", "request_index", "request_id", "route_resolution"}
        if not required <= set(payload) or set(payload) - required - optional:
            raise _error("invalid_command_payload", base, "invalid mythos_tome_study contract")
        if not isinstance(payload.get("language_skill"), str) or not payload["language_skill"].strip():
            raise _error("invalid_command_payload", f"{base}.language_skill", "expected non-empty string")
        for field in ("language_threshold", "duration_minutes", "mythos_gain", "max_san_reduction"):
            value = payload.get(field)
            if isinstance(value, bool) or not isinstance(value, int) or value < 0:
                raise _error("invalid_command_payload", f"{base}.{field}", "expected non-negative integer")
        if payload["duration_minutes"] <= 0 or not isinstance(payload.get("tome_id"), str) or not payload["tome_id"].strip():
            raise _error("invalid_command_payload", base, "tome study requires tome_id and positive duration")
    if kind in COMBAT_COMMAND_KINDS:
        revision = payload.get("revision")
        if kind not in {
            "combat_start", "dying_tick", "stabilize", "weekly_recovery"
        } and (
            isinstance(revision, bool) or not isinstance(revision, int) or revision < 0
        ):
            raise _error(
                "invalid_command_payload", f"{base}.revision",
                "combat continuation requires a non-negative revision",
            )
        if kind == "combat_start":
            if not all(
                isinstance(payload.get(field), str) and payload[field].strip()
                for field in ("combat_id", "scene_ref")
            ):
                raise _error("invalid_command_payload", base, "combat start requires IDs")
            participants = payload.get("participants")
            if not isinstance(participants, list) or len(participants) < 2:
                raise _error(
                    "invalid_command_payload", f"{base}.participants",
                    "combat requires at least two structured participants",
                )
            actor_ids: set[str] = set()
            required = {
                "actor_id", "side", "dex", "combat_skill", "dodge_skill",
                "build", "hp_max", "hp_current", "con", "weapons", "conditions",
            }
            optional = {
                "firearms_skill", "has_ready_firearm", "damage_bonus",
                "magic_points", "armor", "armor_rule",
            }
            for offset, participant in enumerate(participants):
                ppath = f"{base}.participants[{offset}]"
                if (
                    not isinstance(participant, dict)
                    or not required <= set(participant)
                    or set(participant) - required - optional
                ):
                    raise _error("invalid_command_payload", ppath, "invalid participant contract")
                actor_id = participant.get("actor_id")
                if (not isinstance(actor_id, str) or not _SAFE_ID.fullmatch(actor_id)
                        or actor_id in actor_ids):
                    raise _error("invalid_command_payload", f"{ppath}.actor_id", "actor ID must be unique and safe")
                actor_ids.add(actor_id)
                if participant.get("side") not in coc_combat.VALID_SIDES:
                    raise _error("invalid_command_payload", f"{ppath}.side", "invalid combat side")
                for field in ("dex", "combat_skill", "dodge_skill", "build", "hp_max", "hp_current", "con"):
                    value = participant.get(field)
                    if isinstance(value, bool) or not isinstance(value, int):
                        raise _error("invalid_command_payload", f"{ppath}.{field}", "expected integer")
                if not 0 <= participant["hp_current"] <= participant["hp_max"]:
                    raise _error("invalid_command_payload", f"{ppath}.hp_current", "HP is out of range")
                if (not isinstance(participant.get("weapons"), list)
                        or not isinstance(participant.get("conditions"), list)
                        or any(value not in coc_combat.VALID_CONDITIONS for value in participant["conditions"])):
                    raise _error("invalid_command_payload", ppath, "invalid weapons or conditions")
                for field in ("firearms_skill", "magic_points", "armor"):
                    if field in participant and (
                        isinstance(participant[field], bool)
                        or not isinstance(participant[field], int)
                        or participant[field] < 0
                    ):
                        raise _error("invalid_command_payload", f"{ppath}.{field}", "expected non-negative integer")
                if "has_ready_firearm" in participant and not isinstance(
                    participant["has_ready_firearm"], bool
                ):
                    raise _error("invalid_command_payload", f"{ppath}.has_ready_firearm", "expected boolean")
                if "damage_bonus" in participant and not isinstance(participant["damage_bonus"], str):
                    raise _error("invalid_command_payload", f"{ppath}.damage_bonus", "expected string")
                if participant.get("armor_rule") not in coc_combat.VALID_ARMOR_RULES:
                    raise _error("invalid_command_payload", f"{ppath}.armor_rule", "invalid armor rule")
            preparations = payload.get("preparations", [])
            if not isinstance(preparations, list):
                raise _error("invalid_command_payload", f"{base}.preparations", "expected a list")
            for offset, preparation in enumerate(preparations):
                ppath = f"{base}.preparations[{offset}]"
                required_preparation = {
                    "effect_id", "actor_id", "resource", "cost", "effect_kind",
                    "duration_rounds", "rule_ref",
                }
                optional_preparation = {"armor_dice", "armor_rule"}
                if (
                    not isinstance(preparation, dict)
                    or not required_preparation <= set(preparation)
                    or set(preparation) - required_preparation - optional_preparation
                ):
                    raise _error("invalid_command_payload", ppath, "invalid combat preparation contract")
                if preparation.get("resource") != "magic_points":
                    raise _error("invalid_command_payload", f"{ppath}.resource", "unsupported combat resource")
                for field in ("cost", "duration_rounds"):
                    if isinstance(preparation.get(field), bool) or not isinstance(preparation.get(field), int) or preparation[field] < 0:
                        raise _error("invalid_command_payload", f"{ppath}.{field}", "expected non-negative integer")
                if "armor_dice" in preparation and not re.fullmatch(r"[1-9][0-9]*D6", str(preparation["armor_dice"])):
                    raise _error("invalid_command_payload", f"{ppath}.armor_dice", "armor dice must be Nd6")
                if preparation.get("armor_rule") not in coc_combat.VALID_ARMOR_RULES:
                    raise _error("invalid_command_payload", f"{ppath}.armor_rule", "invalid armor rule")
        elif kind == "combat_attack":
            for field in ("actor_id", "target_actor_id", "declared_intent", "resolution_hint"):
                if not isinstance(payload.get(field), str) or not payload[field].strip():
                    raise _error("invalid_command_payload", f"{base}.{field}", "field is required")
            if payload.get("resolution_hint") not in {"opposed_melee", "firearm_attack"}:
                raise _error("invalid_command_payload", f"{base}.resolution_hint", "attack hint must be structured combat")
            if "resource_cost" in payload:
                cost = payload["resource_cost"]
                if (
                    not isinstance(cost, dict)
                    or set(cost) != {"resource", "cost", "reason", "rule_ref"}
                    or cost.get("resource") != "magic_points"
                    or isinstance(cost.get("cost"), bool)
                    or not isinstance(cost.get("cost"), int)
                    or cost["cost"] < 0
                ):
                    raise _error("invalid_command_payload", f"{base}.resource_cost", "invalid structured combat resource cost")
            if "on_success" in payload:
                effect = payload["on_success"]
                if (
                    not isinstance(effect, dict)
                    or set(effect) != {"kind", "outcome", "rule_ref"}
                    or effect.get("kind") != "destroy_target"
                    or effect.get("outcome") not in coc_combat.VALID_OUTCOMES - {None}
                ):
                    raise _error("invalid_command_payload", f"{base}.on_success", "invalid combat success effect")
            for field in ("victory_outcome", "defeat_outcome"):
                if field in payload and payload[field] not in coc_combat.VALID_OUTCOMES - {None}:
                    raise _error("invalid_command_payload", f"{base}.{field}", "invalid combat outcome")
        elif kind == "combat_defend":
            if payload.get("defense_kind") not in {"dodge", "fight_back", "dive_for_cover", "none"}:
                raise _error("invalid_command_payload", f"{base}.defense_kind", "invalid defense enum")
            for field in ("actor_id", "attack_command_id"):
                if not isinstance(payload.get(field), str) or not _SAFE_ID.fullmatch(payload[field]):
                    raise _error("invalid_command_payload", f"{base}.{field}", "stable ID required")
            luck_cap = payload.get("luck_spend_max")
            luck_actor_id = payload.get("luck_actor_id")
            if luck_cap is None:
                if luck_actor_id is not None:
                    raise _error(
                        "invalid_command_payload",
                        f"{base}.luck_actor_id",
                        "luck_actor_id requires luck_spend_max",
                    )
            else:
                if (
                    isinstance(luck_cap, bool)
                    or not isinstance(luck_cap, int)
                    or not 1 <= luck_cap <= 99
                ):
                    raise _error(
                        "invalid_command_payload",
                        f"{base}.luck_spend_max",
                        "luck_spend_max must be 1..99",
                    )
                if (
                    not isinstance(luck_actor_id, str)
                    or not _SAFE_ID.fullmatch(luck_actor_id)
                ):
                    raise _error(
                        "invalid_command_payload",
                        f"{base}.luck_actor_id",
                        "luck_actor_id must be a stable safe ID",
                    )
        elif kind == "dying_tick":
            if payload.get("clock_kind") not in {"round", "hour"}:
                raise _error("invalid_command_payload", f"{base}.clock_kind", "clock_kind must be round or hour")
        elif kind == "stabilize":
            if payload.get("method") not in {"first_aid", "medicine"}:
                raise _error("invalid_command_payload", f"{base}.method", "method must be first_aid or medicine")
            skill_value = payload.get("skill_value")
            if isinstance(skill_value, bool) or not isinstance(skill_value, int) or not 1 <= skill_value <= 100:
                raise _error("invalid_command_payload", f"{base}.skill_value", "skill_value must be 1..100")
            rescuer_id = payload.get("rescuer_id")
            if rescuer_id is not None and (
                not isinstance(rescuer_id, str) or not _SAFE_ID.fullmatch(rescuer_id)
            ):
                raise _error(
                    "invalid_command_payload",
                    f"{base}.rescuer_id",
                    "rescuer_id must be a stable safe ID",
                )
            pushed = payload.get("pushed", False)
            if not isinstance(pushed, bool):
                raise _error(
                    "invalid_command_payload",
                    f"{base}.pushed",
                    "pushed must be boolean",
                )
            if pushed:
                if payload.get("method") != "first_aid":
                    raise _error(
                        "invalid_command_payload",
                        f"{base}.pushed",
                        "only First Aid can use this pushed-treatment route",
                    )
                for field in ("changed_method", "failure_consequence"):
                    if not isinstance(payload.get(field), str) or not payload[field].strip():
                        raise _error(
                            "invalid_command_payload",
                            f"{base}.{field}",
                            f"pushed First Aid requires non-empty {field}",
                        )
            for field in ("wound_id", "day_id"):
                if field in payload and (
                    not isinstance(payload[field], str)
                    or not _SAFE_ID.fullmatch(payload[field])
                ):
                    raise _error("invalid_command_payload", f"{base}.{field}", f"{field} must be a stable ID")
        elif kind == "weekly_recovery":
            allowed = {
                "decision_id", "request_index", "request_id", "roll_id",
                "complete_rest", "poor_environment", "caregiver_id",
                "medicine_skill_value",
            }
            if set(payload) - allowed:
                raise _error(
                    "invalid_command_payload",
                    base,
                    "invalid weekly recovery contract",
                )
            for field in ("complete_rest", "poor_environment"):
                if not isinstance(payload.get(field), bool):
                    raise _error(
                        "invalid_command_payload",
                        f"{base}.{field}",
                        f"{field} must be boolean",
                    )
            if payload["complete_rest"] and payload["poor_environment"]:
                raise _error(
                    "invalid_command_payload",
                    base,
                    "complete rest and poor environment are mutually exclusive",
                )
            medicine_skill = payload.get("medicine_skill_value")
            caregiver_id = payload.get("caregiver_id")
            if medicine_skill is None:
                if caregiver_id is not None:
                    raise _error(
                        "invalid_command_payload",
                        f"{base}.caregiver_id",
                        "caregiver_id requires medicine_skill_value",
                    )
            else:
                if (
                    isinstance(medicine_skill, bool)
                    or not isinstance(medicine_skill, int)
                    or not 1 <= medicine_skill <= 100
                ):
                    raise _error(
                        "invalid_command_payload",
                        f"{base}.medicine_skill_value",
                        "medicine_skill_value must be 1..100",
                    )
                if (
                    not isinstance(caregiver_id, str)
                    or not _SAFE_ID.fullmatch(caregiver_id)
                ):
                    raise _error(
                        "invalid_command_payload",
                        f"{base}.caregiver_id",
                        "caregiver_id must be a stable safe ID",
                    )
        elif kind == "combat_end" and payload.get("outcome") not in coc_combat.VALID_OUTCOMES - {None}:
            raise _error("invalid_command_payload", f"{base}.outcome", "invalid combat outcome")
    if kind == "sanity_reward":
        if set(payload) - {
            "decision_id", "request_index", "roll_id", "die", "source", "rule_ref",
            "reason", "request_id",
        }:
            raise _error("invalid_command_payload", base, "invalid sanity reward contract")
        if payload.get("die") != "1D6":
            raise _error("invalid_command_payload", f"{base}.die", "sanity reward die must be 1D6")
        for field in ("source", "rule_ref"):
            if not isinstance(payload.get(field), str) or not payload[field].strip():
                raise _error("invalid_command_payload", f"{base}.{field}", "field is required")
    if kind in CHASE_COMMAND_KINDS:
        chase_payload_keys = {
            "chase_start": {"decision_id", "chase_id", "participants", "locations"},
            "chase_move": {"decision_id", "revision", "actor_id", "action_id"},
            "chase_hazard": {"decision_id", "revision", "actor_id", "action_id"},
            "chase_barrier": {"decision_id", "revision", "actor_id", "action_id", "method"},
            "chase_conflict": {"decision_id", "revision", "actor_id", "action_id", "target_actor_id", "combat_command_id"},
            "chase_end": {"decision_id", "chase_id", "revision", "outcome"},
        }
        optional_keys = {
            "chase_move": {"choice_id"},
            "chase_hazard": {"skill", "target", "difficulty", "roll_id"},
            "chase_barrier": {"choice_id", "skill", "target", "difficulty", "roll_id"},
        }.get(kind, set())
        optional_keys |= {"request_index", "reason"}
        if not chase_payload_keys[kind] <= set(payload) or set(payload) - chase_payload_keys[kind] - optional_keys:
            raise _error("invalid_command_payload", base, f"expected exact {kind} payload contract")
        if kind == "chase_start":
            if not isinstance(payload.get("chase_id"), str) or not _SAFE_ID.fullmatch(payload["chase_id"]):
                raise _error("invalid_command_payload", f"{base}.chase_id", "chase_id must be a stable ID")
            participants = payload.get("participants")
            participant_keys = {
                "actor_id", "side", "mov", "dex", "con", "hp", "fight",
                "dodge", "build", "current_position", "conditions",
            }
            if not isinstance(participants, list) or len(participants) < 2:
                raise _error("invalid_command_payload", f"{base}.participants", "chase requires at least two participants")
            actor_ids: set[str] = set()
            for offset, participant in enumerate(participants):
                ppath = f"{base}.participants[{offset}]"
                if not isinstance(participant, dict) or set(participant) != participant_keys:
                    raise _error("invalid_command_payload", ppath, "invalid chase participant contract")
                actor_id = participant.get("actor_id")
                if not isinstance(actor_id, str) or not _SAFE_ID.fullmatch(actor_id) or actor_id in actor_ids:
                    raise _error("invalid_command_payload", f"{ppath}.actor_id", "actor ID must be unique and safe")
                actor_ids.add(actor_id)
                if participant.get("side") not in {"quarry", "pursuer"}:
                    raise _error("invalid_command_payload", f"{ppath}.side", "side must be quarry or pursuer")
                for field in ("mov", "dex", "con", "hp", "fight", "dodge", "build", "current_position"):
                    value = participant.get(field)
                    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
                        raise _error("invalid_command_payload", f"{ppath}.{field}", "expected non-negative integer")
                if not isinstance(participant.get("conditions"), list) or any(
                    value not in coc_combat.VALID_CONDITIONS for value in participant["conditions"]
                ):
                    raise _error("invalid_command_payload", f"{ppath}.conditions", "invalid conditions")
            locations = payload.get("locations")
            if not isinstance(locations, list) or len(locations) < 2 or any(
                not isinstance(location, dict) or not isinstance(location.get("label"), str)
                for location in locations
            ):
                raise _error("invalid_command_payload", f"{base}.locations", "chase requires structured locations")
            location_required = {"label", "hazard", "barrier"}
            location_optional = {"kind", "route_id", "notes"}
            hazard_keys = {"hazard_id", "skill", "target", "difficulty", "damage_dice",
                           "collision_severity", "from_wreck", "from_debris", "sudden"}
            barrier_keys = {"barrier_id", "hp", "hp_max", "skill", "target", "difficulty",
                            "damage_dice", "description"}
            for offset, location in enumerate(locations):
                lpath = f"{base}.locations[{offset}]"
                if not location_required <= set(location) or set(location) - location_required - location_optional:
                    raise _error("invalid_command_payload", lpath, "invalid exact chase location contract")
                hazard = location["hazard"]
                if hazard is not None:
                    if (not isinstance(hazard, dict) or not {"hazard_id", "skill", "target"} <= set(hazard)
                            or set(hazard) - hazard_keys):
                        raise _error("invalid_command_payload", f"{lpath}.hazard", "invalid exact hazard contract")
                    if (not isinstance(hazard["hazard_id"], str) or not _SAFE_ID.fullmatch(hazard["hazard_id"])
                            or not isinstance(hazard["skill"], str) or not hazard["skill"]
                            or isinstance(hazard["target"], bool) or not isinstance(hazard["target"], int)
                            or not 0 <= hazard["target"] <= 100
                            or hazard.get("difficulty", "regular") not in {"regular", "hard", "extreme"}):
                        raise _error("invalid_command_payload", f"{lpath}.hazard", "invalid exact hazard values")
                barrier = location["barrier"]
                if barrier is not None:
                    if (not isinstance(barrier, dict)
                            or not {"barrier_id", "hp", "hp_max", "skill", "target"} <= set(barrier)
                            or set(barrier) - barrier_keys):
                        raise _error("invalid_command_payload", f"{lpath}.barrier", "invalid exact barrier contract")
                    if (not isinstance(barrier["barrier_id"], str) or not _SAFE_ID.fullmatch(barrier["barrier_id"])
                            or any(isinstance(barrier[key], bool) or not isinstance(barrier[key], int)
                                   or barrier[key] < 0 for key in ("hp", "hp_max", "target"))
                            or barrier["hp"] > barrier["hp_max"] or barrier["target"] > 100
                            or not isinstance(barrier["skill"], str) or not barrier["skill"]
                            or barrier.get("difficulty", "regular") not in {"regular", "hard", "extreme"}):
                        raise _error("invalid_command_payload", f"{lpath}.barrier", "invalid exact barrier values")
        else:
            revision = payload.get("revision")
            if isinstance(revision, bool) or not isinstance(revision, int) or revision < 0:
                raise _error("invalid_command_payload", f"{base}.revision", "chase continuation requires a non-negative revision")
        if kind in {"chase_move", "chase_hazard", "chase_barrier", "chase_conflict"}:
            for field in ("actor_id", "action_id"):
                if not isinstance(payload.get(field), str) or not _SAFE_ID.fullmatch(payload[field]):
                    raise _error("invalid_command_payload", f"{base}.{field}", "stable actor/action ID required")
        if kind == "chase_barrier" and payload.get("method") not in {"negotiate", "break"}:
            raise _error("invalid_command_payload", f"{base}.method", "barrier method must be negotiate or break")
        if kind == "chase_conflict":
            for field in ("target_actor_id", "combat_command_id"):
                if not isinstance(payload.get(field), str) or not _SAFE_ID.fullmatch(payload[field]):
                    raise _error("invalid_command_payload", f"{base}.{field}", "stable conflict evidence ID required")
        if kind == "chase_end" and payload.get("outcome") not in {"escaped", "captured", "concluded"}:
            raise _error("invalid_command_payload", f"{base}.outcome", "invalid chase outcome")
        if kind == "chase_end" and (
            not isinstance(payload.get("chase_id"), str) or not _SAFE_ID.fullmatch(payload["chase_id"])
        ):
            raise _error("invalid_command_payload", f"{base}.chase_id", "chase_id must be a stable ID")
    if "bonus_penalty_dice" in payload:
        modifier = payload["bonus_penalty_dice"]
        if (
            isinstance(modifier, bool)
            or not isinstance(modifier, int)
            or modifier < -2
            or modifier > 2
        ):
            raise _error(
                "invalid_command_payload",
                f"{base}.bonus_penalty_dice",
                "bonus_penalty_dice must be an integer from -2 through 2",
            )
    if command["kind"] == "sanity_check" and "san_loss_fail_expr" in payload:
        expression = payload.get("san_loss_fail_expr")
        if not isinstance(expression, str):
            raise _error(
                "invalid_command_payload",
                f"{base}.san_loss_fail_expr",
                "san_loss_fail_expr must be a string",
            )
        try:
            coc_sanity.validate_san_loss_expression(expression)
        except ValueError as exc:
            raise _error(
                "invalid_command_payload",
                f"{base}.san_loss_fail_expr",
                str(exc),
            ) from exc
    if command["kind"] == "sanity_check" and "san_loss_success" in payload:
        loss = payload.get("san_loss_success", 0)
        if (
            isinstance(loss, bool)
            or not isinstance(loss, int)
            or loss < 0
            or loss > coc_sanity.SAN_LOSS_MAX_TOTAL
        ):
            raise _error(
                "invalid_command_payload",
                f"{base}.san_loss_success",
                "san_loss_success must be a bounded non-negative integer",
            )
    if command["kind"] == "sanity_check":
        if "alone" in payload and not isinstance(payload["alone"], bool):
            raise _error("invalid_command_payload", f"{base}.alone", "alone must be a boolean")
        if (
            "involuntary_kind" in payload
            and payload["involuntary_kind"] is not None
            and payload["involuntary_kind"] not in coc_sanity.INVOLUNTARY_KINDS
        ):
            raise _error(
                "invalid_command_payload",
                f"{base}.involuntary_kind",
                "involuntary_kind must be an explicit supported enum",
            )
        if "involuntary_summary" in payload and not isinstance(payload["involuntary_summary"], str):
            raise _error(
                "invalid_command_payload",
                f"{base}.involuntary_summary",
                "involuntary_summary must be a string",
            )
        if (
            "creature_type" in payload
            and payload["creature_type"] is not None
            and (
                not isinstance(payload["creature_type"], str)
                or not payload["creature_type"].strip()
            )
        ):
            raise _error(
                "invalid_command_payload",
                f"{base}.creature_type",
                "creature_type must be a non-empty structured ID",
            )
        if "module_bout_override" in payload:
            override = payload["module_bout_override"]
            if not isinstance(override, dict):
                raise _error(
                    "invalid_command_payload",
                    f"{base}.module_bout_override",
                    "module_bout_override must be an object",
                )
            if (
                "force_mode" in override
                and override.get("force_mode") not in coc_sanity.BOUT_MODES
            ):
                raise _error(
                    "invalid_command_payload",
                    f"{base}.module_bout_override.force_mode",
                    "force_mode must be real_time or summary",
                )
            if "result_description" in override and not isinstance(
                override["result_description"], str
            ):
                raise _error(
                    "invalid_command_payload",
                    f"{base}.module_bout_override.result_description",
                    "result_description must be a string",
                )
    if command["kind"] == "push_offer":
        original_id = payload.get("original_command_id")
        continuation_id = payload.get("continuation_id")
        if continuation_id is not None and (
            not isinstance(continuation_id, str) or not _SAFE_ID.fullmatch(continuation_id)
        ):
            raise _error(
                "invalid_command_payload",
                f"{base}.continuation_id",
                "continuation_id must be an opaque persisted capability",
            )
        if original_id is not None and (
            not isinstance(original_id, str) or not _SAFE_ID.fullmatch(original_id)
        ):
            raise _error(
                "invalid_command_payload",
                f"{base}.original_command_id",
                "legacy original_command_id must be a stable audit ID",
            )
        if continuation_id is None and original_id is None:
            raise _error(
                "invalid_command_payload",
                f"{base}.continuation_id",
                "push offer requires a continuation capability",
            )
        changed = payload.get("changed_method_evidence")
        if not isinstance(changed, dict) or set(changed) != {
            "changed", "source", "summary",
        }:
            raise _error(
                "invalid_command_payload",
                f"{base}.changed_method_evidence",
                "expected exactly changed, source, and summary",
            )
        if changed.get("changed") is not True:
            raise _error(
                "invalid_command_payload",
                f"{base}.changed_method_evidence.changed",
                "a push must use a genuinely changed method",
            )
        if changed.get("source") not in CHANGED_METHOD_SOURCES:
            raise _error(
                "invalid_command_payload",
                f"{base}.changed_method_evidence.source",
                "source must be a supported structured enum",
            )
        if not isinstance(changed.get("summary"), str) or not changed["summary"].strip():
            raise _error(
                "invalid_command_payload",
                f"{base}.changed_method_evidence.summary",
                "summary must be non-empty",
            )
        consequence = payload.get("announced_consequence")
        if (
            not isinstance(consequence, dict)
            or not {"summary"} <= set(consequence)
            or set(consequence) - {"summary", "effect", "localized_summaries"}
            or not isinstance(consequence.get("summary"), str)
            or not consequence["summary"].strip()
        ):
            raise _error(
                "invalid_command_payload",
                f"{base}.announced_consequence.summary",
                "Keeper-owned announced consequence requires a non-empty summary",
            )
        localized_summaries = consequence.get("localized_summaries")
        if localized_summaries is not None and (
            not isinstance(localized_summaries, dict)
            or any(
                not isinstance(language, str) or not language.strip()
                or not isinstance(summary, str) or not summary.strip()
                for language, summary in localized_summaries.items()
            )
        ):
            raise _error(
                "invalid_command_payload",
                f"{base}.announced_consequence.localized_summaries",
                "localized summaries must map locale IDs to non-empty text",
            )
        effect = consequence.get("effect")
        if effect is not None:
            if not isinstance(effect, dict) or effect.get("kind") not in {
                "fictional_position", "pressure_tick", "condition", "route_closed",
            }:
                raise _error(
                    "invalid_command_payload",
                    f"{base}.announced_consequence.effect",
                    "effect must use a supported structured kind",
                )
            kind = effect.get("kind")
            valid = (
                kind == "fictional_position"
                and set(effect) in ({"kind"}, {"kind", "severity"})
                and (
                    "severity" not in effect
                    or effect.get("severity") in {"minor", "serious", "critical"}
                )
            ) or (
                kind == "pressure_tick"
                and set(effect) == {"kind", "clock_id", "ticks"}
                and isinstance(effect.get("clock_id"), str)
                and bool(_SAFE_ID.fullmatch(effect["clock_id"]))
                and isinstance(effect.get("ticks"), int)
                and not isinstance(effect.get("ticks"), bool)
                and 1 <= effect["ticks"] <= 4
            ) or (
                kind == "condition"
                and set(effect) == {"kind", "condition_id"}
                and isinstance(effect.get("condition_id"), str)
                and bool(_SAFE_ID.fullmatch(effect["condition_id"]))
            ) or (
                kind == "route_closed"
                and set(effect) == {"kind", "route_id"}
                and isinstance(effect.get("route_id"), str)
                and bool(_SAFE_ID.fullmatch(effect["route_id"]))
            )
            if not valid:
                raise _error(
                    "invalid_command_payload",
                    f"{base}.announced_consequence.effect",
                    "effect does not match its exact typed payload contract",
                )
        source_time_profile = payload.get("source_time_profile")
        if not _is_exact_source_time_profile(source_time_profile):
            raise _error(
                "invalid_command_payload",
                f"{base}.source_time_profile",
                "source_time_profile must be null or an exact structured route time profile",
            )
        supplied_context = payload.get("resolution_context")
        if supplied_context is not None and not isinstance(supplied_context, dict):
            raise _error(
                "invalid_command_payload",
                f"{base}.resolution_context",
                "resolution_context must be an object when supplied",
            )
    if command["kind"] in {"push_confirm", "push_resolve"}:
        choice_id = payload.get("choice_id")
        if not isinstance(choice_id, str) or not _SAFE_ID.fullmatch(choice_id):
            raise _error(
                "invalid_command_payload",
                f"{base}.choice_id",
                "choice_id must be a stable ID",
            )
        if payload.get("responder") != "player":
            raise _error(
                "invalid_command_payload",
                f"{base}.responder",
                "push lifecycle responder must be player",
            )
        revision = payload.get("revision")
        if isinstance(revision, bool) or not isinstance(revision, int) or revision < 0:
            raise _error(
                "invalid_command_payload",
                f"{base}.revision",
                "revision must be a non-negative integer",
            )
        if payload.get("action") not in {"confirm", "cancel"}:
            raise _error(
                "invalid_command_payload",
                f"{base}.action",
                "push action must be confirm or cancel",
            )
        terminal_ids = payload.get("terminal_command_ids")
        if (
            not isinstance(terminal_ids, list)
            or not terminal_ids
            or not all(isinstance(item, str) and _SAFE_ID.fullmatch(item) for item in terminal_ids)
        ):
            raise _error(
                "invalid_command_payload",
                f"{base}.terminal_command_ids",
                "terminal command IDs must be stable IDs",
            )
        if command["kind"] == "push_resolve":
            continuation_id = payload.get("continuation_id")
            if not isinstance(continuation_id, str) or not _SAFE_ID.fullmatch(continuation_id):
                raise _error(
                    "invalid_command_payload",
                    f"{base}.continuation_id",
                    "push resolve requires the opaque continuation capability",
                )
    if command["kind"] in BOUT_COMMAND_KINDS:
        choice_id = payload.get("choice_id")
        if not isinstance(choice_id, str) or not _SAFE_ID.fullmatch(choice_id):
            raise _error("invalid_command_payload", f"{base}.choice_id", "choice_id must be a stable ID")
        if payload.get("responder") != "keeper":
            raise _error("invalid_command_payload", f"{base}.responder", "bout responder must be keeper")
        revision = payload.get("revision")
        if isinstance(revision, bool) or not isinstance(revision, int) or revision < 0:
            raise _error("invalid_command_payload", f"{base}.revision", "revision must be a non-negative integer")
        expected_action = "tick" if command["kind"] == "bout_tick" else "end"
        if payload.get("action") != expected_action:
            raise _error("invalid_command_payload", f"{base}.action", f"{command['kind']} requires action {expected_action}")
        terminal_ids = payload.get("terminal_command_ids")
        if not isinstance(terminal_ids, list) or terminal_ids != [command["command_id"]]:
            raise _error("invalid_command_payload", f"{base}.terminal_command_ids", "bout action must name its sole canonical command ID")


def _validate_batch(commands: Any) -> list[dict[str, Any]]:
    if not isinstance(commands, list):
        raise _error("invalid_command_batch", "commands", "commands must be a JSON array")
    validated: list[dict[str, Any]] = []
    seen: set[str] = set()
    for index, raw in enumerate(commands):
        command = _validate_command(raw, index)
        command_id = command["command_id"]
        if command_id in seen:
            raise _error(
                "duplicate_command_id",
                f"commands[{index}].command_id",
                f"duplicate command_id {command_id!r} in one batch",
            )
        seen.add(command_id)
        _validate_payload_fields(command, index)
        validated.append(command)
    return validated


def _load_character(character_path: Path, investigator_id: str) -> dict[str, Any]:
    try:
        character = json.loads(Path(character_path).read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise _error("malformed_character", "character_path", str(exc)) from exc
    if not isinstance(character, dict):
        raise _error("malformed_character", "character_path", "character root must be an object")
    character_id = character.get("id")
    if not isinstance(character_id, str) or not _SAFE_ID.fullmatch(character_id):
        raise _error(
            "malformed_character",
            "character_path.id",
            "character id must be a stable safe ID",
        )
    if character_id != investigator_id:
        raise _error(
            "character_identity_mismatch",
            "character_path.id",
            f"character id {character_id!r} does not match investigator {investigator_id!r}",
        )
    for field in ("skills", "characteristics", "derived"):
        value = character.get(field, {})
        if value is not None and not isinstance(value, dict):
            raise _error("malformed_character", f"character_path.{field}", "must be an object")
    return character


def _preflight_rule_targets(
    commands: list[dict[str, Any]],
    state: dict[str, Any],
    character: dict[str, Any] | None,
) -> None:
    if character is None:
        return
    applied = set(state["applied_command_ids"])
    for index, command in enumerate(commands):
        if command["command_id"] in applied or command["kind"] not in ROLL_COMMAND_KINDS:
            continue
        try:
            _target_for_payload(character, command["kind"], command["payload"])
        except (TypeError, ValueError) as exc:
            raise _error(
                "invalid_command_payload",
                f"commands[{index}].payload",
                f"roll target is not an integer: {exc}",
            ) from exc


def _preflight_sanity_state(
    campaign_dir: Path,
    commands: list[dict[str, Any]],
    applied: set[str],
    character: dict[str, Any] | None,
    investigator_id: str,
) -> None:
    needs_sanity = any(
        command["command_id"] not in applied
        and (
            command["kind"] in BOUT_COMMAND_KINDS | REWARD_COMMAND_KINDS
            or (
                command["kind"] == "sanity_check"
                and "san_loss_fail_expr" in command["payload"]
            )
        )
        for command in commands
    )
    if not needs_sanity:
        return
    assert character is not None
    canonical_sanity = coc_sanity.sanity_snapshot_path(
        Path(campaign_dir), investigator_id
    )
    legacy_sanity = coc_sanity.legacy_sanity_snapshot_path(Path(campaign_dir))
    sanity_source = (
        canonical_sanity if canonical_sanity.is_file() else legacy_sanity
    )
    sanity_relative = sanity_source.relative_to(Path(campaign_dir)).as_posix()
    try:
        characteristics = (
            character.get("characteristics")
            if isinstance(character.get("characteristics"), dict)
            else {}
        )
        skills = character.get("skills") if isinstance(character.get("skills"), dict) else {}
        coc_sanity.SanitySession.load(
            Path(campaign_dir),
            investigator_id,
            int_value=int(characteristics.get("INT", 50)),
            rng=random.Random(0),
            cm_value=int(skills.get("Cthulhu Mythos", 0)),
            migrate_legacy=False,
        )
    except coc_sanity.SanityStateIdentityError as exc:
        raise _error(
            "malformed_sanity_state",
            f"{sanity_relative}.investigator_id",
            str(exc),
        ) from exc
    except Exception as exc:
        raise _error("malformed_sanity_state", sanity_relative, str(exc)) from exc

    investigator_relative = f"save/investigator-state/{investigator_id}.json"
    investigator_path = Path(campaign_dir) / investigator_relative
    if not investigator_path.exists():
        return
    try:
        investigator = json.loads(investigator_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise _error("malformed_investigator_state", investigator_relative, str(exc)) from exc
    if not isinstance(investigator, dict):
        raise _error(
            "malformed_investigator_state",
            investigator_relative,
            "root must be an object",
        )
    if investigator.get("investigator_id") != investigator_id:
        raise _error(
            "malformed_investigator_state",
            f"{investigator_relative}.investigator_id",
            "persisted investigator_id does not match requested investigator",
        )
    current_san = investigator.get("current_san")
    if current_san is not None and (isinstance(current_san, bool) or not isinstance(current_san, int)):
        raise _error(
            "malformed_investigator_state",
            f"{investigator_relative}.current_san",
            "current_san must be an integer",
        )


def _resume_ids(choice_id: str, revision: int, action: str) -> dict[str, str]:
    material = json.dumps(
        {"choice_id": choice_id, "revision": revision, "action": action},
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    digest = hashlib.sha256(material).hexdigest()
    return {
        "decision_id": f"resume-{digest[:32]}",
        "confirm_command_id": f"resume:{digest}:confirm",
        "resolve_command_id": f"resume:{digest}:resolve",
    }


def _compile_push_continuation_binding(
    context: dict[str, Any], campaign_dir: Path | str | None
) -> dict[str, Any]:
    """Load already-compiled authority; never reconstruct it at confirmation."""
    capsule = _validate_push_capsule(
        context.get("continuation_capsule"),
        campaign_dir=campaign_dir,
        investigator_id=str(context.get("investigator_id") or ""),
        character_id=str(context.get("character_id") or ""),
    )
    source = capsule["source_evidence"]
    if (
        source.get("origin_command_id") != context.get("origin_command_id")
        or source.get("roll_id") != (context.get("original_roll") or {}).get("roll_id")
    ):
        raise _error(
            "push_continuation_unbound",
            "pending_choice_response",
            "continuation capsule is detached from its immutable roll evidence",
        )
    transaction = capsule["settlement"].get("route_transaction")
    return {
        "schema_version": 2,
        "mode": "continuation_capsule",
        "continuation_id": capsule["continuation_id"],
        "authority_revision": capsule["authority_revision"],
        "request_id": capsule["settlement"]["request_id"],
        "scene_id": source.get("scene_id"),
        "route_id": (
            transaction.get("route_id") if isinstance(transaction, dict) else None
        ),
        "route_transaction_sha256": (
            _canonical_json_hash(transaction)
            if isinstance(transaction, dict)
            else None
        ),
        "idempotency_key": capsule["idempotency"]["key"],
    }


def _push_resume_plan_from_state(
    state: dict[str, Any],
    campaign_dir: Path | str | None,
    investigator_id: str,
    response: Any,
) -> dict[str, Any]:
    if not isinstance(response, dict):
        raise _error(
            "invalid_pending_choice_response",
            "pending_choice_response",
            "response must be an object",
        )
    choice_id = response.get("choice_id")
    if not isinstance(choice_id, str) or not _SAFE_ID.fullmatch(choice_id):
        raise _error(
            "pending_choice_not_found",
            "pending_choice_response.choice_id",
            "choice_id does not identify a canonical pending choice",
        )
    active_context = state["pending_contexts"].get(choice_id)
    historical_context = state["choice_history"].get(choice_id)
    context = active_context or historical_context
    if not isinstance(context, dict):
        raise _error(
            "pending_choice_not_found",
            "pending_choice_response.choice_id",
            "choice is neither active nor an exact replayable history entry",
        )
    offer_id = context["offer_command_id"]
    public_choice = state["result_snapshots"][offer_id]["pending_choice"]
    if context.get("investigator_id") != investigator_id:
        raise _error(
            "wrong_pending_choice_responder",
            "pending_choice_response.responder",
            "choice belongs to a different investigator",
        )
    responder = response.get("responder")
    if responder != public_choice.get("responder"):
        raise _error(
            "wrong_pending_choice_responder",
            "pending_choice_response.responder",
            "response does not match the canonical choice responder",
        )
    revision = response.get("revision")
    if revision != public_choice.get("revision"):
        raise _error(
            "stale_pending_choice_response",
            "pending_choice_response.revision",
            "response revision is stale or ahead of the canonical choice",
        )
    action = response.get("action")
    allowed_actions = {
        str(option.get("action"))
        for option in public_choice.get("options") or []
        if isinstance(option, dict) and option.get("action")
    }
    if action not in allowed_actions:
        raise _error(
            "invalid_pending_choice_action",
            "pending_choice_response.action",
            "action is not one of the canonical choice options",
        )
    required_keys = {"choice_id", "responder", "revision", "action"}
    changed_method = (
        _json_copy(context["changed_method_evidence"])
        if action == "confirm"
        else None
    )
    if set(response) != required_keys:
        raise _error(
            "invalid_pending_choice_response",
            "pending_choice_response",
            "response contains missing or unsupported fields",
        )
    if historical_context is not None:
        if (
            historical_context.get("terminal_action") != action
            or historical_context.get("terminal_revision") != revision
            or not _json_deep_equal(
                historical_context.get("response_changed_method_evidence"),
                changed_method,
            )
        ):
            raise _error(
                "stale_pending_choice_response",
                "pending_choice_response",
                "choice was already consumed by a different response",
            )

    continuation_binding = _compile_push_continuation_binding(context, campaign_dir)
    capsule = context["continuation_capsule"]
    settlement = capsule["settlement"]

    ids = _resume_ids(choice_id, int(revision), str(action))
    terminal_ids = [ids["confirm_command_id"]]
    if action == "confirm":
        terminal_ids.append(ids["resolve_command_id"])
    common: dict[str, Any] = {
        "choice_id": choice_id,
        "responder": responder,
        "revision": revision,
        "action": action,
        "terminal_command_ids": terminal_ids,
    }
    rules_requests: list[dict[str, Any]] = [{
        "command_id": ids["confirm_command_id"],
        "kind": "push_confirm",
        **_json_copy(common),
    }]
    if action == "confirm":
        resolve_request = {
            "command_id": ids["resolve_command_id"],
            "kind": "push_resolve",
            **_json_copy(common),
            "confirm_command_id": ids["confirm_command_id"],
            "continuation_id": continuation_binding["continuation_id"],
            "request_id": settlement["request_id"],
        }
        if isinstance(settlement.get("route_resolution"), dict):
            resolve_request["route_resolution"] = _json_copy(settlement["route_resolution"])
        rules_requests.append(resolve_request)
    resolution = _json_copy(settlement["plan_slice"])
    plan: dict[str, Any] = {
        "decision_id": ids["decision_id"],
        "scene_action": str(resolution.get("scene_action") or "SUBSYSTEM"),
        "rules_requests": rules_requests,
        "clue_policy": _json_copy(resolution.get("clue_policy") or {}),
        "narrative_directives": _json_copy(
            resolution.get("narrative_directives") or {}
        ),
        "rule_signals": _json_copy(resolution.get("rule_signals") or {}),
        "pressure_moves": [],
        "memory_writes": [],
        "push_continuation": {
            "choice_id": choice_id,
            "action": action,
            "revision": revision,
            "announced_consequence": _json_copy(context["announced_consequence"]),
            "binding": continuation_binding,
            "sealed_route_transaction": _json_copy(
                settlement.get("route_transaction")
            ),
        },
    }
    if isinstance(resolution.get("turn_input"), dict):
        plan["turn_input"] = _json_copy(resolution["turn_input"])
    if action == "confirm" and isinstance(
        settlement.get("route_transaction"), dict
    ):
        plan["flags_set"] = _json_copy(
            settlement["route_transaction"].get("sets_flags") or []
        )
    if action == "confirm" and isinstance(context.get("source_time_profile"), dict):
        plan["time_advance"] = {
            **_json_copy(context["source_time_profile"]),
            "confidence": 1.0,
            "reason": "confirmed pushed attempt consumes the source route time",
            "idempotency_key": f"push-time:{choice_id}:{revision}",
        }
    return plan


def _bout_resume_plan_from_state(
    state: dict[str, Any],
    investigator_id: str,
    response: Any,
) -> dict[str, Any]:
    if not isinstance(response, dict):
        raise _error("invalid_pending_choice_response", "pending_choice_response", "response must be an object")
    choice_id = response.get("choice_id")
    if not isinstance(choice_id, str) or not _SAFE_ID.fullmatch(choice_id):
        raise _error("pending_choice_not_found", "pending_choice_response.choice_id", "choice_id does not identify a canonical pending choice")
    active = state["pending_contexts"].get(choice_id)
    historical = state["choice_history"].get(choice_id)
    context = active or historical
    if not isinstance(context, dict) or context.get("kind") != "bout_keeper_action":
        raise _error("pending_choice_not_found", "pending_choice_response.choice_id", "choice is not a Keeper bout action")
    public_choice = (
        state["pending_choices"].get(choice_id)
        if active is not None
        else historical.get("public_choice")
    )
    if context.get("investigator_id") != investigator_id:
        raise _error("wrong_pending_choice_responder", "pending_choice_response.responder", "choice belongs to another investigator")
    if response.get("responder") != public_choice.get("responder"):
        raise _error("wrong_pending_choice_responder", "pending_choice_response.responder", "response does not match the canonical choice responder")
    revision = response.get("revision")
    if revision != public_choice.get("revision"):
        raise _error("stale_pending_choice_response", "pending_choice_response.revision", "response revision is stale or ahead")
    action = response.get("action")
    if action not in {"tick", "end"}:
        raise _error("invalid_pending_choice_action", "pending_choice_response.action", "bout action must be tick or end")
    if set(response) != {"choice_id", "responder", "revision", "action"}:
        raise _error("invalid_pending_choice_response", "pending_choice_response", "response contains missing or unsupported fields")
    if historical is not None and (
        historical.get("terminal_action") != action
        or historical.get("terminal_revision") != revision
    ):
        raise _error("stale_pending_choice_response", "pending_choice_response", "choice was already consumed by another action")
    ids = _resume_ids(choice_id, int(revision), str(action))
    command_id = ids["confirm_command_id"]
    kind = "bout_tick" if action == "tick" else "bout_end"
    return {
        "decision_id": ids["decision_id"],
        "scene_action": "SUBSYSTEM",
        "rules_requests": [{
            "command_id": command_id,
            "kind": kind,
            "choice_id": choice_id,
            "responder": "keeper",
            "revision": revision,
            "action": action,
            "terminal_command_ids": [command_id],
        }],
        "clue_policy": {},
        "narrative_directives": {},
        "rule_signals": {},
        "pressure_moves": [],
        "memory_writes": [],
        "bout_continuation": {
            "choice_id": choice_id,
            "bout_id": context["bout_id"],
            "revision": revision,
            "action": action,
        },
    }


def _chase_resume_plan_from_state(
    state: dict[str, Any], investigator_id: str, response: Any,
) -> dict[str, Any]:
    if not isinstance(response, dict) or set(response) != {"choice_id", "responder", "revision", "action"}:
        raise _error("invalid_pending_choice_response", "pending_choice_response", "invalid chase response contract")
    choice_id = response.get("choice_id")
    active = state["pending_contexts"].get(choice_id) if isinstance(choice_id, str) else None
    historical = state["choice_history"].get(choice_id) if isinstance(choice_id, str) else None
    context = active or historical
    if not isinstance(context, dict) or context.get("kind") != "chase_action":
        raise _error("pending_choice_not_found", "pending_choice_response.choice_id", "choice is not a chase action")
    choice = state["pending_choices"].get(choice_id) if active is not None else historical.get("public_choice")
    if context.get("investigator_id") != investigator_id or response.get("responder") != "player":
        raise _error("wrong_pending_choice_responder", "pending_choice_response.responder", "choice belongs to another actor")
    if response.get("revision") != choice.get("revision"):
        raise _error("stale_pending_choice_response", "pending_choice_response.revision", "chase choice revision is stale")
    action = response.get("action")
    allowed = {option["action"] for option in choice.get("options") or [] if isinstance(option, dict)}
    if action not in allowed:
        raise _error("invalid_pending_choice_action", "pending_choice_response.action", "unknown chase action")
    if historical is not None and (
        historical.get("terminal_action") != action
        or historical.get("terminal_revision") != response.get("revision")
    ):
        raise _error("stale_pending_choice_response", "pending_choice_response", "choice was consumed differently")
    ids = _resume_ids(choice_id, int(response["revision"]), str(action))
    command_id = ids["confirm_command_id"]
    actor_id = context["actor_id"]
    if str(action).startswith("barrier:"):
        parts = str(action).split(":")
        if len(parts) != 3 or parts[2] not in {"negotiate", "break"}:
            raise _error("invalid_pending_choice_action", "pending_choice_response.action", "invalid barrier action")
        kind = "chase_barrier"
        request = {
            "command_id": command_id, "kind": kind, "revision": context["revision"],
            "actor_id": actor_id, "action_id": action, "method": parts[2],
            "choice_id": choice_id,
        }
    else:
        kind = "chase_move"
        request = {
            "command_id": command_id, "kind": kind, "revision": context["revision"],
            "actor_id": actor_id, "action_id": action, "choice_id": choice_id,
        }
    return {
        "decision_id": ids["decision_id"], "scene_action": "SUBSYSTEM",
        "rules_requests": [request], "clue_policy": {}, "narrative_directives": {},
        "rule_signals": {}, "pressure_moves": [], "memory_writes": [],
        "chase_continuation": {"choice_id": choice_id, "action": action},
    }


def _pending_resume_plan_from_state(
    state: dict[str, Any], campaign_dir: Path | str | None, investigator_id: str, response: Any
) -> dict[str, Any]:
    choice_id = response.get("choice_id") if isinstance(response, dict) else None
    context = (
        state["pending_contexts"].get(choice_id)
        or state["choice_history"].get(choice_id)
        if isinstance(choice_id, str)
        else None
    )
    if isinstance(context, dict) and context.get("kind") == "bout_keeper_action":
        return _bout_resume_plan_from_state(state, investigator_id, response)
    if isinstance(context, dict) and context.get("kind") == "chase_action":
        return _chase_resume_plan_from_state(state, investigator_id, response)
    return _push_resume_plan_from_state(state, campaign_dir, investigator_id, response)


def plan_from_pending_choice_response(
    campaign_dir: Path | str,
    investigator_id: str,
    response: dict[str, Any],
) -> dict[str, Any]:
    """Compile a typed response into the sole canonical resume plan."""
    if not isinstance(investigator_id, str) or not _SAFE_ID.fullmatch(investigator_id):
        raise _error(
            "invalid_investigator_id",
            "investigator_id",
            "expected a stable safe ID",
        )
    campaign = Path(campaign_dir)
    if not isinstance(response, dict):
        raise _error(
            "invalid_pending_choice_response",
            "pending_choice_response",
            "response must be an object",
        )
    state = _load_state(campaign)
    # Validate against the pre-transaction canonical indexes before recovery.
    # A malformed/stale response must never authorize preimage restoration or
    # log truncation merely by being presented to this read/compile boundary.
    candidate = _pending_resume_plan_from_state(state, campaign, investigator_id, response)
    recovered = _recover_inflight(campaign, state)
    _validate_external_result_receipts(campaign, recovered)
    resolved = _pending_resume_plan_from_state(recovered, campaign, investigator_id, response)
    if not _json_deep_equal(candidate, resolved):
        raise _error(
            "pending_choice_changed_during_recovery",
            "pending_choice_response",
            "canonical pending choice changed during inflight recovery",
        )
    return resolved


def commands_from_rules_requests(plan: dict[str, Any]) -> list[dict[str, Any]]:
    """Adapt supported legacy Director ``rules_requests`` into strict commands."""
    requests = plan.get("rules_requests") or []
    if not isinstance(requests, list):
        raise _error("invalid_legacy_rules_requests", "plan.rules_requests", "must be a list")
    decision_id = str(plan.get("decision_id") or "turn")
    commands: list[dict[str, Any]] = []
    for index, request in enumerate(requests, start=1):
        if not isinstance(request, dict):
            continue
        kind = request.get("kind")
        if kind not in SUPPORTED_COMMAND_KINDS:
            # Preserve the legacy wrapper's behavior for non-rules annotations
            # such as npc_assist; strict direct executor calls still reject them.
            continue
        explicit_command_id = request.get("command_id")
        command_id = (
            str(explicit_command_id)
            if explicit_command_id is not None
            else f"{decision_id}-rule-{index}"
        )
        payload = {
            key: _json_copy(value)
            for key, value in request.items()
            if key not in {"kind", "command_id", "phase"}
        }
        payload.setdefault("decision_id", plan.get("decision_id"))
        if kind in RNG_CONSUMING_COMMAND_KINDS or (
            kind == "combat_start"
            and any(
                isinstance(item, dict) and isinstance(item.get("armor_dice"), str)
                for item in request.get("preparations", []) or []
            )
        ):
            payload.setdefault("roll_id", command_id)
        payload.setdefault("request_index", index)
        commands.append({
            "command_id": command_id,
            "kind": kind,
            "phase": EXPECTED_PHASE[kind],
            "payload": payload,
        })
    return commands


def flatten_result_events(results: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """Return legacy flat rule rows from normalized subsystem results."""
    events: list[dict[str, Any]] = []
    for result in results or []:
        if not isinstance(result, dict):
            continue
        for event in result.get("events") or []:
            if isinstance(event, dict):
                events.append(_json_copy(event))
    return events


def _looks_like_result_envelope(row: Any) -> bool:
    if not isinstance(row, dict):
        return False
    keys = set(row)
    envelope_only = {"status", "events", "pending_choice", "state_refs"}
    if keys & {"events", "pending_choice", "state_refs"}:
        return True
    if "command_id" in keys and "status" in keys:
        return True
    return len(keys & RESULT_KEYS) >= 3 and bool(keys & envelope_only)


def normalize_rule_results(
    results: list[dict[str, Any]] | None,
    *,
    campaign_dir: Path | str | None = None,
    expected_commands: list[dict[str, Any]] | None = None,
    investigator_id: str | None = None,
    decision_id: str | None = None,
    results_mode: str = "legacy",
) -> list[dict[str, Any]]:
    """Return legacy rows, unwrapping only plan-bound executor envelopes."""
    rows = list(results or [])
    exact_envelopes = [
        isinstance(row, dict) and set(row) == RESULT_KEYS
        for row in rows
    ]
    if results_mode not in {"legacy", "normalized"}:
        raise _error(
            "invalid_rule_results_mode",
            "rules_results_mode",
            "expected legacy or normalized",
        )
    if results_mode == "normalized" and not all(exact_envelopes):
        invalid_index = next(
            index for index, exact in enumerate(exact_envelopes) if not exact
        )
        raise _error(
            "untrusted_subsystem_result",
            f"rules_results[{invalid_index}]",
            "normalized mode requires complete subsystem result envelopes",
        )
    if results_mode == "normalized":
        if (
            campaign_dir is None
            or expected_commands is None
            or not isinstance(investigator_id, str)
            or not _SAFE_ID.fullmatch(investigator_id)
            or (
                decision_id is not None
                and (not isinstance(decision_id, str) or not _SAFE_ID.fullmatch(decision_id))
            )
        ):
            raise _error(
                "untrusted_subsystem_result",
                "rules_results",
                "campaign, expected commands, investigator, and decision binding are required",
            )
        try:
            expected = _validate_batch(expected_commands)
        except SubsystemExecutorError as exc:
            raise _error(
                "untrusted_subsystem_result",
                "rules_results",
                f"expected command contract is invalid: {exc}",
            ) from exc
        supplied_ids: set[str] = set()
        for index, row in enumerate(rows):
            assert isinstance(row, dict)
            supplied_id = row.get("command_id")
            if not isinstance(supplied_id, str) or supplied_id in supplied_ids:
                raise _error(
                    "untrusted_subsystem_result",
                    f"rules_results[{index}]",
                    "normalized results must contain unique persisted command IDs",
                )
            supplied_ids.add(supplied_id)
        if len(rows) != len(expected):
            raise _error(
                "untrusted_subsystem_result",
                (
                    f"rules_results[{len(expected)}]"
                    if len(rows) > len(expected)
                    else "rules_results"
                ),
                "normalized results must exactly cover current expected commands",
            )
        campaign = Path(campaign_dir)
        state = _load_state(campaign)
        for index, (row, expected_command) in enumerate(zip(rows, expected)):
            assert isinstance(row, dict)
            command_id = row.get("command_id")
            assert isinstance(command_id, str)
            if command_id != expected_command["command_id"]:
                raise _error(
                    "untrusted_subsystem_result",
                    f"rules_results[{index}]",
                    "normalized result order/command ID does not match the current plan",
                )
            if state["command_hashes"].get(command_id) != _canonical_command_hash(
                expected_command
            ):
                raise _error(
                    "untrusted_subsystem_result",
                    f"rules_results[{index}]",
                    "persisted command content does not match the current plan",
                )
            expected_provenance = {
                "investigator_id": investigator_id,
                "character_id": (
                    investigator_id
                    if expected_command["kind"] in CHARACTER_REQUIRED_COMMAND_KINDS
                    else None
                ),
                "decision_id": decision_id,
            }
            if not _json_deep_equal(
                state["command_provenance"].get(command_id),
                expected_provenance,
            ):
                raise _error(
                    "untrusted_subsystem_result",
                    f"rules_results[{index}]",
                    "persisted result provenance does not match current actor/decision",
                )
            snapshot = state["result_snapshots"].get(command_id)
            if not _json_deep_equal(snapshot, row):
                raise _error(
                    "untrusted_subsystem_result",
                    f"rules_results[{index}]",
                    "normalized result does not match a persisted executor snapshot",
                )
        recovered = _recover_inflight(campaign, state)
        _validate_external_result_receipts(campaign, recovered)
        return flatten_result_events(rows)
    # Legacy mode is an explicit compatibility path for already-flat rows.
    # Envelope containers are never reinterpreted as legacy data.
    for index, row in enumerate(rows):
        if _looks_like_result_envelope(row):
            raise _error(
                "untrusted_subsystem_result",
                f"rules_results[{index}]",
                "partial or mixed subsystem result envelopes are not trusted",
            )
    # Legacy apply_plan callers observe in-place push-gate demotion. Preserve
    # their row identity; only persisted normalized snapshots are unwrapped as
    # defensive copies above.
    return [row for row in rows if isinstance(row, dict)]


def current_pending_choice(results: list[dict[str, Any]] | None) -> dict[str, Any] | None:
    for result in reversed(results or []):
        if isinstance(result, dict) and isinstance(result.get("pending_choice"), dict):
            return _json_copy(result["pending_choice"])
    return None


def get_current_pending_choices(
    campaign_dir: Path | str,
) -> list[dict[str, Any]]:
    """Read unresolved choices from the validated canonical executor state."""
    campaign = Path(campaign_dir)
    state = _recover_inflight(campaign, _load_state(campaign))
    _validate_external_result_receipts(campaign, state)
    return [_json_copy(choice) for choice in state["pending_choices"].values()]


def get_current_pending_choice(
    campaign_dir: Path | str,
) -> dict[str, Any] | None:
    """Return the sole canonical unresolved choice, if one exists."""
    choices = get_current_pending_choices(campaign_dir)
    if not choices:
        return None
    if len(choices) > 1:
        raise _error(
            "ambiguous_pending_choice",
            "save/subsystem-state.json#pending_choices",
            "multiple unresolved subsystem choices require an explicit selector",
        )
    return choices[0]


def _target_for_payload(character: dict[str, Any], kind: str, payload: dict[str, Any]) -> int:
    skill = str(payload.get("skill", ""))
    skills = character.get("skills") if isinstance(character.get("skills"), dict) else {}
    characteristics = (
        character.get("characteristics")
        if isinstance(character.get("characteristics"), dict)
        else {}
    )
    if skill in skills:
        return int(skills[skill])
    if skill in characteristics:
        return int(characteristics[skill])
    if kind == "sanity_check":
        derived = character.get("derived") if isinstance(character.get("derived"), dict) else {}
        return int(derived.get("SAN", characteristics.get("POW", 50)))
    return 50


def _settle_sanity_check(
    campaign_dir: Path,
    character: dict[str, Any],
    investigator_id: str,
    payload: dict[str, Any],
    rng: random.Random,
) -> dict[str, Any]:
    characteristics = (
        character.get("characteristics")
        if isinstance(character.get("characteristics"), dict)
        else {}
    )
    int_value = int(characteristics.get("INT", 50))
    derived = character.get("derived") if isinstance(character.get("derived"), dict) else {}
    skills = character.get("skills") if isinstance(character.get("skills"), dict) else {}
    cm_value = int(skills.get("Cthulhu Mythos", 0))
    had_snapshot = coc_sanity.sanity_snapshot_exists(
        Path(campaign_dir), investigator_id
    )
    session = coc_sanity.SanitySession.load(
        Path(campaign_dir),
        investigator_id,
        int_value=int_value,
        rng=rng,
        cm_value=cm_value,
    )
    if not had_snapshot:
        sheet_san = int(derived.get("SAN", characteristics.get("POW", 50)))
        session.san_max = sheet_san
        session.san_current = sheet_san
        session.day_start_san = sheet_san

    event_start = len(session.events)
    source = str(payload.get("source") or payload.get("reason") or "encountering the unnatural")
    creature_type = payload.get("creature_type")
    event = session.sanity_check(
        source=source,
        san_loss_success=int(payload.get("san_loss_success", 0)),
        san_loss_fail_expr=str(payload.get("san_loss_fail_expr", "1")),
        involuntary_kind=payload.get("involuntary_kind"),
        involuntary_summary=str(payload.get("involuntary_summary") or ""),
        alone=bool(payload.get("alone", False)),
        module_bout_override=_json_copy(payload.get("module_bout_override")),
        creature_type=creature_type if isinstance(creature_type, str) else None,
    )
    event_payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
    san_roll = next(
        (
            row
            for row in reversed(session.pending_rolls)
            if isinstance(row, dict) and row.get("skill") == "SAN"
        ),
        {},
    )
    session.save(Path(campaign_dir), strict_mirror=True)
    san_before = int(event_payload.get("san_before", san_roll.get("san_before", session.san_current)))
    san_loss = int(event_payload.get("san_loss", san_roll.get("san_loss", 0)))
    san_after = int(event_payload.get("san_after", session.san_current))
    outcome = str(event_payload.get("roll_outcome") or san_roll.get("outcome") or "regular")
    session_events: list[dict[str, Any]] = []
    for row in session.events[event_start:]:
        if not isinstance(row, dict):
            continue
        raw_payload = row.get("payload")
        normalized_payload = (
            _json_copy(raw_payload)
            if isinstance(raw_payload, dict)
            else {"summary": str(raw_payload or "")}
        )
        session_events.append({
            "event_id": row.get("event_id"),
            **normalized_payload,
            "event_type": row.get("type"),
        })
    return {
        "san_before": san_before,
        "san_loss": san_loss,
        "san_after": san_after,
        "outcome": outcome,
        "roll": san_roll.get("roll", 0),
        "bout_triggered": bool(session.bout_active or session.temporary_insane),
        "source": source,
        "san_trigger_id": payload.get("san_trigger_id"),
        "session_events": session_events,
        "bout_active": bool(session.bout_active),
        "active_bout_id": session.active_bout_id,
        "bout_rounds_remaining": int(session.bout_rounds_remaining),
    }


def _settle_percentile_fumble_contract(
    contract_value: Any,
    outcome: Any,
    *,
    path: str,
) -> tuple[Any, dict[str, Any] | None]:
    """Make every percentile fumble non-pushable and project typed effects."""
    contract = _json_copy(contract_value)
    if not isinstance(contract, dict):
        if outcome != "fumble":
            return contract, None
        return {
            "schema_version": 1,
            "push_policy": {
                "eligible": False,
                "requires_changed_method": False,
                "keeper_must_foreshadow_failure": False,
            },
        }, None
    authored_fumble = contract.get("fumble_consequence")
    effect = (
        authored_fumble.get("effect")
        if isinstance(authored_fumble, dict)
        else None
    )
    valid_effect = (
        isinstance(effect, dict)
        and (
            effect.get("kind") == "fictional_position"
            and set(effect) in ({"kind"}, {"kind", "severity"})
            and (
                "severity" not in effect
                or effect.get("severity") in {"minor", "serious", "critical"}
            )
            or effect.get("kind") == "pressure_tick"
            and set(effect) == {"kind", "clock_id", "ticks"}
            and isinstance(effect.get("clock_id"), str)
            and bool(_SAFE_ID.fullmatch(effect["clock_id"]))
            and isinstance(effect.get("ticks"), int)
            and not isinstance(effect.get("ticks"), bool)
            and 1 <= effect["ticks"] <= 4
            or effect.get("kind") == "condition"
            and set(effect) == {"kind", "condition_id"}
            and isinstance(effect.get("condition_id"), str)
            and bool(_SAFE_ID.fullmatch(effect["condition_id"]))
            or effect.get("kind") == "route_closed"
            and set(effect) == {"kind", "route_id"}
            and isinstance(effect.get("route_id"), str)
            and bool(_SAFE_ID.fullmatch(effect["route_id"]))
        )
    )
    valid_consequence = (
        isinstance(authored_fumble, dict)
        and {"summary", "effect"} <= set(authored_fumble)
        and not set(authored_fumble) - {
            "summary", "effect", "localized_summaries", "source_binding"
        }
        and isinstance(authored_fumble.get("summary"), str)
        and bool(authored_fumble["summary"].strip())
        and isinstance(authored_fumble.get("localized_summaries", {}), dict)
        and all(
            isinstance(language, str) and language.strip()
            and isinstance(summary, str) and summary.strip()
            for language, summary in authored_fumble.get("localized_summaries", {}).items()
        )
        and valid_effect
    )
    source_binding = (
        authored_fumble.get("source_binding")
        if isinstance(authored_fumble, dict)
        else None
    )
    if source_binding is not None:
        valid_consequence = bool(
            valid_consequence
            and isinstance(source_binding, dict)
            and set(source_binding) == {
                "schema_version", "kind", "clue_id", "route_ids"
            }
            and source_binding.get("schema_version") == 1
            and source_binding.get("kind") == "generated_obscured_clue_gate"
            and isinstance(source_binding.get("clue_id"), str)
            and bool(source_binding["clue_id"].strip())
            and isinstance(source_binding.get("route_ids"), list)
            and all(
                isinstance(route_id, str) and bool(_SAFE_ID.fullmatch(route_id))
                for route_id in source_binding["route_ids"]
            )
        )
    if contract.get("generated_clue_gate") is True and source_binding is None:
        valid_consequence = False
    required = (
        contract.get("authored_roll_gate") is True
        or contract.get("authored_clue_bonus") is True
        or contract.get("generated_clue_gate") is True
    )
    if required and not valid_consequence:
        raise _error(
            "invalid_authored_fumble_consequence",
            f"{path}.fumble_consequence",
            "authored roll contract requires an exact typed fumble consequence",
        )
    if outcome != "fumble":
        return contract, None
    contract["push_policy"] = {
        "eligible": False,
        "requires_changed_method": False,
        "keeper_must_foreshadow_failure": False,
    }
    return contract, (_json_copy(authored_fumble) if valid_consequence else None)


def _roll_result(
    campaign_dir: Path,
    character: dict[str, Any],
    investigator_id: str,
    command: dict[str, Any],
    rng: random.Random,
) -> dict[str, Any]:
    kind = command["kind"]
    payload = command["payload"]
    target = _target_for_payload(character, kind, payload)
    difficulty = str(payload.get("difficulty", "regular"))
    bonus_penalty = int(payload.get("bonus_penalty_dice", 0) or 0)
    bonus = max(0, bonus_penalty)
    penalty = max(0, -bonus_penalty)
    decision_id = payload.get("decision_id")
    roll_id = str(payload.get("roll_id") or command["command_id"])

    if kind == "sanity_check" and "san_loss_fail_expr" in payload:
        settled = _settle_sanity_check(
            campaign_dir,
            character,
            investigator_id,
            payload,
            rng,
        )
        return {
            "roll_id": roll_id,
            "decision_id": decision_id,
            "kind": "sanity_check",
            "skill": "SAN",
            "target": settled["san_before"],
            "difficulty": "regular",
            "reason": payload.get("reason"),
            "bonus_penalty_dice": 0,
            "roll": settled["roll"],
            "effective_target": settled["san_before"],
            "outcome": settled["outcome"],
            "success": settled["outcome"] in SUCCESS_OUTCOMES,
            "san_loss": settled["san_loss"],
            "san_before": settled["san_before"],
            "san_after": settled["san_after"],
            "bout_triggered": settled["bout_triggered"],
            "source": settled["source"],
            "san_trigger_id": settled["san_trigger_id"],
            "roll_contract": payload.get("roll_contract"),
            "resolution_context": _json_copy(payload.get("resolution_context") or {}),
            "_session_events": settled["session_events"],
            "_bout_state": {
                "active": settled["bout_active"],
                "bout_id": settled["active_bout_id"],
                "remaining_rounds": settled["bout_rounds_remaining"],
            },
        }

    if kind == "idea_roll":
        characteristics = (
            character.get("characteristics")
            if isinstance(character.get("characteristics"), dict)
            else {}
        )
        int_value = int(characteristics.get("INT", target if target else 50))
        roll = coc_roll.idea_roll(
            int_value,
            difficulty=difficulty,
            bonus=bonus,
            penalty=penalty,
            rng=rng,
        )
        contract, fumble_consequence = _settle_percentile_fumble_contract(
            payload.get("roll_contract"),
            roll.get("outcome"),
            path=f"commands.{command['command_id']}.payload.roll_contract",
        )
        result = {
            "roll_id": roll_id,
            "decision_id": decision_id,
            "kind": "idea_roll",
            "skill": "INT",
            "target": roll.get("target", int_value),
            "difficulty": difficulty,
            "reason": payload.get("reason"),
            "request_id": payload.get("request_id"),
            "signpost_level": payload.get("signpost_level"),
            "missed_clue_id": payload.get("missed_clue_id"),
            "bonus_penalty_dice": bonus_penalty,
            "roll": roll.get("roll"),
            "effective_target": roll.get("effective_target"),
            "outcome": roll.get("outcome"),
            "success": roll.get("outcome") in SUCCESS_OUTCOMES,
            "roll_contract": contract,
            "resolution_context": _json_copy(payload.get("resolution_context") or {}),
            "roll_kind": "idea",
            "characteristic": "INT",
        }
        if fumble_consequence is not None:
            result["fumble_consequence"] = fumble_consequence
        return result

    roll = coc_roll.percentile_check(
        target,
        difficulty=difficulty,
        bonus=bonus,
        penalty=penalty,
        rng=rng,
    )
    outcome = roll.get("outcome")
    contract, fumble_consequence = _settle_percentile_fumble_contract(
        payload.get("roll_contract"),
        outcome,
        path=f"commands.{command['command_id']}.payload.roll_contract",
    )
    result = {
        "roll_id": roll_id,
        "decision_id": decision_id,
        "kind": kind,
        "skill": payload.get("skill"),
        "target": target,
        "difficulty": difficulty,
        "reason": payload.get("reason"),
        "request_id": payload.get("request_id"),
        "depends_on": payload.get("depends_on"),
        "stakes": payload.get("stakes"),
        "opposed_by": payload.get("opposed_by"),
        "opposed_skill": payload.get("opposed_skill"),
        "bonus_penalty_dice": bonus_penalty,
        "roll": roll.get("roll"),
        "effective_target": roll.get("effective_target"),
        "outcome": outcome,
        "success": outcome in SUCCESS_OUTCOMES,
        "roll_contract": contract,
        "resolution_context": _json_copy(payload.get("resolution_context") or {}),
    }
    if fumble_consequence is not None:
        result["fumble_consequence"] = fumble_consequence
    return result


def _investigator_state(campaign_dir: Path, investigator_id: str) -> dict[str, Any]:
    path = campaign_dir / "save" / "investigator-state" / f"{investigator_id}.json"
    try:
        value = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise _error("malformed_investigator_state", path.as_posix(), str(exc)) from exc
    if not isinstance(value, dict):
        raise _error("malformed_investigator_state", path.as_posix(), "state must be an object")
    return value


def _sync_investigator_from_combat(
    campaign_dir: Path,
    investigator_id: str,
    session: Any,
) -> None:
    participant = session.participants.get(investigator_id)
    if not isinstance(participant, dict):
        return
    state = _investigator_state(campaign_dir, investigator_id)
    state["current_hp"] = int(participant["hp_current"])
    projected_conditions = list(participant.get("conditions") or [])
    if session.status != "active":
        projected_conditions = [
            condition
            for condition in projected_conditions
            if condition not in TRANSIENT_COMBAT_CONDITIONS
        ]
    state["conditions"] = projected_conditions
    had_wound_ledger = "wound_ledger" in state
    ledger = state.get("wound_ledger")
    if ledger is None:
        ledger = []
    if not isinstance(ledger, list):
        raise _error("malformed_wound_ledger", "save/investigator-state", "wound ledger must be a list")
    known_sources = {
        row.get("source_damage_roll_id") for row in ledger if isinstance(row, dict)
    }
    elapsed = _read_authoritative_elapsed_minutes(campaign_dir)
    for damage in session.damage_chain:
        source_damage_id = (
            damage.get("damage_roll_id")
            if isinstance(damage, dict) and isinstance(damage.get("damage_roll_id"), str)
            else None
        )
        if (
            not isinstance(damage, dict)
            or damage.get("target_actor_id") != investigator_id
            or source_damage_id is None
            or source_damage_id in known_sources
        ):
            continue
        landed = int(damage.get("raw_damage", 0)) - int(damage.get("armor_absorbed", 0))
        if landed <= 0:
            continue
        normalized_damage_id = source_damage_id.replace(":", "-")
        ledger.append({
            "wound_id": f"wound-{normalized_damage_id}",
            "source_damage_roll_id": source_damage_id,
            "occurred_elapsed_minutes": elapsed,
            "status": "active",
        })
        known_sources.add(source_damage_id)
    if had_wound_ledger or ledger:
        state["wound_ledger"] = ledger
    path = campaign_dir / "save" / "investigator-state" / f"{investigator_id}.json"
    coc_fileio.write_json_atomic(
        path, state, indent=2, ensure_ascii=False, trailing_newline=True
    )
    persisted = _investigator_state(campaign_dir, investigator_id)
    if (
        persisted.get("current_hp") != participant["hp_current"]
        or persisted.get("conditions") != projected_conditions
    ):
        raise _error("combat_mirror_failed", path.as_posix(), "combat/investigator mirror diverged")


def _clear_inactive_combat_conditions(
    campaign_dir: Path,
    investigator_id: str,
) -> list[str]:
    """Remove combat-position markers once no active combat owns them."""
    combat_path = campaign_dir / "save" / "combat.json"
    if combat_path.exists():
        session = _load_combat_session(
            campaign_dir, rng=random.Random(0), investigator_id=investigator_id,
        )
        if session.status == "active":
            return []
    state = _investigator_state(campaign_dir, investigator_id)
    conditions = list(state.get("conditions") or [])
    cleared = [
        condition
        for condition in conditions
        if condition in TRANSIENT_COMBAT_CONDITIONS
    ]
    if not cleared:
        return []
    state["conditions"] = [
        condition for condition in conditions
        if condition not in TRANSIENT_COMBAT_CONDITIONS
    ]
    path = campaign_dir / "save" / "investigator-state" / f"{investigator_id}.json"
    coc_fileio.write_json_atomic(
        path, state, indent=2, ensure_ascii=False, trailing_newline=True
    )
    return cleared


def _combat_actor_eligible(participant: dict[str, Any]) -> bool:
    conditions = participant.get("conditions") or []
    return (
        participant.get("hp_current", 0) > 0
        and not any(value in conditions for value in ("dead", "dying", "unconscious", "fled"))
    )


def _normalize_combat_cursor(session: Any) -> None:
    """Advance explicit initiative without modulo wrap; start a new round once."""
    while session.initiative_cursor < len(session._current_initiative):
        actor_id = session._current_initiative[session.initiative_cursor]["actor_id"]
        if _combat_actor_eligible(session.participants[actor_id]):
            return
        session.mark_current_initiative_skipped()
        session.initiative_cursor += 1
    session.begin_round()


def _read_authoritative_elapsed_minutes(campaign_dir: Path) -> int:
    path = campaign_dir / "save" / "time-state.json"
    if not path.exists():
        return 0
    try:
        state = json.loads(path.read_text(encoding="utf-8"))
        value = (state.get("clock") or {}).get("elapsed_minutes", 0)
    except (OSError, UnicodeError, json.JSONDecodeError, AttributeError) as exc:
        raise _error("malformed_time_state", "save/time-state.json", str(exc)) from exc
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise _error("malformed_time_state", "save/time-state.json", "elapsed_minutes must be non-negative")
    return value


def _authoritative_treatment_scope(
    campaign_dir: Path,
    investigator_id: str,
    payload: dict[str, Any],
) -> tuple[str, str, bool]:
    """Derive, and optionally verify, treatment scope from trusted state."""
    state = _investigator_state(campaign_dir, investigator_id)
    elapsed = _read_authoritative_elapsed_minutes(campaign_dir)
    current_day = elapsed // 1440
    ledger = state.get("wound_ledger")
    if ledger is None:
        # Explicit one-time migration for campaigns predating the wound ledger.
        # The caller cannot select this ID; it is minted from trusted identity
        # and current authoritative clock.
        ledger = [{
            "wound_id": f"wound-legacy-{investigator_id}",
            "source_damage_roll_id": None,
            "occurred_elapsed_minutes": elapsed,
            "status": "active",
        }]
    if not isinstance(ledger, list) or not ledger:
        raise _error("malformed_wound_ledger", "save/investigator-state", "wound ledger must be non-empty")
    active: list[dict[str, Any]] = []
    for index, row in enumerate(ledger):
        if (
            not isinstance(row, dict)
            or set(row) != {"wound_id", "source_damage_roll_id", "occurred_elapsed_minutes", "status"}
            or not isinstance(row.get("wound_id"), str)
            or not _SAFE_ID.fullmatch(row["wound_id"])
            or (row.get("source_damage_roll_id") is not None and not isinstance(row.get("source_damage_roll_id"), str))
            or isinstance(row.get("occurred_elapsed_minutes"), bool)
            or not isinstance(row.get("occurred_elapsed_minutes"), int)
            or row["occurred_elapsed_minutes"] < 0
            or row.get("status") not in {"active", "healed"}
        ):
            raise _error("malformed_wound_ledger", f"save/investigator-state.wound_ledger[{index}]", "invalid wound record")
        if row["status"] == "active":
            active.append(row)
    if not active:
        raise _error("no_active_wound", "save/investigator-state.wound_ledger", "treatment requires an active wound")
    wound = max(active, key=lambda row: (row["occurred_elapsed_minutes"], row["wound_id"]))
    wound_id = wound["wound_id"]
    day_id = f"day-{current_day}"
    if payload.get("wound_id") is not None and payload["wound_id"] != wound_id:
        raise _error("treatment_scope_mismatch", "commands[0].payload.wound_id", "external wound ID does not match authoritative treatment scope")
    if payload.get("day_id") is not None and payload["day_id"] != day_id:
        raise _error("treatment_scope_mismatch", "commands[0].payload.day_id", "external day ID does not match authoritative treatment scope")
    return wound_id, day_id, wound["occurred_elapsed_minutes"] // 1440 == current_day


def _persist_legacy_wound_ledger_if_needed(
    campaign_dir: Path,
    investigator_id: str,
) -> None:
    state = _investigator_state(campaign_dir, investigator_id)
    if state.get("wound_ledger") is not None:
        return
    elapsed = _read_authoritative_elapsed_minutes(campaign_dir)
    state["wound_ledger"] = [{
        "wound_id": f"wound-legacy-{investigator_id}",
        "source_damage_roll_id": None,
        "occurred_elapsed_minutes": elapsed,
        "status": "active",
    }]
    path = campaign_dir / "save" / "investigator-state" / f"{investigator_id}.json"
    coc_fileio.write_json_atomic(path, state, indent=2, ensure_ascii=False, trailing_newline=True)


def _authoritative_major_wound_recovery_scope(
    campaign_dir: Path,
    investigator_id: str,
) -> tuple[str, int, int]:
    """Return the active wound and its due interval from trusted save state.

    Major-wound recovery is a weekly rule, not a caller-selected delay.  The
    consumer therefore derives both the wound and elapsed interval from the
    canonical wound/time ledgers and rejects an early reroll.
    """
    state = _investigator_state(campaign_dir, investigator_id)
    if "major_wound" not in (state.get("conditions") or []):
        raise _error(
            "major_wound_not_active",
            "save/investigator-state.conditions",
            "weekly recovery requires an active major_wound condition",
        )
    if not isinstance(state.get("wound_ledger"), list) or not state["wound_ledger"]:
        raise _error(
            "major_wound_recovery_migration_required",
            "save/investigator-state.wound_ledger",
            "weekly recovery requires a canonical wound ledger",
        )
    wound_id, _day_id, _same_day = _authoritative_treatment_scope(
        campaign_dir, investigator_id, {}
    )
    wound_rows = state.get("wound_ledger") or []
    wound = next(
        row
        for row in wound_rows
        if isinstance(row, dict) and row.get("wound_id") == wound_id
    )
    baseline = int(wound["occurred_elapsed_minutes"])
    recovery_rows = state.get("major_wound_recovery_ledger") or []
    if not isinstance(recovery_rows, list):
        raise _error(
            "malformed_major_wound_recovery_ledger",
            "save/investigator-state.major_wound_recovery_ledger",
            "recovery ledger must be a list",
        )
    for index, row in enumerate(recovery_rows):
        if (
            not isinstance(row, dict)
            or set(row) != {
                "command_id", "wound_id", "attempt_elapsed_minutes",
                "outcome", "medical_care_outcome",
            }
            or not isinstance(row.get("command_id"), str)
            or not _SAFE_ID.fullmatch(row["command_id"])
            or not isinstance(row.get("wound_id"), str)
            or not _SAFE_ID.fullmatch(row["wound_id"])
            or isinstance(row.get("attempt_elapsed_minutes"), bool)
            or not isinstance(row.get("attempt_elapsed_minutes"), int)
            or row["attempt_elapsed_minutes"] < 0
            or (
                row.get("outcome") is not None
                and not isinstance(row.get("outcome"), str)
            )
            or (
                row.get("medical_care_outcome") is not None
                and not isinstance(row.get("medical_care_outcome"), str)
            )
        ):
            raise _error(
                "malformed_major_wound_recovery_ledger",
                f"save/investigator-state.major_wound_recovery_ledger[{index}]",
                "invalid recovery attempt record",
            )
        if row["wound_id"] == wound_id:
            baseline = max(baseline, row["attempt_elapsed_minutes"])
    elapsed = _read_authoritative_elapsed_minutes(campaign_dir)
    weekly_minutes = 7 * 24 * 60
    if elapsed - baseline < weekly_minutes:
        remaining = weekly_minutes - (elapsed - baseline)
        raise _error(
            "weekly_recovery_not_due",
            "save/time-state.json.clock.elapsed_minutes",
            f"major-wound recovery is not due for another {remaining} game minute(s)",
        )
    return wound_id, baseline, elapsed


def _record_major_wound_recovery_attempt(
    campaign_dir: Path,
    investigator_id: str,
    *,
    command_id: str,
    wound_id: str,
    elapsed: int,
    outcome: Any,
    medical_care_outcome: Any,
) -> None:
    state = _investigator_state(campaign_dir, investigator_id)
    rows = state.get("major_wound_recovery_ledger") or []
    if not isinstance(rows, list):
        raise _error(
            "malformed_major_wound_recovery_ledger",
            "save/investigator-state.major_wound_recovery_ledger",
            "recovery ledger must be a list",
        )
    rows.append({
        "command_id": command_id,
        "wound_id": wound_id,
        "attempt_elapsed_minutes": elapsed,
        "outcome": outcome if isinstance(outcome, str) else None,
        "medical_care_outcome": (
            medical_care_outcome if isinstance(medical_care_outcome, str) else None
        ),
    })
    state["major_wound_recovery_ledger"] = rows
    if "major_wound" not in (state.get("conditions") or []):
        for wound in state.get("wound_ledger") or []:
            if isinstance(wound, dict) and wound.get("wound_id") == wound_id:
                wound["status"] = "healed"
    path = campaign_dir / "save" / "investigator-state" / f"{investigator_id}.json"
    coc_fileio.write_json_atomic(
        path, state, indent=2, ensure_ascii=False, trailing_newline=True
    )


def _latest_healing_result_reopens_pushed_first_aid(state: dict[str, Any]) -> bool:
    """Return whether the latest death-clock result opens another attempt.

    This also migrates runs produced before HealingSession persisted the
    reopened pushed-First-Aid window itself: the executor ledger remains the
    durable structured evidence that the patient survived a dying round or
    that temporary stabilization deteriorated.
    """
    snapshots = state.get("result_snapshots") or {}
    for command_id in reversed(state.get("applied_command_ids") or []):
        result = snapshots.get(command_id)
        if not isinstance(result, dict) or result.get("kind") not in {
            "dying_tick", "stabilize"
        }:
            continue
        if result.get("kind") != "dying_tick":
            return False
        primary = next(
            (
                event
                for event in result.get("events") or []
                if isinstance(event, dict)
                and event.get("event_type") in {
                    "dying_con_roll", "stabilized_con_roll"
                }
            ),
            None,
        )
        if not isinstance(primary, dict):
            return False
        if primary.get("event_type") == "stabilized_con_roll":
            return primary.get("deteriorated") is True
        return primary.get("died") is False
    return False


def _preflight_treatment_commands(
    campaign_dir: Path,
    investigator_id: str,
    commands: list[dict[str, Any]],
    applied: set[str],
    executor_state: dict[str, Any],
) -> None:
    seen_new: set[tuple[str, str, str, bool]] = set()
    weekly_wounds: set[str] = set()
    for index, command in enumerate(commands):
        if command["command_id"] in applied:
            continue
        if command["kind"] == "weekly_recovery":
            wound_id, _baseline, _elapsed = _authoritative_major_wound_recovery_scope(
                campaign_dir, investigator_id
            )
            if wound_id in weekly_wounds:
                raise _error(
                    "weekly_recovery_already_submitted",
                    f"commands[{index}]",
                    "a command batch may contain only one recovery attempt per wound",
                )
            weekly_wounds.add(wound_id)
            continue
        if command["kind"] != "stabilize":
            continue
        payload = command["payload"]
        wound_id, day_id, _same_day = _authoritative_treatment_scope(
            campaign_dir, investigator_id, payload
        )
        investigator_state = _investigator_state(campaign_dir, investigator_id)
        usage = (
            investigator_state.get("healing_usage")
            if isinstance(investigator_state.get("healing_usage"), dict)
            else {}
        )
        records = usage.get("records") if isinstance(usage.get("records"), dict) else {}
        flags = records.get(wound_id, {}).get(day_id, {}) if isinstance(records.get(wound_id), dict) else {}
        if (
            payload["method"] == "first_aid"
            and _latest_healing_result_reopens_pushed_first_aid(executor_state)
        ):
            flags = {
                **(flags if isinstance(flags, dict) else {}),
                "first_aid_push_used": False,
            }
        pushed = bool(payload.get("pushed", False))
        scope_key = (wound_id, day_id, payload["method"], pushed)
        regular_first_aid_key = (wound_id, day_id, "first_aid", False)
        if payload["method"] == "first_aid" and pushed:
            prior_attempt = (
                isinstance(flags, dict) and flags.get("first_aid_used") is True
            ) or regular_first_aid_key in seen_new
            if not prior_attempt:
                raise _error(
                    "push_without_origin",
                    f"commands[{index}].payload.pushed",
                    "pushed First Aid requires a prior First Aid attempt in the same wound/day scope",
                )
            already_used = (
                isinstance(flags, dict)
                and flags.get("first_aid_push_used") is True
            )
        else:
            flag = (
                "first_aid_used"
                if payload["method"] == "first_aid"
                else "medicine_used"
            )
            already_used = isinstance(flags, dict) and flags.get(flag) is True
        if already_used or scope_key in seen_new:
            raise _error(
                "treatment_already_used",
                f"commands[{index}].payload.method",
                (
                    "pushed first_aid"
                    if payload["method"] == "first_aid" and pushed
                    else payload["method"]
                )
                + " already used for authoritative wound/day scope",
            )
        seen_new.add(scope_key)


def _healing_roll_evidence(
    command_id: str,
    payload: dict[str, Any],
    event: dict[str, Any],
) -> dict[str, Any] | None:
    roll = event.get("roll")
    if isinstance(roll, bool) or not isinstance(roll, int):
        return None
    target = event.get("target")
    difficulty = str(event.get("difficulty") or "regular")
    bonus = int(event.get("bonus_dice") or 0)
    penalty = int(event.get("penalty_dice") or 0)
    return {
        "event_type": (
            "major_wound_recovery_roll"
            if event.get("event_type") == "major_wound_recovery"
            else "combat_rescue_roll"
        ),
        "roll_id": f"{command_id}:roll",
        "decision_id": payload.get("decision_id"),
        **(
            {"actor_id": payload["rescuer_id"]}
            if isinstance(payload.get("rescuer_id"), str)
            else {}
        ),
        "skill": event.get("skill") or "CON",
        "pushed": bool(payload.get("pushed", False)),
        **(
            {
                "changed_method": payload["changed_method"],
                "announced_consequence": {
                    "summary": payload["failure_consequence"]
                },
            }
            if payload.get("pushed") is True
            else {}
        ),
        "target": target,
        "difficulty": difficulty,
        "roll": roll,
        "outcome": event.get("outcome"),
        "bonus_penalty_dice": bonus - penalty,
        "bonus_dice": bonus,
        "penalty_dice": penalty,
        "dice": {"expression": "1D100", "raw": [roll], "total": roll},
        "source_command_id": command_id,
    }


def _weekly_care_roll_evidence(
    command_id: str,
    payload: dict[str, Any],
    event: dict[str, Any] | None,
) -> dict[str, Any] | None:
    if not isinstance(event, dict):
        return None
    roll = event.get("roll")
    target = event.get("target")
    if (
        isinstance(roll, bool)
        or not isinstance(roll, int)
        or isinstance(target, bool)
        or not isinstance(target, int)
    ):
        return None
    return {
        "event_type": "weekly_medical_care_roll",
        "roll_id": f"{command_id}:care",
        "decision_id": payload.get("decision_id"),
        "actor_id": payload["caregiver_id"],
        "skill": "Medicine",
        "target": target,
        "difficulty": "regular",
        "roll": roll,
        "outcome": event.get("outcome"),
        "bonus_penalty_dice": 0,
        "dice": {"expression": "1D100", "raw": [roll], "total": roll},
        "source_command_id": command_id,
    }


def _medicine_healing_evidence(
    command_id: str,
    payload: dict[str, Any],
    event: dict[str, Any],
) -> dict[str, Any] | None:
    dice = event.get("healing_dice")
    if not isinstance(dice, dict) or not re.fullmatch(
        r"[12]D3", str(dice.get("expression") or "")
    ):
        return None
    expression = str(dice["expression"])
    expected_count = int(expression.split("D", 1)[0])
    raw = dice.get("raw")
    total = dice.get("total")
    if (
        not isinstance(raw, list)
        or len(raw) != expected_count
        or any(isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 3 for value in raw)
        or isinstance(total, bool)
        or not isinstance(total, int)
        or total != sum(raw)
    ):
        raise _error(
            "invalid_healing_roll",
            "healing.healing_dice",
            "healing dice evidence is invalid",
        )
    return {
        "event_type": "combat_healing_roll",
        "roll_id": f"{command_id}:healing",
        "decision_id": payload.get("decision_id"),
        **(
            {"actor_id": payload["rescuer_id"]}
            if isinstance(payload.get("rescuer_id"), str)
            else {}
        ),
        "skill": "HP Healing",
        "target": None,
        "difficulty": "healing",
        "roll": total,
        "outcome": "healing_applied",
        "bonus_penalty_dice": 0,
        "dice": {"expression": expression, "raw": list(raw), "total": total},
        "source_command_id": command_id,
    }


def _healing_session(
    campaign_dir: Path,
    character: dict[str, Any],
    investigator_id: str,
    rng: random.Random,
):
    state = _investigator_state(campaign_dir, investigator_id)
    derived = character.get("derived") if isinstance(character.get("derived"), dict) else {}
    characteristics = (
        character.get("characteristics")
        if isinstance(character.get("characteristics"), dict)
        else {}
    )
    hp_max = int(
        state.get("max_hp")
        or state.get("hp_max")
        or derived.get("HP")
        or max(1, int(state.get("current_hp", 10) or 10))
    )
    return coc_healing.HealingSession.load(
        campaign_dir,
        investigator_id,
        hp_max=hp_max,
        con_value=int(characteristics.get("CON", 50)),
        rng=rng,
    )


def _sync_investigator_from_chase(
    campaign_dir: Path, investigator_id: str, session: Any,
) -> None:
    participant = session.participants.get(investigator_id)
    if not isinstance(participant, dict):
        return
    state = _investigator_state(campaign_dir, investigator_id)
    state["current_hp"] = int(participant.get("hp", state.get("current_hp", 0)))
    state["conditions"] = list(participant.get("conditions") or [])
    path = campaign_dir / "save" / "investigator-state" / f"{investigator_id}.json"
    coc_fileio.write_json_atomic(path, state, indent=2, ensure_ascii=False)
    persisted = _investigator_state(campaign_dir, investigator_id)
    if (persisted.get("current_hp") != participant.get("hp")
            or persisted.get("conditions") != participant.get("conditions", [])):
        raise _error("chase_mirror_failed", path.as_posix(), "chase/investigator mirror diverged")


def _sync_chase_from_investigator(
    campaign_dir: Path, investigator_id: str, session: Any,
) -> None:
    participant = session.participants.get(investigator_id)
    if not isinstance(participant, dict):
        return
    state = _investigator_state(campaign_dir, investigator_id)
    participant["hp"] = int(state.get("current_hp", participant.get("hp", 0)))
    participant["conditions"] = list(state.get("conditions") or [])


def _canonical_result_receipt(campaign_dir: Path, command_id: str) -> dict[str, Any]:
    records = _read_jsonl_records(
        campaign_dir / _RESULT_RECEIPT_LOG, label="canonical subsystem result ledger"
    )
    matches = [row for row in records if row.get("command_id") == command_id]
    if len(matches) != 1:
        raise _error("untrusted_combat_evidence", "commands[0].payload.combat_command_id", "combat result receipt is missing or ambiguous")
    return matches[0]


def _load_chase_session(
    campaign_dir: Path, rng: random.Random, executor_state: dict[str, Any],
) -> Any:
    path = campaign_dir / "save" / "chase.json"
    if not path.is_file():
        raise _error("chase_not_active", "save/chase.json", "no persisted chase exists")
    try:
        evidence = _validate_chase_genesis_ledger(
            campaign_dir, executor_state, load_snapshot=False,
        )
        if evidence is None:
            raise ValueError("chase genesis evidence is missing")
        return coc_chase.ChaseSession.load(
            path, rng=rng, genesis_evidence=evidence,
        )
    except (OSError, ValueError) as exc:
        raise _error("malformed_chase_state", "save/chase.json", str(exc)) from exc


def _dispatch_chase(
    campaign_dir: Path, investigator_id: str, command: dict[str, Any],
    rng: random.Random, executor_state: dict[str, Any],
) -> dict[str, Any]:
    command_id = command["command_id"]
    kind = command["kind"]
    payload = command["payload"]
    chase_path = campaign_dir / "save" / "chase.json"
    if kind == "chase_start":
        if chase_path.exists():
            existing = _load_chase_session(
                campaign_dir, random.Random(0), executor_state,
            )
            if existing.status == "active":
                raise _error("chase_already_active", "save/chase.json", "end the active chase first")
        session = coc_chase.ChaseSession(payload["chase_id"], rng=rng)
        investigator_state = _investigator_state(campaign_dir, investigator_id)
        for participant in payload["participants"]:
            if participant["actor_id"] == investigator_id:
                if int(investigator_state.get("current_hp", participant["hp"])) != participant["hp"]:
                    raise _error("chase_hp_mismatch", "commands[0].payload.participants", "investigator HP is not authoritative")
                if list(investigator_state.get("conditions") or []) != participant["conditions"]:
                    raise _error("chase_condition_mismatch", "commands[0].payload.participants", "investigator conditions are not authoritative")
            session.add_participant(
                participant["actor_id"], participant["side"], participant["mov"],
                participant["dex"], con=participant["con"], hp=participant["hp"],
                fight=participant["fight"], dodge=participant["dodge"],
                build=participant["build"], current_position=participant["current_position"],
                conditions=participant["conditions"],
            )
        session.set_location_chain(payload["locations"])
        session.begin_round()
        session.save(campaign_dir)
        event = {
            "event_type": "chase_started", "chase_id": session.chase_id,
            "revision": session.revision, "round": session._current_round,
            "initiative": list(session.rounds[-1]["dex_order"]),
            "source_command_id": command_id,
        }
    else:
        session = _load_chase_session(campaign_dir, rng, executor_state)
        _sync_chase_from_investigator(campaign_dir, investigator_id, session)
        if payload["revision"] != session.revision:
            raise _error("stale_chase_revision", "commands[0].payload.revision", "chase revision is stale")
        if kind == "chase_end" and payload["chase_id"] != session.chase_id:
            raise _error("chase_id_mismatch", "commands[0].payload.chase_id", "chase end targets another chase")
        if session.status != "active":
            raise _error("chase_not_active", "save/chase.json", "chase is already concluded")
        choice_id = payload.get("choice_id")
        history_ref = None
        if isinstance(choice_id, str):
            choice = executor_state["pending_choices"].pop(choice_id, None)
            context = executor_state["pending_contexts"].pop(choice_id, None)
            if (
                not isinstance(choice, dict) or not isinstance(context, dict)
                or context.get("kind") != "chase_action"
                or context.get("actor_id") != payload.get("actor_id")
                or context.get("revision") != payload.get("revision")
                or payload.get("action_id") not in {
                    option.get("action") for option in choice.get("options") or []
                    if isinstance(option, dict)
                }
            ):
                raise _error("invalid_pending_resolution_batch", "commands[0]", "chase choice does not match the command")
            executor_state["choice_history"][choice_id] = {
                **_json_copy(context), "public_choice": _json_copy(choice),
                "terminal_action": payload["action_id"],
                "terminal_revision": choice["revision"],
                "terminal_command_ids": [command_id], "terminal_commands": [],
                "terminal_results": [], "terminal_result_receipt_hashes": [],
            }
            history_ref = f"save/subsystem-state.json#choice_history/{choice_id}"
        if kind == "chase_end":
            cancelled_choice_id = None
            for active_choice_id, active_context in list(executor_state["pending_contexts"].items()):
                if (isinstance(active_context, dict) and active_context.get("kind") == "chase_action"
                        and active_context.get("chase_id") == session.chase_id):
                    cancelled_choice_id = active_choice_id
                    context = executor_state["pending_contexts"].pop(active_choice_id)
                    choice = executor_state["pending_choices"].pop(active_choice_id)
                    executor_state["choice_history"][active_choice_id] = {
                        **_json_copy(context), "public_choice": _json_copy(choice),
                        "terminal_action": "cancelled_by_chase_end",
                        "terminal_revision": choice["revision"],
                        "terminal_command_ids": [command_id], "terminal_commands": [],
                        "terminal_results": [], "terminal_result_receipt_hashes": [],
                    }
                    history_ref = f"save/subsystem-state.json#choice_history/{active_choice_id}"
            session.conclude(payload["outcome"])
            event = {
                "event_type": "chase_ended", "chase_id": session.chase_id,
                "revision": session.revision, "outcome": session.outcome,
                "scenario_terminal": False, "source_command_id": command_id,
            }
            if cancelled_choice_id is not None:
                event["cancelled_choice_id"] = cancelled_choice_id
        else:
            actor_id = payload["actor_id"]
            if actor_id not in session.participants:
                raise _error("invalid_chase_actor", "commands[0].payload.actor_id", "actor is not in the chase")
            if kind == "chase_move" and payload["action_id"] == "choice:offer":
                nxt = session._next_location(session.participants[actor_id]["position"])
                barrier = nxt.get("barrier") if isinstance(nxt, dict) else None
                if not isinstance(barrier, dict) or int(barrier.get("hp", 0)) <= 0:
                    raise _error("no_multiple_chase_actions", "commands[0].payload.action_id", "current chase position has no multi-action choice")
                barrier_id = barrier.get("barrier_id")
                options = [
                    {"action": f"barrier:{barrier_id}:negotiate", "label": f"Negotiate {barrier_id}"},
                    {"action": f"barrier:{barrier_id}:break", "label": f"Break through {barrier_id}"},
                ]
                choice_id = _chase_choice_id(command_id)
                pending_choice = {
                    "choice_id": choice_id, "kind": "chase_action",
                    "command_id": command_id, "responder": "player", "revision": 0,
                    "prompt": "Choose a legal chase action.", "options": options,
                }
                executor_state["pending_contexts"][choice_id] = {
                    "choice_id": choice_id, "kind": "chase_action",
                    "investigator_id": investigator_id, "character_id": investigator_id,
                    "origin_command_id": command_id, "offer_command_id": command_id,
                    "revision": session.revision, "actor_id": actor_id,
                    "offer_command": _json_copy(command),
                    "chase_id": session.chase_id,
                    "action_context": {
                        "barrier": _json_copy(barrier),
                        "location_index": nxt.get("index"),
                    },
                }
                return {
                    "command_id": command_id, "kind": kind, "status": "pending_choice",
                    "events": [], "pending_choice": pending_choice,
                    "state_refs": [f"save/subsystem-state.json#pending_choices/{choice_id}",
                                   f"save/subsystem-state.json#pending_contexts/{choice_id}"],
                }
            if kind == "chase_move":
                if payload["action_id"] != "move:advance":
                    raise _error("untrusted_chase_action", "commands[0].payload.action_id", "unknown move action ID")
                nxt = session._next_location(session.participants[actor_id]["position"])
                if isinstance(nxt, dict) and (nxt.get("hazard") or (nxt.get("barrier") and int(nxt["barrier"].get("hp", 0)) > 0)):
                    raise _error("illegal_chase_action", "commands[0].payload.action_id", "advance cannot bypass a hazard or barrier")
                action = session.move_participant(actor_id, [{"type": "advance"}])["actions_taken"][0]
                event_type = "chase_moved"
            elif kind == "chase_hazard":
                nxt = session._next_location(session.participants[actor_id]["position"])
                hazard = nxt.get("hazard") if isinstance(nxt, dict) else None
                expected_id = f"hazard:{hazard.get('hazard_id')}" if isinstance(hazard, dict) else None
                if payload["action_id"] != expected_id:
                    raise _error("untrusted_chase_action", "commands[0].payload.action_id", "action does not identify the next hazard")
                for field in ("skill", "target", "difficulty"):
                    if field in payload and payload[field] is not None and payload[field] != hazard.get(field, "regular" if field == "difficulty" else None):
                        raise _error("chase_action_context_mismatch", f"commands[0].payload.{field}", "hazard continuation cannot override persisted context")
                action = session.move_participant(actor_id, [{
                    "type": "advance", "skill": hazard.get("skill"),
                    "target": hazard.get("target"), "difficulty": hazard.get("difficulty", "regular"),
                }])["actions_taken"][0]
                event_type = "chase_hazard_resolved"
            elif kind == "chase_barrier":
                nxt = session._next_location(session.participants[actor_id]["position"])
                barrier = nxt.get("barrier") if isinstance(nxt, dict) else None
                suffix = payload["method"]
                expected_id = f"barrier:{barrier.get('barrier_id')}:{suffix}" if isinstance(barrier, dict) else None
                if payload["action_id"] != expected_id:
                    raise _error("untrusted_chase_action", "commands[0].payload.action_id", "action does not identify the next barrier")
                if isinstance(choice_id, str):
                    historical = executor_state["choice_history"].get(choice_id)
                    expected_context = historical.get("action_context") if isinstance(historical, dict) else None
                    current_context = {"barrier": _json_copy(barrier), "location_index": nxt.get("index") if isinstance(nxt, dict) else None}
                    if not _json_deep_equal(expected_context, current_context):
                        raise _error("chase_action_context_mismatch", "commands[0]", "barrier choice diverges from persisted action context")
                for field in ("skill", "target", "difficulty"):
                    if field in payload and payload[field] is not None and payload[field] != barrier.get(field, "regular" if field == "difficulty" else None):
                        raise _error("chase_action_context_mismatch", f"commands[0].payload.{field}", "barrier continuation cannot override persisted context")
                action = session.move_participant(actor_id, [{
                    "type": "barrier" if suffix == "negotiate" else "break_barrier",
                    "skill": barrier.get("skill"), "target": barrier.get("target"),
                    "difficulty": barrier.get("difficulty", "regular"),
                }])["actions_taken"][0]
                event_type = "chase_barrier_resolved"
            else:
                target_id = payload["target_actor_id"]
                if payload["action_id"] != f"conflict:{target_id}":
                    raise _error("untrusted_chase_action", "commands[0].payload.action_id", "conflict action ID is not canonical")
                combat_command_id = payload["combat_command_id"]
                combat_result = executor_state["result_snapshots"].get(combat_command_id)
                if not isinstance(combat_result, dict) or combat_result.get("kind") != "combat_defend":
                    raise _error("untrusted_combat_evidence", "commands[0].payload.combat_command_id", "conflict requires a canonical combat defense result")
                combat_event = (combat_result.get("events") or [{}])[0]
                combat_turn = combat_event.get("turn") if isinstance(combat_event, dict) else None
                if (
                    not isinstance(combat_turn, dict)
                    or combat_turn.get("actor_id") != actor_id
                    or combat_turn.get("target_actor_id") != target_id
                    or combat_event.get("source_command_id") != combat_command_id
                ):
                    raise _error("untrusted_combat_evidence", "commands[0].payload.combat_command_id", "combat receipt actors do not match the chase conflict")
                combat = _load_combat_session(campaign_dir, rng=random.Random(0), investigator_id=investigator_id)
                receipt = _canonical_result_receipt(campaign_dir, combat_command_id)
                if (combat_event.get("combat_id") != combat.combat_id
                        or combat_event.get("revision") != combat.revision
                        or receipt.get("command_hash") != executor_state["command_hashes"].get(combat_command_id)
                        or not _json_deep_equal(receipt.get("result"), combat_result)):
                    raise _error("untrusted_combat_evidence", "commands[0].payload.combat_command_id", "combat receipt is stale or does not bind the persisted combat")
                receipt_key = (combat_command_id, receipt["receipt_hash"])
                for prior in executor_state["result_snapshots"].values():
                    if not isinstance(prior, dict) or prior.get("kind") != "chase_conflict":
                        continue
                    prior_events = prior.get("events") or []
                    prior_receipt = prior_events[0].get("combat_receipt") if prior_events and isinstance(prior_events[0], dict) else None
                    if isinstance(prior_receipt, dict) and (
                        prior_receipt.get("combat_command_id"), prior_receipt.get("receipt_hash")
                    ) == receipt_key:
                        raise _error("combat_receipt_already_consumed", "commands[0].payload.combat_command_id", "combat receipt was consumed by an earlier chase session")
                action = session.record_external_conflict(
                    actor_id, target_id, combat_command_id=combat_command_id,
                    combat_revision=combat.revision, combat_id=combat.combat_id,
                    command_hash=receipt["command_hash"], receipt_hash=receipt["receipt_hash"],
                    hp_after={aid: int(row["hp_current"]) for aid, row in combat.participants.items()},
                    conditions_after={aid: list(row.get("conditions") or []) for aid, row in combat.participants.items()},
                )
                event_type = "chase_conflict_resolved"
            rolls = session.drain_pending()
            event = {
                **_json_copy(action), "event_type": event_type,
                "chase_id": session.chase_id, "revision": session.revision,
                "source_command_id": command_id,
            }
            if rolls:
                roll = rolls[0]
                event.update({
                    "roll_id": roll.get("roll_id"), "skill": roll.get("skill"),
                    "target": roll.get("target"), "roll": roll.get("roll"),
                    "outcome": roll.get("outcome"),
                })
            session.check_outcome()
            event["revision"] = session.revision
            if session.status == "concluded":
                event["chase_outcome"] = session.outcome
            if session.status == "active" and session.initiative_cursor == len(session.rounds[-1]["dex_order"]):
                session.begin_round()
                event["next_round"] = session._current_round
                event["revision"] = session.revision
        session.save(campaign_dir)
        _sync_investigator_from_chase(campaign_dir, investigator_id, session)
    refs = ["save/chase.json"]
    if investigator_id in session.participants:
        refs.append(f"save/investigator-state/{investigator_id}.json#current_hp")
        refs.append(f"save/investigator-state/{investigator_id}.json#conditions")
    if isinstance(event.get("roll_id"), str):
        refs.append(f"logs/rolls.jsonl#{command_id}")
    if 'history_ref' in locals() and history_ref is not None:
        refs.append(history_ref)
    return {
        "command_id": command_id, "kind": kind, "status": "completed",
        "events": [event], "pending_choice": None, "state_refs": refs,
    }


def _dispatch_combat(
    campaign_dir: Path,
    character: dict[str, Any],
    investigator_id: str,
    command: dict[str, Any],
    rng: random.Random,
    state: dict[str, Any],
) -> dict[str, Any]:
    kind = command["kind"]
    payload = command["payload"]
    command_id = command["command_id"]
    additional_events: list[dict[str, Any]] = []
    combat_path = campaign_dir / "save" / "combat.json"
    authoritative_inv = _investigator_state(campaign_dir, investigator_id)
    if (
        kind != "combat_end"
        and "dead" in (authoritative_inv.get("conditions") or [])
    ):
        raise _error("investigator_dead", "save/investigator-state", "dead is terminal")

    if kind == "combat_start":
        if combat_path.exists():
            existing = _load_combat_session(
                campaign_dir, rng=random.Random(0), investigator_id=investigator_id,
            )
            if existing.status == "active":
                raise _error("combat_already_active", "save/combat.json", "end the active combat first")
        own_spec = next(
            (spec for spec in payload["participants"] if spec["actor_id"] == investigator_id),
            None,
        )
        if own_spec is None:
            raise _error("combat_actor_missing", "commands[0].payload.participants", "investigator must be a participant")
        expected_hp = authoritative_inv.get("current_hp")
        expected_conditions = authoritative_inv.get("conditions") or []
        if (
            expected_hp is not None
            and (
                own_spec["hp_current"] != expected_hp
                or own_spec["conditions"] != expected_conditions
            )
        ):
            raise _error(
                "combat_state_mismatch", "commands[0].payload.participants",
                "combat participant must match canonical investigator HP/conditions",
            )
        session = coc_combat.CombatSession(
            str(payload["combat_id"]), str(payload["scene_ref"]),
            int(payload.get("turn_number", 0)), rng=rng,
        )
        for spec in payload["participants"]:
            session.add_participant(
                spec["actor_id"], spec["side"], spec["dex"],
                spec["combat_skill"], spec["build"], spec["hp_max"],
                weapons=_json_copy(spec["weapons"]),
                conditions=list(spec["conditions"]),
                dodge_skill=spec["dodge_skill"], con=spec["con"],
                firearms_skill=spec.get("firearms_skill", 0),
                has_ready_firearm=spec.get("has_ready_firearm", False),
                damage_bonus=spec.get("damage_bonus", "none"),
                magic_points=spec.get("magic_points", 0),
                armor=spec.get("armor", 0),
                armor_rule=spec.get("armor_rule"),
            )
            session.participants[spec["actor_id"]]["hp_current"] = spec["hp_current"]
        for preparation in payload.get("preparations", []) or []:
            participant = session.participants.get(preparation["actor_id"])
            if participant is None:
                raise _error("combat_actor_missing", "commands[0].payload.preparations", "preparation actor is absent")
            before = int(participant["magic_points"])
            cost = int(preparation["cost"])
            if before < cost:
                raise _error("insufficient_combat_resource", "commands[0].payload.preparations", "combat preparation lacks magic points")
            participant["magic_points"] = before - cost
            armor_rolls: list[int] = []
            armor_points = 0
            armor_dice = preparation.get("armor_dice")
            if isinstance(armor_dice, str):
                dice_count = int(armor_dice.split("D", 1)[0])
                armor_rolls = [rng.randint(1, 6) for _ in range(dice_count)]
                armor_points = sum(armor_rolls)
                participant["armor"] = armor_points
                participant["armor_rule"] = preparation.get("armor_rule")
            session.apply_effect(
                preparation["actor_id"], preparation["effect_kind"],
                preparation["actor_id"], int(preparation["duration_rounds"]),
                metadata={"rule_ref": preparation["rule_ref"]},
            )
            preparation_event = {
                "event_type": "resource_change",
                "actor_id": preparation["actor_id"],
                "resource": "magic_points",
                "reason": preparation["effect_kind"],
                "before": before,
                "cost": cost,
                "delta": -cost,
                "after": participant["magic_points"],
                "armor_rolls": armor_rolls,
                "armor_points": armor_points,
                "duration_rounds": preparation["duration_rounds"],
                "rule_ref": preparation["rule_ref"],
                "source_command_id": command_id,
            }
            if armor_dice is not None:
                preparation_event["roll_id"] = f"{command_id}:{preparation['effect_id']}"
                preparation_event["dice"] = {
                    "expression": armor_dice,
                    "raw": armor_rolls,
                    "total": armor_points,
                }
            additional_events.append(preparation_event)
        session.begin_round()
        session.revision = 1
        session.save(campaign_dir)
        _sync_investigator_from_combat(campaign_dir, investigator_id, session)
        event = {
            "event_type": "combat_started", "combat_id": session.combat_id,
            "revision": session.revision,
            "initiative_order": _json_copy(session._current_initiative),
            "source_command_id": command_id,
        }
    elif kind == "combat_attack":
        session = _load_combat_session(
            campaign_dir, rng=rng, investigator_id=investigator_id,
        )
        if session.status != "active" or session.pending_attack is not None:
            raise _error("combat_not_ready", "save/combat.json", "combat cannot accept an attack declaration")
        if payload["revision"] != session.revision:
            raise _error("stale_combat_revision", "commands[0].payload.revision", "combat revision is stale")
        actor_id = payload["actor_id"]
        target_id = payload["target_actor_id"]
        if actor_id not in session.participants or target_id not in session.participants:
            raise _error("combat_actor_missing", "commands[0].payload", "attack actor or target is absent")
        resource_cost = payload.get("resource_cost")
        if isinstance(resource_cost, dict):
            participant = session.participants[actor_id]
            before = int(participant.get("magic_points", 0))
            cost = int(resource_cost["cost"])
            if before < cost:
                raise _error("insufficient_combat_resource", "commands[0].payload.resource_cost", "combat attack lacks magic points")
            participant["magic_points"] = before - cost
            additional_events.append({
                "event_type": "resource_change",
                "actor_id": actor_id,
                "resource": "magic_points",
                "reason": resource_cost["reason"],
                "before": before,
                "cost": cost,
                "delta": -cost,
                "after": participant["magic_points"],
                "rule_ref": resource_cost["rule_ref"],
                "source_command_id": command_id,
            })
        _normalize_combat_cursor(session)
        initiative = session._current_initiative
        if (
            not initiative
            or session.initiative_cursor >= len(initiative)
            or initiative[session.initiative_cursor]["actor_id"] != actor_id
        ):
            raise _error("combat_initiative_violation", "commands[0].payload.actor_id", "actor is not next in initiative")
        hint = payload["resolution_hint"]
        allowed = ["dive_for_cover", "none"] if hint == "firearm_attack" else ["dodge", "fight_back"]
        session.pending_attack = {
            "attack_command_id": command_id,
            "actor_id": actor_id,
            "target_actor_id": target_id,
            "declared_intent": payload["declared_intent"],
            "resolution_hint": hint,
            "weapon_id": payload.get("weapon_id"),
            "rulebook_exception": payload.get("rulebook_exception"),
            "on_success": _json_copy(payload.get("on_success")),
            "victory_outcome": payload.get("victory_outcome"),
            "defeat_outcome": payload.get("defeat_outcome"),
            "allowed_defenses": allowed,
        }
        session.revision += 1
        session.save(campaign_dir)
        event = {
            "event_type": "combat_defense_required",
            **_json_copy(session.pending_attack),
            "revision": session.revision,
            "source_command_id": command_id,
        }
    elif kind == "combat_defend":
        session = _load_combat_session(
            campaign_dir, rng=rng, investigator_id=investigator_id,
        )
        pending = session.pending_attack
        if not isinstance(pending, dict):
            raise _error("combat_defense_not_pending", "save/combat.json", "no attack awaits defense")
        if payload["revision"] != session.revision:
            raise _error("stale_combat_revision", "commands[0].payload.revision", "combat revision is stale")
        if (payload["attack_command_id"] != pending["attack_command_id"]
                or payload["actor_id"] != pending["target_actor_id"]):
            raise _error("combat_defense_mismatch", "commands[0].payload", "defense does not match the pending attack")
        defense = payload["defense_kind"]
        if defense not in pending["allowed_defenses"]:
            raise _error("combat_defense_illegal", "commands[0].payload.defense_kind", "defense is not legal for this attack")
        luck_precommit: dict[str, Any] | None = None
        if payload.get("luck_spend_max") is not None:
            if pending.get("resolution_hint") != "opposed_melee":
                raise _error(
                    "combat_luck_precommit_unsupported",
                    "commands[0].payload.luck_spend_max",
                    "combat Luck precommit currently requires a single opposed melee roll",
                )
            if payload.get("luck_actor_id") != investigator_id:
                raise _error(
                    "combat_luck_actor_mismatch",
                    "commands[0].payload.luck_actor_id",
                    "combat Luck may only be pre-authorized for the active investigator",
                )
            luck_state = _investigator_state(campaign_dir, investigator_id)
            characteristics = (
                character.get("characteristics")
                if isinstance(character.get("characteristics"), dict)
                else {}
            )
            current_luck = int(
                luck_state.get("current_luck", characteristics.get("LUCK", 0))
            )
            if current_luck <= 0:
                raise _error(
                    "insufficient_luck",
                    "save/investigator-state.current_luck",
                    "the investigator has no Luck available",
                )
            luck_precommit = {
                "actor_id": investigator_id,
                "max_points": min(int(payload["luck_spend_max"]), current_luck),
                "current_luck": current_luck,
            }
        turn = session.declare_and_resolve_turn(
            pending["actor_id"], pending["declared_intent"],
            target_actor_id=pending["target_actor_id"], defense_kind=defense,
            weapon_id=pending.get("weapon_id"),
            rulebook_exception=pending.get("rulebook_exception"),
            resolution_hint=pending["resolution_hint"],
            luck_precommit=luck_precommit,
            resolution_command_id=command_id,
        )
        rolls, engine_events = session.drain_pending()
        luck_events = [
            candidate
            for candidate in engine_events
            if isinstance(candidate, dict)
            and candidate.get("event_type") == "combat_luck_spent"
        ]
        if len(luck_events) > 1:
            raise _error(
                "invalid_combat_luck_settlement",
                "combat.engine_events",
                "one combat resolution may spend Luck at most once",
            )
        if luck_events:
            luck_event = luck_events[0]
            luck_state = _investigator_state(campaign_dir, investigator_id)
            before = luck_state.get("current_luck")
            if before is None:
                characteristics = (
                    character.get("characteristics")
                    if isinstance(character.get("characteristics"), dict)
                    else {}
                )
                before = int(characteristics.get("LUCK", 0))
            if (
                isinstance(before, bool)
                or not isinstance(before, int)
                or before != luck_event.get("luck_before")
                or luck_event.get("actor_id") != investigator_id
            ):
                raise _error(
                    "combat_luck_state_mismatch",
                    "save/investigator-state.current_luck",
                    "combat Luck receipt diverges from authoritative investigator state",
                )
            luck_state["current_luck"] = int(luck_event["luck_after"])
            luck_path = (
                campaign_dir / "save" / "investigator-state"
                / f"{investigator_id}.json"
            )
            coc_fileio.write_json_atomic(
                luck_path,
                luck_state,
                indent=2,
                ensure_ascii=False,
                trailing_newline=True,
            )
            additional_events.append({
                **_json_copy(luck_event),
                "source_command_id": command_id,
            })
        session.pending_attack = None
        session.mark_current_initiative_acted()
        session.initiative_cursor += 1
        _normalize_combat_cursor(session)
        special_resolution: dict[str, Any] | None = None
        on_success = pending.get("on_success")
        if (
            isinstance(on_success, dict)
            and on_success.get("kind") == "destroy_target"
            and turn.get("outcome") in {"hit", "hit_after_cover"}
        ):
            target = session.participants[pending["target_actor_id"]]
            target["hp_current"] = 0
            if "dead" not in target["conditions"]:
                target["conditions"].append("dead")
            session.conclude(on_success["outcome"])
            session.ended_at_turn = session.started_at_turn + session._turn_counter
            special_resolution = {
                "event_type": "combat_special_resolution",
                "combat_id": session.combat_id,
                "actor_id": pending["actor_id"],
                "target_actor_id": pending["target_actor_id"],
                "effect_kind": "destroy_target",
                "outcome": on_success["outcome"],
                "rule_ref": on_success["rule_ref"],
                "source_command_id": command_id,
            }
        elif not _combat_actor_eligible(session.participants[pending["target_actor_id"]]):
            outcome = (
                pending.get("victory_outcome")
                if pending["actor_id"] == investigator_id
                else pending.get("defeat_outcome")
            )
            if outcome in coc_combat.VALID_OUTCOMES - {None}:
                session.conclude(outcome)
                session.ended_at_turn = session.started_at_turn + session._turn_counter
        session.revision += 1
        session.save(campaign_dir)
        _sync_investigator_from_combat(campaign_dir, investigator_id, session)
        event = {
            "event_type": "combat_turn_resolved", "combat_id": session.combat_id,
            "revision": session.revision, "turn": _json_copy(turn),
            "roll_evidence": _json_copy(rolls),
            "engine_events": _json_copy(engine_events),
            "source_command_id": command_id,
        }
        if special_resolution is not None:
            additional_events.append(special_resolution)
        if session.status == "concluded":
            # Mechanical conclusion and its receipt are one transaction.  A
            # host may stop immediately for death/dying after this command and
            # never grant the Keeper another turn to call combat.end.
            additional_events.append({
                "event_type": "combat_ended",
                "combat_id": session.combat_id,
                "revision": session.revision,
                "outcome": session.outcome,
                "ended_at_turn": session.ended_at_turn,
                "source_command_id": command_id,
            })
        damage_payloads = {
            row["payload"]["roll_id"]: row["payload"]
            for row in session.damage_evidence_rows(
                command_actor_id=investigator_id
            )
            if row.get("command_id") == command_id
        }
        roll_events = [
            {
                "event_type": "combat_roll", **_json_copy(record),
                "source_command_id": command_id,
                "target": (
                    damage_payloads.get(record.get("roll_id"), {}).get("target")
                    if record.get("skill") == "HP Damage"
                    else record.get("target")
                ),
                "difficulty": record.get("difficulty") or (
                    "damage" if record.get("skill") == "HP Damage" else "regular"
                ),
                "raw_roll": (
                    damage_payloads.get(record.get("roll_id"), {})
                    .get("combat_damage_receipt", {}).get("raw_damage", record.get("roll"))
                    if record.get("skill") == "HP Damage" else record.get("roll")
                ),
                "dice": {
                    "expression": (
                        damage_payloads.get(record.get("roll_id"), {})
                        .get("dice", {}).get("expression", record.get("die") or "damage")
                        if record.get("skill") == "HP Damage" else "1D100"
                    ),
                    "raw": (
                        damage_payloads.get(record.get("roll_id"), {})
                        .get("combat_damage_receipt", {}).get(
                            "die_rolls", list(record.get("die_rolls") or [])
                        )
                        if record.get("skill") == "HP Damage"
                        else [record.get("roll")]
                        if isinstance(record.get("roll"), int) else []
                    ),
                    "total": (
                        damage_payloads.get(record.get("roll_id"), {})
                        .get("combat_damage_receipt", {}).get("raw_damage", record.get("roll"))
                        if record.get("skill") == "HP Damage" else record.get("roll")
                    ),
                },
                **(
                    {"combat_damage_receipt": _json_copy(
                        damage_payloads[record["roll_id"]]["combat_damage_receipt"]
                    )}
                    if record.get("roll_id") in damage_payloads else {}
                ),
            }
            for record in rolls
            if isinstance(record, dict) and isinstance(record.get("roll_id"), str)
        ]
    elif kind in {"dying_tick", "stabilize", "weekly_recovery"}:
        if kind == "stabilize":
            _persist_legacy_wound_ledger_if_needed(campaign_dir, investigator_id)
        healing = _healing_session(campaign_dir, character, investigator_id, rng)
        if "dead" in healing.conditions:
            raise _error("investigator_dead", "save/investigator-state", "dead investigators cannot be rescued")
        care_event: dict[str, Any] | None = None
        recovery_wound_id: str | None = None
        recovery_baseline: int | None = None
        recovery_elapsed: int | None = None
        if kind == "dying_tick":
            if "dying" not in healing.conditions:
                raise _error("dying_clock_not_active", "save/investigator-state", "dying condition is absent")
            if payload["clock_kind"] == "hour":
                if "stabilized" not in healing.conditions:
                    raise _error("wrong_dying_clock", "commands[0].payload.clock_kind", "hour clock requires stabilization")
                event = healing.stabilized_con_roll()
            else:
                if "stabilized" in healing.conditions:
                    raise _error("wrong_dying_clock", "commands[0].payload.clock_kind", "stabilized state uses the hourly clock")
                event = healing.dying_con_roll()
        elif kind == "weekly_recovery":
            (
                recovery_wound_id,
                recovery_baseline,
                recovery_elapsed,
            ) = _authoritative_major_wound_recovery_scope(
                campaign_dir, investigator_id
            )
            medical_care_success = False
            medicine_fumbled = False
            if payload.get("medicine_skill_value") is not None:
                care_roll = coc_roll.percentile_check(
                    int(payload["medicine_skill_value"]), rng=rng
                )
                care_outcome = care_roll.get("outcome")
                medical_care_success = care_outcome in SUCCESS_OUTCOMES
                medicine_fumbled = care_outcome == "fumble"
                care_event = {
                    "event_type": "weekly_medical_care",
                    "skill": "Medicine",
                    "target": int(payload["medicine_skill_value"]),
                    "difficulty": "regular",
                    "roll": care_roll.get("roll"),
                    "outcome": care_outcome,
                    "caregiver_id": payload["caregiver_id"],
                    "success": medical_care_success,
                    "fumbled": medicine_fumbled,
                    "rule_ref": "core.combat.major_wound_recovery_care",
                    "source_command_id": command_id,
                }
                additional_events.append(care_event)
            event = healing.major_wound_recovery_roll(
                complete_rest=payload["complete_rest"],
                medical_care_success=medical_care_success,
                poor_environment=payload["poor_environment"],
                medicine_fumbled=medicine_fumbled,
            )
            event.update({
                "wound_id": recovery_wound_id,
                "interval_start_elapsed_minutes": recovery_baseline,
                "attempt_elapsed_minutes": recovery_elapsed,
                "elapsed_minutes_since_prior_attempt": (
                    recovery_elapsed - recovery_baseline
                ),
            })
            additional_events.extend(
                candidate
                for candidate in healing.events
                if candidate is not event
            )
        elif payload["method"] == "first_aid":
            wound_id, day_id, _same_day = _authoritative_treatment_scope(
                campaign_dir, investigator_id, payload
            )
            healing.set_usage_scope(wound_id, day_id)
            if _latest_healing_result_reopens_pushed_first_aid(state):
                healing.reopen_subsequent_first_aid_attempt()
            event = healing.first_aid(
                payload["skill_value"], pushed=bool(payload.get("pushed", False))
            )
        else:
            wound_id, day_id, same_day = _authoritative_treatment_scope(
                campaign_dir, investigator_id, payload
            )
            healing.set_usage_scope(wound_id, day_id)
            event = healing.medicine(
                payload["skill_value"], same_day=same_day
            )
        healing.save(campaign_dir)
        if kind == "weekly_recovery":
            assert recovery_wound_id is not None
            assert recovery_elapsed is not None
            _record_major_wound_recovery_attempt(
                campaign_dir,
                investigator_id,
                command_id=command_id,
                wound_id=recovery_wound_id,
                elapsed=recovery_elapsed,
                outcome=event.get("outcome"),
                medical_care_outcome=(
                    care_event.get("outcome") if care_event is not None else None
                ),
            )
        roll_evidence = _healing_roll_evidence(command_id, payload, event)
        healing_evidence = _medicine_healing_evidence(command_id, payload, event)
        care_evidence = _weekly_care_roll_evidence(
            command_id, payload, care_event
        )
        if kind == "stabilize":
            event["treatment_scope"] = {"wound_id": wound_id, "day_id": day_id}
        event = {
            **_json_copy(event), "source_command_id": command_id,
            "roll_evidence": _json_copy(roll_evidence),
        }
        combat_active = False
        if combat_path.exists():
            session = _load_combat_session(
                campaign_dir, rng=random.Random(0), investigator_id=investigator_id,
            )
            if session.status == "active" and investigator_id in session.participants:
                combat_active = True
                participant = session.participants[investigator_id]
                participant["hp_current"] = healing.current_hp
                participant["conditions"] = list(healing.conditions)
                session.revision += 1
                session.save(campaign_dir)
                event["combat_revision"] = session.revision
                _sync_investigator_from_combat(campaign_dir, investigator_id, session)
        if not combat_active:
            cleared = _clear_inactive_combat_conditions(
                campaign_dir, investigator_id
            )
            if cleared:
                event["cleared_transient_conditions"] = cleared
    else:
        session = _load_combat_session(
            campaign_dir, rng=rng, investigator_id=investigator_id,
        )
        if session.pending_attack is not None:
            raise _error("combat_defense_pending", "save/combat.json", "resolve defense before ending combat")
        if payload["revision"] != session.revision:
            raise _error("stale_combat_revision", "commands[0].payload.revision", "combat revision is stale")
        session.conclude(payload["outcome"])
        pacing_path = campaign_dir / "save" / "pacing-state.json"
        turn_number = session.started_at_turn + session._turn_counter
        if pacing_path.exists():
            try:
                pacing_state = json.loads(pacing_path.read_text(encoding="utf-8"))
                trusted_turn = pacing_state.get("turn_number")
            except (OSError, UnicodeError, json.JSONDecodeError, AttributeError) as exc:
                raise _error("malformed_pacing_state", "save/pacing-state.json", str(exc)) from exc
            if isinstance(trusted_turn, bool) or not isinstance(trusted_turn, int) or trusted_turn < 0:
                raise _error("malformed_pacing_state", "save/pacing-state.json.turn_number", "turn_number must be non-negative")
            turn_number = max(turn_number, trusted_turn)
        session.ended_at_turn = turn_number
        session.revision += 1
        session.save(campaign_dir)
        # Never overwrite healing/rescue state with a stale participant
        # snapshot.  Only remove position markers that have no owner once the
        # combat is concluded; HP and injury conditions remain authoritative.
        cleared = _clear_inactive_combat_conditions(
            campaign_dir, investigator_id
        )
        event = {
            "event_type": "combat_ended", "combat_id": session.combat_id,
            "revision": session.revision, "outcome": session.outcome,
            "ended_at_turn": session.ended_at_turn,
            "source_command_id": command_id,
            "cleared_transient_conditions": cleared,
        }
    refs = [f"save/investigator-state/{investigator_id}.json#current_hp"]
    if kind == "combat_defend" and luck_events:
        refs.append(
            f"save/investigator-state/{investigator_id}.json#current_luck"
        )
    if kind not in {"dying_tick", "stabilize", "weekly_recovery"}:
        refs.insert(0, "save/combat.json")
    events = [event, *additional_events]
    if kind == "combat_defend":
        events.extend(roll_events)
    elif kind in {"dying_tick", "stabilize", "weekly_recovery"} and event.get("roll_evidence") is not None:
        events.append(event["roll_evidence"])
        if care_evidence is not None:
            events.append(care_evidence)
        if healing_evidence is not None:
            events.append(healing_evidence)
    if kind in {
        "combat_defend", "dying_tick", "stabilize", "weekly_recovery"
    } and len(events) > 1:
        refs.append(f"logs/rolls.jsonl#{command_id}")
    return {
        "command_id": command_id, "kind": kind, "status": "completed",
        "events": events, "pending_choice": None, "state_refs": refs,
    }


def _dispatch(
    campaign_dir: Path,
    character: dict[str, Any] | None,
    investigator_id: str,
    command: dict[str, Any],
    rng: random.Random,
    state: dict[str, Any],
) -> dict[str, Any]:
    command_id = command["command_id"]
    kind = command["kind"]
    if kind in AUTHORED_OPERATION_COMMAND_KINDS:
        assert character is not None
        payload = command["payload"]
        inv = _investigator_state(campaign_dir, investigator_id)
        inv.setdefault("investigator_id", investigator_id)
        inv.setdefault("current_hp", int((character.get("derived") or {}).get("HP", 10)))
        inv.setdefault("hp_max", int((character.get("derived") or {}).get("HP", inv["current_hp"])))
        inv.setdefault("conditions", [])
        events: list[dict[str, Any]] = []
        refs = [f"save/investigator-state/{investigator_id}.json"]
        if kind == "environmental_hazard":
            characteristics = character.get("characteristics") or {}
            skills = character.get("skills") or {}
            def target_for(name: str) -> int:
                return int(skills.get(name, characteristics.get(name.upper(), 50)))
            luck = coc_roll.percentile_check(target_for(payload["luck_skill"]), rng=rng)
            luck_event = {
                "roll_id": f"{command_id}:luck", "decision_id": payload.get("decision_id"),
                "kind": kind, "skill": payload["luck_skill"], "target": luck["target"],
                "difficulty": "regular", "roll": luck["roll"],
                "effective_target": luck["effective_target"], "outcome": luck["outcome"],
                "success": luck["outcome"] in SUCCESS_OUTCOMES,
                "reason": payload["source"], "rule_ref": payload["rule_ref"],
                "source_command_id": command_id,
            }
            events.append(luck_event)
            success = bool(luck_event["success"])
            if not success:
                jump = coc_roll.percentile_check(target_for(payload["jump_skill"]), rng=rng)
                jump_event = {
                    "roll_id": f"{command_id}:jump", "decision_id": payload.get("decision_id"),
                    "kind": kind, "skill": payload["jump_skill"], "target": jump["target"],
                    "difficulty": "regular", "roll": jump["roll"],
                    "effective_target": jump["effective_target"], "outcome": jump["outcome"],
                    "success": jump["outcome"] in SUCCESS_OUTCOMES,
                    "reason": payload["source"], "depends_on": luck_event["roll_id"],
                    "rule_ref": payload["rule_ref"],
                    "source_command_id": command_id,
                }
                events.append(jump_event)
                success = bool(jump_event["success"])
                if not success:
                    participant = {"id": investigator_id, **inv}
                    damage = coc_hazards.apply_other_damage(
                        participant, damage_expr=payload["damage_expr"], rng=rng,
                        source=payload["source"],
                    )
                    inv["current_hp"] = participant["current_hp"]
                    inv["conditions"] = list(participant.get("conditions") or [])
                    roll = damage["damage_roll"]
                    events.append({
                        "roll_id": f"{command_id}:damage", "decision_id": payload.get("decision_id"),
                        "kind": kind, "skill": "HP Damage", "target": None,
                        "difficulty": "damage", "roll": roll["total"],
                        "dice": {"expression": roll["expression"], "raw": roll["rolls"], "total": roll["total"]},
                        "outcome": "damage_applied", "success": False,
                        "reason": payload["source"],
                        "hp_before": damage["hp_before"], "hp_after": damage["hp_after"],
                        "hp_delta": damage["hp_delta"], "rule_ref": payload["rule_ref"],
                        "source_command_id": command_id,
                    })
            events.append({
                "event_type": "authored_hazard_resolved", "success": success,
                "source": payload["source"], "rule_ref": payload["rule_ref"],
                "request_id": payload.get("request_id"),
                "source_command_id": command_id,
            })
        else:
            skills = character.get("skills") or {}
            language_target = int(skills.get(payload["language_skill"], 0))
            success = language_target >= int(payload["language_threshold"])
            if not success:
                read_roll = coc_roll.percentile_check(language_target, rng=rng)
                success = read_roll["outcome"] in SUCCESS_OUTCOMES
                events.append({
                    "roll_id": f"{command_id}:language", "decision_id": payload.get("decision_id"),
                    "kind": kind, "skill": payload["language_skill"], "target": language_target,
                    "difficulty": "regular", "roll": read_roll["roll"],
                    "effective_target": read_roll["effective_target"], "outcome": read_roll["outcome"],
                    "success": success, "reason": f"study {payload['tome_id']}",
                    "rule_ref": payload["rule_ref"],
                    "source_command_id": command_id,
                })
            time_result = coc_time.advance_time(
                campaign_dir, int(payload["duration_minutes"]),
                decision_id=str(payload.get("decision_id") or command_id),
                reason=f"study {payload['tome_id']}", source="authored_operation",
                category="tome_study",
            )
            refs.extend(["save/time-state.json", "logs/time.jsonl"])
            if success:
                cm_before = int(inv.get("cm_value", skills.get("Cthulhu Mythos", 0)) or 0)
                max_before = int(inv.get("max_san", 99 - cm_before))
                inv["cm_value"] = cm_before + int(payload["mythos_gain"])
                inv["max_san"] = max(0, max_before - int(payload["max_san_reduction"]))
                if "current_san" in inv:
                    inv["current_san"] = min(int(inv["current_san"]), inv["max_san"])
                events.append({
                    "event_type": "mythos_tome_studied", "success": True,
                    "tome_id": payload["tome_id"], "cm_before": cm_before,
                    "cm_after": inv["cm_value"], "max_san_before": max_before,
                    "max_san_after": inv["max_san"], "time_advance": time_result,
                    "rule_ref": payload["rule_ref"], "source_command_id": command_id,
                    "request_id": payload.get("request_id"),
                })
            else:
                events.append({
                    "event_type": "mythos_tome_studied", "success": False,
                    "tome_id": payload["tome_id"], "time_advance": time_result,
                    "rule_ref": payload["rule_ref"], "source_command_id": command_id,
                    "request_id": payload.get("request_id"),
                })
        path = campaign_dir / "save" / "investigator-state" / f"{investigator_id}.json"
        coc_fileio.write_json_atomic(path, inv, indent=2, ensure_ascii=False, trailing_newline=True)
        return {
            "command_id": command_id, "kind": kind, "status": "completed",
            "events": events, "pending_choice": None, "state_refs": refs,
        }
    if kind == "sanity_reward":
        assert character is not None
        characteristics = character.get("characteristics") or {}
        skills = character.get("skills") or {}
        derived = character.get("derived") or {}
        session = coc_sanity.SanitySession.load(
            campaign_dir,
            investigator_id,
            int_value=int(characteristics.get("INT", 50)),
            rng=rng,
            cm_value=int(skills.get("Cthulhu Mythos", 0)),
        )
        had_snapshot = coc_sanity.sanity_snapshot_exists(
            campaign_dir, investigator_id
        )
        if not had_snapshot:
            sheet_san = int(derived.get("SAN", characteristics.get("POW", 50)))
            session.san_max = sheet_san
            session.san_current = sheet_san
            session.day_start_san = sheet_san
        before = int(session.san_current)
        rolled = rng.randint(1, 6)
        session.gain_san(rolled, source=str(command["payload"]["source"]))
        after = int(session.san_current)
        session.save(campaign_dir, strict_mirror=True)
        event = {
            "event_type": "sanity_rewarded",
            "roll_id": str(command["payload"].get("roll_id") or command_id),
            "decision_id": command["payload"].get("decision_id"),
            "skill": "SAN Reward",
            "source": command["payload"]["source"],
            "rule_ref": command["payload"]["rule_ref"],
            "die": "1D6",
            "dice": {"expression": "1D6", "raw": [rolled], "total": rolled},
            "roll": rolled,
            "san_before": before,
            "san_delta": after - before,
            "san_after": after,
            "outcome": "sanity_reward",
            "source_command_id": command_id,
        }
        return {
            "command_id": command_id,
            "kind": kind,
            "status": "completed",
            "events": [event],
            "pending_choice": None,
            "state_refs": [
                f"logs/rolls.jsonl#{command_id}",
                f"save/sanity-state/{investigator_id}.json#{investigator_id}",
                f"save/investigator-state/{investigator_id}.json#current_san",
            ],
        }
    if kind in CHASE_COMMAND_KINDS:
        return _dispatch_chase(
            campaign_dir, investigator_id, command, rng, state
        )
    if kind in COMBAT_COMMAND_KINDS:
        assert character is not None
        return _dispatch_combat(
            campaign_dir, character, investigator_id, command, rng, state
        )
    if kind in BOUT_COMMAND_KINDS:
        assert character is not None
        payload = command["payload"]
        choice_id = payload["choice_id"]
        choice = state["pending_choices"].pop(choice_id)
        context = state["pending_contexts"].pop(choice_id)
        characteristics = character.get("characteristics") or {}
        skills = character.get("skills") or {}
        session = coc_sanity.SanitySession.load(
            campaign_dir,
            investigator_id,
            int_value=int(characteristics.get("INT", 50)),
            rng=rng,
            cm_value=int(skills.get("Cthulhu Mythos", 0)),
        )
        if (
            not session.bout_active
            or session.active_bout_id != context["bout_id"]
            or session.bout_rounds_remaining != context["remaining_rounds"]
        ):
            raise _error(
                "bout_state_mismatch",
                f"save/sanity-state/{investigator_id}.json",
                "canonical pending bout does not match persisted sanity state",
            )
        event_start = len(session.events)
        events: list[dict[str, Any]] = []
        if kind == "bout_tick":
            ticked = session.tick_bout_round()
            events.append({
                "event_type": "bout_tick",
                "bout_id": context["bout_id"],
                "remaining_rounds": int(ticked["bout_rounds_remaining"]),
                "source_command_id": command_id,
            })
        else:
            session.end_bout()
        session.save(campaign_dir, strict_mirror=True)
        for row in session.events[event_start:]:
            raw_payload = row.get("payload") if isinstance(row, dict) else None
            normalized_payload = _json_copy(raw_payload) if isinstance(raw_payload, dict) else {}
            events.append({
                "event_id": row.get("event_id") if isinstance(row, dict) else None,
                **normalized_payload,
                "event_type": row.get("type") if isinstance(row, dict) else None,
            })
        pending_choice = None
        status = "completed"
        if session.bout_active:
            next_revision = int(choice["revision"]) + 1
            pending_choice = {
                "choice_id": choice_id,
                "kind": "bout_keeper_action",
                "command_id": command_id,
                "responder": "keeper",
                "revision": next_revision,
                "prompt": "Advance or end the active Keeper-controlled bout?",
                "options": _json_copy(PENDING_CHOICE_CONTRACTS["bout_tick"]["options"]),
            }
            state["pending_contexts"][choice_id] = {
                **_json_copy(context),
                "revision": next_revision,
                "remaining_rounds": int(session.bout_rounds_remaining),
            }
            status = "pending_choice"
        else:
            state["choice_history"][choice_id] = {
                **_json_copy(context),
                "public_choice": _json_copy(choice),
                "terminal_action": payload["action"],
                "terminal_revision": payload["revision"],
                "terminal_command_ids": _json_copy(payload["terminal_command_ids"]),
                "terminal_commands": [],
                "terminal_results": [],
                "terminal_result_receipt_hashes": [],
            }
        return {
            "command_id": command_id,
            "kind": kind,
            "status": status,
            "events": events,
            "pending_choice": pending_choice,
            "state_refs": [
                f"save/sanity-state/{investigator_id}.json#{context['bout_id']}",
                f"save/investigator-state/{investigator_id}.json#bout_active",
                f"save/subsystem-state.json#pending_contexts/{choice_id}"
                if pending_choice is not None
                else f"save/subsystem-state.json#choice_history/{choice_id}",
            ],
        }
    if kind == "push_confirm":
        payload = command["payload"]
        choice_id = payload["choice_id"]
        choice = state["pending_choices"].pop(choice_id)
        context = state["pending_contexts"].pop(choice_id)
        action = payload["action"]
        history = {
            **_json_copy(context),
            "public_choice": _json_copy(choice),
            "terminal_action": action,
            "terminal_revision": payload["revision"],
            "terminal_command_ids": _json_copy(payload["terminal_command_ids"]),
            "terminal_commands": [],
            "terminal_results": [],
            "terminal_result_receipt_hashes": [],
            "response_changed_method_evidence": (
                _json_copy(context["changed_method_evidence"])
                if action == "confirm"
                else None
            ),
        }
        state["choice_history"][choice_id] = history
        events: list[dict[str, Any]] = []
        status = "cancelled"
        if action == "confirm":
            status = "completed"
            events.append({
                "event_type": "push_confirmed",
                "kind": "push_confirm",
                "choice_id": choice_id,
                "revision": payload["revision"],
                "source_command_id": command_id,
                "original_command_id": context["origin_command_id"],
                "changed_method_evidence": _json_copy(
                    context["changed_method_evidence"]
                ),
            })
        return {
            "command_id": command_id,
            "kind": kind,
            "status": status,
            "events": events,
            "pending_choice": None,
            "state_refs": [
                f"save/subsystem-state.json#choice_history/{choice_id}"
            ],
        }
    if kind == "push_resolve":
        payload = command["payload"]
        choice_id = payload["choice_id"]
        history = state["choice_history"][choice_id]
        original = history["original_roll"]
        capsule = history["continuation_capsule"]
        roll_spec = capsule["roll_spec"]
        if payload.get("continuation_id") != capsule.get("continuation_id"):
            raise _error("push_continuation_unbound", "push_resolve.continuation_id", "resolve command lacks the exact continuation capability")
        target = int(roll_spec["target"])
        difficulty = str(roll_spec.get("difficulty") or "regular")
        modifier = int(roll_spec.get("bonus_penalty_dice", 0) or 0)
        resolved = coc_roll.percentile_check(
            target,
            difficulty=difficulty,
            bonus=max(0, modifier),
            penalty=max(0, -modifier),
            rng=rng,
        )
        outcome = str(resolved.get("outcome") or "failure")
        roll_contract, _original_fumble = _settle_percentile_fumble_contract(
            roll_spec.get("roll_contract"),
            outcome,
            path=f"commands.{command_id}.payload.roll_contract",
        )
        event = {
            "roll_id": str(payload.get("roll_id") or command_id),
            "decision_id": payload.get("decision_id"),
            "kind": roll_spec.get("kind"),
            "skill": roll_spec.get("skill"),
            "target": target,
            "difficulty": difficulty,
            "reason": roll_spec.get("reason"),
            "request_id": capsule["settlement"]["request_id"],
            "bonus_penalty_dice": modifier,
            "roll": resolved.get("roll"),
            "effective_target": resolved.get("effective_target"),
            "outcome": outcome,
            "success": outcome in SUCCESS_OUTCOMES,
            "roll_contract": roll_contract,
            "resolution_context": {
                **_json_copy(capsule["settlement"]["plan_slice"]),
                **(
                    {"route_resolution": _json_copy(capsule["settlement"]["route_resolution"])}
                    if isinstance(capsule["settlement"].get("route_resolution"), dict)
                    else {}
                ),
            },
            "pushed": True,
            "push_gate": {
                "method_changed": True,
                "consequence_announced": True,
                "player_confirmed": True,
            },
            "original_command_id": history["origin_command_id"],
            "original_roll_id": original.get("roll_id"),
            "announced_consequence": _json_copy(history["announced_consequence"]),
            "changed_method_evidence": _json_copy(
                history["response_changed_method_evidence"]
            ),
            "source_command_id": command_id,
            "continuation_id": capsule["continuation_id"],
            "continuation_idempotency_key": capsule["idempotency"]["key"],
        }
        if outcome == "fumble":
            event["fumble_consequence"] = _json_copy(
                history["announced_consequence"]
            )
        return {
            "command_id": command_id,
            "kind": kind,
            "status": "completed",
            "events": [event],
            "pending_choice": None,
            "state_refs": [
                f"logs/rolls.jsonl#{command_id}",
                f"save/subsystem-state.json#choice_history/{choice_id}",
            ],
        }
    if kind == "push_offer":
        choice_id = _push_choice_id(command_id)
        found = _find_push_capsule(
            state,
            continuation_id=command["payload"].get("continuation_id"),
            legacy_origin_command_id=(
                command["payload"].get("original_command_id")
                if command["payload"].get("continuation_id") is None
                else None
            ),
        )
        if found is None:
            raise _error("push_origin_not_found", "push_offer", "continuation capsule disappeared")
        _origin_id, original_roll, _capsule = found
        skill = str(original_roll.get("skill") or "ordinary")
        consequence = command["payload"]["announced_consequence"]
        play_language = _campaign_play_language(campaign_dir)
        consequence_summary = _localized_consequence_summary(
            consequence, play_language
        )
        prompt, options = _push_choice_content(
            skill,
            consequence_summary,
            play_language,
        )
        choice = {
            "choice_id": choice_id,
            "kind": "push_confirm",
            "command_id": command_id,
            "responder": "player",
            "revision": 0,
            "prompt": prompt,
            "options": options,
        }
        return {
            "command_id": command_id,
            "kind": kind,
            "status": "pending_choice",
            "events": [],
            "pending_choice": choice,
            "state_refs": [
                f"save/subsystem-state.json#pending_choices/{choice_id}",
                f"save/subsystem-state.json#pending_contexts/{choice_id}",
            ],
        }
    assert character is not None
    event = _roll_result(campaign_dir, character, investigator_id, command, rng)
    session_events = event.pop("_session_events", [])
    bout_state = event.pop("_bout_state", None)
    if kind in {"skill_check", "characteristic_check"}:
        capsule = _mint_push_continuation_capsule(
            campaign_dir,
            investigator_id,
            character["id"],
            command,
            event,
        )
        if capsule is not None:
            event["push_continuation_capsule"] = capsule
    refs = [f"logs/rolls.jsonl#{command_id}"]
    if kind == "sanity_check" and "san_loss_fail_expr" in command["payload"]:
        refs.extend([
            f"save/sanity-state/{investigator_id}.json#{investigator_id}",
            f"save/investigator-state/{investigator_id}.json#current_san",
        ])
    pending_choice = None
    status = "completed"
    if kind == "sanity_check" and isinstance(bout_state, dict) and bout_state.get("active"):
        choice_id = _bout_choice_id(command_id)
        pending_choice = {
            "choice_id": choice_id,
            "kind": "bout_keeper_action",
            "command_id": command_id,
            "responder": "keeper",
            "revision": 0,
            "prompt": "Advance or end the active Keeper-controlled bout?",
            "options": _json_copy(PENDING_CHOICE_CONTRACTS["sanity_check"]["options"]),
        }
        state["pending_contexts"][choice_id] = {
            "choice_id": choice_id,
            "kind": "bout_keeper_action",
            "investigator_id": investigator_id,
            "character_id": character["id"],
            "origin_command_id": command_id,
            "bout_id": bout_state["bout_id"],
            "revision": 0,
            "remaining_rounds": int(bout_state["remaining_rounds"]),
        }
        refs.extend([
            f"save/subsystem-state.json#pending_choices/{choice_id}",
            f"save/subsystem-state.json#pending_contexts/{choice_id}",
        ])
        status = "pending_choice"
    return {
        "command_id": command_id,
        "kind": kind,
        "status": status,
        "events": [event, *session_events],
        "pending_choice": pending_choice,
        "state_refs": refs,
    }


def _push_pending_context(
    state: dict[str, Any],
    command: dict[str, Any],
    *,
    investigator_id: str,
    character: dict[str, Any],
    choice: dict[str, Any],
) -> dict[str, Any]:
    payload = command["payload"]
    found = _find_push_capsule(
        state,
        continuation_id=payload.get("continuation_id"),
        legacy_origin_command_id=(
            payload.get("original_command_id")
            if payload.get("continuation_id") is None
            else None
        ),
    )
    if found is None:
        raise _error("push_origin_not_found", "push_offer", "continuation capsule disappeared")
    origin_id, original_roll, capsule = found
    origin_snapshot = state["result_snapshots"][origin_id]
    origin_provenance = state["command_provenance"][origin_id]
    _ = origin_snapshot
    return {
        "choice_id": choice["choice_id"],
        "kind": choice["kind"],
        "investigator_id": investigator_id,
        "character_id": character["id"],
        "origin_command_id": origin_id,
        "offer_command_id": command["command_id"],
        "revision": choice["revision"],
        "original_roll": _json_copy(original_roll),
        "changed_method_evidence": _json_copy(payload["changed_method_evidence"]),
        "announced_consequence": _json_copy(payload["announced_consequence"]),
        "source_time_profile": _json_copy(payload.get("source_time_profile")),
        "resolution_context": _json_copy(original_roll.get("resolution_context") or {}),
        "origin_decision_id": origin_provenance.get("decision_id"),
        "offer_command": _json_copy(command),
        "continuation_capsule": _json_copy(capsule),
    }


def _append_roll_event(
    campaign_dir: Path,
    investigator_id: str,
    command_id: str,
    event: dict[str, Any],
    append_jsonl: Callable[[Path, dict[str, Any]], None] | None,
) -> None:
    # Transactional evidence must reach the canonical log before the final
    # applied-command ledger.  The legacy async callback is intentionally not
    # used here: an in-memory recorder queue cannot be recovered after a crash.
    _ = append_jsonl
    payload = _json_copy(event)
    visibility = str(
        payload.get("visibility")
        or (
            "consequence_public"
            if payload.get("skill") == "HP Damage"
            else "public"
        )
    )
    payload["visibility"] = visibility
    roll_id = str(payload["roll_id"])
    actor = payload.get("actor_id") or investigator_id
    record = {
        "event_type": "roll",
        "type": "roll",
        "roll_id": roll_id,
        "actor": actor,
        "visibility": visibility,
        "source": "subsystem_executor",
        "source_ref": f"logs/rolls.jsonl#{roll_id}",
        "command_id": command_id,
        "payload": payload,
        "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    path = Path(campaign_dir) / "logs" / "rolls.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False) + "\n")
        handle.flush()
        os.fsync(handle.fileno())


def _append_result_receipt(campaign_dir: Path, receipt: dict[str, Any]) -> None:
    """Append an independently persisted canonical execution receipt.

    This is an integrity boundary against coordinated mutation of duplicated
    state fields, not a cryptographic authenticity claim against an actor that
    can rewrite both the state file and the trusted append-only log.
    """
    path = campaign_dir / _RESULT_RECEIPT_LOG
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(receipt, ensure_ascii=False, sort_keys=True) + "\n")
        handle.flush()
        os.fsync(handle.fileno())


def _append_push_offer_evidence(
    campaign_dir: Path, evidence: dict[str, Any]
) -> None:
    path = campaign_dir / _PUSH_OFFER_EVIDENCE_LOG
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(evidence, ensure_ascii=False, sort_keys=True) + "\n")
        handle.flush()
        os.fsync(handle.fileno())


def _append_integrity_evidence(campaign_dir: Path, relative: Path, evidence: dict[str, Any]) -> None:
    path = campaign_dir / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(evidence, ensure_ascii=False, sort_keys=True) + "\n")
        handle.flush()
        os.fsync(handle.fileno())


def _preflight_new_pending_capacity(
    commands_with_hashes: list[tuple[dict[str, Any], str]],
) -> None:
    scopes: dict[str, str] = {}
    for command, _command_hash in commands_with_hashes:
        kind = command["kind"]
        if kind not in PENDING_CHOICE_CONTRACTS:
            continue
        scope = _pending_scope_key(kind, command=command)
        previous = scopes.get(scope)
        if previous is not None:
            raise _error(
                "multiple_pending_choices",
                "commands",
                f"commands {previous!r} and {command['command_id']!r} "
                f"would create blocking choices in scope {scope!r}",
            )
        scopes[scope] = command["command_id"]

    # Preserve the canonical duplicate-scope error above before applying the
    # stricter atomic ordering rule to otherwise valid single-choice batches.
    for position, (command, _command_hash) in enumerate(commands_with_hashes):
        kind = command["kind"]
        may_create_pending = (
            kind in {"push_offer", "bout_tick"}
            or (
                kind == "sanity_check"
                and "san_loss_fail_expr" in command["payload"]
            )
        )
        if may_create_pending and position != len(commands_with_hashes) - 1:
            raise _error(
                "pending_choice_must_end_batch",
                f"commands[{position}]",
                "a command that may create a global pending choice must be the final new command",
            )


def _push_origin_in_use(state: dict[str, Any], origin_command_id: str) -> bool:
    for context in list(state.get("pending_contexts", {}).values()) + list(
        state.get("choice_history", {}).values()
    ):
        if isinstance(context, dict) and context.get("origin_command_id") == origin_command_id:
            return True
    return False


def _find_push_capsule(
    state: dict[str, Any],
    *,
    continuation_id: str | None = None,
    legacy_origin_command_id: str | None = None,
) -> tuple[str, dict[str, Any], dict[str, Any]] | None:
    for command_id in reversed(state.get("applied_command_ids", [])):
        if legacy_origin_command_id is not None and command_id != legacy_origin_command_id:
            continue
        snapshot = state.get("result_snapshots", {}).get(command_id)
        events = snapshot.get("events") if isinstance(snapshot, dict) else None
        if not isinstance(events, list) or len(events) != 1 or not isinstance(events[0], dict):
            continue
        capsule = events[0].get("push_continuation_capsule")
        if not isinstance(capsule, dict):
            continue
        if continuation_id is not None and capsule.get("continuation_id") != continuation_id:
            continue
        return command_id, events[0], capsule
    return None


def _preflight_push_offers(
    commands_with_hashes: list[tuple[dict[str, Any], str]],
    state: dict[str, Any],
    *,
    campaign_dir: Path,
    investigator_id: str,
    character: dict[str, Any] | None,
) -> None:
    for index, (command, _command_hash) in enumerate(commands_with_hashes):
        if command["kind"] != "push_offer":
            continue
        assert character is not None
        payload = command["payload"]
        continuation_id = payload.get("continuation_id")
        legacy_origin_id = payload.get("original_command_id")
        path = (
            f"commands[{index}].payload.continuation_id"
            if continuation_id is not None
            else f"commands[{index}].payload.original_command_id"
        )
        found = _find_push_capsule(
            state,
            continuation_id=continuation_id if isinstance(continuation_id, str) else None,
            legacy_origin_command_id=(
                legacy_origin_id if continuation_id is None and isinstance(legacy_origin_id, str) else None
            ),
        )
        if found is None:
            raise _error(
                "push_origin_not_found",
                path,
                "push offer must reference a persisted continuation capsule",
            )
        origin_id, original, capsule = found
        if legacy_origin_id is not None and legacy_origin_id != origin_id:
            raise _error("push_continuation_unbound", path, "legacy audit origin does not match the continuation capsule")
        snapshot = state["result_snapshots"].get(origin_id)
        provenance = state["command_provenance"].get(origin_id)
        if not isinstance(snapshot, dict) or not isinstance(provenance, dict):
            raise _error(
                "push_origin_not_found",
                path,
                "push offer must reference a persisted original result",
            )
        if (
            provenance.get("investigator_id") != investigator_id
            or provenance.get("character_id") != character.get("id")
        ):
            raise _error(
                "push_origin_actor_mismatch",
                path,
                "original roll belongs to a different investigator or character",
            )
        if snapshot.get("kind") not in {"skill_check", "characteristic_check"}:
            raise _error(
                "push_origin_ineligible",
                path,
                "only ordinary skill or characteristic checks may be pushed",
            )
        capsule = _validate_push_capsule(
            capsule,
            campaign_dir=campaign_dir,
            investigator_id=investigator_id,
            character_id=str(character.get("id")),
        )
        settlement = capsule["settlement"]
        if not _json_deep_equal(
            payload.get("announced_consequence"),
            settlement["announced_consequence"],
        ):
            raise _error(
                "push_origin_context_mismatch",
                f"commands[{index}].payload.announced_consequence",
                "offer cannot replace the consequence sealed by the continuation capsule",
            )
        if not _json_deep_equal(
            payload.get("source_time_profile"),
            settlement["source_time_profile"],
        ):
            raise _error(
                "push_origin_context_mismatch",
                f"commands[{index}].payload.source_time_profile",
                "offer cannot replace the time cost sealed by the continuation capsule",
            )
        outcome = str(original.get("outcome") or "")
        if outcome == "fumble":
            raise _error(
                "push_origin_fumble",
                path,
                "a fumbled roll cannot be pushed",
            )
        if original.get("success") is not False or outcome != "failure":
            raise _error(
                "push_origin_not_failed",
                path,
                "push origin must be an ordinary failed roll",
            )
        contract = original.get("roll_contract")
        policy = contract.get("push_policy") if isinstance(contract, dict) else None
        if not isinstance(policy, dict) or policy.get("eligible") is not True:
            raise _error(
                "push_origin_ineligible",
                path,
                "persisted roll contract does not explicitly permit a push",
            )
        if _push_origin_in_use(state, origin_id):
            raise _error(
                "push_origin_already_used",
                path,
                "the original roll has already been offered or consumed",
            )
        origin_context = original.get("resolution_context") or {}
        if not isinstance(origin_context, dict):
            raise _error(
                "push_origin_incomplete",
                path,
                "original roll lacks structured resolution context",
            )
        supplied_context = payload.get("resolution_context")
        if supplied_context is not None and not _json_deep_equal(
            supplied_context, origin_context
        ):
            raise _error(
                "push_origin_context_mismatch",
                f"commands[{index}].payload.resolution_context",
                "offer cannot override the persisted origin resolution context",
            )


def _preflight_chase_conflict_receipts(
    commands_with_hashes: list[tuple[dict[str, Any], str]], state: dict[str, Any],
) -> None:
    consumed = {
        event.get("combat_receipt", {}).get("combat_command_id")
        for snapshot in state["result_snapshots"].values()
        if isinstance(snapshot, dict) and snapshot.get("kind") == "chase_conflict"
        for event in (snapshot.get("events") or [])[:1]
        if isinstance(event, dict) and isinstance(event.get("combat_receipt"), dict)
    }
    for index, (command, _command_hash) in enumerate(commands_with_hashes):
        if command["kind"] == "chase_conflict" and command["payload"]["combat_command_id"] in consumed:
            raise _error(
                "combat_receipt_already_consumed",
                f"commands[{index}].payload.combat_command_id",
                "combat receipt was consumed by an earlier chase session",
            )


def _preflight_pending_resolution_batch(
    state: dict[str, Any],
    commands_with_hashes: list[tuple[dict[str, Any], str]],
    *,
    campaign_dir: Path,
    investigator_id: str,
) -> bool:
    if not state["pending_choices"] or not commands_with_hashes:
        return False
    commands = [command for command, _command_hash in commands_with_hashes]
    first = commands[0]
    if first["kind"] == "chase_end" and len(commands) == 1:
        contexts = list(state["pending_contexts"].values())
        payload = first["payload"]
        if (len(contexts) == 1 and isinstance(contexts[0], dict)
                and contexts[0].get("kind") == "chase_action"
                and contexts[0].get("chase_id") == payload.get("chase_id")
                and contexts[0].get("revision") == payload.get("revision")):
            return True
        return False
    chase_resolution = (
        first["kind"] in CHASE_COMMAND_KINDS
        and isinstance(first.get("payload"), dict)
        and isinstance(first["payload"].get("choice_id"), str)
    )
    if first["kind"] not in {"push_confirm", "bout_tick", "bout_end"} and not chase_resolution:
        return False
    payload = first["payload"]
    if chase_resolution:
        choice = state["pending_choices"].get(payload.get("choice_id")) or {}
        response = {
            "choice_id": payload.get("choice_id"), "responder": "player",
            "revision": choice.get("revision"), "action": payload.get("action_id"),
        }
    else:
        response = {
            "choice_id": payload.get("choice_id"),
            "responder": payload.get("responder"),
            "revision": payload.get("revision"),
            "action": payload.get("action"),
        }
    expected_plan = _pending_resume_plan_from_state(
        state, campaign_dir, investigator_id, response
    )
    expected_commands = commands_from_rules_requests(expected_plan)
    if not _json_deep_equal(commands, expected_commands):
        raise _error(
            "invalid_pending_resolution_batch",
            "commands",
            "submitted commands do not exactly match the canonical pending response plan",
        )
    return True


def execute_commands(
    campaign_dir: Path | str,
    character_path: Path | str,
    investigator_id: str,
    commands: list[dict[str, Any]],
    *,
    rng: random.Random,
    append_jsonl: Callable[[Path, dict[str, Any]], None] | None = None,
) -> list[dict[str, Any]]:
    """Validate, execute, persist, and replay a strict subsystem command batch."""
    campaign = Path(campaign_dir)
    if not isinstance(investigator_id, str) or not _SAFE_ID.fullmatch(investigator_id):
        raise _error(
            "invalid_investigator_id",
            "investigator_id",
            "expected a stable safe ID",
        )
    character_file = Path(character_path)
    validated = _validate_batch(commands)
    hashes = [_canonical_command_hash(command) for command in validated]
    try:
        rng_state = rng.getstate()
        if not callable(getattr(rng, "setstate", None)):
            raise TypeError("rng must provide setstate")
    except Exception as exc:
        raise _error("invalid_rng", "rng", "expected a random.Random-compatible object") from exc

    # These checks are deliberately state-independent. A malformed new call
    # must not authorize rollback of a previously prepared inflight record.
    needs_character = any(
        command["kind"] in CHARACTER_REQUIRED_COMMAND_KINDS
        for command in validated
    )
    character = (
        _load_character(character_file, investigator_id)
        if needs_character
        else None
    )

    state = _recover_inflight(campaign, _load_state(campaign))
    applied = set(state["applied_command_ids"])

    # Conflict checking is part of whole-batch preflight.  No character read,
    # random draw, handler call, log append, or state write occurs before this.
    for index, (command, command_hash) in enumerate(zip(validated, hashes)):
        command_id = command["command_id"]
        if command_id not in applied:
            continue
        if state["command_hashes"][command_id] != command_hash:
            raise _error(
                "command_conflict",
                f"commands[{index}].command_id",
                f"command_id {command_id!r} was already applied with different content",
            )
        expected_provenance = _command_provenance(
            command,
            investigator_id,
            character,
        )
        if not _json_deep_equal(
            state["command_provenance"][command_id],
            expected_provenance,
        ):
            raise _error(
                "command_provenance_mismatch",
                f"commands[{index}]",
                "persisted command actor/character/decision provenance does not match",
            )
        snapshot = state["result_snapshots"][command_id]
        if (
            snapshot.get("kind") != command["kind"]
            or snapshot.get("status") not in RESULT_STATUSES_BY_KIND[command["kind"]]
        ):
            raise _error(
                "replay_snapshot_mismatch",
                f"commands[{index}]",
                "persisted result kind/status does not match the submitted command",
            )

    _validate_external_result_receipts(campaign, state)

    new_commands_with_hashes = [
        (command, command_hash)
        for command, command_hash in zip(validated, hashes)
        if command["command_id"] not in applied
    ]
    _preflight_push_offers(
        new_commands_with_hashes,
        state,
        campaign_dir=campaign,
        investigator_id=investigator_id,
        character=character,
    )
    _preflight_chase_conflict_receipts(new_commands_with_hashes, state)
    resolving_pending = _preflight_pending_resolution_batch(
        state,
        new_commands_with_hashes,
        campaign_dir=campaign,
        investigator_id=investigator_id,
    )
    if state["pending_choices"] and new_commands_with_hashes and not resolving_pending:
        raise _error(
            "blocked_by_pending_choice",
            "commands",
            "resolve the current subsystem choice before submitting new commands",
        )
    _preflight_new_pending_capacity(new_commands_with_hashes)

    if not validated:
        return []
    if not new_commands_with_hashes:
        return [
            _json_copy(state["result_snapshots"][command["command_id"]])
            for command in validated
        ]

    _preflight_rule_targets(validated, state, character)
    _preflight_sanity_state(
        campaign,
        validated,
        applied,
        character,
        investigator_id,
    )
    _preflight_treatment_commands(
        campaign,
        investigator_id,
        validated,
        applied,
        state,
    )

    inflight = _build_inflight(
        campaign,
        investigator_id,
        new_commands_with_hashes,
    )
    transaction_state = _json_copy(state)
    transaction_state["inflight"] = inflight
    try:
        _write_executor_state(campaign, transaction_state)
    except SubsystemExecutorError:
        raise
    except Exception as exc:
        raise _error(
            "subsystem_transaction_failed",
            STATE_RELATIVE_PATH.as_posix(),
            f"could not persist inflight preimages: {exc}",
        ) from exc

    next_state = _json_copy(state)
    next_state["inflight"] = None
    results: list[dict[str, Any]] = []
    new_results: list[tuple[dict[str, Any], dict[str, Any]]] = []
    try:
        for command, command_hash in zip(validated, hashes):
            command_id = command["command_id"]
            if command_id in applied:
                results.append(_json_copy(state["result_snapshots"][command_id]))
                continue
            result = _dispatch(
                campaign,
                character,
                investigator_id,
                command,
                rng,
                next_state,
            )
            results.append(result)
            new_results.append((command, result))
            next_state["applied_command_ids"].append(command_id)
            next_state["command_hashes"][command_id] = command_hash
            next_state["command_provenance"][command_id] = _command_provenance(
                command,
                investigator_id,
                character,
            )
            next_state["result_snapshots"][command_id] = _json_copy(result)
            pending_choice = result.get("pending_choice")
            if isinstance(pending_choice, dict):
                next_state["pending_choices"][pending_choice["choice_id"]] = _json_copy(
                    pending_choice
                )
                if command["kind"] == "push_offer":
                    assert character is not None
                    next_state["pending_contexts"][pending_choice["choice_id"]] = (
                        _push_pending_context(
                            next_state,
                            command,
                            investigator_id=investigator_id,
                            character=character,
                            choice=pending_choice,
                        )
                    )

        current_commands = {
            command["command_id"]: command for command, _result in new_results
        }
        receipt_records = {
            command["command_id"]: _result_receipt_record(
                next_state["applied_command_ids"].index(command["command_id"]) + 1,
                command,
                result,
                next_state,
            )
            for command, result in new_results
        }
        existing_offer_count = sum(
            1 for command_id in state["applied_command_ids"]
            if state["result_snapshots"][command_id]["kind"] == "push_offer"
        )
        push_offer_evidence: list[dict[str, Any]] = []
        existing_chase_offer_count = sum(
            1 for command_id in state["applied_command_ids"]
            if state["result_snapshots"][command_id]["kind"] == "chase_move"
            and state["result_snapshots"][command_id].get("status") == "pending_choice"
        )
        existing_conflict_count = sum(
            1 for command_id in state["applied_command_ids"]
            if state["result_snapshots"][command_id]["kind"] == "chase_conflict"
        )
        chase_offer_evidence: list[dict[str, Any]] = []
        chase_conflict_evidence: list[dict[str, Any]] = []
        existing_genesis_count = sum(
            1 for command_id in state["applied_command_ids"]
            if state["result_snapshots"][command_id]["kind"] == "chase_start"
        )
        chase_genesis_evidence: list[dict[str, Any]] = []
        for command, result in new_results:
            if command["kind"] == "push_offer":
                push_offer_evidence.append(
                    _push_offer_evidence_record(
                        existing_offer_count + len(push_offer_evidence) + 1,
                        command,
                        result,
                        next_state,
                    )
                )
            if command["kind"] == "chase_move" and result.get("status") == "pending_choice":
                chase_offer_evidence.append(_chase_offer_evidence_record(
                    existing_chase_offer_count + len(chase_offer_evidence) + 1,
                    command, result, next_state,
                ))
            if command["kind"] == "chase_conflict":
                chase_conflict_evidence.append(_chase_conflict_record(
                    campaign_dir,
                    existing_conflict_count + len(chase_conflict_evidence) + 1,
                    command, result, next_state,
                ))
            if command["kind"] == "chase_start":
                chase_genesis_evidence.append(_chase_genesis_record(
                    existing_genesis_count + len(chase_genesis_evidence) + 1,
                    command, next_state,
                ))
        for history_entry in next_state["choice_history"].values():
            if not isinstance(history_entry, dict):
                continue
            terminal_ids = history_entry.get("terminal_command_ids")
            if history_entry.get("terminal_commands") != [] or not isinstance(
                terminal_ids, list
            ):
                continue
            if all(command_id in current_commands for command_id in terminal_ids):
                history_entry["terminal_commands"] = [
                    _json_copy(current_commands[command_id])
                    for command_id in terminal_ids
                ]
                history_entry["terminal_results"] = [
                    _json_copy(next_state["result_snapshots"][command_id])
                    for command_id in terminal_ids
                ]
                history_entry["terminal_result_receipt_hashes"] = [
                    receipt_records[command_id]["receipt_hash"]
                    for command_id in terminal_ids
                ]

        for command, _result in new_results:
            _append_result_receipt(
                campaign, receipt_records[command["command_id"]]
            )

        for evidence in push_offer_evidence:
            _append_push_offer_evidence(campaign, evidence)
        for evidence in chase_offer_evidence:
            _append_integrity_evidence(campaign, _CHASE_OFFER_EVIDENCE_LOG, evidence)
        for evidence in chase_conflict_evidence:
            _append_integrity_evidence(campaign, _CHASE_CONFLICT_LEDGER, evidence)
        for evidence in chase_genesis_evidence:
            _append_integrity_evidence(campaign, _CHASE_GENESIS_LEDGER, evidence)

        for command, result in new_results:
            if not _command_requires_roll_evidence(command):
                continue
            for event in result["events"]:
                if not isinstance(event.get("roll_id"), str):
                    continue
                _append_roll_event(
                    campaign,
                    investigator_id,
                    command["command_id"],
                    event,
                    append_jsonl,
                )
        _write_executor_state(campaign, next_state)
    except Exception as exc:
        rollback_error: Exception | None = None
        try:
            rng.setstate(rng_state)
            _rollback_transaction(campaign, state, inflight)
        except Exception as rollback_exc:
            rollback_error = rollback_exc
        if rollback_error is not None:
            raise _error(
                "subsystem_rollback_failed",
                STATE_RELATIVE_PATH.as_posix(),
                f"transaction error={exc}; rollback error={rollback_error}",
            ) from rollback_error
        raise _error(
            "subsystem_transaction_failed",
            "commands",
            str(exc),
        ) from exc
    return _json_copy(results)


__all__ = [
    "SubsystemCommand",
    "SubsystemExecutorError",
    "SubsystemResult",
    "commands_from_rules_requests",
    "current_pending_choice",
    "execute_commands",
    "flatten_result_events",
    "get_current_pending_choice",
    "get_current_pending_choices",
    "normalize_rule_results",
    "load_canonical_state_readonly",
    "load_combat_damage_evidence",
    "project_player_pending_choice",
    "project_player_combat_defense",
    "plan_from_pending_choice_response",
]
