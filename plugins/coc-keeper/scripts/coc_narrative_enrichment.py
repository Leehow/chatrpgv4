#!/usr/bin/env python3
"""Narrative enrichment helpers for COC Keeper play.

The Story Director intentionally chooses one primary scene_action per turn so
its decision remains deterministic and auditable. This module adds a thin,
side-effect-free enrichment pass around that decision: it surfaces diegetic
choice affordances, converts semantically parsed action atoms into chained rule
requests, activates NPC reaction triggers, and suggests optional incident beats.

It never interprets raw player prose. Anything dependent on what free text
*means* must already be supplied by the semantic intent router as structured
fields such as ``action_atoms``, ``secondary_intents`` or ``target_entities``.
"""
from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent


def _load_optional_sibling(name: str, filename: str):
    import importlib.util
    path = SCRIPT_DIR / filename
    if not path.exists():
        return None
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        return None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


coc_storylets = _load_optional_sibling("coc_storylets", "coc_storylets.py")
coc_language = _load_optional_sibling("coc_language", "coc_language.py")
coc_rules = _load_optional_sibling("coc_narrative_rules", "coc_rules.py")
coc_combat = _load_optional_sibling("coc_narrative_combat", "coc_combat.py")

_SCHEMA_VERSION = 1
_CHARACTERISTICS = {"STR", "CON", "SIZ", "DEX", "APP", "INT", "POW", "EDU", "LUCK"}
_CRITICAL_OUTCOMES = {"critical", "critical_success"}
_FUMBLE_OUTCOMES = {"fumble", "fumbled", "critical_failure"}
_FAILURE_OUTCOMES = {"failure", "fail", "failed"}
_PROPOSAL_MODES = {"yes", "yes_but", "yes_and", "no_boundary"}
_NEXT_CONTRACTS = {"narrate", "request_roll", "offer_choice", "cut"}
_NO_TRIGGER = {
    "schema_version": _SCHEMA_VERSION,
    "triggered": False,
    "reason": "none",
    "polarity": None,
    "conflict_level": None,
    "source": "storylet_trigger_gate",
}


def _as_list(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, tuple):
        return list(value)
    return [value]


def _non_empty_str(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _route_priority(route: dict[str, Any]) -> float:
    try:
        return float(route.get("route_priority", route.get("priority", 0.5)))
    except (TypeError, ValueError):
        return 0.5


def build_choice_frame(
    scene: dict[str, Any] | None,
    clue_policy: dict[str, Any] | None = None,
    *,
    max_routes: int = 3,
    discovered_clue_ids: list[str] | set[str] | tuple[str, ...] | None = None,
    route_completion_receipts: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Build a player-agency frame from scene affordances or clue leads.

    The returned frame is Keeper-facing: the narrator should convert the routes
    into in-fiction cues, not a visible menu. Affordances are compiled scenario
    data, for example a cold exit tunnel, a risky upper shaft, or a wounded NPC.
    If no affordances are present, clue leads are exposed as softer investigative
    routes so the scene still avoids a single-track feel.
    """
    scene = scene or {}
    clue_policy = clue_policy or {}
    routes: list[dict[str, Any]] = []

    discovered = {str(item) for item in (discovered_clue_ids or []) if _non_empty_str(item)}
    active_scene_id = _non_empty_str(scene.get("scene_id"))
    completed_routes: dict[str, dict[str, Any]] = {}
    blocked_route_ids: set[str] = set()
    for receipt in route_completion_receipts or []:
        if not isinstance(receipt, dict) or receipt.get("status") not in {"consumed", "blocked"}:
            continue
        receipt_scene_id = _non_empty_str(receipt.get("scene_id"))
        if receipt_scene_id and active_scene_id and receipt_scene_id != active_scene_id:
            continue
        route_id = _non_empty_str(receipt.get("route_id"))
        if route_id:
            if receipt.get("status") == "consumed":
                completed_routes[route_id] = receipt
            else:
                blocked_route_ids.add(route_id)
    affordances = []
    for affordance in _as_list(scene.get("affordances")):
        if not isinstance(affordance, dict):
            continue
        grant_ids = []
        for value in [affordance.get("clue_id"), *_as_list(affordance.get("grants_clue_ids"))]:
            clue_id = _non_empty_str(value)
            if clue_id and clue_id not in grant_ids:
                grant_ids.append(clue_id)
        route_id = _non_empty_str(
            affordance.get("id") or affordance.get("route_id")
        )
        if route_id in blocked_route_ids:
            continue
        required_route_ids = {
            str(item).strip()
            for item in _as_list(affordance.get("requires_completed_route_ids"))
            if _non_empty_str(item)
        }
        if not required_route_ids.issubset(completed_routes):
            continue
        required_clue_ids = {
            str(item).strip()
            for item in _as_list(affordance.get("requires_discovered_clue_ids"))
            if _non_empty_str(item)
        }
        if not required_clue_ids.issubset(discovered):
            continue
        receipt = completed_routes.get(route_id or "")
        explicitly_repeatable = bool(
            affordance.get("repeatable") is True
            or str(affordance.get("status") or "") in {"repeatable", "resume"}
            or str(affordance.get("completion_policy") or "") == "repeatable"
        )
        remaining_outputs = [
            clue_id for clue_id in grant_ids if clue_id not in discovered
        ]
        if isinstance(receipt, dict):
            for value in receipt.get("remaining_clue_ids") or []:
                clue_id = _non_empty_str(value)
                if clue_id and clue_id not in discovered and clue_id not in remaining_outputs:
                    remaining_outputs.append(clue_id)
        if receipt and not explicitly_repeatable and not remaining_outputs:
            continue
        if (
            grant_ids
            and all(clue_id in discovered for clue_id in grant_ids)
            and not explicitly_repeatable
        ):
            continue
        affordances.append(affordance)
    affordances = sorted(affordances, key=_route_priority, reverse=True)
    for idx, affordance in enumerate(affordances[:max_routes], start=1):
        route_id = _non_empty_str(affordance.get("id") or affordance.get("route_id")) or f"affordance-{idx}"
        routes.append({
            "route_id": route_id,
            "route_type": affordance.get("route_type", "scene_affordance"),
            "clue_id": affordance.get("clue_id"),
            "cue": affordance.get("cue") or affordance.get("player_visible_cue") or route_id,
            # A cue exposes an available action, never the undiscovered fact or
            # state transition that choosing the route may later grant.
            "cue_scope": "action_only",
            "visible_benefit": affordance.get("visible_benefit") or affordance.get("promise"),
            "visible_cost": affordance.get("visible_cost") or affordance.get("cost"),
            "visible_risk": affordance.get("visible_risk") or affordance.get("risk"),
            "clock_tick_on_choose": affordance.get("clock_tick_on_choose"),
            "reward_hint": affordance.get("reward_hint"),
            "forbidden_reveal": affordance.get("forbidden") or affordance.get("must_not_reveal"),
            "status": str(affordance.get("status") or "open"),
            "fork_eligible": affordance.get("fork_eligible", True),
            "source": "scene.affordances",
        })

    if not routes:
        lead_ids = []
        for cid in _as_list(clue_policy.get("leads")) + _as_list(clue_policy.get("reveal")):
            cid_text = _non_empty_str(cid)
            if cid_text and cid_text not in lead_ids:
                lead_ids.append(cid_text)
        for cid in lead_ids[:max_routes]:
            routes.append({
                "route_id": f"clue:{cid}",
                "route_type": "investigative_lead",
                "cue": cid,
                "cue_scope": "action_only",
                "visible_benefit": "may advance the investigation",
                "visible_cost": None,
                "visible_risk": None,
                "clock_tick_on_choose": None,
                "reward_hint": None,
                "forbidden_reveal": None,
                "status": "open",
                "source": "clue_policy.leads",
            })

    must_surface_tradeoffs = any(
        route.get("visible_benefit") or route.get("visible_cost") or route.get("visible_risk")
        for route in routes
    )
    # P0-1: 真分叉判定基于结构化 route.status，不扫自由文本。缺省 status 视为 open。
    open_route_ids = [
        str(route["route_id"])
        for route in routes
        if str(route.get("status") or "open") == "open"
        and route.get("fork_eligible", True) is not False
    ]
    open_route_count = len(open_route_ids)
    is_real_fork = open_route_count >= 2
    return {
        "schema_version": _SCHEMA_VERSION,
        "mode": "diegetic_cues",
        "routes": routes,
        "route_count": len(routes),
        "open_route_count": open_route_count,
        "open_route_ids": open_route_ids,
        "is_real_fork": is_real_fork,
        "must_surface_tradeoffs": bool(must_surface_tradeoffs),
        "do_not_render_as_menu": True,
        "narration_rule": (
            "Render routes as concrete sensory cues, NPC behavior, time pressure, "
            "or visible costs. Do not show numbered options unless the player asks."
        ),
    }


def build_consequence_cues(choice_frame: dict[str, Any] | None) -> list[dict[str, Any]]:
    """Project a choice_frame into concise visible consequence cues."""
    cues: list[dict[str, Any]] = []
    for route in (choice_frame or {}).get("routes", []) or []:
        cues.append({
            "route_id": route.get("route_id"),
            "cue": route.get("cue"),
            "visible_benefit": route.get("visible_benefit"),
            "visible_cost": route.get("visible_cost"),
            "visible_risk": route.get("visible_risk"),
            "forbidden_reveal": route.get("forbidden_reveal"),
        })
    return cues


def _actionability_handle_from_affordance(
    affordance: dict[str, Any],
    index: int,
    *,
    source: str,
) -> dict[str, Any] | None:
    cue = _non_empty_str(
        affordance.get("cue")
        or affordance.get("player_visible_cue")
        or affordance.get("summary")
        or affordance.get("text")
        or affordance.get("action")
    )
    if cue is None:
        return None
    route_id = _non_empty_str(
        affordance.get("route")
        or affordance.get("route_id")
        or affordance.get("id")
    ) or f"{source}-{index}"
    anchor = _non_empty_str(
        affordance.get("anchor")
        or affordance.get("target")
        or affordance.get("object")
        or route_id
    )
    return {
        "route_id": route_id,
        "anchor": anchor,
        "affordance": cue,
        "visible_benefit": affordance.get("visible_benefit") or affordance.get("promise"),
        "visible_cost": affordance.get("visible_cost") or affordance.get("cost"),
        "visible_risk": affordance.get("visible_risk") or affordance.get("risk"),
        "source": source,
    }


def _actionability_handle_from_route(
    route: dict[str, Any],
    index: int,
    *,
    source: str,
) -> dict[str, Any] | None:
    cue = _non_empty_str(route.get("cue"))
    if cue is None:
        return None
    route_id = _non_empty_str(route.get("route_id") or route.get("id")) or f"{source}-{index}"
    return {
        "route_id": route_id,
        "anchor": _non_empty_str(route.get("anchor") or route_id),
        "affordance": cue,
        "visible_benefit": route.get("visible_benefit"),
        "visible_cost": route.get("visible_cost"),
        "visible_risk": route.get("visible_risk"),
        "source": source,
    }


def _actionability_roll_contract(turn: dict[str, Any]) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    for result in _as_list(turn.get("rule_results")):
        if not isinstance(result, dict) or result.get("success") is not False:
            continue
        contract = result.get("roll_contract")
        if isinstance(contract, dict):
            return contract, result
    for request in _as_list(turn.get("rules_requests")):
        if not isinstance(request, dict):
            continue
        contract = request.get("roll_contract")
        if isinstance(contract, dict):
            return contract, request
    return None, None


def _first_pressure_text(active_scene_state: dict[str, Any] | None, contract: dict[str, Any] | None) -> str | None:
    active_scene_state = active_scene_state or {}
    for pressure in _as_list(active_scene_state.get("pressure_moves")):
        if not isinstance(pressure, dict):
            continue
        text = _non_empty_str(
            pressure.get("visible_symptom")
            or pressure.get("cue")
            or pressure.get("summary")
            or pressure.get("effect")
        )
        if text:
            return text
    if isinstance(contract, dict):
        return _non_empty_str(contract.get("failure_effect"))
    return None


def _npc_position_from_moves(turn: dict[str, Any]) -> list[dict[str, Any]]:
    positions: list[dict[str, Any]] = []
    for move in _as_list(turn.get("npc_moves")):
        if not isinstance(move, dict):
            continue
        move_ids = [
            _non_empty_str(agency_move.get("move_id"))
            for agency_move in _as_list(move.get("agency_moves"))
            if isinstance(agency_move, dict)
        ]
        move_ids = [move_id for move_id in move_ids if move_id]
        active_reactions = [
            _non_empty_str(reaction.get("move"))
            for reaction in _as_list(move.get("active_reactions"))
            if isinstance(reaction, dict)
        ]
        active_reactions = [reaction for reaction in active_reactions if reaction]
        if not move_ids and not active_reactions:
            continue
        positions.append({
            "npc_id": move.get("npc_id"),
            "move_ids": move_ids,
            "active_reactions": active_reactions,
            "source": "npc_moves",
        })
    return positions


def build_stop_actionability_contract(
    turn: dict[str, Any] | None,
    active_scene_state: dict[str, Any] | None = None,
    *,
    stop_reason: str | None = None,
    max_handles: int = 3,
    turn_focus: dict[str, Any] | None = None,
    durable_clue_ids: list[str] | None = None,
) -> dict[str, Any]:
    """Build the structured player-facing handhold required at a stop point.

    This consumes only structured scene and rules data. It does not classify
    raw player prose or infer routes from keywords.
    """
    turn = turn or {}
    active_scene_state = active_scene_state or {}
    contract, roll_source = _actionability_roll_contract(turn)
    why_stopped = _non_empty_str(stop_reason) or "awaiting_player_input"
    if roll_source and roll_source.get("success") is False and isinstance(contract, dict):
        why_stopped = _non_empty_str(contract.get("failure_outcome_mode")) or "rule_failure"

    handles: list[dict[str, Any]] = []
    seen: set[str] = set()

    def add_handle(handle: dict[str, Any] | None) -> None:
        if handle is None or len(handles) >= max_handles:
            return
        key = _non_empty_str(handle.get("route_id") or handle.get("affordance") or handle.get("anchor"))
        if key is None or key in seen:
            return
        seen.add(key)
        handles.append(handle)

    # P0-4b: turn_focus 命中 visible_affordances 里的某条时，把它升为首个 handle
    # (freshness: turn_focus)，优先于静态 visible_affordances / choice_frame.routes
    # （那些可能是过时的开场老选项）。
    if isinstance(turn_focus, dict):
        focus_target_id = _non_empty_str(turn_focus.get("focus_target_id"))
        if focus_target_id:
            for affordance in _as_list(active_scene_state.get("visible_affordances")):
                if not isinstance(affordance, dict):
                    continue
                aff_id = (
                    _non_empty_str(affordance.get("route"))
                    or _non_empty_str(affordance.get("route_id"))
                    or _non_empty_str(affordance.get("id"))
                )
                if aff_id == focus_target_id:
                    add_handle({
                        "route_id": focus_target_id,
                        "anchor": _non_empty_str(affordance.get("cue")) or focus_target_id,
                        "affordance": _non_empty_str(affordance.get("cue")) or focus_target_id,
                        "visible_benefit": affordance.get("visible_benefit"),
                        "visible_cost": affordance.get("visible_cost"),
                        "visible_risk": affordance.get("visible_risk"),
                        "freshness": "turn_focus",
                        "source": "turn_focus_contract",
                    })
                    break

    for index, affordance in enumerate(_as_list(active_scene_state.get("visible_affordances")), start=1):
        if isinstance(affordance, dict):
            add_handle(_actionability_handle_from_affordance(
                affordance,
                index,
                source="save.active-scene.visible_affordances",
            ))

    for index, route in enumerate(((turn.get("choice_frame") or {}).get("routes") or []), start=1):
        if isinstance(route, dict):
            add_handle(_actionability_handle_from_route(route, index, source="choice_frame.routes"))

    if len(handles) < max_handles and isinstance(contract, dict):
        goal = _non_empty_str(contract.get("goal"))
        if goal:
            add_handle({
                "route_id": f"roll-contract:{goal}",
                "anchor": goal,
                "affordance": _non_empty_str(contract.get("failure_effect") or contract.get("success_effect")) or goal,
                "visible_benefit": contract.get("success_effect"),
                "visible_cost": contract.get("failure_effect"),
                "visible_risk": None,
                "source": "rule_results.roll_contract",
            })

    # P0-3a: 把 storylet cue 作为 narration 抓手暴露，使 live 前台能看到 storylet 内容。
    storylet_cues: list[str] = []
    for move in _as_list(turn.get("storylet_moves")):
        if isinstance(move, dict):
            cue = _non_empty_str(move.get("cue") or move.get("title"))
            if cue and cue not in storylet_cues:
                storylet_cues.append(cue)
    must_include = (turn.get("narrative_directives") or {}).get("must_include") or []
    resolved_policy = turn.get("resolved_clue_policy")
    if not isinstance(resolved_policy, dict):
        resolved_policy = turn.get("clue_policy") if isinstance(turn.get("clue_policy"), dict) else {}
    planned_reveals = {
        str(clue_id)
        for clue_id in (
            resolved_policy.get("planned_reveals")
            or resolved_policy.get("reveal")
            or []
        )
        if clue_id
    }
    durable = {
        str(clue_id)
        for clue_id in (
            durable_clue_ids
            if durable_clue_ids is not None
            else (turn.get("clue_revealed") or [])
        )
        if clue_id
    }
    # ``must_include`` can contain the player-safe body of a planned clue, but
    # it has no per-string clue ID.  If this turn planned any clue, surface the
    # block only after every planned reveal is durable.  This prevents a social
    # disclosure or failed rules gate from leaking pre-apply clue prose through
    # the stop postscript.  Non-clue storylet cues keep their legacy behavior.
    if not planned_reveals or planned_reveals.issubset(durable):
        for cue in _as_list(must_include):
            cue_text = _non_empty_str(cue)
            if cue_text and cue_text not in storylet_cues:
                storylet_cues.append(cue_text)

    return {
        "schema_version": _SCHEMA_VERSION,
        "why_stopped": why_stopped,
        "immediate_handles": handles,
        "handle_count": len(handles),
        "storylet_cues": storylet_cues,
        "must_surface_handles": bool(handles) or bool(storylet_cues),
        "pressure_if_ignored": _first_pressure_text(active_scene_state, contract),
        "npc_position": _npc_position_from_moves(turn),
        "forbidden_menu_rendering": True,
        "requires_keeper_rewrite": not bool(handles) and not bool(storylet_cues),
        "narration_rule": (
            "Before returning control to the player, surface the immediate_handles "
            "and storylet_cues as concrete diegetic objects, routes, NPC posture, "
            "or visible pressure. Do not render a numbered menu unless the player asks."
        ),
        "source": "stop_actionability_contract",
    }


# P0-4a: focus_axis 固定枚举。新增合法值时在此声明。
_FOCUS_AXES = frozenset({
    "tenant_history", "reward_scope", "npc_question", "environment",
    "direct_entry", "investigate", "social", "move",
})

# P0-4a: intent_router 结构化 topic → focus_axis 映射（非关键词扫描；
# key 是 intent_router 已产出的结构化 topic 值，value 是 focus 枚举）。
_TOPIC_TO_FOCUS_AXIS = {
    "history": "tenant_history",
    "tenant": "tenant_history",
    "reward": "reward_scope",
    "payment": "reward_scope",
    "scope": "reward_scope",
}


def build_turn_focus_contract(ctx: dict[str, Any]) -> dict[str, Any] | None:
    """P0-4a: 把玩家本轮的结构化意图映射到一个 focus_axis + 目标 affordance。

    Constitution 合规：只消费 intent_router 已产出的结构化字段
    (action_atoms[].topic / target_entities) 与 scene.affordances.route_type，
    绝不扫描 player_text 取子串。无结构化匹配时返回 None（不强猜）。
    """
    rich = ctx.get("player_intent_rich") or {}
    scene = ctx.get("active_scene") or {}
    affordances = [a for a in _as_list(scene.get("affordances")) if isinstance(a, dict)]
    if not affordances:
        # P0-4b: live active-scene.json stores these under 'visible_affordances'.
        affordances = [a for a in _as_list(scene.get("visible_affordances")) if isinstance(a, dict)]
    if not affordances:
        return None

    # 优先从 action_atoms 的 topic 映射到一个 focus_axis
    focus_axis: str | None = None
    for atom in _as_list(rich.get("action_atoms")):
        if not isinstance(atom, dict):
            continue
        topic = str(atom.get("topic") or "").strip()
        if topic in _TOPIC_TO_FOCUS_AXIS:
            focus_axis = _TOPIC_TO_FOCUS_AXIS[topic]
            break

    # 退而用 target_entities 里的命名匹配 focus_axis（如 "tenants" → tenant_history）
    if focus_axis is None:
        for entity in _as_list(rich.get("target_entities")):
            entity_text = str(entity or "").strip()
            if entity_text in ("tenants", "tenant", "former_tenants"):
                focus_axis = "tenant_history"
                break
            if entity_text in ("reward", "payment", "fee"):
                focus_axis = "reward_scope"
                break

    if focus_axis is None:
        return None

    # 找到与该 focus_axis 匹配的 affordance（按 route_type）
    focus_target_id: str | None = None
    for affordance in affordances:
        if str(affordance.get("route_type") or "") == focus_axis:
            # P0-4b: affordance 的 id 字段在不同 fixture 里可能是 id / route / route_id。
            # 取值顺序与 _actionability_handle_from_affordance 一致，确保
            # focus_target_id 与最终 handle 的 route_id 相同。
            focus_target_id = (
                _non_empty_str(affordance.get("route"))
                or _non_empty_str(affordance.get("route_id"))
                or _non_empty_str(affordance.get("id"))
            )
            if focus_target_id:
                break

    if focus_target_id is None:
        return None  # 有 focus_axis 但场景无对应 affordance → 不强造 handle

    return {
        "focus_axis": focus_axis,
        "focus_target_id": focus_target_id,
        "focus_reason": f"intent_router_structured_match:{focus_axis}",
        "source_route_ids": [focus_target_id],
        "source": "build_turn_focus_contract",
    }


def build_proposal_transform(player_intent_rich: dict[str, Any] | None) -> dict[str, Any] | None:
    rich = player_intent_rich or {}
    raw = rich.get("proposal")
    if not isinstance(raw, dict):
        return None
    mode = _non_empty_str(raw.get("mode")) or "yes_but"
    if mode not in _PROPOSAL_MODES:
        mode = "yes_but"
    next_contract = _non_empty_str(raw.get("next_contract")) or "narrate"
    if next_contract not in _NEXT_CONTRACTS:
        next_contract = "narrate"
    return {
        "schema_version": _SCHEMA_VERSION,
        "mode": mode,
        "accepted_goal": _non_empty_str(raw.get("accepted_goal")) or "the viable part of the player's plan",
        "visible_cost_or_risk": _non_empty_str(raw.get("visible_cost_or_risk")),
        "boundary_reason": _non_empty_str(raw.get("boundary_reason")),
        "next_contract": next_contract,
        "source": "player_intent_rich.proposal",
    }


def _infer_request_kind(atom: dict[str, Any], skill: str | None) -> str:
    if atom.get("kind"):
        return str(atom["kind"])
    if atom.get("opposed_skill") or atom.get("opposed_by"):
        return "opposed_check"
    if skill and skill.upper() in _CHARACTERISTICS:
        return "characteristic_check"
    return "skill_check"


# Keeper Rulebook p.83-85: these roll kinds cannot be pushed.
_PUSH_INELIGIBLE_KIND_BASES = frozenset({
    "sanity", "luck", "opposed", "damage", "combat",
})


def _push_kind_base(atom: dict[str, Any], skill: str | None) -> str | None:
    """Map structured atom fields to a push-policy kind base, or None if unknown.

    Sources (structured only — no prose scan):
    - ``atom["kind"]`` / inferred kind via ``_infer_request_kind``
    - skill ``SAN`` / ``LUCK`` (characteristic checks that are never pushable)
    """
    if skill:
        upper = skill.upper()
        if upper == "SAN":
            return "sanity"
        if upper == "LUCK":
            return "luck"
    kind = _infer_request_kind(atom, skill)
    token = str(kind or "").strip().lower()
    if not token:
        return None
    if token.endswith("_check") or token.endswith("_roll"):
        token = token.rsplit("_", 1)[0]
    if token in _PUSH_INELIGIBLE_KIND_BASES:
        return token
    return None


def _atom_roll_contract(atom: dict[str, Any], atom_id: str) -> dict[str, Any]:
    goal = _non_empty_str(atom.get("goal") or atom.get("verb") or atom.get("intent")) or "resolve player action"
    failure = _non_empty_str(atom.get("failure_effect") or atom.get("stakes")) or "failure changes the fiction with a cost"
    group = _non_empty_str(atom.get("roll_density_group") or atom.get("target") or atom_id) or atom_id
    skill = _non_empty_str(atom.get("skill") or atom.get("roll_skill"))
    push_eligible = bool(atom.get("push_eligible", True))
    # Auto-disable push for rulebook-ineligible kinds (p.83-85). Explicit
    # push_eligible=True on those kinds is overridden; unknown kinds keep default.
    if _push_kind_base(atom, skill) in _PUSH_INELIGIBLE_KIND_BASES:
        push_eligible = False
    failure_mode = _non_empty_str(atom.get("failure_outcome_mode")) or "goal_with_cost"
    must_not = (
        ["do not narrate the failed goal as achieved"]
        if failure_mode == "no_progress"
        else ["do not narrate no progress on ordinary failure"]
    )
    authored_roll_gate = atom.get("authored_roll_gate") is True
    fumble_consequence = atom.get("fumble_consequence")
    push_failure_consequence = atom.get("push_failure_consequence")
    if authored_roll_gate and (
        not isinstance(fumble_consequence, dict)
        or not isinstance(fumble_consequence.get("summary"), str)
        or not fumble_consequence["summary"].strip()
        or not isinstance(fumble_consequence.get("effect"), dict)
    ):
        raise ValueError("authored roll gate requires a typed fumble consequence")
    if authored_roll_gate and (
        not isinstance(push_failure_consequence, dict)
        or not isinstance(push_failure_consequence.get("summary"), str)
        or not push_failure_consequence["summary"].strip()
        or not isinstance(push_failure_consequence.get("effect"), dict)
    ):
        raise ValueError("authored roll gate requires a typed Push consequence")
    contract = {
        "schema_version": _SCHEMA_VERSION,
        "goal": goal,
        "success_effect": _non_empty_str(atom.get("success_effect")) or "the action succeeds cleanly",
        "failure_effect": failure,
        "failure_outcome_mode": failure_mode,
        "push_policy": {
            "eligible": push_eligible,
            "requires_changed_method": push_eligible,
            "keeper_must_foreshadow_failure": push_eligible,
        },
        "roll_density_group": group,
        "must_not": must_not,
    }
    localized_failure_effects = atom.get("localized_failure_effects")
    if isinstance(localized_failure_effects, dict) and localized_failure_effects:
        contract["localized_failure_effects"] = deepcopy(localized_failure_effects)
    if authored_roll_gate:
        contract["authored_roll_gate"] = True
        contract["fumble_consequence"] = json.loads(json.dumps(
            fumble_consequence, ensure_ascii=False
        ))
        contract["push_failure_consequence"] = json.loads(json.dumps(
            push_failure_consequence, ensure_ascii=False
        ))
        if isinstance(atom.get("push_time_profile"), dict):
            contract["push_time_profile"] = json.loads(json.dumps(
                atom["push_time_profile"], ensure_ascii=False
            ))
    return contract


def _request_atom_id(request: dict[str, Any]) -> str:
    atom_id = _non_empty_str(request.get("atom_id"))
    if atom_id:
        return atom_id
    request_id = _non_empty_str(request.get("request_id")) or "atom"
    return request_id[5:] if request_id.startswith("roll-") else request_id


def _merge_phrase(existing: Any, incoming: Any, *, separator: str = "；") -> str:
    parts: list[str] = []
    for value in [existing, incoming]:
        for piece in str(value or "").split(separator):
            piece = piece.strip()
            if piece and piece not in parts:
                parts.append(piece)
    return separator.join(parts)


def _density_merge_key(request: dict[str, Any]) -> tuple[str, str, str, str, str] | None:
    contract = request.get("roll_contract") if isinstance(request.get("roll_contract"), dict) else {}
    group = _non_empty_str(contract.get("roll_density_group"))
    if not group:
        return None
    if request.get("depends_on"):
        return None
    return (
        group,
        str(request.get("kind") or ""),
        str(request.get("skill") or ""),
        str(request.get("difficulty") or "regular"),
        str(contract.get("failure_outcome_mode") or "goal_with_cost"),
    )


def _merge_density_request(target: dict[str, Any], incoming: dict[str, Any]) -> None:
    target_atom_ids = list(target.get("merged_atoms") or [_request_atom_id(target)])
    incoming_atom_id = _request_atom_id(incoming)
    if incoming_atom_id not in target_atom_ids:
        target_atom_ids.append(incoming_atom_id)
    target["merged_atoms"] = target_atom_ids
    target["reason"] = _merge_phrase(target.get("reason"), incoming.get("reason"))
    target["stakes"] = _merge_phrase(target.get("stakes"), incoming.get("stakes"))
    target["density_decision"] = {
        "schema_version": _SCHEMA_VERSION,
        "mode": "merged_roll",
        "roll_density_group": (target.get("roll_contract") or {}).get("roll_density_group"),
        "merged_atom_ids": target_atom_ids,
        "merged_request_ids": [
            request_id for request_id in _as_list(target.get("merged_request_ids") or target.get("request_id"))
            if request_id
        ] + [incoming.get("request_id")],
        "reason": "same roll_density_group and same roll axis",
        "montage_after_success": True,
    }
    target["merged_request_ids"] = target["density_decision"]["merged_request_ids"]
    contract = target.get("roll_contract") or {}
    incoming_contract = incoming.get("roll_contract") or {}
    contract["goal"] = _merge_phrase(contract.get("goal"), incoming_contract.get("goal"))
    contract["failure_effect"] = _merge_phrase(
        contract.get("failure_effect"),
        incoming_contract.get("failure_effect"),
    )
    contract["success_effect"] = _merge_phrase(
        contract.get("success_effect"),
        incoming_contract.get("success_effect"),
    )
    must_not = []
    for item in _as_list(contract.get("must_not")) + _as_list(incoming_contract.get("must_not")):
        text = _non_empty_str(item)
        if text and text not in must_not:
            must_not.append(text)
    contract["must_not"] = must_not
    target["roll_contract"] = contract


def _apply_roll_density_guard(requests: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    by_key: dict[tuple[str, str, str, str, str], dict[str, Any]] = {}
    for request in requests:
        key = _density_merge_key(request)
        if key is None or key not in by_key:
            merged.append(request)
            if key is not None:
                by_key[key] = request
            continue
        _merge_density_request(by_key[key], request)
    return merged


def _atom_signature(skill: str | None, kind: str) -> tuple[str, str] | None:
    """P1-3: stable (skill, kind) signature for cross-turn roll-density tracking.

    Returns None when neither skill nor kind resolves to a non-empty value, so a
    narration-only/non-rollable atom never seeds a signature into the window.
    """
    skill_text = _non_empty_str(skill)
    kind_text = _non_empty_str(kind)
    if not skill_text and not kind_text:
        return None
    return (skill_text or "", kind_text or "")


# P1-3: a player action repeats across enough turns that narration should montage
# it rather than roll-then-narrate each instance. Threshold is intentionally low
# (3) because the marker is advisory only; rules adjudication is untouched.
_CROSS_TURN_DENSITY_THRESHOLD = 3


def build_action_chain_requests(
    player_intent_rich: dict[str, Any] | None,
    *,
    max_requests: int = 3,
    recent_atom_signatures: list[tuple[str, str]] | None = None,
) -> list[dict[str, Any]]:
    """Convert semantic ``action_atoms`` into a bounded chain of roll requests.

    The function only consumes structured atoms produced upstream by the intent
    evaluator; it does not split or classify free-text itself. Each atom should
    represent an action with distinct risk and stakes. Atoms without a skill (or
    explicit ``requires_roll`` false) remain narration-only.

    P1-3: ``recent_atom_signatures`` carries ``(skill, kind)`` tuples collected
    from prior turns (within a single auto-advance loop, by the runner). When a
    request's signature repeats ≥ ``_CROSS_TURN_DENSITY_THRESHOLD`` times in the
    window (prior turns + the current turn's own atom), the request is annotated
    with a ``cross_turn_density`` marker telling narration to compress. The
    marker is informational only — the runner still rolls per request and rules
    adjudication is untouched. Backward-compat: the kwarg defaults to empty so
    callers that omit it see no marker and no behavior change.
    """
    rich = player_intent_rich or {}
    atoms = [a for a in _as_list(rich.get("action_atoms")) if isinstance(a, dict)]
    # Normalize the recent window once; tolerate None / non-list / malformed
    # entries so a bad caller can never crash enrichment.
    recent_window: list[tuple[str, str]] = []
    if recent_atom_signatures:
        for sig in recent_atom_signatures:
            if isinstance(sig, (tuple, list)) and len(sig) == 2:
                recent_window.append((_non_empty_str(sig[0]) or "", _non_empty_str(sig[1]) or ""))
    recent_counts: dict[tuple[str, str], int] = {}
    for skill_text, kind_text in recent_window:
        recent_counts[(skill_text, kind_text)] = recent_counts.get((skill_text, kind_text), 0) + 1

    requests: list[dict[str, Any]] = []
    atom_to_request: dict[str, str] = {}
    rollable_atoms = 0

    for idx, atom in enumerate(atoms, start=1):
        if atom.get("requires_roll") is False:
            continue
        skill = _non_empty_str(atom.get("skill") or atom.get("roll_skill"))
        if not skill and not atom.get("kind"):
            continue
        rollable_atoms += 1
        atom_id = _non_empty_str(atom.get("id")) or f"atom-{idx}"
        request_id = _non_empty_str(atom.get("request_id")) or f"roll-{atom_id}"
        atom_to_request[atom_id] = request_id
        depends_on = atom.get("depends_on")
        if isinstance(depends_on, str) and depends_on in atom_to_request:
            depends_on = atom_to_request[depends_on]

        resolved_kind = _infer_request_kind(atom, skill)
        req: dict[str, Any] = {
            "kind": resolved_kind,
            "request_id": request_id,
            "skill": skill,
            "reason": atom.get("reason") or atom.get("verb") or atom.get("intent") or "player action atom",
            "difficulty": atom.get("difficulty", "regular"),
            "bonus_penalty_dice": int(atom.get("bonus_penalty_dice", 0) or 0),
            "target": atom.get("target"),
            "depends_on": depends_on,
            "stakes": atom.get("stakes"),
            "source": "player_intent_rich.action_atoms",
            "roll_contract": _atom_roll_contract(atom, atom_id),
            "atom_id": atom_id,
        }
        # P1-3: cross-turn roll-density marker (advisory only).
        sig = _atom_signature(skill, resolved_kind)
        if sig is not None:
            repeated_count = recent_counts.get(sig, 0) + 1  # +1 for this turn's own atom
            if repeated_count >= _CROSS_TURN_DENSITY_THRESHOLD:
                req["cross_turn_density"] = {
                    "schema_version": _SCHEMA_VERSION,
                    "repeated_count": repeated_count,
                    "coalesce_hint": "montage",
                    "window": "cross_turn",
                    "skill": sig[0],
                    "kind": sig[1],
                    "rule": (
                        "同一 (skill, kind) 玩家动作在本轮+前序轮次中重复出现；叙事应压缩/蒙太奇处理，"
                        "但 runner 仍按每条 request 正常掷骰，规则判定不受影响。"
                    ),
                    "source": "build_action_chain_requests.cross_turn_density",
                }
        if atom.get("opposed_skill"):
            req["opposed_skill"] = atom.get("opposed_skill")
        if atom.get("opposed_by"):
            req["opposed_by"] = atom.get("opposed_by")
        requests.append(req)

    requests = _apply_roll_density_guard(requests)
    if len(requests) > max_requests:
        requests = requests[:max_requests]
    if rollable_atoms > len(requests) and requests and not any("density_decision" in req for req in requests):
        requests[-1]["chain_truncated"] = True
        requests[-1]["chain_policy"] = "resolve remaining low-stakes atoms by narration or montage"
    return requests


def _module_rule_table(scenario_id: str) -> dict[str, Any]:
    path = SCRIPT_DIR.parent / "references" / "rules-json" / f"{scenario_id}.json"
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def _monster_profile(monster_ref: str) -> dict[str, Any]:
    path = SCRIPT_DIR.parent / "references" / "rules-json" / "monsters.json"
    try:
        root = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return {}
    monsters = root.get("monsters") if isinstance(root, dict) else {}
    row = monsters.get(monster_ref) if isinstance(monsters, dict) else None
    return dict(row) if isinstance(row, dict) else {}


def _combat_participant_from_operation(
    operation: dict[str, Any],
) -> dict[str, Any] | None:
    actor_id = _non_empty_str(operation.get("actor_id"))
    monster_ref = _non_empty_str(operation.get("monster_ref"))
    if actor_id is None or monster_ref is None or coc_rules is None:
        return None
    monster = _monster_profile(monster_ref)
    if not monster:
        return None
    damage = coc_rules.damage_bonus_build(
        int(monster.get("str", 50)), int(monster.get("siz", 50))
    )
    return {
        "actor_id": actor_id,
        "side": str(operation.get("side") or "monster"),
        "dex": int(monster.get("dex", 50)),
        "combat_skill": int(operation.get("combat_skill", 50)),
        "dodge_skill": int(operation.get("dodge_skill", max(1, int(monster.get("dex", 50)) // 2))),
        "firearms_skill": int(operation.get("firearms_skill", 0)),
        "has_ready_firearm": False,
        "build": int(damage["build"]),
        "damage_bonus": str(damage["damage_bonus"]),
        "hp_max": int(monster.get("hp", 1)),
        "hp_current": int(monster.get("hp", 1)),
        "con": int(monster.get("con", 50)),
        "magic_points": int(operation.get("magic_points", max(0, int(monster.get("pow", 0)) // 5))),
        "armor": int(monster.get("armor", 0)),
        "armor_rule": None,
        "weapons": deepcopy(operation.get("weapons") or [{"weapon_id": "unarmed"}]),
        "conditions": [],
    }


def _route_rules_operation(ctx: dict[str, Any]) -> dict[str, Any] | None:
    rich = ctx.get("player_intent_rich") or {}
    resolution = rich.get("action_resolution") if isinstance(rich, dict) else None
    matched = {
        str(value) for value in (
            resolution.get("matched_affordance_ids") if isinstance(resolution, dict) else []
        ) or [] if value
    }
    for affordance in (ctx.get("active_scene") or {}).get("affordances") or []:
        if not isinstance(affordance, dict):
            continue
        route_id = str(affordance.get("id") or affordance.get("route_id") or "")
        operation = affordance.get("rules_operation")
        if route_id in matched and isinstance(operation, dict):
            return {**deepcopy(operation), "route_id": route_id}
    return None


def _structured_route_weapon_id(
    ctx: dict[str, Any], operation: dict[str, Any], route_id: str,
) -> str:
    """Return an authored or semantically compiled weapon ID for a route.

    The special-dagger route pins its module weapon in authored data.  Generic
    assault routes may instead consume ``combat_action.weapon_id`` or an
    action-atom ``weapon_id`` emitted by the semantic intent compiler.  Player
    prose is deliberately never scanned here.
    """
    fixed = operation.get("investigator_weapon_id")
    if isinstance(fixed, str) and fixed:
        return fixed
    rich = ctx.get("player_intent_rich") or {}
    combat_action = rich.get("combat_action") if isinstance(rich, dict) else None
    selected = combat_action.get("weapon_id") if isinstance(combat_action, dict) else None
    if isinstance(selected, str) and selected:
        return selected
    matched = set(
        str(value) for value in (
            ((rich.get("action_resolution") or {}).get("matched_affordance_ids") or [])
            if isinstance(rich, dict) else []
        ) if value
    )
    for atom in rich.get("action_atoms", []) if isinstance(rich, dict) else []:
        if not isinstance(atom, dict):
            continue
        atom_route = atom.get("route_id") or atom.get("affordance_id")
        if atom_route not in (None, route_id):
            continue
        if atom_route is None and matched != {route_id}:
            continue
        selected = atom.get("weapon_id")
        if isinstance(selected, str) and selected:
            return selected
    default = operation.get("default_investigator_weapon_id")
    return str(default) if isinstance(default, str) and default else "unarmed"


def build_route_operation_requests(ctx: dict[str, Any]) -> list[dict[str, Any]]:
    """Compile authored route operations into the existing typed rules bridge.

    Only stable IDs/enums and authored operation metadata are consumed.  No
    player or scenario prose is classified here.
    """
    scene = ctx.get("active_scene") or {}
    combat = ctx.get("combat_state") or {}
    world = ctx.get("world_state") or {}
    conclusion = scene.get("conclusion_contract")
    if (
        isinstance(conclusion, dict)
        and combat.get("status") == "concluded"
        and combat.get("outcome") == conclusion.get("requires_combat_outcome")
        and not any(
            isinstance(item, dict)
            and item.get("conclusion_id") == conclusion.get("conclusion_id")
            for item in world.get("scenario_outcome_receipts", []) or []
        )
    ):
        reward = conclusion.get("sanity_reward")
        if isinstance(reward, dict):
            return [{
                "kind": "sanity_reward",
                "die": reward.get("die"),
                "source": conclusion.get("conclusion_id"),
                "rule_ref": reward.get("rule_ref"),
                "reason": "structured scenario conclusion reward",
            }]

    operation = _route_rules_operation(ctx)
    if not isinstance(operation, dict) or operation.get("kind") != "combat_engagement":
        return []
    investigator = deepcopy(ctx.get("investigator_combat_profile") or {})
    opponent_spec = operation.get("opponent")
    opponent = (
        _combat_participant_from_operation(opponent_spec)
        if isinstance(opponent_spec, dict) else None
    )
    if not investigator or opponent is None:
        return []
    investigator_id = str(investigator["actor_id"])
    opponent_id = str(opponent["actor_id"])
    scenario_id = str(operation.get("module_rules_id") or "")
    module = _module_rule_table(scenario_id)
    module_weapons = module.get("weapons") if isinstance(module, dict) else []
    route_id = str(operation["route_id"])
    weapon_id = _structured_route_weapon_id(ctx, operation, route_id)
    if coc_combat is not None:
        merged_weapons = coc_combat.resolve_module_weapons(module_weapons)
        weapon = merged_weapons.get(weapon_id)
        owned_weapon_ids = {
            str(row.get("weapon_id"))
            for row in investigator.get("weapons", []) or []
            if isinstance(row, dict) and row.get("weapon_id")
        }
        fixed_weapon = operation.get("investigator_weapon_id") == weapon_id
        if isinstance(weapon, dict) and (fixed_weapon or weapon_id in owned_weapon_ids):
            investigator["weapons"] = [{"weapon_id": weapon_id, **deepcopy(weapon)}]
            if weapon.get("magazine") is not None:
                investigator["has_ready_firearm"] = True
                investigator["firearms_skill"] = max(
                    int(investigator.get("firearms_skill", 0)),
                    int((ctx.get("character") or {}).get("skills", {}).get(
                        weapon.get("skill"), investigator.get("firearms_skill", 0)
                    )),
                )
        elif weapon_id != "unarmed":
            # A semantic weapon declaration must never be silently resolved as
            # unarmed.  Fail closed until the character sheet owns that stable
            # weapon ID (or the authored route explicitly supplies it).
            return []
        resolved_opponent_weapons = []
        for ref in opponent.get("weapons") or []:
            ref_id = ref.get("weapon_id") if isinstance(ref, dict) else ref
            resolved = merged_weapons.get(str(ref_id))
            resolved_opponent_weapons.append(
                {"weapon_id": str(ref_id), **deepcopy(resolved)}
                if isinstance(resolved, dict) else deepcopy(ref)
            )
        opponent["weapons"] = resolved_opponent_weapons

    base_combat_id = f"combat-{scene.get('scene_id') or 'scene'}"
    prior_combat_id = combat.get("combat_id")
    if combat.get("status") == "active" and isinstance(prior_combat_id, str):
        # Every continuation of one encounter must keep its existing identity.
        decision_id = prior_combat_id
    elif isinstance(prior_combat_id, str) and prior_combat_id:
        # A concluded combat is historical evidence, not the identity of a
        # later rematch. Derive a stable new encounter ID from structured
        # state so command IDs and roll IDs cannot collide with the old fight.
        decision_id = (
            f"{base_combat_id}-restart-t{int(ctx.get('turn_number', 0) or 0)}"
            f"-r{int(combat.get('revision', 0) or 0)}"
        )
    else:
        decision_id = base_combat_id
    current_initiative = combat.get("current_initiative") or []
    cursor = int(combat.get("initiative_cursor", 0) or 0)
    current_actor = (
        current_initiative[cursor].get("actor_id")
        if cursor < len(current_initiative) and isinstance(current_initiative[cursor], dict)
        else None
    )
    requests: list[dict[str, Any]] = []
    revision = int(combat.get("revision", 0) or 0)
    if combat.get("status") != "active":
        requests.append({
            "kind": "combat_start",
            "command_id": f"{decision_id}-start",
            "combat_id": decision_id,
            "scene_ref": f"scene/{scene.get('scene_id')}",
            "turn_number": int(ctx.get("turn_number", 0) or 0),
            "participants": [investigator, opponent],
            "preparations": deepcopy(operation.get("preparations") or []),
            "route_resolution": {"matched_route_ids": [route_id]},
        })
        revision = 1
        current_actor = max(
            [investigator, opponent],
            key=lambda row: (int(row["dex"]), int(row["combat_skill"])),
        )["actor_id"]

    if current_actor == investigator_id:
        attack_id = f"{decision_id}-{route_id}-attack-{revision}"
        resolution_hint = (
            "firearm_attack"
            if investigator.get("has_ready_firearm")
            else str(operation.get("resolution_hint") or "opposed_melee")
        )
        attack = {
            "kind": "combat_attack",
            "command_id": attack_id,
            "revision": revision,
            "actor_id": investigator_id,
            "target_actor_id": opponent_id,
            "declared_intent": "structured investigator attack",
            "resolution_hint": resolution_hint,
            "weapon_id": weapon_id,
            "route_resolution": {"matched_route_ids": [route_id]},
        }
        if isinstance(operation.get("rulebook_exception"), str):
            attack["rulebook_exception"] = operation["rulebook_exception"]
        if isinstance(operation.get("on_success"), dict):
            attack["on_success"] = deepcopy(operation["on_success"])
        if isinstance(operation.get("victory_outcome"), str):
            attack["victory_outcome"] = operation["victory_outcome"]
        opponent_defense = str(operation.get("opponent_defense") or "dodge")
        if resolution_hint == "firearm_attack" and opponent_defense not in {
            "dive_for_cover", "none"
        }:
            # Firearms are not opposed by Dodge/Fight Back. An authored melee
            # default must not make a structured firearm route transactionally
            # impossible; only an explicit dive_for_cover remains a defense.
            opponent_defense = "none"
        requests.extend([attack, {
            "kind": "combat_defend",
            "command_id": f"{attack_id}-defense",
            "revision": revision + 1,
            "actor_id": opponent_id,
            "attack_command_id": attack_id,
            "defense_kind": opponent_defense,
            "route_resolution": {"matched_route_ids": [route_id]},
        }])
    elif current_actor == opponent_id:
        attack_id = f"{decision_id}-opponent-attack-{revision}"
        attack = {
            "kind": "combat_attack",
            "command_id": attack_id,
            "revision": revision,
            "actor_id": opponent_id,
            "target_actor_id": investigator_id,
            "declared_intent": "structured opponent attack",
            "resolution_hint": str(operation.get("opponent_resolution_hint") or "opposed_melee"),
            "weapon_id": str(operation.get("opponent_weapon_id") or "unarmed"),
        }
        if isinstance(operation.get("opponent_attack_resource_cost"), dict):
            attack["resource_cost"] = deepcopy(operation["opponent_attack_resource_cost"])
        if isinstance(operation.get("defeat_outcome"), str):
            attack["defeat_outcome"] = operation["defeat_outcome"]
        requests.append(attack)
    return requests


def bind_action_chain_routes(
    chain_requests: list[dict[str, Any]],
    player_intent_rich: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    """Attach fail-closed route ownership to rule requests.

    The semantic resolver owns the route decision; this function only records
    which already-matched route a concrete action-atom request settles.  An
    explicit atom ``route_id``/``affordance_id`` is authoritative when it is in
    the resolver's matched set.  For older intent compilers, exactly one rule
    request plus exactly one matched route is also unambiguous.  Multi-route or
    multi-request ambiguity remains unbound so apply cannot consume a route on
    the strength of an unrelated successful roll.
    """
    rich = player_intent_rich if isinstance(player_intent_rich, dict) else {}
    resolution = rich.get("action_resolution")
    if not isinstance(resolution, dict) or resolution.get("no_match") is True:
        return chain_requests
    matched_route_ids = [
        str(value)
        for value in resolution.get("matched_affordance_ids") or []
        if _non_empty_str(value)
    ]
    matched_route_ids = list(dict.fromkeys(matched_route_ids))
    if not matched_route_ids:
        return chain_requests
    atoms = {
        str(atom.get("id")): atom
        for atom in _as_list(rich.get("action_atoms"))
        if isinstance(atom, dict) and _non_empty_str(atom.get("id"))
    }
    for request in chain_requests:
        atom_ids = [
            str(value)
            for value in (
                request.get("merged_atoms") or [request.get("atom_id")]
            )
            if _non_empty_str(value)
        ]
        explicit: list[str] = []
        for atom_id in atom_ids:
            atom = atoms.get(atom_id) or {}
            route_id = _non_empty_str(
                atom.get("route_id") or atom.get("affordance_id")
            )
            if route_id and route_id in matched_route_ids and route_id not in explicit:
                explicit.append(route_id)
        binding = None
        route_ids: list[str] = []
        if len(explicit) == 1:
            route_ids = explicit
            binding = "explicit_atom_route"
        elif len(chain_requests) == 1 and len(matched_route_ids) == 1:
            route_ids = list(matched_route_ids)
            binding = "single_request_single_resolver_route"
        if not route_ids:
            continue
        request["route_resolution"] = {
            "schema_version": _SCHEMA_VERSION,
            "matched_route_ids": route_ids,
            "binding": binding,
            "request_id": request.get("request_id"),
            "atom_ids": atom_ids,
            "source": "kp_semantic_action_resolver",
        }
    return chain_requests


def _is_primary_clue_gate(request: dict[str, Any]) -> bool:
    contract = request.get("roll_contract")
    return bool(
        request.get("clue_gate") is True
        or request.get("reason") == "obscured clue in scene"
        or (
            isinstance(contract, dict)
            and contract.get("failure_outcome_mode") == "clue_with_cost"
        )
    )


def _is_clue_bonus_request(request: dict[str, Any]) -> bool:
    contract = request.get("roll_contract")
    group = (
        str(contract.get("roll_density_group") or "")
        if isinstance(contract, dict)
        else ""
    )
    return request.get("clue_bonus") is True or group.startswith("clue-bonus:")


def _action_owned_chain_candidate(
    chain_requests: list[dict[str, Any]],
    rich: dict[str, Any],
    clue_policy: dict[str, Any],
    authored_request: dict[str, Any],
) -> dict[str, Any] | None:
    """Return the one action atom structurally proven to own a clue request.

    The proof uses route IDs and compiled clue-affordance skill matches only.
    It never compares request reasons, verbs, targets, or other free prose.
    Ambiguity fails open by preserving all requests.
    """
    if not chain_requests:
        return None
    matched_route_ids = {
        str(value)
        for value in clue_policy.get("matched_route_ids") or []
        if _non_empty_str(value)
    }
    atoms = {
        str(atom.get("id")): atom
        for atom in _as_list(rich.get("action_atoms"))
        if isinstance(atom, dict) and _non_empty_str(atom.get("id"))
    }

    route_matches: list[dict[str, Any]] = []
    for request in chain_requests:
        atom = atoms.get(str(request.get("atom_id") or ""), {})
        route_id = _non_empty_str(atom.get("route_id") or atom.get("affordance_id"))
        if route_id and route_id in matched_route_ids:
            route_matches.append(request)
    if len(route_matches) == 1:
        return route_matches[0]

    matched = clue_policy.get("matched_affordance")
    matched_skills = {
        str(value).strip().lower()
        for value in ((matched or {}).get("matched") or {}).get("skills", [])
        if _non_empty_str(value)
    } if isinstance(matched, dict) else set()
    authored_skill = _non_empty_str(authored_request.get("skill"))
    skill_matches = [
        request
        for request in chain_requests
        if _non_empty_str(request.get("skill"))
        and str(request.get("skill")).strip().lower()
        in (matched_skills or ({authored_skill.lower()} if authored_skill else set()))
    ]
    if len(skill_matches) == 1:
        return skill_matches[0]

    # A single rollable atom plus a resolver-confirmed authored route is an
    # unambiguous primary action even if an older compiler omitted route_id on
    # the atom. Multiple action atoms are deliberately not collapsed here.
    if len(chain_requests) == 1 and matched_route_ids:
        return chain_requests[0]
    return None


def arbitrate_rule_requests(
    existing_requests: list[dict[str, Any]] | None,
    chain_requests: list[dict[str, Any]],
    rich: dict[str, Any] | None,
    clue_policy: dict[str, Any] | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    """Coalesce one semantic action into one primary rules gate.

    Director-owned SAN/combat/opposed checks, independent action atoms, and
    unrelated clue bonus rolls are retained.  Only a clue gate/bonus request
    with one structurally identifiable action-atom owner is replaced; the atom
    request keeps its authored skill while inheriting the clue outcome contract.
    """
    existing = [dict(request) for request in _as_list(existing_requests) if isinstance(request, dict)]
    chains = [dict(request) for request in chain_requests if isinstance(request, dict)]
    rich = rich if isinstance(rich, dict) else {}
    clue_policy = clue_policy if isinstance(clue_policy, dict) else {}
    decisions: list[dict[str, Any]] = []
    consumed_chain_ids: set[int] = set()
    kept_existing: list[dict[str, Any]] = []

    # Primary clue gates win ownership before optional bonus dice. This keeps a
    # real obscured-clue gate and its independently authored bonus as two
    # distinct mechanics instead of accidentally merging both into one roll.
    ordered = sorted(existing, key=lambda request: 0 if _is_primary_clue_gate(request) else 1)
    for request in ordered:
        is_gate = _is_primary_clue_gate(request)
        is_bonus = _is_clue_bonus_request(request)
        if not is_gate and not is_bonus:
            kept_existing.append(request)
            continue
        candidate = _action_owned_chain_candidate(chains, rich, clue_policy, request)
        if candidate is None or id(candidate) in consumed_chain_ids:
            kept_existing.append(request)
            continue
        consumed_chain_ids.add(id(candidate))
        authored_contract = request.get("roll_contract")
        if isinstance(authored_contract, dict):
            candidate["roll_contract"] = deepcopy(authored_contract)
        for key in ("clue_gate", "clue_bonus", "clue_id", "bonus"):
            if key in request:
                candidate[key] = deepcopy(request[key])
        candidate["rule_request_arbitration"] = {
            "schema_version": _SCHEMA_VERSION,
            "mode": "action_atom_replaces_director_clue_request",
            "preserved_skill": candidate.get("skill"),
            "replaced_kind": "clue_bonus" if is_bonus else "clue_gate",
            "source": "structured_route_and_clue_affordance",
        }
        decisions.append(deepcopy(candidate["rule_request_arbitration"]))

    # Restore original relative order for retained director requests, then add
    # action atoms in their declared order. Rules with explicit depends_on stay
    # intact because chain request objects themselves are not reordered.
    kept_ids = {id(request) for request in kept_existing}
    retained_in_original_order = [
        request for request in existing if any(request == kept for kept in kept_existing)
    ]
    del kept_ids  # equality, not object identity, is intentional after copies
    return retained_in_original_order + chains, chains, decisions


def _intent_tags(player_intent_rich: dict[str, Any] | None) -> set[str]:
    rich = player_intent_rich or {}
    tags: set[str] = set()
    for key in ("primary_intent", "risk_posture"):
        value = _non_empty_str(rich.get(key))
        if value:
            tags.add(value)
            tags.add(f"{key}:{value}")
    plural_tag_keys = {
        "secondary_intents": "secondary_intent",
        "target_entities": "target_entity",
    }
    for key, singular in plural_tag_keys.items():
        for value in _as_list(rich.get(key)):
            text = _non_empty_str(value)
            if text:
                tags.add(text)
                tags.add(f"{singular}:{text}")
                tags.add(f"{key}:{text}")
    for atom in _as_list(rich.get("action_atoms")):
        if not isinstance(atom, dict):
            continue
        for key in ("id", "intent", "target", "route_type"):
            value = _non_empty_str(atom.get(key))
            if value:
                tags.add(value)
                tags.add(f"atom.{key}:{value}")
        for value in _as_list(atom.get("tags")):
            text = _non_empty_str(value)
            if text:
                tags.add(text)
    return tags


def _trigger_matches(trigger: dict[str, Any], tags: set[str]) -> bool:
    if not isinstance(trigger, dict):
        return False
    conditions = []
    for key in ("when", "tag", "intent", "target"):
        value = _non_empty_str(trigger.get(key))
        if value:
            conditions.append(value)
    conditions.extend(_non_empty_str(v) for v in _as_list(trigger.get("tags")))
    conditions = [c for c in conditions if c]
    if not conditions:
        return False
    return any(c == "always" or c in tags for c in conditions)


def build_npc_reaction_moves(
    scene: dict[str, Any] | None,
    npc_agendas: dict[str, Any] | None,
    player_intent_rich: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    """Build NPC life/reaction moves from agenda data and structured intent tags."""
    scene = scene or {}
    npc_agendas = npc_agendas or {}
    scene_npcs = set(scene.get("npc_ids", []) or [])
    tags = _intent_tags(player_intent_rich)
    moves: list[dict[str, Any]] = []

    for npc in npc_agendas.get("npcs", []) or []:
        npc_id = npc.get("npc_id")
        if npc_id not in scene_npcs:
            continue
        active_reactions = []
        for trigger in npc.get("reaction_triggers", []) or []:
            if _trigger_matches(trigger, tags):
                active_reactions.append({
                    "move": trigger.get("move", "react"),
                    "line_seed": trigger.get("line_seed"),
                    "reason": trigger.get("when") or trigger.get("tag") or trigger.get("tags"),
                    "visibility": trigger.get("visibility", "player_visible"),
                })
        if not active_reactions and not any(npc.get(k) for k in ("desire", "fear", "voice", "relationship_clock")):
            continue
        moves.append({
            "npc_id": npc_id,
            "agenda": npc.get("agenda", ""),
            "desire": npc.get("desire"),
            "fear": npc.get("fear"),
            "leverage": npc.get("leverage"),
            "voice": npc.get("voice"),
            "relationship_clock": npc.get("relationship_clock"),
            "active_reactions": active_reactions,
            "source": "npc-agendas.reaction_triggers",
        })
    return moves


def build_incident_moves(
    incident_deck: dict[str, Any] | None,
    *,
    turn_number: int = 0,
    scene_tags: list[str] | None = None,
    max_incidents: int = 1,
) -> list[dict[str, Any]]:
    """Suggest optional side beats that enrich the main plot without derailing it."""
    deck = incident_deck or {}
    tags = set(scene_tags or [])
    moves: list[dict[str, Any]] = []
    for incident in deck.get("incidents", []) or []:
        trigger = incident.get("trigger", {}) or {}
        after = int(trigger.get("after_turn", trigger.get("after_main_beats", 0)) or 0)
        required_tags = set(trigger.get("scene_tags", []) or [])
        if turn_number < after:
            continue
        if required_tags and not (required_tags & tags):
            continue
        moves.append({
            "incident_id": incident.get("incident_id"),
            "type": incident.get("type", "side_beat"),
            "cue": incident.get("cue"),
            "decision": (incident.get("short_arc") or {}).get("decision"),
            "payoff": (incident.get("short_arc") or {}).get("payoff"),
            "theme": incident.get("theme"),
            "risks": incident.get("risks", []),
            "source": "incident-deck.json",
        })
        if len(moves) >= max_incidents:
            break
    return moves


# P1-8: foreign-dialogue comprehension tier wiring.
# Constitution: source_language and skill value are both structured fields.
# This helper never scans prose; it reads the structured foreign_dialogue marker
# on npc-agenda entries and the investigator's structured Language skill value.

_DIALOGUE_COMPREHENSION_RULE_ZH = {
    "none": "展示源语原文与语气/表情，不翻译；调查员听不懂具体意思。",
    "gist": "展示源语原文或片段，仅给零碎词义，不默认完整翻译。",
    "partial": "展示源语原文与粗略大意，细节仍不稳，不直接给完整翻译。",
    "fluent": "调查员能听懂，可正常展示完整翻译。",
}


def _dialogue_rule_for_tier(tier: str | None) -> str:
    if tier is None:
        # Placeholder path: narrator/runner must gate on the investigator's
        # structured Language skill value before revealing translation.
        return (
            "展示源语原文；翻译是否可见取决于调查员该语言的结构化技能值（<20 仅给片段，"
            "20-49 给粗略大意，>=50 可给完整翻译）。runner/narrator 须按调查员技能值决定。"
        )
    return _DIALOGUE_COMPREHENSION_RULE_ZH.get(
        tier,
        _DIALOGUE_COMPREHENSION_RULE_ZH["gist"],
    )


def build_dialogue_comprehension_directive(
    scene: dict[str, Any] | None,
    npc_agendas: dict[str, Any] | None,
    investigator: dict[str, Any] | None,
    *,
    investigator_skills: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """Build the ``dialogue_comprehension`` directive list for a scene.

    Scans ``scene.npc_ids`` and the matching npc-agenda entries for a structured
    ``foreign_dialogue`` marker (``{"source_language": "German", "sample_line": ...}``).
    For each marked NPC, computes the investigator's comprehension tier via
    ``coc_language.language_skill_for_source`` + ``dialogue_comprehension_tier``
    and emits a narrator-facing rule.

    Constitution: ``source_language`` and the skill value are both structured;
    this helper never scans free text. If ``coc_language`` is unavailable or
    the investigator's skills are not supplied, it emits a placeholder entry
    (``comprehension=None``, ``requires_investigator_skill=True``) so the
    narrator/runner can fill the gate from the actual character sheet.

    Returns an empty list when no NPC in the scene carries a foreign_dialogue
    marker, so callers can omit the directive entirely.
    """
    if coc_language is None:
        return []
    scene = scene or {}
    npc_agendas = npc_agendas or {}
    scene_npc_ids = set(scene.get("npc_ids", []) or [])

    # Resolve the investigator's structured skills. Accept either a full
    # investigator object ({"skills": {...}}) or a slim skills dict passed
    # directly. When neither is available, leave skills unresolved so the
    # helper emits a placeholder entry.
    skills: dict[str, Any] | None = None
    if isinstance(investigator_skills, dict) and investigator_skills:
        skills = investigator_skills
    elif isinstance(investigator, dict) and isinstance(investigator.get("skills"), dict):
        skills = investigator["skills"]

    entries: list[dict[str, Any]] = []
    for npc in npc_agendas.get("npcs", []) or []:
        if not isinstance(npc, dict):
            continue
        npc_id = npc.get("npc_id")
        if npc_id not in scene_npc_ids:
            continue
        foreign = npc.get("foreign_dialogue")
        if not isinstance(foreign, dict):
            continue
        source_language = _non_empty_str(foreign.get("source_language"))
        if not source_language:
            continue

        if skills is not None:
            skill = coc_language.language_skill_for_source(
                {"skills": skills}, source_language,
            )
            skill_value = int(skill.get("skill_value", 0) or 0)
            tier = coc_language.dialogue_comprehension_tier(
                skill_value, native=bool(skill.get("native")),
            )
            translation_visible = tier == "fluent"
            requires_investigator_skill = False
        else:
            skill_value = None
            tier = None
            translation_visible = False
            requires_investigator_skill = True

        entry: dict[str, Any] = {
            "npc_id": npc_id,
            "source_language": source_language,
            "sample_line": _non_empty_str(foreign.get("sample_line")),
            "skill_value": skill_value,
            "native": None if skills is None else bool(
                coc_language.language_skill_for_source(
                    {"skills": skills}, source_language,
                ).get("native")
            ),
            "comprehension": tier,
            "translation_visible": translation_visible,
            "requires_investigator_skill": requires_investigator_skill,
            "rule": _dialogue_rule_for_tier(tier),
            "source": "npc-agendas.foreign_dialogue",
        }
        entries.append(entry)
    return entries


def _base_storylet_conflict_level(plan: dict[str, Any], ctx: dict[str, Any]) -> str:
    if coc_storylets is not None and hasattr(coc_storylets, "infer_conflict_level"):
        try:
            return coc_storylets.infer_conflict_level(plan, ctx)
        except Exception:
            return "low"
    return "low"


def _normalized_outcome(value: Any) -> str:
    text = str(value or "").strip().lower().replace("-", "_").replace(" ", "_")
    aliases = {
        "regular_success": "regular",
        "success": "regular",
        "hard_success": "hard",
        "extreme_success": "extreme",
        "critical_success": "critical",
        "critical_failure": "fumble",
    }
    return aliases.get(text, text)


def _rule_results_for_trigger(plan: dict[str, Any], ctx: dict[str, Any]) -> list[dict[str, Any]]:
    candidates = plan.get("rules_results")
    if candidates is None:
        candidates = plan.get("rule_results")
    if candidates is None:
        candidates = ctx.get("rules_results")
    return [r for r in _as_list(candidates) if isinstance(r, dict)]


def _rule_signals(plan: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    merged: dict[str, Any] = {}
    if isinstance(ctx.get("rule_signals"), dict):
        merged.update(ctx["rule_signals"])
    if isinstance(plan.get("rule_signals"), dict):
        merged.update(plan["rule_signals"])
    return merged


def _result_polarity_for_outcome(result: dict[str, Any], default: str) -> str:
    explicit = _non_empty_str(result.get("polarity") or result.get("storylet_polarity"))
    if explicit in {"positive", "negative", "neutral"}:
        return explicit
    actor_role = str(result.get("actor_role") or result.get("source_role") or "").strip().lower()
    if actor_role in {"npc", "enemy", "opponent", "adversary", "monster"}:
        return "positive" if default == "negative" else "negative"
    return default


def _crit_fumble_conflict_level(result: dict[str, Any]) -> str:
    """Calibrate a crit/fumble storylet's conflict tier by the action's stakes.

    A true critical or fumble is always a meaningful beat, so it never drops
    below "medium". But it no longer unconditionally saturates the conflict
    dial at "high": a fumble on a low-stakes Library Use roll should not play
    at the same intensity as a fumbled shot in a firefight. The action's own
    `risk_level` (already computed upstream and read for risky_failure) drives
    the tier: high/lethal/severe stakes stay "high"; everything else is "medium".
    """
    risk_level = str(result.get("risk_level") or "").strip().lower()
    if risk_level in {"high", "lethal", "severe"}:
        return "high"
    return "medium"


def _has_active_npc_reaction(plan: dict[str, Any]) -> bool:
    for move in _as_list(plan.get("npc_moves")):
        if isinstance(move, dict) and move.get("active_reactions"):
            return True
    return False


def _pressure_tick_level(plan: dict[str, Any], ctx: dict[str, Any]) -> str:
    signals = _rule_signals(plan, ctx)
    tension = (
        signals.get("tension_level")
        or (signals.get("tension_clock") or {}).get("tension_level")
        or (ctx.get("world_state") or {}).get("tension_level")
        or "low"
    )
    return "high" if tension in {"high", "climax"} else "medium"


def _structured_authored_route_miss(ctx: dict[str, Any]) -> bool:
    """True when the KP resolver rejected prose against a closed public fork."""
    rich = ctx.get("player_intent_rich")
    if not isinstance(rich, dict):
        return False
    resolution = rich.get("action_resolution")
    if not isinstance(resolution, dict) or resolution.get("no_match") is not True:
        return False
    scene = ctx.get("active_scene")
    if not isinstance(scene, dict):
        return False
    return any(
        isinstance(item, dict)
        and str(item.get("status") or "open") in {"open", "resume"}
        for item in _as_list(scene.get("affordances"))
    )


def infer_storylet_trigger(plan: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    """Return why the current turn is allowed to draw a storylet event card.

    Storylets are not per-turn ambient rolls. They are drawn only when rules or
    fiction open an event window: a true critical/fumble, a visible pressure
    tick, a scene cut, a stall recovery need, an NPC reaction, or an explicit
    Keeper/debug policy.
    """
    policy = ctx.get("storylet_policy") or {}
    if policy.get("disabled") or policy.get("disable_storylets"):
        return dict(_NO_TRIGGER)
    if _structured_authored_route_miss(ctx):
        return {
            **dict(_NO_TRIGGER),
            "reason": "authored_route_miss",
            "source": "kp_semantic_action_resolver",
        }

    forced_reason = _non_empty_str(
        policy.get("storylet_trigger")
        or policy.get("trigger")
        or ("forced" if policy.get("force_storylet") or policy.get("force") else None)
    )
    if forced_reason and forced_reason not in {"auto", "none"}:
        return {
            "schema_version": _SCHEMA_VERSION,
            "triggered": True,
            "reason": forced_reason,
            "polarity": policy.get("polarity") or "neutral",
            "conflict_level": policy.get("conflict_level") or _base_storylet_conflict_level(plan, ctx),
            "source": "storylet_policy",
        }

    for result in _rule_results_for_trigger(plan, ctx):
        outcome = _normalized_outcome(result.get("outcome"))
        if outcome in _FUMBLE_OUTCOMES or outcome == "fumble":
            polarity = _result_polarity_for_outcome(result, "negative")
            return {
                "schema_version": _SCHEMA_VERSION,
                "triggered": True,
                "reason": "fumble",
                "polarity": polarity,
                "conflict_level": _crit_fumble_conflict_level(result),
                "source": "rules_results",
                "roll": result.get("roll"),
                "skill": result.get("skill"),
            }

    for result in _rule_results_for_trigger(plan, ctx):
        outcome = _normalized_outcome(result.get("outcome"))
        if outcome in _CRITICAL_OUTCOMES or outcome == "critical":
            polarity = _result_polarity_for_outcome(result, "positive")
            return {
                "schema_version": _SCHEMA_VERSION,
                "triggered": True,
                "reason": "critical_success",
                "polarity": polarity,
                "conflict_level": _crit_fumble_conflict_level(result),
                "source": "rules_results",
                "roll": result.get("roll"),
                "skill": result.get("skill"),
            }

    for result in _rule_results_for_trigger(plan, ctx):
        outcome = _normalized_outcome(result.get("outcome"))
        risky_failure = (
            result.get("storylet_on_failure")
            or result.get("risk_level") in {"high", "lethal", "severe"}
            or result.get("failure_severity") in {"high", "severe"}
        )
        if outcome in _FAILURE_OUTCOMES and risky_failure:
            return {
                "schema_version": _SCHEMA_VERSION,
                "triggered": True,
                "reason": "risky_failure",
                "polarity": "negative",
                "conflict_level": "medium",
                "source": "rules_results",
                "roll": result.get("roll"),
                "skill": result.get("skill"),
            }

    pressure_moves = [m for m in _as_list(plan.get("pressure_moves")) if isinstance(m, dict)]
    if any(int(m.get("tick", 0) or 0) > 0 for m in pressure_moves):
        return {
            "schema_version": _SCHEMA_VERSION,
            "triggered": True,
            "reason": "pressure_clock",
            "polarity": "negative",
            "conflict_level": _pressure_tick_level(plan, ctx),
            "source": "pressure_moves",
        }

    signals = _rule_signals(plan, ctx)
    if signals.get("player_stalled") or int(signals.get("stalled_turns", 0) or 0) >= 3:
        return {
            "schema_version": _SCHEMA_VERSION,
            "triggered": True,
            "reason": "player_stall",
            "polarity": "neutral",
            "conflict_level": "low",
            "source": "rule_signals",
        }

    if _has_active_npc_reaction(plan):
        return {
            "schema_version": _SCHEMA_VERSION,
            "triggered": True,
            "reason": "npc_reaction",
            "polarity": "neutral",
            "conflict_level": "medium",
            "source": "npc_moves",
        }

    if plan.get("scene_action") == "CUT" or plan.get("scene_transition"):
        return {
            "schema_version": _SCHEMA_VERSION,
            "triggered": True,
            "reason": "scene_transition",
            "polarity": "neutral",
            "conflict_level": "medium",
            "source": "director_plan",
        }

    # P0-3b: 场景进入 + storylet_tags 触发（结构化，不扫文本）。
    # 让带 storylet_tags 的场景（如开场简报）在场景进入时能触发匹配的 beat。
    scene = ctx.get("active_scene") or {}
    storylet_tags = [str(t) for t in _as_list(scene.get("storylet_tags")) if str(t)]
    # 场景进入信号可能来自多处：ctx 顶层、active_scene.source_event_type，
    # 或 plan 的 scene_transition 标志（director/runner 在场景切换时置位）。
    source_event = str(
        ctx.get("source_event_type")
        or scene.get("source_event_type")
        or ("scene_transition" if plan.get("scene_transition") else "")
        or ""
    )
    # 首回合（scenario start）也算场景首次进入：turn_number==0 且无历史 intent。
    # recent_intent_classes 可能在 pacing_state 或 ctx 顶层（director ctx 不带 pacing_state）。
    pacing = ctx.get("pacing_state") or {}
    recent_intents = _as_list(
        pacing.get("recent_intent_classes")
        if pacing else ctx.get("recent_intent_classes")
    )
    is_scenario_start = ctx.get("turn_number") == 0 and not recent_intents
    if storylet_tags and (source_event in ("scene_transition", "scene_enter") or is_scenario_start):
        return {
            "schema_version": _SCHEMA_VERSION,
            "triggered": True,
            "reason": "scene_tag_beat",
            "polarity": "neutral",
            "conflict_level": _base_storylet_conflict_level(plan, ctx),
            "storylet_tags": storylet_tags,
            "source": "storylet_trigger_gate",
        }

    return dict(_NO_TRIGGER)


def _storylet_selection_context(ctx: dict[str, Any], trigger: dict[str, Any]) -> dict[str, Any]:
    selection_ctx = deepcopy(ctx)
    policy = dict(selection_ctx.get("storylet_policy") or {})
    if trigger.get("conflict_level"):
        policy["conflict_level"] = trigger["conflict_level"]
    policy["storylet_trigger_reason"] = trigger.get("reason")
    policy["polarity"] = trigger.get("polarity")
    selection_ctx["storylet_policy"] = policy
    selection_ctx["storylet_trigger"] = trigger
    return selection_ctx


def _storylet_scheduler_state(plan: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any] | None:
    if coc_storylets is None or not hasattr(coc_storylets, "infer_story_need"):
        return None
    try:
        story_need = coc_storylets.infer_story_need(plan, ctx)
    except Exception:
        return None
    return {
        "schema_version": _SCHEMA_VERSION,
        "story_need": story_need,
        "candidate_decks": story_need.get("candidate_decks", []),
        "source": "coc_storylets.infer_story_need",
    }


def _apply_storylet_state(enriched: dict[str, Any], storylet_moves: list[dict[str, Any]], trigger: dict[str, Any]) -> None:
    enriched["storylet_moves"] = storylet_moves
    nd = enriched.setdefault("narrative_directives", {})
    nd["storylet_moves"] = storylet_moves
    nd["storylet_trigger"] = trigger
    if storylet_moves:
        nd.setdefault("must_include", [])
        nd["storylet_grounding"] = [
            deepcopy(move.get("grounding_contract"))
            for move in storylet_moves
            if isinstance(move.get("grounding_contract"), dict)
        ]
        nd.setdefault("must_not", [])
        grounding_rule = (
            "Storylets may alter presentation or cost only. Do not introduce a new "
            "actionable object, route, room, or spatial fact outside each move's "
            "structured grounding_contract. On conflict, omit the storylet cue and "
            "fall back to active-scene affordances/anchors."
        )
        if grounding_rule not in nd["must_not"]:
            nd["must_not"].append(grounding_rule)
        for move in storylet_moves:
            grounding = move.get("grounding_contract")
            if (
                isinstance(grounding, dict)
                and grounding.get("allow_new_actionable_fact") is False
            ):
                continue
            cue = move.get("cue")
            if cue and cue not in nd["must_include"]:
                nd["must_include"].append(cue)


def _update_enrichment_summary(
    enriched: dict[str, Any],
    *,
    choice_frame: dict[str, Any] | None = None,
    proposal_transform: dict[str, Any] | None = None,
    chain_requests: list[dict[str, Any]] | None = None,
    roll_density_decisions: list[dict[str, Any]] | None = None,
    npc_reactions: list[dict[str, Any]] | None = None,
    storylet_trigger: dict[str, Any] | None = None,
    storylet_scheduler: dict[str, Any] | None = None,
    incident_moves: list[dict[str, Any]] | None = None,
) -> None:
    summary = enriched.setdefault("narrative_enrichment", {})
    if choice_frame is not None:
        summary["choice_frame"] = bool(choice_frame.get("routes"))
    if proposal_transform is not None:
        summary["proposal_transform"] = bool(proposal_transform)
    if chain_requests is not None:
        summary["action_chain_requests"] = len(chain_requests)
    if roll_density_decisions is not None:
        summary["roll_density_decisions"] = len(roll_density_decisions)
    if npc_reactions is not None:
        summary["npc_reactions"] = sum(len(m.get("active_reactions", []) or []) for m in npc_reactions)
    if storylet_trigger is not None:
        summary["storylet_trigger"] = storylet_trigger
    if storylet_scheduler is not None:
        summary["storylet_scheduler"] = storylet_scheduler
    storylet_moves = [m for m in _as_list(enriched.get("storylet_moves")) if isinstance(m, dict)]
    summary["storylet_moves"] = len(storylet_moves)
    summary["conflict_level"] = storylet_moves[0]["target_conflict_level"] if storylet_moves else None
    if incident_moves is not None:
        summary["incident_moves"] = len(incident_moves)


def _existing_storylet_trigger(plan: dict[str, Any], moves: list[dict[str, Any]]) -> dict[str, Any] | None:
    for move in moves:
        trace = move.get("scheduler_trace")
        if isinstance(trace, dict) and isinstance(trace.get("storylet_trigger"), dict):
            return deepcopy(trace["storylet_trigger"])
    directives = plan.get("narrative_directives") or {}
    trigger = directives.get("storylet_trigger")
    return deepcopy(trigger) if isinstance(trigger, dict) else None


def enrich_storylets_after_rules(plan: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    """Add storylets after rule results are known.

    The pre-rules enrichment pass builds action-chain roll requests. This pass
    runs after those rolls are backfilled so true critical successes and fumbles
    can trigger storylets without making every ordinary turn draw an event card.
    """
    enriched = deepcopy(plan)
    existing_moves = [m for m in _as_list(enriched.get("storylet_moves")) if isinstance(m, dict)]
    trigger = infer_storylet_trigger(enriched, ctx)
    if existing_moves:
        selected_trigger = _existing_storylet_trigger(enriched, existing_moves) or trigger
        _apply_storylet_state(enriched, existing_moves, selected_trigger)
        _update_enrichment_summary(enriched, storylet_trigger=selected_trigger)
        if trigger.get("triggered") and trigger.get("reason") != selected_trigger.get("reason"):
            nd = enriched.setdefault("narrative_directives", {})
            nd["post_rule_storylet_trigger"] = trigger
            enriched.setdefault("narrative_enrichment", {})["post_rule_storylet_trigger"] = trigger
        return enriched
    if not trigger.get("triggered") or coc_storylets is None:
        _apply_storylet_state(enriched, existing_moves, trigger)
        _update_enrichment_summary(enriched, storylet_trigger=trigger)
        return enriched

    selection_ctx = _storylet_selection_context(ctx, trigger)
    scheduler = _storylet_scheduler_state(enriched, selection_ctx)
    if scheduler is not None:
        selection_ctx["story_need"] = scheduler["story_need"]
    storylet_moves = coc_storylets.select_storylet_moves(
        enriched,
        selection_ctx,
        seed=(selection_ctx.get("storylet_policy") or {}).get("seed", selection_ctx.get("session_seed", "storylet")),
        max_storylets=int((selection_ctx.get("storylet_policy") or {}).get("max_storylets", 1) or 1),
    )
    _apply_storylet_state(enriched, storylet_moves, trigger)
    _update_enrichment_summary(enriched, storylet_trigger=trigger, storylet_scheduler=scheduler)
    return enriched


def _merge_npc_moves(existing: list[dict[str, Any]], extra: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged = [dict(m) for m in existing]
    by_id = {m.get("npc_id"): m for m in merged if m.get("npc_id")}
    for move in extra:
        npc_id = move.get("npc_id")
        if npc_id in by_id:
            target = by_id[npc_id]
            for key, value in move.items():
                if key == "active_reactions":
                    target.setdefault("active_reactions", [])
                    target["active_reactions"].extend(value or [])
                elif value is not None and not target.get(key):
                    target[key] = value
        else:
            merged.append(move)
    return merged


def enrich_director_plan(plan: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    """Return a copy of DirectorPlan enriched for agency, NPC life and rolls."""
    enriched = deepcopy(plan)
    scene = ctx.get("active_scene") or {}
    rich = ctx.get("player_intent_rich")
    authored_route_miss = _structured_authored_route_miss(ctx)

    choice_frame = build_choice_frame(
        scene,
        enriched.get("clue_policy"),
        discovered_clue_ids=(ctx.get("world_state") or {}).get("discovered_clue_ids"),
        route_completion_receipts=(ctx.get("world_state") or {}).get(
            "route_completion_receipts"
        ),
    )
    enriched["choice_frame"] = choice_frame
    nd = enriched.setdefault("narrative_directives", {})
    nd["choice_frame"] = choice_frame
    nd["consequence_cues"] = build_consequence_cues(choice_frame)

    proposal_transform = None if authored_route_miss else build_proposal_transform(rich)
    if proposal_transform is not None:
        enriched["proposal_transform"] = proposal_transform
        nd["proposal_transform"] = proposal_transform
        if proposal_transform["next_contract"] == "request_roll":
            enriched["handoff"] = "rules" if enriched.get("rules_requests") else enriched.get("handoff", "narration")

    route_operation_requests = (
        [] if authored_route_miss or enriched.get("rules_requests")
        else build_route_operation_requests(ctx)
    )
    if route_operation_requests:
        enriched["rules_requests"] = route_operation_requests
        enriched["handoff"] = "rules"
        nd["route_operation"] = {
            "schema_version": _SCHEMA_VERSION,
            "request_kinds": [row.get("kind") for row in route_operation_requests],
            "source": "scene.affordances.rules_operation",
        }
    resolution = rich.get("action_resolution") if isinstance(rich, dict) else None
    destination_move = (
        enriched.get("scene_action") == "CUT"
        and isinstance(resolution, dict)
        and isinstance(resolution.get("matched_destination_scene_id"), str)
        and bool(resolution["matched_destination_scene_id"])
    )
    chain_requests = [] if authored_route_miss or route_operation_requests or destination_move else build_action_chain_requests(
        rich, recent_atom_signatures=ctx.get("recent_atom_signatures")
    )
    if destination_move:
        nd["destination_action_deferred"] = {
            "schema_version": _SCHEMA_VERSION,
            "destination_scene_id": resolution["matched_destination_scene_id"],
            "reason": "destination actions resolve after scene arrival",
            "source": "structured_action_resolution",
        }
    bind_action_chain_routes(chain_requests, rich)
    roll_density_decisions = [
        req["density_decision"]
        for req in chain_requests
        if isinstance(req.get("density_decision"), dict)
    ]
    if roll_density_decisions:
        enriched["roll_density_decisions"] = roll_density_decisions
        nd["roll_density_decisions"] = roll_density_decisions
    if chain_requests:
        merged_requests, chain_requests, arbitration = arbitrate_rule_requests(
            enriched.get("rules_requests"),
            chain_requests,
            rich,
            enriched.get("clue_policy"),
        )
        enriched["rules_requests"] = merged_requests
        if arbitration:
            nd["rule_request_arbitration"] = arbitration
            enriched["rule_request_arbitration"] = arbitration
        enriched["handoff"] = "rules"
    # P1-3: surface cross-turn roll density as a narration-facing montage_hint so
    # the narrator/director can compress repeated player actions. Advisory only —
    # the runner still rolls per request and rules adjudication is untouched.
    cross_turn_markers = [
        req["cross_turn_density"]
        for req in chain_requests
        if isinstance(req.get("cross_turn_density"), dict)
    ]
    if cross_turn_markers:
        # Pick the strongest marker (highest repeated_count) for the hint.
        strongest = max(cross_turn_markers, key=lambda m: int(m.get("repeated_count", 0) or 0))
        nd["montage_hint"] = {
            "schema_version": _SCHEMA_VERSION,
            "coalesce_hint": strongest.get("coalesce_hint", "montage"),
            "repeated_count": strongest.get("repeated_count"),
            "window": strongest.get("window", "cross_turn"),
            "marked_request_ids": [req.get("request_id") for req in chain_requests if isinstance(req.get("cross_turn_density"), dict)],
            "rule": strongest.get("rule"),
            "source": "enrich_director_plan.montage_hint",
        }

    npc_reactions = build_npc_reaction_moves(scene, ctx.get("npc_agendas"), rich)
    enriched["npc_moves"] = _merge_npc_moves(enriched.get("npc_moves", []), npc_reactions)

    # P1-8: wire foreign-dialogue comprehension tier into the narration contract.
    # Only emits entries when an NPC in the scene carries a structured
    # foreign_dialogue marker; otherwise the directive key is omitted entirely.
    dialogue_comprehension = build_dialogue_comprehension_directive(
        scene,
        ctx.get("npc_agendas"),
        ctx.get("investigator"),
        investigator_skills=ctx.get("investigator_skills"),
    )
    if dialogue_comprehension:
        nd["dialogue_comprehension"] = dialogue_comprehension

    storylet_trigger = infer_storylet_trigger(enriched, ctx)
    storylet_moves: list[dict[str, Any]] = []
    storylet_scheduler: dict[str, Any] | None = None
    if coc_storylets is not None and storylet_trigger.get("triggered"):
        selection_ctx = _storylet_selection_context(ctx, storylet_trigger)
        storylet_scheduler = _storylet_scheduler_state(enriched, selection_ctx)
        if storylet_scheduler is not None:
            selection_ctx["story_need"] = storylet_scheduler["story_need"]
        storylet_moves = coc_storylets.select_storylet_moves(
            enriched,
            selection_ctx,
            seed=(selection_ctx.get("storylet_policy") or {}).get("seed", selection_ctx.get("session_seed", "storylet")),
            max_storylets=int((selection_ctx.get("storylet_policy") or {}).get("max_storylets", 1) or 1),
        )
    _apply_storylet_state(enriched, storylet_moves, storylet_trigger)

    incident_moves = build_incident_moves(
        ctx.get("incident_deck"),
        turn_number=int(ctx.get("turn_number", 0) or 0),
        scene_tags=list(scene.get("tags", []) or scene.get("tone", []) or []),
    )
    enriched["incident_moves"] = incident_moves
    enriched["narrative_enrichment"] = {"schema_version": _SCHEMA_VERSION}
    _update_enrichment_summary(
        enriched,
        choice_frame=choice_frame,
        proposal_transform=proposal_transform,
        chain_requests=chain_requests,
        roll_density_decisions=roll_density_decisions,
        npc_reactions=npc_reactions,
        storylet_trigger=storylet_trigger,
        storylet_scheduler=storylet_scheduler,
        incident_moves=incident_moves,
    )
    return enriched
