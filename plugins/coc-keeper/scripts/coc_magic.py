#!/usr/bin/env python3
"""Magic casting + learning engine for Call of Cthulhu 7e -- Chapter 9 (Magick).

Owns the structured resolution of casting and learning spells, layered on top
of the existing modules:
  - coc_roll.percentile_check  (Hard POW / Hard INT rolls)
  - coc_mp.MPool.spend_mp      (MP deduction + HP overspill)
  - coc_time.schedule_trigger  (tome study completion)

Rulebook basis (7e 40th Anniversary, Chapter 9 pp.176-179):
- First cast by an investigator: Hard POW roll (spells.json -> casting).
- NPC / monster caster: auto-success (no roll).
- Subsequent casts by the same investigator: auto-success (no roll).
- Pushed cast: MP cost multiplied by 1D6, overspill to HP 1-for-1, the spell
  always works and the roll merely gauges the harm taken.
- Learning a spell: Hard INT roll (pushable). From a tome takes 2D6 weeks;
  from a person takes 1D8 days.

The functions here take plain ``caster_state`` / ``learner_state`` dicts plus
an optional ``mp_pool`` (coc_mp.MPool) and return structured records. They do
not perform their own file I/O so they remain deterministic and unit-testable;
callers persist via the existing session save paths.

Rule-data blocks used (spells.json):
  casting  -> first_cast_roll, pushable, push_mp_multiplier, mp_overspill_to_hp
  learning -> roll, pushable, from_tome_weeks, from_person_days
  mp_economy -> (consumed indirectly by coc_mp.MPool)
"""
from __future__ import annotations

import importlib.util
import random
import re
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent


def _load_sibling(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPT_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_roll = _load_sibling("coc_roll", "coc_roll.py")
coc_rules = _load_sibling("coc_rules", "coc_rules.py")
coc_mp = _load_sibling("coc_mp", "coc_mp.py")

# coc_time is optional (only needed for scheduling study completion).
coc_time = None
try:
    coc_time = _load_sibling("coc_time", "coc_time.py")
except Exception:  # pragma: no cover - time layer optional
    coc_time = None


# --------------------------------------------------------------------------- #
# Rule-data accessors
# --------------------------------------------------------------------------- #
def casting_rules() -> dict[str, Any]:
    """Return the casting block from spells.json (with safe defaults)."""
    return coc_rules.magic_casting_rules() or {
        "first_cast_roll": "Hard POW",
        "pushable": True,
        "push_mp_multiplier": "1D6",
        "mp_overspill_to_hp_one_for_one": True,
        "subsequent_casts_no_roll": True,
        "npcs_no_casting_roll": True,
    }


def learning_rules() -> dict[str, Any]:
    """Return the learning block from spells.json (with safe defaults)."""
    return coc_rules.magic_learning_rules() or {
        "roll": "Hard INT",
        "pushable": True,
        "from_tome_weeks": "2D6",
        "from_person_days": "1D8",
    }


# --------------------------------------------------------------------------- #
# Dice-expression helpers (resolve "1D6+3" / "2D10" / "10" against an RNG)
# --------------------------------------------------------------------------- #
_DICE_RE = re.compile(r"^(\d+)D(\d+)([+-]\d+)?$")


def _roll_dice(expr: str, rng: random.Random) -> int:
    """Roll a dice expression like '1D6', '2D10+1', or a bare int '10'."""
    m = _DICE_RE.match(expr.strip())
    if m:
        n, sides = int(m.group(1)), int(m.group(2))
        mod = int(m.group(3)) if m.group(3) else 0
        return sum(rng.randint(1, sides) for _ in range(n)) + mod
    try:
        return int(expr)
    except (TypeError, ValueError):
        return 0


def _resolve_mp_cost(cost_expr: str | int, rng: random.Random) -> int:
    """Resolve a spell's MP cost (may be a dice expr like '1D4+3' or '6+')."""
    if cost_expr is None:
        return 0
    if isinstance(cost_expr, int):
        return cost_expr
    text = str(cost_expr).strip()
    # Trailing modifiers like "6+" or "1+ per person": take the leading number.
    if text.endswith("+"):
        try:
            return int(text[:-1])
        except ValueError:
            return 0
    if "per person" in text or "per/person" in text:
        # Variable spells (Call/Dismiss Deity): assume a single caster -> 1.
        return 1
    if text.lower() in ("variable",):
        return 0
    return _roll_dice(text, rng)


def _resolve_sanity_cost(cost_expr: str | int, rng: random.Random) -> int:
    """Resolve a spell's SAN cost (may be a dice expr, 'variable', or 0)."""
    if cost_expr is None:
        return 0
    if isinstance(cost_expr, int):
        return cost_expr
    text = str(cost_expr).strip()
    if text.lower() in ("variable", ""):
        return 0
    return _roll_dice(text, rng)


# --------------------------------------------------------------------------- #
# cast_spell
# --------------------------------------------------------------------------- #
def cast_spell(
    spell_name: str,
    caster_state: dict[str, Any],
    *,
    is_first_cast: bool,
    is_npc: bool = False,
    pushed: bool = False,
    rng: random.Random | None = None,
    mp_pool: Any | None = None,
) -> dict[str, Any]:
    """Resolve casting ``spell_name`` per Chapter 9 (pp.177-179).

    Parameters:
        spell_name: canonical spell name (looked up via coc_rules.spell_by_name).
        caster_state: dict with at least ``pow`` (POW characteristic). When a
            ``mp_pool`` is supplied the pool is debited there; otherwise the
            caster_state may carry ``current_mp``/``current_hp``/``mp_max`` and
            this function will deduct + record overspill inline.
        is_first_cast: True the first time this investigator casts this spell.
        is_npc: True when an NPC/monster is casting (auto-success, no roll).
        pushed: True when the caster pushes the cast (MP cost x1D6, spell works,
            the POW roll gauges harm).
        rng: deterministic RNG (tests pass a seeded Random).
        mp_pool: optional coc_mp.MPool to debit. When None, MP/HP are adjusted
            against caster_state in place.

    Returns a record:
        {success, roll_result, mp_spent, hp_damage, san_lost, pushed, spell}
    """
    rng = rng or random.Random()
    casting = casting_rules()

    # Spell rule data (costs). Unknown spells still resolve with zero costs so
    # the engine degrades gracefully; callers validate spell names upstream.
    try:
        spell = coc_rules.spell_by_name(spell_name)
        mp_cost_expr = spell.get("cost_mp", "0")
        san_cost_expr = spell.get("cost_sanity", "0")
    except KeyError:
        spell = {"name": spell_name}
        mp_cost_expr = "0"
        san_cost_expr = "0"

    # --- Determine the casting roll (if any) ------------------------------ #
    needs_roll = False
    roll_result: dict[str, Any] | None = None
    success = True

    if is_npc and casting.get("npcs_no_casting_roll", True):
        # NPC/monster caster: auto-success, no roll (p.178).
        needs_roll = False
    elif is_first_cast and not pushed:
        # First cast by a PC: Hard POW roll.
        needs_roll = True
    elif pushed:
        # Pushed cast: roll POW (Hard) but the spell always works; the roll
        # only gauges the harm taken from the multiplied MP cost.
        needs_roll = True
    else:
        # Subsequent PC cast: auto-success, no roll.
        needs_roll = False

    if needs_roll:
        pow_value = int(caster_state.get("pow", 0))
        roll_result = coc_roll.percentile_check(
            pow_value, difficulty="hard", rng=rng
        )
        if pushed:
            # Pushed cast: the spell always works regardless of the roll.
            success = True
        else:
            outcome = roll_result.get("outcome")
            success = outcome in ("regular", "hard", "extreme", "critical")

    # --- Compute MP cost -------------------------------------------------- #
    base_mp = _resolve_mp_cost(mp_cost_expr, rng)
    mp_spent = base_mp
    hp_damage = 0
    if pushed:
        multiplier = _roll_dice(str(casting.get("push_mp_multiplier", "1D6")), rng)
        mp_spent = base_mp * max(1, multiplier)

    # Deduct MP via the pool (preferred) or inline against caster_state.
    if mp_spent > 0:
        if mp_pool is not None:
            ev = mp_pool.spend_mp(mp_spent, source=f"cast:{spell_name}")
            hp_damage = int(ev.get("hp_damage", 0))
        else:
            current_mp = int(caster_state.get("current_mp", 0))
            current_hp = int(caster_state.get("current_hp", 0))
            new_mp = current_mp - mp_spent
            if new_mp < 0 and casting.get("mp_overspill_to_hp_one_for_one", True):
                overspill = -new_mp
                new_mp = 0
                hp_damage = overspill
                caster_state["current_hp"] = max(0, current_hp - overspill)
            caster_state["current_mp"] = new_mp

    # --- SAN cost (only on a successful cast; failed first-cast loses none) #
    san_lost = 0
    if success:
        san_lost = _resolve_sanity_cost(san_cost_expr, rng)
        if san_lost > 0:
            if "current_san" in caster_state:
                caster_state["current_san"] = max(
                    0, int(caster_state.get("current_san", 0)) - san_lost
                )

    return {
        "spell": spell_name,
        "success": success,
        "pushed": pushed,
        "is_npc": is_npc,
        "is_first_cast": is_first_cast,
        "roll_result": roll_result,
        "mp_spent": mp_spent,
        "hp_damage": hp_damage,
        "san_lost": san_lost,
        "base_mp_cost": base_mp,
        "summary": (
            f"cast {spell_name}: "
            + ("auto-success" if roll_result is None else f"POW(hard)->{roll_result.get('outcome')}")
            + (", pushed" if pushed else "")
            + f", mp {mp_spent} (hp {hp_damage}), san -{san_lost}, success={success}"
        ),
    }


# --------------------------------------------------------------------------- #
# learn_spell
# --------------------------------------------------------------------------- #
def learn_spell(
    spell_name: str,
    learner_state: dict[str, Any],
    source: str = "tome",
    *,
    rng: random.Random | None = None,
    campaign_dir: Path | None = None,
) -> dict[str, Any]:
    """Resolve learning ``spell_name`` per Chapter 9 (pp.176-177).

    Parameters:
        spell_name: canonical spell name being learned.
        learner_state: dict with at least ``int`` (INT characteristic).
        source: "tome" (2D6 weeks) or "person" (1D8 days).
        rng: deterministic RNG.
        campaign_dir: when provided (and the time layer is available), a
            completion trigger is scheduled via coc_time.schedule_trigger and
            its id is returned as ``completion_trigger_id``.

    Returns a record:
        {learned, roll_result, study_weeks, study_days, completion_trigger_id}
    """
    rng = rng or random.Random()
    learning = learning_rules()

    if source not in ("tome", "person"):
        raise ValueError(f"unsupported learn source: {source!r}")

    int_value = int(learner_state.get("int", 0))
    roll_result = coc_roll.percentile_check(
        int_value, difficulty="hard", rng=rng
    )
    outcome = roll_result.get("outcome")
    learned = outcome in ("regular", "hard", "extreme", "critical")

    study_weeks = 0
    study_days = 0
    completion_trigger_id = None

    if learned:
        if source == "tome":
            study_weeks = _roll_dice(str(learning.get("from_tome_weeks", "2D6")), rng)
            study_days = study_weeks * 7
        else:  # person
            study_days = _roll_dice(str(learning.get("from_person_days", "1D8")), rng)

        # Schedule a completion trigger via the time layer when available.
        if coc_time is not None and campaign_dir is not None:
            # Ensure time-state exists so elapsed can be read.
            state = coc_time.read_time_state(campaign_dir)
            if not state:
                coc_time.initialize_time_state(campaign_dir)
                state = coc_time.read_time_state(campaign_dir)
            now = int(state.get("clock", {}).get("elapsed_minutes", 0))
            due = now + study_days * 24 * 60
            completion_trigger_id = coc_time.schedule_trigger(campaign_dir, {
                "kind": "spell_study_complete",
                "scope": "investigator",
                "due_elapsed_minutes": due,
                "policy": "auto_apply",
                "handler": "grant_learned_spell",
                "payload": {
                    "spell": spell_name,
                    "source": source,
                    "study_weeks": study_weeks,
                    "study_days": study_days,
                },
            })

    return {
        "spell": spell_name,
        "source": source,
        "learned": learned,
        "roll_result": roll_result,
        "study_weeks": study_weeks,
        "study_days": study_days,
        "completion_trigger_id": completion_trigger_id,
        "summary": (
            f"learn {spell_name} from {source}: INT(hard)->{outcome}, "
            + ("learned" if learned else "not learned")
            + (f", {study_weeks}w study" if source == "tome" and learned
               else (f", {study_days}d study" if learned else ""))
        ),
    }
