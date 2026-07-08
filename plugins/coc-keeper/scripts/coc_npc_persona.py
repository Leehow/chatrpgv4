#!/usr/bin/env python3
"""Generic NPC social duty and persona helpers.

The core engine consumes abstract social duty fields and persona tags. Concrete
titles, jobs, and setting labels belong in scenario data, not in this module.
"""
from __future__ import annotations

import hashlib
import json
import random
from typing import Any


DEFAULT_SOCIAL_ROLE = {
    "authority_scope": [],
    "responsibility_domains": [],
    "chain_of_command": {"to_pc": "none", "to_group": "none"},
    "duty_pressure": [],
    "initiative_style": "consultative",
    "delegation_policy": {"keeps": [], "delegates": []},
}

DEFAULT_PERSONA_WEIGHTS = {
    "temperament.cautious": 1,
    "voice.plain_spoken": 1,
    "stress_response.seek_help": 1,
}

ACTIVE_SCENE_TAGS = {
    "crisis",
    "danger",
    "injury",
    "evidence_at_risk",
    "command_decision",
    "public_pressure",
}

INITIATIVE_STYLES_THAT_ACT = {"decisive", "protective", "procedural", "commanding"}
INTENT_TAGS_THAT_INVITE_ACTION = {"low_agency_continue", "asks_npc_to_decide", "yield_initiative"}

# P1-5: 当前 action → 优先 scope（结构化映射，非扫 prose）
_INTENT_TO_PREFERRED_SCOPE = {
    "combat": "scene_safety",
    "flee": "scene_safety",
    "investigate": "specialist_interpretation",
    "social": "specialist_interpretation",
}


def _as_list(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def _stable_seed(seed_parts: list[Any] | tuple[Any, ...]) -> int:
    raw = "|".join(str(part) for part in seed_parts).encode("utf-8")
    return int(hashlib.sha256(raw).hexdigest()[:16], 16)


def _seed_string(seed_parts: list[Any] | tuple[Any, ...]) -> str:
    return "|".join(str(part) for part in seed_parts)


def _deep_merge_dict(base: dict[str, Any], overlay: dict[str, Any]) -> dict[str, Any]:
    merged = dict(base)
    for key, value in overlay.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _deep_merge_dict(merged[key], value)
        else:
            merged[key] = value
    return merged


def _json_clone(value: Any) -> Any:
    return json.loads(json.dumps(value, ensure_ascii=False))


def _normalize_social_role(raw: dict[str, Any] | None) -> dict[str, Any]:
    role = _deep_merge_dict(DEFAULT_SOCIAL_ROLE, raw or {})
    for key in ("authority_scope", "responsibility_domains", "duty_pressure"):
        role[key] = [str(item) for item in _as_list(role.get(key)) if str(item)]
    policy = role.get("delegation_policy") or {}
    role["delegation_policy"] = {
        "keeps": [str(item) for item in _as_list(policy.get("keeps")) if str(item)],
        "delegates": [str(item) for item in _as_list(policy.get("delegates")) if str(item)],
    }
    chain = role.get("chain_of_command") or {}
    role["chain_of_command"] = {
        "to_pc": str(chain.get("to_pc") or "none"),
        "to_group": str(chain.get("to_group") or "none"),
    }
    role["initiative_style"] = str(role.get("initiative_style") or "consultative")
    return role


def _grouped_tag_weights(weights: dict[str, Any]) -> dict[str, dict[str, float]]:
    grouped: dict[str, dict[str, float]] = {}
    for tag, raw_weight in weights.items():
        if "." not in str(tag):
            continue
        group = str(tag).split(".", 1)[0]
        try:
            weight = float(raw_weight)
        except (TypeError, ValueError):
            continue
        if weight <= 0:
            continue
        grouped.setdefault(group, {})[str(tag)] = weight
    return grouped


def _weighted_choice(rng: random.Random, weights: dict[str, float]) -> str:
    total = sum(weights.values())
    mark = rng.random() * total
    acc = 0.0
    for tag, weight in sorted(weights.items()):
        acc += weight
        if mark <= acc:
            return tag
    return sorted(weights)[-1]


def _choose_persona_rolls(weights: dict[str, Any], seed_parts: list[Any] | tuple[Any, ...]) -> dict[str, dict[str, Any]]:
    rng = random.Random(_stable_seed(seed_parts))
    grouped = _grouped_tag_weights(weights or DEFAULT_PERSONA_WEIGHTS)
    if not grouped:
        grouped = _grouped_tag_weights(DEFAULT_PERSONA_WEIGHTS)
    rolls: dict[str, dict[str, Any]] = {}
    for group in sorted(grouped):
        result = _weighted_choice(rng, grouped[group])
        rolls[group] = {
            "table": f"npc-core-tags.{group}",
            "result": result,
        }
    return rolls


def _tags_from_rolls(rolls: dict[str, dict[str, Any]]) -> list[str]:
    return [str(rolls[group]["result"]) for group in sorted(rolls)]


def _name_record(npc: dict[str, Any], context: dict[str, Any] | None) -> dict[str, Any]:
    context = context or {}
    name_context = dict(context.get("name_context") or {})
    name_context.update(npc.get("name_context") or {})
    if context.get("era") and "era" not in name_context:
        name_context["era"] = context.get("era")
    value = npc.get("name") or npc.get("display_name")
    if value:
        status = "provided"
        source = "scenario_data"
    else:
        status = "pending_llm"
        source = "name_context"
    return {
        "status": status,
        "value": value,
        "source": source,
        "context": name_context,
    }


def build_persona_card(
    npc: dict[str, Any],
    *,
    seed_parts: list[Any] | tuple[Any, ...],
    context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build a seed-stable persona card from structured NPC data."""
    npc_id = str(npc.get("npc_id") or "")
    social_role = _normalize_social_role(npc.get("social_role"))
    weights = dict(DEFAULT_PERSONA_WEIGHTS)
    weights.update(npc.get("persona_tag_weights") or {})
    persona_seed_parts = [*seed_parts, "persona"]
    rolls = _choose_persona_rolls(weights, persona_seed_parts)
    tags = _tags_from_rolls(rolls)
    context = context or {}
    return {
        "schema_version": 1,
        "npc_id": npc_id,
        "lifecycle": str(npc.get("lifecycle") or "persistent"),
        "name": _name_record(npc, context),
        "social_role": social_role,
        "persona": {
            "tags": tags,
            "surface_cues": [str(item) for item in _as_list(npc.get("surface_cues")) if str(item)],
        },
        "generation": {
            "seed": _seed_string(persona_seed_parts),
            "inputs": {
                "campaign_id": context.get("campaign_id"),
                "scene_id": context.get("scene_id"),
                "module_id": context.get("module_id"),
                "era": context.get("era"),
                "location_tags": [str(item) for item in _as_list(context.get("location_tags")) if str(item)],
                "role_hint": context.get("role_hint"),
                "authority_demands": [str(item) for item in _as_list(context.get("authority_demands")) if str(item)],
            },
            "rolls": rolls,
        },
        "source": "npc-agendas.social_role",
    }


def _generation_log(card: dict[str, Any]) -> dict[str, Any]:
    generation = card.get("generation") or {}
    return {
        "event_type": "npc_generation",
        "npc_id": card.get("npc_id"),
        "lifecycle": card.get("lifecycle"),
        "source": "scene_present_npc_missing_state",
        "seed": generation.get("seed"),
        "inputs": generation.get("inputs") or {},
        "rolls": generation.get("rolls") or {},
        "social_role": card.get("social_role") or {},
        "persona": card.get("persona") or {},
        "name": card.get("name") or {},
    }


def instantiate_npc(
    npc: dict[str, Any],
    *,
    context: dict[str, Any] | None,
    seed_parts: list[Any] | tuple[Any, ...],
) -> dict[str, Any]:
    """Instantiate a persistent NPC card with generation audit data."""
    npc_payload = dict(npc)
    npc_payload.setdefault("lifecycle", "silhouette")
    card = build_persona_card(npc_payload, seed_parts=seed_parts, context=context)
    card["generation_log"] = _generation_log(card)
    return card


def apply_llm_name(card: dict[str, Any], name: str) -> dict[str, Any]:
    """Attach an LLM-supplied display name without changing rules-facing data."""
    updated = _json_clone(card)
    current = updated.get("name") if isinstance(updated.get("name"), dict) else {}
    updated["name"] = {
        **current,
        "status": "generated",
        "value": str(name),
        "source": "llm_name_context",
    }
    if isinstance(updated.get("generation_log"), dict):
        updated["generation_log"]["name"] = updated["name"]
    return updated


def _find_archetype(archetypes: dict[str, Any], archetype_id: str) -> dict[str, Any]:
    for archetype in archetypes.get("archetypes", []) or []:
        if isinstance(archetype, dict) and archetype.get("archetype_id") == archetype_id:
            return archetype
    raise ValueError(f"unknown NPC stat archetype: {archetype_id}")


def _roll_range(rng: random.Random, value: Any) -> int:
    if not isinstance(value, list) or len(value) != 2:
        raise ValueError("stat archetype ranges must be [min, max]")
    low = int(value[0])
    high = int(value[1])
    if high < low:
        low, high = high, low
    return rng.randint(low, high)


def _derived_stats(characteristics: dict[str, int]) -> dict[str, int]:
    con = int(characteristics.get("CON", 50))
    siz = int(characteristics.get("SIZ", 50))
    pow_value = int(characteristics.get("POW", 50))
    return {
        "HP": max(1, (con + siz) // 10),
        "MP": max(0, pow_value // 5),
        "SAN": max(0, pow_value),
    }


def upgrade_npc_stats(
    card: dict[str, Any],
    archetypes: dict[str, Any],
    *,
    archetype_id: str,
    reason: str,
    seed_parts: list[Any] | tuple[Any, ...],
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Promote an NPC silhouette into a rules-facing actor with audit data."""
    archetype = _find_archetype(archetypes, archetype_id)
    rng = random.Random(_stable_seed([*seed_parts, archetype_id]))
    characteristics = {
        str(key): _roll_range(rng, value)
        for key, value in (archetype.get("characteristics") or {}).items()
    }
    key_skills = {
        str(key): _roll_range(rng, value)
        for key, value in (archetype.get("skills") or {}).items()
    }
    derived = _derived_stats(characteristics)
    previous_lifecycle = str(card.get("lifecycle") or "silhouette")
    to_lifecycle = str(archetype.get("to_lifecycle") or "mechanical_actor")

    upgraded = _json_clone(card)
    upgraded["lifecycle"] = to_lifecycle
    upgraded["stat_profile"] = {
        "archetype_id": archetype_id,
        "characteristics": characteristics,
        "derived": derived,
        "key_skills": key_skills,
        "source": "core.npc.stat_archetypes",
    }

    log = {
        "event_type": "npc_stat_upgrade",
        "npc_id": upgraded.get("npc_id"),
        "from_lifecycle": previous_lifecycle,
        "to_lifecycle": to_lifecycle,
        "reason": str(reason),
        "archetype": archetype_id,
        "seed": _seed_string([*seed_parts, archetype_id]),
        "generated_stats": {
            **characteristics,
            **derived,
            "key_skills": key_skills,
        },
        "rule_refs": ["core.npc.stat_archetypes"],
    }
    return upgraded, log


def scene_context_from_scene(scene: dict[str, Any] | None) -> dict[str, list[str]]:
    """Extract abstract scene demands from structured scene data."""
    scene = scene or {}
    return {
        "scene_tags": [str(item) for item in _as_list(scene.get("scene_tags") or scene.get("tags")) if str(item)],
        "authority_demands": [str(item) for item in _as_list(scene.get("authority_demands")) if str(item)],
        "responsibility_threats": [str(item) for item in _as_list(scene.get("responsibility_threats")) if str(item)],
    }


def _intent_tags(player_intent_rich: dict[str, Any] | None) -> set[str]:
    rich = player_intent_rich or {}
    tags = set(str(item) for item in _as_list(rich.get("intent_tags")) if str(item))
    for key in ("primary_intent", "risk_posture"):
        value = rich.get(key)
        if value:
            tags.add(str(value))
    tags.update(str(item) for item in _as_list(rich.get("secondary_intents")) if str(item))
    return tags


def _agency_move(
    *,
    persona_card: dict[str, Any],
    move_id: str,
    reason: str,
    visibility: str = "player_visible",
    rules_effect: dict[str, Any] | None = None,
    **extra: Any,
) -> dict[str, Any]:
    return {
        "npc_id": persona_card.get("npc_id"),
        "move_id": move_id,
        "visibility": visibility,
        "reason": reason,
        "persona_tags": list((persona_card.get("persona") or {}).get("tags") or []),
        "rules_effect": rules_effect or {"kind": "none", "actor_role": "npc"},
        **extra,
    }


def build_agency_moves(
    persona_card: dict[str, Any],
    scene_context: dict[str, Any],
    player_intent_rich: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    """Return visible NPC agency moves warranted by duty and scene pressure."""
    role = persona_card.get("social_role") or {}
    authority_scope = set(str(item) for item in _as_list(role.get("authority_scope")) if str(item))
    responsibility = set(str(item) for item in _as_list(role.get("responsibility_domains")) if str(item))
    demands = set(str(item) for item in _as_list(scene_context.get("authority_demands")) if str(item))
    threats = set(str(item) for item in _as_list(scene_context.get("responsibility_threats")) if str(item))
    scene_tags = set(str(item) for item in _as_list(scene_context.get("scene_tags")) if str(item))
    intent_tags = _intent_tags(player_intent_rich)
    initiative = str(role.get("initiative_style") or "consultative")

    matched_scope = sorted(authority_scope & demands)
    matched_threat = sorted(responsibility & threats)
    scene_is_active = bool(
        matched_threat
        or scene_tags & ACTIVE_SCENE_TAGS
        or intent_tags & INTENT_TAGS_THAT_INVITE_ACTION
    )
    persona_tags = set(str(item) for item in ((persona_card.get("persona") or {}).get("tags") or []))
    moves: list[dict[str, Any]] = []
    if "stress_response.panic" in persona_tags and scene_is_active:
        moves.append(_agency_move(
            persona_card=persona_card,
            move_id="panic",
            reason="persona_stress_response_matches_active_scene",
        ))
        return moves

    should_act = bool(matched_scope and scene_is_active and initiative != "avoidant")
    if initiative not in INITIATIVE_STYLES_THAT_ACT and not matched_threat:
        should_act = False
    if not should_act:
        return []

    # P1-5: scope prefers an authority item matching the current action; falls
    # back to the static sorted[0] when no action-matched scope is available.
    preferred_scope = None
    intent = str((player_intent_rich or {}).get("primary_intent") or "")
    wanted = _INTENT_TO_PREFERRED_SCOPE.get(intent)
    if wanted and wanted in matched_scope:
        preferred_scope = wanted
    scope = preferred_scope or (matched_scope[0] if matched_scope else None)
    if initiative == "protective" and matched_threat:
        moves.append(_agency_move(
            persona_card=persona_card,
            move_id="protect",
            reason="protective_initiative_matches_responsibility_threat",
            matched_responsibility=matched_threat,
            agency_directive="NPC protects a responsibility domain before asking for specialist input.",
        ))
    moves.append(_agency_move(
        persona_card=persona_card,
        move_id="take_command",
        reason="authority_scope_matches_scene",
        matched_authority_scope=matched_scope,
        matched_responsibility=matched_threat,
        delegation_policy=role.get("delegation_policy") or {},
        agency_directive="NPC visibly takes responsibility within abstract authority before specialist handoff.",
        rules_effect={
            "kind": "npc_assist",
            "actor_role": "npc",
            "bonus_dice": 1,
            "scope": scope,
            "reason": "visible responsibility within authority",
        },
    ))
    if {"reckless_plan", "dangerous_plan", "unsafe_action"} & intent_tags and (
        "temperament.cautious" in persona_tags or matched_scope
    ):
        moves.append(_agency_move(
            persona_card=persona_card,
            move_id="object",
            reason="structured_intent_risk_conflicts_with_duty_or_cautious_persona",
            matched_authority_scope=matched_scope,
            agency_directive="NPC objects to the visible risk without blocking every viable version of the plan.",
        ))
    if {"requests_help", "asks_for_assist", "specialist_care"} & intent_tags:
        moves.append(_agency_move(
            persona_card=persona_card,
            move_id="assist",
            reason="structured_intent_requests_help_within_scene_pressure",
            matched_authority_scope=matched_scope,
            rules_effect={
                "kind": "npc_assist",
                "actor_role": "npc",
                "bonus_dice": 1,
                "scope": scope,
                "reason": "direct assistance within abstract duty",
            },
        ))
    if "temperament.secretive" in persona_tags and (
        "evidence_at_risk" in scene_tags or "public_pressure" in scene_tags or matched_threat
    ):
        moves.append(_agency_move(
            persona_card=persona_card,
            move_id="withhold",
            reason="secretive_persona_under_active_pressure",
            agency_directive="NPC visibly holds back information or cooperation until trust, leverage, or safety changes.",
        ))
    if "stress_response.rush" in persona_tags and scene_is_active:
        moves.append(_agency_move(
            persona_card=persona_card,
            move_id="rush",
            reason="persona_stress_response_pushes_too_fast",
            agency_directive="NPC acts too quickly under pressure, creating opportunity or complication.",
        ))
    delegates = set(str(item) for item in _as_list((role.get("delegation_policy") or {}).get("delegates")) if str(item))
    if delegates & intent_tags:
        moves.append(_agency_move(
            persona_card=persona_card,
            move_id="delegate_specialist",
            reason="delegation_policy_matches_structured_intent",
            matched_delegation=sorted(delegates & intent_tags),
            delegation_policy=role.get("delegation_policy") or {},
        ))
    return moves


def rules_requests_from_agency_moves(agency_moves: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Convert agency rules effects into rules-layer requests."""
    requests: list[dict[str, Any]] = []
    for move in agency_moves:
        effect = move.get("rules_effect") or {}
        if effect.get("kind") != "npc_assist":
            continue
        requests.append({
            "kind": "npc_assist",
            "actor_role": "npc",
            "npc_id": move.get("npc_id"),
            "bonus_dice": int(effect.get("bonus_dice", 0) or 0),
            "scope": effect.get("scope"),
            "reason": effect.get("reason"),
            "source": "npc_agency_move",
        })
    return requests


def build_scene_npc_agency(
    scene: dict[str, Any] | None,
    npc_agendas: dict[str, Any] | None,
    npc_state: dict[str, Any] | None,
    *,
    seed_parts: list[Any] | tuple[Any, ...],
    player_intent_rich: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build persona cards and agency moves for the NPCs present in a scene."""
    scene = scene or {}
    npc_agendas = npc_agendas or {}
    npc_state = npc_state or {}
    present = set(str(item) for item in _as_list(scene.get("npc_ids")) if str(item))
    stored = npc_state.get("npcs") if isinstance(npc_state.get("npcs"), dict) else {}
    scene_context = scene_context_from_scene(scene)
    writes: list[dict[str, Any]] = []
    by_npc: dict[str, dict[str, Any]] = {}

    for npc in npc_agendas.get("npcs", []) or []:
        npc_id = str(npc.get("npc_id") or "")
        if npc_id not in present:
            continue
        card = stored.get(npc_id)
        if not isinstance(card, dict):
            context = {
                "campaign_id": seed_parts[0] if len(seed_parts) > 0 else None,
                "scene_id": scene.get("scene_id"),
                "module_id": scene.get("module_id"),
                "era": scene.get("era"),
                "location_tags": scene.get("location_tags") or scene.get("tags") or [],
                "role_hint": npc.get("role_hint"),
                "authority_demands": scene_context.get("authority_demands", []),
                "name_context": npc.get("name_context") or {},
            }
            card = instantiate_npc(npc, context=context, seed_parts=[*seed_parts, npc_id])
            writes.append(card)
        agency_moves = build_agency_moves(card, scene_context, player_intent_rich)
        by_npc[npc_id] = {"persona_card": card, "agency_moves": agency_moves}

    return {
        "schema_version": 1,
        "npc_state_writes": writes,
        "by_npc": by_npc,
    }
