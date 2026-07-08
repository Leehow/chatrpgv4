#!/usr/bin/env python3
"""Deterministic storylet/event selection for COC Keeper play.

A storylet is a small, reusable plot beat. It must enrich the current module
rather than replace it: every selected beat owes the main scenario a debt by
serving at least one clue, NPC agenda, threat front, choice, recovery valve, or
scenario theme. This module is side-effect-free; it returns both the selected
moves and a ledger patch that the caller may persist after narration.
"""
from __future__ import annotations

import hashlib
import json
import random
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
RULES_DIR = SCRIPT_DIR.parent / "references" / "rules-json"
_SCHEMA_VERSION = 1

CONFLICT_LEVELS = ["low", "medium", "high", "climax"]
_CONFLICT_RANK = {level: idx for idx, level in enumerate(CONFLICT_LEVELS)}
_DEFAULT_SERVE_KEYS = {
    "mainline", "can_reveal_clue", "can_tick_front", "can_deepen_npc",
    "can_surface_choice", "can_offer_recovery", "theme",
}

_NEED_DECKS: dict[str, list[str]] = {
    "clue_delivery": ["clue_delivery", "clue_reinforcement", "investigation"],
    "front_pressure": ["front_pressure", "pressure", "threat_front"],
    "scene_pressure": ["scene_pressure", "pressure"],
    "character_beat": ["character_beat", "npc", "relationship"],
    "choice_pressure": ["choice_pressure", "choice", "route_cost"],
    "recovery_redirection": ["recovery_redirection", "recovery", "clue_redirection"],
    "complication": ["complication", "failure_consequence", "pressure"],
    "opportunity": ["opportunity", "critical_success", "payoff"],
    "transition_bridge": ["transition_bridge", "return_hook"],
    "theme_echo": ["theme_echo", "ambience"],
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


def _stable_int_seed(seed: Any, *parts: Any) -> int:
    raw = "|".join(str(p) for p in (seed,) + parts)
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    return int(digest[:16], 16)


def load_storylet_library(path: Path | None = None) -> dict[str, Any]:
    """Load a storylet library JSON, falling back to the packaged default."""
    lib_path = path or (RULES_DIR / "storylet-library.json")
    if not lib_path.exists():
        return {"schema_version": _SCHEMA_VERSION, "storylets": []}
    return json.loads(lib_path.read_text(encoding="utf-8"))


def normalize_storylet_ledger(ledger: dict[str, Any] | None) -> dict[str, Any]:
    """Return a defensive ledger shape for anti-repeat checks."""
    ledger = dict(ledger or {})
    ledger.setdefault("used_storylets", [])
    ledger.setdefault("used_families", [])
    ledger.setdefault("used_tropes", [])
    ledger.setdefault("recent_families", [])
    ledger.setdefault("recent_tropes", [])
    ledger.setdefault("used_targets", [])
    ledger.setdefault("turn_number", 0)
    return ledger


def _has_pressure_tick(plan: dict[str, Any]) -> bool:
    for move in _as_list(plan.get("pressure_moves")):
        if not isinstance(move, dict):
            continue
        try:
            if int(move.get("tick", 0) or 0) > 0:
                return True
        except (TypeError, ValueError):
            continue
    return False


def _active_npc_reactions(plan: dict[str, Any]) -> bool:
    for move in _as_list(plan.get("npc_moves")):
        if isinstance(move, dict) and move.get("active_reactions"):
            return True
    return False


def infer_story_need(plan: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    """Infer the story function that should be served before rolling a card.

    This is the scheduler layer: it decides whether the current event window
    needs clue delivery, front pressure, character life, recovery, etc. The
    weighted storylet roll then happens only inside matching decks.
    """
    policy = ctx.get("storylet_policy") or {}
    explicit = _non_empty_str(policy.get("story_need") or policy.get("need_id"))
    if explicit:
        decks = list(dict.fromkeys(_as_list(policy.get("candidate_decks")) or _NEED_DECKS.get(explicit, [explicit])))
        return {
            "schema_version": _SCHEMA_VERSION,
            "need_id": explicit,
            "story_functions": [explicit],
            "candidate_decks": decks,
            "reason": "storylet_policy",
            "source": "story_need_scheduler",
        }

    trigger = ctx.get("storylet_trigger") or {}
    trigger_reason = _non_empty_str(trigger.get("reason"))
    trigger_polarity = _non_empty_str(trigger.get("polarity") or policy.get("polarity"))
    if trigger_reason == "fumble" and trigger_polarity == "positive":
        need_id = "opportunity"
        reason = "fumble_positive"
    elif trigger_reason in {"fumble", "risky_failure"}:
        need_id = "complication"
        reason = trigger_reason
    elif trigger_reason == "critical_success":
        need_id = "opportunity"
        reason = trigger_reason
    else:
        action = plan.get("scene_action")
        signals = (ctx.get("rule_signals") or {}) | (plan.get("rule_signals") or {})
        if action == "REVEAL" and _available_clues(plan, ctx):
            need_id = "clue_delivery"
            reason = "director_reveal"
        elif action == "RECOVER" or int(signals.get("stalled_turns", 0) or 0) >= 3:
            need_id = "recovery_redirection"
            reason = "recovery_or_stall"
        elif action == "PRESSURE" and ((ctx.get("threat_fronts") or {}).get("fronts") or _has_pressure_tick(plan)):
            need_id = "front_pressure"
            reason = "director_pressure"
        elif action == "PRESSURE" or _has_scene_pressure(ctx):
            need_id = "scene_pressure"
            reason = "scene_pressure"
        elif action == "CHARACTER" or _active_npc_reactions(plan):
            need_id = "character_beat"
            reason = "npc_or_character_action"
        elif action == "CHOICE":
            need_id = "choice_pressure"
            reason = "choice_frame"
        elif action == "CUT" or plan.get("scene_transition"):
            need_id = "transition_bridge"
            reason = "scene_transition"
        else:
            need_id = "theme_echo"
            reason = "default_theme_echo"

    return {
        "schema_version": _SCHEMA_VERSION,
        "need_id": need_id,
        "story_functions": [need_id],
        "candidate_decks": list(_NEED_DECKS.get(need_id, [need_id])),
        "reason": reason,
        "source": "story_need_scheduler",
    }


def infer_conflict_level(plan: dict[str, Any], ctx: dict[str, Any]) -> str:
    """Infer the desired conflict tier from DirectorPlan and pacing state."""
    policy = ctx.get("storylet_policy") or {}
    explicit = policy.get("conflict_level") or policy.get("target_conflict_level")
    if explicit in _CONFLICT_RANK:
        return explicit

    action = plan.get("scene_action")
    pacing_mode = plan.get("pacing_mode")
    tension_level = (
        (plan.get("rule_signals") or {}).get("tension_level")
        or ((plan.get("rule_signals") or {}).get("tension_clock") or {}).get("tension_level")
        or (ctx.get("world_state") or {}).get("tension_level")
        or "low"
    )
    horror_stage = ((plan.get("narrative_directives") or {}).get("horror_escalation_stage") or "wrongness")

    if pacing_mode == "climax" or tension_level == "climax" or horror_stage == "revelation":
        return "climax"
    if action in ("SUBSYSTEM", "PRESSURE") or tension_level == "high":
        return "high"
    if action in ("CHARACTER", "CHOICE", "CUT") or pacing_mode in ("social", "pressure"):
        return "medium"
    return "low"


def _level_allowed(storylet_level: str, target_level: str, policy: dict[str, Any]) -> bool:
    rank = _CONFLICT_RANK.get(storylet_level, 0)
    target_rank = _CONFLICT_RANK.get(target_level, 0)
    if policy.get("allow_higher_conflict"):
        max_rank = min(len(CONFLICT_LEVELS) - 1, target_rank + int(policy.get("higher_conflict_window", 1)))
    else:
        max_rank = target_rank
    min_rank = max(0, target_rank - int(policy.get("lower_conflict_window", 1)))
    return min_rank <= rank <= max_rank


def _storylet_serves_scenario(storylet: dict[str, Any]) -> bool:
    serves = storylet.get("serves") or {}
    if isinstance(serves, list):
        return bool(serves)
    if not isinstance(serves, dict):
        return False
    return any(bool(serves.get(key)) for key in _DEFAULT_SERVE_KEYS)


def _storylet_story_functions(storylet: dict[str, Any]) -> set[str]:
    explicit = set()
    for key in ("story_functions", "story_function", "storylet_functions", "plot_functions"):
        for value in _as_list(storylet.get(key)):
            text = _non_empty_str(value)
            if text:
                explicit.add(text)
    if explicit:
        return explicit

    serves = storylet.get("serves") or {}
    req = storylet.get("requires") or {}
    inferred: set[str] = set()
    controlled_ids = " ".join(
        str(storylet.get(key) or "").lower()
        for key in ("storylet_id", "family_id", "trope_id")
    )
    if "fumble" in controlled_ids or "complication" in controlled_ids:
        inferred.add("complication")
    if "critical" in controlled_ids or "opportunity" in controlled_ids:
        inferred.add("opportunity")
    if isinstance(serves, dict):
        if serves.get("can_reveal_clue"):
            inferred.add("clue_delivery")
        if serves.get("can_tick_front"):
            inferred.add("front_pressure")
        if serves.get("can_deepen_npc"):
            inferred.add("character_beat")
        if serves.get("can_surface_choice"):
            inferred.add("choice_pressure")
        if serves.get("can_offer_recovery"):
            inferred.add("recovery_redirection")
        if serves.get("theme"):
            inferred.add("theme_echo")
    if req.get("scene_pressure") is True:
        inferred.add("scene_pressure")
    return inferred


def _storylet_deck_tags(storylet: dict[str, Any]) -> set[str]:
    tags: set[str] = set()
    for key in ("deck_id", "deck", "deck_tags", "decks", "storylet_deck"):
        for value in _as_list(storylet.get(key)):
            text = _non_empty_str(value)
            if text:
                tags.add(text)
    for function in _storylet_story_functions(storylet):
        tags.update(_NEED_DECKS.get(function, [function]))
    return tags


def _matching_deck_id(storylet: dict[str, Any], story_need: dict[str, Any]) -> str | None:
    needed_functions = set(_as_list(story_need.get("story_functions")))
    if story_need.get("need_id"):
        needed_functions.add(str(story_need["need_id"]))
    candidate_decks = set(_as_list(story_need.get("candidate_decks")))
    storylet_functions = _storylet_story_functions(storylet)
    deck_tags = _storylet_deck_tags(storylet)

    function_match = storylet_functions & needed_functions
    deck_match = deck_tags & candidate_decks
    if not function_match and not deck_match:
        return None
    for deck in _as_list(story_need.get("candidate_decks")):
        if deck in deck_tags:
            return str(deck)
    return next(iter(sorted(function_match or deck_match)), None)


def _scene_type(ctx: dict[str, Any]) -> str | None:
    scene = ctx.get("active_scene") or {}
    return scene.get("scene_type") or scene.get("type")


def _scene_tags(ctx: dict[str, Any]) -> set[str]:
    scene = ctx.get("active_scene") or {}
    tags = set(_as_list(scene.get("tags")))
    tags.update(_as_list(scene.get("tone")))
    tags.update(_as_list(scene.get("storylet_tags")))  # P0-3 wiring
    if scene.get("scene_type"):
        tags.add(str(scene.get("scene_type")))
    return {str(t) for t in tags if t}


def _has_scene_pressure(ctx: dict[str, Any]) -> bool:
    scene = ctx.get("active_scene") or {}
    return bool(scene.get("pressure_moves"))


def _is_scene_tag_summoned(storylet: dict[str, Any], ctx: dict[str, Any]) -> bool:
    """A storylet is "scene-tag summoned" when the current turn was triggered by
    a `scene_tag_beat` (P0-3b: the scene's `storylet_tags` matched on entry) AND
    the storylet's own `scene_tags` intersect the active scene's tags.

    Such a storylet was specifically summoned because the scene asked for it on
    entry. It should NOT be gated by the generic story_need deck filter (which
    keys off scene pressure / clue state and so rejects scene-entry beats), and
    it SHOULD win selection over generic ambient storylets. This keeps authors
    focused on `scene_tags` matching rather than deck engineering for beats that
    only fire on scene entry. Structured fields only — no free-text scanning.
    """
    trigger = ctx.get("storylet_trigger") or {}
    if _non_empty_str(trigger.get("reason")) != "scene_tag_beat":
        return False
    required_tags = set(_as_list(storylet.get("scene_tags")))
    return bool(required_tags and (required_tags & _scene_tags(ctx)))


def _intent_tags(ctx: dict[str, Any]) -> set[str]:
    tags: set[str] = set()
    rich = ctx.get("player_intent_rich") or {}
    for value in (
        ctx.get("player_intent_class"),
        (ctx.get("turn_input") or {}).get("player_intent_class"),
        rich.get("primary_intent"),
        rich.get("risk_posture"),
    ):
        text = _non_empty_str(value)
        if text:
            tags.add(text)
    for key in ("secondary_intents", "target_entities"):
        for value in _as_list(rich.get(key)):
            text = _non_empty_str(value)
            if text:
                tags.add(text)
    return tags


def _available_clues(plan: dict[str, Any], ctx: dict[str, Any]) -> list[str]:
    clue_policy = plan.get("clue_policy") or {}
    scene = ctx.get("active_scene") or {}
    ids: list[str] = []
    for source in (clue_policy.get("reveal"), clue_policy.get("fallback_routes"), clue_policy.get("leads"), scene.get("available_clues")):
        for cid in _as_list(source):
            text = _non_empty_str(cid)
            if text and text not in ids:
                ids.append(text)
    discovered = set((ctx.get("world_state") or {}).get("discovered_clue_ids", []) or [])
    return [cid for cid in ids if cid not in discovered] or ids


def _front_clock_ids(ctx: dict[str, Any]) -> tuple[str | None, str | None]:
    for front in ((ctx.get("threat_fronts") or {}).get("fronts") or []):
        fid = _non_empty_str(front.get("front_id") or front.get("id"))
        for clock in front.get("clocks", []) or []:
            cid = _non_empty_str(clock.get("clock_id") or clock.get("id"))
            if fid or cid:
                return fid, cid
        if fid:
            return fid, None
    return None, None


def _requirements_met(storylet: dict[str, Any], plan: dict[str, Any], ctx: dict[str, Any]) -> bool:
    req = storylet.get("requires") or {}
    scene = ctx.get("active_scene") or {}
    if req.get("npc_id") is True and not scene.get("npc_ids"):
        return False
    if req.get("unrevealed_clue") is True and not _available_clues(plan, ctx):
        return False
    if req.get("active_front") is True and not (ctx.get("threat_fronts") or {}).get("fronts"):
        return False
    if req.get("scene_pressure") is True and not _has_scene_pressure(ctx):
        return False
    return True


def _anchor_kind_available(kind: str, storylet: dict[str, Any], plan: dict[str, Any], ctx: dict[str, Any]) -> bool:
    scene = ctx.get("active_scene") or {}
    if kind in {"npc", "npc_id", "active_npc"}:
        return bool(scene.get("npc_ids"))
    if kind in {"clue", "unrevealed_clue", "available_clue"}:
        return bool(_available_clues(plan, ctx))
    if kind in {"front", "active_front", "threat_front"}:
        return bool((ctx.get("threat_fronts") or {}).get("fronts"))
    if kind in {"scene_pressure", "pressure_move"}:
        return _has_scene_pressure(ctx)
    if kind in {"scene_tag", "scene_tags"}:
        required_tags = set(_as_list(storylet.get("scene_tags")))
        return bool(required_tags and (required_tags & _scene_tags(ctx)))
    return False


def _anchor_contract_met(storylet: dict[str, Any], plan: dict[str, Any], ctx: dict[str, Any]) -> bool:
    contract = storylet.get("anchor_contract") or {}
    if not isinstance(contract, dict):
        return bool(contract)
    one_of = _as_list(contract.get("requires_one_of") or contract.get("one_of"))
    if one_of:
        return any(_anchor_kind_available(str(kind), storylet, plan, ctx) for kind in one_of)
    all_of = _as_list(contract.get("requires_all_of") or contract.get("all_of"))
    if all_of:
        return all(_anchor_kind_available(str(kind), storylet, plan, ctx) for kind in all_of)
    return bool(contract)


def _has_current_scene_anchor(storylet: dict[str, Any], plan: dict[str, Any], ctx: dict[str, Any]) -> bool:
    req = storylet.get("requires") or {}
    if req.get("npc_id") is True and _anchor_kind_available("npc_id", storylet, plan, ctx):
        return True
    if req.get("unrevealed_clue") is True and _anchor_kind_available("unrevealed_clue", storylet, plan, ctx):
        return True
    if req.get("active_front") is True and _anchor_kind_available("active_front", storylet, plan, ctx):
        return True
    if req.get("scene_pressure") is True and _anchor_kind_available("scene_pressure", storylet, plan, ctx):
        return True

    required_tags = set(_as_list(storylet.get("scene_tags")))
    if required_tags and (required_tags & _scene_tags(ctx)):
        return True

    return _anchor_contract_met(storylet, plan, ctx)


def _matches_context(storylet: dict[str, Any], plan: dict[str, Any], ctx: dict[str, Any], target_level: str) -> bool:
    policy = ctx.get("storylet_policy") or {}
    scene = ctx.get("active_scene") or {}
    story_need = ctx.get("story_need") or infer_story_need(plan, ctx)
    if storylet.get("storylet_id") in set(_as_list(scene.get("excluded_storylet_ids"))):
        return False
    if storylet.get("family_id") in set(_as_list(scene.get("excluded_storylet_families"))):
        return False
    if storylet.get("trope_id") in set(_as_list(scene.get("excluded_storylet_tropes"))):
        return False
    if not _storylet_serves_scenario(storylet):
        return False
    level = storylet.get("conflict_level", "low")
    if not _level_allowed(level, target_level, policy):
        return False

    action = plan.get("scene_action")
    actions = set(_as_list(storylet.get("scene_actions")) + _as_list(storylet.get("dramatic_function")))
    if actions and action not in actions and "ANY" not in actions:
        return False

    structure_type = ctx.get("structure_type") or (ctx.get("module_meta") or {}).get("structure_type")
    affinity = set(_as_list(storylet.get("structure_affinity")))
    if affinity and structure_type and structure_type not in affinity and "any" not in affinity:
        return False

    stype = _scene_type(ctx)
    eligible_scene_types = set(_as_list(storylet.get("eligible_scene_types")))
    if eligible_scene_types and stype and stype not in eligible_scene_types and "any" not in eligible_scene_types:
        return False

    horror = ((plan.get("narrative_directives") or {}).get("horror_escalation_stage") or "wrongness")
    horror_ok = set(_as_list(storylet.get("horror_stage")))
    if horror_ok and horror not in horror_ok and "any" not in horror_ok:
        return False

    excluded_flags = set(_as_list(storylet.get("not_for_content_flags")))
    content_flags = set(_as_list((ctx.get("module_meta") or {}).get("content_flags")))
    if excluded_flags & content_flags:
        return False

    required_tags = set(_as_list(storylet.get("scene_tags")))
    if required_tags and not (required_tags & _scene_tags(ctx)):
        return False

    intent_tags = _intent_tags(ctx)
    eligible_intents = set(_as_list(storylet.get("eligible_intent_classes")))
    if eligible_intents and not (eligible_intents & intent_tags):
        return False
    excluded_intents = set(_as_list(storylet.get("not_for_intent_classes")))
    if excluded_intents and (excluded_intents & intent_tags):
        return False

    trigger = ctx.get("storylet_trigger") or {}
    polarity = _non_empty_str(trigger.get("polarity") or policy.get("polarity"))
    allowed_polarity = set(_as_list(storylet.get("trigger_polarity") or storylet.get("polarity")))
    if polarity and allowed_polarity and polarity not in allowed_polarity and "mixed" not in allowed_polarity:
        return False

    if not policy.get("allow_unanchored_storylets") and not _has_current_scene_anchor(storylet, plan, ctx):
        return False
    # C1: a scene-tag-summoned storylet (scene_tag_beat + matching scene_tags)
    # was specifically summoned by the scene's entry trigger, so it bypasses the
    # generic story_need deck filter. The deck filter keys off scene
    # pressure/clue state and would otherwise reject scene-entry beats whose
    # deck_tags don't intersect the pressure-driven candidate_decks.
    if _is_scene_tag_summoned(storylet, ctx):
        return _requirements_met(storylet, plan, ctx)
    if not policy.get("ignore_story_need") and _matching_deck_id(storylet, story_need) is None:
        return False

    return _requirements_met(storylet, plan, ctx)


def _repeat_penalty(storylet: dict[str, Any], ledger: dict[str, Any]) -> float:
    anti = storylet.get("anti_repeat") or {}
    sid = storylet.get("storylet_id")
    family = storylet.get("family_id")
    trope = storylet.get("trope_id")
    used_storylets = _as_list(ledger.get("used_storylets"))
    if sid and sid in used_storylets and int(anti.get("max_per_session", 1) or 1) <= used_storylets.count(sid):
        return 0.0
    if anti.get("exclude_if_family_used_recently", True) and family in _as_list(ledger.get("recent_families")):
        return 0.0
    if anti.get("exclude_if_trope_used_recently", False) and trope in _as_list(ledger.get("recent_tropes")):
        return 0.0
    penalty = 1.0
    if family in _as_list(ledger.get("used_families")):
        penalty *= 0.45
    if trope in _as_list(ledger.get("used_tropes")):
        penalty *= 0.6
    return penalty


def _score_storylet(storylet: dict[str, Any], plan: dict[str, Any], ctx: dict[str, Any], ledger: dict[str, Any], target_level: str) -> float:
    penalty = _repeat_penalty(storylet, ledger)
    if penalty <= 0.0:
        return 0.0
    score = float(storylet.get("base_weight", 1.0) or 1.0) * penalty
    rank_gap = abs(_CONFLICT_RANK.get(storylet.get("conflict_level", "low"), 0) - _CONFLICT_RANK.get(target_level, 0))
    score *= max(0.35, 1.0 - rank_gap * 0.25)
    serves = storylet.get("serves") or {}
    if isinstance(serves, dict):
        if serves.get("can_reveal_clue") and _available_clues(plan, ctx):
            score *= 1.25
        if serves.get("can_tick_front") and (ctx.get("threat_fronts") or {}).get("fronts"):
            score *= 1.2
        if serves.get("can_deepen_npc") and (ctx.get("active_scene") or {}).get("npc_ids"):
            score *= 1.15
        if serves.get("can_surface_choice") and (plan.get("choice_frame") or {}).get("routes"):
            score *= 1.1
    trigger = ctx.get("storylet_trigger") or {}
    polarity = _non_empty_str(trigger.get("polarity") or (ctx.get("storylet_policy") or {}).get("polarity"))
    allowed_polarity = set(_as_list(storylet.get("trigger_polarity") or storylet.get("polarity")))
    if polarity and allowed_polarity and (polarity in allowed_polarity or "mixed" in allowed_polarity):
        score *= 1.35
    # C2: priority for scene-tag-summoned beats. A `scene_tag_beat` trigger means
    # the scene's `storylet_tags` matched on entry and explicitly asked for a
    # tagged beat — so a summoned storylet must reliably win selection over the
    # many generic ambient storylets in the library. A flat multiplier alone
    # cannot do this: the generic pool's aggregate weight grows with its size
    # (~15 generics vs ~2 summoned here), so even a large per-storylet boost
    # leaves a leak. We therefore BOTH boost summoned storylets AND suppress
    # generic (non-summoned) storylets while the summon trigger is active. The
    # suppression is a fraction, not a hard zero, so a generic can still be
    # picked as a fallback if no summoned candidate passes the other gates.
    if _non_empty_str(trigger.get("reason")) == "scene_tag_beat":
        if _is_scene_tag_summoned(storylet, ctx):
            score *= 5.0
        else:
            score *= 0.01
    return max(0.0, score)


def _weighted_pick(scored: list[tuple[dict[str, Any], float]], rng: random.Random) -> dict[str, Any] | None:
    total = sum(score for _, score in scored)
    if total <= 0:
        return None
    threshold = rng.random() * total
    acc = 0.0
    for storylet, score in scored:
        acc += score
        if acc >= threshold:
            return storylet
    return scored[-1][0] if scored else None


def _trace_storylet_ref(storylet: dict[str, Any], reason: str | None = None) -> dict[str, Any]:
    ref = {
        "storylet_id": storylet.get("storylet_id"),
        "family_id": storylet.get("family_id"),
        "trope_id": storylet.get("trope_id"),
        "story_functions": sorted(_storylet_story_functions(storylet)),
        "deck_tags": sorted(_storylet_deck_tags(storylet)),
    }
    if reason:
        ref["reason"] = reason
    return ref


def _roll_variants(storylet: dict[str, Any], rng: random.Random) -> dict[str, Any]:
    rolled: dict[str, Any] = {}
    for key, table in (storylet.get("variants") or storylet.get("roll_tables") or {}).items():
        options = [x for x in _as_list(table) if x is not None]
        if options:
            rolled[key] = rng.choice(options)
    return rolled


def _bind_storylet(storylet: dict[str, Any], plan: dict[str, Any], ctx: dict[str, Any], rng: random.Random) -> dict[str, Any]:
    scene = ctx.get("active_scene") or {}
    npc_ids = [str(n) for n in _as_list(scene.get("npc_ids")) if n]
    clue_ids = _available_clues(plan, ctx)
    front_id, clock_id = _front_clock_ids(ctx)
    used_targets = set(_as_list((ctx.get("storylet_ledger") or {}).get("used_targets")))

    npc_pool = [n for n in npc_ids if n not in used_targets] or npc_ids
    bound_npc = rng.choice(npc_pool) if npc_pool and (storylet.get("requires") or {}).get("npc_id") is not False else None
    bound_clue = rng.choice(clue_ids) if clue_ids and (storylet.get("requires") or {}).get("unrevealed_clue") is not False else None
    return {
        "npc_id": bound_npc,
        "clue_id": bound_clue,
        "front_id": front_id,
        "clock_id": clock_id,
        "scene_id": scene.get("scene_id") or ctx.get("active_scene_id"),
        "location_id": scene.get("location_id") or scene.get("scene_id") or ctx.get("active_scene_id"),
    }


def _serve_list(storylet: dict[str, Any]) -> list[str]:
    serves = storylet.get("serves") or {}
    if isinstance(serves, list):
        return [str(s) for s in serves]
    if isinstance(serves, dict):
        return [str(k) for k, v in serves.items() if v]
    return []


def project_ledger_update(ledger: dict[str, Any], selected: dict[str, Any]) -> dict[str, Any]:
    """Build a ledger patch for the caller to persist after the beat is used."""
    ledger = normalize_storylet_ledger(ledger)
    sid = selected.get("storylet_id")
    family = selected.get("family_id")
    trope = selected.get("trope_id")
    bound = selected.get("bound_entities") or {}
    target = bound.get("npc_id") or bound.get("location_id")

    def append_recent(values: list[Any], value: Any, limit: int = 8) -> list[Any]:
        out = [v for v in values if v != value]
        if value:
            out.append(value)
        return out[-limit:]

    return {
        "schema_version": _SCHEMA_VERSION,
        "used_storylets": append_recent(_as_list(ledger.get("used_storylets")), sid, limit=999),
        "used_families": append_recent(_as_list(ledger.get("used_families")), family, limit=999),
        "used_tropes": append_recent(_as_list(ledger.get("used_tropes")), trope, limit=999),
        "recent_families": append_recent(_as_list(ledger.get("recent_families")), family, limit=8),
        "recent_tropes": append_recent(_as_list(ledger.get("recent_tropes")), trope, limit=8),
        "used_targets": append_recent(_as_list(ledger.get("used_targets")), target, limit=16),
        "last_storylet_id": sid,
    }


def select_storylet_moves(
    plan: dict[str, Any],
    ctx: dict[str, Any],
    *,
    library: dict[str, Any] | None = None,
    ledger: dict[str, Any] | None = None,
    seed: Any | None = None,
    max_storylets: int = 1,
) -> list[dict[str, Any]]:
    """Select deterministic storylet moves for the current DirectorPlan.

    The selection is weighted-random but seed-stable. It filters by conflict
    level, scene/action compatibility, module structure, safety flags, and
    anti-repeat ledger before rolling.
    """
    library = library or ctx.get("storylet_library") or load_storylet_library()
    ledger = normalize_storylet_ledger(ledger or ctx.get("storylet_ledger"))
    target_level = infer_conflict_level(plan, ctx)
    policy = ctx.get("storylet_policy") or {}
    story_need = ctx.get("story_need") or infer_story_need(plan, ctx)
    selection_ctx = {**ctx, "story_need": story_need}
    storylets = [s for s in library.get("storylets", []) or [] if isinstance(s, dict)]

    trace = {
        "schema_version": _SCHEMA_VERSION,
        "storylet_trigger": ctx.get("storylet_trigger"),
        "story_need": story_need,
        "candidate_decks": story_need.get("candidate_decks", []),
        "target_conflict_level": target_level,
        "candidate_counts": {
            "library_total": len(storylets),
            "after_context_filter": 0,
            "after_story_need_filter": 0,
            "after_anti_repeat": 0,
        },
        "rejected_examples": [],
        "selected": None,
    }

    scored: list[tuple[dict[str, Any], float]] = []
    context_policy = {**policy, "ignore_story_need": True}
    context_ctx = {**selection_ctx, "storylet_policy": context_policy}
    for storylet in storylets:
        if not _matches_context(storylet, plan, context_ctx, target_level):
            continue
        trace["candidate_counts"]["after_context_filter"] += 1
        # C1: skip the story_need deck gate for scene-tag-summoned storylets;
        # they were specifically requested by the scene's entry trigger.
        if not _is_scene_tag_summoned(storylet, context_ctx) and _matching_deck_id(storylet, story_need) is None:
            if len(trace["rejected_examples"]) < 5:
                trace["rejected_examples"].append(_trace_storylet_ref(storylet, "deck_mismatch"))
            continue
        trace["candidate_counts"]["after_story_need_filter"] += 1
        score = _score_storylet(storylet, plan, selection_ctx, ledger, target_level)
        if score > 0:
            trace["candidate_counts"]["after_anti_repeat"] += 1
            scored.append((storylet, score))
        elif len(trace["rejected_examples"]) < 5:
            trace["rejected_examples"].append(_trace_storylet_ref(storylet, "anti_repeat"))
    scored.sort(key=lambda pair: (pair[1], pair[0].get("storylet_id", "")), reverse=True)

    rng = random.Random(_stable_int_seed(seed or policy.get("seed", "storylet"), ctx.get("turn_number", 0), plan.get("decision_id"), plan.get("scene_action"), target_level))
    moves: list[dict[str, Any]] = []
    working_ledger = ledger
    for _ in range(max_storylets):
        pick = _weighted_pick(scored, rng)
        if not pick:
            break
        bound = _bind_storylet(pick, plan, {**selection_ctx, "storylet_ledger": working_ledger}, rng)
        rolled = _roll_variants(pick, rng)
        deck_id = _matching_deck_id(pick, story_need)
        selected_ref = _trace_storylet_ref(pick)
        selected_ref["deck_id"] = deck_id
        selected_ref["score"] = next((score for storylet, score in scored if storylet is pick), None)
        trace["selected"] = selected_ref
        move = {
            "schema_version": _SCHEMA_VERSION,
            "storylet_id": pick.get("storylet_id"),
            "title": pick.get("title"),
            "family_id": pick.get("family_id"),
            "trope_id": pick.get("trope_id"),
            "conflict_level": pick.get("conflict_level", "low"),
            "target_conflict_level": target_level,
            "conflict_score": pick.get("conflict_score", _CONFLICT_RANK.get(pick.get("conflict_level", "low"), 0) + 1),
            "dramatic_function": pick.get("dramatic_function", []),
            "cue": pick.get("cue"),
            "beat": pick.get("beat") or (pick.get("effects") or {}).get("narrative_move"),
            "bound_entities": bound,
            "rolled_variants": rolled,
            "serves": _serve_list(pick),
            "story_need": story_need,
            "deck_id": deck_id,
            "candidate_decks": story_need.get("candidate_decks", []),
            "scheduler_trace": trace,
            "effects": pick.get("effects", {}),
            "narration_directive": pick.get("narration_directive") or "Bind this beat to the active scenario node; do not introduce a new core truth.",
            "anti_repeat": pick.get("anti_repeat", {}),
            "source": "storylet-library.json",
        }
        move["ledger_update"] = project_ledger_update(working_ledger, move)
        move["scheduler_trace"]["ledger_update"] = move["ledger_update"]
        moves.append(move)
        working_ledger = move["ledger_update"]
        scored = [(s, sc) for s, sc in scored if s.get("storylet_id") != pick.get("storylet_id")]
        scored = [(s, sc) for s, sc in scored if _repeat_penalty(s, working_ledger) > 0]
    return moves
