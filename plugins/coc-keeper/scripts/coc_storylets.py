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


def _scene_type(ctx: dict[str, Any]) -> str | None:
    scene = ctx.get("active_scene") or {}
    return scene.get("scene_type") or scene.get("type")


def _scene_tags(ctx: dict[str, Any]) -> set[str]:
    scene = ctx.get("active_scene") or {}
    tags = set(_as_list(scene.get("tags")))
    tags.update(_as_list(scene.get("tone")))
    if scene.get("scene_type"):
        tags.add(str(scene.get("scene_type")))
    return {str(t) for t in tags if t}


def _has_scene_pressure(ctx: dict[str, Any]) -> bool:
    scene = ctx.get("active_scene") or {}
    return bool(scene.get("pressure_moves"))


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
    storylets = [s for s in library.get("storylets", []) or [] if isinstance(s, dict)]

    scored: list[tuple[dict[str, Any], float]] = []
    for storylet in storylets:
        if not _matches_context(storylet, plan, ctx, target_level):
            continue
        score = _score_storylet(storylet, plan, ctx, ledger, target_level)
        if score > 0:
            scored.append((storylet, score))
    scored.sort(key=lambda pair: (pair[1], pair[0].get("storylet_id", "")), reverse=True)

    rng = random.Random(_stable_int_seed(seed or policy.get("seed", "storylet"), ctx.get("turn_number", 0), plan.get("decision_id"), plan.get("scene_action"), target_level))
    moves: list[dict[str, Any]] = []
    working_ledger = ledger
    for _ in range(max_storylets):
        pick = _weighted_pick(scored, rng)
        if not pick:
            break
        bound = _bind_storylet(pick, plan, {**ctx, "storylet_ledger": working_ledger}, rng)
        rolled = _roll_variants(pick, rng)
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
            "effects": pick.get("effects", {}),
            "narration_directive": pick.get("narration_directive") or "Bind this beat to the active scenario node; do not introduce a new core truth.",
            "anti_repeat": pick.get("anti_repeat", {}),
            "source": "storylet-library.json",
        }
        move["ledger_update"] = project_ledger_update(working_ledger, move)
        moves.append(move)
        working_ledger = move["ledger_update"]
        scored = [(s, sc) for s, sc in scored if s.get("storylet_id") != pick.get("storylet_id")]
        scored = [(s, sc) for s, sc in scored if _repeat_penalty(s, working_ledger) > 0]
    return moves
