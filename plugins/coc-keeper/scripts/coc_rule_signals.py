#!/usr/bin/env python3
"""Pure functions translating Call of Cthulhu rule state into director signals.

These functions are read-only and side-effect-free. They take rule state
(hp, sanity, credit rating, etc.) and return signal enum values that the
story director uses in its scoring. Each function is independently testable.

Rulebook refs (Keeper Rulebook 40th Anniversary):
- HP states: p.119-120
- Sanity states: p.154-158
- Credit Rating tiers: p.45-47 (cash-assets.json)

Historical spec retired; see tombstone index docs/status/DIAGNOSIS-LEDGER.md
"""
from __future__ import annotations

import json
import random
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
RULES_DIR = SCRIPT_DIR.parent / "references" / "rules-json"

# Sanity thresholds (rulebook p.155-156)
TEMP_INSANITY_LOSS_THRESHOLD = 5
INDEFINITE_INSANITY_DAILY_FRACTION = 0.2


def read_hp_state(current_hp: int, max_hp: int, conditions: list[str]) -> str:
    """Classify HP/wound state. Rulebook p.119-120.

    Returns: healthy | wounded | major_wound | dying | dead
    - dead: hp < 0
    - dying: hp == 0 AND major_wound in conditions (p.120)
    - major_wound: major_wound in conditions (damage >= half max hp, p.119)
    - wounded: hp < max_hp (but not in a critical state above)
    - healthy: hp == max_hp
    """
    if current_hp < 0:
        return "dead"
    if current_hp == 0 and "major_wound" in conditions:
        return "dying"
    if "major_wound" in conditions:
        return "major_wound"
    if current_hp < max_hp:
        return "wounded"
    return "healthy"


def read_sanity_state(current_san: int, max_san: int, bout_active: bool, lost_this_event: int) -> str:
    """Classify sanity state. Rulebook p.154-158.

    Returns: stable | shaken | temp_insane | indefinite_insane | bout_active
    - bout_active overrides everything (Keeper controls investigator, p.156)
    - temp_insane: lost >= 5 SAN from single source (p.155)
    - shaken: lost some SAN but below temp threshold
    - stable: no recent loss
    """
    if bout_active:
        return "bout_active"
    if lost_this_event >= TEMP_INSANITY_LOSS_THRESHOLD:
        return "temp_insane"
    if lost_this_event > 0:
        return "shaken"
    return "stable"


def read_credit_tier(credit_rating: int) -> str:
    """Map Credit Rating to living-standard tier. Rulebook p.45-47.

    Returns: penniless | poor | average | wealthy | rich | super_rich
    Tiers align with cash-assets.json living_standard values.
    """
    if credit_rating <= 0:
        return "penniless"
    if credit_rating <= 9:
        return "poor"
    if credit_rating <= 49:
        return "average"
    if credit_rating <= 89:
        return "wealthy"
    if credit_rating <= 98:
        return "rich"
    return "super_rich"


# --------------------------------------------------------------------------- #
# Task 2: NPC reaction / Luck / Crit-Fumble / Stalled / Tension
# --------------------------------------------------------------------------- #

def _load_sibling(name: str, filename: str):
    """Resolve a sibling script module without a package context."""
    import importlib.util
    spec = importlib.util.spec_from_file_location(name, SCRIPT_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_roll = _load_sibling("coc_roll", "coc_roll.py")


def roll_npc_reaction(app: int, credit_rating: int, rng: random.Random | None = None) -> dict[str, Any]:
    """Concealed APP/CR roll to set NPC disposition. Rulebook p.191.

    Use the higher of APP or Credit Rating as target (rulebook: "if you are
    unsure, use the higher of the two"). Roll 1D100; below half = helpful
    (positive, strong), below target = neutral (positive), above = hostile.
    Returns dict with used/target/roll/disposition.
    """
    rng = rng or random.Random()
    used = "credit_rating" if credit_rating >= app else "app"
    target = max(app, credit_rating)
    roll = rng.randint(1, 100)
    if roll <= target // 2:
        disposition = "helpful"
    elif roll <= target:
        disposition = "neutral"
    else:
        disposition = "hostile"
    return {"used": used, "target": target, "roll": roll, "disposition": disposition}


def read_luck_signal(current_luck: int, luck_spent_last: int) -> tuple[str, bool]:
    """Classify Luck level + whether player spent luck last turn. Rulebook p.99.

    Returns (level, spent_last) where level: high | moderate | low | depleted.
    Luck is a depleting tension clock; low-luck investigators attract
    misfortune (group-Luck rule).
    """
    if current_luck >= 60:
        level = "high"
    elif current_luck >= 30:
        level = "moderate"
    elif current_luck >= 10:
        level = "low"
    else:
        level = "depleted"
    return (level, luck_spent_last > 0)


# Advisory copy rendered from structured enum values only (Semantic Matcher
# Constitution: no prose scanning). Emitted only for tiers worth Keeper
# attention so average/moderate values never produce noise.
_CREDIT_TIER_NOTES: dict[str, str] = {
    "penniless": "CR 0: penniless — no dependable cash or lodging; wealth-conscious NPCs will dismiss them, and any purchase needs fiction first",
    "poor": "CR 1-9: poor — cheap lodging only, almost no disposable cash; wealth-conscious NPCs will look down on them",
    "wealthy": "CR 50-89: wealthy — good hotels and first-class travel are simply owned; money opens doors without a purchase roll",
    "rich": "CR 90-98: rich — top-tier hotels, servants, and major assets at hand; wealth-based social access is credible",
    "super_rich": "CR 99+: super rich — money is effectively no obstacle; the lifestyle itself impresses or intimidates",
}

_LUCK_LEVEL_NOTES: dict[str, str] = {
    "low": "Luck is low — a legitimate target when the Keeper needs someone for misfortune to strike (group-Luck rule)",
    "depleted": "Luck is depleted — the fates have abandoned them; prefer them when circumstance needs a victim",
}


def describe_parameter_signals(rule_signals: dict[str, Any]) -> list[dict[str, Any]]:
    """Render notable rule_signals values as advisory notes for the Keeper.

    Advisory only, never a gate: fixed copy rendered from the structured
    ``credit_tier`` / ``luck_level`` enum values the director already computes,
    plus notable APP values from the p.37 ladder. Average credit, moderate/high
    luck, and unremarkable APP produce no notes, so the list stays empty unless
    there is something worth Keeper attention.

    Returns a list of ``{signal, value, note, rule_ref}`` dicts.
    """
    notes: list[dict[str, Any]] = []
    if not isinstance(rule_signals, dict):
        return notes
    credit_tier = str(rule_signals.get("credit_tier") or "")
    if credit_tier in _CREDIT_TIER_NOTES:
        notes.append({
            "signal": "credit_tier",
            "value": credit_tier,
            "note": _CREDIT_TIER_NOTES[credit_tier],
            "rule_ref": "keeper-rulebook p.45-47",
        })
    luck_level = str(rule_signals.get("luck_level") or "")
    if luck_level in _LUCK_LEVEL_NOTES:
        notes.append({
            "signal": "luck_level",
            "value": luck_level,
            "note": _LUCK_LEVEL_NOTES[luck_level],
            "rule_ref": "keeper-rulebook p.99",
        })
    app_raw = rule_signals.get("app")
    app: int | None = None
    if isinstance(app_raw, (int, float)) and not isinstance(app_raw, bool):
        app = int(app_raw)
    if app is not None and app <= 20:
        notes.append({
            "signal": "app",
            "value": str(app),
            "note": (
                f"APP {app}: strikingly unattractive — first meetings start "
                "uphill; expect stares, pity, or revulsion before a word is spoken"
            ),
            "rule_ref": "keeper-rulebook p.31, p.37",
        })
    elif app is not None and app >= 80:
        notes.append({
            "signal": "app",
            "value": str(app),
            "note": (
                f"APP {app}: remarkable presence — strangers notice and remember "
                "this face; first meetings begin with the advantage"
            ),
            "rule_ref": "keeper-rulebook p.31, p.37",
        })
    return notes


def read_critical_fumble(last_roll_outcome: str | None) -> tuple[bool, bool]:
    """Detect critical (01) / fumble (96-100) from last roll outcome string.

    Returns (is_critical, is_fumble). Both drive mandatory director action
    (rulebook p.89): critical -> invent benefit; fumble -> invent immediate
    misfortune, cannot be negated by pushing.
    """
    if last_roll_outcome is None:
        return (False, False)
    return (last_roll_outcome == "critical", last_roll_outcome == "fumble")


def read_stalled_turns(recent_intent_classes: list[str]) -> int:
    """Count trailing idle/stuck turns from recent player intent classes.

    Used by the Idea Roll recovery valve (rulebook p.199). Director triggers
    RECOVER action when stalled >= 3.
    """
    count = 0
    for cls in reversed(recent_intent_classes):
        if cls in ("idle", "stuck"):
            count += 1
        else:
            break
    return count


def read_tension_clock(tension_level: str, lethal_chances_used: int) -> dict[str, Any]:
    """Read pacing/tension state. Rulebook p.198, p.209 (three chances).

    Returns dict with tension_level, lethal_chances_used, death_allowed.
    death_allowed only after 3+ lethal chances used (p.209 "give players up
    to three chances to avoid certain death").
    """
    return {
        "tension_level": tension_level,
        "lethal_chances_used": lethal_chances_used,
        "death_allowed": lethal_chances_used >= 3,
    }


# --------------------------------------------------------------------------- #
# Task 3: v2 translation functions (written now, director does not reference in v1)
# --------------------------------------------------------------------------- #

def read_phobia_penalty(insane: bool, trigger_in_scene: bool) -> dict[str, Any]:
    """Phobia penalty die when insane + trigger present. Rulebook p.159.

    While sane, phobia is just roleplay; while insane + direct exposure,
    non-fight/flee actions take 1 penalty die.
    """
    return {"penalty_die": bool(insane and trigger_in_scene)}


def read_psychology_concealed(skill_value: int, roll: int, npc_lying: bool) -> dict[str, Any]:
    """Concealed Psychology roll determines read reliability.

    Failed roll does not automatically invert truth. The narrator should render
    uncertainty or surface behavior unless a scenario-specific deception effect
    explicitly says otherwise.
    """
    feed_accurate = roll <= skill_value
    return {
        "feed_accurate": feed_accurate,
        "npc_actually_lying": npc_lying,
        "reliability": "accurate_read" if feed_accurate else "uncertain_read",
        "player_truth_policy": "accurate_if_success_else_uncertain",
        "must_not": [] if feed_accurate else ["do not invert truth on failed Psychology"],
    }


def read_pushed_fail_pending(is_pushed: bool, outcome: str) -> bool:
    """Pushed-roll failure requires worse narrative consequence. Rulebook p.84."""
    return bool(is_pushed and outcome == "failure")


def read_contacts_difficulty(home_ground: bool, same_profession: bool) -> str:
    """Contacts roll difficulty by location/profession match. Rulebook p.97."""
    if home_ground and same_profession:
        return "regular"
    if not home_ground:
        return "hard"
    return "regular"


# D4 (failed-SAN involuntary action) and F3 (believer SAN bomb):
# Both now implemented (p.166 D4, p.179 F3).

INVOLUNTARY_KIND_DESCRIPTIONS: dict[str, str] = {
    "jump_in_fright": "investigator physically starts/jumps in fright",
    "cry_out": "investigator screams, gasps, or cries out",
    "involuntary_movement": "investigator stumbles, drops something, or reels",
    "involuntary_combat_action": "investigator fires or strikes out reflexively",
    "freeze": "investigator freezes in place, paralyzed for a moment",
}


def read_failed_san_involuntary(
    san_lost: int,
    involuntary_kinds: list[str] | None = None,
    rng: random.Random | None = None,
) -> dict[str, Any]:
    """D4: a failed SAN roll always causes a momentary loss of self-control.

    Rulebook p.166: when an investigator fails a SAN roll, the Keeper chooses
    one of five involuntary actions. This read-only signal picks one (randomly
    when ``involuntary_kinds`` is omitted, or from the supplied candidate list
    when the Keeper wants to constrain the outcome) and returns it for the
    director to narrate.

    Parameters:
        san_lost: SAN lost on the failed roll (carried for context only; the
            involuntary action itself is independent of the magnitude).
        involuntary_kinds: optional Keeper-chosen subset of the five kinds
            (jump_in_fright, cry_out, involuntary_movement,
            involuntary_combat_action, freeze). When None, all five are
            eligible. Unknown kinds are ignored.
        rng: optional RNG for deterministic tests.

    Returns:
        {implemented, kind, description, san_lost}
    """
    rng = rng or random.Random()
    all_kinds = list(INVOLUNTARY_KIND_DESCRIPTIONS.keys())
    if involuntary_kinds:
        candidates = [k for k in involuntary_kinds if k in INVOLUNTARY_KIND_DESCRIPTIONS]
        if not candidates:
            candidates = all_kinds
    else:
        candidates = all_kinds
    kind = rng.choice(candidates)
    return {
        "implemented": True,
        "kind": kind,
        "description": INVOLUNTARY_KIND_DESCRIPTIONS[kind],
        "san_lost": int(san_lost),
        "rule_ref": "core.sanity.failure_involuntary_action",
    }


def read_believer_bomb(
    cm_value: int,
    current_san: int,
    max_san: int | None = None,
    *,
    already_believer: bool = False,
    is_first: bool = False,
) -> dict[str, Any]:
    """F3 (p.179): pending SAN loss when an investigator becomes a believer.

    Becoming a believer costs SAN equal to the investigator's current Cthulhu
    Mythos skill (the "believer bomb"). This read-only signal computes the
    pending loss and whether it would drop the investigator to 0 SAN
    (permanent insanity). The actual SAN deduction is applied by
    ``coc_mythos.become_believer``.

    Parameters:
        cm_value: the investigator's current Cthulhu Mythos skill percentage.
        current_san: the investigator's current SAN.
        max_san: optional max SAN (for the clamped-after signal).
        already_believer: True if the investigator already accepts the Mythos;
            in that case no new SAN bomb is pending.
        is_first: True for the investigator's first Mythos encounter (controls
            the ``cm_gain`` value: +5 first encounter, +1 subsequent, p.167).

    Returns:
        {pending_san_loss, resulting_san, would_be_permanently_insane, ...}
    """
    pending = int(cm_value)
    resulting = max(0, int(current_san) - pending)
    cm_gain = 5 if is_first else 1
    if cm_value <= 0 and not already_believer:
        # No Mythos exposure yet: cannot become a believer.
        return {
            "implemented": True,
            "is_believer": False,
            "cm_value": int(cm_value),
            "current_san": int(current_san),
            "max_san": int(max_san) if max_san is not None else None,
            "rule_ref": "core.mythos.become_believer",
            "summary": "Not a believer: Cthulhu Mythos is 0.",
        }
    if already_believer:
        return {
            "implemented": True,
            "is_believer": True,
            "already_believer": True,
            "san_loss_pending": 0,
            "pending_san_loss": 0,
            "cm_gain": cm_gain,
            "current_san": int(current_san),
            "resulting_san": int(current_san),
            "would_be_permanently_insane": int(current_san) == 0,
            "max_san": int(max_san) if max_san is not None else None,
            "rule_ref": "core.mythos.become_believer",
            "summary": "Already a believer: no new SAN bomb pending.",
        }
    return {
        "implemented": True,
        "is_believer": True,
        "san_loss_pending": "see_source",
        "cm_gain": cm_gain,
        # Preserved pending-loss model (existing tests rely on these keys):
        "pending_san_loss": pending,
        "current_san": int(current_san),
        "resulting_san": resulting,
        "would_be_permanently_insane": resulting == 0,
        "max_san": int(max_san) if max_san is not None else None,
        "rule_ref": "core.mythos.become_believer",
        "summary": (f"Believer SAN bomb: -{pending} SAN "
                    f"({current_san}->{resulting})."),
    }


# --------------------------------------------------------------------------- #
# Engine-state readers: give the director visibility into SanitySession and
# ChaseSession-managed state without instantiating those engines.
# --------------------------------------------------------------------------- #

def _read_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def read_sanity_engine_state(campaign_dir, investigator_id: str) -> dict[str, Any]:
    """Read structured sanity fields for an investigator (director signal).

    Reads ``save/investigator-state/<id>.json`` (written by coc_mythos and
    merged by the director's investigator-state layer). Falls back to the
    identity-bound ``save/sanity-state/<id>.json`` SanitySession snapshot, and
    then to a matching legacy ``save/sanity.json`` owner, when the
    per-investigator state file is absent. Returns a structured signal describing current SAN,
    max SAN, conditions, daily SAN lost, temporary/indefinite/permanent
    insanity flags, CM, and phobia/mania if present.

    Always returns a dict (possibly mostly empty) so the director can treat
    the signal uniformly.
    """
    save = Path(campaign_dir) / "save"
    state: dict[str, Any] = _read_json(
        save / "investigator-state" / f"{investigator_id}.json", {}
    )
    if not state:
        # Fall back to the identity-bound SanitySession snapshot.  The legacy
        # singleton is usable only when its embedded owner matches.
        san_snap = _read_json(
            save / "sanity-state" / f"{investigator_id}.json", {}
        )
        if not san_snap:
            legacy = _read_json(save / "sanity.json", {})
            san_snap = (
                legacy
                if isinstance(legacy, dict)
                and legacy.get("investigator_id") == investigator_id
                else {}
            )
        if isinstance(san_snap, dict) and san_snap.get("investigator_id") in {
            None, investigator_id,
        }:
            state = san_snap

    current_san = state.get("current_san", state.get("san_current"))
    max_san = state.get("max_san", state.get("san_max"))
    conditions = state.get("conditions", []) or []
    daily_san_lost = state.get("daily_san_lost", 0)

    # A bout (Keeper takeover, 1D10 rounds, p.157) is NOT the same as
    # temporary insanity (underlying phase, 1D10 hours, player keeps control,
    # p.158) — only explicit bout evidence counts.
    bout_active = bool(
        state.get("bout_active") or "bout_active" in conditions
    )
    temporary_insane = bool(state.get("temporary_insane"))
    indefinite_insane = bool(state.get("indefinite_insane"))
    permanently_insane = bool(state.get("permanently_insane"))

    signal: dict[str, Any] = {
        "investigator_id": investigator_id,
        "has_state": bool(state),
        "current_san": int(current_san) if current_san is not None else None,
        "max_san": int(max_san) if max_san is not None else None,
        "cm_value": int(state.get("cm_value", 0)),
        "conditions": list(conditions),
        "daily_san_lost": int(daily_san_lost or 0),
        "bout_active": bout_active,
        "temporary_insane": temporary_insane,
        "indefinite_insane": indefinite_insane,
        "permanently_insane": permanently_insane,
        "delusion_active": bool(state.get("active_delusion")),
    }
    if state.get("phobia"):
        signal["phobia"] = state["phobia"]
    if state.get("mania"):
        signal["mania"] = state["mania"]
    if state.get("temporary_insane_remaining_hours") is not None:
        signal["temporary_insane_remaining_hours"] = int(
            state["temporary_insane_remaining_hours"]
        )
    return signal


def read_chase_state(campaign_dir) -> dict[str, Any]:
    """Read the active chase session (if any) from ``save/chase.json``.

    Returns ``{active: False}`` when no chase session is saved. Otherwise
    returns ``{active, participants, round, outcome}`` summarizing the
    ChaseSession snapshot for director awareness.
    """
    save = Path(campaign_dir) / "save"
    snap = _read_json(save / "chase.json", {})
    if not snap:
        return {"active": False}
    rounds = snap.get("rounds", []) or []
    last_round = rounds[-1]["round"] if rounds else 0
    status = snap.get("status", "active")
    outcome = snap.get("outcome")
    participants = snap.get("participants", []) or []
    return {
        "active": status == "active",
        "chase_id": snap.get("chase_id"),
        "status": status,
        "revision": snap.get("revision"),
        "initiative_cursor": snap.get("initiative_cursor"),
        "participants": [
            {
                "actor_id": p.get("actor_id"),
                "side": p.get("side"),
                "mov_adjusted": p.get("mov_adjusted"),
                "position": p.get("position"),
                "escaped": bool(p.get("escaped")),
                "captured": bool(p.get("captured")),
                "is_vehicle": bool(p.get("is_vehicle")),
            }
            for p in participants
        ],
        "round": last_round,
        "outcome": outcome,
    }


# --------------------------------------------------------------------------- #
# G1: clue affordance matching (structured intent ∩ compile-time affordance)
# --------------------------------------------------------------------------- #

def _norm_tag(value: Any) -> str | None:
    """Case-normalize an ID/tag for set comparison. Empty → None."""
    if value is None:
        return None
    text = str(value).strip().lower()
    return text or None


def _norm_tag_set(values: Any) -> set[str]:
    if not isinstance(values, list):
        return set()
    out: set[str] = set()
    for item in values:
        tag = _norm_tag(item)
        if tag is not None:
            out.add(tag)
    return out


def _intent_affordance_sets(intent: dict[str, Any] | None) -> tuple[set[str], set[str], set[str]]:
    """Extract structured entity/verb/skill sets from a router intent.

    Sources (Semantic Matcher Constitution — no prose scanning):
    - entities: ``target_entities``
    - verbs: ``action_atoms[].verb`` (also ``goal`` / ``intent`` when present as tags)
    - skills: ``action_atoms[].skill`` / ``roll_skill``
    """
    rich = intent if isinstance(intent, dict) else {}
    entities = _norm_tag_set(rich.get("target_entities"))
    verbs: set[str] = set()
    skills: set[str] = set()
    for atom in rich.get("action_atoms") or []:
        if not isinstance(atom, dict):
            continue
        for key in ("verb", "goal", "intent"):
            tag = _norm_tag(atom.get(key))
            if tag is not None:
                verbs.add(tag)
        for key in ("skill", "roll_skill"):
            tag = _norm_tag(atom.get(key))
            if tag is not None:
                skills.add(tag)
    return entities, verbs, skills


def _clue_affordance_block(clue: dict[str, Any]) -> dict[str, Any] | None:
    block = clue.get("affordance")
    return block if isinstance(block, dict) else None


def match_clue_affordances(
    intent: dict[str, Any] | None,
    clue_graph: dict[str, Any] | None,
    available_clue_ids: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Match structured player intent against clue affordance lists.

    Pure set-intersection over case-normalized IDs/tags. Returns only clues
    that share at least one entity, verb, or skill with the intent. Score is
    the count of matched dimensions (entities + verbs + skills hits, each
    dimension contributing 1 when non-empty intersection).

    Empty / missing affordance → no match (backward compatible).
    """
    available = {
        str(cid) for cid in (available_clue_ids or []) if cid is not None and str(cid)
    }
    if not available:
        return []
    intent_entities, intent_verbs, intent_skills = _intent_affordance_sets(intent)
    if not (intent_entities or intent_verbs or intent_skills):
        return []

    hits: list[dict[str, Any]] = []
    for concl in (clue_graph or {}).get("conclusions") or []:
        if not isinstance(concl, dict):
            continue
        for clue in concl.get("clues") or []:
            if not isinstance(clue, dict):
                continue
            clue_id = clue.get("clue_id")
            if clue_id is None or str(clue_id) not in available:
                continue
            block = _clue_affordance_block(clue)
            if block is None:
                continue
            aff_entities = _norm_tag_set(block.get("target_entities"))
            aff_verbs = _norm_tag_set(block.get("verbs"))
            aff_skills = _norm_tag_set(block.get("skills"))
            if not (aff_entities or aff_verbs or aff_skills):
                continue
            matched_entities = sorted(intent_entities & aff_entities)
            matched_verbs = sorted(intent_verbs & aff_verbs)
            matched_skills = sorted(intent_skills & aff_skills)
            score = (
                (1 if matched_entities else 0)
                + (1 if matched_verbs else 0)
                + (1 if matched_skills else 0)
            )
            if score <= 0:
                continue
            hits.append({
                "clue_id": str(clue_id),
                "matched": {
                    "entities": matched_entities,
                    "verbs": matched_verbs,
                    "skills": matched_skills,
                },
                "score": score,
            })
    hits.sort(key=lambda h: (-int(h["score"]), str(h["clue_id"])))
    return hits
