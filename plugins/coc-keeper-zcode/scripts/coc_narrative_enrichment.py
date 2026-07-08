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

    affordances = [a for a in _as_list(scene.get("affordances")) if isinstance(a, dict)]
    affordances = sorted(affordances, key=_route_priority, reverse=True)
    for idx, affordance in enumerate(affordances[:max_routes], start=1):
        route_id = _non_empty_str(affordance.get("id") or affordance.get("route_id")) or f"affordance-{idx}"
        routes.append({
            "route_id": route_id,
            "route_type": affordance.get("route_type", "scene_affordance"),
            "cue": affordance.get("cue") or affordance.get("player_visible_cue") or route_id,
            "visible_benefit": affordance.get("visible_benefit") or affordance.get("promise"),
            "visible_cost": affordance.get("visible_cost") or affordance.get("cost"),
            "visible_risk": affordance.get("visible_risk") or affordance.get("risk"),
            "clock_tick_on_choose": affordance.get("clock_tick_on_choose"),
            "reward_hint": affordance.get("reward_hint"),
            "forbidden_reveal": affordance.get("forbidden") or affordance.get("must_not_reveal"),
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
                "visible_benefit": "may advance the investigation",
                "visible_cost": None,
                "visible_risk": None,
                "clock_tick_on_choose": None,
                "reward_hint": None,
                "forbidden_reveal": None,
                "source": "clue_policy.leads",
            })

    must_surface_tradeoffs = any(
        route.get("visible_benefit") or route.get("visible_cost") or route.get("visible_risk")
        for route in routes
    )
    return {
        "schema_version": _SCHEMA_VERSION,
        "mode": "diegetic_cues",
        "routes": routes,
        "route_count": len(routes),
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

    return {
        "schema_version": _SCHEMA_VERSION,
        "why_stopped": why_stopped,
        "immediate_handles": handles,
        "handle_count": len(handles),
        "must_surface_handles": bool(handles),
        "pressure_if_ignored": _first_pressure_text(active_scene_state, contract),
        "npc_position": _npc_position_from_moves(turn),
        "forbidden_menu_rendering": True,
        "requires_keeper_rewrite": not bool(handles),
        "narration_rule": (
            "Before returning control to the player, surface the immediate_handles "
            "as concrete diegetic objects, routes, NPC posture, or visible pressure. "
            "Do not render a numbered menu unless the player asks."
        ),
        "source": "stop_actionability_contract",
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


def _atom_roll_contract(atom: dict[str, Any], atom_id: str) -> dict[str, Any]:
    goal = _non_empty_str(atom.get("goal") or atom.get("verb") or atom.get("intent")) or "resolve player action"
    failure = _non_empty_str(atom.get("failure_effect") or atom.get("stakes")) or "failure changes the fiction with a cost"
    group = _non_empty_str(atom.get("roll_density_group") or atom.get("target") or atom_id) or atom_id
    push_eligible = bool(atom.get("push_eligible", True))
    return {
        "schema_version": _SCHEMA_VERSION,
        "goal": goal,
        "success_effect": _non_empty_str(atom.get("success_effect")) or "the action succeeds cleanly",
        "failure_effect": failure,
        "failure_outcome_mode": _non_empty_str(atom.get("failure_outcome_mode")) or "goal_with_cost",
        "push_policy": {
            "eligible": push_eligible,
            "requires_changed_method": push_eligible,
            "keeper_must_foreshadow_failure": push_eligible,
        },
        "roll_density_group": group,
        "must_not": ["do not narrate no progress on ordinary failure"],
    }


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


def build_action_chain_requests(
    player_intent_rich: dict[str, Any] | None,
    *,
    max_requests: int = 3,
) -> list[dict[str, Any]]:
    """Convert semantic ``action_atoms`` into a bounded chain of roll requests.

    The function only consumes structured atoms produced upstream by the intent
    evaluator; it does not split or classify free-text itself. Each atom should
    represent an action with distinct risk and stakes. Atoms without a skill (or
    explicit ``requires_roll`` false) remain narration-only.
    """
    rich = player_intent_rich or {}
    atoms = [a for a in _as_list(rich.get("action_atoms")) if isinstance(a, dict)]
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

        req: dict[str, Any] = {
            "kind": _infer_request_kind(atom, skill),
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
                "conflict_level": "high",
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
                "conflict_level": "high",
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
        for move in storylet_moves:
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


def enrich_storylets_after_rules(plan: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    """Add storylets after rule results are known.

    The pre-rules enrichment pass builds action-chain roll requests. This pass
    runs after those rolls are backfilled so true critical successes and fumbles
    can trigger storylets without making every ordinary turn draw an event card.
    """
    enriched = deepcopy(plan)
    existing_moves = [m for m in _as_list(enriched.get("storylet_moves")) if isinstance(m, dict)]
    trigger = infer_storylet_trigger(enriched, ctx)
    if existing_moves or not trigger.get("triggered") or coc_storylets is None:
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

    choice_frame = build_choice_frame(scene, enriched.get("clue_policy"))
    enriched["choice_frame"] = choice_frame
    nd = enriched.setdefault("narrative_directives", {})
    nd["choice_frame"] = choice_frame
    nd["consequence_cues"] = build_consequence_cues(choice_frame)

    proposal_transform = build_proposal_transform(rich)
    if proposal_transform is not None:
        enriched["proposal_transform"] = proposal_transform
        nd["proposal_transform"] = proposal_transform
        if proposal_transform["next_contract"] == "request_roll":
            enriched["handoff"] = "rules" if enriched.get("rules_requests") else enriched.get("handoff", "narration")

    chain_requests = build_action_chain_requests(rich)
    roll_density_decisions = [
        req["density_decision"]
        for req in chain_requests
        if isinstance(req.get("density_decision"), dict)
    ]
    if roll_density_decisions:
        enriched["roll_density_decisions"] = roll_density_decisions
        nd["roll_density_decisions"] = roll_density_decisions
    if chain_requests:
        existing = enriched.setdefault("rules_requests", [])
        existing.extend(chain_requests)
        enriched["handoff"] = "rules"

    npc_reactions = build_npc_reaction_moves(scene, ctx.get("npc_agendas"), rich)
    enriched["npc_moves"] = _merge_npc_moves(enriched.get("npc_moves", []), npc_reactions)

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
