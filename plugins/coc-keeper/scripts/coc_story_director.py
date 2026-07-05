#!/usr/bin/env python3
"""COC Story Director — deterministic planner.

Each turn, reads rule state + scenario story-graph + player intent, produces
a DirectorPlan JSON guiding coc-keeper-play's narrative direction. Read-only
with respect to rule state; never modifies save/combat/sanity.

Spec: docs/superpowers/specs/2026-07-05-story-director-design.md
"""
from __future__ import annotations

import json
import random
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent


def _load_sibling(name: str, filename: str):
    import importlib.util
    spec = importlib.util.spec_from_file_location(name, SCRIPT_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module

coc_rule_signals = _load_sibling("coc_rule_signals", "coc_rule_signals.py")


def _read_json(path: Path, fallback: Any = None) -> Any:
    if not path.exists():
        return fallback
    return json.loads(path.read_text(encoding="utf-8"))


def build_director_context(
    campaign_dir: Path,
    character_path: Path,
    investigator_id: str,
    player_intent: str,
    player_intent_class: str,
    rng: random.Random | None = None,
) -> dict[str, Any]:
    """Assemble DirectorContext: rule signals + active scene + scenario graph.

    Read-only. Pulls investigator-state, character, world-state, flags,
    pacing-state, and the 7 scenario story-graph files.
    """
    rng = rng or random.Random()
    save = campaign_dir / "save"
    scenario = campaign_dir / "scenario"

    inv_state = _read_json(save / "investigator-state" / f"{investigator_id}.json", {})
    character = _read_json(character_path, {})
    world = _read_json(save / "world-state.json", {})
    pacing = _read_json(save / "pacing-state.json", {})
    module_meta = _read_json(scenario / "module-meta.json", {})
    story_graph = _read_json(scenario / "story-graph.json", {"scenes": []})

    # --- rule signals ---
    char_derived = character.get("derived", {})
    char_chars = character.get("characteristics", {})
    char_skills = character.get("skills", {})
    conditions = inv_state.get("conditions", []) or []
    current_hp = inv_state.get("current_hp", char_derived.get("HP", 10))
    max_hp = char_derived.get("HP", 10)
    current_san = inv_state.get("current_san", char_derived.get("SAN", 50))
    max_san = 99  # simplified; spec's believer-bomb is v2
    credit_rating = char_skills.get("Credit Rating", 0)
    app = char_chars.get("APP", 50)
    luck = char_chars.get("LUCK", 50)

    recent_intents = pacing.get("recent_intent_classes", [])
    rule_signals = {
        "hp_state": coc_rule_signals.read_hp_state(current_hp, max_hp, conditions),
        "sanity_state": coc_rule_signals.read_sanity_state(
            current_san, max_san,
            bout_active="bout_active" in conditions,
            lost_this_event=inv_state.get("san_lost_this_event", 0),
        ),
        "credit_tier": coc_rule_signals.read_credit_tier(credit_rating),
        "credit_rating": credit_rating,  # raw value for roll_npc_reaction
        "app": app,  # raw value for roll_npc_reaction
        "npc_reaction_roll": None,  # populated per-NPC at scoring time
        "luck_level": coc_rule_signals.read_luck_signal(luck, pacing.get("luck_spent_last", 0))[0],
        "luck_spent_last": pacing.get("luck_spent_last", 0) > 0,
        "last_roll_critical": False,
        "last_roll_fumble": False,
        "active_conditions": conditions,
        "stalled_turns": coc_rule_signals.read_stalled_turns(recent_intents),
        "tension_clock": coc_rule_signals.read_tension_clock(
            pacing.get("tension_level", "low"), pacing.get("lethal_chances_used", 0),
        ),
        "bout_active": "bout_active" in conditions,
    }

    # --- active scene ---
    active_scene_id = world.get("active_scene_id")
    scenes = story_graph.get("scenes", [])
    active_scene = next((s for s in scenes if s["scene_id"] == active_scene_id), None)

    return {
        "campaign_dir": campaign_dir,
        "investigator_id": investigator_id,
        "player_intent": player_intent,
        "player_intent_class": player_intent_class,
        "active_scene_id": active_scene_id,
        "active_scene": active_scene,
        "structure_type": module_meta.get("structure_type", "branching_investigation"),
        "module_meta": module_meta,
        "story_graph": story_graph,
        "clue_graph": _read_json(scenario / "clue-graph.json", {"conclusions": []}),
        "npc_agendas": _read_json(scenario / "npc-agendas.json", {"npcs": []}),
        "threat_fronts": _read_json(scenario / "threat-fronts.json", {"fronts": []}),
        "pacing_map": _read_json(scenario / "pacing-map.json", {"pacing_curve": []}),
        "improvisation_boundaries": _read_json(scenario / "improvisation-boundaries.json", {}),
        "world_state": world,
        "rule_signals": rule_signals,
        "rng": rng,
        "turn_number": pacing.get("turn_number", 0),
    }


def write_director_plan(plan: dict[str, Any], artifacts_dir: Path) -> Path:
    """Persist DirectorPlan to artifacts/<decision_id>.json. Returns path."""
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    out = artifacts_dir / f"{plan['decision_id']}.json"
    out.write_text(json.dumps(plan, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return out


# =============================================================================
# Three-layer scoring engine
# Spec: docs/superpowers/specs/2026-07-05-story-director-design.md
# =============================================================================

RULES_DIR = SCRIPT_DIR.parent / "references" / "rules-json"


def _load_structure_weights() -> dict[str, Any]:
    return _read_json(RULES_DIR / "structure-weights.json", {"weights": {}, "tiebreak_order": []})


ACTIONS = ["REVEAL", "DEEPEN", "PRESSURE", "CHARACTER", "CHOICE", "CUT", "MONTAGE", "SUBSYSTEM", "RECOVER", "PAYOFF"]


def _base_score(action: str, ctx: dict[str, Any]) -> float:
    """Layer 1: structure-agnostic trigger conditions. Returns 0.0-1.0."""
    scene = ctx.get("active_scene") or {}
    sig = ctx["rule_signals"]
    intent = ctx["player_intent_class"]
    clue_graph = ctx.get("clue_graph", {})
    discovered = set(ctx["world_state"].get("discovered_clue_ids", []))

    if action == "REVEAL":
        if intent != "investigate":
            return 0.0
        avail = [c for c in scene.get("available_clues", []) if c not in discovered]
        return 0.9 if avail else 0.0

    if action == "DEEPEN":
        if intent not in ("investigate", "social"):
            return 0.0
        return 0.5 if scene.get("dramatic_question") else 0.0

    if action == "PRESSURE":
        fronts = ctx.get("threat_fronts", {}).get("fronts", [])
        near_full = any(
            any(c.get("current_segments", 0) >= c.get("segments", 6) * 2 / 3
                for c in f.get("clocks", []))
            for f in fronts
        )
        return 0.8 if (near_full or sig["stalled_turns"] >= 1) else 0.2

    if action == "CHARACTER":
        npcs_in_scene = scene.get("npc_ids", [])
        agendas = ctx.get("npc_agendas", {}).get("npcs", [])
        has_agenda_npc = any(n["npc_id"] in npcs_in_scene and n.get("agenda") for n in agendas)
        return 0.7 if has_agenda_npc else 0.0

    if action == "CHOICE":
        if intent not in ("idle", "ambiguous", "stuck"):
            return 0.0
        avail = [c for c in scene.get("available_clues", []) if c not in discovered]
        return 0.7 if len(avail) >= 2 else 0.0

    if action == "CUT":
        # dramatic question answered OR exit condition met
        exit_met = any(_eval_exit(e, ctx) for e in scene.get("exit_conditions", []))
        return 0.8 if exit_met else 0.0

    if action == "MONTAGE":
        return 0.6 if intent == "montage" else 0.0

    if action == "SUBSYSTEM":
        return 0.9 if intent in ("combat", "flee", "cast") else 0.0

    if action == "RECOVER":
        return 0.85 if sig["stalled_turns"] >= 2 else 0.0

    if action == "PAYOFF":
        # v1: no memory layer; minimal — true if scene tone matches a prior cue
        return 0.0  # v1 leaves PAYOFF to v2 (memory layer)

    return 0.0


def _eval_exit(condition: str, ctx: dict[str, Any]) -> bool:
    """Heuristic exit-condition eval. v1 supports 'clue discovered' and 'pressure clock reaches N'."""
    discovered = set(ctx["world_state"].get("discovered_clue_ids", []))
    if "discovered" in condition:
        clue_id = condition.split()[0]
        return clue_id in discovered
    if "pressure clock reaches" in condition:
        try:
            n = int(condition.split("reaches")[-1].strip())
            fronts = ctx.get("threat_fronts", {}).get("fronts", [])
            return any(
                any(c.get("current_segments", 0) >= n for c in f.get("clocks", []))
                for f in fronts
            )
        except (ValueError, IndexError):
            return False
    return False


def apply_rule_signal_overrides(ctx: dict[str, Any]) -> dict[str, Any] | None:
    """Layer 3: hard overrides. Returns a forced action dict or None."""
    sig = ctx["rule_signals"]
    if sig["bout_active"]:
        return {"scene_action": "SUBSYSTEM", "subsystem": "sanity", "handoff": "rules",
                "rationale": "bout_active forces sanity subsystem"}
    if sig["hp_state"] == "dying":
        return {"scene_action": "SUBSYSTEM", "subsystem": "combat", "handoff": "rules",
                "rationale": "dying forces combat CON-clock + pressure",
                "extra_pressure": True}
    if sig["sanity_state"] == "temp_insane":
        return {"scene_action": "SUBSYSTEM", "subsystem": "sanity", "handoff": "rules",
                "rationale": "temp_insane triggers bout procedure"}
    if sig["last_roll_fumble"]:
        return {"scene_action": "PRESSURE", "handoff": "narration",
                "rationale": "fumble forces immediate misfortune, cannot be pushed off"}
    if sig["stalled_turns"] >= 3:
        return {"scene_action": "RECOVER", "handoff": "narration",
                "rationale": "3 stalled turns forces Idea Roll recovery valve"}
    return None


def select_action(ctx: dict[str, Any]) -> tuple[str, dict[str, float]]:
    """Three-layer scoring. Returns (chosen_action, scores_dict)."""
    overrides = apply_rule_signal_overrides(ctx)
    if overrides is not None:
        # Layer 3 hit — bypass scoring
        scores = {a: 0.0 for a in ACTIONS}
        scores[overrides["scene_action"]] = 1.0
        scores["_override"] = 1.0  # type: ignore
        return overrides["scene_action"], scores

    weights_cfg = _load_structure_weights()
    stype = ctx["structure_type"]
    weights = weights_cfg.get("weights", {}).get(stype, {})
    tiebreak = weights_cfg.get("tiebreak_order", ACTIONS)

    scores: dict[str, float] = {}
    for action in ACTIONS:
        base = _base_score(action, ctx)
        w = weights.get(action, 1.0)
        scores[action] = round(base * w, 4)

    # pick max; tiebreak by order
    max_score = max(scores.values()) if scores else 0.0
    if max_score <= 0.0:
        return "CHOICE", scores  # no-trigger default

    candidates = [a for a, s in scores.items() if s == max_score]
    if len(candidates) == 1:
        return candidates[0], scores
    for action in tiebreak:
        if action in candidates:
            return action, scores
    return candidates[0], scores


# =============================================================================
# DirectorPlan assembly
# =============================================================================

def _select_clue_policy(ctx: dict[str, Any], action: str) -> dict[str, Any]:
    """Choose reveal/withhold/fallback per clue-graph."""
    scene = ctx.get("active_scene") or {}
    discovered = set(ctx["world_state"].get("discovered_clue_ids", []))
    available = [c for c in scene.get("available_clues", []) if c not in discovered]
    secrets = ctx.get("improvisation_boundaries", {}).get("keeper_secrets", [])

    reveal = available[:1] if action == "REVEAL" and available else []
    # fallback: if stalled, pull an alternate route
    fallback = []
    if action == "RECOVER":
        for concl in ctx.get("clue_graph", {}).get("conclusions", []):
            not_found = [c["clue_id"] for c in concl.get("clues", []) if c["clue_id"] not in discovered]
            if not_found:
                fallback.append(not_found[0])
                break
    return {"reveal": reveal, "withhold": list(secrets), "fallback_routes": fallback,
            "clue_type": "obscured"}


def _disposition_to_tone(disposition: str) -> str:
    return {"helpful": "warm and cooperative",
            "neutral": "guarded but civil",
            "hostile": "cold and suspicious"}.get(disposition, "neutral")


def _build_npc_moves(ctx: dict[str, Any], action: str) -> list[dict[str, Any]]:
    """Activate NPCs in scene with agenda + disposition from rule signal."""
    scene = ctx.get("active_scene") or {}
    agendas = ctx.get("npc_agendas", {}).get("npcs", [])
    moves = []
    for npc_id in scene.get("npc_ids", []):
        agenda = next((n for n in agendas if n["npc_id"] == npc_id), None)
        if not agenda:
            continue
        reaction = coc_rule_signals.roll_npc_reaction(
            app=ctx["rule_signals"].get("app", 50),
            credit_rating=ctx["rule_signals"].get("credit_rating", 50),
            rng=ctx["rng"],
        ) if action == "CHARACTER" else None
        moves.append({
            "npc_id": npc_id,
            "agenda": agenda.get("agenda", ""),
            "emotional_tone": _disposition_to_tone(reaction["disposition"]) if reaction else "neutral",
            "secret_limit": f"do not reveal: {', '.join(agenda.get('secret', '').split()[:3])}" if agenda.get("secret") else "",
            "disposition_source": "rule_signal:npc_reaction_roll" if reaction else None,
        })
    return moves


def _build_pressure_moves(ctx: dict[str, Any], action: str) -> list[dict[str, Any]]:
    """Tick clocks when PRESSURE or stalled."""
    moves = []
    if action not in ("PRESSURE", "RECOVER") and ctx["rule_signals"]["stalled_turns"] < 1:
        return moves
    for front in ctx.get("threat_fronts", {}).get("fronts", []):
        for clock in front.get("clocks", []):
            current = clock.get("current_segments", 0)
            if current < clock.get("segments", 6):
                symptom = clock.get("on_tick_visible", ["tension rises"])
                idx = min(current, len(symptom) - 1) if symptom else 0
                moves.append({
                    "clock_id": clock["clock_id"], "tick": 1,
                    "visible_symptom": symptom[idx] if isinstance(symptom, list) and symptom else "tension rises",
                    "reason": f"stalled_{ctx['rule_signals']['stalled_turns']}_turns" if ctx["rule_signals"]["stalled_turns"] else "pressure_action",
                })
                break
        if moves:
            break
    return moves


def _build_rules_requests(ctx: dict[str, Any], action: str) -> list[dict[str, Any]]:
    """Request skill checks only when justified."""
    if action == "SUBSYSTEM":
        sig = ctx["rule_signals"]
        if sig["bout_active"] or sig["sanity_state"] == "temp_insane":
            return [{"kind": "sanity_check", "skill": "SAN", "reason": "bout procedure",
                     "difficulty": "regular", "bonus_penalty_dice": 0}]
        if sig["hp_state"] == "dying":
            return [{"kind": "characteristic_check", "skill": "CON", "reason": "death-clock CON roll",
                     "difficulty": "regular", "bonus_penalty_dice": 0}]
    if action == "REVEAL":
        # request Spot Hidden / Library Use if clue delivery requires it
        return [{"kind": "skill_check", "skill": "Spot Hidden", "reason": "obscured clue in scene",
                 "difficulty": "regular", "bonus_penalty_dice": 0}]
    return []


def generate_director_plan(ctx: dict[str, Any], decision_id: str) -> dict[str, Any]:
    """Produce full DirectorPlan. The core output of the director."""
    action, scores = select_action(ctx)
    overrides = apply_rule_signal_overrides(ctx)
    scene = ctx.get("active_scene") or {}

    handoff = "narration"
    subsystem = None
    if overrides:
        handoff = overrides.get("handoff", "narration")
        subsystem = overrides.get("subsystem")
    elif action == "SUBSYSTEM":
        handoff = "rules"
    elif action in ("REVEAL", "DEEPEN", "PRESSURE", "CHARACTER", "CHOICE", "CUT", "MONTAGE", "RECOVER", "PAYOFF"):
        handoff = "rules" if _build_rules_requests(ctx, action) else "narration"

    tension_delta = 1 if action in ("PRESSURE", "SUBSYSTEM") else (0 if action in ("REVEAL", "DEEPEN", "RECOVER") else -1)

    narrative_directives = {
        "tone": scene.get("tone", []),
        "must_include": [],
        "must_not_reveal": ctx.get("improvisation_boundaries", {}).get("keeper_secrets", []),
        "improvisation_allowed": ctx.get("improvisation_boundaries", {}).get("invent_allowed", []),
        "horror_escalation_stage": "wrongness",  # v1 static; pacing-map drives in v2
    }

    return {
        "decision_id": decision_id,
        "turn_input": {
            "player_intent": ctx["player_intent"],
            "player_intent_class": ctx["player_intent_class"],
            "active_scene_id": ctx["active_scene_id"],
            "turn_number": ctx["turn_number"],
        },
        "scene_action": action,
        "subsystem": subsystem,
        "dramatic_question": scene.get("dramatic_question", ""),
        "pacing_mode": "investigation" if action in ("REVEAL", "DEEPEN") else ("pressure" if action == "PRESSURE" else "social"),
        "tension_delta": tension_delta,
        "rule_signals": ctx["rule_signals"],
        "clue_policy": _select_clue_policy(ctx, action),
        "npc_moves": _build_npc_moves(ctx, action),
        "pressure_moves": _build_pressure_moves(ctx, action),
        "rules_requests": _build_rules_requests(ctx, action),
        "memory_reads": [],
        "memory_writes": [],
        "narrative_directives": narrative_directives,
        "handoff": handoff,
        "rationale": overrides["rationale"] if overrides else f"top-scored action {action} (score={scores.get(action, 0)})",
    }
