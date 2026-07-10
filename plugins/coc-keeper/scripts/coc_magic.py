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
- Pushed cast: MP cost multiplied by 1D6, overspill to HP 1-for-1.
  On a *failed* pushed cast the spell does not work: SAN cost is also
  multiplied by 1D6 and a 1D8 side-effect is rolled on the minor/major
  table (Keeper Rulebook pp.178-179). Tier selection uses a structured
  ``push_tier`` / ``power_tier`` field on the spell when present; otherwise
  ``resolved mp_cost >= 10`` selects the major table (heuristic documented
  here because spells.json has no per-spell tier field).
- Interrupted cast: spell auto-fails, committed base MP is lost, no
  side-effect table and no SAN multiplier.
- Learning a spell: Hard INT roll (pushable). From a tome takes 2D6 weeks;
  from a person takes 1D8 days; from an entity uses a SAN floor
  (``from_entity_min_sanity_cost``, default 1D6) with no study delay.

The functions here take plain ``caster_state`` / ``learner_state`` dicts plus
an optional ``mp_pool`` (coc_mp.MPool) and return structured records. They do
not perform their own file I/O so they remain deterministic and unit-testable;
callers persist via the existing session save paths.

Rule-data blocks used (spells.json):
  casting  -> first_cast_roll, pushable, push_mp_multiplier, mp_overspill_to_hp
  learning -> roll, pushable, from_tome_weeks, from_person_days,
              from_entity_min_sanity_cost
  push_side_effects -> minor[8], major[8] (failed pushed-cast consequences)
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
        "from_entity_min_sanity_cost": "1D6",
    }


def push_side_effect_tables() -> dict[str, list[dict[str, Any]]]:
    """Return the minor/major 1D8 push-failure side-effect tables."""
    table = coc_rules.spells_table().get("push_side_effects") or {}
    return {
        "minor": list(table.get("minor") or []),
        "major": list(table.get("major") or []),
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
    # Patterns like "10 per 6 hours": take the leading number.
    leading = re.match(r"^(\d+)\b", text)
    if leading and not _DICE_RE.match(text):
        try:
            return int(leading.group(1))
        except ValueError:
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


def _resolve_pow_cost(spell: dict[str, Any], rng: random.Random) -> int:
    """Resolve POW cost from ``cost_pow`` or legacy ``pow_cost`` fields."""
    raw = spell.get("cost_pow", spell.get("pow_cost"))
    if raw is None:
        return 0
    if isinstance(raw, int):
        return raw
    text = str(raw).strip()
    if not text or text.lower() in ("variable", "null"):
        return 0
    return _roll_dice(text, rng)


def _push_tier_for_spell(spell: dict[str, Any], base_mp: int) -> str:
    """Select minor/major push side-effect tier.

    Prefer a structured spell field (``push_tier`` or ``power_tier``). When
    absent, use the heuristic ``base_mp >= 10`` → major (Keeper Rulebook
    p.179 weak vs powerful spells; spells.json has no per-spell tier today).
    """
    for key in ("push_tier", "power_tier", "side_effect_tier"):
        raw = spell.get(key)
        if isinstance(raw, str) and raw.strip().lower() in ("minor", "major"):
            return raw.strip().lower()
    return "major" if base_mp >= 10 else "minor"


def _roll_push_side_effect(
    tier: str, rng: random.Random
) -> dict[str, Any]:
    """Roll 1D8 on the named push side-effect table."""
    tables = push_side_effect_tables()
    entries = tables.get(tier) or tables.get("minor") or []
    roll = rng.randint(1, 8)
    effect = ""
    for entry in entries:
        if int(entry.get("roll", 0)) == roll:
            effect = str(entry.get("effect", ""))
            break
    if not effect and entries:
        # Fall back to index if roll labels are sparse.
        idx = min(roll, len(entries)) - 1
        effect = str(entries[idx].get("effect", ""))
    return {"roll": roll, "tier": tier, "effect": effect}


def _spend_mp(
    mp_spent: int,
    *,
    spell_name: str,
    caster_state: dict[str, Any],
    casting: dict[str, Any],
    mp_pool: Any | None,
) -> int:
    """Debit MP (pool or inline state); return HP overspill damage."""
    if mp_spent <= 0:
        return 0
    if mp_pool is not None:
        ev = mp_pool.spend_mp(mp_spent, source=f"cast:{spell_name}")
        return int(ev.get("hp_damage", 0))
    current_mp = int(caster_state.get("current_mp", 0))
    current_hp = int(caster_state.get("current_hp", 0))
    new_mp = current_mp - mp_spent
    hp_damage = 0
    if new_mp < 0 and casting.get("mp_overspill_to_hp_one_for_one", True):
        overspill = -new_mp
        new_mp = 0
        hp_damage = overspill
        caster_state["current_hp"] = max(0, current_hp - overspill)
    caster_state["current_mp"] = new_mp
    return hp_damage


def _apply_san_loss(caster_state: dict[str, Any], san_lost: int) -> None:
    if san_lost > 0 and "current_san" in caster_state:
        caster_state["current_san"] = max(
            0, int(caster_state.get("current_san", 0)) - san_lost
        )


def _apply_pow_cost(caster_state: dict[str, Any], pow_spent: int) -> None:
    if pow_spent > 0 and "pow" in caster_state:
        caster_state["pow"] = max(0, int(caster_state.get("pow", 0)) - pow_spent)


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
    interrupted: bool = False,
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
        pushed: True when the caster pushes the cast (MP cost x1D6). A failed
            pushed cast also multiplies SAN by 1D6 and rolls a side-effect.
        interrupted: True when casting is interrupted mid-ritual — the spell
            auto-fails, committed base MP is lost, no side-effect table and
            no SAN multiplier (p.178).
        rng: deterministic RNG (tests pass a seeded Random).
        mp_pool: optional coc_mp.MPool to debit. When None, MP/HP are adjusted
            against caster_state in place.

    Returns a record:
        {success, roll_result, mp_spent, hp_damage, san_lost, pow_spent,
         pushed, interrupted, side_effect, spell}
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

    # --- Interruption: committed base MP lost, spell fails, no push extras -- #
    # Resolve MP before any POW roll so interruption does not consume roll RNG.
    if interrupted:
        base_mp = _resolve_mp_cost(mp_cost_expr, rng)
        hp_damage = _spend_mp(
            base_mp,
            spell_name=spell_name,
            caster_state=caster_state,
            casting=casting,
            mp_pool=mp_pool,
        )
        return {
            "spell": spell_name,
            "success": False,
            "pushed": pushed,
            "interrupted": True,
            "is_npc": is_npc,
            "is_first_cast": is_first_cast,
            "roll_result": None,
            "mp_spent": base_mp,
            "hp_damage": hp_damage,
            "san_lost": 0,
            "pow_spent": 0,
            "base_mp_cost": base_mp,
            "side_effect": None,
            "summary": (
                f"cast {spell_name}: interrupted, mp {base_mp} lost, "
                f"success=False"
            ),
        }

    # --- Determine the casting roll (if any) ------------------------------ #
    # Roll BEFORE resolving dice-based MP costs so seeded tests that probe
    # percentile_check with the same seed still match cast_spell's POW roll.
    needs_roll = False
    roll_result: dict[str, Any] | None = None
    success = True

    if is_npc and casting.get("npcs_no_casting_roll", True):
        # NPC/monster caster: auto-success, no roll (p.178).
        needs_roll = False
    elif is_first_cast or pushed:
        # First cast, or any pushed cast: Hard POW roll.
        # Pushed failure does NOT auto-succeed (pp.178-179 consequences).
        needs_roll = True
    else:
        # Subsequent PC cast: auto-success, no roll.
        needs_roll = False

    if needs_roll:
        pow_value = int(caster_state.get("pow", 0))
        roll_result = coc_roll.percentile_check(
            pow_value, difficulty="hard", rng=rng
        )
        outcome = roll_result.get("outcome")
        success = outcome in ("regular", "hard", "extreme", "critical")

    # --- Compute MP cost -------------------------------------------------- #
    base_mp = _resolve_mp_cost(mp_cost_expr, rng)
    mp_spent = base_mp
    push_multiplier = 1
    if pushed:
        push_multiplier = max(
            1, _roll_dice(str(casting.get("push_mp_multiplier", "1D6")), rng)
        )
        mp_spent = base_mp * push_multiplier

    hp_damage = _spend_mp(
        mp_spent,
        spell_name=spell_name,
        caster_state=caster_state,
        casting=casting,
        mp_pool=mp_pool,
    )

    # --- SAN / POW / side-effects ----------------------------------------- #
    san_lost = 0
    pow_spent = 0
    side_effect: dict[str, Any] | None = None

    if success:
        san_lost = _resolve_sanity_cost(san_cost_expr, rng)
        _apply_san_loss(caster_state, san_lost)
        pow_spent = _resolve_pow_cost(spell, rng)
        _apply_pow_cost(caster_state, pow_spent)
    elif pushed:
        # Failed pushed cast (pp.178-179): SAN ×1D6 + 1D8 side-effect table.
        base_san = _resolve_sanity_cost(san_cost_expr, rng)
        san_lost = base_san * push_multiplier
        _apply_san_loss(caster_state, san_lost)
        tier = _push_tier_for_spell(spell, base_mp)
        side_effect = _roll_push_side_effect(tier, rng)

    return {
        "spell": spell_name,
        "success": success,
        "pushed": pushed,
        "interrupted": False,
        "is_npc": is_npc,
        "is_first_cast": is_first_cast,
        "roll_result": roll_result,
        "mp_spent": mp_spent,
        "hp_damage": hp_damage,
        "san_lost": san_lost,
        "pow_spent": pow_spent,
        "base_mp_cost": base_mp,
        "side_effect": side_effect,
        "summary": (
            f"cast {spell_name}: "
            + (
                "auto-success"
                if roll_result is None
                else f"POW(hard)->{roll_result.get('outcome')}"
            )
            + (", pushed" if pushed else "")
            + f", mp {mp_spent} (hp {hp_damage}), san -{san_lost}"
            + (f", pow -{pow_spent}" if pow_spent else "")
            + f", success={success}"
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
        source: "tome" (2D6 weeks), "person" (1D8 days), or "entity"
            (entity-taught; SAN floor via ``from_entity_min_sanity_cost``).
        rng: deterministic RNG.
        campaign_dir: when provided (and the time layer is available), a
            completion trigger is scheduled via coc_time.schedule_trigger and
            its id is returned as ``completion_trigger_id``.

    Returns a record:
        {learned, roll_result, study_weeks, study_days, completion_trigger_id,
         san_cost_expr (entity only)}
    """
    rng = rng or random.Random()
    learning = learning_rules()

    if source not in ("tome", "person", "entity"):
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
    san_cost_expr: str | None = None

    if source == "entity":
        # Spell-level floor when present; else learning block; else "1D6".
        try:
            spell = coc_rules.spell_by_name(spell_name)
        except KeyError:
            spell = {}
        san_cost_expr = (
            spell.get("from_entity_min_sanity_cost")
            or learning.get("from_entity_min_sanity_cost")
            or "1D6"
        )
        san_cost_expr = str(san_cost_expr)

    if learned:
        if source == "tome":
            study_weeks = _roll_dice(str(learning.get("from_tome_weeks", "2D6")), rng)
            study_days = study_weeks * 7
        elif source == "person":
            study_days = _roll_dice(str(learning.get("from_person_days", "1D8")), rng)
        # entity: no study delay; knowledge is impressed directly.

        # Schedule a completion trigger via the time layer when available.
        # Entity teaching completes immediately (no delay trigger).
        if (
            source in ("tome", "person")
            and coc_time is not None
            and campaign_dir is not None
        ):
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

    result: dict[str, Any] = {
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
            + (
                f", {study_weeks}w study"
                if source == "tome" and learned
                else (f", {study_days}d study" if learned and source == "person" else "")
            )
            + (f", san floor {san_cost_expr}" if san_cost_expr else "")
        ),
    }
    if san_cost_expr is not None:
        result["san_cost_expr"] = san_cost_expr
    return result
