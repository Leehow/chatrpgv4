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
from typing import Any

_SCHEMA_VERSION = 1
_CHARACTERISTICS = {"STR", "CON", "SIZ", "DEX", "APP", "INT", "POW", "EDU", "LUCK"}


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


def _infer_request_kind(atom: dict[str, Any], skill: str | None) -> str:
    if atom.get("kind"):
        return str(atom["kind"])
    if atom.get("opposed_skill") or atom.get("opposed_by"):
        return "opposed_check"
    if skill and skill.upper() in _CHARACTERISTICS:
        return "characteristic_check"
    return "skill_check"


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

    for idx, atom in enumerate(atoms, start=1):
        if atom.get("requires_roll") is False:
            continue
        skill = _non_empty_str(atom.get("skill") or atom.get("roll_skill"))
        if not skill and not atom.get("kind"):
            continue
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
        }
        if atom.get("opposed_skill"):
            req["opposed_skill"] = atom.get("opposed_skill")
        if atom.get("opposed_by"):
            req["opposed_by"] = atom.get("opposed_by")
        requests.append(req)
        if len(requests) >= max_requests:
            break

    if len([a for a in atoms if isinstance(a, dict) and a.get("requires_roll") is not False]) > len(requests) and requests:
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
    for key in ("secondary_intents", "target_entities"):
        for value in _as_list(rich.get(key)):
            text = _non_empty_str(value)
            if text:
                tags.add(text)
                tags.add(f"{key[:-1]}:{text}")
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

    chain_requests = build_action_chain_requests(rich)
    if chain_requests:
        existing = enriched.setdefault("rules_requests", [])
        existing.extend(chain_requests)
        enriched["handoff"] = "rules"

    npc_reactions = build_npc_reaction_moves(scene, ctx.get("npc_agendas"), rich)
    enriched["npc_moves"] = _merge_npc_moves(enriched.get("npc_moves", []), npc_reactions)

    incident_moves = build_incident_moves(
        ctx.get("incident_deck"),
        turn_number=int(ctx.get("turn_number", 0) or 0),
        scene_tags=list(scene.get("tags", []) or scene.get("tone", []) or []),
    )
    enriched["incident_moves"] = incident_moves
    enriched["narrative_enrichment"] = {
        "schema_version": _SCHEMA_VERSION,
        "choice_frame": bool(choice_frame.get("routes")),
        "action_chain_requests": len(chain_requests),
        "npc_reactions": sum(len(m.get("active_reactions", []) or []) for m in npc_reactions),
        "incident_moves": len(incident_moves),
    }
    return enriched
